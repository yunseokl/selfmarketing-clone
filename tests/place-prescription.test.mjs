import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPrescription, splitAdvice, fillStatus, prescriptionFileName, dateStamp, dateTimeLabel, dayLabel, minutesLabel, ranksText,
    slotProposal, pickDiagnoses, rivalComparison, TASK_INFO, DIAGNOSIS_MIN_SCORE, METRICS_MIN, METRICS_MAX, DRAFT_MARK,
    estimatePage1Mm, PAGE1_BUDGET_MM, REVIEW_ASK_CAUTION, evidenceOfItem, EVIDENCE_MIN, NEXT_CANDIDATES_SHOWN, poolComparison, excludedReason, pharmacyOfferings,
    rivalKeywordTable, AI_SOURCE_LABEL, EXTRA_MINUTES, emptyReasonText, pageOneLegend, judgeGroups, confirmedText, CONFIRMED_LABEL, JUDGE_WHY_NO_DATA, JUDGE_WHY_DEFAULT, JUDGE_WHY_VOICE, JUDGE_WHY_SHARE, JUDGE_SHOWN, judgeNote, placeNoun, JUDGE_WHY_FAMILY, LACKS_TAG, lacksTag, industryBasis, slotsNote, RANK_MISSING_TEXT, RANK_MISSING_HOW, registerNames, fitHeightMm, judgeSources, JUDGE_WHY_LONG,
    taskWhere, industryKind, skippedTasks, industryNote, industryScopeNote, SP_LOGIN, SP_NAMES_MAY_CHANGE, SP_UNSURE_INDUSTRY, SP_WAIT,
} from '../lib/place-prescription.js';
import {
    INVENTED_WORDS, draftProblems, replyDrafts, feedDrafts, introDraft, menuFrames, keywordPlacements, popularItems, notMainTerms,
    priceRange, busyTime, tidyMenuName, centerCategory, draftMarkFor, MENU_FRAMES_MAX, blankWhyText,
} from '../lib/place-prescription-drafts.js';
import { LONG } from './place-prescription.fixtures.mjs';
import { buildActionItems } from '../lib/naver-place.js';
import { recommendKeywords, searchCategoryWord } from '../lib/place-keywords.js';
import { analyzeGeoAeo } from '../lib/place-geo.js';
import { PHARMACY, RESTAURANT, SALON, NOW, graphInput } from './place-graph.fixtures.mjs';

// 견본(tests/place-graph.fixtures.mjs)으로 화면이 넘기는 것과 같은 묶음을 만들어 처방전 자료를 만듭니다. 네트워크 호출은 없습니다.
function docOf(sample, overrides = {}) {
    const input = graphInput(sample, overrides.ranks ? { ranks: overrides.ranks } : {});
    const geo = overrides.geo === null ? null : analyzeGeoAeo({ place: input.place, activity: input.activity, ranks: input.ranks, nowMs: NOW });
    const doc = buildPrescription({ ...input, geo, fetchedAt: NOW, nowMs: NOW, ...overrides });
    return { doc, input, geo };
}

function sectionOf(doc, id) {
    return doc.sections.find((section) => section.id === id) || null;
}

// 문서에 들어간 초안 글(제목·본문·답글·소개글·예문)을 모두 모읍니다.
function draftTexts(doc) {
    const texts = [];
    for (const task of sectionOf(doc, 'tasks')?.items || []) {
        const draft = task.draft;
        if (!draft) continue;
        if (draft.kind === 'reply') texts.push(...draft.items.map((item) => item.text));
        if (draft.kind === 'feed') texts.push(...draft.items.flatMap((item) => [item.title, item.body]), draft.altTitle || '');
        if (draft.kind === 'intro') texts.push(draft.text, draft.oneLine || '');
        if (draft.kind === 'menu') texts.push(...draft.rows.map((row) => row.frame));
    }
    for (const row of sectionOf(doc, 'keywords')?.placements || []) if (row.sentence) texts.push(row.sentence);
    return texts.filter(Boolean);
}

const SAMPLES = [['음식점', RESTAURANT], ['약국', PHARMACY], ['미용실', SALON]];

/* ───────── 도우미 ───────── */

test('날짜: 한국 시각으로 적는다', () => {
    // 2026-11-16 15:30 UTC = 2026-11-17 00:30 KST
    const ms = Date.UTC(2026, 10, 16, 15, 30);
    assert.equal(dateStamp(ms), '2026-11-17');
    assert.equal(dateTimeLabel(ms), '2026년 11월 17일 00:30');
    assert.equal(dayLabel(ms), '11월 17일');
});

test('파일 이름: "혼잘마 처방전 - 매장이름 - 날짜", 파일 이름에 못 쓰는 글자는 뺀다', () => {
    assert.equal(prescriptionFileName('대물섬 강남점', NOW), '혼잘마 처방전 - 대물섬 강남점 - 2026-11-16');
    assert.equal(prescriptionFileName('큰사랑약국 [공공/심야]: "24시"', NOW), '혼잘마 처방전 - 큰사랑약국 [공공 심야] 24시 - 2026-11-16');
    assert.equal(prescriptionFileName('', NOW), '혼잘마 처방전 - 2026-11-16');
});

test('걸리는 시간 표기와 순위 묶음 표기', () => {
    assert.equal(minutesLabel(10), '약 10분');
    assert.equal(minutesLabel(60), '약 1시간');
    assert.equal(minutesLabel(80), '약 1시간 20분');
    assert.equal(minutesLabel(0), null);
    assert.equal(ranksText([
        { status: 'found', rank: 12 }, { status: 'found', rank: 3 }, { status: 'beyond', scanned: 300 }, { status: 'found', rank: 5 },
    ]), '3·5·12위·300위 밖');
});

test('splitAdvice: 권하는 문장은 "어떻게", 나머지는 "왜"로 — 글자는 그대로', () => {
    const reply = '최근 방문자 리뷰 50개 중 사장님 답글이 20개입니다. 답글이 없는 30개 가운데 최근 것부터 달아 보세요. 답글은 재방문과 신뢰에 도움이 됩니다.';
    assert.deepEqual(splitAdvice(reply), {
        why: '최근 방문자 리뷰 50개 중 사장님 답글이 20개입니다. 답글은 재방문과 신뢰에 도움이 됩니다.',
        how: '답글이 없는 30개 가운데 최근 것부터 달아 보세요.',
    });
    assert.deepEqual(splitAdvice('손님이 바로 문의할 수 있도록 네이버 톡톡을 연결하세요.'), {
        why: null, how: '손님이 바로 문의할 수 있도록 네이버 톡톡을 연결하세요.',
    });
    // 따옴표 안의 마침표에서는 나누지 않는다
    const feed = '마지막 소식은 "11월 휴무 안내. 꼭 확인하세요"입니다. 새 메뉴·이벤트·휴무 안내를 소식에 올리면 매장 화면 상단에 노출됩니다.';
    assert.equal(splitAdvice(feed).why, feed);
    assert.deepEqual(splitAdvice(''), { why: null, how: null });
});

test('fillStatus: 화면의 정보 채움 상태와 같은 항목·판정', () => {
    const fill = fillStatus(PHARMACY.place);
    assert.equal(fill.total, 9);
    assert.equal(fill.done, 4);
    assert.equal(fillStatus(SALON.place).done, fillStatus(SALON.place).total);
});

/* ───────── 문서 뼈대 ───────── */

test('세 견본 모두: 머리·1쪽 요약·상세 구역 글자(A부터)·고지를 갖춘다', () => {
    for (const [name, sample] of SAMPLES) {
        const { doc, input } = docOf(sample);
        assert.equal(doc.title, '플레이스 처방전');
        assert.equal(doc.store.name, input.place.name, name);
        assert.equal(doc.lookedUp, '2026년 11월 16일 12:00 조회');
        assert.equal(doc.recheck.label, '12월 14일', '다시 볼 날은 조회한 날부터 4주 뒤');
        assert.deepEqual(doc.sections.map((section) => section.letter), doc.sections.map((_, index) => String.fromCharCode(65 + index)));
        assert.ok(doc.summary.diagnoses.length >= 1 && doc.summary.diagnoses.length <= 3, name);
        assert.ok(doc.summary.week.items.length >= 1 && doc.summary.week.items.length <= 3, name);
        assert.ok(doc.summary.metrics.length >= METRICS_MIN && doc.summary.metrics.length <= METRICS_MAX, name);
        assert.ok(doc.notes.some((note) => note.includes(`초안 문안은 ${placeNoun(sample.place)} 정보로 자동으로 만든 것입니다. 사실과 다르면 고쳐 쓰세요.`)));
        assert.ok(doc.notes.some((note) => note.includes('네이버 공식 제휴 데이터가 아닙니다')));
    }
});

test('세 견본 모두: 효과를 약속하는 말·검색량 이야기가 없다', () => {
    for (const [name, sample] of SAMPLES) {
        const text = JSON.stringify(docOf(sample).doc);
        assert.doesNotMatch(text, /순위가 (오릅|올라갑|상승합)니다|상위 노출(됩니다|을 보장)|매출이 (오릅|늘어납)니다|1위(를|가) (됩니다|보장)|검색량/, name);
    }
});

/* ───────── ① 핵심 진단 ───────── */

test('핵심 진단: 점수 높은 것부터 3개, 묶음마다 하나', () => {
    assert.deepEqual(docOf(RESTAURANT).doc.summary.diagnoses.map((diag) => diag.key), ['rankGap', 'reply', 'feed']);
    assert.deepEqual(docOf(PHARMACY).doc.summary.diagnoses.map((diag) => diag.key), ['reply', 'description', 'keywordRegion']);
    assert.deepEqual(docOf(SALON).doc.summary.diagnoses.map((diag) => diag.key), ['menuDesc', 'rankWeak', 'introLine']);
});

test('핵심 진단: 문장의 숫자는 자료에서 계산한 값', () => {
    const restaurant = docOf(RESTAURANT, { fitPage1: false }).doc.summary.diagnoses;
    assert.equal(restaurant[0].text, '강남구청 키워드는 3·5·12위인데 압구정 키워드는 41위·300위 밖입니다.');
    assert.equal(restaurant[0].basis, '대표키워드 2칸이 순위가 낮은 지역(압구정)에 쓰이고 있습니다.');
    assert.equal(restaurant[1].text, '사장님 답글률 40%: 최근 리뷰 50개 중 30개에 답글이 없습니다.');
    assert.equal(restaurant[2].text, '소식 46일째 없음: 마지막 소식은 "대방어 입고 안내"입니다.');
    const pharmacy = docOf(PHARMACY, { fitPage1: false }).doc.summary.diagnoses;
    // 추천 순서(근거 점수 순: 청주대형약국 98 · 청주약국 76 · 오창약국 74)에서 순위가 있는 앞의 둘
    assert.equal(pharmacy[2].basis, "지역을 붙인 '청주대형약국'은 내 3위, '청주약국'은 내 6위입니다.");
    assert.equal(docOf(SALON, { fitPage1: false }).doc.summary.diagnoses[1].text, '대표키워드 강남역미용실은 18위로 10위 밖입니다.');
});

test('pickDiagnoses: 같은 묶음은 점수 높은 하나만, 기준 점수 미만은 뺀다', () => {
    const picked = pickDiagnoses([
        { key: 'rankGap', group: 'rank', score: 90 },
        { key: 'rankWeak', group: 'rank', score: 70 },
        { key: 'keywordRegion', group: 'keywords', score: 78 },
        { key: 'keywordsEmpty', group: 'keywords', score: 65 },
        { key: 'blogStale', group: 'blogStale', score: DIAGNOSIS_MIN_SCORE - 1 },
    ]);
    assert.deepEqual(picked.map((diag) => diag.key), ['rankGap', 'keywordRegion']);
});

/* ───────── ② 이번 주 할 일 ───────── */

test('이번 주 할 일: 할 일 점수 순서 3개, 걸리는 시간·하는 곳은 일의 종류로 정한 값', () => {
    const { doc } = docOf(RESTAURANT);
    const week = doc.summary.week;
    // 대표키워드가 맨 앞이고, 소식·답글(둘의 점수는 AI 검색 점검 점수 증가량에 따라 서로 앞서거나 뒤섬)이 이어진다
    assert.equal(week.items[0].key, 'keywords');
    assert.deepEqual(week.items.map((task) => task.key).sort(), ['feed', 'keywords', 'reply']);
    for (const task of week.items) {
        assert.equal(task.minutes, TASK_INFO[task.key].minutes);
        assert.equal(task.where, TASK_INFO[task.key].where);
    }
    assert.equal(week.totalLabel, '약 1시간');
    assert.equal(week.items[0].title, '대표키워드 2칸 고치기');
    assert.equal(week.items[0].why, '압구정횟집 내 41위 · 압구정회식 300위 밖.');
    assert.equal(week.items.find((task) => task.key === 'reply').title, '답글 없는 리뷰 30개에 답글 달기');

    assert.deepEqual(docOf(PHARMACY).doc.summary.week.items.map((task) => task.key), ['keywords', 'reply', 'description']);
    assert.equal(docOf(PHARMACY).doc.summary.week.items[0].why, '분류 이름 4칸 · 빈 칸 1칸.');
    assert.deepEqual(docOf(SALON).doc.summary.week.items.map((task) => task.key), ['keywords', 'menuDesc', 'intro']);
});

test('이번 주 할 일: 다른 사람이 해 줘야 하는 일(블로그 체험단)은 고르지 않는다', () => {
    assert.equal(TASK_INFO.blog.week, false);
    const activity = { ...RESTAURANT.activity, blog: { ...RESTAURANT.activity.blog, last30: 0 } };
    const { doc } = docOf({ ...RESTAURANT, activity });
    assert.ok(!doc.summary.week.items.some((task) => task.key === 'blog'));
});

/* ───────── ③ 대표키워드 5칸 ───────── */

test('5칸 최종안: 지역 있고 30위 안이면 유지, 남는 칸은 추천(lib 근거 점수 순)을 위에서부터 채운다', () => {
    const { doc, input } = docOf(RESTAURANT);
    const rows = doc.summary.slots.rows;
    // 화면 추천 순서(점수 순): 숙성회 41 · 강남횟집 40 · 광어 32 · 모임 28 · 대방어 18 · 룸식당 16 → 위에서부터 빈 자리(교체 2칸)만큼
    assert.deepEqual(input.recommendation.items.filter((item) => item.registrable).slice(0, 2).map((item) => item.keyword), ['강남구청숙성회', '강남횟집']);
    assert.deepEqual(rows.map((row) => [row.now, row.action, row.next]), [
        ['강남구청횟집', 'keep', '강남구청횟집'], ['강남구청점심', 'keep', '강남구청점심'], ['강남구청회식', 'keep', '강남구청회식'],
        ['압구정횟집', 'replace', '강남횟집'], ['압구정회식', 'replace', '강남구청숙성회'],
    ]);
    // 같은 낱말(횟집)의 다른 지역 조합이 뽑혔으면 순위 낮음 칸이어도 그 칸에 짝지어 놓는다("순위가 낮은 지역만 바꿈")
    assert.ok(rows.every((row) => !/압구정/.test(row.next) || row.action === 'keep'));
    assert.deepEqual(docOf(RESTAURANT, { fitPage1: false }).doc.summary.slots.unranked, ['강남횟집', '강남구청숙성회']);
    assert.equal(docOf(RESTAURANT, { fitPage1: false }).doc.summary.slots.unrankedText,
        "'강남횟집', '강남구청숙성회'는 아직 순위를 조회하지 않았습니다. 바꾸기 전에 혼잘마에서 순위를 먼저 확인하세요. 30위 밖이면 C의 '다음 후보'로 바꾸세요. 근거는 C.");
    // 이유와 근거는 lib 의 evidence.parts(점수가 높은 순) 그대로
    assert.equal(rows[3].reason, '내 41위 → 상위 2곳 등록 · 블로그 30/52');
    assert.equal(rows[4].reason, '300위 밖 → 리뷰 22회 · 블로그 25/52 · 상위 2곳 사용');
    // '횟집'이 5칸에 두 번 나오는 까닭을 그 줄의 이유(C)에 적는다
    const why = sectionOf(docOf(RESTAURANT).doc, 'keywords').rows.find((row) => row.now === '압구정횟집').why;
    assert.equal(why, "내 순위가 41위라 30위 안에 들지 못합니다. '횟집'은 5칸에 두 번 들어갑니다(같은 낱말은 두 칸까지 허용). 순위가 낮은 지역만 바꾼 조합입니다. 이미 등록한 '강남구청횟집'과 같은 낱말이고, 상위 2곳이 이 조합을 등록.");
    // 순위 확인용(맛집 등 홍보성, 등록 불가)은 넣지 않는다
    assert.ok(rows.every((row) => !/맛집/.test(row.next)));
});

test('5칸 = 화면 추천을 위에서부터 채운 것(교체·빈 칸에 들어간 새 키워드는 추천 순서의 앞에서부터)', () => {
    for (const [name, sample] of [...SAMPLES, ['긴 견본', LONG]]) {
        const { doc, input } = docOf(sample, { fitPage1: false });
        const registered = new Set(input.recommendation.registered.map((entry) => entry.keyword));
        const added = doc.summary.slots.rows.filter((row) => row.action === 'replace' || row.action === 'fill').map((row) => row.next);
        const order = input.recommendation.items.filter((item) => item.registrable && !registered.has(item.keyword) && item.evidence.points >= EVIDENCE_MIN).map((item) => item.keyword);
        assert.deepEqual([...added].sort(), order.slice(0, added.length).sort(), `${name}: 새 키워드 = 추천 앞 ${added.length}개`);
    }
});

test('추천이 비는 까닭(emptyReason)은 5칸 아래 한 줄로 적는다', () => {
    assert.equal(emptyReasonText({ emptyReason: 'noRegion' }), '주소·가까운 역에서 지역을 읽지 못해 지역을 붙인 추천을 만들지 못했습니다.');
    assert.equal(emptyReasonText({ emptyReason: null }), null);
    const doc = docOf({ ...PHARMACY, place: { ...PHARMACY.place, keywords: ['청주약국'] } }, { fitPage1: false }).doc;
    assert.equal(doc.summary.slots.emptyText === null || typeof doc.summary.slots.emptyText === 'string', true);
});

test('5칸에 들지 못한 좋은 후보는 C 에 "다음 후보"로 근거와 함께 싣고, 제외표가 "묶음"으로 가리키는 낱말은 5칸이나 다음 후보에 반드시 있다', () => {
    for (const [name, sample] of [...SAMPLES, ['긴 견본', LONG]]) {
        const { doc, input } = docOf(sample, { fitPage1: false });
        const keywords = sectionOf(doc, 'keywords');
        const fiveWords = doc.summary.slots.rows.map((row) => row.next);
        const nextWords = (keywords.next?.rows || []).map((row) => row.keyword);
        // 5칸과 다음 후보는 겹치지 않고, 다음 후보에는 근거와 못 든 까닭이 있다
        assert.ok(nextWords.every((word) => !fiveWords.includes(word)), name);
        for (const row of keywords.next?.rows || []) assert.ok(row.basis && row.why, `${name}: ${row.keyword}`);
        assert.ok(nextWords.length <= NEXT_CANDIDATES_SHOWN + 1 || name === '긴 견본', name);
        // 다음 후보는 화면 추천 순서를 따른다(점수가 높은 것부터)
        const order = input.recommendation.items.map((item) => item.keyword);
        const positions = nextWords.map((word) => order.indexOf(word));
        assert.deepEqual(positions, [...positions].sort((a, b) => a - b), name);
        // 제외표의 "A → B" 묶음: B 를 낱말로 가진 추천이 5칸 또는 다음 후보에 있다
        for (const entry of input.recommendation.excluded.filter((item) => item.rule === 'merged' && item.into)) {
            const where = [...fiveWords, ...nextWords].some((keyword) => keyword.includes(entry.into));
            assert.ok(where, `${name}: '${entry.term} → ${entry.into}' 가 가리키는 낱말이 문서에 없다`);
        }
    }
    // 음식점: 광어·모임·대방어·룸식당이 소리 없이 빠지지 않고 근거와 함께 보인다
    const next = sectionOf(docOf(RESTAURANT).doc, 'keywords').next.rows;
    assert.deepEqual(next.map((row) => row.keyword), ['강남구청광어', '강남구청모임', '강남구청대방어', '강남구청룸식당']);
    assert.equal(next[0].basis, '리뷰 34회 · 블로그 14/52');
    assert.equal(next[2].basis, "메뉴 대방어 정식·대방어 숙성회 · 소식 대방어 입고 안내");
});

test('5칸 최종안: 분류 이름은 손님이 쓰는 말로, 빈 칸은 추천 순으로 채운다(약국)', () => {
    const { doc, input } = docOf(PHARMACY);
    const rows = doc.summary.slots.rows;
    assert.deepEqual(rows.map((row) => [row.now, row.action, row.next, row.nextRank]), [
        ['일반의약품', 'replace', '청주약국', '6위'], ['건강기능식품', 'replace', '청주영양제', null],
        ['동물의약품', 'replace', '청주동물약국', null], ['상비약', 'replace', '오창약국', '2위'], [null, 'fill', '청주대형약국', '3위'],
    ]);
    // 손님이 쓰는 말은 화면의 '대신 써 볼 말'과 같다
    for (const row of rows.slice(0, 3)) {
        const entry = input.recommendation.registered.find((item) => item.keyword === row.now);
        assert.equal(row.next, entry.spoken.keyword);
    }
    assert.equal(new Set(rows.map((row) => row.next)).size, 5, '같은 키워드를 두 칸에 넣지 않는다');
});

test('5칸 최종안(미용실): 10위 밖이라도 30위 안이면 유지, 지금 낱말의 지역 조합과 근거가 강한 후보를 추천 순서대로', () => {
    const rows = docOf(SALON, { fitPage1: false }).doc.summary.slots.rows;
    // 화면 추천 순서(점수): 댄디컷 118 · 다운펌 68 · 쉐도우펌 60 · 볼륨매직 48 → 위 넷이 교체 4칸. 지금 낱말에 지역만 붙인 조합(볼륨매직·댄디컷·다운펌)은 그 칸에,
    // 가르마펌 칸에는 남은 쉐도우펌이 들어간다(가르마펌의 지역 조합은 리뷰 341회뿐이라 5칸에 못 듦).
    assert.deepEqual(rows.map((row) => [row.now, row.action, row.next]), [
        ['강남역미용실', 'keep', '강남역미용실'], ['볼륨매직', 'replace', '강남역볼륨매직'], ['댄디컷', 'replace', '강남역댄디컷'],
        ['다운펌', 'replace', '강남역다운펌'], ['가르마펌', 'replace', '강남역쉐도우펌'],
    ]);
    assert.equal(rows[0].reason, '내 18위 — 30위 안이라 유지');
    // 볼륨매직은 "근거 약함"이 아니다(예약 214건·리뷰 299회가 근거에 들어옴)
    // (순서를 가르는 '이미 등록한 낱말' 가산도 근거에 적는다: 볼륨매직 48 > 아이롱펌 44)
    assert.equal(rows[1].reason, '지역명 없음 → 리뷰 299회 · 예약 214건 · 등록 키워드의 낱말');
    assert.equal(rows[2].reason, '지역명 없음 → 내 2위 · 예약 554건 · 리뷰 2,452회 · 등록 키워드의 낱말');
    assert.equal(rows[4].reason, '지역명 없음 → 예약 356건 · 리뷰 1,390회 · 블로그 60/431');
    // 같은 문서의 소개글 초안이 "예약이 많은 시술은 댄디컷·다운펌·쉐도우펌"이므로 5칸과 같은 낱말을 쓴다
    const intro = introDraft(SALON.place, SALON.activity);
    for (const term of ['댄디컷', '다운펌', '쉐도우펌']) {
        assert.ok(rows.some((row) => row.next.includes(term)), `${term} ⊂ 5칸`);
        assert.ok(intro.text.includes(term), `${term} ⊂ 소개글`);
    }
    // 나머지 좋은 후보(시스루댄디컷·아이롱펌·슬릭컷·필러스컷)는 다음 후보로 근거와 함께. 시스루댄디컷은 '댄디컷' 가운데 리뷰가 가장 많은 품목이라 따로 추천한 것이고 lib 의 note 한 줄이 그 줄에 붙는다(미용 문서라 '메뉴'는 '시술'로).
    const nextRows = sectionOf(docOf(SALON).doc, 'keywords').next.rows;
    assert.deepEqual(nextRows.map((row) => row.keyword).slice(0, 4), ['강남역시스루댄디컷', '강남역아이롱펌', '강남역슬릭컷', '강남역필러스컷']);
    const sheer = nextRows.find((row) => row.keyword === '강남역시스루댄디컷');
    assert.match(sheer.basis, /예약 315건 · 리뷰 827회/);
    assert.match(sheer.note, /^'댄디컷' 가운데 리뷰가 가장 많은 시술\.$/);
});

