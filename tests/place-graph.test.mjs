import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPlaceGraph, buildIdleGraph, summarizeGraph, GRAPH_LIMITS, ONTOLOGY, ontologyFor, itemWord,
    formatNumber, agoLabel, won, shorten, shortenLabel, rankLabel, rankTone, sampleSuffix,
} from '../lib/place-graph.js';
import { scoreGeo, scoreAeo, buildFanout, platformReadiness } from '../lib/place-geo.js';
import { PHARMACY, RESTAURANT, SALON, NOW, graphInput } from './place-graph.fixtures.mjs';

// 견본은 tests/place-graph.fixtures.mjs 에 있습니다(매장 정보는 실제 화면에서 읽은 값, 순위·경쟁 매장 일부는 시험용).
// 네트워크 호출 없이 고정 값으로만 검증합니다.

const SAMPLES = [['약국', PHARMACY], ['음식점', RESTAURANT], ['미용실', SALON]];
const GROUPS = ['store', 'search', 'rival', 'voice', 'pay', 'todo', 'ops', 'geo'];
const TARGET = /^(sec-(summary|rank|reviews|activity|pos|todo|ops|geo)|kw-reco|rank-row-\d+)$/;
const GO = [null, '순위 표 보기', '키워드 순위 보기', '추천 키워드 보기', '리뷰 보기', '활동 보기', '결제 데이터 보기', '할 일 보기', '운영 정보 보기', 'AI 검색 보기'];
// 묶음마다 본문에서 가는 구역과 버튼 문구가 정해져 있다(카드 머리의 묶음 이름과 버튼의 도착지가 어긋나지 않게).
// 경쟁 매장은 본문에 따로 구역이 없고, 키워드 순위 구역의 순위 표 안에 나온다.
const GROUP_TARGET = {
    store: /^sec-summary$/, search: /^(sec-rank|kw-reco|rank-row-\d+)$/, rival: /^sec-rank$/, voice: /^sec-(reviews|activity)$/,
    pay: /^sec-pos$/, todo: /^sec-todo$/, ops: /^sec-ops$/, geo: /^sec-geo$/,
};
const GROUP_GO = {
    store: [null], search: ['키워드 순위 보기', '추천 키워드 보기', '순위 표 보기'], rival: ['키워드 순위 보기', '순위 표 보기'], voice: ['리뷰 보기', '활동 보기'],
    pay: ['결제 데이터 보기'], todo: ['할 일 보기'], ops: ['운영 정보 보기'], geo: ['AI 검색 보기'],
};
const KEYWORD_TYPES = ['keyword', 'recoKeyword', 'queryKeyword'];
// 검색 순위("3위", "300위 밖")에는 누구 것인지 적는다("내 3위", "이 매장 1위").
// 메뉴의 순위는 "주간 인기 1위"처럼 무슨 순위인지 적는다(검색 순위와 섞이지 않게) — 이것은 검색 순위로 세지 않는다
const MENU_RANK = /주간 인기( 메뉴| 순위)? \d+위/g;
const hasSearchRank = (text) => /\d[\d,]*위|위 밖/.test(String(text).replace(MENU_RANK, ''));
const RANK_OWNER = /^(내 |이 매장 )/;
// 화면에 나오는 말에 쓰지 않기로 한 낱말(약어 GEO·AEO 는 설명 문장에만 허용)
const JARGON = /엔티티|노드|필터|범주|소속|재료 점수|온톨로지|트리플|술어/;
const ABBR = /GEO|AEO/;
const { classes: CLASSES, relations: RELATIONS, families: FAMILIES, groups: GROUP_INFO } = ONTOLOGY;

// 온톨로지에 맞지 않아 버려진 점·연결이 없어야 합니다(audit 가 비어 있어야 함).
function build(input, name = '그래프') {
    const audit = [];
    const graph = buildPlaceGraph({ ...input, audit });
    assert.deepEqual(audit, [], `${name}: 온톨로지에 맞지 않아 버린 것이 있음`);
    return graph;
}
const graphOf = (sample, overrides) => build(graphInput(sample, overrides));
const nodeOf = (graph, id) => graph.nodes.find((node) => node.id === id);
const ids = (graph, prefix) => graph.nodes.filter((node) => node.id.startsWith(prefix)).map((node) => node.id);
// (주어 source) —rel→ (목적어 target) 한 건
const linkOf = (graph, source, rel, target) => graph.links.find((link) => link.source === source && link.rel === rel && link.target === target);
// 주어에서 나가는 연결의 목적어들 / 목적어로 들어오는 연결의 주어들
const objectsOf = (graph, source, rel) => graph.links.filter((link) => link.source === source && link.rel === rel).map((link) => link.target);
const subjectsOf = (graph, target, rel) => graph.links.filter((link) => link.target === target && link.rel === rel).map((link) => link.source);
// "주어 —관계→ 목적어" 로 읽기
const sentence = (graph, link) => `${nodeOf(graph, link.source).label} —${RELATIONS[link.rel].label}→ ${nodeOf(graph, link.target).label}`;
// 살펴보기 카드가 그릴 묶음: [제목, [조각 이름〔값〕…]] — 내가 주어면 forward, 목적어면 inverse. 값은 link.badge, 없으면 조각 점의 sub
function cardOf(graph, id, ontology = ONTOLOGY) {
    const groups = new Map();
    for (const [rel, relation] of Object.entries(ontology.relations)) {
        if (relation.quiet) continue;
        for (const link of graph.links) {
            if (link.rel !== rel || (link.source !== id && link.target !== id)) continue;
            const forward = link.source === id;
            const title = forward ? relation.forward : relation.inverse;
            const other = nodeOf(graph, forward ? link.target : link.source);
            const value = link.badge || other.sub;
            groups.set(title, [...(groups.get(title) || []), value ? `${other.label}〔${value}〕` : other.label]);
        }
    }
    return [...groups.entries()];
}

// 모든 그래프가 지켜야 하는 규칙
function assertSound(graph, name) {
    const byId = new Map();
    for (const node of graph.nodes) {
        assert.equal(byId.has(node.id), false, `${name}: id 중복 ${node.id}`);
        byId.set(node.id, node);
    }
    assert.equal(graph.nodes.length <= GRAPH_LIMITS.total, true, `${name}: 전체 ${graph.nodes.length}개`);
    assert.deepEqual(graph.nodes.filter((node) => node.parent === null).map((node) => node.id), ['store'], `${name}: 뿌리는 store 하나`);
    assert.equal(typeof graph.headline === 'string' && graph.headline.length > 0, true, `${name}: headline`);
    assert.equal(JARGON.test(graph.headline) || ABBR.test(graph.headline), false, `${name}: headline 의 말`);

    const spots = [];
    for (const node of graph.nodes) {
        // 개체 종류: 온톨로지에 있는 종류여야 하고, 묶음 점(concept)을 뺀 종류는 정해진 묶음에만 나온다
        const klass = CLASSES[node.type];
        assert.ok(klass, `${name}: ${node.id} 의 type '${node.type}' 이 온톨로지에 없음`);
        if (node.type !== 'concept') assert.equal(node.group, klass.group, `${name}: ${node.id}(${node.type}) 묶음`);
        assert.equal('kind' in node, false, `${name}: ${node.id} 에 kind 가 남아 있음`);
        assert.equal(GROUPS.includes(node.group), true, `${name}: ${node.id} group ${node.group}`);
        assert.equal([0, 1, 2, 3].includes(node.level), true, `${name}: ${node.id} level ${node.level}`);
        assert.equal(Number.isFinite(node.weight) && node.weight >= 0 && node.weight <= 1, true, `${name}: ${node.id} weight ${node.weight}`);
        assert.match(node.target, TARGET, `${name}: ${node.id} target`);
        // 묶음과 도착지가 어긋나지 않는다(카드 머리가 '운영 정보'인데 버튼이 '리뷰 보기'인 일이 없게)
        assert.match(node.target, GROUP_TARGET[node.group], `${name}: ${node.id} 묶음 ${node.group} 의 점이 ${node.target} 로 감`);
        assert.equal(GROUP_GO[node.group].includes(node.go), true, `${name}: ${node.id} 묶음 ${node.group} 의 버튼 '${node.go}'`);
        // 검색 순위에는 누구 것인지 적는다: 키워드 점의 값은 "내 3위", 키워드·경쟁 매장 점의 설명·수치도 주인 없이 순위를 적지 않는다
        if (typeof node.sub === 'string' && hasSearchRank(node.sub)) assert.match(node.sub, RANK_OWNER, `${name}: ${node.id} sub '${node.sub}'`);
        if (['search', 'rival'].includes(node.group)) {
            for (const text of [node.detail, ...(node.facts || []).map((fact) => `${fact.label} ${fact.value}`)]) {
                if (typeof text === 'string' && hasSearchRank(text)) assert.match(text, /내 |이 매장/, `${name}: ${node.id} 주인 없는 순위 '${text}'`);
            }
        }
        // 이름은 낱말 단위로 줄인 것(여유 3자). 설명은 자르지 않은 문장이라 말줄임표로 끝나지 않는다
        assert.equal(typeof node.label === 'string' && node.label.length > 0 && node.label.length <= 17, true, `${name}: ${node.id} label '${node.label}'`);
        if (node.detail !== undefined) assert.equal(typeof node.detail === 'string' && node.detail.length > 0 && !node.detail.endsWith('…'), true, `${name}: ${node.id} detail`);
        // 버튼 문구는 도착지 이름, 읽어 주는 말은 "… 살펴보기"
        assert.equal(GO.includes(node.go), true, `${name}: ${node.id} go '${node.go}'`);
        assert.equal((node.go === null) === (node.id === 'store'), true, `${name}: ${node.id} go`);
        assert.match(node.aria, / 살펴보기$/, `${name}: ${node.id} aria`);
        // 화면에 나오는 말: 어려운 낱말 없음, 약어는 설명에만
        for (const [field, text] of [['label', node.label], ['full', node.full], ['sub', node.sub], ['detail', node.detail], ['go', node.go]]) {
            if (typeof text !== 'string') continue;
            assert.equal(JARGON.test(text), false, `${name}: ${node.id}.${field} '${text}'`);
            if (field !== 'detail') assert.equal(ABBR.test(text), false, `${name}: ${node.id}.${field} 약어 '${text}'`);
        }
        if (node.spot !== undefined) spots.push(node.spot);
        if (node.id === 'store') {
            assert.deepEqual([node.level, node.type], [0, 'store']);
        } else {
            const parent = byId.get(node.parent);
            assert.ok(parent, `${name}: ${node.id} 의 부모 ${node.parent} 없음`);
            assert.equal(node.level, parent.level + 1, `${name}: ${node.id} 단계`);
            if (node.level === 1) assert.equal(node.type, 'concept', `${name}: ${node.id} 묶음의 중심`);
            // 부모를 따라가면 store 에 닿는다
            let current = node;
            for (let hop = 0; hop < 5 && current.parent; hop += 1) current = byId.get(current.parent);
            assert.equal(current.id, 'store', `${name}: ${node.id} 가 store 에 닿지 않음`);
        }
        if (node.facts !== undefined) {
            assert.equal(Array.isArray(node.facts) && node.facts.length >= 1 && node.facts.length <= 4, true, `${name}: ${node.id} facts`);
            for (const fact of node.facts) {
                assert.equal(typeof fact.label === 'string' && fact.label.length > 0 && typeof fact.value === 'string' && fact.value.length > 0, true, `${name}: ${node.id} fact`);
                assert.equal(JARGON.test(fact.label + fact.value) || ABBR.test(fact.label + fact.value), false, `${name}: ${node.id} fact '${fact.label}'`);
            }
        }
    }
    // 먼저 보여 줄 점(spot)은 1~6 사이에서 겹치지 않는다
    assert.equal(spots.every((spot) => Number.isInteger(spot) && spot >= 1 && spot <= 6), true, `${name}: spot 값 ${spots}`);
    assert.equal(new Set(spots).size, spots.length, `${name}: spot 중복 ${spots}`);
    // 묶음 점의 이름은 묶음 이름과 같은 말(범례 = 묶음 점 = 카드 머리)
    for (const node of graph.nodes.filter((item) => item.level === 1)) {
        assert.equal(GROUP_INFO[node.group].label.split('·').includes(node.label) || GROUP_INFO[node.group].label === node.label, true, `${name}: 묶음 점 ${node.id} 이름 '${node.label}'`);
    }

    const linkIds = new Set();
    const triples = new Set();
    for (const link of graph.links) {
        assert.equal(linkIds.has(link.id), false, `${name}: 연결 id 중복 ${link.id}`);
        linkIds.add(link.id);
        const source = byId.get(link.source);
        const target = byId.get(link.target);
        assert.ok(source, `${name}: ${link.id} source 없음`);
        assert.ok(target, `${name}: ${link.id} target 없음`);
        assert.notEqual(link.source, link.target, `${name}: 자기 자신 연결 ${link.id}`);
        // 관계 종류: 온톨로지에 있어야 하고, 주어·목적어의 종류가 그 관계의 from·to 안에 있어야 한다
        const relation = RELATIONS[link.rel];
        assert.ok(relation, `${name}: ${link.id} 의 rel '${link.rel}' 이 온톨로지에 없음`);
        assert.equal(relation.from.includes(source.type), true, `${name}: ${link.id} 주어 종류 ${source.type}`);
        assert.equal(relation.to.includes(target.type), true, `${name}: ${link.id} 목적어 종류 ${target.type}`);
        // 같은 (주어·관계·목적어)는 한 번만. 대칭 관계는 뒤집은 것도 같은 것으로 본다
        const triple = `${link.source}\u0000${link.rel}\u0000${link.target}`;
        assert.equal(triples.has(triple), false, `${name}: 중복 연결 ${link.id}`);
        if (relation.symmetric) assert.equal(triples.has(`${link.target}\u0000${link.rel}\u0000${link.source}`), false, `${name}: 뒤집힌 대칭 연결 ${link.id}`);
        triples.add(triple);
        assert.equal(Number.isFinite(link.strength) && link.strength >= 0 && link.strength <= 1, true, `${name}: ${link.id} strength`);
        if (link.badge !== undefined) assert.equal(typeof link.badge === 'string' && link.badge.length > 0 && link.badge.length <= 16 && !JARGON.test(link.badge), true, `${name}: ${link.id} badge '${link.badge}'`);
        // 조각 값의 검색 순위에는 누구 것인지 적는다("이 매장 2위", "내 3위 → 55점"). rank 는 그 순위의 숫자다
        if (link.badge !== undefined && hasSearchRank(link.badge)) assert.match(link.badge, RANK_OWNER, `${name}: ${link.id} 주인 없는 순위 '${link.badge}'`);
        if (link.rank !== undefined) assert.equal(Number.isInteger(link.rank) && link.rank >= 1 && String(link.badge).includes(`${link.rank}위`), true, `${name}: ${link.id} rank ${link.rank}`);
        // 경쟁 매장과 키워드를 잇는 연결에는 값이 꼭 붙는다(없으면 조각에 키워드 점의 값 = 내 순위가 대신 나온다)
        if (source.type === 'rival' && KEYWORD_TYPES.includes(target.type)) assert.equal(typeof link.badge, 'string', `${name}: ${link.id} 에 조각 값이 없음`);
        // 내 매장과 잇는 연결에도 값이 꼭 붙고, 그 값은 업종 이름이 아니다. 값이 없으면 상대 카드의 조각에 내 매장 점의 값(업종 이름)이
        // 순위 자리에 대신 나온다(약국 카드의 "메가헬스팜약국〔약국〕" 옆에 경쟁 매장은 "〔순위 조회 전〕"이던 것)
        if (link.kind === 'cross' && (source.type === 'store' || target.type === 'store')) {
            const store = byId.get('store');
            assert.equal(typeof link.badge, 'string', `${name}: ${link.id} 에 조각 값이 없어 내 매장 점의 값 '${store.sub}'이 대신 나옴`);
            assert.notEqual(link.badge, store.sub, `${name}: ${link.id} 조각 값이 업종 이름 '${store.sub}'`);
        }
        if (link.kind === 'tree') {
            assert.equal(link.rel, 'partOf', `${name}: ${link.id} 트리 연결`);
            assert.equal(source.parent, link.target, `${name}: ${link.id} 는 자식 → 부모`);
            assert.equal('why' in link, false);
        } else {
            assert.equal(link.kind, 'cross', `${name}: ${link.id} kind`);
            assert.notEqual(link.rel, 'partOf', `${name}: ${link.id} partOf 는 트리 연결에만`);
            assert.equal(typeof link.why === 'string' && link.why.length >= 8, true, `${name}: ${link.id} why`);
            assert.equal(JARGON.test(link.why) || ABBR.test(link.why), false, `${name}: ${link.id} why '${link.why}'`);
            // 이유 문장의 검색 순위에도 주인이 있다(내 매장·내 순위·이 매장)
            if (hasSearchRank(link.why)) assert.match(link.why, /내 매장|내 순위|이 매장/, `${name}: ${link.id} 주인 없는 순위 '${link.why}'`);
        }
    }
    // 점마다 부모로 가는 연결이 꼭 하나씩
    assert.equal(graph.links.filter((link) => link.kind === 'tree').length, graph.nodes.length - 1, `${name}: 부모-자식 연결 수`);
    // 화면으로 넘길 수 있는 값만(undefined·함수 없음)
    assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph, `${name}: JSON 으로 옮길 수 있어야 함`);
}

/* ───────── 스키마 ───────── */

