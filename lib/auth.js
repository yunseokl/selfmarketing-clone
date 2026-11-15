import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { normalizeEmail } from '@/lib/validations/auth';

export const authOptions = {
    adapter: PrismaAdapter(prisma),
    providers: [
        CredentialsProvider({
            name: 'credentials',
            credentials: {
                email: { label: '이메일', type: 'email' },
                password: { label: '비밀번호', type: 'password' }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    throw new Error('이메일과 비밀번호를 입력해주세요.');
                }

                // 정규화(trim+소문자) 값으로 먼저 찾고, 없으면 입력 그대로,
                // 그래도 없으면 대소문자 무시 조회 — 정규화 도입 전에 대문자로 가입한 계정도 로그인되게 합니다.
                const rawEmail = String(credentials.email);
                const normalizedEmail = normalizeEmail(rawEmail);

                let user = await prisma.user.findUnique({
                    where: { email: normalizedEmail }
                });
                if (!user && rawEmail !== normalizedEmail) {
                    user = await prisma.user.findUnique({ where: { email: rawEmail } });
                }
                if (!user) {
                    user = await prisma.user.findFirst({
                        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
                        orderBy: { createdAt: 'asc' },
                    });
                }

                if (!user || !user.password) {
                    throw new Error('이메일 또는 비밀번호가 일치하지 않습니다.');
                }

                const isPasswordValid = await bcrypt.compare(
                    credentials.password,
                    user.password
                );

                if (!isPasswordValid) {
                    throw new Error('이메일 또는 비밀번호가 일치하지 않습니다.');
                }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    image: user.image,
                };
            }
        }),
    ],
    session: {
        strategy: 'jwt',
    },
    pages: {
        signIn: '/login',
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id;
            }
            return session;
        },
    },
    secret: process.env.NEXTAUTH_SECRET,
};
