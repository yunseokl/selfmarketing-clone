import { z } from 'zod';

export const inquiryCategories = ['general', 'payment', 'ad', 'coupang', 'refund', 'etc'];

export const createInquirySchema = z.object({
    category: z.enum(inquiryCategories, {
        errorMap: () => ({ message: '올바른 문의 카테고리를 선택해주세요.' })
    }),
    title: z.string().trim().min(2, '제목은 2자 이상 입력해주세요.').max(100, '제목은 100자 이하로 입력해주세요.'),
    content: z.string().trim().min(5, '내용은 5자 이상 입력해주세요.').max(2000, '내용은 2000자 이하로 입력해주세요.'),
});
