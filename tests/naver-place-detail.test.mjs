import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../lib/place-gate.js';
import {
    extractDetail, extractSnapshot, extractHours, extractPos, placeDetailRoot,
    parseNaverDate, daysAgo, summarizeActivity, buildActivityBatch, buildActionItems,
    createPlaceClient, GRAPHQL_URL, ACTIVITY_REVIEW_SAMPLE,
} from '../lib/naver-place.js';

// 샘플은 2026-11-15 실제 매장 화면(m.place.naver.com/place/{id}/home)의 __APOLLO_STATE__ 와
// 리뷰·소식 묶음 응답 구조를 본떠 줄였습니다. 네트워크 호출 없이 고정 값으로만 검증합니다.

const NOW = Date.parse('2026-11-15T11:00:00Z'); // 한국 시각 2026-11-15 20:00

function hoursOfDay(peak) {
    return Array.from({ length: 24 }, (_, hour) => (hour === peak ? 100 : hour >= 10 && hour <= 22 ? 20 : 0));
}

const DETAIL_KEY = 'placeDetail({"input":{"deviceType":"mobile","id":"333","isNx":false}})';

const APOLLO = {
    'PlaceDetailBase:333': {
        __typename: 'PlaceDetailBase',
        id: '333',
        name: '상세식당',
        category: '한식',
        roadAddress: '서울 강남구 상세로 3',
        visitorReviewsTotal: 323,
        visitorReviewsScore: 4.97,
        cafeBlogReviewsTotal: 52,
        reviewSettings: { showVisitorReviewScore: true },
        phone: '02-000-0000',
        virtualPhone: '0507-1111-2222',
        talktalkUrl: null,
        // 실제 응답처럼 영업시간이 있는데도 true 로 내려온 값
        missingInfo: { isBizHourMissing: true, isMenuImageMissing: false, isDescriptionMissing: false, isConveniencesMissing: false },
    },
    'SubwayStationInfo:730': { __typename: 'SubwayStationInfo', id: 730, displayName: '강남구청역', nearestExit: '3-1', walkTime: 12 },
    'InformationFacilities:4': { __typename: 'InformationFacilities', id: '4', name: '포장' },
    'InformationFacilities:13': { __typename: 'InformationFacilities', id: '13', name: '단체 이용 가능' },
    ROOT_QUERY: {
        __typename: 'Query',
        [DETAIL_KEY]: {
            __typename: 'PlaceDetail',
            base: { __ref: 'PlaceDetailBase:333' },
            'buttons({"input":{"deviceType":"mobile","isNx":false}})': [{ key: 'phone', name: '전화', value: '0507-1111-2222' }],
            'badge({"input":{"deviceType":"mobile","isNx":false}})': [{ key: 'placePlus', text: 'place+' }],
            tabs: [{ tabId: 'home', name: '홈' }, { tabId: 'feed', name: '소식' }, { tabId: 'review', name: '리뷰' }],
            naverBooking: { bookingBusinessId: null, naverBookingUrl: null, hasSmartOrder: false },
            placeMenus: { menuCount: 34, updatedAt: '26.11.08' },
            hasCoupon: { count: 0 },
            hasFeed: { blogExist: false, feedExist: true },
            businessTools: {
                tools: [
                    { type: 'naverBooking', title: '네이버예약', using: false, link: 'https://new.smartplace.naver.com/x' },
                    { type: 'smartCall', title: '스마트콜', using: true },
                ],
            },
            newBusinessHours: [{
                businessStatusDescription: { status: '영업 중', description: '23:30에 라스트오더' },
                businessHours: [
                    { day: '월', businessHours: { start: '11:00', end: '01:00' }, breakHours: [{ start: '15:00', end: '17:00' }], lastOrderTimes: [{ type: '영업시간', time: '23:30' }] },
                    { day: '화', businessHours: { start: '11:00', end: '01:00' }, breakHours: [], lastOrderTimes: null },
                ],
                comingIrregularClosedDays: [],
                comingRegularClosedDays: '',
            }],
            informationTab: {
                parkingInfo: { description: '매장 앞 발레', basicParking: { isFree: false }, valetParking: { isFree: false } },
                facilities: [{ __ref: 'InformationFacilities:4' }, { __ref: 'InformationFacilities:13' }],
                pet: { isAllowed: false },
                noKidsZone: null,
                keywordList: ['강남구청횟집', ' 압구정회식 ', ''],
            },
            homepages: { repr: { type: '인스타그램', isDeadUrl: false }, etc: [{ type: '블로그', isDeadUrl: true }] },
            subwayStations: [{ name: '7', station: { __ref: 'SubwayStationInfo:730' } }],
            POS: {
                isPOS: true,
                salesCount: 2281,
                popularMenus: [
                    { name: '소금김밥', count: 276, orderShare: 12, rankChange: 'SAME' },
                    { name: '대물볼락구이', count: 143, orderShare: 6, rankChange: 'UP' },
                ],
                averagePrice: { morning: 0, lunch: 77898, dinner: 204554, night: 167151, total: 172645 },
                popularDay: 'friday',
                weeklyPopularity: {
                    monday: { popularity: hoursOfDay(18), popularTime: 18 },
                    friday: { popularity: hoursOfDay(19), popularTime: 19 },
                    sunday: { popularity: [1, 2], popularTime: 12 },
                },
                durationTime: 106,
            },
            connectPlus: [
                { title: '페이스사인 결제 10% 적립', showInBenefitArea: true },
                { title: 'QR 주문', showInBenefitArea: false },
            ],
            description: '  숙성회 전문점입니다.  ',
            newOpening: false,
            visitorReviewMediasTotal: 586,
            images: { totalImages: 12 },
            topPhotos: { total: 108 },
            phoneInfo: { phone: '0507-1111-2222' },
        },
    },
};

