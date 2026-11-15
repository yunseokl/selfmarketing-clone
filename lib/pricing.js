// 트래픽 광고 가격표와 금액 계산 — 서버가 금액을 정하는 유일한 기준입니다.
// 클라이언트가 보낸 단가(pricePerClick)는 절대 신뢰하지 않습니다.
// (음수 단가를 보내면 잔액이 늘어나던 결함의 재발 방지 지점)

export const AD_SERVICE_PRICES = {
    selma30: 30,
    selma50: 50,
    premium: 100,
};

export const AD_SERVICE_TYPES = Object.keys(AD_SERVICE_PRICES);
export const DEFAULT_AD_SERVICE = 'selma30';

const DAY_MS = 24 * 60 * 60 * 1000;

function isPositiveInt(value) {
    return Number.isInteger(value) && value > 0;
}

// 상품 유형 → 건당 단가. 알 수 없는 유형이면 null.
export function resolveAdPrice(serviceType = DEFAULT_AD_SERVICE) {
    return Object.prototype.hasOwnProperty.call(AD_SERVICE_PRICES, serviceType)
        ? AD_SERVICE_PRICES[serviceType]
        : null;
}

// 광고 총액 계산. 입력이 하나라도 정상 범위를 벗어나면 null을 돌려줘 호출부가 거절하게 합니다.
export function calculateAdCost({ serviceType = DEFAULT_AD_SERVICE, dailyGoal, duration }) {
    const pricePerClick = resolveAdPrice(serviceType);
    if (pricePerClick == null || !isPositiveInt(dailyGoal) || !isPositiveInt(duration)) {
        return null;
    }
    return { pricePerClick, totalCost: pricePerClick * dailyGoal * duration };
}

// 중도 취소 환불액: 남은 일수(올림) 비례. 0 이상, 결제 금액 이하로 고정합니다.
export function calculateAdRefund({ totalCost, duration, endDate, now = new Date() }) {
    if (!isPositiveInt(totalCost) || !isPositiveInt(duration)) return 0;
    const remainingMs = new Date(endDate).getTime() - new Date(now).getTime();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
    const remainingDays = Math.min(duration, Math.ceil(remainingMs / DAY_MS));
    return Math.min(totalCost, Math.floor((totalCost / duration) * remainingDays));
}

// 블로그 배포 취소 환불액: 아직 발행되지 않은 건수 비례.
export function calculateBlogRefund({ totalCost, postCount, publishedCount = 0 }) {
    if (!isPositiveInt(totalCost) || !isPositiveInt(postCount)) return 0;
    const published = Math.max(0, Math.min(postCount, Number.isInteger(publishedCount) ? publishedCount : 0));
    return Math.floor((totalCost * (postCount - published)) / postCount);
}
