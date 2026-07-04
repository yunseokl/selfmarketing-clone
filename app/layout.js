import './globals.css';
import AuthProvider from '@/components/providers/AuthProvider';

export const metadata = {
    metadataBase: new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000'),
    title: {
        template: '%s | 혼잘마',
        default: '혼잘마 - 혼자서도 잘하는 마케팅',
    },
    description: '프리미엄 셀프 마케팅 플랫폼, 혼잘마. 쇼핑, 플레이스, SEO까지 한 번에 관리하세요.',
    keywords: ['셀프마케팅', '플레이스 상위노출', '쇼핑 순위', '키워드 분석', '순위추적', '스마트스토어 마케팅'],
    icons: {
        icon: '/favicon.svg',
    },
    openGraph: {
        type: 'website',
        locale: 'ko_KR',
        siteName: '혼잘마',
        title: '혼잘마 - 혼자서도 잘하는 마케팅',
        description: '대행사 없이 플레이스·쇼핑 상위노출부터 키워드 분석, 순위추적까지 한 곳에서.',
    },
    twitter: {
        card: 'summary',
        title: '혼잘마 - 혼자서도 잘하는 마케팅',
        description: '대행사 없이 플레이스·쇼핑 상위노출부터 키워드 분석, 순위추적까지 한 곳에서.',
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
