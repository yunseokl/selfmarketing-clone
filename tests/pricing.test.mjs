// 실행: npm test  (Node 내장 테스트 러너 — 추가 설치 없음)
// 회귀 방지: 광고 주문 금액을 클라이언트 값으로 계산하던 결함
// (음수 단가 → 잔액 증가, 0원 단가 → 무료 주문, 소수 입력 허용) — 2026-11-14 QA에서 발견
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AD_SERVICE_PRICES,
    resolveAdPrice,
    calculateAdCost,
    calculateAdRefund,
    calculateBlogRefund,
} from '../lib/pricing.js';
import { createShoppingAdSchema } from '../lib/validations/shopping.js';
import { createPlaceAdSchema } from '../lib/validations/place.js';
import { createRankTrackingSchema } from '../lib/validations/rank-tracking.js';

const DAY = 24 * 60 * 60 * 1000;

test('단가는 상품 유형으로만 정해진다', () => {
    assert.equal(resolveAdPrice('selma30'), 30);
    assert.equal(resolveAdPrice('selma50'), 50);
    assert.equal(resolveAdPrice('premium'), 100);
    assert.equal(resolveAdPrice('free'), null);
    assert.equal(resolveAdPrice('__proto__'), null);
    assert.equal(resolveAdPrice(), AD_SERVICE_PRICES.selma30);
});

test('총액 = 단가 × 일 목표 × 기간', () => {
    assert.deepEqual(calculateAdCost({ serviceType: 'selma50', dailyGoal: 100, duration: 10 }), {
        pricePerClick: 50,
        totalCost: 50000,
    });
});

test('비정상 입력은 금액을 계산하지 않는다', () => {
    for (const input of [
        { serviceType: 'selma30', dailyGoal: 10.5, duration: 1 },
        { serviceType: 'selma30', dailyGoal: 10, duration: 1.5 },
        { serviceType: 'selma30', dailyGoal: -10, duration: 1 },
        { serviceType: 'selma30', dailyGoal: 10, duration: 0 },
        { serviceType: 'selma30', dailyGoal: NaN, duration: 1 },
        { serviceType: 'nope', dailyGoal: 10, duration: 1 },
    ]) {
        assert.equal(calculateAdCost(input), null, JSON.stringify(input));
    }
});

test('주문 스키마는 클라이언트가 보낸 단가를 버린다', () => {
    const base = { productUrl: 'https://smartstore.naver.com/qa/products/1', keyword: '캠핑의자', dailyGoal: 10, duration: 1 };
    for (const pricePerClick of [-100, 0, 1, 999999]) {
        const parsed = createShoppingAdSchema.parse({ ...base, pricePerClick });
        assert.equal('pricePerClick' in parsed, false);
        assert.equal(calculateAdCost(parsed).totalCost, 300);
    }
    const place = createPlaceAdSchema.parse({
        placeUrl: 'https://map.naver.com/p/entry/place/123', placeName: '가게', keyword: '강남 미용실',
        dailyGoal: 10, duration: 1, pricePerClick: -100,
    });
    assert.equal(calculateAdCost(place).totalCost, 300);
});

test('주문 스키마는 소수·범위 밖 값·모르는 상품을 거절한다', () => {
    const base = { productUrl: 'https://smartstore.naver.com/qa/products/1', keyword: 'k', dailyGoal: 10, duration: 1 };
    assert.equal(createShoppingAdSchema.safeParse({ ...base, dailyGoal: 10.5 }).success, false);
    assert.equal(createShoppingAdSchema.safeParse({ ...base, duration: 1.5 }).success, false);
    assert.equal(createShoppingAdSchema.safeParse({ ...base, dailyGoal: 9 }).success, false);
    assert.equal(createShoppingAdSchema.safeParse({ ...base, dailyGoal: 10001 }).success, false);
    assert.equal(createShoppingAdSchema.safeParse({ ...base, duration: 366 }).success, false);
    assert.equal(createShoppingAdSchema.safeParse({ ...base, serviceType: 'free' }).success, false);
    assert.equal(createShoppingAdSchema.safeParse(base).success, true);
});

test('네이버를 흉내 낸 도메인은 거절하고 실제 도메인은 허용한다', () => {
    const ok = (url) => createShoppingAdSchema.safeParse({ productUrl: url, keyword: 'k', dailyGoal: 10, duration: 1 }).success;
    assert.equal(ok('https://smartstore.naver.com.evil.example/x'), false);
    assert.equal(ok('https://evil.example/smartstore.naver.com'), false);
    assert.equal(ok('https://smartstore.naver.com/store/products/1'), true);
    assert.equal(ok('https://m.smartstore.naver.com/store/products/1'), true);
    assert.equal(ok('https://search.shopping.naver.com/catalog/1'), true);

    const track = (type, url) => createRankTrackingSchema.safeParse({ type, url, keyword: 'k' }).success;
    assert.equal(track('shopping', 'https://smartstore.naver.com.evil.example/x'), false);
    assert.equal(track('place', 'https://naver.me/abc123'), true);
    assert.equal(track('place', 'https://m.place.naver.com/restaurant/123'), true);
    assert.equal(track('place', 'javascript:alert(1)'), false);
});

test('중도 취소 환불은 남은 일수 비례이며 0 이상 결제액 이하', () => {
    const now = new Date('2026-11-14T00:00:00Z');
    const end = (days) => new Date(now.getTime() + days * DAY);
    assert.equal(calculateAdRefund({ totalCost: 30000, duration: 10, endDate: end(10), now }), 30000);
    assert.equal(calculateAdRefund({ totalCost: 30000, duration: 10, endDate: end(4.2), now }), 15000);
    assert.equal(calculateAdRefund({ totalCost: 30000, duration: 10, endDate: end(-1), now }), 0);
    assert.equal(calculateAdRefund({ totalCost: 30000, duration: 10, endDate: end(99), now }), 30000);
    // 과거 결함으로 생긴 음수·0원 주문은 환불 0원
    assert.equal(calculateAdRefund({ totalCost: -1000, duration: 1, endDate: end(1), now }), 0);
    assert.equal(calculateAdRefund({ totalCost: 0, duration: 365, endDate: end(365), now }), 0);
});

test('블로그 취소 환불은 미발행 건수 비례', () => {
    assert.equal(calculateBlogRefund({ totalCost: 280000, postCount: 10, publishedCount: 0 }), 280000);
    assert.equal(calculateBlogRefund({ totalCost: 280000, postCount: 10, publishedCount: 4 }), 168000);
    assert.equal(calculateBlogRefund({ totalCost: 280000, postCount: 10, publishedCount: 10 }), 0);
    assert.equal(calculateBlogRefund({ totalCost: 280000, postCount: 10, publishedCount: 99 }), 0);
});
