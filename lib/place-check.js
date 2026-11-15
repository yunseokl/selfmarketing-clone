// 플레이스 진단 — 점검 항목 데이터와 판단 로직(순수 함수).
// 네이버는 순위 가중치를 공개하지 않습니다. 이 파일은 점수·등급·예상 순위를 만들지 않고,
// "항목을 채웠는지"와 "먼저 확인할 것"만 규칙으로 정리합니다. 기준일: 2026-11.

export const AS_OF = '2026-11';
export const STORAGE_KEY = 'place-check:v1';
export const KEYWORD_MAX = 5;

// ---------------------------------------------------------------------------
// 출처. kind: 'official'(네이버 공식 페이지) | 'secondary'(공식 내용을 정리한 외부 글)
// ---------------------------------------------------------------------------
export const SOURCES = {
    rankAlgo: {
        kind: 'official',
        name: '스마트플레이스 고객센터 · 플레이스 업체 검색 순위 알고리즘 안내',
        url: 'https://help.naver.com/service/30026/contents/23472',
    },
    rankHow: {
        kind: 'official',
        name: '스마트플레이스 고객센터 · 플레이스 업체 검색 순위를 높이는 방법 안내',
        url: 'https://help.naver.com/service/30026/contents/23473',
    },
    reviewBlog: {
        kind: 'official',
        name: 'MY플레이스 공식 블로그 · 방문자 리뷰 관리 안내',
        url: 'https://m.blog.naver.com/nv_placemy/222071452627',
    },
    reviewPenalty: {
        kind: 'official',
        name: 'MY플레이스 고객센터 · 업체 단위 페널티 적용 대상 안내',
        url: 'https://help.naver.com/service/19485/contents/24961?osType=MOBILE',
    },
    itemsList: {
        kind: 'secondary',
        name: '데이터프렙 · 스마트플레이스 공식 기준 정리',
        url: 'https://datapreprep.com/article/naver-place-ranking-factors',
    },
    marketing: {
        kind: 'secondary',
        name: '마케팅 인사이드 · 대행사 없이 플레이스 관리하기',
        url: 'https://inside.ampm.co.kr/insight/60900',
    },
    photoMenu: {
        kind: 'secondary',
        name: '블스피 · 플레이스 사진·메뉴 관리',
        url: 'https://www.blrank.co.kr/guides/place-photo-menu-management',
    },
    dropGuide: {
        kind: 'secondary',
        name: '사장님마케팅 · 플레이스 순위 떨어짐 확인 순서',
        url: 'https://sajangmarketing.com/guide/rank-drop.html',
    },
    revu: {
        kind: 'secondary',
        name: '레뷰 비즈센터 · 순위 하락 원인 점검표',
        url: 'https://biz.revu.net/article/naver-place-rank-drop-guide',
    },
    activity: {
        kind: 'secondary',
        name: '웨이팅랩 · 플레이스 순위는 어떻게 정해지나요',
        url: 'https://www.waiting-lab.com/guide/naver-place-ranking',
    },
};

// ---------------------------------------------------------------------------
// 업종
// ---------------------------------------------------------------------------
export const INDUSTRIES = [
    { id: 'restaurant', label: '음식점' },
    { id: 'cafe', label: '카페' },
    { id: 'beauty', label: '뷰티 (미용실·네일 등)' },
    { id: 'clinic', label: '병원·의원' },
    { id: 'etc', label: '기타' },
];

export const DEFAULT_INDUSTRY = 'restaurant';

