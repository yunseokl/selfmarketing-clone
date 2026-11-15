import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { z } from 'zod';

// 프로필 수정 입력 검증 — 모든 필드는 선택, 보낸 필드만 검사합니다.
const updateProfileSchema = z.object({
    name: z.string().trim().min(1, '이름을 입력해주세요.').max(50, '이름은 50자 이하로 입력해주세요.').optional(),
    phone: z.string().trim().max(20, '연락처는 20자 이하로 입력해주세요.').optional(),
    image: z.union([
        z.literal(''),
        z.string().trim().max(2000, '이미지 주소가 너무 깁니다.').url('이미지 URL 형식이 올바르지 않습니다.')
            .refine((value) => /^https?:\/\//i.test(value), '이미지는 http/https 주소만 사용할 수 있습니다.'),
    ]).optional(),
    currentPassword: z.string().max(200, '현재 비밀번호가 너무 깁니다.').optional(),
    newPassword: z.string()
        .min(8, '새 비밀번호는 8자 이상이어야 합니다.')
        .max(72, '새 비밀번호는 72자 이하여야 합니다.')
        .optional(),
});

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 사용자 정보 조회
export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                phone: true,
                balance: true,
                role: true,
                createdAt: true,
                password: true,
                _count: {
                    select: {
                        shoppingAds: true,
                        placeAds: true,
                        rankTracking: true,
                    }
                }
            }
        });

        if (!user) {
            return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
        }

        // 비밀번호 해시는 응답에 절대 포함하지 않고, 소셜 로그인 여부 판별용 플래그만 내려줍니다.
        const { password, ...userWithoutPassword } = user;

        return NextResponse.json({ user: { ...userWithoutPassword, hasPassword: !!password } });
    } catch (error) {
        console.error('Error fetching user:', error);
        return NextResponse.json({ error: '사용자 정보 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PUT - 사용자 정보 수정 (이름/전화/이미지), newPassword가 있으면 비밀번호 변경
export async function PUT(request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
        }

        const validation = updateProfileSchema.safeParse(body);
        if (!validation.success) {
            const errors = validation.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }
        const { name, phone, image, currentPassword, newPassword } = validation.data;

        let hashedPassword;
        if (newPassword) {

            const existingUser = await prisma.user.findUnique({
                where: { email: session.user.email },
                select: { password: true }
            });

            if (!existingUser?.password) {
                return NextResponse.json({ error: '소셜 로그인 계정은 비밀번호를 변경할 수 없습니다.' }, { status: 400 });
            }

            if (!currentPassword) {
                return NextResponse.json({ error: '현재 비밀번호를 입력해주세요.' }, { status: 400 });
            }

            const isValid = await bcrypt.compare(currentPassword, existingUser.password);
            if (!isValid) {
                return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 400 });
            }

            hashedPassword = await bcrypt.hash(newPassword, 12);
        }

        const user = await prisma.user.update({
            where: { email: session.user.email },
            data: {
                // undefined 는 변경 없음, 빈 문자열은 지우기(null)
                name: name === undefined ? undefined : name,
                phone: phone === undefined ? undefined : (phone === '' ? null : phone),
                image: image === undefined ? undefined : (image === '' ? null : image),
                password: hashedPassword,
            },
            select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                image: true,
                balance: true,
            }
        });

        return NextResponse.json({
            message: newPassword ? '비밀번호가 변경되었습니다.' : '정보가 수정되었습니다.',
            user
        });
    } catch (error) {
        console.error('Error updating user:', error);
        return NextResponse.json({ error: '정보 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
