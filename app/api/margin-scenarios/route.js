import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { saveMarginScenarioSchema, MAX_MARGIN_SCENARIOS } from '@/lib/validations/margin';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

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

function toClient(row) {
    let input = {};
    try {
        const parsed = JSON.parse(row.input);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
    } catch {
        input = {};
    }
    return { id: row.id, channel: row.channel, name: row.name, input, updatedAt: row.updatedAt };
}

// GET - 내가 저장한 계산 목록
export async function GET() {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const rows = await prisma.marginScenario.findMany({
            where: { userId: userCheck.user.id },
            orderBy: { updatedAt: 'desc' },
            take: MAX_MARGIN_SCENARIOS,
        });

        return NextResponse.json({ scenarios: rows.map(toClient) });
    } catch (error) {
        console.error('Error fetching margin scenarios:', error);
        return NextResponse.json({ error: '저장한 계산을 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 계산 저장 (id가 있으면 내 항목을 덮어씀)
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

        const validation = saveMarginScenarioSchema.safeParse(body);
        if (!validation.success) {
            const errors = validation.error.errors.map((e) => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { id, channel, name, input } = validation.data;
        const data = { channel, name, input: JSON.stringify(input) };

        if (id) {
            const updated = await prisma.marginScenario.updateMany({
                where: { id, userId: userCheck.user.id },
                data,
            });
            if (updated.count !== 1) {
                return NextResponse.json({ error: '저장한 계산을 찾을 수 없습니다.' }, { status: 404 });
            }
            const row = await prisma.marginScenario.findUnique({ where: { id } });
            return NextResponse.json({ message: '저장했습니다.', scenario: toClient(row) });
        }

        const count = await prisma.marginScenario.count({ where: { userId: userCheck.user.id } });
        if (count >= MAX_MARGIN_SCENARIOS) {
            return NextResponse.json(
                { error: `최대 ${MAX_MARGIN_SCENARIOS}개까지 저장할 수 있습니다. 안 쓰는 항목을 지워주세요.` },
                { status: 400 }
            );
        }

        const row = await prisma.marginScenario.create({
            data: { ...data, userId: userCheck.user.id },
        });
        return NextResponse.json({ message: '저장했습니다.', scenario: toClient(row) });
    } catch (error) {
        console.error('Error saving margin scenario:', error);
        return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 저장한 계산 삭제
export async function DELETE(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const id = new URL(request.url).searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'ID가 필요합니다.' }, { status: 400 });
        }

        const deleted = await prisma.marginScenario.deleteMany({
            where: { id, userId: userCheck.user.id },
        });
        if (deleted.count !== 1) {
            return NextResponse.json({ error: '저장한 계산을 찾을 수 없습니다.' }, { status: 404 });
        }

        return NextResponse.json({ message: '삭제했습니다.' });
    } catch (error) {
        console.error('Error deleting margin scenario:', error);
        return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
