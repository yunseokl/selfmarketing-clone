// 판매 채널별 실마진·손익분기 ROAS 계산 엔진 (순수 함수 — 화면과 테스트가 함께 씁니다)
//
// 원칙
// - 모든 금액은 "실제로 오가는 돈(부가세 포함)" 기준으로 계산합니다.
// - 요율은 공개 자료의 "부가세 별도" 값을 그대로 두고, 계산할 때 ×1.1 합니다.
// - 요율은 자주 바뀌므로 화면에서 사용자가 직접 고칠 수 있게 하고, 기준일을 함께 보여 줍니다.
//
// 요율 출처 (2026-11-14 확인)
// - 스마트스토어 Npay 주문관리 수수료: 2025-10-01 결제분부터 (스마트스토어센터 도움말, 2차 자료 교차 확인)
// - 스마트스토어 판매수수료: 2025-06-02 개편 (네이버 쇼핑 유입 2.73% / 판매자 마케팅 링크·광고 유입 0.91%, VAT 별도)
// - 쿠팡 판매수수료: 쿠팡 공개 요율표 (2019-11-25 기준, https://cloud.mkt.coupang.com/Fee-Table)
// - 쿠팡 로켓그로스 입출고·배송비: 쿠팡 마켓플레이스 안내 페이지의 "시작가" (카테고리·판매가에 따라 더 높을 수 있음)

export const VAT_MULTIPLIER = 1.1;

export const FEE_BASIS = {
    smartstore: 'Npay 주문관리 수수료 2025-10-01 적용분, 판매수수료 2025-06-02 개편분',
    coupang: '쿠팡 공개 판매수수료표(2019-11-25 기준), 로켓그로스 요금은 쿠팡 안내 페이지의 시작가',
};

// ===== 스마트스토어 =====

// 국세청 매출 등급별 Npay 주문관리 수수료율(%, VAT 별도). 상품금액+배송비에 부과됩니다.
export const SMARTSTORE_GRADES = [
    { id: 'small', label: '영세 (연매출 3억 이하)', npayRate: 1.77 },
    { id: 'mid1', label: '중소1 (3억~5억)', npayRate: 2.33 },
    { id: 'mid2', label: '중소2 (5억~10억)', npayRate: 2.48 },
    { id: 'mid3', label: '중소3 (10억~30억)', npayRate: 2.73 },
    { id: 'general', label: '일반 (30억 초과 · 신규 사업자 · 개인)', npayRate: 3.3 },
];

// 판매수수료율(%, VAT 별도). 상품금액에만 부과됩니다.
export const SMARTSTORE_SALES_FEES = {
    smartstore: { label: '스마트스토어', basic: 2.73, marketing: 0.91 },
    brandstore: { label: '브랜드스토어', basic: 3.64, marketing: 1.82 },
};

// ===== 쿠팡 =====

