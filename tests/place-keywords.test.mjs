import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAddress, regionTerms, keywordHasRegion, keywordCore, familyOf,
    mentionTerms, recommendKeywords, pickRankKeywords, rankScope,
} from '../lib/place-keywords.js';

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
    // 내 매장에 근거가 없어도 상위 두 곳 이상이 쓰는 낱말은 후보로 올린다
    const night = recommendKeywords({ place: PHARMACY, rivals, limit: 40 }).items.find((item) => item.keyword === '청주심야약국');
    assert.equal(night.source, 'rival');
    assert.equal(night.reasons[0].text, "상위 2곳이 '심야약국' 사용");
});

test('음식점: "맛집"은 순위 확인용으로만 내고, 넓은 업종 이름(한식)은 뒤로 미룬다', () => {
    const result = recommendKeywords({ place: RESTAURANT });
    const best = result.items.find((item) => item.keyword === '강남구청맛집');
    assert.equal(best.registrable, false);
    assert.equal(result.items.some((item) => item.term === '한식'), false); // 12개 안에 들지 못함
    assert.equal(keywordsOf(result).includes('강남구청숙성회'), true);
    // 이미 등록한 조합은 추천에서 빼고, 아직 안 쓴 지역과의 조합을 낸다
    assert.equal(keywordsOf(result).includes('강남구청횟집'), false);
    assert.equal(keywordsOf(result).includes('강남횟집'), true);
    assert.equal(result.registered.every((entry) => entry.hasRegion), true);
    assert.equal(result.hasRegionKeyword, true);
    // "회식"은 손님이 고른 좋은 점으로 뒷받침된다
    assert.match(result.items.find((item) => item.keyword === '강남회식').reasons.map((reason) => reason.text).join(' '), /단체모임 하기 좋아요/);
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
    assert.equal(pharmacy.keywords.length, 5);
    assert.deepEqual(pharmacy.keywords.slice(0, 2), ['청주약국', '오창약국']);
    assert.deepEqual(pharmacy.skipped, ['일반의약품', '건강기능식품', '동물의약품', '상비약']);
    assert.deepEqual(pharmacy.added, pharmacy.keywords);
    // 낱말이 겹치지 않게 고른다(가장 중요한 낱말만 지역 2개)
    assert.equal(pharmacy.keywords.filter((word) => word.endsWith('약국') && !word.includes('대형')).length, 2);

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
