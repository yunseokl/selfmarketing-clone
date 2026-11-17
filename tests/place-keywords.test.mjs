import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAddress, regionTerms, keywordHasRegion, keywordCore, familyOf,
    mentionTerms, recommendKeywords, pickRankKeywords, rankScope,
} from '../lib/place-keywords.js';
// 쓸모 관문은 메뉴판·결제·영업시간·상위 매장 키워드까지 든 온전한 견본으로 봅니다(그래프 테스트와 같은 견본).
import { PHARMACY as FULL_PHARMACY, RESTAURANT as FULL_RESTAURANT, SALON as FULL_SALON } from './place-graph.fixtures.mjs';

// 매장 샘플은 2026-11-16 실제 매장 화면에서 읽은 값(주소·업종·등록 키워드·리뷰 집계)을 본떠 줄였습니다.
// 네트워크 호출 없이 고정 값으로만 검증합니다.

const PHARMACY = {
    placeId: '2063958841',
    name: '메가헬스팜약국',
    category: '약국',
    address: '충북 청주시 청원구 오창읍 공항로 1033-23 1층',
    jibunAddress: '충북 청주시 청원구 오창읍 창리 64-4',
    keywords: ['일반의약품', '건강기능식품', '동물의약품', '상비약'],
    conveniences: ['단체 이용 가능', '남/녀 화장실 구분', '주차'],
    reviewVotes: [{ label: '친절해요', count: 50 }, { label: '제품 종류가 다양해요', count: 27 }, { label: '매장이 넓어요', count: 12 }],
    reviewMenus: [],
    reviewThemes: [],
    detail: { subway: null, hours: { registered: true, days: [{ day: '매일', start: '09:30', end: '21:00' }] }, menus: [], styles: [] },
};

const PHARMACY_MENTIONS = {
    mentions: {
        blogTotal: 11,
        terms: [
            { term: '약국', count: 11 }, { term: '일반의약품', count: 6 }, { term: '건강기능식품', count: 0 }, { term: '동물의약품', count: 2 },
            { term: '상비약', count: 4 }, { term: '대형약국', count: 10 }, { term: '영양제', count: 4 }, { term: '동물약국', count: 3 },
        ],
    },
};

const RESTAURANT = {
    placeId: '2025884279',
    name: '대물섬 강남점',
    category: '한식',
    address: '서울 강남구 언주로148길 14 1층 103~106호',
    jibunAddress: '서울 강남구 논현동 98-12',
    keywords: ['강남구청횟집', '강남구청점심', '강남구청회식', '압구정횟집', '압구정회식'],
    conveniences: ['포장', '단체 이용 가능', '예약'],
    reviewVotes: [{ label: '음식이 맛있어요', count: 299 }, { label: '단체모임 하기 좋아요', count: 37 }],
    reviewMenus: [{ label: '김밥', count: 37 }, { label: '광어', count: 34 }, { label: '숙성회', count: 22 }],
    reviewThemes: [{ label: '맛', count: 216 }],
    detail: { subway: { station: '강남구청역', exit: '3-1', walkMinutes: 12 }, hours: null, menus: [], styles: [], seats: ['룸'] },
};

const SALON = {
    placeId: '1607545883',
    name: '제이디로얄 맨즈헤어 강남점',
    category: '남성전문미용실',
    address: '서울 강남구 강남대로96길 12 2층',
    jibunAddress: '서울 강남구 역삼동 818-1',
    keywords: ['강남역미용실', '볼륨매직', '댄디컷', '다운펌', '가르마펌'],
    conveniences: ['예약'],
    reviewVotes: [],
    reviewMenus: [{ label: '댄디컷', count: 2452 }, { label: '쉐도우펌', count: 1390 }, { label: '다운펌', count: 1259 }],
    reviewThemes: [],
    detail: {
        subway: { station: '강남역', exit: '11', walkMinutes: 3 },
        styles: [{ name: '댄디컷', count: 554 }, { name: '다운펌', count: 437 }, { name: '쉐도우펌', count: 356 }],
        menus: [],
    },
};

const keywordsOf = (result) => result.items.map((item) => item.keyword);

test('주소에서 시·구·동을 읽고 도로 이름과 번지에서 멈춘다', () => {
    assert.deepEqual(parseAddress('충북 청주시 청원구 오창읍 창리 64-4'), { sido: '충북', sidoKind: 'province', city: '청주시', district: '청원구', town: '오창읍' });
    assert.deepEqual(parseAddress('서울 강남구 언주로148길 14 1층'), { sido: '서울', sidoKind: 'metro', city: null, district: '강남구', town: null });
    assert.deepEqual(parseAddress('서울 강남구 역삼1동 818-1'), { sido: '서울', sidoKind: 'metro', city: null, district: '강남구', town: '역삼1동' });
    assert.equal(parseAddress('서울 중구 을지로1가 100-1').town, '을지로1가');
    assert.equal(parseAddress('충청북도 청주시 상당구 금천동 280').sido, '충북');
    assert.deepEqual(parseAddress(''), { sido: null, sidoKind: null, city: null, district: null, town: null });
});

test('지방 매장은 시 → 읍·면·동 → 구 순서로 지역 낱말을 낸다', () => {
    const regions = regionTerms(PHARMACY);
    assert.deepEqual(regions.map((region) => [region.term, region.scope]), [['청주', 'city'], ['오창', 'town'], ['청원', 'district']]);
    assert.deepEqual(regions[1].variants, ['오창', '오창읍']);
});

test('서울 매장은 역 → 구 → 동 순서이고, 등록 키워드에 쓴 지역이 맨 앞으로 온다', () => {
    const regions = regionTerms(RESTAURANT);
    // "강남구청횟집"은 구(강남)가 아니라 역(강남구청)을 쓴 것으로 센다. 주소에 없는 "압구정"은 등록 키워드에서 찾는다.
    assert.deepEqual(regions.map((region) => [region.term, region.scope, region.used]), [
        ['강남구청', 'station', 3], ['압구정', 'custom', 2], ['강남', 'district', 0], ['논현', 'town', 0],
    ]);
    // 두 글자 역 이름은 구 이름과 겹치기 쉬워 "강남역"으로 쓴다
    assert.equal(regionTerms(SALON)[0].term, '강남역');
});

test('구와 동 이름이 같으면 하나로 합치고, "중구"처럼 흔한 이름은 지역 낱말로 쓰지 않는다', () => {
    const seocho = regionTerms({ address: '서울 서초구 강남대로45길 20', jibunAddress: '서울 서초구 서초동 1357-21', keywords: [] });
    assert.deepEqual(seocho.map((region) => region.term), ['서초']);
    assert.deepEqual(seocho[0].variants, ['서초', '서초구', '서초동']);

    const junggu = regionTerms({ address: '서울 중구 을지로 42', jibunAddress: '서울 중구 을지로1가 100-1', keywords: [] });
    assert.deepEqual(junggu.map((region) => region.term), ['을지로']);
    assert.equal(regionTerms({ address: '경기 고양시 일산동구 중앙로 1', keywords: [] }).find((region) => region.scope === 'district').term, '일산');
});

