// 살펴보기 카드에 넣을 내용을 만드는 순수 함수 모음입니다(React·브라우저 API 를 쓰지 않아 테스트에서 그대로 부를 수 있습니다).
// 수치·항목을 만들어 내지 않습니다: 그래프가 준 점·연결의 값만 골라 순서를 정하고, 같은 내용이 겹치면 한 번만 남깁니다.
//
// 관계 묶음의 제목은 항상 "아래 항목들이 고른 점에게 무엇인지"를 말하는 명사구입니다.
//   고른 점이 주어인 연결(direction 'out') → relations[rel].forward
//   고른 점이 목적어인 연결(direction 'in') → relations[rel].inverse
// 캔버스의 관계 이름표도 relationTitle 을 써서 카드와 같은 말을 씁니다.

const SEPARATOR = ' · ';
const FALLBACK_TITLES = { contains: '여기에 든 것', parent: '속한 곳', other: '이어진 항목' };
const FALLBACK_GO = '본문에서 보기';
// '1위'·'12위' 꼴의 값은 이름 앞에 붙여 순위표처럼 읽히게 합니다.
const ORDINAL = /^(\d+)위$/;
// 숫자와 바로 뒤의 단위 한 글자('323개'·'40%'·'4.97점'). 같은 값이 두 번 나오는지 가릴 때 씁니다.
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)([가-힣%]?)/g;

function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

// 띄어쓰기·대소문자만 다른 것은 같은 말로 봅니다.
function squash(value) {
    return text(value).replace(/\s+/g, '').toLowerCase();
}

function same(a, b) {
    const left = squash(a);
    return left !== '' && left === squash(b);
}

// 글 속의 수량들: [{ n: '323', u: '개' }]
function amounts(value) {
    return [...text(value).matchAll(AMOUNT)].map((match) => ({ n: match[1].replace(/,/g, ''), u: match[2] }));
}

// 같은 수량인지: 숫자가 같고, 단위는 둘 다 적혀 있을 때만 견줍니다('30/52'의 30 과 '30개'는 같은 값).
function sameAmount(a, b) {
    return a.n === b.n && (!a.u || !b.u || a.u === b.u);
}

// 숫자를 뺀 낱말들(두 글자 이상)
function words(value) {
    return text(value).replace(AMOUNT, ' ').split(/[^가-힣A-Za-z]+/).filter((word) => word.length >= 2);
}

// 점의 짧은 이름(그래프 이름표와 같은 글자)
export function nameOf(node) {
    return node ? text(node.label) || text(node.full) : '';
}

// 줄 목록에 쓰는 이름: 이름표가 '…' 로 잘렸으면 자르지 않은 이름을 씁니다.
function wholeName(node) {
    const label = text(node.label);
    if (label && !label.endsWith('…')) return label;
    return text(node.full) || label;
}

function lookup(names, key) {
    if (!names) return '';
    if (typeof names.get === 'function') return text(names.get(key));
    return text(names[key]);
}

// 종류 이름을 카드 머리에 쓰지 않는 종류인지(예: '묶음'). 계약 v2 의 quiet 가 없으면 묶음이 정해지지 않은 종류로 봅니다.
export function isQuietClass(type, ontology) {
    const klass = ontology?.classes?.[type];
    if (!klass) return true;
    if (typeof klass.quiet === 'boolean') return klass.quiet;
    return klass.group === null || klass.group === undefined;
}

// 묶음 점(매장·범주)인지: '여기에 든 것'을 맨 위에 둡니다.
function isHub(node, ontology) {
    if (!node) return false;
    if (typeof node.level === 'number' && node.level <= 1) return true;
    return Boolean(ontology?.classes?.[node.type]) && isQuietClass(node.type, ontology);
}

// 부모-자식 연결인지. 예전 데이터(kind 없음)는 parent 로 가립니다.
function isTreeLink(link, self, other) {
    if (link.kind) return link.kind === 'tree';
    if (!self || !other) return false;
    return other.parent === self.id || self.parent === other.id;
}

// 관계 묶음의 제목. direction: 'out' = 고른 점이 주어, 'in' = 고른 점이 목적어.
export function relationTitle(rel, direction, ontology) {
    const relation = ontology?.relations?.[rel];
    if (!relation) return '';
    const forward = text(relation.forward) || text(relation.label) || text(relation.name);
    if (relation.symmetric) return forward || text(relation.inverse);
    if (direction === 'in') return text(relation.inverse) || forward;
    return forward;
}

