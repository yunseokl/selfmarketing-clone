// 플레이스 처방전 — 플레이스 분석 결과를 사장님이 그대로 따라 할 수 있는 문서 자료로 정리합니다.
// 화면·브라우저·네트워크에 기대지 않는 순수 함수입니다(인쇄는 app/dashboard/place-insight/Prescription.js 가 맡음).
//
// 구성
//  1쪽 처방 요약(이 쪽만 떼어 줘도 뜻이 통하게): ① 핵심 진단 3줄 ② 이번 주 할 일 3개 ③ 대표키워드 5칸 최종안 ④ 4주 뒤 다시 볼 숫자
//  2쪽부터 상세: 경쟁 매장과의 차이 · 처방 상세(왜·하는 법·시간·초안) · 키워드 처방 상세 · AI 검색 준비 · 4주 실행표 · 고지
//
// 지키는 것
//  - 숫자는 모두 받은 자료에서 계산합니다. 자료가 없는 칸·구역은 통째로 뺍니다("없음" 줄을 늘어놓지 않음).
//  - 효과를 약속하는 말("순위가 오릅니다")과 검색량 이야기는 쓰지 않습니다(검색량 자료가 없음).
//  - 고르는 규칙(진단 점수·할 일 점수·5칸 유지 규칙·다시 볼 숫자)은 아래 표와 함수에 적어 두고 테스트로 고정합니다.

import { rankLocality, median } from './naver-place.js';
import { rankScope, familyOf, RANK_GOOD, RANK_WEAK } from './place-keywords.js';
import { KEYWORD_MAX } from './place-check.js';
import { REPLY_TARGET, josa } from './place-geo.js';
import { buildQuickStrategies } from './place-geo-quick.js';
import { formatNumber, agoLabel, rankLabel, itemWord } from './place-graph.js';
import {
    DRAFT_MARK, replyDrafts, introDraft, feedDrafts, menuFrames, keywordPlacements,
} from './place-prescription-drafts.js';

export { DRAFT_MARK };

export const PRESCRIPTION_TITLE = '플레이스 처방전';
export const PRESCRIPTION_BRAND = '혼잘마';

export const DIAGNOSIS_MAX = 3;
export const WEEK_MAX = 3;
export const METRICS_MIN = 3;
export const METRICS_MAX = 5;
export const DIAGNOSIS_MIN_SCORE = 40;
export const RECHECK_DAYS = 28;
export const TASK_DETAIL_MAX = 6;
export const RIVAL_KEYWORDS_SHOWN = 6;
export const EXCLUDED_SHOWN = 16;
export const AI_ITEMS_SHOWN = 3;
export const QUICK_SHOWN = 3;
// 내 위 매장의 리뷰 중간값이 내 매장의 몇 분의 1 이하일 때 핵심 진단 후보로 올리는지(내 값 ÷ 중간값 < 이 값)
export const RIVAL_GAP_RATIO = 0.5;

const LEVEL_LABEL = { high: '먼저', mid: '권장', low: '참고' };
const RULE_LABEL = {
    broad: '넓은 업종 이름', extra: '추가 메뉴', vague: '뜻이 넓음', drink: '술·음료', otherBusiness: '다른 업종 낱말',
    offMain: '주력 메뉴 아님', classification: '분류 이름', rank: '내 순위 낮은 지역',
    condition: '조건 안 맞음', rivalOnly: '상위 매장만 씀', noBlog: '근거 부족', channel: '받는 방법', merged: '겹치는 낱말', region: '지역만 바꿈',
};

/* ───────── 일의 종류별 고정값 ─────────
 * minutes: 걸리는 시간(대략, 분). 혼잘마가 일의 종류로 정한 고정값이며 매장마다 다를 수 있습니다.
 * where:   하는 곳. 앱의 다른 화면·안내에 이미 적힌 메뉴 경로까지만 씁니다(확실하지 않은 하위 메뉴는 적지 않음).
 * week:    '이번 주 할 일'로 고를 수 있는지(다른 사람이 해 줘야 하는 일은 빼고 4주 실행표에만 넣음).
 */
export const TASK_INFO = {
    keywords: { minutes: 10, where: '스마트플레이스 > 업체정보', week: true },
    reply: { minutes: 30, where: '스마트플레이스', week: true },
    feed: { minutes: 20, where: "스마트플레이스 앱(또는 관리자) > '소식'", week: true },
    description: { minutes: 20, where: '스마트플레이스 > 업체정보(소개글)', week: true },
    intro: { minutes: 10, where: '스마트플레이스 > 업체정보(소개글·한 줄 소개)', week: true },
    photos: { minutes: 30, where: '스마트플레이스', week: true },
    menuDesc: { minutes: 30, where: '스마트플레이스', week: true },
    menuAdd: { minutes: 40, where: '스마트플레이스', week: true },
    menuPrice: { minutes: 20, where: '스마트플레이스', week: true },
    menuImage: { minutes: 20, where: '스마트플레이스', week: true },
    menuRefresh: { minutes: 20, where: '스마트플레이스', week: true },
    hours: { minutes: 10, where: '스마트플레이스 > 업체정보 > 영업시간', week: true },
    accessor: { minutes: 10, where: '스마트플레이스 > 업체정보 > 찾아오는 길', week: true },
    conveniences: { minutes: 10, where: '스마트플레이스 > 업체정보', week: true },
    parking: { minutes: 10, where: '스마트플레이스 > 업체정보', week: true },
    hype: { minutes: 10, where: '스마트플레이스 > 업체정보', week: true },
    talktalk: { minutes: 10, where: '스마트플레이스', week: true },
    booking: { minutes: 30, where: '스마트플레이스', week: true },
    coupon: { minutes: 10, where: '스마트플레이스', week: true },
    blog: { minutes: 30, where: '블로그 체험단', week: false },
};

// 할 일 점수(이번 주 할 일·처방 순서): 지금 할 일의 단계 + AI 검색 점수 증가량 + 5칸 교체 + 핵심 진단과 이어짐
export const TASK_SCORE = {
    level: { high: 60, mid: 40, low: 20 },
    aiOnly: 25, // '지금 할 일'에는 없고 AI 검색 진단에만 있는 일
    gainPerPoint: 2,
    gainMax: 20,
    slotChange: 25, // 5칸 최종안에 바꿀 칸이 있을 때 대표키워드 일에 더함
    diagnosis: 15, // 핵심 진단 3줄 가운데 하나와 이어진 일
};

// '지금 할 일'(buildActionItems)의 key → 처방전 일. 키워드 일 셋은 '대표키워드 5칸 고치기' 하나로 묶습니다.
const ACTION_TASK = { keywords: 'keywords', keywordRegion: 'keywords', keywordSpoken: 'keywords' };
// AI 검색 진단(analyzeGeoAeo().actions)의 id → 처방전 일. 여기 없는 일(외부 채널·리뷰 더 받기 등)은 처방에 넣지 않습니다.
const AI_TASK = {
    napFill: 'hours', menuPrice: 'menuPrice', menuDesc: 'menuDesc', menuAdd: 'menuAdd', keywordsFill: 'keywords', keywordsMatch: 'keywords',
    talktalk: 'talktalk', booking: 'booking', coupon: 'coupon', feed: 'feed', reply: 'reply', blogRecent: 'blog', parking: 'parking',
    menuRefresh: 'menuRefresh', hype: 'hype',
};

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function list(value) {
    return Array.isArray(value) ? value : [];
}

function compact(text) {
    return String(text ?? '').replace(/\s+/g, '').toLowerCase();
}

function known(value) {
    return value !== null && value !== undefined;
}

function finite(value) {
    return Number.isFinite(value) ? value : null;
}

function two(value) {
    return String(value).padStart(2, '0');
}

