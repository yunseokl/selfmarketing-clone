// 추천 키워드 5차 채점(2026-11-18)의 흔들기 입력 30종을 그대로 옮긴 것입니다(원본: .playwright-mcp/qa/keywords/round5/stress-cases.mjs).
// 전부 시험용으로 만든 가짜 매장이고 숫자도 지어낸 값입니다(실제 매장·네이버 자료 아님). tests/place-keywords.stress.test.mjs 가 씁니다.
// 흔들기용 입력. 전부 시험용으로 내가 만든 가짜 매장입니다(실제 매장·네이버 자료 아님). 숫자도 지어낸 값입니다.
// 모양은 .playwright-mcp/ego/data/data-*.json 의 lookup.place / lookup.activity 와 같습니다.
import { mentionTerms } from '../lib/place-keywords.js';

const DAY = (start, end) => ({ day: '매일', start, end, breaks: [], lastOrder: null });

export function mkPlace(o) {
    const menus = (o.menus || []).map((m) => (typeof m === 'string' ? { name: m, price: '10,000원', hasImage: null, recommended: false } : { price: '10,000원', hasImage: null, recommended: false, ...m }));
    return {
        placeId: o.placeId || `T-${o.id}`,
        name: o.name,
        category: o.category,
        address: o.address ?? '',
        jibunAddress: o.jibun ?? o.address ?? '',
        coordinate: o.coordinate || { x: '127.0', y: '37.5' },
        visitorReviews: o.reviews ?? 100, blogReviews: o.blogReviews ?? 20,
        intro: o.intro ?? null,
        conveniences: o.conveniences || [],
        reviewThemes: [],
        reviewMenus: o.reviewMenus || [],
        reviewVotes: o.reviewVotes || [],
        keywords: o.keywords || [],
        detail: {
            hours: o.hours === undefined ? { registered: true, status: '영업 중', days: [DAY('10:00', '22:00')], regularClosed: null } : o.hours,
            pos: o.pos ?? null,
            menus,
            styles: o.styles || [],
            facilities: o.facilities || [],
            themes: o.themes || [],
            seats: o.seats || [],
            pet: o.pet ?? null,
            subway: o.subway ?? null,
            descriptionLength: 300,
        },
    };
}

// 서버가 활동 묶음에 싣는 블로그 언급 수를 흉내 냅니다: mentionTerms(place) 가 묻는 낱말마다 counts 에 적은 수(없으면 dflt).
export function mkActivity(place, o = {}) {
    const asked = mentionTerms(place);
    const counts = o.counts || {};
    const blogTotal = o.blogTotal ?? 40;
    return {
        visitor: null, blog: null,
        feeds: o.feeds || { count: 0, hasMore: false, latest: null, latestTitle: null, latestCategory: null, daysSinceLatest: null, last30: 0 },
        coupons: { total: 0, titles: [], memberships: [] },
        briefing: o.briefing || null,
        mentions: { blogTotal, terms: asked.map((term) => ({ term, count: counts[term] ?? o.dflt ?? 0 })) },
    };
}

const rank = (keyword, rankNo, extra = {}) => ({
    keyword, state: 'done',
    result: { keyword, status: rankNo ? 'found' : 'beyond', rank: rankNo, total: 300, scanned: rankNo ? 100 : 300, target: null, top: [
        { rank: 1, placeId: 'x1', name: '시험상위A', category: '', visitorReviews: 100, blogReviews: 10, isTarget: false, area: '' },
        { rank: 2, placeId: 'x2', name: '시험상위B', category: '', visitorReviews: 90, blogReviews: 9, isTarget: false, area: '' },
    ], topSignals: null, ...extra },
});

export const CASES = [];
const add = (c) => CASES.push(c);

