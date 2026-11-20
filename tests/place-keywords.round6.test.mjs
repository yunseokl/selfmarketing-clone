import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendKeywords, mentionTerms, popularMenuTerm } from '../lib/place-keywords.js';
import { CASES, mkPlace, mkActivity, rv, rank } from './place-keywords.round6.fixtures.mjs';
import { RESTAURANT } from './place-graph.fixtures.mjs';

// 추천 키워드 6차 채점(2026-11-18)의 새 입력 64종과 개별 시험에서 나온 지적 중, 배포 전에 고친 것(묶음 6-A)을 지킵니다.
// 입력은 전부 시험용으로 만든 가짜 매장이고 숫자도 지어낸 값입니다(실제 매장·네이버 자료 아님). 번호(M2·K4 등)는 채점 보고서의 감점 번호입니다.
// 원칙: 낱말 목록을 늘리는 대신 "그 매장의 자기 업종·메뉴판에 있는 말은 목록보다 우선", "많이 언급된 메뉴는 곁들임으로 보지 않음",
// "확신이 없으면 단정하는 문장을 쓰지 않음"으로 고칩니다.

const byId = new Map(CASES.map((item) => [item.id, item]));
const first = (id) => recommendKeywords({ place: byId.get(id).place, activity: byId.get(id).activity });
const last = (id) => recommendKeywords({ place: byId.get(id).place, activity: byId.get(id).activity, rivals: byId.get(id).rivals, ranks: byId.get(id).ranks });
const terms = (result) => result.items.map((item) => item.term);
const excludedOf = (result, term) => result.excluded.find((entry) => entry.term === term && entry.rule !== 'region'); // 지역만 바꾼 조합 줄(region)은 걸러낸 낱말이 아니라 제외
const registeredOf = (result, keyword) => result.registered.find((entry) => entry.keyword === keyword);
const SHOP = { address: '서울 마포구 마포대로 10', jibun: '서울 마포구 공덕동 1', keywords: [] };
// 시험용 매장: 블로그 언급은 모두 0으로 두지 않도록 낱말마다 값을 줘서 쓴다
const make = (id, p, counts = {}, blogTotal = 40) => {
    const place = mkPlace({ id, ...SHOP, ...p });
    const asked = mentionTerms(place);
    const filled = { ...counts };
    for (const term of asked) if (filled[term] === undefined) filled[term] = 5;
    return { place, activity: mkActivity(place, { counts: filled, dflt: 0, blogTotal }) };
};

test('6차 입력 64종: 어떤 입력에서도 예외 없이 돌고 정렬·점수 합이 맞다', () => {
    assert.equal(CASES.length >= 60, true);
    for (const item of CASES) {
        for (const [mode, result] of [['A', first(item.id)], ['B', last(item.id)]]) {
            const at = `${item.id}/${mode}`;
            const registrable = result.items.filter((entry) => entry.registrable);
            assert.deepEqual(registrable.map((entry) => entry.score), [...registrable.map((entry) => entry.score)].sort((a, b) => b - a), at);
            for (const entry of result.items) assert.equal(entry.evidence.parts.reduce((sum, part) => sum + part.points, 0), entry.evidence.points, `${at} ${entry.keyword}`);
        }
    }
});

test('M3 앞에 구체적인 말이 붙은 업종 이름(베트남음식)은 넓은 말이 아니다. 재료 갈래·"○○요리"는 그대로 넓다', () => {
    for (const mode of ['A', 'B']) {
        const result = mode === 'A' ? first('A23') : last('A23');
        assert.equal(excludedOf(result, '베트남음식'), undefined, mode);
        assert.equal(registeredOf(result, '신촌베트남음식').concern, null, mode);
        assert.equal(terms(result).includes('쌀국수'), true, mode);
    }
    const vague = (category) => recommendKeywords({ place: mkPlace({ id: 'v', ...SHOP, name: '시험', category, keywords: [] }) }).excluded.find((entry) => entry.term === category.split(',')[0] && entry.rule === 'vague');
    for (const category of ['육류,고기요리', '해물,생선요리', '닭요리', '고기요리', '해산물']) assert.equal(Boolean(vague(category)), true, category);
    for (const category of ['베트남음식', '태국음식', '이탈리아음식', '일본음식', '중국음식', '인도음식']) assert.equal(Boolean(vague(category)), false, category);
});

