import { z } from 'zod';

const allowedDomains = {
    shopping: ['smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com'],
    place: ['map.naver.com', 'place.naver.com', 'pcmap.place.naver.com', 'm.place.naver.com', 'naver.me'],
};

function isAllowedNaverUrl(type, value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        return allowedDomains[type].some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

// 직접 확인한 순위: 1~1000위, null 은 "순위권 밖(찾지 못함)"
const rankValue = z.number({ invalid_type_error: '순위는 숫자로 입력해주세요.' })
    .int('순위는 정수로 입력해주세요.')
    .min(1, '순위는 1위 이상이어야 합니다.')
    .max(1000, '1000위 밖은 "순위권 밖"으로 기록해주세요.')
    .nullable();

export const createRankTrackingSchema = z.object({
    type: z.enum(['shopping', 'place']),
    url: z.string().url('올바른 URL 형식이 아닙니다.').max(2000, 'URL이 너무 깁니다.'),
    name: z.string().trim().max(80, '이름은 80자 이하로 입력해주세요.').optional(),
    image: z.string().url('이미지 URL 형식이 올바르지 않습니다.').max(2000).optional().or(z.literal('')),
    keyword: z.string().trim().min(1, '키워드를 입력해주세요.').max(40, '키워드는 40자 이하로 입력해주세요.'),
    // 등록할 때 오늘 확인한 순위를 함께 적을 수 있습니다(선택).
    rank: rankValue.optional(),
}).superRefine((data, ctx) => {
    if (!isAllowedNaverUrl(data.type, data.url)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['url'],
            message: data.type === 'shopping'
                ? '네이버 쇼핑 URL만 등록할 수 있습니다.'
                : '네이버 플레이스 URL만 등록할 수 있습니다.',
        });
    }
});

// 순위 기록(추가·수정) 또는 특정 날짜 기록 삭제
export const recordRankSchema = z.object({
    id: z.string().min(1, '순위 기록장 항목 ID가 필요합니다.').max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다.').optional(),
    rank: rankValue.optional(),
    remove: z.boolean().optional(),
}).refine((data) => data.remove === true || data.rank !== undefined, {
    message: '기록할 순위를 입력해주세요.',
    path: ['rank'],
});