// 판매수수료율(%, VAT 별도). 대분류 기본값과 요율이 다른 예외 소분류.
export const COUPANG_CATEGORIES = [
    { id: 'fashion', group: '패션', label: '패션의류·잡화', rate: 10.5 },
    { id: 'fashion-gold', group: '패션', label: '순금·골드바·돌반지', rate: 4.0 },
    { id: 'beauty', group: '뷰티', label: '뷰티 전체', rate: 9.6 },
    { id: 'food', group: '식품', label: '식품 기본', rate: 10.6 },
    { id: 'food-noodle', group: '식품', label: '면·라면', rate: 10.9 },
    { id: 'food-baby-health', group: '식품', label: '유아건강식품 · 감자·고구마', rate: 7.6 },
    { id: 'food-rice', group: '식품', label: '쌀·잡곡류', rate: 5.8 },
    { id: 'living', group: '생활용품', label: '생활용품 기본', rate: 7.8 },
    { id: 'living-tools', group: '생활용품', label: '공구·철물·조명·수납·안전·청소·욕실용품', rate: 10.8 },
    { id: 'living-pest', group: '생활용품', label: '모기퇴치·살충·환자보조용품', rate: 10.0 },
    { id: 'kitchen', group: '주방용품', label: '주방용품 기본', rate: 10.8 },
    { id: 'kitchen-noodle-maker', group: '주방용품', label: '제면기', rate: 7.8 },
    { id: 'furniture', group: '가구/홈인테리어', label: '가구/홈인테리어 전체', rate: 10.8 },
    { id: 'baby', group: '출산/유아', label: '출산/유아 기본', rate: 10.0 },
    { id: 'baby-cream', group: '출산/유아', label: '기저귀크림·파우더', rate: 9.8 },
    { id: 'baby-wipes', group: '출산/유아', label: '영유아 물티슈', rate: 8.2 },
    { id: 'baby-food', group: '출산/유아', label: '영유아식품', rate: 7.8 },
    { id: 'baby-diaper', group: '출산/유아', label: '분유·기저귀류', rate: 6.4 },
    { id: 'sports', group: '스포츠/레저', label: '스포츠/레저 기본', rate: 10.8 },
    { id: 'sports-wear', group: '스포츠/레저', label: '스포츠의류·신발', rate: 10.5 },
    { id: 'sports-golf-bike', group: '스포츠/레저', label: '골프클럽·거리측정기·자전거', rate: 7.6 },
    { id: 'pet', group: '반려/애완용품', label: '반려/애완용품 전체', rate: 10.8 },
    { id: 'toy', group: '완구/취미', label: '완구/취미 기본', rate: 10.8 },
    { id: 'toy-drone', group: '완구/취미', label: 'RC드론·쿼드콥터', rate: 7.8 },
    { id: 'car', group: '자동차용품', label: '자동차용품 기본', rate: 10.0 },
    { id: 'car-tire', group: '자동차용품', label: '타이어용품·휠', rate: 9.6 },
    { id: 'car-electronics', group: '자동차용품', label: '차량용 전자기기·방향제·세정제', rate: 7.8 },
    { id: 'car-moto', group: '자동차용품', label: '오토바이용품', rate: 7.6 },
    { id: 'car-navi', group: '자동차용품', label: '내비게이션·블랙박스·하이패스', rate: 6.8 },
    { id: 'office', group: '도서/문구', label: '문구/사무용품 기본 · 도서 · 음반', rate: 10.8 },
    { id: 'office-optical', group: '도서/문구', label: '광학용품', rate: 8.8 },
    { id: 'office-photo-paper', group: '도서/문구', label: '포토전용지', rate: 7.8 },
    { id: 'digital', group: '가전디지털', label: '가전디지털 기본', rate: 7.8 },
    { id: 'digital-game', group: '가전디지털', label: '게임', rate: 6.8 },
    { id: 'digital-input', group: '가전디지털', label: '마우스·키보드·유무선공유기', rate: 6.5 },
    { id: 'digital-accessory', group: '가전디지털', label: '태블릿·노트북 액세서리 · 컴퓨터 주변기기 기타', rate: 6.4 },
    { id: 'digital-camera-etc', group: '가전디지털', label: '기타 카메라·캠코더', rate: 6.0 },
    { id: 'digital-large', group: '가전디지털', label: '에어컨·냉장고·세탁기·TV·빔프로젝터·프린터·디지털카메라', rate: 5.8 },
    { id: 'digital-computer', group: '가전디지털', label: '컴퓨터·태블릿PC', rate: 5.0 },
    { id: 'digital-monitor', group: '가전디지털', label: '모니터', rate: 4.5 },
];

// 판매자서비스이용료: 배송비를 뺀 월 매출이 기준 이상이면 월 1회 부과(VAT 포함 금액)
export const COUPANG_SERVICE_FEE = { amount: 55000, threshold: 1000000, digitalThreshold: 5000000 };

// 판매자배송 배송비 수수료(%, VAT 별도) — 고객이 낸 배송비에 부과
export const COUPANG_SHIPPING_FEE_RATE = 3.0;

