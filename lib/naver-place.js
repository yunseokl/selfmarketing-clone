// 네이버 플레이스 공개 정보 조회 (읽기 전용).
//
// 네이버 플레이스 모바일 화면이 스스로 불러오는 것과 같은 공개 데이터를 읽습니다.
//   - 매장 화면에 실려 오는 기본 정보·리뷰 집계·영업시간·POS 결제 집계·운영 도구(extractSnapshot/extractDetail)
//   - 화면에는 안 보이지만 응답에 들어 있는 대표키워드
//   - 리뷰·소식 탭이 불러오는 최근 리뷰 날짜·답글 여부, 블로그 리뷰 날짜, 소식, 쿠폰, AI 브리핑(getActivity)
//   - 검색 목록의 매장 순서(= 순위)와 목록 항목의 리뷰·저장 수
// 쿼리 이름·입력 형식은 매장 화면 JS(g-place.pstatic.net)에 들어 있는 원문과 같게 맞췄습니다.
// 인트로스펙션(__schema)은 막혀 있고, 없는 필드를 요청하면 400(GRAPHQL_VALIDATION_FAILED)이 옵니다.
// 로그인·쿠키를 쓰지 않고, 방문·클릭·저장 같은 행동을 만들지 않습니다.
// 리뷰 원문, 작성자, 전화번호는 읽어도 버리고 돌려주지 않습니다.
//
// 주의: 네이버가 공식으로 제공하는 API가 아닙니다. 네이버가 응답 형식을 바꾸거나 조회를
// 막으면 동작하지 않을 수 있고, 그때는 lib/place-gate.js 의 장치가 조회를 멈춥니다.
//
// 2026-11-15 확인한 사실
//   - 정렬·업종을 지정하지 않은 목록 순서가 실제 화면(m.place.naver.com 목록)과 같습니다.
//     (음식점·미용실·필라테스 검색어로 대조. sortingOrder=popular 는 화면과 순서가 달랐습니다.)
//   - 목록은 100개씩 10쪽, 1,000위까지만 내려옵니다. total 값보다 일찍 끝나는 목록도 있습니다
//     (예: total 488 인데 300번째에서 끝남). 그래서 목록 끝은 "빈 쪽"으로만 알 수 있습니다.
//   - 브라우저가 아닌 요청은 429 로 거절됩니다.
//   - 0.4초 간격으로 여섯 번째 요청을 보냈을 때, 데이터가 있는 쪽인데도 빈 응답(200, 0건)이 한 번 왔습니다.
//     원인은 확인하지 못했습니다(짧은 시간 요청이 몰린 탓으로 추정). 그래서 빈 쪽은 한 번 더 확인하고,
//     네이버가 계속 빈 응답만 주면 결과를 내지 않고 조회를 멈춥니다(getRank 참고).
//
// 2026-11-16 확인한 사실 (실제 약국·음식점 매장으로 1건씩 대조)
//   - 지역명이 없는 키워드("일반의약품")의 목록은 서울 시청 근처 매장부터 나옵니다(검색 위치를 안 보내면 서울 중심 기준).
//     그래서 지방 매장은 지역명 없는 키워드 순위가 의미가 없습니다. rankLocality 가 상위 매장과의 거리로 이를 가려냅니다.
//   - 목록 응답의 nlu.queryResult.region 은 "청주약국" → "청주" 처럼 네이버가 인식한 행정 지역입니다.
//     "강남역미용실" 처럼 역 이름이 붙은 키워드는 결과가 그 지역으로 나와도 region 이 null 이었습니다.
//   - fsasReviews 입력의 query 에 낱말을 넣으면 그 낱말이 들어간 블로그 리뷰 수(total)만 받을 수 있습니다
//     (약국: 전체 11개 중 "대형약국" 10개·"영양제" 4개·"건강기능식품" 0개).
//   - 묶음 요청에서 쿼리 하나라도 형식 검증에 걸리면 HTTP 400 이 오지만, 본문에는 나머지 쿼리 결과가 그대로 들어 있습니다.

import { PlaceLookupError } from './place-gate.js';
import { notApplicableOf, healthKind } from './place-industry.js';

export const GRAPHQL_URL = 'https://api.place.naver.com/api/graphql';
export const PAGE_SIZE = 100;
export const MAX_RANK = 1000;
export const DEFAULT_DEPTH = 300;
export const TOP_COUNT = 10;

export const CACHE_TTL = {
    place: 30 * 60 * 1000,
    activity: 30 * 60 * 1000,
    keywords: 6 * 60 * 60 * 1000,
    list: 10 * 60 * 1000,
    shortUrl: 24 * 60 * 60 * 1000,
};

// placeList 에 쓸 수 있는 정렬 옵션. 지정하지 않으면 실제 화면 순서(기본 정렬)와 같습니다.
// 2026-11-15 탐색으로 확인한 전체 목록:
//   popular — 인기순 (기본과 순서가 다를 수 있음)
//   saved — 저장 많은 순
//   reviewCount — 방문자 리뷰 많은 순
//   reviewTotalCount — 블로그+방문자 리뷰 합계순
//   revisit — 재방문 많은 순
//   trendy — 최근 인기순
//   precision — 정확도순
//   distance — 거리순 (좌표 필요)
export const SORT_OPTIONS = ['popular', 'saved', 'reviewCount', 'reviewTotalCount', 'revisit', 'trendy', 'precision', 'distance'];

// 네이버 플레이스는 브라우저 형식이 아닌 요청을 받지 않아, 흔한 모바일 브라우저 형식 한 가지로 고정해 보냅니다.
// 요청마다 기기 정보를 바꾸는 식의 위장은 하지 않습니다.
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const REQUEST_TIMEOUT_MS = 10000;
// 빈 쪽을 받았을 때 다시 확인하기 전에 쉬는 시간
const CONFIRM_DELAY_MS = 2000;
const MAX_HTML_LENGTH = 5 * 1000 * 1000;

const PLACE_HOSTS = [
    'map.naver.com', 'm.map.naver.com', 'app.map.naver.com',
    'place.naver.com', 'm.place.naver.com', 'pcmap.place.naver.com', 'store.naver.com',
];
const PLACE_PATH_WORDS = ['place', 'restaurant', 'hairshop', 'nailshop', 'hospital', 'accommodation'];
const ID_ONLY = /^\d{5,12}$/;

// 목록(순위) 조회 기본 쿼리. 실제 화면과 순서가 같도록 정렬·업종을 지정하지 않습니다.
// 2페이지 이후(101위~)는 순위 매칭만 하면 되므로 이 최소 필드 그대로 씁니다.
const LIST_QUERY = `query getPlaceList($input: PlaceListInput) {
  result: placeList(input: $input) {
    businesses {
      total
      items { id name category saveCount visitorReviewCount visitorReviewScore blogCafeReviewCount newOpening }
    }
  }
}`;

// 1페이지(상위 100곳)에만 쓰는 확장 쿼리. 검색 목록 응답에 이미 들어오지만 평소엔 읽지 않던
// 공개 신호(사진 수·예약/주문·쿠폰·멤버십·페이 혜택·영업상태)를 추가로 받아 "순위 진단"에 씁니다.
//   - 리뷰 원문·작성자·사진 URL 같은 개인정보 필드(visitorReviews·visitorImages)는 일부러 요청하지 않습니다.
//   - 모든 목록 항목은 단일 타입(PlaceListBusinessesItem)이라 업종이 달라도 필드셋은 같고, 해당 없으면 null 로 옵니다.
//   - 네이버가 이 필드셋을 거절(400)하면 createPlaceClient 가 그 세션 동안 기본 쿼리로 자동 강등합니다(라이브 미검증 대비 안전장치).
//   - nlu(네이버가 키워드에서 인식한 지역)와 좌표(x·y)·행정구역(commonAddress)은 2026-11-16 실제 응답으로 확인했습니다.
//     좌표는 "상위 매장이 내 매장에서 얼마나 떨어져 있는지"(rankLocality)에만 씁니다.
export const LIST_QUERY_RICH = `query getPlaceList($input: PlaceListInput) {
  result: placeList(input: $input) {
    businesses {
      total
      siteSort
      nlu { queryResult { region spot } }
      items {
        id name category saveCount visitorReviewCount visitorReviewScore blogCafeReviewCount newOpening
        imageCount bookingReviewCount promotionTitle naverBookingCategory hasBooking hasNPay
        options bookingUrl businessCategory microReview description
        x y commonAddress
        newBusinessHours { status }
        coupon { total }
        naverOrder { isDelivery isTableOrder isPreOrder isPickup }
        posInfo { isPOS }
        nPayConnect { benefitText }
        membershipBenefit { benefitName }
      }
    }
  }
}`;

const KEYWORD_QUERY = `query getPlaceDetail($id: String!) {
  business: placeDetail(input: { id: $id, isNx: false, deviceType: "mobile" }) {
    base { id name }
    informationTab { keywordList }
  }
}`;

// 매장 활동 묶음 조회 — 네이버 매장 화면이 리뷰·소식 탭에서 보내는 쿼리와 같은 이름·입력을 씁니다.
// 화면처럼 배열 한 건으로 묶어 보내 요청 수를 1건으로 줄입니다(2026-11-15 묶음 요청 200 확인).
// 리뷰 본문·작성자·사진 같은 개인정보 필드는 요청하지 않고, 날짜·답글 여부·재방문 횟수만 받습니다.
// businessType 은 업종과 관계없이 'place' 로 보내도 음식점·미용실 모두 정상 응답했습니다.
export const ACTIVITY_REVIEW_SAMPLE = 50;
export const ACTIVITY_BLOG_SAMPLE = 30;