test('매장명의 지점 이름은 지역으로 읽되 "주점·전문점"은 지점으로 보지 않는다', () => {
    const base = { address: '경기 성남시 분당구 판교역로 1', keywords: [] };
    assert.equal(regionTerms({ ...base, name: '솥내음 가로수길점' }).some((region) => region.term === '가로수길' && region.scope === 'branch'), true);
    // "청주점"은 "주점"으로 끝나지만 지점 이름이다
    assert.equal(regionTerms({ ...base, name: '메가타운약국 청주점' }).some((region) => region.term === '청주'), true);
    for (const name of ['한라 요리주점', '숙성회 전문점', '대물섬 본점', '맛나 2호점']) {
        assert.equal(regionTerms({ ...base, name }).some((region) => region.scope === 'branch'), false, name);
    }
    // 이미 아는 지역과 같은 지점 이름은 다시 넣지 않는다
    assert.equal(regionTerms({ ...base, name: '맛나 분당점' }).filter((region) => region.term === '분당').length, 1);
});

test('메뉴 이름이 앞에 붙은 등록 키워드는 지역으로 잘못 읽지 않는다', () => {
    const regions = regionTerms({ ...RESTAURANT, keywords: ['숙성회맛집', '최고의횟집'] });
    assert.equal(regions.some((region) => region.scope === 'custom'), false);
});

test('키워드에 지역이 들어 있는지와 지역을 뺀 낱말을 가린다', () => {
    const regions = regionTerms(RESTAURANT);
    assert.equal(keywordHasRegion('강남구청횟집', regions), true);
    assert.equal(keywordHasRegion('논현동 맛집', regions), true);
    assert.equal(keywordHasRegion('숙성회', regions), false);
    assert.equal(keywordCore('강남구청횟집', regions), '횟집');
    assert.equal(keywordCore('압구정 회식 추천', regions), '회식');
});

test('약국: 지역 + 업종 조합을 추천하고 근거 없는 낱말(심야약국)은 뺀다', () => {
    const result = recommendKeywords({ place: PHARMACY });
    const words = keywordsOf(result);
    assert.deepEqual(words.slice(0, 2), ['청주약국', '오창약국']);
    for (const word of ['청주대형약국', '청주건강기능식품', '청주동물의약품']) assert.equal(words.includes(word), true, word);
    // 21시에 닫는 매장이라 "심야약국"은 근거가 없다
    assert.equal(words.some((word) => word.includes('심야')), false);
    assert.equal(result.items.every((item) => !item.registered), true);
    assert.equal(result.hasRegionKeyword, false);
    assert.equal(result.slotsLeft, 1);
});

test('블로그 언급 수를 근거로 붙이고, 후기에서 더 많이 쓰는 말을 알려 준다', () => {
    const result = recommendKeywords({ place: PHARMACY, activity: PHARMACY_MENTIONS });
    const big = result.items.find((item) => item.keyword === '청주대형약국');
    assert.equal(big.blog, 10);
    assert.equal(big.reasons.some((reason) => reason.kind === 'blog' && reason.text === '블로그 10/11'), true);
    assert.equal(result.blogTotal, 11);

    const health = result.registered.find((entry) => entry.keyword === '건강기능식품');
    assert.equal(health.hasRegion, false);
    assert.equal(health.blog, 0);
    assert.deepEqual(health.spoken, { term: '영양제', blog: 4, keyword: '청주영양제' });
    // 블로그에 6번 나오는 등록 키워드는 지역만 붙이라고 제안한다
    const otc = result.registered.find((entry) => entry.keyword === '일반의약품');
    assert.equal(otc.suggest, '청주일반의약품');
    assert.equal(otc.spoken, null);
});

test('블로그에 한 번이라도 나오면 업종 연관어의 근거로 인정한다', () => {
    const plain = { ...PHARMACY, name: '헬스팜약국', keywords: [], reviewVotes: [] };
    assert.equal(keywordsOf(recommendKeywords({ place: plain })).some((word) => word.includes('대형약국')), false);
    const withBlog = recommendKeywords({ place: plain, activity: { mentions: { blogTotal: 5, terms: [{ term: '대형약국', count: 3 }] } } });
    assert.equal(keywordsOf(withBlog).includes('청주대형약국'), true);
});

test('상위 매장 대표키워드와 교차분석한다', () => {
    const rivals = [
        { placeId: '1', name: '메가타운약국 청주점', keywords: ['청주약국', '청주대형약국', '주중동약국'] },
        { placeId: '2', name: '청주가장큰약국', keywords: ['청주약국', '청주대형약국', '공공심야약국'] },
        { placeId: '3', name: '큰사랑약국', keywords: ['용암동약국', '공공심야약국'] },
        { placeId: '2063958841', name: '내 매장', keywords: ['청주약국'] }, // 내 매장은 세지 않는다
        { placeId: '1', name: '중복', keywords: ['청주약국'] }, // 같은 매장은 한 번만
    ];
    const result = recommendKeywords({ place: PHARMACY, activity: PHARMACY_MENTIONS, rivals });
    assert.equal(result.rivalCount, 3);
    const top = result.items.find((item) => item.keyword === '청주약국');
    assert.equal(top.rivalCount, 2);
    assert.equal(top.reasons[0].text, '상위 2곳 등록');
    assert.equal(result.items.find((item) => item.keyword === '청주대형약국').rivalCount, 2);
    // 다른 동네 이름이 붙은 키워드("주중동약국")는 "약국"을 쓰는 것으로만 센다
    assert.equal(result.items.find((item) => item.keyword === '오창약국').reasons.some((reason) => reason.text === "상위 3곳이 '약국' 사용"), true);
    // 상위 두 곳 이상이 쓰는 낱말이라도 내 매장 근거를 확인한다(쓸모 관문 '나'):
    // 21시에 닫는 매장에 "심야약국"은 권하지 않고, 이유와 함께 excluded 에 남긴다.
    // (전에는 "상위 2곳이 '심야약국' 사용"만으로 추천에 들어갔다. 파일 머리말의 "21시에 닫는 매장에는 추천하지 않는다"와 어긋나 바꿈)
    const gated = recommendKeywords({ place: PHARMACY, rivals, limit: 40 });
    assert.equal(gated.items.some((item) => item.keyword.includes('심야')), false);
    assert.deepEqual(gated.excluded.find((entry) => entry.term === '심야약국'),
        { term: '심야약국', keywords: ['청주심야약국', '오창심야약국'], rule: 'condition', reason: "밤 9시에 닫아 '심야약국'으로는 맞지 않습니다." });
});

