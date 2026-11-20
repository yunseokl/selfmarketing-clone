import test from 'node:test';
import assert from 'node:assert/strict';
import { healthKind, notApplicableOf, hasNotApplicable } from '../lib/place-industry.js';
import { analyzeGeoAeo, buildFanout } from '../lib/place-geo.js';
import { buildActionItems } from '../lib/naver-place.js';
import { familyOf, recommendKeywords, regionTerms } from '../lib/place-keywords.js';
import { buildPlaceGraph } from '../lib/place-graph.js';
import { PHARMACY, RESTAURANT, SALON, NOW, graphInput } from './place-graph.fixtures.mjs';

// 업종 때문에 해당하지 않는 진단 항목(병의원의 새소식·쿠폰, 약국의 쿠폰·할인·예약)을 점수·질문표·할 일·체크리스트에서 빼는 것을 지킵니다.
// 근거: 네이버 스마트플레이스 공식 도움말(병원 업종은 새소식·쿠폰 기능 없음), 약사법 시행규칙 제44조(약국의 경품·부당한 손님 유인 제한).
// 시험용 병의원은 미용실 견본(SALON)의 업종·이름만 바꿔 만든 가짜 매장입니다.

const clinic = () => ({ ...SALON.place, name: '시험치과의원', category: '치과', keywords: ['서초치과'] });
const analyze = (place, sample) => analyzeGeoAeo({ place, activity: sample.activity, ranks: sample.ranks ?? null, nowMs: NOW });
const ids = (list) => list.map((item) => item.id ?? item.key);

test('업종 판정: 병의원·약국만 해당 없는 항목이 있고, 음식점·미용실·동물병원은 없다', () => {
    const none = { feed: null, coupon: null, booking: null };
    for (const category of ['한식', '미용실', '남성전문미용실', '카페', '네일샵', '동물병원', '펜션', '학원']) assert.deepEqual(notApplicableOf({ category }), none, category);
    for (const category of ['치과', '한의원', '내과', '정형외과', '피부과', '의원', '병원']) {
        const result = notApplicableOf({ category });
        assert.deepEqual([result.feed, result.coupon, result.booking], ['병의원은 네이버가 새소식 기능을 제공하지 않습니다.', '병의원은 네이버가 쿠폰 기능을 제공하지 않습니다.', null], category);
    }
    const pharmacy = notApplicableOf({ category: '약국' });
    assert.deepEqual([pharmacy.feed, Boolean(pharmacy.coupon), Boolean(pharmacy.booking)], [null, true, true]);
    // 이유는 단정하지 않는다("제한될 수 있어 권하지 않습니다", "확인되지 않아")
    assert.match(pharmacy.coupon, /약사법 시행규칙상 경품·할인으로 손님을 끄는 일이 제한될 수 있어 쿠폰·할인 혜택을 권하지 않습니다\.$/);
    assert.match(pharmacy.booking, /확인되지 않아/);
    assert.equal(hasNotApplicable({ category: '약국' }), true);
    assert.equal(hasNotApplicable({ category: '한식' }), false);
    assert.deepEqual(notApplicableOf(null), none);
});

test('업종을 가르는 말이 place-keywords 의 업종 묶음(familyOf)과 어긋나지 않는다', () => {
    const kindOf = (key) => (['pharmacy', 'clinic', 'pet'].includes(key) ? key : null);
    for (const category of ['약국', '치과', '한의원', '내과', '정형외과', '피부과', '소아청소년과', '동물병원', '애견미용', '한식', '미용실', '카페', '네일샵', '꽃집', '학원', '헬스장', '펜션']) {
        assert.equal(healthKind({ category }), kindOf(familyOf({ category })?.key), category);
    }
});

