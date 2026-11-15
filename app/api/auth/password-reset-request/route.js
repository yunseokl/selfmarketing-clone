import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';

// 비밀번호 재설정 요청 (로그인하지 못하는 사람이 쓰는 공개 엔드포인트)
//
// 메일 발송 기능이 없어 자동 재설정 링크를 보낼 수 없으므로, 요청을 관리자 문의함에 남깁니다.
// 관리자는 회원 관리에서 '비번 초기화'로 임시 비밀번호를 만든 뒤 **가입 이메일로만** 전달합니다.
// 가입 여부를 알아낼 수 없도록, 계정이 있든 없든 같은 응답을 돌려줍니다.
export const dynamic = 'force-dynamic';

const RESET_TITLE = '[비밀번호 재설정 요청]';
const MAX_PER_DAY = 3; // 같은 계정 기준
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 5;
const ipHits = new Map();

const schema = z.object({
    email: z.string().trim().toLowerCase().email('올바른 이메일 형식이 아닙니다.').max(254),
    contact: z.string().trim().max(50, '연락처는 50자 이하로 입력해주세요.').optional(),
});

function allowIp(ip, now = Date.now()) {
    const recent = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
    if (recent.length >= IP_MAX) return false;
    recent.push(now);
    ipHits.set(ip, recent);
    if (ipHits.size > 5000) ipHits.clear();
    return true;
}

export async function POST(request) {
    try {
        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
        }

        const validation = schema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.errors[0]?.message || '입력값을 확인해주세요.' }, { status: 400 });
        }

        const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
        if (!allowIp(ip)) {
            return NextResponse.json({ error: '요청이 너무 잦습니다. 10분 뒤에 다시 시도해주세요.' }, { status: 429 });
        }

        const { email, contact } = validation.data;
        const genericResponse = NextResponse.json({
            message: '요청이 접수되었습니다. 가입된 계정이면 관리자가 확인한 뒤 가입 이메일로 임시 비밀번호를 안내해 드립니다.',
        });

        const user = await prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: { id: true, email: true, password: true },
        });
        if (!user || !user.password) {
            return genericResponse;
        }

        const recentCount = await prisma.inquiry.count({
            where: {
                userId: user.id,
                title: RESET_TITLE,
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
        });
        if (recentCount >= MAX_PER_DAY) {
            return genericResponse;
        }

        await prisma.inquiry.create({
            data: {
                userId: user.id,
                category: 'etc',
                title: RESET_TITLE,
                content: [
                    '로그인 화면에서 비밀번호 재설정을 요청했습니다.',
                    `가입 이메일: ${user.email}`,
                    `요청자가 남긴 연락처: ${contact || '없음'}`,
                    '',
                    '처리 방법: 회원 관리에서 이 회원의 [비번 초기화]를 누르고, 임시 비밀번호는 반드시 위 가입 이메일로만 전달하세요.',
                    '(다른 사람이 요청했을 수 있으니 요청자가 남긴 연락처로는 보내지 마세요.)',
                ].join('\n'),
            },
        });

        return genericResponse;
    } catch (error) {
        console.error('Error creating password reset request:', error);
        return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
