// 네이버 플레이스 공개 조회를 "천천히, 적게" 보내기 위한 장치.
//
// 네이버가 조회를 막는 가장 흔한 이유는 짧은 시간에 요청이 몰리는 것입니다.
// 그래서 이 서버에서 나가는 요청은 모두 여기 한 곳을 지나가게 하고,
//   1) 한 번에 하나씩, 1초 간격을 두고 보내고
//   2) 같은 조회는 일정 시간 저장해 둔 결과를 다시 쓰고
//   3) 네이버가 거절(429 등)하면 우회하지 않고 일정 시간 조회를 멈추며
//   4) 하루 요청 수에 상한을 둡니다.
// IP·기기 정보를 바꿔 가며 차단을 피하는 장치는 일부러 넣지 않았습니다.

export class PlaceLookupError extends Error {
    constructor(code, message, extra = {}) {
        super(message);
        this.name = 'PlaceLookupError';
        this.code = code;
        Object.assign(this, extra);
    }
}

function kstDay(ms) {
    return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function createGate({
    minIntervalMs = 1000,
    cacheMax = 500,
    baseCooldownMs = 10 * 60 * 1000,
    maxCooldownMs = 2 * 60 * 60 * 1000,
    dailyMax = 3000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
    let tail = Promise.resolve();
    let lastStartedAt = -Infinity;
    let pausedUntil = 0;
    let trips = 0;
    let pauseReason = null;
    let countDay = null;
    let countToday = 0;
    const cache = new Map();
    const inflight = new Map();

    function rollDay() {
        const day = kstDay(now());
        if (day !== countDay) {
            countDay = day;
            countToday = 0;
        }
    }

    function assertOpen() {
        if (now() < pausedUntil) {
            throw new PlaceLookupError('PAUSED', '네이버가 조회를 잠시 제한해 쉬는 중입니다.', { retryAt: pausedUntil });
        }
    }

    // 외부 요청 1건을 줄 세워 실행합니다. task 는 요청을 실제로 보내는 함수입니다.
    function run(task) {
        const job = tail.then(async () => {
            assertOpen();
            rollDay();
            if (countToday >= dailyMax) {
                throw new PlaceLookupError('DAILY_LIMIT', '오늘 조회 가능 횟수를 모두 사용했습니다.');
            }
            const wait = lastStartedAt + minIntervalMs - now();
            if (wait > 0) await sleep(wait);
            // 기다리는 동안 다른 요청이 거절당했을 수 있어 다시 확인합니다.
            assertOpen();
            lastStartedAt = now();
            countToday += 1;
            return task();
        });
        tail = job.catch(() => {});
        return job;
    }

    // 네이버가 요청을 거절했을 때 호출합니다. 연속으로 거절당하면 쉬는 시간이 두 배씩 늘어납니다.
    function trip(reason) {
        trips += 1;
        const cooldown = Math.min(baseCooldownMs * 2 ** (trips - 1), maxCooldownMs);
        pausedUntil = now() + cooldown;
        pauseReason = reason || null;
        return pausedUntil;
    }

    // 정상 응답을 받으면 연속 거절 횟수를 초기화합니다.
    function succeed() {
        trips = 0;
    }

    function store(key, ttlMs, value, fetchedAt) {
        cache.delete(key);
        cache.set(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs });
        while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    }

    // 같은 key 의 조회는 ttlMs 동안 저장해 둔 결과를 돌려주고, 동시에 들어온 같은 조회는 한 번만 보냅니다.
    //   refresh: 저장된 결과를 쓰지 않고 새로 조회합니다.
    //   keep(value): false 를 돌려주면 그 결과는 저장하지 않습니다(의심스러운 빈 응답 등).
    async function cached(key, ttlMs, loader, { refresh = false, keep = () => true } = {}) {
        const hit = cache.get(key);
        if (!refresh && hit && hit.expiresAt > now()) {
            return { value: hit.value, fetchedAt: hit.fetchedAt, cached: true };
        }
        if (inflight.has(key)) return inflight.get(key);

        const pending = (async () => {
            const value = await loader();
            const fetchedAt = now();
            if (keep(value)) store(key, ttlMs, value, fetchedAt);
            else cache.delete(key);
            return { value, fetchedAt, cached: false };
        })().finally(() => inflight.delete(key));

        inflight.set(key, pending);
        return pending;
    }

    // 이미 확인한 결과를 직접 저장합니다.
    function remember(key, ttlMs, value) {
        store(key, ttlMs, value, now());
    }

    function status() {
        rollDay();
        const paused = now() < pausedUntil;
        return {
            paused,
            pausedUntil: paused ? pausedUntil : null,
            pauseReason: paused ? pauseReason : null,
            requestsToday: countToday,
            dailyMax,
        };
    }

    return { run, trip, succeed, cached, remember, status };
}
