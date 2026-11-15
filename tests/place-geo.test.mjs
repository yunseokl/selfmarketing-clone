import test from 'node:test';
import assert from 'node:assert/strict';
import {
    josa, placeArea, targetQuestion, summarizeHours, findHypeWords, keywordCore, keywordConsistency,
    buildFanout, fanoutCoverage, buildAtomicAnswer, rankSharePoints, searchShare, scoreGeo, scoreAeo, totalScore,
    scoreLabel, platformReadiness, buildActionPlan, buildRoadmap, externalSteps, keywordCandidates, buildChecklist,
    schemaType, buildLocalBusinessJsonLd, buildLlmsTxt, compareGeoSignals, placeOnlyScores, summarizeRival, rivalGaps,
    analyzeGeoAeo, ATOMIC_MAX, ATOMIC_MIN, HYPE_WORDS, GEO_DONTS, PLATFORMS, ROADMAP_STAGES, REPLY_TARGET,
    placeCriteria, buildCriteriaAnswer, measurePrompts, somPoints, somRankLabel, brandAliases, evaluateAnswerRank, shareOfModel,
    channelProgress, platformProgress, profileSites, factRows, buildTemplates,
    SOM_MENTION, SOM_NONE, SOM_PROMPT_SUFFIX, SOM_RANKS, TEMPLATE_BLANK,
} from '../lib/place-geo.js';
import { geoRivalsSchema } from '../lib/validations/place-insight.js';

// 고정 시각(2026-11-15 12:00 KST)으로 날짜 계산을 고정합니다. 네트워크 호출은 없습니다.
const NOW = Date.parse('2026-11-15T03:00:00Z');
const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

function fullPlace(overrides = {}) {
    return {
        placeId: '2025884279',
        name: '분석식당',
        category: '한식',
        address: '서울 강남구 분석로 2',
        coordinate: { x: '127.04', y: '37.51' },
        visitorReviews: 320,
        visitorScore: 4.52,
        blogReviews: 85,
        textReviews: 200,
        photoReviews: 90,
        intro: '강남구청역 곰탕 전문',
        conveniences: ['단체 이용 가능', '포장'],
        paymentInfo: ['제로페이'],
        hasTalktalk: true,
        hasBlog: true,
        hasPhone: true,
        hasOpeningHours: true,
        missing: { hours: false, menuImage: false, accessor: false, description: false, conveniences: false },
        menuCount: 10,
        menuImageCount: 8,
        menuPricedCount: 10,
        menuDescribedCount: 8,
        menuCategoryCount: 2,
        reviewThemes: [{ label: '맛', count: 40 }, { label: '회식', count: 12 }],
        reviewMenus: [{ label: '곰탕', count: 30 }, { label: '수육', count: 10 }],
        reviewVotes: [{ label: '음식이 맛있어요', count: 120 }, { label: '친절해요', count: 50 }],
        reviewAuthors: 300,
        keywords: ['강남구청곰탕', '압구정회식', '강남역맛집', '수육맛집', '곰탕'],
        detail: {
            hours: { registered: true, status: '영업 중', statusText: null, days: WEEK.map((day) => ({ day, start: '10:00', end: '22:00', breaks: [], lastOrder: null })), regularClosed: null, irregularClosedCount: 0 },
            pos: null,
            photos: { top: 50, business: 20, visitorMedia: 100 },
            couponCount: 1,
            hasFeed: true,
            tools: [],
            hasBooking: true,
            tabs: [],
            parking: { available: true, free: true, valet: false },
            facilities: ['무선 인터넷'],
            pet: null,
            noKidsZone: null,
            descriptionLength: 180,
            links: ['인스타그램', '홈페이지', '유튜브'],
            badges: [],
            subway: { station: '강남구청역', exit: '3-1', walkMinutes: 5 },
            menuUpdatedAt: '26.11.08',
            newOpening: false,
            benefits: [],
        },
        ...overrides,
    };
}

function fullActivity(overrides = {}) {
    return {
        visitor: { total: 320, sampled: 50, latest: '2026-11-15', oldest: '2026-10-01', last7: 6, last30: 20, spanDays: 45, perDay: 1.1, replied: 45, replyRate: 90, revisits: 10, revisitRate: 20 },
        blog: { total: 85, sampled: 30, cafe: 3, latest: '2026-11-10', oldest: '2026-06-01', last7: 1, last30: 4, spanDays: 160 },
        feeds: { count: 5, hasMore: false, latest: '2026-11-10', latestTitle: '11월 신메뉴 안내', latestCategory: '메뉴', daysSinceLatest: 5, last30: 2 },
        coupons: { total: 1, titles: ['첫 방문 10% 할인'], memberships: [] },
        briefing: ['곰탕이 유명한 한식당입니다.'],
        ...overrides,
    };
}

const BARE = {
    placeId: '9',
    name: '빈가게',
    category: '',
    address: '',
    visitorReviews: 0,
    visitorScore: null,
    blogReviews: 0,
    textReviews: null,
    intro: null,
    conveniences: [],
    paymentInfo: [],
    hasTalktalk: false,
    hasBlog: false,
    hasPhone: false,
    hasOpeningHours: false,
    missing: null,
    menuCount: 0,
    menuPricedCount: null,
    menuDescribedCount: null,
    reviewThemes: [],
    reviewMenus: [],
    reviewVotes: [],
    keywords: [],
    detail: null,
};

// ---- 글자 도우미 ----

test('josa 는 받침에 맞춰 조사를 고르고, 판단할 수 없으면 두 형태를 함께 붙인다', () => {
    assert.equal(josa('분석식당', '은', '는'), '분석식당은');
    assert.equal(josa('포뉴', '은', '는'), '포뉴는');
    assert.equal(josa('강남구청역', '과', '와'), '강남구청역과');
    assert.equal(josa('카페 3', '은', '는'), '카페 3은'); // 삼 → 받침 있음
    assert.equal(josa('Cafe B', '은', '는'), 'Cafe B은(는)');
});

test('지역은 가까운 역 > 동 > 구 순서로 고르고, 질문은 "지역 업종 추천" 형태다', () => {
    assert.equal(placeArea(fullPlace()), '강남구청역');
    assert.equal(placeArea({ address: '서울 마포구 연남동 123' }), '연남동');
    assert.equal(placeArea({ address: '서울 강남구 테헤란로 1' }), '강남구');
    assert.equal(placeArea({ address: '', detail: { subway: { station: '홍대입구' } } }), '홍대입구역');
    assert.equal(targetQuestion(fullPlace()), '강남구청역 한식 추천');
    assert.equal(targetQuestion({ category: '육류,고기요리', address: '' }), '육류·고기요리 추천');
    assert.equal(targetQuestion(BARE), '매장 추천');
});

test('영업시간 요약: 매일 같으면 "매일", 다르면 가장 흔한 시간 + "요일별"', () => {
    assert.equal(summarizeHours(fullPlace().detail.hours), '매일 10:00~22:00');
    const weekdays = { registered: true, days: ['월', '화', '수'].map((day) => ({ day, start: '11:00', end: '21:00' })) };
    assert.equal(summarizeHours(weekdays), '월·화·수 11:00~21:00');
    const mixed = {
        registered: true,
        days: [
            { day: '월', start: '11:00', end: '21:00' }, { day: '화', start: '11:00', end: '21:00' },
            { day: '토', start: '12:00', end: '23:00' }, { day: '일', start: null, end: null },
        ],
    };
    assert.equal(summarizeHours(mixed), '월·화 11:00~21:00 등 요일별');
    assert.equal(summarizeHours({ registered: false, days: [] }), null);
    assert.equal(summarizeHours(null), null);
});

test('광고성 수식어를 찾고 어디서 나왔는지 함께 돌려준다', () => {
    const found = findHypeWords([{ where: '대표키워드', text: '강남 최고 국밥' }, { where: '소식', text: '역대급 이벤트' }, { where: '소개', text: '곰탕 전문' }]);
    assert.deepEqual(found, [{ word: '최고', where: '대표키워드' }, { word: '역대급', where: '소식' }]);
    assert.deepEqual(findHypeWords([{ where: 'x', text: '100% 국내산 한우' }]), []); // 사실 표기로 쓰이는 표현은 잡지 않는다
    assert.ok(HYPE_WORDS.includes('압도적'));
});

// ---- 대표키워드 일치 ----