test('C "왜 바꾸나"는 그 칸의 실제 교체 사유와 맞는다(견본 4종의 모든 교체 칸): 지역이 든 키워드에 "지역명이 없어"가 나오면 안 된다', () => {
    let checked = 0;
    for (const [name, sample] of [...SAMPLES, ['긴 견본', LONG]]) {
        const { doc, input } = docOf(sample);
        const registered = new Map(input.recommendation.registered.map((entry) => [entry.keyword, entry]));
        const rows = sectionOf(doc, 'keywords').rows.filter((row) => row.now);
        const summaryRows = new Map(doc.summary.slots.rows.map((row) => [row.no, row]));
        for (const row of rows) {
            const entry = registered.get(row.now);
            const label = `${name}: ${row.now} → ${row.next} | ${row.why}`;
            if (entry.concern) {
                // 분류 이름은 검색 행태를 단정하지 않고 하는 일만 짧게("…분류 이름이라 지역을 붙인 '약국' 키워드로 바꿉니다.")
                if (entry.concern.rule === 'classification' && entry.spoken?.term) {
                    // (같은 낱말이 5칸에 두 번 들어가면 그 까닭이 뒤에 이어진다)
                    // lib 이 손님 말로 바꿔 쓰라는 까닭(spoken.why)을 주면 그 문장이 먼저, 없을 때만 하는 일을 짧게
                    if (entry.spoken.why) assert.ok(row.why.startsWith(entry.spoken.why), label);
                    else assert.match(row.why, /^'[^']+'(은|는) 약·제품을 나누는 분류 이름이라 지역을 붙인 '[^']+' 키워드로 바꿉니다\.( '[^']+'은 5칸에 두 번 들어갑니다.*)?$/, label);
                    assert.equal(row.problem, '분류 이름', label);
                } else if (entry.concern.rule === 'lowRank') {
                    // 순위가 낮은 칸은 lib 의 살펴볼 점(concern)·순위(rank)와 같은 말
                    assert.ok(row.why.startsWith(entry.concern.reason), label);
                    assert.match(row.problem, /^내 \d+위$|위 밖$|^목록에 없음$|^먼 지역 결과$/, label);
                } else {
                    assert.ok(row.why.startsWith(entry.concern.reason), label);
                }
            } else if (!entry.hasRegion) {
                assert.match(row.why, /^지역명이 없어 검색하는 위치마다 순위가 달라집니다\./, label);
                assert.equal(row.problem, '지역명 없음', label);
            } else {
                // 지역이 있는 키워드: 순위가 사유이고 '지역명이 없어'는 나오지 않는다
                assert.doesNotMatch(row.why, /지역명이 없어/, label);
            }
            // 1쪽 5칸 표의 이유 첫머리도 같은 사유
            assert.ok(summaryRows.get(row.no).reason.startsWith(row.problem), `${label} | 1쪽: ${summaryRows.get(row.no).reason}`);
            checked += 1;
        }
    }
    assert.ok(checked >= 12, `교체 칸 ${checked}개를 검사했다`);
    // 음식점: 압구정횟집(내 41위)·압구정회식(300위 밖)은 지역이 있는 키워드라 순위가 사유다
    const restaurant = sectionOf(docOf(RESTAURANT).doc, 'keywords').rows;
    assert.ok(restaurant.find((row) => row.now === '압구정횟집').why.startsWith('내 순위가 41위라 30위 안에 들지 못합니다.'));
    assert.equal(restaurant.find((row) => row.now === '압구정회식').why, '내 순위가 300위 밖이라 30위 안에 들지 못합니다.');
    assert.equal(restaurant.find((row) => row.now === '압구정횟집').problem, '내 41위');
    assert.equal(restaurant.find((row) => row.now === '압구정회식').problem, '300위 밖');
});

test('evidenceOfItem: lib 이 붙인 evidence 를 그대로 쓰고(점수를 다시 매기지 않음), 없으면 근거 없음', () => {
    const evidence = { points: 41, parts: [{ kind: 'review', text: '리뷰 22회', short: '리뷰 22회', points: 20 }, { kind: 'blog', text: '블로그 25/52', short: '블로그 25/52', points: 21 }] };
    assert.deepEqual(evidenceOfItem({ evidence }), { points: 41, parts: evidence.parts });
    assert.deepEqual(evidenceOfItem({ reasons: [{ kind: 'booking', text: '예약 356건' }] }), { points: 0, parts: [] });
    assert.deepEqual(evidenceOfItem(null), { points: 0, parts: [] });
    // 견본: 추천 한 줄의 점수는 그 근거 점수의 합이고, 추천은 점수가 높은 순이다
    for (const sample of [RESTAURANT, PHARMACY, SALON]) {
        const items = graphInput(sample).recommendation.items;
        for (const item of items) assert.equal(item.score, item.evidence.points);
        const scores = items.map((item) => item.score);
        assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    }
});

test('slotProposal: 추천 순서(lib)대로 위에서부터 채우고, 순위 확인용은 넣지 않으며, 근거 미달 후보는 빈 칸에만(근거 약함 표시) 쓴다', () => {
    const place = { keywords: [], visitorReviews: 1000 };
    const evidence = (points, kind = 'booking') => ({ points, parts: [{ kind, text: `${kind} ${points}`, short: `${kind} ${points}`, points }] });
    const item = (keyword, term, points, extra = {}) => ({ keyword, term, region: '강남', registrable: true, score: points, evidence: evidence(points), ...extra });
    const recommendation = {
        registered: [],
        items: [
            item('강남컷A', '컷', 50), item('역삼컷B', '컷', 40), item('강남맛집', '맛집', 30, { registrable: false }),
            item('강남펌', '펌', 26), item('강남약한말', '약한말', EVIDENCE_MIN - 1), item('강남염색', '염색', 20),
            item('강남매직', '매직', 18), item('강남클리닉', '클리닉', 14),
        ],
    };
    const result = slotProposal({ place, recommendation, rankOf: new Map() });
    assert.deepEqual(result.slots.map((slot) => slot.next), ['강남컷A', '역삼컷B', '강남펌', '강남염색', '강남매직'], '근거가 충분한 후보가 있으면 그것을 lib 순서대로(등록 불가 제외)');
    assert.equal(result.empty, 0);
    assert.ok(result.slots.every((slot) => !slot.weak));
    // 5칸에 못 든 후보는 다음 후보로(근거 약함도 표시해서): 근거가 충분한 후보는 '같거나 더 높은 후보가 먼저 채웠다', 약한 후보는 따로 까닭을 적는다
    assert.deepEqual(result.nextCandidates.map((entry) => entry.keyword), ['강남약한말', '강남클리닉']);
    assert.ok(result.nextCandidates.every((entry) => entry.basis && entry.why && Number.isFinite(entry.points)));
    assert.match(result.nextCandidates[1].why, /근거 점수가 같거나 더 높은 후보가 먼저 채웠습니다/);
    assert.doesNotMatch(JSON.stringify(result.nextCandidates), /이보다 근거가 강한/);
    assert.equal(result.nextCandidates[0].weak, true);
    assert.match(result.nextCandidates[0].note, /근거 점수 12 미만이라 등록한 칸을 바꾸는 데는 쓰지 않았습니다/);
    // 빈 칸은 점수가 낮아도 위에서부터 채운다(화면 추천과 인쇄본이 같은 말을 하게) — 근거가 약하면 표시
    const weakOnly = slotProposal({ place, recommendation: { registered: [], items: [item('강남약한말', '약한말', EVIDENCE_MIN - 1)] }, rankOf: new Map() });
    assert.equal(weakOnly.empty, 4);
    assert.deepEqual(weakOnly.slots.map((slot) => [slot.action, slot.next, slot.weak]), [['fill', '강남약한말', true]]);
    assert.match(weakOnly.slots[0].reason, /^빈 칸·근거 약함 → /);
    assert.equal(weakOnly.weakFills, 1);
    // 이미 등록한 칸을 바꿀 때는 근거 하한을 지킨다: 약한 후보뿐이면 그 칸은 그대로 두고(살펴보기), 빈 칸만 채운다
    const registeredNoRegion = { keyword: '컷', hasRegion: false, region: null, rank: null };
    const replaceWeak = slotProposal({
        place: { keywords: ['컷'] }, recommendation: { registered: [registeredNoRegion], items: [item('강남약한말', '약한말', EVIDENCE_MIN - 1)] }, rankOf: new Map(),
    });
    assert.deepEqual(replaceWeak.slots.map((slot) => [slot.action, slot.next]), [['check', '컷'], ['fill', '강남약한말']]);
    assert.match(replaceWeak.slots[0].reason, /^지역명 없음 — 바꿀 만큼 근거가 충분한 후보가 없어 그대로 둡니다\.$/);
});

test('slotProposal: 바꿀 후보가 없으면 유지하고 살펴볼 점만 적는다', () => {
    const place = { keywords: ['일반의약품'] };
    const recommendation = {
        registered: [{ keyword: '일반의약품', hasRegion: false, region: null, concern: { rule: 'classification', reason: '분류 이름입니다.' } }],
        items: [],
    };
    const result = slotProposal({ place, recommendation, rankOf: new Map() });
    assert.equal(result.slots[0].action, 'check');
    assert.equal(result.slots[0].next, '일반의약품');
    assert.equal(result.changes, 0);
    assert.equal(result.empty, 4);
    assert.equal(slotProposal({ place: { keywords: null }, recommendation, rankOf: new Map() }), null);
});

/* ───────── 경쟁 매장 ───────── */

test('경쟁 비교: 내 위 매장(순위 결과 목록 안)의 중간값을 계산하고, 리뷰 수 중간값은 반올림한다', () => {
    const { input } = docOf(RESTAURANT);
    const doneRows = input.ranks.filter((row) => row.state === 'done');
    const { rows } = rivalComparison({ place: input.place, doneRows });
    const lunch = rows.find((row) => row.keyword === '강남구청점심');
    // 1~4위: 방문자 420·2,210·1,840·960 → 중간값 1,400 / 블로그 38·505·310·122 → 216 / 평점 4.7·4.39·4.61·4.48 → 4.55
    assert.deepEqual([lunch.above.from, lunch.above.to, lunch.above.count], [1, 4, 4]);
    assert.equal(lunch.above.visitor, 1400);
    assert.equal(lunch.above.blog, 216);
    assert.equal(lunch.above.score, 4.55);
    assert.equal(lunch.first.name, '시험학동회관');
    assert.deepEqual(lunch.mine, { visitor: 323, blog: 52, score: 4.97 });

    const pharmacy = docOf(PHARMACY);
    const big = rivalComparison({ place: pharmacy.input.place, doneRows: pharmacy.input.ranks.filter((row) => row.state === 'done') })
        .rows.find((row) => row.keyword === '청주대형약국');
    assert.equal(big.above.blog, 203, '192·213 → 202.5 → 203');
});

test('경쟁 비교: 가장 큰 격차 문장은 남겨 둘 지역의 키워드에서 고르고, 매장이 하나면 중간값이라 쓰지 않는다', () => {
    const rivals = sectionOf(docOf(RESTAURANT).doc, 'rivals');
    assert.equal(rivals.headline[0], '강남구청횟집 1~2위 매장 2곳의 방문자 리뷰 중간값은 1,400개, 내 매장은 323개입니다.');
    assert.ok(rivals.headline.some((line) => line.startsWith('평점은 내 매장이 4.97점으로')));
    const pharmacy = sectionOf(docOf(PHARMACY).doc, 'rivals');
    assert.equal(pharmacy.headline[0], '오창약국 1위 약국(건강약국)의 방문자 리뷰는 1,966개, 내 약국은 58개입니다.');
    assert.equal(pharmacy.hasScore, false, '평점을 공개하지 않는 업종은 평점 칸을 뺀다');
});

test('경쟁 비교: 매장 이름은 순위 결과 그대로', () => {
    const { doc, input } = docOf(RESTAURANT);
    const names = new Set(input.ranks.flatMap((row) => row.result.top.map((top) => top.name)));
    for (const row of sectionOf(doc, 'rivals').rows) {
        for (const line of row.lines.filter((entry) => entry.kind === 'first')) assert.ok(names.has(line.label.replace(/^1위 /, '')), line.label);
    }
});

/* ───────── ④ 다시 볼 숫자 ───────── */

test('4주 뒤 다시 볼 숫자: 진단과 이어진 숫자를 먼저, 비교 기준은 자료에 있는 값만', () => {
    const metrics = docOf(RESTAURANT).doc.summary.metrics;
    // 1쪽에 다 들어가지 않아 5번째 줄(블로그 리뷰)은 fitSummary 가 뺐다
    assert.deepEqual(metrics.map((metric) => metric.key), ['rank', 'reply', 'feed', 'visitor']);
    assert.ok(!metrics.some((metric) => 'compareShort' in metric), '맞추기용 칸은 문서에 남기지 않는다');
    assert.equal(metrics[0].now, '2/5개');
    assert.equal(metrics[1].compare, '혼잘마 점검 기준 80% 이상');
    // 상위 전체(화면의 '상위 N곳과 비교') 중간값과 내 위 매장 중간값을 함께: 뒤처지는지 앞서는지가 한눈에 읽힌다
    assert.equal(metrics[3].compare, '상위 99곳 중간값 900개(뒤처짐) · 1~2위 매장 2곳 중간값 1,400개');
    // 지표 메모(지금 속도)는 1쪽이 넘칠 때 먼저 빠지므로 맞추기 전 값으로 확인
    const raw = docOf(RESTAURANT, { fitPage1: false }).doc.summary.metrics;
    assert.equal(raw.find((metric) => metric.key === 'visitor').note, '지금 속도(참고): 최근 7일 9개 · 하루 약 1.3개');
    assert.equal(metrics[2].compare, null, '비교할 자료가 없으면 비운다');
});

test('4주 뒤 다시 볼 숫자: "10위 안 키워드"는 화면과 같은 모수(순위 표의 모든 줄, 조회 중·실패 포함)로 세고 어떤 키워드를 셌는지 적는다', () => {
    // 약국: 화면은 "10위 안 3/5"(청주영양제 조회 중·청주동물약국 실패 포함). 예전 문서는 등록 키워드 3개만 세어 "3/3"이었다.
    const pharmacy = docOf(PHARMACY).doc;
    const rank = pharmacy.summary.metrics.find((metric) => metric.key === 'rank');
    assert.equal(rank.label, '10위 안 키워드');
    assert.equal(rank.now, '3/5개');
    // 5칸 최종안 키워드를 한 기준으로: 10위 안 / 10위 밖 / 아직 순위 모름('조회 중'·'조회 못 함'은 '아직 순위 모름' 하나로).
    // ("순위를 조회한 키워드 5개 … 순위 미조회: 2개"처럼 조회했다면서 미조회가 있는 모순된 문구를 쓰지 않는다)
    assert.equal(rank.note, '5칸 최종안 키워드 5개 — 10위 안: 청주약국 6위 · 오창약국 2위 · 청주대형약국 3위 / 아직 순위 모름: 청주영양제 · 청주동물약국');
    assert.doesNotMatch(rank.note, /순위를 조회한 키워드|순위 미조회/);
    assert.doesNotMatch(JSON.stringify(pharmacy), /센 키워드|순위를 센|조회 중|조회 못 함/);
    // 4주 뒤에는 1쪽 ③ 최종 5칸 키워드로 다시 조회한다(지금 순위를 모르는 칸은 사장님이 적는 빈칸)
    const plan = sectionOf(pharmacy, 'plan');
    assert.deepEqual(plan.recheck.keywords, [
        { keyword: '청주약국', now: '6위' }, { keyword: '청주영양제', now: null }, { keyword: '청주동물약국', now: null },
        { keyword: '오창약국', now: '2위' }, { keyword: '청주대형약국', now: '3위' },
    ]);
    assert.deepEqual(plan.recheck.keywords.map((row) => row.keyword), pharmacy.summary.slots.rows.map((row) => row.next));
    // 미용실: 5칸 최종안 5개 중 강남역댄디컷 2위 하나가 10위 안, 강남역미용실 18위는 10위 밖, 나머지 3개는 아직 순위를 모른다
    const salon = docOf(SALON).doc.summary.metrics.find((metric) => metric.key === 'rank');
    assert.equal(salon.now, '1/5개');
    assert.equal(salon.note, '5칸 최종안 키워드 5개 — 10위 안: 강남역댄디컷 2위 / 10위 밖: 강남역미용실 18위 / 아직 순위 모름: 강남역볼륨매직 · 강남역다운펌 · 강남역쉐도우펌');
    assert.equal(salon.compare, '4주 뒤에는 같은 5칸 최종안 키워드로 조회(4주 실행표 아래 표)');
    // 순위 표가 비면 이 줄을 뺀다
    assert.ok(!docOf(SALON, { ranks: [] }).doc.summary.metrics.some((metric) => metric.key === 'rank'));
});

test('상위 전체 비교: 앞서는 것은 앞선다고 쓴다(내 위 몇 곳과만 비교하면 모두 뒤처진 것처럼 읽힘)', () => {
    const { input } = docOf(SALON);
    const pool = poolComparison({ place: input.place, doneRows: input.ranks.filter((row) => row.state === 'done') });
    assert.equal(pool.keyword, '강남역미용실');
    assert.equal(pool.count, 99);
    assert.deepEqual(pool.rows.map((row) => [row.key, row.mine, row.median, row.best, row.verdictLabel]), [
        ['visitor', 5517, 2100, 21000, '앞섬'], ['blog', 431, 300, 4100, '앞섬'], ['score', 4.95, 4.8, 5, '앞섬'],
    ]);
    const rivals = sectionOf(docOf(SALON).doc, 'rivals');
    assert.equal(rivals.headline[0], '강남역미용실 1~3위 매장 3곳의 방문자 리뷰 중간값은 8,300개, 내 매장은 5,517개입니다.');
    assert.ok(rivals.headline.includes('강남역미용실 검색 결과의 상위 99곳 전체 중간값과 비교하면 방문자 리뷰·블로그·카페 리뷰·평점은 앞섭니다.'));
    assert.deepEqual(docOf(SALON, { fitPage1: false }).doc.summary.metrics.find((metric) => metric.key === 'visitor').compare, '상위 99곳 중간값 2,100개(앞섬) · 강남역미용실 1~3위 매장 3곳 중간값 8,300개');
    // 앞서는 것과 뒤처지는 것이 섞이면 둘 다 적는다
    const mixed = poolComparison({ place: { ...input.place, blogReviews: 100 }, doneRows: input.ranks.filter((row) => row.state === 'done') });
    assert.equal(mixed.line, '강남역미용실 검색 결과의 상위 99곳 전체 중간값과 비교하면 방문자 리뷰·평점은 앞서고 블로그·카페 리뷰는 뒤처집니다.');
    // 상위 목록 통계가 없거나 모양이 어긋나도 던지지 않고 그 비교만 뺀다
    const bad = input.ranks.filter((row) => row.state === 'done').map((row) => ({ ...row, result: { ...row.result, topSignals: { count: 5 } } }));
    assert.equal(poolComparison({ place: input.place, doneRows: bad }), null);
});

/* ───────── 초안 ───────── */

test('초안: 세 견본 모두 지어낸 할인·이벤트·효능·과장 표현이 없고 정책 점검을 통과한다', () => {
    for (const [name, sample] of SAMPLES) {
        const { doc, input } = docOf(sample);
        const texts = draftTexts(doc);
        assert.ok(texts.length >= 2, name);
        // 사장님이 등록해 둔 예약 혜택·쿠폰 이름(자료에 있는 말)은 '지어낸 말'이 아니다
        const own = [input.place.detail?.bookingPromotion, ...(input.activity?.coupons?.titles || [])].filter(Boolean).join(' ');
        for (const text of texts) {
            assert.deepEqual(draftProblems(text, input.place, own ? [own] : []), [], `${name}: ${text}`);
            for (const word of INVENTED_WORDS) assert.ok(!text.includes(word) || own.includes(word), `${name}: '${word}' — ${text}`);
        }
    }
});

test('초안: 처방 상세의 초안마다 고쳐 쓰라는 표시가 붙는다', () => {
    assert.equal(DRAFT_MARK, '초안 — 우리 매장 사실에 맞게 고쳐 쓰세요');
    const tasks = sectionOf(docOf(RESTAURANT).doc, 'tasks');
    assert.ok(tasks.lead.includes(DRAFT_MARK));
    assert.deepEqual(tasks.items.filter((task) => task.draft).map((task) => task.draft.kind).sort(), ['feed', 'menu', 'reply']);
});

test('리뷰 답글: 실제 리뷰가 없어 예시로 표시하고, 업종 답글 도우미로 만든다', () => {
    const { input } = docOf(RESTAURANT);
    const drafts = replyDrafts(RESTAURANT.place, { recommendation: input.recommendation });
    assert.equal(drafts.example, true);
    assert.deepEqual(drafts.items.map((item) => item.key), ['praise', 'complaint']);
    // 예시 메뉴는 주력 갈래에서: 키워드 처방이 '다른 업종 낱말'로 뺀 '김밥'이 아니라 '광어'
    assert.equal(drafts.items[0].label, "좋은 리뷰 예시 — 손님이 '음식이 맛있어요'를 고르고 '광어'를 적은 리뷰");
    assert.ok(drafts.items[0].text.includes('대물섬 강남점'));
    // 마지막 인사는 사실을 담은 자연스러운 한 문장(인사가 둘이 되지 않음)
    assert.ok(drafts.items[0].text.endsWith('주차가 되고 01:00까지 영업하니 다음에도 편하게 들러 주세요.'));
    assert.equal((drafts.items[0].text.match(/들러 주세요|찾아 주시면|찾아 주세요/g) || []).length, 1);
    // 약국: 짧은 좋은 점('친절해요')으로도 예시가 나오고, 진료 안내 문장은 넣지 않는다
    const pharmacy = replyDrafts(PHARMACY.place);
    assert.deepEqual(pharmacy.items.map((item) => item.key), ['praise', 'complaint']);
    assert.ok(pharmacy.items.every((item) => !item.text.includes('진료')));
    assert.ok(pharmacy.items[0].text.endsWith('무료 주차가 되니 다음에도 편하게 들러 주세요.'));
});

test('손님이 읽는 초안에는 내부 자료 표현(결제 집계·리뷰 수·블로그 n/m·점수)이 없다', () => {
    // '디자이너 8명'은 손님에게 알리는 매장 사실이라 센다(고른 손님 수·리뷰 수 같은 내부 숫자만 막음)
    for (const [name, sample] of SAMPLES) {
        for (const text of draftTexts(docOf(sample).doc)) {
            assert.doesNotMatch(text, /결제|방문자 리뷰 [\d,]+개|블로그 \d+\/\d+|\d+점|평가가 가장 많|GEO|AEO|(?<!디자이너가 |디자이너 )\d+명|고른 손님|리뷰 [\d,]+회|예약 [\d,]+건/, `${name}: ${text}`);
        }
    }
});

test('초안은 업종에 맞는 사실만: 약국·미용실에 단체 이용·포장 문구가 없고, 약국은 질문형 "추천?" 제목을 쓰지 않는다', () => {
    const pharmacy = feedDrafts(PHARMACY.place, { question: '오창읍 약국 추천', nowMs: NOW });
    assert.doesNotMatch(JSON.stringify(pharmacy), /단체|포장|반려동물/);
    assert.equal(pharmacy.altTitle, '오창읍 약국 위치·영업시간 안내 — 메가헬스팜약국');
    assert.doesNotMatch(pharmacy.altTitle, /추천|\?/);
    const salon = feedDrafts(SALON.place, { question: '강남역 남성전문미용실 추천', nowMs: NOW });
    assert.doesNotMatch(JSON.stringify(salon.items), /단체 이용|포장/);
    // 음식점은 그대로(단체 이용·포장은 음식점에 맞는 조건)
    const restaurant = feedDrafts(RESTAURANT.place, { nowMs: NOW });
    assert.match(restaurant.items[0].body, /단체 이용 가능/);
    assert.match(restaurant.items[0].body, /포장 가능/);
    // 답글 끝의 인사에도 업종에 맞지 않는 조건이 들어가지 않는다
    assert.doesNotMatch(replyDrafts(PHARMACY.place).items[0].text, /단체|포장/);
});

test('아쉬운 리뷰 답글 예시는 업종에 맞는 상황으로(음식점 대기·미용실 시술 결과·약국 응대)', () => {
    const labelOf = (place) => replyDrafts(place).items.find((item) => item.key === 'complaint').label;
    assert.equal(labelOf(RESTAURANT.place), '아쉬움을 남긴 리뷰 예시 — 기다린 시간이 길었다는 리뷰');
    assert.equal(labelOf(SALON.place), '아쉬움을 남긴 리뷰 예시 — 시술 결과가 기대와 달랐다는 리뷰');
    assert.equal(labelOf(PHARMACY.place), '아쉬움을 남긴 리뷰 예시 — 응대가 아쉬웠다는 리뷰');
    const texts = [RESTAURANT, SALON, PHARMACY].map((sample) => replyDrafts(sample.place).items.find((item) => item.key === 'complaint').text);
    assert.equal(new Set(texts).size, 3, '세 업종의 아쉬운 리뷰 답글이 서로 다르다');
    assert.doesNotMatch(texts[2], /기다|대기/, '약국 답글에 대기 시간 이야기가 없다');
    assert.match(texts[1], /시술/);
});

test('가까운 역 자료가 없는 매장에는 찾아오는 길 안내에 역·출구·도보 시간을 쓰지 않는다', () => {
    const ai = sectionOf(docOf(PHARMACY).doc, 'ai');
    const location = ai.questions.find((entry) => entry.key === 'location');
    assert.equal(location.fix, '스마트플레이스 업체정보에 찾아오는 길(가까운 정류장·건물 입구·주차 위치)을 적으세요.');
    assert.doesNotMatch(JSON.stringify(docOf(PHARMACY).doc), /가까운 역/);
    // 역 자료가 있는 매장은 그대로
    const restaurant = sectionOf(docOf({ ...RESTAURANT, ranks: RESTAURANT.ranks }).doc, 'ai');
    assert.ok(!restaurant.questions.some((entry) => /정류장/.test(entry.fix)));
});

test('대표 메뉴는 키워드 처방이 주력이 아니라고 뺀 낱말·술·음료를 앞세우지 않는다', () => {
    const { input } = docOf(RESTAURANT);
    const notMain = notMainTerms(input.recommendation);
    assert.ok(notMain.includes('김밥') && notMain.includes('볼락구이'));
    const popular = popularItems(RESTAURANT.place, 3, { notMain });
    // 결제 많은 메뉴(소금김밥·생맥주·볼락구이·갈치조림)는 빠지고 하나만 남아, 2개 이상 남는 리뷰 언급(가장 많은 것의 1/3 이상)을 고른다
    assert.equal(popular.source, 'review');
    assert.deepEqual(popular.items.map((entry) => [entry.name, entry.price]), [['광어', null], ['숙성회', null]]);
    // 낱말이 메뉴 이름과 정확히 같을 때만 가격을 붙인다("숙성회"에 "모듬숙성회"의 가격을 붙이지 않음)
    const exact = popularItems({ ...RESTAURANT.place, reviewMenus: [{ label: '모듬숙성회', count: 20 }, { label: '광어', count: 18 }] }, 3, { notMain });
    assert.deepEqual(exact.items.map((entry) => [entry.name, entry.price]), [['모듬숙성회', '91,000원'], ['광어', null]]);
});

test('소식 초안: 메뉴 이름·가격은 메뉴판 그대로, 할인 없이 사실만', () => {
    const { input } = docOf(RESTAURANT);
    const feed = feedDrafts(RESTAURANT.place, { question: '강남구청역 한식 추천', nowMs: NOW, recommendation: input.recommendation });
    assert.equal(feed.items[0].title, '강남구청역 한식 대물섬 강남점 — 11월 메뉴·영업 안내');
    assert.ok(feed.items[0].body.startsWith('손님 리뷰에 자주 나오는 메뉴는 광어, 숙성회입니다.'), '가격은 이름이 정확히 같은 메뉴에만');
    assert.ok(!/숙성회\(91,000원\)/.test(feed.items[0].body.slice(0, 40)));
    // 한정 메뉴 안내: 문장이 '한정'이라고 말하므로 이름 앞의 "(한정)" 머리표는 떼어 '한정'이 되풀이되지 않게 한다(이름·가격은 메뉴판 그대로)
    const limitedMenus = RESTAURANT.place.detail.menus.filter((menu) => /한정/.test(menu.name)).slice(0, 3);
    assert.equal(limitedMenus.length, 3);
    assert.equal(feed.items[1].key, 'limited');
    assert.ok(feed.items[1].body.startsWith('메뉴판에 한정으로 올린 메뉴는 '), feed.items[1].body);
    assert.doesNotMatch(feed.items[1].body, /한정\)|한정 메뉴는/);
    for (const menu of limitedMenus) assert.ok(feed.items[1].body.includes(`${menu.name.replace(/^\(한정\)\s*/, '')}(${menu.price})`), menu.name);
    // 같은 영업시간 문장을 소식 초안 여러 편에 되풀이하지 않는다(첫 소식에만)
    const hoursLine = /영업시간은 월·화·수·목·금 11:00~01:00/;
    assert.equal(feed.items.filter((item) => hoursLine.test(item.body)).length, 1);
    assert.match(feed.items[0].body, hoursLine);
    // 이름 끝에 괄호가 있으면("맛보기보쌈(100g)") 가격을 괄호로 겹치지 않는다
    const withAlso = feedDrafts(RESTAURANT.place, { question: '강남구청역 한식 추천', nowMs: NOW, recommendation: input.recommendation, also: ['김밥', '갈치', '보쌈'] });
    assert.match(withAlso.items[0].body, /맛보기보쌈\(100g\) 15,000원/);
    assert.doesNotMatch(JSON.stringify(feed), /\)\([\d,]+원\)/);
    // 영업시간 문장이 있으면 같은 뜻의 '01:00까지 영업' 매장 안내는 되풀이하지 않는다
    assert.doesNotMatch(feed.items[0].body, /매장 안내:[^.]*\d\d:\d\d까지 영업/);
    assert.equal(feed.altTitle, '강남구청역 한식 추천? 대물섬 강남점 광어·위치·영업시간 안내');
    // 메뉴가 없는 약국: 영업시간·매장 안내만(약국에 맞지 않는 '단체 이용 가능'은 뺌)
    const pharmacy = feedDrafts(PHARMACY.place, { nowMs: NOW });
    assert.equal(pharmacy.items.length, 1);
    assert.equal(pharmacy.items[0].body, '영업시간은 매일 09:30~21:00입니다. 매장 안내: 무료 주차. (새 품목·서비스·휴무가 있으면 날짜·가격과 함께 한 줄 — 직접 적기)');
});

test('소식 초안: 5칸에 새로 넣는 낱말(마지막 소식·메뉴판의 대방어)로 한 편을 더 쓰고, 붐비는 때·예약 혜택·쿠폰은 자료에 있을 때만', () => {
    const { input } = docOf(RESTAURANT);
    const focus = [
        { keyword: '강남구청숙성회', term: '숙성회', region: '강남구청', kinds: ['review', 'blog', 'rival'] },
        { keyword: '강남구청대방어', term: '대방어', region: '강남구청', kinds: ['board'] },
    ];
    const feed = feedDrafts(RESTAURANT.place, { nowMs: NOW, recommendation: input.recommendation, focus });
    // 마지막 소식·메뉴판에서 나온 낱말(board)을 먼저 쓴다
    const focused = feed.items.find((item) => item.key === 'focus');
    assert.equal(focused.title, '강남구청 대방어 메뉴 안내 — 대물섬 강남점');
    // (영업시간은 첫 소식에만 적는다)
    assert.equal(focused.body, '대물섬 강남점의 대방어 메뉴는 대방어 정식(30,000원), 대방어 숙성회(71,000원)입니다. (언제부터인지·수량·예약 여부 — 직접 적기)');
    // 결제 자료(가장 붐비는 요일·시각)는 손님 말로: '결제'라는 말 없이
    assert.equal(busyTime(RESTAURANT.place), '금요일, 오후 6시 무렵');
    assert.match(feed.items[0].body, /가장 붐비는 때는 금요일, 오후 6시 무렵입니다\./);
    assert.doesNotMatch(JSON.stringify(feed), /결제/);
    // 자료에 없으면 붐비는 때 문장을 쓰지 않는다
    assert.equal(busyTime(SALON.place), null);
    // 미용실: 사장님이 등록한 예약 혜택·쿠폰 이름을 그대로(지어내지 않음). '할인'은 자료에 있는 말이라 통과한다.
    const salon = feedDrafts(SALON.place, { nowMs: NOW, activity: SALON.activity });
    assert.match(salon.items[0].body, /네이버 예약 혜택 — 첫 방문 10~20% 차등 할인 \(드라이X\)\./);
    assert.match(salon.items[0].body, /쿠폰: 첫 방문 5,000원 할인\./);
    // 쿠폰 자료를 넘기지 않으면 쿠폰 문장은 쓰지 않는다
    assert.ok(!feedDrafts(SALON.place, { nowMs: NOW }).items[0].body.includes('쿠폰'));
});

test('소개글 초안: 3~6문장(넘으면 덜 중요한 문장부터 뺌), 손님이 고르는 데 도움이 되는 사실(가격 범위·업종에 중요한 강점)을 손님 말투로', () => {
    const salon = introDraft(SALON.place, SALON.activity);
    assert.ok(salon.sentences >= 3 && salon.sentences <= 6);
    // 사실 문장이 7개(위치·찾아오는 길·영업시간·시술·가격·매장 사실·리뷰)라 가장 덜 중요한 매장 사실(디자이너 수·반려동물)을 뺀다. 소식 초안에는 남는다.
    assert.equal(salon.text, [
        '제이디로얄 맨즈헤어 강남점은 서울 강남구 강남대로96길 12 2층에 있는 남성전문미용실입니다.',
        '강남역 11번 출구에서 걸어서 3분이고, 주차할 수 있습니다.',
        '영업시간은 매일 10:30~19:30입니다.',
        '요즘 예약이 많은 시술은 댄디컷, 다운펌, 쉐도우펌입니다.',
        // 메뉴판의 가격 범위(30,000원 컷 ~ 120,000원 열펌): "가격대를 소개글에도 적으세요"라는 처방과 앞뒤가 맞는다('메뉴판 기준' 같은 내부 말은 쓰지 않음)
        '시술 가격은 30,000원~120,000원입니다.',
        "손님 리뷰에서 많이 꼽힌 점은 '원하는 스타일로 잘해줘요', '시술이 꼼꼼해요', '친절해요', '스타일 추천을 잘해줘요'입니다.",
    ].join(' '));
    // 소식 초안의 매장 안내에는 디자이너 수·반려동물 동반이 남는다
    assert.match(feedDrafts(SALON.place, { nowMs: NOW, activity: SALON.activity }).items[0].body, /매장 안내: 주차 가능 · 네이버 예약 가능 · 반려동물 동반 가능 · 디자이너 8명\./);
    // 문장을 뺄 때는 덜 중요한 순서(매장 사실 → 가격 범위 → 찾아오는 길)
    const crowded = introDraft({ ...SALON.place, detail: { ...SALON.place.detail, hours: null, subway: null, parking: null } }, SALON.activity);
    assert.ok(crowded.text.includes('시술 가격은') && crowded.text.includes('디자이너가 8명'), '문장이 6개 이하면 그대로 둔다');
    assert.doesNotMatch(crowded.text, /메뉴판 기준/);
    assert.equal(salon.oneLine, '강남역 댄디컷·쉐도우펌 남성전문미용실');
    assert.equal(salon.priceText, '30,000원~120,000원');
    assert.deepEqual(priceRange(SALON.place), { low: 30000, high: 120000, text: '30,000원~120,000원' });
    // 음식점은 메뉴 가격 폭이 커서 가격 범위를 쓰지 않고, 가격이 하나뿐이면 범위가 아니다
    assert.equal(priceRange(RESTAURANT.place), null);
    assert.equal(priceRange({ ...SALON.place, detail: { ...SALON.place.detail, menus: [{ name: '컷', price: '30,000원' }] } }), null);
    // 약국: 다루는 것(지역 없는 대표키워드)을 '취급' 수준으로, 업종에 중요한 강점(복약지도)을 앞세우고, 효능 표현·조건형 문장 없이
    const { input } = docOf(PHARMACY);
    const pharmacy = introDraft(PHARMACY.place, PHARMACY.activity, { recommendation: input.recommendation });
    assert.ok(pharmacy.sentences >= 3 && pharmacy.sentences <= 7);
    // 분류 이름은 손님이 쓰는 말을 괄호로 함께(리뷰·검색어에 나온 '영양제'). 가게 이름 꼴('동물약국')은 덧붙이지 않는다.
    assert.ok(pharmacy.text.includes('일반의약품·건강기능식품(영양제)·동물의약품·상비약을 취급합니다.'));
    assert.ok(pharmacy.text.includes('무료로 주차할 수 있습니다.'));
    assert.ok(pharmacy.text.includes("'복약지도를 잘해줘요'"), '손님이 고른 좋은 점 가운데 약국에 중요한 복약지도를 넣는다');
    assert.doesNotMatch(pharmacy.text, /단체 이용 가능 조건|효과|효능|좋아지|반려동물/);
    // 사실이 3문장도 안 되는 매장은 초안을 만들지 않는다
    assert.equal(introDraft({ name: '이름만', category: '한식' }), null);
});

