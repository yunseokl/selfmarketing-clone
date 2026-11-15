import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createPlaceAdSchema } from '@/lib/validations/place';
import { createAdOrder } from '@/lib/ad-orders';
import { InsufficientBalanceError } from '@/lib/cash-ledger';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// GET - 사용자의 플레이스 광고 목록 조회
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
        await prisma.placeAd.updateMany({
            where: { userId: user.id, status: 'active', endDate: { lt: new Date() } },
            data: { status: 'expired' }
        });

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        const where = { userId: user.id };
        // 화면 탭 묶음: 진행중 = 대기중+진행중, 만료됨 = 기간 만료+관리자 완료 처리
        const STATUS_GROUPS = {
            active: ['pending', 'active'],
            expired: ['expired', 'completed'],
            refunded: ['refunded'],
        };
        if (status && status !== 'all') {
            where.status = { in: STATUS_GROUPS[status] || [status] };
        }

        const ads = await prisma.placeAd.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        // 광고 순위는 측정할 공식 경로가 없어 내려보내지 않습니다.
        // (예전에는 경과일에 따라 순위가 오르는 것처럼 계산한 값을 보여 줬는데, 실제 순위가 아니어서 제거)
        const adsWithRank = ads.map((ad) => ({ ...ad, currentRank: null }));

        return NextResponse.json({ ads: adsWithRank });
    } catch (error) {
        console.error('Error fetching place ads:', error);
        return NextResponse.json({ error: '광고 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// POST - 새 플레이스 광고 생성
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
        const validationResult = createPlaceAdSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        // 금액은 서버 가격표로만 계산하고, 잔액 확인·차감·광고 생성을 한 트랜잭션으로 처리합니다.
        let ad;
        try {
            ad = await createAdOrder('place', user.id, validationResult.data);
        } catch (error) {
            if (error instanceof InsufficientBalanceError) {
                return NextResponse.json({ error: '잔액이 부족합니다.' }, { status: 400 });
            }
            throw error;
        }

        return NextResponse.json({
            message: '광고가 생성되었습니다.',
            ad
        });
    } catch (error) {
        console.error('Error creating place ad:', error);
        return NextResponse.json({ error: '광고 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
