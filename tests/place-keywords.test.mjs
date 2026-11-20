import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAddress, regionTerms, keywordHasRegion, keywordCore, familyOf,
    mentionTerms, recommendKeywords, pickRankKeywords, rankScope,
} from '../lib/place-keywords.js';
import { rankLocality } from '../lib/naver-place.js';
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
    // 추천 순서는 근거 점수 순이다(처방전 5칸과 같은 기준): 손님이 고른 좋은 점이 받치는 대형약국이 업종 이름만 근거인 청주·오창약국보다 앞
    assert.deepEqual(words.slice(0, 3), ['청주대형약국', '청주약국', '오창약국']);
    assert.equal(result.items[0].score > result.items[1].score && result.items[1].score >= result.items[2].score, true);
    // 등록 키워드의 분류 이름(건강기능식품·동물의약품)은 지역을 붙이지 않고, 일상에서 흔히 쓰는 말(영양제·동물약국)로 만든다(관문 '차')
    for (const word of ['청주대형약국', '청주영양제', '청주동물약국']) assert.equal(words.includes(word), true, word);
    for (const word of ['청주건강기능식품', '청주동물의약품', '청주일반의약품', '청주상비약']) assert.equal(words.includes(word), false, word);
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
    assert.deepEqual(health.spoken, { term: '영양제', blog: 4, keyword: '청주영양제', everyPost: false });
    // 블로그에 6번 나오는 등록 키워드여도 약의 분류 이름이면 지역만 붙인 조합을 제안하지 않고, 일상에서 흔히 쓰는 말을 알려 준다
    // (전에는 "청주일반의약품"을 제안했다)
    const otc = result.registered.find((entry) => entry.keyword === '일반의약품');
    assert.equal(otc.suggest, null);
    // "약국"은 블로그 후기 11개 모두에 나오는 낱말이라 everyPost: 화면은 이 개수를 등록 낱말과 견주는 근거로 쓰지 않는다
    assert.deepEqual(otc.spoken, { term: '약국', blog: 11, keyword: '청주약국', everyPost: true });
    assert.equal(otc.concern.rule, 'classification');
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
    // 이미 등록한 조합은 추천에서 빼고, 가장 중요한 낱말 "횟집"은 등록한 것을 포함해 지역 둘까지다(이미 둘을 등록했으니 새 조합 없음).
    // 셋째부터는 그 조합을 그대로 등록한 상위 매장이 있을 때만 권한다(상위 매장 자료가 있는 견본으로 아래에서 확인)
    assert.equal(keywordsOf(result).includes('강남구청횟집'), false);
    assert.equal(keywordsOf(result).some((word) => word.endsWith('횟집')), false);
    // 같은 낱말은 등록한 칸을 포함해 두 칸까지다(그 조합을 그대로 등록한 상위 매장이 있어도). 순위 표가 없으면 등록한 두 칸(강남구청횟집·압구정횟집)이 모두 살아 있어 새 조합이 없다.
    assert.deepEqual(keywordsOf(full(FULL_RESTAURANT, { limit: 60 })).filter((word) => word.endsWith('횟집')), []);
    // 순위 표에서 압구정횟집이 41위로 확인되면 그 칸은 바꿀 칸이라 세지 않는다: 강남구청횟집(3위) 한 칸 + 상위 매장 2곳이 등록한 강남횟집 한 칸(논현횟집은 칸이 없어 뺌).
    assert.deepEqual(keywordsOf(full(FULL_RESTAURANT, { limit: 60, ranks: FULL_RESTAURANT.ranks })).filter((word) => word.endsWith('횟집')), ['강남횟집']);
    // 정렬: 등록할 수 있는 추천이 먼저, 순위 확인용(맛집)은 맨 뒤
    assert.equal(result.items.at(-1).keyword, '강남구청맛집');
    assert.equal(result.items.slice(0, -1).every((item) => item.registrable), true);
    assert.equal(result.registered.every((entry) => entry.hasRegion), true);
    assert.equal(result.hasRegionKeyword, true);
    // "회식"은 이미 두 지역으로 등록해 지역만 바꾼 조합("강남회식")은 더 권하지 않는다(쓸모 관문 '바').
    // 전에는 여기서 "강남회식"의 근거를 확인했는데, 그 조합이 추천에서 빠져 등록 키워드가 하나뿐인 매장으로 같은 근거를 확인한다.
    assert.equal(keywordsOf(result).includes('강남회식'), false);
    assert.deepEqual(result.excluded.find((entry) => entry.term === '회식'), {
        term: '회식', keywords: ['강남회식', '논현회식'], rule: 'region',
        reason: "'강남구청회식'·'압구정회식'은 이미 등록한 키워드라, '회식'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    const fresh = recommendKeywords({ place: { ...RESTAURANT, keywords: ['강남구청횟집'] } });
    // "회식"은 손님이 고른 좋은 점으로 뒷받침된다
    assert.match(fresh.items.find((item) => item.keyword === '강남구청회식').reasons.map((reason) => reason.text).join(' '), /단체모임 하기 좋아요/);
});

test('한 글자 근거("룸")는 통째로 같을 때만 인정한다', () => {
    const noRoom = { ...RESTAURANT, name: '블룸식당 강남점', keywords: [], detail: { ...RESTAURANT.detail, seats: [] } };
    assert.equal(recommendKeywords({ place: noRoom, limit: 60 }).items.some((item) => item.term === '룸식당'), false);
    const room = { ...noRoom, detail: { ...RESTAURANT.detail, seats: ['룸'] } };
    // 좌석 '룸'이 근거 하나뿐이면 추천하지 않고 이유를 남긴다(관문 '타'). 리뷰·블로그 후기에 나오면 다시 권한다
    const alone = recommendKeywords({ place: room, limit: 60 });
    assert.equal(alone.items.some((item) => item.term === '룸식당'), false);
    assert.equal(excludedOf(alone, '룸식당').rule, 'thin');
    const talked = recommendKeywords({ place: room, activity: { mentions: { blogTotal: 10, terms: [{ term: '룸식당', count: 3 }] } }, limit: 60 });
    assert.equal(talked.items.some((item) => item.term === '룸식당'), true);
});

test('미용실: 등록한 시술 키워드에 지역을 붙이고 예약·리뷰 수를 근거로 단다', () => {
    const result = recommendKeywords({ place: SALON });
    const dandy = result.items.find((item) => item.keyword === '강남역댄디컷');
    // 새로 권하는 "강남역댄디컷"은 등록한 키워드 자체가 아니라, 등록한 키워드 "댄디컷"의 낱말에 지역을 붙인 조합이다
    assert.deepEqual(dandy.reasons.map((reason) => reason.text), ['등록 키워드의 낱말', '예약 554건', '리뷰 2,452회']);
    assert.equal(result.registered.find((entry) => entry.keyword === '댄디컷').suggest, '강남역댄디컷');
    assert.equal(result.registered.find((entry) => entry.keyword === '강남역미용실').hasRegion, true);
    assert.equal(familyOf(SALON).key, 'hair');
});

