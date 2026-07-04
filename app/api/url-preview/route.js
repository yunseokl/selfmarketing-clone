import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import dns from 'dns/promises';
import net from 'net';

// 세션 쿠키를 읽고 외부 URL을 조회하므로 정적 고정하지 않습니다.
export const dynamic = 'force-dynamic';

// ===== SSRF 방지: 사설/내부 대역 판별 =====
function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // link-local / 클라우드 메타데이터
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                          // multicast / reserved
    return false;
}

function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true;          // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
}

function isPrivateAddress(ip) {
    if (net.isIPv4(ip)) return isPrivateIPv4(ip);
    if (net.isIPv6(ip)) return isPrivateIPv6(ip);
    return false;
}

// 호스트가 사설 IP거나 내부 호스트명, 또는 사설 IP로 해석되면 true (DNS rebinding 방어)
async function isBlockedHost(hostname) {
    const lower = hostname.toLowerCase();
    if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
        return true;
    }
    if (net.isIP(hostname)) {
        return isPrivateAddress(hostname);
    }
    try {
        const records = await dns.lookup(hostname, { all: true });
        return records.some(record => isPrivateAddress(record.address));
    } catch {
        // 해석 실패는 이후 fetch 단계에서 자연스럽게 실패(null) 처리합니다.
        return false;
    }
}

// ===== og 태그 추출 =====
function decodeEntities(text = '') {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .trim();
}

function extractMeta(html, key) {
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
        const match = html.match(re);
        if (match && match[1]) return decodeEntities(match[1]);
    }
    return null;
}

function extractTitleTag(html) {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match && match[1] ? decodeEntities(match[1]) : null;
}

// POST { url } → { title, image }
// - 미인증: 401
// - 프로토콜 위반/사설·내부 호스트: 400 (SSRF 차단)
// - 조회 실패/차단 페이지: 200 { title: null, image: null } (에러 아님, 수동 입력 흐름 유지)
export async function POST(request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    let target;
    try {
        const body = await request.json();
        target = new URL(body.url);
    } catch {
        return NextResponse.json({ error: '올바른 URL 형식이 아닙니다.' }, { status: 400 });
    }

    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return NextResponse.json({ error: 'http/https URL만 조회할 수 있습니다.' }, { status: 400 });
    }

    if (await isBlockedHost(target.hostname)) {
        return NextResponse.json({ error: '허용되지 않는 주소입니다.' }, { status: 400 });
    }

    // 스마트스토어 등은 봇 차단이 있을 수 있어, 실패를 정상 흐름(null)으로 처리합니다.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(target.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
            cache: 'no-store',
            signal: controller.signal,
        });

        if (!res.ok) {
            return NextResponse.json({ title: null, image: null });
        }

        const html = (await res.text()).slice(0, 500_000);
        const title = extractMeta(html, 'og:title') || extractTitleTag(html);
        const image = extractMeta(html, 'og:image');

        return NextResponse.json({ title: title || null, image: image || null });
    } catch {
        return NextResponse.json({ title: null, image: null });
    } finally {
        clearTimeout(timeout);
    }
}