test('약국: 쿠폰·할인과 예약은 점수·질문표·할 일·체크리스트에서 빠지고, 이유가 필드로 남는다', () => {
    const result = analyze(PHARMACY.place, PHARMACY);
    const reasons = notApplicableOf(PHARMACY.place);
    assert.deepEqual(result.notApplicable, reasons);
    // 질문표: 예약·쿠폰 질문은 확인 불가와 같은 취급(status 'unknown')이고 notApplicable 에 이유가 있다. 답이 없는 질문 수에도 안 센다
    const fanout = Object.fromEntries(result.fanout.map((item) => [item.key, item]));
    for (const key of ['booking', 'payment']) {
        assert.equal(fanout[key].status, 'unknown', key);
        assert.equal(typeof fanout[key].notApplicable, 'string', key);
    }
    assert.equal(fanout.booking.notApplicable, reasons.booking);
    assert.equal(fanout.payment.notApplicable, reasons.coupon);
    assert.equal(result.fanout.filter((item) => item.notApplicable).length, 2);
    assert.equal(result.coverage.known, 6);
    // 점수: 네이버 AI·쿠폰 항목은 쿠폰이 빠지고(업종상 브리핑도 없음) 확인 불가가 된다
    const naverAi = result.geo.factors.find((factor) => factor.key === 'naverAi');
    assert.deepEqual([naverAi.pct, naverAi.notApplicable.map((entry) => entry.key)], [null, ['coupon']]);
    assert.equal(naverAi.notApplicable[0].reason, reasons.coupon);
    assert.match(naverAi.evidence, /쿠폰: 이 업종에는 해당 없음/);
    // 약국 견본의 점수: GEO 53 → 55, AEO 31 → 34 (쿠폰·예약 항목을 감점에서 뺀 만큼)
    assert.deepEqual([result.geo.score, result.aeo.score], [55, 34]);
    // 후속 질문 대비(가격·예약·문의) 항목도 예약 점수(5점)를 만점에서 뺀다
    const multiturn = result.aeo.factors.find((factor) => factor.key === 'multiturn');
    assert.deepEqual([multiturn.fullWeight, multiturn.weight, multiturn.notApplicable.map((entry) => entry.key)], [15, 10, ['booking']]);
    // 이미 네이버 예약을 쓰는 약국은 가능하다는 것이 확인된 것이라 예약 항목을 그대로 센다
    const booked = { ...PHARMACY.place, detail: { ...PHARMACY.place.detail, hasBooking: true } };
    assert.equal(notApplicableOf(booked).booking, null);
    assert.equal(notApplicableOf(booked).coupon !== null, true);
    assert.equal(analyze(booked, PHARMACY).fanout.find((item) => item.key === 'booking').notApplicable, undefined);
    // 할 일·체크리스트·로드맵에 쿠폰·예약이 없다. 소식은 약국에서 막혀 있다고 확인되지 않아 그대로다
    assert.equal(ids(result.actions).some((id) => ['coupon', 'booking'].includes(id)), false);
    assert.equal(ids(result.actions).includes('feed'), true);
    assert.equal(ids(result.checklist).includes('coupon'), false);
    assert.equal(ids(result.checklist).includes('feed14'), true);
    // 같은 약국 정보로 업종만 동물병원(해당 없는 항목 없음)으로 바꾸면 쿠폰·예약 할 일과 질문이 그대로 있다
    const asPet = analyze({ ...PHARMACY.place, category: '동물병원' }, PHARMACY);
    assert.equal(ids(asPet.actions).includes('coupon') && ids(asPet.actions).includes('booking'), true);
    assert.equal(asPet.fanout.some((item) => item.notApplicable), false);
    assert.equal(asPet.aeo.score < result.aeo.score, true); // 해당 없는 질문을 빼면 질문 답변 범위 점수가 오른다(31 → 34)
});

