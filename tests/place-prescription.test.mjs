import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPrescription, splitAdvice, fillStatus, prescriptionFileName, dateStamp, dateTimeLabel, dayLabel, minutesLabel, ranksText,
    slotProposal, pickDiagnoses, rivalComparison, TASK_INFO, DIAGNOSIS_MIN_SCORE, METRICS_MIN, METRICS_MAX, DRAFT_MARK,
    estimatePage1Mm, PAGE1_BUDGET_MM, REVIEW_ASK_CAUTION,
} from '../lib/place-prescription.js';
import {
    INVENTED_WORDS, draftProblems, replyDrafts, feedDrafts, introDraft, menuFrames, keywordPlacements, popularItems, notMainTerms,
} from '../lib/place-prescription-drafts.js';
import { LONG } from './place-prescription.fixtures.mjs';
import { buildActionItems } from '../lib/naver-place.js';
import { recommendKeywords } from '../lib/place-keywords.js';
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
        assert.ok(doc.notes.some((note) => note.includes('초안 문안은 매장 정보로 자동으로 만든 것입니다. 사실과 다르면 고쳐 쓰세요.')));
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
    const restaurant = docOf(RESTAURANT).doc.summary.diagnoses;
    assert.equal(restaurant[0].text, '강남구청 키워드는 3·5·12위인데 압구정 키워드는 41위·300위 밖입니다.');
    assert.equal(restaurant[0].basis, '대표키워드 2칸이 순위가 낮은 지역(압구정)에 쓰이고 있습니다.');
    assert.equal(restaurant[1].text, '사장님 답글률 40%: 최근 리뷰 50개 중 30개에 답글이 없습니다.');
    assert.equal(restaurant[2].text, '소식 46일째 없음: 마지막 소식은 "대방어 입고 안내"입니다.');
    const pharmacy = docOf(PHARMACY).doc.summary.diagnoses;
    assert.equal(pharmacy[2].basis, "지역을 붙인 '청주약국'은 내 6위, '오창약국'은 내 2위입니다.");
    assert.equal(docOf(SALON).doc.summary.diagnoses[1].text, '대표키워드 강남역미용실은 18위로 10위 밖입니다.');
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
    assert.deepEqual(week.items.map((task) => task.key), ['keywords', 'feed', 'reply']);
    for (const task of week.items) {
        assert.equal(task.minutes, TASK_INFO[task.key].minutes);
        assert.equal(task.where, TASK_INFO[task.key].where);
    }
    assert.equal(week.totalLabel, '약 1시간');
    assert.equal(week.items[0].title, '대표키워드 2칸 고치기');
    assert.equal(week.items[0].why, '압구정횟집 내 41위 · 압구정회식 300위 밖.');
    assert.equal(week.items[2].title, '답글 없는 리뷰 30개에 답글 달기');

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

