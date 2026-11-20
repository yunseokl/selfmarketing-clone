import test from 'node:test';
import assert from 'node:assert/strict';
import {
    recommendKeywords, pickRankKeywords, regionTerms, familyOf, mentionTerms, regionStatusOf, headlineMenuTerms, CANDIDATE_MAX,
} from '../lib/place-keywords.js';
import { buildPlaceGraph } from '../lib/place-graph.js';
import { buildActionItems } from '../lib/naver-place.js';
import * as geoWords from '../lib/place-geo.js';
import { CASES as CASES6, mkPlace, mkActivity, rv, rank, st, rival } from './place-keywords.round6.fixtures.mjs';
import { CASES as CASES7 } from './place-keywords.round7.fixtures.mjs';
import { PHARMACY, RESTAURANT, SALON, NOW, graphInput } from './place-graph.fixtures.mjs';

// 추천 키워드 7차(2026-11-21, 구조 변경 6-B): 6차 채점에서 남은 감점(K1·K3·M1·M5·M8·M9·S3·S4·S5)과 관찰을 "낱말 목록을 더하는" 방식이 아니라 구조로 고칩니다.
// 입력은 전부 시험용으로 만든 가짜 매장이고 숫자도 지어낸 값입니다(실제 매장·네이버 자료 아님). 번호는 6차 채점 보고서(.playwright-mcp/qa/keywords/round6/REPORT.md)의 감점 번호입니다.
//   원칙: ① 틀리는 방향을 정한다 — 쓸데없는 말을 '추천'하는 쪽이 아니라 좋은 말을 '후보'로만 보여 주는 쪽으로 틀린다 ② 확신 없는 판정은 단정하는 문장을 쓰지 않는다
//         ③ 새 낱말 목록보다 자료로 확인하는 방법을 먼저 ④ 수치·근거를 지어내지 않는다.

const ALL = [...CASES6, ...CASES7];
const byId = new Map(ALL.map((item) => [item.id, item]));
const first = (id) => recommendKeywords({ place: byId.get(id).place, activity: byId.get(id).activity });
const last = (id) => recommendKeywords({ place: byId.get(id).place, activity: byId.get(id).activity, rivals: byId.get(id).rivals, ranks: byId.get(id).ranks });
const terms = (result) => result.items.map((item) => item.term);
const candidateTerms = (result) => result.candidates.map((item) => item.term);
const excludedOf = (result, term) => result.excluded.find((entry) => entry.term === term && entry.rule !== 'region');
const registeredOf = (result, keyword) => result.registered.find((entry) => entry.keyword === keyword);
const hasItemData = (place) => (place.detail?.menus?.length || 0) + (place.detail?.styles?.length || 0) + (place.detail?.pos?.popularMenus?.length || 0) > 0;
const SHOP = { address: '서울 마포구 마포대로 10', jibun: '서울 마포구 공덕동 1', keywords: [] };
const make = (id, p, counts = {}, blogTotal = 40) => {
    const place = mkPlace({ id, ...SHOP, ...p });
    const asked = mentionTerms(place);
    const filled = { ...counts };
    for (const term of asked) if (filled[term] === undefined) filled[term] = 5;
    return { place, activity: mkActivity(place, { counts: filled, dflt: 0, blogTotal }) };
};

const CONFIRMED_BY = ['industry', 'registered', 'menu', 'booking', 'pos', 'rival'];

test('B1 입력 94종(6차 64 + 7차 30): 추천은 확인된 낱말(confirmedBy)뿐이고(unverified 는 항상 false), 후보는 최대 8개·점수 순', () => {
    assert.equal(ALL.length >= 80, true);
    for (const item of ALL) {
        for (const [mode, result] of [['A', first(item.id)], ['B', last(item.id)]]) {
            const at = `${item.id}/${mode}`;
            const noData = !hasItemData(item.place);
            for (const entry of result.items) {
                // 메뉴판·예약·결제 자료가 하나도 없는 매장도 같다: 추천은 확인된 낱말(업종·등록 낱말 등)뿐이다. unverified 는 화면·처방전이 읽는 이름이라 남겨 두며 항상 false
                assert.equal(entry.unverified, false, `${at} ${entry.keyword}`);
                assert.equal(CONFIRMED_BY.includes(entry.confirmedBy), true, `${at} ${entry.keyword}: confirmedBy ${entry.confirmedBy}`);
                // note 는 "두 번째 칸" 까닭 한 줄뿐이다
                for (const reason of entry.reasons.filter((other) => other.kind === 'note')) assert.match(reason.text, /^'.+' 두 번째 칸 — /, `${at} ${entry.keyword}`);
                assert.equal(entry.evidence.parts.reduce((sum, part) => sum + part.points, 0), entry.evidence.points, `${at} ${entry.keyword}`);
            }
            // 후보: 점수 순 최대 8개, 필드와 이유 문장 모양, 추천·뺀 낱말·순위 조회·topTerm 과 겹치지 않는다
            assert.equal(result.candidates.length <= CANDIDATE_MAX, true, at);
            assert.deepEqual(result.candidates.map((entry) => entry.score), [...result.candidates.map((entry) => entry.score)].sort((a, b) => b - a), at);
            const picked = pickRankKeywords(item.place, result);
            for (const candidate of result.candidates) {
                assert.deepEqual(Object.keys(candidate).sort(), ['evidence', 'keyword', 'lacks', 'reasons', 'region', 'score', 'source', 'term', 'why'], `${at} ${candidate.keyword}`);
                // lacks: menu(품목에서 확인 못 함) · data(메뉴판·예약·결제 자료가 아예 없음)
                assert.equal(candidate.lacks, noData ? 'data' : 'menu', at);
                assert.equal(candidate.score, candidate.evidence.points, at);
                if (noData) assert.match(candidate.why, /메뉴판·예약·결제 자료가 없어 이 매장이 하는 일인지 확인하지 못했습니다\. 사장님이 직접 판단해 쓰세요\.$/, at);
                else assert.match(candidate.why, /메뉴판·예약·결제 품목에서는 확인되지 않아 추천에 넣지 않았습니다\. 사장님이 직접 판단해 쓰세요\.$/, at);
                // 자료가 없는 말(검색량·검색 행태)을 근거로 들지 않는다
                assert.equal(/검색량|많이 검색|검색 횟수|인기 검색/.test(candidate.why), false, at);
                assert.equal(terms(result).includes(candidate.term), false, `${at} ${candidate.term}: 추천과 후보에 둘 다`);
                assert.equal(result.excluded.some((entry) => entry.term === candidate.term && !['region', 'rank'].includes(entry.rule)), false, `${at} ${candidate.term}: 뺀 낱말이 후보에도`);
                assert.equal(picked.keywords.includes(candidate.keyword), false, `${at} ${candidate.keyword}: 후보가 순위 조회 대상에`);
                assert.notEqual(result.topTerm, candidate.term, at);
            }
        }
    }
});

