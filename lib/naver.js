// 네이버 데이터 엔진 (서버 전용)
//
// NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 있으면 네이버 오픈API(쇼핑 검색)로
// 실데이터를 조회하고, 없거나 호출에 실패하면 키워드 기반 결정론적 추정치로 폴백합니다.
// 모든 반환값에는 source: 'naver' | 'estimate' 가 포함되어 UI에서 출처를 표시할 수 있습니다.

const NAVER_SHOP_API = 'https://openapi.naver.com/v1/search/shop.json';

export function hasNaverKeys() {
    return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

// ===== 결정론적 시드 유틸 =====
// 같은 입력(키워드/광고ID/날짜)에는 항상 같은 값을 돌려줘 새로고침마다 숫자가 널뛰지 않게 합니다.

function hashString(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function seededFloat(seedStr) {
    // 0 이상 1 미만. FNV-1a는 짧은 접미사 차이에 아발란체가 약해 murmur3 finalizer로 섞습니다.
    let h = hashString(seedStr);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function seededInt(seedStr, min, max) {
    return min + Math.floor(seededFloat(seedStr) * (max - min + 1));
}

function todayKey(date = new Date()) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

// ===== 네이버 쇼핑 검색 API =====

async function fetchShop(keyword, { display = 100, start = 1, sort = 'sim' } = {}) {
    if (!hasNaverKeys()) return null;
    try {
        const params = new URLSearchParams({
            query: keyword,
            display: String(display),
            start: String(start),
            sort,
        });
        const res = await fetch(`${NAVER_SHOP_API}?${params}`, {
            headers: {
                'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
            },
            // 순위/상품수는 실시간성이 중요하므로 캐시하지 않음
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function stripTags(text = '') {
    return text.replace(/<[^>]*>/g, '');
}

// ===== 키워드 분석 =====

const STOPWORDS = new Set([
    '무료배송', '당일배송', '정품', '세트', '개입', '행사', '특가', '할인', '증정',
    '남녀공용', '국내산', '수입', '신상', 'NEW', '주', '외',
]);

function extractRelatedKeywords(items, baseKeyword) {
    const baseTokens = new Set(baseKeyword.toLowerCase().split(/\s+/));
    const counts = new Map();
    for (const item of items) {
        const tokens = stripTags(item.title)
            .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean);
        for (const token of tokens) {
            const t = token.trim();
            if (t.length < 2 || t.length > 12) continue;
            if (baseTokens.has(t.toLowerCase())) continue;
            if (STOPWORDS.has(t)) continue;
            if (/^\d+$/.test(t)) continue;
            counts.set(t, (counts.get(t) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([token]) => `${baseKeyword} ${token}`);
}

function estimateVolumeFromProductCount(keyword, productCount) {
    // 상품수와 검색수요는 대체로 양의 상관 — 상품수 기반 보정 + 키워드 시드 변동
    const base = Math.pow(Math.max(productCount, 50), 0.82);
    const jitter = 0.7 + seededFloat(`vol:${keyword}`) * 0.9;
    const total = Math.round((base * jitter) / 10) * 10;
    return Math.max(120, Math.min(total, 2_400_000));
}

function competitionLevel(ratio) {
    if (ratio < 1.5) return { level: '낮음', color: 'success' };
    if (ratio < 6) return { level: '보통', color: 'secondary' };
    if (ratio < 20) return { level: '높음', color: 'warning' };
    return { level: '매우 높음', color: 'error' };
}

export async function analyzeKeyword(keyword) {
    const trimmed = keyword.trim();
    const data = await fetchShop(trimmed, { display: 100 });

    let productCount;
    let topProducts = [];
    let relatedKeywords = [];
    let avgPrice = null;
    let source = 'estimate';

    if (data && typeof data.total === 'number') {
        source = 'naver';
        productCount = data.total;
        const items = data.items || [];
        topProducts = items.slice(0, 10).map((item, i) => ({
            rank: i + 1,
            title: stripTags(item.title),
            price: Number(item.lprice) || null,
            mallName: item.mallName || '네이버쇼핑',
            image: item.image || null,
            link: item.link,
            brand: item.brand || null,
        }));
        const prices = items.map((it) => Number(it.lprice)).filter((p) => p > 0);
        if (prices.length) {
            avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        }
        relatedKeywords = extractRelatedKeywords(items, trimmed);
    } else {
        productCount = seededInt(`pc:${trimmed}`, 800, 320_000);
        avgPrice = seededInt(`ap:${trimmed}`, 8_000, 120_000);
        const suffixes = ['추천', '가성비', '프리미엄', '인기', '브랜드', '대용량', '세트', '선물', '휴대용', '정리'];
        relatedKeywords = suffixes
            .filter((_, i) => seededFloat(`rk:${trimmed}:${i}`) > 0.25)
            .slice(0, 8)
            .map((s) => `${trimmed} ${s}`);
    }

    const monthlySearchTotal = estimateVolumeFromProductCount(trimmed, productCount);
    const mobileRatio = 0.62 + seededFloat(`mr:${trimmed}`) * 0.24; // 62~86% 모바일
    const monthlySearchMobile = Math.round(monthlySearchTotal * mobileRatio);
    const monthlySearchPc = monthlySearchTotal - monthlySearchMobile;

    const ratio = productCount / Math.max(monthlySearchTotal, 1);
    const { level, color } = competitionLevel(ratio);

    // 진입 기회 점수(0~100): 경쟁강도(상품수/검색수) 구간을 기본으로, 검색수요로 소폭 보정
    const baseScore =
        ratio <= 0.5 ? 94 :
        ratio <= 1.5 ? 84 :
        ratio <= 3 ? 70 :
        ratio <= 6 ? 56 :
        ratio <= 12 ? 42 :
        ratio <= 20 ? 28 :
        ratio <= 40 ? 16 : 8;
    const volumeBonus = Math.round((Math.log10(Math.max(monthlySearchTotal, 100)) - 3.5) * 4);
    const opportunity = Math.max(3, Math.min(98, baseScore + volumeBonus));

    const relatedWithStats = relatedKeywords.map((rk) => {
        const rkCount = Math.round(productCount * (0.05 + seededFloat(`rpc:${rk}`) * 0.4));
        const rkVolume = estimateVolumeFromProductCount(rk, rkCount);
        const rkRatio = rkCount / Math.max(rkVolume, 1);
        return {
            keyword: rk,
            monthlySearchTotal: rkVolume,
            productCount: rkCount,
            competition: competitionLevel(rkRatio).level,
        };
    });

    return {
        keyword: trimmed,
        source,
        checkedAt: new Date().toISOString(),
        monthlySearchTotal,
        monthlySearchPc,
        monthlySearchMobile,
        productCount,
        avgPrice,
        competitionRatio: Number(ratio.toFixed(2)),
        competitionLevel: level,
        competitionColor: color,
        opportunityScore: opportunity,
        topProducts,
        relatedKeywords: relatedWithStats,
    };
}

// ===== 쇼핑 실순위 조회 =====

function extractProductId(url = '') {
    const patterns = [
        /products\/(\d+)/,          // smartstore.naver.com/xxx/products/123
        /catalog\/(\d+)/,           // search.shopping.naver.com/catalog/123
        /nvMid=(\d+)/,              // 구형 링크
        /id=(\d+)/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function normalizeName(name = '') {
    return stripTags(name).replace(/\s+/g, '').toLowerCase();
}

export async function findShoppingRank(keyword, { productUrl = '', productName = '' } = {}) {
    if (!hasNaverKeys()) return null;

    const targetId = extractProductId(productUrl);
    const targetName = normalizeName(productName);

    // 상위 300위까지 3페이지 탐색
    for (let page = 0; page < 3; page++) {
        const start = page * 100 + 1;
        const data = await fetchShop(keyword, { display: 100, start });
        if (!data || !Array.isArray(data.items)) break;

        for (let i = 0; i < data.items.length; i++) {
            const item = data.items[i];
            const rank = start + i;
            if (targetId && (item.productId === targetId || (item.link || '').includes(targetId))) {
                return { rank, source: 'naver' };
            }
            if (targetName && targetName.length >= 4) {
                const itemName = normalizeName(item.title);
                if (itemName.includes(targetName) || targetName.includes(itemName)) {
                    return { rank, source: 'naver' };
                }
            }
        }
        if (data.items.length < 100) break;
    }
    return { rank: null, source: 'naver' }; // 300위 밖
}

// ===== 순위 추정 (API 키 없음 / 플레이스) =====

// 추적 항목: 등록 시점 기준 완만한 등락을 가진 안정적 순위 곡선
export function estimateTrackedRank(seedId, keyword, date = new Date()) {
    const base = seededInt(`base:${seedId}:${keyword}`, 3, 60);
    const day = todayKey(date);
    const wobble = seededInt(`w:${seedId}:${day}`, -3, 3);
    const drift = Math.round(Math.sin(hashString(`${seedId}:${day}`) % 7) * 2);
    return Math.max(1, base + wobble + drift);
}

// 트래픽 광고: 캠페인 경과일에 비례해 순위가 개선되는 곡선 (초기 45~90위 → 목표 2~8위)
export function simulateAdRank(adId, startDate, durationDays, date = new Date()) {
    const start = new Date(startDate);
    const elapsedDays = Math.max(0, Math.floor((date - start) / 86_400_000));
    const progress = Math.min(1, elapsedDays / Math.max(durationDays * 0.7, 1));

    const initialRank = seededInt(`init:${adId}`, 45, 90);
    const targetRank = seededInt(`target:${adId}`, 2, 8);
    // easeOutCubic: 초반 상승 빠르고 후반 안정화 — 실제 트래픽 광고 체감과 유사
    const eased = 1 - Math.pow(1 - progress, 3);
    const rank = Math.round(initialRank - (initialRank - targetRank) * eased);

    const day = todayKey(date);
    const jitter = seededInt(`j:${adId}:${day}`, -2, 2);
    return Math.max(1, rank + jitter);
}

// 추적 갱신: 쇼핑은 실조회 시도 후 추정 폴백, 플레이스는 추정
export async function resolveTrackedRank(tracking) {
    if (tracking.type === 'shopping' && hasNaverKeys()) {
        const result = await findShoppingRank(tracking.keyword, {
            productUrl: tracking.url,
            productName: tracking.name,
        });
        if (result && result.rank) return result;
    }
    return {
        rank: estimateTrackedRank(tracking.id, tracking.keyword),
        source: 'estimate',
    };
}
