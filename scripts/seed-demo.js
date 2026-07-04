const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@honjalma.com';
const DEMO_PASSWORD = 'demo1234!';

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

// 최근 days일치 일별 순위를 만듭니다. 완만하게 개선되다 후반에 가속하는 곡선이며,
// 랜덤 대신 결정론적 잔물결(sin)을 더해 재실행해도 항상 같은 값이 나오게 합니다.
function buildRankHistory(startRank, endRank, days = 21) {
    const history = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = daysAgo(i);
        const progress = (days - 1 - i) / (days - 1);
        const eased = 1 - Math.pow(1 - progress, 2);
        const base = startRank - (startRank - endRank) * eased;
        const wobble = Math.round(Math.sin(i * 1.7) * 1.5);
        const rank = Math.max(1, Math.round(base + wobble));
        history.push({ date: date.toISOString().slice(0, 10), rank });
    }
    history[history.length - 1].rank = endRank;
    return history;
}

async function seedDemo() {
    const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12);

    const user = await prisma.user.upsert({
        where: { email: DEMO_EMAIL },
        update: {
            name: '김철수',
            phone: '010-1234-5678',
            balance: 350000,
            password: hashedPassword,
        },
        create: {
            email: DEMO_EMAIL,
            password: hashedPassword,
            name: '김철수',
            phone: '010-1234-5678',
            balance: 350000,
        },
    });

    // 데모 데이터는 자연 unique 키가 없는 테이블이 많아, 여러 번 실행해도 중복이
    // 쌓이지 않도록 이 데모 유저 소유 데이터를 먼저 비우고 다시 채웁니다.
    await Promise.all([
        prisma.shoppingAd.deleteMany({ where: { userId: user.id } }),
        prisma.placeAd.deleteMany({ where: { userId: user.id } }),
        prisma.rankTracking.deleteMany({ where: { userId: user.id } }),
        prisma.cashTransaction.deleteMany({ where: { userId: user.id } }),
        prisma.inquiry.deleteMany({ where: { userId: user.id } }),
        prisma.blogCampaign.deleteMany({ where: { userId: user.id } }),
        prisma.refundRequest.deleteMany({ where: { userId: user.id } }),
        prisma.notification.deleteMany({ where: { userId: user.id } }),
    ]);

    // ShoppingAd 3건 (active 2 + expired 1)
    const shoppingAdData = [
        {
            productName: '스텐 진공 보온보냉 텀블러 500ml',
            productUrl: 'https://smartstore.naver.com/demo/products/1001',
            keyword: '스테인리스 텀블러',
            serviceType: 'selma30',
            pricePerClick: 30,
            dailyGoal: 50,
            duration: 30,
            startDate: daysAgo(5),
            status: 'active',
            currentRank: 14,
        },
        {
            productName: '경량 알루미늄 캠핑 의자 접이식',
            productUrl: 'https://smartstore.naver.com/demo/products/1002',
            keyword: '캠핑 의자',
            serviceType: 'selma30',
            pricePerClick: 35,
            dailyGoal: 40,
            duration: 30,
            startDate: daysAgo(12),
            status: 'active',
            currentRank: 9,
        },
        {
            productName: '무선 진공 청소기 차량용 미니',
            productUrl: 'https://smartstore.naver.com/demo/products/1003',
            keyword: '무선 청소기',
            serviceType: 'selma30',
            pricePerClick: 30,
            dailyGoal: 60,
            duration: 30,
            startDate: daysAgo(40),
            status: 'expired',
            currentRank: 6,
        },
    ];

    for (const ad of shoppingAdData) {
        const endDate = addDays(ad.startDate, ad.duration);
        await prisma.shoppingAd.create({
            data: {
                userId: user.id,
                productUrl: ad.productUrl,
                productName: ad.productName,
                keyword: ad.keyword,
                serviceType: ad.serviceType,
                pricePerClick: ad.pricePerClick,
                dailyGoal: ad.dailyGoal,
                duration: ad.duration,
                totalCost: ad.pricePerClick * ad.dailyGoal * ad.duration,
                startDate: ad.startDate,
                endDate,
                status: ad.status,
                currentRank: ad.currentRank,
            },
        });
    }

    // PlaceAd 2건 (둘 다 active)
    const placeAdData = [
        {
            placeName: '강남 파스타 맛집',
            placeUrl: 'https://map.naver.com/p/entry/place/2001',
            keyword: '강남역 파스타',
            serviceType: 'selma30',
            pricePerClick: 30,
            dailyGoal: 30,
            duration: 30,
            startDate: daysAgo(3),
            currentRank: 4,
        },
        {
            placeName: '홍대 네일샵',
            placeUrl: 'https://map.naver.com/p/entry/place/2002',
            keyword: '홍대 네일아트',
            serviceType: 'selma30',
            pricePerClick: 30,
            dailyGoal: 25,
            duration: 30,
            startDate: daysAgo(8),
            currentRank: 11,
        },
    ];

    for (const ad of placeAdData) {
        const endDate = addDays(ad.startDate, ad.duration);
        await prisma.placeAd.create({
            data: {
                userId: user.id,
                placeUrl: ad.placeUrl,
                placeName: ad.placeName,
                keyword: ad.keyword,
                serviceType: ad.serviceType,
                pricePerClick: ad.pricePerClick,
                dailyGoal: ad.dailyGoal,
                duration: ad.duration,
                totalCost: ad.pricePerClick * ad.dailyGoal * ad.duration,
                startDate: ad.startDate,
                endDate,
                status: 'active',
                currentRank: ad.currentRank,
            },
        });
    }

    // RankTracking 4건 (shopping 2, place 2) - 완만히 개선되는 21일 순위 곡선
    const rankTrackingData = [
        {
            type: 'shopping',
            url: 'https://smartstore.naver.com/demo/products/3001',
            name: '스텐 진공 보온보냉 텀블러',
            keyword: '스텐 텀블러',
            startRank: 34,
            endRank: 12,
        },
        {
            type: 'shopping',
            url: 'https://smartstore.naver.com/demo/products/3002',
            name: '차이슨 무선청소기 프로',
            keyword: '무선 청소기',
            startRank: 45,
            endRank: 19,
        },
        {
            type: 'place',
            url: 'https://map.naver.com/p/entry/place/3001',
            name: '강남 파스타 맛집',
            keyword: '강남 파스타',
            startRank: 31,
            endRank: 8,
        },
        {
            type: 'place',
            url: 'https://map.naver.com/p/entry/place/3002',
            name: '홍대 감성 네일샵',
            keyword: '홍대 네일샵',
            startRank: 38,
            endRank: 16,
        },
    ];

    for (const rt of rankTrackingData) {
        const history = buildRankHistory(rt.startRank, rt.endRank, 21);
        await prisma.rankTracking.create({
            data: {
                userId: user.id,
                type: rt.type,
                url: rt.url,
                name: rt.name,
                keyword: rt.keyword,
                currentRank: history[history.length - 1].rank,
                previousRank: history[history.length - 2].rank,
                rankHistory: JSON.stringify(history),
            },
        });
    }

    // CashTransaction 5건: 가입 보너스 → 충전 → 광고 사용 2건 → 충전 대기중 (시간순, balanceAfter 정합)
    await prisma.cashTransaction.createMany({
        data: [
            {
                userId: user.id,
                type: 'reward',
                amount: 10000,
                balanceAfter: 10000,
                status: 'completed',
                method: 'system',
                description: '신규가입 축하 캐시',
                createdAt: daysAgo(20),
            },
            {
                userId: user.id,
                type: 'charge',
                amount: 367500,
                balanceAfter: 377500,
                status: 'completed',
                method: 'bank',
                depositorName: '김철수',
                description: '캐시 충전 350,000원 + 보너스 17,500원(5%)',
                createdAt: daysAgo(15),
            },
            {
                userId: user.id,
                type: 'use',
                amount: -15000,
                balanceAfter: 362500,
                status: 'completed',
                method: 'system',
                description: '쇼핑 트래픽 광고 - 스테인리스 텀블러 500ml (스테인리스 텀블러)',
                createdAt: daysAgo(12),
            },
            {
                userId: user.id,
                type: 'use',
                amount: -12500,
                balanceAfter: 350000,
                status: 'completed',
                method: 'system',
                description: '플레이스 트래픽 광고 - 강남 파스타 맛집 (강남 파스타)',
                createdAt: daysAgo(5),
            },
            {
                userId: user.id,
                type: 'charge',
                amount: 50000,
                balanceAfter: null,
                status: 'pending',
                method: 'bank',
                depositorName: '김철수',
                description: '캐시 충전 신청',
                createdAt: daysAgo(0),
            },
        ],
    });

    // Inquiry 2건: 답변 완료 1건 + 쿠팡 견적 문의(open) 1건
    await prisma.inquiry.createMany({
        data: [
            {
                userId: user.id,
                category: 'ad',
                title: '쇼핑 광고 순위가 언제부터 반영되나요?',
                content: '어제 쇼핑 트래픽 광고를 시작했는데 아직 순위 변동이 없어서요. 보통 며칠 정도 걸리나요?',
                status: 'answered',
                answer: '광고 시작 후 통상 2~3일 내로 순위 반영이 시작되며, 유입량과 키워드 경쟁도에 따라 최대 1주일 정도 소요될 수 있습니다. 현재 정상적으로 유입이 발생하고 있으니 조금만 더 기다려 주세요.',
                answeredAt: daysAgo(2),
                createdAt: daysAgo(4),
            },
            {
                userId: user.id,
                category: 'coupang',
                title: '쿠팡 광고 대행 견적 문의드립니다',
                content: '쿠팡에서 주방용품을 판매 중인데, 로켓그로스 상품 광고 대행 견적을 받아보고 싶습니다. 월 예산은 200만원 정도로 생각하고 있습니다.',
                status: 'open',
                createdAt: daysAgo(1),
            },
        ],
    });

    // BlogCampaign 1건: 강남 파스타 맛집 블로그 배포 진행중
    await prisma.blogCampaign.create({
        data: {
            userId: user.id,
            placeName: '강남 파스타 맛집',
            placeUrl: 'https://map.naver.com/p/entry/place/2001',
            keyword: '강남역 파스타',
            postCount: 10,
            requirement: '맛집 후기 형태로 자연스럽게 작성 부탁드립니다. 파스타와 와인 페어링 포인트도 살짝 언급해주세요.',
            totalCost: 500000,
            status: 'in_progress',
            publishedCount: 4,
            publishedLinks: JSON.stringify([
                'https://blog.naver.com/demo/2230000001',
                'https://blog.naver.com/demo/2230000002',
                'https://blog.naver.com/demo/2230000003',
                'https://blog.naver.com/demo/2230000004',
            ]),
            createdAt: daysAgo(15),
        },
    });

    // RefundRequest 1건: 네이버 검색광고 환급 검토중
    await prisma.refundRequest.create({
        data: {
            userId: user.id,
            mediaType: 'naver_sa',
            accountId: 'honjalma_ad@naver.com',
            monthlySpend: 2000000,
            contact: '010-1234-5678',
            memo: '최근 3개월 평균 집행액 기준으로 산정 부탁드립니다.',
            status: 'reviewing',
            expectedRefund: 200000,
            createdAt: daysAgo(6),
        },
    });

    // Notification 5건: rank/cash/ad/inquiry/notice 유형, 2건 isRead
    await prisma.notification.createMany({
        data: [
            {
                userId: user.id,
                type: 'rank',
                title: '순위 상승 알림',
                message: '"캠핑 의자" 키워드 순위가 15위 → 9위로 상승했습니다.',
                link: '/dashboard/ranking/shopping',
                isRead: true,
                createdAt: daysAgo(3),
            },
            {
                userId: user.id,
                type: 'cash',
                title: '캐시 충전 완료',
                message: '367,500원이 충전되어 잔액에 반영되었습니다.',
                link: '/dashboard/profile',
                isRead: true,
                createdAt: daysAgo(15),
            },
            {
                userId: user.id,
                type: 'ad',
                title: '쇼핑 광고 시작',
                message: '"스테인리스 텀블러" 쇼핑 광고가 시작되었습니다.',
                link: '/dashboard/shopping',
                isRead: false,
                createdAt: daysAgo(5),
            },
            {
                userId: user.id,
                type: 'inquiry',
                title: '문의 답변 완료',
                message: '"쇼핑 광고 순위가 언제부터 반영되나요?" 문의에 답변이 등록되었습니다.',
                link: '/dashboard/support',
                isRead: false,
                createdAt: daysAgo(2),
            },
            {
                userId: user.id,
                type: 'notice',
                title: '서비스 업데이트 안내',
                message: '키워드 분석 도구가 새롭게 오픈되었습니다. 지금 바로 사용해보세요.',
                link: '/dashboard/keyword',
                isRead: false,
                createdAt: daysAgo(1),
            },
        ],
    });

    return user;
}

