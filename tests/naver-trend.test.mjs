// 데이터랩 검색어 트렌드 연동 — 요청 조립과 응답 해석 검증 (실제 네트워크 호출 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    trendConfig, trendRange, buildTrendBody, parseTrendResponse, summarizeTrend, fetchTrend,
} from '../lib/naver-trend.js';

test('키 설정에 따라 호출 주소와 헤더가 정해진다', () => {
    assert.equal(trendConfig({}), null);
    const hub = trendConfig({ NAVER_API_HUB_KEY_ID: 'id', NAVER_API_HUB_KEY: 'key', NAVER_CLIENT_ID: 'x', NAVER_CLIENT_SECRET: 'y' });
    assert.equal(hub.mode, 'hub');
    assert.equal(hub.url, 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
    assert.deepEqual(hub.headers, { 'X-NCP-APIGW-API-KEY-ID': 'id', 'X-NCP-APIGW-API-KEY': 'key' });
    const legacy = trendConfig({ NAVER_CLIENT_ID: 'x', NAVER_CLIENT_SECRET: 'y' });
    assert.equal(legacy.mode, 'legacy');
    assert.equal(legacy.url, 'https://openapi.naver.com/v1/datalab/search');
    assert.equal(trendConfig({ NAVER_CLIENT_ID: 'x' }), null);
});

test('조회 기간은 지난달 말일까지의 36개월 (KST 기준)', () => {
    assert.deepEqual(trendRange(new Date('2026-11-14T15:30:00Z')), { startDate: '2023-11-01', endDate: '2026-10-31' });
    // UTC로는 10월 31일이지만 한국은 이미 11월 1일
    assert.deepEqual(trendRange(new Date('2026-10-31T15:00:00Z')), { startDate: '2023-11-01', endDate: '2026-10-31' });
    assert.deepEqual(trendRange(new Date('2026-03-10T00:00:00Z')), { startDate: '2023-03-01', endDate: '2026-02-28' });
    assert.equal(trendRange(new Date('2017-06-10T00:00:00Z')).startDate, '2016-01-01'); // 데이터랩 최소 시작일
});

test('요청 본문: 월 단위, 키워드 최대 5개, 공백 제거형을 같은 묶음에', () => {
    const body = buildTrendBody(['캠핑 의자', '캠핑테이블', 'a', 'b', 'c', 'd'], new Date('2026-11-14T00:00:00Z'));
    assert.equal(body.timeUnit, 'month');
    assert.equal(body.keywordGroups.length, 5);
    assert.deepEqual(body.keywordGroups[0], { groupName: '캠핑 의자', keywords: ['캠핑 의자', '캠핑의자'] });
    assert.deepEqual(body.keywordGroups[1], { groupName: '캠핑테이블', keywords: ['캠핑테이블'] });
});

const monthly = (startYear, values) => values.map((ratio, i) => {
    const year = startYear + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, '0');
    return { period: `${year}-${month}-01`, ratio };
});

test('응답 해석: 요청 순서를 지키고 없는 키워드는 빈 시리즈', () => {
    const json = {
        results: [
            { title: '캠핑테이블', keywords: ['캠핑테이블'], data: [{ period: '2026-02-01', ratio: 12.5 }, { period: '2026-01-01', ratio: 10 }] },
            { title: '캠핑의자', keywords: ['캠핑의자'], data: [{ period: '2026-01-01', ratio: 40 }, { period: '2026-02-01', ratio: 'x' }] },
        ],
    };
    const series = parseTrendResponse(json, ['캠핑의자', '캠핑테이블', '없는말']);
    assert.deepEqual(series[0], { keyword: '캠핑의자', points: [{ period: '2026-01', ratio: 40 }] });
    assert.deepEqual(series[1].points.map((p) => p.period), ['2026-01', '2026-02']);
    assert.deepEqual(series[2], { keyword: '없는말', points: [] });
    assert.deepEqual(parseTrendResponse(null, ['a']), [{ keyword: 'a', points: [] }]);
});

