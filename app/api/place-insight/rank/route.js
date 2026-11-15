import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { kstDateKey, recordedPoints, upsertPoint, summarize, MAX_TRACKINGS_PER_TYPE } from '@/lib/rank-log';
import { parsePlaceInput, placeHomeUrl, DEFAULT_DEPTH, MAX_RANK } from '@/lib/naver-place';
import { placeRankSchema } from '@/lib/validations/place-insight';
import { getCurrentUser, readJson } from '@/lib/place-api';
import {
    getPlaceService, placeLookupConfig, placeErrorResponse,
    PLACE_LOOKUP_DISABLED, PLACE_RATE_LIMITED,
} from '@/lib/place-service';

export const dynamic = 'force-dynamic';

// 플레이스 키워드 순위 조회 — 네이버 플레이스 목록에서 내 매장이 몇 번째인지 실제로 찾아봅니다.
// record 를 켜거나 순위 기록장 항목(trackingId)으로 부르면 오늘 순위를 기록장에 '실제 조회'로 남깁니다.

function samePlace(url, placeId) {
    try {
        return parsePlaceInput(url).placeId === placeId;
    } catch {
        return false;
    }
}

// 조회 결과를 순위 기록장에 남깁니다. 순위를 끝까지 확인하지 못한 경우에는 기록하지 않습니다.
async function recordRank({ userId, tracking, placeId, keyword, result, client }) {
    // 한 건도 받지 못한 조회는 '순위권 밖'인지 알 수 없어 기록하지 않습니다.
    if (result.scanned === 0) {
        return { saved: false, reason: 'NO_RESULTS' };
    }
    const complete = result.status === 'found' || result.status === 'not_listed' || result.scanned >= MAX_RANK;
    if (!complete) {
        return { saved: false, reason: 'NOT_IN_RANGE' };
    }
    const rank = result.status === 'found' ? result.rank : null;
    const date = kstDateKey(new Date(result.fetchedAt));

    let row = tracking;
    if (!row) {
        const candidates = await prisma.rankTracking.findMany({ where: { userId, type: 'place', keyword } });
        row = candidates.find((candidate) => samePlace(candidate.url, placeId)) || null;
    }

    if (!row) {
        const count = await prisma.rankTracking.count({ where: { userId, type: 'place' } });
        if (count >= MAX_TRACKINGS_PER_TYPE) {
            return { saved: false, reason: 'LIMIT' };
        }
        const name = result.target?.name || (await client.getKeywords(placeId)).value.name || '내 매장';
        const points = upsertPoint([], { date, rank, src: 'live' });
        const created = await prisma.rankTracking.create({
            data: {
                userId,
                type: 'place',
                url: placeHomeUrl(placeId),
                name,
                keyword,
                currentRank: rank,
                rankHistory: JSON.stringify(points),
            },
        });
        return { saved: true, created: true, trackingId: created.id, date, rank };
    }

    const points = upsertPoint(recordedPoints(row.rankHistory), { date, rank, src: 'live' });
    const summary = summarize(points);
    await prisma.rankTracking.update({
        where: { id: row.id },
        data: {
            currentRank: summary.currentRank,
            previousRank: summary.previousRank,
            rankHistory: JSON.stringify(points),
        },
    });
    return { saved: true, created: false, trackingId: row.id, date, rank };
}

export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }
        if (!placeLookupConfig().enabled) {
            return NextResponse.json(PLACE_LOOKUP_DISABLED.body, { status: PLACE_LOOKUP_DISABLED.status });
        }

        const validation = placeRankSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return NextResponse.json({ error: '조회할 매장과 키워드를 확인해주세요.' }, { status: 400 });
        }
        const input = validation.data;
        const userId = userCheck.user.id;
        const { client, limits } = getPlaceService();

        let tracking = null;
        let placeId;
        let keyword;
        let depth;
        let record;

        if ('trackingId' in input) {
            tracking = await prisma.rankTracking.findFirst({
                where: { id: input.trackingId, userId, type: 'place' },
            });
            if (!tracking) {
                return NextResponse.json({ error: '순위 기록장 항목을 찾을 수 없습니다.' }, { status: 404 });
            }
            keyword = tracking.keyword;
            // 기록으로 남길 값이라 1,000위까지 확인합니다.
            depth = MAX_RANK;
            record = true;
        } else {
            placeId = input.placeId;
            keyword = input.keyword;
            depth = input.deep ? MAX_RANK : DEFAULT_DEPTH;
            record = input.record === true;
        }

        const limiter = depth > DEFAULT_DEPTH ? limits.deepRank : limits.rank;
        if (!limiter.allow(userId)) {
            return NextResponse.json(PLACE_RATE_LIMITED.body, { status: PLACE_RATE_LIMITED.status });
        }

        if (tracking) {
            placeId = await client.resolveInput(tracking.url);
        }

        const result = await client.getRank({ keyword, placeId, depth });
        const recorded = record
            ? await recordRank({ userId, tracking, placeId, keyword, result, client })
            : null;

        return NextResponse.json({ result, recorded });
    } catch (error) {
        const mapped = placeErrorResponse(error);
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
        console.error('Error looking up place rank:', error);
        return NextResponse.json({ error: '순위 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