test('AI 검색 준비: 리뷰를 더 받는 일에는 리뷰 정책 주의를 붙인다', () => {
    const ai = sectionOf(docOf(PHARMACY).doc, 'ai');
    const more = ai.more.find((item) => item.id === 'reviewsMore');
    assert.equal(more.caution, REVIEW_ASK_CAUTION);
    assert.match(REVIEW_ASK_CAUTION, /리뷰를 조건으로 할인·서비스를 주거나 별점·문구를 정해 주지 마세요\(네이버 리뷰 운영 원칙에 어긋날 수 있습니다\)\.$/);
    assert.doesNotMatch(REVIEW_ASK_CAUTION, /정책 위반/);
    assert.ok(ai.more.filter((item) => item.id !== 'reviewsMore').every((item) => item.caution === null));
});

/* ───────── 인쇄본만으로 읽히는지 ───────── */

test('인쇄본만으로 읽힌다: 화면을 보라는 문구가 없고, 방법·이유를 문서 안에 적는다', () => {
    for (const [name, sample] of SAMPLES) {
        const text = JSON.stringify(docOf(sample).doc);
        assert.doesNotMatch(text, /분석 화면|(?<!매장 )화면에서 볼|'AI 검색'에 있|분석의 .AI 검색./, name);
    }
    // 하루 안에 해 볼 수 있는 일은 방법까지 문서에 적는다
    const ai = sectionOf(docOf(SALON).doc, 'ai');
    assert.deepEqual(ai.quick.map((entry) => entry.id), ['naver-feed', 'naver-cafe']);
    assert.ok(ai.quick.every((entry) => entry.how && entry.how.length > 40));
    assert.match(ai.quick[0].how, /소식 제목에 "강남역 남성전문미용실 추천"처럼/);
    // 약국은 '추천'이 아니라 위치·영업시간으로 묻는 말을 쓴다
    assert.match(sectionOf(docOf(PHARMACY).doc, 'ai').quick[0].how, /"오창읍 약국 위치·영업시간"/);
});

test('추천에서 뺀 키워드: 낱말마다 이유 한 줄, 지역만 바꾼 것은 어떤 조합인지("강남+댄디컷") 적는다', () => {
    const salon = sectionOf(docOf(SALON).doc, 'keywords').excluded;
    assert.ok(salon.rows.every((row) => row.label && row.words && row.reason));
    const merged = salon.rows.find((row) => row.label === '겹치는 낱말' && /^남성전문미용실/.test(row.words));
    assert.deepEqual([merged.words, merged.reason], ['남성전문미용실 → 미용실', "'미용실'이 들어 있는 말이라 하나로 묶음"]);
    // 시스루댄디컷은 댄디컷에 묶이지 않고 따로 추천된다(묶음 줄 없음)
    assert.ok(!salon.rows.some((row) => row.label === '겹치는 낱말' && /시스루댄디컷/.test(row.words)));
    const swapped = salon.rows.find((row) => row.label === '지역만 바꿈');
    // 역 변형과 같은 뿌리의 동·구('강남'→'강남역')는 한 지역으로 합쳐, 지역만 바꾼 조합은 다른 지역(역삼)만 남는다
    assert.match(swapped.words, /역삼\+댄디컷/);
    assert.match(swapped.words, /역삼\+다운펌/);
    // 조합은 12개까지 전부 적고, 그보다 많을 때만 개수로("외 N개")
    assert.ok(swapped.words.split(' · ').length >= 7 && !/ 외 \d+개/.test(swapped.words), swapped.words);
    assert.doesNotMatch(swapped.words, /(^| · )댄디컷( · |$)/, '추천한 강남역댄디컷과 모순처럼 읽히는 "댄디컷"만의 표기를 쓰지 않는다');
    // 5칸에 같은 낱말이 두 번 들어가지 않은 문서는 규칙만 한마디(두 번 든 낱말이 있으면 그 낱말을 적음 — 6차 관찰 7)
    assert.equal(swapped.reason, '이미 5칸이나 등록 키워드에 있는 낱말에 지역만 바꾼 조합이라 따로 권하지 않음(같은 낱말은 두 칸까지만 권함)');

    const restaurant = sectionOf(docOf(RESTAURANT).doc, 'keywords').excluded;
    const reasonOf = (word) => restaurant.rows.find((row) => row.words.startsWith(word))?.reason;
    // 키워드로는 빼는 낱말: 매장 자료의 사실(리뷰·결제)을 먼저, 빼는 까닭은 lib 의 이유 문장 그대로(검색 의도를 단정하지 않음), 초안에 넣은 곳까지
    assert.equal(restaurant.rows.find((row) => row.words.startsWith('김밥')).words, '김밥·소금김밥');
    assert.equal(reasonOf('김밥'), '매장 자료: 리뷰 언급 37회·주간 인기 메뉴 1위·AI 브리핑에도 나옴. 이 말은 김밥집을 가리키는 메뉴 이름인데, 이 매장은 회 메뉴가 중심이라 지역을 붙인 키워드로는 권하지 않습니다(읽어 온 메뉴 34개 중 1개). 넣은 초안: 메뉴 설명·소식.');
    assert.doesNotMatch(JSON.stringify(restaurant), /이 말로 검색하는 손님|검색하는 손님은/);
    // '넣어 두었습니다'는 실제로 초안에 든 낱말에만(갈치는 소식 초안에만 있다)
    assert.match(reasonOf('갈치'), /^매장 자료: 리뷰 언급 12회·주간 인기 메뉴 4위\. .*넣은 초안: 메뉴 설명·소식\.$/);
    assert.equal(reasonOf('한식'), '범위가 넓은 업종 이름이라 지역을 붙여도 어떤 매장인지 가려지지 않음');
    assert.equal(reasonOf('압구정'), '이 지역 키워드는 41위·300위 밖이라 새 조합을 만들지 않음');
    assert.equal(reasonOf('광어회'), "'광어'가 들어 있는 말이라 하나로 묶음");
    // 예전 모양(popular·useIn 이 없는 항목)은 읽어 온 메뉴 수로 적는다
    assert.equal(excludedReason({ rule: 'otherBusiness', reason: "'보쌈'은 …(읽어 온 메뉴 34개 중 2개)." }), '읽어 온 메뉴 34개 중 2개뿐이라 주력으로 보기 어려움');
    assert.equal(excludedReason({ rule: 'offMain', reason: '메뉴 1개에만 나오는 곁들임' }), '주력 메뉴가 아닌 곁들임이라 따로 권하지 않음(메뉴 1개에만 나옴)');
    // 근거가 매장 사실 하나뿐이라 추천에서 빠진 업종 연관어('thin')는 "근거 부족"으로, 다시 권하는 조건까지 그대로
    // (음식점의 룸식당은 이제 근거가 둘(좌석·AI 브리핑)이라 추천에 들어 '다음 후보'에 있다)
    assert.ok(!restaurant.rows.some((row) => row.words === '룸식당'));
    assert.ok(sectionOf(docOf(RESTAURANT).doc, 'keywords').next.rows.some((row) => row.keyword === '강남구청룸식당'));
    assert.ok(sectionOf(docOf(SALON).doc, 'keywords').excluded.rows.some((row) => row.words === '헤어샵' && row.label === '근거 부족'));
    assert.equal(excludedReason({ rule: 'thin', reason: "근거가 좌석 정보 '룸' 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다." }),
        "근거가 좌석 정보 '룸' 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다");
    // 사실(popular)이 없고 이유 한 문장(why)만 있으면 why 를 쓴다
    assert.equal(excludedReason({ rule: 'offMain', why: '주력이 아니라 따로 권하지 않습니다. 둘째 문장.' }), '주력이 아니라 따로 권하지 않습니다');
    // 리뷰·결제 사실이 하나도 없고 쓸 자리만 있으면 쓸 자리만
    // (검색 행태 단정 없이: 다른 업종의 낱말이라 뺀다는 사실, 그리고 초안에 실제로 넣었는지)
    assert.equal(excludedReason({ rule: 'otherBusiness', popular: { reviews: null }, useIn: ['소식'] }), '다른 업종의 낱말이라 키워드로는 뺌. 소식에 쓸 수 있습니다(메뉴판의 메뉴 이름에서 그 낱말을 찾지 못해 이 문서의 초안에는 넣지 못했습니다).');
    assert.equal(excludedReason({ rule: 'otherBusiness', popular: { reviews: null }, useIn: ['소식'] }, { delivered: ['소식'] }), '다른 업종의 낱말이라 키워드로는 뺌. 넣은 초안: 소식.');
    assert.equal(excludedReason({ rule: 'classification', into: '약국', reason: '' }), "약·제품을 나누는 분류 이름이라 '약국' 키워드로 묶음");
    assert.equal(excludedReason({ rule: 'merged', into: '댄디컷', reason: '' }), "'댄디컷'이 들어 있는 말이라 하나로 묶음");
    // 모르는 규칙은 첫 문장을 그대로
    assert.equal(excludedReason({ rule: 'new', reason: '새 규칙입니다. 둘째 문장.' }), '새 규칙입니다');
});

test('소식 경과일은 화면 모든 곳과 같은 값(feedDays)을 쓴다: 저장해 둔 값이 하루 모자라도 날짜로 다시 센 값', () => {
    // 저장값 45일(활동 자료를 만든 날 기준), 마지막 소식 날짜는 2026-10-01 → 문서를 만든 2026-11-16 기준 46일
    const activity = { ...RESTAURANT.activity, feeds: { ...RESTAURANT.activity.feeds, daysSinceLatest: 45 } };
    const { doc } = docOf({ ...RESTAURANT, activity });
    assert.equal(doc.summary.diagnoses.find((diag) => diag.key === 'feed').text, '소식 46일째 없음: 마지막 소식은 "대방어 입고 안내"입니다.');
    const stale = docOf({ ...RESTAURANT, activity }, { nowMs: NOW + 2 * 24 * 60 * 60 * 1000 }).doc;
    assert.match(stale.summary.diagnoses.find((diag) => diag.key === 'feed').text, /^소식 48일째 없음/);
});

test('5칸 근거의 표기("블로그 25/52", "예약 N건" 등)에는 풀이가 붙고, 문서에 나온 표기만 풀이한다', () => {
    const legend = sectionOf(docOf(RESTAURANT).doc, 'keywords').legend;
    // 5칸의 근거와 '다음 후보'의 근거에 실제로 나온 표기만(순서는 고정)
    assert.deepEqual(legend.map((entry) => entry.term), ['상위 N곳 등록', '리뷰 N회', '고른 손님 N명', '메뉴 N개·소식 N건', '블로그 30/52', '등록 키워드의 낱말']);
    assert.equal(legend.find((entry) => entry.term === '블로그 30/52').meaning, '최근 블로그 후기 52개 중 30개에 그 낱말이 나온다는 뜻입니다.');
    assert.ok(!legend.some((entry) => entry.term.startsWith('예약')), '음식점 5칸 근거에 예약 건수가 없으면 풀이도 없다');
    assert.ok(sectionOf(docOf(SALON).doc, 'keywords').legend.some((entry) => entry.term === '예약 N건'));
    assert.deepEqual(sectionOf(docOf(PHARMACY).doc, 'keywords').legend.map((entry) => entry.term).slice(-1), ["후기 'A' n개·'B' m개"]);
});

test('약국: 메뉴·서비스 등록은 손님 말(영양제)과 손님이 고른 서비스(복약지도·상담)로 다시 쓰고, 맞는 내용이 없으면 이 처방을 뺀다', () => {
    const { doc, input } = docOf(PHARMACY);
    const task = sectionOf(doc, 'tasks').items.find((item) => item.key === 'menuAdd');
    assert.equal(task.title, '취급 품목·서비스 등록하기');
    assert.equal(task.sourceLabel, AI_SOURCE_LABEL);
    assert.deepEqual(pharmacyOfferings(input.place, input.recommendation).map((offer) => offer.text), ['영양제', '복약지도', '약 상담']);
    assert.deepEqual(task.draft.items, [
        "영양제(대표키워드 '건강기능식품'을 손님이 부르는 말)",
        "복약지도(손님이 고른 좋은 점 '복약지도를 잘해줘요')",
        "약 상담(손님이 고른 좋은 점 '상담이 자세해요')",
    ]);
    // 분류 이름(일반의약품·건강기능식품…)을 등록 후보로 내세우지 않고, 메뉴 5개·가격 숫자·메뉴판 사진 이야기를 하지 않는다
    assert.ok(task.draft.items.every((entry) => !/^(일반의약품|건강기능식품|동물의약품|상비약)/.test(entry)));
    assert.doesNotMatch(JSON.stringify(task), /메뉴 5개|가격은 숫자|메뉴판 사진|목표 메뉴/);
    assert.doesNotMatch(task.steps.join(' '), /효능이 |효과가 /);
    assert.match(task.steps[1], /효능·효과를 말하는 문구는 쓰지 않습니다/);
    // D 표의 '대표 메뉴는?' 채울 자리도 같은 말로
    const ai = sectionOf(doc, 'ai');
    // (이 문구는 화면의 AI 검색 진단 place-geo.js 가 약국용으로 적은 것을 그대로 옮긴다)
    assert.equal(ai.questions.find((entry) => entry.key === 'signature').fix, '대표 취급 품목·서비스(예: 영양제·복약지도·약 상담) 이름을 소개글·소식에 같은 표현으로 적고 사진·설명을 채우세요. 실제로 하는 것만 적습니다.');
    assert.equal(ai.questions.find((entry) => entry.key === 'price').fix, '취급 품목·서비스마다 안내(가격을 알릴 수 있는 것은 가격대, 아니면 "방문 상담"처럼)를 글자로 적고 소개글에도 적으세요. 사진만 있으면 AI가 읽기 어렵습니다.');
    assert.doesNotMatch(JSON.stringify(ai.questions), /메뉴판|메뉴 5개/);
    // 맞는 내용(손님 말·서비스)이 없으면 이 처방을 빼고, 다른 곳에도 남기지 않는다
    const bare = { ...PHARMACY, place: { ...PHARMACY.place, keywords: ['청주약국'], reviewVotes: [{ label: '친절해요', count: 50 }] } };
    const without = docOf(bare).doc;
    const all = [...sectionOf(without, 'tasks').items, ...sectionOf(without, 'tasks').rest];
    assert.ok(!all.some((entry) => entry.key === 'menuAdd'));
    assert.ok(!sectionOf(without, 'plan').weeks.flatMap((week) => week.items).some((entry) => /품목·서비스/.test(entry.title)));
});

test('병원·치과 계열: 메뉴 등록 처방은 place-geo 의 healthWords(진료 과목·서비스)로 쓰고 메뉴판·가격 5개 이야기를 하지 않는다', () => {
    const clinic = { ...PHARMACY, place: { ...PHARMACY.place, name: '메가치과의원', category: '치과', keywords: ['임플란트', '충치치료'], reviewVotes: [{ label: '친절해요', count: 50 }] } };
    const { doc } = docOf(clinic);
    const tasks = sectionOf(doc, 'tasks');
    const add = [...tasks.items, ...tasks.rest].find((task) => task.key === 'menuAdd');
    assert.ok(add, '진료 과목·서비스 등록 처방이 있다');
    assert.equal(add.title, '진료 과목·서비스 등록하기');
    assert.match(add.steps[0], /^'정보 수정' 버튼을 누르고 진료 과목·서비스를 이름과 한 줄 설명으로 글자로 적을 칸을 찾습니다\(예: 임플란트·충치치료\)\./);
    assert.doesNotMatch(add.steps[0], /진료 과목·검진·예약 방법/, '진료 과목·서비스(예: 진료 과목…) 같은 순환 표현이 없다');
    // 후보 상자가 있으니 "아래 후보는…" 문장도 있다(등록 키워드 임플란트·충치치료)
    assert.ok(add.draft && add.steps.some((step) => /^아래 후보는 지금 등록한 대표키워드에서 뽑은 것입니다/.test(step)));
    assert.deepEqual(add.draft.items, ['임플란트', '충치치료']);
    assert.equal(add.preface, SP_UNSURE_INDUSTRY);
    assert.match(add.steps[1], /진료·시술의 효과를 단정하는 표현은 쓰지 않습니다/);
    assert.doesNotMatch(JSON.stringify(add), /메뉴판|메뉴 5개|가격은 숫자/);
    if (add.draft) assert.match(add.draft.label, /^등록할 진료 과목·서비스 후보/);
    // 약국과 같은 방식: D 표·AI 점검 목록도 같은 낱말
    assert.doesNotMatch(JSON.stringify(sectionOf(doc, 'ai')), /메뉴판|메뉴·서비스/);
});

test('미용실: 가격대 표시·소개글·소식이 서로 맞는다(5/5 가격 등록 → "일부만"이 아니라 무엇이 빠졌는지)', () => {
    const { doc } = docOf(SALON);
    const price = sectionOf(doc, 'ai').questions.find((entry) => entry.key === 'price');
    assert.equal(price.now, '시술 5개 모두 가격이 등록돼 있습니다. 소개글·소식에는 가격대가 없습니다.');
    assert.equal(price.fix, '대표 시술 가격대(30,000원~120,000원)를 소개글에도 적으세요(소개글 초안에 넣어 두었습니다).');
    const intro = sectionOf(doc, 'tasks').items.find((item) => item.key === 'intro');
    assert.ok(intro.draft.text.includes('30,000원~120,000원'), '처방이 가리키는 소개글 초안에 가격대가 실제로 들어 있다');
    // 소식 초안: 새 키워드를 같은 표현으로 + 자료에 있는 예약 혜택·쿠폰·반려동물 동반
    const feed = sectionOf(doc, 'tasks').items.find((item) => item.key === 'feed');
    assert.ok(feed, '새 대표키워드를 소식에도 넣는 일이 있다');
    // 새 키워드는 전부 센다(4개)
    assert.match(feed.why[0], /새로 넣는 대표키워드\('강남역볼륨매직', '강남역댄디컷', '강남역다운펌', '강남역쉐도우펌'\)를 소식에도 같은 표현으로 넣습니다\./);
    assert.match(feed.draft.items[0].body, /네이버 예약 혜택 — 첫 방문 10~20% 차등 할인 \(드라이X\)/);
    assert.match(feed.draft.items[0].body, /반려동물 동반 가능/);
});

test('4주 실행표: 2·3주차가 비지 않게 자료 속의 일로 채우고, 1주차는 이번 주 할 일과 같다', () => {
    for (const [name, sample] of SAMPLES) {
        const { doc } = docOf(sample);
        const plan = sectionOf(doc, 'plan');
        assert.deepEqual(plan.weeks.map((week) => week.no), [1, 2, 3, 4], `${name}: 빈 주가 없다`);
        assert.deepEqual(plan.weeks[0].items.map((item) => item.title), doc.summary.week.items.map((task) => task.title), name);
        assert.ok(plan.weeks.every((week) => week.items.length > 0), name);
        assert.equal(plan.weeks[3].items.filter((item) => item.recheck).length, 1, '4주차에 다시 조회하는 일이 한 번');
    }
    // 미용실: 처방 3개 밖의 일(새 키워드를 넣은 소식 · AI 검색 점검 점수가 오르는 홈페이지 연결 · 카페 질문글 답글)을 2·3·4주차에 하나씩
    const salon = sectionOf(docOf(SALON).doc, 'plan');
    assert.deepEqual(salon.weeks[1].items.map((item) => item.title), ['소식 1개 올리기']);
    assert.deepEqual(salon.weeks[2].items.map((item) => item.title), ['플레이스에 홈페이지 연결하기']);
    assert.deepEqual(salon.weeks[3].items.filter((item) => !item.recheck).map((item) => item.title), ['검색 상위 카페 질문글에 사장님 답글 달기']);
    // 4주 뒤 다시 조회하는 키워드 = 1쪽 ③ 최종 5칸(지금 순위를 모르는 칸은 빈칸으로 적는다)
    assert.deepEqual(salon.recheck.keywords.map((row) => row.keyword), docOf(SALON).doc.summary.slots.rows.map((row) => row.next));
});

test('실행표·AI 점검 목록의 모든 줄에 걸리는 시간이 있다(일의 종류로 정한 값, 표에 없는 일은 기본값)', () => {
    for (const [name, sample] of SAMPLES) {
        const doc = docOf(sample).doc;
        const plan = sectionOf(doc, 'plan');
        for (const item of [...plan.weeks.flatMap((week) => week.items), ...plan.repeat]) assert.ok(item.timeLabel, `${name}: ${item.title}`);
        for (const item of sectionOf(doc, 'ai').more) assert.ok(item.timeLabel, `${name}: ${item.title}`);
    }
    const links = sectionOf(docOf(SALON).doc, 'ai').more.find((entry) => entry.id === 'links');
    assert.equal(links.timeLabel, '약 10분');
    assert.equal(EXTRA_MINUTES.naverBlog, 60);
    const salonPlan = sectionOf(docOf(SALON).doc, 'plan');
    assert.deepEqual(salonPlan.weeks[2].items.map((item) => [item.title, item.timeLabel]), [['플레이스에 홈페이지 연결하기', '약 10분']]);
});

test('새 키워드 예문: 네이버 예약 스타일·리뷰에 나온 시술·손님이 고른 좋은 점에서 숫자 없는 사실 문장을 만든다', () => {
    const salon = sectionOf(docOf(SALON).doc, 'keywords').placements;
    const sentenceOf = (keyword) => salon.find((row) => row.keyword === keyword).sentence;
    // 같은 꼴의 사실 문장(예약으로 받을 수 있는 시술)은 서술을 한 번만 쓰고 키워드를 이어 적는다(두 키워드 줄의 예문이 같은 문장)
    assert.equal(sentenceOf('강남역쉐도우펌'), '강남역 댄디컷, 강남역 쉐도우펌은 제이디로얄 맨즈헤어 강남점에서 네이버 예약으로 받을 수 있습니다.');
    assert.equal(sentenceOf('강남역댄디컷'), sentenceOf('강남역쉐도우펌'));
    assert.equal(sentenceOf('강남역볼륨매직'), '강남역 볼륨매직은 제이디로얄 맨즈헤어 강남점의 손님 리뷰에 자주 나오는 시술입니다.');
    // 키워드 한 개만 넘기면 합치지 않은 한 문장
    assert.equal(keywordPlacements(docOf(SALON).input.place, [{ keyword: '강남역쉐도우펌', item: docOf(SALON).input.recommendation.items.find((entry) => entry.keyword === '강남역쉐도우펌'), evidence: docOf(SALON).input.recommendation.items.find((entry) => entry.keyword === '강남역쉐도우펌').evidence.parts }])[0].sentence,
        '강남역 쉐도우펌은 제이디로얄 맨즈헤어 강남점에서 네이버 예약으로 받을 수 있습니다.');
    // 손님이 고른 좋은 점(추천의 evidence.parts 에 vote)은 '다음 후보'인 남자머리로 확인한다
    const salonInput = docOf(SALON).input;
    const man = salonInput.recommendation.items.find((entry) => entry.keyword === '강남역남자머리');
    assert.equal(keywordPlacements(salonInput.place, [{ keyword: man.keyword, item: man, evidence: man.evidence.parts }])[0].sentence,
        "강남역 제이디로얄 맨즈헤어 강남점은 손님 리뷰에서 '남자 머리를 잘해요'가 많이 꼽혔습니다.");
    assert.ok(salon.every((row) => row.sentence), '미용실은 4줄 모두 예문이 있다');
    for (const row of salon) assert.doesNotMatch(row.sentence, /\d+명|[\d,]+회|[\d,]+건/, '손님이 읽는 글이라 숫자가 없다');
    // 예약이 꺼진 매장이면 예약 문장을 만들지 않는다(자료가 뒷받침할 때만)
    const noBooking = keywordPlacements(
        { ...SALON.place, detail: { ...SALON.place.detail, hasBooking: false } },
        [{ keyword: '강남역쉐도우펌', item: { term: '쉐도우펌', region: '강남역', reasons: [] }, evidence: [{ kind: 'booking' }] }],
    );
    assert.equal(noBooking[0].sentence, null);
    // 근거가 매장이 그 말을 한다고 단정할 수 없는 약국의 영양제·동물약국은 예문 없이 넣을 자리만(화면에는 "직접 적기")
    const pharmacy = sectionOf(docOf(PHARMACY).doc, 'keywords').placements;
    // 사장님이 등록한 '건강기능식품'을 손님 말('영양제')로 — 등록·리뷰 자료가 뒷받침하는 사실 문장
    assert.equal(pharmacy.find((row) => row.keyword === '청주영양제').sentence, '청주 메가헬스팜약국은 건강기능식품(영양제)을 취급합니다.');
    assert.equal(pharmacy.find((row) => row.keyword === '청주동물약국').sentence, null);
    assert.equal(pharmacy.find((row) => row.keyword === '청주대형약국').sentence, "청주 메가헬스팜약국은 손님 리뷰에서 '제품 종류가 다양해요'가 많이 꼽혔습니다.");
});

test('D 표의 꼬리표: 가격이 모두 등록돼 있으면 "일부만"이 아니라 빠진 것(소개글)을 적는다', () => {
    const questions = sectionOf(docOf(SALON).doc, 'ai').questions;
    assert.equal(questions.find((entry) => entry.key === 'price').status, '소개글에 없음');
    // 그 밖의 부분 답변은 그대로 '일부만'
    assert.ok(sectionOf(docOf(PHARMACY).doc, 'ai').questions.some((entry) => entry.status === '일부만'));
});

test('할 일의 출처: AI 검색 점검에서만 나온 일에는 표시를 붙이고, 화면 지금 할 일·5칸에서 나온 일에는 붙이지 않는다', () => {
    const salon = docOf(SALON, { fitPage1: false }).doc;
    assert.deepEqual(salon.summary.week.items.map((task) => [task.key, task.source, task.sourceLabel]), [
        ['keywords', 'slots', null], ['menuDesc', 'ai', AI_SOURCE_LABEL], ['intro', 'ai', AI_SOURCE_LABEL],
    ]);
    // 'AI 검색 점검' 표시의 뜻은 1쪽 용어 풀이 한 줄에 있다(1쪽을 줄여도 지우지 않음)
    assert.ok(salon.summary.terms.some((text) => /^'AI 검색 점검' 표시 = 손님이 AI에게 묻는 질문에 매장 정보로 답할 수 있는지 본 점검에서 나온 일$/.test(text)), JSON.stringify(salon.summary.terms));
    assert.ok(docOf(SALON).doc.summary.terms.some((text) => /^'AI 검색 점검' 표시 = /.test(text)), '1쪽 맞추기를 거쳐도 남는다');
    assert.deepEqual(sectionOf(salon, 'tasks').items.filter((task) => task.sourceLabel).map((task) => task.key), ['menuDesc', 'intro']);
    // 음식점: 화면 '지금 할 일'(대표키워드·소식·답글)에서 나온 일에는 표시가 없고, 안내 문장도 없다
    const restaurant = docOf(RESTAURANT).doc;
    assert.deepEqual(restaurant.summary.week.items.map((task) => task.sourceLabel), [null, null, null]);
    assert.ok(!restaurant.summary.terms.some((text) => /AI 검색 점검/.test(text)), '표시가 없으면 풀이도 없다');
});

test('상위 매장이 등록한 대표키워드 표: 경쟁 매장 → 그 매장의 대표키워드, 내 매장도 쓰는 말·5칸에 넣는 말을 표시한다', () => {
    const rivalPool = graphInput(SALON).rivalPool;
    const keywords = sectionOf(docOf(SALON, { rivals: rivalPool }).doc, 'keywords');
    assert.deepEqual(keywords.rivalKeywords.rows.map((row) => [row.name, row.best]), [
        ['시험맨즈살롱', { rank: 1, keyword: '강남역댄디컷' }], ['시험바버샵', { rank: 3, keyword: '강남역미용실' }],
    ]);
    assert.deepEqual(keywords.rivalKeywords.rows[0].words, [
        { word: '강남역미용실', mine: true, next: false }, { word: '강남역댄디컷', mine: false, next: true }, { word: '남자머리', mine: false, next: false },
    ]);
    assert.deepEqual(keywords.rivalKeywords.common, [{ word: '남자머리', count: 2, mine: false, next: false }]);
    // 자료를 넘기지 않으면 그 표만 뺀다
    assert.equal(sectionOf(docOf(SALON).doc, 'keywords').rivalKeywords, null);
    assert.equal(rivalKeywordTable({ rivals: [null, { name: '', keywords: ['a'] }, { name: '빈 매장', keywords: [] }], place: {}, doneRows: [], slots: null }), null);
});

test('5칸·소식·메뉴 설명 초안이 같은 낱말을 쓴다(5칸에 새로 든 숙성회)', () => {
    const { doc } = docOf(RESTAURANT);
    const rows = doc.summary.slots.rows;
    assert.ok(rows.some((row) => row.next === '강남구청숙성회'));
    const tasks = sectionOf(doc, 'tasks').items;
    const feed = tasks.find((item) => item.key === 'feed').draft;
    assert.ok(feed.items.some((item) => item.key === 'focus' && item.title.includes('숙성회')));
    const menu = tasks.find((item) => item.key === 'menuDesc').draft;
    assert.deepEqual(menu.rows.slice(0, 2).map((row) => row.name), ['대물 숙성회 정식(광어)', '대물 숙성회 정식(광어+시마아지)'], '5칸 낱말이 든 메뉴를 먼저 채운다');
    // 새 키워드 예문 표의 근거도 5칸 근거와 같은 말
    const keywords = sectionOf(doc, 'keywords');
    assert.deepEqual(keywords.placements.find((row) => row.keyword === '강남구청숙성회').basis, ['리뷰 22회', '블로그 25/52']);
});

