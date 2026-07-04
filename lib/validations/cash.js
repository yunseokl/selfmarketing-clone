import { z } from 'zod';

// 캐시 충전 신청 스키마
export const createCashChargeSchema = z.object({
    amount: z.number({ invalid_type_error: '충전 금액을 입력해주세요.' })
        .int('충전 금액은 정수여야 합니다.')
        .min(10000, '최소 충전 금액은 10,000원입니다.')
        .max(5000000, '최대 충전 금액은 5,000,000원입니다.'),
    depositorName: z.string().min(1, '입금자명을 입력해주세요.').max(50, '입금자명이 너무 깁니다.'),
});

// 관리자 충전 신청 처리 스키마
export const processCashChargeSchema = z.object({
    action: z.enum(['approve', 'reject'], {
        errorMap: () => ({ message: '유효하지 않은 처리 액션입니다.' })
    }),
});

// 충전 금액별 보너스 계산: 30만원 이상 +3%, 50만원 이상 +5%, 100만원 이상 +10%
export function calculateChargeBonus(amount) {
    if (amount >= 1000000) return Math.floor(amount * 0.10);
    if (amount >= 500000) return Math.floor(amount * 0.05);
    if (amount >= 300000) return Math.floor(amount * 0.03);
    return 0;
}
