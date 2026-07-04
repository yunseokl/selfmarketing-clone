const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export default function robots() {
    return {
        rules: [
            {
                userAgent: '*',
                allow: ['/', '/login', '/terms', '/privacy', '/dashboard/notice'],
                disallow: ['/dashboard/', '/admin/', '/api/'],
            },
        ],
        sitemap: `${BASE_URL}/sitemap.xml`,
    };
}
