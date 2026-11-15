// 플레이스 진단 규칙 검증 — 완료 개수, 할 일 목록, 대표키워드 점검, 하락 진단, 저장값 정리.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    OFFICIAL_ITEMS,
    EXTRA_ITEMS,
    INDUSTRIES,
    DIAGNOSE_QUESTIONS,
    FACTORS,
    SOURCES,
    KEYWORD_MAX,
    summarizeChecklist,
    buildTodos,
    getItemGuide,
    parseKeywordInput,
    checkKeywords,
    diagnose,
    normalizeState,
    defaultState,
} from '../lib/place-check.js';

const allChecked = () => Object.fromEntries(OFFICIAL_ITEMS.map((i) => [i.id, true]));

test('공식 항목은 정확히 10개이고 id가 겹치지 않는다', () => {
    assert.equal(OFFICIAL_ITEMS.length, 10);
    assert.equal(new Set(OFFICIAL_ITEMS.map((i) => i.id)).size, 10);
    assert.deepEqual(
        OFFICIAL_ITEMS.map((i) => i.label),
        ['업체명', '업종', '대표키워드', '전화번호', '주소', '홈페이지·SNS', '찾아오는 길', '가격·메뉴', '사진', '영업시간'],
    );
});

test('완료 개수: 아무것도 안 했으면 0개, 10개 모두 했으면 complete', () => {
    const none = summarizeChecklist({ checked: {} });
    assert.equal(none.done, 0);
    assert.equal(none.total, 10);
    assert.equal(none.remaining.length, 10);
    assert.equal(none.complete, false);

    const all = summarizeChecklist({ checked: allChecked() });
    assert.equal(all.done, 10);
    assert.equal(all.remaining.length, 0);
    assert.equal(all.complete, true);
});

test('완료 개수: 일부만 체크하면 그 개수만 센다 (true 가 아닌 값·모르는 id 는 무시)', () => {
    const s = summarizeChecklist({ checked: { name: true, phone: true, hours: 'yes', nothing: true, photos: false } });
    assert.equal(s.done, 2);
    assert.deepEqual(s.remaining.map((i) => i.id), ['category', 'keywords', 'address', 'homepage', 'directions', 'price', 'photos', 'hours']);
});

test('state 가 비어 있어도 오류 없이 0개로 계산한다', () => {
    assert.equal(summarizeChecklist().done, 0);
    assert.equal(summarizeChecklist({}).extraDone, 0);
    assert.equal(summarizeChecklist({}).extraTotal, EXTRA_ITEMS.length);
});

test('추가 운영 점검은 공식 10개 개수에 섞이지 않는다', () => {
    const s = summarizeChecklist({ checked: { name: true }, extra: { reply: true, news: true } });
    assert.equal(s.done, 1);
    assert.equal(s.extraDone, 2);
    assert.equal(s.extraRemaining.length, EXTRA_ITEMS.length - 2);
    const officialIds = new Set(OFFICIAL_ITEMS.map((i) => i.id));
    assert.ok(EXTRA_ITEMS.every((i) => !officialIds.has(i.id)));
});

test('할 일 목록: 안 한 항목만, 공식 순서대로, 업종 안내가 있으면 그 문구를 쓴다', () => {
    const todos = buildTodos({ checked: { name: true, category: true } }, 'beauty');
    assert.equal(todos.length, 8);
    assert.equal(todos[0].id, 'keywords');
    assert.ok(todos[0].action.includes('레이어드컷'));
    assert.ok(todos.every((t) => t.caution.length > 0));
    // 업종 문구가 없는 항목은 공통 문구로 돌아간다
    const phone = todos.find((t) => t.id === 'phone');
    assert.equal(phone.action, OFFICIAL_ITEMS.find((i) => i.id === 'phone').how);
    assert.equal(buildTodos({ checked: allChecked() }).length, 0);
});

test('업종마다 안내 문구가 다르다', () => {
    const keywords = OFFICIAL_ITEMS.find((i) => i.id === 'keywords');
    const notes = ['restaurant', 'cafe', 'beauty', 'clinic'].map((id) => getItemGuide(keywords, id).industryNote);
    assert.equal(new Set(notes).size, 4);
    assert.ok(notes.every((n) => n.length > 0));
    assert.equal(getItemGuide(keywords, 'etc').industryNote, '');
    assert.equal(INDUSTRIES.length, 5);
});

test('대표키워드: 입력 분리는 줄바꿈·쉼표 기준이고 공백을 정리한다', () => {
    assert.deepEqual(parseKeywordInput(' 돼지갈비 ,삼겹살\n\n  소  갈비 ,, '), ['돼지갈비', '삼겹살', '소 갈비']);
    assert.deepEqual(parseKeywordInput(''), []);
    assert.deepEqual(parseKeywordInput(undefined), []);
});