test('스키마: 묶음·종류·갈래·관계에 화면이 쓰는 필드가 빠짐없이 있다', () => {
    assert.deepEqual(Object.keys(ONTOLOGY), ['groups', 'classes', 'families', 'relations']);
    assert.deepEqual(Object.keys(GROUP_INFO), GROUPS);
    assert.deepEqual(Object.values(GROUP_INFO).map((group) => group.label), ['내 매장', '키워드 순위', '경쟁 매장', '리뷰·활동', '결제 데이터', '할 일', '운영 정보', 'AI 검색']);
    assert.deepEqual(Object.values(GROUP_INFO).map((group) => group.order), [0, 1, 2, 3, 4, 5, 6, 7]);

    assert.equal(Object.keys(CLASSES).length, 27);
    for (const [type, klass] of Object.entries(CLASSES)) {
        assert.equal(typeof klass.label === 'string' && klass.label.length > 0, true, type);
        // 묶음 점(concept)만 모든 묶음에 걸쳐 있어 group 이 없고, 카드 머리에 종류 이름을 쓰지 않는다(quiet)
        if (type === 'concept') assert.deepEqual([klass.group, klass.quiet], [null, true]);
        else assert.deepEqual([GROUPS.includes(klass.group), klass.quiet], [true, undefined], type);
    }
    for (const group of GROUPS) assert.equal(Object.values(CLASSES).some((klass) => klass.group === group), true, `${group} 묶음에 속한 종류`);

    assert.deepEqual(Object.entries(FAMILIES).map(([key, family]) => `${family.order} ${key} ${family.label}${family.quiet ? ' 숨김' : ''}`), [
        '1 competition 경쟁 매장', '2 action 할 일', '3 evidence 추천 이유·손님 말', '4 registration 키워드 등록·지역', '5 same 같은 것끼리', '6 ai AI 검색 준비', '7 structure 묶음 숨김',
    ]);

    assert.equal(Object.keys(RELATIONS).length, 21);
    for (const [rel, relation] of Object.entries(RELATIONS)) {
        for (const key of ['name', 'label', 'forward', 'inverse', 'family']) assert.equal(typeof relation[key] === 'string' && relation[key].length > 0, true, `${rel}.${key}`);
        assert.ok(FAMILIES[relation.family], `${rel} 의 갈래 ${relation.family}`);
        for (const side of ['from', 'to']) {
            assert.equal(Array.isArray(relation[side]) && relation[side].length > 0, true, `${rel}.${side}`);
            assert.equal(new Set(relation[side]).size, relation[side].length, `${rel}.${side} 중복`);
            for (const type of relation[side]) assert.ok(CLASSES[type], `${rel}.${side} 의 '${type}' 이 종류 목록에 없음`);
        }
    }
    // 키 순서가 곧 화면에 나오는 순서: 갈래 order 순으로 모여 있다
    const orders = Object.values(RELATIONS).map((relation) => FAMILIES[relation.family].order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
    assert.deepEqual(Object.keys(RELATIONS), [
        'outranks', 'ranksIn', 'sharesTerm', 'lagsOn', 'targets', 'suggests', 'alternativeTo', 'missingFor', 'supports', 'spokenIn', 'mentions',
        'registers', 'usesRegion', 'readFrom', 'sameItem', 'namedIn', 'atTime', 'feeds', 'answers', 'weakens', 'partOf',
    ]);
    // 숨기는 것은 구조 관계 하나(partOf)뿐이고, 숨김 갈래에는 그것만 들어 있다
    assert.deepEqual(Object.keys(RELATIONS).filter((rel) => RELATIONS[rel].quiet), ['partOf']);
    assert.deepEqual(Object.keys(RELATIONS).filter((rel) => FAMILIES[RELATIONS[rel].family].quiet), ['partOf']);
    assert.deepEqual(Object.keys(RELATIONS).filter((rel) => RELATIONS[rel].symmetric), ['sameItem']);
    assert.equal(Object.isFrozen(ONTOLOGY) && Object.isFrozen(RELATIONS) && Object.isFrozen(RELATIONS.supports) && Object.isFrozen(RELATIONS.supports.from), true);
});

test('스키마의 말: 쉬운 낱말만 쓰고, 묶음 제목(forward·inverse)은 "아래 조각이 나에게 무엇인지"를 말하는 명사구다', () => {
    const texts = [
        ...Object.values(GROUP_INFO).map((group) => group.label),
        ...Object.values(CLASSES).map((klass) => klass.label),
        ...Object.values(FAMILIES).map((family) => family.label),
        ...Object.values(RELATIONS).flatMap((relation) => [relation.name, relation.label, relation.forward, relation.inverse]),
    ];
    for (const text of texts) assert.equal(JARGON.test(text) || ABBR.test(text) || /지표|플랫폼|근거|재료/.test(text), false, text);

    for (const [rel, relation] of Object.entries(RELATIONS)) {
        // 이름과 묶음 제목은 명사로 끝난다(서술형 끝말 '-함·-됨·있음·없음·같음·-임·-씀·-다' 가 아님). 술어(label)는 문장용이라 예외
        for (const key of ['name', 'forward', 'inverse']) assert.equal(/(함|됨|[있없같]음|임|씀|다|요)$/.test(relation[key]), false, `${rel}.${key} '${relation[key]}'`);
        // 방향이 있는 관계는 두 방향의 제목이 달라야 카드에서 거꾸로 읽히지 않는다
        assert.equal(relation.forward === relation.inverse, relation.symmetric === true, `${rel} 의 forward·inverse`);
        assert.equal(relation.name.length <= 14, true, `${rel}.name 길이`);
    }
    // 같은 제목이 두 관계에 쓰이면 카드에서 묶음을 가릴 수 없다
    const titles = Object.values(RELATIONS).flatMap((relation) => (relation.symmetric ? [relation.forward] : [relation.forward, relation.inverse]));
    assert.equal(new Set(titles).size, titles.length);
    const names = Object.values(RELATIONS).map((relation) => relation.name);
    assert.equal(new Set(names).size, names.length);

    assert.deepEqual([RELATIONS.supports.name, RELATIONS.supports.label, RELATIONS.supports.forward, RELATIONS.supports.inverse],
        ['추천 이유', '추천 이유가 됨', '이것을 이유로 추천한 키워드', '이 키워드를 추천한 이유']);
    assert.deepEqual([RELATIONS.outranks.name, RELATIONS.outranks.inverse, RELATIONS.ranksIn.name, RELATIONS.ranksIn.inverse],
        ['내 위에 있는 매장', '이 키워드에서 내 위에 있는 매장', '내 아래에 있는 매장', '이 키워드에서 내 아래에 있는 매장']);
    assert.deepEqual([RELATIONS.targets.name, RELATIONS.targets.forward, RELATIONS.targets.inverse], ['고칠 것', '이 할 일로 고칠 것', '이것을 고치는 할 일']);
    assert.deepEqual([RELATIONS.feeds.name, RELATIONS.feeds.forward, RELATIONS.feeds.inverse], ['AI가 참고하는 정보', '이 정보가 들어가는 AI 점검', '이 점검에 들어가는 정보']);
    assert.deepEqual([RELATIONS.partOf.forward, RELATIONS.partOf.inverse, RELATIONS.partOf.quiet], ['속한 곳', '여기에 든 것', true]);
});

test('ontologyFor: 업종에 맞는 낱말(메뉴·시술·메뉴·서비스)로 바꾼 같은 구조의 스키마를 준다', () => {
    assert.deepEqual([itemWord(RESTAURANT.place), itemWord(SALON.place), itemWord(PHARMACY.place), itemWord(null), itemWord({ category: '카페,디저트' }), itemWord({ category: '네일샵' })],
        ['메뉴', '시술', '메뉴·서비스', '메뉴·서비스', '메뉴', '시술']);
    const food = ontologyFor(RESTAURANT.place);
    const hair = ontologyFor(SALON.place);
    assert.deepEqual([food.classes.reviewMenu.label, food.classes.menu.label, food.relations.sameItem.name, food.relations.namedIn.forward, food.relations.namedIn.inverse],
        ['리뷰에 나온 메뉴', '등록한 메뉴', '같은 메뉴', '이 이름이 들어간 메뉴', '이 이름에 들어 있는 메뉴']);
    assert.deepEqual([hair.classes.reviewMenu.label, hair.classes.menu.label, hair.relations.sameItem.name, hair.relations.sameItem.forward],
        ['리뷰에 나온 시술', '등록한 시술', '같은 시술', '이름이 같은 시술']);
    // 한식당에는 '시술'이, 미용실에는 '메뉴'가 스키마 어디에도 나오지 않는다
    assert.equal(JSON.stringify(food).includes('시술'), false);
    assert.equal(JSON.stringify(hair).includes('메뉴'), hair.classes.popularMenu.label.includes('메뉴'));
    assert.deepEqual(Object.entries(hair.classes).filter(([, klass]) => klass.label.includes('메뉴')).map(([type]) => type), ['popularMenu']); // POS 집계 이름(음식점에만 있음)
    // 매장을 모르거나 그 밖의 업종이면 기본 스키마(ONTOLOGY)와 같은 객체, 같은 업종이면 늘 같은 객체
    assert.equal(ontologyFor(PHARMACY.place), ONTOLOGY);
    assert.equal(ontologyFor(null), ONTOLOGY);
    assert.equal(ontologyFor(RESTAURANT.place), food);
    assert.notEqual(food, hair);
    // 키와 구조(from·to·family)는 같고 말만 다르다
    for (const variant of [food, hair]) {
        assert.deepEqual(Object.keys(variant.classes), Object.keys(CLASSES));
        assert.deepEqual(Object.keys(variant.relations), Object.keys(RELATIONS));
        for (const rel of Object.keys(RELATIONS)) {
            assert.deepEqual([variant.relations[rel].from, variant.relations[rel].to, variant.relations[rel].family], [RELATIONS[rel].from, RELATIONS[rel].to, RELATIONS[rel].family], rel);
        }
        assert.deepEqual(variant.groups, GROUP_INFO);
        assert.deepEqual(variant.families, FAMILIES);
    }
    // 그래프의 점 이름도 같은 낱말을 쓴다
    assert.deepEqual([nodeOf(graphOf(RESTAURANT), 'rv:menu').label, nodeOf(graphOf(RESTAURANT), 'rv:menu').full], ['언급된 메뉴', '많이 언급된 메뉴']);
    assert.deepEqual([nodeOf(graphOf(SALON), 'rv:menu').label, nodeOf(graphOf(SALON), 'rv:menu').full], ['언급된 시술', '많이 언급된 시술']);
});

// 견본에 없는 상황(순위가 끝난 조회 키워드, 리뷰 주제·메뉴·영업시간이 추천 이유인 경우 등)을 모은 시험용 입력.
// 추천·할 일은 화면이 넘기는 모양 그대로 손으로 적었습니다(실제 매장의 값이 아님).
function extraInput() {
    const base = RESTAURANT.place;
    const place = {
        ...base,
        keywords: ['강남구청횟집'],
        reviewVotes: [],
        reviewThemes: [{ label: '분위기', count: 31 }],
        reviewMenus: [{ label: '소금김밥', count: 20 }, { label: '바지락칼국수', count: 12 }, { label: '댄디컷', count: 9 }],
        detail: {
            ...base.detail,
            menus: [
                { name: '칼국수', price: '11,000원', hasImage: false, recommended: false },
                { name: '대물볼락구이', price: '29,000원', hasImage: true, recommended: false },
                { name: '시험컷', price: '30,000원', hasImage: null, recommended: false },
            ],
            styles: [{ name: '시험컷', count: 30 }, { name: '시스루댄디컷', count: 12 }],
            pos: { ...base.detail.pos, popularMenus: [{ name: '소금김밥', count: 276, share: 12, change: 'SAME' }, { name: '볼락구이', count: 143, share: 6, change: 'UP' }] },
        },
    };
    const activity = { ...RESTAURANT.activity, briefing: ['분위기가 좋고 볼락구이가 맛있다는 리뷰가 많아요.'], mentions: null };
    const signals = {
        count: 99, visitorReviews: { median: 5000, best: 9000 }, blogReviews: { median: 10, best: 800 }, score: { median: null, best: null },
        images: { median: null, best: null }, save: { median: null, best: null },
        features: { booking: { have: 0, known: 0 }, order: { have: 0, known: 0 }, coupon: { have: 0, known: 0 }, membership: { have: 0, known: 0 }, npay: { have: 0, known: 0 }, pos: { have: 0, known: 0 } },
    };
    const rival = (rank) => ({ rank, placeId: 'q1', name: '시험상위식당', isTarget: false, visitorReviews: 9000, blogReviews: 800 });
    const ranks = [
        { keyword: '시험역점심', state: 'done', result: { keyword: '시험역점심', placeId: place.placeId, status: 'found', rank: 20, total: 100, scanned: 100, target: null, top: [rival(1)], topSignals: signals } },
        { keyword: '시험역저녁', state: 'done', result: { keyword: '시험역저녁', placeId: place.placeId, status: 'found', rank: 1, total: 40, scanned: 40, target: null, top: [rival(2)], topSignals: null } },
    ];
    const item = (keyword, term, reasons) => ({ keyword, region: '시험역', term, source: 'review', score: 50, reasons, blog: null, rivalCount: 0, registered: false, registrable: true });
    const recommendation = {
        regions: [], slotsLeft: 4, rivalCount: 1, hasRegionKeyword: true, blogTotal: null,
        items: [
            item('시험역분위기식당', '분위기식당', [{ kind: 'fact', text: "리뷰 주제 '분위기'" }, { kind: 'fact', text: "메뉴 '칼국수'" }, { kind: 'fact', text: '23시 이후까지 영업' }]),
            item('시험역볼락구이', '볼락구이', [{ kind: 'pos', text: '주간 인기 메뉴' }, { kind: 'fact', text: '네이버 AI 브리핑' }, { kind: 'fact', text: '점심 시간 영업' }]),
        ],
        registered: [{ keyword: '강남구청횟집', hasRegion: true, region: '강남구청', core: '횟집', blog: 0, rivalCount: 0, suggest: null, spoken: { term: '볼락구이', blog: 3, keyword: '시험역볼락구이' } }],
    };
    const actions = [{ key: 'accessor', level: 'low', title: '찾아오는 길 안내 없음', detail: '주차 위치·가까운 정류장·건물 입구를 적어 두면 처음 오는 손님이 헤매지 않습니다. 스마트플레이스 > 업체정보 > 찾아오는 길에서 씁니다.', link: null }];
    return { place, activity, ranks, rivals: {}, rivalPool: [{ placeId: 'q1', name: '시험상위식당', keywords: ['시험역점심'] }], recommendation, actions, nowMs: NOW };
}

// 정보가 거의 없는 매장: AI가 묻는 질문 대부분에 답하지 못한다
function sparseInput() {
    const place = { placeId: '7', name: '빈 매장', category: '카페', address: '', visitorReviews: 0, blogReviews: 0, keywords: [], reviewVotes: [], reviewThemes: [], reviewMenus: [], conveniences: [], detail: null };
    return { place, nowMs: NOW };
}

test('스키마: 정의만 있고 쓰이지 않는 종류·관계가 없다', () => {
    const tally = (graphs) => {
        const used = { types: new Set(), rels: new Set(), from: new Set(), to: new Set() };
        for (const graph of graphs) {
            const typeOf = new Map(graph.nodes.map((node) => [node.id, node.type]));
            for (const node of graph.nodes) used.types.add(node.type);
            for (const link of graph.links) {
                used.rels.add(link.rel);
                used.from.add(`${link.rel} ← ${typeOf.get(link.source)}`);
                used.to.add(`${link.rel} → ${typeOf.get(link.target)}`);
            }
        }
        return used;
    };
    // 1) 견본 세 곳(약국·음식점·미용실)만으로 모든 개체 종류와 모든 관계 종류가 한 번 이상 나온다.
    //    '조회한 키워드'만은 추천에 없는 키워드를 사장님이 직접 넣어 조회해야 생긴다
    //    (쓸모 관문에서 걸러진 "청주심야약국"을 직접 조회한 경우. 전에는 추천 13·15번째라 12개 밖이던 "청주영양제"·"청주동물약국"이 그 자리였다).
    const typedIn = graphOf(PHARMACY, { ranks: [...PHARMACY.ranks, { keyword: '청주심야약국', state: 'loading' }] });
    assert.deepEqual([nodeOf(typedIn, 'kw:청주심야약국').type, nodeOf(typedIn, 'kw:청주심야약국').sub], ['queryKeyword', '조회 중']);
    assert.deepEqual(Object.keys(CLASSES).filter((type) => !tally(SAMPLES.map(([, sample]) => graphOf(sample))).types.has(type)), ['queryKeyword']);
    const samples = tally([...SAMPLES.map(([, sample]) => graphOf(sample)), typedIn]);
    assert.deepEqual(Object.keys(CLASSES).filter((type) => !samples.types.has(type)), []);
    assert.deepEqual(Object.keys(RELATIONS).filter((rel) => !samples.rels.has(rel)), []);

    // 2) 관계마다 적어 둔 주어·목적어 종류(from·to)도 빠짐없이 실제로 나온다.
    //    견본에 없는 상황은 시험용 입력으로 채운다. 여기서도 안 나오는 종류가 있으면 스키마에서 빼야 한다.
    const extra = build(extraInput(), '보강 입력');
    const sparse = build(sparseInput(), '빈 매장');
    // 메뉴는 등록했지만 가격을 하나도 적지 않은 매장(결제 집계도 없음): 가격대 질문에 답할 정보가 비어 있다
    const unpriced = build({ place: { ...SALON.place, menuPricedCount: 0 }, nowMs: NOW }, '가격 없는 가격표');
    // 추천 키워드가 쓸모 관문을 거친 뒤로 견본에서 사라진 조합을 채우는 변형 셋(모두 화면에서 실제로 생기는 상황):
    //  - 추천 목록(12개) 밖의 조합을 사장님이 직접 조회한 경우: 조회한 키워드가 '대신 써 볼 키워드'·'키워드 속 손님 말'의 자리에 온다
    const pharmacyInput = graphInput(PHARMACY);
    const beyondList = build({ ...pharmacyInput, recommendation: { ...pharmacyInput.recommendation, items: pharmacyInput.recommendation.items.filter((item) => item.term !== '영양제') } }, '목록 밖 조합');
    assert.deepEqual([nodeOf(beyondList, 'kw:청주영양제').type, objectsOf(beyondList, 'kw:청주영양제', 'alternativeTo'), subjectsOf(beyondList, 'kw:청주영양제', 'spokenIn')], ['queryKeyword', ['kw:건강기능식품'], ['bm:영양제']]);
    //  - 블로그 언급을 묻지 못한 추천 낱말("대형약국"): 그 키워드에 들어 있는 다른 낱말("약국")의 블로그 언급과 이어진다
    const mentions = PHARMACY.activity.mentions;
    const unasked = graphOf({ ...PHARMACY, activity: { ...PHARMACY.activity, mentions: { ...mentions, terms: mentions.terms.filter((entry) => entry.term !== '대형약국') } } });
    assert.equal(linkOf(unasked, 'bm:약국', 'spokenIn', 'kw:청주대형약국').why, "'청주대형약국'에 들어 있는 낱말 '약국'이 블로그 후기 11개 중 11개에 나옵니다.");
    //  - "점심"을 등록하지 않은 음식점: 추천 키워드 "강남구청점심"이 점심 시간대 결제와 이어진다
    const lunchReco = graphOf({ ...RESTAURANT, place: { ...RESTAURANT.place, keywords: ['강남구청횟집'] }, ranks: [] });
    assert.deepEqual([nodeOf(lunchReco, 'kw:강남구청점심').type, objectsOf(lunchReco, 'kw:강남구청점심', 'atTime')], ['recoKeyword', ['pos:slot:lunch']]);
    const variants = [['보강 입력', extra], ['빈 매장', sparse], ['가격 없는 가격표', unpriced], ['직접 조회', typedIn], ['목록 밖 조합', beyondList], ['묻지 못한 낱말', unasked], ['점심 미등록', lunchReco]];
    for (const [name, graph] of variants) assertSound(graph, name);
    const all = tally([...SAMPLES.map(([, sample]) => graphOf(sample)), ...variants.map(([, graph]) => graph)]);
    const idle = [];
    for (const [rel, relation] of Object.entries(RELATIONS)) {
        for (const type of relation.from) if (!all.from.has(`${rel} ← ${type}`)) idle.push(`${rel} ← ${type}`);
        for (const type of relation.to) if (!all.to.has(`${rel} → ${type}`)) idle.push(`${rel} → ${type}`);
    }
    assert.deepEqual(idle, []);

    // 보강 입력에서 생긴 연결을 몇 개 직접 확인한다
    assert.deepEqual([nodeOf(extra, 'kw:시험역점심').type, nodeOf(extra, 'kw:시험역저녁').type], ['queryKeyword', 'queryKeyword']);
    assert.equal(linkOf(extra, 'rival:q1', 'registers', 'kw:시험역점심').why, "'시험상위식당'이 '시험역점심'을 대표키워드로 등록했습니다(내 매장은 등록하지 않음). 이 키워드에서 이 매장은 1위, 내 매장은 20위입니다.");
    assert.deepEqual([linkOf(extra, 'rival:q1', 'outranks', 'kw:시험역점심').badge, linkOf(extra, 'rival:q1', 'outranks', 'kw:시험역점심').rank], ['이 매장 1위', 1]); // 내 20위보다 위
    assert.equal(linkOf(extra, 'rival:q1', 'ranksIn', 'kw:시험역저녁').why, "'시험상위식당'은 '시험역저녁' 검색 2위로, 내 매장(1위)보다 아래에 있습니다.");
    assert.ok(linkOf(extra, 'kw:시험역점심', 'lagsOn', 'rv:visitor'));
    assert.ok(linkOf(extra, 'kw:시험역점심', 'atTime', 'pos:slot:lunch'));
    assert.ok(linkOf(extra, 'kw:시험역점심', 'feeds', 'gf:competition'));
    assert.deepEqual([linkOf(extra, 'theme:분위기', 'supports', 'kw:시험역분위기식당').why, linkOf(extra, 'theme:분위기', 'supports', 'kw:시험역분위기식당').badge],
        ["'시험역분위기식당' 추천 이유: 리뷰 주제 '분위기'.", '리뷰 31회']);
    assert.equal(linkOf(extra, 'menu:칼국수', 'supports', 'kw:시험역분위기식당').badge, '등록 메뉴');
    assert.deepEqual([linkOf(extra, 'ops:hours', 'supports', 'kw:시험역분위기식당').why, linkOf(extra, 'ops:hours', 'supports', 'kw:시험역분위기식당').badge],
        ["'시험역분위기식당' 추천 이유: 23시 이후까지 영업(등록한 영업시간).", '영업시간']);
    assert.deepEqual([linkOf(extra, 'pmenu:볼락구이', 'supports', 'kw:시험역볼락구이').why, linkOf(extra, 'pmenu:볼락구이', 'supports', 'kw:시험역볼락구이').badge],
        ["'시험역볼락구이'의 낱말 '볼락구이'는 주간 인기 메뉴 2위입니다.", '주간 인기 2위']);
    assert.equal(linkOf(extra, 'brief:0', 'supports', 'kw:시험역볼락구이').why, "네이버 AI 브리핑 문장에 '볼락구이'가 나옵니다.");
    // "점심 시간 영업"의 이유는 점심 결제 집계가 있으면 그것이다
    assert.equal(linkOf(extra, 'pos:slot:lunch', 'supports', 'kw:시험역볼락구이').why, "'시험역볼락구이' 추천 이유: 점심 시간대 결제가 있습니다(1회 평균 77,898원).");
    assert.equal(linkOf(extra, 'ops:hours', 'supports', 'kw:시험역볼락구이'), undefined);
    assert.ok(linkOf(extra, 'kw:시험역볼락구이', 'alternativeTo', 'kw:강남구청횟집'));
    assert.deepEqual(objectsOf(extra, 'brief:0', 'mentions'), ['theme:분위기', 'pmenu:볼락구이']);
    assert.ok(linkOf(extra, 'rmenu:소금김밥', 'sameItem', 'pmenu:소금김밥'));
    assert.ok(linkOf(extra, 'style:시험컷', 'sameItem', 'menu:시험컷'));
    assert.ok(linkOf(extra, 'pmenu:볼락구이', 'namedIn', 'menu:대물볼락구이'));
    assert.ok(linkOf(extra, 'menu:칼국수', 'namedIn', 'rmenu:바지락칼국수'));
    assert.ok(linkOf(extra, 'rmenu:댄디컷', 'namedIn', 'style:시스루댄디컷'));
    assert.ok(linkOf(extra, 'todo:accessor', 'targets', 'fq:location'));
    // 손님이 고른 좋은 점이 없으면 평판 질문의 답은 방문자 리뷰 수에서 나온다
    assert.match(linkOf(extra, 'rv:visitor', 'answers', 'fq:reputation').why, /의 답에 이 정보가 쓰입니다\.$/);
    assert.equal(subjectsOf(sparse, 'ai:chatgpt', 'weakens').includes('geo:fanout'), true);
    // 리뷰가 하나도 없으면 평판 질문에 답할 정보(방문자 리뷰)가 비어 있다
    assert.equal(sentence(sparse, linkOf(sparse, 'rv:visitor', 'missingFor', 'fq:reputation')), '방문자 리뷰 —비어 있어 답하지 못함→ 평판');
    assert.equal(nodeOf(sparse, 'rv:visitor').sub, '0개');
    assert.equal(sentence(unpriced, linkOf(unpriced, 'ops:menu', 'missingFor', 'fq:price')), '메뉴·가격 —비어 있어 답하지 못함→ 가격대');
    assert.deepEqual([nodeOf(unpriced, 'ops:menu').sub, nodeOf(unpriced, 'ops:menu').facts[0]], ['5개', { label: '가격', value: '모두 없음', tone: 'warn' }]);
    assert.equal(linkOf(unpriced, 'ops:menu', 'answers', 'fq:price'), undefined);
});

/* ───────── 그래프 전체 ───────── */

test('세 업종 견본 모두 점·연결 규칙과 스키마를 지키고 80~200개 사이의 점을 낸다', () => {
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        assertSound(graph, name);
        const summary = summarizeGraph(graph);
        assert.equal(summary.nodes >= 80 && summary.nodes <= 200, true, `${name}: 점 ${summary.nodes}개`);
        assert.equal(summary.cross >= 60, true, `${name}: 교차 연결 ${summary.cross}개`);
        assert.equal(summary.levels['3'] > 0, true, `${name}: 세부 단계`);
        assert.equal(summary.rels.partOf, summary.nodes - 1, `${name}: 트리 연결`);
    }
});

