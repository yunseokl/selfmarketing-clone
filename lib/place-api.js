// 플레이스 분석 API 들이 함께 쓰는 서버 쪽 도우미 (로그인 확인, 저장 매장 변환).

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { parseMetrics, metricChange } from '@/lib/place-history';

export async function getCurrentUser() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return { error: '로그인이 필요합니다.', status: 401 };
    }
    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });
    if (!user) {
        return { error: '사용자를 찾을 수 없습니다.', status: 404 };
    }
    return { user };
}

export async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

// 저장 매장 DB 행 → 화면용
export function savedPlaceToClient(row) {
    const points = parseMetrics(row.metrics);
    const latest = points[points.length - 1] || null;
    return {
        placeId: row.placeId,
        name: row.name,
        category: row.category,
        latest,
        change: metricChange(points),
        checkedDays: points.length,
    };
}
