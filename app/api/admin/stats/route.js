import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { getDepositAccount } from '@/lib/site-config';
import { trendConfig } from '@/lib/naver-trend';
import { placeLookupStatus } from '@/lib/place-service';

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
            usedLedger,
            refundedLedger,
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
            // 총 매출 = 원장 기준 결제(use) 합계의 절댓값 − 환불(refund) 합계. 관리자 수동 조정(method='admin')은 제외.
            // 광고(쇼핑/플레이스)와 블로그 결제를 모두 포함하고, 부분 환불도 그대로 반영됩니다.
            prisma.cashTransaction.aggregate({
                _sum: { amount: true },
                where: { type: 'use', status: 'completed', OR: [{ method: null }, { method: { not: 'admin' } }] }
            }),
            prisma.cashTransaction.aggregate({
                _sum: { amount: true },
                where: { type: 'refund', status: 'completed', OR: [{ method: null }, { method: { not: 'admin' } }] }
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
            totalRevenue: Math.abs(usedLedger._sum.amount || 0) - (refundedLedger._sum.amount || 0),
            pendingCash,
            openInquiries,
            pendingBlog,
            pendingRefunds,
            // 운영자가 확인해야 할 설정 상태
            system: {
                depositAccountConfigured: getDepositAccount().configured,
                keywordTrendConfigured: Boolean(trendConfig()),
                placeLookup: placeLookupStatus(),
            }
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        return NextResponse.json({ error: '통계 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