// 문장의 술어("주어 —술어→ 목적어"의 가운데 말)
export function relationPredicate(rel, ontology) {
    const relation = ontology?.relations?.[rel];
    return relation ? text(relation.label) || text(relation.name) || text(relation.forward) : '';
}

// 고른 점의 연결을 관계·방향별로 묶어 카드에 나오는 순서대로 돌려줍니다.
//   묶음 점이면 '여기에 든 것'이 맨 위
//   → 의미 있는 관계: 갈래 순서(families[].order: 경쟁 → 할 일 → 추천 이유 …) → 개수 많은 순 → strength 큰 순.
//     그래도 같으면 스키마에 적힌 관계 순서. 갈래 순서가 없는 예전 스키마는 개수 → strength 순만 봅니다.
//   → 묶음 점이 아닌 점의 '여기에 든 것' → 구조 관계(quiet)는 맨 아래.
// 돌려주는 값: [{ key, rel, direction, title, quiet, contains, family, count, strength, links[] }]
export function relationGroups({ nodeId, links, nodeById, ontology }) {
    const self = nodeById?.get(nodeId) || null;
    const relations = ontology?.relations || {};
    const families = ontology?.families || {};
    const relationKeys = Object.keys(relations);
    const groups = new Map();
    for (const link of links || []) {
        const direction = link.source === nodeId ? 'out' : link.target === nodeId ? 'in' : null;
        if (!direction) continue;
        const otherId = direction === 'out' ? link.target : link.source;
        if (otherId === nodeId) continue;
        const other = nodeById ? nodeById.get(otherId) : null;
        if (nodeById && !other) continue;
        const relation = relations[link.rel] || null;
        const tree = isTreeLink(link, self, other);
        const contains = tree && direction === 'in';
        const symmetric = Boolean(relation?.symmetric);
        let key = 'etc';
        if (relation) key = symmetric ? link.rel : `${link.rel}:${direction}`;
        else if (tree) key = contains ? 'tree:in' : 'tree:out';
        let group = groups.get(key);
        if (!group) {
            const quietRelation = relation && typeof relation.quiet === 'boolean' ? relation.quiet : tree;
            const fallback = tree ? (contains ? FALLBACK_TITLES.contains : FALLBACK_TITLES.parent) : FALLBACK_TITLES.other;
            const family = relation?.family || (tree ? 'structure' : '');
            group = {
                key,
                rel: relation ? link.rel : null,
                direction: symmetric ? 'out' : direction,
                symmetric,
                title: (relation ? relationTitle(link.rel, direction, ontology) : '') || fallback,
                quiet: quietRelation && !contains,
                contains,
                family,
                familyOrder: typeof families[family]?.order === 'number' ? families[family].order : 99,
                // 개수·strength 까지 같을 때만 스키마에 적힌 관계 순서(내 위 → 내 아래 → …)로 가립니다.
                relationOrder: relation ? relationKeys.indexOf(link.rel) : 999,
                count: 0,
                strength: 0,
                links: [],
                order: groups.size,
            };
            groups.set(key, group);
        }
        group.count += 1;
        group.strength = Math.max(group.strength, Number(link.strength) || 0);
        group.links.push(link);
    }
    const hub = isHub(self, ontology);
    const tier = (group) => (group.quiet ? 3 : group.contains ? (hub ? 0 : 2) : 1);
    return [...groups.values()].sort((a, b) => tier(a) - tier(b) || a.familyOrder - b.familyOrder || b.count - a.count || b.strength - a.strength || a.relationOrder - b.relationOrder || a.order - b.order);
}

// 큰 값을 다시 적은 수치를 찾습니다(있으면 그 자리 번호, 없으면 -1). 앞에서부터 한 개만 고릅니다.
//   글자가 같거나('3위' = '3위'), 큰 값으로 시작하거나('80점' ↔ '80점 / 100점'),
//   같은 수량이면서 이름에 큰 값의 낱말이 들어 있는 것('손님 299명' ↔ 고른 손님 299명).
// 우연히 숫자만 같은 다른 수치(배점 15점)를 빼지 않도록, 수치 칸의 순서대로 처음 맞는 것만 봅니다.
export function restatedFact(value, facts) {
    const head = text(value);
    if (!head) return -1;
    const headAmounts = amounts(head);
    const headWords = words(head);
    return facts.findIndex((fact) => {
        if (same(fact.value, head)) return true;
        const first = amounts(fact.value)[0];
        if (!first || !headAmounts.some((amount) => sameAmount(amount, first))) return false;
        if (!headWords.length) return squash(fact.value).startsWith(squash(head));
        return headWords.some((word) => text(fact.label).includes(word));
    });
}

