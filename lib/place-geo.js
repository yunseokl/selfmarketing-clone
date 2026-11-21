// GEO·AEO(AI 검색 최적화) 진단 — 플레이스 분석 결과만으로 계산하는 순수 함수 모음.
//
// GEO(Generative Engine Optimization): AI 답변의 "추천 목록"에 매장이 들어갈 재료가 있는지.
// AEO(Answer Engine Optimization): "주차 돼요?", "몇 시까지 해요?" 같은 질문에 AI가 바로 답할 재료가 있는지.
// 기준은 2026-11 GEO·AEO 자료 정리에서 정당한 방법만 골라 옮겼습니다.
// 리뷰·클릭 조작, 클로킹, 숨김 글, 허위 평점 스키마 같은 기법은 넣지 않고 GEO_DONTS 에 "하지 말 것"으로만 남겼습니다.
// 반영 시간·AI별 읽는 곳처럼 공식 자료로 확인되지 않은 값은 화면에 "어림값"·"공식 확인은 아님"으로 적습니다.
// 네이버·AI 회사는 가중치를 공개하지 않으므로 점수는 혼잘마 자체 점검 기준이며 노출·순위를 보장하지 않습니다.
// 네트워크 요청 없이 이미 받은 매장 정보(getPlace)·활동(getActivity)·순위 결과(getRank)만 씁니다.
//
// 세 가지를 나눠 봅니다(작업 시간과 반영 시간, 준비와 결과를 섞지 않습니다):
//  ① 재료 점수(scoreGeo·scoreAeo) — 매장 정보가 AI가 쓸 만큼 갖춰졌는지
//  ② 통로(externalSteps·platformProgress) — AI마다 다른 출처에 그 정보가 올라가 있는지(사장님이 직접 체크)
//  ③ 결과(shareOfModel) — AI에 실제로 물었을 때 몇 번째로 추천되는지(사장님이 직접 재서 기록)

import { parseCount, parseNaverDate, daysAgo, placeHomeUrl, feedDays } from './naver-place.js';
import { familyOf, searchCategoryWord, headlineMenuTerms } from './place-keywords.js';
import { healthKind, notApplicableOf } from './place-industry.js';

// 짧은 답변 글(한 문단 답변)의 알맞은 길이(공백 포함 110~155자)
export const ATOMIC_MIN = 110;
export const ATOMIC_MAX = 155;

// AI 답변 점유율(AI 답변에 우리 가게가 나온 비율) 점수표: 추천 1위 100 · 2위 75 · 3위 55 · 4위 35 · 5위 20 · 목록 밖 단순 언급 15 · 안 나옴 0(혼잘마가 정한 표).
// 두 곳에 씁니다. ① AI 답변 실측(shareOfModel): 사장님이 AI에 직접 물어 본 순위. 추천 목록의 6번째 이후는 "단순 언급"과 같은 15점입니다
//    (6~10번째를 5위로 올려 20점을 주지 않고, 점수표의 "5위 20 · 그 밖 15"와 ②에 맞췄습니다).
// ② 검색 노출 점유율(searchShare): 같은 점수표를 네이버 플레이스 검색 순위에 옮긴 값으로, 6~10위(첫 화면 목록 안)를 "단순 언급"으로 봅니다.
//    검색 순위는 AI 답변이 아니므로 둘을 섞지 않습니다.
export const SHARE_WEIGHTS = { 1: 100, 2: 75, 3: 55, 4: 35, 5: 20 };
export const SHARE_LISTED_POINTS = 15;
export const SHARE_LISTED_MAX_RANK = 10;
export const SOM_MENTION = 'mention';
export const SOM_NONE = 'none';

// 답글률은 최근 리뷰가 이만큼은 있어야 점수에 넣습니다.
const REPLY_MIN_SAMPLE = 5;
export const REPLY_TARGET = 80;

export const HYPE_WORDS = [
    '최고', '최상', '최강', '압도적', '완벽', '유일', '1위', '1등', '넘버원', 'no.1', '최저가',
    '무조건', '대박', '역대급', '끝판왕', '국내최초', '세계최초', '독보적', '레전드', '극강',
];

// AI마다 정보를 가져가는 통로가 다릅니다.
// fastest: 그 AI에 가장 빨리 닿는 길 · filter: 그 AI가 고르는 글의 특징 · claim: 일을 끝낸 뒤 AI 답변에 반영되기까지의 시간.
// 모두 공식 자료로 확인된 값이 아니라 어림이며 실측·보장된 값이 아닙니다(화면에도 "어림값"·"공식 확인은 아님"으로 적습니다).
// channelWeight: 종합 준비도에서 외부 통로(사장님이 직접 체크하는 일)가 차지하는 비중. 네이버는 플레이스 자체가 통로라 낮습니다.
export const PLATFORMS = [
    {
        key: 'naver', label: '네이버 AI 브리핑', short: '네이버 AI',
        source: '플레이스 정보·리뷰·소식·블로그·카페(네이버 안 정보)',
        fastest: '네이버 안에서 바로 고칠 수 있어 가장 빨리 손댈 수 있습니다. 오늘 플레이스 빈칸·소식·리뷰 답글을 채우고, 검색 1페이지에 이미 떠 있는 블로그·카페 글의 매장 정보를 운영자와 맞추세요.',
        filter: '질문과 같은 말로 시작하는 두괄식 첫 문단, 손님이 직접 쓴 리뷰 문장',
        claim: '3~24시간',
        channelWeight: 0.2,
    },
    {
        key: 'chatgpt', label: 'ChatGPT 검색', short: 'ChatGPT',
        source: 'Bing 검색·Bing Places·뉴스·웹 문서',
        fastest: 'ChatGPT 검색은 네이버 지도를 읽지 못하고 Bing(마이크로소프트 검색) 정보를 많이 참고하는 것으로 보입니다(공식 확인은 아님). 오늘 Bing Places(Bing에 매장을 올리는 무료 서비스)에 등록하세요. 홈페이지가 있다면 그 주소도 Bing 웹마스터 도구에 제출합니다.',
        filter: '이유와 결론이 한 문장에 붙은 사실 문장(예: "역 도보 3분이고 주차가 돼 모임에 맞다"), Bing에 잡힌 글',
        claim: '2~12시간',
        channelWeight: 0.5,
    },
    {
        key: 'gemini', label: 'Gemini·구글 AI 개요', short: 'Gemini',
        source: '구글 검색·구글 비즈니스 프로필(지도)·구글 리뷰·유튜브',
        fastest: '구글 비즈니스 프로필(구글 지도)이 출발점입니다. 인증에 며칠 이상 걸릴 수 있어 오늘 신청하고, 이미 운영하는 유튜브 채널이 있으면 매장 소개 쇼츠부터 올리세요.',
        filter: '구글 지도 정보·리뷰 문장, 유튜브 제목·설명란·자막에 적힌 사실',
        claim: '1~12시간(활동 중인 유튜브 채널 기준)',
        channelWeight: 0.5,
    },
    {
        key: 'claude', label: 'Claude', short: 'Claude',
        source: 'Brave 검색에 잡힌 문서(답할 때 그 글을 다시 읽음)',
        fastest: 'Claude는 답할 때 Brave 검색에 잡힌 글을 다시 읽는 것으로 보여(공식 확인은 아님), 이미 검색에 잡힌 글의 매장 정보를 고치는 것이 가장 빠를 것으로 봅니다. 새 글은 광고 문구 없이 표와 사실만 담으세요.',
        filter: '광고성 수식어 0개, 표로 정리된 건조한 사실(위치·시간·가격)',
        claim: '이미 잡힌 글 수정은 즉시~24시간 · 새 글은 12~48시간',
        channelWeight: 0.5,
    },
    {
        key: 'perplexity', label: 'Perplexity', short: 'Perplexity',
        source: '자체 수집 + 여러 검색엔진의 최신 비교 글·표',
        fastest: 'Perplexity는 최근에 쓰이거나 고쳐진 글, 글 맨 위 2~3줄 요약, 표를 그대로 인용하는 편으로 보입니다(공식 확인은 아님). 질문형 제목 + 요약 + 표로 된 글 1개를 먼저 만드세요.',
        filter: '최근 수정일·연도 표기, 글 맨 위 2~3줄 요약, 표',
        claim: '수일',
        channelWeight: 0.5,
    },
];

// 각 AI의 재료 점수에 들어가는 항목(항목에 붙는 AI 표시도 이 표에서 만듭니다).
// 구글·Bing 등록처럼 매장 정보로 확인할 수 없는 일은 점수 대신 로드맵에서 직접 체크하고, platformProgress 가 둘을 합칩니다.
const PLATFORM_FACTORS = {
    naver: ['entity', 'structured', 'reviews', 'sources', 'freshness', 'naverAi', 'keywords', 'qna', 'competition', 'atomic', 'fanout'],
    chatgpt: ['entity', 'structured', 'sameAs', 'tone', 'fanout', 'multiturn', 'sources'],
    gemini: ['entity', 'structured', 'atomic', 'sameAs', 'reviews', 'fanout', 'multiturn'],
    claude: ['entity', 'tone', 'structured', 'atomic', 'sources', 'sameAs'],
    perplexity: ['entity', 'structured', 'atomic', 'fanout', 'tone', 'sources', 'freshness'],
};

const FACTOR_PLATFORMS = {};
for (const [platform, keys] of Object.entries(PLATFORM_FACTORS)) {
    for (const key of keys) FACTOR_PLATFORMS[key] = [...(FACTOR_PLATFORMS[key] || []), platform];
}

// 화면의 탭 이름. 본문 안내가 "○○ 탭"이라고 가리킬 때 같은 이름을 쓰도록 한곳에 둡니다(GeoSections 의 탭 글자도 여기서 읽습니다).
export const GEO_TAB_LABELS = {
    today: '오늘 할 일',
    measure: 'AI에 물어보기',
    diagnosis: '진단',
    roadmap: '단계별 계획',
    drafts: '복사해 쓸 글',
    rivals: '경쟁 비교',
};

function tab(key) {
    return `"${GEO_TAB_LABELS[key]}" 탭`;
}

// 업종 때문에 점수에서 뺀 항목의 이름표. 이름표는 이유(place-industry.js)와 같은 세기로 씁니다:
// 약국의 네이버 예약은 "쓸 수 있는지 확인되지 않아" 뺀 것이라 '해당 없음'이라고 단정하지 않습니다.
export const NOT_APPLICABLE_TAG = '해당 없음';
export const UNVERIFIED_TAG = '확인 안 됨(점수에서 뺌)';

export function notApplicableTag(key) {
    return key === 'booking' ? UNVERIFIED_TAG : NOT_APPLICABLE_TAG;
}

// 홈페이지가 있어야 하는 기술 작업(로봇 출입 안내 파일·구조화 데이터·검색 도구 등록)은 이 머리말 아래로 모읍니다.
export const SITE_WORK_TITLE = '홈페이지가 있는 가게만';
export const SITE_WORK_NOTE = '홈페이지를 만든 분(개발자)에게 그대로 전달하세요';
export const SITE_WORK_HEADER = `${SITE_WORK_TITLE} — ${SITE_WORK_NOTE}`;

const FOOD_FAMILIES = ['restaurant', 'cafe', 'bar'];
const BEAUTY_FAMILIES = ['hair', 'nail', 'skin'];

// 가게를 한마디로 설명하는 자리(한 줄 소개·질문·제목·소개글 첫 문단)에 쓸 대표 메뉴 낱말.
// 키워드 추천이 이 매장의 대표가 아니라고 뺀 낱말(예: 횟집의 김밥)은 쓰지 않습니다(place-keywords.js 의 headlineMenuTerms).
// 소식·보도자료 본문·메뉴표처럼 메뉴를 사실로 적는 자리는 이 함수가 아니라 원래 메뉴 목록(reviewMenus·topMenuNames)을 그대로 씁니다.
// 같은 분석 안에서 여러 번 부르므로 (매장 객체, 활동 객체)마다 한 번만 계산합니다.
const headlineCache = new WeakMap();

export function headlineMenus(place, activity = null, limit = 2) {
    if (!place || typeof place !== 'object') return [];
    let entry = headlineCache.get(place);
    if (!entry || entry.activity !== activity) {
        entry = { activity, terms: headlineMenuTerms(place, activity, { limit: 8 }) };
        headlineCache.set(place, entry);
    }
    return entry.terms.slice(0, Math.max(0, limit));
}

// 새로 알릴 것을 그 업종의 말로: 음식점 '새 메뉴', 약국·병의원 '새 취급 품목·서비스', 미용·네일·피부 '새 시술'
export function newItemWord(place) {
    const health = healthWords(place);
    if (health) return `새 ${health.item}`;
    const key = familyOf(place)?.key || null;
    if (BEAUTY_FAMILIES.includes(key)) return '새 시술';
    if (key === null || FOOD_FAMILIES.includes(key)) return '새 메뉴';
    return '새 서비스';
}

// '메뉴' 자리에 들어갈 그 업종의 말: 음식점·카페·술집(업종을 모를 때 포함)은 '메뉴', 약국 '취급 품목·서비스', 병의원·동물병원 '진료 과목·서비스', 미용·네일·피부 '시술', 그 밖은 '서비스'
export function menuWord(place) {
    const health = healthWords(place);
    if (health) return health.item;
    const key = familyOf(place)?.key || null;
    if (BEAUTY_FAMILIES.includes(key)) return '시술';
    if (key === null || FOOD_FAMILIES.includes(key)) return '메뉴';
    return '서비스';
}

// 조사: 앞말의 받침에 맞춰 고릅니다(시술+이/은/을/과/으로, 서비스+가/는/를/와/로).
function particleFor(word, particle) {
    const jong = finalConsonant(word);
    const has = jong !== null && jong !== 0;
    if (particle === '이' || particle === '가') return has ? '이' : '가';
    if (particle === '은' || particle === '는') return has ? '은' : '는';
    if (particle === '을' || particle === '를') return has ? '을' : '를';
    if (particle === '과' || particle === '와') return has ? '과' : '와';
    if (particle === '이랑' || particle === '랑') return has ? '이랑' : '랑';
    return has && jong !== 8 ? '으로' : '로'; // 으로/로
}

// 지켜 두는 말: 스마트플레이스의 '메뉴판'·'메뉴 탭', 구글 화면의 'Q&A' 메뉴처럼 실제 화면 이름이라 업종 말로 바꾸지 않습니다. 따옴표 안의 말(손님 리뷰·메뉴 이름 같은 자료)도 그대로 둡니다.
const KEEP_MENU = ['메뉴판', '메뉴 탭', '메뉴탭', "Q&A' 메뉴", '따라 메뉴가'];

// 문장 안의 '메뉴'를 그 업종의 말로 바꿉니다(음식점은 그대로). 자료(따옴표 안)와 실제 화면 이름은 건드리지 않습니다.
export function fitMenuText(word, text) {
    if (typeof text !== 'string' || word === '메뉴' || !text.includes('메뉴')) return text;
    const kept = [];
    const keep = (match) => `${kept.push(match) - 1}`;
    let out = text;
    for (const phrase of KEEP_MENU) out = out.split(phrase).join(keep(phrase));
    out = out.replace(/[‘'“"][^‘’'“”"\n]{1,40}[’'”"]/g, keep);
    out = out.replace(/메뉴(?:\(서비스\))?(이랑|으로|이|가|은|는|을|를|과|와|랑|로)(?![가-힣])/g, (_, particle) => `${word}${particleFor(word, particle)}`);
    out = out.replace(/메뉴\(서비스\)|메뉴/g, word);
    return out.replace(/(\d+)/g, (_, index) => kept[Number(index)]);
}

// 객체·배열 안의 모든 문장에 fitMenuText 를 적용합니다. skipKeys: 이 이름의 칸은 그대로 둠(복사해 쓰는 초안 본문 'text' 처럼 자료가 섞인 글).
export function fitMenuWords(place, value, skipKeys = []) {
    const word = menuWord(place);
    if (word === '메뉴') return value;
    const walk = (item, key) => {
        if (typeof item === 'string') return skipKeys.includes(key) ? item : fitMenuText(word, item);
        if (Array.isArray(item)) return item.map((entry) => walk(entry, key));
        if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, walk(entry, name)]));
        return item;
    };
    return walk(value, '');
}

// 소식에 올릴 거리: 약국·병의원은 이벤트(경품·할인)를 권하지 않으므로 새 품목·서비스만 적습니다.
export function feedTopicWords(place) {
    return healthWords(place) ? newItemWord(place) : `${newItemWord(place)}·이벤트`;
}

// 가게를 설명하는 자리의 '대표 메뉴'를 그 업종의 말로(약국·병의원은 '대표 취급 품목·서비스')
export function mainItemWord(place) {
    const health = healthWords(place);
    return health ? `대표 ${health.item}` : '대표 메뉴';
}

// 리뷰를 부탁할 때 적는 한 줄: 음식점·카페·술집은 메뉴를, 그 밖의 업종은 이용한 것을 묻습니다.
function reviewAskLine(place) {
    return briefingEligible(place) ? '어떤 메뉴가 어땠는지 한 줄' : '무엇을 이용했고 어땠는지 한 줄';
}

const GENERIC_WORDS = ['가볼만한곳', '잘하는곳', '핫플레이스', '유명한곳', '잘하는', '맛집', '추천', '근처', '주변', '핫플', '인기'];

// ---------------------------------------------------------------------------
// 글자 도우미
// ---------------------------------------------------------------------------

function finalConsonant(word) {
    const ch = String(word || '').trim().slice(-1);
    if (!ch) return null;
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
    // 숫자는 읽는 소리로: 영·일·삼·육·칠·팔은 받침이 있습니다.
    if (/[0-9]/.test(ch)) return '013678'.includes(ch) ? 1 : 0;
    return null;
}

// josa('포뉴', '은', '는') → '포뉴는'. 받침을 알 수 없으면 '은(는)' 형태로 붙입니다.
export function josa(word, withBatchim, withoutBatchim) {
    const text = String(word || '').trim();
    const fc = finalConsonant(text);
    if (fc === null) return `${text}${withBatchim}(${withoutBatchim})`;
    return `${text}${fc === 0 ? withoutBatchim : withBatchim}`;
}