test('매장 화면 상세 응답에서 운영 정보를 정리하고 전화번호는 담지 않는다', () => {
    const detail = extractDetail(APOLLO);
    assert.deepEqual(detail.keywords, ['강남구청횟집', '압구정회식']);
    assert.deepEqual(detail.photos, { top: 108, business: 12, visitorMedia: 586 });
    assert.equal(detail.couponCount, 0);
    assert.equal(detail.hasFeed, true);
    assert.equal(detail.hasBooking, false);
    assert.deepEqual(detail.tools, [
        { type: 'naverBooking', title: '네이버예약', using: false },
        { type: 'smartCall', title: '스마트콜', using: true },
    ]);
    assert.deepEqual(detail.tabs, ['홈', '소식', '리뷰']);
    assert.deepEqual(detail.parking, { available: true, free: false, valet: true });
    assert.deepEqual(detail.facilities, ['포장', '단체 이용 가능']);
    assert.equal(detail.pet, false);
    assert.equal(detail.noKidsZone, null);
    assert.equal(detail.descriptionLength, '숙성회 전문점입니다.'.length);
    assert.deepEqual(detail.links, ['인스타그램']); // 끊긴 주소는 뺀다
    assert.deepEqual(detail.badges, ['place+']); // 인자가 붙은 필드 이름도 찾는다
    assert.deepEqual(detail.subway, { station: '강남구청역', exit: '3-1', walkMinutes: 12 });
    assert.equal(detail.menuUpdatedAt, '26.11.08');
    assert.deepEqual(detail.benefits, ['페이스사인 결제 10% 적립']);
    assert.equal(JSON.stringify(detail).includes('0507'), false);
    assert.equal(JSON.stringify(detail).includes('smartplace'), false);

    assert.equal(extractDetail({ ROOT_QUERY: {} }), null);
    assert.equal(extractDetail(null), null);
    assert.equal(placeDetailRoot({ ROOT_QUERY: { user: {} } }), null);
});

