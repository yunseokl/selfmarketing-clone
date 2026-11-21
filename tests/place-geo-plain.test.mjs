import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    analyzeGeoAeo, buildFanout, externalSteps, GEO_TAB_LABELS, SITE_WORK_HEADER, notApplicableTag, UNVERIFIED_TAG, NOT_APPLICABLE_TAG,
    feedTopicWords, headlineMenus, PLATFORMS, placeCriteria, mainItemWord, menuWord, fitMenuText,
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

// 노트북 7차: ① 미용실 글의 대표 항목 이름은 '대표 시술'(영어 초안은 Popular treatments) ② 약국·병의원의 조건형 질문에 '단체 이용'이 없다
// ③ 점유율 문구는 '순위를 조회한 키워드' ④ 서치어드바이저 제목에는 한 줄 풀이가 붙는다
test('노트북 7차: 업종 말·조건형 질문·점유율 문구·서치어드바이저 풀이', () => {
    assert.equal(mainItemWord(SALON.place), '대표 시술');
    assert.equal(mainItemWord(PHARMACY.place), '대표 취급 품목·서비스');
    assert.equal(mainItemWord(RESTAURANT.place), '대표 메뉴');
    const salon = analyzeGeoAeo({ place: SALON.place, activity: SALON.activity, ranks: SALON.ranks ?? null, nowMs: NOW });
    const drafts = buildQuickStrategies(SALON.place, SALON.activity, { atomic: salon.atomic, fanout: salon.fanout, nowMs: NOW }).map((item) => item.draft?.text || '').join('\n');
    assert.equal(drafts.includes('- 대표 메뉴:'), false, '미용실 초안에 음식점 말');
    assert.equal(drafts.includes('Popular menu'), false);
    assert.equal(/- 대표 시술:|- Popular treatments:/.test(drafts), true, '미용실 초안에 업종 말 항목이 있어야 함');
    // 약국·병의원: 자료에 '단체 이용'이 있어도 조건에서 뺀다. 음식점은 그대로 둔다.
    const withGroup = (sample) => ({ ...sample.place, conveniences: [...(sample.place.conveniences || []), '단체 이용 가능'] });
    assert.equal(placeCriteria(withGroup(PHARMACY)).some((item) => item.key === 'group'), false);
    assert.equal(placeCriteria({ ...withGroup(PHARMACY), category: '내과' }).some((item) => item.key === 'group'), false);
    assert.equal(placeCriteria(withGroup(RESTAURANT)).some((item) => item.key === 'group'), true);
    for (const [name, sample] of SAMPLES) {
        const analysis = analyzeGeoAeo({ place: sample.place, activity: sample.activity, ranks: sample.ranks ?? null, nowMs: NOW });
        const json = JSON.stringify(analysis);
        assert.equal(/대표키워드 \d+개 중 5위 안/.test(json), false, `${name}: 점유율 문구가 등록 키워드 수처럼 읽힘`);
    }
    const advisor = buildQuickStrategies(RESTAURANT.place, RESTAURANT.activity, { nowMs: NOW }).find((item) => /서치어드바이저/.test(item.title));
    assert.equal(Boolean(advisor) && /서치어드바이저: 내 글을 네이버에 알리는 무료 도구/.test(advisor.title), true, '오늘 할 일 제목에 서치어드바이저 풀이');
});

