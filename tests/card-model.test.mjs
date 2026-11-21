import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCardModel, applyReasons, relationGroups, relationTitle, relationPredicate, restatedFact, trimDetail, isQuietClass } from '../app/dashboard/place-insight/graph/card-model.js';
import { buildPlaceGraph, ONTOLOGY } from '../lib/place-graph.js';
import { PHARMACY, RESTAURANT, SALON, graphInput } from './place-graph.fixtures.mjs';

// 살펴보기 카드의 내용(묶음 제목·순서·겹치는 값 정리)을 만드는 순수 함수 검증.
// 앞쪽은 작은 가짜 그래프로 규칙을 하나씩 확인하고, 뒤쪽은 실제 견본 그래프의 모든 점에 대해 깨지지 않는 성질을 확인합니다.

const SCHEMA = {
    classes: {
        store: { label: '내 매장', group: 'store' },
        concept: { label: '묶음', group: null, quiet: true },
        keyword: { label: '대표키워드', group: 'search' },
        rival: { label: '경쟁 매장', group: 'rival' },
        reviewMenu: { label: '리뷰에 나온 메뉴', group: 'voice' },
        blogTerm: { label: '블로그에 나온 낱말', group: 'voice' },
        menu: { label: '등록한 메뉴', group: 'ops' },
    },
    families: { competition: { label: '경쟁 매장', order: 1 }, evidence: { label: '추천 이유', order: 3 }, registration: { label: '키워드 등록', order: 4 }, same: { label: '같은 것끼리', order: 5 }, structure: { label: '묶음', order: 7, quiet: true } },
    relations: {
        partOf: { name: '묶음', label: '여기에 속함', forward: '속한 곳', inverse: '여기에 든 것', family: 'structure', quiet: true },
        outranks: { name: '내 위에 있는 매장', label: '검색에서 내 매장보다 위', forward: '이 매장이 내 위에 있는 키워드', inverse: '이 키워드에서 내 위에 있는 매장', family: 'competition' },
        registers: { name: '대표키워드 등록', label: '대표키워드로 등록함', forward: '등록한 대표키워드', inverse: '이 키워드를 등록한 매장', family: 'registration' },
        supports: { name: '추천 이유', label: '추천 이유가 됨', forward: '이것을 이유로 추천한 키워드', inverse: '이 키워드를 추천한 이유', family: 'evidence' },
        sameItem: { name: '같은 메뉴', label: '이름이 같음', forward: '이름이 같은 메뉴', inverse: '이름이 같은 메뉴', family: 'same', symmetric: true },
    },
};
const NAMES = { store: '매장', search: '검색 순위', rival: '경쟁 매장', voice: '리뷰·활동', ops: '운영' };

