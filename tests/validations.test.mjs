// 실행: node --no-warnings --test "tests/*.test.mjs"
// 회귀 방지: 블로그 URL 의 javascript:/도메인 우회, 이메일 대소문자 중복 가입, 정수·상한 없는 입력 — 2026-11-14 감사에서 발견
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlogCampaignSchema, isAllowedPlaceUrl } from '../lib/validations/blog.js';
import { registerSchema, normalizeEmail } from '../lib/validations/auth.js';
import { createRefundRequestSchema, MAX_MONTHLY_SPEND } from '../lib/validations/refund.js';
import { updateUserSchema, MAX_BALANCE } from '../lib/validations/admin.js';

const blogBase = { placeName: '카페', keyword: '강남 카페', postCount: 5 };

test('블로그 placeUrl: 네이버 플레이스 도메인(정확/하위)만 허용', () => {
    for (const url of [
        'https://map.naver.com/p/entry/place/123',
        'https://place.naver.com/restaurant/123',
        'https://pcmap.place.naver.com/place/123/home',
        'https://m.place.naver.com/place/123',
        'https://naver.me/abc123',
        'http://naver.me/abc123',
        'https://m.map.naver.com/x',
    ]) {
        assert.equal(isAllowedPlaceUrl(url), true, url);
    }
});

test('블로그 placeUrl: javascript:, 모방 도메인, 다른 스킴은 거절', () => {
    for (const url of [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'ftp://map.naver.com/x',
        'https://map.naver.com.evil.com/x',
        'https://evilmap.naver.com.evil.io/',
        'https://notnaver.me/abc',
        'https://evil.com/?u=map.naver.com',
        'https://naver.com/',
        'not a url',
    ]) {
        assert.equal(isAllowedPlaceUrl(url), false, url);
    }
    const r = createBlogCampaignSchema.safeParse({ ...blogBase, placeUrl: 'javascript:alert(1)' });
    assert.equal(r.success, false);
});

test('블로그 스키마: 정상 입력 통과, 패키지 외 postCount 거절', () => {
    assert.equal(createBlogCampaignSchema.safeParse({ ...blogBase, placeUrl: 'https://naver.me/abc' }).success, true);
    assert.equal(createBlogCampaignSchema.safeParse({ ...blogBase, postCount: 7, placeUrl: 'https://naver.me/abc' }).success, false);
});

test('이메일은 trim+소문자로 정규화된다', () => {
    assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
    const r = registerSchema.safeParse({ email: '  User@Example.COM ', password: 'password1' });
    assert.equal(r.success, true);
    assert.equal(r.data.email, 'user@example.com');
});

test('가입 스키마: 이름 50자, 비밀번호 8~72자 제한', () => {
    const base = { email: 'a@b.co', password: 'password1' };
    assert.equal(registerSchema.safeParse({ ...base, name: 'x'.repeat(50) }).success, true);
    assert.equal(registerSchema.safeParse({ ...base, name: 'x'.repeat(51) }).success, false);
    assert.equal(registerSchema.safeParse({ ...base, password: 'short' }).success, false);
    assert.equal(registerSchema.safeParse({ ...base, password: 'p'.repeat(73) }).success, false);
});

const refundBase = { mediaType: 'naver_sa', accountId: 'acc', contact: '010-0000-0000' };

test('환급 신청: 월 광고비는 정수·DB 한계 이하', () => {
    assert.equal(createRefundRequestSchema.safeParse({ ...refundBase, monthlySpend: 150000 }).success, true);
    assert.equal(createRefundRequestSchema.safeParse({ ...refundBase, monthlySpend: 150000.5 }).success, false);
    assert.equal(createRefundRequestSchema.safeParse({ ...refundBase, monthlySpend: MAX_MONTHLY_SPEND }).success, true);
    assert.equal(createRefundRequestSchema.safeParse({ ...refundBase, monthlySpend: MAX_MONTHLY_SPEND + 1 }).success, false);
    assert.equal(createRefundRequestSchema.safeParse({ ...refundBase, monthlySpend: 99999 }).success, false);
});

test('환급 신청: 문자열 필드 길이 제한', () => {
    const ok = { ...refundBase, monthlySpend: 150000 };
    assert.equal(createRefundRequestSchema.safeParse({ ...ok, accountId: 'a'.repeat(101) }).success, false);
    assert.equal(createRefundRequestSchema.safeParse({ ...ok, contact: 'c'.repeat(101) }).success, false);
    assert.equal(createRefundRequestSchema.safeParse({ ...ok, memo: 'm'.repeat(1001) }).success, false);
});

test('관리자 잔액 수정: 정수·0 이상·20억 이하', () => {
    assert.equal(updateUserSchema.safeParse({ balance: 0 }).success, true);
    assert.equal(updateUserSchema.safeParse({ balance: MAX_BALANCE }).success, true);
    assert.equal(updateUserSchema.safeParse({ balance: MAX_BALANCE + 1 }).success, false);
    assert.equal(updateUserSchema.safeParse({ balance: -1 }).success, false);
    assert.equal(updateUserSchema.safeParse({ balance: 1.5 }).success, false);
});