test('음식점: "맛집"은 순위 확인용으로만 내고, 넓은 업종 이름(한식)은 추천하지 않는다', () => {
    const result = recommendKeywords({ place: RESTAURANT, limit: 60 });
    const best = result.items.find((item) => item.keyword === '강남구청맛집');
    assert.equal(best.registrable, false);
    // 전에는 점수만 낮춰 12개 밖으로 밀었지만(13번째 뒤에 "강남구청한식"이 남아 있었음), 이제는 후보에서 빼고 이유를 남긴다(쓸모 관문 '라')
    assert.equal(result.items.some((item) => item.term === '한식'), false);
    assert.equal(result.excluded.find((entry) => entry.term === '한식').rule, 'broad');
    assert.equal(keywordsOf(result).includes('강남구청숙성회'), true);
    // 이미 등록한 조합은 추천에서 빼고, 아직 안 쓴 지역과의 조합을 낸다(가장 중요한 낱말 "횟집"은 지역 3개까지: 등록한 2개 + 1개)
    assert.equal(keywordsOf(result).includes('강남구청횟집'), false);
    assert.equal(keywordsOf(result).includes('강남횟집'), true);
    assert.equal(result.registered.every((entry) => entry.hasRegion), true);
    assert.equal(result.hasRegionKeyword, true);
    // "회식"은 이미 두 지역으로 등록해 지역만 바꾼 조합("강남회식")은 더 권하지 않는다(쓸모 관문 '바').
    // 전에는 여기서 "강남회식"의 근거를 확인했는데, 그 조합이 추천에서 빠져 등록 키워드가 하나뿐인 매장으로 같은 근거를 확인한다.
    assert.equal(keywordsOf(result).includes('강남회식'), false);
    assert.deepEqual(result.excluded.find((entry) => entry.term === '회식'), {
        term: '회식', keywords: ['강남회식', '논현회식'], rule: 'region',
        reason: "'강남구청회식'·'압구정회식'이 이미 있어, '회식'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    const fresh = recommendKeywords({ place: { ...RESTAURANT, keywords: ['강남구청횟집'] } });
    // "회식"은 손님이 고른 좋은 점으로 뒷받침된다
    assert.match(fresh.items.find((item) => item.keyword === '강남구청회식').reasons.map((reason) => reason.text).join(' '), /단체모임 하기 좋아요/);
});

test('한 글자 근거("룸")는 통째로 같을 때만 인정한다', () => {
    const noRoom = { ...RESTAURANT, name: '블룸식당 강남점', keywords: [], detail: { ...RESTAURANT.detail, seats: [] } };
    assert.equal(recommendKeywords({ place: noRoom, limit: 60 }).items.some((item) => item.term === '룸식당'), false);
    const room = { ...noRoom, detail: { ...RESTAURANT.detail, seats: ['룸'] } };
    assert.equal(recommendKeywords({ place: room, limit: 60 }).items.some((item) => item.term === '룸식당'), true);
});

test('미용실: 등록한 시술 키워드에 지역을 붙이고 예약·리뷰 수를 근거로 단다', () => {
    const result = recommendKeywords({ place: SALON });
    const dandy = result.items.find((item) => item.keyword === '강남역댄디컷');
    assert.deepEqual(dandy.reasons.map((reason) => reason.text), ['등록 키워드', '예약 554건', '리뷰 2,452회']);
    assert.equal(result.registered.find((entry) => entry.keyword === '댄디컷').suggest, '강남역댄디컷');
    assert.equal(result.registered.find((entry) => entry.keyword === '강남역미용실').hasRegion, true);
    assert.equal(familyOf(SALON).key, 'hair');
});

test('순위를 볼 키워드: 지역 있는 등록 키워드를 먼저, 남는 자리는 추천으로 채운다', () => {
    const pharmacy = pickRankKeywords(PHARMACY, recommendKeywords({ place: PHARMACY, activity: PHARMACY_MENTIONS }));
    // 낱말이 겹치지 않게 고른다(가장 중요한 낱말 "약국"만 지역 2개). 등록 키워드에 지역만 붙인 조합(청주일반의약품·청주상비약)은
    // 다른 근거가 없어 뒤로 가고, 매장 사실·손님 말이 받치는 조합이 먼저 들어온다
    assert.deepEqual(pharmacy.keywords, ['청주약국', '오창약국', '청주대형약국', '청주영양제', '청주동물약국']);
    assert.deepEqual(pharmacy.skipped, ['일반의약품', '건강기능식품', '동물의약품', '상비약']);
    assert.deepEqual(pharmacy.added, pharmacy.keywords);

    const salon = pickRankKeywords(SALON, recommendKeywords({ place: SALON }));
    assert.equal(salon.keywords[0], '강남역미용실');
    assert.deepEqual(salon.skipped, ['볼륨매직', '댄디컷', '다운펌', '가르마펌']);

    const restaurant = pickRankKeywords(RESTAURANT, recommendKeywords({ place: RESTAURANT }));
    assert.deepEqual(restaurant, { keywords: RESTAURANT.keywords, skipped: [], added: [] });
});

test('주소를 읽지 못하면 추천을 만들지 않고 등록 키워드로 순위를 본다', () => {
    const place = { placeId: '9', name: '이름없는집', category: '카페', address: '', keywords: ['라떼', '케이크'] };
    const result = recommendKeywords({ place });
    assert.deepEqual(result.regions, []);
    assert.deepEqual(result.items, []);
    assert.deepEqual(pickRankKeywords(place, result), { keywords: ['라떼', '케이크'], skipped: [], added: [] });
    assert.deepEqual(recommendKeywords({ place: null }).items, []);
    assert.deepEqual(recommendKeywords().items, []);
});

test('블로그 언급 수를 물어볼 낱말은 지역을 빼고 8개까지만 고른다', () => {
    assert.deepEqual(mentionTerms(PHARMACY), ['약국', '일반의약품', '건강기능식품', '동물의약품', '상비약', '대형약국', '영양제', '동물약국']);
    const terms = mentionTerms(RESTAURANT);
    assert.equal(terms.length <= 8, true);
    assert.equal(terms.includes('한식'), false); // 넓은 업종 이름은 묻지 않는다
    for (const word of ['횟집', '점심', '회식', '숙성회']) assert.equal(terms.includes(word), true, word);
    assert.equal(terms.some((word) => word.includes('강남') || word.includes('압구정')), false);
    assert.deepEqual(mentionTerms({ name: '', category: '', address: '', keywords: [] }), []);
});

test('순위 결과가 내 지역의 검색 결과인지 한 줄로 알려 준다', () => {
    const regions = regionTerms(PHARMACY);
    // 네이버가 지역을 인식한 키워드
    const city = rankScope({ keyword: '청주약국', locality: { scope: 'area', medianKm: 12.7, region: '청주' }, regions });
    assert.deepEqual(city, { tone: 'ok', title: '네이버 인식 지역: 청주', text: '상위 매장까지 중간 거리 13km' });
    // 지역명이 없고 상위 매장이 100km 떨어진 경우(서울 중심 기준으로 조회됨)
    const far = rankScope({ keyword: '일반의약품', locality: { scope: 'far', medianKm: 101.2, region: null }, regions });
    assert.equal(far.tone, 'bad');
    assert.match(far.text, /101km/);
    assert.match(far.text, /서울 중심 기준/);
    // 지역명이 없고 거리도 애매한 경우
    assert.equal(rankScope({ keyword: '댄디컷', locality: { scope: 'area', medianKm: 8.64, region: null }, regions }).tone, 'warn');
    // 내가 모르는 지역 이름이지만 상위 매장이 모두 가까운 경우
    assert.equal(rankScope({ keyword: '각리약국', locality: { scope: 'local', medianKm: 0.84, region: null }, regions }).title, '동네 검색 결과');
    // 좌표를 못 받아도 키워드에 내 지역이 있으면 지역 키워드로 본다
    assert.deepEqual(rankScope({ keyword: '오창약국', locality: { scope: null, medianKm: null, region: null }, regions }), { tone: 'ok', title: '지역 키워드', text: null });
    assert.equal(rankScope({ keyword: '약국', locality: null, regions }).tone, 'warn');
});

/* ───────── 쓸모 관문: 쓸데없는 키워드가 추천·자동 순위 조회에 들어가지 않는다 ─────────
 * 아래 1~7 은 2026-11-17 견본 3종에서 실제로 나오던 것들입니다. 걸러낸 것은 excluded 에 이유와 함께 남습니다. */

const full = (sample, options = {}) => recommendKeywords({ place: sample.place, activity: sample.activity, rivals: sample.rivalPool, ...options });
const excludedOf = (result, term) => result.excluded.find((entry) => entry.term === term);
// 손으로 만든 시험용 매장(실제 매장 아님): 반대 사례와 가장자리 사례에 씁니다
const SHOP = { placeId: 't', address: '서울 강남구 테헤란로 1', jibunAddress: '서울 강남구 역삼동 1', keywords: [], conveniences: [], reviewVotes: [], reviewThemes: [], reviewMenus: [] };
const menu = (name, recommended = false) => ({ name, price: '9,000원', hasImage: true, recommended });
const RULES = ['broad', 'extra', 'vague', 'drink', 'otherBusiness', 'condition', 'rivalOnly', 'noBlog', 'channel', 'merged', 'region'];

test('관문 1 — 횟집의 곁들임 메뉴(김밥·소금김밥·보쌈)는 추천하지 않는다', () => {
    const result = full(FULL_RESTAURANT, { limit: 100 });
    // 전에는 8번째 "강남구청김밥", 그 뒤로 "압구정김밥"·"강남구청소금김밥"·"강남구청보쌈"이 있었다
    for (const word of ['김밥', '보쌈']) assert.equal(result.items.some((item) => item.keyword.includes(word)), false, word);
    assert.deepEqual(excludedOf(result, '김밥'), {
        term: '김밥', keywords: ['강남구청김밥', '압구정김밥'], rule: 'otherBusiness',
        reason: "메뉴판 34개 중 1개뿐이라 주력 메뉴로 보기 어렵고, '김밥'으로 검색하는 손님은 김밥집을 찾습니다.",
    });
    // 주간 인기 메뉴 1위(주문의 12%)여도 메뉴판 34개 중 1개인 곁들임이다. "김밥"으로 끝나는 이름도 같은 낱말로 본다
    assert.equal(excludedOf(result, '소금김밥').reason, "메뉴판 34개 중 1개뿐이라 주력 메뉴로 보기 어렵고, '소금김밥'으로 검색하는 손님은 김밥집을 찾습니다.");
    assert.equal(excludedOf(result, '보쌈').reason, "메뉴판 34개 중 2개뿐이라 주력 메뉴로 보기 어렵고, '보쌈'으로 검색하는 손님은 보쌈집을 찾습니다.");
    // 메뉴판을 읽지 못한 매장에서는 "곁들임"이라고 단정하지 않고, 근거를 찾지 못했다고만 말한다
    const unread = recommendKeywords({ place: RESTAURANT });
    assert.equal(keywordsOf(unread).some((word) => word.includes('김밥')), false);
    assert.equal(excludedOf(unread, '김밥').reason, "업종·매장 이름·메뉴판에서 주력 메뉴라는 근거를 찾지 못했고, '김밥'으로 검색하는 손님은 김밥집을 찾습니다.");
    // 걸러질 낱말은 블로그 언급도 묻지 않는다(전에는 8칸 중 2칸을 "김밥"·"소금김밥"에 썼다)
    assert.deepEqual(mentionTerms(FULL_RESTAURANT.place), ['횟집', '점심', '회식', '광어', '숙성회', '갈치', '모임', '데이트']);
});

test('관문 1 반대 사례 — 그 메뉴가 주력인 매장에서는 그대로 추천한다(김밥집·분식집·칼국수집·대표 메뉴)', () => {
    // 업종이 김밥
    const gimbap = recommendKeywords({ place: { ...SHOP, name: '시험김밥 역삼점', category: '김밥', reviewMenus: [{ label: '김밥', count: 90 }, { label: '참치김밥', count: 40 }], detail: { menus: [] } } });
    assert.deepEqual(keywordsOf(gimbap).slice(0, 2), ['강남김밥', '역삼김밥']);
    // 업종이 분식(이름에 김밥이 없어도 분식집이 당연히 파는 메뉴)
    const snack = recommendKeywords({ place: { ...SHOP, name: '시험분식', category: '분식', reviewMenus: [{ label: '떡볶이', count: 50 }, { label: '김밥', count: 40 }], detail: { menus: [] } } });
    for (const word of ['강남떡볶이', '강남김밥']) assert.equal(keywordsOf(snack).includes(word), true, word);
    // 업종은 '한식'이지만 메뉴판 대부분이 칼국수(6개 중 4개): 칼국수는 통과, 6개 중 1개인 만두는 걸린다
    const noodle = recommendKeywords({
        place: {
            ...SHOP, name: '시험손맛집', category: '한식',
            reviewMenus: [{ label: '칼국수', count: 80 }, { label: '바지락칼국수', count: 30 }, { label: '만두', count: 25 }],
            detail: { menus: [menu('바지락칼국수'), menu('얼큰칼국수'), menu('들깨칼국수'), menu('손칼국수'), menu('왕만두'), menu('수육')] },
        },
    });
    assert.deepEqual(keywordsOf(noodle), ['강남맛집', '강남칼국수', '역삼칼국수']);
    assert.equal(excludedOf(noodle, '만두').reason, "메뉴판 6개 중 1개뿐이라 주력 메뉴로 보기 어렵고, '만두'로 검색하는 손님은 만두집을 찾습니다.");
    // 메뉴판에서는 6개 중 1개지만 사장님이 대표 메뉴로 표시한 보쌈
    const featured = recommendKeywords({
        place: {
            ...SHOP, name: '시험한상', category: '한식', reviewMenus: [{ label: '보쌈', count: 30 }],
            detail: { menus: [menu('보쌈정식', true), menu('된장찌개'), menu('제육볶음'), menu('비빔밥'), menu('불고기'), menu('계란말이')] },
        },
    });
    assert.equal(keywordsOf(featured).includes('강남보쌈'), true);
    // 매장 이름에 있는 메뉴
    const named = recommendKeywords({ place: { ...SHOP, name: '시험보쌈 역삼점', category: '한식', reviewMenus: [{ label: '보쌈', count: 30 }], detail: { menus: [] } } });
    assert.equal(keywordsOf(named).includes('강남보쌈'), true);
});

test('관문 2 — 상위 매장에서 온 낱말도 내 매장 근거를 확인한다(21시에 닫는 약국의 "심야약국")', () => {
    const result = full(FULL_PHARMACY, { limit: 100 });
    // 전에는 12번째 "청주심야약국", 14번째 "오창심야약국"(상위 3곳이 '공공심야약국'을 쓴다는 이유)
    assert.equal(result.items.some((item) => item.keyword.includes('심야')), false);
    assert.deepEqual(excludedOf(result, '심야약국'), { term: '심야약국', keywords: ['청주심야약국', '오창심야약국'], rule: 'condition', reason: "밤 9시에 닫아 '심야약국'으로는 맞지 않습니다." });

    const rivals = [{ placeId: 'a', name: '가 약국', keywords: ['공공심야약국'] }, { placeId: 'b', name: '나 약국', keywords: ['공공심야약국'] }];
    const pharmacy = (end) => ({ ...SHOP, name: '시험약국', category: '약국', detail: end ? { hours: { registered: true, days: [{ day: '매일', start: '09:00', end }] } } : {} });
    // 반대 사례: 23시 넘어 여는 약국(자정을 넘겨 닫는 경우 포함)에는 그대로 추천한다
    assert.equal(keywordsOf(recommendKeywords({ place: pharmacy('23:30'), rivals })).includes('강남심야약국'), true);
    assert.equal(keywordsOf(recommendKeywords({ place: pharmacy('02:00'), rivals })).includes('강남심야약국'), true);
    assert.equal(excludedOf(recommendKeywords({ place: pharmacy('19:30'), rivals }), '심야약국').reason, "저녁 7시 30분에 닫아 '심야약국'으로는 맞지 않습니다.");
    // 영업시간을 모르면 시각을 지어내지 않고, 근거를 찾지 못했다고만 말한다
    assert.equal(excludedOf(recommendKeywords({ place: pharmacy(null), rivals }), '심야약국').reason,
        "상위 매장 2곳이 쓰는 말이지만, 내 매장의 리뷰·편의시설·영업시간에서는 '심야약국'의 근거를 찾지 못했습니다.");

    // 업종 연관어가 아닌 낱말: 내 매장 정보(리뷰·메뉴·소개)에 그 말이 있을 때만
    const sushi = { ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [{ label: '광어', count: 30 }], detail: { menus: [] } };
    const omakase = [{ placeId: 'a', name: '가', keywords: ['역삼오마카세'] }, { placeId: 'b', name: '나', keywords: ['강남오마카세'] }];
    const without = recommendKeywords({ place: sushi, rivals: omakase });
    assert.equal(keywordsOf(without).some((word) => word.includes('오마카세')), false);
    assert.deepEqual(excludedOf(without, '오마카세'), {
        term: '오마카세', keywords: ['강남오마카세', '역삼오마카세'], rule: 'rivalOnly',
        reason: "상위 매장 2곳이 쓰는 말이지만, 내 매장의 리뷰·메뉴·소개에서는 '오마카세'를 찾지 못했습니다.",
    });
    const withReview = recommendKeywords({ place: { ...sushi, reviewThemes: [{ label: '오마카세', count: 9 }] }, rivals: omakase });
    assert.deepEqual(withReview.items.find((item) => item.keyword === '강남오마카세').reasons.map((reason) => reason.text), ['상위 1곳 등록', "리뷰 주제 '오마카세'"]);
});

test('관문 3 — 낱말 다듬기: 띄어쓰기·괄호·매장 이름이 붙은 메뉴 이름, 술·음료·추가 메뉴·뜻이 넓은 낱말', () => {
    // 키워드에는 띄어쓰기가 없다(전에는 "강남구청대물 순살갈치조림")
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        const result = full(sample, { limit: 100 });
        for (const word of [...keywordsOf(result), ...result.excluded.flatMap((entry) => entry.keywords)]) assert.equal(/\s/.test(word), false, word);
    }
    const result = full(FULL_RESTAURANT, { limit: 100 });
    // 결제 단말의 "대물볼락구이"는 매장 이름(대물섬)을 떼어 리뷰의 "볼락구이"와 한 낱말이 된다(전에는 "강남구청대물볼락구이"가 따로 있었음)
    assert.equal(result.items.some((item) => item.term.startsWith('대물')) || result.excluded.some((entry) => entry.term.startsWith('대물')), false);
    assert.deepEqual(result.items.find((item) => item.keyword === '강남구청볼락구이').reasons.map((reason) => reason.text), ['리뷰 9회', '주간 인기 메뉴']);
    // 매장 이름의 첫 낱말과 두 글자만 겹치는 것("한우마을"의 "한우곰탕")은 재료 이름일 수 있어 떼지 않는다
    const hanwoo = recommendKeywords({
        place: { ...SHOP, name: '한우마을 역삼점', category: '한식', detail: { menus: [], pos: { popularMenus: [{ name: '한우곰탕', share: 30 }, { name: '한우마을 정식(2인)', share: 10 }] } } },
    });
    assert.equal(keywordsOf(hanwoo).includes('강남한우곰탕'), true);
    // 매장 이름을 떼고 남은 "정식"은 뜻이 넓어 걸린다
    assert.equal(excludedOf(hanwoo, '정식').rule, 'vague');

    // 술·음료, 뜻이 넓은 낱말, 추가 주문용 메뉴
    const sushi = recommendKeywords({
        place: {
            ...SHOP, name: '시험수산', category: '생선회',
            reviewMenus: [{ label: '와인', count: 6 }, { label: '튀김', count: 6 }, { label: '생선', count: 5 }, { label: '광어', count: 30 }, { label: '고노와다 추가', count: 4 }, { label: '아나고튀김', count: 4 }],
            detail: { menus: [] },
        },
        limit: 40,
    });
    assert.deepEqual(keywordsOf(sushi), ['강남생선회', '역삼생선회', '강남맛집', '강남광어', '강남아나고튀김']);
    assert.deepEqual(['와인', '튀김', '생선', '고노와다추가'].map((word) => excludedOf(sushi, word).rule), ['drink', 'vague', 'vague', 'extra']);
    assert.equal(excludedOf(sushi, '와인').reason, "술·음료 이름이라, '와인'으로 검색하는 손님은 그것을 주로 파는 곳을 찾습니다.");
    assert.equal(excludedOf(sushi, '튀김').reason, "'튀김'은 뜻이 넓어, 이 말만으로는 어떤 매장을 찾는지 가려지지 않습니다.");
    assert.equal(excludedOf(sushi, '고노와다추가').reason, '추가 주문용 메뉴 이름이라 매장을 찾는 말로는 맞지 않습니다.');
    // 반대 사례: 와인바의 와인(업종 이름과 겹치지만 다른 말이라 둘 다 남는다)
    const wineBar = recommendKeywords({ place: { ...SHOP, name: '시험 와인바', category: '와인바', reviewMenus: [{ label: '와인', count: 60 }, { label: '하우스와인', count: 12 }], detail: { menus: [] } } });
    for (const word of ['강남와인바', '강남와인']) assert.equal(keywordsOf(wineBar).includes(word), true, word);
    // 업종 이름이 바로 그 말이면 뜻이 넓은 낱말도 쓴다
    const fried = recommendKeywords({ place: { ...SHOP, name: '시험집', category: '튀김', reviewMenus: [{ label: '튀김', count: 30 }], detail: { menus: [] } } });
    assert.equal(keywordsOf(fried).includes('강남튀김'), true);
});

test('관문 4 — 넓은 업종 이름(한식)은 "지역+한식"으로 추천하지 않는다', () => {
    const result = full(FULL_RESTAURANT, { limit: 100 });
    // 전에는 28번째 "강남구청한식", 38번째 "압구정한식"(점수만 낮췄음)
    assert.equal(result.items.some((item) => item.term === '한식'), false);
    assert.deepEqual(excludedOf(result, '한식'), {
        term: '한식', keywords: ['강남구청한식', '압구정한식'], rule: 'broad',
        reason: "'한식'은 범위가 넓은 업종 이름이라, 지역을 붙여도 어떤 매장을 찾는 말인지 가려지지 않습니다.",
    });
    // 좁은 업종 이름은 그대로 가장 먼저 추천한다
    assert.equal(full(FULL_PHARMACY).items[0].keyword, '청주약국');
    assert.equal(keywordsOf(full(FULL_SALON)).includes('강남역남성전문미용실'), true);
});

test('관문 5 — 한쪽이 다른 쪽을 품는 메뉴 낱말은 하나로 묶는다', () => {
    const restaurant = full(FULL_RESTAURANT, { limit: 100 });
    // 광어(리뷰 34회)·광어회(13회) → 광어 / 갈치(12회)·갈치조림(10회)·순살갈치조림(결제) → 갈치
    assert.deepEqual(['광어회', '갈치조림', '순살갈치조림'].map((word) => [excludedOf(restaurant, word).rule, excludedOf(restaurant, word).into]), [['merged', '광어'], ['merged', '갈치'], ['merged', '갈치']]);
    assert.equal(excludedOf(restaurant, '광어회').reason, "'광어'와 겹치는 낱말이라 하나로 묶었습니다.");
    assert.deepEqual(restaurant.items.find((item) => item.keyword === '강남구청광어').merged, ['광어회']);
    assert.deepEqual(restaurant.items.find((item) => item.keyword === '강남구청갈치').merged, ['갈치조림', '순살갈치조림']);
    for (const word of ['광어회', '갈치조림']) assert.equal(restaurant.items.some((item) => item.term === word), false, word);
    // 등록 키워드 "댄디컷"과 예약 스타일 "시스루댄디컷"
    const salon = full(FULL_SALON, { limit: 100 });
    assert.equal(excludedOf(salon, '시스루댄디컷').into, '댄디컷');
    assert.equal(salon.items.some((item) => item.term === '시스루댄디컷'), false);
    // 업종 낱말·업종 연관어끼리는 묶지 않는다(약국·대형약국·동물약국은 서로 다른 검색어)
    const pharmacy = full(FULL_PHARMACY, { limit: 100 });
    for (const word of ['청주약국', '청주대형약국', '청주동물약국']) assert.equal(keywordsOf(pharmacy).includes(word), true, word);
    assert.equal(pharmacy.excluded.some((entry) => entry.rule === 'merged'), false);
    // 묶인 낱말이 없으면 merged 필드도 없다
    assert.equal('merged' in pharmacy.items[0], false);
});

test('관문 6 — 추천이 같은 낱말의 지역 바꿔치기로 채워지지 않는다', () => {
    // 약국: 전에는 12개 중 6개가 일반의약품·상비약·동물의약품 × 청주/오창이었다
    const pharmacy = full(FULL_PHARMACY);
    assert.deepEqual(keywordsOf(pharmacy), ['청주약국', '오창약국', '청주대형약국', '청원약국', '청주일반의약품', '청주상비약', '청주동물의약품', '청주영양제', '청주동물약국']);
    assert.deepEqual(excludedOf(pharmacy, '일반의약품'), {
        term: '일반의약품', keywords: ['오창일반의약품'], rule: 'region',
        reason: "'청주일반의약품'이 이미 있어, '일반의약품'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    // 지역을 둘 이상 권하는 것은 업종 낱말(가장 중요한 낱말은 3개)과 주력 낱말, 그리고 그 조합을 등록한 상위 매장이 있는 경우뿐이다
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        const result = full(sample, { limit: 100 });
        const byTerm = new Map();
        for (const item of result.items) byTerm.set(item.term, [...(byTerm.get(item.term) || []), item]);
        for (const [term, items] of byTerm) {
            if (items.length < 2) continue;
            const allowed = ['category', 'family'].includes(items[0].source) || ['횟집', '숙성회', '광어'].includes(term);
            assert.equal(allowed, true, `${term}: ${items.map((item) => item.keyword).join(', ')}`);
        }
    }
    const restaurant = full(FULL_RESTAURANT);
    assert.deepEqual(keywordsOf(restaurant), [
        '강남횟집', '논현횟집', '강남구청숙성회', '압구정숙성회', '강남구청광어', '강남구청맛집', '압구정광어', '강남구청모임', '강남구청갈치', '강남구청룸식당', '강남구청볼락구이',
    ]); // 12번째였던 "강남구청포장"은 받는 방법이라 빠졌고(관문 8), 더 채울 후보가 없어 11개다
    // "횟집"은 이미 두 지역으로 등록했지만 가장 중요한 낱말이라 하나 더(강남횟집), "논현횟집"은 그 조합을 등록한 상위 매장이 있어 권한다
    assert.deepEqual(restaurant.items.slice(0, 2).map((item) => item.reasons[0].text), ['상위 2곳 등록', '상위 1곳 등록']);
    assert.deepEqual(keywordsOf(full({ ...FULL_RESTAURANT, rivalPool: [] })).filter((word) => word.endsWith('횟집')), ['강남횟집']);
    // "숙성회"는 한 줄 소개와 대표 메뉴에 있는 주력 낱말이라 지역 2개, "점심"·"회식"은 이미 등록한 조합이 있어 더 권하지 않는다
    assert.equal(excludedOf(restaurant, '점심').reason, "'강남구청점심'이 이미 있어, '점심'에 지역만 바꾼 조합은 더 권하지 않습니다.");
    assert.deepEqual(excludedOf(restaurant, '회식').keywords, ['강남회식', '논현회식']);
    const salon = full(FULL_SALON);
    assert.deepEqual(keywordsOf(salon), [
        '강남역댄디컷', '강남미용실', '역삼미용실', '강남역남성전문미용실', '강남역다운펌', '강남역바버샵', '강남역볼륨매직', '강남남성전문미용실', '강남역쉐도우펌', '강남역남자머리', '강남역가르마펌', '강남역아이롱펌',
    ]);
});

test('관문 7 — 블로그 언급을 물어봤는데 0개이고 다른 근거도 없는 낱말은 뺀다', () => {
    const pharmacy = full(FULL_PHARMACY, { limit: 100 });
    // 전에는 17번째 "청주건강기능식품"(등록 키워드라는 것 말고는 근거가 없고 블로그 0/11)
    assert.equal(pharmacy.items.some((item) => item.term === '건강기능식품'), false);
    assert.deepEqual(excludedOf(pharmacy, '건강기능식품'), {
        term: '건강기능식품', keywords: ['청주건강기능식품', '오창건강기능식품'], rule: 'noBlog',
        reason: "블로그 후기 11개 가운데 '건강기능식품'이 나온 글이 없고, 리뷰·예약·상위 매장에서도 쓰이지 않습니다.",
    });
    // 등록 키워드 진단에도 같은 이유가 달리고, 지역만 붙인 조합을 권하지 않는다. 후기에서 더 많이 쓰는 말은 그대로 알려 준다
    const health = pharmacy.registered.find((entry) => entry.keyword === '건강기능식품');
    assert.deepEqual([health.concern.rule, health.suggest, health.spoken.keyword], ['noBlog', null, '청주영양제']);
    assert.equal(health.concern.reason, excludedOf(pharmacy, '건강기능식품').reason);
    // 블로그 언급을 묻지 않은 매장에서는 0개인지 알 수 없으므로 빼지 않는다
    assert.equal(keywordsOf(recommendKeywords({ place: FULL_PHARMACY.place, limit: 100 })).includes('청주건강기능식품'), true);
    // 블로그 0개여도 손님 리뷰에 341회 나오는 낱말(가르마펌)은 다른 근거가 있어 남긴다
    const salon = full(FULL_SALON, { limit: 100 });
    const garma = salon.items.find((item) => item.keyword === '강남역가르마펌');
    assert.deepEqual([garma.blog, garma.reasons.map((reason) => reason.text)], [0, ['등록 키워드', '리뷰 341회']]);
    assert.equal(salon.registered.find((entry) => entry.keyword === '가르마펌').concern, null);
});

test('관문 8 — 음식점의 "지역+포장"·"지역+배달"은 받는 방법이라 추천하지 않는다(꽃집의 꽃배달은 그대로)', () => {
    // 횟집: 편의시설에 '포장'이 있어 전에는 12번째로 "강남구청포장"을 추천했다
    const restaurant = full(FULL_RESTAURANT, { limit: 100 });
    assert.equal(FULL_RESTAURANT.place.conveniences.includes('포장') || (FULL_RESTAURANT.place.detail.facilities || []).includes('포장'), true);
    assert.equal(keywordsOf(restaurant).some((word) => word.endsWith('포장')), false);
    assert.deepEqual(excludedOf(restaurant, '포장'), {
        term: '포장', keywords: ['강남구청포장', '압구정포장'], rule: 'channel',
        reason: "'포장'은 가게 종류나 메뉴가 아니라 받는 방법이라, 이 말만으로는 어떤 가게를 찾는지 알 수 없습니다.",
    });
    // 배달도 같다. 매장에 그 사실이 있어도(편의시설 '배달') 가게를 찾는 말로는 권하지 않는다
    const chicken = recommendKeywords({ place: { ...SHOP, name: '시험치킨', category: '치킨,닭강정', conveniences: ['배달', '포장'] }, limit: 100 });
    assert.equal(keywordsOf(chicken).some((word) => /(포장|배달)$/.test(word)), false);
    assert.equal(excludedOf(chicken, '배달').reason, "'배달'은 가게 종류나 메뉴가 아니라 받는 방법이라, 이 말만으로는 어떤 가게를 찾는지 알 수 없습니다.");
    assert.equal(excludedOf(chicken, '포장').rule, 'channel');
    assert.equal(keywordsOf(chicken).some((word) => word.endsWith('치킨')), true); // 업종 낱말은 그대로 권한다
    // 사장님이 이미 등록한 "역삼배달"에는 같은 이유를 달아 준다
    const owned = recommendKeywords({ place: { ...SHOP, name: '시험치킨', category: '치킨,닭강정', keywords: ['역삼배달'] } });
    assert.equal(owned.registered[0].concern.rule, 'channel');

    // 반대 사례 1: 꽃집의 "꽃배달"은 업종 연관어로 따로 정한 낱말이라 그대로 권한다(근거: 편의시설 '배달')
    const flower = recommendKeywords({ place: { ...SHOP, name: '시험꽃집', category: '꽃집,꽃배달', conveniences: ['배달'] }, limit: 100 });
    assert.equal(keywordsOf(flower).some((word) => word.endsWith('꽃배달')), true);
    assert.equal(flower.excluded.some((entry) => entry.rule === 'channel'), false);
    // 반대 사례 2: "포장마차"는 가게 종류다(낱말이 통째로 '포장'일 때만 건다)
    const cart = recommendKeywords({ place: { ...SHOP, name: '시험포차', category: '포장마차' }, limit: 100 });
    assert.equal(keywordsOf(cart).some((word) => word.endsWith('포장마차')), true);
    assert.equal(cart.excluded.some((entry) => entry.rule === 'channel'), false);
});

test('자동 순위 조회: 근거가 등록 키워드(+블로그)뿐인 조합은 다른 후보 뒤로 미룬다', () => {
    // 약국: 전에는 "청주일반의약품"·"청주상비약"(등록한 낱말에 지역만 붙인 것)이 5개 안에 들어 네이버 조회를 썼다
    for (const rivals of [[], FULL_PHARMACY.rivalPool]) {
        const result = recommendKeywords({ place: FULL_PHARMACY.place, activity: FULL_PHARMACY.activity, rivals });
        assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, result).keywords, ['청주약국', '오창약국', '청주대형약국', '청주영양제', '청주동물약국'], `상위 매장 ${rivals.length}곳`);
        // 추천에서 뺀 것은 아니다(추천 목록에는 그대로 있고, 자리가 남으면 그 뒤에 조회한다)
        for (const word of ['청주일반의약품', '청주상비약', '청주동물의약품']) assert.equal(keywordsOf(result).includes(word), true, word);
        assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, result, 8).keywords,
            ['청주약국', '오창약국', '청주대형약국', '청주영양제', '청주동물약국', '청주일반의약품', '청주상비약', '청주동물의약품']);
    }
    // 음식점·미용실은 그대로다: 등록한 낱말이어도 예약·리뷰가 받치는 "강남역댄디컷"·"강남역다운펌"은 미루지 않는다
    for (const rivals of [[], FULL_SALON.rivalPool]) {
        const result = recommendKeywords({ place: FULL_SALON.place, activity: FULL_SALON.activity, rivals });
        assert.deepEqual([...pickRankKeywords(FULL_SALON.place, result).keywords].sort(), ['강남미용실', '강남역남성전문미용실', '강남역다운펌', '강남역댄디컷', '강남역미용실']);
    }
    assert.deepEqual(pickRankKeywords(FULL_RESTAURANT.place, full(FULL_RESTAURANT)).keywords, FULL_RESTAURANT.place.keywords);

    // 어떤 조합을 미루는지: 등록한 낱말에 지역을 붙인 조합 가운데 손님 말(리뷰·예약·결제)·매장 사실·그 조합을 등록한 상위 매장이 없는 것
    const item = (keyword, source, rivalCount, kinds) => ({ keyword, term: keyword.slice(2), source, rivalCount, reasons: kinds.map((kind) => ({ kind, text: kind })) });
    const made = {
        regions: [{ term: '역삼' }], registered: [],
        items: [
            item('역삼가나', 'registered', 0, ['registered', 'blog']), // 미룸: 등록 키워드 + 블로그뿐
            item('역삼다라', 'registered', 0, ['registered', 'rival']), // 미룸: 상위 매장이 지역 없이 낱말만 쓰는 것은 이 조합의 근거가 아님
            item('역삼마바', 'registered', 1, ['rival', 'registered']), // 그 조합을 등록한 상위 매장이 있음
            item('역삼사아', 'registered', 0, ['registered', 'review']), // 손님이 리뷰에서 말함
            item('역삼자차', 'related', 0, ['fact', 'blog']), // 업종 연관어(매장 사실)
            item('역삼카타', 'category', 0, ['category']), // 업종 낱말
        ],
    };
    assert.deepEqual(pickRankKeywords({ keywords: [] }, made, 4).keywords, ['역삼마바', '역삼사아', '역삼자차', '역삼카타']);
    assert.deepEqual(pickRankKeywords({ keywords: [] }, made, 6).keywords, ['역삼마바', '역삼사아', '역삼자차', '역삼카타', '역삼가나', '역삼다라']);
    assert.deepEqual(pickRankKeywords({ keywords: [] }, made, 6).added.length, 6);
});

