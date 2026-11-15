import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLookupConfig, placeErrorResponse } from '../lib/place-service.js';
import { PlaceLookupError } from '../lib/place-gate.js';
import { createRateLimiter } from '../lib/rate-limit.js';

test('PLACE_LOOKUP 으로 기능을 끌 수 있고 기본은 켜짐', () => {
    assert.equal(placeLookupConfig({}).enabled, true);
    assert.equal(placeLookupConfig({ PLACE_LOOKUP: 'on' }).enabled, true);
    for (const value of ['off', 'OFF', ' false ', '0', 'no']) {
        assert.equal(placeLookupConfig({ PLACE_LOOKUP: value }).enabled, false, value);
    }
});

test('하루 요청 상한은 범위를 벗어나면 기본값을 쓴다', () => {
    assert.equal(placeLookupConfig({}).dailyMax, 3000);
    assert.equal(placeLookupConfig({ PLACE_LOOKUP_DAILY_MAX: '500' }).dailyMax, 500);
    assert.equal(placeLookupConfig({ PLACE_LOOKUP_DAILY_MAX: '5' }).dailyMax, 3000);
    assert.equal(placeLookupConfig({ PLACE_LOOKUP_DAILY_MAX: '9999999' }).dailyMax, 3000);
    assert.equal(placeLookupConfig({ PLACE_LOOKUP_DAILY_MAX: 'abc' }).dailyMax, 3000);
});

test('조회 오류를 회원용 응답으로 바꾼다', () => {
    assert.deepEqual(placeErrorResponse(new PlaceLookupError('BAD_INPUT', '주소를 확인해주세요.')), { status: 400, body: { error: '주소를 확인해주세요.' } });
    assert.equal(placeErrorResponse(new PlaceLookupError('NOT_FOUND', 'x')).status, 404);
    assert.equal(placeErrorResponse(new PlaceLookupError('DAILY_LIMIT', 'x')).status, 429);
    assert.equal(placeErrorResponse(new PlaceLookupError('TIMEOUT', 'x')).status, 504);
    assert.equal(placeErrorResponse(new PlaceLookupError('CHANGED', 'x')).status, 502);

    // 2026-11-15 11:40 KST
    const retryAt = Date.parse('2026-11-15T02:40:00Z');
    const blocked = placeErrorResponse(new PlaceLookupError('BLOCKED', 'x', { retryAt }));
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.retryAt, retryAt);
    assert.match(blocked.body.error, /11:40 이후에 다시 시도/);
    assert.equal(placeErrorResponse(new PlaceLookupError('PAUSED', 'x', { retryAt })).status, 503);

    // 조회와 무관한 오류는 처리하지 않는다(호출한 쪽이 500 으로 처리)
    assert.equal(placeErrorResponse(new Error('db down')), null);
    assert.equal(placeErrorResponse(null), null);
});

test('회원별 호출 횟수 제한', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    assert.equal(limiter.allow('a', 0), true);
    assert.equal(limiter.allow('a', 100), true);
    assert.equal(limiter.allow('a', 200), false);
    assert.equal(limiter.allow('b', 200), true);
    assert.equal(limiter.allow('a', 1001), true);
});