test('K1 "24시간·견적·상담·무인·시세·반반·콜키지·레슨·회원권·시설…"은 목록으로 막지 않고, 품목으로 확인되지 않으면 추천이 아니라 후보가 된다', () => {
    // [입력, 낱말들] — 메뉴판 등 품목 자료가 있는 매장도, 자료가 아예 없는 매장(A17 시세·A25 시설·C18 견적)도 리뷰에만 나온 말은 후보다
    const junk = [
        ['A04', ['무인']], ['A11', ['견적', '상담']], ['A12', ['견적']], ['A17', ['시세']], ['A21', ['반반']], ['A25', ['시설']], ['C09', ['상담']], ['C18', ['견적']],
    ];
    let checked = 0;
    for (const [id, words] of junk) {
        for (const [mode, result] of [['A', first(id)], ['B', last(id)]]) {
            for (const word of words) {
                const entry = result.items.find((item) => item.term === word);
                const candidate = result.candidates.find((item) => item.term === word);
                const reviewed = byId.get(id).place.reviewMenus.some((menu) => menu.label.replace(/\s+/g, '') === word);
                if (!reviewed) continue;
                checked += 1;
                assert.equal(entry, undefined, `${id}/${mode} ${word}: 품목으로 확인되지 않는데 추천`);
                assert.ok(candidate, `${id}/${mode} ${word}: 후보에도 없음(조용히 사라짐)`);
                assert.equal(candidate.lacks, hasItemData(byId.get(id).place) ? 'menu' : 'data', `${id}/${mode} ${word}`);
            }
        }
    }
    assert.equal(checked >= 14, true, String(checked));
    // 반대로 메뉴판에 품목으로 적혀 있으면(와인 콜키지·프로 레슨·월회원권·1:1 강습) 같은 낱말이어도 이 매장이 파는 것으로 확인된 말이다 — 낱말 이름이 아니라 자료로 판단한다
    for (const [id, word] of [['A20', '콜키지'], ['A24', '레슨'], ['A24', '회원권'], ['B36', '강습']]) assert.equal(first(id).items.find((item) => item.term === word)?.confirmedBy, 'menu', `${id} ${word}`);
    // 대표 사례: 세탁소의 "무인"은 후보, "운동화세탁"은 메뉴판 품목이라 그대로 추천(등록 낱말이라 지역만 바꾼 조합 줄로 남음)
    const laundry = first('A04');
    assert.equal(terms(laundry).includes('무인'), false);
    assert.equal(candidateTerms(laundry).includes('무인'), true);
    assert.equal(terms(laundry).includes('이불'), true); // 리뷰 '이불' ↔ 메뉴 '이불빨래'
    assert.equal(laundry.items.find((item) => item.term === '이불').confirmedBy, 'menu');
    assert.equal(candidateTerms(laundry).includes('드라이클리닝'), true); // 좋은 말이어도 메뉴판에 없으면 후보(사장님이 직접 판단)
    // 후보는 "사장님이 직접 판단해 쓰세요"라고만 말하고, 리뷰에 나온 횟수를 그대로 적는다
    assert.equal(laundry.candidates.find((item) => item.term === '무인').why, '리뷰에 15회 나왔지만 메뉴판·예약·결제 품목에서는 확인되지 않아 추천에 넣지 않았습니다. 사장님이 직접 판단해 쓰세요.');
    assert.equal(laundry.candidates.find((item) => item.term === '무인').keyword, '송도무인'); // 첫 지역 + 낱말
    // 상위 매장 둘이 등록해도(오마카세) 업종·품목 자료와 맞지 않으면 후보
    assert.equal(candidateTerms(last('C05')).includes('오마카세'), true);
    assert.equal(terms(last('C05')).includes('오마카세'), false);
});

test('B1 부작용 확인: 품목으로 확인되는 좋은 말은 추천에 그대로 남고 무엇으로 확인됐는지 알린다', () => {
    const expectBy = [
        ['A02', '크루아상', 'menu'], ['A22', '닭강정', 'menu'], ['A08', '빈야사', 'menu'], ['A23', '쌀국수', 'menu'], ['A05', '24시동물병원', 'industry'],
        ['C02', '교정', 'menu'], ['C02', '야간진료', 'industry'], ['C03', '패디', 'menu'], ['C03', '속눈썹', 'industry'], ['C04', '김밥', 'menu'], ['C04', '순대', 'menu'],
        ['C05', '사시미', 'menu'], ['C09', '내신', 'menu'], ['C10', '소금빵', 'menu'], ['C10', '감귤타르트', 'menu'], ['C12', '탕수육', 'menu'],
        ['C13', '커트', 'booking'], ['C13', '염색', 'booking'], ['C14', '꽃다발', 'industry'], ['C16', '추나', 'menu'], ['C16', '야간진료', 'industry'],
        ['C19', '프로필', 'menu'], ['C19', '증명사진', 'menu'], ['C20', '수육', 'menu'],
    ];
    for (const [id, word, by] of expectBy) {
        const found = first(id).items.find((item) => item.term === word);
        assert.ok(found, `${id} ${word}`);
        assert.equal(found.confirmedBy, by, `${id} ${word}`);
        assert.equal(found.unverified, false, `${id} ${word}`);
    }
    // 메뉴 이름 안에 든 낱말(메뉴 '광어 숙성회 정식' ↔ 리뷰 '광어')은 품목으로 확인된 것이다
    const fish = recommendKeywords(make('f', { name: '바다집', category: '횟집', menus: ['광어 숙성회 정식', '우럭회', '모둠회', '매운탕', '공기밥'], reviewMenus: [rv('광어', 40), rv('숙성회', 30)] }, { 횟집: 5, 광어: 4, 숙성회: 3 }));
    assert.deepEqual([fish.items.find((item) => item.term === '광어')?.confirmedBy, fish.items.find((item) => item.term === '숙성회')?.confirmedBy], ['menu', 'menu']);
    // 차림·안내를 말하는 낱말(반반)은 메뉴 이름("반반족발")에 들어 있어도 품목이 아니다
    assert.equal(terms(first('A21')).includes('반반'), false);
    assert.equal(candidateTerms(first('A21')).includes('반반'), true);
    // 업종 연관어는 업종으로 확인된 말이다(미용실의 남자머리·약국의 영양제)
    assert.equal(first('A09').items.find((item) => item.term === '야간진료').confirmedBy, 'industry');
});

