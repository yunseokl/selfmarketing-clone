// 추천 키워드 — "지역 + 업종(메뉴·서비스)" 조합.
//
// 손님은 "청주약국", "오창약국"처럼 지역을 붙여 검색합니다. 그런데 스마트플레이스에는
// "일반의약품"처럼 지역이 없는 낱말만 등록한 매장이 많고, 그런 키워드는 순위를 조회해도
// 검색하는 사람의 위치에 따라 결과가 달라 의미가 없습니다.
// 여기서는 네트워크 요청 없이 이미 받은 매장 정보만으로 조합을 만들고, 근거를 함께 붙입니다.
//   - 지역: 주소(시·구·동·읍·면), 가까운 역, 매장명의 지점 이름, 사장님이 이미 등록 키워드에 쓴 지역
//   - 낱말: 업종, 등록한 대표키워드, 방문자 리뷰에 많이 나온 메뉴·시술, 예약 많은 스타일, 주간 인기 메뉴,
//           메뉴판·소식에 되풀이해 나오는 낱말(메뉴판 세 항목 이상, 또는 메뉴판과 소식에 함께 나오는 것),
//           업종별로 흔히 찾는 낱말(매장 정보에 근거가 있을 때만)
//   - 근거: 블로그 리뷰에 그 낱말이 들어간 글 수(activity.mentions), 상위 매장이 등록한 대표키워드(rivals),
//           이미 조회한 내 순위(ranks — 있을 때만)
// 근거가 없는 낱말("심야약국"인데 21시에 닫는 매장)은 추천하지 않습니다.
//
// 쓸모 관문 — 후보를 추천에 올리기 전에 한 번 더 거릅니다(아래 "쓸모 관문" 절). 걸러낸 것은 버리지 않고
// excluded 에 이유와 함께 돌려줍니다. 검색량 자료는 없으므로 "검색량이 적다" 같은 판단은 하지 않고,
// 가진 자료(업종·매장 이름·메뉴판·리뷰·결제·블로그 언급·소식·상위 매장 키워드·영업시간·내 순위)로 설명되는 기준만 씁니다.
// 계절(제철)은 자료가 없어 짐작하지 않습니다.
//   가. 다른 업종을 가리키는 낱말(김밥·보쌈·칼국수처럼 그 자체가 업종인 메뉴)은 내 매장의 주력이라는 근거가 있을 때만
//   나. 상위 매장에서 온 낱말도 내 매장 근거를 확인(업종 연관어의 조건 when·late·lunch 그대로)
//   다. 낱말 다듬기(괄호 덧말·띄어쓰기·매장 이름이 붙은 메뉴 이름), 술·음료·추가 메뉴·뜻이 넓은 낱말은 업종이 그것일 때만
//   라. 넓은 업종 이름(한식·양식…)은 "지역+한식"으로 추천하지 않음
//   마. 한쪽이 다른 쪽을 품는 메뉴 낱말(광어·광어회)은 하나로. 이유에 두 낱말의 리뷰·예약 수를 적음
//   바. 지역을 둘 이상 붙이는 것은 가장 중요한 낱말 하나뿐(등록한 조합 포함 3개), 나머지는 지역 하나.
//       그 조합을 그대로 등록한 상위 매장이 있으면 예외(그 조합 자체의 근거)
//   사. 블로그 언급을 물어봤는데 0개이고 다른 근거도 없는 낱말은 뺌
//   아. 먹고 마시는 업종의 "포장"·"배달"은 가게 종류도 메뉴도 찾는 자리(회식·모임)도 아닌 받는 방법이라 추천하지 않음
//       (꽃집의 "꽃배달"처럼 업종 연관어로 따로 정한 낱말은 그대로)
//   자. 메뉴 낱말은 매장의 주력 갈래에 맞을 때만(먹고 마시는 업종, 메뉴판을 읽었을 때).
//       주력 갈래는 업종·등록 키워드의 낱말·매장 이름에서 읽습니다: '○○집'은 앞말(횟집 → 회, 사이시옷을 뗌),
//       갈래 끝말(회·구이·조림…)로 끝나는 낱말은 그 끝말. 메뉴판에서 이름이 그 끝말로 끝나는 항목이 그 갈래의 메뉴입니다.
//       메뉴 낱말이 그 끝말로 끝나거나(숙성회) 그 갈래 메뉴의 이름에 들어 있으면(광어 → "대물 숙성회 정식(광어)") 통과,
//       아니면 곁들임으로 보고 '가'와 같은 주력 근거(업종·매장 이름·소개·대표 메뉴 표시·메뉴판 1/3)가 있을 때만 통과
//       (횟집의 갈치조림·볼락구이는 걸리고, 갈치조림집의 갈치·생선구이집의 볼락구이는 통과)
//   차. 약국의 약·제품 분류 이름(일반의약품·상비약·건강기능식품·동물의약품…)은 지역을 붙여 추천하지 않음.
//       손님이 검색할 때 쓰는 말(약국·영양제·동물약국)을 함께 알려 주고(into), 등록했으면 진단에 "다를 수 있다"고만 적음
//   카. 내 순위가 나쁜 지역에는 새 조합을 만들지 않고, 내 순위가 좋은 지역을 앞세움(ranks 를 받았을 때만, 아래 RANK_GOOD·RANK_WEAK)
// 걸러낸 것(excluded)의 이유 문장이 가리키는 키워드는 화면에 실제로 보이는 것이어야 합니다(최종 추천 items 안, 또는 이미 등록한 키워드).
//   · "지역만 바꾼 조합"(region) 줄은 남긴 조합이 화면에 보일 때만 냅니다. 남긴 조합이 추천 자리(limit) 밖으로 밀린 낱말은
//     걸러낸 것이 아니라 자리에 못 든 것이라 줄을 내지 않습니다. 문장은 "추천에 이미 있어"와 "이미 등록한 키워드라"를 가려 적습니다.
//   · into(묶인 낱말·대신 쓸 손님 말)는 그 낱말이 최종 추천이나 등록 키워드에 있을 때만 붙이고, 없으면 문장도 그에 맞게 적습니다.
//   · 한 낱말이 다른 낱말을 품고 이유가 낱말 이름만 빼고 같은 줄(갈치·갈치조림·순살갈치조림)은 한 줄로 묶습니다
//     (term 은 가장 짧은 낱말, keywords 는 낱말마다 조합 하나씩, 이유에는 묶인 낱말을 모두 적음).
// 알려진 한계: 여러 음식을 함께 파는 한식당의 칼국수·국밥은 메뉴판의 1/3에 못 미치면 '가'에 걸립니다. 그 메뉴로 이름난 집이어도
// 주력인지 가를 자료가 업종·매장 이름·대표 메뉴 표시·메뉴판 비중뿐이라서입니다(걸린 것은 excluded 에 이유와 함께 남습니다).
// '자'의 갈래 끝말은 아래 DISH_HEADS 목록에 있는 것만 알아봅니다(목록에 없는 갈래의 매장에는 '자'를 쓰지 않음).
// 메뉴판·소식 낱말은 시·도와 내 매장의 지역 이름만 지명으로 걸러 냅니다. 다른 지명("전주 비빔밥"의 "전주")이 메뉴판 세 항목 이상에
// 되풀이되면 후보가 될 수 있습니다(지명 목록이 없어서).
// 자동 순위 조회(pickRankKeywords)는 추천 가운데 근거가 "등록 키워드에 지역을 붙였다"(+블로그 언급)뿐인 조합을 다른 후보 뒤로 미룹니다.
// 자동 순위 조회는 순위를 조회하기 전에 고르므로 ranks 없이 만든 추천으로 고릅니다.

import { KEYWORD_MAX, KEYWORD_MAX_LEN, PROMO_WORDS } from './place-check.js';
import { rankLocality } from './naver-place.js';

export const RECOMMEND_LIMIT = 12;
export const RANK_KEYWORD_MAX = 5;

// 내 순위로 지역을 가르는 선(관문 '카'). 그 지역 이름이 들어간 키워드 가운데 순위를 조회한 것만 봅니다.
//   좋은 지역: 그 가운데 하나라도 10위 안. 혼잘마의 다른 화면과 같은 선입니다(순위 색 초록, AI 검색의 "10위 안 키워드",
//             "10위 안인 키워드는 바꾸지 마세요"). 좋은 지역은 순위 순으로 다른 지역보다 먼저 조합을 만듭니다.
//   나쁜 지역: 조회한 것이 모두 30위 밖·살펴본 범위 밖·목록에 없음이거나, 검색 결과가 내 매장에서 멀리 떨어진 곳(rankLocality 의 far).
//             30위는 혼잘마가 정한 판정선입니다. 손님이 검색 결과를 몇째까지 보는지에 대한 자료는 없어(검색량·클릭 자료 없음)
//             자료로 정한 값이 아니고, "그 지역 검색에서 내 앞에 29곳 넘게 있으면 같은 지역에 조합을 더 만들기보다
//             순위가 좋은 지역에 먼저 쓰는 편이 낫다"는 판단입니다. 10위 안(좋음)과 50위 밖(순위 색 주황) 사이에 둡니다.
//   그 밖(11~30위, 조회 안 함)은 원래 순서 그대로입니다.
export const RANK_GOOD = 10;
export const RANK_WEAK = 30;

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