function compact(text) {
    return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function won(value) {
    return `${Number(value).toLocaleString('ko-KR')}원`;
}

function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// 매장 기본 표현
// ---------------------------------------------------------------------------

export function categoryLabel(place) {
    const parts = String(place?.category || '').split(',').map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts.join('·') : '매장';
}

// 손님이 검색하는 말을 적는 자리(AI 질문·소식 제목·답글 안내 초안)에 쓸 업종 낱말. 업종 이름이 "한식"·"해물,생선요리"처럼 뜻이 넓으면
// 그 말로는 어떤 매장인지 가려지지 않으므로(키워드 추천이 뺀 것과 같은 규칙), 이 매장의 중심 낱말(예: 횟집)을 씁니다. 그렇지 않으면 업종 이름 그대로.
// 매장을 설명하는 사실 문구("한식 매장", 업종: …)는 이 함수가 아니라 categoryLabel 을 그대로 씁니다.
export function searchCategory(place) {
    return searchCategoryWord(place) || categoryLabel(place);
}

// 메뉴판·가격표가 없는 업종(약국·병원 계열)의 말. 메뉴·가격 대신 취급 품목·진료 과목과 서비스를 적게 안내합니다(문구만 다르고 점수 계산은 같음).
//   item: 등록해 둘 것의 이름 / examples: 손님이 묻는 말로 적는 예(사실로 확인되는 것만 쓰라고 함께 안내)
const HEALTH_WORDS = {
    pharmacy: { item: '취급 품목·서비스', examples: '영양제·복약지도·약 상담' },
    clinic: { item: '진료 과목·서비스', examples: '진료 과목·검진·예약 방법' },
    pet: { item: '진료 과목·서비스', examples: '진료 과목·검진·예약 방법' },
};

export function healthWords(place) {
    return HEALTH_WORDS[familyOf(place)?.key] || null;
}

// "○○ 추천" 질문에 들어갈 지역: 가까운 역 > 동·읍·면 > 구·군 > 시
export function placeArea(place) {
    const station = String(place?.detail?.subway?.station || '').trim();
    if (station) return station.endsWith('역') ? station : `${station}역`;
    const words = String(place?.address || '').split(/\s+/).filter(Boolean);
    return words.find((w) => w.length >= 2 && /[동읍면]$/.test(w))
        || words.find((w) => w.length >= 2 && /[구군]$/.test(w))
        || words.find((w) => w.length >= 2 && /시$/.test(w))
        || '';
}

export function targetQuestion(place) {
    const area = placeArea(place);
    return `${area ? `${area} ` : ''}${searchCategory(place)} 추천`;
}

// 영업시간 → "매일 11:00~22:00" / "월·화·수 11:00~22:00" / "월·화 11:00~22:00 등 요일별"
export function summarizeHours(hours) {
    if (!hours?.registered || !Array.isArray(hours.days)) return null;
    const open = hours.days.filter((day) => day && day.start && day.end);
    if (open.length === 0) return null;
    const groups = new Map();
    for (const day of open) {
        const key = `${day.start}~${day.end}`;
        groups.set(key, [...(groups.get(key) || []), day.day]);
    }
    const [time, days] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (groups.size === 1) return open.length >= 7 ? `매일 ${time}` : `${days.join('·')} ${time}`;
    return `${days.join('·')} ${time} 등 요일별`;
}

// "한우 1등급", "11위·21위" 같은 사실 표기 속 숫자는 광고성 "1등·1위"로 보지 않습니다.
function withoutFactualNumbers(value) {
    return value.replace(/\d*1등급/g, '').replace(/\d+1(?=[위등])/g, '');
}

// 광고성 수식어 찾기. texts: [{ where, text }]
export function findHypeWords(texts) {
    const found = [];
    for (const { where, text } of texts || []) {
        const value = withoutFactualNumbers(compact(text));
        if (!value) continue;
        for (const word of HYPE_WORDS) {
            if (value.includes(compact(word)) && !found.some((f) => f.word === word && f.where === where)) {
                found.push({ word, where });
            }
        }
    }
    return found;
}

function hypeTexts(place, activity) {
    return [
        ...list(place?.keywords).map((text) => ({ where: '대표키워드', text })),
        { where: '한 줄 소개', text: place?.intro },
        { where: '최근 소식 제목', text: activity?.feeds?.latestTitle },
    ].filter((entry) => entry.text);
}

// 지역 이름(주소·역)을 키워드에서 지울 때 쓰는 낱말 목록. 긴 것부터 지웁니다.
function regionTokens(place) {
    const tokens = new Set();
    const add = (word) => {
        const w = compact(word);
        if (w.length >= 2) tokens.add(w);
    };
    for (const word of String(place?.address || '').split(/\s+/)) {
        const base = word.replace(/(특별시|광역시|특별자치시|특별자치도|시|도|구|군|동|읍|면|로|길|가)$/, '');
        add(word);
        add(base);
        if (base.length >= 2) add(`${base}역`);
    }
    const station = String(place?.detail?.subway?.station || '');
    add(station);
    add(station.replace(/역$/, ''));
    add(placeArea(place));
    return [...tokens].sort((a, b) => b.length - a.length);
}

// "강남구청횟집" → "횟집": 지역 이름과 "맛집·추천" 같은 일반어를 뺀 핵심어
export function keywordCore(keyword, tokens = []) {
    let core = compact(keyword);
    for (const token of tokens) core = core.split(token).join('');
    for (const word of GENERIC_WORDS) core = core.split(word).join('');
    return core;
}

function bigrams(text) {
    const grams = [];
    for (let i = 0; i < text.length - 1; i += 1) grams.push(text.slice(i, i + 2));
    return grams;
}

// 키워드에는 "횟집"으로, 리뷰에는 "광어회·숙성회"로 나오는 것처럼 같은 뜻의 다른 형태를 맞춥니다.
const CORE_FORMS = [['횟집', '회'], ['고깃집', '고기'], ['국숫집', '국수'], ['찻집', '차'], ['술집', '술'], ['빵집', '빵'], ['떡집', '떡'], ['꽃집', '꽃'], ['중국집', '중식']];
// 지역 이름을 몰라 앞에 남은 경우("압구정회")에도 끝 글자로 판정할 수 있는 한 글자 업종어
const ONE_CHAR_TERMS = ['회', '탕', '빵', '떡', '죽', '술', '차', '꽃'];

function normalizeCore(core) {
    let text = core;
    for (const [from, to] of CORE_FORMS) text = text.split(from).join(to);
    return text.length >= 3 && text.endsWith('집') ? text.slice(0, -1) : text;
}

function coreMatches(core, evidence) {
    const text = normalizeCore(core);
    if (!text) return false;
    if (text.length === 1) return evidence.includes(text);
    if (bigrams(text).some((gram) => evidence.includes(gram))) return true;
    const last = text.slice(-1);
    return ONE_CHAR_TERMS.includes(last) && evidence.includes(last);
}

// 대표키워드가 손님 리뷰·AI 브리핑·업종 같은 "보이는 사실"로 뒷받침되는지 대략 판정합니다.
// (검색용 주장과 보이는 정보가 같은 사실을 말해야 AI가 헷갈리지 않습니다)
// ratio 는 특징어가 있는 키워드 중 맞는 비율, score 는 지역·"맛집"만 있는 키워드를 절반만 인정한 점수용 비율입니다.
export function keywordConsistency(place, activity) {
    const keywords = list(place?.keywords);
    if (keywords.length === 0) return { checked: [], generic: [], matched: 0, ratio: null, score: null };
    const price = place?.detail?.pos?.averagePrice || {};
    const evidence = compact([
        ...list(place?.reviewThemes).map((t) => t.label),
        ...list(place?.reviewMenus).map((t) => t.label),
        ...list(place?.reviewVotes).map((t) => t.label),
        ...list(activity?.briefing),
        ...list(place?.detail?.pos?.popularMenus).map((m) => m.name),
        ...list(place?.conveniences),
        // 네이버 결제 집계에 그 시간대 결제가 있으면 "점심·저녁" 키워드의 근거로 봅니다.
        price.morning ? '아침' : null,
        price.lunch ? '점심' : null,
        price.dinner ? '저녁' : null,
        place?.intro,
        place?.category,
    ].filter(Boolean).join(' '));
    const tokens = regionTokens(place);
    const checked = [];
    const generic = [];
    for (const keyword of keywords) {
        const core = keywordCore(keyword, tokens);
        if (!core) {
            generic.push(keyword);
            continue;
        }
        checked.push({ keyword, core, matched: coreMatches(core, evidence) });
    }
    const matched = checked.filter((entry) => entry.matched).length;
    const counted = checked.length + generic.length;
    return {
        checked,
        generic,
        matched,
        ratio: checked.length ? matched / checked.length : null,
        score: counted ? (matched + generic.length * 0.5) / counted : null,
    };
}

// ---------------------------------------------------------------------------
// 세부 질문 점검 — AI가 "○○ 추천"을 세부 질문으로 나눠 찾는 것으로 보고(코드 이름은 fanout), 그 질문에 매장 정보로 답할 수 있는지 점검
// status: yes(바로 답할 수 있음) / partial(일부만) / no(답할 정보 없음) / unknown(확인 불가)
// ---------------------------------------------------------------------------

export function buildFanout(place, activity) {
    if (!place) return [];
    const name = place.name || '이 매장';
    const area = placeArea(place);
    const category = searchCategory(place);
    const detail = place.detail || null;
    const pos = detail?.pos || null;
    const health = healthWords(place);
    const items = [];
    const add = (key, weight, question, status, answer, fix) => items.push({ key, weight, question, status, answer: answer || null, fix });
    // 업종 때문에 해당 없는 질문(place-industry.js): 점수·"답이 없는 질문" 계산에서 빠지도록 status 는 'unknown'(확인 불가와 같은 취급)으로 두고,
    // notApplicable 에 이유 문장을, notApplicableTag 에 이유와 같은 세기의 이름표를 답니다(fix 에도 같은 이유 문장).
    const industry = notApplicableOf(place);
    const skip = (key, weight, question, reason, tagKey = key) => items.push({
        key, weight, question, status: 'unknown', answer: null, fix: reason, notApplicable: reason, notApplicableTag: notApplicableTag(tagKey),
    });

    // 1. 위치·가는 길
    {
        const subway = detail?.subway || null;
        let answer = place.address ? `${josa(name, '은', '는')} ${place.address}에 있습니다.` : null;
        if (answer && subway) {
            const from = subway.exit ? `${subway.station} ${subway.exit}번 출구에서` : `${subway.station}에서`;
            answer += subway.walkMinutes ? ` ${from} 걸어서 ${subway.walkMinutes}분 거리입니다.` : ` ${josa(subway.station, '과', '와')} 가깝습니다.`;
        }
        const status = !place.address ? 'no' : subway ? 'yes' : 'partial';
        add('location', 1, `${josa(name, '은', '는')} 어디에 있고 어떻게 가나요?`, status, answer,
            // 가까운 역 자료가 없는 매장에 "역·출구·도보 시간"을 적으라고 하지 않습니다(역이 없는 동네에서는 정류장·건물 입구·주차 위치가 길 안내).
            subway ? '스마트플레이스 업체정보에 찾아오는 길(가까운 역·출구·도보 시간)을 적으세요.'
                : '스마트플레이스 업체정보에 찾아오는 길(가까운 정류장·건물 입구·주차 위치)을 적으세요.');
    }

    // 2. 영업시간
    {
        const hours = detail?.hours;
        const summary = summarizeHours(hours);
        let status;
        let answer = null;
        if (summary) {
            status = 'yes';
            answer = `${josa(name, '은', '는')} ${summary} 영업합니다.${hours.regularClosed ? ` 정기휴무는 ${hours.regularClosed}입니다.` : ''}`;
        } else if (hours) {
            status = 'no';
        } else {
            status = place.hasOpeningHours ? 'partial' : 'no';
        }
        add('hours', 1, `${area ? `${area} ` : ''}${category} 지금 영업 중인 곳·영업시간은?`, status, answer,
            '요일별 영업시간·브레이크타임·정기휴무를 등록하세요. "지금 영업 중" 질문에 답하는 핵심 정보입니다.');
    }

    // 3. 가격대
    {
        const avg = pos?.averagePrice?.total || null;
        let status;
        let answer = null;
        if (avg) {
            status = 'yes';
            answer = `최근 1주 네이버 결제 기준 ${name}의 1회 평균 결제 금액은 약 ${won(avg)}입니다.`;
        } else if (place.menuCount > 0 && place.menuPricedCount > 0) {
            status = 'partial';
            answer = `메뉴 ${place.menuCount}개 중 ${place.menuPricedCount}개에 가격이 등록돼 있습니다.`;
        } else {
            status = 'no';
        }
        add('price', 1, `${name} 가격대는 어느 정도인가요?`, status, answer,
            health ? `${health.item}마다 안내(가격을 알릴 수 있는 것은 가격대, 아니면 "방문 상담"처럼)를 글자로 적고 소개글에도 적으세요. 사진만 있으면 AI가 읽기 어렵습니다.`
                : '메뉴(서비스)마다 가격을 글자로 등록하고 대표 메뉴 가격대를 소개글에도 적으세요. 가격표 사진만 있으면 AI가 읽기 어렵습니다.');
    }

    // 4. 대표 메뉴·서비스
    {
        const reviewMenus = list(place.reviewMenus).slice(0, 3).map((m) => m.label);
        const posMenus = list(pos?.popularMenus).slice(0, 3).map((m) => m.name);
        // 약국·병의원 계열은 '메뉴' 대신 그 업종의 말(취급 품목·진료 과목·서비스)로 묻고 답합니다.
        const itemNoun = health ? '품목·서비스' : '메뉴';
        let status;
        let answer = null;
        if (reviewMenus.length) {
            status = 'yes';
            answer = `손님 리뷰에서 많이 언급된 ${itemNoun}는 ${reviewMenus.join(', ')}입니다.`;
        } else if (posMenus.length) {
            status = 'yes';
            answer = `최근 1주 결제가 많은 ${itemNoun}는 ${posMenus.join(', ')}입니다.`;
        } else if (place.menuCount > 0) {
            status = 'partial';
            answer = `${itemNoun} ${place.menuCount}개가 등록돼 있습니다.`;
        } else {
            status = 'no';
        }
        add('signature', 1, health ? `${name}의 대표 ${josa(health.item, '은', '는')} 무엇인가요?` : `${name} 대표 메뉴(서비스)는 무엇인가요?`, status, answer,
            health ? `대표 ${health.item}(예: ${health.examples}) 이름을 소개글·소식에 같은 표현으로 적고 사진·설명을 채우세요. 실제로 하는 것만 적습니다.`
                : '대표 메뉴(서비스) 이름을 메뉴 탭·소개글·소식에 같은 표현으로 적고 사진·설명을 채우세요.');
    }

    // 5. 평판·특징
    {
        const votes = list(place.reviewVotes);
        const reviews = place.visitorReviews || 0;
        let status;
        let answer = null;
        if (votes.length && reviews >= 10) {
            status = 'yes';
            const picked = votes.slice(0, 2).map((v) => `"${v.label}"(${v.count}명)`).join(', ');
            answer = `방문자 리뷰 ${reviews.toLocaleString('ko-KR')}개에서 ${picked} 평가가 많습니다.${place.visitorScore ? ` 평점은 ${place.visitorScore.toFixed(2)}점입니다.` : ''}`;
        } else if (reviews > 0) {
            status = 'partial';
            answer = `방문자 리뷰가 ${reviews.toLocaleString('ko-KR')}개 있습니다.`;
        } else {
            status = 'no';
        }
        add('reputation', 1, `${area ? `${area} ` : ''}${category} 중 평이 좋은 곳은?`, status, answer,
            '대가나 문구 지정 없이 영수증·예약 리뷰를 자연스럽게 요청하고 모든 리뷰에 답글을 다세요.');
    }

    // 6. 주차·편의시설
    {
        const parking = detail?.parking;
        const extras = [...list(place.conveniences), ...list(detail?.facilities)];
        const unique = [...new Set(extras)].slice(0, 5);
        let status;
        let answer = null;
        if (parking?.available) {
            status = 'yes';
            const fee = parking.free === true ? '(무료)' : parking.free === false ? '(유료)' : '';
            answer = `주차할 수 있습니다${fee}${parking.valet ? ', 발레파킹도 됩니다' : ''}.${unique.length ? ` 편의시설: ${unique.join(', ')}.` : ''}`;
        } else if (unique.length) {
            status = 'partial';
            answer = `편의시설: ${unique.join(', ')}.`;
        } else {
            status = detail ? 'no' : 'unknown';
        }
        add('parking', 1, `${name} 주차·편의시설은 어떤가요?`, status, answer,
            '주차 가능 여부(무료·유료·발레)와 편의시설(단체석·포장·무선 인터넷 등)을 등록하세요.');
    }

    // 7. 예약·문의
    {
        const booking = detail?.hasBooking;
        const contacts = [place.hasPhone && '전화', place.hasTalktalk && '네이버 톡톡'].filter(Boolean);
        let status;
        let answer = null;
        if (booking === true) {
            status = 'yes';
            answer = `네이버 예약으로 바로 예약할 수 있습니다.${contacts.length ? ` ${contacts.join('·')} 문의도 됩니다.` : ''}`;
        } else if (contacts.length) {
            status = 'partial';
            answer = `${contacts.join('·')}로 문의할 수 있습니다.`;
        } else {
            status = 'no';
        }
        if (industry.booking) skip('booking', 1, `${name} 예약이나 문의는 어떻게 하나요?`, industry.booking);
        else {
            add('booking', 1, `${name} 예약이나 문의는 어떻게 하나요?`, status, answer,
                '네이버 예약(또는 주문)과 톡톡을 연결하세요. 추천 다음에 오는 "예약 돼요?" 질문에 답할 수 있습니다.');
        }
    }

    // 8. 결제·혜택 (비중 절반)
    {
        const payments = list(place.paymentInfo).slice(0, 4);
        const couponTotal = activity?.coupons?.total ?? detail?.couponCount ?? null;
        const benefits = list(detail?.benefits).slice(0, 2);
        const parts = [
            payments.length ? `결제 수단: ${payments.join(', ')}.` : null,
            couponTotal > 0 ? `받을 수 있는 쿠폰이 ${couponTotal}개 있습니다.` : null,
            benefits.length ? `혜택: ${benefits.join(', ')}.` : null,
        ].filter(Boolean);
        let status;
        if (couponTotal > 0 || benefits.length) status = 'yes';
        else if (payments.length) status = 'partial';
        else status = activity || detail ? 'no' : 'unknown';
        if (healthKind(place) === 'pharmacy') {
            // 약국: 혜택(쿠폰·할인) 질문 전체가 해당 없음
            skip('payment', 0.5, `${name} 쿠폰·결제 혜택이 있나요?`, industry.coupon, 'coupon');
        } else if (industry.coupon) {
            // 병의원: 쿠폰 기능이 없으므로 결제 수단만 봅니다(쿠폰이 없다고 깎지 않음)
            add('payment', 0.5, `${name} 결제는 어떻게 하나요?`, payments.length ? 'yes' : activity || detail ? 'no' : 'unknown',
                payments.length ? `결제 수단: ${payments.join(', ')}.` : null, '결제 수단(카드·간편결제 등)을 등록하세요.');
        } else {
            add('payment', 0.5, `${name} 쿠폰·결제 혜택이 있나요?`, status, parts.length ? parts.join(' ') : null,
                '첫 방문 쿠폰이나 결제 혜택을 등록하세요.');
        }
    }

    return items;
}

const FANOUT_VALUE = { yes: 1, partial: 0.5, no: 0 };

export function fanoutCoverage(items) {
    const known = (items || []).filter((item) => item.status !== 'unknown');
    const total = known.reduce((sum, item) => sum + item.weight, 0);
    if (total === 0) return null;
    const got = known.reduce((sum, item) => sum + item.weight * FANOUT_VALUE[item.status], 0);
    return {
        ratio: got / total,
        yes: known.filter((item) => item.status === 'yes').length,
        partial: known.filter((item) => item.status === 'partial').length,
        no: known.filter((item) => item.status === 'no').length,
        known: known.length,
    };
}

// ---------------------------------------------------------------------------
// 한 문단 답변 초안(코드 이름은 buildAtomicAnswer) — 질문 바로 아래 둘 두괄식 문단(110~155자)
// 사실만 씁니다: 최상급·경쟁 매장 비교·효능 단정은 넣지 않습니다.
// ---------------------------------------------------------------------------

export function buildAtomicAnswer(place, activity, fanout = buildFanout(place, activity)) {
    if (!place) return null;
    const name = place.name || '이 매장';
    const category = categoryLabel(place);
    const detail = place.detail || null;
    const subway = detail?.subway || null;
    const hours = summarizeHours(detail?.hours);
    const votes = list(place.reviewVotes);
    const themes = list(place.reviewThemes);
    const menus = headlineMenus(place, activity, 2);

    const kind = place.category ? `${category} 매장` : '매장';
    const lead = place.address
        ? `${josa(name, '은', '는')} ${place.address}에 있는 ${kind}입니다.`
        : `${josa(name, '은', '는')} ${kind}입니다.`;
    const optional = [
        subway && subway.walkMinutes ? `${subway.station}${subway.exit ? ` ${subway.exit}번 출구` : ''}에서 걸어서 ${subway.walkMinutes}분입니다.` : null,
        hours ? `${hours} 영업합니다.` : null,
        votes.length && place.visitorReviews >= 10
            ? `방문자 리뷰 ${place.visitorReviews.toLocaleString('ko-KR')}개에서 "${votes[0].label}" 평가가 가장 많습니다.`
            : themes.length ? `리뷰에서는 "${themes[0].label}" 이야기가 많습니다.` : null,
        menus.length ? `리뷰에 자주 나오는 메뉴는 ${menus.join('·')}입니다.` : null,
        detail?.hasBooking === true ? '네이버 예약으로 예약할 수 있습니다.' : null,
        detail?.parking?.available ? '주차할 수 있습니다.' : null,
    ].filter(Boolean);

    let text = lead;
    for (const sentence of optional) {
        if (text.length + 1 + sentence.length <= ATOMIC_MAX) text = `${text} ${sentence}`;
    }
    const covered = (fanout || []).filter((item) => item.status === 'yes' && item.answer);
    return {
        question: targetQuestion(place),
        text,
        length: text.length,
        inRange: text.length >= ATOMIC_MIN && text.length <= ATOMIC_MAX,
        short: text.length < ATOMIC_MIN,
        faq: covered.map((item) => ({ question: item.question, answer: item.answer })),
    };
}

// ---------------------------------------------------------------------------
// 조건형 답변 — "주차되는 ○○", "예약 가능한 ○○"처럼 조건을 붙인 질문에 쓰는 첫 문단
// "기준 제시형 문장"(기준 3가지를 먼저 말하고 그 기준에 맞는 곳을 답함)으로 쓰되,
// 매장 정보로 확인되는 조건만 쓰고 "유일하다"는 단정과 경쟁 매장 깎아내리기는 넣지 않습니다.
// ---------------------------------------------------------------------------

const CIRCLED = ['①', '②', '③'];

function stationName(subway) {
    const station = String(subway?.station || '').trim();
    if (!station) return '';
    return station.endsWith('역') ? station : `${station}역`;
}

// 가장 흔한 마감 시각이 22시 이후(자정 넘김 포함)면 그 시각
function lateClose(hours) {
    if (!hours?.registered || !Array.isArray(hours.days)) return null;
    const counts = new Map();
    for (const day of hours.days) {
        if (day && day.start && day.end) counts.set(day.end, (counts.get(day.end) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const end = top[0];
    return end >= '22:00' || end <= '05:00' ? end : null;
}

// 매장 정보로 확인되는 조건. label: 글에 쓰는 말 · ask: 손님이 묻는 말 · brief: 질문 제목에 쓰는 짧은 말
export function placeCriteria(place) {
    if (!place) return [];
    const detail = place.detail || null;
    const extras = [...list(place.conveniences), ...list(detail?.facilities)].join(' ');
    const criteria = [];
    const add = (key, label, ask, brief = label) => criteria.push({ key, label, ask, brief });
    const subway = detail?.subway || null;
    if (subway && subway.walkMinutes && subway.walkMinutes <= 10) {
        const from = subway.exit ? `${subway.exit}번 출구` : '역';
        add('walk', `${stationName(subway)}${subway.exit ? ` ${subway.exit}번 출구` : ''} 도보 ${subway.walkMinutes}분`, '역에서 가까운', `${from} 도보 ${subway.walkMinutes}분`);
    }
    if (detail?.parking?.available) add('parking', detail.parking.free === true ? '무료 주차' : '주차 가능', '주차되는');
    if (detail?.hasBooking === true) add('booking', '네이버 예약 가능', '예약 가능한');
    const late = lateClose(detail?.hours);
    if (late) add('late', `${late}까지 영업`, '늦게까지 하는');
    if (/단체/.test(extras)) add('group', '단체 이용 가능', '단체로 갈 수 있는');
    if (/포장/.test(extras)) add('takeout', '포장 가능', '포장되는');
    if (detail?.pet === true) add('pet', '반려동물 동반 가능', '반려동물과 갈 수 있는');
    return criteria;
}

export function buildCriteriaAnswer(place, activity = null) {
    if (!place) return null;
    const criteria = placeCriteria(place);
    if (criteria.length < 2) return null;
    const name = place.name || '이 매장';
    const area = placeArea(place);
    const category = searchCategory(place);
    const menus = headlineMenus(place, activity, 2);
    const votes = list(place.reviewVotes);
    // 질문의 핵심어(지역·업종)를 첫 문장에 그대로 받습니다. 지역이 그 역이면 역 이름을 되풀이하지 않습니다.
    const sameStation = area && area === stationName(place.detail?.subway);
    const wording = (c) => (c.key === 'walk' && sameStation ? c.brief : c.label);
    const kind = place.category ? `${category} 매장` : '매장';
    const compose = (picked) => `${area ? `${area}에서 ` : ''}${picked.map((c, i) => `${CIRCLED[i]} ${wording(c)}`).join(' ')} 조건으로 ${kind}을 찾는다면 ${josa(name, '이', '가')} 해당합니다.`;
    let picked = criteria.slice(0, 3);
    while (picked.length > 2 && compose(picked).length > ATOMIC_MAX) picked = picked.slice(0, -1);
    const lead = compose(picked);
    let text = lead;
    const optional = [
        menus.length ? `리뷰에 자주 나오는 메뉴는 ${menus.join('·')}입니다.` : null,
        votes.length && place.visitorReviews >= 10
            ? `방문자 리뷰 ${place.visitorReviews.toLocaleString('ko-KR')}개에서 "${votes[0].label}" 평가가 가장 많습니다.` : null,
        place.address ? `주소는 ${place.address}입니다.` : null,
    ].filter(Boolean);
    for (const sentence of optional) {
        if (text.length + 1 + sentence.length <= ATOMIC_MAX) text = `${text} ${sentence}`;
    }
    return {
        question: `${area ? `${area} ` : ''}${category} 중 ${picked.map(wording).join('·')} 조건에 맞는 곳은 어디인가요?`,
        lead,
        text,
        length: text.length,
        inRange: text.length >= ATOMIC_MIN && text.length <= ATOMIC_MAX,
        short: text.length < ATOMIC_MIN,
        criteria: picked,
    };
}

// ---------------------------------------------------------------------------
// AI에 물어본 결과 — AI 답변 점유율(AI 답변에 우리 가게가 나온 비율. 코드 이름은 SoM·shareOfModel)
// 같은 질문을 AI마다 묻고, 내 매장이 몇 번째로 추천됐는지에 점수(1위 100 … 5위 20, 5위 밖 15, 안 나옴 0)를 매겨 평균합니다.
// 네트워크 요청 없이 사장님이 직접 물어 본 답을 붙여 넣거나 순위를 고릅니다.
// 측정하지 않은 칸은 0점이 아니라 분모에서 뺍니다(이 파일의 다른 점수와 같은 원칙).
// ---------------------------------------------------------------------------

export const SOM_PROMPT_SUFFIX = '추천하는 곳을 1순위부터 번호를 매겨 목록으로 알려줘.';
export const SOM_RANKS = [1, 2, 3, 4, 5, SOM_MENTION, SOM_NONE];

// 측정에 쓸 질문: 기본 질문 + (조건이 확인되면) 조건을 붙인 질문. 순위를 읽기 쉽게 번호 목록으로 답해 달라고 덧붙입니다(AI 답을 읽기 쉽게).
export function measurePrompts(place) {
    if (!place) return [];
    const area = placeArea(place);
    const category = searchCategory(place);
    const prompts = [`${targetQuestion(place)}해줘. ${SOM_PROMPT_SUFFIX}`];
    const criteria = placeCriteria(place);
    const asks = [...criteria.filter((c) => c.key !== 'walk'), ...criteria.filter((c) => c.key === 'walk')].slice(0, 2).map((c) => c.ask);
    if (asks.length) prompts.push(`${asks.join(', ')} ${area ? `${area} ` : ''}${category} 추천해줘. ${SOM_PROMPT_SUFFIX}`);
    return prompts;
}

export function isSomRank(rank) {
    return SOM_RANKS.includes(rank);
}

export function somPoints(rank) {
    if (rank === SOM_MENTION) return SHARE_LISTED_POINTS;
    return SHARE_WEIGHTS[rank] || 0;
}

export function somRankLabel(rank) {
    if (rank === SOM_MENTION) return '5위 밖';
    if (rank === SOM_NONE) return '안 나옴';
    return SHARE_WEIGHTS[rank] ? `${rank}위` : '미측정';
}

// 답변에서 찾을 매장 이름들. "○○ 강남점"처럼 지점 이름이 붙은 상호는 지점을 뺀 이름도 함께 찾습니다.
export function brandAliases(place, extra = []) {
    const name = String(place?.name || '').trim();
    const words = name.split(/\s+/).filter(Boolean);
    const base = words.length >= 2 && /점$/.test(words[words.length - 1]) ? words.slice(0, -1).join(' ') : null;
    const names = [name, name.replace(/\([^)]*\)/g, ' '), base, ...list(extra)];
    return uniq(names.map(compact)).filter((value) => value.length >= 2);
}

// "1." "1)" "| 1 |" "1위" "1번:" "①" "1️⃣" 로 시작하는 줄. "3번 출구"처럼 설명에 나오는 숫자는 항목으로 세지 않습니다.
const NUMBERED_ITEM = /^(?:\d{1,2}\s*[.)|]|\d{1,2}\s*(?:순위|위)(?=[\s:.,)\-–—]|$)|\d{1,2}\s*번\s*[:.)]|[①-⑩]|\d️?⃣)/;
const BULLET_ITEM = /^[-•*·▪●]\s+/;

