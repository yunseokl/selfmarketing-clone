import prisma from '@/lib/prisma';

export async function requireAdmin(session) {
    if (!session?.user?.email) {
        return { error: '로그인이 필요합니다.', status: 401 };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email }
    });

    if (!user) {
        return { error: '사용자를 찾을 수 없습니다.', status: 404 };
    }

    if (user.role !== 'admin') {
        return { error: '관리자 권한이 필요합니다.', status: 403 };
    }

    return { user };
}
