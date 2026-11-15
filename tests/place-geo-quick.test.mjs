import test from 'node:test';
import assert from 'node:assert/strict';
import {
    QUICK_PLATFORMS, QUICK_CHECK_PREFIX, QUICK_DIFFICULTY, claimWindows, durationLabel, clockAt, quickFactSheet,
    buildQuickStrategies, buildQuickTimeline, buildOneDayPlan, quickSummary,
} from '../lib/place-geo-quick.js';
import { PLATFORMS, GEO_DONTS, externalSteps, findHypeWords, buildAtomicAnswer, targetQuestion } from '../lib/place-geo.js';

// 고정 시각(2026-11-15 12:00 KST). 네트워크 호출은 없습니다.
const NOW = Date.parse('2026-11-15T03:00:00Z');
const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

function fullPlace(overrides = {}) {
    return {
        placeId: '2025884279',
        name: '분석식당',
        category: '한식',
        address: '서울 강남구 분석로 2',
        visitorReviews: 320,
        visitorScore: 4.52,
        blogReviews: 85,
        textReviews: 200,
        intro: '강남구청역 곰탕 전문',
        conveniences: ['단체 이용 가능', '포장'],
        paymentInfo: ['제로페이'],
        hasTalktalk: true,
        hasBlog: true,
        hasPhone: true,
        hasOpeningHours: true,
        missing: { description: false },
        menuCount: 10,
        menuPricedCount: 10,
        menuDescribedCount: 8,
        reviewThemes: [{ label: '맛', count: 40 }],
        reviewMenus: [{ label: '곰탕', count: 30 }, { label: '수육', count: 10 }],
        reviewVotes: [{ label: '음식이 맛있어요', count: 120 }],
        keywords: ['강남구청곰탕'],
        detail: {
            hours: { registered: true, days: WEEK.map((day) => ({ day, start: '10:00', end: '22:00', breaks: [], lastOrder: null })), regularClosed: null },
            pos: null,
            couponCount: 1,
            hasFeed: true,
            hasBooking: true,
            parking: { available: true, free: true, valet: false },
            facilities: ['무선 인터넷'],
            descriptionLength: 180,
            links: ['인스타그램', '홈페이지', '유튜브'],
            subway: { station: '강남구청역', exit: '3-1', walkMinutes: 5 },
            menuUpdatedAt: '26.11.08',
            benefits: [],
        },
        ...overrides,
    };
}

// 홈페이지·블로그·유튜브가 없는 매장
function plainPlace() {
    const place = fullPlace({ hasBlog: false });
    place.detail = { ...place.detail, links: ['인스타그램'] };
    return place;
}

const BARE = { placeId: '9', name: '빈가게', category: '', address: '', hasBlog: false, reviewMenus: [], detail: null };
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

// ---- 시간 표기 ----

test('시간 표기: 분·시간 단위를 맞추고 0분은 "즉시"로 쓴다', () => {
    assert.deepEqual([15, 60, 90, 360, 1440, 2880, 0].map(durationLabel), ['15분', '1시간', '1시간 30분', '6시간', '24시간', '48시간', '즉시']);
});

test('시작 시각에 분을 더한 시각: 날을 넘기면 "다음 날"·"모레"·"N일 뒤", 못 읽는 값은 09:00 기준', () => {
    assert.equal(clockAt('09:00', 75), '10:15');
    assert.equal(clockAt('9:05', 0), '09:05');
    assert.equal(clockAt('23:30', 45), '다음 날 00:15');
    assert.equal(clockAt('15:30', 1440), '다음 날 15:30');
    assert.equal(clockAt('15:30', 2880), '모레 15:30');
    assert.equal(clockAt('15:30', 4320), '3일 뒤 15:30');
    assert.equal(clockAt('', 30), '09:30');
    assert.equal(clockAt('25:00', 0), '09:00');
});

// ---- 반영 시간: 출처는 lib/place-geo.js 하나 ----