// ---------------------------------------------------------------------------
// 공식 "순위를 높이는 방법"이 가리키는 10개 항목
// ---------------------------------------------------------------------------
export const OFFICIAL_ITEMS = [
    {
        id: 'name',
        label: '업체명',
        how: '간판과 사업자등록증의 상호를 그대로 입력합니다.',
        caution: '업체명은 검색어와 연결되는 항목(업체명·업종·대표키워드의 단어 조합) 중 하나입니다. 실제 현장과 다르게 적으면 정보의 충실성에 어긋납니다.',
        byIndustry: {
            beauty: '간판 이름과 등록한 상호가 다르면 간판 사진이 등록되지 않을 수 있어요. 둘을 맞춰 두세요.',
        },
        sources: ['rankAlgo', 'itemsList'],
    },
    {
        id: 'category',
        label: '업종',
        how: '실제로 판매·제공하는 것과 가장 가까운 세부 업종을 고릅니다.',
        caution: '업종도 검색어와 연결되는 항목입니다. 실제와 다른 업종을 고르지 마세요.',
        byIndustry: {
            restaurant: '"음식점"처럼 넓게 두기보다 실제 메뉴에 가장 가까운 세부 업종을 고르세요.',
            cafe: '카페·디저트·브런치 등 실제 주력 업종에 맞는 세부 업종을 고르세요.',
            beauty: '미용실·네일샵·피부관리 등 실제로 하는 일에 맞춰 고르세요.',
            clinic: '진료과목에 맞는 업종을 고르세요. 증상·시술명 검색은 업종별 안내가 따로 있습니다.',
        },
        sources: ['rankAlgo', 'itemsList', 'marketing'],
    },
    {
        id: 'keywords',
        label: '대표키워드',
        how: '손님이 실제로 찾는 메뉴명·서비스명을 넣습니다. 최대 5개까지 등록할 수 있어요.',
        caution: '"강남맛집", "머리잘하는미용실" 같은 지역명·홍보성·주관적 표현은 등록이 거절되거나 편집·삭제될 수 있습니다. 아래 대표키워드 점검기로 먼저 확인해 보세요.',
        byIndustry: {
            restaurant: '예: 돼지갈비, 삼겹살, 소갈비처럼 실제로 파는 메뉴명.',
            cafe: '예: 소금빵, 브런치, 수제청처럼 실제로 파는 메뉴명.',
            beauty: '예: 레이어드컷, 염색, 두피케어처럼 실제로 하는 시술·서비스명.',
            clinic: '실제로 제공하는 진료·시술 항목명을 넣으세요.',
        },
        sources: ['rankHow', 'itemsList', 'marketing'],
    },
    {
        id: 'phone',
        label: '전화번호',
        how: '손님이 바로 걸 수 있는 대표 전화번호를 입력합니다.',
        caution: '번호가 바뀌면 바로 고치세요. 실제와 다른 정보는 정보의 충실성에 어긋납니다.',
        sources: ['rankHow', 'itemsList'],
    },
    {
        id: 'address',
        label: '주소',
        how: '주소와 지도 핀 위치를 실제 매장 위치에 맞춥니다.',
        caution: '거리는 검색하는 사람의 위치에 따라 달라져서 사장님이 바꿀 수 있는 값이 아닙니다. 주소와 핀만 정확히 맞추세요.',
        sources: ['rankAlgo', 'itemsList'],
    },
    {
        id: 'homepage',
        label: '홈페이지·SNS',
        how: '운영 중인 홈페이지나 SNS 주소가 있으면 입력합니다.',
        caution: '입력한 주소가 실제로 열리는지, 내용이 현재 가게와 맞는지 확인하세요.',
        sources: ['rankHow', 'itemsList'],
    },
    {
        id: 'directions',
        label: '찾아오는 길',
        how: '가장 가까운 역·출구, 출구에서 걸리는 시간, 주차장 입구처럼 처음 오는 손님이 궁금해하는 내용을 적습니다.',
        caution: '주소를 되풀이하는 칸이 아닙니다. 순위를 직접 올린다고 단정할 수는 없지만, 손님이 길을 찾다 이탈하는 것을 줄이는 데 도움이 됩니다.',
        sources: ['rankHow', 'itemsList', 'marketing'],
    },
    {
        id: 'price',
        label: '가격·메뉴',
        how: '메뉴·서비스 이름과 가격을 글자로 입력합니다.',
        caution: '가격 없이 메뉴명만 적거나 "가격은 전화 문의"라고 쓰면 등록되지 않을 수 있습니다. 메뉴판 사진만 올리면 메뉴 정보로 입력되지 않아요.',
        byIndustry: {
            restaurant: '메뉴는 점심·저녁·주류처럼 카테고리로 나눠 가격과 함께 입력하세요. 네이버 주문·배달 연동 업체는 연동된 쪽 메뉴가 보일 수 있습니다.',
            beauty: '시술·서비스별 가격을 글자로 입력하세요.',
            clinic: '가격·진료 항목 표기는 업종별 작성 기준이 있으니 스마트플레이스 안내에서 먼저 확인하세요.',
        },
        sources: ['rankHow', 'itemsList', 'photoMenu'],
    },
    {
        id: 'photos',
        label: '사진',
        how: '검색 결과 앞자리에 쓰일 대표 사진 2장은 대표 메뉴·외관·내부처럼 손님이 먼저 확인하고 싶은 것으로 올립니다. 나머지는 좌석·주차·외관 등 방문 전에 확인하는 정보 위주로 채우세요.',
        caution: '업체당 최대 120장, 파일당 10MB 이하입니다. 사진 장수와 순위의 관계는 공식적으로 밝혀지지 않았으니 많이 올리는 것이 목적이 되지 않게 하세요. 업체와 관련 없는 사진이나 같은 사진의 중복은 등록되지 않을 수 있습니다.',
        byIndustry: {
            beauty: '시술 사진은 얼굴을 가린 사진, 합성한 비포·애프터 같은 형태가 등록되지 않을 수 있어요. 등록 기준을 확인하세요.',
            clinic: '병·의원은 업종별 사진 기준이 따로 있으니 등록 전에 안내를 확인하세요.',
        },
        sources: ['rankHow', 'itemsList', 'photoMenu'],
    },
    {
        id: 'hours',
        label: '영업시간',
        how: '영업시간, 휴무일, 브레이크타임, 주문 마감 시간을 실제와 똑같이 입력합니다.',
        caution: '바뀌는 날 바로 고치세요. 실제와 다르면 손님이 헛걸음하고, 정보의 충실성에도 어긋납니다.',
        sources: ['rankHow', 'itemsList', 'marketing'],
    },
];

