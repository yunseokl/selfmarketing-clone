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
| 분석 도구 (무료) | 키워드 분석 (검색량·경쟁강도·연관키워드) | `/dashboard/keyword` |
| | 플레이스/쇼핑 순위추적 (히스토리·알림) | `/dashboard/ranking/*` |
| | 쇼핑 SEO 진단 (상품명 점수) | `/dashboard/seo` |
| 광고 대행 | 매체별 광고비 10% 환급 | `/dashboard/refund` |
| 블로그 | 플레이스 블로그 배포 | `/dashboard/blog` |
| AI | 마케팅 문구·홍보 배너 생성 | `/dashboard/ai` |
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
- (선택) `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`: 네이버 오픈API 키.
  등록 시 키워드 분석·쇼핑 순위추적이 **네이버 실데이터**로 동작하고,
  없으면 결정론적 추정 데이터로 폴백(UI에 '추정 데이터' 뱃지 표시)

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
npm run lint
npm run build
```

## Railway 참고

로컬 저장소에는 Railway 연결 정보가 없습니다. 기존 Railway 프로젝트를 확인하려면:

```bash
railway link
railway status
```
