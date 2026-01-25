import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// GET - 플레이스 광고 주문 목록 (관리자용)
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

        const orders = await prisma.placeAd.findMany({
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
        console.error('Error fetching place orders:', error);
        return NextResponse.json({ error: '주문 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