// ---------------------------------------------------------------------------
// 추가 운영 점검 — 공식 10개 항목이 아님. 순위에 직접 반영된다고 공식 확인된 항목이 아니라
// 업계 글에서 정리한 운영 습관입니다(2차 출처).
// ---------------------------------------------------------------------------
export const EXTRA_ITEMS = [
    {
        id: 'reply',
        label: '리뷰 답글',
        how: '최근 리뷰부터 답글을 답니다. 리뷰에 나온 메뉴나 상황을 한 가지 짚어 한두 줄로 쓰면 충분합니다.',
        caution: '답글에 손님의 이름·전화번호 같은 개인정보를 쓰면 답글이 삭제되거나 스마트플레이스 권한이 회수될 수 있습니다(공식 블로그 안내). 감정적인 표현도 삼가세요.',
        sources: ['reviewBlog', 'activity'],
    },
    {
        id: 'news',
        label: '소식',
        how: '신메뉴, 휴무, 영업시간 변경 같은 소식을 정기적으로 올립니다.',
        caution: '소식이 순위에 직접 반영된다는 공식 안내는 확인하지 못했습니다. 손님에게 현재 상황을 알리는 용도로 쓰세요.',
        sources: ['activity'],
    },
    {
        id: 'coupon',
        label: '쿠폰·이벤트',
        how: '실제로 제공할 수 있는 쿠폰이나 이벤트만 등록하고, 끝난 것은 내립니다.',
        caution: '순위 효과가 공식 확인된 항목은 아닙니다. 방문 이유를 만드는 용도입니다.',
        sources: ['activity'],
    },
    {
        id: 'booking',
        label: '예약·톡톡 연결',
        how: '예약이나 톡톡을 받는다면 연결해 두고, 문의에 답할 수 있는 시간대를 정합니다.',
        caution: '연결만 해 두고 응대하지 않으면 손님이 오히려 실망합니다.',
        sources: ['activity'],
    },
    {
        id: 'fresh',
        label: '사진·정보 주기적 확인',
        how: '한 달에 한 번, 사진과 메뉴·가격이 지금 가게와 같은지 훑어봅니다.',
        caution: '오래된 사진이나 지난 이벤트 문구가 남아 있으면 손님이 실제와 다르다고 느낍니다.',
        sources: ['marketing'],
    },
];

// ---------------------------------------------------------------------------
// 점검 결과 계산
// ---------------------------------------------------------------------------
const OFFICIAL_IDS = OFFICIAL_ITEMS.map((i) => i.id);
const EXTRA_IDS = EXTRA_ITEMS.map((i) => i.id);

