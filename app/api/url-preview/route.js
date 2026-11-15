import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import dns from 'dns/promises';
import {
    MAX_REDIRECTS,
    isAllowedProtocol,
    isBlockedHostLiteral,
    hasPrivateAddress,
    normalizeHostname,
} from '@/lib/url-safety';
import net from 'net';

// 세션 쿠키를 읽고 외부 URL을 조회하므로 정적 고정하지 않습니다.
export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_CHARS = 500_000;

// 호스트가 사설 IP거나 내부 호스트명, 또는 사설 IP로 해석되면 true.
// 해석에 실패한 호스트는 어차피 fetch 에서 실패하므로 차단 대상이 아니라 "조회 불가"로 취급합니다.
async function isBlockedHost(hostname) {
    if (isBlockedHostLiteral(hostname)) return true;
    const host = normalizeHostname(hostname);
    if (net.isIP(host)) return false; // 공인 IP 리터럴
    try {
        const records = await dns.lookup(host, { all: true });
        return hasPrivateAddress(records.map((record) => record.address));
    } catch {
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

// 리다이렉트를 직접 따라가며 매 단계마다 스킴과 호스트를 다시 검사합니다.
// 반환: { blocked: true } | { response } | { response: null } (조회 실패)
async function fetchWithSafeRedirects(startUrl, signal) {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!isAllowedProtocol(current.protocol)) return { blocked: true };
        if (await isBlockedHost(current.hostname)) return { blocked: true };

        const res = await fetch(current.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
            cache: 'no-store',
            redirect: 'manual',
            signal,
        });

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            // 본문은 읽지 않으므로 연결을 정리합니다.
            try { await res.body?.cancel(); } catch { /* 무시 */ }
            if (!location) return { response: null };
            let next;
            try {
                next = new URL(location, current);
            } catch {
                return { response: null };
            }
            current = next;
            continue;
        }

        return { response: res };
    }
    // 리다이렉트 횟수 초과 — 조회 실패로 취급
    return { response: null };
}

// POST { url } → { title, image }
// - 미인증: 401
// - 프로토콜 위반/사설·내부 호스트(리다이렉트 경유 포함): 400 (SSRF 차단)
// - 조회 실패/차단 페이지/시간 초과: 200 { title: null, image: null } (에러 아님, 수동 입력 흐름 유지)
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

    if (!isAllowedProtocol(target.protocol)) {
        return NextResponse.json({ error: 'http/https URL만 조회할 수 있습니다.' }, { status: 400 });
    }

    if (await isBlockedHost(target.hostname)) {
        return NextResponse.json({ error: '허용되지 않는 주소입니다.' }, { status: 400 });
    }

    // 스마트스토어 등은 봇 차단이 있을 수 있어, 실패를 정상 흐름(null)으로 처리합니다.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const result = await fetchWithSafeRedirects(target, controller.signal);

        if (result.blocked) {
            return NextResponse.json({ error: '허용되지 않는 주소입니다.' }, { status: 400 });
        }

        const res = result.response;
        if (!res || !res.ok) {
            return NextResponse.json({ title: null, image: null });
        }

        const html = (await res.text()).slice(0, MAX_BODY_CHARS);
        const title = extractMeta(html, 'og:title') || extractTitleTag(html);
        const image = extractMeta(html, 'og:image');

        return NextResponse.json({ title: title || null, image: image || null });
    } catch {
        return NextResponse.json({ title: null, image: null });
    } finally {
        clearTimeout(timeout);
    }
}