test('claim 글을 구간으로 읽는다: 범위·조건·분 단위, 숫자가 아닌 값은 열린 구간', () => {
    assert.deepEqual(claimWindows('3~24시간'), [{ text: '3~24시간', range: '3~24시간', note: '', min: 180, max: 1440 }]);
    assert.deepEqual(claimWindows('1~12시간(활동 중인 유튜브 채널 기준)'), [
        { text: '1~12시간(활동 중인 유튜브 채널 기준)', range: '1~12시간', note: '활동 중인 유튜브 채널 기준', min: 60, max: 720 },
    ]);
    assert.deepEqual(claimWindows('이미 잡힌 글 수정은 즉시~24시간 · 새 글은 12~48시간').map((w) => [w.range, w.note, w.min, w.max]), [
        ['즉시~24시간', '이미 잡힌 글 수정', 0, 1440],
        ['12~48시간', '새 글', 720, 2880],
    ]);
    assert.deepEqual(claimWindows('30분~3시간').map((w) => [w.min, w.max]), [[30, 180]]); // 앞뒤 단위가 다른 범위
    assert.deepEqual(claimWindows('1~3일').map((w) => [w.min, w.max]), [[1440, 4320]]);
    assert.deepEqual(claimWindows('수일'), [{ text: '수일', range: '수일', note: '', min: null, max: null }]);
    assert.deepEqual(claimWindows(''), []);
    assert.deepEqual(claimWindows(null), []);
});

test('AI 탭은 진단·로드맵과 같은 다섯 AI이고 반영 시간은 PLATFORMS[].claim 그대로다', () => {
    assert.deepEqual(QUICK_PLATFORMS.map((p) => p.key), ['naver', 'chatgpt', 'gemini', 'claude', 'perplexity']);
    assert.deepEqual(QUICK_PLATFORMS.map((p) => [p.key, p.label, p.claim]), PLATFORMS.map((p) => [p.key, p.short, p.claim]));
    for (const p of QUICK_PLATFORMS) assert.deepEqual(p.windows, claimWindows(p.claim), p.key);
    // QA 정정값(이 값이 바뀌면 타임라인·다시 재는 날도 함께 바뀌므로 여기서 알아챕니다)
    assert.deepEqual(QUICK_PLATFORMS.map((p) => p.windows.map((w) => w.range).join(' / ')), [
        '3~24시간', '2~12시간', '1~12시간', '즉시~24시간 / 12~48시간', '수일',
    ]);
});

// ---- 전략 ----

test('다섯 AI 모두 전략이 있고 전략마다 반영 시간·난이도·3단계·주의사항을 갖춘다', () => {
    const quick = buildQuickStrategies(fullPlace(), null, { nowMs: NOW });
    const count = (key) => quick.filter((s) => s.platform === key).length;
    assert.deepEqual(QUICK_PLATFORMS.map((p) => [p.key, count(p.key)]), [['naver', 3], ['chatgpt', 3], ['gemini', 3], ['claude', 2], ['perplexity', 2]]);
    assert.equal(new Set(quick.map((s) => s.id)).size, quick.length);
    for (const s of quick) {
        assert.equal(s.steps.length, 3, s.id);
        assert.equal(s.stepIds.length, 3, s.id);
        assert.ok(s.stepIds.every((id) => id.startsWith(`${QUICK_CHECK_PREFIX}${s.id}:`)), s.id);
        assert.ok(s.cautions.length >= 1, s.id);
        assert.ok(s.title && s.why && s.short && s.eta, s.id);
        assert.equal(s.difficultyLabel, QUICK_DIFFICULTY[s.difficulty], s.id);
        assert.ok(s.effortMinutes > 0, s.id);
        // 이 파일이 따로 정한 반영 시간 숫자는 없다
        assert.equal('minMinutes' in s || 'maxMinutes' in s || 'window' in s, false, s.id);
    }
    assert.equal(buildQuickStrategies(null).length, 0);
});

