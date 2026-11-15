import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { kstDateKey, isValidDateKey, recordedPoints, upsertPoint, removePoint, summarize, MAX_TRACKINGS_PER_TYPE } from '@/lib/rank-log';
import { createRankTrackingSchema, recordRankSchema } from '@/lib/validations/rank-tracking';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// 순위 기록장 — 실제로 확인한 순위만 날짜별로 기록합니다. 서버가 순위를 만들어 내지 않습니다.
// 이 API는 회원이 직접 적는 기록을 다루고, 플레이스 실제 조회 기록은 /api/place-insight/rank 가 남깁니다.
// 자세한 배경은 lib/rank-log.js 참고.

// 사용자당 등록 한도(타입별)
const MAX_TRACKINGS = MAX_TRACKINGS_PER_TYPE;

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

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

// DB 행 → 화면용. 실제로 확인한 기록만 이력으로 내보내고 현재·이전 순위도 그 값에서 다시 계산합니다.
function toClient(tracking) {
    const points = recordedPoints(tracking.rankHistory);
    const { currentRank, previousRank, lastDate, recordCount } = summarize(points);
    return {
        id: tracking.id,
        type: tracking.type,
        url: tracking.url,
        name: tracking.name,
        image: tracking.image,
        keyword: tracking.keyword,
        createdAt: tracking.createdAt,
        currentRank,
        previousRank,
        lastDate,
        recordCount,
        history: points.map(({ date, rank, src }) => ({ date, rank, src })),
    };
}

// GET - 순위 기록장 목록
export async function GET(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');

        const where = { userId: userCheck.user.id };
        if (type === 'shopping' || type === 'place') {
            where.type = type;
        }

        const trackings = await prisma.rankTracking.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ trackings: trackings.map(toClient), today: kstDateKey() });
    } catch (error) {
        console.error('Error fetching rank trackings:', error);
        return NextResponse.json({ error: '순위 기록장 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 항목 등록 (오늘 확인한 순위를 함께 적으면 첫 기록으로 저장)
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const body = await readJson(request);
        const validation = createRankTrackingSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }

        const { type, url, name, image, keyword, rank } = validation.data;

        const existingCount = await prisma.rankTracking.count({
            where: { userId: userCheck.user.id, type }
        });

        if (existingCount >= MAX_TRACKINGS) {
            return NextResponse.json({ error: `최대 ${MAX_TRACKINGS}개까지 등록할 수 있습니다.` }, { status: 400 });
        }

        const points = rank !== undefined ? upsertPoint([], { date: kstDateKey(), rank }) : [];

        const tracking = await prisma.rankTracking.create({
            data: {
                userId: userCheck.user.id,
                type,
                url,
                name: name || url,
                image: image || null,
                keyword,
                currentRank: summarize(points).currentRank,
                rankHistory: JSON.stringify(points),
            }
        });

        return NextResponse.json({
            message: '순위 기록장에 등록했습니다.',
            tracking: toClient(tracking)
        });
    } catch (error) {
        console.error('Error creating rank tracking:', error);
        return NextResponse.json({ error: '등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PATCH - 순위 기록 추가·수정·삭제
export async function PATCH(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const body = await readJson(request);
        const validation = recordRankSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }

        const today = kstDateKey();
        const { id, rank, remove } = validation.data;
        const date = validation.data.date || today;

        if (!isValidDateKey(date) || date > today || date < '2020-01-01') {
            return NextResponse.json({ error: { date: ['오늘 이전의 올바른 날짜를 선택해주세요.'] } }, { status: 400 });
        }

        const tracking = await prisma.rankTracking.findFirst({
            where: { id, userId: userCheck.user.id }
        });

        if (!tracking) {
            return NextResponse.json({ error: '순위 기록장 항목을 찾을 수 없습니다.' }, { status: 404 });
        }

        const current = recordedPoints(tracking.rankHistory);
        const points = remove ? removePoint(current, date) : upsertPoint(current, { date, rank });
        const summary = summarize(points);

        const updated = await prisma.rankTracking.update({
            where: { id: tracking.id },
            data: {
                currentRank: summary.currentRank,
                previousRank: summary.previousRank,
                rankHistory: JSON.stringify(points),
            },
        });

        return NextResponse.json({
            message: remove ? '기록을 삭제했습니다.' : '순위를 기록했습니다.',
            tracking: toClient(updated)
        });
    } catch (error) {
        console.error('Error recording rank:', error);
        return NextResponse.json({ error: '순위 기록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 항목 삭제
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

        const deleted = await prisma.rankTracking.deleteMany({
            where: { id, userId: userCheck.user.id }
        });

        if (deleted.count !== 1) {
            return NextResponse.json({ error: '순위 기록장 항목을 찾을 수 없습니다.' }, { status: 404 });
        }

        return NextResponse.json({ message: '삭제했습니다.' });
    } catch (error) {
        console.error('Error deleting rank tracking:', error);
        return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