test('연결은 "주어 —관계→ 목적어" 문장으로 읽힌다', () => {
    const pharmacy = graphOf(PHARMACY);
    const restaurant = graphOf(RESTAURANT);
    const salon = graphOf(SALON);
    const read = (graph, source, rel, target) => {
        const link = linkOf(graph, source, rel, target);
        assert.ok(link, `${source} ${rel} ${target}`);
        return sentence(graph, link);
    };
    assert.equal(read(pharmacy, 'store', 'registers', 'kw:일반의약품'), '메가헬스팜약국 —대표키워드로 등록함→ 일반의약품');
    assert.equal(read(pharmacy, 'rival:2021608686', 'registers', 'kw:청주약국'), '메가타운약국 청주점 —대표키워드로 등록함→ 청주약국');
    assert.equal(read(pharmacy, 'rival:2021608686', 'outranks', 'kw:청주약국'), '메가타운약국 청주점 —검색에서 내 매장보다 위→ 청주약국');
    assert.equal(read(pharmacy, 'rival:test-ochang-1', 'ranksIn', 'kw:오창약국'), '오창시험약국 —검색에서 내 매장보다 아래→ 오창약국');
    assert.equal(read(pharmacy, 'vote:제품 종류가 다양해요', 'supports', 'kw:청주대형약국'), '제품 종류가 다양해요 —추천 이유가 됨→ 청주대형약국');
    assert.equal(read(pharmacy, 'bm:일반의약품', 'spokenIn', 'kw:일반의약품'), '일반의약품 —이 키워드에 들어 있음→ 일반의약품');
    assert.equal(read(pharmacy, 'kw:청주약국', 'usesRegion', 'region:청주'), '청주약국 —이 지역 이름을 씀→ 청주');
    assert.equal(read(pharmacy, 'kw:청주약국', 'lagsOn', 'rv:visitor'), '청주약국 —검색 상위권보다 뒤처진 숫자→ 방문자 리뷰');
    assert.equal(read(pharmacy, 'kw:청주영양제', 'alternativeTo', 'kw:건강기능식품'), '청주영양제 —대신 써 볼 만함→ 건강기능식품');
    assert.equal(read(pharmacy, 'todo:photos', 'targets', 'ops:photos'), '업체 사진 0장 —이 할 일로 고침→ 업체 사진');
    assert.equal(read(pharmacy, 'todo:keywords', 'suggests', 'kw:청주약국'), '대표키워드 4/5개 —써 보라고 권함→ 청주약국');
    assert.equal(read(pharmacy, 'ops:hours', 'answers', 'fq:hours'), '영업시간 —질문의 답이 됨→ 영업시간');
    assert.equal(read(pharmacy, 'ops:booking', 'missingFor', 'fq:booking'), '네이버 예약 —비어 있어 답하지 못함→ 예약·문의');
    assert.equal(read(pharmacy, 'ac:coupon', 'missingFor', 'fq:payment'), '쿠폰 —비어 있어 답하지 못함→ 쿠폰·혜택');
    assert.equal(read(pharmacy, 'vote:친절해요', 'partOf', 'rv:vote'), '친절해요 —여기에 속함→ 손님이 고른 좋은 점');
    assert.equal(read(restaurant, 'rmenu:김밥', 'namedIn', 'pmenu:소금김밥'), '김밥 —이름에 들어 있음→ 소금김밥');
    assert.equal(read(restaurant, 'pmenu:소금김밥', 'sameItem', 'menu:소금김밥'), '소금김밥 —이름이 같음→ 소금김밥');
    assert.equal(read(restaurant, 'region:강남구청', 'readFrom', 'ops:subway'), '강남구청 —역 이름에서 따옴→ 가까운 역');
    assert.equal(read(restaurant, 'rv:visitor', 'feeds', 'gf:reviews'), '방문자 리뷰 —AI 점검에 들어감→ 리뷰 수·평점');
    assert.equal(read(restaurant, 'pos:price', 'answers', 'fq:price'), '1회 평균 결제 —질문의 답이 됨→ 가격대');
    assert.equal(read(restaurant, 'gf:sameAs', 'weakens', 'ai:chatgpt'), '홈페이지·SNS 연결 —AI 준비 점수를 낮춤→ ChatGPT');
    assert.equal(read(restaurant, 'brief:0', 'mentions', 'rmenu:숙성회'), '숙성회와 소금김밥을… —문장에서 말함→ 숙성회');
    assert.equal(read(restaurant, 'kw:강남구청점심', 'atTime', 'pos:slot:lunch'), '강남구청점심 —같은 시간대→ 점심 평균 결제');
    assert.equal(read(restaurant, 'rival:test-r1', 'sharesTerm', 'kw:강남구청숙성회'), '시험바다횟집 —키워드에 같은 낱말을 씀→ 강남구청숙성회');
    assert.equal(read(salon, 'store', 'registers', 'kw:댄디컷'), '제이디로얄 맨즈헤어 강남점 —대표키워드로 등록함→ 댄디컷');
    assert.equal(read(salon, 'style:댄디컷', 'supports', 'kw:강남역댄디컷'), '댄디컷 —추천 이유가 됨→ 강남역댄디컷');
    assert.equal(read(salon, 'rmenu:댄디컷', 'sameItem', 'style:댄디컷'), '댄디컷 —이름이 같음→ 댄디컷');
    assert.equal(read(salon, 'style:다운펌', 'namedIn', 'menu:컷+다운펌'), '다운펌 —이름에 들어 있음→ 컷+다운펌');
    assert.equal(read(salon, 'ops:booking', 'answers', 'fq:booking'), '네이버 예약 —질문의 답이 됨→ 예약·문의');
    // 같은 두 점 사이에 관계가 둘일 수 있다(등록함 + 내 위에 있음). 같은 관계는 하나뿐이다
    const between = pharmacy.links.filter((link) => link.source === 'rival:2021608686' && link.target === 'kw:청주약국').map((link) => link.rel);
    assert.deepEqual(between, ['registers', 'outranks']);
});

test('살펴보기 카드: 묶음 제목이 방향에 맞게 갈리고 조각에 값이 붙는다(내 순위 3위면 내 위에는 1·2위 매장만)', () => {
    const restaurant = graphOf(RESTAURANT);
    const food = ontologyFor(RESTAURANT.place);
    // 대표키워드 '강남구청횟집'(내 순위 3위)
    const keyword = nodeOf(restaurant, 'kw:강남구청횟집');
    // 순위는 sub 에만 있고(누구 순위인지 적음: 내 3위), facts 는 그 밖의 수치다
    assert.equal(keyword.sub, '내 3위');
    assert.deepEqual(keyword.facts, [
        { label: '검색된 매장', value: '214곳' }, { label: '블로그 후기 언급', value: '52개 중 30개' },
        { label: '이 키워드를 등록한 매장', value: '3곳(내 매장 포함)' }, { label: '등록 상태', value: '대표키워드로 등록함' },
    ]);
    assert.deepEqual(cardOf(restaurant, 'kw:강남구청횟집', food), [
        ['이 키워드에서 내 위에 있는 매장', ['시험바다횟집〔이 매장 1위〕', '시험청담수산〔이 매장 2위〕']],
        ['이 키워드에서 내 아래에 있는 매장', ['시험논현어시장〔이 매장 4위〕', '시험학동회관〔이 매장 5위〕']],
        ['이 키워드에서 상위권보다 뒤처진 숫자', ['방문자 리뷰〔상위권 중간 900개〕']],
        // 값은 두 키워드를 잇는 낱말이다(양쪽 카드에 다 나오므로 한쪽의 종류 '대표키워드'를 적지 않는다)
        ['이것을 이유로 추천한 키워드', ["강남횟집〔'횟집'〕", "논현횟집〔'횟집'〕"]],
        ['이 키워드에 들어 있는 블로그 낱말', ['횟집〔블로그 30개〕']],
        // 한 묶음에 내 순위와 경쟁 매장의 순위가 나란히 나오므로 누구 순위인지 적는다(내 매장 조각에 업종 '한식'이 나오던 자리)
        ['이 키워드를 등록한 매장', ['대물섬 강남점〔내 3위〕', '시험바다횟집〔이 매장 1위〕', '시험청담수산〔이 매장 2위〕']],
        ['이 키워드에 들어 있는 지역 이름', ['강남구청〔역 주변〕']],
        // '대표키워드 순위' 조각의 값은 항목 점수(15점)가 아니라 이 키워드의 몫(내 3위 → 55점)이다
        ['이 정보가 들어가는 AI 점검', ['키워드·리뷰 일치〔100점〕', '대표키워드 순위〔내 3위 → 55점〕']],
    ]);
    // 숫자가 서로 맞는다: "등록한 매장 3곳"과 그 묶음의 조각 수, 내 순위 3위와 내 위 2곳
    assert.equal(subjectsOf(restaurant, keyword.id, 'registers').length, 3);
    assert.deepEqual(subjectsOf(restaurant, keyword.id, 'outranks').map((id) => linkOf(restaurant, id, 'outranks', keyword.id).rank), [1, 2]);
    assert.deepEqual(subjectsOf(restaurant, keyword.id, 'ranksIn').map((id) => linkOf(restaurant, id, 'ranksIn', keyword.id).rank), [4, 5]);

    // 경쟁 매장 쪽에서 보면 같은 연결이 반대 제목으로 읽힌다
    assert.deepEqual(cardOf(restaurant, 'rival:test-r3', food), [
        ['이 매장이 내 위에 있는 키워드', ['강남구청회식〔이 매장 1위〕', '강남구청점심〔이 매장 2위〕', '압구정회식〔이 매장 2위〕']],
        ['이 매장이 내 아래에 있는 키워드', ['강남구청횟집〔이 매장 4위〕']],
        // ("점심"에 지역만 바꾼 "압구정점심"·"강남점심"은 이제 추천하지 않아, 낱말이 겹치는 추천 키워드 묶음은 없다)
        // 등록한 키워드에도 이 매장의 순위를 붙인다. 붙이지 않으면 키워드 점의 값(내 순위 12위)이 나와, 위 묶음의 "2위"와 어긋나 보였다
        ['등록한 대표키워드', ['논현횟집〔순위 조회 전〕', '강남구청점심〔이 매장 2위〕', '강남횟집〔순위 조회 전〕']],
    ]);
    // 낱말이 겹치는 추천 키워드는 "숙성회"를 등록한 매장에서 볼 수 있다
    // ("압구정숙성회"는 이제 추천하지 않는다: 압구정 키워드의 내 순위가 41위·300위 밖이고, 숙성회는 지역 하나만 권한다)
    assert.deepEqual(cardOf(restaurant, 'rival:test-r2', food).find(([title]) => title === '이 매장과 낱말이 겹치는 추천 키워드'),
        ['이 매장과 낱말이 겹치는 추천 키워드', ["강남구청숙성회〔'숙성회'〕"]]);
    // 추천 키워드: '추천한 이유'(받는 쪽)와 '이유로 추천한 키워드'(주는 쪽)가 한 카드에 섞이지 않는다
    assert.deepEqual(cardOf(restaurant, 'kw:강남횟집', food), [
        ['이 키워드를 추천한 이유', ["강남구청횟집〔'횟집'〕", "압구정횟집〔'횟집'〕", '횟집〔블로그 30개〕']],
        ['이 키워드를 등록한 매장', ['시험바다횟집〔순위 조회 전〕', '시험논현어시장〔순위 조회 전〕']],
        ['이 키워드에 들어 있는 지역 이름', ['강남〔구〕']],
    ]);
    // 이름이 같은 조각은 값으로 가려진다(주간 인기 메뉴의 주문 비율 / 등록 메뉴의 가격).
    // 횟집의 "김밥"은 곁들임 메뉴라 추천 키워드("강남구청김밥")가 없어, 이것을 이유로 추천한 키워드 묶음도 없다
    assert.deepEqual(cardOf(restaurant, 'rmenu:김밥', food), [
        ['이것을 말한 AI 브리핑 문장', ['숙성회와 소금김밥을…']],
        ['이 이름이 들어간 메뉴', ['소금김밥〔주문 12%〕', '소금김밥〔4,000원〕']],
    ]);
    // 이름과 값이 나뉘어 있어 조각이 "이름〔값〕"으로 읽힌다
    assert.deepEqual(cardOf(restaurant, 'todo:reply', food), [['이 할 일로 고칠 것', ['답글률〔40%〕']]]);
    assert.deepEqual(cardOf(restaurant, 'fq:booking', food), [['채워야 답할 수 있는 정보', ['네이버 예약〔없음〕']]]);
    assert.deepEqual(cardOf(restaurant, 'ai:chatgpt', food), [['이 AI에서 점수가 낮은 항목', ['홈페이지·SNS 연결〔25점〕', '가격·예약·문의〔67점〕']]]);
    assert.deepEqual(cardOf(restaurant, 'store', food), [['등록한 대표키워드', ['강남구청횟집〔내 3위〕', '강남구청점심〔내 12위〕', '강남구청회식〔내 5위〕', '압구정횟집〔내 41위〕', '압구정회식〔내 300위 밖〕']]]);
    const salon = graphOf(SALON);
    assert.deepEqual(cardOf(salon, 'style:다운펌', ontologyFor(SALON.place)), [
        ['이것을 이유로 추천한 키워드', ['강남역다운펌〔예약 437건〕']],
        ['이름이 같은 시술', ['다운펌〔리뷰 1,259회〕']],
        ['이 이름이 들어간 시술', ['컷+다운펌〔63,000원〕']],
    ]);
});

test('순위에는 누구 것인지 적는다: 한 카드에 같은 키워드의 순위가 주인 없이 두 가지로 나오지 않는다', () => {
    // 세 견본의 모든 카드: 조각에 붙는 검색 순위는 "내 ○위" 아니면 "이 매장 ○위"이고, 한 카드 안에서 같은 조각의 순위는 한 가지다
    let checked = 0;
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        const ontology = ontologyFor(sample.place);
        for (const node of graph.nodes) {
            const seen = new Map();
            for (const [title, chips] of cardOf(graph, node.id, ontology)) {
                for (const chip of chips) {
                    const [, label, value] = chip.match(/^(.*)〔(.+)〕$/) || [];
                    if (!value || !hasSearchRank(value)) continue;
                    checked += 1;
                    assert.match(value, RANK_OWNER, `${name} ${node.id} ▸ ${title}: ${chip}`);
                    const rank = value.match(/^(내|이 매장) [\d,]+위( 밖)?/)[0];
                    if (seen.has(label)) assert.equal(rank, seen.get(label), `${name} ${node.id}: '${label}'의 순위가 두 가지`);
                    seen.set(label, rank);
                }
            }
        }
    }
    assert.equal(checked > 100, true, `순위가 붙은 조각 ${checked}개`);

    // 음식점: '시험논현어시장'은 '강남구청점심'에서 2위, 내 매장은 12위다. 전에는 이 매장의 카드에 "2위"와 "12위"가 주인 없이 나왔다
    const restaurant = graphOf(RESTAURANT);
    assert.equal(nodeOf(restaurant, 'kw:강남구청점심').sub, '내 12위');
    const above = linkOf(restaurant, 'rival:test-r3', 'outranks', 'kw:강남구청점심');
    assert.deepEqual([above.badge, above.rank, above.why], ['이 매장 2위', 2, "'시험논현어시장'은 '강남구청점심' 검색 2위로, 내 매장(12위)보다 위에 있습니다."]);
    const lunch = linkOf(restaurant, 'rival:test-r3', 'registers', 'kw:강남구청점심');
    assert.deepEqual([lunch.badge, lunch.rank, lunch.why],
        ['이 매장 2위', 2, "'시험논현어시장'이 '강남구청점심'을 대표키워드로 등록했습니다(내 매장도 등록). 이 키워드에서 이 매장은 2위, 내 매장은 12위입니다."]);
    // 내 매장 → 키워드에는 내 순위
    const mine = linkOf(restaurant, 'store', 'registers', 'kw:강남구청점심');
    assert.deepEqual([mine.badge, mine.rank], ['내 12위', 12]);
    const far = linkOf(restaurant, 'store', 'registers', 'kw:압구정회식');
    assert.deepEqual([far.badge, 'rank' in far], ['내 300위 밖', false]);
    // 순위를 조회하지 않은 키워드에는 순위를 지어내지 않는다
    const unranked = linkOf(restaurant, 'rival:test-r3', 'registers', 'kw:강남횟집');
    assert.deepEqual([unranked.badge, 'rank' in unranked, unranked.why], ['순위 조회 전', false, "'시험논현어시장'이 '강남횟집'을 대표키워드로 등록했습니다(내 매장은 등록하지 않음)."]);
    // 지역 이름이 없는 등록 키워드는 자동 순위 조회에서 빼므로 "조회 전"이 아니라 "조회 안 함"이다. 내 매장·경쟁 매장 조각에 같은 말을 쓴다
    // (전에는 내 매장 조각에 값이 없어 내 매장 점의 값 = 업종 이름 '약국'이 순위 자리에 나왔다)
    const pharmacy = graphOf(PHARMACY);
    assert.deepEqual([linkOf(pharmacy, 'store', 'registers', 'kw:일반의약품').badge, 'rank' in linkOf(pharmacy, 'store', 'registers', 'kw:일반의약품')], ['지역 없어 조회 안 함', false]);
    assert.equal(linkOf(pharmacy, 'rival:13247713', 'registers', 'kw:일반의약품').badge, '지역 없어 조회 안 함');
    assert.deepEqual(cardOf(pharmacy, 'kw:일반의약품').find(([title]) => title === '이 키워드를 등록한 매장'),
        ['이 키워드를 등록한 매장', ['메가헬스팜약국〔지역 없어 조회 안 함〕', '오송메가파워약국〔지역 없어 조회 안 함〕']]);
    // 지역 이름이 있는데 아직 조회하지 않은 내 키워드는 "순위 조회 전"
    const notYet = graphOf(RESTAURANT, { ranks: RESTAURANT.ranks.filter((row) => row.keyword !== '압구정회식') });
    assertSound(notYet, '등록 키워드 하나를 아직 조회하지 않은 음식점');
    assert.equal(linkOf(notYet, 'store', 'registers', 'kw:압구정회식').badge, '순위 조회 전');
    // 모든 견본의 모든 카드: 매장 조각(내 매장·경쟁 매장)의 값에 업종 이름이 나오지 않는다
    for (const [name, sample] of [...SAMPLES, ['순위 조회 전 약국', { ...PHARMACY, ranks: [] }], ['순위 조회 전 미용실', { ...SALON, ranks: [] }]]) {
        const graph = graphOf(sample);
        const categories = new Set([sample.place.category, ...sample.ranks.flatMap((row) => row.result?.top || []).map((top) => top.category)].filter(Boolean));
        for (const node of graph.nodes) {
            for (const [title, chips] of cardOf(graph, node.id, ontologyFor(sample.place))) {
                for (const chip of chips) {
                    const [, label, value] = chip.match(/^(.*)〔(.+)〕$/) || [];
                    const shop = graph.nodes.find((other) => other.label === label && ['store', 'rival'].includes(other.type));
                    if (shop && value) assert.equal(categories.has(value), false, `${name} ${node.id} ▸ ${title}: ${chip}`);
                }
            }
        }
    }

    // 순위는 조회했는데 상위 목록에 그 매장이 없으면 "○위 밖"까지만 적는다(상위 목록에 든 곳까지만 안다)
    const apgujeong = RESTAURANT.ranks.find((row) => row.keyword === '압구정횟집'); // 상위 3곳: 시험압구정수산 · 시험로데오횟집 · 시험바다횟집, 내 매장 41위
    const more = graphOf(RESTAURANT, {
        ranks: [...RESTAURANT.ranks, { keyword: '강남횟집', state: 'done', result: { ...apgujeong.result, keyword: '강남횟집' } }, { keyword: '논현횟집', state: 'loading' }],
    });
    assertSound(more, '순위를 더 조회한 음식점');
    const outside = linkOf(more, 'rival:test-r3', 'registers', 'kw:강남횟집');
    assert.deepEqual([outside.badge, 'rank' in outside, outside.why],
        ['이 매장 3위 밖', false, "'시험논현어시장'이 '강남횟집'을 대표키워드로 등록했습니다(내 매장은 등록하지 않음). 이 키워드의 상위 3곳 안에 이 매장은 없고, 내 매장은 41위입니다."]);
    const inside = linkOf(more, 'rival:test-r1', 'registers', 'kw:강남횟집');
    assert.deepEqual([inside.badge, inside.rank], ['이 매장 3위', 3]);
    assert.equal(linkOf(more, 'rival:test-r3', 'registers', 'kw:논현횟집').badge, '순위 조회 중');
    const failed = graphOf(RESTAURANT, { ranks: [...RESTAURANT.ranks, { keyword: '논현횟집', state: 'error', error: '순위를 조회하지 못했습니다.' }] });
    assertSound(failed, '조회에 실패한 음식점');
    assert.equal(linkOf(failed, 'rival:test-r3', 'registers', 'kw:논현횟집').badge, '순위 조회 실패');
});

test('묶음과 도착지: 카드 머리의 묶음과 버튼이 가는 구역이 같다(예약 많은 스타일은 본문처럼 리뷰·활동 묶음)', () => {
    // 본문에서 "예약 많은 스타일"은 리뷰 구역의 목록이다. 전에는 묶음이 '운영 정보'인데 버튼은 '리뷰 보기'였다
    const salon = graphOf(SALON);
    const hub = nodeOf(salon, 'ops:style');
    assert.deepEqual([hub.group, hub.parent, hub.type, hub.target, hub.go], ['voice', 'hub:voice', 'concept', 'sec-reviews', '리뷰 보기']);
    const styles = salon.nodes.filter((node) => node.type === 'style');
    assert.equal(styles.length, 6);
    for (const node of styles) assert.deepEqual([node.group, node.parent, node.target, node.go], ['voice', 'ops:style', 'sec-reviews', '리뷰 보기'], node.id);
    assert.equal(ontologyFor(SALON.place).classes.style.group, 'voice');

    // 세 견본의 모든 점: 묶음마다 정해진 구역으로만 가고, 버튼 문구에 그 묶음 이름의 낱말이 들어 있다
    // (경쟁 매장만 예외: 본문에 따로 구역이 없고 키워드 순위 구역의 순위 표 안에 나온다)
    let checked = 0;
    for (const [name, sample] of SAMPLES) {
        for (const node of graphOf(sample).nodes) {
            checked += 1;
            assert.match(node.target, GROUP_TARGET[node.group], `${name}: ${node.id} 묶음 ${node.group} → ${node.target}`);
            assert.equal(GROUP_GO[node.group].includes(node.go), true, `${name}: ${node.id} 버튼 '${node.go}'`);
            if (node.group === 'store' || node.group === 'rival') continue;
            const label = GROUP_INFO[node.group].label;
            const words = label.split(/[·\s]+/).filter((word) => word.length >= 2);
            assert.equal(node.go.includes(label) || words.some((word) => node.go.includes(word)), true, `${name}: ${node.id} 묶음 '${label}' 과 버튼 '${node.go}'`);
        }
    }
    // 음식점은 쓸모 관문(주력 갈래 밖 곁들임·순위가 나쁜 지역)으로 추천 키워드가 11개에서 8개로 줄어 165 → 162
    assert.equal(checked, 111 + 162 + 134);
});