test('keywordCore 는 지역 이름과 "맛집·추천" 같은 일반어를 지운다', () => {
    const tokens = ['강남구청역', '강남구청', '강남역', '강남구', '서울', '강남'];
    assert.equal(keywordCore('강남구청 횟집', tokens), '횟집');
    assert.equal(keywordCore('강남역맛집', tokens), '');
    assert.equal(keywordCore('압구정회식', tokens), '압구정회식');
});

test('대표키워드가 리뷰·AI 브리핑 표현과 겹치는지 대략 판정하고, 지역·일반 키워드는 따로 뺀다', () => {
    const result = keywordConsistency(fullPlace({ keywords: ['강남구청곰탕', '압구정회식', '강남역맛집', '최고의 파스타'] }), fullActivity());
    assert.deepEqual(result.generic, ['강남역맛집']);
    assert.deepEqual(result.checked.map((c) => [c.keyword, c.matched]), [['강남구청곰탕', true], ['압구정회식', true], ['최고의 파스타', false]]);
    assert.equal(result.matched, 2);
    assert.equal(Math.round(result.ratio * 100), 67);
    assert.equal(keywordConsistency(fullPlace({ keywords: [] }), null).ratio, null);
});

// ---- 쿼리 팬아웃 ----

test('정보가 다 찬 매장은 세부 질문 8개에 답할 수 있고, 금액을 모르는 가격 질문만 일부 답한다', () => {
    const fanout = buildFanout(fullPlace(), fullActivity());
    assert.equal(fanout.length, 8);
    const byKey = Object.fromEntries(fanout.map((f) => [f.key, f.status]));
    assert.equal(byKey.price, 'partial'); // 메뉴에 가격 칸은 있지만 실제 금액은 화면 정보에 없음
    assert.deepEqual(fanout.filter((f) => f.key !== 'price').map((f) => f.status), Array(7).fill('yes'));
    assert.equal(fanout.find((f) => f.key === 'payment').weight, 0.5);
    const location = fanout.find((f) => f.key === 'location');
    assert.equal(location.answer, '분석식당은 서울 강남구 분석로 2에 있습니다. 강남구청역 3-1번 출구에서 걸어서 5분 거리입니다.');
    // 가중치 합 7.5 중 7(일부만 0.5)
    assert.equal(fanoutCoverage(fanout).ratio, 7 / 7.5);
});

test('빈 매장은 답할 정보가 없고, 확인할 수 없는 질문은 커버리지 분모에서 뺀다', () => {
    const fanout = buildFanout(BARE, null);
    const byKey = Object.fromEntries(fanout.map((f) => [f.key, f.status]));
    assert.equal(byKey.location, 'no');
    assert.equal(byKey.hours, 'no');
    assert.equal(byKey.parking, 'unknown'); // 상세 정보가 없어 확인 불가
    assert.equal(byKey.payment, 'unknown');
    const coverage = fanoutCoverage(fanout);
    assert.equal(coverage.ratio, 0);
    assert.equal(coverage.known, 6);
});

test('가격은 POS 평균 결제가 있으면 바로 답하고, 메뉴 가격만 있으면 일부만 답한다', () => {
    const withPos = fullPlace();
    withPos.detail = { ...withPos.detail, pos: { averagePrice: { total: 18000 }, popularMenus: [] } };
    assert.equal(buildFanout(withPos, null).find((f) => f.key === 'price').status, 'yes');
    assert.equal(buildFanout(fullPlace(), null).find((f) => f.key === 'price').status, 'partial');
    assert.equal(buildFanout(fullPlace({ menuPricedCount: 0 }), null).find((f) => f.key === 'price').status, 'no');
});

// ---- 원자 답변 ----

test('원자 답변은 매장명으로 시작하는 두괄식 문단이고 155자를 넘지 않으며 광고성 표현이 없다', () => {
    const atomic = buildAtomicAnswer(fullPlace(), fullActivity());
    assert.ok(atomic.text.startsWith('분석식당은 서울 강남구 분석로 2에 있는 한식 매장입니다.'));
    assert.ok(atomic.length <= ATOMIC_MAX);
    assert.ok(atomic.length >= ATOMIC_MIN);
    assert.equal(atomic.inRange, true);
    assert.equal(atomic.question, '강남구청역 한식 추천');
    assert.deepEqual(findHypeWords([{ where: 'a', text: atomic.text }]), []);
    assert.ok(atomic.faq.length >= 6);
});

test('근거가 부족하면 원자 답변이 짧다고 표시한다', () => {
    const atomic = buildAtomicAnswer({ ...BARE, name: '빈가게', category: '카페' }, null);
    assert.equal(atomic.text, '빈가게는 카페 매장입니다.');
    assert.equal(atomic.short, true);
    assert.equal(atomic.inRange, false);
});

// ---- 검색 노출 점유율 ----

test('순위 점수는 대화의 Share of Model 채점표를 따른다', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11, null].map(rankSharePoints), [100, 75, 55, 35, 20, 15, 15, 0, 0]);
});

test('검색 노출 점유율은 조회가 끝난 키워드만 평균한다', () => {
    const share = searchShare([
        { keyword: 'a', state: 'done', result: { status: 'found', rank: 1 } },
        { keyword: 'b', state: 'done', result: { status: 'found', rank: 7 } },
        { keyword: 'c', state: 'done', result: { status: 'beyond', rank: null } },
        { keyword: 'd', state: 'loading' },
        { keyword: 'e', state: 'error', error: 'x' },
    ]);
    assert.equal(share.rows.length, 3);
    assert.equal(share.score, Math.round((100 + 15 + 0) / 3));
    assert.equal(share.top5, 1);
    assert.equal(share.listed, 2);
    assert.equal(searchShare([]), null);
    assert.equal(searchShare(null), null);
});

// ---- 점수 ----

test('정보가 다 찬 매장은 GEO·AEO 모두 높고, 순위가 없으면 경쟁 항목은 확인 불가로 뺀다', () => {
    const geo = scoreGeo(fullPlace(), fullActivity(), null, { nowMs: NOW });
    const aeo = scoreAeo(fullPlace(), fullActivity());
    const competition = geo.factors.find((f) => f.key === 'competition');
    assert.equal(competition.pct, null);
    assert.equal(competition.status, 'unknown');
    assert.ok(geo.score >= 85, `geo ${geo.score}`);
    assert.ok(aeo.score >= 85, `aeo ${aeo.score}`);
    assert.equal(scoreLabel(geo.score), '준비 우수');
    for (const factor of [...geo.factors, ...aeo.factors]) {
        assert.ok(factor.evidence && factor.tip, factor.key);
    }
});

test('빈 매장은 GEO·AEO 모두 "보강 필요"이고 점수는 0~100 안이다', () => {
    const geo = scoreGeo(BARE, null, null, { nowMs: NOW });
    const aeo = scoreAeo(BARE, null);
    assert.ok(geo.score >= 0 && geo.score < 50, `geo ${geo.score}`);
    assert.ok(aeo.score >= 0 && aeo.score < 50, `aeo ${aeo.score}`);
    assert.equal(scoreLabel(aeo.score), '보강 필요');
});

test('광고성 표현이 둘 이상이면 표현 항목은 0점, 하나면 일부 점수', () => {
    const two = scoreGeo(fullPlace({ keywords: ['최고 곰탕'] }), fullActivity({ feeds: { ...fullActivity().feeds, latestTitle: '대박 이벤트' } }), null, { nowMs: NOW });
    assert.equal(two.factors.find((f) => f.key === 'tone').pct, 0);
    const one = scoreGeo(fullPlace({ keywords: ['최고 곰탕'] }), fullActivity(), null, { nowMs: NOW });
    assert.equal(one.factors.find((f) => f.key === 'tone').pct, 40);
});

test('순위 결과가 있으면 검색 노출 점유율이 GEO 경쟁 항목에 반영된다', () => {
    const ranks = [{ keyword: 'a', state: 'done', result: { status: 'found', rank: 1 } }];
    const geo = scoreGeo(fullPlace(), fullActivity(), ranks, { nowMs: NOW });
    assert.equal(geo.factors.find((f) => f.key === 'competition').pct, 100);
});

test('totalScore 는 확인 불가 항목을 빼고 항목 비중대로 평균한다', () => {
    assert.equal(totalScore([{ pct: 100, weight: 30 }, { pct: 0, weight: 10 }, { pct: null, weight: 60 }]), 75);
    assert.equal(totalScore([{ pct: null, weight: 10 }]), null);
    assert.equal(scoreLabel(null), '확인 불가');
});

