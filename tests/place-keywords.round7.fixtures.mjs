// 추천 키워드 7차(구조 변경 6-B) 작업자가 스스로 만든 새 입력 30종(C01~C20·D01~D10): 업종·지역·등록 키워드 모양을 6차 입력과 겹치지 않게 바꿔 만든 것입니다.
// 전부 시험용으로 만든 가짜 매장이고 숫자도 지어낸 값입니다(실제 매장·네이버 자료 아님). tests/place-keywords.round7.test.mjs 가 씁니다.
import { mkPlace, mkActivity, rv, rank, st, rival } from './place-keywords.round6.fixtures.mjs';
import { mentionTerms } from '../lib/place-keywords.js';

export { mkPlace, mkActivity, rv, rank, st, rival };

export const CASES = [];
// 블로그 언급 수 흉내(6차 입력과 같은 규칙): 적지 않은 낱말은 "그 낱말을 품은 더 긴 낱말의 최대 값", 그것도 없으면 0
const inheritCounts = (place, counts) => {
    const asked = mentionTerms(place);
    const out = { ...counts };
    for (const term of asked) {
        if (out[term] !== undefined) continue;
        let best = 0;
        for (const [other, count] of Object.entries(counts)) if (other !== term && other.includes(term) && count > best) best = count;
        out[term] = best;
    }
    return out;
};
const add = (c) => {
    const place = mkPlace({ id: c.id, ...c.p });
    const act = c.act === null ? null : { ...(c.act || {}) };
    if (act) act.counts = inheritCounts(place, act.counts || {});
    const activity = c.act === null ? null : mkActivity(place, { dflt: 0, ...act });
    CASES.push({ id: c.id, label: c.label, aim: c.aim, place, activity, rivals: c.rivals || [], ranks: c.ranks || [], limit: c.limit });
};

const late = (start, end) => ({ registered: true, status: '영업 중', days: [{ day: '매일', start, end, breaks: [], lastOrder: null }], regularClosed: null });