test('음식점: 사진 없는 메뉴·설명 없는 메뉴는 처방에 자료의 숫자로 적는다', () => {
    const { doc } = docOf(RESTAURANT);
    const menuDesc = sectionOf(doc, 'tasks').items.find((item) => item.key === 'menuDesc');
    assert.match(menuDesc.why.join(' '), /사진 없는 메뉴 15개/);
    // 사진 여부를 모르는 업종(메뉴마다 사진 칸이 없는 미용실 가격표)에는 쓰지 않는다
    const salon = sectionOf(docOf(SALON).doc, 'tasks').items.find((item) => item.key === 'menuDesc');
    assert.doesNotMatch(salon.why.join(' '), /사진 없는/);
});

/* ───────── 1쪽을 한 쪽 안에 ───────── */

test('1쪽 맞추기: 긴 매장 이름·키워드·소식 제목에서도 어림 높이가 예산 안이고, 말줄임 없이 조각 단위로 줄인다', () => {
    const { doc } = docOf(LONG);
    assert.ok(fitHeightMm(doc, doc.summary) <= PAGE1_BUDGET_MM, `${fitHeightMm(doc, doc.summary)}mm`);
    const raw = docOf(LONG, { fitPage1: false }).doc;
    assert.ok(estimatePage1Mm(raw, raw.summary) > PAGE1_BUDGET_MM, '맞추지 않으면 넘치는 견본이다');
    const text = JSON.stringify(doc.summary);
    assert.ok(!text.includes('…'));
    // 5칸 이유: 원래 이유의 앞 조각들만 남는다(문장 가운데를 자르지 않음)
    raw.summary.slots.rows.forEach((row, index) => {
        const fitted = doc.summary.slots.rows[index].reason;
        assert.ok(row.reason.startsWith(fitted), `${fitted} ⊂ ${row.reason}`);
        assert.ok(fitted.length <= 40 || fitted === row.reason);
    });
    // 이번 주 할 일의 이유가 길면 짧은 문제 이름으로
    for (const task of doc.summary.week.items) assert.ok(!task.why || task.why.length <= 34, task.why);
    // 긴 소식 제목은 따옴표로 옮기지 않고 올린 날짜만
    assert.equal(doc.summary.diagnoses.find((diag) => diag.key === 'feed').text, '소식 46일째 없음: 마지막 소식은 10월 1일에 올렸습니다.');
    // 보통 견본도 예산 안
    for (const [name, sample] of SAMPLES) {
        const { doc: normal } = docOf(sample);
        assert.ok(fitHeightMm(normal, normal.summary) <= PAGE1_BUDGET_MM, name);
    }
});

test('1쪽 맞추기: 빼는 순서는 지표 5번째 줄 → 지표 메모 → 진단 덧붙임 → AI 점검 표시 풀이 → 5칸 아래 안내 → 지표 4번째 줄 → 이유 칸 약어 풀이', () => {
    const { doc } = docOf(RESTAURANT);
    const raw = docOf(RESTAURANT, { fitPage1: false }).doc;
    assert.equal(raw.summary.metrics.length, 5);
    assert.ok(doc.summary.metrics.length < 5);
    assert.ok(fitHeightMm(doc, doc.summary) <= PAGE1_BUDGET_MM);
    // 키워드 이름을 전부 적는 '10위 안 키워드' 메모는 줄이지 않고, 맨 앞에 두어 가장 나중에 빠진다
    assert.equal(doc.summary.metrics[0].key, 'rank');
    assert.equal(doc.summary.metrics[0].note, raw.summary.metrics[0].note);
    // 이유 칸 약어 풀이(1쪽에 남은 표기만)
    assert.ok(raw.summary.slots.legend.some((text) => /^블로그 \d+\/\d+ = /.test(text)));
    assert.ok(raw.summary.slots.legend.every((text) => text.includes(' = ')));
});

test('메뉴 설명 초안: 이름·이름에 든 양·구성으로 앞부분을 채우고 사장님만 아는 것만 (직접 적기)로 둔다 — 고른 까닭은 사장님 자료의 숫자로', () => {
    const restaurant = menuFrames(RESTAURANT.place);
    assert.deepEqual(restaurant.rows.map((row) => row.name), ['소금김밥', '해물돌판짜파게티', '1% 대광어 숙성회']);
    // 소금김밥: 주간 결제 1위(276건)·리뷰에 '김밥' 37회 — 이유가 사장님 말과 숫자로 적힌다(재료·양·맛은 지어내지 않음)
    const kimbap = restaurant.rows.find((row) => row.name === '소금김밥');
    assert.equal(kimbap.why, "최근 1주 결제 1위(276건) · 리뷰에 '김밥' 37회");
    assert.equal(kimbap.frame, '소금김밥: 재료 (직접 적기) · 양 (직접 적기)');
    assert.equal(menuFrames({ ...RESTAURANT.place, detail: { ...RESTAURANT.place.detail, menus: [{ name: '맛보기보쌈(100g)', price: '15,000원' }] }, menuDescribedCount: 0 }).rows[0].frame,
        '맛보기보쌈(100g): 양 100g · 재료 (직접 적기)');
    // 설명을 어떻게 쓰는지 보이는 '보기' 한 줄: 이 매장의 사실이 아닌 다른 매장의 예시라고 분명히 적고, 구체 낱말로 채운 예시(이 매장 메뉴판에 없는 품목)를 보인다(자료에 이미 쓴 설명이 없을 때)
    assert.deepEqual(restaurant.model, { kind: 'sample', head: '보기', text: '다른 매장의 예시이며 이 매장의 사실이 아닙니다. 그대로 쓰지 마세요. ‘고등어구이 정식: 고등어 한 마리와 밥·국·반찬이 함께 나옵니다. 1인분입니다.’' });
    const salon = menuFrames(SALON.place);
    assert.equal(salon.rows.length, 5, '설명 있는 시술이 하나도 없으면 등록한 시술 모두');
    assert.equal(salon.rows.find((row) => row.name === '컷+다운펌').frame, '컷+다운펌: 구성 컷 + 다운펌 · 걸리는 시간 (직접 적기)');
    // 이 매장에 '염색'이 있으니 뿌리염색 예시는 건너뛰고, 메뉴판에 없는 품목의 예시를 보인다
    assert.match(salon.model.text, /‘두피 스케일링: 두피를 샴푸로 씻어 내고 마사지를 합니다\. 드라이가 포함됩니다\.’$/);
    assert.equal(salon.model.head, '보기');
    assert.equal(salon.note, '어느 것에 이미 설명이 있는지는 조회한 자료로 알 수 없어, 설명이 비어 있는 것만 채우세요.');
    // '5칸 낱말'·'키워드에서 뺀 …(매장 자료에 나온 메뉴)' 같은 이유 아닌 이유는 쓰지 않는다
    assert.doesNotMatch(JSON.stringify([restaurant, salon]), /키워드에서 뺀|매장 자료에 나온 메뉴|5칸 낱말/);
    assert.equal(menuFrames(PHARMACY.place), null);
    assert.equal(popularItems(SALON.place).source, 'style');
});

test('새 키워드 예문: 매장이 무엇인지 말하는 문장은 업종 낱말일 때만', () => {
    const { input } = docOf(PHARMACY);
    const item = (keyword) => input.recommendation.items.find((entry) => entry.keyword === keyword);
    const rows = keywordPlacements(input.place, ['청주약국', '청주동물약국', '청주대형약국'].map((keyword) => ({ keyword, item: item(keyword) })));
    assert.equal(rows[0].sentence, '메가헬스팜약국은 청주에 있는 약국입니다.');
    assert.equal(rows[1].sentence, null, "'동물약국'이라고 단정하지 않는다");
    assert.equal(rows[2].sentence, null);
    assert.equal(rows[1].where, "소식 제목·소개글에 '청주 동물약국'을 그대로");
});

/* ───────── 자료가 비는 경우 ───────── */

test('매장 정보가 없으면 문서를 만들지 않는다', () => {
    assert.equal(buildPrescription({ place: null }), null);
    assert.equal(buildPrescription(), null);
});

test('이름만 있는 매장: 자료가 없는 칸·구역은 빠진다', () => {
    const place = { placeId: '1', name: '이름만 식당' };
    const recommendation = recommendKeywords({ place });
    const actions = buildActionItems(place, null, { recommendation, nowMs: NOW });
    const doc = buildPrescription({ place, activity: null, ranks: [], recommendation, actions, geo: null, nowMs: NOW });
    assert.ok(!doc.sections.some((section) => ['rivals', 'keywords', 'ai'].includes(section.id)));
    assert.deepEqual(doc.summary.diagnoses, []);
    assert.equal(doc.summary.slots, null);
    assert.equal(doc.store.address, null);
    assert.ok(!doc.notes.some((note) => /순위는|답글률|GEO|경쟁 매장/.test(note)));
    assert.ok(!JSON.stringify(doc).includes('undefined'));
});

test('활동·순위·AI 진단이 없으면 그 구역과 숫자를 뺀다', () => {
    const { doc } = docOf({ ...RESTAURANT, activity: null, ranks: [] }, { geo: null });
    assert.equal(sectionOf(doc, 'rivals'), null);
    assert.equal(sectionOf(doc, 'ai'), null);
    assert.ok(!doc.summary.metrics?.some((metric) => ['reply', 'feed', 'rank', 'ai'].includes(metric.key)));
    assert.ok(!doc.summary.diagnoses.some((diag) => ['reply', 'feed', 'rankGap', 'rankWeak', 'rivalGap'].includes(diag.key)));
    // 순위를 모르면 지역이 확인된 키워드는 유지("순위 아직 조회 안 함"), 되풀이만으로 읽은 지역(unknown)은 직접 확인하게 한다
    assert.ok(doc.summary.slots.rows.every((row) => ['keep', 'check'].includes(row.action)));
    for (const row of doc.summary.slots.rows.filter((entry) => entry.action === 'check')) assert.match(row.reason, /^지역 확인 못 함 — 지역이 들어 있는지 직접 확인하세요\.$/);
    assert.ok(doc.summary.slots.rows.filter((row) => row.action === 'check').length >= 1);
    assert.ok(!doc.notes.some((note) => /순위는|답글률|GEO/.test(note)));
    // 1쪽 5칸 표 제목 옆: 바꿀 칸이 없어도 '살펴보기' 칸이 있으면 "지금 그대로 둡니다"라고만 하지 않는다
    const checks = doc.summary.slots.rows.filter((row) => row.action === 'check').length;
    assert.equal(doc.summary.slots.changes, 0);
    assert.equal(slotsNote(doc.summary.slots), `바꿀 칸 없음 · 살펴볼 칸 ${checks}개`);
});

test('5칸 표 제목 옆 한 줄: 바꿀·채울 칸 수와 살펴볼 칸 수', () => {
    assert.equal(slotsNote({ changes: 0, rows: [{ action: 'keep' }] }), '지금 그대로 둡니다');
    assert.equal(slotsNote({ changes: 0, rows: [{ action: 'keep' }, { action: 'check' }, { action: 'check' }] }), '바꿀 칸 없음 · 살펴볼 칸 2개');
    assert.equal(slotsNote({ changes: 3, rows: [{ action: 'replace' }, { action: 'check' }] }), '바꿀 칸 3개 · 살펴볼 칸 1개');
    assert.equal(slotsNote({ changes: 2, fillOnly: true, rows: [{ action: 'fill' }] }), '채울 칸 2개');
    assert.equal(slotsNote(null), '지금 그대로 둡니다');
    for (const [name, sample] of SAMPLES) {
        const slots = docOf(sample, { fitPage1: false }).doc.summary.slots;
        assert.match(slotsNote(slots), /^(바꿀|채울) 칸 \d+개|^바꿀 칸 없음|^지금 그대로 둡니다/, name);
    }
});

test('순위가 모두 조회 중·실패면 경쟁 구역과 순위 진단을 싣지 않는다', () => {
    const ranks = [
        { keyword: '강남구청횟집', state: 'loading' },
        { keyword: '강남구청점심', state: 'error', error: '순위를 조회하지 못했습니다.' },
    ];
    const { doc } = docOf(RESTAURANT, { ranks });
    assert.equal(sectionOf(doc, 'rivals'), null);
    assert.ok(!doc.summary.diagnoses.some((diag) => diag.key.startsWith('rank')));
});

test('내 매장이 1위인 키워드는 비교 표에 넣지 않고 "1위인 키워드"로 적는다', () => {
    const first = RESTAURANT.ranks[0];
    const top = first.result.top.map((row) => (row.isTarget ? { ...row, rank: 1 } : { ...row, rank: row.rank + 1 }));
    const ranks = [{ ...first, result: { ...first.result, rank: 1, top } }];
    const rivals = sectionOf(docOf(RESTAURANT, { ranks }).doc, 'rivals');
    assert.deepEqual(rivals.rows, []);
    assert.deepEqual(rivals.firsts, ['강남구청횟집']);
});

/* ───────── 5차 채점 1차 묶음(A~L) ───────── */

test('A·B: 1쪽 순위 줄은 조회한 키워드를 10위 안/밖/미조회로 모두 적고, 4주 뒤 조회 키워드는 5칸 최종안과 같다', () => {
    for (const [name, sample] of SAMPLES) {
        const { doc } = docOf(sample);
        const plan = sectionOf(doc, 'plan');
        assert.deepEqual(plan.recheck.keywords.map((row) => row.keyword), doc.summary.slots.rows.map((row) => row.next), name);
        const rank = doc.summary.metrics.find((metric) => metric.key === 'rank');
        assert.match(rank.note, /^5칸 최종안 키워드 \d+개 — 10위 안: /, name);
        assert.ok(rank.wideNote, name);
        // 순위를 모르는 칸은 문서에 값을 적지 않고(null) 사장님이 적는 빈칸으로 둔다
        for (const row of plan.recheck.keywords) assert.ok(row.now === null || /위$|밖$/.test(row.now), `${name}: ${row.keyword} ${row.now}`);
    }
    assert.doesNotMatch(JSON.stringify(RESTAURANT.ranks.map((row) => row.keyword)), /강남역남성전문미용실/);
    // 낱말: 순위를 못 구한 것은 '아직 순위 모름' 하나로(조회했다면서 미조회라는 모순된 말은 쓰지 않음)
    assert.doesNotMatch(JSON.stringify(docOf(PHARMACY).doc), /조회 못 함|조회 중|순위를 조회한 키워드/);
});

test('E: 1쪽 5칸 아래 안내의 조사는 마지막 키워드에 맞는다(은(는) 없음)', () => {
    const slots = docOf(RESTAURANT, { fitPage1: false }).doc.summary.slots;
    assert.match(slots.unrankedText, /^'강남횟집', '강남구청숙성회'는 아직 순위를 조회하지 않았습니다\./);
    assert.doesNotMatch(JSON.stringify(docOf(RESTAURANT, { fitPage1: false }).doc), /은\(는\)|을\(를\)|이\(가\)/);
});

test('F: 약국·미용실 문서에는 음식점 말(메뉴·이벤트·주문)이 없고 업종 낱말을 쓴다', () => {
    for (const [name, sample] of [['약국', PHARMACY], ['미용실', SALON]]) {
        const text = JSON.stringify(docOf(sample).doc);
        assert.doesNotMatch(text, /새 메뉴·이벤트|대표 메뉴\(서비스\)|예약\(또는 주문\)|주문\)/, name);
    }
    assert.match(JSON.stringify(docOf(PHARMACY).doc), /새 취급 품목·서비스·휴무 안내를 소식에 올리세요/);
    // 같은 문장에 업종 치환을 한 번 더 하지 않는다(어색한 겹침 없음)
    assert.doesNotMatch(JSON.stringify(docOf(PHARMACY).doc), /새 서비스·서비스|취급 품목·서비스·서비스|새 새 /);
    assert.match(JSON.stringify(docOf(PHARMACY).doc), /대표 취급 품목·서비스는 무엇인가요/);
    // 미용실 처방 방법에도 재료·양·맛 같은 음식점 말이 없다
    assert.doesNotMatch(JSON.stringify(docOf(SALON).doc), /재료·양\(몇 인분\)|맛 특징/);
    assert.match(JSON.stringify(docOf(SALON).doc), /구성·걸리는 시간을 사실대로 한 줄씩 쓰세요/);
});

test('G: 약국 5칸 예문은 등록 키워드를 손님 말로 푼 사실 문장이고, 소개글·소식 초안에 취급 품목이 같은 말로 들어 있다', () => {
    const { doc } = docOf(PHARMACY);
    const intro = sectionOf(doc, 'tasks').items.find((task) => task.key === 'description')?.draft || sectionOf(doc, 'tasks').items.find((task) => task.draft?.kind === 'intro')?.draft;
    assert.ok(intro.text.includes('건강기능식품(영양제)'));
    const feed = sectionOf(doc, 'tasks').items.find((task) => task.draft?.kind === 'feed').draft;
    assert.ok(feed.items[0].body.includes('건강기능식품(영양제)'));
});

test('H: 4주 실행표에 담지 못한 일은 "이 밖에"로 적는다(말없이 빼지 않음)', () => {
    for (const [name, sample] of SAMPLES) {
        const plan = sectionOf(docOf(sample).doc, 'plan');
        assert.equal(plan.overflow.length, plan.more, name);
        const shown = new Set(plan.weeks.flatMap((week) => week.items.map((item) => item.title)));
        for (const item of plan.overflow) assert.ok(!shown.has(item.title) && item.title, `${name}: ${item.title}`);
    }
    assert.ok(sectionOf(docOf(PHARMACY).doc, 'plan').overflow.length > 0);
});

test('I: 1쪽 5칸 이유의 약어는 1쪽에 풀이가 있다(실제 이유에 나온 표기만)', () => {
    const slots = docOf(RESTAURANT, { fitPage1: false }).doc.summary.slots;
    assert.ok(slots.legend.length > 0);
    for (const text of slots.legend) {
        const lead = text.split(' = ')[0];
        // 풀이한 표기가 5칸 이유 어딘가에 실제로 있다(예: '블로그 25/52', '상위 N곳 사용'의 숫자를 N 으로)
        const pattern = new RegExp(lead.replace(/N/g, '\\d+').replace(/\d+\/\d+/, '\\d+/\\d+').replace(/n개·'B' m개/, ".*"));
        assert.ok(slots.rows.some((row) => pattern.test(row.reason)) || /후기/.test(lead), text);
    }
    assert.ok(slots.legend.some((text) => text.startsWith('블로그 ')));
});

test('J: 소식 초안은 이름이 같은 메뉴에만 가격을 붙이고, 영업시간은 모든 요일을 적는다', () => {
    const { input } = docOf(RESTAURANT);
    const feed = feedDrafts(RESTAURANT.place, { nowMs: NOW, recommendation: input.recommendation });
    assert.doesNotMatch(feed.items[0].body, /광어, 모듬숙성회\(/);
    assert.match(feed.items[0].body, /월·화·수·목·금 11:00~01:00, 토·일 13:00~01:00/);
});

test('K: 문장 다듬기(모두와 공유·빈 칸 되풀이·예약 되풀이·머리표 띄우기)', () => {
    assert.doesNotMatch(JSON.stringify(docOf(PHARMACY).doc), /모두와 공유/);
    assert.match(JSON.stringify(docOf(PHARMACY).doc), /직원들과 공유하겠습니다/);
    // 5칸 이유에 '빈 칸 1칸'을 적었으면 처방 이유에서 "빈 칸이 1개 남았습니다"를 되풀이하지 않는다
    const keywords = sectionOf(docOf(PHARMACY).doc, 'tasks').items.find((task) => task.key === 'keywords');
    assert.ok(!keywords.why.some((line) => /^빈 칸이 \d+개 남았습니다/.test(line)));
    assert.doesNotMatch(JSON.stringify(docOf(SALON).doc), /네이버 예약으로 예약할/);
    assert.equal(tidyMenuName('(한정)활 전갱이회'), '(한정) 활 전갱이회');
    assert.equal(tidyMenuName('활 전갱이회'), '활 전갱이회');
});

test('L: 처방 상세의 먼저/권장/참고는 1쪽 "이번 주 할 일"·4주 실행표와 같은 순서', () => {
    for (const [name, sample] of SAMPLES) {
        const { doc } = docOf(sample);
        const tasks = sectionOf(doc, 'tasks').items;
        const plan = sectionOf(doc, 'plan');
        const first = tasks.filter((task) => task.level === 'high').map((task) => task.title);
        assert.deepEqual(first, plan.weeks[0].items.map((item) => item.title), `${name}: '먼저'인 일은 1주차의 일과 같다`);
        const later = plan.weeks.slice(1).flatMap((week) => week.items.map((item) => item.title));
        for (const task of tasks.filter((entry) => entry.level === 'high')) assert.ok(!later.includes(task.title), `${name}: ${task.title}`);
    }
});

test('L: 소개글 초안에는 지금 소개글이 있으면 지우지 말고 맨 앞에 붙이라는 정보(길이)를 싣는다', () => {
    const salon = introDraft(SALON.place, SALON.activity);
    assert.equal(salon.existingLength, SALON.place.detail.descriptionLength);
    assert.equal(introDraft(PHARMACY.place, PHARMACY.activity).existingLength, null, '소개글이 비어 있으면 없음');
});

test('L: 메뉴 설명 틀의 각 줄에는 고른 까닭이 있고, 키워드에서 뺀 메뉴도 채운다', () => {
    const { input } = docOf(RESTAURANT);
    const frames = menuFrames(RESTAURANT.place, { recommendation: input.recommendation, also: ['김밥'] });
    assert.ok(frames.rows.every((row) => row.why), '모든 줄에 고른 까닭');
    assert.ok(frames.rows.some((row) => /김밥/.test(row.name) && /김밥/.test(row.why)));
});

test('L: 처방전에 시각을 한 번만 넘기면 같은 시각으로 문서를 만든다(nowMs)', () => {
    const a = docOf(RESTAURANT).doc;
    const input = graphInput(RESTAURANT, {});
    const b = buildPrescription({ ...input, geo: analyzeGeoAeo({ place: input.place, activity: input.activity, ranks: input.ranks, nowMs: NOW }), fetchedAt: NOW, nowMs: NOW });
    assert.deepEqual(a.summary.diagnoses, b.summary.diagnoses);
});

/* ───────── 2차(가): 스마트플레이스 메뉴 경로(네이버 공식 도움말에서 확인된 것만) ───────── */

// 적으면 안 되는 것: 소개글 2,000자·찾아오는 길 400자·키워드 15자, 사진 20MB, 비공식 칸·버튼 이름, 앱 단계별 경로, 업체 정보 문의용 전화번호
const BANNED_SP = /2,000자|400자|15자|20MB|\[순서설정\]|홈페이지\/SNS|URL 추가|분류선택|사진관리|관리자센터|메뉴 관리|소식관리|\(또는 관리자\)|1599-0309|앱 >|하단 메뉴/;
const CLINIC = { ...PHARMACY, place: { ...PHARMACY.place, name: '메가치과의원', category: '치과', keywords: ['임플란트', '충치치료'], reviewVotes: [{ label: '친절해요', count: 50 }] } };

function allTasks(doc) {
    const tasks = sectionOf(doc, 'tasks');
    return [...tasks.items, ...tasks.rest];
}

test('2차(가): 모든 견본에 공식 확인이 안 된 숫자·이름·앱 경로·전화번호가 없다', () => {
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        assert.doesNotMatch(JSON.stringify(docOf(sample).doc), BANNED_SP, name);
    }
});

test('2차(가): 처방 상세 머리에 시작 안내(로그인·내 업체, 메뉴 이름이 바뀔 수 있음)가 한 번만 있다', () => {
    for (const [name, sample] of SAMPLES) {
        const doc = docOf(sample).doc;
        const guide = sectionOf(doc, 'tasks').guide;
        assert.deepEqual(guide.map((line) => line.text), [SP_LOGIN, SP_NAMES_MAY_CHANGE, ...(sample === PHARMACY ? [industryNote(PHARMACY.place), industryScopeNote(PHARMACY.place, allTasks(doc))] : [])], name);
        // 일마다 되풀이하지 않는다
        assert.equal((JSON.stringify(doc).match(/가게 주인 아이디로 로그인한 뒤/g) || []).length, 1, name);
        assert.doesNotMatch(JSON.stringify(doc), /1599/, name);
    }
    assert.match(SP_NAMES_MAY_CHANGE, /help\.naver\.com.*온라인 상담/);
});

test('2차(가): 대표키워드 — 정보 수정의 대표키워드 칸, 한 칸에 한 단어 최대 5개, 한 번에 고치기, 검토 대기는 기다리는 시간으로', () => {
    const keywords = allTasks(docOf(RESTAURANT).doc).find((task) => task.key === 'keywords');
    assert.equal(keywords.where, '스마트플레이스 > 내 업체 > 정보 수정 > 대표키워드');
    assert.match(keywords.steps[1], /'정보 수정' 버튼을 누르고 '대표키워드' 칸에 .*한 칸에 한 단어씩, 최대 5개 적고 저장합니다/);
    assert.match(keywords.steps[2], /다섯 칸을 한 번에 고치고 저장하세요.*일주일에 5번까지만.*자랑하는 말이나 가게 이름은 지워질 수 있습니다/);
    assert.match(keywords.steps[3], /네이버 검토가 끝난 뒤 순위를 다시 조회/);
    // 새 키워드는 소개글·소식에도 같은 표현으로: 문서의 예문 표를 보게 하고, 초안에 이미 든 예문과 (직접 적기)인 것을 가려 말한다
    assert.match(keywords.steps[3], /'키워드 처방 상세'의 예문 표를 보고 같은 표현을 소개글·소식에도 넣습니다\(초안에 이미 들어 있는 예문은 그대로 붙이고, '\(직접 적기\)'는 직접 넣으세요\)/);
    assert.equal(keywords.wait, SP_WAIT.review);
    assert.equal(keywords.timeLabel, '약 10분', '내가 하는 시간은 그대로 대략값');
    // 4주 뒤 순위 재조회 안내와 맞물림
    assert.match(sectionOf(docOf(RESTAURANT).doc, 'plan').recheck.note, /네이버 검토\(영업일 최대 5일\)를 거쳐 반영됩니다\. 반영된 뒤의 순위로 비교하세요/);
});

test('2차(가): 소식·답글·사진·소개글·예약·쿠폰·톡톡은 공식 확인된 단계와 제한만 적는다', () => {
    const restaurant = allTasks(docOf(RESTAURANT).doc);
    const by = (key) => restaurant.find((task) => task.key === key);
    assert.match(by('feed').steps[0], /업체 홈 화면 아래쪽 '새소식' 영역.*앱은 첫 화면의 '새소식 쓰기'/);
    assert.match(by('feed').steps[1], /공지는 최대 5개, 노출은 최대 45일/);
    assert.equal(by('feed').where, '스마트플레이스 > 내 업체 > 새소식');
    assert.match(by('reply').steps[1], /'리뷰' → '방문자 리뷰'.*'답글쓰기'/);
    assert.match(by('reply').steps[3], /손님 이름·전화번호를 적지 마세요/);
    assert.match(by('booking').steps[0], /'예약\/주문'.*'\+서비스 추가'.*'노출'/);
    assert.match(by('booking').steps[1], /'검수 신청'.*신청일 제외 2~3영업일.*'운영설정'.*'시작'/);
    assert.match(by('booking').steps[2], /정확한 칸 이름은 화면에서 확인하세요/, '예약 플레이스 연결 칸 이름은 단정하지 않음');
    assert.equal(by('booking').wait, SP_WAIT.booking);
    assert.match(by('coupon').steps[0], /'마케팅' → '쿠폰' → '쿠폰함'.*'신규 쿠폰 만들기'/);
    assert.match(by('talktalk')?.steps[0] || '', /'톡톡연결'/);
    const photos = allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'photos');
    assert.match(photos.steps[1], /'업체 사진' 칸.*최대 120장, 한 장에 10MB 이하\(JPG·PNG·GIF\)/);
    const description = allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'description');
    assert.match(description.steps[0], /'상세 설명' 칸.*글자 수 한도는 입력 칸에 표시되는 안내를 따르세요/);
});

test('2차(가): 메뉴 — 음식점은 업체정보 > 메뉴정보(가격 필수·주문/배민 예외), 미용실은 가격·시술 칸, 약국은 소개글로 대신', () => {
    const restaurant = allTasks(docOf(RESTAURANT).doc);
    const frame = restaurant.find((task) => task.key === 'menuDesc');
    assert.equal(frame.where, '스마트플레이스 > 내 업체 > 정보 수정 > 업체정보 > 메뉴정보');
    assert.match(frame.steps[0], /'정보 수정' 버튼 → '업체정보' → '메뉴정보'.*네이버 주문이나 배달의민족을 함께 쓰는 가게는 메뉴를 그쪽에서 고쳐야/);
    assert.equal(frame.wait, SP_WAIT.review);
    assert.equal(taskWhere('menuDesc', RESTAURANT.place), frame.where);
    const salon = allTasks(docOf(SALON).doc);
    const salonMenu = salon.find((task) => task.key === 'menuDesc');
    assert.equal(salonMenu.where, '스마트플레이스 > 내 업체 > 정보 수정');
    assert.match(salonMenu.steps[0], /가격·시술 칸을 찾으세요\(칸 이름은 화면에서 확인하세요\)/);
    assert.doesNotMatch(JSON.stringify(docOf(SALON).doc), /메뉴정보/, '미용실에 음식점 메뉴 경로를 쓰지 않는다');
    const pharmacy = allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'menuAdd');
    assert.match(pharmacy.steps[0], /칸이 없거나 이름이 다르면 소개글\('상세 설명'\)에 같은 내용을 글로 적으세요/);
    assert.doesNotMatch(JSON.stringify(docOf(PHARMACY).doc), /메뉴정보/);
});

