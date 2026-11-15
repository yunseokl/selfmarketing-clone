import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import prisma from '@/lib/prisma';
import { updateBlogCampaignSchema } from '@/lib/validations/content';
import { createNotification } from '@/lib/notify';
import { calculateBlogRefund } from '@/lib/pricing';
import { creditBalance, logCash, AlreadyProcessedError } from '@/lib/cash-ledger';

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

        // 취소된 캠페인은 환불이 끝난 상태라 되돌릴 수 없습니다(재환불 방지).
        if (existing.status === 'cancelled') {
            return NextResponse.json({ error: '이미 취소(환불)된 캠페인은 변경할 수 없습니다.' }, { status: 400 });
        }

        let campaign;
        let refundAmount = null;

        if (status === 'cancelled') {
            // 취소: 아직 발행되지 않은 건수만큼 캐시로 환불합니다. 상태 선점에 성공한 요청 하나만 진행.
            try {
                ({ campaign, refundAmount } = await prisma.$transaction(async (tx) => {
                    const claimed = await tx.blogCampaign.updateMany({
                        where: { id: params.id, status: { in: ['pending', 'in_progress'] } },
                        data: { status: 'cancelled' },
                    });
                    if (claimed.count !== 1) {
                        throw new AlreadyProcessedError('접수·진행중인 캠페인만 취소할 수 있습니다.');
                    }

                    const cancelled = await tx.blogCampaign.findUnique({ where: { id: params.id } });
                    const amount = calculateBlogRefund({
                        totalCost: cancelled.totalCost,
                        postCount: cancelled.postCount,
                        publishedCount: cancelled.publishedCount,
                    });
                    const balanceAfter = await creditBalance(tx, cancelled.userId, amount);
                    if (amount > 0) {
                        await logCash(tx, {
                            userId: cancelled.userId,
                            type: 'refund',
                            amount,
                            balanceAfter,
                            description: `블로그 배포 취소 환불 - ${cancelled.placeName} (미발행 ${cancelled.postCount - cancelled.publishedCount}건)`,
                        });
                    }
                    return { campaign: cancelled, refundAmount: amount };
                }));
            } catch (error) {
                if (error instanceof AlreadyProcessedError) {
                    return NextResponse.json({ error: error.message }, { status: 400 });
                }
                throw error;
            }
        } else {
            const data = {};
            if (status) data.status = status;

            if (addLink) {
                let links = [];
                try {
                    const parsed = existing.publishedLinks ? JSON.parse(existing.publishedLinks) : [];
                    links = Array.isArray(parsed) ? parsed : [];
                } catch {
                    links = [];
                }
                if (links.length >= existing.postCount) {
                    return NextResponse.json({ error: `신청한 ${existing.postCount}건이 모두 발행되었습니다.` }, { status: 400 });
                }
                links.push(addLink);
                data.publishedLinks = JSON.stringify(links);
                data.publishedCount = links.length;
            }

            campaign = await prisma.blogCampaign.update({
                where: { id: params.id },
                data
            });
        }

        if (status) {
            const message = getStatusMessage(status, campaign);
            if (message) {
                await createNotification(campaign.userId, {
                    type: refundAmount ? 'cash' : 'ad',
                    title: message,
                    message: refundAmount
                        ? `"${campaign.placeName}" 블로그 배포가 취소되어 ${refundAmount.toLocaleString()}원이 캐시로 환불되었습니다.`
                        : `"${campaign.placeName}" 블로그 배포 현황을 확인해보세요.`,
                    link: refundAmount ? '/dashboard/charge' : '/dashboard/blog',
                });
            }
        }

        return NextResponse.json({
            message: refundAmount != null
                ? `캠페인을 취소했습니다. ${refundAmount.toLocaleString()}원이 회원 캐시로 환불되었습니다.`
                : '캠페인이 업데이트되었습니다.',
            campaign,
            refundAmount
        });
    } catch (error) {
        console.error('Error updating blog campaign:', error);
        return NextResponse.json({ error: '캠페인 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