function stripLineMarks(line) {
    return String(line).replace(/^[#>|\s]+/, '').replace(/^(?:\*\*|__)/, '').trim();
}

// AI 답변 글에서 내 매장이 몇 번째 추천 항목인지 읽습니다. 1~5: 순위 · 'mention': 5위 밖(6번째 이후이거나 목록 밖 언급) · 'none': 안 나옴 · null: 판정 불가
// 번호 목록이 있으면 번호 줄만 항목으로 세고(그 아래 설명 줄은 같은 항목), 없으면 글머리 기호 줄을 항목으로 셉니다. 참고용 자동 판정입니다.
export function evaluateAnswerRank(text, aliases) {
    const body = String(text || '');
    const names = list(aliases).map(compact).filter((name) => name.length >= 2);
    if (!body.trim() || names.length === 0) return null;
    const mentions = (value) => {
        const flat = compact(value);
        return names.some((name) => flat.includes(name));
    };
    if (!mentions(body)) return SOM_NONE;

    const lines = body.split(/\r?\n/);
    const numbered = lines.filter((line) => NUMBERED_ITEM.test(stripLineMarks(line))).length >= 2;
    const isItem = (line) => NUMBERED_ITEM.test(line) || (!numbered && BULLET_ITEM.test(line));
    const items = [];
    let current = null;
    let gap = false;
    for (const raw of lines) {
        const line = stripLineMarks(raw);
        if (!line) {
            gap = true;
            continue;
        }
        if (isItem(line)) {
            if (current !== null) items.push(current);
            current = line;
        } else if (current !== null) {
            // 빈 줄 뒤에 들여쓰기 없이 이어지는 문단은 목록이 끝난 뒤의 덧붙임 글로 봅니다.
            if (gap && !/^\s/.test(raw) && !BULLET_ITEM.test(line)) {
                items.push(current);
                current = null;
            } else {
                current = `${current} ${line}`;
            }
        }
        gap = false;
    }
    if (current !== null) items.push(current);
    const index = items.findIndex(mentions);
    return index >= 0 && index < 5 ? index + 1 : SOM_MENTION;
}

function somPosition(rank) {
    if (SHARE_WEIGHTS[rank]) return rank;
    return rank === SOM_MENTION ? 6 : 10;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

// results: [{ prompt, ranks: { naver: 1~5 | 'mention' | 'none' | null, chatgpt: …, … } }] · previous: 직전 측정(같은 모양)
// 점유율(%) = 받은 점수 합 ÷ (측정한 칸 수 × 100). delta 는 직전 측정과의 차이(%p), cells[].delta 는 순위 변동(+면 올라감).
export function shareOfModel(results, previous = null) {
    const rows = list(results);
    const before = list(previous);
    const cells = [];
    rows.forEach((row, index) => {
        for (const platform of PLATFORMS) {
            const rank = row?.ranks?.[platform.key];
            if (!isSomRank(rank)) continue;
            const old = before[index]?.ranks?.[platform.key];
            cells.push({
                prompt: index,
                platform: platform.key,
                rank,
                points: somPoints(rank),
                delta: isSomRank(old) ? somPosition(old) - somPosition(rank) : null,
            });
        }
    });
    if (cells.length === 0) return null;
    const pct = (items) => round1((items.reduce((sum, cell) => sum + cell.points, 0) / (items.length * 100)) * 100);
    const prev = previous ? shareOfModel(previous) : null;
    const overall = pct(cells);
    return {
        overall,
        delta: prev ? round1(overall - prev.overall) : null,
        measured: cells.length,
        total: rows.length * PLATFORMS.length,
        cells,
        platforms: PLATFORMS.map((platform) => {
            const mine = cells.filter((cell) => cell.platform === platform.key);
            const score = mine.length ? pct(mine) : null;
            const prevScore = prev?.platforms.find((p) => p.key === platform.key)?.score ?? null;
            return {
                key: platform.key,
                label: platform.label,
                short: platform.short,
                measured: mine.length,
                score,
                delta: score !== null && prevScore !== null ? round1(score - prevScore) : null,
                best: mine.length ? mine.reduce((top, cell) => (somPosition(cell.rank) < somPosition(top.rank) ? cell : top)).rank : null,
            };
        }),
    };
}

// ---------------------------------------------------------------------------
// 검색 노출 점유율(위 AI 답변 점유율과 같은 점수표를 빌림) — 대표키워드 순위 결과로 계산
// AI 답변 속 점유율이 아니라 네이버 플레이스 목록 순위입니다. AI 답변은 위 shareOfModel 로 따로 잽니다.
// ---------------------------------------------------------------------------

export function rankSharePoints(rank) {
    if (!Number.isInteger(rank) || rank < 1) return 0;
    if (SHARE_WEIGHTS[rank]) return SHARE_WEIGHTS[rank];
    return rank <= SHARE_LISTED_MAX_RANK ? SHARE_LISTED_POINTS : 0;
}

// ranks: 화면의 순위 조회 상태 배열 [{ keyword, state, result }]
export function searchShare(ranks) {
    const done = (ranks || []).filter((row) => row && row.state === 'done' && row.result);
    if (done.length === 0) return null;
    const rows = done.map((row) => {
        const rank = row.result.status === 'found' ? row.result.rank : null;
        return { keyword: row.keyword, rank, status: row.result.status, points: rankSharePoints(rank) };
    });
    return {
        score: Math.round(rows.reduce((sum, row) => sum + row.points, 0) / rows.length),
        rows,
        top5: rows.filter((row) => row.rank && row.rank <= 5).length,
        listed: rows.filter((row) => row.rank && row.rank <= SHARE_LISTED_MAX_RANK).length,
    };
}

// ---------------------------------------------------------------------------
// 점수 — 항목(factor)마다 세부 점수(part)를 더하고, 확인할 수 없는 세부 점수는 분모에서 뺍니다.
// ---------------------------------------------------------------------------

function part(points, max) {
    return { points: points === null || points === undefined ? null : points, max };
}

function tier(value, steps) {
    // steps: [[기준 이상, 점수], ...] 큰 기준부터
    for (const [min, points] of steps) if (value >= min) return points;
    return 0;
}

// weight 는 확인된 세부 점수의 만점 합입니다. 확인 불가 세부 점수는 항목 안에서도, 총점에서도 분모에서 빠집니다
// (확인된 일부로 나머지를 미루어 짐작하지 않음). fullWeight 는 모두 확인됐을 때의 만점입니다.
function makeFactor(key, label, parts, evidence, tip) {
    const platforms = FACTOR_PLATFORMS[key] || [];
    const fullWeight = parts.reduce((sum, p) => sum + p.max, 0);
    const known = parts.filter((p) => p.points !== null);
    const max = known.reduce((sum, p) => sum + p.max, 0);
    const points = known.reduce((sum, p) => sum + p.points, 0);
    const pct = max > 0 ? Math.round((points / max) * 100) : null;
    const status = pct === null ? 'unknown' : pct >= 80 ? 'good' : pct >= 50 ? 'fair' : 'poor';
    return { key, label, weight: max, fullWeight, points: Math.round(points * 10) / 10, max, pct, status, evidence, tip, platforms };
}

// 업종 때문에 점수에서 뺀 세부 항목을 항목(factor)에 남깁니다: notApplicable = [{ key: 'feed'|'coupon', label, reason }] (없으면 필드 자체가 없음).
// 화면은 이 필드가 있으면 그 세부 항목을 tag(이유와 같은 세기의 이름표)와 reason 으로 보여 주면 됩니다.
function withNotApplicable(factor, entries) {
    const list = (entries || []).filter(Boolean).map((entry) => ({ ...entry, tag: notApplicableTag(entry.key) }));
    return list.length ? { ...factor, notApplicable: list } : factor;
}

// 확인된 항목만 비중대로 합칩니다. 항목에 points 가 있으면 반올림 전 점수로 계산해 오차를 줄입니다.
export function totalScore(factors) {
    const known = (factors || []).filter((f) => f.pct !== null && f.pct !== undefined && f.weight > 0);
    const weight = known.reduce((sum, f) => sum + f.weight, 0);
    if (weight === 0) return null;
    const got = known.reduce((sum, f) => sum + (Number.isFinite(f.points) ? f.points : (f.pct / 100) * f.weight), 0);
    return Math.round((got / weight) * 100);
}

export function scoreLabel(score) {
    if (score === null || score === undefined) return '확인 불가';
    if (score >= 85) return '준비 우수';
    if (score >= 70) return '양호';
    if (score >= 50) return '보통';
    return '보강 필요';
}

function descriptionLength(place) {
    const length = place?.detail?.descriptionLength;
    if (Number.isFinite(length)) return length;
    if (place?.missing?.description === true) return 0;
    return null;
}

// 마지막 소식이 며칠 전인지: 다른 화면(지금 할 일·마지막 소식)과 같은 값(naver-place 의 feedDays)
function feedAge(feeds, nowMs = Date.now()) {
    const days = feedDays(feeds, nowMs);
    return Number.isFinite(days) ? days : null;
}

function menuAgeDays(place, nowMs) {
    const menuDate = parseNaverDate(place?.detail?.menuUpdatedAt, nowMs);
    return menuDate ? daysAgo(menuDate, nowMs) : null;
}

function couponState(place, activity) {
    const detail = place?.detail || null;
    const total = activity?.coupons?.total ?? detail?.couponCount ?? null;
    const extras = [...list(activity?.coupons?.memberships).map((m) => `멤버십 ${m}`), ...list(detail?.benefits)];
    const known = total !== null || Boolean(activity?.coupons) || Array.isArray(detail?.benefits);
    return { total, extras, known };
}

// 네이버 AI 브리핑은 음식점·카페·술집 화면에서 확인됐습니다. 다른 업종은 없어도 "아직 제공 안 됨"일 수 있어 점수에서 뺍니다.
const BRIEFING_TYPES = ['Restaurant', 'CafeOrCoffeeShop', 'BarOrPub'];

function briefingEligible(place) {
    return BRIEFING_TYPES.includes(schemaType(place?.category));
}

export function scoreGeo(place, activity = null, ranks = null, { nowMs = Date.now() } = {}) {
    const detail = place?.detail || null;
    const visitor = activity?.visitor || null;
    const blog = activity?.blog || null;
    const feeds = activity?.feeds || null;
    const factors = [];
    const industry = notApplicableOf(place);

    // 1. 엔티티 기본 정보(NAP)
    {
        const hoursOk = detail?.hours ? detail.hours.registered : Boolean(place.hasOpeningHours);
        const missing = [!place.address && '주소', !place.hasPhone && '전화', !hoursOk && '영업시간', !place.category && '업종'].filter(Boolean);
        factors.push(makeFactor('entity', '기본 정보(상호·주소·전화)', [
            part(place.address ? 4 : 0, 4), part(place.hasPhone ? 4 : 0, 4), part(hoursOk ? 4 : 0, 4), part(place.category ? 3 : 0, 3),
        ], missing.length ? `비어 있는 항목: ${missing.join(', ')}` : '상호·주소·전화·영업시간·업종이 모두 등록돼 있습니다.',
        '상호·주소·전화가 여러 곳에서 똑같이 확인되면 AI가 같은 매장으로 알아보기 쉽다고 봅니다. 스마트플레이스를 먼저 채우고 구글·Bing·카카오 지도에도 같은 표기로 등록하세요.'));
    }

    // 2. 외부 출처(블로그·카페 글)
    {
        const total = blog?.total ?? place.blogReviews ?? 0;
        const recent = blog ? blog.last30 : null;
        factors.push(makeFactor('sources', '외부 출처(블로그·카페 글)', [
            part(tier(total, [[200, 11], [50, 9], [10, 6], [1, 3]]), 11),
            part(recent === null ? null : tier(recent, [[3, 4], [1, 2]]), 4),
        ], `블로그·카페 리뷰 ${total.toLocaleString('ko-KR')}개${recent === null ? '' : ` · 최근 30일 ${recent}개`}`,
        'AI가 블로그·카페 글을 출처로 삼는 경우가 많다고 봅니다. 체험단·방문 후기는 광고 표기를 지켜 꾸준히 쌓고, 이미 상위에 노출된 글의 운영자와 사실 정보(메뉴·가격·위치) 업데이트를 협의하세요.'));
    }

    // 3. 리뷰 신뢰 신호
    {
        const reviews = place.visitorReviews || 0;
        const ratio = place.textReviews !== null && place.textReviews !== undefined && reviews > 0 ? place.textReviews / reviews : null;
        factors.push(makeFactor('reviews', '리뷰 신뢰 신호', [
            part(tier(reviews, [[500, 9], [100, 7], [20, 4], [1, 2]]), 9),
            part(place.visitorScore ? 3 : 0, 3),
            part(ratio === null ? null : ratio >= 0.5 ? 3 : ratio >= 0.2 ? 1.5 : 0, 3),
        ], `방문자 리뷰 ${reviews.toLocaleString('ko-KR')}개${ratio === null ? '' : ` · 글 리뷰 비율 ${Math.round(ratio * 100)}%`} · 평점 ${place.visitorScore ? place.visitorScore.toFixed(2) : '표시 안 함'}`,
        '글로 쓴 리뷰가 많을수록 AI가 요약에 쓸 수 있는 문장이 늘어납니다. 대가·문구 지정 없이 자연스럽게 리뷰를 요청하세요.'));
    }

    // 4. 최신성
    {
        const visitorPart = visitor ? (visitor.last7 > 0 ? 5 : visitor.last30 > 0 ? 3 : 0) : null;
        const feedDaysAgo = feedAge(feeds, nowMs);
        let feedPart = null;
        if (feeds) {
            // 소식은 있는데 날짜를 못 읽었으면 0점이 아니라 확인 불가로 뺍니다.
            if (feeds.count === 0) feedPart = 0;
            else if (feedDaysAgo !== null) feedPart = tier(-feedDaysAgo, [[-14, 6], [-30, 4], [-90, 2]]);
        } else if (detail?.hasFeed === false) {
            feedPart = 0;
        }
        const menuAge = menuAgeDays(place, nowMs);
        const menuPart = menuAge === null ? null : menuAge <= 90 ? 4 : menuAge <= 365 ? 2 : 0;
        // 업종 때문에 새소식 기능이 없으면(병의원) 소식 점수는 만점·감점 계산에서 뺍니다(확인 불가와 같은 방식으로 분모에서 빠짐).
        if (industry.feed) feedPart = null;
        const notes = [
            visitor ? `최근 30일 방문자 리뷰 ${visitor.last30}개` : null,
            industry.feed ? '소식: 이 업종에는 해당 없음' : feeds ? (feeds.count === 0 ? '소식 없음' : feedDaysAgo === null ? '소식 날짜 확인 불가' : `마지막 소식 ${feedDaysAgo}일 전`) : null,
            menuAge !== null ? `메뉴 수정 ${menuAge}일 전` : null,
        ].filter(Boolean);
        factors.push(withNotApplicable(makeFactor('freshness', '최신성(최근 리뷰·소식·메뉴)', [part(visitorPart, 5), part(feedPart, 6), part(menuPart, 4)],
            notes.join(' · ') || '최근 활동을 확인하지 못했습니다.',
            industry.feed
                ? '메뉴·진료 정보와 영업시간을 최신으로 유지하세요. 최근 정보가 있는 매장이 AI 답변에 쓰이기 쉽다고 봅니다.'
                : `소식(${feedTopicWords(place)}·휴무)을 2주에 한 번 이상 올리고 ${healthWords(place)?.item || '메뉴'} 정보를 최신으로 유지하세요. 최근 정보가 있는 매장이 AI 답변에 쓰이기 쉽다고 봅니다.`),
        [industry.feed && { key: 'feed', label: '새소식', reason: industry.feed }]));
    }

    // 5. 대표키워드와 보이는 정보의 일치
    {
        const keywords = Array.isArray(place.keywords) ? place.keywords : null;
        const consistency = keywordConsistency(place, activity);
        factors.push(makeFactor('keywords', '대표키워드·리뷰 표현 일치', [
            part(keywords === null ? null : tier(keywords.length, [[5, 6], [3, 4], [1, 2]]), 6),
            part(consistency.score === null ? null : Math.round(consistency.score * 6 * 10) / 10, 6),
        ], keywords === null ? '대표키워드를 읽지 못했습니다.'
            : [
                `대표키워드 ${keywords.length}/5개`,
                consistency.checked.length ? `리뷰·AI 브리핑과 겹치는 키워드 ${consistency.matched}/${consistency.checked.length}개` : null,
                consistency.generic.length ? `지역·"맛집"만 있는 키워드 ${consistency.generic.length}개(절반 인정)` : null,
            ].filter(Boolean).join(' · '),
        '대표키워드는 손님 리뷰와 AI 브리핑에 실제로 나오는 표현(메뉴·분위기·용도)으로 고르세요. 검색용 키워드와 보이는 정보가 같은 사실을 말해야 AI가 덜 헷갈릴 수 있습니다.'));
    }

    // 5-1. 네이버 AI 브리핑·쿠폰(네이버 전용 신호)
    {
        const briefing = list(activity?.briefing);
        let briefingPart = null;
        if (briefing.length) briefingPart = 6;
        else if (activity && briefingEligible(place)) briefingPart = 0;
        const coupon = couponState(place, activity);
        let couponPart = null;
        if (coupon.total > 0) couponPart = 4;
        else if (coupon.extras.length) couponPart = 2;
        else if (coupon.known) couponPart = 0;
        // 병의원(쿠폰 기능 없음)·약국(쿠폰·할인 혜택을 권하지 않음)은 쿠폰 점수를 만점·감점 계산에서 뺍니다.
        if (industry.coupon) couponPart = null;
        factors.push(withNotApplicable(makeFactor('naverAi', '네이버 AI 브리핑·쿠폰', [part(briefingPart, 6), part(couponPart, 4)],
            [
                briefing.length ? `AI 브리핑 ${briefing.length}문장 노출` : activity ? (briefingEligible(place) ? 'AI 브리핑 없음' : 'AI 브리핑 없음(업종에 따라 아직 제공 안 될 수 있어 점수 제외)') : 'AI 브리핑 확인 불가',
                industry.coupon ? '쿠폰: 이 업종에는 해당 없음' : coupon.total > 0 ? `쿠폰 ${coupon.total}개` : coupon.known ? `쿠폰 없음${coupon.extras.length ? `(혜택: ${coupon.extras.slice(0, 2).join(', ')})` : ''}` : '쿠폰 확인 불가',
            ].join(' · '),
            industry.coupon
                ? 'AI 브리핑은 네이버가 리뷰·블로그·플레이스 정보를 요약해 만듭니다. 글 리뷰와 정확한 소개글·메뉴 설명이 재료입니다.'
                : 'AI 브리핑은 네이버가 리뷰·블로그·플레이스 정보를 요약해 만듭니다. 글 리뷰와 정확한 소개글·메뉴 설명이 재료입니다. 쿠폰은 "혜택 있는 곳" 질문의 답이 됩니다.'),
        [industry.coupon && { key: 'coupon', label: '쿠폰', reason: industry.coupon }]));
    }

    // 6. 광고성 표현
    {
        const texts = hypeTexts(place, activity);
        const hype = findHypeWords(texts);
        factors.push(makeFactor('tone', '사실 위주 표현(광고성 수식어)', [
            part(texts.length === 0 ? null : hype.length === 0 ? 5 : hype.length === 1 ? 2 : 0, 5),
        ], texts.length === 0 ? '검사할 글이 없습니다.' : hype.length ? `광고성 표현: ${hype.map((h) => `"${h.word}"(${h.where})`).join(', ')}` : '대표키워드·한 줄 소개·소식 제목에 광고성 표현이 없습니다.',
        '"최고·1위·완벽" 같은 표현은 빼고 수치·사실로 쓰세요. AI는 광고 문구보다 확인할 수 있는 사실을 쓰는 편이라고 봅니다.'));
    }

    // 7. 채널 연결(sameAs)
    {
        const links = Array.isArray(detail?.links) ? detail.links : null;
        factors.push(makeFactor('sameAs', '채널 연결(홈페이지·SNS·톡톡)', [
            part(links === null ? null : tier(links.length, [[3, 4], [2, 3], [1, 2]]), 4),
            part(place.hasBlog ? 2 : 0, 2),
            part(place.hasTalktalk ? 2 : 0, 2),
        ], `연결 채널: ${links?.length ? links.join(', ') : '없음'}${place.hasBlog ? ' · 블로그' : ''}${place.hasTalktalk ? ' · 톡톡' : ''}`,
        '홈페이지·인스타그램·블로그·유튜브를 플레이스에 연결하고 각 채널 소개에도 같은 상호·주소·전화번호를 쓰세요. 여러 채널이 한 매장으로 묶여 있으면 AI가 같은 매장으로 알아보기 쉽습니다.'));
    }

    // 8. 검색 노출 점유율
    {
        const share = searchShare(ranks);
        factors.push(makeFactor('competition', '대표키워드 검색 노출 점유율', [
            part(share ? Math.round((share.score / 100) * 15 * 10) / 10 : null, 15),
        ], share ? `대표키워드 ${share.rows.length}개 중 5위 안 ${share.top5}개 · 10위 안 ${share.listed}개 · 점유율 ${share.score}점` : '대표키워드 순위 조회가 끝나면 계산합니다.',
        '검색 상위 매장이 AI 추천에도 오르내릴 것이라고 보고 넣은 항목입니다(확인된 사실이 아니라 가정입니다). 순위가 낮은 키워드는 순위 진단의 부족한 신호부터 채우세요.'));
    }

    const score = totalScore(factors);
    return { score, label: scoreLabel(score), factors };
}

export function scoreAeo(place, activity = null, fanout = buildFanout(place, activity)) {
    const detail = place?.detail || null;
    const visitor = activity?.visitor || null;
    const feeds = activity?.feeds || null;
    const factors = [];

    // 1. 팬아웃 질문 커버리지
    {
        const coverage = fanoutCoverage(fanout);
        factors.push(makeFactor('fanout', '세부 질문 답변 범위', [
            part(coverage ? Math.round(coverage.ratio * 35 * 10) / 10 : null, 35),
        ], coverage ? `질문 ${coverage.known}개 중 바로 답할 수 있는 질문 ${coverage.yes}개 · 일부만 ${coverage.partial}개 · 정보 없음 ${coverage.no}개` : '질문을 점검하지 못했습니다.',
        'AI는 "○○ 추천" 같은 질문을 위치·영업시간·가격·주차·예약 같은 세부 질문으로 나눠 찾는 것으로 보입니다. 답이 비어 있는 질문의 정보를 채우세요.'));
    }

    // 2. 한 문단 답변 재료
    {
        const length = descriptionLength(place);
        const descPart = length === null ? (place?.missing?.description === false ? 4 : null) : length >= 150 ? 6 : length > 0 ? 4 : 0;
        const signature = list(place.reviewMenus).length > 0 || list(detail?.pos?.popularMenus).length > 0;
        factors.push(makeFactor('atomic', '두괄식 답변 재료(소개글·한 줄 소개·역 정보)', [
            part(descPart, 6),
            part(place.intro ? 3 : 0, 3),
            part(detail ? (detail.subway ? 3 : 0) : null, 3),
            part(signature ? 3 : 0, 3),
        ], [
            length === null ? '소개글 길이 확인 불가' : length > 0 ? `소개글 ${length}자` : '소개글 없음',
            place.intro ? '한 줄 소개 있음' : '한 줄 소개 없음',
            detail?.subway ? `가까운 역 ${detail.subway.station}` : '가까운 역 정보 없음',
        ].join(' · '),
        `소개글 첫 문장에 "어디에 있는 어떤 매장인지 + 확인할 수 있는 근거 2가지"를 두괄식으로 적으세요(${ATOMIC_MIN}~${ATOMIC_MAX}자). ${tab('drafts')}의 한 문단 답변 초안을 다듬어 쓰면 됩니다.`));
    }

    // 3. 구조화 필드
    {
        const menuCount = place.menuCount || 0;
        const priced = menuCount > 0 ? (place.menuPricedCount || 0) / menuCount : 0;
        const described = menuCount > 0 ? (place.menuDescribedCount || 0) / menuCount : 0;
        const hoursDays = detail?.hours ? (summarizeHours(detail.hours) ? 4 : 0) : (place.hasOpeningHours ? 2 : 0);
        const extras = list(place.conveniences).length + list(detail?.facilities).length;
        const health = healthWords(place);
        factors.push(makeFactor('structured', `칸이 나뉜 정보(${health ? health.item : '메뉴'} 가격·설명·영업시간·편의)`, [
            part(Math.round(priced * 6 * 10) / 10, 6),
            part(Math.round(described * 4 * 10) / 10, 4),
            part(hoursDays, 4),
            part(extras > 0 ? 3 : 0, 3),
            part(list(place.paymentInfo).length > 0 ? 3 : 0, 3),
        ], menuCount > 0
            ? `${health ? health.item : '메뉴'} ${menuCount}개 중 가격 ${place.menuPricedCount ?? 0}개 · 설명 ${place.menuDescribedCount ?? 0}개 · 편의시설 ${extras}개`
            : `등록된 ${health ? health.item : '메뉴'} 없음 · 편의시설 ${extras}개`,
        health ? `${health.item}마다 설명(알릴 수 있으면 가격)을 글자로 채우세요. 표·목록처럼 칸이 나뉜 정보는 AI가 읽기 쉽습니다. 사진만 있으면 글자로 읽히지 않을 수 있습니다.`
            : '메뉴마다 가격·설명을 글자로 채우세요. 표·목록처럼 칸이 나뉜 정보는 AI가 읽기 쉽습니다. 메뉴판 사진만 있으면 글자로 읽히지 않을 수 있습니다.'));
    }

    // 4. 후속 질문 대비(멀티턴)
    {
        const price = Boolean(detail?.pos?.averagePrice?.total) || (place.menuPricedCount || 0) > 0;
        const booking = detail?.hasBooking;
        // 약국은 네이버 예약 가능 여부가 확인되지 않아 예약 점수를 만점·감점 계산에서 뺍니다(이미 쓰고 있으면 그대로 셈: place-industry.js)
        const industry = notApplicableOf(place);
        factors.push(withNotApplicable(makeFactor('multiturn', '후속 질문 대비(가격·예약·문의)', [
            part(price ? 5 : 0, 5),
            part(industry.booking ? null : booking === true ? 5 : booking === false ? 0 : null, 5),
            part(place.hasPhone || place.hasTalktalk ? 5 : 0, 5),
        ], [price ? '가격 정보 있음' : '가격 정보 없음', industry.booking ? `예약: ${UNVERIFIED_TAG}` : booking === null || booking === undefined ? '예약 확인 불가' : booking ? '네이버 예약 있음' : '네이버 예약 없음', place.hasPhone || place.hasTalktalk ? '문의 채널 있음' : '문의 채널 없음'].join(' · '),
        industry.booking
            ? '추천을 받은 손님은 바로 "가격은?"을 묻습니다. 가격·문의 정보를 한곳에 모아 두면 손님이 다른 매장을 다시 찾아볼 일이 줄어들 수 있습니다.'
            : '추천을 받은 손님은 바로 "가격은?", "예약 돼요?"를 묻습니다. 가격·예약·문의 정보를 한곳에 모아 두면 손님이 다른 매장을 다시 찾아볼 일이 줄어들 수 있습니다.'),
        [industry.booking && { key: 'booking', label: '네이버 예약', reason: industry.booking }]));
    }

    // 5. 사장님이 쓰는 답변형 글(답글·소식)
    {
        const rateKnown = Number.isFinite(visitor?.replyRate);
        const enoughSample = rateKnown && visitor.sampled >= REPLY_MIN_SAMPLE;
        const replyPart = enoughSample ? tier(visitor.replyRate, [[80, 8], [50, 6], [20, 3]]) : null;
        let feedPart = null;
        if (feeds) feedPart = feeds.last30 > 0 ? 7 : feeds.count > 0 ? 4 : 0;
        else if (detail?.hasFeed !== null && detail?.hasFeed !== undefined) feedPart = detail.hasFeed ? 4 : 0;
        // 새소식 기능이 없는 업종(병의원)은 소식 점수를 만점·감점 계산에서 뺍니다(place-industry.js)
        const industry = notApplicableOf(place);
        if (industry.feed) feedPart = null;
        let replyNote = '답글률 확인 불가';
        if (enoughSample) replyNote = `답글률 ${visitor.replyRate}%(최근 리뷰 ${visitor.sampled}개 기준)`;
        else if (rateKnown) replyNote = `답글률 ${visitor.replyRate}%(최근 리뷰 ${visitor.sampled}개뿐이라 점수 제외)`;
        factors.push(withNotApplicable(makeFactor('qna', '답변형 글(리뷰 답글·소식)', [part(replyPart, 8), part(feedPart, 7)],
            [replyNote, industry.feed ? '소식: 이 업종에는 해당 없음' : feeds ? `최근 30일 소식 ${feeds.last30}개` : null].filter(Boolean).join(' · '),
            industry.feed
                ? '리뷰 답글은 사장님이 직접 쓰는 "답변 문장"입니다. 자주 받는 질문(주차·예약·가격)의 답을 답글에 사실대로 적으세요.'
                : '리뷰 답글과 소식은 사장님이 직접 쓰는 "답변 문장"입니다. 자주 받는 질문(주차·예약·가격)의 답을 답글·소식에 사실대로 적으세요.'),
        [industry.feed && { key: 'feed', label: '새소식', reason: industry.feed }]));
    }

    const score = totalScore(factors);
    return { score, label: scoreLabel(score), factors };
}

// ---------------------------------------------------------------------------
// 플랫폼별 준비도
// ---------------------------------------------------------------------------

export function platformReadiness(geo, aeo) {
    const byKey = new Map([...(geo?.factors || []), ...(aeo?.factors || [])].map((f) => [f.key, f]));
    return PLATFORMS.map((platform) => {
        const factors = PLATFORM_FACTORS[platform.key].map((key) => byKey.get(key)).filter(Boolean);
        const score = totalScore(factors);
        const weakest = factors.filter((f) => f.pct !== null).sort((a, b) => a.pct - b.pct)[0] || null;
        return { ...platform, score, grade: scoreLabel(score), weakest: weakest && weakest.pct < 80 ? weakest.label : null };
    });
}

// ---------------------------------------------------------------------------
// 실행 계획 — 할 일마다 "지금 → 목표 → +N점"과 지금 당장·1주·2주·1개월 로드맵
// +N점은 그 일 하나만 했다고 치고(patch) 점수를 다시 계산한 차이입니다. 다른 조건은 그대로 둔 추정이며 노출을 보장하지 않습니다.
// ---------------------------------------------------------------------------

export const ROADMAP_STAGES = [
    { key: 'now', label: '지금 당장', sub: '오늘 안에 시작하는 일' },
    { key: 'week1', label: '1주 차', sub: '질문형 글 올리기·외부 등록 채우기' },
    { key: 'week2', label: '2주 차', sub: '외부 채널 넓히기' },
    { key: 'month1', label: '1개월 안', sub: '쌓기·다시 재기' },
];

const ALL_AI = PLATFORMS.map((p) => p.key);
const WEB_AI = ALL_AI.filter((key) => key !== 'naver');
const STAGE_ORDER = Object.fromEntries(ROADMAP_STAGES.map((stage, i) => [stage.key, i]));
const SAMPLE_HOURS = ['월', '화', '수', '목', '금', '토', '일'].map((day) => ({ day, start: '11:00', end: '21:00', breaks: [], lastOrder: null }));
const KEYWORD_TERM = /^[가-힣a-z0-9]{2,8}$/;
const REVIEW_STEPS = [20, 100, 500];
const BLOG_STEPS = [10, 50, 200];
const LINK_TYPES = ['홈페이지', '인스타그램', '유튜브', '블로그'];

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

function kstDateText(nowMs) {
    return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '.');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHype(text) {
    if (!text) return text;
    return HYPE_WORDS.reduce((value, word) => value.replace(new RegExp(escapeRegExp(word), 'gi'), ''), String(text)).replace(/\s+/g, ' ').trim();
}

// 리뷰·결제에 실제로 나오는 메뉴에 지역명을 붙인 대표키워드 후보(이미 쓰는 표현은 뺌)
export function keywordCandidates(place, count = 5) {
    const existing = list(place?.keywords).map(compact);
    const prefix = compact(placeArea(place)).replace(/역$/, '');
    const picked = [];
    const terms = [
        ...list(place?.reviewMenus).map((m) => compact(m.label)),
        ...list(place?.detail?.pos?.popularMenus).map((m) => compact(m.name)),
    ];
    for (const term of terms) {
        if (picked.length >= count) break;
        if (!KEYWORD_TERM.test(term) || existing.some((word) => word.includes(term))) continue;
        if (picked.some((other) => other.includes(term) || term.includes(other))) continue;
        picked.push(term);
    }
    return picked.map((term) => `${prefix}${term}`);
}

// AI가 업종별 예약·리뷰 서비스의 매장 페이지도 출처로 삼는 것으로 보고(병원 예: 모두닥·굿닥) 업종별로 옮긴 목록(공식 확인은 아님)
const PROFILE_SITES = {
    Restaurant: ['카카오맵', '캐치테이블', '테이블링'],
    BarOrPub: ['카카오맵', '캐치테이블'],
    CafeOrCoffeeShop: ['카카오맵', '인스타그램 프로필'],
    Dentist: ['카카오맵', '모두닥', '굿닥'],
    MedicalClinic: ['카카오맵', '모두닥', '굿닥'],
    HairSalon: ['카카오맵', '카카오헤어샵'],
    LodgingBusiness: ['카카오맵', '야놀자', '여기어때'],
};

export function profileSites(category) {
    return PROFILE_SITES[schemaType(category)] || ['카카오맵', '인스타그램 프로필'];
}

// 매장 정보로 확인할 수 없는 외부 채널 일. 사장님이 직접 체크합니다(체크리스트와 같은 id).
// 순서는 빠른 순입니다: ① 지금 답변·출처 확인 → ② 이미 인용되는 글의 정보 맞추기 → ③ 질문형 글 → ④ AI별 통로 넓히기.
// core: 그 AI에 가장 중요한 통로(종합 준비도에서 3배) · work: 작업 시간 어림 · eta: 반영 시간 어림값(공식 확인은 아님)
// template: 복사해 쓸 초안(buildTemplates 의 key) · needsSite: 홈페이지가 있을 때만 · optional: 건너뛰어도 되는 일
export function externalSteps(place, activity) {
    if (!place) return [];
    const links = Array.isArray(place.detail?.links) ? place.detail.links : null;
    const hasYoutube = links ? links.some((link) => /유튜브|youtube/i.test(link)) : null;
    const hasSite = links ? links.some((link) => /홈페이지|웹사이트|homepage/i.test(link)) : null;
    const question = targetQuestion(place);
    const area = placeArea(place);
    const searchWord = `${area ? `${area} ` : ''}${searchCategory(place)}`;
    const steps = [
        // 지금 당장
        {
            id: 'measure', stage: 'now', group: 'common', platforms: ALL_AI, first: true, work: '15분', template: 'prompts',
            title: `기준점 기록: "${question}"을 다섯 AI에 물어 몇 번째로 추천되는지 적기`,
            how: `${tab('measure')}에 순위를 넣으면 "AI 답변에 우리 가게가 나온 비율"(점유율)이 계산됩니다. 같은 질문으로 다시 물어야 변화를 알 수 있습니다.`,
        },
        {
            id: 'srcNaver', stage: 'now', group: 'naver', platforms: ['naver'], lead: true, work: '10분',
            title: `네이버에서 "${question}" 검색 → AI 브리핑 출처와 1페이지 블로그·카페 글 3~5개 적어 두기`,
            how: '새 글을 써서 올라가길 기다리는 것보다, 이미 위에 떠 있는 글의 매장 정보를 맞추는 편이 빠를 것으로 봅니다. 글 주소와 운영자 연락 방법을 적어 두세요.',
        },
        {
            id: 'srcChatgpt', stage: 'now', group: 'chatgpt', platforms: ['chatgpt'], lead: true, work: '10분',
            title: `ChatGPT 답변 아래 출처 링크와, Bing에서 "${question}" 검색 1페이지 글 3~5개 적어 두기`,
            how: 'ChatGPT 검색이 참고하는 것으로 보이는 글입니다. 내 매장이 빠져 있거나 정보가 옛것인 글을 표시해 두세요.',
        },
        {
            id: 'srcGemini', stage: 'now', group: 'gemini', platforms: ['gemini'], lead: true, work: '10분',
            title: `Gemini·구글 AI 개요의 출처 링크와, 구글에서 "${question}" 검색 1페이지 글 3~5개 적어 두기`,
            how: '구글 지도 목록에 내 매장이 나오는지도 함께 보세요. 지도에 없으면 아래 구글 비즈니스 프로필 등록이 먼저입니다.',
        },
        {
            id: 'srcClaude', stage: 'now', group: 'claude', platforms: ['claude'], lead: true, work: '10분',
            title: `Claude 답변의 출처와, Brave 검색(search.brave.com)에서 "${question}" 검색 상위 글 3~5개 적어 두기`,
            how: 'Claude는 Brave 검색 결과를 참고하는 것으로 보입니다(공식 확인은 아님). 네이버·구글과 상위 글이 다를 수 있으니 따로 확인하세요.',
        },
        {
            id: 'srcPerplexity', stage: 'now', group: 'perplexity', platforms: ['perplexity'], lead: true, work: '10분',
            title: `Perplexity에 "${question}"을 묻고 답변에 붙은 [1]·[2] 출처 링크 3~5개 적어 두기`,
            how: 'Perplexity는 답변마다 출처 번호를 보여 줍니다. 어떤 글의 표·요약이 인용됐는지 보면 내 글을 어떻게 써야 할지 알 수 있습니다.',
        },
        {
            id: 'gbp', stage: 'now', group: 'gemini', platforms: ['gemini'], core: ['gemini'], work: '20분', template: 'napCard',
            eta: '인증에 며칠~2주 · 반영은 인증 뒤 1~2일',
            title: '구글 비즈니스 프로필 등록·인증 신청',
            how: `인증(영상·전화·우편)에 시간이 걸려 오늘 신청하는 것이 가장 빠릅니다. 상호·주소·전화·영업시간은 ${tab('drafts')}의 "통일 표기"를 그대로 붙여 넣으세요.`,
        },
        {
            id: 'bingPlaces', stage: 'now', group: 'chatgpt', platforms: ['chatgpt'], core: ['chatgpt'], work: '20분', template: 'napCard',
            eta: '1~2일',
            title: 'Bing Places에 매장 등록',
            how: 'ChatGPT가 지역 추천에 참고하는 것으로 보이는 곳입니다(공식 확인은 아님). 구글 비즈니스 프로필 인증이 끝났다면 "가져오기"로 등록하고, 아니면 "통일 표기"를 직접 입력하세요.',
        },
        {
            id: 'sourceUpdate', stage: 'now', group: 'common', platforms: ALL_AI, core: ALL_AI, work: '30분', eta: '1~3일', template: 'sourceRequest',
            title: '적어 둔 출처 글 운영자에게 매장 정보(메뉴·가격·위치·영업시간) 갱신 요청하기',
            how: `이미 검색에 잡힌 글을 바로잡는 방법이라 모든 AI에 비교적 빨리 반영될 것으로 봅니다. ${tab('drafts')}의 "출처 글 수정 요청문"을 보내세요. 원고료·식사 같은 대가가 있으면 글에 광고 표기가 꼭 들어가야 하고, 평가·문구는 정해 주지 않습니다.`,
        },
        // 1주 차
        {
            id: 'faqPage', stage: 'week1', group: 'common', platforms: ALL_AI, core: ['claude', 'perplexity'], work: '40분', eta: '2~5일', template: 'answerPost',
            title: '블로그·홈페이지에 "질문형 제목 + 2~3줄 답 + 표" 글 1개 올리기',
            how: `${tab('drafts')}의 "질문형 글" 초안을 붙여 넣고 가격처럼 비어 있는 칸만 채우세요. 제목은 손님이 실제로 묻는 말 그대로 쓰고, 글 끝에 최종 수정일을 적습니다. 지금 그 질문의 맨 위에 뜨는 글이 표·목록·문단 중 어떤 모양인지 보고 같은 모양으로 맞추세요. 사람이 보는 내용과 검색 로봇이 읽는 내용이 같아야 합니다.`,
        },
        {
            id: 'napSame', stage: 'week1', group: 'common', platforms: WEB_AI, work: '15분', template: 'napCard',
            title: '구글·Bing·카카오맵 표기를 네이버와 한 글자까지 똑같이 맞추기',
            how: '상호 띄어쓰기·주소·전화번호·영업시간이 한 글자라도 다르면 AI가 다른 매장으로 볼 수 있습니다. "통일 표기"를 복사해 모든 곳에 같은 글자로 넣으세요.',
        },
        {
            id: 'questions', stage: 'week1', group: 'naver', platforms: ['naver', 'gemini'], work: '10분',
            title: `네이버·구글 검색창에 "${searchWord}" 입력 → 자동완성·함께 찾는 질문 5개 적기`,
            how: '손님이 실제로 치는 말입니다. 소식·블로그 글 제목과 질문·답변을 그 말 그대로 쓰면 AI가 질문과 답을 짝짓기 쉬워질 수 있습니다.',
        },
        {
            id: 'gbpFill', stage: 'week1', group: 'gemini', platforms: ['gemini'], work: '30분', template: 'gbpDescription',
            title: "구글 프로필에 업체 설명·메뉴(서비스)·사진 10장을 채우고 '업데이트' 글 1개 올리기",
            how: `업체 설명은 ${tab('drafts')}의 "구글 프로필 설명"을 쓰세요. 메뉴(서비스)마다 이름·가격·한 줄 설명을 사실대로 적습니다. Gemini는 구글 지도의 서비스 항목과 리뷰 문장을 요약해 쓰는 것으로 보입니다(공식 확인은 아님).`,
        },
        {
            id: 'robots', stage: 'week1', group: 'chatgpt', platforms: WEB_AI, needsSite: true, work: '10분', template: 'robots',
            title: '홈페이지의 robots.txt(로봇 출입 안내 파일)가 AI 검색 로봇을 막지 않는지 확인',
            how: `OAI-SearchBot(ChatGPT)·Bingbot(Bing)·Googlebot(구글)·Claude-SearchBot(Claude)·PerplexityBot(Perplexity)·Yeti(네이버)는 각 검색이 홈페이지를 읽으러 보내는 로봇의 이름입니다. 이 로봇들을 막아 두면 그 검색에 홈페이지 글이 잡히지 않을 수 있습니다. ${tab('drafts')}의 "robots.txt 예시"와 비교해 홈페이지를 만든 분에게 확인을 부탁하세요.`,
        },
        {
            id: 'bingWebmaster', stage: 'week1', group: 'chatgpt', platforms: ['chatgpt'], needsSite: true, work: '20분', eta: '1~7일',
            title: "Bing 웹마스터 도구에 홈페이지 등록 → 사이트맵(글 목록 파일) 제출 → 새 글 주소는 'URL 제출'",
            how: 'Bing 웹마스터 도구는 내 홈페이지 글을 Bing 검색에 알리는 무료 도구입니다. 구글에만 등록해 두면 ChatGPT 쪽 반영이 늦을 수 있습니다. 호스팅이 IndexNow(새 글을 검색엔진에 바로 알리는 방식)를 지원하면 함께 켜세요. 제출이 곧 노출을 뜻하지는 않습니다.',
        },
        // 2주 차
        {
            id: 'googleReviews', stage: 'week2', group: 'gemini', platforms: ['gemini'], work: '15분', template: 'reviewAsk',
            title: '매장 리뷰 안내문에 구글 리뷰 링크도 함께 넣기',
            how: `${tab('drafts')}의 "리뷰 안내문"을 쓰세요. "${reviewAskLine(place)}"만 부탁하고, 리뷰 대가로 할인을 주거나 별점·문구를 정해 주지 마세요.`,
        },
        {
            id: 'youtube', stage: 'week2', group: 'gemini', platforms: ['gemini'], work: '1시간', template: 'youtube',
            eta: '1~12시간(활동 중인 채널) · 새 채널은 하루 이상',
            title: '유튜브 쇼츠 2개 올리고 플레이스에 연결',
            how: `이미 운영하는 채널에 올리세요(새 채널은 반영이 더 느린 것으로 보입니다). 제목·설명란 첫 줄·처음 10초 말에 지역·업종·상호·${josa(mainItemWord(place), '을', '를')} 사실대로 넣고, 자동 자막이 상호를 틀리게 적으면 직접 고칩니다.`,
            done: hasYoutube === true ? true : undefined,
        },
        {
            id: 'freshDate', stage: 'week2', group: 'perplexity', platforms: ['perplexity'], work: '10분',
            title: "질문형 글 제목에 연도를 넣고, 가격·영업시간이 바뀔 때마다 본문과 '최종 수정일'을 함께 고치기",
            how: 'Perplexity는 최근에 고쳐진 글을 출처로 고르는 편으로 보입니다(공식 확인은 아님). 내용은 그대로 두고 날짜만 바꾸는 것은 하지 마세요.',
        },
        {
            id: 'profiles', stage: 'week2', group: 'perplexity', platforms: ['perplexity', 'chatgpt', 'gemini'], work: '30분', template: 'napCard',
            title: `${profileSites(place.category).join('·')}의 매장 소개·영업시간·${healthWords(place)?.item || '메뉴'} 최신화`,
            how: 'AI는 업종별 예약·리뷰 서비스의 매장 페이지도 출처로 삼는 것으로 보입니다(공식 확인은 아님). 등록돼 있지 않으면 무료 등록부터 하세요.',
        },
        {
            id: 'jsonld', stage: 'week2', group: 'claude', platforms: WEB_AI, needsSite: true, work: '15분', template: 'jsonld',
            title: '홈페이지에 매장 정보 코드(LocalBusiness 구조화 데이터) 붙이기',
            how: `LocalBusiness는 검색엔진·AI가 "이 홈페이지는 매장 하나의 정보"라고 알아보도록 매장 이름·주소·영업시간을 적어 두는 표준 코드입니다. ${tab('drafts')}의 "구조화 데이터"를 복사해 홈페이지 <head> 안에 넣어 달라고 홈페이지를 만든 분에게 전달하세요. 화면에 없는 평점·리뷰 수는 넣지 않습니다.`,
        },
        {
            id: 'searchConsole', stage: 'week2', group: 'gemini', platforms: ['gemini'], needsSite: true, work: '20분', eta: '수일',
            title: "구글 서치 콘솔에 홈페이지 등록 → 사이트맵(글 목록 파일) 제출 → 새 글은 'URL 검사'에서 검색 등록 요청",
            how: '구글 서치 콘솔은 내 홈페이지 글을 구글에 알리는 무료 도구입니다. 요청이 곧 노출을 뜻하지는 않습니다.',
        },
        {
            id: 'naverAdvisor', stage: 'week2', group: 'naver', platforms: ['naver'], needsSite: true, work: '20분',
            title: "네이버 서치어드바이저에 홈페이지 등록 → 사이트맵(글 목록 파일) 제출 → 새 글은 '웹 페이지 수집' 요청",
            how: '네이버 서치어드바이저는 내 홈페이지 글을 네이버 검색에 알리는 무료 도구입니다. 홈페이지의 질문형 글이 네이버 검색에 잡히게 알리는 일입니다.',
        },
        {
            id: 'localListings', stage: 'week2', group: 'chatgpt', platforms: ['chatgpt', 'perplexity'], optional: true, work: '30분', template: 'napCard',
            title: 'Foursquare·오픈스트리트맵(해외 지도·장소 서비스)에 매장 정보 등록',
            how: 'ChatGPT·Perplexity가 지역 질문에서 이 지도 정보를 참고하는 것으로 보이지만 확인된 것은 아닙니다. 상호·주소·전화·영업시간만 사실대로 넣으세요.',
        },
        {
            id: 'press', stage: 'week2', group: 'chatgpt', platforms: ['chatgpt', 'naver'], optional: true, work: '1~2시간', eta: '1~3일', template: 'press',
            title: '지역 매체에 사실·수치 중심 보도자료 1건 내기(비용 발생)',
            how: `이전·영업시간 확대·새 행사처럼 실제 소식이 있을 때만 하세요. AI가 뉴스 기사를 사실을 확인할 때 참고하는 것으로 보입니다(공식 확인은 아님). 기사형 광고라면 광고 표기를 확인하세요.`,
        },
        // 1개월 안
        {
            id: 'llms', stage: 'month1', group: 'claude', platforms: ['claude'], needsSite: true, optional: true, work: '10분', template: 'llms',
            title: 'llms.txt(AI에게 내 홈페이지를 요약해 알려 주는 안내 파일) 올리기',
            how: `AI가 읽는다는 보장은 없는 새 제안 형식입니다. ${tab('drafts')}의 "llms.txt 초안"을 홈페이지 맨 위 경로(내 주소/llms.txt)에 올려 달라고 홈페이지를 만든 분에게 전달하세요.`,
        },
    ];
    if (list(activity?.briefing).length) {
        steps.push({
            id: 'briefingCheck', stage: 'month1', group: 'naver', platforms: ['naver'], work: '10분',
            title: 'AI 브리핑 문장에 틀린 사실이 없는지 확인',
            how: '틀린 내용이 있으면 소개글·메뉴 설명·소식에 정확한 사실을 적어 다음 요약에 반영되게 하세요.',
        });
    }
    steps.push({
        id: 'remeasure', stage: 'month1', group: 'common', platforms: ALL_AI, work: '15분', template: 'prompts',
        title: '같은 질문으로 다시 물어 기준점과 비교하기(가능하면 매주 같은 요일에)',
        how: `${tab('measure')}에 다시 기록하면 지난번보다 올랐는지 보여 줍니다. 순위가 밀린 AI는 답변에 나온 다른 매장의 출처 글을 열어 어떤 정보가 있는지 보고, 내 글·플레이스에 빠진 사실을 채우세요.`,
    });
    return steps.map((step) => ({
        ...step,
        // 연결된 홈페이지가 안 보이면 홈페이지 일은 건너뛰어도 되는 일로 둡니다.
        optional: Boolean(step.optional || (step.needsSite && hasSite === false)),
        manual: true,
        gain: null,
    }));
}

function gainTotal(action) {
    return action.gain ? action.gain.geo + action.gain.aeo : -1;
}

function actionLevel(action) {
    const total = gainTotal(action);
    if (total >= 6) return 'high';
    if (total >= 2) return 'mid';
    return 'low';
}

// 매장 데이터로 바로 판정·계산할 수 있는 할 일. patch 는 "그 일을 했다고 칠 때" 바뀌는 값입니다.
function dataActions(ctx) {
    const { place, activity, nowMs, hype, consistency, share } = ctx;
    const detail = place.detail || null;
    const visitor = activity?.visitor || null;
    const blog = activity?.blog || null;
    const feeds = activity?.feeds || null;
    const keywords = Array.isArray(place.keywords) ? place.keywords : null;
    const links = Array.isArray(detail?.links) ? detail.links : null;
    const posMenus = list(detail?.pos?.popularMenus).map((m) => m.name);
    const reviewMenus = list(place.reviewMenus).map((m) => m.label);
    const topMenus = uniq([...posMenus, ...reviewMenus]).slice(0, 2);
    // 소식 제목·"강남 최고" 대신 쓸 말 같은 한마디 자리는 키워드 추천이 대표가 아니라고 뺀 낱말(횟집의 김밥)을 쓰지 않습니다.
    const headMenu = headlineMenus(place, activity, 1)[0] || null;
    const food = briefingEligible(place);
    const items = [];
    const add = (item) => items.push(item);
    // 업종 때문에 해당 없는 일(병의원의 새소식·쿠폰, 약국의 쿠폰·예약)은 할 일로 올리지 않습니다(place-industry.js)
    const industry = notApplicableOf(place);

    // 엔티티 빈칸
    const hoursOk = detail?.hours ? detail.hours.registered : Boolean(place.hasOpeningHours);
    const napMissing = [!place.address && '주소', !place.hasPhone && '전화번호', !hoursOk && '영업시간', !place.category && '업종'].filter(Boolean);
    if (napMissing.length) {
        add({
            id: 'napFill', stage: 'now', platforms: ALL_AI, factors: ['entity', 'structured', 'fanout'],
            title: `스마트플레이스에 비어 있는 ${napMissing.join('·')} 등록하기`,
            now: `비어 있음: ${napMissing.join(', ')}`, target: '상호·주소·전화·영업시간·업종 모두 등록',
            how: '스마트플레이스 업체정보에서 바로 고칠 수 있습니다. 영업시간은 요일별·브레이크타임·정기휴무까지 적으세요.',
            patch: (p) => {
                if (!p.address) p.address = '등록한 주소';
                if (!p.category) p.category = '업종';
                p.hasPhone = true;
                p.hasOpeningHours = true;
                if (p.detail && !p.detail.hours?.registered) p.detail.hours = { registered: true, days: SAMPLE_HOURS, regularClosed: null };
            },
        });
    }

    // 메뉴·가격·설명
    const menuCount = place.menuCount || 0;
    const priced = place.menuPricedCount || 0;
    const described = place.menuDescribedCount || 0;
    // 약국·병원 계열은 메뉴판·가격표가 없어 "메뉴·가격" 대신 취급 품목(진료 과목)·서비스를 한 줄 설명과 함께 적게 안내합니다(점수 계산은 같음).
    const health = healthWords(place);
    if (menuCount === 0) {
        add({
            id: 'menuAdd', stage: 'now', platforms: ALL_AI, factors: ['structured', 'multiturn', 'fanout', 'atomic'],
            title: health ? `${health.item} 5개를 한 줄 설명과 함께 등록하기 (예: ${health.examples})` : '대표 메뉴(서비스) 5개를 가격·한 줄 설명과 함께 등록하기',
            now: health ? `등록된 ${health.item} 없음` : '등록된 메뉴 없음',
            target: health ? `${health.item} 5개 · 설명 모두` : '메뉴 5개 · 가격·설명 모두',
            how: health
                ? '사진만 올리면 AI가 읽지 못할 수 있습니다. 실제로 하는 것만 이름과 한 줄 설명을 글자로 넣고, 가격을 알릴 수 있는 것만 가격을 적으세요. 효과를 단정하는 표현은 쓰지 않습니다.'
                : '메뉴판 사진만 올리면 AI가 읽지 못할 수 있습니다. 이름·가격·설명을 글자로 넣으세요.',
            patch: (p) => {
                p.menuCount = 5;
                p.menuPricedCount = 5;
                p.menuDescribedCount = 5;
                p.reviewMenus = list(p.reviewMenus).length ? p.reviewMenus : [{ label: '대표 메뉴', count: 1 }];
            },
        });
    } else {
        if (priced < menuCount) {
            add({
                id: 'menuPrice', stage: 'now', platforms: ALL_AI, factors: ['structured', 'multiturn', 'fanout'],
                title: `가격이 빠진 ${health ? health.item : '메뉴'} ${menuCount - priced}개에 가격 적기`,
                now: `가격 ${priced}/${menuCount}개`, target: `${menuCount}/${menuCount}개`,
                how: health ? '가격을 알릴 수 있는 것은 숫자 가격(또는 최소 가격)을, 아니면 "방문 상담"처럼 안내를 적으세요.'
                    : '"시가·문의"보다 숫자 가격(또는 최소 가격)을 적어야 "가격대는?" 질문에 답이 됩니다.',
                patch: (p) => { p.menuPricedCount = p.menuCount; },
            });
        }
        if (described < menuCount) {
            const missing = menuCount - described;
            const batch = Math.min(missing, 5);
            add({
                id: 'menuDesc', stage: missing <= 5 ? 'week1' : 'week2', platforms: ALL_AI, factors: ['structured'],
                title: health ? `설명 없는 ${health.item} ${missing}개 중 손님이 많이 찾는 ${batch}개부터 한 줄 설명 쓰기${topMenus.length ? ` (예: ${topMenus.join('·')})` : ''}`
                    : `설명 없는 메뉴 ${missing}개 중 인기 메뉴 ${batch}개부터 한 줄 설명 쓰기${topMenus.length ? ` (예: ${topMenus.join('·')})` : ''}`,
                now: `설명 ${described}/${menuCount}개`, target: `${described + batch}/${menuCount}개`,
                how: health ? '무엇을 하는지·어떻게 이용하는지·이용 시간을 사실대로 한 줄씩 쓰세요. 효과를 단정하는 표현은 쓰지 않습니다. AI가 이 설명을 그대로 가져다 쓸 수 있습니다.'
                    : `${{ 메뉴: '재료·양(몇 인분)·맛 특징', 시술: '구성·걸리는 시간' }[menuWord(place)] || '품목·이용 방법'}을 사실대로 한 줄씩 쓰세요. AI가 메뉴 설명을 그대로 가져다 쓸 수 있습니다.`,
                patch: (p) => { p.menuDescribedCount = (p.menuDescribedCount || 0) + batch; },
            });
        }
    }

    // 소개글·한 줄 소개
    const length = descriptionLength(place);
    const needDesc = length !== null && length < ATOMIC_MIN;
    const needIntro = !place.intro;
    if (needDesc || needIntro) {
        add({
            id: 'intro', stage: 'now', platforms: ['naver', 'gemini', 'claude', 'perplexity'], factors: ['atomic'], template: 'intro',
            title: needDesc && needIntro ? '소개글 첫 문단(한 문단 답변 초안)과 한 줄 소개 채우기'
                : needDesc ? '소개글 첫 문단을 한 문단 답변 초안으로 바꾸기' : `한 줄 소개(매장 이름 아래 문구)에 ${health ? `대표 ${health.item}` : '대표 메뉴'}·지역을 사실대로 적기`,
            now: [needDesc ? (length > 0 ? `소개글 ${length}자` : '소개글 없음') : null, needIntro ? '한 줄 소개 없음' : null].filter(Boolean).join(' · '),
            target: [needDesc ? `소개글 ${ATOMIC_MIN}자 이상·첫 문장 두괄식` : null, needIntro ? '한 줄 소개 등록' : null].filter(Boolean).join(' · '),
            how: '첫 문장에 "어디에 있는 어떤 매장인지 + 확인할 수 있는 근거 2가지"를 넣으세요. 최상급 표현은 빼세요.',
            patch: (p) => {
                if (needDesc) {
                    if (p.detail) p.detail.descriptionLength = ATOMIC_MIN + 20;
                    if (p.missing) p.missing.description = false;
                }
                if (needIntro) p.intro = '대표 메뉴 소개';
            },
        });
    }

    // 주차·편의시설
    const parkingItem = ctx.fanout.find((item) => item.key === 'parking');
    if (detail && parkingItem?.status === 'no') {
        add({
            id: 'parking', stage: 'now', platforms: ['naver', 'chatgpt', 'gemini', 'perplexity'], factors: ['fanout', 'structured'],
            title: '주차(가능·불가·근처 주차장)와 편의시설(포장·단체석·무선 인터넷 등) 등록하기',
            now: '주차·편의시설 정보 없음', target: '주차 여부 + 편의시설 2개 이상',
            how: '주차가 안 되면 "주차 불가, ○○ 공영주차장 도보 3분"처럼 대안을 적으세요. 그것도 손님 질문의 답입니다.',
            patch: (p) => {
                p.detail.parking = { available: true, free: null, valet: false };
                p.conveniences = uniq([...list(p.conveniences), '포장', '단체 이용 가능']);
            },
        });
    }

    // 대표키워드
    const candidates = keywordCandidates(place, 10);
    let used = 0;
    if (keywords && keywords.length < 5) {
        const need = 5 - keywords.length;
        const picks = candidates.slice(0, need);
        used = picks.length;
        add({
            id: 'keywordsFill', stage: 'week1', platforms: ['naver'], factors: ['keywords'],
            title: `대표키워드 ${need}개 더 등록${picks.length ? ` — 후보: ${picks.join(', ')}` : ''}`,
            now: `${keywords.length}/5개`, target: '5/5개',
            how: '손님 리뷰에 실제로 나오는 메뉴·용도 표현에 지역명을 붙이세요. 경쟁 매장 상호나 관계없는 지역은 넣지 마세요.',
            patch: (p) => { p.keywords = [...p.keywords, ...picks, ...Array(need - picks.length).fill('추가키워드')].slice(0, 5); },
        });
    }
    if (keywords && consistency?.checked.length) {
        const rankOf = new Map((share?.rows || []).map((row) => [row.keyword, row.rank]));
        const keepTop = (keyword) => rankOf.get(keyword) && rankOf.get(keyword) <= SHARE_LISTED_MAX_RANK;
        const weak = consistency.checked.filter((entry) => !entry.matched && !keepTop(entry.keyword)).map((entry) => entry.keyword);
        const kept = consistency.checked.filter((entry) => !entry.matched && keepTop(entry.keyword)).map((entry) => entry.keyword);
        const swaps = candidates.slice(used, used + weak.length);
        if (weak.length && swaps.length) {
            const replace = new Map(weak.slice(0, swaps.length).map((keyword, i) => [keyword, swaps[i]]));
            add({
                id: 'keywordsMatch', stage: 'week2', platforms: ['naver'], factors: ['keywords'],
                title: `리뷰에 안 나오는 대표키워드 ${[...replace.keys()].join(', ')} → ${[...replace.values()].join(', ')}처럼 리뷰 표현으로 바꾸기 검토`,
                now: `리뷰·AI 브리핑과 겹치는 키워드 ${consistency.matched}/${consistency.checked.length}개`,
                target: `${consistency.matched + replace.size}/${consistency.checked.length}개`,
                how: `검색 순위 10위 안인 키워드는 바꾸지 마세요.${kept.length ? ` (${kept.join(', ')}은(는) 순위가 좋아 유지)` : ''} 바꾼 뒤 2주쯤 지나 순위를 다시 조회하세요.`,
                patch: (p) => { p.keywords = p.keywords.map((keyword) => replace.get(keyword) || keyword); },
            });
        }
    }

    // 광고성 표현
    if (hype.length) {
        const words = uniq(hype.map((h) => h.word));
        const wheres = uniq(hype.map((h) => h.where));
        add({
            id: 'hype', stage: 'now', platforms: ['naver', 'chatgpt', 'claude', 'perplexity'], factors: ['tone'],
            title: `광고성 표현 ${words.map((w) => `"${w}"`).join(', ')} 빼기 (${wheres.join('·')})`,
            now: `${hype.length}곳에서 발견`, target: '0곳 · 확인할 수 있는 수치·사실로 바꾸기',
            how: `"강남 최고"보다 ${headMenu ? `"${headMenu} 1인분 가격·양"` : '"도보 5분·주차 가능"'}처럼 확인할 수 있는 사실이 AI 답변에 쓰이기 쉽습니다.`,
            patch: (p, a) => {
                if (Array.isArray(p.keywords)) p.keywords = p.keywords.map(stripHype);
                p.intro = stripHype(p.intro);
                if (a?.feeds) a.feeds.latestTitle = stripHype(a.feeds.latestTitle);
            },
        });
    }

    // 채널 연결
    if (!place.hasTalktalk) {
        add({
            id: 'talktalk', stage: 'now', platforms: ['naver', 'chatgpt', 'gemini'], factors: ['sameAs', 'multiturn', 'fanout'],
            title: '네이버 톡톡 연결하기 — "예약 돼요?·주차 돼요?"를 바로 받는 창구',
            now: '톡톡 없음', target: '톡톡 연결·알림 켜기',
            how: '스마트플레이스에서 톡톡을 켜고 휴대폰 알림을 받게 해 두면 답이 빨라집니다.',
            patch: (p) => { p.hasTalktalk = true; },
        });
    }
    if (detail?.hasBooking === false && !industry.booking) {
        add({
            id: 'booking', stage: 'week2', platforms: ['naver', 'chatgpt', 'gemini'], factors: ['multiturn', 'fanout'],
            title: food ? '네이버 예약 켜기 — 단체석·회식 자리처럼 일부만 열어도 됩니다' : '네이버 예약 켜기 — 상담·방문 가능한 시간만 열어도 됩니다',
            now: '네이버 예약 없음', target: '예약 받기',
            how: '추천을 받은 손님이 바로 묻는 것이 "예약 돼요?"입니다. 받을 수 있는 만큼만 열어 두세요.',
            patch: (p) => { p.detail.hasBooking = true; },
        });
    }
    if (links && links.length < 3) {
        const need = 3 - links.length;
        const types = LINK_TYPES.filter((type) => !links.some((link) => link.includes(type))).slice(0, need);
        add({
            id: 'links', stage: 'week2', platforms: WEB_AI, factors: ['sameAs'],
            title: `플레이스에 ${types.join('·')} 연결하기`,
            now: `연결 ${links.length}개${links.length ? `(${links.join('·')})` : ''}`, target: '3개 이상',
            how: '실제로 운영하는 채널만 연결하고, 각 채널 소개에도 플레이스와 같은 상호·주소·전화번호를 쓰세요.',
            patch: (p) => { p.detail.links = [...p.detail.links, ...types]; },
        });
    }
    if (!place.hasBlog) {
        add({
            id: 'naverBlog', stage: 'month1', platforms: ['naver', 'claude', 'perplexity'], factors: ['sameAs'],
            title: `네이버 블로그를 만들어 플레이스에 연결 — 첫 글은 ${health ? `${health.item}·이용 안내` : '메뉴·가격'}·찾아오는 길 정리`,
            now: '연결된 블로그 없음', target: '블로그 연결 + 글 1개',
            how: '사장님이 직접 쓴 블로그 글은 AI가 매장을 설명할 때 인용하는 글이 될 수 있습니다. 사실만 쓰세요.',
            patch: (p) => { p.hasBlog = true; },
        });
    }

    // 쿠폰
    const coupon = couponState(place, activity);
    if (coupon.known && !(coupon.total > 0) && !industry.coupon) {
        add({
            id: 'coupon', stage: 'now', platforms: ['naver'], factors: ['naverAi', 'fanout'],
            title: `첫 방문 쿠폰 1개 등록하기 (예: ${food ? '음료 1잔·사이드 1개' : '첫 방문 10% 할인'})`,
            now: `쿠폰 0개${coupon.extras.length ? ` · ${coupon.extras.slice(0, 2).join(', ')}` : ''}`, target: '쿠폰 1개 이상',
            how: '쿠폰은 플레이스 화면과 "혜택 있는 곳" 질문에 쓰일 수 있습니다. 리뷰 작성이나 별점을 조건으로 걸지 마세요.',
            patch: (p, a) => {
                if (a?.coupons) a.coupons.total = 1;
                if (p.detail) p.detail.couponCount = 1;
            },
        });
    }

    // 소식
    const days = feedAge(feeds, nowMs);
    const feedStale = feeds ? feeds.count === 0 || (days !== null && days > 14) : detail?.hasFeed === false;
    if (feedStale && !industry.feed) {
        const topic = headMenu;
        add({
            id: 'feed', stage: 'now', platforms: ['naver'], factors: ['freshness', 'qna'], template: 'feedPost',
            title: `오늘 소식 1개 올리기 — ${topic ? `"${topic}" 소개, ` : ''}이번 달 휴무·${feedTopicWords(place)} 중 하나`,
            now: !feeds || feeds.count === 0 ? '소식 없음' : `마지막 소식 ${days}일 전`, target: '14일 안에 1개, 이후 2주마다 1개',
            how: `${tab('drafts')}의 "플레이스 소식" 초안을 쓰세요. 제목은 손님이 묻는 말(지역 + 업종)로 시작하고 ${health ? `${health.item} 이름·이용 시간` : '메뉴 이름·가격'}·날짜 같은 사실을 넣습니다. "역대급·최고" 같은 표현은 뺍니다.`,
            patch: (p, a) => {
                if (a) {
                    const before = a.feeds || { count: 0, last30: 0 };
                    // 오늘 올렸다고 칠 때는 날짜(latest)도 오늘로 바꿉니다(경과일을 날짜에서 다시 세므로 — 그렇지 않으면 점수가 오르지 않음).
                    a.feeds = { ...before, count: before.count + 1, latest: kstDateText(nowMs).replace(/\./g, '-'), daysSinceLatest: 0, last30: (before.last30 || 0) + 1, latestTitle: topic || '새 소식' };
                }
                if (p.detail) p.detail.hasFeed = true;
            },
        });
    }

    // 메뉴 최신화
    const menuAge = menuAgeDays(place, nowMs);
    if (menuAge !== null && menuAge > 90) {
        add({
            id: 'menuRefresh', stage: 'week1', platforms: ['naver'], factors: ['freshness'],
            title: '메뉴 가격·사진을 지금 기준으로 점검해 다시 저장하기',
            now: `메뉴 수정 ${menuAge}일 전`, target: '90일 안에 한 번',
            how: '가격이 바뀌었다면 반드시 고치세요. AI가 옛 가격을 답하면 손님 불만으로 이어질 수 있습니다.',
            patch: (p) => { p.detail.menuUpdatedAt = kstDateText(nowMs); },
        });
    }

    // 리뷰 답글
    if (visitor && visitor.sampled >= REPLY_MIN_SAMPLE && Number.isFinite(visitor.replyRate) && visitor.replyRate < REPLY_TARGET) {
        const need = Math.max(1, Math.ceil((visitor.sampled * REPLY_TARGET) / 100) - (visitor.replied || 0));
        add({
            id: 'reply', stage: 'week1', platforms: ['naver'], factors: ['qna'],
            title: `최근 리뷰 ${need}개에 답글 달기 — 하루 ${Math.ceil(need / 7)}개씩 이번 주 안에`,
            now: `답글률 ${visitor.replyRate}% (최근 리뷰 ${visitor.sampled}개 중 ${visitor.replied || 0}개)`, target: `답글률 ${REPLY_TARGET}% 이상`,
            how: `답글에 주차·예약·${mainItemWord(place)} 같은 사실을 한 줄 넣으면 AI가 쓸 수 있는 "답변 문장"이 될 수 있습니다. 같은 문장 복사·키워드 나열은 피하세요.`,
            link: { href: '/dashboard/review-reply', label: '리뷰 답글 도우미로 초안 만들기' },
            patch: (p, a) => {
                a.visitor.replied = (a.visitor.replied || 0) + need;
                a.visitor.replyRate = Math.round((a.visitor.replied / a.visitor.sampled) * 100);
            },
        });
    }
    if (visitor && visitor.last7 === 0) {
        add({
            id: 'reviewAsk', stage: 'week1', platforms: ['naver', 'gemini'], factors: ['freshness'], template: 'reviewAsk',
            title: '이번 주부터 손님 리뷰 요청 — 계산대·테이블에 영수증 리뷰 QR 안내 놓기',
            now: `최근 7일 리뷰 0개 · 30일 ${visitor.last30}개`, target: '매주 1개 이상',
            how: '"솔직한 후기 부탁드려요"만 적으세요. 할인·서비스를 조건으로 별점·문구를 정해 주면 정책 위반입니다.',
            patch: (p, a) => {
                a.visitor.last7 = 1;
                a.visitor.last30 = Math.max(1, a.visitor.last30 || 0);
            },
        });
    }

    // 블로그·카페 후기
    if (blog && Number.isFinite(blog.last30) && blog.last30 < 3) {
        const invite = 3 - blog.last30;
        add({
            id: 'blogRecent', stage: 'week1', platforms: ['naver', 'chatgpt', 'claude', 'perplexity'], factors: ['sources'],
            title: `이번 주 블로그 체험단 ${invite}명 초대 — 글에 '광고·협찬' 표기 필수`,
            now: `최근 30일 블로그·카페 글 ${blog.last30}개`, target: '최근 30일 3개 이상',
            how: '메뉴·가격·위치를 정리한 사실 자료를 건네고, 별점·문구는 정해 주지 마세요. 대가가 있으면 글에 광고 사실을 밝혀야 합니다(공정위 추천·보증 심사지침).',
            link: { href: '/dashboard/blog', label: '플레이스 블로그 배포 신청' },
            patch: (p, a) => {
                a.blog.last30 = 3;
                a.blog.total = (a.blog.total ?? p.blogReviews ?? 0) + invite;
                p.blogReviews = (p.blogReviews || 0) + invite;
            },
        });
    }
    const blogTotal = blog?.total ?? place.blogReviews ?? 0;
    const blogNext = BLOG_STEPS.find((step) => step > blogTotal);
    if (blogNext && blogNext - blogTotal <= 20) {
        const need = blogNext - blogTotal;
        add({
            id: 'blogTotal', stage: 'month1', platforms: ['naver', 'chatgpt', 'claude', 'perplexity'], factors: ['sources'],
            title: `블로그·카페 후기 ${need}개 더 쌓기 — 주 ${Math.ceil(need / 4)}건씩 체험단·방문 후기`,
            now: `${blogTotal.toLocaleString('ko-KR')}개`, target: `${blogNext.toLocaleString('ko-KR')}개`,
            how: '한 번에 몰아서 올리지 말고 꾸준히 쌓으세요. 같은 문구를 돌려 쓴 글은 저품질로 처리될 수 있습니다.',
            patch: (p, a) => {
                p.blogReviews = blogNext;
                if (a?.blog) a.blog.total = blogNext;
            },
        });
    }

    // 방문자 리뷰
    const reviews = place.visitorReviews || 0;
    const reviewNext = REVIEW_STEPS.find((step) => step > reviews);
    if (reviewNext && reviewNext - reviews <= 60) {
        const need = reviewNext - reviews;
        add({
            id: 'reviewsMore', stage: 'month1', platforms: ['naver', 'gemini'], factors: ['reviews', 'fanout'],
            title: `방문자 리뷰 ${need}개 더 받기 — 하루 ${Math.ceil(need / 30)}개 목표로 영수증 리뷰 안내`,
            now: `${reviews.toLocaleString('ko-KR')}개`, target: `${reviewNext.toLocaleString('ko-KR')}개`,
            how: `리뷰 요청 문구에 "${reviewAskLine(place)}"을 부탁하면 글 리뷰가 늘어, AI가 요약에 쓸 수 있는 문장도 늘 수 있습니다.`,
            patch: (p) => {
                if (Number.isFinite(p.textReviews) && reviews > 0) p.textReviews = Math.round((p.textReviews * reviewNext) / reviews);
                p.visitorReviews = reviewNext;
            },
        });
    }
    const textRatio = Number.isFinite(place.textReviews) && reviews > 0 ? place.textReviews / reviews : null;
    if (textRatio !== null && textRatio < 0.5) {
        add({
            id: 'textReview', stage: 'month1', platforms: ['naver', 'gemini'], factors: ['reviews', 'naverAi'],
            title: `리뷰 부탁할 때 "${reviewAskLine(place)}"을 함께 요청하기`,
            now: `글 리뷰 비율 ${Math.round(textRatio * 100)}%`, target: '50% 이상',
            how: `별점만 남긴 리뷰는 AI가 요약할 문장이 없습니다.${food && !list(activity?.briefing).length ? ' 글 리뷰가 쌓이면 네이버가 AI 브리핑을 만드는 재료가 될 수 있습니다.' : ''}`,
            patch: (p) => { p.textReviews = Math.ceil(reviews * 0.5); },
        });
    }
    if (reviews > 0 && !place.visitorScore) {
        add({
            id: 'scoreShow', stage: 'month1', platforms: ['naver'], factors: ['reviews'],
            title: '스마트플레이스에서 별점 표시 켜기',
            now: '별점 숨김', target: '별점 표시',
            how: '"평이 좋은 곳" 질문에 별점이 근거로 쓰일 수 있습니다. 평점이 낮다면 답글·서비스를 먼저 고친 뒤 켜세요.',
            patch: (p) => { p.visitorScore = 4.5; },
        });
    }

    // 검색 순위(결과 지표 — 점수 효과는 계산하지 않음)
    const outside = (share?.rows || []).filter((row) => !row.rank || row.rank > SHARE_LISTED_MAX_RANK);
    if (outside.length) {
        add({
            id: 'rank', stage: 'month1', platforms: ['naver'], factors: ['competition'],
            title: `10위 밖 대표키워드 ${outside.map((row) => `${row.keyword}(${row.rank ? `${row.rank}위` : '순위 밖'})`).join(', ')} — 위 키워드 순위의 순위 진단에서 부족한 신호부터 채우기`,
            now: `10위 안 ${share.listed}/${share.rows.length}개`, target: '10위 안 키워드 늘리기',
            how: '순위는 리뷰·저장·블로그 같은 신호가 쌓인 결과라 직접 올릴 수 없습니다. 리뷰·클릭을 사서 올리는 방법은 쓰지 마세요.',
        });
    }

    return items;
}

// 할 일 목록(점수 효과 큰 순) + 모두 했을 때의 예상 점수
export function buildActionPlan({ place, activity = null, ranks = null, nowMs = Date.now(), geo, aeo, fanout, hype = [], consistency, share }) {
    if (!place) return { actions: [], projected: null };
    const base = { geo: geo?.score ?? null, aeo: aeo?.score ?? null };
    const rescore = (patches) => {
        const p = structuredClone(place);
        const a = activity ? structuredClone(activity) : null;
        for (const patch of patches) patch(p, a);
        return { geo: scoreGeo(p, a, ranks, { nowMs }).score, aeo: scoreAeo(p, a).score };
    };
    const diff = (after, before) => (after === null || before === null ? 0 : after - before);
    const ctx = {
        place, activity, nowMs, hype,
        consistency: consistency || keywordConsistency(place, activity),
        share: share === undefined ? searchShare(ranks) : share,
        fanout: fanout || buildFanout(place, activity),
    };
    const data = dataActions(ctx);
    const scored = data.map(({ patch, ...item }) => {
        if (!patch) return { ...item, gain: null };
        const after = rescore([patch]);
        return { ...item, gain: { geo: diff(after.geo, base.geo), aeo: diff(after.aeo, base.aeo) } };
    });

    // 할 일로 잡히지 않은 약한 항목은 항목 설명(tip)으로라도 남깁니다.
    for (const factor of [...(geo?.factors || []), ...(aeo?.factors || [])]) {
        if (factor.pct === null || factor.pct >= 80) continue;
        if (scored.some((item) => item.factors.includes(factor.key))) continue;
        scored.push({
            id: `factor-${factor.key}`, stage: 'month1', platforms: factor.platforms, factors: [factor.key],
            title: `${factor.label} 보강`, now: `${factor.pct}점`, target: '80점 이상', how: factor.tip, gain: null,
        });
    }

    const actions = [...scored, ...externalSteps(place, activity)]
        .map((item) => ({ ...item, level: actionLevel(item) }))
        .sort((a, b) => gainTotal(b) - gainTotal(a) || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);

    const patches = data.filter((item) => item.patch).map((item) => item.patch);
    const all = patches.length ? rescore(patches) : null;
    return {
        actions,
        projected: all ? { geo: { now: base.geo, after: all.geo }, aeo: { now: base.aeo, after: all.aeo } } : null,
    };
}

// 로드맵 안 순서: 기준점 기록 → 출처 확인 → 그 AI의 핵심 통로 → 점수 오르는 플레이스 일(큰 순) → 나머지 → 선택 사항
function roadmapOrder(action, platformKey) {
    if (action.first) return 0;
    if (action.lead) return 1;
    if (action.manual && list(action.core).includes(platformKey)) return 2;
    if (!action.manual && gainTotal(action) > 0) return 3;
    if (!action.manual) return 5;
    return action.optional ? 6 : 4;
}

// AI 하나의 로드맵: 단계(지금 당장·1주·2주·1개월)별 할 일
export function buildRoadmap(actions, platformKey) {
    const mine = (actions || []).filter((action) => action.platforms.includes(platformKey));
    return ROADMAP_STAGES.map((stage) => ({
        ...stage,
        items: mine
            .filter((action) => action.stage === stage.key)
            .sort((a, b) => roadmapOrder(a, platformKey) - roadmapOrder(b, platformKey) || gainTotal(b) - gainTotal(a)),
    }));
}

// 외부 통로 진행률: 로드맵의 직접 체크하는 일 중 끝낸 비율(핵심 통로는 3배). 선택 사항은 체크했을 때만 셉니다.
// checked: 사장님이 체크한 id 목록(화면이 브라우저에 저장한 값)
const CORE_WEIGHT = 3;

export function channelProgress(actions, platformKey, checked = []) {
    const steps = (actions || []).filter((action) => action.manual && action.platforms.includes(platformKey));
    const isDone = (action) => action.done === true || checked.includes(action.id);
    const counted = steps.filter((action) => !action.optional || isDone(action));
    const weightOf = (action) => (list(action.core).includes(platformKey) ? CORE_WEIGHT : 1);
    const total = counted.reduce((sum, action) => sum + weightOf(action), 0);
    const got = counted.filter(isDone).reduce((sum, action) => sum + weightOf(action), 0);
    const core = counted.filter((action) => list(action.core).includes(platformKey));
    return {
        total: counted.length,
        done: counted.filter(isDone).length,
        coreTotal: core.length,
        coreDone: core.filter(isDone).length,
        pct: total > 0 ? Math.round((got / total) * 100) : null,
    };
}

// AI별 종합 준비도 = 재료 점수(매장 정보) × (1 − 통로 비중) + 통로 진행률 × 통로 비중.
// 네이버 밖 AI는 네이버 플레이스를 직접 읽지 못하는 것으로 보고, 외부 등록·글이 없으면 재료 점수가 높아도 종합은 낮게 나옵니다.
export function platformProgress(platforms, actions, checked = []) {
    return (platforms || []).map((platform) => {
        const channel = channelProgress(actions, platform.key, checked);
        const weight = platform.channelWeight ?? 0;
        const overall = platform.score === null || platform.score === undefined || channel.pct === null
            ? platform.score ?? null
            : Math.round(platform.score * (1 - weight) + channel.pct * weight);
        return { ...platform, channel, overall, overallGrade: scoreLabel(overall) };
    });
}

// ---------------------------------------------------------------------------
// 체크리스트 — auto: 매장 정보로 자동 판정(done true/false/null) · 그 밖은 사장님이 직접 체크
// ---------------------------------------------------------------------------

export function buildChecklist(place, activity, { geo, hype = [] } = {}) {
    const detail = place?.detail || null;
    const keywords = Array.isArray(place?.keywords) ? place.keywords : null;
    const feeds = activity?.feeds || null;
    const visitor = activity?.visitor || null;
    const length = descriptionLength(place);
    const entity = (geo?.factors || []).find((f) => f.key === 'entity');
    const coupon = couponState(place, activity);
    const menuCount = place?.menuCount || 0;
    const days = feedAge(feeds);
    const auto = (value) => (value === null || value === undefined ? null : Boolean(value));
    let feedDone = null;
    if (feeds) feedDone = feeds.count === 0 ? false : days === null ? null : days <= 14;
    else if (detail?.hasFeed === false) feedDone = false;
    const replyKnown = visitor && visitor.sampled >= REPLY_MIN_SAMPLE && Number.isFinite(visitor.replyRate);
    const industry = notApplicableOf(place);
    // 약국·병의원 계열은 메뉴판이 없어 '메뉴 가격' 점검을 따로 세우지 않습니다(등록한 취급 품목·서비스가 있을 때만 그 말로 보임).
    const health = healthWords(place);
    const automatic = [
        { id: 'nap', platform: 'common', done: auto(entity ? entity.pct === 100 : null), title: '상호·주소·전화·영업시간·업종 모두 등록', detail: 'AI가 매장을 같은 곳으로 알아보는 데 쓰일 수 있는 기본 정보입니다.' },
        { id: 'menuPrice', platform: 'common', done: auto(place ? (menuCount > 0 && (place.menuPricedCount || 0) >= menuCount) : null), title: health ? `${health.item}마다 가격(알릴 수 있는 것만)을 글자로 등록` : '메뉴(서비스)마다 가격을 글자로 등록', detail: '가격표 사진만 있으면 AI가 "가격대는?"에 답하기 어렵습니다.' },
        { id: 'kw5', platform: 'naver', done: auto(keywords === null ? null : keywords.length >= 5), title: '대표키워드 5개 등록', detail: '리뷰에 실제로 나오는 표현으로 고르세요.' },
        { id: 'desc', platform: 'naver', done: auto(length === null ? null : length >= ATOMIC_MIN), title: `소개글 ${ATOMIC_MIN}자 이상, 첫 문장은 두괄식`, detail: '어디에 있는 어떤 매장인지와 확인 가능한 근거를 첫 문장에 담으세요.' },
        { id: 'feed14', platform: 'naver', done: feedDone, title: '최근 14일 안에 소식 올리기', detail: `${feedTopicWords(place)}·휴무 안내를 소식에 올리세요.` },
        { id: 'reply', platform: 'naver', done: auto(replyKnown ? visitor.replyRate >= REPLY_TARGET : null), title: `리뷰 답글률 ${REPLY_TARGET}% 이상`, detail: '답글에 주차·예약·가격처럼 자주 묻는 정보를 사실대로 적으세요.' },
        { id: 'coupon', platform: 'naver', done: auto(coupon.known ? coupon.total > 0 : null), title: '네이버 쿠폰 1개 이상 등록', detail: '"혜택 있는 곳" 질문의 답이 될 수 있습니다. 리뷰 작성이나 별점을 조건으로 걸지 마세요.' },
        { id: 'sameAs', platform: 'gemini', done: auto(Array.isArray(detail?.links) ? detail.links.length > 0 : null), title: '플레이스에 홈페이지·SNS 연결', detail: '연결된 채널 소개에도 같은 상호·주소를 쓰세요.' },
        { id: 'noHype', platform: 'claude', done: auto(hypeTexts(place, activity).length === 0 ? null : hype.length === 0), title: '광고성 표현 없음', detail: '최상급·순위 표현 대신 수치·사실로 쓰세요.' },
    ]
        // 업종 때문에 해당 없는 항목(병의원의 소식·쿠폰, 약국의 쿠폰)은 체크리스트에서 뺍니다(진행률 분모에도 안 들어감). 이유는 analyzeGeoAeo 의 notApplicable 에 있습니다.
        .filter((item) => !((item.id === 'feed14' && industry.feed) || (item.id === 'coupon' && industry.coupon) || (item.id === 'menuPrice' && health && menuCount === 0)))
        .map((item) => ({ ...item, auto: true }));
    const manual = externalSteps(place, activity).map((step) => ({
        id: step.id,
        platform: step.group,
        title: step.title,
        detail: step.how,
        optional: step.optional,
        needsSite: Boolean(step.needsSite),
        ...(step.done === true ? { auto: true, done: true } : {}),
    }));
    return [...automatic, ...manual];
}

// 제재·삭제 위험이 커서 하지 말아야 할 것(화면에는 따로 보이지 않고 각 일의 주의사항에 같은 기준으로 적습니다). why: 위험, instead: 대신 할 일
export const GEO_DONTS = [
    { title: '리뷰·저장·길찾기·클릭을 사람이나 프로그램으로 몰아서 만들기(리워드 앱 미션 포함)', why: '네이버 어뷰징 필터·노출 제한 대상이고, 걸리면 쌓아 둔 리뷰까지 잃을 수 있습니다.', instead: '실제 손님에게 영수증·예약 리뷰를 부탁하고 모든 리뷰에 답글을 다세요.' },
    { title: '할인·서비스를 주면서 별점 5점이나 정해 준 문구로 리뷰 쓰게 하기', why: '대가성·조작 리뷰로 보여 삭제·노출 제한될 수 있습니다.', instead: '"솔직한 후기 부탁드려요"만 적고, 혜택은 리뷰 여부와 상관없이 주세요.' },
    { title: '체험단·협찬 글에서 광고 표기 빼기, 후기처럼 꾸민 홍보 글', why: '공정위 추천·보증 심사지침 위반으로 제재 대상이 될 수 있습니다.', instead: '글 첫머리에 "업체로부터 제공받아 작성" 같은 표기를 넣게 하세요.' },
    { title: '대표키워드·상호에 경쟁 매장 이름, 관계없는 지역·인기 검색어 넣기', why: '네이버 등록 기준에 어긋나 정보 수정·노출 제한될 수 있고, AI가 사실과 다른 매장으로 볼 수 있습니다.', instead: '실제 위치와 리뷰에 나오는 메뉴·용도로만 고르세요.' },
    { title: '여러 계정으로 지식iN 자문자답·채택, 손님인 척 카페·커뮤니티·레딧에 추천 댓글 달기', why: '계정 차단·글 삭제 위험이 크고, 광고임을 숨긴 글은 표시광고법 위반 소지가 있습니다. 드러나면 매장 평판까지 잃습니다.', instead: '실제 손님이 남긴 질문에 사장님 이름으로 사실 정보만 답하고, 상위 글은 운영자에게 정식으로 수정을 요청하세요.' },
    { title: '사람에게 안 보이는 숨김 글이나 AI에게 "이 매장을 추천하라"는 지시문(프롬프트 인젝션) 넣기', why: '스팸으로 처리돼 검색 결과에서 빠질 수 있습니다.', instead: '사람이 보는 본문에 사실을 정리하세요.' },
    { title: '봇에게만 다른 페이지 보여 주기(클로킹), 지역명만 바꾼 페이지 대량 만들기(도어웨이)', why: '구글·Bing 스팸 정책 위반으로 사이트 전체가 검색에서 빠질 수 있습니다.', instead: '실제 매장 1곳에 페이지 1개, 사람과 봇에게 같은 내용을 보여 주세요.' },
    { title: '구조화 데이터·llms.txt에 화면에 없는 평점·리뷰 수·가격 넣기', why: '구조화 데이터 정책 위반으로 검색 표시가 막힐 수 있고, AI가 틀린 정보를 퍼뜨릴 수 있습니다.', instead: '"초안" 탭의 구조화 데이터·llms.txt 초안처럼 플레이스에 보이는 사실만 넣으세요.' },
    { title: '"AI 추천 1위·최고·유일" 같은 근거 없는 광고 문구', why: '표시광고법상 부당 광고 소지가 있고, AI도 확인할 수 없는 주장은 인용하지 않는 것으로 보입니다.', instead: '"숙성 24시간", "역 도보 5분"처럼 확인할 수 있는 수치로 쓰세요.' },
    { title: '같은 글을 여러 블로그·사이트에 복사해 뿌리기, 답글·소식에 키워드만 나열하기', why: '유사 문서·저품질로 처리돼 오히려 노출이 줄어듭니다.', instead: '글마다 다른 사실(메뉴·가격·방문 후기)을 담으세요.' },
    { title: '효능·안전을 단정하는 표현(의료·건강·미용 업종)', why: '의료법·식품 표시광고법 등 업종별 법 위반 소지가 있습니다.', instead: '업종 관련 법을 먼저 확인하고 확인된 사실만 쓰세요.' },
    { title: '경쟁 매장을 깎아내리는 비교 문구, "이 조건에 맞는 곳은 우리뿐" 같은 단정', why: '비방·부당 비교 광고가 될 수 있고(표시광고법), 사실과 다르면 AI가 틀린 정보를 퍼뜨릴 수 있습니다.', instead: '내 매장이 갖춘 조건만 사실대로 적으세요(조건형 답변 초안).' },
    { title: '내가 만든 자료를 "벤치마크·검증 데이터"처럼 꾸며 올리기, 등재 기준이 안 되는데 위키 문서 만들기', why: '삭제되기 쉽고, 스스로 쓴 글을 제3자 검증처럼 보이게 하면 신뢰를 잃습니다.', instead: '매장이 직접 낸 자료임을 밝히고 내 블로그·홈페이지에 올리세요.' },
    { title: '정지 화면에 기계 음성만 입힌 영상·문장만 바꾼 쇼츠를 대량으로 올리기, 내용은 그대로 두고 글 날짜만 바꾸기', why: '유튜브 스팸·반복 콘텐츠 정책 위반으로 채널이 제한될 수 있고, 검색엔진도 날짜만 바꾼 글을 걸러 냅니다.', instead: '실제 매장을 찍은 영상 1~2개를 올리고, 정보가 바뀔 때만 날짜를 고치세요.' },
];

// ---------------------------------------------------------------------------
// 홈페이지용 자료 — LocalBusiness 구조화 데이터·llms.txt 초안
// 평점·리뷰 수(aggregateRating)는 넣지 않습니다: 다른 곳의 리뷰를 내 사이트 평점으로 표시하면 정책 위반입니다.
// ItemList(내 매장을 1위로 적은 순위 목록)·Speakable 도 넣지 않습니다: 스스로 매긴 순위는 사실이 아니고,
// Speakable 은 뉴스 기사용 시험 기능이라 매장 페이지에서 효과가 확인되지 않았습니다.
// ---------------------------------------------------------------------------

const SCHEMA_TYPES = [
    [/카페|커피|디저트|베이커리|빵/, 'CafeOrCoffeeShop'],
    [/술집|주점|이자카야|와인|칵테일|포차|호프/, 'BarOrPub'],
    [/치과/, 'Dentist'],
    [/피부과|병원|의원|한의원|클리닉|정형외과|안과|내과|소아과/, 'MedicalClinic'],
    [/미용실|헤어/, 'HairSalon'],
    [/네일/, 'NailSalon'],
    [/피부관리|에스테틱|왁싱|속눈썹/, 'BeautySalon'],
    [/필라테스|요가|헬스|피트니스|크로스핏|PT/, 'ExerciseGym'],
    [/호텔|펜션|모텔|게스트하우스|숙박|리조트/, 'LodgingBusiness'],
    [/한식|중식|일식|양식|음식|고기|육류|횟집|생선회|해물|분식|치킨|피자|레스토랑|뷔페|국밥|요리|식당|초밥|라멘|파스타|맛집/, 'Restaurant'],
];

export function schemaType(category) {
    const text = String(category || '');
    const hit = SCHEMA_TYPES.find(([pattern]) => pattern.test(text));
    return hit ? hit[1] : 'LocalBusiness';
}

const DAY_SCHEMA = { 월: 'Monday', 화: 'Tuesday', 수: 'Wednesday', 목: 'Thursday', 금: 'Friday', 토: 'Saturday', 일: 'Sunday' };
const DAY_GROUPS = { 매일: Object.values(DAY_SCHEMA), 평일: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], 주말: ['Saturday', 'Sunday'] };

function schemaDays(day) {
    const text = String(day || '').trim();
    if (DAY_GROUPS[text]) return DAY_GROUPS[text];
    return DAY_SCHEMA[text.charAt(0)] ? [DAY_SCHEMA[text.charAt(0)]] : [];
}

function coordinateNumber(value) {
    const number = Number(value);
    return value !== '' && Number.isFinite(number) ? number : null;
}

// <script> 안에 넣어도 태그가 닫히지 않게 '<' 를 이스케이프합니다.
function safeJson(value) {
    return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

export function buildLocalBusinessJsonLd(place, fanout = buildFanout(place, null)) {
    if (!place) return '';
    const placeUrl = placeHomeUrl(place.placeId);
    const business = {
        '@type': schemaType(place.category),
        name: place.name,
    };
    if (place.address) business.address = { '@type': 'PostalAddress', streetAddress: place.address, addressCountry: 'KR' };
    const lat = coordinateNumber(place.coordinate?.y);
    const lng = coordinateNumber(place.coordinate?.x);
    if (lat !== null && lng !== null) business.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
    const days = (place.detail?.hours?.days || []).filter((day) => day.start && day.end);
    const specs = days.flatMap((day) => schemaDays(day.day).map((dayOfWeek) => ({
        '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${dayOfWeek}`, opens: day.start, closes: day.end,
    })));
    if (specs.length) business.openingHoursSpecification = specs;
    const amenities = [...new Set([...list(place.conveniences), ...list(place.detail?.facilities)])];
    if (amenities.length) business.amenityFeature = amenities.map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true }));
    if (list(place.paymentInfo).length) business.paymentAccepted = place.paymentInfo.join(', ');
    business.hasMap = placeUrl;
    business.sameAs = [placeUrl];

    const graph = [business];
    const faq = (fanout || []).filter((item) => item.status === 'yes' && item.answer);
    if (faq.length) {
        graph.push({
            '@type': 'FAQPage',
            mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })),
        });
    }
    return `<script type="application/ld+json">\n${safeJson({ '@context': 'https://schema.org', '@graph': graph })}\n</script>`;
}