test('병의원: 새소식·쿠폰은 점수에서 빼고(만점·감점 계산 밖), 할 일·체크리스트·초안·활동 할 일에도 안 나온다', () => {
    const place = clinic();
    const result = analyze(place, SALON);
    assert.deepEqual([result.notApplicable.feed, result.notApplicable.coupon, result.notApplicable.booking], ['병의원은 네이버가 새소식 기능을 제공하지 않습니다.', '병의원은 네이버가 쿠폰 기능을 제공하지 않습니다.', null]);
    const geo = new Map(result.geo.factors.map((factor) => [factor.key, factor]));
    // 최신성: 소식 점수(6점)가 분모에서 빠져 확인된 만점이 5(최근 리뷰만, 메뉴 수정일은 확인 불가)가 된다. 네이버 AI·쿠폰: 쿠폰(4점)이 빠져 확인 불가
    assert.deepEqual([geo.get('freshness').fullWeight, geo.get('freshness').weight, geo.get('freshness').notApplicable.map((entry) => entry.key)], [15, 5, ['feed']]);
    assert.deepEqual([geo.get('naverAi').pct, geo.get('naverAi').notApplicable.map((entry) => entry.key)], [null, ['coupon']]);
    assert.match(geo.get('freshness').evidence, /소식: 이 업종에는 해당 없음/);
    // AI 답변 쪽 '답변형 글(리뷰 답글·소식)' 항목도 소식 점수(7점)를 뺀다: 감점이 아니라 답글 점수만으로 계산
    const qna = result.aeo.factors.find((factor) => factor.key === 'qna');
    assert.deepEqual([qna.fullWeight, qna.weight, qna.notApplicable.map((entry) => entry.key)], [15, 8, ['feed']]);
    assert.match(qna.evidence, /소식: 이 업종에는 해당 없음/);
    // 결제 질문은 쿠폰 없이 결제 수단만 본다(쿠폰이 없다고 깎지 않음). 예약은 병의원도 쓸 수 있어 그대로
    const fanout = Object.fromEntries(result.fanout.map((item) => [item.key, item]));
    assert.equal(fanout.payment.question.includes('쿠폰'), false);
    assert.equal(fanout.payment.notApplicable, undefined);
    assert.equal(fanout.booking.notApplicable, undefined);
    assert.equal(ids(result.actions).some((id) => ['feed', 'coupon'].includes(id)), false);
    assert.equal(ids(result.checklist).some((id) => ['feed14', 'coupon'].includes(id)), false);
    assert.equal(result.templates.some((template) => template.key === 'feedPost'), false);
    // 활동 할 일("소식 첫 글 올리기"·"쿠폰 없음")에도 안 나온다
    const items = buildActionItems({ ...place, detail: { ...place.detail, hasBooking: true } }, { feeds: { count: 0, latest: null }, coupons: { total: 0, memberships: [] } });
    assert.equal(items.some((item) => ['feed', 'coupon'].includes(item.key)), false);
});

test('다른 업종의 점수·할 일은 바뀌지 않는다(음식점·미용실 견본)', () => {
    const restaurant = analyze(RESTAURANT.place, RESTAURANT);
    const salon = analyze(SALON.place, SALON);
    assert.deepEqual([restaurant.geo.score, restaurant.aeo.score, salon.geo.score, salon.aeo.score], [74, 82, 90, 91]);
    for (const result of [restaurant, salon]) {
        assert.deepEqual(result.notApplicable, { feed: null, coupon: null, booking: null });
        assert.equal(result.fanout.length, 8);
        assert.equal(result.fanout.some((item) => item.notApplicable), false);
        assert.equal(result.geo.factors.some((factor) => factor.notApplicable), false);
        assert.equal(ids(result.checklist).includes('coupon') && ids(result.checklist).includes('feed14'), true);
    }
    assert.equal(ids(restaurant.actions).includes('coupon') && ids(restaurant.actions).includes('feed'), true);
    // 해당 없음이 없는 매장의 질문·점수는 업종 이름과 무관하다(약국이 아닌 동물병원으로 바꿔도 같은 점수)
    const aeo = (place) => analyze(place, PHARMACY).aeo.score;
    assert.equal(aeo({ ...PHARMACY.place, category: '동물병원' }), aeo({ ...PHARMACY.place, category: '한식' }));
});

test('"리뷰 쿠폰" 표현은 어느 업종의 진단·할 일 문구에도 쓰지 않는다(리뷰를 조건으로 한 혜택은 정책 위반이라는 경고와 모순)', () => {
    for (const sample of [PHARMACY, RESTAURANT, SALON]) {
        const text = JSON.stringify([analyze(sample.place, sample), buildActionItems(sample.place, { coupons: { total: 0 }, feeds: null }), buildFanout(sample.place, sample.activity)]);
        assert.equal(/리뷰 쿠폰|리뷰·쿠폰 |첫 방문·리뷰 쿠폰|리뷰 작성·첫 방문 쿠폰/.test(text), false);
    }
    const coupon = buildActionItems(RESTAURANT.place, { coupons: { total: 0 } }).find((item) => item.key === 'coupon');
    assert.equal(coupon.detail, '첫 방문 쿠폰이나 결제 혜택을 등록하면 매장 화면에 쿠폰 표시가 붙습니다.');
});