test('B1 품목 자료가 없는 매장(C06 카센터): 리뷰 낱말은 추천이 아니라 후보(lacks data)이고, 추천은 업종·등록 낱말로 확인된 말뿐이다. 메뉴판이 생기면 확인된 말이 된다', () => {
    const noData = first('C06');
    // 추천: 업종·등록 낱말로 확인된 것만(리뷰의 엔진오일·견적·무상점검은 없음)
    // (이 업종은 대표어·연관어가 없고 등록 낱말은 이미 등록한 조합이라 추천이 비고, 그 까닭이 emptyReason 에 남는다)
    assert.deepEqual([noData.items, typeof noData.emptyReason], [[], 'string']);
    // 후보: 리뷰 말이 근거 점수 순 그대로, 이유 문장은 "자료가 없어 확인하지 못했다"
    assert.deepEqual(noData.candidates.map((item) => [item.term, item.lacks]), [['엔진오일', 'data'], ['견적', 'data'], ['무상점검', 'data']]);
    assert.equal(noData.candidates[0].why, '리뷰에 70회 나왔지만 메뉴판·예약·결제 자료가 없어 이 매장이 하는 일인지 확인하지 못했습니다. 사장님이 직접 판단해 쓰세요.');
    // 같은 매장에 메뉴판이 있으면(엔진오일 교환) 같은 낱말이 확인된 말이 되고, 메뉴판에 없는 "견적"은 후보(lacks menu)로 남는다
    const place = { ...byId.get('C06').place, detail: { ...byId.get('C06').place.detail, menus: [{ name: '엔진오일 교환', price: '50,000원', hasImage: null, recommended: false }] } };
    const withMenu = recommendKeywords({ place, activity: byId.get('C06').activity });
    assert.deepEqual([withMenu.items.find((item) => item.term === '엔진오일').confirmedBy, withMenu.candidates.find((item) => item.term === '견적').lacks], ['menu', 'menu']);
    // 순위 조회 대상은 등록 키워드가 먼저이고 후보는 들어가지 않는다
    const pick = pickRankKeywords(byId.get('C06').place, noData);
    assert.deepEqual(pick.keywords.slice(0, 2), ['부평카센터', '인천타이어']);
    assert.equal(pick.keywords.some((keyword) => /견적|엔진오일|무상점검/.test(keyword)), false);
});

test('견본 3종: 음식점·약국은 그대로, 미용실은 리뷰만 있는 낱말(가일컷)이 후보로 가고 업종 이름의 확장어(남성전문미용실)는 등록한 미용실로 묶인다', () => {
    const run = (sample, ranks = []) => recommendKeywords({ place: sample.place, activity: sample.activity, rivals: sample.rivalPool, ranks });
    assert.deepEqual(run(PHARMACY).items.map((item) => `${item.keyword}:${item.confirmedBy}`), [
        '청주대형약국:industry', '청주약국:industry', '오창약국:industry', '청주영양제:industry', '청주동물약국:industry',
    ]);
    assert.deepEqual(run(RESTAURANT).items.map((item) => `${item.keyword}:${item.confirmedBy}`), [
        '강남구청숙성회:menu', '강남구청광어:menu', '강남구청모임:industry', '강남구청대방어:menu', '강남구청룸식당:industry', '강남구청맛집:industry',
    ]);
    for (const sample of [PHARMACY, RESTAURANT]) assert.deepEqual(run(sample).candidates, []);
    const salon = run(SALON);
    assert.deepEqual(salon.items.map((item) => item.keyword), [
        '강남역댄디컷', '강남역다운펌', '강남역쉐도우펌', '강남역볼륨매직', '강남역아이롱펌', '강남역슬릭컷', '강남역필러스컷', '강남역남자머리', '강남역가르마펌', '강남역바버샵',
    ]);
    assert.deepEqual(salon.candidates.map((item) => [item.keyword, item.score, item.why]), [
        ['강남역가일컷', 20, '리뷰에 424회 나왔지만 메뉴판·예약·결제 품목에서는 확인되지 않아 추천에 넣지 않았습니다. 사장님이 직접 판단해 쓰세요.'],
    ]);
    assert.equal(excludedOf(salon, '남성전문미용실').rule, 'merged');
    assert.equal(excludedOf(salon, '가일컷'), undefined); // 후보는 뺀 낱말(excluded)에 넣지 않는다
    assert.deepEqual(run(SALON, SALON.ranks).items.map((item) => item.keyword), salon.items.map((item) => item.keyword));
});

test('K3 지역은 확인된 것만: 주소·역·순위 결과가 알려 준 지역, 등록·상위 매장 키워드에 되풀이되는 앞말뿐이다(regions[].confirmedBy)', () => {
    const confirmed = (result) => result.regions.map((region) => `${region.term}:${region.confirmedBy}`);
    // 주소·역·지점 이름
    assert.deepEqual(confirmed(first('C02')), ['정자:address', '성남:address', '분당:address']);
    assert.deepEqual(confirmed(first('A19')), ['서면역:station', '부전:address', '부산진:address']);
    assert.equal(regionTerms(byId.get('A23').place).find((region) => region.scope === 'branch').confirmedBy, 'address');
    // 같은 앞말이 등록 키워드에서 서로 다른 낱말(코인노래방·노래방) 앞에 되풀이 → 별칭(홍대)을 목록 없이 읽는다
    const karaoke = first('A26');
    assert.deepEqual(confirmed(karaoke).slice(0, 1), ['홍대:keywords']);
    assert.deepEqual(karaoke.registered.map((entry) => [entry.keyword, entry.regionStatus, entry.core]), [['홍대코인노래방', 'known', '코인노래방'], ['홍대노래방', 'known', '노래방']]);
    assert.equal(karaoke.items.some((item) => /마포홍대|서교홍대|홍대.*홍대/.test(item.keyword)), false); // 지역이 이미 붙은 낱말에 지역을 또 붙이지 않는다
    assert.equal(first('C01').regions[0].term, '홍대');
    assert.equal(first('C11').regions.find((region) => region.term === '광교').confirmedBy, 'keywords');
    // 한 번만 나온 앞말은 지역인지 확인할 수 없다(센텀네일·송리단길필라테스·북촌카페)
    for (const [id, keyword] of [['C03', '센텀네일'], ['C07', '송리단길필라테스'], ['B20', '북촌카페'], ['C19', '홍대증명사진']]) {
        const result = first(id);
        assert.equal(result.regions.some((region) => keyword.startsWith(region.term) && region.scope === 'custom'), false, keyword);
        assert.equal(registeredOf(result, keyword).regionStatus, 'unknown', keyword);
    }
    // 앞말이 상위 매장 키워드에서도 되풀이되면(내 키워드 하나 + 상위 매장) 지역이다. 그 지역은 rivals 로 확인
    const nail = byId.get('C03');
    const rivals = [rival(1, '시험A', ['센텀젤네일', '센텀패디']), rival(2, '시험B', ['센텀속눈썹'])];
    const withRivals = recommendKeywords({ place: nail.place, activity: nail.activity, rivals });
    assert.equal(withRivals.regions.find((region) => region.term === '센텀').confirmedBy, 'rivals');
    assert.equal(registeredOf(withRivals, '센텀네일').regionStatus, 'known');
    // 내 키워드가 없으면 서로 다른 상위 매장 둘 이상에서 되풀이될 때만 지역이다(한 매장이 쓴 두 키워드만으로는 아님)
    const noMine = { ...nail.place, keywords: ['해운대네일', '우동젤네일'] };
    const hasCenteom = (rivalList) => recommendKeywords({ place: noMine, activity: nail.activity, rivals: rivalList }).regions.find((region) => region.term === '센텀');
    assert.equal(hasCenteom([rival(1, '시험A', ['센텀젤네일', '센텀패디'])]), undefined);
    assert.equal(hasCenteom([rival(1, '시험A', ['센텀젤네일']), rival(2, '시험B', ['센텀패디'])]).confirmedBy, 'rivals');
    // 순위 결과가 알려 준 지역
    const viaRank = recommendKeywords({ place: nail.place, activity: nail.activity, ranks: [{ keyword: '센텀네일', state: 'done', result: { keyword: '센텀네일', status: 'found', rank: 5, scanned: 100, top: [], region: '센텀' } }] });
    assert.equal(viaRank.regions.find((region) => region.term === '센텀').confirmedBy, 'rank');
    assert.equal(registeredOf(viaRank, '센텀네일').regionStatus, 'known');
    // 지역 낱말에 업종 이름의 앞부분("남성전문미용실"의 "남성전문")이나 메뉴 낱말이 든 앞말은 되풀이돼도 지역이 아니다
    const salon = recommendKeywords({ place: mkPlace({ id: 'q', name: '시험헤어', category: '남성전문미용실', address: '서울 강남구 테헤란로 1', jibun: '서울 강남구 역삼동 1', keywords: ['남성전문미용실', '남성전문헤어샵'] }) });
    assert.equal(salon.regions.some((region) => region.scope === 'custom'), false);
});