function sample() {
    const nodes = [
        { id: 'store', level: 0, group: 'store', type: 'store', label: '시험횟집', full: '시험횟집', sub: '한식', detail: '한식 · 방문자 리뷰 323', go: null, parent: null },
        { id: 'hub:search', level: 1, group: 'search', type: 'concept', label: '검색', full: '키워드 검색 순위', detail: '대표키워드 2개', go: '키워드 순위', parent: 'store', facts: [{ label: '대표키워드', value: '2개' }] },
        { id: 'kw:a', level: 2, group: 'search', type: 'keyword', label: '강남횟집', full: '강남횟집', sub: '41위', subTone: 'bad', detail: '41위 · 검색된 매장 388곳', go: '순위 표', parent: 'hub:search',
            facts: [{ label: '검색 순위', value: '41위', tone: 'bad' }, { label: '검색된 매장', value: '388곳' }, { label: '블로그 후기 언급', value: '30/52' }] },
        { id: 'kw:b', level: 2, group: 'search', type: 'keyword', label: '논현횟집', full: '논현횟집', sub: '3위', subTone: 'good', detail: '3위 · 검색된 매장 214곳', go: '순위 표', parent: 'hub:search' },
        { id: 'rival:1', level: 2, group: 'rival', type: 'rival', label: '바다수산', full: '바다수산', sub: '키워드 2개 상위', detail: "'강남횟집' 1위", go: '순위 표', parent: 'store' },
        { id: 'rival:2', level: 2, group: 'rival', type: 'rival', label: '청담수산', full: '청담수산', sub: '키워드 1개 상위', go: '순위 표', parent: 'store' },
        { id: 'rm:1', level: 3, group: 'voice', type: 'reviewMenu', label: '숙성회', full: '숙성회', sub: '22회', go: '리뷰', parent: 'store' },
        { id: 'bt:1', level: 3, group: 'voice', type: 'blogTerm', label: '숙성회', full: '숙성회', sub: '25개', go: '리뷰', parent: 'store' },
        { id: 'menu:1', level: 3, group: 'ops', type: 'menu', label: '모듬숙성회', full: '모듬숙성회', go: '메뉴', parent: 'store' },
    ];
    const tree = (id, parent, strength = 0.5) => ({ id: `${id}>${parent}`, source: id, target: parent, kind: 'tree', rel: 'partOf', strength });
    const cross = (source, rel, target, strength, why, badge) => ({ id: `${source}~${rel}~${target}`, source, target, kind: 'cross', rel, strength, why, ...(badge ? { badge } : {}) });
    const links = [
        tree('hub:search', 'store', 1), tree('kw:a', 'hub:search', 0.6), tree('kw:b', 'hub:search', 0.9),
        tree('rival:1', 'store'), tree('rival:2', 'store'), tree('rm:1', 'store'), tree('bt:1', 'store'), tree('menu:1', 'store'),
        cross('store', 'registers', 'kw:a', 0.6, '내 매장이 등록한 대표키워드입니다.'),
        cross('rival:2', 'outranks', 'kw:a', 0.7, "청담수산이 '강남횟집' 검색 2위로, 내 매장보다 위에 있습니다.", '2위'),
        cross('rival:1', 'outranks', 'kw:a', 0.9, "바다수산이 '강남횟집' 검색 1위로, 내 매장보다 위에 있습니다.", '1위'),
        cross('rm:1', 'supports', 'kw:a', 0.5, "리뷰에서 22회 나온 '숙성회'가 추천 이유입니다."),
        cross('bt:1', 'supports', 'kw:a', 0.4, "블로그 25개에 나온 '숙성회'가 추천 이유입니다."),
        cross('kw:a', 'supports', 'kw:b', 0.3, "'논현횟집'은 '강남횟집'의 낱말로 만든 조합입니다."),
        cross('rm:1', 'sameItem', 'menu:1', 0.5, "리뷰의 '숙성회'와 등록 메뉴 '모듬숙성회'는 같은 메뉴입니다."),
    ];
    return { nodes, links, nodeById: new Map(nodes.map((node) => [node.id, node])) };
}

function card(id, extra = {}) {
    const graph = sample();
    return buildCardModel({ node: graph.nodeById.get(id), links: graph.links, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES, ...extra });
}

test('묶음 제목: 고른 점이 주어면 forward, 목적어면 inverse', () => {
    assert.equal(relationTitle('outranks', 'out', SCHEMA), '이 매장이 내 위에 있는 키워드');
    assert.equal(relationTitle('outranks', 'in', SCHEMA), '이 키워드에서 내 위에 있는 매장');
    assert.equal(relationTitle('sameItem', 'in', SCHEMA), relationTitle('sameItem', 'out', SCHEMA));
    assert.equal(relationTitle('없는관계', 'out', SCHEMA), '');
    assert.equal(relationPredicate('outranks', SCHEMA), '검색에서 내 매장보다 위');
});

test('묶음 제목: forward 가 없는 예전 스키마는 label·inverse 로 물러난다', () => {
    const old = { relations: { ranksIn: { label: '검색 상위에 있음', inverse: '상위에 있는 매장' } } };
    assert.equal(relationTitle('ranksIn', 'out', old), '검색 상위에 있음');
    assert.equal(relationTitle('ranksIn', 'in', old), '상위에 있는 매장');
});

test('같은 관계라도 방향이 다르면 다른 묶음이고 제목이 서로 다르다', () => {
    const model = card('kw:a');
    const titles = model.groups.map((group) => group.title);
    assert.ok(titles.includes('이 키워드를 추천한 이유'));
    assert.ok(titles.includes('이것을 이유로 추천한 키워드'));
    assert.equal(new Set(titles).size, titles.length);
});

test('순서: 의미 있는 묶음이 갈래 순서 → 개수 많은 순으로 먼저, 구조 관계(속한 곳)는 맨 아래에 접힌다', () => {
    const model = card('kw:a');
    assert.deepEqual(model.groups.map((group) => [group.title, group.items.length, group.quiet]), [
        ['이 키워드에서 내 위에 있는 매장', 2, false], // 경쟁
        ['이 키워드를 추천한 이유', 2, false], // 추천 이유(개수 2)
        ['이것을 이유로 추천한 키워드', 1, false], // 추천 이유(개수 1)
        ['이 키워드를 등록한 매장', 1, false], // 키워드 등록
        ['속한 곳', 1, true],
    ]);
    assert.equal(model.total, 7);
});