test('기존 id 를 그대로 내고(본문 카드의 data-node 와 이어짐), 이름은 label·값은 sub 로 나눠 적는다', () => {
    const input = graphInput(RESTAURANT);
    const graph = build(input);
    const expected = [
        'store', 'hub:voice', 'rv:visitor', 'rv:blog', 'rv:score', 'rv:vote', 'hub:activity', 'ac:reply', 'ac:week', 'ac:feed', 'ac:coupon',
        'hub:pos', 'pos:sales', 'pos:price', 'pos:day', 'pos:menu', 'hub:todo', 'hub:ops', 'ops:hours', 'ops:photos', 'ops:booking', 'hub:geo',
        ...RESTAURANT.place.keywords.map((word) => `kw:${word}`),
        ...input.actions.map((item) => `todo:${item.key}`),
    ];
    for (const id of expected) assert.ok(nodeOf(graph, id), id);
    assert.deepEqual(input.actions.map((item) => item.key), ['reply', 'feed', 'coupon', 'booking', 'talktalk']);

    const store = nodeOf(graph, 'store');
    assert.deepEqual([store.label, store.sub, store.go, store.target, store.level, store.type, store.aria], ['대물섬 강남점', '한식', null, 'sec-summary', 0, 'store', '대물섬 강남점, 한식 살펴보기']);
    assert.equal(store.detail, '네이버 플레이스에 등록된 내 매장입니다. 숫자는 플레이스 화면에 공개된 값입니다.');
    assert.deepEqual(store.facts, [{ label: '방문자 리뷰', value: '323개' }, { label: '블로그·카페 리뷰', value: '52개' }, { label: '평점', value: '4.97점' }, { label: '대표키워드', value: '5/5개' }]);

    const keyword = nodeOf(graph, 'kw:강남구청횟집');
    assert.deepEqual(
        [keyword.parent, keyword.level, keyword.group, keyword.type, keyword.sub, keyword.subTone, keyword.tone, keyword.target, keyword.keyword, keyword.go, keyword.aria],
        ['hub:search', 2, 'search', 'keyword', '내 3위', 'good', 'good', 'rank-row-0', '강남구청횟집', '순위 표 보기', '강남구청횟집, 내 3위 살펴보기'],
    );
    assert.equal(keyword.detail, '네이버 플레이스에서 이 키워드를 검색했을 때 내 매장이 나온 순서입니다.');
    assert.equal(nodeOf(graph, 'kw:압구정횟집').tone, 'ink'); // 41위
    assert.deepEqual([nodeOf(graph, 'kw:압구정회식').sub, nodeOf(graph, 'kw:압구정회식').tone], ['내 300위 밖', 'bad']);
    assert.equal(nodeOf(graph, 'kw:압구정회식').detail, '네이버 플레이스 검색 결과를 살펴본 범위 안에서 내 매장을 찾지 못했습니다.');

    // [이름, 값] — 캔버스에는 "이름 값"으로, 카드에는 제목과 큰 값으로 나온다
    const named = (id) => [nodeOf(graph, id).label, nodeOf(graph, id).sub];
    assert.deepEqual(named('rv:visitor'), ['방문자 리뷰', '323개']);
    assert.deepEqual(named('rv:blog'), ['블로그·카페 리뷰', '52개']);
    assert.deepEqual(named('rv:score'), ['평점', '4.97점']);
    assert.deepEqual(named('ac:reply'), ['답글률', '40%']);
    assert.deepEqual(named('ac:feed'), ['마지막 소식', '46일 전']);
    assert.deepEqual(named('ac:coupon'), ['쿠폰', '0개']);
    assert.deepEqual(named('pos:sales'), ['주간 결제', '2,281건']);
    assert.deepEqual(named('pos:price'), ['1회 평균 결제', '172,645원']);
    assert.deepEqual(named('pos:day'), ['가장 붐비는 요일', '금요일']);
    assert.deepEqual(named('pos:slot:lunch'), ['점심 평균 결제', '77,898원']);
    assert.deepEqual(named('pos:peak:friday'), ['금요일', '18시']);
    assert.deepEqual(named('ops:hours'), ['영업시간', '등록됨']);
    assert.deepEqual(named('ops:photos'), ['업체 사진', '12장']);
    assert.deepEqual(named('ops:booking'), ['네이버 예약', '없음']);
    assert.deepEqual(named('ops:subway'), ['가까운 역', '강남구청역']);
    assert.deepEqual(named('ops:parking'), ['주차', '가능 (유료)']);
    assert.deepEqual(named('ops:menu'), ['메뉴·가격', '34개']);
    assert.deepEqual(named('geo:score'), ['AI 추천 준비', '74점']);
    // 줄여 쓴 이름은 full 에 전체 이름이 있다
    assert.deepEqual([nodeOf(graph, 'ac:reply').full, nodeOf(graph, 'pos:sales').full, nodeOf(graph, 'pos:peak:friday').full], ['사장님 답글률', '주간 결제 건수', '금요일 가장 붐비는 시간']);
    assert.deepEqual([nodeOf(graph, 'rv:visitor').type, nodeOf(graph, 'rv:visitor').go, nodeOf(graph, 'rv:visitor').aria], ['reviewMetric', '리뷰 보기', '방문자 리뷰, 323개 살펴보기']);
    assert.deepEqual([nodeOf(graph, 'ac:reply').tone, nodeOf(graph, 'ac:reply').subTone, nodeOf(graph, 'ac:reply').type, nodeOf(graph, 'ac:reply').go], ['warn', 'warn', 'activityMetric', '활동 보기']);
    assert.deepEqual([nodeOf(graph, 'ac:feed').tone, nodeOf(graph, 'ac:coupon').tone], ['warn', 'warn']);
    assert.deepEqual([nodeOf(graph, 'pos:sales').type, nodeOf(graph, 'pos:sales').go], ['payMetric', '결제 데이터 보기']);
    assert.deepEqual([nodeOf(graph, 'ops:hours').tone, nodeOf(graph, 'ops:hours').type, nodeOf(graph, 'ops:hours').go], ['good', 'opsItem', '운영 정보 보기']);
    assert.equal(nodeOf(graph, 'ops:booking').tone, 'warn');
    assert.deepEqual([nodeOf(graph, 'todo:reply').tone, nodeOf(graph, 'todo:coupon').tone, nodeOf(graph, 'todo:reply').type, nodeOf(graph, 'todo:reply').go], ['warn', 'ink', 'task', '할 일 보기']);

    // 목록 카드(손님이 고른 좋은 점·주간 인기 메뉴)는 작은 묶음 점이 되고 낱개가 그 아래에 달린다
    assert.deepEqual([nodeOf(graph, 'rv:vote').level, nodeOf(graph, 'rv:vote').type], [2, 'concept']);
    const vote = nodeOf(graph, 'vote:음식이 맛있어요');
    assert.deepEqual([vote.parent, vote.level, vote.sub, vote.type], ['rv:vote', 3, '손님 299명', 'strength']);
    assert.deepEqual([nodeOf(graph, 'pmenu:소금김밥').parent, nodeOf(graph, 'pmenu:소금김밥').sub, nodeOf(graph, 'pmenu:소금김밥').facts, nodeOf(graph, 'pmenu:소금김밥').type],
        ['pos:menu', '주문 12%', [{ label: '주간 인기 순위', value: '1위' }], 'popularMenu']);
    assert.deepEqual([nodeOf(graph, 'pos:slot:lunch').parent, nodeOf(graph, 'pos:slot:lunch').type], ['pos:price', 'timeSlot']);
    assert.deepEqual([nodeOf(graph, 'pos:peak:friday').parent, nodeOf(graph, 'pos:peak:friday').type], ['pos:day', 'timeSlot']);
    // 내 매장 → 등록한 대표키워드
    assert.deepEqual(objectsOf(graph, 'store', 'registers'), RESTAURANT.place.keywords.map((word) => `kw:${word}`));
    assert.equal(linkOf(graph, 'store', 'registers', 'kw:강남구청횟집').why, '내 매장이 스마트플레이스에 등록한 대표키워드 5개 가운데 하나입니다. 지역 이름이 들어 있는 키워드입니다.');
});

test('묶음 이름은 하나: 범례·묶음 점·빈 화면 골격이 같은 이름을 쓴다', () => {
    const graph = graphOf(RESTAURANT);
    const hubs = graph.nodes.filter((node) => node.level === 1).map((node) => [node.id, node.group, node.label, node.full]);
    assert.deepEqual(hubs, [
        ['hub:search', 'search', '키워드 순위', undefined], ['hub:rival', 'rival', '경쟁 매장', undefined], ['hub:voice', 'voice', '리뷰', undefined], ['hub:activity', 'voice', '활동', undefined],
        ['hub:pos', 'pay', '결제 데이터', undefined], ['hub:todo', 'todo', '할 일', undefined], ['hub:ops', 'ops', '운영 정보', undefined], ['hub:geo', 'geo', 'AI 검색', undefined],
    ]);
    // 개수·상태는 이름이 아니라 sub 에 둔다
    assert.deepEqual([nodeOf(graph, 'hub:todo').sub, nodeOf(graph, 'hub:todo').subTone, nodeOf(graph, 'hub:todo').detail], ['5개', 'warn', '지금 채우거나 고치면 좋은 항목을 급한 것부터 놓았습니다.']);
    assert.deepEqual(nodeOf(graph, 'hub:todo').facts, [{ label: '먼저 할 일', value: '0개' }]);
    // 먼저 할 일이 있으면 빨간 값. 9개 가운데 8개만 점이 되므로 그 사실을 설명에 적는다
    const pharmacyTodo = nodeOf(graphOf(PHARMACY), 'hub:todo');
    assert.deepEqual([pharmacyTodo.sub, pharmacyTodo.subTone, pharmacyTodo.facts], ['9개', 'bad', [{ label: '먼저 할 일', value: '4개', tone: 'bad' }]]);
    assert.equal(pharmacyTodo.detail, '지금 채우거나 고치면 좋은 항목을 급한 것부터 놓았습니다. 그래프에는 급한 순서로 8개만 보여 줍니다.');
    assert.deepEqual([nodeOf(graphOf(SALON), 'hub:todo').sub, nodeOf(graphOf(SALON), 'hub:todo').tone], ['없음', 'good']);
    assert.deepEqual([nodeOf(graph, 'rival-keywords').label, nodeOf(graph, 'rival-keywords').full], ['경쟁 매장 키워드', '경쟁 매장만 등록한 대표키워드']);
    // '상위 매장'이라는 말은 그래프에서 쓰지 않는다(경쟁 매장으로 통일)
    for (const [name, sample] of SAMPLES) {
        const text = JSON.stringify(graphOf(sample));
        assert.equal(text.includes('상위 매장'), false, name);
    }
    // 빈 화면 골격의 묶음 7개도 같은 이름
    assert.deepEqual(buildIdleGraph(false).nodes.filter((node) => node.level === 1).map((node) => [node.group, node.label]),
        [['search', '키워드 순위'], ['rival', '경쟁 매장'], ['voice', '리뷰·활동'], ['pay', '결제 데이터'], ['todo', '할 일'], ['ops', '운영 정보'], ['geo', 'AI 검색']]);
});

test('데이터가 없으면 점도 없다', () => {
    // 약국: POS·평점·리뷰 주제·리뷰 메뉴·가까운 역·메뉴·AI 브리핑이 없다
    const pharmacy = graphOf(PHARMACY);
    assert.deepEqual(pharmacy.nodes.filter((node) => node.group === 'pay'), []);
    for (const id of ['hub:pos', 'pos:menu', 'rv:score', 'rv:theme', 'rv:menu', 'rv:briefing', 'ops:subway', 'ops:menu', 'ops:style', 'ops:seat', 'ops:links']) {
        assert.equal(nodeOf(pharmacy, id), undefined, id);
    }
    // 블로그 후기에 한 번도 안 나온 낱말은 점이 아니다
    assert.equal(nodeOf(pharmacy, 'bm:건강기능식품'), undefined);
    assert.equal(nodeOf(graphOf(SALON), 'bm:가르마펌'), undefined);
    assert.equal(ids(pharmacy, 'bm:').length, 7);

    // 매장 요약만 있을 때: 활동·순위·추천·상세가 없어도 예외 없이 뼈대만 낸다
    const bare = { placeId: '1', name: '이름만 있는 집', category: '카페', address: '', visitorReviews: 0, blogReviews: 0, keywords: ['라떼'], reviewVotes: [], reviewThemes: [], reviewMenus: [], conveniences: [], detail: null };
    const graph = build({ place: bare, activity: null, ranks: [], recommendation: null, actions: [], nowMs: NOW });
    assertSound(graph, '뼈대');
    assert.deepEqual(summarizeGraph(graph).groups, { store: 1, search: 2, voice: 4, todo: 1, geo: 30 });
    assert.deepEqual(graph.nodes.filter((node) => node.level === 1).map((node) => node.id), ['hub:search', 'hub:voice', 'hub:activity', 'hub:todo', 'hub:geo']);
    assert.deepEqual([nodeOf(graph, 'hub:activity').label, nodeOf(graph, 'hub:activity').sub, nodeOf(graph, 'hub:activity').tone], ['활동', '확인 불가', 'muted']);
    assert.deepEqual([nodeOf(graph, 'hub:todo').label, nodeOf(graph, 'hub:todo').sub, nodeOf(graph, 'hub:todo').tone], ['할 일', '없음', 'good']);
    assert.deepEqual([nodeOf(graph, 'kw:라떼').detail, nodeOf(graph, 'kw:라떼').type, nodeOf(graph, 'kw:라떼').go], ['아직 순위를 조회하지 않았습니다.', 'keyword', '키워드 순위 보기']);
    assert.equal(nodeOf(graph, 'hub:rival'), undefined);
    assert.equal(graph.headline, '할 일 없음');
    assert.equal(graph.nodes.some((node) => node.spot), false);

    // 대표키워드가 하나도 없으면 없는 것을 점으로 만들지 않고 묶음 점에 그 사실을 적는다
    const none = build({ place: { ...bare, keywords: [] }, nowMs: NOW });
    assertSound(none, '키워드 없음');
    assert.equal(ids(none, 'kw:').length, 0);
    assert.deepEqual([nodeOf(none, 'hub:search').label, nodeOf(none, 'hub:search').sub, nodeOf(none, 'hub:search').tone], ['키워드 순위', '대표키워드 없음', 'bad']);
    assert.equal(nodeOf(none, 'hub:search').detail, '등록한 대표키워드가 없습니다. 스마트플레이스에서 5개까지 등록할 수 있습니다');
    assert.equal(nodeOf(none, 'hub:search').facts, undefined); // '대표키워드 0/5개'는 sub 와 같은 말이라 적지 않는다

    // 값이 비어 들어와도(null·undefined) 죽지 않는다
    const loose = build({ place: { ...bare, keywords: null }, activity: undefined, ranks: null, rivals: null, rivalPool: null, recommendation: undefined, actions: null, nowMs: NOW });
    assertSound(loose, '빈 값');
    assert.deepEqual([nodeOf(loose, 'hub:search').sub, nodeOf(loose, 'hub:search').tone], ['키워드 확인 불가', 'muted']);
    // 매장이 없으면 빈 화면 골격을 돌려준다
    assert.deepEqual(buildPlaceGraph({ place: null }), buildIdleGraph(false));
    assert.deepEqual(buildPlaceGraph(), buildIdleGraph(false));
});

/* ───────── 점의 이름·설명·출처 ───────── */

test('이름은 낱말 단위로 줄이고, 설명은 자르지 않는다', () => {
    // 조금 넘치는 것(여유 3자)은 그대로 둔다
    assert.equal(shortenLabel('제품 종류가 다양해요', 9), '제품 종류가 다양해요');
    assert.equal(shortenLabel('메가타운약국 청주점', 10), '메가타운약국 청주점');
    // 괄호 속 덧말을 먼저 빼 본다
    assert.equal(shortenLabel('(한정)대물 순살 갈치조림', 9), '대물 순살 갈치조림');
    assert.equal(shortenLabel('큰사랑약국 [공공심야약국]', 10), '큰사랑약국');
    assert.equal(shortenLabel('대물 숙성회 정식(광어+시마아지)', 9), '대물 숙성회 정식');
    assert.equal(shortenLabel('맛보기보쌈(100g)', 9), '맛보기보쌈(100g)');
    // 그래도 길면 낱말 사이에서 끊는다(낱말 중간에서 끊지 않음)
    assert.equal(shortenLabel('원하는 스타일로 잘해줘요 정말', 9), '원하는 스타일로…');
    assert.equal(shortenLabel('숙성회와 소금김밥을 함께 주문하는 손님이 많아요.', 12), '숙성회와 소금김밥을…');
    // 띄어쓰기가 없는 긴 낱말만 글자 수로 끊는다
    assert.equal(shortenLabel('가나다라마바사아자차카타파하', 9), '가나다라마바사아자…');
    assert.deepEqual([shortenLabel('', 9), shortenLabel(null, 9), shortenLabel('  짧은   이름 ', 9)], ['', '', '짧은 이름']);

    const restaurant = graphOf(RESTAURANT);
    assert.deepEqual([nodeOf(restaurant, 'menu:(한정)대물 순살 갈치조림').label, nodeOf(restaurant, 'menu:(한정)대물 순살 갈치조림').full], ['대물 순살 갈치조림', '(한정)대물 순살 갈치조림']);
    assert.equal(nodeOf(restaurant, 'menu:맛보기보쌈(100g)').label, '맛보기보쌈(100g)');
    assert.equal(nodeOf(restaurant, 'vote:단체모임 하기 좋아요').label, '단체모임 하기 좋아요');
    // 문장 전체는 full 에(카드의 제목), 설명에는 어디에 나오는 문장인지만
    assert.deepEqual([nodeOf(restaurant, 'brief:0').label, nodeOf(restaurant, 'brief:0').full, nodeOf(restaurant, 'brief:0').detail],
        ['숙성회와 소금김밥을…', '숙성회와 소금김밥을 함께 주문하는 손님이 많아요.', '네이버가 매장 화면의 AI 브리핑에 보여 주는 문장입니다.']);
    // 할 일 설명은 본문과 같은 전체 문장(전에는 60자에서 끊겼음)
    const input = graphInput(PHARMACY);
    const pharmacy = build(input);
    for (const item of input.actions.slice(0, GRAPH_LIMITS.todo)) {
        const node = nodeOf(pharmacy, `todo:${item.key}`);
        assert.deepEqual([node.full, node.detail], [item.title, item.detail], item.key);
        assert.equal(node.detail.length > 30, true);
    }
    assert.equal(nodeOf(pharmacy, 'todo:photos').detail.length > 60, true);
    // 제목이 길어 줄이면 뜻이 사라지는 할 일은 짧은 이름을 따로 둔다
    assert.deepEqual([nodeOf(pharmacy, 'todo:keywordRegion').label, nodeOf(pharmacy, 'todo:keywordRegion').full], ['키워드에 지역 이름 없음', '대표키워드 4개 모두 지역명 없음']);
    assert.deepEqual([nodeOf(pharmacy, 'todo:keywordSpoken').label, nodeOf(pharmacy, 'todo:keywordSpoken').full], ['손님이 쓰는 말로 바꾸기', "'건강기능식품'보다 '영양제'"]);
    assert.equal(nodeOf(pharmacy, 'rival:13177688').label, '큰사랑약국');
    // AI 점검 항목과 질문의 설명도 자르지 않는다
    assert.equal(nodeOf(restaurant, 'fq:location').detail, '대물섬 강남점은 서울 강남구 언주로148길 14 1층 103~106호에 있습니다. 강남구청역 3-1번 출구에서 걸어서 12분 거리입니다.');
    assert.equal(nodeOf(restaurant, 'ai:naver').detail, '플레이스 정보·리뷰·소식·블로그·카페(네이버 안 정보)에서 정보를 가져갑니다. 점수는 매장 정보만 보고 매긴 혼잘마 자체 점검 값입니다.');
});

test('낱말 점의 sub 에 출처가 붙는다: 같은 낱말이 여러 목록에 나와도 어디서 센 숫자인지 알 수 있다', () => {
    const graph = graphOf(RESTAURANT);
    // '숙성회'는 리뷰 메뉴와 블로그 낱말 두 곳에 나온다
    assert.deepEqual([nodeOf(graph, 'rmenu:숙성회').label, nodeOf(graph, 'rmenu:숙성회').sub], ['숙성회', '리뷰 22회']);
    assert.deepEqual([nodeOf(graph, 'bm:숙성회').label, nodeOf(graph, 'bm:숙성회').sub], ['숙성회', '블로그 25/52']);
    assert.deepEqual([nodeOf(graph, 'bm:횟집').sub, nodeOf(graph, 'bm:횟집').detail], ['블로그 30/52', '블로그 후기 가운데 이 낱말이 나온 글의 수입니다(나온 글 / 전체 글).']);
    assert.equal(nodeOf(graph, 'vote:음식이 맛있어요').sub, '손님 299명');
    assert.equal(nodeOf(graph, 'theme:맛').sub, '리뷰 216회');
    assert.equal(nodeOf(graph, 'pmenu:소금김밥').sub, '주문 12%');
    assert.equal(nodeOf(graph, 'menu:소금김밥').sub, '4,000원');
    assert.equal(nodeOf(graphOf(SALON), 'style:댄디컷').sub, '예약 554건');
    // 블로그 전체 글 수를 모르면 '개'로 적는다
    const input = graphInput(RESTAURANT);
    const noTotal = build({ ...input, activity: { ...input.activity, mentions: { blogTotal: null, terms: input.activity.mentions.terms } } });
    assert.deepEqual([nodeOf(noTotal, 'bm:횟집').sub, nodeOf(noTotal, 'bm:횟집').detail], ['블로그 30개', '블로그 후기 가운데 이 낱말이 나온 글의 수입니다.']);
    // 출처가 붙는 종류의 점은 모두 sub 가 출처 낱말로 시작한다
    for (const [name, sample] of SAMPLES) {
        for (const node of graphOf(sample).nodes) {
            const lead = { strength: '손님 ', reviewTopic: '리뷰 ', reviewMenu: '리뷰 ', blogTerm: '블로그 ', style: '예약 ' }[node.type];
            if (lead) assert.equal(node.sub.startsWith(lead), true, `${name} ${node.id} sub '${node.sub}'`);
        }
    }
});

/* ───────── 점 하나의 글자 역할: label 이름 · sub 핵심 값 · facts 다른 수치 · detail 맥락 한 문장 ───────── */