test('K3 6차 입력: 가짜 지역(을지로평양·강남한우·홍대숙성)을 만들지 않고, 지역인데 "지역 없음"이라 하지 않는다(regionStatus unknown)', () => {
    for (const result of [first('B13'), last('B13')]) {
        assert.equal(result.regions.some((region) => region.term.startsWith('을지로평양')), false);
        assert.deepEqual(registeredOf(result, '을지로평양냉면').regionStatus, 'known');
        assert.equal(registeredOf(result, '을지로평양냉면').core, '평양냉면');
        assert.equal(result.items.some((item) => /^을지로평양/.test(item.keyword)), false);
    }
    // 주소에 없는 앞말이 한 번만 붙은 등록 키워드: 가짜 지역을 만들지 않고, 새 조합(바꿔 쓸 조합·추천)을 만들지 않으며, 지역명이 없다고도 하지 않는다
    const fake = (name, category, keyword, menus, reviewMenus) => recommendKeywords(make('x', { name, category, address: '서울 마포구 양화로 100', jibun: '서울 마포구 서교동 1', keywords: [keyword], menus, reviewMenus }));
    for (const [result, keyword] of [
        [fake('국밥집', '국밥', '강남한우국밥', ['돼지국밥', '순대국밥', '수육', '내장국밥', '공기밥'], [rv('수육', 50)]), '강남한우국밥'],
        [fake('삼겹살집', '삼겹살', '홍대숙성삼겹살', ['생삼겹살', '목살', '항정살', '된장찌개', '냉면'], [rv('목살', 50)]), '홍대숙성삼겹살'],
    ]) {
        const entry = registeredOf(result, keyword);
        assert.deepEqual([entry.hasRegion, entry.regionStatus, entry.suggest, entry.concern], [false, 'unknown', null, null], keyword);
        assert.equal(result.regions.some((region) => region.scope === 'custom'), false, keyword);
        assert.equal(result.items.some((item) => item.keyword.startsWith('강남한우') || item.keyword.startsWith('홍대숙성')), false, keyword);
        assert.equal(result.hasRegionKeyword, true, keyword); // 모두 지역명이 없다고 말할 수 없다
    }
    // 광교카센터(주소 이의동)·대전증명사진(주소 대전)·중동철물(부천 중동)·홍대코인노래방
    const car = first('A12');
    assert.deepEqual([registeredOf(car, '광교카센터').hasRegion, registeredOf(car, '광교카센터').regionStatus, registeredOf(car, '광교카센터').concern, registeredOf(car, '광교카센터').suggest], [false, 'unknown', null, null]);
    assert.equal(car.items.some((item) => item.keyword.includes('광교카센터')), false);
    assert.deepEqual([registeredOf(first('A16'), '대전증명사진').regionStatus, registeredOf(first('A16'), '대전증명사진').region], ['known', '대전']); // 시·도 이름은 주소에서 읽은 지역
    assert.deepEqual([registeredOf(first('A18'), '중동철물').regionStatus, registeredOf(first('A18'), '중동철물').core], ['known', '철물']);
    assert.deepEqual([registeredOf(first('A15'), '제주게스트하우스').regionStatus, registeredOf(first('A15'), '제주게스트하우스').region], ['known', '제주']);
    // 지역을 확인 못 한 키워드도 순위를 조회한다(지역이 없다고 확실한 것만 순위 조회에서 뺀다)
    const pick = pickRankKeywords(byId.get('A12').place, car);
    assert.equal(pick.keywords.includes('광교카센터'), true);
    assert.equal(pick.skipped.includes('광교카센터'), false);
    // 키워드 전체가 업종·품목 낱말이면(댄디컷·일반의약품) 지역이 없다고 확실하다: 바꿔 쓸 조합을 그대로 만든다
    const salon = recommendKeywords({ place: SALON.place, activity: SALON.activity });
    assert.deepEqual(['댄디컷', '다운펌'].map((keyword) => [registeredOf(salon, keyword).regionStatus, registeredOf(salon, keyword).suggest]), [['none', '강남역댄디컷'], ['none', '강남역다운펌']]);
    const pharmacy = recommendKeywords({ place: PHARMACY.place, activity: PHARMACY.activity });
    assert.deepEqual(registeredOf(pharmacy, '일반의약품').regionStatus, 'none');
    assert.deepEqual(pickRankKeywords(PHARMACY.place, pharmacy).skipped, ['일반의약품', '건강기능식품', '동물의약품', '상비약']);
    // 조건 낱말("주차가능"·"24시")도 지역이 없다고 확실하다
    assert.equal(registeredOf(first('B23'), '주차가능').regionStatus, 'none');
    // regionStatusOf: 옛 모양(regionStatus 없음)은 hasRegion 으로 읽는다
    assert.deepEqual([{ hasRegion: true }, { hasRegion: false }, { regionStatus: 'unknown', hasRegion: false }].map(regionStatusOf), ['known', 'none', 'unknown']);
});

