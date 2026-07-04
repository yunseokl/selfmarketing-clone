import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 전체 문의 목록 (상태/카테고리 필터)
export async function GET(request) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const category = searchParams.get('category');

        const where = {};
        if (status && status !== 'all') where.status = status;
        if (category && category !== 'all') where.category = category;

        const inquiries = await prisma.inquiry.findMany({
            where,
            include: {
                user: { select: { id: true, email: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ inquiries });
    } catch (error) {
        console.error('Error fetching inquiries:', error);
        return NextResponse.json({ error: '문의 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
