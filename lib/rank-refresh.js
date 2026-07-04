import prisma from '@/lib/prisma';
import { resolveTrackedRank } from '@/lib/naver';
import { createNotification } from '@/lib/notify';

// 히스토리 보관 개수(약 3개월치 일별 스냅샷)
export const MAX_HISTORY = 90;
// 순위가 이 계단 이상 변동하면 알림을 생성합니다.
export const NOTIFY_THRESHOLD = 5;

// KST 기준 YYYY-MM-DD — 히스토리 스냅샷의 하루 단위 키
export function kstDateKey(date = new Date()) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

export function parseHistory(rankHistory) {
    try {
        const parsed = rankHistory ? JSON.parse(rankHistory) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// 하루가 지난 항목을 재조회해 히스토리에 하루치 스냅샷을 append 합니다.
// 순위가 크게 바뀌면 알림을 남겨, 접속만 해도 추이가 쌓이도록 합니다.
// 사용자 GET(lazy 갱신)과 cron 스냅샷이 같은 로직을 공유합니다.
export async function applyDailyUpdate(tracking, today) {
    const resolved = await resolveTrackedRank(tracking);
    const newRank = resolved.rank;
    const prevRank = tracking.currentRank ?? null;
    const history = parseHistory(tracking.rankHistory);
    const nextHistory = [...history, { date: today, rank: newRank }].slice(-MAX_HISTORY);

    const updated = await prisma.rankTracking.update({
        where: { id: tracking.id },
        data: {
            previousRank: prevRank,
            currentRank: newRank,
            rankHistory: JSON.stringify(nextHistory),
        }
    });

    if (prevRank != null && newRank != null && Math.abs(newRank - prevRank) >= NOTIFY_THRESHOLD) {
        const rising = newRank < prevRank;
        await createNotification(tracking.userId, {
            type: 'rank',
            title: `'${tracking.keyword}' 순위 ${rising ? '상승' : '하락'}! ${prevRank}위 → ${newRank}위`,
            message: `${tracking.name}의 '${tracking.keyword}' 키워드 순위가 ${prevRank}위에서 ${newRank}위로 ${rising ? '올랐습니다.' : '내려갔습니다.'}`,
            link: tracking.type === 'shopping' ? '/dashboard/ranking/shopping' : '/dashboard/ranking/place',
        });
    }

    return { ...updated, source: resolved.source };
}
