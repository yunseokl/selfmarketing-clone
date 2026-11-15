import { z } from 'zod';

const placeId = z.string().regex(/^\d{5,12}$/, '플레이스 ID가 올바르지 않습니다.');

export const MAX_SAVED_PLACES = 5;
export const MAX_COMPETITOR_KEYWORDS = 5;

// 매장 조회: 플레이스 주소 또는 숫자 ID
export const placeLookupSchema = z.object({
    url: z.string().trim().min(1, '플레이스 주소 또는 ID를 입력해주세요.').max(500, '주소가 너무 깁니다.'),
});

// 키워드 순위 조회: 매장+키워드를 직접 주거나, 순위 기록장 항목(trackingId)을 지정합니다.
export const placeRankSchema = z.union([
    z.object({
        trackingId: z.string().min(1).max(40),
    }).strict(),
    z.object({
        placeId,
        keyword: z.string().trim().min(1, '키워드를 입력해주세요.').max(40, '키워드는 40자 이하로 입력해주세요.'),
        deep: z.boolean().optional(),
        record: z.boolean().optional(),
    }).strict(),
]);

export const savePlaceSchema = z.object({ placeId });

export const competitorKeywordsSchema = z.object({
    placeIds: z.array(placeId).min(1).max(MAX_COMPETITOR_KEYWORDS),
});

// 경쟁 매장 GEO·AEO 비교: 매장 화면을 1곳씩 따로 읽으므로 3곳까지만 받습니다.
export const MAX_GEO_RIVALS = 3;

export const geoRivalsSchema = z.object({
    placeIds: z.array(placeId).min(1).max(MAX_GEO_RIVALS),
});