test('순서: 같은 갈래 안에서는 개수 많은 묶음이 먼저, 개수·strength 가 같으면 스키마에 적힌 관계 순서다', () => {
    const schema = {
        families: { competition: { label: '경쟁 매장', order: 1 } },
        relations: {
            outranks: { label: '검색에서 내 매장보다 위', forward: '이 매장이 내 위에 있는 키워드', inverse: '이 키워드에서 내 위에 있는 매장', family: 'competition' },
            ranksIn: { label: '검색에서 내 매장보다 아래', forward: '이 매장이 내 아래에 있는 키워드', inverse: '이 키워드에서 내 아래에 있는 매장', family: 'competition' },
        },
    };
    const nodes = ['k', 'a', 'b', 'c'].map((id) => ({ id, level: 2, label: id }));
    const links = [
        { id: '1', source: 'b', target: 'k', kind: 'cross', rel: 'ranksIn', strength: 0.9 },
        { id: '2', source: 'c', target: 'k', kind: 'cross', rel: 'ranksIn', strength: 0.8 },
        { id: '3', source: 'a', target: 'k', kind: 'cross', rel: 'outranks', strength: 0.2 },
    ];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groups = relationGroups({ nodeId: 'k', links, nodeById, ontology: schema });
    assert.deepEqual(groups.map((group) => [group.title, group.count]), [['이 키워드에서 내 아래에 있는 매장', 2], ['이 키워드에서 내 위에 있는 매장', 1]]);
    // 개수와 strength 가 같으면 연결이 들어온 순서가 아니라 스키마 순서(내 위 → 내 아래)
    const even = [
        { id: '1', source: 'b', target: 'k', kind: 'cross', rel: 'ranksIn', strength: 0.5 },
        { id: '2', source: 'a', target: 'k', kind: 'cross', rel: 'outranks', strength: 0.5 },
    ];
    assert.deepEqual(relationGroups({ nodeId: 'k', links: even, nodeById, ontology: schema }).map((group) => group.rel), ['outranks', 'ranksIn']);
});

test('순서: 갈래 순서가 없는 스키마는 개수 많은 순, 같으면 strength 큰 순이다', () => {
    const graph = sample();
    const { families, ...noFamilies } = SCHEMA;
    assert.ok(families);
    const model = buildCardModel({ node: graph.nodeById.get('kw:a'), links: graph.links, nodeById: graph.nodeById, ontology: noFamilies, groupNames: NAMES });
    assert.deepEqual(model.groups.map((group) => group.title), ['이 키워드에서 내 위에 있는 매장', '이 키워드를 추천한 이유', '이 키워드를 등록한 매장', '이것을 이유로 추천한 키워드', '속한 곳']);
});

test("순서: 묶음 점은 '여기에 든 것'이 맨 위이고 접히지 않는다", () => {
    const model = card('hub:search');
    assert.equal(model.groups[0].title, '여기에 든 것');
    assert.equal(model.groups[0].contains, true);
    assert.equal(model.groups[0].quiet, false);
    assert.equal(model.groups.at(-1).title, '속한 곳');
    assert.equal(model.groups.at(-1).quiet, true);
    // 든 항목은 중요한 것부터, 그 항목의 핵심 값이 배지로 붙는다
    assert.deepEqual(model.groups[0].items.map((item) => [item.label, item.badge, item.badgeTone]), [['논현횟집', '3위', 'good'], ['강남횟집', '41위', 'bad']]);
    // 든 항목의 설명에서 배지와 같은 값은 뺀다
    assert.equal(model.groups[0].items[1].about, '검색된 매장 388곳');
});

test('머리: quiet 종류(묶음)는 종류 이름을 쓰지 않는다', () => {
    assert.equal(card('hub:search').kindName, '');
    assert.equal(card('kw:a').kindName, '대표키워드');
    assert.equal(card('kw:a').groupName, '검색 순위');
    assert.equal(isQuietClass('concept', SCHEMA), true);
    // quiet 필드가 없는 예전 스키마: 묶음이 정해지지 않은 종류를 quiet 로 본다
    assert.equal(isQuietClass('concept', { classes: { concept: { label: '범주', group: null } } }), true);
    assert.equal(isQuietClass('keyword', { classes: { keyword: { label: '대표키워드', group: 'search' } } }), false);
});

test('머리: 제목과 같은 묶음 이름은 다시 쓰지 않는다', () => {
    const graph = sample();
    const hub = { ...graph.nodeById.get('hub:search'), label: '검색 순위', full: '검색 순위' };
    const model = buildCardModel({ node: hub, links: graph.links, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES });
    assert.equal(model.title, '검색 순위');
    assert.equal(model.groupName, '');
    assert.equal(model.kindName, '');
    // 제목이 다르면 묶음 이름을 쓴다
    assert.equal(card('hub:search').groupName, '검색 순위');
});