// "한식·양식"처럼 범위가 넓은 업종 이름. "지역+한식"만으로는 어떤 매장을 찾는지 가려지지 않아 추천하지 않고, 블로그 언급 조회에서도 뺍니다.
const BROAD_CATEGORY = /^(한식|양식|일식|중식|분식|음식점|아시아음식|퓨전음식|종합|기타)$/;

const TERM = /^[가-힣a-z0-9]{2,8}$/;
const HANGUL_WORD = /^[가-힣a-z0-9]{2,7}$/;

// ── 쓸모 관문에 쓰는 낱말 목록 ──
// 그 자체가 업종 이름인 메뉴. 다른 음식점에서는 곁들임으로 흔히 팔아서, 이 말로 검색하는 손님은 그 메뉴를 전문으로 하는 가게를 찾습니다.
// [메뉴 낱말, 그 말로 찾는 가게]. 낱말이 이것으로 끝나면("소금김밥"·"바지락칼국수") 같은 것으로 봅니다. 긴 낱말을 먼저 적습니다(칼국수가 국수보다 먼저).
const SPECIALTY_DISHES = [
    ['칼국수', '칼국수집'], ['해장국', '해장국집'], ['햄버거', '햄버거 가게'], ['떡볶이', '떡볶이집'], ['돈가스', '돈가스집'],
    ['매운탕', '매운탕집'], ['짜장면', '중국집'], ['파스타', '파스타집'], ['샐러드', '샐러드 가게'],
    ['김밥', '김밥집'], ['만두', '만두집'], ['국수', '국숫집'], ['냉면', '냉면집'], ['라면', '라면집'], ['우동', '우동집'], ['순대', '순대 전문점'],
    ['보쌈', '보쌈집'], ['족발', '족발집'], ['치킨', '치킨집'], ['피자', '피자집'], ['초밥', '초밥집'], ['국밥', '국밥집'], ['짬뽕', '중국집'], ['버거', '햄버거 가게'],
];
// 업종 이름에 메뉴 낱말이 들어 있지 않아도 그 업종이 당연히 파는 메뉴(분식집의 김밥, 중식당의 짜장면)
const CATEGORY_DISHES = [
    [/분식/, ['김밥', '떡볶이', '순대', '만두', '라면', '우동', '돈가스', '국수']],
    [/중식|중국/, ['짜장면', '짬뽕', '만두']],
    [/양식|이탈리아|이태리|스파게티/, ['파스타', '피자', '샐러드']],
];
// 술·음료 이름(이것으로 끝나는 낱말 포함). 업종이나 매장 이름에 그 말이 있을 때만(와인바의 와인) 씁니다.
const DRINK_WORDS = ['생맥주', '음료수', '하이볼', '막걸리', '위스키', '칵테일', '샴페인', '사이다', '맥주', '소주', '와인', '사케', '음료', '콜라', '주류'];
// 추가 주문용 메뉴 이름
const EXTRA_MENU = /추가|리필|곱빼기|토핑|(사리|공기밥)$/;
// 뜻이 넓어 그 말만으로는 어떤 매장을 찾는지 가려지지 않는 낱말(통째로 같을 때만). 업종이나 매장 이름에 그 말이 있으면 씁니다.
const VAGUE_WORDS = ['생선', '튀김', '음식', '요리', '메뉴', '안주', '반찬', '식사', '고기', '해산물', '해물', '정식', '세트', '코스', '사이드', '구이', '볶음', '조림', '무침', '국물'];
// 받는 방법을 가리키는 낱말(통째로 같을 때만 — "꽃배달"·"포장마차"는 해당하지 않음). 먹고 마시는 업종에서는 "지역+포장"·"지역+배달"을 추천하지 않습니다.
const RECEIVE_WORDS = ['포장', '배달'];
// 먹고 마시는 업종 묶음끼리는 서로의 대표어("술집"·"카페")를 다른 업종 말로 보지 않습니다(횟집이 "술집"으로도 검색됨).
const FOOD_FAMILIES = ['cafe', 'bar', 'restaurant'];
const FAMILY_SHOP = { pharmacy: '약국', hair: '미용실', nail: '네일샵', flower: '꽃집', cafe: '카페', bar: '술집' };
// 메뉴판에서 이 비율 이상을 차지하면 주력 메뉴로 봅니다(34개 중 1~2개인 곁들임과, 메뉴판 대부분이 그 메뉴인 전문점을 가르는 선).
const MAIN_MENU_SHARE = 1 / 3;
// 메뉴판을 읽었다고 볼 최소 개수. 이보다 적으면 "메뉴판에서 차지하는 비중이 작다"고 말하지 않습니다.
const MENU_BOARD_MIN = 5;
// 자. 메뉴 갈래를 나타내는 끝말. 업종·등록 키워드의 낱말·매장 이름이 이것으로 끝나면 그 갈래가 주력입니다(생선구이 → 구이).
const DISH_HEADS = ['회', '구이', '조림', '찜', '탕', '전골', '국밥', '국수', '갈비', '곱창', '족발', '보쌈', '김밥', '초밥', '만두', '치킨', '피자'];
// 같은 갈래를 다른 말로 부르는 메뉴 이름(회 = 사시미)
const DISH_ALIASES = { 회: ['사시미'] };
// '○○집'인데 앞말이 메뉴 갈래가 아닌 것(맛집·밥집·술집)
const NOT_GENRE = ['맛', '밥', '술', '우리', '맛있는'];
// 메뉴판·소식에서 낱말을 셀 때 빼는, 메뉴 이름이 아니라 차림·안내를 말하는 낱말
const BOARD_NOTE = ['정식', '세트', '반반', '추가', '한정', '예약', '포장', '신메뉴', '대', '중', '소', '특', '인분', '코스', '입고', '안내',
    '오픈', '이벤트', '할인', '휴무', '공지', '변경', '시작', '마감', '판매', '메뉴', '출시', '소식', '오늘', '이번', '주말', '평일',
    '국내산', '국산', '수입산', '외국산', '자연산', '양식', '냉동', '생물', '특대', '대자', '중자', '소자', '단품', '세트메뉴', '곱빼기',
    '점심', '저녁', '런치', '디너', '사이즈'];
// 차. 약·제품을 나누는 분류 이름과, 손님이 검색할 때 대신 쓰는 말(약국에서만). 같은 뜻의 두 말은 손님 말 하나로 씁니다(동물의약품 → 동물약국).
const CLASS_NAMES = new Map([
    ['일반의약품', '약국'], ['전문의약품', '약국'], ['안전상비의약품', '약국'], ['상비의약품', '약국'], ['상비약', '약국'], ['의약외품', '약국'],
    ['건강기능식품', '영양제'], ['동물의약품', '동물약국'], ['동물용의약품', '동물약국'],
]);

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
    // 업종 연관어("대형약국"·"룸식당")도 끝말로 봅니다. 그러지 않으면 "청주대형약국"의 "청주대형"을 지역으로 잘못 읽습니다.
    const family = familyOf(place);
    const familyWords = [...(family?.base || []), ...(family?.related || []).map((item) => item.term), ...(family?.rankOnly || [])];
    const suffixes = uniqueBy([...COMMON_SUFFIXES, ...categoryLeaves(place), ...familyWords].map(compact), (v) => v)
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

// 메뉴·스타일 이름 다듬기: 괄호 속 덧말("(한정)"·"(100g)")과 띄어쓰기를 뺍니다. 키워드에는 띄어쓰기가 들어가지 않습니다.
function cleanName(name) {
    return String(name ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, '');
}

// 매장 이름이 앞에 붙은 메뉴 이름("대물섬"의 "대물볼락구이")에서 그 부분을 뗍니다.
// 매장 이름의 첫 낱말과 앞에서부터 겹치는 부분이 그 낱말 전체이거나 한 글자만 모자랄 때만 떼고("한우마을"의 "한우곰탕"은 그대로),
// 겹치는 부분이 손님이 리뷰에서 따로 말하는 메뉴 이름이면(said) 재료 이름으로 보고 떼지 않습니다.
function stripBrand(name, place, said) {
    const brand = compact(String(place?.name || '').trim().split(/\s+/)[0]);
    const key = compact(name);
    let same = 0;
    while (same < key.length && same < brand.length && key[same] === brand[same]) same += 1;
    if (same < 2 || brand.length - same > 1 || key.length - same < 2) return name;
    if (said.has(key.slice(0, same))) return name;
    return name.slice(same);
}

// 주간 인기 메뉴(결제 단말에 적힌 이름)를 키워드 낱말로 다듬은 것: 괄호 속 덧말·띄어쓰기를 빼고 앞에 붙은 매장 이름을 뗍니다.
// 그래프가 추천 이유 "주간 인기 메뉴"를 결제 메뉴와 이을 때도 같은 규칙을 씁니다("대물볼락구이" → "볼락구이").
export function popularMenuTerm(name, place) {
    const said = new Set(list(place?.reviewMenus).map((menu) => compact(menu.label)));
    return stripBrand(cleanName(name), place, said);
}