// 1. 카페(메뉴 이름이 길고 지저분, 아이스·시그니처·세트A 같은 조각 낱말이 되풀이)
{
    const place = mkPlace({
        id: 'cafe', name: '모카하우스 연남점', category: '카페,디저트',
        address: '서울 마포구 성미산로 123 1층', jibun: '서울 마포구 연남동 228-5',
        subway: { station: '홍대입구역', exit: '3', walkMinutes: 7 },
        keywords: ['연남동카페', '연남카페', '홍대입구카페', '크로플맛집', '아메리카노'],
        conveniences: ['주차', '무선 인터넷', '반려동물 동반'], pet: true,
        reviewVotes: [{ label: '집중하기 좋아요', count: 60 }, { label: '매장이 넓어요', count: 55 }, { label: '디저트가 맛있어요', count: 70 }],
        menus: ['[1+1] 아이스 아메리카노 (R)', '아이스 카페라떼', '아이스 바닐라라떼', '아이스티', '시그니처 말차라떼', '시그니처 크로플', '시그니처 딸기케이크',
            '★추천★ 생과일 에이드', '스페셜 세트A(2인)', '스페셜 세트B(3인)', '딸기 케이크', '치즈 케이크', '아메리카노 (HOT)', '크로플 + 아메리카노 세트', '런치세트A(2인)'],
        reviewMenus: [{ label: '아메리카노', count: 120 }, { label: '크로플', count: 95 }, { label: '말차라떼', count: 70 }, { label: '딸기케이크', count: 52 },
            { label: '바닐라라떼', count: 40 }, { label: '아이스 아메리카노', count: 38 }, { label: '세트A', count: 20 }, { label: '아이스', count: 15 }],
    });
    add({
        id: 'cafe', label: '카페(지저분한 메뉴 이름·조각 낱말)', place,
        activity: mkActivity(place, { counts: { 카페: 30, 크로플: 12, 아메리카노: 20 }, feeds: { count: 3, hasMore: false, latest: '2026-11-01', latestTitle: '아이스 시그니처 신메뉴 출시', latestCategory: '소식', daysSinceLatest: 17, last30: 1 } }),
        rivals: [
            { placeId: 'r1', name: '연남커피', keywords: ['연남동카페', '연남카페', '연남디저트'] },
            { placeId: 'r2', name: '홍대브런치카페', keywords: ['홍대입구카페', '연남브런치', '연남카페'] },
            { placeId: 'r3', name: '연트럴카페', keywords: ['연남카페', '주차', '연남동카페'] },
        ],
        ranks: [rank('연남동카페', 4), rank('연남카페', 25), rank('홍대입구카페', 60)],
    });
}

// 2. 치과(야간진료, 임플란트 등 진료 과목)
{
    const place = mkPlace({
        id: 'dental', name: '미소가득치과의원', category: '치과',
        address: '서울 서초구 서초대로 400 3층', jibun: '서울 서초구 서초동 1520-3',
        subway: { station: '서초역', exit: '2', walkMinutes: 4 },
        keywords: ['서초치과', '서초임플란트', '서초역치과'],
        conveniences: ['주차', '예약', '무선 인터넷'],
        hours: { registered: true, status: '영업 중', days: [DAY('09:30', '18:30'), { day: '목', start: '09:30', end: '21:00', breaks: [], lastOrder: null }] },
        menus: ['임플란트 (1개)', '치아교정', '스케일링', '사랑니 발치', '충치치료', '레진', '보철', '틀니', '치아미백', '신경치료'],
        reviewVotes: [{ label: '친절해요', count: 120 }, { label: '설명을 잘해줘요', count: 90 }, { label: '통증이 적어요', count: 70 }],
        reviewMenus: [{ label: '임플란트', count: 85 }, { label: '스케일링', count: 60 }, { label: '충치치료', count: 40 }, { label: '교정', count: 30 }, { label: '사랑니발치', count: 25 }, { label: '신경치료', count: 18 }, { label: '레진', count: 12 }, { label: '미백', count: 8 }],
    });
    add({
        id: 'dental', label: '치과(야간진료 있음)', place, activity: mkActivity(place, { counts: { 치과: 35, 임플란트: 20, 스케일링: 14, 야간진료: 3 } }),
        rivals: [{ placeId: 'r1', name: '서초연세치과', keywords: ['서초치과', '서초역치과', '교대치과'] }, { placeId: 'r2', name: '서초밝은치과', keywords: ['서초치과', '서초임플란트'] }],
        ranks: [rank('서초치과', 7), rank('서초임플란트', 15), rank('서초역치과', 3)],
    });
}

// 3. 한의원(등록 키워드 없음·순위 없음·경쟁 자료 없음)
{
    const place = mkPlace({
        id: 'hanbang', name: '늘푸른한의원', category: '한의원',
        address: '대구 수성구 범어천로 100', jibun: '대구 수성구 범어동 55-1',
        reviewMenus: [{ label: '침', count: 40 }, { label: '추나요법', count: 30 }, { label: '다이어트한약', count: 20 }, { label: '교통사고치료', count: 12 }, { label: '공진단', count: 6 }],
        reviewVotes: [{ label: '친절해요', count: 40 }],
    });
    add({ id: 'hanbang', label: '한의원(등록 키워드 없음, 순위·경쟁 자료 없음)', place, activity: mkActivity(place, { counts: { 한의원: 10, 추나요법: 6 } }), rivals: [], ranks: [] });
}

