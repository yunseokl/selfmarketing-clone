import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDateKey, isValidDateKey, recordedPoints, upsertPoint, removePoint, summarize, MAX_HISTORY } from '../lib/rank-log.js';

test('KST 날짜 키', () => {
    assert.equal(kstDateKey(new Date('2026-11-14T14:59:59Z')), '2026-11-14');
    assert.equal(kstDateKey(new Date('2026-11-14T15:00:00Z')), '2026-11-15');
    assert.equal(isValidDateKey('2026-02-30'), false);
    assert.equal(isValidDateKey('2026-2-3'), false);
    assert.equal(isValidDateKey('2026-02-03'), true);
});

test('예전 자동 생성 값(src 없음)은 이력에서 제외한다', () => {
    const stored = JSON.stringify([
        { date: '2026-11-01', rank: 18 },
        { date: '2026-11-02', rank: 12, src: 'manual' },
        { checkedAt: '2026-11-03T00:00:00Z', rank: 9 },
        { date: '2026-11-04', rank: null, src: 'manual' },
        { date: '2026-11-05', rank: 0, src: 'manual' },
    ]);
    assert.deepEqual(recordedPoints(stored), [
        { date: '2026-11-02', rank: 12, src: 'manual' },
        { date: '2026-11-04', rank: null, src: 'manual' },
    ]);
    assert.deepEqual(recordedPoints('깨진 JSON'), []);
    assert.deepEqual(recordedPoints(null), []);
});

test('기록 추가: 같은 날짜는 덮어쓰고 날짜순으로 정렬한다', () => {
    let points = [];
    points = upsertPoint(points, { date: '2026-11-10', rank: 30 });
    points = upsertPoint(points, { date: '2026-11-03', rank: 45 });
    points = upsertPoint(points, { date: '2026-11-10', rank: 28 });
    assert.deepEqual(points.map((p) => [p.date, p.rank]), [['2026-11-03', 45], ['2026-11-10', 28]]);
    assert.deepEqual(summarize(points), { currentRank: 28, previousRank: 45, lastDate: '2026-11-10', recordCount: 2 });
    assert.deepEqual(removePoint(points, '2026-11-10').length, 1);
});

test('잘못된 순위·날짜는 거절한다', () => {
    for (const bad of [
        { date: '2026-11-10', rank: 0 }, { date: '2026-11-10', rank: 1001 }, { date: '2026-11-10', rank: 3.5 },
        { date: '2026-13-01', rank: 3 }, { date: 'today', rank: 3 }, { date: '2026-11-10', rank: '3' },
    ]) {
        assert.throws(() => upsertPoint([], bad), JSON.stringify(bad));
    }
    assert.equal(upsertPoint([], { date: '2026-11-10', rank: null })[0].rank, null); // 순위권 밖
});

test('이력은 최근 것만 보관한다', () => {
    let points = [];
    const start = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
        const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
        points = upsertPoint(points, { date, rank: (i % 50) + 1 });
    }
    assert.equal(points.length, MAX_HISTORY);
    assert.equal(points[0].date, '2026-01-21');
    assert.deepEqual(summarize([]), { currentRank: null, previousRank: null, lastDate: null, recordCount: 0 });
});

test('실제 조회 기록(src live)은 직접 기록과 함께 보관하고, 모르는 출처는 받지 않는다', () => {
    let points = upsertPoint([], { date: '2026-11-10', rank: 30 });
    points = upsertPoint(points, { date: '2026-11-11', rank: 27, src: 'live' });
    assert.deepEqual(points, [
        { date: '2026-11-10', rank: 30, src: 'manual' },
        { date: '2026-11-11', rank: 27, src: 'live' },
    ]);
    // 같은 날 직접 기록을 실제 조회 값이 덮어쓴다
    points = upsertPoint(points, { date: '2026-11-10', rank: 31, src: 'live' });
    assert.deepEqual(points[0], { date: '2026-11-10', rank: 31, src: 'live' });

    assert.throws(() => upsertPoint(points, { date: '2026-11-12', rank: 5, src: 'auto' }));
    assert.deepEqual(recordedPoints(JSON.stringify([
        { date: '2026-11-01', rank: 3, src: 'live' },
        { date: '2026-11-02', rank: 4, src: 'estimate' },
    ])), [{ date: '2026-11-01', rank: 3, src: 'live' }]);
});
