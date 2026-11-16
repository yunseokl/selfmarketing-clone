// 광고 주문에 쓸 수 있는 네이버 주소 판별.
// 주문 화면(입력 즉시 안내)과 서버 검증이 같은 규칙을 쓰도록 한 곳에 둡니다.

export const PLACE_AD_HOSTS = ['map.naver.com', 'place.naver.com', 'pcmap.place.naver.com', 'm.place.naver.com', 'naver.me'];
export const SHOPPING_AD_HOSTS = ['smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com'];

// 붙여넣은 글에서 주소만 골라냅니다.
// - 네이버 앱 '공유'는 "[네이버 지도] 가게이름 https://naver.me/abc" 처럼 글과 주소를 함께 복사합니다.
// - "place.naver.com/…" 처럼 https:// 없이 붙여넣은 주소는 앞에 붙여 줍니다.
export function normalizeAdUrl(input) {
    const value = String(input ?? '').trim();
    if (!value) return '';
    const found = value.match(/https?:\/\/[^\s]+/i);
    if (found) return found[0];
    return /\s/.test(value) ? value : `https://${value}`;
}

export function isAllowedAdUrl(url, hosts) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        return hosts.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

// 네이버 지도·플레이스 주소 안의 매장 번호. 없으면 null.
// 지도 주소(map.naver.com/p/entry/place/123)는 화면 정보가 비어 있어, 이 번호로 매장 화면을 다시 조회합니다.
export function placeIdFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (!isAllowedAdUrl(url, PLACE_AD_HOSTS) || parsed.hostname === 'naver.me') return null;
        // /p/entry/place/123, /restaurant/123/home, /hairshop/123 처럼 "영문 구분/숫자" 꼴
        const match = parsed.pathname.match(/\/[a-zA-Z]+\/(\d{5,})(?:\/|$)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

const GENERIC_TITLES = new Set(['네이버', 'naver', '네이버 지도', '네이버지도', '네이버 플레이스', '네이버 쇼핑', '네이버 스마트스토어', '에러페이지']);

// 미리보기 제목 정리: 제어 문자와 " : 네이버" 꼬리표를 떼고, 가게·상품 이름이 아닌 공통 제목은 버립니다.
export function cleanPreviewTitle(raw) {
    if (typeof raw !== 'string') return null;
    const text = raw
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s*[:|]\s*네이버(?:\s*(?:지도|플레이스|쇼핑|플러스\s*스토어))?$/u, '')
        .trim();
    if (!text || GENERIC_TITLES.has(text.toLowerCase())) return null;
    return text.slice(0, 100);
}