test('2차(가): 약국은 새소식·톡톡·품목 등록 앞에 "업종에 따라 이 메뉴가 없거나 이름이 다를 수 있습니다"를 둔다', () => {
    const tasks = allTasks(docOf(PHARMACY).doc);
    const sure = tasks.filter((task) => ['feed', 'talktalk', 'menuAdd'].includes(task.key));
    assert.deepEqual(sure.map((task) => task.key).sort(), ['feed', 'menuAdd', 'talktalk']);
    for (const task of sure) assert.equal(task.preface, SP_UNSURE_INDUSTRY, task.key);
    // 병원 기준(새소식 없음)을 약국에 옮기지 않는다
    assert.ok(tasks.some((task) => task.key === 'feed'));
    assert.doesNotMatch(JSON.stringify(docOf(PHARMACY).doc), /병·의원은 네이버가/);
    // 음식점은 붙이지 않는다
    for (const task of allTasks(docOf(RESTAURANT).doc)) assert.equal(task.preface || null, null, task.key);
});

test('2차(가): 병·의원은 새소식·쿠폰 처방과 그 흔적(진단·지표·질문·하루 일·실행표·넣을 자리)을 모두 뺀다', () => {
    assert.equal(industryKind(CLINIC.place), 'clinic');
    const doc = docOf(CLINIC).doc;
    const keys = allTasks(doc).map((task) => task.key);
    assert.ok(!keys.includes('feed') && !keys.includes('coupon'), keys.join(','));
    assert.ok(keys.includes('talktalk') || keys.includes('booking') || keys.includes('reply'), '그 밖의 처방은 그대로');
    const text = JSON.stringify(doc);
    assert.doesNotMatch(text, /소식 1개 올리기|소식 첫 글|쿠폰 1개 등록|새소식 쓰기|'새소식'|쿠폰·결제 혜택|네이버 쿠폰/);
    assert.ok(!doc.summary.diagnoses.some((diag) => diag.key === 'feed'));
    assert.ok(!(doc.summary.metrics || []).some((metric) => metric.key === 'feed'));
    const ai = sectionOf(doc, 'ai');
    // '결제' 질문은 place-geo 가 병의원에는 쿠폰 없이 결제 수단만 묻는 질문으로 바꿔 두었다(쿠폰 이야기는 없다)
    assert.ok(!ai.questions.some((question) => /쿠폰/.test(`${question.question} ${question.now || ''} ${question.fix}`)));
    assert.ok(!ai.quick.some((entry) => entry.id === 'naver-feed'));
    assert.ok(!sectionOf(doc, 'plan').repeat.some((entry) => /소식/.test(entry.title)));
    // 이유를 한 줄로 적는다(처방 상세 머리 안내)
    assert.ok(sectionOf(doc, 'tasks').guide.some((line) => line.text === industryNote(CLINIC.place)));
    assert.match(industryNote(CLINIC.place), /병의원은 네이버가 새소식 기능을 제공하지 않습니다\. 병의원은 네이버가 쿠폰 기능을 제공하지 않습니다\./);
    // 대표키워드: 병의원은 별도의 검색 키워드 칸이 있고 개수를 적지 않는다, 소식에 넣으라는 말도 없다
    const keywords = allTasks(doc).find((task) => task.key === 'keywords');
    assert.match(keywords.steps.join(' '), /검색 키워드/);
    assert.doesNotMatch(keywords.steps.join(' '), /최대 5개|다섯 칸을 한 번에|소식/);
    for (const row of sectionOf(doc, 'keywords').placements) assert.doesNotMatch(row.where, /소식/);
    // 약국·음식점은 그대로(소식·쿠폰 처방이 있음)
    assert.ok(allTasks(docOf(RESTAURANT).doc).some((task) => task.key === 'feed'));
});

test('2차(가): 홈페이지·SNS 연결은 정보 수정 > 부가정보까지만(칸·버튼 이름 없이), 기다리는 시간은 걸리는 시간과 따로', () => {
    const links = sectionOf(docOf(SALON).doc, 'ai').more.find((entry) => entry.id === 'links');
    assert.match(links.how, /'정보 수정' 버튼 → '부가정보'로 들어가 홈페이지\(또는 SNS\) 주소를 넣고 저장합니다\. 열리지 않는 주소는 등록되지 않습니다/);
    assert.doesNotMatch(links.how, /URL|분류/);
    // 검수·검토 대기는 timeLabel 에 섞이지 않는다
    for (const task of allTasks(docOf(RESTAURANT).doc)) assert.doesNotMatch(task.timeLabel, /영업일/, task.key);
    assert.equal(allTasks(docOf(RESTAURANT).doc).find((task) => task.key === 'booking').timeLabel, '약 30분');
});

/* ───────── 업종별 제외(약국·병의원) · 리뷰 쿠폰 ───────── */

test('업종 제외는 한 곳(약국 / 병의원 / 그 밖)에서 정한다', () => {
    // 판정과 이유 문장은 lib/place-industry.js(데이터 담당)의 notApplicableOf 한 곳
    assert.deepEqual(skippedTasks(PHARMACY.place).sort(), ['booking', 'coupon']);
    assert.deepEqual(skippedTasks(CLINIC.place).sort(), ['coupon', 'feed']);
    assert.equal(industryNote(RESTAURANT.place), null);
    assert.deepEqual(skippedTasks(RESTAURANT.place), []);
    assert.deepEqual(skippedTasks(SALON.place), []);
});

test('약국: 쿠폰·할인 혜택과 네이버 예약 처방을 내지 않고(질문 줄·실행표 포함) 이유를 한 줄로 적으며 문의는 전화·톡톡만 남긴다', () => {
    const doc = docOf(PHARMACY).doc;
    const keys = allTasks(doc).map((task) => task.key);
    assert.ok(!keys.includes('coupon') && !keys.includes('booking'), keys.join(','));
    assert.ok(keys.includes('talktalk'), '톡톡은 남긴다');
    // (뺀 이유를 적은 처방 상세 머리 안내는 제외하고 처방·질문·실행표·1쪽에서 찾는다)
    const text = JSON.stringify({ summary: doc.summary, items: sectionOf(doc, 'tasks').items, rest: sectionOf(doc, 'tasks').rest, ai: sectionOf(doc, 'ai'), plan: sectionOf(doc, 'plan') });
    assert.doesNotMatch(text, /쿠폰 1개 등록|신규 쿠폰|쿠폰·결제 혜택|네이버 예약 켜기|예약 돼요|검수 신청|예약받기/);
    assert.ok(!sectionOf(doc, 'ai').questions.some((question) => question.key === 'payment'));
    // 약국의 '예약이나 문의는?' 질문은 place-geo 가 이미 뺐고(예약 돼요? 권고 없음), 남아 있더라도 예약이 아니라 문의 수단만 적는다
    const booking = sectionOf(doc, 'ai').questions.find((question) => question.key === 'booking');
    if (booking) assert.equal(booking.fix, `전화번호 같은 문의 수단을 소개글에 적으세요. 네이버 톡톡을 연결할 수 있으면 연결하세요(${SP_UNSURE_INDUSTRY})`);
    assert.ok(!sectionOf(doc, 'plan').weeks.flatMap((week) => week.items).some((item) => /쿠폰|네이버 예약/.test(item.title)));
    assert.ok(sectionOf(doc, 'plan').weeks.every((week) => week.items.length > 0), '처방이 빠져도 주차가 비지 않는다');
    assert.ok(!(doc.summary.week?.items || []).some((task) => ['coupon', 'booking'].includes(task.key)));
    assert.ok(sectionOf(doc, 'tasks').guide.some((line) => line.text === industryNote(PHARMACY.place)));
    assert.match(industryNote(PHARMACY.place), /약사법 시행규칙상 경품·할인으로 손님을 끄는 일이 제한될 수 있어 쿠폰·할인 혜택을 권하지 않습니다/);
    assert.match(industryNote(PHARMACY.place), /네이버 예약을 쓸 수 있는지 확인되지 않아/);
    // 다른 업종(음식점)에는 그대로 있다
    const restaurantKeys = allTasks(docOf(RESTAURANT).doc).map((task) => task.key);
    assert.ok(restaurantKeys.includes('coupon') && restaurantKeys.includes('booking'));
});

test('어느 업종에도 "리뷰 쿠폰"(리뷰를 조건으로 한 혜택)을 권하지 않는다', () => {
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        assert.doesNotMatch(JSON.stringify(docOf(sample).doc), /리뷰 쿠폰|리뷰 작성·첫 방문 쿠폰|첫 방문·리뷰 쿠폰|리뷰 작성 쿠폰/, name);
    }
    const coupon = allTasks(docOf(RESTAURANT).doc).find((task) => task.key === 'coupon');
    assert.ok(coupon.why.join(' ').includes('첫 방문 쿠폰이나 결제 혜택을 등록하면 손님이 매장 화면에서 쿠폰을 확인할 수 있습니다'));
    assert.equal(sectionOf(docOf(RESTAURANT).doc, 'ai').questions.some((question) => /리뷰.*쿠폰/.test(question.fix)), false);
});

test('C 표의 빈 칸 줄은 "왜 바꾸나"에 빈 칸이라 채운다는 말이 있다', () => {
    const row = sectionOf(docOf(PHARMACY).doc, 'keywords').rows.find((entry) => !entry.now);
    assert.equal(row.why, '빈 칸이라 추천을 위에서부터 채웁니다.');
});

/* ───────── 소개글·소식 제목의 매장 종류 낱말 ───────── */

test('매장 종류 낱말: 키워드 엔진의 검색용 업종 낱말(searchCategoryWord)을 그대로 쓴다 — 넓은 분류 이름(한식)이면 중심 낱말(횟집), 쓸 만하면 그대로', () => {
    assert.equal(centerCategory(RESTAURANT.place), '횟집');
    assert.equal(centerCategory(SALON.place), '남성전문미용실', '쓸 만한 분류 이름은 그대로');
    assert.equal(centerCategory(PHARMACY.place), '약국');
    // 처방전이 따로 규칙을 만들지 않는다: 어떤 견본이든 엔진이 정한 낱말이거나 분류 이름이다
    for (const sample of [RESTAURANT, SALON, PHARMACY, LONG]) {
        const word = searchCategoryWord(sample.place);
        if (word) assert.equal(centerCategory(sample.place), word);
        else assert.ok(centerCategory(sample.place));
    }
    assert.equal(centerCategory({ name: '이름만' }), null);
    // 소개글 초안도 같은 낱말('횟집')을 쓴다(음식점 견본에 소개글이 없어 직접 만들어 본다)
    const intro = introDraft({ ...RESTAURANT.place, detail: { ...RESTAURANT.place.detail, descriptionLength: 0 } }, RESTAURANT.activity, { recommendation: graphInput(RESTAURANT).recommendation });
    assert.ok(intro === null || !/한식/.test(intro.text), '소개글 초안에 "한식 매장" 같은 넓은 말이 없다');
});

test('소식 제목의 머리는 AI 질문(geo.question)과 같은 말을 쓰고, 질문이 없으면 지역·중심 낱말·매장 이름', () => {
    const { input } = docOf(RESTAURANT);
    const withQuestion = feedDrafts(RESTAURANT.place, { question: '강남구청역 횟집 추천', nowMs: NOW, recommendation: input.recommendation });
    assert.equal(withQuestion.items[0].title, '강남구청역 횟집 대물섬 강남점 — 11월 메뉴·영업 안내');
    const without = feedDrafts(RESTAURANT.place, { nowMs: NOW, recommendation: input.recommendation });
    assert.equal(without.items[0].title, '강남구청역 횟집 대물섬 강남점 — 11월 메뉴·영업 안내');
    // 문서에 실린 소식 초안(notice)의 제목 머리는 같은 문서의 AI 질문과 같은 말이다(질문의 말이 바뀌면 함께 바뀜)
    const { doc, geo } = docOf(RESTAURANT);
    const feed = sectionOf(doc, 'tasks').items.find((task) => task.key === 'feed').draft;
    assert.ok(feed.items[0].title.startsWith(`${geo.question.replace(/\s*추천$/, '')} 대물섬 강남점`), feed.items[0].title);
});

/* ───────── 6차 채점 감점 12건(k8) ───────── */

test('6차 1: 병의원 — 빈 칸은 화면 추천을 위에서부터 채우고(점수가 낮아도, 근거 약함 표시), 제목·1쪽·4주 표가 그 결과와 같은 말을 한다', () => {
    const { doc, input } = docOf(CLINIC);
    const rows = doc.summary.slots.rows;
    const top = input.recommendation.items.filter((item) => item.registrable);
    // 화면 추천(점수 10·10·8)이 빈 칸 3개에 들어간다. 근거 하한(EVIDENCE_MIN)은 이미 등록한 칸을 교체할 때만 쓴다.
    assert.deepEqual(top.slice(0, 5).map((item) => item.evidence.points), [10, 10, 8]);
    assert.deepEqual(rows.filter((row) => row.action === 'fill').map((row) => row.next), top.slice(0, 3).map((item) => item.keyword));
    assert.ok(rows.filter((row) => row.action === 'fill').every((row) => row.weak && /^빈 칸·근거 약함 → /.test(row.reason)));
    assert.match(doc.summary.slots.weakText, /'근거 약함' 칸은 근거가 적습니다\. 순위를 먼저 조회해 보고 넣을지 정하세요\./);
    // 등록 키워드의 지역을 확인하지 못했으면(regionStatus 'unknown') 지역명이 없다고 단정해 바꾸지 않고 직접 확인하게 한다
    assert.deepEqual(rows.slice(0, 2).map((row) => [row.action, row.reason]), [
        ['check', '지역 확인 못 함 — 지역이 들어 있는지 직접 확인하세요.'], ['check', '지역 확인 못 함 — 지역이 들어 있는지 직접 확인하세요.'],
    ]);
    // 할 일 제목·이번 주 할 일·4주 실행표가 같은 말(빈 칸 3칸 채우기)
    assert.equal(allTasks(doc).find((task) => task.key === 'keywords').title, '대표키워드 빈 칸 3칸 채우기');
    assert.ok(doc.summary.week.items.some((task) => task.key === 'keywords' && task.title === '대표키워드 빈 칸 3칸 채우기'));
    assert.match(JSON.stringify(sectionOf(doc, 'plan').weeks), /대표키워드 빈 칸 3칸 채우기/);
    assert.doesNotMatch(JSON.stringify(doc), /대표키워드 5칸 채우기/);
    // 1쪽 5칸 표 머리: 채울 칸 3개
    assert.equal(doc.summary.slots.fillOnly, true);
    // C: 바꾸는 칸(채움)만 올린다 — 그대로 두는 칸·살펴보기 칸은 이 표에 없다(열 뜻과 맞게). 근거 점수와 근거 약함이 보인다.
    const keywords = sectionOf(doc, 'keywords');
    assert.deepEqual(keywords.rows.map((row) => row.action), ['채움', '채움', '채움']);
    assert.ok(keywords.rows.every((row) => row.weak && Number.isFinite(row.points) && !/지역명 없음/.test(row.basis || '')));
    // 지역을 확인하지 못한 등록 키워드로는 새 조합을 만들지 않으니 다음 후보가 없다(이 표를 그리지 않음)
    assert.equal(keywords.next, null);
    assert.match(keywords.scoreNote, /근거 점수는 근거마다 혼잘마가 점수를 매겨 더한 값/);
});

test('6차 1: 바꿀 칸도 채울 후보도 없으면 "대표키워드 5칸 채우기"라는 일을 내지 않는다(이번 주 할 일·상세·4주 표·AI 점검 일 모두)', () => {
    const empty = { items: [], candidates: [] };
    const { doc } = docOf(CLINIC, { recommendation: { ...graphInput(CLINIC).recommendation, ...empty } });
    assert.equal(doc.summary.slots.changes, 0);
    assert.ok(doc.summary.slots.rows.every((row) => row.action === 'keep' || row.action === 'check'));
    assert.ok(!allTasks(doc).some((task) => task.key === 'keywords'));
    assert.ok(!doc.summary.week.items.some((task) => task.key === 'keywords'));
    assert.doesNotMatch(JSON.stringify(sectionOf(doc, 'plan')), /대표키워드 .*(채우기|고치기)/);
    assert.ok(!(sectionOf(doc, 'ai')?.more || []).some((item) => /키워드/.test(item.title)));
});

test('6차 2: 다음 후보 — "이보다 근거가 강한"이 아니라 "같거나 더 높은"으로, 점수가 같으면 추천 순서를, 순서를 가르는 가산(이미 등록한 낱말)과 근거 점수를 적는다', () => {
    // 미용실: 볼륨매직(48, 이미 등록한 낱말 가산)이 아이롱펌(44)보다 앞인 까닭이 종이만 보고 읽힌다
    const salon = sectionOf(docOf(SALON).doc, 'keywords');
    const volume = salon.rows.find((row) => row.next === '강남역볼륨매직');
    assert.match(volume.basis, /리뷰 299회 · 예약 214건 · 등록 키워드의 낱말/);
    assert.equal(volume.points, 48);
    const iron = salon.next.rows.find((row) => row.keyword === '강남역아이롱펌');
    assert.equal(iron.points, 44);
    assert.doesNotMatch(JSON.stringify(salon), /이보다 근거가 강한/);
    assert.match(salon.next.why, /근거 점수가 같거나 더 높은 후보가 먼저 채웠습니다/);
    assert.ok(salon.legend.some((entry) => entry.term === '등록 키워드의 낱말'));
    // 긴 견본: 강남숙성회(41)는 5칸의 강남구청숙성회(41)와 동점 — 더 강하다고 쓰지 않고 추천 순서를 말한다
    const long = sectionOf(docOf(LONG).doc, 'keywords');
    const tie = long.next.rows.find((row) => row.keyword === '강남숙성회');
    assert.equal(tie.points, 41);
    assert.match(tie.note, /강남구청숙성회와 점수가 같아 추천 순서가 앞선 쪽을 넣었습니다/);
    assert.match(long.scoreNote, /점수가 같으면 혼잘마 추천 순서가 앞선 쪽을 먼저 넣었습니다/);
});

test('6차 3: 메뉴·시술 설명 초안 — 고른 까닭은 사장님 자료의 숫자로, 설명은 아는 사실로 앞을 채우고 모르는 것만 (직접 적기), 쓰는 꼴 한 줄', () => {
    const { doc } = docOf(RESTAURANT);
    const menu = allTasks(doc).find((task) => task.key === 'menuDesc').draft;
    const byName = new Map(menu.rows.map((row) => [row.name, row]));
    assert.equal(byName.get('소금김밥').why, "최근 1주 결제 1위(276건) · 리뷰에 '김밥' 37회");
    assert.match(byName.get('대물 숙성회 정식(광어)').why, /^새 대표키워드 낱말 '숙성회'\(이름에 있음\) · 리뷰에 '숙성회' 22회$/);
    assert.equal(byName.get('대물 숙성회 정식(광어+시마아지)').frame, '대물 숙성회 정식(광어+시마아지): 구성 광어 + 시마아지 · 재료 (직접 적기) · 양 (직접 적기)');
    // 키워드로는 뺀 낱말(갈치·짜파게티 등)이 든 메뉴도 결제 인기 메뉴이므로 숫자 큰 순서로 들어간다(결제 4·5위가 리뷰 몇 회짜리 낱말에 밀리지 않음)
    assert.match(byName.get('(한정) 대물 순살 갈치조림').why, /최근 1주 결제 4위\(126건\)/);
    assert.match(byName.get('해물돌판짜파게티').why, /최근 1주 결제 5위\(119건\)/);
    assert.match(menu.model.text, /그대로 쓰지 마세요/);
    assert.doesNotMatch(menu.model.text, /○/, '보기는 자리표시(○○)가 아니라 구체 낱말로 채운 예시');
    // 재료·양·시간 같은 사장님만 아는 것은 지어내지 않는다: 숫자는 이름에 든 것(100g)뿐
    for (const row of menu.rows) {
        const own = row.frame.slice(row.name.length + 2); // '이름: ' 뒤
        if (!/\d+\s*(?:g|kg|ml|인분)/i.test(row.name)) assert.doesNotMatch(own, /\d+\s*(?:g|kg|ml|인분)/i, row.name);
    }
    // 긴 견본의 "최근 1주 인기 메뉴(결제 N건)"는 같은 형식(결제 N위·N건)으로 바뀐다
    const long = allTasks(docOf(LONG).doc).find((task) => task.key === 'menuDesc').draft;
    assert.match(long.rows.find((row) => row.name === '해물돌판짜파게티').why, /최근 1주 결제 5위\(119건\)/);
    // 리뷰 6회짜리 낱말('보쌈')이 든 메뉴는 결제 인기 메뉴 뒤에 온다
    const longNames = long.rows.map((row) => row.name);
    assert.ok(longNames.indexOf('소금김밥') < longNames.indexOf('해물돌판짜파게티') && longNames.indexOf('해물돌판짜파게티') < longNames.indexOf('맛보기보쌈(100g)'), longNames.join(' / '));
    assert.equal(long.rows.find((row) => row.name === '맛보기보쌈(100g)').frame, '맛보기보쌈(100g): 양 100g · 재료 (직접 적기)');
    assert.ok(long.rows.length <= MENU_FRAMES_MAX);
    // 미용실: 등록 순서대로 채우는 시술은 그 사실대로 적는다(지어낸 숫자 없음)
    const salon = allTasks(docOf(SALON).doc).find((task) => task.key === 'menuDesc').draft;
    assert.match(salon.rows.find((row) => row.name === '컷').why, /등록한 시술\(예약·결제·리뷰 숫자가 없어 등록 순서대로\)/);
});

test('6차 4: 1쪽에 처음 나오는 용어(GEO·AEO·AI 검색 점검 표시·분류 이름)의 한 줄 풀이가 1쪽에 있고, 1쪽을 줄여도 지우지 않는다', () => {
    const pharmacy = docOf(PHARMACY).doc.summary;
    assert.ok(pharmacy.terms.some((text) => /^AI 추천 준비\(GEO\) = AI 추천 목록에 들 준비 정도\(리뷰·출처·기본 정보\), AI 답변 준비\(AEO\) = 주차·가격·영업시간 같은 질문에 AI가 바로 답할 준비 정도/.test(text)));
    assert.ok(pharmacy.terms.some((text) => /^분류 이름 = 약·제품을 나누는 이름\(예: 일반의약품\)이라 지역을 붙인 키워드로 바꿉니다$/.test(text)));
    const salon = docOf(SALON).doc.summary;
    assert.ok(salon.terms.some((text) => /^AI 추천 준비\(GEO\) = /.test(text)) && salon.terms.some((text) => /^'AI 검색 점검' 표시 = /.test(text)));
    // 1쪽에 나오지 않는 용어는 풀이하지 않는다(음식점은 GEO·표시·분류 이름이 1쪽에 없음)
    assert.deepEqual(docOf(RESTAURANT).doc.summary.terms, []);
    // 풀이를 넣어도 어림 높이가 예산 안이다
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        const { doc } = docOf(sample);
        assert.ok(fitHeightMm(doc, doc.summary) <= PAGE1_BUDGET_MM, name);
    }
});

test('6차 7: 5칸 표에 올리는 칸과 열 뜻이 맞다(바꾸지 않는 칸은 "바꾸는 칸과 근거" 표에 없다)', () => {
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        const rows = sectionOf(docOf(sample).doc, 'keywords').rows;
        assert.ok(rows.every((row) => row.action === '교체' || row.action === '채움'), name);
        assert.ok(rows.every((row) => row.basis && !/바꿀 후보가 없어|그대로 둡니다/.test(row.basis)), name);
    }
});

test('6차 8: 순위 줄은 5칸 최종안 키워드 5개를 한 기준(10위 안 / 10위 밖 / 아직 순위 모름)으로 적는다 — "조회한 N개 중 미조회" 모순 없음', () => {
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        const { doc } = docOf(sample);
        const rank = doc.summary.metrics.find((metric) => metric.key === 'rank');
        if (!rank) continue;
        assert.match(rank.note, /^5칸 최종안 키워드 \d+개 — 10위 안: /, name);
        assert.doesNotMatch(rank.note, /조회한|미조회/, name);
        // 센 개수는 5칸 표의 키워드 수와 같다
        assert.equal(rank.now.split('/')[1], `${doc.summary.slots.rows.length}개`, name);
        // 적힌 키워드 수 = 5칸 키워드 수
        const named = rank.note.replace(/^[^—]+— /, '').split(' / ').flatMap((part) => part.replace(/^[^:]+: /, '').split(' · ')).filter((text) => text && text !== '없음');
        assert.equal(named.length, doc.summary.slots.rows.length, name);
    }
});

test('6차 9: 공식 경로가 없는 일도 정직한 한 줄과 순서가 있다(별점 표시 켜기·블로그 연결·소개글의 한 줄 소개)', () => {
    const clinicAi = sectionOf(docOf(CLINIC).doc, 'ai');
    const score = clinicAi.more.find((item) => item.id === 'scoreShow');
    assert.ok(score.steps.length >= 3);
    assert.ok(score.steps.some((step) => /정확한 위치는 확인하지 못했습니다\. 화면에서 '별점' 항목을 찾아보세요\. 안 보이면 스마트플레이스 사업주 고객센터\(help\.naver\.com\)의 온라인 상담을 이용하세요\./.test(step)));
    const blog = sectionOf(docOf(RESTAURANT).doc, 'ai').more.find((item) => item.id === 'naverBlog');
    assert.ok(blog.steps.length >= 3);
    assert.ok(blog.steps.some((step) => /정확한 위치는 확인하지 못했습니다\..*온라인 상담/.test(step)));
    // 약국·병의원 소개글 처방: 초안의 '한 줄 소개'를 넣을 곳(같은 화면의 칸)이 하는 법에 있다. 위치를 지어 적지 않는다.
    for (const sample of [PHARMACY, CLINIC]) {
        const task = allTasks(docOf(sample).doc).find((entry) => entry.key === 'description');
        assert.ok(task.draft.oneLine, '한 줄 소개 초안이 있다');
        assert.ok(task.steps.some((step) => /^초안 아래 '한 줄 소개'는 같은 정보 수정 화면에서 한 줄 소개 칸을 찾아 넣습니다\. 정확한 위치는 확인하지 못했습니다\./.test(step)));
    }
    // 이 문장들이 공식 확인이 안 된 이름·숫자를 새로 만들지 않는다
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        assert.doesNotMatch(JSON.stringify(docOf(sample).doc), BANNED_SP, name);
    }
});

test('6차 10: 문서가 한 말을 문서가 지킨다 — C 표의 예문(지역·업종·사실 문장)은 소개글·소식 초안에 같은 문장으로 들어 있다', () => {
    for (const [name, sample] of [['약국', PHARMACY], ['병의원', CLINIC], ['미용실', SALON]]) {
        const { doc } = docOf(sample);
        const placements = sectionOf(doc, 'keywords').placements;
        const intro = allTasks(doc).find((task) => task.key === 'description' || task.key === 'intro')?.draft;
        const feed = allTasks(doc).find((task) => task.key === 'feed')?.draft;
        for (const row of placements.filter((entry) => entry.sentence)) {
            // 소개글 자리라고 했으면 소개글 초안에(초안이 있을 때), 소식 본문 자리라고 했으면 소식 초안 본문에
            if (/소개글/.test(row.where) && intro) assert.ok(intro.text.includes(row.sentence), `${name}: ${row.keyword} ⊄ 소개글 초안 — ${row.sentence}`);
            if (/소식 본문/.test(row.where) && feed) assert.ok(feed.items.some((item) => item.body.includes(row.sentence)), `${name}: ${row.keyword} ⊄ 소식 초안`);
        }
        // 못 넣은 키워드(예문이 없는 것)는 예문 열이 (직접 적기)이고 "그대로" 쓰라는 자리만 알린다
        for (const row of placements.filter((entry) => !entry.sentence)) assert.match(row.where, /그대로/, `${name}: ${row.keyword}`);
    }
    // 약국: 지역만 다른 같은 낱말 문장은 한 문장으로 합쳐 소개글 첫 문장·소식 제목에 넣는다
    const pharmacy = docOf(PHARMACY).doc;
    const rows = sectionOf(pharmacy, 'keywords').placements;
    const shop = rows.filter((row) => row.kind === 'shop');
    assert.equal(shop.length, 2);
    assert.equal(shop[0].sentence, '메가헬스팜약국은 청주·오창에 있는 약국입니다.');
    assert.equal(shop[1].sentence, shop[0].sentence);
    const intro = allTasks(pharmacy).find((task) => task.key === 'description').draft;
    assert.ok(intro.text.startsWith('메가헬스팜약국은 청주·오창에 있는 약국입니다. 주소는 '), intro.text);
    const notice = allTasks(pharmacy).find((task) => task.key === 'feed').draft.items[0];
    assert.equal(notice.title, '청주·오창 메가헬스팜약국 — 11월 영업 안내', "'약국'을 되풀이하지 않는다");
    assert.ok(!/약국 메가헬스팜약국/.test(JSON.stringify(allTasks(pharmacy).find((task) => task.key === 'feed').draft)));
    // 미용실: 새 대표키워드 4개를 전부 세고, 소식 본문에 '강남역' 붙은 그대로의 표현이 들어 있다
    const salon = docOf(SALON).doc;
    const salonFeed = allTasks(salon).find((task) => task.key === 'feed');
    assert.match(salonFeed.why[0], /'강남역볼륨매직', '강남역댄디컷', '강남역다운펌', '강남역쉐도우펌'/);
    const salonBody = salonFeed.draft.items.map((item) => item.body).join(' ');
    for (const term of ['강남역 볼륨매직', '강남역 댄디컷', '강남역 쉐도우펌']) assert.ok(salonBody.includes(term), `소식 본문에 '${term}'`);
});

test('6차 11: 업종 말투 — 병의원 초안에 매장·들러·매장 소개글이 없고, 미용실 가격 문장에 메뉴판 기준이 없다', () => {
    const clinic = docOf(CLINIC).doc;
    const intro = allTasks(clinic).find((task) => task.key === 'description').draft;
    assert.match(intro.text, /^메가치과의원은 오창·청주에 있는 치과입니다\./);
    assert.doesNotMatch(intro.text, /매장/);
    const reply = allTasks(clinic).find((task) => task.key === 'reply').draft;
    assert.doesNotMatch(JSON.stringify(reply), /들러/);
    assert.match(JSON.stringify(reply), /다음에도 편하게 방문해 주세요\./);
    assert.doesNotMatch(JSON.stringify(clinic.summary), /매장 소개글/);
    assert.ok(clinic.summary.diagnoses.some((diag) => diag.text === '소개글이 비어 있습니다.'));
    // 약국: '들러'는 그대로(약국에 어울림)
    assert.match(JSON.stringify(allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'reply').draft), /들러 주세요/);
    assert.doesNotMatch(JSON.stringify(docOf(SALON).doc), /메뉴판 기준/);
});