function kstParts(ms) {
    const d = new Date(ms + KST_MS);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

// 'YYYY-MM-DD'(한국 날짜). 저장되는 파일 이름에 씁니다.
export function dateStamp(ms) {
    const { year, month, day } = kstParts(ms);
    return `${year}-${two(month)}-${two(day)}`;
}

// '2026년 11월 17일 14:05'(한국 시각)
export function dateTimeLabel(ms) {
    const { year, month, day, hour, minute } = kstParts(ms);
    return `${year}년 ${month}월 ${day}일 ${two(hour)}:${two(minute)}`;
}

// '12월 14일'(한국 날짜)
export function dayLabel(ms) {
    const { month, day } = kstParts(ms);
    return `${month}월 ${day}일`;
}

export function minutesLabel(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    if (minutes < 60) return `약 ${minutes}분`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `약 ${hours}시간${rest ? ` ${rest}분` : ''}`;
}

// 저장되는 PDF 의 파일 이름: "혼잘마 처방전 - 매장이름 - 2026-11-17". 파일 이름에 못 쓰는 글자는 뺍니다.
export function prescriptionFileName(name, nowMs = Date.now()) {
    const store = String(name ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return [`${PRESCRIPTION_BRAND} 처방전`, store, dateStamp(nowMs)].filter(Boolean).join(' - ');
}

// 문장 끝(마침표·물음표·느낌표 뒤 빈칸)에서 나눕니다. 따옴표 안("…"·'…')과 괄호 안에서는 나누지 않습니다.
function sentencesOf(text) {
    const out = [];
    let start = 0;
    let double = false;
    let single = false;
    let depth = 0;
    const value = String(text ?? '');
    for (let i = 0; i < value.length; i += 1) {
        const ch = value[i];
        if (ch === '"') double = !double;
        else if (ch === "'") single = !single;
        else if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if ((ch === '.' || ch === '?' || ch === '!') && !double && !single && depth === 0 && /\s/.test(value[i + 1] || '')) {
            out.push(value.slice(start, i + 1).trim());
            start = i + 1;
        }
    }
    const rest = value.slice(start).trim();
    if (rest) out.push(rest);
    return double || single ? [value.trim()].filter(Boolean) : out;
}

const HOW_SENTENCE = /(세요|면 좋습니다)[.!]?$|스마트플레이스\s*>/;

// '지금 할 일'의 설명(detail)을 "왜"(근거·이유)와 "어떻게"(할 일)로 나눕니다. 문장은 고치지 않고 그대로 옮깁니다.
export function splitAdvice(detail) {
    const why = [];
    const how = [];
    for (const sentence of sentencesOf(detail)) (HOW_SENTENCE.test(sentence) ? how : why).push(sentence);
    return { why: why.join(' ') || null, how: how.join(' ') || null };
}

// 정보 채움 상태. 화면(page.js 의 FillStatus)과 같은 항목·같은 판정입니다.
export function fillStatus(place) {
    const rows = [];
    const add = (label, ok, detail) => rows.push({ label, ok: Boolean(ok), detail });
    if (place?.missing) {
        add('영업시간', !place.missing.hours, place.missing.hours ? '비어 있음' : '등록됨');
        add('소개글', !place.missing.description, place.missing.description ? '비어 있음' : '등록됨');
        add('메뉴·가격 사진', !place.missing.menuImage, place.missing.menuImage ? '비어 있음' : '등록됨');
        add('편의시설', !place.missing.conveniences, place.missing.conveniences ? '비어 있음' : `${list(place.conveniences).length}개 등록`);
        add('찾아오는 길', !place.missing.accessor, place.missing.accessor ? '비어 있음' : '등록됨');
    }
    const businessPhotos = place?.detail?.photos?.business;
    if (known(businessPhotos)) add('업체 사진', businessPhotos > 0, businessPhotos > 0 ? `${formatNumber(businessPhotos)}장` : '없음');
    if (Array.isArray(place?.keywords)) add('대표키워드', place.keywords.length >= KEYWORD_MAX, `${place.keywords.length}/${KEYWORD_MAX}개`);
    add('톡톡 상담', place?.hasTalktalk, place?.hasTalktalk ? '연결됨' : '연결 안 됨');
    add('블로그', place?.hasBlog, place?.hasBlog ? '연결됨' : '연결 안 됨');
    return { done: rows.filter((row) => row.ok).length, total: rows.length, rows };
}

function isDone(row) {
    return row?.state === 'done' && row.result && typeof row.result === 'object';
}

function isFound(result) {
    return result?.status === 'found' && Number.isFinite(result.rank);
}

// 순위 묶음 표기: 찾은 순위는 "3·5·12위", 못 찾은 것은 "300위 밖"처럼 이어 붙입니다.
export function ranksText(results) {
    const found = results.filter(isFound).map((result) => result.rank).sort((a, b) => a - b);
    const parts = found.length ? [`${found.join('·')}위`] : [];
    for (const result of results.filter((r) => !isFound(r))) parts.push(rankLabel(result));
    return parts.join('·');
}

/* ───────── 경쟁 매장과의 차이 ───────── */

function storeValues(row) {
    return { visitor: finite(row?.visitorReviews), blog: finite(row?.blogReviews), score: finite(row?.score) };
}

function medianOf(rows, key) {
    const values = rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
    return values.length ? median(values) : null;
}

function roundScore(value) {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function roundCount(value) {
    return Number.isFinite(value) ? Math.round(value) : null;
}

// 키워드마다 1위 매장 · 내 위 매장들의 중간값 · 내 매장을 방문자 리뷰·블로그 리뷰·평점으로 비교합니다.
// 내 위 매장은 순위 결과의 상위 목록(result.top)에 있는 매장만 셉니다(목록 밖 매장은 값을 모름).
// 내 지역 검색 결과가 아닌 순위(먼 지역)는 싣지 않습니다.
export function rivalComparison({ place, doneRows }) {
    const rows = [];
    const firsts = [];
    for (const row of doneRows) {
        const result = row.result;
        if (rankLocality(result, place.coordinate)?.scope === 'far') continue;
        const found = isFound(result);
        const others = list(result.top).filter((top) => top && !top.isTarget && Number.isFinite(top.rank) && String(top.name || '').trim());
        const above = others.filter((top) => !found || top.rank < result.rank).sort((a, b) => a.rank - b.rank);
        const mine = storeValues(result.target || { visitorReviews: place.visitorReviews, blogReviews: place.blogReviews, score: place.visitorScore });
        if (found && result.rank === 1) {
            firsts.push(row.keyword);
            continue;
        }
        if (above.length === 0) continue;
        const values = above.map(storeValues);
        const first = above[0].rank === 1 ? above[0] : null;
        rows.push({
            keyword: row.keyword,
            myRank: rankLabel(result),
            found,
            first: first ? { rank: 1, name: String(first.name).trim(), category: first.category || null, ...storeValues(first) } : null,
            above: {
                count: above.length,
                from: above[0].rank,
                to: above[above.length - 1].rank,
                name: above.length === 1 ? String(above[0].name).trim() : null,
                // 리뷰 수 중간값은 짝수 개일 때 .5 가 나올 수 있어 반올림합니다.
                visitor: roundCount(medianOf(values, 'visitor')),
                blog: roundCount(medianOf(values, 'blog')),
                score: roundScore(medianOf(values, 'score')),
            },
            mine,
        });
    }
    return { rows, firsts };
}

function rangeLabel(above) {
    return above.from === above.to ? `${above.from}위 매장` : `${above.from}~${above.to}위 매장 ${above.count}곳`;
}

// 가장 큰 격차(내 값 ÷ 내 위 매장 중간값이 가장 작은 키워드)를 방문자 리뷰 → 블로그 리뷰 순으로 찾습니다.
function biggestGap(rows, key) {
    let best = null;
    for (const row of rows) {
        const mid = row.above[key];
        const mine = row.mine[key];
        if (!Number.isFinite(mid) || !Number.isFinite(mine) || mid <= mine || mid <= 0) continue;
        const ratio = mine / mid;
        if (!best || ratio < best.ratio) best = { row, ratio, mid, mine };
    }
    return best;
}

const GAP_WORD = { visitor: '방문자 리뷰', blog: '블로그·카페 리뷰' };

function gapSentence(gap, key) {
    const { above } = gap.row;
    const who = above.count === 1
        ? `${gap.row.keyword} ${above.from}위 매장(${above.name})의 ${GAP_WORD[key]}는`
        : `${gap.row.keyword} ${rangeLabel(above)}의 ${GAP_WORD[key]} 중간값은`;
    return `${who} ${formatNumber(gap.mid)}개, 내 매장은 ${formatNumber(gap.mine)}개입니다.`;
}

// ④ 의 비교 기준 칸에 쓰는 짧은 말
function gapCompare(gap) {
    const { above } = gap.row;
    return above.count === 1
        ? `${gap.row.keyword} ${above.from}위 매장 ${formatNumber(gap.mid)}개`
        : `${gap.row.keyword} ${rangeLabel(above)} 중간값 ${formatNumber(gap.mid)}개`;
}

function buildRivals({ comparison }) {
    const { rows, firsts, gapRows } = comparison;
    if (rows.length === 0 && firsts.length === 0) return null;
    const shown = rows.slice(0, RIVAL_KEYWORDS_SHOWN);
    const headline = [];
    const visitorGap = biggestGap(gapRows, 'visitor');
    if (visitorGap) headline.push(gapSentence(visitorGap, 'visitor'));
    const blogGap = biggestGap(gapRows, 'blog');
    if (blogGap) headline.push(gapSentence(blogGap, 'blog'));
    // 평점: 내 평점이 모든 키워드에서 내 위 매장 중간값보다 높으면 그 사실을 적습니다.
    const scored = rows.filter((row) => Number.isFinite(row.mine.score) && Number.isFinite(row.above.score));
    if (scored.length && scored.every((row) => row.mine.score > row.above.score)) {
        const lowest = Math.max(...scored.map((row) => row.above.score));
        headline.push(`평점은 내 매장이 ${scored[0].mine.score.toFixed(2)}점으로, 순위를 조회한 키워드 모두에서 내 위 매장 중간값(가장 높은 곳 ${lowest.toFixed(2)}점)보다 높습니다.`);
    }
    if (rows.length && !visitorGap && !blogGap) headline.push('방문자 리뷰·블로그 리뷰 수는 내 위 매장 중간값보다 적지 않습니다.');
    return {
        id: 'rivals',
        title: '경쟁 매장과의 차이',
        lead: '키워드를 검색했을 때 내 매장보다 위에 나온 매장(광고 제외)과 리뷰 수·평점을 비교했습니다. 매장 이름은 검색 결과 그대로입니다.',
        hasScore: shown.some((row) => Number.isFinite(row.mine.score) || Number.isFinite(row.above.score) || Number.isFinite(row.first?.score)),
        rows: shown.map((row) => ({
            keyword: row.keyword,
            myRank: row.myRank,
            lines: [
                row.first ? { kind: 'first', label: `1위 ${row.first.name}`, visitor: row.first.visitor, blog: row.first.blog, score: row.first.score } : null,
                row.above.count > 1 || !row.first ? {
                    kind: 'above',
                    label: row.above.count === 1 ? `${row.above.from}위 ${row.above.name}` : `${rangeLabel(row.above)} 중간값`,
                    visitor: row.above.visitor, blog: row.above.blog, score: row.above.score,
                } : null,
                { kind: 'mine', label: `내 매장 (${row.myRank})`, visitor: row.mine.visitor, blog: row.mine.blog, score: row.mine.score },
            ].filter(Boolean),
        })),
        firsts,
        headline,
        more: Math.max(0, rows.length - shown.length),
    };
}

/* ───────── 지역별 순위 ───────── */

// 순위를 조회한 키워드를 지역별로 묶습니다. 지역은 네이버가 인식한 지역 → 등록·추천 키워드의 지역 순으로 봅니다.
function rankRegions({ doneRows, recommendation, place }) {
    const regionOf = new Map();
    for (const entry of list(recommendation?.registered)) if (entry.region) regionOf.set(compact(entry.keyword), entry.region);
    for (const item of list(recommendation?.items)) if (item.region && !regionOf.has(compact(item.keyword))) regionOf.set(compact(item.keyword), item.region);
    const groups = new Map();
    for (const row of doneRows) {
        const region = String(row.result.region || regionOf.get(compact(row.keyword)) || '').trim();
        if (!region) continue;
        if (!groups.has(region)) groups.set(region, { region, rows: [] });
        groups.get(region).rows.push(row);
    }
    return [...groups.values()].map((group) => {
        const results = group.rows.map((row) => row.result);
        const found = results.filter(isFound).map((result) => result.rank);
        const best = found.length ? Math.min(...found) : null;
        return {
            ...group,
            best,
            far: group.rows.some((row) => rankLocality(row.result, place.coordinate)?.scope === 'far'),
            good: best !== null && best <= RANK_GOOD,
            weak: results.every((result) => !isFound(result) || result.rank > RANK_WEAK),
            text: ranksText(results),
        };
    });
}

// 순위가 좋은 지역이 따로 있는데 이 지역의 키워드는 모두 30위 밖인 지역(먼 지역 결과 포함)
function weakRegions(regions) {
    if (!regions.some((region) => region.good)) return [];
    return regions.filter((region) => region.weak || region.far);
}

/* ───────── ③ 대표키워드 5칸 최종안 ─────────
 * 등록한 키워드 한 칸씩:
 *   유지  지역명이 있고, 살펴볼 점이 없고, 순위가 30위 안(RANK_WEAK)이거나 아직 조회하지 않은 키워드
 *   교체  살펴볼 점(분류 이름 등)이 있거나, 지역명이 없거나, 30위 밖·순위 밖이거나, 순위 낮은 지역의 키워드
 *         → 화면의 '대신 써 볼 말'(손님이 쓰는 말 → 지역을 붙인 조합)이 있으면 그것, 없으면 추천 키워드 점수 순
 *         (대표키워드로 등록할 수 있고, 이미 쓰지 않았고, 순위 낮은 지역이 아닌 것)
 *   바꿀 후보가 없으면 유지하고 살펴볼 점만 적습니다.
 *   빈 칸은 추천 키워드 점수 순으로 채웁니다.
 */
export function slotProposal({ place, recommendation, rankOf, weak = [] }) {
    if (!Array.isArray(place?.keywords) || !recommendation) return null;
    const registered = list(recommendation.registered);
    const items = list(recommendation.items);
    const weakSet = new Set(weak.map(compact));
    const used = new Set(registered.map((entry) => compact(entry.keyword)));
    const itemOf = new Map(items.map((item) => [compact(item.keyword), item]));
    const rankText = (keyword) => {
        const row = rankOf.get(compact(keyword));
        return row ? rankLabel(row.result) : null;
    };
    const usable = (item) => item && item.registrable && !used.has(compact(item.keyword)) && !weakSet.has(compact(item.region));
    const nextItem = () => items.find(usable) || null;
    const take = (keyword) => {
        used.add(compact(keyword));
        return itemOf.get(compact(keyword)) || null;
    };
    const itemReason = (item) => list(item?.reasons).map((reason) => reason.text).slice(0, 3).join(' · ');

    const slots = registered.map((entry, index) => {
        const row = rankOf.get(compact(entry.keyword)) || null;
        const result = row?.result || null;
        const rank = result ? rankLabel(result) : null;
        const lowRank = result && (!isFound(result) || result.rank > RANK_WEAK);
        const weakRegion = entry.region && weakSet.has(compact(entry.region));
        let problem = null;
        if (entry.concern) problem = RULE_LABEL[entry.concern.rule] || '살펴볼 점';
        else if (!entry.hasRegion) problem = '지역명 없음';
        else if (lowRank) problem = isFound(result) ? `내 ${rank}` : rank;
        else if (weakRegion) problem = '순위 낮은 지역';
        if (!problem) {
            return {
                no: index + 1, now: entry.keyword, nowRank: rank, action: 'keep', next: entry.keyword, nextRank: rank,
                reason: rank ? `내 ${rank} — ${isFound(result) && result.rank <= RANK_GOOD ? '10위 안' : `${RANK_WEAK}위 안이라 유지`}` : '지역 있음 · 순위 아직 조회 안 함',
            };
        }
        // 화면의 '대신 써 볼 말'
        const preferred = [entry.spoken?.keyword, entry.suggest].filter(Boolean)
            .find((keyword) => !used.has(compact(keyword)) && !weakSet.has(compact(itemOf.get(compact(keyword))?.region)));
        let next = null;
        let basis = null;
        let item = null;
        if (preferred) {
            next = preferred;
            item = take(preferred);
            basis = entry.spoken?.keyword === preferred
                ? `블로그 후기 언급 '${entry.keyword}' ${entry.blog ?? 0}개 · '${entry.spoken.term}' ${entry.spoken.blog}개`
                : '같은 말에 지역을 붙인 조합';
            if (item && itemReason(item) && entry.spoken?.keyword !== preferred) basis = `${basis} · ${itemReason(item)}`;
        } else {
            item = nextItem();
            if (item) {
                next = item.keyword;
                take(item.keyword);
                basis = itemReason(item);
            }
        }
        const why = entry.concern ? entry.concern.reason
            : !entry.hasRegion ? '지역명이 없어 검색하는 위치마다 순위가 달라집니다.'
                : lowRank ? `${RANK_WEAK}위 밖입니다.`
                    : '순위가 좋은 지역이 따로 있습니다.';
        if (!next) {
            return { no: index + 1, now: entry.keyword, nowRank: rank, action: 'check', next: entry.keyword, nextRank: rank, problem, reason: `${problem} — ${why} 바꿀 후보가 없어 그대로 둡니다.` };
        }
        return {
            no: index + 1, now: entry.keyword, nowRank: rank, action: 'replace', next, nextRank: rankText(next), problem, item,
            reason: `${problem}${basis ? ` → ${basis}` : ''}`, why, basis,
        };
    });
    for (let no = slots.length + 1; no <= KEYWORD_MAX; no += 1) {
        const item = nextItem();
        if (!item) break;
        take(item.keyword);
        const basis = itemReason(item);
        slots.push({ no, now: null, nowRank: null, action: 'fill', next: item.keyword, nextRank: rankText(item.keyword), item, problem: '빈 칸', why: null, basis, reason: `빈 칸 → ${basis}` });
    }
    const empty = KEYWORD_MAX - slots.length;
    return {
        slots,
        changes: slots.filter((slot) => slot.action === 'replace' || slot.action === 'fill').length,
        empty: empty > 0 ? empty : 0,
        unranked: slots.filter((slot) => slot.action !== 'keep' && slot.action !== 'check' && !slot.nextRank).map((slot) => slot.next),
    };
}

const ACTION_WORD = { keep: '유지', replace: '교체', fill: '채움', check: '살펴보기' };

/* ───────── 할 일 ───────── */

function gainOf(action) {
    return action?.gain ? (action.gain.geo || 0) + (action.gain.aeo || 0) : 0;
}

function gainText(gain) {
    if (!gain) return null;
    const parts = [gain.geo > 0 ? `GEO +${gain.geo}` : null, gain.aeo > 0 ? `AEO +${gain.aeo}` : null].filter(Boolean);
    return parts.length ? `AI 검색 점검 점수 ${parts.join(' · ')}점(혼잘마 계산값)` : null;
}

// 일마다 제목·하는 법(1-2-3). 앱의 안내 문장 수준을 넘지 않게 적습니다.
function taskCopy(key, ctx) {
    const { place, activity, item, slots } = ctx;
    const visitor = activity?.visitor || null;
    const unreplied = visitor ? Math.max(0, (visitor.sampled || 0) - (visitor.replied || 0)) : null;
    const perDay = unreplied ? Math.ceil(unreplied / 7) : null;
    const changes = list(slots?.slots).filter((slot) => slot.action === 'replace' || slot.action === 'fill');
    const menuCount = place.menuCount || 0;
    switch (key) {
        case 'keywords':
            return {
                title: changes.length ? `대표키워드 ${changes.length}칸 고치기` : `대표키워드 ${KEYWORD_MAX}칸 채우기`,
                steps: [
                    changes.length
                        ? `혼잘마 플레이스 분석에서 새로 넣을 ${changes.map((slot) => `'${slot.next}'`).join(', ')}의 순위를 먼저 조회합니다.`
                        : '혼잘마 플레이스 분석의 추천 키워드에서 순위를 먼저 조회합니다.',
                    `스마트플레이스 > 업체정보의 대표키워드 칸을 1쪽 '대표키워드 5칸 최종안'대로 고칩니다(${KEYWORD_MAX}개까지 등록).`,
                    '같은 표현을 소개글·소식에도 넣습니다. 바꾼 뒤 2주쯤 지나 순위를 다시 조회하세요.',
                ],
            };
        case 'reply':
            return {
                title: unreplied ? `답글 없는 리뷰 ${formatNumber(unreplied)}개에 답글 달기` : '리뷰에 답글 달기',
                steps: [
                    unreplied ? `최근 리뷰 가운데 답글이 없는 ${formatNumber(unreplied)}개를 최근 것부터 고릅니다.` : '답글이 없는 리뷰를 최근 것부터 고릅니다.',
                    `아래 예시를 리뷰 내용에 맞게 고쳐 답글로 답니다.${perDay ? ` 하루 ${perDay}개씩이면 일주일 안에 끝납니다.` : ''}`,
                    '같은 문장을 복사해 붙이지 말고, 이름·방문 날짜처럼 손님을 알아볼 수 있는 말은 넣지 않습니다.',
                ],
            };
        case 'feed':
            return {
                title: activity?.feeds?.count === 0 ? '소식 첫 글 올리기' : '소식 1개 올리기',
                steps: [
                    "스마트플레이스 앱(또는 관리자) → '소식' → 새 소식 쓰기를 엽니다.",
                    '아래 초안의 제목·본문을 붙이고, 가격·영업시간은 오늘 기준으로 확인합니다.',
                    '그 뒤로는 매주 1개씩(적어도 2주에 1개) 올립니다.',
                ],
            };
        case 'description':
            return {
                title: '소개글 쓰기',
                steps: [
                    '스마트플레이스 업체정보의 소개글 칸을 엽니다.',
                    '아래 초안을 붙이고 사실과 다른 곳을 고칩니다. 첫 문장에 어디에 있는 어떤 매장인지가 들어가게 둡니다.',
                    "'최고·1위·유일' 같은 표현은 빼고 확인할 수 있는 사실만 씁니다.",
                ],
            };
        case 'intro':
            return {
                title: '한 줄 소개·소개글 첫 문단 다듬기',
                steps: [
                    '스마트플레이스 업체정보의 소개글·한 줄 소개 칸을 엽니다.',
                    `한 줄 소개에 대표 ${item}·지역을 사실대로 적습니다(아래 초안).`,
                    "'최고·1위·유일' 같은 표현은 빼고 확인할 수 있는 사실만 씁니다.",
                ],
            };
        case 'photos':
            return {
                title: '업체 사진 올리기',
                steps: [
                    '외관·내부·대표 상품 사진을 찍습니다.',
                    '스마트플레이스에 업체 사진으로 올립니다.',
                    '매장 화면 맨 위와 검색 목록에 보이는 사진이라, 밝고 흔들리지 않은 사진을 고릅니다.',
                ],
            };
        case 'menuDesc':
            return {
                title: `인기 ${item} 설명 쓰기`,
                steps: [
                    `스마트플레이스에 등록한 ${item} 가운데 설명이 비어 있는 것을 아래 목록 순서로 고릅니다.`,
                    item === '시술'
                        ? "시술마다 구성·걸리는 시간을 한 줄로 적습니다. 실력 평가('최고' 등)는 쓰지 않습니다."
                        : `${item}마다 재료·양·구성을 한 줄로 적습니다. 맛 평가('최고' 등)는 쓰지 않습니다.`,
                    menuCount ? `등록한 ${item} ${formatNumber(menuCount)}개 가운데 인기 ${item}부터 5개씩 채웁니다.` : `인기 ${item}부터 5개씩 채웁니다.`,
                ],
            };
        case 'menuAdd':
            return {
                title: `${item} 등록하기`,
                steps: [
                    `스마트플레이스에 대표 ${item} 5개를 이름·가격·한 줄 설명과 함께 글자로 등록합니다.`,
                    '메뉴판 사진만 올리면 AI가 읽지 못합니다. 가격은 숫자(또는 최소 가격)로 적습니다.',
                    '아래 후보는 지금 등록한 대표키워드에서 뽑은 것입니다. 실제로 다루는 것만 넣으세요.',
                ],
            };
        case 'menuPrice': {
            const unpriced = menuCount && Number.isFinite(place.menuPricedCount) ? menuCount - place.menuPricedCount : null;
            return {
                title: unpriced ? `가격 없는 ${item} ${unpriced}개에 가격 적기` : `${item} 가격 적기`,
                steps: [
                    `스마트플레이스에 등록한 ${item} 가운데 가격이 빠진 것을 찾습니다.`,
                    '"시가·문의" 대신 숫자 가격(또는 최소 가격)을 적습니다.',
                ],
            };
        }
        case 'menuImage':
            return { title: '메뉴·가격 사진 올리기', steps: ['메뉴판이나 가격표를 찍습니다.', '스마트플레이스에 메뉴 사진으로 올립니다.'] };
        case 'menuRefresh':
            return { title: `${item} 가격·사진 점검`, steps: [`스마트플레이스의 ${item} 가격·사진을 지금 기준으로 확인합니다.`, '가격이 바뀌었다면 고쳐서 다시 저장합니다.'] };
        case 'hours':
            return { title: '영업시간 등록', steps: ['스마트플레이스 > 업체정보 > 영업시간을 엽니다.', '요일별 시간·브레이크타임·정기휴무까지 넣습니다.'] };
        case 'accessor':
            return { title: '찾아오는 길 적기', steps: ['스마트플레이스 > 업체정보 > 찾아오는 길을 엽니다.', '주차 위치·가까운 정류장·건물 입구를 적습니다.'] };
        case 'conveniences':
            return { title: '편의시설 체크', steps: ['스마트플레이스 업체정보에서 편의시설을 엽니다.', '주차·포장·예약·단체석처럼 해당하는 항목을 체크합니다.'] };
        case 'parking':
            return { title: '주차·편의시설 등록', steps: ['스마트플레이스 업체정보에서 주차·편의시설을 엽니다.', '주차가 안 되면 "주차 불가, 근처 주차장"처럼 대안을 적습니다.'] };
        case 'hype':
            return { title: '광고성 표현 빼기', steps: ['대표키워드·한 줄 소개·소식 제목에서 아래 표현을 찾습니다.', '확인할 수 있는 사실(위치·시간·가격)로 바꿉니다.'] };
        case 'talktalk':
            return { title: '네이버 톡톡 연결', steps: ['스마트플레이스에서 톡톡을 켭니다.', '휴대폰 알림을 받게 해 두면 답이 빨라집니다.'] };
        case 'booking':
            return { title: '네이버 예약 켜기', steps: ['스마트플레이스에서 네이버 예약을 켭니다.', '받을 수 있는 시간·자리만 열어 둡니다.'] };
        case 'coupon':
            return { title: '쿠폰 1개 등록', steps: ['스마트플레이스에서 쿠폰을 만듭니다. 대상·혜택은 사장님이 정합니다.', '별점·리뷰 문구를 쿠폰 조건으로 걸지 않습니다.'] };
        case 'blog':
            return { title: '블로그 후기 받기', steps: ['체험단·방문 후기로 블로그 글이 꾸준히 쌓이게 합니다.', "대가가 있으면 글에 '광고·협찬'을 꼭 밝히게 하고, 별점·문구는 정해 주지 않습니다."] };
        default:
            return { title: null, steps: [] };
    }
}

function buildTasks({ place, activity, actions, geo, slots, diagnoses, item }) {
    const tasks = new Map();
    const ensure = (key) => {
        if (!TASK_INFO[key]) return null;
        if (!tasks.has(key)) tasks.set(key, { key, level: null, problems: [], why: [], how: [], gain: { geo: 0, aeo: 0 }, aiOnly: true, aiTitle: null });
        return tasks.get(key);
    };
    const LEVEL_ORDER = { high: 0, mid: 1, low: 2 };
    for (const action of actions) {
        const task = ensure(ACTION_TASK[action.key] || action.key);
        if (!task) continue;
        task.aiOnly = false;
        if (!task.level || LEVEL_ORDER[action.level] < LEVEL_ORDER[task.level]) task.level = action.level;
        task.problems.push(action.title);
        const { why, how } = splitAdvice(action.detail);
        if (why) task.why.push(why);
        if (how) task.how.push(how);
    }
    for (const action of list(geo?.actions)) {
        if (action.manual) continue;
        let key = AI_TASK[action.id];
        if (action.id === 'intro') key = tasks.has('description') ? 'description' : 'intro';
        if (!key) continue;
        const task = ensure(key);
        if (!task) continue;
        if (action.gain) {
            task.gain.geo += action.gain.geo || 0;
            task.gain.aeo += action.gain.aeo || 0;
        }
        if (task.aiOnly) {
            task.level = task.level || action.level;
            task.aiTitle = task.aiTitle || action.title;
            if (action.now && action.target) task.problems.push(`지금 ${action.now} → 목표 ${action.target}`);
            if (action.how) task.how.push(action.how);
        } else if (action.now && action.target) {
            task.why.push(`AI 검색 점검: 지금 ${action.now} → 목표 ${action.target}`);
        }
    }
    if (slots?.changes > 0) {
        const task = ensure('keywords');
        if (task.aiOnly) {
            task.aiOnly = false;
            task.level = task.level || 'mid';
        }
        // 왜: 바꿀 칸마다 지금의 문제(예: "압구정횟집 내 41위 · 압구정회식 300위 밖")
        // 같은 문제가 여러 칸이면 "분류 이름 4칸"처럼 묶습니다.
        const changed = slots.slots.filter((slot) => slot.action === 'replace' || slot.action === 'fill');
        const byProblem = new Map();
        for (const slot of changed) byProblem.set(slot.problem, [...(byProblem.get(slot.problem) || []), slot]);
        const parts = [...byProblem.entries()].map(([problem, group]) => (group.length > 1 || !group[0].now ? `${problem} ${group.length}칸` : `${group[0].now} ${problem}`));
        task.why.unshift(`${parts.join(' · ')}.`);
    }
    // 점검 점수가 오르지 않고 '지금 할 일'에도 없는 AI 검색 일은 처방에 넣지 않습니다(AI 검색 준비 구역에서 다룸).
    for (const [key, task] of tasks) if (task.aiOnly && gainOf(task) <= 0) tasks.delete(key);

    const diagTasks = new Set(diagnoses.map((diag) => diag.task).filter(Boolean));
    const ctx = { place, activity, item, slots };
    const scored = [...tasks.values()].map((task, index) => {
        const base = task.aiOnly ? TASK_SCORE.aiOnly : TASK_SCORE.level[task.level] ?? TASK_SCORE.level.low;
        const gain = Math.min(TASK_SCORE.gainMax, TASK_SCORE.gainPerPoint * gainOf(task));
        const slot = task.key === 'keywords' && slots?.changes > 0 ? TASK_SCORE.slotChange : 0;
        const diag = diagTasks.has(task.key) ? TASK_SCORE.diagnosis : 0;
        const copy = taskCopy(task.key, ctx);
        const info = TASK_INFO[task.key];
        return {
            key: task.key,
            level: task.level || 'low',
            levelLabel: LEVEL_LABEL[task.level] || LEVEL_LABEL.low,
            title: copy.title || task.aiTitle || task.problems[0] || task.key,
            problem: task.problems[0] || null,
            why: [...new Set(task.why)],
            how: [...new Set(task.how)],
            steps: copy.steps,
            minutes: info.minutes,
            timeLabel: minutesLabel(info.minutes),
            where: info.where,
            weekOk: info.week,
            gain: gainText(gainOf(task) > 0 ? task.gain : null),
            score: base + gain + slot + diag,
            index,
        };
    });
    return scored.sort((a, b) => b.score - a.score || a.index - b.index);
}

/* ───────── ① 핵심 진단 ─────────
 * 후보마다 점수를 매겨 높은 것부터 3개(같은 묶음은 하나만, 점수 DIAGNOSIS_MIN_SCORE 미만은 뺌).
 *   rankGap      순위가 좋은 지역(10위 안)과 30위 밖뿐인 지역이 함께 있음        90
 *   rankWeak     (rankGap 이 없을 때) 대표키워드 가운데 10위 밖                 50 + 8 × 개수(최대 74)
 *   reply        답글률 50% 미만(최근 리뷰 10개 이상)                         55 + (50 − 답글률) × 0.6
 *   description  소개글 비어 있음                                          80
 *   introLine    한 줄 소개 비어 있음(소개글은 있음)                           42
 *   keywordRegion 대표키워드에 지역명이 하나도 없음                            78
 *   keywordsEmpty 대표키워드 5칸을 다 채우지 않음                             65
 *   photos       업체 사진 0장                                            75
 *   aiGap        AI 질문 가운데 답할 정보가 없는 것 2개 이상                    40 + 12 × 개수(최대 80)
 *   feed         소식 없음 70 · 30일 넘게 없음 52 + (일수 − 30) ÷ 3(최대 +18)
 *   menuDesc     설명 있는 메뉴가 절반 미만(메뉴 5개 이상)                      45 + (1 − 비율) × 15
 *   rivalGap     내 방문자 리뷰가 내 위 매장 중간값의 절반 미만                   40 + (1 − 비율) × 20
 *   blogStale    최근 30일 블로그·카페 후기 0개                              50
 */
const DIAG_GROUP = {
    rankGap: 'rank', rankWeak: 'rank', keywordRegion: 'keywords', keywordsEmpty: 'keywords', description: 'intro', introLine: 'intro',
};

const FANOUT_SHORT = {
    location: '위치', hours: '영업시간', price: '가격대', reputation: '평판', parking: '주차·편의시설', booking: '예약·문의', payment: '쿠폰·혜택',
};

export function diagnosisCandidates({ place, activity, recommendation, rankOf, regions, comparison, geo, item }) {
    const out = [];
    const add = (key, score, text, basis = null, task = null) => out.push({ key, group: DIAG_GROUP[key] || key, score: Math.round(score * 10) / 10, text, basis, task });

    // 순위
    const weak = weakRegions(regions);
    if (weak.length) {
        const good = regions.filter((region) => region.good).sort((a, b) => a.best - b.best)[0];
        const bad = weak.sort((a, b) => (b.best ?? Infinity) - (a.best ?? Infinity))[0];
        const registeredBad = list(place.keywords).filter((keyword) => bad.rows.some((row) => compact(row.keyword) === compact(keyword))).length;
        const basis = [
            registeredBad ? `대표키워드 ${registeredBad}칸이 순위가 낮은 지역(${bad.region})에 쓰이고 있습니다.` : null,
            bad.far ? `${bad.region} 키워드는 내 지역 검색 결과가 아닙니다(상위 매장이 멀리 있음).` : null,
        ].filter(Boolean).join(' ') || null;
        add('rankGap', 90, `${good.region} 키워드는 ${good.text}인데 ${bad.region} 키워드는 ${bad.text}입니다.`, basis, 'keywords');
    } else {
        const registered = new Set(list(place.keywords).map(compact));
        const rows = [...rankOf.values()].filter((row) => registered.has(compact(row.keyword)));
        const outside = rows.filter((row) => !isFound(row.result) || row.result.rank > RANK_GOOD);
        if (outside.length) {
            const names = outside.map((row) => `${row.keyword} ${rankLabel(row.result)}`);
            const text = rows.length === 1
                ? `대표키워드 ${josa(outside[0].keyword, '은', '는')} ${josa(rankLabel(outside[0].result), '으로', '로')} 10위 밖입니다.`
                : `순위를 조회한 대표키워드 ${rows.length}개 중 ${outside.length}개가 10위 밖입니다: ${names.join(', ')}.`;
            add('rankWeak', Math.min(74, 50 + 8 * outside.length), text, null, 'keywords');
        }
    }

    // 답글
    const visitor = activity?.visitor;
    if (visitor && visitor.sampled >= 10 && Number.isFinite(visitor.replyRate) && visitor.replyRate < 50) {
        const missing = visitor.sampled - (visitor.replied || 0);
        add('reply', 55 + (50 - visitor.replyRate) * 0.6, `사장님 답글률 ${visitor.replyRate}%: 최근 리뷰 ${formatNumber(visitor.sampled)}개 중 ${formatNumber(missing)}개에 답글이 없습니다.`, null, 'reply');
    }

    // 소개글
    const detail = place.detail || {};
    if (place.missing?.description || detail.descriptionLength === 0) {
        add('description', 80, '소개글이 비어 있습니다.', '무엇을 하는 곳인지·찾아오는 길을 알려 줄 매장 설명이 없습니다.', 'description');
    } else if (!place.intro && geo) {
        add('introLine', 42, '매장 이름 아래 한 줄 소개가 비어 있습니다.', null, 'intro');
    }

    // 대표키워드
    const registered = list(recommendation?.registered);
    if (recommendation && list(recommendation.regions).length && registered.length && !recommendation.hasRegionKeyword) {
        const ranked = list(recommendation.items)
            .filter((entry) => entry.region && rankOf.has(compact(entry.keyword)) && isFound(rankOf.get(compact(entry.keyword)).result))
            .slice(0, 2)
            .map((entry) => `'${entry.keyword}'${josa(entry.keyword, '은', '는').slice(entry.keyword.length)} 내 ${rankOf.get(compact(entry.keyword)).result.rank}위`);
        add('keywordRegion', 78, `대표키워드 ${registered.length}개 모두 지역명이 없습니다.`, ranked.length ? `지역을 붙인 ${ranked.join(', ')}입니다.` : null, 'keywords');
    }
    if (Array.isArray(place.keywords) && place.keywords.length < KEYWORD_MAX) {
        add('keywordsEmpty', 65, `대표키워드를 ${KEYWORD_MAX}칸 중 ${place.keywords.length}칸만 채웠습니다.`, null, 'keywords');
    }

    // 사진
    const businessPhotos = detail.photos?.business;
    if (businessPhotos === 0) {
        const media = detail.photos?.visitorMedia;
        add('photos', 75, `사장님이 올린 업체 사진이 0장입니다.`, media ? `손님이 올린 사진·영상은 ${formatNumber(media)}개입니다.` : null, 'photos');
    }

    // AI 질문
    const fanout = list(geo?.fanout).filter((entry) => entry.status !== 'unknown');
    const empty = fanout.filter((entry) => entry.status === 'no');
    if (empty.length >= 2) {
        const names = empty.map((entry) => (entry.key === 'signature' ? `대표 ${item}` : FANOUT_SHORT[entry.key] || entry.key));
        const task = empty.some((entry) => entry.key === 'signature' || entry.key === 'price') ? 'menuAdd' : null;
        add('aiGap', Math.min(80, 40 + 12 * empty.length), `손님이 AI에게 묻는 질문 ${fanout.length}개 중 ${empty.length}개(${names.join('·')})에 답할 정보가 없습니다.`, null, task);
    }

    // 소식
    const feeds = activity?.feeds;
    if (feeds) {
        if (feeds.count === 0) add('feed', 70, '소식을 한 번도 올리지 않았습니다.', null, 'feed');
        else if (Number.isFinite(feeds.daysSinceLatest) && feeds.daysSinceLatest > 30) {
            // 소식 제목은 짧을 때만 따옴표로 옮깁니다(긴 제목이 1쪽을 밀어내지 않게). 길면 올린 날짜만 적습니다.
            const title = String(feeds.latestTitle || '').trim();
            const when = feeds.latest ? `${Number(feeds.latest.slice(5, 7))}월 ${Number(feeds.latest.slice(8, 10))}일` : null;
            const tail = title && title.length <= FEED_TITLE_MAX ? `: 마지막 소식은 "${title}"입니다.` : when ? `: 마지막 소식은 ${when}에 올렸습니다.` : '.';
            add('feed', 52 + Math.min(18, (feeds.daysSinceLatest - 30) / 3), `소식 ${feeds.daysSinceLatest}일째 없음${tail}`, null, 'feed');
        }
    }

    // 메뉴 설명
    const menuCount = place.menuCount || 0;
    if (menuCount >= 5 && Number.isFinite(place.menuDescribedCount) && place.menuDescribedCount / menuCount < 0.5) {
        const ratio = place.menuDescribedCount / menuCount;
        add('menuDesc', 45 + (1 - ratio) * 15, `등록한 ${item} ${formatNumber(menuCount)}개 중 ${formatNumber(menuCount - place.menuDescribedCount)}개에 설명이 없습니다.`, null, 'menuDesc');
    }

    // 경쟁 격차
    const gap = biggestGap(comparison.gapRows, 'visitor');
    if (gap && gap.ratio < RIVAL_GAP_RATIO) add('rivalGap', 40 + (1 - gap.ratio) * 20, gapSentence(gap, 'visitor'), null, null);

    // 블로그
    const blog = activity?.blog;
    if (blog && known(blog.total) && blog.last30 === 0) add('blogStale', 50, '최근 30일 블로그·카페 후기가 없습니다.', null, 'blog');

    return out.sort((a, b) => b.score - a.score);
}

export function pickDiagnoses(candidates) {
    const picked = [];
    const groups = new Set();
    for (const candidate of candidates) {
        if (candidate.score < DIAGNOSIS_MIN_SCORE || groups.has(candidate.group)) continue;
        groups.add(candidate.group);
        picked.push(candidate);
        if (picked.length >= DIAGNOSIS_MAX) break;
    }
    return picked;
}

/* ───────── ④ 4주 뒤 다시 볼 숫자 ─────────
 * 핵심 진단·이번 주 할 일과 이어진 숫자를 먼저, 모자라면 방문자 리뷰 → 블로그 리뷰 → 10위 안 키워드 → AI 검색 점수 순으로 채웁니다(3~5개).
 * 비교 기준은 자료에 있는 값(내 위 매장 중간값)과 혼잘마 점검 기준(답글률 80%)만 씁니다. 없으면 비웁니다.
 */
export function pickMetrics({ place, activity, rankOf, comparison, geo, diagnoses, week, item }) {
    const metrics = new Map();
    const add = (key, label, now, compare = null, note = null, compareShort = null) => {
        if (!metrics.has(key) && now) metrics.set(key, { key, label, now, compare, note, compareShort });
    };
    // 비교 기준의 짧은 꼴(키워드 이름 없이). 1쪽이 넘칠 때 fitSummary 가 씁니다.
    const shortCompare = (gap) => (gap.row.above.count === 1 ? `${gap.row.above.from}위 매장 ${formatNumber(gap.mid)}개` : `${rangeLabel(gap.row.above)} 중간값 ${formatNumber(gap.mid)}개`);
    const visitor = activity?.visitor;
    const visitorGap = biggestGap(comparison.gapRows, 'visitor');
    const blogGap = biggestGap(comparison.gapRows, 'blog');
    const registered = new Set(list(place.keywords).map(compact));
    const rankedRows = [...rankOf.values()].filter((row) => registered.has(compact(row.keyword)));
    const allRows = [...rankOf.values()];
    const rankRows = rankedRows.length ? rankedRows : allRows;
    const make = {
        reply: () => visitor && Number.isFinite(visitor.replyRate)
            && add('reply', '사장님 답글률', `${visitor.replyRate}% (최근 ${formatNumber(visitor.sampled)}개 중 ${formatNumber(visitor.replied || 0)}개)`, `혼잘마 점검 기준 ${REPLY_TARGET}% 이상`),
        feed: () => activity?.feeds && add('feed', '최근 30일 소식', `${formatNumber(activity.feeds.last30 ?? 0)}개${activity.feeds.daysSinceLatest ? ` (마지막 ${activity.feeds.daysSinceLatest}일 전)` : ''}`),
        rank: () => {
            if (!rankRows.length) return;
            const outside = rankRows.filter((row) => !isFound(row.result) || row.result.rank > RANK_GOOD);
            add('rank', rankedRows.length ? '10위 안 대표키워드' : '10위 안 키워드', `${rankRows.length - outside.length}/${rankRows.length}개`, null,
                outside.length ? `10위 밖: ${outside.map((row) => `${row.keyword} ${rankLabel(row.result)}`).join(' · ')}` : null);
        },
        keywords: () => list(place.keywords).length > 0
            && add('keywords', '지역명이 든 대표키워드', `${countRegionKeywords(place, comparison.recommendation)}/${place.keywords.length}개`),
        visitor: () => known(place.visitorReviews) && add('visitor', '방문자 리뷰', `${formatNumber(place.visitorReviews)}개`,
            visitorGap ? gapCompare(visitorGap) : null, null, visitorGap ? shortCompare(visitorGap) : null),
        blog: () => known(place.blogReviews) && add('blog', '블로그·카페 리뷰', `${formatNumber(place.blogReviews)}개${activity?.blog && Number.isFinite(activity.blog.last30) ? ` (최근 30일 ${activity.blog.last30}개)` : ''}`,
            blogGap ? gapCompare(blogGap) : null, null, blogGap ? shortCompare(blogGap) : null),
        ai: () => geo && known(geo.geo?.score) && known(geo.aeo?.score) && add('ai', 'AI 검색 준비 점수', `GEO ${geo.geo.score} · AEO ${geo.aeo.score}점`),
        aiGap: () => {
            const fanout = list(geo?.fanout).filter((entry) => entry.status !== 'unknown');
            if (fanout.length) add('aiGap', 'AI 질문 중 답이 없는 것', `${fanout.filter((entry) => entry.status === 'no').length}/${fanout.length}개`);
        },
        menuDesc: () => place.menuCount > 0 && Number.isFinite(place.menuDescribedCount)
            && add('menuDesc', `설명 있는 ${item}`, `${formatNumber(place.menuDescribedCount)}/${formatNumber(place.menuCount)}개`),
        photos: () => known(place.detail?.photos?.business) && add('photos', '업체 사진', `${formatNumber(place.detail.photos.business)}장`),
    };
    const LINK = {
        rankGap: 'rank', rankWeak: 'rank', reply: 'reply', feed: 'feed', description: 'ai', introLine: 'ai', keywordRegion: 'keywords',
        keywordsEmpty: 'keywords', photos: 'photos', aiGap: 'aiGap', menuDesc: 'menuDesc', rivalGap: 'visitor', blogStale: 'blog',
    };
    const TASK_LINK = { reply: 'reply', feed: 'feed', keywords: 'rank', menuDesc: 'menuDesc', description: 'ai', intro: 'ai', photos: 'photos', menuAdd: 'aiGap' };
    for (const diag of diagnoses) make[LINK[diag.key]]?.();
    for (const task of week) make[TASK_LINK[task.key]]?.();
    // 경쟁 매장 중간값이 있는 리뷰 수는 비교 기준이 있어 함께 싣습니다.
    if (visitorGap) make.visitor();
    if (blogGap) make.blog();
    for (const key of ['visitor', 'blog', 'rank', 'ai']) {
        if (metrics.size >= METRICS_MIN) break;
        make[key]();
    }
    return [...metrics.values()].slice(0, METRICS_MAX);
}

function countRegionKeywords(place, recommendation) {
    const byKeyword = new Map(list(recommendation?.registered).map((entry) => [compact(entry.keyword), entry]));
    return list(place.keywords).filter((keyword) => byKeyword.get(compact(keyword))?.hasRegion).length;
}

/* ───────── 상세: 처방 ───────── */

function attachDrafts(task, ctx) {
    const { place, activity, geo, nowMs, recommendation } = ctx;
    switch (task.key) {
        case 'reply':
            return replyDrafts(place, { recommendation });
        case 'feed':
            return feedDrafts(place, { question: geo?.question || null, nowMs, recommendation });
        case 'description':
        case 'intro':
            return introDraft(place, activity, { recommendation });
        case 'menuDesc':
            return menuFrames(place, { recommendation });
        case 'menuAdd': {
            const names = list(place.keywords).filter((keyword) => !list(recommendation?.registered).find((entry) => compact(entry.keyword) === compact(keyword))?.hasRegion);
            return names.length ? { kind: 'list', label: `등록할 ${itemWord(place)} 후보(지금 대표키워드)`, items: names } : null;
        }
        case 'hype':
            return list(geo?.hype).length ? { kind: 'list', label: '찾은 표현', items: [...new Set(geo.hype.map((entry) => `"${entry.word}" (${entry.where})`))] } : null;
        default:
            return null;
    }
}

function buildTaskSection(tasks, ctx) {
    if (tasks.length === 0) return null;
    const detailed = tasks.slice(0, TASK_DETAIL_MAX).map((task) => ({ ...task, draft: attachDrafts(task, ctx) }));
    return {
        id: 'tasks',
        title: '처방 상세',
        lead: `할 일마다 왜 해야 하는지(근거 숫자), 하는 법, 걸리는 시간, 바로 쓸 초안을 적었습니다. 초안은 "${DRAFT_MARK}".`,
        items: detailed,
        rest: tasks.slice(TASK_DETAIL_MAX).map((task) => ({ key: task.key, title: task.title, timeLabel: task.timeLabel, where: task.where, how: task.how[0] || task.steps[0] || null })),
    };
}

/* ───────── 상세: 키워드 처방 ───────── */

function excludedPart(recommendation) {
    const excluded = list(recommendation?.excluded);
    if (excluded.length === 0 || list(recommendation?.regions).length === 0) return null;
    const shownAbove = new Set(list(recommendation.registered).filter((entry) => entry.concern).map((entry) => compact(entry.core || entry.keyword)));
    const kept = excluded.filter((entry) => entry.term && !shownAbove.has(compact(entry.term)));
    if (kept.length === 0) return null;
    const groups = [];
    for (const entry of kept.slice(0, EXCLUDED_SHOWN)) {
        const label = RULE_LABEL[entry.rule] || '추천 제외';
        let group = groups.find((other) => other.label === label);
        if (!group) {
            group = { label, terms: [] };
            groups.push(group);
        }
        group.terms.push(entry.into ? `${entry.term} → ${entry.into}` : entry.term);
    }
    return { groups, more: Math.max(0, kept.length - EXCLUDED_SHOWN) };
}

function buildKeywordSection({ place, slots, recommendation }) {
    const changes = list(slots?.slots).filter((slot) => slot.action === 'replace' || slot.action === 'fill');
    const placements = keywordPlacements(place, changes.map((slot) => ({ keyword: slot.next, item: slot.item })));
    const excluded = excludedPart(recommendation);
    const rows = list(slots?.slots).filter((slot) => slot.action !== 'keep');
    if (rows.length === 0 && placements.length === 0 && !excluded) return null;
    return {
        id: 'keywords',
        title: '키워드 처방 상세',
        rows: rows.map((slot) => ({
            no: slot.no, now: slot.now, nowRank: slot.nowRank, action: ACTION_WORD[slot.action], next: slot.next, nextRank: slot.nextRank,
            problem: slot.problem || null, why: slot.why || null, basis: slot.action === 'check' ? slot.reason : slot.basis || null,
        })),
        placements,
        unranked: slots?.unranked || [],
        notes: [
            '지역명이 들어간 대표키워드는 네이버가 수정할 수 있으니 소개글·소식에도 같은 표현을 함께 쓰세요.',
            "'맛집'·'잘하는' 같은 홍보성 표현은 대표키워드 등록이 거절될 수 있어 넣지 않았습니다.",
        ],
        excluded,
    };
}

/* ───────── 상세: AI 검색 준비 ───────── */

const STATUS_WORD = { no: '답 없음', partial: '일부만' };

// 리뷰를 더 받는 일에 붙이는 주의(lib/place-geo.js 리뷰 요청 안내의 "할인·서비스를 조건으로 별점·문구를 정해 주면 정책 위반입니다"와 같은 뜻)
const REVIEW_ASK_ACTIONS = new Set(['reviewsMore', 'textReview', 'reviewAsk']);
export const REVIEW_ASK_CAUTION = '"솔직한 후기 부탁드려요"만 적으세요. 리뷰를 조건으로 할인·서비스를 주거나 별점·문구를 정해 주면 정책 위반입니다.';

function buildAi({ place, activity, geo, tasks, nowMs }) {
    if (!geo) return null;
    const scores = [
        { key: 'geo', label: 'GEO · 추천 목록에 들 준비', score: geo.geo?.score, grade: geo.geo?.label },
        { key: 'aeo', label: 'AEO · 질문에 바로 답할 준비', score: geo.aeo?.score, grade: geo.aeo?.label },
    ].filter((entry) => known(entry.score));
    if (scores.length === 0) return null;
    const questions = list(geo.fanout)
        .filter((entry) => entry.status === 'no' || entry.status === 'partial')
        .map((entry) => ({ key: entry.key, question: entry.question, status: STATUS_WORD[entry.status], now: entry.answer || null, fix: entry.fix }));
    const taskKeys = new Set(tasks.map((task) => task.key));
    const more = list(geo.actions)
        .filter((action) => !action.manual && gainOf(action) > 0 && !taskKeys.has(AI_TASK[action.id]) && !(action.id === 'intro' && (taskKeys.has('description') || taskKeys.has('intro'))))
        .slice(0, AI_ITEMS_SHOWN)
        .map((action) => ({
            id: action.id, title: action.title, now: action.now || null, target: action.target || null,
            caution: REVIEW_ASK_ACTIONS.has(action.id) ? REVIEW_ASK_CAUTION : null,
        }));
    const quick = buildQuickStrategies(place, activity, { atomic: geo.atomic, fanout: geo.fanout, nowMs })
        .filter((strategy) => strategy.platform === 'naver' && !strategy.needs)
        .slice(0, QUICK_SHOWN)
        .map((strategy) => ({ id: strategy.id, title: strategy.title, timeLabel: minutesLabel(strategy.effortMinutes) }));
    return {
        id: 'ai',
        title: 'AI 검색 준비',
        lead: geo.question ? `손님이 AI에게 "${geo.question}"을 물을 때 내 매장 정보로 답할 수 있는지 봅니다.` : null,
        scores,
        questions,
        more,
        quick,
    };
}

/* ───────── 상세: 4주 실행표 ───────── */

function buildPlan({ week, tasks, activity, rankOf, recheckLabel, metricsCount }) {
    if (tasks.length === 0 && !activity && rankOf.size === 0) return null;
    const weekKeys = new Set(week.map((task) => task.key));
    const rest = tasks.filter((task) => !weekKeys.has(task.key));
    const weeks = [
        { no: 1, items: week.map((task) => ({ title: task.title, timeLabel: task.timeLabel })) },
        { no: 2, items: rest.slice(0, 2).map((task) => ({ title: task.title, timeLabel: task.timeLabel })) },
        { no: 3, items: rest.slice(2, 4).map((task) => ({ title: task.title, timeLabel: task.timeLabel })) },
        {
            no: 4,
            items: [
                ...rest.slice(4, 6).map((task) => ({ title: task.title, timeLabel: task.timeLabel })),
                { title: `${recheckLabel}에 혼잘마 플레이스 분석으로 다시 조회하고 1쪽 '4주 뒤 다시 볼 숫자'에 적기`, timeLabel: minutesLabel(15), recheck: true },
            ],
        },
    ];
    const repeat = [
        activity?.feeds ? { title: '소식 1개 올리기', timeLabel: minutesLabel(TASK_INFO.feed.minutes) } : null,
        activity?.visitor ? { title: '새 리뷰에 답글 달기', timeLabel: minutesLabel(10) } : null,
        rankOf.size ? { title: '대표키워드 순위 한 번 조회', timeLabel: minutesLabel(5) } : null,
    ].filter(Boolean);
    return {
        id: 'plan',
        title: '4주 실행표',
        lead: '끝낸 일은 네모 칸에 표시하세요. 위 주의 일이 남았으면 다음 주로 넘겨도 됩니다. 걸리는 시간은 일의 종류로 정한 대략값입니다.',
        weeks: weeks.filter((entry) => entry.items.length),
        repeat,
        more: Math.max(0, rest.length - 6),
        recheck: { label: recheckLabel, metrics: metricsCount },
    };
}

/* ───────── 1쪽을 한 쪽 안에 ─────────
 * 1쪽(처방 요약)은 자료 단계에서 한 쪽에 들어가게 맞춥니다(화면에서 말줄임(…)으로 자르지 않음).
 *  1) 칸마다 글자 수 상한: 덧붙임 조각(' · '로 이은 근거, 키워드 이름 목록)을 통째로 빼서 맞춥니다. 문장 가운데를 자르지 않습니다.
 *     이번 주 할 일의 이유가 길면 짧은 문제 이름(예: '리뷰 답글률 40%')으로 바꿉니다.
 *  2) 줄 수로 1쪽 높이를 어림해(PAGE1_BUDGET_MM) 넘치면 덜 중요한 것부터 뺍니다:
 *     다시 볼 숫자 5번째 줄 → 5칸 아래 안내 → 다시 볼 숫자의 메모 → 진단 덧붙임 줄(아래부터) → 다시 볼 숫자 4번째 줄.
 * 어림 값은 견본 3종과 긴 견본(tests/place-prescription.fixtures.mjs 의 LONG)의 실제 인쇄 높이에 맞춘 넉넉한 값입니다.
 */
export const PAGE1_BUDGET_MM = 265; // A4 297mm − 위아래 여백 26mm = 271mm, 어림 오차를 감안해 6mm 남김
export const FEED_TITLE_MAX = 16;
const CAP = { diagBasis: 56, weekWhy: 34, slotReason: 40, metricNote: 40, metricCompare: 34 };

// ' · '로 이은 조각을 앞에서부터 max 글자까지(조각 단위)
function capParts(text, max, sep = ' · ') {
    const value = String(text || '');
    if (value.length <= max) return value;
    const parts = value.split(sep);
    let out = parts[0];
    for (const part of parts.slice(1)) {
        if (`${out}${sep}${part}`.length > max) break;
        out = `${out}${sep}${part}`;
    }
    return out;
}

function lines(text, perLine) {
    const length = String(text || '').length;
    return length ? Math.ceil(length / perLine) : 0;
}

// 1쪽 높이 어림(mm). 실제 인쇄에서 잰 값(머리 23.1 · 구역 제목 7.4 + 구역 사이 3 · 진단 한 줄 8.2 · 할 일 13 ·
// 표 머리 6.6 · 표 한 줄 7.4, 두 줄 11.6)에 맞추고, 한 줄에 들어가는 글자 수는 실측보다 조금 적게 잡았습니다(넉넉한 쪽으로 틀리게).
export function estimatePage1Parts(doc, summary) {
    const store = doc.store;
    const parts = {
        head: 23.5 + (lines(store.name, 34) - 1) * 8 + (lines([store.category, store.address, doc.lookedUp].filter(Boolean).join(' · '), 78) - 1) * 4.8,
        fixed: 4.8 + 4.8 + 3.2, // '처방 요약' 줄 + 맨 아래 안내 줄
        diag: 0, week: 0, slots: 0, metrics: 0,
    };
    const block = 3 + 7.6;
    if (summary.diagnoses.length) {
        parts.diag = block;
        for (const diag of summary.diagnoses) parts.diag += 2 + lines(diag.text, 52) * 6.4 + lines(diag.basis, 78) * 4.9;
    }
    if (summary.week) {
        parts.week = block;
        for (const task of summary.week.items) parts.week += 2.6 + 5.8 + Math.max(1, lines(`${task.why || ''} ${task.where}`, 74)) * 4.9;
    }
    if (summary.slots) {
        parts.slots = block + 6.8;
        for (const row of summary.slots.rows) {
            const now = `${row.now || '빈 칸'} ${row.nowRank || ''}`;
            const next = row.action === 'keep' || row.action === 'check' ? '그대로' : `${row.next} ${row.nextRank || '순위 미조회'}`;
            parts.slots += 3.2 + Math.max(lines(now, 17), lines(next, 17), lines(row.reason, 27), 1) * 4.3;
        }
        if (summary.slots.empty > 0) parts.slots += 7.8;
        if (summary.slots.unranked.length) parts.slots += 1.4 + lines(`${summary.slots.unranked.join(', ')}은(는) 아직 순위를 조회하지 않았습니다. 바꾸기 전에 혼잘마에서 순위를 먼저 확인하세요. 근거는 C.`, 78) * 4.9;
    }
    if (summary.metrics) {
        parts.metrics = block + 6.8;
        for (const metric of summary.metrics) {
            parts.metrics += 3.2 + Math.max(lines(metric.now, 24) + lines(metric.note, 30), lines(metric.compare, 26), lines(metric.label, 12), 1) * 4.6;
        }
    }
    return parts;
}

export function estimatePage1Mm(doc, summary) {
    const parts = estimatePage1Parts(doc, summary);
    return Math.round(Object.values(parts).reduce((sum, value) => sum + value, 0) * 10) / 10;
}

export function fitSummary(doc, summary) {
    const out = {
        ...summary,
        diagnoses: summary.diagnoses.map((diag) => ({ ...diag, basis: diag.basis && diag.basis.length <= CAP.diagBasis ? diag.basis : null })),
        week: summary.week ? {
            ...summary.week,
            items: summary.week.items.map((task) => {
                if (!task.why || task.why.length <= CAP.weekWhy) return task;
                return { ...task, why: task.problem && task.problem.length <= CAP.weekWhy ? task.problem : null };
            }),
        } : null,
        slots: summary.slots ? {
            ...summary.slots,
            rows: summary.slots.rows.map((row) => {
                if (row.reason.length <= CAP.slotReason) return row;
                const [head, ...rest] = row.reason.split(' → ');
                const basis = rest.join(' → ');
                return { ...row, reason: basis ? `${head} → ${capParts(basis, Math.max(8, CAP.slotReason - head.length - 3))}` : capParts(head, CAP.slotReason) };
            }),
        } : null,
        metrics: summary.metrics ? summary.metrics.map((metric) => ({
            ...metric,
            note: metric.note && metric.note.length > CAP.metricNote ? capNamedList(metric.note, CAP.metricNote) : metric.note,
            compare: metric.compare && metric.compare.length > CAP.metricCompare && metric.compareShort ? metric.compareShort : metric.compare,
        })) : null,
    };
    const steps = [
        () => (out.metrics?.length > 4 ? ((out.metrics = out.metrics.slice(0, 4)), true) : false),
        () => (out.slots?.unranked.length ? ((out.slots = { ...out.slots, unranked: [] }), true) : false),
        () => (out.metrics?.some((metric) => metric.note) ? ((out.metrics = out.metrics.map((metric) => ({ ...metric, note: null }))), true) : false),
        ...[...out.diagnoses.keys()].reverse().map((index) => () => {
            if (!out.diagnoses[index].basis) return false;
            out.diagnoses = out.diagnoses.map((diag, i) => (i === index ? { ...diag, basis: null } : diag));
            return true;
        }),
        () => (out.metrics?.length > METRICS_MIN ? ((out.metrics = out.metrics.slice(0, METRICS_MIN)), true) : false),
    ];
    for (const step of steps) {
        if (estimatePage1Mm(doc, out) <= PAGE1_BUDGET_MM) break;
        step();
    }
    out.metrics = out.metrics ? out.metrics.map(({ compareShort, ...metric }) => metric) : null;
    return out;
}

// "10위 밖: A 12위 · B 41위 · C 300위 밖" → 앞에서부터 max 글자까지 + " 외 n개"
function capNamedList(text, max) {
    const [head, body] = String(text).includes(': ') ? String(text).split(': ') : ['', String(text)];
    const parts = body.split(' · ');
    const kept = [];
    for (const part of parts) {
        const next = `${head ? `${head}: ` : ''}${[...kept, part].join(' · ')} 외 ${parts.length - kept.length - 1}개`;
        if (kept.length && next.length > max) break;
        kept.push(part);
    }
    const rest = parts.length - kept.length;
    return `${head ? `${head}: ` : ''}${kept.join(' · ')}${rest > 0 ? ` 외 ${rest}개` : ''}`;
}

/* ───────── 문서 ───────── */

// 플레이스 분석 결과 → 처방전 문서 자료.
//   place, activity   분석 결과(getPlace·getActivity)
//   ranks             화면의 순위 표 줄 [{ keyword, state, result }]
//   recommendation    recommendKeywords() 결과
//   actions           buildActionItems() 결과('지금 할 일')
//   geo               analyzeGeoAeo() 결과(없으면 AI 검색 구역을 뺌)
//   fetchedAt         매장을 조회한 시각(ms). "며칠 전"과 "4주 뒤" 날짜의 기준. 없으면 nowMs
//   nowMs             문서를 만드는 시각(파일 이름의 날짜)
// 돌려주는 값(place 가 없으면 null)
//   { title, brand, fileName, store, lookedUp, recheck: { ms, label },
//     summary: { diagnoses, week: { items, totalLabel }, slots, metrics },
//     sections: [rivals · tasks · keywords · ai · plan 가운데 자료가 있는 것, 차례로 letter(A, B, …)],
//     notes }
//   fitPage1          false 면 1쪽 맞추기(fitSummary)를 건너뜁니다(어림 값 맞추기·테스트용)
export function buildPrescription(input = {}) {
    const clean = sanitizeInput(input || {});
    return clean ? buildFromClean(clean) : null;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const objects = (value) => (Array.isArray(value) ? value.filter(isObject) : []);

// 실제 네이버 응답이 견본과 모양이 달라도(빈 배열·null·필드 없음·엉뚱한 타입) 처방전이 던지지 않게 입구에서 고릅니다.
// 배열이어야 할 곳은 배열로, 배열 안의 null·빈 값은 빼고, 객체여야 할 곳이 아니면 null 로 둡니다. 값 자체는 고치지 않습니다.
export function sanitizeInput({ place, activity = null, ranks = [], recommendation = null, actions = [], geo = null, ...rest }) {
    if (!isObject(place)) return null;
    const cleanRanks = objects(ranks).map((row) => {
        if (!isObject(row.result)) return { ...row, result: null };
        return { ...row, result: { ...row.result, top: objects(row.result.top), target: isObject(row.result.target) ? row.result.target : null } };
    });
    const cleanReco = isObject(recommendation)
        ? {
            ...recommendation,
            registered: objects(recommendation.registered).filter((entry) => typeof entry.keyword === 'string' && entry.keyword),
            items: objects(recommendation.items).filter((entry) => typeof entry.keyword === 'string' && entry.keyword),
            excluded: objects(recommendation.excluded),
            regions: objects(recommendation.regions),
        }
        : null;
    return {
        ...rest,
        place,
        activity: isObject(activity) ? activity : null,
        ranks: cleanRanks,
        recommendation: cleanReco,
        actions: objects(actions).filter((item) => typeof item.key === 'string'),
        geo: isObject(geo) ? geo : null,
    };
}

function buildFromClean({ place, activity = null, ranks = [], recommendation = null, actions = [], geo = null, fetchedAt = null, nowMs = Date.now(), fitPage1 = true }) {
    const todo = list(actions);
    const doneRows = list(ranks).filter(isDone);
    const rankOf = new Map(doneRows.map((row) => [compact(row.keyword), row]));
    const lookedUpMs = Number.isFinite(fetchedAt) ? fetchedAt : nowMs;
    const recheckMs = lookedUpMs + RECHECK_DAYS * DAY_MS;
    const recheckLabel = dayLabel(recheckMs);
    const item = itemWord(place);

    const regions = rankRegions({ doneRows, recommendation, place });
    const weakList = weakRegions(regions);
    const weak = weakList.map((region) => region.region);
    // 가장 큰 격차는 남겨 둘 지역의 키워드에서 찾습니다(빼기로 한 지역의 격차는 표에만 둠).
    const weakKeywords = new Set(weakList.flatMap((region) => region.rows.map((row) => compact(row.keyword))));
    const comparisonRaw = rivalComparison({ place, doneRows });
    const kept = comparisonRaw.rows.filter((row) => !weakKeywords.has(compact(row.keyword)));
    const comparison = { ...comparisonRaw, gapRows: kept.length ? kept : comparisonRaw.rows, recommendation };
    const slots = slotProposal({ place, recommendation, rankOf, weak });
    const diagnoses = pickDiagnoses(diagnosisCandidates({ place, activity, recommendation, rankOf, regions, comparison, geo, item }));
    const tasks = buildTasks({ place, activity, actions: todo, geo, slots, diagnoses, item });
    const week = tasks.filter((task) => task.weekOk).slice(0, WEEK_MAX);
    const metrics = pickMetrics({ place, activity, rankOf, comparison, geo, diagnoses, week, item });

    const ctx = { place, activity, geo, nowMs: lookedUpMs, recommendation };
    const sections = [
        buildRivals({ comparison }),
        buildTaskSection(tasks, ctx),
        buildKeywordSection({ place, slots, recommendation }),
        buildAi({ place, activity, geo, tasks, nowMs: lookedUpMs }),
        buildPlan({ week, tasks, activity, rankOf, recheckLabel, metricsCount: metrics.length }),
    ].filter(Boolean).map((section, index) => ({ letter: String.fromCharCode(65 + index), ...section }));
    const letterOf = Object.fromEntries(sections.map((section) => [section.id, section.letter]));

    const lookedUp = dateTimeLabel(lookedUpMs);
    const notes = [`네이버 플레이스 화면에 공개된 정보를 ${lookedUp}에 조회한 결과이며, 네이버 공식 제휴 데이터가 아닙니다.`];
    if (doneRows.length > 0) notes.push('순위는 조회한 시각의 네이버 플레이스 검색 결과에서 광고를 빼고 센 순서이며, 검색 위치·시간에 따라 달라질 수 있습니다.');
    if (letterOf.rivals) notes.push('경쟁 매장의 리뷰 수·평점은 같은 검색 결과 목록에 나온 값이며, 중간값은 그 목록 안의 매장만으로 계산했습니다.');
    if (activity?.visitor && known(activity.visitor.replyRate)) notes.push(`사장님 답글률은 최근 방문자 리뷰 ${formatNumber(activity.visitor.sampled)}개를 기준으로 센 값입니다.`);
    if (letterOf.ai) notes.push('GEO·AEO 점수는 공개된 매장 정보로 계산한 준비 정도이며, AI 답변 노출을 보장하지 않습니다.');
    if (!letterOf.plan) notes.push('걸리는 시간은 일의 종류로 정한 대략값입니다.');
    notes.push('초안 문안은 매장 정보로 자동으로 만든 것입니다. 사실과 다르면 고쳐 쓰세요.');

    const weekItems = week.map((task, index) => ({
        no: index + 1, key: task.key, title: task.title, timeLabel: task.timeLabel, minutes: task.minutes, where: task.where,
        why: task.why[0] ? sentencesOf(task.why[0])[0] : task.problem,
        problem: task.problem,
        see: letterOf.tasks || null,
    }));
    const totalMinutes = week.reduce((sum, task) => sum + task.minutes, 0);
    const store = {
        name: String(place.name || '').trim() || null,
        category: String(place.category || '').trim() || null,
        address: String(place.address || '').trim() || null,
    };
    const head = { store, lookedUp: `${lookedUp} 조회` };

    return {
        title: PRESCRIPTION_TITLE,
        brand: PRESCRIPTION_BRAND,
        fileName: prescriptionFileName(place.name, nowMs),
        ...head,
        recheck: { ms: recheckMs, label: recheckLabel },
        summary: (fitPage1 ? fitSummary : (h, summary) => summary)(head, {
            diagnoses: diagnoses.map(({ key, text, basis, task }) => ({ key, text, basis, task })),
            week: weekItems.length ? { items: weekItems, totalLabel: minutesLabel(totalMinutes) } : null,
            slots: slots && slots.slots.length ? {
                rows: slots.slots.map((slot) => ({
                    no: slot.no, now: slot.now, nowRank: slot.nowRank, action: slot.action, actionLabel: ACTION_WORD[slot.action],
                    next: slot.next, nextRank: slot.nextRank, reason: slot.reason,
                })),
                changes: slots.changes,
                empty: slots.empty,
                unranked: slots.unranked,
                see: letterOf.keywords || null,
            } : null,
            metrics: metrics.length ? metrics : null,
        }),
        sections,
        notes,
    };
}