test('조각의 값: link.badge 를 쓰고 순위 배지는 순위 순서로 놓는다', () => {
    const group = card('kw:a').groups[0];
    assert.deepEqual(group.items.map((item) => [item.badge, item.label, item.lead]), [['1위', '바다수산', true], ['2위', '청담수산', true]]);
    assert.equal(group.items[0].why, "바다수산이 '강남횟집' 검색 1위로, 내 매장보다 위에 있습니다.");
    assert.deepEqual(group.items[0].triple, { subject: '바다수산', predicate: '검색에서 내 매장보다 위', object: '강남횟집', symmetric: false });
});

test('조각의 값: 주인을 적은 순위(이 매장 2위)는 이름 뒤에 두고, link.rank 순서로 놓는다', () => {
    const graph = sample();
    // strength 순서(청담 0.7 < 바다 0.9)와 반대로 순위를 줘서, 순서가 link.rank 를 따르는지 본다
    const links = graph.links.map((link) => {
        if (link.id === 'rival:2~outranks~kw:a') return { ...link, badge: '이 매장 1위', rank: 1 };
        if (link.id === 'rival:1~outranks~kw:a') return { ...link, badge: '이 매장 2위', rank: 2 };
        return link;
    });
    const group = buildCardModel({ node: graph.nodeById.get('kw:a'), links, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES }).groups[0];
    assert.deepEqual(group.items.map((item) => [item.label, item.badge, item.lead, item.rank]), [['청담수산', '이 매장 1위', false, 1], ['바다수산', '이 매장 2위', false, 2]]);
    // 순위가 없는 항목이 섞인 묶음은 strength 순서 그대로
    const mixed = links.map((link) => (link.id === 'rival:2~outranks~kw:a' ? { ...link, badge: '순위 조회 전', rank: undefined } : link));
    const loose = buildCardModel({ node: graph.nodeById.get('kw:a'), links: mixed, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES }).groups[0];
    assert.deepEqual(loose.items.map((item) => [item.label, item.rank]), [['바다수산', 2], ['청담수산', null]]);
});

test('조각의 값: link.badge 가 없으면 상대 점의 핵심 값(sub)을 이름 뒤에 붙인다', () => {
    const model = card('kw:a');
    // 같은 이름 '숙성회' 두 점이 값으로 갈린다
    const reasons = model.groups.find((entry) => entry.title === '이 키워드를 추천한 이유');
    assert.deepEqual(reasons.items.map((item) => [item.label, item.badge, item.hint, item.lead]), [['숙성회', '22회', '', false], ['숙성회', '25개', '', false]]);
    // 상대 점 자신의 순위('3위')는 그 연결의 순위가 아니므로 이름 앞에 두지 않고, 색은 그 점의 값 색을 따른다
    const derived = model.groups.find((entry) => entry.title === '이것을 이유로 추천한 키워드');
    assert.deepEqual(derived.items.map((item) => [item.label, item.badge, item.badgeTone, item.lead]), [['논현횟집', '3위', 'good', false]]);
    // 값이 없는 점은 비워 둔다
    assert.deepEqual(model.groups.at(-1).items.map((item) => [item.label, item.badge, item.hint]), [['검색', '', '']]);
});

test('이름도 값도 같은 서로 다른 점은 종류 이름을 덧붙여 가른다', () => {
    const graph = sample();
    graph.nodeById.get('bt:1').sub = '22회';
    const model = buildCardModel({ node: graph.nodeById.get('kw:a'), links: graph.links, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES });
    const reasons = model.groups.find((entry) => entry.title === '이 키워드를 추천한 이유');
    assert.deepEqual(reasons.items.map((item) => [item.label, item.badge, item.hint]), [['숙성회', '22회', '리뷰에 나온 메뉴'], ['숙성회', '22회', '블로그에 나온 낱말']]);
});

test('큰 값과 같은 설명·수치는 한 번만 보여 준다', () => {
    const model = card('kw:a');
    assert.equal(model.value, '41위');
    assert.equal(model.valueTone, 'bad');
    // '41위'는 큰 값에만, '검색된 매장 388곳'은 수치 칸에만
    assert.equal(model.detail, '');
    assert.deepEqual(model.facts.map((fact) => fact.label), ['검색된 매장', '블로그 후기 언급']);
    assert.ok(!model.facts.some((fact) => fact.value === '41위'));
});