test('M8 상호(매장 이름)와 같거나 이름을 품은 낱말에는 지역 조합을 만들지 않고, 이유(brand)를 한 줄로 알린다', () => {
    for (const result of [first('B15'), last('B15')]) {
        assert.deepEqual(excludedOf(result, '강남면옥'), {
            term: '강남면옥', keywords: [], rule: 'brand',
            reason: "'강남면옥'은 매장 이름과 같아 지역을 붙인 키워드로 권하지 않습니다. 대표키워드에서 상호는 지워질 수 있습니다.",
        });
        assert.equal(registeredOf(result, '강남면옥').concern.rule, 'brand');
        assert.equal(registeredOf(result, '강남면옥').suggest, null);
        assert.equal(result.items.some((item) => item.keyword.includes('강남면옥')), false);
    }
    // 이름을 품은 낱말, 지역+상호("삼성해든식당")
    const brand = recommendKeywords(make('br', { name: '해든식당', category: '한식', address: '서울 강남구 봉은사로 100', jibun: '서울 강남구 삼성동 100', keywords: ['해든식당불고기', '삼성해든식당'], menus: ['불고기', '비빔밥', '제육볶음', '김치찌개', '된장찌개'], reviewMenus: [rv('불고기', 100)] }, { 불고기: 10, 해든식당: 25 }));
    assert.equal(excludedOf(brand, '해든식당불고기').rule, 'brand');
    assert.equal(excludedOf(brand, '해든식당불고기').reason, "'해든식당불고기'에는 매장 이름이 들어 있어 지역을 붙인 키워드로 권하지 않습니다. 대표키워드에서 상호는 지워질 수 있습니다.");
    assert.equal(excludedOf(brand, '해든식당').rule, 'brand'); // "삼성해든식당"에서 지역(삼성)을 뗀 낱말이 상호
    assert.equal(brand.items.some((item) => /해든식당/.test(item.keyword)), false);
    // 이름의 한 조각이 업종·품목 낱말이면 상호가 아니다(버거킹의 "버거", 1988포차의 "포차", 골프연습장 "파3"의 "골프")
    assert.equal(registeredOf(first('B16'), '역삼버거').concern, null);
    assert.equal(excludedOf(first('B17'), '포차'), undefined);
    assert.equal(registeredOf(first('A24'), '용인골프').concern, null);
    assert.equal(registeredOf(first('B17'), '1988포차').concern.rule, 'brand');
});

test('M9·M1 한 낱말 이름의 "점"(대성철물점)은 지점이 아니고, 성수동2가의 "동"·한 글자 동(중동·연동)은 바로 읽는다', () => {
    for (const result of [first('A18'), last('A18')]) {
        assert.equal(result.regions.some((region) => region.scope === 'branch'), false);
        assert.equal(result.items.some((item) => item.keyword.includes('대성철물')), false);
    }
    assert.equal(regionTerms({ name: '맛나 분당점', address: '경기 성남시 분당구 판교역로 1' }).some((region) => region.scope === 'branch'), false); // 이미 아는 지역
    assert.equal(regionTerms({ name: '솥내음 가로수길점', address: '경기 성남시 분당구 판교역로 1' }).some((region) => region.scope === 'branch'), true); // 띄어 쓴 지점 이름은 그대로
    for (const result of [first('A28'), last('A28')]) {
        assert.equal(registeredOf(result, '성수동대관').core, '대관');
        assert.equal(result.regions.find((region) => region.term === '성수').variants.includes('성수동'), true);
    }
    assert.deepEqual(regionTerms({ address: '경기 부천시 길주로 100', jibunAddress: '경기 부천시 중동 1100', keywords: [] }).map((region) => [region.term, region.scope, region.variants]), [['부천', 'city', ['부천', '부천시']], ['중동', 'town', ['중동']]]);
    assert.deepEqual(regionTerms({ address: '제주특별자치도 제주시 연동 100', jibunAddress: '제주특별자치도 제주시 연동 200', keywords: [] }).map((region) => region.term), ['제주', '연동']);
    // "주엽동물병원"은 주엽동 + 물병원이 아니라 주엽 + 동물병원이다(남는 말이 확인된 낱말인 쪽으로 뗌)
    assert.deepEqual([registeredOf(first('C08'), '주엽동물병원').core, registeredOf(first('C08'), '주엽동물병원').regionStatus], ['동물병원', 'known']);
    // 구 이름 뒤의 "역"(강남역피부과의 "역")도 같은 지역 표기다
    assert.deepEqual([registeredOf(first('A09'), '강남역피부과').core, registeredOf(first('A09'), '강남역피부과').regionStatus], ['피부과', 'known']);
});

test('M5·S3 업종 연관어·업종 대표어는 그 업종으로 확인될 때만(PT는 헬스·필라테스, "카페"는 카페·커피 업종)', () => {
    for (const id of ['A24', 'B36']) for (const result of [first(id), last(id)]) assert.equal(terms(result).includes('PT'), false, id);
    assert.equal(terms(first('C07')).includes('PT'), true); // 필라테스는 PT 가 맞는 업종
    for (const id of ['A14', 'A02']) for (const result of [first(id), last(id)]) assert.equal(terms(result).includes('카페'), false, id); // 키즈카페·베이커리
    assert.equal(recommendKeywords({ place: mkPlace({ id: 'c', ...SHOP, name: '시험', category: '카페,디저트', keywords: [] }) }).items.some((item) => item.term === '카페'), true);
    assert.equal(recommendKeywords({ place: mkPlace({ id: 'c', ...SHOP, name: '시험', category: '커피전문점', keywords: [] }) }).items.some((item) => item.term === '카페'), true);
    assert.deepEqual([familyOf({ category: '골프연습장' }).related.length, familyOf({ category: '헬스장' }).related.map((item) => item.term)], [0, ['PT', '헬스장']]);
});

test('S4·S5 같은 낱말 칸은 실제 칸 수로 세고, 등록 낱말의 확장어는 같이 추천하지 않는다', () => {
    // 등록 "제주흑돼지"·"제주시흑돼지"는 같은 지역 이름이어도 두 칸이라 같은 낱말의 조합을 더 권하지 않는다
    for (const result of [first('B12'), last('B12')]) assert.equal(result.items.some((item) => item.term === '흑돼지'), false);
    // 업종 이름의 확장어는 등록 낱말로 묶인다(인테리어디자인→인테리어, 촬영스튜디오→스튜디오, 포장마차→포차(줄임말))
    for (const [id, word, into] of [['A11', '인테리어디자인', '인테리어'], ['A28', '촬영스튜디오', '스튜디오'], ['B17', '포장마차', '포차']]) {
        for (const result of [first(id), last(id)]) {
            assert.deepEqual([excludedOf(result, word)?.rule, excludedOf(result, word)?.into], ['merged', into], `${id} ${word}`);
            assert.equal(result.items.some((item) => item.term === word), false, `${id} ${word}`);
        }
    }
    assert.match(excludedOf(first('B17'), '포장마차').reason, /줄임말 관계로 보이는 말이라, 등록 키워드인 '포차' 하나로 묶었습니다\.$/);
    // 업종 연관어(대형약국)는 따로 찾는 말이라 등록한 "약국"으로 묶지 않는다
    assert.equal(recommendKeywords({ place: { ...PHARMACY.place, keywords: ['청주약국'] }, activity: PHARMACY.activity }).items.some((item) => item.term === '대형약국'), true);
});