test('6차 12: 초안 문장 다듬기 — 한정 반복·괄호 겹침·영업시간 중복·약국 반복·같은 영업시간 문장의 되풀이가 없다', () => {
    const { doc } = docOf(RESTAURANT);
    const feed = allTasks(doc).find((task) => task.key === 'feed').draft;
    const bodies = feed.items.map((item) => item.body);
    const limited = feed.items.find((item) => item.key === 'limited');
    assert.match(limited.body, /^메뉴판에 한정으로 올린 메뉴는 활 전갱이회 \+ 카르파쵸\(58,000원\)/);
    assert.doesNotMatch(JSON.stringify(feed), /한정 메뉴는 \(한정\)|\(한정\) 활|\)\([\d,]+원\)/);
    assert.match(bodies[0], /맛보기보쌈\(100g\) 15,000원/);
    // 영업시간 문장은 한 번만, '01:00까지 영업' 매장 안내는 영업시간 문장이 있으면 뺀다
    assert.equal(bodies.filter((body) => /영업시간은 /.test(body)).length, 1);
    assert.doesNotMatch(bodies.join(' '), /\d\d:\d\d까지 영업/);
    // 약국 소식 제목에 '약국'이 두 번 나오지 않는다
    assert.doesNotMatch(allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'feed').draft.items[0].title, /약국 .*약국/);
});

test('새 추천 필드 대비: 필드가 없으면 문서가 달라지지 않고, 있으면(candidates·unverified·confirmedBy·regionStatus·brand) 정해진 말로 적는다', () => {
    const base = docOf(PHARMACY).doc;
    // 필드가 없는 지금 자료: 직접 판단할 말 표가 없고, 지역명 말은 예전 그대로
    assert.equal(sectionOf(base, 'keywords').judge, null);
    assert.match(base.summary.diagnoses.find((diag) => diag.key === 'keywordRegion').text, /^대표키워드 4개 모두 지역명이 없습니다\.$/);
    assert.ok(!JSON.stringify(base).includes('품목 자료 없이 리뷰만으로 고른 말'));

    // candidates: 5칸에 넣지 않고 C 에 '직접 판단할 말'로 why 한 줄과 함께
    const reco = graphInput(PHARMACY).recommendation;
    const candidate = { keyword: '청주비타민', term: '비타민', region: '청주', reasons: [{ kind: 'review', text: '리뷰 7회' }], evidence: { points: 14, parts: [{ kind: 'review', text: '리뷰 7회', short: '리뷰 7회', points: 14 }] }, score: 14, why: '리뷰에는 나오지만 메뉴판·예약·결제 품목에서 확인되지 않았습니다.' };
    const withCandidates = docOf(PHARMACY, { recommendation: { ...reco, candidates: [candidate] } }).doc;
    const keywords = sectionOf(withCandidates, 'keywords');
    // (약국에는 메뉴판이 없어 가게 쪽 자료 이름만 취급 품목으로 바뀐다)
    assert.deepEqual(keywords.judge, [{ keyword: '청주비타민', tag: '자료가 적음', basis: '리뷰 7회', points: 14, why: '리뷰에는 나오지만 취급 품목·예약 자료에서 확인되지 않았습니다.' }]);
    assert.ok(!withCandidates.summary.slots.rows.some((row) => row.next === '청주비타민'), '5칸에는 넣지 않는다');
    // 모양이 이상해도(why 없음·keyword 없음) 던지지 않는다
    const sloppy = docOf(PHARMACY, { recommendation: { ...reco, candidates: [{ keyword: '청주비타민' }, { term: '키워드없음' }, null, 'x'] } }).doc;
    assert.deepEqual(sectionOf(sloppy, 'keywords').judge.map((row) => [row.keyword, row.why]), [['청주비타민', '리뷰에는 나오지만 취급 품목·예약 자료에서 확인되지 않았습니다.']]); // (약국에는 메뉴판이 없어 취급 품목)

    // unverified·confirmedBy: 5칸·C 의 근거에 표시
    const marked = { ...reco, items: reco.items.map((item, index) => (index === 0 ? { ...item, unverified: true } : index === 1 ? { ...item, confirmedBy: 'menu' } : item)) };
    const markedDoc = docOf(PHARMACY, { recommendation: marked }).doc;
    const markedRows = sectionOf(markedDoc, 'keywords').rows;
    const firstNext = markedDoc.summary.slots.rows.find((row) => row.next === reco.items[0].keyword);
    assert.match(firstNext.reason, /품목 자료 없이 리뷰만으로 고른 말/);
    assert.match(markedRows.find((row) => row.next === reco.items[0].keyword).basis, /^품목 자료 없이 리뷰만으로 고른 말 · /);
    assert.equal(markedRows.find((row) => row.next === reco.items[1].keyword).confirmed, '메뉴판 품목');

    // regionStatus: 'unknown' 이면 "지역명 없음"이 아니라 직접 확인하게(5칸·진단), 'none'·필드 없음은 예전 그대로
    const unknown = { ...reco, registered: reco.registered.map((entry) => ({ ...entry, concern: null, hasRegion: false, regionStatus: 'unknown' })) };
    const unknownDoc = docOf(PHARMACY, { recommendation: unknown }).doc;
    assert.equal(unknownDoc.summary.diagnoses.find((diag) => diag.key === 'keywordRegion').text, '대표키워드 4개의 지역을 확인하지 못했습니다. 지역이 들어 있는지 직접 확인하세요.');
    const unknownRows = unknownDoc.summary.slots.rows.filter((row) => row.action === 'check');
    assert.ok(unknownRows.length >= 1 && unknownRows.every((row) => /^지역 확인 못 함 — 지역이 들어 있는지 직접 확인하세요\.$/.test(row.reason)));
    assert.doesNotMatch(JSON.stringify(unknownDoc.summary.slots.rows.filter((row) => row.action === 'check')), /지역명 없음|지역명이 없어/);
    const none = { ...reco, registered: reco.registered.map((entry) => ({ ...entry, concern: null, hasRegion: false, regionStatus: 'none' })) };
    assert.match(docOf(PHARMACY, { recommendation: none }).doc.summary.diagnoses.find((diag) => diag.key === 'keywordRegion').text, /모두 지역명이 없습니다/);

    // excluded rule 'brand': 이름표
    const brand = { ...reco, excluded: [...reco.excluded, { term: '메가헬스팜', rule: 'brand', reason: '매장 이름과 같은 낱말이라 키워드로 권하지 않습니다.' }] };
    const brandRows = sectionOf(docOf(PHARMACY, { recommendation: brand }).doc, 'keywords').excluded.rows;
    // (약국 문서라 '매장'은 업종 말 '약국'으로)
    assert.deepEqual(brandRows.find((row) => row.words === '메가헬스팜'), { label: '약국 이름과 같은 낱말', words: '메가헬스팜', reason: '약국 이름과 같은 낱말이라 키워드로 권하지 않습니다' });
});

/* ───────── 키워드 엔진 확정 모양(k7) · 6차 관찰 3·4·7·8 · 화면과 같은 GEO·AEO 이름 ───────── */

test('키워드 엔진 확정 모양: candidates(lacks·source)는 5칸에 넣지 않고 lib 의 why 그대로 "직접 판단할 말"에 싣는다', () => {
    const { doc, input } = docOf(SALON);
    const candidates = input.recommendation.candidates;
    assert.ok(candidates.length >= 1 && candidates.every((entry) => entry.lacks && entry.source && typeof entry.why === 'string'));
    const judge = sectionOf(doc, 'keywords').judge;
    assert.deepEqual(judge.map((row) => row.keyword), candidates.map((entry) => entry.keyword));
    // lib 문장 그대로, 가게 쪽 자료 이름(메뉴판)만 미용 시술로
    candidates.forEach((entry, index) => assert.equal(judge[index].why, entry.why.replace(/메뉴판·예약·결제 품목에서/g, '시술·예약·결제 자료에서').replace(/메뉴판·예약·결제/g, '시술·예약·결제').replace(/메뉴판에는 있지만\(메뉴 (\d+)개\)/g, '시술에는 있지만(시술 $1개)')));
    assert.ok(!doc.summary.slots.rows.some((row) => candidates.some((entry) => entry.keyword === row.next)), '5칸에는 넣지 않는다');
    // 후보가 없으면 구역 자체를 그리지 않는다
    assert.equal(sectionOf(docOf(SALON, { recommendation: { ...input.recommendation, candidates: [] } }).doc, 'keywords').judge, null);
    // 메뉴판·예약·결제 자료가 아예 없어 확인할 수 없는 매장(lacks 'data')은 why 가 비어도 그 사정을 적는다
    const noData = docOf(SALON, { recommendation: { ...input.recommendation, candidates: [{ ...candidates[0], why: '', lacks: 'data' }] } }).doc;
    assert.equal(sectionOf(noData, 'keywords').judge[0].why, '시술·예약·결제 자료가 없어 품목으로 확인할 수 없습니다.');
    assert.equal(JUDGE_WHY_NO_DATA, '메뉴판·예약·결제 자료가 없어 품목으로 확인할 수 없습니다.');
});

test('키워드 엔진 확정 모양: confirmedBy 는 영문 코드 하나 — 한글 이름으로 바꾸고 모르는 코드는 적지 않는다', () => {
    assert.deepEqual(Object.keys(CONFIRMED_LABEL), ['industry', 'registered', 'menu', 'booking', 'pos', 'rival']);
    assert.equal(confirmedText({ confirmedBy: 'menu' }), '메뉴판 품목');
    assert.equal(confirmedText({ confirmedBy: 'booking' }), '네이버 예약 상품');
    assert.equal(confirmedText({ confirmedBy: 'pos' }), '결제 인기 메뉴');
    assert.equal(confirmedText({ confirmedBy: 'rival' }), '상위 매장 등록');
    // 근거 칸에 이미 '업종'·'등록 키워드의 낱말'로 적힌 확인은 되풀이하지 않는다(all 이면 돌려줌)
    assert.equal(confirmedText({ confirmedBy: 'industry' }), null);
    assert.equal(confirmedText({ confirmedBy: 'registered' }), null);
    assert.equal(confirmedText({ confirmedBy: 'industry' }, { all: true }), '업종 낱말');
    assert.equal(confirmedText({ confirmedBy: 'registered' }, { all: true }), '등록한 키워드의 낱말');
    assert.equal(confirmedText({ confirmedBy: null }), null);
    assert.equal(confirmedText({ confirmedBy: 'mystery' }), null);
    assert.equal(confirmedText({}), null);
    // 문서의 5칸·다음 후보에는 그 한글 이름이 실린다
    const { doc } = docOf(SALON);
    const names = new Set(Object.values(CONFIRMED_LABEL));
    const shown = [...sectionOf(doc, 'keywords').rows, ...sectionOf(doc, 'keywords').next.rows].map((row) => row.confirmed).filter(Boolean);
    assert.ok(shown.length > 0 && shown.every((name) => names.has(name)), shown.join('|'));
});

test('키워드 엔진 확정 모양: 같은 낱말의 두 번째 칸은 lib 의 note 한 줄을 "같은 낱말은 두 칸까지" 문장과 하나로 적는다(둘이 겹치지 않음)', () => {
    const { input } = docOf(RESTAURANT);
    const reco = input.recommendation;
    const withNote = {
        ...reco,
        items: reco.items.map((item) => (item.keyword === '강남횟집'
            ? { ...item, reasons: [...item.reasons.filter((reason) => reason.kind !== 'note'), { kind: 'note', text: "'횟집' 두 번째 칸 — 강남구청·강남 두 지역 모두 내 키워드가 10위 안" }] }
            : item)),
    };
    const why = sectionOf(docOf(RESTAURANT, { recommendation: withNote }).doc, 'keywords').rows.find((row) => row.next === '강남횟집').why;
    assert.match(why, /'횟집'은 5칸에 두 번 들어갑니다\(같은 낱말은 두 칸까지 허용\)\. 순위가 낮은 지역만 바꾼 조합입니다\. 강남구청·강남 두 지역 모두 내 키워드가 10위 안\.$/);
    assert.equal((why.match(/두 칸까지/g) || []).length, 1);
    // note 도 상위 매장 등록 자료도 없으면 까닭을 지어내지 않는다("근거가 강해 넣었습니다" 같은 말 없음)
    const bare = {
        ...reco,
        items: reco.items.map((item) => (item.keyword === '강남횟집'
            ? { ...item, reasons: item.reasons.filter((reason) => reason.kind !== 'note'), evidence: { ...item.evidence, parts: item.evidence.parts.filter((part) => part.kind !== 'rival') } }
            : item)),
    };
    const bareWhy = sectionOf(docOf(RESTAURANT, { recommendation: bare }).doc, 'keywords').rows.find((row) => row.next === '강남횟집').why;
    assert.doesNotMatch(bareWhy, /근거가 강해/);
    assert.match(bareWhy, /두 번 들어갑니다\(같은 낱말은 두 칸까지 허용\)\. 순위가 낮은 지역만 바꾼 조합입니다\.$/);
});

test('키워드 엔진 확정 모양: rule short(한 글자 낱말)·duplicate(같은 칸 두 번)는 이름표와 lib 의 이유 문장을 그대로 쓴다', () => {
    const { input } = docOf(RESTAURANT);
    const reco = input.recommendation;
    const short = { ...reco, excluded: [...reco.excluded, { term: '회', keywords: [], rule: 'short', reason: "리뷰에 '회'가 나오지만, 한 글자 낱말이라 이 말만으로는 어떤 메뉴를 찾는지 가려지지 않아 지역을 붙인 키워드로는 권하지 않습니다." }] };
    const row = sectionOf(docOf(RESTAURANT, { recommendation: short }).doc, 'keywords').excluded.rows.find((entry) => entry.words === '회');
    assert.deepEqual(row, { label: '한 글자 낱말', words: '회', reason: "리뷰에 '회'가 나오지만, 한 글자 낱말이라 이 말만으로는 어떤 메뉴를 찾는지 가려지지 않아 지역을 붙인 키워드로는 권하지 않습니다" });
    const reason = "'강남구청점심'은 '강남구청점심식사'와 지역·낱말이 같아 대표키워드 칸을 둘 쓰고 있습니다. 한 칸은 다른 낱말이나 지역에 쓸 수 있는지 살펴보세요.";
    const dup = { ...reco, registered: reco.registered.map((entry) => (entry.keyword === '강남구청점심' ? { ...entry, concern: { rule: 'duplicate', reason } } : entry)) };
    const slot = docOf(RESTAURANT, { recommendation: dup }).doc.summary.slots.rows.find((entry) => entry.now === '강남구청점심');
    assert.equal(slot.action, 'replace');
    assert.match(slot.reason, /^같은 조합 중복 → /);
    // 모르는 rule 이 와도 던지지 않고 기본 이름표
    const unknownRule = { ...reco, excluded: [...reco.excluded, { term: '새규칙', keywords: [], rule: 'futureRule', reason: '미래에 생길 규칙입니다.' }] };
    assert.equal(sectionOf(docOf(RESTAURANT, { recommendation: unknownRule }).doc, 'keywords').excluded.rows.find((entry) => entry.words === '새규칙').label, '추천 제외');
});

test('6차 관찰 3: 약국은 쿠폰·예약을 뺀 까닭 다음에 새소식·톡톡을 넣은 기준을 한 줄로 밝히고, 안 보이면 건너뛰게 한다', () => {
    const doc = docOf(PHARMACY).doc;
    const guide = sectionOf(doc, 'tasks').guide;
    const scope = guide.find((line) => line.label === '넣은 일');
    assert.ok(scope);
    assert.equal(scope.text, industryScopeNote(PHARMACY.place, allTasks(doc)));
    assert.match(scope.text, /^새소식·톡톡은 약국에서 쓸 수 있는지 네이버 공식 도움말로 확인하지 못했습니다\. 스마트플레이스에 그 메뉴가 보이면 하고, 보이지 않으면 건너뛰세요\.$/);
    assert.doesNotMatch(scope.text, /쓰는 곳이 있어/, '출처 없는 말을 쓰지 않는다');
    assert.ok(guide.findIndex((line) => line.label === '약국') < guide.indexOf(scope), '뺀 까닭 다음에 넣은 기준');
    // 문서에 그 일이 없으면 적지 않는다(지어낸 설명 없음). 다른 업종에도 없다.
    assert.equal(industryScopeNote(PHARMACY.place, [{ key: 'reply' }]), null);
    assert.equal(industryScopeNote(PHARMACY.place, [{ key: 'feed' }]), '새소식은 약국에서 쓸 수 있는지 네이버 공식 도움말로 확인하지 못했습니다. 스마트플레이스에 그 메뉴가 보이면 하고, 보이지 않으면 건너뛰세요.');
    assert.equal(industryScopeNote(RESTAURANT.place, [{ key: 'feed' }]), null);
});

test('6차 관찰 4: 네이버가 공식으로 밝히지 않은 노출 위치·표시 방식(매장 화면 맨 위·검색 목록 표시)을 단정하는 문장이 없다', () => {
    const banned = /(매장|약국|병·의원|병원) 화면 (맨 위|상단)|검색 목록에 (보이|예약 표시|쿠폰 표시)|(예약|쿠폰) 표시가 붙|화면 상단에 노출|상단에 노출됩니다/;
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        assert.doesNotMatch(JSON.stringify(docOf(sample).doc), banned, name);
    }
    // 사진 0장인 매장: 이 매장 자료(사진 0장·손님 사진·영상 수)가 먼저이고, 화면 문장("손님이 매장 화면에서 보는 사진입니다")은 노출 위치를 단정하지 않는 사실 서술이라 그대로 싣는다.
    // (예전 화면 문장 "매장 화면 맨 위와 검색 목록에 보이는 사진입니다"가 다시 오면 UNCONFIRMED_EXPOSURE 거름이 빼 준다 — 아래 scrub 시험)
    const photos = allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'photos');
    // (약국 문서라 '매장 화면'은 업종 말 '약국 화면'으로)
    assert.deepEqual(photos.why, ['사장님이 올린 사진이 없습니다(손님이 올린 사진·영상은 34개). 손님이 약국 화면에서 보는 사진입니다.']);
    assert.deepEqual(photos.how, ['외관·내부·대표 상품 사진부터 올리세요.']);
    assert.deepEqual(photos.steps.slice(-1), ['밝고 흔들리지 않은 사진을 고릅니다.']);
    // 거름은 남아 있다: 화면 문장이 예전처럼 노출 위치를 단정하면(맨 위·검색 목록) 인쇄본에는 옮기지 않는다
    const old = graphInput(PHARMACY).actions.map((action) => (action.key === 'photos'
        ? { ...action, detail: '사장님이 올린 사진이 없습니다(손님이 올린 사진·영상은 34개). 외관·내부·대표 상품 사진부터 올리세요. 매장 화면 맨 위와 검색 목록에 보이는 사진입니다.' }
        : action));
    const scrubbed = allTasks(docOf(PHARMACY, { actions: old }).doc).find((task) => task.key === 'photos');
    assert.deepEqual(scrubbed.why, ['사장님이 올린 사진이 없습니다(손님이 올린 사진·영상은 34개).']);
    assert.doesNotMatch(JSON.stringify(scrubbed), banned);
});

test('6차 관찰 7: 제외표의 "지역만 바꾼 조합" 줄은 같은 낱말 두 칸까지 규칙을 함께 말한다(5칸에 두 번 든 낱말이 있으면 그 낱말을 적음)', () => {
    const restaurant = sectionOf(docOf(RESTAURANT).doc, 'keywords');
    const swapped = restaurant.excluded.rows.find((row) => row.label === '지역만 바꿈');
    assert.equal(swapped.reason, "이미 5칸이나 등록 키워드에 있는 낱말에 지역만 바꾼 조합이라 따로 권하지 않음(같은 낱말은 두 칸까지라 '횟집'만 5칸에 두 번 넣었습니다)");
    // 5칸에 정말 '횟집'이 두 번 있다
    const rows = docOf(RESTAURANT).doc.summary.slots.rows;
    assert.equal(rows.filter((row) => /횟집$/.test(row.next)).length, 2);
    const pharmacy = sectionOf(docOf(PHARMACY).doc, 'keywords').excluded.rows.find((row) => row.label === '지역만 바꿈');
    assert.match(pharmacy.reason, /\(같은 낱말은 두 칸까지라 '약국'만 5칸에 두 번 넣었습니다\)$/);
});

test('6차 관찰 8: 4주 실행표 위에 순서의 기준 한 줄이 있고, 1주차는 1쪽 이번 주 할 일과 같다', () => {
    for (const [name, sample] of SAMPLES) {
        const plan = sectionOf(docOf(sample).doc, 'plan');
        assert.match(plan.lead, /순서: 1쪽 '이번 주 할 일'과 같은 점수 순서입니다\. 점수는 화면의 단계\('먼저'·'권장'·'참고'\)에 AI 검색 점검 점수가 오르는 만큼과 5칸을 바꾸는 일·핵심 진단과 이어진 일의 가산점을 더한 값이라, 단계가 낮아도 AI 검색 점수가 크게 오르는 일이 앞에 올 수 있습니다\.$/, name);
        assert.deepEqual(plan.weeks[0].items.map((item) => item.title), docOf(sample).doc.summary.week.items.map((task) => task.title), name);
    }
});

test('화면과 같은 이름: GEO·AEO 는 쉬운 이름 뒤 괄호("AI 추천 준비(GEO)", "AI 답변 준비(AEO)")로만 적는다', () => {
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        const text = JSON.stringify(docOf(sample).doc);
        assert.doesNotMatch(text, /(?<!AI 추천 준비\()GEO/, name);
        assert.doesNotMatch(text, /(?<!AI 답변 준비\()AEO/, name);
    }
    const pharmacy = docOf(PHARMACY).doc;
    assert.match(JSON.stringify(pharmacy.summary.metrics), /AI 추천 준비\(GEO\) \d+ · AI 답변 준비\(AEO\) \d+점/);
    assert.match(JSON.stringify(pharmacy.summary.terms), /AI 추천 준비\(GEO\) = AI 추천 목록에 들 준비 정도\(리뷰·출처·기본 정보\), AI 답변 준비\(AEO\) = 주차·가격·영업시간 같은 질문에 AI가 바로 답할 준비 정도/);
    assert.match(allTasks(pharmacy).find((task) => task.key === 'feed').gain, /^AI 검색 점검 점수 변화 — AI 추천 준비\(GEO\) \+\d+점 · AI 답변 준비\(AEO\) \+\d+점\(혼잘마 계산값\)$/);
});

test('한 줄 소개의 대표 메뉴 낱말은 화면과 같은 headlineMenuTerms 를 쓴다(키워드 추천이 뺀 낱말은 쓰지 않음)', () => {
    const salon = introDraft(SALON.place, SALON.activity);
    assert.equal(salon.oneLine, '강남역 댄디컷·쉐도우펌 남성전문미용실');
    // 지역·업종만 있는 매장(대표 메뉴 낱말 없음)은 예전처럼 지역과 업종 낱말
    assert.equal(introDraft(PHARMACY.place, PHARMACY.activity, { recommendation: graphInput(PHARMACY).recommendation }).oneLine, '오창읍 약국');
});

test('초안 표시 문구: 약국·병의원은 "매장"이 아니라 그 업종의 말로 적는다(화면이 section.draftMark 를 그대로 그림)', () => {
    assert.equal(draftMarkFor(RESTAURANT.place), DRAFT_MARK);
    assert.equal(draftMarkFor(SALON.place), DRAFT_MARK);
    assert.equal(draftMarkFor(PHARMACY.place), '초안 — 우리 약국 사실에 맞게 고쳐 쓰세요');
    assert.equal(draftMarkFor(CLINIC.place), '초안 — 우리 병·의원 사실에 맞게 고쳐 쓰세요');
    assert.equal(draftMarkFor({ name: '댕댕동물병원', category: '동물병원' }), '초안 — 우리 병원 사실에 맞게 고쳐 쓰세요');
    for (const [name, sample] of [['약국', PHARMACY], ['병의원', CLINIC]]) {
        const tasks = sectionOf(docOf(sample).doc, 'tasks');
        assert.equal(tasks.draftMark, draftMarkFor(sample.place), name);
        assert.ok(tasks.lead.includes(`"${tasks.draftMark}"`), name);
        assert.doesNotMatch(tasks.draftMark, /매장/, name);
    }
    assert.equal(sectionOf(docOf(RESTAURANT).doc, 'tasks').draftMark, DRAFT_MARK);
});

test('업종 말: 같은 표·같은 처방 안에 음식점 말 "메뉴"가 업종과 안 맞게 남지 않는다(시술 설명 표 머리·리뷰 답글 안내·근거 풀이)', () => {
    // 표 머리: 음식점 '메뉴', 미용실 '시술'
    const head = (sample) => allTasks(docOf(sample).doc).find((task) => task.key === 'menuDesc').draft.reasonHead;
    assert.equal(head(RESTAURANT), '이 메뉴를 고른 까닭');
    assert.equal(head(SALON), '이 시술을 고른 까닭');
    assert.equal(menuFrames(SALON.place, {}).reasonHead, '이 시술을 고른 까닭');
    // 리뷰 답글 안내: 업종 낱말
    const note = (sample) => replyDrafts(sample.place, {}).note;
    assert.match(note(RESTAURANT), /리뷰에 적힌 메뉴·상황에 맞게/);
    assert.match(note(SALON), /리뷰에 적힌 시술·상황에 맞게/);
    assert.match(note(PHARMACY), /리뷰에 적힌 취급 품목·서비스·상황에 맞게/);
    assert.match(note(CLINIC), /리뷰에 적힌 진료 과목·서비스·상황에 맞게/);
    // 5칸 근거 풀이(예약 N건·리뷰 N회)도 그 업종의 말
    const legend = (sample) => sectionOf(docOf(sample).doc, 'keywords').legend.map((entry) => entry.meaning).join(' ');
    assert.match(legend(SALON), /그 시술의 예약 수입니다/);
    assert.match(legend(SALON), /그 시술을 고른 횟수입니다/);
    // 스마트플레이스 화면의 '메뉴'(왼쪽 메뉴·메뉴 이름)와 공식 문장("메뉴·서비스·상품 이름")·'메뉴판'만 남는다
    // (근거 앞머리 "메뉴 열펌"·note "가장 많은 메뉴"는 업종 낱말로 바뀐다. lib why 의 "(메뉴 1개)"는 lib 문장 그대로라 남는다)
    const UI = /왼쪽 메뉴|메뉴 이름|그 메뉴가 보이|이 메뉴가 없거나|비슷한 이름의 메뉴|메뉴·서비스·상품 이름|메뉴판|메뉴정보|\(메뉴 \d+개\)/;
    for (const [name, sample] of [['미용실', SALON], ['약국', PHARMACY], ['병의원', CLINIC]]) {
        const text = JSON.stringify(docOf(sample).doc);
        const stray = [...text.matchAll(/메뉴/g)].filter((m) => !UI.test(text.slice(Math.max(0, m.index - 12), m.index + 14)));
        assert.deepEqual(stray.map((m) => text.slice(Math.max(0, m.index - 20), m.index + 20)), [], name);
    }
});

test('업종 말: 1쪽 5칸 아래 풀이("리뷰 N회 = …")와 C 풀이 모두 그 업종 낱말 하나만 쓰고, 5종 어디에도 "메뉴·시술"·"시술·메뉴" 꼴이 없다', () => {
    // 1쪽이 넘칠 때 줄이기 전의 풀이(fitPage1: false)로 본다
    const page1 = (sample) => docOf(sample, { fitPage1: false }).doc.summary.slots.legend.join(' ');
    assert.match(page1(RESTAURANT) + page1(SALON), /리뷰 N회 = 방문자 리뷰에서 그 (메뉴|시술)를? 고른 횟수/);
    assert.match(page1(SALON), /리뷰 N회 = 방문자 리뷰에서 그 시술을 고른 횟수/);
    assert.match(page1(RESTAURANT), /리뷰 N회 = 방문자 리뷰에서 그 메뉴를 고른 횟수/);
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        assert.doesNotMatch(JSON.stringify(docOf(sample).doc), /메뉴·시술|시술·메뉴/, name);
    }
    // 약어 풀이 함수는 낱말을 따로 받는다
    assert.deepEqual(pageOneLegend([{ action: 'replace', reason: '내 3위 → 리뷰 22회' }], '시술'), ['리뷰 N회 = 방문자 리뷰에서 그 시술을 고른 횟수']);
});