test('그래프: 해당 없는 항목은 경고색 없이 "해당 없음"으로 보이고 "비어 있어 답하지 못함" 연결이 없다', () => {
    const pharmacy = buildPlaceGraph(graphInput(PHARMACY));
    const node = (id) => pharmacy.nodes.find((entry) => entry.id === id);
    assert.deepEqual([node('ac:coupon').sub, node('ac:coupon').tone, node('fq:payment').sub, node('fq:booking').sub], ['해당 없음', undefined, '해당 없음', '해당 없음']);
    assert.equal(pharmacy.links.some((link) => link.rel === 'missingFor'), false);
    assert.equal(node('geo:fanout').facts.some((fact) => fact.label === '이 업종에는 해당 없는 질문' && fact.value === '예약·문의, 쿠폰·혜택'), true);
    // 병의원: 마지막 소식·쿠폰 점이 '해당 없음'(소식이 없다고 경고하지 않음)
    const clinicGraph = buildPlaceGraph(graphInput({ ...SALON, place: clinic() }));
    const clinicNode = (id) => clinicGraph.nodes.find((entry) => entry.id === id);
    assert.deepEqual([clinicNode('ac:feed').sub, clinicNode('ac:feed').tone, clinicNode('ac:coupon').sub, clinicNode('ac:coupon').tone], ['해당 없음', undefined, '해당 없음', undefined]);
    // 해당 없음이 없는 업종은 그대로
    const salon = buildPlaceGraph(graphInput(SALON));
    assert.equal(salon.nodes.find((entry) => entry.id === 'fq:payment').sub, '바로 답함');
    assert.equal(salon.nodes.find((entry) => entry.id === 'geo:fanout').facts.some((fact) => fact.label === '이 업종에는 해당 없는 질문'), false);
});

test('순위 조회가 읽은 지역이 키워드 앞에 붙어 있으면 지역 인식에 더한다("압구정로데오…" 긴 키워드도 지역 있음으로 판정)', () => {
    // 시험용 매장: 주소에는 압구정이 없고, 등록 키워드 "압구정로데오숙성회모둠정식집"은 끝말을 알 수 없어 지역을 못 읽던 경우
    const place = { ...RESTAURANT.place, keywords: ['강남구청횟집', '압구정로데오숙성회모둠정식집'] };
    const row = { keyword: '압구정로데오숙성회모둠정식집', state: 'done', result: { keyword: '압구정로데오숙성회모둠정식집', status: 'found', rank: 41, scanned: 100, top: [], region: '압구정' } };
    assert.equal(regionTerms(place).some((region) => region.term === '압구정'), false);
    const without = recommendKeywords({ place, activity: RESTAURANT.activity });
    assert.equal(without.registered.find((entry) => entry.keyword === '압구정로데오숙성회모둠정식집').hasRegion, false);
    const withRank = recommendKeywords({ place, activity: RESTAURANT.activity, ranks: [row] });
    const long = withRank.registered.find((entry) => entry.keyword === '압구정로데오숙성회모둠정식집');
    assert.deepEqual([long.hasRegion, long.region], [true, '압구정']);
    assert.deepEqual(withRank.regions.filter((region) => region.scope === 'custom').map((region) => region.term), ['압구정']);
    // 순위 표가 읽은 지역이 키워드 앞이 아니거나 이미 아는 지역이면 더하지 않는다
    const unrelated = { ...row, result: { ...row.result, region: '청담' } };
    assert.equal(recommendKeywords({ place, activity: RESTAURANT.activity, ranks: [unrelated] }).regions.some((region) => region.term === '청담'), false);
    assert.equal(regionTerms(place, { ranks: [{ keyword: '강남구청횟집', result: { region: '강남구청' } }] }).filter((region) => region.scope === 'custom').length, 0);
});