test('관찰 1·2·4·5·7: 구별되는 메뉴의 흡수는 이유와 함께 남기고, 같은 지역·낱말 두 칸은 살펴볼 점, 이름으로 업종을 정하지 않고, 한 글자 낱말은 이유와 함께 알리고, 후보·미확인은 순위 조회 대상이 아니다', () => {
    // 1) 등록 "국수"가 있으면 구별되는 메뉴(콩국수)도 그 낱말로 묶이지만 사라지지 않고 "하나로 묶었다"는 이유가 남는다(근거: 같은 낱말에 가까운 두 검색어로 칸을 둘 쓰는 것보다 한 칸에 모으는 쪽이 낫다는 판단)
    const noodle = recommendKeywords(make('n', { name: '시원국수', category: '국수', keywords: ['공덕국수'], menus: ['콩국수', '잔치국수', '비빔국수', '열무국수', '냉국수'], reviewMenus: [rv('콩국수', 90), rv('잔치국수', 40)] }, { 국수: 10, 콩국수: 8, 잔치국수: 4 }));
    assert.deepEqual([excludedOf(noodle, '콩국수').rule, excludedOf(noodle, '콩국수').into], ['merged', '국수']);
    assert.match(excludedOf(noodle, '콩국수').reason, /하나로 묶었습니다\.$/);
    // 2) 같은 지역·같은 낱말을 표기만 달리해 두 칸 등록(제주흑돼지/제주시흑돼지, 일산인테리어/일산동구인테리어, 정자치과/정자동치과)
    assert.equal(registeredOf(first('B12'), '제주흑돼지').concern, null);
    assert.deepEqual(registeredOf(first('B12'), '제주시흑돼지').concern, { rule: 'duplicate', reason: "'제주시흑돼지'는 '제주흑돼지'와 지역·낱말이 같아 대표키워드 칸을 둘 쓰고 있습니다. 한 칸은 다른 낱말이나 지역에 쓸 수 있는지 살펴보세요." });
    for (const [id, keyword] of [['A11', '일산동구인테리어'], ['B27', '정자동치과'], ['B22', '성북동국수']]) assert.equal(registeredOf(first(id), keyword).concern.rule, 'duplicate', keyword);
    // 4) 매장 이름으로 업종을 정하지 않는다("불꽃"이 꽃집이 되지 않음). 업종 이름이 비어 있을 때만 이름을 본다
    assert.equal(familyOf({ name: '불꽃', category: '삼겹살' }), null);
    assert.equal(familyOf({ name: '불꽃', category: '' })?.key, 'flower');
    assert.equal(recommendKeywords({ place: mkPlace({ id: 'k', ...SHOP, name: '불꽃', category: '삼겹살', keywords: ['홍대숙성삼겹살'], menus: ['삼겹살', '목살'] }) }).items.some((item) => /꽃집/.test(item.keyword)), false);
    // 5) 한 글자 낱말(회·탕·펌)은 조용히 사라지지 않고 이유와 함께 뺀 낱말에 나온다
    const shortOne = recommendKeywords(make('s', { name: '바다횟집', category: '횟집', keywords: ['공덕횟집'], menus: ['광어회', '우럭회', '모둠회', '매운탕', '공기밥'], reviewMenus: [rv('광어', 60), rv('회', 50), rv('탕', 30)] }, { 횟집: 8, 광어: 5 }));
    assert.deepEqual(shortOne.excluded.filter((entry) => entry.rule === 'short').map((entry) => [entry.term, entry.keywords]), [['회', []], ['탕', []]]);
    assert.equal(excludedOf(shortOne, '회').reason, "리뷰에 '회'가 나오지만, 한 글자 낱말이라 이 말만으로는 어떤 메뉴를 찾는지 가려지지 않아 지역을 붙인 키워드로는 권하지 않습니다.");
    assert.equal(excludedOf(first('C13'), '펌').reason.startsWith("예약 스타일에 '펌'이 나오지만"), true);
    // 7) 후보는 순위 조회 대상에 들어가지 않는다
    const verified = pickRankKeywords(byId.get('C04').place, first('C04'));
    assert.equal(verified.keywords.every((keyword) => !keyword.endsWith('컵밥')), true);
});

test('작은 것 10·11·12: 한 줄 소개의 대표 메뉴는 뺀 낱말을 쓰지 않고, 약국 예약 점은 해당 없음, 병의원 문장에 소식이 없다', () => {
    // 10. 가게를 한마디로 설명하는 자리에 써도 되는 대표 메뉴(headlineMenuTerms): 키워드 엔진이 뺀 낱말(김밥·갈치·볼락구이)은 빠지고, 많이 언급된 순이다.
    //     견본 음식점: 광어·숙성회(전에는 한 줄 소개 예시가 "강남구청역 김밥·광어 횟집"). place-geo 가 이 함수를 불러 쓰는 것은 화면 담당 몫이다.
    assert.deepEqual(headlineMenuTerms(RESTAURANT.place, RESTAURANT.activity), ['광어', '숙성회']);
    assert.deepEqual(headlineMenuTerms(RESTAURANT.place, RESTAURANT.activity, { limit: 1 }), ['광어']);
    assert.equal(headlineMenuTerms(RESTAURANT.place, RESTAURANT.activity, { limit: 8 }).some((word) => /김밥|갈치|볼락구이|보쌈|한식|포장/.test(word)), false);
    assert.deepEqual(headlineMenuTerms(SALON.place, SALON.activity), ['댄디컷', '쉐도우펌']); // 리뷰 언급 2,452·1,390회 순
    assert.deepEqual([headlineMenuTerms(null), headlineMenuTerms(PHARMACY.place, PHARMACY.activity), headlineMenuTerms(RESTAURANT.place, null, { limit: 0 })], [[], [], []]);
    // 11. 약국의 네이버 예약 점: 경고 색 없이 '해당 없음'(쿠폰·소식 점과 같은 방식). 이미 예약을 쓰는 약국과 음식점·미용실은 그대로
    const booking = (place) => buildPlaceGraph({ ...graphInput({ ...PHARMACY, place }), audit: [] }).nodes.find((node) => node.id === 'ops:booking');
    const none = booking({ ...PHARMACY.place, detail: { ...PHARMACY.place.detail, hasBooking: false } });
    // (place-geo.js 가 이름표 notApplicableTag 를 주면 약국 예약은 '확인 안 됨(점수에서 뺌)', 없으면 '해당 없음')
    assert.deepEqual([none.sub, none.tone, none.subTone], [geoWords.notApplicableTag?.('booking') || '해당 없음', undefined, undefined]);
    assert.match(none.detail, /약국이 네이버 예약을 쓸 수 있는지 확인되지 않아/);
    const used = booking({ ...PHARMACY.place, detail: { ...PHARMACY.place.detail, hasBooking: true } });
    assert.deepEqual([used.sub, used.tone], ['연결됨', 'good']);
    const restaurant = buildPlaceGraph({ ...graphInput(RESTAURANT), audit: [] }).nodes.find((node) => node.id === 'ops:booking');
    assert.deepEqual([restaurant.sub, restaurant.tone], ['없음', 'warn']);
    // 12. 병의원의 지금 할 일 키워드 문장에서 소식을 뺀다(병의원은 새소식 기능이 없음). 음식점은 그대로
    const action = (place) => buildActionItems(place, null, { recommendation: recommendKeywords({ place }), nowMs: NOW }).find((item) => item.key === 'keywordRegion');
    const clinic = mkPlace({ id: 'cl', ...SHOP, name: '시험치과', category: '치과', keywords: ['임플란트', '교정'], menus: ['임플란트', '교정', '스케일링'], reviewMenus: [rv('임플란트', 50)] });
    assert.match(action(clinic).detail, /소개글·대표키워드에 반영하세요\.$/);
    assert.equal(action(clinic).detail.includes('소식'), false);
    const shop = mkPlace({ id: 'sh', ...SHOP, name: '시험횟집', category: '횟집', keywords: ['광어회', '모둠회'], menus: ['광어회', '모둠회', '우럭회'], reviewMenus: [rv('광어', 50)] });
    assert.match(action(shop).detail, /소개글·소식·대표키워드에 반영하세요\.$/);
});

