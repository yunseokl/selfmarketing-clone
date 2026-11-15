import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../lib/place-gate.js';
import {
    extractSnapshot, normalizeListItem, topSignals, diagnoseRank,
    buildListBody, createPlaceClient, LIST_QUERY_RICH,
} from '../lib/naver-place.js';

// 이 테스트의 샘플 JSON 은 실제로 캡처된 네이버 플레이스 응답의 필드·구조를 본떠 구성했습니다.
// (리스트 아이템: __typename "PlaceListBusinessesItem" / 상세: PlaceDetailBase·PlaceMenuItem·PlaceMenuCategory)
// 네트워크 호출 없이 고정 샘플로만 검증합니다.

// ---- 상세: 메뉴 정리 상태와 리뷰 작성자 수 ----

const DETAIL_APOLLO = {
    'PlaceDetailBase:222': {
        __typename: 'PlaceDetailBase',
        id: '222',
        name: '분석식당',
        category: '한식',
        roadAddress: '서울 강남구 분석로 2',
        visitorReviewsTotal: 100,
        visitorReviewsScore: 4.5,
        cafeBlogReviewsTotal: 10,
        visitorReviewsTextReviewTotal: 80,
        reviewSettings: { showVisitorReviewScore: true },
        missingInfo: { isBizHourMissing: false, isMenuImageMissing: true, isDescriptionMissing: false, isConveniencesMissing: false },
        conveniences: ['주차'],
        paymentInfo: ['간편결제'],
    },
    'VisitorReviewStatsResult:222': {
        review: { imageReviewCount: 50, authorCount: 88, totalCount: 100 },
        analysis: { themes: [{ label: '맛', count: 40 }], menus: [], votedKeyword: { details: [{ displayName: '친절해요', count: 12 }] } },
    },
    'PlaceMenuItem:1': { name: '소금김밥', description: '기본 김밥', hasImage: true, price: { displayText: '5,000원' } },
    'PlaceMenuItem:2': { name: '갈치조림', description: '', hasImage: false, price: { displayText: '15,000원' } },
    'PlaceMenuItem:3': { name: '볼락구이', description: '', hasImage: false }, // 가격 없음
    'PlaceMenuCategory:c1': { name: '메인', kind: 'normal', itemIds: ['1', '2'] },
    'PlaceMenuCategory:c2': { name: '미분류', kind: 'uncategorized', itemIds: ['3'] }, // 집계 제외
};

test('상세 요약에 메뉴 정리 상태(가격·설명·카테고리)와 리뷰 작성자 수를 더한다', () => {
    const snap = extractSnapshot(DETAIL_APOLLO, '222');
    assert.equal(snap.menuCount, 3);
    assert.equal(snap.menuImageCount, 1);
    assert.equal(snap.menuPricedCount, 2); // 소금김밥·갈치조림
    assert.equal(snap.menuDescribedCount, 1); // 소금김밥만 설명 있음
    assert.equal(snap.menuCategoryCount, 1); // 미분류 카테고리는 제외
    assert.equal(snap.reviewAuthors, 88);
});

test('메뉴가 없으면 메뉴 정리 수치는 null, 리뷰 작성자 집계가 없으면 null', () => {
    const noMenu = { 'PlaceDetailBase:9': { id: '9', name: 'x', reviewSettings: {} } };
    const snap = extractSnapshot(noMenu, '9');
    assert.equal(snap.menuPricedCount, null);
    assert.equal(snap.menuDescribedCount, null);
    assert.equal(snap.menuCategoryCount, null);
    assert.equal(snap.reviewAuthors, null);
});

// ---- 리스트 아이템: 숨은 공개 신호 ----

const RICH_ITEM = {
    id: '2019834067',
    name: '솥내음 강남 신사 가로수길점',
    category: '한식',
    saveCount: '~100',
    visitorReviewCount: '2,677',
    visitorReviewScore: '4.96',
    blogCafeReviewCount: '248',
    newOpening: true,
    imageCount: 10,
    bookingReviewCount: '0',
    promotionTitle: null,
    naverBookingCategory: '예약',
    hasBooking: true,
    hasNPay: false,
    newBusinessHours: { status: '영업 중' },
    coupon: { total: 1 },
    naverOrder: { isDelivery: false, isTableOrder: false, isPreOrder: false, isPickup: false },
    posInfo: { isPOS: true },
    nPayConnect: { benefitText: '페이스사인 결제 10% 적립' },
    membershipBenefit: { benefitName: '결제금액의 5% 적립' },
};

test('rich=false(기본)는 기존 목록 항목 형태를 그대로 돌려준다', () => {
    const row = normalizeListItem(RICH_ITEM, 3, '2019834067');
    assert.deepEqual(Object.keys(row).sort(), ['blogReviews', 'category', 'isNew', 'isTarget', 'name', 'placeId', 'rank', 'saveText', 'score', 'visitorReviews'].sort());
});

