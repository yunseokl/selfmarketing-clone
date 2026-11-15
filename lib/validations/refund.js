import { z } from 'zod';

export const REFUND_MEDIA_TYPES = ['naver_sa', 'naver_gfa', 'kakao', 'google', 'meta', 'coupang'];

// RefundRequest.monthlySpend 는 DB 에서 Int(32비트) 라 2,147,483,647 을 넘으면 저장 시 500 이 납니다.
// 현실적인 월 광고비 상한(100억)보다 DB 컬럼 한계가 더 작으므로 DB 한계를 상한으로 씁니다.
export const MAX_MONTHLY_SPEND = 2_147_483_647;

export const createRefundRequestSchema = z.object({
    mediaType: z.enum(REFUND_MEDIA_TYPES, {
        errorMap: () => ({ message: '광고 매체를 선택해주세요.' }),
    }),
    accountId: z.string().trim().min(1, '광고 계정 ID를 입력해주세요.').max(100, '광고 계정 ID는 100자 이하로 입력해주세요.'),
    monthlySpend: z.number({ invalid_type_error: '월 광고비를 숫자로 입력해주세요.' })
        .int('월 광고비는 정수여야 합니다.')
        .min(100000, '월 광고비는 최소 100,000원 이상이어야 합니다.')
        .max(MAX_MONTHLY_SPEND, '월 광고비가 너무 큽니다.'),
    contact: z.string().trim().min(1, '연락처를 입력해주세요.').max(100, '연락처는 100자 이하로 입력해주세요.'),
    memo: z.string().max(1000, '메모는 1000자 이하로 입력해주세요.').optional(),
});
