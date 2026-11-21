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
// ── 7차(구조 변경): 목록을 더하는 대신 "자료로 확인한 것만 추천" ──────────────────────────────────────────────
// 6차 채점까지는 새 입력이 들어올 때마다 낱말 목록·끝말 규칙을 늘려 막았지만 새 입력에서 또 뚫렸습니다. 그래서 방식을 바꿉니다. 원칙:
//   1. 틀리는 방향을 정한다: 쓸데없는 말을 '추천'하는 쪽이 아니라, 좋은 말을 '후보'로만 보여 주는 쪽으로 틀린다.
//   2. 확신 없는 판정은 단정하는 문장을 쓰지 않는다(지역을 확인 못 한 키워드에 "지역명이 없다"고 쓰지 않는다).
//   3. 새 낱말 목록을 만들기 전에 "자료로 확인하는 방법이 없는지" 먼저 따진다. 아래 조건·채널·꾸밈·지명 낱말 목록(ATTRIBUTE_WORDS·PLACE_NAMES·BOARD_NOTE…)은
//      "확실히 아닌 말"의 안전망으로만 두고 더 늘리지 않는다.
//   4. 수치·근거를 지어내지 않는다. 검색량·검색 행태 자료는 없다(그것을 근거로 드는 문장을 쓰지 않는다).
// ① 확인 관문(아래 "확인 관문" 절): 추천(items)에 오르려면 낱말이 이 매장이 파는 것·하는 것으로 확인돼야 합니다 — 업종(업종·업종 갈래·대표어·연관어)·등록 키워드의 낱말(통과한 것)·
//    메뉴판 품목·예약 스타일·결제 인기 메뉴에 실제 품목으로 있는 말·상위 매장 둘 이상이 등록했고 업종·품목과 맞는 말. 리뷰·블로그 언급은 점수를 더할 뿐 혼자서 추천을 만들지 못합니다.
//    확인하지 못한 낱말은 버리지 않고 candidates(후보, 최대 CANDIDATE_MAX 개)로 돌려줍니다. 후보는 순위 조회 대상·topTerm 에 넣지 않습니다.
//    메뉴판·예약·결제 자료가 하나도 없는 매장도 같습니다: 확인할 자료가 없으니 리뷰로 고른 말은 추천이 아니라 후보(lacks: 'data')이고, 추천은 업종·등록 낱말로 확인된 말만 남습니다.
// ② 지역은 확인된 것만(regionTerms): 주소·가까운 역·지점 이름·시·도, 순위 조회 결과가 알려 준 지역, 그리고 등록·상위 매장 키워드에서 같은 앞말이 서로 다른 확인된 낱말 앞에
//    되풀이되면서 지리 자료(내 주소·가까운 역·상위 매장의 주소·지역·순위 조회가 알려 준 지역)와 맞는 것만 지역입니다(region.confirmedBy: address·station·rivals·rank).
//    되풀이만으로는 지역을 확정하지 않습니다(7차 채점 K-B: 수제·매운·무한리필 같은 꾸밈말이 지역으로 읽히던 것). 등록 키워드의 끝말 목록으로 "나머지는 지역"이라고 가르지 않습니다.
//    앞말이 있는데 지역인지 확인하지 못한 키워드는 regionStatus 'unknown' 으로 두고 지역이 없다고도, 있다고도 말하지 않으며 그 키워드로 새 조합을 만들지 않습니다.
// ③ 두 쪽 확인(7차 채점 K-A): 메뉴판·예약 스타일·결제 인기 메뉴(가게 쪽 — 셋은 한 쪽으로 셈)에서 확인된 말도 손님 쪽(리뷰 메뉴 언급·상위 매장 둘 이상 등록)에서
//    확인되어야 추천입니다. 가게 쪽만 확인된 말은 후보(lacks 'voice')입니다. 업종·등록 낱말은 그 자체가 확인이라 두 쪽을 따지지 않습니다.
//    블로그 후기 언급은 근거 점수에는 더하지만 손님 쪽 확인으로는 치지 않습니다(BLOG_COUNTS_AS_VOICE = false — 블로그 글에는 주차·셔틀·견적 같은 메뉴가 아닌 말도 두루 나와서).
//    후보의 까닭에는 블로그에 나온 개수를 사실대로 덧붙입니다.
//    조건어(ATTRIBUTE_WORDS)로 끝나는 합성어("학생할인"·"첫방문이벤트")도 조건어입니다(한 글자 꼬리 규칙은 두지 않음).
// ④ 등록 낱말이 이 매장 자료(업종·상호·소개·메뉴판·예약·결제·리뷰) 어디에도 없으면(경쟁 가게 상호를 등록한 경우) 새 지역 조합을 만들지 않습니다(excluded 'unrelated').
//    그 칸이 틀렸다고 단정하지는 않습니다. 메뉴 이름 앞에서만 쓰이고 끝말로는 한 번도 안 쓰인 낱말("마장동 소고기"의 "마장동")은 낱말이 아닙니다(excluded 'prefix').
// ⑤ 묶인 구체 품목도 주력으로 셉니다: 등록·업종 낱말에 묶이는 품목(치즈버거·클래식버거 → 버거) 가운데 손님이 가장 많이 말한 하나는 묶지 않고 따로 권하고(낱말 가족은
//    같은 낱말처럼 두 칸까지: 등록·업종 낱말 한 칸 + 구체 품목 한 칸, 이유에 note 한 줄), 주력으로 묶인 품목들의 리뷰를 합친 수의 1/3에 못 미치게 말해진 다른 메뉴는
//    추천이 아니라 후보(lacks 'share')입니다(먹고 마시는 업종). 숫자만 적고 "곁들임"이라고 단정하지 않습니다 — 비중만으로는 주력이 아니라고 말할 수 없어서입니다(히레카츠도 돈가스).
//    갈래 사전(DISH_HEADS)의 끝말로 확인된 다른 갈래 메뉴만 offMain 으로 뺍니다.
// ⑥ (7차 채점 나머지) 가게 쪽 확인은 품목 이름 전체이거나 끝말이거나, 앞부분이어도 남는 말이 같은 품목의 꼴(한 글자·메뉴 갈래 끝말·차림 낱말: 광어+회)일 때만입니다 —
//    "셔틀버스"의 "셔틀"·"소고기샤브샤브"의 "소고기"는 앞말이라 확인하지 않고(후보 까닭에 어느 품목의 일부인지 적음), 묶음은 가게 쪽 확인을 물려주지 않습니다(M1).
//    주력 가족(업종 이름·등록 낱말을 품은 메뉴)의 리뷰 합계에 견줘 1/3에 못 미치고 가족과 끝 글자를 나누지 않는 메뉴는 갈래 사전이 없는 업종에서도 후보(lacks 'share')로 갑니다(M2·M9).
//    메뉴판의 한 줄 품목·영어 메뉴·리뷰 상위 8개 밖 낱말은 후보로 남기고(M3·s3), 예약·결제 줄은 조건 줄을 거른 뒤 상위 N 개를 봅니다.
//    업종 이름표("기타서비스")는 자료에 나올 때만 추천하고(M8), 동 이름이 한 글자만 남는 가(街) 주소(명동2가)도 지역으로 읽고(M4), 끝말을 모르는 짧은 등록 키워드는
//    지역이 없다고 단정하지 않으며(M5), 지역을 확인하지 못한 등록 칸도 같은 낱말 칸 수에 셉니다(F03). headlineMenuTerms 는 추천이 확인한 낱말만 돌려줍니다(M7).
// ⑦ (8차 재채점) 머리가 한 글자인 조건 합성어(룸예약)도 조건 낱말입니다. 가족에서 근거가 가장 센 품목은 추천이 안 되어도 묶여 사라지지 않고 후보로 남습니다 —
//    두 쪽 확인이 있으면 가족 pick(같은 낱말 칸이 차서 못 오르면 lacks 'family'), 가게 쪽만 확인이면 lacks 'voice'. pick 은 가족 이름으로 끝나는 품목만 고릅니다
//    (치킨무·버거소스 제외, 하나도 없으면 속눈썹펌처럼 이름을 품은 품목). 상위 매장 둘 이상이 그대로 등록한 한 줄 품목은 보통 낱말(추천이 될 수 있음)이고,
//    관문에 걸린 한 줄 품목은 이유와 함께 excluded 에 남습니다(같은 이유는 한 줄). 상호 끝의 동네 이름이 키워드의 앞말이면 지역 없음이라 하지 않고(M5'),
//    이 매장 자료 어디에도 없는 경쟁 상호는 지역이 unknown 이어도 unrelated 로 알리고 순위 조회에서 뺍니다(S-1). 리뷰 비중(주력 가족의 1/3)도 주력의 근거입니다(M9').
//    업종 이름표는 업종 분류 윗단 이름의 닫힌 집합(LABEL_CATEGORY)으로만 판정하고(S-4), 영어 메뉴는 이름 전체·원래 표기로 씁니다(S-3).
//    등록할 수 있는 추천이 없으면(순위 확인용 칩만 있어도) emptyReason 을 남기고(S-5), 후보는 점수가 같으면 리뷰 수·예약 수 순입니다(S-6).
// ⑧ (9차 재채점) 가족의 구성원 = 가족 이름으로 끝나는 품목 + 이름 뒤에 조리·차림·음료 끝말이 붙은 품목(갈비탕·돈가스정식·순대국·메밀국수·참치스페셜·카페라떼). 그 가운데 리뷰 1위가 pick 이고,
//    이름 뒤에 그 밖의 말이 붙은 것(치킨무·버거소스)만 구성원이 아닙니다. 한 품목을 두 낱말(메밀·국수)이 다투면 등록 낱말이 먼저 가져가고, pick(후보로 남길 품목 포함)은 어느 낱말에도 묶여
//    사라지지 않습니다. "가장 많은 메뉴"라는 문장은 이 가족 이름을 품은 더 많이 말해진 리뷰 낱말이 없을 때만 쓰고, 있으면 "구체 메뉴"라고만 적습니다. 상위 매장 둘 이상이 그대로 등록한
//    품목은 등록·업종 낱말에 묶이더라도 후보(lacks 'family')로 남고 까닭에 사실만 적습니다(N2). 값·표·절차를 가리키는 이름은 낱말 목록이 아니라 닫힌 부류로 거릅니다(K-A): 요금·이용권(머리말 +
//    비·료·금·권), 시간·절차 이름, 조건어(셔틀·당일·방문·출장·사전·유료)가 앞에 붙은 합성어, 판촉 표지(이벤트·할인·무료·쿠폰·증정·사은품)가 든 낱말 — 나머지 부분이 이 매장의 업종·상호·다른 품목
//    끝말이면 조건이 아닙니다. 영문 이름은 스무 자까지 한 낱말(N-E), 업종 대분류 이름(교육·학문·스포츠·레저…)은 이름표(N-L), "앞말 + 가게 종류 꼬리"는 앞말이 자료에 있으면 아는 말입니다(N-U).
// 알려진 한계(9차): 업종마다 품목일 수도 있는 대여·수리·배송·손질·렌탈·출동·미끼·좌대·CCTV 같은 말은 가를 자료가 없어 닫힌 부류에 넣지 않았습니다.
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
//   바. 한 낱말에는 지역 하나가 원칙(이미 등록한 조합·순위 표에 이미 있는 조합도 그 하나로 침). 예외는 둘뿐:
//       ① 그 조합을 그대로 등록한 상위 매장이 있을 때(그 조합 자체의 근거)
//       ② 가장 중요한 낱말(업종 대표어)은 등록한 것을 포함해 둘까지. 둘째 지역은 내 순위가 좋은 지역(그 지역 키워드가 10위 안)일 때만,
//          첫 분석처럼 순위 표에 그 낱말이 아직 없고 등록한 조합도 없을 때는 순위를 조회해 볼 후보로 하나(조회가 끝나면 좋은 지역만 남음)
//       두 예외를 합쳐도 같은 낱말은 등록한 칸(30위 밖이라 바꿀 칸 제외)을 포함해 SAME_TERM_MAX(2)칸을 넘지 않음
//       순위 표에 그 낱말의 조합이 이미 있으면(조회 중·실패·순위 있음) 다른 지역의 새 조합을 만들지 않음. 다만 그 조합이 30위 밖으로
//       확인됐으면 같은 조합을 다시 권하지 않고 다른 지역(내 순위가 좋은 지역이 있으면 그 지역)의 조합으로 바꿔 권함(excluded 의 region 줄에 사실대로 적음)
//       같은 지역인지는 이름이 같은지가 아니라 가리키는 곳이 같은지로 봄: 역 이름의 변형("서초역"의 "서초")이 동·구 이름("서초")과 겹치면 한 지역이고,
//       이미 등록한 키워드와 지역·낱말이 같은 조합(서초임플란트 ↔ 서초역임플란트)은 새 추천에서 뺌
//   파. 시설 조건·알리는 통로·인상·꾸밈 낱말(주차·예약·블로그·인스타·가격·분위기·시그니처·프리미엄·수제·신선한·추천·인기…)은 메뉴·리뷰·결제·메뉴판·
//       상위 매장 키워드에서 온 낱말이어도 뺌(attribute). 업종 이름·등록 낱말·업종 연관어는 그대로. 이름 맨 앞의 꾸밈말은 떼고 뒷말을 씀("시그니처 말차라떼" → 말차라떼)
//   하. 메뉴 이름에 되풀이되는 다른 지명("전주 비빔밥"의 "전주")은 지역 키워드의 낱말로 쓰지 않음(place)
//   거. 업종 이름도 뜻이 넓은 말(육류·고기요리·해물·생선요리…)은 뺌(vague). 업종 이름 끝에 붙은 조각("네일아트"의 "아트")·뜻이 넓은 시술 말(케어·관리)도 뺌
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
//       일상에서 흔히 쓰는 말(약국·영양제·동물약국)을 함께 알려 주고(into), 등록했으면 진단에 "다를 수 있다"고만 적음
//   카. 내 순위가 나쁜 지역에는 새 조합을 만들지 않고, 내 순위가 좋은 지역을 앞세움(ranks 를 받았을 때만, 아래 RANK_GOOD·RANK_WEAK)
//   타. 근거가 얇은 업종 연관어는 추천하지 않음: 근거가 매장 사실 하나뿐(편의시설 한 줄·좌석 한 줄·매장 이름·매장 특징·반려동물)이고
//       리뷰·예약·블로그 언급·손님이 고른 좋은 점·상위 매장·등록 키워드 어디에도 그 말이 없으면 뺌(추천 자리를 채우려고 약한 것을 올리지 않음).
//       영업시간이 근거인 낱말(심야약국)과 사장님이 등록한 낱말은 걸지 않고, 블로그 언급 수를 묻는 목록(mentionTerms)에는 그대로 둠(물어봐야 근거가 생김)
// 추천 목록(items) 정렬: 근거 점수 순으로 limit 개를 고른 뒤, 대표키워드로 등록할 수 있는 추천을 앞에, 순위 확인용(registrable=false, 맛집 등)을 맨 뒤에 둡니다.
// 근거 점수(score = evidence.points): 추천 한 줄과 등록 낱말 하나마다 근거를 구조화한 값으로 매깁니다 — evidence = { points, parts: [{ kind, points, text, short, …숫자 }] }
// (parts 는 점수 높은 순; kind 는 myRank·rival·booking·review·pos·vote·blog·board·category·fact·registered). 숫자는 문장이 아니라
// 잘리기 전의 전체 목록(리뷰 메뉴·예약 스타일·주간 인기 메뉴·메뉴판·소식)에서 센 값이고 눈금은 evidenceFor 에 있습니다. 처방전 5칸이 같은 값을 읽어 쓰므로
// 화면 추천을 위에서부터 채우면 처방전 5칸과 같은 기준이 됩니다. 등록 키워드(registered)에도 evidence·rank(순위 표 상태)·concern(관문 또는 30위 밖 lowRank)을 답니다.
// 추천이 하나도 없으면 emptyReason(noRegion·allWeak·enough·noData)이 그 까닭을, regionSource(address·keywords·none)가 지역을 어디서 읽었는지를,
// topTerm 이 가장 중요한 낱말을 알려 줍니다(화면이 사실과 다른 "이미 충분합니다"를 말하지 않게).
// 메뉴판·소식에서 온 낱말(board)은 근거(메뉴판 항목·소식·리뷰 언급)가 여러 개일수록 점수를 더합니다.
// 손님이 찾는 메뉴를 키워드에서 빼는 두 줄(offMain·otherBusiness)의 이유는 손님 반응과 어긋나는 단정("곁들임이라", "주력 메뉴로 보기 어렵고")을 하지 않고,
// 사실(리뷰 언급·주간 인기 메뉴 순위·AI 브리핑)을 먼저 적은 뒤 왜 지역을 붙인 키워드로는 권하지 않는지, 대신 쓸 자리(메뉴 설명·소식·소개글)를 말합니다.
// 같은 사실은 처방전이 쓰도록 항목에 구조화해 둡니다: words(묶인 낱말), popular({ reviews·reviewWord·reviewRank, posRank·posShare·posName, briefing, menus·menuTotal }), useIn.
// 걸러낸 것(excluded)의 이유 문장이 가리키는 키워드는 화면에 실제로 보이는 것이어야 합니다(최종 추천 items 안, 또는 이미 등록한 키워드).
//   · "지역만 바꾼 조합"(region) 줄은 남긴 조합이 화면에 보일 때만 냅니다. 남긴 조합이 추천 자리(limit) 밖으로 밀린 낱말은
//     걸러낸 것이 아니라 자리에 못 든 것이라 줄을 내지 않습니다. 문장은 "추천에 이미 있어"와 "이미 등록한 키워드라"를 가려 적습니다.
//   · into(묶인 낱말·대신 쓸 손님 말)는 그 낱말이 최종 추천이나 등록 키워드에 있을 때만 붙이고, 없으면 문장도 그에 맞게 적습니다.
//   · 한 낱말이 다른 낱말을 품고 이유가 낱말 이름만 빼고 같은 줄(갈치·갈치조림·순살갈치조림)은 한 줄로 묶습니다
//     (term 은 가장 짧은 낱말, keywords 는 낱말마다 조합 하나씩, 이유에는 묶인 낱말을 모두 적음).
// 알려진 한계: 여러 음식을 함께 파는 한식당의 칼국수·국밥은 메뉴판의 1/3에 못 미치면 '가'에 걸립니다. 그 메뉴로 이름난 집이어도
// 주력인지 가를 자료가 업종·매장 이름·대표 메뉴 표시·메뉴판 비중뿐이라서입니다(걸린 것은 excluded 에 이유와 함께 남습니다).
// 알려진 한계: 메뉴판(예약·결제) 줄과 리뷰 메뉴 칩 양쪽에 다 있는 조건·요금·서비스 말(셔틀·재료비·수리·견적…)은 가게 쪽·손님 쪽 두 쪽 확인을 모두 통과합니다.
// 메뉴 이름인지 아닌지를 자료만으로 가를 수 없고(낱말 목록으로 막지 않음), 검색량 자료도 없어서입니다. 사장님이 추천 낱말을 보고 판단합니다.
// '자'의 갈래 끝말은 아래 DISH_HEADS 목록에 있는 것만 알아봅니다(목록에 없는 갈래의 매장에는 '자'를 쓰지 않음).
// 메뉴판·소식 낱말은 시·도와 내 매장의 지역 이름, 그리고 PLACE_NAMES 에 있는 흔한 시·군·도 이름만 지명으로 걸러 냅니다. 목록에 없는 지명
// (동네 이름 등)이 메뉴판 세 항목 이상에 되풀이되면 후보가 될 수 있습니다(전국 지명 자료가 없어서).
// 자동 순위 조회(pickRankKeywords)는 추천 가운데 근거가 "등록 키워드에 지역을 붙였다"(+블로그 언급)뿐인 조합을 다른 후보 뒤로 미룹니다.
// 자동 순위 조회는 순위를 조회하기 전에 고르므로 ranks 없이 만든 추천으로 고릅니다.

import { KEYWORD_MAX, KEYWORD_MAX_LEN, PROMO_WORDS } from './place-check.js';
import { rankLocality } from './naver-place.js';

export const RECOMMEND_LIMIT = 12;
export const RANK_KEYWORD_MAX = 5;
// 후보(candidates)로 보여 주는 낱말 수의 상한
export const CANDIDATE_MAX = 8;
// 손님 쪽 확인(두 쪽 확인)에 블로그 후기 언급을 칠지. true 면 메뉴판·예약·결제 줄에만 있는 말도 블로그 후기에 한 번이라도 나오면 추천이 됩니다.
// 블로그 글에는 "주차·셔틀·견적…"처럼 메뉴가 아닌 말도 두루 나와서 false 입니다: 가게 쪽만 확인된 말은 리뷰 메뉴 언급이나 상위 매장 둘 이상의 등록이 있어야 추천이 됩니다
// (블로그 언급은 근거 점수에는 그대로 더하고, 후보의 까닭에 개수를 적습니다).
export const BLOG_COUNTS_AS_VOICE = false;

// 내 순위로 지역을 가르는 선(관문 '카'). 그 지역 이름이 들어간 키워드 가운데 순위를 조회한 것만 봅니다.
//   좋은 지역: 그 가운데 하나라도 10위 안. 혼잘마의 다른 화면과 같은 선입니다(순위 색 초록, AI 검색의 "10위 안 키워드",
//             "10위 안인 키워드는 바꾸지 마세요"). 좋은 지역은 순위 순으로 다른 지역보다 먼저 조합을 만듭니다.
//   나쁜 지역: 조회한 것이 모두 30위 밖·살펴본 범위 밖·목록에 없음인데 서로 다른 낱말 둘 이상이 그렇거나, 검색 결과가 내 매장에서 멀리 떨어진 곳(rankLocality 의 far).
//             한 낱말의 순위 하나(상계분식 55위)만으로는 그 지역의 다른 낱말(떡볶이·김밥)까지 막지 않습니다. 다만 그 낱말의 조합이 30위 밖으로
//             확인됐으면 같은 조합은 다시 권하지 않고 다른 지역으로 바꿉니다.
//             30위는 혼잘마가 정한 판정선입니다. 손님이 검색 결과를 몇째까지 보는지에 대한 자료는 없어(검색량·클릭 자료 없음)
//             자료로 정한 값이 아니고, "그 지역 검색에서 내 앞에 29곳 넘게 있으면 같은 지역에 조합을 더 만들기보다
//             순위가 좋은 지역에 먼저 쓰는 편이 낫다"는 판단입니다. 10위 안(좋음)과 50위 밖(순위 색 주황) 사이에 둡니다.
//   그 밖(11~30위, 조회 안 함)은 원래 순서 그대로입니다.
export const RANK_GOOD = 10;
export const RANK_WEAK = 30;
// 같은 낱말 한 개를 지역만 바꿔 권하는 칸 수(등록한 칸 포함). 가장 중요한 낱말도, 상위 매장이 그 조합을 등록한 경우도 이 수를 넘지 않습니다.
export const SAME_TERM_MAX = 2;

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
// 넓은 업종 이름. CUISINE_BROAD 는 어느 출처에서 와도 넓은 말이고, 종합·기타는 업종 이름 자리에서만 넓은 말입니다(리뷰 메뉴의 "기타"는 악기).
const CUISINE_BROAD = /^(한식|양식|일식|중식|분식|음식점|아시아음식|퓨전음식)$/;
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
const VAGUE_WORDS = ['생선', '튀김', '음식', '요리', '메뉴', '안주', '반찬', '식사', '고기', '해산물', '해물', '정식', '세트', '코스', '사이드', '구이', '볶음', '조림', '무침', '국물',
    // 시술·서비스를 두루 가리키는 말(미용·뷰티 업종의 "아트"·"케어"·"관리")
    '아트', '케어', '관리', '시술', '프로그램', '패키지'];
// 업종 이름으로 적혀 있어도 가게 종류가 아니라 재료 갈래를 말하는 낱말("육류,고기요리"·"해물,생선요리"의 육류·고기·해물·생선)
const INGREDIENT_CLASSES = ['해물', '해산물', '수산물', '생선', '어류', '고기', '육류', '축산물', '채소', '야채', '과일', '곡물'];
// 시설 조건·알리는 통로·인상·꾸밈을 말하는 낱말(관문 '파'). 가게가 무엇을 파는지나 어떤 가게인지가 아니라 "주차 돼요?"·"인스타 있어요?"처럼 조건·통로·인상이라,
// 지역을 붙여도 찾을 가게 종류가 되지 않습니다. 메뉴·시술·리뷰·상위 매장 키워드에서 온 낱말에만 걸고(업종 이름·사장님이 등록한 낱말·업종 연관어는 그대로),
// 메뉴 이름 앞의 꾸밈말("시그니처 말차라떼"의 "시그니처")은 낱말에서 떼어 뒷말("말차라떼")을 씁니다.
// (낱말은 그대로이고 묶음만 이름을 붙였습니다 — 아래 합성어 규칙이 "조건어로 끝나는 말"을 가를 때 꾸밈·크기 묶음은 빼려고)
const FACILITY_WORDS = ['주차', '주차장', '발렛', '발렛파킹', '예약', '와이파이', '화장실', '샤워실', '샤워', '락커', '락카', '사물함', '엘리베이터', '콘센트', '웨이팅', '대기', '영업시간', '휴무', '위치', '주소', '전화'];
const CHANNEL_WORDS = ['블로그', '인스타', '인스타그램', '유튜브', '카카오', '카톡', '톡톡', '홈페이지', '네이버', '쿠폰', '이벤트', '할인', '리뷰', '후기', '별점', '영수증'];
const IMPRESSION_WORDS = ['분위기', '가격', '가성비', '친절', '서비스', '청결', '위생', '인테리어', '만족', '최고', '추천', '인기', '대박', '베스트', '대표', '메인', '신상', '신메뉴', '신제품', '신규'];
const STYLE_WORDS = ['포장', '배달', '픽업', '택배', '아이스', '핫', '시그니처', '스페셜', '프리미엄', '수제', '신선한', '특제', '오리지널', '클래식', '미니', '라지', '빅', '점보', '더블', '트리플', '고급', '정통', '전통', '특선', '한정', '이달의'];
const ATTRIBUTE_WORDS = new Set([...FACILITY_WORDS, ...CHANNEL_WORDS, ...IMPRESSION_WORDS, ...STYLE_WORDS]);
// 조건·통로·인상 낱말로 끝나는 합성어("학생할인"·"첫방문이벤트"·"네이버예약"·"룸예약")는 그 낱말과 같은 종류입니다(앞말은 한 글자 이상).
// 그 매장의 업종 이름에 든 말이나, 서비스·인테리어·샤워처럼 품목 이름의 끝말이 될 수 있는 낱말("룸서비스"·"베이비샤워")은 건드리지 않습니다.
// 한 글자 꼬리(…비·…료·…권)로 가르는 규칙은 두지 않습니다(갈비·음료가 걸립니다).
// ("위치"는 "샌드위치"의 끝이라 꼬리 규칙에서 뺍니다 — 8차 S-2 로 한 줄 품목의 이유가 보이게 되며 드러난 오판정)
const TAIL_EXEMPT = ['서비스', '인테리어', '샤워', '샤워실', '대표', '메인', '위치'];
const CONDITION_TAILS = [...FACILITY_WORDS, ...CHANNEL_WORDS, ...IMPRESSION_WORDS].filter((word) => word.length >= 2 && !TAIL_EXEMPT.includes(word));
// "신선한·매콤한·매운·차가운"처럼 뒷말을 꾸미는 말(한글 + 한·운). 북한·행운 같은 낱말은 해당하지 않습니다.
const MODIFIER_SHAPE = /^[가-힣]+(한|운)$/;
const NOT_MODIFIER = ['북한', '남한', '대한', '중한', '행운', '기운', '불운', '천운', '대운'];
function isAttributeWord(word) {
    const key = compact(word);
    return ATTRIBUTE_WORDS.has(key) || (MODIFIER_SHAPE.test(key) && !NOT_MODIFIER.includes(key));
}

// 조건·행위를 말하는 합성어("주차가능"·"예약필수"·"단체환영"·"포장가능")와 영업시간 표기("24시"·"24시간"·"24시간영업")는 낱말 목록에 없어도 같은 종류입니다.
const CONDITION_COMPOUND = /^.{1,6}(가능|필수|환영|불가|금지|구비|완비|문의|안내)$/;
const TIME_NOTATION = /^\d{1,2}시(간)?(영업|운영)?$/;
const SHOP_REST = /^(가게|집|점|샵|전문점|전문|마트|상회|식당|몰)$/;

