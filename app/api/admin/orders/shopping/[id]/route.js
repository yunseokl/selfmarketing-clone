import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateAdStatusSchema } from '@/lib/validations/admin';

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

        const order = await prisma.shoppingAd.update({
            where: { id: params.id },
            data: validationResult.data
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