// 글 속의 수량('323개', '40%'): 숫자와 바로 뒤의 단위 한 글자. 카드(graph/card-model.js)가 되풀이를 가릴 때 쓰는 것과 같은 기준입니다.
const amountsIn = (text) => [...String(text ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)([가-힣%]?)/g)].map((match) => ({ n: match[1].replace(/,/g, ''), u: match[2] }));
// 숫자가 같고, 단위는 둘 다 적혀 있을 때만 견줍니다('30/52'의 30 과 '30개'는 같은 값으로 봅니다).
const sameAmount = (a, b) => a.n === b.n && (!a.u || !b.u || a.u === b.u);
const squash = (text) => String(text ?? '').replace(/\s+/g, '');
// 같은 수치(또는 같은 글자)가 sub·detail·facts 가운데 두 곳 이상에 나오는 것들
function repeatsIn(node) {
    const fields = [['sub', [node.sub]], ['detail', [node.detail]], ['facts', (node.facts || []).map((fact) => fact.value)]];
    const found = [];
    for (let i = 0; i < fields.length; i += 1) {
        for (let j = i + 1; j < fields.length; j += 1) {
            const [nameA, textsA] = fields[i];
            const [nameB, textsB] = fields[j];
            const amountsB = textsB.flatMap(amountsIn);
            for (const amount of textsA.flatMap(amountsIn)) if (amountsB.some((other) => sameAmount(amount, other))) found.push(`${amount.n}${amount.u} (${nameA}·${nameB})`);
            for (const text of textsA) if (squash(text) && textsB.some((other) => squash(other) === squash(text))) found.push(`'${text}' (${nameA}·${nameB})`);
        }
    }
    return [...new Set(found)];
}

test('같은 수치를 두 번 적지 않는다: 견본 3종의 모든 점에서 sub·detail·facts 가운데 두 곳 이상에 나오는 수치가 0', () => {
    // 기준 자체가 되풀이를 잡아내는지 먼저 확인한다(예전 모양의 점)
    assert.deepEqual(repeatsIn({ sub: '41위', detail: '41위 · 검색된 매장 388곳', facts: [{ label: '검색 순위', value: '41위' }, { label: '검색된 매장', value: '388곳' }] }),
        ['41위 (sub·detail)', '41위 (sub·facts)', "'41위' (sub·facts)", '41위 (detail·facts)', '388곳 (detail·facts)']);
    assert.deepEqual(repeatsIn({ sub: '블로그 30/52', detail: '블로그 후기 52개 중 30개에 나오는 낱말' }), ['30 (sub·detail)', '52 (sub·detail)']);
    assert.deepEqual(repeatsIn({ sub: '등록됨', facts: [{ label: '영업시간', value: '등록됨' }] }), ["'등록됨' (sub·facts)"]);
    assert.deepEqual(repeatsIn({ sub: '내 3위', detail: '네이버 플레이스에서 이 키워드를 검색했을 때 내 매장이 나온 순서입니다.', facts: [{ label: '검색된 매장', value: '214곳' }] }), []);

    let checked = 0;
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        const bad = graph.nodes.map((node) => [node.id, repeatsIn(node)]).filter(([, found]) => found.length > 0).map(([id, found]) => `${id}: ${found.join(', ')}`);
        assert.deepEqual(bad, [], `${name}: 같은 수치가 두 곳 이상에 나오는 점`);
        checked += graph.nodes.length;
        for (const node of graph.nodes) {
            // 설명은 이름을 다시 적은 것이 아니다. 모든 점에 설명이 있어, 그래프 아래 안내 줄(올렸을 때 한 줄 설명)이 비지 않는다
            assert.equal(typeof node.detail === 'string' && node.detail.length > 0, true, `${name} ${node.id}: 설명 없음`);
            assert.equal([node.label, node.full].some((text) => squash(text) === squash(node.detail)), false, `${name} ${node.id}: 설명이 이름과 같음`);
            // facts 는 4개까지, 이름(label)이 같은 수치가 두 번 나오지 않는다
            const labels = (node.facts || []).map((fact) => fact.label);
            assert.equal(labels.length <= 4 && new Set(labels).size === labels.length, true, `${name} ${node.id}: facts`);
        }
    }
    assert.equal(checked, 111 + 162 + 134);

    // 값(sub)이 없는 점은 값이라 할 것이 없는 종류뿐이다: 묶음 점 일부, 할 일(제목이 곧 내용), 편의시설·좌석 이름, AI 브리핑 문장
    const valueless = new Set();
    for (const [, sample] of SAMPLES) for (const node of graphOf(sample).nodes) if (!node.sub) valueless.add(node.type === 'concept' ? node.id : node.type);
    assert.deepEqual([...valueless].sort(), ['briefing', 'facility', 'hub:activity', 'hub:geo', 'hub:ops', 'hub:pos', 'hub:rival', 'hub:search', 'hub:voice', 'task']);

    // 설명에 숫자가 남는 것은 아래뿐이고, 어느 것도 그 점의 sub·facts 와 같은 수치가 아니다(위 검사).
    //   task        할 일의 안내 문장(본문과 같은 문장)
    //   aiFactor    점검 항목의 근거(그 점수가 어떤 값들에서 나왔는지)
    //   aiQuestion  지금 매장 정보로 만들 수 있는 답
    //   rv:score    평점의 기준값(5점 만점)
    //   hub:todo·ops:menu  다 보여 주지 못할 때 그래프에 보여 주는 개수
    const numbered = new Set();
    for (const [, sample] of SAMPLES) for (const node of graphOf(sample).nodes) if (/\d/.test(node.detail)) numbered.add(['concept', 'reviewMetric'].includes(node.type) ? node.id : node.type);
    assert.deepEqual([...numbered].sort(), ['aiFactor', 'aiQuestion', 'hub:todo', 'ops:menu', 'rv:score', 'task']);
});

test('글자 역할의 보기: 이름은 label, 핵심 값은 sub, 다른 수치는 facts, 뜻은 detail', () => {
    const graph = graphOf(RESTAURANT);
    const shape = (id) => { const node = nodeOf(graph, id); return [node.full || node.label, node.sub, (node.facts || []).map((fact) => `${fact.label} ${fact.value}`), node.detail]; };
    assert.deepEqual(shape('rv:visitor'), ['방문자 리뷰', '323개', ['작성한 손님 316명', '글 리뷰 277개', '사진 리뷰 270개'], '네이버 플레이스 화면에 표시된 방문자 리뷰 수입니다.']);
    assert.deepEqual(shape('rv:score'), ['평점', '4.97점', [], '네이버 플레이스 화면에 표시된 평점입니다(5점 만점).']);
    assert.deepEqual(shape('ac:reply'), ['사장님 답글률', '40%', ['답글 단 리뷰 20개 / 최근 50개'], '최근 방문자 리뷰 가운데 사장님 답글이 달린 리뷰의 비율입니다.']);
    assert.deepEqual(shape('ac:feed'), ['마지막 소식', '46일 전', ['마지막 소식 제목 대방어 입고 안내', '최근 30일 소식 0개', '읽은 소식 4개'], '소식 탭에 마지막으로 글을 올린 때입니다.']);
    assert.deepEqual(shape('pos:price'), ['1회 평균 결제', '172,645원', [], '최근 일주일 동안 결제 한 번에 평균 얼마를 받았는지입니다.']);
    assert.deepEqual(shape('pos:peak:friday'), ['금요일 가장 붐비는 시간', '18시', ['붐빔(가장 붐빌 때 대비) 89%'], '이 요일에 가장 붐비는 시간입니다. 붐빔은 한 주에서 가장 붐빌 때와 견준 값입니다.']);
    assert.deepEqual(shape('ops:hours'), ['영업시간', '등록됨', ['지금 상태 영업 중 · 23:30에 라스트오더', '영업하는 요일 칸 7개 / 7개'], '스마트플레이스에 등록하는 영업시간입니다.']);
    assert.deepEqual(shape('ops:photos'), ['업체 사진', '12장', ['전체 사진 108장', '방문자 사진·영상 586개'], '사장님이 스마트플레이스에 직접 올린 사진 수입니다.']);
    assert.deepEqual(shape('ops:subway'), ['가까운 역', '강남구청역', ['출구 3-1번', '걸어서 12분'], '네이버 플레이스에 표시된, 매장에서 가장 가까운 지하철역입니다.']);
    // 전체 개수는 sub, 가격·설명은 빠진 개수(모두 있거나 없으면 말로)
    assert.deepEqual(shape('ops:menu'), ['메뉴·가격', '34개', ['가격 모두 있음', '설명 23개 없음', '마지막 수정 26.11.08'], '스마트플레이스에 등록한 메뉴와 가격입니다. 그래프에는 리뷰·결제에 나온 것부터 6개만 보여 줍니다.']);
    assert.deepEqual(shape('menu:소금김밥'), ['소금김밥', '4,000원', ['사진 있음'], '스마트플레이스에 등록한 메뉴입니다. 값은 등록한 가격입니다.']);
    // 목록의 묶음 점: 개수 · 가장 많은 것 · 무엇을 센 목록인지 / 낱개: 출처와 수 · 그 수가 무엇인지
    assert.deepEqual(shape('rv:vote'), ['손님이 고른 좋은 점', '8개', ['가장 많이 고른 것 음식이 맛있어요 · 299명'], '리뷰를 쓴 손님이 좋았던 점으로 고른 항목 모음입니다.']);
    assert.deepEqual(shape('vote:음식이 맛있어요'), ['음식이 맛있어요', '손님 299명', [], '리뷰를 쓴 손님이 좋았던 점으로 고른 항목입니다. 숫자는 고른 손님 수입니다.']);
    assert.deepEqual(shape('pos:menu'), ['주간 인기 메뉴', '5개', ['가장 많이 주문한 메뉴 소금김밥 · 주문의 12%'], '최근 일주일 동안 주문이 많았던 메뉴를 많은 순서로 놓은 것입니다.']);
    // 경쟁 매장: 키워드별 순위는 연결의 값으로만 보인다
    assert.deepEqual(shape('rival:test-r1'), ['시험바다횟집', '키워드 4개에서 내 위', ['방문자 리뷰 1,840개', '블로그 리뷰 310개', '평점 4.61점'], '업종은 생선회, 지역은 논현동입니다. 순위를 조회한 키워드의 검색 결과 맨 위 열 곳 안에 나온 매장입니다.']);
    assert.deepEqual(shape('region:강남구청'), ["지역 이름 '강남구청'", '역 주변', ['등록 키워드에 쓴 횟수 3개', '이 지역 이름을 쓴 키워드 9개'], '키워드 앞에 붙여 "지역 + 업종" 조합을 만드는 지역 이름입니다. 매장 주소·가까운 역·등록한 키워드에서 읽었습니다.']);
    // 미용실: 낱말이 '시술'로 바뀐다
    const salon = graphOf(SALON);
    assert.deepEqual([nodeOf(salon, 'ops:menu').sub, nodeOf(salon, 'ops:menu').facts.map((fact) => `${fact.label} ${fact.value}`), nodeOf(salon, 'ops:menu').detail],
        ['5개', ['가격 모두 있음', '설명 모두 없음'], '스마트플레이스에 등록한 시술과 가격입니다.']);
    assert.deepEqual([nodeOf(salon, 'style:댄디컷').sub, nodeOf(salon, 'style:댄디컷').facts, nodeOf(salon, 'style:댄디컷').detail], ['예약 554건', undefined, '네이버 예약에 표시된 이 스타일의 누적 예약 수입니다.']);
    // 업체 사진이 0장이면 '전체 사진 0장'을 같은 숫자로 되풀이하지 않고 '없음'으로 적는다
    assert.deepEqual(nodeOf(graphOf(PHARMACY), 'ops:photos').facts, [{ label: '전체 사진', value: '없음' }, { label: '방문자 사진·영상', value: '34개' }]);
});

/* ───────── 키워드 ───────── */

test('키워드의 종류(대표·추천·조회)와 순위 조회 상태를 점에 그대로 적는다', () => {
    const graph = graphOf(PHARMACY);
    // 순위를 조회하는 중이거나 조회에 실패한 추천 키워드
    // (쓸모 관문 뒤로 지역만 바꾼 조합이 빠지면서, 전에는 13·15번째라 추천 12개 밖이던 "청주영양제"·"청주동물약국"이 추천 안에 들어왔다)
    const loading = nodeOf(graph, 'kw:청주영양제');
    assert.deepEqual([loading.type, loading.sub, loading.subTone, loading.tone, loading.target, loading.go], ['recoKeyword', '조회 중', 'pending', 'pending', 'rank-row-3', '순위 표 보기']);
    const failed = nodeOf(graph, 'kw:청주동물약국');
    assert.deepEqual([failed.type, failed.sub, failed.tone, failed.detail], ['recoKeyword', '조회 실패', 'muted', '순위를 조회하지 못했습니다.']);
    // 등록도 추천 목록에도 없는데 순위만 조회한 키워드(관문에서 걸러진 "청주심야약국"을 사장님이 직접 넣어 조회한 경우)
    const typedIn = nodeOf(graphOf(PHARMACY, { ranks: [...PHARMACY.ranks, { keyword: '청주심야약국', state: 'loading' }] }), 'kw:청주심야약국');
    assert.deepEqual([typedIn.type, typedIn.sub, typedIn.subTone, typedIn.target, typedIn.go], ['queryKeyword', '조회 중', 'pending', 'rank-row-5', '순위 표 보기']);
    assert.equal(nodeOf(graph, 'kw:청주심야약국'), undefined);
    // 지역 이름이 없어 순위를 보지 않은 등록 키워드
    const registered = nodeOf(graph, 'kw:일반의약품');
    assert.deepEqual([registered.type, registered.sub, registered.subTone, registered.target, registered.go], ['keyword', '지역 이름 없음', 'warn', 'sec-rank', '키워드 순위 보기']);
    assert.equal(registered.detail, '지역 이름이 없어 검색하는 위치마다 순위가 달라집니다. 아직 순위를 조회하지 않았습니다.');
    // 아직 순위를 보지 않은 추천 키워드는 추천 목록으로 간다. 추천 이유와 그 수치는 연결과 facts 에 있어 설명에서 되풀이하지 않는다
    const reco = nodeOf(graph, 'kw:청원약국');
    assert.deepEqual([reco.type, reco.sub, reco.target, reco.go], ['recoKeyword', '추천', 'kw-reco', '추천 키워드 보기']);
    assert.equal(reco.detail, '주소·업종·리뷰에서 뽑아 만든 추천 조합입니다. 아직 등록하지 않았고 순위도 조회하지 않았습니다.');
    assert.deepEqual(reco.facts, [{ label: '블로그 후기 언급', value: '11개 중 11개' }, { label: '이 키워드를 등록한 매장', value: '0곳' }, { label: '등록 상태', value: '추천(미등록)' }]);
    // 순위만 확인해 보라고 권하는 조합(등록할 낱말은 아님)
    const rankOnly = nodeOf(graphOf(RESTAURANT), 'kw:강남구청맛집');
    assert.deepEqual([rankOnly.sub, rankOnly.facts.at(-1)], ['추천', { label: '등록 상태', value: '순위 확인용' }]);
    assert.match(rankOnly.detail, /^손님이 흔히 쓰는 검색어라 순위만 확인해 보라고 권하는 조합입니다/);
    // 순위를 본 추천 키워드는 순위가 좋을수록 무겁다
    assert.equal(nodeOf(graph, 'kw:청주약국').type, 'recoKeyword');
    assert.equal(nodeOf(graph, 'kw:오창약국').weight > nodeOf(graph, 'kw:청주약국').weight, true); // 2위 > 6위
    // 내 매장이 등록한 것만 '대표키워드로 등록함'으로 매장과 이어진다
    assert.deepEqual(objectsOf(graph, 'store', 'registers'), ['kw:일반의약품', 'kw:건강기능식품', 'kw:동물의약품', 'kw:상비약']);
    assert.equal(linkOf(graph, 'store', 'registers', 'kw:상비약').why, '내 매장이 스마트플레이스에 등록한 대표키워드 4개 가운데 하나입니다. 지역 이름이 없는 키워드입니다.');
});

test('"이 키워드를 등록한 매장" 숫자는 실제 연결 수와 같다(카드의 조각 수와 엇갈리지 않음)', () => {
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        for (const node of graph.nodes.filter((item) => ['keyword', 'recoKeyword', 'queryKeyword'].includes(item.type))) {
            const fact = (node.facts || []).find((item) => item.label === '이 키워드를 등록한 매장');
            assert.ok(fact, `${name} ${node.id}`);
            assert.equal(Number.parseInt(fact.value, 10), subjectsOf(graph, node.id, 'registers').length, `${name} ${node.id} '${fact.value}'`);
        }
        // 경쟁 매장만 등록한 키워드는 그 수가 핵심 값(sub)이다
        for (const node of graph.nodes.filter((item) => item.type === 'rivalKeyword')) {
            assert.equal(node.sub, `${subjectsOf(graph, node.id, 'registers').length}곳 등록`, `${name} ${node.id}`);
            assert.equal(node.facts, undefined, `${name} ${node.id}`);
        }
    }
    const pharmacy = graphOf(PHARMACY);
    const factOf = (graph, id) => nodeOf(graph, id).facts.find((item) => item.label === '이 키워드를 등록한 매장')?.value;
    assert.equal(factOf(pharmacy, 'kw:청주약국'), '2곳'); // 경쟁 매장 2곳
    assert.equal(factOf(pharmacy, 'kw:일반의약품'), '2곳(내 매장 포함)');
    assert.equal(factOf(pharmacy, 'kw:상비약'), '1곳(내 매장만)');
    assert.equal(factOf(pharmacy, 'kw:청주영양제'), '0곳');
    assert.equal(nodeOf(pharmacy, 'rk:공공심야약국').sub, '3곳 등록');
    // 순위(6위)는 sub 에만 있다
    assert.deepEqual(nodeOf(pharmacy, 'kw:청주약국').facts, [
        { label: '검색된 매장', value: '594곳' }, { label: '블로그 후기 언급', value: '11개 중 11개' }, { label: '이 키워드를 등록한 매장', value: '2곳' }, { label: '등록 상태', value: '추천(미등록)' },
    ]);
    // 경쟁 매장의 대표키워드를 읽지 않았으면 다른 매장이 등록했는지 알 수 없으므로 적지 않는다
    const unread = build(graphInput({ ...PHARMACY, rivalPool: [] }));
    assert.equal(nodeOf(unread, 'kw:청주약국').facts.some((item) => item.label === '이 키워드를 등록한 매장'), false);
    assert.deepEqual(nodeOf(unread, 'kw:상비약').facts, [{ label: '블로그 후기 언급', value: '11개 중 4개' }, { label: '등록 상태', value: '대표키워드로 등록함' }]);
});

test('추천 이유: 등록 키워드·손님이 고른 좋은 점·리뷰·예약·블로그 낱말 → 추천 키워드(조각에 출처와 수)', () => {
    const pharmacy = graphOf(PHARMACY);
    const reason = (graph, source, target) => {
        const link = linkOf(graph, source, 'supports', target);
        assert.ok(link, `${source} → ${target}`);
        return [link.why, link.badge];
    };
    assert.deepEqual(reason(pharmacy, 'vote:제품 종류가 다양해요', 'kw:청주대형약국'), ["'청주대형약국' 추천 이유: 손님이 고른 좋은 점 '제품 종류가 다양해요' 27명.", '손님 27명']);
    assert.deepEqual(reason(pharmacy, 'bm:대형약국', 'kw:청주대형약국'), ["'청주대형약국'의 낱말 '대형약국'이 블로그 후기 11개 중 10개에 나옵니다.", '블로그 10개']);
    // 등록 키워드에 지역 이름을 붙인 조합(약국의 "일반의약품"은 이제 분류 이름이라 지역을 붙여 권하지 않아, 미용실의 "댄디컷"으로 본다)
    assert.equal(nodeOf(pharmacy, 'kw:청주일반의약품'), undefined);
    assert.deepEqual(reason(graphOf(SALON), 'kw:댄디컷', 'kw:강남역댄디컷'), ["'강남역댄디컷'은 등록 키워드 '댄디컷'에 지역 이름 '강남역'을 붙인 조합입니다.", '지역 이름 붙임']);
    // 어느 연결에도 한쪽 점의 종류를 말하는 '대표키워드' 배지는 없다
    for (const [name, sample] of SAMPLES) assert.equal(graphOf(sample).links.some((link) => link.badge === '대표키워드'), false, name);
    // 추천 이유는 추천 키워드로만 간다(등록 키워드·조회한 키워드에는 붙지 않음)
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        for (const link of graph.links.filter((item) => item.rel === 'supports')) assert.equal(nodeOf(graph, link.target).type, 'recoKeyword', `${name} ${link.id}`);
    }

    const restaurant = graphOf(RESTAURANT);
    assert.deepEqual(reason(restaurant, 'rmenu:숙성회', 'kw:강남구청숙성회'), ["'강남구청숙성회'의 낱말 '숙성회'가 방문자 리뷰에서 22회 언급됐습니다.", '리뷰 22회']);
    assert.deepEqual(reason(restaurant, 'bm:숙성회', 'kw:강남구청숙성회'), ["'강남구청숙성회'의 낱말 '숙성회'가 블로그 후기 52개 중 25개에 나옵니다.", '블로그 25개']);
    // ("회식"은 이미 두 지역으로 등록해 "강남회식"을 더 권하지 않는다. 같은 좋은 점이 "모임"의 이유로 이어진다)
    assert.equal(reason(restaurant, 'vote:단체모임 하기 좋아요', 'kw:강남구청모임')[1], '손님 37명');
    assert.equal(nodeOf(restaurant, 'kw:강남회식'), undefined);
    assert.equal(reason(restaurant, 'kw:강남구청횟집', 'kw:강남횟집')[0], "'강남횟집'은 등록 키워드 '강남구청횟집'의 낱말 '횟집'에 지역 이름 '강남'을 붙인 조합입니다.");
    assert.deepEqual(subjectsOf(restaurant, 'kw:강남횟집', 'supports'), ['kw:강남구청횟집', 'kw:압구정횟집', 'bm:횟집']);
    // 메뉴판·소식에 되풀이해 나오는 낱말("대방어")은 그 메뉴와 잇는다
    assert.deepEqual(reason(restaurant, 'menu:대방어 정식', 'kw:강남구청대방어'), ["'강남구청대방어' 추천 이유: 메뉴 '대방어 정식'.", '등록 메뉴']);
    // 결제 단말의 메뉴 이름("대물볼락구이")은 매장 이름이 앞에 붙어 추천 낱말("볼락구이")과 다르다.
    // 추천 낱말을 만들 때와 같은 규칙으로 다듬어 "주간 인기 메뉴" 이유를 그 메뉴와 잇는다(전에는 이 이유만 연결이 없었다).
    // 횟집에서는 볼락구이가 주력 갈래(회) 밖 곁들임이라 추천하지 않으므로, 업종이 '생선구이'인 같은 매장으로 본다
    assert.equal(nodeOf(restaurant, 'kw:강남구청볼락구이'), undefined);
    const GRILL = { ...RESTAURANT, place: { ...RESTAURANT.place, category: '생선구이' } };
    const grill = graphOf(GRILL);
    assert.deepEqual(reason(grill, 'pmenu:대물볼락구이', 'kw:강남구청볼락구이'),
        ["'강남구청볼락구이'의 낱말 '볼락구이'는 주간 인기 메뉴 3위 '대물볼락구이'에서 나온 말입니다.", '주간 인기 3위']);
    assert.deepEqual(subjectsOf(grill, 'kw:강남구청볼락구이', 'supports'), ['rmenu:볼락구이', 'pmenu:대물볼락구이']);
    // 추천 이유에 "주간 인기 메뉴"가 있는 추천 키워드는 모두 결제 메뉴 점과 이어진다
    let posReasons = 0;
    for (const [name, sample] of [...SAMPLES, ['생선구이집', GRILL]]) {
        const input = graphInput(sample);
        const graph = build(input, name);
        for (const item of input.recommendation.items) {
            const node = nodeOf(graph, `kw:${item.keyword}`);
            if (!node || node.type !== 'recoKeyword' || !item.reasons.some((entry) => entry.kind === 'pos')) continue;
            posReasons += 1;
            assert.equal(subjectsOf(graph, node.id, 'supports').some((source) => nodeOf(graph, source).type === 'popularMenu'), true, `${name} ${item.keyword}`);
        }
    }
    assert.equal(posReasons >= 1, true);
    // 받는 방법인 "포장"은 추천 키워드가 아니라서 키워드 점이 없다(편의시설 '포장'은 운영 정보에 그대로 있다)
    assert.equal(nodeOf(restaurant, 'kw:강남구청포장'), undefined);
    assert.equal(restaurant.nodes.some((node) => node.type === 'facility' && node.label === '포장'), true);

    const salon = graphOf(SALON);
    assert.deepEqual(reason(salon, 'style:다운펌', 'kw:강남역다운펌'), ["'강남역다운펌'의 낱말 '다운펌'은 누적 예약 437건인 스타일입니다.", '예약 437건']);
    assert.deepEqual(reason(salon, 'rmenu:다운펌', 'kw:강남역다운펌'), ["'강남역다운펌'의 낱말 '다운펌'이 방문자 리뷰에서 1,259회 언급됐습니다.", '리뷰 1,259회']);
    assert.deepEqual(reason(salon, 'conv:남성전문/바버샵', 'kw:강남역바버샵'), ["'강남역바버샵' 추천 이유: 편의시설 '남성전문/바버샵'.", '편의시설']);
    // 추천 키워드마다 이유(또는 경쟁 매장의 등록·같은 낱말)가 하나 이상 이어진다. 순위 확인용 '맛집'은 이유가 되는 점이 없어 제외
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        const bare = graph.nodes
            .filter((node) => node.type === 'recoKeyword' && ['supports', 'registers', 'sharesTerm'].every((rel) => subjectsOf(graph, node.id, rel).length === 0))
            .map((node) => node.id);
        assert.deepEqual(bare, name === '음식점' ? ['kw:강남구청맛집'] : [], name);
    }
});

