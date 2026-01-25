# gemini.md (Project Governance & AI Behavior Rules) 🤖

이 파일은 **'혼잘마(Honjalma)' 프로젝트**에서 Gemini(AI Agent)가 반드시 준수해야 할 **절대적인 행동 강령**입니다. 
사용자의 개입 없이도 프로젝트의 품질, 안정성, 보안을 최상으로 유지하기 위해 스스로 이 규칙을 엄격히 따르십시오.

---

## 🛑 Core Mantras (핵심 원칙)

1.  **Do No Harm (기존 기능 보존)**
    *   새로운 기능을 추가할 때, **기존에 잘 작동하던 기능이 깨지지 않는지(Regression)** 반드시 확인해야 한다.
    *   수정 범위는 최소한으로 유지하며, 불필요한 리팩토링으로 인한 사이드 이펙트를 경계한다.
    *   **Regression Testing**: 수정 후에는 연관된 페이지나 기능(예: 로그인, 결제, 데이터 조회)이 여전히 정상 작동하는지 머릿속 시뮬레이션 및 QA 체크리스트로 검증한다.

2.  **Fact-Based Coding (사실 기반 구현)**
    *   **No Hallucinations**: 존재하지 않는 라이브러리 함수나 API를 추측으로 사용하지 않는다.
    *   **Docs First**: 모르는 기능은 `search_web`으로 공식 문서를 확인하거나, `view_file`로 기존 코드의 패턴을 분석한 후 구현한다.
    *   **Version Check**: `package.json`의 의존성 버전을 확인하고, 해당 버전과 호환되는 코드를 작성한다.

3.  **Strict Git Workflow (철저한 형상 관리)**
    *   **Atomic Commits**: 하나의 논리적 작업(기능 추가, 버그 수정 UI 변경)이 완료될 때마다 **즉시** 커밋한다.
    *   **Clear Messages**: `feat:`, `fix:`, `style:`, `refactor:` 등의 접두어를 사용하여 커밋 메시지를 명확히 작성한다.
    *   에러가 발생하여 수정을 시도할 때도, 시도 전 상태를 보존하거나 수정 후 즉시 커밋하여 되돌릴 수 있는 지점을 만든다.

---

## 🏗 Technical Guidelines (기술적 지침)

### 1. Dependency Management (의존성 관리)
*   **Version Pinning**: `package.json`에서 버전 앞에 `^`나 `~`를 사용할 때 신중해야 한다. 가능한 한 검증된 버전을 명시적으로 사용한다.
*   **Minimum Dependencies**: 불필요하게 무거운 라이브러리 추가를 지양한다. 이미 설치된 라이브러리(`locide-react`, `framer-motion` 등)로 구현 가능한지 먼저 검토한다.
*   **Conflict Check**: 새로운 패키지 설치 시 `npm install` 로그를 확인하여 `peer dependency` 충돌이 없는지 확인한다.

### 2. Database Integrity (데이터베이스 무결성)
*   **Schema Safety**: `schema.prisma` 변경 시 기존 데이터 손실 가능성을 경고해야 한다.
*   **Migration**: `prisma db push`나 `migrate` 실행 전, 데이터 백업 필요성을 판단한다. 특히 운영 환경(Railway) 배포 시에는 데이터 유실에 각별히 유의한다.
*   **Query Optimization**: N+1 문제가 발생하지 않도록 `include`나 `select`를 적절히 사용하며, 무거운 쿼리는 인덱싱을 고려한다.

### 3. QA & QC Protocols (품질 보증)
구현 완료를 선언하기 전, 스스로 다음 항목을 검증한다.

**✅ QC (Quality Control - 기술적 검증)**
*   `npm run build`가 성공하는가?
*   콘솔 창에 붉은색 에러(Runtime Error)가 없는가?
*   PC/Mobile 해상도에서 레이아웃 깨짐(Overflow)이 없는가?

**✅ QA (Quality Assurance - 사용자 관점)**
*   **Happy Path**: 주요 기능(광고 생성, 결제, 조회)이 정상 작동하는가?
*   **Edge Case**: 입력값이 없거나(Null), 네트워크가 끊겼을 때 앱이 멈추지 않고 적절한 피드백을 주는가?
*   **UX**: 로딩 인디케이터, 토스트 메시지 등 사용자 피드백이 제공되는가?

---

## 🤝 Vibe Coding Collaboration

비개발자 사용자와 협업 시 다음 태도를 유지한다.

1.  **Translate Tech to Value**: "API를 수정했습니다" 대신 "로딩 속도를 2배 개선했습니다"와 같이 가치 중심으로 보고한다.
2.  **Proactive Problem Solving**: 사용자가 "이거 안돼"라고만 해도, 로그를 분석하여 원인을 찾고 해결책을 제시한다. (질문만 하지 말고, 해결책을 가져가라)
3.  **Visual Verification**: UI 변경 시에는 텍스트 설명뿐만 아니라 "어떤 부분이 어떻게 바뀌었는지" 구체적으로 묘사한다.

---

**이 파일은 프로젝트의 법(Law)이다. 매 Task 시작 시 이 내용을 상기하라.**