// 로켓그로스 크기 구분과 개당 요금(원, VAT 별도, 안내 페이지 시작가)
// shippingA = 프로모션 종료 후 요금으로 안내된 값, shippingB = 프로모션 요금으로 안내된 값
export const ROCKET_SIZES = [
    { id: 'xs', label: '극소형 (세 변 합 80cm · 2kg 이하)', handling: 600, shippingA: 1350, shippingB: 1125 },
    { id: 's', label: '소형 (100cm · 5kg 이하)', handling: 650, shippingA: 1550, shippingB: 1250 },
    { id: 'm', label: '중형 (120cm · 10kg 이하)', handling: 1250, shippingA: 2100, shippingB: 1500 },
    { id: 'l1', label: '대형1 (140cm · 15kg 이하)', handling: 1375, shippingA: 2200, shippingB: 1700 },
    { id: 'l2', label: '대형2 (160cm · 20kg 이하)', handling: 1375, shippingA: 4100, shippingB: 2900 },
    { id: 'xl', label: '특대형 (250cm · 30kg 이하)', handling: 1375, shippingA: 5600, shippingB: 3500 },
];

// ===== 공통 계산 =====

function num(value, fallback = 0) {
    const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function nonNegative(value) {
    return Math.max(0, num(value));
}

function percentOf(amount, ratePercent) {
    return Math.round((amount * ratePercent) / 100);
}

// 수수료·비용 목록을 받아 정산액·순이익·손익분기 ROAS까지 조립합니다.
// vatMode 'general': 일반과세자 납부 부가세를 (매출 − 매입·비용) ÷ 11 로 근사해 뺍니다.
// adVatExcluded: 광고 관리 화면이 광고비를 부가세 별도로 보여 주는지(쿠팡 광고센터 true)
function assemble({ productPay, revenue, fees, costs, vatMode, adVatExcluded, roas, targetMarginRate }) {
    const feeTotal = fees.reduce((sum, f) => sum + f.amount, 0);
    const costTotal = costs.reduce((sum, c) => sum + c.amount, 0);
    const settlement = revenue - feeTotal;

    const beforeVat = revenue - feeTotal - costTotal;
    const vat = vatMode === 'general' ? Math.max(0, Math.round(beforeVat / 11)) : 0;
    const profit = beforeVat - vat;
    const marginRate = productPay > 0 ? (profit / productPay) * 100 : 0;

    // 화면에 보이는 광고비 1원이 실제 순이익을 얼마나 줄이는지
    // (부가세 별도 표기면 ×1.1, 일반과세자는 광고비 부가세를 공제받으므로 ×10/11)
    const adCashFactor = adVatExcluded ? VAT_MULTIPLIER : 1;
    const adProfitFactor = adCashFactor * (vatMode === 'general' ? 10 / 11 : 1);

    const maxAdPerOrder = profit > 0 ? profit / adProfitFactor : 0;
    const bepRoas = profit > 0 && productPay > 0 ? (productPay / maxAdPerOrder) * 100 : null;

    let targetRoas = null;
    const target = num(targetMarginRate, NaN);
    if (Number.isFinite(target) && productPay > 0) {
        const room = profit - (productPay * target) / 100;
        targetRoas = room > 0 ? (productPay / (room / adProfitFactor)) * 100 : null;
    }

    let ad = null;
    const roasValue = num(roas, 0);
    if (roasValue > 0 && productPay > 0) {
        const spendPerOrder = productPay / (roasValue / 100);
        const profitAfterAd = profit - spendPerOrder * adProfitFactor;
        ad = {
            roas: roasValue,
            spendPerOrder: Math.round(spendPerOrder),
            cashPerOrder: Math.round(spendPerOrder * adCashFactor),
            profitAfterAd: Math.round(profitAfterAd),
            marginAfterAd: (profitAfterAd / productPay) * 100,
        };
    }

    return {
        productPay,
        revenue,
        fees,
        feeTotal,
        settlement,
        costs,
        costTotal,
        vat,
        profit,
        marginRate,
        bepRoas,
        maxAdPerOrder: Math.floor(maxAdPerOrder),
        targetRoas,
        ad,
    };
}

function commonCosts(input) {
    const returnRate = Math.min(100, nonNegative(input.returnRate));
    const returnCost = nonNegative(input.returnCost);
    return [
        { key: 'cost', label: '상품 원가', amount: Math.round(nonNegative(input.cost)) },
        { key: 'other', label: '포장·기타 비용', amount: Math.round(nonNegative(input.otherCost)) },
        {
            key: 'return',
            label: `반품 예상 비용 (반품률 ${returnRate}%)`,
            amount: Math.round((returnCost * returnRate) / 100),
        },
    ];
}

// ===== 스마트스토어 =====

export function calcSmartstore(input = {}) {
    const salePrice = nonNegative(input.salePrice);
    const coupon = Math.min(salePrice, nonNegative(input.sellerCoupon));
    const productPay = salePrice - coupon;
    const shippingCharged = nonNegative(input.shippingCharged);
    const revenue = productPay + shippingCharged;

    const grade = SMARTSTORE_GRADES.find((g) => g.id === input.grade) || SMARTSTORE_GRADES[4];
    const store = SMARTSTORE_SALES_FEES[input.storeType] || SMARTSTORE_SALES_FEES.smartstore;
    const inflow = input.inflow === 'marketing' ? 'marketing' : 'basic';

    const npayRate = input.npayRate != null && input.npayRate !== '' ? nonNegative(input.npayRate) : grade.npayRate;
    const salesRate = input.salesRate != null && input.salesRate !== '' ? nonNegative(input.salesRate) : store[inflow];

    const fees = [
        {
            key: 'npay',
            label: `Npay 주문관리 수수료 (${npayRate}% + VAT)`,
            amount: percentOf(revenue, npayRate * VAT_MULTIPLIER),
        },
        {
            key: 'sales',
            label: `판매수수료 (${salesRate}% + VAT · ${inflow === 'marketing' ? '마케팅 링크·광고 유입' : '네이버 쇼핑 유입'})`,
            amount: percentOf(productPay, salesRate * VAT_MULTIPLIER),
        },
    ];

    const costs = [
        ...commonCosts(input),
        { key: 'shipping', label: '실제 택배비', amount: Math.round(nonNegative(input.shippingCost)) },
    ];

    const result = assemble({
        productPay,
        revenue,
        fees,
        costs,
        vatMode: input.vatMode,
        adVatExcluded: Boolean(input.adVatExcluded),
        roas: input.roas,
        targetMarginRate: input.targetMarginRate,
    });

    // 같은 주문이 마케팅 링크(또는 광고)로 들어왔다면 아끼는 판매수수료
    const basicFee = percentOf(productPay, store.basic * VAT_MULTIPLIER);
    const marketingFee = percentOf(productPay, store.marketing * VAT_MULTIPLIER);

    return { ...result, channel: 'smartstore', marketingLinkSaving: basicFee - marketingFee };
}

// ===== 쿠팡 =====

export function rocketLogisticsDefault(sizeId, table = 'A') {
    const size = ROCKET_SIZES.find((s) => s.id === sizeId) || ROCKET_SIZES[0];
    return size.handling + (table === 'B' ? size.shippingB : size.shippingA);
}

export function calcCoupang(input = {}) {
    const mode = input.mode === 'rocket' ? 'rocket' : 'marketplace';
    const salePrice = nonNegative(input.salePrice);
    const coupon = Math.min(salePrice, nonNegative(input.sellerCoupon));
    const productPay = salePrice - coupon;
    // 로켓그로스는 고객에게 배송비를 따로 받지 않습니다.
    const shippingCharged = mode === 'marketplace' ? nonNegative(input.shippingCharged) : 0;
    const revenue = productPay + shippingCharged;

    const category = COUPANG_CATEGORIES.find((c) => c.id === input.categoryId) || COUPANG_CATEGORIES[0];
    const feeRate = input.feeRate != null && input.feeRate !== '' ? nonNegative(input.feeRate) : category.rate;

    const fees = [
        {
            key: 'sales',
            label: `판매수수료 (${feeRate}% + VAT)`,
            amount: percentOf(productPay, feeRate * VAT_MULTIPLIER),
        },
    ];

    if (mode === 'marketplace' && shippingCharged > 0) {
        fees.push({
            key: 'shippingFee',
            label: `배송비 수수료 (${COUPANG_SHIPPING_FEE_RATE}% + VAT)`,
            amount: percentOf(shippingCharged, COUPANG_SHIPPING_FEE_RATE * VAT_MULTIPLIER),
        });
    }

    // 판매자서비스이용료를 월 판매 건수로 나눠 1건당 부담으로 환산
    const monthlyOrders = Math.floor(nonNegative(input.monthlyOrders));
    const threshold = category.group === '가전디지털'
        ? COUPANG_SERVICE_FEE.digitalThreshold
        : COUPANG_SERVICE_FEE.threshold;
    const monthlySales = productPay * monthlyOrders;
    const serviceFeeApplies = monthlyOrders > 0 && monthlySales >= threshold;
    if (serviceFeeApplies) {
        fees.push({
            key: 'serviceFee',
            label: `판매자서비스이용료 분담 (월 55,000원 ÷ ${monthlyOrders.toLocaleString('ko-KR')}건)`,
            amount: Math.round(COUPANG_SERVICE_FEE.amount / monthlyOrders),
        });
    }

    const costs = commonCosts(input);
    if (mode === 'rocket') {
        const logistics = input.logisticsFee != null && input.logisticsFee !== ''
            ? nonNegative(input.logisticsFee)
            : rocketLogisticsDefault(input.sizeId, input.shippingTable);
        costs.push({
            key: 'logistics',
            label: '로켓그로스 입출고·배송비 (VAT 포함)',
            amount: Math.round(logistics * VAT_MULTIPLIER),
        });
        costs.push({
            key: 'storage',
            label: '보관비 (VAT 포함)',
            amount: Math.round(nonNegative(input.storageFee) * VAT_MULTIPLIER),
        });
    } else {
        costs.push({ key: 'shipping', label: '실제 택배비', amount: Math.round(nonNegative(input.shippingCost)) });
    }

    const result = assemble({
        productPay,
        revenue,
        fees,
        costs,
        vatMode: input.vatMode,
        // 쿠팡 광고센터는 광고비를 부가세 별도로 표시합니다.
        adVatExcluded: input.adVatExcluded !== false,
        roas: input.roas,
        targetMarginRate: input.targetMarginRate,
    });

    return { ...result, channel: 'coupang', mode, serviceFeeApplies, monthlySales };
}

// ===== 목표 마진을 맞추는 판매가 역산 =====

// 마진율이 목표 이상이 되는 가장 낮은 판매가(10원 단위 올림). 찾지 못하면 null.
export function solvePriceForMargin(calc, input, targetMarginRate) {
    const target = num(targetMarginRate, NaN);
    if (!Number.isFinite(target) || target >= 100) return null;

    const marginAt = (price) => calc({ ...input, salePrice: price }).marginRate;
    let low = 0;
    let high = 100_000_000;
    if (marginAt(high) < target) return null;

    for (let i = 0; i < 60 && high - low > 1; i++) {
        const mid = Math.floor((low + high) / 2);
        if (marginAt(mid) >= target) high = mid;
        else low = mid;
    }

    let price = Math.ceil(high / 10) * 10;
    // 수수료 반올림 때문에 10원 단위 경계에서 목표에 못 미칠 수 있어 한 번 더 확인합니다.
    for (let i = 0; i < 20 && marginAt(price) < target; i++) price += 10;
    return marginAt(price) >= target ? price : null;
}