async function printSummary(userId) {
    const [
        shoppingAds,
        placeAds,
        rankTrackings,
        cashTransactions,
        inquiries,
        blogCampaigns,
        refundRequests,
        notifications,
    ] = await Promise.all([
        prisma.shoppingAd.count({ where: { userId } }),
        prisma.placeAd.count({ where: { userId } }),
        prisma.rankTracking.count({ where: { userId } }),
        prisma.cashTransaction.count({ where: { userId } }),
        prisma.inquiry.count({ where: { userId } }),
        prisma.blogCampaign.count({ where: { userId } }),
        prisma.refundRequest.count({ where: { userId } }),
        prisma.notification.count({ where: { userId } }),
    ]);

    console.log('--- 데모 데이터 카운트 ---');
    console.log('ShoppingAd:', shoppingAds);
    console.log('PlaceAd:', placeAds);
    console.log('RankTracking:', rankTrackings);
    console.log('CashTransaction:', cashTransactions);
    console.log('Inquiry:', inquiries);
    console.log('BlogCampaign:', blogCampaigns);
    console.log('RefundRequest:', refundRequests);
    console.log('Notification:', notifications);
}

async function main() {
    try {
        const user = await seedDemo();
        await printSummary(user.id);

        console.log('✅ 데모 데이터 시드 완료!');
        console.log('이메일:', DEMO_EMAIL);
        console.log('비밀번호:', DEMO_PASSWORD);
    } catch (error) {
        console.error('Error:', error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main();
