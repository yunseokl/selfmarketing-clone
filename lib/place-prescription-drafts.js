// 플레이스 처방전의 "바로 쓸 초안" — 리뷰 답글·소식·소개글·메뉴 설명 틀·키워드 예문.
// 화면·브라우저·네트워크에 기대지 않는 순수 함수입니다. 같은 입력이면 늘 같은 글이 나옵니다.
//
// 지키는 것
//  - 매장 자료에 있는 사실(상호·주소·가까운 역·영업시간·편의시설·메뉴 이름과 가격·리뷰에서 손님이 고른 말)만 씁니다.
//    모르는 칸은 "(직접 적기)"로 남기고, 할인·이벤트·수상·원산지·효능 같은 말은 지어 넣지 않습니다.
//  - 기존 생성기를 그대로 씁니다: 리뷰 답글은 lib/review-reply.js 의 generateReplies(결정론적 문장 조합),
//    소개글은 lib/place-geo.js 의 원자 답변과 같은 사실(주소·역·영업시간·리뷰에서 꼽힌 점)을 손님 말투로, 소식의 질문형 제목은 lib/place-geo-quick.js 와 같은 모양.
//  - 손님이 읽는 글(소식·소개글·답글·예문)에는 내부 숫자(결제 집계·리뷰 수·블로그 n/m·점수)를 쓰지 않습니다.
//  - 다 만든 글은 정책 점검(checkPolicy)과 광고성 표현 점검(findHypeWords)을 거치고, 걸리면 그 초안을 뺍니다.
//  - lib/copy-generator.js 의 generateCopy 는 이모지·"존맛탱" 같은 해시태그와 과장 문구를 섞어 만들어 쓰지 않습니다.

import { generateReplies, checkPolicy } from './review-reply.js';
import {
    placeCriteria, categoryLabel, placeArea, findHypeWords, josa, healthWords,
} from './place-geo.js';
import { familyOf, searchCategoryWord, headlineMenuTerms } from './place-keywords.js';
import { itemWord as baseItemWord } from './place-graph.js';

// 등록해 둘 것의 이름: 약국·병원 계열은 AI 검색 진단(place-geo.js)과 같은 말(취급 품목·서비스 / 진료 과목·서비스), 그 밖은 메뉴·시술·메뉴·서비스.
function itemWord(place) {
    return healthWords(place)?.item || baseItemWord(place);
}

export const DRAFT_MARK = '초안 — 우리 매장 사실에 맞게 고쳐 쓰세요';

// 약국·병의원·동물병원은 '매장'이 아니라 그 업종의 말로(약국 / 병·의원 / 병원). 그 밖의 업종은 DRAFT_MARK 그대로.
const DRAFT_PLACE_WORD = { pharmacy: '약국', clinic: '병·의원', pet: '병원' };

export function draftMarkFor(place) {
    const word = DRAFT_PLACE_WORD[familyOf(place)?.key];
    return word ? DRAFT_MARK.replace('우리 매장', `우리 ${word}`) : DRAFT_MARK;
}
export const BLANK = '(직접 적기)';

// 초안에 들어가면 안 되는 말(자료에 없는 혜택·행사·수상·원산지·효능). 테스트도 이 목록으로 확인합니다.
export const INVENTED_WORDS = [
    '할인', '이벤트', '증정', '사은품', '특가', '1+1', '오픈 기념', '무료 제공', '수상', '선정', '원산지', '국내산', '유기농',
    '효능', '효과', '완치', '치료', '개선됩니다', '최고', '1위', '1등', '유일', '최초', '역대급', '존맛',
];

const FEED_MAX = 3;
export const MENU_FRAMES_MAX = 5;
const REPLY_FACTS_MAX = 2;
const INTRO_MAX = 6;
const VOTES_SHOWN = 3;
const VOTES_SHOWN_RELEVANT = 4;

