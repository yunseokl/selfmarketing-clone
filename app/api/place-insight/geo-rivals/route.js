import { NextResponse } from 'next/server';
import { geoRivalsSchema } from '@/lib/validations/place-insight';
import { getCurrentUser, readJson } from '@/lib/place-api';
import { summarizeRival } from '@/lib/place-geo';
import {
    getPlaceService, placeLookupConfig, placeErrorResponse,
    PLACE_LOOKUP_DISABLED, PLACE_RATE_LIMITED,
} from '@/lib/place-service';

export const dynamic = 'force-dynamic';

// 경쟁 매장 화면은 1곳씩, 새로 받을 때마다 2초 이상 쉬었다가 다음 매장을 읽습니다(저장된 결과는 바로 씁니다).
const RIVAL_GAP_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST - 검색 상위 매장(최대 3곳)의 GEO·AEO 점수 { placeIds: [] }
// 내 매장과 같은 기준(매장 화면 정보만)으로 계산해 비교합니다. 매장 1곳당 네이버 요청은 1건(대표키워드가 화면에 없으면 2건)이고 30분 동안 저장해 다시 씁니다.
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }
        if (!placeLookupConfig().enabled) {
            return NextResponse.json(PLACE_LOOKUP_DISABLED.body, { status: PLACE_LOOKUP_DISABLED.status });
        }

        const validation = geoRivalsSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return NextResponse.json({ error: '비교할 매장을 확인해주세요.' }, { status: 400 });
        }

        const { client, limits } = getPlaceService();
        // 상위 매장 대표키워드 조회와 같은 한도를 함께 씁니다.
        if (!limits.keywords.allow(userCheck.user.id)) {
            return NextResponse.json(PLACE_RATE_LIMITED.body, { status: PLACE_RATE_LIMITED.status });
        }

        const items = [];
        let failed = 0;
        let waitBeforeNext = false;
        for (const placeId of [...new Set(validation.data.placeIds)]) {
            if (waitBeforeNext) await sleep(RIVAL_GAP_MS);
            try {
                const { value, cached } = await client.getPlace(placeId);
                items.push(summarizeRival(value));
                waitBeforeNext = !cached;
            } catch (error) {
                if (['BLOCKED', 'PAUSED', 'DAILY_LIMIT'].includes(error?.code)) throw error;
                failed += 1;
                waitBeforeNext = true;
            }
        }

        return NextResponse.json({ items, failed });
    } catch (error) {
        const mapped = placeErrorResponse(error);
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
        console.error('Error loading rival GEO/AEO:', error);
        return NextResponse.json({ error: '경쟁 매장 GEO·AEO 비교 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
