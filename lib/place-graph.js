// 플레이스 분석 "연결 그래프"의 데이터 — 매장 하나의 분석 결과를 점(node)과 연결(link)로 바꾸는 순수 함수 모음.
//
// 화면이 이미 받아 둔 값(매장 요약·활동·순위 결과·경쟁 매장 대표키워드·추천 키워드·할 일)만 씁니다.
// 수치나 항목을 만들어 내지 않습니다: 데이터가 없으면 점도 없습니다(POS 가 없는 매장에는 결제 묶음이 없음).
// 네트워크 요청·React·브라우저 API 를 쓰지 않아 테스트에서 그대로 부를 수 있습니다.
//
// 그래프는 온톨로지(지식 그래프) 모양입니다: 점마다 개체 종류(type)가, 연결마다 관계 종류(rel)가 정해져 있고
// 그 목록과 "어떤 종류에서 어떤 종류로 이을 수 있는지"는 아래 ONTOLOGY 에 적혀 있습니다.
//
// 점(node) = 개체
//   id      본문 카드의 data-node 와 같은 값. 같은 id 끼리 그래프와 카드를 서로 밝힙니다.
//   type    ONTOLOGY.classes 의 키(대표키워드·경쟁 매장·손님이 고른 좋은 점 …)
//   level   0 매장 · 1 묶음의 중심 · 2 항목(목록의 작은 묶음 포함) · 3 세부·이유. 부모보다 항상 한 단계 아래입니다.
//   group   store · search · rival · voice · pay · todo · ops · geo (이름은 ONTOLOGY.groups)
//   label   줄인 이름(낱말 단위로 줄이고 조금 넘치는 것은 그대로 둠). full 은 줄이지 않은 이름, detail 은 자르지 않은 설명 문장
//   sub     이름 아래 짧은 값. 낱말 점은 출처와 수('리뷰 22회', '블로그 30/52')
//   weight  0~1. 같은 묶음 안에서의 상대적 중요도(개수는 로그 눈금으로 줄여 한두 개가 나머지를 덮지 않게 합니다)
//   facts   살펴볼 때 보여 줄 실제 수치(최대 4개)
//   go      살펴보기 카드의 버튼 문구 = 도착지 이름('순위 표 보기'). aria 는 "… 살펴보기"
//   spot    쉬는 화면에서 먼저 이름을 띄울 순서(1~6, 해당하는 점에만)
// 연결(link) = (주어 source) —관계 rel→ (목적어 target)
//   kind 'tree'  부모-자식. rel 은 항상 'partOf' 이고 자식 → 부모 방향입니다(모든 점은 부모를 따라가면 'store' 에 닿습니다).
//   kind 'cross' 그 밖의 관계. `${주어 이름} —${관계의 label}→ ${목적어 이름}` 으로 읽히고, 그 한 건의 구체적 설명을 why 에 적습니다.
//                badge 는 카드의 조각에 붙는 짧은 값(출처와 수 "리뷰 22회", 순위 "이 매장 2위")입니다. 연결의 양쪽 카드에 똑같이 나오므로
//                순위·수치에는 누구 것인지를 적습니다("이 매장 2위", "내 3위 → 55점", "상위권 중간 900개"). rank 는 그 순위의 숫자입니다(순위순으로 놓을 때 씀).
//                사실대로 문장으로 읽히지 않는 관계는 만들지 않습니다. 같은 (주어·관계·목적어)는 한 번만 나옵니다.
// 그래프 전체: { nodes, links, headline } — headline 은 요약 칸과 같은 숫자로 쓴 한 문장입니다.

import { daysAgo, diagnoseRank, feedDays } from './naver-place.js';
import { familyOf, popularMenuTerm } from './place-keywords.js';
import { notApplicableOf } from './place-industry.js';
import {
    josa, scoreGeo, scoreAeo, platformReadiness, buildFanout, fanoutCoverage, keywordConsistency, rankSharePoints,
} from './place-geo.js';

/* ───────── 온톨로지: 개체 종류와 관계 종류 ─────────
 * 화면에 그대로 나오는 말이라 식당 사장님이 아는 낱말(순위·리뷰·키워드·매장·손님·추천·이유·할 일·정보)로만 적습니다.
 *
 * groups    묶음. 범례·묶음 점 이름·살펴보기 카드 머리·빈 화면 골격이 모두 이 이름 하나를 씁니다(본문 구역 이름과 같음).
 * classes   개체 종류. group 은 그 종류가 놓이는 묶음입니다. 묶음 점(concept)만 모든 묶음에 걸쳐 있어 null 이고,
 *           quiet: true 라 카드 머리에 종류 이름을 쓰지 않습니다.
 * families  관계의 갈래. order 는 목록에서의 순서, quiet: true 는 화면에서 숨기는 갈래입니다.
 * relations 관계 종류. (주어 source) —관계→ (목적어 target)
 *   name     목록·띠·선 위 이름표에 쓰는 짧은 이름(명사형)
 *   label    문장의 술어: `${주어} —${label}→ ${목적어}`
 *   forward  내가 주어일 때, 카드에서 상대(목적어) 조각 묶음의 제목. "아래 조각들이 나에게 무엇인지"를 말하는 명사구
 *   inverse  내가 목적어일 때, 상대(주어) 조각 묶음의 제목. 같은 규칙의 명사구
 *   from·to  주어·목적어가 될 수 있는 개체 종류
 *   symmetric: true  방향이 없는 관계(뒤집은 것은 같은 연결). quiet: true  이름표를 붙이지 않고 목록·카드에서 맨 아래에 두거나 숨기는 구조 관계
 * relations 의 키 순서가 곧 목록·카드에 나오는 순서입니다(갈래 order 순, 같은 갈래 안에서는 적힌 순서). */

const KEYWORD_TYPES = ['keyword', 'recoKeyword', 'queryKeyword'];
const MENU_TYPES = ['reviewMenu', 'popularMenu', 'menu', 'style'];

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

// item: 업종에 맞춘 낱말 — 음식점 '메뉴', 미용·네일·피부 '시술', 그 밖 '메뉴·서비스'
function makeOntology(item) {
    return deepFreeze({
        groups: {
            store: { label: '내 매장', order: 0 },
            search: { label: '키워드 순위', order: 1 },
            rival: { label: '경쟁 매장', order: 2 },
            voice: { label: '리뷰·활동', order: 3 },
            pay: { label: '결제 데이터', order: 4 },
            todo: { label: '할 일', order: 5 },
            ops: { label: '운영 정보', order: 6 },
            geo: { label: 'AI 검색', order: 7 },
        },
        classes: {
            store: { label: '내 매장', group: 'store' },
            concept: { label: '묶음', group: null, quiet: true },
            keyword: { label: '대표키워드', group: 'search' },
            recoKeyword: { label: '추천 키워드', group: 'search' },
            queryKeyword: { label: '조회한 키워드', group: 'search' },
            region: { label: '지역 이름', group: 'search' },
            rival: { label: '경쟁 매장', group: 'rival' },
            rivalKeyword: { label: '경쟁 매장 키워드', group: 'rival' },
            reviewMetric: { label: '리뷰 숫자', group: 'voice' },
            activityMetric: { label: '활동 숫자', group: 'voice' },
            strength: { label: '손님이 고른 좋은 점', group: 'voice' },
            reviewTopic: { label: '리뷰 주제', group: 'voice' },
            reviewMenu: { label: `리뷰에 나온 ${item}`, group: 'voice' },
            // 예약 많은 스타일은 본문에서 리뷰 구역의 목록(리뷰에 나온 시술 옆)에 있어, 그래프에서도 같은 묶음에 둡니다.
            style: { label: '예약 많은 스타일', group: 'voice' },
            blogTerm: { label: '블로그에 나온 낱말', group: 'voice' },
            briefing: { label: 'AI 브리핑 문장', group: 'voice' },
            payMetric: { label: '결제 숫자', group: 'pay' },
            timeSlot: { label: '요일·시간대', group: 'pay' },
            popularMenu: { label: '주간 인기 메뉴', group: 'pay' },
            task: { label: '할 일', group: 'todo' },
            opsItem: { label: '운영 항목', group: 'ops' },
            facility: { label: '편의시설·좌석', group: 'ops' },
            menu: { label: `등록한 ${item}`, group: 'ops' },
            aiScore: { label: 'AI 준비 점수', group: 'geo' },
            aiFactor: { label: 'AI 점검 항목', group: 'geo' },
            aiQuestion: { label: 'AI가 묻는 질문', group: 'geo' },
            aiPlatform: { label: 'AI 서비스', group: 'geo' },
        },
        families: {
            competition: { label: '경쟁 매장', order: 1 },
            action: { label: '할 일', order: 2 },
            evidence: { label: '추천 이유·손님 말', order: 3 },
            registration: { label: '키워드 등록·지역', order: 4 },
            same: { label: '같은 것끼리', order: 5 },
            ai: { label: 'AI 검색 준비', order: 6 },
            structure: { label: '묶음', order: 7, quiet: true },
        },
        relations: {
            // 경쟁 매장
            outranks: {
                name: '내 위에 있는 매장', label: '검색에서 내 매장보다 위', forward: '이 매장이 내 위에 있는 키워드', inverse: '이 키워드에서 내 위에 있는 매장',
                family: 'competition', from: ['rival'], to: KEYWORD_TYPES,
            },
            ranksIn: {
                name: '내 아래에 있는 매장', label: '검색에서 내 매장보다 아래', forward: '이 매장이 내 아래에 있는 키워드', inverse: '이 키워드에서 내 아래에 있는 매장',
                family: 'competition', from: ['rival'], to: KEYWORD_TYPES,
            },
            sharesTerm: {
                name: '같은 낱말을 쓰는 매장', label: '키워드에 같은 낱말을 씀', forward: '이 매장과 낱말이 겹치는 추천 키워드', inverse: '같은 낱말을 키워드에 쓰는 매장',
                family: 'competition', from: ['rival'], to: ['recoKeyword'],
            },
            lagsOn: {
                name: '뒤처진 숫자', label: '검색 상위권보다 뒤처진 숫자', forward: '이 키워드에서 상위권보다 뒤처진 숫자', inverse: '이 숫자가 상위권보다 뒤처진 키워드',
                family: 'competition', from: KEYWORD_TYPES, to: ['reviewMetric'],
            },
            // 할 일
            targets: {
                name: '고칠 것', label: '이 할 일로 고침', forward: '이 할 일로 고칠 것', inverse: '이것을 고치는 할 일',
                family: 'action', from: ['task'], to: ['concept', 'keyword', 'activityMetric', 'opsItem', 'aiFactor', 'aiQuestion'],
            },
            suggests: {
                name: '써 볼 만한 것', label: '써 보라고 권함', forward: '이 할 일에서 써 보라고 권하는 것', inverse: '이것을 써 보라고 권하는 할 일',
                family: 'action', from: ['task'], to: ['recoKeyword', 'blogTerm'],
            },
            alternativeTo: {
                name: '바꿔 쓸 키워드', label: '대신 써 볼 만함', forward: '이 키워드로 바꿔 볼 대표키워드', inverse: '대신 써 볼 키워드',
                family: 'action', from: ['recoKeyword', 'queryKeyword'], to: ['keyword'],
            },
            // 정보가 비어 있어 그 질문에 답하지 못하는 경우. 채우면 'AI 질문의 답'(answers)이 됩니다.
            missingFor: {
                name: '채워야 할 정보', label: '비어 있어 답하지 못함', forward: '이것이 비어 있어 답하지 못하는 질문', inverse: '채워야 답할 수 있는 정보',
                family: 'action', from: ['concept', 'reviewMetric', 'activityMetric', 'opsItem'], to: ['aiQuestion'],
            },
            // 추천 이유·손님 말
            supports: {
                name: '추천 이유', label: '추천 이유가 됨', forward: '이것을 이유로 추천한 키워드', inverse: '이 키워드를 추천한 이유', family: 'evidence',
                from: ['keyword', 'strength', 'reviewTopic', 'reviewMenu', 'blogTerm', 'briefing', 'popularMenu', 'timeSlot', 'opsItem', 'facility', 'menu', 'style', 'activityMetric'],
                to: ['recoKeyword'],
            },
            spokenIn: {
                name: '키워드 속 손님 말', label: '이 키워드에 들어 있음', forward: '이 낱말이 들어간 키워드', inverse: '이 키워드에 들어 있는 블로그 낱말',
                family: 'evidence', from: ['blogTerm'], to: KEYWORD_TYPES,
            },
            mentions: {
                name: 'AI 브리핑에 나온 것', label: '문장에서 말함', forward: '이 문장에 나온 것', inverse: '이것을 말한 AI 브리핑 문장',
                family: 'evidence', from: ['briefing'], to: ['reviewMenu', 'reviewTopic', 'popularMenu'],
            },
            // 키워드 등록·지역
            registers: {
                name: '대표키워드 등록', label: '대표키워드로 등록함', forward: '등록한 대표키워드', inverse: '이 키워드를 등록한 매장',
                family: 'registration', from: ['store', 'rival'], to: [...KEYWORD_TYPES, 'rivalKeyword'],
            },
            usesRegion: {
                name: '키워드 속 지역 이름', label: '이 지역 이름을 씀', forward: '이 키워드에 들어 있는 지역 이름', inverse: '이 지역 이름을 쓴 키워드',
                family: 'registration', from: KEYWORD_TYPES, to: ['region'],
            },
            readFrom: {
                name: '역 이름에서 딴 지역', label: '역 이름에서 따옴', forward: '이 지역 이름을 따온 역', inverse: '이 역에서 따온 지역 이름',
                family: 'registration', from: ['region'], to: ['opsItem'],
            },
            // 같은 것끼리
            sameItem: {
                name: `같은 ${item}`, label: '이름이 같음', forward: `이름이 같은 ${item}`, inverse: `이름이 같은 ${item}`, family: 'same', symmetric: true,
                from: ['reviewMenu', 'popularMenu', 'style'], to: ['popularMenu', 'menu', 'style'],
            },
            namedIn: {
                name: `이름이 겹치는 ${item}`, label: '이름에 들어 있음', forward: `이 이름이 들어간 ${item}`, inverse: `이 이름에 들어 있는 ${item}`,
                family: 'same', from: MENU_TYPES, to: MENU_TYPES,
            },
            atTime: {
                name: '같은 시간대 결제', label: '같은 시간대', forward: '이 키워드와 같은 시간대의 결제', inverse: '이 시간대가 들어간 키워드',
                family: 'same', from: KEYWORD_TYPES, to: ['timeSlot'],
            },
            // AI 검색 준비
            feeds: {
                name: 'AI가 참고하는 정보', label: 'AI 점검에 들어감', forward: '이 정보가 들어가는 AI 점검', inverse: '이 점검에 들어가는 정보', family: 'ai',
                from: ['concept', ...KEYWORD_TYPES, 'reviewMetric', 'activityMetric', 'payMetric', 'opsItem'], to: ['aiFactor', 'aiScore'],
            },
            answers: {
                name: 'AI 질문의 답', label: '질문의 답이 됨', forward: '이 정보로 답할 수 있는 질문', inverse: '이 질문의 답이 되는 정보',
                family: 'ai', from: ['concept', 'reviewMetric', 'activityMetric', 'payMetric', 'opsItem'], to: ['aiQuestion'],
            },
            weakens: {
                name: '점수를 낮추는 항목', label: 'AI 준비 점수를 낮춤', forward: '이 항목 때문에 점수가 낮아진 AI', inverse: '이 AI에서 점수가 낮은 항목',
                family: 'ai', from: ['concept', 'aiFactor'], to: ['aiPlatform'],
            },
            // 구조(숨김): 트리 연결 전부. 자식 → 부모
            partOf: {
                name: '묶음', label: '여기에 속함', forward: '속한 곳', inverse: '여기에 든 것', family: 'structure', quiet: true,
                from: ['concept', ...KEYWORD_TYPES, 'region', 'rival', 'rivalKeyword', 'reviewMetric', 'activityMetric', 'strength', 'reviewTopic', 'reviewMenu', 'blogTerm', 'briefing',
                    'payMetric', 'timeSlot', 'popularMenu', 'task', 'opsItem', 'facility', 'menu', 'style', 'aiScore', 'aiFactor', 'aiQuestion', 'aiPlatform'],
                to: ['store', 'concept', 'payMetric', 'aiScore'],
            },
        },
    });
}

const ITEM_WORDS = { restaurant: '메뉴', cafe: '메뉴', bar: '메뉴', hair: '시술', nail: '시술', skin: '시술' };
const DEFAULT_ITEM = '메뉴·서비스';
const ONTOLOGIES = new Map();

// 업종에 맞는 낱말: 음식점·카페·술집은 '메뉴', 미용·네일·피부관리는 '시술', 그 밖(또는 매장을 모를 때)은 '메뉴·서비스'
export function itemWord(place) {
    return (place && ITEM_WORDS[familyOf(place)?.key]) || DEFAULT_ITEM;
}

// 업종에 맞는 낱말로 바꾼 온톨로지. 종류·관계의 키와 구조는 ONTOLOGY 와 같고 화면에 나오는 말만 다릅니다.
// 같은 낱말이면 같은 객체를 돌려줍니다(화면이 다시 그릴 때 비교하기 쉽게).
export function ontologyFor(place) {
    const item = itemWord(place);
    if (!ONTOLOGIES.has(item)) ONTOLOGIES.set(item, makeOntology(item));
    return ONTOLOGIES.get(item);
}

export const ONTOLOGY = ontologyFor(null);

// 묶음별 상한. 모두 채워도 전체가 total 을 넘지 않게 잡았고, 그래도 넘으면 가장 덜 중요한 끝 점부터 뺍니다.
export const GRAPH_LIMITS = Object.freeze({
    total: 220,
    keywords: 24, // 순위 조회 + 등록 + 추천 키워드를 합친 수
    reco: 12,
    regions: 5,
    rivals: 24,
    rivalKeywords: 10,
    rankLinks: 100, // 키워드 ↔ 경쟁 매장(내 위·내 아래) 연결 수
    gapKeywords: 6,
    votes: 8,
    themes: 6,
    reviewMenus: 8,
    mentions: 8,
    briefing: 3,
    posMenus: 5,
    todo: 8,
    conveniences: 8,
    seats: 4,
    menus: 6,
    recoMenus: 4, // 추천 이유로 적힌 둘째 이후 메뉴를 menus 상한 밖에 더하는 점 수
    styles: 6,
});

const REGISTERED_SHOWN = 5;

/* ───────── 표시 도우미(본문과 그래프가 같은 글자를 쓰도록 한곳에 둡니다) ───────── */

export function formatNumber(value) {
    return value === null || value === undefined ? '-' : Number(value).toLocaleString('ko-KR');
}

export function agoLabel(isoDate, nowMs = Date.now()) {
    const days = daysAgo(isoDate, nowMs);
    if (days === null) return '-';
    if (days <= 0) return '오늘';
    if (days === 1) return '어제';
    return `${formatNumber(days)}일 전`;
}

export function won(value) {
    return value ? `${formatNumber(value)}원` : '-';
}

