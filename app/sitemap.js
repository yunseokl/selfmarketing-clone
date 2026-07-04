const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// 공개 페이지만 노출 — 대시보드/관리자/API는 robots에서 차단
export default function sitemap() {
    const now = new Date();
    return [
        { url: `${BASE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
        { url: `${BASE_URL}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
        { url: `${BASE_URL}/dashboard/notice`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
        { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
        { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    ];
}
