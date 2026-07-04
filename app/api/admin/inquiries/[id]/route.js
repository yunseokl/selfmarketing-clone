import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { answerInquirySchema } from '@/lib/validations/content';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// PATCH - 문의 답변 등록/수정
export async function PATCH(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = answerInquirySchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const inquiry = await prisma.inquiry.update({
            where: { id: params.id },
            data: {
                answer: validationResult.data.answer,
                status: 'answered',
                answeredAt: new Date(),
            }
        });

        await createNotification(inquiry.userId, {
            type: 'inquiry',
            title: '문의 답변이 등록되었습니다',
            message: `"${inquiry.title}" 문의에 대한 답변을 확인해보세요.`,
            link: '/dashboard/support',
        });

        return NextResponse.json({
            message: '답변이 등록되었습니다.',
            inquiry
        });
    } catch (error) {
        console.error('Error answering inquiry:', error);
        return NextResponse.json({ error: '답변 등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
