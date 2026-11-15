// 마진·손익분기 ROAS 계산 엔진 검증 — 기대값은 손으로 계산한 값입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calcSmartstore,
    calcCoupang,
    solvePriceForMargin,
    rocketLogisticsDefault,
    COUPANG_CATEGORIES,
    SMARTSTORE_GRADES,
} from '../lib/margin.js';

const near = (actual, expected, tolerance = 0.01) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);

test('스마트스토어: 수수료·정산액·순이익', () => {
    const r = calcSmartstore({
        salePrice: 30000, shippingCharged: 3000, grade: 'general', storeType: 'smartstore', inflow: 'basic',
        cost: 12000, shippingCost: 3000, otherCost: 500,
    });
    assert.equal(r.revenue, 33000);
    assert.equal(r.fees.find((f) => f.key === 'npay').amount, 1198); // 33,000 × 3.63%
    assert.equal(r.fees.find((f) => f.key === 'sales').amount, 901); // 30,000 × 3.003%
    assert.equal(r.settlement, 30901);
    assert.equal(r.costTotal, 15500);
    assert.equal(r.profit, 15401);
    near(r.marginRate, 51.34);
    near(r.bepRoas, 194.79);
    assert.equal(r.maxAdPerOrder, 15401);
    assert.equal(r.marketingLinkSaving, 601); // 901 − 300
});

test('스마트스토어: 마케팅 링크 유입이면 판매수수료가 1% 수준으로 줄어든다', () => {
    const base = { salePrice: 30000, grade: 'small', cost: 10000 };
    const basic = calcSmartstore({ ...base, inflow: 'basic' });
    const marketing = calcSmartstore({ ...base, inflow: 'marketing' });
    assert.equal(marketing.fees.find((f) => f.key === 'sales').amount, 300);
    assert.equal(marketing.profit - basic.profit, 601);
    assert.equal(basic.fees.find((f) => f.key === 'npay').amount, 584); // 30,000 × 1.947%
});

test('스마트스토어: 일반과세자 부가세 근사와 쿠폰', () => {
    const r = calcSmartstore({
        salePrice: 30000, shippingCharged: 3000, grade: 'general', cost: 12000, shippingCost: 3000, otherCost: 500,
        vatMode: 'general',
    });
    assert.equal(r.vat, 1400); // 15,401 ÷ 11
    assert.equal(r.profit, 14001);
    near(r.bepRoas, 194.79); // 부가세는 비례라 손익분기 ROAS는 같다

    const withCoupon = calcSmartstore({ salePrice: 30000, sellerCoupon: 5000, grade: 'general', cost: 12000 });
    assert.equal(withCoupon.productPay, 25000);
    assert.equal(withCoupon.fees.find((f) => f.key === 'sales').amount, 751); // 25,000 × 3.003%
});

test('쿠팡 판매자배송: 판매·배송비 수수료와 서비스이용료 분담', () => {
    const input = {
        mode: 'marketplace', salePrice: 20000, sellerCoupon: 1000, shippingCharged: 3000, categoryId: 'beauty',
        cost: 8000, shippingCost: 3000, monthlyOrders: 100,
    };
    const r = calcCoupang(input);
    assert.equal(r.productPay, 19000);
    assert.equal(r.fees.find((f) => f.key === 'sales').amount, 2006); // 19,000 × 10.56%
    assert.equal(r.fees.find((f) => f.key === 'shippingFee').amount, 99); // 3,000 × 3.3%
    assert.equal(r.fees.find((f) => f.key === 'serviceFee').amount, 550); // 55,000 ÷ 100
    assert.equal(r.settlement, 19345);
    assert.equal(r.profit, 8345);
    near(r.bepRoas, 250.45); // 광고비 부가세 별도 표기 → 8,345 ÷ 1.1 까지 쓸 수 있음

    const vat = calcCoupang({ ...input, vatMode: 'general' });
    assert.equal(vat.vat, 759);
    assert.equal(vat.profit, 7586);
    assert.equal(vat.maxAdPerOrder, 7586);
});

test('쿠팡: 월 매출이 기준 미만이면 서비스이용료가 없다 (가전은 500만원 기준)', () => {
    const low = calcCoupang({ mode: 'marketplace', salePrice: 9000, categoryId: 'beauty', monthlyOrders: 100 });
    assert.equal(low.serviceFeeApplies, false);
    const digital = calcCoupang({ mode: 'marketplace', salePrice: 30000, categoryId: 'digital', monthlyOrders: 100 });
    assert.equal(digital.serviceFeeApplies, false); // 300만원 < 500만원
    const digitalHigh = calcCoupang({ mode: 'marketplace', salePrice: 60000, categoryId: 'digital', monthlyOrders: 100 });
    assert.equal(digitalHigh.serviceFeeApplies, true);
});