// 그 매장 자기 업종·매장 이름에 든 말인지: 업종 이름이 그 말이거나 "그 말 + 가게·집·점"이고("반찬가게"의 "반찬"), 매장 이름에 들어 있을 때.
// 이런 말은 넓은 말·지명·꾸밈말 목록보다 우선합니다. "생선회"의 "생선"처럼 뒤에 다른 낱말이 붙은 업종 이름은 해당하지 않습니다.
function ownBusinessWord(ctx, key) {
    if (ctx.leaves.some((leaf) => leaf === key || (leaf.startsWith(key) && SHOP_REST.test(leaf.slice(key.length))))) return true;
    return ctx.nameKey.includes(key);
}
// 메뉴 이름 안에 한 낱말로 붙어 있는 말("대구탕"의 "대구")인지. "전주 비빔밥"처럼 따로 띄어 쓴 앞말은 해당하지 않습니다.
function fusedInMenu(ctx, key) {
    return ctx.menus.some((menu) => wordsOf(menu.name).some((word) => word !== key && word.includes(key)));
}
// 조건·통로·인상·꾸밈 낱말인지. 등록한 낱말에는 목록·합성어·시간 표기만 적용하고, 그 밖의 출처에는 "한·운"으로 끝나는 꾸밈말도 적용합니다
// (두 글자 꾸밈말은 다른 이름 앞에 붙어 쓰일 때만: 매운 갈비찜의 "매운", 의류대여의 "가운"은 아님).
// 9차 K-A: 값·표·절차를 가리키는 이름은 낱말 목록이 아니라 닫힌 부류입니다(업종 분류 이름표와 같은 까닭 — 가게 종류나 메뉴가 아니라 "얼마·어떻게"를 말하는 이름).
//   ① 요금·이용권: 값을 뜻하는 머리말(교재·재료·레슨·수강·입장·이용·대여·대관·예약·보증·회원·체험·정기·가입·등록·관리·출장·배송… + 숫자·기간) + 꼬리(비·료·금·권) — 교재비·레슨비·예약금·회원권·월권·10회권·식대.
//      머리말이 맞을 때만 걸리므로 갈비·음료·식권 같은 낱말은 걸리지 않습니다(꼬리 한 글자만으로 가르는 규칙은 아님).
//   ② 시간 이름(…시간: 추가시간·이용시간)과 절차 이름(체크인·체크아웃·재방문·재예약·레벨테스트·주소지).
//   ③ 조건어가 앞에 붙은 합성어(셔틀·당일·방문·출장·사전·유료 + 두 글자 이상: 셔틀버스·방문견적·당일배송). 나머지 부분이 이 매장 업종·상호이거나 메뉴판의 다른 품목 끝말이면 조건이 아닙니다
//      (룸카페·포장마차·단체복 같은 진짜 업종·품목이 죽지 않게. 한 글자가 남는 셔틀콕도 걸리지 않음).
//   ④ 판촉 표지(이벤트·할인·무료·쿠폰·증정·사은품)가 어디든 든 낱말(리뷰이벤트치킨). 그 낱말 전체가 이 매장의 업종·상호이면 예외(할인마트 업종).
const FEE_HEADS = ['교재', '재료', '레슨', '수강', '입장', '이용', '대여', '대관', '예약', '보증', '회원', '체험', '정기', '가입', '등록', '관리', '출장', '배송', '설치', '보관', '연장', '추가', '초과',
    '할증', '수업', '강습', '참가', '상담', '진료', '검사', '시술', '접수', '신청', '입회', '택배', '포장', '주차', '원데이', '일일', '종일', '반일', '방문', '수수', '교육', '시험', '응시', '입학'];
const FEE_NAME = new RegExp(`(?:${FEE_HEADS.join('|')})(?:비|료|금|권)$`);
// 월권·주권·일일권·10회권·3개월권, 식대·교통비·숙박비
const PASS_NAME = /^(?:월|주|연|일일|종일|반일)권$|^\d+(?:회|개월|주|일|시간)?권$|^(?:식|숙박|교통|인건|운임)(?:대|비)$/;
const PROCEDURE_WORDS = ['체크인', '체크아웃', '재방문', '재예약', '재등록', '레벨테스트', '주소지'];
const CONDITION_LEADS = ['셔틀', '당일', '방문', '출장', '사전', '유료'];
const PROMO_MARKS = ['이벤트', '할인', '무료', '쿠폰', '증정', '사은품'];
// 낱말에서 조건어를 뗀 나머지가 이 매장의 업종·상호이거나 메뉴판의 다른 품목 끝말인지
function restIsBusiness(ctx, rest, whole) {
    // 나머지가 업종 낱말에 들어 있거나(컴퓨터수리점의 "출장수리" ← 수리) 업종 낱말을 품으면(뷔페의 "출장뷔페") 그 매장의 업종·품목 이름입니다.
    const industry = [...list(ctx.leaves), ...[...(ctx.industryKeys || [])]].filter((word) => word && word.length >= 2);
    if (industry.some((word) => word.includes(rest) || rest.includes(word))) return true;
    if (ctx.nameKey && ctx.nameKey.includes(rest)) return true;
    // 다른 메뉴판 줄의 끝말(그 낱말 자신의 줄은 제외)
    return list(ctx.menus).some((menu) => menu.key !== whole && menu.key.length > rest.length && menu.key.endsWith(rest));
}
// 위 닫힌 부류에 드는지: 'fee'(요금·이용권·시간·절차·판촉 이름) · 'lead'(조건어가 앞에 붙은 합성어) · null — 목록 낱말·합성어는 conditionKind 가 'attr' 로 따로 가립니다.
function leadOf(ctx, key) {
    const lead = CONDITION_LEADS.find((word) => key.startsWith(word) && key.length - word.length >= 2);
    return lead && !restIsBusiness(ctx, key.slice(lead.length), key) ? lead : null;
}
function costOrProcedure(ctx, key) {
    if (ownBusinessWord(ctx, key)) return null;
    if (FEE_NAME.test(key) || PASS_NAME.test(key) || PROCEDURE_WORDS.includes(key)) return 'fee';
    if (key === '시간' || (key.length >= 3 && key.endsWith('시간'))) return 'fee';
    if (PROMO_MARKS.some((mark) => key.includes(mark))) return 'fee';
    return leadOf(ctx, key) ? 'lead' : null;
}
// 'attr'(시설·통로·인상·꾸밈 낱말) · 'fee'(요금·이용권·절차·판촉 이름) · 'lead'(조건어가 앞에 붙은 합성어) · null
function conditionKind(ctx, key, { owned = false } = {}) {
    // 목록의 낱말도 그 매장 업종 이름에 들어 있으면 자기 업종의 말입니다("인테리어디자인" 업종의 "인테리어", "주차장" 업종의 "주차").
    if (ATTRIBUTE_WORDS.has(key)) return ctx.leaves.some((leaf) => leaf.includes(key)) ? null : 'attr';
    if (CONDITION_COMPOUND.test(key) || TIME_NOTATION.test(key)) return ownBusinessWord(ctx, key) ? null : 'attr';
    const tail = CONDITION_TAILS.find((word) => key.length >= word.length + 1 && key.endsWith(word));
    if (tail) return !ownBusinessWord(ctx, key) && !ctx.leaves.some((leaf) => leaf.includes(tail)) ? 'attr' : null;
    const costKind = costOrProcedure(ctx, key);
    if (costKind) return costKind;
    if (owned) return null;
    if (MODIFIER_SHAPE.test(key) && !NOT_MODIFIER.includes(key)) return key.length >= 3 || ctx.leading.has(key) ? 'attr' : null;
    return null;
}
function isConditionWord(ctx, key, options = {}) {
    return conditionKind(ctx, key, options) !== null;
}

// 메뉴 이름·리뷰 낱말에 되풀이해 나올 수 있는 지명(관문 '하'). 시·군·도 이름이라 "지역+지명"은 메뉴가 아니라 다른 지역 이름입니다("전주 비빔밥"의 "전주").
// 내 매장의 지역은 따로 거릅니다. 목록에 없는 지명은 걸리지 않습니다(전국 지명 자료가 없어 흔한 시·군·도 이름만 둠).
const PLACE_NAMES = new Set([
    '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
    '수원', '성남', '고양', '용인', '부천', '안산', '안양', '남양주', '화성', '평택', '의정부', '시흥', '파주', '김포', '광명', '군포', '하남', '오산', '양주', '이천', '구리', '안성', '포천', '의왕', '여주', '동두천', '과천', '가평', '양평', '연천',
    '춘천', '원주', '강릉', '동해', '태백', '속초', '삼척', '홍천', '횡성', '영월', '평창', '정선', '철원', '화천', '양구', '인제', '양양',
    '청주', '충주', '제천', '보은', '옥천', '영동', '증평', '진천', '괴산', '음성', '단양', '천안', '공주', '보령', '아산', '서산', '논산', '계룡', '당진', '금산', '부여', '서천', '청양', '홍성', '예산', '태안',
    '전주', '군산', '익산', '정읍', '남원', '김제', '완주', '진안', '무주', '장수', '임실', '순창', '고창', '부안',
    '목포', '여수', '순천', '나주', '광양', '담양', '곡성', '구례', '고흥', '보성', '화순', '장흥', '강진', '해남', '영암', '무안', '함평', '영광', '장성', '완도', '진도', '신안',
    '포항', '경주', '김천', '안동', '구미', '영주', '영천', '상주', '문경', '경산', '의성', '청송', '영양', '영덕', '청도', '고령', '성주', '칠곡', '예천', '봉화', '울진', '울릉',
    '창원', '진주', '통영', '사천', '김해', '밀양', '거제', '양산', '의령', '함안', '창녕', '남해', '하동', '산청', '함양', '거창', '합천', '서귀포',
    '평양', '함흥', '개성', '이북', '남도', '호남', '영남', '충청', '관동', '관서',
]);

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
    '점심', '저녁', '런치', '디너', '사이즈', '보통', '레귤러', '라지', '스몰', '미디엄', 'small', 'medium', 'large', 'regular', 'tall', 'grande', 'venti'];
// 차. 약·제품을 나누는 분류 이름과, 손님이 검색할 때 대신 쓰는 말(약국에서만). 같은 뜻의 두 말은 손님 말 하나로 씁니다(동물의약품 → 동물약국).
const CLASS_NAMES = new Map([
    ['일반의약품', '약국'], ['전문의약품', '약국'], ['안전상비의약품', '약국'], ['상비의약품', '약국'], ['상비약', '약국'], ['의약외품', '약국'],
    ['건강기능식품', '영양제'], ['동물의약품', '동물약국'], ['동물용의약품', '동물약국'],
]);

