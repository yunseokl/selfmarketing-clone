// 내 매장 공개 지표(리뷰 수 등) 이력 — 조회한 날마다 한 건씩 쌓아 지난 조회와 비교합니다.
// 한 건: { date: 'YYYY-MM-DD', visitorReviews, blogReviews, score }

export const MAX_METRIC_POINTS = 120;

function isDateKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function countOrNull(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseMetrics(stored) {
    let parsed;
    try {
        parsed = typeof stored === 'string' ? JSON.parse(stored || '[]') : stored;
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((p) => p && isDateKey(p.date))
        .map((p) => ({
            date: p.date,
            visitorReviews: countOrNull(p.visitorReviews),
            blogReviews: countOrNull(p.blogReviews),
            score: typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// 같은 날짜는 최신 값으로 덮어씁니다.
export function upsertMetric(points, { date, visitorReviews, blogReviews, score }) {
    if (!isDateKey(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    const next = points.filter((p) => p.date !== date);
    next.push({
        date,
        visitorReviews: countOrNull(visitorReviews),
        blogReviews: countOrNull(blogReviews),
        score: typeof score === 'number' && Number.isFinite(score) ? score : null,
    });
    next.sort((a, b) => a.date.localeCompare(b.date));
    return next.slice(-MAX_METRIC_POINTS);
}

function diff(current, previous) {
    return current === null || previous === null ? null : current - previous;
}

// 가장 최근 기록과 그 전 날짜 기록의 차이. 비교할 이전 기록이 없으면 null.
export function metricChange(points) {
    if (points.length < 2) return null;
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    return {
        since: prev.date,
        visitorReviews: diff(last.visitorReviews, prev.visitorReviews),
        blogReviews: diff(last.blogReviews, prev.blogReviews),
    };
}
