// 캐시 잔액 변경 공용 함수 — 모두 prisma 트랜잭션(tx) 안에서 호출합니다.
// "잔액 확인"과 "차감"을 한 문장(조건부 UPDATE)으로 처리해, 동시에 들어온 요청이
// 같은 잔액을 두 번 쓰거나 같은 건을 두 번 환불/승인하지 못하게 합니다.

export class InsufficientBalanceError extends Error {
    constructor() {
        super('잔액이 부족합니다.');
        this.name = 'InsufficientBalanceError';
    }
}

export class AlreadyProcessedError extends Error {
    constructor(message = '이미 처리된 건입니다.') {
        super(message);
        this.name = 'AlreadyProcessedError';
    }
}

// 잔액이 충분할 때만 차감하고 차감 후 잔액을 돌려줍니다.
export async function spendBalance(tx, userId, amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('차감 금액이 올바르지 않습니다.');
    }
    const result = await tx.user.updateMany({
        where: { id: userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
    });
    if (result.count !== 1) {
        throw new InsufficientBalanceError();
    }
    const user = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
    return user.balance;
}

// 잔액을 늘리고 증가 후 잔액을 돌려줍니다. (0원이면 조회만)
export async function creditBalance(tx, userId, amount) {
    if (!Number.isInteger(amount) || amount < 0) {
        throw new Error('적립 금액이 올바르지 않습니다.');
    }
    const user = amount > 0
        ? await tx.user.update({
            where: { id: userId },
            data: { balance: { increment: amount } },
            select: { balance: true },
        })
        : await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
    return user.balance;
}

// 원장 기록 한 줄 추가
export function logCash(tx, { userId, type, amount, balanceAfter, method = 'system', description }) {
    return tx.cashTransaction.create({
        data: { userId, type, amount, balanceAfter, status: 'completed', method, description },
    });
}