const SCOPE_LABEL = { sido: '시·도', city: '시·군', district: '구', town: '동·읍·면', station: '역 주변', branch: '지점 이름', custom: '등록 키워드에 쓴 지역' };

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
            { term: '24시동물병원', when: ['24시'], late: 23 },
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
        // onlyFor: 그 업종 이름일 때만 쓰는 연관어(PT·헬스장은 헬스·필라테스·요가 업종의 말이지 골프·수영의 말이 아님 — 업종으로 확인될 때만)
        related: [
            { term: 'PT', when: ['pt', '개인레슨', '1:1'], onlyFor: /헬스|피트니스|필라테스|요가|크로스핏|짐/ },
            { term: '헬스장', when: ['헬스'], onlyFor: /헬스|피트니스|크로스핏|짐/ },
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
        // baseFor: 업종 대표어를 쓸 수 있는 업종인지(카페는 업종 이름이 카페·커피·찻집일 때만 — 베이커리·키즈카페·북카페에는 "카페"를 대표어로 붙이지 않음)
        key: 'cafe', match: /카페|커피|디저트|베이커리|제과|찻집|케이크/, base: ['카페'],
        baseFor: (leaves) => leaves.some((leaf) => compact(leaf) === '카페' || /커피|찻집|다방/.test(leaf)),
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

// 서버가 이미 다듬어 주지만(lib/naver-place.js), 이 파일도 스스로 막아 둡니다: 리뷰 메뉴·예약 스타일·좋은 점의 count 가 없거나 글자·null 이어도 예외 없이 0으로 읽고,
// 이름(label·name)이 없는 줄은 버리고, 리뷰 메뉴는 많이 말한 순으로 줄 세웁니다(입력 순서가 정렬돼 있다고 믿지 않음).
function countOf(value) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value.replace(/,/g, '')) : value;
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function sanePlace(place) {
    if (!place || typeof place !== 'object') return place;
    const named = (items, field, extra = () => ({})) => list(items)
        .filter((item) => item && typeof item === 'object' && typeof item[field] === 'string' && item[field].trim())
        .map((item) => ({ ...item, [field]: item[field].trim(), ...extra(item) }));
    const detail = place.detail && typeof place.detail === 'object' ? place.detail : null;
    return {
        ...place,
        keywords: list(place.keywords).filter((word) => typeof word === 'string' && word.trim()).map((word) => word.trim()),
        // 횟수(count)가 없거나 0 이하인 줄은 근거가 못 되므로 뺍니다. 리뷰 메뉴·예약 스타일은 많이 말한 순으로 세웁니다(잘라 읽기 전에).
        reviewMenus: named(place.reviewMenus, 'label', (item) => ({ count: countOf(item.count) })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count),
        reviewVotes: named(place.reviewVotes, 'label', (item) => ({ count: countOf(item.count) })).filter((item) => item.count > 0),
        ...(detail ? {
            detail: {
                ...detail,
                menus: named(detail.menus, 'name'),
                styles: named(detail.styles, 'name', (item) => ({ count: countOf(item.count) })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count),
                ...(detail.pos && typeof detail.pos === 'object' ? { pos: { ...detail.pos, popularMenus: named(detail.pos.popularMenus, 'name', (item) => ({ share: Number.isFinite(item.share) ? item.share : null })) } } : {}),
            },
        } : {}),
    };
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

// "역삼1동" → "역삼", "성수동2가" → "성수", "을지로1가" → "을지로", "오창읍" → "오창", 한 글자 동("중동"·"연동")은 동 이름 그대로,
// "명동2가"·"필동1가"처럼 "동"을 떼면 한 글자만 남는 가(街) 주소도 동 이름 그대로("명동"·"필동")
function townBase(town) {
    const text = String(town || '');
    const ga = text.match(/^(.+?)(동?)\d+가$/);
    const base = ga ? ga[1] : text.replace(/\d*(동|읍|면)$/, '');
    if (base.length >= 2) return base;
    if (ga && ga[2] && /^[가-힣]$/.test(base)) return `${base}동`;
    return /^[가-힣]동$/.test(text) ? text : null;
}

// 동·읍·면 이름의 다른 표기: "성수동2가" → "성수동", "역삼1동" → "역삼동", "오창읍" → "오창읍". 손님이 쓰는 "성수동카페"의 "성수동"을 지역으로 읽게 합니다.
function townVariants(town, base) {
    const text = String(town || '');
    const stem = text.replace(/\d+(?=가$|동$)/, '');
    return [stem.replace(/가$/, ''), /동/.test(text) && !base.endsWith('동') ? `${base}동` : null].filter(Boolean);
}

function branchOf(name) {
    // 지점 이름은 매장 이름 끝에 따로 띄어 쓴 낱말("대물섬 강남점")입니다. 한 낱말 이름("대성철물점")은 상호이지 지점이 아닙니다.
    const tokens = String(name || '').trim().split(/\s+/);
    if (tokens.length < 2) return null;
    const last = tokens[tokens.length - 1] || '';
    if (!/점$/.test(last) || last.length < 3 || last.length > 8) return null;
    if (NOT_BRANCH_EXACT.includes(last) || NOT_BRANCH_SUFFIX.some((word) => last.endsWith(word))) return null;
    const base = last.replace(/점$/, '');
    return /^[가-힣]{2,7}$/.test(base) ? base : null;
}

function makeRegion(term, scope, variants = [], confirmedBy = null) {
    const all = uniqueBy([term, ...variants].map(compact).filter((v) => v.length >= 2), (v) => v);
    // confirmedBy: 이 지역을 무엇으로 확인했는지 — address(주소·지점 이름) · station(가까운 역) · rank(순위 조회 결과가 알려 준 지역) ·
    //   (되풀이되는 앞말은 지리 자료와 맞을 때만 지역이고, 그때 confirmedBy 는 그 자료: address · station · rivals(상위 매장의 주소·지역) · rank)
    return { term, scope, label: SCOPE_LABEL[scope], variants: all, used: 0, confirmedBy: confirmedBy || (scope === 'station' ? 'station' : scope === 'custom' ? 'keywords' : 'address') };
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

// 이 매장 자료로 확인된 낱말: 업종·업종 갈래(와 그 끝부분: "코인노래방"의 "노래방")·업종 대표어·연관어·메뉴판·예약 스타일·리뷰 메뉴·결제 인기 메뉴의 이름과 낱말.
// 등록·상위 매장 키워드를 "앞말 + 확인된 낱말"로 가르고 "키워드 전체가 확인된 낱말인지"를 가릴 때 씁니다. 새 낱말 목록이 아니라 이 매장 자료에서 모읍니다
// (COMMON_SUFFIXES·CLASS_NAMES 는 이미 있던 목록이라 안전망으로만 함께 둡니다). 지역 낱말(skip)은 메뉴 이름에 붙어 있어도 넣지 않습니다("전주 비빔밥"의 "전주").
// withName: 매장 이름의 끝부분도 확인된 낱말로 씁니다. 이름은 대개 상호 + 업종 낱말이라("믿음카센터"의 "카센터") 업종 이름 칸에 없는 업종 낱말을 알려 줍니다
// (키워드를 앞말과 낱말로 가를 때만 쓰고, 상호를 가릴 때는 쓰지 않습니다).
// 돌려주는 값: 긴 낱말부터 정렬한 배열
function knownWords(place, skip = [], { withName = false } = {}) {
    const words = new Set();
    const skipSet = new Set(skip);
    const add = (word) => {
        const key = compact(word);
        if (/^[가-힣a-z0-9]{2,12}$/.test(key) && !skipSet.has(key) && !PLACE_NAMES.has(key)) words.add(key);
    };
    for (const leaf of categoryLeaves(place)) {
        const key = compact(leaf);
        add(key);
        for (let size = 3; size <= key.length - 2; size += 1) add(key.slice(-size));
        // 업종 이름에서 가게 종류를 말하는 끝 글자를 뗀 줄임말("헬스장"의 "헬스")
        if (/[장실원점집방샵]$/.test(key)) add(key.slice(0, -1));
    }
    const family = familyOf(place);
    for (const word of [...(family?.base || []), ...(family?.related || []).map((item) => item.term), ...(family?.rankOnly || [])]) add(word);
    for (const word of COMMON_SUFFIXES) add(word);
    for (const word of CLASS_NAMES.keys()) add(word);
    if (withName) {
        const tokens = String(place?.name || '').trim().split(/\s+/).filter(Boolean);
        // 지점 이름("강남점")은 업종 낱말이 아니라 뺍니다.
        if (tokens.length >= 2 && /점$/.test(tokens[tokens.length - 1])) tokens.pop();
        for (const token of tokens.map(compact)) {
            if (!/^[가-힣a-z0-9]+$/.test(token)) continue;
            for (let size = 3; size <= token.length; size += 1) add(token.slice(-size));
        }
    }
    const modifiers = repeatedModifiers(place);
    const names = [
        ...list(place?.reviewMenus).map((item) => item?.label),
        ...list(place?.detail?.menus).map((item) => item?.name),
        ...list(place?.detail?.styles).map((item) => item?.name),
        ...list(place?.detail?.pos?.popularMenus).map((item) => item?.name),
    ];
    for (const name of names) {
        if (typeof name !== 'string') continue;
        add(cleanName(name, modifiers));
        for (const token of wordsOf(name)) add(token);
    }
    return [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

// 키워드 끝이 확인된 낱말(가장 긴 것)이고 그 앞에 두 글자 이상 한글이 남으면 { prefix, word }
function splitOnWord(text, words) {
    const word = words.find((item) => text.length - item.length >= 2 && text.endsWith(item));
    return word ? { prefix: text.slice(0, -word.length), word } : null;
}

// 키워드가 확인된 낱말만으로 이루어졌는지(댄디컷·일반의약품·코인노래방·대형약국)
function isExplained(text, words) {
    if (!text) return false;
    const reach = new Array(text.length + 1).fill(false);
    reach[0] = true;
    for (let end = 1; end <= text.length; end += 1) {
        reach[end] = words.some((word) => word.length <= end && reach[end - word.length] && text.endsWith(word, end));
    }
    return reach[text.length];
}

// 지역 별칭 읽기(관문 '지역은 확인된 것만'). 주소·역에 없는 앞말("홍대"·"광교"·"위례")은 목록이 아니라 이 방법으로 읽습니다:
// 같은 앞말이 등록 키워드·상위 매장 키워드에서 서로 다른 확인된 낱말(업종·품목) 앞에 되풀이되고(홍대노래방·홍대코인노래방 → 홍대),
// 그 앞말이 지리 자료와 맞을 때(geo: 내 주소·가까운 역·상위 매장의 주소·지역·순위 조회가 알려 준 지역에 그 글자가 있음)만 지역으로 인정합니다.
// 되풀이만으로는 지역을 확정하지 않습니다 — 되풀이되는 꾸밈말("수제"·"매운"·"무한리필"·"가성비")이 지역으로 읽히던 것을 막습니다.
// 지리 자료와 맞지 않는 앞말은 읽지 않아 등록 키워드가 'unknown'(지역인지 확인 못 함)이 되고, 순위 조회가 지역을 알려 주면 그때 지역이 됩니다.
// 한 번만 나온 앞말("광교카센터"의 "광교")도 같은 방식으로 지리 자료에 있을 때만 읽습니다.
//   - 앞말에 메뉴·업종 낱말이 들어 있거나("강남한우"의 "한우") 메뉴 이름·매장 이름의 일부이면 지역이 아닙니다.
//   - 상위 매장 키워드에서 읽을 때는 그 매장 자기 동네 이름은 세지 않고, 내 키워드가 하나도 없으면 서로 다른 상위 매장 둘 이상에서 되풀이될 때만 인정합니다.
function learnedRegions(place, rivals, words, knownVariants, geo = []) {
    const wordSet = new Set(words);
    const services = serviceWords(place);
    const brand = compact(place?.name);
    // 업종 이름·업종 대표어·연관어의 앞부분("남성전문미용실"의 "남성전문", "대형약국"의 "대형")은 지역이 아니라 업종 이름의 일부입니다.
    const family = familyOf(place);
    const industry = [...categoryLeaves(place), ...(family?.base || []), ...(family?.related || []).map((item) => item.term)].map(compact);
    const tally = new Map();
    const note = (keyword, store, theirs = []) => {
        const text = compact(keyword);
        if (!text || knownVariants.some((variant) => text.includes(variant)) || theirs.some((variant) => text.startsWith(variant))) return;
        if (brand.includes(text)) return; // 상호를 대표키워드로 등록한 경우
        const split = splitOnWord(text, words);
        if (!split) return;
        const { prefix, word } = split;
        if (!/^[가-힣]{2,6}$/.test(prefix) || wordSet.has(prefix)) return;
        if ([...PROMO_WORDS, ...GENERIC_WORDS].some((item) => prefix.includes(item))) return;
        if (words.some((item) => prefix.includes(item))) return;
        if (services.some((item) => item.includes(prefix) || prefix.includes(item))) return;
        if (industry.some((item) => item.includes(prefix))) return;
        const entry = tally.get(prefix) || { words: new Set(), mineWords: new Set(), stores: new Set() };
        entry.words.add(word);
        if (store === null) entry.mineWords.add(word);
        else entry.stores.add(store);
        tally.set(prefix, entry);
    };
    for (const keyword of list(place?.keywords)) note(keyword, null);
    for (const rival of list(rivals)) {
        const theirs = regionTerms({ address: rival?.area, jibunAddress: rival?.area, name: rival?.name, keywords: [] }).flatMap((region) => region.variants);
        const store = String(rival?.placeId || rival?.name || '');
        for (const keyword of list(rival?.keywords)) note(keyword, store, theirs);
    }
    // confirmedBy 는 지리 자료가 무엇이었는지(address · station · rivals · rank)입니다.
    return [...tally]
        .filter(([, entry]) => entry.words.size >= 2 && (entry.mineWords.size > 0 || entry.stores.size >= 2))
        .map(([prefix]) => {
            const hit = geo.find((item) => item.text.includes(prefix));
            return hit ? makeRegion(prefix, 'custom', [], hit.by) : null;
        })
        .filter(Boolean);
}

// 매장 주소·역·매장명에서 지역 낱말을 뽑습니다. 추천에 쓸 순서대로 돌려줍니다.
//   지방(도 아래 시·군): 시·군 → 동·읍·면 → 역 → 구
//   광역시·특별시: 역 → 구 → 동
// 사장님이 등록 키워드에 이미 쓴 지역은 맨 앞으로 옵니다.
// 지역은 확인된 것만 읽습니다(region.confirmedBy): 주소·가까운 역·지점 이름, 순위 조회 결과가 알려 준 지역, 등록·상위 매장 키워드에 되풀이되는 앞말(learnedRegions).
// 그 밖의 앞말은 지역이 아닙니다 — 등록 키워드의 끝말 목록으로 "나머지는 지역"이라고 가르지 않습니다.
export function regionTerms(place, { ranks = [], rivals = [] } = {}) {
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
    if (town) byScope.town = makeRegion(town, 'town', [parsed.town, ...townVariants(parsed.town, town)]);

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
    // 같은 뿌리의 지역은 앞선 것 하나로 합칩니다(관문 '바'). 이름이 같은 것(서초구 서초동 → "서초")뿐 아니라, 쓰는 표기가 하나라도 겹치면 같은 지역입니다:
    // 서초역(서초역·서초)과 서초구(서초)·합정역(합정역·합정)과 합정동(합정동·합정)·판교역과 판교. 손님은 "서초치과"와 "서초역치과"를 따로 찾을 수 있지만,
    // 같은 낱말에 두 표기를 모두 권하면 지역만 바꾼 중복 추천이 되고 사장님이 이미 쓴 "서초임플란트"에 "서초역임플란트"를 또 권하게 됩니다.
    const regions = [];
    for (const region of order.map((scope) => byScope[scope]).filter(Boolean)) {
        const same = regions.find((other) => other.term === region.term || other.variants.some((variant) => region.variants.includes(variant)));
        if (same) same.variants = uniqueBy([...same.variants, ...region.variants], (v) => v);
        else regions.push(region);
    }

    const known = () => regions.flatMap((region) => region.variants);
    const branch = branchOf(place?.name);
    if (branch && !known().includes(compact(branch)) && !known().includes(compact(branch.replace(/역$/, '')))) {
        regions.push(makeRegion(branch, 'branch'));
    }

    // 시·도 이름(제주·경기·부산…)은 주소에서 읽은 지역이므로, 사장님이 등록 키워드의 앞말로 쓴 경우에 한해 지역으로 읽습니다("제주게스트하우스").
    // 시·도 이름 뒤에 남는 말이 확인된 낱말(업종·품목)일 때만입니다("서울숲카페"의 "서울"은 시·도 이름이 아니라 서울숲의 앞부분).
    // "인천중구맛집"처럼 구·시 이름이 이어 붙은 표기도 같은 지역으로 봅니다.
    const words = knownWords(place, known(), { withName: true });
    if (parsed.sido && !known().includes(compact(parsed.sido))) {
        const sido = compact(parsed.sido);
        const joined = [road.district || jibun.district, road.city || jibun.city].filter(Boolean).map((name) => `${sido}${compact(name)}`);
        const used = list(place?.keywords).some((keyword) => {
            const text = compact(keyword);
            const head = [...joined, sido].sort((a, b) => b.length - a.length).find((item) => text.startsWith(item));
            return head !== undefined && isExplained(keywordCore(text.slice(head.length), regions), words);
        });
        if (used) regions.push(makeRegion(parsed.sido, 'sido', joined, 'address'));
    }

    // 등록 키워드·상위 매장 키워드에 되풀이되는 앞말(주소에 없는 "압구정"·"홍대" 같은 별칭) — 지리 자료와 맞을 때만
    const geo = [
        { by: 'address', text: compact(`${place?.address ?? ''} ${place?.jibunAddress ?? ''}`) },
        { by: 'station', text: compact(subway?.station) },
        ...list(rivals).flatMap((rival) => [rival?.area, rival?.address, rival?.jibunAddress]).map((text) => ({ by: 'rivals', text: compact(text) })),
        ...list(ranks).flatMap((row) => [row?.result?.region, ...list(row?.result?.top).map((entry) => entry?.area)]).map((text) => ({ by: 'rank', text: compact(text) })),
    ].filter((item) => item.text);
    for (const region of learnedRegions(place, rivals, words, known(), geo)) {
        if (!known().includes(compact(region.term))) regions.push(region);
    }
    // 순위를 조회한 키워드에서 네이버가 읽은 지역(result.region)이 키워드 앞에 붙어 있는데 위에서 못 읽은 지역이면 그것도 지역으로 봅니다.
    // ("압구정로데오숙성회모둠정식집"처럼 끝말을 알 수 없는 긴 키워드도, 순위 표가 "압구정"으로 읽었으면 같은 지역으로 알아봅니다.
    // 이게 없으면 진단 문장은 '압구정'을 지역으로 말하는데 등록 키워드 판정은 "지역명 없음"이라고 하게 됩니다.)
    for (const row of list(ranks)) {
        const said = String(row?.result?.region ?? '').trim();
        const text = compact(row?.keyword);
        const area = compact(said);
        if (area.length < 2 || text.length <= area.length || !text.startsWith(area) || !HANGUL_WORD.test(area)) continue;
        if (known().some((variant) => text.startsWith(variant))) continue;
        regions.push(makeRegion(said, 'custom', [], 'rank'));
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
    const result = regions
        .map((region, index) => ({ region, index }))
        .sort((a, b) => b.region.used - a.region.used || a.index - b.index)
        .map((entry) => entry.region);
    // keywordCore 가 "주엽동물병원"의 "주엽동 + 물병원"을 가려내는 데 쓰는, 이 매장에서 확인된 낱말(목록 밖 속성이라 JSON 에는 나오지 않음)
    Object.defineProperty(result, 'words', { value: words, enumerable: false });
    return result;
}

// 등록 키워드 하나의 지역 상태를 읽는 함수를 만듭니다(regions 는 regionTerms 의 결과).
//   known    키워드에 지역 낱말이 들어 있음
//   none     키워드 전체가 업종·품목·분류 낱말이거나 매장 이름이라, 지역이 없다고 말할 수 있음(댄디컷·일반의약품·상호)
//   unknown  앞에 지역일 수 있는 말이 붙었는데 지역인지 확인하지 못함(광교카센터·대전증명사진). 지역이 없다고도, 지역이라고도 말하지 않고 새 조합도 만들지 않습니다.
function regionReader(place, regions) {
    const variants = regions.flatMap((region) => region.variants);
    const words = knownWords(place, variants, { withName: true });
    // 상호 끝의 동네 이름(8차 M5': "코어 필라테스 압구정"의 "압구정" — 여러 낱말로 된 상호의 마지막 낱말)은 키워드의 끝말로만 "설명"으로 칩니다.
    // 키워드의 앞말이면("압구정필라테스") 지역이 없다고 말하지 않습니다(주소·도로명과 맞으면 known, 아니면 unknown). 업종·품목 낱말이나 상호 전체("해든식당")는 그대로 씁니다.
    const baseWords = knownWords(place, variants);
    const nameTokens = String(place?.name || '').trim().split(/\s+/).filter(Boolean);
    if (nameTokens.length >= 2 && /점$/.test(nameTokens[nameTokens.length - 1])) nameTokens.pop();
    const lastToken = nameTokens.length >= 2 ? compact(nameTokens[nameTokens.length - 1]) : '';
    const placeWords = lastToken ? words.filter((word) => word.length >= 3 && lastToken.endsWith(word) && !baseWords.includes(word)) : [];
    const solidWords = words.filter((word) => !placeWords.includes(word));
    const explained = (text) => isExplained(text, solidWords) || placeWords.some((word) => text.endsWith(word) && (text.length === word.length || isExplained(text.slice(0, -word.length), solidWords)));
    const brand = compact(place?.name);
    return (keyword) => {
        const text = compact(keyword);
        if (matchRegion(text, regions)) return 'known';
        const core = keywordCore(text, []);
        // 키워드 전체가 확인된 낱말·상호·조건 낱말("주차가능"·"24시")이면 지역이 없다고 말할 수 있습니다.
        if (!core || brand.includes(core) || explained(core) || isAttributeWord(core) || CONDITION_COMPOUND.test(core) || TIME_NOTATION.test(core)) return 'none';
        // 앞에 지역일 수 있는 말이 붙은 꼴(앞말 + 확인된 낱말)이거나, 확인된 낱말로 설명되지 않는 한글 4자 이상(앞말 두 글자 + 끝말 두 글자 이상) 키워드는
        // 끝말을 몰라도 지역이 없다고 단정하지 않습니다(판교코딩·로데오삼겹살: 이 매장 자료에 끝말이 없어도 "지역명이 없다"고 말하지 않음). 7자 이상은 한글이 아니어도 같습니다.
        const split = splitOnWord(core, words);
        return (split && /^[가-힣]{2,6}$/.test(split.prefix)) || /^[가-힣]{4,}$/.test(core) || core.length >= 7 ? 'unknown' : 'none';
    };
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
    const words = regions?.words || null;
    for (const variant of variants) {
        // "주엽동물병원"처럼 "○○동"이 지역(주엽동)과 낱말의 첫 글자(동물병원)로 모두 읽힐 수 있으면, 남는 말이 확인된 낱말인 쪽으로 뗍니다.
        // "동"을 뗀 나머지("물병원")는 확인된 낱말이 아닌데 "동"을 남긴 나머지("동물병원")가 확인된 낱말이면 "주엽"만 뗍니다.
        if (words && variant.endsWith('동') && variants.includes(variant.slice(0, -1))) {
            const at = core.indexOf(variant);
            if (at >= 0) {
                const rest = core.slice(at + variant.length);
                if (!isExplained(rest, words) && isExplained(`동${rest}`, words)) continue;
            }
        }
        // 지역 이름 뒤에 붙은 "역"(강남구의 "강남역피부과")도 같은 지역 표기로 보고 함께 뗍니다.
        core = core.split(`${variant}역`).join('').split(variant).join('');
    }
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

// 업종 묶음은 업종 이름(category)으로만 정합니다. 매장 이름은 상호라 업종을 말하지 않습니다("불꽃"이 꽃집이 되지 않게). 업종 이름이 아예 비어 있을 때만 매장 이름을 봅니다.
// 돌려주는 묶음의 base(업종 대표어)·related(업종 연관어)는 이 매장의 업종으로 확인되는 것만 남긴 것입니다(baseFor·onlyFor).
export function familyOf(place) {
    const category = String(place?.category || '');
    const found = FAMILIES.find((family) => family.match.test(category))
        || (category.trim() ? null : FAMILIES.find((family) => family.match.test(String(place?.name || ''))))
        || null;
    if (!found) return null;
    return {
        ...found,
        base: found.baseFor && !found.baseFor(categoryLeaves(place)) ? [] : found.base,
        related: found.related.filter((item) => !item.onlyFor || item.onlyFor.test(category)),
    };
}

// 업종 이름이 가게 종류가 아니라 재료 갈래를 말하는 뜻 넓은 이름인지("육류"·"고기요리"·"해물"·"생선요리"·"닭요리"). 관문 '라'의 연장으로 termVerdict 가 씁니다.
// "○○요리·○○음식·○○식품"은 ○○가 재료 갈래이거나 아주 짧은 말(닭요리·고기요리·해물요리)일 때만 넓은 이름입니다. 앞에 구체적인 말이 붙은 이름
// (베트남음식·태국음식·이탈리아음식·건강식품)은 가게 종류를 말하는 업종 이름이라 넓은 말이 아닙니다.
function isVagueCategoryName(key) {
    if (INGREDIENT_CLASSES.includes(key)) return true;
    const tail = key.match(/^(.*?)(요리|음식|식품)$/);
    if (tail && (tail[1] === '' || tail[1].length <= 1 || INGREDIENT_CLASSES.includes(tail[1]) || CUISINE_BROAD.test(tail[1]))) return true;
    return /류$/.test(key) && key.length <= 4;
}

// 질문·소식 제목처럼 손님이 검색하는 말을 적는 자리에 쓸 업종 낱말.
//   업종 이름이 모두 뜻이 넓은 말(한식·양식 같은 넓은 업종 이름이거나 육류·고기요리·해물·생선요리 같은 재료 갈래)이면 그 말 대신
//   이 매장의 중심 낱말(recommendKeywords 의 topTerm: 횟집 등)을 돌려줍니다. 일부만 넓으면 쓸 만한 업종 이름만 남깁니다.
//   업종 이름이 그대로 쓸 만하거나(미용실·약국), 중심 낱말을 못 정하면 null — 부른 쪽이 업종 이름을 그대로 씁니다.
//   키워드 추천이 쓰는 같은 규칙(BROAD_CATEGORY·isVagueCategoryName)을 불러 쓰고 새 목록을 만들지 않습니다.
export function searchCategoryWord(place) {
    const leaves = categoryLeaves(place);
    if (leaves.length === 0) return null;
    const usable = leaves.filter((leaf) => !BROAD_CATEGORY.test(compact(leaf)) && !isVagueCategoryName(compact(leaf)));
    if (usable.length === leaves.length) return null;
    if (usable.length > 0) return usable.join('·');
    return recommendKeywords({ place })?.topTerm || null;
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
        if (value) sources.push({ text: value, raw: String(text).toLowerCase(), label, keyword });
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

// 한 글자 낱말("룸")은 통째로 같거나, 문장 속에서 띄어쓰기로 나뉜 낱말이 그 글자 + 조사일 때만 근거로 봅니다("룸이 있어 회식이나…"의 "룸이").
// 글자 가운데만 겹치는 것("블룸식당"의 "룸")은 근거가 아닙니다.
// 매장 이름은 "블룸식당"의 "룸식당"처럼 우연히 겹치기 쉬워, 추천 낱말 자체는 네 글자 이상일 때만 이름에서 찾습니다.
const PARTICLES = ['이', '가', '은', '는', '을', '를', '도', '만', '에', '의', '과', '와', '으로', '로', '에서', '까지', '이나', '이라', '이며', '이고', '이라서'];
function sourceHas(source, word, { isTerm = false } = {}) {
    const key = compact(word);
    if (key.length === 1) {
        if (source.text === key) return true;
        if (source.isName) return false;
        return String(source.raw || '').split(/[^가-힣a-z0-9]+/).some((token) => token === key || (token.startsWith(key) && PARTICLES.includes(token.slice(1))));
    }
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

// 크기·등급·번호 표시가 붙은 이름("A세트"·"세트A"·"L사이즈"·"1번"·"메뉴3")은 메뉴 이름이 아니라 구분 표시라 낱말로 쓰지 않습니다.
// ("비타민C"·"오메가3"·"BLT샌드위치"처럼 영문·숫자가 이름의 일부인 것은 그대로 씁니다)
const MARKER_NAME = /^(?:[a-z0-9]{1,2}(?:세트|사이즈|코스|호|형|타입|번|단계)|(?:세트|사이즈|코스|타입|메뉴|번호)[a-z0-9]{1,2})$/i;

// 메뉴·스타일 이름 다듬기(관문 '다'·'파'): 괄호 속 덧말("(한정)"·"(100g)")·기호("★추천★")·수량과 크기("2인"·"200g"·"1인분"·"大")·1+1 을 빼고,
// 이름 맨 앞의 꾸밈말("시그니처 말차라떼"·"아이스 아메리카노"의 앞말)을 떼고, 띄어쓰기를 뺍니다. 키워드에는 띄어쓰기가 들어가지 않습니다.
//   앞말은 "서로 다른 품목 둘 이상 앞에 되풀이될 때만" 뗍니다("시그니처 말차라떼"·"시그니처 크로플"의 시그니처). 한 품목에만 붙은 앞말("핫 요가"·"클래식 기타"·
//   "수제 맥주"·"블로그 마케팅")은 이름의 일부라 그대로 둡니다. 되풀이되는지는 그 매장의 메뉴·리뷰·예약·결제 이름 전체로 봅니다(repeatedModifiers).
//   기호·이모지는 공백으로 바꿔 이름 전체가 지워지지 않게 하고("🍣 모둠초밥"), 이름 끝에 따로 떨어진 한두 글자 영문·숫자("런치 B")는 구분 표시라 뗍니다.
const ENGLISH_SIZE = /^(?:small|medium|large|regular|tall|grande|venti)$/i;
function cleanName(name, modifiers = ACTIVE_MODIFIERS) {
    const tokens = baseTokens(name);
    while (tokens.length > 1 && modifiers.has(tokens[0])) tokens.shift();
    // 따로 떨어진 한두 글자 영문·숫자 토큰("런치 B"·"A 세트")과 영어 크기 말("Cold Brew Large")은 구분 표시입니다
    const kept = tokens.filter((token) => !/^[A-Za-z0-9]{1,2}$/.test(token) && !(tokens.length > 1 && ENGLISH_SIZE.test(token)));
    return (kept.length > 0 ? kept : tokens).join('');
}

// 다듬는 순서의 앞부분: 기호·괄호·수량을 정리하고 띄어쓰기로 나눈 토큰(꾸밈말 떼기 전)
function baseTokens(name) {
    return String(name ?? '')
        .replace(/[\p{Extended_Pictographic}️‍★☆※♥♡●○◆◇■□▶▷▲△◎【】『』「」《》<>]/gu, ' ')
        .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
        .replace(/\d+\s*\+\s*\d+/g, ' ')
        .replace(/\d+(?:\.\d+)?\s*(?:인분|인용|인|개입|개|종|원|g|kg|ml|cc|l|oz|조각|판|팩|호|명)(?![가-힣a-z])/gi, ' ')
        // "2인세트"·"3종세트"의 수량 꼬리(뒷말이 세트·코스처럼 구성을 가리킬 때). "1인미용실"·"1인샵"의 "1인"은 이름의 일부라 그대로 둡니다.
        .replace(/\d+\s*(?:인|종|개)(?=세트|코스|메뉴|정식|패키지|한상)/g, ' ')
        .replace(/(?:^|\s)[大中小](?=\s|$)|[大中小]$/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

// 이 매장에서 "서로 다른 품목 둘 이상 앞에" 되풀이되는 꾸밈말(맨 앞 토큰이 꾸밈·조건 낱말이고 뒷말이 서로 다른 이름이 둘 이상인 것).
// 메뉴판·리뷰 메뉴·예약 스타일·주간 인기 메뉴의 이름을 모두 봅니다. 띄어쓰기 없이 붙여 쓴 이름은 토큰이 하나라 건드리지 않아 결과가 일관됩니다.
function repeatedModifiers(place) {
    const names = [
        ...list(place?.reviewMenus).map((item) => item?.label),
        ...list(place?.detail?.styles).map((item) => item?.name),
        ...list(place?.detail?.pos?.popularMenus).map((item) => item?.name),
        ...list(place?.detail?.menus).map((item) => (typeof item === 'string' ? item : item?.name)),
    ];
    const rests = new Map();
    for (const raw of names) {
        const tokens = baseTokens(raw);
        if (tokens.length < 2 || !isAttributeWord(tokens[0])) continue;
        const set = rests.get(tokens[0]) || new Set();
        set.add(tokens.slice(1).join(''));
        rests.set(tokens[0], set);
    }
    return new Set([...rests].filter(([, set]) => set.size >= 2).map(([token]) => token));
}
// 이 매장의 이름들에서 다른 말 앞에 붙어 쓰인 첫 토큰("매운 갈비찜"의 "매운", "핫 요가"의 "핫"). 두 글자 꾸밈말("매운")과 이름 그 자체인 말("가운")을 가르는 데 씁니다.
function leadingTokens(place) {
    const names = [
        ...list(place?.reviewMenus).map((item) => item?.label),
        ...list(place?.detail?.styles).map((item) => item?.name),
        ...list(place?.detail?.pos?.popularMenus).map((item) => item?.name),
        ...list(place?.detail?.menus).map((item) => (typeof item === 'string' ? item : item?.name)),
    ];
    return new Set(names.map(baseTokens).filter((tokens) => tokens.length >= 2).map((tokens) => compact(tokens[0])));
}
// recommendKeywords·mentionTerms 가 도는 동안 그 매장의 되풀이 꾸밈말(한 번에 한 매장만 처리하므로 모듈 변수로 둡니다)
let ACTIVE_MODIFIERS = new Set();

// 메뉴·리뷰·결제에서 온 이름이 낱말로 쓸 만한지: 다듬은 뒤 한글 2~8자이고 숫자·영문이 남지 않았을 때만 그 이름을 돌려줍니다("판교역A세트"·"3종세트"·"Latte" 같은 것은 낱말이 아님).
// 조건·꾸밈·지명 낱말은 여기서 버리지 않고 관문(termVerdict)이 이유와 함께 거릅니다.
// 영문 이름은 열 자(한글 낱말은 여덟 자)가 아니라 스무 자까지 한 낱말입니다("Iced Americano"·"Strawberry Cake") — 메뉴판 줄의 영어 이름(extraTerms)과 같은 폭입니다.
const LATIN_TERM = /^(?=.*[a-z])[a-z0-9]{2,20}$/;
function usableName(raw) {
    const name = cleanName(raw);
    const key = compact(name);
    return (TERM.test(key) || LATIN_TERM.test(key)) && !MARKER_NAME.test(key) ? name : null;
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
    return stripBrand(cleanName(name, repeatedModifiers(place)), place, said);
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
    const reviewCount = new Map(groupedCounts(list(place?.reviewMenus), (menu) => menu.label).map((entry) => [entry.key, entry.count]));
    const menuWords = menus.map((name) => ({ name, words: wordsOf(name) }));
    const feedWords = feeds.map((title) => ({ title, words: wordsOf(title) }));
    const usesOf = (word) => menuWords.filter((entry) => entry.words.includes(word)).length
        + feedWords.filter((entry) => entry.words.includes(word)).length
        + (reviewCount.get(word) || 0);
    const words = uniqueBy(menuWords.flatMap((entry) => entry.words), (word) => word);
    // 시·도 이름과 내 매장의 지역 낱말("제주 흑돼지 …"의 "제주")은 메뉴 이름이 아닙니다.
    const places = new Set(regionTerms(place).flatMap((region) => region.variants));
    // 메뉴 이름에서 품목의 머리(끝말)로 쓰인 낱말: 이름의 마지막 낱말(차림·안내 낱말은 건너뜀: "대방어 정식"의 머리는 "대방어").
    // 앞말로만 쓰이고 머리로는 한 번도 쓰이지 않은 낱말("마장동 소고기"·"마장동 육회"의 "마장동", "봉평 메밀국수"의 "봉평")은 품목이 아니라
    // 지명·원산지·꾸밈이라 되풀이돼도 낱말로 쓰지 않습니다(추천도 후보도 만들지 않고, 뺀 낱말로 이유만 남김 — 관문 'prefix').
    const headOf = (entry) => entry.words.filter((word) => !BOARD_NOTE.includes(word)).pop() || null;
    const heads = new Set(menuWords.map(headOf).filter(Boolean));
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
            // 메뉴 이름 앞에서만 쓰인 낱말(끝말로는 한 번도 안 쓰임). 손님이 더 많이 말한 다른 이름으로 바뀌었으면 그 이름은 해당하지 않습니다.
            leadingOnly: !better && !heads.has(word),
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
    const hits = usable.filter((source) => sourceHas(source, key, { isTerm: true }) || related.when.some((word) => sourceHas(source, word)));
    const hit = hits[0];
    // 첫 근거가 편의시설·좌석 같은 매장 사실뿐이면, 손님 쪽·소개 쪽 근거(리뷰·브리핑·소개글·메뉴)가 따로 있는지 하나 더 찾아 함께 보여 줍니다.
    // (그래야 "근거가 좌석 정보 하나뿐"이라는 말이 사실과 맞습니다)
    // 영업시간이 그 말을 받치면(24시동물병원: 밤 11시 넘게 여는 날이 있음) 그것이 두 번째 근거입니다(심야약국처럼 영업시간이 근거 자체).
    const hoursExtra = related.late && opensLate(place?.detail?.hours, related.late) ? { label: `${related.late}시 이후까지 영업` } : null;
    const extra = hit && thinFactLabel(hit.label) ? hits.find((other) => !thinFactLabel(other.label)) || hoursExtra : null;
    let reason = hit ? { kind: 'fact', text: hit.label } : null;
    if (!reason && related.late && opensLate(place?.detail?.hours, related.late)) reason = { kind: 'fact', text: `${related.late}시 이후까지 영업` };
    if (!reason && related.lunch && opensLunch(place)) reason = { kind: 'fact', text: '점심 시간 영업' };
    // 근거가 없으면 추천하지 않습니다(블로그에 한 번이라도 나오면 근거로 인정).
    return { hit: hit || null, extra, reason, ok: Boolean(reason) || blog > 0 };
}

// 이름별로 수를 합친 목록(많이 말한 순): 같은 낱말로 다듬어지는 이름은 한 줄로 합칩니다. 전체를 돌려주고, 자르는 것은 부르는 쪽이 합니다.
// [{ name(다듬은 이름), key, count }]
function groupedCounts(items, nameOf) {
    const byKey = new Map();
    for (const item of items) {
        const name = usableName(nameOf(item));
        if (!name) continue;
        const key = compact(name);
        const found = byKey.get(key);
        if (found) found.count += countOf(item?.count);
        else byKey.set(key, { name, key, count: countOf(item?.count) });
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count);
}

// 잘리기 전 전체 목록에서 센 수: { review: Map(낱말 → 리뷰에서 말한 횟수), booking: Map(낱말 → 누적 예약 수), pos: Map(낱말 → { rank, share, name }) }
function fullCounts(place) {
    const pos = new Map();
    list(place?.detail?.pos?.popularMenus).forEach((item, index) => {
        const name = usableName(popularMenuTerm(item?.name, place));
        if (name && !pos.has(compact(name))) pos.set(compact(name), { rank: index + 1, share: Number.isFinite(item?.share) ? item.share : null, name: String(item.name).trim() });
    });
    return {
        review: new Map(groupedCounts(list(place?.reviewMenus), (menu) => menu.label).map((entry) => [entry.key, entry.count])),
        booking: new Map(groupedCounts(list(place?.detail?.styles), (style) => style.name).map((entry) => [entry.key, entry.count])),
        pos,
    };
}

// 낱말 후보. source: category(업종) · family(업종 대표어) · registered(등록 키워드) · style(예약 스타일) ·
// review(리뷰 언급) · pos(주간 인기 메뉴) · related(업종 연관어) · rankOnly(순위 확인용)
// 소문자로 줄인 낱말(core)이 키워드의 어느 부분인지 찾아 원래 대소문자 그대로 돌려줍니다("송파PT", "pt" → "PT"). 못 찾으면 core 그대로.
function casedPart(keyword, core) {
    const squeezed = String(keyword ?? '').replace(/\s+/g, '');
    const at = squeezed.toLowerCase().indexOf(core);
    return at >= 0 ? squeezed.slice(at, at + core.length) : core;
}

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

    const readRegion = regionReader(place, regions);
    for (const keyword of list(place?.keywords)) {
        // 앞에 지역일 수 있는 말이 붙었는데 지역인지 확인하지 못한 키워드(광교카센터)는 낱말과 지역을 가를 수 없어 새 조합의 재료로 쓰지 않습니다.
        if (readRegion(keyword) === 'unknown') continue;
        const core = keywordCore(keyword, regions);
        // 낱말은 소문자로 줄인 core 가 아니라 사장님이 쓴 대소문자 그대로 화면에 나옵니다("송파PT" → "PT").
        if (core.length >= 2 && core.length <= 10) add(casedPart(keyword, core), 'registered', 50, { kind: 'registered', text: '등록 키워드의 낱말' }, { owned: true });
    }

    // 예약 스타일·리뷰에 나온 메뉴: 다듬은 뒤 같은 이름("아이스 아메리카노"·"아메리카노")은 수를 합쳐 한 줄로 씁니다(근거 칩이 "리뷰 50회 | 리뷰 30회 | 리뷰 5회"로 나뉘지 않게).
    // 많이 말한 순으로 줄 세운 뒤 자릅니다(입력 순서를 믿지 않음).
    // 조건·요금·꾸밈 줄("지명 디자이너"·"학생할인")이 상위 자리를 차지해 진짜 품목이 밀리지 않게, 조건 줄을 거른 뒤 상위 5개를 봅니다(조건 줄도 관문이 이유와 함께 거르도록 따로 몇 개 더 둠).
    const conditionCtx = { leaves: categoryLeaves(place).map(compact), nameKey: compact(place?.name), leading: leadingTokens(place) };
    const isConditionLine = (name) => isConditionWord(conditionCtx, compact(name));
    const styleAll = groupedCounts(list(place?.detail?.styles), (style) => style.name);
    const styles = [...styleAll.filter((style) => !isConditionLine(style.name)).slice(0, 5), ...styleAll.filter((style) => isConditionLine(style.name)).slice(0, 3)];
    const styleMax = Math.max(1, ...styles.map((style) => style.count));
    for (const style of styles) {
        add(style.name, 'style', 34 + Math.round((14 * style.count) / styleMax), { kind: 'booking', text: `예약 ${style.count.toLocaleString('ko-KR')}건` }, { said: style.count });
    }

    const reviewed = groupedCounts(list(place?.reviewMenus), (menu) => menu.label).slice(0, 8);
    const reviewMax = Math.max(1, ...reviewed.map((menu) => menu.count));
    for (const menu of reviewed) {
        add(menu.name, 'review', 30 + Math.round((18 * menu.count) / reviewMax), { kind: 'review', text: `리뷰 ${menu.count.toLocaleString('ko-KR')}회` }, { said: menu.count });
    }

    // 주간 인기 메뉴는 결제 단말에 적힌 이름 그대로라, 괄호·띄어쓰기·수량과 앞에 붙은 매장 이름을 다듬어 씁니다.
    const popularAll = uniqueBy(list(place?.detail?.pos?.popularMenus)
        .map((item) => popularMenuTerm(item.name, place))
        .filter((name) => TERM.test(compact(name)) && !/[0-9a-z]/i.test(name)), compact);
    const popular = [...popularAll.filter((name) => !isConditionLine(name)).slice(0, 3), ...popularAll.filter((name) => isConditionLine(name)).slice(0, 2)];
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
        // 근거(메뉴판 항목·소식·리뷰 언급)가 여러 개일수록 점수를 더합니다: 근거 하나에 4점, 다섯 개째에서 멈춤(리뷰로 오는 낱말의 가중치 30~48과 같은 눈금).
        add(entry.term, 'board', 30 + Math.min(20, 4 * entry.uses), first, { said: entry.uses });
        terms.get(key).reasons.push(...rest);
        // 근거 점수는 근거 칩에 적는 앞의 2개·1개가 아니라 그 낱말이 든 메뉴 이름·소식 제목 전부로 셉니다.
        terms.get(key).board = { menus: entry.menus, feeds: entry.feeds };
        if (entry.leadingOnly) terms.get(key).leadingOnly = true;
    }

    // 근거는 전체 목록에서: 후보는 리뷰 메뉴 상위 8개·예약 스타일 상위 5개·주간 인기 메뉴 3개로 만들지만, 이미 후보가 된 낱말(등록 키워드·업종 연관어…)이
    // 그 밖에서 받은 리뷰·예약·결제 근거도 적습니다(미용실의 등록 키워드 "볼륨매직": 예약 214건·리뷰 299회).
    const counts = fullCounts(place);
    for (const term of terms.values()) {
        if (term.source === 'rankOnly') continue;
        const review = counts.review.get(term.key);
        if (review > 0 && !term.reasons.some((reason) => reason.kind === 'review')) {
            // 같은 사실을 매장 정보 문구("리뷰에 '젤네일' 100회")로 한 번 더 적고 있었다면 그것은 뺍니다.
            term.reasons = term.reasons.filter((reason) => !(reason.kind === 'fact' && /^리뷰에 '/.test(reason.text)));
            term.reasons.push({ kind: 'review', text: `리뷰 ${review.toLocaleString('ko-KR')}회` });
            term.said = Math.max(term.said || 0, review);
        }
        const booking = counts.booking.get(term.key);
        if (booking > 0 && !term.reasons.some((reason) => reason.kind === 'booking')) {
            term.reasons.push({ kind: 'booking', text: `예약 ${booking.toLocaleString('ko-KR')}건` });
            term.said = Math.max(term.said || 0, booking);
        }
        if (counts.pos.has(term.key) && !term.reasons.some((reason) => reason.kind === 'pos')) term.reasons.push({ kind: 'pos', text: '주간 인기 메뉴' });
    }

    const mentions = mentionMap(activity);
    const sources = evidenceSources(place, activity);
    for (const related of family?.related || []) {
        const key = compact(related.term);
        const { hit, extra, reason, ok } = relatedSupport(related, { place, sources, blog: mentions.get(key) });
        if (!ok) continue;
        // 이미 등록 키워드로 올라온 낱말이면 "등록 키워드 '○○'" 근거를 한 번 더 붙이지 않습니다.
        // 이미 리뷰 수로 올라온 낱말이면 같은 사실("리뷰에 '젤네일' 100회")을 두 번 적지 않습니다.
        const existing = terms.get(key);
        const repeated = (hit?.keyword && existing?.reasons.some((r) => r.kind === 'registered'))
            || (existing?.reasons.some((r) => r.kind === 'review') && /^리뷰에 '/.test(reason?.text || ''));
        add(related.term, 'related', 34, repeated ? null : reason, hit?.keyword ? { fromKeyword: compact(hit.keyword) } : {});
        if (extra && !repeated) add(related.term, 'related', 34, { kind: 'fact', text: extra.label });
    }

    for (const word of family?.rankOnly || []) {
        add(word, 'rankOnly', 52, { kind: 'rank', text: '순위 확인용 낱말(대표키워드 등록은 권하지 않음)' }, { registrable: false });
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

// 추가 낱말(7차 M3·s3, 8차 N2·S-2·S-3): 낱말 후보를 모을 때 따져 보지 않던 낱말 둘 —
//   ① 메뉴판에 한 줄뿐인 품목·영어 메뉴판(되풀이돼야 낱말이 되는 board 에 못 든 줄): 줄의 머리(끝말, 차림·크기 낱말을 뺀 마지막 낱말)를 낱말로 삼습니다.
//      영어 메뉴("Eggs Benedict")는 마지막 낱말이 아니라 이름 전체를 원래 표기 그대로 한 낱말로 씁니다.
//   ② 리뷰 메뉴 상위 8개 밖의 낱말(8개에서 끊어 후보 칸이 남는데도 사라지던 것).
// 상위 매장 두 곳 이상이 쓰는 말은 recommendKeywords 가 보통 낱말처럼 terms 에 넣어(추천이 될 수 있음) 관문·두 쪽 확인을 받고, 나머지는 후보(lacks menu·voice…)로만 다룹니다.
// 관문에 걸린 한 줄 품목은 이유와 함께 excluded 에 남깁니다(같은 이유는 한 줄로 묶음).
const EXTRA_TERM = /^[가-힣a-z0-9]{2,20}$/;
function extraTerms(place, taken, mentions) {
    const out = [];
    const seen = new Set(taken);
    const push = (term) => {
        const key = compact(term.term);
        if (seen.has(key) || !EXTRA_TERM.test(key) || (key.length > 12 && !/^[a-z0-9]+$/.test(key)) || MARKER_NAME.test(key) || /^\d+$/.test(key)) return;
        seen.add(key);
        out.push({ ...term, term: String(term.term).replace(/\s+/g, ''), key, registrable: true, ...(mentions.get(key) !== undefined ? { blog: mentions.get(key) } : {}) });
    };
    const lines = uniqueBy(list(place?.detail?.menus).map((menu) => String(menu?.name || '').trim()).filter(Boolean), compact).filter((name) => !EXTRA_MENU.test(compact(name))).slice(0, 80);
    // 줄의 머리 낱말. 원래 표기 그대로(소문자로 줄이지 않음): "MRI"가 "mri"로 나오지 않게.
    const headOf = (text) => {
        const tokens = baseTokens(text).filter((token) => {
            const key = compact(token);
            return key && !/^\d+$/.test(key) && !BOARD_NOTE.includes(key) && !SHOP_REST.test(key);
        });
        if (tokens.length === 0) return null;
        const latin = tokens.every((token) => /^[A-Za-z0-9&-]+$/.test(token)) && tokens.some((token) => /[A-Za-z]/.test(token));
        return latin ? tokens.join('') : tokens[tokens.length - 1];
    };
    // "A + B" 꼴 줄(8차 관찰 ②: "(한정) 자연산 붉바리회 + 미역국")은 앞의 A 만 그 줄의 품목입니다. 뒤의 곁 낱말 B 는 다른 줄의 품목이거나 리뷰 메뉴에 나올 때만 낱말이 됩니다
    // (괄호 안의 "광어+시마아지"와 "1+1"은 줄을 가르지 않습니다).
    const reviewKeys = list(place?.reviewMenus).map((menu) => compact(menu?.label)).filter(Boolean);
    const split = lines.map((raw) => ({
        raw,
        parts: raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\d+\s*\+\s*\d+/g, ' ').split(/\s*\+\s*/).map((part) => part.trim()).filter(Boolean),
    }));
    const ownHeads = new Set(split.map(({ raw, parts }) => compact(headOf(parts.length > 1 ? parts[0] : raw) || '')).filter(Boolean));
    for (const { raw, parts } of split) {
        const heads = parts.length > 1 ? parts.map(headOf) : [headOf(raw)];
        heads.forEach((head, at) => {
            if (!head) return;
            const key = compact(head);
            if (at > 0 && !ownHeads.has(key) && !reviewKeys.some((chip) => chip === key || (chip.length >= 2 && key.length >= 2 && (chip.includes(key) || key.includes(chip))))) return;
            push({ term: head, source: 'board', weight: 20, reasons: [{ kind: 'fact', text: `메뉴 '${raw}'` }], said: 0, lineOnly: true });
        });
    }
    const reviewed = groupedCounts(list(place?.reviewMenus), (menu) => menu.label);
    for (const entry of reviewed.slice(8, 16)) {
        push({ term: entry.name, source: 'review', weight: 22, reasons: [{ kind: 'review', text: `리뷰 ${entry.count.toLocaleString('ko-KR')}회` }], said: entry.count, overflow: true });
    }
    return out;
}

// 블로그 언급 수를 물어볼 낱말(지역을 뺀 낱말, 최대 max 개). 서버가 활동 묶음 요청에 함께 싣습니다.
// 쓸모 관문에서 걸러질 낱말(횟집의 "김밥")은 묻지 않습니다. 사장님이 등록한 키워드의 낱말은 진단에 쓰므로 그대로 묻습니다.
export function mentionTerms(rawPlace, max = 8) {
    const place = sanePlace(rawPlace);
    ACTIVE_MODIFIERS = repeatedModifiers(place);
    const regions = regionTerms(place);
    const family = familyOf(place);
    const terms = collectTerms(place, null, regions);
    // 근거가 얇아 추천에서 빠질 낱말(관문 '타')도 블로그 언급 수를 물어봐야 근거가 생기므로, 여기서는 그 관문을 건너뜁니다.
    const { passed } = gateTerms({ ...gateContext(place, null, regions), skipThin: true }, terms);
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

// 낱말 끝 글자의 받침: none(없음) · rieul(ㄹ 받침) · batchim(그 밖의 받침). 한글이 아니면 읽는 소리로 봅니다.
//   숫자: 영·일·삼·육·칠·팔은 받침이 있고(일·칠·팔은 ㄹ) 이·사·오·구는 없음 / 알파벳: L·R(엘·알)은 ㄹ, M·N(엠·엔)은 받침, 나머지(에이·비·씨…)는 없음.
//   그 밖의 글자는 받침이 있는 것으로 둡니다.
const DIGIT_BATCHIM = ['batchim', 'rieul', 'none', 'batchim', 'none', 'none', 'batchim', 'rieul', 'rieul', 'none'];
function batchimOf(word) {
    const char = String(word ?? '').trim().slice(-1);
    const code = char.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171) return code % 28 === 0 ? 'none' : code % 28 === 8 ? 'rieul' : 'batchim';
    if (/[0-9]/.test(char)) return DIGIT_BATCHIM[Number(char)];
    if (/[a-z]/i.test(char)) return /[lr]/i.test(char) ? 'rieul' : /[mn]/i.test(char) ? 'batchim' : 'none';
    return 'batchim';
}

// 받침에 따른 조사: p('약국', '은', '는') → '은'
function p(word, withBatchim, withoutBatchim) {
    return batchimOf(word) === 'none' ? withoutBatchim : withBatchim;
}

// '(으)로': 받침이 없거나 ㄹ 받침이면 '로'
function ro(word) {
    return batchimOf(word) === 'batchim' ? '으로' : '로';
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
            // "○○집"의 앞말은 갈래 사전(DISH_HEADS)에 있는 끝말로 끝날 때만 갈래입니다(횟집·국밥집·치킨집). 빵집·삼겹살집·고깃집은 갈래로 읽지 않습니다.
            // "맛집"처럼 갈래가 아닌 앞말은 사이시옷을 떼기 전에 거릅니다(떼면 "마"처럼 깨짐).
            const head = shop[1].slice(0, -1) + dropSaisiot(shop[1].slice(-1));
            if (!NOT_GENRE.includes(shop[1]) && !NOT_GENRE.includes(head) && DISH_HEADS.some((item) => head.endsWith(item))) found.push({ mark: head, from, fromWord });
            return;
        }
        const head = [...DISH_HEADS].sort((a, b) => b.length - a.length).find((item) => key.endsWith(item));
        if (head) found.push({ mark: head, from, fromWord });
    };
    for (const leaf of categoryLeaves(place)) if (!BROAD_CATEGORY.test(leaf)) read(leaf, `업종 '${leaf}'`);
    // 앞에 지역일 수 있는 말이 붙었는데 지역인지 확인하지 못한 키워드(압구정횟집)는 낱말과 지역을 가를 수 없어 갈래를 읽지 않습니다.
    const readRegion = regionReader(place, regions);
    for (const keyword of list(place?.keywords)) {
        if (readRegion(keyword) === 'unknown') continue;
        const core = keywordCore(keyword, regions);
        if (core) read(core, `등록 키워드의 '${core}'`);
    }
    // 매장 이름에서는 갈래를 만들지 않습니다(상호는 낱말이 아니라 "황제삼겹살집"의 "삼겹살"이 갈래 이름에 섞이던 문제). 업종·등록 키워드에서만 읽습니다.
    const marks = uniqueBy(found.map((entry) => entry.mark), (mark) => mark);
    if (marks.length === 0) return null;
    const items = menus.filter((menu) => wordsOf(menu.name, { keepBrackets: true }).some((word) => hasMark(word, marks))).map((menu) => menu.key);
    if (items.length === 0) return null;
    return { marks, label: marks.join('·'), from: found[0].from, fromWord: found[0].fromWord, items, total: menus.length };
}

// 매장 이름에서 상호로 볼 조각: 이름 전체 · 첫 낱말 · 지점 이름을 뗀 이름("대물섬 강남점" → "대물섬강남점"·"대물섬")
function brandKeysOf(place) {
    const name = String(place?.name || '').trim();
    const tokens = name.split(/\s+/).map(compact).filter(Boolean);
    const keys = new Set([compact(name), tokens[0]]);
    if (tokens.length >= 2 && /점$/.test(tokens[tokens.length - 1])) keys.add(tokens.slice(0, -1).join(''));
    return [...keys].filter((key) => key && /^[가-힣a-z0-9]{2,}$/.test(key));
}

// 메뉴판·예약 스타일·결제 인기 메뉴의 품목 이름(다듬은 이름과 낱말). 낱말이 "실제 품목으로 있는 말"인지 가릴 때 씁니다(확인 관문).
function itemIndex(place) {
    const modifiers = repeatedModifiers(place);
    // raw: 괄호 덧말만 뗀 원래 이름. cleanName 은 따로 떨어진 한두 글자 영문·숫자 토큰("3D 체형분석"의 "3D")을 떼어 "체형분석"만 남기므로, 리뷰의 "3D체형분석"이 메뉴판에 있어도
    // 다듬은 이름만으로는 같은 품목으로 보지 못합니다. 원래 이름도 함께 비교합니다.
    const make = (raw) => ({
        name: String(raw ?? '').trim(),
        key: compact(cleanName(raw, modifiers)),
        raw: compact(String(raw ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')),
        tokens: uniqueBy([...wordsOf(raw), ...baseTokens(raw).map(compact)], (token) => token).filter((token) => token.length >= 2),
    });
    const namesOf = (items) => list(items).map((item) => (typeof item === 'string' ? item : item?.name)).filter((name) => typeof name === 'string' && name.trim());
    return {
        menus: namesOf(place?.detail?.menus).map(make),
        styles: namesOf(place?.detail?.styles).map(make),
        pos: namesOf(place?.detail?.pos?.popularMenus).map((raw) => ({ ...make(raw), key: compact(popularMenuTerm(raw, place)) })),
    };
}

// 관문이 보는 매장 자료 묶음
function gateContext(place, activity, regions) {
    const menus = uniqueBy(
        list(place?.detail?.menus).map((menu) => ({ name: String(menu.name ?? ''), key: compact(menu.name), recommended: menu.recommended === true })).filter((menu) => menu.key),
        (menu) => menu.key,
    );
    const family = familyOf(place);
    const items = itemIndex(place);
    const words = knownWords(place, regions.flatMap((region) => region.variants));
    const industryKeys = new Set([
        ...categoryLeaves(place).map(compact),
        ...(family?.base || []).map(compact),
        ...(family?.related || []).map((item) => compact(item.term)),
        ...(family?.rankOnly || []).map(compact),
    ]);
    return {
        place,
        family,
        // 확인 관문: 품목 자료(메뉴판·예약 스타일·결제 인기 메뉴)와 업종 낱말, 상호(업종·품목 낱말로만 이루어진 이름 조각은 상호로 보지 않음)
        items,
        hasItemData: items.menus.length + items.styles.length + items.pos.length > 0,
        words,
        brandKeys: brandKeysOf(place).filter((key) => !industryKeys.has(key) && !isExplained(key, words)),
        industryKeys,
        leaves: categoryLeaves(place).map(compact),
        nameKey: compact(place?.name),
        intro: compact(place?.intro),
        menus,
        genre: mainGenre(place, regions, menus, family),
        hours: place?.detail?.hours || null,
        sources: evidenceSources(place, activity),
        mentions: mentionMap(activity),
        blogTotal: activity?.mentions?.blogTotal ?? null,
        // 잘리기 전 전체 목록에서 센 수(근거 점수·근거 칩이 씁니다): 리뷰에 나온 메뉴·예약 스타일 수와 주간 인기 메뉴의 순위·비중
        counts: fullCounts(place),
        // 다른 말 앞에 붙어 쓰인 첫 토큰(꾸밈말 판정)
        leading: leadingTokens(place),
        // 관문을 통과한 등록 키워드의 낱말. 다른 낱말("소금김밥")의 주력 근거가 됩니다.
        trusted: [],
        // 후보 낱말 전체(gateTerms 가 채움). 분류 이름을 손님 말로 바꿔 줄 때 그 말이 후보에 있는지 봅니다.
        candidates: new Map(),
        // 등록 키워드에서 지역을 뗀 낱말(업종 이름이 내 매장 자료에 나오는지 볼 때 씁니다)
        keywordCores: list(place?.keywords).map((keyword) => keywordCore(keyword, regions)).filter(Boolean),
        // 상위 매장·순위 자료가 있는 최종 단계인지(recommendKeywords 가 정함). 첫 분석에서는 false.
        final: false,
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

// 리뷰 비중으로 본 주력(8차 M9'): 그 낱말이 든 리뷰 메뉴의 언급 합이, 이 매장 주력 가족(업종 이름·믿는 등록 낱말로 끝나는 리뷰 메뉴)의 1/3 이상이면 주력입니다.
// 주력 가족이 리뷰 전체의 1/3에도 못 미치면(가족을 믿을 수 없으면) 리뷰 전체와 견줍니다(국숫집 업종인데 업종 이름이 "아시아음식"이라 가족이 없는 매장의 쌀국수 100회 ← 전체 280회).
// 주력 가족을 알 수 없을 때 리뷰 메뉴가 이보다 적으면(세 개뿐인 리뷰에서 1위가 우연히 다른 업종 메뉴일 수 있음) 비중을 따지지 않습니다.
const REVIEW_SHARE_MIN = 5;
function reviewCountOf(ctx, word) {
    return [...ctx.counts.review].filter(([chip]) => chip.includes(word)).reduce((sum, [, count]) => sum + count, 0);
}
function reviewMain(ctx, word) {
    const said = reviewCountOf(ctx, word);
    if (!(said > 0)) return false;
    const anchors = uniqueBy([...ctx.leaves.filter((leaf) => !BROAD_CATEGORY.test(leaf)), ...ctx.trusted.filter((core) => core.length >= 2)], (item) => item);
    const family = [...ctx.counts.review].filter(([chip, count]) => count > 0 && !chip.includes(word) && hasAnchor(chip, anchors)).reduce((sum, [, count]) => sum + count, 0);
    const total = [...ctx.counts.review.values()].reduce((sum, count) => sum + count, 0);
    // 주력 가족이 리뷰 전체의 1/3 이상이면 가족과 견주고, 아니면(가족을 알 수 없음) 리뷰 메뉴가 충분히 많을 때만 전체와 견줍니다.
    const base = family >= total * MAIN_MENU_SHARE ? family : ctx.counts.review.size >= REVIEW_SHARE_MIN ? total : Infinity;
    return said >= base * MAIN_MENU_SHARE;
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

// 키워드로는 빼지만 글에는 쓰기 좋은 자리(처방전이 "메뉴 설명·소식·소개글에 쓰세요"로 옮김)
const USE_IN = ['메뉴 설명', '소식', '소개글'];
const USE_SENTENCE = `${USE_IN.join('·')}에는 쓰기 좋은 낱말입니다.`;

// 손님이 이 낱말들(묶인 낱말 전체)의 메뉴를 찾는다는 사실: 리뷰에 나온 메뉴의 언급 수, 주간 인기 메뉴 순위·비중, 네이버 AI 브리핑 문장.
// 자료에 있는 값만 적고, 없는 것은 null 입니다. 메뉴판에서 그 낱말이 든 메뉴 수도 함께 셉니다.
// 돌려주는 값: { popular(리뷰·결제·브리핑 중 하나라도 있으면 구조화한 값, 없으면 null), parts(문장에 적을 조각) }
// 메뉴판 한 줄에서만 나온 낱말인지(excluded 의 board): 메뉴판 한 줄(lineOnly)이면서 손님이 찾는다는 자료(리뷰 메뉴 언급·주간 인기 메뉴·AI 브리핑)가 하나도 없을 때만입니다.
// (메뉴 "칼국수"가 메뉴판 한 줄로 낱말이 됐어도 리뷰에 '칼국수' 4회가 있으면 손님 쪽 근거가 있어 board 가 아닙니다)
function boardOnly(ctx, term) {
    return term.lineOnly === true && !popularityOf(ctx, [term]).popular;
}

function popularityOf(ctx, terms) {
    const keys = [...new Set(terms.map((term) => term.key))];
    const place = ctx.place;
    const said = list(place?.reviewMenus)
        .map((menu) => ({ key: compact(cleanName(menu.label)), label: cleanName(menu.label), count: menu.count }))
        .filter((entry) => entry.key && Number.isFinite(entry.count));
    const reviewHits = uniqueBy(keys.map((key) => said.find((entry) => entry.key === key)).filter(Boolean), (entry) => entry.key)
        .sort((a, b) => b.count - a.count);
    const topReview = reviewHits[0] || null;
    const pos = list(place?.detail?.pos?.popularMenus).map((menu, index) => ({
        name: String(menu?.name ?? '').trim(),
        key: compact(popularMenuTerm(menu?.name, place)),
        rank: index + 1,
        share: Number.isFinite(menu?.share) ? menu.share : null,
    }));
    const posHit = pos.find((entry) => entry.key && keys.some((key) => entry.key.includes(key))) || null;
    const briefing = ctx.sources.some((source) => source.label === '네이버 AI 브리핑' && keys.some((key) => source.text.includes(key)));
    const parts = [];
    if (topReview) parts.push(`리뷰 ${reviewHits.map((entry) => `'${entry.label}' ${entry.count.toLocaleString('ko-KR')}회`).join('·')}`);
    if (posHit) parts.push(`주간 인기 메뉴 ${posHit.rank}위 '${posHit.name}'${posHit.share !== null ? ` 주문의 ${posHit.share}%` : ''}`);
    const customers = parts.length > 0;
    if (customers && briefing) parts.push('AI 브리핑에도 나옴');
    const reviewRank = topReview ? said.filter((entry) => entry.count > topReview.count).length + 1 : null;
    const popular = customers || briefing
        ? {
            reviews: topReview ? topReview.count : null,
            reviewWord: topReview ? topReview.label : null,
            reviewRank,
            posRank: posHit ? posHit.rank : null,
            posShare: posHit ? posHit.share : null,
            posName: posHit ? posHit.name : null,
            briefing,
        }
        : null;
    // 많이 찾는다고 적는 선: 리뷰에 나온 메뉴 가운데 1위이거나 주간 인기 메뉴 3위 안. 그보다 낮으면 "나오는 메뉴"라고만 적습니다.
    const strong = reviewRank === 1 || (posHit !== null && posHit.rank <= 3);
    return { popular, customers, strong, parts, where: topReview && posHit ? '리뷰·결제' : topReview ? '리뷰' : posHit ? '주간 결제' : '' };
}

// 이유 문장의 첫머리: "'김밥'·'소금김밥'은 손님이 많이 찾는 메뉴입니다(리뷰 '김밥' 37회, 주간 인기 메뉴 1위 '소금김밥' 주문의 12%, AI 브리핑에도 나옴)."
function popularLead(names, last, pop) {
    if (!pop.popular) return '';
    const what = pop.strong ? '손님이 많이 찾는' : pop.customers ? `${pop.where}에 나오는` : '네이버 AI 브리핑에 나오는';
    return `${names.join('·')}${p(last, '은', '는')} ${what} 메뉴입니다${pop.parts.length > 0 ? `(${pop.parts.join(', ')})` : ''}.`;
}

// 근거 하나가 "매장 사실"일 때 문장에 적는 이름(편의시설·좌석·매장 특징·매장 이름·반려동물). 손님 말·소개글·메뉴·등록 키워드·영업시간이면 null
function thinFactLabel(text) {
    const field = (label) => text.match(new RegExp(`^${label} '(.+)'$`))?.[1];
    if (field('편의시설')) return `편의시설 정보 '${field('편의시설')}'`;
    if (field('좌석')) return `좌석 정보 '${field('좌석')}'`;
    if (field('매장 특징')) return `매장 특징 '${field('매장 특징')}'`;
    if (text === '매장 이름') return '매장 이름';
    if (text === '반려동물 동반 가능') return "'반려동물 동반 가능' 표시";
    // 점심에 여는 가게는 많아 영업시간만으로는 이 말을 고를 이유가 못 됩니다(밤늦게까지 여는 약국의 "심야약국"은 그 시각이 근거 자체라 걸지 않음).
    if (text === '점심 시간 영업') return '점심 시간 영업(영업시간)';
    return null;
}

// 손님이 찾는 메뉴를 키워드에서 빼는 이유 문장을 사실(lead)·이유(why)·쓸 자리(use)로 나눠 만듭니다.
//   reason = lead + "다만 " + why + use (사실이 없으면 why + use). 화면은 lead·why·useIn 을 따로 그리고, 처방전과 테스트는 reason 전체를 씁니다.
//   whyOf(names, last, hasLead, many): 이유 한 문장(사실 문장이 있으면 낱말을 되풀이하지 않게 "이 말로"·"이 낱말은") / needUse(pop): 쓸 자리를 안내할지
//   group: 한 줄로 묶인 낱말들(없으면 이 낱말 하나, null 이면 사실 없이 — 같은 이유끼리 묶는 비교용)
function factual(ctx, term, whyOf, needUse) {
    const compose = (names, last, group) => {
        const terms = group === null ? null : (group || [term]);
        const pop = terms ? popularityOf(ctx, terms) : null;
        const lead = pop ? popularLead(names, last, pop) : '';
        const why = whyOf(names, last, Boolean(lead), terms ? terms.length > 1 : names.length > 1);
        const use = pop && needUse(pop) ? USE_SENTENCE : '';
        return { lead, why, reason: [lead, lead ? `다만 ${why}` : why, use].filter(Boolean).join(' ') };
    };
    return {
        tell: (names, last, into, group) => compose(names, last, group).reason,
        sentenceOf: (names, last, group) => {
            const { lead, why } = compose(names, last, group);
            return { ...(lead ? { lead } : {}), why };
        },
    };
}

// excluded 항목에 더하는 구조화한 사실(처방전이 씀): words(묶인 낱말), popular(손님이 찾는다는 사실), useIn(대신 쓸 자리)
// menus: 메뉴판에서 그 낱말이 든 메뉴 수(읽어 온 메뉴 menuTotal 개 중)
function factsOf(ctx, group) {
    const { popular } = popularityOf(ctx, group);
    const keys = group.map((term) => term.key);
    const menus = ctx.menus.filter((menu) => keys.some((key) => menu.key.includes(key))).length;
    return {
        words: group.map((term) => term.term),
        ...(popular ? { popular: { ...popular, menus, menuTotal: ctx.menus.length } } : {}),
        // 메뉴판에 한 줄에서만 나온 낱말(boardOnly)만 든 줄은 손님이 찾는다는 자료(리뷰·결제·브리핑)가 없어 "쓰기 좋은 곳"을 권하지 않습니다(8차 S-2).
        ...(popular || (menus > 0 && !group.every((term) => boardOnly(ctx, term))) ? { useIn: [...USE_IN] } : {}),
    };
}

// ---------------------------------------------------------------------------
// 확인 관문 — 추천(items)은 "이 매장이 파는 것·하는 것으로 확인된 말"만, 나머지는 후보(candidates)로 돌려줍니다.
//   confirmedBy: industry(업종·업종 갈래·업종 대표어·업종 연관어) · registered(등록 키워드의 낱말) · menu(메뉴판 품목) · booking(예약 스타일) ·
//                pos(결제 인기 메뉴) · rival(상위 매장 둘 이상이 등록했고 업종·품목 자료와 맞는 말)
//   리뷰 언급·블로그 언급은 점수를 더할 뿐 혼자서 추천을 만들지 못합니다. "24시간·견적·상담·무인·시세…" 같은 말은 낱말 목록으로 막지 않고,
//   이 매장의 품목으로 확인되지 않으면 추천이 아니라 후보가 됩니다.
//   메뉴판·예약·결제 자료가 하나도 없는 매장은 확인할 자료가 없어 리뷰로 고른 말은 후보(lacks: 'data')입니다. 추천은 업종·등록 낱말로 확인된 말만 남습니다.
// ---------------------------------------------------------------------------

// 낱말이 품목 이름 전체이거나 품목 이름의 한 낱말이거나 품목의 끝말(머리)인지. 메뉴 '광어 숙성회 정식' ↔ 광어·숙성회, '치즈버거' ↔ 버거.
// 합성 품목 이름의 앞부분("셔틀버스"의 "셔틀", "소고기샤브샤브"의 "소고기", "주사치료"의 "주사", "다리왁싱"의 "다리")은 그 품목이 아니라 앞말(꾸밈·재료)이라 확인하지 않습니다
// (7차 M1). 다만 남는 말이 한 글자이거나 메뉴 갈래 끝말·차림 낱말이면(광어 + 회, 갈치 + 조림) 같은 품목입니다 — 이미 있는 DISH_HEADS·BOARD_NOTE 로 가릅니다.
function itemHit(items, key) {
    return items.some((item) => item.key === key || item.raw === key
        || item.tokens.some((token) => token === key || token.endsWith(key) || (token.startsWith(key) && leadingIsItem(token.slice(key.length))))
        || (key.length >= 3 && (item.key.endsWith(key) || (item.key.startsWith(key) && leadingIsItem(item.key.slice(key.length))))));
}
// 앞부분만 같은 낱말에서 남는 말이 같은 품목의 꼴인지(한 글자 · 메뉴 갈래 끝말 · 차림 낱말)
function leadingIsItem(rest) {
    return rest.length <= 1 || DISH_HEADS.includes(rest) || BOARD_NOTE.includes(rest) || Object.values(DISH_ALIASES).flat().includes(rest);
}

// 낱말이 어느 품목 이름의 앞부분·가운데 토막으로만 들어 있는 경우 그 품목 이름("주사치료"). 없으면 null. 후보의 까닭 문장이 "확인되지 않아"라고 틀리게 말하지 않으려고 씁니다.
function partialItemOf(ctx, key) {
    for (const item of [...ctx.items.menus, ...ctx.items.styles, ...ctx.items.pos]) {
        if (item.key.includes(key) || item.raw.includes(key) || item.tokens.some((token) => token.includes(key))) return item.name;
    }
    return null;
}

// 업종·품목 이름과 느슨하게 맞는지(한쪽이 다른 쪽을 품음). 상위 매장이 등록한 낱말을 확인할 때만 씁니다.
function looseMatch(ctx, key) {
    const near = (word) => word.length >= 2 && (word.includes(key) || key.includes(word));
    return [...ctx.industryKeys].some(near)
        || [...ctx.items.menus, ...ctx.items.styles, ...ctx.items.pos].some((item) => near(item.key) || item.tokens.some(near));
}

// 낱말이 무엇으로 확인되는지(위 confirmedBy), 확인되지 않으면 null
function confirmationOf(ctx, term) {
    const { key, source } = term;
    if (term.owned) return 'registered';
    // 업종 연관어는 collectTerms 에서 매장 정보의 근거(편의시설·좌석·리뷰·영업시간·블로그 언급)를 이미 확인하고 관문(조건·얇은 근거)을 통과한 것이라 업종으로 확인된 말입니다.
    if (source === 'category' || source === 'family' || source === 'rankOnly' || ctx.industryKeys.has(key)) return 'industry';
    // 차림·안내를 말하는 낱말(반반·정식·세트…, BOARD_NOTE)은 메뉴 이름에 들어 있어도 품목이 아닙니다("반반족발"의 "반반").
    const note = BOARD_NOTE.includes(key);
    if (!note) {
        if (source === 'style' || itemHit(ctx.items.styles, key)) return 'booking';
        if (source === 'board' || itemHit(ctx.items.menus, key)) return 'menu';
        if (source === 'pos' || itemHit(ctx.items.pos, key)) return 'pos';
    }
    if (term.rivals >= 2 && !note && looseMatch(ctx, key)) return 'rival';
    return null;
}

// 손님 쪽 확인: 리뷰 메뉴 언급(그 말이거나 그 말이 든·그 말에 든 리뷰 메뉴) · 상위 매장 둘 이상의 등록(블로그 후기 언급은 BLOG_COUNTS_AS_VOICE 가 true 일 때만).
// 가게 쪽 확인(메뉴판·예약 스타일·결제 인기 메뉴)만 있고 손님 쪽이 없는 말은 추천이 아니라 후보(lacks 'voice')입니다 —
// 메뉴판·예약·결제 줄에 섞인 조건·요금·서비스 줄(수지셔틀·잠실재료비·연희학생할인)이 확인된 품목으로 통과하지 않게 합니다.
function customerSide(ctx, term) {
    const key = term.key;
    for (const [chip, count] of ctx.counts.review) {
        // 메뉴판의 한 줄 품목(lineOnly)은 리뷰 메뉴와 이름이 같아야 손님 쪽 확인입니다(긴 메뉴 이름이 리뷰 낱말을 품었다는 것만으로는 아님).
        if (count > 0 && (chip === key || (!term.lineOnly && chip.length >= 2 && key.length >= 2 && (chip.includes(key) || key.includes(chip))))) return 'review';
    }
    if (BLOG_COUNTS_AS_VOICE && term.blog > 0) return 'blog';
    if (term.rivals >= 2) return 'rival';
    return null;
}

// 가게 쪽만 확인된 후보의 까닭 한 문장(lacks 'voice'). 가게 쪽 자료가 무엇이었는지와 확인하지 못한 손님 쪽만 적습니다.
function voiceWhy(ctx, term) {
    const key = term.key;
    const store = term.confirm === 'booking'
        ? `예약 품목에는 있지만${ctx.counts.booking.get(key) > 0 ? `(${ctx.counts.booking.get(key).toLocaleString('ko-KR')}건)` : ''}`
        : term.confirm === 'pos' ? '주간 인기 메뉴에는 있지만'
            : `메뉴판에는 있지만${ctx.menus.filter((menu) => menu.key.includes(key)).length > 0 ? `(메뉴 ${ctx.menus.filter((menu) => menu.key.includes(key)).length}개)` : ''}`;
    // 블로그 언급을 아직 묻지 않았으면 "확인하지 못했다"고 하지 않고 조회하지 않았다고 적습니다. 블로그는 확인으로 치지 않지만 나온 개수는 사실대로 적습니다.
    const checked = term.blog === undefined
        ? '리뷰·상위 매장 키워드에서는 이 말을 확인하지 못했고 블로그 후기 언급은 조회하지 않았습니다.'
        : term.blog > 0
            ? `리뷰·상위 매장 키워드에서는 이 말을 확인하지 못했고, 블로그 후기에는 ${ctx.blogTotal > 0 ? `${ctx.blogTotal}개 중 ` : ''}${term.blog}개 나옵니다.`
            : '리뷰·블로그·상위 매장 키워드에서는 이 말을 확인하지 못했습니다.';
    return `${store} ${checked} 손님이 찾는 말이 맞으면 쓰세요.`;
}

// 후보가 된 까닭 한 문장. 단정하지 않고 자료가 말하는 것(리뷰·상위 매장·블로그에 나온 횟수)과 확인하지 못한 것(품목)만 적습니다.
function unconfirmedWhy(ctx, term) {
    const review = ctx.counts.review.get(term.key);
    const lead = review > 0 ? `리뷰에 ${review.toLocaleString('ko-KR')}회 나왔지만`
        : term.rivals > 0 ? `상위 매장 ${term.rivals}곳이 쓰지만`
            : term.blog > 0 && ctx.blogTotal > 0 ? `블로그 후기 ${ctx.blogTotal}개 중 ${term.blog}개에 나왔지만`
                : '이 매장 자료에 나오지만';
    // 메뉴판·예약·결제 자료가 하나도 없으면 "품목에서 확인되지 않았다"가 아니라 확인할 자료가 없다고 말합니다.
    if (!ctx.hasItemData) return `${lead} 메뉴판·예약·결제 자료가 없어 이 매장이 하는 일인지 확인하지 못했습니다. 사장님이 직접 판단해 쓰세요.`;
    // 품목 이름의 앞부분·토막으로만 있으면 "없다"고 하지 않고 어느 품목에 든 말인지 적습니다.
    const part = partialItemOf(ctx, term.key);
    if (part) return `${lead} 메뉴판·예약·결제에는 '${part}'의 일부로만 있어 이 말이 따로 파는 품목인지 확인하지 못했습니다. 사장님이 직접 판단해 쓰세요.`;
    return `${lead} 메뉴판·예약·결제 품목에서는 확인되지 않아 추천에 넣지 않았습니다. 사장님이 직접 판단해 쓰세요.`;
}

// 상위 매장 둘 이상이 그대로 등록했지만 등록·업종 낱말에 묶인 낱말(lacks 'family')의 까닭: 사실(상위 매장 수·묶인 낱말)만 적습니다.
function rivalKeptWhy(term) {
    const root = term.rivalKept.term;
    return `상위 ${term.rivals}곳이 '${term.term}'${p(term.term, '을', '를')} 등록했지만, ${quoted(root)}${p(root, '이', '가')} 들어 있는 말이라 ${quoted(root)} 하나로 묶었습니다. 이 메뉴를 따로 권할지 직접 판단하세요.`;
}

// 가족에서 근거가 가장 센 메뉴가 같은 낱말 칸이 차서 추천에 못 오른 낱말(lacks 'family')의 까닭.
function familyWhy(ctx, term) {
    const root = term.familyRoot.term;
    const review = ctx.counts.review.get(term.key) || 0;
    // "가장 많이 말해진"은 사실일 때만(9차 K-E): 이 가족 이름을 품은 다른 품목이 더 많이 말해졌으면 구체 메뉴라고만 적습니다.
    const lead = term.familyStronger
        ? `${review > 0 ? `리뷰 ${review.toLocaleString('ko-KR')}회로 ` : ''}${quoted(root)}의 구체 메뉴이지만,`
        : review > 0
            ? `리뷰 ${review.toLocaleString('ko-KR')}회로 ${quoted(root)} 가운데 가장 많이 말해진 메뉴이지만,`
            : `${quoted(root)} 가운데 손님 쪽 근거가 가장 센 메뉴이지만,`;
    if (term.familyRoom > 0) return `${lead} 이 낱말에 새로 권할 지역 조합이 없어 추천에 넣지 않았습니다. 주력 메뉴가 맞으면 직접 판단해 쓰세요.`;
    const count = SAME_TERM_MAX === 2 ? '두' : SAME_TERM_MAX === 3 ? '세' : String(SAME_TERM_MAX);
    return `${lead} ${quoted(root)}${p(root, '이', '가')} 든 키워드를 이미 ${count} 칸 쓰고 있어 추천에 넣지 않았습니다. 한 칸을 이 메뉴로 바꿀지 직접 판단하세요.`;
}

// 비중이 작아 후보가 된 낱말(lacks 'share')의 까닭: 숫자만 적고 곁들임이라 단정하지 않습니다.
function shareWhy(term) {
    const { said, total, names } = term.shareSide;
    return `리뷰 ${said.toLocaleString('ko-KR')}회로, 이 매장에서 가장 많이 말해진 ${names} 메뉴(합쳐 ${total.toLocaleString('ko-KR')}회)에 견주면 적어 추천에 넣지 않았습니다. 주력 메뉴가 맞으면 쓰세요.`;
}

// 한 글자 낱말(회·탕)은 낱말 규칙(두 글자 이상)에 못 들어 조용히 사라졌습니다. 리뷰·예약·결제에 나온 것을 이유와 함께 알리려고 모읍니다(많이 나온 순, 3개까지).
function shortNamesOf(place) {
    const found = new Map();
    const add = (raw, where, count) => {
        const key = compact(cleanName(raw));
        if (!/^[가-힣a-z0-9]$/.test(key)) return;
        const entry = found.get(key) || { term: key, where, count: 0 };
        entry.count += count;
        found.set(key, entry);
    };
    for (const item of list(place?.reviewMenus)) add(item?.label, '리뷰에', countOf(item?.count));
    for (const item of list(place?.detail?.styles)) add(item?.name, '예약 스타일에', countOf(item?.count));
    for (const item of list(place?.detail?.pos?.popularMenus)) add(item?.name, '주간 인기 메뉴에', 0);
    return [...found.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}

// 상호(매장 이름)와 같거나 상호를 품은 낱말. 이름의 한 조각("버거킹"의 "버거")은 업종·품목 낱말일 수 있어 상호로 보지 않습니다.
function isBrandTerm(ctx, key) {
    return ctx.brandKeys.some((brand) => key === brand || (brand.length >= 3 && key.includes(brand)));
}

// 업종 이름(category 낱말)이 분류 이름표일 뿐인지(7차 M8, 8차 S-4: "기타서비스"·"생활서비스"·"전문점"·"판매업"처럼 손님이 검색하는 말이 아닌 이름).
// 이름표는 네이버 업종 분류의 윗단 이름이라는 닫힌 집합(LABEL_CATEGORY: 생활·편의·쇼핑·유통·서비스업·판매업·전문점·체험·기타로 시작하는 이름)으로만 판정합니다 —
// "어디에도 안 나오는 업종 이름은 이름표"라는 추론은 하지 않습니다(민박·카센터·제모·샌드위치가 걸리던 것). 집합에 드는 이름도 내 등록 키워드·상위 매장 키워드·리뷰·메뉴판·예약·결제·
// 한 줄 소개·매장 이름·블로그에 나오거나 알려진 업종 묶음·메뉴 갈래 끝말이면 가게 종류·메뉴를 말하는 이름이라 이름표가 아닙니다.
// (9차 N-L: 윗단 대분류 이름 — 교육·학문·스포츠·레저·자동차·교통·문화·예술·여행·명소·의료·건강·금융·보험 — 은 이름 전체가 같을 때만 이름표입니다)
const LABEL_BIG = /^(?:교육|학문|스포츠|레저|자동차|교통|문화|예술|여행|명소|의료|건강|금융|보험)$/;
const LABEL_CATEGORY = new RegExp(`^(?:(?:생활|편의|쇼핑|유통|서비스업|판매업|전문점|체험|기타).*|${LABEL_BIG.source.slice(1, -1)})$`);
function isLabelOnly(ctx, term) {
    const key = term.key;
    if (!LABEL_CATEGORY.test(key)) return false;
    if ((ctx.family?.base || []).map(compact).includes(key) || (ctx.family?.related || []).some((item) => compact(item.term) === key)) return false;
    // (대분류 이름은 "교육"이 학원 묶음에도 걸리므로 업종 묶음의 보호를 받지 않습니다. 자료에 나오면 아래에서 살립니다)
    if ((!LABEL_BIG.test(key) && FAMILIES.some((family) => family.match.test(key))) || DISH_HEADS.some((head) => key.endsWith(head))) return false;
    if (COMMON_SUFFIXES.includes(key) || ctx.nameKey.includes(key) || ctx.intro.includes(key)) return false;
    if (term.blog > 0 || term.rivals > 0) return false;
    if (ctx.keywordCores.some((core) => core.includes(key) || key.includes(core) || isAbbreviation(core, key) || isAbbreviation(key, core))) return false;
    const pool = [...ctx.counts.review.keys(), ...[...ctx.items.menus, ...ctx.items.styles, ...ctx.items.pos].flatMap((item) => [item.key, item.raw, ...item.tokens])];
    return !pool.some((text) => text && (text.includes(key) || (text.length >= 2 && key.includes(text))));
}

// 사장님이 등록한 낱말이 이 매장 자료(업종·상호·한 줄 소개·메뉴판·예약·결제·리뷰 메뉴) 어디에도 나오지 않는지. 다른 가게의 상호를 대표키워드로 등록한 경우("이디야커피")가
// 걸립니다. 낱말이 확인된 낱말(업종·품목)로만 이루어졌거나 이 매장 자료의 글 안에 들어 있으면 아는 말입니다(끝의 "집·점·샵·식당"을 뗀 꼴과,
// 앞에 꾸밈말("수제"·"프리미엄")이 붙은 꼴은 그 꾸밈말을 뗀 말로도 봄: "수제버거"의 "버거").
const SHOP_TAILS = /(전문점|전문|맛집|식당|집|점|샵)$/;
const SHOP_KIND_TAIL = /^(?:학원|센터|스튜디오|샵|숍|점|집|전문점|병원|의원|클리닉|장|관|원|실|방|맛집|식당|교실|아카데미)$/;
function storeKnows(ctx, key, { withName = true } = {}) {
    const pool = [
        ...ctx.industryKeys, ...(withName ? [ctx.nameKey, ctx.intro] : []),
        ...[...ctx.items.menus, ...ctx.items.styles, ...ctx.items.pos].flatMap((item) => [item.key, ...item.tokens]),
        ...ctx.counts.review.keys(), ...ctx.menus.map((menu) => menu.key),
    ].filter(Boolean);
    // 업종 이름의 줄임말("소아청소년과"의 "소아과")과 업종이 당연히 파는 메뉴(이탈리아음식의 파스타)도 이 매장이 아는 말입니다.
    const known = (form) => form.length >= 2 && (isExplained(form, ctx.words) || pool.some((text) => text.includes(form) || isAbbreviation(form, text))
        || CATEGORY_DISHES.some(([match, dishes]) => dishes.includes(form) && ctx.leaves.some((leaf) => match.test(leaf))));
    const forms = [key, key.replace(SHOP_TAILS, '')];
    for (let at = 2; at <= key.length - 2; at += 1) {
        if (isAttributeWord(key.slice(0, at))) forms.push(key.slice(at), key.slice(at).replace(SHOP_TAILS, ''));
    }
    // 9차 N-U: "앞말 + 가게 종류 꼬리"(수학학원·수영장)는 앞말이 이 매장 자료에 있으면 아는 말입니다(경쟁 상호 "스타벅스"는 꼬리가 없어 해당하지 않음).
    for (let at = 2; at < key.length; at += 1) {
        if (SHOP_KIND_TAIL.test(key.slice(at))) forms.push(key.slice(0, at));
    }
    return forms.some(known);
}

// 지역인지 확인하지 못한 등록 키워드(unknown)가 통째로 이 매장 자료 어디에도 없는지(8차 S-1: 경쟁 가게 상호만 등록한 경우). 키워드의 어느 끝말도 이 매장이 아는 말이 아니어야 합니다
// ("홍대쌀국수"는 앞말 "홍대"를 몰라도 끝말 "쌀국수"가 이 매장 메뉴라 아는 말입니다). 견줄 자료(메뉴판·예약·결제·리뷰 메뉴)가 하나도 없으면 따지지 않습니다.
function keywordUnrelated(ctx, key) {
    if (!(ctx.hasItemData || ctx.counts.review.size > 0) || !key) return false;
    if (storeKnows(ctx, key)) return false;
    // 끝말은 업종·메뉴판·예약·결제·리뷰로 아는 말이면 아는 말입니다("홍대쌀국수"의 쌀국수). 상호·소개글에 든 낱말("믿음카센터"의 "카센터")만 아는 끝말이면
    // 앞말이 이 매장 주소·가까운 역에 있을 때만("광교로"의 "광교카센터") 아는 말로 칩니다 — "오늘의커피"의 "커피"만으로는 "이디야커피"를 아는 말로 보지 않습니다.
    const geo = compact([ctx.place?.address, ctx.place?.jibunAddress, ctx.place?.detail?.subway?.station].filter(Boolean).join(''));
    for (let at = 2; at <= key.length - 2; at += 1) {
        const tail = key.slice(at);
        if (storeKnows(ctx, tail, { withName: false })) return false;
        if (storeKnows(ctx, tail) && geo.includes(key.slice(0, at))) return false;
    }
    return true;
}

// 낱말 하나가 관문을 통과하는지. 통과하면 null, 걸리면 { rule, reason, label, tell, into?, factsOf? }.
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
    // 라. 넓은 업종 이름(업종 이름 자리가 아닌 리뷰·예약·결제 낱말에서는 요리 갈래 이름만: 리뷰 메뉴의 "기타"는 악기)
    const nameSlot = ['category', 'family', 'registered', 'rival', 'related'].includes(source);
    if (nameSlot ? BROAD_CATEGORY.test(key) : CUISINE_BROAD.test(key)) {
        return verdict('broad', (names, last) => `${names.join('·')}${p(last, '은', '는')} 범위가 넓은 업종 이름이라, 지역을 붙여도 어떤 매장을 찾는 말인지 가려지지 않습니다.`);
    }
    // 업종 이름도 뜻이 넓은 말은 거릅니다(관문 '라'의 연장): "육류,고기요리"·"해물,생선요리"·"닭요리"처럼 재료 갈래나 "○○요리"·"○○류"로 끝나는 이름은
    // 지역을 붙여도 어떤 매장을 찾는 말인지 가려지지 않습니다. ("튀김"·"한의원"처럼 가게 종류를 말하는 업종 이름은 그대로 씁니다)
    if (source === 'category' && isVagueCategoryName(key)) {
        return verdict('vague', (names, last) => `${names.join('·')}${p(last, '은', '는')} 뜻이 넓은 업종 이름이라, 지역을 붙여도 어떤 매장을 찾는 말인지 가려지지 않습니다.`);
    }
    // 업종·업종 대표어는 매장이 무엇인지 말하는 낱말이라 그대로 씁니다. 다만 업종 분류의 윗단 이름표("기타서비스")는 자료에 나올 때만 씁니다(7차 M8, 8차 S-4):
    // 첫 분석이든 최종 단계든 순위 조회 칸을 쓰지 않도록 추천에서 뺍니다.
    if (source === 'category' && !term.owned && isLabelOnly(ctx, term)) {
        return verdict('label', (names, last) => `${names.join('·')}${p(last, '은', '는')} 업종 분류의 큰 갈래 이름일 뿐이고 등록 키워드·상위 매장 키워드·리뷰·메뉴·블로그 어디에도 나오지 않아, 지역을 붙인 키워드로는 권하지 않습니다.`);
    }
    if (source === 'category' || source === 'family') return null;
    // 상호: 낱말이 매장 이름과 같거나 이름을 품으면(서초 매장 "강남면옥"을 등록한 "강남면옥") 지역을 붙인 조합을 만들지 않습니다.
    // 사장님이 등록했어도 같습니다. 대표키워드에서 업체명(상호)은 편집·삭제될 수 있다는 점을 이유에 적습니다.
    if (source !== 'related' && isBrandTerm(ctx, key)) {
        const same = ctx.nameKey.includes(key);
        return verdict('brand', (names, last) => `${names.join('·')}${same ? `${p(last, '은', '는')} 매장 이름과 같아` : `에는 매장 이름이 들어 있어`} 지역을 붙인 키워드로 권하지 않습니다. 대표키워드에서 상호는 지워질 수 있습니다.`);
    }
    // 차. 약·제품 분류 이름: 사장님이 등록한 낱말이어도 같은 이유를 답니다(단정하지 않고 "다를 수 있다"). into 는 대신 쓸 손님 말입니다.
    if (ctx.family?.key === 'pharmacy' && CLASS_NAMES.has(key)) {
        return verdict(
            'classification',
            // 자료가 말하는 것만 적습니다: 분류 이름이라는 사실, 그리고 대신 쓸 말이 블로그 후기에 나온 글 수(자료가 있을 때만). 손님이 무엇을 검색하는지는 말하지 않습니다.
            (names, last, into) => {
                const subject = `${names.join('·')}${p(last, '은', '는')} 약·제품을 나누는 분류 이름`;
                if (!into) return `${subject}이라, 지역을 붙인 키워드로는 권하지 않습니다.`;
                const said = ctx.mentions.get(compact(into));
                if (said > 0 && ctx.blogTotal > 0) return `${subject}이고, 블로그 후기에는 ${quoted(into)}${p(into, '이라는', '라는')} 말이 나옵니다(${ctx.blogTotal}개 중 ${said}개).`;
                return `${subject}이라, 대신 ${quoted(into)}${p(into, '을', '를')} 쓸 수 있습니다.`;
            },
            { into: spokenFor(ctx, key) },
        );
    }
    // 아. 먹고 마시는 업종의 "포장"·"배달": 매장에 그 사실이 있어도(편의시설 '포장') 가게를 찾는 말로는 권하지 않습니다.
    if (RECEIVE_WORDS.includes(key) && FOOD_FAMILIES.includes(ctx.family?.key)) {
        return verdict('channel', (names, last) => `${names.join('·')}${p(last, '은', '는')} 가게 종류나 메뉴가 아니라 받는 방법이라, 이 말만으로는 어떤 가게를 찾는지 알 수 없습니다.`);
    }
    const owned = term.owned === true;

    // 파·하. 시설 조건·알리는 통로·인상·꾸밈 낱말과 다른 지명: 메뉴·리뷰·결제·메뉴판·상위 매장 키워드에서 온 낱말에 겁니다(업종 연관어는 그대로).
    // 사장님이 등록한 낱말도 조건·꾸밈 낱말("주차가능"·"예약필수"·"24시")이면 같은 검사를 받습니다(지역 조합을 만들지 않고 살펴볼 점으로 알림).
    // 그 매장 자기 업종·매장 이름에 든 말은 목록보다 우선합니다(ownBusinessWord): 반찬가게의 "반찬"을 뜻이 넓다고 거르지 않습니다.
    if (source !== 'related') {
        if (!owned && PLACE_NAMES.has(key) && !ownBusinessWord(ctx, key) && !fusedInMenu(ctx, key)) {
            return verdict('place', (names, last) => `${names.join('·')}${p(last, '은', '는')} 다른 지역 이름이라, 메뉴 이름에 되풀이돼도 지역 키워드의 낱말로 쓰지 않습니다.`);
        }
        const conditionOf = conditionKind(ctx, key, { owned });
        if (conditionOf) {
            // 조건어가 앞에 붙은 합성어는 앞의 조건어를 짚어 말합니다("출장점검"의 "출장": 서비스를 받는 방식).
            const leadWord = conditionOf === 'lead' ? leadOf(ctx, key) : null;
            return verdict('attribute', (names, last) => (conditionOf === 'lead'
                ? `${names.join('·')}${p(last, '은', '는')} 앞의 ${quoted(leadWord)}${p(leadWord, '이', '가')} 서비스를 받는 방식을 말하는 말이라, 지역을 붙여도 어떤 가게인지 알 수 없습니다.`
                : conditionOf === 'fee'
                    ? `${names.join('·')}${p(last, '은', '는')} 요금·이용권·절차·판촉을 말하는 낱말이라, 지역을 붙여도 찾을 가게 종류나 메뉴가 아닙니다.`
                    : `${names.join('·')}${p(last, '은', '는')} 시설 조건·알리는 통로·인상·꾸밈을 말하는 낱말이라, 지역을 붙여도 찾을 가게 종류나 메뉴가 아닙니다.`));
        }
        // 7차 K-D. 메뉴 이름 앞에서만 되풀이되고 품목의 끝말로는 한 번도 쓰이지 않은 낱말은 품목이 아니라 지명·원산지·꾸밈입니다.
        // (8차 관찰 ①: 손님이 메뉴로 말하는 낱말(리뷰 메뉴 언급·상위 매장 둘 이상 등록)은 메뉴입니다 — 메뉴판 줄이 모두 "부대찌개 세트"처럼 꼬리말이 붙어 있어도 끝말로 안 쓰였다고 걸지 않습니다)
        if (term.leadingOnly && !owned && !customerSide(ctx, term)) {
            const count = ctx.menus.filter((menu) => wordsOf(menu.name).includes(key)).length;
            return verdict('prefix', (names, last) => `${names.join('·')}${p(last, '은', '는')} 메뉴 이름 앞에서만 쓰이고(메뉴 ${count}개) 끝말로는 한 번도 쓰이지 않아, 메뉴가 아니라 지명·원산지·꾸밈으로 보고 키워드의 낱말로 쓰지 않습니다.`);
        }
    }

    // 업종 연관어(related)는 collectTerms 에서 매장 정보의 근거를 확인한 낱말이라 다·가 를 다시 보지 않습니다.
    if (source !== 'related') {
        // 다. 추가 주문용 메뉴 · 뜻이 넓은 낱말 · 술·음료
        if (!owned && EXTRA_MENU.test(key)) return verdict('extra', () => '추가 주문용 메뉴 이름이라 매장을 찾는 말로는 맞지 않습니다.');
        // 뜻이 넓은 낱말은 업종 이름이 바로 그 말이거나("튀김") 매장 이름에 들어 있을 때만 씁니다("생선회"의 "생선"은 해당하지 않음).
        // 꾸밈말이 앞에 붙은 뜻 넓은 낱말("추천코스"=추천+코스)도 같은 낱말입니다.
        const bareVague = [...ATTRIBUTE_WORDS].find((prefix) => prefix.length >= 2 && key.startsWith(prefix) && VAGUE_WORDS.includes(key.slice(prefix.length)));
        if ((VAGUE_WORDS.includes(key) || bareVague) && !ownBusinessWord(ctx, key)) {
            return verdict('vague', (names, last) => `${names.join('·')}${p(last, '은', '는')} 뜻이 넓어, 이 말만으로는 어떤 매장을 찾는지 가려지지 않습니다.`);
        }
        // 술·음료 이름은 업종이나 매장 이름에 그 말이 있을 때만 씁니다("와인바"의 "와인").
        const drink = DRINKS_LONGEST_FIRST.find((text) => key.endsWith(text));
        if (drink && !ctx.leaves.some((leaf) => leaf.includes(drink)) && !ctx.nameKey.includes(drink)) {
            return verdict('drink', (names, last) => `술·음료 이름이라, 업종·매장 이름에 ${names.join('·')}${p(last, '이', '가')} 없으면 가게 종류를 말하는 낱말로 보지 않습니다.`);
        }
        // 가. 다른 업종을 가리키는 낱말: 내 매장의 주력이라는 근거가 있을 때만
        const other = otherBusinessOf(ctx, key);
        // 사장님이 등록한 낱말 자신이 이 매장의 메뉴판·예약·결제·리뷰에 품목으로 있으면(순대국집의 "국밥" ← 메뉴 "내장국밥") 다른 업종의 낱말이라고 하지 않습니다(7차 M9).
        const ownItem = owned && (itemHit([...ctx.items.menus, ...ctx.items.styles, ...ctx.items.pos], key) || ctx.counts.review.has(key));
        if (other && !ownItem && !isMainOffering(ctx, other[0], { owner: !owned }) && !reviewMain(ctx, other[0])) {
            const [head, shop, isDish] = other;
            const boardKnown = ctx.menus.length >= MENU_BOARD_MIN;
            if (!isDish) {
                if (!owned) return verdict('otherBusiness', (names, last) => `${names.join('·')}${p(last, '은', '는')} ${shop}${p(shop, '을', '를')} 가리키는 말인데, 업종·매장 이름에서 그 근거를 찾지 못했습니다.`);
            } else {
                // 이유 문장은 사실(손님이 이 메뉴를 찾는 자료)을 먼저 적고, 왜 지역을 붙인 키워드로는 권하지 않는지, 대신 쓸 자리를 말합니다.
                // 사실은 묶인 낱말 전체(group)로 셉니다. group 이 null 이면 사실 없이(같은 이유끼리 묶는 비교용), 없으면 이 낱말 하나로 셉니다.
                const hits = ctx.menus.filter((menu) => menu.key.includes(head)).length;
                // 사실이 있으면 앞 문장에서 낱말을 이미 말했으므로, 이유 문장은 "이 말로"라고만 씁니다(같은 낱말 나열이 한 문장 안에 되풀이되지 않게).
                if (boardKnown) {
                    const { tell, sentenceOf } = factual(ctx, term, (names, last, lead) => {
                        const genre = ctx.genre && !hasMark(head, ctx.genre.marks) ? ctx.genre : null;
                        const scale = hits > 0 ? `읽어 온 메뉴 ${ctx.menus.length}개 중 ${hits}개` : `읽어 온 메뉴 ${ctx.menus.length}개에는 없음`;
                        // 리뷰에 나오는 메뉴인데 "근거를 찾지 못했다"고 말하면 앞 문장과 어긋나므로, 리뷰가 있으면 비중이 작다는 사실을 적습니다.
                        const basis = genre ? `이 매장은 ${genre.label} 메뉴가 중심이라` : reviewCountOf(ctx, head) > 0 ? '리뷰 비중이 이 매장 주력 메뉴만큼 크지 않고 주력이라는 다른 근거도 찾지 못해' : '이 매장의 주력이라는 근거를 찾지 못해';
                        // 자료가 말하는 것만 적습니다: 이 낱말이 가리키는 가게 종류(낱말 사전)와 메뉴판에서 읽은 개수. 손님이 무엇을 검색하는지는 말하지 않습니다.
                        const subject = lead ? '이 말은' : `${names.join('·')}${p(last, '은', '는')}`;
                        return `${subject} ${shop}${p(shop, '을', '를')} 가리키는 메뉴 이름인데, ${basis} 지역을 붙인 키워드로는 권하지 않습니다(${scale}).`;
                    }, (pop) => Boolean(pop.popular) || (hits > 0 && !term.lineOnly));
                    return verdict('otherBusiness', tell, { sentenceOf, factsOf: (group) => factsOf(ctx, group) });
                }
                if (!owned) {
                    const { tell, sentenceOf } = factual(ctx, term, (names, last, lead) => `업종·매장 이름·메뉴판에서 주력 메뉴라는 근거를 찾지 못했고, ${lead ? '이 말은' : `${names.join('·')}${p(last, '은', '는')}`} ${shop}${p(shop, '을', '를')} 가리키는 메뉴 이름입니다.`,
                        (pop) => Boolean(pop.popular));
                    return verdict('otherBusiness', tell, { sentenceOf, factsOf: (group) => factsOf(ctx, group) });
                }
            }
        }
        // 자. 메뉴 낱말은 매장의 주력 갈래에 맞을 때만: 갈래 끝말로 끝나거나 그 갈래 메뉴의 이름에 들어 있으면 통과,
        // 아니면 곁들임으로 보고 주력 근거(업종·매장 이름·소개·대표 메뉴 표시·메뉴판 비중·등록 키워드)가 있을 때만 통과합니다.
        // 리뷰에서 가장 많이 말한 메뉴의 1/3 이상으로 말해진 메뉴(MAIN_MENU_SHARE, 메뉴판 주력 기준과 같은 선)는 곁들임으로 보지 않습니다(빵집의 크루아상·치킨집의 닭강정·삼겹살집의 목살:
        // 갈래 끝말과 글자가 안 맞아도 손님이 그만큼 말하는 그 매장의 주력). 견본 횟집의 갈치(12회)·볼락구이(9회)는 1위 김밥(37회)의 1/3에 못 미쳐 그대로 걸립니다.
        const genre = ctx.genre;
        const mostSaid = (() => {
            const pop = genre ? popularityOf(ctx, [term]).popular : null;
            const topCount = Math.max(0, ...ctx.counts.review.values());
            return Boolean(pop && pop.reviews > 0 && topCount > 0 && pop.reviews >= topCount * MAIN_MENU_SHARE);
        })();
        if (genre && !owned && GENRE_SOURCES.includes(source) && !hasMark(key, genre.marks)
            && !genre.items.some((item) => item.includes(key)) && !isMainOffering(ctx, key) && !mostSaid
            // 업종 이름(순대)으로 끝나는 메뉴(모듬순대)는 그 매장 자기 업종의 메뉴입니다(등록 키워드의 갈래가 국밥이어도).
            && !ctx.leaves.some((leaf) => leaf.length >= 2 && key.length > leaf.length && key.endsWith(leaf))
            && !sharesHead(key, [...genre.marks, ...ctx.leaves, ...ctx.trusted])) {
            const others = ctx.menus.filter((menu) => menu.key.includes(key)).length;
            // 사실(손님이 이 메뉴를 찾는 자료)을 먼저 적고, 왜 지역을 붙인 키워드로는 권하지 않는지, 대신 쓸 자리를 말합니다.
            // 사실 문장이 낱말을 이미 말했으면 이유 문장은 "이 낱말(들)은"이라고만 씁니다.
            const { tell, sentenceOf } = factual(ctx, term, (names, last, lead, many) => {
                const where = `${genre.from}${ro(genre.fromWord)} 보면 이 매장은 ${genre.label} 메뉴가 중심(읽어 온 메뉴 ${genre.total}개 중 ${genre.items.length}개)이라`;
                const subject = lead ? `이 낱말${many ? '들' : ''}은` : `${names.join('·')}${p(last, '은', '는')}`;
                // 이름 끝말이 갈래 끝말과 맞는지만 본 판정이라 "○○ 메뉴가 아니다"라고 단정하지 않고 "○○ 메뉴로는 보이지 않는다"고 적습니다.
                return `${where}, ${genre.label} 메뉴로는 보이지 않${others > 0 ? `고 메뉴 ${others}개에만 나오는 ` : '는 '}${subject} 지역을 붙인 키워드로는 따로 권하지 않습니다.`;
            }, (pop) => Boolean(pop.popular) || (others > 0 && !term.lineOnly));
            return verdict('offMain', tell, { sentenceOf, factsOf: (group) => factsOf(ctx, group) });
        }
    }

    // 나. 업종 연관어의 조건(when·late·lunch)은 상위 매장에서 온 낱말에도, 사장님이 등록한 낱말에도 그대로 씁니다.
    const related = (ctx.family?.related || []).find((item) => compact(item.term) === key);
    // 영업시간이 그 말과 어긋나면(21시에 닫는 약국의 "심야약국") 블로그에 한 번 나왔더라도 권하지 않습니다 — 어느 경로로 온 낱말이든 같은 검사입니다.
    if (related && !owned) {
        const mismatch = hoursMismatch(ctx, related);
        if (mismatch) return verdict('condition', mismatch);
    }
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

    // 타. 근거가 얇은 업종 연관어: 근거가 매장 사실 하나뿐(편의시설 한 줄·좌석 한 줄·매장 이름)이고, 리뷰·예약·블로그 언급·손님이 고른 좋은 점·
    // 상위 매장 어디에도 그 말이 없으면 추천하지 않습니다(추천 자리를 채우려고 약한 것을 올리지 않음). 사장님이 등록한 낱말은 사장님의 선택이라 걸지 않고,
    // 영업시간이 근거인 낱말(심야약국)은 그 조건 자체가 근거라 걸지 않습니다. 블로그 언급을 아직 묻기 전(mentionTerms)에는 걸지 않아 언급 수를 물어봅니다.
    if (source === 'related' && !owned && !ctx.skipThin && !(term.rivals > 0) && term.reasons.length === 1 && term.reasons[0].kind === 'fact') {
        const what = thinFactLabel(term.reasons[0].text);
        if (what) return verdict('thin', () => `근거가 ${what} 하나뿐입니다. 리뷰나 블로그 후기에 이 말이 나오면 다시 권합니다.`);
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

    // K-C. 등록한 낱말이 이 매장 자료 어디에도 나오지 않으면(경쟁 가게 상호를 등록한 경우: 블로그 후기에는 나와도) 지역을 붙인 새 키워드는 만들지 않습니다.
    // 그 칸이 틀렸다고 단정하지는 않습니다(사장님이 아는 사실일 수 있음). 이유는 등록 키워드의 살펴볼 점으로도 보입니다.
    // (블로그 언급이 0개라 "나온 글이 없다"고 말할 수 있는 낱말은 위의 noBlog 가 먼저 걸립니다.)
    // 견줄 자료(메뉴판·예약·결제·리뷰 메뉴)가 하나도 없는 매장은 "자료에 없다"가 아무 뜻이 없어 이 검사를 하지 않습니다.
    if (owned && source !== 'related' && (ctx.hasItemData || ctx.counts.review.size > 0) && !storeKnows(ctx, key)) {
        return verdict('unrelated', (names, last) => `${names.join('·')}${p(last, '은', '는')} 이 매장의 업종·이름·메뉴·리뷰·예약·결제 자료에서 찾지 못한 말이라, 지역을 붙인 새 키워드는 만들지 않았습니다. 사장님이 아는 사실이면 등록한 그대로 쓰세요.`);
    }
    return null;
}

// 줄임말: 같은 글자로 시작하고 끝나며 긴 말 안에 글자 순서대로 들어 있는 말("포차" ↔ "포장마차")
function isAbbreviation(short, long) {
    if (short.length < 2 || long.length <= short.length || short[0] !== long[0] || short[short.length - 1] !== long[long.length - 1]) return false;
    let at = 0;
    for (const char of long) if (char === short[at]) at += 1;
    return at === short.length;
}

// 마. 한쪽이 다른 쪽을 품는 메뉴 낱말("광어"·"광어회", "댄디컷"·"시스루댄디컷")은 하나로 묶습니다.
//   둘 다 메뉴 낱말이면 손님이 더 많이 말한 쪽(같으면 짧은 쪽)을 남깁니다.
//   긴 쪽만 메뉴 낱말이면(등록 키워드 "댄디컷" + 예약 스타일 "시스루댄디컷") 긴 쪽을 짧은 쪽으로 묶습니다.
//   짧은 쪽만 메뉴 낱말이면(업종 "와인바" + 리뷰 "와인") 서로 다른 말로 보고 둘 다 둡니다.
//   업종 이름 끝에 붙은 짧은 조각("네일아트"의 "아트": 앞말 "네일"이 업종 이름에서 온 말)은 그 업종 이름으로 묶습니다.
//   앞말이 업종과 관계없으면("소금김밥"의 "김밥") 별개의 낱말입니다.
// (마 계속) 업종 이름의 확장어("촬영스튜디오"·"인테리어디자인"·"포장마차")가 등록한 낱말("스튜디오"·"인테리어"·"포차")을 품거나 그 줄임말이면 등록 낱말로 묶습니다
//   (같은 업종을 두 칸에 나눠 권하지 않음. 업종 연관어는 따로 찾는 말이라 묶지 않음).
// 남긴 낱말의 merged 에 묶인 이름을 적습니다.
// 9차 K-E: 가족 이름 뒤에 붙어도 그 가족의 메뉴인 조리·차림 끝말(갈비탕·갈비찜·돈가스정식·순대국·메밀국수·제육덮밥). 이 말들로만 이루어진 꼬리를 허용합니다.
const DISH_TAIL_WORDS = [...DISH_HEADS, '국', '밥', '면', '죽', '볶음', '튀김', '찌개', '전', '무침', '정식', '세트', '코스', '한상', '덮밥', '샐러드', '수제비', '우동', '말이', '강정', '스테이크', '샤브',
    // 차림·꾸밈 끝말(참치스페셜·삼겹살모둠·소고기플래터)과 음료 끝말(카페라떼·카페모카)
    '스페셜', '특선', '플래터', '모둠', '시그니처', '프리미엄', '디너', '런치', '라떼', '모카', '에이드', '스무디', '쉐이크', '주스', '티', '차'];
const isDishTail = (rest) => rest === '' || isExplained(rest, DISH_TAIL_WORDS);

function foldContained(passed, ctx) {
    const folded = [];
    const isMenuWord = (term) => MENU_SOURCES.includes(term.source) && !term.owned;
    const industryWords = [...list(ctx?.leaves), ...list(ctx?.family?.base).map(compact)].filter(Boolean);
    // K-E ②. 등록·업종 낱말(root)에 묶이는 구체 품목 가운데 손님이 가장 많이 말한 하나(pick)는 묶지 않고 따로 추천합니다 — root 한 칸 + 그 가족의 구체 품목 한 칸.
    // 두 쪽 확인(가게 쪽·손님 쪽)을 통과한 품목만 뽑고, 자리가 있는지(낱말 가족은 같은 낱말처럼 두 칸까지)는 recommendKeywords 가 봅니다.
    // 나머지 품목과 업종 확장어(남성전문미용실 → 미용실)는 지금처럼 하나로 묶습니다.
    const reviewOf = (term) => ctx?.counts?.review?.get(term.key) || 0;
    const rootOf = new Map(); // pick 낱말(key) → 그 품목을 거느린 등록·업종 낱말
    // 8차 N1: 가족 이름으로 끝나는 품목만 뽑을 대상입니다(치즈버거·양념치킨 O, 치킨무·버거소스 X — 곁들임·소스가 리뷰 수 1위라고 가족 품목이 되지 않게).
    // 8차 K-E: 가족에서 근거가 가장 센 품목은 묶여 사라지지 않고 반드시 남습니다. 두 쪽 확인을 통과하면 pick(칸이 없으면 recommendKeywords 가 후보 lacks 'family'),
    // 손님 쪽 확인이 없으면(가게 쪽만 확인) 묶지 않고 그대로 후보(lacks 'voice')로 둡니다(keepAlone).
    const keepAlone = new Map(); // 묶지 않고 남길 낱말(key) → 그 품목을 거느린 등록·업종 낱말
    // 9차 K-E: 가족의 구성원 = 가족 이름으로 끝나는 품목 + 가족 이름 뒤에 조리·차림 끝말(탕·찜·국·구이·정식·전골…)이 붙은 품목(갈비탕·돈가스정식·순대국·메밀국수).
    // 가족 이름 뒤에 그 밖의 말이 붙은 것(치킨무·버거소스)만 구성원이 아닙니다. 먹고 마시는 업종이 아닌 가족(속눈썹펌·속눈썹연장)은 이름을 품은 품목을 구성원으로 봅니다.
    // 한 품목을 두 낱말(메밀 · 국수)이 다투면 등록 낱말이 먼저 가져가고, 가져간 품목은 어느 낱말에도 묶여 사라지지 않습니다(아래 findPair).
    const strictFamily = Boolean(ctx?.family) && FOOD_FAMILIES.includes(ctx.family.key);
    const memberOf = (term, root) => {
        const at = term.key.lastIndexOf(root.key);
        return at >= 0 && isDishTail(term.key.slice(at + root.key.length));
    };
    // 이 가족 이름을 품은 리뷰 낱말 가운데 pick 보다 더 많이 말해진 것이 있는지(규칙으로 구성원에서 빠졌거나 다른 낱말에 묶인 것 포함)
    const strongerThan = (pick, root) => [...(ctx?.counts?.review || [])].some(([chip, count]) => chip !== pick.key && chip.length > root.key.length && chip.includes(root.key) && count > reviewOf(pick));
    const claimed = new Map();
    const familyRoots = [...passed.values()]
        .filter((root) => root.source !== 'rankOnly' && (root.owned || root.source === 'category' || root.source === 'family'))
        .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)));
    for (const root of familyRoots) {
        const around = [...passed.values()].filter((term) => isMenuWord(term) && term.key.length > root.key.length && term.key.includes(root.key) && term.confirm);
        const confirmed = around.filter((term) => !claimed.has(term.key));
        let members = confirmed.filter((term) => memberOf(term, root));
        if (!strictFamily && members.length === 0) {
            const suffixed = confirmed.filter((term) => term.key.endsWith(root.key));
            members = suffixed.length > 0 ? suffixed : confirmed;
        }
        const best = members.sort((a, b) => (a.lacksVoice ? 1 : 0) - (b.lacksVoice ? 1 : 0) || reviewOf(b) - reviewOf(a) || (b.said || 0) - (a.said || 0) || b.weight - a.weight)[0];
        if (!best) continue;
        claimed.set(best.key, root);
        // "가장 많은 메뉴"라는 문장은 사실일 때만 씁니다: 이 가족 이름을 품은 다른 품목(규칙으로 구성원에서 빠진 것 포함)이 더 많이 말해졌으면 표시해 둡니다.
        best.familyStronger = strongerThan(best, root);
        if (best.lacksVoice) keepAlone.set(best.key, root);
        else rootOf.set(best.key, root);
    }
    const findPair = () => {
        const alive = [...passed.values()].filter((term) => term.source !== 'rankOnly');
        for (const shorter of alive) {
            if (!isMenuWord(shorter) || shorter.key.length > 2) continue;
            for (const longer of alive) {
                if (longer === shorter || !(longer.owned || longer.source === 'category' || longer.source === 'family')) continue;
                if (longer.key.length < shorter.key.length + 2 || !longer.key.endsWith(shorter.key)) continue;
                const head = longer.key.slice(0, longer.key.length - shorter.key.length);
                if (industryWords.some((word) => word.includes(head))) return [shorter, longer];
            }
        }
        for (const longer of alive) {
            if (!isMenuWord(longer)) continue;
            for (const shorter of alive) {
                if (longer.key.length <= shorter.key.length || !longer.key.includes(shorter.key)) continue;
                const loser = isMenuWord(shorter) && (longer.said || 0) > (shorter.said || 0) ? shorter : longer;
                // 가족 pick(후보로 남길 품목 포함)은 어느 낱말에도 묶이지 않습니다(두 낱말이 한 품목을 다퉈 둘 다에 묶여 사라지는 일이 없게).
                if (rootOf.has(loser.key) || keepAlone.has(loser.key)) continue;
                return [loser, loser === longer ? shorter : longer];
            }
        }
        // 업종 이름의 확장어가 등록 낱말을 품거나 그 줄임말이면 등록 낱말로 묶습니다(등록 "성수스튜디오" + 업종 "촬영스튜디오", 등록 "신림포차" + 업종 "포장마차").
        // 업종 연관어(대형약국)는 따로 찾는 말이라 묶지 않고, 업종 이름(category)만 봅니다.
        for (const longer of alive) {
            if (longer.source !== 'category' || longer.owned) continue;
            for (const owner of alive) {
                if (!owner.owned || owner === longer || owner.key.length < 2 || longer.key.length <= owner.key.length) continue;
                if (longer.key.includes(owner.key) || isAbbreviation(owner.key, longer.key)) return [longer, owner];
            }
        }
        return null;
    };
    // 이유에는 두 낱말을 손님이 말한 수(리뷰·예약)를 적어, 왜 그쪽으로 묶였는지 읽히게 합니다.
    const tagOf = (term) => {
        const counts = term.reasons.filter((reason) => reason.kind === 'review' || reason.kind === 'booking').map((reason) => reason.text);
        return `'${term.term}'${counts.length ? `(${counts.join('·')})` : ''}`;
    };
    // 묶였다는 알림 줄(excluded 의 merged). 가족 pick 이 칸이 없어 추천에 못 오를 때도 같은 줄을 씁니다.
    const foldEntry = (loser, winner) => {
        const keep = winner.owned ? `등록 키워드인 '${winner.term}'`
            : (winner.said || 0) > (loser.said || 0) ? `손님이 더 많이 말한 '${winner.term}'` : `'${winner.term}'`;
        const relation = loser.key.length > winner.key.length && !loser.key.includes(winner.key)
            ? `${tagOf(winner)}${p(winner.term, '과', '와')} 줄임말 관계로 보이는 말이라`
            : loser.key.length > winner.key.length
                ? `${tagOf(winner)}${p(winner.term, '이', '가')} 들어 있는 말이라`
                : `${tagOf(winner)}에 들어 있는 말이라`;
        // 남긴 낱말이 화면에 보이면(into) "하나로 묶었다"고 적고, 추천 자리에 들지 못해 안 보이면 그 사실을 적습니다.
        const tell = (names, last, into) => (into
            ? `${names.join('·')}${p(last, '은', '는')} ${relation}, ${keep} 하나로 묶었습니다.`
            : `${names.join('·')}${p(last, '은', '는')} ${relation} ${quoted(winner.term)}${p(winner.term, '과', '와')} 한 낱말로 보았는데, ${quoted(winner.term)}도 추천 목록에는 없습니다.`);
        const label = tagOf(loser);
        return { term: loser, rule: 'merged', into: winner.term, label, tell, reason: tell([label], loser.term, winner.term) };
    };
    for (let pair = findPair(); pair; pair = findPair()) {
        const [loser, winner] = pair;
        passed.delete(loser.key);
        // 9차 N2: 상위 매장 둘 이상이 그대로 등록한 품목은 등록·업종 낱말에 묶더라도 사라지지 않고 후보(lacks 'family')로 남깁니다(근거가 강할수록 사라지는 역전을 막음).
        if (isMenuWord(loser) && (loser.rivals || 0) >= 2 && (winner.owned || winner.source === 'category' || winner.source === 'family')) {
            loser.rivalKept = winner;
            if (ctx) ctx.rivalKept = [...(ctx.rivalKept || []), loser];
            winner.mergedSaid = (winner.mergedSaid || 0) + (loser.said || 0) + (loser.mergedSaid || 0);
            continue;
        }
        winner.merged = [...(winner.merged || []), loser.term, ...(loser.merged || [])];
        loser.absorbedBy = winner;
        // 묶인 품목에 손님이 한 말도 그 낱말의 몫으로 셉니다(주력의 크기를 잴 때 씁니다 — sideDishes).
        if (isMenuWord(loser) && (winner.owned || winner.source === 'category' || winner.source === 'family')) winner.mergedSaid = (winner.mergedSaid || 0) + (loser.said || 0) + (loser.mergedSaid || 0);
        // 묶은 것이 가게 쪽 확인을 물려주지는 않습니다(7차 M1: 오타 "마라상궈"가 "마라"와 묶이며 확인을 물려받던 것). 이미 확인된 낱말이 같은 품목의 다른 이름에서
        // 손님 쪽 확인(리뷰·블로그·상위 매장)을 이어받는 것만 합니다.
        if (winner.confirm && winner.lacksVoice && loser.confirm && !loser.lacksVoice) winner.lacksVoice = false;
        folded.push(foldEntry(loser, winner));
    }
    for (const [key, root] of rootOf) {
        const pick = passed.get(key);
        if (!pick) continue;
        // root 가 다른 낱말에 묶여 사라졌으면 그 낱말(등록·업종 낱말)을 가족 이름으로 씁니다(같은 낱말 칸 수를 함께 셉니다).
        let top = root;
        for (let step = 0; step < 5 && passed.get(top.key) !== top && top.absorbedBy; step += 1) top = top.absorbedBy;
        if (passed.get(top.key) !== top) continue;
        pick.familyRoot = top;
        if (top !== root) pick.familyStronger = pick.familyStronger || strongerThan(pick, top);
    }
    return folded;
}

// K-E ①·M2. 주력의 크기를 자료로 잽니다: 먹고 마시는 업종에서 업종 이름(갈래)·등록한 낱말을 이름에 품은 메뉴가 그 매장의 주력 가족입니다(치즈버거·클래식버거·베이컨버거 ← 버거,
// 제육쌈밥·오삼불고기쌈밥 ← 쌈밥). 갈래 사전(DISH_HEADS)에 없는 업종도 같습니다. 주력 가족의 리뷰 언급을 합친 수가 그 매장의 주력 규모이고, 가족 밖 메뉴가 그것의
// 1/3(MAIN_MENU_SHARE — 메뉴판 주력 판정과 같은 선)에 못 미치게 말해지면(감자튀김 35회 ↔ 200회) 추천에서는 빼고 후보(lacks 'share')로 둡니다 — 비중만으로
// "곁들임"이라고 단정하지 않습니다(히레카츠·냉모밀도 그 매장의 주력일 수 있어서). 까닭은 숫자만 적습니다.
// 다만 주력 가족의 끝 글자(받침 있는 글자: 곱창의 "창", 국밥의 "밥"…)를 끝말로 나눠 가진 메뉴(대창)는 같은 갈래라 곁들임으로 보지 않습니다(복합어는 끝말이 갈래를 정함).
function familyAnchors(ctx, passed) {
    const leaves = String(ctx.place?.category || '').split(/[,·/]/).map(compact).filter((leaf) => leaf && !BROAD_CATEGORY.test(leaf));
    const owned = [...passed.values()].filter((term) => term.owned && term.key.length >= 2).map((term) => term.key);
    return uniqueBy([...leaves, ...owned], (word) => word);
}
// 낱말이 주력 가족 이름을 품었는지(한 글자 이름은 끝말일 때만)
// (8차 N1: 가족 이름으로 끝나는 메뉴만 가족입니다 — 치킨무는 치킨 가족이 아닙니다)
const hasAnchor = (key, anchors) => anchors.some((anchor) => key.endsWith(anchor));
// 끝 글자(받침 있는 한글)를 주력 가족 이름과 나눠 가졌는지
function sharesHead(key, anchors) {
    const last = key.slice(-1);
    return /[가-힣]/.test(last) && batchimOf(last) !== 'none' && anchors.some((anchor) => anchor !== key && anchor.slice(-1) === last);
}

function markShareDishes(passed, ctx) {
    // 먹고 마시는 업종이거나 업종 묶음을 알 수 없는 업종(죽 전문점처럼 사전에 없는 업종)만 봅니다. 미용·병원·학원처럼 알려진 다른 업종은 보지 않습니다.
    if (ctx?.family && !FOOD_FAMILIES.includes(ctx.family.key)) return;
    const anchors = familyAnchors(ctx, passed);
    const family = [...ctx.counts.review].filter(([chip, count]) => count > 0 && hasAnchor(chip, anchors)).sort((a, b) => b[1] - a[1]);
    const total = family.reduce((sum, [, count]) => sum + count, 0);
    if (total <= 0) return;
    const names = family.slice(0, 4).map(([chip]) => quoted(chip)).join('·');
    for (const term of [...passed.values()]) {
        if (!MENU_SOURCES.includes(term.source) || term.owned || term.familyRoot || !term.confirm || term.lacksVoice) continue;
        const said = ctx.counts.review.get(term.key) || 0;
        if (!(said > 0) || said / total >= MAIN_MENU_SHARE || hasAnchor(term.key, anchors) || sharesHead(term.key, [...anchors, ...ctx.trusted])) continue;
        if (isMainOffering(ctx, term.key, { owner: false })) continue;
        // 추천이 아니라 후보로 둡니다. 숫자(이 말의 리뷰 수 · 주력 가족의 리뷰 합계)만 적고 곁들임이라 단정하지 않습니다.
        term.shareSide = { said, total, names };
    }
}

// 후보 낱말 전체를 관문에 통과시킵니다. { passed: Map(통과한 낱말), excluded: [{ term(낱말 객체), rule, reason, label, tell, into? }] }
function gateTerms(ctx, terms) {
    ctx.trusted = [];
    ctx.rivalKept = [];
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
    // 확인 관문: 관문을 통과한 낱말마다 무엇으로 확인되는지 답니다(확인 못 한 낱말은 null — 추천이 아니라 후보).
    // 메뉴판·예약·결제 자료가 하나도 없는 매장도 같습니다(확인할 자료가 없으니 리뷰 낱말은 후보, lacks 'data').
    // 추천은 가게 쪽(메뉴판·예약·결제 품목 — 셋은 한 쪽으로 셈)과 손님 쪽(리뷰·블로그·상위 매장) 두 쪽이 모두 확인한 말뿐입니다.
    // 업종·등록·상위 매장 낱말은 그 자체가 확인이라 두 쪽을 따지지 않습니다. 가게 쪽만 확인된 말은 lacksVoice 로 후보에 갑니다.
    for (const term of passed.values()) {
        term.confirm = confirmationOf(ctx, term);
        term.lacksVoice = ['menu', 'booking', 'pos'].includes(term.confirm) && !customerSide(ctx, term);
    }
    excluded.push(...foldContained(passed, ctx));
    markShareDishes(passed, ctx);
    return { passed, excluded, kept: ctx.rivalKept };
}

// ---------------------------------------------------------------------------
// 추천
// ---------------------------------------------------------------------------


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
        entry.rows.push({ keyword: String(row.keyword).trim(), text, weak: far || rank === null || rank > RANK_WEAK, far, core: keywordCore(row.keyword, regions) });
        if (!far && rank !== null && (!entry.best || rank < entry.best.rank)) entry.best = { keyword: String(row.keyword).trim(), rank };
        standing.set(matched.region.term, entry);
    }
    for (const entry of standing.values()) {
        // 나쁜 지역: 조회한 것이 모두 나쁘고, 서로 다른 낱말 둘 이상에서 그렇거나 검색 결과가 먼 지역일 때만입니다.
        // 한 낱말의 순위(상계분식 55위·노원분식 80위)만으로 그 지역의 다른 낱말(떡볶이·김밥)까지 막지 않습니다. 그 낱말의 조합은 낱말 단위로 다룹니다(planFor 의 swap).
        entry.weak = entry.rows.every((row) => row.weak) && (entry.rows.some((row) => row.far) || new Set(entry.rows.map((row) => row.core)).size >= 2);
        entry.good = Boolean(entry.best && entry.best.rank <= RANK_GOOD);
    }
    return standing;
}

// 순위 표 한 줄의 상태(등록 키워드 진단·추천 근거가 같은 선을 씁니다).
//   state: pending(조회 중·실패) · good(10위 안) · mid(11~30위) · weak(30위 밖·살펴본 범위 밖·목록에 없음·먼 지역 결과)
function rankStatusOf(row, coordinate) {
    if (!row?.keyword) return null;
    if (!(row.state === 'done' && row.result)) return { state: 'pending', rank: null, text: row.state === 'error' ? '조회 실패' : '조회 중' };
    const { result } = row;
    const far = rankLocality(result, coordinate)?.scope === 'far';
    const rank = result.status === 'found' && Number.isFinite(result.rank) ? result.rank : null;
    const text = far ? '먼 지역 결과'
        : rank !== null ? `${rank}위`
            : result.status === 'beyond' && Number.isFinite(result.scanned) ? `${result.scanned.toLocaleString('ko-KR')}위 밖` : '목록에 없음';
    const state = far || rank === null || rank > RANK_WEAK ? 'weak' : rank <= RANK_GOOD ? 'good' : 'mid';
    return { state, rank: far ? null : rank, text };
}

// 순위가 나쁜 등록 키워드의 "살펴볼 점" 문장
function lowRankReason(status) {
    if (status.text === '먼 지역 결과') return '검색 결과가 내 매장에서 먼 지역이라 이 키워드의 순위는 참고할 수 없습니다.';
    if (status.text === '목록에 없음') return `이 키워드로 검색하면 내 매장이 목록에서 보이지 않아 ${RANK_WEAK}위 안에 들지 못합니다.`;
    return `내 순위가 ${status.text}${p(status.text, '이라', '라')} ${RANK_WEAK}위 안에 들지 못합니다.`;
}

// ---------------------------------------------------------------------------
// 근거 점수 — 추천 한 줄·등록 낱말 하나의 근거를 구조화한 값으로 매깁니다(화면 추천 순서와 처방전 5칸이 같은 점수를 씁니다).
// 숫자는 문장이 아니라 전체 목록(잘리기 전의 리뷰 메뉴·예약 스타일·주간 인기 메뉴·메뉴판·소식·블로그 언급)에서 센 값입니다.
// 눈금(점): 내 순위 3위 안 36 · 10위 안 30 · 30위 안 18 · 그 밖 6 / 상위 매장 그 조합 등록 14 + 곳이 늘 때마다 6(최대 26)·그 낱말 사용 6 + 곳마다 3(최대 12) /
//   예약 300건↑ 26 · 100↑ 20 · 30↑ 14 · 그 밖 8 / 리뷰 방문자 리뷰 대비 15%↑ 26 · 5%↑ 20 · 2%↑ 14 · 그 밖 8(방문자 리뷰 수를 모르면 1,000회·300·100 기준) /
//   손님이 고른 좋은 점 30%↑ 26 · 10%↑ 20 · 3%↑ 14 · 그 밖 8 / 주간 인기 메뉴 22 / 블로그 후기 비율 50%↑ 16 · 25%↑ 12 · 10%↑ 8 · 그 미만 4 /
//   메뉴판·소식(가게가 스스로 적은 것이라 손님 쪽 근거보다 낮게): 메뉴 이름에 든 것 1개 8·2개↑ 12 + 소식 6(최대 18) / 업종 10(업종 대표어 6) · 매장 사실 8 · 등록 키워드 4
// ---------------------------------------------------------------------------

function numberIn(text, pattern) {
    const found = String(text ?? '').match(pattern);
    return found ? Number(found[1].replace(/,/g, '')) : null;
}

// reasons(화면에 적는 근거 칩)와 전체 목록 값으로 근거를 만듭니다. 돌려주는 값: { points, parts: [{ kind, points, text, short, ...숫자 }] } — parts 는 점수 높은 순
function evidenceFor(ctx, term, reasons) {
    const visitors = Number.isFinite(ctx.place?.visitorReviews) && ctx.place.visitorReviews > 0 ? ctx.place.visitorReviews : null;
    const share = (count) => (visitors !== null && Number.isFinite(count) ? count / visitors : null);
    const parts = [];
    const add = (part) => {
        if (part.points > 0) parts.push({ short: part.text, ...part });
    };
    for (const reason of list(reasons)) {
        const text = String(reason?.text ?? '').trim();
        if (!text) continue;
        switch (reason.kind) {
            case 'myRank': {
                const rank = numberIn(text, /(\d+)\s*위/);
                if (rank !== null) add({ kind: 'myRank', text, rank, points: rank <= 3 ? 36 : rank <= RANK_GOOD ? 30 : rank <= RANK_WEAK ? 18 : 6 });
                break;
            }
            case 'rival': {
                const count = numberIn(text, /상위\s*(\d+)\s*곳/) || 1;
                if (/등록/.test(text)) add({ kind: 'rival', text, exact: count, points: Math.min(26, 14 + 6 * (count - 1)) });
                else add({ kind: 'rival', text, short: `상위 ${count}곳 사용`, using: count, points: Math.min(12, 6 + 3 * (count - 1)) });
                break;
            }
            case 'booking': {
                const count = ctx.counts.booking.get(term.key) ?? numberIn(text, /([\d,]+)\s*건/);
                if (count) add({ kind: 'booking', text, count, points: count >= 300 ? 26 : count >= 100 ? 20 : count >= 30 ? 14 : 8 });
                break;
            }
            case 'review': {
                const count = ctx.counts.review.get(term.key) ?? numberIn(text, /([\d,]+)\s*회/);
                if (!count) break;
                const ratio = share(count);
                const full = ratio === null ? (count >= 1000 ? 26 : count >= 300 ? 20 : count >= 100 ? 14 : 8) : (ratio >= 0.15 ? 26 : ratio >= 0.05 ? 20 : ratio >= 0.02 ? 14 : 8);
                add({ kind: 'review', text, count, share: ratio, points: full });
                break;
            }
            case 'pos': {
                const hit = ctx.counts.pos.get(term.key);
                add({ kind: 'pos', text, rank: hit?.rank ?? null, share: hit?.share ?? null, name: hit?.name ?? null, points: 22 });
                break;
            }
            case 'blog': {
                const found = text.match(/(\d+)\s*\/\s*(\d+)/);
                if (!found || !Number(found[2])) break;
                const ratio = Number(found[1]) / Number(found[2]);
                add({ kind: 'blog', text, count: Number(found[1]), total: Number(found[2]), points: ratio >= 0.5 ? 16 : ratio >= 0.25 ? 12 : ratio >= 0.1 ? 8 : ratio > 0 ? 4 : 0 });
                break;
            }
            case 'fact': {
                // 메뉴 이름에 든 숫자(예: '4명 세트')를 손님 수로 읽지 않도록 메뉴 근거를 먼저 가립니다. 메뉴는 아래에서 한 줄로 모읍니다.
                if (/^메뉴\s/.test(text)) break;
                const voters = numberIn(text, /([\d,]+)\s*명/);
                if (voters !== null && /^손님이 고른 좋은 점/.test(text)) {
                    const ratio = share(voters);
                    add({ kind: 'vote', text, short: `고른 손님 ${voters.toLocaleString('ko-KR')}명`, label: text.match(/'(.+)'/)?.[1] ?? null, count: voters, share: ratio, points: ratio === null ? 14 : ratio >= 0.3 ? 26 : ratio >= 0.1 ? 20 : ratio >= 0.03 ? 14 : 8 });
                } else if (/등록 키워드/.test(text)) add({ kind: 'fact', text, label: text, points: 4 });
                else add({ kind: 'fact', text, label: text, points: 8 });
                break;
            }
            case 'category':
                add({ kind: 'category', text, industry: !/대표어/.test(text), points: /대표어/.test(text) ? 6 : 10 });
                break;
            case 'registered':
                add({ kind: 'registered', text, points: 4 });
                break;
            default:
                break;
        }
    }
    // 메뉴판·소식: 그 낱말이 든 메뉴 이름 전부와 소식 제목 전부(근거 칩에는 앞의 2개·1개만 적음)
    const menus = term.board?.menus ?? list(reasons).filter((reason) => reason.kind === 'fact' && /^메뉴\s/.test(String(reason.text))).map((reason) => String(reason.text).replace(/^메뉴\s*'?|'$/g, ''));
    const feeds = term.board?.feeds ?? list(reasons).filter((reason) => reason.kind === 'feed').map((reason) => String(reason.text).replace(/^소식\s*'?|'$/g, ''));
    if (menus.length || feeds.length) {
        add({
            kind: 'board',
            text: [menus.length ? `메뉴 ${menus.join('·')}` : null, feeds.length ? `소식 ${feeds.join('·')}` : null].filter(Boolean).join(' · '),
            short: [menus.length ? `메뉴 ${menus.length}개` : null, feeds.length ? `소식 ${feeds.length}건` : null].filter(Boolean).join('·'),
            menus,
            feeds,
            points: Math.min(18, (menus.length >= 2 ? 12 : menus.length === 1 ? 8 : 0) + (feeds.length ? 6 : 0)),
        });
    }
    parts.sort((a, b) => b.points - a.points);
    return { points: parts.reduce((sum, part) => sum + part.points, 0), parts };
}


// 매장 1곳의 추천 키워드와 등록 키워드 진단.
//   place, activity: 분석 결과 / rivals: [{ placeId, name, keywords }] (상위 매장 대표키워드, 없으면 생략)
//   ranks: 이미 조회한 순위([{ keyword, state, result }], 화면의 순위 표 줄과 같은 모양 — 없으면 생략).
//          주면 내 순위가 좋은 지역의 조합을 먼저 만들고, 내 순위가 나쁜 지역에는 새 조합을 만들지 않습니다(관문 '카').
// 돌려주는 값
//   regions    지역 낱말(주소·등록 키워드로 정한 순서. 순위로 바꾼 순서는 추천 조합에만 씁니다). 각 지역의 confirmedBy: address(주소·지점 이름·시·도) · station(가까운 역) ·
//              rank(순위 조회 결과가 알려 준 지역) · keywords(내 등록 키워드에 되풀이) · rivals(상위 매장 키워드에서도 되풀이)
//   items      추천 키워드(근거 점수 순, 쓸모 관문을 통과한 것만). registrable=false 는 순위 확인용, merged 는 하나로 묶인 다른 이름.
//              score = evidence.points, evidence = { points, parts: [{ kind, points, text, short, …숫자 }] } (점수 높은 순)
//              confirmedBy: 낱말이 무엇으로 확인됐는지 — industry(업종·업종 갈래·대표어·연관어) · registered(등록 키워드의 낱말) · menu(메뉴판 품목) · booking(예약 스타일) ·
//                pos(결제 인기 메뉴) · rival(상위 매장 둘 이상이 등록했고 업종·품목과 맞는 말). unverified 는 화면·처방전이 읽는 이름이라 남겨 두며 항상 false 입니다
//                (메뉴판·예약·결제 자료가 없는 매장의 리뷰 낱말도 추천이 아니라 후보 — lacks 'data').
//   candidates 후보(손님 쪽 근거가 있는 후보 → 메뉴판·예약·결제 줄에만 있는 후보(lacks voice) 순, 각각 점수 순, 최대 CANDIDATE_MAX 개): 관문은 통과했지만 메뉴판·예약·결제 품목으로 확인되지 않은 낱말 — 추천이 아니라 사장님이 직접 판단할 말입니다.
//              { keyword(첫 지역 + 낱말, 보여 주기용), term, region, source, reasons[], evidence{ points, parts }, score, why(단정 없는 한 줄),
//                lacks: 'menu'(품목에서 확인 못 함) | 'data'(메뉴판·예약·결제 자료가 아예 없어 확인할 수 없음) | 'voice'(가게 쪽만 확인, 손님 쪽 없음) |
//                       'share'(확인은 됐지만 주력 메뉴들의 1/3에 못 미치게 말해짐) | 'family'(업종·등록 낱말 가족에서 근거가 가장 센 메뉴인데 같은 낱말 칸이 이미 차서 추천에 못 오름) }
//              순위 조회 대상(pickRankKeywords)과 topTerm 에 넣지 않고, excluded 의 "확실히 아닌 말"도 후보에 넣지 않습니다.
//   excluded   관문에서 걸러낸 것 [{ term, keywords(만들어졌을 조합), rule, reason(사장님이 읽을 한 문장), into? }]
//              rule: broad(넓은 업종 이름) · extra(추가 메뉴) · vague(뜻이 넓음) · drink(술·음료) · otherBusiness(다른 업종의 낱말) ·
//                    condition(업종 연관어의 조건이 안 맞음) · rivalOnly(상위 매장만 쓰는 말) · noBlog(블로그 0개 + 다른 근거 없음) ·
//                    channel(포장·배달 — 받는 방법) · merged(겹치는 낱말을 하나로) · region(지역만 바꾼 조합) ·
//                    offMain(주력 갈래 밖의 메뉴) · classification(약·제품 분류 이름) · thin(근거가 매장 사실 하나뿐인 업종 연관어) ·
//                    attribute(조건·통로·인상·꾸밈 낱말) · place(메뉴 이름 속 다른 지명) · brand(상호: 낱말이 매장 이름과 같거나 이름을 품음) ·
//                    short(한 글자 낱말 — 리뷰·예약·결제에 나오지만 낱말로 쓰지 않음) ·
//                    rank(내 순위가 나쁜 지역 — 이때 term 은 지역 이름, keywords 는 그 지역에 만들었을 조합)
//              board: true — 메뉴판 한 줄에서만 나온 낱말(리뷰·결제·AI 브리핑 어디에도 없음)만 든 줄(8차 S-2, 9차에서 기준을 좁힘)
//              lead·why(offMain·otherBusiness 만): reason 을 "사실 한 문장 / 왜 지역 키워드로는 권하지 않는지 한 문장"으로 나눈 조각 — reason = lead + "다만 " + why + 쓸 자리 문장
//                    (사실이 없으면 lead 가 없고 reason = why + 쓸 자리). 화면이 "사실 / 이유 / 쓰기 좋은 곳(useIn)" 세 줄로 그립니다.
//              words·popular·useIn(offMain·otherBusiness 만): 한 줄로 묶인 낱말 전부 · 손님이 찾는다는 사실(리뷰 언급 수·순위, 주간 인기 메뉴 순위·비중·이름,
//                    AI 브리핑에 나오는지, 메뉴판에서 그 낱말이 든 메뉴 수/읽어 온 메뉴 수. 리뷰·결제·브리핑 어디에도 없으면 popular 가 없음) · 대신 쓸 자리
//              into: merged 는 묶인 낱말, classification 은 대신 쓸 손님 말. 그 낱말이 최종 추천(items)이나 등록 키워드에 있을 때만 붙습니다
//              이유가 가리키는 키워드는 화면에 보이는 것만입니다: region 줄은 남긴 조합이 items 나 등록 키워드에 있을 때만 나오고,
//              한 낱말이 다른 낱말을 품는 같은 이유의 줄은 한 줄로 묶입니다(term 은 가장 짧은 낱말, keywords 는 낱말마다 조합 하나씩)
//   registered 등록한 대표키워드별 진단(지역 유무·블로그 언급·바꿔 쓸 조합). concern 은 그 키워드가 관문에 걸린 이유({ rule, reason }, 없으면 null).
//              regionStatus: known(지역 낱말이 든 키워드, hasRegion true) · unknown(앞말이 있는데 지역인지 확인 못 함 — 지역이 없다고도 하지 않고 새 조합도 만들지 않음, 순위는 조회) ·
//                none(키워드 전체가 업종·품목·조건 낱말이거나 상호라 지역이 없음 — 바꿔 쓸 조합을 만듦, 순위 조회에서 뺌). 같은 지역·낱말을 표기만 달리해 두 칸 쓴 키워드는
//                뒤의 것에 concern { rule: 'duplicate' }
//              관문에 걸리지 않았어도 순위 표에서 30위 밖·목록에 없음·먼 지역 결과면 concern = { rule: 'lowRank', reason }
//              spoken 은 손님이 더 많이 쓰는 같은 뜻의 말(블로그 언급 비교, 분류 이름이면 대신 쓸 손님 말, everyPost: 블로그 후기 전부에 나오는 낱말이면 true)
//              evidence 는 그 낱말의 근거({ points, parts }, 이 키워드 자신의 내 순위 포함), rank 는 순위 표 줄의 상태({ state: pending|good|mid|weak, rank, text }, 줄이 없으면 null)
//   slotsLeft  대표키워드 빈 칸 수
//   topTerm    가장 중요한 낱말(자동 순위 조회가 지역 둘을 허용하는 낱말, 없으면 null)
//   hasRegionKeyword 지역이 든 키워드가 있는지(지역인지 확인 못 한 키워드가 있으면 "모두 지역명이 없다"고 말할 수 없어 있는 것으로 침)
//   emptyReason 등록할 수 있는 추천(순위 확인용 낱말 제외)이 하나도 없을 때만: noRegion(지역을 못 읽음) · allWeak(지역이 모두 순위가 낮음) · enough(등록한 키워드가 이미 같은 조합을 담음) · noData(권할 낱말을 못 찾음). 아니면 null
//   regionSource 지역을 어디서 읽었는지: address(주소·가까운 역·지점 이름) · keywords(주소에서 못 읽고 등록 키워드에서만) · none
export function recommendKeywords({ place: rawPlace, activity = null, rivals = [], ranks = [], limit = RECOMMEND_LIMIT } = {}) {
    const empty = { regions: [], items: [], candidates: [], excluded: [], registered: [], slotsLeft: 0, rivalCount: 0, hasRegionKeyword: false, topTerm: null, emptyReason: null, regionSource: 'none', confirmedTerms: [] };
    if (!rawPlace) return empty;
    const place = sanePlace(rawPlace);
    ACTIVE_MODIFIERS = repeatedModifiers(place);

    const others = uniqueRivals(rivals, place.placeId);
    const regions = regionTerms(place, { ranks, rivals: others });
    const terms = collectTerms(place, activity, regions);
    const family = familyOf(place);
    const familyTerms = [...(family?.base || []), ...(family?.related || []).map((item) => item.term), ...(family?.rankOnly || [])].map(compact);
    // 추가 낱말(7차 M3·s3, 8차 N2): 상위 매장 등록 수는 이 낱말들까지 넣어 세어야 정확합니다. 상위 매장 두 곳 이상이 쓰는 말은 보통 낱말이 되어 추천이 될 수 있습니다.
    const extraList = extraTerms(place, new Set(terms.keys()), mentionMap(activity));
    const extraStats = rivalStats(others, regions, [...terms.keys(), ...familyTerms, ...extraList.map((extra) => extra.key)]);
    for (const extra of extraList) {
        extra.rivals = extraStats.byTerm.get(extra.key) || 0;
        if (extra.rivals >= 2) terms.set(extra.key, extra);
    }
    const stats = rivalStats(others, regions, [...terms.keys(), ...familyTerms]);
    const myKeywords = list(place.keywords);
    const mine = new Set(myKeywords.map(compact));

    // 상위 매장 두 곳 이상이 쓰는 낱말은 후보에 올립니다. 추천에 넣을지는 관문이 내 매장 근거를 보고 정합니다(나).
    for (const [key, count] of stats.byTerm) {
        const term = terms.get(key);
        if (term) {
            term.weight += Math.min(24, 8 * count);
            term.rivals = count;
        } else if (count >= 2 && TERM.test(key) && !/[0-9a-z]/i.test(key) && !isPromo(key)) {
            terms.set(key, { term: key, key, source: 'rival', weight: 26 + Math.min(24, 8 * count), reasons: [], registrable: true, rivals: count });
        }
    }

    const ctx = gateContext(place, activity, regions);
    ctx.final = others.length > 0 || list(ranks).length > 0;
    const gate = gateTerms(ctx, terms);

    // 추가 낱말 가운데 terms 에 들지 못한 것: 관문에 걸리면 이유와 함께 excluded 에 남기고(한 줄 품목만, 8차 S-2), 통과해도 두 쪽 확인이 안 되면 후보로 둡니다.
    // 두 쪽 확인을 통과한 리뷰 상위 8개 밖 낱말은 지금처럼 자리 밖이라 보이지 않습니다.
    const knownKeys = new Set([...terms.keys(), ...gate.excluded.map((entry) => entry.term.key)]);
    for (const term of terms.values()) for (const merged of list(term.merged)) knownKeys.add(compact(merged));
    const extraCandidates = [];
    for (const term of extraList) {
        if (knownKeys.has(term.key)) continue;
        const verdict = termVerdict(ctx, term);
        if (verdict) {
            if (term.lineOnly) gate.excluded.push({ term, ...verdict });
            continue;
        }
        term.confirm = confirmationOf(ctx, term);
        term.lacksVoice = ['menu', 'booking', 'pos'].includes(term.confirm) && !customerSide(ctx, term);
        if (!(term.confirm && !term.lacksVoice)) extraCandidates.push(term);
    }

    // 확인 관문: 추천(items)에 오르는 것은 확인된 낱말(confirm)뿐입니다.
    // 관문은 통과했지만 이 매장의 품목으로 확인되지 않은 낱말은 후보(candidates)로만 보여 줍니다(순위 조회 대상·topTerm 에는 넣지 않음).
    const onList = (term) => Boolean(term.confirm) && !term.lacksVoice && !term.shareSide;
    const passedAll = [...gate.passed.values()];
    const ordered = passedAll.filter(onList).sort((a, b) => b.weight - a.weight);
    const candidateTerms = passedAll.filter((term) => !onList(term) && term.source !== 'rankOnly').sort((a, b) => b.weight - a.weight);

    // 카. 내 순위로 지역 순서를 정합니다: 내 순위가 좋은(10위 안) 지역을 순위 순으로 앞에, 나머지는 원래 순서.
    // 나쁜 지역(조회한 서로 다른 낱말 둘 이상이 모두 30위 밖·먼 지역 결과)은 제자리에 두되 새 조합을 만들지 않습니다(살펴본 수에는 넣음).
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
    // 순위 표에 있는 조합을 낱말별로 모읍니다(관문 '바'). kind: held(조회 중·실패·10위 안) · mid(11~30위) · weak(30위 밖·살펴본 범위 밖·목록에 없음·먼 지역 결과).
    // rowOf: 지역·낱말이 같은 조합(표기만 다른 것 포함)의 순위 표 줄. 그 줄의 표기를 그대로 써서 순위 표와 추천이 같은 키워드를 가리키게 합니다.
    const tableOf = new Map();
    const rowOf = new Map();
    for (const row of list(ranks)) {
        if (!row?.keyword) continue;
        const matched = matchRegion(row.keyword, regions);
        const core = keywordCore(row.keyword, regions);
        if (!matched || !core) continue;
        const done = row.state === 'done' && row.result;
        const rank = done && row.result.status === 'found' && Number.isFinite(row.result.rank) ? row.result.rank : null;
        const far = done && rankLocality(row.result, place.coordinate)?.scope === 'far';
        const kind = !done ? 'held' : (far || rank === null || rank > RANK_WEAK) ? 'weak' : rank <= RANK_GOOD ? 'held' : 'mid';
        const text = far ? '먼 지역 결과' : rank !== null ? `${rank}위` : '30위 밖';
        const entry = { key: compact(row.keyword), keyword: String(row.keyword).trim(), region: matched.region, kind, rank, text, core };
        tableOf.set(core, [...(tableOf.get(core) || []), entry]);
        if (!rowOf.has(`${matched.region.term}|${core}`)) rowOf.set(`${matched.region.term}|${core}`, entry);
    }

    // 걸러낸 낱말로 만들어졌을 조합(앞의 지역부터 count 개, 나쁜 지역 제외). 사장님이 이미 등록한 키워드는 "뺀 조합"이 아니라서 넣지 않습니다.
    const combosOf = (term, count) => order
        .filter((region) => !isWeak(region))
        .filter((region) => !term.key.includes(compact(region.term)) && !region.variants.some((variant) => term.key.includes(variant)))
        .map((region) => `${region.term}${term.term}`)
        .filter((keyword) => Array.from(compact(keyword)).length <= KEYWORD_MAX_LEN && !mine.has(compact(keyword)))
        .slice(0, count);

    // 바. 한 낱말에는 지역 하나가 원칙입니다(사장님이 이미 등록한 조합·순위 표에 이미 있는 조합도 그 하나로 칩니다). 예외는 둘뿐입니다.
    //   ① 그 조합을 그대로 등록한 상위 매장이 있을 때(그 조합 자체의 근거) — 아래 반복에서 exact 로 봅니다.
    //   ② 가장 중요한 낱말(top)은 등록한 것을 포함해 둘까지. 둘째 지역은 내 순위가 좋은 지역(10위 안 키워드가 있는 지역)일 때만,
    //      첫 분석처럼 순위 표가 아직 없을 때는 순위를 조회해 볼 후보로 하나만(조회가 끝나면 좋은 지역만 남음).
    // 순위 표에 이 낱말의 조합이 이미 있으면(조회 중·실패·순위 있음) 다른 지역의 새 조합은 만들지 않습니다.
    // 다만 그 조합이 30위 밖으로 확인됐고 내 순위가 좋은 지역이 따로 있으면, 그 지역의 조합으로 바꿔 권합니다.
    // 같은 낱말은 두 예외를 합쳐도 등록한 칸을 포함해 SAME_TERM_MAX 칸까지입니다(순위가 30위 밖이라 바꿀 등록 칸은 세지 않음).
    const ownCombos = new Map();
    // 등록한 조합과 지역·낱말이 같으면(표기만 다름: 서초임플란트 ↔ 서초역임플란트) 이미 등록한 것입니다.
    const ownIdentity = new Set();
    for (const keyword of myKeywords) {
        const matched = matchRegion(keyword, regions);
        if (!matched) continue;
        const core = keywordCore(keyword, regions);
        ownCombos.set(core, [...(ownCombos.get(core) || []), keyword]);
        ownIdentity.add(`${matched.region.term}|${core}`);
    }
    const top = ordered.find((term) => term.source !== 'rankOnly') || null;
    const hasRegion = (term, region) => term.key.includes(compact(region.term)) || region.variants.some((variant) => term.key.includes(variant));
    // 낱말 하나의 지역 계획: keep = 새 조합을 권할 지역 이름들, swapFrom = 30위 밖이라 바꾼 순위 표 줄들
    // 지역인지 확인하지 못한 등록 키워드(unknown)도 그 낱말의 칸입니다(등록 1 + 추천 2 로 세 칸을 권하지 않게): 키워드가 그 낱말로 끝나면 센다.
    const unknownReader = regionReader(place, regions);
    const unknownOwn = new Map();
    for (const keyword of myKeywords) {
        if (matchRegion(keyword, regions) || unknownReader(keyword) !== 'unknown') continue;
        const text = compact(keyword);
        for (const term of ordered) if (text.length > term.key.length && text.endsWith(term.key)) unknownOwn.set(term.key, (unknownOwn.get(term.key) || 0) + 1);
    }
    const planFor = (term, own) => {
        const rows = tableOf.get(term.key) || [];
        const usable = order.filter((region) => !isWeak(region) && !hasRegion(term, region));
        const aliveRows = rows.filter((row) => row.kind !== 'weak');
        const weakRows = rows.filter((row) => row.kind === 'weak');
        const alive = new Set([...own.map((keyword) => matchRegion(keyword, regions)?.region.term), ...aliveRows.map((row) => row.region.term)].filter(Boolean));
        const keep = new Set(aliveRows.map((row) => row.region.term));
        let swapFrom = null;
        let swapGood = false;
        if (alive.size === 0) {
            const better = usable.filter((region) => standing.get(region.term)?.good && !weakRows.some((row) => row.region === region));
            // 이 낱말의 조합이 30위 밖으로 확인된 지역은, 그 지역에 다른 낱말로 10위 안이 있을 때가 아니면 같은 조합을 다시 권하지 않고 다른 지역으로 갑니다.
            const fresh = usable.filter((region) => !(weakRows.some((row) => row.region === region) && !standing.get(region.term)?.good));
            if (weakRows.length > 0 && better.length > 0) {
                keep.add(better[0].term);
                swapFrom = weakRows;
                swapGood = true;
            } else if (fresh.length > 0) {
                keep.add(fresh[0].term);
                if (weakRows.length > 0 && !weakRows.some((row) => row.region === fresh[0])) swapFrom = weakRows;
            }
        }
        if (term === top) {
            const total = new Set([...alive, ...keep]);
            if (total.size < 2) {
                const probe = alive.size === 0 && weakRows.length === 0;
                const second = usable.find((region) => !total.has(region.term) && (standing.get(region.term)?.good || (probe && !standing.has(region.term))));
                if (second) keep.add(second.term);
            }
        }
        // 이미 등록한 칸 가운데 순위가 30위 밖인 것은 바꿀 대상이라 칸 수에 넣지 않습니다.
        // 칸 수는 지역 이름 수가 아니라 실제로 쓰고 있는 칸(등록 키워드) 수입니다: "제주흑돼지"·"제주시흑돼지"는 같은 지역 이름이어도 두 칸입니다.
        const weakKeys = new Set(weakRows.map((row) => row.key));
        const liveOwn = own.filter((keyword) => !weakKeys.has(compact(keyword)));
        const liveRegions = new Set(liveOwn.map((keyword) => matchRegion(keyword, regions)?.region.term).filter(Boolean));
        // 순위 표에 이미 있는 조합(조회 중·실패·10위 안)은 항상 남기므로 칸 수에 먼저 칩니다(등록한 칸과 겹치는 것은 한 번만).
        const heldRegions = new Set(rows.filter((row) => row.kind === 'held' && !liveRegions.has(row.region.term)).map((row) => row.region.term));
        return { keep, swapFrom, swapGood, taken: liveOwn.length + heldRegions.size + (unknownOwn.get(term.key) || 0) };
    };
    // 나쁜 지역에 만들지 않은 조합(지역별)
    const rankSkipped = new Map();

    const combos = [];
    const swapped = [];
    const seen = new Set();
    // K-E ②. 등록·업종 낱말(root)에 묶인 구체 품목 가운데 손님이 가장 많이 말한 하나(pick)는 root 와 한 가족입니다: 가족은 같은 낱말처럼 두 칸까지(root 한 칸 + pick 한 칸).
    // root 는 pick 몫 한 칸을 남겨 두고, pick 은 root 가 쓴 칸(등록한 칸 + 새로 권한 조합)을 뺀 나머지만 씁니다. 그래서 pick 은 root 를 다 본 뒤에 봅니다.
    const picks = ordered.filter((term) => term.familyRoot && ordered.includes(term.familyRoot));
    const reserved = new Map();
    for (const pick of picks) reserved.set(pick.familyRoot.key, (reserved.get(pick.familyRoot.key) || 0) + 1);
    const usage = new Map();
    for (const term of [...ordered.filter((item) => !picks.includes(item)), ...picks]) {
        const own = ownCombos.get(term.key) || [];
        const plan = planFor(term, own);
        // 새로 살펴보는 조합은 낱말마다 2개(가장 중요한 낱말은 3개)까지입니다. 계획에 든 지역과 순위 표에 있는 조합은 이 수와 관계없이 봅니다.
        const tryMax = picks.includes(term) ? 1 : term === top ? 3 : 2;
        let tried = 0;
        let spent = 0; // 이번에 새로 쓴 칸(순위 표에 이미 있는 조합은 plan.taken 에 이미 셌으므로 더하지 않음)
        const made = [];
        const skipped = [];
        // 같은 낱말 칸 수: 등록한 칸(30위 밖 제외)과 순위 표에 이미 있는 조합(조회 중·실패·10위 안)을 먼저 치고 남는 만큼만 새로 권합니다.
        let room = Math.max(0, SAME_TERM_MAX - plan.taken - (reserved.get(term.key) || 0) - (picks.includes(term) ? usage.get(term.familyRoot.key) || 0 : 0));
        if (picks.includes(term)) term.familyRoom = room;
        for (const [regionIndex, region] of order.entries()) {
            if (hasRegion(term, region)) continue;
            const identity = `${region.term}|${term.key}`;
            const row = rowOf.get(identity);
            const sameOwn = ownIdentity.has(identity);
            // 순위 표에 같은 지역·같은 낱말 조합이 있으면 그 줄의 표기를 그대로 씁니다(순위 표와 추천이 같은 키워드를 가리키게).
            const canonical = `${region.term}${term.term}`;
            const variantForm = row && region.variants.some((variant) => row.key === `${variant}${term.key}`) ? row.keyword : null;
            const keyword = variantForm && !sameOwn ? variantForm : canonical;
            const key = compact(keyword);
            const isMine = mine.has(key) || sameOwn;
            const holding = held.has(key) && !isMine;
            if (tried >= tryMax && !holding && !plan.keep.has(region.term)) continue;
            if (seen.has(key) || seen.has(compact(canonical)) || Array.from(key).length > KEYWORD_MAX_LEN) continue;
            seen.add(key);
            seen.add(compact(canonical));
            const exact = stats.exact.get(key)?.count || stats.exact.get(compact(canonical))?.count || 0;
            // 이미 등록한 조합은 살펴본 수에 넣지 않아, 아직 안 쓴 지역과의 조합을 봅니다.
            if (!isMine) {
                if (!holding) tried += 1;
                // 카. 내 순위가 나쁜 지역에는 새 조합을 만들지 않습니다(그 조합을 등록한 상위 매장이 있어도).
                if (isWeak(region)) {
                    rankSkipped.set(region.term, [...(rankSkipped.get(region.term) || []), keyword]);
                    continue;
                }
                // 계획에 든 지역, 순위 표에 이미 있는 조합(조회 중·실패·10위 안), 그 조합을 그대로 등록한 상위 매장이 있는 조합만 권합니다.
                // 같은 낱말 칸이 다 찼으면(room) 순위 표에 이미 있는 조합만 남깁니다.
                // 이 조합 자체가 30위 밖으로 확인된 지역(그 지역에 다른 낱말로 10위 안이 없을 때)은 같은 조합을 다시 권하지 않습니다.
                const confirmedWeak = row?.kind === 'weak' && !standing.get(region.term)?.good;
                const allowed = !confirmedWeak && (plan.keep.has(region.term) || holding || exact > 0);
                if (!allowed || (room <= 0 && !holding)) {
                    skipped.push(keyword);
                    continue;
                }
                if (!holding) {
                    room -= 1;
                    spent += 1;
                }
                made.push(keyword);
            }
            const reasons = [...term.reasons];
            if (exact > 0) reasons.unshift({ kind: 'rival', text: `상위 ${exact}곳 등록` });
            else if (term.rivals > 0) reasons.push({ kind: 'rival', text: `상위 ${term.rivals}곳이 '${term.term}' 사용` });
            // 이미 조회해 10위 안인 조합에는 그 순위를 붙입니다(그 조합을 권하는 근거).
            if (Number.isFinite(held.get(key)) && !isMine) reasons.unshift({ kind: 'myRank', text: `내 ${held.get(key)}위` });
            // 카. 내 순위 때문에 앞으로 온 지역의 조합에는 그 지역에서의 내 순위를 붙입니다(이미 순위를 조회한 키워드에는 붙이지 않음).
            const lead = movedAhead.has(region.term) ? standing.get(region.term).best : null;
            if (lead && !queried.has(key)) reasons.push({ kind: 'regionRank', text: `'${lead.keyword}' 내 ${lead.rank}위` });
            const registrable = term.registrable && !isPromo(keyword);
            const evidence = registrable ? evidenceFor(ctx, term, reasons) : { points: 0, parts: [] };
            combos.push({
                keyword,
                region: region.term,
                regionScope: region.scope,
                term: term.term,
                source: term.source,
                // 점수 = 근거 점수. 추천 순서는 이 점수 내림차순이라, 화면 추천을 위에서부터 채우면 처방전 5칸이 됩니다.
                score: evidence.points,
                evidence,
                reasons,
                blog: term.blog ?? null,
                rivalCount: exact,
                registered: isMine,
                registrable,
                // 무엇으로 확인된 낱말인지(industry·registered·menu·booking·pos·rival). unverified 는 화면·처방전이 읽는 이름이라 남겨 두며 지금은 항상 false 입니다
                // (품목 자료가 없는 매장의 리뷰 낱말도 추천이 아니라 후보로 갑니다).
                confirmedBy: term.confirm || null,
                unverified: false,
                ...(term.merged ? { merged: term.merged } : {}),
                // 정렬용(돌려주기 전에 뗌)
                tieWeight: term.weight,
                regionIndex,
            });
        }
        usage.set(term.key, plan.taken + spent);
        // 남긴 조합(own: 이미 등록한 것, made: 새로 만든 것)이 화면에 보이는지는 추천을 limit 로 자른 뒤에야 알 수 있어, 줄은 아래에서 만듭니다.
        if (skipped.length > 0) swapped.push({ term: term.term, keywords: skipped, own, made, weight: term.weight, swapFrom: plan.swapFrom, swapGood: plan.swapGood });
    }
    combos.sort((a, b) => b.score - a.score || b.tieWeight - a.tieWeight || a.regionIndex - b.regionIndex || a.keyword.localeCompare(b.keyword, 'ko'));
    // 가족 pick 이 칸이 없어(같은 낱말 두 칸을 이미 씀·권할 지역이 없음) 추천에 못 오르면 묶여 사라지지 않고 후보(lacks 'family')로 남깁니다.
    const comboTerms = new Set(combos.map((item) => compact(item.term)));
    const familyFull = picks.filter((pick) => !comboTerms.has(pick.key));
    for (const pick of familyFull) pick.familyFull = true;

    // 화면에 실제로 보이는 것: 최종 추천(limit 안)과 이미 등록한 키워드. 걸러낸 이유가 "이미 있다"·"하나로 묶었다"고 가리키는 것은 이 안에 있어야 합니다.
    // 정렬: 근거 점수 순으로 limit 개를 고른 뒤, 대표키워드로 등록할 수 있는 추천을 앞에, 순위 확인용(registrable=false, 맛집 등)을 뒤로 보냅니다.
    const picked = combos.filter((item) => !item.registered).slice(0, limit);
    const items = [...picked.filter((item) => item.registrable), ...picked.filter((item) => !item.registrable)]
        .map(({ tieWeight, regionIndex, ...item }) => item);
    // 같은 낱말이 두 번째 칸에 오른 까닭 한 줄(note 근거, 근거 점수에는 넣지 않음). 같은 낱말은 두 칸까지라는 규칙이 "지역만 다른 중복"으로 읽히지 않게,
    // 왜 두 번인지를 사실일 때만 적습니다: 상위 매장이 그 조합을 등록했다 / 두 지역 모두 내 키워드가 10위 안이다 / 첫 분석이라 순위를 조회해 볼 후보다.
    const rankRowOf = new Map(list(ranks).filter((row) => row?.keyword).map((row) => [compact(row.keyword), row]));
    items.forEach((item, at) => {
        if (item.registered || item.registrable === false) return;
        const termKey = compact(item.term);
        // 이 낱말로 이미 쓰고 있는 칸: 등록한 키워드(순위가 30위 밖이라 바꿀 칸은 제외)와 추천 목록에서 앞서 나온 같은 낱말
        const twins = myKeywords.filter((keyword) => keywordCore(keyword, regions) === termKey && matchRegion(keyword, regions)
            && rankStatusOf(rankRowOf.get(compact(keyword)), place.coordinate)?.state !== 'weak');
        const before = items.slice(0, at).filter((other) => other.registrable !== false && compact(other.term) === termKey);
        if (twins.length + before.length === 0) return;
        const involved = [...new Set([...twins.map((keyword) => matchRegion(keyword, regions).region.term), ...before.map((other) => other.region), item.region])];
        const good = (name) => standing.get(name)?.good === true;
        let basis = null;
        if (item.rivalCount > 0) basis = `상위 ${item.rivalCount}곳이 이 조합을 등록`;
        else if (involved.length >= 2 && involved.every(good)) basis = `${involved.join('·')} ${involved.length === 2 ? '두' : involved.length === 3 ? '세' : `${involved.length}`} 지역 모두 내 키워드가 ${RANK_GOOD}위 안`;
        else if (top && termKey === top.key && !tableOf.has(termKey) && !standing.has(item.region)) basis = '순위를 조회해 보는 후보(조회가 끝나면 내 순위가 좋은 지역만 남김)';
        if (!basis) return;
        const own = twins.length > 0 ? ` — 이미 등록한 '${twins[0]}'${p(twins[0], '과', '와')} 같은 낱말이고, ` : ' — ';
        item.reasons.push({ kind: 'note', text: `'${item.term}' 두 번째 칸${own}${basis}` });
    });
    // 가족 pick 의 까닭 한 줄(note 근거, 근거 점수에는 넣지 않음): 왜 '김밥'과 별개로 '참치김밥'도 권하는지.
    for (const item of items) {
        const pick = terms.get(compact(item.term));
        if (!pick?.familyRoot || item.registered || item.registrable === false) continue;
        // 사실일 때만 "가장 많은": 이 가족 이름을 품은 다른 품목이 더 많이 말해졌으면(치킨무·버거소스처럼 구성원이 아닌 것 포함) 순위를 말하지 않고 구체 메뉴라고만 적습니다.
        const said = ctx.counts.review.get(pick.key) || 0;
        const basis = pick.familyStronger
            ? `'${pick.familyRoot.term}'의 구체 메뉴${said > 0 ? `(리뷰 ${said.toLocaleString('ko-KR')}회)` : ''}`
            : `'${pick.familyRoot.term}' 가운데 ${said > 0 ? '리뷰가 가장 많은 메뉴' : '손님 쪽 근거가 가장 센 메뉴'}`;
        item.reasons.push({ kind: 'note', text: basis });
    }
    const shownKeywords = new Set(items.map((item) => compact(item.keyword)));
    const shownTerms = new Set([...items.map((item) => compact(item.term)), ...myKeywords.map((keyword) => keywordCore(keyword, regions))]);
    const lastOf = (words) => words[words.length - 1];

    // 바. 지역만 바꾼 조합: 남긴 조합이 화면에 보일 때만 줄을 냅니다. 남긴 조합이 추천 자리 밖으로 밀린 낱말은
    // 걸러낸 것이 아니라 자리에 못 든 것이라 줄을 내지 않습니다. 문장은 등록한 키워드와 추천에 있는 조합을 가려 적습니다.
    const regionEntries = swapped.sort((a, b) => b.weight - a.weight).flatMap(({ term, keywords, own, made, swapFrom, swapGood }) => {
        const listed = made.filter((keyword) => shownKeywords.has(compact(keyword)));
        if (own.length === 0 && listed.length === 0) return [];
        const names = (words) => words.map(quoted).join('·');
        // 순위 표의 조합이 30위 밖이라 내 순위가 좋은 지역의 조합으로 바꾼 경우는 그 사실을 적습니다.
        if (swapFrom && listed.length > 0) {
            const was = swapFrom.map((row) => row.keyword);
            const places = swapFrom.map((row) => row.text).join('·');
            return [{
                term, keywords, rule: 'region',
                reason: `${names(was)}${p(lastOf(was), '은', '는')} 내 순위가 ${places}${p(swapFrom[swapFrom.length - 1].text, '이라', '라')} ${swapGood ? '순위가 좋은 지역' : '다른 지역'}의 ${names(listed)}${ro(lastOf(listed))} 바꿔 권하며, ${quoted(term)}에 지역만 바꾼 조합은 더 권하지 않습니다.`,
            }];
        }
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
            // (네 번째 값 null: 손님이 찾는다는 사실은 낱말마다 달라 비교에서 뺍니다)
            return { entry, at, into, shape: entry.tell(['\u0001'], '', into, null) };
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
            // 메뉴판 한 줄에서만 나온 낱말(boardOnly)은 서로 품지 않아도 같은 이유면 한 줄로 묶습니다(8차 S-2). 손님 쪽 근거가 있는 낱말은 그 줄에 섞지 않습니다.
            const group = groups.find((other) => other.rule === line.entry.rule && other.shape === line.shape
                && (line.entry.term.key.includes(other.members[0].term.key) || (boardOnly(ctx, line.entry.term) && other.members.every((member) => boardOnly(ctx, member.term)))));
            if (group) {
                group.members.push(line.entry);
                group.at = Math.min(group.at, line.at);
            } else groups.push({ rule: line.entry.rule, shape: line.shape, into: line.into, at: line.at, members: [line.entry] });
        });
    const gateEntries = groups.sort((a, b) => a.at - b.at).map(({ rule, into, members }) => ({
        term: members[0].term.term,
        // 상호(brand)는 지역을 붙인 조합 자체를 권하지 않으므로 "만들었을 조합"을 적지 않습니다.
        keywords: rule === 'brand' || rule === 'unrelated' ? [] : members.length === 1 ? combosOf(members[0].term, 2) : members.flatMap((entry) => combosOf(entry.term, 1)),
        rule,
        reason: members[0].tell(members.map((entry) => entry.label), lastOf(members).term.term, into, members.map((entry) => entry.term)),
        ...(into ? { into } : {}),
        // board: 메뉴판 한 줄에서만 나온 낱말(손님 쪽 근거 없음)만 든 줄(8차 S-2, 9차: 리뷰·결제·브리핑에도 나온 낱말은 board 가 아님). 소비하는 쪽이 따로 다룰 수 있게 표시합니다.
        ...(members.every((entry) => boardOnly(ctx, entry.term)) ? { board: true } : {}),
        // 손님이 찾는 메뉴라는 사실(offMain·otherBusiness): 처방전이 "키워드로는 빼지만 소식·메뉴 설명에는 쓰세요"에 씁니다.
        // lead(사실 한 문장, 사실이 없으면 생략)·why(왜 지역 키워드로는 권하지 않는지 한 문장)는 화면이 "사실 / 이유 / 쓰기 좋은 곳" 세 줄로 그립니다.
        ...(members[0].sentenceOf ? members[0].sentenceOf(members.map((entry) => entry.label), lastOf(members).term.term, members.map((entry) => entry.term)) : {}),
        ...(members[0].factsOf ? members[0].factsOf(members.map((entry) => entry.term)) : {}),
    }));
    // 한 글자 낱말(회·탕)은 낱말로 쓰지 않으니 조용히 사라지지 않게 이유와 함께 알립니다.
    const shortEntries = shortNamesOf(place).map((entry) => ({
        term: entry.term, keywords: [], rule: 'short',
        reason: `${entry.where} '${entry.term}'${p(entry.term, '이', '가')} 나오지만, 한 글자 낱말이라 이 말만으로는 어떤 메뉴를 찾는지 가려지지 않아 지역을 붙인 키워드로는 권하지 않습니다.`,
    }));
    const excluded = [...gateEntries, ...shortEntries, ...weakEntries, ...regionEntries];

    // 후보: 관문은 통과했지만 이 매장의 품목(메뉴판·예약 스타일·결제 인기 메뉴)으로 확인되지 않은 낱말. 추천이 아니라 사장님이 직접 판단할 말이라
    // 순위 조회 대상(pickRankKeywords)과 topTerm 에는 넣지 않습니다. 보여 주는 키워드는 첫 지역 + 낱말입니다.
    const candidates = [...candidateTerms, ...familyFull, ...gate.kept, ...extraCandidates].map((term) => {
        const region = order.find((item) => !isWeak(item) && !hasRegion(term, item)) || order.find((item) => !hasRegion(term, item)) || null;
        const joined = region ? `${region.term}${term.term}` : term.term;
        const reasons = [...term.reasons];
        if (term.rivals > 0) reasons.push({ kind: 'rival', text: `상위 ${term.rivals}곳이 '${term.term}' 사용` });
        const evidence = evidenceFor(ctx, term, reasons);
        return {
            keyword: Array.from(joined).length <= KEYWORD_MAX_LEN ? joined : term.term,
            term: term.term,
            region: region ? region.term : null,
            source: term.source,
            reasons,
            evidence,
            score: evidence.points,
            why: term.rivalKept ? rivalKeptWhy(term) : term.familyFull ? familyWhy(ctx, term) : term.shareSide ? shareWhy(term) : term.lacksVoice ? voiceWhy(ctx, term) : unconfirmedWhy(ctx, term),
            // menu: 메뉴판·예약·결제 품목에서 확인되지 않음 / data: 메뉴판·예약·결제 자료가 아예 없어 확인할 수 없음 /
            // voice: 메뉴판·예약·결제 품목에는 있지만 손님 쪽(리뷰·상위 매장 키워드)에서 확인되지 않음 /
            // share: 확인은 됐지만 이 매장에서 가장 많이 말해진 주력 메뉴들에 견주면 리뷰가 훨씬 적음(주력인지는 사장님이 판단)
            // family: 업종·등록 낱말 가족에서 근거가 가장 센 메뉴인데 같은 낱말 칸이 이미 차서(등록 칸 포함) 추천에 오르지 못함
            lacks: term.familyFull || term.rivalKept ? 'family' : term.shareSide ? 'share' : term.lacksVoice ? 'voice' : ctx.hasItemData ? 'menu' : 'data',
            tieWeight: term.weight,
            reviews: ctx.counts.review.get(term.key) || 0,
            bookings: ctx.counts.booking.get(term.key) || 0,
        };
    })
        .filter((item) => !mine.has(compact(item.keyword)))
        // 손님 쪽 근거가 있는 후보(리뷰에 나온 말·상위 매장이 쓰는 말: lacks menu·share·family·data)가 메뉴판·예약·결제 줄에만 있는 후보(lacks voice)보다 항상 앞이고,
        // 그 안에서 점수 순입니다. 점수가 같으면 리뷰 수·예약 수가 많은 쪽이 앞입니다.
        .sort((a, b) => (a.lacks === 'voice') - (b.lacks === 'voice') || b.score - a.score || b.reviews - a.reviews || b.bookings - a.bookings || b.tieWeight - a.tieWeight || a.keyword.localeCompare(b.keyword, 'ko'))
        .slice(0, CANDIDATE_MAX)
        .map(({ tieWeight, reviews, bookings, ...item }) => item);

    // 등록 키워드 진단
    const best = (core) => combos.find((item) => compact(item.term) === core && !item.registered) || null;
    const rowByKeyword = new Map(list(ranks).filter((row) => row?.keyword).map((row) => [compact(row.keyword), row]));
    const readRegion = regionReader(place, regions);
    // 같은 지역·같은 낱말을 표기만 달리해 두 칸 등록한 키워드("제주흑돼지"·"제주시흑돼지")는 뒤의 것에 살펴볼 점을 답니다.
    const firstOfIdentity = new Map();
    const registered = myKeywords.map((keyword) => {
        const matched = matchRegion(keyword, regions);
        const regionStatus = matched ? 'known' : readRegion(keyword);
        const core = keywordCore(keyword, regions);
        const term = terms.get(core);
        // 지역이 없다고 확실한 키워드(none)만 바꿔 쓸 조합을 만듭니다. 앞말이 지역인지 확인 못 한 키워드(unknown)는 낱말과 지역을 가를 수 없어 만들지 않습니다.
        const suggestion = regionStatus !== 'none' || !core ? null : best(core);
        const identity = matched && core ? `${matched.region.term}|${core}` : null;
        const twin = identity ? firstOfIdentity.get(identity) : null;
        if (identity && !twin) firstOfIdentity.set(identity, keyword);
        const duplicate = twin && compact(twin) !== compact(keyword)
            ? { rule: 'duplicate', reason: `${quoted(keyword)}${p(keyword, '은', '는')} ${quoted(twin)}${p(twin, '과', '와')} 지역·낱말이 같아 대표키워드 칸을 둘 쓰고 있습니다. 한 칸은 다른 낱말이나 지역에 쓸 수 있는지 살펴보세요.` }
            : null;
        // 등록한 낱말보다 블로그 후기에서 더 많이 쓰는 같은 뜻의 낱말("건강기능식품" 0개 · "영양제" 4개).
        // 약·제품 분류 이름(차)이면 블로그 수와 관계없이 손님이 검색할 때 쓰는 말을 알려 줍니다("일반의약품" → "약국").
        const instead = intoOf.get(core);
        const spoken = (instead ? gate.passed.get(compact(instead)) : null) || [...gate.passed.values()]
            .filter((other) => other.fromKeyword === compact(keyword) && other.blog > (term?.blog ?? 0))
            .sort((a, b) => b.blog - a.blog)[0] || null;
        // 순위 표에 이 키워드의 줄이 있으면 그 상태를 적습니다. 30위 밖·목록에 없음·먼 지역이면 살펴볼 점(lowRank)도 답니다 —
        // 화면의 칩과 처방전이 같은 말을 하게 합니다(관문에 걸린 이유가 있으면 그것이 먼저).
        const status = rankStatusOf(rowByKeyword.get(compact(keyword)), place.coordinate);
        const lowRank = status?.state === 'weak' ? { rule: 'lowRank', reason: lowRankReason(status) } : null;
        // 등록 낱말의 근거: 낱말의 전체 근거 + 이 키워드 자신의 내 순위
        const evidence = term ? evidenceFor(ctx, term, [...term.reasons, ...(status?.rank ? [{ kind: 'myRank', text: `내 ${status.rank}위` }] : [])]) : { points: 0, parts: [] };
        return {
            keyword,
            hasRegion: matched !== null,
            // known(지역 확인) · unknown(앞말이 있는데 지역인지 확인 못 함 — 지역이 없다고 말하지 않음) · none(키워드 전체가 업종·품목 낱말이라 지역이 없음)
            regionStatus,
            region: matched ? matched.region.term : null,
            core: core || null,
            blog: term?.blog ?? null,
            rivalCount: stats.exact.get(compact(keyword))?.count || 0,
            suggest: suggestion ? suggestion.keyword : null,
            // everyPost: 블로그 후기 전부에 나오는 낱말(업종 이름 "약국" 11/11). 그런 낱말의 개수는 등록 낱말과 견줄 근거가 못 되니, 화면은 개수 비교를 하지 않습니다.
            // why: 분류 이름을 손님 말로 바꿔 쓰라는 까닭(8차 노트북 관찰: "개수로 견주지 않았다"는 까닭이 아니라 견주지 않은 사정이라, 까닭을 먼저 말합니다). 블로그 개수는 뒷받침 사실입니다.
            spoken: spoken
                ? {
                    term: spoken.term, blog: spoken.blog, keyword: best(spoken.key)?.keyword || null, everyPost: ctx.blogTotal > 0 && spoken.blog >= ctx.blogTotal,
                    ...(instead ? { why: `${quoted(term?.term || core)}${p(term?.term || core, '은', '는')} 약·제품을 나누는 분류 이름이라 손님이 찾는 말인 ${quoted(spoken.term)}에 지역을 붙인 쪽을 권합니다.` } : {}),
                }
                : null,
            // 이 키워드의 낱말이 쓸모 관문에 걸린 이유(걸리지 않았으면 null). 화면 표시는 따로 정합니다.
            concern: concernOf.get(core)
                || (regionStatus === 'unknown' && !term && keywordUnrelated(ctx, compact(keyword))
                    ? { rule: 'unrelated', reason: `${quoted(keyword)}${p(keyword, '은', '는')} 이 매장의 업종·이름·메뉴·리뷰·예약·결제 자료에서 찾지 못한 말이라, 지역을 붙인 새 키워드는 만들지 않았습니다. 사장님이 아는 사실이면 등록한 그대로 쓰세요.` }
                    : null)
                || lowRank || duplicate,
            evidence,
            rank: status,
        };
    });

    // 추천이 하나도 없을 때만 그 까닭을 코드로 남깁니다(화면이 "이미 충분합니다"라고 사실과 다르게 말하지 않게):
    //   noRegion 지역을 못 읽음 · allWeak 조회한 지역이 모두 순위가 낮음 · enough 등록한 키워드가 이미 같은 조합을 담고 있음 · noData 권할 만한 낱말을 못 찾음
    // (8차 S-5: 순위 확인용 칩(맛집 등)만 있고 등록할 수 있는 추천이 없을 때도 까닭을 남깁니다)
    let emptyReason = null;
    if (!items.some((item) => item.registrable !== false) && limit > 0) {
        if (regions.length === 0) emptyReason = 'noRegion';
        else if (order.every(isWeak)) emptyReason = 'allWeak';
        // 순위 표에서 30위 밖·목록에 없음·먼 지역으로 확인된 등록 키워드가 있으면 "이미 충분"이 아닙니다(등록 하나가 55위뿐이어도 allWeak: 새 조합은 만들지 않았고 그 키워드부터 살펴볼 점이 있음)
        else if (registered.some((entry) => entry.rank && entry.rank.state === 'weak')) emptyReason = 'allWeak';
        else if (combos.some((item) => item.registered)) emptyReason = 'enough';
        else emptyReason = 'noData';
    }

    return {
        regions,
        // 이미 등록한 키워드는 추천에서 빼고 registered 진단에서 보여 줍니다.
        items,
        // 후보(손님 쪽 근거가 있는 후보가 먼저, 메뉴판·예약·결제 줄에만 있는 후보(lacks voice)는 그 뒤 — 각각 점수 순, 최대 CANDIDATE_MAX): 관문은 통과했지만 메뉴판·예약·결제 품목으로 확인되지 않았거나(lacks menu·data), 가게 쪽만 확인되고 손님 쪽(리뷰·상위 매장)이
        // 확인되지 않았거나(lacks voice), 주력 메뉴들에 견줘 리뷰가 훨씬 적은(lacks share) 낱말. 추천이 아닙니다.
        candidates,
        excluded,
        registered,
        slotsLeft: Math.max(0, KEYWORD_MAX - myKeywords.length),
        rivalCount: others.length,
        // 지역이 든 키워드가 있는지. 지역인지 확인 못 한 키워드(unknown)가 있으면 "모두 지역명이 없다"고 말할 수 없어 있는 것으로 칩니다.
        hasRegionKeyword: registered.some((entry) => entry.regionStatus !== 'none'),
        blogTotal: activity?.mentions?.blogTotal ?? null,
        // 가장 중요한 낱말(업종 대표어·가장 근거가 많은 낱말). 자동 순위 조회가 이 낱말에만 지역 둘을 허용합니다.
        topTerm: top ? top.term : null,
        // 확인 관문을 통과해 추천 자격이 있는 낱말(compact 이름, 업종 대표어·순위 확인용 제외). 자리(limit·칸 수) 때문에 조합이 안 만들어진 낱말도 들어 있습니다(headlineMenuTerms 가 씀).
        confirmedTerms: ordered.filter((term) => term.source !== 'rankOnly' && !term.familyFull).map((term) => compact(term.term)),
        emptyReason,
        // 지역을 어디서 읽었는지: address(주소·가까운 역·지점 이름) · keywords(주소에서 못 읽고 순위 조회·상위 매장의 지역으로만) · none
        regionSource: regions.length === 0 ? 'none' : regions.some((region) => region.scope !== 'custom') ? 'address' : 'keywords',
    };
}

// 근거가 "사장님이 등록한 낱말에 지역을 붙였다"는 것(+블로그 언급)뿐인 추천 조합인지.
// 손님 쪽 근거(리뷰·예약·결제)나 매장 사실이 있거나, 그 조합을 그대로 등록한 상위 매장이 있으면 해당하지 않습니다.
// (상위 매장이 지역 없이 그 낱말만 쓰는 것은 "지역+낱말"로 검색한다는 근거가 아니라서 치지 않습니다.)
function ownerWordOnly(item) {
    return (item.source === 'registered' && !(item.rivalCount > 0)
        && !list(item.reasons).some((reason) => ['review', 'booking', 'pos', 'fact'].includes(reason.kind)))
        // (unverified 는 항상 false 이지만 이름을 남겨 두었으므로, 값이 true 인 옛 모양이 오면 확인된 말보다 뒤로 미룹니다.)
        || item.unverified === true;
}

// 등록 키워드 진단 한 줄(registered[])의 지역 상태: known · unknown · none (regionStatus 가 없는 옛 모양은 hasRegion 으로 짐작)
export function regionStatusOf(entry) {
    return entry?.regionStatus ?? (entry?.hasRegion ? 'known' : 'none');
}

// 가게를 한마디로 설명하는 자리(한 줄 소개·질문·제목)에 써도 되는 대표 메뉴 낱말. 많이 언급된 순(리뷰 메뉴 → 주간 인기 메뉴 → 예약 스타일)으로,
// 키워드 추천이 확인한 낱말(confirmedTerms: 가게 쪽·손님 쪽 두 쪽 확인을 통과한 말)만 돌려줍니다 — 후보(확인 못 한 말)·뺀 낱말(다른 업종의 낱말·주력 갈래 밖 곁들임·조건·술·
// 뜻이 넓은 말·상호 …, 하나로 묶인 짧은 이름 포함)·오타는 나가지 않고, 하나도 없으면 []입니다.
// 견본 음식점이면 ['광어', '숙성회'](김밥·갈치·볼락구이는 뺌). 소식 본문처럼 메뉴를 사실로 적는 자리는 이 함수가 아니라 원래 메뉴 목록을 그대로 쓰세요.
//   rawPlace·activity: recommendKeywords 와 같은 인자 / limit: 최대 개수(기본 2). 돌려주는 값: 낱말 배열(다듬은 이름, 띄어쓰기 없음)
export function headlineMenuTerms(rawPlace, activity = null, { limit = 2 } = {}) {
    if (!rawPlace) return [];
    const place = sanePlace(rawPlace);
    ACTIVE_MODIFIERS = repeatedModifiers(place);
    const confirmed = new Set(recommendKeywords({ place: rawPlace, activity, limit: 0 }).confirmedTerms);
    // 추천이 후보로 따져 본 범위(리뷰 메뉴 상위 8개·주간 인기 메뉴 3개·예약 스타일 5개)만 봅니다. 그 밖의 낱말은 관문을 거치지 않았기 때문입니다.
    const ordered = [
        ...groupedCounts(list(place.reviewMenus), (menu) => menu.label).slice(0, 8).map((entry) => entry.name),
        ...list(place.detail?.pos?.popularMenus).slice(0, 3).map((menu) => usableName(popularMenuTerm(menu?.name, place))),
        ...groupedCounts(list(place.detail?.styles), (style) => style.name).slice(0, 5).map((entry) => entry.name),
    ].filter(Boolean);
    return uniqueBy(ordered, compact).filter((name) => confirmed.has(compact(name))).slice(0, Math.max(0, limit));
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
    // 지역이 없다고 확실한 키워드(none)만 조회에서 뺍니다. 앞말이 지역인지 확인 못 한 키워드(unknown)는 지역이 없다고 단정할 수 없어 순위를 조회해 봅니다.
    // 다만 이 매장 자료 어디에도 없는 낱말(경쟁 가게 상호, concern unrelated)이고 지역도 확인되지 않은 키워드는 순위를 조회해도 내 매장의 순위가 아니라 뺍니다.
    const notMine = (entry) => entry.concern?.rule === 'unrelated' && regionStatusOf(entry) === 'unknown';
    const keywords = registered.filter((entry) => regionStatusOf(entry) !== 'none' && !notMine(entry)).map((entry) => entry.keyword).slice(0, max);
    const skipped = registered.filter((entry) => regionStatusOf(entry) === 'none' || notMine(entry)).map((entry) => entry.keyword);
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
                const cap = pass === 2 || item.term === (recommendation?.topTerm ?? items[0].term) ? 2 : 1;
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