test('새 입력 20종: 업종·지역·등록 키워드 모양을 바꿔도 쓸데없는 말은 추천에 오르지 않고 좋은 말은 후보로 밀리지 않는다', () => {
    // 쓸데없는 말: 메뉴판·예약 자료가 있는 매장에서 추천에 오르면 안 된다(품목이 아니므로 후보이거나 목록에 걸려 뺀 낱말)
    const junk = {
        C01: ['웨이팅', '주차', '양념'], C04: ['컵밥'], C09: ['상담', '레벨테스트'], C10: ['오션뷰', '주차'], C11: ['웨이팅', '갈비'], C13: ['레이어드컷', '탈색', '두피케어'],
        C14: ['당일배송', '근조화환', '배달'], C16: ['교통사고'], C19: ['보정', '예약'], C20: ['깍두기', '웨이팅'], C05: ['오마카세', '콜키지'], C02: ['충치치료'],
    };
    for (const [id, words] of Object.entries(junk)) {
        for (const result of [first(id), last(id)]) {
            for (const word of words) assert.equal(terms(result).includes(word), false, `${id} ${word}`);
        }
    }
    // 후보로 밀린 말은 조용히 사라지지 않는다: 추천·후보·뺀 낱말 어디엔가 이유와 함께 남는다
    for (const [id, words] of [['C02', ['충치치료']], ['C13', ['레이어드컷', '탈색', '두피케어']], ['C14', ['근조화환', '당일배송']], ['C16', ['교통사고']], ['C09', ['상담', '레벨테스트']]]) {
        const result = first(id);
        for (const word of words) assert.equal(candidateTerms(result).includes(word) || Boolean(excludedOf(result, word)), true, `${id} ${word}`);
    }
    // 어떤 입력에서도 예외가 없고, 지역이 붙지 않은 키워드·지역만 두 번 붙은 키워드가 추천에 없다
    for (const item of CASES7) {
        for (const result of [first(item.id), last(item.id)]) {
            assert.equal(result.items.every((entry) => !/(.+)\1/.test(entry.keyword) || entry.keyword.length < 4), true, `${item.id}`);
            for (const entry of result.items) assert.equal(entry.keyword.length >= 3 || entry.registrable === false, true, `${item.id} ${entry.keyword}`);
        }
    }
});

test('두 번째 흔들기(D01~D10): 시·도 이름은 남는 말이 확인된 낱말일 때만 지역이고, 상호·지점·중복·이상한 상위 매장 자료도 예외 없이 읽는다', () => {
    // "서울숲카페"의 "서울"은 시·도 이름이 아니라 서울숲의 앞부분이다(남는 "숲카페"가 확인된 낱말이 아님). "서울약국"은 시·도 + 업종이라 지역이다
    const forest = first('D03');
    assert.deepEqual([registeredOf(forest, '서울숲카페').regionStatus, registeredOf(forest, '서울숲카페').concern, registeredOf(forest, '서울숲카페').suggest], ['unknown', null, null]);
    assert.equal(forest.regions.some((region) => region.scope === 'sido'), false);
    assert.equal(forest.items.some((item) => /^서울/.test(item.keyword)), false);
    assert.deepEqual([registeredOf(first('D04'), '서울약국').regionStatus, registeredOf(first('D04'), '서울약국').core, first('D04').regions[0].confirmedBy], ['known', '약국', 'address']);
    // 영문 메뉴 이름(Americano)은 낱말이 아니고 한글 메뉴만 확인된다
    assert.equal(first('D03').items.some((item) => /americano/i.test(item.term)), false);
    // 이름이 "행복한 미용실"이고 "행복한미용실"을 등록: 상호, 띄어쓰기와 관계없이 같은 이름
    assert.equal(excludedOf(first('D09'), '행복한미용실').rule, 'brand');
    // "강남 본점"은 지점 이름이 아니다
    assert.equal(first('D10').regions.some((region) => region.scope === 'branch'), false);
    // 표기만 다른 중복 두 쌍(송파·송파구, 가락·가락동)은 뒤의 것에 살펴볼 점
    assert.deepEqual(first('D06').registered.filter((entry) => entry.concern?.rule === 'duplicate').map((entry) => entry.keyword), ['송파구치과', '가락동치과']);
    // 상위 매장 자료가 비어 있거나 null·빈 문자열이 섞여도 예외 없이 읽는다
    assert.doesNotThrow(() => last('D07'));
    // 업종 이름이 비어 있으면 매장 이름에서 업종을 읽는다(약국)
    assert.equal(familyOf(byId.get('D01').place).key, 'pharmacy');
});

