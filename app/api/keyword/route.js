import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { fetchTrend, trendConfig } from '@/lib/naver-trend';
import { keywordTrendSchema, uniqueKeywords } from '@/lib/validations/keyword';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// 키워드 트렌드 — 네이버 데이터랩 검색어 트렌드(상대값)만 보여 줍니다.
// 검색량·상품수를 만들어 내던 예전 "추정" 분석은 제거했습니다(lib/naver-trend.js 주석 참고).

// 같은 조회는 10분간 메모리에서 재사용합니다(외부 호출 한도 보호). DB에는 조회 결과를 저장하지 않습니다.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

// 회원당 10분에 30회까지
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30;
const hits = new Map();

const ERROR_RESPONSES = {
    NOT_CONFIGURED: { status: 503, error: '검색 트렌드 데이터 연동이 아직 설정되지 않았습니다.' },
    KEY_REJECTED: { status: 502, error: '검색 트렌드 연동 키를 확인해야 합니다. 관리자에게 문의해주세요.' },
    RATE_LIMITED: { status: 429, error: '오늘 조회 한도를 모두 사용했습니다. 잠시 후 다시 시도해주세요.' },
    TIMEOUT: { status: 504, error: '네이버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해주세요.' },
    UPSTREAM_ERROR: { status: 502, error: '검색 트렌드를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' },
};

async function getCurrentUser() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return { error: '로그인이 필요합니다.', status: 401 };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });

    if (!user) {
        return { error: '사용자를 찾을 수 없습니다.', status: 404 };
    }

    return { user };
}

function allowRequest(userId, now = Date.now()) {
    const recent = (hits.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
        hits.set(userId, recent);
        return false;
    }
    recent.push(now);
    hits.set(userId, recent);
    if (hits.size > 5000) hits.clear();
    return true;
}

// GET - 최근 조회한 키워드와 연동 설정 여부
export async function GET() {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const searches = await prisma.keywordSearch.findMany({
            where: { userId: userCheck.user.id },
            orderBy: { createdAt: 'desc' },
            take: 40,
            select: { id: true, keyword: true, createdAt: true },
        });

        const seen = new Set();
        const recent = [];
        for (const item of searches) {
            // 예전 기록 중 지금 규칙으로는 조회할 수 없는 키워드는 목록에서 뺍니다.
            if (!keywordTrendSchema.shape.keyword.safeParse(item.keyword).success) continue;
            if (seen.has(item.keyword)) continue;
            seen.add(item.keyword);
            recent.push(item);
            if (recent.length >= 10) break;
        }

        return NextResponse.json({ recent, configured: Boolean(trendConfig()) });
    } catch (error) {
        console.error('Error fetching keyword searches:', error);
        return NextResponse.json({ error: '최근 조회 기록을 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 키워드 검색 추이 조회 (기준 키워드 + 비교 키워드 최대 4개)
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
        }

        const validation = keywordTrendSchema.safeParse(body);
        if (!validation.success) {
            const message = validation.error.errors[0]?.message || '입력값을 확인해주세요.';
            return NextResponse.json({ error: message }, { status: 400 });
        }

        const keywords = uniqueKeywords(validation.data.keyword, validation.data.compare);

        if (!trendConfig()) {
            const { status, error } = ERROR_RESPONSES.NOT_CONFIGURED;
            return NextResponse.json({ error, code: 'NOT_CONFIGURED' }, { status });
        }

        const cacheKey = keywords.join('|').toLowerCase();
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return NextResponse.json({ result: cached.result });
        }

        if (!allowRequest(userCheck.user.id)) {
            return NextResponse.json(
                { error: '조회가 너무 잦습니다. 10분 뒤에 다시 시도해주세요.', code: 'TOO_MANY_REQUESTS' },
                { status: 429 }
            );
        }

        const trend = await fetchTrend(keywords);
        if (!trend.ok) {
            const { status, error } = ERROR_RESPONSES[trend.code] || ERROR_RESPONSES.UPSTREAM_ERROR;
            console.error('Keyword trend fetch failed:', trend.code, trend.status || '');
            return NextResponse.json({ error, code: trend.code }, { status });
        }

        const result = {
            keywords,
            range: trend.range,
            series: trend.series,
            summary: trend.summary,
            checkedAt: new Date().toISOString(),
        };

        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { at: Date.now(), result });

        // 최근 조회 목록용으로 키워드만 남깁니다(조회 결과 수치는 저장하지 않음).
        await prisma.keywordSearch.create({
            data: {
                userId: userCheck.user.id,
                keyword: keywords[0],
                type: 'trend',
                result: JSON.stringify({ compare: keywords.slice(1) }),
            },
        });

        return NextResponse.json({ result });
    } catch (error) {
        console.error('Error fetching keyword trend:', error);
        return NextResponse.json({ error: '키워드 트렌드 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
