// 순위 기록장 — 실제로 확인한 순위만 날짜별로 쌓는 순수 함수 모음.
//
// 배경: 예전에는 순위를 조회하지 못하면 임의의 숫자를 만들어 보여 줬습니다. 그 값은 실제 순위가
// 아니므로 더 이상 만들지도 보여 주지도 않습니다. 지금 기록되는 값은 두 가지뿐입니다.
//   - src 'manual': 회원이 직접 확인해 적은 순위 (쇼핑·플레이스)
//   - src 'live'  : 플레이스 분석에서 네이버 목록을 실제로 조회해 얻은 순위 (플레이스만, lib/naver-place.js)
// 쇼핑은 검색 API가 2026-07-31 종료되어 직접 기록만 가능합니다.
// 기록 한 건: { date: 'YYYY-MM-DD', rank: 1~1000 | null(순위권 밖), src: 'manual' | 'live' }

export const MAX_HISTORY = 180;
export const MAX_RANK = 1000;
export const POINT_SOURCES = ['manual', 'live'];
// 회원 1명이 종류(쇼핑·플레이스)별로 등록할 수 있는 항목 수
export const MAX_TRACKINGS_PER_TYPE = 10;

// KST 기준 YYYY-MM-DD
export function kstDateKey(date = new Date()) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

export function isValidDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidRank(rank) {
    return rank === null || (Number.isInteger(rank) && rank >= 1 && rank <= MAX_RANK);
}

// 저장된 이력에서 실제로 확인한 기록만 날짜순으로 돌려줍니다.
// (src 표시가 없는 예전 자동 생성 값은 실제 순위가 아니라서 제외)
export function recordedPoints(rankHistory) {
    let parsed;
    try {
        parsed = typeof rankHistory === 'string' ? JSON.parse(rankHistory || '[]') : rankHistory;
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
        .filter((p) => p && POINT_SOURCES.includes(p.src) && isValidDateKey(p.date) && isValidRank(p.rank ?? null))
        .map((p) => ({ date: p.date, rank: p.rank ?? null, src: p.src }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// 같은 날짜는 덮어쓰고, 아니면 날짜 순서에 맞춰 끼워 넣습니다.
export function upsertPoint(points, { date, rank, src = 'manual' }) {
    if (!isValidDateKey(date) || !isValidRank(rank) || !POINT_SOURCES.includes(src)) {
        throw new Error('순위 기록 값이 올바르지 않습니다.');
    }
    const next = points.filter((p) => p.date !== date);
    next.push({ date, rank, src });
    next.sort((a, b) => a.date.localeCompare(b.date));
    return next.slice(-MAX_HISTORY);
}

export function removePoint(points, date) {
    return points.filter((p) => p.date !== date);
}

// 최신 기록과 그 직전 기록
export function summarize(points) {
    const last = points[points.length - 1] || null;
    const prev = points[points.length - 2] || null;
    return {
        currentRank: last ? last.rank : null,
        previousRank: prev ? prev.rank : null,
        lastDate: last ? last.date : null,
        recordCount: points.length,
    };
}
