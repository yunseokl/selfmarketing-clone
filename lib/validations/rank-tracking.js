import { z } from 'zod';

const allowedDomains = {
    shopping: ['smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com'],
    place: ['map.naver.com', 'place.naver.com', 'pcmap.place.naver.com', 'm.place.naver.com'],
};

function isAllowedNaverUrl(type, value) {
    try {
        const parsed = new URL(value);
        return allowedDomains[type].some(domain => parsed.hostname.includes(domain));
    } catch {
        return false;
    }
}

export const createRankTrackingSchema = z.object({
    type: z.enum(['shopping', 'place']),
    url: z.string().url('올바른 URL 형식이 아닙니다.'),
    name: z.string().trim().max(80, '이름은 80자 이하로 입력해주세요.').optional(),
    image: z.string().url('이미지 URL 형식이 올바르지 않습니다.').optional().or(z.literal('')),
    keyword: z.string().trim().min(1, '키워드를 입력해주세요.').max(40, '키워드는 40자 이하로 입력해주세요.'),
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

export const refreshRankTrackingSchema = z.object({
    id: z.string().min(1, '순위추적 ID가 필요합니다.'),
});
