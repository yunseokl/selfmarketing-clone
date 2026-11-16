import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { kstDateKey } from '@/lib/rank-log';
import { parseMetrics, upsertMetric, metricChange } from '@/lib/place-history';
import { placeLookupSchema } from '@/lib/validations/place-insight';
import { mentionTerms } from '@/lib/place-keywords';
import { getCurrentUser, readJson, savedPlaceToClient } from '@/lib/place-api';
import {
    getPlaceService, placeLookupConfig, placeLookupStatus, placeErrorResponse,
    PLACE_LOOKUP_DISABLED, PLACE_RATE_LIMITED,
} from '@/lib/place-service';

// 로그인 세션을 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// 플레이스 분석 — 네이버 플레이스 공개 화면의 데이터를 읽어 매장 요약·숨은 대표키워드·운영 정보·리뷰 활동을 보여 줍니다.
// 매장 1곳 분석에 네이버 요청은 최대 2건(매장 화면 1건 + 활동·키워드 언급 묶음 1건)이고, 각각 30분 동안 저장해 다시 씁니다.
// 조회 방식과 한계는 lib/naver-place.js, 요청을 아끼는 장치는 lib/place-gate.js 참고.

// GET - 기능 상태와 저장한 내 매장 목록
export async function GET() {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const saved = await prisma.savedPlace.findMany({
            where: { userId: userCheck.user.id },
            orderBy: { updatedAt: 'desc' },
        });
        const status = placeLookupStatus();

        return NextResponse.json({
            enabled: status.enabled,
            pausedUntil: status.pausedUntil,
            saved: saved.map(savedPlaceToClient),
        });
    } catch (error) {
        console.error('Error loading place insight:', error);
        return NextResponse.json({ error: '플레이스 분석 정보를 불러오지 못했습니다.' }, { status: 500 });
    }
}

// POST - 매장 조회 { url }
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }
        if (!placeLookupConfig().enabled) {
            return NextResponse.json(PLACE_LOOKUP_DISABLED.body, { status: PLACE_LOOKUP_DISABLED.status });
        }

        const validation = placeLookupSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }

        const { client, limits } = getPlaceService();
        if (!limits.place.allow(userCheck.user.id)) {
            return NextResponse.json(PLACE_RATE_LIMITED.body, { status: PLACE_RATE_LIMITED.status });
        }

        const placeId = await client.resolveInput(validation.data.url);
        const { value: place, fetchedAt, cached } = await client.getPlace(placeId);

        // 리뷰·소식 활동은 따로 받습니다. 여기서 실패해도 매장 정보는 그대로 보여 줍니다.
        // 같은 요청에 "업종·등록 키워드 낱말이 블로그 후기에 몇 번 나오는지"도 함께 물어, 추천 키워드의 근거로 씁니다.
        let activity = null;
        let activityError = null;
        try {
            activity = (await client.getActivity(placeId, { mentionTerms: mentionTerms(place) })).value;
        } catch (error) {
            const mapped = placeErrorResponse(error);
            if (!mapped) console.error('Error loading place activity:', error);
            activityError = mapped?.body?.error || '리뷰·소식 활동을 불러오지 못했습니다.';
        }

        // 내 매장으로 저장해 둔 곳이면 오늘 지표를 이력에 남기고 지난 조회와 비교합니다.
        let saved = false;
        let change = null;
        const row = await prisma.savedPlace.findUnique({
            where: { userId_placeId: { userId: userCheck.user.id, placeId } },
        });
        if (row) {
            const points = upsertMetric(parseMetrics(row.metrics), {
                date: kstDateKey(new Date(fetchedAt)),
                visitorReviews: place.visitorReviews,
                blogReviews: place.blogReviews,
                score: place.visitorScore,
            });
            await prisma.savedPlace.update({
                where: { id: row.id },
                data: { name: place.name, category: place.category || null, metrics: JSON.stringify(points) },
            });
            saved = true;
            change = metricChange(points);
        }

        return NextResponse.json({ place, activity, activityError, fetchedAt, cached, saved, change });
    } catch (error) {
        const mapped = placeErrorResponse(error);
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
        console.error('Error looking up place:', error);
        return NextResponse.json({ error: '플레이스 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