// 4. 학원
{
    const place = mkPlace({
        id: 'academy', name: '정자 수학의힘 학원', category: '입시학원,보습학원',
        address: '경기 성남시 분당구 정자일로 95', jibun: '경기 성남시 분당구 정자동 101',
        keywords: ['정자동수학학원', '분당수학학원'],
        reviewVotes: [{ label: '선생님이 열정적이에요', count: 80 }, { label: '성적이 올랐어요', count: 60 }],
        reviewMenus: [{ label: '수학', count: 50 }, { label: '내신', count: 40 }, { label: '수능', count: 25 }, { label: '중등수학', count: 20 }, { label: '초등수학', count: 18 }, { label: '영어', count: 5 }],
    });
    add({ id: 'academy', label: '학원(수학)', place, activity: mkActivity(place, { counts: { 입시학원: 5, 보습학원: 4, 수학: 20, 내신: 12 } }), rivals: [{ placeId: 'r1', name: '분당수학전문', keywords: ['분당수학학원', '정자동학원'] }], ranks: [rank('정자동수학학원', 3), rank('분당수학학원', 40)] });
}

// 5. 네일샵(괄호·대괄호 이벤트 이름)
{
    const place = mkPlace({
        id: 'nail', name: '라온네일 해운대점', category: '네일아트',
        address: '부산 해운대구 해운대해변로 200', jibun: '부산 해운대구 우동 1411',
        subway: { station: '해운대', exit: '1', walkMinutes: 5 },
        keywords: ['해운대네일', '우동네일샵', '젤네일'],
        reviewMenus: [{ label: '젤네일', count: 100 }, { label: '아트', count: 40 }, { label: '케어', count: 25 }, { label: '[이벤트] 원컬러', count: 12 }, { label: '패디큐어', count: 10 }, { label: '속눈썹연장', count: 6 }],
        styles: [{ name: '젤원컬러', count: 80 }, { name: '프렌치', count: 40 }, { name: '이달의아트 (이벤트)', count: 30 }],
    });
    add({ id: 'nail', label: '네일샵', place, activity: mkActivity(place, { counts: { 네일샵: 10, 젤네일: 20 } }), rivals: [], ranks: [rank('해운대네일', 5)] });
}

// 6. 펜션
{
    const place = mkPlace({
        id: 'stay', name: '속초 바다풀빌라 펜션', category: '펜션',
        address: '강원 속초시 대포항길 10', jibun: '강원 속초시 대포동 810',
        keywords: ['속초펜션', '속초풀빌라', '속초오션뷰'],
        conveniences: ['주차', '수영장', '바베큐', '반려동물동반', '와이파이'],
        menus: ['오션뷰 스탠다드 (2인)', '오션뷰 스위트 (4인)', '독채 풀빌라 (6인)'],
        reviewMenus: [{ label: '오션뷰', count: 40 }, { label: '바베큐', count: 30 }, { label: '수영장', count: 22 }, { label: '풀빌라', count: 18 }, { label: '스파', count: 10 }, { label: '조식', count: 6 }],
    });
    add({ id: 'stay', label: '펜션/숙박', place, activity: mkActivity(place, { counts: { 풀빌라: 10, 펜션: 20 } }), rivals: [{ placeId: 'r1', name: '속초오션펜션', keywords: ['속초펜션', '속초오션뷰펜션', '속초풀빌라'] }, { placeId: 'r2', name: '속초스파펜션', keywords: ['속초펜션', '속초스파'] }], ranks: [rank('속초펜션', 8), rank('속초풀빌라', 12)] });
}

// 7. 헬스장(샤워실·락커·주차 같은 조건어가 리뷰 메뉴에 섞임)
{
    const place = mkPlace({
        id: 'gym', name: '잠실 파워짐 신천점', category: '헬스장',
        address: '서울 송파구 올림픽로 300', jibun: '서울 송파구 신천동 7-18',
        subway: { station: '잠실새내', exit: '4', walkMinutes: 4 },
        keywords: ['잠실헬스', '송파PT', '신천헬스장'],
        conveniences: ['주차', '샤워실', '락커'],
        reviewVotes: [{ label: '시설이 깨끗해요', count: 80 }, { label: '트레이너가 친절해요', count: 70 }],
        reviewMenus: [{ label: 'PT', count: 60 }, { label: '필라테스', count: 22 }, { label: '샤워실', count: 12 }, { label: '락커', count: 9 }, { label: '주차', count: 8 }, { label: 'GX', count: 7 }, { label: '1:1레슨', count: 5 }],
    });
    add({ id: 'gym', label: '헬스장(조건어 섞임)', place, activity: mkActivity(place, { counts: { 헬스장: 10, PT: 8 } }), rivals: [{ placeId: 'r1', name: '시험짐', keywords: ['잠실헬스', '잠실PT', '주차'] }, { placeId: 'r2', name: '시험휘트니스', keywords: ['잠실PT', '주차'] }], ranks: [rank('잠실헬스', 9)] });
}

