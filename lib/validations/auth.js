import { z } from 'zod';

// 이메일은 앞뒤 공백 제거 + 소문자로 정규화해 대소문자만 다른 중복 가입을 막습니다.
export function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
}

const emailField = z.string()
    .trim()
    .toLowerCase()
    .max(254, '이메일이 너무 깁니다.')
    .email('올바른 이메일 형식이 아닙니다.');

export const registerSchema = z.object({
    email: emailField,
    password: z.string()
        .min(8, '비밀번호는 8자 이상이어야 합니다.')
        .max(72, '비밀번호는 72자 이하여야 합니다.'), // bcrypt 는 72바이트 이후를 무시합니다.
    name: z.string().trim().max(50, '이름은 50자 이하로 입력해주세요.').optional(),
});

export const loginSchema = z.object({
    email: emailField,
    password: z.string().min(1, '비밀번호를 입력해주세요.'),
});
