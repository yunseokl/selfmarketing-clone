import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { resolveTrackedRank, hasNaverKeys } from '@/lib/naver';
import { applyDailyUpdate, kstDateKey, parseHistory, MAX_HISTORY } from '@/lib/rank-refresh';
import { createRankTrackingSchema, refreshRankTrackingSchema } from '@/lib/validations/rank-tracking';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// 사용자당 순위추적 등록 한도(타입별)
const MAX_TRACKINGS = 10;

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

// 이 요청 시점에 재조회하지 않은 항목의 출처 추정 — 쇼핑+API키가 있어야 실순위(naver)입니다.
function sourceFor(tracking) {
    return tracking.type === 'shopping' && hasNaverKeys() ? 'naver' : 'estimate';
}

// GET - 순위 추적 목록 조회 (오늘 갱신 안 된 항목은 자동 재조회)
export async function GET(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type'); // 'shopping' or 'place'

        const where = { userId: userCheck.user.id };
        if (type) {
            where.type = type;
        }

        const trackings = await prisma.rankTracking.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        const today = kstDateKey();
        const result = [];
        for (const tracking of trackings) {
            const history = parseHistory(tracking.rankHistory);
            const last = history[history.length - 1];

            if (last && last.date === today) {
                // 오늘 이미 기록됨 — 그대로 반환
                result.push({ ...tracking, source: sourceFor(tracking) });
            } else {
                result.push(await applyDailyUpdate(tracking, today));
            }
        }

        return NextResponse.json({ trackings: result });
    } catch (error) {
        console.error('Error fetching rank trackings:', error);
        return NextResponse.json({ error: '순위 추적 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 순위 추적 등록 (등록 즉시 1회 순위 조회)
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const body = await request.json();
        const validation = createRankTrackingSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }

        const { type, url, name, image, keyword } = validation.data;

        const existingCount = await prisma.rankTracking.count({
            where: { userId: userCheck.user.id, type }
        });

        if (existingCount >= MAX_TRACKINGS) {
            return NextResponse.json({ error: '최대 10개까지 추적할 수 있습니다.' }, { status: 400 });
        }

        const created = await prisma.rankTracking.create({
            data: {
                userId: userCheck.user.id,
                type,
                url,
                name: name || url,
                image: image || null,
                keyword,
            }
        });

        // 등록 직후 1회 조회해 현재 순위와 히스토리 시작점을 만듭니다.
        const resolved = await resolveTrackedRank(created);
        const today = kstDateKey();
        const tracking = await prisma.rankTracking.update({
            where: { id: created.id },
            data: {
                currentRank: resolved.rank,
                rankHistory: JSON.stringify([{ date: today, rank: resolved.rank }]),
            }
        });

        return NextResponse.json({
            message: '순위 추적이 등록되었습니다.',
            tracking: { ...tracking, source: resolved.source }
        });
    } catch (error) {
        console.error('Error creating rank tracking:', error);
        return NextResponse.json({ error: '순위 추적 등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PATCH - 순위 즉시 재조회(강제 갱신)
export async function PATCH(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const body = await request.json();
        const validation = refreshRankTrackingSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }

        const tracking = await prisma.rankTracking.findFirst({
            where: {
                id: validation.data.id,
                userId: userCheck.user.id,
            }
        });

        if (!tracking) {
            return NextResponse.json({ error: '순위 추적 항목을 찾을 수 없습니다.' }, { status: 404 });
        }

        const resolved = await resolveTrackedRank(tracking);
        const newRank = resolved.rank;
        const today = kstDateKey();
        const history = parseHistory(tracking.rankHistory);
        const last = history[history.length - 1];
        const sameDay = last && last.date === today;

        // 같은 날 강제 갱신이면 오늘 스냅샷을 교체, 새 날이면 append(최대 90개)
        const nextHistory = sameDay
            ? [...history.slice(0, -1), { date: today, rank: newRank }]
            : [...history, { date: today, rank: newRank }].slice(-MAX_HISTORY);

        const data = {
            currentRank: newRank,
            rankHistory: JSON.stringify(nextHistory),
        };
        // 같은 날 재조회는 전일 대비 변동 비교가 깨지지 않도록 previousRank를 유지합니다.
        if (!sameDay) {
            data.previousRank = tracking.currentRank ?? null;
        }

        const updated = await prisma.rankTracking.update({
            where: { id: tracking.id },
            data,
        });

        return NextResponse.json({
            message: '순위 정보가 갱신되었습니다.',
            tracking: { ...updated, source: resolved.source }
        });
    } catch (error) {
        console.error('Error refreshing rank tracking:', error);
        return NextResponse.json({ error: '순위 정보 갱신 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 순위 추적 삭제
export async function DELETE(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID가 필요합니다.' }, { status: 400 });
        }

        const tracking = await prisma.rankTracking.findFirst({
            where: {
                id,
                userId: userCheck.user.id,
            }
        });

        if (!tracking) {
            return NextResponse.json({ error: '순위 추적 항목을 찾을 수 없습니다.' }, { status: 404 });
        }

        await prisma.rankTracking.delete({
            where: { id: tracking.id }
        });

        return NextResponse.json({ message: '순위 추적이 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting rank tracking:', error);
        return NextResponse.json({ error: '순위 추적 삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