test('카드의 반영 시간은 로드맵의 같은 단계 값, 없으면 그 AI의 claim 이다(초반의 15분~6시간 주장은 쓰지 않는다)', () => {
    const place = fullPlace();
    const quick = byId(buildQuickStrategies(place, null, { nowMs: NOW }));
    const road = Object.fromEntries(externalSteps(place, null).map((step) => [step.id, step.eta]));
    const ai = Object.fromEntries(QUICK_PLATFORMS.map((p) => [p.key, p.windows.map((w) => w.range)]));
    const expected = {
        'naver-feed': ai.naver[0], 'naver-cafe': ai.naver[0], 'naver-collect': road.faqPage, // 질문형 글 발행은 로드맵에도 있는 일
        'chatgpt-fetch': road.bingWebmaster, 'chatgpt-reddit': ai.chatgpt[0], 'chatgpt-news': road.press,
        'gemini-live': road.youtube, 'gemini-gbp': road.gbp, 'gemini-websub': road.searchConsole,
        'claude-refresh': ai.claude[0], 'claude-gist': ai.claude[1], // 이미 잡힌 글 수정 · 새 글
        'perplexity-post': road.faqPage, 'perplexity-profiles': ai.perplexity[0],
    };
    assert.deepEqual(Object.fromEntries(Object.values(quick).map((s) => [s.id, s.eta])), expected);
    assert.ok(Object.values(expected).every(Boolean));
    for (const s of Object.values(quick)) {
        assert.equal(s.etaFrom, ['naver-collect', 'chatgpt-fetch', 'chatgpt-news', 'gemini-live', 'gemini-gbp', 'gemini-websub', 'perplexity-post'].includes(s.id) ? 'step' : 'ai', s.id);
    }
    // 지금 값으로는 이렇게 보인다
    assert.equal(quick['naver-feed'].eta, '3~24시간');
    assert.equal(quick['naver-collect'].eta, '2~5일');
    assert.equal(quick['chatgpt-news'].eta, '1~3일');
    assert.equal(quick['claude-refresh'].eta, '즉시~24시간');
    assert.equal(quick['claude-gist'].eta, '12~48시간');
    assert.equal(quick['perplexity-profiles'].eta, '수일');
    // 실행 단계·이유·주의사항·준비물에 "몇 분 뒤·몇 시간 안에" 같은 반영 시간 주장을 따로 적지 않는다
    for (const s of Object.values(quick)) {
        for (const text of [s.title, s.why, s.needs || '', ...s.steps, ...s.cautions]) {
            assert.equal(/\d\s*(분|시간|일)\s*(뒤|후|안에|만에|이내)/.test(text), false, `${s.id}: ${text}`);
        }
    }
});

test('"지금 바로"와 "준비 필요"는 매장에 연결된 채널과 체크한 일로 갈린다', () => {
    const when = (items) => Object.fromEntries(items.map((s) => [s.id, s.when]));
    const full = when(buildQuickStrategies(fullPlace(), null, { nowMs: NOW }));
    // 홈페이지·블로그·유튜브가 연결된 매장: 레딧·보도자료·구글 프로필만 준비 필요
    assert.deepEqual(Object.keys(full).filter((id) => full[id] === 'prep'), ['chatgpt-reddit', 'chatgpt-news', 'gemini-gbp']);
    // 구글 비즈니스 프로필 등록을 체크하면 구글 문답이 지금 바로로 옮겨진다
    assert.equal(when(buildQuickStrategies(fullPlace(), null, { done: ['gbp'], nowMs: NOW }))['gemini-gbp'], 'now');
    // 채널이 없는 매장: 플레이스 소식·카페 답글·공개 문서·매장 페이지 맞추기만 지금 바로
    const plain = buildQuickStrategies(plainPlace(), null, { nowMs: NOW });
    assert.deepEqual(plain.filter((s) => s.when === 'now').map((s) => s.id), ['naver-feed', 'naver-cafe', 'claude-gist', 'perplexity-profiles']);
    for (const s of plain) assert.equal(Boolean(s.needs), s.when === 'prep', s.id); // 준비 필요에는 준비물을 적는다
    // 블로그만 있으면 WebSub 핑·내 글 고치기·요약 글은 되고, 서치어드바이저 수집 요청(소유 확인 필요)은 준비 필요
    const blogOnly = when(buildQuickStrategies({ ...plainPlace(), hasBlog: true }, null, { nowMs: NOW }));
    assert.equal(blogOnly['gemini-websub'], 'now');
    assert.equal(blogOnly['claude-refresh'], 'now');
    assert.equal(blogOnly['perplexity-post'], 'now');
    assert.equal(blogOnly['naver-collect'], 'prep');
});

