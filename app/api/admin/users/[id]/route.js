import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// PUT - 회원 정보 수정 (잔액 등)
export async function PUT(request, { params }) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const body = await request.json();
        const { balance, role } = body;

        const updateData = {};
        if (balance !== undefined) updateData.balance = balance;
        if (role !== undefined) updateData.role = role;

        const user = await prisma.user.update({
            where: { id: params.id },
            data: updateData,
            select: {
                id: true,
                email: true,
                name: true,
                balance: true,
                role: true,
            }
        });

        return NextResponse.json({
            message: '회원 정보가 수정되었습니다.',
            user
        });
    } catch (error) {
        console.error('Error updating user:', error);
        return NextResponse.json({ error: '회원 정보 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