export function buildLlmsTxt(place, activity, { atomic, fanout } = {}) {
    if (!place) return '';
    const fan = fanout || buildFanout(place, activity);
    const answer = atomic || buildAtomicAnswer(place, activity, fan);
    const detail = place.detail || null;
    const hours = summarizeHours(detail?.hours);
    const subway = detail?.subway;
    const lines = [
        `# ${place.name}`,
        '',
        `> ${answer.text}`,
        '',
        '## 기본 정보',
        `- 업종: ${categoryLabel(place)}`,
        place.address ? `- 주소: ${place.address}` : null,
        subway ? `- 가까운 역: ${subway.station}${subway.exit ? ` ${subway.exit}번 출구` : ''}${subway.walkMinutes ? ` 도보 ${subway.walkMinutes}분` : ''}` : null,
        hours ? `- 영업시간: ${hours}` : null,
        list(place.conveniences).length ? `- 편의시설: ${place.conveniences.join(', ')}` : null,
        `- 네이버 플레이스: ${placeHomeUrl(place.placeId)}`,
    ];
    const votes = list(place.reviewVotes).slice(0, 5);
    if (votes.length) {
        lines.push('', '## 손님 리뷰에서 많이 고른 평가 (네이버 집계)');
        for (const vote of votes) lines.push(`- ${vote.label} (${vote.count}명)`);
    }
    const faq = fan.filter((item) => item.status === 'yes' && item.answer);
    if (faq.length) {
        lines.push('', '## 자주 묻는 질문');
        for (const item of faq) lines.push('', `### Q. ${item.question}`, item.answer);
    }
    return lines.filter((line) => line !== null).join('\n');
}

