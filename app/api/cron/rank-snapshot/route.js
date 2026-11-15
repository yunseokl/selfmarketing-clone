import { NextResponse } from 'next/server';

// 스케줄러(GitHub Actions)가 매일 호출하던 순위 스냅샷 엔드포인트.
//
// 예전에는 여기서 전체 회원의 순위를 "재조회"해 이력을 쌓았지만, 순위를 조회할 공식 경로가
// 없어졌습니다(네이버 쇼핑 검색 API 2026-07-31 종료, 플레이스 순위는 공식 API 없음).
// 조회가 안 될 때 임의의 숫자를 만들어 기록하고 "순위 상승/하락" 알림까지 보내던 동작은
// 사실이 아닌 정보를 회원에게 보여 주는 것이어서 중단했습니다. 순위는 이제 회원이 순위 기록장에
// 직접 적습니다. 워크플로가 실패하지 않도록 인증만 확인하고 아무 것도 하지 않습니다.
export const dynamic = 'force-dynamic';

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

    return NextResponse.json({
        updated: 0,
        skipped: true,
        reason: '순위 일괄 자동 조회는 하지 않습니다. 플레이스는 회원이 조회를 누를 때만 조회하고, 쇼핑은 회원이 직접 기록합니다.',
    });
}
