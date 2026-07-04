import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateBlogCampaignSchema } from '@/lib/validations/content';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// 상태 변경 시 회원에게 보낼 알림 문구
function getStatusMessage(status, campaign) {
    switch (status) {
        case 'in_progress':
            return '블로그 배포가 시작되었습니다.';
        case 'completed':
            return `블로그 배포 ${campaign.postCount}건이 완료되었습니다.`;
        case 'cancelled':
            return '블로그 배포 신청이 취소되었습니다.';
        default:
            return null;
    }
}

// PATCH - 캠페인 상태 변경 및 발행 링크 추가
export async function PATCH(request, { params }) {
    try {
        const session = await getServerSession(authOptions);
        const adminCheck = await requireAdmin(session);

        if (adminCheck.error) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
        }

        const body = await request.json();

        // Zod 검증
        const validationResult = updateBlogCampaignSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { status, addLink } = validationResult.data;

        const existing = await prisma.blogCampaign.findUnique({ where: { id: params.id } });
        if (!existing) {
            return NextResponse.json({ error: '캠페인을 찾을 수 없습니다.' }, { status: 404 });
        }

        const data = {};
        if (status) data.status = status;

        if (addLink) {
            const links = existing.publishedLinks ? JSON.parse(existing.publishedLinks) : [];
            links.push(addLink);
            data.publishedLinks = JSON.stringify(links);
            data.publishedCount = links.length;
        }

        const campaign = await prisma.blogCampaign.update({
            where: { id: params.id },
            data
        });

        if (status) {
            const message = getStatusMessage(status, campaign);
            if (message) {
                await createNotification(campaign.userId, {
                    type: 'ad',
                    title: message,
                    message: `"${campaign.placeName}" 블로그 배포 현황을 확인해보세요.`,
                    link: '/dashboard/blog',
                });
            }
        }

        return NextResponse.json({
            message: '캠페인이 업데이트되었습니다.',
            campaign
        });
    } catch (error) {
        console.error('Error updating blog campaign:', error);
        return NextResponse.json({ error: '캠페인 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