// ---------------------------------------------------------------------------
// 복사해 쓰는 초안 — 로드맵의 할 일마다 붙는 글·요청문·설정 예시
// 매장 정보에 있는 사실만 채우고, 화면 정보에 없는 값(전화번호·메뉴 가격 등)은 "(직접 적기)"로 비워 둡니다.
// 손님인 척 쓰는 댓글·자문자답·경쟁사 깎아내리기 원고는 만들지 않습니다.
// ---------------------------------------------------------------------------

export const TEMPLATE_BLANK = '(직접 적기)';

// 홈페이지가 있어야 쓸 수 있는 초안과 한 줄 풀이(고유 명칭이 풀이 없이 혼자 나오지 않게)
const SITE_TEMPLATES = {
    answerPage: '홈페이지 본문에 그대로 붙여 넣는 질문·답변 글(HTML)입니다. 사람과 검색 로봇에게 똑같이 보입니다.',
    robots: '검색·AI 로봇이 내 홈페이지를 읽어 가도 되는지 적어 두는 안내 파일입니다.',
    jsonld: '검색엔진·AI가 매장 이름·주소·영업시간을 정확히 읽도록 홈페이지에 넣어 두는 정리 코드(구조화 데이터)입니다.',
    llms: 'AI에게 이 홈페이지의 핵심 정보를 요약해 알려 주는 안내 파일입니다(AI가 읽는다는 보장은 없습니다).',
};

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hoursText(hours) {
    if (!hours?.registered || !Array.isArray(hours.days)) return null;
    const open = hours.days.filter((day) => day && day.start && day.end);
    if (open.length === 0) return null;
    const same = new Set(open.map((day) => `${day.start}~${day.end}`)).size === 1;
    const text = same ? summarizeHours(hours) : open.map((day) => `${day.day} ${day.start}~${day.end}`).join(' / ');
    return `${text}${hours.regularClosed ? ` (정기휴무: ${hours.regularClosed})` : ''}`;
}