// 8. 꽃집
{
    const place = mkPlace({
        id: 'flower', name: '하늘꽃방', category: '꽃집',
        address: '대전 서구 둔산로 100', jibun: '대전 서구 둔산동 1000',
        keywords: ['둔산동꽃집', '대전꽃집', '꽃배달'],
        conveniences: ['주차', '포장', '배달'],
        reviewMenus: [{ label: '꽃다발', count: 50 }, { label: '꽃바구니', count: 30 }, { label: '근조화환', count: 20 }, { label: '졸업식꽃다발', count: 10 }, { label: '포장', count: 8 }, { label: '배달', count: 7 }],
    });
    add({ id: 'flower', label: '꽃집', place, activity: mkActivity(place, { counts: { 꽃집: 15, 꽃배달: 9, 꽃다발: 12 } }), rivals: [], ranks: [rank('둔산동꽃집', 2)] });
}

// 9. 정육점(업종이 어느 묶음에도 안 들어감)
{
    const place = mkPlace({
        id: 'butcher', name: '한우마을 정육점', category: '정육점',
        address: '경기 고양시 일산동구 중앙로 1000', jibun: '경기 고양시 일산동구 장항동 600',
        keywords: [],
        menus: ['한우 등심 (100g)', '삼겹살(600g)', '불고기용', '선물세트'],
        reviewMenus: [{ label: '한우', count: 40 }, { label: '삼겹살', count: 35 }, { label: '등심', count: 20 }, { label: '선물세트', count: 10 }],
    });
    add({ id: 'butcher', label: '정육점', place, activity: mkActivity(place, { counts: { 정육점: 5, 한우: 8 } }), rivals: [], ranks: [] });
}

// 10. 메뉴가 2개뿐인 음식점
{
    const place = mkPlace({
        id: 'two', name: '행궁 식당', category: '한식',
        address: '경기 수원시 팔달구 정조로 800', jibun: '경기 수원시 팔달구 행궁동 40',
        keywords: [],
        menus: ['김치찌개', '된장찌개'],
        reviewMenus: [{ label: '김치찌개', count: 20 }, { label: '된장찌개', count: 10 }, { label: '김밥', count: 4 }],
    });
    add({ id: 'two', label: '메뉴 2개뿐인 식당', place, activity: mkActivity(place, { counts: { 김치찌개: 5 } }), rivals: [], ranks: [] });
}

// 11. 리뷰 0건 새 매장
{
    const place = mkPlace({
        id: 'newcafe', name: '새싹카페', category: '카페',
        address: '서울 성동구 아차산로 10', jibun: '서울 성동구 성수동2가 300',
        keywords: [], reviews: 0, blogReviews: 0, reviewMenus: [], reviewVotes: [], menus: ['아메리카노', '카페라떼', '레몬에이드'],
    });
    add({ id: 'newcafe', label: '리뷰 0건 새 카페(활동 자료 없음)', place, activity: null, rivals: [], ranks: [] });
}

// 12. 지역 정보가 비어 있는 매장
{
    const place = mkPlace({
        id: 'noaddr', name: '맛나식당', category: '한식', address: '', jibun: '',
        keywords: ['맛나식당', '김치찌개'], reviewMenus: [{ label: '김치찌개', count: 20 }],
    });
    add({ id: 'noaddr', label: '주소 비어 있음', place, activity: mkActivity(place, {}), rivals: [], ranks: [] });
}

// 13. 지저분한 메뉴 이름(횟집): 大·세트A·2인
{
    const place = mkPlace({
        id: 'messy', name: '바다향 횟집 합정점', category: '생선회',
        address: '서울 마포구 양화로 50', jibun: '서울 마포구 합정동 400',
        subway: { station: '합정', exit: '5', walkMinutes: 3 },
        keywords: ['합정횟집', '합정회식'],
        menus: ['★추천★ 모둠회 大', '모둠회 中', '모둠회 小', '광어회 大', '우럭회 (2인)', '런치세트A(2인)', '런치세트B(3인)', '스페셜 세트A', '매운탕 (小)', '[이벤트] 해물파전', '공기밥 추가'],
        reviewMenus: [{ label: '모둠회 大', count: 30 }, { label: '광어회', count: 25 }, { label: '모둠회', count: 22 }, { label: '세트A', count: 12 }, { label: '런치세트A', count: 10 }, { label: '매운탕', count: 9 }, { label: '서비스', count: 7 }, { label: '2인', count: 4 }],
    });
    add({ id: 'messy', label: '횟집(★추천★ 모둠회 大·런치세트A(2인))', place, activity: mkActivity(place, { counts: { 횟집: 18, 광어회: 10, 모둠회: 12 } }), rivals: [{ placeId: 'r1', name: '합정수산', keywords: ['합정횟집', '합정회식'] }], ranks: [rank('합정횟집', 6), rank('합정회식', 14)] });
}

