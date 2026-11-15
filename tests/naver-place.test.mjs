import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../lib/place-gate.js';
import {
    parsePlaceInput, parseCount, parseApolloState, extractSnapshot, normalizeListItem,
    median, summarizeTop, keywordFrequency, buildListBody, createPlaceClient,
    GRAPHQL_URL, PAGE_SIZE, MAX_RANK,
} from '../lib/naver-place.js';

test('플레이스 주소·ID 입력을 해석한다', () => {
    assert.deepEqual(parsePlaceInput(' 2025884279 '), { placeId: '2025884279' });
    assert.deepEqual(parsePlaceInput('https://m.place.naver.com/restaurant/2025884279/home'), { placeId: '2025884279' });
    assert.deepEqual(parsePlaceInput('m.place.naver.com/hairshop/1509308410/review/visitor'), { placeId: '1509308410' });
    assert.deepEqual(parsePlaceInput('https://map.naver.com/p/entry/place/1509308410?c=15.00,0,0,0,dh'), { placeId: '1509308410' });
    // 검색어가 숫자여도 종류 이름 바로 뒤의 숫자를 고른다
    assert.deepEqual(parsePlaceInput('https://map.naver.com/p/search/12345/place/1509308410'), { placeId: '1509308410' });
    assert.deepEqual(parsePlaceInput('https://pcmap.place.naver.com/place/13582820/home'), { placeId: '13582820' });
    assert.deepEqual(parsePlaceInput('https://m.place.naver.com/share?id=13582820&tabsPath=%2Fhome'), { placeId: '13582820' });
    assert.deepEqual(parsePlaceInput('https://naver.me/5abcDEF'), { shortUrl: 'https://naver.me/5abcDEF' });
});

test('네이버 플레이스가 아닌 입력은 거절한다', () => {
    const bad = [
        '', '   ', '1234', 'abc', 'https://example.com/place/2025884279',
        'https://m.place.naver.com.evil.example/restaurant/2025884279/home',
        'https://evil.example/?u=m.place.naver.com/restaurant/2025884279',
        'https://smartstore.naver.com/shop/products/2025884279',
        'https://m.place.naver.com/restaurant/list?query=강남', 'https://naver.me/', 'javascript:alert(1)',
    ];
    for (const value of bad) {
        assert.throws(() => parsePlaceInput(value), (error) => error.code === 'BAD_INPUT', value);
    }
});

test('네이버 숫자 표기를 숫자로 바꾼다', () => {
    assert.equal(parseCount('2,225'), 2225);
    assert.equal(parseCount('37,000+'), 37000);
    assert.equal(parseCount('~100'), 100);
    assert.equal(parseCount('1.2만'), 12000);
    assert.equal(parseCount(317), 317);
    assert.equal(parseCount(null), null);
    assert.equal(parseCount(''), null);
    assert.equal(parseCount('많음'), null);
});

const APOLLO = {
    'PlaceDetailBase:111111': {
        __typename: 'PlaceDetailBase',
        id: '111111',
        name: '테스트식당 본점',
        category: '한식',
        roadAddress: '서울 강남구 테스트로 1',
        address: '역삼동 1',
        visitorReviewsTotal: 317,
        visitorReviewsScore: 4.97,
        cafeBlogReviewsTotal: 52,
        visitorReviewsTextReviewTotal: 272,
        reviewSettings: { showVisitorReviewScore: true },
        microReviews: ['신선한 숙성회'],
        conveniences: ['포장', '주차'],
        paymentInfo: ['간편결제'],
        talktalkUrl: null,
        naverBlog: null,
        phone: null,
        virtualPhone: '0507-0000-0000',
        missingInfo: { isBizHourMissing: true, isMenuImageMissing: false, isDescriptionMissing: false, isConveniencesMissing: false },
    },
    'VisitorReviewStatsResult:111111': {
        review: { avgRating: 4.97, totalCount: 317, imageReviewCount: 260, authorCount: 307 },
        analysis: {
            themes: [{ code: 'taste', label: '맛', count: 215 }, { code: 'service', label: '서비스', count: 66 }, { label: '빈값', count: 0 }],
            menus: [{ label: '김밥', count: 37 }],
            votedKeyword: { totalCount: 1156, details: [{ code: 'food_good', displayName: '음식이 맛있어요', count: 285 }] },
        },
    },
    'PlaceMenuItem:a': { name: '숙성회', hasImage: true },
    'PlaceMenuItem:b': { name: '칼국수', hasImage: false },
    ROOT_QUERY: {},
};

