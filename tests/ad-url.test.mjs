// 광고 주문 주소 판별·보정과 미리보기 제목 정리 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PLACE_AD_HOSTS, SHOPPING_AD_HOSTS, normalizeAdUrl, isAllowedAdUrl, placeIdFromUrl, cleanPreviewTitle,
} from '../lib/ad-url.js';
import { createPlaceAdSchema } from '../lib/validations/place.js';
import { createShoppingAdSchema } from '../lib/validations/shopping.js';

test('붙여넣은 글에서 주소만 골라내고, https:// 가 없으면 붙인다', () => {
    assert.equal(normalizeAdUrl(''), '');
    assert.equal(normalizeAdUrl('   '), '');
    assert.equal(normalizeAdUrl(' https://naver.me/abc12 '), 'https://naver.me/abc12');
    assert.equal(normalizeAdUrl('[네이버 지도] 다온식당 https://naver.me/abc12'), 'https://naver.me/abc12');
    assert.equal(normalizeAdUrl('place.naver.com/restaurant/123456/home'), 'https://place.naver.com/restaurant/123456/home');
    // 주소가 없는 문장은 그대로 두어 검증에서 걸리게 한다
    assert.equal(normalizeAdUrl('강남 맛집'), '강남 맛집');
});

test('플레이스 광고 주소: 지도·플레이스·naver.me 단축 주소만 허용', () => {
    for (const url of [
        'https://map.naver.com/p/entry/place/123456',
        'https://m.place.naver.com/restaurant/123456/home',
        'https://pcmap.place.naver.com/place/123456',
        'https://naver.me/abc12',
    ]) {
        assert.equal(isAllowedAdUrl(url, PLACE_AD_HOSTS), true, url);
    }
    for (const url of [
        'https://smartstore.naver.com/a/products/1',
        'https://evil.com/?u=place.naver.com',
        'https://place.naver.com.evil.com/x',
        'javascript:alert(1)',
        'ftp://place.naver.com/x',
        '강남 맛집',
        '',
    ]) {
        assert.equal(isAllowedAdUrl(url, PLACE_AD_HOSTS), false, url);
    }
});

test('쇼핑 광고 주소: 스마트스토어·쇼핑·브랜드스토어만 허용', () => {
    assert.equal(isAllowedAdUrl('https://smartstore.naver.com/shop/products/123', SHOPPING_AD_HOSTS), true);
    assert.equal(isAllowedAdUrl('https://m.smartstore.naver.com/shop/products/123', SHOPPING_AD_HOSTS), true);
    assert.equal(isAllowedAdUrl('https://search.shopping.naver.com/catalog/1', SHOPPING_AD_HOSTS), true);
    assert.equal(isAllowedAdUrl('https://brand.naver.com/shop/products/123', SHOPPING_AD_HOSTS), true);
    assert.equal(isAllowedAdUrl('https://www.naver.com/', SHOPPING_AD_HOSTS), false);
    assert.equal(isAllowedAdUrl('https://naver.me/abc12', SHOPPING_AD_HOSTS), false);
});

test('주문 검증 스키마가 같은 규칙을 쓴다', () => {
    const place = { placeName: '다온식당', keyword: '강남 맛집', dailyGoal: 100, duration: 10 };
    assert.equal(createPlaceAdSchema.safeParse({ ...place, placeUrl: 'https://naver.me/abc12' }).success, true);
    assert.equal(createPlaceAdSchema.safeParse({ ...place, placeUrl: 'https://map.naver.com/p/entry/place/123456' }).success, true);
    assert.equal(createPlaceAdSchema.safeParse({ ...place, placeUrl: 'https://smartstore.naver.com/a/products/1' }).success, false);

    const shopping = { keyword: '텀블러', dailyGoal: 100, duration: 10 };
    assert.equal(createShoppingAdSchema.safeParse({ ...shopping, productUrl: 'https://smartstore.naver.com/a/products/1' }).success, true);
    assert.equal(createShoppingAdSchema.safeParse({ ...shopping, productUrl: 'https://www.naver.com/' }).success, false);
});

test('지도·플레이스 주소에서 매장 번호를 꺼낸다', () => {
    assert.equal(placeIdFromUrl('https://map.naver.com/p/entry/place/13491802?c=15.00,0,0,0,dh'), '13491802');
    assert.equal(placeIdFromUrl('https://map.naver.com/v5/search/강남맛집/place/13491802'), '13491802');
    assert.equal(placeIdFromUrl('https://m.place.naver.com/restaurant/13491802/home'), '13491802');
    assert.equal(placeIdFromUrl('https://pcmap.place.naver.com/hairshop/13491802'), '13491802');
    assert.equal(placeIdFromUrl('https://naver.me/abc12'), null);
    assert.equal(placeIdFromUrl('https://map.naver.com/p/search/강남맛집'), null);
    assert.equal(placeIdFromUrl('https://evil.com/place/13491802'), null);
    assert.equal(placeIdFromUrl('not a url'), null);
});

test('미리보기 제목: 꼬리표와 제어 문자를 떼고, 공통 제목은 버린다', () => {
    assert.equal(cleanPreviewTitle('첨성대 : 네이버\u001c'), '첨성대');
    assert.equal(cleanPreviewTitle('다온식당 : 네이버 지도'), '다온식당');
    assert.equal(cleanPreviewTitle('스테인리스 텀블러 500ml : 혼잘마스토어'), '스테인리스 텀블러 500ml : 혼잘마스토어');
    assert.equal(cleanPreviewTitle('  줄바꿈\n있는   이름 '), '줄바꿈 있는 이름');
    assert.equal(cleanPreviewTitle('네이버 지도'), null);
    assert.equal(cleanPreviewTitle('NAVER'), null);
    assert.equal(cleanPreviewTitle(''), null);
    assert.equal(cleanPreviewTitle(null), null);
});
