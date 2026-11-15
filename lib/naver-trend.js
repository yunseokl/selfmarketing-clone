// 네이버 데이터랩 "검색어 트렌드" 연동 — 키워드별 월간 검색 추이(상대값)를 가져옵니다.
//
// 왜 이것만 쓰나
// - 네이버 쇼핑 검색 API(shop.json)는 2026-07-31 종료되어 상품수·상위 상품을 받을 수 없습니다.
// - 검색광고 API의 월간 검색수는 광고 관리 용도로만 쓸 수 있어, 운영자 키로 회원에게 보여 주면 약관 위반입니다.
// - 그래서 예전처럼 검색량·상품수를 "추정"이라며 만들어 내지 않고, 공식으로 받을 수 있는 상대 추이만 보여 줍니다.
//
// 값의 의미: ratio 는 조회 기간·키워드 묶음 안에서 가장 큰 값을 100으로 둔 상대값입니다(실제 검색 횟수 아님).
//
// 키 설정 (둘 중 하나)
// - NAVER_API_HUB_KEY_ID / NAVER_API_HUB_KEY : NAVER API HUB(네이버 클라우드) 키 — 신규 발급은 이쪽만 가능
// - NAVER_CLIENT_ID / NAVER_CLIENT_SECRET   : 기존 네이버 개발자센터 키(데이터랩 사용 설정된 앱, 2027-06-30까지)

export const TREND_MAX_KEYWORDS = 5;
export const TREND_MONTHS = 36;

const HUB_URL = 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search';
const LEGACY_URL = 'https://openapi.naver.com/v1/datalab/search';

export function trendConfig(env = process.env) {
    if (env.NAVER_API_HUB_KEY_ID && env.NAVER_API_HUB_KEY) {
        return {
            mode: 'hub',
            // NAVER_TREND_API_URL: 프록시를 거치거나 테스트용 모의 서버로 보낼 때만 설정합니다.
            url: env.NAVER_TREND_API_URL || HUB_URL,
            headers: {
                'X-NCP-APIGW-API-KEY-ID': env.NAVER_API_HUB_KEY_ID,
                'X-NCP-APIGW-API-KEY': env.NAVER_API_HUB_KEY,
            },
        };
    }
    if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) {
        return {
            mode: 'legacy',
            url: LEGACY_URL,
            headers: {
                'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
            },
        };
    }
    return null;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

// 지난달 말일까지의 최근 N개월(이번 달은 아직 끝나지 않아 값이 작게 나오므로 제외). KST 기준.
export function trendRange(now = new Date(), months = TREND_MONTHS) {
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const year = kst.getUTCFullYear();
    const month = kst.getUTCMonth(); // 0~11, 이번 달
    const end = new Date(Date.UTC(year, month, 0)); // 지난달 말일
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
    const floor = new Date(Date.UTC(2016, 0, 1));
    const from = start < floor ? floor : start;
    const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { startDate: fmt(from), endDate: fmt(end) };
}

export function buildTrendBody(keywords, now = new Date(), months = TREND_MONTHS) {
    return {
        ...trendRange(now, months),
        timeUnit: 'month',
        keywordGroups: keywords.slice(0, TREND_MAX_KEYWORDS).map((keyword) => ({
            groupName: keyword,
            // 공백 유무 차이로 검색이 갈리는 것을 한 묶음으로 봅니다.
            keywords: [...new Set([keyword, keyword.replace(/\s+/g, '')])],
        })),
    };
}

// 응답 → 요청한 키워드 순서의 시리즈. 응답에 없는 키워드는 빈 시리즈로 둡니다.
export function parseTrendResponse(json, keywords) {
    const results = Array.isArray(json?.results) ? json.results : [];
    return keywords.map((keyword) => {
        const found = results.find((r) => r?.title === keyword);
        const points = Array.isArray(found?.data)
            ? found.data
                .filter((d) => typeof d?.period === 'string' && Number.isFinite(Number(d?.ratio)))
                .map((d) => ({ period: d.period.slice(0, 7), ratio: Number(d.ratio) }))
                .sort((a, b) => a.period.localeCompare(b.period))
            : [];
        return { keyword, points };
    });
}

function mean(values) {
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function changePercent(current, base) {
    return base > 0 ? ((current - base) / base) * 100 : null;
}

// 시리즈별 요약: 최근 12개월 평균, 기준 키워드 대비 상대 수요, 성수기, 최근 추세, 전년 동기 대비
export function summarizeTrend(series) {
    const baseAvg = mean((series[0]?.points || []).slice(-12).map((p) => p.ratio));

    return series.map(({ keyword, points }) => {
        const ratios = points.map((p) => p.ratio);
        const hasData = ratios.some((r) => r > 0);
        const avg12 = mean(ratios.slice(-12));

        // 성수기: 달(1~12월)별 평균이 전체 평균보다 뚜렷이 높은 달. 2년 이상 자료가 있을 때만 계산.
        let peakMonths = [];
        if (hasData && points.length >= 24) {
            const overall = mean(ratios);
            const byMonth = Array.from({ length: 12 }, () => []);
            for (const p of points) byMonth[Number(p.period.slice(5, 7)) - 1].push(p.ratio);
            peakMonths = byMonth
                .map((values, index) => ({ month: index + 1, index: overall > 0 ? mean(values) / overall : 0 }))
                .filter((m) => m.index >= 1.2)
                .sort((a, b) => b.index - a.index)
                .slice(0, 3)
                .map((m) => ({ month: m.month, index: Math.round(m.index * 100) / 100 }));
        }

        const recent3 = mean(ratios.slice(-3));
        const prev3 = mean(ratios.slice(-6, -3));
        const lastYear3 = mean(ratios.slice(-15, -12));

        return {
            keyword,
            hasData,
            avg12: Math.round(avg12 * 10) / 10,
            relativeIndex: baseAvg > 0 ? Math.round((avg12 / baseAvg) * 100) : null,
            peakMonths,
            recentChange: ratios.length >= 6 ? changePercent(recent3, prev3) : null,
            yearChange: ratios.length >= 15 ? changePercent(recent3, lastYear3) : null,
        };
    });
}

// 실제 호출. 실패 사유를 code 로 구분해 화면이 정확히 안내할 수 있게 합니다.
export async function fetchTrend(keywords, { now = new Date(), fetchImpl = fetch, env = process.env } = {}) {
    const config = trendConfig(env);
    if (!config) return { ok: false, code: 'NOT_CONFIGURED' };

    const body = buildTrendBody(keywords, now);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetchImpl(config.url, {
            method: 'POST',
            headers: { ...config.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
            signal: controller.signal,
        });

        if (!res.ok) {
            // 401/403: 키가 틀렸거나 앱에 데이터랩 사용 설정이 없음, 429: 호출 한도 초과
            const code = res.status === 429 ? 'RATE_LIMITED' : res.status === 401 || res.status === 403 ? 'KEY_REJECTED' : 'UPSTREAM_ERROR';
            return { ok: false, code, status: res.status };
        }

        const series = parseTrendResponse(await res.json(), keywords);
        return {
            ok: true,
            range: { startDate: body.startDate, endDate: body.endDate },
            series,
            summary: summarizeTrend(series),
        };
    } catch (error) {
        return { ok: false, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'UPSTREAM_ERROR' };
    } finally {
        clearTimeout(timer);
    }
}