test('5칸 최종안: 지역 있고 30위 안이면 유지, 순위 낮은 지역은 다른 지역의 추천 키워드로 교체', () => {
    const rows = docOf(RESTAURANT).doc.summary.slots.rows;
    assert.deepEqual(rows.map((row) => [row.now, row.action, row.next]), [
        ['강남구청횟집', 'keep', '강남구청횟집'], ['강남구청점심', 'keep', '강남구청점심'], ['강남구청회식', 'keep', '강남구청회식'],
        ['압구정횟집', 'replace', '강남횟집'], ['압구정회식', 'replace', '논현횟집'],
    ]);
    assert.ok(rows.every((row) => !/압구정/.test(row.next) || row.action === 'keep'));
    assert.deepEqual(docOf(RESTAURANT).doc.summary.slots.unranked, ['강남횟집', '논현횟집']);
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

test('5칸 최종안: 지역 없는 키워드는 지역을 붙인 조합으로(미용실), 10위 밖이라도 30위 안이면 유지', () => {
    const rows = docOf(SALON).doc.summary.slots.rows;
    assert.deepEqual(rows.map((row) => [row.now, row.action, row.next]), [
        ['강남역미용실', 'keep', '강남역미용실'], ['볼륨매직', 'replace', '강남역볼륨매직'], ['댄디컷', 'replace', '강남역댄디컷'],
        ['다운펌', 'replace', '강남역다운펌'], ['가르마펌', 'replace', '강남역가르마펌'],
    ]);
    assert.equal(rows[0].reason, '내 18위 — 30위 안이라 유지');
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
    assert.equal(pharmacy.headline[0], '오창약국 1위 매장(건강약국)의 방문자 리뷰는 1,966개, 내 매장은 58개입니다.');
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
    assert.equal(metrics[3].compare, '강남구청횟집 1~2위 매장 2곳 중간값 1,400개');
    assert.equal(metrics[2].compare, null, '비교할 자료가 없으면 비운다');
});

/* ───────── 초안 ───────── */

test('초안: 세 견본 모두 지어낸 할인·이벤트·효능·과장 표현이 없고 정책 점검을 통과한다', () => {
    for (const [name, sample] of SAMPLES) {
        const { doc, input } = docOf(sample);
        const texts = draftTexts(doc);
        assert.ok(texts.length >= 2, name);
        for (const text of texts) {
            assert.deepEqual(draftProblems(text, input.place), [], `${name}: ${text}`);
            for (const word of INVENTED_WORDS) assert.ok(!text.includes(word), `${name}: '${word}' — ${text}`);
        }
    }
});

test('초안: 처방 상세의 초안마다 고쳐 쓰라는 표시가 붙는다', () => {
    assert.equal(DRAFT_MARK, '초안 — 우리 매장 사실에 맞게 고쳐 쓰세요');
    const tasks = sectionOf(docOf(RESTAURANT).doc, 'tasks');
    assert.ok(tasks.lead.includes(DRAFT_MARK));
    assert.deepEqual(tasks.items.filter((task) => task.draft).map((task) => task.draft.kind), ['feed', 'reply', 'menu']);
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
    for (const [name, sample] of SAMPLES) {
        for (const text of draftTexts(docOf(sample).doc)) {
            assert.doesNotMatch(text, /결제|방문자 리뷰 [\d,]+개|블로그 \d+\/\d+|\d+점|평가가 가장 많|GEO|AEO|\d+명/, `${name}: ${text}`);
        }
    }
});

test('대표 메뉴는 키워드 처방이 주력이 아니라고 뺀 낱말·술·음료를 앞세우지 않는다', () => {
    const { input } = docOf(RESTAURANT);
    const notMain = notMainTerms(input.recommendation);
    assert.ok(notMain.includes('김밥') && notMain.includes('볼락구이'));
    const popular = popularItems(RESTAURANT.place, 3, { notMain });
    // 결제 많은 메뉴(소금김밥·생맥주·볼락구이·갈치조림)는 빠지고 하나만 남아, 2개 이상 남는 리뷰 언급(가장 많은 것의 1/3 이상)을 고른다
    assert.equal(popular.source, 'review');
    assert.deepEqual(popular.items.map((entry) => entry.name), ['광어', '모듬숙성회']);
});

test('소식 초안: 메뉴 이름·가격은 메뉴판 그대로, 할인 없이 사실만', () => {
    const { input } = docOf(RESTAURANT);
    const feed = feedDrafts(RESTAURANT.place, { question: '강남구청역 한식 추천', nowMs: NOW, recommendation: input.recommendation });
    assert.equal(feed.items[0].title, '강남구청역 한식 대물섬 강남점 — 11월 메뉴·영업 안내');
    assert.ok(feed.items[0].body.startsWith('손님 리뷰에 자주 나오는 메뉴는 광어, 모듬숙성회(91,000원)입니다.'));
    const menus = new Map(RESTAURANT.place.detail.menus.map((menu) => [menu.name, menu.price]));
    const limited = [...feed.items[1].body.matchAll(/(\(한정\)[^,(]*(?:\([^)]*\))?[^,(]*)\(([\d,]+원)\)/g)];
    assert.equal(limited.length, 3);
    for (const [, name, price] of limited) assert.equal(menus.get(name.trim()), price, name);
    assert.equal(feed.items[1].key, 'limited');
    assert.equal(feed.altTitle, '강남구청역 한식 추천? 대물섬 강남점 광어·위치·영업시간 안내');
    // 메뉴가 없는 약국: 영업시간·매장 안내만
    const pharmacy = feedDrafts(PHARMACY.place, { nowMs: NOW });
    assert.equal(pharmacy.items.length, 1);
    assert.equal(pharmacy.items[0].body, '영업시간은 매일 09:30~21:00입니다. 매장 안내: 무료 주차 · 단체 이용 가능. (새 메뉴·서비스·휴무가 있으면 날짜·가격과 함께 한 줄 — 직접 적기)');
});

test('소개글 초안: 3~5문장, 손님이 고르는 데 도움이 되는 사실을 손님 말투로', () => {
    const salon = introDraft(SALON.place, SALON.activity);
    assert.ok(salon.sentences >= 3 && salon.sentences <= 5);
    assert.equal(salon.text, [
        '제이디로얄 맨즈헤어 강남점은 서울 강남구 강남대로96길 12 2층에 있는 남성전문미용실입니다.',
        '강남역 11번 출구에서 걸어서 3분이고, 주차할 수 있습니다.',
        '영업시간은 매일 10:30~19:30입니다.',
        '요즘 예약이 많은 시술은 댄디컷, 다운펌, 쉐도우펌입니다.',
        "손님 리뷰에서 많이 꼽힌 점은 '원하는 스타일로 잘해줘요', '시술이 꼼꼼해요', '친절해요'입니다.",
    ].join(' '));
    assert.equal(salon.oneLine, '강남역 댄디컷·다운펌 남성전문미용실');
    // 약국: 다루는 것(지역 없는 대표키워드)을 '취급' 수준으로, 효능 표현·조건형 문장 없이
    const { input } = docOf(PHARMACY);
    const pharmacy = introDraft(PHARMACY.place, PHARMACY.activity, { recommendation: input.recommendation });
    assert.ok(pharmacy.sentences >= 3 && pharmacy.sentences <= 5);
    assert.ok(pharmacy.text.includes('일반의약품·건강기능식품·동물의약품·상비약을 취급합니다.'));
    assert.ok(pharmacy.text.includes('무료로 주차할 수 있습니다.'));
    assert.doesNotMatch(pharmacy.text, /단체 이용 가능 조건|효과|효능|좋아지/);
    // 사실이 3문장도 안 되는 매장은 초안을 만들지 않는다
    assert.equal(introDraft({ name: '이름만', category: '한식' }), null);
});

test('AI 검색 준비: 리뷰를 더 받는 일에는 리뷰 정책 주의를 붙인다', () => {
    const ai = sectionOf(docOf(PHARMACY).doc, 'ai');
    const more = ai.more.find((item) => item.id === 'reviewsMore');
    assert.equal(more.caution, REVIEW_ASK_CAUTION);
    assert.match(REVIEW_ASK_CAUTION, /리뷰를 조건으로 할인·서비스를 주거나 별점·문구를 정해 주면 정책 위반입니다/);
    assert.ok(ai.more.filter((item) => item.id !== 'reviewsMore').every((item) => item.caution === null));
});

/* ───────── 1쪽을 한 쪽 안에 ───────── */

test('1쪽 맞추기: 긴 매장 이름·키워드·소식 제목에서도 어림 높이가 예산 안이고, 말줄임 없이 조각 단위로 줄인다', () => {
    const { doc } = docOf(LONG);
    assert.ok(estimatePage1Mm(doc, doc.summary) <= PAGE1_BUDGET_MM, `${estimatePage1Mm(doc, doc.summary)}mm`);
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
        assert.ok(estimatePage1Mm(normal, normal.summary) <= PAGE1_BUDGET_MM, name);
    }
});

test('1쪽 맞추기: 빼는 순서는 지표 5번째 줄 → 5칸 아래 안내 → 지표 메모 → 진단 덧붙임 → 지표 4번째 줄', () => {
    const { doc } = docOf(RESTAURANT);
    const raw = docOf(RESTAURANT, { fitPage1: false }).doc;
    assert.equal(raw.summary.metrics.length, 5);
    assert.equal(doc.summary.metrics.length, 4);
    // 그 다음 단계(5칸 아래 안내·진단 덧붙임)는 필요 없어 그대로 남는다
    assert.deepEqual(doc.summary.slots.unranked, raw.summary.slots.unranked);
    assert.equal(doc.summary.diagnoses[0].basis, raw.summary.diagnoses[0].basis);
    // 약국: 진단 덧붙임('지역을 붙인 청주약국은 내 6위…')을 남긴다
    assert.ok(docOf(PHARMACY).doc.summary.diagnoses[2].basis);
});

test('메뉴 설명 틀: 이름·가격에서 읽히는 양·구성만 채우고 나머지는 직접 적기', () => {
    const restaurant = menuFrames(RESTAURANT.place);
    assert.deepEqual(restaurant.rows.map((row) => row.name), ['소금김밥', '해물돌판짜파게티', '1% 대광어 숙성회']);
    assert.equal(menuFrames({ ...RESTAURANT.place, detail: { ...RESTAURANT.place.detail, menus: [{ name: '맛보기보쌈(100g)', price: '15,000원' }] }, menuDescribedCount: 0 }).rows[0].frame,
        '재료 (직접 적기) · 양 100g');
    const salon = menuFrames(SALON.place);
    assert.equal(salon.rows.length, 5, '설명 있는 시술이 하나도 없으면 등록한 시술 모두');
    assert.equal(salon.rows.find((row) => row.name === '컷+다운펌').frame, '구성 컷 + 다운펌 · 걸리는 시간 (직접 적기)');
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
    // 순위를 모르면 지역 있는 키워드는 유지("순위 아직 조회 안 함")
    assert.ok(doc.summary.slots.rows.every((row) => row.action === 'keep'));
    assert.ok(!doc.notes.some((note) => /순위는|답글률|GEO/.test(note)));
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