test('AI별 준비도는 다섯 AI(네이버·ChatGPT·Gemini·Claude·Perplexity) 모두 나오고 약한 항목을 짚는다', () => {
    const geo = scoreGeo(BARE, null, null, { nowMs: NOW });
    const aeo = scoreAeo(BARE, null);
    const platforms = platformReadiness(geo, aeo);
    assert.deepEqual(platforms.map((p) => p.key), ['naver', 'chatgpt', 'gemini', 'claude', 'perplexity']);
    assert.deepEqual(platforms.map((p) => p.short), ['네이버 AI', 'ChatGPT', 'Gemini', 'Claude', 'Perplexity']);
    assert.equal(platforms[0].label, '네이버 AI 브리핑'); // 이름은 그대로, 등급은 grade 에
    assert.ok(platforms.every((p) => typeof p.grade === 'string'));
    assert.ok(platforms.every((p) => p.score === null || (p.score >= 0 && p.score <= 100)));
    assert.ok(platforms.some((p) => p.weakest));
});

// ---- 제안·체크리스트 ----

function plan(place, activity, ranks = null) {
    const fanout = buildFanout(place, activity);
    const geo = scoreGeo(place, activity, ranks, { nowMs: NOW });
    const aeo = scoreAeo(place, activity, fanout);
    const hype = findHypeWords([
        ...(place.keywords || []).map((text) => ({ where: '대표키워드', text })),
        { where: '한 줄 소개', text: place.intro },
        { where: '최근 소식 제목', text: activity?.feeds?.latestTitle },
    ].filter((entry) => entry.text));
    return { geo, aeo, ...buildActionPlan({ place, activity, ranks, nowMs: NOW, geo, aeo, fanout, hype }) };
}

const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));
const byKey = (items) => Object.fromEntries(items.map((item) => [item.key, item]));

// 모든 세부 점수가 만점인 매장(리뷰 500개·블로그 200개 이상, 메뉴 설명·결제 집계까지)
function perfectPlace() {
    const place = fullPlace({
        visitorReviews: 600, textReviews: 400, blogReviews: 250, menuDescribedCount: 10,
        keywords: ['강남구청곰탕', '강남구청수육', '강남구청회식', '곰탕맛', '수육'],
    });
    place.detail = { ...place.detail, pos: { averagePrice: { total: 15000 }, popularMenus: [{ name: '곰탕' }] } };
    return place;
}

function perfectActivity() {
    return fullActivity({ blog: { ...fullActivity().blog, total: 250 } });
}

test('할 일마다 지금→목표와, 그 일만 했을 때 다시 계산한 +N점을 붙인다', () => {
    const place = fullPlace({ keywords: ['최고 곰탕'], hasTalktalk: false });
    place.detail = { ...place.detail, hasBooking: false };
    const activity = fullActivity({ visitor: { ...fullActivity().visitor, replied: 10, replyRate: 20 } });
    const result = plan(place, activity);
    const actions = byId(result.actions);
    // 답글: 최근 50개 중 80% = 40개 → 이미 10개 → 30개, 하루 5개
    assert.equal(actions.reply.title, '최근 리뷰 30개에 답글 달기 — 하루 5개씩 이번 주 안에');
    assert.equal(actions.reply.target, `답글률 ${REPLY_TARGET}% 이상`);
    assert.ok(actions.reply.gain.aeo > 0);
    // +N점은 실제로 그 값을 바꿔 다시 계산한 결과와 같다
    const replied = structuredClone(activity);
    replied.visitor.replied = 40;
    replied.visitor.replyRate = 80;
    assert.equal(actions.reply.gain.aeo, scoreAeo(place, replied).score - result.aeo.score);
    assert.ok(actions.hype.title.includes('"최고"'));
    assert.ok(actions.booking && actions.talktalk && actions.keywordsFill);
    assert.match(actions.keywordsFill.title, /후보: 강남구청(곰탕|수육)/);
    // 점수 효과 큰 순 → 같은 효과면 빠른 단계 순, 외부 일은 점수 효과 없음(null)
    const totals = result.actions.map((a) => (a.gain ? a.gain.geo + a.gain.aeo : -1));
    assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
    assert.equal(actions.gbp.gain, null);
    assert.equal(actions.gbp.manual, true);
    // 모두 하면 지금보다 낮아지지 않는다
    assert.ok(result.projected.geo.after >= result.geo.score);
    assert.ok(result.projected.aeo.after > result.aeo.score);
});

test('정보가 다 찬 매장은 점수가 오르는 할 일이 없고 외부 채널 일만 남는다', () => {
    const result = plan(perfectPlace(), perfectActivity());
    const scoring = result.actions.filter((a) => a.gain && a.gain.geo + a.gain.aeo > 0);
    assert.deepEqual(scoring.map((a) => a.id), []);
    assert.ok(result.actions.some((a) => a.id === 'bingPlaces'));
    // 유튜브가 이미 연결된 매장은 유튜브 단계가 자동 완료
    assert.equal(byId(result.actions).youtube.done, true);
});

test('빈 매장은 지금 당장 플레이스 빈칸·메뉴·소개글부터 하라고 하고 모두 하면 점수가 크게 오른다', () => {
    const result = plan(BARE, null);
    const actions = byId(result.actions);
    assert.equal(actions.napFill.stage, 'now');
    assert.match(actions.napFill.title, /주소·전화번호·영업시간·업종/);
    assert.equal(actions.menuAdd.stage, 'now');
    assert.equal(actions.intro.template, 'intro'); // 소개글 할 일에서 초안으로 바로 간다
    assert.ok(actions.napFill.gain.geo > 0);
    assert.equal(actions.reply, undefined); // 활동을 못 받으면 답글 할 일을 지어내지 않는다
    assert.ok(result.projected.geo.after - result.geo.score >= 20, JSON.stringify(result.projected));
});

test('검색 순위 10위 안인 대표키워드는 리뷰 표현과 달라도 바꾸라고 하지 않는다', () => {
    const place = fullPlace({ keywords: ['강남구청곰탕', '압구정회식', '강남구청파스타', '강남구청피자', '곰탕'] });
    const ranks = [
        { keyword: '강남구청파스타', state: 'done', result: { status: 'found', rank: 3 } },
        { keyword: '강남구청피자', state: 'done', result: { status: 'found', rank: 40 } },
    ];
    const actions = byId(plan(place, fullActivity(), ranks).actions);
    assert.ok(actions.keywordsMatch.title.includes('강남구청피자'));
    assert.equal(actions.keywordsMatch.title.includes('강남구청파스타 →'), false);
    assert.ok(actions.keywordsMatch.how.includes('강남구청파스타'));
    assert.match(actions.rank.title, /강남구청피자\(40위\)/);
    assert.equal(actions.rank.gain, null); // 순위는 결과 지표라 점수 효과를 약속하지 않는다
});

test('대표키워드 후보는 리뷰·결제 메뉴에 지역명을 붙이고 이미 쓰는 표현은 뺀다', () => {
    const place = fullPlace({ keywords: ['강남구청곰탕'] });
    assert.deepEqual(keywordCandidates(place, 3), ['강남구청수육']);
    const withPos = fullPlace({ keywords: [], reviewMenus: [] });
    withPos.detail = { ...withPos.detail, pos: { averagePrice: {}, popularMenus: [{ name: '소금 김밥' }, { name: '生 아사히 생맥주' }] } };
    assert.deepEqual(keywordCandidates(withPos, 5), ['강남구청소금김밥']); // 한자·긴 이름은 후보에서 뺌
});

