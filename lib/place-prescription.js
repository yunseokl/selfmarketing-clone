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
//  - 고르는 규칙(진단 점수·할 일 점수·5칸 유지·근거 점수 규칙·다시 볼 숫자)은 아래 표와 함수에 적어 두고 테스트로 고정합니다.
//  - 인쇄본만으로 읽히고 따라 할 수 있어야 합니다: 화면을 보라고 미루지 않고, 근거 표기("블로그 30/52")는 풀이를 붙이고,
//    뺀 낱말은 낱말마다 이유를 적고, 방법은 문서 안에 적습니다. 업종에 맞지 않는 조언(약국의 메뉴판·가격 등)은 업종에 맞게 다시 쓰거나 뺍니다.

import { rankLocality, median, diagnoseRank, keywordFrequency, feedDays } from './naver-place.js';
import { rankScope, familyOf, RANK_GOOD, RANK_WEAK } from './place-keywords.js';
import { KEYWORD_MAX } from './place-check.js';
import { REPLY_TARGET, josa, healthWords } from './place-geo.js';
import { notApplicableOf } from './place-industry.js';
import { buildQuickStrategies } from './place-geo-quick.js';
import { formatNumber, agoLabel, rankLabel, itemWord } from './place-graph.js';
import {
    DRAFT_MARK, replyDrafts, introDraft, feedDrafts, menuFrames, keywordPlacements, priceRange,
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
// 할 일의 출처: 'AI 검색 점검'에서만 나온 일은 이름 옆에 이 표시를 붙입니다.
export const AI_SOURCE_LABEL = 'AI 검색 점검';
export const AI_SOURCE_NOTE = "'AI 검색 점검' 표시는 손님이 AI에게 묻는 질문에 매장 정보로 답할 수 있는지 본 점검에서 나온 일입니다.";
const RULE_LABEL = {
    broad: '넓은 업종 이름', extra: '추가 메뉴', vague: '뜻이 넓음', drink: '술·음료', otherBusiness: '다른 업종 낱말',
    offMain: '주력 메뉴 아님', classification: '분류 이름', rank: '내 순위 낮은 지역',
    attribute: '조건·꾸밈 낱말', place: '메뉴 이름 속 지명', lowRank: '순위 낮음', condition: '조건 안 맞음', rivalOnly: '상위 매장만 씀', noBlog: '근거 부족', thin: '근거 부족', channel: '받는 방법', merged: '겹치는 낱말', region: '지역만 바꿈',
};

/* ───────── 일의 종류별 고정값 ─────────
 * minutes: 걸리는 시간(대략, 분). 혼잘마가 일의 종류로 정한 고정값이며 매장마다 다를 수 있습니다.
 * where:   하는 곳. 앱의 다른 화면·안내에 이미 적힌 메뉴 경로까지만 씁니다(확실하지 않은 하위 메뉴는 적지 않음).
 * week:    '이번 주 할 일'로 고를 수 있는지(다른 사람이 해 줘야 하는 일은 빼고 4주 실행표에만 넣음).
 */
/* 스마트플레이스 메뉴 경로 — 네이버 공식 도움말(help.naver.com '스마트플레이스 사업주 고객센터')에서 확인된 것만 적습니다.
 * 조사: .playwright-mcp/qa/report/round5/smartplace-menu-paths.md (2026-11-18 열람). 아래는 그 2번 "그대로 적어도 되는 문장"입니다.
 * 적지 않는 것: 앱의 단계별 경로(공식 확인은 '새소식 쓰기'·'답글쓰기' 버튼뿐), 소개글·찾아오는 길·키워드 글자 수, 사진 20MB, 메뉴 개수,
 *   새소식 글자 수, 비공식 칸·버튼 이름('홈페이지/SNS'·'URL 추가'·'[순서설정]'), 예약 '플레이스 연결하기'의 정확한 칸 이름,
 *   병의원 검색 키워드 개수, 업체 정보 문의용 전화번호. 모르는 칸은 "화면에서 확인하세요"로 둡니다. */
export const SP_LOGIN = "스마트플레이스(smartplace.naver.com)에 가게 주인 아이디로 로그인한 뒤, '내 업체'에서 가게 이름을 누르세요.";
export const SP_NAMES_MAY_CHANGE = "스마트플레이스 화면은 네이버가 수시로 바꿉니다. 여기 적힌 메뉴 이름이 화면과 조금 달라도 비슷한 이름의 메뉴를 찾아 보세요. 그래도 안 보이면 네이버 '스마트플레이스 사업주 고객센터'(help.naver.com)의 온라인 상담을 이용하세요.";
export const SP_UNSURE_INDUSTRY = '업종에 따라 이 메뉴가 없거나 이름이 다를 수 있습니다.';

// 업종 때문에 해당하지 않는 일(병의원: 새소식·쿠폰 / 약국: 쿠폰·예약)의 판정과 이유는 lib/place-industry.js 한 곳에서 정합니다(점수·질문표·할 일·처방전이 같은 판정을 봄).
// 처방 상세 머리에 뺀 이유를 한 줄로 적습니다(없으면 null).
export function industryNote(place) {
    const na = notApplicableOf(place);
    const reasons = [na.feed, na.coupon, na.booking].filter(Boolean);
    if (reasons.length === 0) return null;
    const names = [na.feed ? '소식 쓰기' : null, na.coupon ? '쿠폰 만들기' : null, na.booking ? '네이버 예약 켜기' : null].filter(Boolean);
    return `${reasons.join(' ')} 그래서 이 처방전에는 ${names.join('·')}를 넣지 않았습니다.`;
}
export const SP_WAIT = {
    review: '네이버 검토 영업일 최대 5일', // 대표키워드·메뉴 정보 같은 기본정보: 운영자 검토(공식 H20379)
    booking: '검수 신청일 제외 2~3영업일', // 예약 검수(공식 H20674)
    hours: '검색 반영 최대 하루', // 영업시간·휴무(공식 H20380)
    extra: '반영 2시간~1일', // 주차·편의·홈페이지 같은 부가정보(공식 H20379)
};
const SP_EDIT = '스마트플레이스 > 내 업체 > 정보 수정';

// 일마다 걸리는 시간(분)·하는 곳·이번 주 할 일에 넣을 수 있는지. 하는 곳은 위 공식 경로이고, 업종에 따라 taskWhere 가 바꿉니다.
export const TASK_INFO = {
    keywords: { minutes: 10, where: `${SP_EDIT} > 대표키워드`, week: true },
    reply: { minutes: 30, where: '스마트플레이스 > 내 업체 > 리뷰 > 방문자 리뷰', week: true },
    feed: { minutes: 20, where: '스마트플레이스 > 내 업체 > 새소식', week: true },
    description: { minutes: 20, where: `${SP_EDIT} > 상세 설명`, week: true },
    intro: { minutes: 10, where: `${SP_EDIT} > 상세 설명`, week: true },
    photos: { minutes: 30, where: `${SP_EDIT} > 업체 사진`, week: true },
    menuDesc: { minutes: 30, where: SP_EDIT, week: true },
    menuAdd: { minutes: 40, where: SP_EDIT, week: true },
    menuPrice: { minutes: 20, where: SP_EDIT, week: true },
    menuImage: { minutes: 20, where: SP_EDIT, week: true },
    menuRefresh: { minutes: 20, where: SP_EDIT, week: true },
    hours: { minutes: 10, where: `${SP_EDIT} > 업체정보 > 휴무일, 영업시간`, week: true },
    accessor: { minutes: 10, where: SP_EDIT, week: true },
    conveniences: { minutes: 10, where: `${SP_EDIT} > 부가정보`, week: true },
    parking: { minutes: 10, where: `${SP_EDIT} > 부가정보`, week: true },
    hype: { minutes: 10, where: SP_EDIT, week: true },
    talktalk: { minutes: 10, where: '스마트플레이스 > 내 업체 > 톡톡연결', week: true },
    booking: { minutes: 30, where: '스마트플레이스 > 예약/주문', week: true },
    coupon: { minutes: 10, where: '스마트플레이스 > 내 업체 > 마케팅 > 쿠폰', week: true },
    blog: { minutes: 30, where: '블로그 체험단', week: false },
};

// 업종 묶음(처방 문장이 달라지는 기준 — place-geo.js 의 healthWords·place-keywords.js 의 familyOf 와 같은 업종 구분)
//   clinic 병·의원·치과·한의원 등 / pharmacy 약국 / pet 동물병원 / beauty 미용·네일·피부 / food 음식점·카페·술집 / other
export function industryKind(place) {
    const key = familyOf(place)?.key;
    if (key === 'clinic' || key === 'pharmacy' || key === 'pet') return key;
    if (key === 'hair' || key === 'nail' || key === 'skin') return 'beauty';
    if (key === 'restaurant' || key === 'cafe' || key === 'bar') return 'food';
    return 'other';
}

// 메뉴 정보를 적는 곳: 음식점·카페는 공식 경로(업체정보 > 메뉴정보), 그 밖은 정보 수정 화면까지만(칸 이름은 화면에서 확인)
const MENU_TASKS = new Set(['menuDesc', 'menuAdd', 'menuPrice', 'menuImage', 'menuRefresh']);

export function taskWhere(key, place) {
    if (MENU_TASKS.has(key) && industryKind(place) === 'food') return `${SP_EDIT} > 업체정보 > 메뉴정보`;
    return TASK_INFO[key].where;
}

/* AI 검색 점검 점수가 오르는 일(처방 상세에 없는 것)의 걸리는 시간(대략, 분) — 일의 종류로 정한 고정값.
 * 표에 없는 일은 EXTRA_MINUTES_DEFAULT 로 적어, 실행표·목록의 모든 줄에 시간이 있게 합니다. */
export const EXTRA_MINUTES = {
    links: 10, // 홈페이지·인스타그램·유튜브를 플레이스에 연결
    naverBlog: 60, // 블로그를 만들어 연결하고 첫 글 쓰기
    blogTotal: 30, blogRecent: 30, // 블로그 글 한 편
    scoreShow: 5, // 별점 표시 켜기
    reviewsMore: 10, reviewAsk: 10, textReview: 10, // 리뷰 안내 문구 준비
    napSame: 20, // 이름·주소·전화 표기 맞추기
    freshDate: 10, sourceUpdate: 10,
};
export const EXTRA_MINUTES_DEFAULT = 10;

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

// 조회한 상위 매장 전체(순위 결과의 topSignals — 광고를 뺀 상위 목록, 내 매장 제외)의 중간값·최고값과 내 매장을 견줍니다.
// 판정은 화면(diagnoseRank)과 같습니다: 중간값 이상이면 앞섬, 중간값의 70% 이상이면 비슷, 그 아래면 뒤처짐(평점은 0.2점 차이).
// 키워드마다 상위 목록이 다를 수 있어, 상위 목록이 있는 첫 키워드(순위 표 순서) 하나를 씁니다. 내 지역 검색 결과가 아닌 순위는 뺍니다.
const POOL_SIGNALS = [
    { key: 'visitorReviews', short: 'visitor', label: '방문자 리뷰', unit: '개' },
    { key: 'blogReviews', short: 'blog', label: '블로그·카페 리뷰', unit: '개' },
    { key: 'score', short: 'score', label: '평점', unit: '점' },
];
const VERDICT_WORD = { ahead: '앞섬', near: '비슷', behind: '뒤처짐' };

export function poolComparison({ place, doneRows }) {
    // 순위 표의 첫 키워드(화면에서 먼저 보이는 키워드)부터 보아, 상위 목록이 있는 첫 키워드를 씁니다.
    const best = doneRows
        .filter((row) => row.result?.topSignals?.count > 0 && rankLocality(row.result, place.coordinate)?.scope !== 'far')
        .map((row) => ({ row, signals: row.result.topSignals }))[0] || null;
    if (!best) return null;
    // 내 값은 화면(buildMine)과 같게 매장 정보의 값입니다.
    const mine = storeValues({ visitorReviews: place.visitorReviews, blogReviews: place.blogReviews, score: place.visitorScore });
    // 실제 응답의 모양이 어긋나 판정이 던지면 이 비교만 뺍니다.
    let diagnosis = null;
    try {
        diagnosis = diagnoseRank({ visitorReviews: mine.visitor, blogReviews: mine.blog, score: mine.score }, best.signals);
    } catch {
        return null;
    }
    if (!diagnosis) return null;
    const rows = POOL_SIGNALS
        .map((spec) => ({ spec, found: diagnosis.signals.find((signal) => signal.key === spec.key) }))
        .filter(({ found }) => found && Number.isFinite(found.median) && Number.isFinite(found.mine))
        .map(({ spec, found }) => ({
            key: spec.short, label: spec.label, unit: spec.unit, mine: found.mine, median: found.median, best: Number.isFinite(found.best) ? found.best : null,
            verdict: found.verdict, verdictLabel: VERDICT_WORD[found.verdict] || null,
        }));
    if (rows.length === 0) return null;
    const FORM = { ahead: ['앞서고', '앞섭니다'], near: ['비슷하고', '비슷합니다'], behind: ['뒤처지고', '뒤처집니다'] };
    const groups = ['ahead', 'near', 'behind']
        .map((verdict) => ({ verdict, labels: rows.filter((row) => row.verdict === verdict).map((row) => row.label) }))
        .filter((group) => group.labels.length > 0);
    const joined = groups
        .map((group, index) => `${josa(group.labels.join('·'), '은', '는')} ${FORM[group.verdict][index === groups.length - 1 ? 1 : 0]}`)
        .join(' ');
    return {
        keyword: String(best.row.keyword).trim(),
        count: best.signals.count,
        rows,
        line: `${best.row.keyword} 검색 결과의 상위 ${formatNumber(best.signals.count)}곳 전체 중간값과 비교하면 ${joined}.`,
    };
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

function buildRivals({ comparison, pool = null }) {
    const { rows, firsts, gapRows } = comparison;
    if (rows.length === 0 && firsts.length === 0) return null;
    const shown = rows.slice(0, RIVAL_KEYWORDS_SHOWN);
    const headline = [];
    const visitorGap = biggestGap(gapRows, 'visitor');
    if (visitorGap) headline.push(gapSentence(visitorGap, 'visitor'));
    const blogGap = biggestGap(gapRows, 'blog');
    if (blogGap) headline.push(gapSentence(blogGap, 'blog'));
    // 앞서는 것은 앞선다고 적습니다(내 위 매장 몇 곳과만 비교하면 모두 뒤처진 것처럼 읽힘).
    if (pool) headline.push(pool.line);
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
        pool,
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
 * 추천 순서와 근거 점수는 lib/place-keywords.js 가 정한 것을 그대로 씁니다(처방전은 점수를 다시 매기지 않음).
 *   items[i].evidence = { points, parts:[{ kind, text, short, points … }] } — parts 는 점수가 높은 순, items 는 점수가 높은 순
 *   registered[i].rank·concern(lowRank 포함)·evidence — 등록한 칸의 순위·살펴볼 점·근거
 * 그래서 화면 추천을 위에서부터 채우면 처방전 5칸이 됩니다. 처방전만의 규칙은 아래 둘뿐입니다.
 *  1) 유지  지역명이 있고 살펴볼 점(concern: 분류 이름·30위 밖 등)이 없는 등록 키워드는 그 칸에 그대로 둡니다(순위를 아직 조회하지 않았어도 유지).
 *  2) 남는 칸(교체할 칸 + 빈 칸)은 추천 후보를 위에서부터 채웁니다. 근거 점수가 EVIDENCE_MIN 에 못 미치는 후보는 넣지 않고,
 *     후보가 모자라면 교체할 칸은 그대로 두고(살펴보기) 빈 칸은 비워 둡니다.
 *     새 키워드가 어느 칸으로 들어가는지: 지금 낱말에 지역을 붙인 것(또는 손님이 쓰는 말)이 뽑혔으면 그 칸에, 아니면 위에서부터 남는 칸에.
 *  5칸에 들지 못한 좋은 후보는 C 에 '다음 후보'로 근거와 함께 싣습니다(소리 없이 빠지지 않게).
 * (같은 낱말 상한·순위 낮은 지역·'순위 확인용' 제외는 lib 이 추천에 이미 반영합니다.) */
export const EVIDENCE_MIN = 12; // lib 점수 눈금 기준: 이 점수에 못 미치는 근거(블로그 후기 한두 건 등)만 있는 후보는 5칸에 넣지 않음
export const EVIDENCE_WEAK = 20; // 이 점수 미만의 추천 근거는 '약함'으로 적습니다
export const NEXT_CANDIDATES_SHOWN = 4;

// 추천 줄의 근거: lib 이 붙인 evidence 를 그대로 돌려줍니다(없으면 근거 없음).
export function evidenceOfItem(item) {
    const parts = list(item?.evidence?.parts);
    const points = Number.isFinite(item?.evidence?.points) ? item.evidence.points : parts.reduce((sum, part) => sum + (Number(part.points) || 0), 0);
    return { points, parts };
}

// 근거 문장: 점수가 높은 것 3개까지(점수 6 미만인 사소한 것은 다른 근거가 없을 때만)
function shownParts(parts) {
    const strong = parts.filter((part) => part.points >= 6 || part.kind === 'spoken');
    return (strong.length ? strong : parts).slice(0, 3);
}

// 네 자리 이상 숫자(명·회·건·곳·개 앞)에는 천 단위 쉼표를 넣어 화면과 같게 적습니다.
function thousands(text) {
    return String(text ?? '').replace(/(?<![\d,])(\d{4,})(?=\s*(?:명|회|건|곳|개))/g, (digits) => formatNumber(Number(digits)));
}

function basisOf(parts, key) {
    return thousands(shownParts(parts).map((part) => part[key] ?? part.text).join(' · '));
}

// 등록 키워드가 지역이 없거나 순위가 낮을 때 "왜 바꾸나" — lib 의 살펴볼 점(concern)과 같은 말입니다.
//   순서: 살펴볼 점(분류 이름·'내 순위가 41위라 30위 안에 들지 못합니다' 등) → 지역명 없음
function slotWhy(entry) {
    if (entry.concern) {
        // 분류 이름(약국의 '일반의약품' 등): 손님이 무엇으로 검색하는지 단정하지 않고 하는 일만 짧게
        if (entry.concern.rule === 'classification' && entry.spoken?.term) {
            return `'${entry.keyword}'${josa(entry.keyword, '은', '는').slice(String(entry.keyword).length)} 약·제품을 나누는 분류 이름이라 지역을 붙인 '${entry.spoken.term}' 키워드로 바꿉니다.`;
        }
        return entry.concern.reason;
    }
    if (!entry.hasRegion) return '지역명이 없어 검색하는 위치마다 순위가 달라집니다.';
    return '';
}

export function slotProposal({ place, recommendation, rankOf }) {
    if (!Array.isArray(place?.keywords) || !recommendation) return null;
    const registered = list(recommendation.registered);
    const items = list(recommendation.items);
    const used = new Set(registered.map((entry) => compact(entry.keyword)));
    const rankText = (keyword) => {
        const row = rankOf.get(compact(keyword));
        return row ? rankLabel(row.result) : null;
    };

    // 1) 등록한 키워드 한 칸씩: 그대로 둘지(problem 없음) 바꿔야 할지 — lib 의 concern·hasRegion 으로
    const judged = registered.map((entry, index) => {
        const row = rankOf.get(compact(entry.keyword)) || null;
        const result = row?.result || null;
        // 내 순위 글: 화면 순위 표 줄이 있으면 그 값, 없으면 lib 이 준 값
        const rank = result ? rankLabel(result) : (entry.rank?.state && entry.rank.state !== 'pending' ? entry.rank.text : null);
        const found = result ? isFound(result) : Number.isFinite(entry.rank?.rank);
        let problem = null;
        if (entry.concern) {
            problem = entry.concern.rule === 'lowRank' ? (found ? `내 ${rank}` : rank || '순위 낮음') : (RULE_LABEL[entry.concern.rule] || '살펴볼 점');
        } else if (!entry.hasRegion) problem = '지역명 없음';
        return { entry, index, result, rank, found, problem };
    });

    // 2) 추천 후보를 lib 순서(근거 점수 순) 그대로 위에서부터 필요한 만큼
    const pool = items
        .filter((item) => item && item.registrable && !used.has(compact(item.keyword)))
        .map((item) => ({ item, termKey: compact(item.term || item.keyword), ...evidenceOfItem(item) }))
        .filter((candidate) => candidate.points >= EVIDENCE_MIN);
    const need = judged.filter((slot) => slot.problem).length + Math.max(0, KEYWORD_MAX - registered.length);
    const picked = pool.slice(0, need);

    // 3) 칸에 넣기: 그 낱말에 지역을 붙인 것(또는 손님이 쓰는 말)이 뽑혔으면 그 칸에, 나머지는 위에서부터 남는 칸에
    const remaining = [...picked];
    const ownVariant = (entry) => {
        const at = remaining.findIndex((candidate) => candidate.item.keyword === entry.suggest
            || candidate.item.keyword === entry.spoken?.keyword
            || (entry.spoken?.term && compact(entry.spoken.term) === candidate.termKey)
            || ((!entry.concern || entry.concern.rule === 'lowRank') && entry.core && compact(entry.core) === candidate.termKey));
        return at < 0 ? null : remaining.splice(at, 1)[0];
    };
    const assigned = new Map();
    for (const slot of judged.filter((entry) => entry.problem)) {
        const candidate = ownVariant(slot.entry);
        if (candidate) assigned.set(slot.index, { candidate, own: true });
    }
    for (const slot of judged.filter((entry) => entry.problem && !assigned.has(entry.index))) {
        if (remaining.length === 0) break;
        assigned.set(slot.index, { candidate: remaining.shift(), own: false });
    }

    // 최종 5칸에서 낱말별로 몇 칸인지(유지한 칸은 그 키워드의 낱말, 바꾸는 칸은 새 낱말)
    const wordCount = new Map();
    const bumpWord = (key) => wordCount.set(key, (wordCount.get(key) || 0) + 1);
    for (const slot of judged) {
        if (!slot.problem) bumpWord(compact(slot.entry.core || slot.entry.keyword));
        else if (assigned.has(slot.index)) bumpWord(assigned.get(slot.index).candidate.termKey);
    }
    for (const candidate of remaining.slice(0, Math.max(0, KEYWORD_MAX - registered.length))) bumpWord(candidate.termKey);

    const slots = judged.map((slot) => {
        const { entry, index, result, rank, found, problem } = slot;
        if (!problem) {
            return {
                no: index + 1, now: entry.keyword, nowRank: rank, action: 'keep', next: entry.keyword, nextRank: rank,
                reason: rank ? `내 ${rank} — ${found && (result ? result.rank <= RANK_GOOD : entry.rank?.state === 'good') ? '10위 안' : `${RANK_WEAK}위 안이라 유지`}` : '지역 있음 · 순위 아직 조회 안 함',
            };
        }
        const why = slotWhy(entry);
        const choice = assigned.get(index);
        if (!choice) {
            return { no: index + 1, now: entry.keyword, nowRank: rank, action: 'check', next: entry.keyword, nextRank: rank, problem, reason: `${problem} — ${why} 바꿀 후보가 없어 그대로 둡니다.` };
        }
        const { candidate } = choice;
        const next = candidate.item.keyword;
        // 지금 낱말에 지역을 붙인 조합이 있었는데 더 강한 말에 밀렸으면 그 조합의 근거가 약하다고 적습니다.
        const ownItem = choice.own ? null : items.find((item) => item.keyword === entry.suggest) || null;
        const ownEvidence = ownItem ? evidenceOfItem(ownItem) : null;
        const weakOwn = Boolean(ownEvidence && ownEvidence.points < EVIDENCE_WEAK);
        const note = ownItem
            ? `'${ownItem.keyword}'의 근거(${basisOf(ownEvidence.parts, 'text') || '없음'})보다 '${next}'의 근거가 더 강합니다.`
            : null;
        // 같은 낱말이 5칸에 두 번 들어가면 까닭을 적습니다(같은 낱말은 두 칸까지 허용 — lib 규칙). 순위가 낮은 지역만 바꾼 조합이면 그 말도.
        const word = candidate.item.term || candidate.termKey;
        const rival = candidate.parts.find((part) => part.kind === 'rival' && Number.isFinite(part.exact));
        const sameWord = (wordCount.get(candidate.termKey) || 0) >= 2
            ? `'${word}'은 5칸에 두 번 들어갑니다(같은 낱말은 두 칸까지 허용). ${choice.own && entry.concern?.rule === 'lowRank' ? '순위가 낮은 지역만 바꾼 조합이며' : '이 조합은'}${rival ? ` 상위 ${rival.exact}곳이 등록했습니다.` : ' 근거가 강해 넣었습니다.'}`
            : null;
        // 손님이 더 많이 쓰는 같은 뜻의 말(분류 이름 → 손님 말)로 바꾸는 칸은 그 말이 어떻게 비교됐는지를 맨 앞에 적습니다.
        const spoken = choice.own && entry.spoken?.term && compact(entry.spoken.term) === candidate.termKey
            ? {
                kind: 'spoken',
                text: `블로그 후기 언급 '${entry.keyword}' ${entry.blog ?? 0}개 · '${entry.spoken.term}' ${entry.spoken.blog}개`,
                short: `후기 '${entry.keyword}' ${entry.blog ?? 0}개·'${entry.spoken.term}' ${entry.spoken.blog}개`,
                points: 0,
            }
            : null;
        const shown = spoken ? [spoken, ...candidate.parts.filter((part) => part.kind !== 'blog' && part.kind !== 'registered')] : candidate.parts;
        const basisShort = basisOf(shown, 'short');
        const label = weakOwn ? `${problem}·근거 약함` : problem;
        return {
            no: index + 1, now: entry.keyword, nowRank: rank, action: 'replace', next, nextRank: rankText(next),
            problem, weakOwn, item: candidate.item, evidence: shown, points: candidate.points,
            reason: `${label}${basisShort ? ` → ${basisShort}` : ''}`,
            why: [why, note, sameWord].filter(Boolean).join(' '), basis: basisOf(shown, 'text'), own: choice.own,
        };
    });
    // 남은 후보는 빈 칸에
    for (let no = slots.length + 1; no <= KEYWORD_MAX; no += 1) {
        const candidate = remaining.shift();
        if (!candidate) break;
        const next = candidate.item.keyword;
        const basisShort = basisOf(candidate.parts, 'short');
        slots.push({
            no, now: null, nowRank: null, action: 'fill', next, nextRank: rankText(next), item: candidate.item, evidence: candidate.parts, points: candidate.points,
            problem: '빈 칸', why: '빈 칸이라 추천을 위에서부터 채웁니다.', basis: basisOf(candidate.parts, 'text'), reason: `빈 칸${basisShort ? ` → ${basisShort}` : ''}`,
        });
    }
    const empty = KEYWORD_MAX - slots.length;

    // 5칸에 들지 못한 좋은 후보(근거 점수 기준을 넘는 것): 위에서부터 몇 개 + 제외표가 '묶음'으로 가리키는 낱말은 반드시
    const chosen = new Set(slots.map((slot) => compact(slot.next)));
    const intoTerms = new Set(list(recommendation.excluded).filter((entry) => entry.rule === 'merged' && entry.into).map((entry) => compact(entry.into)));
    const left = pool.filter((candidate) => !chosen.has(compact(candidate.item.keyword)));
    const nextCandidates = left
        .filter((candidate, index) => index < NEXT_CANDIDATES_SHOWN || intoTerms.has(candidate.termKey))
        .map((candidate) => ({
            keyword: candidate.item.keyword, term: candidate.item.term || null, evidence: candidate.parts, points: candidate.points,
            basis: basisOf(candidate.parts, 'text'), short: basisOf(candidate.parts, 'short'),
            why: slots.some((slot) => slot.action === 'replace' || slot.action === 'fill')
                ? `5칸의 교체·빈 칸 ${slots.filter((slot) => slot.action === 'replace' || slot.action === 'fill').length}개를 이보다 근거가 강한 후보가 채워 자리가 없습니다.`
                : '지금 등록한 키워드가 모두 그대로라 바꿀 칸이 없습니다.',
        }));
    return {
        slots,
        changes: slots.filter((slot) => slot.action === 'replace' || slot.action === 'fill').length,
        empty: empty > 0 ? empty : 0,
        unranked: slots.filter((slot) => slot.action !== 'keep' && slot.action !== 'check' && !slot.nextRank).map((slot) => slot.next),
        nextCandidates,
    };
}

// lib(place-keywords.js)의 emptyReason(추천이 하나도 없을 때의 까닭)을 사장님이 읽는 말로
const EMPTY_REASON_TEXT = {
    noRegion: '주소·가까운 역에서 지역을 읽지 못해 지역을 붙인 추천을 만들지 못했습니다.',
    allWeak: '조회한 지역이 모두 순위가 낮아 새로 권할 지역이 없습니다.',
    enough: '지금 등록한 키워드가 이미 충분해 더 권하지 않습니다.',
    noData: '추천할 만한 매장 자료가 부족합니다.',
};

export function emptyReasonText(recommendation) {
    return EMPTY_REASON_TEXT[recommendation?.emptyReason] || null;
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

// 일마다 제목·하는 법(1-2-3). 스마트플레이스 메뉴 경로는 위 SP_* 문장처럼 공식으로 확인된 것만 적습니다.
//   preface  이 업종에서는 그 메뉴가 없거나 이름이 다를 수 있다는 안내(약국·동물병원: 공식 확인이 없는 업종)
//   wait     기다리는 시간(네이버 검토·검수) — 걸리는 시간(minutes)과 따로 적습니다
function taskCopy(key, ctx) {
    const { place, activity, item, slots } = ctx;
    const kind = industryKind(place);
    const unsure = kind === 'pharmacy' || kind === 'pet';
    const noFeed = kind === 'clinic';
    const visitor = activity?.visitor || null;
    const unreplied = visitor ? Math.max(0, (visitor.sampled || 0) - (visitor.replied || 0)) : null;
    const perDay = unreplied ? Math.ceil(unreplied / 7) : null;
    const changes = list(slots?.slots).filter((slot) => slot.action === 'replace' || slot.action === 'fill');
    const menuCount = place.menuCount || 0;
    const preface = unsure ? SP_UNSURE_INDUSTRY : null;
    // 메뉴 정보를 여는 한 줄: 음식점·카페는 공식 경로, 미용은 가격·시술 칸, 그 밖은 정보 수정 화면의 해당 칸
    const menuOpen = kind === 'food'
        ? "'정보 수정' 버튼 → '업체정보' → '메뉴정보'로 들어갑니다."
        : kind === 'beauty'
            ? "'정보 수정' 버튼을 누르고, 정보 수정 화면에서 가격·시술 칸을 찾으세요(칸 이름은 화면에서 확인하세요)."
            : "'정보 수정' 버튼을 누르고, 정보 수정 화면에서 해당 칸을 찾으세요(업종에 따라 이름이 다를 수 있습니다).";
    const menuWait = kind === 'food' || kind === 'beauty' ? SP_WAIT.review : null;
    switch (key) {
        case 'keywords': {
            const unranked = changes.filter((slot) => !slot.nextRank);
            const rankStep = unranked.length
                ? `혼잘마 플레이스 분석에서 새로 넣을 ${unranked.map((slot) => `'${slot.next}'`).join(', ')}의 순위를 먼저 조회합니다.`
                : changes.length ? '새로 넣을 키워드는 모두 순위를 조회한 것입니다(1쪽 5칸 표의 순위). 그대로 고칩니다.'
                    : '혼잘마 플레이스 분석의 추천 키워드에서 순위를 먼저 조회합니다.';
            const also = noFeed ? '소개글' : '소개글·소식';
            if (kind === 'clinic') {
                // 병·의원은 대표키워드 자리에 별도의 '검색 키워드'(증상·질병·시술·검진)가 있고 개수 안내가 개편 중이라 개수를 적지 않습니다.
                return {
                    title: changes.length ? `대표키워드 ${changes.length}칸 고치기` : `대표키워드 ${KEYWORD_MAX}칸 채우기`,
                    wait: SP_WAIT.review,
                    steps: [
                        rankStep,
                        "'정보 수정' 버튼을 누릅니다. 병·의원은 대표키워드 자리에 증상·질병·시술·검진을 적는 '검색 키워드' 칸이 따로 있으니 정보 수정 화면에서 찾고, 개수는 화면 안내를 따르세요. 1쪽 '대표키워드 5칸 최종안'은 쓸 낱말을 고르는 참고로 씁니다.",
                        "'최고'·'1등' 같은 자랑하는 말이나 가게 이름은 지워질 수 있고, 네이버 검토 뒤(영업일 최대 5일)에 반영됩니다.",
                        `같은 표현을 ${also}에도 넣습니다. 순위는 반영된 뒤에 다시 조회하세요.`,
                    ],
                };
            }
            return {
                title: changes.length ? `대표키워드 ${changes.length}칸 고치기` : `대표키워드 ${KEYWORD_MAX}칸 채우기`,
                wait: SP_WAIT.review,
                steps: [
                    rankStep,
                    `'정보 수정' 버튼을 누르고 '대표키워드' 칸에 우리 가게를 설명하는 단어(메뉴·서비스·상품 이름)를 한 칸에 한 단어씩, 최대 ${KEYWORD_MAX}개 적고 저장합니다. 1쪽 '대표키워드 5칸 최종안'대로 고칩니다.`,
                    "다섯 칸을 한 번에 고치고 저장하세요. 대표키워드는 기본정보라 일주일에 5번까지만 고칠 수 있습니다. '최고'·'1등' 같은 자랑하는 말이나 가게 이름은 지워질 수 있습니다.",
                    `같은 표현을 ${also}에도 넣습니다. 바꾼 뒤에는 네이버 검토(영업일 최대 5일)가 끝난 다음에 순위를 다시 조회하세요.`,
                ],
            };
        }
        case 'reply':
            return {
                title: unreplied ? `답글 없는 리뷰 ${formatNumber(unreplied)}개에 답글 달기` : '리뷰에 답글 달기',
                steps: [
                    unreplied ? `최근 리뷰 가운데 답글이 없는 ${formatNumber(unreplied)}개를 최근 것부터 고릅니다.` : '답글이 없는 리뷰를 최근 것부터 고릅니다.',
                    "왼쪽 메뉴에서 '리뷰' → '방문자 리뷰'를 누르고, 답글을 달 리뷰의 '답글쓰기'를 눌러 씁니다. 휴대폰 앱은 첫 화면에서 새 리뷰를 보고 '답글쓰기'를 누릅니다.",
                    `아래 예시를 리뷰 내용에 맞게 고쳐 답글로 답니다.${perDay ? ` 하루 ${perDay}개씩이면 일주일 안에 끝납니다.` : ''}`,
                    '답글에 손님 이름·전화번호를 적지 마세요(손님에게 알림이 갑니다). 같은 문장을 복사해 붙이지 말고, 리뷰 하나에 답글은 하나입니다.',
                ],
            };
        case 'feed':
            return {
                title: activity?.feeds?.count === 0 ? '소식 첫 글 올리기' : '소식 1개 올리기',
                preface,
                steps: [
                    "업체 홈 화면 아래쪽 '새소식' 영역으로 가서 글을 씁니다. 휴대폰 앱은 첫 화면의 '새소식 쓰기'를 누릅니다.",
                    '아래 초안의 제목·본문을 붙이고, 가격·영업시간은 오늘 기준으로 확인합니다. 기간을 정해 \'공지\'로 올립니다(공지는 최대 5개, 노출은 최대 45일).',
                    '그 뒤로는 매주 1개씩(적어도 2주에 1개) 올립니다.',
                ],
            };
        case 'description':
            return {
                title: '소개글 쓰기',
                steps: [
                    "'정보 수정' 버튼을 누르고 '상세 설명' 칸을 엽니다. 글자 수 한도는 입력 칸에 표시되는 안내를 따르세요.",
                    '아래 초안을 붙이고 사실과 다른 곳을 고칩니다. 첫 문장에 어디에 있는 어떤 매장인지가 들어가게 둡니다.',
                    "'최고·1위·유일' 같은 표현은 빼고 확인할 수 있는 사실만 씁니다.",
                ],
            };
        case 'intro':
            return {
                title: '한 줄 소개·소개글 첫 문단 다듬기',
                steps: [
                    "'정보 수정' 버튼을 누르고 '상세 설명' 칸을 엽니다. 한 줄 소개 칸은 같은 화면에서 찾으세요(칸 이름과 위치는 업종마다 다를 수 있습니다). 글자 수 한도는 입력 칸의 안내를 따르세요.",
                    `한 줄 소개에 대표 ${item}·지역을 사실대로 적습니다(아래 초안).`,
                    "'최고·1위·유일' 같은 표현은 빼고 확인할 수 있는 사실만 씁니다.",
                ],
            };
        case 'photos':
            return {
                title: '업체 사진 올리기',
                steps: [
                    '외관·내부·대표 상품 사진을 찍습니다.',
                    "'정보 수정' 버튼을 누르고 '업체 사진' 칸에 사진을 올린 뒤 저장합니다. 사진은 최대 120장, 한 장에 10MB 이하(JPG·PNG·GIF)로 올려 주세요.",
                    '매장 화면 맨 위와 검색 목록에 보이는 사진이라, 밝고 흔들리지 않은 사진을 고릅니다.',
                ],
            };
        case 'menuDesc':
            return {
                title: `${item} 설명 쓰기`,
                wait: menuWait,
                steps: [
                    `${menuOpen} 아래 표의 ${item}${josa(item, '을', '를').slice(item.length)} 찾아 설명을 적습니다(설명·사진 칸의 이름은 화면에서 확인하세요).${kind === 'food' ? ' 네이버 주문이나 배달의민족을 함께 쓰는 가게는 메뉴를 그쪽에서 고쳐야 손님 화면에 반영됩니다.' : ''}`,
                    item === '시술'
                        ? "시술마다 구성·걸리는 시간을 한 줄로 적습니다. 실력 평가('최고' 등)는 쓰지 않습니다."
                        : `${item}마다 재료·양·구성을 한 줄로 적습니다. 맛 평가('최고' 등)는 쓰지 않습니다.`,
                    menuCount ? `등록한 ${item} ${formatNumber(menuCount)}개 가운데 아래 표의 ${item}부터 5개씩 채웁니다(표의 순서는 '고른 까닭' 칸 참고).` : `아래 표의 ${item}부터 5개씩 채웁니다.`,
                ],
            };
        case 'menuAdd':
            if (ctx.offerings) {
                // 약국: 메뉴판·가격이 아니라 취급 품목(손님이 찾는 말)과 서비스(손님이 고른 좋은 점)를 글자로 등록합니다. 약국의 등록 칸은 공식 확인이 없어 소개글로 대신하게 안내합니다.
                return {
                    title: '취급 품목·서비스 등록하기',
                    preface,
                    steps: [
                        `'정보 수정' 버튼을 누르고 취급하는 품목·서비스를 이름과 한 줄 설명으로 글자로 적을 칸을 찾습니다(예: ${ctx.offerings.map((entry) => entry.text).join('·')}). 칸이 없거나 이름이 다르면 소개글('상세 설명')에 같은 내용을 글로 적으세요.`,
                        '약 이름이나 성분을 늘어놓기보다 손님이 찾는 말로 쓰고, 효능·효과를 말하는 문구는 쓰지 않습니다.',
                        '아래 후보는 대표키워드와 손님이 고른 좋은 점에서 뽑은 것입니다. 실제로 하는 것만 넣으세요.',
                    ],
                };
            }
            if (ctx.health) {
                // 병원·치과·동물병원 계열: 메뉴판·가격이 아니라 진료 과목·서비스를 글자로 등록합니다(화면 AI 진단 place-geo 의 healthWords 와 같은 말).
                return {
                    title: `${ctx.health.item} 등록하기`,
                    preface: SP_UNSURE_INDUSTRY,
                    steps: [
                        `'정보 수정' 버튼을 누르고 ${ctx.health.item}(예: ${ctx.health.examples})을 이름과 한 줄 설명으로 글자로 적을 칸을 찾습니다. 칸이 없거나 이름이 다르면 소개글('상세 설명')에 같은 내용을 글로 적으세요.`,
                        '실제로 하는 것만 적고, 가격은 알릴 수 있는 것만 적습니다. 진료·시술의 효과를 단정하는 표현은 쓰지 않습니다.',
                        '아래 후보는 지금 등록한 대표키워드에서 뽑은 것입니다. 실제로 다루는 것만 넣으세요.',
                    ],
                };
            }
            return {
                title: `${item} 등록하기`,
                wait: menuWait,
                steps: [
                    kind === 'food'
                        ? "'정보 수정' 버튼 → '업체정보' → '메뉴정보'로 들어가 대표 메뉴의 이름과 가격을 함께 적습니다(가격 없이 이름만은 등록되지 않습니다). 네이버 주문이나 배달의민족을 함께 쓰는 가게는 그쪽에서 고쳐야 반영됩니다(네이버 주문은 '예약/주문 → 예약관리 → 예약·주문 → 메뉴', 배달의민족은 배달의민족 사장님 사이트)."
                        : kind === 'beauty'
                            ? `'정보 수정' 버튼을 누르고, 정보 수정 화면에서 가격·시술 칸을 찾아 대표 ${item}의 이름과 가격을 함께 적습니다(시술 정보는 한 가지 이상 필수이고, 가격 없이 이름만은 등록되지 않습니다).`
                            : `'정보 수정' 버튼을 누르고, 정보 수정 화면에서 해당 칸을 찾아 대표 ${item}의 이름·가격·한 줄 설명을 적습니다(업종에 따라 이름이 다를 수 있습니다).`,
                    '메뉴판 사진만 올리면 AI가 읽지 못합니다. 가격은 숫자(또는 최소 가격)로 적고, 한 줄 설명도 함께 적습니다.',
                    '아래 후보는 지금 등록한 대표키워드에서 뽑은 것입니다. 실제로 다루는 것만 넣으세요.',
                ],
            };
        case 'menuPrice': {
            const unpriced = menuCount && Number.isFinite(place.menuPricedCount) ? menuCount - place.menuPricedCount : null;
            return {
                title: unpriced ? `가격 없는 ${item} ${unpriced}개에 가격 적기` : `${item} 가격 적기`,
                wait: menuWait,
                steps: [
                    `${menuOpen} 등록한 ${item} 가운데 가격이 빠진 것을 찾습니다.`,
                    '"시가·문의" 대신 숫자 가격(또는 최소 가격)을 적습니다. 가격 없이 이름만은 등록되지 않습니다.',
                ],
            };
        }
        case 'menuImage':
            return { title: '메뉴·가격 사진 올리기', wait: menuWait, steps: ['메뉴판이나 가격표를 찍습니다.', `${menuOpen} 사진을 올립니다(사진 칸의 이름·규격은 화면 안내를 따르세요).`] };
        case 'menuRefresh':
            return { title: `${item} 가격·사진 점검`, wait: menuWait, steps: [`${menuOpen} 등록한 ${item}의 가격·사진을 지금 기준으로 확인합니다.`, '가격이 바뀌었다면 고쳐서 다시 저장합니다.'] };
        case 'hours':
            return {
                title: '영업시간 등록',
                wait: SP_WAIT.hours,
                steps: [
                    "'정보 수정' 버튼 → '업체정보' → '휴무일, 영업시간'으로 들어갑니다.",
                    '요일별 시간과 쉬는 날(공휴일 포함)을 고르고 저장합니다. 검색 화면에는 최대 하루 뒤에 반영됩니다.',
                    '네이버 예약을 쓰는 가게는 예약 관리 화면의 예약 상품 시간도 따로 맞춰야 합니다.',
                ],
            };
        case 'accessor':
            return {
                title: '찾아오는 길 적기',
                steps: ["'정보 수정' 버튼을 누르고 '찾아오는 길' 칸을 찾으세요(글자 수 안내는 입력 칸의 표시를 따르세요).", '주차 위치·가까운 정류장·건물 입구를 적습니다.'],
            };
        case 'conveniences':
            return {
                title: '편의시설 체크',
                wait: SP_WAIT.extra,
                steps: ["'정보 수정' 버튼 → '부가정보'로 들어갑니다.", '주차, 반려동물 동반, 노키즈존 여부와 \'인근 주차 가능한 장소\'를 사실대로 고르고 저장합니다(숙박업은 글로 적는 칸이 없습니다).'],
            };
        case 'parking':
            return {
                title: '주차·편의시설 등록',
                wait: SP_WAIT.extra,
                steps: ["'정보 수정' 버튼 → '부가정보'로 들어갑니다.", '주차 여부와 \'인근 주차 가능한 장소\'를 사실대로 고르고 저장합니다. 주차가 안 되면 "주차 불가, 근처 주차장"처럼 대안을 적습니다.'],
            };
        case 'hype':
            return { title: '광고성 표현 빼기', steps: ['대표키워드·한 줄 소개·소식 제목에서 아래 표현을 찾습니다.', '확인할 수 있는 사실(위치·시간·가격)로 바꿉니다.'] };
        case 'talktalk':
            return {
                title: '네이버 톡톡 연결',
                preface,
                steps: [
                    "업체 페이지에서 '톡톡연결'을 선택합니다. 연결하면 손님 화면에 바로 나타납니다(끄려면 톡톡파트너센터 > 내 계정에서 사용 중지).",
                    '휴대폰 알림을 받게 해 두면 답이 빨라집니다.',
                ],
            };
        case 'booking':
            return {
                title: '네이버 예약 켜기',
                preface,
                wait: SP_WAIT.booking,
                steps: [
                    "스마트플레이스에서 '예약/주문'을 누르고 '+서비스 추가'로 가게를 고른 뒤 정보를 입력하고, 예약 상품을 만들어 '노출'로 바꿉니다.",
                    "같은 화면의 '설정'에서 '검수 신청'을 누르세요(신청일 제외 2~3영업일). 통과하면 '운영설정'에서 예약받기를 '시작'으로 바꿉니다.",
                    "네이버 지도·검색의 가게 화면에 '예약' 버튼이 보이려면 '솔루션'에서 플레이스 연결까지 해야 합니다(이 마지막 단계의 정확한 칸 이름은 화면에서 확인하세요).",
                    '받을 수 있는 시간·자리만 열어 둡니다.',
                ],
            };
        case 'coupon':
            return {
                title: '쿠폰 1개 등록',
                preface,
                steps: [
                    "왼쪽 '마케팅' → '쿠폰' → '쿠폰함'으로 들어가 '신규 쿠폰 만들기'를 누르고 종류(할인/증정)·대상·기간을 정합니다.",
                    '대상·혜택은 사장님이 정합니다. 별점·리뷰 문구를 쿠폰 조건으로 걸지 않습니다.',
                ],
            };
        case 'blog':
            return { title: '블로그 후기 받기', steps: ['체험단·방문 후기로 블로그 글이 꾸준히 쌓이게 합니다.', "대가가 있으면 글에 '광고·협찬'을 꼭 밝히게 하고, 별점·문구는 정해 주지 않습니다."] };
        default:
            return { title: null, steps: [] };
    }
}

/* 화면 문장(지금 할 일·AI 검색 진단)을 업종에 맞는 낱말로 바꿔 인쇄합니다. 낱말은 place-geo.js 의 healthWords 와 같은 말입니다.
 *  - 약국·병원 계열 '새 메뉴·이벤트·휴무 안내' → '새 서비스·휴무 안내', 미용·네일·피부 → '새 시술·휴무 안내'
 *  - 음식점이 아니면 '네이버 예약(또는 주문)' → '네이버 예약'
 *  - '대표 메뉴(서비스)' → 약국·병원 '대표 취급 품목·서비스'(진료 과목·서비스), 미용·네일·피부 '대표 시술' */
const FOOD_KEYS = new Set(['restaurant', 'cafe', 'bar']);
const BEAUTY_KEYS = new Set(['hair', 'nail', 'skin']);

export function industryText(value, place) {
    let out = String(value ?? '');
    if (!out) return out;
    const key = familyOf(place)?.key;
    const health = healthWords(place);
    const noun = health ? '서비스' : BEAUTY_KEYS.has(key) ? '시술' : null;
    if (noun) out = out.replace(/새 메뉴·이벤트·휴무/g, `새 ${noun}·휴무`);
    if (!FOOD_KEYS.has(key)) out = out.replace(/\(또는 주문\)/g, '');
    const label = health?.item || (BEAUTY_KEYS.has(key) ? '시술' : null);
    if (label) {
        out = out.replace(/대표 메뉴\(서비스\)/g, `대표 ${label}`);
        // 음식점 말(재료·양·맛, 메뉴 설명)을 그 업종의 말로
        out = out.replace(/재료·양\(몇 인분\)·맛 특징/g, BEAUTY_KEYS.has(key) ? '구성·걸리는 시간' : '품목·이용 방법');
        out = out.replace(/메뉴 설명/g, `${label} 설명`);
    }
    // 검색 행태를 단정하지 않음("손님이 실제로 검색하는 조합" → 자료로 확인한 것은 '지역을 붙인 조합'뿐)
    out = out.replace(/손님이 실제로 검색하는 조합/g, '지역을 붙인 조합');
    // '리뷰 쿠폰'(리뷰를 조건으로 한 혜택)은 같은 문서가 정책 위반이라고 안내하므로 어느 업종에도 권하지 않습니다.
    out = out.replace(/리뷰 작성·첫 방문 쿠폰/g, '첫 방문 쿠폰').replace(/첫 방문·리뷰 쿠폰/g, '첫 방문 쿠폰').replace(/리뷰\s*쿠폰/g, '쿠폰');
    // 병·의원: 네이버가 새소식 기능을 제공하지 않으므로 소식에 넣으라는 말을 뺍니다.
    if (industryKind(place) === 'clinic') out = out.replace(/소개글·소식/g, '소개글').replace(/소식·소개글/g, '소개글');
    return out;
}

// 처방 '왜'에 옮겨 오는 화면 문장 가운데 자료로 확인되지 않는 것은 뺍니다.
//  - 손님의 검색 행태 단정("손님은 '청주약국'처럼 지역을 붙여 검색합니다"): 검색량·검색 행태 자료는 없습니다.
//  - 5칸 이유에 이미 적은 "빈 칸이 1개 남았습니다"의 되풀이
const UNSUPPORTED_BEHAVIOR = /(손님은\s.*(검색합니다|검색하는)|검색하는 손님은|검색할 때 쓰는 말과 다를)/;

function scrubWhy(value, { hasFill = false } = {}) {
    return sentencesOf(value)
        .filter((sentence) => !UNSUPPORTED_BEHAVIOR.test(sentence) && !(hasFill && /^빈 칸이 \d+개 남았습니다\.?$/.test(sentence)))
        .join(' ');
}

// 약국에 등록할 만한 취급 품목·서비스 후보(자료에서 확인되는 것만).
//   품목  분류 이름('건강기능식품')으로 등록한 키워드의 손님 말('영양제'). '○○약국' 꼴은 가게 종류라 뺍니다.
//   서비스  손님이 고른 좋은 점 가운데 서비스를 가리키는 말('복약지도를 잘해줘요' → 복약지도, '상담이 자세해요' → 약 상담)
// 돌려주는 값: [{ text, from }] — 없으면 빈 배열(그러면 이 처방은 문서에서 뺍니다).
const PHARMACY_SERVICE_VOTES = [[/복약\s*지도/, '복약지도'], [/상담/, '약 상담']];

export function pharmacyOfferings(place, recommendation) {
    const out = [];
    for (const entry of list(recommendation?.registered)) {
        const term = entry.spoken?.term;
        if (entry.concern?.rule === 'classification' && term && !/약국$/.test(term) && !out.some((offer) => offer.text === term)) {
            out.push({ text: term, from: `대표키워드 '${entry.keyword}'${josa(entry.keyword, '을', '를').slice(String(entry.keyword).length)} 손님이 부르는 말` });
        }
    }
    for (const vote of list(place?.reviewVotes)) {
        for (const [pattern, name] of PHARMACY_SERVICE_VOTES) {
            if (pattern.test(String(vote?.label || '')) && !out.some((offer) => offer.text === name)) out.push({ text: name, from: `손님이 고른 좋은 점 '${vote.label}'` });
        }
    }
    return out;
}

// 사진이 없는 메뉴 수. 화면(page.js MenuBoard)과 같게, 메뉴마다 사진 칸이 있는지(hasImage 가 true/false 로 오는 업종)를 먼저 봅니다.
export function menusWithoutPhoto(place) {
    const menus = list(place?.detail?.menus);
    const photoKnown = menus.some((menu) => menu && menu.hasImage !== null && menu.hasImage !== undefined);
    if (!photoKnown) return 0;
    const total = place.menuCount || menus.length;
    const count = total - (place.menuImageCount || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
}

function buildTasks({ place, activity, actions, geo, slots, diagnoses, item, recommendation }) {
    const tasks = new Map();
    const ensure = (key) => {
        if (!TASK_INFO[key]) return null;
        if (!tasks.has(key)) tasks.set(key, { key, level: null, problems: [], why: [], how: [], gain: { geo: 0, aeo: 0 }, aiOnly: true, fromAction: false, aiTitle: null });
        return tasks.get(key);
    };
    const LEVEL_ORDER = { high: 0, mid: 1, low: 2 };
    for (const action of actions) {
        const task = ensure(ACTION_TASK[action.key] || action.key);
        if (!task) continue;
        task.aiOnly = false;
        task.fromAction = true;
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
        // 새 대표키워드는 소식에도 같은 표현으로 넣어야 하므로, 소식 일이 따로 없으면 그 일을 더합니다(소식 초안에 새 낱말·확인된 혜택을 담음).
        if (!tasks.has('feed') && activity?.feeds) {
            const feed = ensure('feed');
            feed.aiOnly = false;
            feed.level = feed.level || 'low';
            feed.why.push(`새로 넣는 대표키워드(${changed.slice(0, 3).map((slot) => `'${slot.next}'`).join(', ')})를 소식에도 같은 표현으로 넣습니다.`);
        }
    }
    // 점검 점수가 오르지 않고 '지금 할 일'에도 없는 AI 검색 일은 처방에 넣지 않습니다(AI 검색 준비 구역에서 다룸).
    for (const [key, task] of tasks) if (task.aiOnly && gainOf(task) <= 0) tasks.delete(key);

    // 약국: AI 검색 점검은 업종과 상관없이 "대표 메뉴 5개를 가격·설명과 함께"를 권하지만, 약국에는 맞지 않습니다.
    // 손님 말(영양제 등)과 손님이 고른 서비스로 다시 쓰고, 맞는 내용이 없으면 이 처방을 뺍니다.
    const offerings = familyOf(place)?.key === 'pharmacy' ? pharmacyOfferings(place, recommendation) : null;
    if (offerings && tasks.has('menuAdd')) {
        const task = tasks.get('menuAdd');
        if (offerings.length === 0) tasks.delete('menuAdd');
        else {
            task.problems = ['취급하는 품목·서비스를 글자로 적은 안내가 없습니다.'];
            task.how = [];
        }
    }

    // 사진 없는 메뉴(화면 '메뉴·가격' 표의 "사진 없는 메뉴 N개"와 같은 계산): 메뉴마다 사진 칸이 있는 업종에서만
    const noPhoto = menusWithoutPhoto(place);
    if (noPhoto > 0 && tasks.has('menuDesc')) {
        const task = tasks.get('menuDesc');
        if (task.why.length === 0 && task.problems[0]) task.why.push(task.problems[0]);
        task.why.push(`사진 없는 ${item} ${formatNumber(noPhoto)}개(설명을 쓸 때 사진도 함께 올립니다).`);
    }

    const diagTasks = new Set(diagnoses.map((diag) => diag.task).filter(Boolean));
    const ctx = { place, activity, item, slots, offerings: offerings && offerings.length ? offerings : null, health: healthWords(place) };
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
            title: industryText(copy.title || task.aiTitle || task.problems[0] || task.key, place),
            problem: task.problems[0] ? industryText(task.problems[0], place) : null,
            why: [...new Set(task.why)].map((line) => industryText(scrubWhy(line, { hasFill: slots?.slots?.some((slot) => slot.action === 'fill') }), place)).filter(Boolean),
            how: [...new Set(task.how)].map((line) => industryText(line, place)),
            steps: copy.steps,
            preface: copy.preface || null,
            wait: copy.wait || null,
            minutes: info.minutes,
            timeLabel: minutesLabel(info.minutes),
            where: taskWhere(task.key, place),
            weekOk: info.week,
            // 출처: 화면 '지금 할 일'에 있는 일 · 5칸 분석에서 나온 일 · AI 검색 점검에서만 나온 일(표에 'AI 검색 점검'을 붙입니다)
            source: task.fromAction ? 'screen' : task.aiOnly ? 'ai' : 'slots',
            sourceLabel: !task.fromAction && task.aiOnly ? AI_SOURCE_LABEL : null,
            gain: gainText(gainOf(task) > 0 ? task.gain : null),
            score: base + gain + slot + diag,
            index,
        };
    });
    const sorted = scored.sort((a, b) => b.score - a.score || a.index - b.index);
    // 라벨은 화면 단계(먼저·권장·참고) 대신 이 문서의 순서를 따릅니다: 이번 주 할 일 3개 = 먼저, 다음 3개 = 권장, 나머지 = 참고.
    // (1쪽 '이번 주 할 일'과 4주 실행표가 같은 우선순위를 씀)
    let position = 0;
    for (const task of sorted) {
        const level = task.weekOk ? (position < WEEK_MAX ? 'high' : position < WEEK_MAX * 2 ? 'mid' : 'low') : 'low';
        if (task.weekOk) position += 1;
        task.screenLevel = task.level;
        task.level = level;
        task.levelLabel = LEVEL_LABEL[level];
    }
    return sorted;
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

export function diagnosisCandidates({ place, activity, recommendation, rankOf, regions, comparison, geo, item, nowMs = Date.now() }) {
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
        // 마지막 소식이 며칠 전인지는 화면 모든 곳과 같은 값(feedDays: 날짜가 있으면 지금 기준으로 다시 센 값)을 씁니다.
        const days = feedDays(feeds, nowMs);
        if (feeds.count === 0) add('feed', 70, '소식을 한 번도 올리지 않았습니다.', null, 'feed');
        else if (Number.isFinite(days) && days > 30) {
            // 소식 제목은 짧을 때만 따옴표로 옮깁니다(긴 제목이 1쪽을 밀어내지 않게). 길면 올린 날짜만 적습니다.
            const title = String(feeds.latestTitle || '').trim();
            const when = feeds.latest ? `${Number(feeds.latest.slice(5, 7))}월 ${Number(feeds.latest.slice(8, 10))}일` : null;
            const tail = title && title.length <= FEED_TITLE_MAX ? `: 마지막 소식은 "${title}"입니다.` : when ? `: 마지막 소식은 ${when}에 올렸습니다.` : '.';
            add('feed', 52 + Math.min(18, (days - 30) / 3), `소식 ${days}일째 없음${tail}`, null, 'feed');
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
// 순위 표 한 줄의 결과 말: "6위" · "300위 밖" · "조회 중" · "조회 못 함"
function rankRowText(row) {
    return isDone(row) ? rankLabel(row.result) : '순위 미조회';
}

// 순위를 조회한 키워드를 10위 안 / 10위 밖 / 순위 미조회로 나눠 전부 적습니다("10위 안: A 3위 · B 5위 / 10위 밖: C 12위 / 순위 미조회: D").
export function rankGroupsText(table) {
    const rows = list(table).filter((row) => row && row.keyword);
    const name = (row) => String(row.keyword).trim();
    const inTop = rows.filter((row) => isDone(row) && isFound(row.result) && row.result.rank <= RANK_GOOD);
    const outside = rows.filter((row) => isDone(row) && !inTop.includes(row));
    const unknown = rows.filter((row) => !isDone(row));
    return [
        `10위 안: ${inTop.length ? inTop.map((row) => `${name(row)} ${rankLabel(row.result)}`).join(' · ') : '없음'}`,
        outside.length ? `10위 밖: ${outside.map((row) => `${name(row)} ${rankLabel(row.result)}`).join(' · ')}` : null,
        unknown.length ? `순위 미조회: ${unknown.map(name).join(' · ')}` : null,
    ].filter(Boolean).join(' / ');
}

// 상위 전체와의 비교를 한 줄로("상위 99곳 중간값 2,100개 · 앞섬"). 방문자 리뷰·블로그 리뷰 줄에 씁니다.
function poolCompare(pool, key) {
    const row = pool?.rows.find((entry) => entry.key === key);
    if (!row) return null;
    return `상위 ${formatNumber(pool.count)}곳 중간값 ${formatNumber(row.median)}개${row.verdictLabel ? `(${row.verdictLabel})` : ''}`;
}

// 방문자 리뷰가 쌓이는 지금 속도(참고값). 화면의 '최근 7일 리뷰'와 같은 값입니다. 목표나 약속이 아닙니다.
function reviewPace(visitor) {
    if (!visitor || !Number.isFinite(visitor.last7) || !Number.isFinite(visitor.perDay)) return null;
    return `지금 속도(참고): 최근 7일 ${formatNumber(visitor.last7)}개 · 하루 약 ${visitor.perDay}개`;
}

export function pickMetrics({ place, activity, rankOf, rankTable = null, comparison, pool = null, geo, diagnoses, week, item, nowMs = Date.now() }) {
    const metrics = new Map();
    const add = (key, label, now, compare = null, note = null, compareShort = null) => {
        if (!metrics.has(key) && now) metrics.set(key, { key, label, now, compare, note, compareShort });
    };
    // 비교 기준의 짧은 꼴(키워드 이름 없이). 1쪽이 넘칠 때 fitSummary 가 씁니다.
    const shortCompare = (gap) => (gap.row.above.count === 1 ? `${gap.row.above.from}위 매장 ${formatNumber(gap.mid)}개` : `${rangeLabel(gap.row.above)} 중간값 ${formatNumber(gap.mid)}개`);
    const visitor = activity?.visitor;
    const visitorGap = biggestGap(comparison.gapRows, 'visitor');
    const blogGap = biggestGap(comparison.gapRows, 'blog');
    // 화면 '키워드 순위'의 "10위 안 N/M"과 같은 모수: 순위 표의 모든 줄(조회 중·실패 포함). 어느 키워드를 셌는지 함께 적어 4주 뒤 같은 기준으로 비교합니다.
    const table = list(rankTable).filter((row) => row && row.keyword);
    const joinCompare = (...texts) => texts.filter(Boolean).join(' · ') || null;
    const make = {
        reply: () => visitor && Number.isFinite(visitor.replyRate)
            && add('reply', '사장님 답글률', `${visitor.replyRate}% (최근 ${formatNumber(visitor.sampled)}개 중 ${formatNumber(visitor.replied || 0)}개)`, `혼잘마 점검 기준 ${REPLY_TARGET}% 이상`),
        feed: () => {
            if (!activity?.feeds) return;
            const days = feedDays(activity.feeds, nowMs);
            add('feed', '최근 30일 소식', `${formatNumber(activity.feeds.last30 ?? 0)}개${days ? ` (마지막 ${days}일 전)` : ''}`);
        },
        rank: () => {
            if (!table.length) return;
            const inTop = table.filter((row) => isDone(row) && isFound(row.result) && row.result.rank <= RANK_GOOD).length;
            add('rank', '10위 안 키워드', `${inTop}/${table.length}개`, '4주 뒤에는 5칸 최종안 키워드로 조회(4주 실행표 아래 표)',
                `순위를 조회한 키워드 ${table.length}개 — ${rankGroupsText(table)}`);
            // 키워드 이름을 전부 적는 줄이라 줄이지 않고 표 전체 너비로 둡니다(1쪽 맞추기도 이 메모는 줄이지 않음).
            metrics.get('rank').wideNote = true;
        },
        keywords: () => list(place.keywords).length > 0
            && add('keywords', '지역명이 든 대표키워드', `${countRegionKeywords(place, comparison.recommendation)}/${place.keywords.length}개`),
        visitor: () => known(place.visitorReviews) && add('visitor', '방문자 리뷰', `${formatNumber(place.visitorReviews)}개`,
            joinCompare(poolCompare(pool, 'visitor'), visitorGap ? gapCompare(visitorGap) : null), reviewPace(visitor),
            joinCompare(poolCompare(pool, 'visitor'), visitorGap ? shortCompare(visitorGap) : null)),
        blog: () => known(place.blogReviews) && add('blog', '블로그·카페 리뷰', `${formatNumber(place.blogReviews)}개${activity?.blog && Number.isFinite(activity.blog.last30) ? ` (최근 30일 ${activity.blog.last30}개)` : ''}`,
            joinCompare(poolCompare(pool, 'blog'), blogGap ? gapCompare(blogGap) : null), null,
            joinCompare(poolCompare(pool, 'blog'), blogGap ? shortCompare(blogGap) : null)),
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
    // 10위 안 키워드 줄은 A·B(순위 표기·4주 뒤 비교)와 이어져 있어, 1쪽이 넘칠 때 맨 나중에 빠지도록 맨 앞에 둡니다.
    const ordered = [...metrics.values()];
    const rank = ordered.find((metric) => metric.key === 'rank');
    return (rank ? [rank, ...ordered.filter((metric) => metric !== rank)] : ordered).slice(0, METRICS_MAX);
}

function countRegionKeywords(place, recommendation) {
    const byKeyword = new Map(list(recommendation?.registered).map((entry) => [compact(entry.keyword), entry]));
    return list(place.keywords).filter((keyword) => byKeyword.get(compact(keyword))?.hasRegion).length;
}

/* ───────── 상세: 처방 ───────── */

function attachDrafts(task, ctx) {
    const { place, activity, geo, nowMs, recommendation, focus, also } = ctx;
    switch (task.key) {
        case 'reply':
            return replyDrafts(place, { recommendation });
        case 'feed':
            return feedDrafts(place, { question: geo?.question || null, nowMs, recommendation, focus, activity, also });
        case 'description':
        case 'intro':
            return introDraft(place, activity, { recommendation });
        case 'menuDesc':
            return menuFrames(place, { recommendation, focus, also });
        case 'menuAdd': {
            if (familyOf(place)?.key === 'pharmacy') {
                const offers = pharmacyOfferings(place, recommendation);
                return offers.length ? { kind: 'list', label: '등록할 품목·서비스 후보(대표키워드와 손님이 고른 좋은 점에서 확인된 것)', items: offers.map((offer) => `${offer.text}(${offer.from})`) } : null;
            }
            const names = list(place.keywords).filter((keyword) => !list(recommendation?.registered).find((entry) => compact(entry.keyword) === compact(keyword))?.hasRegion);
            return names.length ? { kind: 'list', label: `등록할 ${healthWords(place)?.item || itemWord(place)} 후보(지금 대표키워드)`, items: names } : null;
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
    // 스마트플레이스에서 하는 일이 하나라도 있으면 시작 안내를 문서에 한 번만 둡니다(일마다 되풀이하지 않음).
    const usesSmartplace = tasks.some((task) => task.where && task.where.startsWith('스마트플레이스'));
    const note = industryNote(ctx.place);
    return {
        id: 'tasks',
        title: '처방 상세',
        lead: `할 일마다 왜 해야 하는지(근거 숫자), 하는 법, 걸리는 시간, 바로 쓸 초안을 적었습니다. 초안은 "${DRAFT_MARK}".`,
        // 모든 '하는 법'의 시작 안내: 로그인·내 업체 + 메뉴 이름이 바뀔 수 있다는 한 줄 + (병의원) 소식·쿠폰을 넣지 않은 까닭
        guide: usesSmartplace ? [
            { label: '먼저', text: SP_LOGIN },
            { label: '메뉴 이름', text: SP_NAMES_MAY_CHANGE },
            ...(note ? [{ label: industryKind(ctx.place) === 'clinic' ? '병·의원' : '약국', text: note }] : []),
        ] : [],
        items: detailed,
        rest: tasks.slice(TASK_DETAIL_MAX).map((task) => ({
            key: task.key, title: task.title, timeLabel: task.timeLabel, where: task.where, wait: task.wait || null, preface: task.preface || null,
            steps: task.steps, how: task.how[0] || task.steps[0] || null,
        })),
    };
}

/* ───────── 상세: 키워드 처방 ───────── */

// 추천에서 뺀 낱말의 이유를 인쇄본만으로 읽히는 짧은 한 줄로 줄입니다(recommendKeywords 의 reason 은 화면용 긴 문장).
// 숫자(메뉴 34개 중 1개뿐 등)는 그 문장에 있을 때만 옮기고, 규칙을 모르면 첫 문장을 그대로 씁니다.
function firstSentence(text) {
    return String(text || '').split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '').trim();
}

// 키워드로는 빼지만 손님이 많이 찾는 낱말(otherBusiness·offMain 의 popular 필드): "리뷰 언급 37회·주간 인기 메뉴 1위·AI 브리핑에도 나옴"
function popularFacts(popular) {
    if (!popular || typeof popular !== 'object') return [];
    return [
        Number.isFinite(popular.reviews) ? `리뷰 언급 ${formatNumber(popular.reviews)}회` : null,
        Number.isFinite(popular.posRank) ? `주간 인기 메뉴 ${popular.posRank}위` : null,
        popular.briefing ? 'AI 브리핑에도 나옴' : null,
    ].filter(Boolean);
}

// delivered: 그 낱말(의 메뉴)을 실제로 넣은 초안 이름(['메뉴 설명', '소식']). 비어 있으면 초안에 넣지 못한 것.
export function excludedReason(entry, { regions = [], delivered = [] } = {}) {
    const reason = String(entry?.reason || '').trim();
    const into = entry?.into ? `'${entry.into}'` : null;
    const count = reason.match(/메뉴\s*(\d+)개\s*중\s*(\d+)개/);
    // 손님이 많이 찾는 낱말이면 그 사실을 먼저 적고, 키워드로는 빼는 까닭과 대신 쓸 자리를 이어 적습니다.
    const facts = popularFacts(entry?.popular);
    const places = Array.isArray(entry?.useIn) && entry.useIn.length ? entry.useIn.join('·') : null;
    if ((entry?.rule === 'otherBusiness' || entry?.rule === 'offMain') && (facts.length || places)) {
        // 자료가 말하는 것만: 리뷰·결제 자료에 나온 사실을 적고, 검색 행태나 "많이 찾는다"는 단정은 쓰지 않습니다.
        // 빼는 까닭은 lib(place-keywords.js)이 준 이유 문장을 그대로 씁니다(없을 때만 규칙별 줄임말).
        const libWhy = typeof entry.why === 'string' ? firstSentence(entry.why) : '';
        const why = libWhy && !UNSUPPORTED_BEHAVIOR.test(libWhy)
            ? libWhy
            : entry.rule === 'otherBusiness' ? '다른 업종의 낱말이라 키워드로는 뺌' : '주력이 아닌 곁들임이라 키워드로는 뺌';
        const tail = delivered.length ? ` 넣은 초안: ${delivered.join('·')}.`
            : places ? ` ${places}에 쓸 수 있습니다(이 문서의 초안에는 넣지 못함).` : '';
        return `${facts.length ? `매장 자료: ${facts.join('·')}. ` : ''}${why}.${tail}`;
    }
    // 사실(popular)이 없으면 추천이 준 이유 한 문장(why)을, 그것도 없으면 아래 규칙별 줄임말을 씁니다.
    if ((entry?.rule === 'otherBusiness' || entry?.rule === 'offMain') && typeof entry.why === 'string' && entry.why.trim() && !UNSUPPORTED_BEHAVIOR.test(firstSentence(entry.why))) return firstSentence(entry.why);
    switch (entry?.rule) {
        // 근거가 매장 사실 하나뿐인 업종 연관어: 두 문장("…하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다.")을 그대로
        case 'thin': return reason.replace(/[.!?]$/, '') || '근거가 하나뿐이라 권하지 않음';
        case 'broad': return '범위가 넓은 업종 이름이라 지역을 붙여도 어떤 매장인지 가려지지 않음';
        case 'extra': return '주력이 아닌 추가 메뉴';
        case 'vague': return '뜻이 넓어 어떤 손님이 찾는 말인지 알 수 없음';
        case 'drink': return '술·음료는 이 매장의 주력이 아님';
        case 'otherBusiness': return count ? `읽어 온 메뉴 ${count[1]}개 중 ${count[2]}개뿐이라 주력으로 보기 어려움` : '이 매장의 주력이 아닌 다른 업종의 낱말';
        case 'offMain': {
            const only = reason.match(/메뉴\s*(\d+)개에만/);
            return `주력 메뉴가 아닌 곁들임이라 따로 권하지 않음${only ? `(메뉴 ${only[1]}개에만 나옴)` : ''}`;
        }
        case 'classification': return into ? `약·제품을 나누는 분류 이름이라 ${into} 키워드로 묶음` : '약·제품을 나누는 분류 이름이라 따로 권하지 않음';
        case 'condition': return firstSentence(reason) || '이 매장의 조건에 맞지 않음';
        case 'rivalOnly': return '상위 매장만 쓰는 말이고 내 매장에는 근거가 없음';
        case 'noBlog': return '블로그 후기에 나오지 않고 다른 근거도 없음';
        case 'channel': return '받는 방법(포장·배달)이라 어떤 가게인지 알 수 없음';
        case 'merged': return into ? `${into}${josa(entry.into, '이', '가').slice(String(entry.into).length)} 들어 있는 말이라 하나로 묶음` : '더 짧은 낱말에 들어 있는 말이라 하나로 묶음';
        case 'rank': {
            const group = list(regions).find((region) => compact(region.region) === compact(entry.term));
            return group?.text ? `이 지역 키워드는 ${group.text}${josa(group.text, '이라', '라').slice(group.text.length)} 새 조합을 만들지 않음` : '내 순위가 낮아 이 지역에는 새 조합을 만들지 않음';
        }
        default: return firstSentence(reason) || '추천 기준에 맞지 않음';
    }
}

// "강남댄디컷"(term 댄디컷) → "강남+댄디컷"
function comboLabel(keyword, term) {
    const word = String(keyword || '');
    const tail = String(term || '');
    return tail && word.endsWith(tail) && word.length > tail.length ? `${word.slice(0, -tail.length)}+${tail}` : word;
}

const COMBO_SHOWN = 6;

function excludedPart(recommendation, { regions = [], deliveredBy = () => [] } = {}) {
    const excluded = list(recommendation?.excluded);
    if (excluded.length === 0 || list(recommendation?.regions).length === 0) return null;
    const shownAbove = new Set(list(recommendation.registered).filter((entry) => entry.concern).map((entry) => compact(entry.core || entry.keyword)));
    const kept = excluded.filter((entry) => entry.term && !shownAbove.has(compact(entry.term)));
    if (kept.length === 0) return null;
    const single = kept.filter((entry) => entry.rule !== 'region');
    const swapped = kept.filter((entry) => entry.rule === 'region');
    const rows = single.slice(0, EXCLUDED_SHOWN).map((entry) => ({
        label: RULE_LABEL[entry.rule] || '추천 제외',
        // 한 줄로 묶인 낱말은 전부(words) 적습니다("김밥·소금김밥").
        words: entry.rule === 'rank' ? `${entry.term}(지역)`
            : entry.into && entry.rule === 'merged' ? `${entry.term} → ${entry.into}`
                : Array.isArray(entry.words) && entry.words.length > 1 ? entry.words.join('·') : entry.term,
        reason: excludedReason(entry, { regions, delivered: deliveredBy(entry) }),
    }));
    // 지역만 바꾼 조합은 한 줄로 묶고 어떤 조합인지("강남+댄디컷")를 적습니다.
    if (swapped.length) {
        const combos = swapped.flatMap((entry) => (list(entry.keywords).length ? list(entry.keywords) : [entry.term]).map((keyword) => comboLabel(keyword, entry.term)));
        rows.push({
            label: RULE_LABEL.region,
            words: `${combos.slice(0, COMBO_SHOWN).join(' · ')}${combos.length > COMBO_SHOWN ? ` 외 ${combos.length - COMBO_SHOWN}개` : ''}`,
            reason: '이미 추천했거나 등록한 같은 낱말에 지역만 바꾼 조합이라 따로 권하지 않음',
        });
    }
    // 이유가 짧은 줄을 앞에 둡니다(표가 쪽에서 갈릴 때 앞 묶음 두 줄이 작아야 앞 쪽에 들어가 쪽 아래가 덜 빕니다). 같은 길이는 추천이 준 차례 그대로.
    const ordered = rows.map((row, index) => ({ row, index })).sort((a, b) => a.row.reason.length - b.row.reason.length || a.index - b.index).map((entry) => entry.row);
    return { rows: ordered, more: Math.max(0, single.length - EXCLUDED_SHOWN) };
}

// 5칸 근거에 쓴 표기를 풀어 줍니다(실제로 문서에 나온 표기만).
const LEGEND = [
    ['myRank', () => ['내 N위', '이미 조회한 내 순위입니다.']],
    ['rival', () => ['상위 N곳 등록', '검색 상위 N곳이 대표키워드로 등록했다는 뜻입니다("사용"은 그 낱말을 쓰는 매장 수).']],
    ['booking', () => ['예약 N건', '네이버 예약으로 들어온 그 시술·메뉴의 예약 수입니다.']],
    ['review', () => ['리뷰 N회', '방문자 리뷰에서 그 시술·메뉴를 고른 횟수입니다.']],
    ['vote', () => ['고른 손님 N명', '리뷰에서 그 좋은 점을 고른 손님 수입니다.']],
    ['board', () => ['메뉴 N개·소식 N건', '메뉴판 이름·최근 소식 제목에 그 낱말이 나온 수입니다.']],
    ['blog', (text) => {
        const found = String(text).match(/(\d+)\s*\/\s*(\d+)/);
        return found ? [`블로그 ${found[1]}/${found[2]}`, `최근 블로그 후기 ${found[2]}개 중 ${found[1]}개에 그 낱말이 나온다는 뜻입니다.`] : ['블로그 n/m', '최근 블로그 후기 m개 중 n개에 그 낱말이 나온다는 뜻입니다.'];
    }],
    ['category', (text) => (/대표어/.test(String(text)) ? ['업종 대표어', '이 업종을 대표하는 흔한 말입니다.'] : ['업종', '이 가게의 업종 이름과 같은 낱말입니다.'])],
    ['registered', () => ['등록 키워드의 낱말', '지금 등록한 대표키워드에 이미 들어 있는 낱말입니다.']],
    ['spoken', () => ["후기 'A' n개·'B' m개", '블로그 후기에서 두 낱말이 각각 나온 개수입니다.']],
];

function keywordLegend(slotRows) {
    const found = new Map();
    for (const slot of slotRows) {
        // 문서에 실제로 적힌 근거(5칸 이유·근거 열에 나오는 상위 3개)의 표기만 풀이합니다(안 나온 표기를 풀이하지 않음).
        for (const part of shownParts(list(slot.evidence))) if (!found.has(part.kind)) found.set(part.kind, part.text);
    }
    return LEGEND.filter(([kind]) => found.has(kind)).map(([kind, make]) => {
        const [term, meaning] = make(found.get(kind));
        return { term, meaning };
    });
}

/* ───────── 상위 매장이 등록한 대표키워드 ───────── */

export const RIVAL_STORES_SHOWN = 6;
export const RIVAL_WORDS_SHOWN = 8;

// 순위 결과의 상위 목록(top)에서 그 매장의 가장 좋은 순위와 그때의 키워드
function rivalBestRank(placeId, doneRows) {
    let best = null;
    if (!placeId) return null;
    for (const row of doneRows) {
        for (const top of list(row.result?.top)) {
            if (String(top?.placeId) === String(placeId) && Number.isFinite(top.rank) && (!best || top.rank < best.rank)) best = { rank: top.rank, keyword: String(row.keyword).trim() };
        }
    }
    return best;
}

// 경쟁 매장 → 그 매장이 등록한 대표키워드. rivals: [{ placeId, name, keywords }](화면의 상위 매장 대표키워드 모음)
export function rivalKeywordTable({ rivals, place, doneRows, slots }) {
    const stores = list(rivals).filter((store) => store && typeof store === 'object' && String(store.name || '').trim() && list(store.keywords).length > 0);
    if (stores.length === 0) return null;
    const mine = new Set(list(place?.keywords).map(compact));
    const next = new Set(list(slots?.slots).filter((slot) => slot.action === 'replace' || slot.action === 'fill').map((slot) => compact(slot.next)));
    const rows = stores.map((store) => ({
        name: String(store.name).trim(),
        best: rivalBestRank(store.placeId, doneRows),
        words: [...new Set(list(store.keywords).map((word) => String(word).trim()).filter(Boolean))].slice(0, RIVAL_WORDS_SHOWN)
            .map((word) => ({ word, mine: mine.has(compact(word)), next: next.has(compact(word)) })),
    })).sort((a, b) => (a.best?.rank ?? Infinity) - (b.best?.rank ?? Infinity)).slice(0, RIVAL_STORES_SHOWN);
    const common = keywordFrequency(list(place?.keywords), stores).filter((entry) => entry.count >= 2)
        .slice(0, RIVAL_WORDS_SHOWN)
        .map((entry) => ({ word: entry.keyword, count: entry.count, mine: entry.mine, next: next.has(compact(entry.keyword)) }));
    return { rows, common, total: stores.length };
}

function buildKeywordSection({ place, slots, recommendation, regions, rivals, doneRows, deliveredBy }) {
    const changes = list(slots?.slots).filter((slot) => slot.action === 'replace' || slot.action === 'fill');
    const placements = keywordPlacements(place, changes.map((slot) => ({ keyword: slot.next, item: slot.item, evidence: slot.evidence })));
    const excluded = excludedPart(recommendation, { regions, deliveredBy });
    const rivalTable = rivalKeywordTable({ rivals, place, doneRows, slots });
    // 예문 표의 근거도 5칸 근거와 같은 문장(점수가 높은 순)을 씁니다.
    changes.forEach((slot, index) => {
        const basis = list(slot.evidence).filter((part) => part.points >= 6 || part.kind === 'spoken').slice(0, 2).map((part) => part.text);
        if (basis.length && placements[index]) placements[index].basis = basis;
    });
    const rows = list(slots?.slots).filter((slot) => slot.action !== 'keep');
    if (rows.length === 0 && placements.length === 0 && !excluded && !rivalTable && list(slots?.nextCandidates).length === 0) return null;
    return {
        id: 'keywords',
        title: '키워드 처방 상세',
        rows: rows.map((slot) => ({
            no: slot.no, now: slot.now, nowRank: slot.nowRank, action: ACTION_WORD[slot.action], next: slot.next, nextRank: slot.nextRank,
            problem: slot.problem || null, why: slot.why || null, basis: slot.action === 'check' ? slot.reason : slot.basis || null,
        })),
        // 5칸에 들지 못한 좋은 후보: 근거(5칸과 같은 표기)와 들지 못한 까닭. 제외표가 '묶음'으로 가리키는 낱말은 여기나 5칸에 반드시 있습니다.
        next: list(slots?.nextCandidates).length ? {
            why: slots.nextCandidates[0].why, // 모든 줄이 같은 까닭이라 제목 옆에 한 번만 적습니다
            rows: slots.nextCandidates.map((entry) => ({ keyword: entry.keyword, basis: entry.basis, short: entry.short, why: entry.why })),
        } : null,
        legend: keywordLegend([...changes, ...list(slots?.nextCandidates).map((entry) => ({ evidence: entry.evidence }))]),
        // 예문 표 제목에 쓰는 업종 낱말(음식점 '메뉴', 미용 '시술', 약국 '취급 품목·서비스')
        hint: `대표키워드만 바꾸지 말고 ${industryKind(place) === 'clinic' ? '소개글·' : '소개글·소식·'}${healthWords(place)?.item || itemWord(place)} 설명에도 같은 표현을 씁니다`,
        placements,
        unranked: slots?.unranked || [],
        rivalKeywords: rivalTable,
        notes: [
            '지역명이 들어간 대표키워드는 네이버가 수정할 수 있으니 소개글·소식에도 같은 표현을 함께 쓰세요.',
            "'맛집'·'잘하는' 같은 홍보성 표현은 대표키워드 등록이 거절될 수 있어 넣지 않았습니다.",
        ].map((note) => industryText(note, place)),
        excluded,
    };
}

/* ───────── 상세: AI 검색 준비 ───────── */

const STATUS_WORD = { no: '답 없음', partial: '일부만' };

// 리뷰를 더 받는 일에 붙이는 주의(lib/place-geo.js 리뷰 요청 안내의 "할인·서비스를 조건으로 별점·문구를 정해 주면 정책 위반입니다"와 같은 뜻)
const REVIEW_ASK_ACTIONS = new Set(['reviewsMore', 'textReview', 'reviewAsk']);
export const REVIEW_ASK_CAUTION = '"솔직한 후기 부탁드려요"만 적으세요. 리뷰를 조건으로 할인·서비스를 주거나 별점·문구를 정해 주면 정책 위반입니다.';

// 질문 한 줄을 인쇄본에서 앞뒤가 맞게 고칩니다(AI 검색 진단(lib/place-geo.js)의 문장은 업종·자료와 상관없이 같은 틀이라서).
//  - 가격대: 메뉴 가격이 모두 등록돼 있는데 '일부만'으로 나오면 무엇이 빠졌는지(소개글·소식에 가격대가 없음)를 적습니다.
//  - 위치: 가까운 역 자료가 없는 매장에는 '역·출구·도보 시간' 대신 정류장·건물 입구·주차 위치를 적게 합니다.
//  - 약국: '메뉴판·가격표' 대신 취급 품목·서비스를 소개글·소식에 같은 표현으로 적게 합니다.
function adjustQuestion(entry, { place, introInDoc }) {
    const out = {
        key: entry.key,
        question: industryText(entry.question, place),
        status: STATUS_WORD[entry.status],
        now: entry.answer ? industryText(entry.answer, place) : null,
        fix: industryText(entry.fix, place),
    };
    // (위치 질문의 역 문구·약국의 대표 메뉴/가격 문구는 AI 검색 진단(place-geo.js)이 업종·자료에 맞게 이미 적어 줍니다. 여기서 덮어쓰지 않습니다.)
    // 약국: 네이버 예약이 되는지 확인되지 않았으므로 예약 대신 문의 수단(전화·톡톡)만 적게 합니다.
    if (entry.key === 'booking' && industryKind(place) === 'pharmacy') {
        out.fix = `전화번호 같은 문의 수단을 소개글에 적으세요. 네이버 톡톡을 연결할 수 있으면 연결하세요(${SP_UNSURE_INDUSTRY})`;
    }
    if (entry.key === 'price') {
        const menuCount = place?.menuCount || 0;
        const allPriced = menuCount > 0 && place.menuPricedCount >= menuCount;
        const range = priceRange(place);
        if (allPriced) {
            // '일부만'이 "모두 등록돼 있습니다" 옆에 붙으면 어색하므로, 빠진 것(소개글·소식의 가격대)을 꼬리표로 적습니다.
            out.status = '소개글에 없음';
            out.now = `${itemWord(place)} ${formatNumber(menuCount)}개 모두 가격이 등록돼 있습니다. 소개글·소식에는 가격대가 없습니다.`;
            out.fix = range
                ? `대표 ${itemWord(place)} 가격대(${range.text})를 소개글에도 적으세요${introInDoc ? '(소개글 초안에 넣어 두었습니다)' : ''}.`
                : `대표 ${itemWord(place)} 가격대를 소개글에도 적으세요.`;
        }
    }
    return out;
}

// 하루 안에 해 볼 수 있는 일(네이버)의 방법을 인쇄본에 그대로 적습니다(화면의 'AI 검색'을 보지 않아도 되게).
function quickHow(id, { question, name, item, place }) {
    if (!question) return null;
    // 약국·병원은 '추천' 대신 위치·영업시간으로 묻는 말을 씁니다.
    const medical = familyOf(place)?.key === 'pharmacy' || familyOf(place)?.key === 'clinic';
    const ask = medical ? `${String(question).replace(/\s*추천$/, '')} 위치·영업시간` : question;
    const what = medical ? item : `대표 ${item}`;
    if (id === 'naver-feed') {
        return `소식 제목에 "${ask}"처럼 손님이 묻는 말을 넣고, 본문 첫 문단에 위치·영업시간·${what}${josa(what, '을', '를').slice(what.length)} 적습니다. 가격·영업시간은 오늘 기준으로 확인하세요.`;
    }
    if (id === 'naver-cafe') {
        return `네이버에서 "${ask}"${josa(ask, '을', '를').slice(ask.length)} 검색해 카페 상위 질문글을 찾고 업체 답글이 되는지 카페 규칙을 확인합니다. "${name} 사장입니다"라고 밝히고 위치·영업시간 같은 사실만 답글 1개로 답니다. 손님인 척 추천하는 댓글은 쓰지 않습니다.`;
    }
    return null;
}

function buildAi({ place, activity, geo, tasks, nowMs, recommendation }) {
    if (!geo) return null;
    const scores = [
        { key: 'geo', label: 'GEO · 추천 목록에 들 준비', score: geo.geo?.score, grade: geo.geo?.label },
        { key: 'aeo', label: 'AEO · 질문에 바로 답할 준비', score: geo.aeo?.score, grade: geo.aeo?.label },
    ].filter((entry) => known(entry.score));
    if (scores.length === 0) return null;
    const taskKeys = new Set(tasks.map((task) => task.key));
    const introInDoc = taskKeys.has('description') || taskKeys.has('intro');
    const questions = list(geo.fanout)
        .filter((entry) => entry.status === 'no' || entry.status === 'partial')
        .map((entry) => adjustQuestion(entry, { place, introInDoc }));
    // 약국: 맞는 품목·서비스 후보가 없어 '취급 품목·서비스 등록' 처방을 뺐으면 같은 일이 "점수가 오르는 일"로 다시 나오지 않게 합니다.
    const noOfferings = familyOf(place)?.key === 'pharmacy' && pharmacyOfferings(place, recommendation).length === 0;
    const more = list(geo.actions)
        .filter((action) => !action.manual && gainOf(action) > 0 && !taskKeys.has(AI_TASK[action.id]) && !(action.id === 'intro' && (taskKeys.has('description') || taskKeys.has('intro'))))
        .filter((action) => !(noOfferings && action.id === 'menuAdd'))
        .slice(0, AI_ITEMS_SHOWN)
        .map((action) => ({
            id: action.id, title: industryText(action.title, place), now: action.now || null, target: action.target || null,
            timeLabel: minutesLabel(EXTRA_MINUTES[action.id] ?? EXTRA_MINUTES_DEFAULT),
            caution: REVIEW_ASK_ACTIONS.has(action.id) ? REVIEW_ASK_CAUTION : null,
            // 홈페이지·SNS 주소 넣기: 위치(정보 수정 > 부가정보)만 공식 확인. 칸·버튼 이름은 적지 않습니다.
            how: action.id === 'links' ? "'정보 수정' 버튼 → '부가정보'로 들어가 홈페이지(또는 SNS) 주소를 넣고 저장합니다. 열리지 않는 주소는 등록되지 않습니다(반영 2시간~1일)." : null,
        }));
    const name = String(place.name || '').trim() || '우리 매장';
    const item = healthWords(place)?.item || itemWord(place);
    const quick = buildQuickStrategies(place, activity, { atomic: geo.atomic, fanout: geo.fanout, nowMs })
        .filter((strategy) => strategy.platform === 'naver' && !strategy.needs)
        .filter((strategy) => !(industryKind(place) === 'clinic' && strategy.id === 'naver-feed')) // 병·의원은 새소식 기능이 없음
        .slice(0, QUICK_SHOWN)
        .map((strategy) => ({
            id: strategy.id, title: strategy.title, timeLabel: minutesLabel(strategy.effortMinutes),
            how: industryText(quickHow(strategy.id, { question: geo.question || null, name, item, place }), place),
        }));
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

/* ───────── 상세: 4주 실행표 ─────────
 * 1주차는 이번 주 할 일. 2~4주차는 남은 처방 → AI 검색 점검 점수가 오르는 일 → 하루 안에 해 볼 수 있는 일 순서로 담습니다(자료에 있는 일만).
 * 6개(주당 2개)를 넘으면 앞에서부터 담고 나머지 수만 적습니다. 모자라면(5개 미만) 2·3·4주차에 하나씩 돌려 가며 담아 비는 주가 없게 합니다.
 */
// 4주 뒤에 다시 조회할 키워드: 1쪽 ③ 최종 5칸의 키워드(유지·교체·채움 모두). 지금 순위를 모르는 칸은 null → 문서에 "___위"로 비워 둡니다.
// 5칸 최종안이 없으면(추천 자료 없음) 순위를 조회한 키워드를 씁니다.
export function recheckKeywords({ slots, rankTable }) {
    const rows = list(slots?.slots).map((slot) => ({ keyword: slot.next, now: slot.nextRank || null }));
    if (rows.length) return rows;
    return list(rankTable).filter((row) => row && row.keyword).map((row) => ({ keyword: String(row.keyword).trim(), now: isDone(row) ? rankLabel(row.result) : null }));
}

function buildPlan({ week, tasks, activity, rankOf, recheckRows = [], recheckLabel, metricsCount, extras = [] }) {
    const weekKeys = new Set(week.map((task) => task.key));
    const rest = tasks.filter((task) => !weekKeys.has(task.key)).map((task) => ({ title: task.title, timeLabel: task.timeLabel }));
    const pool = [...rest, ...extras];
    if (tasks.length === 0 && !activity && rankOf.size === 0 && pool.length === 0) return null;
    const lanes = [[], [], []];
    pool.slice(0, 6).forEach((entry, index) => lanes[pool.length >= 5 ? Math.floor(index / 2) : index % 3].push(entry));
    const weeks = [
        { no: 1, items: week.map((task) => ({ title: task.title, timeLabel: task.timeLabel })) },
        { no: 2, items: lanes[0] },
        { no: 3, items: lanes[1] },
        {
            no: 4,
            items: [
                ...lanes[2],
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
        more: Math.max(0, pool.length - 6),
        // 주당 2개씩 담고 남은 일(말없이 빼지 않고 "그 밖의 일"로 적음)
        overflow: pool.slice(6).map((entry) => ({ title: entry.title, timeLabel: entry.timeLabel })),
        recheck: {
            label: recheckLabel, metrics: metricsCount, keywords: recheckRows,
            // 대표키워드를 바꾸면 네이버 검토(영업일 최대 5일)를 거쳐 반영되므로, 반영된 뒤의 순위로 견주게 합니다.
            note: `대표키워드를 바꿨다면 네이버 검토(영업일 최대 5일)를 거쳐 반영됩니다. 반영된 뒤의 순위로 비교하세요.`,
        },
    };
}

/* ───────── 1쪽을 한 쪽 안에 ─────────
 * 1쪽(처방 요약)은 자료 단계에서 한 쪽에 들어가게 맞춥니다(화면에서 말줄임(…)으로 자르지 않음).
 *  1) 칸마다 글자 수 상한: 덧붙임 조각(' · '로 이은 근거, 키워드 이름 목록)을 통째로 빼서 맞춥니다. 문장 가운데를 자르지 않습니다.
 *     이번 주 할 일의 이유가 길면 짧은 문제 이름(예: '리뷰 답글률 40%')으로 바꿉니다.
 *  2) 줄 수로 1쪽 높이를 어림해(PAGE1_BUDGET_MM) 넘치면 덜 중요한 것부터 뺍니다:
 *     다시 볼 숫자 5번째 줄 → 5칸 아래 안내 → 'AI 검색 점검' 표시 풀이 → 다시 볼 숫자의 메모 → 진단 덧붙임 줄(아래부터) → 다시 볼 숫자 4번째 줄.
 * 어림 값은 견본 3종과 긴 견본(tests/place-prescription.fixtures.mjs 의 LONG)의 실제 인쇄 높이에 맞춘 넉넉한 값입니다.
 */
export const PAGE1_BUDGET_MM = 267; // A4 297mm − 위아래 여백 26mm = 271mm, 어림 오차(실제 인쇄와 ±3mm)를 감안해 4mm 남김
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
        if (summary.week.aiNote) parts.week += 1.2 + lines(summary.week.aiNote, 78) * 4.9;
    }
    if (summary.slots) {
        parts.slots = block + 6.8;
        for (const row of summary.slots.rows) {
            const now = `${row.now || '빈 칸'} ${row.nowRank || ''}`;
            const next = row.action === 'keep' || row.action === 'check' ? '그대로' : `${row.next} ${row.nextRank || '순위 미조회'}`;
            parts.slots += 3.2 + Math.max(lines(now, 17), lines(next, 17), lines(row.reason, 27), 1) * 4.3;
        }
        if (summary.slots.empty > 0) parts.slots += 7.8;
        if (summary.slots.unranked.length) parts.slots += 1.4 + lines(unrankedSentence(summary.slots.unranked, summary.slots.see, summary.slots.hasNext), 78) * 4.9;
        if (summary.slots.legend?.length) parts.slots += 1.4 + lines(`읽는 법 ${summary.slots.legend.join(' · ')}`, 84) * 4.5;
    }
    if (summary.metrics) {
        parts.metrics = block + 6.8;
        for (const metric of summary.metrics) {
            // wideNote: 메모를 아래 줄에 표 전체 너비로 둠(키워드 이름을 줄이지 않고 전부 적는 줄)
            const noteLines = metric.wideNote ? 0 : lines(metric.note, 30);
            parts.metrics += 3.2 + Math.max(lines(metric.now, 24) + noteLines, lines(metric.compare, 26), lines(metric.label, 12), 1) * 4.6;
            if (metric.wideNote && metric.note) parts.metrics += 1.6 + lines(metric.note, 92) * 4.4;
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
            note: metric.note && !metric.wideNote && metric.note.length > CAP.metricNote ? capNamedList(metric.note, CAP.metricNote) : metric.note,
            compare: metric.compare && metric.compare.length > CAP.metricCompare && metric.compareShort ? metric.compareShort : metric.compare,
        })) : null,
    };
    // 1쪽 ③ 이유 칸에 남은 약어("블로그 25/52" 등)의 풀이 — 1쪽만 떼어 줘도 읽히게(뜻이 같은 풀이는 C 의 '읽는 법'에도 있음)
    if (out.slots) out.slots = { ...out.slots, legend: pageOneLegend(out.slots.rows) };
    const steps = [
        () => (out.metrics?.length > 4 ? ((out.metrics = out.metrics.slice(0, 4)), true) : false),
        () => (out.metrics?.some((metric) => metric.note && !metric.wideNote) ? ((out.metrics = out.metrics.map((metric) => (metric.wideNote ? metric : { ...metric, note: null }))), true) : false),
        ...[...out.diagnoses.keys()].reverse().map((index) => () => {
            if (!out.diagnoses[index].basis) return false;
            out.diagnoses = out.diagnoses.map((diag, i) => (i === index ? { ...diag, basis: null } : diag));
            return true;
        }),
        // 'AI 검색 점검' 표시 풀이 한 줄(표시 자체는 남음)
        () => (out.week?.aiNote ? ((out.week = { ...out.week, aiNote: null }), true) : false),
        () => (out.slots?.unranked.length ? ((out.slots = { ...out.slots, unranked: [], unrankedText: '' }), true) : false),
        () => (out.metrics?.length > METRICS_MIN ? ((out.metrics = out.metrics.slice(0, METRICS_MIN)), true) : false),
        // 마지막 수단: 이유 칸 약어 풀이(같은 풀이는 C 의 '읽는 법'에 있음)
        () => (out.slots?.legend?.length ? ((out.slots = { ...out.slots, legend: [] }), true) : false),
    ];
    for (const step of steps) {
        if (estimatePage1Mm(doc, out) <= PAGE1_BUDGET_MM) break;
        step();
    }
    out.metrics = out.metrics ? out.metrics.map(({ compareShort, ...metric }) => metric) : null;
    return out;
}

// "'A', 'B'는 아직 순위를 조회하지 않았습니다. 바꾸기 전에 혼잘마에서 순위를 먼저 확인하세요. 근거는 C." (조사는 마지막 키워드에 맞춤)
export function unrankedSentence(keywords, see = null, hasNext = false) {
    const names = list(keywords).map((keyword) => String(keyword));
    if (names.length === 0) return '';
    const last = names[names.length - 1];
    const next = see && hasNext ? ` 30위 밖이면 ${see}의 '다음 후보'로 바꾸세요.` : '';
    return `${names.map((keyword) => `'${keyword}'`).join(', ')}${josa(last, '은', '는').slice(last.length)} 아직 순위를 조회하지 않았습니다. 바꾸기 전에 혼잘마에서 순위를 먼저 확인하세요.${next}${see ? ` 근거는 ${see}.` : ''}`;
}

// 1쪽 5칸 이유에 남은 약어의 풀이(문서에 실제로 나온 것만). 예: "블로그 25/52 = 최근 블로그 후기 52개 중 25개에 그 낱말이 나옴"
const PAGE1_LEGEND = [
    [/블로그 (\d+)\/(\d+)/, (match) => `블로그 ${match[1]}/${match[2]} = 최근 블로그 후기 ${match[2]}개 중 ${match[1]}개에 그 낱말이 나옴`],
    [/상위 \d+곳 사용/, () => '상위 N곳 사용 = 검색 상위 매장 N곳이 그 낱말을 씀'],
    [/상위 \d+곳 등록/, () => '상위 N곳 등록 = 검색 상위 매장 N곳이 그 키워드로 등록'],
    [/고른 손님 [\d,]+명/, () => '고른 손님 N명 = 리뷰에서 그 좋은 점을 고른 손님 수'],
    [/메뉴 \d+개|소식 \d+건/, () => '메뉴 N개·소식 N건 = 메뉴판 이름·최근 소식 제목에 나온 수'],
    [/예약 [\d,]+건/, () => '예약 N건 = 네이버 예약으로 들어온 수'],
    [/리뷰 [\d,]+회/, () => '리뷰 N회 = 방문자 리뷰에서 그 메뉴·시술을 고른 횟수'],
    [/후기 '[^']+' \d+개/, () => "후기 'A' n개·'B' m개 = 블로그 후기에서 두 낱말이 각각 나온 개수"],
    [/등록 키워드의 낱말/, () => '등록 키워드의 낱말 = 지금 등록한 대표키워드에 이미 든 낱말'],
    [/업종 대표어/, () => '업종 대표어 = 이 업종을 대표하는 흔한 말'],
    [/(?:^|[ ·])업종(?!\s*대표어)(?=\s*(?:·|$))/, () => '업종 = 이 가게의 업종 이름과 같은 낱말'],
];

export function pageOneLegend(rows) {
    const reasons = list(rows).filter((row) => row.action !== 'keep' && row.action !== 'check').map((row) => String(row.reason || ''));
    const out = [];
    for (const [pattern, make] of PAGE1_LEGEND) {
        const found = reasons.map((reason) => reason.match(pattern)).find(Boolean);
        if (found) out.push(make(found));
    }
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
//   rivals            상위 매장이 등록한 대표키워드 [{ placeId, name, keywords }](화면의 rivalPool). 없으면 C 의 그 표만 뺌
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
export function sanitizeInput({ place, activity = null, ranks = [], recommendation = null, actions = [], geo = null, rivals = [], ...rest }) {
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
        rivals: objects(rivals).map((store) => ({ ...store, keywords: Array.isArray(store.keywords) ? store.keywords.filter((word) => typeof word === 'string') : [] })),
    };
}

// 병·의원: 소식 쓰기·쿠폰 만들기 처방, '소식 N일째 없음' 진단·지표, 쿠폰 질문·AI 점검 일, 새소식 하루 일을 문서에서 뺍니다.
// (점수·화면의 권고 자체는 place-geo.js·naver-place.js 가 정합니다 — 여기서는 인쇄본에만 반영)
// 약국: 쿠폰·할인 혜택을 권하지 않고(약사법 시행규칙상 경품·할인으로 손님을 끄는 일 제한), 네이버 예약도 약국에서 되는지 확인되지 않아 예약 처방을 내지 않습니다.
// 업종 제외는 이 표 한 곳에서만 정합니다(약국 / 병·의원 / 그 밖).
export function skippedTasks(place) {
    const na = notApplicableOf(place);
    return ['feed', 'coupon', 'booking'].filter((key) => na[key]);
}

function withoutIndustryExtras(place, { activity, actions, geo, recommendation }) {
    const na = notApplicableOf(place);
    const skip = new Set(skippedTasks(place));
    return {
        activity: activity ? { ...activity, feeds: na.feed ? null : activity.feeds, coupons: na.coupon ? null : activity.coupons } : activity,
        actions: list(actions).filter((action) => !skip.has(action.key)),
        geo: geo ? {
            ...geo,
            actions: list(geo.actions).filter((action) => !skip.has(action.id)),
        } : geo,
        recommendation: recommendation && na.feed ? {
            ...recommendation,
            excluded: list(recommendation.excluded).map((entry) => (Array.isArray(entry.useIn) ? { ...entry, useIn: entry.useIn.filter((place) => !/소식/.test(place)) } : entry)),
        } : recommendation,
    };
}

function buildFromClean({
    place, activity: activityIn = null, ranks = [], recommendation: recommendationIn = null, actions: actionsIn = [], geo: geoIn = null, rivals = [], fetchedAt = null, nowMs = Date.now(), fitPage1 = true,
}) {
    const { activity, actions, geo, recommendation } = skippedTasks(place).length
        ? withoutIndustryExtras(place, { activity: activityIn, actions: actionsIn, geo: geoIn, recommendation: recommendationIn })
        : { activity: activityIn, actions: actionsIn, geo: geoIn, recommendation: recommendationIn };
    const todo = list(actions);
    const doneRows = list(ranks).filter(isDone);
    const rankOf = new Map(doneRows.map((row) => [compact(row.keyword), row]));
    const lookedUpMs = Number.isFinite(fetchedAt) ? fetchedAt : nowMs;
    const recheckMs = lookedUpMs + RECHECK_DAYS * DAY_MS;
    const recheckLabel = dayLabel(recheckMs);
    // 약국·병원 계열은 '메뉴·서비스' 대신 AI 검색 진단(place-geo.js)과 같은 말(취급 품목·서비스 / 진료 과목·서비스)을 씁니다.
    const item = healthWords(place)?.item || itemWord(place);

    const regions = rankRegions({ doneRows, recommendation, place });
    const weakList = weakRegions(regions);
    const weak = weakList.map((region) => region.region);
    // 가장 큰 격차는 남겨 둘 지역의 키워드에서 찾습니다(빼기로 한 지역의 격차는 표에만 둠).
    const weakKeywords = new Set(weakList.flatMap((region) => region.rows.map((row) => compact(row.keyword))));
    const comparisonRaw = rivalComparison({ place, doneRows });
    const kept = comparisonRaw.rows.filter((row) => !weakKeywords.has(compact(row.keyword)));
    const comparison = { ...comparisonRaw, gapRows: kept.length ? kept : comparisonRaw.rows, recommendation };
    const slots = slotProposal({ place, recommendation, rankOf });
    // 5칸에 새로 넣는 낱말: 소식·메뉴 설명 초안도 같은 낱말을 쓰게 합니다.
    const focus = list(slots?.slots).filter((slot) => (slot.action === 'replace' || slot.action === 'fill') && slot.item?.term)
        .map((slot) => ({ keyword: slot.next, term: slot.item.term, region: slot.item.region || null, kinds: list(slot.evidence).map((part) => part.kind) }));
    const pool = poolComparison({ place, doneRows });
    // 화면 '키워드 순위'와 같은 모수: 순위 표의 모든 줄(조회 중·실패 포함)
    const rankTable = list(ranks).filter((row) => row && row.keyword);
    const diagnoses = pickDiagnoses(diagnosisCandidates({ place, activity, recommendation, rankOf, regions, comparison, geo, item, nowMs }));
    const tasks = buildTasks({ place, activity, actions: todo, geo, slots, diagnoses, item, recommendation });
    const week = tasks.filter((task) => task.weekOk).slice(0, WEEK_MAX);
    const metrics = pickMetrics({ place, activity, rankOf, rankTable, comparison, pool, geo, diagnoses, week, item, nowMs });

    // 키워드로는 뺐지만 메뉴 설명·소식에 쓸 낱말(추천이 useIn 으로 알려 준 것)
    const alsoWords = [...new Set(list(recommendation?.excluded)
        .filter((entry) => (entry.rule === 'otherBusiness' || entry.rule === 'offMain') && Array.isArray(entry.useIn) && entry.useIn.length)
        .flatMap((entry) => list(entry.words).length ? list(entry.words) : [entry.term]))];
    const ctx = { place, activity, geo, nowMs: lookedUpMs, recommendation, focus, also: alsoWords };
    const taskSection = buildTaskSection(tasks, ctx);
    // 그 낱말을 실제로 넣은 초안(메뉴 설명 틀의 이름 · 소식 초안의 본문)
    const draftOf = (key) => list(taskSection?.items).find((task) => task.key === key)?.draft || null;
    const frameNames = list(draftOf('menuDesc')?.rows).map((row) => compact(row.name));
    const feedText = compact(list(draftOf('feed')?.items).map((entry) => `${entry.title} ${entry.body}`).join(' '));
    const deliveredBy = (entry) => {
        const words = (list(entry.words).length ? list(entry.words) : [entry.term]).map(compact).filter((word) => word.length >= 2);
        return [
            frameNames.some((name) => words.some((word) => name.includes(word))) ? '메뉴 설명' : null,
            words.some((word) => feedText.includes(word)) ? '소식' : null,
        ].filter(Boolean);
    };
    const ai = buildAi({ place, activity, geo, tasks, nowMs: lookedUpMs, recommendation });
    // 4주 실행표의 2~4주차에 담을 자료 속의 일(AI 검색 점검 점수가 오르는 일·하루 안에 해 볼 수 있는 일)
    // (소식 처방이 이미 있으면 '새소식 올리기'는 같은 일이라 싣지 않습니다.)
    const hasFeedTask = tasks.some((task) => task.key === 'feed');
    const extras = [
        ...list(ai?.more).map((entry) => ({ title: entry.title, timeLabel: entry.timeLabel })),
        ...list(ai?.quick).filter((entry) => !(hasFeedTask && entry.id === 'naver-feed')).map((entry) => ({ title: entry.title, timeLabel: entry.timeLabel })),
    ];
    const recheckRows = recheckKeywords({ slots, rankTable });
    const sections = [
        buildRivals({ comparison, pool }),
        taskSection,
        buildKeywordSection({ place, slots, recommendation, regions, rivals, doneRows, deliveredBy }),
        ai,
        buildPlan({ week, tasks, activity, rankOf, recheckRows, recheckLabel, metricsCount: metrics.length, extras }),
    ].filter(Boolean).map((section, index) => ({ letter: String.fromCharCode(65 + index), ...section }));
    const letterOf = Object.fromEntries(sections.map((section) => [section.id, section.letter]));

    const lookedUp = dateTimeLabel(lookedUpMs);
    const notes = [`네이버 플레이스 화면에 공개된 정보를 ${lookedUp}에 조회한 결과이며, 네이버 공식 제휴 데이터가 아닙니다.`];
    if (doneRows.length > 0) notes.push('순위는 조회한 시각의 네이버 플레이스 검색 결과에서 광고를 빼고 센 순서이며, 검색 위치·시간에 따라 달라질 수 있습니다.');
    if (letterOf.rivals) notes.push('경쟁 매장의 리뷰 수·평점은 같은 검색 결과 목록에 나온 값이며, 중간값은 그 목록 안의 매장만으로 계산했습니다.');
    const replyShown = metrics.some((metric) => metric.key === 'reply') || diagnoses.some((diag) => diag.key === 'reply') || tasks.some((task) => task.key === 'reply');
    if (replyShown && activity?.visitor && known(activity.visitor.replyRate)) notes.push(`사장님 답글률은 최근 방문자 리뷰 ${formatNumber(activity.visitor.sampled)}개를 기준으로 센 값입니다.`);
    if (letterOf.ai) notes.push('GEO·AEO 점수는 공개된 매장 정보로 계산한 준비 정도이며, AI 답변 노출을 보장하지 않습니다.');
    if (!letterOf.plan) notes.push('걸리는 시간은 일의 종류로 정한 대략값입니다.');
    notes.push('초안 문안은 매장 정보로 자동으로 만든 것입니다. 사실과 다르면 고쳐 쓰세요.');

    const weekItems = week.map((task, index) => ({
        no: index + 1, key: task.key, title: task.title, timeLabel: task.timeLabel, minutes: task.minutes, where: task.where,
        why: task.why[0] ? sentencesOf(task.why[0])[0] : task.problem,
        problem: task.problem,
        source: task.source, sourceLabel: task.source === 'ai' ? AI_SOURCE_LABEL : null,
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
            week: weekItems.length ? { items: weekItems, totalLabel: minutesLabel(totalMinutes), aiNote: weekItems.some((task) => task.source === 'ai') ? AI_SOURCE_NOTE : null } : null,
            slots: slots && slots.slots.length ? {
                rows: slots.slots.map((slot) => ({
                    no: slot.no, now: slot.now, nowRank: slot.nowRank, action: slot.action, actionLabel: ACTION_WORD[slot.action],
                    next: slot.next, nextRank: slot.nextRank, reason: slot.reason,
                })),
                changes: slots.changes,
                empty: slots.empty,
                emptyText: slots.empty > 0 ? emptyReasonText(recommendation) : null,
                unranked: slots.unranked,
                hasNext: list(slots.nextCandidates).length > 0,
                unrankedText: unrankedSentence(slots.unranked, letterOf.keywords || null, list(slots.nextCandidates).length > 0),
                see: letterOf.keywords || null,
                legend: pageOneLegend(slots.slots),
            } : null,
            metrics: metrics.length ? metrics : null,
        }),
        sections,
        notes,
    };
}