test('키워드 속 손님 말: 블로그에 나온 낱말 → 그 낱말이 들어간 키워드(가장 긴 낱말 하나, 추천 이유와 겹치면 한 번만)', () => {
    const pharmacy = graphOf(PHARMACY);
    const spoken = linkOf(pharmacy, 'bm:일반의약품', 'spokenIn', 'kw:일반의약품');
    assert.deepEqual([spoken.why, spoken.badge], ["등록 키워드 '일반의약품'이 블로그 후기 11개 중 6개에 나옵니다.", '블로그 6개']);
    // 추천에 없는 키워드를 직접 조회한 경우(조회한 키워드)에도 그 키워드에 들어 있는 낱말과 잇는다
    const typedIn = graphOf(PHARMACY, { ranks: [...PHARMACY.ranks, { keyword: '청주심야약국', state: 'loading' }] });
    assert.equal(linkOf(typedIn, 'bm:약국', 'spokenIn', 'kw:청주심야약국').why, "'청주심야약국'에 들어 있는 낱말 '약국'이 블로그 후기 11개 중 11개에 나옵니다.");
    // "청주영양제"는 이제 추천 키워드라 '영양제'의 블로그 언급이 추천 이유로 이어지고, 같은 낱말을 한 번 더 잇지 않는다
    assert.equal(linkOf(pharmacy, 'bm:영양제', 'supports', 'kw:청주영양제').badge, '블로그 4개');
    assert.equal(linkOf(pharmacy, 'bm:영양제', 'spokenIn', 'kw:청주영양제'), undefined);
    // "청주대형약국"은 '약국'이 아니라 '대형약국'과 이어지고, 그것은 이미 추천 이유라 다시 잇지 않는다
    assert.equal(linkOf(pharmacy, 'bm:약국', 'spokenIn', 'kw:청주대형약국'), undefined);
    assert.equal(linkOf(pharmacy, 'bm:대형약국', 'spokenIn', 'kw:청주대형약국'), undefined);
    assert.ok(linkOf(pharmacy, 'bm:대형약국', 'supports', 'kw:청주대형약국'));
    const restaurant = graphOf(RESTAURANT);
    assert.equal(linkOf(restaurant, 'bm:횟집', 'spokenIn', 'kw:강남구청횟집').why, "등록 키워드 '강남구청횟집'에 들어 있는 낱말 '횟집'이 블로그 후기 52개 중 30개에 나옵니다.");
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        for (const id of ids(graph, 'kw:')) {
            const fromBlog = [...subjectsOf(graph, id, 'spokenIn'), ...subjectsOf(graph, id, 'supports').filter((source) => source.startsWith('bm:'))];
            assert.equal(fromBlog.length <= 1, true, `${name} ${id}: ${fromBlog}`);
        }
    }
    // 손님이 검색할 때 쓰는 말로 만든 조합은 '대신 써 볼 키워드'. 약·제품 분류 이름("일반의약품"·"건강기능식품")은 블로그 수가 아니라
    // 분류 이름이라는 것이 이유다(블로그 수로 고르는 경우는 tests/place-keywords.test.mjs 의 등록 키워드 진단에서 본다)
    assert.equal(linkOf(pharmacy, 'kw:청주영양제', 'alternativeTo', 'kw:건강기능식품').why, "'건강기능식품'은 약·제품을 나누는 분류 이름이라, 손님이 검색할 때 쓰는 말 '영양제'로 만든 조합이 '청주영양제'입니다.");
    assert.equal(linkOf(pharmacy, 'kw:청주약국', 'alternativeTo', 'kw:일반의약품').why, "'일반의약품'은 약·제품을 나누는 분류 이름이라, 손님이 검색할 때 쓰는 말 '약국'으로 만든 조합이 '청주약국'입니다.");
    assert.deepEqual(pharmacy.links.filter((link) => link.rel === 'alternativeTo').map((link) => `${link.source}>${link.target}`),
        ['kw:청주약국>kw:일반의약품', 'kw:청주영양제>kw:건강기능식품', 'kw:청주동물약국>kw:동물의약품', 'kw:청주약국>kw:상비약']);
    // 블로그 수로 고른 경우의 문장(분류 이름이 아닌 등록 키워드)
    const cafePlace = {
        placeId: 'c1', name: '시험카페', category: '카페', address: '서울 강남구 테헤란로 1', jibunAddress: '서울 강남구 역삼동 1', keywords: ['케이크'],
        reviewVotes: [], reviewMenus: [], reviewThemes: [], conveniences: [], detail: { menus: [] },
    };
    const cafeActivity = { mentions: { blogTotal: 20, terms: [{ term: '케이크', count: 1 }, { term: '디저트', count: 9 }] } };
    const cafe = build(graphInput({ place: cafePlace, activity: cafeActivity, rivalPool: [] }));
    assert.equal(linkOf(cafe, 'kw:강남디저트', 'alternativeTo', 'kw:케이크').why, "블로그 후기 언급은 '케이크' 1개, '디저트' 9개입니다. 손님이 더 많이 쓰는 말로 만든 조합이 '강남디저트'입니다.");
});

/* ───────── 경쟁 매장 ───────── */

test('내 위에 있는 매장 / 내 아래에 있는 매장: 순위로 가르고 조각에 그 매장의 순위를 붙인다', () => {
    const graph = graphOf(PHARMACY);
    const hub = nodeOf(graph, 'hub:rival');
    assert.deepEqual([hub.group, hub.level, hub.parent, hub.type, hub.label], ['rival', 1, 'store', 'concept', '경쟁 매장']);
    // 매장 수는 facts 에만 있고, 설명에는 누구를 모은 것인지만 적는다
    assert.equal(hub.detail, '순위를 조회한 키워드마다 검색 결과 맨 위 열 곳에 나온 매장을 모았습니다(내 매장 제외).');
    assert.deepEqual(hub.facts, [
        { label: '상위 10곳에 나온 매장', value: '10곳' }, { label: '내 위에 있는 매장', value: '6곳', tone: 'warn' },
        { label: '키워드 2개 이상에서 내 위에 있는 매장', value: '2곳', tone: 'warn' }, { label: '대표키워드를 읽은 매장', value: '5곳' },
    ]);
    assert.equal(ids(graph, 'rival:').length, 10);
    // 내 매장은 경쟁 매장으로 넣지 않는다
    assert.equal(nodeOf(graph, `rival:${PHARMACY.place.placeId}`), undefined);

    // '청주약국' 내 순위 6위: 1~5위는 내 위, 7~10위는 내 아래
    const rankOf = (rel) => subjectsOf(graph, 'kw:청주약국', rel).map((id) => linkOf(graph, id, rel, 'kw:청주약국').badge);
    assert.deepEqual(rankOf('outranks'), ['이 매장 1위', '이 매장 2위', '이 매장 3위', '이 매장 4위', '이 매장 5위']);
    assert.deepEqual(rankOf('ranksIn'), ['이 매장 7위', '이 매장 8위', '이 매장 9위', '이 매장 10위']);
    // 한 매장이 같은 키워드에서 위이면서 아래일 수는 없다
    for (const [name, sample] of SAMPLES) {
        const each = graphOf(sample);
        for (const link of each.links.filter((item) => item.rel === 'outranks')) assert.equal(linkOf(each, link.source, 'ranksIn', link.target), undefined, `${name} ${link.id}`);
        // 조각 값은 "이 매장 ○위"(누구 순위인지 적음), 순위 숫자는 rank 에도 있다(순위순으로 놓을 때 씀)
        for (const link of each.links.filter((item) => ['outranks', 'ranksIn'].includes(item.rel))) {
            assert.match(link.badge, /^이 매장 \d+위$/, `${name} ${link.id}`);
            assert.equal(link.badge, `이 매장 ${link.rank}위`, `${name} ${link.id}`);
        }
    }
    assert.equal(linkOf(graph, 'rival:2021608686', 'outranks', 'kw:청주약국').why, "'메가타운약국 청주점'은 '청주약국' 검색 1위로, 내 매장(6위)보다 위에 있습니다.");
    assert.equal(linkOf(graph, 'rival:test-ochang-1', 'ranksIn', 'kw:오창약국').why, "'오창시험약국'은 '오창약국' 검색 3위로, 내 매장(2위)보다 아래에 있습니다.");
    // 내 위에 있는 매장과의 연결이 더 굵다
    assert.equal(linkOf(graph, 'rival:13177688', 'outranks', 'kw:청주약국').strength > linkOf(graph, 'rival:2011529462', 'ranksIn', 'kw:청주약국').strength, true); // 5위(위) > 7위(아래)
    // 조회 중·실패한 키워드에는 순위 연결이 없다
    assert.deepEqual([...subjectsOf(graph, 'kw:청주영양제', 'outranks'), ...subjectsOf(graph, 'kw:청주영양제', 'ranksIn')], []);

    // 두 키워드에서 내 위에 있는 매장
    const top = nodeOf(graph, 'rival:2021608686');
    assert.deepEqual([top.full, top.sub, top.subTone, top.keyword, top.parent, top.level, top.type, top.go], ['메가타운약국 청주점', '키워드 2개에서 내 위', 'warn', '청주약국', 'hub:rival', 2, 'rival', '순위 표 보기']);
    // 키워드별 순위는 연결의 값(배지)으로만 보인다. 설명에는 어떤 매장인지, facts 에는 그 매장의 다른 수치를 적는다
    assert.equal(top.detail, '업종은 약국, 지역은 주중동입니다. 순위를 조회한 키워드의 검색 결과 맨 위 열 곳 안에 나온 매장입니다.');
    assert.deepEqual(top.facts, [{ label: '방문자 리뷰', value: '342개' }, { label: '블로그 리뷰', value: '192개' }]);
    assert.deepEqual([objectsOf(graph, top.id, 'outranks'), objectsOf(graph, top.id, 'ranksIn')], [['kw:청주약국', 'kw:청주대형약국'], ['kw:오창약국']]);
    assert.deepEqual([...objectsOf(graph, top.id, 'outranks'), ...objectsOf(graph, top.id, 'ranksIn')].map((id) => graph.links.find((link) => link.source === top.id && link.target === id && ['outranks', 'ranksIn'].includes(link.rel)).badge), ['이 매장 1위', '이 매장 1위', '이 매장 4위']);
    assert.deepEqual([nodeOf(graph, 'rival:13247732').sub, nodeOf(graph, 'rival:13247732').subTone], ['키워드 1개에서 내 아래', 'muted']);
    const weights = graph.nodes.filter((node) => node.type === 'rival').map((node) => node.weight);
    assert.equal(top.weight, Math.max(...weights));
    // 내 위에 많이 있는 매장부터 놓는다
    assert.deepEqual(ids(graph, 'rival:').slice(0, 3), ['rival:2021608686', 'rival:1222439545', 'rival:13200547']);

    // 내 매장이 살펴본 범위 밖이면 상위에 나온 매장은 모두 내 위에 있다
    const restaurant = graphOf(RESTAURANT);
    assert.equal(linkOf(restaurant, 'rival:test-r5', 'outranks', 'kw:압구정회식').why, "'시험압구정수산'은 '압구정회식' 검색 1위이고, 내 매장은 300위 밖입니다.");
    assert.deepEqual(subjectsOf(restaurant, 'kw:압구정회식', 'ranksIn'), []);
    // 내 매장이 목록에 아예 없을 때도 마찬가지
    const input = graphInput(RESTAURANT);
    const ranks = input.ranks.map((row) => (row.keyword === '압구정회식' ? { ...row, result: { ...row.result, status: 'not_listed', scanned: 120 } } : row));
    const unlisted = build({ ...input, ranks });
    assert.equal(linkOf(unlisted, 'rival:test-r5', 'outranks', 'kw:압구정회식').why, "'시험압구정수산'은 '압구정회식' 검색 1위이고, 내 매장은 이 키워드 목록에 없습니다.");
    assert.equal(nodeOf(unlisted, 'kw:압구정회식').sub, '목록에 내 매장 없음');
});

test('경쟁 매장이 많아 상한에 걸려도 키워드마다 1위부터 차례로 들어간다', () => {
    const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
    // 키워드 6개, 상위 10곳이 모두 다른 매장(60곳). 내 매장은 어느 키워드에서도 20위
    const input = graphInput(RESTAURANT);
    const ranks = many(6, (k) => ({
        keyword: `시험키워드${k}`,
        state: 'done',
        result: {
            keyword: `시험키워드${k}`, placeId: input.place.placeId, status: 'found', rank: 20, total: 500, scanned: 100, target: null, topSignals: null,
            top: many(10, (j) => ({ rank: j + 1, placeId: `x-${k}-${j}`, name: `상위 ${k}-${j}`, isTarget: false, visitorReviews: 100, blogReviews: 10 })),
        },
    }));
    const graph = build({ ...input, ranks, rivalPool: [] });
    assertSound(graph, '경쟁 매장 60곳');
    assert.equal(ids(graph, 'rival:').length, GRAPH_LIMITS.rivals); // 24곳
    assert.equal(nodeOf(graph, 'hub:rival').detail, '순위를 조회한 키워드마다 검색 결과 맨 위 열 곳에 나온 매장을 모았습니다(내 매장 제외). 많아서 그중 24곳만 그래프에 보여 줍니다.');
    assert.equal(nodeOf(graph, 'hub:rival').facts[0].value, '60곳');
    // 키워드마다 1~4위가 빠짐없이 들어 있다(24곳 = 6개 × 4위까지)
    for (let k = 0; k < 6; k += 1) {
        const shown = subjectsOf(graph, `kw:시험키워드${k}`, 'outranks').map((id) => linkOf(graph, id, 'outranks', `kw:시험키워드${k}`).badge);
        assert.deepEqual(shown, ['이 매장 1위', '이 매장 2위', '이 매장 3위', '이 매장 4위'], `시험키워드${k}`);
    }
});

test('경쟁 매장이 등록한 대표키워드: 내 키워드와 같으면 그 키워드와, 다르면 "경쟁 매장 키워드" 묶음의 점과 잇는다', () => {
    const graph = graphOf(PHARMACY);
    assert.equal(linkOf(graph, 'rival:13247713', 'registers', 'kw:일반의약품').why, "'오송메가파워약국'이 '일반의약품'을 대표키워드로 등록했습니다(내 매장도 등록).");
    assert.equal(linkOf(graph, 'rival:2021608686', 'registers', 'kw:청주약국').why, "'메가타운약국 청주점'이 '청주약국'을 대표키워드로 등록했습니다(내 매장은 등록하지 않음). 이 키워드에서 이 매장은 1위, 내 매장은 6위입니다.");
    assert.deepEqual(subjectsOf(graph, 'kw:일반의약품', 'registers'), ['store', 'rival:13247713']);
    assert.deepEqual(subjectsOf(graph, 'kw:청주약국', 'registers'), ['rival:2021608686', 'rival:1222439545']);

    const list = nodeOf(graph, 'rival-keywords');
    assert.deepEqual([list.type, list.parent, list.level, list.label, list.sub], ['concept', 'hub:rival', 2, '경쟁 매장 키워드', '4개']);
    assert.equal(list.detail, '경쟁 매장은 등록했지만 내 매장은 등록하지 않은 대표키워드입니다.');
    assert.deepEqual(list.facts, [{ label: '대표키워드를 읽은 경쟁 매장', value: '5곳' }, { label: '가장 여러 곳이 등록한 키워드', value: '공공심야약국' }]);
    const night = nodeOf(graph, 'rk:공공심야약국');
    assert.deepEqual([night.parent, night.level, night.type, night.sub, night.detail], ['rival-keywords', 3, 'rivalKeyword', '3곳 등록', '경쟁 매장만 등록한 대표키워드입니다. 내 매장은 등록하지 않았습니다.']);
    assert.equal(nodeOf(graph, 'rk:주중동약국').sub, '1곳 등록');
    assert.deepEqual(subjectsOf(graph, night.id, 'registers').sort(), ['rival:1222439545', 'rival:13177688', 'rival:13247713']);
    assert.equal(linkOf(graph, 'rival:13177688', 'registers', night.id).why, "'큰사랑약국 [공공심야약국]'이 '공공심야약국'을 대표키워드로 등록했습니다(내 매장은 등록하지 않음).");
    assert.deepEqual(ids(graph, 'rk:'), ['rk:공공심야약국', 'rk:주중동약국', 'rk:오송약국', 'rk:용암동약국']);
    // 순위 결과가 없어도 읽어 둔 경쟁 매장 키워드가 있으면 경쟁 매장 묶음을 낸다
    const poolOnly = graphOf(PHARMACY, { ranks: [] });
    assert.equal(nodeOf(poolOnly, 'hub:rival').detail, '대표키워드를 읽어 둔 경쟁 매장입니다.');
    assert.deepEqual(nodeOf(poolOnly, 'hub:rival').facts, [{ label: '대표키워드를 읽은 매장', value: '5곳' }]);
    assert.deepEqual([nodeOf(poolOnly, 'rival:2099403989').detail, nodeOf(poolOnly, 'rival:2099403989').sub, nodeOf(poolOnly, 'rival:2099403989').go], ['순위 표에는 없지만 대표키워드를 읽어 둔 경쟁 매장입니다.', '키워드 읽음', '키워드 순위 보기']);
    assertSound(poolOnly, '키워드만 읽은 경우');
    // 경쟁 매장 키워드를 읽는 중이면 묶음 점에 표시한다
    assert.equal(nodeOf(graphOf(PHARMACY, { rivals: { 청주약국: { loading: true } } }), 'hub:rival').sub, '키워드 읽는 중');
    // 읽지 않았으면 그 묶음도 없다
    assert.equal(nodeOf(build(graphInput({ ...PHARMACY, rivalPool: [] })), 'rival-keywords'), undefined);
});

test('같은 낱말을 쓰는 매장: 낱말이 업종 이름 그 자체면 연결을 약하게 둔다', () => {
    const pharmacy = graphOf(PHARMACY);
    const generic = linkOf(pharmacy, 'rival:2021608686', 'sharesTerm', 'kw:오창약국');
    assert.deepEqual([generic.strength, generic.badge, generic.why], [0.2, "'약국'", "'메가타운약국 청주점'이 대표키워드 '청주약국'에 '약국'을 씁니다. '약국'은 업종 이름입니다."]);
    // 업종 이름이 아닌 낱말은 보통 굵기다
    // (21시에 닫는 매장의 "심야약국"과 분류 이름 "일반의약품"은 이제 추천하지 않는다. "오창대형약국"은 오창 키워드의 내 순위(2위)가 좋아 다시 권한다)
    const big = linkOf(pharmacy, 'rival:2021608686', 'sharesTerm', 'kw:오창대형약국');
    assert.deepEqual([big.strength, big.badge, big.why], [0.55, "'대형약국'", "'메가타운약국 청주점'이 대표키워드 '청주대형약국'에 '대형약국'을 씁니다."]);
    assert.equal(nodeOf(pharmacy, 'kw:청주심야약국'), undefined);
    assert.equal(nodeOf(pharmacy, 'kw:청주일반의약품'), undefined);
    assert.equal(subjectsOf(pharmacy, 'kw:청원약국', 'sharesTerm').length, 2); // 키워드마다 2곳까지(상위 4곳이 '약국'을 쓰지만 둘만 잇는다)
    for (const [name, sample] of SAMPLES) {
        const input = graphInput(sample);
        const sourceOf = new Map(input.recommendation.items.map((item) => [`kw:${item.keyword}`, item.source]));
        for (const link of build(input).links.filter((item) => item.rel === 'sharesTerm')) {
            const industry = ['category', 'family'].includes(sourceOf.get(link.target));
            assert.equal(link.strength, industry ? 0.2 : 0.55, `${name} ${link.id}`);
        }
    }
    const salon = graphOf(SALON);
    assert.equal(linkOf(salon, 'rival:test-s2', 'sharesTerm', 'kw:강남미용실').strength, 0.2); // '미용실'은 업종 대표어
    assert.equal(linkOf(salon, 'rival:test-s2', 'sharesTerm', 'kw:강남역남자머리').strength, 0.55);
    assert.equal(linkOf(graphOf(RESTAURANT), 'rival:test-r1', 'sharesTerm', 'kw:강남구청숙성회').why, "'시험바다횟집'이 '숙성회'를 대표키워드로 등록했습니다.");
});

