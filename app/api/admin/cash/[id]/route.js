import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { createNotification } from '@/lib/notify';
import { processCashChargeSchema, calculateChargeBonus } from '@/lib/validations/cash';
import { creditBalance, AlreadyProcessedError } from '@/lib/cash-ledger';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// PATCH - 캐시 충전 신청 승인/거절 (관리자)
export async function PATCH(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = processCashChargeSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { action } = validationResult.data;

        const transaction = await prisma.cashTransaction.findUnique({
            where: { id: params.id }
        });

        if (!transaction) {
            return NextResponse.json({ error: '충전 신청을 찾을 수 없습니다.' }, { status: 404 });
        }

        if (transaction.type !== 'charge') {
            return NextResponse.json({ error: '충전 신청 건만 처리할 수 있습니다.' }, { status: 400 });
        }

        if (transaction.status !== 'pending') {
            return NextResponse.json({ error: '이미 처리된 신청입니다.' }, { status: 400 });
        }

        if (action === 'approve') {
            const bonus = calculateChargeBonus(transaction.amount);
            const totalAmount = transaction.amount + bonus;

            // 대기중 → 완료 전환(조건부 UPDATE)에 성공한 요청 하나만 잔액을 올립니다.
            // 승인 버튼을 연속으로 누르거나 두 관리자가 동시에 처리해도 한 번만 충전됩니다.
            let updatedTransaction;
            try {
                updatedTransaction = await prisma.$transaction(async (tx) => {
                    const claimed = await tx.cashTransaction.updateMany({
                        where: { id: params.id, status: 'pending', type: 'charge' },
                        data: { status: 'completed' },
                    });
                    if (claimed.count !== 1) {
                        throw new AlreadyProcessedError('이미 처리된 신청입니다.');
                    }

                    const balanceAfter = await creditBalance(tx, transaction.userId, totalAmount);

                    return tx.cashTransaction.update({
                        where: { id: params.id },
                        data: {
                            amount: totalAmount,
                            balanceAfter,
                            description: bonus > 0
                                ? `캐시 충전 승인 (보너스 ${bonus.toLocaleString()}원 포함)`
                                : '캐시 충전 승인',
                        }
                    });
                });
            } catch (error) {
                if (error instanceof AlreadyProcessedError) {
                    return NextResponse.json({ error: error.message }, { status: 400 });
                }
                throw error;
            }

            await createNotification(transaction.userId, {
                type: 'cash',
                title: '충전 완료',
                message: `${totalAmount.toLocaleString()}원이 충전되었습니다.${bonus > 0 ? ` (보너스 ${bonus.toLocaleString()}원 포함)` : ''}`,
                link: '/dashboard/charge',
            });

            return NextResponse.json({
                message: '충전 신청을 승인했습니다.',
                transaction: updatedTransaction
            });
        }

        // 거절 처리 — 승인과 동시에 들어와도 먼저 선점한 쪽만 반영됩니다.
        const rejected = await prisma.cashTransaction.updateMany({
            where: { id: params.id, status: 'pending', type: 'charge' },
            data: { status: 'rejected' }
        });
        if (rejected.count !== 1) {
            return NextResponse.json({ error: '이미 처리된 신청입니다.' }, { status: 400 });
        }
        const updatedTransaction = await prisma.cashTransaction.findUnique({ where: { id: params.id } });

        await createNotification(transaction.userId, {
            type: 'cash',
            title: '충전 거절',
            message: `${transaction.amount.toLocaleString()}원 충전 신청이 거절되었습니다. 고객센터로 문의해주세요.`,
            link: '/dashboard/charge',
        });

        return NextResponse.json({
            message: '충전 신청을 거절했습니다.',
            transaction: updatedTransaction
        });
    } catch (error) {
        console.error('Error processing cash charge request:', error);
        return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
