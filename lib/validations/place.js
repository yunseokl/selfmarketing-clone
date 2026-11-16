import { z } from 'zod';
import { AD_SERVICE_TYPES, DEFAULT_AD_SERVICE } from '../pricing.js';
import { PLACE_AD_HOSTS, isAllowedAdUrl } from '../ad-url.js';

export const createPlaceAdSchema = z.object({
    placeUrl: z.string().url('올바른 URL 형식이 아닙니다.').refine(
        (url) => isAllowedAdUrl(url, PLACE_AD_HOSTS),
        '네이버 플레이스 URL만 허용됩니다.'
    ),
    placeName: z.string().min(1, '업체명을 입력해주세요.'),
    placeImage: z.string().optional(),
    keyword: z.string().min(1, '키워드를 입력해주세요.'),
    // 단가는 서버 가격표(lib/pricing.js)로만 정합니다 — 클라이언트가 보낸 pricePerClick은 버립니다.
    serviceType: z.enum(AD_SERVICE_TYPES, {
        errorMap: () => ({ message: '유효하지 않은 광고 상품입니다.' })
    }).default(DEFAULT_AD_SERVICE),
    dailyGoal: z.number({ invalid_type_error: '일일 목표를 숫자로 입력해주세요.' })
        .int('일일 목표는 정수여야 합니다.')
        .min(10, '일일 목표는 최소 10 이상이어야 합니다.')
        .max(10000, '일일 목표는 최대 10,000까지 가능합니다.'),
    duration: z.number({ invalid_type_error: '광고 기간을 숫자로 입력해주세요.' })
        .int('광고 기간은 정수(일)여야 합니다.')
        .min(1, '광고 기간은 최소 1일입니다.')
        .max(365, '광고 기간은 최대 365일입니다.'),
});

// status는 사용자 임의 변경을 막기 위해 제외 — 취소/환불은 DELETE, 상태 관리는 관리자 라우트에서 수행
export const updatePlaceAdSchema = z.object({
    placeName: z.string().min(1).optional(),
    keyword: z.string().min(1).optional(),
    message: z.string().optional(),
});