test('등록 키워드 진단: 이미 등록한 키워드가 관문에 걸리면 concern 에 이유를 단다(읽은 자료와 어긋날 때만)', () => {
    // 견본 3종: 걸리는 것은 약국의 "건강기능식품" 하나
    assert.deepEqual(full(FULL_PHARMACY).registered.map((entry) => entry.concern?.rule ?? null), [null, 'noBlog', null, null]);
    for (const sample of [FULL_RESTAURANT, FULL_SALON]) assert.equal(full(sample).registered.every((entry) => entry.concern === null), true);

    // 횟집이 "김밥"을 등록: 메뉴판 20개 중 1개
    const board = [...Array.from({ length: 19 }, (_, index) => menu(`회 ${index}`)), menu('소금김밥')];
    const sushi = { ...SHOP, name: '시험수산', category: '생선회', keywords: ['역삼횟집', '역삼김밥'], reviewMenus: [{ label: '김밥', count: 30 }] };
    const flagged = recommendKeywords({ place: { ...sushi, detail: { menus: board } } });
    assert.deepEqual(flagged.registered.map((entry) => entry.concern), [
        null,
        { rule: 'otherBusiness', reason: "메뉴판 20개 중 1개뿐이라 주력 메뉴로 보기 어렵고, '김밥'으로 검색하는 손님은 김밥집을 찾습니다." },
    ]);
    assert.equal(keywordsOf(flagged).some((word) => word.includes('김밥')), false);
    // 메뉴판을 읽지 못했으면 사장님의 선택과 어긋난다고 말할 자료가 없으므로 걸지 않는다
    const unread = recommendKeywords({ place: { ...sushi, detail: { menus: [] } } });
    assert.equal(unread.registered.every((entry) => entry.concern === null), true);
    // 밤 9시에 닫는데 "심야약국"을 등록
    const pharmacy = recommendKeywords({
        place: { ...SHOP, name: '시험약국', category: '약국', keywords: ['역삼심야약국'], detail: { hours: { registered: true, days: [{ day: '매일', start: '09:00', end: '21:00' }] } } },
    });
    assert.deepEqual(pharmacy.registered[0].concern, { rule: 'condition', reason: "밤 9시에 닫아 '심야약국'으로는 맞지 않습니다." });
    // 넓은 업종 이름을 등록
    const broad = recommendKeywords({ place: { ...SHOP, name: '시험식당', category: '한식', keywords: ['역삼한식'], detail: { menus: [] } } });
    assert.equal(broad.registered[0].concern.rule, 'broad');
});

