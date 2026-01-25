import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// GET - 순위 추적 목록 조회
export async function GET(request) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        });

        if (!user) {
            return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
        }

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type'); // 'shopping' or 'place'

        const where = { userId: user.id };
        if (type) {
            where.type = type;
        }

        const trackings = await prisma.rankTracking.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ trackings });
    } catch (error) {
        console.error('Error fetching rank trackings:', error);
        return NextResponse.json({ error: '순위 추적 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 순위 추적 등록
export async function POST(request) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        });

        if (!user) {
            return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
        }

        const body = await request.json();
        const { type, url, name, image, keyword } = body;

        // Check limit (5 items per user per type)
        const existingCount = await prisma.rankTracking.count({
            where: { userId: user.id, type }
        });

        if (existingCount >= 5) {
            return NextResponse.json({
                error: `${type === 'shopping' ? '쇼핑' : '플레이스'} 순위 추적은 최대 5개까지 등록 가능합니다.`
            }, { status: 400 });
        }

        // Create tracking
        const tracking = await prisma.rankTracking.create({
            data: {
                userId: user.id,
                type,
                url,
                name: name || url,
                image,
                keyword,
                currentRank: Math.floor(Math.random() * 50) + 1, // Simulated rank for demo
            }
        });

        return NextResponse.json({
            message: '순위 추적이 등록되었습니다.',
            tracking
        });
    } catch (error) {
        console.error('Error creating rank tracking:', error);
        return NextResponse.json({ error: '순위 추적 등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 순위 추적 삭제
export async function DELETE(request) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID가 필요합니다.' }, { status: 400 });
        }

        await prisma.rankTracking.delete({
            where: { id }
        });

        return NextResponse.json({ message: '순위 추적이 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting rank tracking:', error);
        return NextResponse.json({ error: '순위 추적 삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