// 설명 줄에서 이미 보여 준 내용을 뺍니다.
//   drops 와 글자가 같은 조각(큰 값·제목·종류 이름)은 빼고,
//   남은 조각이 모두 "이미 보인 수량만 다시 적은 것"이면 줄 전체를 뺍니다(같은 값을 두 번 읽히지 않게).
//   새 내용이 하나라도 있으면 문장이 어색하게 끊기지 않도록 남은 조각을 그대로 둡니다.
//   단위까지 풀어 쓴 문장('52개 중 30개')은 줄여 쓴 값('30/52')의 풀이이므로 반복으로 보지 않습니다.
// shown: 이미 화면에 나온 글들(큰 값, 수치 칸의 이름과 값)
export function trimDetail(detail, drops = [], shown = []) {
    const whole = text(detail);
    if (!whole) return '';
    const parts = whole.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
    const kept = parts.filter((part) => !drops.some((drop) => same(drop, part)));
    if (!kept.length) return '';
    const seen = shown.flatMap((entry) => amounts(entry));
    const alreadyShown = (amount) => seen.some((other) => amount.n === other.n && (!amount.u || amount.u === other.u));
    const repeats = (part) => {
        if (shown.some((entry) => same(entry, part))) return true;
        const found = amounts(part);
        return found.length > 0 && found.every(alreadyShown);
    };
    if (kept.every(repeats)) return '';
    return kept.join(SEPARATOR);
}

function makeItem({ link, direction, self, other, tree, ontology }) {
    const relation = ontology?.relations?.[link.rel] || null;
    const subject = direction === 'out' ? self : other;
    const object = direction === 'out' ? other : self;
    const ownBadge = text(link.badge);
    // 조각에 붙는 값: 그 연결의 값(link.badge)이 먼저, 없으면 상대 점의 핵심 값(sub — 그래프 이름표 옆에 붙는 값과 같음).
    const badge = ownBadge || text(other.sub);
    const why = text(link.why);
    // 그 연결의 순위(숫자): link.rank 가 있으면 그것, 없으면 값이 '○위' 꼴일 때 그 숫자. 한 묶음 안의 순서를 정할 때 씁니다.
    const bare = ownBadge.match(ORDINAL);
    const rank = typeof link.rank === 'number' && Number.isFinite(link.rank) ? link.rank : bare ? Number(bare[1]) : null;
    return {
        key: link.id,
        linkId: link.id,
        id: other.id,
        group: other.group,
        type: other.type,
        label: nameOf(other),
        name: wholeName(other),
        full: text(other.full) || nameOf(other),
        badge,
        badgeTone: ownBadge ? text(link.badgeTone) : text(other.subTone),
        // 주인을 적지 않은 순위('○위')만 이름 앞에 둡니다. 주인을 적은 값('이 매장 2위', '내 3위')과 상대 점 자신의 값은 이름 뒤에 둡니다.
        lead: Boolean(bare),
        rank,
        hint: '',
        why,
        // 이유 문장이 없는 연결(부모-자식)은 상대 점의 설명을 대신 보여 줍니다(배지·이름과 같은 내용은 뺌).
        about: why ? '' : trimDetail(other.detail, [badge, other.sub, other.label, other.full], [badge, other.sub, other.label]),
        triple: relation ? { subject: nameOf(subject), predicate: relationPredicate(link.rel, ontology), object: nameOf(object), symmetric: Boolean(relation.symmetric) } : null,
        strength: Number(link.strength) || 0,
        tree,
        via: false,
    };
}

// 한 묶음 안의 순서: 중요한 것부터. 모두 그 연결의 순위(rank)가 있으면 순위 순서로 둡니다.
function sortItems(items) {
    const ranked = items.length > 1 && items.every((item) => item.rank !== null);
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (ranked ? a.item.rank - b.item.rank : 0) || b.item.strength - a.item.strength || a.index - b.index)
        .map((entry) => entry.item);
}

