import { z } from 'zod';

// 한글·영문·숫자와 일부 기호만 허용 (태그·스크립트 문자 차단)
const KEYWORD_PATTERN = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ\s.+&%'-]+$/;

const keywordText = z.string()
    .trim()
    .min(2, '키워드는 2자 이상 입력해주세요.')
    .max(30, '키워드는 30자 이하로 입력해주세요.')
    .regex(KEYWORD_PATTERN, '키워드에는 한글, 영문, 숫자만 사용할 수 있습니다.');

export const MAX_COMPARE_KEYWORDS = 4;

export const keywordTrendSchema = z.object({
    keyword: keywordText,
    compare: z.array(keywordText)
        .max(MAX_COMPARE_KEYWORDS, `비교 키워드는 최대 ${MAX_COMPARE_KEYWORDS}개까지 입력할 수 있습니다.`)
        .optional()
        .default([]),
});

// 기준 키워드 + 비교 키워드를 중복 없이(대소문자·공백 무시) 한 줄로
export function uniqueKeywords(keyword, compare = []) {
    const seen = new Set();
    const result = [];
    for (const raw of [keyword, ...compare]) {
        const value = raw.trim().replace(/\s+/g, ' ');
        const key = value.toLowerCase().replace(/\s+/g, '');
        if (!value || seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
