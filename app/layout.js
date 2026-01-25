import './globals.css';
import AuthProvider from '@/components/providers/AuthProvider';

export const metadata = {
    title: '셀프마케팅 | 대행사 없이 누구나 쉽게 마케팅을 시작하세요',
    description: '플레이스, 쇼핑, 블로그 마케팅을 직접 관리하고 순위를 추적하세요.',
};

export default function RootLayout({ children }) {
    return (
        <html lang="ko">
            <body>
                <AuthProvider>
                    {children}
                </AuthProvider>
            </body>
        </html>
    );
}
