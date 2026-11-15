// CSV 내보내기 공용 함수 — 수식 주입 방지 + KST 날짜 (순수 함수, 외부 의존 없음)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 엑셀·구글시트는 = + - @ 탭 CR 로 시작하는 셀을 수식으로 해석합니다.
// 문자열 셀이 이 문자로 시작하면 앞에 작은따옴표를 붙여 텍스트로 강제합니다.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeFormula(value) {
    const text = String(value ?? '');
    return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

// 한 셀을 CSV 로 직렬화: 숫자는 그대로, 문자열은 수식 방어 후 큰따옴표 이스케이프.
export function csvCell(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `"${value}"`;
    }
    const safe = neutralizeFormula(value);
    return `"${safe.replace(/"/g, '""')}"`;
}

// BOM 포함(한글 엑셀 호환) CSV 본문 생성
export function buildCsv(headers, rows) {
    const BOM = '﻿';
    return BOM + [
        headers.map(csvCell).join(','),
        ...rows.map((row) => row.map(csvCell).join(',')),
    ].join('\n');
}

// 서버 시간대와 무관하게 한국 시간으로 표기
export function formatDateKST(date) {
    return new Date(date).toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}

export function formatDateTimeKST(date) {
    return new Date(date).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// 파일명용 KST 날짜 YYYY-MM-DD
export function kstDateStamp(date = new Date()) {
    return new Date(new Date(date).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
