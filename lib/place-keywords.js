// 추천 키워드 — "지역 + 업종(메뉴·서비스)" 조합.
//
// 손님은 "청주약국", "오창약국"처럼 지역을 붙여 검색합니다. 그런데 스마트플레이스에는
// "일반의약품"처럼 지역이 없는 낱말만 등록한 매장이 많고, 그런 키워드는 순위를 조회해도
// 검색하는 사람의 위치에 따라 결과가 달라 의미가 없습니다.
// 여기서는 네트워크 요청 없이 이미 받은 매장 정보만으로 조합을 만들고, 근거를 함께 붙입니다.
//   - 지역: 주소(시·구·동·읍·면), 가까운 역, 매장명의 지점 이름, 사장님이 이미 등록 키워드에 쓴 지역
//   - 낱말: 업종, 등록한 대표키워드, 방문자 리뷰에 많이 나온 메뉴·시술, 예약 많은 스타일, 주간 인기 메뉴,
//           업종별로 흔히 찾는 낱말(매장 정보에 근거가 있을 때만)
//   - 근거: 블로그 리뷰에 그 낱말이 들어간 글 수(activity.mentions), 상위 매장이 등록한 대표키워드(rivals)
// 근거가 없는 낱말("심야약국"인데 21시에 닫는 매장)은 추천하지 않습니다.

import { KEYWORD_MAX, KEYWORD_MAX_LEN, PROMO_WORDS } from './place-check.js';

export const RECOMMEND_LIMIT = 12;
export const RANK_KEYWORD_MAX = 5;

const METRO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종'];
const PROVINCE = ['경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const SIDO_LONG = {
    충청북: '충북', 충청남: '충남', 전라북: '전북', 전라남: '전남', 경상북: '경북', 경상남: '경남',
};

// 지점 이름이 아닌 "○○점". "청주점·강서점"처럼 지역 이름과 겹치는 낱말(주점·서점)은 통째로 같을 때만 뺍니다.
const NOT_BRANCH_EXACT = ['본점', '직영점', '지점', '분점', '주점', '서점', '매점', '상점', '노점'];
const NOT_BRANCH_SUFFIX = ['전문점', '백화점', '편의점', '음식점', '대리점', '할인점', '면세점', '가맹점', '체인점',
    '판매점', '분식점', '제과점', '양복점', '안경점', '문구점', '정육점', '요리주점', '반점', '호점'];

// 등록 키워드에서 "지역 + 낱말"을 가를 때 쓰는 흔한 끝말
const COMMON_SUFFIXES = ['맛집', '횟집', '고깃집', '술집', '밥집', '빵집', '꽃집', '식당', '카페', '미용실', '헤어샵', '네일샵', '네일',
    '약국', '병원', '의원', '치과', '한의원', '학원', '교육원', '헬스장', '필라테스', '요가', '피부관리', '마사지', '왁싱',
    '회식', '점심', '저녁', '모임', '데이트', '혼밥', '포장', '배달', '맛있는집'];

// 키워드에서 지역·업종이 아닌 꾸밈말
const GENERIC_WORDS = ['가볼만한곳', '잘하는곳', '핫플레이스', '유명한곳', '잘하는', '추천', '근처', '주변', '핫플', '인기'];

// "한식·양식"처럼 범위가 넓어 그대로는 잘 검색하지 않는 업종 이름. 조합 우선순위를 낮추고 블로그 언급 조회에서도 뺍니다.
const BROAD_CATEGORY = /^(한식|양식|일식|중식|분식|음식점|아시아음식|퓨전음식|종합|기타)$/;

const TERM = /^[가-힣a-z0-9]{2,8}$/;
const HANGUL_WORD = /^[가-힣a-z0-9]{2,7}$/;

const SCOPE_LABEL = { city: '시·군', district: '구', town: '동·읍·면', station: '역 주변', branch: '지점 이름', custom: '등록 키워드에 쓴 지역' };