test('요약: 성수기·상대 수요·최근 추세', () => {
    // 3년치, 매년 7·8월이 성수기인 키워드 (나머지 20, 7월 80, 8월 100)
    const year = [20, 20, 20, 20, 20, 20, 80, 100, 20, 20, 20, 20];
    const seasonal = { keyword: '캠핑의자', points: monthly(2023, [...year, ...year, ...year]).map((p) => ({ period: p.period.slice(0, 7), ratio: p.ratio })) };
    const flat = { keyword: '사무용의자', points: seasonal.points.map((p) => ({ period: p.period, ratio: 10 })) };
    const empty = { keyword: '없는말', points: [] };

    const [a, b, c] = summarizeTrend([seasonal, flat, empty]);
    assert.deepEqual(a.peakMonths.map((m) => m.month), [8, 7]);
    assert.equal(a.relativeIndex, 100);
    assert.equal(a.avg12, 31.7); // (20×10 + 80 + 100) ÷ 12 = 31.67
    assert.equal(b.relativeIndex, 32); // 10 ÷ 31.67
    assert.deepEqual(b.peakMonths, []);
    assert.equal(b.recentChange, 0);
    assert.ok(Math.abs(a.recentChange - -70) < 1e-9); // 최근 3개월 20 vs 직전 3개월 (80+100+20)/3
    assert.equal(a.yearChange, 0);
    assert.equal(c.hasData, false);
    assert.equal(c.relativeIndex, 0);
    assert.equal(c.recentChange, null);
});

test('자료가 2년 미만이면 성수기를 판단하지 않는다', () => {
    const short = { keyword: 'k', points: monthly(2026, [10, 10, 10, 10, 10, 10, 90, 90, 10, 10]).map((p) => ({ period: p.period.slice(0, 7), ratio: p.ratio })) };
    assert.deepEqual(summarizeTrend([short])[0].peakMonths, []);
});

test('호출: 키가 없으면 호출하지 않고, 응답 상태에 따라 사유를 구분한다', async () => {
    let called = 0;
    const notConfigured = await fetchTrend(['a'], { env: {}, fetchImpl: async () => { called++; } });
    assert.deepEqual(notConfigured, { ok: false, code: 'NOT_CONFIGURED' });
    assert.equal(called, 0);

    const env = { NAVER_API_HUB_KEY_ID: 'id', NAVER_API_HUB_KEY: 'key' };
    const respond = (status, json) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });
    assert.equal((await fetchTrend(['a'], { env, fetchImpl: respond(401, {}) })).code, 'KEY_REJECTED');
    assert.equal((await fetchTrend(['a'], { env, fetchImpl: respond(429, {}) })).code, 'RATE_LIMITED');
    assert.equal((await fetchTrend(['a'], { env, fetchImpl: respond(500, {}) })).code, 'UPSTREAM_ERROR');
    assert.equal((await fetchTrend(['a'], { env, fetchImpl: async () => { throw new Error('network'); } })).code, 'UPSTREAM_ERROR');

    let sent;
    const ok = await fetchTrend(['캠핑의자'], {
        env,
        now: new Date('2026-11-14T00:00:00Z'),
        fetchImpl: async (url, options) => {
            sent = { url, options };
            return { ok: true, status: 200, json: async () => ({ results: [{ title: '캠핑의자', data: [{ period: '2026-10-01', ratio: 100 }] }] }) };
        },
    });
    assert.equal(ok.ok, true);
    assert.equal(sent.url, 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
    assert.equal(sent.options.method, 'POST');
    assert.equal(sent.options.headers['X-NCP-APIGW-API-KEY-ID'], 'id');
    assert.equal(JSON.parse(sent.options.body).endDate, '2026-10-31');
    assert.deepEqual(ok.series[0].points, [{ period: '2026-10', ratio: 100 }]);
});