const VISITOR_ACTIVITY_QUERY = `query getVisitorReviews($input: VisitorReviewsInput) {
  visitorReviews(input: $input) { total items { created visitCount reply { created } } }
}`;

const BLOG_ACTIVITY_QUERY = `query getFsasReviews($input: FsasReviewsInput) {
  fsasReviews(input: $input) { total items { type createdString } }
}`;

const FEED_ACTIVITY_QUERY = `query getFeeds($businessId: String!) {
  feeds(businessId: $businessId) { feeds { category title isPinned createdString } hasMore }
}`;

const COUPON_ACTIVITY_QUERY = `query getUnifiedCoupons($channelId: String, $input: UnifiedCouponsInput, $isBooking: Boolean!) {
  naverTalk @skip(if: $isBooking) { alarm(channelId: $channelId) { friendYn } }
  unifiedCoupons(input: $input) { total coupons { title type } memberships { membershipName } }
}`;

const BRIEFING_QUERY = `query getAiBriefing($input: AiBriefingInput) {
  aiBriefing(input: $input) { textSummaries { sentence } }
}`;

// 블로그 리뷰 가운데 특정 낱말이 들어간 글의 수만 받습니다(글 제목·본문·작성자는 요청하지 않음).
// 추천 키워드가 실제 후기에서 쓰이는 말인지 확인하는 근거로 쓰고, 활동 묶음 요청에 함께 실어 요청 수를 늘리지 않습니다.
export const MENTION_TERMS_MAX = 8;
const MENTION_TERM = /^[가-힣a-zA-Z0-9][가-힣a-zA-Z0-9 ]{1,14}$/;

const BLOG_MENTION_QUERY = `query getFsasReviews($input: FsasReviewsInput) {
  fsasReviews(input: $input) { total }
}`;

// 언급 수를 물어볼 낱말 정리: 한글·영문·숫자 2~15자만, 중복 없이 최대 MENTION_TERMS_MAX 개
export function cleanMentionTerms(terms) {
    const seen = new Set();
    const list = [];
    for (const raw of Array.isArray(terms) ? terms : []) {
        const term = String(raw ?? '').replace(/\s+/g, ' ').trim();
        const key = term.replace(/\s+/g, '').toLowerCase();
        if (!MENTION_TERM.test(term) || seen.has(key)) continue;
        seen.add(key);
        list.push(term);
        if (list.length >= MENTION_TERMS_MAX) break;
    }
    return list;
}

function badInput(message) {
    return new PlaceLookupError('BAD_INPUT', message);
}

function placeIdFromUrl(parsed) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    // /restaurant/123/home, /p/entry/place/123 처럼 종류 이름 바로 뒤의 숫자를 먼저 봅니다.
    for (let i = 0; i < segments.length - 1; i += 1) {
        if (PLACE_PATH_WORDS.includes(segments[i]) && ID_ONLY.test(segments[i + 1])) return segments[i + 1];
    }
    for (const key of ['id', 'placeId', 'pinId']) {
        const value = parsed.searchParams.get(key);
        if (value && ID_ONLY.test(value)) return value;
    }
    return segments.find((segment) => ID_ONLY.test(segment)) || null;
}

// 입력값(플레이스 주소 또는 숫자 ID) → { placeId } 또는 { shortUrl }(naver.me 공유 주소)
export function parsePlaceInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw badInput('플레이스 주소 또는 ID를 입력해주세요.');
    if (ID_ONLY.test(raw)) return { placeId: raw };

    let parsed;
    try {
        parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        throw badInput('네이버 플레이스 주소 또는 숫자 ID만 입력할 수 있습니다.');
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'naver.me') {
        if (parsed.pathname.length < 2) throw badInput('공유 주소가 올바르지 않습니다.');
        return { shortUrl: `https://naver.me${parsed.pathname}` };
    }
    if (!PLACE_HOSTS.includes(host)) {
        throw badInput('네이버 플레이스(지도) 주소 또는 숫자 ID만 입력할 수 있습니다.');
    }
    const placeId = placeIdFromUrl(parsed);
    if (!placeId) throw badInput('주소에서 플레이스 ID를 찾지 못했습니다. 매장 화면의 주소를 그대로 붙여 넣어주세요.');
    return { placeId };
}

export function placeHomeUrl(placeId) {
    return `https://m.place.naver.com/place/${placeId}/home`;
}

// "2,225" → 2225, "37,000+" → 37000, "~100" → 100, "1.2만" → 12000
export function parseCount(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    const text = String(value).trim().replace(/,/g, '').replace(/[~+]/g, '');
    if (!text) return null;
    const scaled = text.endsWith('만') ? Number(text.slice(0, -1)) * 10000 : Number(text);
    return Number.isFinite(scaled) ? Math.round(scaled) : null;
}

function toScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(number) && number > 0 ? number : null;
}