test('초안은 매장 사실로 채우고 광고성 표현이 없으며, 댓글 초안은 매장 관계자임을 밝힌다', () => {
    const place = fullPlace();
    const quick = byId(buildQuickStrategies(place, null, { nowMs: NOW }));
    for (const s of Object.values(quick)) {
        if (s.draft) assert.deepEqual(findHypeWords([{ where: s.id, text: s.draft.text }]), [], s.id);
    }
    const cafe = quick['naver-cafe'].draft.text;
    assert.ok(cafe.startsWith('안녕하세요, 분석식당 사장입니다(매장 관계자입니다).'));
    assert.ok(cafe.includes('- 영업시간: 매일 10:00~22:00'));
    assert.ok(cafe.includes('- 주차: 가능(무료)'));
    assert.ok(quick['chatgpt-reddit'].draft.text.startsWith("Disclosure: I'm the owner of 분석식당"));
    // 손님인 척·여러 계정은 주의사항에서 금지로 적는다(GEO_DONTS 와 같은 기준)
    assert.ok(quick['naver-cafe'].cautions.some((c) => c.includes('손님인 척') && c.includes('여러 계정')));
    assert.ok(quick['gemini-gbp'].cautions.some((c) => c.includes('여러 계정')));
    assert.ok(quick['gemini-live'].cautions.some((c) => c.includes('반복')));
    // 타겟 질문이 소식 제목·라이브 제목·실행 단계에 들어간다
    const question = targetQuestion(place);
    assert.ok(quick['naver-feed'].draft.text.includes(`${question}? 분석식당 곰탕·위치·영업시간 안내`));
    assert.ok(quick['gemini-live'].draft.text.startsWith(`[제목] ${question}? 분석식당 3분 정리`));
    assert.ok(quick['naver-feed'].steps[0].includes(`"${question}"`));
    assert.ok(quick['chatgpt-fetch'].draft.text.includes('강남구청역에서 곰탕 잘하고 주차 되는 한식 알려줘.'));
    assert.equal(quick['gemini-websub'].draft, null);
    // Perplexity: 질문형 제목에 연도를 넣고, 날짜만 바꾸는 것은 금지로 적는다(GEO_DONTS 와 같은 기준)
    assert.ok(quick['perplexity-post'].steps[0].includes(`"${question} (2026년 기준)"`));
    assert.ok(quick['perplexity-post'].cautions.some((c) => c.includes('날짜만 바꾸지')));
    assert.ok(GEO_DONTS.some((item) => item.title.includes('글 날짜만 바꾸기')));
    assert.ok(quick['perplexity-profiles'].title.startsWith('카카오맵·캐치테이블·테이블링의 매장 정보')); // 업종(한식)에 맞는 서비스
    assert.ok(quick['perplexity-profiles'].draft.text.startsWith('상호: 분석식당\n업종: 한식'));
    // 공개 문서는 매장이 직접 만든 자료임을 밝히게 한다
    assert.ok(quick['claude-gist'].steps[0].includes('매장이 직접 정리한 자료'));
});

test('스펙 표는 원자 답변·사실 표·자주 묻는 질문을 담고 평점·순위는 넣지 않는다', () => {
    const place = fullPlace({ address: '서울 강남구 분석로 2 | 1층' });
    const sheet = quickFactSheet(place, null, { nowMs: NOW });
    assert.ok(sheet.startsWith('# 분석식당 — 강남구청역 한식 추천\n\n분석식당은'));
    assert.ok(sheet.includes(buildAtomicAnswer(place, null).text));
    assert.ok(sheet.includes('| 주소 | 서울 강남구 분석로 2 \\| 1층 |')); // 표가 깨지지 않게 | 를 이스케이프
    assert.ok(sheet.includes('| 가까운 역 | 강남구청역 3-1번 출구 도보 5분 |'));
    assert.ok(sheet.includes('| 네이버 플레이스 | https://m.place.naver.com/place/2025884279/home |'));
    assert.ok(sheet.includes('**Q. 분석식당은 어디에 있고 어떻게 가나요?**'));
    assert.ok(sheet.endsWith('_기준일 2026.11.15 · 출처: 네이버 플레이스 등록 정보_'));
    assert.equal(sheet.includes('| 평점'), false);
    // 정보가 없는 매장은 모르는 항목을 지어내지 않는다
    const bare = quickFactSheet(BARE, null, { nowMs: NOW });
    assert.equal(bare.includes('| 주소'), false);
    assert.equal(bare.includes('## 자주 묻는 질문'), false);
    assert.equal(quickFactSheet(null), '');
});

// ---- 타임라인 ----