test('AI별 로드맵: 지금 당장 → 1주 → 2주 → 1개월, AI마다 가장 빠른 통로가 앞에 온다', () => {
    const result = plan(fullPlace({ hasTalktalk: false }), fullActivity({ coupons: { total: 0, titles: [], memberships: [] } }));
    assert.deepEqual(ROADMAP_STAGES.map((s) => s.key), ['now', 'week1', 'week2', 'month1']);
    const ids = (platform, stage) => buildRoadmap(result.actions, platform).find((s) => s.key === stage).items.map((i) => i.id);
    // 모든 AI: 기준점 기록 → 그 AI의 출처 확인 → (핵심 통로) → 이미 인용되는 글 맞추기
    const lead = { naver: 'srcNaver', chatgpt: 'srcChatgpt', gemini: 'srcGemini', claude: 'srcClaude', perplexity: 'srcPerplexity' };
    for (const platform of PLATFORMS) {
        const now = ids(platform.key, 'now');
        assert.deepEqual(now.slice(0, 2), ['measure', lead[platform.key]], platform.key);
        assert.ok(now.includes('sourceUpdate'), platform.key); // 대화가 가장 빠르다고 꼽은 방법은 오늘 시작
        assert.ok(ids(platform.key, 'week1').includes('faqPage'), platform.key);
        assert.ok(ids(platform.key, 'month1').includes('remeasure'), platform.key);
        assert.ok(platform.fastest.length > 20 && platform.filter && platform.claim, platform.key);
        const stages = buildRoadmap(result.actions, platform.key);
        assert.ok(stages.flatMap((s) => s.items).every((i) => i.platforms.includes(platform.key)));
    }
    // AI별 통로
    assert.deepEqual(ids('chatgpt', 'now').slice(0, 4), ['measure', 'srcChatgpt', 'bingPlaces', 'sourceUpdate']);
    assert.deepEqual(ids('gemini', 'now').slice(0, 4), ['measure', 'srcGemini', 'gbp', 'sourceUpdate']);
    assert.ok(ids('chatgpt', 'week1').includes('bingWebmaster'));
    assert.ok(ids('gemini', 'week1').includes('gbpFill'));
    assert.ok(ids('gemini', 'week2').includes('youtube') && ids('gemini', 'week2').includes('searchConsole'));
    assert.equal(ids('claude', 'week1')[0], 'faqPage'); // Claude·Perplexity는 질문형 글이 핵심 통로
    assert.equal(ids('perplexity', 'week1')[0], 'faqPage');
    assert.ok(ids('perplexity', 'week2').includes('freshDate'));
    // 네이버는 플레이스 안에서 오늘 끝나는 일이 함께 나온다
    assert.ok(ids('naver', 'now').includes('coupon'));
    assert.ok(ids('naver', 'now').includes('talktalk'));
    assert.equal(ids('naver', 'now').includes('gbp'), false);
    assert.equal(ids('naver', 'now').includes('bingPlaces'), false);
    // 건너뛰어도 되는 일은 그 단계의 맨 뒤
    const week2 = buildRoadmap(result.actions, 'chatgpt').find((s) => s.key === 'week2').items;
    assert.deepEqual(week2.slice(-2).map((i) => i.optional), [true, true]);
});

test('외부 통로 할 일은 작업 시간이 있고, 초안이 있으면 초안 목록의 key 와 맞는다', () => {
    const place = fullPlace();
    const steps = externalSteps(place, fullActivity());
    const templateKeys = new Set(buildTemplates(place, fullActivity(), { nowMs: NOW }).map((t) => t.key));
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length);
    for (const step of steps) {
        assert.ok(step.work && step.how && step.title, step.id);
        assert.ok(ROADMAP_STAGES.some((stage) => stage.key === step.stage), step.id);
        if (step.template) assert.ok(templateKeys.has(step.template), `${step.id} → ${step.template}`);
    }
    // 플레이스 안 할 일의 초안도 같은 목록에 있다
    const dataTemplates = plan(BARE, null).actions.filter((a) => !a.manual && a.template).map((a) => a.template);
    assert.ok(dataTemplates.every((key) => templateKeys.has(key)));
    // 홈페이지가 연결돼 있지 않으면 홈페이지 일은 건너뛰어도 되는 일이 된다
    const noSite = fullPlace();
    noSite.detail = { ...noSite.detail, links: ['인스타그램'] };
    const robots = (list) => list.find((s) => s.id === 'robots');
    assert.equal(robots(steps).optional, false);
    assert.equal(robots(externalSteps(noSite, null)).optional, true);
    assert.equal(robots(externalSteps(BARE, null)).optional, false); // 연결 정보를 못 읽으면 단정하지 않는다
    // 업종에 맞는 예약·리뷰 서비스
    assert.deepEqual(profileSites('한식'), ['카카오맵', '캐치테이블', '테이블링']);
    assert.deepEqual(profileSites('피부과'), ['카카오맵', '모두닥', '굿닥']);
    assert.deepEqual(profileSites('세탁소'), ['카카오맵', '인스타그램 프로필']);
});

test('통로 진행률: 핵심 통로는 3배로 세고, 건너뛰어도 되는 일은 체크했을 때만 센다', () => {
    const actions = plan(fullPlace(), fullActivity()).actions;
    const none = channelProgress(actions, 'chatgpt', []);
    assert.equal(none.done, 0);
    assert.equal(none.pct, 0);
    assert.equal(none.coreTotal, 2); // Bing Places + 이미 인용되는 글 맞추기
    const core = channelProgress(actions, 'chatgpt', ['bingPlaces']);
    const minor = channelProgress(actions, 'chatgpt', ['napSame']);
    assert.ok(core.pct > minor.pct);
    assert.equal(core.coreDone, 1);
    // 선택 사항(보도자료)은 분모에 없다가 체크하면 들어간다
    const withPress = channelProgress(actions, 'chatgpt', ['press']);
    assert.equal(withPress.total, none.total + 1);
    assert.equal(withPress.done, 1);
    // 유튜브가 이미 연결된 매장은 Gemini 통로가 하나 끝난 것으로 본다
    assert.equal(channelProgress(actions, 'gemini', []).done, 1);
    // 모두 체크하면 100
    const all = actions.filter((a) => a.manual).map((a) => a.id);
    assert.equal(channelProgress(actions, 'chatgpt', all).pct, 100);
});

test('AI별 종합 준비도: 네이버 밖 AI는 외부 통로를 열지 않으면 재료가 좋아도 낮게 나온다', () => {
    const place = perfectPlace();
    const activity = perfectActivity();
    const geo = scoreGeo(place, activity, null, { nowMs: NOW });
    const aeo = scoreAeo(place, activity);
    const actions = plan(place, activity).actions;
    const before = Object.fromEntries(platformProgress(platformReadiness(geo, aeo), actions, []).map((p) => [p.key, p]));
    assert.equal(before.chatgpt.score, 100);
    assert.ok(before.chatgpt.overall <= 50, `chatgpt ${before.chatgpt.overall}`);
    assert.ok(before.naver.overall >= 80, `naver ${before.naver.overall}`); // 네이버는 플레이스 자체가 통로
    assert.equal(before.chatgpt.overallGrade, scoreLabel(before.chatgpt.overall));
    const after = Object.fromEntries(platformProgress(platformReadiness(geo, aeo), actions, ['bingPlaces', 'sourceUpdate']).map((p) => [p.key, p]));
    assert.ok(after.chatgpt.overall > before.chatgpt.overall);
    assert.ok(after.gemini.overall > before.gemini.overall); // 출처 글 맞추기는 모든 AI에 반영
    const allDone = platformProgress(platformReadiness(geo, aeo), actions, actions.filter((a) => a.manual).map((a) => a.id));
    assert.ok(allDone.every((p) => p.overall === 100));
    // 재료 점수를 모르면 종합도 모른다
    assert.equal(platformProgress([{ key: 'chatgpt', score: null, channelWeight: 0.5 }], actions, [])[0].overall, null);
});

test('항목에 붙는 AI 표시는 그 AI 점수에 실제로 들어가는 항목과 같다', () => {
    const activity = fullActivity();
    const clean = { geo: scoreGeo(fullPlace(), activity, null, { nowMs: NOW }), aeo: scoreAeo(fullPlace(), activity) };
    const hyped = fullPlace({ intro: '강남 최고 곰탕', keywords: ['강남구청곰탕', '압구정회식', '강남역맛집', '수육맛집', '대박곰탕'] });
    const dirty = { geo: scoreGeo(hyped, activity, null, { nowMs: NOW }), aeo: scoreAeo(hyped, activity) };
    const tone = dirty.geo.factors.find((f) => f.key === 'tone');
    assert.deepEqual(tone.platforms, ['chatgpt', 'claude', 'perplexity']);
    const a = Object.fromEntries(platformReadiness(clean.geo, clean.aeo).map((p) => [p.key, p.score]));
    const b = Object.fromEntries(platformReadiness(dirty.geo, dirty.aeo).map((p) => [p.key, p.score]));
    for (const key of tone.platforms) assert.ok(b[key] < a[key], key);
    assert.equal(b.gemini, a.gemini);
    const keys = PLATFORMS.map((p) => p.key);
    for (const factor of [...clean.geo.factors, ...clean.aeo.factors]) {
        assert.ok(factor.platforms.length > 0 && factor.platforms.every((key) => keys.includes(key)), factor.key);
    }
});