// 14. 영어·숫자가 섞인 메뉴
{
    const place = mkPlace({
        id: 'engcafe', name: '브루앤코 BREW&CO 판교점', category: '카페',
        address: '경기 성남시 분당구 판교역로 235', jibun: '경기 성남시 분당구 삼평동 681',
        subway: { station: '판교', exit: '1', walkMinutes: 3 },
        keywords: ['판교카페'],
        menus: ['Americano (HOT)', 'Iced Latte 12oz', '3종 디저트 세트', '1인 세트', 'A세트', 'B세트', 'Brunch Plate'],
        reviewMenus: [{ label: 'Americano', count: 40 }, { label: 'Latte', count: 30 }, { label: '3종세트', count: 12 }, { label: '1인세트', count: 10 }, { label: 'A세트', count: 9 }, { label: '브런치 플레이트', count: 8 }, { label: 'PT', count: 2 }],
    });
    add({ id: 'engcafe', label: '영어·숫자 섞인 카페 메뉴', place, activity: mkActivity(place, { counts: { 카페: 20 } }), rivals: [], ranks: [rank('판교카페', 5)] });
}

// 15. 띄어쓰기만 다른 같은 낱말
{
    const place = mkPlace({
        id: 'space', name: '논현 바다횟집', category: '횟집',
        address: '서울 강남구 논현로 100', jibun: '서울 강남구 논현동 100',
        keywords: ['논현 횟집', '논현횟집', '강남 횟집'],
        menus: ['광어 회', '광어회', '우럭 회', '모둠 회', '매운탕'],
        reviewMenus: [{ label: '광어 회', count: 50 }, { label: '광어회', count: 30 }, { label: '광어  회', count: 5 }, { label: '우럭회', count: 20 }, { label: '우럭 회', count: 10 }],
    });
    add({ id: 'space', label: '같은 낱말이 띄어쓰기만 다르게 여러 번', place, activity: mkActivity(place, { counts: { 횟집: 12, 광어회: 8 } }), rivals: [], ranks: [] });
}

// 16. 지나치게 넓은 업종("음식점"만)
{
    const place = mkPlace({
        id: 'broad', name: '서울식당', category: '음식점',
        address: '서울 용산구 한강대로 1가', jibun: '서울 용산구 한강로1가 100',
        keywords: [], reviewMenus: [], menus: [],
    });
    add({ id: 'broad', label: '업종이 "음식점"뿐인 매장', place, activity: mkActivity(place, {}), rivals: [], ranks: [] });
}

// 17. 조건어·채널이 상위 매장 키워드로 번짐(음식점)
{
    const place = mkPlace({
        id: 'cond', name: '숯불마을 삼겹살', category: '육류,고기요리',
        address: '서울 강남구 테헤란로 100', jibun: '서울 강남구 역삼동 700',
        subway: { station: '역삼', exit: '1', walkMinutes: 5 },
        keywords: ['역삼삼겹살', '역삼회식'],
        conveniences: ['주차', '예약', '포장', '단체 이용 가능'],
        menus: ['삼겹살 (1인분)', '목살', '항정살', '된장찌개', '냉면', '공기밥'],
        reviewVotes: [{ label: '단체모임 하기 좋아요', count: 30 }],
        reviewMenus: [{ label: '삼겹살', count: 50 }, { label: '목살', count: 30 }, { label: '항정살', count: 20 }, { label: '냉면', count: 12 }, { label: '된장찌개', count: 9 }],
    });
    add({
        id: 'cond', label: '삼겹살집(상위 매장이 주차·예약·블로그·인스타를 키워드로 등록)', place, activity: mkActivity(place, { counts: { 삼겹살: 20, 회식: 14 } }),
        rivals: [
            { placeId: 'r1', name: '역삼고기집', keywords: ['역삼삼겹살', '역삼주차', '역삼예약'] },
            { placeId: 'r2', name: '역삼숯불', keywords: ['역삼주차', '역삼예약', '인스타맛집'] },
            { placeId: 'r3', name: '역삼정육식당', keywords: ['역삼예약', '블로그', '주차'] },
        ],
        ranks: [rank('역삼삼겹살', 5), rank('역삼회식', 9)],
    });
}

