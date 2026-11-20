import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRankKeywords, recommendKeywords } from '../lib/place-keywords.js';
import { CASES, mkPlace } from './place-keywords.stress.fixtures.mjs';
import { PHARMACY as FULL_PHARMACY, RESTAURANT as FULL_RESTAURANT, SALON as FULL_SALON } from './place-graph.fixtures.mjs';

// 추천 키워드 5차 채점(2026-11-18)의 "견본 밖 입력(흔들기 30종)"에서 나온 지적을 고친 것을 지킵니다.
// 입력은 전부 시험용으로 만든 가짜 매장이고 숫자도 지어낸 값입니다(실제 매장·네이버 자료 아님).
// 각 확인 앞의 F1~F14·S1·S2 는 채점 보고서(.playwright-mcp/qa/keywords/round5/REPORT.md)의 감점 번호입니다.
// A = 첫 분석(순위·상위 매장 자료 없음), B = 화면 최종 상태(순위 표 + 상위 매장 자료 있음).

const byId = new Map(CASES.map((item) => [item.id, item]));
const first = (id) => recommendKeywords({ place: byId.get(id).place, activity: byId.get(id).activity });
const last = (id) => recommendKeywords({ place: byId.get(id).place, activity: byId.get(id).activity, rivals: byId.get(id).rivals, ranks: byId.get(id).ranks });
const both = (id) => [['A', first(id)], ['B', last(id)]];
const terms = (result) => result.items.map((item) => item.term);
const excludedOf = (result, term) => result.excluded.find((entry) => entry.term === term);
const row = (keyword, rank) => ({ keyword, state: 'done', result: { keyword, status: rank === null ? 'beyond' : 'found', rank, scanned: 300, top: [], region: null } });

test('흔들기 30종: 어떤 입력에서도 예외 없이 돌고 추천 모양이 지켜진다', () => {
    assert.equal(CASES.length >= 30, true);
    for (const item of CASES) {
        for (const [mode, result] of both(item.id)) {
            const at = `${item.id}/${mode}`;
            assert.equal(Array.isArray(result.items) && Array.isArray(result.excluded) && Array.isArray(result.registered), true, at);
            assert.equal(result.items.length <= 12, true, at);
            // 추천 한 줄의 모양: 키워드 = 지역 + 낱말, 점수 = 근거 점수, 근거 칩에 0회·0건이 없다
            for (const entry of result.items) {
                assert.equal(entry.keyword.startsWith(entry.region) || entry.keyword.includes(entry.term), true, `${at} ${entry.keyword}`);
                assert.equal(entry.score, entry.evidence.points, `${at} ${entry.keyword}`);
                assert.equal(entry.reasons.some((reason) => /(^|[^\d])0(회|건)/.test(reason.text)), false, `${at} ${entry.keyword}`);
                assert.equal(/[^가-힣A-Za-z0-9]/.test(entry.keyword), false, `${at} ${entry.keyword}`);
            }
            // 자동 순위 조회는 추천에 있는 것과 등록한 키워드만 고른다
            const pick = pickRankKeywords(item.place, result, 5);
            assert.equal(pick.keywords.length <= 5, true, at);
        }
    }
});

test('F1·F9 같은 지역을 이름만 달리 읽지 않는다: 역 이름의 변형은 동·구 이름과 한 지역이고, 등록한 조합과 같은 조합은 새로 권하지 않는다', () => {
    // 시험용 치과: 주소 서초구 서초동, 가까운 역 서초역, 등록 키워드 서초치과·서초임플란트·서초역치과
    for (const [mode, result] of both('dental')) {
        assert.deepEqual(result.regions.filter((region) => region.term.startsWith('서초')).map((region) => region.term), ['서초역'], mode);
        // 임플란트는 "서초임플란트"가 이미 있으므로 "서초역임플란트"를 새로 권하지 않는다(전에는 순위 표가 있을 때 1위로 나왔다)
        assert.equal(result.items.some((item) => item.term === '임플란트' || item.term === '치과'), false, mode);
        assert.equal(result.items.some((item) => /^서초(역)?(치과|임플란트)$/.test(item.keyword)), false, mode);
    }
    // 등록 키워드가 없는 첫 분석: 서초역치과·서초치과 두 줄이 나오지 않는다(합정·신사·역삼은 원래 한 줄)
    const place = mkPlace({ id: 'dental2', name: '시험치과', category: '치과', address: '서울 서초구 서초대로 400', jibun: '서울 서초구 서초동 1', subway: { station: '서초역', exit: '2', walkMinutes: 4 }, keywords: [] });
    const result = recommendKeywords({ place });
    assert.deepEqual(result.items.filter((item) => item.term === '치과').map((item) => item.keyword), ['서초역치과']);
});

