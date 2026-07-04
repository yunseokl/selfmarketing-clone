const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // 운영 관리자 계정은 코드에 고정하지 않고 Railway/로컬 환경변수로만 받습니다.
    if (!adminEmail || !adminPassword) {
        console.error('ADMIN_EMAIL과 ADMIN_PASSWORD 환경변수를 먼저 설정해주세요.');
        process.exitCode = 1;
        return;
    }

    if (adminPassword.length < 8) {
        console.error('ADMIN_PASSWORD는 최소 8자 이상이어야 합니다.');
        process.exitCode = 1;
        return;
    }

    try {
        const hashedPassword = await bcrypt.hash(adminPassword, 12);

        const admin = await prisma.user.upsert({
            where: { email: adminEmail },
            update: {
                role: 'admin',
                password: hashedPassword
            },
            create: {
                email: adminEmail,
                password: hashedPassword,
                name: '관리자',
                role: 'admin',
                balance: 0
            }
        });

        console.log('✅ 관리자 계정 생성 완료!');
        console.log('이메일:', admin.email);
        console.log('비밀번호는 ADMIN_PASSWORD 환경변수에 입력한 값입니다.');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

createAdmin();
