import { z } from 'zod';

// 계산기 입력값은 숫자(또는 숫자 문자열)·짧은 선택값만 허용합니다.
const inputValue = z.union([z.number().finite(), z.string().max(40), z.boolean(), z.null()]);

export const MAX_MARGIN_SCENARIOS = 50;

export const saveMarginScenarioSchema = z.object({
    id: z.string().min(1).max(40).optional(),
    channel: z.enum(['smartstore', 'coupang'], {
        errorMap: () => ({ message: '판매 채널이 올바르지 않습니다.' })
    }),
    name: z.string().trim().min(1, '상품 이름을 입력해주세요.').max(40, '상품 이름은 40자 이하로 입력해주세요.'),
    input: z.record(z.string().max(30), inputValue).refine(
        (value) => Object.keys(value).length <= 40,
        '저장할 입력값이 너무 많습니다.'
    ),
});