test('외부 채널 단계는 체크리스트와 같은 id를 써서 한쪽에서 체크하면 다른 쪽도 체크된다', () => {
    const steps = externalSteps(fullPlace(), fullActivity());
    const checklist = buildChecklist(fullPlace(), fullActivity(), {});
    const checkIds = new Set(checklist.map((item) => item.id));
    assert.ok(steps.every((step) => checkIds.has(step.id)));
    assert.ok(steps.some((step) => step.id === 'briefingCheck')); // AI 브리핑이 있을 때만
    assert.equal(externalSteps(fullPlace(), null).some((step) => step.id === 'briefingCheck'), false);
});

test('하지 말 것은 위험 이유와 대신 할 일을 함께 준다', () => {
    assert.ok(GEO_DONTS.length >= 10);
    for (const item of GEO_DONTS) {
        assert.ok(item.title && item.why && item.instead, item.title);
    }
    assert.ok(GEO_DONTS.some((item) => item.title.includes('별점 5점')));
    assert.ok(GEO_DONTS.some((item) => item.why.includes('추천·보증')));
    // 대화에 "더 빠른 방법"으로 나온 것 중 넣지 않은 것들
    for (const word of ['클로킹', '프롬프트 인젝션', '자문자답', '손님인 척', '경쟁 매장을 깎아내리는', '벤치마크', '기계 음성']) {
        assert.ok(GEO_DONTS.some((item) => item.title.includes(word)), word);
    }
});

test('체크리스트는 자동 판정 항목과 직접 확인 항목을 함께 낸다', () => {
    const place = fullPlace();
    const activity = fullActivity();
    const geo = scoreGeo(place, activity, null, { nowMs: NOW });
    const items = byId(buildChecklist(place, activity, { geo, hype: [] }));
    assert.equal(items.nap.done, true);
    assert.equal(items.kw5.done, true);
    assert.equal(items.reply.done, true);
    assert.equal(items.feed14.done, true);
    assert.equal(items.noHype.done, true);
    assert.equal(items.coupon.done, true);
    assert.equal(items.menuPrice.done, true);
    assert.equal(items.gbp.auto, undefined); // 구글 비즈니스 프로필은 직접 확인
    assert.equal(items.youtube.auto, true); // 유튜브 연결이 보이면 자동 완료
    assert.ok(items.measure.title.includes('강남구청역 한식 추천'));
    const bare = byId(buildChecklist(BARE, null, {}));
    assert.equal(bare.kw5.done, false);
    assert.equal(bare.reply.done, null); // 활동을 못 받으면 확인 불가
    assert.equal(bare.coupon.done, null);
    assert.equal(bare.youtube.auto, undefined);
});

// ---- 엣지 케이스 ----

test('확인 불가 세부 점수는 항목 비중에서도 빠진다(일부로 나머지를 짐작하지 않음)', () => {
    // 활동 없음 + 메뉴 수정일만 있음 → 최신성은 메뉴 4점짜리 하나로만 계산
    const place = fullPlace({ hasTalktalk: true });
    place.detail = { ...place.detail, hasFeed: null, menuUpdatedAt: '2024.01.01' };
    const geo = scoreGeo(place, null, null, { nowMs: NOW });
    const freshness = geo.factors.find((f) => f.key === 'freshness');
    assert.equal(freshness.pct, 0);
    assert.equal(freshness.weight, 4);
    assert.equal(freshness.fullWeight, 15);
    // 총점 = 확인된 점수 합 / 확인된 만점 합
    const known = geo.factors.filter((f) => f.pct !== null);
    const exact = Math.round((known.reduce((s, f) => s + f.points, 0) / known.reduce((s, f) => s + f.max, 0)) * 100);
    assert.equal(geo.score, exact);
});

test('만점 매장은 GEO·AEO 100점이고 0점 매장은 0점이다', () => {
    const place = perfectPlace();
    const activity = perfectActivity();
    const ranks = place.keywords.map((keyword) => ({ keyword, state: 'done', result: { status: 'found', rank: 1 } }));
    const geo = scoreGeo(place, activity, ranks, { nowMs: NOW });
    const aeo = scoreAeo(place, activity);
    assert.deepEqual(geo.factors.filter((f) => f.pct !== 100).map((f) => f.key), []);
    assert.equal(geo.score, 100);
    assert.equal(aeo.score, 100);
    assert.equal(scoreLabel(100), '준비 우수');

    const zeroActivity = {
        visitor: { total: 0, sampled: 0, last7: 0, last30: 0, replied: 0, replyRate: null },
        blog: { total: 0, sampled: 0, last7: 0, last30: 0 },
        feeds: { count: 0, hasMore: false, latest: null, latestTitle: null, daysSinceLatest: null, last30: 0 },
        coupons: { total: 0, titles: [], memberships: [] },
        briefing: null,
    };
    const zero = { ...BARE, category: '한식', keywords: [], detail: { hours: { registered: false, days: [] }, links: [], hasBooking: false, hasFeed: false, descriptionLength: 0, subway: null, parking: null, facilities: [], benefits: [], couponCount: 0 } };
    const zeroGeo = scoreGeo({ ...zero, category: '' }, zeroActivity, [{ keyword: 'x', state: 'done', result: { status: 'beyond', rank: null } }], { nowMs: NOW });
    const zeroAeo = scoreAeo({ ...zero, category: '' }, zeroActivity);
    assert.equal(zeroGeo.score, 0, JSON.stringify(zeroGeo.factors.map((f) => [f.key, f.pct])));
    assert.equal(zeroAeo.score, 0, JSON.stringify(zeroAeo.factors.map((f) => [f.key, f.pct])));
    assert.equal(scoreLabel(0), '보강 필요');
});

test('점수 등급 경계값', () => {
    assert.deepEqual([85, 84, 70, 69, 50, 49].map(scoreLabel), ['준비 우수', '양호', '양호', '보통', '보통', '보강 필요']);
});

test('소식이 있는데 날짜를 못 읽으면 0점이 아니라 확인 불가로 빼고 "null일 전"을 쓰지 않는다', () => {
    const activity = fullActivity({ feeds: { count: 3, hasMore: false, latest: null, latestTitle: '안내', daysSinceLatest: null, last30: 0 } });
    const geo = scoreGeo(fullPlace(), activity, null, { nowMs: NOW });
    const freshness = geo.factors.find((f) => f.key === 'freshness');
    assert.equal(freshness.evidence.includes('null'), false);
    assert.ok(freshness.evidence.includes('소식 날짜 확인 불가'));
    assert.equal(freshness.weight, 9); // 방문자 5 + 메뉴 4, 소식 6점은 분모에서 빠짐
    const check = byId(buildChecklist(fullPlace(), activity, {}));
    assert.equal(check.feed14.done, null);
});

test('답글률은 최근 리뷰가 5개 미만이면 점수에서 빼고 그 이유를 적는다', () => {
    const activity = fullActivity({ visitor: { ...fullActivity().visitor, sampled: 3, replied: 0, replyRate: 0 } });
    const qna = scoreAeo(fullPlace(), activity).factors.find((f) => f.key === 'qna');
    assert.equal(qna.weight, 7);
    assert.match(qna.evidence, /3개뿐이라 점수 제외/);
    assert.equal(byId(plan(fullPlace(), activity).actions).reply, undefined);
});

test('대표키워드 일치: "횟집"은 리뷰의 "광어회"로, 모르는 지역 접두어와 결제 시간대도 근거로 인정한다', () => {
    const place = fullPlace({
        category: '한식',
        address: '서울 강남구 언주로148길 14',
        keywords: ['강남구청횟집', '압구정횟집', '강남구청점심', '압구정회식', '강남구청파스타'],
        reviewMenus: [{ label: '광어회', count: 30 }],
        reviewThemes: [],
        reviewVotes: [],
        intro: null,
    });
    place.detail = { ...place.detail, pos: { averagePrice: { lunch: 20000 }, popularMenus: [] } };
    const result = keywordConsistency(place, { briefing: ['회식이나 모임 장소로 좋습니다.'] });
    assert.deepEqual(result.checked.map((c) => [c.keyword, c.matched]), [
        ['강남구청횟집', true], ['압구정횟집', true], ['강남구청점심', true], ['압구정회식', true], ['강남구청파스타', false],
    ]);
    // 결제 집계가 없으면 "점심"은 근거 없음
    const noPos = fullPlace({ keywords: ['강남구청점심'], reviewThemes: [], reviewVotes: [], reviewMenus: [], intro: null });
    noPos.detail = { ...noPos.detail, pos: null };
    assert.equal(keywordConsistency(noPos, null).checked[0].matched, false);
});