test('등록 키워드가 "지역 + 업종 연관어"일 때 앞부분을 지역으로 잘못 읽지 않는다', () => {
    // 전에는 "청주대형약국"의 "청주대형"을 지역으로 읽어 "청주대형일반의약품"·"청주대형대형약국"을 추천했다
    const pharmacy = { ...FULL_PHARMACY.place, keywords: ['청주대형약국', '일반의약품'] };
    assert.deepEqual(regionTerms(pharmacy).map((region) => region.term), ['청주', '오창', '청원']);
    const result = recommendKeywords({ place: pharmacy, limit: 100 });
    assert.equal(keywordsOf(result).some((word) => word.includes('청주대형')), false);
    assert.equal(result.registered[0].core, '대형약국');
    assert.deepEqual(regionTerms({ ...FULL_RESTAURANT.place, keywords: ['강남구청룸식당'] }).map((region) => region.term), ['강남구청', '강남', '논현']);
    assert.deepEqual(regionTerms({ ...FULL_SALON.place, keywords: ['강남역1인미용실'] }).map((region) => region.term), ['강남역', '강남', '역삼']);
    // 주소에 없는 지역("압구정")을 등록 키워드에서 읽는 것은 그대로다
    assert.equal(regionTerms(FULL_RESTAURANT.place).some((region) => region.term === '압구정' && region.scope === 'custom'), true);
});