test('대표키워드: 메뉴명 5개는 모두 통과한다 (개수 경계 5개)', () => {
    const r = checkKeywords('돼지갈비\n삼겹살\n소갈비\n냉면\n된장찌개');
    assert.equal(r.count, 5);
    assert.equal(r.passCount, 5);
    assert.equal(r.warnCount, 0);
    assert.deepEqual(r.listIssues, []);
    assert.equal(r.ok, true);
});

test('대표키워드: 6개부터는 개수 초과 경고, 6번째 키워드에 이유가 붙는다', () => {
    const r = checkKeywords('돼지갈비, 삼겹살, 소갈비, 냉면, 된장찌개, 갈비탕');
    assert.equal(r.count, 6);
    assert.equal(r.listIssues.length, 1);
    assert.ok(r.listIssues[0].includes('최대 5개'));
    assert.equal(r.items[4].status, 'pass');
    assert.equal(r.items[5].status, 'warn');
    assert.ok(r.items[5].reasons[0].includes('넘는'));
    assert.equal(r.ok, false);
    assert.equal(KEYWORD_MAX, 5);
});

test('대표키워드: 중복은 공백·대소문자를 무시하고 찾는다', () => {
    const r = checkKeywords(['소금빵', '소금 빵', 'Brunch', 'brunch']);
    assert.equal(r.items[0].status, 'pass');
    assert.equal(r.items[1].status, 'warn');
    assert.ok(r.items[1].reasons[0].includes('같은 키워드'));
    assert.equal(r.items[2].status, 'pass');
    assert.equal(r.items[3].status, 'warn');
});

test('대표키워드: 홍보성 표현은 경고하고 어떤 표현인지 알려 준다', () => {
    const r = checkKeywords('강남맛집\n최고의커피\n1등 미용실\n머리잘하는미용실\n레이어드컷');
    assert.equal(r.items[0].status, 'warn');
    assert.ok(r.items[0].reasons.join(' ').includes('맛집'));
    assert.ok(r.items[1].reasons.join(' ').includes('최고'));
    assert.ok(r.items[2].reasons.join(' ').includes('1등'));
    assert.ok(r.items[3].reasons.join(' ').includes('잘하는'));
    assert.equal(r.items[4].status, 'pass');
    assert.equal(r.warnCount, 4);
    assert.ok(r.items[0].reasons.join(' ').includes('거절'));
});

test('대표키워드: 길이 경계 — 2자는 통과, 1자는 짧음, 15자는 통과, 16자는 김', () => {
    assert.equal(checkKeywords('냉면').items[0].status, 'pass');
    const short = checkKeywords('맥');
    assert.equal(short.items[0].status, 'warn');
    assert.ok(short.items[0].reasons[0].includes('짧습니다'));
    assert.ok(short.items[0].reasons[0].includes('네이버의 글자 수 제한이 아닙니다'));

    const fifteen = '가'.repeat(15);
    const sixteen = '가'.repeat(16);
    assert.equal(checkKeywords(fifteen).items[0].status, 'pass');
    const long = checkKeywords(sixteen);
    assert.equal(long.items[0].status, 'warn');
    assert.ok(long.items[0].reasons[0].includes('깁니다'));
});

test('대표키워드: 업체명을 그대로 반복하면 경고, 업체명이 없으면 이 검사를 건너뛴다', () => {
    const withName = checkKeywords('연남 돼지갈비집\n돼지갈비', { businessName: '연남돼지갈비집' });
    assert.equal(withName.items[0].status, 'warn');
    assert.ok(withName.items[0].reasons[0].includes('업체명'));
    assert.equal(withName.items[1].status, 'pass');

    const noName = checkKeywords('연남 돼지갈비집');
    assert.equal(noName.items[0].status, 'pass');
    // 업체명이 1글자뿐이면 오탐이 많아 검사하지 않는다
    assert.equal(checkKeywords('커피', { businessName: '커' }).items[0].status, 'pass');
});

test('대표키워드: 빈 입력은 0개이고 ok 가 아니다', () => {
    const r = checkKeywords('  \n , ');
    assert.equal(r.count, 0);
    assert.equal(r.ok, false);
    assert.deepEqual(r.items, []);
});

