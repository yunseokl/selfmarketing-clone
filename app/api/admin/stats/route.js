import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';

// GET - 관리자 통계
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        // Get all stats
        const [
            totalOrders,
            pendingOrders,
            activeOrders,
            completedOrders,
            totalUsers,
            revenueData
        ] = await Promise.all([
            prisma.shoppingAd.count(),
            prisma.shoppingAd.count({ where: { status: 'pending' } }),
            prisma.shoppingAd.count({ where: { status: 'active' } }),
            prisma.shoppingAd.count({ where: { status: 'completed' } }),
            prisma.user.count(),
            prisma.shoppingAd.aggregate({
                _sum: { totalCost: true },
                where: { status: { not: 'refunded' } }
            })
        ]);

        return NextResponse.json({
            totalOrders,
            pendingOrders,
            activeOrders,
            completedOrders,
            totalUsers,
            totalRevenue: revenueData._sum.totalCost || 0
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        return NextResponse.json({ error: '통계 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