export function shorten(text, max) {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// 점 이름(label)을 줄입니다. 조금 넘치는 것(slack 자까지)은 그대로 두고, 괄호 속 덧말을 먼저 빼 본 뒤 낱말 단위로 자릅니다.
// 전체 이름(full)과 설명(detail)은 줄이지 않습니다.
export function shortenLabel(text, max, slack = 3) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= max + slack) return value;
    const bare = value.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (bare && bare.length <= max + slack) return bare;
    const base = bare || value;
    let out = '';
    for (const word of base.split(' ')) {
        const next = out ? `${out} ${word}` : word;
        if (next.length > max) break;
        out = next;
    }
    return `${out || base.slice(0, max)}…`;
}

// 살펴보기 카드의 버튼 문구: 눌렀을 때 가는 본문 자리의 이름
const GO_LABEL = {
    'sec-rank': '키워드 순위 보기', 'kw-reco': '추천 키워드 보기', 'sec-reviews': '리뷰 보기', 'sec-activity': '활동 보기',
    'sec-pos': '결제 데이터 보기', 'sec-todo': '할 일 보기', 'sec-ops': '운영 정보 보기', 'sec-geo': 'AI 검색 보기',
};

function goFor(target) {
    if (!target || target === 'sec-summary') return null;
    return GO_LABEL[target] || (String(target).startsWith('rank-row-') ? '순위 표 보기' : '이 항목 보기');
}

export function rankLabel(result) {
    if (result.status === 'found') return `${result.rank}위`;
    if (result.status === 'not_listed') return '목록에 없음';
    return `${formatNumber(result.scanned)}위 밖`;
}

// 10위 안은 초록, 50위 안은 검정, 그 밖은 주황, 못 찾으면 빨강
export function rankTone(result) {
    if (result.status !== 'found') return 'bad';
    if (result.rank <= 10) return 'good';
    return result.rank <= 50 ? 'ink' : 'warn';
}

// 최근 표본을 꽉 채웠고 전체가 더 많으면 "n개 이상"으로 보여 줍니다.
export function sampleSuffix(count, sampled, total) {
    return count > 0 && count === sampled && total > sampled ? '개 이상' : '개';
}

/* ───────── 작은 도우미 ───────── */

function compact(text) {
    return String(text ?? '').replace(/\s+/g, '').toLowerCase();
}

function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

// 개수를 로그 눈금으로 0~1 에 놓습니다(가장 큰 값이 1).
function logShare(count, max) {
    if (!(count > 0) || !(max > 0)) return 0;
    return Math.min(1, Math.log1p(count) / Math.log1p(max));
}

function isKnown(value) {
    return value !== null && value !== undefined;
}

// 조사: p('약국', '을', '를') → '을'. 이름 끝의 괄호·기호("큰사랑약국 [공공심야약국]")는 빼고 마지막 글자로 고릅니다.
function p(word, withBatchim, withoutBatchim) {
    if (withBatchim === withoutBatchim) return withBatchim;
    const text = String(word ?? '').trim().replace(/[^가-힣0-9a-zA-Z]+$/, '');
    return josa(text, withBatchim, withoutBatchim).slice(text.length);
}

// 따옴표로 묶은 낱말 + 조사: q('약국', '을', '를') → "'약국'을"
function q(word, withBatchim, withoutBatchim) {
    return `'${word}'${withBatchim ? p(word, withBatchim, withoutBatchim) : ''}`;
}

function facts(...entries) {
    return entries
        .filter((entry) => entry && isKnown(entry.value) && entry.value !== '')
        .slice(0, 4)
        .map((entry) => (entry.tone ? { label: entry.label, value: String(entry.value), tone: entry.tone } : { label: entry.label, value: String(entry.value) }));
}

function scoreTone(score) {
    if (!isKnown(score)) return 'muted';
    if (score >= 70) return 'good';
    return score >= 50 ? 'warn' : 'bad';
}

/* ───────── 점 하나의 글자 역할 ─────────
 * label   이름(값을 넣지 않습니다. 줄여 쓴 이름이면 full 에 전체 이름)
 * sub     핵심 값 하나(카드의 큰 값, 캔버스에서 이름 옆에 붙는 값)
 * facts   sub 에 없는 다른 수치들(최대 4개)
 * detail  sub·facts 에 없는 맥락 한 문장(무엇을 뜻하는지, 무엇을 기준으로 센 것인지)
 * 같은 수치를 두 곳에 적지 않습니다(tests/place-graph.test.mjs 가 견본 3종의 모든 점을 검사합니다). */

// 글 속의 수량들('323개', '40%'): 숫자와 바로 뒤의 단위 한 글자
function amountsOf(text) {
    return [...String(text ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)([가-힣%]?)/g)].map((match) => `${match[1].replace(/,/g, '')}${match[2]}`);
}

// ' · ' 로 나뉜 근거 문장에서, 핵심 값(sub)만 다시 적은 마디를 뺍니다("… · 점유율 48점"의 끝 마디).
function withoutRestated(text, value) {
    const said = amountsOf(value);
    const whole = String(text ?? '').trim();
    if (!said.length || !whole) return whole || undefined;
    const kept = whole.split(' · ').filter((part) => {
        const found = amountsOf(part);
        return !(found.length > 0 && found.every((amount) => said.includes(amount)));
    });
    return kept.join(' · ') || undefined;
}

/* ───────── 그래프 그릇: 점·연결을 모으며 규칙(고유 id, 부모 단계, 온톨로지의 종류·정의역·치역, 중복 없는 트리플)을 지킵니다 ───────── */

// audit: 배열을 넘기면 온톨로지에 맞지 않아 버린 점·연결을 거기에 적습니다(테스트·점검용. 정상이라면 비어 있어야 합니다).
function createGraph(audit = null) {
    const nodes = [];
    const links = [];
    const byId = new Map();
    const triples = new Map();
    const linkIds = new Set();
    const tripleKey = (source, rel, target) => `${source}\u0000${rel}\u0000${target}`;
    const linkId = (base) => {
        let id = base;
        for (let n = 2; linkIds.has(id); n += 1) id = `${base}#${n}`;
        linkIds.add(id);
        return id;
    };
    const reject = (reason, detail) => {
        if (audit) audit.push({ reason, ...detail });
        return null;
    };

    // 같은 id 는 한 번만 넣습니다. 부모가 없는 점은 만들지 않습니다(부모를 따라 'store' 에 닿아야 하므로).
    // 부모로 가는 연결은 항상 (자식) —소속→ (부모) 입니다.
    function add(node, parent = null) {
        if (!node || !node.id || byId.has(node.id)) return null;
        if (!ONTOLOGY.classes[node.type]) return reject('unknown-type', { id: node.id, type: node.type });
        const parentNode = parent ? byId.get(parent) : null;
        if (parent && !parentNode) return null;
        if (!parent && nodes.length > 0) return null;
        const partOf = ONTOLOGY.relations.partOf;
        if (parentNode && !(partOf.from.includes(node.type) && partOf.to.includes(parentNode.type))) {
            return reject('partOf', { id: node.id, type: node.type, parent, parentType: parentNode.type });
        }
        const full = { ...node };
        // 버튼 문구는 도착지 이름, 읽어 주는 말은 "… 살펴보기"(점을 누르면 카드가 열리므로)
        if (node.go === undefined) full.go = goFor(node.target);
        full.aria = `${node.full || node.label}${node.sub ? `, ${node.sub}` : ''} 살펴보기`;
        full.level = parentNode ? parentNode.level + 1 : 0;
        full.group = node.group || parentNode?.group || 'store';
        full.parent = parent || null;
        full.weight = clamp01(node.weight ?? 0.5);
        if (Array.isArray(full.facts) && full.facts.length === 0) delete full.facts;
        for (const key of Object.keys(full)) if (full[key] === undefined) delete full[key];
        nodes.push(full);
        byId.set(full.id, full);
        if (parent) {
            const link = { id: linkId(`${full.id}>${parent}`), source: full.id, target: parent, kind: 'tree', rel: 'partOf', strength: clamp01(0.35 + 0.65 * full.weight) };
            links.push(link);
            triples.set(tripleKey(full.id, 'partOf', parent), link);
        }
        return full;
    }

    // (주어 source) —rel→ (목적어 target). 두 점이 모두 있고 why 가 있을 때만 잇습니다.
    // 점이 없으면(그 데이터가 없는 매장) 조용히 넘어가고, 종류가 관계의 정의역·치역에 맞지 않으면 버리고 audit 에 적습니다.
    // 같은 (주어·관계·목적어)를 다시 이으려 하면 이유만 덧붙입니다(merge: false 면 그대로 둠).
    function relate(source, rel, target, why, strength = 0.5, { merge = true, badge = null, rank = null } = {}) {
        if (!source || !target || source === target || !why) return null;
        const from = byId.get(source);
        const to = byId.get(target);
        if (!from || !to) return null;
        const relation = ONTOLOGY.relations[rel];
        if (!relation || rel === 'partOf') return reject('unknown-rel', { rel, source, target });
        if (!relation.from.includes(from.type) || !relation.to.includes(to.type)) {
            return reject('domain-range', { rel, source, target, sourceType: from.type, targetType: to.type });
        }
        const found = triples.get(tripleKey(source, rel, target)) || (relation.symmetric ? triples.get(tripleKey(target, rel, source)) : null);
        if (found) {
            if (!merge) return null;
            if (!found.why.includes(why)) found.why = `${found.why} ${why}`;
            found.strength = Math.max(found.strength, clamp01(strength));
            if (badge && !found.badge) found.badge = String(badge);
            return found;
        }
        const link = { id: linkId(`${source}~${rel}~${target}`), source, target, kind: 'cross', rel, strength: clamp01(strength), why };
        if (badge) link.badge = String(badge);
        if (Number.isFinite(rank)) link.rank = rank;
        links.push(link);
        triples.set(tripleKey(source, rel, target), link);
        return link;
    }

    const has = (id) => byId.has(id);
    const related = (source, rel, target) => triples.has(tripleKey(source, rel, target));

    // 전체 상한을 넘으면 가장 깊고 덜 중요한 끝 점부터 뺍니다(매장과 범주는 남김).
    function trim(total) {
        while (nodes.length > total) {
            const parents = new Set(nodes.map((node) => node.parent));
            let worst = -1;
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const node = nodes[i];
                if (node.level < 2 || parents.has(node.id)) continue;
                if (worst < 0 || node.level > nodes[worst].level || (node.level === nodes[worst].level && node.weight < nodes[worst].weight)) worst = i;
            }
            if (worst < 0) break;
            const [gone] = nodes.splice(worst, 1);
            byId.delete(gone.id);
            for (let i = links.length - 1; i >= 0; i -= 1) {
                if (links[i].source === gone.id || links[i].target === gone.id) {
                    triples.delete(tripleKey(links[i].source, links[i].rel, links[i].target));
                    links.splice(i, 1);
                }
            }
        }
    }

    return { nodes, links, byId, add, relate, related, has, trim };
}

/* ───────── 검색: 등록·순위 조회·추천 키워드와 지역 낱말 ───────── */

const ACTION_TONE = { high: 'bad', mid: 'warn', low: 'ink' };
const ACTION_WEIGHT = { high: 1, mid: 0.65, low: 0.4 };
const ACTION_LEVEL = { high: '먼저', mid: '권장', low: '참고' };

// 키워드 점 아래에 순위를 함께 적습니다(순위마다 점을 따로 두면 라벨이 겹쳐서 한 점으로 합침).
// 순위는 sub 에만 적고(검색된 매장 수는 facts), 설명에는 그 순위가 무엇을 뜻하는지만 적습니다.
// sub 는 다른 점의 카드에서 조각 값으로도 나오므로(지역 이름·할 일·시간대 카드) 내 순위임을 적습니다("내 3위").
// 같은 그래프에 경쟁 매장의 순위("이 매장 1위")도 있어, 주인이 없는 "3위"는 누구 것인지 알 수 없습니다.
function rankBadge(row) {
    if (!row) return { detail: '아직 순위를 조회하지 않았습니다.' };
    if (row.state === 'loading') return { sub: '조회 중', subTone: 'pending', tone: 'pending', detail: '순위를 조회하고 있습니다.' };
    if (row.state === 'error' || !row.result) return { sub: '조회 실패', subTone: 'muted', tone: 'muted', detail: row.error || '순위를 조회하지 못했습니다.' };
    const tone = rankTone(row.result);
    const meaning = row.result.status === 'found'
        ? '네이버 플레이스에서 이 키워드를 검색했을 때 내 매장이 나온 순서입니다.'
        : row.result.status === 'beyond'
            ? '네이버 플레이스 검색 결과를 살펴본 범위 안에서 내 매장을 찾지 못했습니다.'
            : '네이버 플레이스에서 이 키워드를 검색한 결과 목록에 내 매장이 나오지 않았습니다.';
    const mine = myRankText(row.result);
    return { sub: mine ? `내 ${mine}` : '목록에 내 매장 없음', subTone: tone, tone, detail: meaning };
}

function isDone(row) {
    return Boolean(row && row.state === 'done' && row.result);
}

// 순위가 높을수록 1 에 가깝습니다(로그 눈금): 1위는 1, 살펴본 범위 끝이면 0.
function rankReach(result) {
    if (result.status !== 'found') return 0;
    const span = Math.max(100, result.scanned || 0, result.rank);
    return Math.max(0, 1 - Math.log10(Math.max(1, result.rank)) / Math.log10(span));
}

// 키워드에 들어 있는 지역 낱말(가장 긴 것). "강남구청횟집"은 "강남"이 아니라 "강남구청"으로 봅니다.
function matchRegion(keyword, regions) {
    const text = compact(keyword);
    let best = null;
    for (const region of regions) {
        for (const variant of list(region.variants).length ? region.variants : [compact(region.term)]) {
            if (variant && text.includes(variant) && (!best || variant.length > best.variant.length)) best = { region, variant };
        }
    }
    return best ? best.region : null;
}

// 단위를 붙여 적습니다('52개 중 12개'). '12/52'처럼 단위 없이 적으면 순위 '12위'와 같은 값으로 읽힐 수 있습니다.
function blogText(count, total) {
    if (!isKnown(count)) return null;
    return total ? `${formatNumber(total)}개 중 ${formatNumber(count)}개` : `${formatNumber(count)}개`;
}

function buildSearch(ctx) {
    const { g, place, rows, recommendation, cap } = ctx;
    const registered = Array.isArray(place.keywords) ? place.keywords.map((word) => String(word).trim()).filter(Boolean) : [];
    const mine = new Set(registered.map(compact));
    const regByKey = new Map(list(recommendation?.registered).map((entry) => [compact(entry.keyword), entry]));
    const items = list(recommendation?.items);
    const itemByKey = new Map(items.map((item) => [compact(item.keyword), item]));
    const regions = list(recommendation?.regions).filter((region) => region.term);
    const blogTotal = recommendation?.blogTotal ?? ctx.activity?.mentions?.blogTotal ?? null;

    const entries = [];
    const seen = new Set();
    const push = (word, extra) => {
        const key = compact(word);
        if (!key || seen.has(key) || entries.length >= cap.keywords) return;
        seen.add(key);
        entries.push({
            word, key, id: `kw:${word}`, row: null, index: -1,
            registered: mine.has(key), reg: regByKey.get(key) || null, item: itemByKey.get(key) || null, ...extra,
        });
    };
    rows.forEach((row, index) => push(row.keyword, { row, index }));
    registered.slice(0, REGISTERED_SHOWN).forEach((word) => push(word, {}));
    let recoShown = 0;
    for (const item of items) {
        if (recoShown >= cap.reco) break;
        const before = entries.length;
        push(item.keyword, {});
        if (entries.length > before) recoShown += 1;
    }

    const doneRows = rows.filter(isDone);
    const top10 = doneRows.filter((row) => row.result.status === 'found' && row.result.rank <= 10).length;
    // 키워드가 하나도 없으면(등록 0개 또는 읽지 못함) 없는 것을 점으로 만들지 않고 묶음 점에 그 사실을 적습니다.
    const empty = entries.length === 0;
    const unread = !Array.isArray(place.keywords);
    g.add({
        id: 'hub:search', group: 'search', type: 'concept', label: '키워드 순위', target: 'sec-rank', weight: 1,
        tone: empty ? (unread ? 'muted' : 'bad') : undefined,
        sub: empty ? (unread ? '키워드 확인 불가' : '대표키워드 없음') : undefined, subTone: empty ? (unread ? 'muted' : 'bad') : undefined,
        detail: empty
            ? (unread ? '대표키워드를 읽지 못했습니다' : '등록한 대표키워드가 없습니다. 스마트플레이스에서 5개까지 등록할 수 있습니다')
            : '내 매장의 대표키워드와 추천 키워드입니다. 키워드마다 네이버 플레이스 검색에서 몇 번째로 나오는지 봅니다.',
        facts: facts(
            // 하나도 없을 때는 위의 sub('대표키워드 없음')가 같은 말을 하므로 적지 않습니다
            Array.isArray(place.keywords) && !empty ? { label: '대표키워드', value: `${registered.length}/5개` } : null,
            rows.length ? { label: '순위 조회', value: `${rows.length}개` } : null,
            doneRows.length ? { label: '내 순위 10위 안', value: `${top10}개`, tone: top10 > 0 ? 'good' : undefined } : null,
            items.length ? { label: '추천 키워드', value: `${items.length}개` } : null,
        ),
    }, 'store');

    const maxScore = Math.max(1, ...items.map((item) => (Number.isFinite(item.score) ? item.score : 0)));
    for (const entry of entries) {
        const { word, row, reg, item } = entry;
        const reco = !entry.registered && Boolean(item);
        const badge = rankBadge(row);
        const blog = reg?.blog ?? item?.blog ?? null;
        // 내가 등록한 것은 대표키워드, 추천 목록에 있는 것은 추천 키워드, 둘 다 아닌데 순위만 본 것은 조회한 키워드
        entry.type = entry.registered ? 'keyword' : reco ? 'recoKeyword' : 'queryKeyword';
        const node = {
            id: entry.id, group: 'search', type: entry.type, label: shortenLabel(word, 10), full: word, ...badge,
            target: row ? `rank-row-${entry.index}` : 'sec-rank', keyword: word,
        };
        if (!row && reco) {
            // 추천 이유와 그 수치는 이 키워드로 들어오는 연결('이 키워드를 추천한 이유')과 facts 에 있으므로 여기서 되풀이하지 않습니다.
            Object.assign(node, {
                sub: '추천', subTone: 'muted', target: 'kw-reco',
                detail: item.registrable === false
                    ? '손님이 흔히 쓰는 검색어라 순위만 확인해 보라고 권하는 조합입니다(대표키워드로 등록할 낱말은 아님). 아직 순위를 조회하지 않았습니다.'
                    : '주소·업종·리뷰에서 뽑아 만든 추천 조합입니다. 아직 등록하지 않았고 순위도 조회하지 않았습니다.',
            });
        } else if (!row && reg && reg.hasRegion === false) {
            Object.assign(node, { sub: '지역 이름 없음', subTone: 'warn', detail: '지역 이름이 없어 검색하는 위치마다 순위가 달라집니다. 아직 순위를 조회하지 않았습니다.' });
        }

        if (isDone(row)) node.weight = row.result.status === 'found' ? 0.35 + 0.65 * rankReach(row.result) : 0.25;
        else if (row) node.weight = 0.4;
        else if (entry.registered) node.weight = 0.55;
        else node.weight = 0.25 + 0.4 * ((Number.isFinite(item?.score) ? Math.max(0, item.score) : 0) / maxScore);

        const numeric = list(item?.reasons).find((reason) => reason.kind === 'review' || reason.kind === 'booking');
        // "이 키워드를 등록한 매장" 수는 연결을 다 만든 뒤 finishGraph 가 실제 연결 수로 사이에 끼웁니다.
        // 검색 순위는 sub 에 있으므로 facts 에는 넣지 않습니다.
        entry.factHead = [
            isDone(row) && row.result.total ? { label: '검색된 매장', value: `${formatNumber(row.result.total)}곳` } : null,
            isKnown(blog) ? { label: '블로그 후기 언급', value: blogText(blog, blogTotal) } : null,
        ];
        entry.factTail = [
            numeric ? { label: numeric.kind === 'review' ? '리뷰 언급' : '예약', value: numeric.text.replace(/^(리뷰|예약)\s*/, '') } : null,
            entry.registered ? { label: '등록 상태', value: '대표키워드로 등록함' } : reco ? { label: '등록 상태', value: item.registrable === false ? '순위 확인용' : '추천(미등록)' } : null,
        ];
        node.facts = facts(...entry.factHead, ...entry.factTail);
        g.add(node, 'hub:search');
        // 추천 키워드는 조합에 쓴 지역을 그대로 따릅니다("강남미용실"의 "강남"은 역이 아니라 구).
        entry.region = (reco && regions.find((region) => region.term === item.region)) || matchRegion(word, regions);
    }
    ctx.keywords = entries.filter((entry) => g.has(entry.id));
    ctx.kwByKey = new Map(ctx.keywords.map((entry) => [entry.key, entry]));

    // 지역 이름: 여러 키워드를 묶는 작은 점
    ctx.regions = [];
    for (const region of regions.slice(0, cap.regions)) {
        const using = ctx.keywords.filter((entry) => entry.region === region);
        const id = `region:${region.term}`;
        const added = g.add({
            id, group: 'search', type: 'region', label: shortenLabel(region.term, 10), full: `지역 이름 '${region.term}'`, sub: region.label || undefined, subTone: 'muted',
            detail: '키워드 앞에 붙여 "지역 + 업종" 조합을 만드는 지역 이름입니다. 매장 주소·가까운 역·등록한 키워드에서 읽었습니다.',
            target: 'kw-reco', weight: 0.25 + 0.5 * logShare(using.length, Math.max(1, ctx.keywords.length)),
            facts: facts(
                { label: '등록 키워드에 쓴 횟수', value: `${region.used || 0}개` },
                { label: '이 지역 이름을 쓴 키워드', value: `${using.length}개` },
            ),
        }, 'hub:search');
        if (added) ctx.regions.push({ id, region, using });
    }
}

