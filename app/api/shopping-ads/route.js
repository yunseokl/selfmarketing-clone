import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createShoppingAdSchema } from '@/lib/validations/shopping';
import { simulateAdRank } from '@/lib/naver';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 사용자의 쇼핑 광고 목록 조회
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

        // 종료일이 지난 진행중 광고는 조회 시점에 만료 처리합니다 (lazy expiration)
        await prisma.shoppingAd.updateMany({
            where: { userId: user.id, status: 'active', endDate: { lt: new Date() } },
            data: { status: 'expired' }
        });

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        const where = { userId: user.id };
        if (status && status !== 'all') {
            where.status = status;
        }

        const ads = await prisma.shoppingAd.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        // 진행중인 광고는 경과일 기반으로 실시간 순위를 계산해 덮어씁니다 (DB 저장 없음)
        const adsWithRank = ads.map((ad) =>
            ad.status === 'active'
                ? { ...ad, currentRank: simulateAdRank(ad.id, ad.startDate, ad.duration) }
                : ad
        );

        return NextResponse.json({ ads: adsWithRank });
    } catch (error) {
        console.error('Error fetching shopping ads:', error);
        return NextResponse.json({ error: '광고 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 새 쇼핑 광고 생성
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
        const validationResult = createShoppingAdSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { productUrl, productName, productImage, keyword, serviceType, pricePerClick, dailyGoal, duration } = validationResult.data;

        // Calculate total cost
        const totalCost = pricePerClick * dailyGoal * duration;

        // Check user balance
        if (user.balance < totalCost) {
            return NextResponse.json({ error: '잔액이 부족합니다.' }, { status: 400 });
        }

        // Calculate dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + duration);

        // Create ad, decrement balance, and log the cash transaction atomically
        const ad = await prisma.$transaction(async (tx) => {
            const createdAd = await tx.shoppingAd.create({
                data: {
                    userId: user.id,
                    productUrl,
                    productName: productName || '상품명',
                    productImage,
                    keyword,
                    serviceType: serviceType || 'selma30',
                    pricePerClick: pricePerClick || 30,
                    dailyGoal,
                    duration,
                    totalCost,
                    startDate,
                    endDate,
                    status: 'active',
                }
            });

            const updatedUser = await tx.user.update({
                where: { id: user.id },
                data: { balance: { decrement: totalCost } }
            });

            await tx.cashTransaction.create({
                data: {
                    userId: user.id,
                    type: 'use',
                    amount: -totalCost,
                    balanceAfter: updatedUser.balance,
                    status: 'completed',
                    method: 'system',
                    description: `쇼핑 트래픽 광고 - ${createdAd.productName} (${keyword})`,
                }
            });

            return createdAd;
        });

        return NextResponse.json({
            message: '광고가 생성되었습니다.',
            ad
        });
    } catch (error) {
        console.error('Error creating shopping ad:', error);
        return NextResponse.json({ error: '광고 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