// 이름을 낱말로 나눕니다. 괄호 속 덧말("(한정)"·"(100g)")은 빼고, 띄어쓰기·기호로 가릅니다.
function wordsOf(name, { keepBrackets = false } = {}) {
    const text = keepBrackets ? String(name ?? '') : String(name ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
    return text.toLowerCase().split(/[^가-힣a-z0-9]+/).filter(Boolean);
}

// 매장 이름의 첫 낱말이거나 그것에서 한 글자 모자란 말("대물섬"의 "대물"). 메뉴판에 되풀이돼도 메뉴 이름이 아닙니다.
function isBrandWord(word, place) {
    const brand = compact(String(place?.name || '').trim().split(/\s+/)[0]);
    return word.length >= 2 && brand.startsWith(word) && brand.length - word.length <= 1;
}

// 메뉴판·소식에 되풀이해 나오는 낱말(리뷰 메뉴 상위 8개에 없어도 매장이 내세우는 메뉴: "대방어 정식"·"대방어 숙성회"·소식 "대방어 입고 안내").
//   메뉴판 세 항목 이상, 또는 메뉴판과 소식에 함께 나오는 낱말만 씁니다(두 항목에만 나오는 곁들임 "카르파쵸"는 뺌).
//   추가 주문용 항목("고노와다 추가")은 세지 않습니다.
//   한쪽이 다른 쪽을 품는 말(대방어·방어)은 메뉴판·소식·리뷰에서 그 말 그대로 쓰인 횟수가 많은 쪽을 고르고, 같으면 매장이 쓴 이름(메뉴판·소식)을 씁니다.
// 돌려주는 값: [{ term, menus(그 낱말이 든 메뉴 이름들), feeds(소식 제목들), uses(쓰인 횟수) }]
function boardTerms(place, activity) {
    const menus = uniqueBy(list(place?.detail?.menus).map((menu) => String(menu?.name || '').trim()).filter(Boolean), compact)
        .filter((name) => !EXTRA_MENU.test(compact(name)));
    const feeds = uniqueBy([activity?.feeds?.latestTitle, ...list(activity?.feeds?.titles)].map((title) => String(title || '').trim()).filter(Boolean), compact);
    if (menus.length === 0) return [];
    const reviewCount = new Map(list(place?.reviewMenus).map((menu) => [compact(cleanName(menu.label)), menu.count]));
    const menuWords = menus.map((name) => ({ name, words: wordsOf(name) }));
    const feedWords = feeds.map((title) => ({ title, words: wordsOf(title) }));
    const usesOf = (word) => menuWords.filter((entry) => entry.words.includes(word)).length
        + feedWords.filter((entry) => entry.words.includes(word)).length
        + (reviewCount.get(word) || 0);
    const words = uniqueBy(menuWords.flatMap((entry) => entry.words), (word) => word);
    // 시·도 이름과 내 매장의 지역 낱말("제주 흑돼지 …"의 "제주")은 메뉴 이름이 아닙니다.
    const places = new Set(regionTerms(place).flatMap((region) => region.variants));
    const found = [];
    for (const word of words) {
        if (!/^[가-힣]{2,8}$/.test(word) || BOARD_NOTE.includes(word) || VAGUE_WORDS.includes(word) || isBrandWord(word, place)) continue;
        if (sidoOf(word) || places.has(word)) continue;
        const inMenus = menuWords.filter((entry) => entry.words.includes(word));
        const inFeeds = feedWords.filter((entry) => entry.words.includes(word));
        if (!(inMenus.length >= 3 || (inMenus.length >= 1 && inFeeds.length >= 1))) continue;
        // 품는 말·품기는 말 가운데 그 말 그대로 더 많이 쓰인 쪽(같으면 매장이 쓴 이름)
        const others = [...reviewCount.keys()].filter((other) => other !== word && other.length >= 2 && (other.includes(word) || word.includes(other)));
        const own = usesOf(word);
        const better = others.map((other) => ({ other, uses: usesOf(other) })).filter((entry) => entry.uses > own).sort((a, b) => b.uses - a.uses)[0];
        found.push({
            term: better ? better.other : word,
            menus: inMenus.map((entry) => entry.name),
            feeds: inFeeds.map((entry) => entry.title),
            uses: better ? better.uses : own,
        });
    }
    return found;
}

// 업종 연관어(FAMILIES.related)의 근거를 찾습니다.
//   owner: false 면 사장님이 등록한 키워드는 근거로 치지 않습니다(등록 키워드 자신을 진단할 때).
// 돌려주는 값: { hit(근거가 된 매장 정보), reason(화면에 보여 줄 근거), ok(추천해도 되는지) }
function relatedSupport(related, { place, sources, blog, owner = true }) {
    const key = compact(related.term);
    const usable = owner ? sources : sources.filter((source) => !source.keyword);
    const hit = usable.find((source) => sourceHas(source, key, { isTerm: true }) || related.when.some((word) => sourceHas(source, word)));
    let reason = hit ? { kind: 'fact', text: hit.label } : null;
    if (!reason && related.late && opensLate(place?.detail?.hours, related.late)) reason = { kind: 'fact', text: `${related.late}시 이후까지 영업` };
    if (!reason && related.lunch && opensLunch(place)) reason = { kind: 'fact', text: '점심 시간 영업' };
    // 근거가 없으면 추천하지 않습니다(블로그에 한 번이라도 나오면 근거로 인정).
    return { hit: hit || null, reason, ok: Boolean(reason) || blog > 0 };
}

// 낱말 후보. source: category(업종) · family(업종 대표어) · registered(등록 키워드) · style(예약 스타일) ·
// review(리뷰 언급) · pos(주간 인기 메뉴) · related(업종 연관어) · rankOnly(순위 확인용)
// said 는 손님이 그 낱말을 말한 횟수(리뷰 언급·예약 수), owned 는 사장님이 등록 키워드에 쓴 낱말이라는 표시입니다.
// 여기서는 후보를 모으기만 하고, 추천에 올릴지는 쓸모 관문(gateTerms)이 정합니다.
function collectTerms(place, activity, regions) {
    const terms = new Map();
    const add = (term, source, weight, reason, extra = {}) => {
        const key = compact(term);
        if (!key || key.length < 2) return;
        const found = terms.get(key);
        if (found) {
            if (weight > found.weight) Object.assign(found, { source, weight });
            Object.assign(found, extra, extra.said ? { said: Math.max(found.said || 0, extra.said) } : {});
            if (reason && !found.reasons.some((r) => r.text === reason.text || (r.kind === 'category' && reason.kind === 'category'))) found.reasons.push(reason);
            return;
        }
        terms.set(key, { term: String(term).replace(/\s+/g, ''), key, source, weight, reasons: reason ? [reason] : [], registrable: true, ...extra });
    };

    const family = familyOf(place);
    for (const leaf of categoryLeaves(place)) add(leaf, 'category', BROAD_CATEGORY.test(leaf) ? 30 : 60, { kind: 'category', text: '업종' });
    for (const base of family?.base || []) add(base, 'family', 56, { kind: 'category', text: '업종 대표어' });

    for (const keyword of list(place?.keywords)) {
        const core = keywordCore(keyword, regions);
        if (core.length >= 2 && core.length <= 10) add(core, 'registered', 50, { kind: 'registered', text: '등록 키워드' }, { owned: true });
    }

    const styles = list(place?.detail?.styles).map((style) => ({ ...style, name: cleanName(style.name) })).filter((style) => TERM.test(compact(style.name))).slice(0, 5);
    const styleMax = Math.max(1, ...styles.map((style) => style.count));
    for (const style of styles) {
        add(style.name, 'style', 34 + Math.round((14 * style.count) / styleMax), { kind: 'booking', text: `예약 ${style.count.toLocaleString('ko-KR')}건` }, { said: style.count });
    }

    const reviewed = list(place?.reviewMenus).map((menu) => ({ ...menu, label: cleanName(menu.label) })).filter((menu) => TERM.test(compact(menu.label))).slice(0, 8);
    const reviewMax = Math.max(1, ...reviewed.map((menu) => menu.count));
    for (const menu of reviewed) {
        add(menu.label, 'review', 30 + Math.round((18 * menu.count) / reviewMax), { kind: 'review', text: `리뷰 ${menu.count.toLocaleString('ko-KR')}회` }, { said: menu.count });
    }

    // 주간 인기 메뉴는 결제 단말에 적힌 이름 그대로라, 괄호·띄어쓰기와 앞에 붙은 매장 이름을 다듬어 씁니다.
    const popular = list(place?.detail?.pos?.popularMenus)
        .map((item) => popularMenuTerm(item.name, place))
        .filter((name) => TERM.test(compact(name)))
        .slice(0, 3);
    for (const name of popular) add(name, 'pos', 30, { kind: 'pos', text: '주간 인기 메뉴' });

    // 메뉴판·소식에 되풀이해 나오는 낱말. 이미 후보인 낱말은 그대로 둡니다(근거를 덧붙이지 않음).
    // 근거는 그 낱말이 든 메뉴 이름(2개까지)과 소식 제목입니다. 계절은 짐작하지 않습니다.
    for (const entry of boardTerms(place, activity)) {
        const key = compact(entry.term);
        if (terms.has(key) || !TERM.test(key)) continue;
        const [first, ...rest] = [
            ...entry.menus.slice(0, 2).map((name) => ({ kind: 'fact', text: `메뉴 '${name}'` })),
            ...entry.feeds.slice(0, 1).map((title) => ({ kind: 'feed', text: `소식 '${title}'` })),
        ];
        add(entry.term, 'board', 30 + Math.min(10, 2 * entry.uses), first, { said: entry.uses });
        terms.get(key).reasons.push(...rest);
    }

    const mentions = mentionMap(activity);
    const sources = evidenceSources(place, activity);
    for (const related of family?.related || []) {
        const key = compact(related.term);
        const { hit, reason, ok } = relatedSupport(related, { place, sources, blog: mentions.get(key) });
        if (!ok) continue;
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
// 쓸모 관문에서 걸러질 낱말(횟집의 "김밥")은 묻지 않습니다. 사장님이 등록한 키워드의 낱말은 진단에 쓰므로 그대로 묻습니다.
export function mentionTerms(place, max = 8) {
    const regions = regionTerms(place);
    const family = familyOf(place);
    const terms = collectTerms(place, null, regions);
    const { passed } = gateTerms(gateContext(place, null, regions), terms);
    const pick = (source, count) => [...terms.values()]
        .filter((term) => term.source === source && (term.owned || passed.has(term.key)))
        .slice(0, count).map((term) => term.term);
    const related = (family?.related || []).map((item) => item.term);
    const withEvidence = related.filter((term) => passed.has(compact(term)));
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
// 쓸모 관문 — 후보 낱말을 추천에 올리기 전에 거릅니다. 걸러낸 이유는 사장님이 읽을 한 문장으로 적습니다.
// ---------------------------------------------------------------------------

// 받침에 따른 조사: p('약국', '은', '는') → '은'
function p(word, withBatchim, withoutBatchim) {
    const code = String(word ?? '').trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(code >= 0 && code <= 11171)) return withBatchim;
    return code % 28 === 0 ? withoutBatchim : withBatchim;
}

// '(으)로': 받침이 없거나 ㄹ 받침이면 '로'
function ro(word) {
    const code = String(word ?? '').trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(code >= 0 && code <= 11171)) return '으로';
    return code % 28 === 0 || code % 28 === 8 ? '로' : '으로';
}

// 이유 문장에 낱말 이름을 적는 꼴: 갈치 → '갈치'
function quoted(word) {
    return `'${word}'`;
}

// 1260 → '밤 9시', 1170 → '저녁 7시 30분'
function clockLabel(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    const period = hour < 6 ? '새벽' : hour < 12 ? '오전' : hour === 12 ? '낮' : hour < 18 ? '오후' : hour < 21 ? '저녁' : '밤';
    return `${period} ${hour % 12 === 0 ? 12 : hour % 12}시${minute ? ` ${minute}분` : ''}`;
}

const DISHES_LONGEST_FIRST = [...SPECIALTY_DISHES].sort((a, b) => b[0].length - a[0].length);
const DRINKS_LONGEST_FIRST = [...DRINK_WORDS].sort((a, b) => b.length - a.length);
// 메뉴판·리뷰·결제에서 온 낱말(서로 겹치면 하나로 묶는 대상). 업종·등록 키워드·업종 연관어는 일부러 고른 낱말이라 묶지 않습니다.
const MENU_SOURCES = ['review', 'pos', 'style', 'rival', 'board'];
// 자. 주력 갈래에 맞는지 보는 낱말의 출처(손님 말·결제·메뉴판에서 온 메뉴 낱말)
const GENRE_SOURCES = ['review', 'pos', 'board'];

// 받침 ㅅ(사이시옷)을 뗀 글자: '횟' → '회', '깃' → '기', '숫' → '수'
function dropSaisiot(char) {
    const code = char.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171 || code % 28 !== 19) return char;
    return String.fromCharCode(char.charCodeAt(0) - 19);
}

// 낱말이 갈래 끝말을 가졌는지(숙성회 → 회, 무늬오징어사시미 → 회의 다른 이름 사시미)
function hasMark(word, marks) {
    return marks.some((mark) => [mark, ...(DISH_ALIASES[mark] || [])].some((form) => word === form || word.endsWith(form)));
}

// 자. 매장의 주력 갈래. 먹고 마시는 업종이고 메뉴판을 읽었을 때만 읽습니다.
//   어디서 읽나: 업종 이름 → 등록 키워드의 낱말 → 매장 이름 차례. '○○집'이면 앞말(횟집 → 회), 갈래 끝말로 끝나면 그 끝말(생선구이 → 구이).
//   그 갈래의 메뉴: 메뉴판 항목 가운데 이름의 한 낱말이 그 끝말로 끝나는 것("대물 숙성회 정식(광어)"의 "숙성회").
// 돌려주는 값: { marks, label(화면에 쓸 갈래 이름), from(어디서 읽었는지), fromWord, items(그 갈래 메뉴의 compact 이름), total(메뉴판 수) } 또는 null
function mainGenre(place, regions, menus, family) {
    if (!FOOD_FAMILIES.includes(family?.key) || menus.length < MENU_BOARD_MIN) return null;
    const found = [];
    const read = (word, from, fromWord = word) => {
        const key = compact(word);
        if (key.length < 2) return;
        const shop = key.match(/^(.+)집$/);
        if (shop) {
            const head = shop[1].slice(0, -1) + dropSaisiot(shop[1].slice(-1));
            if (!NOT_GENRE.includes(head)) found.push({ mark: head, from, fromWord });
            return;
        }
        const head = [...DISH_HEADS].sort((a, b) => b.length - a.length).find((item) => key.endsWith(item));
        if (head) found.push({ mark: head, from, fromWord });
    };
    for (const leaf of categoryLeaves(place)) if (!BROAD_CATEGORY.test(leaf)) read(leaf, `업종 '${leaf}'`);
    for (const keyword of list(place?.keywords)) {
        const core = keywordCore(keyword, regions);
        if (core) read(core, `등록 키워드의 '${core}'`);
    }
    for (const word of String(place?.name || '').trim().split(/\s+/)) read(word, `매장 이름 '${place.name}'`, place.name);
    const marks = uniqueBy(found.map((entry) => entry.mark), (mark) => mark);
    if (marks.length === 0) return null;
    const items = menus.filter((menu) => wordsOf(menu.name, { keepBrackets: true }).some((word) => hasMark(word, marks))).map((menu) => menu.key);
    if (items.length === 0) return null;
    return { marks, label: marks.join('·'), from: found[0].from, fromWord: found[0].fromWord, items, total: menus.length };
}

// 관문이 보는 매장 자료 묶음
function gateContext(place, activity, regions) {
    const menus = uniqueBy(
        list(place?.detail?.menus).map((menu) => ({ name: String(menu.name ?? ''), key: compact(menu.name), recommended: menu.recommended === true })).filter((menu) => menu.key),
        (menu) => menu.key,
    );
    const family = familyOf(place);
    return {
        place,
        family,
        leaves: categoryLeaves(place).map(compact),
        nameKey: compact(place?.name),
        intro: compact(place?.intro),
        menus,
        genre: mainGenre(place, regions, menus, family),
        hours: place?.detail?.hours || null,
        sources: evidenceSources(place, activity),
        mentions: mentionMap(activity),
        blogTotal: activity?.mentions?.blogTotal ?? null,
        // 관문을 통과한 등록 키워드의 낱말. 다른 낱말("소금김밥")의 주력 근거가 됩니다.
        trusted: [],
        // 후보 낱말 전체(gateTerms 가 채움). 분류 이름을 손님 말로 바꿔 줄 때 그 말이 후보에 있는지 봅니다.
        candidates: new Map(),
    };
}

// 차. 분류 이름 대신 손님이 쓰는 말: 그 말이 후보(근거가 있는 업종 연관어)에 있으면 그것, 없으면 업종 대표어 '약국'
function spokenFor(ctx, key) {
    const spoken = CLASS_NAMES.get(key);
    if (!spoken) return null;
    return ctx.candidates.has(compact(spoken)) ? spoken : (ctx.family?.base?.[0] || spoken);
}

// 그 낱말이 내 매장의 주력이라는 근거가 있는지: 업종 이름 · 매장 이름 · 한 줄 소개 · 대표 메뉴 표시 · 메뉴판에서 차지하는 비중
//   owner: true 면 관문을 통과한 등록 키워드(사장님이 고른 낱말)도 근거로 칩니다.
function isMainOffering(ctx, word, { owner = true } = {}) {
    if (ctx.leaves.some((leaf) => leaf.includes(word))) return true;
    if (CATEGORY_DISHES.some(([match, dishes]) => dishes.includes(word) && ctx.leaves.some((leaf) => match.test(leaf)))) return true;
    if (ctx.nameKey.includes(word) || ctx.intro.includes(word)) return true;
    if (ctx.menus.some((menu) => menu.recommended && menu.key.includes(word))) return true;
    const hits = ctx.menus.filter((menu) => menu.key.includes(word)).length;
    if (hits > 0 && hits >= ctx.menus.length * MAIN_MENU_SHARE) return true;
    return owner && ctx.trusted.some((core) => core.includes(word));
}

// 다른 업종을 가리키는 낱말인지: [그 낱말, 그 말로 찾는 가게, 메뉴 이름인지]
function otherBusinessOf(ctx, key) {
    const dish = DISHES_LONGEST_FIRST.find(([word]) => key.endsWith(word));
    if (dish) return [dish[0], dish[1], true];
    const mine = ctx.family?.key;
    for (const family of FAMILIES) {
        if (family.key === mine || (FOOD_FAMILIES.includes(family.key) && FOOD_FAMILIES.includes(mine))) continue;
        const base = family.base.map(compact).find((word) => key.endsWith(word));
        if (base) return [base, FAMILY_SHOP[family.key] || base, false];
    }
    return null;
}

// 업종 연관어의 시간 조건이 영업시간과 어긋날 때의 설명("밤 9시에 닫아 '심야약국'으로는 맞지 않습니다"). 어긋나지 않거나 영업시간을 모르면 null.
// 돌려주는 값은 이유 문장을 만드는 함수(termVerdict 의 tell 과 같은 꼴)입니다.
function hoursMismatch(ctx, related) {
    const closing = list(ctx.hours?.days)
        .map((day) => [clockMinutes(day.start), clockMinutes(day.end)])
        .filter(([start, end]) => start !== null && end !== null)
        .map(([start, end]) => (end <= start ? end + 24 * 60 : end));
    if (closing.length === 0) return null;
    if (related.late && !opensLate(ctx.hours, related.late)) return (names, last) => `${clockLabel(Math.max(...closing))}에 닫아 ${names.join('·')}${ro(last)}는 맞지 않습니다.`;
    if (related.lunch && !opensLunch(ctx.place)) return (names, last) => `점심 시간(12~14시)에 열지 않아 ${names.join('·')}${ro(last)}는 맞지 않습니다.`;
    return null;
}

// 낱말 하나가 관문을 통과하는지. 통과하면 null, 걸리면 { rule, reason, label, tell, into? }.
// 사장님이 등록 키워드에 쓴 낱말(owned)은 사장님의 선택이므로 "근거를 못 찾았다"만으로는 걸지 않고,
// 읽은 자료가 그 선택과 어긋날 때만 겁니다(읽어 온 메뉴 34개 중 1개, 밤 9시에 닫는 심야약국, 블로그 후기 0개).
// 메뉴 개수는 "메뉴판 34개"처럼 전체라고 단정하지 않고 "읽어 온 메뉴 34개"라고 적습니다(읽어 온 목록이 등록된 메뉴의 일부일 수 있음).
// 이유 문장은 tell(names, last, into) 로 만듭니다: names 는 따옴표를 붙인 낱말 이름들, last 는 조사를 정할 마지막 낱말,
// into 는 화면에 보이는 '대신 쓸 말'(없으면 null)입니다. 같은 이유로 걸린 겹치는 낱말(갈치·갈치조림)을 한 줄로 묶을 때
// 같은 tell 에 이름을 모아 넣습니다(recommendKeywords 의 excluded 조립). label 은 이 낱말을 문장에 적는 꼴입니다.
function termVerdict(ctx, term) {
    const { key, source } = term;
    const word = term.term;
    const verdict = (rule, tell, extra = {}) => ({ rule, reason: tell([quoted(word)], word, extra.into ?? null), label: quoted(word), tell, ...extra });
    if (source === 'rankOnly') return null;
    // 라. 넓은 업종 이름
    if (BROAD_CATEGORY.test(key)) {
        return verdict('broad', (names, last) => `${names.join('·')}${p(last, '은', '는')} 범위가 넓은 업종 이름이라, 지역을 붙여도 어떤 매장을 찾는 말인지 가려지지 않습니다.`);
    }
    // 업종·업종 대표어는 매장이 무엇인지 말하는 낱말이라 그대로 씁니다.
    if (source === 'category' || source === 'family') return null;
    // 차. 약·제품 분류 이름: 사장님이 등록한 낱말이어도 같은 이유를 답니다(단정하지 않고 "다를 수 있다"). into 는 대신 쓸 손님 말입니다.
    if (ctx.family?.key === 'pharmacy' && CLASS_NAMES.has(key)) {
        return verdict(
            'classification',
            (names, last, into) => `${names.join('·')}${p(last, '은', '는')} 약·제품을 나누는 분류 이름이라, 손님이 검색할 때 쓰는 ${into ? `말(${quoted(into)})` : '말'}과 다를 수 있습니다.`,
            { into: spokenFor(ctx, key) },
        );
    }
    // 아. 먹고 마시는 업종의 "포장"·"배달": 매장에 그 사실이 있어도(편의시설 '포장') 가게를 찾는 말로는 권하지 않습니다.
    if (RECEIVE_WORDS.includes(key) && FOOD_FAMILIES.includes(ctx.family?.key)) {
        return verdict('channel', (names, last) => `${names.join('·')}${p(last, '은', '는')} 가게 종류나 메뉴가 아니라 받는 방법이라, 이 말만으로는 어떤 가게를 찾는지 알 수 없습니다.`);
    }
    const owned = term.owned === true;

    // 업종 연관어(related)는 collectTerms 에서 매장 정보의 근거를 확인한 낱말이라 다·가 를 다시 보지 않습니다.
    if (source !== 'related') {
        // 다. 추가 주문용 메뉴 · 뜻이 넓은 낱말 · 술·음료
        if (!owned && EXTRA_MENU.test(key)) return verdict('extra', () => '추가 주문용 메뉴 이름이라 매장을 찾는 말로는 맞지 않습니다.');
        // 뜻이 넓은 낱말은 업종 이름이 바로 그 말이거나("튀김") 매장 이름에 들어 있을 때만 씁니다("생선회"의 "생선"은 해당하지 않음).
        if (VAGUE_WORDS.includes(key) && !ctx.leaves.includes(key) && !ctx.nameKey.includes(key)) {
            return verdict('vague', (names, last) => `${names.join('·')}${p(last, '은', '는')} 뜻이 넓어, 이 말만으로는 어떤 매장을 찾는지 가려지지 않습니다.`);
        }
        // 술·음료 이름은 업종이나 매장 이름에 그 말이 있을 때만 씁니다("와인바"의 "와인").
        const drink = DRINKS_LONGEST_FIRST.find((text) => key.endsWith(text));
        if (drink && !ctx.leaves.some((leaf) => leaf.includes(drink)) && !ctx.nameKey.includes(drink)) {
            return verdict('drink', (names, last) => `술·음료 이름이라, ${names.join('·')}${ro(last)} 검색하는 손님은 그것을 주로 파는 곳을 찾습니다.`);
        }
        // 가. 다른 업종을 가리키는 낱말: 내 매장의 주력이라는 근거가 있을 때만
        const other = otherBusinessOf(ctx, key);
        if (other && !isMainOffering(ctx, other[0], { owner: !owned })) {
            const [head, shop, isDish] = other;
            const boardKnown = ctx.menus.length >= MENU_BOARD_MIN;
            const seeks = (names, last) => `${names.join('·')}${ro(last)} 검색하는 손님은 ${shop}${p(shop, '을', '를')} 찾습니다.`;
            if (!isDish) {
                if (!owned) return verdict('otherBusiness', (names, last) => `${names.join('·')}${p(last, '은', '는')} ${shop}${p(shop, '을', '를')} 찾는 말인데, 업종·매장 이름에서 그 근거를 찾지 못했습니다.`);
            } else if (boardKnown) {
                const hits = ctx.menus.filter((menu) => menu.key.includes(head)).length;
                return verdict('otherBusiness', (names, last) => (hits > 0
                    ? `읽어 온 메뉴 ${ctx.menus.length}개 중 ${hits}개뿐이라 주력 메뉴로 보기 어렵고, ${seeks(names, last)}`
                    : `읽어 온 메뉴 ${ctx.menus.length}개에 없는 메뉴이고, ${seeks(names, last)}`));
            } else if (!owned) {
                return verdict('otherBusiness', (names, last) => `업종·매장 이름·메뉴판에서 주력 메뉴라는 근거를 찾지 못했고, ${seeks(names, last)}`);
            }
        }
        // 자. 메뉴 낱말은 매장의 주력 갈래에 맞을 때만: 갈래 끝말로 끝나거나 그 갈래 메뉴의 이름에 들어 있으면 통과,
        // 아니면 곁들임으로 보고 주력 근거(업종·매장 이름·소개·대표 메뉴 표시·메뉴판 비중·등록 키워드)가 있을 때만 통과합니다.
        const genre = ctx.genre;
        if (genre && !owned && GENRE_SOURCES.includes(source) && !hasMark(key, genre.marks)
            && !genre.items.some((item) => item.includes(key)) && !isMainOffering(ctx, key)) {
            const others = ctx.menus.filter((menu) => menu.key.includes(key)).length;
            const where = `${genre.from}${ro(genre.fromWord)} 보면 이 매장의 주력은 ${genre.label} 메뉴(읽어 온 메뉴 ${genre.total}개 중 ${genre.items.length}개)인데`;
            return verdict('offMain', (names, last) => (others > 0
                ? `${where}, ${names.join('·')}${p(last, '은', '는')} ${genre.label} 메뉴가 아닌 메뉴 ${others}개에만 나오는 곁들임이라 따로 권하지 않습니다.`
                : `${where}, ${names.join('·')}${p(last, '은', '는')} ${genre.label} 메뉴에 들어 있지 않은 곁들임이라 따로 권하지 않습니다.`));
        }
    }

    // 나. 업종 연관어의 조건(when·late·lunch)은 상위 매장에서 온 낱말에도, 사장님이 등록한 낱말에도 그대로 씁니다.
    const related = (ctx.family?.related || []).find((item) => compact(item.term) === key);
    if (related && (owned || source === 'rival')) {
        const support = relatedSupport(related, { place: ctx.place, sources: ctx.sources, blog: ctx.mentions.get(key), owner: false });
        if (!support.ok) {
            const mismatch = hoursMismatch(ctx, related);
            if (mismatch) return verdict('condition', mismatch);
            if (!owned) {
                return verdict('condition', (names) => `상위 매장 ${term.rivals}곳이 쓰는 말이지만, 내 매장의 리뷰·편의시설·영업시간에서는 ${names.join('·')}의 근거를 찾지 못했습니다.`);
            }
        }
    } else if (source === 'rival') {
        // 상위 매장이 쓰는 낱말이라도 내 매장 정보에 그 말이 있어야 권합니다.
        const hit = ctx.sources.find((entry) => sourceHas(entry, key, { isTerm: true }));
        if (!hit && !(ctx.mentions.get(key) > 0)) {
            return verdict('rivalOnly', (names, last) => `상위 매장 ${term.rivals}곳이 쓰는 말이지만, 내 매장의 리뷰·메뉴·소개에서는 ${names.join('·')}${p(last, '을', '를')} 찾지 못했습니다.`);
        }
        if (hit && !term.reasons.some((reason) => reason.kind === 'fact')) term.reasons.unshift({ kind: 'fact', text: hit.label });
    }

    // 사. 블로그 언급을 물어봤는데 0개이고, 손님 말(리뷰·예약·결제)·매장 사실·상위 매장 어디에도 근거가 없는 낱말
    if (term.blog === 0) {
        const backed = term.reasons.some((reason) => ['review', 'booking', 'pos'].includes(reason.kind))
            || (term.reasons.some((reason) => reason.kind === 'fact') && !term.fromKeyword)
            || term.rivals > 0;
        if (!backed) {
            return verdict('noBlog', (names, last) => {
                const where = ctx.blogTotal > 0 ? `블로그 후기 ${ctx.blogTotal}개 가운데 ${names.join('·')}${p(last, '이', '가')} 나온 글이 없고` : `블로그 후기에서 ${names.join('·')}${p(last, '이', '가')} 나온 글을 찾지 못했고`;
                return `${where}, 리뷰·예약·상위 매장에서도 쓰이지 않습니다.`;
            });
        }
    }
    return null;
}

// 마. 한쪽이 다른 쪽을 품는 메뉴 낱말("광어"·"광어회", "댄디컷"·"시스루댄디컷")은 하나로 묶습니다.
//   둘 다 메뉴 낱말이면 손님이 더 많이 말한 쪽(같으면 짧은 쪽)을 남깁니다.
//   긴 쪽만 메뉴 낱말이면(등록 키워드 "댄디컷" + 예약 스타일 "시스루댄디컷") 긴 쪽을 짧은 쪽으로 묶습니다.
//   짧은 쪽만 메뉴 낱말이면(업종 "와인바" + 리뷰 "와인") 서로 다른 말로 보고 둘 다 둡니다.
// 남긴 낱말의 merged 에 묶인 이름을 적습니다.
function foldContained(passed) {
    const folded = [];
    const isMenuWord = (term) => MENU_SOURCES.includes(term.source) && !term.owned;
    const findPair = () => {
        const alive = [...passed.values()].filter((term) => term.source !== 'rankOnly');
        for (const longer of alive) {
            if (!isMenuWord(longer)) continue;
            for (const shorter of alive) {
                if (longer.key.length <= shorter.key.length || !longer.key.includes(shorter.key)) continue;
                const loser = isMenuWord(shorter) && (longer.said || 0) > (shorter.said || 0) ? shorter : longer;
                return [loser, loser === longer ? shorter : longer];
            }
        }
        return null;
    };
    // 이유에는 두 낱말을 손님이 말한 수(리뷰·예약)를 적어, 왜 그쪽으로 묶였는지 읽히게 합니다.
    const tagOf = (term) => {
        const counts = term.reasons.filter((reason) => reason.kind === 'review' || reason.kind === 'booking').map((reason) => reason.text);
        return `'${term.term}'${counts.length ? `(${counts.join('·')})` : ''}`;
    };
    for (let pair = findPair(); pair; pair = findPair()) {
        const [loser, winner] = pair;
        passed.delete(loser.key);
        winner.merged = [...(winner.merged || []), loser.term, ...(loser.merged || [])];
        const keep = winner.owned ? `등록 키워드인 '${winner.term}'`
            : (winner.said || 0) > (loser.said || 0) ? `손님이 더 많이 말한 '${winner.term}'` : `'${winner.term}'`;
        const relation = loser.key.length > winner.key.length
            ? `${tagOf(winner)}${p(winner.term, '이', '가')} 들어 있는 말이라`
            : `${tagOf(winner)}에 들어 있는 말이라`;
        // 남긴 낱말이 화면에 보이면(into) "하나로 묶었다"고 적고, 추천 자리에 들지 못해 안 보이면 그 사실을 적습니다.
        const tell = (names, last, into) => (into
            ? `${names.join('·')}${p(last, '은', '는')} ${relation}, ${keep} 하나로 묶었습니다.`
            : `${names.join('·')}${p(last, '은', '는')} ${relation} ${quoted(winner.term)}${p(winner.term, '과', '와')} 한 낱말로 보았는데, ${quoted(winner.term)}도 추천 목록에는 없습니다.`);
        const label = tagOf(loser);
        folded.push({ term: loser, rule: 'merged', into: winner.term, label, tell, reason: tell([label], loser.term, winner.term) });
    }
    return folded;
}

// 후보 낱말 전체를 관문에 통과시킵니다. { passed: Map(통과한 낱말), excluded: [{ term(낱말 객체), rule, reason, label, tell, into? }] }
function gateTerms(ctx, terms) {
    ctx.trusted = [];
    ctx.candidates = terms;
    const verdicts = new Map();
    // 사장님이 등록한 낱말을 먼저 봅니다(통과한 것은 다른 낱말의 주력 근거가 됩니다).
    for (const term of terms.values()) {
        if (!term.owned) continue;
        const verdict = termVerdict(ctx, term);
        verdicts.set(term.key, verdict);
        if (!verdict) ctx.trusted.push(term.key);
    }
    const passed = new Map();
    const excluded = [];
    for (const term of terms.values()) {
        const verdict = term.owned ? verdicts.get(term.key) : termVerdict(ctx, term);
        if (verdict) excluded.push({ term, ...verdict });
        else passed.set(term.key, term);
    }
    excluded.push(...foldContained(passed));
    return { passed, excluded };
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

// 카. 지역마다 내 순위: 그 지역 이름이 들어간 키워드 가운데 순위 조회가 끝난 것만 봅니다.
// 돌려주는 값: Map(지역 이름 → { rows: [{ keyword, text, weak }], best: { keyword, rank } | null, good, weak })
function regionStanding(regions, ranks, coordinate) {
    const standing = new Map();
    for (const row of list(ranks)) {
        if (row?.state !== 'done' || !row.result) continue;
        const matched = matchRegion(row.keyword, regions);
        if (!matched) continue;
        const { result } = row;
        const far = rankLocality(result, coordinate)?.scope === 'far';
        const rank = result.status === 'found' && Number.isFinite(result.rank) ? result.rank : null;
        const text = far ? '먼 지역 결과'
            : rank !== null ? `${rank}위`
                : result.status === 'beyond' && Number.isFinite(result.scanned) ? `${result.scanned.toLocaleString('ko-KR')}위 밖` : '목록에 없음';
        const entry = standing.get(matched.region.term) || { rows: [], best: null };
        entry.rows.push({ keyword: String(row.keyword).trim(), text, weak: far || rank === null || rank > RANK_WEAK });
        if (!far && rank !== null && (!entry.best || rank < entry.best.rank)) entry.best = { keyword: String(row.keyword).trim(), rank };
        standing.set(matched.region.term, entry);
    }
    for (const entry of standing.values()) {
        entry.weak = entry.rows.every((row) => row.weak);
        entry.good = Boolean(entry.best && entry.best.rank <= RANK_GOOD);
    }
    return standing;
}

// 매장 1곳의 추천 키워드와 등록 키워드 진단.
//   place, activity: 분석 결과 / rivals: [{ placeId, name, keywords }] (상위 매장 대표키워드, 없으면 생략)
//   ranks: 이미 조회한 순위([{ keyword, state, result }], 화면의 순위 표 줄과 같은 모양 — 없으면 생략).
//          주면 내 순위가 좋은 지역의 조합을 먼저 만들고, 내 순위가 나쁜 지역에는 새 조합을 만들지 않습니다(관문 '카').
// 돌려주는 값
//   regions    지역 낱말(주소·등록 키워드로 정한 순서. 순위로 바꾼 순서는 추천 조합에만 씁니다)
//   items      추천 키워드(점수 순, 쓸모 관문을 통과한 것만). registrable=false 는 순위 확인용, merged 는 하나로 묶인 다른 이름
//   excluded   관문에서 걸러낸 것 [{ term, keywords(만들어졌을 조합), rule, reason(사장님이 읽을 한 문장), into? }]
//              rule: broad(넓은 업종 이름) · extra(추가 메뉴) · vague(뜻이 넓음) · drink(술·음료) · otherBusiness(다른 업종의 낱말) ·
//                    condition(업종 연관어의 조건이 안 맞음) · rivalOnly(상위 매장만 쓰는 말) · noBlog(블로그 0개 + 다른 근거 없음) ·
//                    channel(포장·배달 — 받는 방법) · merged(겹치는 낱말을 하나로) · region(지역만 바꾼 조합) ·
//                    offMain(주력 갈래 밖의 곁들임 메뉴) · classification(약·제품 분류 이름) ·
//                    rank(내 순위가 나쁜 지역 — 이때 term 은 지역 이름, keywords 는 그 지역에 만들었을 조합)
//              into: merged 는 묶인 낱말, classification 은 대신 쓸 손님 말. 그 낱말이 최종 추천(items)이나 등록 키워드에 있을 때만 붙습니다
//              이유가 가리키는 키워드는 화면에 보이는 것만입니다: region 줄은 남긴 조합이 items 나 등록 키워드에 있을 때만 나오고,
//              한 낱말이 다른 낱말을 품는 같은 이유의 줄은 한 줄로 묶입니다(term 은 가장 짧은 낱말, keywords 는 낱말마다 조합 하나씩)
//   registered 등록한 대표키워드별 진단(지역 유무·블로그 언급·바꿔 쓸 조합). concern 은 그 키워드가 관문에 걸린 이유({ rule, reason }, 없으면 null)
//              spoken 은 손님이 더 많이 쓰는 같은 뜻의 말(블로그 언급 비교, 분류 이름이면 대신 쓸 손님 말)
//   slotsLeft  대표키워드 빈 칸 수
export function recommendKeywords({ place, activity = null, rivals = [], ranks = [], limit = RECOMMEND_LIMIT } = {}) {
    const empty = { regions: [], items: [], excluded: [], registered: [], slotsLeft: 0, rivalCount: 0, hasRegionKeyword: false };
    if (!place) return empty;

    const regions = regionTerms(place);
    const terms = collectTerms(place, activity, regions);
    const others = uniqueRivals(rivals, place.placeId);
    const family = familyOf(place);
    const familyTerms = [...(family?.base || []), ...(family?.related || []).map((item) => item.term), ...(family?.rankOnly || [])].map(compact);
    const stats = rivalStats(others, regions, [...terms.keys(), ...familyTerms]);
    const myKeywords = list(place.keywords);
    const mine = new Set(myKeywords.map(compact));

    // 상위 매장 두 곳 이상이 쓰는 낱말은 후보에 올립니다. 추천에 넣을지는 관문이 내 매장 근거를 보고 정합니다(나).
    for (const [key, count] of stats.byTerm) {
        const term = terms.get(key);
        if (term) {
            term.weight += Math.min(24, 8 * count);
            term.rivals = count;
        } else if (count >= 2 && TERM.test(key) && !isPromo(key)) {
            terms.set(key, { term: key, key, source: 'rival', weight: 26 + Math.min(24, 8 * count), reasons: [], registrable: true, rivals: count });
        }
    }

    const ctx = gateContext(place, activity, regions);
    const gate = gateTerms(ctx, terms);

    const metro = !regions.some((region) => region.scope === 'city');
    const bonus = metro ? METRO_BONUS : REGION_BONUS;
    const ordered = [...gate.passed.values()].sort((a, b) => b.weight - a.weight);

    // 카. 내 순위로 지역 순서를 정합니다: 내 순위가 좋은(10위 안) 지역을 순위 순으로 앞에, 나머지는 원래 순서.
    // 나쁜 지역(조회한 것이 모두 30위 밖·먼 지역 결과)은 제자리에 두되 새 조합을 만들지 않습니다(살펴본 수에는 넣음).
    const standing = regionStanding(regions, ranks, place.coordinate);
    const goodRegions = regions.filter((region) => standing.get(region.term)?.good)
        .sort((a, b) => standing.get(a.term).best.rank - standing.get(b.term).best.rank);
    const order = [...goodRegions, ...regions.filter((region) => !goodRegions.includes(region))];
    const isWeak = (region) => standing.get(region.term)?.weak === true;
    const movedAhead = new Set(goodRegions.filter((region) => order.indexOf(region) < regions.indexOf(region)).map((region) => region.term));
    const queried = new Set(list(ranks).filter((row) => row?.state === 'done' && row.result).map((row) => compact(row.keyword)));
    // 순위 표에 있는 조합 가운데 조회 중·조회 실패이거나 내 순위가 10위 안인 것은 지역 수와 관계없이 그대로 권합니다
    // (조회 중에 다른 순위가 먼저 끝나 추천에서 빠졌다가 돌아오는 일을 막고, 10위 안은 그 조합 자체의 근거). 나쁜 지역이면 빼는 것은 같습니다.
    const held = new Map();
    for (const row of list(ranks)) {
        if (!row?.keyword) continue;
        const done = row.state === 'done' && row.result;
        const rank = done && row.result.status === 'found' && Number.isFinite(row.result.rank) ? row.result.rank : null;
        if (!done) held.set(compact(row.keyword), null);
        else if (rank !== null && rank <= RANK_GOOD && rankLocality(row.result, place.coordinate)?.scope !== 'far') held.set(compact(row.keyword), rank);
    }

    // 걸러낸 낱말로 만들어졌을 조합(앞의 지역부터 count 개, 나쁜 지역 제외). 사장님이 이미 등록한 키워드는 "뺀 조합"이 아니라서 넣지 않습니다.
    const combosOf = (term, count) => order
        .filter((region) => !isWeak(region))
        .filter((region) => !term.key.includes(compact(region.term)) && !region.variants.some((variant) => term.key.includes(variant)))
        .map((region) => `${region.term}${term.term}`)
        .filter((keyword) => Array.from(compact(keyword)).length <= KEYWORD_MAX_LEN && !mine.has(compact(keyword)))
        .slice(0, count);

    // 바. 지역 수: 가장 중요한 낱말 하나만 3개, 나머지는 1개(업종 이름 조각 "남성전문미용실"·주력 메뉴 "숙성회"도 1개).
    // 사장님이 이미 등록한 조합도 이 수에 넣습니다. 이 수를 넘는 조합은 그 조합을 그대로 등록한 상위 매장이 있을 때만(그 조합 자체의 근거) 더 권합니다.
    const ownCombos = new Map();
    for (const keyword of myKeywords) {
        if (!matchRegion(keyword, regions)) continue;
        const core = keywordCore(keyword, regions);
        ownCombos.set(core, [...(ownCombos.get(core) || []), keyword]);
    }
    const top = ordered.find((term) => term.source !== 'rankOnly') || null;
    const regionBudget = (term) => (term === top ? 3 : 1);
    // 나쁜 지역에 만들지 않은 조합(지역별)
    const rankSkipped = new Map();

    const candidates = [];
    const swapped = [];
    const seen = new Set();
    for (const term of ordered) {
        const own = ownCombos.get(term.key) || [];
        // 새로 살펴보는 조합은 낱말마다 2개(가장 중요한 낱말은 3개)까지입니다.
        const tryMax = term === top ? 3 : 2;
        let room = Math.max(0, regionBudget(term) - own.length);
        let tried = 0;
        const made = [];
        const skipped = [];
        for (const [regionIndex, region] of order.entries()) {
            if (term.key.includes(compact(region.term)) || region.variants.some((variant) => term.key.includes(variant))) continue;
            const keyword = `${region.term}${term.term}`;
            const key = compact(keyword);
            const holding = held.has(key) && !mine.has(key);
            // 살펴볼 수를 다 쓰면 순위 표에 있는 조합만 더 봅니다.
            if (tried >= tryMax && !holding) continue;
            if (seen.has(key) || Array.from(key).length > KEYWORD_MAX_LEN) continue;
            seen.add(key);
            const exact = stats.exact.get(key)?.count || 0;
            // 이미 등록한 조합은 살펴본 수에 넣지 않아, 아직 안 쓴 지역과의 조합을 봅니다.
            if (!mine.has(key)) {
                if (!holding) tried += 1;
                // 카. 내 순위가 나쁜 지역에는 새 조합을 만들지 않습니다(그 조합을 등록한 상위 매장이 있어도).
                if (isWeak(region)) {
                    rankSkipped.set(region.term, [...(rankSkipped.get(region.term) || []), keyword]);
                    continue;
                }
                if (room > 0) room -= 1;
                else if (exact === 0 && !holding) {
                    skipped.push(keyword);
                    continue;
                }
                made.push(keyword);
            }
            const reasons = [...term.reasons];
            if (exact > 0) reasons.unshift({ kind: 'rival', text: `상위 ${exact}곳 등록` });
            else if (term.rivals > 0) reasons.push({ kind: 'rival', text: `상위 ${term.rivals}곳이 '${term.term}' 사용` });
            // 이미 조회해 10위 안인 조합에는 그 순위를 붙입니다(그 조합을 권하는 근거).
            if (Number.isFinite(held.get(key)) && !mine.has(key)) reasons.unshift({ kind: 'myRank', text: `내 ${held.get(key)}위` });
            // 카. 내 순위 때문에 앞으로 온 지역의 조합에는 그 지역에서의 내 순위를 붙입니다(이미 순위를 조회한 키워드에는 붙이지 않음).
            const lead = movedAhead.has(region.term) ? standing.get(region.term).best : null;
            if (lead && !queried.has(key)) reasons.push({ kind: 'regionRank', text: `'${lead.keyword}' 내 ${lead.rank}위` });
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
                ...(term.merged ? { merged: term.merged } : {}),
            });
        }
        // 남긴 조합(own: 이미 등록한 것, made: 새로 만든 것)이 화면에 보이는지는 추천을 limit 로 자른 뒤에야 알 수 있어, 줄은 아래에서 만듭니다.
        if (skipped.length > 0) swapped.push({ term: term.term, keywords: skipped, own, made, weight: term.weight });
    }
    candidates.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword, 'ko'));

    // 화면에 실제로 보이는 것: 최종 추천(limit 안)과 이미 등록한 키워드. 걸러낸 이유가 "이미 있다"·"하나로 묶었다"고 가리키는 것은 이 안에 있어야 합니다.
    const items = candidates.filter((item) => !item.registered).slice(0, limit);
    const shownKeywords = new Set(items.map((item) => compact(item.keyword)));
    const shownTerms = new Set([...items.map((item) => compact(item.term)), ...myKeywords.map((keyword) => keywordCore(keyword, regions))]);
    const lastOf = (words) => words[words.length - 1];

    // 바. 지역만 바꾼 조합: 남긴 조합이 화면에 보일 때만 줄을 냅니다. 남긴 조합이 추천 자리 밖으로 밀린 낱말은
    // 걸러낸 것이 아니라 자리에 못 든 것이라 줄을 내지 않습니다. 문장은 등록한 키워드와 추천에 있는 조합을 가려 적습니다.
    const regionEntries = swapped.sort((a, b) => b.weight - a.weight).flatMap(({ term, keywords, own, made }) => {
        const listed = made.filter((keyword) => shownKeywords.has(compact(keyword)));
        if (own.length === 0 && listed.length === 0) return [];
        const names = (words) => words.map(quoted).join('·');
        const inList = `${names(listed)}${p(lastOf(listed), '이', '가')} 추천에 이미 있어`;
        const kept = own.length === 0 ? inList
            : listed.length === 0 ? `${names(own)}${p(lastOf(own), '은', '는')} 이미 등록한 키워드라`
                : `${names(own)}${p(lastOf(own), '은', '는')} 이미 등록한 키워드이고 ${inList}`;
        return [{ term, keywords, rule: 'region', reason: `${kept}, ${quoted(term)}에 지역만 바꾼 조합은 더 권하지 않습니다.` }];
    });

    // 카. 내 순위가 나쁜 지역: 지역마다 한 줄. 이유에는 실제 순위를 적습니다.
    // "먼저 권합니다"라고 적는 좋은 지역은 그 지역의 조합이 최종 추천에 실제로 있는 것만입니다.
    const goodNames = goodRegions.filter((region) => items.some((item) => item.region === region.term)).map((region) => `'${region.term}'`).join('·');
    const weakEntries = order.filter((region) => isWeak(region) && rankSkipped.has(region.term)).map((region) => {
        const { rows } = standing.get(region.term);
        const listed = rows.map((row) => `${row.text}('${row.keyword}')`).join('·');
        const last = rows[rows.length - 1].text;
        const next = goodNames ? `고 내 순위가 좋은 ${goodNames} 조합을 먼저 권합니다` : '습니다';
        return {
            term: region.term,
            keywords: rankSkipped.get(region.term),
            rule: 'rank',
            reason: `'${region.term}'${p(region.term, '이', '가')} 들어간 키워드에서 내 매장은 ${listed}${p(last, '이라', '라')}, 이 지역에는 새 조합을 만들지 않${next}.`,
        };
    });

    // 걸러낸 것: 낱말 단위로 걸린 것(점수가 높았을 것부터) → 내 순위가 나쁜 지역 → 지역만 바꾼 조합
    // into 는 화면에 보이는 낱말일 때만 붙입니다. 분류 이름의 손님 말이 안 보이면(추천 자리 밖이거나 그 말이 관문에 걸림)
    // 업종 대표어('약국')가 보이는지 보고, 그것도 없으면 비웁니다. 이유 문장도 그 into 로 다시 적습니다.
    const shownInto = (entry) => {
        if (!entry.into) return null;
        if (shownTerms.has(compact(entry.into))) return entry.into;
        const base = entry.rule === 'classification' ? family?.base?.[0] : null;
        return base && shownTerms.has(compact(base)) ? base : null;
    };
    const lines = gate.excluded
        .sort((a, b) => b.term.weight - a.term.weight)
        .map((entry, at) => {
            const into = shownInto(entry);
            // shape: 낱말 이름만 뺀 이유 문장. 이것이 같은 줄끼리만 한 줄로 묶습니다(수치가 다르면 묶지 않음).
            return { entry, at, into, shape: entry.tell(['\u0001'], '', into) };
        });
    // 등록 키워드 진단(concern·spoken)에도 같은 문장과 같은 into 를 씁니다.
    const concernOf = new Map(lines.map(({ entry, into }) => [entry.term.key, { rule: entry.rule, reason: entry.tell([entry.label], entry.term.term, into) }]));
    const intoOf = new Map(lines.filter(({ entry, into }) => entry.rule === 'classification' && into).map(({ entry, into }) => [entry.term.key, into]));
    // 한 낱말이 다른 낱말을 품고(갈치·갈치조림·순살갈치조림) 이유가 낱말 이름만 빼고 같은 줄은 한 줄로 묶습니다.
    // 짧은 낱말부터 보아 가장 짧은 낱말이 그 줄의 term 이 되고, 줄의 자리는 묶인 낱말 가운데 점수가 가장 높았을 것의 자리입니다.
    const groups = [];
    [...lines]
        .sort((a, b) => a.entry.term.key.length - b.entry.term.key.length || a.at - b.at)
        .forEach((line) => {
            const group = groups.find((other) => other.rule === line.entry.rule && other.shape === line.shape && line.entry.term.key.includes(other.members[0].term.key));
            if (group) {
                group.members.push(line.entry);
                group.at = Math.min(group.at, line.at);
            } else groups.push({ rule: line.entry.rule, shape: line.shape, into: line.into, at: line.at, members: [line.entry] });
        });
    const gateEntries = groups.sort((a, b) => a.at - b.at).map(({ rule, into, members }) => ({
        term: members[0].term.term,
        keywords: members.length === 1 ? combosOf(members[0].term, 2) : members.flatMap((entry) => combosOf(entry.term, 1)),
        rule,
        reason: members[0].tell(members.map((entry) => entry.label), lastOf(members).term.term, into),
        ...(into ? { into } : {}),
    }));
    const excluded = [...gateEntries, ...weakEntries, ...regionEntries];

    // 등록 키워드 진단
    const best = (core) => candidates.find((item) => compact(item.term) === core && !item.registered) || null;
    const registered = myKeywords.map((keyword) => {
        const matched = matchRegion(keyword, regions);
        const core = keywordCore(keyword, regions);
        const term = terms.get(core);
        const suggestion = matched || !core ? null : best(core);
        // 등록한 낱말보다 블로그 후기에서 더 많이 쓰는 같은 뜻의 낱말("건강기능식품" 0개 · "영양제" 4개).
        // 약·제품 분류 이름(차)이면 블로그 수와 관계없이 손님이 검색할 때 쓰는 말을 알려 줍니다("일반의약품" → "약국").
        const instead = intoOf.get(core);
        const spoken = (instead ? gate.passed.get(compact(instead)) : null) || [...gate.passed.values()]
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
            // 이 키워드의 낱말이 쓸모 관문에 걸린 이유(걸리지 않았으면 null). 화면 표시는 따로 정합니다.
            concern: concernOf.get(core) || null,
        };
    });

    return {
        regions,
        // 이미 등록한 키워드는 추천에서 빼고 registered 진단에서 보여 줍니다.
        items,
        excluded,
        registered,
        slotsLeft: Math.max(0, KEYWORD_MAX - myKeywords.length),
        rivalCount: others.length,
        hasRegionKeyword: registered.some((entry) => entry.hasRegion),
        blogTotal: activity?.mentions?.blogTotal ?? null,
    };
}

