import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// GET - 사용자 정보 조회
export async function GET() {
    try {
        const session = await getServerSession();

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

        return NextResponse.json({ user });
    } catch (error) {
        console.error('Error fetching user:', error);
        return NextResponse.json({ error: '사용자 정보 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PUT - 사용자 정보 수정
export async function PUT(request) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const body = await request.json();
        const { name, phone, image } = body;

        const user = await prisma.user.update({
            where: { email: session.user.email },
            data: {
                name: name || undefined,
                phone: phone || undefined,
                image: image || undefined,
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
            message: '정보가 수정되었습니다.',
            user
        });
    } catch (error) {
        console.error('Error updating user:', error);
        return NextResponse.json({ error: '정보 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
