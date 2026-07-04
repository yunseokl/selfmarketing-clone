import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { applyDailyUpdate, kstDateKey, parseHistory } from '@/lib/rank-refresh';

// 스케줄러(GitHub Actions 등)가 매일 호출하는 배치 엔드포인트 — 세션이 아닌 CRON_SECRET로 인증합니다.
export const dynamic = 'force-dynamic';

// GET - 전체 사용자의 순위추적 항목 중 오늘(KST) 스냅샷이 없는 것을 일괄 갱신.
// 사용자가 접속하지 않아도 순위 이력이 매일 쌓이고 급변 알림이 발송되도록 합니다.
export async function GET(request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return NextResponse.json(
            { error: 'CRON_SECRET이 설정되지 않아 비활성화되어 있습니다.' },
            { status: 503 }
        );
    }

    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const today = kstDateKey();
    const trackings = await prisma.rankTracking.findMany({
        orderBy: { createdAt: 'asc' }
    });

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const tracking of trackings) {
        const history = parseHistory(tracking.rankHistory);
        const last = history[history.length - 1];

        if (last && last.date === today) {
            skipped += 1;
            continue;
        }

        // 한 항목의 실패(외부 조회 오류 등)가 나머지 갱신을 막지 않도록 개별 처리합니다.
        try {
            await applyDailyUpdate(tracking, today);
            updated += 1;
        } catch (error) {
            console.error(`Rank snapshot failed (tracking ${tracking.id}):`, error);
            failed += 1;
        }
    }

    return NextResponse.json({ date: today, total: trackings.length, updated, skipped, failed });
}