test('trimDetail: 이미 보인 값만 다시 적은 줄은 빼고, 새 내용이 있으면 그대로 둔다', () => {
    // 큰 값과 글자가 같은 조각은 빼고, 남은 조각이 수치 칸에 있는 값이면 줄 전체를 뺀다
    assert.equal(trimDetail('41위 · 검색된 매장 388곳', ['41위'], ['검색된 매장', '388곳']), '');
    assert.equal(trimDetail('41위 · 검색된 매장 388곳', ['41위'], []), '검색된 매장 388곳');
    assert.equal(trimDetail('323개 · 316명이 작성', [], ['방문자 리뷰', '323개', '작성한 손님', '316명']), '');
    assert.equal(trimDetail('방문자 리뷰 323 · 블로그·카페 리뷰 52', [], ['323개', '52개']), '');
    assert.equal(trimDetail('5개', [], ['5개']), '');
    assert.equal(trimDetail('손님 299명이 고른 좋은 점', [], ['손님 299명']), '');
    // 새 숫자나 숫자 없는 새 문장이 하나라도 있으면 줄 전체를 둔다(문장이 중간에 끊기지 않게)
    assert.equal(trimDetail('323개 · 316명이 작성', [], ['323개']), '323개 · 316명이 작성');
    assert.equal(trimDetail('46일 전 · 대방어 입고 안내', [], ['마지막 소식', '46일 전']), '46일 전 · 대방어 입고 안내');
    assert.equal(trimDetail("경쟁 매장이 등록한 대표키워드 2개 · '숙성회'는 2곳이 함께 등록", [], ['2개']), "경쟁 매장이 등록한 대표키워드 2개 · '숙성회'는 2곳이 함께 등록");
    // 단위까지 풀어 쓴 문장은 줄여 쓴 값의 풀이이므로 둔다
    assert.equal(trimDetail('블로그 후기 52개 중 30개에 나오는 낱말', [], ['블로그 30/52']), '블로그 후기 52개 중 30개에 나오는 낱말');
    // 숫자가 없는 문장은 건드리지 않는다
    assert.equal(trimDetail('한 문장으로 된 설명입니다.', ['41위'], ['41위']), '한 문장으로 된 설명입니다.');
    assert.equal(trimDetail('', ['a'], []), '');
});

test('restatedFact: 큰 값을 다시 적은 수치를 앞에서부터 한 개만 고른다', () => {
    const fact = (label, value) => ({ label, value });
    assert.equal(restatedFact('3위', [fact('검색 순위', '3위'), fact('이 키워드를 등록한 매장', '3곳(내 매장 포함)')]), 0);
    assert.equal(restatedFact('손님 299명', [fact('목록 안 순서', '1번째 / 8개'), fact('고른 손님', '299명')]), 1);
    assert.equal(restatedFact('블로그 30/52', [fact('나온 블로그 글', '30개'), fact('목록 안 순서', '1번째 / 8개')]), 0);
    assert.equal(restatedFact('7/8 답함', [fact('바로 답함', '7개'), fact('일부만 답함', '1개')]), 0);
    // 숫자만 우연히 같은 다른 수치(배점 15점)가 아니라 앞에 있는 항목 점수를 고른다
    assert.equal(restatedFact('15점', [fact('항목 점수', '15점 / 100점'), fact('배점', '15점')]), 0);
    // 단위가 다르면 다른 값이다
    assert.equal(restatedFact('2개', [fact('대표키워드를 읽은 경쟁 매장', '2곳')]), -1);
    // 낱말이 이어지지 않으면 같은 숫자라도 빼지 않는다
    assert.equal(restatedFact('키워드 4개에서 내 위', [fact('쿠폰', '4개')]), -1);
    assert.equal(restatedFact('추천', [fact('등록 상태', '추천(미등록)')]), -1);
    assert.equal(restatedFact('', [fact('방문자 리뷰', '323개')]), -1);
});

test('대칭 관계는 방향과 상관없이 한 묶음이다', () => {
    const fromReview = card('rm:1').groups.find((group) => group.rel === 'sameItem');
    const fromMenu = card('menu:1').groups.find((group) => group.rel === 'sameItem');
    assert.equal(fromReview.title, '이름이 같은 메뉴');
    assert.equal(fromMenu.title, '이름이 같은 메뉴');
    assert.equal(fromMenu.items[0].triple.symmetric, true);
});

test('묶음의 읽는 법: 상대 쪽 자리는 비워 둔다', () => {
    const model = card('kw:a');
    assert.deepEqual(model.groups[0].triple, { subject: null, predicate: '검색에서 내 매장보다 위', object: '강남횟집', symmetric: false });
    assert.deepEqual(model.groups.find((group) => group.title === '이것을 이유로 추천한 키워드').triple, { subject: '강남횟집', predicate: '추천 이유가 됨', object: null, symmetric: false });
    assert.equal(model.groups.at(-1).triple, null);
});

