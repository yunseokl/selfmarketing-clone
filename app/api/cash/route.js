import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createNotification } from '@/lib/notify';
import { createCashChargeSchema } from '@/lib/validations/cash';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 내 캐시 이용 내역 조회
export async function GET(request) {
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

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');

        const where = { userId: user.id };
        if (type && type !== 'all') {
            where.type = type;
        }

        const transactions = await prisma.cashTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 100,
        });

        return NextResponse.json({ transactions });
    } catch (error) {
        console.error('Error fetching cash transactions:', error);
        return NextResponse.json({ error: '이용 내역 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 캐시 충전 신청 (무통장입금)
export async function POST(request) {
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

        const body = await request.json();

        // Zod 검증
        const validationResult = createCashChargeSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { amount, depositorName } = validationResult.data;

        const transaction = await prisma.cashTransaction.create({
            data: {
                userId: user.id,
                type: 'charge',
                amount,
                status: 'pending',
                method: 'bank',
                depositorName,
                description: '캐시 충전 신청 (무통장입금)',
            }
        });

        await createNotification(user.id, {
            type: 'cash',
            title: '충전 신청 접수',
            message: `${amount.toLocaleString()}원 충전 신청이 접수되었습니다. 입금 확인 후 24시간 내 충전됩니다.`,
            link: '/dashboard/charge',
        });

        return NextResponse.json({
            message: '충전 신청이 접수되었습니다. 입금 확인 후 24시간 내 충전됩니다.',
            transaction
        });
    } catch (error) {
        console.error('Error creating cash charge request:', error);
        return NextResponse.json({ error: '충전 신청 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
