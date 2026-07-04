import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { analyzeKeyword } from '@/lib/naver';
import { analyzeKeywordSchema } from '@/lib/validations/keyword';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

const CACHE_WINDOW_MS = 10 * 60 * 1000;

async function getCurrentUser() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return { error: '로그인이 필요합니다.', status: 401 };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email }
    });

    if (!user) {
        return { error: '사용자를 찾을 수 없습니다.', status: 404 };
    }

    return { user };
}

function summarizeResult(resultJson) {
    try {
        const parsed = JSON.parse(resultJson);
        return {
            monthlySearchTotal: parsed.monthlySearchTotal,
            productCount: parsed.productCount,
            competitionLevel: parsed.competitionLevel,
            opportunityScore: parsed.opportunityScore,
        };
    } catch {
        return null;
    }
}

// GET - 내 최근 키워드 검색 기록 조회
export async function GET() {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const searches = await prisma.keywordSearch.findMany({
            where: { userId: userCheck.user.id, type: 'shopping' },
            orderBy: { createdAt: 'desc' },
            take: 12,
        });

        const recent = searches.map((item) => ({
            id: item.id,
            keyword: item.keyword,
            createdAt: item.createdAt,
            summary: summarizeResult(item.result),
        }));

        return NextResponse.json({ recent });
    } catch (error) {
        console.error('Error fetching keyword searches:', error);
        return NextResponse.json({ error: '최근 검색 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 키워드 분석 (수요/경쟁/기회점수/연관키워드)
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const body = await request.json();
        const validation = analyzeKeywordSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }

        const { keyword } = validation.data;

        // 동일 키워드를 10분 내 재검색하면 새로 조회하지 않고 저장된 결과를 그대로 반환합니다.
        const cached = await prisma.keywordSearch.findFirst({
            where: {
                userId: userCheck.user.id,
                type: 'shopping',
                keyword,
                createdAt: { gte: new Date(Date.now() - CACHE_WINDOW_MS) },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (cached) {
            try {
                return NextResponse.json({ result: JSON.parse(cached.result) });
            } catch {
                // 캐시된 결과 파싱에 실패하면 아래로 이어져 새로 분석합니다.
            }
        }

        const result = await analyzeKeyword(keyword);

        await prisma.keywordSearch.create({
            data: {
                userId: userCheck.user.id,
                keyword,
                type: 'shopping',
                result: JSON.stringify(result),
            },
        });

        return NextResponse.json({ result });
    } catch (error) {
        console.error('Error analyzing keyword:', error);
        return NextResponse.json({ error: '키워드 분석 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
