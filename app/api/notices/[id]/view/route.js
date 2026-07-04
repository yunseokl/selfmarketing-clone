import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// 조회수 증가도 비로그인 사용자가 호출할 수 있는 공개 API입니다.
export const dynamic = 'force-dynamic';

// POST - 공지사항 조회수 1 증가
export async function POST(request, { params }) {
    try {
        const notice = await prisma.notice.update({
            where: { id: params.id },
            data: { views: { increment: 1 } }
        });

        return NextResponse.json({ views: notice.views });
    } catch (error) {
        console.error('Error updating notice views:', error);
        return NextResponse.json({ error: '조회수 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