test('매장 화면 HTML에서 공개 데이터를 꺼낸다', () => {
    const html = `<html><script>window.__APOLLO_STATE__ = ${JSON.stringify({ a: { text: '중괄호 } 와 따옴표 \\" 포함' }, b: 1 })};window.other = {};</script></html>`;
    assert.deepEqual(parseApolloState(html), { a: { text: '중괄호 } 와 따옴표 \\" 포함' }, b: 1 });
    assert.equal(parseApolloState('<html>차단 안내</html>'), null);
    assert.equal(parseApolloState('window.__APOLLO_STATE__ = {"a": '), null);
});

test('매장 요약을 만들고 전화번호·리뷰 원문은 담지 않는다', () => {
    const snapshot = extractSnapshot(APOLLO, '111111');
    assert.equal(snapshot.name, '테스트식당 본점');
    assert.equal(snapshot.category, '한식');
    assert.equal(snapshot.address, '서울 강남구 테스트로 1');
    assert.equal(snapshot.visitorReviews, 317);
    assert.equal(snapshot.visitorScore, 4.97);
    assert.equal(snapshot.blogReviews, 52);
    assert.equal(snapshot.photoReviews, 260);
    assert.equal(snapshot.intro, '신선한 숙성회');
    assert.equal(snapshot.hasPhone, true);
    assert.equal(snapshot.hasTalktalk, false);
    assert.deepEqual(snapshot.missing, { hours: true, menuImage: false, accessor: false, description: false, conveniences: false });
    assert.equal(snapshot.menuCount, 2);
    assert.equal(snapshot.menuImageCount, 1);
    assert.deepEqual(snapshot.reviewThemes, [{ label: '맛', count: 215 }, { label: '서비스', count: 66 }]);
    assert.deepEqual(snapshot.reviewVotes, [{ label: '음식이 맛있어요', count: 285 }]);
    assert.equal(JSON.stringify(snapshot).includes('0507'), false);

    assert.equal(extractSnapshot(APOLLO, '999999'), null);
    assert.equal(extractSnapshot(null, '111111'), null);
});

test('평점을 숨긴 매장은 평점을 비운다', () => {
    const hidden = { ...APOLLO, 'PlaceDetailBase:111111': { ...APOLLO['PlaceDetailBase:111111'], reviewSettings: { showVisitorReviewScore: false } } };
    assert.equal(extractSnapshot(hidden, '111111').visitorScore, null);
});

test('목록 요청은 실제 화면처럼 정렬·업종을 지정하지 않는다', () => {
    const body = buildListBody('강남 맛집', 101);
    assert.deepEqual(body.variables.input, { query: '강남 맛집', start: 101, display: PAGE_SIZE, isNmap: false, deviceType: 'mobile' });
});

test('목록 항목을 정리한다', () => {
    const row = normalizeListItem({ id: 2056004665, name: ' 정희 강남역점 ', category: '한식', saveCount: '~100', visitorReviewCount: '2,225', visitorReviewScore: '4.84', blogCafeReviewCount: '346', newOpening: null }, 3, '2056004665');
    assert.deepEqual(row, {
        rank: 3, placeId: '2056004665', name: '정희 강남역점', category: '한식',
        visitorReviews: 2225, blogReviews: 346, score: 4.84, saveText: '~100', isNew: false, isTarget: true,
    });
    assert.equal(normalizeListItem({ id: '1', name: 'x' }, 1, '2').isTarget, false);
});

test('중간값과 상위 매장 요약(내 매장 제외)', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([null, undefined]), null);
    const top = [
        { visitorReviews: 100, blogReviews: 10, isTarget: false },
        { visitorReviews: 9999, blogReviews: 9999, isTarget: true },
        { visitorReviews: 300, blogReviews: null, isTarget: false },
    ];
    assert.deepEqual(summarizeTop(top), { count: 2, visitorReviewsMedian: 200, blogReviewsMedian: 10 });
});