test('걸러낸 것(excluded)의 모양과, 추천·자동 순위 조회에는 관문을 통과한 것만 나온다는 것', () => {
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        const all = full(sample, { limit: 100 });
        const passedWords = new Set(keywordsOf(all));
        for (const entry of all.excluded) {
            assert.equal(RULES.includes(entry.rule), true, entry.rule);
            assert.equal(typeof entry.term === 'string' && entry.term.length >= 2, true);
            assert.equal(Array.isArray(entry.keywords) && entry.keywords.length >= 1, true, entry.term);
            // 이유는 사장님이 읽을 한 문장이고, 가진 자료로 말할 수 없는 "검색량"은 쓰지 않는다
            assert.equal(/^[^.]+\.$/.test(entry.reason), true, entry.reason);
            assert.equal(/검색량|조회수/.test(entry.reason), false, entry.reason);
            assert.equal(Object.keys(entry).every((key) => ['term', 'keywords', 'rule', 'reason', 'into'].includes(key)), true);
            // 걸러낸 조합은 추천에 없다
            for (const word of entry.keywords) assert.equal(passedWords.has(word), false, word);
        }
        // 자동 순위 조회: 등록 키워드(지역 있음) + 추천에 있는 것만
        const top = full(sample);
        const pick = pickRankKeywords(sample.place, top);
        const allowed = new Set([...sample.place.keywords, ...keywordsOf(top)]);
        for (const word of pick.keywords) assert.equal(allowed.has(word), true, word);
        // 첫 분석(상위 매장 키워드를 읽기 전)에도 마찬가지
        const first = recommendKeywords({ place: sample.place, activity: sample.activity });
        for (const word of pickRankKeywords(sample.place, first).added) assert.equal(keywordsOf(first).includes(word), true, word);
    }
    assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, full(FULL_PHARMACY)).keywords, ['청주약국', '오창약국', '청주대형약국', '청주영양제', '청주동물약국']);
    assert.deepEqual(pickRankKeywords(FULL_SALON.place, full(FULL_SALON)).keywords, ['강남역미용실', '강남역댄디컷', '강남미용실', '강남역남성전문미용실', '강남역다운펌']);
    assert.deepEqual(pickRankKeywords(FULL_RESTAURANT.place, full(FULL_RESTAURANT)).keywords, FULL_RESTAURANT.place.keywords);
    // 매장이 없으면 빈 목록
    assert.deepEqual(recommendKeywords({ place: null }).excluded, []);
});
