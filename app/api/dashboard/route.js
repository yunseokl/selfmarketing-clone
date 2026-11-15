import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { kstDateKey, recordedPoints, summarize } from '@/lib/rank-log';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 24 * 60 * 60 * 1000;

// 최근 7일(KST)의 날짜별 "주문한 일일 목표 유입" 합계.
// 실제 유입 실적은 측정하지 않으므로, 그날 진행 중이던 광고의 목표치만 더합니다.
// (예전에는 목표치에 임의 계수를 곱해 '방문·클릭' 실적처럼 보여 줬는데 사실이 아니어서 제거)
function buildWeeklyPlan(ads, now = new Date()) {
    const todayKey = kstDateKey(now);
    const todayStartUtc = new Date(`${todayKey}T00:00:00+09:00`).getTime();
    const plan = [];
    for (let i = 6; i >= 0; i--) {
        const dayStart = todayStartUtc - i * DAY_MS;
        const dayEnd = dayStart + DAY_MS;
        const planned = ads.reduce((sum, ad) => {
            const started = new Date(ad.startDate).getTime() < dayEnd;
            const notEnded = new Date(ad.endDate).getTime() > dayStart;
            return started && notEnded ? sum + ad.dailyGoal : sum;
        }, 0);
        const weekday = new Date(dayStart + 9 * 60 * 60 * 1000).getUTCDay();
        plan.push({ name: DAY_NAMES[weekday], date: kstDateKey(new Date(dayStart)), planned });
    }
    return plan;
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

        const adSelect = { id: true, dailyGoal: true, startDate: true, endDate: true, status: true };
        // 환불된 광고는 목표 유입에서 제외합니다.
        const countedStatuses = ['pending', 'active', 'expired', 'completed'];

        const [
            placeAds,
            shoppingAds,
            totalPlaceAdsCount,
            totalShoppingAdsCount,
            trackings,
            keywordCount,
            recentNotifications,
        ] = await Promise.all([
            prisma.placeAd.findMany({ where: { userId: user.id, status: { in: countedStatuses } }, select: adSelect }),
            prisma.shoppingAd.findMany({ where: { userId: user.id, status: { in: countedStatuses } }, select: adSelect }),
            prisma.placeAd.count({ where: { userId: user.id } }),
            prisma.shoppingAd.count({ where: { userId: user.id } }),
            prisma.rankTracking.findMany({
                where: { userId: user.id },
                select: { keyword: true, rankHistory: true },
            }),
            prisma.keywordSearch.count({ where: { userId: user.id } }),
            prisma.notification.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
                take: 5,
            }),
        ]);

        const now = new Date();
        const isRunning = (ad) => ad.status === 'active' && new Date(ad.endDate) > now;
        const activePlaceAds = placeAds.filter(isRunning);
        const activeShoppingAds = shoppingAds.filter(isRunning);

        const activeAds = {
            place: activePlaceAds.length,
            shopping: activeShoppingAds.length,
            total: activePlaceAds.length + activeShoppingAds.length,
        };

        const todayGoal = [...activePlaceAds, ...activeShoppingAds].reduce((sum, ad) => sum + ad.dailyGoal, 0);
        const weeklyPlan = buildWeeklyPlan([...placeAds, ...shoppingAds], now);

        // 순위 기록장: 회원이 직접 적은 최근 기록 중 가장 높은 순위
        const trackingCount = trackings.length;
        const trackingBest = trackings
            .map((t) => ({ keyword: t.keyword, currentRank: summarize(recordedPoints(t.rankHistory)).currentRank }))
            .filter((t) => typeof t.currentRank === 'number')
            .sort((a, b) => a.currentRank - b.currentRank)[0] || null;

        const onboarding = {
            hasAd: (totalPlaceAdsCount + totalShoppingAdsCount) > 0,
            hasKeyword: keywordCount > 0,
            hasTracking: trackingCount > 0,
        };

        return NextResponse.json({
            balance: user.balance,
            activeAds,
            todayGoal,
            trackingCount,
            trackingBest,
            weeklyPlan,
            onboarding,
            recentNotifications,
        });
    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        return NextResponse.json({ error: '대시보드 정보 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
