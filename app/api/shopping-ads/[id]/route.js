import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { updateShoppingAdSchema } from '@/lib/validations/shopping';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 특정 광고 조회
export async function GET(request, { params }) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        });

        if (!user) {
            return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
        }

        const ad = await prisma.shoppingAd.findUnique({
            where: { id: params.id }
        });

        if (!ad) {
            return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 });
        }

        // 소유권 검증
        if (ad.userId !== user.id) {
            return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 });
        }

        return NextResponse.json({ ad });
    } catch (error) {
        console.error('Error fetching shopping ad:', error);
        return NextResponse.json({ error: '광고 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PUT - 광고 수정
export async function PUT(request, { params }) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        });

        if (!user) {
            return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
        }

        const existingAd = await prisma.shoppingAd.findUnique({
            where: { id: params.id }
        });

        if (!existingAd) {
            return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 });
        }

        // 소유권 검증
        if (existingAd.userId !== user.id) {
            return NextResponse.json({ error: '수정 권한이 없습니다.' }, { status: 403 });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = updateShoppingAdSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const ad = await prisma.shoppingAd.update({
            where: { id: params.id },
            data: validationResult.data
        });

        return NextResponse.json({
            message: '광고가 수정되었습니다.',
            ad
        });
    } catch (error) {
        console.error('Error updating shopping ad:', error);
        return NextResponse.json({ error: '광고 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 광고 삭제 (환불 처리)
export async function DELETE(request, { params }) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        });

        if (!user) {
            return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
        }

        const ad = await prisma.shoppingAd.findUnique({
            where: { id: params.id }
        });

        if (!ad) {
            return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 });
        }

        // 소유권 검증
        if (ad.userId !== user.id) {
            return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 });
        }

        // 이미 환불된 광고인지 확인
        if (ad.status === 'refunded') {
            return NextResponse.json({ error: '이미 환불된 광고입니다.' }, { status: 400 });
        }

        // Calculate refund (remaining days)
        const now = new Date();
        const endDate = new Date(ad.endDate);
        const remainingDays = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
        const refundAmount = Math.floor((ad.totalCost / ad.duration) * remainingDays);

        // Update ad status, refund user, and log the cash transaction atomically
        await prisma.$transaction(async (tx) => {
            await tx.shoppingAd.update({
                where: { id: params.id },
                data: { status: 'refunded' }
            });

            const updatedUser = await tx.user.update({
                where: { id: user.id },
                data: { balance: { increment: refundAmount } }
            });

            await tx.cashTransaction.create({
                data: {
                    userId: user.id,
                    type: 'refund',
                    amount: refundAmount,
                    balanceAfter: updatedUser.balance,
                    status: 'completed',
                    method: 'system',
                    description: `광고 취소 환불 - ${ad.productName} (${ad.keyword})`,
                }
            });
        });

        await createNotification(user.id, {
            type: 'cash',
            title: '환불 완료',
            message: `광고 취소로 ${refundAmount.toLocaleString()}원이 환불되었습니다.`,
            link: '/dashboard/charge',
        });

        return NextResponse.json({
            message: `광고가 취소되었습니다. ${refundAmount.toLocaleString()}원이 환불되었습니다.`,
            refundAmount
        });
    } catch (error) {
        console.error('Error deleting shopping ad:', error);
        return NextResponse.json({ error: '광고 삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