function subwayText(subway) {
    if (!subway) return null;
    return `${stationName(subway)}${subway.exit ? ` ${subway.exit}번 출구` : ''}${subway.walkMinutes ? ` 도보 ${subway.walkMinutes}분` : ''}`;
}

function topMenuNames(place, count = 4) {
    return uniq([
        ...list(place?.reviewMenus).map((m) => m.label),
        ...list(place?.detail?.pos?.popularMenus).map((m) => m.name),
    ]).slice(0, count);
}

// 글·표에 넣을 매장 사실. [{ label, value }] — 모르는 값은 "(직접 적기)"
export function factRows(place, activity = null) {
    if (!place) return [];
    const detail = place.detail || null;
    const parking = detail?.parking || null;
    const menus = topMenuNames(place);
    const average = detail?.pos?.averagePrice?.total || null;
    const contacts = [
        detail?.hasBooking === true ? '네이버 예약' : null,
        place.hasPhone ? `전화 ${TEMPLATE_BLANK}` : null,
        place.hasTalktalk ? '네이버 톡톡' : null,
    ].filter(Boolean);
    const extras = uniq([...list(place.conveniences), ...list(detail?.facilities)]);
    const couponTotal = activity?.coupons?.total ?? detail?.couponCount ?? null;
    const perks = [
        list(place.paymentInfo).length ? place.paymentInfo.join(', ') : null,
        couponTotal > 0 ? `네이버 쿠폰 ${couponTotal}개` : null,
    ].filter(Boolean);
    let parkingText = `${TEMPLATE_BLANK} — 가능·불가·근처 주차장`;
    if (parking?.available) {
        const fee = parking.free === true ? '(무료)' : parking.free === false ? '(유료)' : '';
        parkingText = `가능${fee}${parking.valet ? ' · 발레파킹' : ''}`;
    }
    return [
        ['상호', place.name || TEMPLATE_BLANK],
        ['업종', place.category ? categoryLabel(place) : TEMPLATE_BLANK],
        ['주소', place.address || TEMPLATE_BLANK],
        detail?.subway ? ['가까운 역', subwayText(detail.subway)] : null,
        ['영업시간', hoursText(detail?.hours) || TEMPLATE_BLANK],
        [menuWord(place) === '메뉴' ? '대표 메뉴·가격' : `대표 ${menuWord(place)}${healthWords(place) ? '' : '·가격'}`, menus.length ? `${menus.join(', ')}${healthWords(place) ? '' : ` — 가격 ${TEMPLATE_BLANK}`}` : TEMPLATE_BLANK],
        average ? ['1회 평균 결제', `약 ${won(average)} (최근 1주 네이버 결제 기준)`] : null,
        ['주차', parkingText],
        ['예약·문의', contacts.length ? contacts.join(' · ') : TEMPLATE_BLANK],
        extras.length ? ['편의시설', extras.join(', ')] : null,
        perks.length ? ['결제·혜택', perks.join(' · ')] : null,
        ['네이버 플레이스', placeHomeUrl(place.placeId)],
    ].filter(Boolean).map(([label, value]) => ({ label, value }));
}

