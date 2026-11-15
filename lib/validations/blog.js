import { z } from 'zod';

// 포스팅 수 → 가격(원). 서버에서 이 표로만 금액을 계산하며 클라이언트 값은 신뢰하지 않습니다.
export const BLOG_PACKAGE_PRICES = {
    5: 150000,
    10: 280000,
    20: 520000,
};

// 허용 도메인: 정확히 일치하거나 그 하위 도메인 (smartstore.naver.com.evil.com 같은 우회 차단)
export const PLACE_URL_DOMAINS = [
    'map.naver.com',
    'place.naver.com',
    'pcmap.place.naver.com',
    'm.place.naver.com',
    'naver.me',
];

export function isAllowedPlaceUrl(value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
        return PLACE_URL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

export const createBlogCampaignSchema = z.object({
    placeName: z.string().trim().min(1, '업체명을 입력해주세요.').max(100, '업체명은 100자 이하로 입력해주세요.'),
    placeUrl: z.string().trim()
        .url('올바른 URL 형식이 아닙니다.')
        .max(2000, 'URL이 너무 깁니다.')
        .refine(isAllowedPlaceUrl, '네이버 플레이스 URL(http/https)만 허용됩니다.'),
    keyword: z.string().trim().min(1, '대표 키워드를 입력해주세요.').max(100, '키워드는 100자 이하로 입력해주세요.'),
    postCount: z.number().refine(
        (value) => Object.prototype.hasOwnProperty.call(BLOG_PACKAGE_PRICES, value),
        '패키지를 선택해주세요.'
    ),
    requirement: z.string().max(2000, '요청사항은 2000자 이하로 입력해주세요.').optional(),
});
