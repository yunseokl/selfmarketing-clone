import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// GET - 특정 광고 조회
export async function GET(request, { params }) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const ad = await prisma.shoppingAd.findUnique({
            where: { id: params.id }
        });

        if (!ad) {
            return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 });
        }

        return NextResponse.json({ ad });
    } catch (error) {
        console.error('Error fetching shopping ad:', error);
        return NextResponse.json({ error: '광고 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PUT - 광고 수정
export async function PUT(request, { params }) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const body = await request.json();

        const ad = await prisma.shoppingAd.update({
            where: { id: params.id },
            data: body
        });

        return NextResponse.json({
            message: '광고가 수정되었습니다.',
            ad
        });
    } catch (error) {
        console.error('Error updating shopping ad:', error);
        return NextResponse.json({ error: '광고 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 광고 삭제 (환불 처리)
export async function DELETE(request, { params }) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        });

        const ad = await prisma.shoppingAd.findUnique({
            where: { id: params.id }
        });

        if (!ad) {
            return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 });
        }

        // Calculate refund (remaining days)
        const now = new Date();
        const endDate = new Date(ad.endDate);
        const remainingDays = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
        const refundAmount = Math.floor((ad.totalCost / ad.duration) * remainingDays);

        // Delete ad and refund user in transaction
        await prisma.$transaction([
            prisma.shoppingAd.update({
                where: { id: params.id },
                data: { status: 'refunded' }
            }),
            prisma.user.update({
                where: { id: user.id },
                data: { balance: { increment: refundAmount } }
            })
        ]);

        return NextResponse.json({
            message: `광고가 취소되었습니다. ${refundAmount.toLocaleString()}원이 환불되었습니다.`,
            refundAmount
        });
    } catch (error) {
        console.error('Error deleting shopping ad:', error);
        return NextResponse.json({ error: '광고 삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