export function getItemGuide(item, industryId) {
    return {
        how: item.how,
        caution: item.caution,
        industryNote: (item.byIndustry && item.byIndustry[industryId]) || '',
    };
}

// 이 함수는 "몇 개 했는지"만 센다. 가중치나 점수는 없다.
export function summarizeChecklist(state = {}) {
    const checked = state.checked || {};
    const extra = state.extra || {};
    const remaining = OFFICIAL_ITEMS.filter((item) => checked[item.id] !== true);
    const extraRemaining = EXTRA_ITEMS.filter((item) => extra[item.id] !== true);
    return {
        total: OFFICIAL_ITEMS.length,
        done: OFFICIAL_ITEMS.length - remaining.length,
        remaining,
        complete: remaining.length === 0,
        extraTotal: EXTRA_ITEMS.length,
        extraDone: EXTRA_ITEMS.length - extraRemaining.length,
        extraRemaining,
    };
}

// 아직 안 한 항목을 "할 일" 목록으로 바꾼다. 항목 순서는 공식 목록 순서 그대로.
export function buildTodos(state = {}, industryId = DEFAULT_INDUSTRY) {
    return summarizeChecklist(state).remaining.map((item) => {
        const guide = getItemGuide(item, industryId);
        return {
            id: item.id,
            label: item.label,
            action: guide.industryNote || guide.how,
            caution: guide.caution,
        };
    });
}

// ---------------------------------------------------------------------------
// 대표키워드 점검기
// ---------------------------------------------------------------------------
// 홍보성·주관적 표현. 대표키워드에 넣으면 등록이 거절되거나 편집될 수 있다고 알려진 유형입니다.
export const PROMO_WORDS = ['맛집', '최고', '1등', '일등', '추천', '유명', '인기', '제일', '최상', '대박', '잘하는'];

// 이 두 값은 네이버가 정한 글자 수 제한이 아니라 이 도구의 권장 기준입니다.
export const KEYWORD_MIN_LEN = 2;
export const KEYWORD_MAX_LEN = 15;

const squash = (text) => String(text ?? '').replace(/\s+/g, '').toLowerCase();
const lengthOf = (text) => Array.from(squash(text)).length;