test('방금 건너온 연결: 그 묶음과 항목이 맨 앞으로 오고 표시된다', () => {
    const plain = card('kw:a');
    assert.equal(plain.via, null);
    const model = card('kw:a', { via: { linkId: 'bt:1~supports~kw:a' } });
    assert.equal(model.groups[0].title, '이 키워드를 추천한 이유');
    assert.equal(model.groups[0].items[0].id, 'bt:1');
    assert.equal(model.groups[0].items[0].via, true);
    assert.equal(model.via.item.id, 'bt:1');
    assert.equal(model.via.title, '이 키워드를 추천한 이유');
    assert.equal(model.total, plain.total);
    // 접혀 있는 구조 관계로 건너온 경우에는 순서를 바꾸지 않는다
    const viaTree = card('kw:a', { via: { linkId: 'kw:a>hub:search' } });
    assert.equal(viaTree.via, null);
    assert.deepEqual(viaTree.groups.map((group) => group.key), plain.groups.map((group) => group.key));
});

test('버튼 문구는 node.go 그대로, null 이면 버튼이 없다', () => {
    assert.equal(card('kw:a').go, '순위 표');
    assert.equal(card('store').go, null);
    const graph = sample();
    const node = { ...graph.nodeById.get('kw:a') };
    delete node.go;
    assert.equal(buildCardModel({ node, links: graph.links, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES }).go, '본문에서 보기');
});

test('온톨로지가 없는 예전 그래프도 묶음을 만든다', () => {
    const nodes = [
        { id: 'store', level: 0, group: 'store', label: '테스트 매장', parent: null, go: null },
        { id: 'hub', level: 1, group: 'voice', label: '리뷰', detail: '리뷰 묶음', go: '눌러서 이동', parent: 'store' },
        { id: 'leaf', level: 2, group: 'voice', label: '방문자 1,284', go: '눌러서 이동', parent: 'hub' },
    ];
    const links = [{ id: 'hub>store', source: 'hub', target: 'store' }, { id: 'leaf>hub', source: 'leaf', target: 'hub' }];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const model = buildCardModel({ node: nodes[1], links, nodeById, groupNames: new Map([['voice', '리뷰·활동']]) });
    assert.deepEqual(model.groups.map((group) => [group.title, group.quiet, group.items.map((item) => item.label)]), [['여기에 든 것', false, ['방문자 1,284']], ['속한 곳', true, ['테스트 매장']]]);
    assert.equal(model.groupName, '리뷰·활동');
    assert.equal(model.kindName, '');
    assert.equal(model.go, '눌러서 이동');
});

test('relationGroups: 캔버스 이름표가 쓰는 묶음도 카드와 같은 제목·순서다', () => {
    const graph = sample();
    const groups = relationGroups({ nodeId: 'kw:a', links: graph.links, nodeById: graph.nodeById, ontology: SCHEMA });
    assert.deepEqual(groups.map((group) => group.title), card('kw:a').groups.map((group) => group.title));
    assert.deepEqual(groups.map((group) => group.count), [2, 2, 1, 1, 1]);
    assert.equal(groups[0].key, 'outranks:in');
    assert.equal(groups[0].strength, 0.9);
});

/* ───────── 실제 견본 그래프 전체에 대한 성질 ───────── */

const GROUP_NAMES = Object.fromEntries(Object.entries(ONTOLOGY.groups || {}).map(([key, value]) => [key, value.label || key]));
const squash = (value) => String(value ?? '').replace(/\s+/g, '');

