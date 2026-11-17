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
    placeCriteria, categoryLabel, placeArea, summarizeHours, findHypeWords, josa,
} from './place-geo.js';
import { familyOf } from './place-keywords.js';
import { itemWord } from './place-graph.js';

export const DRAFT_MARK = '초안 — 우리 매장 사실에 맞게 고쳐 쓰세요';
export const BLANK = '(직접 적기)';

// 초안에 들어가면 안 되는 말(자료에 없는 혜택·행사·수상·원산지·효능). 테스트도 이 목록으로 확인합니다.
export const INVENTED_WORDS = [
    '할인', '이벤트', '증정', '사은품', '특가', '1+1', '오픈 기념', '무료 제공', '수상', '선정', '원산지', '국내산', '유기농',
    '효능', '효과', '완치', '치료', '개선됩니다', '최고', '1위', '1등', '유일', '최초', '역대급', '존맛',
];

const FEED_MAX = 2;
const MENU_FRAMES_MAX = 5;
const REPLY_FACTS_MAX = 2;

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
// 매장 자료에 원래 있는 말(예: 상호에 든 낱말)은 지어낸 말로 보지 않습니다.
export function draftProblems(text, place) {
    const value = String(text ?? '');
    const source = compact([
        place?.name, place?.category, place?.intro, ...list(place?.keywords),
        ...list(place?.detail?.menus).map((menu) => menu.name), ...list(place?.reviewVotes).map((vote) => vote.label),
        ...list(place?.conveniences), ...list(place?.detail?.facilities),
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
function passes(texts, place) {
    return (Array.isArray(texts) ? texts : [texts]).every((text) => draftProblems(text, place).length === 0);
}

/* ───────── 메뉴(시술) 고르기 ───────── */

function menuEntries(place) {
    return list(place?.detail?.menus)
        .filter((menu) => String(menu.name || '').trim())
        .map((menu) => ({ name: String(menu.name).trim(), price: String(menu.price || '').trim() || null }));
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
        return { source, names: names.slice(0, max) };
    });
    const chosen = candidates.find((entry) => entry.names.length >= 2) || candidates.find((entry) => entry.names.length >= 1);
    if (!chosen) return { source: null, items: [] };
    return {
        source: chosen.source,
        items: chosen.names.map((name) => {
            const menu = findMenu(menus, name);
            return { name: menu ? menu.name : name, price: menu?.price || null };
        }),
    };
}

// 손님이 읽는 글이라 '결제·예약 자료' 같은 내부 표현 대신 손님 말투로 씁니다(고르는 근거는 그대로 그 자료).
const POPULAR_LEAD = {
    pos: (item) => `요즘 많이 찾는 ${item}`,
    style: (item) => `요즘 예약이 많은 ${item}`,
    review: (item) => `손님 리뷰에 자주 나오는 ${item}`,
};

function withPrice(entry) {
    return entry.price ? `${entry.name}(${entry.price})` : entry.name;
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
    const all = placeCriteria(place);
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
    const criteria = placeCriteria(place);
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
    return `${picked.join('고 ')}니 다음에도 편하게 들러 주세요.`;
}

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
    const complaint = leastRepetitive(generateReplies({ industry, storeName, review: '기다린 시간이 길었어요', sentiment: 'complaint', complaintType: 'wait', tone: 'polite' }));
    if (complaint) drafts.push({ key: 'complaint', label: '아쉬움을 남긴 리뷰 예시 — 기다린 시간이 길었다는 리뷰', text: complaint.text });

    const items = drafts.filter((draft) => passes(draft.text, place));
    if (items.length === 0) return null;
    return {
        kind: 'reply',
        example: true,
        items,
        note: '실제 리뷰 문장은 받은 자료에 없어 예시로 만들었습니다. 리뷰에 적힌 메뉴·상황에 맞게 한두 낱말을 바꿔 쓰세요. 이름·방문 날짜·좌석 번호처럼 손님을 알아볼 수 있는 말은 넣지 마세요.',
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
    return registered.filter((entry) => !entry.hasRegion && entry.keyword).map((entry) => entry.keyword).slice(0, 4);
}

// 소개글 초안(3~5문장) + 한 줄 소개. 손님이 읽는 글이라 내부 숫자(리뷰 수·결제 집계·점수) 없이 손님 말투로 씁니다.
//   ① 어디에 있는 무엇인지 ② 찾아오는 길·주차 ③ 영업시간 ④ 많이 찾는 메뉴(시술) 또는 다루는 것 ⑤ 손님 리뷰에서 많이 꼽힌 점
// 모두 매장 화면 자료에 있는 사실이고, 효능·맛 평가·순위는 쓰지 않습니다.
// 조건형 문장(buildCriteriaAnswer)은 업종에 맞지 않는 조건('단체 이용 가능 약국')이 섞일 수 있어 넣지 않습니다.
export function introDraft(place, activity = null, { recommendation = null } = {}) {
    if (!place) return null;
    const name = String(place.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const category = place.category ? categoryLabel(place) : null;
    const kind = category ? (SHOP_ENDING.test(category) ? category : `${category} 매장`) : '매장';
    const popular = popularItems(place, 3, { notMain: notMainTerms(recommendation) });
    const subway = place.detail?.subway;
    const station = subway?.station ? (String(subway.station).endsWith('역') ? subway.station : `${subway.station}역`) : null;
    const parking = place.detail?.parking;
    const parkingText = parking?.available ? (parking.free === true ? '무료로 주차할 수 있습니다' : '주차할 수 있습니다') : null;
    const access = [
        station && subway.walkMinutes ? `${station}${subway.exit ? ` ${subway.exit}번 출구` : ''}에서 걸어서 ${subway.walkMinutes}분${parkingText ? '이고' : '입니다'}` : null,
        parkingText,
    ].filter(Boolean);
    const handled = handledTerms(place, recommendation);
    const votes = list(place.reviewVotes).slice(0, 3).map((vote) => `'${vote.label}'`);
    const sentences = [
        place.address ? `${josa(name, '은', '는')} ${place.address}에 있는 ${kind}입니다.` : `${josa(name, '은', '는')} ${kind}입니다.`,
        access.length ? `${access.join(', ')}.` : null,
        hoursSentence(place),
        popular.items.length
            ? `${POPULAR_LEAD[popular.source](item)}${josa(item, '은', '는').slice(item.length)} ${popular.items.map(withPrice).join(', ')}입니다.`
            : handled.length ? `${handled.join('·')}${josa(handled[handled.length - 1], '을', '를').slice(handled[handled.length - 1].length)} 취급합니다.` : null,
        votes.length && (place.visitorReviews || 0) >= 10 ? `손님 리뷰에서 많이 꼽힌 점은 ${votes.join(', ')}입니다.` : null,
    ].filter(Boolean);
    // 사실이 3문장도 안 되면 초안을 만들지 않습니다(빈칸 투성이 소개글을 내지 않음).
    if (sentences.length < 3) return null;
    const text = sentences.join(' ');
    const menus = popular.items.slice(0, 2).map((entry) => entry.name);
    const area = placeArea(place);
    const oneLine = [area, menus.join('·'), place.category ? categoryLabel(place) : null].filter(Boolean).join(' ');
    if (!passes([text, oneLine], place)) return null;
    return { kind: 'intro', text, length: text.length, sentences: sentenceCount(text), oneLine: oneLine || null };
}

/* ───────── 소식 ───────── */

const LIMITED = /한정/;

// "월·화·수·목·금 11:00~01:00 등 요일별" → "월·화·수·목·금 11:00~01:00(요일마다 다름)"
function hoursSentence(place) {
    const hours = summarizeHours(place?.detail?.hours);
    if (!hours) return null;
    return `영업시간은 ${hours.endsWith(' 등 요일별') ? `${hours.slice(0, -' 등 요일별'.length)}(요일마다 다름)` : hours}입니다.`;
}

// 소식 초안(제목 + 본문 2~4문장). 할인·행사는 지어내지 않고 메뉴·영업시간·매장 사실만 씁니다.
//   question: AI 검색 진단의 대표 질문("강남구청역 한식 추천"). 있으면 질문형 제목을 하나 더 줍니다(place-geo-quick 의 소식 제목과 같은 모양).
export function feedDrafts(place, { question = null, nowMs = Date.now(), recommendation = null } = {}) {
    if (!place) return null;
    const name = String(place.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const area = placeArea(place);
    const category = place.category ? categoryLabel(place) : null;
    const month = monthOf(nowMs);
    const hours = hoursSentence(place);
    const facts = criteriaLabels(place).filter((label) => !/도보/.test(label));
    const station = stationText(place);
    const popular = popularItems(place, 3, { notMain: notMainTerms(recommendation) });
    const head = [area, category, name].filter(Boolean).join(' ');
    const drafts = [];

    // 1. 대표 메뉴(시술)·영업시간 안내
    {
        const body = [
            popular.items.length ? `${POPULAR_LEAD[popular.source](item)}${josa(item, '은', '는').slice(item.length)} ${popular.items.map(withPrice).join(', ')}입니다.` : null,
            hours,
            station,
            facts.length ? `매장 안내: ${facts.join(' · ')}.` : null,
            `(새 ${item}·휴무가 있으면 날짜·가격과 함께 한 줄 — 직접 적기)`,
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
    // 2. 메뉴판에 '한정·제철'로 올린 메뉴가 있으면 그 안내
    {
        const limited = menuEntries(place).filter((menu) => LIMITED.test(menu.name)).slice(0, 3);
        if (limited.length) {
            drafts.push({
                key: 'limited',
                label: `메뉴판의 한정 ${item} 안내`,
                title: `${[area, name].filter(Boolean).join(' ')} — ${month}월 한정 ${item} 안내`,
                body: [
                    `메뉴판에 올린 한정 ${item}${josa(item, '은', '는').slice(item.length)} ${limited.map(withPrice).join(', ')}입니다.`,
                    '(언제까지인지·하루 몇 개인지 — 직접 적기)',
                    hours,
                ].filter(Boolean).join(' '),
            });
        }
    }
    const items = drafts.slice(0, FEED_MAX).filter((draft) => passes([draft.title, draft.body], place));
    if (items.length === 0) return null;
    const lead = popular.items[0]?.name;
    const altTitle = question ? `${question}? ${name} ${lead ? `${lead}·` : ''}위치·영업시간 안내` : null;
    return {
        kind: 'feed',
        items,
        altTitle: altTitle && passes(altTitle, place) ? altTitle : null,
    };
}

/* ───────── 메뉴(시술) 설명 틀 ───────── */

const QUANTITY = /(\d+(?:\.\d+)?\s?(?:g|kg|ml|l|pcs|pc|인분|개|마리|조각|피스|미))/i;

// 메뉴 이름·가격에서 읽히는 사실(양·구성)만 채운 한 줄 설명 틀. 맛 평가는 넣지 않습니다.
function frameOf(name, family) {
    const value = String(name);
    const quantity = value.match(QUANTITY)?.[1]?.replace(/\s+/g, '').replace(/pcs?$/i, '개') || null;
    const inner = value.match(/\(([^)]*\+[^)]*)\)/)?.[1] || null;
    const parts = (inner ? inner.split('+') : value.includes('+') ? value.split('+') : [])
        .map((part) => part.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
    const beauty = family === 'hair' || family === 'nail' || family === 'skin';
    const fields = beauty
        ? [
            parts.length ? `구성 ${parts.join(' + ')}` : `포함 내용 ${BLANK}`,
            `걸리는 시간 ${BLANK}`,
        ]
        : [
            `재료 ${BLANK}`,
            `양 ${quantity || `${BLANK} — 몇 인분·몇 g`}`,
            parts.length ? `구성 ${parts.join(' + ')}` : null,
        ];
    return fields.filter(Boolean).join(' · ');
}

// 인기 메뉴(결제·예약·리뷰 기준)로 설명 틀을 만듭니다. 어느 메뉴에 이미 설명이 있는지는 받은 자료로 알 수 없어,
// "설명이 비어 있는 것만 채우세요"라고 함께 적습니다.
export function menuFrames(place, { recommendation = null } = {}) {
    if (!place) return null;
    const menus = menuEntries(place);
    if (menus.length === 0) return null;
    const family = familyOf(place)?.key || null;
    const picked = [];
    const seen = new Set();
    const add = (menu) => {
        if (!menu || seen.has(menu.name) || picked.length >= MENU_FRAMES_MAX) return;
        seen.add(menu.name);
        picked.push(menu);
    };
    const popular = popularItems(place, MENU_FRAMES_MAX, { notMain: notMainTerms(recommendation) });
    for (const entry of popular.items) add(findMenu(menus, entry.name));
    // 사장님이 '추천'으로 표시한 메뉴도 넣습니다. 인기·추천이 아닌 메뉴는 넣지 않습니다.
    for (const menu of list(place.detail?.menus).filter((m) => m.recommended)) add(findMenu(menus, menu.name));
    // 설명 있는 메뉴가 하나도 없으면 모든 메뉴가 대상이라 등록 순서대로 채웁니다.
    if (place.menuDescribedCount === 0) for (const menu of menus) add(menu);
    const rows = picked.map((menu) => ({ name: menu.name, price: menu.price, frame: frameOf(menu.name, family) }));
    return rows.length ? { kind: 'menu', rows, popularSource: popular.source } : null;
}

/* ───────── 새 키워드를 넣을 문장 ───────── */

const SHOP_WORD = /(약국|미용실|헤어|바버샵|샵|집|식당|카페|병원|의원)$/;

function regionPhrase(region, scope) {
    if (!region) return null;
    if (scope === 'station') return `${String(region).endsWith('역') ? region : `${region}역`} 근처`;
    return `${region}에 있는`;
}

// 대표키워드 말고도 소개글·소식·메뉴 설명에 새 키워드를 같은 표현으로 넣을 예문.
//   proposals: 5칸 최종안에서 새로 넣는 키워드 [{ keyword, item }] (item: recommendKeywords 의 추천 줄)
// 예문은 매장 자료로 참인 문장만 만듭니다. 그런 문장을 만들 수 없는 낱말(용도·분위기 등)은 넣을 자리만 알려 줍니다.
export function keywordPlacements(place, proposals) {
    if (!place) return [];
    const name = String(place.name || '').trim() || '우리 매장';
    const item = itemWord(place);
    const menus = menuEntries(place);
    return list(proposals).map(({ keyword, item: reco }) => {
        const term = reco?.term || null;
        const region = reco?.region || null;
        const phrase = regionPhrase(region, reco?.regionScope);
        const matched = term ? menus.filter((menu) => compact(menu.name).includes(compact(term))).slice(0, 2) : [];
        let sentence = null;
        let where = null;
        // "○○에 있는 약국입니다"처럼 매장이 무엇인지 말하는 문장은 업종·업종 대표어이거나 사장님이 등록한 키워드의 낱말일 때만 씁니다
        // ('동물약국'·'대형약국'처럼 근거로 미루어 붙인 말은 그 매장이 그렇다고 단정하지 않음).
        if (term && phrase && (['category', 'family'].includes(reco?.source) || (reco?.source === 'registered' && SHOP_WORD.test(term)))) {
            sentence = `${josa(name, '은', '는')} ${phrase} ${term}입니다.`;
            where = '소개글 첫 문장 · 소식 제목';
        } else if (term && matched.length) {
            sentence = `${region ? `${region} ` : ''}${name}의 ${term} ${item}: ${matched.map(withPrice).join(', ')}.`;
            where = `${item} 설명 · 소식 본문`;
        } else {
            const words = [region, term].filter(Boolean).join(' ') || keyword;
            where = `소식 제목·소개글에 '${words}'${josa(words, '을', '를').slice(words.length)} 그대로`;
        }
        if (sentence && !passes(sentence, place)) sentence = null;
        const basis = list(reco?.reasons).filter((reason) => reason.kind === 'fact' || reason.kind === 'review' || reason.kind === 'booking')
            .map((reason) => reason.text).slice(0, 2);
        return { keyword, sentence, where, basis };
    });
}