test('상위 매장 대표키워드를 많이 쓰인 순으로 모으고 내 매장에 없는 것을 구분한다', () => {
    const result = keywordFrequency(['강남 횟집', '강남구청회식'], [
        { keywords: ['강남횟집', '숙성회', '숙성회'] },
        { keywords: ['숙성회', '강남 회식'] },
        { keywords: [] },
    ]);
    assert.deepEqual(result, [
        { keyword: '숙성회', count: 2, mine: false },
        { keyword: '강남 회식', count: 1, mine: false },
        { keyword: '강남횟집', count: 1, mine: true },
    ]);
});

// ---- 조회 클라이언트 (가짜 네이버) ----

function listItems(start, count, targetAt) {
    return Array.from({ length: count }, (_, i) => {
        const rank = start + i;
        return { id: rank === targetAt ? '777777' : String(1000000 + rank), name: `매장${rank}`, visitorReviewCount: String(rank), blogCafeReviewCount: '1' };
    });
}

// emptyTimes: { 시작번호: 횟수 } — 그 쪽을 처음 몇 번은 빈 응답(200, 0건)으로 돌려줍니다. Infinity 면 계속 빈 응답.
function fakeNaver({ targetAt = null, lastStart = 901, lastCount = PAGE_SIZE, total = 5000, status = 200, emptyTimes = {} } = {}) {
    const calls = [];
    const emptyLeft = { ...emptyTimes };
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        if (status !== 200) return new Response('<html>blocked</html>', { status });
        const body = JSON.parse(init.body);
        if (body.operationName === 'getPlaceDetail') {
            return Response.json({ data: { business: { base: { id: body.variables.id, name: '내 매장' }, informationTab: { keywordList: ['강남횟집', ' 강남회식 '] } } } });
        }
        const { start } = body.variables.input;
        if (emptyLeft[start] > 0) {
            emptyLeft[start] -= 1;
            return Response.json({ data: { result: { businesses: { total: 0, items: [] } } } });
        }
        const count = start > lastStart ? 0 : start === lastStart ? lastCount : PAGE_SIZE;
        return Response.json({ data: { result: { businesses: { total: count ? total : 0, items: listItems(start, count, targetAt) } } } });
    };
    return { calls, fetchImpl, starts: () => calls.map((call) => JSON.parse(call.init.body).variables.input.start) };
}

function makeClient(naver) {
    const gate = createGate({ minIntervalMs: 0 });
    return { gate, client: createPlaceClient({ gate, fetchImpl: naver.fetchImpl, confirmDelayMs: 0 }) };
}

test('순위를 찾으면 그 쪽에서 멈추고 상위 10곳을 함께 돌려준다', async () => {
    const naver = fakeNaver({ targetAt: 137 });
    const { client } = makeClient(naver);
    const result = await client.getRank({ keyword: '강남 횟집', placeId: '777777', depth: 300 });

    assert.equal(result.status, 'found');
    assert.equal(result.rank, 137);
    assert.equal(result.total, 5000);
    assert.equal(result.top.length, 10);
    assert.equal(result.top[0].rank, 1);
    assert.equal(result.target.name, '매장137');
    assert.equal(naver.calls.length, 2);
    assert.equal(naver.calls[0].url, GRAPHQL_URL);
    assert.match(naver.calls[0].init.headers['User-Agent'], /Mobile/);
    assert.equal(typeof result.fetchedAt, 'number');
});

test('살펴본 범위 안에 없으면 beyond, 목록 끝까지 봤으면 not_listed', async () => {
    const far = fakeNaver({ targetAt: 450 });
    const beyond = await makeClient(far).client.getRank({ keyword: 'k', placeId: '777777', depth: 300 });
    assert.equal(beyond.status, 'beyond');
    assert.equal(beyond.rank, null);
    assert.equal(beyond.scanned, 300);
    assert.equal(far.calls.length, 3);

    const short = fakeNaver({ lastStart: 101, lastCount: 40, total: 140 });
    const notListed = await makeClient(short).client.getRank({ keyword: 'k', placeId: '777777', depth: 1000 });
    assert.equal(notListed.status, 'not_listed');
    assert.equal(notListed.scanned, 140);
    assert.equal(short.calls.length, 2);
});