export function parseKeywordInput(input) {
    const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\n,]+/);
    return parts
        .map((part) => String(part ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

export function checkKeywords(input, { businessName = '' } = {}) {
    const keywords = parseKeywordInput(input);
    const nameKey = squash(businessName);
    const seen = new Map();
    const listIssues = [];

    if (keywords.length > KEYWORD_MAX) {
        listIssues.push(`키워드가 ${keywords.length}개입니다. 대표키워드는 최대 ${KEYWORD_MAX}개까지 등록할 수 있어요.`);
    }

    const items = keywords.map((keyword, index) => {
        const key = squash(keyword);
        const reasons = [];

        if (index >= KEYWORD_MAX) {
            reasons.push(`${KEYWORD_MAX}개를 넘는 키워드입니다. 등록할 5개를 먼저 고르세요.`);
        }

        if (seen.has(key)) {
            reasons.push(`앞에서 입력한 '${seen.get(key)}'와 같은 키워드입니다.`);
        } else {
            seen.set(key, keyword);
        }

        const len = lengthOf(keyword);
        if (len < KEYWORD_MIN_LEN) {
            reasons.push(`너무 짧습니다(${len}자). 손님이 실제로 검색할 메뉴·서비스명이 맞는지 확인하세요. (이 도구의 권장 기준이며 네이버의 글자 수 제한이 아닙니다)`);
        } else if (len > KEYWORD_MAX_LEN) {
            reasons.push(`너무 깁니다(${len}자). 메뉴명·서비스명 한 가지로 줄이는 편이 좋아요. (이 도구의 권장 기준이며 네이버의 글자 수 제한이 아닙니다)`);
        }

        const promo = PROMO_WORDS.filter((word) => key.includes(word));
        if (promo.length > 0) {
            reasons.push(`홍보성·주관적 표현(${promo.join(', ')})이 들어 있어 등록이 거절되거나 편집될 수 있습니다. 실제 메뉴·서비스명으로 바꿔 보세요.`);
        }

        if (nameKey.length >= 2 && key.includes(nameKey)) {
            reasons.push('업체명을 그대로 반복한 키워드입니다. 업체명은 이미 검색어와 연결되는 항목이니, 대표키워드는 메뉴·서비스명으로 채우세요.');
        }

        return { keyword, status: reasons.length === 0 ? 'pass' : 'warn', reasons };
    });

    const warnCount = items.filter((item) => item.status === 'warn').length;
    return {
        count: keywords.length,
        items,
        listIssues,
        passCount: items.length - warnCount,
        warnCount,
        ok: keywords.length > 0 && warnCount === 0 && listIssues.length === 0,
    };
}

// ---------------------------------------------------------------------------
// 순위가 떨어졌을 때 — 네이버가 공개한 4가지 요소 기준 질문
// ---------------------------------------------------------------------------
export const RANK_NOTICE = '네이버는 플레이스 검색 결과의 노출 순서가 고정된 것이 아니며 수시로 바뀔 수 있다고 안내합니다. 또한 개별 업체의 순위를 보장하거나 임의로 바꾸지 않는다고 밝히고 있어요. 하루 이틀의 변화만으로 원인을 단정하지 마세요.';

export const FACTORS = [
    { id: 'general', label: '순위 변동 자체', desc: '노출 순서는 수시로 바뀝니다. 먼저 같은 조건으로 다시 확인하세요.', sources: ['rankAlgo'] },
    { id: 'completeness', label: '정보의 충실성', desc: '스마트플레이스 정보가 실제 현장을 정확하고 풍부하게 반영하고 있는지 봅니다.', sources: ['rankAlgo', 'rankHow'] },
    { id: 'similarity', label: '유사도', desc: '검색어와 업체 정보가 얼마나 맞는지 봅니다. 업체명·업종·대표키워드가 단서입니다.', sources: ['rankAlgo'] },
    { id: 'popularity', label: '인기도', desc: '업체와 카테고리를 얼마나 많이 찾는지 봅니다. 방문 리뷰의 글과 사진도 품질 요소로 꼽힙니다.', sources: ['rankAlgo'] },
    { id: 'distance', label: '거리·검색 환경', desc: '검색하는 사람의 위치와 업체의 거리가 반영됩니다. 확인한 위치와 기기에 따라 결과가 달라 보일 수 있어요.', sources: ['rankAlgo', 'revu'] },
];

export const DIAGNOSE_QUESTIONS = [
    {
        id: 'q-short-term',
        factor: 'general',
        question: '순위를 하루 이틀 사이의 변화만 보고 걱정하고 있나요?',
        action: '오늘 숫자를 적어 두고, 일주일 뒤 같은 요일·같은 시간·같은 검색어·같은 위치에서 다시 확인하세요. 그때도 내려가 있을 때만 아래 항목을 보면 됩니다.',
    },
    {
        id: 'q-changed',
        factor: 'similarity',
        question: '최근 한 달 안에 업종·업체명·대표키워드를 바꾼 적이 있나요?',
        action: '바꾼 항목이 실제 가게와 맞는지 확인하세요. 실제와 다르게 바꿨다면 원래대로 돌리는 것을 먼저 검토합니다.',
    },
    {
        id: 'q-keyword-promo',
        factor: 'similarity',
        question: '대표키워드에 실제 메뉴·서비스명이 없고, 지역명이나 "맛집" 같은 홍보성 표현만 있나요?',
        action: '대표키워드를 실제 메뉴·서비스명으로 채우세요. 정보 충실도 점검 탭의 대표키워드 점검기로 확인할 수 있어요.',
    },
    {
        id: 'q-review-fresh',
        factor: 'popularity',
        question: '최근 몇 주 동안 새 방문 리뷰나 사진이 거의 올라오지 않았나요?',
        action: '실제 방문 손님에게 리뷰 작성을 안내하세요. 안내 자체는 괜찮지만, 점수나 표현을 정해 달라고 요구하면 안 됩니다.',
    },
    {
        id: 'q-review-drop',
        factor: 'popularity',
        question: '방문자 리뷰 개수가 줄어든 것 같나요?',
        action: '스마트플레이스 고객센터의 "방문자 리뷰 개수가 감소한 경우" 안내를 읽고, 작성자가 삭제했거나 이용 정책에 맞지 않아 숨겨진 경우인지 확인하세요.',
    },
    {
        id: 'q-competitor',
        factor: 'popularity',
        question: '새로 생겼거나 최근 올라온 경쟁 가게가 같은 키워드에서 내 가게 위에 보이나요?',
        action: '그 가게의 공개 플레이스 화면을 직접 열어 사진·메뉴·영업시간·대표키워드가 어떻게 채워져 있는지 내 가게와 나란히 비교해 보세요.',
    },
    {
        id: 'q-info-mismatch',
        factor: 'completeness',
        question: '영업시간·메뉴·가격·사진 중 지금 가게와 다른 것이 있나요?',
        action: '다른 항목을 바로 고치세요. 바뀐 정보는 바뀐 날 바로 입력하는 것이 원칙입니다.',
    },
    {
        id: 'q-blank-items',
        factor: 'completeness',
        question: '정보 충실도 점검의 10개 항목 중 비어 있거나 아직 확인하지 않은 칸이 있나요?',
        action: '정보 충실도 점검 탭에서 비어 있는 항목부터 채우세요. 네이버가 순위를 높이는 방법으로 안내한 것은 스마트플레이스 정보를 정확하고 풍부하게 채우는 일입니다.',
    },
    {
        id: 'q-location',
        factor: 'distance',
        question: '순위를 확인한 곳이 가게 안이거나, 손님이 있을 동네와 다른 곳인가요?',
        action: '손님이 검색할 만한 곳(역 앞, 상권 입구 등)을 한두 곳 정해 같은 곳에서 확인하세요. 가게 안에서 보면 실제보다 좋게 보이기 쉽습니다.',
    },
    {
        id: 'q-device',
        factor: 'distance',
        question: '확인할 때마다 PC와 모바일, 로그인 여부를 다르게 했나요?',
        action: '기기와 로그인 상태를 하나로 정해 두고 기록하세요. 같은 키워드도 PC와 모바일에서 결과가 다르게 보일 수 있습니다.',
    },
];

export function diagnose(answers = {}) {
    const total = DIAGNOSE_QUESTIONS.length;
    const answered = DIAGNOSE_QUESTIONS.filter((q) => answers[q.id] === 'yes' || answers[q.id] === 'no').length;
    const yesQuestions = DIAGNOSE_QUESTIONS.filter((q) => answers[q.id] === 'yes');

    const groups = FACTORS
        .map((factor) => ({
            ...factor,
            items: yesQuestions
                .filter((q) => q.factor === factor.id)
                .map((q) => ({ id: q.id, question: q.question, action: q.action })),
        }))
        .filter((group) => group.items.length > 0);

    return {
        total,
        answered,
        yesCount: yesQuestions.length,
        complete: answered === total,
        groups,
        // 모든 질문에 답했는데 해당 사항이 없을 때
        nothingFound: answered === total && yesQuestions.length === 0,
    };
}

// ---------------------------------------------------------------------------
// 브라우저 저장값 정리 (localStorage 에서 읽은 값은 믿지 않고 항상 걸러서 쓴다)
// ---------------------------------------------------------------------------
export function defaultState() {
    return {
        industry: DEFAULT_INDUSTRY,
        checked: {},
        extra: {},
        businessName: '',
        keywordsText: '',
        answers: {},
    };
}

function pickTrue(source, ids) {
    const out = {};
    if (source && typeof source === 'object') {
        ids.forEach((id) => {
            if (source[id] === true) out[id] = true;
        });
    }
    return out;
}

export function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    const answers = {};
    if (raw.answers && typeof raw.answers === 'object') {
        DIAGNOSE_QUESTIONS.forEach((q) => {
            const value = raw.answers[q.id];
            if (value === 'yes' || value === 'no') answers[q.id] = value;
        });
    }

    return {
        industry: INDUSTRIES.some((i) => i.id === raw.industry) ? raw.industry : base.industry,
        checked: pickTrue(raw.checked, OFFICIAL_IDS),
        extra: pickTrue(raw.extra, EXTRA_IDS),
        businessName: typeof raw.businessName === 'string' ? raw.businessName.slice(0, 40) : '',
        keywordsText: typeof raw.keywordsText === 'string' ? raw.keywordsText.slice(0, 300) : '',
        answers,
    };
}