test('F2 상호명 앞말을 지역으로 읽지 않고, 주소를 못 읽은 경우는 결과에 표시한다', () => {
    // 시험용 식당 "해든식당"이 상호명을 대표키워드로 등록: "해든"·"삼성"·"강남"으로 읽히던 가짜 지역
    for (const [mode, result] of both('brand')) {
        assert.equal(result.regions.some((region) => region.term === '해든'), false, mode);
        assert.equal(result.items.some((item) => item.keyword.startsWith('해든')), false, mode);
        assert.equal(result.regionSource, 'address', mode);
    }
    // 주소가 비어 등록 키워드에서만 지역을 읽으면 regionSource 가 keywords, 하나도 못 읽으면 none(+ 추천 0개의 까닭 noRegion).
    // 7차: 앞말은 같은 앞말이 서로 다른 확인된 낱말(업종·품목) 앞에 되풀이될 때만 지역으로 읽는다. 한 번만 나온 "논현횟집"의 "논현"은 지역인지 확인할 수 없다.
    const once = recommendKeywords({ place: mkPlace({ id: 'kw1', name: '시험횟집', category: '횟집', address: '', keywords: ['논현횟집'], reviewMenus: [{ label: '광어', count: 20 }] }) });
    assert.deepEqual([once.regionSource, once.regions.map((region) => region.term), once.registered[0].regionStatus], ['none', [], 'unknown']);
    const twice = recommendKeywords({ place: mkPlace({ id: 'kw', name: '시험횟집', category: '횟집', address: '', keywords: ['논현횟집', '논현회식'], reviewMenus: [{ label: '광어', count: 20 }] }) });
    assert.deepEqual([twice.regionSource, twice.regions.map((region) => [region.term, region.confirmedBy])], ['keywords', [['논현', 'keywords']]]);
    for (const [mode, result] of both('noaddr')) {
        assert.deepEqual([result.regionSource, result.emptyReason, result.items.length], ['none', 'noRegion', 0], mode);
    }
});

test('F3·S2 업종 이름도 뜻이 넓은 말은 거르고, 업종 이름이라는 이유만으로 근거가 두터운 낱말을 앞서지 않는다', () => {
    // 시험용 삼겹살집의 업종 "육류,고기요리": 둘 다 뜻이 넓은 업종 이름(육류·고기요리)
    for (const [mode, result] of both('cond')) {
        for (const word of ['육류', '고기요리']) {
            assert.equal(terms(result).includes(word), false, `${mode} ${word}`);
            assert.equal(excludedOf(result, word).rule, 'vague', `${mode} ${word}`);
        }
        assert.equal(terms(result).includes('삼겹살'), false, mode); // 삼겹살은 이미 등록해 지역만 바꾼 조합을 권하지 않는 낱말
    }
    // 견본 미용실: 근거가 "업종"뿐인 남성전문미용실은 예약·리뷰가 받치는 시술 낱말보다 아래다(전에는 93점으로 2위였다)
    const salon = recommendKeywords({ place: FULL_SALON.place, activity: FULL_SALON.activity, rivals: FULL_SALON.rivalPool, ranks: FULL_SALON.ranks });
    const rankOf = (term) => salon.items.findIndex((item) => item.term === term);
    // (7차 S5: 업종 이름의 확장어는 등록한 "미용실"로 묶여 추천에서 빠진다. 남아 있더라도 시술 낱말보다 아래여야 한다)
    assert.equal(rankOf('남성전문미용실') === -1 || (rankOf('남성전문미용실') > rankOf('다운펌') && rankOf('남성전문미용실') > rankOf('쉐도우펌')), true);
});

test('F4 조건어·채널어(주차·예약·블로그·인스타·가격·분위기…)는 상위 매장·리뷰 메뉴 경로로도 추천되지 않는다', () => {
    const attribute = ['주차', '예약', '블로그', '인스타', '인스타그램', '가격', '분위기', '서비스', '친절', '웨이팅', '샤워실', '락커'];
    for (const id of ['cond', 'cond2', 'gym', 'cafe', 'engcafe']) {
        for (const [mode, result] of both(id)) {
            for (const entry of result.items) assert.equal(attribute.includes(entry.term), false, `${id}/${mode} ${entry.keyword}`);
        }
    }
    const rules = (result) => new Map(result.excluded.map((entry) => [entry.term, entry.rule]));
    assert.equal(rules(last('cond')).get('주차'), 'attribute');
    assert.equal(rules(last('cond')).get('예약'), 'attribute');
    for (const word of ['주차', '예약', '블로그', '인스타', '분위기', '가격']) assert.equal(rules(last('cond2')).get(word), 'attribute', word);
    assert.equal(excludedOf(last('cond2'), '주차').reason, "'주차'는 시설 조건·알리는 통로·인상·꾸밈을 말하는 낱말이라, 지역을 붙여도 찾을 가게 종류나 메뉴가 아닙니다.");
    // 업종 연관어 판정은 그대로: 꽃집의 "꽃배달"·포장마차의 "포장마차"처럼 업종이 그 말이면 쓴다
    assert.equal(terms(last('flower')).includes('꽃배달'), true);
});