/* ───────── 경쟁 매장: 순위 결과의 상위 10곳에 나온 매장과 그 매장들이 등록한 대표키워드 ───────── */

// 그 키워드에서 내 매장보다 위인지. 내 매장이 살펴본 범위 밖이거나 목록에 없으면, 상위에 나온 매장은 모두 내 매장보다 앞입니다.
function isAbove(result, rank) {
    return result.status !== 'found' || rank < result.rank;
}

function collectRivals(ctx) {
    const { place, rows, rivalPool, rivals } = ctx;
    const myId = String(place.placeId ?? '');
    const map = new Map();
    const entryOf = (placeId, name) => {
        const id = String(placeId ?? '').trim();
        if (!id || id === myId) return null;
        if (!map.has(id)) map.set(id, { placeId: id, name: String(name || '').trim(), hits: [], keywords: null, order: map.size });
        return map.get(id);
    };
    rows.forEach((row, index) => {
        if (!isDone(row)) return;
        for (const top of list(row.result.top)) {
            if (top.isTarget) continue;
            const entry = entryOf(top.placeId, top.name);
            if (!entry || entry.hits.some((hit) => hit.keyword === row.keyword) || !Number.isFinite(top.rank)) continue;
            entry.hits.push({ keyword: row.keyword, rank: top.rank, index, above: isAbove(row.result, top.rank) });
            if (!entry.name) entry.name = String(top.name || '').trim();
            for (const key of ['category', 'area', 'visitorReviews', 'blogReviews', 'score']) {
                if (!isKnown(entry[key]) && isKnown(top[key]) && top[key] !== '') entry[key] = top[key];
            }
        }
    });
    // 경쟁 매장이 등록한 대표키워드(이 매장에서 읽어 둔 모음 + 키워드 줄마다 읽은 것)
    const pooled = [...list(rivalPool), ...Object.values(rivals && typeof rivals === 'object' ? rivals : {}).flatMap((entry) => list(entry?.items))];
    for (const rival of pooled) {
        const entry = entryOf(rival.placeId, rival.name);
        if (!entry || entry.keywords) continue;
        if (!entry.name) entry.name = String(rival.name || '').trim();
        const seen = new Set();
        entry.keywords = list(rival.keywords).map((word) => String(word).trim()).filter((word) => {
            const key = compact(word);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    return [...map.values()].filter((entry) => entry.name);
}

const byRank = (a, b) => a.rank - b.rank || a.index - b.index;
const aboveCount = (entry) => entry.hits.filter((hit) => hit.above).length;
const bestRank = (entry) => (entry.hits.length ? Math.min(...entry.hits.map((hit) => hit.rank)) : Infinity);
const byThreat = (a, b) => aboveCount(b) - aboveCount(a) || bestRank(a) - bestRank(b) || a.order - b.order;

// 그래프에 넣을 경쟁 매장을 고릅니다(상한 limit).
//  ① 가장 많은 키워드에서 내 위에 있는 두 곳 ② 키워드마다 1위부터 차례로, 내 위에 있는 매장 ③ 내 아래에 있는 매장(순위순) ④ 대표키워드만 읽은 매장
// ②를 순위순으로 넣기 때문에 상한에 걸리더라도 키워드마다 "1위부터 몇 위까지"가 빠짐없이 들어갑니다.
function pickRivals(all, limit) {
    const picked = [];
    const take = (entry) => {
        if (picked.length < limit && !picked.includes(entry)) picked.push(entry);
    };
    all.filter((entry) => aboveCount(entry) > 0).sort(byThreat).slice(0, 2).forEach(take);
    const hits = all.flatMap((entry) => entry.hits.map((hit) => ({ entry, hit })));
    const inOrder = (a, b) => byRank(a.hit, b.hit) || a.entry.order - b.entry.order;
    hits.filter(({ hit }) => hit.above).sort(inOrder).forEach(({ entry }) => take(entry));
    hits.filter(({ hit }) => !hit.above).sort(inOrder).forEach(({ entry }) => take(entry));
    all.filter((entry) => entry.hits.length === 0).forEach(take);
    return picked.sort((a, b) => byThreat(a, b));
}

function buildRivals(ctx) {
    const { g, rows, cap } = ctx;
    ctx.rivalNodes = [];
    ctx.rivalKeywords = [];
    const all = collectRivals(ctx);
    if (all.length === 0) return;
    const picked = pickRivals(all, cap.rivals);
    const doneRows = rows.filter(isDone);
    const loading = Object.values(ctx.rivals && typeof ctx.rivals === 'object' ? ctx.rivals : {}).some((entry) => entry?.loading);
    const withKeywords = picked.filter((entry) => entry.keywords).length;
    // 숫자(facts)는 연결을 다 만든 뒤 finishGraph 가 실제 연결 수로 채웁니다(카드의 조각 수와 같게).
    ctx.rivalInfo = { found: all.length, shown: picked.length, withKeywords, ranked: doneRows.length };

    g.add({
        id: 'hub:rival', group: 'rival', type: 'concept', label: '경쟁 매장', target: 'sec-rank', weight: 1,
        sub: loading ? '키워드 읽는 중' : undefined, subTone: loading ? 'pending' : undefined,
        // 매장 수는 facts 에 있으므로(finishGraph), 여기에는 누구를 모은 것인지만 적습니다. 다 보여 주지 못할 때만 보여 주는 수를 덧붙입니다.
        detail: [
            doneRows.length
                ? '순위를 조회한 키워드마다 검색 결과 맨 위 열 곳에 나온 매장을 모았습니다(내 매장 제외).'
                : '대표키워드를 읽어 둔 경쟁 매장입니다.',
            picked.length < all.length ? `많아서 그중 ${formatNumber(picked.length)}곳만 그래프에 보여 줍니다.` : null,
        ].filter(Boolean).join(' '),
    }, 'store');

    for (const entry of picked) {
        const hits = [...entry.hits].sort(byRank);
        const above = hits.filter((hit) => hit.above);
        const best = hits[0] || null;
        const id = `rival:${entry.placeId}`;
        const town = entry.area ? String(entry.area).split(' ').pop() : null;
        const where = [entry.category ? `업종은 ${entry.category}` : null, town ? `지역은 ${town}` : null].filter(Boolean).join(', ');
        const added = g.add({
            id, group: 'rival', type: 'rival', label: shortenLabel(entry.name, 10), full: entry.name,
            sub: above.length ? `키워드 ${above.length}개에서 내 위` : hits.length ? `키워드 ${hits.length}개에서 내 아래` : entry.keywords ? '키워드 읽음' : undefined,
            subTone: above.length ? 'warn' : 'muted',
            // 키워드별 순위는 이 매장에서 나가는 연결(내 위·내 아래)의 값으로 보이므로 여기서 다시 늘어놓지 않습니다.
            detail: [
                where ? `${where}입니다.` : null,
                hits.length ? '순위를 조회한 키워드의 검색 결과 맨 위 열 곳 안에 나온 매장입니다.' : '순위 표에는 없지만 대표키워드를 읽어 둔 경쟁 매장입니다.',
            ].filter(Boolean).join(' '),
            // 누르면 이 매장이 내 위에 있는(없으면 가장 높이 나온) 키워드의 순위 표를 엽니다.
            go: best ? '순위 표 보기' : undefined, target: 'sec-rank', keyword: (above[0] || best)?.keyword,
            weight: 0.25 + 0.45 * (doneRows.length ? above.length / doneRows.length : 0) + 0.3 * (best ? Math.max(0, 1 - (best.rank - 1) / 10) : 0),
            facts: facts(
                isKnown(entry.visitorReviews) ? { label: '방문자 리뷰', value: `${formatNumber(entry.visitorReviews)}개` } : null,
                isKnown(entry.blogReviews) ? { label: '블로그 리뷰', value: `${formatNumber(entry.blogReviews)}개` } : null,
                isKnown(entry.score) && entry.score !== '' ? { label: '평점', value: `${entry.score}점` } : null,
                // 등록한 키워드는 '등록한 대표키워드' 연결로 보입니다. 하나도 등록하지 않은 매장만 그 사실을 적습니다.
                entry.keywords && entry.keywords.length === 0 ? { label: '등록한 대표키워드', value: '없음' } : null,
            ),
        }, 'hub:rival');
        if (added) ctx.rivalNodes.push({ id, entry, hits });
    }

    // 내 키워드와 겹치지 않는, 경쟁 매장만 등록한 대표키워드(여러 곳이 함께 쓴 것부터)
    const others = new Map();
    for (const rival of ctx.rivalNodes) {
        for (const word of list(rival.entry.keywords)) {
            const key = compact(word);
            if (ctx.kwByKey.has(key)) continue;
            if (!others.has(key)) others.set(key, { key, word, rivals: [], order: others.size });
            others.get(key).rivals.push(rival);
        }
    }
    const shown = [...others.values()].sort((a, b) => b.rivals.length - a.rivals.length || a.order - b.order).slice(0, cap.rivalKeywords);
    const most = Math.max(1, ...shown.map((item) => item.rivals.length));
    if (shown.length === 0) return;
    // 이 키워드들은 "경쟁 매장 키워드" 묶음에 두고, 등록한 매장과는 (경쟁 매장) —대표키워드로 등록함→ (키워드) 로 잇습니다.
    g.add({
        id: 'rival-keywords', group: 'rival', type: 'concept', label: '경쟁 매장 키워드', full: '경쟁 매장만 등록한 대표키워드', sub: `${others.size}개`, subTone: 'muted',
        detail: [
            '경쟁 매장은 등록했지만 내 매장은 등록하지 않은 대표키워드입니다.',
            shown.length < others.size ? `여러 곳이 함께 등록한 것부터 ${shown.length}개만 그래프에 보여 줍니다.` : null,
        ].filter(Boolean).join(' '),
        target: 'sec-rank', weight: 0.6,
        facts: facts(
            { label: '대표키워드를 읽은 경쟁 매장', value: `${withKeywords}곳` },
            shown[0].rivals.length >= 2 ? { label: '가장 여러 곳이 등록한 키워드', value: shown[0].word } : null,
        ),
    }, 'hub:rival');
    for (const item of shown) {
        const id = `rk:${item.key}`;
        const added = g.add({
            // 등록한 매장 수는 sub 에만 적습니다(이 점으로 들어오는 '이 키워드를 등록한 매장' 연결 수와 같습니다).
            id, group: 'rival', type: 'rivalKeyword', label: shortenLabel(item.word, 10), full: item.word, sub: `${item.rivals.length}곳 등록`, subTone: 'muted',
            detail: '경쟁 매장만 등록한 대표키워드입니다. 내 매장은 등록하지 않았습니다.',
            target: 'sec-rank', weight: 0.2 + 0.6 * logShare(item.rivals.length, most),
        }, 'rival-keywords');
        if (added) ctx.rivalKeywords.push({ id, item });
    }
}

/* ───────── 리뷰·활동 ───────── */

// 개수가 붙은 목록(좋은 점·주제·메뉴 등): 목록 카드에 해당하는 작은 중심 아래에 낱개를 답니다.
// source(item) 는 출처와 수('리뷰 22회', '블로그 30/52'): 같은 낱말이 여러 목록에 나와도 어디서 센 숫자인지 알 수 있게 sub 에 적습니다.
// 묶음 점: sub 는 목록의 개수, facts 는 가장 많은 것(top), detail 은 무엇을 센 목록인지(hub.detail).
// 낱개 점: 수는 sub 에만, detail 은 그 수가 무엇을 센 것인지(itemDetail). 목록 안의 순서는 묶음 점의 조각 순서로 보입니다.
function addCountList(g, { hub, parent, prefix, type, items, limit, unit, source, itemDetail, topLabel, target }) {
    const shown = items.slice(0, limit);
    const made = new Map();
    if (shown.length === 0) return made;
    const hubFacts = facts({ label: topLabel, value: `${items[0].label} · ${formatNumber(items[0].count)}${unit}` });
    if (!g.add({ type: 'concept', target, weight: 0.7, sub: `${formatNumber(items.length)}개`, subTone: 'muted', facts: hubFacts, ...hub }, parent)) return made;
    const max = Math.max(...shown.map((item) => item.count));
    shown.forEach((item, index) => {
        const id = `${prefix}:${item.label}`;
        const added = g.add({
            id, type, label: shortenLabel(item.label, 9), full: item.label, sub: source(item), subTone: 'muted',
            detail: itemDetail, target, weight: 0.2 + 0.8 * logShare(item.count, max),
        }, hub.id);
        if (added) made.set(compact(item.label), { id, label: item.label, count: item.count, index, badge: source(item).replace(/\/[\d,]+$/, '개') });
    });
    return made;
}

function share(part, whole) {
    if (!isKnown(part) || !whole || part > whole) return null;
    return Math.round((part / whole) * 100);
}

function buildVoice(ctx) {
    const { g, place, activity, cap } = ctx;
    const votes = list(place.reviewVotes);
    const themes = list(place.reviewThemes);
    const menus = list(place.reviewMenus);

    g.add({
        id: 'hub:voice', group: 'voice', type: 'concept', label: '리뷰', target: 'sec-reviews', weight: 1,
        detail: '네이버 플레이스에 쌓인 방문자 리뷰와 블로그·카페 리뷰를 네이버가 집계한 값입니다.',
        facts: facts(
            { label: '방문자 리뷰', value: `${formatNumber(place.visitorReviews)}개` },
            { label: '블로그·카페 리뷰', value: `${formatNumber(place.blogReviews)}개` },
            place.visitorScore ? { label: '평점', value: `${place.visitorScore.toFixed(2)}점` } : null,
            votes.length ? { label: '손님이 고른 좋은 점', value: `${votes.length}개` } : null,
        ),
    }, 'store');

    const reviewMax = Math.max(1, place.visitorReviews || 0, place.blogReviews || 0);
    g.add({
        id: 'rv:visitor', group: 'voice', type: 'reviewMetric', label: '방문자 리뷰', sub: `${formatNumber(place.visitorReviews)}개`,
        detail: '네이버 플레이스 화면에 표시된 방문자 리뷰 수입니다.', target: 'sec-reviews',
        weight: 0.45 + 0.5 * logShare(place.visitorReviews || 0, reviewMax),
        facts: facts(
            place.reviewAuthors ? { label: '작성한 손님', value: `${formatNumber(place.reviewAuthors)}명` } : null,
            isKnown(place.textReviews) ? { label: '글 리뷰', value: `${formatNumber(place.textReviews)}개` } : null,
            isKnown(place.photoReviews) ? { label: '사진 리뷰', value: `${formatNumber(place.photoReviews)}개` } : null,
        ),
    }, 'hub:voice');
    g.add({
        id: 'rv:blog', group: 'voice', type: 'reviewMetric', label: '블로그·카페 리뷰', sub: `${formatNumber(place.blogReviews)}개`,
        detail: '네이버 플레이스 화면에 표시된 블로그·카페 리뷰 수입니다.', target: 'sec-reviews',
        weight: 0.45 + 0.5 * logShare(place.blogReviews || 0, reviewMax),
        facts: facts(
            activity?.blog ? { label: '최근 30일', value: `${formatNumber(activity.blog.last30)}${sampleSuffix(activity.blog.last30, activity.blog.sampled, activity.blog.total)}` } : null,
        ),
    }, 'hub:voice');
    if (place.visitorScore) {
        g.add({
            id: 'rv:score', group: 'voice', type: 'reviewMetric', label: '평점', sub: `${place.visitorScore.toFixed(2)}점`,
            detail: '네이버 플레이스 화면에 표시된 평점입니다(5점 만점).', target: 'sec-reviews', weight: 0.6,
        }, 'hub:voice');
    }
    if (isKnown(place.textReviews)) {
        const pct = share(place.textReviews, place.visitorReviews);
        g.add({
            id: 'rv:text', group: 'voice', type: 'reviewMetric', label: '글 리뷰', sub: `${formatNumber(place.textReviews)}개`,
            detail: '방문자 리뷰 가운데 글을 남긴 리뷰입니다.', target: 'sec-reviews', weight: 0.4,
            facts: facts(pct !== null ? { label: '방문자 리뷰 대비', value: `${pct}%` } : null),
        }, 'hub:voice');
    }
    if (isKnown(place.photoReviews)) {
        const pct = share(place.photoReviews, place.visitorReviews);
        g.add({
            id: 'rv:photo', group: 'voice', type: 'reviewMetric', label: '사진 리뷰', sub: `${formatNumber(place.photoReviews)}개`,
            detail: '방문자 리뷰 가운데 사진을 올린 리뷰입니다.', target: 'sec-reviews', weight: 0.4,
            facts: facts(pct !== null ? { label: '방문자 리뷰 대비', value: `${pct}%` } : null),
        }, 'hub:voice');
    }

    ctx.votes = addCountList(g, {
        hub: { id: 'rv:vote', group: 'voice', label: '손님이 고른 좋은 점', detail: '리뷰를 쓴 손님이 좋았던 점으로 고른 항목 모음입니다.' },
        parent: 'hub:voice', prefix: 'vote', type: 'strength', items: votes, limit: cap.votes, unit: '명', source: (item) => `손님 ${formatNumber(item.count)}명`, target: 'sec-reviews',
        topLabel: '가장 많이 고른 것', itemDetail: '리뷰를 쓴 손님이 좋았던 점으로 고른 항목입니다. 숫자는 고른 손님 수입니다.',
    });
    ctx.themes = addCountList(g, {
        hub: { id: 'rv:theme', group: 'voice', label: '많이 언급된 주제', detail: '네이버가 방문자 리뷰에서 뽑은 주제 모음입니다.' },
        parent: 'hub:voice', prefix: 'theme', type: 'reviewTopic', items: themes, limit: cap.themes, unit: '회', source: (item) => `리뷰 ${formatNumber(item.count)}회`, target: 'sec-reviews',
        topLabel: '가장 많이 나온 주제', itemDetail: '네이버가 방문자 리뷰에서 뽑은 주제입니다. 숫자는 리뷰에서 언급된 횟수입니다.',
    });
    ctx.reviewMenus = addCountList(g, {
        hub: { id: 'rv:menu', group: 'voice', label: `언급된 ${ctx.item}`, full: `많이 언급된 ${ctx.item}`, detail: `네이버가 방문자 리뷰에서 뽑은 ${ctx.item} 모음입니다.` },
        parent: 'hub:voice', prefix: 'rmenu', type: 'reviewMenu', items: menus, limit: cap.reviewMenus, unit: '회', source: (item) => `리뷰 ${formatNumber(item.count)}회`, target: 'sec-reviews',
        topLabel: '가장 많이 나온 것', itemDetail: `네이버가 방문자 리뷰에서 뽑은 ${ctx.item}입니다. 숫자는 리뷰에서 언급된 횟수입니다.`,
    });

    // 블로그 후기에 나온 낱말(한 번도 안 나온 낱말은 점으로 만들지 않습니다)
    const blogTotal = activity?.mentions?.blogTotal ?? null;
    const mentioned = list(activity?.mentions?.terms)
        .filter((entry) => entry.term && Number.isFinite(entry.count) && entry.count > 0)
        .map((entry, index) => ({ label: String(entry.term), count: entry.count, index }))
        .sort((a, b) => b.count - a.count || a.index - b.index);
    ctx.mentions = addCountList(g, {
        hub: { id: 'rv:mention', group: 'voice', label: '블로그에 나온 낱말', full: '블로그 후기에 나온 낱말', detail: '블로그 후기 가운데 업종 낱말과 등록 키워드 낱말이 들어간 글을 센 것입니다.' },
        parent: 'hub:voice', prefix: 'bm', type: 'blogTerm', items: mentioned, limit: cap.mentions, unit: '개', target: 'sec-reviews',
        source: (item) => (blogTotal ? `블로그 ${formatNumber(item.count)}/${formatNumber(blogTotal)}` : `블로그 ${formatNumber(item.count)}개`),
        topLabel: '가장 많이 나온 낱말',
        itemDetail: blogTotal ? '블로그 후기 가운데 이 낱말이 나온 글의 수입니다(나온 글 / 전체 글).' : '블로그 후기 가운데 이 낱말이 나온 글의 수입니다.',
    });

    // 네이버 AI 브리핑 문장
    const briefing = list(activity?.briefing).map((sentence) => String(sentence).trim()).filter(Boolean);
    ctx.briefing = [];
    if (briefing.length > 0) {
        g.add({
            id: 'rv:briefing', group: 'voice', type: 'concept', label: 'AI 브리핑', full: '네이버 AI 브리핑', sub: `${briefing.length}문장`, subTone: 'muted',
            detail: '네이버가 리뷰를 바탕으로 매장 화면에 보여 주는 요약입니다.', target: 'sec-reviews', weight: 0.65,
        }, 'hub:voice');
        briefing.slice(0, cap.briefing).forEach((sentence, index) => {
            const id = `brief:${index}`;
            const added = g.add({
                // 문장 전체는 full 에 있습니다(카드의 제목). 설명에는 이 문장이 어디에 나오는 것인지만 적습니다.
                id, group: 'voice', type: 'briefing', label: shortenLabel(sentence, 12), full: sentence, detail: '네이버가 매장 화면의 AI 브리핑에 보여 주는 문장입니다.', target: 'sec-reviews', weight: 0.5 - index * 0.08,
            }, 'rv:briefing');
            if (added) ctx.briefing.push({ id, sentence });
        });
    }
}

function buildActivity(ctx) {
    const { g, activity, nowMs } = ctx;
    const { visitor, blog, feeds, coupons } = activity || {};
    // 업종 때문에 해당 없는 항목(병의원의 새소식·쿠폰, 약국의 쿠폰)은 경고 색 없이 "해당 없음"으로 보입니다(place-industry.js)
    const industry = notApplicableOf(ctx.place);
    g.add({
        id: 'hub:activity', group: 'voice', type: 'concept', tone: activity ? undefined : 'muted', label: '활동', weight: activity ? 1 : 0.5,
        sub: activity ? undefined : '확인 불가', subTone: activity ? undefined : 'muted',
        detail: activity ? '최근에 새로 달린 리뷰와, 사장님이 한 답글·소식·쿠폰 활동입니다.' : '활동 정보를 불러오지 못했습니다', target: 'sec-activity',
    }, 'store');
    if (visitor && isKnown(visitor.replyRate)) {
        const tone = visitor.replyRate < 10 ? 'bad' : visitor.replyRate < 50 ? 'warn' : 'good';
        g.add({
            id: 'ac:reply', group: 'voice', type: 'activityMetric', tone, label: '답글률', full: '사장님 답글률', sub: `${visitor.replyRate}%`, subTone: tone,
            detail: '최근 방문자 리뷰 가운데 사장님 답글이 달린 리뷰의 비율입니다.', target: 'sec-activity',
            weight: tone === 'bad' ? 0.95 : tone === 'warn' ? 0.8 : 0.6,
            facts: facts({ label: '답글 단 리뷰', value: `${formatNumber(visitor.replied)}개 / 최근 ${formatNumber(visitor.sampled)}개` }),
        }, 'hub:activity');
    }
    if (visitor) {
        g.add({
            id: 'ac:week', group: 'voice', type: 'activityMetric', label: '최근 7일 리뷰', full: '최근 7일 방문자 리뷰',
            sub: `${formatNumber(visitor.last7)}${sampleSuffix(visitor.last7, visitor.sampled, visitor.total)}`,
            detail: '최근 일주일 동안 새로 달린 방문자 리뷰 수입니다.', target: 'sec-activity', weight: 0.6,
            facts: facts(
                isKnown(visitor.last30) ? { label: '최근 30일', value: `${formatNumber(visitor.last30)}${sampleSuffix(visitor.last30, visitor.sampled, visitor.total)}` } : null,
                isKnown(visitor.perDay) ? { label: '하루 평균', value: `약 ${visitor.perDay}개` } : null,
            ),
        }, 'hub:activity');
        if (isKnown(visitor.revisitRate)) {
            g.add({
                id: 'ac:revisit', group: 'voice', type: 'activityMetric', label: '재방문 리뷰', sub: `${visitor.revisitRate}%`,
                detail: '최근 방문자 리뷰 가운데 두 번 이상 방문한 손님이 쓴 리뷰의 비율입니다.', target: 'sec-activity', weight: 0.45,
                facts: facts({ label: '재방문 손님의 리뷰', value: `${formatNumber(visitor.revisits)}개 / 최근 ${formatNumber(visitor.sampled)}개` }),
            }, 'hub:activity');
        }
    }
    if (blog) {
        const quiet = isKnown(blog.total) && blog.last30 === 0;
        g.add({
            id: 'ac:blog', group: 'voice', type: 'activityMetric', tone: quiet ? 'warn' : undefined, label: '최근 30일 블로그', full: '최근 30일 블로그 리뷰',
            sub: `${formatNumber(blog.last30)}${sampleSuffix(blog.last30, blog.sampled, blog.total)}`, subTone: quiet ? 'warn' : undefined,
            detail: '최근 한 달 동안 새로 올라온 블로그 리뷰 수입니다.', target: 'sec-activity', weight: quiet ? 0.75 : 0.5,
            facts: facts(
                blog.latest ? { label: '마지막 글', value: agoLabel(blog.latest, nowMs) } : { label: '마지막 글', value: '없음' },
                isKnown(blog.total) ? { label: '블로그 리뷰 전체', value: `${formatNumber(blog.total)}개` } : null,
            ),
        }, 'hub:activity');
    }
    if (feeds) {
        const notApplicable = industry.feed;
        const stale = !notApplicable && (!feeds.latest || (isKnown(feedDays(feeds, nowMs)) && feedDays(feeds, nowMs) > 30));
        g.add({
            id: 'ac:feed', group: 'voice', type: 'activityMetric', tone: stale ? 'warn' : undefined, label: '마지막 소식',
            sub: notApplicable ? '해당 없음' : feeds.latest ? agoLabel(feeds.latest, nowMs) : '없음', subTone: stale ? 'warn' : undefined,
            detail: notApplicable || (feeds.latest ? '소식 탭에 마지막으로 글을 올린 때입니다.' : '소식 탭에 올린 글이 없습니다.'), target: 'sec-activity',
            weight: stale ? 0.75 : 0.5,
            facts: facts(
                feeds.latest && feeds.latestTitle ? { label: '마지막 소식 제목', value: feeds.latestTitle } : null,
                isKnown(feeds.last30) ? { label: '최근 30일 소식', value: `${formatNumber(feeds.last30)}개` } : null,
                isKnown(feeds.count) ? { label: '읽은 소식', value: `${formatNumber(feeds.count)}개${feeds.hasMore ? ' 이상' : ''}` } : null,
            ),
        }, 'hub:activity');
    }
    if (coupons) {
        const notApplicable = industry.coupon;
        const empty = !notApplicable && coupons.total === 0;
        g.add({
            id: 'ac:coupon', group: 'voice', type: 'activityMetric', tone: empty ? 'warn' : undefined, label: '쿠폰',
            sub: notApplicable ? '해당 없음' : `${formatNumber(coupons.total)}개`, subTone: empty ? 'warn' : undefined,
            detail: notApplicable || '네이버 플레이스에 등록해 둔 쿠폰 수입니다.', target: 'sec-activity', weight: empty ? 0.6 : 0.45,
            facts: facts(list(coupons.memberships).length ? { label: '멤버십', value: coupons.memberships.join(', ') } : null),
        }, 'hub:activity');
    }
}

/* ───────── 결제(POS 가 있는 매장만) ───────── */

const PRICE_SLOTS = [['morning', '아침'], ['lunch', '점심'], ['dinner', '저녁'], ['night', '밤']];
const CHANGE_TEXT = { UP: '순위 오름', DOWN: '순위 내림', NEW: '새로 진입' };

function buildPay(ctx) {
    const { g, place, cap } = ctx;
    const pos = place.detail?.pos;
    ctx.posMenus = new Map();
    ctx.priceSlots = new Map();
    if (!pos) return;
    const price = pos.averagePrice || {};
    const popular = list(pos.popularMenus).filter((menu) => menu.name);
    g.add({ id: 'hub:pos', group: 'pay', type: 'concept', label: '결제 데이터', detail: '네이버페이 결제 단말(POS)의 최근 일주일 집계입니다.', target: 'sec-pos', weight: 1 }, 'store');
    if (isKnown(pos.weeklySales)) {
        g.add({
            id: 'pos:sales', group: 'pay', type: 'payMetric', label: '주간 결제', full: '주간 결제 건수', sub: `${formatNumber(pos.weeklySales)}건`,
            detail: '최근 일주일 동안 결제 단말로 받은 결제 건수입니다.', target: 'sec-pos', weight: 0.85,
        }, 'hub:pos');
    }
    const slots = PRICE_SLOTS.filter(([key]) => price[key]);
    if (price.total) {
        g.add({
            // 시간대별 평균은 이 점 아래에 달린 점들이 가지고 있으므로 여기에 다시 적지 않습니다.
            id: 'pos:price', group: 'pay', type: 'payMetric', label: '1회 평균 결제', sub: won(price.total),
            detail: '최근 일주일 동안 결제 한 번에 평균 얼마를 받았는지입니다.', target: 'sec-pos', weight: 0.8,
        }, 'hub:pos');
    }
    const maxPrice = Math.max(1, ...slots.map(([key]) => price[key]));
    for (const [key, label] of slots) {
        const id = `pos:slot:${key}`;
        const added = g.add({
            id, group: 'pay', type: 'timeSlot', label: `${label} 평균 결제`, full: `${label} 1회 평균 결제`, sub: won(price[key]),
            detail: `${label} 시간대에 결제 한 번에 평균 얼마를 받았는지입니다.`, target: 'sec-pos', weight: 0.25 + 0.5 * (price[key] / maxPrice),
        }, g.has('pos:price') ? 'pos:price' : 'hub:pos');
        if (added) ctx.priceSlots.set(key, { id, label, value: price[key] });
    }
    if (pos.busiestDay) {
        g.add({
            id: 'pos:day', group: 'pay', type: 'payMetric', label: '가장 붐비는 요일', sub: `${pos.busiestDay}요일`,
            detail: '네이버가 최근 일주일 결제 집계로 알려 준, 가장 붐비는 요일입니다.', target: 'sec-pos', weight: 0.7,
        }, 'hub:pos');
    }
    // 요일별 가장 붐비는 시간. 붐빔 값은 네이버가 준 0~100 상대값입니다.
    const weekly = list(pos.weekly).filter((day) => isKnown(day.peakHour));
    const peakOf = (day) => Math.max(0, ...list(day.hours).filter((value) => Number.isFinite(value)));
    const busiest = Math.max(1, ...weekly.map(peakOf));
    for (const day of weekly) {
        g.add({
            id: `pos:peak:${day.key}`, group: 'pay', type: 'timeSlot', label: `${day.day}요일`, full: `${day.day}요일 가장 붐비는 시간`, sub: `${day.peakHour}시`,
            detail: '이 요일에 가장 붐비는 시간입니다. 붐빔은 한 주에서 가장 붐빌 때와 견준 값입니다.', target: 'sec-pos', weight: 0.2 + 0.6 * (peakOf(day) / busiest),
            facts: facts({ label: '붐빔(가장 붐빌 때 대비)', value: `${Math.round((peakOf(day) / busiest) * 100)}%` }),
        }, g.has('pos:day') ? 'pos:day' : 'hub:pos');
    }
    if (popular.length > 0) {
        const top = popular[0];
        g.add({
            id: 'pos:menu', group: 'pay', type: 'concept', label: '주간 인기 메뉴', sub: `${popular.length}개`, subTone: 'muted',
            detail: '최근 일주일 동안 주문이 많았던 메뉴를 많은 순서로 놓은 것입니다.', target: 'sec-pos', weight: 0.75,
            facts: facts({ label: '가장 많이 주문한 메뉴', value: isKnown(top.share) ? `${top.name} · 주문의 ${top.share}%` : top.name }),
        }, 'hub:pos');
        const maxShare = Math.max(1, ...popular.map((menu) => menu.share || 0));
        popular.slice(0, cap.posMenus).forEach((menu, index) => {
            const id = `pmenu:${menu.name}`;
            // 주문 비율을 아는 메뉴는 그것이 핵심 값, 모르면 순위가 핵심 값입니다.
            const shared = isKnown(menu.share);
            const added = g.add({
                id, group: 'pay', type: 'popularMenu', label: shortenLabel(menu.name, 9), full: menu.name, sub: shared ? `주문 ${menu.share}%` : `주간 인기 ${index + 1}위`, subTone: 'muted',
                detail: shared ? '최근 일주일 주문 가운데 이 메뉴가 차지한 비율입니다.' : '최근 일주일 동안 주문이 많았던 메뉴입니다.', target: 'sec-pos',
                weight: shared ? 0.25 + 0.75 * (menu.share / maxShare) : Math.max(0.25, 0.8 - index * 0.12),
                facts: facts(
                    shared ? { label: '주간 인기 순위', value: `${index + 1}위` } : null,
                    CHANGE_TEXT[menu.change] ? { label: '지난주 대비', value: CHANGE_TEXT[menu.change] } : null,
                ),
            }, 'pos:menu');
            if (added) ctx.posMenus.set(compact(menu.name), { id, name: menu.name, share: menu.share, index });
        });
    }
    if (pos.stayMinutes) {
        g.add({
            id: 'pos:stay', group: 'pay', type: 'payMetric', label: '평균 체류 시간', sub: `${formatNumber(pos.stayMinutes)}분`,
            detail: '네이버가 최근 일주일 결제 집계로 알려 준, 손님이 머문 평균 시간입니다.', target: 'sec-pos', weight: 0.5,
        }, 'hub:pos');
    }
}

/* ───────── 할 일 ───────── */

// 제목이 길어 줄이면 뜻이 사라지는 할 일의 점 이름(전체 제목은 full 에 그대로 둡니다)
const TODO_LABEL = { keywordRegion: '키워드에 지역 이름 없음', keywordSpoken: '손님이 쓰는 말로 바꾸기', blog: '새 블로그 리뷰 없음' };

function buildTodo(ctx) {
    const { g, actions, cap } = ctx;
    const high = actions.filter((item) => item.level === 'high').length;
    const shownCount = Math.min(actions.length, cap.todo);
    g.add({
        id: 'hub:todo', group: 'todo', type: 'concept', tone: actions.length ? undefined : 'good', label: '할 일', weight: 1,
        sub: actions.length ? `${actions.length}개` : '없음', subTone: high ? 'bad' : actions.length ? 'warn' : 'good',
        detail: actions.length
            ? ['지금 채우거나 고치면 좋은 항목을 급한 것부터 놓았습니다.', shownCount < actions.length ? `그래프에는 급한 순서로 ${shownCount}개만 보여 줍니다.` : null].filter(Boolean).join(' ')
            : '지금 확인된 빈 항목이 없습니다.',
        target: 'sec-todo',
        facts: actions.length ? facts({ label: '먼저 할 일', value: `${high}개`, tone: high ? 'bad' : undefined }) : undefined,
    }, 'store');
    ctx.todos = [];
    for (const item of actions.slice(0, cap.todo)) {
        if (!item || !item.key) continue;
        const id = `todo:${item.key}`;
        const added = g.add({
            id, group: 'todo', type: 'task', tone: ACTION_TONE[item.level] || 'ink', label: TODO_LABEL[item.key] || shortenLabel(item.title, 10), full: item.title, detail: String(item.detail || '').trim() || undefined, target: 'sec-todo',
            weight: ACTION_WEIGHT[item.level] || 0.4,
            facts: facts({ label: '우선순위', value: ACTION_LEVEL[item.level] || '참고', tone: ACTION_TONE[item.level] }),
        }, 'hub:todo');
        if (added) ctx.todos.push({ id, item });
    }
}

/* ───────── 운영 ───────── */

// 괄호 안 설명과 띄어쓰기를 뺀 메뉴 이름
function menuKey(name) {
    return compact(String(name ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ''));
}

// 두 이름이 같은 메뉴인지. 'exact' 는 이름이 같음, 'part' 는 짧은 쪽이 긴 쪽의 끝말이거나("곰탕" ↔ "한우곰탕")
// 띄어 쓴 낱말 하나와 같음("수육" ↔ "수육 정식"). 앞부분만 겹치는 경우("김치" ↔ "김치만두")는 다른 메뉴로 봅니다.
function sameMenu(a, b) {
    const ka = menuKey(a);
    const kb = menuKey(b);
    if (!ka || !kb) return null;
    if (ka === kb) return 'exact';
    const [short, long, longRaw] = ka.length <= kb.length ? [ka, kb, b] : [kb, ka, a];
    if (short.length < 2) return null;
    if (long.endsWith(short)) return 'part';
    const words = String(longRaw).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s+/).map(compact).filter(Boolean);
    return words.length > 1 && words.includes(short) ? 'part' : null;
}

function findSame(name, candidates, nameOf) {
    const exact = candidates.find((item) => sameMenu(name, nameOf(item)) === 'exact');
    if (exact) return { item: exact, match: 'exact' };
    const part = candidates.find((item) => sameMenu(name, nameOf(item)) === 'part');
    return part ? { item: part, match: 'part' } : null;
}

function buildOps(ctx) {
    const { g, place, cap } = ctx;
    const detail = place.detail;
    ctx.conveniences = new Map();
    ctx.seats = new Map();
    ctx.menus = new Map();
    ctx.styles = new Map();
    if (!detail) return;
    g.add({ id: 'hub:ops', group: 'ops', type: 'concept', label: '운영 정보', detail: '스마트플레이스에 등록해 둔 영업시간·사진·예약·메뉴 같은 운영 정보입니다.', target: 'sec-ops', weight: 1 }, 'store');

    if (detail.hours) {
        const days = list(detail.hours.days);
        const open = days.filter((day) => day.start && day.end).length;
        const registered = Boolean(detail.hours.registered);
        g.add({
            id: 'ops:hours', group: 'ops', type: 'opsItem', tone: registered ? 'good' : 'bad', label: '영업시간', sub: registered ? '등록됨' : '미등록', subTone: registered ? 'good' : 'bad',
            detail: '스마트플레이스에 등록하는 영업시간입니다.', target: 'sec-ops',
            weight: registered ? 0.7 : 0.95,
            facts: facts(
                registered && (detail.hours.status || detail.hours.statusText) ? { label: '지금 상태', value: [detail.hours.status, detail.hours.statusText].filter(Boolean).join(' · ') } : null,
                days.length ? { label: '영업하는 요일 칸', value: `${open}개 / ${days.length}개` } : null,
                detail.hours.regularClosed ? { label: '정기휴무', value: detail.hours.regularClosed } : null,
            ),
        }, 'hub:ops');
    }
    if (isKnown(detail.photos?.business)) {
        const none = detail.photos.business === 0;
        g.add({
            id: 'ops:photos', group: 'ops', type: 'opsItem', tone: none ? 'bad' : undefined, label: '업체 사진', sub: `${formatNumber(detail.photos.business)}장`, subTone: none ? 'bad' : undefined,
            detail: '사장님이 스마트플레이스에 직접 올린 사진 수입니다.', target: 'sec-ops',
            weight: none ? 0.95 : 0.6,
            facts: facts(
                isKnown(detail.photos.top) ? { label: '전체 사진', value: detail.photos.top === 0 ? '없음' : `${formatNumber(detail.photos.top)}장` } : null,
                isKnown(detail.photos.visitorMedia) ? { label: '방문자 사진·영상', value: `${formatNumber(detail.photos.visitorMedia)}개` } : null,
            ),
        }, 'hub:ops');
    }
    if (isKnown(detail.hasBooking)) {
        g.add({
            id: 'ops:booking', group: 'ops', type: 'opsItem', tone: detail.hasBooking ? 'good' : 'warn', label: '네이버 예약', sub: detail.hasBooking ? '연결됨' : '없음', subTone: detail.hasBooking ? 'good' : 'warn',
            detail: '매장 화면에서 네이버 예약을 받을 수 있게 연결했는지입니다.', target: 'sec-ops', weight: 0.6,
            facts: facts(
                detail.bookingItemCount > 0 ? { label: '예약 상품', value: `${formatNumber(detail.bookingItemCount)}개` } : null,
                isKnown(detail.couponCount) ? { label: '쿠폰', value: `${formatNumber(detail.couponCount)}개` } : null,
            ),
        }, 'hub:ops');
    }
    if (detail.subway?.station) {
        const subway = detail.subway;
        g.add({
            id: 'ops:subway', group: 'ops', type: 'opsItem', label: '가까운 역', sub: subway.station,
            detail: '네이버 플레이스에 표시된, 매장에서 가장 가까운 지하철역입니다.', target: 'sec-ops', weight: 0.5,
            facts: facts(subway.exit ? { label: '출구', value: `${subway.exit}번` } : null, subway.walkMinutes ? { label: '걸어서', value: `${subway.walkMinutes}분` } : null),
        }, 'hub:ops');
    }
    if (detail.parking) {
        const parking = detail.parking;
        g.add({
            id: 'ops:parking', group: 'ops', type: 'opsItem', tone: parking.available ? 'good' : 'muted', label: '주차',
            sub: parking.available ? `가능${parking.free === true ? ' (무료)' : parking.free === false ? ' (유료)' : ''}` : '정보 없음', subTone: parking.available ? 'good' : 'muted',
            detail: '네이버 플레이스에 등록한 주차 정보입니다.', target: 'sec-ops', weight: 0.45,
            facts: facts(parking.available && parking.valet ? { label: '발레파킹', value: '가능' } : null),
        }, 'hub:ops');
    }
    const links = list(detail.links);
    if (links.length > 0) {
        g.add({
            id: 'ops:links', group: 'ops', type: 'opsItem', label: '연결 채널', sub: `${links.length}개`,
            detail: '매장 화면에 연결해 둔 홈페이지·SNS·톡톡 같은 채널입니다.', target: 'sec-ops', weight: 0.4,
            facts: facts({ label: '종류', value: links.join(', ') }),
        }, 'hub:ops');
    }

    // 편의시설(매장 요약의 편의 정보 + 정보 탭의 시설)
    const seenConv = new Set();
    const conveniences = [...list(place.conveniences), ...list(detail.facilities)].map((word) => String(word).trim()).filter((word) => {
        const key = compact(word);
        if (!key || seenConv.has(key)) return false;
        seenConv.add(key);
        return true;
    });
    if (conveniences.length > 0) {
        // 낱개 이름은 이 점 아래에 달린 점들이 가지고 있습니다. 다 보여 주지 못할 때만 보여 주는 수를 적습니다.
        const convShown = Math.min(conveniences.length, cap.conveniences);
        g.add({
            id: 'ops:conv', group: 'ops', type: 'concept', label: '편의시설', sub: `${conveniences.length}개`, subTone: 'muted',
            detail: ['네이버 플레이스에 등록한 편의시설입니다.', convShown < conveniences.length ? `그래프에는 ${convShown}개만 보여 줍니다.` : null].filter(Boolean).join(' '),
            target: 'sec-ops', weight: 0.55,
        }, 'hub:ops');
        for (const word of conveniences.slice(0, cap.conveniences)) {
            const id = `conv:${word}`;
            if (g.add({ id, group: 'ops', type: 'facility', label: shortenLabel(word, 9), full: word, detail: '네이버 플레이스에 등록한 편의시설입니다.', target: 'sec-ops', weight: 0.3 }, 'ops:conv')) {
                ctx.conveniences.set(compact(word), { id, name: word });
            }
        }
    }
    const seats = list(detail.seats).map((word) => String(word).trim()).filter(Boolean);
    if (seats.length > 0) {
        const seatShown = Math.min(seats.length, cap.seats);
        g.add({
            id: 'ops:seat', group: 'ops', type: 'concept', label: '좌석', sub: `${seats.length}종`, subTone: 'muted',
            detail: ['네이버 플레이스에 등록한 좌석 종류입니다.', seatShown < seats.length ? `그래프에는 ${seatShown}종만 보여 줍니다.` : null].filter(Boolean).join(' '),
            target: 'sec-ops', weight: 0.4,
        }, 'hub:ops');
        for (const word of seats.slice(0, cap.seats)) {
            const id = `seat:${word}`;
            if (g.add({ id, group: 'ops', type: 'facility', label: shortenLabel(word, 9), full: word, detail: '네이버 플레이스에 등록한 좌석 종류입니다.', target: 'sec-ops', weight: 0.3 }, 'ops:seat')) {
                ctx.seats.set(compact(word), { id, name: word });
            }
        }
    }

    // 메뉴·가격표: 리뷰·결제 데이터에 같은 이름이 있는 메뉴와 대표 메뉴부터 보여 줍니다.
    const menus = list(detail.menus).filter((menu) => menu.name);
    if (menus.length > 0) {
        const total = place.menuCount || menus.length;
        const unpriced = isKnown(place.menuPricedCount) ? total - place.menuPricedCount : null;
        // 주간 인기 메뉴·추천 이유가 된 메뉴·리뷰에 나온 메뉴마다 가장 잘 맞는 등록 메뉴 하나씩을 먼저 고르고, 남는 자리는 대표 메뉴 → 등록 순서로 채웁니다.
        // 추천 이유가 된 메뉴(place-keywords 의 "메뉴 '대방어 정식'")는 추천 키워드마다 첫 번째 것을 위 순서에 넣습니다(그 키워드의 이유를 이을 점).
        // 둘째 이후 이유("메뉴 '대방어 숙성회'")는 상한 밖에 더합니다(recoMenus 개까지). 본문 추천 목록에 이유가 셋이면 카드에도 셋이 보이게 하려는 것이고,
        // 그래도 점이 모자라 못 넣은 메뉴는 연결의 이유 문장에 적습니다(linkSupports).
        const menuReasons = list(ctx.recommendation?.items).map((item) => list(item.reasons).map((reason) => String(reason.text || '').match(/^메뉴 '(.+)'$/)?.[1]).filter(Boolean));
        const recoMenus = [...new Set(menuReasons.map((names) => names[0]).filter(Boolean))];
        const recoExtra = [...new Set(menuReasons.flatMap((names) => names.slice(1)))].filter((name) => !recoMenus.includes(name));
        const others = [...[...ctx.posMenus.values()].map((item) => item.name), ...recoMenus, ...[...ctx.reviewMenus.values()].map((item) => item.label)];
        const seenMenu = new Set();
        const unique = menus.map((menu, index) => ({ menu, index, matched: false })).filter((entry) => {
            const key = compact(entry.menu.name);
            if (seenMenu.has(key)) return false;
            seenMenu.add(key);
            return true;
        });
        const ranked = [];
        for (const name of others) {
            const best = findSame(name, unique, (entry) => entry.menu.name);
            if (best && !ranked.includes(best.item)) {
                best.item.matched = true;
                ranked.push(best.item);
            }
        }
        const rest = unique.filter((entry) => !entry.matched).sort((a, b) => Number(Boolean(b.menu.recommended)) - Number(Boolean(a.menu.recommended)) || a.index - b.index);
        ranked.push(...rest);
        ranked.splice(cap.menus);
        let extras = 0;
        for (const name of recoExtra) {
            if (extras >= cap.recoMenus) break;
            const best = findSame(name, unique, (entry) => entry.menu.name);
            if (best && !ranked.includes(best.item)) {
                best.item.matched = true;
                ranked.push(best.item);
                extras += 1;
            }
        }
        // 전체 개수는 sub 에 있습니다. 가격·설명은 "빠진 개수"로 적고, 모두 있거나 모두 없으면 말로 적습니다
        // (전체 개수와 같은 숫자가 되풀이되지 않게).
        const undescribed = isKnown(place.menuDescribedCount) ? total - place.menuDescribedCount : null;
        const filled = (missing) => (missing <= 0 ? '모두 있음' : missing >= total ? '모두 없음' : `${formatNumber(missing)}개 없음`);
        g.add({
            id: 'ops:menu', group: 'ops', type: 'concept', tone: unpriced > 0 ? 'warn' : undefined, label: '메뉴·가격', sub: `${formatNumber(total)}개`, subTone: unpriced > 0 ? 'warn' : 'muted',
            detail: [`스마트플레이스에 등록한 ${ctx.item}${p(ctx.item, '과', '와')} 가격입니다.`, ranked.length < total ? `그래프에는 리뷰·결제에 나온 것부터 ${ranked.length}개만 보여 줍니다.` : null].filter(Boolean).join(' '),
            target: 'sec-ops', weight: 0.65,
            facts: facts(
                unpriced !== null ? { label: '가격', value: filled(unpriced), tone: unpriced > 0 ? 'warn' : undefined } : null,
                undescribed !== null ? { label: '설명', value: filled(undescribed) } : null,
                detail.menuUpdatedAt ? { label: '마지막 수정', value: detail.menuUpdatedAt } : null,
            ),
        }, 'hub:ops');
        ranked.forEach(({ menu, matched }, order) => {
            const id = `menu:${menu.name}`;
            const added = g.add({
                id, group: 'ops', type: 'menu', tone: menu.price ? undefined : 'warn', label: shortenLabel(menu.name, 9), full: menu.name, sub: menu.price || '가격 없음', subTone: menu.price ? 'muted' : 'warn',
                detail: `스마트플레이스에 등록한 ${ctx.item}입니다. 값은 등록한 가격입니다.`, target: 'sec-ops',
                weight: (matched ? 0.6 : menu.recommended ? 0.5 : 0.35) - order * 0.02,
                facts: facts(menu.recommended ? { label: '표시', value: `대표 ${ctx.item}` } : null, isKnown(menu.hasImage) ? { label: '사진', value: menu.hasImage ? '있음' : '없음' } : null),
            }, 'ops:menu');
            if (added) ctx.menus.set(compact(menu.name), { id, name: menu.name, price: menu.price || null });
        });
    }

    // 미용실: 스타일별 누적 예약 수. 본문에서는 리뷰 구역의 목록(리뷰에 나온 시술 옆)에 있으므로 그래프에서도 '리뷰·활동' 묶음에 두어,
    // 카드 머리의 묶음 이름과 버튼의 도착지("리뷰 보기")가 같게 합니다. 점의 id(ops:style)는 본문 카드의 data-node 와 맞춰 그대로 둡니다.
    const styles = list(detail.styles).filter((style) => style.name && Number.isFinite(style.count)).map((style) => ({ label: String(style.name), count: style.count }));
    ctx.styles = addCountList(g, {
        hub: { id: 'ops:style', group: 'voice', label: '예약 많은 스타일', detail: '네이버 예약에 표시된 스타일별 누적 예약 수입니다.' },
        parent: 'hub:voice', prefix: 'style', type: 'style', items: styles, limit: cap.styles, unit: '건', source: (item) => `예약 ${formatNumber(item.count)}건`, target: 'sec-reviews',
        topLabel: '예약이 가장 많은 스타일', itemDetail: '네이버 예약에 표시된 이 스타일의 누적 예약 수입니다.',
    });
}

/* ───────── AI 검색: 본문의 AI 검색(GEO·AEO) 진단과 같은 순수 함수로 다시 계산합니다 ─────────
 * 점수는 lib/place-geo.js 의 값을 그대로 쓰고, 화면에 나오는 이름만 쉬운 말로 바꿉니다(약어 GEO·AEO 는 설명에만 둡니다). */

const FACTOR_TONE = { good: 'good', fair: 'warn', poor: 'bad', unknown: 'muted' };
const QUESTION_LABEL = {
    location: '위치·가는 길', hours: '영업시간', price: '가격대', signature: '대표 메뉴', reputation: '평판', parking: '주차·편의', booking: '예약·문의', payment: '쿠폰·혜택',
};
const QUESTION_STATUS = {
    yes: { text: '바로 답함', tone: 'good' }, partial: { text: '일부만 답함', tone: 'warn' }, no: { text: '답할 정보 없음', tone: 'bad' }, unknown: { text: '확인 불가', tone: 'muted' },
};

// 점검 항목의 쉬운 이름 [점 이름, 전체 이름]. 본문 진단의 항목 이름(괄호 안)과 짝을 맞춰 찾을 수 있게 전체 이름에 같은 낱말을 남깁니다.
const FACTOR_NAMES = {
    entity: ['기본 정보', '기본 정보(상호·주소·전화)'],
    sources: ['블로그·카페 글', '블로그·카페 글(밖에서 쓴 글)'],
    reviews: ['리뷰 수·평점', '리뷰 수·평점·글 리뷰'],
    freshness: ['최근 리뷰·소식', '최근 리뷰·소식·메뉴 수정'],
    keywords: ['키워드·리뷰 일치', '대표키워드와 리뷰 표현의 일치'],
    naverAi: ['AI 브리핑·쿠폰', '네이버 AI 브리핑·쿠폰'],
    tone: ['과장 없는 표현', '과장 없는 표현(광고 문구)'],
    sameAs: ['홈페이지·SNS 연결', '홈페이지·SNS·톡톡 연결'],
    competition: ['대표키워드 순위', '대표키워드 검색 순위'],
    atomic: ['소개글·한 줄 소개', '소개글·한 줄 소개·역 정보'],
    structured: ['메뉴 가격·영업시간', '메뉴 가격·설명·영업시간·편의시설 정리'],
    multiturn: ['가격·예약·문의', '가격·예약·문의 안내'],
    qna: ['리뷰 답글·소식', '리뷰 답글·소식 글'],
    fanout: ['AI가 묻는 질문', 'AI가 나눠 묻는 질문'],
};

function factorNames(factor) {
    if (FACTOR_NAMES[factor.key]) return FACTOR_NAMES[factor.key];
    const full = String(factor.label || '').trim();
    return [shortenLabel(full.replace(/\(.*\)\s*$/, '').trim(), 10), full];
}

function buildGeo(ctx) {
    const { g, place, activity, rows, nowMs } = ctx;
    const fanout = buildFanout(place, activity);
    const geo = scoreGeo(place, activity, rows, { nowMs });
    const aeo = scoreAeo(place, activity, fanout);
    const platforms = platformReadiness(geo, aeo);
    const coverage = fanoutCoverage(fanout);
    ctx.geo = { geo, aeo, fanout, platforms, factors: new Map() };
    const plainByLabel = new Map([...geo.factors, ...aeo.factors].map((factor) => [factor.label, factorNames(factor)[0]]));

    g.add({
        id: 'hub:geo', group: 'geo', type: 'concept', label: 'AI 검색', detail: 'AI가 내 매장을 추천하고 손님 질문에 답할 준비가 됐는지 본 혼잘마 자체 점검입니다(GEO·AEO 진단).', target: 'sec-geo', weight: 1,
        facts: facts(
            isKnown(geo.score) ? { label: 'AI 추천 준비', value: `${geo.score}점`, tone: scoreTone(geo.score) } : null,
            isKnown(aeo.score) ? { label: 'AI 답변 준비', value: `${aeo.score}점`, tone: scoreTone(aeo.score) } : null,
            coverage ? { label: '바로 답할 수 있는 질문', value: `${coverage.yes}개 / ${coverage.known}개` } : null,
        ),
    }, 'store');

    // 점수는 sub 에만, 등급과 항목 수는 facts 에 둡니다.
    const scoreNode = (id, name, full, result, hint) => g.add({
        id, group: 'geo', type: 'aiScore', tone: scoreTone(result.score), label: name, full,
        sub: isKnown(result.score) ? `${result.score}점` : '확인 불가', subTone: scoreTone(result.score), detail: hint, target: 'sec-geo', weight: 0.85,
        facts: facts(
            isKnown(result.score) ? { label: '등급', value: result.label } : null,
            { label: '점검 항목', value: `${result.factors.length}개` },
        ),
    }, 'hub:geo');
    scoreNode('geo:score', 'AI 추천 준비', 'AI 추천 목록에 들 준비', geo, 'AI가 추천 목록을 만들 때 쓸 정보(리뷰·블로그 글·기본 정보)가 갖춰졌는지 본 혼잘마 자체 점검 점수입니다(GEO).');
    scoreNode('aeo:score', 'AI 답변 준비', 'AI 질문에 바로 답할 준비', aeo, '주차·가격·영업시간 같은 손님 질문에 AI가 바로 답할 정보가 있는지 본 혼잘마 자체 점검 점수입니다(AEO).');

    const addFactors = (result, parent) => {
        const heaviest = Math.max(1, ...result.factors.map((factor) => factor.fullWeight || 0));
        const allWeight = result.factors.reduce((sum, factor) => sum + (factor.fullWeight || 0), 0);
        for (const factor of result.factors) {
            if (factor.key === 'fanout') continue;
            const id = `gf:${factor.key}`;
            const tone = FACTOR_TONE[factor.status] || 'muted';
            const [name, full] = factorNames(factor);
            const sub = isKnown(factor.pct) ? `${factor.pct}점` : '확인 불가';
            const added = g.add({
                // 항목 점수(100점 기준)는 sub 에만 적습니다. 근거 문장에 그 점수를 다시 적은 마디가 있으면 뺍니다.
                id, group: 'geo', type: 'aiFactor', tone, label: name, full, sub, subTone: tone,
                detail: withoutRestated(factor.evidence, sub), target: 'sec-geo', weight: 0.25 + 0.6 * ((factor.fullWeight || 0) / heaviest),
                facts: facts(
                    // 배점은 '총점에서 차지하는 비중'으로 적습니다(항목 점수와 단위가 같으면 숫자가 우연히 같을 때 같은 값으로 읽힙니다).
                    allWeight > 0 && factor.fullWeight > 0 ? { label: '총점에서 차지하는 비중', value: `${Math.round((factor.fullWeight / allWeight) * 100)}%` } : null,
                ),
            }, parent);
            if (added) ctx.geo.factors.set(factor.key, { id, factor, name });
        }
    };
    addFactors(geo, 'geo:score');
    addFactors(aeo, 'aeo:score');

    // AI 가 "○○ 추천"을 나눠 묻는 질문들
    const fanoutFactor = aeo.factors.find((factor) => factor.key === 'fanout') || null;
    ctx.geo.questions = new Map();
    if (fanout.length > 0) {
        const tone = fanoutFactor ? FACTOR_TONE[fanoutFactor.status] || 'muted' : 'muted';
        const [name, full] = FACTOR_NAMES.fanout;
        const labelOf = (item) => QUESTION_LABEL[item.key] || shortenLabel(item.question, 10);
        const namesOf = (status) => fanout.filter((item) => item.status === status && !item.notApplicable).map(labelOf).join(', ');
        const notApplicableNames = fanout.filter((item) => item.notApplicable).map(labelOf).join(', ');
        g.add({
            id: 'geo:fanout', group: 'geo', type: 'concept', tone, label: name, full,
            // "바로 답한 질문 / 전체 질문"은 sub 에만 적습니다.
            sub: coverage ? `${coverage.yes}/${coverage.known} 답함` : undefined, subTone: tone,
            detail: '손님이 AI에게 매장을 물으면 AI가 나눠서 확인하는 질문들입니다. 매장 정보만으로 답할 수 있는지 봅니다.', target: 'sec-geo', weight: 0.8,
            // 답하지 못한 질문은 개수 대신 어떤 질문인지 적습니다(개수는 sub 의 숫자와 우연히 같아질 수 있습니다).
            facts: facts(
                namesOf('partial') ? { label: '일부만 답한 질문', value: namesOf('partial') } : null,
                namesOf('no') ? { label: '답할 정보가 없는 질문', value: namesOf('no'), tone: 'bad' } : null,
                notApplicableNames ? { label: '이 업종에는 해당 없는 질문', value: notApplicableNames } : null,
                fanoutFactor && isKnown(fanoutFactor.pct) ? { label: '항목 점수', value: `${fanoutFactor.pct}점` } : null,
            ),
        }, 'hub:geo');
        if (fanoutFactor) ctx.geo.factors.set('fanout', { id: 'geo:fanout', factor: fanoutFactor, name });
        for (const item of fanout) {
            // 업종 때문에 해당 없는 질문(place-industry.js)은 '확인 불가'가 아니라 '해당 없음'으로 보입니다
            const status = item.notApplicable ? { text: '해당 없음', tone: 'muted' } : QUESTION_STATUS[item.status] || QUESTION_STATUS.unknown;
            const id = `fq:${item.key}`;
            const added = g.add({
                id, group: 'geo', type: 'aiQuestion', tone: status.tone, label: QUESTION_LABEL[item.key] || shortenLabel(item.question, 10), full: item.question, sub: status.text, subTone: status.tone,
                // 상태는 sub 에만 적습니다. 설명은 지금 매장 정보로 만들 수 있는 답(없으면 채울 것)입니다.
                detail: item.answer || item.fix, target: 'sec-geo', weight: (item.status === 'no' ? 0.8 : item.status === 'partial' ? 0.6 : 0.45) * (item.weight || 1),
            }, 'geo:fanout');
            if (added) ctx.geo.questions.set(item.key, { id, item });
        }
    }

    ctx.geo.platformNodes = [];
    for (const platform of platforms) {
        const id = `ai:${platform.key}`;
        const tone = scoreTone(platform.score);
        const weakest = platform.weakest ? plainByLabel.get(platform.weakest) || platform.weakest : null;
        const added = g.add({
            id, group: 'geo', type: 'aiPlatform', tone, label: platform.short, full: platform.label, sub: isKnown(platform.score) ? `준비 ${platform.score}점` : '확인 불가', subTone: tone,
            // 준비 점수는 sub 에만, 가장 약한 항목은 facts 에만 적습니다.
            detail: `${platform.source}에서 정보를 가져갑니다. 점수는 매장 정보만 보고 매긴 혼잘마 자체 점검 값입니다.`, target: 'sec-geo', weight: 0.6,
            facts: facts(
                { label: '등급', value: platform.grade },
                weakest ? { label: '가장 약한 항목', value: weakest } : null,
            ),
        }, 'hub:geo');
        if (added) ctx.geo.platformNodes.push({ id, platform });
    }
}

/* ───────── 관계: 모두 (주어) —관계→ (목적어) 방향으로 잇습니다. 관계 이름과 이을 수 있는 종류는 ONTOLOGY.relations 에 있습니다 ─────────
 * why   그 연결 한 건의 설명(수치 포함). badge 는 카드의 조각에 붙는 짧은 값입니다(출처와 수 "리뷰 22회", 순위 "이 매장 2위").
 * 한 카드에 내 순위와 경쟁 매장의 순위가 함께 나오므로, 순위에는 늘 누구 것인지 적습니다("이 매장 2위" / "내 매장은 12위"). */

// 그 키워드에서 내 매장의 순위를 문장에 넣을 말: '12위' · '300위 밖' · null(목록에 없음)
function myRankText(result) {
    if (result.status === 'found') return `${result.rank}위`;
    if (result.status === 'beyond') return `${formatNumber(result.scanned)}위 밖`;
    return null;
}

// 순위가 없는 키워드의 조각 값. 지역 이름이 없는 등록 키워드는 자동 순위 조회에서 빼므로(검색 위치마다 순위가 달라짐)
// "조회 전"이 아니라 "조회 안 함"입니다. 내 매장과 경쟁 매장 조각에 같은 말을 씁니다.
function unrankedBadge(entry) {
    const row = entry.row;
    if (row?.state === 'loading') return '순위 조회 중';
    if (row) return '순위 조회 실패';
    return entry.reg?.hasRegion === false ? '지역 없어 조회 안 함' : '순위 조회 전';
}

// (내 매장·경쟁 매장) —대표키워드로 등록함→ (키워드)
function linkRegisters(ctx) {
    const { g, place } = ctx;
    const total = Array.isArray(place.keywords) ? place.keywords.length : 0;
    for (const entry of ctx.keywords) {
        if (!entry.registered) continue;
        const note = entry.reg ? (entry.reg.hasRegion ? ' 지역 이름이 들어 있는 키워드입니다.' : ' 지역 이름이 없는 키워드입니다.') : '';
        // 순위를 조회한 키워드에는 내 순위를 붙입니다("내 3위"). 같은 묶음에 경쟁 매장의 순위("이 매장 1위")가 나란히 나오기 때문입니다.
        // 조회하지 않은 키워드에도 값을 붙입니다. 붙이지 않으면 조각에 내 매장 점의 값(업종 이름)이 순위 자리에 대신 나옵니다.
        const done = isDone(entry.row);
        const mine = done ? myRankText(entry.row.result) : null;
        const badge = done ? (mine ? `내 ${mine}` : '목록에 내 매장 없음') : unrankedBadge(entry);
        g.relate('store', 'registers', entry.id, `내 매장이 스마트플레이스에 등록한 대표키워드 ${total}개 가운데 하나입니다.${note}`, 0.6,
            { badge, rank: done && entry.row.result.status === 'found' ? entry.row.result.rank : null });
    }
    for (const rival of ctx.rivalNodes) {
        for (const word of list(rival.entry.keywords)) {
            const kw = ctx.kwByKey.get(compact(word));
            if (!kw) continue;
            // 조각에는 그 키워드에서 이 매장의 순위를 붙입니다. 붙이지 않으면 키워드 점의 값(내 순위)이 대신 나와
            // 경쟁 매장 카드에서 누구 순위인지 알 수 없습니다.
            const row = kw.row;
            const hit = rival.hits.find((item) => compact(item.keyword) === kw.key) || null;
            const mine = isDone(row) ? myRankText(row.result) : null;
            const myPart = mine ? `내 매장은 ${mine}입니다` : '내 매장은 이 키워드 목록에 없습니다';
            let badge = unrankedBadge(kw);
            let ranks = '';
            if (isDone(row) && hit) {
                badge = `이 매장 ${hit.rank}위`;
                ranks = ` 이 키워드에서 이 매장은 ${hit.rank}위, ${myPart}.`;
            } else if (isDone(row)) {
                // 순위 결과에는 상위 몇 곳만 들어 있습니다. 거기에 없으면 그 밖이라는 것까지만 압니다.
                const seen = Math.max(0, ...list(row.result.top).map((top) => (Number.isFinite(top.rank) ? top.rank : 0)));
                badge = seen > 0 ? `이 매장 ${seen}위 밖` : '이 매장 순위 모름';
                ranks = seen > 0 ? ` 이 키워드의 상위 ${seen}곳 안에 이 매장은 없고, ${myPart}.` : '';
            }
            g.relate(rival.id, 'registers', kw.id,
                `${q(rival.entry.name, '이', '가')} ${q(kw.word, '을', '를')} 대표키워드로 등록했습니다${kw.registered ? '(내 매장도 등록)' : '(내 매장은 등록하지 않음)'}.${ranks}`,
                kw.registered ? 0.75 : 0.7, { badge, rank: isDone(row) && hit ? hit.rank : null });
        }
    }
    for (const { id, item } of list(ctx.rivalKeywords)) {
        for (const rival of item.rivals) {
            g.relate(rival.id, 'registers', id, `${q(rival.entry.name, '이', '가')} ${q(item.word, '을', '를')} 대표키워드로 등록했습니다(내 매장은 등록하지 않음).`, 0.55);
        }
    }
}

// (경쟁 매장) —검색에서 내 매장보다 위→ (키워드) / (경쟁 매장) —검색에서 내 매장보다 아래→ (키워드). 조각에는 그 매장의 순위를 붙입니다.
function linkRanks(ctx) {
    const { g, rows, cap } = ctx;
    const rowByKeyword = new Map(rows.map((row) => [row.keyword, row]));
    const candidates = [];
    for (const rival of ctx.rivalNodes) {
        for (const hit of rival.hits) {
            const kw = ctx.kwByKey.get(compact(hit.keyword));
            const row = rowByKeyword.get(hit.keyword);
            if (!kw || !isDone(row)) continue;
            candidates.push({ rival, hit, kw, result: row.result });
        }
    }
    candidates.sort((a, b) => byRank(a.hit, b.hit) || a.rival.entry.order - b.rival.entry.order);
    for (const { rival, hit, kw, result } of candidates.slice(0, cap.rankLinks)) {
        // 문장과 조각 값에 누구 순위인지 적습니다(이 매장의 순위 / 내 매장의 순위).
        const who = `${q(rival.entry.name, '은', '는')} ${q(hit.keyword)} 검색 ${hit.rank}위`;
        let why = `${who}로, 내 매장(${result.rank}위)보다 ${hit.above ? '위' : '아래'}에 있습니다.`;
        if (result.status === 'beyond') why = `${who}이고, 내 매장은 ${formatNumber(result.scanned)}위 밖입니다.`;
        else if (result.status !== 'found') why = `${who}이고, 내 매장은 이 키워드 목록에 없습니다.`;
        const base = Math.max(0.3, 1 - ((hit.rank - 1) / 10) * 0.7);
        g.relate(rival.id, hit.above ? 'outranks' : 'ranksIn', kw.id, why, hit.above ? base : base * 0.6, { badge: `이 매장 ${hit.rank}위`, rank: hit.rank });
    }
}

// (이유) —추천 이유가 됨→ (추천 키워드): 등록 키워드·손님이 고른 좋은 점·리뷰·예약·결제·블로그 낱말·영업시간
// 이유 문구(reason.text)는 lib/place-keywords.js 의 evidenceSources 가 만든 것을 그대로 읽습니다.
const FACT_PATTERNS = [
    [/^손님이 고른 좋은 점 '(.+)' [\d,]+명$/, 'votes', null],
    [/^리뷰에 '(.+)' [\d,]+회$/, 'reviewMenus', null],
    [/^리뷰 주제 '(.+)'$/, 'themes', null],
    [/^편의시설 '(.+)'$/, 'conveniences', '편의시설'],
    [/^좌석 '(.+)'$/, 'seats', '좌석'],
    [/^메뉴 '(.+)'$/, 'menus', '등록 메뉴'],
    [/^예약 스타일 '(.+)'$/, 'styles', null],
];

function linkSupports(ctx) {
    const { g, recommendation } = ctx;
    const registered = list(recommendation?.registered);
    const blogTotal = recommendation?.blogTotal ?? ctx.activity?.mentions?.blogTotal ?? null;
    const pooled = ctx.rivalNodes.filter((rival) => rival.entry.keywords);
    for (const entry of ctx.keywords) {
        const item = entry.item;
        if (!item || entry.type !== 'recoKeyword') continue;
        const term = item.term;
        const termKey = compact(term);
        const because = (source, why, strength, badge) => g.relate(source, 'supports', entry.id, why, strength, { badge });
        // 추천 이유로 적힌 메뉴 가운데 그래프에 점이 없는 것(메뉴 점 상한 때문): 점이 있는 첫 메뉴의 연결 문장에 함께 적어, 근거가 카드에서 사라지지 않게 합니다.
        const menuReasons = list(item.reasons).map((reason) => String(reason.text || '').match(/^메뉴 '(.+)'$/)?.[1]).filter(Boolean);
        const unshownMenus = menuReasons.filter((name) => !ctx.menus.get(compact(name)));
        let menuNoted = false;
        for (const reason of list(item.reasons)) {
            const text = String(reason.text || '');
            if (reason.kind === 'registered') {
                for (const reg of registered.filter((other) => other.core && other.core === termKey)) {
                    const source = ctx.kwByKey.get(compact(reg.keyword));
                    if (!source || source.type !== 'keyword') continue;
                    const whole = compact(reg.keyword) === termKey;
                    // 배지는 연결의 양쪽 카드에 다 나오므로, 한쪽 점의 종류('대표키워드')가 아니라 두 키워드를 잇는 것(같은 낱말 / 지역 이름을 붙임)을 적습니다.
                    because(source.id, whole
                        ? `${q(item.keyword, '은', '는')} 등록 키워드 '${reg.keyword}'에 지역 이름 ${q(item.region, '을', '를')} 붙인 조합입니다.`
                        : `${q(item.keyword, '은', '는')} 등록 키워드 '${reg.keyword}'의 낱말 '${term}'에 지역 이름 ${q(item.region, '을', '를')} 붙인 조합입니다.`, 0.75, whole ? '지역 이름 붙임' : `'${term}'`);
                }
            } else if (reason.kind === 'fact') {
                const registeredFact = text.match(/^등록 키워드 '(.+)'$/);
                if (registeredFact) {
                    const source = ctx.kwByKey.get(compact(registeredFact[1]));
                    if (source && source.type === 'keyword') because(source.id, `${q(item.keyword)}의 낱말 ${q(term, '은', '는')} 등록 키워드 '${registeredFact[1]}'에서 나왔습니다.`, 0.65, `'${term}'`);
                    continue;
                }
                if (text === '네이버 AI 브리핑') {
                    // 어느 문장인지 알 수 있을 때(그 낱말이 문장에 그대로 나올 때)만 잇습니다.
                    const sentence = ctx.briefing.find((brief) => compact(brief.sentence).includes(termKey));
                    if (sentence) because(sentence.id, `네이버 AI 브리핑 문장에 ${q(term, '이', '가')} 나옵니다.`, 0.5, 'AI 브리핑');
                    continue;
                }
                if (/영업$/.test(text)) {
                    // "점심 시간 영업"은 점심 결제 집계가 있으면 그것이 이유이고, 없으면 등록한 영업시간이 이유입니다(place-keywords 의 판단 순서와 같음).
                    const lunch = text === '점심 시간 영업' ? ctx.priceSlots.get('lunch') : null;
                    if (lunch) because(lunch.id, `${q(item.keyword)} 추천 이유: 점심 시간대 결제가 있습니다(1회 평균 ${won(lunch.value)}).`, 0.5, '점심 결제');
                    else because('ops:hours', `${q(item.keyword)} 추천 이유: ${text}(등록한 영업시간).`, 0.5, '영업시간');
                    continue;
                }
                for (const [pattern, bucket, badge] of FACT_PATTERNS) {
                    const found = text.match(pattern);
                    if (!found) continue;
                    const source = ctx[bucket].get(compact(found[1]));
                    if (source) {
                        const rest = bucket === 'menus' && !menuNoted && unshownMenus.length > 0 ? ` 같은 낱말이 든 메뉴 ${unshownMenus.map((name) => `'${name}'`).join('·')}도 있습니다.` : '';
                        if (rest) menuNoted = true;
                        because(source.id, `${q(item.keyword)} 추천 이유: ${text}.${rest}`, 0.7, source.badge || badge);
                    }
                    break;
                }
            } else if (reason.kind === 'feed') {
                // 소식 제목이 가장 최근 소식이면 '마지막 소식' 점이 이유입니다. 더 오래된 소식은 점이 없어 잇지 않습니다.
                const title = text.match(/^소식 '(.+)'$/)?.[1];
                const latest = ctx.activity?.feeds?.latestTitle;
                if (title && latest && compact(latest) === compact(title)) because('ac:feed', `${q(item.keyword)} 추천 이유: 마지막 소식 ${q(title)}.`, 0.6, '소식');
            } else if (reason.kind === 'review') {
                const source = ctx.reviewMenus.get(termKey);
                if (source) because(source.id, `${q(item.keyword)}의 낱말 ${q(term, '이', '가')} 방문자 리뷰에서 ${formatNumber(source.count)}회 언급됐습니다.`, 0.7, source.badge);
            } else if (reason.kind === 'booking') {
                const source = ctx.styles.get(termKey);
                if (source) because(source.id, `${q(item.keyword)}의 낱말 ${q(term, '은', '는')} 누적 예약 ${formatNumber(source.count)}건인 스타일입니다.`, 0.7, source.badge);
            } else if (reason.kind === 'pos') {
                // 결제 단말의 메뉴 이름에는 매장 이름이 앞에 붙거나 띄어쓰기가 들어 있습니다("대물볼락구이").
                // 추천 낱말을 만들 때와 같은 규칙(popularMenuTerm)으로 다듬은 이름이 같으면 그 메뉴와 잇습니다.
                const source = ctx.posMenus.get(termKey)
                    || [...ctx.posMenus.values()].find((menu) => compact(popularMenuTerm(menu.name, ctx.place)) === termKey);
                if (source) {
                    const exact = compact(source.name) === termKey;
                    because(source.id, exact
                        ? `${q(item.keyword)}의 낱말 ${q(term, '은', '는')} 주간 인기 메뉴 ${source.index + 1}위입니다.`
                        : `${q(item.keyword)}의 낱말 ${q(term, '은', '는')} 주간 인기 메뉴 ${source.index + 1}위 ${q(source.name)}에서 나온 말입니다.`,
                    0.7, `주간 인기 ${source.index + 1}위`);
                }
            } else if (reason.kind === 'blog') {
                const source = ctx.mentions.get(termKey);
                if (source) because(source.id, `${q(item.keyword)}의 낱말 ${q(term, '이', '가')} 블로그 후기 ${blogTotal ? `${formatNumber(blogTotal)}개 중 ` : ''}${formatNumber(source.count)}개에 나옵니다.`, 0.7, source.badge);
            } else if (reason.kind === 'rival' && /사용$/.test(text)) {
                // "상위 3곳이 '약국' 사용": (경쟁 매장) —키워드에 같은 낱말을 씀→ (추천 키워드). 그 매장에 대해 참인 사실만 적습니다.
                // ("상위 2곳 등록"처럼 같은 키워드를 등록한 경우는 linkRegisters 가 '대표키워드로 등록함'으로 잇습니다.)
                // 낱말이 업종 이름 그 자체('약국'·'미용실'처럼 place-keywords 가 업종·업종 대표어에서 뽑은 것)면 같은 업종 매장은 다 쓰는 말이라
                // 사실이긴 해도 변별력이 없습니다. 지우지는 않고(추천 화면의 이유와 맞춤) 연결을 약하게 둡니다.
                const generic = item.source === 'category' || item.source === 'family';
                let made = 0;
                for (const rival of pooled) {
                    if (made >= 2) break;
                    const word = rival.entry.keywords.find((other) => compact(other).includes(termKey));
                    if (!word) continue;
                    const why = compact(word) === termKey
                        ? `${q(rival.entry.name, '이', '가')} ${q(word, '을', '를')} 대표키워드로 등록했습니다.`
                        : `${q(rival.entry.name, '이', '가')} 대표키워드 '${word}'에 ${q(term, '을', '를')} 씁니다.`;
                    if (g.relate(rival.id, 'sharesTerm', entry.id, generic ? `${why} ${q(term, '은', '는')} 업종 이름입니다.` : why, generic ? 0.2 : 0.55, { badge: `'${term}'` })) made += 1;
                }
            }
        }
    }

    // 등록 키워드에 지역 이름을 붙인 조합은 그 등록 키워드가 추천 이유이고, 블로그 후기에서 더 많이 쓰는 말로 만든 조합은 '대신 써 볼 키워드'입니다.
    for (const reg of registered) {
        const mine = ctx.kwByKey.get(compact(reg.keyword));
        if (!mine || mine.type !== 'keyword') continue;
        const suggest = reg.suggest ? ctx.kwByKey.get(compact(reg.suggest)) : null;
        if (suggest && suggest.type === 'recoKeyword') {
            g.relate(mine.id, 'supports', suggest.id, `등록 키워드 ${q(reg.keyword)}에 지역 이름을 붙이면 ${q(reg.suggest)}입니다. 지역 이름이 있어야 순위를 정확히 확인할 수 있습니다.`, 0.75, { merge: false, badge: '지역 이름 붙임' });
        }
        const spoken = reg.spoken?.keyword ? ctx.kwByKey.get(compact(reg.spoken.keyword)) : null;
        if (spoken && spoken.type !== 'keyword') {
            // 약·제품 분류 이름("일반의약품")은 블로그 수가 아니라 분류 이름이라는 것이 이유입니다(place-keywords 의 관문 '차').
            const why = reg.concern?.rule === 'classification'
                ? `${q(reg.keyword, '은', '는')} 약·제품을 나누는 분류 이름이고, 블로그 후기에는 ${q(reg.spoken.term, '이라는', '라는')} 말이 ${isKnown(reg.spoken.blog) && reg.spoken.blog > 0 ? `${ctx.recommendation?.blogTotal ? `${formatNumber(ctx.recommendation.blogTotal)}개 중 ` : ''}${formatNumber(reg.spoken.blog)}개에 ` : ''}나옵니다. 그 말로 만든 조합이 ${q(reg.spoken.keyword)}입니다.`
                : `블로그 후기 언급은 ${q(reg.keyword)} ${formatNumber(reg.blog ?? 0)}개, ${q(reg.spoken.term)} ${formatNumber(reg.spoken.blog)}개입니다. 손님이 더 많이 쓰는 말로 만든 조합이 ${q(reg.spoken.keyword)}입니다.`;
            g.relate(spoken.id, 'alternativeTo', mine.id, why, 0.7);
        }
    }
}

// (블로그에 나온 낱말) —이 키워드에 들어 있음→ (키워드). 키워드마다 가장 긴 낱말 하나만 잇고,
// 그 낱말이 이미 그 키워드의 '추천 이유'로 이어져 있으면 다시 잇지 않습니다.
function linkSpoken(ctx) {
    const { g } = ctx;
    const blogTotal = ctx.activity?.mentions?.blogTotal ?? null;
    const terms = [...ctx.mentions.entries()].map(([key, value]) => ({ key, ...value }));
    for (const entry of ctx.keywords) {
        const inside = terms.filter((item) => entry.key.includes(item.key)).sort((a, b) => b.key.length - a.key.length || b.count - a.count || a.index - b.index)[0];
        if (!inside || g.related(inside.id, 'supports', entry.id)) continue;
        const kind = entry.registered ? '등록 키워드 ' : '';
        const subject = entry.key === inside.key ? `${kind}${q(entry.word, '이', '가')}` : `${kind}${q(entry.word)}에 들어 있는 낱말 ${q(inside.label, '이', '가')}`;
        g.relate(inside.id, 'spokenIn', entry.id, `${subject} 블로그 후기 ${blogTotal ? `${formatNumber(blogTotal)}개 중 ` : ''}${formatNumber(inside.count)}개에 나옵니다.`,
            0.3 + 0.4 * logShare(inside.count, Math.max(inside.count, blogTotal || 0)), { badge: inside.badge });
    }
}

// (키워드) —이 지역 이름을 씀→ (지역 이름), (지역 이름) —역 이름에서 따옴→ (가까운 역)
function linkRegions(ctx) {
    const { g } = ctx;
    for (const { id, region, using } of ctx.regions) {
        for (const entry of using) {
            g.relate(entry.id, 'usesRegion', id, `${q(entry.word)}에 들어 있는 지역 이름은 '${region.term}'${region.label ? `(${region.label})` : ''}입니다.`, 0.3);
        }
        if (region.scope === 'station') {
            g.relate(id, 'readFrom', 'ops:subway', `지역 이름 ${q(region.term, '은', '는')} 가까운 역 이름에서 따왔습니다.`, 0.45);
        }
    }
}

// (키워드) —검색 상위권보다 뒤처진 숫자→ (리뷰 숫자): 그 키워드 상위 매장들의 중간값보다 뒤처진 방문자 리뷰·블로그 리뷰·평점
const GAP_TARGET = { visitorReviews: 'rv:visitor', blogReviews: 'rv:blog', score: 'rv:score' };

function linkRankGaps(ctx) {
    const { g, place, rows, cap } = ctx;
    const mine = { visitorReviews: place.visitorReviews, blogReviews: place.blogReviews, score: place.visitorScore };
    const number = (signal, value) => (signal.key === 'score' ? Number(value).toFixed(2) : formatNumber(value));
    for (const row of rows.filter(isDone).slice(0, cap.gapKeywords)) {
        const kw = ctx.kwByKey.get(compact(row.keyword));
        const diagnosis = kw ? diagnoseRank(mine, row.result.topSignals) : null;
        if (!diagnosis) continue;
        for (const signal of diagnosis.signals) {
            const target = GAP_TARGET[signal.key];
            if (!target || signal.verdict !== 'behind' || signal.mine === null) continue;
            g.relate(kw.id, 'lagsOn', target, `${q(row.keyword)} 상위 ${formatNumber(diagnosis.count)}곳의 ${signal.label} 중간값은 ${number(signal, signal.median)}${signal.unit}, 내 매장은 ${number(signal, signal.mine)}${signal.unit}입니다.`, 0.6,
                { badge: `상위권 중간 ${number(signal, signal.median)}${signal.unit}` });
        }
    }
}

// 리뷰에 나온 메뉴 · 주간 인기 메뉴 · 등록한 메뉴 · 예약 스타일 사이
//   이름이 같으면                    (가) —이름이 같음→ (나)
//   한쪽 이름이 다른 쪽에 들어 있으면 (짧은 이름) —이름에 들어 있음→ (긴 이름)
function linkSameMenus(ctx) {
    const { g, item } = ctx;
    const reviewed = [...ctx.reviewMenus.values()].map((entry) => ({ id: entry.id, name: entry.label, lead: `리뷰에서 ${formatNumber(entry.count)}회 언급된`, tail: '' }));
    const popular = [...ctx.posMenus.values()].map((entry) => ({ id: entry.id, name: entry.name, lead: `주간 인기 메뉴 ${entry.index + 1}위`, tail: isKnown(entry.share) ? `(주문의 ${entry.share}%)` : '' }));
    const menus = [...ctx.menus.values()].map((entry) => ({ id: entry.id, name: entry.name, lead: `등록한 ${item}`, tail: entry.price ? `(${entry.price})` : '(가격 미등록)' }));
    const styles = [...ctx.styles.values()].map((entry) => ({ id: entry.id, name: entry.label, lead: `누적 예약 ${formatNumber(entry.count)}건인 스타일`, tail: '' }));
    const text = (entry) => `${entry.lead} '${entry.name}'${entry.tail}`;
    const connect = (a, candidates) => {
        const found = findSame(a.name, candidates, (entry) => entry.name);
        if (!found) return;
        const b = found.item;
        if (found.match === 'exact') {
            g.relate(a.id, 'sameItem', b.id, `${text(a)}${p(a.name, '은', '는')} ${text(b)}${p(b.name, '과', '와')} 이름이 같습니다.`, 0.9);
            return;
        }
        const [short, long] = menuKey(a.name).length <= menuKey(b.name).length ? [a, b] : [b, a];
        g.relate(short.id, 'namedIn', long.id, `${text(short)}${p(short.name, '이', '가')} ${text(long)}의 이름에 들어 있습니다.`, 0.62);
    };
    for (const review of reviewed) {
        connect(review, popular);
        connect(review, menus);
        connect(review, styles);
    }
    for (const pos of popular) connect(pos, menus);
    for (const style of styles) connect(style, menus);
}

// (할 일) —이 할 일로 고침→ (그 할 일이 가리키는 데이터), (할 일) —써 보라고 권함→ (추천 키워드·손님이 쓰는 말)
// key 는 buildActionItems 가 붙인 이름입니다.
function linkTodos(ctx) {
    const { g, recommendation } = ctx;
    const picks = list(recommendation?.items).filter((item) => item.registrable).slice(0, 2);
    const registered = list(recommendation?.registered);
    const targets = (todo, target, why, strength = 0.7) => g.relate(todo.id, 'targets', target, why, strength);
    const suggests = (todo, target, why, strength = 0.6) => g.relate(todo.id, 'suggests', target, why, strength);
    const kwId = (keyword) => ctx.kwByKey.get(compact(keyword))?.id || null;
    const factor = (key) => ctx.geo?.factors.get(key) || null;
    for (const todo of ctx.todos) {
        const { key, title } = todo.item;
        if (key === 'hours') targets(todo, 'ops:hours', '영업시간이 비어 있어 생긴 할 일입니다.', 0.9);
        else if (key === 'keywords') {
            targets(todo, 'hub:search', `${title}: 대표키워드 빈 칸을 채우는 할 일입니다.`, 0.8);
            for (const pick of picks) suggests(todo, kwId(pick.keyword), `빈 칸에 넣기 전에 순위부터 확인해 볼 추천 키워드 ${q(pick.keyword)}입니다.`, 0.65);
        } else if (key === 'keywordRegion') {
            for (const reg of registered.filter((entry) => entry.hasRegion === false)) targets(todo, kwId(reg.keyword), `등록 키워드 ${q(reg.keyword, '에는', '에는')} 지역 이름이 없습니다.`, 0.7);
            for (const pick of picks) suggests(todo, kwId(pick.keyword), `지역 이름을 붙인 추천 키워드 ${q(pick.keyword)}입니다.`, 0.6);
        } else if (key === 'keywordSpoken') {
            const unspoken = registered.find((entry) => entry.spoken && entry.blog === 0);
            if (unspoken) {
                targets(todo, kwId(unspoken.keyword), `등록 키워드 ${q(unspoken.keyword, '은', '는')} 블로그 후기에 한 번도 나오지 않습니다.`, 0.75);
                const spoken = ctx.mentions.get(compact(unspoken.spoken.term));
                if (spoken) suggests(todo, spoken.id, `손님은 블로그 후기에서 ${q(unspoken.spoken.term, '을', '를')} ${formatNumber(unspoken.spoken.blog)}번 썼습니다.`, 0.75);
            }
        } else if (key === 'description') targets(todo, factor('atomic')?.id, `소개글이 비어 있으면 AI 점검의 '${factor('atomic')?.name}' 점수도 낮아집니다.`, 0.6);
        else if (key === 'photos') targets(todo, 'ops:photos', `${title}: 사장님이 올린 업체 사진 수에서 나온 할 일입니다.`, 0.9);
        else if (key === 'menuImage') targets(todo, 'ops:menu', '네이버가 메뉴·가격 사진이 부족하다고 표시한 매장입니다.', 0.75);
        else if (key === 'menuPrice') targets(todo, 'ops:menu', `${title}: 가격이 비어 있는 메뉴에서 나온 할 일입니다.`, 0.75);
        else if (key === 'reply') targets(todo, 'ac:reply', `${title}: 최근 방문자 리뷰의 사장님 답글 비율에서 나온 할 일입니다.`, 0.9);
        else if (key === 'feed') targets(todo, 'ac:feed', `${title}: 마지막 소식 날짜에서 나온 할 일입니다.`, 0.85);
        else if (key === 'blog') targets(todo, 'ac:blog', '최근 30일 동안 새 블로그 리뷰가 없어 생긴 할 일입니다.', 0.8);
        else if (key === 'coupon') targets(todo, 'ac:coupon', '등록된 쿠폰이 0개라서 생긴 할 일입니다.', 0.8);
        else if (key === 'booking') targets(todo, 'ops:booking', '네이버 예약을 쓰지 않아 생긴 할 일입니다.', 0.8);
        else if (key === 'accessor') targets(todo, ctx.geo?.questions.get('location')?.id, '찾아오는 길 안내가 있으면 AI가 "어디에 있고 어떻게 가나요?"에 더 정확히 답할 수 있습니다.', 0.6);
        else if (key === 'conveniences') targets(todo, ctx.geo?.questions.get('parking')?.id, '편의시설 정보가 있어야 AI가 "주차·편의시설은 어떤가요?"에 답할 수 있습니다.', 0.6);
        else if (key === 'talktalk') targets(todo, factor('sameAs')?.id, `톡톡 연결 여부는 AI 점검의 '${factor('sameAs')?.name}' 항목에 들어갑니다.`, 0.55);
    }
}

// AI 검색: (정보) —AI 점검에 들어감→ (점검 항목), (정보) —질문의 답이 됨→ (AI가 묻는 질문),
//          (정보) —비어 있어 답하지 못함→ (질문), (점검 항목) —AI 준비 점수를 낮춤→ (AI 서비스)
const GEO_SOURCES = {
    entity: [['ops:hours', '영업시간 등록 여부']],
    sources: [['rv:blog', '블로그·카페 리뷰 수'], ['ac:blog', '최근 30일 블로그 리뷰 수']],
    reviews: [['rv:visitor', '방문자 리뷰 수'], ['rv:score', '평점 표시 여부'], ['rv:text', '글 리뷰 비율']],
    freshness: [['ac:week', '최근 방문자 리뷰'], ['ac:feed', '마지막 소식 날짜']],
    naverAi: [['rv:briefing', '네이버 AI 브리핑 노출 여부'], ['ac:coupon', '쿠폰 수']],
    sameAs: [['ops:links', '연결한 채널 수']],
    atomic: [['ops:subway', '가까운 역 정보']],
    structured: [['ops:menu', '메뉴의 가격·설명'], ['ops:conv', '편의시설 정보']],
    multiturn: [['pos:price', '가격 정보'], ['ops:booking', '네이버 예약 여부']],
    qna: [['ac:reply', '리뷰 답글률'], ['ac:feed', '최근 소식']],
};

function linkGeo(ctx) {
    const { g, place, activity, rows } = ctx;
    if (!ctx.geo) return;
    const { factors, questions, platformNodes, aeo } = ctx.geo;
    const scoreText = (factor) => (isKnown(factor.pct) ? `(지금 ${factor.pct}점)` : '(지금은 확인 불가)');

    for (const [key, sources] of Object.entries(GEO_SOURCES)) {
        const found = factors.get(key);
        if (!found) continue;
        for (const [source, what] of sources) {
            g.relate(source, 'feeds', found.id, `AI 점검의 '${found.name}' 항목${scoreText(found.factor)}에 ${what}${p(what, '이', '가')} 들어갑니다.`, 0.5);
        }
    }

    // 대표키워드가 손님 리뷰·AI 브리핑 표현과 겹치는지
    const consistency = keywordConsistency(place, activity);
    const keywordFactor = factors.get('keywords');
    if (keywordFactor) {
        for (const checked of consistency.checked) {
            const kw = ctx.kwByKey.get(compact(checked.keyword));
            if (!kw) continue;
            g.relate(kw.id, 'feeds', keywordFactor.id, checked.matched
                ? `등록 키워드 ${q(checked.keyword)}의 핵심 낱말이 손님 리뷰·AI 브리핑·업종 표현과 겹쳐 '${keywordFactor.name}' 점수에 반영됩니다.`
                : `등록 키워드 ${q(checked.keyword)}의 핵심 낱말을 손님 리뷰·AI 브리핑·업종 표현에서 찾지 못했습니다.`, checked.matched ? 0.55 : 0.4);
        }
    }

    // 검색 순위 → 대표키워드 순위 항목
    // 항목 점수는 순위를 조회한 키워드들의 점수를 평균한 값입니다(lib/place-geo.js 의 searchShare). 평균에 든 키워드를 모두 잇고,
    // 이 키워드의 몫(배지 '3위 → 55점')과 항목 점수(그 점의 sub '15점')가 서로 다른 값임을 문장에 적습니다.
    const competition = factors.get('competition');
    if (competition) {
        const ranked = rows.filter(isDone);
        const basis = ranked.length > 1 ? `항목 점수는 순위를 조회한 키워드 ${ranked.length}개의 평균입니다.` : '순위를 조회한 키워드가 하나뿐이라 이 값이 그대로 항목 점수입니다.';
        for (const row of ranked) {
            const kw = ctx.kwByKey.get(compact(row.keyword));
            if (!kw) continue;
            const points = rankSharePoints(row.result.status === 'found' ? row.result.rank : null);
            // 순위는 내 매장의 것임을 적습니다(같은 카드에 경쟁 매장의 순위도 나올 수 있음).
            const mine = myRankText(row.result);
            const subject = mine ? `${q(row.keyword)}에서 내 순위 ${mine}${p(mine, '은', '는')}` : `${q(row.keyword)} 목록에 내 매장이 없는 것은`;
            g.relate(kw.id, 'feeds', competition.id, `${subject} AI 점검의 '${competition.name}' 항목에서 ${points}점으로 칩니다. ${basis}`,
                0.3 + 0.4 * (points / 100), { badge: mine ? `내 ${mine} → ${points}점` : `내 매장 없음 → ${points}점` });
        }
    }

    // AI가 묻는 질문 묶음 → AI 답변 준비 점수
    const fanoutFactor = aeo.factors.find((factor) => factor.key === 'fanout');
    if (fanoutFactor) {
        g.relate('geo:fanout', 'feeds', 'aeo:score', `'AI 답변 준비' 점수에서 가장 크게 치는 항목(${fanoutFactor.fullWeight}점)이 이 질문들에 답할 수 있는지입니다${isKnown(fanoutFactor.pct) ? `. 지금 ${fanoutFactor.pct}점입니다` : ''}.`, 0.7);
    }

    // 질문과 그 답에 쓰이는 정보. [점, 지금 답에 쓰이는지] — buildFanout 이 답을 만드는 조건과 같게 가립니다.
    //   쓰이면            (정보) —질문의 답이 됨→ (질문)
    //   비어 있어 못 쓰면  (정보) —비어 있어 답하지 못함→ (질문): 이 질문에 답하려면 채워야 하는 것
    const detail = place.detail || null;
    const pos = detail?.pos;
    const statusOf = (key) => questions.get(key)?.item.status;
    const answers = {
        location: [['ops:subway', true]],
        hours: [['ops:hours', statusOf('hours') === 'yes']],
        price: [pos?.averagePrice?.total ? ['pos:price', true] : ['ops:menu', statusOf('price') === 'partial']],
        signature: [list(place.reviewMenus).length ? ['rv:menu', true] : list(pos?.popularMenus).length ? ['pos:menu', true] : ['ops:menu', statusOf('signature') === 'partial']],
        reputation: [statusOf('reputation') === 'yes' ? ['rv:vote', true] : ['rv:visitor', statusOf('reputation') === 'partial']],
        parking: [['ops:parking', detail?.parking?.available === true], ['ops:conv', true]],
        booking: [['ops:booking', detail?.hasBooking === true]],
        payment: [['ac:coupon', (activity?.coupons?.total || 0) > 0]],
    };
    for (const [key, sources] of Object.entries(answers)) {
        const found = questions.get(key);
        // 업종 때문에 해당 없는 질문(place-industry.js)은 "비어 있어 답하지 못함"으로 잇지 않습니다
        if (!found || found.item.notApplicable) continue;
        for (const [source, used] of sources) {
            if (used) g.relate(source, 'answers', found.id, `AI가 나눠 묻는 "${found.item.question}"의 답에 이 정보가 쓰입니다.`, 0.55);
            else g.relate(source, 'missingFor', found.id, `AI가 나눠 묻는 "${found.item.question}"에 이 정보로는 아직 답하지 못합니다. 채우면 답할 수 있습니다.`, 0.6);
        }
    }

    // AI 서비스마다 준비 점수를 가장 낮추는 항목(80점 미만, 낮은 순 2개)
    for (const { id, platform } of platformNodes) {
        const weak = [...factors.values()]
            .filter(({ factor }) => list(factor.platforms).includes(platform.key) && isKnown(factor.pct) && factor.pct < 80)
            .sort((a, b) => a.factor.pct - b.factor.pct || b.factor.fullWeight - a.factor.fullWeight)
            .slice(0, 2);
        for (const found of weak) {
            g.relate(found.id, 'weakens', id, `${platform.short} 준비 점수에 들어가는 항목 가운데 '${found.name}'${p(found.name, '이', '가')} ${found.factor.pct}점으로 낮습니다.`, 0.4 + 0.4 * (1 - found.factor.pct / 100));
        }
    }
}

// (AI 브리핑 문장) —문장에서 말함→ (문장에 나온 메뉴·주제), (시간대가 들어간 키워드) —같은 시간대→ (그 시간대 평균 결제)
const SLOT_WORDS = [['morning', '아침'], ['lunch', '점심'], ['dinner', '저녁']];

function linkExtras(ctx) {
    const { g } = ctx;
    for (const { id, sentence } of ctx.briefing) {
        const text = compact(sentence);
        let made = 0;
        const named = [...ctx.reviewMenus.values(), ...ctx.themes.values(), ...[...ctx.posMenus.values()].map((entry) => ({ id: entry.id, label: entry.name }))];
        for (const entry of named) {
            if (made >= 2) break;
            const word = compact(entry.label);
            if (word.length >= 2 && text.includes(word) && g.relate(id, 'mentions', entry.id, `네이버 AI 브리핑 문장에 ${q(entry.label, '이', '가')} 나옵니다.`, 0.5)) made += 1;
        }
    }
    for (const [key, word] of SLOT_WORDS) {
        const slot = ctx.priceSlots.get(key);
        if (!slot) continue;
        for (const entry of ctx.keywords) {
            if (entry.key.includes(word)) g.relate(entry.id, 'atTime', slot.id, `${q(entry.word)}의 '${word}' 시간대 1회 평균 결제는 ${won(slot.value)}입니다(최근 1주 네이버 결제 기준).`, 0.5);
        }
    }
}

/* ───────── 마무리: 연결을 다 만든 뒤에야 알 수 있는 값(실제 연결 수로 세는 숫자, 먼저 보여 줄 점, 한 문장 요약) ───────── */

function finishGraph(ctx) {
    const { g, rows, actions } = ctx;
    const count = (rel, side) => {
        const map = new Map();
        for (const link of g.links) if (link.rel === rel) map.set(link[side], (map.get(link[side]) || 0) + 1);
        return map;
    };

    // 키워드마다 "이 키워드를 등록한 매장" 수를 실제 연결 수로 적습니다(카드의 조각 수와 같게).
    // 경쟁 매장의 대표키워드를 읽지 않았으면 다른 매장이 등록했는지 알 수 없으므로 적지 않습니다.
    const registeredBy = count('registers', 'target');
    const rivalsRead = (ctx.rivalInfo?.withKeywords || 0) > 0;
    for (const entry of ctx.keywords) {
        const node = g.byId.get(entry.id);
        if (!node) continue;
        const total = registeredBy.get(entry.id) || 0;
        let value = null;
        if (rivalsRead) value = entry.registered ? (total <= 1 ? '1곳(내 매장만)' : `${total}곳(내 매장 포함)`) : `${total}곳`;
        const list4 = facts(...entry.factHead, value ? { label: '이 키워드를 등록한 매장', value } : null, ...entry.factTail);
        if (list4.length) node.facts = list4;
        else delete node.facts;
    }

    // 경쟁 매장 묶음: 내 위에 있는 매장 수도 실제 연결로 셉니다.
    const outranking = count('outranks', 'source');
    const above = outranking.size;
    const repeated = [...outranking.values()].filter((n) => n >= 2).length;
    const hub = g.byId.get('hub:rival');
    if (hub && ctx.rivalInfo) {
        const info = ctx.rivalInfo;
        hub.facts = facts(
            { label: info.ranked ? '상위 10곳에 나온 매장' : '대표키워드를 읽은 매장', value: `${formatNumber(info.found)}곳` },
            info.ranked ? { label: '내 위에 있는 매장', value: `${above}곳`, tone: above ? 'warn' : undefined } : null,
            info.ranked ? { label: '키워드 2개 이상에서 내 위에 있는 매장', value: `${repeated}곳`, tone: repeated ? 'warn' : undefined } : null,
            info.ranked && info.withKeywords ? { label: '대표키워드를 읽은 매장', value: `${info.withKeywords}곳` } : null,
        );
    }

    // 쉬는 화면에서 먼저 이름을 띄울 점(spot). 문제부터:
    //  1·2 순위가 가장 나쁜 키워드 · 3·4 가장 많은 키워드에서 내 위에 있는 경쟁 매장 · 5 가장 급한 할 일 · 6 가장 잘하고 있는 키워드(10위 안)
    // 해당하는 데이터가 없으면 그 번호는 비워 둡니다.
    const spot = (id, n) => {
        const node = id ? g.byId.get(id) : null;
        if (node && !node.spot) node.spot = n;
    };
    const ranked = ctx.keywords.filter((entry) => isDone(entry.row) && g.has(entry.id));
    const rankOf = (entry) => (entry.row.result.status === 'found' ? entry.row.result.rank : 100000);
    const best = ranked.filter((entry) => rankOf(entry) <= 10).sort((a, b) => rankOf(a) - rankOf(b) || a.index - b.index)[0] || null;
    ranked.filter((entry) => entry !== best).sort((a, b) => rankOf(b) - rankOf(a) || a.index - b.index).slice(0, 2).forEach((entry, i) => spot(entry.id, i + 1));
    ctx.rivalNodes.filter((rival) => outranking.has(rival.id))
        .map((rival, order) => ({ rival, order }))
        .sort((a, b) => outranking.get(b.rival.id) - outranking.get(a.rival.id) || a.order - b.order)
        .slice(0, 2).forEach(({ rival }, i) => spot(rival.id, i + 3));
    spot(ctx.todos[0]?.id, 5);
    spot(best?.id, 6);

    // 한 문장 요약. 요약 칸과 같은 숫자를 씁니다(10위 안 개수, 할 일 수). 데이터가 없는 마디는 뺍니다.
    const parts = [];
    if (rows.length > 0) {
        const settled = rows.every((row) => row.state !== 'loading');
        const top10 = rows.filter((row) => isDone(row) && row.result.status === 'found' && row.result.rank <= 10).length;
        parts.push(settled ? `키워드 ${rows.length}개 중 ${top10}개가 10위 안` : `키워드 ${rows.length}개 순위 조회 중`);
    }
    parts.push(actions.length ? `할 일 ${actions.length}개` : '할 일 없음');
    if (repeated > 0) parts.push(`키워드 2개 이상에서 내 위에 있는 매장 ${repeated}곳`);
    else if (above > 0) parts.push(`내 위에 있는 매장 ${above}곳`);
    return parts.join(' · ');
}

/* ───────── 한 번에 ───────── */

// 매장 1곳의 분석 결과 → { nodes, links, headline }
//   place          분석한 매장(없으면 빈 화면용 골격을 돌려줍니다)
//   activity       리뷰·소식 활동(없으면 null)
//   ranks          화면의 순위 조회 상태 [{ keyword, state: 'loading'|'done'|'error', result }]
//   rivals         키워드별로 읽은 경쟁 매장 대표키워드 { [keyword]: { loading, items } }
//   rivalPool      이 매장에서 읽어 둔 경쟁 매장 대표키워드 모음 [{ placeId, name, keywords }]
//   recommendation recommendKeywords() 결과
//   actions        buildActionItems() 결과
//   nowMs          "며칠 전" 표기와 최신성 점수의 기준 시각(테스트에서 고정)
//   limits         GRAPH_LIMITS 일부를 바꿀 때
//   audit          배열을 넘기면 온톨로지에 맞지 않아 버린 점·연결을 적어 줍니다(테스트·점검용. 정상이면 빈 배열)
export function buildPlaceGraph({
    place, activity = null, ranks = [], rivals = null, rivalPool = [], recommendation = null, actions = [], nowMs = Date.now(), limits = null, audit = null,
} = {}) {
    if (!place) return buildIdleGraph(false);
    const g = createGraph(Array.isArray(audit) ? audit : null);
    const ctx = {
        g, place, activity: activity || null, recommendation: recommendation || null, rivals, nowMs,
        rows: list(ranks).filter((row) => typeof row.keyword === 'string' && row.keyword.trim()),
        rivalPool: list(rivalPool),
        actions: list(actions),
        cap: { ...GRAPH_LIMITS, ...(limits || {}) },
        item: itemWord(place),
    };

    g.add({
        id: 'store', group: 'store', type: 'store', label: shortenLabel(place.name, 16), full: place.name, sub: shorten(place.category, 18), weight: 1,
        detail: '네이버 플레이스에 등록된 내 매장입니다. 숫자는 플레이스 화면에 공개된 값입니다.',
        go: null, target: 'sec-summary',
        facts: facts(
            { label: '방문자 리뷰', value: `${formatNumber(place.visitorReviews)}개` },
            { label: '블로그·카페 리뷰', value: `${formatNumber(place.blogReviews)}개` },
            place.visitorScore ? { label: '평점', value: `${place.visitorScore.toFixed(2)}점` } : null,
            Array.isArray(place.keywords) ? { label: '대표키워드', value: `${place.keywords.length}/5개` } : null,
        ),
    });

    buildSearch(ctx);
    buildRivals(ctx);
    buildVoice(ctx);
    buildActivity(ctx);
    buildPay(ctx);
    buildTodo(ctx);
    buildOps(ctx);
    buildGeo(ctx);

    linkRegisters(ctx);
    linkRanks(ctx);
    linkSupports(ctx);
    linkSpoken(ctx);
    linkRegions(ctx);
    linkRankGaps(ctx);
    linkSameMenus(ctx);
    linkTodos(ctx);
    linkGeo(ctx);
    linkExtras(ctx);

    g.trim(ctx.cap.total);
    const headline = finishGraph(ctx);
    return { nodes: g.nodes, links: g.links, headline };
}

/* ───────── 데이터가 없을 때의 골격(실제 데이터처럼 보이지 않게 ghost 로 둡니다) ───────── */

// 묶음마다 하나씩, 실제 그래프와 같은 이름으로 둡니다.
const IDLE_GROUPS = ['search', 'rival', 'voice', 'pay', 'todo', 'ops', 'geo'];

export function buildIdleGraph(loading) {
    const nodes = [{
        id: 'store', level: 0, group: 'store', ghost: !loading, label: loading ? '조회 중' : '내 매장',
        detail: loading ? '네이버 플레이스에서 매장 정보를 읽고 있습니다' : '주소를 넣고 분석하면 내 매장 데이터로 채워집니다',
        aria: '플레이스 주소 입력으로 이동', parent: null,
    }];
    const links = [];
    IDLE_GROUPS.forEach((group, index) => {
        const id = `idle:${index}`;
        const label = ONTOLOGY.groups[group].label;
        nodes.push({ id, level: 1, group, label, ghost: true, detail: loading ? '불러오는 중' : '주소를 넣으면 채워집니다', aria: `${label}: 주소를 넣으면 채워집니다`, parent: 'store' });
        links.push({ id: `${id}>store`, source: id, target: 'store' });
        for (let j = 0; j < 2; j += 1) {
            const leaf = `${id}:${j}`;
            nodes.push({ id: leaf, level: 2, group, ghost: true, parent: id });
            links.push({ id: `${leaf}>${id}`, source: leaf, target: id });
        }
    });
    return { nodes, links };
}

// 그래프 한 장의 크기를 묶음·연결 종류별로 셉니다(테스트·점검용).
export function summarizeGraph(graph) {
    const nodes = list(graph?.nodes);
    const links = list(graph?.links);
    const tally = (items, keyOf) => items.reduce((acc, item) => {
        const key = keyOf(item) || '-';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const cross = links.filter((link) => link.kind === 'cross');
    return {
        nodes: nodes.length,
        links: links.length,
        cross: cross.length,
        groups: tally(nodes, (node) => node.group),
        levels: tally(nodes, (node) => String(node.level)),
        types: tally(nodes, (node) => node.type),
        rels: tally(links, (link) => link.rel),
    };
}
