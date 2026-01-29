import { z } from 'zod';

export const createShoppingAdSchema = z.object({
    productUrl: z.string().url('올바른 URL 형식이 아닙니다.').refine(
        (url) => {
            try {
                const parsed = new URL(url);
                return ['smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com'].some(
                    domain => parsed.hostname.includes(domain)
                );
            } catch {
                return false;
            }
        },
        '네이버 쇼핑 URL만 허용됩니다.'
    ),
    productName: z.string().optional(),
    productImage: z.string().optional(),
    keyword: z.string().min(1, '키워드를 입력해주세요.'),
    serviceType: z.string().optional(),
    pricePerClick: z.number().optional(),
    dailyGoal: z.number().min(10, '일일 목표는 최소 10 이상이어야 합니다.').max(10000),
    duration: z.number().min(1).max(365),
});

export const updateShoppingAdSchema = z.object({
    productName: z.string().min(1).optional(),
    keyword: z.string().min(1).optional(),
    status: z.enum(['active', 'paused', 'completed', 'refunded']).optional(),
    message: z.string().optional(),
});