test('M2 등록 키워드가 "맛집"으로 끝나도 갈래 이름이 깨지지 않는다("마" 같은 조각이 문장에 안 나옴)', () => {
    for (const id of ['B02', 'B14']) {
        for (const result of [first(id), last(id)]) {
            const text = JSON.stringify(result.excluded.map((entry) => entry.reason));
            assert.equal(/(^|[^가-힣])마(·| 메뉴)|마 메뉴가|부대찌개마|·마·/.test(text), false, id);
        }
    }
    // 갈래는 업종·등록 키워드의 "○○집"에서 갈래 사전(회·구이·국밥·치킨…)에 있는 끝말일 때만 읽는다: 맛집·빵집은 갈래가 아니다
    const noGenre = recommendKeywords({
        place: mkPlace({ id: 'g', ...SHOP, name: '시험식당', category: '한식', keywords: ['공덕맛집'], menus: ['마늘닭강정', '닭강정', '전골', '부대찌개', '순두부'], reviewMenus: [rv('닭강정', 50)] }),
    });
    assert.equal(noGenre.excluded.some((entry) => entry.rule === 'offMain'), false);
});

test('M10 그 매장의 자기 업종·메뉴판에 있는 말은 넓은 말·지명·꾸밈말 목록보다 우선한다', () => {
    // 반찬가게의 "반찬": 업종 이름이 "반찬가게"라 뜻이 넓다고 거르지 않는다(등록 "상계동반찬"에 거짓 살펴볼 점이 안 붙음)
    const side = last('A01');
    assert.equal(excludedOf(side, '반찬'), undefined);
    assert.equal(registeredOf(side, '상계동반찬').concern, null);
    // 반대 사례: 업종이 "생선회"일 때 "생선"은 여전히 뜻이 넓은 말이다
    const fish = recommendKeywords({ place: mkPlace({ id: 'f', ...SHOP, name: '시험수산', category: '생선회', reviewMenus: [rv('생선', 30), rv('광어', 40)], menus: ['광어회', '우럭회', '모둠회', '매운탕', '공기밥'] }), limit: 100 });
    assert.equal(excludedOf(fish, '생선').rule, 'vague');
    // 음악학원의 리뷰 메뉴 "기타"(악기)는 업종 이름 "기타"가 아니다
    // (7차: 메뉴판·예약·결제 자료가 하나도 없는 매장은 리뷰 낱말이 후보라서, 이 시험은 악기 이름이 든 메뉴판이 있는 같은 매장으로 본다)
    const music = make('m', { name: '울림 음악학원', category: '음악학원', keywords: ['공덕음악학원'], menus: ['기타 교습', '피아노 교습', '드럼 교습', '보컬 교습'], reviewMenus: [rv('기타', 100), rv('피아노', 90), rv('드럼', 50), rv('보컬', 40)] }, { 음악학원: 8, 기타: 6, 피아노: 5, 드럼: 3, 보컬: 3 });
    const instruments = recommendKeywords(music);
    assert.equal(terms(instruments).includes('기타'), true);
    assert.equal(excludedOf(instruments, '기타'), undefined);
    // 업종 이름 자리의 "기타"는 여전히 넓은 말이다
    assert.equal(excludedOf(recommendKeywords({ place: mkPlace({ id: 'e', ...SHOP, name: '시험', category: '기타', keywords: [] }) }), '기타').rule, 'broad');
    // 횟집 메뉴의 "대구탕"에서 온 "대구"(생선)는 지명이 아니다. 따로 띄어 쓴 "전주 비빔밥"의 "전주"는 지명이다
    const cod = recommendKeywords(make('c', { name: '시험횟집', category: '횟집', menus: ['대구탕', '광어회', '우럭회', '모둠회', '매운탕'], reviewMenus: [rv('대구', 40), rv('광어', 60)] }, { 횟집: 9, 대구: 4, 광어: 5 }));
    assert.equal(excludedOf(cod, '대구'), undefined);
    assert.equal(terms(cod).includes('대구'), true);
    const jeonju = recommendKeywords(make('j', { name: '시험식당', category: '한식당', menus: ['전주 비빔밥', '전주 콩나물국밥', '전주 육회', '순두부', '불고기'], reviewMenus: [rv('전주', 30), rv('비빔밥', 60)] }, { 한식당: 5, 비빔밥: 5 }));
    assert.equal(excludedOf(jeonju, '전주').rule, 'place');
    // 의류대여의 "가운"(웨딩·졸업 가운)은 꾸밈말이 아니다. 다른 이름 앞에 붙어 쓰이는 "매운"은 꾸밈말이다
    const gown = recommendKeywords(make('g2', { name: '시험대여', category: '의류대여', menus: ['졸업가운', '웨딩드레스'], reviewMenus: [rv('가운', 70), rv('드레스', 50)] }, { 의류대여: 6, 가운: 3, 드레스: 3 }));
    assert.equal(terms(gown).includes('가운'), true);
    const spicy = recommendKeywords(make('s', { name: '시험식당', category: '한식당', menus: ['매운 갈비찜', '매운 낙지볶음', '순두부', '김치찌개', '제육볶음'], reviewMenus: [rv('매운', 40), rv('순두부', 60)] }, { 한식당: 5, 순두부: 5 }));
    assert.equal(excludedOf(spicy, '매운')?.rule, 'attribute');
});