test('영업시간을 정리하고, 필드가 없으면 확인 불가(null)로 둔다', () => {
    const hours = extractDetail(APOLLO).hours;
    assert.equal(hours.registered, true);
    assert.equal(hours.status, '영업 중');
    assert.equal(hours.statusText, '23:30에 라스트오더');
    assert.deepEqual(hours.days[0], { day: '월', start: '11:00', end: '01:00', breaks: ['15:00~17:00'], lastOrder: '23:30' });
    assert.equal(hours.days[1].lastOrder, null);
    assert.equal(hours.regularClosed, null);

    assert.equal(extractHours(undefined), null);
    assert.equal(extractHours([]).registered, false);
    assert.equal(extractHours([{ businessHours: [] }]).registered, false);
});

test('POS 결제 집계를 정리하고, POS 매장이 아니면 null', () => {
    const pos = extractDetail(APOLLO).pos;
    assert.equal(pos.weeklySales, 2281);
    assert.deepEqual(pos.popularMenus[1], { name: '대물볼락구이', count: 143, share: 6, change: 'UP' });
    assert.deepEqual(pos.averagePrice, { morning: null, lunch: 77898, dinner: 204554, night: 167151, total: 172645 });
    assert.equal(pos.busiestDay, '금');
    assert.equal(pos.stayMinutes, 106);
    // 24시간이 모두 있는 요일만 남긴다(일요일 샘플은 2칸뿐이라 제외)
    assert.deepEqual(pos.weekly.map((day) => [day.day, day.peakHour]), [['월', 18], ['금', 19]]);

    assert.equal(extractPos({ isPOS: false }), null);
    assert.equal(extractPos(null), null);
});

test('영업시간이 화면 응답에 있으면 isBizHourMissing 보다 그것을 믿는다', () => {
    assert.equal(extractSnapshot(APOLLO, '333').missing.hours, false);
    assert.equal(extractSnapshot(APOLLO, '333').hasOpeningHours, true);

    const empty = structuredClone(APOLLO);
    empty.ROOT_QUERY[DETAIL_KEY].newBusinessHours = [];
    empty['PlaceDetailBase:333'].missingInfo.isBizHourMissing = false;
    assert.equal(extractSnapshot(empty, '333').missing.hours, true);

    // 상세 응답이 없으면 예전처럼 네이버 표시값을 쓴다
    const noRoot = { ...APOLLO, ROOT_QUERY: {} };
    assert.equal(extractSnapshot(noRoot, '333').missing.hours, true);
});

test('네이버 날짜 표기를 한국 날짜로 바꾼다', () => {
    assert.equal(parseNaverDate('11.15.일', NOW), '2026-11-15');
    assert.equal(parseNaverDate('12.30.화', NOW), '2025-12-30'); // 오늘보다 뒤면 작년
    assert.equal(parseNaverDate('26.11.3.화', NOW), '2026-11-03');
    assert.equal(parseNaverDate('2026.11.07.', NOW), '2026-11-07');
    assert.equal(parseNaverDate('20261107', NOW), '2026-11-07');
    assert.equal(parseNaverDate('9시간 전', NOW), null);
    assert.equal(parseNaverDate('2.30.월', NOW), null);
    assert.equal(parseNaverDate('', NOW), null);
    assert.equal(parseNaverDate(null, NOW), null);

    assert.equal(daysAgo('2026-11-15', NOW), 0);
    assert.equal(daysAgo('2026-11-08', NOW), 7);
    assert.equal(daysAgo(null, NOW), null);
    // 한국 시각 자정 직후(UTC 전날 15시대)도 한국 날짜로 센다
    assert.equal(daysAgo('2026-11-16', Date.parse('2026-11-15T15:30:00Z')), 0);
});

function review(created, { reply = false, visitCount = 1 } = {}) {
    return { created, visitCount, reply: { created: reply ? created : null } };
}

