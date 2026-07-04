import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// 공지사항 목록은 비로그인 사용자에게도 노출되는 공개 API입니다.
export const dynamic = 'force-dynamic';

// GET - 공지사항 공개 목록 조회 (고정 공지 우선, 최신순)
export async function GET() {
    try {
        const notices = await prisma.notice.findMany({
            orderBy: [
                { isPinned: 'desc' },
                { createdAt: 'desc' }
            ]
        });

        return NextResponse.json({ notices });
    } catch (error) {
        console.error('Error fetching notices:', error);
        return NextResponse.json({ error: '공지사항 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