test('M4 꾸밈말은 서로 다른 품목 둘 이상 앞에 되풀이될 때만 뗀다(한 품목에만 붙은 앞말은 이름의 일부)', () => {
    const base = { name: '시험스튜디오', category: '요가', keywords: ['공덕요가'], menus: ['빈야사 수업', '필라테스 수업'] };
    // 한 품목에만 붙은 앞말: 핫 요가·클래식 기타·수제 맥주·블로그 마케팅은 이름 그대로
    // "핫 요가"는 "요가"가 아니라 "핫요가"(등록한 "요가"에 묶이는 별개의 이름)로 읽는다
    const one = recommendKeywords(make('o', { ...base, reviewMenus: [rv('핫 요가', 110), rv('필라테스', 60), rv('빈야사', 40)] }, { 요가: 10, 핫요가: 6, 필라테스: 4, 빈야사: 3 }));
    assert.equal(excludedOf(one, '핫요가').rule, 'merged');
    assert.equal(terms(one).includes('필라테스'), true);
    const seoul = { address: '서울 마포구 마포대로 10' };
    for (const [raw, expected] of [['클래식 기타', '클래식기타'], ['수제 맥주', '수제맥주'], ['블로그 마케팅', '블로그마케팅'], ['핫 요가', '핫요가']]) {
        assert.equal(popularMenuTerm(raw, { name: '시험', ...seoul, reviewMenus: [rv(raw, 10)] }), expected, raw);
    }
    // 띄어쓰기와 관계없이 같은 낱말이 된다
    assert.equal(popularMenuTerm('블로그마케팅', { name: '시험', ...seoul, reviewMenus: [rv('블로그마케팅', 10)] }), popularMenuTerm('블로그 마케팅', { name: '시험', ...seoul, reviewMenus: [rv('블로그 마케팅', 10)] }));
    // 서로 다른 품목 둘 이상 앞에 되풀이되면 뗀다(시그니처 말차라떼·시그니처 크로플)
    const twice = { name: '시험카페', ...seoul, reviewMenus: [rv('시그니처 말차라떼', 50), rv('시그니처 크로플', 30)] };
    assert.equal(popularMenuTerm('시그니처 말차라떼', twice), '말차라떼');
    assert.equal(popularMenuTerm('시그니처 크로플', twice), '크로플');
    // 런치 B(한 글자 영문 구분 표시)는 뗀다, 이모지는 이름을 지우지 않는다
    assert.equal(popularMenuTerm('런치 B', { name: '시험', ...seoul, reviewMenus: [] }), '런치');
    assert.equal(popularMenuTerm('🍣 모둠초밥', { name: '시험', ...seoul, reviewMenus: [] }), '모둠초밥');
    assert.equal(terms(last('B19')).includes('불닭롤'), true);
    assert.equal(terms(first('B21')).some((word) => /^런치B$|^추천코스$/.test(word)), false);
});

