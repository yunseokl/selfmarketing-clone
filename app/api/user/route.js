import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

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

        const body = await request.json();
        const { name, phone, image, currentPassword, newPassword } = body;

        let hashedPassword;
        if (newPassword) {
            if (newPassword.length < 8) {
                return NextResponse.json({ error: '새 비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
            }

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
                name: name || undefined,
                phone: phone || undefined,
                image: image || undefined,
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
