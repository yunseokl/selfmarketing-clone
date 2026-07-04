import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateUserSchema } from '@/lib/validations/admin';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// PUT - 회원 정보 수정 (잔액 등)
export async function PUT(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = updateUserSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const user = await prisma.user.update({
            where: { id: params.id },
            data: validationResult.data,
            select: {
                id: true,
                email: true,
                name: true,
                balance: true,
                role: true,
            }
        });

        return NextResponse.json({
            message: '회원 정보가 수정되었습니다.',
            user
        });
    } catch (error) {
        console.error('Error updating user:', error);
        return NextResponse.json({ error: '회원 정보 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