// 근거가 "사장님이 등록한 낱말에 지역을 붙였다"는 것(+블로그 언급)뿐인 추천 조합인지.
// 손님 쪽 근거(리뷰·예약·결제)나 매장 사실이 있거나, 그 조합을 그대로 등록한 상위 매장이 있으면 해당하지 않습니다.
// (상위 매장이 지역 없이 그 낱말만 쓰는 것은 "지역+낱말"로 검색한다는 근거가 아니라서 치지 않습니다.)
function ownerWordOnly(item) {
    return item.source === 'registered' && !(item.rivalCount > 0)
        && !list(item.reasons).some((reason) => ['review', 'booking', 'pos', 'fact'].includes(reason.kind));
}

// 순위를 자동으로 조회할 키워드: 지역이 들어간 등록 키워드를 먼저 쓰고, 남는 자리는 추천 키워드로 채웁니다.
// 지역이 없는 등록 키워드는 검색 위치에 따라 순위가 달라져 뺍니다(skipped 로 알려 줌).
// 조회 한 번이 네이버 요청 한 번이라, 근거가 등록 키워드(+블로그)뿐인 조합("청주일반의약품")은 다른 후보 뒤로 미룹니다.
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
    // 두 차례 모두, 근거가 등록 키워드(+블로그)뿐인 조합은 다른 후보를 다 본 뒤에 봅니다.
    for (const pass of [1, 2]) {
        for (const late of [false, true]) {
            for (const item of items) {
                if (keywords.length >= max) break;
                if (ownerWordOnly(item) !== late) continue;
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
