import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { registerSchema } from '@/lib/validations/auth';
import { createNotification } from '@/lib/notify';

const SIGNUP_BONUS = 10000; // 신규가입 축하 캐시

export async function POST(request) {
    try {
        const body = await request.json();

        // Zod 검증
        const validationResult = registerSchema.safeParse(body);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: errors }, { status: 400 });
        }

        const { email, password, name } = validationResult.data;

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return NextResponse.json(
                { error: '이미 등록된 이메일입니다.' },
                { status: 400 }
            );
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create user and log the signup bonus as a cash transaction atomically
        const user = await prisma.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name: name || email.split('@')[0],
                    balance: SIGNUP_BONUS,
                }
            });

            await tx.cashTransaction.create({
                data: {
                    userId: createdUser.id,
                    type: 'reward',
                    amount: SIGNUP_BONUS,
                    balanceAfter: createdUser.balance,
                    status: 'completed',
                    method: 'system',
                    description: '신규가입 축하 캐시',
                }
            });

            return createdUser;
        });

        await createNotification(user.id, {
            type: 'cash',
            title: '가입 축하 캐시 10,000원이 지급되었습니다',
            message: '첫 캠페인에 바로 사용할 수 있어요.',
            link: '/dashboard/charge',
        });

        return NextResponse.json({
            message: '회원가입이 완료되었습니다.',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json(
            { error: '회원가입 중 오류가 발생했습니다.' },
            { status: 500 }
        );
    }
}