// 18. 조건어가 리뷰 메뉴에 섞임(주차·예약·블로그·인스타·가격·분위기)
{
    const place = mkPlace({
        id: 'cond2', name: '해든 한식당', category: '한식',
        address: '서울 강남구 선릉로 100', jibun: '서울 강남구 삼성동 100',
        keywords: [],
        conveniences: ['주차', '예약'],
        menus: ['불고기정식', '비빔밥', '된장찌개', '제육볶음', '갈비탕', '냉면'],
        reviewMenus: [{ label: '불고기', count: 50 }, { label: '비빔밥', count: 40 }, { label: '주차', count: 35 }, { label: '예약', count: 30 }, { label: '블로그', count: 25 }, { label: '인스타', count: 22 }, { label: '분위기', count: 20 }, { label: '가격', count: 18 }],
    });
    add({ id: 'cond2', label: '한식당(리뷰 메뉴에 주차·예약·블로그·인스타·분위기·가격이 섞임)', place, activity: mkActivity(place, { counts: { 불고기: 10, 비빔밥: 8 } }), rivals: [], ranks: [] });
}

// 19. 전주 비빔밥(지명이 메뉴 이름에 되풀이)
{
    const place = mkPlace({
        id: 'jeonju', name: '한상차림 식당', category: '한식',
        address: '서울 강남구 학동로 100', jibun: '서울 강남구 논현동 200',
        keywords: [],
        menus: ['전주 비빔밥', '전주 콩나물국밥', '전주 한정식', '불고기', '김치찌개', '제육볶음'],
        reviewMenus: [{ label: '비빔밥', count: 40 }, { label: '콩나물국밥', count: 20 }, { label: '불고기', count: 15 }],
    });
    add({ id: 'jeonju', label: '메뉴 이름에 다른 지명이 되풀이("전주 비빔밥")', place, activity: mkActivity(place, { counts: { 비빔밥: 9 } }), rivals: [], ranks: [] });
}

// 20. 가격·수량·기호가 리뷰 메뉴에 섞임
{
    const place = mkPlace({
        id: 'price', name: '포차거리 호프', category: '호프,요리주점',
        address: '서울 관악구 관악로 100', jibun: '서울 관악구 봉천동 100',
        keywords: [],
        menus: ['치킨', '골뱅이무침', '어묵탕', '생맥주 500cc', '소주', '맥주', '감자튀김'],
        reviewMenus: [{ label: '10000원', count: 30 }, { label: '2인세트', count: 25 }, { label: '1인분', count: 20 }, { label: '3개', count: 12 }, { label: '1+1', count: 10 }, { label: '치킨', count: 40 }, { label: '골뱅이무침', count: 22 }, { label: '생맥주', count: 18 }, { label: '소주', count: 9 }],
    });
    add({ id: 'price', label: '호프(가격·수량·기호가 리뷰 메뉴에 섞임)', place, activity: mkActivity(place, { counts: { 치킨: 8, 술집: 10 } }), rivals: [], ranks: [] });
}

// 21. 중식당·분식·고깃집 평범한 입력(주력 메뉴가 다른 업종 낱말)
{
    const place = mkPlace({
        id: 'china', name: '홍콩반점 합정점', category: '중식',
        address: '서울 마포구 양화로 60', jibun: '서울 마포구 합정동 300',
        keywords: ['합정중국집'],
        menus: ['짜장면', '짬뽕', '탕수육', '볶음밥', '군만두', '깐풍기', '팔보채'],
        reviewMenus: [{ label: '짜장면', count: 80 }, { label: '짬뽕', count: 70 }, { label: '탕수육', count: 60 }, { label: '볶음밥', count: 20 }, { label: '군만두', count: 15 }],
    });
    add({ id: 'china', label: '중식당', place, activity: mkActivity(place, { counts: { 중식: 5, 짜장면: 12, 짬뽕: 11 } }), rivals: [], ranks: [rank('합정중국집', 11)] });
}

// 22. 모든 지역의 순위가 나쁜 매장(관문 카)
{
    const place = mkPlace({
        id: 'weak', name: '시험분식', category: '분식',
        address: '서울 노원구 동일로 100', jibun: '서울 노원구 상계동 100',
        keywords: ['상계분식', '노원분식'],
        menus: ['김밥', '떡볶이', '순대', '라면', '튀김'],
        reviewMenus: [{ label: '김밥', count: 40 }, { label: '떡볶이', count: 35 }, { label: '순대', count: 20 }, { label: '튀김', count: 12 }],
    });
    add({ id: 'weak', label: '모든 지역 순위가 30위 밖', place, activity: mkActivity(place, { counts: { 분식: 10, 김밥: 9, 떡볶이: 8 } }), rivals: [], ranks: [rank('상계분식', 55), rank('노원분식', 80)] });
}

// ───────── 2차 흔들기(1차 결과를 보고 더한 입력. 이것도 전부 시험용으로 내가 만든 값) ─────────

