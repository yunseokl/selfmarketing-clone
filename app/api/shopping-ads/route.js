import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// GET - 사용자의 쇼핑 광고 목록 조회
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
        const status = searchParams.get('status');

        const where = { userId: user.id };
        if (status && status !== 'all') {
            where.status = status;
        }

        const ads = await prisma.shoppingAd.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ ads });
    } catch (error) {
        console.error('Error fetching shopping ads:', error);
        return NextResponse.json({ error: '광고 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 새 쇼핑 광고 생성
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
        const { productUrl, productName, productImage, keyword, serviceType, pricePerClick, dailyGoal, duration } = body;

        // Validate required fields
        if (!productUrl || !keyword || !dailyGoal || !duration) {
            return NextResponse.json({ error: '필수 항목을 모두 입력해주세요.' }, { status: 400 });
        }

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

        // Create ad and update user balance in transaction
        const [ad] = await prisma.$transaction([
            prisma.shoppingAd.create({
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
            }),
            prisma.user.update({
                where: { id: user.id },
                data: { balance: { decrement: totalCost } }
            })
        ]);

        return NextResponse.json({
            message: '광고가 생성되었습니다.',
            ad
        });
    } catch (error) {
        console.error('Error creating shopping ad:', error);
        return NextResponse.json({ error: '광고 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
