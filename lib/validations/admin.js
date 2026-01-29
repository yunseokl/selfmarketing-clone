import { z } from 'zod';

// 사용자 업데이트 스키마
export const updateUserSchema = z.object({
    balance: z.number().int().min(0, '잔액은 0 이상이어야 합니다.').optional(),
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