test('순위를 볼 키워드: 지역 있는 등록 키워드를 먼저, 남는 자리는 추천으로 채운다', () => {
    const pharmacy = pickRankKeywords(PHARMACY, recommendKeywords({ place: PHARMACY, activity: PHARMACY_MENTIONS }));
    // 낱말이 겹치지 않게 고른다(가장 중요한 낱말 "약국"만 지역 2개). 등록 키워드에 지역만 붙인 조합(청주일반의약품·청주상비약)은
    // 다른 근거가 없어 뒤로 가고, 매장 사실·손님 말이 받치는 조합이 먼저 들어온다
    assert.deepEqual(pharmacy.keywords, ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국']);
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
const RULES = ['broad', 'extra', 'vague', 'drink', 'otherBusiness', 'condition', 'rivalOnly', 'noBlog', 'channel', 'merged', 'region', 'offMain', 'classification', 'rank', 'thin'];

test('관문 1 — 횟집의 곁들임 메뉴(김밥·소금김밥·보쌈)는 추천하지 않는다', () => {
    const result = full(FULL_RESTAURANT, { limit: 100 });
    // 전에는 8번째 "강남구청김밥", 그 뒤로 "압구정김밥"·"강남구청소금김밥"·"강남구청보쌈"이 있었다
    for (const word of ['김밥', '보쌈']) assert.equal(result.items.some((item) => item.keyword.includes(word)), false, word);
    // 주간 인기 메뉴 1위(주문의 12%)인 "소금김밥"도 메뉴판 34개 중 1개라 지역을 붙인 키워드로는 권하지 않는다. "김밥"으로 끝나는 이름도 같은 낱말로 보고,
    // 이유가 같은 "김밥"과 한 줄로 묶는다(term 은 짧은 낱말, keywords 는 낱말마다 조합 하나씩).
    // 이유는 손님 반응과 어긋나는 단정("주력 메뉴로 보기 어렵고")을 하지 않는다: 많이 찾는다는 사실(리뷰 37회·주간 인기 1위 12%·AI 브리핑)을 먼저 적고,
    // 왜 지역을 붙인 키워드로는 권하지 않는지, 대신 쓸 자리(메뉴 설명·소식·소개글)를 말한다. 같은 사실은 처방전이 쓰도록 구조화해 둔다(popular·useIn).
    assert.deepEqual(excludedOf(result, '김밥'), {
        term: '김밥', keywords: ['강남구청김밥', '강남구청소금김밥'], rule: 'otherBusiness',
        reason: "'김밥'·'소금김밥'은 손님이 많이 찾는 메뉴입니다(리뷰 '김밥' 37회, 주간 인기 메뉴 1위 '소금김밥' 주문의 12%, AI 브리핑에도 나옴). "
            + '다만 이 말은 김밥집을 가리키는 메뉴 이름인데, 이 매장은 회 메뉴가 중심이라 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 34개 중 1개). '
            + '메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.',
        // 화면이 "사실 / 이유 / 쓰기 좋은 곳" 세 줄로 그리는 조각(reason = lead + "다만 " + why + 쓸 자리). 사실 문장이 낱말을 이미 말했으므로 이유는 "이 말로"
        lead: "'김밥'·'소금김밥'은 손님이 많이 찾는 메뉴입니다(리뷰 '김밥' 37회, 주간 인기 메뉴 1위 '소금김밥' 주문의 12%, AI 브리핑에도 나옴).",
        why: '이 말은 김밥집을 가리키는 메뉴 이름인데, 이 매장은 회 메뉴가 중심이라 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 34개 중 1개).',
        words: ['김밥', '소금김밥'],
        popular: { reviews: 37, reviewWord: '김밥', reviewRank: 1, posRank: 1, posShare: 12, posName: '소금김밥', briefing: true, menus: 1, menuTotal: 34 },
        useIn: ['메뉴 설명', '소식', '소개글'],
    });
    assert.equal(excludedOf(result, '소금김밥'), undefined);
    const ssam = excludedOf(result, '보쌈');
    assert.equal(ssam.reason, "'보쌈'은 리뷰에 나오는 메뉴입니다(리뷰 '보쌈' 6회). 다만 이 말은 보쌈집을 가리키는 메뉴 이름인데, 이 매장은 회 메뉴가 중심이라 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 34개 중 2개). 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.");
    assert.deepEqual([ssam.lead, ssam.why], ["'보쌈'은 리뷰에 나오는 메뉴입니다(리뷰 '보쌈' 6회).", '이 말은 보쌈집을 가리키는 메뉴 이름인데, 이 매장은 회 메뉴가 중심이라 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 34개 중 2개).']);
    assert.deepEqual(ssam.popular, { reviews: 6, reviewWord: '보쌈', reviewRank: 8, posRank: null, posShare: null, posName: null, briefing: false, menus: 2, menuTotal: 34 });
    // 메뉴판을 읽지 못한 매장에서는 "곁들임"이라고 단정하지 않고, 근거를 찾지 못했다고만 말한다
    const unread = recommendKeywords({ place: RESTAURANT });
    assert.equal(keywordsOf(unread).some((word) => word.includes('김밥')), false);
    assert.equal(excludedOf(unread, '김밥').reason,
        "'김밥'은 손님이 많이 찾는 메뉴입니다(리뷰 '김밥' 37회). 다만 업종·매장 이름·메뉴판에서 주력 메뉴라는 근거를 찾지 못했고, 이 말은 김밥집을 가리키는 메뉴 이름입니다. 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.");
    // 걸러질 낱말은 블로그 언급도 묻지 않는다(전에는 8칸 중 2칸을 "김밥"·"소금김밥"에 썼다. 주력 갈래 밖 곁들임 "갈치"도 이제 묻지 않는다)
    assert.deepEqual(mentionTerms(FULL_RESTAURANT.place), ['횟집', '점심', '회식', '광어', '숙성회', '모임', '데이트', '혼밥']);
});

test('관문 9(자) — 메뉴 낱말은 매장의 주력 갈래에 맞을 때만: 횟집의 갈치·볼락구이는 곁들임', () => {
    const result = full(FULL_RESTAURANT, { limit: 100 });
    // 전에는 "강남구청갈치"·"강남구청볼락구이"가 남아, 김밥은 빼면서 갈치·볼락구이는 두는 어긋난 기준이었다
    for (const word of ['갈치', '볼락구이']) assert.equal(result.items.some((item) => item.keyword.includes(word)), false, word);
    // 주력 갈래는 등록 키워드의 '횟집'(사이시옷을 뗀 '회')에서 읽고, 메뉴판에서 이름이 '회'·'사시미'로 끝나는 낱말이 든 항목이 회 메뉴다
    // 이유는 "곁들임이라"처럼 손님 반응과 어긋나는 말을 하지 않는다(같은 화면의 리뷰·주간 인기 메뉴에 나오므로): 사실을 먼저 적고, 왜 지역을 붙인 키워드로는 권하지 않는지, 대신 쓸 자리를 말한다
    const where = "등록 키워드의 '횟집'으로 보면 이 매장은 회 메뉴가 중심(읽어 온 메뉴 34개 중 11개)이라";
    const use = '메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.';
    // 갈치·갈치조림·순살갈치조림은 같은 메뉴 하나("(한정)대물 순살 갈치조림")에서 나온 낱말이라 한 줄로 묶는다
    assert.deepEqual(excludedOf(result, '갈치'), {
        term: '갈치', keywords: ['강남구청갈치', '강남구청갈치조림', '강남구청순살갈치조림'], rule: 'offMain',
        // (같은 낱말 나열이 한 문장 안에 두 번 나오지 않게, 이유 문장은 "이 낱말들은")
        reason: "'갈치'·'갈치조림'·'순살갈치조림'은 리뷰·결제에 나오는 메뉴입니다(리뷰 '갈치' 12회·'갈치조림' 10회, 주간 인기 메뉴 4위 '대물 순살갈치조림' 주문의 5%). "
            + `다만 ${where}, 회 메뉴로는 보이지 않고 메뉴 1개에만 나오는 이 낱말들은 지역을 붙인 키워드로는 따로 권하지 않습니다. ${use}`,
        lead: "'갈치'·'갈치조림'·'순살갈치조림'은 리뷰·결제에 나오는 메뉴입니다(리뷰 '갈치' 12회·'갈치조림' 10회, 주간 인기 메뉴 4위 '대물 순살갈치조림' 주문의 5%).",
        why: `${where}, 회 메뉴로는 보이지 않고 메뉴 1개에만 나오는 이 낱말들은 지역을 붙인 키워드로는 따로 권하지 않습니다.`,
        words: ['갈치', '갈치조림', '순살갈치조림'],
        popular: { reviews: 12, reviewWord: '갈치', reviewRank: 5, posRank: 4, posShare: 5, posName: '대물 순살갈치조림', briefing: false, menus: 1, menuTotal: 34 },
        useIn: ['메뉴 설명', '소식', '소개글'],
    });
    assert.deepEqual(['갈치조림', '순살갈치조림'].map((word) => excludedOf(result, word)), [undefined, undefined]);
    // 결제 단말의 "대물볼락구이"(주간 인기 3위, 주문의 6%)·메뉴판의 "대물뽈락구이"는 회 메뉴가 아니다. 많이 찾는 메뉴라는 사실을 먼저 인정한다
    assert.equal(excludedOf(result, '볼락구이').reason, "'볼락구이'는 손님이 많이 찾는 메뉴입니다(리뷰 '볼락구이' 9회, 주간 인기 메뉴 3위 '대물볼락구이' 주문의 6%). "
        + `다만 ${where}, 회 메뉴로는 보이지 않는 이 낱말은 지역을 붙인 키워드로는 따로 권하지 않습니다. ${use}`);
    // 곁들임이라는 단정은 어느 이유에도 없다
    for (const entry of result.excluded) assert.equal(/곁들임|주력 메뉴로 보기 어렵/.test(entry.reason), false, entry.reason);
    assert.deepEqual(result.excluded.filter((entry) => entry.rule === 'offMain').map((entry) => entry.term), ['갈치', '볼락구이']);
    // 회 갈래 낱말은 통과: 끝말이 '회'(숙성회)이거나 회 메뉴의 이름에 들어 있음(광어 → "대물 숙성회 정식(광어)", 대방어 → "대방어 숙성회")
    for (const word of ['강남구청숙성회', '강남구청광어', '강남구청대방어']) assert.equal(keywordsOf(result).includes(word), true, word);
    // 김밥·보쌈은 그 자체가 다른 업종 이름이라 전처럼 '가'에 걸린다(이유도 그대로)
    assert.deepEqual(['김밥', '보쌈'].map((word) => excludedOf(result, word).rule), ['otherBusiness', 'otherBusiness']);

    // 반대 사례: 갈치조림집의 갈치(매장 이름), 생선구이집의 볼락구이(업종 '생선구이' → 갈래 '구이')
    const board = (names) => names.map((name) => menu(name));
    const galchi = recommendKeywords({
        place: {
            ...SHOP, name: '시험갈치조림 역삼점', category: '한식', reviewMenus: [{ label: '갈치', count: 40 }, { label: '고등어', count: 9 }],
            detail: { menus: board(['갈치조림(2인)', '갈치조림(3인)', '고등어조림', '계란말이', '공기밥', '된장찌개']) },
        },
    });
    assert.equal(keywordsOf(galchi).includes('강남갈치'), true);
    assert.equal(keywordsOf(galchi).includes('강남고등어'), true); // 고등어도 조림 메뉴에 들어 있다
    const grill = recommendKeywords({
        place: {
            ...SHOP, name: '시험식당', category: '생선구이', reviewMenus: [{ label: '볼락구이', count: 30 }, { label: '계란찜', count: 8 }],
            detail: { menus: board(['볼락구이', '고등어구이', '삼치구이', '갈치구이', '계란찜', '된장찌개']) },
        },
    });
    assert.equal(keywordsOf(grill).includes('강남볼락구이'), true);
    // 리뷰·결제에 나오지 않는 메뉴("계란찜"은 리뷰 8회)이면 사실만 적고 단정하지 않는다
    assert.equal(excludedOf(grill, '계란찜').reason, "'계란찜'은 리뷰에 나오는 메뉴입니다(리뷰 '계란찜' 8회). 다만 업종 '생선구이'로 보면 이 매장은 구이 메뉴가 중심(읽어 온 메뉴 6개 중 4개)이라, 구이 메뉴로는 보이지 않고 메뉴 1개에만 나오는 이 낱말은 지역을 붙인 키워드로는 따로 권하지 않습니다. 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.");
    // 곁들임이어도 주력 근거(대표 메뉴 표시)가 있으면 통과한다
    const featured = recommendKeywords({
        place: {
            ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [{ label: '광어', count: 30 }, { label: '갈치조림', count: 20 }],
            detail: { menus: [menu('광어회'), menu('우럭회'), menu('모듬회'), menu('갈치조림', true), menu('매운탕'), menu('공기밥')] },
        },
    });
    assert.equal(keywordsOf(featured).includes('강남갈치조림'), true);
    // 메뉴판을 읽지 못했거나(5개 미만) 갈래를 알 수 없는 매장(와인바·미용실)에는 쓰지 않는다
    const unread = recommendKeywords({ place: { ...FULL_RESTAURANT.place, detail: { ...FULL_RESTAURANT.place.detail, menus: [] } }, limit: 100 });
    assert.equal(unread.excluded.some((entry) => entry.rule === 'offMain'), false);
    assert.equal(full(FULL_SALON, { limit: 100 }).excluded.some((entry) => entry.rule === 'offMain'), false);
});

test('관문 10 — 메뉴판·소식에 되풀이해 나오는 낱말도 후보로(대방어), 품는 말은 더 많이 쓰인 쪽으로', () => {
    // "대방어 정식"·"대방어 숙성회"·소식 "대방어 입고 안내": 리뷰 메뉴 상위 8개에 없어 전에는 후보에 없었다
    const result = full(FULL_RESTAURANT, { limit: 100 });
    const daebang = result.items.find((item) => item.keyword === '강남구청대방어');
    assert.deepEqual([daebang.source, daebang.reasons.map((reason) => reason.text)], ['board', ["메뉴 '대방어 정식'", "메뉴 '대방어 숙성회'", "소식 '대방어 입고 안내'"]]);
    // 소식을 읽지 못하면 메뉴판 두 항목뿐이라(세 항목 미만) 후보로 올리지 않는다. 두 항목에만 나오는 "카르파쵸"·"도미"도 그래서 후보가 아니다
    const noFeed = recommendKeywords({ place: FULL_RESTAURANT.place, activity: { ...FULL_RESTAURANT.activity, feeds: null }, limit: 100 });
    assert.equal(noFeed.items.some((item) => item.term === '대방어'), false);
    for (const word of ['카르파쵸', '도미', '정식', '대물']) assert.equal(result.items.some((item) => item.term === word) || result.excluded.some((entry) => entry.term === word), false, word);
    // 낱말은 메뉴판·소식·리뷰에서 그 말 그대로 쓰인 횟수가 많은 쪽: 대방어(메뉴판 2 + 소식 1 = 3) · 방어(리뷰 3) → 같으면 매장이 쓴 이름
    assert.equal(result.items.some((item) => item.term === '방어'), false);
    const moreSaid = recommendKeywords({
        place: { ...FULL_RESTAURANT.place, reviewMenus: FULL_RESTAURANT.place.reviewMenus.map((entry) => (entry.label === '방어' ? { ...entry, count: 8 } : entry)) },
        activity: FULL_RESTAURANT.activity, rivals: FULL_RESTAURANT.rivalPool, limit: 100,
    });
    assert.equal(moreSaid.items.some((item) => item.keyword === '강남구청방어'), true);
    assert.equal(moreSaid.items.some((item) => item.term === '대방어'), false);
    // 계절(제철)은 짐작하지 않는다
    for (const item of result.items) assert.equal(item.reasons.some((reason) => /제철|겨울|여름|계절/.test(reason.text)), false, item.keyword);
    // 메뉴판 세 항목에 되풀이돼도 시·도 이름·원산지·크기 같은 말은 메뉴 낱말이 아니다(흑돼지만 후보)
    const pork = recommendKeywords({
        place: {
            ...SHOP, name: '시험고깃집', category: '돼지고기구이', reviewMenus: [],
            detail: { menus: ['제주 흑돼지 오겹살(국내산)', '제주 흑돼지 목살 1인', '제주 흑돼지 항정살 1인', '된장찌개', '냉면'].map((name) => menu(name)) },
        },
        limit: 100,
    });
    assert.deepEqual(pork.items.filter((item) => item.source === 'board').map((item) => item.term), ['흑돼지']);
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
    assert.deepEqual(keywordsOf(noodle), ['강남칼국수', '역삼칼국수', '강남맛집']); // 순위 확인용(맛집)은 맨 뒤
    assert.equal(excludedOf(noodle, '만두').reason,
        "'만두'는 리뷰에 나오는 메뉴입니다(리뷰 '만두' 25회). 다만 이 말은 만두집을 가리키는 메뉴 이름인데, 이 매장의 주력이라는 근거를 찾지 못해 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 6개 중 1개). 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.");
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
    // (횟집에서는 볼락구이가 주력 갈래 밖이라 걸러지므로, 업종이 '생선구이'인 같은 매장으로 근거가 합쳐지는지 본다)
    assert.equal(excludedOf(result, '볼락구이').rule, 'offMain');
    const grill = recommendKeywords({ place: { ...FULL_RESTAURANT.place, category: '생선구이' }, activity: FULL_RESTAURANT.activity, rivals: FULL_RESTAURANT.rivalPool, limit: 100 });
    assert.deepEqual(grill.items.find((item) => item.keyword === '강남구청볼락구이').reasons.map((reason) => reason.text), ['리뷰 9회', '주간 인기 메뉴']);
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
    assert.deepEqual(keywordsOf(sushi), ['강남생선회', '역삼생선회', '강남광어', '강남아나고튀김', '강남맛집']);
    assert.deepEqual(['와인', '튀김', '생선', '고노와다추가'].map((word) => excludedOf(sushi, word).rule), ['drink', 'vague', 'vague', 'extra']);
    assert.equal(excludedOf(sushi, '와인').reason, "술·음료 이름이라, 업종·매장 이름에 '와인'이 없으면 가게 종류를 말하는 낱말로 보지 않습니다.");
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
    // 좁은 업종 이름은 그대로 추천한다(순서는 근거 점수 순)
    assert.equal(keywordsOf(full(FULL_PHARMACY)).includes('청주약국'), true);
    assert.equal(keywordsOf(full(FULL_SALON)).includes('강남역남성전문미용실'), true);
});

test('관문 5 — 한쪽이 다른 쪽을 품는 메뉴 낱말은 하나로 묶는다(이유에 두 낱말의 리뷰·예약 수)', () => {
    const restaurant = full(FULL_RESTAURANT, { limit: 100 });
    // 광어(리뷰 34회)·광어회(13회) → 광어
    assert.deepEqual([excludedOf(restaurant, '광어회').rule, excludedOf(restaurant, '광어회').into], ['merged', '광어']);
    assert.equal(excludedOf(restaurant, '광어회').reason, "'광어회'(리뷰 13회)는 '광어'(리뷰 34회)가 들어 있는 말이라, 손님이 더 많이 말한 '광어' 하나로 묶었습니다.");
    assert.deepEqual(restaurant.items.find((item) => item.keyword === '강남구청광어').merged, ['광어회']);
    // 갈치(12회)·갈치조림(10회)·순살갈치조림(결제) → 갈치. 횟집에서는 셋 다 주력 갈래(회) 밖이라 먼저 걸리므로, 메뉴판을 읽지 못한 같은 매장으로 본다
    const unread = recommendKeywords({
        place: { ...FULL_RESTAURANT.place, detail: { ...FULL_RESTAURANT.place.detail, menus: [] } }, activity: FULL_RESTAURANT.activity, rivals: FULL_RESTAURANT.rivalPool, limit: 100,
    });
    // 둘 다 '갈치'로 묶였고 서로 품는 낱말이라 excluded 에서도 한 줄이다(리뷰 수는 낱말마다 그대로 적음)
    assert.deepEqual(excludedOf(unread, '갈치조림'), {
        term: '갈치조림', keywords: ['강남구청갈치조림', '강남구청순살갈치조림'], rule: 'merged', into: '갈치',
        reason: "'갈치조림'(리뷰 10회)·'순살갈치조림'은 '갈치'(리뷰 12회)가 들어 있는 말이라, 손님이 더 많이 말한 '갈치' 하나로 묶었습니다.",
    });
    assert.equal(excludedOf(unread, '순살갈치조림'), undefined);
    assert.deepEqual(unread.items.find((item) => item.term === '갈치').merged, ['갈치조림', '순살갈치조림']);
    for (const word of ['광어회', '갈치조림']) assert.equal(restaurant.items.some((item) => item.term === word) || unread.items.some((item) => item.term === word), false, word);
    // 짧은 쪽이 덜 말해진 메뉴 낱말이면 긴 쪽으로 묶는다
    const longer = recommendKeywords({ place: { ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [{ label: '광어회', count: 20 }, { label: '광어', count: 4 }], detail: { menus: [] } } });
    assert.equal(excludedOf(longer, '광어').reason, "'광어'(리뷰 4회)는 '광어회'(리뷰 20회)에 들어 있는 말이라, 손님이 더 많이 말한 '광어회' 하나로 묶었습니다.");
    // 등록 키워드 "댄디컷"과 예약 스타일 "시스루댄디컷"(리뷰 827회·예약 315건): 시스루댄디컷은 댄디컷의 한 갈래 스타일이고
    // 댄디컷(등록 키워드, 리뷰 2,452회·예약 554건)이 그 말을 품어, 추천 자리를 같은 낱말로 두 번 쓰지 않게 하나로 묶는다
    const salon = full(FULL_SALON, { limit: 100 });
    assert.deepEqual(excludedOf(salon, '시스루댄디컷'), {
        // ("강남"은 "강남역"과 같은 뿌리의 이름이라 한 지역으로 본다 → 둘째 지역은 역삼)
        term: '시스루댄디컷', keywords: ['강남역시스루댄디컷', '역삼시스루댄디컷'], rule: 'merged', into: '댄디컷',
        reason: "'시스루댄디컷'(예약 315건·리뷰 827회)은 '댄디컷'(예약 554건·리뷰 2,452회)이 들어 있는 말이라, 등록 키워드인 '댄디컷' 하나로 묶었습니다.",
    });
    assert.deepEqual(salon.items.find((item) => item.keyword === '강남역댄디컷').merged, ['시스루댄디컷']);
    assert.equal(salon.items.some((item) => item.term === '시스루댄디컷'), false);
    // 업종 낱말·업종 연관어끼리는 묶지 않는다(약국·대형약국·동물약국은 서로 다른 검색어)
    const pharmacy = full(FULL_PHARMACY, { limit: 100 });
    for (const word of ['청주약국', '청주대형약국', '청주동물약국']) assert.equal(keywordsOf(pharmacy).includes(word), true, word);
    assert.equal(pharmacy.excluded.some((entry) => entry.rule === 'merged'), false);
    // 묶인 낱말이 없으면 merged 필드도 없다
    assert.equal('merged' in pharmacy.items[0], false);
});

test('관문 6 — 추천이 같은 낱말의 지역 바꿔치기로 채워지지 않는다(한 낱말에는 지역 하나, 가장 중요한 낱말만 둘까지)', () => {
    // 약국: 전에는 12개 중 6개가 일반의약품·상비약·동물의약품 × 청주/오창이었다(이제 분류 이름은 관문 '차'로 빠진다).
    // 그 뒤에도 9개 중 6개가 '청주/오창 × 대형약국·영양제·동물약국' 3쌍이었다 → 대형약국·영양제·동물약국은 지역 하나(청주)
    const pharmacy = full(FULL_PHARMACY);
    assert.deepEqual(keywordsOf(pharmacy), ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국']);
    assert.deepEqual(excludedOf(pharmacy, '대형약국'), {
        term: '대형약국', keywords: ['오창대형약국'], rule: 'region',
        reason: "'청주대형약국'이 추천에 이미 있어, '대형약국'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    // 가장 중요한 낱말 "약국"은 둘째 지역(오창)을 내 순위(오창약국 2위)로 받치고, 셋째(청원)는 없다
    assert.deepEqual(excludedOf(pharmacy, '약국').keywords, ['청원약국']);
    assert.equal(excludedOf(pharmacy, '약국').reason, "'청주약국'·'오창약국'이 추천에 이미 있어, '약국'에 지역만 바꾼 조합은 더 권하지 않습니다.");
    // 지역을 둘 이상 권하는 것은 가장 중요한 낱말(약국·횟집·미용실) 하나뿐이고 등록한 조합을 합해 둘까지다. 나머지 낱말의 두 번째 조합은
    // 그 조합을 그대로 등록한 상위 매장이 있을 때(그 조합 자체의 근거)뿐이다. 순위 표에 이미 있는 낱말은 다른 지역의 새 조합을 만들지 않는다
    const topTerm = new Map([[FULL_PHARMACY, '약국'], [FULL_RESTAURANT, '횟집'], [FULL_SALON, '미용실']]);
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        for (const result of [full(sample, { limit: 100 }), full(sample, { limit: 100, ranks: sample.ranks })]) {
            const byTerm = new Map();
            for (const item of result.items) byTerm.set(item.term, [...(byTerm.get(item.term) || []), item]);
            for (const [term, items] of byTerm) {
                const own = sample.place.keywords.filter((keyword) => keyword.length > term.length && keyword.endsWith(term)).length;
                if (term === topTerm.get(sample)) {
                    // 가장 중요한 낱말: 등록한 조합과 합쳐 둘까지(그 조합을 등록한 상위 매장이 있는 것은 따로)
                    assert.equal(items.filter((item) => item.rivalCount === 0).length + own <= 2, true, `${term}: ${items.map((item) => item.keyword).join(', ')}`);
                    continue;
                }
                const plain = items.filter((item) => item.rivalCount === 0);
                assert.equal(plain.length + own <= 1, true, `${term}: ${items.map((item) => item.keyword).join(', ')}`);
            }
        }
    }
    const restaurant = full(FULL_RESTAURANT);
    assert.deepEqual(keywordsOf(restaurant), [
        '강남구청숙성회', '강남구청광어', '강남구청모임', '강남구청대방어', '강남구청룸식당', '강남구청맛집',
    ]); // "강남구청포장"(받는 방법, 관문 8)·"강남구청갈치"·"강남구청볼락구이"(주력 갈래 밖, 관문 9)가 빠지고 "강남구청대방어"(관문 10)가 들어왔다. 순위 확인용 "맛집"은 맨 뒤
    // "횟집"은 이미 두 지역으로 등록해 새 조합을 더 권하지 않는다(가장 중요한 낱말도 등록한 것을 합해 둘까지, 그 조합을 등록한 상위 매장이 있어도).
    // 순위 표에서 압구정횟집이 41위로 확인돼 그 칸이 비면, 그 조합을 그대로 등록한 상위 매장이 있는 강남횟집이 한 칸을 채운다(논현횟집은 칸이 없어 뺌)
    const ranked = full(FULL_RESTAURANT, { ranks: FULL_RESTAURANT.ranks });
    assert.deepEqual(ranked.items.filter((item) => item.term === '횟집').map((item) => [item.keyword, item.reasons[0].text]), [['강남횟집', '상위 2곳 등록']]);
    assert.deepEqual(keywordsOf(full({ ...FULL_RESTAURANT, rivalPool: [] })).filter((word) => word.endsWith('횟집')), []);
    // 주력 메뉴 "숙성회"도 지역은 하나(전에는 주력 낱말이라 "압구정숙성회"까지 2개), "점심"·"회식"은 이미 등록한 조합이 있어 더 권하지 않는다
    assert.deepEqual(excludedOf(restaurant, '숙성회'), {
        term: '숙성회', keywords: ['압구정숙성회'], rule: 'region', reason: "'강남구청숙성회'가 추천에 이미 있어, '숙성회'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    assert.equal(excludedOf(restaurant, '점심').reason, "'강남구청점심'은 이미 등록한 키워드라, '점심'에 지역만 바꾼 조합은 더 권하지 않습니다.");
    assert.deepEqual(excludedOf(restaurant, '점심').keywords, ['압구정점심', '강남점심']);
    assert.deepEqual(excludedOf(restaurant, '회식').keywords, ['강남회식', '논현회식']);
    // 미용실: 이미 등록한 "강남역미용실"과 지역만 다른 "강남미용실"·"역삼미용실"을 더 권하지 않는다(전에는 가장 중요한 낱말이라 3개까지 허용했다).
    // 업종 이름 조각 "남성전문미용실"도 지역 하나(전에는 "강남역남성전문미용실"과 지역만 다른 "강남남성전문미용실"이 남았다)
    const salon = full(FULL_SALON);
    // (추천 순서는 근거 점수 순이라, 근거가 업종 이름뿐인 남성전문미용실은 예약·리뷰가 받치는 시술 낱말들 뒤로 간다)
    assert.deepEqual(keywordsOf(salon).slice(0, 4), ['강남역댄디컷', '강남역다운펌', '강남역쉐도우펌', '강남역볼륨매직']);
    assert.equal(keywordsOf(salon).some((word) => /^(강남역|강남|역삼)미용실$/.test(word)), false);
    // "강남"은 "강남역"과 같은 뿌리의 이름이라 한 지역으로 보므로, 지역만 바꾼 조합은 역삼뿐이다
    assert.deepEqual(excludedOf(salon, '미용실'), {
        term: '미용실', keywords: ['역삼미용실'], rule: 'region',
        reason: "'강남역미용실'은 이미 등록한 키워드라, '미용실'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    assert.deepEqual(excludedOf(salon, '남성전문미용실'), {
        term: '남성전문미용실', keywords: ['역삼남성전문미용실'], rule: 'region',
        reason: "'강남역남성전문미용실'이 추천에 이미 있어, '남성전문미용실'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    // 예외는 그대로: 그 조합을 등록한 상위 매장이 있으면 지역을 하나 더 권한다(약국의 "청주대형약국"은 상위 2곳 등록)
    const withRival = recommendKeywords({
        place: { ...SHOP, name: '시험헤어', category: '미용실', keywords: ['역삼미용실'], reviewMenus: [{ label: '다운펌', count: 50 }], detail: { menus: [] } },
        rivals: [{ placeId: 'a', name: '가', keywords: ['강남다운펌'] }],
    });
    assert.deepEqual(keywordsOf(withRival).filter((word) => word.endsWith('다운펌')).sort(), ['강남다운펌', '역삼다운펌']);
    assert.equal(withRival.items.find((item) => item.keyword === '강남다운펌').reasons[0].text, '상위 1곳 등록');
    const noRival = recommendKeywords({ place: { ...SHOP, name: '시험헤어', category: '미용실', keywords: ['역삼미용실'], reviewMenus: [{ label: '다운펌', count: 50 }], detail: { menus: [] } } });
    assert.deepEqual(keywordsOf(noRival).filter((word) => word.endsWith('다운펌')), ['역삼다운펌']);
});

test('관문 6(바) — 가장 중요한 낱말의 둘째 지역은 내 순위가 좋은 지역이거나 첫 분석의 순위 조회 후보일 때만, 순위 표에 이미 있는 낱말은 새 지역을 더하지 않는다', () => {
    const row = (keyword, state, rank, status = 'found') => (state === 'done'
        ? { keyword, state, result: { keyword, status, rank: rank ?? null, scanned: 100, top: [], region: null } }
        : { keyword, state });
    const pharmacy = (ranks, extra = {}) => recommendKeywords({ place: FULL_PHARMACY.place, activity: FULL_PHARMACY.activity, ranks, ...extra });
    const of = (result, term) => result.items.filter((item) => item.term === term).map((item) => item.keyword).sort();

    // 첫 분석(순위 표 없음): 가장 중요한 낱말 "약국"은 순위를 조회해 볼 둘째 지역을 하나 내고, 나머지 낱말은 지역 하나
    const first = pharmacy([]);
    assert.deepEqual(of(first, '약국'), ['오창약국', '청주약국']);
    assert.deepEqual([of(first, '대형약국'), of(first, '영양제'), of(first, '동물약국')], [['청주대형약국'], ['청주영양제'], ['청주동물약국']]);
    // 등록한 조합도 그 하나로 친다: 이미 "청주약국"을 등록했으면 순위를 조회해 볼 둘째 지역도 내지 않는다(조회 후보는 첫 분석에서 낱말이 아직 순위 표에 없을 때만)
    assert.deepEqual(of(recommendKeywords({ place: { ...FULL_PHARMACY.place, keywords: ['청주약국'] }, activity: FULL_PHARMACY.activity }), '약국'), []);
    assert.deepEqual(of(recommendKeywords({ place: { ...FULL_PHARMACY.place, keywords: ['청주영양제'] }, activity: FULL_PHARMACY.activity }), '영양제'), []);

    // 순위 표가 있으면 둘째 지역은 내 순위가 좋은 지역(10위 안 키워드가 있는 지역)일 때만이다
    // · 오창약국이 2위이고 청주약국이 6위: 둘 다 순위 표에 있어 그대로, 셋째 지역(청원)은 없다
    const both = pharmacy([row('청주약국', 'done', 6), row('오창약국', 'done', 2)]);
    assert.deepEqual(of(both, '약국'), ['오창약국', '청주약국']);
    // · 둘째 지역이 순위 조회에서 30위 밖으로 나오면 그 지역에는 새 조합을 만들지 않는다 → 첫 지역 하나뿐
    const badSecond = pharmacy([row('청주약국', 'done', 6), row('오창약국', 'done', null, 'beyond')]);
    assert.deepEqual(of(badSecond, '약국'), ['청주약국']);
    // · 오창은 다른 낱말(오창대형약국)로 2위가 확인됐으면 좋은 지역이라, 순위 표에 없는 "오창약국"도 둘째 지역으로 권한다
    const viaOther = pharmacy([row('청주약국', 'done', 6), row('오창대형약국', 'done', 2)]);
    assert.deepEqual(of(viaOther, '약국'), ['오창약국', '청주약국']);
    // · 오창이 15위(좋지도 나쁘지도 않음)이면 둘째 지역으로 받치지 못한다
    const middle = pharmacy([row('청주약국', 'done', 6), row('오창대형약국', 'done', 15)]);
    assert.deepEqual(of(middle, '약국'), ['청주약국']);

    // 순위 표에 이미 있는 낱말은(조회 중·실패·순위 있음) 다른 지역의 새 조합을 더하지 않는다: 청주영양제가 조회 중이면 오창영양제를 같이 내지 않는다
    const loading = pharmacy([row('청주약국', 'done', 6), row('오창약국', 'done', 2), row('청주영양제', 'loading')]);
    assert.deepEqual(of(loading, '영양제'), ['청주영양제']);
    assert.deepEqual(of(pharmacy([row('청주약국', 'done', 6), row('오창약국', 'done', 2), row('청주영양제', 'error')]), '영양제'), ['청주영양제']);
    assert.equal(excludedOf(loading, '영양제').reason, "'청주영양제'가 추천에 이미 있어, '영양제'에 지역만 바꾼 조합은 더 권하지 않습니다.");

    // 다만 그 조합이 30위 밖으로 확인됐고 내 순위가 좋은 지역(오창약국 2위)이 따로 있으면, 좋은 지역의 조합으로 바꿔 권한다
    const swapped = pharmacy([row('청주약국', 'done', 6), row('오창약국', 'done', 2), row('청주영양제', 'done', null, 'beyond')]);
    assert.deepEqual(of(swapped, '영양제'), ['오창영양제']);
    assert.deepEqual(excludedOf(swapped, '영양제'), {
        term: '영양제', keywords: ['청주영양제'], rule: 'region',
        reason: "'청주영양제'는 내 순위가 30위 밖이라 순위가 좋은 지역의 '오창영양제'로 바꿔 권하며, '영양제'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    // 좋은 지역이 따로 없으면 바꾸지 않고 그대로 둔다(청주는 청주약국이 6위라 나쁜 지역이 아니고, 그 지역에서 이 낱말을 권해도 순위가 오를 수 있으므로)
    assert.deepEqual(of(pharmacy([row('청주약국', 'done', 6), row('청주영양제', 'done', null, 'beyond')]), '영양제'), ['청주영양제']);
    // 그 지역의 조회 결과가 모두 나쁘면(관문 '카') 그 지역에는 새 조합을 만들지 않으므로 다른 지역으로 간다
    assert.deepEqual(of(pharmacy([row('청주영양제', 'done', null, 'beyond')]), '영양제'), ['오창영양제']);
});

test('관문 7 — 블로그 언급을 물어봤는데 0개이고 다른 근거도 없는 낱말은 뺀다', () => {
    // (전에는 약국의 "건강기능식품"(블로그 0/11)으로 확인했다. 그 낱말은 이제 분류 이름(관문 '차')이 먼저 걸려, 시험용 미용실로 본다)
    const place = { ...SHOP, name: '시험헤어', category: '미용실', keywords: ['레이어드컷'], detail: { menus: [] } };
    const asked = recommendKeywords({ place, activity: { mentions: { blogTotal: 20, terms: [{ term: '미용실', count: 15 }, { term: '레이어드컷', count: 0 }] } }, limit: 100 });
    assert.equal(asked.items.some((item) => item.term === '레이어드컷'), false);
    assert.deepEqual(excludedOf(asked, '레이어드컷'), {
        term: '레이어드컷', keywords: ['강남레이어드컷', '역삼레이어드컷'], rule: 'noBlog',
        reason: "블로그 후기 20개 가운데 '레이어드컷'이 나온 글이 없고, 리뷰·예약·상위 매장에서도 쓰이지 않습니다.",
    });
    // 등록 키워드 진단에도 같은 이유가 달리고, 지역만 붙인 조합을 권하지 않는다
    assert.deepEqual([asked.registered[0].concern, asked.registered[0].suggest], [{ rule: 'noBlog', reason: excludedOf(asked, '레이어드컷').reason }, null]);
    // 블로그 언급을 묻지 않은 매장에서는 0개인지 알 수 없으므로 빼지 않는다
    assert.equal(keywordsOf(recommendKeywords({ place, limit: 100 })).includes('강남레이어드컷'), true);
    // 약국의 "건강기능식품"은 분류 이름이라는 이유가 먼저다(블로그 0개라는 이유보다 바꿔 쓸 말이 함께 있어 쓸모가 큼)
    assert.equal(excludedOf(full(FULL_PHARMACY, { limit: 100 }), '건강기능식품').rule, 'classification');
    // 블로그 0개여도 손님 리뷰에 341회 나오는 낱말(가르마펌)은 다른 근거가 있어 남긴다
    const salon = full(FULL_SALON, { limit: 100 });
    const garma = salon.items.find((item) => item.keyword === '강남역가르마펌');
    assert.deepEqual([garma.blog, garma.reasons.map((reason) => reason.text)], [0, ['등록 키워드의 낱말', '리뷰 341회']]);
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
    // 약국: 전에는 "청주일반의약품"·"청주상비약"(등록한 낱말에 지역만 붙인 것)이 5개 안에 들어 네이버 조회를 썼다.
    // 이제는 분류 이름이라 추천에서도 빠져(관문 '차') 자리가 남아도 조회하지 않는다
    for (const rivals of [[], FULL_PHARMACY.rivalPool]) {
        const result = recommendKeywords({ place: FULL_PHARMACY.place, activity: FULL_PHARMACY.activity, rivals });
        assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, result).keywords, ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국'], `상위 매장 ${rivals.length}곳`);
        for (const word of ['청주일반의약품', '청주상비약', '청주동물의약품']) assert.equal(keywordsOf(result).includes(word), false, word);
        // 자리가 남아도 낱말당 2개까지라("약국"은 청주·오창) 더 넣지 않는다
        assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, result, 8).keywords, ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국']);
    }
    // 음식점·미용실은 그대로다: 등록한 낱말이어도 예약·리뷰가 받치는 "강남역댄디컷"·"강남역다운펌"은 미루지 않는다
    // (이미 등록한 "강남역미용실"과 지역만 다른 "강남미용실"은 이제 추천하지 않아 순위 조회에도 쓰지 않는다. 전에는 "조회 실패"로 남았다)
    const salonPick = (rivals) => [...pickRankKeywords(FULL_SALON.place, recommendKeywords({ place: FULL_SALON.place, activity: FULL_SALON.activity, rivals })).keywords].sort();
    // (등록 낱말 볼륨매직은 전체 목록에서 센 리뷰 299회·예약 214건이 근거라 들어온다. 업종 이름뿐인 남성전문미용실은 근거 점수 순서에서 뒤로 밀렸다)
    assert.deepEqual(salonPick([]), ['강남역다운펌', '강남역댄디컷', '강남역미용실', '강남역볼륨매직', '강남역쉐도우펌']);
    assert.deepEqual(salonPick(FULL_SALON.rivalPool), ['강남역다운펌', '강남역댄디컷', '강남역미용실', '강남역볼륨매직', '강남역쉐도우펌']);
    for (const rivals of [[], FULL_SALON.rivalPool]) {
        assert.equal(salonPick(rivals).some((word) => /^(강남|역삼)미용실$/.test(word)), false);
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
    // 견본 3종: 걸리는 것은 약국의 분류 이름 4개(일반의약품·건강기능식품·동물의약품·상비약)
    assert.deepEqual(full(FULL_PHARMACY).registered.map((entry) => entry.concern?.rule ?? null), ['classification', 'classification', 'classification', 'classification']);
    for (const sample of [FULL_RESTAURANT, FULL_SALON]) assert.equal(full(sample).registered.every((entry) => entry.concern === null), true);

    // 횟집이 "김밥"을 등록: 메뉴판 20개 중 1개
    const board = [...Array.from({ length: 19 }, (_, index) => menu(`회 ${index}`)), menu('소금김밥')];
    const sushi = { ...SHOP, name: '시험수산', category: '생선회', keywords: ['역삼횟집', '역삼김밥'], reviewMenus: [{ label: '김밥', count: 30 }] };
    const flagged = recommendKeywords({ place: { ...sushi, detail: { menus: board } } });
    assert.deepEqual(flagged.registered.map((entry) => entry.concern), [
        null,
        // (등록 키워드 '김밥' 자체가 이 매장의 갈래로 읽히므로 "이 매장을 찾는 말은 ○ 메뉴"라는 말은 붙이지 않는다)
        { rule: 'otherBusiness', reason: "'김밥'은 손님이 많이 찾는 메뉴입니다(리뷰 '김밥' 30회). 다만 이 말은 김밥집을 가리키는 메뉴 이름인데, 이 매장의 주력이라는 근거를 찾지 못해 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 20개 중 1개). 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다." },
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

test('관문 11(차) — 약·제품 분류 이름은 지역을 붙여 추천하지 않고, 일상에서 흔히 쓰는 말을 함께 알려 준다', () => {
    const pharmacy = full(FULL_PHARMACY, { limit: 100 });
    // 전에는 "청주일반의약품"·"청주상비약"·"청주동물의약품"을 추천했다
    for (const word of ['청주일반의약품', '청주상비약', '청주동물의약품', '청주건강기능식품']) assert.equal(keywordsOf(pharmacy).includes(word), false, word);
    assert.deepEqual(excludedOf(pharmacy, '일반의약품'), {
        term: '일반의약품', keywords: ['청주일반의약품', '오창일반의약품'], rule: 'classification', into: '약국',
        reason: "'일반의약품'은 약·제품을 나누는 분류 이름이고, 블로그 후기에는 '약국'이라는 말이 나옵니다(11개 중 11개).",
    });
    // 뜻이 같은 두 말(동물의약품 ↔ 동물약국)은 손님 말 하나로: "청주동물약국"만 권한다
    assert.deepEqual([excludedOf(pharmacy, '동물의약품').into, excludedOf(pharmacy, '건강기능식품').into, excludedOf(pharmacy, '상비약').into], ['동물약국', '영양제', '약국']);
    assert.equal(keywordsOf(pharmacy).includes('청주동물약국'), true);
    // 등록 키워드 진단: 단정하지 않는 이유(concern)와 바꿔 쓸 말(spoken)을 함께
    const byKeyword = new Map(pharmacy.registered.map((entry) => [entry.keyword, entry]));
    assert.deepEqual(byKeyword.get('상비약').concern, { rule: 'classification', reason: "'상비약'은 약·제품을 나누는 분류 이름이고, 블로그 후기에는 '약국'이라는 말이 나옵니다(11개 중 11개)." });
    assert.deepEqual(byKeyword.get('상비약').spoken, { term: '약국', blog: 11, keyword: '청주약국', everyPost: true });
    assert.deepEqual(byKeyword.get('동물의약품').spoken, { term: '동물약국', blog: 3, keyword: '청주동물약국', everyPost: false });
    assert.deepEqual(byKeyword.get('건강기능식품').spoken, { term: '영양제', blog: 4, keyword: '청주영양제', everyPost: false });
    for (const entry of pharmacy.registered) assert.equal(entry.suggest, null, entry.keyword); // 분류 이름에 지역만 붙인 조합은 제안하지 않는다
    // 손님 말에 근거가 없으면(영양제를 뒷받침할 등록 키워드·리뷰가 없음) 업종 대표어 '약국'으로 알려 준다
    const bare = recommendKeywords({ place: { ...SHOP, name: '시험약국', category: '약국', keywords: ['역삼일반의약품', '의약외품'] } });
    assert.deepEqual(bare.registered.map((entry) => [entry.concern?.rule, entry.spoken?.term]), [['classification', '약국'], ['classification', '약국']]);
    // 약국이 아닌 업종에는 쓰지 않는다(편의점의 "상비약"은 이 규칙으로 걸지 않음)
    const store = recommendKeywords({ place: { ...SHOP, name: '시험마트', category: '편의점', keywords: ['상비약'] } });
    assert.equal(store.registered[0].concern?.rule === 'classification', false);
});

test('관문 12(카) — 내 순위가 나쁜 지역에는 새 조합을 만들지 않고, 순위가 좋은 지역을 앞세운다(ranks 를 받았을 때만)', () => {
    // 횟집: 압구정횟집 41위 · 압구정회식 300위 밖 → 압구정에는 새 조합을 만들지 않는다. 실제 순위로 이유를 적는다
    const restaurant = full(FULL_RESTAURANT, { limit: 100, ranks: FULL_RESTAURANT.ranks });
    assert.equal(keywordsOf(restaurant).some((word) => word.startsWith('압구정')), false);
    const apgu = excludedOf(restaurant, '압구정');
    assert.deepEqual([apgu.rule, apgu.keywords.slice(0, 3)], ['rank', ['압구정숙성회', '압구정점심', '압구정광어']]);
    assert.equal(apgu.reason, "'압구정'이 들어간 키워드에서 내 매장은 41위('압구정횟집')·300위 밖('압구정회식')이라, 이 지역에는 새 조합을 만들지 않고 내 순위가 좋은 '강남구청' 조합을 먼저 권합니다.");
    // 숙성회·광어의 압구정 조합은 이제 '지역만 바꾼 조합'이 아니라 순위 이유로 빠진다
    assert.equal(excludedOf(restaurant, '숙성회'), undefined);
    // 약국: 오창약국 2위 → 오창 조합을 앞세운다(전에는 "청주…"로만 만들었다). 순위 표에 오창약국만 있고 청주는 아직 조회하지 않았을 때
    // (순위 표에 그 낱말의 조합이 이미 있는 대형약국·영양제·동물약국의 오창 조합은 새로 더하지 않으므로, 순위 표에 없는 낱말로 본다)
    const ochang = full(FULL_PHARMACY, { ranks: FULL_PHARMACY.ranks.filter((row) => row.keyword === '오창약국') });
    for (const word of ['오창대형약국', '오창영양제', '오창동물약국']) assert.equal(keywordsOf(ochang).includes(word), true, word);
    for (const word of ['청주영양제', '청주동물약국']) assert.equal(keywordsOf(ochang).includes(word), false, word);
    assert.deepEqual(ochang.items.find((item) => item.keyword === '오창영양제').reasons.at(-1), { kind: 'regionRank', text: "'오창약국' 내 2위" });
    // 순위 표가 모두 있는 약국: 청주도 6위·3위라 나쁜 지역은 아니다
    const pharmacy = full(FULL_PHARMACY, { ranks: FULL_PHARMACY.ranks });
    assert.deepEqual(keywordsOf(pharmacy), ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국']);
    assert.equal(pharmacy.excluded.some((entry) => entry.rule === 'rank'), false);
    // 이미 조회해 10위 안인 조합은 그 자체가 근거라 지역 수와 관계없이 남기고 순위를 붙인다. 조회 중·조회 실패인 조합도 그대로 둔다
    // (다른 순위가 먼저 끝나 추천에서 빠졌다가 돌아오는 일이 없게)
    assert.deepEqual(pharmacy.items.find((item) => item.keyword === '청주대형약국').reasons[0], { kind: 'myRank', text: '내 3위' });
    for (const word of ['청주영양제', '청주동물약국']) assert.equal(keywordsOf(pharmacy).includes(word), true, word);
    // 미용실: 강남역이 이미 맨 앞이라 순서가 바뀌지 않는다(순위 때문에 앞으로 온 지역이 없어 지역 순위를 붙이지 않음)
    const salon = full(FULL_SALON, { ranks: FULL_SALON.ranks });
    assert.deepEqual(keywordsOf(salon), keywordsOf(full(FULL_SALON)));
    assert.equal(salon.items.some((item) => item.reasons.some((reason) => reason.kind === 'regionRank')), false);
    // ranks 를 주지 않으면 전과 같다(순위 조회 전에 고르는 자동 순위 조회는 이쪽을 쓴다)
    assert.deepEqual(keywordsOf(full(FULL_PHARMACY, { ranks: [] })), keywordsOf(full(FULL_PHARMACY)));
    assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, recommendKeywords({ place: FULL_PHARMACY.place, activity: FULL_PHARMACY.activity })).keywords,
        ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국']);

    // 나쁨의 선: 30위 밖 · 살펴본 범위 밖 · 목록에 없음. 31위면 나쁘고 30위면 그대로 둔다
    const row = (keyword, result) => ({ keyword, state: 'done', result: { keyword, status: 'found', scanned: 100, top: [], region: null, ...result } });
    const place = { ...SHOP, name: '시험헤어', category: '미용실', keywords: ['역삼미용실'], reviewMenus: [{ label: '다운펌', count: 50 }], detail: { menus: [] } };
    const at = (rank, more = []) => recommendKeywords({ place, ranks: [row('역삼미용실', { rank }), ...more] });
    // 나쁜 지역은 조회한 서로 다른 낱말 둘 이상이 모두 나쁘거나 검색 결과가 먼 지역일 때다.
    // 한 낱말(미용실)의 순위만으로는 그 지역의 다른 낱말(다운펌)까지 막지 않는다(5차 채점: 상계분식 55위·노원분식 80위만으로 노원의 김밥·떡볶이까지 막히던 문제)
    assert.equal(at(31).excluded.some((entry) => entry.rule === 'rank'), false);
    assert.equal(keywordsOf(at(31)).includes('역삼다운펌'), true);
    // 31위인 조합 자체는 같은 지역에서 다시 권하지 않는다: 낱말이 같은 조합이 30위 밖이면 다른 지역으로 바꾼다
    const again = recommendKeywords({ place: { ...place, keywords: [] }, ranks: [row('역삼다운펌', { rank: 31 })] });
    assert.deepEqual(keywordsOf(again).filter((word) => word.endsWith('다운펌')), ['강남다운펌']);
    assert.equal(excludedOf(again, '다운펌').reason, "'역삼다운펌'은 내 순위가 31위라 다른 지역의 '강남다운펌'으로 바꿔 권하며, '다운펌'에 지역만 바꾼 조합은 더 권하지 않습니다.");
    // 서로 다른 낱말 둘이 모두 30위 밖이면 그 지역은 나쁜 지역이다
    const twoBad = at(31, [row('역삼다운펌', { rank: 45 })]);
    assert.equal(twoBad.excluded.find((entry) => entry.rule === 'rank').term, '역삼');
    assert.equal(keywordsOf(twoBad).some((word) => word.startsWith('역삼')), false);
    // 30위는 나쁘지 않다(한 낱말이라도 30위 안이면 그 지역은 나쁜 지역이 아님)
    assert.equal(at(30, [row('역삼다운펌', { rank: 45 })]).excluded.some((entry) => entry.rule === 'rank'), false);
    assert.equal(keywordsOf(at(30)).includes('역삼다운펌'), true);
    const missing = recommendKeywords({ place, ranks: [row('역삼미용실', { status: 'not_listed', rank: null }), row('역삼다운펌', { status: 'not_listed', rank: null })] });
    assert.equal(excludedOf(missing, '역삼').reason, "'역삼'이 들어간 키워드에서 내 매장은 목록에 없음('역삼미용실')·목록에 없음('역삼다운펌')이라, 이 지역에는 새 조합을 만들지 않습니다.");
    // 한 키워드라도 30위 안이면 나쁜 지역이 아니다(나머지가 모두 30위 밖이어도)
    const mixed =recommendKeywords({ place, ranks: [row('역삼미용실', { rank: 45 }), row('역삼다운펌', { rank: 7 })] });
    assert.equal(mixed.excluded.some((entry) => entry.rule === 'rank'), false);
    // 검색 결과가 내 매장에서 멀리 떨어진 곳이면(순위가 좋아도) 그 지역에 새 조합을 만들지 않는다
    const far = (km) => Array.from({ length: 3 }, (_, index) => ({ rank: index + 1, placeId: `f${index}`, isTarget: false, x: String(127 + km / 88), y: '37.5' }));
    const farPlace = { ...place, coordinate: { x: '127', y: '37.5' } };
    const distant = recommendKeywords({ place: farPlace, ranks: [row('역삼미용실', { rank: 2, top: far(60) })] });
    assert.equal(distant.excluded.find((entry) => entry.rule === 'rank').term, '역삼');
    const near = recommendKeywords({ place: farPlace, ranks: [row('역삼미용실', { rank: 2, top: far(2) })] });
    assert.equal(near.excluded.some((entry) => entry.rule === 'rank'), false);
});

test('관문 13(타) — 근거가 얇은 업종 연관어(매장 사실 하나뿐)는 추천하지 않는다: 12칸을 채우려고 약한 것을 올리지 않는다', () => {
    // 견본: 미용실의 "1인미용실"(편의시설 한 줄)·"헤어샵"(매장 이름), 음식점의 "룸식당"(좌석 '룸' 한 줄). 전에는 추천 끝자리(11·12번째, 7번째)를 채웠다
    const salon = full(FULL_SALON, { limit: 100 });
    const restaurant = full(FULL_RESTAURANT, { limit: 100 });
    // (음식점 견본에는 AI 브리핑 문장 "룸이 있어 회식이나 단체 모임 장소로 찾는 리뷰가 많아요"가 있어 룸식당의 근거가 둘이다 → 아래에서 브리핑이 없는 경우로 본다)
    const restaurantNoBriefing = full({ ...FULL_RESTAURANT, activity: { ...FULL_RESTAURANT.activity, briefing: [] } }, { limit: 100 });
    for (const [result, word] of [[salon, '1인미용실'], [salon, '헤어샵'], [restaurantNoBriefing, '룸식당']]) {
        assert.equal(result.items.some((item) => item.term === word), false, word);
        assert.equal(excludedOf(result, word).rule, 'thin', word);
    }
    // 브리핑 문장 속 '룸'도 근거로 세므로(전에는 안 셌다) 근거가 좌석 정보 하나뿐이라는 말은 거짓이 되어 추천에 남고, 그 이유를 근거 칩에 적는다
    const roomItem = restaurant.items.find((item) => item.term === '룸식당');
    assert.deepEqual(roomItem.reasons.map((reason) => reason.text), ["좌석 '룸'", '네이버 AI 브리핑']);
    assert.equal(excludedOf(restaurant, '룸식당').rule, 'region'); // 걸러진 것이 아니라 지역만 바꾼 조합 줄뿐이다
    assert.deepEqual(excludedOf(salon, '1인미용실'), {
        term: '1인미용실', keywords: ['강남역1인미용실', '역삼1인미용실'], rule: 'thin',
        reason: "근거가 편의시설 정보 '1인미용실' 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다.",
    });
    assert.equal(excludedOf(salon, '헤어샵').reason, '근거가 매장 이름 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다.');
    assert.equal(excludedOf(restaurantNoBriefing, '룸식당').reason, "근거가 좌석 정보 '룸' 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다.");
    // 유지돼야 하는 것: 상위 매장 등록(바버샵)·손님이 고른 좋은 점+상위 매장(남자머리)·손님이 고른 좋은 점+블로그(모임·대형약국)
    const kept = (result) => result.items.map((item) => item.term);
    assert.equal(['바버샵', '남자머리'].every((word) => kept(salon).includes(word)), true);
    assert.equal(kept(restaurant).includes('모임'), true);
    assert.equal(kept(full(FULL_PHARMACY, { limit: 100 })).includes('대형약국'), true);
    // 약국의 "영양제"·"동물약국"은 등록 키워드가 근거라 그대로 권한다
    assert.deepEqual(['영양제', '동물약국'].map((word) => kept(full(FULL_PHARMACY, { limit: 100 })).includes(word)), [true, true]);
    // 빠진 자리는 약한 것으로 채우지 않는다: 추천이 줄어도 된다(약국·음식점은 12개에 못 미침)
    assert.equal(restaurant.items.length < 12, true);

    // 근거가 더해지면 다시 권한다: 블로그 후기에 나오거나, 리뷰·손님이 고른 좋은 점이 있거나, 상위 매장이 그 낱말을 쓰면
    const place = { ...SHOP, name: '시험헤어', category: '미용실', conveniences: ['1인미용실'], reviewMenus: [], detail: { menus: [] } };
    assert.equal(excludedOf(recommendKeywords({ place }), '1인미용실').rule, 'thin');
    const blog = recommendKeywords({ place, activity: { mentions: { blogTotal: 20, terms: [{ term: '1인미용실', count: 4 }] } } });
    assert.equal(blog.items.some((item) => item.term === '1인미용실'), true);
    const rival = recommendKeywords({ place, rivals: [{ placeId: 'a', name: '가', keywords: ['역삼1인미용실'] }, { placeId: 'b', name: '나', keywords: ['강남1인미용실'] }] });
    assert.equal(rival.items.some((item) => item.term === '1인미용실'), true);
    const voted = recommendKeywords({ place: { ...place, reviewVotes: [{ label: '1인미용실이라 편해요', count: 12 }] } });
    assert.equal(voted.items.some((item) => item.term === '1인미용실'), true);
    // 사장님이 등록한 낱말은 사장님의 선택이라 걸지 않는다
    const owned = recommendKeywords({ place: { ...place, keywords: ['역삼1인미용실'] } });
    assert.equal(owned.excluded.some((entry) => entry.rule === 'thin' && entry.term === '1인미용실'), false);
    // 영업시간이 근거인 낱말(23시 넘게 여는 약국의 심야약국)은 그 조건이 근거라 걸지 않는다(상위 매장이 없어도)
    const pharmacy = recommendKeywords({ place: { ...SHOP, name: '시험약국', category: '약국', detail: { hours: { registered: true, days: [{ day: '매일', start: '09:00', end: '23:30' }] } } } });
    assert.equal(pharmacy.items.some((item) => item.term === '심야약국'), true);
    // 업종 이름이 근거인 낱말(꽃집의 꽃배달)은 업종 연관어가 아니라 걸리지 않는다
    const flower = recommendKeywords({ place: { ...SHOP, name: '시험꽃집', category: '꽃집,꽃배달', conveniences: ['배달'] }, limit: 100 });
    assert.equal(flower.items.some((item) => item.term === '꽃배달'), true);
    assert.equal(flower.excluded.some((entry) => entry.rule === 'thin'), false);
    // 블로그 언급을 물어볼 낱말에는 근거가 얇은 낱말도 들어간다(물어봐야 근거가 생기므로)
    assert.equal(mentionTerms(place).includes('1인미용실'), true);
});

test('등록 키워드가 "지역 + 업종 연관어"일 때 앞부분을 지역으로 잘못 읽지 않는다', () => {
    // 전에는 "청주대형약국"의 "청주대형"을 지역으로 읽어 "청주대형일반의약품"·"청주대형대형약국"을 추천했다
    const pharmacy = { ...FULL_PHARMACY.place, keywords: ['청주대형약국', '일반의약품'] };
    assert.deepEqual(regionTerms(pharmacy).map((region) => region.term), ['청주', '오창', '청원']);
    const result = recommendKeywords({ place: pharmacy, limit: 100 });
    assert.equal(keywordsOf(result).some((word) => word.includes('청주대형')), false);
    assert.equal(result.registered[0].core, '대형약국');
    assert.deepEqual(regionTerms({ ...FULL_RESTAURANT.place, keywords: ['강남구청룸식당'] }).map((region) => region.term), ['강남구청', '강남', '논현']);
    assert.deepEqual(regionTerms({ ...FULL_SALON.place, keywords: ['강남역1인미용실'] }).map((region) => region.term), ['강남역', '역삼']); // "강남"은 "강남역"과 같은 뿌리라 한 지역
    // 주소에 없는 지역("압구정")을 등록 키워드에서 읽는 것은 그대로다
    assert.equal(regionTerms(FULL_RESTAURANT.place).some((region) => region.term === '압구정' && region.scope === 'custom'), true);
});

test('걸러낸 것(excluded)의 모양과, 추천·자동 순위 조회에는 관문을 통과한 것만 나온다는 것', () => {
    for (const all of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON].flatMap((sample) => [full(sample, { limit: 100 }), full(sample, { limit: 100, ranks: sample.ranks })])) {
        const passedWords = new Set(keywordsOf(all));
        for (const entry of all.excluded) {
            assert.equal(RULES.includes(entry.rule), true, entry.rule);
            assert.equal(typeof entry.term === 'string' && entry.term.length >= 2, true);
            assert.equal(Array.isArray(entry.keywords) && entry.keywords.length >= 1, true, entry.term);
            assert.equal(['offMain', 'otherBusiness', 'thin'].includes(entry.rule) ? /\.$/.test(entry.reason) : /^[^.]+\.$/.test(entry.reason), true, entry.reason);
            assert.equal(/검색량|조회수|제철|계절/.test(entry.reason), false, entry.reason);
            assert.equal(Object.keys(entry).every((key) => ['term', 'keywords', 'rule', 'reason', 'into', 'words', 'popular', 'useIn', 'lead', 'why'].includes(key)), true);
            // into 는 묶인 낱말(merged)이나 대신 쓸 손님 말(classification)에만 있다(그 낱말이 화면에 보일 때만 — 아래 '이유 문장 전수 확인')
            if ('into' in entry) assert.equal(['merged', 'classification'].includes(entry.rule), true, `${entry.rule} ${entry.term}`);
            for (const word of entry.keywords) assert.equal(passedWords.has(word), false, word);
        }
    }
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        const all = full(sample, { limit: 100 });
        const passedWords = new Set(keywordsOf(all));
        for (const entry of all.excluded) {
            assert.equal(RULES.includes(entry.rule), true, entry.rule);
            assert.equal(typeof entry.term === 'string' && entry.term.length >= 2, true);
            assert.equal(Array.isArray(entry.keywords) && entry.keywords.length >= 1, true, entry.term);
            // 이유는 사장님이 읽을 한 문장이고, 가진 자료로 말할 수 없는 "검색량"은 쓰지 않는다
            assert.equal(['offMain', 'otherBusiness', 'thin'].includes(entry.rule) ? /\.$/.test(entry.reason) : /^[^.]+\.$/.test(entry.reason), true, entry.reason);
            assert.equal(/검색량|조회수/.test(entry.reason), false, entry.reason);
            assert.equal(Object.keys(entry).every((key) => ['term', 'keywords', 'rule', 'reason', 'into', 'words', 'popular', 'useIn', 'lead', 'why'].includes(key)), true);
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
    assert.deepEqual(pickRankKeywords(FULL_PHARMACY.place, full(FULL_PHARMACY)).keywords, ['청주대형약국', '청주약국', '오창약국', '청주영양제', '청주동물약국']);
    assert.deepEqual(pickRankKeywords(FULL_SALON.place, full(FULL_SALON)).keywords, ['강남역미용실', '강남역댄디컷', '강남역다운펌', '강남역쉐도우펌', '강남역볼륨매직']);
    assert.deepEqual(pickRankKeywords(FULL_RESTAURANT.place, full(FULL_RESTAURANT)).keywords, FULL_RESTAURANT.place.keywords);
    // 매장이 없으면 빈 목록
    assert.deepEqual(recommendKeywords({ place: null }).excluded, []);
});

/* ───────── 걸러낸 이유 문장: 문장이 가리키는 키워드·수치는 실제 자료와 화면에 보이는 결과에 있어야 한다 ─────────
 * 2026-11-17 미용실 견본에서 "'강남역1인미용실'이 이미 있어, …"가 나왔는데 그 조합은 추천 12개 밖이라 화면 어디에도 없었다.
 * "화면에 보인다" = 최종 추천(items, limit 안) 또는 이미 등록한 키워드. */

const squash = (text) => String(text ?? '').replace(/\s+/g, '').toLowerCase();
const quotedIn = (text) => [...String(text ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
const REGION_TAIL = /, '([^']+)'에 지역만 바꾼 조합은 더 권하지 않습니다\.$/;

// 순위 표 한 줄을 이유 문장에 적는 꼴(41위 · 300위 밖 · 목록에 없음 · 먼 지역 결과)
function rankTextOf(row, coordinate) {
    const { result } = row;
    if (rankLocality(result, coordinate)?.scope === 'far') return '먼 지역 결과';
    if (result.status === 'found' && Number.isFinite(result.rank)) return `${result.rank}위`;
    if (result.status === 'beyond' && Number.isFinite(result.scanned)) return `${result.scanned.toLocaleString('ko-KR')}위 밖`;
    return '목록에 없음';
}

// excluded 한 벌을 넘긴 자료(input)와 돌려받은 결과(result)에 대조한다
function auditExcluded(input, result, label) {
    const { place, activity = null, ranks = [], rivals = [] } = input;
    const itemKeywords = new Set(keywordsOf(result));
    const registered = new Set(place.keywords || []);
    const shownTerms = new Set([...result.items.map((item) => squash(item.term)), ...(place.keywords || []).map((keyword) => keywordCore(keyword, result.regions))]);
    const regionNames = new Set(result.regions.map((region) => region.term));
    const haystack = squash(JSON.stringify([place, activity]));
    const menus = [...new Set((place.detail?.menus || []).map((entry) => squash(entry.name)).filter(Boolean))];
    const inMenus = (word) => menus.filter((name) => name.includes(squash(word))).length;
    const reviews = new Map((place.reviewMenus || []).map((entry) => [squash(entry.label), entry.count]));
    const bookings = new Map((place.detail?.styles || []).map((entry) => [squash(entry.name), entry.count]));
    const mentions = new Map((activity?.mentions?.terms || []).map((entry) => [squash(entry.term), entry.count]));
    const doneRows = new Map(ranks.filter((row) => row.state === 'done' && row.result).map((row) => [row.keyword, row]));
    const rivalCount = new Set(rivals.map((rival) => String(rival.placeId))).size;
    const number = (text) => Number(String(text).replace(/,/g, ''));

    for (const entry of result.excluded) {
        const at = `${label} [${entry.rule}] ${entry.term}: ${entry.reason}`;
        const words = quotedIn(entry.reason);
        const withFacts = ['offMain', 'otherBusiness'].includes(entry.rule);
        assert.equal(Object.keys(entry).every((key) => ['term', 'keywords', 'rule', 'reason', 'into', ...(withFacts ? ['words', 'popular', 'useIn', 'lead', 'why'] : [])].includes(key)), true, at);
        assert.equal(RULES.includes(entry.rule), true, at);
        // 이유는 사장님이 읽을 한 문장. 손님이 찾는 메뉴를 키워드에서 빼는 두 규칙(사실 → 이유 → 대신 쓸 자리)은 문장 셋까지, 근거가 얇은 낱말(thin)은 둘까지
        if (withFacts || entry.rule === 'thin') {
            assert.equal(/\.$/.test(entry.reason) && !/\.\./.test(entry.reason) && entry.reason.split(/(?<=\.) /).length <= (withFacts ? 3 : 2), true, at);
            assert.equal(/주력 메뉴로 보기 어렵|곁들임/.test(entry.reason), false, at);
        } else assert.equal(/^[^.]+\.$/.test(entry.reason), true, at);
        // 근거가 얇은 낱말: 근거가 매장 사실 하나뿐이라는 말이 자료와 같다(편의시설·좌석·매장 이름·매장 특징·반려동물), 그 낱말이 리뷰·예약·블로그·상위 매장에 없다
        if (entry.rule === 'thin') {
            const fact = entry.reason.match(/^근거가 (.+) 하나뿐입니다\. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다\.$/)?.[1];
            assert.equal(Boolean(fact), true, at);
            const key = squash(entry.term);
            const given = squash(fact.match(/'(.+)'/)?.[1]);
            if (fact.startsWith('편의시설 정보')) assert.equal([...(place.conveniences || []), ...(place.detail?.facilities || [])].some((word) => squash(word) === given), true, at);
            else if (fact.startsWith('좌석 정보')) assert.equal((place.detail?.seats || []).some((word) => squash(word) === given), true, at);
            else assert.equal(fact === '매장 이름' || fact.startsWith('매장 특징') || fact.includes('반려동물'), true, at);
            assert.equal((mentions.get(key) ?? 0) > 0, false, at);
            assert.equal(reviews.has(key) || bookings.has(key), false, at);
            assert.equal(rivals.some((rival) => (rival.keywords || []).some((word) => squash(word).includes(key))), false, at);
        }
        assert.equal(/검색량|조회수|제철|계절/.test(entry.reason), false, at);
        // 걸러낸 조합은 추천에도 등록 키워드에도 없다
        for (const keyword of entry.keywords) assert.equal(itemKeywords.has(keyword) || registered.has(keyword), false, `${at} / ${keyword}`);
        // into 가 가리키는 낱말은 화면에 보이고(추천의 낱말이나 등록 키워드의 낱말) 문장에도 적혀 있다
        if ('into' in entry) {
            assert.equal(['merged', 'classification'].includes(entry.rule), true, at);
            assert.equal(shownTerms.has(squash(entry.into)), true, at);
            assert.equal(words.includes(entry.into), true, at);
        }
        // 따옴표로 적은 낱말·키워드는 화면에 보이거나(추천·등록 키워드·지역 이름) 그 줄의 낱말이거나 매장 자료에 있는 말이다
        for (const word of words) {
            const grounded = word === entry.term || itemKeywords.has(word) || registered.has(word) || shownTerms.has(squash(word))
                || regionNames.has(word) || haystack.includes(squash(word));
            assert.equal(grounded, true, `${at} / '${word}'`);
        }

        // 지역만 바꾼 조합: "이미 등록한 키워드"는 등록 키워드에, "추천에 이미 있어"는 최종 추천에 있다
        if (entry.rule === 'region') {
            assert.match(entry.reason, REGION_TAIL, at);
            assert.equal(entry.reason.match(REGION_TAIL)[1], entry.term, at);
            const head = entry.reason.replace(REGION_TAIL, '');
            if (/로 바꿔 권하며$/.test(head)) {
                // 순위 표의 조합이 30위 밖이라 내 순위가 좋은 지역의 조합으로 바꾼 줄: 적은 순위는 순위 표 그대로이고, 바꾼 조합은 추천에 있다
                const [was, now] = quotedIn(head);
                assert.equal(itemKeywords.has(now) && !registered.has(now), true, `${at} / ${now}`);
                const wasRow = doneRows.get(was);
                assert.equal(Boolean(wasRow), true, `${at} / ${was}`);
                const text = rankTextOf(wasRow, place.coordinate);
                assert.equal(head.includes(`내 순위가 ${/위 밖$|^목록에 없음$/.test(text) ? '30위 밖' : text}`), true, at);
                for (const keyword of [was, now, ...entry.keywords]) assert.equal(keywordCore(keyword, result.regions), squash(entry.term), `${at} / ${keyword}`);
            } else {
                const [ownPart, listPart] = head.includes('이미 등록한 키워드') ? head.split(/이미 등록한 키워드(?:라$|이고 )/) : ['', head];
                const own = quotedIn(ownPart);
                const listed = quotedIn(listPart);
                assert.equal(own.length + listed.length >= 1, true, at);
                if (listed.length > 0) assert.match(listPart, /추천에 이미 있어$/, at);
                else assert.equal(listPart, '', at);
                for (const keyword of own) assert.equal(registered.has(keyword), true, `${at} / 등록 ${keyword}`);
                for (const keyword of listed) assert.equal(itemKeywords.has(keyword), true, `${at} / 추천 ${keyword}`);
                for (const keyword of [...own, ...listed, ...entry.keywords]) assert.equal(keywordCore(keyword, result.regions), squash(entry.term), `${at} / ${keyword}`);
            }
        }
        // 하나로 묶은 낱말: 남긴 낱말이 보이면 "묶었다", 안 보이면 그 사실을 적는다. 낱말 옆의 리뷰·예약 수는 자료 그대로
        if (entry.rule === 'merged') {
            const kept = words[words.length - 1];
            if ('into' in entry) {
                assert.match(entry.reason, /하나로 묶었습니다\.$/, at);
                assert.equal(kept, entry.into, at);
            } else {
                assert.match(entry.reason, /추천 목록에는 없습니다\.$/, at);
                assert.equal(shownTerms.has(squash(kept)), false, at);
            }
            for (const [, word, counts] of entry.reason.matchAll(/'([^']+)'\(([^)]*)\)/g)) {
                for (const part of counts.split('·')) {
                    const review = part.match(/^리뷰 ([\d,]+)회$/);
                    const booking = part.match(/^예약 ([\d,]+)건$/);
                    assert.equal(Boolean(review || booking), true, `${at} / ${part}`);
                    if (review) assert.equal(reviews.get(squash(word)), number(review[1]), `${at} / ${word} ${part}`);
                    if (booking) assert.equal(bookings.get(squash(word)), number(booking[1]), `${at} / ${word} ${part}`);
                }
            }
        }
        if (entry.rule === 'classification') {
            // 자료가 말하는 것만: 대신 쓸 말이 블로그 후기에 나온 글 수(자료가 있을 때), 없으면 "대신 ○○을 쓸 수 있다"·"권하지 않는다"
            const said = entry.reason.match(/블로그 후기에는 '([^']+)'(?:이라는|라는) 말이 나옵니다\((\d+)개 중 (\d+)개\)\.$/);
            if (said) {
                assert.equal(Number(said[2]), activity?.mentions?.blogTotal, at);
                assert.equal(Number(said[3]), mentions.get(squash(said[1])), at);
            } else {
                assert.match(entry.reason, 'into' in entry ? /대신 '[^']+'[을를] 쓸 수 있습니다\.$/ : /지역을 붙인 키워드로는 권하지 않습니다\.$/, at);
            }
        }
        // 메뉴 개수는 읽어 온 범위로 말한다("메뉴판 34개"처럼 전체라고 단정하지 않음). 읽어 온 메뉴 수와 그 낱말이 든 메뉴 수
        assert.equal(/메뉴판 \d+개/.test(entry.reason), false, at);
        for (const diagnosis of result.registered) assert.equal(/메뉴판 \d+개/.test(diagnosis.concern?.reason ?? ''), false, `${label} 등록 ${diagnosis.keyword}`);
        for (const [, total] of entry.reason.matchAll(/읽어 온 메뉴 (\d+)개/g)) assert.equal(Number(total), menus.length, at);
        const few = entry.rule === 'otherBusiness' ? entry.reason.match(/\(읽어 온 메뉴 \d+개 중 (\d+)개\)/) : null;
        if (few) {
            // 그 줄의 낱말이나 그 끝말("소금김밥"의 "김밥")이 든 메뉴 수
            const tails = Array.from({ length: entry.term.length - 1 }, (_, index) => entry.term.slice(index));
            assert.equal(tails.some((tail) => inMenus(tail) === Number(few[1])), true, at);
        }
        if (/\(읽어 온 메뉴 \d+개에는 없음\)/.test(entry.reason)) for (const word of entry.words) assert.equal(inMenus(word), 0, `${at} / ${word}`);
        if (entry.rule === 'offMain') {
            const only = entry.reason.match(/메뉴 (\d+)개에만 나오는/);
            for (const name of entry.words) assert.equal(inMenus(name), only ? Number(only[1]) : 0, `${at} / ${name}`);
            const main = entry.reason.match(/\(읽어 온 메뉴 \d+개 중 (\d+)개\)/);
            assert.equal(Number(main[1]) >= 1 && Number(main[1]) <= menus.length, true, at);
        }
        // 손님이 찾는 메뉴라는 사실(offMain·otherBusiness): 문장에 적은 수치와 구조화한 값(words·popular·useIn)이 자료에서 직접 센 값과 같다
        if (withFacts) {
            assert.equal(Array.isArray(entry.words) && entry.words.length >= 1 && entry.words[0] === entry.term, true, at);
            for (const word of entry.words) assert.equal(entry.keywords.some((keyword) => keyword.endsWith(word)), true, `${at} / ${word}`);
            const keys = entry.words.map(squash);
            const reviewHits = keys.map((key) => [key, reviews.get(key)]).filter(([, count]) => count !== undefined);
            const topReview = Math.max(0, ...reviewHits.map(([, count]) => count));
            const posList = place.detail?.pos?.popularMenus || [];
            const posAt = posList.findIndex((menuRow) => keys.some((key) => squash(menuRow.name).includes(key)));
            const inBriefing = (activity?.briefing || []).some((sentence) => keys.some((key) => squash(sentence).includes(key)));
            const named = entry.reason.match(/리뷰 ((?:'[^']+' [\d,]+회·?)+)/);
            const posNamed = entry.reason.match(/주간 인기 메뉴 (\d+)위 '([^']+)'(?: 주문의 (\d+)%)?/);
            if (entry.popular) {
                const rankAmongReviews = [...reviews.values()].filter((count) => count > topReview).length + 1;
                assert.deepEqual(
                    [entry.popular.reviews, entry.popular.reviewRank, entry.popular.posRank, entry.popular.posShare, entry.popular.posName, entry.popular.briefing],
                    [reviewHits.length ? topReview : null, reviewHits.length ? rankAmongReviews : null, posAt >= 0 ? posAt + 1 : null,
                        posAt >= 0 && Number.isFinite(posList[posAt].share) ? posList[posAt].share : null, posAt >= 0 ? posList[posAt].name.trim() : null, inBriefing],
                    at,
                );
                assert.equal(entry.popular.menus, menus.filter((name) => keys.some((key) => name.includes(key))).length, at);
                assert.equal(entry.popular.menuTotal, menus.length, at);
                // 문장에 적힌 리뷰 수·주간 인기 순위·비중은 자료 그대로
                if (reviewHits.length) {
                    assert.equal(Boolean(named), true, at);
                    for (const [, word, count] of named[1].matchAll(/'([^']+)' ([\d,]+)회/g)) assert.equal(reviews.get(squash(word)), number(count), `${at} / ${word}`);
                } else assert.equal(named, null, at);
                if (posAt >= 0) assert.deepEqual([Number(posNamed[1]), posNamed[2], posNamed[3] === undefined ? null : Number(posNamed[3])], [posAt + 1, posList[posAt].name.trim(), Number.isFinite(posList[posAt].share) ? posList[posAt].share : null], at);
                else assert.equal(posNamed, null, at);
                assert.equal(/AI 브리핑/.test(entry.reason), inBriefing, at);
                // "많이 찾는"은 리뷰 메뉴 1위이거나 주간 인기 메뉴 3위 안일 때만 쓴다
                assert.equal(/손님이 많이 찾는 메뉴입니다/.test(entry.reason), entry.popular.reviewRank === 1 || (entry.popular.posRank !== null && entry.popular.posRank <= 3), at);
                assert.equal(/^'[^']+'(?:·'[^']+')*[은는] /.test(entry.reason), true, at);
            } else {
                // 손님 자료에 나오지 않는 메뉴: 사실 문장이 없다
                assert.deepEqual([reviewHits.length, posAt, inBriefing], [0, -1, false], at);
                assert.equal(/찾는 메뉴입니다|나오는 메뉴입니다/.test(entry.reason), false, at);
            }
            // 대신 쓸 자리: 손님 자료에 나오거나 메뉴판에 그 낱말이 든 메뉴가 있을 때만
            const menusWith = menus.filter((name) => keys.some((key) => name.includes(key))).length;
            const useful = Boolean(entry.popular) || menusWith > 0;
            assert.deepEqual(entry.useIn ?? null, useful ? ['메뉴 설명', '소식', '소개글'] : null, at);
            assert.equal(entry.reason.includes('메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.'), useful && !/업종·매장 이름에서 그 근거/.test(entry.reason), at);
        }
        // 내 순위: 적은 순위는 순위 표의 그 키워드 결과 그대로이고, "먼저 권한다"는 지역의 조합이 추천에 실제로 있다
        if (entry.rule === 'rank') {
            const cited = [...entry.reason.matchAll(/(\d[\d,]*위(?: 밖)?|목록에 없음|먼 지역 결과)\('([^']+)'\)/g)];
            assert.equal(cited.length >= 1, true, at);
            for (const [, text, keyword] of cited) {
                assert.equal(doneRows.has(keyword) && keyword.includes(entry.term), true, `${at} / ${keyword}`);
                assert.equal(text, rankTextOf(doneRows.get(keyword), place.coordinate), `${at} / ${keyword}`);
            }
            const ahead = entry.reason.match(/내 순위가 좋은 (.+) 조합을 먼저 권합니다/);
            for (const name of quotedIn(ahead?.[1])) assert.equal(result.items.some((item) => item.region === name), true, `${at} / ${name}`);
            for (const keyword of entry.keywords) assert.equal(keyword.startsWith(entry.term), true, `${at} / ${keyword}`);
        }
        // 블로그 후기 수와, 그 낱말이 나온 글이 0개라는 것
        const blog = entry.reason.match(/블로그 후기 (\d+)개 가운데/);
        if (blog) assert.equal(Number(blog[1]), activity?.mentions?.blogTotal, at);
        if (entry.rule === 'noBlog') for (const word of words) assert.equal(mentions.get(squash(word)), 0, `${at} / ${word}`);
        // 상위 매장 수는 넘긴 상위 매장 수를 넘지 않는다
        const rivalsCited = entry.reason.match(/상위 매장 (\d+)곳/);
        if (rivalsCited) assert.equal(Number(rivalsCited[1]) >= 1 && Number(rivalsCited[1]) <= rivalCount, true, at);
    }
}

test('지역만 바꾼 조합 줄은 남긴 조합이 화면에 보일 때만 내고, 등록한 키워드와 추천에 있는 조합을 가려 적는다', () => {
    // 미용실(추천 자리를 10개로 줄이면): "강남역가일컷"·"강남역필러스컷"은 10개 밖이라 화면에 없다.
    // 전에는 "'강남역1인미용실'이 이미 있어, …"라고 적었다. 추천 자리에 못 든 것일 뿐 걸러낸 것이 아니므로 줄을 내지 않는다
    // (근거가 얇은 "1인미용실"·"헤어샵"은 관문 '타'로 추천에서 빠져 thin 줄 둘이 있다)
    for (const salon of [full(FULL_SALON, { limit: 10 }), full(FULL_SALON, { limit: 10, ranks: FULL_SALON.ranks })]) {
        assert.equal(salon.items.length, 10);
        for (const word of ['가일컷', '남성전문미용실']) {
            assert.equal(keywordsOf(salon).includes(`강남역${word}`), false, word);
            assert.equal(excludedOf(salon, word), undefined, word);
            assert.equal(salon.excluded.some((entry) => entry.reason.includes(`강남역${word}`)), false, word);
        }
        assert.equal(salon.excluded.length, 14);
        assert.equal(salon.excluded.some((entry) => /[이가] 이미 있어,/.test(entry.reason)), false); // 무엇에 있는지 말하지 않는 "이미 있어"는 쓰지 않는다
    }
    // 추천 자리가 넉넉하면 그 조합이 추천에 실제로 있고, 그때는 줄을 낸다
    const wide = full(FULL_SALON);
    assert.equal(wide.items.length, 12);
    assert.equal(keywordsOf(wide).includes('강남역가일컷'), true);
    assert.deepEqual(excludedOf(wide, '가일컷'), {
        term: '가일컷', keywords: ['역삼가일컷'], rule: 'region', reason: "'강남역가일컷'이 추천에 이미 있어, '가일컷'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    // 세 가지 문장: 추천에 있는 조합 / 이미 등록한 키워드 / 둘 다
    const restaurant = full(FULL_RESTAURANT);
    assert.equal(excludedOf(restaurant, '숙성회').reason, "'강남구청숙성회'가 추천에 이미 있어, '숙성회'에 지역만 바꾼 조합은 더 권하지 않습니다.");
    assert.equal(excludedOf(restaurant, '회식').reason, "'강남구청회식'·'압구정회식'은 이미 등록한 키워드라, '회식'에 지역만 바꾼 조합은 더 권하지 않습니다.");
    const both = recommendKeywords({
        place: {
            ...SHOP, name: '시험헤어', category: '미용실', keywords: ['역삼미용실', '역삼다운펌'], reviewMenus: [{ label: '다운펌', count: 50 }],
            detail: { menus: [], subway: { station: '선릉역', exit: '1', walkMinutes: 5 } },
        },
        rivals: [{ placeId: 'a', name: '가', keywords: ['강남다운펌'] }],
    });
    assert.equal(keywordsOf(both).includes('강남다운펌'), true);
    assert.deepEqual(excludedOf(both, '다운펌'), {
        term: '다운펌', keywords: ['선릉역다운펌'], rule: 'region',
        reason: "'역삼다운펌'은 이미 등록한 키워드이고 '강남다운펌'이 추천에 이미 있어, '다운펌'에 지역만 바꾼 조합은 더 권하지 않습니다.",
    });
    // 추천 자리가 줄어 "강남다운펌"이 밀리면 등록한 키워드만 적는다
    const cut = recommendKeywords({
        place: {
            ...SHOP, name: '시험헤어', category: '미용실', keywords: ['역삼미용실', '역삼다운펌'], reviewMenus: [{ label: '다운펌', count: 50 }],
            detail: { menus: [], subway: { station: '선릉역', exit: '1', walkMinutes: 5 } },
        },
        rivals: [{ placeId: 'a', name: '가', keywords: ['강남다운펌'] }], limit: 0,
    });
    assert.equal(excludedOf(cut, '다운펌').reason, "'역삼다운펌'은 이미 등록한 키워드라, '다운펌'에 지역만 바꾼 조합은 더 권하지 않습니다.");
});

test('"뺀 조합"(keywords)에는 사장님이 이미 등록한 키워드를 넣지 않는다', () => {
    // "역삼일반의약품"을 등록한 약국: 전에는 일반의약품 줄의 뺀 조합에 등록 키워드 "역삼일반의약품"이 그대로 들어갔다
    const bare = recommendKeywords({ place: { ...SHOP, name: '시험약국', category: '약국', keywords: ['역삼일반의약품', '의약외품'] } });
    assert.deepEqual(excludedOf(bare, '일반의약품').keywords, ['강남일반의약품']);
    assert.deepEqual(excludedOf(bare, '의약외품').keywords, ['역삼의약외품', '강남의약외품']);
    // 횟집이 "역삼김밥"을 등록: 김밥 줄의 뺀 조합은 등록하지 않은 조합만
    const sushi = recommendKeywords({
        place: {
            ...SHOP, name: '시험수산', category: '생선회', keywords: ['역삼횟집', '역삼김밥'], reviewMenus: [{ label: '김밥', count: 30 }],
            detail: { menus: [...Array.from({ length: 19 }, (_, index) => menu(`회 ${index}`)), menu('소금김밥')] },
        },
    });
    assert.deepEqual(excludedOf(sushi, '김밥').keywords, ['강남김밥']);
});

test('into 는 그 낱말이 화면에 보일 때만 붙이고, 안 보이면 문장도 그에 맞게 적는다', () => {
    // 음식점: 추천 1개에는 "광어" 조합이 없다 → "하나로 묶었다"고 하지 않고 into 도 비운다
    const narrow = full(FULL_RESTAURANT, { limit: 1 });
    assert.deepEqual(keywordsOf(narrow), ['강남구청숙성회']);
    assert.deepEqual(excludedOf(narrow, '광어회'), {
        term: '광어회', keywords: ['강남구청광어회', '압구정광어회'], rule: 'merged',
        reason: "'광어회'(리뷰 13회)는 '광어'(리뷰 34회)가 들어 있는 말이라 '광어'와 한 낱말로 보았는데, '광어'도 추천 목록에는 없습니다.",
    });
    assert.equal(excludedOf(full(FULL_RESTAURANT), '광어회').into, '광어');
    // 약국: 추천 2개("청주대형약국"·"청주약국")에는 "영양제"·"동물약국"이 없다 → 화면에 보이는 업종 대표어 '약국'으로 알려 준다
    const one = full(FULL_PHARMACY, { limit: 2 });
    assert.deepEqual(keywordsOf(one), ['청주대형약국', '청주약국']);
    assert.deepEqual(['건강기능식품', '동물의약품'].map((word) => excludedOf(one, word).into), ['약국', '약국']);
    assert.equal(excludedOf(one, '건강기능식품').reason, "'건강기능식품'은 약·제품을 나누는 분류 이름이고, 블로그 후기에는 '약국'이라는 말이 나옵니다(11개 중 11개).");
    // 등록 키워드 진단도 같은 문장·같은 낱말을 쓴다
    const diagnosis = one.registered.find((entry) => entry.keyword === '건강기능식품');
    assert.deepEqual([diagnosis.concern.reason, diagnosis.spoken.term, diagnosis.spoken.keyword], [excludedOf(one, '건강기능식품').reason, '약국', '청주약국']);
    // 추천이 하나도 없으면 가리킬 낱말이 없어 into 를 비우고, 문장에도 낱말을 적지 않는다
    const none = full(FULL_PHARMACY, { limit: 0 });
    assert.equal('into' in excludedOf(none, '건강기능식품'), false);
    assert.equal(excludedOf(none, '건강기능식품').reason, "'건강기능식품'은 약·제품을 나누는 분류 이름이라, 지역을 붙인 키워드로는 권하지 않습니다.");
    // 손님 말 자체가 관문에 걸리면(블로그 후기에 "영양제" 0개) 그 말을 "손님이 쓰는 말"이라고 가리키지 않는다
    const mentionsOf = (count) => ({
        ...FULL_PHARMACY.activity,
        mentions: { ...FULL_PHARMACY.activity.mentions, terms: FULL_PHARMACY.activity.mentions.terms.map((entry) => (entry.term === '영양제' ? { ...entry, count } : entry)) },
    });
    const unsaid = recommendKeywords({ place: FULL_PHARMACY.place, activity: mentionsOf(0), rivals: FULL_PHARMACY.rivalPool });
    assert.equal(excludedOf(unsaid, '영양제').rule, 'noBlog');
    assert.equal(excludedOf(unsaid, '건강기능식품').into, '약국');
    assert.equal(unsaid.excluded.some((entry) => entry.term !== '영양제' && entry.reason.includes("'영양제'")), false);
    assert.equal(unsaid.registered.find((entry) => entry.keyword === '건강기능식품').concern.reason.includes("'영양제'"), false);
});

test('한 낱말이 다른 낱말을 품고 이유가 같은 줄은 한 줄로 묶는다(수치가 다르면 묶지 않는다)', () => {
    // 음식점: 김밥·소금김밥 → 김밥, 갈치·갈치조림·순살갈치조림 → 갈치 (13줄 → 10줄)
    const restaurant = full(FULL_RESTAURANT, { ranks: FULL_RESTAURANT.ranks });
    assert.deepEqual(restaurant.excluded.map((entry) => `${entry.rule}:${entry.term}`), [
        'otherBusiness:김밥', 'offMain:갈치', 'merged:광어회', 'offMain:볼락구이', 'channel:포장', 'otherBusiness:보쌈', 'broad:한식', 'rank:압구정', 'region:횟집', 'region:회식', 'region:점심',
    ]);
    assert.deepEqual(excludedOf(restaurant, '갈치').keywords, ['강남구청갈치', '강남구청갈치조림', '강남구청순살갈치조림']);
    assert.match(excludedOf(restaurant, '김밥').reason, /^'김밥'·'소금김밥'은 손님이 많이 찾는 메뉴입니다\(리뷰 '김밥' 37회, .*다만 이 말은 김밥집을 가리키는 메뉴 이름인데, 이 매장은 회 메뉴가 중심이라/);
    // 약국·미용실은 품는 낱말이 걸린 것이 없다(약국은 지역만 바꾼 조합 줄이 낱말마다 하나 늘고, 미용실은 "미용실"의 줄과 근거가 얇은 낱말 줄 둘이 늘었다)
    assert.deepEqual([full(FULL_PHARMACY, { ranks: FULL_PHARMACY.ranks }).excluded.length, full(FULL_SALON, { ranks: FULL_SALON.ranks }).excluded.length], [9, 16]);
    // 세 견본: 같은 규칙으로 걸린 낱말 줄끼리 한 낱말이 다른 낱말을 품는 것이 남아 있지 않다
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        for (const result of [full(sample), full(sample, { ranks: sample.ranks }), full(sample, { limit: 100 })]) {
            const lines = result.excluded.filter((entry) => !['region', 'rank'].includes(entry.rule));
            for (const a of lines) for (const b of lines) assert.equal(a !== b && a.rule === b.rule && b.term.includes(a.term), false, `${a.term} ⊂ ${b.term}`);
        }
    }
    // 반대 사례: 메뉴판에서 차지하는 수가 다르면(갈치 2개 · 갈치조림 1개) 문장이 달라 따로 둔다
    const apart = recommendKeywords({
        place: {
            ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [{ label: '광어', count: 70 }, { label: '갈치', count: 20 }, { label: '갈치조림', count: 10 }],
            detail: { menus: ['광어회', '우럭회', '모듬회', '갈치조림', '갈치구이', '매운탕', '공기밥'].map((name) => menu(name)) },
        },
    });
    const head = "다만 업종 '생선회'로 보면 이 매장은 회 메뉴가 중심(읽어 온 메뉴 7개 중 3개)이라";
    const use = '메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.';
    assert.equal(excludedOf(apart, '갈치').reason, `'갈치'는 리뷰에 나오는 메뉴입니다(리뷰 '갈치' 20회). ${head}, 회 메뉴로는 보이지 않고 메뉴 2개에만 나오는 이 낱말은 지역을 붙인 키워드로는 따로 권하지 않습니다. ${use}`);
    assert.equal(excludedOf(apart, '갈치조림').reason, `'갈치조림'은 리뷰에 나오는 메뉴입니다(리뷰 '갈치조림' 10회). ${head}, 회 메뉴로는 보이지 않고 메뉴 1개에만 나오는 이 낱말은 지역을 붙인 키워드로는 따로 권하지 않습니다. ${use}`);
    // 등록 키워드 진단(concern)은 묶지 않고 그 키워드의 낱말만 적는다
    const owned = recommendKeywords({
        place: {
            ...SHOP, name: '시험수산', category: '생선회', keywords: ['역삼횟집', '역삼김밥'], reviewMenus: [{ label: '소금김밥', count: 30 }],
            detail: { menus: [...Array.from({ length: 19 }, (_, index) => menu(`회 ${index}`)), menu('소금김밥')] },
        },
    });
    // (묶인 줄은 낱말 둘의 리뷰 수를 함께 적고, 등록 키워드 진단은 그 키워드의 낱말만 적는다)
    assert.equal(excludedOf(owned, '김밥').reason, "'김밥'·'소금김밥'은 손님이 많이 찾는 메뉴입니다(리뷰 '소금김밥' 30회). 다만 이 말은 김밥집을 가리키는 메뉴 이름인데, 이 매장의 주력이라는 근거를 찾지 못해 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 20개 중 1개). 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.");
    assert.equal(owned.registered[1].concern.reason, "'김밥'은 김밥집을 가리키는 메뉴 이름인데, 이 매장의 주력이라는 근거를 찾지 못해 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 20개 중 1개). 메뉴 설명·소식·소개글에는 쓰기 좋은 낱말입니다.");
});

test('견본 3종의 이유 문장에 적힌 수치는 자료에서 직접 센 값과 같다', () => {
    // 음식점 메뉴판: 34개, 김밥 1 · 보쌈 2 · 갈치(조림) 1 · 볼락구이 0(메뉴판에는 "뽈락구이"), 회 메뉴 11개
    const names = FULL_RESTAURANT.place.detail.menus.map((entry) => entry.name);
    const count = (word) => names.filter((name) => squash(name).includes(word)).length;
    assert.deepEqual([names.length, count('김밥'), count('보쌈'), count('갈치'), count('갈치조림'), count('순살갈치조림'), count('볼락구이')], [34, 1, 2, 1, 1, 1, 0]);
    const sashimi = names.filter((name) => name.split(/[^가-힣A-Za-z0-9]+/).some((word) => /(회|사시미)$/.test(word)));
    assert.equal(sashimi.length, 11);
    assert.equal(sashimi.some((name) => name.includes('갈치')), false);
    const said = (sample, word) => sample.place.reviewMenus.find((entry) => entry.label === word)?.count;
    const booked = (sample, word) => sample.place.detail.styles.find((entry) => entry.name === word)?.count;
    assert.deepEqual([said(FULL_RESTAURANT, '광어'), said(FULL_RESTAURANT, '광어회')], [34, 13]);
    assert.deepEqual([said(FULL_SALON, '댄디컷'), booked(FULL_SALON, '댄디컷'), said(FULL_SALON, '시스루댄디컷'), booked(FULL_SALON, '시스루댄디컷')], [2452, 554, 827, 315]);
    // 음식점 순위 표: 압구정횟집 41위 · 압구정회식 300위 밖, 강남구청은 10위 안이 있다
    const rankOf = (keyword) => FULL_RESTAURANT.ranks.find((row) => row.keyword === keyword).result;
    assert.deepEqual([rankOf('압구정횟집').status, rankOf('압구정횟집').rank, rankOf('압구정회식').status, rankOf('압구정회식').scanned], ['found', 41, 'beyond', 300]);
    assert.equal(FULL_RESTAURANT.ranks.some((row) => row.keyword.startsWith('강남구청') && row.result?.status === 'found' && row.result.rank <= 10), true);
    // 약국 영업시간: 매일 21시에 닫는다
    assert.deepEqual([...new Set(FULL_PHARMACY.place.detail.hours.days.map((day) => day.end))], ['21:00']);
    // 이유 문장에 그 값이 그대로 나온다
    const restaurant = full(FULL_RESTAURANT, { ranks: FULL_RESTAURANT.ranks });
    assert.match(excludedOf(restaurant, '김밥').reason, /리뷰 '김밥' 37회, 주간 인기 메뉴 1위 '소금김밥' 주문의 12%, AI 브리핑에도 나옴\).*\(읽어 온 메뉴 34개 중 1개\)/);
    assert.match(excludedOf(restaurant, '보쌈').reason, /리뷰 '보쌈' 6회\).*\(읽어 온 메뉴 34개 중 2개\)/);
    assert.match(excludedOf(restaurant, '갈치').reason, /리뷰 '갈치' 12회·'갈치조림' 10회, 주간 인기 메뉴 4위 '대물 순살갈치조림' 주문의 5%\).*회 메뉴가 중심\(읽어 온 메뉴 34개 중 11개\)이라.*메뉴 1개에만 나오는/);
    assert.match(excludedOf(restaurant, '압구정').reason, /41위\('압구정횟집'\)·300위 밖\('압구정회식'\)/);
    assert.equal(excludedOf(full(FULL_PHARMACY, { ranks: FULL_PHARMACY.ranks }), '심야약국').reason, "밤 9시에 닫아 '심야약국'으로는 맞지 않습니다.");
});

test('걸러낸 이유 문장 전수 확인: 견본 3종과 변형 견본에서 문장이 가리키는 키워드·수치가 자료·최종 결과와 맞는다', () => {
    const cases = [];
    for (const [name, sample] of [['약국', FULL_PHARMACY], ['음식점', FULL_RESTAURANT], ['미용실', FULL_SALON]]) {
        const base = { place: sample.place, activity: sample.activity, rivals: sample.rivalPool };
        for (const ranks of [[], sample.ranks]) {
            for (const limit of [undefined, 100, 5, 3, 1, 0]) cases.push([`${name} 순위 ${ranks.length}줄 limit ${limit ?? '기본'}`, { ...base, ranks, ...(limit === undefined ? {} : { limit }) }]);
        }
        cases.push([`${name} 첫 분석(상위 매장·활동 없이)`, { place: sample.place }]);
        cases.push([`${name} 상위 매장 없이`, { place: sample.place, activity: sample.activity }]);
    }
    const restaurant = { place: FULL_RESTAURANT.place, activity: FULL_RESTAURANT.activity, rivals: FULL_RESTAURANT.rivalPool };
    cases.push(['음식점 메뉴판 못 읽음', { ...restaurant, place: { ...FULL_RESTAURANT.place, detail: { ...FULL_RESTAURANT.place.detail, menus: [] } }, limit: 100 }]);
    cases.push(['음식점 업종을 생선구이로', { ...restaurant, place: { ...FULL_RESTAURANT.place, category: '생선구이' }, ranks: FULL_RESTAURANT.ranks }]);
    cases.push(['음식점 소식 없음', { ...restaurant, activity: { ...FULL_RESTAURANT.activity, feeds: null } }]);
    cases.push(['음식점 등록 키워드 하나', { ...restaurant, place: { ...FULL_RESTAURANT.place, keywords: ['강남구청횟집'] } }]);
    cases.push(['약국 영양제 블로그 0개', {
        place: FULL_PHARMACY.place, rivals: FULL_PHARMACY.rivalPool,
        activity: { ...FULL_PHARMACY.activity, mentions: { ...FULL_PHARMACY.activity.mentions, terms: FULL_PHARMACY.activity.mentions.terms.map((entry) => (entry.term === '영양제' ? { ...entry, count: 0 } : entry)) } },
    }]);
    cases.push(['약국 등록 키워드에 지역', { place: { ...FULL_PHARMACY.place, keywords: ['청주대형약국', '일반의약품'] }, limit: 100 }]);
    // 줄인 견본(이 파일 위쪽)과 손으로 만든 매장
    cases.push(['줄인 약국', { place: PHARMACY, activity: PHARMACY_MENTIONS }], ['줄인 음식점', { place: RESTAURANT, limit: 60 }], ['줄인 미용실', { place: SALON }]);
    const board = (names) => names.map((name) => menu(name));
    const row = (keyword, result) => ({ keyword, state: 'done', result: { keyword, status: 'found', scanned: 100, top: [], region: null, ...result } });
    const hair = { ...SHOP, name: '시험헤어', category: '미용실', keywords: ['역삼미용실'], reviewMenus: [{ label: '다운펌', count: 50 }], detail: { menus: [] } };
    const sushi = { ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [{ label: '광어', count: 30 }], detail: { menus: [] } };
    cases.push(
        ['칼국수집의 만두', {
            place: {
                ...SHOP, name: '시험손맛집', category: '한식', reviewMenus: [{ label: '칼국수', count: 80 }, { label: '바지락칼국수', count: 30 }, { label: '만두', count: 25 }],
                detail: { menus: board(['바지락칼국수', '얼큰칼국수', '들깨칼국수', '손칼국수', '왕만두', '수육']) },
            },
        }],
        ['생선구이집의 계란찜', {
            place: {
                ...SHOP, name: '시험식당', category: '생선구이', reviewMenus: [{ label: '볼락구이', count: 30 }, { label: '계란찜', count: 8 }],
                detail: { menus: board(['볼락구이', '고등어구이', '삼치구이', '갈치구이', '계란찜', '된장찌개']) },
            },
        }],
        ['횟집의 갈치·갈치조림(수가 다름)', {
            place: {
                ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [{ label: '광어', count: 30 }, { label: '갈치', count: 20 }, { label: '갈치조림', count: 10 }],
                detail: { menus: board(['광어회', '우럭회', '모듬회', '갈치조림', '갈치구이', '매운탕', '공기밥']) },
            },
        }],
        ['긴 쪽으로 묶는 광어회', { place: { ...sushi, reviewMenus: [{ label: '광어회', count: 20 }, { label: '광어', count: 4 }] } }],
        ['술·음료·뜻이 넓은 낱말', {
            place: { ...sushi, reviewMenus: [{ label: '와인', count: 6 }, { label: '튀김', count: 6 }, { label: '생선', count: 5 }, { label: '광어', count: 30 }, { label: '고노와다 추가', count: 4 }, { label: '아나고튀김', count: 4 }] },
            limit: 40,
        }],
        ['상위 매장만 쓰는 오마카세', { place: sushi, rivals: [{ placeId: 'a', name: '가', keywords: ['역삼오마카세'] }, { placeId: 'b', name: '나', keywords: ['강남오마카세'] }] }],
        ['영업시간 모르는 약국의 심야약국', {
            place: { ...SHOP, name: '시험약국', category: '약국', detail: {} },
            rivals: [{ placeId: 'a', name: '가 약국', keywords: ['공공심야약국'] }, { placeId: 'b', name: '나 약국', keywords: ['공공심야약국'] }],
        }],
        ['분류 이름만 등록한 약국', { place: { ...SHOP, name: '시험약국', category: '약국', keywords: ['역삼일반의약품', '의약외품'] } }],
        ['블로그 0개 레이어드컷', {
            place: { ...hair, keywords: ['레이어드컷'], reviewMenus: [] },
            activity: { mentions: { blogTotal: 20, terms: [{ term: '미용실', count: 15 }, { term: '레이어드컷', count: 0 }] } }, limit: 100,
        }],
        ['치킨집의 포장·배달', { place: { ...SHOP, name: '시험치킨', category: '치킨,닭강정', conveniences: ['배달', '포장'] }, limit: 100 }],
        ['등록한 조합 + 상위 매장 조합', {
            place: { ...hair, keywords: ['역삼미용실', '역삼다운펌'], detail: { menus: [], subway: { station: '선릉역', exit: '1', walkMinutes: 5 } } },
            rivals: [{ placeId: 'a', name: '가', keywords: ['강남다운펌'] }],
        }],
        ['순위 31위 지역', { place: hair, ranks: [row('역삼미용실', { rank: 31 })] }],
        ['순위 목록에 없음', { place: hair, ranks: [row('역삼미용실', { status: 'not_listed', rank: null })] }],
        ['순위 범위 밖', { place: hair, ranks: [row('역삼미용실', { status: 'beyond', rank: null, scanned: 1200 })] }],
        ['먼 지역 결과', {
            place: { ...hair, coordinate: { x: '127', y: '37.5' } },
            ranks: [row('역삼미용실', { rank: 2, top: Array.from({ length: 3 }, (_, index) => ({ rank: index + 1, placeId: `f${index}`, isTarget: false, x: String(127 + 60 / 88), y: '37.5' })) })],
        }],
    );
    let lines = 0;
    for (const [label, input] of cases) {
        const result = recommendKeywords(input);
        auditExcluded(input, result, label);
        lines += result.excluded.length;
    }
    // 확인이 빈 목록만 돌지 않았다는 것(규칙마다 한 줄 이상 지나감)
    assert.equal(lines > 300, true, String(lines));
    const seenRules = new Set(cases.flatMap(([, input]) => recommendKeywords(input).excluded.map((entry) => entry.rule)));
    assert.deepEqual(RULES.filter((rule) => !seenRules.has(rule)), []);
});