for (const [name, fixture] of [['약국', PHARMACY], ['음식점', RESTAURANT], ['미용실', SALON]]) {
    test(`${name} 견본: 모든 점의 카드가 연결을 빠짐없이 한 번씩 담고, 겹치는 값이 없다`, () => {
        const graph = buildPlaceGraph(graphInput(fixture));
        const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
        for (const node of graph.nodes) {
            const model = buildCardModel({ node, links: graph.links, nodeById, ontology: ONTOLOGY, groupNames: GROUP_NAMES });
            // 추천 키워드 점의 '추천한 이유'는 이어진 연결이 아니라 node.reasons(본문 추천 이유 칩) 목록으로 그립니다.
            // 그 연결(supports 의 들어오는 것)은 이유 목록이 대신 세므로, 연결로 따로 세지 않습니다(이어 준 이유만 그 연결의 linkId 를 가짐).
            const reasons = Array.isArray(node.reasons) ? node.reasons : [];
            const isReasonLink = (link) => reasons.length > 0 && link.rel === 'supports' && link.target === node.id;
            const touching = graph.links.filter((link) => (link.source === node.id || link.target === node.id) && !isReasonLink(link));
            const reasonLinkIds = new Set(graph.links.filter(isReasonLink).map((link) => link.id));
            const shown = model.groups.flatMap((group) => group.items.map((item) => item.linkId)).filter((id) => id && !reasonLinkIds.has(id));
            assert.equal(model.total, touching.length + reasons.length, `${node.id}: 연결 수`);
            assert.deepEqual([...shown].sort(), touching.map((link) => link.id).sort(), `${node.id}: 연결이 빠지거나 두 번 나옴`);
            // 제목은 비어 있지 않고 한 카드 안에서 겹치지 않는다
            const titles = model.groups.map((group) => group.title);
            assert.ok(titles.every(Boolean), `${node.id}: 빈 묶음 제목`);
            assert.equal(new Set(titles).size, titles.length, `${node.id}: 같은 제목의 묶음이 둘 (${titles.join(' | ')})`);
            // 접히는 묶음은 맨 아래
            const firstQuiet = model.groups.findIndex((group) => group.quiet);
            if (firstQuiet >= 0) assert.ok(model.groups.slice(firstQuiet).every((group) => group.quiet), `${node.id}: 접힌 묶음 뒤에 다른 묶음`);
            // 큰 값을 다시 적은 수치는 하나 빠지고(그 밖의 수치는 그대로), 큰 값과 같은 설명 조각은 없다
            const original = (node.facts || []).filter((fact) => fact && fact.label && String(fact.value ?? '') !== '');
            const restated = restatedFact(model.value, original);
            assert.deepEqual(model.facts.map((fact) => fact.label), original.filter((fact, index) => index !== restated).slice(0, 4).map((fact) => fact.label), `${node.id}: 수치 칸`);
            if (model.value) {
                if (original.length && squash(original[0].value) === squash(model.value)) assert.ok(restated === 0, `${node.id}: 첫 수치가 큰 값과 같으면 뺀다`);
                assert.ok(!model.detail.split(' · ').some((part) => squash(part) === squash(model.value)), `${node.id}: 큰 값과 같은 설명`);
            }
            // 머리의 묶음·종류 이름은 제목과 겹치지 않는다
            assert.notEqual(model.groupName, model.title, `${node.id}: 묶음 이름이 제목과 같음`);
            assert.notEqual(model.kindName, model.title, `${node.id}: 종류 이름이 제목과 같음`);
            assert.ok(model.facts.length <= 4, `${node.id}: 수치는 4개까지`);
            // 버튼 문구는 node.go 그대로
            assert.equal(model.go, node.go === null ? null : (node.go || '본문에서 보기'), `${node.id}: 버튼 문구`);
            // 이름이 같은 서로 다른 점은 값·보조 글자로 구별된다
            const seen = new Map();
            for (const item of model.groups.flatMap((group) => group.items)) {
                const key = `${item.label}|${item.badge}|${item.hint}`;
                if (seen.has(key) && seen.get(key) !== item.id) assert.fail(`${node.id}: 구별되지 않는 같은 이름 '${item.label}'`);
                seen.set(key, item.id);
            }
        }
    });
}

/* ───────── 추천 키워드 카드의 '추천한 이유' = 본문 추천 이유 칩(node.reasons) ───────── */

test('추천 이유: node.reasons 의 개수·순서·문구로 그리고, 이은 점이 있는 이유만 그 점으로 가는 항목이 된다', () => {
    const graph = sample();
    const node = { ...graph.nodeById.get('kw:a'), reasons: [
        { kind: 'review', text: '리뷰 22회', sources: ['rm:1'] },
        { kind: 'category', text: '업종', sources: [] },
        { kind: 'blog', text: '블로그 25/52', sources: ['bt:1'] },
    ] };
    const nodeById = new Map(graph.nodeById).set(node.id, node);
    const model = buildCardModel({ node, links: graph.links, nodeById, ontology: SCHEMA, groupNames: NAMES });
    const reasonGroups = model.groups.filter((group) => group.rel === 'supports' && group.direction === 'in');
    assert.equal(reasonGroups.length, 1); // 같은 이유가 연결 묶음에 또 나오지 않는다
    const items = reasonGroups[0].items;
    assert.deepEqual(items.map((item) => item.label), ['리뷰 22회', '업종', '블로그 25/52']);
    assert.deepEqual(items.map((item) => item.id), ['rm:1', null, 'bt:1']);
    assert.equal(items[0].why, "리뷰에서 22회 나온 '숙성회'가 추천 이유입니다."); // 이은 이유는 연결의 설명을 그대로 가진다
    assert.equal(items[1].linkId, null);
    // 연결로만 센 값이 아니라 이유 목록으로 센 값이 total 에 들어간다
    const others = model.groups.filter((group) => group !== reasonGroups[0]).flatMap((group) => group.items).length;
    assert.equal(model.total, others + 3);
});