test('rich=true 면 숨은 공개 신호(사진·예약·주문·쿠폰·멤버십·페이·POS·영업상태)를 정리한다', () => {
    const row = normalizeListItem(RICH_ITEM, 3, '2019834067', { rich: true });
    assert.equal(row.imageCount, 10);
    assert.equal(row.bookingReviews, 0);
    assert.equal(row.hoursStatus, '영업 중');
    assert.equal(row.couponCount, 1);
    assert.equal(row.hasBooking, true);
    assert.equal(row.hasOrder, false); // 모든 주문 수단 false
    assert.equal(row.hasMembership, true);
    assert.equal(row.hasNPay, true); // nPayConnect.benefitText 있음
    assert.equal(row.hasPos, true);
    assert.equal(row.isTarget, true);
    // 개인정보 필드는 담지 않는다
    assert.equal('phone' in row, false);
    assert.equal('visitorReviews' in row && typeof row.visitorReviews === 'object', false);
});

test('확장 쿼리를 못 받은 항목은 숨은 신호가 모두 null(확인 불가)이다', () => {
    const row = normalizeListItem({ id: '1', name: 'x', visitorReviewCount: '10' }, 5, '2', { rich: true });
    for (const key of ['imageCount', 'bookingReviews', 'promotionTitle', 'hoursStatus', 'couponCount', 'hasBooking', 'hasOrder', 'hasMembership', 'hasNPay', 'hasPos']) {
        assert.equal(row[key], null, key);
    }
});

// ---- 상위 분포(topSignals) ----

const TOP_ROWS = [
    { isTarget: false, visitorReviews: 100, blogReviews: 10, score: 4.5, imageCount: 20, saveText: '500', hasBooking: true, hasOrder: true, couponCount: 1, hasMembership: true, hasNPay: false, hasPos: true },
    { isTarget: false, visitorReviews: 200, blogReviews: 30, score: 4.8, imageCount: 40, saveText: '1,000', hasBooking: true, hasOrder: false, couponCount: 0, hasMembership: false, hasNPay: null, hasPos: true },
    { isTarget: true, visitorReviews: 50, blogReviews: 5, score: 4.0, imageCount: 5, saveText: '~100', hasBooking: false, hasOrder: false, couponCount: 0, hasMembership: false, hasNPay: false, hasPos: false },
];

test('상위 분포는 내 매장을 빼고 중간값·최고값·운영비율을 낸다', () => {
    const s = topSignals(TOP_ROWS);
    assert.equal(s.count, 2);
    assert.deepEqual(s.visitorReviews, { median: 150, best: 200 });
    assert.deepEqual(s.images, { median: 30, best: 40 });
    assert.deepEqual(s.save, { median: 750, best: 1000 });
    assert.deepEqual(s.features.booking, { have: 2, known: 2 });
    assert.deepEqual(s.features.coupon, { have: 1, known: 2 }); // 1곳만 쿠폰 total>0
    assert.deepEqual(s.features.npay, { have: 0, known: 1 }); // null 은 확인 불가로 제외
    assert.deepEqual(s.features.pos, { have: 2, known: 2 });
});

test('빈 목록의 상위 분포는 count 0, 모든 통계는 null', () => {
    const s = topSignals([]);
    assert.equal(s.count, 0);
    assert.equal(s.visitorReviews.median, null);
    assert.deepEqual(s.features.booking, { have: 0, known: 0 });
});

// ---- 순위 진단(diagnoseRank) ----

test('내 매장이 상위 분포보다 뒤처진 신호를 짚어 준다', () => {
    const s = topSignals(TOP_ROWS);
    const mine = { visitorReviews: 50, blogReviews: 5, score: 4.0, imageCount: 5, saveCount: 100, hasBooking: false, hasOrder: false, hasCoupon: false, hasMembership: false, hasNPay: false, hasPos: false };
    const d = diagnoseRank(mine, s);
    assert.equal(d.count, 2);
    assert.equal(d.signals.length, 5);
    const review = d.signals.find((x) => x.key === 'visitorReviews');
    assert.deepEqual({ mine: review.mine, median: review.median, best: review.best, verdict: review.verdict }, { mine: 50, median: 150, best: 200, verdict: 'behind' });
    assert.equal(d.signals.find((x) => x.key === 'score').verdict, 'behind'); // 4.0 vs 4.65
    assert.equal(d.behind, 5); // 모든 수치가 뒤처짐
    const booking = d.features.find((x) => x.key === 'booking');
    assert.deepEqual({ have: booking.have, known: booking.known, mine: booking.mine }, { have: 2, known: 2, mine: false });
});

test('평점은 0.2 이내면 near, 중간값 이상이면 ahead', () => {
    const s = topSignals(TOP_ROWS); // score median 4.65
    assert.equal(diagnoseRank({ score: 4.5 }, s).signals.find((x) => x.key === 'score').verdict, 'near');
    assert.equal(diagnoseRank({ score: 4.9 }, s).signals.find((x) => x.key === 'score').verdict, 'ahead');
});