add({
    id: 'C01', label: '곱창집(합정, 홍대 별칭 둘 이상)', aim: '별칭(홍대)이 서로 다른 낱말 앞에 되풀이되면 지역, 웨이팅·주차는 거름',
    p: {
        name: '불꽃곱창 합정점', category: '곱창,막창', address: '서울 마포구 양화로 100', jibun: '서울 마포구 합정동 400', keywords: ['홍대곱창', '홍대막창', '합정곱창'],
        menus: ['소곱창', '막창', '대창', '볶음밥', '된장찌개', '껍데기'],
        reviewMenus: [rv('곱창', 150), rv('막창', 90), rv('대창', 40), rv('껍데기', 30), rv('웨이팅', 20), rv('주차', 10), rv('양념', 8)],
        reviewVotes: [rv('음식이 맛있어요', 120)],
    },
    act: { counts: { 곱창: 15, 막창: 8, 대창: 4, 껍데기: 3 }, blogTotal: 40 },
    rivals: [rival(1, '시험곱창', ['홍대곱창', '합정막창']), rival(2, '시험막창', ['홍대막창', '홍대대창'])],
    ranks: [rank('홍대곱창', 4), rank('합정곱창', 9)],
});
add({
    id: 'C02', label: '치과(정자동, 역 이름 등록)', aim: '정자동/정자역 표기 변형, 리뷰만 있는 충치치료는 후보, 야간진료는 영업시간 근거',
    p: {
        name: '바른미소치과의원', category: '치과', address: '경기 성남시 분당구 성남대로 100', jibun: '경기 성남시 분당구 정자동 20', keywords: ['정자동치과', '정자역임플란트', '수내치과'],
        subway: { station: '정자역', exit: '2', walkMinutes: 4 }, hours: late('09:30', '21:00'),
        menus: ['임플란트', '치아교정', '스케일링', '라미네이트', '신경치료'],
        reviewMenus: [rv('임플란트', 100), rv('교정', 80), rv('충치치료', 60), rv('스케일링', 55), rv('야간진료', 40)],
        reviewVotes: [rv('친절해요', 150), rv('설명을 잘해줘요', 90)],
    },
    act: { counts: { 치과: 15, 임플란트: 9, 교정: 5, 스케일링: 4, 야간진료: 2 }, blogTotal: 40 },
    rivals: [rival(1, '시험치과A', ['정자치과', '정자임플란트']), rival(2, '시험치과B', ['정자치과', '분당치과'])],
    ranks: [rank('정자동치과', 3), rank('정자역임플란트', 11), rank('수내치과', 40)],
});
add({
    id: 'C03', label: '네일샵(해운대, 센텀 별칭 한 번)', aim: '센텀 별칭이 한 번만 나오면 지역이 아님(미확인), 속눈썹은 연관어',
    p: {
        name: '모던네일 해운대점', category: '네일샵', address: '부산 해운대구 센텀중앙로 20', jibun: '부산 해운대구 우동 1500', keywords: ['해운대네일', '센텀네일', '우동젤네일'],
        menus: ['젤네일', '패디', '아트', '케어', '속눈썹연장'],
        reviewMenus: [rv('젤네일', 80), rv('패디', 60), rv('속눈썹', 30), rv('재방문', 20), rv('시술', 15)],
        reviewVotes: [rv('친절해요', 70)],
    },
    act: { counts: { 네일샵: 10, 젤네일: 5, 패디: 3 }, blogTotal: 30 },
    ranks: [rank('해운대네일', 5), rank('센텀네일', 12)],
});
add({
    id: 'C04', label: '분식점(범어동)', aim: '구별되는 메뉴가 메뉴판에 있으면 추천, 메뉴판에 없는 컵밥은 후보, 곁들임 판정',
    p: {
        name: '엄마손분식', category: '분식', address: '대구 수성구 달구벌대로 2200', jibun: '대구 수성구 범어동 100', keywords: ['범어분식', '범어떡볶이'],
        menus: ['떡볶이', '순대', '김밥', '튀김', '라면', '치즈김밥'],
        reviewMenus: [rv('떡볶이', 200), rv('김밥', 120), rv('순대', 90), rv('튀김', 50), rv('컵밥', 30)],
        reviewVotes: [rv('음식이 맛있어요', 100)],
    },
    act: { counts: { 분식: 10, 떡볶이: 12, 김밥: 8 }, blogTotal: 40 },
    ranks: [rank('범어분식', 2), rank('범어떡볶이', 6)],
});
add({
    id: 'C05', label: '이자카야(역삼)', aim: '술 이름은 업종이 술집이라 통과, 오마카세는 메뉴판에 없어 후보, 상호',
    p: {
        name: '이자카야 하루', category: '이자카야', address: '서울 강남구 테헤란로 200', jibun: '서울 강남구 역삼동 700', keywords: ['역삼이자카야', '강남역술집', '역삼맛집'],
        subway: { station: '역삼역', exit: '3', walkMinutes: 5 },
        menus: ['사시미', '꼬치', '우동', '하이볼', '사케', '타코와사비'],
        reviewMenus: [rv('사시미', 90), rv('하이볼', 70), rv('사케', 50), rv('오마카세', 40), rv('콜키지', 20)],
        reviewVotes: [rv('분위기가 좋아요', 90)],
    },
    act: { counts: { 이자카야: 10, 사시미: 6, 하이볼: 4 }, blogTotal: 30 },
    rivals: [rival(1, '시험이자카야', ['역삼이자카야', '역삼오마카세']), rival(2, '시험사케바', ['역삼이자카야', '강남오마카세'])],
    ranks: [rank('역삼이자카야', 4)],
});
add({
    id: 'C06', label: '카센터(품목 자료 없음)', aim: '메뉴판·예약·결제 자료가 없는 매장: 리뷰만으로 고른 말은 unverified 로 추천(근거 점수 절반)',
    p: {
        name: '부평카센터', category: '카센터', address: '인천 부평구 부평대로 50', jibun: '인천 부평구 부평동 300', keywords: ['부평카센터', '인천타이어'],
        menus: [],
        reviewMenus: [rv('타이어', 100), rv('엔진오일', 70), rv('견적', 40), rv('무상점검', 30)],
        reviewVotes: [rv('친절해요', 60)],
    },
    act: { counts: { 카센터: 8, 타이어: 5, 엔진오일: 3 }, blogTotal: 25 },
    ranks: [rank('부평카센터', 3)],
});
add({
    id: 'C07', label: '필라테스(잠실, 송리단길 별칭 한 번)', aim: '별칭 한 번은 미확인, 연관어 PT 는 필라테스에 허용, 원데이는 후보',
    p: {
        name: '코어핏 필라테스', category: '필라테스', address: '서울 송파구 올림픽로 300', jibun: '서울 송파구 잠실동 40', keywords: ['잠실필라테스', '송리단길필라테스'],
        menus: ['기구필라테스', '소그룹', '1:1 개인레슨', '체형교정'],
        reviewMenus: [rv('기구', 100), rv('1:1', 70), rv('원데이', 30), rv('체형교정', 40)],
        reviewVotes: [rv('친절해요', 90)],
    },
    act: { counts: { 필라테스: 15, PT: 4 }, blogTotal: 40 },
    ranks: [rank('잠실필라테스', 5)],
});
add({
    id: 'C08', label: '동물병원(일산, 품목 자료 없음)', aim: '자료가 없는 매장의 연관어(24시동물병원 영업시간 근거)와 unverified',
    p: {
        name: '우리동물메디컬', category: '동물병원', address: '경기 고양시 일산서구 중앙로 1500', jibun: '경기 고양시 일산서구 주엽동 70', keywords: ['주엽동물병원', '일산동물병원'],
        hours: late('09:00', '23:59'), menus: [],
        reviewMenus: [rv('예방접종', 80), rv('중성화', 60), rv('응급', 30)],
        reviewVotes: [rv('설명을 잘해줘요', 80)],
    },
    act: { counts: { 동물병원: 10, 예방접종: 4 }, blogTotal: 25 },
    ranks: [rank('일산동물병원', 6)],
});
add({
    id: 'C09', label: '수학학원(목동)', aim: '학원 연관어(자격증·국비)는 근거 없으면 안 나옴, 상담·레벨테스트는 후보',
    p: {
        name: '목동수학전문학원', category: '수학학원', address: '서울 양천구 목동동로 100', jibun: '서울 양천구 목동 900', keywords: ['목동수학학원', '목동수학', '목동중등수학'],
        menus: ['내신대비', '수능', '선행반'],
        reviewMenus: [rv('내신', 80), rv('선행', 50), rv('상담', 40), rv('레벨테스트', 30)],
        reviewVotes: [rv('선생님이 친절해요', 60)],
    },
    act: { counts: { 수학학원: 12, 내신: 6, 선행: 4 }, blogTotal: 30 },
    ranks: [rank('목동수학학원', 3), rank('목동수학', 8)],
});
add({
    id: 'C10', label: '베이커리 카페(제주 애월)', aim: '업종이 카페면 "카페" 대표어 허용, 오션뷰·주차는 거름, 시 이름 제주 등록',
    p: {
        name: '바당빵집', category: '베이커리,카페', address: '제주특별자치도 제주시 애월읍 애월해안로 100', jibun: '제주특별자치도 제주시 애월읍 애월리 100', keywords: ['애월카페', '제주카페', '제주애월베이커리'],
        menus: ['소금빵', '감귤타르트', '아메리카노', '크루아상'],
        reviewMenus: [rv('소금빵', 90), rv('감귤타르트', 80), rv('오션뷰', 50), rv('주차', 30), rv('아메리카노', 25)],
        reviewVotes: [rv('뷰가 좋아요', 100)],
    },
    act: { counts: { 카페: 14, 베이커리: 8, 소금빵: 6, 감귤타르트: 5 }, blogTotal: 40 },
    ranks: [rank('애월카페', 6), rank('제주카페', 33)],
});
add({
    id: 'C11', label: '한우 고깃집(광교 별칭 두 낱말)', aim: '광교가 고기집·한우 앞에 되풀이되면 지역, 아니면 미확인',
    p: {
        name: '한우명가', category: '한우구이', address: '경기 수원시 영통구 광교중앙로 50', jibun: '경기 수원시 영통구 이의동 900', keywords: ['광교한우', '광교한우구이', '수원갈비'],
        menus: ['한우등심', '한우갈비', '육회', '된장찌개', '냉면'],
        reviewMenus: [rv('한우', 120), rv('등심', 80), rv('육회', 50), rv('룸', 30), rv('웨이팅', 20)],
        reviewVotes: [rv('음식이 맛있어요', 100), rv('단체모임 하기 좋아요', 40)],
    },
    act: { counts: { 한우구이: 10, 한우: 12, 등심: 6, 육회: 4 }, blogTotal: 40 },
    ranks: [rank('광교한우', 4)],
});
add({
    id: 'C12', label: '중식당(여의도)', aim: '요리·코스 낱말, 짜장면·짬뽕은 업종 메뉴라 중식에서 추천',
    p: {
        name: '홍룡반점', category: '중식당', address: '서울 영등포구 여의대로 24', jibun: '서울 영등포구 여의도동 20', keywords: ['여의도중식', '여의도짜장면', '여의도짬뽕'],
        menus: ['짜장면', '짬뽕', '탕수육', '볶음밥', '코스요리'],
        reviewMenus: [rv('탕수육', 100), rv('짜장면', 90), rv('짬뽕', 80), rv('코스요리', 30), rv('배달', 25)],
        reviewVotes: [rv('음식이 맛있어요', 100)],
    },
    act: { counts: { 중식당: 8, 탕수육: 6, 짜장면: 5, 짬뽕: 5 }, blogTotal: 30 },
    ranks: [rank('여의도중식', 5), rank('여의도짜장면', 12)],
});
add({
    id: 'C13', label: '헤어샵(성수동1가, 예약 스타일 있음)', aim: '예약 스타일이 있는 매장: 리뷰만 있는 낱말은 후보, 성수동 표기',
    p: {
        name: '라온헤어', category: '헤어샵', address: '서울 성동구 성수이로 100', jibun: '서울 성동구 성수동1가 600', keywords: ['성수헤어', '성수동미용실'],
        subway: { station: '성수역', exit: '3', walkMinutes: 4 },
        styles: [st('커트', 200), st('펌', 150), st('염색', 100)],
        menus: [],
        reviewMenus: [rv('레이어드컷', 80), rv('탈색', 50), rv('두피케어', 40), rv('커트', 90)],
        reviewVotes: [rv('친절해요', 90)],
    },
    act: { counts: { 헤어샵: 10, 커트: 6, 펌: 4 }, blogTotal: 30 },
    ranks: [rank('성수헤어', 4)],
});
add({
    id: 'C14', label: '꽃집(대전, 시 이름 등록)', aim: '대전이 주소 시이름이면 지역 확인, 꽃배달 연관어, 당일배송은 후보',
    p: {
        name: '플로라 꽃집', category: '꽃집', address: '대전 서구 둔산로 100', jibun: '대전 서구 둔산동 1000', keywords: ['둔산꽃집', '대전꽃배달'],
        menus: ['꽃다발', '화환', '동양란'],
        reviewMenus: [rv('꽃다발', 100), rv('근조화환', 60), rv('당일배송', 40), rv('배달', 30)],
        reviewVotes: [rv('친절해요', 50)],
    },
    act: { counts: { 꽃집: 10, 꽃배달: 6, 꽃다발: 5 }, blogTotal: 30 },
    ranks: [rank('둔산꽃집', 3), rank('대전꽃배달', 9)],
});
add({
    id: 'C15', label: '펜션(강릉)', aim: '숙박 연관어, 바베큐·오션뷰는 리뷰만이라 후보',
    p: {
        name: '파도소리펜션', category: '펜션', address: '강원특별자치도 강릉시 안목해변로 20', jibun: '강원특별자치도 강릉시 견소동 10', keywords: ['강릉펜션', '안목해변펜션', '강릉풀빌라'],
        menus: [],
        reviewMenus: [rv('바베큐', 60), rv('오션뷰', 50), rv('수영장', 40), rv('조식', 30)],
        reviewVotes: [rv('뷰가 좋아요', 80), rv('청결해요', 60)],
    },
    act: { counts: { 펜션: 10, 풀빌라: 3 }, blogTotal: 30 },
    ranks: [rank('강릉펜션', 7)],
});
add({
    id: 'C16', label: '한의원(상계동)', aim: '병의원: 소식 기능 없음, 추나·한약은 메뉴판 품목, 교통사고는 후보',
    p: {
        name: '청연한의원', category: '한의원', address: '서울 노원구 상계로 100', jibun: '서울 노원구 상계동 600', keywords: ['상계한의원', '노원한의원'],
        menus: ['추나요법', '침치료', '약침', '다이어트한약'],
        reviewMenus: [rv('추나', 70), rv('다이어트', 50), rv('교통사고', 30), rv('한약', 25)],
        reviewVotes: [rv('친절해요', 80)],
    },
    act: { counts: { 한의원: 12, 추나: 6, 다이어트: 3 }, blogTotal: 30 },
    ranks: [rank('상계한의원', 4)],
});
add({
    id: 'C17', label: 'PC방(광주 상무지구)', aim: '상무지구 별칭이 PC방·피시방 앞에 되풀이되면 지역',
    p: {
        name: '게임존 PC방', category: 'PC방', address: '광주 서구 상무중앙로 100', jibun: '광주 서구 치평동 1200', keywords: ['상무지구PC방', '상무지구피시방', '치평동PC방'],
        menus: ['라면', '음료', '핫도그'],
        reviewMenus: [rv('라면', 50), rv('좌석', 40), rv('쾌적', 30)],
        reviewVotes: [rv('시설이 깨끗해요', 90)],
    },
    act: { counts: { PC방: 8 }, blogTotal: 20 },
});
add({
    id: 'C18', label: '이사(부천 중동 한 글자 동)', aim: '한 글자 동 중동 읽기, 견적·사다리차는 후보',
    p: {
        name: '안심이사', category: '이사', address: '경기 부천시 길주로 100', jibun: '경기 부천시 중동 1100', keywords: ['중동이사', '부천이사', '포장이사'],
        menus: [],
        reviewMenus: [rv('포장이사', 80), rv('견적', 60), rv('사다리차', 40)],
        reviewVotes: [rv('친절해요', 90)],
    },
    act: { counts: { 이사: 12, 포장이사: 8 }, blogTotal: 30 },
    ranks: [rank('중동이사', 4)],
});
add({
    id: 'C19', label: '사진관(합정, 홍대 별칭)', aim: '증명사진·프로필은 품목, 보정·예약은 거름/후보, 별칭 홍대 한 번은 미확인',
    p: {
        name: '모먼트스튜디오', category: '사진관', address: '서울 마포구 양화로 50', jibun: '서울 마포구 서교동 300', keywords: ['합정사진관', '홍대증명사진', '합정스튜디오'],
        subway: { station: '합정역', exit: '5', walkMinutes: 3 },
        menus: ['증명사진', '프로필', '가족사진'],
        reviewMenus: [rv('프로필', 80), rv('증명사진', 70), rv('보정', 50), rv('예약', 40)],
        reviewVotes: [rv('친절해요', 60)],
    },
    act: { counts: { 사진관: 10, 증명사진: 6, 프로필: 5 }, blogTotal: 30 },
    ranks: [rank('합정사진관', 4)],
});
add({
    id: 'C20', label: '국밥집(창원 상남동, 상호에 지역)', aim: '상호가 지역+낱말(상남국밥)이면 지역 조합을 만들지 않음, 웨이팅 거름',
    p: {
        name: '상남국밥', category: '국밥', address: '경남 창원시 성산구 상남로 100', jibun: '경남 창원시 성산구 상남동 50', keywords: ['상남동국밥', '창원국밥', '상남국밥'],
        menus: ['돼지국밥', '순대국밥', '수육', '내장국밥'],
        reviewMenus: [rv('돼지국밥', 150), rv('수육', 70), rv('깍두기', 30), rv('웨이팅', 20)],
        reviewVotes: [rv('음식이 맛있어요', 100)],
    },
    act: { counts: { 국밥: 12, 돼지국밥: 9, 수육: 4 }, blogTotal: 40 },
    rivals: [rival(1, '시험국밥A', ['창원국밥', '상남돼지국밥']), rival(2, '시험국밥B', ['창원국밥', '창원돼지국밥'])],
    ranks: [rank('창원국밥', 5), rank('상남동국밥', 3)],
});