test('타임라인은 AI의 claim 구간을 한 축에 놓는다: 눈금은 claim 에 나온 시각, "수일"은 끝의 열린 칸', () => {
    const timeline = buildQuickTimeline();
    assert.deepEqual(timeline.ticks.map((tick) => tick.label), ['즉시', '1시간', '2시간', '3시간', '12시간', '24시간', '48시간']);
    assert.equal(timeline.open, true);
    assert.equal(timeline.columns, 7); // 눈금 사이 6칸 + 열린 칸 1
    assert.deepEqual(timeline.rows.map((row) => [row.key, row.label, row.note, row.range, row.from, row.to]), [
        ['naver-0', '네이버 AI', '', '3~24시간', 4, 6],
        ['chatgpt-0', 'ChatGPT', '', '2~12시간', 3, 5],
        ['gemini-0', 'Gemini', '활동 중인 유튜브 채널 기준', '1~12시간', 2, 5],
        ['claude-0', 'Claude', '이미 잡힌 글 수정', '즉시~24시간', 1, 6],
        ['claude-1', 'Claude', '새 글', '12~48시간', 5, 7],
        ['perplexity-0', 'Perplexity', '', '수일', 7, 8],
    ]);
    // 막대는 눈금 선에 정확히 놓인다
    for (const row of timeline.rows.filter((r) => r.max !== null)) {
        assert.equal(timeline.ticks[row.from - 1].minutes, row.min, row.key);
        assert.equal(timeline.ticks[row.to - 1].minutes, row.max, row.key);
    }
    assert.ok(timeline.rows.every((row) => row.from >= 1 && row.to > row.from && row.to <= timeline.columns + 1));
    // 열린 구간이 없으면 열린 칸도 없다
    const closed = buildQuickTimeline([{ key: 'a', label: 'A', windows: claimWindows('1~2시간') }]);
    assert.deepEqual([closed.open, closed.columns, closed.rows[0].from, closed.rows[0].to], [false, 1, 1, 2]);
    assert.deepEqual(buildQuickTimeline([]), { ticks: [], open: false, columns: 0, rows: [] });
});

// ---- 하루 플랜 ----

test('하루 플랜은 기준점 기록으로 시작해 지금 바로 되는 일을 먼저 두고, claim 끝에 맞춘 다시 재기로 끝난다', () => {
    const quick = buildQuickStrategies(fullPlace(), null, { nowMs: NOW });
    const plan = buildOneDayPlan(quick);
    const ids = plan.steps.map((step) => step.id);
    assert.deepEqual(ids.slice(0, 2), ['day-measure', 'day-material']);
    assert.deepEqual(ids.slice(-2), ['day-remeasure1', 'day-remeasure2']);
    assert.equal(plan.steps.filter((step) => step.kind === 'strategy').length, quick.length);
    assert.ok(plan.steps[0].title.includes('AI 5곳'));
    // 준비가 필요한 통로는 지금 바로 되는 통로 뒤에 온다
    const whens = plan.steps.filter((step) => step.kind === 'strategy').map((step) => step.when);
    assert.deepEqual(whens, [...whens].sort((a, b) => (a === b ? 0 : a === 'now' ? -1 : 1)));
    // 질문형 글을 먼저 만들고 그 글을 다듬고 알리는 일(요약·핑·봇)이 뒤따른다
    assert.ok(ids.indexOf('day-naver-collect') < ids.indexOf('day-perplexity-post'));
    assert.ok(ids.indexOf('day-naver-collect') < ids.indexOf('day-gemini-websub'));
    assert.ok(ids.indexOf('day-naver-collect') < ids.indexOf('day-chatgpt-fetch'));
    // 시간은 앞 일이 끝난 뒤부터 이어지고, 작업 시간 합이 workMinutes · 지금 바로 되는 일만 더한 것이 nowMinutes
    const work = plan.steps.filter((step) => step.kind !== 'remeasure');
    work.forEach((step, i) => {
        if (i > 0) assert.equal(step.offset, work[i - 1].offset + work[i - 1].minutes, step.id);
    });
    assert.equal(plan.workMinutes, work.reduce((sum, step) => sum + step.minutes, 0));
    assert.equal(plan.nowMinutes, work.filter((step) => step.when === 'now').reduce((sum, step) => sum + step.minutes, 0));
    assert.ok(plan.nowMinutes < plan.workMinutes);
    assert.ok(plan.workMinutes <= 8 * 60, `작업 시간 ${plan.workMinutes}분`); // 하루 안에 끝나는 분량
    // 전략 단계는 카드와 같은 반영 시간 글·같은 체크 id 를 쓴다
    const feed = plan.steps.find((step) => step.id === 'day-naver-feed');
    const feedStrategy = quick.find((s) => s.id === 'naver-feed');
    assert.equal(feed.eta, feedStrategy.eta);
    assert.deepEqual(feed.checkIds, feedStrategy.stepIds);
    assert.equal(plan.steps.find((step) => step.id === 'day-chatgpt-news').eta, '1~3일');
    assert.equal('expect' in feed, false); // 분 단위 반영 기대 시각은 만들지 않는다
    // 다시 재기: claim 끝이 24시간 이내인 AI는 작업을 끝내고 24시간 뒤, 48시간인 AI는 48시간 뒤(끝낸 시각은 30분 단위로 올림)
    const [first, second] = plan.steps.slice(-2);
    const base = Math.ceil(plan.workMinutes / 30) * 30;
    assert.deepEqual([first.offset, second.offset], [base + 1440, base + 2880]);
    assert.equal(first.title, '1차 다시 재기 — 네이버 AI·ChatGPT·Gemini·Claude(이미 잡힌 글 수정) 확인');
    assert.equal(second.title, '2차 다시 재기 — Claude(새 글) 확인');
    assert.ok(first.detail.startsWith('작업을 끝내고 24시간 뒤입니다'));
    assert.ok(second.detail.startsWith('작업을 끝내고 48시간 뒤입니다'));
    // 숫자로 적히지 않은 AI(Perplexity, 수일)는 주간 측정으로 넘긴다
    assert.deepEqual(plan.later, ['Perplexity']);
    assert.ok(second.detail.includes('Perplexity') && second.detail.includes('주간 측정'));
    assert.equal(first.detail.includes('Perplexity'), false);
    assert.equal(plan.endOffset, second.offset + second.minutes);
});