test('하락 진단: 질문은 8~10개이고 모두 공식 요소(또는 변동)에 연결된다', () => {
    assert.ok(DIAGNOSE_QUESTIONS.length >= 8 && DIAGNOSE_QUESTIONS.length <= 10);
    const factorIds = new Set(FACTORS.map((f) => f.id));
    assert.ok(DIAGNOSE_QUESTIONS.every((q) => factorIds.has(q.factor) && q.action.length > 0));
    assert.equal(new Set(DIAGNOSE_QUESTIONS.map((q) => q.id)).size, DIAGNOSE_QUESTIONS.length);
    ['similarity', 'popularity', 'distance', 'completeness'].forEach((id) => {
        assert.ok(DIAGNOSE_QUESTIONS.some((q) => q.factor === id), `${id} 질문이 있어야 한다`);
    });
});

test('하락 진단: 답이 없으면 0, "예"만 먼저 확인할 것으로 묶인다', () => {
    const empty = diagnose({});
    assert.equal(empty.answered, 0);
    assert.equal(empty.yesCount, 0);
    assert.equal(empty.complete, false);
    assert.equal(empty.nothingFound, false);
    assert.deepEqual(empty.groups, []);

    const r = diagnose({ 'q-location': 'yes', 'q-info-mismatch': 'yes', 'q-device': 'no', 'q-changed': 'yes' });
    assert.equal(r.answered, 4);
    assert.equal(r.yesCount, 3);
    // 묶음 순서는 FACTORS 순서(충실성 → 유사도 → 거리)
    assert.deepEqual(r.groups.map((g) => g.id), ['completeness', 'similarity', 'distance']);
    assert.equal(r.groups[2].items.length, 1);
    assert.equal(r.groups[2].items[0].id, 'q-location');
});

test('하락 진단: 모두 답했고 전부 "아니오"면 nothingFound, 일부만 답하면 아니다', () => {
    const allNo = Object.fromEntries(DIAGNOSE_QUESTIONS.map((q) => [q.id, 'no']));
    const done = diagnose(allNo);
    assert.equal(done.complete, true);
    assert.equal(done.nothingFound, true);
    assert.equal(done.groups.length, 0);

    const almost = { ...allNo };
    delete almost['q-device'];
    const partial = diagnose(almost);
    assert.equal(partial.answered, DIAGNOSE_QUESTIONS.length - 1);
    assert.equal(partial.nothingFound, false);

    // 모르는 값은 답으로 세지 않는다
    assert.equal(diagnose({ 'q-device': 'maybe' }).answered, 0);
});

test('저장값 정리: 깨진 값·모르는 키는 버리고 기본값으로 돌아간다', () => {
    assert.deepEqual(normalizeState(null), defaultState());
    assert.deepEqual(normalizeState('문자열'), defaultState());
    assert.deepEqual(normalizeState([1, 2]), defaultState());

    const s = normalizeState({
        industry: 'spaceship',
        checked: { name: true, phone: 1, bogus: true },
        extra: { reply: true, nope: true },
        businessName: 'x'.repeat(100),
        keywordsText: 123,
        answers: { 'q-device': 'yes', 'q-location': 'maybe', zzz: 'yes' },
    });
    assert.equal(s.industry, 'restaurant');
    assert.deepEqual(s.checked, { name: true });
    assert.deepEqual(s.extra, { reply: true });
    assert.equal(s.businessName.length, 40);
    assert.equal(s.keywordsText, '');
    assert.deepEqual(s.answers, { 'q-device': 'yes' });

    assert.equal(normalizeState({ industry: 'clinic' }).industry, 'clinic');
});

test('출처: 모든 항목의 출처 id 가 실제로 있고, 공식/2차 구분이 붙어 있다', () => {
    const kinds = new Set(Object.values(SOURCES).map((s) => s.kind));
    assert.deepEqual([...kinds].sort(), ['official', 'secondary']);
    const used = [
        ...OFFICIAL_ITEMS.flatMap((i) => i.sources),
        ...EXTRA_ITEMS.flatMap((i) => i.sources),
        ...FACTORS.flatMap((f) => f.sources),
    ];
    used.forEach((id) => assert.ok(SOURCES[id], `알 수 없는 출처 ${id}`));
    Object.values(SOURCES).forEach((s) => assert.ok(s.url.startsWith('https://')));
});

test('화면에 쓰는 문구에 금지 표현이 없다', () => {
    const text = JSON.stringify([OFFICIAL_ITEMS, EXTRA_ITEMS, DIAGNOSE_QUESTIONS, FACTORS]);
    ['AI', '어뷰징', '가짜 리뷰', '리뷰 작업', '순위 올려', '1위 보장'].forEach((word) => {
        assert.ok(!text.includes(word), `금지 표현 포함: ${word}`);
    });
});
