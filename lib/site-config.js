// 운영 설정값 — 코드에 고정하지 않고 환경변수로 바꿀 수 있게 모아 둡니다.

// 무통장입금 계좌. DEPOSIT_BANK / DEPOSIT_ACCOUNT / DEPOSIT_HOLDER 를 모두 설정해야 적용됩니다.
// 설정하지 않으면 예전부터 화면에 적혀 있던 값을 그대로 보여 주되, 관리자 화면에 확인 경고를 띄웁니다.
const LEGACY_DEPOSIT = { bank: '국민은행', account: '123456-04-567890', holder: '(주)혼잘마' };

export function getDepositAccount(env = process.env) {
    const bank = (env.DEPOSIT_BANK || '').trim();
    const account = (env.DEPOSIT_ACCOUNT || '').trim();
    const holder = (env.DEPOSIT_HOLDER || '').trim();
    if (bank && account && holder) {
        return { bank, account, holder, configured: true };
    }
    return { ...LEGACY_DEPOSIT, configured: false };
}
