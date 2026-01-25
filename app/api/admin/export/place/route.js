import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// POST - 플레이스 광고 주문 엑셀(CSV) 다운로드
export async function POST(request) {
    try {
        const session = await getServerSession();

        if (!session?.user?.email) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const body = await request.json();
        const { orderIds } = body;

        const orders = await prisma.placeAd.findMany({
            where: {
                id: { in: orderIds }
            },
            include: {
                user: {
                    select: {
                        email: true,
                        name: true,
                        phone: true,
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // CSV 헤더 (원청 신청용 양식)
        const headers = [
            '주문번호',
            '회원이메일',
            '회원이름',
            '회원연락처',
            '플레이스명',
            '플레이스URL',
            '키워드',
            '서비스타입',
            '클릭단가',
            '일일목표',
            '광고기간(일)',
            '시작일',
            '종료일',
            '총금액',
            '상태',
            '주문일시'
        ];

        const rows = orders.map(order => [
            order.id,
            order.user?.email || '',
            order.user?.name || '',
            order.user?.phone || '',
            order.placeName,
            order.placeUrl,
            order.keyword,
            order.serviceType,
            order.pricePerClick,
            order.dailyGoal,
            order.duration,
            formatDate(order.startDate),
            formatDate(order.endDate),
            order.totalCost,
            getStatusText(order.status),
            formatDateTime(order.createdAt)
        ]);

        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        return new NextResponse(csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="place_orders_${new Date().toISOString().split('T')[0]}.csv"`
            }
        });
    } catch (error) {
        console.error('Error exporting place orders:', error);
        return NextResponse.json({ error: '엑셀 다운로드 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function formatDateTime(date) {
    return new Date(date).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStatusText(status) {
    const statusMap = {
        pending: '대기중',
        active: '진행중',
        completed: '완료',
        refunded: '환불',
        expired: '만료'
    };
    return statusMap[status] || status;
}
