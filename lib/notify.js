import prisma from '@/lib/prisma';

// 사용자 알림 생성 헬퍼 — 알림 실패가 본 작업을 막지 않도록 예외를 삼킵니다.
export async function createNotification(userId, { type, title, message, link = null }) {
    try {
        await prisma.notification.create({
            data: { userId, type, title, message, link },
        });
    } catch (error) {
        console.error('Notification create failed:', error);
    }
}