test('쿠팡 로켓그로스: 입출고·배송비 시작가와 순이익', () => {
    assert.equal(rocketLogisticsDefault('s', 'A'), 2200);
    assert.equal(rocketLogisticsDefault('s', 'B'), 1900);
    const r = calcCoupang({ mode: 'rocket', salePrice: 15000, categoryId: 'living', sizeId: 's', cost: 5000, shippingCharged: 3000 });
    assert.equal(r.revenue, 15000); // 로켓그로스는 고객 배송비를 받지 않는다
    assert.equal(r.fees.find((f) => f.key === 'sales').amount, 1287); // 15,000 × 8.58%
    assert.equal(r.costs.find((c) => c.key === 'logistics').amount, 2420); // 2,200 × 1.1
    assert.equal(r.profit, 6293);
    near(r.marginRate, 41.95);

    const custom = calcCoupang({ mode: 'rocket', salePrice: 15000, categoryId: 'living', logisticsFee: 3000, cost: 5000 });
    assert.equal(custom.costs.find((c) => c.key === 'logistics').amount, 3300);
});

test('현재 ROAS를 넣으면 광고 후 순이익이 나온다', () => {
    const r = calcCoupang({
        mode: 'marketplace', salePrice: 20000, sellerCoupon: 1000, shippingCharged: 3000, categoryId: 'beauty',
        cost: 8000, shippingCost: 3000, monthlyOrders: 100, roas: 500,
    });
    assert.equal(r.ad.spendPerOrder, 3800); // 19,000 ÷ 5
    assert.equal(r.ad.cashPerOrder, 4180); // 부가세 포함
    assert.equal(r.ad.profitAfterAd, 4165); // 8,345 − 4,180
    const losing = calcCoupang({ mode: 'marketplace', salePrice: 20000, categoryId: 'beauty', cost: 15000, roas: 300 });
    assert.ok(losing.ad.profitAfterAd < 0);
});

test('목표 마진을 남기려면 필요한 ROAS', () => {
    const r = calcSmartstore({ salePrice: 30000, grade: 'general', cost: 12000, targetMarginRate: 20 });
    // 수수료 1,089 + 901 → 순이익 16,010. 목표 마진 6,000을 남기면 10,010 까지 광고에 쓸 수 있다
    assert.equal(r.profit, 16010);
    near(r.targetRoas, (30000 / 10010) * 100);
    const impossible = calcSmartstore({ salePrice: 30000, grade: 'general', cost: 12000, targetMarginRate: 90 });
    assert.equal(impossible.targetRoas, null);
});

test('적자 상품은 손익분기 ROAS가 없다', () => {
    const r = calcSmartstore({ salePrice: 10000, cost: 12000, grade: 'general' });
    assert.ok(r.profit < 0);
    assert.equal(r.bepRoas, null);
    assert.equal(r.maxAdPerOrder, 0);
});

test('목표 마진 판매가 역산', () => {
    const input = { mode: 'rocket', categoryId: 'living', sizeId: 's', cost: 5000 };
    const price = solvePriceForMargin(calcCoupang, input, 20);
    assert.equal(price, 10390); // p(1 − 0.0858 − 0.2) ≥ 7,420
    assert.ok(calcCoupang({ ...input, salePrice: price }).marginRate >= 20);
    assert.ok(calcCoupang({ ...input, salePrice: price - 10 }).marginRate < 20);

    const breakEven = solvePriceForMargin(calcCoupang, input, 0);
    assert.ok(calcCoupang({ ...input, salePrice: breakEven }).profit >= 0);
    assert.ok(calcCoupang({ ...input, salePrice: breakEven - 10 }).profit < 0);

    assert.equal(solvePriceForMargin(calcCoupang, input, 95), null); // 수수료 때문에 불가능한 목표
});

test('이상한 입력에도 NaN이 나오지 않는다', () => {
    for (const r of [
        calcSmartstore({}),
        calcSmartstore({ salePrice: 'abc', cost: null, returnRate: 999, sellerCoupon: 1e12 }),
        calcCoupang({ salePrice: -5, monthlyOrders: -1, feeRate: '' }),
        calcCoupang({ mode: 'rocket', salePrice: '12,000', cost: '4,000' }),
    ]) {
        for (const value of [r.profit, r.marginRate, r.settlement, r.feeTotal, r.costTotal, r.vat]) {
            assert.ok(Number.isFinite(value), JSON.stringify(r));
        }
    }
    assert.equal(calcCoupang({ mode: 'rocket', salePrice: '12,000', cost: '4,000' }).productPay, 12000);
});

test('요율표 형식 점검', () => {
    assert.equal(new Set(COUPANG_CATEGORIES.map((c) => c.id)).size, COUPANG_CATEGORIES.length);
    for (const c of COUPANG_CATEGORIES) assert.ok(c.rate >= 4 && c.rate <= 10.9, c.id);
    assert.equal(SMARTSTORE_GRADES.length, 5);
});