test('F5·F6 꾸밈말과 수량·용량·가격 꼬리는 떼고, 떼고 남은 말만 낱말로 쓴다', () => {
    const garnish = ['시그니처', '아이스', '프리미엄', '수제', '신선한', '추천', '인기', '스페셜', '핫'];
    for (const id of ['cafe', 'pos', 'messy', 'price', 'cond2', 'engcafe', 'space']) {
        for (const [mode, result] of both(id)) {
            for (const entry of result.items) {
                if (entry.source === 'rankOnly') continue; // 순위 확인용 "맛집"
                assert.equal(garnish.includes(entry.term), false, `${id}/${mode} ${entry.keyword}`);
                assert.equal(/\d+(인분|인|개|원|g|종)|\d+$|[大中小]/.test(entry.term), false, `${id}/${mode} ${entry.keyword}`);
            }
        }
    }
    // "시그니처 말차라떼"는 말차라떼로, "한우 등심 200g"은 한우등심 쪽으로 읽는다(무게 꼬리를 뗌)
    assert.equal(terms(last('cafe')).includes('말차라떼'), true);
    assert.equal(terms(last('cafe')).includes('시그니처'), false);
    assert.equal(terms(last('pos')).includes('등심'), true);
    // 영문·숫자가 이름의 일부인 낱말(PT·GX·Latte)은 그대로 쓴다. 구분 표시("A세트")만 뺀다
    assert.equal(terms(last('engcafe')).includes('Latte'), true);
    assert.equal(terms(last('engcafe')).some((word) => /^[A-Za-z0-9]{1,2}세트$|^세트[A-Za-z0-9]{1,2}$/.test(word)), false);
});

test('F7 영업시간 사실만으로는 "점심"을 권하지 않고, F8 문을 닫는 시각과 안 맞는 "심야약국"은 블로그 1건으로 되살리지 않는다', () => {
    for (const id of ['two', 'broad', 'messy', 'brand']) {
        for (const [mode, result] of both(id)) {
            assert.equal(terms(result).includes('점심'), false, `${id}/${mode}`);
            const line = excludedOf(result, '점심');
            if (line) assert.equal(line.rule === 'thin' || line.rule === 'region', true, `${id}/${mode}`);
        }
    }
    assert.equal(excludedOf(first('broad'), '점심').reason, '근거가 점심 시간 영업(영업시간) 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다.');
    // 시험용 약국: 21시에 닫는데 블로그에 "심야약국"이 1건
    for (const [mode, result] of both('night')) {
        assert.equal(terms(result).some((word) => word.includes('심야')), false, mode);
        assert.deepEqual([excludedOf(result, '심야약국').rule, excludedOf(result, '심야약국').reason], ['condition', "밤 9시에 닫아 '심야약국'으로는 맞지 않습니다."], mode);
    }
    // 반대 사례: 23시 넘게 여는 약국은 그 시각이 근거라 영업시간만으로 권한다
    const late = recommendKeywords({ place: mkPlace({ id: 'late', name: '시험약국', category: '약국', address: '서울 강남구 테헤란로 1', jibun: '서울 강남구 역삼동 1', hours: { registered: true, status: '영업 중', days: [{ day: '매일', start: '09:00', end: '23:30', breaks: [], lastOrder: null }] } }) });
    assert.equal(terms(late).includes('심야약국'), true);
});

test('F10 메뉴 이름에 되풀이되는 다른 지명("전주 비빔밥")은 지역 키워드의 낱말로 쓰지 않는다', () => {
    for (const [mode, result] of both('jeonju')) {
        assert.equal(terms(result).includes('전주'), false, mode);
        assert.equal(excludedOf(result, '전주').rule, 'place', mode);
        assert.equal(terms(result).includes('비빔밥'), true, mode);
    }
});