test('새 키워드 엔진: voice·share 후보의 기본 까닭, unrelated(자료에 없는 말)·prefix(메뉴 앞에 붙는 말)의 이름표와 이유, 1쪽에는 짧게', () => {
    // 후보: lacks 별 기본 까닭(lib why 가 비었을 때만) — 화면은 lib why 를 그대로 쓴다
    const { input } = docOf(SALON);
    const reco = input.recommendation;
    const one = (lacks, why = '') => sectionOf(docOf(SALON, { recommendation: { ...reco, candidates: [{ ...reco.candidates[0], lacks, why }] } }).doc, 'keywords').judge[0].why;
    // (미용실 문서라 가게 쪽 자료 이름은 메뉴판이 아니라 시술)
    const beauty = (text) => text.replace(/메뉴판·예약·결제 품목에서/g, '시술·예약·결제 자료에서').replace(/메뉴판·예약·결제/g, '시술·예약·결제');
    assert.equal(one('voice'), beauty(JUDGE_WHY_VOICE));
    assert.equal(one('share'), JUDGE_WHY_SHARE);
    assert.equal(one('data'), beauty(JUDGE_WHY_NO_DATA));
    assert.equal(one('menu'), beauty(JUDGE_WHY_DEFAULT));
    assert.equal(one('voice', 'lib 이 준 한 문장입니다.'), 'lib 이 준 한 문장입니다.');
    // 실제 엔진의 voice 후보(미용실 '강남역열펌': 메뉴판에는 있지만 손님 쪽에서 확인 못 함)가 직접 판단할 말에 lib why 그대로 실린다
    const voice = reco.candidates.find((entry) => entry.lacks === 'voice');
    assert.ok(voice);
    const row = sectionOf(docOf(SALON).doc, 'keywords').judge.find((entry) => entry.keyword === voice.keyword);
    assert.equal(row.why, voice.why.replace('메뉴판에는 있지만(메뉴 1개)', '시술에는 있지만(시술 1개)'));
    // 긴 견본: 이 매장 자료 어디에도 없는 등록 낱말(concern 'unrelated')은 바꾸지 않고(살펴보기) 1쪽에는 짧은 말만, 이유 전체는 C 의 '추천에서 뺀 키워드와 이유'에
    const long = docOf(LONG);
    const checks = long.doc.summary.slots.rows.filter((entry) => entry.action === 'check');
    assert.ok(checks.length >= 1);
    for (const entry of checks) {
        assert.match(entry.reason, /^자료에 없는 말 — 새 조합은 만들지 않았습니다\. 아는 사실이면 그대로 두세요\.$/);
        assert.equal(entry.next, entry.now, '바꾸지 않는다');
    }
    const excluded = sectionOf(long.doc, 'keywords').excluded.rows.filter((entry) => entry.label === '자료에 없는 말');
    assert.equal(excluded.length, checks.length);
    for (const entry of excluded) assert.match(entry.reason, /이 매장의 업종·이름·메뉴·리뷰·예약·결제 자료에서 찾지 못한 말이라, 지역을 붙인 새 키워드는 만들지 않았습니다\. 사장님이 아는 사실이면 등록한 그대로 쓰세요$/);
    // prefix: 이름표 + lib 이유 그대로
    const prefix = { ...reco, excluded: [...reco.excluded, { term: '마장동', keywords: [], rule: 'prefix', reason: "'마장동'은 메뉴 이름 앞에서만 쓰이고(메뉴 3개) 끝말로는 한 번도 쓰이지 않아, 메뉴가 아니라 지명·원산지·꾸밈으로 보고 키워드의 낱말로 쓰지 않습니다." }] };
    const prefixRow = sectionOf(docOf(SALON, { recommendation: prefix }).doc, 'keywords').excluded.rows.find((entry) => entry.words === '마장동');
    assert.deepEqual(prefixRow, { label: '메뉴 앞에 붙는 말', words: '마장동', reason: "'마장동'은 메뉴 이름 앞에서만 쓰이고(메뉴 3개) 끝말로는 한 번도 쓰이지 않아, 메뉴가 아니라 지명·원산지·꾸밈으로 보고 키워드의 낱말로 쓰지 않습니다" });
    // label: 업종 분류 이름 + lib 이유 그대로(이유가 비면 줄임말)
    const labelReason = '헤어샵은 업종 이름일 뿐이고 등록 키워드·상위 매장 키워드·리뷰·메뉴·블로그 어디에도 나오지 않아, 지역을 붙인 키워드로는 권하지 않습니다.';
    const label = { ...reco, excluded: [...reco.excluded, { term: '헤어샵', keywords: [], rule: 'label', reason: labelReason }, { term: '뷰티샵', keywords: [], rule: 'label', reason: '' }] };
    const labelRows = sectionOf(docOf(SALON, { recommendation: label }).doc, 'keywords').excluded.rows.filter((entry) => entry.label === '업종 분류 이름');
    assert.deepEqual(labelRows.map((entry) => entry.words).sort(), ['뷰티샵', '헤어샵']);
    assert.equal(labelRows.find((entry) => entry.words === '헤어샵').reason, labelReason.replace(/\.$/, ''));
    assert.match(labelRows.find((entry) => entry.words === '뷰티샵').reason, /업종 이름일 뿐/);
});

test('새 키워드 엔진: 한 낱말 가족에서 따로 추천한 품목의 note 는 5칸 "왜"에 그대로, "같은 낱말은 두 칸까지"와 겹치지 않는다', () => {
    const { input } = docOf(SALON);
    const reco = input.recommendation;
    const sheer = reco.items.find((item) => item.keyword === '강남역시스루댄디컷');
    assert.ok(sheer && sheer.reasons.some((reason) => reason.kind === 'note'));
    // 시스루댄디컷이 5칸(교체 칸)에 들어가게 점수를 올려 댄디컷과 함께 들어간 문서를 만든다
    const boosted = { ...reco, items: reco.items.map((item) => (item.keyword === '강남역시스루댄디컷' ? { ...item, score: 200, evidence: { ...item.evidence, points: 200 } } : item)).sort((a, b) => b.score - a.score) };
    const { doc } = docOf(SALON, { recommendation: boosted });
    const rows = sectionOf(doc, 'keywords').rows;
    const sheerRow = rows.find((row) => row.next === '강남역시스루댄디컷');
    assert.ok(sheerRow, '5칸에 들어간다');
    assert.match(sheerRow.why, /'댄디컷' 가운데 리뷰가 가장 많은 시술\.$/);
    assert.ok(rows.some((row) => row.next === '강남역댄디컷'), '댄디컷도 함께');
    // 낱말이 달라(댄디컷 ≠ 시스루댄디컷) "같은 낱말은 두 칸까지" 문장은 붙지 않고 note 한 줄만 있다
    assert.doesNotMatch(sheerRow.why, /두 번 들어갑니다|두 칸까지/);
    assert.equal((sheerRow.why.match(/가운데 리뷰가 가장 많은 시술/g) || []).length, 1);
});

test('직접 판단할 말: 앞의 3개만(추천이 정한 차례 = 화면과 같은 차례) 싣고 나머지는 "외 N개", 같은 까닭은 한 묶음, 이름표는 화면과 같은 말', () => {
    const norm = (text) => String(text).replace(/[\d,]+/g, 'N');
    for (const [name, sample] of [['음식점', RESTAURANT], ['미용실', SALON]]) {
        const { doc, input } = docOf(sample);
        const keywords = sectionOf(doc, 'keywords');
        const candidates = input.recommendation.candidates;
        // 후보는 음식점 7개·미용실 8개까지 늘어도 표에는 앞의 3개만, 나머지는 개수만
        assert.ok(candidates.length > JUDGE_SHOWN, `${name}: 후보 ${candidates.length}개`);
        assert.equal(JUDGE_SHOWN, 3);
        assert.deepEqual(keywords.judge.map((row) => row.keyword), candidates.map((entry) => entry.keyword), `${name}: judge 는 후보 전체를 추천 차례 그대로`);
        const shown = keywords.judgeGroups.flatMap((group) => group.items.map((item) => item.keyword));
        assert.deepEqual([...shown].sort(), keywords.judge.slice(0, JUDGE_SHOWN).map((row) => row.keyword).sort(), `${name}: 표에는 앞의 3개`);
        assert.equal(keywords.judgeMore, candidates.length - JUDGE_SHOWN, name);
        // 이름표(화면 LACKS_LABEL 과 같은 말)와 lib why
        for (const group of keywords.judgeGroups) {
            for (const item of group.items) {
                const entry = candidates.find((candidate) => candidate.keyword === item.keyword);
                assert.equal(item.tag, { menu: '품목 자료에 없음', voice: '리뷰·상위 매장에 없음', share: '리뷰 비중 낮음', data: '자료가 적음', family: '같은 낱말 두 칸 사용 중', long: '이름이 길어 지역 조합 불가' }[entry.lacks], `${name}: ${item.keyword}`);
            }
        }
        // 묶음의 까닭은 그 후보들의 lib why 그대로이고, 문장이 똑같은 것만 한 묶음이다(숫자만 다른 까닭은 줄마다 — 종이에 변수 N 을 쓰지 않는다)
        for (const group of keywords.judgeGroups) {
            const whys = group.items.map((item) => keywords.judge.find((row) => row.keyword === item.keyword).why);
            assert.equal(new Set(whys).size, 1, name);
            assert.equal(group.why, whys[0], name);
            assert.doesNotMatch(group.why, /\bN\b|왼쪽에 적은 숫자/, name);
        }
        assert.equal(new Set(keywords.judgeGroups.map((group) => group.why)).size, keywords.judgeGroups.length, `${name}: 같은 까닭은 한 묶음`);
        // 표 머리 설명은 추천과 분명히 구분하고, 화면을 보라는 말을 쓰지 않는다
        assert.equal(keywords.judgeNote, judgeNote(sample.place));
        assert.match(keywords.judgeNote, name === '미용실'
            ? /^추천은 아닙니다 — 매장\(시술·예약·결제\)와 손님\(리뷰·상위 매장\) 양쪽에서 모두 확인되지는 않은 말이라 5칸에 넣지 않았습니다\./
            : /^추천은 아닙니다 — 매장\(메뉴판·예약·결제\)와 손님\(리뷰·상위 매장\) 양쪽에서 모두 확인되지는 않은 말이라 5칸에 넣지 않았습니다\./);
        assert.doesNotMatch(keywords.judgeNote, /화면|가게/);
    }
    // 후보 수가 3개 이하면 "외 N개"는 0
    const restaurant = docOf(RESTAURANT);
    const few = { ...restaurant.input.recommendation, candidates: restaurant.input.recommendation.candidates.slice(0, 2) };
    const fewKeywords = sectionOf(docOf(RESTAURANT, { recommendation: few }).doc, 'keywords');
    assert.equal(fewKeywords.judgeMore, 0);
    assert.equal(fewKeywords.judge.length, 2);
    // 미용실: 앞의 3개(가일컷·가일펌·블랙 — 점수 → 리뷰 수 → 예약 수 차례)는 리뷰 횟수(424·254·176)만 다른 까닭이라 줄마다 그 숫자 그대로(N 없음)
    const salon = sectionOf(docOf(SALON).doc, 'keywords');
    assert.equal(salon.judgeGroups.length, JUDGE_SHOWN);
    assert.deepEqual(salon.judgeGroups.map((group) => group.why.match(/리뷰에 ([\d,]+)회 나왔지만/)?.[1]), ['424', '254', '176']);
    assert.equal(salon.judgeMore, 5);
    // 묶음 함수: 같은 까닭은 한 묶음, 숫자만 다르면 N 풀이
    assert.deepEqual(judgeGroups([{ keyword: 'a', basis: '1', points: 1, why: 'x' }, { keyword: 'b', basis: '2', points: 2, why: 'y' }, { keyword: 'c', basis: null, points: null, why: 'x' }]),
        [{ why: 'x', items: [{ keyword: 'a', tag: null, basis: '1', points: 1 }, { keyword: 'c', tag: null, basis: null, points: null }] }, { why: 'y', items: [{ keyword: 'b', tag: null, basis: '2', points: 2 }] }]);
    // 숫자만 다른 까닭은 묶지 않고 줄마다 그대로
    assert.deepEqual(judgeGroups([{ keyword: 'a', tag: '자료가 적음', basis: '리뷰 4회', points: 8, why: '리뷰에 4회 나왔지만 확인 못 함' }, { keyword: 'b', tag: '자료가 적음', basis: '리뷰 12회', points: 8, why: '리뷰에 12회 나왔지만 확인 못 함' }]),
        [{ why: '리뷰에 4회 나왔지만 확인 못 함', items: [{ keyword: 'a', tag: '자료가 적음', basis: '리뷰 4회', points: 8 }] }, { why: '리뷰에 12회 나왔지만 확인 못 함', items: [{ keyword: 'b', tag: '자료가 적음', basis: '리뷰 12회', points: 8 }] }]);
    const none = sectionOf(docOf(RESTAURANT, { recommendation: { ...restaurant.input.recommendation, candidates: [] } }).doc, 'keywords');
    assert.equal(none.judgeGroups, null);
    assert.equal(none.judgeMore, 0);
});

test('후보 이름표(lacks)는 화면과 같은 말이고, 값이 없으면 "자료가 적음", 모르는 값이면 이름표를 달지 않는다', () => {
    assert.deepEqual(LACKS_TAG, { menu: '품목 자료에 없음', voice: '리뷰·상위 매장에 없음', share: '리뷰 비중 낮음', data: '자료가 적음', family: '같은 낱말 두 칸 사용 중', long: '이름이 길어 지역 조합 불가' });
    assert.equal(lacksTag('family'), '같은 낱말 두 칸 사용 중');
    assert.equal(lacksTag('voice'), '리뷰·상위 매장에 없음');
    assert.equal(lacksTag('share'), '리뷰 비중 낮음');
    assert.equal(lacksTag(undefined), '자료가 적음');
    assert.equal(lacksTag(''), '자료가 적음');
    assert.equal(lacksTag('futureLacks'), null);
    // 모르는 값이어도 던지지 않고 그 후보는 이름표 없이 실린다
    const { input } = docOf(SALON);
    const odd = { ...input.recommendation, candidates: [{ ...input.recommendation.candidates[0], lacks: 'futureLacks' }] };
    const row = sectionOf(docOf(SALON, { recommendation: odd }).doc, 'keywords').judge[0];
    assert.equal(row.tag, null);
});

test('업종 말: 근거 앞머리의 "메뉴"는 그 업종의 낱말로(미용 시술·약국 취급 품목·서비스), 음식점은 그대로, 메뉴판·메뉴정보 같은 화면 이름은 그대로', () => {
    assert.equal(industryBasis('메뉴 열펌', SALON.place), '시술 열펌');
    assert.equal(industryBasis('리뷰 22회 · 메뉴 열펌 · 블로그 30/52', SALON.place), '리뷰 22회 · 시술 열펌 · 블로그 30/52');
    assert.equal(industryBasis('메뉴 열펌', PHARMACY.place), '취급 품목·서비스 열펌');
    assert.equal(industryBasis('메뉴 대방어 정식·대방어 숙성회', RESTAURANT.place), '메뉴 대방어 정식·대방어 숙성회');
    assert.equal(industryBasis('메뉴판 열펌 · 메뉴정보', SALON.place), '메뉴판 열펌 · 메뉴정보');
    assert.equal(industryBasis('', SALON.place), '');
    assert.equal(industryBasis('메뉴 열펌', null), '메뉴 열펌');
    // 문서: 미용실 직접 판단할 말의 '열펌' 후보 근거는 '시술 열펌'
    const keywords = sectionOf(docOf(SALON).doc, 'keywords');
    const perm = keywords.judge.find((row) => row.keyword === '강남역열펌');
    assert.equal(perm.basis, '시술 열펌');
});

/* ───────── 7차 채점 사소 10건 + 관찰 ───────── */

test('7차 1: 설명 초안 — 자료에 이미 쓴 설명이 있으면 그 문장을 본보기로, 없으면 "보기"(다른 매장의 예시·그대로 쓰지 마세요)를 분명히, 설명 있는 메뉴는 표에서 뺀다', () => {
    // 현재 자료(메뉴별 설명 글 없음): 보기 문장
    const sample = menuFrames(SALON.place);
    assert.equal(sample.model.kind, 'sample');
    assert.match(sample.model.text, /^다른 매장의 예시이며 이 매장의 사실이 아닙니다\. 그대로 쓰지 마세요\./);
    assert.doesNotMatch(sample.model.text, /\d/, '보기 문장에 지어낸 숫자가 없다(걸리는 시간 등은 ○)');
    // 메뉴별 설명 글이 자료에 오면(description): 이 매장이 이미 쓴 설명을 본보기로, 설명이 있는 메뉴는 표에서 뺀다
    const menus = SALON.place.detail.menus.map((menu, index) => ({ ...menu, description: index === 0 ? '샴푸와 커트가 포함된 기본 컷입니다. 걸리는 시간은 약 1시간입니다.' : '' }));
    const focus = [{ term: '다운펌' }];
    const withText = menuFrames({ ...SALON.place, menuDescribedCount: 1, detail: { ...SALON.place.detail, menus } }, { focus });
    assert.equal(withText.model.kind, 'own');
    assert.equal(withText.model.head, '이 매장이 이미 쓴 설명');
    assert.equal(withText.model.text, `‘${tidyMenuName(menus[0].name)} — ${menus[0].description}’ 처럼 쓰세요.`);
    assert.ok(!withText.rows.some((row) => row.name === tidyMenuName(menus[0].name)), '설명이 있는 시술은 표에 없다');
    assert.equal(withText.note, '이미 설명이 있는 시술은 표에서 뺐습니다.');
    // 긴 설명은 문장 가운데 단어를 자르지 않고 줄인다
    const longMenus = menus.map((menu, index) => (index === 0 ? { ...menu, description: `${'가나다라 '.repeat(30)}끝` } : menu));
    const cut = menuFrames({ ...SALON.place, menuDescribedCount: 1, detail: { ...SALON.place.detail, menus: longMenus } }, { focus });
    assert.match(cut.model.text, /…’ 처럼 쓰세요\.$/);
    // 모든 메뉴에 설명이 있으면 채울 표가 없다
    const all = menuFrames({ ...SALON.place, menuDescribedCount: menus.length, detail: { ...SALON.place.detail, menus: menus.map((menu) => ({ ...menu, description: '설명이 있습니다.' })) } }, { focus });
    assert.equal(all, null);
    // 화면에 그리는 필드: 처방 일의 draft 에 model·note 가 있다
    const draft = allTasks(docOf(SALON).doc).find((task) => task.key === 'menuDesc').draft;
    assert.equal(draft.model.kind, 'sample');
    assert.ok(draft.note);
    // 순서와 까닭: 등록 순서대로 채우는 시술은 숫자가 없다고 분명히 적는다
    assert.match(draft.rows.find((row) => row.name === '컷').why, /^등록한 시술\(예약·결제·리뷰 숫자가 없어 등록 순서대로\)$/);
});

test('7차 2: 병·의원 등록 처방 — 후보(등록 키워드의 진료 항목)가 있을 때만 "아래 후보는…"을 쓴다', () => {
    const { input } = docOf(CLINIC);
    const reco = input.recommendation;
    assert.deepEqual(registerNames(CLINIC.place, reco), ['임플란트', '충치치료']);
    // 지역이 든 키워드는 지역을 뗀 낱말, 업종 이름뿐인 낱말('치과')은 뺀다, 같은 낱말은 한 번만
    const place = { ...CLINIC.place, keywords: ['청주임플란트', '오창치과', '임플란트', '충치치료'] };
    const registered = [
        { keyword: '청주임플란트', hasRegion: true, core: '임플란트', regionStatus: 'known' },
        { keyword: '오창치과', hasRegion: true, core: '치과', regionStatus: 'known' },
        { keyword: '임플란트', hasRegion: false, regionStatus: 'unknown' },
        { keyword: '충치치료', hasRegion: false, regionStatus: 'unknown' },
    ];
    assert.deepEqual(registerNames(place, { ...reco, registered }), ['임플란트', '충치치료']);
    // 후보가 하나도 없으면 하는 법에 "아래 후보는…"이 없고 후보 상자도 없다
    const none = { ...CLINIC, place: { ...CLINIC.place, keywords: ['오창치과'] } };
    const noneReco = { ...reco, registered: [{ keyword: '오창치과', hasRegion: true, core: '치과', regionStatus: 'known' }] };
    const add = allTasks(docOf(none, { recommendation: noneReco }).doc).find((task) => task.key === 'menuAdd');
    assert.ok(add);
    assert.equal(add.draft, null);
    assert.ok(!add.steps.some((step) => /아래 후보는/.test(step)));
    assert.doesNotMatch(add.steps[0], /\(예:/);
    // 후보가 있으면 하는 법 3 과 후보 상자가 함께 있다
    const withNames = allTasks(docOf(CLINIC).doc).find((task) => task.key === 'menuAdd');
    assert.ok(withNames.draft && withNames.steps.some((step) => /^아래 후보는 /.test(step)));
    // 음식점·미용 같은 그 밖 업종은 지역이 없다고 확인된 칸만(지역을 확인 못 한 칸은 제외 — 예전 그대로)
    const food = { ...RESTAURANT.place, keywords: ['횟집', '압구정회식'] };
    const foodReco = { registered: [{ keyword: '횟집', hasRegion: false, regionStatus: 'none' }, { keyword: '압구정회식', hasRegion: false, regionStatus: 'unknown' }] };
    assert.deepEqual(registerNames(food, foodReco), ['횟집']);
});

test('7차 3: 쿠폰이 없는 업종(병·의원)의 AI 질문 이름은 1쪽과 D 가 같은 "결제 수단"', () => {
    const { doc } = docOf(CLINIC);
    const diag = doc.summary.diagnoses.find((entry) => entry.key === 'aiGap');
    assert.match(diag.text, /\(가격대·대표 진료 과목·서비스·결제 수단\)에 답할 정보가 없습니다\.$/);
    assert.doesNotMatch(diag.text, /쿠폰·혜택/);
    const question = sectionOf(doc, 'ai').questions.find((entry) => /결제/.test(entry.question));
    assert.match(question.fix, /^결제 수단\(카드·간편결제 등\)을 등록하세요\.$/);
});

test('7차 4: 종이에 변수 N 이 없다 — 직접 판단할 말은 숫자만 다른 까닭을 줄마다 그대로 적는다', () => {
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        const text = JSON.stringify(docOf(sample).doc);
        assert.doesNotMatch(text, /N은 왼쪽에 적은 숫자/, name);
    }
    assert.equal(judgeGroups([{ keyword: 'a', why: '리뷰에 4회' }, { keyword: 'b', why: '리뷰에 12회' }, { keyword: 'c', why: '리뷰에 4회' }]).length, 2);
});

test('7차 5: "지역 확인 못 함 — …"에서 같은 말을 두 번 하지 않는다', () => {
    const { doc } = docOf({ ...RESTAURANT, activity: null, ranks: [] }, { geo: null });
    const row = doc.summary.slots.rows.find((entry) => entry.action === 'check');
    assert.equal(row.reason, '지역 확인 못 함 — 지역이 들어 있는지 직접 확인하세요.');
    assert.equal((row.reason.match(/지역/g) || []).length, 2);
});

test('7차 7: 약국·병의원 문서의 "매장"은 업종 말(약국·병·의원)로, 매장 이름은 그대로, 음식점·미용실 문서는 그대로', () => {
    assert.equal(placeNoun(PHARMACY.place), '약국');
    assert.equal(placeNoun(CLINIC.place), '병·의원');
    assert.equal(placeNoun({ name: '댕댕동물병원', category: '동물병원' }), '병원');
    assert.equal(placeNoun(RESTAURANT.place), '매장');
    assert.equal(placeNoun(SALON.place), '매장');
    // 문서 안에 '매장'이 남지 않는다(경쟁 매장·내 매장·이 매장·매장 화면·매장 안내 …)
    for (const [name, sample, noun] of [['약국', PHARMACY, '약국'], ['병의원', CLINIC, '병·의원']]) {
        const text = JSON.stringify(docOf(sample).doc).replace(new RegExp(sample.place.name, 'g'), '');
        assert.doesNotMatch(text, /매장/, name);
        // 스마트플레이스 화면 문구(가게 주인 아이디·'+서비스 추가'·'우리 가게를 설명하는 단어')와 네이버 화면 이름만 '가게'로 남는다
        const rest = text.replace(/가게 주인 아이디|가게 이름|'\+서비스 추가'로 가게를|가게 화면에 '예약' 버튼|우리 가게를 설명하는 단어/g, '');
        assert.doesNotMatch(rest, /(?<![가-힣])가게/, name);
        assert.ok(text.includes(`${noun}의 응대`) || text.includes(`내 ${noun}`) || text.includes(`${noun} 화면`), name);
    }
    // 소식 초안의 "매장 안내" 도 업종 말
    const feed = allTasks(docOf(PHARMACY).doc).find((task) => task.key === 'feed').draft;
    assert.match(JSON.stringify(feed), /약국 안내/);
    // 음식점·미용실 문서는 '매장'이 그대로 있다
    assert.match(JSON.stringify(docOf(RESTAURANT).doc), /내 매장/);
    assert.match(JSON.stringify(docOf(SALON).doc), /매장/);
    // 매장 이름에 '매장'이 들어 있어도 이름은 건드리지 않는다
    const named = { ...PHARMACY, place: { ...PHARMACY.place, name: '메가 매장약국' } };
    const doc = docOf(named).doc;
    assert.equal(doc.store.name, '메가 매장약국');
    assert.ok(JSON.stringify(doc).includes('메가 매장약국'));
    assert.doesNotMatch(JSON.stringify(doc).replace(/메가 매장약국/g, ''), /매장/);
    // 직접 판단할 말 머리 설명도 업종 말
    // (약국·병의원에는 메뉴판이 없어 취급 품목·진료 과목)
    assert.match(sectionOf(docOf(PHARMACY).doc, 'keywords').judgeNote || judgeNote(PHARMACY.place), /^추천은 아닙니다 — 약국\(취급 품목·예약\)과 손님/);
    assert.match(judgeNote(CLINIC.place), /^추천은 아닙니다 — 병·의원\(진료 과목·예약\)과 손님/);
});

test('7차 8: 1쪽 "읽는 법"은 지우지 않고 한 줄로 줄여 남긴다(약국·미용실·병의원 1쪽에도 풀이가 있다)', () => {
    for (const [name, sample] of [['약국', PHARMACY], ['미용실', SALON], ['병의원', CLINIC]]) {
        const { doc } = docOf(sample);
        const legend = doc.summary.slots.legend;
        assert.ok(legend.length >= 1, `${name}: 읽는 법 줄이 있다`);
        assert.ok(legend.every((text) => text.includes(' = ')), name);
        if (doc.summary.slots.legendShort) assert.ok(`읽는 법 ${legend.join(' · ')}`.length <= 84, `${name}: 한 줄`);
        assert.ok(fitHeightMm(doc, doc.summary) <= PAGE1_BUDGET_MM, name);
    }
    // 짧은 풀이: 뜻은 그대로, 한 줄에 들어가는 앞쪽만(적어도 하나)
    const rows = [{ action: 'replace', reason: '내 3위 → 예약 214건 · 리뷰 299회 · 블로그 130/431 · 등록 키워드의 낱말' }];
    const full = pageOneLegend(rows, '시술');
    const short = pageOneLegend(rows, '시술', { short: true });
    assert.ok(full.length >= 3);
    assert.ok(short.length >= 1 && short.length <= full.length);
    assert.ok(`읽는 법 ${short.join(' · ')}`.length <= 84);
    assert.ok(short.every((text, index) => text.length <= full[index].length));
    assert.deepEqual(pageOneLegend([{ action: 'replace', reason: '내 3위 → 예약 5건' }], '시술', { short: true }), ['예약 N건 = 네이버 예약 수']);
    assert.deepEqual(pageOneLegend([{ action: 'keep', reason: '예약 5건' }], '시술', { short: true }), []);
});

test('7차 9: 예문 표에서 사실 문장을 못 만들면 "(직접 적기)"만 두지 않고 왜 못 만드는지 적는다 / 초안에 못 넣은 낱말은 까닭을 가른다', () => {
    const keywords = sectionOf(docOf(PHARMACY).doc, 'keywords');
    const blank = keywords.placements.find((row) => row.keyword === '청주동물약국');
    assert.equal(blank.sentence, null);
    // 왜 5칸에 권했는지(등록한 분류 이름을 손님 말로 바꾼 것)가 먼저, 예문을 못 만든 까닭이 "다만"으로 이어진다. 약국에는 메뉴판이 없어 취급 품목.
    assert.equal(blank.blankWhy, "등록한 '동물의약품'은 약·제품을 나누는 분류 이름이라, 5칸에는 손님이 쓰는 말 '동물약국'으로 바꿔 권했습니다. 다만 이 약국의 자료(취급 품목·예약·리뷰·등록 키워드)에서 '동물약국'을 한다는 사실을 확인하지 못해 예문은 만들지 않았습니다. 실제로 하면 넣을 자리에 직접 적으세요.");
    assert.doesNotMatch(blank.blankWhy, /메뉴판/);
    assert.ok(keywords.placements.filter((row) => row.sentence).every((row) => row.blankWhy === null));
    // 초안에 못 넣은 까닭: 메뉴판 이름에 낱말이 없을 때 / 있는데 자리가 모자랄 때
    const entry = { rule: 'offMain', term: '볼락구이', words: ['볼락구이'], reason: '주력이 아닌 곁들임입니다.', popular: { reviews: 9, posRank: 3 }, useIn: ['소식'] };
    assert.match(excludedReason(entry, { menuNamed: false }), /소식에 쓸 수 있습니다\(메뉴판의 메뉴 이름에서 그 낱말을 찾지 못해 이 문서의 초안에는 넣지 못했습니다\)\.$/);
    assert.match(excludedReason(entry, { menuNamed: true }), /소식에 쓸 수 있습니다\(이 문서의 초안에 담을 수 있는 수가 한정돼 넣지 못했습니다\)\.$/);
    assert.match(excludedReason(entry, { delivered: ['소식'] }), / 넣은 초안: 소식\.$/);
    // 실제 음식점 문서: 볼락구이는 메뉴판에 '대물뽈락구이'로 적혀 있어 같은 메뉴인지 확인하지 못했다고 사실대로 적는다(단정하지 않음)
    const row = sectionOf(docOf(RESTAURANT).doc, 'keywords').excluded.rows.find((entry) => entry.words === '볼락구이');
    assert.match(row.reason, /메뉴판에는 '대물뽈락구이'로 적혀 있어 같은 메뉴인지 확인하지 못해 이 문서의 초안에는 넣지 못했습니다/);
});

test('7차 10: 순위를 하나도 조회하지 않은 첫 분석은 "대표키워드 순위 조회하기"(약 5분)가 이번 주 첫 일이고 5칸 아래에 다음 행동 한 줄', () => {
    const first = docOf(RESTAURANT, { ranks: [] });
    const week = first.doc.summary.week.items;
    assert.equal(week[0].key, 'rankLookup');
    assert.equal(week[0].title, '대표키워드 순위 조회하기');
    assert.equal(week[0].timeLabel, '약 5분');
    assert.equal(week[0].where, '혼잘마 > 플레이스 분석 > 순위 조회');
    assert.equal(first.doc.summary.slots.rankText, RANK_MISSING_TEXT);
    assert.match(RANK_MISSING_TEXT, /^순위는 아직 조회하지 않았습니다\. 혼잘마 '플레이스 분석'에서 순위를 조회하면 5칸 제안이 더 정확해집니다\.$/);
    assert.equal(RANK_MISSING_HOW, "혼잘마 '플레이스 분석'에서 순위를 조회하면 5칸 제안이 더 정확해집니다.");
    const task = allTasks(first.doc).find((entry) => entry.key === 'rankLookup');
    assert.match(task.steps[0], /'순위 조회'를 누릅니다/);
    // 바꿀 칸이 있어 "아직 순위를 조회하지 않았습니다…" 문장이 이미 있으면 같은 말을 되풀이하지 않는다(약국·미용실 첫 분석)
    for (const sample of [PHARMACY, SALON]) {
        const doc = docOf(sample, { ranks: [] }).doc;
        assert.equal(doc.summary.week.items[0].key, 'rankLookup');
        // 바꿀 칸의 "…는 아직 순위를 조회하지 않았습니다" 문장 뒤에는 짧은 말만, 1쪽을 줄이느라 그 문장을 지웠으면 한 줄이 전체 뜻을 말한다
        const slots = doc.summary.slots;
        assert.equal(slots.rankText, slots.unranked.length ? RANK_MISSING_HOW : RANK_MISSING_TEXT);
        assert.ok(slots.unranked.length > 0 || !slots.unrankedText);
    }
    // 순위가 조회된 문서에는 없다
    for (const [name, sample] of SAMPLES) {
        const doc = docOf(sample).doc;
        assert.ok(!allTasks(doc).some((entry) => entry.key === 'rankLookup'), name);
        assert.equal(doc.summary.slots.rankText, '', name);
    }
    // 4주 실행표 1주차에도 맨 앞
    assert.equal(sectionOf(first.doc, 'plan').weeks[0].items[0].title, '대표키워드 순위 조회하기');
});

