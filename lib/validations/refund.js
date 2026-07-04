import { z } from 'zod';

export const REFUND_MEDIA_TYPES = ['naver_sa', 'naver_gfa', 'kakao', 'google', 'meta', 'coupang'];

export const createRefundRequestSchema = z.object({
    mediaType: z.enum(REFUND_MEDIA_TYPES, {
        errorMap: () => ({ message: '광고 매체를 선택해주세요.' }),
    }),
    accountId: z.string().min(1, '광고 계정 ID를 입력해주세요.'),
    monthlySpend: z.number().min(100000, '월 광고비는 최소 100,000원 이상이어야 합니다.'),
    contact: z.string().min(1, '연락처를 입력해주세요.'),
    memo: z.string().optional(),
});