test('지역·"맛집"만 있는 대표키워드는 점수에서 절반만 인정한다', () => {
    const place = fullPlace({ keywords: ['강남역맛집', '강남구청맛집', '강남맛집'] });
    const result = keywordConsistency(place, fullActivity());
    assert.equal(result.ratio, null);
    assert.equal(result.score, 0.5);
    const factor = scoreGeo(place, fullActivity(), null, { nowMs: NOW }).factors.find((f) => f.key === 'keywords');
    assert.match(factor.evidence, /절반 인정/);
    assert.equal(factor.pct, Math.round(((4 + 3) / 12) * 100)); // 키워드 3개(4점) + 일치 절반(3점)
});

test('광고성 표현 검사는 "1등급 한우·11위" 같은 사실 표기를 잡지 않는다', () => {
    assert.deepEqual(findHypeWords([{ where: 'a', text: '1++ 1등급 한우 사용' }]), []);
    assert.deepEqual(findHypeWords([{ where: 'a', text: '네이버 순위 11위' }]), []);
    assert.deepEqual(findHypeWords([{ where: 'a', text: '강남 1위 곰탕' }]), [{ word: '1위', where: 'a' }]);
    assert.deepEqual(findHypeWords([{ where: 'a', text: '고객만족 1등 매장' }]), [{ word: '1등', where: 'a' }]);
});

test('네이버 AI 브리핑·쿠폰 항목: 음식점에 브리핑이 없으면 0점, 다른 업종이면 확인 불가로 뺀다', () => {
    const noBrief = fullActivity({ briefing: null, coupons: { total: 0, titles: [], memberships: [] } });
    const food = scoreGeo(fullPlace(), noBrief, null, { nowMs: NOW }).factors.find((f) => f.key === 'naverAi');
    assert.equal(food.pct, 0);
    const salon = scoreGeo(fullPlace({ category: '미용실' }), noBrief, null, { nowMs: NOW }).factors.find((f) => f.key === 'naverAi');
    assert.equal(salon.weight, 4); // 쿠폰만 계산
    assert.match(salon.evidence, /점수 제외/);
    // 쿠폰은 없어도 멤버십·결제 혜택이 있으면 절반
    const member = fullActivity({ coupons: { total: 0, titles: [], memberships: ['단골'] } });
    assert.equal(scoreGeo(fullPlace(), member, null, { nowMs: NOW }).factors.find((f) => f.key === 'naverAi').pct, 80);
    // 활동을 못 받고 상세 정보도 없으면 항목 전체가 확인 불가
    assert.equal(scoreGeo(BARE, null, null, { nowMs: NOW }).factors.find((f) => f.key === 'naverAi').pct, null);
});

test('AI별 점수에 쓰는 항목: 네이버는 브리핑·쿠폰과 플레이스 완성도, ChatGPT는 구조화 정보까지 본다', () => {
    const activity = fullActivity({ briefing: null });
    const geo = scoreGeo(fullPlace(), activity, null, { nowMs: NOW });
    const aeo = scoreAeo(fullPlace(), activity);
    const before = Object.fromEntries(platformReadiness(geo, aeo).map((p) => [p.key, p.score]));
    const geo2 = scoreGeo(fullPlace(), fullActivity(), null, { nowMs: NOW });
    const after = Object.fromEntries(platformReadiness(geo2, aeo).map((p) => [p.key, p.score]));
    assert.ok(after.naver > before.naver); // 브리핑이 생기면 네이버 점수만 오른다
    assert.equal(after.chatgpt, before.chatgpt);
    assert.equal(after.claude, before.claude);
    const thin = fullPlace({ menuPricedCount: 0, menuDescribedCount: 0 });
    const aeoThin = scoreAeo(thin, fullActivity());
    const chat = (a) => platformReadiness(geo2, a).find((p) => p.key === 'chatgpt').score;
    assert.ok(chat(aeoThin) < chat(aeo));
});

// ---- 조건형 답변 ----

test('조건형 답변은 질문의 지역·업종으로 시작하고 확인되는 조건만 쓰며 단정·비교가 없다', () => {
    const place = fullPlace();
    assert.deepEqual(placeCriteria(place).map((c) => c.key), ['walk', 'parking', 'booking', 'late', 'group', 'takeout']);
    const answer = buildCriteriaAnswer(place);
    assert.ok(answer.text.startsWith('강남구청역에서 ① 3-1번 출구 도보 5분 ② 무료 주차 ③ 네이버 예약 가능 조건으로 한식 매장을 찾는다면 분석식당이 해당합니다.'));
    assert.equal(answer.lead, answer.text.split('. ')[0] + '.');
    assert.equal(answer.question, '강남구청역 한식 중 3-1번 출구 도보 5분·무료 주차·네이버 예약 가능 조건에 맞는 곳은 어디인가요?');
    assert.ok(answer.length >= ATOMIC_MIN && answer.length <= ATOMIC_MAX, `${answer.length}`);
    assert.equal(answer.inRange, true);
    assert.deepEqual(findHypeWords([{ where: 'a', text: answer.text }]), []);
    assert.equal(/유일|뿐|보다|타 |다른 매장/.test(answer.text), false);
    // 조건이 2개 미만이면 만들지 않는다
    assert.equal(buildCriteriaAnswer(BARE), null);
    const one = fullPlace({ conveniences: [] });
    one.detail = { ...one.detail, subway: null, hasBooking: false, parking: { available: true, free: null, valet: false }, hours: null };
    assert.equal(buildCriteriaAnswer(one), null);
    // 역이 지역 이름이 아니면 역 이름을 다 쓴다
    const dong = fullPlace({ address: '서울 마포구 연남동 1' });
    dong.detail = { ...dong.detail, subway: { station: '홍대입구역', exit: null, walkMinutes: 15 } };
    assert.equal(placeCriteria(dong).some((c) => c.key === 'walk'), false); // 10분 넘으면 가깝다고 하지 않는다
});

// ---- AI 답변 실측(Share of Model) ----

test('SoM 점수표는 대화와 같다: 1위 100 · 2위 75 · 3위 55 · 4위 35 · 5위 20 · 5위 밖 15 · 안 나옴 0', () => {
    assert.deepEqual(SOM_RANKS.map(somPoints), [100, 75, 55, 35, 20, 15, 0]);
    assert.deepEqual(SOM_RANKS.map(somRankLabel), ['1위', '2위', '3위', '4위', '5위', '5위 밖', '안 나옴']);
    assert.equal(somPoints(null), 0);
    assert.equal(somRankLabel(null), '미측정');
});

test('측정 질문은 번호 목록으로 답해 달라고 덧붙이고, 확인되는 조건이 있으면 조건 질문도 만든다', () => {
    const prompts = measurePrompts(fullPlace());
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0], `강남구청역 한식 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    assert.equal(prompts[1], `주차되는, 예약 가능한 강남구청역 한식 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    assert.deepEqual(measurePrompts(BARE), [`매장 추천해줘. ${SOM_PROMPT_SUFFIX}`]);
    assert.deepEqual(measurePrompts(null), []);
});

