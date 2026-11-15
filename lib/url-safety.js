// SSRF 방어용 호스트 판정 — 외부 의존 없는 순수 함수 (node:net 만 사용)
// url-preview 처럼 서버가 사용자 입력 URL 을 대신 가져오는 곳에서 사용합니다.
import net from 'node:net';

export const MAX_REDIRECTS = 3;

// 허용 스킴은 http/https 뿐
export function isAllowedProtocol(protocol) {
    return protocol === 'http:' || protocol === 'https:';
}

// URL.hostname 은 IPv6 일 때 '[::1]' 처럼 대괄호가 붙고, FQDN 은 끝에 '.' 이 붙을 수 있습니다.
export function normalizeHostname(hostname) {
    let host = String(hostname || '').trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
    }
    while (host.endsWith('.')) {
        host = host.slice(0, -1);
    }
    return host;
}

export function isPrivateIPv4(ip) {
    if (!net.isIPv4(ip)) return false;
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;            // link-local / 클라우드 메타데이터
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF 예약 / TEST-NET-1
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // 벤치마크 대역
    if (a === 198 && b === 51 && c === 100) return true;  // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true;   // TEST-NET-3
    if (a >= 224) return true;                            // multicast / reserved / broadcast
    return false;
}

// IPv6 문자열 → 16비트 값 8개. 끝의 IPv4 표기(::ffff:1.2.3.4)도 처리. 실패 시 null.
export function parseIPv6(ip) {
    if (!net.isIPv6(ip)) return null;
    let text = ip;
    const zone = text.indexOf('%');
    if (zone !== -1) text = text.slice(0, zone);

    // 끝이 점 표기 IPv4 면 16진 두 그룹으로 바꿉니다.
    const lastColon = text.lastIndexOf(':');
    const tail = text.slice(lastColon + 1);
    if (tail.includes('.')) {
        if (!net.isIPv4(tail)) return null;
        const [a, b, c, d] = tail.split('.').map(Number);
        text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }

    const halves = text.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let groups;
    if (halves.length === 2) {
        const fill = 8 - head.length - rest.length;
        if (fill < 0) return null;
        groups = [...head, ...Array(fill).fill('0'), ...rest];
    } else {
        groups = head;
    }
    if (groups.length !== 8) return null;
    const values = groups.map((g) => parseInt(g, 16));
    if (values.some((v) => Number.isNaN(v) || v < 0 || v > 0xffff)) return null;
    return values;
}

function embeddedIPv4(hi, lo) {
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

export function isPrivateIPv6(ip) {
    const g = parseIPv6(ip);
    if (!g) return false;

    const allZeroUntil = (n) => g.slice(0, n).every((v) => v === 0);

    if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true; // :: 과 ::1
    // IPv4-mapped ::ffff:a.b.c.d (점 표기든 16진 표기 ::ffff:7f00:1 이든 동일하게 파싱됨)
    if (allZeroUntil(5) && g[5] === 0xffff) return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
    // IPv4-compatible ::a.b.c.d (폐기됐지만 일부 스택이 해석)
    if (allZeroUntil(6)) return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
    // NAT64 64:ff9b::/96
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) {
        return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
    }
    // 6to4 2002:AABB:CCDD::/48 — 내장 IPv4 가 사설이면 차단
    if (g[0] === 0x2002) return isPrivateIPv4(embeddedIPv4(g[1], g[2]));
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
    return false;
}

export function isPrivateAddress(ip) {
    const host = normalizeHostname(ip);
    if (net.isIPv4(host)) return isPrivateIPv4(host);
    if (net.isIPv6(host)) return isPrivateIPv6(host);
    return false;
}

// DNS 조회 없이 호스트 문자열만으로 판정 가능한 차단 (내부 호스트명 + IP 리터럴).
export function isBlockedHostLiteral(hostname) {
    const host = normalizeHostname(hostname);
    if (!host) return true;
    if (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.endsWith('.localdomain') ||
        host.endsWith('.lan')
    ) {
        return true;
    }
    if (net.isIP(host)) return isPrivateAddress(host);
    return false;
}

// DNS 해석 결과(주소 문자열 배열) 중 하나라도 사설이면 차단. 비어 있으면 차단.
export function hasPrivateAddress(addresses) {
    if (!Array.isArray(addresses) || addresses.length === 0) return true;
    return addresses.some((address) => isPrivateAddress(address));
}
