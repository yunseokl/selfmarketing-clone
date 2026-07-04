import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createRefundRequestSchema } from '@/lib/validations/refund';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 내 광고비 환급 신청 목록 조회
export async function GET() {
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

        const requests = await prisma.refundRequest.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ requests });
    } catch (error) {
        console.error('Error fetching refund requests:', error);
        return NextResponse.json({ error: '신청 내역 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 새 광고비 환급 신청
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

        const validationResult = createRefundRequestSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { mediaType, accountId, monthlySpend, contact, memo } = validationResult.data;
        const expectedRefund = Math.round(monthlySpend * 0.1);

        const refundRequest = await prisma.refundRequest.create({
            data: {
                userId: user.id,
                mediaType,
                accountId,
                monthlySpend,
                contact,
                memo: memo || null,
                expectedRefund,
                status: 'pending',
            }
        });

        await createNotification(user.id, {
            type: 'system',
            title: '광고비 환급 신청 완료',
            message: `월 예상 환급액 ${expectedRefund.toLocaleString()}원 신청이 접수되었습니다.`,
            link: '/dashboard/refund',
        });

        return NextResponse.json({
            message: '광고비 환급이 신청되었습니다.',
            request: refundRequest
        });
    } catch (error) {
        console.error('Error creating refund request:', error);
        return NextResponse.json({ error: '신청 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
