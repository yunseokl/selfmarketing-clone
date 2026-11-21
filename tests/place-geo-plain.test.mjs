import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    analyzeGeoAeo, buildFanout, externalSteps, GEO_TAB_LABELS, SITE_WORK_HEADER, notApplicableTag, UNVERIFIED_TAG, NOT_APPLICABLE_TAG,
    feedTopicWords, headlineMenus, PLATFORMS,
} from '../lib/place-geo.js';
import { buildQuickStrategies, buildOneDayPlan, quickSummary } from '../lib/place-geo-quick.js';
import { buildPromptSet, AI_GUIDES } from '../lib/place-geo-prompts.js';
import { PHARMACY, RESTAURANT, SALON, NOW } from './place-graph.fixtures.mjs';

// AI 검색 구역의 문장은 가게 사장님이 읽는 말이어야 합니다: 내부 자료 이름을 대지 않고, 업계 용어는 풀어 쓰고,
// 홈페이지가 있어야 하는 기술 작업은 한곳에 모으고, 효과를 단정하지 않습니다.

const SAMPLES = [['음식점', RESTAURANT], ['약국', PHARMACY], ['미용실', SALON]];

// 객체 안의 글자를 모두 모읍니다(초안 본문처럼 코드가 들어 있는 것은 따로 거릅니다).
function strings(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => strings(item, out));
    return out;
}

const FORBIDDEN = [
    '전략 정리', '대화의', '대화에', '대화가', '대화 기준', '대화 후반', '정정된', '정정 내용', 'Share of Model', 'SoM', '원자 답변', '스펙 표', '마크다운',
    '검증 안 됨', '검증되지', '미검증', '검증 안 된', '하이재킹',
];

function everyText(place, sample) {
    const analysis = analyzeGeoAeo({ place, activity: sample.activity, ranks: sample.ranks ?? null, nowMs: NOW });
    const strategies = buildQuickStrategies(place, sample.activity, { atomic: analysis.atomic, fanout: analysis.fanout, nowMs: NOW });
    const plan = buildOneDayPlan(strategies);
    const prompts = buildPromptSet(place, sample.activity);
    // 복사해 쓰는 초안 본문(text)은 매장 글·코드라 제외하고, 이름·쓰는 곳·풀이·주의 글만 봅니다.
    const drafts = analysis.templates.map(({ label, where, notes, purpose }) => ({ label, where, notes, purpose }));
    const cards = strategies.map(({ draft, ...rest }) => ({ ...rest, draftLabel: draft?.label }));
    return {
        analysis, strategies, plan,
        texts: [
            ...strings({ ...analysis, templates: undefined }),
            ...strings(drafts), ...strings(cards), ...strings(plan), ...strings(prompts), ...strings(AI_GUIDES), ...strings(PLATFORMS),
        ],
    };
}

for (const [name, sample] of SAMPLES) {
    test(`${name}: 사장님 화면 문장에 내부 자료 이름·업계 용어 원문이 나오지 않는다`, () => {
        const { texts } = everyText(sample.place, sample);
        assert.ok(texts.length > 200);
        for (const word of FORBIDDEN) {
            const hit = texts.find((text) => text.includes(word));
            assert.equal(hit, undefined, `"${word}" 가 남아 있음: ${hit}`);
        }
    });

    test(`${name}: "○○ 탭"이라고 가리키는 이름은 실제 탭 이름과 같다`, () => {
        const { texts } = everyText(sample.place, sample);
        const labels = Object.values(GEO_TAB_LABELS);
        const named = texts.flatMap((text) => [...text.matchAll(/["'‘“]([^"'’”]{2,12})["'’”] 탭/g)].map((match) => match[1]));
        assert.ok(named.length > 5);
        for (const label of named) assert.ok(labels.includes(label), `없는 탭 이름: ${label}`);
        // 옛 탭 이름은 남지 않는다
        for (const old of ['AI 답변 실측', '로드맵', '초안']) {
            const hit = texts.find((text) => new RegExp(`["'‘“]${old}["'’”] 탭`).test(text));
            assert.equal(hit, undefined, `옛 탭 이름 "${old}": ${hit}`);
        }
    });

    test(`${name}: 고유 명칭(파일·도구·로봇 이름)은 풀이 없이 혼자 나오지 않는다`, () => {
        const { analysis, strategies } = everyText(sample.place, sample);
        const gloss = [
            ['robots.txt', /로봇|출입/],
            ['llms.txt', /안내 파일|AI에게/],
            ['IndexNow', /검색엔진에 바로 알리는/],
            ['WebSub', /알림/],
            ['LocalBusiness', /코드|구조화/],
            ['OAI-SearchBot', /로봇|ChatGPT/],
            ['Bingbot', /Bing/],
            ['PerplexityBot', /로봇|Perplexity/],
            ['서치어드바이저', /도구|알리는/],
            ['웹마스터 도구', /도구|알리는/],
            ['서치 콘솔', /도구|알리는/],
            ['Gist', /공개/],
        ];
        // 초안 이름에 파일 이름이 들어가는 것(robots.txt 예시·llms.txt 초안)은 같은 카드의 풀이(purpose)가 따라붙습니다.
        const cards = [
            ...analysis.actions.map((item) => [item.title, item.how, item.now, item.target].filter(Boolean).join(' / ')),
            ...strategies.map((s) => [s.title, s.needs, s.why, ...s.steps, ...s.cautions].filter(Boolean).join(' / ')),
        ];
        for (const card of cards) {
            for (const [term, pattern] of gloss) {
                if (card.includes(term)) assert.match(card, pattern, `${term} 풀이 없음: ${card.slice(0, 120)}`);
            }
        }
        for (const template of analysis.templates.filter((item) => item.group === 'site')) {
            assert.ok(template.purpose && template.purpose.length > 15, template.key);
        }
    });
}