test('K4 많이 말한 메뉴는 곁들임이 아니고, 매장 이름·갈래 사전에 없는 앞말에서 갈래를 만들지 않는다', () => {
    // 빵집: 크루아상(150회)·베이글·마들렌이 "빵 메뉴가 아닌"으로 빠지던 것
    const bakery = recommendKeywords(make('b', { name: '밀밭', category: '베이커리', keywords: ['공덕빵집'], menus: ['소금빵', '식빵', '크루아상', '베이글', '바게트', '마들렌', '휘낭시에'], reviewMenus: [rv('크루아상', 150), rv('소금빵', 90), rv('베이글', 60), rv('마들렌', 40)] }, { 빵집: 12, 크루아상: 9, 소금빵: 8, 베이글: 5, 마들렌: 3 }));
    for (const word of ['크루아상', '베이글', '마들렌']) assert.equal(terms(bakery).includes(word), true, word);
    assert.equal(bakery.excluded.some((entry) => entry.rule === 'offMain'), false);
    // 치킨집: 닭강정(90회)
    const chicken = recommendKeywords(make('ck', { name: '맛나치킨', category: '치킨', keywords: ['공덕치킨'], menus: ['후라이드 치킨', '양념 치킨', '닭강정', '닭발', '치즈볼', '감자튀김'], reviewMenus: [rv('후라이드', 100), rv('닭강정', 90), rv('닭발', 40), rv('치즈볼', 30)] }, { 치킨: 20, 닭강정: 8, 닭발: 3 }));
    assert.equal(terms(chicken).includes('닭강정'), true);
    // 삼겹살집: 이름 "황제삼겹살집"에서 갈래를 만들지 않아 목살·항정살이 빠지지 않는다. 문장에 상호가 섞이지 않는다
    const grill = recommendKeywords(make('gr', { name: '황제삼겹살집', category: '육류,고기요리', keywords: ['공덕삼겹살집'], menus: ['생삼겹살', '숙성삼겹살', '목살', '항정살', '가브리살', '된장찌개', '냉면'], reviewMenus: [rv('삼겹살', 150), rv('목살', 110), rv('항정살', 80), rv('가브리살', 40)] }, { 삼겹살: 20, 목살: 12, 항정살: 8, 가브리살: 3 }));
    for (const word of ['목살', '항정살']) assert.equal(terms(grill).includes(word), true, word);
    assert.equal(JSON.stringify(grill.excluded).includes('황제삼겹살'), false);
    // 반대 사례(견본 음식점): 횟집의 갈치·볼락구이는 그대로 걸리고, 이유 문장에 회 메뉴 34개 중 11개라는 근거가 남는다. "메뉴가 아니다"라고 단정하지 않는다
    const sample = recommendKeywords({ place: RESTAURANT.place, activity: RESTAURANT.activity, rivals: RESTAURANT.rivalPool, ranks: RESTAURANT.ranks, limit: 100 });
    for (const word of ['갈치', '볼락구이']) {
        assert.equal(excludedOf(sample, word).rule, 'offMain', word);
        assert.match(excludedOf(sample, word).reason, /회 메뉴가 중심\(읽어 온 메뉴 34개 중 11개\)이라, 회 메뉴로는 보이지 않/, word);
        assert.equal(excludedOf(sample, word).reason.includes('메뉴가 아닌'), false, word);
    }
});

test('K2 등록한 낱말도 조건·꾸밈 검사를 받는다: 지역 조합을 만들지 않고 살펴볼 점으로 알린다', () => {
    for (const result of [first('B23'), last('B23')]) {
        for (const word of ['주차가능', '예약필수', '단체환영', '24시']) {
            assert.equal(excludedOf(result, word).rule, 'attribute', word);
            assert.equal(registeredOf(result, word).concern.rule, 'attribute', word);
            assert.equal(registeredOf(result, word).suggest, null, word);
            assert.equal(result.items.some((item) => item.term === word), false, word);
        }
        // 가장 중요한 낱말이 조건어가 되지 않고, 쓸 만한 낱말이 추천에 남는다
        assert.equal(['주차가능', '예약필수', '단체환영', '24시'].includes(result.topTerm), false);
        assert.equal(result.items.some((item) => ['김치찌개', '제육볶음', '불고기'].includes(item.term)), true);
    }
    // 반대 사례: 업종 이름에 든 말은 목록에 있어도 자기 업종의 말이다(인테리어 업종의 "인테리어")
    assert.equal(registeredOf(first('A11'), '일산인테리어').concern, null);
    // 영업시간 표기(24시간)는 낱말이 아니다. 24시간 영업하는 동물병원의 "24시동물병원"은 영업시간이 근거라 추천된다(M6)
    assert.equal(excludedOf(first('A04'), '24시간').rule, 'attribute');
    const vet = first('A05').items.find((item) => item.term === '24시동물병원');
    assert.deepEqual(vet.reasons.map((reason) => reason.text), ['매장 이름', '23시 이후까지 영업']);
    assert.equal(excludedOf(first('A05'), '24시동물병원'), undefined);
});

test('M7 30위 밖 등록 키워드가 하나뿐이어도 추천 0개의 까닭이 "이미 충분"(enough)이 아니다', () => {
    const noRank = first('B33');
    assert.equal(noRank.emptyReason, 'enough'); // 순위를 아직 모르면 등록한 것이 같은 조합을 담았다고 말할 수 있다
    const ranked = last('B33');
    assert.equal(registeredOf(ranked, '은평미용실').concern.rule, 'lowRank');
    assert.equal(ranked.emptyReason, 'allWeak');
    // 낱말 둘이 모두 30위 밖이면(B34) 전과 같이 allWeak
    assert.equal(last('B34').emptyReason, 'allWeak');
});

test('시험 도구 확인: 순위 줄 도우미(rank)가 순위 표 모양을 만든다', () => {
    const row = rank('은평미용실', 55);
    assert.deepEqual([row.state, row.result.status, row.result.rank], ['done', 'found', 55]);
});
