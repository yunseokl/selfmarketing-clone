import './globals.css';
import AuthProvider from '@/components/providers/AuthProvider';

export const metadata = {
    title: {
        template: '%s | 혼잘마',
        default: '혼잘마 - 혼자서도 잘하는 마케팅',
    },
    description: '프리미엄 셀프 마케팅 플랫폼, 혼잘마. 쇼핑, 플레이스, SEO까지 한 번에 관리하세요.',
    icons: {
        icon: '/favicon.ico',
    },
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