test('뒤처진 숫자: 키워드 상위 매장들의 중간값보다 뒤처진 리뷰 수와 잇는다', () => {
    const graph = graphOf(PHARMACY);
    const gap = linkOf(graph, 'kw:청주약국', 'lagsOn', 'rv:visitor');
    assert.deepEqual([gap.why, gap.badge], ["'청주약국' 상위 99곳의 방문자 리뷰 중간값은 862개, 내 매장은 58개입니다.", '상위권 중간 862개']);
    // 블로그 리뷰는 중간값(2개)보다 많아 잇지 않는다
    assert.equal(linkOf(graph, 'kw:청주약국', 'lagsOn', 'rv:blog'), undefined);
    assert.equal(linkOf(graph, 'kw:청주대형약국', 'lagsOn', 'rv:blog').why, "'청주대형약국' 상위 11곳의 블로그·카페 리뷰 중간값은 80개, 내 매장은 11개입니다.");
    // 평점은 내가 앞서 잇지 않는다
    assert.equal(linkOf(graphOf(RESTAURANT), 'kw:강남구청횟집', 'lagsOn', 'rv:score'), undefined);
});

/* ───────── 메뉴·할 일·지역·AI ───────── */

test('이름이 같음 / 이름에 들어 있음: 리뷰에 나온 메뉴 · 주간 인기 메뉴 · 등록 메뉴 · 예약 스타일', () => {
    const graph = graphOf(RESTAURANT);
    const menuLinks = (id) => graph.links.filter((link) => ['sameItem', 'namedIn'].includes(link.rel) && (link.source === id || link.target === id));
    // 리뷰 '김밥' — 결제 '소금김밥' — 메뉴판 '소금김밥' 이 세모로 이어진다(짧은 이름 → 긴 이름)
    assert.equal(linkOf(graph, 'rmenu:김밥', 'namedIn', 'pmenu:소금김밥').why, "리뷰에서 37회 언급된 '김밥'이 주간 인기 메뉴 1위 '소금김밥'(주문의 12%)의 이름에 들어 있습니다.");
    assert.equal(linkOf(graph, 'rmenu:김밥', 'namedIn', 'menu:소금김밥').why, "리뷰에서 37회 언급된 '김밥'이 등록한 메뉴 '소금김밥'(4,000원)의 이름에 들어 있습니다.");
    assert.equal(linkOf(graph, 'pmenu:소금김밥', 'sameItem', 'menu:소금김밥').why, "주간 인기 메뉴 1위 '소금김밥'(주문의 12%)은 등록한 메뉴 '소금김밥'(4,000원)과 이름이 같습니다.");
    // 괄호와 띄어쓰기가 달라도 같은 메뉴로 본다
    assert.equal(linkOf(graph, 'pmenu:대물 순살갈치조림', 'sameItem', 'menu:(한정)대물 순살 갈치조림').why,
        "주간 인기 메뉴 4위 '대물 순살갈치조림'(주문의 5%)은 등록한 메뉴 '(한정)대물 순살 갈치조림'(45,000원)과 이름이 같습니다.");
    assert.ok(linkOf(graph, 'rmenu:갈치조림', 'namedIn', 'pmenu:대물 순살갈치조림'));
    assert.ok(linkOf(graph, 'rmenu:볼락구이', 'namedIn', 'pmenu:대물볼락구이'));
    assert.ok(linkOf(graph, 'rmenu:보쌈', 'namedIn', 'menu:맛보기보쌈(100g)'));
    // 등록한 메뉴 34개 가운데 결제·추천 이유·리뷰와 이어지는 메뉴부터 보여 준다
    // ("대방어 정식"은 추천 키워드 "강남구청대방어"의 이유라 들어오고, 남는 자리를 채우던 대표 메뉴 "1% 대광어 숙성회"가 빠졌다)
    assert.deepEqual(ids(graph, 'menu:'), ['menu:소금김밥', 'menu:(한정)대물 순살 갈치조림', 'menu:해물돌판짜파게티', 'menu:대방어 정식', 'menu:대물 숙성회 정식(광어)', 'menu:맛보기보쌈(100g)']);
    // 이름이 맞지 않으면 잇지 않는다('광어'는 메뉴 이름의 끝말도 낱말도 아님, '갈치'는 '갈치조림'의 앞부분일 뿐)
    assert.deepEqual(menuLinks('rmenu:광어'), []);
    assert.deepEqual(menuLinks('rmenu:갈치'), []);

    // 미용실은 같은 관계를 '시술'이라는 말로 적는다
    const salon = graphOf(SALON);
    assert.equal(linkOf(salon, 'rmenu:댄디컷', 'sameItem', 'style:댄디컷').why, "리뷰에서 2,452회 언급된 '댄디컷'은 누적 예약 554건인 스타일 '댄디컷'과 이름이 같습니다.");
    assert.equal(linkOf(salon, 'style:다운펌', 'namedIn', 'menu:컷+다운펌').why, "누적 예약 437건인 스타일 '다운펌'이 등록한 시술 '컷+다운펌'(63,000원)의 이름에 들어 있습니다.");
    assert.deepEqual([nodeOf(salon, 'ops:style').target, nodeOf(salon, 'style:댄디컷').type, nodeOf(salon, 'style:댄디컷').go], ['sec-reviews', 'style', '리뷰 보기']); // 본문에서는 리뷰 구역에 있는 카드

    // 앞부분만 겹치는 이름은 다른 메뉴다: 리뷰 '김치' ↔ 결제 '김치만두'. 긴 쪽이 리뷰여도 방향은 짧은 이름 → 긴 이름
    const place = {
        ...RESTAURANT.place,
        reviewMenus: [{ label: '김치', count: 96 }, { label: '수육', count: 40 }, { label: '바지락칼국수', count: 12 }],
        detail: {
            ...RESTAURANT.place.detail,
            menus: [{ name: '칼국수', price: '11,000원', hasImage: false, recommended: false }],
            pos: { ...RESTAURANT.place.detail.pos, popularMenus: [{ name: '김치만두', count: null, share: 6, change: null }, { name: '수육 정식', count: null, share: 18, change: null }] },
        },
    };
    const custom = build({ place, nowMs: NOW });
    assert.equal(custom.links.some((link) => ['sameItem', 'namedIn'].includes(link.rel) && link.source === 'rmenu:김치'), false);
    assert.ok(linkOf(custom, 'rmenu:수육', 'namedIn', 'pmenu:수육 정식')); // 띄어 쓴 낱말 하나와 같음
    assert.equal(linkOf(custom, 'menu:칼국수', 'namedIn', 'rmenu:바지락칼국수').why, "등록한 메뉴 '칼국수'(11,000원)가 리뷰에서 12회 언급된 '바지락칼국수'의 이름에 들어 있습니다.");
});

test('할 일: 고칠 것(그 할 일이 가리키는 데이터)과 써 보라고 권하는 것(추천 키워드·손님이 쓰는 말)', () => {
    const pharmacyInput = graphInput(PHARMACY);
    const pharmacy = build(pharmacyInput);
    // 할 일 9개 가운데 급한 순으로 8개만 점이 된다(묶음 점의 개수는 전체 9개)
    assert.deepEqual(pharmacyInput.actions.map((item) => item.key), ['keywords', 'description', 'photos', 'reply', 'keywordRegion', 'feed', 'keywordSpoken', 'coupon', 'talktalk']);
    assert.deepEqual(ids(pharmacy, 'todo:'), ['todo:keywords', 'todo:description', 'todo:photos', 'todo:reply', 'todo:keywordRegion', 'todo:feed', 'todo:keywordSpoken', 'todo:coupon']);
    const targets = (id) => objectsOf(pharmacy, id, 'targets');
    const suggests = (id) => objectsOf(pharmacy, id, 'suggests');
    assert.deepEqual([targets('todo:keywords'), suggests('todo:keywords')], [['hub:search'], ['kw:청주약국', 'kw:오창약국']]);
    assert.deepEqual(targets('todo:description'), ['gf:atomic']);
    assert.deepEqual(targets('todo:photos'), ['ops:photos']);
    assert.deepEqual(targets('todo:reply'), ['ac:reply']);
    assert.deepEqual([targets('todo:keywordRegion'), suggests('todo:keywordRegion')], [['kw:일반의약품', 'kw:건강기능식품', 'kw:동물의약품', 'kw:상비약'], ['kw:청주약국', 'kw:오창약국']]);
    assert.deepEqual(targets('todo:feed'), ['ac:feed']);
    assert.deepEqual([targets('todo:keywordSpoken'), suggests('todo:keywordSpoken')], [['kw:건강기능식품'], ['bm:영양제']]);
    assert.deepEqual(targets('todo:coupon'), ['ac:coupon']);
    assert.equal(linkOf(pharmacy, 'todo:photos', 'targets', 'ops:photos').why, '업체 사진 0장: 사장님이 올린 업체 사진 수에서 나온 할 일입니다.');
    assert.equal(linkOf(pharmacy, 'todo:keywordSpoken', 'suggests', 'bm:영양제').why, "손님은 블로그 후기에서 '영양제'를 4번 썼습니다.");
    assert.equal(linkOf(pharmacy, 'todo:description', 'targets', 'gf:atomic').why, "소개글이 비어 있으면 AI 점검의 '소개글·한 줄 소개' 점수도 낮아집니다.");
    // 급한 할 일이 더 무겁다
    assert.equal(nodeOf(pharmacy, 'todo:photos').weight > nodeOf(pharmacy, 'todo:feed').weight, true);
    assert.equal(nodeOf(pharmacy, 'todo:feed').weight > nodeOf(pharmacy, 'todo:coupon').weight, true);

    const restaurant = graphOf(RESTAURANT);
    assert.ok(linkOf(restaurant, 'todo:booking', 'targets', 'ops:booking'));
    assert.equal(linkOf(restaurant, 'todo:talktalk', 'targets', 'gf:sameAs').why, "톡톡 연결 여부는 AI 점검의 '홈페이지·SNS 연결' 항목에 들어갑니다.");
    // 할 일 점은 모두 고칠 것이 있다
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        for (const id of ids(graph, 'todo:')) assert.equal(objectsOf(graph, id, 'targets').length > 0, true, `${name} ${id}`);
    }
});

test('키워드 속 지역 이름 / 역 이름에서 딴 지역', () => {
    const restaurant = graphOf(RESTAURANT);
    // "강남구청횟집"은 '강남'(구)이 아니라 '강남구청'(역)을 쓴 키워드
    assert.equal(linkOf(restaurant, 'kw:강남구청횟집', 'usesRegion', 'region:강남구청').why, "'강남구청횟집'에 들어 있는 지역 이름은 '강남구청'(역 주변)입니다.");
    assert.equal(linkOf(restaurant, 'kw:강남구청횟집', 'usesRegion', 'region:강남'), undefined);
    assert.ok(linkOf(restaurant, 'kw:강남횟집', 'usesRegion', 'region:강남'));
    assert.equal(linkOf(restaurant, 'region:강남구청', 'readFrom', 'ops:subway').why, "지역 이름 '강남구청'은 가까운 역 이름에서 따왔습니다.");
    assert.deepEqual(ids(restaurant, 'region:'), ['region:강남구청', 'region:압구정', 'region:강남', 'region:논현']);
    const region = nodeOf(restaurant, 'region:강남구청');
    assert.deepEqual([region.type, region.sub, region.full, region.go], ['region', '역 주변', "지역 이름 '강남구청'", '추천 키워드 보기']);
    // 추천 키워드 "강남미용실"의 '강남'은 역(강남역)이 아니라 구
    const salon = graphOf(SALON);
    assert.ok(linkOf(salon, 'kw:강남미용실', 'usesRegion', 'region:강남'));
    assert.equal(linkOf(salon, 'kw:강남미용실', 'usesRegion', 'region:강남역'), undefined);
    assert.ok(linkOf(salon, 'kw:강남역미용실', 'usesRegion', 'region:강남역'));
    // 키워드는 지역 이름 하나와만 이어진다. 지역 이름이 없는 키워드는 이어지지 않는다
    for (const [name, sample] of SAMPLES) {
        const graph = graphOf(sample);
        for (const id of ids(graph, 'kw:')) assert.equal(objectsOf(graph, id, 'usesRegion').length <= 1, true, `${name} ${id}`);
    }
    assert.deepEqual(objectsOf(graphOf(PHARMACY), 'kw:일반의약품', 'usesRegion'), []);
});

test('AI 검색: 본문 진단과 같은 점수를 쉬운 이름으로 내고, 점수에 들어가는 정보·질문의 답·비어 있는 정보·점수를 낮추는 항목을 잇는다', () => {
    const input = graphInput(RESTAURANT);
    const graph = build(input);
    const fanout = buildFanout(input.place, input.activity);
    const geo = scoreGeo(input.place, input.activity, input.ranks, { nowMs: NOW });
    const aeo = scoreAeo(input.place, input.activity, fanout);
    // 약어(GEO·AEO)는 이름에 쓰지 않고 설명에만 둔다. 점수는 sub, 등급과 항목 수는 facts
    assert.deepEqual([nodeOf(graph, 'geo:score').label, nodeOf(graph, 'aeo:score').label, nodeOf(graph, 'geo:score').type], ['AI 추천 준비', 'AI 답변 준비', 'aiScore']);
    assert.deepEqual([nodeOf(graph, 'geo:score').sub, nodeOf(graph, 'aeo:score').sub], [`${geo.score}점`, `${aeo.score}점`]);
    assert.deepEqual(nodeOf(graph, 'geo:score').facts, [{ label: '등급', value: '양호' }, { label: '점검 항목', value: '9개' }]);
    assert.deepEqual([nodeOf(graph, 'geo:score').full, nodeOf(graph, 'aeo:score').full], ['AI 추천 목록에 들 준비', 'AI 질문에 바로 답할 준비']);
    assert.match(nodeOf(graph, 'geo:score').detail, /\(GEO\)\.$/);
    assert.match(nodeOf(graph, 'aeo:score').detail, /\(AEO\)\.$/);
    assert.deepEqual([geo.score, aeo.score], [74, 82]);
    assert.deepEqual(nodeOf(graph, 'hub:geo').facts, [
        { label: 'AI 추천 준비', value: '74점', tone: 'good' }, { label: 'AI 답변 준비', value: '82점', tone: 'good' }, { label: '바로 답할 수 있는 질문', value: '7개 / 8개' },
    ]);
    // 항목 14개 가운데 'AI가 묻는 질문' 항목은 질문 목록의 묶음 점이 된다
    assert.equal(ids(graph, 'gf:').length, 13);
    assert.deepEqual(graph.nodes.filter((node) => node.parent === 'geo:score').map((node) => node.label),
        ['기본 정보', '블로그·카페 글', '리뷰 수·평점', '최근 리뷰·소식', '키워드·리뷰 일치', 'AI 브리핑·쿠폰', '과장 없는 표현', '홈페이지·SNS 연결', '대표키워드 순위']);
    assert.deepEqual(graph.nodes.filter((node) => node.parent === 'aeo:score').map((node) => [node.id, node.label]),
        [['gf:atomic', '소개글·한 줄 소개'], ['gf:structured', '메뉴 가격·영업시간'], ['gf:multiturn', '가격·예약·문의'], ['gf:qna', '리뷰 답글·소식']]);
    assert.deepEqual([nodeOf(graph, 'gf:sameAs').sub, nodeOf(graph, 'gf:sameAs').tone, nodeOf(graph, 'gf:sameAs').full, nodeOf(graph, 'gf:sameAs').type], ['25점', 'bad', '홈페이지·SNS·톡톡 연결', 'aiFactor']);
    assert.deepEqual([nodeOf(graph, 'gf:entity').full, nodeOf(graph, 'gf:entity').detail], ['기본 정보(상호·주소·전화)', '상호·주소·전화·영업시간·업종이 모두 등록돼 있습니다.']);
    // 항목 점수는 sub 에만. 근거 문장에서 그 점수를 다시 적은 마디("점유율 15점")는 빼고, 배점은 총점에서 차지하는 비중으로 적는다
    const competition = geo.factors.find((factor) => factor.key === 'competition');
    assert.equal(competition.evidence, '대표키워드 5개 중 5위 안 2개 · 10위 안 2개 · 점유율 15점');
    assert.deepEqual([nodeOf(graph, 'gf:competition').sub, nodeOf(graph, 'gf:competition').detail, nodeOf(graph, 'gf:competition').facts],
        ['15점', '대표키워드 5개 중 5위 안 2개 · 10위 안 2개', [{ label: '총점에서 차지하는 비중', value: '14%' }]]); // 배점 15 / 전체 110
    assert.equal(Math.round((competition.fullWeight / geo.factors.reduce((sum, factor) => sum + factor.fullWeight, 0)) * 100), 14);
    assert.deepEqual(ids(graph, 'fq:'), fanout.map((item) => `fq:${item.key}`));
    assert.deepEqual([nodeOf(graph, 'geo:fanout').label, nodeOf(graph, 'geo:fanout').full, nodeOf(graph, 'geo:fanout').sub, nodeOf(graph, 'geo:fanout').type], ['AI가 묻는 질문', 'AI가 나눠 묻는 질문', '7/8 답함', 'concept']);
    // 답하지 못한 질문은 개수가 아니라 어떤 질문인지로 적는다
    assert.deepEqual(nodeOf(graph, 'geo:fanout').facts, [{ label: '일부만 답한 질문', value: '예약·문의' }, { label: '항목 점수', value: '93점' }]);
    assert.deepEqual(nodeOf(graphOf(PHARMACY), 'geo:fanout').facts, [
        { label: '일부만 답한 질문', value: '위치·가는 길, 예약·문의' }, { label: '답할 정보가 없는 질문', value: '가격대, 대표 메뉴, 쿠폰·혜택', tone: 'bad' }, { label: '항목 점수', value: '53점' },
    ]);
    assert.deepEqual([nodeOf(graph, 'fq:booking').sub, nodeOf(graph, 'fq:booking').tone, nodeOf(graph, 'fq:price').sub, nodeOf(graph, 'fq:price').type], ['일부만 답함', 'warn', '바로 답함', 'aiQuestion']);
    assert.equal(nodeOf(graph, 'fq:booking').facts, undefined); // 상태는 sub 에만
    // AI 다섯 곳의 준비 점수(매장 정보 기준)
    const platforms = platformReadiness(geo, aeo);
    assert.deepEqual(ids(graph, 'ai:').map((id) => nodeOf(graph, id).sub), platforms.map((platform) => `준비 ${platform.score}점`));
    assert.deepEqual(ids(graph, 'ai:'), ['ai:naver', 'ai:chatgpt', 'ai:gemini', 'ai:claude', 'ai:perplexity']);
    assert.deepEqual([nodeOf(graph, 'ai:chatgpt').sub, nodeOf(graph, 'ai:chatgpt').facts], ['준비 84점', [{ label: '등급', value: '양호' }, { label: '가장 약한 항목', value: '홈페이지·SNS 연결' }]]);

    // (정보) —AI 점검에 들어감→ (점검 항목)
    assert.equal(linkOf(graph, 'rv:visitor', 'feeds', 'gf:reviews').why, "AI 점검의 '리뷰 수·평점' 항목(지금 87점)에 방문자 리뷰 수가 들어갑니다.");
    assert.equal(linkOf(graph, 'ac:reply', 'feeds', 'gf:qna').why, "AI 점검의 '리뷰 답글·소식' 항목(지금 47점)에 리뷰 답글률이 들어갑니다.");
    // 키워드마다의 몫(내 3위 → 55점)과 항목 점수(15점 = 다섯 키워드의 평균)는 다른 값이다. 조각에는 몫을 붙이고, 문장에 둘의 관계를 적는다
    const share = (keyword) => { const link = linkOf(graph, `kw:${keyword}`, 'feeds', 'gf:competition'); return [link.why, link.badge]; };
    assert.deepEqual(share('강남구청횟집'), ["'강남구청횟집'에서 내 순위 3위는 AI 점검의 '대표키워드 순위' 항목에서 55점으로 칩니다. 항목 점수는 순위를 조회한 키워드 5개의 평균입니다.", '내 3위 → 55점']);
    assert.deepEqual(share('압구정회식'), ["'압구정회식'에서 내 순위 300위 밖은 AI 점검의 '대표키워드 순위' 항목에서 0점으로 칩니다. 항목 점수는 순위를 조회한 키워드 5개의 평균입니다.", '내 300위 밖 → 0점']);
    const shares = subjectsOf(graph, 'gf:competition', 'feeds').map((id) => linkOf(graph, id, 'feeds', 'gf:competition').badge);
    assert.deepEqual(shares, ['내 3위 → 55점', '내 12위 → 0점', '내 5위 → 20점', '내 41위 → 0점', '내 300위 밖 → 0점']);
    assert.equal(Math.round((55 + 0 + 20 + 0 + 0) / 5), Number.parseInt(nodeOf(graph, 'gf:competition').sub, 10)); // 평균 15점 = 항목 점수
    // 순위를 조회한 키워드가 하나뿐이면 그 값이 곧 항목 점수
    const single = build({ ...input, ranks: input.ranks.slice(0, 1) });
    assert.equal(linkOf(single, 'kw:강남구청횟집', 'feeds', 'gf:competition').why, "'강남구청횟집'에서 내 순위 3위는 AI 점검의 '대표키워드 순위' 항목에서 55점으로 칩니다. 순위를 조회한 키워드가 하나뿐이라 이 값이 그대로 항목 점수입니다.");
    assert.equal(nodeOf(single, 'gf:competition').sub, '55점');
    assert.match(linkOf(graph, 'kw:강남구청횟집', 'feeds', 'gf:keywords').why, /겹쳐 '키워드·리뷰 일치' 점수에 반영됩니다\.$/);
    assert.match(linkOf(graphOf(PHARMACY), 'kw:상비약', 'feeds', 'gf:keywords').why, /찾지 못했습니다\.$/);
    assert.equal(linkOf(graph, 'geo:fanout', 'feeds', 'aeo:score').why, "'AI 답변 준비' 점수에서 가장 크게 치는 항목(35점)이 이 질문들에 답할 수 있는지입니다. 지금 93점입니다.");
    assert.deepEqual(subjectsOf(graph, 'gf:reviews', 'feeds'), ['rv:visitor', 'rv:score', 'rv:text']);
    // 정보가 있어 답에 쓰이면 '질문의 답이 됨', 비어 있어 답하지 못하면 '비어 있어 답하지 못함'
    assert.equal(linkOf(graph, 'pos:price', 'answers', 'fq:price').why, 'AI가 나눠 묻는 "대물섬 강남점 가격대는 어느 정도인가요?"의 답에 이 정보가 쓰입니다.');
    assert.equal(linkOf(graph, 'ops:booking', 'missingFor', 'fq:booking').why, 'AI가 나눠 묻는 "대물섬 강남점 예약이나 문의는 어떻게 하나요?"에 이 정보로는 아직 답하지 못합니다. 채우면 답할 수 있습니다.');
    assert.equal(linkOf(graph, 'ops:booking', 'answers', 'fq:booking'), undefined);
    assert.ok(linkOf(graph, 'ac:coupon', 'missingFor', 'fq:payment'));
    assert.equal(linkOf(graph, 'ac:coupon', 'answers', 'fq:payment'), undefined);
    assert.deepEqual(subjectsOf(graph, 'fq:parking', 'answers'), ['ops:parking', 'ops:conv']);
    // 미용실은 예약이 연결돼 있고 쿠폰도 있어 둘 다 답이 된다(비어 있는 정보가 하나도 없음)
    const salon = graphOf(SALON);
    assert.match(linkOf(salon, 'ops:booking', 'answers', 'fq:booking').why, /의 답에 이 정보가 쓰입니다\.$/);
    assert.ok(linkOf(salon, 'ac:coupon', 'answers', 'fq:payment'));
    assert.deepEqual(salon.links.filter((link) => link.rel === 'missingFor'), []);
    // 약국: 영업시간은 답이 되고, 예약 없음·쿠폰 0개는 비어 있는 정보
    const pharmacy = graphOf(PHARMACY);
    assert.deepEqual(subjectsOf(pharmacy, 'fq:hours', 'answers'), ['ops:hours']);
    assert.deepEqual(pharmacy.links.filter((link) => link.rel === 'missingFor').map((link) => `${link.source}>${link.target}`), ['ops:booking>fq:booking', 'ac:coupon>fq:payment']);
    assert.deepEqual([subjectsOf(pharmacy, 'fq:booking', 'answers'), subjectsOf(pharmacy, 'fq:payment', 'answers')], [[], []]);
    // (점검 항목) —AI 준비 점수를 낮춤→ (AI 서비스): 80점 미만인 항목만
    assert.equal(linkOf(graph, 'gf:sameAs', 'weakens', 'ai:chatgpt').why, "ChatGPT 준비 점수에 들어가는 항목 가운데 '홈페이지·SNS 연결'이 25점으로 낮습니다.");
    assert.equal(linkOf(graph, 'gf:competition', 'weakens', 'ai:naver').why, "네이버 AI 준비 점수에 들어가는 항목 가운데 '대표키워드 순위'가 15점으로 낮습니다.");
    assert.equal(linkOf(graph, 'gf:entity', 'weakens', 'ai:chatgpt'), undefined); // 100점인 항목
});