test('같은 낱말이 두 번째 칸에 오르면 까닭을 한 줄로 적는다(사실일 때만, 근거 점수에는 넣지 않음)', () => {
    const run = (sample, ranks = []) => recommendKeywords({ place: sample.place, activity: sample.activity, rivals: sample.rivalPool, ranks });
    const notes = (result, keyword) => result.items.find((item) => item.keyword === keyword).reasons.filter((reason) => reason.kind === 'note').map((reason) => reason.text);
    // 약국: 내 순위가 있으면 두 지역 모두 10위 안이라서, 첫 분석에서는 순위를 조회해 볼 후보라서
    assert.deepEqual(notes(run(PHARMACY, PHARMACY.ranks), '오창약국'), ["'약국' 두 번째 칸 — 청주·오창 두 지역 모두 내 키워드가 10위 안"]);
    assert.deepEqual(notes(run(PHARMACY), '오창약국'), ["'약국' 두 번째 칸 — 순위를 조회해 보는 후보(조회가 끝나면 내 순위가 좋은 지역만 남김)"]);
    assert.deepEqual(notes(run(PHARMACY, PHARMACY.ranks), '청주약국'), []); // 첫 칸에는 없다
    // 음식점: 등록한 강남구청횟집과 같은 낱말이고 상위 매장이 그 조합을 등록해서
    assert.deepEqual(notes(run(RESTAURANT, RESTAURANT.ranks), '강남횟집'), ["'횟집' 두 번째 칸 — 이미 등록한 '강남구청횟집'과 같은 낱말이고, 상위 2곳이 이 조합을 등록"]);
    // 근거 점수에는 들어가지 않는다(점수 = 근거 점수, parts 에 note 없음)
    for (const sample of [PHARMACY, RESTAURANT, SALON]) {
        for (const result of [run(sample), run(sample, sample.ranks)]) {
            for (const item of result.items) assert.equal(item.evidence.parts.some((part) => part.kind === 'note'), false, item.keyword);
        }
    }
    // 같은 낱말 칸이 하나뿐이면 note 가 없고, 두 번째 칸이어도 까닭이 사실이 아니면 쓰지 않는다(등록 낱말과 같은데 상위 매장 등록도 10위 안 지역도 아닐 때)
    assert.equal(salonNotes(run(SALON)), 0);
    function salonNotes(result) { return result.items.filter((item) => item.reasons.some((reason) => reason.kind === 'note')).length; }
});

test('화면 담당이 넘긴 문구 5곳: 소식 안내는 업종 말로 노출을 단정하지 않고, 그래프의 대표 메뉴·항목 이름·질문 이름표·헤드라인 분모를 사실대로 적는다', () => {
    // 1. naver-place.js: 소식 첫 글 올리기 — 약국은 새 취급 품목·서비스, 미용은 새 시술, 음식점은 새 메뉴. 매장 화면 "상단 노출"을 단정하지 않는다
    const feedText = (place) => buildActionItems(place, { feeds: { count: 0, latestTitle: null } }, { nowMs: NOW }).find((item) => item.key === 'feed').detail;
    assert.equal(feedText(PHARMACY.place), '새 취급 품목·서비스·휴무 안내를 소식에 올리세요.');
    assert.equal(feedText(SALON.place), '새 시술·이벤트·휴무 안내를 소식에 올리면 손님이 매장 화면에서 볼 수 있습니다.');
    assert.equal(feedText(RESTAURANT.place), '새 메뉴·이벤트·휴무 안내를 소식에 올리면 손님이 매장 화면에서 볼 수 있습니다.');
    assert.equal(feedText({ ...SALON.place, category: '동물병원', name: '시험동물병원' }), '새 진료 과목·서비스·휴무 안내를 소식에 올리세요.');
    assert.equal(feedText({ ...SALON.place, category: '네일샵', name: '시험네일' }).startsWith('새 시술·이벤트'), true);
    // 병의원은 소식 기능이 없어 이 할 일이 아예 없다
    assert.equal(buildActionItems({ ...SALON.place, category: '치과' }, { feeds: { count: 0, latestTitle: null } }, { nowMs: NOW }).some((item) => item.key === 'feed'), false);
    // 확인되지 않은 노출·효과를 단정하는 문장이 없다("노출됩니다"·"표시가 붙"·"도움이 됩니다"·"헤매지 않습니다")
    const allText = [PHARMACY, RESTAURANT, SALON].map((sample) => JSON.stringify(buildActionItems(sample.place, {
        feeds: { count: 0, latestTitle: null }, coupons: { total: 0 }, visitor: { sampled: 30, replied: 3, replyRate: 10 }, blog: { total: 3, last30: 0, latest: null },
    }, { nowMs: NOW }))).join('\n');
    assert.equal(/노출됩니다|표시가 붙|도움이 됩니다|헤매지 않습니다|쓰입니다/.test(allText), false);
    assert.equal(feedText({ ...SALON.place, category: '피부관리', name: '시험피부관리' }).startsWith('새 시술·이벤트'), true);
    assert.equal(feedText({ ...SALON.place, category: '한식', name: '시험식당' }).startsWith('새 메뉴·이벤트'), true);
    // 2·3·4. 그래프: 약국·병의원의 '대표 메뉴' 질문은 업종 말, 항목 이름도 업종 말, 질문 이름표는 질문에 있는 그대로(place-geo.js 에 새 export 가 없으면 지금 문구)
    const mainWord = geoWords.mainItemWord?.(PHARMACY.place) || '대표 메뉴';
    const pharmacyGraph = buildPlaceGraph({ ...graphInput(PHARMACY), audit: [] });
    assert.equal(pharmacyGraph.nodes.find((node) => node.id === 'fq:signature').label.startsWith(mainWord.slice(0, 5)), true);
    const restaurantGraph = buildPlaceGraph({ ...graphInput(RESTAURANT), audit: [] });
    assert.equal(restaurantGraph.nodes.find((node) => node.id === 'fq:signature').label, '대표 메뉴'); // 음식점은 그대로
    const structured = (graph) => graph.nodes.find((node) => node.id === 'gf:structured');
    assert.equal(structured(restaurantGraph).label, '메뉴 가격·영업시간');
    if (geoWords.mainItemWord) assert.equal(/^취급 품목·서비스/.test(structured(pharmacyGraph).label) || structured(pharmacyGraph).label.startsWith('취급 품목'), true, structured(pharmacyGraph).label);
    // 5. 헤드라인 분모: 조회한 키워드만 센다. 조회 못 한 것은 "(조회 못 한 K개 제외)"
    const done = (keyword, rank) => ({ keyword, state: 'done', result: { keyword, status: 'found', rank, scanned: 100, top: [], total: 100 } });
    const headline = (ranks) => buildPlaceGraph({ ...graphInput(RESTAURANT, { ranks }), audit: [] }).headline;
    assert.match(headline([done('강남구청횟집', 3), done('압구정횟집', 41)]), /^키워드 2개 중 1개가 10위 안/);
    assert.match(headline([done('강남구청횟집', 3), { keyword: '압구정횟집', state: 'error' }]), /^키워드 1개 중 1개가 10위 안\(조회 못 한 1개 제외\)/);
    assert.match(headline([{ keyword: '강남구청횟집', state: 'error' }, { keyword: '압구정횟집', state: 'error' }]), /^키워드 2개 순위 조회 못 함/);
    assert.match(headline([done('강남구청횟집', 3), { keyword: '압구정횟집', state: 'loading' }]), /^키워드 2개 순위 조회 중/);
});

test('시험 도구 확인: 순위 줄 도우미와 예약 스타일 도우미가 6차 입력과 같은 모양을 만든다', () => {
    assert.deepEqual([rank('은평미용실', 55).state, st('커트', 3)], ['done', { name: '커트', count: 3 }]);
});
