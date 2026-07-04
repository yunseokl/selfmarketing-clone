import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// 로그인 세션/쿠키를 읽는 API라 빌드 때 정적으로 고정하지 않습니다.
export const dynamic = 'force-dynamic';

async function getCurrentUser() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return { error: '로그인이 필요합니다.', status: 401 };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email }
    });

    if (!user) {
        return { error: '사용자를 찾을 수 없습니다.', status: 404 };
    }

    return { user };
}

// GET - 최신 알림 20개 + 안읽음 개수
export async function GET() {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const [notifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where: { userId: userCheck.user.id },
                orderBy: { createdAt: 'desc' },
                take: 20,
            }),
            prisma.notification.count({
                where: { userId: userCheck.user.id, isRead: false },
            }),
        ]);

        return NextResponse.json({ notifications, unreadCount });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return NextResponse.json({ error: '알림 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// PATCH - 단건 읽음 처리 { id } 또는 전체 읽음 처리 { all: true }
export async function PATCH(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const body = await request.json();

        if (body?.all) {
            await prisma.notification.updateMany({
                where: { userId: userCheck.user.id, isRead: false },
                data: { isRead: true },
            });
            return NextResponse.json({ message: '모든 알림을 읽음 처리했습니다.' });
        }

        if (!body?.id) {
            return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
        }

        const notification = await prisma.notification.findFirst({
            where: { id: body.id, userId: userCheck.user.id },
        });

        if (!notification) {
            return NextResponse.json({ error: '알림을 찾을 수 없습니다.' }, { status: 404 });
        }

        await prisma.notification.update({
            where: { id: notification.id },
            data: { isRead: true },
        });

        return NextResponse.json({ message: '알림을 읽음 처리했습니다.' });
    } catch (error) {
        console.error('Error updating notification:', error);
        return NextResponse.json({ error: '알림 처리 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
