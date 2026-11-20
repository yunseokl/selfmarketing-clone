import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AI_GUIDES, PROMPT_KINDS, REMEASURE_DAYS,
    aiOpenUrl, alignPrevious, analyzeAnswer, buildPromptSet, dayLabel, extractSources, isToday, mergeResults, naverQuery, promptFor,
    rankAdvice, remeasureStatus, somCsv, somOf, somReportText, somTrend,
} from '../lib/place-geo-prompts.js';
import {
    PLATFORMS, SOM_MENTION, SOM_NONE, SOM_PROMPT_SUFFIX, brandAliases, evaluateAnswerRank, findHypeWords, measurePrompts,
} from '../lib/place-geo.js';

// 네트워크 호출은 없습니다. 날짜는 고정 시각(2026-11-15 12:00 KST)으로 계산합니다.
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
            hasBooking: true,
            parking: { available: true, free: true, valet: false },
            facilities: ['무선 인터넷'],
            pet: null,
            links: ['홈페이지'],
            subway: { station: '강남구청역', exit: '3-1', walkMinutes: 5 },
            benefits: [],
        },
        ...overrides,
    };
}

const BARE = {
    placeId: '9', name: '빈가게', category: '', address: '', visitorReviews: 0, visitorScore: null, blogReviews: 0,
    conveniences: [], paymentInfo: [], hasTalktalk: false, hasPhone: false, hasOpeningHours: false,
    menuCount: 0, reviewThemes: [], reviewMenus: [], reviewVotes: [], keywords: [], detail: null,
};

const ANSWER = [
    '강남구청역 근처 한식 추천입니다.',
    '',
    '1. **다른식당**',
    '   - 위치: 강남구청역 2번 출구',
    '',
    '2. **분석 식당** — 곰탕 전문, 주차 가능',
    '   - 출처: https://blog.naver.com/someone/123',
    '',
    '3. [셋째식당](https://m.place.naver.com/place/777/home): 수육이 유명',
    '',
    '참고: https://www.youtube.com/watch?v=abc, https://example.com/guide.',
].join('\n');

// ---- 질문 세트 ----

