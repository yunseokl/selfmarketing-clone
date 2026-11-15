import { NextResponse } from 'next/server';
import { competitorKeywordsSchema } from '@/lib/validations/place-insight';
import { getCurrentUser, readJson } from '@/lib/place-api';
import {
    getPlaceService, placeLookupConfig, placeErrorResponse,
    PLACE_LOOKUP_DISABLED, PLACE_RATE_LIMITED,
} from '@/lib/place-service';

export const dynamic = 'force-dynamic';

// POST - 여러 매장(최대 5곳)의 대표키워드 { placeIds: [] }
// 상위 매장들이 어떤 대표키워드를 등록했는지 비교할 때 씁니다.
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }
        if (!placeLookupConfig().enabled) {
            return NextResponse.json(PLACE_LOOKUP_DISABLED.body, { status: PLACE_LOOKUP_DISABLED.status });
        }

        const validation = competitorKeywordsSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return NextResponse.json({ error: '조회할 매장을 확인해주세요.' }, { status: 400 });
        }

        const { client, limits } = getPlaceService();
        if (!limits.keywords.allow(userCheck.user.id)) {
            return NextResponse.json(PLACE_RATE_LIMITED.body, { status: PLACE_RATE_LIMITED.status });
        }

        const items = [];
        let failed = 0;
        for (const placeId of [...new Set(validation.data.placeIds)]) {
            try {
                const { value } = await client.getKeywords(placeId);
                items.push(value);
            } catch (error) {
                // 조회가 멈춘 상태면 나머지도 실패하므로 바로 알립니다. 한 곳만 못 읽은 경우는 건너뜁니다.
                if (['BLOCKED', 'PAUSED', 'DAILY_LIMIT'].includes(error?.code)) throw error;
                failed += 1;
            }
        }

        return NextResponse.json({ items, failed });
    } catch (error) {
        const mapped = placeErrorResponse(error);
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
        console.error('Error loading competitor keywords:', error);
        return NextResponse.json({ error: '대표키워드 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