test('AI 브리핑 문장에 나온 것, 시간대가 들어간 키워드와 같은 시간대 결제', () => {
    const graph = graphOf(RESTAURANT);
    assert.deepEqual([nodeOf(graph, 'brief:0').parent, nodeOf(graph, 'brief:0').full, nodeOf(graph, 'brief:0').type], ['rv:briefing', '숙성회와 소금김밥을 함께 주문하는 손님이 많아요.', 'briefing']);
    assert.equal(linkOf(graph, 'brief:0', 'mentions', 'rmenu:숙성회').why, "네이버 AI 브리핑 문장에 '숙성회'가 나옵니다.");
    assert.deepEqual(objectsOf(graph, 'brief:0', 'mentions'), ['rmenu:김밥', 'rmenu:숙성회']);
    assert.deepEqual(objectsOf(graph, 'brief:1', 'mentions'), []);
    assert.equal(linkOf(graph, 'kw:강남구청점심', 'atTime', 'pos:slot:lunch').why, "'강남구청점심'의 '점심' 시간대 1회 평균 결제는 77,898원입니다(최근 1주 네이버 결제 기준).");
    // ("점심"은 이미 등록한 조합이 있어 지역만 바꾼 "압구정점심"·"강남점심"을 더 권하지 않으므로, 이어지는 키워드는 등록한 것 하나다)
    assert.deepEqual(subjectsOf(graph, 'pos:slot:lunch', 'atTime'), ['kw:강남구청점심']);
    assert.deepEqual(objectsOf(graph, 'kw:강남구청회식', 'atTime'), []);
    // "점심"을 등록하지 않은 매장에서는 추천 키워드 "강남구청점심"이 같은 시간대 결제와 이어진다
    const unregistered = graphOf({ ...RESTAURANT, place: { ...RESTAURANT.place, keywords: ['강남구청횟집'] }, ranks: [] });
    assert.deepEqual([nodeOf(unregistered, 'kw:강남구청점심').type, subjectsOf(unregistered, 'pos:slot:lunch', 'atTime')], ['recoKeyword', ['kw:강남구청점심']]);
});

/* ───────── 먼저 보여 줄 점 · 한 문장 요약 ───────── */

test('spot: 쉬는 화면에서 먼저 이름을 띄울 점 — 문제부터(나쁜 순위 2, 내 위 경쟁 매장 2, 급한 할 일 1) 그리고 잘하는 키워드 1', () => {
    const spots = (graph) => graph.nodes.filter((node) => node.spot).sort((a, b) => a.spot - b.spot).map((node) => `${node.spot} ${node.id}`);
    // 음식점: 300위 밖·41위 키워드, 키워드 4개·3개에서 내 위에 있는 매장, 가장 급한 할 일, 가장 잘하는 3위 키워드
    const restaurant = graphOf(RESTAURANT);
    assert.deepEqual(spots(restaurant), ['1 kw:압구정회식', '2 kw:압구정횟집', '3 rival:test-r1', '4 rival:test-r3', '5 todo:reply', '6 kw:강남구청횟집']);
    assert.deepEqual([nodeOf(restaurant, 'rival:test-r1').sub, nodeOf(restaurant, 'rival:test-r3').sub], ['키워드 4개에서 내 위', '키워드 3개에서 내 위']);
    // 약국: 조회가 끝난 키워드만 본다(조회 중·실패 제외). 가장 잘하는 2위 키워드는 '나쁜 순위'에 넣지 않는다
    assert.deepEqual(spots(graphOf(PHARMACY)), ['1 kw:청주약국', '2 kw:청주대형약국', '3 rival:2021608686', '4 rival:1222439545', '5 todo:keywords', '6 kw:오창약국']);
    // 미용실: 할 일이 없으면 5번은 비워 둔다(만들어 내지 않음). 순위를 본 키워드가 둘뿐이라 2번도 빈다
    assert.deepEqual(spots(graphOf(SALON)), ['1 kw:강남역미용실', '3 rival:test-s2', '4 rival:test-s1', '6 kw:강남역댄디컷']);
    // 10위 안이 하나도 없으면 '잘하는 키워드'(6번)는 없다
    const input = graphInput(RESTAURANT);
    const far = input.ranks.map((row) => (row.result.status === 'found' ? { ...row, result: { ...row.result, rank: row.result.rank + 20 } } : row));
    assert.deepEqual(spots(build({ ...input, ranks: far })).map((text) => text.split(' ')[0]), ['1', '2', '3', '4', '5']);
    // 순위를 조회하지 않았으면 키워드·경쟁 매장 자리는 모두 비고 할 일만 남는다
    assert.deepEqual(spots(graphOf(RESTAURANT, { ranks: [], rivalPool: [] })), ['5 todo:reply']);
    // 나머지 점에는 spot 이 없다
    assert.equal(restaurant.nodes.filter((node) => 'spot' in node).length, 6);
});

test('headline: 요약 칸과 같은 숫자로 쓴 한 문장(데이터가 없는 마디는 뺀다)', () => {
    const input = graphInput(RESTAURANT);
    const graph = build(input);
    assert.equal(graph.headline, '키워드 5개 중 2개가 10위 안 · 할 일 5개 · 키워드 2개 이상에서 내 위에 있는 매장 6곳');
    // 요약 칸의 "10위 안 2/5", "지금 할 일 5개"와 같은 숫자, 경쟁 매장 묶음 점의 숫자와도 같다
    const top10 = input.ranks.filter((row) => row.state === 'done' && row.result.status === 'found' && row.result.rank <= 10).length;
    assert.deepEqual([top10, input.ranks.length, input.actions.length], [2, 5, 5]);
    assert.deepEqual(nodeOf(graph, 'hub:rival').facts.find((fact) => fact.label === '키워드 2개 이상에서 내 위에 있는 매장'), { label: '키워드 2개 이상에서 내 위에 있는 매장', value: '6곳', tone: 'warn' });
    const twice = graph.nodes.filter((node) => node.type === 'rival' && objectsOf(graph, node.id, 'outranks').length >= 2).length;
    assert.equal(twice, 6);
    // 순위 조회가 끝나지 않았으면 10위 안 개수를 말하지 않는다(요약 칸도 조회가 끝나야 보여 줌)
    assert.equal(graphOf(PHARMACY).headline, '키워드 5개 순위 조회 중 · 할 일 9개 · 키워드 2개 이상에서 내 위에 있는 매장 2곳');
    assert.equal(graphOf(SALON).headline, '키워드 2개 중 1개가 10위 안 · 할 일 없음 · 키워드 2개 이상에서 내 위에 있는 매장 1곳');
    // 두 키워드 이상에서 위인 매장이 없으면 한 키워드라도 위인 매장 수를 말한다
    const one = build({ ...input, ranks: input.ranks.slice(0, 1) });
    assert.equal(one.headline, '키워드 1개 중 1개가 10위 안 · 할 일 5개 · 내 위에 있는 매장 2곳');
    // 순위·경쟁 매장이 없으면 그 마디는 없다
    assert.equal(graphOf(RESTAURANT, { ranks: [], rivalPool: [] }).headline, '할 일 5개');
    // 빈 화면 골격에는 headline 이 없다
    assert.equal('headline' in buildIdleGraph(false), false);
});

/* ───────── 상한 · 재현성 · 크기 ───────── */

test('묶음별 상한과 전체 상한을 지킨다', () => {
    const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
    const place = {
        ...RESTAURANT.place,
        reviewVotes: many(20, (i) => ({ label: `좋은 점 ${i}`, count: 500 - i })),
        reviewThemes: many(20, (i) => ({ label: `주제 ${i}`, count: 400 - i })),
        reviewMenus: many(20, (i) => ({ label: `리뷰메뉴${i}`, count: 300 - i })),
        conveniences: many(20, (i) => `편의 ${i}`),
        detail: {
            ...RESTAURANT.place.detail,
            seats: many(10, (i) => `좌석 ${i}`),
            styles: many(8, (i) => ({ name: `스타일${i}`, count: 100 - i })),
            menus: many(40, (i) => ({ name: `등록메뉴${i}`, price: '1,000원', hasImage: true, recommended: false })),
        },
    };
    const activity = { ...RESTAURANT.activity, briefing: many(6, (i) => `브리핑 문장 ${i}번입니다.`) };
    const ranks = many(10, (k) => ({
        keyword: `시험키워드${k}`,
        state: 'done',
        result: {
            keyword: `시험키워드${k}`, placeId: place.placeId, status: 'beyond', rank: null, total: 500, scanned: 300, target: null, topSignals: null,
            // 상위 매장 30곳이 키워드 여러 개에 겹쳐 나온다(키워드 10개 × 상위 10곳 = 100번)
            top: many(10, (j) => ({ rank: j + 1, placeId: `x-${(k * 3 + j) % 30}`, name: `상위 ${(k * 3 + j) % 30}`, isTarget: false, visitorReviews: 100, blogReviews: 10 })),
        },
    }));
    const rivalPool = many(30, (i) => ({ placeId: `x-${i}`, name: `상위 ${i}`, keywords: many(5, (j) => `경쟁키워드${i}-${j}`) }));
    const actions = many(15, (i) => ({ key: `extra${i}`, level: i < 3 ? 'high' : 'low', title: `할 일 ${i}`, detail: '시험용 할 일' }));
    const input = graphInput({ place, activity, rivalPool }, { ranks, actions });
    const graph = build(input, '많은 데이터');
    assertSound(graph, '많은 데이터');

    const count = (prefix) => ids(graph, prefix).length;
    const typed = (type) => graph.nodes.filter((node) => node.type === type).length;
    assert.equal(count('kw:'), GRAPH_LIMITS.keywords);
    assert.equal(typed('recoKeyword') <= GRAPH_LIMITS.reco, true);
    assert.equal(typed('queryKeyword'), 10);
    assert.equal(typed('region') <= GRAPH_LIMITS.regions, true);
    assert.equal(typed('rival'), GRAPH_LIMITS.rivals);
    assert.equal(typed('rivalKeyword'), GRAPH_LIMITS.rivalKeywords);
    assert.equal(typed('strength'), GRAPH_LIMITS.votes);
    assert.equal(typed('reviewTopic'), GRAPH_LIMITS.themes);
    assert.equal(typed('reviewMenu'), GRAPH_LIMITS.reviewMenus);
    assert.equal(typed('blogTerm') <= GRAPH_LIMITS.mentions, true);
    assert.equal(typed('briefing'), GRAPH_LIMITS.briefing);
    assert.equal(typed('popularMenu') <= GRAPH_LIMITS.posMenus, true);
    assert.equal(typed('task'), GRAPH_LIMITS.todo);
    assert.equal(count('conv:'), GRAPH_LIMITS.conveniences);
    assert.equal(count('seat:'), GRAPH_LIMITS.seats);
    assert.equal(typed('facility'), GRAPH_LIMITS.conveniences + GRAPH_LIMITS.seats);
    assert.equal(typed('menu'), GRAPH_LIMITS.menus);
    assert.equal(typed('style'), GRAPH_LIMITS.styles);
    assert.equal(graph.links.filter((link) => link.rel === 'outranks').length <= GRAPH_LIMITS.rankLinks, true);
    assert.equal(graph.nodes.length <= GRAPH_LIMITS.total, true);
    assert.equal(graph.nodes.length > 190, true); // 상한을 모두 채워도 220 을 넘지 않게 잡혀 있다
    assert.deepEqual([GRAPH_LIMITS.total, GRAPH_LIMITS.rivals, GRAPH_LIMITS.rankLinks], [220, 24, 100]);
    // 할 일은 급한 것부터 남고, 묶음 점의 개수는 전체 수다
    assert.deepEqual(ids(graph, 'todo:').slice(0, 3), ['todo:extra0', 'todo:extra1', 'todo:extra2']);
    assert.equal(nodeOf(graph, 'hub:todo').sub, '15개');

    // 전체 상한을 낮추면 가장 깊고 덜 중요한 끝 점부터 빠지고, 묶음 점과 규칙은 그대로다
    const small = build({ ...input, limits: { total: 60 } }, '낮춘 상한');
    assertSound(small, '낮춘 상한');
    assert.equal(small.nodes.length, 60);
    assert.deepEqual(small.nodes.filter((node) => node.level <= 1).map((node) => node.id), graph.nodes.filter((node) => node.level <= 1).map((node) => node.id));
    assert.equal(small.nodes.some((node) => node.level === 3), false);
});

test('같은 입력이면 순서까지 같은 출력을 내고, 입력을 바꾸지 않는다', () => {
    for (const [name, sample] of SAMPLES) {
        const input = graphInput(sample);
        const before = structuredClone(input);
        const first = buildPlaceGraph(input);
        const second = buildPlaceGraph(graphInput(sample));
        assert.deepEqual(first, second, name);
        assert.deepEqual(first.nodes.map((node) => node.id), second.nodes.map((node) => node.id), name);
        assert.deepEqual(first.links.map((link) => link.id), second.links.map((link) => link.id), name);
        assert.deepEqual(input, before, `${name}: 입력이 바뀌면 안 됨`);
    }
    // 기준 시각이 다르면 "며칠 전" 표기만 달라진다
    const later = graphOf(RESTAURANT, { nowMs: NOW + 3 * 24 * 60 * 60 * 1000 });
    assert.deepEqual([nodeOf(later, 'ac:feed').label, nodeOf(later, 'ac:feed').sub], ['마지막 소식', '49일 전']);
});

test('견본 그래프의 크기(묶음·관계 종류)', () => {
    // 추천 키워드가 쓸모 관문을 거치면서 약국의 키워드 점이 22 → 17개로 줄었다(추천 12 → 9개, 조회만 한 키워드 2개가 추천 안으로).
    // 그 뒤(2026-11-17 4차): 약국은 분류 이름 조합(청주일반의약품 등) 대신 내 순위가 좋은 오창 조합이 들어와 점 수는 그대로이고
    // 분류 이름 → 손님 말 조합('대신 써 볼 키워드') 연결이 2개 늘었다(229 → 232, 내 매장 조각 값은 연결 수와 무관).
    // 음식점은 주력 갈래(회) 밖 곁들임(갈치·볼락구이)과 순위가 나쁜 압구정 조합이 빠지고 대방어가 들어와 추천 11 → 8개(165 → 162).
    assert.deepEqual(summarizeGraph(graphOf(PHARMACY)).groups, { store: 1, search: 17, rival: 16, voice: 29, todo: 9, ops: 9, geo: 30 });
    assert.deepEqual(summarizeGraph(graphOf(RESTAURANT)).groups, { store: 1, search: 18, rival: 10, voice: 50, pay: 21, todo: 6, ops: 26, geo: 30 });
    assert.deepEqual(summarizeGraph(graphOf(SALON)).groups, { store: 1, search: 21, rival: 6, voice: 53, todo: 1, ops: 22, geo: 30 });
    const sizes = (sample) => { const s = summarizeGraph(graphOf(sample)); return [s.nodes, s.links, s.cross]; };
    assert.deepEqual([sizes(PHARMACY), sizes(RESTAURANT), sizes(SALON)], [[111, 232, 122], [162, 300, 139], [134, 236, 103]]);
    const rels = (sample) => Object.keys(summarizeGraph(graphOf(sample)).rels).sort();
    assert.deepEqual(rels(RESTAURANT), ['answers', 'atTime', 'feeds', 'lagsOn', 'mentions', 'missingFor', 'namedIn', 'outranks', 'partOf', 'ranksIn', 'readFrom', 'registers', 'sameItem', 'sharesTerm', 'spokenIn', 'supports', 'targets', 'usesRegion', 'weakens']);
    assert.deepEqual(rels(PHARMACY), ['alternativeTo', 'answers', 'feeds', 'lagsOn', 'missingFor', 'outranks', 'partOf', 'ranksIn', 'registers', 'sharesTerm', 'spokenIn', 'suggests', 'supports', 'targets', 'usesRegion', 'weakens']);
    assert.deepEqual(rels(SALON), ['answers', 'feeds', 'namedIn', 'outranks', 'partOf', 'ranksIn', 'readFrom', 'registers', 'sameItem', 'sharesTerm', 'spokenIn', 'supports', 'usesRegion', 'weakens']);
});

test('빈 화면·불러오는 중의 골격은 실제 데이터처럼 보이지 않게 ghost 로 두고, 스키마 밖에 둔다', () => {
    const idle = buildIdleGraph(false);
    assert.equal(idle.nodes.length, 22);
    assert.equal(idle.links.length, 21);
    assert.equal(idle.nodes.every((node) => node.ghost === true), true);
    assert.deepEqual([idle.nodes[0].id, idle.nodes[0].label, idle.nodes[0].parent], ['store', '내 매장', null]);
    assert.equal(idle.nodes.filter((node) => node.level === 1).length, 7);
    // 자리 표시일 뿐 개체가 아니라서 종류·관계를 붙이지 않는다
    assert.equal(idle.nodes.some((node) => 'type' in node) || idle.links.some((link) => 'rel' in link), false);
    const loading = buildIdleGraph(true);
    assert.deepEqual([loading.nodes[0].label, loading.nodes[0].ghost, loading.nodes[1].detail], ['조회 중', false, '불러오는 중']);
    assert.equal(loading.nodes.slice(1).every((node) => node.ghost === true), true);
    // 실제 그래프에는 ghost 가 없다
    assert.equal(graphOf(PHARMACY).nodes.some((node) => node.ghost), false);
});

test('표시 도우미: 본문과 그래프가 함께 쓰는 숫자·날짜·순위 표기', () => {
    assert.deepEqual([formatNumber(1234567), formatNumber(0), formatNumber(null), formatNumber(undefined)], ['1,234,567', '0', '-', '-']);
    assert.deepEqual([won(18900), won(0), won(null)], ['18,900원', '-', '-']);
    assert.deepEqual([shorten('짧은 이름', 10), shorten('아주 긴 매장 이름입니다', 6), shorten(null, 5)], ['짧은 이름', '아주 긴 …', '']);
    assert.deepEqual([agoLabel('2026-11-16', NOW), agoLabel('2026-11-15', NOW), agoLabel('2026-10-01', NOW), agoLabel(null, NOW)], ['오늘', '어제', '46일 전', '-']);
    assert.deepEqual([rankLabel({ status: 'found', rank: 7 }), rankLabel({ status: 'not_listed' }), rankLabel({ status: 'beyond', scanned: 1000 })], ['7위', '목록에 없음', '1,000위 밖']);
    assert.deepEqual([3, 10, 11, 50, 51].map((rank) => rankTone({ status: 'found', rank })), ['good', 'good', 'ink', 'ink', 'warn']);
    assert.equal(rankTone({ status: 'beyond' }), 'bad');
    assert.deepEqual([sampleSuffix(50, 50, 300), sampleSuffix(12, 50, 300), sampleSuffix(0, 0, 0)], ['개 이상', '개', '개']);
});