// 이름도 붙은 값도 같은 서로 다른 점은 종류 이름(없으면 그 점의 값)을 보조로 붙여 가릅니다.
function addHints(items, nodeById, ontology) {
    const byLabel = new Map();
    for (const item of items) {
        if (!byLabel.has(item.label)) byLabel.set(item.label, []);
        byLabel.get(item.label).push(item);
    }
    for (const sameName of byLabel.values()) {
        const ids = [...new Set(sameName.map((item) => item.id))];
        if (ids.length < 2) continue;
        const kindOf = (id) => text(ontology?.classes?.[nodeById.get(id)?.type]?.label);
        const subOf = (id) => text(nodeById.get(id)?.sub);
        const distinct = (list) => list.every(Boolean) && new Set(list).size === list.length;
        const useKind = distinct(ids.map(kindOf));
        for (const item of sameName) {
            const clash = sameName.some((other) => other.id !== item.id && other.badge === item.badge);
            if (!clash) continue;
            const hint = useKind ? kindOf(item.id) : subOf(item.id);
            if (hint && hint !== item.badge) item.hint = hint;
        }
    }
}

// 추천 키워드 점(node.reasons)의 "추천한 이유"는 이어진 연결이 아니라 본문 추천 이유 칩의 목록(개수·순서·문구 그대로)으로 그립니다.
//   이유마다 [{ kind, text, sources[] }]: sources 에 이어 줄 점의 id 가 있으면 그 연결을 가진 항목(눌러 그 점으로 감), 없으면 문장만 있는 항목(id 없음).
//   같은 이유가 '이 키워드를 추천한 이유'(supports 의 들어오는 연결) 묶음에 또 나와 두 번 세어지지 않게, 그 묶음은 이 목록으로 갈아 끼웁니다.
//   그 묶음이 없으면(이을 점이 하나도 없음) 갈래 순서에 맞는 자리에 새로 만듭니다.
// 이유 문장이 앞머리("'○○' 추천 이유:")만 붙인 채 칩 문구를 그대로 되풀이하는지(따옴표·마침표·띄어쓰기 차이는 무시).
function restatesLabel(why, label) {
    const body = text(why).replace(/^.*?추천 이유\s*[:：]\s*/, '');
    const norm = (value) => text(value).replace(/[\s'"‘’“”.,·]/g, '');
    return Boolean(body) && norm(body) === norm(label);
}

export function applyReasons(groups, node, ontology) {
    const reasons = Array.isArray(node?.reasons) ? node.reasons.filter((reason) => reason && text(reason.text)) : [];
    if (reasons.length === 0) return groups;
    const at = groups.findIndex((group) => group.rel === 'supports' && group.direction === 'in' && !group.contains);
    const existing = at >= 0 ? groups[at] : null;
    const taken = new Set();
    const items = reasons.map((reason, index) => {
        const label = text(reason.text);
        const sources = Array.isArray(reason.sources) ? reason.sources.filter(Boolean) : [];
        const found = existing ? existing.items.find((item) => sources.includes(item.id) && !taken.has(item.key)) : null;
        if (found) {
            taken.add(found.key);
            // 연결의 이유 문장(why)은 두되, 이름은 본문 칩과 같은 문구로 바꿉니다(배지는 같은 말이 되풀이되어 뺌).
            // 이유 문장이 칩 문구를 그대로 되풀이할 뿐이면("'강남구청모임' 추천 이유: 단체모임 …37명.") 설명 줄을 그리지 않습니다.
            return { ...found, label, name: label, full: label, lead: false, badge: '', badgeTone: '', hint: sources.length > 1 ? `외 ${sources.length - 1}곳` : '', why: restatesLabel(found.why, label) ? '' : found.why };
        }
        return {
            key: `reason:${index}`, linkId: null, id: null, group: node.group, type: node.type, label, name: label, full: label,
            badge: '', badgeTone: '', lead: false, rank: null, hint: '', why: '', about: '', triple: null, strength: 0, tree: false, via: false,
        };
    });
    if (existing) {
        const next = [...groups];
        next[at] = { ...existing, items };
        return next;
    }
    const relation = ontology?.relations?.supports || null;
    const family = relation?.family || 'evidence';
    const orderOf = (name) => (typeof ontology?.families?.[name]?.order === 'number' ? ontology.families[name].order : 99);
    const group = {
        key: 'supports:in', rel: 'supports', direction: 'in', title: relationTitle('supports', 'in', ontology) || '이 키워드를 추천한 이유',
        quiet: false, contains: false, family,
        triple: { subject: null, predicate: relationPredicate('supports', ontology), object: nameOf(node), symmetric: false },
        items,
    };
    let place = groups.findIndex((other) => !other.quiet && !other.contains && orderOf(other.family) > orderOf(family));
    if (place < 0) place = groups.findIndex((other) => other.quiet);
    if (place < 0) place = groups.length;
    return [...groups.slice(0, place), group, ...groups.slice(place)];
}

// 카드 한 장의 내용.
//   node        고른 점
//   links       그래프의 연결 전체(또는 이 점에 닿은 것만)
//   nodeById    Map(id → 점)
//   ontology    { classes, relations, families } (없어도 됨: 예전 데이터)
//   groupNames  Map 또는 객체(group → 묶음 이름)
//   via         { linkId } 방금 타고 건너온 연결(없으면 null)
export function buildCardModel({ node, links, nodeById, ontology, groupNames, via = null }) {
    const title = text(node.full) || text(node.label) || lookup(groupNames, node.group) || '항목';
    const groupLabel = lookup(groupNames, node.group) || '항목';
    // 머리의 '묶음 · 종류': 제목과 같은 말은 다시 쓰지 않고, quiet 종류('묶음')는 쓰지 않습니다.
    const groupName = same(groupLabel, title) ? '' : groupLabel;
    const klass = ontology?.classes?.[node.type] || null;
    const kindLabel = klass && !isQuietClass(node.type, ontology) ? text(klass.label) : '';
    const kindName = kindLabel && !same(kindLabel, groupLabel) && !same(kindLabel, title) ? kindLabel : '';
    const value = text(node.sub);

    const allFacts = (Array.isArray(node.facts) ? node.facts : [])
        .filter((fact) => fact && text(fact.label) && text(fact.value))
        .map((fact) => ({ label: text(fact.label), value: typeof fact.value === 'number' ? fact.value : text(fact.value), tone: text(fact.tone) }));
    // 큰 값을 다시 적은 수치는 쓰지 않습니다.
    const restated = restatedFact(value, allFacts);
    const facts = allFacts.filter((fact, index) => index !== restated).slice(0, 4);
    const detail = trimDetail(
        node.detail,
        [value, title, node.label, groupLabel, kindLabel],
        [value, ...facts.flatMap((fact) => [fact.label, fact.value, `${fact.label}${fact.value}`])],
    );

    const groups = applyReasons(relationGroups({ nodeId: node.id, links, nodeById, ontology }).map((group) => {
        const items = sortItems(group.links.map((link) => {
            const direction = link.source === node.id ? 'out' : 'in';
            const other = nodeById.get(direction === 'out' ? link.target : link.source);
            return makeItem({ link, direction, self: node, other, tree: isTreeLink(link, node, other), ontology });
        }));
        // 묶음의 읽는 법(주어·술어·목적어). 상대 쪽 자리는 null 로 비워 둡니다(화면이 '아래 항목'으로 채움).
        let triple = null;
        if (group.rel && !group.contains && !group.quiet) {
            const self = nameOf(node);
            triple = group.direction === 'in' && !group.symmetric
                ? { subject: null, predicate: relationPredicate(group.rel, ontology), object: self, symmetric: false }
                : { subject: self, predicate: relationPredicate(group.rel, ontology), object: null, symmetric: group.symmetric };
        }
        return { key: group.key, rel: group.rel, direction: group.direction, title: group.title, quiet: group.quiet, contains: group.contains, family: group.family, triple, items };
    }), node, ontology);

    const everyItem = groups.flatMap((group) => group.items);
    addHints(everyItem, nodeById, ontology);

    // 방금 건너온 연결: 그 묶음과 항목을 맨 앞으로 옮기고 표시합니다(접혀 있는 구조 관계는 그대로 둡니다).
    let arrived = null;
    if (via && via.linkId) {
        const at = groups.findIndex((group) => !group.quiet && group.items.some((item) => item.linkId === via.linkId));
        if (at >= 0) {
            const [group] = groups.splice(at, 1);
            const index = group.items.findIndex((item) => item.linkId === via.linkId);
            const [item] = group.items.splice(index, 1);
            item.via = true;
            group.items.unshift(item);
            groups.unshift(group);
            arrived = { item, title: group.title };
        }
    }

    let go = null;
    if (node.go !== null) go = text(node.go) || FALLBACK_GO;

    return {
        id: node.id,
        group: node.group,
        groupName,
        kindName,
        title,
        value,
        valueTone: text(node.subTone) || text(node.tone),
        detail,
        facts,
        groups,
        total: everyItem.length,
        via: arrived,
        go,
    };
}