// 23. 상호명을 대표키워드로 등록한 매장(주소 있음)
{
    const place = mkPlace({
        id: 'brand', name: '해든식당', category: '한식',
        address: '서울 강남구 선릉로 100', jibun: '서울 강남구 삼성동 100',
        keywords: ['해든식당', '삼성동불고기', '삼성동점심'],
        menus: ['불고기정식', '비빔밥', '된장찌개', '제육볶음', '갈비탕', '냉면'],
        reviewMenus: [{ label: '불고기', count: 50 }, { label: '비빔밥', count: 40 }, { label: '제육볶음', count: 22 }],
    });
    add({ id: 'brand', label: '상호명("해든식당")을 대표키워드로 등록', place, activity: mkActivity(place, { counts: { 불고기: 10, 점심: 8, 식당: 2 } }), rivals: [], ranks: [rank('해든식당', 1), rank('삼성동불고기', 4), rank('삼성동점심', 20)] });
}

// 24. 등록 키워드의 지역 낱말이 주소에 없고 업종 끝말도 목록에 없음("압구정삼겹살", "홍대곱창")
{
    const place = mkPlace({
        id: 'outside', name: '불꽃숯불갈비', category: '육류,고기요리',
        address: '서울 강남구 도산대로 100', jibun: '서울 강남구 신사동 100',
        keywords: ['압구정삼겹살', '압구정고깃집', '신사동갈비'],
        menus: ['양념갈비', '생갈비', '삼겹살', '갈비탕', '냉면', '공기밥'],
        reviewMenus: [{ label: '양념갈비', count: 60 }, { label: '생갈비', count: 40 }, { label: '삼겹살', count: 30 }],
    });
    add({ id: 'outside', label: '주소에 없는 지역 + 업종 끝말이 목록에 없는 등록 키워드', place, activity: mkActivity(place, { counts: { 갈비: 9, 삼겹살: 6 } }), rivals: [], ranks: [rank('압구정삼겹살', 22), rank('압구정고깃집', 30), rank('신사동갈비', 4)] });
}

// 25. 결제 단말 인기 메뉴 이름이 지저분함
{
    const place = mkPlace({
        id: 'pos', name: '한우정 역삼점', category: '육류,고기요리',
        address: '서울 강남구 테헤란로 200', jibun: '서울 강남구 역삼동 800',
        keywords: ['역삼한우', '역삼소고기'],
        menus: ['【한우】등심(200g)', '육회비빔밥 大', '(런치)돈까스 세트', '생삼겹살 1인분', '한우국밥', '된장찌개'],
        pos: { weeklySales: 1000, popularMenus: [{ name: '한우 등심 200g', count: 120, share: 14, change: 'SAME' }, { name: '육회비빔밥 大', count: 90, share: 10, change: 'UP' }, { name: '(런치)돈까스 세트', count: 70, share: 8, change: 'UP' }], averagePrice: { lunch: 30000 } },
        reviewMenus: [{ label: '등심', count: 50 }, { label: '육회', count: 30 }],
    });
    add({ id: 'pos', label: '결제 단말 인기 메뉴 이름이 지저분함("한우 등심 200g"·"육회비빔밥 大")', place, activity: mkActivity(place, { counts: { 한우: 12, 소고기: 7 } }), rivals: [], ranks: [] });
}

// 26. 21시에 닫는 약국인데 블로그에 '심야약국'이 1건 나옴
{
    const place = mkPlace({
        id: 'night', name: '온누리약국', category: '약국',
        address: '서울 노원구 동일로 1000', jibun: '서울 노원구 상계동 300',
        keywords: ['상계약국'],
        conveniences: ['주차'],
        hours: { registered: true, status: '영업 중', days: [DAY('09:00', '21:00')] },
        reviewVotes: [{ label: '친절해요', count: 20 }],
    });
    add({ id: 'night', label: '21시에 닫는 약국인데 블로그에 심야약국이 1건 나옴', place, activity: mkActivity(place, { counts: { 약국: 8, 심야약국: 1, 대형약국: 0, 영양제: 0 } }), rivals: [], ranks: [rank('상계약국', 6)] });
}

