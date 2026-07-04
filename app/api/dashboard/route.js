import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// 문자열 시드를 0~1 사이 값으로 결정론적으로 변환 (Math.random 미사용)
// 날짜 문자열처럼 마지막 몇 글자만 달라지는 시드도 고르게 분산되도록 MD5로 해시.
function seededRatio(seed) {
    const hash = createHash('md5').update(seed).digest('hex');
    return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

// 광고별 요일 변동 계수 (0.75 ~ 1.25)
function dailyVisitCoefficient(adId, dateKey) {
    return 0.75 + seededRatio(`visit-${adId}-${dateKey}`) * 0.5;
}

// 날짜별 클릭률 계수 (0.55 ~ 0.70)
function dailyClickRatio(dateKey) {
    return 0.55 + seededRatio(`click-${dateKey}`) * 0.15;
}

function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

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

        const [
            activePlaceAds,
            activeShoppingAds,
            totalPlaceAdsCount,
            totalShoppingAdsCount,
            trackingCount,
            bestTrackingList,
            keywordCount,
            recentNotifications,
        ] = await Promise.all([
            prisma.placeAd.findMany({ where: { userId: user.id, status: 'active' }, select: { id: true, dailyGoal: true } }),
            prisma.shoppingAd.findMany({ where: { userId: user.id, status: 'active' }, select: { id: true, dailyGoal: true } }),
            prisma.placeAd.count({ where: { userId: user.id } }),
            prisma.shoppingAd.count({ where: { userId: user.id } }),
            prisma.rankTracking.count({ where: { userId: user.id } }),
            prisma.rankTracking.findMany({
                where: { userId: user.id, currentRank: { not: null } },
                orderBy: { currentRank: 'asc' },
                take: 1,
                select: { keyword: true, currentRank: true },
            }),
            prisma.keywordSearch.count({ where: { userId: user.id } }),
            prisma.notification.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
                take: 5,
            }),
        ]);

        const activeAds = {
            place: activePlaceAds.length,
            shopping: activeShoppingAds.length,
            total: activePlaceAds.length + activeShoppingAds.length,
        };

        const combinedActiveAds = [...activePlaceAds, ...activeShoppingAds];
        const todayExpectedVisits = combinedActiveAds.reduce((sum, ad) => sum + ad.dailyGoal, 0);

        const today = new Date();
        const weeklySeries = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
            const dateKey = toDateKey(date);

            let visits = 0;
            for (const ad of combinedActiveAds) {
                visits += ad.dailyGoal * dailyVisitCoefficient(ad.id, dateKey);
            }
            visits = Math.round(visits);
            const clicks = Math.round(visits * dailyClickRatio(dateKey));

            weeklySeries.push({ name: DAY_NAMES[date.getDay()], visits, clicks });
        }

        const trackingBest = bestTrackingList[0]
            ? { keyword: bestTrackingList[0].keyword, currentRank: bestTrackingList[0].currentRank }
            : null;

        const onboarding = {
            hasAd: (totalPlaceAdsCount + totalShoppingAdsCount) > 0,
            hasKeyword: keywordCount > 0,
            hasTracking: trackingCount > 0,
        };

        return NextResponse.json({
            balance: user.balance,
            activeAds,
            todayExpectedVisits,
            trackingCount,
            trackingBest,
            weeklySeries,
            onboarding,
            recentNotifications,
        });
    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        return NextResponse.json({ error: '대시보드 정보 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