test('추천 이유: 이을 점이 하나도 없으면 연결 묶음이 없어도 갈래 순서에 맞는 자리에 문장만 있는 묶음을 만든다', () => {
    const graph = sample();
    const links = graph.links.filter((link) => !(link.rel === 'supports' && link.target === 'kw:a'));
    const node = { ...graph.nodeById.get('kw:a'), reasons: [{ kind: 'category', text: '업종', sources: [] }, { kind: 'myRank', text: '내 6위', sources: [] }] };
    const nodeById = new Map(graph.nodeById).set(node.id, node);
    const model = buildCardModel({ node, links, nodeById, ontology: SCHEMA, groupNames: NAMES });
    const at = model.groups.findIndex((group) => group.rel === 'supports' && group.direction === 'in');
    assert.ok(at >= 0);
    assert.equal(model.groups[at].title, '이 키워드를 추천한 이유');
    assert.deepEqual(model.groups[at].items.map((item) => [item.label, item.id]), [['업종', null], ['내 6위', null]]);
    // 경쟁(순서 1) 묶음 뒤, 키워드 등록(순서 4)·접히는 묶음 앞
    const order = model.groups.map((group) => group.family);
    assert.ok(order.indexOf('competition') < at && (order.indexOf('registration') === -1 || at < order.indexOf('registration')));
    assert.deepEqual(model.groups[at].triple, { subject: null, predicate: '추천 이유가 됨', object: '강남횟집', symmetric: false });
});

test('추천 이유: 이유 문장이 칩 문구를 앞머리만 붙여 되풀이하면 설명 줄을 그리지 않고, 더 알려 주는 문장은 그대로 둔다', () => {
    const graph = sample();
    const links = graph.links.map((link) => {
        if (link.rel !== 'supports' || link.target !== 'kw:a') return link;
        if (link.source === 'rm:1') return { ...link, why: "'강남횟집' 추천 이유: 리뷰 22회." };
        return link;
    });
    const node = { ...graph.nodeById.get('kw:a'), reasons: [
        { kind: 'review', text: '리뷰 22회', sources: ['rm:1'] },
        { kind: 'blog', text: '블로그 25/52', sources: ['bt:1'] },
    ] };
    const nodeById = new Map(graph.nodeById).set(node.id, node);
    const model = buildCardModel({ node, links, nodeById, ontology: SCHEMA, groupNames: NAMES });
    const items = model.groups.find((group) => group.rel === 'supports' && group.direction === 'in').items;
    assert.equal(items[0].why, ''); // 칩과 같은 말뿐이라 지움
    assert.equal(items[1].why, "블로그 25개에 나온 '숙성회'가 추천 이유입니다."); // 칩에 없는 설명은 둠
});

test('추천 이유: reasons 가 없는 점은 지금까지처럼 연결로 그린다', () => {
    const graph = sample();
    const model = buildCardModel({ node: graph.nodeById.get('kw:a'), links: graph.links, nodeById: graph.nodeById, ontology: SCHEMA, groupNames: NAMES });
    assert.deepEqual(applyReasons(model.groups, graph.nodeById.get('kw:a'), SCHEMA), model.groups);
    const reason = model.groups.find((group) => group.rel === 'supports' && group.direction === 'in');
    assert.deepEqual(reason.items.map((item) => item.id).sort(), ['bt:1', 'rm:1']);
});

for (const [name, fixture] of [['약국', PHARMACY], ['음식점', RESTAURANT], ['미용실', SALON]]) {
    test(`${name} 견본: 모든 추천 키워드 카드의 이유 수 = 본문 추천 이유 칩 수(문구·순서도 같다)`, () => {
        const input = graphInput(fixture);
        const graph = buildPlaceGraph(input);
        const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
        const recos = graph.nodes.filter((node) => node.type === 'recoKeyword');
        assert.ok(recos.length > 0);
        for (const node of recos) {
            const item = input.recommendation.items.find((entry) => `kw:${entry.keyword}` === node.id);
            const model = buildCardModel({ node, links: graph.links, nodeById, ontology: ONTOLOGY, groupNames: GROUP_NAMES });
            const reasonGroups = model.groups.filter((group) => group.rel === 'supports' && group.direction === 'in');
            assert.equal(reasonGroups.length, 1, `${node.id}: 이유 묶음`);
            assert.deepEqual(reasonGroups[0].items.map((entry) => entry.label), item.reasons.map((reason) => reason.text), `${node.id}: 카드 이유와 본문 칩`);
        }
    });
}
