import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateUserSchema } from '@/lib/validations/admin';
import { createNotification } from '@/lib/notify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

// 임시 비밀번호: 혼동되는 문자(0/O, 1/l/I) 제외 10자
function generateTempPassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(10);
    let out = '';
    for (let i = 0; i < 10; i++) {
        out += chars[bytes[i] % chars.length];
    }
    return out;
}

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

        // 비밀번호 초기화 액션 — 임시 비밀번호를 발급해 1회만 응답으로 반환
        if (body.resetPassword === true) {
            const target = await prisma.user.findUnique({
                where: { id: params.id },
                select: { id: true, email: true, password: true },
            });
            if (!target) {
                return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });
            }
            if (!target.password) {
                return NextResponse.json({ error: '소셜 로그인 회원은 비밀번호를 초기화할 수 없습니다.' }, { status: 400 });
            }

            const tempPassword = generateTempPassword();
            const hashed = await bcrypt.hash(tempPassword, 12);
            await prisma.user.update({
                where: { id: params.id },
                data: { password: hashed },
            });
            await createNotification(target.id, {
                type: 'system',
                title: '비밀번호가 초기화되었습니다',
                message: '관리자가 발급한 임시 비밀번호로 로그인한 뒤, 마이페이지에서 새 비밀번호로 변경해주세요.',
                link: '/dashboard/profile',
            });

            return NextResponse.json({
                message: '임시 비밀번호가 발급되었습니다. 이 비밀번호는 다시 조회할 수 없으니 지금 회원에게 전달하세요.',
                tempPassword,
            });
        }

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