const ACTIVITY_PARTS = [
    {
        visitorReviews: {
            total: 1687,
            items: [
                review('11.14.토', { reply: true }), review('11.13.금', { reply: true, visitCount: 3 }),
                review('11.9.월'), review('10.20.화', { reply: true }),
            ],
        },
    },
    { fsasReviews: { total: 470, items: [{ type: 'blog', createdString: '26.11.15.일' }, { type: 'cafe', createdString: '26.9.1.화' }, { type: 'blog', createdString: '이상한값' }] } },
    {
        feeds: {
            feeds: [
                { category: '알림', title: '점심 정식 개시', isPinned: true, createdString: '20261107' },
                { category: '임시휴무', title: '추석 휴무', isPinned: false, createdString: '20260824' },
            ],
            hasMore: true,
        },
    },
    { unifiedCoupons: { total: 2, coupons: [{ title: '리뷰 작성 시 음료 쿠폰' }, { title: '' }], memberships: [{ membershipName: '단골 멤버십' }] } },
    { aiBriefing: { textSummaries: [{ sentence: '사용자 리뷰를 요약해 드립니다.' }, { sentence: '곰탕이 유명한 한식당입니다.' }] } },
];

test('리뷰·소식 활동을 요약한다(리뷰 원문 없이 날짜·답글·재방문만)', () => {
    const activity = summarizeActivity(ACTIVITY_PARTS, NOW);
    assert.deepEqual(activity.visitor, {
        total: 1687, sampled: 4, latest: '2026-11-14', oldest: '2026-10-20',
        last7: 3, last30: 4, spanDays: 27, perDay: 0.1, // 11.9 는 오늘 포함 최근 7일 안
        replied: 3, replyRate: 75, revisits: 1, revisitRate: 25,
    });
    assert.equal(activity.blog.total, 470);
    assert.equal(activity.blog.sampled, 3);
    assert.equal(activity.blog.cafe, 1);
    assert.equal(activity.blog.latest, '2026-11-15');
    assert.equal(activity.blog.last30, 1);
    assert.deepEqual(activity.feeds, {
        count: 2, hasMore: true, latest: '2026-11-07', latestTitle: '점심 정식 개시', latestCategory: '알림', daysSinceLatest: 8, last30: 1,
    });
    assert.deepEqual(activity.coupons, { total: 2, titles: ['리뷰 작성 시 음료 쿠폰'], memberships: ['단골 멤버십'] });
    assert.deepEqual(activity.briefing, ['곰탕이 유명한 한식당입니다.']);
});

test('일부 쿼리만 실패해도 나머지로 요약하고, 모두 비면 null', () => {
    const partial = summarizeActivity([null, ACTIVITY_PARTS[1], null, null, { aiBriefing: { textSummaries: null } }], NOW);
    assert.equal(partial.visitor, null);
    assert.equal(partial.blog.total, 470);
    assert.equal(partial.feeds, null);
    assert.equal(partial.briefing, null);
    assert.equal(summarizeActivity([null, null, null, null, null], NOW), null);
    assert.equal(summarizeActivity(null, NOW), null);
    // 소식이 하나도 없는 매장
    assert.deepEqual(summarizeActivity([null, null, { feeds: { feeds: [], hasMore: false } }], NOW).feeds, {
        count: 0, hasMore: false, latest: null, latestTitle: null, latestCategory: null, daysSinceLatest: null, last30: 0,
    });
});

test('활동 묶음 요청은 개인정보 필드를 요청하지 않는다', () => {
    const batch = buildActivityBatch(333);
    assert.deepEqual(batch.map((body) => body.operationName), ['getVisitorReviews', 'getFsasReviews', 'getFeeds', 'getUnifiedCoupons', 'getAiBriefing']);
    assert.equal(batch[0].variables.input.businessId, '333');
    assert.equal(batch[0].variables.input.size, ACTIVITY_REVIEW_SAMPLE);
    assert.equal(batch[1].variables.input.reviewSort, 'recent');
    assert.equal(batch[3].variables.isBooking, true);
    for (const body of batch) {
        assert.doesNotMatch(body.query, /\b(body|author|nickname|userName|imageUrl|profileImageUrl|contents|authorName|phone)\b/);
        assert.doesNotMatch(body.query, /^\s*mutation/);
    }
});