// 업종 묶음별로 손님이 흔히 붙여 찾는 낱말. related 는 매장 정보에 근거가 있거나 블로그 후기에서 확인될 때만 추천합니다.
//   when: 리뷰·편의시설·등록 키워드 등에 이 낱말이 보이면 근거로 인정 / late: 그 시각 이후까지 여는 날이 있으면 인정 / lunch: 점심에 열면 인정
// rankOnly 는 순위 확인용(홍보성 표현이라 대표키워드 등록은 권하지 않음)입니다.
// 위에서부터 먼저 맞는 묶음을 씁니다(동물병원이 병원보다 먼저, 요리학원이 음식점보다 먼저 걸리도록).
const FAMILIES = [
    {
        key: 'pharmacy', match: /약국/, base: ['약국'],
        related: [
            { term: '대형약국', when: ['대형', '메가', '창고형', '매장이넓어요', '제품종류가다양해요'] },
            { term: '영양제', when: ['영양제', '건강기능식품', '비타민'] },
            { term: '동물약국', when: ['동물의약품', '동물약'] },
            { term: '심야약국', when: ['심야'], late: 23 },
        ],
    },
    {
        key: 'pet', match: /동물병원|애견|반려동물|펫|강아지|고양이/, base: [],
        related: [
            { term: '애견미용', when: ['미용'] },
            { term: '애견호텔', when: ['호텔'] },
            { term: '24시동물병원', when: ['24시'] },
        ],
    },
    {
        key: 'clinic', match: /의원|병원|치과|한의원|내과|외과|피부과|안과|이비인후과|정형외과|소아|산부인과|비뇨|성형|정신건강|클리닉|한방/, base: [],
        related: [
            { term: '야간진료', when: ['야간진료'], late: 20 },
            { term: '일요일진료', when: ['일요일진료'] },
        ],
    },
    {
        key: 'academy', match: /학원|교습|교육|과외|공부방|독서실|스터디|어학|요양보호사|자격증|직업훈련/, base: [],
        related: [
            { term: '자격증', when: ['자격증'] },
            { term: '국비지원', when: ['국비', '내일배움'] },
        ],
    },
    {
        key: 'fitness', match: /헬스|피트니스|필라테스|요가|크로스핏|수영|골프|클라이밍|복싱|태권도|무용|댄스/, base: [],
        related: [
            { term: 'PT', when: ['pt', '개인레슨', '1:1'] },
            { term: '헬스장', when: ['헬스'] },
        ],
    },
    {
        key: 'hair', match: /미용실|헤어|바버/, base: ['미용실'],
        related: [
            { term: '남자머리', when: ['남성전문', '남자머리', '바버'] },
            { term: '바버샵', when: ['바버'] },
            { term: '1인미용실', when: ['1인미용실'] },
            { term: '헤어샵', when: ['헤어'] },
        ],
    },
    {
        key: 'nail', match: /네일/, base: ['네일샵'],
        related: [
            { term: '젤네일', when: ['젤네일', '젤'] },
            { term: '패디큐어', when: ['패디'] },
            { term: '속눈썹', when: ['속눈썹'] },
        ],
    },
    {
        key: 'skin', match: /피부관리|에스테틱|왁싱|마사지|스파|스웨디시|타이/, base: [],
        related: [
            { term: '피부관리', when: ['피부관리'] },
            { term: '왁싱', when: ['왁싱'] },
            { term: '커플마사지', when: ['커플'] },
        ],
    },
    {
        key: 'flower', match: /꽃|플라워|화원/, base: ['꽃집'],
        related: [
            { term: '꽃배달', when: ['배달'] },
            { term: '꽃다발', when: ['꽃다발'] },
        ],
    },
    {
        key: 'stay', match: /호텔|모텔|펜션|게스트하우스|숙박|리조트|풀빌라|캠핑|글램핑/, base: [],
        related: [
            { term: '애견동반', when: ['반려동물동반'] },
            { term: '풀빌라', when: ['풀빌라', '수영장'] },
        ],
    },
    {
        key: 'cafe', match: /카페|커피|디저트|베이커리|제과|찻집|케이크/, base: ['카페'],
        related: [
            { term: '디저트', when: ['디저트', '케이크', '빵이맛있어요'] },
            { term: '브런치', when: ['브런치'] },
            { term: '베이커리', when: ['베이커리', '빵이맛있어요'] },
            { term: '대형카페', when: ['대형', '매장이넓어요'] },
            { term: '애견동반카페', when: ['반려동물동반'] },
            { term: '카공', when: ['집중하기좋아요', '오래머무르기좋아요'] },
        ],
    },
    {
        key: 'bar', match: /술집|주점|이자카야|포장마차|포차|호프|와인바|칵테일|맥주/, base: ['술집'],
        related: [
            { term: '이자카야', when: ['이자카야'] },
            { term: '회식', when: ['단체이용가능', '단체모임하기좋아요', '회식'] },
            { term: '데이트', when: ['데이트하기좋아요', '데이트'] },
        ],
    },
    {
        key: 'restaurant',
        match: /음식|요리|한식|중식|일식|양식|분식|고기|구이|생선회|횟집|해물|국수|냉면|찌개|전골|국밥|해장국|곰탕|설렁탕|감자탕|추어탕|매운탕|치킨|닭강정|닭갈비|닭발|피자|햄버거|버거|돈가스|초밥|뷔페|족발|보쌈|곱창|막창|갈비|스테이크|한정식|샤브샤브|칼국수|만두|떡볶이|김밥|덮밥|우동|소바|라면|라멘|백반|가정식|쌈밥|보리밥|비빔밥|순대|양꼬치|정육식당|레스토랑|식당|도시락|샐러드|파스타|브런치/,
        base: [],
        rankOnly: ['맛집'],
        related: [
            { term: '점심', when: ['점심'], lunch: true },
            { term: '회식', when: ['단체이용가능', '단체모임하기좋아요', '회식'] },
            { term: '모임', when: ['단체모임하기좋아요', '모임'] },
            { term: '데이트', when: ['데이트하기좋아요', '데이트'] },
            { term: '혼밥', when: ['혼밥하기좋아요', '혼밥'] },
            { term: '룸식당', when: ['룸'] },
            { term: '가족모임', when: ['가족모임', '아이와가기좋아요'] },
            { term: '포장', when: ['포장'] },
            { term: '배달', when: ['배달'] },
        ],
    },
];

function compact(text) {
    return String(text ?? '').replace(/\s+/g, '').toLowerCase();
}