test('답변 글에서 내 매장 순위를 읽는다: 번호 목록·굵은 글씨·표·목록 밖 언급·안 나옴', () => {
    const names = brandAliases(fullPlace());
    const answer = [
        '강남구청역 근처 한식 추천입니다.',
        '',
        '1. **다른식당**',
        '   - 위치: 강남구청역 2번 출구',
        '   - 특징: 갈비탕',
        '',
        '2. **분석 식당** — 곰탕 전문',
        '   - 주차 가능',
        '',
        '3. 셋째식당',
    ].join('\n');
    assert.equal(evaluateAnswerRank(answer, names), 2); // 띄어쓰기가 달라도 찾고, 설명 줄은 항목으로 세지 않는다
    assert.equal(evaluateAnswerRank('### 1위: 분석식당\n설명\n### 2위: 다른식당', names), 1);
    assert.equal(evaluateAnswerRank('| 순위 | 매장 |\n|---|---|\n| 1 | 다른식당 |\n| 2 | 셋째식당 |\n| 3 | 분석식당 |', names), 3);
    assert.equal(evaluateAnswerRank('- 다른식당\n- 분석식당\n- 셋째식당', names), 2); // 번호가 없으면 글머리 기호 순서
    // 5번째까지만 순위로 치고, 6번째 이후는 목록 밖 언급과 같은 "5위 밖"(15점)
    const longList = (position) => Array.from({ length: 12 }, (_, i) => `${i + 1}. ${i + 1 === position ? '분석식당' : `가게${i + 1}`}`).join('\n');
    assert.equal(evaluateAnswerRank(longList(5), names), 5);
    assert.equal(evaluateAnswerRank(longList(6), names), SOM_MENTION);
    assert.equal(evaluateAnswerRank(longList(12), names), SOM_MENTION);
    // 목록에는 없고 뒤에 덧붙인 글에만 나와도 "5위 밖"
    const tail = '1. 다른식당\n2. 셋째식당\n\n이 밖에 분석식당도 곰탕으로 알려져 있습니다.';
    assert.equal(evaluateAnswerRank(tail, names), SOM_MENTION);
    assert.equal(evaluateAnswerRank('분석식당은 곰탕이 유명합니다.', names), SOM_MENTION);
    assert.equal(evaluateAnswerRank('1. 다른식당\n2. 셋째식당', names), SOM_NONE);
    // 설명 줄의 "3번 출구" 같은 숫자는 항목으로 세지 않는다
    assert.equal(evaluateAnswerRank('1. 다른식당\n2번 출구에서 도보 3분\n3번 출구도 가깝습니다\n2. 분석식당', names), 2);
    assert.equal(evaluateAnswerRank('1번: 다른식당\n2번: 분석식당', names), 2);
    assert.equal(evaluateAnswerRank('   ', names), null);
    assert.equal(evaluateAnswerRank('1. 분석식당', []), null);
    // 지점 이름이 붙은 상호는 지점을 뺀 이름으로도 찾고, 다른 표기를 더할 수 있다
    assert.deepEqual(brandAliases({ name: '분석식당 강남구청점' }), ['분석식당강남구청점', '분석식당']);
    assert.deepEqual(brandAliases({ name: '분석식당' }, [' Bunseok ', '']), ['분석식당', 'bunseok']);
    assert.equal(evaluateAnswerRank('1. Bunseok Sikdang', brandAliases({ name: '분석식당' }, ['Bunseok'])), 1);
});

test('AI 답변 점유율은 측정한 칸만 평균하고 직전 측정과의 차이를 낸다', () => {
    // 대화의 알림 예시: ChatGPT 1위 · Claude 2위 · Gemini 1위 · 네이버 3위 → 82.5%
    const sample = shareOfModel([{ prompt: 'q', ranks: { chatgpt: 1, claude: 2, gemini: 1, naver: 3, perplexity: null } }]);
    assert.equal(sample.overall, 82.5);
    assert.equal(sample.measured, 4);
    assert.equal(sample.total, 5);
    assert.deepEqual(sample.platforms.map((p) => [p.key, p.score]), [['naver', 55], ['chatgpt', 100], ['gemini', 100], ['claude', 75], ['perplexity', null]]);
    assert.equal(sample.delta, null);

    const before = [{ prompt: 'q1', ranks: { naver: 3, chatgpt: SOM_NONE, gemini: SOM_MENTION } }, { prompt: 'q2', ranks: { naver: 5 } }];
    const after = [{ prompt: 'q1', ranks: { naver: 1, chatgpt: 4, gemini: SOM_MENTION } }, { prompt: 'q2', ranks: { naver: 2 } }];
    const result = shareOfModel(after, before);
    assert.equal(result.overall, 56.3); // (100 + 35 + 15 + 75) / 400
    assert.equal(shareOfModel(before).overall, 22.5); // (55 + 0 + 15 + 20) / 400
    assert.equal(result.delta, 33.8);
    const naver = result.platforms.find((p) => p.key === 'naver');
    assert.equal(naver.score, 87.5);
    assert.equal(naver.delta, 50);
    assert.equal(naver.best, 1);
    // 순위 변동: 3위 → 1위 = +2, 안 나옴(10) → 4위 = +6, 그대로 = 0
    const cell = (prompt, platform) => result.cells.find((c) => c.prompt === prompt && c.platform === platform).delta;
    assert.equal(cell(0, 'naver'), 2);
    assert.equal(cell(0, 'chatgpt'), 6);
    assert.equal(cell(0, 'gemini'), 0);
    assert.equal(cell(1, 'naver'), 3);
    assert.equal(shareOfModel([{ prompt: 'q', ranks: {} }]), null);
    assert.equal(shareOfModel(null), null);
    assert.equal(shareOfModel([{ prompt: 'q', ranks: { naver: 'weird', chatgpt: 9 } }]), null); // 모양이 틀린 값은 측정으로 치지 않는다
});

// ---- 복사해 쓰는 초안 ----

test('초안은 매장 사실만 채우고 모르는 값은 "직접 적기"로 비워 둔다', () => {
    const templates = byKey(buildTemplates(fullPlace(), fullActivity(), { nowMs: NOW }));
    assert.deepEqual(Object.keys(templates), ['prompts', 'sourceRequest', 'napCard', 'intro', 'feedPost', 'answerPost', 'answerPage', 'gbpDescription', 'youtube', 'reviewAsk', 'press', 'robots', 'jsonld', 'llms']);
    for (const template of Object.values(templates)) {
        assert.ok(template.label && template.where && template.text && template.notes.length > 0, template.key);
        if (template.key !== 'jsonld') assert.deepEqual(findHypeWords([{ where: template.key, text: template.text }]), [], template.key);
    }
    assert.ok(templates.prompts.text.includes(SOM_PROMPT_SUFFIX));
    // 화면 정보에 없는 전화번호·가격은 지어내지 않는다
    assert.ok(templates.napCard.text.includes('전화: (네이버 플레이스에 등록한 번호 그대로 — 직접 적기)'));
    assert.ok(templates.sourceRequest.text.includes(`대표 메뉴·가격: 곰탕, 수육 — 가격 ${TEMPLATE_BLANK}`));
    assert.ok(templates.sourceRequest.text.includes('광고 표기'));
    // 질문형 글: 질문형 제목 → 요약 → 표 → 질문·답 → 최종 수정일
    const post = templates.answerPost.text;
    assert.ok(post.includes('강남구청역 한식 추천 — 분석식당 위치·영업시간·주차·예약 (2026년 11월 기준)'));
    assert.ok(post.indexOf('[맨 위 요약') < post.indexOf('[표') && post.indexOf('[표') < post.indexOf('[질문과 답') && post.indexOf('[질문과 답') < post.indexOf('최종 수정일: 2026.11.15'));
    assert.ok(post.includes('영업시간 | 매일 10:00~22:00'));
    // 리뷰 안내문은 문구·별점을 정해 주지 않는다
    assert.ok(templates.reviewAsk.text.includes('어떤 내용을 쓰셔도 받는 혜택은 같습니다'));
    assert.equal(/5점|별점/.test(templates.reviewAsk.text), false);
    // robots.txt 는 다섯 AI의 검색 봇을 모두 허용한다
    for (const bot of ['OAI-SearchBot', 'Bingbot', 'Googlebot', 'Claude-SearchBot', 'PerplexityBot', 'Yeti']) {
        assert.ok(templates.robots.text.includes(`User-agent: ${bot}`), bot);
    }
    assert.ok(templates.robots.text.includes('Allow: /'));
    assert.equal(templates.robots.text.includes('Disallow: /'), false);
    assert.ok(templates.jsonld.text.startsWith('<script type="application/ld+json">'));
    assert.ok(templates.llms.text.startsWith('# 분석식당'));
});

test('홈페이지용 질문형 글은 스크립트 없는 HTML이고 매장 이름의 태그 글자를 이스케이프한다', () => {
    const place = fullPlace({ name: '분석<식당> & "곰탕"' });
    const html = byKey(buildTemplates(place, fullActivity(), { nowMs: NOW })).answerPage.text;
    assert.ok(html.startsWith('<section id="store-answer">'));
    assert.equal(/<script/i.test(html), false);
    assert.equal(html.includes('분석<식당>'), false);
    assert.ok(html.includes('분석&lt;식당&gt; &amp; &quot;곰탕&quot;'));
    assert.ok(html.includes('<tr><th scope="row">영업시간</th><td>매일 10:00~22:00</td></tr>'));
    assert.ok(html.includes('<time datetime="2026-11-15">2026.11.15</time>'));
    assert.equal(/aggregateRating|ratingValue/i.test(html), false);
});

