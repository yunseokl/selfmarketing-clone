import { z } from 'zod';

export const createPlaceAdSchema = z.object({
    placeUrl: z.string().url('올바른 URL 형식이 아닙니다.').refine(
        (url) => {
            try {
                const parsed = new URL(url);
                return ['map.naver.com', 'place.naver.com', 'pcmap.place.naver.com', 'm.place.naver.com'].some(
                    domain => parsed.hostname.includes(domain)
                );
            } catch {
                return false;
            }
        },
        '네이버 플레이스 URL만 허용됩니다.'
    ),
    placeName: z.string().min(1, '업체명을 입력해주세요.'),
    placeImage: z.string().optional(),
    keyword: z.string().min(1, '키워드를 입력해주세요.'),
    serviceType: z.string().optional(),
    pricePerClick: z.number().optional(),
    dailyGoal: z.number().min(10, '일일 목표는 최소 10 이상이어야 합니다.').max(10000),
    duration: z.number().min(1).max(365),
});

// status는 사용자 임의 변경을 막기 위해 제외 — 취소/환불은 DELETE, 상태 관리는 관리자 라우트에서 수행
export const updatePlaceAdSchema = z.object({
    placeName: z.string().min(1).optional(),
    keyword: z.string().min(1).optional(),
    message: z.string().optional(),
});
