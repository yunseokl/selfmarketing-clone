# 혼잘마 — 혼자서도 잘하는 마케팅

대행사 없이 소상공인·셀러가 직접 쓰는 셀프 마케팅 플랫폼입니다.
Next.js 14(App Router), NextAuth, Prisma, PostgreSQL 기반.

## 타겟 사용자

- **오프라인 매장 사장님** (식당·카페·뷰티·병원): 네이버 플레이스 상위노출이 매출과 직결
- **스마트스토어·쿠팡 셀러**: 쇼핑 검색 순위와 키워드 선정이 생명줄
- 공통: 대행사 비용 없이 혼자 마케팅하는 1인 사업자

## 서비스 맵

| 분류 | 기능 | 경로 |
|------|------|------|
| 광고 관리 | 플레이스 트래픽 광고 | `/dashboard/place` |
| | 쇼핑 트래픽 광고 | `/dashboard/shopping` |
| | 쿠팡 (견적 문의) | `/dashboard/coupang` |
| 수익 계산 (무료) | 마진·ROAS 계산기 (스마트스토어·쿠팡 판매자배송·로켓그로스, 손익분기 ROAS, 판매가 역산, 상품별 저장) | `/dashboard/margin` |
| 분석 도구 (무료) | 키워드 트렌드 (네이버 데이터랩 검색 추이·성수기·키워드 비교) | `/dashboard/keyword` |
| | 쇼핑/플레이스 순위 기록장 (플레이스는 실제 조회, 쇼핑은 직접 기록·추이 그래프) | `/dashboard/ranking/*` |
| | 플레이스 분석 (숨은 대표키워드·실제 순위·상위 매장 비교) | `/dashboard/place-insight` |
| | 쇼핑 SEO 진단 (상품명 점수) | `/dashboard/seo` |
| 매장 운영 (무료) | 플레이스 진단 (정보 충실도 점검·대표키워드 점검·순위 하락 점검) | `/dashboard/place-check` |
| | 리뷰 답글 도우미 (답글 초안·정책 점검) | `/dashboard/review-reply` |
| 광고 대행 | 매체별 광고비 10% 환급 | `/dashboard/refund` |
| 블로그 | 플레이스 블로그 배포 | `/dashboard/blog` |
| 콘텐츠 | 마케팅 문구·홍보 배너 생성 (문장 틀 조합, 외부 AI 미사용) | `/dashboard/ai` |
| 캐시 | 충전(무통장입금)·이용 내역 | `/dashboard/charge` |
| 지원 | 공지사항 / 고객센터(FAQ·1:1문의) | `/dashboard/notice`, `/dashboard/support` |
| 법적 고지 | 이용약관 / 개인정보처리방침 | `/terms`, `/privacy` |
| 관리자 | 주문·회원·충전 승인·문의 답변·공지·블로그·환급 관리 | `/admin/*` |

## 필수 환경변수

`.env.example` 기준으로 `.env` 또는 Railway Variables에 설정합니다.

- `DATABASE_URL`: PostgreSQL 연결 주소
- `NEXTAUTH_SECRET`: 세션 암호화용 긴 랜덤 문자열
- `NEXTAUTH_URL`: 배포 주소 또는 로컬 주소
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: 관리자 계정 생성 스크립트용
- `CRON_SECRET`: 순위 스냅샷 배치 엔드포인트(`/api/cron/rank-snapshot`) 인증 키.
  미설정 시 해당 엔드포인트는 503으로 비활성화됩니다
- `DEPOSIT_BANK`, `DEPOSIT_ACCOUNT`, `DEPOSIT_HOLDER`: 무통장입금 계좌(은행·계좌번호·예금주).
  세 값을 모두 넣어야 적용되며, 없으면 코드의 기본 값이 표시되고 관리자 대시보드에 확인 경고가 뜹니다