function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function compact(text) {
    return String(text ?? '').replace(/\s+/g, '').toLowerCase();
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

// 한국 시각의 달(1~12)
function monthOf(ms) {
    return new Date(ms + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
}

// 리뷰 답글 도우미의 업종 갈래. 약국은 '기타'로 만들고 점검만 의료 기준(효능 표현)으로 합니다.
const REPLY_INDUSTRY = { restaurant: 'restaurant', bar: 'restaurant', cafe: 'cafe', hair: 'beauty', nail: 'beauty', skin: 'beauty', clinic: 'clinic' };

function replyIndustry(place) {
    return REPLY_INDUSTRY[familyOf(place)?.key] || 'etc';
}

// 약국·병원은 효능을 단정하는 표현까지 막습니다(checkPolicy 의 의료 규칙).
function policyIndustry(place) {
    const key = familyOf(place)?.key;
    return key === 'pharmacy' || key === 'clinic' ? 'clinic' : replyIndustry(place);
}

// 초안 한 편이 정책·과장·지어낸 말 점검을 통과하는지. 안내(info)는 문제로 보지 않습니다.
// 매장 자료에 원래 있는 말(예: 상호에 든 낱말, 사장님이 등록한 예약 혜택·쿠폰 이름)은 지어낸 말로 보지 않습니다.
//   extra: 그 밖에 자료에 있는 글(쿠폰 이름 등)
export function draftProblems(text, place, extra = []) {
    const value = String(text ?? '');
    const source = compact([
        place?.name, place?.category, place?.intro, ...list(place?.keywords),
        ...list(place?.detail?.menus).map((menu) => menu.name), ...list(place?.reviewVotes).map((vote) => vote.label),
        ...list(place?.conveniences), ...list(place?.detail?.facilities),
        place?.detail?.bookingPromotion, ...list(place?.detail?.benefits).filter((entry) => typeof entry === 'string'),
        ...list(extra),
    ].filter(Boolean).join(' '));
    const problems = checkPolicy(value, { industry: policyIndustry(place) })
        .filter((finding) => finding.severity !== 'info')
        .map((finding) => `${finding.phrase}: ${finding.reason}`);
    for (const hype of findHypeWords([{ where: '초안', text: value }])) {
        if (!source.includes(compact(hype.word))) problems.push(`광고성 표현 '${hype.word}'`);
    }
    for (const word of INVENTED_WORDS) {
        if (compact(value).includes(compact(word)) && !source.includes(compact(word))) problems.push(`자료에 없는 말 '${word}'`);
    }
    return uniq(problems);
}

// 글 조각(제목·본문·한 줄 소개)은 따로따로 점검합니다. 이어 붙이면 "…안내 손님 리뷰…"처럼 조각 경계가 사람 이름으로 잘못 잡힙니다.
function passes(texts, place, extra = []) {
    return (Array.isArray(texts) ? texts : [texts]).every((text) => draftProblems(text, place, extra).length === 0);
}

// 사장님이 이미 등록한 혜택(쿠폰 이름) — 소식·소개글에 그대로 옮길 수 있는 사실
function couponTitles(activity) {
    return list(activity?.coupons?.titles).map((title) => String(title).trim()).filter(Boolean);
}

// 네이버 예약 혜택: 자료의 글을 그대로 옮깁니다("네이버 예약 첫 방문 10~20% 차등 할인 (드라이X)" → "네이버 예약 혜택 — 첫 방문 …").
function bookingBenefit(place) {
    const promo = String(place?.detail?.bookingPromotion || '').trim();
    if (!promo) return null;
    return `네이버 예약 혜택 — ${promo.replace(/^네이버\s*예약\s*/, '')}`;
}

/* ───────── 업종에 맞는 사실만 ───────── */

// 업종마다 어울리지 않는 매장 조건은 초안에서 뺍니다(약국·병원에 '단체 이용 가능·포장·반려동물 동반', 미용·네일·피부에 '단체 이용 가능·포장').
const CRITERIA_SKIP = {
    pharmacy: ['group', 'takeout', 'pet'],
    clinic: ['group', 'takeout', 'pet'],
    hair: ['group', 'takeout'],
    nail: ['group', 'takeout'],
    skin: ['group', 'takeout'],
};

function fitCriteria(place) {
    const skip = CRITERIA_SKIP[familyOf(place)?.key] || [];
    return placeCriteria(place).filter((criterion) => !skip.includes(criterion.key));
}

// 약국·병원은 '추천?' 같은 질문형 제목 대신 위치·영업시간을 알리는 제목을 씁니다.
function medicalFamily(place) {
    const key = familyOf(place)?.key;
    return key === 'pharmacy' || key === 'clinic';
}

// 5칸에 새로 넣는 낱말([{ keyword, term, region, kinds }])을 초안에 쓰는 순서로: 마지막 소식·메뉴판에서 나온 낱말(근거 종류 'board')을 먼저, 그다음은 5칸 순서대로
function orderedFocus(focus) {
    const board = (entry) => (Array.isArray(entry?.kinds) && entry.kinds.includes('board') ? 1 : 0);
    return (Array.isArray(focus) ? focus.filter(Boolean) : []).sort((a, b) => board(b) - board(a));
}

const FOOD_FAMILIES = new Set(['restaurant', 'cafe', 'bar']);
const MEDICAL_KINDS = new Set(['clinic', 'pet']); // 병·의원·동물병원: '매장'·'들러' 대신 그 업종의 말
const BEAUTY_FAMILIES = new Set(['hair', 'nail', 'skin']);

// 손님이 고른 좋은 점 가운데 업종에서 중요한 말을 먼저(약국: 복약지도·상담·재고, 미용: 스타일 추천·꼼꼼·관리). 나머지는 많이 고른 순.
const VOTE_PRIORITY = {
    pharmacy: /복약|약사|상담|설명|재고|제품|꼼꼼/,
    clinic: /상담|설명|꼼꼼|진료|친절/,
    hair: /스타일|시술|꼼꼼|관리|디자이너|추천/,
    nail: /디자인|꼼꼼|관리|추천/,
    skin: /관리|꼼꼼|상담|피부/,
};

function votePhrases(place) {
    const family = familyOf(place)?.key;
    const rule = VOTE_PRIORITY[family] || null;
    const votes = list(place?.reviewVotes);
    const relevant = rule ? votes.filter((vote) => rule.test(vote.label)) : [];
    const max = relevant.length ? VOTES_SHOWN_RELEVANT : VOTES_SHOWN;
    const picked = [...relevant.slice(0, 2), ...votes.filter((vote) => !relevant.slice(0, 2).includes(vote))].slice(0, max);
    // 많이 고른 순으로 되돌려 읽기 좋게
    return votes.filter((vote) => picked.includes(vote)).map((vote) => `'${vote.label}'`);
}

function parseWon(text) {
    return [...String(text ?? '').matchAll(/([\d,]+)\s*원/g)].map((match) => Number(match[1].replace(/,/g, ''))).filter((value) => Number.isFinite(value) && value > 0);
}

function wonText(value) {
    return `${value.toLocaleString('ko-KR')}원`;
}

// 메뉴판(가격이 적힌 메뉴)의 가격 범위: 2개 이상 메뉴에 가격이 있을 때만. 음식점은 메뉴 가격 폭이 커서 싣지 않습니다.
export function priceRange(place) {
    if (FOOD_FAMILIES.has(familyOf(place)?.key)) return null;
    const prices = menuEntries(place).flatMap((menu) => parseWon(menu.price));
    if (prices.length < 2) return null;
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return low === high ? null : { low, high, text: `${wonText(low)}~${wonText(high)}` };
}

// 가장 붐비는 때(요일·시간) — 주간 이용 자료(결제 집계)를 손님이 읽는 말로 바꿉니다. 자료의 이름은 글에 쓰지 않습니다.
// 가장 붐비는 요일(busiestDay)과 그 요일 자료의 붐비는 시각(peakHour)이 둘 다 있을 때만 씁니다.
export function busyTime(place) {
    const pos = place?.detail?.pos;
    const busiest = String(pos?.busiestDay || '').trim();
    const day = Array.isArray(pos?.weekly) ? pos.weekly.find((entry) => entry && String(entry.day || '').trim() === busiest) : null;
    const hour = day?.peakHour;
    if (!busiest || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    return `${busiest}요일, ${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}시 무렵`;
}

/* ───────── 메뉴(시술) 고르기 ───────── */

function menuEntries(place) {
    return list(place?.detail?.menus)
        .filter((menu) => String(menu.name || '').trim())
        // description: 그 메뉴에 이미 적힌 설명 글(조회 자료에 이 필드가 있을 때만). 글이 있으면 그 문장, 필드는 있는데 비어 있으면(null) ''(설명 없음이 확인됨),
        //   필드 자체가 없으면(옛 자료) undefined = 어느 메뉴에 설명이 있는지 모름
        .map((menu) => ({
            name: String(menu.name).trim(),
            price: String(menu.price || '').trim() || null,
            description: typeof menu.description === 'string' ? menu.description.trim() : (menu.description === null ? '' : undefined),
        }));
}

// 이름이 같은 메뉴(또는 이름에 그 낱말이 들어 있고 몇 글자만 더 붙은 메뉴)를 찾습니다. 다른 메뉴의 가격을 잘못 붙이지 않으려고 넓게 찾지 않습니다.
function findMenu(menus, name) {
    const key = compact(name);
    if (key.length < 2) return null;
    return menus.find((menu) => compact(menu.name) === key)
        || menus.find((menu) => {
            const value = compact(menu.name);
            return value.includes(key) && value.length <= key.length + 3 && !value.includes('+');
        })
        || null;
}

// 키워드 추천이 '주력 메뉴가 아니다'로 뺀 낱말(곁들임·다른 업종·술·음료·뜻이 넓은 말·겹치는 말).
// 초안의 대표 메뉴도 같은 판정을 따라, 키워드 처방에서 뺀 메뉴를 초안에서 앞세우지 않게 합니다.
const NOT_MAIN_RULES = new Set(['offMain', 'otherBusiness', 'extra', 'drink', 'vague', 'broad', 'merged']);

export function notMainTerms(recommendation) {
    return list(recommendation?.excluded)
        .filter((entry) => NOT_MAIN_RULES.has(entry.rule) && compact(entry.term).length >= 2)
        .map((entry) => compact(entry.term));
}

// 음식점에서는 술·음료를 대표 메뉴로 앞세우지 않습니다(카페·술집은 그것이 주력이라 그대로 둠).
const DRINK = /맥주|소주|와인|막걸리|하이볼|사케|음료|콜라|사이다|에이드/;

// 손님이 많이 찾는 메뉴(시술) — 자료 한 가지에서만 고르고 그 출처를 함께 돌려줍니다(문장에 출처를 정확히 쓰려고).
//   pos: 최근 1주 네이버 결제 · style: 네이버 예약 · review: 리뷰 언급
//   - 주력이 아닌 낱말(notMain)이 든 메뉴는 뺍니다.
//   - 그 출처의 가장 많은 것의 1/3 미만인 것은 뺍니다(리뷰에 몇 번 나온 곁들임이 대표처럼 보이지 않게).
//   - 2개 이상 남는 첫 출처를 고르고, 없으면 1개라도 남는 첫 출처.
export function popularItems(place, max = 3, { notMain = [] } = {}) {
    const menus = menuEntries(place);
    const food = familyOf(place)?.key === 'restaurant';
    const sources = [
        ['pos', list(place?.detail?.pos?.popularMenus).map((menu) => [menu.name, menu.count])],
        ['style', list(place?.detail?.styles).map((style) => [style.name, style.count])],
        ['review', list(place?.reviewMenus).map((menu) => [menu.label, menu.count])],
    ];
    const blocked = (name) => notMain.some((term) => compact(name).includes(term)) || (food && DRINK.test(name));
    const candidates = sources.map(([source, rows]) => {
        const top = Math.max(0, ...rows.map(([, count]) => (Number.isFinite(count) ? count : 0)));
        const names = uniq(rows
            .filter(([name, count]) => String(name || '').trim() && !blocked(name) && !(top > 0 && Number.isFinite(count) && count * 3 < top))
            .map(([name]) => String(name).trim()));
        const counts = new Map(rows.map(([name, count]) => [String(name || '').trim(), Number.isFinite(count) ? count : null]));
        return { source, names: names.slice(0, max), counts };
    });
    const chosen = candidates.find((entry) => entry.names.length >= 2) || candidates.find((entry) => entry.names.length >= 1);
    if (!chosen) return { source: null, items: [] };
    return {
        source: chosen.source,
        // 가격은 낱말과 메뉴 이름이 정확히 같을 때만 붙입니다("숙성회"에 "모듬숙성회"의 가격을 붙이지 않음).
        items: chosen.names.map((name) => {
            const menu = menus.find((entry) => compact(entry.name) === compact(name)) || null;
            return { name: menu ? menu.name : name, price: menu?.price || null, count: chosen.counts.get(name) ?? null };
        }),
    };
}

// 손님이 읽는 글이라 '결제·예약 자료' 같은 내부 표현 대신 손님 말투로 씁니다(고르는 근거는 그대로 그 자료).
const POPULAR_LEAD = {
    pos: (item) => `요즘 많이 찾는 ${item}`,
    style: (item) => `요즘 예약이 많은 ${item}`,
    review: (item) => `손님 리뷰에 자주 나오는 ${item}`,
};

// 메뉴판 이름은 그대로 두되 "(한정)활 전갱이회"처럼 붙어 읽기 어려운 머리표만 띄어 줍니다.
export function tidyMenuName(name) {
    return String(name ?? '').replace(/^(\((?:한정|제철|신메뉴|추천)\))(?=\S)/, '$1 ');
}

// 이름 끝에 이미 괄호가 있으면("맛보기보쌈(100g)") 괄호를 겹치지 않고 띄어 적습니다("맛보기보쌈(100g) 15,000원").
export function withPrice(entry) {
    const name = tidyMenuName(entry.name);
    if (!entry.price) return name;
    return /\)$/.test(name) ? `${name} ${entry.price}` : `${name}(${entry.price})`;
}

function stationText(place) {
    const subway = place?.detail?.subway;
    if (!subway?.station) return null;
    const station = String(subway.station).endsWith('역') ? subway.station : `${subway.station}역`;
    if (!subway.walkMinutes) return null;
    return `${station}${subway.exit ? ` ${subway.exit}번 출구` : ''}에서 걸어서 ${subway.walkMinutes}분입니다.`;
}

// 매장 화면으로 확인되는 조건(주차·예약·늦게까지·역 가까움 등)의 짧은 말
function criteriaLabels(place, keys = null) {
    const all = fitCriteria(place);
    const picked = keys ? keys.map((key) => all.find((c) => c.key === key)).filter(Boolean) : all;
    return picked.map((c) => c.label);
}

/* ───────── 리뷰 답글 ───────── */

// generateReplies 의 초안 3개 가운데 같은 말(두 글자 이상 낱말)을 덜 되풀이하는 것. 같으면 앞의 것.
function leastRepetitive(drafts) {
    let best = null;
    for (const draft of list(drafts)) {
        const words = String(draft.text).replace(/[^가-힣\s]/g, ' ').split(/\s+/).filter((word) => word.length >= 3).map((word) => word.slice(0, 3));
        const repeats = words.length - new Set(words).size;
        if (!best || repeats < best.repeats) best = { draft, repeats };
    }
    return best?.draft || null;
}

// 매장 화면으로 확인되는 사실(역에서 걸어서 몇 분·주차·네이버 예약·늦게까지 영업)을 답글 끝의 한 문장으로.
//   "무료 주차가 되고 01:00까지 영업하니 다음에도 편하게 들러 주세요."
export function visitInviteSentence(place) {
    const criteria = fitCriteria(place);
    const subway = place?.detail?.subway;
    const station = subway?.station ? (String(subway.station).endsWith('역') ? subway.station : `${subway.station}역`) : null;
    const clauses = [];
    for (const key of ['walk', 'parking', 'booking', 'late']) {
        const c = criteria.find((entry) => entry.key === key);
        if (!c) continue;
        if (key === 'walk' && station) clauses.push(`${station}${subway.exit ? ` ${subway.exit}번 출구` : ''}에서 걸어서 ${subway.walkMinutes}분이`);
        if (key === 'parking') clauses.push(c.label === '무료 주차' ? '무료 주차가 되' : '주차가 되');
        if (key === 'booking') clauses.push('네이버 예약도 되');
        if (key === 'late') clauses.push(`${c.label}하`);
    }
    const picked = clauses.slice(0, REPLY_FACTS_MAX);
    if (picked.length === 0) return null;
    // 병·의원·동물병원은 '들러'가 아니라 '방문해'
    const verb = ['clinic', 'pet'].includes(familyOf(place)?.key) ? '방문해' : '들러';
    return `${picked.join('고 ')}니 다음에도 편하게 ${verb} 주세요.`;
}

const COMPLAINT_SAMPLE = {
    wait: { review: '기다린 시간이 길었어요', type: 'wait', label: '기다린 시간이 길었다는 리뷰' },
    result: { review: '시술 결과가 기대와 달랐어요', type: 'taste', label: '시술 결과가 기대와 달랐다는 리뷰' },
    service: { review: '응대가 아쉬웠어요', type: 'service', label: '응대가 아쉬웠다는 리뷰' },
};
const COMPLAINT_BY_FAMILY = { restaurant: 'wait', cafe: 'wait', bar: 'wait', hair: 'result', nail: 'result', skin: 'result', pharmacy: 'service', clinic: 'service' };

// 리뷰 답글 예시 2개(좋은 리뷰 · 아쉬움을 남긴 리뷰). 실제 리뷰 문장은 받은 자료에 없어 "예시"로 표시합니다.
//   좋은 리뷰: 손님이 가장 많이 고른 좋은 점과, 리뷰에 많이 나온 주력 메뉴(키워드 추천이 주력이 아니라고 뺀 낱말 제외)로 가정합니다.
//   마지막 인사는 매장 화면으로 확인되는 사실을 담은 한 문장으로 바꿉니다(AI가 쓸 답변 문장이 되도록 — place-geo 의 답글 안내와 같은 뜻).
export function replyDrafts(place, { recommendation = null } = {}) {
    if (!place) return null;
    const industry = replyIndustry(place);
    const storeName = String(place.name || '').trim();
    const vote = list(place.reviewVotes)[0]?.label || null;
    const notMain = notMainTerms(recommendation);
    const menu = list(place.reviewMenus).map((entry) => entry.label).find((label) => label && !notMain.some((term) => compact(label).includes(term))) || null;
    const invite = visitInviteSentence(place);
    const drafts = [];

    // 답글 도우미는 리뷰가 5자 이상이어야 초안을 만듭니다('친절해요'처럼 짧은 말도 통과하게 한 문장을 덧붙임).
    const praiseReview = vote ? `${vote}. 좋았습니다.` : '좋았어요, 다음에 또 올게요';
    const praise = leastRepetitive(generateReplies({ industry, storeName, review: praiseReview, sentiment: 'praise', tone: 'polite', mentions: menu ? [menu] : [] }));
    if (praise) {
        const paragraphs = praise.text.split('\n\n');
        // 마지막 문단(다시 오시라는 인사)을 사실을 담은 인사로 바꿉니다. 인사가 둘이 되지 않게 합니다.
        if (invite) paragraphs.splice(paragraphs.length > 2 ? paragraphs.length - 1 : paragraphs.length, 1, invite);
        const picked = vote ? `손님이 '${vote}'${josa(vote, '을', '를').slice(vote.length)} 고르고` : null;
        drafts.push({
            key: 'praise',
            label: vote ? `좋은 리뷰 예시 — ${menu ? `${picked} '${menu}'${josa(menu, '을', '를').slice(menu.length)} 적은` : picked.replace(/ 고르고$/, ' 고른')} 리뷰` : '좋은 리뷰 예시',
            text: paragraphs.join('\n\n'),
        });
    }
    // 아쉬운 리뷰 예시는 업종에 맞는 상황으로: 음식점·카페·술집은 기다린 시간, 미용·네일·피부는 시술 결과, 그 밖(약국·병원 포함)은 응대
    const sample = COMPLAINT_SAMPLE[COMPLAINT_BY_FAMILY[familyOf(place)?.key] || 'service'];
    const complaint = leastRepetitive(generateReplies({ industry, storeName, review: sample.review, sentiment: 'complaint', complaintType: sample.type, tone: 'polite' }));
    if (complaint) drafts.push({ key: 'complaint', label: `아쉬움을 남긴 리뷰 예시 — ${sample.label}`, text: complaint.text.replace(/모두와 공유하겠습니다/g, '직원들과 공유하겠습니다') });

    const items = drafts.filter((draft) => passes(draft.text, place));
    if (items.length === 0) return null;
    return {
        kind: 'reply',
        example: true,
        items,
        // '메뉴'는 음식점의 말이라 그 업종의 말로(시술 / 취급 품목·서비스 / 진료 과목·서비스)
        note: `실제 리뷰 문장은 받은 자료에 없어 예시로 만들었습니다. 리뷰에 적힌 ${itemWord(place)}·상황에 맞게 한두 낱말을 바꿔 쓰세요. 이름·방문 날짜·좌석 번호처럼 손님을 알아볼 수 있는 말은 넣지 마세요.`,
    };
}

/* ───────── 소개글 ───────── */

function sentenceCount(text) {
    return String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

const SHOP_ENDING = /(약국|미용실|헤어|바버샵|샵|집|식당|카페|병원|의원|살롱)$/;

// 사장님이 등록한 대표키워드 가운데 지역이 없는 낱말(예: 약국의 '일반의약품·건강기능식품') — 매장이 다루는 것으로 소개글에 씁니다.
function handledTerms(place, recommendation) {
    const registered = list(recommendation?.registered);
    if (registered.length === 0) return [];
    const base = compact(familyOf(place)?.base?.[0]);
    // 지역이 없다고 확인된 키워드('none', 필드가 없는 옛 자료 포함)만: 지역인지 확인 못 한 'unknown'은 무엇을 다루는 낱말인지 알 수 없어 쓰지 않습니다.
    return registered.filter((entry) => !entry.hasRegion && entry.regionStatus !== 'unknown' && entry.keyword).slice(0, 4).map((entry) => {
        // 분류 이름(건강기능식품)은 손님이 쓰는 말(영양제)을 괄호로 함께 적습니다. 업종 이름 자체('약국')는 덧붙이지 않습니다.
        const spoken = entry.concern?.rule === 'classification' ? String(entry.spoken?.term || '').trim() : '';
        return spoken && compact(spoken) !== base && !SHOP_ENDING.test(spoken) ? `${entry.keyword}(${spoken})` : entry.keyword;
    });
}

// "일반의약품·건강기능식품(영양제)·동물의약품(동물약국)·상비약을 취급합니다." — 손님이 쓰는 말을 함께 적은 한 문장(없으면 null)
function handledSentence(place, recommendation) {
    const handled = handledTerms(place, recommendation);
    if (handled.length === 0) return null;
    const last = handled[handled.length - 1].replace(/\)$/, '');
    return `${handled.join('·')}${josa(last, '을', '를').slice(last.length)} 취급합니다.`;
}

// 매장 종류를 말할 때 쓰는 낱말: 키워드 엔진(place-keywords.js)이 정한 '검색용 업종 낱말'을 그대로 씁니다
// (분류 이름이 넓은 말 — 한식·육류·고기요리·해물·생선요리 등 — 이면 이 매장의 중심 낱말 '횟집', 쓸 만하면 분류 이름 그대로).
// AI 질문·소식 제목·한 줄 소개를 만드는 place-geo.js 와 같은 규칙이라 문서 안에서 말이 어긋나지 않습니다.
export function centerCategory(place) {
    const label = place?.category ? categoryLabel(place) : null;
    if (!label) return null;
    return searchCategoryWord(place) || label;
}

// 소개글 초안(3~6문장) + 한 줄 소개. 손님이 읽는 글이라 내부 숫자(리뷰 수·결제 집계·점수) 없이 손님 말투로 씁니다.
//   ① 어디에 있는 무엇인지 ② 찾아오는 길·주차 ③ 영업시간 ④ 많이 찾는 메뉴(시술) 또는 다루는 것 ⑤ 메뉴판의 가격 범위(음식점 제외)
//   ⑥ 매장 사실(디자이너 수·반려동물 동반 — 자료에 있는 것만) ⑦ 손님 리뷰에서 많이 꼽힌 점(업종에 중요한 강점을 먼저)
//   6문장을 넘으면 덜 중요한 것부터 뺍니다(매장 사실 → 가격 범위 → 찾아오는 길·주차 → 영업시간 → 리뷰에서 꼽힌 점 → 많이 찾는 메뉴 순).
// 모두 매장 화면 자료에 있는 사실이고, 효능·맛 평가·순위는 쓰지 않습니다.
// 조건형 문장(buildCriteriaAnswer)은 업종에 맞지 않는 조건('단체 이용 가능 약국')이 섞일 수 있어 넣지 않습니다.
// 매장 종류를 말하는 낱말: 병·의원·동물병원은 '치과 매장'이 아니라 '치과'
function kindWord(place, category) {
    if (!category) return '매장';
    if (SHOP_ENDING.test(category) || MEDICAL_KINDS.has(familyOf(place)?.key)) return category;
    return `${category} 매장`;
}

// 5칸에 새로 넣는 키워드의 예문(keywordPlacements) 가운데 그 초안에 넣을 것. 같은 문장은 한 번만.
function placementSentences(placements, kind, test) {
    const out = [];
    for (const entry of list(placements)) {
        if (!entry.sentence || entry.kind !== kind || !test(String(entry.where || ''))) continue;
        if (!out.includes(entry.sentence)) out.push(entry.sentence);
    }
    return out;
}

function coveredBy(placements, cover) {
    return list(placements).some((entry) => entry.sentence && entry.covers === cover);
}

export function introDraft(place, activity = null, { recommendation = null, placements = [] } = {}) {
    if (!place) return null;
    const name = String(place.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const category = centerCategory(place);
    const kind = kindWord(place, category);
    // 새 키워드 예문: 지역·업종을 말하는 문장은 소개글 첫 문장으로(주소는 그다음 문장), 사실 문장은 본문 가운데에
    const shopLines = placementSentences(placements, 'shop', (where) => /소개글/.test(where));
    const factLines = placementSentences(placements, 'fact', (where) => /소개글/.test(where));
    const popular = popularItems(place, 3, { notMain: notMainTerms(recommendation) });
    const subway = place.detail?.subway;
    const station = subway?.station ? (String(subway.station).endsWith('역') ? subway.station : `${subway.station}역`) : null;
    const parking = place.detail?.parking;
    const parkingText = parking?.available ? (parking.free === true ? '무료로 주차할 수 있습니다' : '주차할 수 있습니다') : null;
    const access = [
        station && subway.walkMinutes ? `${station}${subway.exit ? ` ${subway.exit}번 출구` : ''}에서 걸어서 ${subway.walkMinutes}분${parkingText ? '이고' : '입니다'}` : null,
        parkingText,
    ].filter(Boolean);
    const votes = votePhrases(place);
    const price = priceRange(place);
    // 매장 사실(미용·네일·피부: 디자이너 수 / 반려동물 동반 — 자료에 있는 것만)
    const stylists = BEAUTY_FAMILIES.has(familyOf(place)?.key) && Number.isFinite(place.detail?.stylistCount) && place.detail.stylistCount > 0 ? place.detail.stylistCount : null;
    const pet = place.detail?.pet === true && !medicalFamily(place);
    // keep: 클수록 덜 중요한 문장(0 은 새 키워드 예문이라 빼지 않음). 문장이 INTRO_MAX 개(+예문 수)를 넘으면 keep 이 큰 것부터 뺍니다(순서는 그대로).
    const address = place.address ? `${josa(name, '은', '는')} ${place.address}에 있는 ${kind}입니다.` : `${josa(name, '은', '는')} ${kind}입니다.`;
    const parts = [
        ...(shopLines.length
            ? [
                ...shopLines.map((text) => ({ keep: 0, text })),
                { keep: 1, text: place.address ? `주소는 ${place.address}입니다.` : null },
            ]
            : [{ keep: 1, text: address }]),
        { keep: 5, text: access.length ? `${access.join(', ')}.` : null },
        { keep: 4, text: hoursSentence(place) },
        {
            keep: 2,
            text: popular.items.length
                ? `${POPULAR_LEAD[popular.source](item)}${josa(item, '은', '는').slice(item.length)} ${popular.items.map(withPrice).join(', ')}입니다.`
                : coveredBy(placements, 'handled') ? null : handledSentence(place, recommendation),
        },
        ...factLines.map((text) => ({ keep: 0, text })),
        { keep: 6, text: price ? `${item} 가격은 ${price.text}입니다.` : null },
        {
            keep: 7,
            text: stylists && pet ? `디자이너가 ${stylists}명 있고, 반려동물과 함께 올 수 있습니다.`
                : stylists ? `디자이너가 ${stylists}명 있습니다.`
                    : pet ? '반려동물과 함께 올 수 있습니다.' : null,
        },
        { keep: 3, text: !coveredBy(placements, 'vote') && votes.length && (place.visitorReviews || 0) >= 10 ? `손님 리뷰에서 많이 꼽힌 점은 ${votes.join(', ')}입니다.` : null },
    ].filter((part) => part.text);
    const required = parts.filter((part) => part.keep === 0).length;
    while (parts.length > INTRO_MAX + required) {
        const drop = parts.reduce((worst, part) => (part.keep > worst.keep ? part : worst), parts[0]);
        if (drop.keep === 0) break;
        parts.splice(parts.indexOf(drop), 1);
    }
    const sentences = parts.map((part) => part.text);
    // 사실이 3문장도 안 되면 초안을 만들지 않습니다(빈칸 투성이 소개글을 내지 않음).
    if (sentences.length < 3) return null;
    const text = sentences.join(' ');
    // 한 줄 소개의 대표 메뉴 낱말: 화면의 한 줄 소개 예시(place-geo.js)와 같은 낱말 — 키워드 추천이 대표가 아니라고 뺀 낱말은 쓰지 않습니다.
    // 낱말이 하나도 없으면(자료 없음) 인기 메뉴 이름으로.
    const headline = headlineMenuTerms(place, activity, { limit: 2 });
    const menus = headline.length ? headline : popular.items.slice(0, 2).map((entry) => entry.name);
    const area = placeArea(place);
    const oneLine = [area, menus.join('·'), category].filter(Boolean).join(' ');
    if (!passes([text, oneLine], place, couponTitles(activity))) return null;
    const existing = Number.isFinite(place.detail?.descriptionLength) && place.detail.descriptionLength > 0 ? place.detail.descriptionLength : null;
    return {
        kind: 'intro', text, length: text.length, sentences: sentenceCount(text), oneLine: oneLine || null, hasPrice: Boolean(price), priceText: price?.text || null,
        // 새 키워드 예문 가운데 이 초안에 넣은 문장(C 표의 예문과 같은 문장)
        placed: [...shopLines, ...factLines],
        existingLength: existing,
    };
}

/* ───────── 소식 ───────── */

const LIMITED = /한정/;

// 영업시간 문장. 요일마다 시간이 다르면 같은 시간끼리 묶어 자료에 있는 요일을 모두 적습니다.
//   "월·화·수·목·금 11:00~01:00, 토·일 13:00~01:00" (모든 요일이 같으면 "매일 10:30~19:30")
const WEEKDAY_ORDER = ['월', '화', '수', '목', '금', '토', '일'];

export function hoursLine(hours) {
    if (!hours?.registered || !Array.isArray(hours.days)) return null;
    const open = hours.days.filter((day) => day && day.start && day.end);
    if (open.length === 0) return null;
    const groups = new Map();
    for (const day of open) {
        const key = `${day.start}~${day.end}`;
        groups.set(key, [...(groups.get(key) || []), String(day.day)]);
    }
    if (groups.size === 1) {
        const [time, days] = [...groups.entries()][0];
        return days.includes('매일') || days.length >= 7 ? `매일 ${time}` : `${days.join('·')} ${time}`;
    }
    const order = (day) => {
        const index = WEEKDAY_ORDER.indexOf(day);
        return index < 0 ? 99 : index;
    };
    return [...groups.entries()]
        .map(([time, days]) => ({ time, days: [...days].sort((a, b) => order(a) - order(b)) }))
        .sort((a, b) => order(a.days[0]) - order(b.days[0]))
        .map(({ time, days }) => `${days.join('·')} ${time}`)
        .join(', ');
}

function hoursSentence(place) {
    const hours = hoursLine(place?.detail?.hours);
    return hours ? `영업시간은 ${hours}입니다.` : null;
}

// 소식 초안(제목 + 본문 2~4문장). 할인·행사는 지어내지 않고 메뉴·영업시간·매장 사실, 사장님이 등록해 둔 예약 혜택·쿠폰만 씁니다.
//   question: AI 검색 진단의 대표 질문("강남구청역 한식 추천"). 있으면 질문형 제목을 하나 더 줍니다(place-geo-quick 의 소식 제목과 같은 모양).
//             약국·병원은 '추천?' 대신 위치·영업시간을 알리는 제목으로 씁니다.
//   focus:    5칸 최종안에 새로 넣는 낱말 [{ keyword, term, region }]. 메뉴판에 같은 이름의 메뉴가 있으면 그 낱말로 소식 한 편을 더 씁니다.
//   activity: 쿠폰 이름을 읽는 데만 씁니다.
//   placements: 5칸 새 키워드의 예문(keywordPlacements). 지역·업종 예문은 제목에, 사실 예문은 본문에 같은 문장으로 넣습니다.
export function feedDrafts(place, {
    question = null, nowMs = Date.now(), recommendation = null, focus = [], activity = null, also = [], placements = [],
} = {}) {
    if (!place) return null;
    const name = String(place.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const area = placeArea(place);
    const category = centerCategory(place);
    // 매장 이름이 이미 그 업종 낱말로 끝나면 제목에 다시 붙이지 않습니다("오창읍 약국 메가헬스팜약국" → "오창읍 메가헬스팜약국").
    const categoryInTitle = category && !compact(name).includes(compact(category)) ? category : null;
    const month = monthOf(nowMs);
    const hours = hoursSentence(place);
    // 영업시간 문장이 있으면 '01:00까지 영업' 같은 같은 뜻의 매장 안내는 빼 되풀이를 막습니다.
    const facts = fitCriteria(place).filter((c) => !/도보/.test(c.label) && !(hours && c.key === 'late')).map((c) => c.label);
    // 미용·네일·피부: 자료에 있는 디자이너 수(소개글 초안에서는 6문장 제한 때문에 빠질 수 있어 소식에도 적음)
    const designers = BEAUTY_FAMILIES.has(familyOf(place)?.key) && Number.isFinite(place.detail?.stylistCount) && place.detail.stylistCount > 0 ? place.detail.stylistCount : null;
    if (designers) facts.push(`디자이너 ${designers}명`);
    const station = stationText(place);
    const popular = popularItems(place, 3, { notMain: notMainTerms(recommendation) });
    const asked = String(question || '').replace(/\s*추천$/, '').trim();
    // 5칸에 새로 넣는 지역·업종 키워드('청주약국'·'오창약국')가 있으면 그 지역 이름을 제목 머리에 씁니다(예문의 "소식 제목"과 같은 표현).
    const shopTitles = list(placements).filter((entry) => entry.kind === 'shop' && entry.sentence && /소식 제목/.test(String(entry.where || '')));
    const shopRegions = [...new Set(shopTitles.map((entry) => String(entry.region || '').trim()).filter(Boolean))];
    const shopTerm = shopTitles.map((entry) => String(entry.term || '').trim()).find((term) => term && !compact(name).includes(compact(term))) || null;
    const baseHead = asked ? `${asked} ${name}` : [area, categoryInTitle, name].filter(Boolean).join(' ');
    // 기본 머리(AI 질문 또는 지역·업종)에 새 키워드의 지역·업종 낱말이 이미 들어 있으면 그대로 두어 같은 문서의 AI 질문 제목과 맞춥니다.
    const baseHas = (word) => compact(baseHead).includes(compact(word));
    const head = shopRegions.length && !(shopRegions.every(baseHas) && (!shopTerm || baseHas(shopTerm)))
        ? [shopRegions.join('·'), shopTerm, name].filter(Boolean).join(' ')
        : baseHead;
    const factLines = placementSentences(placements, 'fact', (where) => /소식/.test(where));
    const extra = couponTitles(activity);
    const benefit = bookingBenefit(place);
    const coupon = extra.length ? `쿠폰: ${extra[0]}.` : null;
    const busy = busyTime(place);
    // 키워드로는 뺐지만 매장 자료에 나온 낱말(also)의 메뉴: 메뉴판에 같은 이름의 메뉴가 있을 때만 한 문장으로
    const alsoMenus = [];
    const allMenus = menuEntries(place);
    for (const word of list(also)) {
        const key = compact(word);
        const menu = key.length >= 2 ? allMenus.find((entry) => compact(entry.name).includes(key)) : null;
        if (menu && !alsoMenus.some((entry) => entry.name === menu.name) && alsoMenus.length < 5) alsoMenus.push(menu);
    }
    const drafts = [];

    // 1. 대표 메뉴(시술)·영업시간 안내
    {
        const body = [
            popular.items.length ? `${POPULAR_LEAD[popular.source](item)}${josa(item, '은', '는').slice(item.length)} ${popular.items.map(withPrice).join(', ')}입니다.` : null,
            hours,
            popular.items.length || coveredBy(placements, 'handled') ? null : handledSentence(place, recommendation),
            ...factLines,
            alsoMenus.length ? `메뉴판에는 ${alsoMenus.map(withPrice).join(', ')}도 있습니다.` : null,
            busy ? `가장 붐비는 때는 ${busy}입니다.` : null,
            station,
            facts.length ? `매장 안내: ${facts.join(' · ')}.` : null,
            benefit ? `${benefit}.` : null,
            coupon,
            `(새 ${String(item).replace(/^취급 /, '')}·휴무가 있으면 날짜·가격과 함께 한 줄 — 직접 적기)`,
        ].filter(Boolean);
        if (body.length >= 2) {
            drafts.push({
                key: 'notice',
                label: popular.items.length ? `대표 ${item}·영업시간 안내` : '영업시간·매장 안내',
                title: `${head} — ${month}월 ${popular.items.length ? `${item}·` : ''}영업 안내`,
                body: body.join(' '),
            });
        }
    }
    // 2. 5칸에 새로 넣는 낱말이 메뉴판의 메뉴 이름에 든 경우(마지막 소식·메뉴판에 나온 '대방어' 등) — 같은 낱말로 소식을 씁니다.
    {
        const menus = menuEntries(place);
        for (const entry of orderedFocus(focus)) {
            const term = String(entry?.term || '').trim();
            if (compact(term).length < 2) continue;
            const matched = menus.filter((menu) => compact(menu.name).includes(compact(term))).slice(0, 3);
            if (matched.length === 0) continue;
            const where = String(entry.region || '').trim();
            // C 표의 예문(같은 키워드의 메뉴 문장)이 있으면 그 문장 그대로, 없으면 이 초안의 문장. 영업시간은 첫 소식에만 적어 되풀이하지 않습니다.
            const placed = list(placements).find((entry2) => entry2.keyword === entry.keyword && entry2.kind === 'menu' && entry2.sentence);
            drafts.push({
                key: 'focus',
                label: `'${where ? `${where} ` : ''}${term}' 소식`,
                title: `${[where, term].filter(Boolean).join(' ')} ${item} 안내 — ${name}`,
                body: [
                    placed ? placed.sentence : `${name}의 ${term} ${item}${josa(item, '은', '는').slice(item.length)} ${matched.map(withPrice).join(', ')}입니다.`,
                    '(언제부터인지·수량·예약 여부 — 직접 적기)',
                ].join(' '),
            });
            break;
        }
    }
    // 3. 메뉴판에 '한정·제철'로 올린 메뉴가 있으면 그 안내
    {
        const limited = menuEntries(place).filter((menu) => LIMITED.test(menu.name)).slice(0, 3);
        if (limited.length) {
            // 이름 앞의 '(한정)' 머리표는 문장이 '한정'이라고 말하므로 떼어 '한정'이 두 번 나오지 않게 합니다.
            const bare = (menu) => ({ ...menu, name: String(menu.name).replace(/^\((?:한정|제철)\)\s*/, '') });
            drafts.push({
                key: 'limited',
                label: `메뉴판의 한정 ${item} 안내`,
                title: `${[area, name].filter(Boolean).join(' ')} — ${month}월 한정 ${item} 안내`,
                body: [
                    `메뉴판에 한정으로 올린 ${item}${josa(item, '은', '는').slice(item.length)} ${limited.map((menu) => withPrice(bare(menu))).join(', ')}입니다.`,
                    '(언제까지인지·하루 몇 개인지 — 직접 적기)',
                ].join(' '),
            });
        }
    }
    const items = drafts.slice(0, FEED_MAX).filter((draft) => passes([draft.title, draft.body], place, extra));
    if (items.length === 0) return null;
    const lead = popular.items[0]?.name;
    let altTitle = null;
    if (question) {
        altTitle = medicalFamily(place)
            ? `${String(question).replace(/\s*추천$/, '')} 위치·영업시간 안내 — ${name}`
            : `${question}? ${name} ${lead ? `${lead}·` : ''}위치·영업시간 안내`;
    }
    // 새 키워드 예문 가운데 이 초안에 실제로 넣은 문장(C 표의 예문과 같은 문장)
    const bodies = items.map((draft) => draft.body).join(' ');
    const placed = list(placements).filter((entry) => entry.sentence && bodies.includes(entry.sentence)).map((entry) => entry.sentence);
    return {
        kind: 'feed',
        items,
        altTitle: altTitle && passes(altTitle, place, extra) ? altTitle : null,
        placed: [...new Set(placed)],
        titleRegions: shopRegions,
    };
}

/* ───────── 메뉴(시술) 설명 초안 ───────── */

const QUANTITY = /(\d+(?:\.\d+)?\s?(?:g|kg|ml|l|pcs|pc|인분|개|마리|조각|피스|미))/i;

// 메뉴 이름에서 읽히는 사실: 양("(100g)")과 구성("광어+시마아지")
function nameFacts(name) {
    const value = String(name);
    const quantity = value.match(QUANTITY)?.[1]?.replace(/\s+/g, '').replace(/pcs?$/i, '개') || null;
    const inner = value.match(/\(([^)]*\+[^)]*)\)/)?.[1] || null;
    const parts = (inner ? inner.split('+') : value.includes('+') ? value.split('+') : [])
        .map((part) => part.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
    return { quantity, parts };
}

// 설명 초안: "메뉴 이름: 아는 사실 · 사장님만 아는 것(직접 적기)". 이름·이름에 든 양과 구성은 채우고, 재료·양·걸리는 시간은 지어내지 않고 비워 둡니다.
function frameOf(name, family) {
    const { quantity, parts } = nameFacts(name);
    const beauty = family === 'hair' || family === 'nail' || family === 'skin';
    const food = family === 'restaurant' || family === 'cafe' || family === 'bar';
    const known = [];
    const blank = [];
    if (parts.length) known.push(`구성 ${parts.join(' + ')}`);
    if (beauty) {
        if (!parts.length) blank.push(`포함 내용 ${BLANK}`);
        blank.push(`걸리는 시간 ${BLANK}`);
    } else if (food) {
        if (quantity) known.push(`양 ${quantity}`);
        blank.push(`재료 ${BLANK}`);
        if (!quantity) blank.push(`양 ${BLANK}`);
    } else {
        if (quantity) known.push(`양 ${quantity}`);
        blank.push(`포함 내용 ${BLANK}`, `이용 방법 ${BLANK}`);
    }
    return `${tidyMenuName(name)}: ${[...known, ...blank].join(' · ')}`;
}

// 설명을 어떻게 쓰는지 보이는 한 줄(menuFrames 의 model).
//  own    이 매장이 이미 쓴 설명이 자료에 있으면 그 문장 하나를 본보기로(매장이 직접 쓴 글이라 지어낸 것이 아님)
//  sample 없으면 업종별 '보기' 문장 하나. 다른 가게의 예시일 뿐 이 매장의 사실이 아니라고 분명히 적습니다(○○는 사장님이 채울 자리).
const SAMPLE_TEXT = {
    hair: '○○컷: 샴푸·커트·드라이가 포함됩니다. 걸리는 시간은 약 ○시간 ○분입니다.',
    beauty: '○○ 시술: ○○·○○가 포함됩니다. 걸리는 시간은 약 ○시간 ○분입니다.',
    food: '○○ 세트: ○○와 ○○가 함께 나옵니다. 양은 ○인분입니다.',
    other: '○○: ○○가 포함됩니다. 이용 방법은 ○○입니다.',
};

function sampleOf(family) {
    if (family === 'hair') return SAMPLE_TEXT.hair;
    if (family === 'nail' || family === 'skin') return SAMPLE_TEXT.beauty;
    if (family === 'restaurant' || family === 'cafe' || family === 'bar') return SAMPLE_TEXT.food;
    return SAMPLE_TEXT.other;
}

const OWN_DESCRIPTION_MAX = 70;

function ownModel(menu) {
    const text = String(menu.description).replace(/\s+/g, ' ').trim();
    const cut = text.length > OWN_DESCRIPTION_MAX ? `${text.slice(0, OWN_DESCRIPTION_MAX).replace(/\s+\S*$/, '')}…` : text;
    return { kind: 'own', head: '이 매장이 이미 쓴 설명', text: `‘${tidyMenuName(menu.name)} — ${cut}’ 처럼 쓰세요.` };
}

function sampleModel(family) {
    return { kind: 'sample', head: '보기', text: `다른 매장의 예시이며 이 매장의 사실이 아닙니다. 그대로 쓰지 마세요. ‘${sampleOf(family)}’` };
}

// 앞의 '(한정)' 같은 머리표를 뗀 이름(결제·리뷰 자료의 이름과 같은 메뉴인지 볼 때)
const sameName = (name) => compact(String(name || '').replace(/^\([^)]*\)\s*/, ''));
const countText = (value) => Number(value).toLocaleString('ko-KR');

// 그 메뉴(시술)를 고른 까닭이 되는 사장님 자료의 숫자. 이름이 같을 때만 결제·예약 숫자를 붙이고, 리뷰는 어느 낱말이 몇 번 나왔는지 낱말을 밝혀 적습니다.
function posFact(place, menuName) {
    const rows = list(place?.detail?.pos?.popularMenus).filter((row) => row && String(row.name || '').trim() && Number.isFinite(row.count));
    const hit = rows.find((row) => sameName(row.name) === sameName(menuName));
    if (!hit) return null;
    const rank = 1 + rows.filter((row) => row.count > hit.count).length;
    return rows.length >= 2 ? `최근 1주 결제 ${rank}위(${countText(hit.count)}건)` : `최근 1주 결제 ${countText(hit.count)}건`;
}

function styleFact(place, menuName) {
    const hit = list(place?.detail?.styles).find((style) => style && Number.isFinite(style.count) && sameName(style.name) === sameName(menuName));
    return hit ? `네이버 예약 ${countText(hit.count)}건` : null;
}

function reviewFact(place, menuName, prefer = null) {
    const key = sameName(menuName);
    const hits = list(place?.reviewMenus).filter((entry) => entry && Number.isFinite(entry.count) && compact(entry.label).length >= 2 && key.includes(compact(entry.label)));
    const chosen = hits.find((entry) => prefer && compact(entry.label) === compact(prefer))
        || hits.sort((a, b) => compact(b.label).length - compact(a.label).length || b.count - a.count)[0];
    return chosen ? `리뷰에 '${chosen.label}' ${countText(chosen.count)}회` : null;
}

// 메뉴(시술) 설명 초안을 만듭니다. 어느 메뉴에 이미 설명이 있는지는 받은 자료로 알 수 없어,
// "설명이 비어 있는 것만 채우세요"라고 함께 적습니다.
//   focus: 5칸 최종안에 새로 넣는 낱말 [{ term }]. 메뉴판에 그 낱말이 든 메뉴를 먼저 채웁니다(같은 낱말로 5칸·설명을 맞춤).
//   also:  키워드로는 뺐지만 매장 자료(리뷰·결제)에 나온 낱말(예: '김밥') [word]. 같은 이름이 든 메뉴를 그다음으로 채웁니다.
// 각 줄의 '고른 까닭'은 사장님 자료의 숫자(최근 1주 결제 몇 위 몇 건·네이버 예약 몇 건·리뷰에 나온 횟수)로 적습니다.
export function menuFrames(place, { recommendation = null, focus = [], also = [] } = {}) {
    if (!place) return null;
    const allMenus = menuEntries(place);
    // 자료에 메뉴별 설명 글이 있으면(description 이 문자열) 설명이 비어 있는 메뉴만 표에 올립니다. 없으면 어느 것에 설명이 있는지 모릅니다.
    // (조회 자료의 menus 는 40개까지만 담아 설명 있는 메뉴가 그 뒤에만 있을 수 있습니다. 읽어 온 메뉴에서 설명 글을 하나도 못 찾았는데 설명이 있는 메뉴가 있다고 조회됐으면 모르는 것으로 봅니다.)
    const describedKnown = allMenus.some((menu) => menu.description !== undefined)
        && !(!allMenus.some((menu) => menu.description) && Number(place.menuDescribedCount) > 0);
    const menus = describedKnown ? allMenus.filter((menu) => !menu.description) : allMenus;
    if (menus.length === 0) return null;
    const family = familyOf(place)?.key || null;
    const picked = [];
    const seen = new Set();
    // lead: 숫자가 있어도 먼저 적을 까닭(새 대표키워드 낱말·사장님 표시) / fallback: 숫자가 하나도 없을 때만 적는 까닭 / loose: 이름이 조금 다른 자료의 숫자
    const add = (menu, { lead = null, fallback = null, loose = null, term = null } = {}) => {
        if (!menu || seen.has(menu.name) || picked.length >= MENU_FRAMES_MAX) return;
        seen.add(menu.name);
        picked.push({ ...menu, lead, fallback, loose, term });
    };
    for (const entry of orderedFocus(focus)) {
        const key = compact(entry?.term);
        if (key.length < 2) continue;
        menus.filter((menu) => compact(menu.name).includes(key)).slice(0, 2)
            .forEach((menu) => add(menu, { lead: `새 대표키워드 낱말 '${entry.term}'(이름에 있음)`, term: entry.term }));
    }
    // 키워드로는 뺐지만 쓸 낱말(also)이 든 메뉴와 결제·예약·리뷰에서 인기 있는 메뉴는 한 묶음으로 보고, 그 메뉴에 붙은 숫자(결제·예약·리뷰 건수 합)가 큰 순서로 채웁니다.
    // (낱말이 든 메뉴를 무조건 앞세우면 리뷰 몇 회짜리 낱말이 결제 인기 메뉴를 밀어냅니다. 숫자가 같으면 낱말이 든 메뉴가 먼저.)
    const evidenceCount = (menu) => [posFact(place, menu.name), styleFact(place, menu.name), reviewFact(place, menu.name)]
        .filter(Boolean).reduce((sum, text) => sum + (Number(String(text.match(/([\d,]+)(?:건|회)/)?.[1] || '0').replace(/,/g, '')) || 0), 0);
    const pool = new Map();
    const pushPool = (menu, opts, count) => {
        if (!menu) return;
        const before = pool.get(menu.name);
        if (before) pool.set(menu.name, { ...before, opts: { ...opts, ...before.opts }, count: Math.max(before.count, count) });
        else pool.set(menu.name, { menu, opts, count, order: pool.size });
    };
    for (const word of list(also)) {
        const key = compact(word);
        if (key.length < 2) continue;
        menus.filter((menu) => compact(menu.name).includes(key)).slice(0, 1)
            .forEach((menu) => pushPool(menu, { fallback: `리뷰·결제 자료에 나온 낱말 '${word}'(이름에 있음)`, term: word }, evidenceCount(menu)));
    }
    const popular = popularItems(place, MENU_FRAMES_MAX, { notMain: notMainTerms(recommendation) });
    for (const entry of popular.items) {
        const loose = Number.isFinite(entry.count)
            ? (popular.source === 'pos' ? `최근 1주 결제 '${entry.name}' ${countText(entry.count)}건`
                : popular.source === 'style' ? `네이버 예약 '${entry.name}' ${countText(entry.count)}건`
                    : `리뷰에 '${entry.name}' ${countText(entry.count)}회`)
            : null;
        const menu = findMenu(menus, entry.name);
        if (menu) pushPool(menu, { loose }, Math.max(evidenceCount(menu), Number.isFinite(entry.count) ? entry.count : 0));
    }
    [...pool.values()].sort((a, b) => b.count - a.count || a.order - b.order).forEach(({ menu, opts }) => add(menu, opts));
    // 사장님이 '추천'으로 표시한 메뉴도 넣습니다. 인기·추천이 아닌 메뉴는 넣지 않습니다.
    for (const menu of list(place.detail?.menus).filter((m) => m.recommended)) add(findMenu(menus, menu.name), { lead: '사장님이 추천으로 표시' });
    // 설명 있는 메뉴가 하나도 없으면 모든 메뉴가 대상입니다. 예약·결제·리뷰 숫자가 있는 메뉴를 숫자가 큰 순서로 먼저(그 숫자가 '고른 까닭'에 적힘),
    // 숫자가 하나도 없는 메뉴만 등록 순서대로 채웁니다.
    if (place.menuDescribedCount === 0) {
        menus.map((menu, index) => ({ menu, index, count: evidenceCount(menu) }))
            .sort((a, b) => b.count - a.count || a.index - b.index)
            .forEach(({ menu }) => add(menu, { fallback: `등록한 ${itemWord(place)}(예약·결제·리뷰 숫자가 없어 등록 순서대로)` }));
    }
    const rows = picked.map((menu) => {
        const facts = [posFact(place, menu.name), styleFact(place, menu.name), reviewFact(place, menu.name, menu.term)].filter(Boolean);
        // 이름이 정확히 같은 자료가 없을 때만, 이름이 조금 다른 자료의 숫자를 그 이름과 함께 적습니다.
        if (menu.loose && !facts.some((text) => /^(최근 1주 결제|네이버 예약)/.test(text))) facts.unshift(menu.loose);
        const why = uniq([menu.lead, ...facts]).slice(0, 3).join(' · ') || menu.fallback || `등록한 ${itemWord(place)}`;
        return { name: tidyMenuName(menu.name), price: menu.price, why, frame: frameOf(menu.name, family) };
    });
    // 표 머리 '이 ○○을(를) 고른 까닭'의 ○○: 음식점 '메뉴', 미용 '시술'(같은 표 안에서 업종과 맞게)
    const item = itemWord(place);
    const described = allMenus.find((menu) => menu.description);
    const note = describedKnown
        ? (described
            ? `이미 설명이 있는 ${item}${josa(item, '은', '는').slice(item.length)} 표에서 뺐습니다.`
            : `조회한 자료에서 설명이 적힌 ${item}${josa(item, '은', '는').slice(item.length)} 찾지 못했습니다.`)
        : '어느 것에 이미 설명이 있는지는 조회한 자료로 알 수 없어, 설명이 비어 있는 것만 채우세요.';
    return rows.length ? { kind: 'menu', rows, popularSource: popular.source, model: described ? ownModel(described) : sampleModel(family), note, item, reasonHead: `이 ${item}${josa(item, '을', '를').slice(item.length)} 고른 까닭` } : null;
}

/* ───────── 새 키워드를 넣을 문장 ───────── */

const SHOP_WORD = /(약국|미용실|헤어|바버샵|샵|집|식당|카페|병원|의원)$/;

// region: 지역 이름 하나 또는 같은 종류의 지역 여러 개(["청주", "오창"] → "청주·오창에 있는")
function regionPhrase(region, scope) {
    const regions = (Array.isArray(region) ? region : [region]).map((entry) => String(entry || '').trim()).filter(Boolean);
    if (regions.length === 0) return null;
    if (scope === 'station') return `${regions.map((entry) => (entry.endsWith('역') ? entry : `${entry}역`)).join('·')} 근처`;
    return `${regions.join('·')}에 있는`;
}

// 근거 종류(네이버 예약 스타일·리뷰에 나온 시술·손님이 고른 좋은 점)에서 만드는 사실 문장. 손님이 읽는 글이라 숫자 없이 씁니다.
// 매장 자료가 그 사실을 실제로 뒷받침할 때만 만듭니다(예약 스타일은 네이버 예약이 켜져 있고 그 스타일 목록에 있을 때).
//   term/region: 추천 낱말과 지역 / reco: 추천 줄(reasons) / kinds: 5칸 근거의 종류(점수가 높은 순)
function factSentence(place, { term, region, reco, kinds }) {
    const name = String(place?.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const head = region ? `${region} ` : '';
    for (const kind of kinds) {
        if (kind === 'booking' && term && place?.detail?.hasBooking === true && list(place.detail.styles).some((style) => compact(style?.name) === compact(term))) {
            return { text: `${head}${josa(term, '은', '는')} ${name}에서 네이버 예약으로 받을 수 있습니다.`, covers: null, factKey: 'booking', headTerm: `${head}${term}`, term, tail: `${name}에서 네이버 예약으로 받을 수 있습니다.` };
        }
        // 약국·병원: 사장님이 등록한 대표키워드('건강기능식품')를 손님이 쓰는 말('영양제')로 — 사장님이 직접 등록한 사실만
        if (kind === 'fact' && medicalFamily(place) && term && !SHOP_ENDING.test(term)) {
            const registered = list(reco?.reasons).map((reason) => String(reason?.text || '').match(/^등록 키워드 '([^']+)'/)?.[1]).find((word) => word && list(place?.keywords).includes(word));
            if (registered && compact(registered) !== compact(term)) return { text: `${head}${josa(name, '은', '는')} ${registered}(${term})${josa(registered, '을', '를').slice(registered.length)} 취급합니다.`, covers: 'handled' };
        }
        if (kind === 'review' && term && list(place?.reviewMenus).some((menu) => compact(menu?.label) === compact(term))) {
            return { text: `${head}${josa(term, '은', '는')} ${name}의 손님 리뷰에 자주 나오는 ${item}입니다.`, covers: null, factKey: 'review', headTerm: `${head}${term}`, term, tail: `${name}의 손님 리뷰에 자주 나오는 ${item}입니다.` };
        }
        if (kind === 'vote') {
            const label = list(reco?.reasons).map((reason) => String(reason?.text || '').match(/'([^']+)'/)?.[1]).find((value) => value && list(place?.reviewVotes).some((vote) => vote?.label === value));
            if (label) return { text: `${head}${josa(name, '은', '는')} 손님 리뷰에서 '${label}'${josa(label, '이', '가').slice(label.length)} 많이 꼽혔습니다.`, covers: 'vote' };
        }
    }
    return null;
}

// 대표키워드 말고도 소개글·소식·메뉴 설명에 새 키워드를 같은 표현으로 넣을 예문.
//   proposals: 5칸 최종안에서 새로 넣는 키워드 [{ keyword, item, evidence }] (item: recommendKeywords 의 추천 줄, evidence: 5칸 근거 [{ kind }])
// 예문은 매장 자료로 참인 문장만 만듭니다. 업종·메뉴판·예약 스타일·리뷰·손님이 고른 좋은 점에서 사실 문장을 만들 수 없는 낱말은 넣을 자리만 알려 줍니다.
export function keywordPlacements(place, proposals) {
    if (!place) return [];
    const name = String(place.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const menus = menuEntries(place);
    const noFeed = familyOf(place)?.key === 'clinic'; // 병·의원: 네이버가 새소식 기능을 제공하지 않음
    const rows = list(proposals).map(({ keyword, item: reco, evidence }) => {
        const term = reco?.term || null;
        const region = reco?.region || null;
        const scope = reco?.regionScope || null;
        const phrase = regionPhrase(region, scope);
        const matched = term ? menus.filter((menu) => compact(menu.name).includes(compact(term))).slice(0, 2) : [];
        let sentence = null;
        let where = null;
        let kind = null; // shop: 지역·업종 문장 / menu: 메뉴 문장 / fact: 사실 문장(예약·리뷰·손님이 고른 점·취급 품목)
        let covers = null;
        let fact = null;
        // "○○에 있는 약국입니다"처럼 매장이 무엇인지 말하는 문장은 업종·업종 대표어이거나 사장님이 등록한 키워드의 낱말일 때만 씁니다
        // ('동물약국'·'대형약국'처럼 근거로 미루어 붙인 말은 그 매장이 그렇다고 단정하지 않음).
        if (term && phrase && (['category', 'family'].includes(reco?.source) || (reco?.source === 'registered' && SHOP_WORD.test(term)))) {
            sentence = `${josa(name, '은', '는')} ${phrase} ${term}입니다.`;
            where = noFeed ? '소개글 첫 문장' : '소개글 첫 문장 · 소식 제목';
            kind = 'shop';
        } else if (term && matched.length) {
            sentence = `${region ? `${region} ` : ''}${name}의 ${term} ${item}: ${matched.map(withPrice).join(', ')}.`;
            where = noFeed ? `${item} 설명` : `${item} 설명 · 소식 본문`;
            kind = 'menu';
        } else {
            const words = [region, term].filter(Boolean).join(' ') || keyword;
            where = `${noFeed ? '소개글' : '소식 제목·소개글'}에 '${words}'${josa(words, '을', '를').slice(words.length)} 그대로`;
            const kinds = list(evidence).map((part) => part?.kind);
            fact = factSentence(place, { term, region, reco, kinds });
            if (fact) {
                sentence = fact.text;
                covers = fact.covers;
                kind = 'fact';
                // 이 문서의 소개글·소식 초안에 같은 문장을 넣습니다(제목에 키워드를 늘어놓지는 않음).
                where = noFeed ? '소개글에 예문 그대로' : '소개글·소식 본문에 예문 그대로';
            }
        }
        if (sentence && !passes(sentence, place)) {
            sentence = null;
            kind = kind === 'fact' ? null : kind;
        }
        const basis = list(reco?.reasons).filter((reason) => reason.kind === 'fact' || reason.kind === 'review' || reason.kind === 'booking')
            .map((reason) => reason.text).slice(0, 2);
        // 사실 문장을 만들 수 없으면 "(직접 적기)"만 두지 않고 왜 못 만들었는지를 적습니다.
        const blankWhy = sentence ? null : `이 매장의 자료(메뉴판·예약·리뷰·등록 키워드)에서 ${term ? `'${term}'` : '이 낱말'}${josa(term || '이 낱말', '을', '를').slice((term || '이 낱말').length)} 한다는 사실을 확인하지 못해 문장을 만들지 않았습니다. 실제로 하면 넣을 자리에 직접 적으세요.`;
        return { keyword, sentence, blankWhy, where, basis, kind: sentence ? kind : null, covers: sentence ? covers : null, region, scope, term, fact: sentence && fact?.factKey ? fact : null };
    });
    // 같은 업종 낱말에 지역만 다른 문장('청주약국'·'오창약국')은 한 문장으로 합쳐 소개글·소식에 한 번만 들어가게 합니다.
    // 합친 문장은 그 키워드 줄 모두의 예문이 됩니다(예문과 초안의 문장이 같음).
    const groups = new Map();
    for (const row of rows) {
        if (row.kind !== 'shop') continue;
        const key = `${row.term}|${row.scope === 'station'}`; // 역 근처 문장과 '○○에 있는' 문장은 따로 묶습니다
        groups.set(key, [...(groups.get(key) || []), row]);
    }
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const regions = [...new Set(group.map((row) => row.region).filter(Boolean))];
        const sentence = `${josa(name, '은', '는')} ${regionPhrase(regions, group[0].scope)} ${group[0].term}입니다.`;
        if (!passes(sentence, place)) continue;
        for (const row of group) {
            row.sentence = sentence;
            row.regions = regions;
        }
    }
    // 같은 꼴의 사실 문장(예약으로 받을 수 있는 시술·리뷰에 자주 나오는 시술)은 서술을 한 번만 쓰고 키워드를 이어 적습니다:
    // "강남역 댄디컷, 강남역 쉐도우펌은 ○○에서 네이버 예약으로 받을 수 있습니다." (키워드 표현은 그대로, 같은 서술의 되풀이만 줄임)
    const factGroups = new Map();
    for (const row of rows) {
        if (!row.fact || !row.sentence) continue;
        const key = `${row.fact.factKey}|${row.region}`;
        factGroups.set(key, [...(factGroups.get(key) || []), row]);
    }
    for (const group of factGroups.values()) {
        if (group.length < 2) continue;
        const last = group[group.length - 1].fact;
        const sentence = `${group.map((row) => row.fact.headTerm).join(', ')}${josa(last.term, '은', '는').slice(last.term.length)} ${last.tail}`;
        if (!passes(sentence, place)) continue;
        for (const row of group) row.sentence = sentence;
    }
    return rows.map(({ fact, ...row }) => row);
}