test('할 일은 비어 있거나 오래된 항목만 근거로 고른다', () => {
    const place = {
        ...extractSnapshot(APOLLO, '333'),
        keywords: ['강남구청횟집', '압구정회식'],
        detail: extractDetail(APOLLO),
    };
    const activity = summarizeActivity(ACTIVITY_PARTS, NOW);
    const lowReply = { ...activity, visitor: { ...activity.visitor, sampled: 50, replied: 2, replyRate: 4 }, coupons: { total: 0, titles: [], memberships: [] } };
    const keys = buildActionItems(place, lowReply).map((item) => item.key);
    assert.deepEqual(keys, ['keywords', 'reply', 'coupon', 'booking', 'talktalk']);
    assert.equal(buildActionItems(place, lowReply).find((item) => item.key === 'reply').level, 'high');

    // 소식이 오래되고 블로그 리뷰가 끊긴 매장
    const stale = { ...activity, feeds: { ...activity.feeds, daysSinceLatest: 83 }, blog: { ...activity.blog, last30: 0 } };
    const staleKeys = buildActionItems({ ...place, keywords: ['1', '2', '3', '4', '5'], hasTalktalk: true }, stale).map((item) => item.key);
    assert.deepEqual(staleKeys, ['feed', 'blog', 'booking']);

    assert.deepEqual(buildActionItems(null, null), []);
});

// ---- 조회 클라이언트 (가짜 네이버) ----

function makeClient(fetchImpl) {
    const gate = createGate({ minIntervalMs: 0 });
    return createPlaceClient({ gate, fetchImpl, confirmDelayMs: 0, now: () => NOW });
}

test('활동은 묶음 요청 1건으로 받고, 쿼리별 오류는 그 항목만 비운다', async () => {
    const calls = [];
    const client = makeClient(async (url, init) => {
        calls.push({ url, init });
        const bodies = JSON.parse(init.body);
        assert.equal(Array.isArray(bodies), true);
        return Response.json(bodies.map((body, i) => (i === 2
            ? { errors: [{ message: 'Internal Server Error' }] }
            : { data: ACTIVITY_PARTS[i] })));
    });
    const first = await client.getActivity('333');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPHQL_URL);
    assert.equal(calls[0].init.headers.Origin, 'https://m.place.naver.com');
    assert.equal(first.value.feeds, null);
    assert.equal(first.value.visitor.replied, 3);

    const again = await client.getActivity('333');
    assert.equal(again.cached, true);
    assert.equal(calls.length, 1);
});

test('묶음 응답 형식이 바뀌면 CHANGED, 거절되면 BLOCKED', async () => {
    const changed = makeClient(async () => Response.json({ data: {} }));
    await assert.rejects(changed.getActivity('1'), (error) => error.code === 'CHANGED');
    const allFailed = makeClient(async (url, init) => Response.json(JSON.parse(init.body).map(() => ({ errors: [{}] }))));
    await assert.rejects(allFailed.getActivity('1'), (error) => error.code === 'CHANGED');
    const blocked = makeClient(async () => new Response('<html>too many</html>', { status: 429 }));
    await assert.rejects(blocked.getActivity('1'), (error) => error.code === 'BLOCKED');
});

test('매장 화면에 대표키워드가 있으면 따로 조회하지 않는다', async () => {
    const calls = [];
    const html = `<html><script>window.__APOLLO_STATE__ = ${JSON.stringify(APOLLO)};</script></html>`;
    const client = makeClient(async (url, init) => {
        calls.push({ url, init });
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    const { value: place } = await client.getPlace('333');
    assert.equal(calls.length, 1);
    assert.deepEqual(place.keywords, ['강남구청횟집', '압구정회식']);
    assert.equal(place.detail.pos.weeklySales, 2281);
    assert.equal('keywords' in place.detail, false);
    assert.equal(place.missing.hours, false);
    assert.equal(JSON.stringify(place).includes('0507'), false);
});