const ROBOTS_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Bingbot', 'Googlebot', 'Google-Extended', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Yeti'];

// 초안 목록. key 는 로드맵 할 일의 template 과 같습니다.
export function buildTemplates(place, activity = null, { fanout, atomic, criteria, nowMs = Date.now() } = {}) {
    if (!place) return [];
    const fan = fanout || buildFanout(place, activity);
    const answer = atomic || buildAtomicAnswer(place, activity, fan);
    const fit = criteria === undefined ? buildCriteriaAnswer(place, activity) : criteria;
    const name = place.name || '이 매장';
    const area = placeArea(place);
    const category = categoryLabel(place);
    const question = targetQuestion(place);
    const detail = place.detail || null;
    const placeUrl = placeHomeUrl(place.placeId);
    const today = kstDateText(nowMs);
    const year = today.slice(0, 4);
    const month = Number(today.slice(5, 7));
    const rows = factRows(place, activity);
    const menus = topMenuNames(place, 3);
    // 한 줄 소개·처음 10초 말에는 키워드 추천이 대표로 인정한 메뉴만 씁니다(메뉴표·보도자료 본문은 원래 목록 그대로).
    const headMenus = headlineMenus(place, activity, 2);
    const faq = fan.filter((item) => item.status === 'yes' && item.answer);
    const summary = fit?.text || answer.text;
    const prompts = measurePrompts(place);
    const subway = subwayText(detail?.subway);
    const hours = hoursText(detail?.hours);
    const food = briefingEligible(place);
    const head = [area, place.category ? searchCategory(place) : null].filter(Boolean).join(' ');
    const titled = `${head ? `${head} ` : ''}${name}`;
    const faqLines = (items) => items.flatMap((item) => ['', `Q. ${item.question}`, `A. ${item.answer}`]);
    const factLines = rows.map((row) => `- ${row.label}: ${row.value}`);

    const templates = [];
    // group: 'site' 는 홈페이지가 있는 가게만 쓰는 초안(SITE_WORK_HEADER 머리말 아래로 모읍니다). purpose: 무엇을 위한 것인지 한 줄 풀이
    const add = (key, label, where, lines, notes = []) => templates.push({
        key, label, where, text: lines.filter((line) => line !== null).join('\n'), notes,
        group: SITE_TEMPLATES[key] ? 'site' : 'write',
        purpose: SITE_TEMPLATES[key] || null,
    });

    add('prompts', '측정 질문', '네이버·ChatGPT·Gemini·Claude·Perplexity에 똑같이 묻는 질문', [
        ...prompts.flatMap((prompt, index) => [`[질문 ${index + 1}]`, prompt, '']),
        `네이버는 검색창에 "${question}"만 넣고, 맨 위 AI 브리핑(없으면 플레이스 목록)에서 내 매장이 몇 번째인지 봅니다.`,
    ], [
        '새 채팅 창에서, 같은 기기·같은 로그인 상태로 물으세요. ChatGPT·Claude는 웹 검색을 켠 상태여야 합니다.',
        'AI 답은 물을 때마다 조금씩 달라집니다. 한 번의 결과로 단정하지 말고 같은 요일에 다시 재서 흐름을 보세요.',
        '답변 아래 출처 링크도 함께 적어 두면 "출처 글 수정 요청"에 바로 쓸 수 있습니다.',
    ]);

    add('sourceRequest', '출처 글 수정 요청문', 'AI가 출처로 쓰는 블로그·카페·매거진 글 운영자에게 보내는 글', [
        `안녕하세요. ${head ? `${head} ` : ''}${josa(name, '을', '를')} 운영하는 사장입니다.`,
        '쓰신 글 「(글 제목)」을 잘 보았습니다. 글에 저희 매장 정보가 (빠져 있어서 / 예전 내용이어서) 정확한 정보를 알려 드립니다.',
        '',
        ...factLines,
        '',
        '글에 반영해 주실 수 있을지 여쭙니다. 평가나 문구는 정해 드리지 않으며, 사실 정보만 맞춰 주시면 됩니다.',
        '원고료·식사 제공 같은 대가가 있는 경우에는 글에 "업체로부터 제공받아 작성" 같은 광고 표기를 꼭 넣어 주세요.',
        '감사합니다.',
    ], [
        '이미 검색에 잡힌 글을 바로잡는 방법이라 새 글을 쓰는 것보다 빠를 것으로 봅니다(어림값 1~3일). 반영 여부는 글쓴이가 정합니다.',
        '손님인 척 댓글을 달거나 광고 표기 없이 대가를 주는 것은 하지 마세요. 삭제·제재 대상입니다.',
    ]);

    add('napCard', '통일 표기', '구글 비즈니스 프로필·Bing Places·카카오맵 등 모든 등록에 똑같이 넣는 표기', [
        `상호: ${place.name || TEMPLATE_BLANK}`,
        `업종: ${place.category ? category : TEMPLATE_BLANK}`,
        `주소: ${place.address || TEMPLATE_BLANK}`,
        '전화: (네이버 플레이스에 등록한 번호 그대로 — 직접 적기)',
        `영업시간: ${hours || TEMPLATE_BLANK}`,
        subway ? `가까운 역: ${subway}` : null,
        `네이버 플레이스: ${placeUrl}`,
        '영문 표기: (한 번 정하면 모든 곳에 같은 철자로 — 직접 적기)',
    ], [
        '띄어쓰기·지점 이름·전화번호 표기(02-123-4567)까지 똑같아야 AI가 같은 매장으로 묶기 쉽습니다.',
        '상호에 "맛집·추천" 같은 말을 덧붙이지 마세요. 간판·사업자등록증의 이름 그대로 씁니다.',
    ]);

    add('intro', '소개글·한 줄 소개', '스마트플레이스 업체정보의 소개글 첫 문단과 한 줄 소개', [
        '[소개글 첫 문단]',
        answer.text,
        '',
        '[한 줄 소개 예시]',
        [area, headMenus.join('·'), place.category ? searchCategory(place) : null].filter(Boolean).join(' ') || TEMPLATE_BLANK,
    ], [
        `첫 문단은 ${ATOMIC_MIN}~${ATOMIC_MAX}자가 알맞습니다(지금 ${answer.length}자). 짧으면 가까운 역·영업시간·${mainItemWord(place)} 같은 사실을 더 넣으세요.`,
        '"최고·1위·유일" 같은 표현은 빼고 확인할 수 있는 사실만 씁니다.',
    ]);

    add('feedPost', '플레이스 소식', '스마트플레이스 소식 탭에 올리는 글', [
        '[제목]',
        `${titled} — ${month}월 영업시간·주차·예약 안내`,
        '',
        '[본문]',
        answer.text,
        ...(faq.length ? ['', '자주 받는 질문', ...faqLines(faq.slice(0, 3))] : []),
        '',
        `(${feedTopicWords(place)}·휴무 소식이 있으면 날짜와 함께 한 줄 — 직접 적기)`,
    ], [
        '제목은 손님이 검색하는 말(지역 + 업종)로 시작합니다. 2주에 한 번 이상 올리세요.',
    ]);

    add('answerPost', '질문형 글(블로그)', '네이버 블로그·티스토리 등에 올리는 글(글자 그대로 붙여 넣기)', [
        '[제목]',
        `${question} — ${name} 위치·영업시간·주차·예약 (${year}년 ${month}월 기준)`,
        '',
        '[맨 위 요약 — 제목 바로 아래 2~3줄]',
        summary,
        '',
        "[표 — 블로그 편집기의 '표'로 옮기기]",
        ...rows.map((row) => `${row.label} | ${row.value}`),
        ...(faq.length ? ['', '[질문과 답 — 질문은 소제목으로]', ...faqLines(faq).slice(1)] : []),
        '',
        '[글 끝]',
        `최종 수정일: ${today} · 정보 기준: 네이버 플레이스 ${placeUrl}`,
    ], [
        '답을 한눈에 찾기 쉬운 구성입니다: 질문형 제목 → 2~3줄 결론 → 표 → 질문·답. 이 구성이 AI 답변에 뽑힌다는 보장은 없습니다.',
        '"직접 적기"라고 적힌 칸(가격·전화번호 등)은 꼭 채우세요. 비워 둔 채 올리면 AI가 답할 사실이 없습니다.',
        '가격·영업시간이 바뀌면 본문과 최종 수정일을 함께 고칩니다. 내용은 그대로 두고 날짜만 바꾸지 마세요.',
    ]);

    add('answerPage', '질문형 글(HTML)', '홈페이지 본문에 붙여 넣는 HTML(사람과 로봇에게 똑같이 보이는 글)', [
        '<section id="store-answer">',
        `  <h2>${escapeHtml(`${question} — ${josa(name, '은', '는')} 어떤 곳인가요?`)}</h2>`,
        `  <p>${escapeHtml(summary)}</p>`,
        '  <table>',
        `    <caption>${escapeHtml(name)} 기본 정보</caption>`,
        '    <tbody>',
        ...rows.map((row) => `      <tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`),
        '    </tbody>',
        '  </table>',
        ...faq.flatMap((item) => [`  <h3>${escapeHtml(item.question)}</h3>`, `  <p>${escapeHtml(item.answer)}</p>`]),
        `  <p>최종 수정일: <time datetime="${today.replace(/\./g, '-')}">${today}</time> · 정보 기준: <a href="${escapeHtml(placeUrl)}">네이버 플레이스</a></p>`,
        '</section>',
    ], [
        '스크립트 없이 글자와 표만 있는 HTML이라 대부분의 편집기에 그대로 들어갑니다. 숨김 처리하지 말고 화면에 보이게 두세요.',
        '구조화 데이터(JSON-LD)는 따로 <head>에 넣습니다. 이 글의 내용과 같아야 합니다.',
    ]);

    add('gbpDescription', '구글 프로필 설명', "구글 비즈니스 프로필의 '업체 설명'(750자 이내)과 메뉴(서비스) 항목", [
        '[업체 설명]',
        fit ? `${answer.text} ${fit.lead}` : answer.text,
        '',
        `[${menuWord(place)} 항목 — 이름 · 가격 · 한 줄 설명]`,
        ...(menus.length ? menus.map((menu) => `- ${menu} · 가격 ${TEMPLATE_BLANK} · 설명 ${TEMPLATE_BLANK}`) : [`- ${TEMPLATE_BLANK}`]),
        '',
        "[첫 '업데이트' 글]",
        `${titled} ${month}월 안내: ${hours ? `${hours} 영업합니다.` : '(영업시간 — 직접 적기)'} (이번 달 소식 한 줄 — 직접 적기)`,
    ], [
        '상호·주소·전화·영업시간은 "통일 표기"와 똑같이 넣으세요.',
        '업체 설명에 전화번호·링크·할인 문구를 넣으면 구글 정책에 어긋날 수 있습니다.',
    ]);

    add('youtube', '유튜브 쇼츠', '쇼츠 제목·설명란 첫 줄·처음 10초에 말할 문장', [
        '[제목]',
        `${head ? `${head} | ` : ''}${name} 위치·${mainItemWord(place)}·주차 안내`,
        '',
        '[설명란 첫 줄]',
        answer.text,
        `네이버 플레이스: ${placeUrl}`,
        '',
        '[처음 10초에 말할 문장]',
        [
            `${titled}입니다.`,
            detail?.subway?.walkMinutes ? `${stationName(detail.subway)}${detail.subway.exit ? ` ${detail.subway.exit}번 출구` : ''}에서 걸어서 ${detail.subway.walkMinutes}분입니다.` : null,
            headMenus.length ? `${josa(mainItemWord(place), '은', '는')} ${headMenus.join(', ')}입니다.` : null,
            detail?.parking?.available ? '주차할 수 있습니다.' : null,
        ].filter(Boolean).join(' '),
    ], [
        '이미 운영하는 채널에 올리세요. 새 채널은 반영이 더 느린 것으로 보입니다.',
        '자동 자막이 상호·메뉴 이름을 틀리게 적으면 직접 고치세요. 숫자·영어는 읽는 소리대로 또박또박 말하면 덜 틀립니다.',
        '같은 문장만 바꿔 영상을 여러 개 찍어 내거나 정지 화면에 기계 음성만 입힌 영상은 올리지 마세요.',
    ]);

    add('reviewAsk', '리뷰 안내문', '계산대·테이블에 두는 리뷰 안내(네이버·구글 함께)', [
        '방문해 주셔서 감사합니다.',
        '솔직한 후기를 남겨 주시면 큰 도움이 됩니다.',
        food ? '어떤 메뉴를 드셨고 어떠셨는지 한 줄만 적어 주세요.' : '무엇을 이용하셨고 어떠셨는지 한 줄만 적어 주세요.',
        '',
        '· 네이버 영수증 리뷰: (QR 붙이기)',
        '· 구글 리뷰: (구글 리뷰 링크 붙이기)',
        '',
        '※ 리뷰를 쓰지 않으셔도, 어떤 내용을 쓰셔도 받는 혜택은 같습니다.',
    ], [
        '정해 준 문장을 리뷰에 쓰게 하거나 혜택을 걸면 대가성·조작 리뷰로 삭제·제재될 수 있어 안내문에 넣지 않았습니다.',
        `"${reviewAskLine(place).replace(' 한 줄', '')}"를 부탁하면 글 리뷰가 늘어, AI가 요약에 쓸 수 있는 문장도 자연스럽게 늘 수 있습니다.`,
    ]);

    add('press', '보도자료 뼈대', '지역 매체·보도자료 서비스에 보내는 글(실제 새 소식이 있을 때만)', [
        '[제목]',
        `${head ? `${head} ` : ''}'${name}', (새 소식 한 줄 — 예: ${month}월부터 점심 영업 시작)`,
        '',
        '[첫 문단 — 누가·언제·무엇을, 숫자 1개 이상]',
        `${place.address ? `${place.address}에 있는 ` : ''}${place.category ? `${category} 매장 ` : ''}${josa(name, '이', '가')} (언제)부터 (무엇을) 한다. (가격·시간·좌석 수 같은 숫자 한 가지)`,
        '',
        '[둘째 문단 — 매장 사실]',
        [
            subway ? `${josa(name, '은', '는')} ${subway} 거리에 있다.` : null,
            hours ? `영업시간은 ${hours}이다.` : null,
            menus.length ? `${josa(mainItemWord(place), '은', '는')} ${menus.join(', ')}이다.` : null,
            detail?.parking?.available ? '주차할 수 있다.' : null,
            detail?.hasBooking === true ? '네이버 예약을 받는다.' : null,
        ].filter(Boolean).join(' ') || TEMPLATE_BLANK,
        '',
        '[셋째 문단 — 사장님 말 한 줄과 문의처]',
        `(이름) 대표는 "(과장 없는 한 줄)"라고 말했다. 문의: (전화번호) · ${placeUrl}`,
    ], [
        '괄호 안은 직접 채우세요. 뉴스 기사는 AI가 사실을 확인할 때 참고하는 것으로 보입니다(어림값 1~3일). 비용이 들고 기사로 실린다는 보장은 없습니다.',
        '"최고·1위" 같은 표현과 다른 매장 비교는 빼세요. 돈을 내고 싣는 기사형 광고는 광고 표기를 확인합니다.',
    ]);

    add('robots', 'robots.txt 예시', '홈페이지 맨 위 경로(내 도메인/robots.txt)', [
        '# AI 검색과 검색엔진의 수집을 허용하는 예시입니다.',
        '# 이미 robots.txt가 있으면 아래 로봇 이름이 Disallow 로 막혀 있지 않은지만 확인하세요.',
        ...ROBOTS_BOTS.map((bot) => `User-agent: ${bot}`),
        'Allow: /',
        '',
        'Sitemap: https://(내 도메인)/sitemap.xml',
    ], [
        '아래 이름은 각 회사의 AI·검색엔진이 홈페이지를 읽으러 보내는 로봇의 이름입니다: OAI-SearchBot·ChatGPT-User(ChatGPT) · Bingbot(Bing) · Googlebot·Google-Extended(구글·Gemini) · Claude-SearchBot·Claude-User(Claude) · PerplexityBot(Perplexity) · Yeti(네이버)',
        '카페24·아임웹 같은 호스팅은 관리자 화면의 검색엔진 설정에서 robots.txt를 고칩니다.',
    ]);

    add('jsonld', '구조화 데이터', '홈페이지 <head> 안에 넣는 JSON-LD', [buildLocalBusinessJsonLd(place, fan)], [
        '전화번호·홈페이지 주소·인스타그램 같은 공식 채널 주소는 직접 추가하세요(코드 안의 sameAs 항목).',
        '질문·답변(FAQPage)은 페이지 본문에도 똑같이 보여야 합니다. 로봇에게만 보이는 내용은 검색엔진이 속임수(클로킹)로 볼 수 있습니다.',
        '평점·리뷰 수는 넣지 않았습니다. 네이버 리뷰를 내 사이트 평점으로 표시하면 구글 정책에 어긋납니다.',
    ]);

    add('llms', 'llms.txt 초안', '홈페이지 맨 위 경로(내 도메인/llms.txt)', [buildLlmsTxt(place, activity, { atomic: answer, fanout: fan })], [
        '제안 단계 형식이라 AI가 읽는다는 보장은 없습니다.',
        '안의 내용은 홈페이지 본문·플레이스 정보와 같아야 합니다.',
    ]);

    // 새소식 기능이 없는 업종(병의원)에는 "플레이스 소식" 초안을 내지 않습니다(place-industry.js)
    return notApplicableOf(place).feed ? templates.filter((template) => template.key !== 'feedPost') : templates;
}