// 매장 화면 HTML 안의 window.__APOLLO_STATE__ = {...} 를 꺼냅니다.
export function parseApolloState(html) {
    const marker = 'window.__APOLLO_STATE__';
    const markerAt = String(html).indexOf(marker);
    if (markerAt < 0) return null;
    let i = html.indexOf('=', markerAt + marker.length);
    if (i < 0) return null;
    i += 1;
    while (i < html.length && /\s/.test(html[i])) i += 1;
    if (html[i] !== '{') return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < html.length; j += 1) {
        const ch = html[j];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(i, j + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function labelCounts(list, labelKey = 'label', limit = 8) {
    if (!Array.isArray(list)) return [];
    return list
        .filter((item) => item && typeof item[labelKey] === 'string' && Number.isFinite(item.count))
        .map((item) => ({ label: item[labelKey].trim(), count: item.count }))
        .filter((item) => item.label && item.count > 0)
        .slice(0, limit);
}

function stringList(value) {
    return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}

function countOrNull(value) {
    const number = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? Math.round(number) : null;
}

// ROOT_QUERY 의 placeDetail({...}) 항목 — 매장 화면이 받은 상세 응답 전체입니다. 업종마다 들어 있는 필드가 다릅니다.
export function placeDetailRoot(apollo) {
    const root = apollo?.ROOT_QUERY;
    if (!root || typeof root !== 'object') return null;
    const entry = Object.entries(root).find(([key]) => key.startsWith('placeDetail('));
    return entry && entry[1] && typeof entry[1] === 'object' ? entry[1] : null;
}

// 인자가 붙은 필드는 'buttons({"input":...})' 같은 이름으로 저장됩니다.
function fieldOf(obj, name) {
    if (!obj) return undefined;
    if (name in obj) return obj[name];
    const key = Object.keys(obj).find((k) => k.startsWith(`${name}(`));
    return key ? obj[key] : undefined;
}

function deref(apollo, value) {
    return value && typeof value === 'object' && value.__ref ? apollo?.[value.__ref] : value;
}

const POS_DAYS = [
    ['monday', '월'], ['tuesday', '화'], ['wednesday', '수'], ['thursday', '목'],
    ['friday', '금'], ['saturday', '토'], ['sunday', '일'],
];

// newBusinessHours → 영업시간. 필드가 없으면 null(확인 불가), 빈 배열이면 미등록.
export function extractHours(list) {
    if (!Array.isArray(list)) return null;
    const first = list.find((entry) => entry && typeof entry === 'object') || null;
    const days = (first?.businessHours || [])
        .filter((day) => day && day.day)
        .map((day) => ({
            day: String(day.day),
            start: day.businessHours?.start || null,
            end: day.businessHours?.end || null,
            breaks: (day.breakHours || []).filter((b) => b?.start && b?.end).map((b) => `${b.start}~${b.end}`),
            lastOrder: day.lastOrderTimes?.find((t) => t?.time)?.time || null,
        }));
    const status = first?.businessStatusDescription || {};
    return {
        registered: days.length > 0,
        status: String(status.status || '').trim() || null,
        statusText: String(status.description || '').trim() || null,
        days,
        regularClosed: String(first?.comingRegularClosedDays || '').trim() || null,
        irregularClosedCount: Array.isArray(first?.comingIrregularClosedDays) ? first.comingIrregularClosedDays.length : 0,
    };
}

// POS(네이버페이 결제 단말) 연동 매장만 있는 결제 집계: 주간 인기 메뉴, 시간대별 1회 평균 결제액,
// 요일·시간대별 붐빔(0~100 상대값), 평균 체류 시간. 음식점 화면에만 내려옵니다.
// 붐빔 배열 i번째 칸은 네이버 화면에서 (i+1)시로 표시되고, popularTime 도 같은 기준(1~24)입니다.
export function extractPos(pos) {
    if (!pos || pos.isPOS !== true) return null;
    const price = pos.averagePrice || {};
    const positive = (value) => {
        const number = countOrNull(value);
        return number !== null && number > 0 ? number : null;
    };
    const weekly = POS_DAYS.map(([key, label]) => {
        const day = pos.weeklyPopularity?.[key];
        const hours = Array.isArray(day?.popularity) ? day.popularity.map((v) => (Number.isFinite(v) ? v : 0)) : [];
        return { key, day: label, hours, peakHour: Number.isInteger(day?.popularTime) ? day.popularTime : null };
    }).filter((day) => day.hours.length === 24);
    return {
        weeklySales: countOrNull(pos.salesCount),
        popularMenus: (pos.popularMenus || [])
            .filter((menu) => menu && String(menu.name || '').trim())
            .slice(0, 5)
            .map((menu) => ({
                name: String(menu.name).trim(),
                count: countOrNull(menu.count),
                share: countOrNull(menu.orderShare),
                change: String(menu.rankChange || '').trim() || null,
            })),
        averagePrice: {
            morning: positive(price.morning),
            lunch: positive(price.lunch),
            dinner: positive(price.dinner),
            night: positive(price.night),
            total: positive(price.total),
        },
        busiestDay: POS_DAYS.find(([key]) => key === pos.popularDay)?.[1] || null,
        stayMinutes: positive(pos.durationTime),
        weekly,
    };
}

function menuHasImage(menu) {
    return Boolean(menu.hasImage || menu.imageUrl || (Array.isArray(menu.images) && menu.images.length > 0));
}

function menuPriceText(menu) {
    return String(menu.price?.displayText || menu.priceText || (typeof menu.price === 'string' ? menu.price : '')).trim();
}

export const MENU_LIST_MAX = 40;

// 매장이 공개한 메뉴·가격표. 음식점은 PlaceMenuItem, 미용실 등은 Menu 로 내려옵니다.
// 화면 순서(placeMenus.items)를 먼저 따르고, 추천·대표로 표시된 메뉴에 recommended 를 붙입니다. 사진 주소는 담지 않습니다.
// hasImage 는 사진 칸이 아예 없는 가격표(미용실 등)에서는 null(해당 없음)입니다.
export function extractMenus(apollo) {
    if (!apollo || typeof apollo !== 'object') return [];
    const recommended = new Set();
    for (const [key, item] of Object.entries(apollo)) {
        if (key.startsWith('PlaceMenuCategory:') && item?.kind === 'recommend' && Array.isArray(item.itemIds)) {
            item.itemIds.forEach((id) => recommended.add(String(id)));
        }
    }
    const list = [];
    const seen = new Set();
    const push = (item) => {
        const name = String(item?.name || '').trim();
        if (!name) return;
        const key = item.id !== undefined && item.id !== null ? `id:${item.id}` : `name:${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({
            name,
            price: menuPriceText(item) || null,
            hasImage: 'hasImage' in item || 'imageUrl' in item || 'images' in item ? menuHasImage(item) : null,
            recommended: item.recommend === true || recommended.has(String(item.id)) || (Array.isArray(item.badges) && item.badges.includes('repr')),
        });
    };
    for (const ref of fieldOf(placeDetailRoot(apollo), 'placeMenus')?.items || []) push(deref(apollo, ref));
    const rest = Object.entries(apollo)
        .filter(([key, item]) => (key.startsWith('PlaceMenuItem:') || key.startsWith('Menu:')) && item)
        .map(([, item]) => item)
        .sort((a, b) => (Number.isFinite(a.index) ? a.index : 0) - (Number.isFinite(b.index) ? b.index : 0));
    rest.forEach(push);
    return list.slice(0, MENU_LIST_MAX);
}

// 매장 화면 상세 응답(placeDetail)에서 운영 상태를 정리합니다. 추가 요청 없이 이미 받은 HTML 안의 값만 씁니다.
// 전화번호·리뷰 원문·작성자·디자이너 이름·사장님이 쓴 긴 안내문은 담지 않습니다.
export function extractDetail(apollo) {
    const detail = placeDetailRoot(apollo);
    if (!detail) return null;
    const get = (name) => fieldOf(detail, name);

    const info = get('informationTab');
    const parking = info?.parkingInfo || null;
    const tools = Array.isArray(get('businessTools')?.tools) ? get('businessTools').tools : [];
    const booking = get('naverBooking');
    const homepages = get('homepages');
    const links = [homepages?.repr, ...(Array.isArray(homepages?.etc) ? homepages.etc : [])]
        .filter((link) => link && !link.isDeadUrl && String(link.type || '').trim())
        .map((link) => String(link.type).trim());
    const subway = (get('subwayStations') || []).map((s) => deref(apollo, s?.station)).find(Boolean);
    const description = get('description');
    const hasFeed = get('hasFeed');
    const topPhotos = get('topPhotos');
    const images = get('images');
    const menuImages = get('menuImages');
    const busStations = get('busStations');
    const hasAiBriefing = get('hasAiBriefing');
    const styleCounts = get('hairStyles')?.myStyle?.styleBookingCounts;
    const restaurantInfo = get('restaurantInfoTabDetails');
    const corkage = restaurantInfo?.alcoholCorkage?.corkage;
    const bookingPromotion = String(booking?.promotionTitle || booking?.naverBookingPromotion?.title || '').trim();

    return {
        // 정보 탭의 대표키워드. 응답에 없으면 null(따로 조회해야 함).
        keywords: Array.isArray(info?.keywordList) ? stringList(info.keywordList) : null,
        hours: extractHours(get('newBusinessHours')),
        pos: extractPos(get('POS')),
        photos: {
            top: countOrNull(topPhotos?.total),
            business: countOrNull(images?.totalImages),
            visitorMedia: countOrNull(get('visitorReviewMediasTotal')),
        },
        couponCount: countOrNull(get('hasCoupon')?.count),
        hasFeed: hasFeed ? Boolean(hasFeed.feedExist) : null,
        tools: tools
            .filter((tool) => tool && tool.type && tool.title)
            .map((tool) => ({ type: String(tool.type), title: String(tool.title).trim(), using: tool.using === true })),
        hasBooking: booking ? Boolean(booking.naverBookingUrl || booking.bookingBusinessId) : null,
        tabs: (get('tabs') || []).map((tab) => String(tab?.name || '').trim()).filter(Boolean),
        parking: parking ? {
            available: Boolean(parking.basicParking || parking.valetParking || parking.description),
            free: parking.basicParking ? parking.basicParking.isFree === true : null,
            valet: Boolean(parking.valetParking),
        } : null,
        facilities: (info?.facilities || []).map((f) => String(deref(apollo, f)?.name || '').trim()).filter(Boolean),
        pet: info?.pet && typeof info.pet.isAllowed === 'boolean' ? info.pet.isAllowed : null,
        noKidsZone: info?.noKidsZone ? info.noKidsZone.isOperated === true : null,
        descriptionLength: typeof description === 'string' ? description.trim().length : null,
        links: [...new Set(links)],
        badges: (get('badge') || []).map((b) => String(b?.text || '').trim()).filter(Boolean),
        subway: subway?.displayName ? {
            station: String(subway.displayName),
            exit: subway.nearestExit ? String(subway.nearestExit) : null,
            walkMinutes: countOrNull(subway.walkTime),
        } : null,
        menuUpdatedAt: String(get('placeMenus')?.updatedAt || '').trim() || null,
        newOpening: get('newOpening') === true,
        benefits: (get('connectPlus') || [])
            .filter((b) => b?.showInBenefitArea && String(b.title || '').trim())
            .map((b) => String(b.title).trim()),
        // ── 매장 화면 응답에 들어 있지만 화면에서는 탭을 눌러야 보이는 값들 ──
        menus: extractMenus(apollo),
        // 메뉴판(가격표) 사진 수. 필드가 없으면 null(확인 불가).
        menuBoardPhotos: Array.isArray(menuImages) ? menuImages.length : menuImages === null ? 0 : null,
        // 예약 혜택 문구와 예약 상품 수
        bookingPromotion: bookingPromotion || null,
        bookingItemCount: Object.keys(apollo).filter((key) => key.startsWith('BookingItem:')).length,
        // 미용실: 스타일별 누적 예약 수(많은 순)와 디자이너 수
        styles: (Array.isArray(styleCounts) ? styleCounts : [])
            .filter((style) => style && String(style.name || '').trim() && Number(style.count) > 0)
            .map((style) => ({ name: String(style.name).trim(), count: Math.round(Number(style.count)) }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8),
        stylistCount: countOrNull(get('stylists')?.total),
        themes: stringList(get('themes')),
        // 음식점: 좌석 종류·대관·콜키지 가능 여부
        seats: (restaurantInfo?.seat || []).map((seat) => String(deref(apollo, seat)?.name || '').trim()).filter(Boolean),
        rental: restaurantInfo?.venueRental ? restaurantInfo.venueRental.isAvailable === true : null,
        corkage: corkage ? corkage.isAvailable === true : null,
        // 네이버가 이 매장에 AI 브리핑을 띄우는지. 필드가 없으면 null.
        hasAiBriefing: typeof hasAiBriefing === 'boolean' ? hasAiBriefing : null,
        // 식신·다이닝코드처럼 네이버가 함께 보여 주는 외부 서비스
        externalSites: (get('relatedLinks') || []).map((link) => String(link?.name || '').trim()).filter(Boolean),
        busStops: Array.isArray(busStations) ? busStations.length : null,
    };
}

// 공개 데이터 → 화면에 쓸 매장 요약. 전화번호·리뷰 원문·작성자는 담지 않습니다.
export function extractSnapshot(apollo, placeId) {
    const base = apollo?.[`PlaceDetailBase:${placeId}`];
    if (!base || typeof base !== 'object') return null;

    const stats = apollo[`VisitorReviewStatsResult:${placeId}`] || {};
    const review = stats.review || {};
    const analysis = stats.analysis || {};
    const missing = base.missingInfo && typeof base.missingInfo === 'object' ? base.missingInfo : null;
    // missingInfo.isBizHourMissing 은 영업시간이 화면에 나오는 매장에서도 true 로 내려왔습니다(2026-11-15, 3개 업종 모두).
    // 그래서 실제 영업시간(newBusinessHours)이 화면 응답에 있으면 그것으로 판단합니다.
    const hours = extractHours(fieldOf(placeDetailRoot(apollo), 'newBusinessHours'));
    const hoursMissing = hours ? !hours.registered : Boolean(missing?.isBizHourMissing);

    const menus = Object.entries(apollo)
        .filter(([key, item]) => (key.startsWith('PlaceMenuItem:') || key.startsWith('Menu:')) && item && item.name)
        .map(([, item]) => item);

    // 메뉴 정리 상태: 사진·가격·설명이 채워진 메뉴 수와 분류(카테고리) 수. 셀러가 비어 있는 곳을 보강할 수 있게.
    const menuCategories = Object.entries(apollo).filter(([key, item]) => key.startsWith('PlaceMenuCategory:') && item
        && String(item.name || '').trim() && String(item.kind || '') !== 'uncategorized' && Array.isArray(item.itemIds) && item.itemIds.length > 0);

    const microReviews = stringList(base.microReviews);

    // 좌표 (지도 표시·거리 계산에 쓸 수 있음)
    const coord = base.coordinate && typeof base.coordinate === 'object' ? base.coordinate : null;

    // 별점 분포 (5/4/3/2/1점 순서). scores 배열은 3개만 올 수 있고 score 필드가 null인 경우가 있어
    // 네이버가 돌려준 순서 그대로 count만 뽑습니다.
    const ratingCounts = Array.isArray(review.scores)
        ? review.scores.filter((s) => s && Number.isFinite(s.count)).map((s) => s.count)
        : null;

    return {
        placeId: String(placeId),
        name: String(base.name || '').trim(),
        category: String(base.category || '').trim(),
        categoryCode: String(base.categoryCode || '').trim() || null,
        address: String(base.roadAddress || base.address || '').trim(),
        // 지번 주소. 도로명 주소에는 없는 동·읍·면 이름이 들어 있어 지역 키워드를 만들 때 씁니다.
        jibunAddress: String(base.address || '').trim() || null,
        coordinate: coord ? { x: String(coord.x || ''), y: String(coord.y || '') } : null,
        visitorReviews: parseCount(base.visitorReviewsTotal) ?? 0,
        visitorScore: base.reviewSettings?.showVisitorReviewScore === false ? null : toScore(base.visitorReviewsScore),
        blogReviews: parseCount(base.cafeBlogReviewsTotal) ?? 0,
        textReviews: parseCount(base.visitorReviewsTextReviewTotal),
        photoReviews: parseCount(review.imageReviewCount),
        ratingCounts,
        ratingOnlyReviews: parseCount(stats.ratingReviewsTotal),
        intro: microReviews[0] || null,
        conveniences: stringList(base.conveniences),
        paymentInfo: stringList(base.paymentInfo),
        hasTalktalk: Boolean(base.talktalkUrl),
        hasBlog: Boolean(base.naverBlog),
        hasPhone: Boolean(base.phone || base.virtualPhone),
        hasOpeningHours: hours ? hours.registered : base.openingHours !== null && base.openingHours !== undefined,
        isGoodStore: Boolean(base.isGoodStore),
        // 네이버가 "정보 부족"으로 표시한 항목(true = 비어 있음). 알 수 없으면 null.
        missing: missing ? {
            hours: hoursMissing,
            menuImage: Boolean(missing.isMenuImageMissing),
            accessor: Boolean(missing.isAccessorMissing),
            description: Boolean(missing.isDescriptionMissing),
            conveniences: Boolean(missing.isConveniencesMissing),
        } : null,
        menuCount: menus.length,
        menuImageCount: menus.filter(menuHasImage).length,
        // 가격·설명이 채워진 메뉴 수와 카테고리 수. 메뉴가 없으면 null.
        menuPricedCount: menus.length ? menus.filter((menu) => menuPriceText(menu)).length : null,
        menuDescribedCount: menus.length ? menus.filter((menu) => String(menu.description || '').trim()).length : null,
        menuCategoryCount: menus.length ? menuCategories.length : null,
        reviewThemes: labelCounts(analysis.themes),
        // 방문자 리뷰에서 낱말별로 언급된 횟수. 키워드 추천의 근거로 쓰려고 넉넉히(20개) 담습니다.
        reviewMenus: labelCounts(analysis.menus, 'label', 20),
        reviewVotes: labelCounts(analysis.votedKeyword?.details, 'displayName'),
        // 방문자 리뷰를 쓴 사람 수(리뷰 수와 다를 수 있음). 집계가 없으면 null.
        reviewAuthors: parseCount(review.authorCount),
    };
}

// 목록 한 쪽을 요청할 때 보내는 값. 실제 화면과 같게 정렬·업종은 지정하지 않습니다.
// query 를 넘기면 그 쿼리로(1페이지는 LIST_QUERY_RICH), 기본은 최소 필드(LIST_QUERY)로 보냅니다. 변수는 동일합니다.
export function buildListBody(keyword, start, query = LIST_QUERY) {
    return {
        operationName: 'getPlaceList',
        query,
        variables: { input: { query: keyword, start, display: PAGE_SIZE, isNmap: false, deviceType: 'mobile' } },
    };
}

export function buildKeywordBody(placeId) {
    return { operationName: 'getPlaceDetail', query: KEYWORD_QUERY, variables: { id: String(placeId) } };
}

// 활동 묶음에서 기본 쿼리가 차지하는 칸 수(그 뒤는 낱말별 블로그 언급 수)
export const ACTIVITY_BASE_COUNT = 5;

// 활동 묶음 요청 본문(순서 고정: 방문자 리뷰, 블로그 리뷰, 소식, 쿠폰, AI 브리핑, 그 뒤로 낱말별 블로그 언급 수)
export function buildActivityBatch(placeId, mentionTerms = []) {
    const id = String(placeId);
    const mentions = cleanMentionTerms(mentionTerms).map((term) => ({
        operationName: 'getFsasReviews',
        query: BLOG_MENTION_QUERY,
        variables: { input: { businessId: id, businessType: 'place', page: 0, display: 1, deviceType: 'mobile', query: term, excludeGdids: [], reviewSort: 'recent' } },
    }));
    return [
        {
            operationName: 'getVisitorReviews',
            query: VISITOR_ACTIVITY_QUERY,
            variables: { input: { businessId: id, businessType: 'place', size: ACTIVITY_REVIEW_SAMPLE, sort: 'recent', includeContent: true } },
        },
        {
            operationName: 'getFsasReviews',
            query: BLOG_ACTIVITY_QUERY,
            variables: { input: { businessId: id, businessType: 'place', page: 0, display: ACTIVITY_BLOG_SAMPLE, deviceType: 'mobile', query: null, excludeGdids: [], reviewSort: 'recent' } },
        },
        { operationName: 'getFeeds', query: FEED_ACTIVITY_QUERY, variables: { businessId: id } },
        { operationName: 'getUnifiedCoupons', query: COUPON_ACTIVITY_QUERY, variables: { input: { businessId: id }, isBooking: true } },
        { operationName: 'getAiBriefing', query: BRIEFING_QUERY, variables: { input: { businessId: id, businessType: 'place' } } },
        ...mentions,
    ];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_MS = 9 * 60 * 60 * 1000;

function kstToday(nowMs) {
    const d = new Date(nowMs + KST_MS);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function validDay(year, month, day) {
    const ms = Date.UTC(year, month - 1, day);
    const d = new Date(ms);
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? ms : null;
}

// 네이버 날짜 표기 → 'YYYY-MM-DD'(한국 날짜). 해석하지 못하면 null.
//   "11.15.일"(올해, 연도 생략) · "26.11.15.일" · "2026.11.07." · "20261107"
// 연도를 생략한 날짜가 오늘보다 뒤면 작년 날짜로 봅니다.
export function parseNaverDate(text, nowMs = Date.now()) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    let ms = null;
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
        ms = validDay(Number(compact[1]), Number(compact[2]), Number(compact[3]));
    } else {
        const nums = raw.split('.').map((part) => part.trim()).filter((part) => /^\d+$/.test(part)).map(Number);
        const today = kstToday(nowMs);
        if (nums.length >= 3) {
            const year = nums[0] < 100 ? 2000 + nums[0] : nums[0];
            ms = validDay(year, nums[1], nums[2]);
        } else if (nums.length === 2) {
            const year = new Date(today).getUTCFullYear();
            ms = validDay(year, nums[0], nums[1]);
            if (ms !== null && ms > today) ms = validDay(year - 1, nums[0], nums[1]);
        }
    }
    return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' 가 오늘(한국 날짜)로부터 며칠 전인지
export function daysAgo(isoDate, nowMs = Date.now()) {
    if (!isoDate) return null;
    const ms = Date.parse(`${isoDate}T00:00:00Z`);
    return Number.isFinite(ms) ? Math.round((kstToday(nowMs) - ms) / DAY_MS) : null;
}

// 마지막 소식이 며칠 전인지(화면의 모든 곳이 이 값을 씁니다).
// 활동 자료는 저장해 두고 다시 보여 주므로, 요약할 때 센 daysSinceLatest 는 날짜가 바뀌면 하루 이틀 모자랍니다
// (같은 화면에서 '지금 할 일'은 46일째, '마지막 소식'은 47일 전으로 갈렸던 까닭). 날짜(latest)가 있으면 지금 기준으로 다시 세고,
// 저장한 값이 더 크면(날짜 없이 값만 있는 자료) 그 값을 씁니다. 시간이 지나면 값은 커지기만 하므로 두 값 중 큰 쪽이 맞는 값입니다.
export function feedDays(feeds, nowMs = Date.now()) {
    if (!feeds) return null;
    const saved = Number.isFinite(feeds.daysSinceLatest) ? feeds.daysSinceLatest : null;
    const fresh = feeds.latest ? daysAgo(feeds.latest, nowMs) : null;
    if (fresh === null) return saved;
    return saved === null ? fresh : Math.max(saved, fresh);
}

function percent(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function recentStats(dates, nowMs) {
    const ages = dates.map((date) => daysAgo(date, nowMs)).filter((age) => age !== null && age >= 0);
    const sorted = [...dates].sort();
    return {
        latest: sorted.at(-1) || null,
        oldest: sorted[0] || null,
        last7: ages.filter((age) => age < 7).length,
        last30: ages.filter((age) => age < 30).length,
        // 가장 오래된 표본부터 오늘까지(오늘 포함) 걸린 날 수
        spanDays: ages.length ? Math.max(...ages) + 1 : null,
    };
}

// 활동 묶음 응답(buildActivityBatch 순서의 data 배열, 실패한 항목은 null) → 화면에 쓸 요약
// mentionTerms 는 buildActivityBatch 에 넘긴 것과 같은 낱말 목록입니다.
export function summarizeActivity(parts, nowMs = Date.now(), mentionTerms = []) {
    const [visitorData, blogData, feedData, couponData, briefingData] = Array.isArray(parts) ? parts : [];

    let visitor = null;
    const vr = visitorData?.visitorReviews;
    if (vr && Array.isArray(vr.items)) {
        const items = vr.items.filter(Boolean);
        const dates = items.map((item) => parseNaverDate(item.created, nowMs)).filter(Boolean);
        const stats = recentStats(dates, nowMs);
        const replied = items.filter((item) => item.reply && item.reply.created).length;
        const revisits = items.filter((item) => Number(item.visitCount) > 1).length;
        visitor = {
            total: countOrNull(vr.total),
            sampled: items.length,
            ...stats,
            // 최근 표본 리뷰가 쌓인 기간으로 나눈 하루 평균
            perDay: stats.spanDays ? Math.round((dates.length / stats.spanDays) * 10) / 10 : null,
            replied,
            replyRate: percent(replied, items.length),
            revisits,
            revisitRate: percent(revisits, items.length),
        };
    }

    let blog = null;
    const fsas = blogData?.fsasReviews;
    if (fsas && Array.isArray(fsas.items)) {
        const items = fsas.items.filter(Boolean);
        const dates = items.map((item) => parseNaverDate(item.createdString, nowMs)).filter(Boolean);
        blog = {
            total: countOrNull(fsas.total),
            sampled: items.length,
            cafe: items.filter((item) => item.type === 'cafe').length,
            ...recentStats(dates, nowMs),
        };
    }

    let feeds = null;
    const fd = feedData?.feeds;
    if (fd && Array.isArray(fd.feeds)) {
        const items = fd.feeds.filter(Boolean).map((item) => ({ ...item, date: parseNaverDate(item.createdString, nowMs) }));
        const newest = items.filter((item) => item.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
        feeds = {
            count: items.length,
            hasMore: fd.hasMore === true,
            latest: newest?.date || null,
            latestTitle: newest ? String(newest.title || '').trim() || null : null,
            latestCategory: newest ? String(newest.category || '').trim() || null : null,
            daysSinceLatest: newest ? daysAgo(newest.date, nowMs) : null,
            last30: items.filter((item) => item.date && daysAgo(item.date, nowMs) < 30).length,
        };
    }

    let coupons = null;
    const uc = couponData?.unifiedCoupons;
    if (uc && typeof uc === 'object') {
        const list = Array.isArray(uc.coupons) ? uc.coupons.filter(Boolean) : [];
        coupons = {
            total: countOrNull(uc.total) ?? list.length,
            titles: list.map((c) => String(c.title || '').trim()).filter(Boolean).slice(0, 5),
            memberships: (uc.memberships || []).map((m) => String(m?.membershipName || '').trim()).filter(Boolean),
        };
    }

    // 첫 문장은 "리뷰를 요약했습니다" 같은 안내문이라 뺍니다.
    const sentences = (briefingData?.aiBriefing?.textSummaries || [])
        .map((s) => String(s?.sentence || '').trim())
        .filter((s) => s && !/요약(해|했)/.test(s));

    // 낱말별 블로그 언급 수. 응답을 못 받은 낱말은 뺍니다(0건과 "확인 불가"를 섞지 않음).
    const terms = cleanMentionTerms(mentionTerms)
        .map((term, index) => ({ term, count: countOrNull(parts?.[ACTIVITY_BASE_COUNT + index]?.fsasReviews?.total) }))
        .filter((entry) => entry.count !== null);
    const mentions = terms.length ? { blogTotal: blog?.total ?? null, terms } : null;

    if (!visitor && !blog && !feeds && !coupons && sentences.length === 0 && !mentions) return null;
    return { visitor, blog, feeds, coupons, briefing: sentences.length ? sentences : null, mentions };
}

const LEVEL_ORDER = { high: 0, mid: 1, low: 2 };

// 미용·네일·피부관리 업종(place-keywords 의 FAMILIES hair·nail·skin 과 같은 말; place-keywords 가 이 파일을 불러오므로 거기서 가져오지 않고 여기에 둡니다)
const BEAUTY_SHOP = /미용실|헤어|바버|네일|피부관리|에스테틱|왁싱|마사지|스파|스웨디시|타이/;

// 소식에 올릴 거리를 그 업종의 말로(약국·동물병원은 이벤트를 권하지 않고, 노출 위치는 단정하지 않습니다)
function feedAdvice(place) {
    const kind = healthKind(place);
    if (kind === 'pharmacy') return '새 취급 품목·서비스·휴무 안내를 소식에 올리세요.';
    if (kind === 'pet') return '새 진료 과목·서비스·휴무 안내를 소식에 올리세요.';
    const beauty = BEAUTY_SHOP.test(String(place?.category || '') || String(place?.name || ''));
    return `${beauty ? '새 시술' : '새 메뉴'}·이벤트·휴무 안내를 소식에 올리면 손님이 매장 화면에서 볼 수 있습니다.`;
}

// 매장 요약(getPlace) + 활동(getActivity) → 셀러가 바로 할 수 있는 일. 사실(비어 있음·0·오래됨)만 근거로 씁니다.
// 조언마다 "무엇이 얼마나 부족한지"(숫자)와 "무엇을 하면 되는지"를 함께 적습니다.
//   recommendation: recommendKeywords() 결과. 주면 대표키워드 조언에 추천 키워드를 넣습니다.
// 먼저 할 일(high) → 권장(mid) → 참고(low) 순서로 돌려줍니다.
export function buildActionItems(place, activity, { recommendation = null, nowMs = Date.now() } = {}) {
    if (!place) return [];
    const items = [];
    const add = (key, level, title, detail, link = null) => items.push({ key, level, title, detail, link });
    const detail = place.detail || {};
    const recoLink = { label: '추천 키워드 보기', target: 'kw-reco' };
    // 업종 때문에 해당 없는 일(병의원의 새소식·쿠폰, 약국의 쿠폰·예약)은 할 일로 올리지 않습니다(place-industry.js)
    const industry = notApplicableOf(place);

    if (place.missing?.hours) {
        add('hours', 'high', '영업시간 등록', '영업시간이 비어 있으면 "영업 중" 필터 검색에서 빠질 수 있습니다. 스마트플레이스 > 업체정보 > 영업시간에서 요일별로 넣으세요.');
    }

    const picks = (recommendation?.items || []).filter((item) => item.registrable).slice(0, 2).map((item) => `'${item.keyword}'`);
    const registered = recommendation?.registered || [];
    if (Array.isArray(place.keywords) && place.keywords.length < 5) {
        const empty = 5 - place.keywords.length;
        add('keywords', 'high', `대표키워드 ${place.keywords.length}/5개`, picks.length
            ? `빈 칸이 ${empty}개 남았습니다. ${picks.join(', ')}처럼 자료가 받치는 조합부터 순위를 확인하고 채워 보세요.`
            : '스마트플레이스에서 대표키워드 5개를 모두 채우세요. 상위 매장 키워드를 참고하면 좋습니다.', picks.length ? recoLink : null);
    }
    if (recommendation && recommendation.regions.length > 0 && registered.length > 0 && !recommendation.hasRegionKeyword && picks.length > 0) {
        add('keywordRegion', 'mid', `대표키워드 ${registered.length}개 모두 지역명 없음`,
            `손님은 ${picks.join(', ')}처럼 지역을 붙여 검색합니다. 지역 없는 키워드는 순위도 검색 위치마다 달라 확인이 어렵습니다. 추천 키워드로 순위를 보고 ${industry.feed ? '소개글·대표키워드' : '소개글·소식·대표키워드'}에 반영하세요.`, recoLink);
    }
    const unspoken = registered.find((entry) => entry.spoken && entry.blog === 0);
    if (unspoken) {
        const total = recommendation.blogTotal;
        add('keywordSpoken', 'low', `'${unspoken.keyword}'보다 '${unspoken.spoken.term}'`,
            `블로그 후기${total ? ` ${total}개` : ''} 가운데 '${unspoken.keyword}' 언급은 0개, '${unspoken.spoken.term}' 언급은 ${unspoken.spoken.blog}개입니다. 손님이 쓰는 말로 바꾸는 것을 검토해 보세요.`, recoLink);
    }

    if (place.missing?.description || detail.descriptionLength === 0) {
        add('description', 'high', '소개글 작성',
            `매장 소개글이 비어 있습니다. 무엇을 하는 곳인지·누구에게 좋은지·찾아오는 길을 3~5문장으로 쓰세요.${picks.length ? ` ${picks[0]} 같은 검색어를 자연스럽게 넣으면 좋습니다.` : ''}`);
    }

    const businessPhotos = detail.photos?.business;
    const visitorMedia = detail.photos?.visitorMedia;
    if (businessPhotos === 0) {
        add('photos', 'high', '업체 사진 0장',
            `사장님이 올린 사진이 없습니다${visitorMedia ? `(손님이 올린 사진·영상은 ${visitorMedia}개)` : ''}. 외관·내부·대표 상품 사진부터 올리세요. 손님이 매장 화면에서 보는 사진입니다.`);
    } else if (Number.isFinite(businessPhotos) && businessPhotos < 5) {
        add('photos', 'mid', `업체 사진 ${businessPhotos}장`, '외관·내부·대표 상품이 골고루 보이도록 사진을 더 올려 보세요. 손님이 매장 화면에서 보는 사진입니다.');
    }

    if (place.missing?.menuImage) {
        add('menuImage', 'mid', '메뉴·가격 사진 추가', place.menuCount > 0
            ? `네이버가 메뉴 사진이 부족하다고 표시한 매장입니다. 등록한 메뉴 ${place.menuCount}개 중 사진이 있는 것은 ${place.menuImageCount}개입니다.`
            : '네이버가 메뉴·가격 사진이 부족하다고 표시한 매장입니다. 메뉴판이나 가격표를 찍어 올리세요.');
    }
    const unpriced = place.menuCount > 0 && Number.isFinite(place.menuPricedCount) ? place.menuCount - place.menuPricedCount : 0;
    if (unpriced > 0) {
        add('menuPrice', 'low', `가격 없는 메뉴 ${unpriced}개`, `등록한 메뉴 ${place.menuCount}개 중 ${unpriced}개에 가격이 없습니다. 가격이 보여야 손님이 방문 전에 비교할 수 있습니다.`);
    }

    const visitor = activity?.visitor;
    if (visitor && visitor.sampled >= 10 && visitor.replyRate !== null && visitor.replyRate < 50) {
        add('reply', visitor.replyRate < 10 ? 'high' : 'mid', `리뷰 답글률 ${visitor.replyRate}%`,
            `최근 방문자 리뷰 ${visitor.sampled}개 중 사장님 답글이 ${visitor.replied}개입니다. 답글이 없는 ${visitor.sampled - visitor.replied}개 가운데 최근 것부터 달아 보세요. 답글은 다른 손님이 매장의 응대를 확인하는 자료가 됩니다.`);
    }
    const feeds = activity?.feeds;
    const feedAge = feedDays(feeds, nowMs);
    if (feeds && !industry.feed && (feeds.count === 0 || (feedAge !== null && feedAge > 30))) {
        add('feed', 'mid', feeds.count === 0 ? '소식 첫 글 올리기' : `소식 ${feedAge}일째 없음`,
            `${feeds.latestTitle ? `마지막 소식은 "${feeds.latestTitle}"입니다. ` : ''}${feedAdvice(place)}`);
    }
    const blog = activity?.blog;
    if (blog && blog.total !== null && blog.last30 === 0) {
        const since = daysAgo(blog.latest, nowMs);
        add('blog', 'mid', '최근 30일 블로그 리뷰 없음',
            `${since !== null && since >= 30 ? `마지막 블로그 리뷰가 ${since}일 전입니다. ` : ''}체험단·방문 후기 이벤트로 블로그 리뷰가 꾸준히 쌓이게 해 보세요.`);
    }
    if (activity?.coupons && activity.coupons.total === 0 && !industry.coupon) {
        add('coupon', 'low', '쿠폰 없음', '첫 방문 쿠폰이나 결제 혜택을 등록하면 손님이 매장 화면에서 쿠폰을 확인할 수 있습니다.');
    }
    if (detail.hasBooking === false && !industry.booking && (detail.tools || []).some((tool) => tool.type === 'naverBooking' && !tool.using)) {
        add('booking', 'low', '네이버 예약 미사용', '네이버 예약을 연결하면 손님이 매장 화면에서 바로 예약할 수 있습니다.');
    }
    if (place.missing?.accessor) {
        add('accessor', 'low', '찾아오는 길 안내 없음', '주차 위치·가까운 정류장·건물 입구를 적어 두면 처음 오는 손님이 길을 찾기 쉽습니다. 스마트플레이스 > 업체정보 > 찾아오는 길에서 씁니다.');
    }
    if (place.missing?.conveniences) {
        add('conveniences', 'low', '편의시설 정보 없음', '주차·포장·예약·단체석처럼 해당하는 항목을 체크하세요. 손님이 조건으로 매장을 찾을 때 볼 수 있는 정보입니다.');
    }
    if (place.hasTalktalk === false) add('talktalk', 'low', '톡톡 미연결', '손님이 바로 문의할 수 있도록 네이버 톡톡을 연결하세요.');

    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => LEVEL_ORDER[a.item.level] - LEVEL_ORDER[b.item.level] || a.index - b.index)
        .map((entry) => entry.item);
}

// rich=true 면 확장 쿼리로 받은 공개 신호(사진 수·예약/주문·쿠폰·멤버십·페이·영업상태)도 함께 정리합니다.
// 확장 쿼리를 안 쓴 항목은 해당 필드가 없어 모두 null 이 되고, 진단에서는 "확인 불가"로 다룹니다.
export function normalizeListItem(item, rank, targetId, { rich = false } = {}) {
    const placeId = String(item?.id ?? '');
    const row = {
        rank,
        placeId,
        name: String(item?.name || '').trim(),
        category: String(item?.category || '').trim(),
        visitorReviews: parseCount(item?.visitorReviewCount),
        blogReviews: parseCount(item?.blogCafeReviewCount),
        score: toScore(item?.visitorReviewScore),
        // 저장 수는 네이버가 "~100", "2,000+" 같은 구간으로만 내려 줍니다. 받은 글자 그대로 보여 줍니다.
        saveText: item?.saveCount ? String(item.saveCount) : null,
        isNew: Boolean(item?.newOpening),
        isTarget: placeId !== '' && placeId === String(targetId),
    };
    if (!rich) return row;

    const order = item?.naverOrder || null;
    const hasOrder = order ? Boolean(order.isDelivery || order.isTableOrder || order.isPreOrder || order.isPickup) : null;
    const couponTotal = Number(item?.coupon?.total);
    const bookingText = String(item?.naverBookingCategory || '').trim();
    return {
        ...row,
        imageCount: Number.isFinite(Number(item?.imageCount)) && item?.imageCount !== null ? Number(item.imageCount) : null,
        bookingReviews: parseCount(item?.bookingReviewCount),
        promotionTitle: String(item?.promotionTitle || '').trim() || null,
        hoursStatus: String(item?.newBusinessHours?.status || '').trim() || null,
        couponCount: Number.isFinite(couponTotal) ? couponTotal : null,
        // 예약/주문/멤버십/페이/POS 운영 여부. 확장 쿼리가 없으면(undefined) null = "확인 불가".
        hasBooking: item?.hasBooking === undefined && item?.naverBookingCategory === undefined
            ? null
            : Boolean(item?.hasBooking) || Boolean(bookingText),
        hasOrder,
        hasMembership: item?.membershipBenefit === undefined ? null : Boolean(item?.membershipBenefit?.benefitName),
        hasNPay: item?.hasNPay === undefined && item?.nPayConnect === undefined
            ? null
            : Boolean(item?.hasNPay) || Boolean(item?.nPayConnect?.benefitText),
        hasPos: item?.posInfo === undefined ? null : Boolean(item?.posInfo?.isPOS),
        // 좌표(x=경도, y=위도)와 행정구역("충북 청주시 청원구 오창읍"). 내 매장과의 거리 계산에 씁니다.
        x: toCoord(item?.x),
        y: toCoord(item?.y),
        area: String(item?.commonAddress || '').trim() || null,
    };
}

function toCoord(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

// 두 좌표(x=경도, y=위도) 사이의 직선 거리(km). 좌표가 없으면 null.
export function distanceKm(a, b) {
    const ax = toCoord(a?.x);
    const ay = toCoord(a?.y);
    const bx = toCoord(b?.x);
    const by = toCoord(b?.y);
    if (ax === null || ay === null || bx === null || by === null) return null;
    const rad = Math.PI / 180;
    const dLat = (by - ay) * rad;
    const dLon = (bx - ax) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(ay * rad) * Math.cos(by * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const LOCAL_KM = 5;
export const FAR_KM = 30;

// 순위 결과의 상위 매장들이 내 매장에서 얼마나 떨어져 있는지로 "어느 범위의 검색 결과인지" 가립니다.
//   local: 동네(중간 거리 5km 이하) / area: 시·구 단위 / far: 내 지역 결과가 아님(30km 초과) / null: 좌표가 부족해 확인 불가
// region 은 네이버가 키워드에서 인식한 지역 이름(없으면 null)입니다.
export function rankLocality(result, coordinate) {
    const region = String(result?.region || '').trim() || null;
    const distances = (result?.top || [])
        .filter((row) => row && !row.isTarget)
        .map((row) => distanceKm(coordinate, row))
        .filter((km) => km !== null);
    if (distances.length < 3) return { scope: null, medianKm: null, within1km: null, count: distances.length, region };
    const medianKm = median(distances);
    return {
        scope: medianKm > FAR_KM ? 'far' : medianKm > LOCAL_KM ? 'area' : 'local',
        medianKm: Math.round(medianKm * 10) / 10,
        within1km: distances.filter((km) => km <= 1).length,
        count: distances.length,
        region,
    };
}

export function median(values) {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 상위 매장들의 리뷰 수 중간값(내 매장 제외)
export function summarizeTop(top) {
    const others = top.filter((row) => !row.isTarget);
    return {
        count: others.length,
        visitorReviewsMedian: median(others.map((row) => row.visitorReviews)),
        blogReviewsMedian: median(others.map((row) => row.blogReviews)),
    };
}

function numStat(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    return nums.length ? { median: median(nums), best: Math.max(...nums) } : { median: null, best: null };
}

// 참/거짓/null(확인 불가) 값 목록에서 "운영 중인 곳 수"와 "확인된 곳 수"를 셉니다.
function featureStat(values) {
    const known = values.filter((v) => v === true || v === false);
    return { have: known.filter((v) => v === true).length, known: known.length };
}

// 상위 매장(내 매장 제외)의 공개 신호 분포. getRank 가 1페이지(상위 100곳)로 계산합니다.
// 추가 네트워크 요청 없이, 이미 받은 목록 응답만으로 만듭니다.
export function topSignals(rows) {
    const others = (rows || []).filter((row) => row && !row.isTarget);
    return {
        count: others.length,
        visitorReviews: numStat(others.map((row) => row.visitorReviews)),
        blogReviews: numStat(others.map((row) => row.blogReviews)),
        score: numStat(others.map((row) => row.score)),
        images: numStat(others.map((row) => row.imageCount)),
        save: numStat(others.map((row) => parseCount(row.saveText))),
        features: {
            booking: featureStat(others.map((row) => row.hasBooking)),
            order: featureStat(others.map((row) => row.hasOrder)),
            coupon: featureStat(others.map((row) => (row.couponCount === null || row.couponCount === undefined ? null : row.couponCount > 0))),
            membership: featureStat(others.map((row) => row.hasMembership)),
            npay: featureStat(others.map((row) => row.hasNPay)),
            pos: featureStat(others.map((row) => row.hasPos)),
        },
    };
}

// 평점은 폭이 좁아 비율 대신 절대 차이로, 나머지는 중간값 대비 비율로 우열을 가립니다.
function verdictOf(key, mine, stat) {
    if (!Number.isFinite(mine) || stat.median === null) return null;
    if (key === 'score') {
        if (mine >= stat.median) return 'ahead';
        return stat.median - mine <= 0.2 ? 'near' : 'behind';
    }
    if (stat.median <= 0) return mine > 0 ? 'ahead' : 'near';
    const ratio = mine / stat.median;
    if (ratio >= 1) return 'ahead';
    return ratio >= 0.7 ? 'near' : 'behind';
}

// 내 매장(mine) vs 상위 매장 분포(topSignals 결과)를 비교해 "부족한 신호"를 짚어 줍니다. 순수 함수.
//   signals(숫자): 방문자리뷰·블로그리뷰·평점·사진수·저장(구간)
//   features(운영여부): 예약·주문/배달·쿠폰·멤버십·네이버페이·POS 인기메뉴
export function diagnoseRank(mine, signals) {
    if (!signals || signals.count === 0) return null;
    const m = mine || {};
    const SIGNALS = [
        { key: 'visitorReviews', label: '방문자 리뷰', unit: '개', stat: signals.visitorReviews, mine: m.visitorReviews },
        { key: 'blogReviews', label: '블로그·카페 리뷰', unit: '개', stat: signals.blogReviews, mine: m.blogReviews },
        { key: 'score', label: '평점', unit: '점', stat: signals.score, mine: m.score },
        { key: 'images', label: '매장 사진', unit: '장', stat: signals.images, mine: m.imageCount },
        { key: 'save', label: '저장(구간 추정)', unit: '회', stat: signals.save, mine: m.saveCount },
    ];
    const rows = [];
    for (const s of SIGNALS) {
        if (s.stat.median === null) continue; // 상위 분포에 값이 없으면 생략
        rows.push({
            key: s.key,
            label: s.label,
            unit: s.unit,
            mine: Number.isFinite(s.mine) ? s.mine : null,
            median: s.stat.median,
            best: s.stat.best,
            verdict: verdictOf(s.key, s.mine, s.stat),
        });
    }
    const FEATURES = [
        { key: 'booking', label: '예약', f: signals.features.booking, mine: m.hasBooking },
        { key: 'order', label: '주문·배달', f: signals.features.order, mine: m.hasOrder },
        { key: 'coupon', label: '쿠폰', f: signals.features.coupon, mine: m.hasCoupon },
        { key: 'membership', label: '멤버십 혜택', f: signals.features.membership, mine: m.hasMembership },
        { key: 'npay', label: '네이버페이 혜택', f: signals.features.npay, mine: m.hasNPay },
        { key: 'pos', label: '주간 인기메뉴(POS)', f: signals.features.pos, mine: m.hasPos },
    ];
    const features = [];
    for (const feat of FEATURES) {
        if (!feat.f || feat.f.known === 0) continue; // 확장 신호를 못 받았으면 생략
        features.push({
            key: feat.key,
            label: feat.label,
            have: feat.f.have,
            known: feat.f.known,
            mine: feat.mine === true || feat.mine === false ? feat.mine : null,
        });
    }
    // 내 매장이 뒤처진 항목 수(코칭 메시지용)
    const behind = rows.filter((row) => row.verdict === 'behind').length;
    return { count: signals.count, signals: rows, features, behind };
}

function normalizeKeyword(word) {
    return String(word || '').replace(/\s+/g, '').toLowerCase();
}

// 상위 매장들이 등록한 대표키워드를 모아 많이 쓰인 순으로 정리하고, 내 매장에 없는 것을 표시합니다.
export function keywordFrequency(myKeywords, competitors) {
    const mine = new Set((myKeywords || []).map(normalizeKeyword));
    const counts = new Map();
    for (const competitor of competitors || []) {
        const seen = new Set();
        for (const word of competitor.keywords || []) {
            const key = normalizeKeyword(word);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const entry = counts.get(key) || { keyword: String(word).trim(), count: 0 };
            entry.count += 1;
            counts.set(key, entry);
        }
    }
    return [...counts.entries()]
        .map(([key, entry]) => ({ ...entry, mine: mine.has(key) }))
        .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, 'ko'));
}

function isNaverHost(hostname) {
    const host = String(hostname).toLowerCase();
    return host === 'naver.me' || host === 'naver.com' || host.endsWith('.naver.com');
}

export function createPlaceClient({
    gate,
    fetchImpl = fetch,
    confirmDelayMs = CONFIRM_DELAY_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
}) {
    // 요청 1건을 줄 세워 보내고, 거절·오류를 한 가지 형식으로 정리합니다.
    function send(url, init) {
        return gate.run(async () => {
            let response;
            try {
                response = await fetchImpl(url, {
                    ...init,
                    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(init?.headers || {}) },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
            } catch (error) {
                const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
                throw new PlaceLookupError(timedOut ? 'TIMEOUT' : 'UPSTREAM', '네이버에 연결하지 못했습니다.');
            }
            if ([403, 418, 429].includes(response.status)) {
                // 거절당하면 우회하지 않고 일정 시간 조회를 멈춥니다.
                const retryAt = gate.trip(`HTTP ${response.status}`);
                throw new PlaceLookupError('BLOCKED', '네이버가 조회를 제한했습니다.', { retryAt });
            }
            return response;
        });
    }

    // allowPartial: 묶음 요청은 쿼리 하나만 형식 검증에 걸려도 400 이 오지만 본문에는 나머지 결과가 들어 있어,
    // 배열 본문이면 그대로 돌려줍니다(쿼리 하나가 바뀌었다고 활동 전체를 잃지 않게).
    async function postGraphql(body, referer, { allowPartial = false } = {}) {
        const response = await send(GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Origin: 'https://m.place.naver.com',
                Referer: referer,
            },
            body: JSON.stringify(body),
        });
        const partial = allowPartial && response.status === 400;
        if (response.status !== 200 && !partial) {
            throw new PlaceLookupError(response.status === 400 ? 'CHANGED' : 'UPSTREAM', `네이버 응답 오류(${response.status})`);
        }
        let json;
        try {
            json = await response.json();
        } catch {
            throw new PlaceLookupError('CHANGED', '네이버 응답 형식이 바뀌었습니다.');
        }
        if (partial && !Array.isArray(json)) throw new PlaceLookupError('CHANGED', '네이버 응답 오류(400)');
        return json;
    }

    async function graphql(body, referer) {
        const json = await postGraphql(body, referer);
        if (!json?.data || (Array.isArray(json.errors) && json.errors.length > 0)) {
            throw new PlaceLookupError('CHANGED', '네이버 응답 형식이 바뀌었습니다.');
        }
        gate.succeed();
        return json.data;
    }

    // 여러 쿼리를 배열 한 건으로 보냅니다. 쿼리별로 실패하면 그 자리는 null 로 돌려줍니다.
    async function graphqlBatch(bodies, referer) {
        const json = await postGraphql(bodies, referer, { allowPartial: true });
        if (!Array.isArray(json) || json.length !== bodies.length) {
            throw new PlaceLookupError('CHANGED', '네이버 응답 형식이 바뀌었습니다.');
        }
        const parts = json.map((part) => (part?.data && !(Array.isArray(part.errors) && part.errors.length > 0) ? part.data : null));
        if (parts.every((part) => part === null)) throw new PlaceLookupError('CHANGED', '네이버 응답 형식이 바뀌었습니다.');
        gate.succeed();
        return parts;
    }

    // naver.me 공유 주소 → 플레이스 ID. 네이버 주소로만 따라가고 최대 4번까지만 이동합니다.
    async function resolveShortUrl(shortUrl) {
        const { value } = await gate.cached(`short:${shortUrl}`, CACHE_TTL.shortUrl, async () => {
            let url = shortUrl;
            for (let hop = 0; hop < 4; hop += 1) {
                const response = await send(url, { method: 'GET', redirect: 'manual' });
                const location = response.headers.get('location');
                if (response.status < 300 || response.status >= 400 || !location) break;
                const next = new URL(location, url);
                if (next.protocol !== 'https:' || !isNaverHost(next.hostname)) break;
                const found = placeIdFromUrl(next);
                if (found) return found;
                url = next.toString();
            }
            throw badInput('공유 주소에서 플레이스를 찾지 못했습니다. 매장 화면의 주소나 숫자 ID를 넣어주세요.');
        });
        return value;
    }

    async function resolveInput(value) {
        const parsed = parsePlaceInput(value);
        return parsed.placeId || resolveShortUrl(parsed.shortUrl);
    }

    // 화면에 보이지 않는 대표키워드
    function getKeywords(placeId) {
        return gate.cached(`keywords:${placeId}`, CACHE_TTL.keywords, async () => {
            const data = await graphql(buildKeywordBody(placeId), placeHomeUrl(placeId));
            const business = data.business;
            if (!business?.base) throw new PlaceLookupError('NOT_FOUND', '플레이스를 찾지 못했습니다.');
            const keywords = business.informationTab?.keywordList;
            return {
                placeId: String(placeId),
                name: String(business.base.name || '').trim(),
                keywords: Array.isArray(keywords) ? keywords.map((k) => String(k).trim()).filter(Boolean) : [],
            };
        });
    }

    // 매장 요약 + 대표키워드
    function getPlace(placeId) {
        return gate.cached(`place:${placeId}`, CACHE_TTL.place, async () => {
            const response = await send(placeHomeUrl(placeId), { method: 'GET', headers: { Accept: 'text/html' } });
            if (response.status === 404) throw new PlaceLookupError('NOT_FOUND', '플레이스를 찾지 못했습니다.');
            if (response.status !== 200) throw new PlaceLookupError('UPSTREAM', `네이버 응답 오류(${response.status})`);
            const html = await response.text();
            if (html.length > MAX_HTML_LENGTH) throw new PlaceLookupError('CHANGED', '네이버 응답이 예상보다 큽니다.');

            const apollo = parseApolloState(html);
            if (!apollo) throw new PlaceLookupError('CHANGED', '네이버 화면 구성이 바뀌어 정보를 읽지 못했습니다.');
            const snapshot = extractSnapshot(apollo, placeId);
            if (!snapshot || !snapshot.name) throw new PlaceLookupError('NOT_FOUND', '플레이스를 찾지 못했습니다.');
            gate.succeed();

            // 대표키워드는 매장 화면 응답(정보 탭)에 들어 있으면 그대로 씁니다(2026-11-15 음식점·미용실·교육원 모두 포함).
            // 없을 때만 따로 조회하고, 여기서만 실패하면 나머지 정보는 그대로 보여 줍니다.
            const { keywords: inlineKeywords = null, ...detail } = extractDetail(apollo) || {};
            let keywords = inlineKeywords;
            if (keywords === null) {
                try {
                    keywords = (await getKeywords(placeId)).value.keywords;
                } catch (error) {
                    if (error?.code === 'BLOCKED' || error?.code === 'PAUSED' || error?.code === 'DAILY_LIMIT') throw error;
                }
            }
            return { ...snapshot, keywords, detail: Object.keys(detail).length ? detail : null };
        });
    }

    // 리뷰·소식 활동(최근 방문자 리뷰 50개, 블로그 리뷰 30개, 소식, 쿠폰, AI 브리핑)을 묶음 요청 1건으로 받습니다.
    // mentionTerms 를 주면 같은 요청에 낱말별 블로그 언급 수 조회를 함께 실어 보냅니다(요청 수는 그대로 1건).
    function getActivity(placeId, { mentionTerms = [] } = {}) {
        const terms = cleanMentionTerms(mentionTerms);
        const key = terms.length ? `activity:${placeId}:${terms.join('|')}` : `activity:${placeId}`;
        return gate.cached(key, CACHE_TTL.activity, async () => {
            const parts = await graphqlBatch(buildActivityBatch(placeId, terms), placeHomeUrl(placeId));
            return summarizeActivity(parts, now(), terms);
        });
    }

    // 1페이지(상위 100곳)는 확장 쿼리로 공개 신호를 더 받습니다. 네이버가 확장 필드를 거절하면(400)
    // 이 세션 동안 기본 쿼리로 강등해 다시 시도하므로, 라이브로 확인하지 못한 확장 필드 때문에 순위 조회가 깨지지 않습니다.
    let listFieldMode = 'rich';

    // 빈 쪽은 믿을 수 없어 저장하지 않습니다(getRank 가 확인한 뒤에만 저장).
    function getListPage(keyword, start, { refresh = false } = {}) {
        const referer = `https://m.place.naver.com/place/list?query=${encodeURIComponent(keyword)}`;
        return gate.cached(`list:${keyword}:${start}`, CACHE_TTL.list, async () => {
            let data;
            let rich = false;
            if (start === 1 && listFieldMode === 'rich') {
                try {
                    data = await graphql(buildListBody(keyword, start, LIST_QUERY_RICH), referer);
                    rich = true;
                } catch (error) {
                    // 확장 필드 거절(CHANGED=400)만 강등 대상. 차단·시간초과 등은 그대로 올립니다.
                    if (error?.code !== 'CHANGED') throw error;
                    listFieldMode = 'minimal';
                }
            }
            if (!rich) {
                data = await graphql(buildListBody(keyword, start, LIST_QUERY), referer);
            }
            const businesses = data.result?.businesses;
            if (!businesses) throw new PlaceLookupError('CHANGED', '네이버 응답 형식이 바뀌었습니다.');
            return {
                total: Number.isFinite(businesses.total) ? businesses.total : null,
                items: Array.isArray(businesses.items) ? businesses.items : [],
                rich,
                // 네이버가 키워드에서 인식한 지역("청주약국" → "청주"). 확장 쿼리가 아니거나 인식하지 못하면 null.
                region: String(businesses.nlu?.queryResult?.region || '').trim() || null,
            };
        }, { refresh, keep: (page) => page.items.length > 0 });
    }

    // 빈 쪽을 받았을 때: 잠깐 쉬고 다시 받아 보고, 그래도 비어 있으면 첫 쪽을 새로 받아
    // 네이버가 정상 응답 중인지 확인합니다. 첫 쪽마저 비면 결과를 내지 않고 조회를 멈춥니다.
    async function confirmEmptyPage(keyword, start) {
        await sleep(confirmDelayMs);
        const again = await getListPage(keyword, start, { refresh: true });
        if (again.value.items.length > 0 || start === 1) return again;

        const first = await getListPage(keyword, 1, { refresh: true });
        if (first.value.items.length === 0) {
            const retryAt = gate.trip('빈 응답 반복');
            throw new PlaceLookupError('BLOCKED', '네이버가 조회를 제한했습니다.', { retryAt });
        }
        // 목록이 여기서 끝난 것이 확인됐으므로 저장해 둡니다.
        gate.remember(`list:${keyword}:${start}`, CACHE_TTL.list, again.value);
        return again;
    }

    // 키워드 목록에서 내 매장이 몇 번째인지 찾습니다. 찾으면 거기서 멈춥니다.
    async function getRank({ keyword, placeId, depth = DEFAULT_DEPTH }) {
        const maxRank = Math.max(PAGE_SIZE, Math.min(depth, MAX_RANK));
        let total = null;
        let top = [];
        let pageOne = []; // 1페이지(상위 100곳) 전체 — 순위 진단(topSignals)에 씁니다.
        let target = null;
        let scanned = 0;
        let exhausted = false;
        let fetchedAt = null;
        let region = null;

        for (let start = 1; start <= maxRank; start += PAGE_SIZE) {
            let page = await getListPage(keyword, start);
            // 저장돼 있던 빈 쪽은 이미 확인을 거친 것이라 다시 확인하지 않습니다.
            if (page.value.items.length === 0 && !page.cached) {
                page = await confirmEmptyPage(keyword, start);
            }
            fetchedAt = fetchedAt === null ? page.fetchedAt : Math.min(fetchedAt, page.fetchedAt);
            if (start === 1) {
                total = page.value.total;
                region = page.value.region || null;
            }

            // 1페이지는 확장 신호(사진·예약·쿠폰 등)까지 정리하고, 2페이지 이후는 순위 매칭만 하면 돼 최소 필드만 봅니다.
            const rich = start === 1 && page.value.rich === true;
            const rows = page.value.items.map((item, index) => normalizeListItem(item, start + index, placeId, { rich }));
            if (start === 1) {
                pageOne = rows;
                top = rows.slice(0, TOP_COUNT);
            }
            scanned += rows.length;

            target = rows.find((row) => row.isTarget) || null;
            if (target) break;
            if (rows.length < PAGE_SIZE) {
                exhausted = true;
                break;
            }
        }

        return {
            keyword,
            placeId: String(placeId),
            // found: 순위 확인 / beyond: 살펴본 범위 안에 없음 / not_listed: 목록 끝까지 봤지만 없음
            status: target ? 'found' : exhausted ? 'not_listed' : 'beyond',
            rank: target ? target.rank : null,
            total,
            scanned,
            target,
            top,
            topSummary: summarizeTop(top),
            // 상위 100곳(내 매장 제외)의 신호 분포 — 추가 요청 없이 1페이지 응답만으로 계산합니다.
            topSignals: topSignals(pageOne),
            // 네이버가 이 키워드에서 인식한 지역 이름(없으면 null)
            region,
            fetchedAt,
        };
    }

    return { resolveInput, getPlace, getActivity, getKeywords, getRank };
}