test('정보가 빈 매장의 초안은 빈칸을 그대로 드러내고 "매장 매장" 같은 어색한 말을 만들지 않는다', () => {
    const rows = Object.fromEntries(factRows(BARE).map((row) => [row.label, row.value]));
    assert.equal(rows['주소'], TEMPLATE_BLANK);
    assert.equal(rows['영업시간'], TEMPLATE_BLANK);
    assert.equal(rows['업종'], TEMPLATE_BLANK);
    assert.ok(rows['주차'].startsWith(TEMPLATE_BLANK));
    const templates = byKey(buildTemplates(BARE, null, { nowMs: NOW }));
    for (const template of Object.values(templates)) assert.equal(template.text.includes('매장 매장'), false, template.key);
    assert.equal(buildAtomicAnswer(BARE, null).text, '빈가게는 매장입니다.');
    assert.ok(templates.feedPost.text.includes('빈가게 — 11월 영업시간·주차·예약 안내'));
    assert.deepEqual(buildTemplates(null), []);
    // 요일마다 영업시간이 다르면 요일별로 적는다
    const mixed = fullPlace();
    mixed.detail = { ...mixed.detail, hours: { registered: true, days: [{ day: '월', start: '11:00', end: '21:00' }, { day: '토', start: '12:00', end: '23:00' }], regularClosed: '일요일' } };
    assert.equal(Object.fromEntries(factRows(mixed).map((row) => [row.label, row.value]))['영업시간'], '월 11:00~21:00 / 토 12:00~23:00 (정기휴무: 일요일)');
});

// ---- 홈페이지용 자료 ----

test('업종에 맞는 schema.org 유형을 고른다', () => {
    assert.equal(schemaType('한식'), 'Restaurant');
    assert.equal(schemaType('카페,디저트'), 'CafeOrCoffeeShop');
    assert.equal(schemaType('피부과'), 'MedicalClinic');
    assert.equal(schemaType('미용실'), 'HairSalon');
    assert.equal(schemaType('필라테스'), 'ExerciseGym');
    assert.equal(schemaType('세탁소'), 'LocalBusiness');
});

test('LocalBusiness 구조화 데이터는 평점을 넣지 않고 영업시간·좌표·FAQ를 담으며 < 를 이스케이프한다', () => {
    const place = fullPlace({ name: '분석<식당>' });
    const html = buildLocalBusinessJsonLd(place, buildFanout(place, null));
    assert.ok(html.startsWith('<script type="application/ld+json">'));
    const json = JSON.parse(html.replace(/^<script[^>]*>\n/, '').replace(/\n<\/script>$/, ''));
    const [business, faq] = json['@graph'];
    assert.equal(business['@type'], 'Restaurant');
    assert.equal(business.name, '분석<식당>');
    assert.equal(html.includes('분석<식당>'), false); // 태그처럼 보이지 않게 이스케이프
    assert.equal('aggregateRating' in business, false);
    assert.equal(business.openingHoursSpecification.length, 7);
    assert.equal(business.openingHoursSpecification[0].dayOfWeek, 'https://schema.org/Monday');
    assert.deepEqual(business.geo, { '@type': 'GeoCoordinates', latitude: 37.51, longitude: 127.04 });
    assert.deepEqual(business.sameAs, ['https://m.place.naver.com/place/2025884279/home']);
    assert.equal(faq['@type'], 'FAQPage');
    assert.ok(faq.mainEntity.length >= 6);
});

test('llms.txt 초안은 원자 답변·기본 정보·리뷰 평가·자주 묻는 질문을 담는다', () => {
    const text = buildLlmsTxt(fullPlace(), fullActivity());
    assert.ok(text.startsWith('# 분석식당\n\n> 분석식당은'));
    assert.ok(text.includes('- 가까운 역: 강남구청역 3-1번 출구 도보 5분'));
    assert.ok(text.includes('- 음식이 맛있어요 (120명)'));
    assert.ok(text.includes('### Q. 분석식당은 어디에 있고 어떻게 가나요?'));
    assert.ok(text.includes('https://m.place.naver.com/place/2025884279/home'));
});

// ---- 경쟁 비교 ----

const TOP = [
    { rank: 1, placeId: '1', name: 'A', isTarget: false, visitorReviews: 900, blogReviews: 300, score: 4.7, imageCount: 50, saveText: '5,000+', hasBooking: true, hasOrder: true, couponCount: 1, hasNPay: true },
    { rank: 2, placeId: '2', name: 'B', isTarget: false, visitorReviews: 500, blogReviews: 100, score: 4.5, imageCount: 30, saveText: '1,000+', hasBooking: true, hasOrder: false, couponCount: 0, hasNPay: false },
    { rank: 3, placeId: '777', name: '내 매장', isTarget: true, visitorReviews: 100, blogReviews: 20, score: 4.2, imageCount: 5, saveText: '~100', hasBooking: false, hasOrder: false, couponCount: 0, hasNPay: false },
];

test('GEO 신호 지수는 같은 목록 안 백분위 평균이고 내 매장 위치를 알려 준다', () => {
    const result = compareGeoSignals({ keyword: 'k', top: TOP, target: TOP[2] });
    const byName = Object.fromEntries(result.rows.map((row) => [row.name, row.index]));
    assert.equal(byName.A, 100);
    assert.equal(byName['내 매장'], 0);
    assert.equal(result.mine, 0);
    assert.equal(result.position, 3);
    assert.equal(result.top5Average, Math.round((100 + byName.B) / 2));
    assert.equal(compareGeoSignals(null), null);
    assert.equal(compareGeoSignals({ top: [] }), null);
});

test('내 매장이 목록 밖이면 매장 정보로 비교 행을 만든다', () => {
    const others = TOP.filter((row) => !row.isTarget);
    const result = compareGeoSignals({ keyword: 'k', top: others, target: null }, { placeId: '777', name: '내 매장', visitorReviews: 600, blogReviews: 50, visitorScore: 4.6 });
    const mine = result.rows.find((row) => row.isTarget);
    assert.equal(mine.rank, null);
    assert.ok(mine.index > 0 && mine.index < 100);
});

test('매장 화면 정보만으로 낸 점수와 경쟁 매장이 앞선 항목', () => {
    const mine = placeOnlyScores(BARE);
    const rival = summarizeRival(fullPlace());
    assert.equal(rival.placeId, '2025884279');
    assert.ok(rival.geo > mine.geo);
    assert.ok(rival.aeo > mine.aeo);
    const gaps = rivalGaps(mine, rival);
    assert.equal(gaps.length, 2);
    assert.ok(gaps[0].gap >= gaps[1].gap);
    assert.deepEqual(rivalGaps(rival, rival), []);
});

test('경쟁 매장 비교 입력은 1~3곳의 숫자 ID만 받는다', () => {
    assert.equal(geoRivalsSchema.safeParse({ placeIds: ['12345', '67890'] }).success, true);
    assert.equal(geoRivalsSchema.safeParse({ placeIds: [] }).success, false);
    assert.equal(geoRivalsSchema.safeParse({ placeIds: ['12345', '23456', '34567', '45678'] }).success, false);
    assert.equal(geoRivalsSchema.safeParse({ placeIds: ['abc'] }).success, false);
});

// ---- 한 번에 ----

test('analyzeGeoAeo 는 화면에 필요한 묶음을 한 번에 돌려준다', () => {
    const ranks = [{ keyword: '강남구청곰탕', state: 'done', result: { status: 'found', rank: 2 } }];
    const result = analyzeGeoAeo({ place: fullPlace(), activity: fullActivity(), ranks, nowMs: NOW });
    for (const key of ['question', 'geo', 'aeo', 'fanout', 'coverage', 'atomic', 'criteria', 'prompts', 'aliases', 'templates', 'hype', 'consistency', 'share', 'platforms', 'actions', 'projected', 'checklist']) {
        assert.ok(key in result, key);
    }
    assert.equal(result.share.score, 75);
    assert.equal(result.platforms.length, 5);
    assert.deepEqual(result.aliases, ['분석식당']);
    assert.equal(analyzeGeoAeo({ place: null }), null);
});
