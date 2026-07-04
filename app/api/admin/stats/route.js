import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 관리자 통계
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        // Get all stats — 쇼핑광고 + 플레이스광고 두 유형을 모두 합산합니다.
        const [
            totalShoppingOrders,
            totalPlaceOrders,
            pendingShoppingOrders,
            pendingPlaceOrders,
            activeShoppingOrders,
            activePlaceOrders,
            completedShoppingOrders,
            completedPlaceOrders,
            totalUsers,
            shoppingRevenueData,
            placeRevenueData,
            pendingCash,
            openInquiries,
            pendingBlog,
            pendingRefunds
        ] = await Promise.all([
            prisma.shoppingAd.count(),
            prisma.placeAd.count(),
            prisma.shoppingAd.count({ where: { status: 'pending' } }),
            prisma.placeAd.count({ where: { status: 'pending' } }),
            prisma.shoppingAd.count({ where: { status: 'active' } }),
            prisma.placeAd.count({ where: { status: 'active' } }),
            prisma.shoppingAd.count({ where: { status: 'completed' } }),
            prisma.placeAd.count({ where: { status: 'completed' } }),
            prisma.user.count(),
            prisma.shoppingAd.aggregate({
                _sum: { totalCost: true },
                where: { status: { not: 'refunded' } }
            }),
            prisma.placeAd.aggregate({
                _sum: { totalCost: true },
                where: { status: { not: 'refunded' } }
            }),
            prisma.cashTransaction.count({ where: { status: 'pending', type: 'charge' } }),
            prisma.inquiry.count({ where: { status: 'open' } }),
            prisma.blogCampaign.count({ where: { status: 'pending' } }),
            prisma.refundRequest.count({ where: { status: 'pending' } })
        ]);

        return NextResponse.json({
            totalOrders: totalShoppingOrders + totalPlaceOrders,
            pendingOrders: pendingShoppingOrders + pendingPlaceOrders,
            activeOrders: activeShoppingOrders + activePlaceOrders,
            completedOrders: completedShoppingOrders + completedPlaceOrders,
            totalUsers,
            totalRevenue: (shoppingRevenueData._sum.totalCost || 0) + (placeRevenueData._sum.totalCost || 0),
            pendingCash,
            openInquiries,
            pendingBlog,
            pendingRefunds
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        return NextResponse.json({ error: '통계 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
