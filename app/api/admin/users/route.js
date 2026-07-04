import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 전체 회원 목록
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                balance: true,
                role: true,
                createdAt: true,
                _count: {
                    select: {
                        shoppingAds: true,
                        placeAds: true,
                        rankTracking: true,
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ users });
    } catch (error) {
        console.error('Error fetching users:', error);
        return NextResponse.json({ error: '회원 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
