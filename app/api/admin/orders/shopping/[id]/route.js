import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// PUT - 주문 상태 변경
export async function PUT(request, { params }) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const body = await request.json();
        const { status } = body;

        const order = await prisma.shoppingAd.update({
            where: { id: params.id },
            data: { status }
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