- (선택) `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY`: NAVER API HUB의 검색어 트렌드 키.
  등록하면 키워드 트렌드 화면에 추이 그래프가 나오고, 없으면 그래프 대신 입력한 키워드로 여는 외부 도구 바로가기(네이버 데이터랩·구글 트렌드·네이버 검색)를 보여 줍니다.
  기존 개발자센터 키(`NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, 데이터랩 사용 설정)도 2027-06-30까지 쓸 수 있습니다

### 데이터 출처에 대한 원칙

- 조회가 안 될 때 숫자를 만들어 보여 주던 '추정' 로직(검색량·상품수·순위·유입 그래프)은 제거했습니다. 실제로 확인한 값만 보여 줍니다.
- 쇼핑 순위: 네이버 쇼핑 검색 API가 2026-07-31 종료되어 자동 조회하지 않고 회원이 직접 기록합니다(순위 기록장).
- 플레이스 순위·숨은 대표키워드: 네이버 플레이스 모바일 화면이 불러오는 공개 데이터를 읽습니다(플레이스 분석, 아래 '플레이스 분석' 참고).
  네이버 공식 API가 아니므로 약관·차단 위험은 운영자가 판단해야 하며, `PLACE_LOOKUP=off` 로 바로 끌 수 있습니다.
- 키워드는 데이터랩의 상대 추이만 보여 줍니다.
- 검색광고 API의 월간 검색수는 광고 관리 용도로만 쓸 수 있어 회원에게 재제공하지 않습니다.
- 수수료율(스마트스토어·쿠팡)의 기준일과 출처는 `lib/margin.js` 상단에 적혀 있습니다. 요율이 바뀌면 그 파일만 고치면 됩니다.

## 로컬 실행

```bash
npm ci
npm run db:push        # 스키마 반영
npm run admin:create   # 관리자 계정 생성
node scripts/seed-content.js  # 공지사항 시드 (선택)
npm run dev
```

## 로컬 확인 명령

```bash
npm test         # 금액 계산·수수료·순위 기록 등 자동 테스트 (Node 내장 러너, 추가 설치 없음)
npm run lint
npm run build
```

## Railway 배포

- 프로젝트: `selfmarketing-clone` (Postgres + 앱 서비스). GitHub `master` 푸시 시 자동 배포됩니다.
- 도메인: https://selfmarketing-clone-production.up.railway.app
- `start` 스크립트가 `prisma db push`를 포함해 부팅 시 스키마가 자동 반영됩니다.
- 로컬에서 연결하려면: `railway link` → `railway status`

## 플레이스 분석 (실제 조회)

`/dashboard/place-insight` — 플레이스 주소/ID를 넣으면 숨은 대표키워드, 리뷰 집계, 정보 부족 항목을 보여 주고
키워드별 실제 순위(광고 제외, 최대 1,000위)와 상위 10곳 비교, 상위 매장 대표키워드를 조회합니다.
순위 기록장(플레이스)의 '지금 조회'도 같은 조회를 써서 오늘 순위를 `src: 'live'` 로 기록합니다.

- 조회 방식: `lib/naver-place.js`. 로그인·쿠키 없이 읽기만 하고, 방문·클릭·저장을 만들지 않습니다.
  리뷰 원문·작성자·전화번호는 돌려주지 않습니다.
- 순위 기준: 정렬·업종을 지정하지 않은 기본 목록 순서. 2026-11-15에 실제 화면(m.place.naver.com 목록)과
  음식점·미용실·필라테스 검색어로 대조해 일치를 확인했습니다. 지역명이 없는 키워드는 위치에 따라 달라 정확하지 않습니다.
- 요청을 아끼는 장치: `lib/place-gate.js`. 서버 전체에서 한 번에 1건·1초 간격, 같은 조회는 10분~6시간 저장,
  네이버가 거절(403/418/429)하면 우회하지 않고 10분(연속 시 최대 2시간) 조회 중단, 하루 요청 상한.
  회원별로도 10분당 횟수 제한이 있습니다(`lib/place-service.js`).
- 네이버는 브라우저 형식이 아닌 요청을 429로 거절하므로 모바일 브라우저 형식의 요청 헤더 한 가지를 보냅니다.
  IP·기기 정보를 바꿔 가며 차단을 피하는 장치는 없습니다.
- 환경변수: `PLACE_LOOKUP=off`(기능 끄기), `PLACE_LOOKUP_DAILY_MAX`(하루 요청 상한, 기본 3000).
- 관리자 대시보드에 오늘 요청 수와 조회 중단 상태가 표시됩니다.
- 조회 상태(간격·저장 결과·중단)는 서버 메모리에 있으므로 서버가 한 대일 때만 정확합니다.

## 순위 스냅샷 cron

GitHub Actions(`.github/workflows/rank-snapshot.yml`)가 매일 06:00 KST에
`GET /api/cron/rank-snapshot`을 호출하지만, 이 엔드포인트는 인증만 확인하고 아무 것도 하지 않습니다(`skipped: true`).
플레이스 순위는 회원이 '지금 조회'를 누를 때만 조회하며, 전 회원 순위를 매일 일괄 조회하지는 않습니다. 워크플로는 그대로 두어도 무해합니다.