test('깊이는 1,000위를 넘지 않는다', async () => {
    const naver = fakeNaver({ lastStart: 2001 });
    const result = await makeClient(naver).client.getRank({ keyword: 'k', placeId: '777777', depth: 99999 });
    assert.equal(result.status, 'beyond');
    assert.equal(result.scanned, MAX_RANK);
    assert.equal(naver.calls.length, 10);
});

test('같은 키워드를 다시 조회하면 네이버에 다시 요청하지 않는다', async () => {
    const naver = fakeNaver({ targetAt: 5 });
    const { client } = makeClient(naver);
    await client.getRank({ keyword: '강남 횟집', placeId: '777777' });
    await client.getRank({ keyword: '강남 횟집', placeId: '1000003' }); // 다른 매장, 같은 키워드
    assert.equal(naver.calls.length, 1);
});

test('데이터가 있는 쪽이 한 번 빈 응답으로 와도 다시 확인해 순위를 찾는다', async () => {
    const naver = fakeNaver({ targetAt: 106, emptyTimes: { 101: 1 } });
    const { client, gate } = makeClient(naver);
    const result = await client.getRank({ keyword: '압구정회식', placeId: '777777', depth: 300 });
    assert.equal(result.status, 'found');
    assert.equal(result.rank, 106);
    assert.deepEqual(naver.starts(), [1, 101, 101]);
    assert.equal(gate.status().paused, false);
});

test('목록이 100개 단위에서 끝나면 한 번 더 확인하고 첫 쪽으로 정상 응답을 확인한 뒤 목록 끝으로 본다', async () => {
    const naver = fakeNaver({ lastStart: 201, total: 488 });
    const { client, gate } = makeClient(naver);
    const result = await client.getRank({ keyword: 'k', placeId: '777777', depth: 1000 });
    assert.equal(result.status, 'not_listed');
    assert.equal(result.scanned, 300);
    assert.equal(result.total, 488);
    assert.deepEqual(naver.starts(), [1, 101, 201, 301, 301, 1]);
    assert.equal(gate.status().paused, false);

    // 확인을 거친 목록 끝은 저장해 두어 다시 묻지 않는다
    const again = await client.getRank({ keyword: 'k', placeId: '777777', depth: 1000 });
    assert.equal(again.status, 'not_listed');
    assert.equal(naver.calls.length, 6);
});

test('네이버가 계속 빈 응답만 주면 결과를 내지 않고 조회를 멈춘다', async () => {
    const naver = fakeNaver({ targetAt: 106, emptyTimes: { 101: Infinity, 1: 0 } });
    // 첫 쪽은 처음 한 번만 정상, 이후에는 빈 응답
    let firstPageCalls = 0;
    const fetchImpl = async (url, init) => {
        const { start } = JSON.parse(init.body).variables.input;
        if (start === 1) {
            firstPageCalls += 1;
            if (firstPageCalls > 1) {
                naver.calls.push({ url, init });
                return Response.json({ data: { result: { businesses: { total: 0, items: [] } } } });
            }
        }
        return naver.fetchImpl(url, init);
    };
    const gate = createGate({ minIntervalMs: 0 });
    const client = createPlaceClient({ gate, fetchImpl, confirmDelayMs: 0 });
    await assert.rejects(client.getRank({ keyword: 'k', placeId: '777777', depth: 300 }), (e) => e.code === 'BLOCKED' && e.retryAt > Date.now());
    assert.equal(gate.status().paused, true);
    assert.deepEqual(naver.starts(), [1, 101, 101, 1]);
});

test('검색 결과가 없는 키워드는 한 번 더 확인한 뒤 0건으로 돌려주고 저장하지 않는다', async () => {
    const naver = fakeNaver({ lastStart: 0 });
    const { client } = makeClient(naver);
    const result = await client.getRank({ keyword: '없는키워드', placeId: '777777' });
    assert.equal(result.status, 'not_listed');
    assert.equal(result.scanned, 0);
    assert.deepEqual(result.top, []);
    assert.deepEqual(naver.starts(), [1, 1]);
    await client.getRank({ keyword: '없는키워드', placeId: '777777' });
    assert.equal(naver.calls.length, 4);
});