test('7차 관찰: 시술 설명은 등록한 것이 모두 표에 있으면 "모두에 설명을 채웁니다", 약국 머리말·리뷰 주의·쿠폰 문장은 출처 없는 단정을 하지 않는다', () => {
    const salon = allTasks(docOf(SALON).doc).find((task) => task.key === 'menuDesc');
    assert.ok(salon.steps.includes("등록한 시술 5개 모두에 설명을 채웁니다(표의 순서는 '고른 까닭' 칸 참고)."));
    assert.ok(MENU_FRAMES_MAX >= 5);
    const restaurant = allTasks(docOf(RESTAURANT).doc).find((task) => task.key === 'menuDesc');
    assert.ok(restaurant.steps.some((step) => /^등록한 메뉴 34개 가운데 아래 표의 메뉴부터 5개씩 채웁니다/.test(step)));
    // 전체 문서에 단정 문구가 없다
    for (const [name, sample] of [...SAMPLES, ['병의원', CLINIC], ['긴 견본', LONG]]) {
        const text = JSON.stringify(docOf(sample).doc);
        assert.doesNotMatch(text, /정책 위반|쓰는 곳이 있어|쿠폰 조건으로 걸지 않습니다/, name);
    }
    const coupon = allTasks(docOf(RESTAURANT).doc).find((task) => task.key === 'coupon');
    assert.ok(coupon.steps.includes('대상·혜택은 사장님이 정합니다. 별점·리뷰 문구를 쿠폰 조건으로 걸지 마세요(네이버 리뷰 운영 원칙에 어긋날 수 있습니다).'));
});

test('새 키워드 엔진: lacks family(같은 낱말을 이미 두 칸 써서 추천하지 못한 말)도 이름표와 까닭을 가진다', () => {
    const { input } = docOf(SALON);
    const reco = input.recommendation;
    const row = (lacks, why = '') => sectionOf(docOf(SALON, { recommendation: { ...reco, candidates: [{ ...reco.candidates[0], lacks, why }] } }).doc, 'keywords').judge[0];
    assert.equal(row('family').tag, '같은 낱말 두 칸 사용 중');
    assert.equal(row('family').why, JUDGE_WHY_FAMILY);
    assert.equal(row('family', 'lib 이 준 까닭입니다.').why, 'lib 이 준 까닭입니다.');
});

test('7차 8 보충: 화면이 실제 높이를 재어 1쪽을 줄여야 하면(예산을 줄인 재조정) 한 줄 풀이도 지우고, 아니면 남긴다', () => {
    const roomy = docOf(PHARMACY).doc.summary.slots;
    assert.ok(roomy.legend.length >= 1);
    const tight = docOf(PHARMACY, { page1Budget: 200 }).doc.summary.slots;
    assert.deepEqual(tight.legend, []);
    assert.equal(tight.legendShort, false);
});

test('7차 관찰: 긴 견본 1쪽 이번 주 할 일마다 설명 줄이 있다(이유가 길면 앞 조각으로 줄인다)', () => {
    const items = docOf(LONG).doc.summary.week.items;
    assert.ok(items.length >= 3);
    for (const task of items) assert.ok(task.why && task.why.length <= 34, `${task.title}: ${task.why}`);
    assert.equal(items[0].why, '압구정로데오숙성회모둠정식집 내 41위');
});

/* ───────── 키워드 최종 판(8차 마무리) 반영 ───────── */

test('키워드 최종 판: 약국 분류 이름 칸은 lib 이 준 손님 말 까닭(spoken.why)을 5칸 이유(C)에 먼저 적고, 없을 때만 하는 일 한 줄', () => {
    const { doc, input } = docOf(PHARMACY);
    const registered = new Map(input.recommendation.registered.map((entry) => [entry.keyword, entry]));
    const rows = sectionOf(doc, 'keywords').rows.filter((row) => row.now && registered.get(row.now)?.concern?.rule === 'classification');
    assert.ok(rows.length >= 3, `분류 이름 칸 ${rows.length}개`);
    for (const row of rows) {
        const entry = registered.get(row.now);
        assert.ok(entry.spoken?.why, row.now);
        assert.ok(row.why.startsWith(entry.spoken.why), `${row.now}: ${row.why}`);
        assert.match(row.why, /손님이 찾는 말인/, row.now);
    }
    // lib 이 까닭을 안 주면(옛 자료) 하는 일만 짧게
    const old = {
        ...input.recommendation,
        registered: input.recommendation.registered.map((entry) => (entry.spoken ? { ...entry, spoken: { ...entry.spoken, why: undefined } } : entry)),
    };
    const oldRows = sectionOf(docOf(PHARMACY, { recommendation: old }).doc, 'keywords').rows.filter((row) => row.now && registered.get(row.now)?.concern?.rule === 'classification');
    for (const row of oldRows) assert.match(row.why, /^'[^']+'(은|는) 약·제품을 나누는 분류 이름이라 지역을 붙인 '[^']+' 키워드로 바꿉니다\./, row.now);
});

test('키워드 최종 판: 뺀 키워드 표 — 메뉴판에 한 줄뿐이고 리뷰·결제 사실도 쓸 자리도 없는 낱말(board)은 둘 이상이면 한 줄로 묶고, 사실이 있는 줄은 그대로 둔다', () => {
    const { doc, input } = docOf(RESTAURANT);
    const excluded = input.recommendation.excluded;
    const lone = excluded.filter((entry) => entry.board === true && !entry.popular && !(entry.useIn || []).length && (entry.rule === 'otherBusiness' || entry.rule === 'offMain'));
    assert.ok(lone.length >= 2, `board 줄 ${lone.length}개`);
    const rows = sectionOf(doc, 'keywords').excluded.rows;
    const grouped = rows.filter((row) => row.label === '메뉴판에만 있는 품목');
    assert.equal(grouped.length, 1);
    for (const entry of lone) {
        const words = entry.words?.length ? entry.words : [entry.term];
        for (const word of words) assert.ok(grouped[0].words.split('·').includes(word), `${word} 가 묶음 줄에 있다`);
        // 묶인 낱말은 따로 한 줄을 갖지 않는다
        assert.ok(!rows.some((row) => row !== grouped[0] && row.words.split('·').includes(entry.term)), entry.term);
    }
    assert.match(grouped[0].reason, /^메뉴판에 한 줄뿐인 품목에서 나온 낱말/);
    // 리뷰·결제 사실이 있는 줄(칼국수·캐비아 …)은 그 사실과 함께 그대로 따로 있다
    assert.ok(rows.some((row) => /칼국수/.test(row.words) && /리뷰 언급 4회/.test(row.reason)));
    assert.ok(rows.some((row) => /해물돌판짜파게티/.test(row.words) && /주간 인기 메뉴 5위/.test(row.reason)));
    // 한 줄뿐이면 묶지 않고 그 낱말의 이유 그대로
    const one = { ...input.recommendation, excluded: excluded.filter((entry) => !lone.includes(entry) || entry.term === lone[0].term) };
    const oneRows = sectionOf(docOf(RESTAURANT, { recommendation: one }).doc, 'keywords').excluded.rows;
    assert.ok(!oneRows.some((row) => row.label === '메뉴판에만 있는 품목'));
    assert.ok(oneRows.some((row) => row.words === lone[0].term));
});

test('키워드 최종 판: 메뉴 설명 표는 낱말이 든 메뉴와 결제·예약·리뷰 인기 메뉴를 숫자가 큰 순서로 채운다(리뷰 몇 회짜리 낱말이 결제 인기 메뉴를 밀어내지 않음)', () => {
    const place = {
        name: '바다집',
        category: '횟집',
        menuCount: 6,
        menuDescribedCount: 1,
        detail: {
            menus: ['칼국수', '손만두', '해물짜파게티', '소금김밥', '광어회', '우럭회'].map((name) => ({ name, price: '10,000원' })),
            pos: { popularMenus: [{ name: '소금김밥', count: 276 }, { name: '해물짜파게티', count: 119 }] },
        },
        reviewMenus: [{ label: '칼국수', count: 4 }, { label: '김밥', count: 37 }],
    };
    // 칼국수(리뷰 4회)를 낱말로 알려 줘도 결제 인기 메뉴가 먼저
    const frames = menuFrames(place, { also: ['칼국수', '김밥'], focus: [] });
    const names = frames.rows.map((row) => row.name);
    assert.equal(names[0], '소금김밥');
    assert.ok(names.indexOf('해물짜파게티') >= 0 && names.indexOf('해물짜파게티') < names.indexOf('칼국수'), names.join(' / '));
    // 숫자가 같으면 낱말이 든 메뉴가 먼저(순서가 안정적)
    const again = menuFrames(place, { also: ['칼국수', '김밥'], focus: [] }).rows.map((row) => row.name);
    assert.deepEqual(again, names);
    // 5칸에 새로 넣는 낱말이 든 메뉴(focus)는 숫자와 상관없이 제일 앞
    const focused = menuFrames(place, { also: ['칼국수'], focus: [{ term: '우럭회' }] }).rows.map((row) => row.name);
    assert.equal(focused[0], '우럭회');
    assert.ok(focused.length <= MENU_FRAMES_MAX);
});

test('키워드 최종 판: 초안에 못 넣은 낱말이 메뉴판에 한 글자만 다른 이름(볼락구이 ↔ 대물뽈락구이)으로 있으면 같은 메뉴라고 단정하지 않고 사실대로 적는다', () => {
    const row = sectionOf(docOf(RESTAURANT).doc, 'keywords').excluded.rows.find((entry) => entry.words === '볼락구이');
    assert.ok(row, '볼락구이 줄');
    assert.match(row.reason, /\(메뉴판에는 '대물뽈락구이'로 적혀 있어 같은 메뉴인지 확인하지 못해 이 문서의 초안에는 넣지 못했습니다\)/);
    assert.doesNotMatch(row.reason, /같은 메뉴입니다|같은 메뉴로|메뉴판의 메뉴 이름에서 그 낱말을 찾지 못해/);
    const entry = { rule: 'offMain', term: '볼락구이', words: ['볼락구이'], why: '주력이 아닙니다.', useIn: ['메뉴 설명', '소식'], popular: { reviews: 9 } };
    assert.match(excludedReason(entry, { menuNamed: '대물뽈락구이' }), /메뉴판에는 '대물뽈락구이'로 적혀 있어/);
    assert.match(excludedReason(entry, { menuNamed: true }), /담을 수 있는 수가 한정돼/);
    assert.match(excludedReason(entry, { menuNamed: false }), /메뉴판의 메뉴 이름에서 그 낱말을 찾지 못해/);
    assert.match(excludedReason(entry), /메뉴판의 메뉴 이름에서 그 낱말을 찾지 못해/);
});

test('키워드 최종 판: 메뉴 description(조회 자료) — 글이 있으면 그 글을 본보기로·표에서 제외, null 이면 설명 없음이 확인된 것, 필드가 없으면 모름', () => {
    const base = SALON.place;
    const text = '샴푸와 커트가 포함된 기본 컷입니다.';
    const withNull = base.detail.menus.map((menu, index) => ({ ...menu, description: index === 0 ? text : null }));
    const known = menuFrames({ ...base, menuDescribedCount: 1, detail: { ...base.detail, menus: withNull } }, { focus: [{ term: '다운펌' }] });
    assert.equal(known.model.kind, 'own');
    assert.ok(known.model.text.includes(`— ${text}’`), '이 매장이 쓴 설명을 고치지 않고 그대로');
    assert.ok(!known.rows.some((row) => row.name === tidyMenuName(withNull[0].name)));
    assert.equal(known.note, '이미 설명이 있는 시술은 표에서 뺐습니다.');
    // 모든 메뉴의 description 이 null: 설명이 적힌 메뉴가 없다는 것이 확인된 것 → 모든 메뉴가 대상, 보기 문장, 그 사실을 한 줄로
    const none = menuFrames({ ...base, menuDescribedCount: 0, detail: { ...base.detail, menus: base.detail.menus.map((menu) => ({ ...menu, description: null })) } });
    assert.equal(none.model.kind, 'sample');
    assert.equal(none.note, '조회한 자료에서 설명이 적힌 시술은 찾지 못했습니다.');
    assert.ok(none.rows.length >= 1);
    // 읽어 온 메뉴(최대 40개)에는 설명 글이 하나도 없는데 설명 있는 메뉴가 있다고 조회됐으면(그 뒤 메뉴에만 있음) "찾지 못했다"고 하지 않고 모른다고 적는다
    const capped = menuFrames({ ...base, menuDescribedCount: 3, detail: { ...base.detail, menus: base.detail.menus.map((menu) => ({ ...menu, description: null })) } }, { focus: [{ term: '다운펌' }] });
    assert.equal(capped.note, '어느 것에 이미 설명이 있는지는 조회한 자료로 알 수 없어, 설명이 비어 있는 것만 채우세요.');
    assert.equal(capped.model.kind, 'sample');
    // 가족 pick note 의 새 꼴("'댄디컷'의 구체 메뉴(리뷰 827회)")도 미용 문서에서는 '구체 시술'로
    const { input } = docOf(SALON);
    const swapped = {
        ...input.recommendation,
        items: input.recommendation.items.map((item) => ({
            ...item,
            reasons: item.reasons.map((reason) => (reason.kind === 'note' && /가장 많은 (?:메뉴|시술)/.test(reason.text) ? { ...reason, text: "'댄디컷'의 구체 메뉴(리뷰 827회)" } : reason)),
        })),
    };
    const noteRows = sectionOf(docOf(SALON, { recommendation: swapped }).doc, 'keywords');
    const noteText = JSON.stringify(noteRows);
    assert.match(noteText, /'댄디컷'의 구체 시술\(리뷰 827회\)/);
    assert.doesNotMatch(noteText, /구체 메뉴/);
    // description 필드가 아예 없는 옛 자료: 어느 것에 설명이 있는지 모른다고 적는다
    const unknown = menuFrames({ ...base, menuDescribedCount: 0 });
    assert.equal(unknown.note, '어느 것에 이미 설명이 있는지는 조회한 자료로 알 수 없어, 설명이 비어 있는 것만 채우세요.');
});

/* ───────── 8차 채점 사소 5건 + 관찰 ───────── */

test('8차 1: 설명 초안의 "보기"는 ○○ 자리표시가 아니라 구체 낱말로 채운 다른 매장의 예시이고, 이 매장 메뉴 이름과 겹치는 예시는 고르지 않는다', () => {
    const textOf = (place) => menuFrames(place, { focus: [{ term: '다운펌' }] }).model.text;
    const lead = /^다른 매장의 예시이며 이 매장의 사실이 아닙니다\. 그대로 쓰지 마세요\. ‘/;
    // 미용: 이 매장에 '염색'이 있으면 뿌리염색은 건너뛰고, 없으면 뿌리염색
    const withDye = textOf(SALON.place);
    assert.match(withDye, lead);
    assert.match(withDye, /두피 스케일링/);
    assert.doesNotMatch(withDye, /뿌리염색/);
    const noDye = { ...SALON.place, detail: { ...SALON.place.detail, menus: SALON.place.detail.menus.filter((menu) => !/염색/.test(menu.name)) } };
    assert.match(textOf(noDye), /‘뿌리염색: 새로 자란 뿌리 부분만 염색합니다\. 샴푸와 드라이가 포함됩니다\.’$/);
    // 음식점: 이 매장 메뉴판에 고등어가 있으면 고등어구이 정식은 고르지 않는다
    const withMackerel = { ...RESTAURANT.place, detail: { ...RESTAURANT.place.detail, menus: [...RESTAURANT.place.detail.menus, { name: '고등어구이', price: '12,000원' }] } };
    assert.match(textOf(RESTAURANT.place), /고등어구이 정식: 고등어 한 마리와 밥·국·반찬이 함께 나옵니다\. 1인분입니다\./);
    assert.match(textOf(withMackerel), /된장찌개/);
    assert.doesNotMatch(textOf(withMackerel), /고등어/);
    // 예시에 걸리는 시간 같은 숫자와 자리표시는 없다
    for (const place of [RESTAURANT.place, SALON.place, noDye, withMackerel]) {
        const text = textOf(place);
        assert.doesNotMatch(text, /○/);
        assert.doesNotMatch(text, /\d+\s*(분|시간)|약\s*\d/);
    }
    // 예시를 모두 쓸 수 없으면(모든 예시가 이 매장 메뉴와 겹침) 자리표시 문장
    const all = { ...RESTAURANT.place, menuDescribedCount: 0, detail: { ...RESTAURANT.place.detail, menus: ['고등어구이', '된장찌개', '부추전'].map((name) => ({ name, price: '9,000원' })) } };
    assert.match(textOf(all), /‘○○: ○○가 포함됩니다\. 이용 방법은 ○○입니다\.’$/);
    // 문서에서도 같다
    const draft = allTasks(docOf(RESTAURANT).doc).find((task) => task.key === 'menuDesc').draft;
    assert.doesNotMatch(draft.model.text, /○/);
});

test('8차 2: 업종 말 — 약국·병의원 문서에 "내 매장"·메뉴판이 남지 않고, 미용실은 시술·예약·결제', () => {
    for (const [name, sample, noun] of [['약국', PHARMACY, '약국'], ['병의원', CLINIC, '병·의원']]) {
        const doc = docOf(sample).doc;
        const rivals = sectionOf(doc, 'rivals');
        assert.equal(rivals.noun, noun, name);
        const text = JSON.stringify(doc);
        assert.doesNotMatch(text.replace(new RegExp(String(sample.place.name).replace(/[()]/g, '\\$&'), 'g'), ''), /내 매장|이 매장의|매장\(|손님이 매장/, name);
        assert.doesNotMatch(text, /(약국|병·의원|병원)의 자료\(메뉴판|(약국|병·의원|병원)\(메뉴판/, name);
    }
    assert.equal(sectionOf(docOf(RESTAURANT).doc, 'rivals').noun, '매장');
    assert.equal(sectionOf(docOf(SALON).doc, 'rivals').noun, '매장');
    // 예문을 못 만든 까닭에 쓰는 자료 이름: 약국·병의원 취급 품목/진료 과목, 미용 시술, 음식점 메뉴판
    assert.match(blankWhyText(PHARMACY.place, '동물약국'), /^이 매장의 자료\(취급 품목·예약·리뷰·등록 키워드\)에서 '동물약국'을/);
    assert.match(blankWhyText(CLINIC.place, '야간진료'), /^이 매장의 자료\(진료 과목·예약·리뷰·등록 키워드\)에서 '야간진료'를/);
    assert.match(blankWhyText(SALON.place, '펌'), /^이 매장의 자료\(시술·예약·리뷰·등록 키워드\)에서/);
    assert.match(blankWhyText(RESTAURANT.place, '숙성회'), /^이 매장의 자료\(메뉴판·예약·리뷰·등록 키워드\)에서/);
    assert.equal(judgeSources(SALON.place).text, '시술·예약·결제');
    assert.equal(judgeSources(RESTAURANT.place).text, '메뉴판·예약·결제');
});

test('8차 3: "순위 먼저 조회하기" 제목에 "먼저"가 겹치지 않는다(1쪽 ②·4주 실행표·B 처방 모두 같은 제목)', () => {
    const first = docOf(RESTAURANT, { ranks: [] }).doc;
    const task = allTasks(first).find((entry) => entry.key === 'rankLookup');
    assert.equal(task.title, '대표키워드 순위 조회하기');
    assert.equal(first.summary.week.items[0].title, task.title);
    assert.equal(task.levelLabel, '먼저');
    assert.doesNotMatch(JSON.stringify(first), /먼저 대표키워드 순위 먼저|순위 먼저 조회하기/);
});

test('8차 4: 병·의원·동물병원 AI 질문 표의 예시는 등록 키워드의 진료 항목이고, 항목의 종류를 되풀이하는 말("진료 과목·검진·예약 방법")이 없다', () => {
    const doc = docOf(CLINIC).doc;
    const text = JSON.stringify(doc);
    assert.doesNotMatch(text, /진료 과목·검진·예약 방법/);
    assert.ok((text.match(/\(예: 임플란트·충치치료\)/g) || []).length >= 2, '4쪽 등록 처방과 D 표가 같은 예시');
    // 등록한 진료 항목이 없으면 예를 빼고(문장이 어색하지 않게) 되풀이하는 예도 쓰지 않는다
    const none = { ...CLINIC, place: { ...CLINIC.place, keywords: ['오창치과'] } };
    const noneText = JSON.stringify(docOf(none).doc);
    assert.doesNotMatch(noneText, /진료 과목·검진·예약 방법/);
    assert.doesNotMatch(noneText, /\(예: \)|\(예:\)/);
    // 약국의 예(영양제·복약지도·약 상담)는 항목 이름이라 그대로
    assert.match(JSON.stringify(docOf(PHARMACY).doc), /영양제·복약지도·약 상담|영양제/);
});

test('8차 5: 뺀 키워드 표 — 낱말이 많은 줄은 좁은 칸에 쌓지 않고 "첫 낱말 외 N개"로 줄이고 전부는 이유 칸에 가로로 적는다', () => {
    const rows = sectionOf(docOf(RESTAURANT).doc, 'keywords').excluded.rows;
    const many = rows.filter((row) => row.words.split('·').length >= 5);
    assert.ok(many.length >= 1, '낱말이 5개 이상인 줄');
    for (const row of many) {
        assert.equal(row.wide, true, row.words);
        const names = row.words.split('·');
        assert.equal(row.short, `${names[0]} 외 ${names.length - 1}개`, row.words);
    }
    // 메뉴판에만 있는 품목 묶음 줄은 낱말이 적어도 가로로
    const group = rows.find((row) => row.label === '메뉴판에만 있는 품목');
    assert.equal(group.wide, true);
    assert.match(group.short, /^\S+ 외 \d+개$/);
    // 낱말이 적은 줄은 그대로(wide 없음)
    const few = rows.filter((row) => row.words.split('·').length < 5 && row !== group && !/ 외 \d+개$/.test(row.words) && !row.words.includes(' · '));
    assert.ok(few.length >= 3);
    for (const row of few) assert.equal(row.wide, undefined, row.words);
    // 지역만 바꾼 조합이 넷 이상이면 그 줄도 가로로
    const combo = sectionOf(docOf(PHARMACY).doc, 'keywords').excluded.rows.find((row) => row.label === '지역만 바꿈');
    assert.equal(combo.wide, true);
    assert.match(combo.short, /^\S+ 외 \d+개$/);
    // 넓은 칸에는 조합을 전부 적고(7개), 좁은 칸의 "외 N개"와 개수가 맞는다
    const comboNames = combo.words.split(' · ');
    assert.equal(comboNames.length, 7, combo.words);
    assert.ok(!/ 외 \d+개/.test(combo.words), combo.words);
    assert.equal(combo.short, `${comboNames[0]} 외 ${comboNames.length - 1}개`);
});

test('8차 관찰: 예문을 못 만든 낱말은 왜 5칸에 권했는지가 먼저, 예문을 못 만든 까닭이 "다만"으로 이어진다(분류 이름 바꿈·근거 있는 후보)', () => {
    const pharmacy = sectionOf(docOf(PHARMACY).doc, 'keywords').placements.find((row) => row.keyword === '청주동물약국');
    assert.match(pharmacy.blankWhy, /^등록한 '동물의약품'은 약·제품을 나누는 분류 이름이라, 5칸에는 손님이 쓰는 말 '동물약국'으로 바꿔 권했습니다\. 다만 /);
    assert.match(pharmacy.blankWhy, / 다만 이 약국의 자료\(취급 품목·예약·리뷰·등록 키워드\)에서 '동물약국'을 한다는 사실을 확인하지 못해 예문은 만들지 않았습니다\./);
    // 근거로 권한 칸(분류 이름이 아닌 칸)은 그 근거를 먼저
    const reco = (sample) => docOf(sample).doc;
    for (const sample of [PHARMACY, CLINIC, RESTAURANT, SALON]) {
        for (const row of sectionOf(reco(sample), 'keywords').placements.filter((entry) => entry.blankWhy)) {
            assert.match(row.blankWhy, /5칸에는 .*권했습니다\. 다만 .*예문은 만들지 않았습니다\./, row.keyword);
        }
    }
});

test('8차 관찰: 이미 쓴 설명 본보기는 광고성 표현(최고·1등 등)이 든 글을 쓰지 않는다(다른 설명을 고르고, 모두 그렇면 보기 문장)', () => {
    const base = SALON.place;
    const menus = (descriptions) => base.detail.menus.map((menu, index) => ({ ...menu, description: descriptions[index] ?? null }));
    const place = (descriptions) => ({ ...base, menuDescribedCount: descriptions.filter(Boolean).length, detail: { ...base.detail, menus: menus(descriptions) } });
    const focus = [{ term: '열펌' }];
    const brag = '우리 동네 최고 1등 시술입니다.';
    const clean = '샴푸와 커트가 포함된 기본 컷입니다.';
    const picked = menuFrames(place([brag, clean]), { focus });
    assert.equal(picked.model.kind, 'own');
    assert.ok(picked.model.text.includes(clean));
    assert.ok(!picked.model.text.includes('최고'));
    const onlyBrag = menuFrames(place([brag]), { focus });
    assert.equal(onlyBrag.model.kind, 'sample');
    // 자랑 글이 있는 메뉴도 이미 설명이 있는 메뉴라 표에서는 뺀다
    assert.equal(onlyBrag.note, '이미 설명이 있는 시술은 표에서 뺐습니다.');
    assert.ok(!onlyBrag.rows.some((row) => row.name === tidyMenuName(base.detail.menus[0].name)));
});

test('10차 키워드: lacks long(지역을 붙이면 대표키워드 15자를 넘는 영어 이름)은 이름표와 까닭을 가지고, 모르는 값이 아니다', () => {
    const { input } = docOf(SALON);
    const reco = input.recommendation;
    const row = (lacks, why = '') => sectionOf(docOf(SALON, { recommendation: { ...reco, candidates: [{ ...reco.candidates[0], lacks, why }] } }).doc, 'keywords').judge[0];
    assert.equal(row('long').tag, '이름이 길어 지역 조합 불가');
    assert.equal(lacksTag('long'), '이름이 길어 지역 조합 불가');
    assert.equal(row('long').why, JUDGE_WHY_LONG);
    const libWhy = '이름이 15자보다 길어 대표키워드로 쓸 수 없어 추천에 넣지 않았습니다. 줄여 쓸 이름이 있는지 직접 판단하세요.';
    assert.equal(row('long', libWhy).why, libWhy);
    assert.match(JUDGE_WHY_LONG, /^이름이 길어 지역을 붙이면 대표키워드 글자 수\(15자\)를 넘어/);
});

test('10차 키워드: board 줄이 모두 words(묶인 낱말 전체)를 가져도 뺀 표의 묶음 줄은 그 낱말을 그대로 적고, 리뷰·결제 사실이 있는 줄은 따로 둔다', () => {
    const { doc, input } = docOf(RESTAURANT);
    const rows = sectionOf(doc, 'keywords').excluded.rows;
    const group = rows.find((row) => row.label === '메뉴판에만 있는 품목');
    if (group) {
        const names = group.words.split('·');
        // 묶음에 든 낱말은 board 이고 리뷰·결제 사실(popular)·쓸 자리(useIn)가 없는 줄의 낱말이다
        for (const name of names) {
            const entry = input.recommendation.excluded.find((candidate) => candidate.board === true && (candidate.words?.includes(name) || candidate.term === name));
            assert.ok(entry, name);
            assert.ok(!entry.popular && !(entry.useIn || []).length, `${name}: 사실이 있는 줄은 묶지 않는다`);
        }
    }
    // 사실이 있는 줄의 낱말은 묶음에 없다
    const factual = input.recommendation.excluded.filter((entry) => entry.board === true && (entry.popular || (entry.useIn || []).length));
    for (const entry of factual) {
        for (const name of entry.words?.length ? entry.words : [entry.term]) assert.ok(!group || !group.words.split('·').includes(name), name);
    }
});

test('10차 키워드: 뺀 키워드 표에서 구분과 이유 문장이 똑같은 줄(같은 까닭으로 빠진 낱말들)은 한 줄로 합쳐 낱말만 이어 적는다', () => {
    for (const [name, sample] of [['음식점', RESTAURANT], ['긴 견본', LONG], ['미용실', SALON], ['약국', PHARMACY]]) {
        const rows = sectionOf(docOf(sample).doc, 'keywords').excluded.rows;
        const seen = new Set();
        for (const row of rows) {
            const key = `${row.label}|${row.reason}`;
            assert.ok(!seen.has(key), `${name}: 같은 까닭이 두 줄 — ${row.label} ${row.words}`);
            seen.add(key);
        }
    }
    // 합친 줄: 이유의 "이 낱말은"이 "이 낱말들은"으로, 낱말이 5개 이상이면 좁은 칸에는 "첫 낱말 외 N개"
    const { input } = docOf(RESTAURANT);
    const same = input.recommendation.excluded.filter((entry) => entry.rule === 'offMain' && !entry.popular && (entry.useIn || []).length && entry.board === true);
    if (same.length >= 2) {
        const rows = sectionOf(docOf(RESTAURANT).doc, 'keywords').excluded.rows;
        const merged = rows.find((row) => same.every((entry) => (entry.words?.length ? entry.words : [entry.term]).every((word) => row.words.split('·').includes(word))));
        assert.ok(merged, '같은 까닭의 낱말들이 한 줄에');
        assert.doesNotMatch(merged.reason, /이 낱말은/);
        assert.match(merged.reason, /이 낱말들은/);
    }
});
