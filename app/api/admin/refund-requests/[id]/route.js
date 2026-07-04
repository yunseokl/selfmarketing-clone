import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateRefundRequestSchema } from '@/lib/validations/content';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// 상태별 회원 알림 문구
const statusMessages = {
    reviewing: '환급 신청이 검토중입니다.',
    approved: '환급 신청이 승인되었습니다.',
    paid: '환급금이 지급되었습니다.',
    rejected: '환급 신청이 거절되었습니다.',
};

// PATCH - 환급 신청 상태/메모 변경
export async function PATCH(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = updateRefundRequestSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { status } = validationResult.data;

        const refundRequest = await prisma.refundRequest.update({
            where: { id: params.id },
            data: validationResult.data
        });

        if (status && statusMessages[status]) {
            await createNotification(refundRequest.userId, {
                type: 'cash',
                title: statusMessages[status],
                message: '환급 신청 처리 현황을 확인해보세요.',
                link: '/dashboard/refund',
            });
        }

        return NextResponse.json({
            message: '환급 신청이 업데이트되었습니다.',
            refundRequest
        });
    } catch (error) {
        console.error('Error updating refund request:', error);
        return NextResponse.json({ error: '환급 신청 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
