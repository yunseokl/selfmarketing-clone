import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { noticeSchema } from '@/lib/validations/content';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 전체 공지 목록 (고정 우선, 최신순)
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const notices = await prisma.notice.findMany({
            orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }]
        });

        return NextResponse.json({ notices });
    } catch (error) {
        console.error('Error fetching notices:', error);
        return NextResponse.json({ error: '공지 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 공지 작성
export async function POST(request) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = noticeSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const notice = await prisma.notice.create({
            data: validationResult.data
        });

        return NextResponse.json({
            message: '공지가 등록되었습니다.',
            notice
        });
    } catch (error) {
        console.error('Error creating notice:', error);
        return NextResponse.json({ error: '공지 등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
