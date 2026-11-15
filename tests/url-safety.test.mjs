// 실행: node --no-warnings --test "tests/*.test.mjs"
// 회귀 방지: url-preview SSRF 우회 (IPv6 대괄호 호스트, 16진 IPv4-mapped 주소, 리다이렉트 경유) — 2026-11-14 감사에서 발견
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_REDIRECTS,
    isAllowedProtocol,
    normalizeHostname,
    isPrivateIPv4,
    isPrivateIPv6,
    parseIPv6,
    isPrivateAddress,
    isBlockedHostLiteral,
    hasPrivateAddress,
} from '../lib/url-safety.js';

test('http/https 외 스킴은 거절한다', () => {
    assert.equal(isAllowedProtocol('http:'), true);
    assert.equal(isAllowedProtocol('https:'), true);
    for (const p of ['file:', 'ftp:', 'gopher:', 'javascript:', 'data:', '']) {
        assert.equal(isAllowedProtocol(p), false, p);
    }
});

test('URL.hostname 의 IPv6 대괄호를 벗긴다', () => {
    assert.equal(new URL('http://[::1]:3000/').hostname, '[::1]'); // 우회의 원인이 된 실제 동작
    assert.equal(normalizeHostname('[::1]'), '::1');
    assert.equal(normalizeHostname('Example.COM.'), 'example.com');
});

test('사설·예약 IPv4 를 차단한다', () => {
    for (const ip of [
        '0.0.0.0', '10.1.2.3', '127.0.0.1', '127.255.255.254', '169.254.169.254',
        '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '100.127.255.255',
        '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    ]) {
        assert.equal(isPrivateIPv4(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '223.255.255.255']) {
        assert.equal(isPrivateIPv4(ip), false, ip);
    }
});

test('IPv6 파서가 압축 표기와 점 표기를 풀어낸다', () => {
    assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(parseIPv6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(parseIPv6('::ffff:7f00:1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    assert.deepEqual(parseIPv6('::ffff:127.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    assert.deepEqual(parseIPv6('2001:db8::8a2e:370:7334'), [0x2001, 0xdb8, 0, 0, 0, 0x8a2e, 0x370, 0x7334]);
    assert.equal(parseIPv6('not-an-ip'), null);
    assert.equal(parseIPv6('1.2.3.4'), null);
});

test('사설·내부 IPv6 를 차단한다 (16진 IPv4-mapped 포함)', () => {
    for (const ip of [
        '::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
        '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:c0a8:1', '::ffff:a9fe:a9fe',
        '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1',
    ]) {
        assert.equal(isPrivateIPv6(ip), true, ip);
    }
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:808:808', '2002:808:808::1']) {
        assert.equal(isPrivateIPv6(ip), false, ip);
    }
});

test('isPrivateAddress 는 대괄호가 붙은 입력도 처리한다', () => {
    assert.equal(isPrivateAddress('[::1]'), true);
    assert.equal(isPrivateAddress('[::ffff:7f00:1]'), true);
    assert.equal(isPrivateAddress('8.8.8.8'), false);
    assert.equal(isPrivateAddress('example.com'), false);
});

test('호스트 리터럴 판정: 내부 호스트명·IP 리터럴을 차단, 일반 도메인은 통과', () => {
    for (const host of [
        'localhost', 'LOCALHOST', 'foo.localhost', 'printer.local', 'db.internal', 'x.lan', 'localhost.',
        '127.0.0.1', '[::1]', '[::ffff:7f00:1]', '[fe80::1]', '169.254.169.254', '0.0.0.0', '',
    ]) {
        assert.equal(isBlockedHostLiteral(host), true, JSON.stringify(host));
    }
    for (const host of ['smartstore.naver.com', 'example.com', '8.8.8.8', '[2606:4700:4700::1111]']) {
        assert.equal(isBlockedHostLiteral(host), false, host);
    }
});

test('URL 파서가 정규화한 우회 표기(십진·16진·8진 IPv4)도 차단된다', () => {
    for (const raw of ['http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/']) {
        assert.equal(isBlockedHostLiteral(new URL(raw).hostname), true, raw);
    }
});

test('DNS 해석 결과 중 하나라도 사설이면 차단, 빈 결과도 차단', () => {
    assert.equal(hasPrivateAddress(['93.184.216.34']), false);
    assert.equal(hasPrivateAddress(['93.184.216.34', '127.0.0.1']), true);
    assert.equal(hasPrivateAddress(['2606:4700:4700::1111', '::1']), true);
    assert.equal(hasPrivateAddress([]), true);
    assert.equal(hasPrivateAddress(undefined), true);
});

test('리다이렉트 허용 횟수는 3회', () => {
    assert.equal(MAX_REDIRECTS, 3);
});
