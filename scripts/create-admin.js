const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdmin() {
    try {
        const hashedPassword = await bcrypt.hash('admin1234', 12);

        const admin = await prisma.user.upsert({
            where: { email: 'admin@selfmarketing.co.kr' },
            update: {
                role: 'admin',
                password: hashedPassword
            },
            create: {
                email: 'admin@selfmarketing.co.kr',
                password: hashedPassword,
                name: '관리자',
                role: 'admin',
                balance: 0
            }
        });

        console.log('✅ 관리자 계정 생성 완료!');
        console.log('이메일:', admin.email);
        console.log('비밀번호: admin1234');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

createAdmin();
