// 쇼핑/플레이스 트래픽 광고의 주문·환불 공용 로직.
// 금액은 lib/pricing.js 가격표로만 계산하고, 잔액 변경은 lib/cash-ledger.js 의
// 조건부 UPDATE를 써서 동시 요청에도 이중 차감·이중 환불이 생기지 않게 합니다.

import prisma from '@/lib/prisma';
import { calculateAdCost, calculateAdRefund } from '@/lib/pricing';
import { spendBalance, creditBalance, logCash, AlreadyProcessedError } from '@/lib/cash-ledger';

const KINDS = {
    shopping: {
        model: 'shoppingAd',
        label: '쇼핑',
        link: '/dashboard/shopping',
        nameOf: (ad) => ad.productName,
        fields: (input) => ({
            productUrl: input.productUrl,
            productName: input.productName || '상품명',
            productImage: input.productImage,
        }),
    },
    place: {
        model: 'placeAd',
        label: '플레이스',
        link: '/dashboard/place',
        nameOf: (ad) => ad.placeName,
        fields: (input) => ({
            placeUrl: input.placeUrl,
            placeName: input.placeName,
            placeImage: input.placeImage,
        }),
    },
};

// 환불(취소)이 가능한 상태 — 이미 끝났거나 환불된 광고는 다시 환불할 수 없습니다.
export const REFUNDABLE_AD_STATUSES = ['pending', 'active'];

export function adKind(kind) {
    return KINDS[kind];
}

// 광고 생성 + 잔액 차감 + 원장 기록 (한 트랜잭션)
export async function createAdOrder(kind, userId, input) {
    const cfg = KINDS[kind];
    const cost = calculateAdCost(input);
    if (!cost) {
        throw new Error('광고 금액을 계산할 수 없는 입력입니다.');
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + input.duration);

    return prisma.$transaction(async (tx) => {
        const balanceAfter = await spendBalance(tx, userId, cost.totalCost);

        const ad = await tx[cfg.model].create({
            data: {
                userId,
                ...cfg.fields(input),
                keyword: input.keyword,
                serviceType: input.serviceType,
                pricePerClick: cost.pricePerClick,
                dailyGoal: input.dailyGoal,
                duration: input.duration,
                totalCost: cost.totalCost,
                startDate,
                endDate,
                status: 'active',
            },
        });

        await logCash(tx, {
            userId,
            type: 'use',
            amount: -cost.totalCost,
            balanceAfter,
            description: `${cfg.label} 트래픽 광고 - ${cfg.nameOf(ad)} (${input.keyword})`,
        });

        return ad;
    });
}

// 광고 취소 + 남은 일수 비례 환불 + 원장 기록 (한 트랜잭션).
// 상태를 'refunded'로 바꾸는 조건부 UPDATE가 성공한 요청 하나만 환불을 진행합니다.
export async function refundAdOrder(kind, adId, { reason = '광고 취소 환불' } = {}) {
    const cfg = KINDS[kind];

    return prisma.$transaction(async (tx) => {
        const claimed = await tx[cfg.model].updateMany({
            where: { id: adId, status: { in: REFUNDABLE_AD_STATUSES } },
            data: { status: 'refunded' },
        });
        if (claimed.count !== 1) {
            throw new AlreadyProcessedError('진행 중인 광고만 취소·환불할 수 있습니다.');
        }

        const ad = await tx[cfg.model].findUnique({ where: { id: adId } });
        const refundAmount = calculateAdRefund({
            totalCost: ad.totalCost,
            duration: ad.duration,
            endDate: ad.endDate,
        });
        const balanceAfter = await creditBalance(tx, ad.userId, refundAmount);

        await logCash(tx, {
            userId: ad.userId,
            type: 'refund',
            amount: refundAmount,
            balanceAfter,
            description: `${reason} - ${cfg.nameOf(ad)} (${ad.keyword})`,
        });

        return { ad, refundAmount };
    });
}

// 관리자 주문 상태 변경. '환불'로 바꾸면 실제로 캐시를 돌려주고,
// 이미 환불된 주문은 다른 상태로 되돌릴 수 없습니다(재환불 방지).
export async function adminSetAdStatus(kind, adId, status) {
    const cfg = KINDS[kind];

    const existing = await prisma[cfg.model].findUnique({ where: { id: adId }, select: { id: true } });
    if (!existing) {
        return { notFound: true };
    }

    if (status === 'refunded') {
        const { ad, refundAmount } = await refundAdOrder(kind, adId, { reason: '관리자 환불' });
        return { order: ad, refundAmount };
    }

    const updated = await prisma[cfg.model].updateMany({
        where: { id: adId, status: { not: 'refunded' } },
        data: { status },
    });
    if (updated.count !== 1) {
        throw new AlreadyProcessedError('이미 환불된 주문은 상태를 바꿀 수 없습니다.');
    }

    const order = await prisma[cfg.model].findUnique({ where: { id: adId } });
    return { order, refundAmount: null };
}
