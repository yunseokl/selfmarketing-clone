import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createBlogCampaignSchema, BLOG_PACKAGE_PRICES } from '@/lib/validations/blog';
import { createNotification } from '@/lib/notify';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 내 블로그 배포 캠페인 목록 조회
export async function GET() {
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

        const campaigns = await prisma.blogCampaign.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ campaigns });
    } catch (error) {
        console.error('Error fetching blog campaigns:', error);
        return NextResponse.json({ error: '캠페인 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 새 블로그 배포 캠페인 신청
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

        const validationResult = createBlogCampaignSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { placeName, placeUrl, keyword, postCount, requirement } = validationResult.data;
        const totalCost = BLOG_PACKAGE_PRICES[postCount];

        if (user.balance < totalCost) {
            return NextResponse.json({ error: '잔액이 부족합니다.' }, { status: 400 });
        }

        const balanceAfter = user.balance - totalCost;

        const [campaign] = await prisma.$transaction([
            prisma.blogCampaign.create({
                data: {
                    userId: user.id,
                    placeName,
                    placeUrl,
                    keyword,
                    postCount,
                    requirement: requirement || null,
                    totalCost,
                    status: 'pending',
                }
            }),
            prisma.user.update({
                where: { id: user.id },
                data: { balance: { decrement: totalCost } }
            }),
            prisma.cashTransaction.create({
                data: {
                    userId: user.id,
                    type: 'use',
                    amount: -totalCost,
                    balanceAfter,
                    status: 'completed',
                    method: 'system',
                    description: `블로그 배포 ${postCount}건 - ${placeName}`,
                }
            })
        ]);

        await createNotification(user.id, {
            type: 'ad',
            title: '블로그 배포 신청 완료',
            message: `${placeName} 블로그 배포 ${postCount}건이 접수되었습니다.`,
            link: '/dashboard/blog',
        });

        return NextResponse.json({
            message: '블로그 배포가 신청되었습니다.',
            campaign
        });
    } catch (error) {
        console.error('Error creating blog campaign:', error);
        return NextResponse.json({ error: '캠페인 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