test('F11 한 낱말의 순위 하나로 지역 전체를 막지 않고, 추천이 하나도 없으면 그 까닭을 코드로 남긴다', () => {
    // 시험용 분식집: 상계분식 55위·노원분식 80위뿐이어도 김밥·떡볶이 조합은 권한다
    const weak = last('weak');
    assert.equal(weak.items.length > 0, true);
    assert.equal(weak.emptyReason, null);
    assert.equal(terms(weak).some((word) => ['김밥', '떡볶이'].includes(word)), true);
    // 서로 다른 낱말 둘 이상이 모두 30위 밖이어야 그 지역을 나쁜 지역으로 본다 → 모든 지역이 나쁘면 추천 0개 + allWeak
    const snack = mkPlace({ id: 'weakall', name: '시험분식', category: '분식', address: '서울 노원구 상계로 1', jibun: '서울 노원구 상계동 1', keywords: ['상계분식', '상계김밥', '노원분식', '노원김밥'], menus: ['떡볶이', '김밥'], reviewMenus: [{ label: '떡볶이', count: 30 }] });
    const all = recommendKeywords({ place: snack, ranks: [row('상계분식', 55), row('상계김밥', 80), row('노원분식', 70), row('노원김밥', null)] });
    assert.deepEqual([all.items.length, all.emptyReason], [0, 'allWeak']);
    assert.equal(all.excluded.filter((entry) => entry.rule === 'rank').length, 2);
    const one = recommendKeywords({ place: snack, ranks: [row('상계분식', 55)] });
    assert.equal(one.items.some((item) => item.term === '떡볶이'), true);
    // 추천이 0개인 다른 까닭: 등록한 키워드가 이미 같은 조합을 담음(enough). 21시에 닫는 약국은 "심야약국"을 뺐고 "약국" 조합은 이미 등록돼 있다
    assert.deepEqual([first('night').items.length, first('night').emptyReason], [0, 'enough']);
    // 추천이 있으면 emptyReason 은 null
    for (const [mode, result] of both('dental')) assert.equal(result.emptyReason, null, mode);
});

test('F12 업종 이름과 그 부분 낱말은 같이 추천하지 않는다', () => {
    // 시험용 네일샵: 업종 "네일아트" · 리뷰 메뉴 "아트"·"케어"(뜻이 넓은 말)
    for (const [mode, result] of both('nail')) {
        assert.equal(terms(result).includes('아트'), false, mode);
        assert.equal(terms(result).includes('케어'), false, mode);
        assert.equal(excludedOf(result, '아트').rule, 'vague', mode);
        assert.equal(terms(result).includes('네일아트'), true, mode);
    }
    // 이름의 일부가 업종 이름이 아니면 별개의 낱말이다("소금김밥"과 "김밥", "와인바"와 "와인")
    const sushi = recommendKeywords({
        place: mkPlace({ id: 'wine', name: '시험와인바', category: '와인바', address: '서울 강남구 테헤란로 1', jibun: '서울 강남구 역삼동 1', menus: ['와인 플래터'], reviewMenus: [{ label: '와인', count: 40 }] }), limit: 100,
    });
    assert.equal(terms(sushi).includes('와인'), true);
});

