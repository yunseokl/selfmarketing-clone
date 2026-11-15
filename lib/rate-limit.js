// 회원별 호출 횟수 제한(메모리). 서버 한 대에서만 맞게 동작하며, 재시작하면 초기화됩니다.
export function createRateLimiter({ windowMs, max, maxKeys = 5000 }) {
    const hits = new Map();
    return {
        allow(key, now = Date.now()) {
            const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
            if (recent.length >= max) {
                hits.set(key, recent);
                return false;
            }
            recent.push(now);
            hits.set(key, recent);
            if (hits.size > maxKeys) hits.clear();
            return true;
        },
    };
}
