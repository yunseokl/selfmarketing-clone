import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateNoticeSchema } from '@/lib/validations/content';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// PATCH - 공지 수정
export async function PATCH(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = updateNoticeSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const notice = await prisma.notice.update({
            where: { id: params.id },
            data: validationResult.data
        });

        return NextResponse.json({
            message: '공지가 수정되었습니다.',
            notice
        });
    } catch (error) {
        console.error('Error updating notice:', error);
        return NextResponse.json({ error: '공지 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 공지 삭제
export async function DELETE(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        await prisma.notice.delete({ where: { id: params.id } });

        return NextResponse.json({ message: '공지가 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting notice:', error);
        return NextResponse.json({ error: '공지 삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
