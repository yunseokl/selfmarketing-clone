import test from 'node:test';
import assert from 'node:assert/strict';
import {
    recommendKeywords, pickRankKeywords, regionTerms, familyOf, mentionTerms, regionStatusOf, headlineMenuTerms, CANDIDATE_MAX, BLOG_COUNTS_AS_VOICE,
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
                // note 는 "두 번째 칸" 까닭 한 줄이거나(같은 낱말) 가족 pick 의 까닭 한 줄(7차 K-E)뿐이다
                for (const reason of entry.reasons.filter((other) => other.kind === 'note')) assert.match(reason.text, /^'.+' 두 번째 칸 — |^'.+' 가운데 (리뷰가 가장 많은|손님 쪽 근거가 가장 센) 메뉴$|^'.+'의 구체 메뉴(\(리뷰 [\d,]+회\))?$/, `${at} ${entry.keyword}`);
                assert.equal(entry.evidence.parts.reduce((sum, part) => sum + part.points, 0), entry.evidence.points, `${at} ${entry.keyword}`);
            }
            // 후보: 점수 순 최대 8개, 필드와 이유 문장 모양, 추천·뺀 낱말·순위 조회·topTerm 과 겹치지 않는다
            assert.equal(result.candidates.length <= CANDIDATE_MAX, true, at);
            // 순서: 손님 쪽 근거가 있는 후보(lacks menu·share·data)가 먼저, 메뉴판·예약·결제 줄에만 있는 후보(lacks voice)가 그 뒤, 각각 점수 순
            const voiceAt = result.candidates.findIndex((entry) => entry.lacks === 'voice');
            if (voiceAt >= 0) assert.equal(result.candidates.slice(voiceAt).every((entry) => entry.lacks === 'voice'), true, `${at}: 손님 쪽 근거가 있는 후보가 voice 후보 뒤에 있음`);
            for (const group of [result.candidates.filter((entry) => entry.lacks !== 'voice'), result.candidates.filter((entry) => entry.lacks === 'voice')]) {
                assert.deepEqual(group.map((entry) => entry.score), [...group.map((entry) => entry.score)].sort((a, b) => b - a), at);
            }
            const picked = pickRankKeywords(item.place, result);
            for (const candidate of result.candidates) {
                assert.deepEqual(Object.keys(candidate).sort(), ['evidence', 'keyword', 'lacks', 'reasons', 'region', 'score', 'source', 'term', 'why'], `${at} ${candidate.keyword}`);
                // lacks: menu(품목에서 확인 못 함) · data(메뉴판·예약·결제 자료가 아예 없음) · voice(가게 쪽은 확인됐지만 손님 쪽 — 리뷰·블로그·상위 매장 — 이 없음, 7차 K-A)
                assert.equal(noData ? candidate.lacks === 'data' : ['menu', 'voice', 'share', 'family'].includes(candidate.lacks), true, `${at} ${candidate.keyword}: lacks ${candidate.lacks}`);
                assert.equal(candidate.score, candidate.evidence.points, at);
                if (candidate.lacks === 'voice') assert.match(candidate.why, /^(예약 품목|주간 인기 메뉴|메뉴판)에는 있지만.* 리뷰·.*확인하지 못했.* 손님이 찾는 말이 맞으면 쓰세요\.$/, at);
                else if (candidate.lacks === 'share') {
                    // 비중이 작은 말: 숫자만 적고 곁들임이라 단정하지 않는다
                    assert.match(candidate.why, /^리뷰 [\d,]+회로, 이 매장에서 가장 많이 말해진 '.+' 메뉴\(합쳐 [\d,]+회\)에 견주면 적어 추천에 넣지 않았습니다\. 주력 메뉴가 맞으면 쓰세요\.$/, at);
                    assert.equal(/곁들임/.test(candidate.why), false, at);
                }
                else if (candidate.lacks === 'family') {
                    // 가족에서 근거가 가장 센 메뉴가 칸이 차서 추천에 못 오름(숫자만 적고 직접 판단하게 한다), 또는 상위 매장 둘 이상이 등록했지만 등록·업종 낱말에 묶임(사실만 적는다)
                    assert.match(candidate.why, /^(리뷰 [\d,]+회로 '.+' 가운데 가장 많이 말해진|'.+' 가운데 손님 쪽 근거가 가장 센|(?:리뷰 [\d,]+회로 )?'.+'의 구체) 메뉴이지만, (이 낱말에 새로 권할 지역 조합이 없어 추천에 넣지 않았습니다\. 주력 메뉴가 맞으면 직접 판단해 쓰세요\.|'.+'[이가] 든 키워드를 이미 두 칸 쓰고 있어 추천에 넣지 않았습니다\. 한 칸을 이 메뉴로 바꿀지 직접 판단하세요\.)$|^상위 \d+곳이 '.+'[을를] 등록했지만, '.+'[이가] 들어 있는 말이라 '.+' 하나로 묶었습니다\. 이 메뉴를 따로 권할지 직접 판단하세요\.$/, at);
                } else if (noData) assert.match(candidate.why, /메뉴판·예약·결제 자료가 없어 이 매장이 하는 일인지 확인하지 못했습니다\. 사장님이 직접 판단해 쓰세요\.$/, at);
                else assert.match(candidate.why, /메뉴판·예약·결제 품목에서는 확인되지 않아 추천에 넣지 않았습니다\. 사장님이 직접 판단해 쓰세요\.$|메뉴판·예약·결제에는 '.+'의 일부로만 있어 이 말이 따로 파는 품목인지 확인하지 못했습니다\. 사장님이 직접 판단해 쓰세요\.$/, at);
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
    // (A20 콜키지는 메뉴 "콜키지 프리"의 앞부분이라 7차 M1 로 후보가 된다)
    for (const [id, word] of [['A24', '레슨'], ['B36', '강습']]) assert.equal(first(id).items.find((item) => item.term === word)?.confirmedBy, 'menu', `${id} ${word}`);
    // (9차 K-A: "회원권"은 요금·이용권 이름이라는 닫힌 부류 — 메뉴판 품목이어도 추천하지 않고 이유와 함께 뺀다)
    assert.equal(first('A24').items.some((item) => item.term === '회원권'), false);
    assert.equal(excludedOf(first('A24'), '회원권').rule, 'attribute');
    // 대표 사례: 세탁소의 "무인"은 후보, "운동화세탁"은 메뉴판 품목이라 그대로 추천(등록 낱말이라 지역만 바꾼 조합 줄로 남음)
    const laundry = first('A04');
    assert.equal(terms(laundry).includes('무인'), false);
    assert.equal(candidateTerms(laundry).includes('무인'), true);
    // 7차 M1: 리뷰 '이불'은 메뉴 '이불빨래'의 앞부분일 뿐(남는 말 '빨래'가 같은 품목의 꼴이 아님)이라 품목으로 확인하지 않는다 — 추천이 아니라 후보, 까닭 문장은 어느 품목의 일부인지 적는다
    assert.equal(terms(laundry).includes('이불'), false);
    assert.equal(laundry.candidates.find((item) => item.term === '이불').why, "리뷰에 55회 나왔지만 메뉴판·예약·결제에는 '이불빨래'의 일부로만 있어 이 말이 따로 파는 품목인지 확인하지 못했습니다. 사장님이 직접 판단해 쓰세요.");
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
        ['C05', '사시미', 'menu'], ['C10', '소금빵', 'menu'], ['C10', '감귤타르트', 'menu'], ['C12', '탕수육', 'menu'],
        ['C13', '커트', 'booking'], ['C14', '꽃다발', 'industry'], ['C16', '야간진료', 'industry'], // (C16 추나는 메뉴 '추나요법'의 앞부분이라 7차 M1 로 후보가 됨)
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
    // (순위 표 없이 부른 첫 분석: 압구정횟집은 지역을 확인하지 못한 키워드(7차 K-B)지만 "횟집"의 칸으로 세므로(7차 F03) 추천은 지금까지와 같다)
    assert.deepEqual(run(RESTAURANT).items.map((item) => `${item.keyword}:${item.confirmedBy}`), [
        '강남구청숙성회:menu', '강남구청광어:menu', '강남구청모임:industry', '강남구청대방어:menu', '강남구청룸식당:industry', '강남구청맛집:industry',
    ]);
    // 순위 표가 압구정을 알려 주고 압구정횟집이 41위로 확인되면 그 칸이 비어 상위 매장 2곳이 등록한 강남횟집이 든다
    assert.deepEqual(run(RESTAURANT, RESTAURANT.ranks).items.map((item) => `${item.keyword}:${item.confirmedBy}`), [
        '강남구청숙성회:menu', '강남횟집:registered', '강남구청광어:menu', '강남구청모임:industry', '강남구청대방어:menu', '강남구청룸식당:industry', '강남구청맛집:industry',
    ]);
    assert.deepEqual(run(PHARMACY).candidates, []);
    // 음식점: 7차 M3·s3 로 메뉴판에 한 줄뿐인 품목과 리뷰 상위 8개 밖 낱말이 후보(lacks voice·menu)로 남는다. 추천·뺀 낱말과 겹치지 않고 점수 순이다
    const restaurantCandidates = run(RESTAURANT).candidates;
    assert.deepEqual(restaurantCandidates.map((item) => [item.term, item.lacks]), [
        // (8차 관찰 ②: "(한정) 자연산 붉바리회 + 미역국"처럼 "A + B" 줄에서는 앞의 A 만 후보가 된다 — 곁 낱말 미역국·카르파쵸 대신 회 메뉴 돌돔회·붉바리회·전갱이회·쥐치회가 후보)
        ['오징어', 'menu'], ['돌돔회', 'voice'], ['모듬숙성회', 'voice'], ['무늬오징어사시미', 'voice'], ['붉바리회', 'voice'], ['전갱이회', 'voice'], ['쥐치회', 'voice'], ['참소라숙회', 'voice'],
    ]);
    assert.equal(restaurantCandidates.every((item) => item.score <= 8), true);
    assert.equal(restaurantCandidates[1].why, '메뉴판에는 있지만(메뉴 1개) 리뷰·상위 매장 키워드에서는 이 말을 확인하지 못했고 블로그 후기 언급은 조회하지 않았습니다. 손님이 찾는 말이 맞으면 쓰세요.');
    assert.equal(restaurantCandidates[0].why, "리뷰에 4회 나왔지만 메뉴판·예약·결제에는 '무늬오징어사시미'의 일부로만 있어 이 말이 따로 파는 품목인지 확인하지 못했습니다. 사장님이 직접 판단해 쓰세요.");
    const salon = run(SALON);
    // (7차 K-E: 등록 "댄디컷"의 가족에서 리뷰가 가장 많은 "시스루댄디컷"은 묶이지 않고 따로 권한다)
    assert.deepEqual(salon.items.map((item) => item.keyword), [
        '강남역댄디컷', '강남역다운펌', '강남역쉐도우펌', '강남역볼륨매직', '강남역시스루댄디컷', '강남역아이롱펌', '강남역슬릭컷', '강남역필러스컷', '강남역남자머리', '강남역가르마펌', '강남역바버샵',
    ]);
    // (7차 s3: 리뷰 상위 8개 밖의 같은 종류 낱말(가일펌 254·리프컷 152·애즈펌 140·슬릭펌 130·시스루펌 124회)도 후보 칸이 남으면 후보로 채운다)
    assert.deepEqual(salon.candidates.map((item) => [item.keyword, item.score, item.lacks]), [
        // (8차 S-6: 점수가 같으면 리뷰 수가 많은 쪽이 앞 — 블랙 176회 · 리프컷 152회)
        ['강남역가일컷', 20, 'menu'], ['강남역가일펌', 14, 'menu'], ['강남역블랙', 14, 'menu'], ['강남역리프컷', 14, 'menu'], ['강남역애즈펌', 14, 'menu'], ['강남역슬릭펌', 14, 'menu'], ['강남역시스루펌', 14, 'menu'], ['강남역열펌', 8, 'voice'],
    ]);
    assert.equal(salon.candidates[0].why, '리뷰에 424회 나왔지만 메뉴판·예약·결제 품목에서는 확인되지 않아 추천에 넣지 않았습니다. 사장님이 직접 판단해 쓰세요.');
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
    // 같은 앞말이 등록 키워드에서 서로 다른 낱말(코인노래방·노래방) 앞에 되풀이돼도 그것만으로는 지역이 아니다(7차 K-B). 지리 자료(주소·역·상위 매장의 지역·순위 조회가
    // 알려 준 지역)와 맞을 때만 별칭(홍대)을 목록 없이 읽는다. 맞지 않으면 지역인지 확인하지 못한 키워드(unknown)다.
    const karaoke = first('A26');
    assert.equal(karaoke.regions.some((region) => region.term === '홍대'), false);
    assert.deepEqual(karaoke.registered.map((entry) => [entry.keyword, entry.regionStatus, entry.core]), [['홍대코인노래방', 'unknown', '홍대코인노래방'], ['홍대노래방', 'unknown', '홍대노래방']]);
    const asked = (keyword, region) => ({ keyword, state: 'done', result: { keyword, status: 'found', rank: 6, scanned: 100, total: 100, top: [], region } });
    const located = recommendKeywords({ place: byId.get('A26').place, activity: byId.get('A26').activity, ranks: [asked('홍대코인노래방', '홍대')] });
    assert.deepEqual(confirmed(located).slice(0, 1), ['홍대:rank']);
    assert.deepEqual(located.registered.map((entry) => [entry.keyword, entry.regionStatus, entry.core]), [['홍대코인노래방', 'known', '코인노래방'], ['홍대노래방', 'known', '노래방']]);
    assert.equal(located.items.some((item) => /마포홍대|서교홍대|홍대.*홍대/.test(item.keyword)), false); // 지역이 이미 붙은 낱말에 지역을 또 붙이지 않는다
    assert.equal(first('C01').regions.some((region) => region.term === '홍대'), false);
    assert.equal(recommendKeywords({ place: byId.get('C01').place, activity: byId.get('C01').activity, ranks: [asked('홍대곱창', '홍대')] }).regions[0].term, '홍대');
    // 주소에 그 글자가 있으면(광교 — "광교로" 도로명) 지리 자료와 맞아 지역이다
    assert.equal(first('C11').regions.find((region) => region.term === '광교').confirmedBy, 'address');
    // 한 번만 나온 앞말은 지역인지 확인할 수 없다(센텀네일·송리단길필라테스·북촌카페)
    for (const [id, keyword] of [['C03', '센텀네일'], ['C07', '송리단길필라테스'], ['B20', '북촌카페'], ['C19', '홍대증명사진']]) {
        const result = first(id);
        assert.equal(result.regions.some((region) => keyword.startsWith(region.term) && region.scope === 'custom'), false, keyword);
        assert.equal(registeredOf(result, keyword).regionStatus, 'unknown', keyword);
    }
    // 앞말이 상위 매장 키워드에서도 되풀이되고 그 매장들의 주소·지역(area)에 그 글자가 있으면(내 키워드 하나 + 상위 매장) 지역이다. 그 지역은 rivals 로 확인
    const nail = byId.get('C03');
    // (이 견본의 주소는 "센텀중앙로"라 그 글자가 주소에 있다. 상위 매장의 지역으로 확인되는 경우를 보려고 주소를 바꾼 같은 매장으로 본다)
    const inland = { ...nail.place, address: '부산 해운대구 해운대로 20' };
    const area = (entry) => ({ ...entry, area: '부산 해운대구 센텀2로' });
    const rivals = [area(rival(1, '시험A', ['센텀젤네일', '센텀패디'])), area(rival(2, '시험B', ['센텀속눈썹']))];
    const withRivals = recommendKeywords({ place: inland, activity: nail.activity, rivals });
    assert.equal(withRivals.regions.find((region) => region.term === '센텀').confirmedBy, 'rivals');
    assert.equal(registeredOf(withRivals, '센텀네일').regionStatus, 'known');
    // 되풀이돼도 상위 매장의 주소·지역에 그 글자가 없으면 지역이 아니다(같은 말이 되풀이되는 꾸밈말과 가를 수 없다)
    const noArea = recommendKeywords({ place: inland, activity: nail.activity, rivals: [rival(1, '시험A', ['센텀젤네일', '센텀패디']), rival(2, '시험B', ['센텀속눈썹'])] });
    assert.equal(noArea.regions.some((region) => region.term === '센텀'), false);
    assert.equal(registeredOf(noArea, '센텀네일').regionStatus, 'unknown');
    // 내 주소에 그 글자가 있으면(센텀중앙로) 상위 매장의 지역이 없어도 지리 자료와 맞는다
    assert.equal(recommendKeywords({ place: nail.place, activity: nail.activity, rivals: [rival(1, '시험A', ['센텀젤네일', '센텀패디']), rival(2, '시험B', ['센텀속눈썹'])] }).regions.find((region) => region.term === '센텀').confirmedBy, 'address');
    // 내 키워드가 없으면 서로 다른 상위 매장 둘 이상에서 되풀이될 때만 지역이다(한 매장이 쓴 두 키워드만으로는 아님)
    const noMine = { ...inland, keywords: ['해운대네일', '우동젤네일'] };
    const hasCenteom = (rivalList) => recommendKeywords({ place: noMine, activity: nail.activity, rivals: rivalList }).regions.find((region) => region.term === '센텀');
    assert.equal(hasCenteom([rival(1, '시험A', ['센텀젤네일', '센텀패디'])]), undefined);
    assert.equal(hasCenteom([area(rival(1, '시험A', ['센텀젤네일'])), area(rival(2, '시험B', ['센텀패디']))]).confirmedBy, 'rivals');
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
    // 1) 등록 "국수"가 있으면 구별되는 메뉴(잔치국수)도 그 낱말로 묶이지만 사라지지 않고 "하나로 묶었다"는 이유가 남는다(근거: 같은 낱말에 가까운 두 검색어로 칸을 둘 쓰는 것보다 한 칸에 모으는 쪽이 낫다는 판단).
    // 7차 K-E: 다만 그 가족에서 손님이 가장 많이 말한 구체 품목 하나(콩국수)는 묶지 않고 따로 권한다(국수 한 칸 + 콩국수 한 칸).
    const noodle = recommendKeywords(make('n', { name: '시원국수', category: '국수', keywords: ['공덕국수'], menus: ['콩국수', '잔치국수', '비빔국수', '열무국수', '냉국수'], reviewMenus: [rv('콩국수', 90), rv('잔치국수', 40)] }, { 국수: 10, 콩국수: 8, 잔치국수: 4 }));
    assert.deepEqual([excludedOf(noodle, '잔치국수').rule, excludedOf(noodle, '잔치국수').into], ['merged', '국수']);
    assert.match(excludedOf(noodle, '잔치국수').reason, /하나로 묶었습니다\.$/);
    assert.equal(excludedOf(noodle, '콩국수'), undefined);
    assert.deepEqual(noodle.items.find((item) => item.term === '콩국수').reasons.at(-1), { kind: 'note', text: "'국수' 가운데 리뷰가 가장 많은 메뉴" });
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
    // 영문 메뉴 이름(Americano — 아홉 글자)도 한 낱말이다(9차 N-E: 열 자까지가 아니라 스무 자까지)
    assert.equal([...first('D03').items, ...first('D03').candidates].some((item) => /americano/i.test(item.term)), true);
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
    function salonNotes(result) { return result.items.filter((item) => item.reasons.some((reason) => reason.kind === 'note' && reason.text.includes('두 번째 칸'))).length; }
    // (미용실의 "시스루댄디컷"은 같은 낱말의 둘째 칸이 아니라 다른 낱말이라, 가족 pick 의 note 한 줄만 있다)
    assert.deepEqual(notes(run(SALON), '강남역시스루댄디컷'), ["'댄디컷' 가운데 리뷰가 가장 많은 메뉴"]);
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

// ---------------------------------------------------------------------------
// 7차 채점(새 입력 99종, 견본 9.8 / 새 입력 5.4)에서 남은 큰 구멍 5건: 낱말 목록을 더하지 않고 원칙으로만 닫습니다.
//   K-A 추천은 가게 쪽(메뉴판·예약·결제 — 셋은 한 쪽)과 손님 쪽(리뷰 메뉴·블로그·상위 매장 둘 이상 등록)이 모두 확인한 말만
//   K-B 되풀이만으로는 지역을 확정하지 않는다(지리 자료와 맞을 때만)   K-C 매장 자료 어디에도 없는 등록 낱말은 새 조합을 만들지 않는다
//   K-D 메뉴 이름 앞에서만 쓰인 말은 낱말이 아니다   K-E 묶인 품목도 주력으로 세고, 가족에서 하나는 따로 권한다
// ---------------------------------------------------------------------------
test('K-A 두 쪽 확인: 가게 쪽(예약·메뉴판·결제)만 확인된 말은 후보(lacks voice), 손님 쪽(리뷰·블로그·상위 매장)도 확인되면 추천', () => {
    const base = {
        name: '헤어룸 연희', category: '미용실', address: '서울 서대문구 연희로 100', jibun: '서울 서대문구 연희동 100', keywords: ['연희동미용실'],
        reviewMenus: [rv('레이어드컷', 100), rv('매직셋팅펌', 90)],
        styles: [st('레이어드컷', 100), st('매직셋팅펌', 90), st('지명디자이너', 90)],
    };
    // 블로그 언급을 아직 묻지 않은 첫 분석: 예약 스타일 "지명디자이너"(예약 90건)는 리뷰·상위 매장에서 확인되지 않아 후보다
    const quiet = recommendKeywords({ place: mkPlace({ id: 'ka1', ...base }) });
    assert.equal(terms(quiet).includes('지명디자이너'), false);
    assert.deepEqual(terms(quiet).filter((word) => ['레이어드컷', '매직셋팅펌'].includes(word)), ['레이어드컷', '매직셋팅펌']); // 리뷰도 있는 예약 스타일은 두 쪽 확인
    const candidate = quiet.candidates.find((item) => item.term === '지명디자이너');
    assert.deepEqual([candidate.lacks, candidate.keyword], ['voice', '연희지명디자이너']);
    assert.equal(candidate.why, '예약 품목에는 있지만(90건) 리뷰·상위 매장 키워드에서는 이 말을 확인하지 못했고 블로그 후기 언급은 조회하지 않았습니다. 손님이 찾는 말이 맞으면 쓰세요.');
    // 블로그 후기 언급을 물어봤는데 0개면 "확인하지 못했다"고 말한다. 순위 조회 대상에도 후보는 들어가지 않는다
    const asked = (count) => ({ mentions: { blogTotal: 20, terms: [{ term: '미용실', count: 15 }, { term: '지명디자이너', count }] } });
    const zero = recommendKeywords({ place: mkPlace({ id: 'ka1', ...base }), activity: asked(0) });
    assert.equal(zero.candidates.find((item) => item.term === '지명디자이너').why, '예약 품목에는 있지만(90건) 리뷰·블로그·상위 매장 키워드에서는 이 말을 확인하지 못했습니다. 손님이 찾는 말이 맞으면 쓰세요.');
    assert.equal(pickRankKeywords(mkPlace({ id: 'ka1', ...base }), zero).keywords.some((keyword) => keyword.includes('지명디자이너')), false);
    // 블로그 후기에 나와도 손님 쪽 확인으로 치지 않는다(BLOG_COUNTS_AS_VOICE = false). 후보로 남고 까닭에 블로그에 나온 개수를 사실대로 적는다
    assert.equal(BLOG_COUNTS_AS_VOICE, false);
    const talked = recommendKeywords({ place: mkPlace({ id: 'ka1', ...base }), activity: asked(3) });
    assert.equal(talked.items.some((item) => item.term === '지명디자이너'), false);
    assert.deepEqual([talked.candidates.find((item) => item.term === '지명디자이너').lacks, talked.candidates.find((item) => item.term === '지명디자이너').why],
        ['voice', '예약 품목에는 있지만(90건) 리뷰·상위 매장 키워드에서는 이 말을 확인하지 못했고, 블로그 후기에는 20개 중 3개 나옵니다. 손님이 찾는 말이 맞으면 쓰세요.']);
    // 상위 매장 둘 이상이 등록한 말도 손님 쪽 확인이다(상위 매장 자료가 업종·품목과 맞을 때)
    const rivalled = recommendKeywords({ place: mkPlace({ id: 'ka1', ...base }), rivals: [rival(1, '시험A', ['서대문지명디자이너']), rival(2, '시험B', ['신촌지명디자이너'])] });
    assert.equal(terms(rivalled).includes('지명디자이너'), true);
    // 결제 인기 메뉴만 있는 말도 같다(주간 인기 메뉴는 가게 쪽 자료)
    const paid = recommendKeywords({ place: mkPlace({ id: 'ka2', ...base, styles: [], pos: { popularMenus: [{ name: '두피케어', share: 30 }] }, reviewMenus: [rv('레이어드컷', 100)] }) });
    assert.deepEqual([terms(paid).includes('두피케어'), paid.candidates.find((item) => item.term === '두피케어')?.lacks], [false, 'voice']);
    assert.match(paid.candidates.find((item) => item.term === '두피케어').why, /^주간 인기 메뉴에는 있지만 /);
    // 메뉴판 줄도 같다: 세 줄 이상에 되풀이되는 낱말(board)이어도 손님 쪽 확인이 없으면 후보
    const board = recommendKeywords({ place: mkPlace({ id: 'ka3', ...SHOP, name: '시험식당', category: '한식', keywords: ['공덕한식'], reviewMenus: [rv('김치찌개', 50)], menus: ['한우 불고기', '불고기 정식', '불고기 전골', '김치찌개'] }) });
    assert.equal(terms(board).includes('불고기'), false);
    assert.deepEqual(board.candidates.filter((item) => item.term === '불고기').map((item) => item.lacks), ['voice']);
    assert.match(board.candidates.find((item) => item.term === '불고기').why, /^메뉴판에는 있지만\(메뉴 3개\) /);
    // 업종·등록 낱말은 그 자체가 확인이라 두 쪽을 따지지 않는다
    const bare = recommendKeywords({ place: mkPlace({ id: 'ka4', ...SHOP, name: '헤어룸', category: '미용실', keywords: [] }) });
    assert.deepEqual([...new Set(bare.items.map((item) => `${item.term}:${item.confirmedBy}`))], ['미용실:industry']); // 리뷰·블로그가 없어도 업종 낱말은 추천
});

test('K-A 보태기: 이미 있는 조건어(ATTRIBUTE_WORDS)로 끝나는 합성어는 조건어로 처리하고, 한 글자 꼬리나 품목 이름일 수 있는 말은 건드리지 않는다', () => {
    const hair = recommendKeywords({
        place: mkPlace({
            id: 'kb1', name: '헤어룸 연희', category: '미용실', address: '서울 서대문구 연희로 100', jibun: '서울 서대문구 연희동 100', keywords: [],
            reviewMenus: [rv('학생할인', 60), rv('첫방문이벤트', 40), rv('레이어드컷', 100)],
            styles: [st('학생할인', 90), st('첫방문이벤트', 70), st('레이어드컷', 100)],
        }),
    });
    for (const word of ['학생할인', '첫방문이벤트']) {
        assert.equal(terms(hair).includes(word) || candidateTerms(hair).includes(word), false, word);
        assert.equal(excludedOf(hair, word).rule, 'attribute', word);
    }
    assert.equal(terms(hair).includes('레이어드컷'), true);
    // 갈비·음료처럼 "…비·…료"로 끝나는 품목 이름은 걸리지 않는다(한 글자 꼬리 규칙을 두지 않음)
    const meat = recommendKeywords({
        place: mkPlace({ id: 'kb2', ...SHOP, name: '시험고깃집', category: '한식', keywords: [], reviewMenus: [rv('양념갈비', 60), rv('냉음료', 40)], menus: ['양념갈비', '냉음료', '생갈비', '공기밥', '된장찌개'] }),
    });
    for (const word of ['양념갈비', '냉음료']) assert.equal(excludedOf(meat, word)?.rule === 'attribute', false, word);
    // 그 매장의 업종 이름에 든 말·품목 이름의 끝말이 될 수 있는 말("룸서비스"·"베이비샤워")은 합성어 규칙에서 빼 둔다
    const party = recommendKeywords({ place: mkPlace({ id: 'kb3', ...SHOP, name: '시험파티룸', category: '파티룸', keywords: [], reviewMenus: [rv('베이비샤워', 40)], menus: ['베이비샤워', '생일파티'] }) });
    assert.equal(excludedOf(party, '베이비샤워')?.rule === 'attribute', false);
});

test('K-C 이 매장 자료 어디에도 없는 등록 낱말(경쟁 가게 상호)은 새 지역 조합을 만들지 않는다 — 그 칸이 틀렸다고 단정하지는 않는다', () => {
    const cafe = {
        name: '카페 연희', category: '카페', address: '서울 서대문구 연희로 100', jibun: '서울 서대문구 연희동 100',
        keywords: ['연희스타벅스', '연희이디야커피', '연희아메리카노'],
        reviewMenus: [rv('아메리카노', 80), rv('크로플', 50)], menus: ['아메리카노', '크로플', '카페라떼', '딸기라떼'],
    };
    const result = recommendKeywords({ place: mkPlace({ id: 'kc1', ...cafe }), activity: { mentions: { blogTotal: 20, terms: [{ term: '스타벅스', count: 4 }, { term: '이디야커피', count: 3 }] } } });
    for (const word of ['스타벅스', '이디야커피']) {
        assert.equal(result.items.some((item) => item.term === word), false, word);
        assert.deepEqual([excludedOf(result, word).rule, excludedOf(result, word).keywords], ['unrelated', []], word);
        // 단정하지 않고(틀렸다고도 지우라고도 하지 않고) 새 조합만 만들지 않는다고 말한다
        assert.match(excludedOf(result, word).reason, /이 매장의 업종·이름·메뉴·리뷰·예약·결제 자료에서 찾지 못한 말이라, 지역을 붙인 새 키워드는 만들지 않았습니다\. 사장님이 아는 사실이면 등록한 그대로 쓰세요\.$/, word);
        assert.equal(registeredOf(result, `연희${word}`).concern.rule, 'unrelated', word);
    }
    // 이 매장 자료에 있는 등록 낱말(아메리카노)은 그대로 쓴다
    assert.equal(registeredOf(result, '연희아메리카노').concern, null);
    assert.equal(result.items.some((item) => item.term === '아메리카노' || item.term === '카페'), true);
    // 견줄 자료(메뉴판·예약·결제·리뷰 메뉴)가 하나도 없는 매장은 "자료에 없다"가 뜻이 없어 이 검사를 하지 않는다
    const bare = recommendKeywords({ place: mkPlace({ id: 'kc2', name: '카페 연희', category: '카페', address: '서울 서대문구 연희로 100', jibun: '서울 서대문구 연희동 100', keywords: ['연희이디야커피'] }) });
    assert.equal(excludedOf(bare, '이디야커피'), undefined);
    // 업종 이름의 줄임말("소아청소년과"의 "소아과")과 업종이 당연히 파는 메뉴(이탈리아음식의 파스타)는 아는 말이다. 앞의 꾸밈말("수제")을 뗀 말도 본다
    const known = (category, keyword, extra = {}) => recommendKeywords({ place: mkPlace({ id: 'kc3', ...SHOP, name: '시험', category, keywords: [keyword], reviewMenus: [rv('기타', 5)], menus: ['기타'], ...extra }) });
    assert.equal(excludedOf(known('소아청소년과', '공덕소아과'), '소아과'), undefined);
    assert.equal(excludedOf(known('이탈리아음식', '공덕파스타'), '파스타'), undefined);
    assert.equal(excludedOf(known('햄버거', '공덕수제버거', { menus: ['치즈버거', '클래식버거'], reviewMenus: [rv('치즈버거', 40)] }), '수제버거'), undefined);
});

test('K-D 메뉴 이름 앞에서만 되풀이되는 지명·원산지(마장동·봉평)는 낱말이 아니다 — 끝말로도 쓰이면 낱말이다', () => {
    const place = (menus, reviewMenus) => mkPlace({ id: 'kd', ...SHOP, name: '시험정육식당', category: '정육식당', keywords: [], menus, reviewMenus });
    const lead = recommendKeywords({ place: place(['마장동 소고기', '마장동 육회', '마장동 한우', '된장찌개'], [rv('소고기', 60), rv('육회', 40)]) });
    // 추천도 후보도 아니지만 흔적 없이 사라지지 않는다
    assert.equal(terms(lead).includes('마장동') || candidateTerms(lead).includes('마장동'), false);
    assert.equal(excludedOf(lead, '마장동').rule, 'prefix');
    assert.match(excludedOf(lead, '마장동').reason, /^'마장동'은 메뉴 이름 앞에서만 쓰이고\(메뉴 3개\) 끝말로는 한 번도 쓰이지 않아, /);
    assert.equal(terms(lead).includes('소고기'), true); // 끝말로 쓰인 낱말은 그대로
    // 같은 낱말이 끝말로도 한 번 쓰이면(차림 낱말을 뺀 "봉평 메밀국수 정식"은 끝말이 메밀국수, 따로 "봉평" 메뉴) 낱말이다
    const tail = recommendKeywords({ place: place(['봉평 메밀국수', '봉평 메밀전', '봉평 메밀묵', '봉평'], [rv('봉평', 30), rv('메밀국수', 50)]) });
    assert.equal(excludedOf(tail, '봉평')?.rule === 'prefix', false);
    // 앞말로만 쓰이는데 시·도 이름이면 이미 있는 규칙(place)이 먼저다
    const jeonju = recommendKeywords({ place: place(['전주 비빔밥', '전주 콩나물국밥', '전주 한정식', '냉면'], [rv('비빔밥', 50)]) });
    assert.equal(excludedOf(jeonju, '전주').rule, 'place');
});

test('K-E 가족: 등록·업종 낱말에 묶이는 품목 가운데 손님이 가장 많이 말한 하나는 따로 권하고(같은 낱말처럼 두 칸까지), 곁들임은 묶인 주력의 크기로 가른다', () => {
    const burger = (extra = {}) => recommendKeywords({
        place: mkPlace({
            id: 'ke1', ...SHOP, name: '버거랩 공덕', category: '햄버거', keywords: ['공덕수제버거', '공덕버거'],
            menus: ['클래식버거', '치즈버거', '베이컨버거', '감자튀김', '어니언링', '수제맥주', '버거세트'],
            reviewMenus: [rv('치즈버거', 90), rv('클래식버거', 70), rv('베이컨버거', 40), rv('감자튀김', 35), rv('수제맥주', 20)], ...extra,
        }),
    });
    const result = burger();
    // ② 가족 pick: 등록 "버거" 한 칸 + 리뷰가 가장 많은 "치즈버거" 한 칸. 나머지 품목은 하나로 묶인다
    assert.equal(result.items.some((item) => item.keyword === '공덕치즈버거'), true);
    assert.deepEqual(result.items.find((item) => item.keyword === '공덕치즈버거').reasons.at(-1), { kind: 'note', text: "'버거' 가운데 리뷰가 가장 많은 메뉴" });
    for (const word of ['클래식버거', '베이컨버거']) assert.deepEqual([excludedOf(result, word).rule, excludedOf(result, word).into], ['merged', '버거'], word);
    // ① 묶인 품목도 주력으로 센다: 감자튀김(35회)은 묶인 버거 메뉴(치즈 90 + 클래식 70 + 베이컨 40 = 200회)의 1/3에 못 미쳐 주력 자리를 차지하지 못한다
    // 비중만으로는 "곁들임"이라고 단정하지 않고 후보(lacks share)로 둔다 — 숫자만 적는다
    assert.equal(terms(result).includes('감자튀김'), false);
    assert.equal(excludedOf(result, '감자튀김'), undefined);
    const fries = result.candidates.find((item) => item.term === '감자튀김');
    assert.deepEqual([fries.lacks, fries.why], ['share', "리뷰 35회로, 이 매장에서 가장 많이 말해진 '치즈버거'·'클래식버거'·'베이컨버거' 메뉴(합쳐 200회)에 견주면 적어 추천에 넣지 않았습니다. 주력 메뉴가 맞으면 쓰세요."]);
    // 히레카츠처럼 주력일 수도 있는 말은 갈래 사전이 모르는 말이어도 빠지지 않고 후보로 남는다(돈가스집의 히레카츠)
    const katsu = recommendKeywords({ place: mkPlace({ id: 'ke4', ...SHOP, name: '시험돈가스', category: '돈가스', keywords: ['공덕돈가스'], menus: ['등심돈가스', '치즈돈가스', '히레카츠', '냉모밀'], reviewMenus: [rv('등심돈가스', 120), rv('치즈돈가스', 80), rv('히레카츠', 30), rv('냉모밀', 25)] }) });
    for (const word of ['히레카츠', '냉모밀']) assert.equal(katsu.excluded.some((entry) => entry.term === word && entry.rule === 'offMain'), false, word);
    // 업종 이름의 한 갈래를 이름에 품은 메뉴("불닭롤" — 업종 "초밥,롤")는 곁들임이 아니다
    const sushi = recommendKeywords({
        place: mkPlace({
            id: 'ke2', ...SHOP, name: '스시마루', category: '초밥,롤', keywords: ['공덕초밥'],
            menus: ['모둠초밥', '연어초밥', '불닭롤', '우동', '튀김'], reviewMenus: [rv('모둠초밥', 120), rv('연어초밥', 90), rv('불닭롤', 60)],
        }),
    });
    assert.equal(terms(sushi).includes('불닭롤'), true);
    // 같은 낱말은 두 칸까지: 가족이 이미 두 칸(등록 키워드 둘)이면 따로 권할 칸이 없어도 묶여 사라지지 않고 후보(lacks family)로 남는다(8차 K-E)
    const full2 = burger({ keywords: ['부천버거', '중동버거'], address: '경기 부천시 길주로 100', jibun: '경기 부천시 중동 100' });
    assert.equal(full2.items.some((item) => item.term === '치즈버거'), false);
    assert.equal(excludedOf(full2, '치즈버거'), undefined);
    const familyCandidate = full2.candidates.find((item) => item.term === '치즈버거');
    assert.deepEqual([familyCandidate.lacks, familyCandidate.why], ['family', "리뷰 90회로 '버거' 가운데 가장 많이 말해진 메뉴이지만, '버거'가 든 키워드를 이미 두 칸 쓰고 있어 추천에 넣지 않았습니다. 한 칸을 이 메뉴로 바꿀지 직접 판단하세요."]);
    assert.equal(full2.confirmedTerms.includes('치즈버거'), false);
    // 먹고 마시는 업종이 아니면 곁들임을 가르지 않는다(미용실의 낮게 말해진 시술은 그대로)
    const salon = recommendKeywords({
        place: mkPlace({ id: 'ke3', name: '헤어룸', category: '미용실', address: '서울 마포구 양화로 100', jibun: '서울 마포구 서교동 400', keywords: ['서교미용실'],
            reviewMenus: [rv('댄디컷', 200), rv('시스루댄디컷', 100), rv('두피케어', 20)], styles: [st('댄디컷', 100), st('시스루댄디컷', 80), st('두피케어', 20)] }),
    });
    assert.equal(excludedOf(salon, '두피케어')?.rule === 'offMain', false);
});

// ---------------------------------------------------------------------------
// 7차 채점의 나머지(보통 M1~M9·사소 s1~s3·관찰 F03): 역시 낱말 목록을 더하지 않고 자료·구조로 닫습니다.
// ---------------------------------------------------------------------------
test('M1 품목 이름의 토막(앞부분)으로는 확인하지 않고, 묶음은 가게 쪽 확인을 물려주지 않는다 — 광어+회처럼 같은 품목의 꼴이면 확인', () => {
    const shop = (menus, reviewMenus) => recommendKeywords({ place: mkPlace({ id: 'm1', ...SHOP, name: '시험샤브', category: '샤브샤브', keywords: [], menus, reviewMenus }) });
    const bits = shop(['소고기샤브샤브', '채소샤브샤브', '칼국수', '볶음밥', '죽'], [rv('소고기', 60), rv('칼국수', 40)]);
    assert.equal(terms(bits).includes('소고기'), false);
    const candidate = bits.candidates.find((item) => item.term === '소고기');
    assert.deepEqual([candidate.lacks, candidate.keyword], ['menu', '마포소고기']);
    assert.equal(candidate.why, "리뷰에 60회 나왔지만 메뉴판·예약·결제에는 '소고기샤브샤브'의 일부로만 있어 이 말이 따로 파는 품목인지 확인하지 못했습니다. 사장님이 직접 판단해 쓰세요.");
    // 품목 이름 전체이거나 끝말이거나, 남는 말이 같은 품목의 꼴(메뉴 갈래 끝말·한 글자)이면 확인된 말이다
    const same = recommendKeywords({ place: mkPlace({ id: 'm1b', ...SHOP, name: '시험수산', category: '생선회', keywords: [], menus: ['광어회', '우럭회', '모둠회', '매운탕', '공기밥', '갈치조림'], reviewMenus: [rv('광어', 60), rv('갈치', 20), rv('매운탕', 15)] }) });
    for (const word of ['광어', '갈치']) assert.equal(same.items.find((item) => item.term === word)?.confirmedBy, 'menu', word);
    // 묶음이 확인을 물려주지 않는다: 오타 "마라상궈"가 "마라"에 묶여도 가게 쪽 확인이 생기지 않는다
    const typo = recommendKeywords({ place: mkPlace({ id: 'm1c', ...SHOP, name: '시험마라탕', category: '마라탕', keywords: [], menus: ['마라탕', '마라샹궈', '꿔바로우', '꿀떡', '당면'], reviewMenus: [rv('마라', 80), rv('마라상궈', 30), rv('마라탕', 120)] }) });
    assert.equal(terms(typo).includes('마라상궈'), false);
});

test('M2·M9 갈래 사전에 없는 업종도 자료로 곁들임을 가르고, 같은 갈래(끝 글자)·등록 낱말 자신은 곁들임·다른 업종으로 빼지 않는다', () => {
    const shop = (p) => recommendKeywords({ place: mkPlace({ id: 'm2', ...SHOP, ...p }) });
    // 갈래 사전(DISH_HEADS)에 없는 업종(죽 전문점·쌈밥·파스타): 주력 가족(업종·등록 낱말을 이름에 품은 메뉴)의 리뷰 합계에 견줘 적게 말해진 메뉴는 곁들임
    const porridge = shop({ name: '시험죽집', category: '죽', keywords: [], menus: ['닭죽', '야채죽', '전복죽', '장조림', '계란말이', '김치'], reviewMenus: [rv('닭죽', 90), rv('야채죽', 60), rv('전복죽', 50), rv('장조림', 20), rv('계란말이', 15)] });
    assert.equal(terms(porridge).includes('장조림'), false);
    assert.equal(excludedOf(porridge, '장조림'), undefined);
    assert.deepEqual([porridge.candidates.find((item) => item.term === '장조림').lacks, porridge.candidates.find((item) => item.term === '장조림').why],
        ['share', "리뷰 20회로, 이 매장에서 가장 많이 말해진 '닭죽'·'야채죽'·'전복죽' 메뉴(합쳐 200회)에 견주면 적어 추천에 넣지 않았습니다. 주력 메뉴가 맞으면 쓰세요."]);
    // 비중이 충분하면(주력 가족 합계의 1/3 이상) 곁들임이 아니다
    const enough = shop({ name: '시험죽집', category: '죽', keywords: [], menus: ['닭죽', '야채죽', '장조림'], reviewMenus: [rv('닭죽', 90), rv('야채죽', 60), rv('장조림', 70)] });
    assert.equal(enough.candidates.some((item) => item.term === '장조림' && item.lacks === 'share'), false);
    // M9 곱창집: 곱창·막창과 같은 끝 글자("창")를 가진 대창은 같은 갈래라 후보도 아니다
    const gopchang = shop({ name: '시험곱창', category: '곱창,막창', keywords: [], menus: ['소곱창', '막창', '대창', '껍데기', '볶음밥'], reviewMenus: [rv('곱창', 150), rv('막창', 90), rv('대창', 40), rv('껍데기', 30)] });
    assert.equal(gopchang.excluded.some((entry) => entry.term === '대창' && entry.rule === 'offMain'), false);
    assert.equal(gopchang.candidates.some((item) => item.term === '대창' && item.lacks === 'share'), false);
    // (껍데기는 갈래 사전이 아는 다른 갈래라 예전처럼 offMain 이다 — 비중만으로 걸린 말(후보)과 구분된다)
    assert.equal(gopchang.excluded.some((entry) => entry.term === '껍데기' && entry.rule === 'offMain'), true);
    // M9 순대국집: 사장님이 등록한 "국밥"은 이 매장 메뉴("내장국밥")·리뷰에 있어 다른 업종의 낱말로 보지 않는다
    const soup = shop({
        name: '할매순대국', category: '순대,순대국', keywords: ['공덕순대국', '공덕국밥'], menus: ['순대국', '내장국밥', '머릿고기', '모듬순대', '수육', '소주'],
        reviewMenus: [rv('순대국', 120), rv('내장국밥', 60), rv('머릿고기', 30), rv('수육', 28), rv('소주', 10)],
    });
    assert.equal(registeredOf(soup, '공덕국밥').concern, null);
    assert.equal(soup.excluded.some((entry) => entry.term === '국밥' && entry.rule === 'otherBusiness'), false);
    assert.equal(soup.excluded.some((entry) => entry.term === '내장국밥' && entry.rule === 'otherBusiness'), false);
});

test('M3·s3 메뉴판의 한 줄 품목·영어 메뉴·리뷰 8개 밖 낱말은 후보로 남고, 예약 스타일은 조건 줄을 거른 뒤 상위 5개를 본다', () => {
    const clinic = recommendKeywords({
        place: mkPlace({ id: 'm3', ...SHOP, name: '시험정형외과', category: '정형외과', keywords: [], menus: ['비수술치료', 'MRI', '체외충격파', '도수치료'], reviewMenus: [rv('도수치료', 60)] }),
    });
    const lines = clinic.candidates.filter((item) => ['비수술치료', 'mri', '체외충격파'].includes(item.term.toLowerCase()));
    assert.deepEqual(lines.map((item) => [item.term.toLowerCase(), item.lacks]).sort(), [['mri', 'voice'], ['비수술치료', 'voice'], ['체외충격파', 'voice']]);
    assert.match(lines[0].why, /^메뉴판에는 있지만\(메뉴 1개\) /);
    // 영어 메뉴판: 이름 전체를 원래 표기 그대로 한 낱말로 쓴다(8차 S-3: '한남benedict'처럼 마지막 낱말만 쓰지 않음)
    const english = recommendKeywords({ place: mkPlace({ id: 'm3b', ...SHOP, name: 'Cafe Brunch', category: '브런치카페', keywords: [], menus: ['Eggs Benedict', 'French Toast', 'Caesar Salad'] }) });
    assert.deepEqual(english.candidates.map((item) => item.term).sort(), ['CaesarSalad', 'EggsBenedict', 'FrenchToast']);
    // 원래 표기 그대로("MRI"가 "mri"로 줄지 않음), 크기 꼬리말("보통")은 품목 이름이 아니다(8차 S-3)
    assert.equal(clinic.candidates.some((item) => item.term === 'MRI'), true);
    const sizes = recommendKeywords({ place: mkPlace({ id: 's3', ...SHOP, name: '시장순대국', category: '순대,순대국', keywords: ['신림순대국'], menus: ['순대국 특', '순대국 보통', '수육 소'], reviewMenus: [rv('순대국', 120)] }) });
    assert.equal(sizes.candidates.some((item) => /보통|특$/.test(item.term)), false);
    // 예약 스타일: 조건 줄("학생할인")이 상위 5개 자리를 차지해 진짜 품목이 밀리지 않는다
    const styles = [st('학생할인', 300), st('첫방문이벤트', 290), st('지명디자이너', 280), st('커트', 100), st('펌', 90), st('염색', 80), st('클리닉', 70), st('다운펌', 60), st('뿌리염색', 50)];
    const salon = recommendKeywords({ place: mkPlace({ id: 'm3c', ...SHOP, name: '헤어룸', category: '미용실', keywords: [], styles, reviewMenus: [rv('클리닉', 20), rv('다운펌', 20), rv('뿌리염색', 20), rv('염색', 20)] }) });
    // (조건 줄 셋이 상위 자리를 차지하던 때는 클리닉·염색이 상위 5개 밖이라 사라졌다)
    for (const word of ['다운펌', '염색', '클리닉']) assert.equal(terms(salon).includes(word), true, word);
    assert.equal(salon.excluded.filter((entry) => entry.rule === 'attribute').map((entry) => entry.term).sort().join(), '첫방문이벤트,학생할인');
    assert.deepEqual(candidateTerms(salon).sort(), ['지명디자이너', '커트']);
});

test('후보 순서: 손님 쪽 근거가 있는 후보(리뷰에 나온 말)가 메뉴판·예약 줄에만 있는 후보(점수가 더 높아도)보다 항상 앞에 온다', () => {
    const place = mkPlace({
        id: 'order', ...SHOP, name: '헤어룸', category: '미용실', keywords: [], styles: [st('커트', 100), st('지명디자이너', 90)],
        reviewMenus: [rv('커트', 100), rv('두피스케일링', 1)],
    });
    const result = recommendKeywords({ place });
    const byTerm = Object.fromEntries(result.candidates.map((item) => [item.term, item]));
    // 리뷰에만 나온 말(menu, 8점)이 예약 줄에만 있는 말(voice, 14점)보다 점수가 낮지만 앞이다
    assert.deepEqual(result.candidates.map((item) => [item.term, item.lacks]), [['두피스케일링', 'menu'], ['지명디자이너', 'voice']]);
    assert.equal(byTerm['지명디자이너'].score > byTerm['두피스케일링'].score, true);
});

test('M4 "명동2가"·"필동1가"처럼 동을 떼면 한 글자만 남는 가(街) 주소도 지역(명동·필동)으로 읽는다', () => {
    for (const [address, jibun, expected] of [['서울 중구 명동길 14', '서울 중구 명동2가 40', '명동'], ['서울 중구 퇴계로 10', '서울 중구 필동1가 10', '필동']]) {
        const regions = regionTerms({ address, jibunAddress: jibun, keywords: [] });
        assert.equal(regions.some((region) => region.term === expected && region.scope === 'town'), true, jibun);
    }
    assert.deepEqual(regionTerms({ address: '서울 성동구 성수이로 100', jibunAddress: '서울 성동구 성수동2가 300', keywords: [] }).map((region) => region.term), ['성동', '성수']);
    const place = mkPlace({ id: 'm4', name: '명동칼국수집', category: '칼국수', address: '서울 중구 명동길 14', jibun: '서울 중구 명동2가 40', keywords: [], menus: ['칼국수'], reviewMenus: [rv('칼국수', 50)] });
    const result = recommendKeywords({ place });
    assert.equal(result.emptyReason === 'noRegion', false);
    assert.equal(result.items.some((item) => item.keyword.startsWith('명동')), true);
});

test('M5 끝말을 모르는 짧은 등록 키워드(판교코딩·로데오삼겹살)는 지역이 없다고 단정하지 않는다(unknown) — 순위 조회에서도 빠지지 않는다', () => {
    // (끝말 "코딩"은 이 매장 메뉴에 있다 — 8차 S-1: 키워드의 어느 끝말도 이 매장 자료에 없으면 unrelated 로 알리고 순위 조회에서 뺀다)
    const place = mkPlace({ id: 'm5', ...SHOP, name: '시험학원', category: '컴퓨터학원', keywords: ['판교코딩', '컴퓨터학원'], menus: ['앱인벤터', '파이썬', '코딩'] });
    const result = recommendKeywords({ place });
    assert.deepEqual(result.registered.map((entry) => [entry.keyword, entry.regionStatus]), [['판교코딩', 'unknown'], ['컴퓨터학원', 'none']]);
    assert.equal(pickRankKeywords(place, result).keywords.includes('판교코딩'), true);
    assert.equal(pickRankKeywords(place, result).skipped.includes('판교코딩'), false);
    // 확인된 낱말(품목·업종)로 설명되는 키워드는 지역이 없다고 말한다
    assert.equal(registeredOf(recommendKeywords({ place: mkPlace({ id: 'm5b', ...SHOP, name: '시험헤어', category: '미용실', keywords: ['레이어드컷'], menus: ['레이어드컷'] }) }), '레이어드컷').regionStatus, 'none');
});

test('M6 메뉴판의 "3D 체형분석"을 리뷰의 "3D체형분석"과 같은 품목으로 확인한다(까닭 문장이 사실과 맞다)', () => {
    const place = mkPlace({ id: 'm6', ...SHOP, name: '시험체형센터', category: '체형관리', keywords: [], menus: ['3D 체형분석', '체형교정'], reviewMenus: [rv('3D체형분석', 40), rv('체형교정', 30)] });
    const result = recommendKeywords({ place });
    assert.equal(terms(result).includes('3d체형분석') || terms(result).includes('3D체형분석'), true);
    assert.equal(result.candidates.some((item) => /체형분석/.test(item.term) && /확인되지 않아/.test(item.why)), false);
});

test('M7 headlineMenuTerms 는 추천이 확인한 낱말만 돌려준다(오타·후보·조건 줄은 한 줄 소개에 쓰이지 않는다)', () => {
    const place = mkPlace({
        id: 'm7', ...SHOP, name: '시험분식', category: '분식', keywords: [], menus: ['떡볶이', '돈가스', '칼국수', '튀김', '순대'],
        reviewMenus: [rv('떡복이', 90), rv('칼국쑤', 80), rv('돈까스', 70), rv('떡볶이', 60), rv('순대', 50), rv('지명디자이너', 40)],
    });
    assert.deepEqual(headlineMenuTerms(place, null, { limit: 8 }), ['떡볶이', '순대']);
    // 확인된 낱말이 하나도 없으면 []
    assert.deepEqual(headlineMenuTerms(mkPlace({ id: 'm7b', ...SHOP, name: '시험', category: '한식', keywords: [], reviewMenus: [rv('웨이팅', 30)] }), null), []);
    assert.deepEqual(headlineMenuTerms(RESTAURANT.place, RESTAURANT.activity), ['광어', '숙성회']);
    assert.deepEqual(headlineMenuTerms(SALON.place, SALON.activity), ['댄디컷', '쉐도우펌']);
});

test('M8 업종 이름이 분류 이름표일 뿐이면(기타서비스) 최종 단계에서는 추천하지 않고, 첫 분석에서는 순위 확인용으로만 낸다', () => {
    const place = mkPlace({ id: 'm8', name: '시험상점', category: '기타서비스', address: '서울 마포구 양화로 100', jibun: '서울 마포구 서교동 400', keywords: [], reviewMenus: [rv('상품A', 50)], menus: ['상품A'] });
    // 8차 S-4: 이름표는 업종 분류의 윗단 이름(닫힌 집합)이고, 첫 분석에서도 순위 조회 칸을 쓰지 않는다(순위 확인용으로도 내지 않고 빼서 이유를 남긴다)
    const first = recommendKeywords({ place });
    assert.equal(first.items.some((item) => /기타서비스/.test(item.term)), false);
    assert.equal(excludedOf(first, '기타서비스').rule, 'label');
    assert.equal(pickRankKeywords(place, first).keywords.some((keyword) => keyword.includes('기타서비스')), false);
    const final = recommendKeywords({ place, ranks: [rank('서교상품A', 5)] });
    assert.equal(final.items.some((item) => item.term === '기타서비스'), false);
    assert.equal(excludedOf(final, '기타서비스').rule, 'label');
    assert.equal(excludedOf(final, '기타서비스').reason, "'기타서비스'는 업종 분류의 큰 갈래 이름일 뿐이고 등록 키워드·상위 매장 키워드·리뷰·메뉴·블로그 어디에도 나오지 않아, 지역을 붙인 키워드로는 권하지 않습니다.");
    // 집합에 들지 않는 업종 이름(자료에 안 나오는 민박·카센터·제모·샌드위치 포함)은 이름표가 아니라 업종으로 추천한다
    for (const category of ['컴퓨터학원', '생선회', '민박', '카센터', '제모', '샌드위치']) {
        const result = recommendKeywords({ place: { ...place, category }, ranks: [rank('서교상품A', 5)] });
        assert.equal(excludedOf(result, category)?.rule === 'label', false, category);
        assert.equal(result.items.some((item) => item.term === category), true, category);
    }
    assert.equal(excludedOf(recommendKeywords({ place: { ...place, reviewMenus: [rv('기타서비스', 10)] }, ranks: [rank('서교상품A', 5)] }), '기타서비스')?.rule === 'label', false);
});

test('s1·s2·F03 조사는 받침에 맞게, 순위 확인용 근거는 검색 행태를 단정하지 않고, 지역을 확인하지 못한 등록 칸도 같은 낱말 칸 수에 센다', () => {
    // s1: "'삼겹살강남역'와" → 받침에 맞게 "과"
    const twin = recommendKeywords({ place: mkPlace({ id: 's1', ...SHOP, name: '시험고깃집', category: '삼겹살', address: '서울 강남구 강남대로 100', jibun: '서울 강남구 역삼동 100', keywords: ['강남삼겹살', '삼겹살강남역'], menus: ['삼겹살'], reviewMenus: [rv('삼겹살', 80)] }) });
    const duplicate = twin.registered.map((entry) => entry.concern).find((concern) => concern?.rule === 'duplicate');
    assert.equal(duplicate.reason, "'삼겹살강남역'은 '강남삼겹살'과 지역·낱말이 같아 대표키워드 칸을 둘 쓰고 있습니다. 한 칸은 다른 낱말이나 지역에 쓸 수 있는지 살펴보세요.");
    // ('역'으로 끝나는 말 뒤에는 "과", 받침이 없는 말 뒤에는 "와")
    const without = recommendKeywords({ place: mkPlace({ id: 's1b', ...SHOP, name: '시험', category: '삼겹살', address: '서울 강남구 강남대로 100', jibun: '서울 강남구 역삼동 100', keywords: ['삼겹살강남', '강남삼겹살'], menus: ['삼겹살'], reviewMenus: [rv('삼겹살', 80)] }) });
    assert.match(without.registered.map((entry) => entry.concern?.reason ?? '').join(' '), /'강남삼겹살'은 '삼겹살강남'과 지역|'삼겹살강남'은 '강남삼겹살'과 지역/);
    // s2: 순위 확인용 낱말의 근거 문구
    const rankOnly = recommendKeywords({ place: RESTAURANT.place, activity: RESTAURANT.activity }).items.find((item) => item.term === '맛집');
    assert.equal(rankOnly.reasons[0].text, '순위 확인용 낱말(대표키워드 등록은 권하지 않음)');
    assert.equal(/흔히 쓰는|검색어/.test(JSON.stringify(rankOnly.reasons)), false);
    // F03: 지역을 확인하지 못한 등록 키워드(광교카센터)도 "카센터"의 한 칸 — 등록 1(unknown) + 등록 1 이면 새 조합이 없다
    const garage = recommendKeywords({ place: mkPlace({ id: 'f03', ...SHOP, name: '시험정비', category: '카센터', keywords: ['광교카센터', '공덕카센터'], menus: ['엔진오일'], reviewMenus: [rv('엔진오일', 40)] }) });
    assert.deepEqual(garage.registered.map((entry) => entry.regionStatus), ['unknown', 'known']);
    assert.equal(garage.items.some((item) => item.term === '카센터'), false);
});

test('naver-place 사진 할 일은 노출 위치를 단정하지 않고 사실로 적는다', () => {
    const photos = (business) => buildActionItems({ ...SALON.place, detail: { ...SALON.place.detail, photos: { business, top: business, visitorMedia: 3 } } }, null, { nowMs: NOW }).find((item) => item.key === 'photos');
    assert.equal(photos(0).detail.endsWith('손님이 매장 화면에서 보는 사진입니다.'), true);
    assert.equal(photos(2).detail.endsWith('손님이 매장 화면에서 보는 사진입니다.'), true);
    assert.equal(/맨 위|검색 목록/.test(`${photos(0).detail}${photos(2).detail}`), false);
});

// ---------------------------------------------------------------------------
// 8차 재채점: 큼 2(K-A 머리 한 글자·K-E 가족 후보) · 보통 4(N1·N2·M5'·M9') · 사소 6(S-1~S-6)
// ---------------------------------------------------------------------------
test('8차 K-A: 머리가 한 글자인 조건 합성어(룸예약)도 조건 낱말이다', () => {
    const result = recommendKeywords({ place: mkPlace({ id: 'k8c', ...SHOP, name: '시험고깃집', category: '삼겹살', keywords: [], menus: ['삼겹살', '목살', '룸예약'], reviewMenus: [rv('삼겹살', 80), rv('룸예약', 20)] }) });
    assert.equal(terms(result).includes('룸예약'), false);
    assert.equal(excludedOf(result, '룸예약').rule, 'attribute');
});

test('8차 K-E: 가족에서 근거가 가장 센 품목은 추천이 안 되어도 묶여 사라지지 않고 후보(family·voice)로 남는다', () => {
    // 칸 상한: 등록 키워드 둘이 "김밥" 두 칸을 다 써서 참치김밥을 추천에 못 올림 → 후보 lacks family, 묶인 줄도 없다
    const gimbap = recommendKeywords({ place: mkPlace({ id: 'k8a', ...SHOP, name: '시험김밥', category: '김밥', keywords: ['공덕김밥', '마포김밥'], menus: ['참치김밥', '치즈김밥', '꼬마김밥'], reviewMenus: [rv('참치김밥', 90), rv('치즈김밥', 60), rv('꼬마김밥', 40)] }) });
    const tuna = gimbap.candidates.find((item) => item.term === '참치김밥');
    assert.deepEqual([tuna.lacks, tuna.why], ['family', "리뷰 90회로 '김밥' 가운데 가장 많이 말해진 메뉴이지만, '김밥'이 든 키워드를 이미 두 칸 쓰고 있어 추천에 넣지 않았습니다. 한 칸을 이 메뉴로 바꿀지 직접 판단하세요."]);
    assert.equal(terms(gimbap).includes('참치김밥'), false);
    assert.equal(excludedOf(gimbap, '참치김밥'), undefined);
    assert.equal(gimbap.confirmedTerms.includes('참치김밥'), false);
    // S-5: 등록할 수 있는 추천이 없고 순위 확인용 칩(맛집)만 남아도 까닭을 남긴다
    assert.deepEqual(gimbap.items.map((item) => [item.term, item.registrable !== false]), [['맛집', false]]);
    assert.equal(gimbap.emptyReason, 'enough');
    // 손님 쪽 확인이 없으면(예약 품목에만 있음) 묶이지 않고 후보 voice, 같은 가족의 다른 품목은 묶는다(가족 이름이 앞에 오는 품목도 같다: 속눈썹펌·속눈썹연장)
    const lash = (reviewMenus) => recommendKeywords({ place: mkPlace({ id: 'k8b', ...SHOP, name: '시험속눈썹', category: '속눈썹', keywords: ['공덕속눈썹'], styles: [st('속눈썹펌', 80), st('속눈썹연장', 60)], reviewMenus }) });
    const alone = lash([]);
    assert.deepEqual(alone.candidates.map((item) => [item.term, item.lacks]), [['속눈썹펌', 'voice']]);
    assert.equal(excludedOf(alone, '속눈썹연장').rule, 'merged');
    // 손님 쪽 근거(리뷰 "속눈썹")가 있으면 가족 pick 으로 추천된다
    assert.equal(lash([rv('속눈썹', 30)]).items.some((item) => item.keyword === '공덕속눈썹펌'), true);
});

test('8차 N1: 가족에서 고를 때는 가족 이름으로 끝나는 품목만 — 리뷰 1위여도 곁들임(치킨무)은 가족이 아니다', () => {
    const chicken = recommendKeywords({
        place: mkPlace({ id: 'n1', ...SHOP, name: '시험치킨', category: '치킨', keywords: ['공덕치킨'], menus: ['양념치킨', '후라이드치킨', '치킨무', '콜라'], reviewMenus: [rv('치킨무', 120), rv('양념치킨', 90), rv('후라이드치킨', 70), rv('콜라', 10)] }),
    });
    const pick = chicken.items.find((item) => item.keyword === '공덕양념치킨');
    // 치킨무(120회)가 리뷰는 더 많지만 치킨 메뉴가 아니라 구성원에서 빠진다 — 그래서 "가장 많은 메뉴"라고 순위를 말하지 않고 구체 메뉴라고만 적는다(9차 K-E: 사실일 때만)
    assert.deepEqual(pick.reasons.at(-1), { kind: 'note', text: "'치킨'의 구체 메뉴(리뷰 90회)" });
    assert.equal(chicken.items.some((item) => item.term === '치킨무'), false);
});

test('8차 N2: 메뉴판 한 줄 품목을 상위 매장 둘 이상이 그대로 등록했으면 추천이 되고, 한 곳뿐이면 후보로 남는다(거짓 문장 없음)', () => {
    const cafe = (rivals) => recommendKeywords({
        place: mkPlace({ id: 'n2', ...SHOP, name: '시험카페', category: '카페', menus: ['아인슈페너', '아메리카노', '카페라떼', '크로플'], reviewMenus: [rv('아메리카노', 90), rv('카페라떼', 60), rv('크로플', 30)] }),
        rivals,
    });
    const two = cafe([rival(1, '시험A', ['공덕아인슈페너']), rival(2, '시험B', ['마포아인슈페너'])]);
    assert.equal(two.items.find((item) => item.term === '아인슈페너')?.confirmedBy, 'menu');
    assert.equal(two.candidates.some((item) => item.term === '아인슈페너'), false);
    const one = cafe([rival(1, '시험A', ['공덕아인슈페너'])]);
    assert.equal(one.candidates.find((item) => item.term === '아인슈페너').lacks, 'voice');
});

test("8차 M5'·S-1: 상호 끝의 동네 이름이 키워드의 앞말이면 지역 없음이 아니고, 이 매장 자료 어디에도 없는 경쟁 상호는 unrelated 로 순위 조회에서 뺀다", () => {
    const status = (place) => registeredOf(recommendKeywords({ place }), place.keywords[0]).regionStatus;
    assert.equal(status(mkPlace({ id: 'm5p', ...SHOP, name: '코어 필라테스 압구정', category: '필라테스', keywords: ['압구정필라테스'], menus: ['필라테스'], reviewMenus: [rv('필라테스', 50)] })), 'unknown');
    assert.equal(status(mkPlace({ id: 'm5q', ...SHOP, name: '모던 헤어 가로수길', category: '미용실', keywords: ['가로수길미용실'], menus: ['커트'], reviewMenus: [rv('커트', 50)] })), 'unknown');
    // 업종 낱말·상호 전체는 그대로 지역 없음
    assert.equal(status(mkPlace({ id: 'm5r', ...SHOP, name: '믿음카센터', category: '카센터', keywords: ['카센터'], menus: ['엔진오일'], reviewMenus: [rv('엔진오일', 40)] })), 'none');
    const place = mkPlace({ id: 's1', ...SHOP, name: '시험카페', category: '카페', keywords: ['스타벅스', '이디야커피', '메가커피', '컴포즈커피'], menus: ['아메리카노', '카페라떼', '크로플'], reviewMenus: [rv('아메리카노', 90), rv('카페라떼', 60), rv('크로플', 30)] });
    const result = recommendKeywords({ place });
    assert.deepEqual(result.registered.map((entry) => [entry.keyword, entry.regionStatus, entry.concern?.rule]), ['스타벅스', '이디야커피', '메가커피', '컴포즈커피'].map((keyword) => [keyword, 'unknown', 'unrelated']));
    assert.deepEqual(pickRankKeywords(place, result).skipped, ['스타벅스', '이디야커피', '메가커피', '컴포즈커피']);
    // 끝말이 이 매장 메뉴에 있으면("홍대쌀국수"의 쌀국수) 아는 말이다
    const noodle = mkPlace({ id: 's1b', ...SHOP, name: '아시안키친', category: '아시아음식', keywords: ['홍대쌀국수'], menus: ['쌀국수', '분짜'], reviewMenus: [rv('쌀국수', 100), rv('분짜', 60)] });
    assert.equal(registeredOf(recommendKeywords({ place: noodle }), '홍대쌀국수').concern, null);
});

test("8차 M9': 리뷰 비중이 큰 메뉴(내장국밥·쌀국수)는 다른 업종 메뉴라며 빼지 않는다", () => {
    const soup = recommendKeywords({
        place: mkPlace({ id: 'm9s', ...SHOP, name: '시장순대국', category: '순대,순대국', keywords: ['공덕순대국'], menus: ['순대국', '내장국밥', '수육', '모듬순대'], reviewMenus: [rv('순대국', 120), rv('내장국밥', 70), rv('수육', 40), rv('모듬순대', 30)] }),
    });
    assert.equal(soup.items.find((item) => item.term === '내장국밥')?.confirmedBy, 'menu');
    assert.equal(excludedOf(soup, '내장국밥'), undefined);
    const asia = recommendKeywords({
        place: mkPlace({ id: 'm9a', ...SHOP, name: '아시안키친', category: '아시아음식', keywords: ['홍대쌀국수'], menus: ['쌀국수', '분짜', '반미', '팟타이', '월남쌈', '공기밥'], reviewMenus: [rv('쌀국수', 100), rv('분짜', 60), rv('팟타이', 50), rv('반미', 40), rv('월남쌈', 30)] }),
    });
    assert.equal(asia.items.find((item) => item.term === '쌀국수')?.confirmedBy, 'menu');
    assert.equal(excludedOf(asia, '쌀국수'), undefined);
});

test('8차 S-2: 메뉴판 한 줄 품목이 관문에 걸리면 이유와 함께 excluded 에 남고, 같은 이유는 한 줄로 묶는다', () => {
    const noodle = recommendKeywords({ place: mkPlace({ id: 's2', ...SHOP, name: '손맛칼국수', category: '칼국수', menus: ['들깨칼국수', '바지락칼국수', '보쌈', '수육', '만두', '김치전', '수제비'] }) });
    assert.deepEqual(['보쌈', '만두'].map((word) => excludedOf(noodle, word).rule), ['otherBusiness', 'otherBusiness']);
    // 메뉴판 한 줄 품목에서만 온 줄은 board: true 로 표시한다(손님이 찾는다는 자료가 없는 낱말 — 소비하는 쪽이 따로 다룰 수 있게)
    assert.deepEqual(['보쌈', '만두'].map((word) => excludedOf(noodle, word).board), [true, true]);
    const restaurant = recommendKeywords({ place: RESTAURANT.place, activity: RESTAURANT.activity }).excluded;
    assert.equal(restaurant.filter((entry) => entry.board).length > 0, true);
    // board 는 메뉴판 한 줄에서만 나온 말(손님 쪽 근거 없음)일 때만: 리뷰에도 나온 '칼국수'(리뷰 4회)·결제 인기 메뉴에 나온 해물돌판짜파게티는 board 가 아니고 "쓰기 좋은 곳"이 붙는다
    for (const entry of restaurant) assert.equal(entry.board === true, Boolean(entry.words) && !entry.popular && !entry.useIn && ['손만두', '캐비아', '고노와다', '얼큰해장라면', '매운탕'].includes(entry.term), entry.term);
    assert.equal(restaurant.find((entry) => entry.term === '칼국수').board, undefined);
    assert.deepEqual(restaurant.find((entry) => entry.term === '칼국수').words, ['칼국수', '조개칼국수']);
    assert.equal(Boolean(restaurant.find((entry) => entry.term === '칼국수').useIn), true);
    assert.equal(restaurant.find((entry) => entry.term === '해물돌판짜파게티').board, undefined);
    assert.equal(restaurant.find((entry) => entry.term === '캐비아').words.includes('해물돌판짜파게티'), false);
    assert.equal(recommendKeywords({ place: PHARMACY.place, activity: PHARMACY.activity }).excluded.some((entry) => entry.board), false);
    const side = excludedOf(noodle, '수육');
    assert.equal(side.rule, 'offMain');
    assert.equal(['수육', '김치전', '수제비'].every((word) => side.words.includes(word)), true);
    // 후보(들깨칼국수·바지락칼국수)와 겹치지 않는다
    assert.equal(noodle.candidates.some((item) => ['보쌈', '만두', '수육', '김치전', '수제비'].includes(item.term)), false);
});

test('8차 S-5: 등록할 수 있는 추천이 하나도 없고 순위 확인용 칩만 있어도 emptyReason 이 남는다', () => {
    const bare = recommendKeywords({ place: mkPlace({ id: 's5', ...SHOP, name: '시험식당', category: '한식', menus: [], reviewMenus: [] }) });
    assert.deepEqual(bare.items.map((item) => item.registrable), [false]);
    assert.equal(bare.emptyReason, 'noData');
});

test('8차 관찰 ①: 메뉴판 줄이 모두 꼬리말이 붙은 꼴이어도 손님이 메뉴로 말하는 낱말(리뷰 메뉴·상위 매장 둘 이상 등록)은 prefix 로 걸지 않는다', () => {
    const stew = ['부대찌개 점심특선 1호', '부대찌개 세트A 2호', '부대찌개 3인 3호', '김치찌개', '된장찌개'];
    const shop = (reviewMenus, rivals = []) => recommendKeywords({ place: mkPlace({ id: 'o1', ...SHOP, name: '시험한식', category: '한식', keywords: [], menus: stew, reviewMenus }), rivals });
    assert.equal(shop([rv('부대찌개', 191), rv('김치찌개', 50)]).items.some((item) => item.term === '부대찌개'), true);
    assert.equal(shop([rv('김치찌개', 50)], [rival(1, '시험A', ['공덕부대찌개']), rival(2, '시험B', ['마포부대찌개'])]).items.some((item) => item.term === '부대찌개'), true);
    // 손님 쪽 근거가 없는 앞말(지명·꾸밈)은 그대로 걸린다
    const none = shop([rv('김치찌개', 50)]);
    assert.equal(none.items.some((item) => item.term === '부대찌개'), false);
    assert.equal(excludedOf(none, '부대찌개').rule, 'prefix');
});

test('8차 관찰 ②: "A + B" 꼴 메뉴판 줄에서는 앞의 A 만 한 줄 품목 후보가 되고, 곁 낱말 B 는 다른 줄의 품목이거나 손님 쪽 근거가 있을 때만 낱말이 된다', () => {
    const shop = (menus, reviewMenus) => recommendKeywords({ place: mkPlace({ id: 'o2', ...SHOP, name: '시험횟집', category: '횟집', keywords: [], menus, reviewMenus }) });
    const alone = shop(['자연산 돌돔회 + 미역국', '자연산 붉바리회 + 카르파쵸', '쥐치회', '모둠회(광어+우럭)', '미역국', '대방어 1+1'], [rv('광어', 60), rv('쥐치회', 20)]);
    const names = [...alone.candidates.map((item) => item.term), ...terms(alone)];
    // 돌돔회·붉바리회(A)는 후보, 카르파쵸(B, 다른 줄에도 리뷰에도 없음)는 낱말이 아니다. 미역국은 따로 한 줄이 있어 낱말이다
    assert.equal(names.includes('돌돔회') && names.includes('붉바리회'), true);
    assert.equal(names.includes('카르파쵸'), false);
    assert.equal(names.includes('미역국'), true);
    // 괄호 안의 "광어+우럭"과 "1+1"은 줄을 가르지 않는다(모둠회·대방어가 머리)
    assert.equal(names.includes('모둠회'), true);
    assert.equal(names.includes('우럭'), false);
    // 곁 낱말이 리뷰에 나오면 낱말이다
    const reviewed = shop(['자연산 돌돔회 + 미역국', '자연산 붉바리회 + 카르파쵸'], [rv('광어', 60), rv('카르파쵸', 20)]);
    assert.equal(reviewed.items.some((item) => item.term === '카르파쵸'), true);
});

// ---------------------------------------------------------------------------
// 9차 재채점: 큼 2(K-E 가족 pick 대상·문장, K-A 요금·절차 닫힌 부류) · 보통 3(N2·N-E·N-L) · 사소 1(N-U)
// ---------------------------------------------------------------------------
test('9차 K-E: 가족의 구성원은 가족 이름으로 끝나거나 조리·차림 끝말이 붙은 품목이다 — 리뷰 1위(갈비탕·돈가스정식·메밀국수·참치스페셜)가 pick, 곁들임(치킨무)만 빠진다', () => {
    const shop = (p) => recommendKeywords({ place: mkPlace({ id: 'k9', ...SHOP, ...p }) });
    const noteOf = (result, keyword) => result.items.find((item) => item.keyword === keyword)?.reasons.at(-1)?.text;
    // 등록 "갈비": 갈비탕 120 > 갈비찜 100 > 양념갈비 50 — 가장 센 갈비탕이 pick, 나머지는 묶인다. "가장 많은 메뉴"는 사실이다
    const galbi = shop({ name: '시험갈비', category: '갈비', keywords: ['공덕갈비'], menus: ['갈비탕', '갈비찜', '양념갈비', '냉면'], reviewMenus: [rv('갈비탕', 120), rv('갈비찜', 100), rv('양념갈비', 50), rv('냉면', 20)] });
    assert.equal(noteOf(galbi, '마포갈비탕') ?? noteOf(galbi, '공덕갈비탕'), "'갈비' 가운데 리뷰가 가장 많은 메뉴");
    assert.deepEqual(['갈비찜', '양념갈비'].map((word) => excludedOf(galbi, word)?.rule), ['merged', 'merged']);
    // 돈가스정식(정식 = 차림 끝말) 110 > 치즈돈가스 40
    const katsu = shop({ name: '시험돈가스', category: '돈가스', keywords: ['공덕돈가스'], menus: ['돈가스정식', '치즈돈가스', '우동'], reviewMenus: [rv('돈가스정식', 110), rv('치즈돈가스', 40), rv('우동', 20)] });
    assert.equal(terms(katsu).includes('돈가스정식'), true);
    assert.equal(noteOf(katsu, '마포돈가스정식') ?? noteOf(katsu, '공덕돈가스정식'), "'돈가스' 가운데 리뷰가 가장 많은 메뉴");
    // 두 낱말(메밀·국수)이 한 품목(메밀국수)을 다퉈도 사라지지 않는다 — 등록 낱말이 먼저 가져가고, 가져간 품목은 어느 낱말에도 묶이지 않는다
    const buckwheat = shop({ name: '시험메밀', category: '국수,메밀', keywords: ['공덕메밀'], menus: ['메밀국수', '메밀전', '수육'], reviewMenus: [rv('메밀국수', 100), rv('메밀전', 30), rv('수육', 20)] });
    assert.equal(terms(buckwheat).includes('메밀국수'), true);
    assert.equal(excludedOf(buckwheat, '메밀국수'), undefined);
    // 차림·꾸밈 끝말(스페셜)도 구성원 — 참치스페셜 70 이 pick
    const tuna = shop({ name: '시험참치', category: '참치회', keywords: ['공덕참치'], menus: ['참치회', '참치스페셜', '참치회덮밥'], reviewMenus: [rv('참치스페셜', 70), rv('참치회', 60), rv('참치회덮밥', 30)] });
    assert.equal(terms(tuna).includes('참치스페셜'), true);
    // 낱말 둘이 한 가족이어도(참치회 업종 + 등록 참치) 가족 칸은 함께 센다: 등록이 두 칸이면 pick 도 칸이 없어 후보(family)로 남고, 더 센 메뉴(참치스페셜 70)가 있으면 "구체 메뉴"라고만 적는다
    const tunaFull = shop({ name: '시험참치', category: '참치회', keywords: ['공덕참치', '마포참치'], menus: ['참치회', '참치스페셜', '참치회덮밥'], reviewMenus: [rv('참치스페셜', 70), rv('참치회', 60), rv('참치회덮밥', 30)] });
    assert.deepEqual(tunaFull.candidates.filter((item) => item.lacks === 'family').map((item) => item.term).sort(), ['참치스페셜', '참치회덮밥']);
    assert.equal(tunaFull.candidates.find((item) => item.term === '참치회덮밥').why, "리뷰 30회로 '참치'의 구체 메뉴이지만, '참치'가 든 키워드를 이미 두 칸 쓰고 있어 추천에 넣지 않았습니다. 한 칸을 이 메뉴로 바꿀지 직접 판단하세요.");
    // 사실이 아니면 쓰지 않는다: 업종 낱말(순대국)이 더 많이 말해졌으면 순위를 말하지 않고 구체 메뉴라고만 적는다
    const sundae = shop({ name: '시험순대', category: '순대,순대국', keywords: ['공덕순대'], menus: ['순대국', '모듬순대', '수육'], reviewMenus: [rv('순대국', 100), rv('모듬순대', 70), rv('수육', 20)] });
    const sundaePick = sundae.items.find((item) => item.term === '모듬순대');
    assert.deepEqual(sundaePick.reasons.at(-1), { kind: 'note', text: "'순대'의 구체 메뉴(리뷰 70회)" });
    // 이 규칙으로 구성원에서 빠진 품목도 흔적 없이 사라지지 않는다(곁들임 치킨무는 묶인 줄이 남는다)
    const chicken = shop({ name: '시험치킨', category: '치킨', keywords: ['공덕치킨'], menus: ['양념치킨', '치킨무'], reviewMenus: [rv('치킨무', 120), rv('양념치킨', 90)] });
    assert.equal(chicken.items.some((item) => item.term === '치킨무'), false);
    assert.equal(chicken.items.some((item) => item.term === '양념치킨'), true);
});

test('9차 K-A: 요금·이용권·절차 이름(닫힌 부류)은 메뉴판과 리뷰 칩에 둘 다 있어도 추천하지 않고 이유와 함께 뺀다', () => {
    const shop = (words) => recommendKeywords({
        place: mkPlace({ id: 'ka9', ...SHOP, name: '시험학원', category: '학원,수학', keywords: [], menus: ['중등수학', '고등수학', ...words], reviewMenus: [rv('고등수학', 60), rv('중등수학', 50), ...words.map((word) => rv(word, 40))] }),
    });
    const fees = ['교재비', '레슨비', '재료비', '월권', '10회권', '월회원권', '체험권', '식대', '예약금', '추가시간', '체크인', '재방문', '레벨테스트', '셔틀버스', '방문견적', '당일배송', '리뷰이벤트치킨', '무료상담'];
    // (리뷰 칩은 상위 여덟 개까지만 낱말이 되므로 여섯 개씩 나눠 본다)
    for (let at = 0; at < fees.length; at += 6) {
        const result = shop(fees.slice(at, at + 6));
        for (const word of fees.slice(at, at + 6)) {
            assert.equal(terms(result).includes(word), false, word);
            assert.equal(excludedOf(result, word)?.rule, 'attribute', word);
        }
    }
    assert.equal(excludedOf(shop(['교재비']), '교재비').reason, "'교재비'는 요금·이용권·절차·판촉을 말하는 낱말이라, 지역을 붙여도 찾을 가게 종류나 메뉴가 아닙니다.");
    // 진짜 메뉴·업종은 걸리지 않는다: 머리말이 맞을 때만 걸린다(갈비·음료·식권·셔틀콕·룸카페·포장마차·단체복)
    const real = ['갈비', '음료', '식권', '셔틀콕', '룸카페', '포장마차', '단체복', '자전거수리', '상담센터'];
    for (let at = 0; at < real.length; at += 6) {
        const ok = shop(real.slice(at, at + 6));
        for (const word of real.slice(at, at + 6)) assert.equal(excludedOf(ok, word)?.rule === 'attribute', false, word);
    }
    // 업종에 든 낱말은 그대로: 주차장·룸카페·포장마차(업종) · 방문요양·출장마사지(나머지가 업종) · 할인마트(업종)
    const own = (category, name, word) => recommendKeywords({ place: mkPlace({ id: 'ka9o', ...SHOP, name, category, keywords: [], menus: [word, '기본'], reviewMenus: [rv(word, 60), rv('기본', 30)] }) });
    for (const [category, name, word] of [['주차장', '역앞 주차장', '주차장'], ['룸카페', '아지트 룸카페', '룸카페'], ['포장마차', '길목 포장마차', '포장마차'], ['방문요양', '사랑 방문요양센터', '방문요양'], ['마사지', '손맛 출장마사지', '출장마사지'], ['할인마트', '믿음 할인마트', '할인마트']]) {
        assert.equal(excludedOf(own(category, name, word), word)?.rule === 'attribute', false, `${category} ${word}`);
    }
    // 메뉴판 한 줄 + 상위 2곳 등록 경로에서도 똑같이 걸린다(Q23 방문견적)
    const moving = recommendKeywords({
        place: mkPlace({ id: 'ka9m', ...SHOP, name: '튼튼이사', category: '이사', keywords: [], menus: ['포장이사', '원룸이사', '방문견적'], reviewMenus: [rv('포장이사', 60), rv('원룸이사', 40)] }),
        rivals: [rival(1, '시험이사A', ['공덕방문견적']), rival(2, '시험이사B', ['마포방문견적'])],
    });
    assert.equal(terms(moving).includes('방문견적'), false);
    assert.equal(excludedOf(moving, '방문견적')?.rule, 'attribute');
});

test('9차 K-A ③: 조건어가 앞에 붙은 합성어는 앞의 조건어를 짚어 이유를 말하고, 나머지가 이 매장 업종 낱말에 들어 있거나 업종 낱말을 품으면(출장수리·출장세차·출장뷔페) 걸리지 않는다', () => {
    const shop = (category, name, word, others = ['기본']) => recommendKeywords({
        place: mkPlace({ id: 'ka9l', ...SHOP, name, category, keywords: [], menus: [word, ...others], reviewMenus: [rv(word, 60), ...others.map((other) => rv(other, 30))] }),
    });
    // 업종이 아닌 매장에서는 걸리고, 이유는 앞의 조건어를 짚는다(요금·이용권 문장이 아님)
    const reasons = {
        셔틀버스: "'셔틀버스'는 앞의 '셔틀'이 서비스를 받는 방식을 말하는 말이라, 지역을 붙여도 어떤 가게인지 알 수 없습니다.",
        출장점검: "'출장점검'은 앞의 '출장'이 서비스를 받는 방식을 말하는 말이라, 지역을 붙여도 어떤 가게인지 알 수 없습니다.",
        방문견적: "'방문견적'은 앞의 '방문'이 서비스를 받는 방식을 말하는 말이라, 지역을 붙여도 어떤 가게인지 알 수 없습니다.",
        당일배송: "'당일배송'은 앞의 '당일'이 서비스를 받는 방식을 말하는 말이라, 지역을 붙여도 어떤 가게인지 알 수 없습니다.",
    };
    for (const [word, reason] of Object.entries(reasons)) {
        const result = shop('한식', '시험식당', word);
        assert.equal(terms(result).includes(word), false, word);
        assert.deepEqual([excludedOf(result, word)?.rule, excludedOf(result, word)?.reason], ['attribute', reason], word);
    }
    // 요금·이용권 이름은 예전 문장 그대로
    assert.equal(excludedOf(shop('한식', '시험식당', '교재비'), '교재비').reason, "'교재비'는 요금·이용권·절차·판촉을 말하는 낱말이라, 지역을 붙여도 찾을 가게 종류나 메뉴가 아닙니다.");
    // 같은 낱말이라도 나머지가 이 매장의 업종 낱말에 들어 있거나 업종 낱말을 품으면 업종·품목 이름이라 걸리지 않는다
    for (const [category, name, word] of [['컴퓨터수리', '믿음컴퓨터수리점', '출장수리'], ['세차장', '반짝세차장', '출장세차'], ['뷔페', '푸짐뷔페', '출장뷔페'], ['자전거수리', '바퀴자전거수리점', '출장수리']]) {
        const result = shop(category, name, word);
        assert.equal(excludedOf(result, word)?.rule === 'attribute', false, `${category} ${word}`);
        assert.equal(terms(result).includes(word) || candidateTerms(result).includes(word), true, `${category} ${word}`);
    }
    // 업종과 상관없는 매장에서는 같은 낱말도 걸린다(출장수리 ← 한식집)
    assert.equal(excludedOf(shop('한식', '시험식당', '출장수리'), '출장수리')?.rule, 'attribute');
});

test('9차 N2: 상위 매장 둘 이상이 그대로 등록한 품목은 등록·업종 낱말에 묶이더라도 사라지지 않고 후보(family)로 남는다', () => {
    const noodle = (rivals) => recommendKeywords({
        place: mkPlace({ id: 'n29', ...SHOP, name: '시험칼국수', category: '칼국수', keywords: ['공덕칼국수'], menus: ['들깨칼국수', '바지락칼국수', '만두', '수제비'], reviewMenus: [rv('바지락칼국수', 80), rv('만두', 30)] }),
        rivals,
    });
    const two = noodle([rival(1, '시험A', ['공덕들깨칼국수']), rival(2, '시험B', ['마포들깨칼국수'])]);
    const kept = two.candidates.find((item) => item.term === '들깨칼국수');
    assert.deepEqual([kept.lacks, kept.why], ['family', "상위 2곳이 '들깨칼국수'를 등록했지만, '칼국수'가 들어 있는 말이라 '칼국수' 하나로 묶었습니다. 이 메뉴를 따로 권할지 직접 판단하세요."]);
    assert.equal(excludedOf(two, '들깨칼국수'), undefined);
    assert.equal(terms(two).includes('들깨칼국수'), false);
    // 한 곳만 등록했으면 후보 voice(예전과 같음)
    assert.equal(noodle([rival(1, '시험A', ['공덕들깨칼국수'])]).candidates.find((item) => item.term === '들깨칼국수').lacks, 'voice');
});

test('9차 N-E: 영어 두 낱말 이상 메뉴(Iced Americano)도 같은 이름의 리뷰 칩과 확인되고, 영어 크기 말(Large)은 품목 이름이 아니다', () => {
    const cafe = recommendKeywords({
        place: mkPlace({ id: 'ne9', ...SHOP, name: 'Maple Roasters', category: '카페,디저트', keywords: ['공덕카페'], menus: ['Iced Americano', 'Cafe Latte', 'Affogato', 'Cold Brew Large'], reviewMenus: [rv('Iced Americano', 80), rv('Cafe Latte', 50), rv('Affogato', 40), rv('Cold Brew Large', 30)] }),
    });
    for (const word of ['IcedAmericano', 'CafeLatte', 'Affogato']) assert.equal(cafe.items.find((item) => item.term === word)?.confirmedBy, 'menu', word);
    assert.equal(cafe.candidates.some((item) => /^(IcedAmericano|CafeLatte|Affogato)$/.test(item.term)), false);
    assert.equal([...cafe.items, ...cafe.candidates].some((item) => /large/i.test(item.term)), false);
    assert.equal(terms(cafe).includes('ColdBrew'), true);
});

test('9차 N-L: 업종 대분류 이름(교육·학문·스포츠·레저·자동차·교통…)은 자료에 안 나오면 이름표로 빼고, 자료에 나오면 업종으로 둔다', () => {
    const shop = (category, extra = {}) => recommendKeywords({ place: mkPlace({ id: 'nl9', ...SHOP, name: '명문수학 대치', category, keywords: [], menus: ['중등수학', '고등수학'], reviewMenus: [rv('고등수학', 60)], ...extra }) });
    const edu = shop('교육,학문');
    for (const word of ['교육', '학문']) {
        assert.equal(excludedOf(edu, word)?.rule, 'label', word);
        assert.equal(edu.items.some((item) => item.term === word), false, word);
    }
    for (const [category, word] of [['스포츠,레저', '레저'], ['자동차,교통', '교통']]) assert.equal(excludedOf(shop(category), word)?.rule, 'label', word);
    // 메뉴판·리뷰에 나오면 가게 종류를 말하는 이름이라 업종으로 둔다
    assert.equal(excludedOf(shop('교육,학문', { menus: ['중등수학', '고등수학', '입시교육'] }), '교육')?.rule === 'label', false);
});

test('9차 N-U: "앞말 + 가게 종류 꼬리"(수학학원·수영장)는 앞말이 이 매장 자료에 있으면 unrelated 가 아니다 — 자료에 없는 경쟁 상호는 그대로', () => {
    const study = recommendKeywords({ place: mkPlace({ id: 'nu9', ...SHOP, name: '명문수학 대치', category: '교육,학문', keywords: ['대치수학학원'], menus: ['중등수학', '고등수학'], reviewMenus: [rv('고등수학', 60)] }) });
    assert.equal(registeredOf(study, '대치수학학원').concern?.rule === 'unrelated', false);
    const pool = recommendKeywords({ place: mkPlace({ id: 'nu9b', ...SHOP, name: '아쿠아센터', category: '스포츠,레저', keywords: ['공덕수영장'], menus: ['자유수영', '수영강습'], reviewMenus: [rv('수영강습', 60)] }) });
    assert.equal(registeredOf(pool, '공덕수영장').concern?.rule === 'unrelated', false);
    const rival9 = recommendKeywords({ place: mkPlace({ id: 'nu9c', ...SHOP, name: '시험카페', category: '카페', keywords: ['스타벅스'], menus: ['아메리카노', '카페라떼'], reviewMenus: [rv('아메리카노', 60)] }) });
    assert.equal(registeredOf(rival9, '스타벅스').concern?.rule, 'unrelated');
});

test('시험 도구 확인: 순위 줄 도우미와 예약 스타일 도우미가 6차 입력과 같은 모양을 만든다', () => {
    assert.deepEqual([rank('은평미용실', 55).state, st('커트', 3)], ['done', { name: '커트', count: 3 }]);
});