test('상위 분포가 비면 진단은 null', () => {
    assert.equal(diagnoseRank({ visitorReviews: 10 }, topSignals([])), null);
    assert.equal(diagnoseRank({ visitorReviews: 10 }, null), null);
});

test('확장 신호가 없으면(모두 null) 숫자 비교는 유지하고 운영여부는 생략한다', () => {
    const minimalRows = [
        { isTarget: false, visitorReviews: 100, blogReviews: 10, score: 4.5 },
        { isTarget: false, visitorReviews: 200, blogReviews: 20, score: 4.7 },
    ];
    const d = diagnoseRank({ visitorReviews: 50, blogReviews: 5, score: 4.0 }, topSignals(minimalRows));
    assert.ok(d.signals.find((x) => x.key === 'visitorReviews'));
    assert.equal(d.signals.find((x) => x.key === 'images'), undefined); // imageCount 분포 없음
    assert.equal(d.features.length, 0); // 운영여부 확인 불가 → 생략
});

// ---- buildListBody: 쿼리 선택 ----

test('buildListBody 는 변수는 그대로 두고 쿼리만 바꾼다', () => {
    const minimal = buildListBody('강남 맛집', 1);
    const rich = buildListBody('강남 맛집', 1, LIST_QUERY_RICH);
    assert.deepEqual(minimal.variables, rich.variables);
    assert.equal(rich.query.includes('posInfo'), true);
    assert.equal(minimal.query.includes('posInfo'), false);
});

// ---- 조회 클라이언트: 1페이지 확장 + 강등 ----

function richItems(start, count, targetAt) {
    return Array.from({ length: count }, (_, i) => {
        const rank = start + i;
        return {
            id: rank === targetAt ? '777' : String(1000 + rank),
            name: `매장${rank}`,
            visitorReviewCount: String(rank * 10),
            blogCafeReviewCount: String(rank),
            visitorReviewScore: '4.5',
            saveCount: '~100',
            imageCount: rank,
            hasBooking: rank % 2 === 0,
            naverOrder: { isDelivery: false, isTableOrder: false, isPreOrder: false, isPickup: false },
            coupon: { total: rank % 3 === 0 ? 1 : 0 },
            posInfo: { isPOS: true },
            membershipBenefit: { benefitName: null },
            hasNPay: false,
            nPayConnect: null,
        };
    });
}

test('1페이지는 확장 쿼리로 받아 상위 분포(topSignals)를 채운다', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push(JSON.parse(init.body));
        const body = JSON.parse(init.body);
        const { start } = body.variables.input;
        const count = start === 1 ? 100 : 0;
        return Response.json({ data: { result: { businesses: { total: 100, items: richItems(start, count, 2) } } } });
    };
    const client = createPlaceClient({ gate: createGate({ minIntervalMs: 0 }), fetchImpl, confirmDelayMs: 0 });
    const result = await client.getRank({ keyword: '강남 맛집', placeId: '777', depth: 300 });

    assert.equal(result.status, 'found');
    assert.equal(result.rank, 2);
    assert.equal(calls[0].query.includes('posInfo'), true); // 1페이지는 확장 쿼리
    assert.equal(result.topSignals.count, 99); // 상위 100곳에서 내 매장 제외
    assert.ok(result.topSignals.features.booking.known > 0);
    assert.ok(result.topSignals.images.median > 0);
    // 내 매장(rank2) 행은 확장 신호를 포함한다
    assert.equal(result.target.hasPos, true);
});

test('네이버가 확장 필드를 거절(400)하면 기본 쿼리로 강등해 순위는 그대로 조회한다', async () => {
    const queries = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        queries.push(body.query.includes('posInfo') ? 'rich' : 'min');
        if (body.query.includes('posInfo')) {
            return Response.json({ errors: [{ message: 'Cannot query field posInfo' }] }, { status: 400 });
        }
        const { start } = body.variables.input;
        const count = start === 1 ? 100 : 0;
        return Response.json({ data: { result: { businesses: { total: 100, items: richItems(start, count, 2) } } } });
    };
    const client = createPlaceClient({ gate: createGate({ minIntervalMs: 0 }), fetchImpl, confirmDelayMs: 0 });

    const result = await client.getRank({ keyword: 'k', placeId: '777', depth: 300 });
    assert.equal(result.status, 'found');
    assert.equal(result.rank, 2);
    // 강등됐으므로 확장 신호는 확인 불가(운영비율 known 0), 숫자 분포는 유지
    assert.equal(result.topSignals.features.booking.known, 0);
    assert.ok(result.topSignals.visitorReviews.median > 0);

    // 한 번 강등되면 다음 조회부터는 확장 쿼리를 다시 보내지 않는다(확장 400 프로브는 1회만)
    await client.getRank({ keyword: 'k2', placeId: '777', depth: 300 });
    assert.equal(queries.filter((q) => q === 'rich').length, 1);
});
