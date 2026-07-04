import { z } from 'zod';

export const analyzeKeywordSchema = z.object({
    keyword: z.string().trim().min(2, '키워드는 2자 이상 입력해주세요.').max(40, '키워드는 40자 이하로 입력해주세요.'),
});
