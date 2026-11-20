// 업종 때문에 해당하지 않는 진단 항목.
//
// 같은 진단 항목이라도 어떤 업종에서는 사장님이 할 수 없거나 권하지 않는 일입니다. 그런 항목으로 점수를 깎거나 할 일로 올리면 안 되므로,
// 점수·질문표·할 일·체크리스트가 같은 판정(notApplicableOf)을 보고 그 항목을 빼고, 화면은 이 판정의 이유를 "이 업종에는 해당 없음"으로 보여 줍니다.
//   · 병의원(병원·의원·치과·한의원 등): 네이버가 새소식 기능과 쿠폰 기능을 제공하지 않습니다(네이버 스마트플레이스 공식 도움말 H20513·H20833).
//   · 약국: 약사법 시행규칙(제44조)이 약국 개설자의 경품 제공·부당한 손님 유인을 제한해, 쿠폰·할인 혜택은 권하지 않습니다.
//         약국이 네이버 예약을 쓸 수 있는지는 확인하지 못해 "예약 돼요?" 질문과 예약 켜기 할 일은 점수·할 일에서 뺍니다.
//         (새소식은 약국에서 쓸 수 있는지 공식 도움말로 확인되지 않아 그대로 둡니다. 동물병원도 확인하지 못해 그대로 둡니다.)
// 이 파일은 다른 파일을 가져오지 않습니다(naver-place·place-geo·place-keywords 어디서든 불러 쓸 수 있게). 업종을 가르는 말은
// place-keywords.js 의 FAMILIES(pharmacy·clinic)와 같습니다 — tests/place-industry.test.mjs 가 둘이 어긋나지 않는지 확인합니다.

const PHARMACY = /약국/;
const PET = /동물병원|애견|반려동물|펫|강아지|고양이/;
const CLINIC = /의원|병원|치과|한의원|내과|외과|피부과|안과|이비인후과|정형외과|소아|산부인과|비뇨|성형|정신건강|클리닉|한방/;

// 'pharmacy' · 'clinic' · 'pet' · null. 동물병원 계열(pet)이 병의원(clinic)보다 먼저 걸립니다(place-keywords 의 familyOf 와 같은 차례).
export function healthKind(place) {
    const category = String(place?.category || '');
    const text = category || String(place?.name || '');
    if (PHARMACY.test(text)) return 'pharmacy';
    if (PET.test(text)) return 'pet';
    if (CLINIC.test(text)) return 'clinic';
    return null;
}

const CLINIC_NO_FEED = '병의원은 네이버가 새소식 기능을 제공하지 않습니다.';
const CLINIC_NO_COUPON = '병의원은 네이버가 쿠폰 기능을 제공하지 않습니다.';
const PHARMACY_NO_COUPON = '약국은 약사법 시행규칙상 경품·할인으로 손님을 끄는 일이 제한될 수 있어 쿠폰·할인 혜택을 권하지 않습니다.';
const PHARMACY_NO_BOOKING = '약국이 네이버 예약을 쓸 수 있는지 확인되지 않아 예약 항목은 점수와 할 일에서 뺍니다.';

// 업종 때문에 해당하지 않는 항목과 그 이유(해당하면 이유 문장, 아니면 null).
//   feed: 새소식 · coupon: 쿠폰·할인 혜택 · booking: 네이버 예약
export function notApplicableOf(place) {
    const kind = healthKind(place);
    return {
        feed: kind === 'clinic' ? CLINIC_NO_FEED : null,
        coupon: kind === 'clinic' ? CLINIC_NO_COUPON : kind === 'pharmacy' ? PHARMACY_NO_COUPON : null,
        // 약국의 네이버 예약은 "가능 여부 미확인"이라 뺍니다. 이 약국이 이미 네이버 예약을 쓰고 있으면(hasBooking === true) 가능하다는 것이 확인된 것이라 그대로 셉니다.
        booking: kind === 'pharmacy' && place?.detail?.hasBooking !== true ? PHARMACY_NO_BOOKING : null,
    };
}

// 해당 없는 항목이 하나라도 있는지
export function hasNotApplicable(place) {
    const values = notApplicableOf(place);
    return Boolean(values.feed || values.coupon || values.booking);
}