// 마무리 수정: 주차·편의시설 답은 앞에서 말한 '주차(무료)'를 편의시설 목록에서 되풀이하지 않고, 약국·병의원에서는 '단체 이용 가능'도 뺀다.
test('주차·편의시설 답: 주차를 두 번 말하지 않고 약국·병의원은 단체 이용을 뺀다', () => {
    const answerOf = (place, activity) => buildFanout(place, activity).find((item) => item.key === 'parking').answer;
    const pharmacy = answerOf(PHARMACY.place, PHARMACY.activity);
    assert.equal(pharmacy.startsWith('주차할 수 있습니다'), true);
    assert.equal((pharmacy.match(/주차/g) || []).length, 1, `주차가 두 번 이상: ${pharmacy}`);
    assert.equal(/단체/.test(pharmacy), false, `약국 답에 단체 이용: ${pharmacy}`);
    assert.equal(pharmacy.includes('남/녀 화장실 구분'), true, '다른 편의시설은 그대로');
    // 병의원도 같다
    const clinic = answerOf({ ...PHARMACY.place, category: '내과' }, PHARMACY.activity);
    assert.equal(/단체/.test(clinic), false, `병의원 답에 단체 이용: ${clinic}`);
    // 음식점·미용실은 '단체 이용 가능'을 그대로 둔다(발레파킹을 앞에서 말했으면 그 항목도 목록에서 빠진다)
    assert.equal(answerOf(RESTAURANT.place, RESTAURANT.activity).includes('단체 이용 가능'), true);
    assert.equal(answerOf(SALON.place, SALON.activity).includes('단체 이용 가능'), true);
    const valet = answerOf({ ...RESTAURANT.place, conveniences: ['포장', '주차', '발렛파킹', '예약'], detail: { ...RESTAURANT.place.detail, facilities: [] } }, RESTAURANT.activity);
    assert.equal(valet, '주차할 수 있습니다(유료), 발레파킹도 됩니다. 편의시설: 포장, 예약.');
    // 주차 정보가 없으면 편의시설 목록에 적힌 주차는 그대로 둔다(앞에서 말한 것이 없으므로)
    const noParking = answerOf({ ...RESTAURANT.place, conveniences: ['포장', '주차'], detail: { ...RESTAURANT.place.detail, parking: null, facilities: [] } }, RESTAURANT.activity);
    assert.equal(noParking, '편의시설: 포장, 주차.');
});

// 10차: 후보 꼬리표는 화면과 처방전이 같은 말이고(long 포함), 키워드 구역의 고정 문구도 업종 말을 따른다(시술·품목·메뉴).
test('후보 꼬리표는 화면과 처방전이 같은 말이고, 키워드 구역 고정 문구는 업종 말을 따른다', async () => {
    const { LACKS_TAG } = await import('../lib/place-prescription.js');
    const page = readFileSync(new URL('../app/dashboard/place-insight/page.js', import.meta.url), 'utf8');
    for (const [key, text] of Object.entries(LACKS_TAG)) assert.equal(page.includes(`${key}: '${text}'`), true, `화면 LACKS_LABEL 에 ${key}: '${text}' 가 있어야 함`);
    assert.equal(LACKS_TAG.long, '이름이 긴 말');
    // 고정 문구 변환: 미용 '시술', 약국·병의원 '품목', 음식점 '메뉴'(그대로). '메뉴판'·따옴표 안 자료는 그대로.
    assert.equal(fitMenuText('시술', '주력 메뉴 아님'), '주력 시술 아님');
    assert.equal(fitMenuText('품목', '메뉴 설명'), '품목 설명');
    assert.equal(fitMenuText('품목', '메뉴판에 한 줄로 올라 있는 품목'), '메뉴판에 한 줄로 올라 있는 품목');
    assert.equal(fitMenuText('메뉴', '주력 메뉴 아님'), '주력 메뉴 아님');
    for (const [word, type] of [['시술', SALON], ['품목', PHARMACY], ['메뉴', RESTAURANT]]) {
        const w = menuWord(type.place);
        assert.equal(word === '시술' ? w === '시술' : word === '메뉴' ? w === '메뉴' : w !== '메뉴' && w !== '시술', true, `${word}: menuWord=${w}`);
    }
    assert.equal(/<KeywordItemWord\.Provider value=\{keywordItemWord\(place\)\}>/.test(page), true, '키워드 구역을 업종 말 컨텍스트로 감쌈');
});

