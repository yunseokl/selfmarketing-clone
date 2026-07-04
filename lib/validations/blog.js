import { z } from 'zod';

// 포스팅 수 → 가격(원). 서버에서 이 표로만 금액을 계산하며 클라이언트 값은 신뢰하지 않습니다.
export const BLOG_PACKAGE_PRICES = {
    5: 150000,
    10: 280000,
    20: 520000,
};

export const createBlogCampaignSchema = z.object({
    placeName: z.string().min(1, '업체명을 입력해주세요.'),
    placeUrl: z.string().url('올바른 URL 형식이 아닙니다.'),
    keyword: z.string().min(1, '대표 키워드를 입력해주세요.'),
    postCount: z.number().refine(
        (value) => Object.prototype.hasOwnProperty.call(BLOG_PACKAGE_PRICES, value),
        '패키지를 선택해주세요.'
    ),
    requirement: z.string().optional(),
});