function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueBy(items, keyOf) {
    const seen = new Set();
    return items.filter((item) => {
        const key = keyOf(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ---------------------------------------------------------------------------
// 지역
// ---------------------------------------------------------------------------

function sidoOf(token) {
    const base = String(token || '').replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, '');
    const short = SIDO_LONG[base] || base;
    if (METRO.includes(short)) return { name: short, kind: 'metro' };
    if (PROVINCE.includes(short)) return { name: short, kind: 'province' };
    return null;
}

// "서울 강남구 논현동 98-12" → { sido, sidoKind, city, district, town, townKind }
// 도로 이름(○○로·○○길)이나 번지가 나오면 거기서 멈춥니다.
export function parseAddress(address) {
    const result = { sido: null, sidoKind: null, city: null, district: null, town: null };
    const tokens = String(address || '').split(/\s+/).filter(Boolean);
    let start = 0;
    const sido = sidoOf(tokens[0]);
    if (sido) {
        result.sido = sido.name;
        result.sidoKind = sido.kind;
        start = 1;
    }
    for (const token of tokens.slice(start, start + 4)) {
        if (/^\d/.test(token) || /^산\d/.test(token)) break;
        if (/[가-힣]{2,}\d+가$/.test(token) || /동\d+가$/.test(token)) {
            if (!result.town) result.town = token;
            continue;
        }
        if (/(로|길)$/.test(token) || /\d/.test(token.replace(/\d+동$/, ''))) break;
        if (/시$/.test(token) && !result.city) result.city = token;
        else if (/군$/.test(token) && !result.city) result.city = token;
        else if (/구$/.test(token) && !result.district) result.district = token;
        else if (/(동|읍|면)$/.test(token) && !result.town) result.town = token;
        else if (/리$/.test(token)) continue;
        else break;
    }
    return result;
}

function cityBase(city) {
    const base = String(city || '').replace(/(시|군)$/, '');
    return base.length >= 2 ? base : null;
}

// "일산동구" → "일산", "강동구" → "강동", "중구" → null(전국에 같은 이름이 많아 지역 낱말로 쓰지 않음)
function districtBase(district) {
    const text = String(district || '');
    const directional = text.match(/^(.{2,})(동|서|남|북|중)구$/);
    if (directional) return directional[1];
    const base = text.replace(/구$/, '');
    return base.length >= 2 ? base : null;
}

// "역삼1동" → "역삼", "성수동2가" → "성수", "을지로1가" → "을지로", "오창읍" → "오창"
function townBase(town) {
    const text = String(town || '');
    const ga = text.match(/^(.+?)동?\d+가$/);
    const base = ga ? ga[1] : text.replace(/\d*(동|읍|면)$/, '');
    return base.length >= 2 ? base : null;
}

function branchOf(name) {
    const last = String(name || '').trim().split(/\s+/).pop() || '';
    if (!/점$/.test(last) || last.length < 3 || last.length > 8) return null;
    if (NOT_BRANCH_EXACT.includes(last) || NOT_BRANCH_SUFFIX.some((word) => last.endsWith(word))) return null;
    const base = last.replace(/점$/, '');
    return /^[가-힣]{2,7}$/.test(base) ? base : null;
}

function makeRegion(term, scope, variants = []) {
    const all = uniqueBy([term, ...variants].map(compact).filter((v) => v.length >= 2), (v) => v);
    return { term, scope, label: SCOPE_LABEL[scope], variants: all, used: 0 };
}

// 메뉴·시술처럼 지역이 아닌 것이 분명한 낱말(등록 키워드 앞부분을 지역으로 잘못 읽지 않으려고 씁니다)
function serviceWords(place) {
    return [
        ...list(place?.reviewMenus).map((item) => item.label),
        ...list(place?.detail?.menus).map((item) => item.name),
        ...list(place?.detail?.styles).map((item) => item.name),
        ...list(place?.detail?.pos?.popularMenus).map((item) => item.name),
    ].map(compact).filter((word) => word.length >= 2);
}

// 매장 주소·역·매장명에서 지역 낱말을 뽑습니다. 추천에 쓸 순서대로 돌려줍니다.
//   지방(도 아래 시·군): 시·군 → 동·읍·면 → 역 → 구
//   광역시·특별시: 역 → 구 → 동
// 사장님이 등록 키워드에 이미 쓴 지역은 맨 앞으로 옵니다.
export function regionTerms(place) {
    const road = parseAddress(place?.address);
    const jibun = parseAddress(place?.jibunAddress);
    const parsed = {
        sido: road.sido || jibun.sido,
        sidoKind: road.sidoKind || jibun.sidoKind,
        city: road.city || jibun.city,
        district: road.district || jibun.district,
        town: jibun.town || road.town,
    };

    const byScope = {};
    const city = cityBase(parsed.city) || (parsed.sido === '세종' ? '세종' : null);
    if (city) byScope.city = makeRegion(city, 'city', [parsed.city]);
    const district = districtBase(parsed.district);
    if (district) byScope.district = makeRegion(district, 'district', [parsed.district]);
    const town = townBase(parsed.town);
    if (town) byScope.town = makeRegion(town, 'town', [parsed.town]);

    const subway = place?.detail?.subway;
    const stationName = String(subway?.station || '').trim().replace(/역$/, '');
    const nearStation = stationName && !(Number.isFinite(subway?.walkMinutes) && subway.walkMinutes > 15);
    if (nearStation) {
        // 두 글자 역 이름("강남")은 구·동 이름과 겹치기 쉬워 "강남역"으로 씁니다.
        const term = stationName.length >= 3 ? stationName : `${stationName}역`;
        byScope.station = makeRegion(term, 'station', [`${stationName}역`, stationName]);
    }

    const metro = parsed.sidoKind === 'metro' && !cityBase(parsed.city);
    const order = metro ? ['station', 'district', 'town', 'city'] : ['city', 'town', 'station', 'district'];
    // 이름이 같은 지역(서초구 서초동 → "서초")은 앞선 것 하나로 합칩니다.
    const regions = [];
    for (const region of order.map((scope) => byScope[scope]).filter(Boolean)) {
        const same = regions.find((other) => other.term === region.term);
        if (same) same.variants = uniqueBy([...same.variants, ...region.variants], (v) => v);
        else regions.push(region);
    }

    const known = () => regions.flatMap((region) => region.variants);
    const branch = branchOf(place?.name);
    if (branch && !known().includes(compact(branch)) && !known().includes(compact(branch.replace(/역$/, '')))) {
        regions.push(makeRegion(branch, 'branch'));
    }

    // 등록 키워드가 "○○횟집"처럼 끝나면 앞부분을 사장님이 고른 지역으로 봅니다(주소에 없는 "압구정" 등).
    const suffixes = uniqueBy([...COMMON_SUFFIXES, ...categoryLeaves(place), ...(familyOf(place)?.base || [])].map(compact), (v) => v)
        .sort((a, b) => b.length - a.length);
    const services = serviceWords(place);
    for (const keyword of list(place?.keywords)) {
        const text = compact(keyword);
        const suffix = suffixes.find((word) => text.endsWith(word) && text.length > word.length);
        if (!suffix) continue;
        const prefix = text.slice(0, -suffix.length);
        if (!HANGUL_WORD.test(prefix) || suffixes.includes(prefix) || known().includes(prefix)) continue;
        if ([...PROMO_WORDS, ...GENERIC_WORDS].some((word) => prefix.includes(word))) continue;
        if (services.some((word) => word.includes(prefix) || prefix.includes(word))) continue;
        regions.push(makeRegion(prefix, 'custom'));
    }

    // 등록 키워드에 많이 쓴 지역을 앞으로(같으면 원래 순서).
    // "강남구청횟집"은 "강남"(구)이 아니라 "강남구청"(역)을 쓴 것으로 셉니다: 키워드마다 가장 긴 지역 낱말만 인정
    const longestFirst = known().sort((a, b) => b.length - a.length);
    const keywords = list(place?.keywords).map(compact);
    for (const region of regions) {
        region.used = keywords.filter((keyword) => {
            const longest = longestFirst.find((variant) => keyword.includes(variant));
            return longest !== undefined && region.variants.includes(longest);
        }).length;
    }
    return regions
        .map((region, index) => ({ region, index }))
        .sort((a, b) => b.region.used - a.region.used || a.index - b.index)
        .map((entry) => entry.region);
}

// 키워드에 들어 있는 지역(가장 긴 것). 없으면 null.
function matchRegion(keyword, regions) {
    const text = compact(keyword);
    let best = null;
    for (const region of regions || []) {
        for (const variant of region.variants) {
            if (text.includes(variant) && (!best || variant.length > best.variant.length)) best = { region, variant };
        }
    }
    return best;
}

export function keywordHasRegion(keyword, regions) {
    return matchRegion(keyword, regions) !== null;
}

// "강남구청횟집" → "횟집": 지역과 꾸밈말을 뺀 낱말
export function keywordCore(keyword, regions) {
    let core = compact(keyword);
    const variants = (regions || []).flatMap((region) => region.variants).sort((a, b) => b.length - a.length);
    for (const variant of variants) core = core.split(variant).join('');
    for (const word of GENERIC_WORDS) core = core.split(word).join('');
    return core;
}

// ---------------------------------------------------------------------------
// 낱말
// ---------------------------------------------------------------------------

function categoryLeaves(place) {
    return String(place?.category || '')
        .split(/[,·/]/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2 && part.length <= 10);
}

export function familyOf(place) {
    const text = `${place?.category || ''} ${place?.name || ''}`;
    const byCategory = FAMILIES.find((family) => family.match.test(String(place?.category || '')));
    return byCategory || FAMILIES.find((family) => family.match.test(text)) || null;
}

function clockMinutes(text) {
    const match = String(text || '').match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// hour 시 이후까지 여는 날이 하루라도 있는지(자정을 넘겨 닫는 경우 포함)
function opensLate(hours, hour) {
    return list(hours?.days).some((day) => {
        const start = clockMinutes(day.start);
        const end = clockMinutes(day.end);
        if (start === null || end === null) return false;
        return end >= hour * 60 || end <= start;
    });
}

// 점심 시간(12~14시)에 여는 날이 있는지
function opensLunch(place) {
    if (place?.detail?.pos?.averagePrice?.lunch) return true;
    return list(place?.detail?.hours?.days).some((day) => {
        const start = clockMinutes(day.start);
        const end = clockMinutes(day.end);
        if (start === null || end === null) return false;
        return start <= 12 * 60 && (end >= 14 * 60 || end <= start);
    });
}

// 매장 정보에서 "이 낱말을 쓸 근거"로 삼을 문구들. label 은 화면에 그대로 보여 줄 설명입니다.
function evidenceSources(place, activity) {
    const sources = [];
    const add = (text, label, keyword = null) => {
        const value = compact(text);
        if (value) sources.push({ text: value, label, keyword });
    };
    for (const vote of list(place?.reviewVotes)) add(vote.label, `손님이 고른 좋은 점 '${vote.label}' ${vote.count}명`);
    for (const menu of list(place?.reviewMenus)) add(menu.label, `리뷰에 '${menu.label}' ${menu.count}회`);
    for (const theme of list(place?.reviewThemes)) add(theme.label, `리뷰 주제 '${theme.label}'`);
    for (const word of list(place?.keywords)) add(word, `등록 키워드 '${word}'`, word);
    for (const word of [...list(place?.conveniences), ...list(place?.detail?.facilities)]) add(word, `편의시설 '${word}'`);
    for (const word of list(place?.detail?.themes)) add(word, `매장 특징 '${word}'`);
    for (const word of list(place?.detail?.seats)) add(word, `좌석 '${word}'`);
    for (const menu of list(place?.detail?.menus)) add(menu.name, `메뉴 '${menu.name}'`);
    for (const style of list(place?.detail?.styles)) add(style.name, `예약 스타일 '${style.name}'`);
    add(place?.intro, '한 줄 소개');
    for (const sentence of list(activity?.briefing)) add(sentence, '네이버 AI 브리핑');
    if (place?.detail?.pet === true) add('반려동물동반', '반려동물 동반 가능');
    add(place?.category, '업종');
    // 매장 이름은 맨 뒤에 둡니다(다른 근거가 있으면 그쪽을 먼저 보여 줌).
    const name = compact(place?.name);
    if (name) sources.push({ text: name, label: '매장 이름', keyword: null, isName: true });
    return sources;
}

// 한 글자 낱말("룸")은 통째로 같을 때만 근거로 봅니다.
// 매장 이름은 "블룸식당"의 "룸식당"처럼 우연히 겹치기 쉬워, 추천 낱말 자체는 네 글자 이상일 때만 이름에서 찾습니다.
function sourceHas(source, word, { isTerm = false } = {}) {
    const key = compact(word);
    if (key.length === 1) return source.text === key;
    if (source.isName && isTerm && key.length < 4) return false;
    return source.text.includes(key);
}

function mentionMap(activity) {
    const map = new Map();
    for (const entry of list(activity?.mentions?.terms)) {
        if (Number.isFinite(entry.count)) map.set(compact(entry.term), entry.count);
    }
    return map;
}

// 낱말 후보. source: category(업종) · family(업종 대표어) · registered(등록 키워드) · style(예약 스타일) ·
// review(리뷰 언급) · pos(주간 인기 메뉴) · related(업종 연관어) · rankOnly(순위 확인용)
function collectTerms(place, activity, regions) {
    const terms = new Map();
    const add = (term, source, weight, reason, extra = {}) => {
        const key = compact(term);
        if (!key || key.length < 2) return;
        const found = terms.get(key);
        if (found) {
            if (weight > found.weight) Object.assign(found, { source, weight });
            Object.assign(found, extra);
            if (reason && !found.reasons.some((r) => r.text === reason.text || (r.kind === 'category' && reason.kind === 'category'))) found.reasons.push(reason);
            return;
        }
        terms.set(key, { term: String(term).trim(), key, source, weight, reasons: reason ? [reason] : [], registrable: true, ...extra });
    };

    const family = familyOf(place);
    for (const leaf of categoryLeaves(place)) add(leaf, 'category', BROAD_CATEGORY.test(leaf) ? 30 : 60, { kind: 'category', text: '업종' });
    for (const base of family?.base || []) add(base, 'family', 56, { kind: 'category', text: '업종 대표어' });

    for (const keyword of list(place?.keywords)) {
        const core = keywordCore(keyword, regions);
        if (core.length >= 2 && core.length <= 10) add(core, 'registered', 50, { kind: 'registered', text: '등록 키워드' });
    }

    const styles = list(place?.detail?.styles).filter((style) => TERM.test(compact(style.name))).slice(0, 5);
    const styleMax = Math.max(1, ...styles.map((style) => style.count));
    for (const style of styles) {
        add(style.name, 'style', 34 + Math.round((14 * style.count) / styleMax), { kind: 'booking', text: `예약 ${style.count.toLocaleString('ko-KR')}건` });
    }

    const reviewed = list(place?.reviewMenus).filter((menu) => TERM.test(compact(menu.label))).slice(0, 8);
    const reviewMax = Math.max(1, ...reviewed.map((menu) => menu.count));
    for (const menu of reviewed) {
        add(menu.label, 'review', 30 + Math.round((18 * menu.count) / reviewMax), { kind: 'review', text: `리뷰 ${menu.count.toLocaleString('ko-KR')}회` });
    }

    for (const menu of list(place?.detail?.pos?.popularMenus).filter((item) => TERM.test(compact(item.name))).slice(0, 3)) {
        add(menu.name, 'pos', 30, { kind: 'pos', text: '주간 인기 메뉴' });
    }

    const mentions = mentionMap(activity);
    const sources = evidenceSources(place, activity);
    for (const related of family?.related || []) {
        const key = compact(related.term);
        const hit = sources.find((source) => sourceHas(source, key, { isTerm: true }) || related.when.some((word) => sourceHas(source, word)));
        let reason = hit ? { kind: 'fact', text: hit.label } : null;
        if (!reason && related.late && opensLate(place?.detail?.hours, related.late)) reason = { kind: 'fact', text: `${related.late}시 이후까지 영업` };
        if (!reason && related.lunch && opensLunch(place)) reason = { kind: 'fact', text: '점심 시간 영업' };
        const blog = mentions.get(key);
        // 근거가 없으면 추천하지 않습니다(블로그에 한 번이라도 나오면 근거로 인정).
        if (!reason && !(blog > 0)) continue;
        // 이미 등록 키워드로 올라온 낱말이면 "등록 키워드 '○○'" 근거를 한 번 더 붙이지 않습니다.
        const repeated = hit?.keyword && terms.get(key)?.reasons.some((r) => r.kind === 'registered');
        add(related.term, 'related', 34, repeated ? null : reason, hit?.keyword ? { fromKeyword: compact(hit.keyword) } : {});
    }

    for (const word of family?.rankOnly || []) {
        add(word, 'rankOnly', 52, { kind: 'rank', text: '흔히 쓰는 검색어' }, { registrable: false });
    }

    // 블로그 언급 수 반영
    const blogTotal = activity?.mentions?.blogTotal;
    for (const term of terms.values()) {
        const count = mentions.get(term.key);
        if (count === undefined) continue;
        term.blog = count;
        if (count > 0) {
            const share = blogTotal > 0 ? Math.min(1, count / blogTotal) : 0;
            term.weight += 6 + Math.round(20 * share);
            term.reasons.push({ kind: 'blog', text: blogTotal > 0 ? `블로그 ${count}/${blogTotal}` : `블로그 ${count}개` });
        } else if (term.source !== 'rankOnly') {
            term.weight -= 8;
        }
    }
    return terms;
}

// 블로그 언급 수를 물어볼 낱말(지역을 뺀 낱말, 최대 max 개). 서버가 활동 묶음 요청에 함께 싣습니다.
export function mentionTerms(place, max = 8) {
    const regions = regionTerms(place);
    const family = familyOf(place);
    const terms = collectTerms(place, null, regions);
    const pick = (source, count) => [...terms.values()].filter((term) => term.source === source).slice(0, count).map((term) => term.term);
    const related = (family?.related || []).map((item) => item.term);
    const withEvidence = related.filter((term) => terms.has(compact(term)));
    const ordered = [
        ...pick('category', 2).filter((term) => !BROAD_CATEGORY.test(term)), ...pick('family', 1),
        ...pick('registered', 4),
        ...pick('style', 1), ...pick('review', 3),
        ...withEvidence.slice(0, 3),
        ...pick('pos', 1),
        ...related,
    ];
    return uniqueBy(ordered.filter((term) => /^[가-힣a-zA-Z0-9]{2,15}$/.test(term)), compact).slice(0, max);
}

// ---------------------------------------------------------------------------
// 상위 매장 대표키워드와 교차분석
// ---------------------------------------------------------------------------

function uniqueRivals(rivals, placeId) {
    return uniqueBy(list(rivals).filter((rival) => rival && String(rival.placeId) !== String(placeId)), (rival) => String(rival.placeId || rival.name));
}

// 지역 이름처럼 보이는 앞말: "주중동·오송읍·강남역"처럼 끝나거나 세 글자 이하의 한글
const REGION_LIKE = /(동|읍|면|리|구|시|군|역|로|길)$/;

// 상위 매장 키워드에서 "같은 키워드를 등록한 곳 수"와 "같은 낱말을 쓰는 곳 수"를 셉니다.
//   knownTerms: 내 낱말 후보와 업종 연관어. 여기 있는 낱말은 통째로 한 낱말로 봅니다("대형약국"을 "대형"+"약국"으로 쪼개지 않음).
// 상위 매장의 키워드에는 그 매장 동네 이름이 붙어 있어("주중동약국"), 그 매장 주소(area)·이름으로 읽은 지역도 함께 뺍니다.
// 주소를 모르면 앞말이 지역처럼 보일 때만("주중동"·"오송") 지역으로 보고 뒤의 낱말만 셉니다.
function rivalStats(rivals, regions, knownTerms) {
    const exact = new Map();
    const byTerm = new Map();
    const known = new Set(knownTerms);
    const longestFirst = [...known].sort((a, b) => b.length - a.length);
    for (const rival of rivals) {
        const seenExact = new Set();
        const seenTerm = new Set();
        const theirs = regionTerms({ address: rival.area, jibunAddress: rival.area, name: rival.name, keywords: [] });
        for (const word of list(rival.keywords)) {
            const key = compact(word);
            if (!key) continue;
            if (!seenExact.has(key)) {
                seenExact.add(key);
                const entry = exact.get(key) || { keyword: String(word).trim(), count: 0 };
                entry.count += 1;
                exact.set(key, entry);
            }
            const core = keywordCore(key, [...regions, ...theirs]);
            let termKey = core;
            if (!known.has(core)) {
                const tail = longestFirst.find((term) => core.endsWith(term) && core.length > term.length);
                const prefix = tail ? core.slice(0, -tail.length) : '';
                if (tail && /^[가-힣]+$/.test(prefix) && (REGION_LIKE.test(prefix) || prefix.length <= 3) && !known.has(prefix)) termKey = tail;
            }
            if (termKey && !seenTerm.has(termKey)) {
                seenTerm.add(termKey);
                byTerm.set(termKey, (byTerm.get(termKey) || 0) + 1);
            }
        }
    }
    return { exact, byTerm };
}

// ---------------------------------------------------------------------------
// 추천
// ---------------------------------------------------------------------------

const REGION_BONUS = { city: 20, town: 16, station: 18, district: 8, branch: 10, custom: 14 };
const METRO_BONUS = { station: 20, district: 16, town: 12, city: 6, branch: 10, custom: 14 };

function isPromo(keyword) {
    const key = compact(keyword);
    return PROMO_WORDS.some((word) => key.includes(word));
}

// 매장 1곳의 추천 키워드와 등록 키워드 진단.
//   place, activity: 분석 결과 / rivals: [{ placeId, name, keywords }] (상위 매장 대표키워드, 없으면 생략)
// 돌려주는 값
//   regions    지역 낱말(추천 순서)
//   items      추천 키워드(점수 순). registered=true 는 이미 등록한 것, registrable=false 는 순위 확인용
//   registered 등록한 대표키워드별 진단(지역 유무·블로그 언급·바꿔 쓸 조합)
//   slotsLeft  대표키워드 빈 칸 수
export function recommendKeywords({ place, activity = null, rivals = [], limit = RECOMMEND_LIMIT } = {}) {
    const empty = { regions: [], items: [], registered: [], slotsLeft: 0, rivalCount: 0, hasRegionKeyword: false };
    if (!place) return empty;

    const regions = regionTerms(place);
    const terms = collectTerms(place, activity, regions);
    const others = uniqueRivals(rivals, place.placeId);
    const family = familyOf(place);
    const familyTerms = [...(family?.base || []), ...(family?.related || []).map((item) => item.term), ...(family?.rankOnly || [])].map(compact);
    const stats = rivalStats(others, regions, [...terms.keys(), ...familyTerms]);
    const myKeywords = list(place.keywords);
    const mine = new Set(myKeywords.map(compact));

    // 상위 매장 두 곳 이상이 쓰는 낱말은 내 낱말 후보에도 올립니다(내 매장에 근거가 없어도 "상위 매장이 쓴다"는 사실로).
    for (const [key, count] of stats.byTerm) {
        const term = terms.get(key);
        if (term) {
            term.weight += Math.min(24, 8 * count);
            term.rivals = count;
        } else if (count >= 2 && TERM.test(key) && !isPromo(key)) {
            terms.set(key, { term: key, key, source: 'rival', weight: 26 + Math.min(24, 8 * count), reasons: [], registrable: true, rivals: count });
        }
    }

    const metro = !regions.some((region) => region.scope === 'city');
    const bonus = metro ? METRO_BONUS : REGION_BONUS;
    const ordered = [...terms.values()].sort((a, b) => b.weight - a.weight);

    const candidates = [];
    const seen = new Set();
    ordered.forEach((term, termIndex) => {
        // 가장 중요한 낱말은 지역 3개까지, 나머지는 2개까지 조합합니다.
        const perTerm = termIndex === 0 ? 3 : 2;
        let made = 0;
        for (const [regionIndex, region] of regions.entries()) {
            if (made >= perTerm) break;
            if (term.key.includes(compact(region.term)) || region.variants.some((variant) => term.key.includes(variant))) continue;
            const keyword = `${region.term}${term.term}`;
            const key = compact(keyword);
            if (seen.has(key) || Array.from(key).length > KEYWORD_MAX_LEN) continue;
            seen.add(key);
            // 이미 등록한 조합은 개수에 넣지 않아, 아직 안 쓴 지역과의 조합이 대신 나오게 합니다.
            if (!mine.has(key)) made += 1;
            const exact = stats.exact.get(key)?.count || 0;
            const reasons = [...term.reasons];
            if (exact > 0) reasons.unshift({ kind: 'rival', text: `상위 ${exact}곳 등록` });
            else if (term.rivals > 0) reasons.push({ kind: 'rival', text: `상위 ${term.rivals}곳이 '${term.term}' 사용` });
            candidates.push({
                keyword,
                region: region.term,
                regionScope: region.scope,
                term: term.term,
                source: term.source,
                score: term.weight + (bonus[region.scope] || 4) + (region.used > 0 ? 6 : 0) - regionIndex + Math.min(45, exact * 15),
                reasons,
                blog: term.blog ?? null,
                rivalCount: exact,
                registered: mine.has(key),
                registrable: term.registrable && !isPromo(keyword),
            });
        }
    });
    candidates.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword, 'ko'));

    // 등록 키워드 진단
    const best = (core) => candidates.find((item) => compact(item.term) === core && !item.registered) || null;
    const registered = myKeywords.map((keyword) => {
        const matched = matchRegion(keyword, regions);
        const core = keywordCore(keyword, regions);
        const term = terms.get(core);
        const suggestion = matched || !core ? null : best(core);
        // 등록한 낱말보다 블로그 후기에서 더 많이 쓰는 같은 뜻의 낱말("건강기능식품" 0개 · "영양제" 4개)
        const spoken = [...terms.values()]
            .filter((other) => other.fromKeyword === compact(keyword) && other.blog > (term?.blog ?? 0))
            .sort((a, b) => b.blog - a.blog)[0] || null;
        return {
            keyword,
            hasRegion: matched !== null,
            region: matched ? matched.region.term : null,
            core: core || null,
            blog: term?.blog ?? null,
            rivalCount: stats.exact.get(compact(keyword))?.count || 0,
            suggest: suggestion ? suggestion.keyword : null,
            spoken: spoken ? { term: spoken.term, blog: spoken.blog, keyword: best(spoken.key)?.keyword || null } : null,
        };
    });

    return {
        regions,
        // 이미 등록한 키워드는 추천에서 빼고 registered 진단에서 보여 줍니다.
        items: candidates.filter((item) => !item.registered).slice(0, limit),
        registered,
        slotsLeft: Math.max(0, KEYWORD_MAX - myKeywords.length),
        rivalCount: others.length,
        hasRegionKeyword: registered.some((entry) => entry.hasRegion),
        blogTotal: activity?.mentions?.blogTotal ?? null,
    };
}

// 순위를 자동으로 조회할 키워드: 지역이 들어간 등록 키워드를 먼저 쓰고, 남는 자리는 추천 키워드로 채웁니다.
// 지역이 없는 등록 키워드는 검색 위치에 따라 순위가 달라져 뺍니다(skipped 로 알려 줌).
export function pickRankKeywords(place, recommendation, max = RANK_KEYWORD_MAX) {
    const registered = list(recommendation?.registered);
    const myKeywords = list(place?.keywords);
    if (list(recommendation?.regions).length === 0) {
        return { keywords: myKeywords.slice(0, max), skipped: [], added: [] };
    }
    const keywords = registered.filter((entry) => entry.hasRegion).map((entry) => entry.keyword).slice(0, max);
    const skipped = registered.filter((entry) => !entry.hasRegion).map((entry) => entry.keyword);
    const added = [];
    const perTerm = new Map();
    const taken = new Set(keywords.map(compact));
    const items = list(recommendation?.items);
    // 먼저 낱말이 겹치지 않게(가장 중요한 낱말만 지역 2개) 고르고, 자리가 남으면 낱말당 2개까지 채웁니다.
    for (const pass of [1, 2]) {
        for (const item of items) {
            if (keywords.length >= max) break;
            const key = compact(item.keyword);
            const count = perTerm.get(item.term) || 0;
            const cap = pass === 2 || item.term === items[0].term ? 2 : 1;
            if (taken.has(key) || count >= cap) continue;
            taken.add(key);
            perTerm.set(item.term, count + 1);
            keywords.push(item.keyword);
            added.push(item.keyword);
        }
    }
    return { keywords, skipped, added };
}

// 순위 결과가 "내 지역의 검색 결과"인지 한 줄로 알려 줍니다.
//   locality: rankLocality(result, place.coordinate) / regions: recommendKeywords().regions 또는 regionTerms(place)
// tone: ok(지역 검색) · warn(지역 없는 키워드) · bad(내 지역 결과가 아님) · null(판단 불가)
export function rankScope({ keyword, locality, regions }) {
    const named = keywordHasRegion(keyword, list(regions).map((region) => ({ variants: region.variants || [compact(region.term)] })));
    const region = locality?.region || null;
    const distance = locality?.medianKm !== null && locality?.medianKm !== undefined
        ? `상위 매장까지 중간 거리 ${locality.medianKm < 10 ? locality.medianKm.toFixed(1) : Math.round(locality.medianKm)}km`
        : null;
    if (locality?.scope === 'far') {
        return {
            tone: 'bad',
            title: '내 지역 검색 결과가 아닙니다',
            text: `${distance}. ${named || region ? '키워드의 지역이 내 매장과 멀리 떨어져 있습니다.' : '지역명이 없는 키워드라 서울 중심 기준으로 조회됐습니다.'} 이 순위는 참고하지 마세요.`,
        };
    }
    if (named || region) {
        return {
            tone: 'ok',
            title: region ? `네이버 인식 지역: ${region}` : '지역 키워드',
            text: distance,
        };
    }
    if (locality?.scope === 'local') {
        return { tone: 'ok', title: '동네 검색 결과', text: distance };
    }
    return {
        tone: 'warn',
        title: '지역명이 없는 키워드',
        text: `검색하는 사람의 위치에 따라 순위가 달라져 이 순위는 참고용입니다.${distance ? ` (${distance})` : ''} 지역을 붙인 키워드로 조회해 보세요.`,
    };
}
