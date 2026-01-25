import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// GET - 쇼핑 광고 주문 목록 (관리자용 - 회원 정보 포함)
export async function GET(request) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        const where = {};
        if (status && status !== 'all') {
            where.status = status;
        }

        // 모든 주문을 회원 정보와 함께 조회
        const orders = await prisma.shoppingAd.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        phone: true,
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ orders });
    } catch (error) {
        console.error('Error fetching shopping orders:', error);
        return NextResponse.json({ error: '주문 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