// ---------------------------------------------------------------------------
// 경쟁 매장 대비
// ---------------------------------------------------------------------------

function percentileIn(values, value) {
    const others = values.filter((v) => Number.isFinite(v));
    if (others.length < 2 || !Number.isFinite(value)) return null;
    const below = others.filter((v) => v < value).length;
    const equal = others.filter((v) => v === value).length - 1;
    return (below + equal / 2) / (others.length - 1);
}

const SIGNAL_METRICS = [
    ['visitorReviews', (row) => row.visitorReviews],
    ['blogReviews', (row) => row.blogReviews],
    ['score', (row) => row.score],
    ['images', (row) => row.imageCount],
    ['save', (row) => parseCount(row.saveText)],
    ['tools', (row) => {
        const flags = [row.hasBooking, row.hasOrder, row.couponCount === null || row.couponCount === undefined ? null : row.couponCount > 0, row.hasNPay]
            .filter((v) => v === true || v === false);
        return flags.length ? flags.filter(Boolean).length / flags.length : null;
    }],
];

// 키워드 검색 상위 10곳 + 내 매장의 "GEO 신호 지수"(0~100). 같은 목록 안에서 리뷰·블로그·평점·사진·저장·운영 도구가
// 몇 번째쯤인지(백분위)의 평균입니다. 이미 받은 순위 목록만 쓰고 추가 조회는 하지 않습니다.
export function compareGeoSignals(result, place = null) {
    if (!result || !Array.isArray(result.top) || result.top.length === 0) return null;
    const rows = result.top.map((row) => ({ ...row }));
    if (result.target && !rows.some((row) => row.isTarget)) rows.push({ ...result.target });
    if (!rows.some((row) => row.isTarget) && place) {
        rows.push({
            rank: null, placeId: place.placeId, name: place.name, isTarget: true,
            visitorReviews: place.visitorReviews, blogReviews: place.blogReviews, score: place.visitorScore,
        });
    }
    const columns = SIGNAL_METRICS.map(([key, pick]) => [key, rows.map((row) => {
        const value = pick(row);
        return value === null || value === undefined ? NaN : Number(value);
    })]);
    const scored = rows.map((row, i) => {
        const pcts = columns.map(([, values]) => percentileIn(values, values[i])).filter((v) => v !== null);
        return {
            rank: row.rank ?? null,
            placeId: row.placeId,
            name: row.name,
            isTarget: Boolean(row.isTarget),
            index: pcts.length ? Math.round((pcts.reduce((sum, v) => sum + v, 0) / pcts.length) * 100) : null,
        };
    });
    const mine = scored.find((row) => row.isTarget) || null;
    const others = scored.filter((row) => !row.isTarget && row.index !== null);
    const top5 = others.filter((row) => row.rank && row.rank <= 5);
    const avg = (items) => (items.length ? Math.round(items.reduce((sum, row) => sum + row.index, 0) / items.length) : null);
    const sorted = scored.filter((row) => row.index !== null).sort((a, b) => b.index - a.index);
    return {
        keyword: result.keyword,
        rows: scored,
        mine: mine?.index ?? null,
        top5Average: avg(top5),
        // 검색 순위 5위 안에서 내 매장을 뺀 곳의 수(내가 5위 안이면 4, 아니면 5). 평균이 몇 곳의 평균인지 화면이 말하는 데 씁니다.
        top5Count: top5.length,
        othersAverage: avg(others),
        // 지수가 높은 순서에서 내 자리: 나보다 지수가 높은 곳의 수 + 1(지수가 같으면 같은 자리 — 줄 세우는 순서 때문에 뒤로 밀리지 않습니다)
        position: mine && mine.index !== null ? sorted.filter((row) => row.index > mine.index).length + 1 : null,
        // 나와 지수가 같은 다른 매장의 수(있으면 화면이 '공동'이라고 말합니다)
        tied: mine && mine.index !== null ? sorted.filter((row) => !row.isTarget && row.index === mine.index).length : 0,
        count: sorted.length,
    };
}

// 매장 화면 정보만으로 낸 GEO·AEO(활동·순위 제외). 경쟁 매장과 같은 조건으로 비교할 때 씁니다.
export function placeOnlyScores(place) {
    const geo = scoreGeo(place, null, null);
    const aeo = scoreAeo(place, null);
    const pick = (factors) => factors.filter((f) => f.pct !== null).map((f) => ({ key: f.key, label: f.label, pct: f.pct }));
    return { geo: geo.score, aeo: aeo.score, factors: [...pick(geo.factors), ...pick(aeo.factors)] };
}

export function summarizeRival(place) {
    return { placeId: place.placeId, name: place.name, category: place.category, ...placeOnlyScores(place) };
}

// 경쟁 매장이 20점 이상 앞선 항목(큰 차이 순)
export function rivalGaps(mine, rival, { threshold = 20, limit = 2 } = {}) {
    const mineMap = new Map((mine?.factors || []).map((f) => [f.key, f.pct]));
    return (rival?.factors || [])
        .filter((f) => mineMap.has(f.key) && f.pct - mineMap.get(f.key) >= threshold)
        .map((f) => ({ key: f.key, label: f.label, gap: f.pct - mineMap.get(f.key) }))
        .sort((a, b) => b.gap - a.gap)
        .slice(0, limit);
}

// ---------------------------------------------------------------------------
// 한 번에 — 화면이 쓰는 묶음
// ---------------------------------------------------------------------------

export function analyzeGeoAeo({ place, activity = null, ranks = null, nowMs = Date.now() }) {
    if (!place) return null;
    const fanout = buildFanout(place, activity);
    const geo = scoreGeo(place, activity, ranks, { nowMs });
    const aeo = scoreAeo(place, activity, fanout);
    const hype = findHypeWords(hypeTexts(place, activity));
    const atomic = buildAtomicAnswer(place, activity, fanout);
    const criteria = buildCriteriaAnswer(place, activity);
    const consistency = keywordConsistency(place, activity);
    const share = searchShare(ranks);
    const plan = buildActionPlan({ place, activity, ranks, nowMs, geo, aeo, fanout, hype, consistency, share });
    const result = {
        question: targetQuestion(place),
        // 업종 때문에 해당 없는 항목과 그 이유(feed: 새소식 · coupon: 쿠폰·할인 · booking: 네이버 예약, 해당하면 이유 문장·아니면 null).
        // 점수·질문표·할 일·체크리스트에서 이미 빠져 있고, 화면은 이 이유를 "이 업종에는 해당 없음"으로 보여 주면 됩니다.
        notApplicable: notApplicableOf(place),
        geo,
        aeo,
        fanout,
        coverage: fanoutCoverage(fanout),
        atomic,
        criteria,
        prompts: measurePrompts(place),
        aliases: brandAliases(place),
        templates: buildTemplates(place, activity, { fanout, atomic, criteria, nowMs }),
        hype,
        consistency,
        share,
        platforms: platformReadiness(geo, aeo),
        actions: plan.actions,
        projected: plan.projected,
        checklist: buildChecklist(place, activity, { geo, hype }),
    };
    // 음식점이 아닌 업종(약국·병의원·미용실 …)의 문장에는 '메뉴' 대신 그 업종의 말을 씁니다. 복사해 쓰는 초안 본문(text)은 자료가 섞여 있어 원본 그대로 둡니다.
    const { templates, ...rest } = result;
    return { ...fitMenuWords(place, rest), templates: fitMenuWords(place, templates, ['text']) };
}