test('홈페이지가 있어야 하는 기술 작업은 머리말 하나 아래로 모인다', () => {
    assert.equal(SITE_WORK_HEADER, '홈페이지가 있는 가게만 — 홈페이지를 만든 분(개발자)에게 그대로 전달하세요');
    const analysis = analyzeGeoAeo({ place: RESTAURANT.place, activity: RESTAURANT.activity, ranks: RESTAURANT.ranks, nowMs: NOW });
    // 초안: 홈페이지 전용 4개만 site, 나머지는 바로 쓰는 글
    assert.deepEqual(analysis.templates.filter((item) => item.group === 'site').map((item) => item.key), ['answerPage', 'robots', 'jsonld', 'llms']);
    assert.ok(analysis.templates.filter((item) => item.group === 'write').length >= 8);
    // 단계별 계획: needsSite 인 일은 홈페이지 전용 로봇 안내·검색 도구·코드 일뿐이고, 전부 풀이가 붙어 있다
    const site = externalSteps(RESTAURANT.place, RESTAURANT.activity).filter((step) => step.needsSite).map((step) => step.id);
    assert.deepEqual(site, ['robots', 'bingWebmaster', 'jsonld', 'searchConsole', 'naverAdvisor', 'llms']);
    // 오늘 할 일: 로봇 길 열기·구글 새 글 알림 두 가지가 홈페이지 작업으로 모이고, 지금 바로·준비 필요와 따로 센다
    const strategies = buildQuickStrategies(RESTAURANT.place, RESTAURANT.activity, { atomic: analysis.atomic, fanout: analysis.fanout, nowMs: NOW });
    assert.deepEqual(strategies.filter((s) => s.siteWork).map((s) => s.id), ['chatgpt-fetch', 'gemini-websub']);
    const summary = Object.fromEntries(quickSummary(strategies, []).map((p) => [p.key, p]));
    for (const p of Object.values(summary)) assert.equal(p.now + p.prep + p.site, p.total, p.key);
    assert.equal(buildOneDayPlan(strategies).steps.filter((step) => step.siteWork).length, 2);
});

test('이름표는 이유와 같은 세기다: 약국의 예약은 "확인 안 됨", 병의원의 새소식·쿠폰은 "해당 없음"', () => {
    assert.equal(UNVERIFIED_TAG, '확인 안 됨(점수에서 뺌)');
    assert.equal(notApplicableTag('booking'), UNVERIFIED_TAG);
    assert.equal(notApplicableTag('coupon'), NOT_APPLICABLE_TAG);
    assert.equal(notApplicableTag('feed'), NOT_APPLICABLE_TAG);
    const pharmacy = analyzeGeoAeo({ place: PHARMACY.place, activity: PHARMACY.activity, ranks: PHARMACY.ranks ?? null, nowMs: NOW });
    const fanout = Object.fromEntries(pharmacy.fanout.map((item) => [item.key, item]));
    assert.equal(fanout.booking.notApplicableTag, UNVERIFIED_TAG);
    assert.equal(fanout.payment.notApplicableTag, NOT_APPLICABLE_TAG);
    const multiturn = pharmacy.aeo.factors.find((factor) => factor.key === 'multiturn');
    assert.deepEqual(multiturn.notApplicable.map((entry) => [entry.key, entry.tag]), [['booking', UNVERIFIED_TAG]]);
    assert.match(multiturn.evidence, /예약: 확인 안 됨\(점수에서 뺌\)/);
});