// 폰 7차: 메뉴판 묶음 단추는 다른 접힘 단추처럼 44px, 추천 이유 칩은 폰에서 13px, 흐린 범례 안내는 6초, 여러 낱말을 묶은 줄의 제목은 "○○ 외 N개".
test('폰 화면 규칙: 접힘 안 단추 44px · 이유 칩 13px · 흐린 범례 안내 6초 · 묶인 낱말 제목', () => {
    const dir = new URL('../app/dashboard/place-insight/', import.meta.url);
    const css = readFileSync(new URL('page.module.css', dir), 'utf8');
    const phone = css.slice(css.indexOf('@media (pointer: coarse), (max-width: 768px)'));
    assert.equal(/\.foldBtn,\s*\.foldNestedBtn\s*\{\s*min-height:\s*44px/.test(phone), true, '.foldNestedBtn 이 44px 규칙에 들어 있어야 함');
    assert.equal(/\.tickerSum small,\s*\.reason\s*\{\s*font-size:\s*13px/.test(css), true, '폰에서 .reason 은 13px');
    const graph = readFileSync(new URL('PlaceGraph.js', dir), 'utf8');
    assert.equal(/setEmptyGroup\(null\), 6000/.test(graph), true, '흐린 범례 안내는 6초');
    const page = readFileSync(new URL('page.js', dir), 'utf8');
    assert.equal(/entry\.term\}\{others\.size > 0/.test(page), true, '묶인 낱말이 있으면 제목에 외 N개');
    // 메뉴판 묶음의 머리 숫자는 줄마다 묶인 낱말(words)을 합산한 실제 낱말 수(숫자를 박아 두지 않음), 다르면 줄 수도 함께("낱말 10개 · 5줄", 같으면 "5줄")
    assert.equal(/groupCount\('낱말', boardWords\.length, board\.length\)/.test(page), true, '메뉴판 묶음 머리에 실제 낱말 수와 줄 수');
    // 지역만 바꾼 조합도 같은 꼴("조합 4개 · 3줄"), 맨 위 수는 세 가지 줄을 모두 더한 '줄' 수라서 묶음 머리의 마지막 '줄'끼리 더하면 맞는다(23 = 15 + 5 + 3)
    assert.equal(/groupCount\('조합', regionCombos, region\.length\)/.test(page), true, '지역 묶음 머리에 조합 수와 줄 수');
    assert.equal(/const groupCount = \(unit, count, lines\) => \(count > 0 && count !== lines \? `\$\{unit\} \$\{count\}개 · \$\{lines\}줄` : `\$\{lines\}줄`\)/.test(page), true, '수가 다르면 둘 다, 같으면 줄만');
    assert.equal(/lineTotal = single\.length \+ board\.length \+ region\.length/.test(page), true, '맨 위 수는 줄을 모두 더한 수');
    assert.equal(/label=\{`추천에서 뺀 키워드 · \$\{lineTotal\}줄`\}/.test(page), true, '맨 위 머리는 줄 단위');
    // 길게 눌러 끌기 안내는 이름이 보이는 점만 된다는 사실대로(graph/gesture.js armHold 는 이름이 켜진 점·이름표·묶음 중심만 잡는다)
    assert.equal(graph.includes('이름이 보이는 점은 길게 눌러 당깁니다'), true, '길게 눌러 당기기 안내');
    assert.equal(graph.includes("'점을 누르면 이름, 이름을 누르면 살펴봅니다 · 점을 길게 눌러 끌면"), false, '옛 안내가 남아 있음');
    // 폰 안내 줄은 두 줄이 한계(48px 고정, 360 폭 268px)라 문장을 늘리지 않는다: 손가락용 문장 전체가 65자 미만(세 줄이 된 65자는 잘렸다)
    const touchGuide = graph.match(/\? '(점을 누르면 이름[^']*)'/)?.[1] || '';
    assert.equal(touchGuide.length > 0 && touchGuide.length <= 62, true, `폰 안내 문장 길이 ${touchGuide.length}자`);
    // 경쟁 비교: '내 매장을 뺀'은 내 매장이 검색 5위 안일 때만 말한다
    const geoPanel = readFileSync(new URL('GeoAeoPanel.js', dir), 'utf8');
    assert.equal(/if \(signals\.mineInTop5\) return `검색 상위 5위 중 내 매장을 뺀 \$\{count\}곳`/.test(geoPanel), true, '내 매장이 5위 안일 때만 뺀 곳 수');
    assert.equal(geoPanel.includes('검색 상위 매장 ${count}곳'), true, '5위 밖이면 상위 매장 몇 곳');
    // '지역 확인 못 함' 칩이 있을 때만 폰에서도 읽히는 풀이 한 줄(.note 는 13px)
    assert.equal(/unknownShown && \(\s*<p className=\{styles\.note\}>/.test(page), true, '지역 확인 못 함 풀이 한 줄');
    assert.equal(/\.note\s*\{[^}]*font-size:\s*13px/.test(css), true);
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