test('네이버가 거절하면 우회하지 않고 조회를 멈춘다', async () => {
    const naver = fakeNaver({ status: 429 });
    const { client, gate } = makeClient(naver);
    await assert.rejects(client.getRank({ keyword: 'k', placeId: '777777' }), (e) => e.code === 'BLOCKED' && e.retryAt > Date.now());
    assert.equal(gate.status().paused, true);
    // 멈춘 동안에는 요청이 나가지 않는다
    await assert.rejects(client.getRank({ keyword: '다른 키워드', placeId: '777777' }), (e) => e.code === 'PAUSED');
    assert.equal(naver.calls.length, 1);
});

test('응답 형식이 바뀌면 조회 중단 없이 형식 변경 오류로 알린다', async () => {
    const gate = createGate({ minIntervalMs: 0 });
    const client = createPlaceClient({ gate, fetchImpl: async () => Response.json({ errors: [{ message: 'Unknown field' }] }, { status: 400 }) });
    await assert.rejects(client.getRank({ keyword: 'k', placeId: '777777' }), (e) => e.code === 'CHANGED');
    assert.equal(gate.status().paused, false);
});

test('대표키워드를 읽고 공백을 정리한다', async () => {
    const { client } = makeClient(fakeNaver());
    const { value } = await client.getKeywords('777777');
    assert.deepEqual(value, { placeId: '777777', name: '내 매장', keywords: ['강남횟집', '강남회식'] });
});

test('매장 화면과 대표키워드를 합쳐 돌려주고, 대표키워드만 실패하면 나머지는 보여 준다', async () => {
    const html = `<script>window.__APOLLO_STATE__ = ${JSON.stringify(APOLLO)};</script>`;
    const ok = createPlaceClient({
        gate: createGate({ minIntervalMs: 0 }),
        fetchImpl: async (url, init) => (init.method === 'GET'
            ? new Response(html, { status: 200 })
            : Response.json({ data: { business: { base: { id: '111111', name: '테스트식당 본점' }, informationTab: { keywordList: ['강남횟집'] } } } })),
    });
    const full = await ok.getPlace('111111');
    assert.equal(full.value.name, '테스트식당 본점');
    assert.deepEqual(full.value.keywords, ['강남횟집']);

    const partial = createPlaceClient({
        gate: createGate({ minIntervalMs: 0 }),
        fetchImpl: async (url, init) => (init.method === 'GET' ? new Response(html, { status: 200 }) : new Response('oops', { status: 500 })),
    });
    assert.equal((await partial.getPlace('111111')).value.keywords, null);

    const missing = createPlaceClient({ gate: createGate({ minIntervalMs: 0 }), fetchImpl: async () => new Response('<html></html>', { status: 200 }) });
    await assert.rejects(missing.getPlace('111111'), (e) => e.code === 'CHANGED');
    const notFound = createPlaceClient({ gate: createGate({ minIntervalMs: 0 }), fetchImpl: async () => new Response('', { status: 404 }) });
    await assert.rejects(notFound.getPlace('111111'), (e) => e.code === 'NOT_FOUND');
});

test('naver.me 공유 주소는 네이버 주소로만 따라가 ID를 찾는다', async () => {
    const hops = [];
    const client = createPlaceClient({
        gate: createGate({ minIntervalMs: 0 }),
        fetchImpl: async (url, init) => {
            hops.push([url, init.redirect]);
            if (url === 'https://naver.me/ok') return new Response(null, { status: 302, headers: { location: 'https://map.naver.com/p/entry/place/1509308410?from=share' } });
            if (url === 'https://naver.me/evil') return new Response(null, { status: 302, headers: { location: 'https://evil.example/place/1509308410' } });
            return new Response('', { status: 200 });
        },
    });
    assert.equal(await client.resolveInput('https://naver.me/ok'), '1509308410');
    assert.deepEqual(hops[0], ['https://naver.me/ok', 'manual']);
    await assert.rejects(client.resolveInput('https://naver.me/evil'), (e) => e.code === 'BAD_INPUT');
    assert.equal(hops.some(([url]) => url.includes('evil.example')), false);
    // 숫자 ID나 일반 주소는 요청 없이 바로 해석한다
    const before = hops.length;
    assert.equal(await client.resolveInput('2025884279'), '2025884279');
    assert.equal(hops.length, before);
});