test('질문 세트: 업종 이름이 넓은 "한식"이면 질문은 중심 낱말(곰탕)로 묻고, 같은 낱말의 대표 메뉴 질문은 따로 만들지 않는다', () => {
    const place = fullPlace();
    assert.equal(place.category, '한식');
    const prompts = buildPromptSet(place);
    assert.deepEqual(prompts.map((p) => p.id), ['rank-basic', 'rank-combo', 'rank-late', 'source-cite', 'fact-info', 'fact-know', 'follow-price', 'follow-visit']);
    assert.equal(prompts[0].text, `강남구청역 곰탕 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    // 매장을 설명하는 문구(아는지 묻는 질문의 괄호)는 실제 업종 이름 그대로
    assert.match(prompts.find((p) => p.id === 'fact-info').text, /^분석식당\(강남구청역 한식\)/);
});

test('질문 세트는 기록용 순위 질문을 앞에 두고, 기본 두 질문은 측정 질문과 글자까지 같다', () => {
    const place = { ...fullPlace(), category: '국밥' }; // 업종 이름이 쓸 만한 말이면 업종 이름 그대로 묻는다
    const prompts = buildPromptSet(place);
    assert.deepEqual(prompts.map((p) => p.id), [
        'rank-basic', 'rank-combo', 'rank-menu', 'rank-late', 'source-cite', 'fact-info', 'fact-know', 'follow-price', 'follow-visit',
    ]);
    // 이미 저장된 기록과 이어지도록 기본 두 질문은 measurePrompts 와 같아야 한다
    assert.deepEqual(prompts.filter((p) => p.core).map((p) => p.text), measurePrompts(place));
    assert.deepEqual(prompts.filter((p) => p.kind === 'rank').map((p) => p.core), [true, true, false, false]);
    assert.equal(prompts[2].text, `강남구청역에서 곰탕 잘하는 곳 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    assert.equal(prompts[3].text, `늦게까지 하는 강남구청역 국밥 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    // 순위 질문은 모두 번호 목록으로 답해 달라고 덧붙인다(순위를 읽기 위해)
    for (const prompt of prompts.filter((p) => p.kind === 'rank')) assert.ok(prompt.text.endsWith(SOM_PROMPT_SUFFIX), prompt.id);
    // 종류는 정해진 네 가지뿐이고, 모든 질문에 "답변에서 볼 것"이 있다
    const kinds = PROMPT_KINDS.map((kind) => kind.key);
    for (const prompt of prompts) {
        assert.ok(kinds.includes(prompt.kind), prompt.id);
        assert.ok(prompt.look.length > 10, prompt.id);
    }
    assert.equal(new Set(prompts.map((p) => p.id)).size, prompts.length);
});

test('질문에는 광고성 표현·경쟁 매장 깎아내리기가 없고, 사실 확인 질문에는 대조할 실제 정보가 붙는다', () => {
    const prompts = buildPromptSet(fullPlace());
    assert.deepEqual(findHypeWords(prompts.map((p) => ({ where: p.id, text: p.text }))), []);
    for (const prompt of prompts) assert.equal(/보다 (낫|좋)|말고|빼고/.test(prompt.text), false, prompt.id);
    const fact = prompts.find((p) => p.id === 'fact-info');
    assert.equal(fact.text, '분석식당(강남구청역 한식) 영업시간이랑 위치, 가격대, 주차 여부 알려줘. 확실하지 않은 건 모른다고 말해줘.');
    assert.deepEqual(fact.facts.map((f) => f.label), ['위치', '영업시간', '가격', '주차·편의']);
    assert.ok(fact.facts[1].value.includes('매일 10:00~22:00'));
    assert.ok(fact.facts[3].value.includes('주차할 수 있습니다(무료)'));
});

test('정보가 거의 없는 매장도 기본 질문은 만들고, 확인 안 되는 조건·메뉴 질문은 만들지 않는다', () => {
    const prompts = buildPromptSet(BARE);
    assert.deepEqual(prompts.map((p) => p.id), ['rank-basic', 'source-cite', 'fact-info', 'fact-know', 'follow-price', 'follow-visit']);
    assert.equal(prompts[0].text, `매장 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    assert.equal(prompts[0].naver, '매장 추천');
    assert.equal(prompts.find((p) => p.id === 'fact-info').text.startsWith('빈가게 영업시간이랑'), true);
    assert.deepEqual(prompts.find((p) => p.id === 'fact-info').facts, []);
    assert.deepEqual(buildPromptSet(null), []);
    // 대표 메뉴가 이미 질문(업종)에 들어 있으면 메뉴 질문을 따로 만들지 않는다
    const gomtang = buildPromptSet(fullPlace({ category: '곰탕' }));
    assert.equal(gomtang.some((p) => p.id === 'rank-menu'), false);
});

test('네이버는 문장 대신 검색어를 쓰고, 이어 묻기·출처 질문은 네이버에서 건너뛴다', () => {
    const prompts = buildPromptSet({ ...fullPlace(), category: '국밥' });
    const byId = Object.fromEntries(prompts.map((p) => [p.id, p]));
    assert.deepEqual(promptFor(byId['rank-basic'], 'naver'), { text: '강남구청역 국밥 추천', note: null, keyword: true });
    assert.equal(promptFor(byId['rank-combo'], 'naver').text, '주차되는 예약 가능한 강남구청역 국밥 추천');
    assert.equal(promptFor(byId['rank-menu'], 'naver').text, '강남구청역 곰탕 잘하는 곳');
    assert.equal(promptFor(byId['fact-know'], 'naver').text, '분석식당');
    for (const id of ['source-cite', 'follow-price', 'follow-visit']) {
        const naver = promptFor(byId[id], 'naver');
        assert.equal(naver.text, null, id);
        assert.ok(naver.note.length > 5, id);
    }
    // 다른 AI는 모두 같은 문장을 쓴다(같은 질문이어야 비교가 된다)
    for (const key of ['chatgpt', 'gemini', 'claude', 'perplexity']) {
        assert.deepEqual(promptFor(byId['rank-basic'], key), { text: byId['rank-basic'].text, note: null, keyword: false });
    }
    assert.deepEqual(promptFor(null, 'naver'), { text: null, note: null, keyword: false });
    assert.equal(naverQuery(`주차되는, 예약 가능한 강남구청역 한식 추천해줘. ${SOM_PROMPT_SUFFIX}`), '주차되는 예약 가능한 강남구청역 한식 추천');
});

test('AI 안내는 다섯 AI 모두 있고, 여는 주소에는 질문을 주소용으로 바꿔 싣는다', () => {
    assert.deepEqual(Object.keys(AI_GUIDES), PLATFORMS.map((p) => p.key));
    for (const guide of Object.values(AI_GUIDES)) {
        assert.ok(guide.home.startsWith('https://'));
        assert.ok(guide.tips.length >= 1);
        assert.ok(guide.paste.length > 5);
    }
    assert.equal(aiOpenUrl('naver', '강남구청역 한식 추천'), `https://search.naver.com/search.naver?query=${encodeURIComponent('강남구청역 한식 추천')}`);
    assert.equal(aiOpenUrl('chatgpt', 'a&b=c #d'), 'https://chatgpt.com/?hints=search&q=a%26b%3Dc%20%23d');
    assert.equal(aiOpenUrl('claude', '질문'), `https://claude.ai/new?q=${encodeURIComponent('질문')}`);
    assert.equal(aiOpenUrl('perplexity', '질문'), `https://www.perplexity.ai/search?q=${encodeURIComponent('질문')}`);
    // 질문을 실어 열 수 없는 곳은 첫 화면만 연다
    assert.equal(aiOpenUrl('gemini', '질문'), 'https://gemini.google.com/app');
    assert.equal(aiOpenUrl('chatgpt', '  '), 'https://chatgpt.com/');
    assert.equal(aiOpenUrl('naver', ''), 'https://search.naver.com/search.naver');
    assert.equal(aiOpenUrl('claude', null), 'https://claude.ai/new');
    assert.equal(aiOpenUrl('unknown', '질문'), null);
});

// ---- 답변 읽기 ----

test('답변에서 순위·추천 순서·내 매장 설명·출처를 함께 읽는다', () => {
    const names = brandAliases(fullPlace());
    const result = analyzeAnswer(ANSWER, names, { placeId: '2025884279' });
    assert.equal(result.rank, 2);
    assert.equal(result.rank, evaluateAnswerRank(ANSWER, names)); // 순위는 place-geo 의 판정을 그대로 쓴다
    assert.equal(result.label, '2위');
    assert.equal(result.points, 75);
    assert.deepEqual(result.listed, [{ name: '다른식당', mine: false }, { name: '분석 식당', mine: true }, { name: '셋째식당', mine: false }]);
    assert.deepEqual(result.above, ['다른식당']);
    assert.equal(result.quote, '분석 식당 — 곰탕 전문, 주차 가능'); // 주소와 "출처:" 꼬리는 뗀다
    assert.deepEqual(result.sources.map((s) => [s.host, s.type]), [
        ['blog.naver.com', 'blog'], ['m.place.naver.com', 'place'], ['youtube.com', 'video'], ['example.com', 'web'],
    ]);
});

test('표·"1위:" 형식도 읽고, 내 매장이 없으면 AI가 대신 추천한 곳을 보여 준다', () => {
    const names = brandAliases(fullPlace());
    const table = analyzeAnswer('| 순위 | 매장 |\n|---|---|\n| 1 | 다른식당 | 갈비탕 |\n| 2 | 셋째식당 |\n| 3 | 분석식당 |', names);
    assert.equal(table.rank, 3);
    assert.deepEqual(table.above, ['다른식당', '셋째식당']);
    const heading = analyzeAnswer('### 1위: 분석식당 (강남구청역)\n곰탕이 유명합니다.\n### 2위: 다른식당', names);
    assert.equal(heading.rank, 1);
    assert.deepEqual(heading.listed.map((item) => item.name), ['분석식당', '다른식당']);
    assert.deepEqual(heading.above, []);

    const none = analyzeAnswer('1. 다른식당 - 갈비탕\n2. 셋째식당 - 수육', names);
    assert.equal(none.rank, SOM_NONE);
    assert.equal(none.points, 0);
    assert.deepEqual(none.listed.map((item) => item.name), ['다른식당', '셋째식당']);
    assert.equal(none.quote, null);

    // 목록 밖에서만 언급되면 5위 밖이고, 그 문장을 보여 준다
    const tail = analyzeAnswer('1. 다른식당\n2. 셋째식당\n\n이 밖에 분석식당도 곰탕으로 알려져 있습니다.', names);
    assert.equal(tail.rank, SOM_MENTION);
    assert.equal(tail.points, 15);
    assert.deepEqual(tail.above, []);
    assert.equal(tail.quote, '이 밖에 분석식당도 곰탕으로 알려져 있습니다.');

    // 여섯 번째 이후도 5위 밖(순위 판정과 같은 기준)
    const long = Array.from({ length: 9 }, (_, i) => `${i + 1}. ${i === 5 ? '분석식당' : `가게${i + 1}`}`).join('\n');
    const sixth = analyzeAnswer(long, names);
    assert.equal(sixth.rank, SOM_MENTION);
    assert.equal(sixth.listed.length, 8);
    assert.equal(sixth.listed[5].mine, true);
});

test('읽을 수 없는 글은 판정 불가로 두고, 긴 이름·긴 설명은 잘라 보여 준다', () => {
    const names = brandAliases(fullPlace());
    for (const empty of [analyzeAnswer('   ', names), analyzeAnswer('1. 분석식당', []), analyzeAnswer(null, names)]) {
        assert.equal(empty.rank, null);
        assert.equal(empty.label, '판정 불가');
        assert.equal(empty.points, null);
        assert.deepEqual(empty.listed, []);
        assert.deepEqual(empty.sources, []);
    }
    const long = analyzeAnswer(`1. 아주아주 긴 이름을 가진 가게 이름이 여기에 계속 이어집니다 정말로\n2. 분석식당 ${'곰탕 '.repeat(80)}`, names);
    assert.ok(long.listed[0].name.length <= 24);
    assert.ok(long.listed[0].name.endsWith('…'));
    assert.ok(long.quote.length <= 180);
    assert.ok(long.quote.endsWith('…'));
});

test('출처 주소는 겹치는 것을 합치고 종류와 할 일을 붙인다', () => {
    const text = [
        'https://cafe.naver.com/mom/1 그리고 https://cafe.naver.com/mom/1?ref=a (같은 글)',
        '(https://m.place.naver.com/place/2025884279/home)',
        'https://www.google.com/maps/place/abc, https://catchtable.co.kr/shop/1!',
        'https://n.news.naver.com/article/1 http://notaurl https://brunch.co.kr/@a/1.',
    ].join('\n');
    const sources = extractSources(text, { placeId: '2025884279' });
    assert.deepEqual(sources.map((s) => s.type), ['cafe', 'place', 'place', 'listing', 'news', 'web', 'blog']);
    assert.deepEqual(sources.map((s) => s.mine), [false, true, false, false, false, false, false]);
    assert.equal(sources[3].url, 'https://catchtable.co.kr/shop/1');
    assert.equal(sources[6].url, 'https://brunch.co.kr/@a/1');
    for (const source of sources) assert.ok(source.action.length > 5);
    // 손님인 척하는 글을 권하지 않는다
    assert.ok(sources[0].action.includes('매장 관계자임을 밝히고'));
    // 많아도 8개까지만
    const many = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`).join(' ');
    assert.equal(extractSources(many).length, 8);
    assert.deepEqual(extractSources(''), []);
    assert.deepEqual(extractSources('주소 없음 http://'), []);
});

test('순위에 따라 다음에 볼 곳을 알려 준다', () => {
    assert.equal(rankAdvice(SOM_NONE, 'chatgpt').tab, 'today');
    assert.ok(rankAdvice(SOM_NONE, 'chatgpt').text.startsWith('ChatGPT의 답에 내 매장이 없습니다.'));
    assert.equal(rankAdvice(SOM_MENTION, 'naver').tab, 'drafts');
    assert.equal(rankAdvice(3, 'gemini').tab, 'diagnosis');
    assert.ok(rankAdvice(3, 'gemini').text.startsWith('3번째로 추천됩니다.'));
    assert.deepEqual([2, 3, 4, 5].map((rank) => rankAdvice(rank, 'gemini').tone), ['unknown', 'unknown', 'fair', 'fair']);
    assert.equal(rankAdvice(1, 'claude').tab, null);
    assert.equal(rankAdvice(1, 'claude').tone, 'good');
    assert.equal(rankAdvice(null, 'claude'), null);
});

// ---- 기록 → 추이·리포트 ----

const Q1 = 'q1';
const Q2 = 'q2';
const HISTORY = [
    { at: '2026-11-01T03:00:00Z', results: [{ prompt: Q1, ranks: { naver: 3, chatgpt: SOM_NONE, gemini: SOM_MENTION } }, { prompt: Q2, ranks: { naver: 5 } }] },
    { at: '2026-11-08T03:00:00Z', results: [{ prompt: Q1, ranks: { naver: 1, chatgpt: 4, gemini: SOM_MENTION } }, { prompt: Q2, ranks: { naver: 2 } }] },
];

test('직전 기록과는 같은 질문끼리만 비교한다(질문 순서가 바뀌어도)', () => {
    const now = [{ prompt: Q2, ranks: { naver: 2 } }, { prompt: Q1, ranks: { naver: 1 } }, { prompt: 'new', ranks: { naver: 1 } }];
    const aligned = alignPrevious(now, HISTORY[0].results);
    assert.deepEqual(aligned.map((row) => row.prompt), [Q2, Q1, 'new']);
    assert.deepEqual(aligned[0].ranks, { naver: 5 });
    assert.deepEqual(aligned[2].ranks, {});
    const result = somOf(now, HISTORY[0].results);
    // 네이버 q2: 5위 → 2위(+3), q1: 3위 → 1위(+2), 새 질문은 비교 대상 없음
    assert.deepEqual(result.cells.map((cell) => cell.delta), [3, 2, null]);
    assert.equal(alignPrevious(now, null), null);
    assert.equal(alignPrevious(now, []), null);
    assert.equal(somOf(now).delta, null);
    assert.equal(somOf([{ prompt: Q1, ranks: {} }]), null);
    // 재는 중간에는 이번에 잰 칸만 지난번과 비교한다: 네이버 1위(100) 대 지난번 네이버 3위(55)
    const partial = [{ prompt: Q1, ranks: { naver: 1, chatgpt: null } }];
    assert.equal(somOf(partial, HISTORY[0].results).delta, 76.7); // 지난번 세 칸 평균(23.3)과 비교하면 부풀려진다
    assert.equal(somOf(partial, HISTORY[0].results, { sameCells: true }).delta, 45);
    assert.equal(somOf(partial, null, { sameCells: true }).delta, null);
});

test('재다 만 기록에 이어 넣으면 새로 잰 칸만 덮어쓰고 나머지는 그대로 둔다', () => {
    const base = HISTORY[0].results;
    const merged = mergeResults(base, [
        { prompt: Q1, ranks: { naver: null, chatgpt: 2, claude: 1, gemini: 'bad' } },
        { prompt: 'new', ranks: { perplexity: 3 } },
        { prompt: 'empty', ranks: { naver: null } },
    ]);
    assert.deepEqual(merged, [
        { prompt: Q1, ranks: { naver: 3, chatgpt: 2, gemini: SOM_MENTION, claude: 1 } },
        { prompt: Q2, ranks: { naver: 5 } },
        { prompt: 'new', ranks: { perplexity: 3 } },
    ]);
    // 원래 기록은 바꾸지 않는다
    assert.deepEqual(base[0].ranks, { naver: 3, chatgpt: SOM_NONE, gemini: SOM_MENTION });
    assert.deepEqual(mergeResults(null, null), []);
    // 오늘 기록인지는 한국 시간 날짜로 본다
    assert.equal(isToday('2026-11-14T16:00:00Z', NOW), true); // 한국 시간 15일 01시
    assert.equal(isToday('2026-11-14T14:00:00Z', NOW), false); // 한국 시간 14일 23시
    assert.equal(isToday('2025-11-15T03:00:00Z', NOW), false); // 같은 날짜지만 작년
    assert.equal(isToday('없음', NOW), false);
});

test('추이는 기록마다 종합·AI별 점유율을 내고, 날짜는 한국 시간으로 적는다', () => {
    const trend = somTrend([...HISTORY, { at: '2026-11-09T03:00:00Z', results: [{ prompt: Q1, ranks: {} }] }]);
    assert.equal(trend.length, 2); // 한 칸도 재지 않은 기록은 뺀다
    assert.deepEqual(trend.map((p) => [p.label, p.overall, p.measured]), [['11.1', 22.5, 4], ['11.8', 56.3, 4]]);
    assert.deepEqual([trend[1].naver, trend[1].chatgpt, trend[1].gemini, trend[1].claude, trend[1].perplexity], [87.5, 35, 15, null, null]);
    assert.equal(dayLabel('2026-11-14T16:00:00Z'), '11.15'); // 한국 시간으로는 15일 01시
    assert.equal(dayLabel('없음'), '');
    assert.deepEqual(somTrend(null), []);
});

test('마지막으로 잰 지 7일이 지나면 다시 잴 때라고 알려 준다', () => {
    assert.equal(REMEASURE_DAYS, 7);
    assert.deepEqual(remeasureStatus([], NOW), { last: null, days: null, due: false });
    assert.deepEqual(remeasureStatus(HISTORY, NOW), { last: '2026-11-08T03:00:00Z', days: 7, due: true });
    assert.deepEqual(remeasureStatus(HISTORY, Date.parse('2026-11-14T03:00:00Z')), { last: '2026-11-08T03:00:00Z', days: 6, due: false });
    assert.deepEqual(remeasureStatus([{ at: '틀린 날짜', results: [] }], NOW), { last: null, days: null, due: false });
});

test('글 리포트는 질문별 순위와 변동, 종합 점유율을 담는다', () => {
    const report = somReportText('분석식당', HISTORY[1], HISTORY[0]);
    const lines = report.split('\n');
    assert.equal(lines[0], '[AI 답변 점유율] 분석식당');
    assert.equal(lines[1], '측정일 2026.11.8');
    assert.ok(lines.includes('질문 1. q1'));
    assert.ok(lines.includes('- 네이버 AI: 1위 (▲2) · 100점'));
    assert.ok(lines.includes('- ChatGPT: 4위 (▲6) · 35점'));
    assert.ok(lines.includes('- Gemini: 5위 밖 · 15점')); // 변동이 없으면 화살표를 붙이지 않는다
    assert.ok(lines.includes('종합 점유율 56.3% (▲33.8%p) · 4칸 측정'));
    assert.ok(lines.includes('- 네이버 AI 87.5% (▲50%p)'));
    assert.equal(lines.some((line) => line.startsWith('- Claude')), false); // 재지 않은 AI는 적지 않는다
    // 처음 기록은 변동 없이
    assert.ok(somReportText('분석식당', HISTORY[0]).includes('종합 점유율 22.5% · 4칸 측정'));
    assert.equal(somReportText('분석식당', null), '');
    assert.equal(somReportText('분석식당', { at: 'x', results: [] }), '');
});

test('CSV는 측정한 칸마다 한 줄이고 수식으로 읽힐 글자를 막는다', () => {
    const csv = somCsv([...HISTORY, { at: '2026-11-09T03:00:00Z', results: [{ prompt: '=1+1', ranks: { naver: 1, claude: 'bad' } }] }]);
    const lines = csv.replace(/^﻿/, '').split('\n');
    assert.equal(csv.charCodeAt(0), 0xFEFF); // 한글 엑셀용 BOM
    assert.equal(lines[0], '"측정일시","질문","AI","순위","점수"');
    assert.equal(lines.length, 1 + 4 + 4 + 1);
    assert.ok(lines[1].endsWith('"q1","네이버 AI","3위","55"'));
    assert.ok(lines[2].endsWith('"q1","ChatGPT","안 나옴","0"'));
    assert.ok(lines[9].includes(`"'=1+1"`));
    assert.equal(somCsv([]).replace(/^﻿/, ''), '"측정일시","질문","AI","순위","점수"');
});