test('약국 화면에는 음식점 말(새 메뉴·대표 메뉴·메뉴 가격)이 나오지 않는다', () => {
    const analysis = analyzeGeoAeo({ place: PHARMACY.place, activity: PHARMACY.activity, ranks: PHARMACY.ranks ?? null, nowMs: NOW });
    assert.equal(feedTopicWords(PHARMACY.place), '새 취급 품목·서비스');
    assert.equal(feedTopicWords(RESTAURANT.place), '새 메뉴·이벤트');
    assert.equal(feedTopicWords(SALON.place), '새 시술·이벤트');
    const structured = analysis.aeo.factors.find((factor) => factor.key === 'structured');
    assert.match(structured.label, /^칸이 나뉜 정보\(취급 품목·서비스 가격·설명·영업시간·편의\)$/);
    const signature = analysis.fanout.find((item) => item.key === 'signature');
    assert.equal(signature.question, `${PHARMACY.place.name}의 대표 취급 품목·서비스는 무엇인가요?`);
    const feed = analysis.actions.find((item) => item.id === 'feed');
    if (feed) assert.doesNotMatch(feed.title, /새 메뉴/);
    const feed14 = analysis.checklist.find((item) => item.id === 'feed14');
    if (feed14) assert.doesNotMatch(feed14.detail, /새 메뉴/);
    // 음식점은 그대로
    const food = analyzeGeoAeo({ place: RESTAURANT.place, activity: RESTAURANT.activity, ranks: RESTAURANT.ranks ?? null, nowMs: NOW });
    assert.match(food.aeo.factors.find((factor) => factor.key === 'structured').label, /^칸이 나뉜 정보\(메뉴 가격/);
    assert.equal(buildFanout(RESTAURANT.place, RESTAURANT.activity).find((item) => item.key === 'signature').question, `${RESTAURANT.place.name} 대표 메뉴(서비스)는 무엇인가요?`);
});

test('반영 시간은 "어림값"이라고 쉬운 말로 적고, 효과를 단정하지 않는다', () => {
    const analysis = analyzeGeoAeo({ place: RESTAURANT.place, activity: RESTAURANT.activity, ranks: RESTAURANT.ranks, nowMs: NOW });
    const strategies = buildQuickStrategies(RESTAURANT.place, RESTAURANT.activity, { atomic: analysis.atomic, fanout: analysis.fanout, nowMs: NOW });
    const joined = [...strings(strategies.map(({ draft, ...rest }) => rest)), ...strings(analysis.actions), ...strings(analysis.geo), ...strings(analysis.aeo)].join('\n');
    for (const claim of ['광고 문구는 AI 요약에 쓰이지 않습니다', 'AI가 믿습니다', '순위에 도움이 됩니다', '실체로 인정합니다', '그대로 인용합니다']) {
        assert.equal(joined.includes(claim), false, claim);
    }
});

// 노트북 심사: AI 가 무엇을 한다고 단정하는 문장("~이 됩니다"·"~하지 못합니다")은 "~일 수 있습니다"로 쓴다. 세 업종 모두 본다.
test('AI 검색 글은 AI 의 동작을 단정하지 않는다(될 수 있다·보인다로 쓴다)', () => {
    const claims = [
        '"공식 설명"이 됩니다', '"답변 문장"이 됩니다', '다른 매장을 다시 찾지 않아도 됩니다', 'AI가 읽지 못합니다', 'AI가 헷갈리지 않습니다',
        '요약할 문장이 늘어납니다', '요약할 문장이 자연스럽게 늘어납니다', '손님 불만으로 이어집니다', '틀린 정보를 퍼뜨립니다', '같은 매장으로 묶습니다', '유사 문서로 처리됩니다', '저품질·스팸으로 처리됩니다',
        '모든 AI가 매장을 같은 실체로 알아보는 기본값입니다', '요약할 문장이 없습니다',
    ];
    for (const [name, sample] of SAMPLES) {
        const analysis = analyzeGeoAeo({ place: sample.place, activity: sample.activity, ranks: sample.ranks ?? null, nowMs: NOW });
        const strategies = buildQuickStrategies(sample.place, sample.activity, { atomic: analysis.atomic, fanout: analysis.fanout, nowMs: NOW });
        const joined = [...strings(strategies), ...strings(analysis.actions), ...strings(analysis.geo), ...strings(analysis.aeo), ...strings(analysis.templates), ...strings(analysis.avoid || []), ...strings(analysis.checklist || [])].join('\n');
        // (검사 대상이 비어 있어서 통과하는 일이 없게, 고친 문장이 실제로 이 글들 안에 있는지도 한 번 본다)
        assert.equal(joined.includes('수 있습니다'), true, `${name}: 검사 대상 글이 비어 있음`);
        for (const claim of claims) assert.equal(joined.includes(claim), false, `${name}: ${claim}`);
    }
});

// 노트북 심사: 숫자 굴림 칸의 0123456789 가 글 추출·화면 낭독에 "0개 0123456789 개"처럼 섞였다. 굴림용 숫자열은 CSS 내용으로만 그린다.
test('카드의 숫자 굴림 칸은 숫자열을 글자로 두지 않는다(읽히는 값은 srOnly 의 실제 값 하나)', () => {
    const source = readFileSync(new URL('../app/dashboard/place-insight/graph/Inspector.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    assert.equal(source.includes('0123456789'), false, 'Inspector.js 에 굴림용 숫자열이 글자로 남아 있음');
    assert.equal(/className=\{styles\.srOnly\}>\{text\}</.test(source), true, '읽히는 값(srOnly)이 있어야 함');
    const css = readFileSync(new URL('../app/dashboard/place-insight/graph/Inspector.module.css', import.meta.url), 'utf8');
    assert.equal(/\.rollStrip::before\s*\{[^}]*content:\s*'0\\A 1\\A 2/.test(css), true, '굴림용 숫자열은 CSS content 로 그려야 함');
});

// 화면 파일(JSX)에 적힌 글자에도 내부 자료 이름·옛 탭 이름·업계 용어 원문이 남지 않아야 합니다(주석은 제외).
test('AI 검색 화면 파일의 글자에는 내부 자료 이름·옛 탭 이름이 남아 있지 않다', () => {
    const dir = new URL('../app/dashboard/place-insight/', import.meta.url);
    const files = ['GeoAeoPanel.js', 'GeoSections.js', 'QuickGeoPanel.js', 'SomTracker.js'];
    const forbidden = ['전략 정리', 'Share of Model', '원자 답변', '스펙 표', '마크다운', '검증 안 됨', '검증되지', '로드맵', 'AI 답변 실측', '(전략', '대화의'];
    for (const name of files) {
        const source = readFileSync(new URL(name, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
        for (const word of forbidden) assert.equal(source.includes(word), false, `${name} 에 "${word}" 가 남아 있음`);
    }
});

// 폰 6차: 제목·타일·세부 항목 이름에는 약어(GEO·AEO)를 쓰지 않고, 구역 설명 한 줄에서 한 번만 풀어 줍니다. 제목에는 WebSub·Gist 같은 도구 이름도 올리지 않습니다.
test('GEO·AEO 약어는 구역 설명에 한 번만 나오고, 카드 제목에는 WebSub·Gist 가 없다', () => {
    const dir = new URL('../app/dashboard/place-insight/', import.meta.url);
    const stripped = (name) => readFileSync(new URL(name, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line) && !/console\.error/.test(line)).join('\n');
    const files = ['GeoAeoPanel.js', 'GeoSections.js', 'QuickGeoPanel.js', 'SomTracker.js'];
    const found = files.flatMap((name) => (stripped(name).match(/\b(?:GEO|AEO)\b/g) || []).map(() => name));
    assert.deepEqual(found, ['GeoSections.js', 'GeoSections.js']); // 'GEO·AEO' 한 번(GEO 와 AEO 한 쌍)
    assert.ok(stripped('GeoSections.js').includes('업계에서는 이 점검을 GEO·AEO라고 부릅니다'));
    for (const [name, sample] of SAMPLES) {
        const { strategies } = everyText(sample.place, sample);
        for (const card of strategies) {
            assert.equal(/WebSub|Gist/.test(card.title), false, `${name}: 제목에 도구 이름 — ${card.title}`);
        }
    }
});

// 노트북·폰 6차: 약국·병의원·미용실의 AI 검색 구역 전체에 음식점 말 '메뉴'가 남지 않습니다(스마트플레이스의 '메뉴판'·'메뉴 탭', 구글의 Q&A '메뉴',
// 따옴표 안의 자료는 예외). 업종 말은 약국 '취급 품목·서비스', 병의원·동물병원 '진료 과목·서비스', 미용실 '시술'.
test('약국·병의원·미용실의 AI 검색 글에는 음식점 말 "메뉴"가 남지 않고 조사가 맞는다', () => {
    const keep = ['메뉴판', '메뉴 탭', '메뉴탭', "Q&A' 메뉴", '따라 메뉴가'];
    const bare = (text) => keep.reduce((value, phrase) => value.split(phrase).join(''), text).replace(/[‘'“"][^‘’'“”"\n]{1,40}[’'”"]/g, '');
    const clinic = { ...PHARMACY, place: { ...PHARMACY.place, name: '시험내과의원', category: '내과' } };
    const pet = { ...PHARMACY, place: { ...PHARMACY.place, name: '시험동물병원', category: '동물병원' } };
    for (const [name, sample] of [['약국', PHARMACY], ['병의원', clinic], ['동물병원', pet], ['미용실', SALON]]) {
        const { texts } = everyText(sample.place, sample);
        const left = texts.filter((text) => /메뉴/.test(bare(text)));
        assert.deepEqual(left, [], `${name}: 업종과 안 맞는 '메뉴'가 남음`);
        // 조사(받침에 맞게): "대표 취급 품목·서비스를", "대표 시술을"
        const wrong = texts.filter((text) => /(서비스|진료 과목·서비스)(을|은|이|과)(?![가-힣])|시술(를|는|가|와)(?![가-힣])/.test(text));
        assert.deepEqual(wrong, [], `${name}: 조사가 안 맞음`);
    }
    const salon = analyzeGeoAeo({ place: SALON.place, activity: SALON.activity, ranks: SALON.ranks ?? null, nowMs: NOW });
    assert.ok(salon.fanout.some((item) => item.question.endsWith('대표 시술은 무엇인가요?')));
    assert.ok(salon.geo.factors.some((factor) => factor.label === '최신성(최근 리뷰·소식·시술)'));
    // 음식점은 그대로 '메뉴'
    const restaurant = analyzeGeoAeo({ place: RESTAURANT.place, activity: RESTAURANT.activity, ranks: RESTAURANT.ranks ?? null, nowMs: NOW });
    assert.ok(restaurant.geo.factors.some((factor) => factor.label === '최신성(최근 리뷰·소식·메뉴)'));
});

// 가게를 한마디로 설명하는 자리(한 줄 소개·질문·제목·소개글)의 대표 메뉴는 키워드 추천이 뺀 낱말(횟집의 김밥)을 쓰지 않습니다.
test('한 줄 소개·질문·제목의 대표 메뉴는 키워드 추천이 뺀 낱말을 쓰지 않는다(소식 본문의 사실 목록은 그대로)', () => {
    const analysis = analyzeGeoAeo({ place: RESTAURANT.place, activity: RESTAURANT.activity, ranks: RESTAURANT.ranks, nowMs: NOW });
    assert.deepEqual(headlineMenus(RESTAURANT.place, RESTAURANT.activity, 2), ['광어', '숙성회']);
    const templates = Object.fromEntries(analysis.templates.map((item) => [item.key, item]));
    assert.equal(templates.intro.text.split('\n').slice(-1)[0], '강남구청역 광어·숙성회 횟집');
    assert.equal(templates.youtube.text.includes('김밥'), false);
    assert.equal((analysis.criteria?.text || '').includes('김밥'), false);
    const strategies = buildQuickStrategies(RESTAURANT.place, RESTAURANT.activity, { atomic: analysis.atomic, fanout: analysis.fanout, nowMs: NOW });
    assert.equal(strategies.find((s) => s.id === 'naver-feed').draft.text.includes('김밥'), false);
    assert.equal(buildPromptSet(RESTAURANT.place, RESTAURANT.activity).some((p) => p.text.includes('김밥')), false);
    // 약국은 대표 메뉴 낱말이 없으니 메뉴 없이 자연스럽게
    assert.deepEqual(headlineMenus(PHARMACY.place, PHARMACY.activity, 2), []);
    const pharmacy = analyzeGeoAeo({ place: PHARMACY.place, activity: PHARMACY.activity, ranks: PHARMACY.ranks ?? null, nowMs: NOW });
    assert.equal(pharmacy.templates.find((item) => item.key === 'intro').text.split('\n').slice(-1)[0], '오창읍 약국');
});
