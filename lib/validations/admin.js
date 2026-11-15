import { z } from 'zod';

// User.balance 는 DB 에서 Int(32비트)라 20억으로 상한을 둡니다.
export const MAX_BALANCE = 2_000_000_000;

// 사용자 업데이트 스키마
export const updateUserSchema = z.object({
    balance: z.number({ invalid_type_error: '잔액은 숫자여야 합니다.' })
        .int('잔액은 정수여야 합니다.')
        .min(0, '잔액은 0 이상이어야 합니다.')
        .max(MAX_BALANCE, '잔액은 20억 원 이하여야 합니다.')
        .optional(),
    role: z.enum(['member', 'admin'], {
        errorMap: () => ({ message: '유효하지 않은 역할입니다.' })
    }).optional(),
});

// 광고 상태 업데이트 스키마
export const updateAdStatusSchema = z.object({
    status: z.enum(['pending', 'active', 'completed', 'refunded'], {
        errorMap: () => ({ message: '유효하지 않은 상태입니다.' })
    }),
});
