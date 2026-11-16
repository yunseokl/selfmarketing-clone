// 사업자 정보 등록 요청 — 마이페이지에서 받은 값을 확인하고 1:1 문의(충전·결제) 글로 바꿉니다.
// 별도 저장소를 두지 않고 문의로 접수해, 관리자가 기존 문의 화면에서 확인·답변합니다.

export const BUSINESS_REQUEST_PREFIX = '사업자 정보 등록 요청';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECK_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

export function normalizeBusinessNumber(value) {
    return String(value ?? '').replace(/\D/g, '');
}

export function formatBusinessNumber(value) {
    const digits = normalizeBusinessNumber(value).slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

// 국세청 사업자등록번호 검증식(10자리, 마지막 자리가 검증 숫자)
export function isValidBusinessNumber(value) {
    const digits = normalizeBusinessNumber(value);
    if (digits.length !== 10) return false;
    const n = [...digits].map(Number);
    const sum = CHECK_WEIGHTS.reduce((acc, weight, index) => acc + n[index] * weight, 0) + Math.floor((n[8] * 5) / 10);
    return (10 - (sum % 10)) % 10 === n[9];
}

// 입력값 → { ok: true, title, content } 또는 { ok: false, errors: { 항목: 안내 } }
export function buildBusinessRequest(form) {
    const value = (key) => String(form?.[key] ?? '').trim();
    const company = value('company');
    const owner = value('owner');
    const email = value('email');
    const businessType = value('businessType');
    const address = value('address');
    const errors = {};

    if (company.length < 2) errors.company = '상호(법인명)를 2자 이상 입력해주세요.';
    else if (company.length > 60) errors.company = '상호(법인명)는 60자 이하로 입력해주세요.';
    if (!isValidBusinessNumber(form?.number)) errors.number = '사업자등록번호 10자리를 정확히 입력해주세요.';
    if (owner.length < 2) errors.owner = '대표자명을 입력해주세요.';
    else if (owner.length > 30) errors.owner = '대표자명은 30자 이하로 입력해주세요.';
    if (!EMAIL_PATTERN.test(email) || email.length > 100) errors.email = '세금계산서를 받을 이메일을 정확히 입력해주세요.';
    if (businessType.length > 60) errors.businessType = '업태·종목은 60자 이하로 입력해주세요.';
    if (address.length > 150) errors.address = '사업장 주소는 150자 이하로 입력해주세요.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };

    return {
        ok: true,
        title: `${BUSINESS_REQUEST_PREFIX} - ${company}`,
        content: [
            `상호(법인명): ${company}`,
            `사업자등록번호: ${formatBusinessNumber(form.number)}`,
            `대표자명: ${owner}`,
            `세금계산서 이메일: ${email}`,
            `업태·종목: ${businessType || '(입력 안 함)'}`,
            `사업장 주소: ${address || '(입력 안 함)'}`,
        ].join('\n'),
    };
}

export function isBusinessRequest(inquiry) {
    return typeof inquiry?.title === 'string' && inquiry.title.startsWith(BUSINESS_REQUEST_PREFIX);
}