add({
    id: 'D01', label: '업종 이름이 비어 있는 약국(이름에서 업종)', aim: '업종 이름이 비면 매장 이름을 봄, 일반의약품',
    p: { name: '건강한약국', category: '', address: '서울 강동구 천호대로 100', jibun: '서울 강동구 천호동 100', keywords: ['천호약국', '일반의약품'], reviewVotes: [rv('친절해요', 40)] },
    act: { counts: { 약국: 8 }, blogTotal: 20 },
});
add({
    id: 'D02', label: '슬래시 업종·영문 등록(GX·PT)', aim: '일식/초밥 업종, 영문 낱말',
    p: {
        name: '스시젠', category: '일식/초밥', address: '서울 서초구 반포대로 100', jibun: '서울 서초구 반포동 40', keywords: ['반포초밥', '서초스시', 'SUSHI'],
        menus: ['모둠초밥', '연어초밥', '우동', '사시미', '런치세트'],
        reviewMenus: [rv('연어초밥', 90), rv('모둠초밥', 70), rv('우동', 40), rv('오마카세', 30)],
    },
    act: { counts: { 초밥: 10, 연어초밥: 6, 모둠초밥: 4 }, blogTotal: 30 },
    ranks: [rank('반포초밥', 4)],
});
add({
    id: 'D03', label: '영문 메뉴 카페', aim: '영문 메뉴 이름은 낱말이 아님, 한글 메뉴만',
    p: {
        name: 'Blue Cup', category: '카페', address: '서울 성동구 서울숲2길 10', jibun: '서울 성동구 성수동1가 10', keywords: ['서울숲카페', '성수카페'],
        menus: ['Americano', 'Latte', '딸기케이크', '쿠키', '크로플'],
        reviewMenus: [rv('Americano', 80), rv('딸기케이크', 60), rv('크로플', 50), rv('뷰', 20)],
    },
    act: { counts: { 카페: 10, 딸기케이크: 5, 크로플: 4 }, blogTotal: 30 },
});
add({
    id: 'D04', label: '시도만 있는 주소', aim: '구·동을 못 읽는 주소: 시도만',
    p: {
        name: '해든약국', category: '약국', address: '서울', jibun: '', keywords: ['서울약국', '일반의약품'], reviewVotes: [rv('친절해요', 40)],
    },
    act: { counts: { 약국: 8 }, blogTotal: 20 },
});
add({
    id: 'D05', label: '앞에 수식어가 붙은 메뉴 이름', aim: '프리미엄 한우 등심 같은 여러 낱말 이름: 한우·등심 확인, 프리미엄은 꾸밈',
    p: {
        name: '고기장인', category: '소고기구이', address: '서울 마포구 도화동 100', jibun: '서울 마포구 도화동 100', keywords: ['마포소고기', '도화동한우'],
        menus: ['프리미엄 한우 등심', '프리미엄 한우 채끝', '프리미엄 한우 안심', '된장찌개', '냉면'],
        reviewMenus: [rv('한우', 100), rv('등심', 80), rv('프리미엄', 50), rv('채끝', 40), rv('주차', 20)],
    },
    act: { counts: { 소고기구이: 8, 한우: 10, 등심: 6, 채끝: 3 }, blogTotal: 30 },
    rivals: [rival(1, '시험고기', ['마포한우', '마포등심']), rival(2, '시험소고기', ['마포한우', '마포갈비'])],
});
add({
    id: 'D06', label: '등록 키워드 7칸 모두 지역+같은 업종 낱말의 변형', aim: '표기만 다른 중복이 칸을 다 씀',
    p: {
        name: '모아치과', category: '치과', address: '서울 송파구 송파대로 100', jibun: '서울 송파구 가락동 100', keywords: ['송파치과', '송파구치과', '가락치과', '가락동치과', '송파임플란트', '송파교정', '송파치과의원'],
        menus: ['임플란트', '교정', '스케일링', '신경치료'], reviewMenus: [rv('임플란트', 100), rv('교정', 60), rv('스케일링', 40)],
    },
    act: { counts: { 치과: 12, 임플란트: 8 }, blogTotal: 30 },
});
add({
    id: 'D07', label: '상위 매장 키워드가 비어 있거나 모양이 이상함', aim: '누락·null 에도 예외 없이',
    p: {
        name: '라온피자', category: '피자', address: '서울 광진구 능동로 50', jibun: '서울 광진구 화양동 50', keywords: ['화양피자'],
        menus: ['페퍼로니피자', '콤비네이션피자', '고르곤졸라', '샐러드', '파스타'], reviewMenus: [rv('페퍼로니', 60), rv('고르곤졸라', 40)],
    },
    act: { counts: { 피자: 10 }, blogTotal: 25 },
    rivals: [rival(1, '시험A', undefined), rival(2, '시험B', [null, '', '화양피자']), { placeId: 'r3', name: null, keywords: ['건대피자', '건대피자세트'] }],
});
add({
    id: 'D08', label: '아파트 단지 상가(주소에 동이 두 번)', aim: '번지·상가명이 섞인 주소',
    p: {
        name: '미소반찬', category: '반찬가게', address: '경기 용인시 기흥구 마북동 123 롯데상가 101호', jibun: '경기 용인시 기흥구 마북동 123', keywords: ['마북동반찬', '용인반찬'],
        menus: ['장조림', '멸치볶음', '김치', '나물모듬', '계란말이'], reviewMenus: [rv('장조림', 60), rv('김치', 40), rv('반찬', 30)],
    },
    act: { counts: { 반찬가게: 8, 장조림: 4 }, blogTotal: 20 },
});
add({
    id: 'D09', label: '등록 키워드가 매장 이름 일부(상호+업종)', aim: '이름이 "행복한 미용실", 등록 "행복한미용실"',
    p: {
        name: '행복한 미용실', category: '미용실', address: '서울 관악구 관악로 100', jibun: '서울 관악구 봉천동 100', keywords: ['행복한미용실', '봉천동미용실', '관악커트'],
        styles: [st('커트', 100), st('펌', 80)], menus: [], reviewMenus: [rv('커트', 70), rv('매직', 40)],
    },
    act: { counts: { 미용실: 10, 커트: 5 }, blogTotal: 25 },
});
add({
    id: 'D10', label: '지점 이름이 두 낱말(○○ 강남 본점)', aim: '지점 이름 판정: 본점은 지점이 아님, "강남 본점"',
    p: {
        name: '맛나분식 강남 본점', category: '분식', address: '서울 강남구 테헤란로 100', jibun: '서울 강남구 역삼동 100', keywords: ['역삼분식', '강남떡볶이'],
        menus: ['떡볶이', '순대', '김밥', '튀김'], reviewMenus: [rv('떡볶이', 100), rv('순대', 60)],
    },
    act: { counts: { 분식: 8, 떡볶이: 6 }, blogTotal: 20 },
});