test('F13 같은 사실을 칩 두 개로 적지 않는다: 띄어쓰기만 다른 같은 낱말은 합산하고, 리뷰 칩과 같은 뜻의 매장 정보 칩은 한 번만 적는다', () => {
    const space = last('space');
    const item = space.items.find((entry) => entry.term === '광어회');
    assert.deepEqual(item.reasons.filter((reason) => reason.kind === 'review').map((reason) => reason.text), ['리뷰 85회']);
    const nail = last('nail');
    const gel = nail.items.find((entry) => entry.term === '젤네일');
    assert.equal(gel.reasons.filter((reason) => reason.kind === 'review').length, 1);
    assert.equal(gel.reasons.some((reason) => /^리뷰에 '/.test(reason.text)), false);
});

test('F14 영문·숫자로 끝나는 낱말에도 조사를 맞춘다', () => {
    const gym = mkPlace({ id: 'latin', name: '시험짐', category: '헬스장', address: '서울 송파구 올림픽로 1', jibun: '서울 송파구 잠실동 1', keywords: ['송파PT', '송파오메가3'] });
    const result = recommendKeywords({ place: gym, activity: { mentions: { blogTotal: 10, terms: [{ term: 'PT', count: 0 }, { term: '오메가3', count: 0 }] } } });
    // PT(피티: 받침 없음) → 가, 3(삼: 받침 있음) → 이. 낱말은 사장님이 쓴 대소문자 그대로
    assert.match(excludedOf(result, 'PT').reason, /'PT'가 나온 글이 없고/);
    assert.match(excludedOf(result, '오메가3').reason, /'오메가3'이 나온 글이 없고/);
});

test('규칙 밖 입력: 횟수(count)가 없거나 null 이 섞여도 예외 없이 돌고, 횟수 없는 메뉴는 근거로 세지 않는다', () => {
    for (const [mode, result] of both('weird')) {
        assert.equal(result.items.every((item) => item.score > 0 || item.registrable === false), true, mode);
        assert.equal(terms(result).includes('크로플'), false, mode); // 횟수가 없는 리뷰 메뉴
    }
    // 리뷰 메뉴가 적게 말한 순으로 들어와도 많이 말한 것부터 읽고 나중에 자른다
    const names = ['가나', '다라', '마바', '사아', '자차', '카타', '파하', '거너', '더러', '머버', '서어', '저처'];
    const place = mkPlace({ id: 'order', name: '시험식당', category: '한식', address: '서울 강남구 테헤란로 1', jibun: '서울 강남구 역삼동 1', menus: names, reviewMenus: names.map((label, index) => ({ label, count: 10 + index * 10 })) });
    const read = recommendKeywords({ place, limit: 100 });
    assert.equal(terms(read).includes('저처'), true);
    assert.equal(terms(read).includes('가나'), false);
});

test('묶음 3 화면 추천과 처방전이 같은 근거 점수를 쓴다: items·registered 에 구조화한 근거가 붙고, 추천 순서가 그 점수 순이다', () => {
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        const result = recommendKeywords({ place: sample.place, activity: sample.activity, rivals: sample.rivalPool, ranks: sample.ranks });
        const registrable = result.items.filter((item) => item.registrable);
        for (const item of result.items) {
            assert.equal(item.score, item.evidence.points);
            assert.equal(item.evidence.parts.reduce((sum, part) => sum + part.points, 0), item.evidence.points);
            assert.deepEqual(item.evidence.parts.map((part) => part.points), [...item.evidence.parts.map((part) => part.points)].sort((a, b) => b - a));
            for (const part of item.evidence.parts) assert.equal(typeof part.kind === 'string' && typeof part.text === 'string' && part.points > 0, true);
        }
        assert.deepEqual(registrable.map((item) => item.score), [...registrable.map((item) => item.score)].sort((a, b) => b - a));
        // 순위 확인용(맛집)은 근거 점수가 없고 맨 뒤
        for (const item of result.items.filter((entry) => !entry.registrable)) assert.equal(item.score, 0);
        for (const entry of result.registered) {
            assert.equal(typeof entry.evidence.points, 'number');
            assert.equal(Array.isArray(entry.evidence.parts), true);
        }
    }
    // 등록 키워드에는 순위 표의 상태가 붙고, 30위 밖·먼 지역 결과는 살펴볼 점(lowRank)으로 알린다
    const restaurant = recommendKeywords({ place: FULL_RESTAURANT.place, activity: FULL_RESTAURANT.activity, rivals: FULL_RESTAURANT.rivalPool, ranks: FULL_RESTAURANT.ranks });
    const apgu = restaurant.registered.find((entry) => entry.keyword === '압구정횟집');
    assert.deepEqual([apgu.rank.state, apgu.rank.rank, apgu.concern.rule], ['weak', 41, 'lowRank']);
    assert.equal(apgu.concern.reason, '내 순위가 41위라 30위 안에 들지 못합니다.');
    const good = restaurant.registered.find((entry) => entry.keyword === '강남구청횟집');
    assert.deepEqual([good.rank.state, good.rank.rank, good.concern], ['good', 3, null]);
    assert.equal(restaurant.topTerm, '횟집');
    const far = last('far');
    assert.equal(far.registered.find((entry) => entry.keyword === '천호칼국수').concern.rule, 'lowRank');
});

test('견본 3종: 같은 낱말은 등록한 칸을 포함해 두 칸을 넘지 않는다(추천 쪽에도 같은 상한)', () => {
    for (const sample of [FULL_PHARMACY, FULL_RESTAURANT, FULL_SALON]) {
        for (const ranks of [[], sample.ranks]) {
            const result = recommendKeywords({ place: sample.place, activity: sample.activity, rivals: sample.rivalPool, ranks, limit: 100 });
            const count = new Map();
            for (const item of result.items) count.set(item.term, (count.get(item.term) || 0) + 1);
            for (const entry of result.registered) {
                // 30위 밖으로 확인돼 바꿀 칸인 등록 키워드는 세지 않는다
                if (entry.hasRegion && entry.core && !(entry.rank && entry.rank.state === 'weak')) count.set(entry.core, (count.get(entry.core) || 0) + 1);
            }
            for (const [term, number] of count) assert.equal(number <= 2, true, `${term} ${number}칸`);
        }
    }
});
