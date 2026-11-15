import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMetrics, upsertMetric, metricChange, MAX_METRIC_POINTS } from '../lib/place-history.js';

test('깨진 값·형식이 다른 기록은 버린다', () => {
    assert.deepEqual(parseMetrics('깨진 JSON'), []);
    assert.deepEqual(parseMetrics(null), []);
    assert.deepEqual(parseMetrics('{"a":1}'), []);
    const points = parseMetrics(JSON.stringify([
        { date: '2026-11-10', visitorReviews: 100, blogReviews: 20, score: 4.5 },
        { date: '어제', visitorReviews: 1 },
        { date: '2026-11-09', visitorReviews: -3, blogReviews: '20', score: '4.5' },
    ]));
    assert.deepEqual(points, [
        { date: '2026-11-09', visitorReviews: null, blogReviews: null, score: null },
        { date: '2026-11-10', visitorReviews: 100, blogReviews: 20, score: 4.5 },
    ]);
});

test('같은 날짜는 덮어쓰고 날짜순으로 정렬한다', () => {
    let points = [];
    points = upsertMetric(points, { date: '2026-11-12', visitorReviews: 110, blogReviews: 22, score: 4.6 });
    points = upsertMetric(points, { date: '2026-11-10', visitorReviews: 100, blogReviews: 20, score: 4.5 });
    points = upsertMetric(points, { date: '2026-11-12', visitorReviews: 112, blogReviews: 22, score: 4.6 });
    assert.deepEqual(points.map((p) => [p.date, p.visitorReviews]), [['2026-11-10', 100], ['2026-11-12', 112]]);
    assert.throws(() => upsertMetric(points, { date: '2026/11/12', visitorReviews: 1 }));
});

test('보관 개수 상한을 넘으면 오래된 기록부터 지운다', () => {
    let points = [];
    for (let i = 0; i < MAX_METRIC_POINTS + 5; i += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        points = upsertMetric(points, { date, visitorReviews: i, blogReviews: i, score: null });
    }
    assert.equal(points.length, MAX_METRIC_POINTS);
    assert.equal(points[0].visitorReviews, 5);
});

test('지난 조회 대비 변화를 계산한다', () => {
    assert.equal(metricChange([]), null);
    assert.equal(metricChange([{ date: '2026-11-10', visitorReviews: 100, blogReviews: 20, score: null }]), null);
    assert.deepEqual(metricChange([
        { date: '2026-11-03', visitorReviews: 90, blogReviews: 20, score: null },
        { date: '2026-11-10', visitorReviews: 100, blogReviews: 19, score: null },
    ]), { since: '2026-11-03', visitorReviews: 10, blogReviews: -1 });
    // 한쪽 값을 모르면 차이도 모른다
    assert.deepEqual(metricChange([
        { date: '2026-11-03', visitorReviews: null, blogReviews: 20, score: null },
        { date: '2026-11-10', visitorReviews: 100, blogReviews: 20, score: null },
    ]), { since: '2026-11-03', visitorReviews: null, blogReviews: 0 });
});
