import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateAdStatusSchema } from '@/lib/validations/admin';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

const statusLabels = { pending: '대기중', active: '진행중', completed: '완료', refunded: '환불' };

// PUT - 주문 상태 변경
export async function PUT(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = updateAdStatusSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const order = await prisma.placeAd.update({
            where: { id: params.id },
            data: validationResult.data
        });

        await createNotification(order.userId, {
            type: 'ad',
            title: '플레이스 광고 상태가 변경되었습니다',
            message: `"${order.placeName}" 플레이스 광고가 ${statusLabels[order.status] || order.status} 상태로 변경되었습니다.`,
            link: '/dashboard/place',
        });

        return NextResponse.json({
            message: '상태가 변경되었습니다.',
            order
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        return NextResponse.json({ error: '상태 변경 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
