import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createInquirySchema } from '@/lib/validations/support';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 내 문의 목록 조회 (?category= 필터 지원)
export async function GET(request) {
    try {
        const session = await getServerSession(authOptions);

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
        const category = searchParams.get('category');

        const where = { userId: user.id };
        if (category && category !== 'all') {
            where.category = category;
        }

        const inquiries = await prisma.inquiry.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ inquiries });
    } catch (error) {
        console.error('Error fetching inquiries:', error);
        return NextResponse.json({ error: '문의 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 1:1 문의 등록
export async function POST(request) {
    try {
        const session = await getServerSession(authOptions);

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

        // Zod 검증
        const validationResult = createInquirySchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { category, title, content } = validationResult.data;

        const inquiry = await prisma.inquiry.create({
            data: {
                userId: user.id,
                category,
                title,
                content,
            }
        });

        return NextResponse.json({
            message: '문의가 접수되었습니다.',
            inquiry
        });
    } catch (error) {
        console.error('Error creating inquiry:', error);
        return NextResponse.json({ error: '문의 접수 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