test('채널이 없는 매장도 하루 플랜이 나오고 준비 필요한 일을 뒤로 미룬다', () => {
    const plan = buildOneDayPlan(buildQuickStrategies(BARE, null, { nowMs: NOW }));
    const strategy = plan.steps.filter((step) => step.kind === 'strategy');
    assert.deepEqual(strategy.slice(0, 4).map((step) => step.id), ['day-naver-feed', 'day-claude-gist', 'day-perplexity-profiles', 'day-naver-cafe']);
    assert.ok(strategy.slice(4).every((step) => step.when === 'prep'));
    assert.deepEqual(buildOneDayPlan([]).steps.map((step) => step.id), ['day-measure', 'day-material', 'day-remeasure1', 'day-remeasure2']);
    assert.equal(buildOneDayPlan([]).nowMinutes, 35);
});

// ---- AI별 요약 ----

test('AI별 요약은 지금 바로 할 수 있는 수·끝낸 수와 그 AI의 반영 시간을 준다', () => {
    const quick = buildQuickStrategies(fullPlace(), null, { nowMs: NOW });
    const feed = quick.find((s) => s.id === 'naver-feed');
    const summary = Object.fromEntries(quickSummary(quick, [...feed.stepIds, 'quick:naver-cafe:1']).map((p) => [p.key, p]));
    assert.deepEqual(Object.keys(summary), ['naver', 'chatgpt', 'gemini', 'claude', 'perplexity']);
    assert.deepEqual([summary.naver.total, summary.naver.now, summary.naver.prep, summary.naver.done], [3, 3, 0, 1]); // 3단계를 모두 체크한 전략만 끝낸 것으로
    assert.deepEqual([summary.chatgpt.now, summary.chatgpt.prep], [1, 2]);
    assert.deepEqual([summary.perplexity.total, summary.perplexity.now], [2, 2]);
    assert.equal(summary.gemini.label, 'Gemini');
    assert.equal(summary.claude.claim, PLATFORMS.find((p) => p.key === 'claude').claim);
    // 채널이 없는 매장: ChatGPT·Gemini 는 지금 바로 할 수 있는 것이 없다
    const none = Object.fromEntries(quickSummary(buildQuickStrategies(BARE, null, { nowMs: NOW })).map((p) => [p.key, p]));
    assert.deepEqual([none.chatgpt.now, none.gemini.now, none.perplexity.now], [0, 0, 1]);
});