// 27. 지역이 멀리 떨어진 순위 결과(far)와 조회 실패 줄
{
    const place = mkPlace({
        id: 'far', name: '맛있는 칼국수', category: '칼국수',
        address: '서울 강동구 천호대로 100', jibun: '서울 강동구 천호동 100', coordinate: { x: '127.12', y: '37.54' },
        keywords: ['천호칼국수', '강동칼국수'],
        menus: ['칼국수', '바지락칼국수', '만두', '수육', '파전'],
        reviewMenus: [{ label: '칼국수', count: 70 }, { label: '수육', count: 20 }, { label: '파전', count: 10 }],
    });
    const farRank = rank('천호칼국수', 3, { top: [
        { rank: 1, placeId: 'f1', name: '먼가게1', category: '', visitorReviews: 1, blogReviews: 1, isTarget: false, area: '부산 해운대구', x: 129.1, y: 35.1 },
        { rank: 2, placeId: 'f2', name: '먼가게2', category: '', visitorReviews: 1, blogReviews: 1, isTarget: false, area: '부산 해운대구', x: 129.1, y: 35.1 },
        { rank: 4, placeId: 'f3', name: '먼가게3', category: '', visitorReviews: 1, blogReviews: 1, isTarget: false, area: '부산 해운대구', x: 129.1, y: 35.1 }] });
    add({ id: 'far', label: '순위 결과가 먼 지역(far)·조회 실패 줄이 섞임', place, activity: mkActivity(place, { counts: { 칼국수: 9 } }), rivals: [], ranks: [farRank, { keyword: '강동칼국수', state: 'error', error: '실패' }, { keyword: '천호수육', state: 'loading' }] });
}

// 28. 값이 이상한 입력(숫자가 글자, 필드 없음, 빈 배열·null 섞임) — 예외가 나는지만 봅니다
{
    const place = {
        placeId: 'T-weird', name: '이상한 매장', category: '카페', address: '서울 마포구 연남동 1', keywords: ['연남카페', null, '', 7, '연남카페'],
        reviewMenus: [{ label: '라떼', count: '50' }, { label: '크로플' }, null, { count: 5 }, { label: '아메리카노', count: 30 }],
        reviewVotes: [{ label: null, count: 3 }], conveniences: [null, '주차'], detail: { menus: [null, { name: null }, { name: '라떼' }], styles: [{ name: '라떼' }], hours: { days: [{ start: 'x', end: null }] }, pos: { popularMenus: [null, { name: undefined }] } },
    };
    add({ id: 'weird', label: '규칙 밖 입력(정규화가 막아 주는 값: count 없음·null 섞임)', place, activity: { mentions: { blogTotal: 'abc', terms: [{ term: '카페', count: NaN }, { term: '라떼', count: '3' }, null] }, feeds: { latestTitle: 5, titles: [null, '라떼 신메뉴'] }, briefing: [null, 3, '라떼가 맛있어요'] }, rivals: [null, { placeId: 'r', keywords: null }, { placeId: 'r2', name: '연남', keywords: ['연남카페', null, 3] }], ranks: [null, { keyword: '연남카페', state: 'done', result: {} }, { keyword: '연남라떼', state: 'done', result: { status: 'found', rank: 'x', top: null } }] });
}

// 29. 업종 연관어 등록(점심)·긴 키워드·이모지
{
    const place = mkPlace({
        id: 'misc', name: '🍣스시하루 본점', category: '초밥,롤',
        address: '서울 서초구 반포대로 100', jibun: '서울 서초구 반포동 100',
        keywords: ['서초구근처가성비좋은초밥맛집', '반포초밥', '서초점심'],
        menus: ['모둠초밥', '연어초밥', '우동', '롤', '사시미', '런치초밥'],
        reviewMenus: [{ label: '🍣모둠초밥', count: 30 }, { label: '연어초밥', count: 25 }, { label: '우동', count: 6 }],
    });
    add({ id: 'misc', label: '이모지 상호·너무 긴 등록 키워드·초밥집', place, activity: mkActivity(place, { counts: { 초밥: 10, 점심: 5 } }), rivals: [], ranks: [rank('반포초밥', 12)] });
}

// 30. 큰 입력(성능): 메뉴 120개, 리뷰 메뉴 40개, 상위 매장 50곳
{
    const menus = Array.from({ length: 120 }, (_, i) => `메뉴${i}번 ${['소고기', '돼지고기', '닭고기', '생선'][i % 4]}`);
    const place = mkPlace({
        id: 'big', name: '대형 뷔페', category: '뷔페',
        address: '서울 송파구 올림픽로 1', jibun: '서울 송파구 잠실동 1', keywords: ['잠실뷔페', '송파뷔페'], menus,
        reviewMenus: Array.from({ length: 40 }, (_, i) => ({ label: `메뉴${i}`, count: 100 - i })),
    });
    const rivals = Array.from({ length: 50 }, (_, i) => ({ placeId: `r${i}`, name: `경쟁${i}`, keywords: ['잠실뷔페', '송파뷔페', `잠실메뉴${i % 7}`] }));
    add({ id: 'big', label: '큰 입력(메뉴 120·상위 매장 50곳)', place, activity: mkActivity(place, { counts: { 뷔페: 9 } }), rivals, ranks: [rank('잠실뷔페', 5), rank('송파뷔페', 9)] });
}
