# 웹쫀쿠 개발 계획서

## 개발 페이즈 SSOT — 구현 순서·상태의 단일 기준

2026-11-01 API 일일 한도·일반 GPT/dot 선택 UI 개발 승인: 사용자가 [변경 검토서](./reviews/api-daily-budget-impact-20261031.md)의 범위를 승인했다. R8 보완으로 API key 참여자만 작업실 합산 KST 일일24회/보고20만 token 한도를 적용하고, owner가 선택한 새 상주 모드의 GPT OAuth/browser는 방의 채팅 횟수/token/종료 시각 제한에서 제외한다. API 대기 중 GPT 진행·혼합 주제 partial/같은 방 복귀와 기존 단일 dispatch·미확정 대조·도구 승인/실행 deadline·이력/50 gate를 공존시킨다. 일반 GPT/dot은 기존 연결/탐지/참여자 API를 재사용해 명시 선택하며 현재 일반 GPT를 dot으로 간주하지 않는다. 예상26~36파일·1,400~2,400줄, R1~R8 이관/수락/복귀는 검토서를 따른다. 기준 main은 PR #30 병합 `1b6c005e0b1b02162c3f294535219cd2757adeb9`. 기존 운영 방·데이터는 보존하며 배포/실제 호출은 별도다. [구현·검사 기록과 미검증 범위](./implementation/api-daily-gpt-choice-20261101.md)를 별도로 남긴다.

2026-10-31 상주방 설정 승인·표준 선택: 기존 DeepSeek 토커를 High로 변경하고 resident flag 활성화·기존 additive 이관·GPT2+Coral3명/방 내부 analysis 역할·초기 표준24요청/보고20만 token/60분/30초 간격을 저장했다. [설정·실제 UI·보존 기록](./implementation/phase8-resident-setup-20261031.md): 방 off·모델 호출0·기존12요청 partial/과거 Max 기록·다른 설정 보존. 초기 종료 시각은20:07:03 KST이며 자동 갱신/자동 주제 시작·Codex 권한은 추가하지 않았다. U1/U2의 이번 방 설정을 선택한 것이고 미래 기본값/장기 운영 정책은 미정으로 유지한다. 실계정 상주 흐름·R8-D 전체 수락은 미완료다.

2026-10-31 PR #29 병합 후 R8 재검증: main `2f3ca34e454f07c294c7e6eaa87cf052b7c79475`에서 사용자가 서버 적용·테스트를 별도 승인했다. 병합 버전을 빌드/서비스 재시작하고 기존 토의의 DeepSeek만 Max/출력16,384로 설정해 **추가6요청 모두 완료, 총12요청에서 PARTIAL**이다. 상호 검토2라운드·검증2개까지 진행했으나 기존100,000 보고 token soft limit이 소진됐다. 보고 합계123,013·마지막1요청의23,013 초과를 숨기지 않으며 과거 실패 usage는 UNKNOWN이다. 이후 호출0·예산/원문/기존6turn·다른 계정/방/실행 보존을 [실제 재검증 기록](./implementation/phase8-continuation-20261031.md)에 남겼다. 수정/종합·실제 dot/Muse/상주 업무·Wiki/Codex/실기기와 R8-D 전체는 미완료다. src/기존 계약·50 gate를 바꾸거나 새 페이즈를 만들지 않았다.

2026-10-31 출력 한도 추가 승인: 사용자가 [DeepSeek 토커별 출력 한도 변경안](./reviews/deepseek-output-limit-impact-20261031.md)을 승인했다. R8 보완으로 기본4,096을 유지하고 512~32,768 범위의 명시 설정·실제 catalog 한도 검증·새 turn snapshot·등록/사후/일시정지 UI를 구현했다. [실행 기록](./implementation/deepseek-output-limits-20261031.md): Node326·Chrome/MCP52 PASS, FAIL/SKIP0. 기존 turn/업무 입력·Provider complete/Store·예산/승인/단일 dispatch·50 gate는 유지한다. ResidentTurn은 기존 participant snapshot을 재사용하고 별도 중복 필드/SQL 이관을 만들지 않는다. 승인 예상12~17파일·350~600줄 중 실제17파일이며 후속 R1~R8 영향·복귀는 승인 검토서를 따른다. 기존6요청/blocked 토의·운영 설정을 바꾸지 않았으며 배포·유료 재검증은 별도다.

2026-10-31 실제 호출 추가 승인: 사용자가 GPT2+CoralBricks 새 토의1개·최대24회/20분과 기존 중단 토의의 원문 보존 종료를 허용했다. [실제 수락 기록](./implementation/phase8-real-api-20261031.md)은 **6요청에서 부분 성공 후 FAIL**이다. 3초안·GPT2개 첫 상호 검토/실제 HTTPS·기록 보존/동시1은 확인했으나 DeepSeek Max 재검토가 정상 완료되지 않아 정지했다. 정확한 원격 finish_reason과 실패 usage는 과거 adapter가 보존하지 않아 UNVERIFIED이며 자동 재전송하지 않았다. 종료/보고 usage 진단 보강 때에는 원래 출력 한도·사고·예산·수락 기준을 유지했다. 당시 제안이던 [출력 한도 설정 변경안](./reviews/deepseek-output-limit-impact-20261031.md)은 위 추가 승인으로 구현 범위에 들어왔다. 실제 dot/Muse·상주 업무/Wiki·Codex/실기기 포함 R8-D 전체는 NOT_RUN으로 남긴다.

2026-10-31 실제 호출 전 준비 관측: PR #27 병합 후 R8의 [준비·격리 점검과 doctor 보완](./implementation/phase8-live-preflight-20261031.md)에서 Ubuntu bwrap mount/PID/proc 가림 PASS, 운영 health/도구 확인과 당시 미등록 토커·상주 off·중단 root·Codex 미등록을 구분했다. 이 준비 점검 시점에는 실제 모델 호출도 미실행이었으며 후속 승인/실측은 위 기록을 따른다. Codex thread 실행·쓰기 및 원래 전체 실계정 gate는 별도 미검증이며 새 페이즈를 신설하거나 50개 기준을 바꾸지 않는다.

2026-10-30 사용자 지시에 따라 **이 표를 페이즈 범위·순서·진행 상태의 SSOT**로 사용한다. 아래 설계/검토 문서의 과거 “계획 문서만” 제한은 당시 작업 이력이며, 현재 승인 작업은 **페이즈 8 통합 수락·복구·부하 검증**이다. PR #22의 병합 main `8f7866388823e46ade64446343d53351c7ef85e5`에서 기존 R1~R7 구현·흑백 GUI·상단 주제·큐·Wiki·Codex·MCP를 그대로 결합해 검증한다. 2026-10-31 사용자 승인으로 [R8-A B안](./reviews/r8-topic-transition-decision-20261031.md)의 명시 허용 자동 주제 전환을 추가한다. optional 설정/intent·기존 configure 접점만 확장하며 Providers/Store·topic·승인/격리·기존 50 gate·단계 순서는 유지한다. R2/R3·업무 경쟁·Wiki 인용을 회귀하고 추가 페이즈는 만들지 않는다. 예상 변경은 16~20파일·450~850줄이다. 추가로 사용자가 [Codex 기기 코드 연결](./reviews/opencodex-login-review-20261031.md)을 별도 추가하도록 승인했다. 일반 GPT OAuth·기존 계정/전역 Codex 인증을 보존하고, 새 kind의 로그인/refresh·모델/stream 어댑터·owner UI만 결합한다. 예상 14~20파일·800~1,500줄이며 기존 큐/Wiki/단일 dispatch·수락 기준은 유지한다. R8 준비에 포함하며 후속 페이즈 신설은 없다. 제품 목표·기존 데이터·승인/미확정 대조는 유지한다. 세부 수락 gate·롤백은 [단계별 계약](./resident-implementation-plan.md)을 참조한다. 계획 변경이 필요하면 **현재 단계와 남은 모든 페이즈의 영향·총변경량을 먼저 검토해 사용자 승인을 받은 뒤** 이 SSOT와 관련 계획서를 함께 변경한다. 구현 결과에 맞춰 계획을 사후 정당화하지 않는다. 구체적인 변경 승인 절차는 [개발 지침](./development-guidelines.md#5-계획-변경-사전-승인과-후속-페이즈-영향-검토)을 따른다.

2026-10-31 추가 승인: 사용자가 **DeepSeek 설정·Anthropic API부터 구현**하는 [변경안](./reviews/deepseek-anthropic-impact-20261031.md)을 승인했다. R8 연결 보완으로 제공처별 실제 지원 사고 값과 Anthropic API key/모델/완료 stream 어댑터를 기존 Providers·vault·Store·토론/방에 결합한다. GPT의 기존 설정과 DeepSeek 설정 부재를 보존하며 자동 effort 변환·계정/과금 fallback은 추가하지 않는다. Anthropic 구독 OAuth는 공식 지원 경로/앱 허가 확인까지 **보류**한다. 예상 20~28파일·700~1,300줄이며 R1~R8·50개 수락 기준·큐/Wiki/Codex 승인·단일 dispatch는 유지하고 회귀한다. [구현·검사 기록](./implementation/deepseek-reasoning-anthropic-20261031.md): Node306·Chrome/MCP51 PASS, 실제 CoralBricks/River catalog만 읽기 관측. 실계정 추론·운영 배포는 NOT_RUN이며 R8 전체 수락을 완료로 바꾸지 않는다. 실계정 유료 호출·배포·병합은 이번 승인에 포함하지 않는다.

| 페이즈 | R단계 | 개발 범위 | 완료 판정 | 상태 |
| --- | --- | --- | --- | --- |
| 1. 방 데이터 기반 | R1 | optional resident state·기존 DB 이관·방/메시지 조회·설정 제어 API·기능 flag | 기존 데이터/원문/event cursor/명령 보존, 중복 이관/명령 방지·인증·꺼짐 복구 | **완료 / PR #13 병합** ([증거](./implementation/phase1-resident-foundation-20261030.md)) |
| 2. 상주 실행 | R2 | 공통 dispatch·방 on/off·발화/JSON·예산/휴면·topic focus·문맥 인계 | provider 최대1·미확정 재전송0·초안 공개/세대 대조·인계/복구 | **완료 / PR #14 병합** ([증거](./implementation/phase2-resident-runtime-20261030.md)) |
| 3. 단톡방 GUI | R3 | 기존 control.*의 멤버·말풍선·답장/멘션·미읽음·보조 패널·상태 알림 | 4 viewport·IME/접근성·장문·재접속·기존 승인/복구 UI 보존 | **PR #15·#17·#18·#19 병합 · 실기기 UNVERIFIED** ([R3 증거](./implementation/phase3-chatroom-gui-20261030.md)·[디자인](./implementation/chatroom-design-refinement-20261030.md)·[주제/결과](./implementation/pinned-topic-conclusions-20261030.md)) |
| 4. 연결 편의성 | R4 | browser discovery/preset→기존 probe·advanced fallback | 사용자 CSS 입력 최소화·identity/thread/draft 불일치 전송0 | **PR #16 병합 · R4-D 실계정 왕복 UNVERIFIED** ([증거](./implementation/phase4-browser-discovery-20261030.md)) |
| 5. 역할·열린 작업큐 | R5 | 일감 제안·완료 조건/의존성·역할/가용 자원·pickup·보고/리뷰/재작업 | 동시 claim1·불완전/권한 밖 ready0·자기 승인/근거 없는 done0 | **PR #20 병합 · 실계정 UNVERIFIED** ([R5 증거](./implementation/phase5-open-work-queue-20261030.md)) |
| 6. 실제 업무 수행 | R6 | 기존 Codex·scope 재검사·실행 근거/방 보고·독립 리뷰 | 중복 실행0·늦은 승인/결과 대조·실파일 안전 gate·업무 리뷰 | **PR #21 병합 · R6-F 실세션 UNVERIFIED** ([R6 증거](./implementation/phase6-work-execution-20261030.md)) |
| 7. 공유 Wiki | R7 | private DB Wiki/version/CAS·자동 reported 게시·인용·scoped MCP | 충돌 보존·원문/출처/인용 고정·타 scope/세대 거절 | **PR #22 병합 · 실운영 UNVERIFIED** ([R7 증거](./implementation/phase7-shared-wiki-20261031.md)) |
| 8. 통합 실운영 검증 | R8 | 방→업무→리뷰/보고→Wiki→다음 대화→topic 복귀·기기/부하/rollback | 기존/신규 50 gate의 fixture/실계정 증거와 UNVERIFIED 분리 | **자동 통합/복구/부하 fixture PASS · R8-A B안 모의 무인 흐름 PASS · 실제 API 재검증 PARTIAL(12요청/예산 소진)·나머지 실계정 NOT_RUN · 전체 수락 미완료** ([R8 증거](./implementation/resident-acceptance.md)·[재검증](./implementation/phase8-continuation-20261031.md)) |

페이즈마다 작업 브랜치·검토 가능한 PR, 사용자 병합을 유지한다. 큰 단계는 2를 dispatch/발화/인계, 6을 안전 경계/실행 연결, 7을 Wiki/인용·MCP로 나눌 수 있다. 다음 단계가 아직 없으면 성공처럼 응답하지 않는다. 실계정·서비스 반영은 별도 검증 범위로 두고 독립 fixture 개발을 계속한다. U1/U2/U3는 [사용자 결정 목록](./resident-implementation-plan.md#11-사용자-결정-필요)을 유지한다. 디자인 패턴은 [개발 지침](./development-guidelines.md)의 작은 Adapter/DI·명시 상태 전이·기존 transaction·검사/롤백 기준을 따른다.

본문의 Phase 0~4A/4B는 이전 릴리스 범위 구분이다. 현재 구현 순서·상태는 위 페이즈 1~8로만 관리한다. 페이즈 8의 [50개 수락표](./implementation/resident-acceptance-manifest.json)는 fixture PASS46·UNVERIFIED3·NOT_RUN1로 구분한다. 최종 통합 Node270 PASS·Chrome/MCP46 PASS이며 전체 Chrome/MCP 회귀 결과는 [R8 실행 기록](./implementation/resident-acceptance.md)을 따른다. 자동 업무·Wiki 인용·주제 시작·같은 방 복귀는 방 on 이후 사용자 중계 없이 모의 참여자3명으로 검증했다. [B안 승인](./reviews/r8-topic-transition-decision-20261031.md)에 따른 optional 허용·intent와 기존 엔진을 사용했으며 owner focus 요청0·topic1·복귀1이다. 실제 계정/기기 수락은 별개다. 기존 Codex 0.165.0 계약과 쓰기 차단은 유지한다. 최초 R8 fixture 시점의 운영 DB 이관·서비스 반영·실계정 호출은 NOT_RUN이었다. 이후 별도 승인된 서비스 반영·API 부분 실측은 위 최신 기록을 따른다. Wiki의 자동 최신/고정 선택·과대 입력 차단과 명시 예산/속도·역할/범위를 유지하며 미정 U1/U2 기본값을 만들지 않는다. R6-F 실세션·쓰기, R3-E 실기기 IME/터치, R4-D 실제 dot/Muse 왕복과 R8-D 혼합 실계정 수락은 미확인이다. 자동 검사 PASS로 이 조건을 낮추거나 완료로 바꾸지 않는다.

> 계획 개정의 고정 근거는 C=8f81d861b3f170ef2024b90d9eeba56ce34f0f79, P=8db0f42f499f674c66c3a0df0a4d8e0f25fb216e다. [1쪽 요약·기준 차이·근거](./plan-revision-20261030.md), [104항목 판정](./reviews/plan-decision-register-20261030.md), [운영 계약](./company-workflow-plan.md), [8단계 변경·이관·수락·롤백](./resident-implementation-plan.md)은 설계 근거로 유지한다. 구현은 병합 main 05684f83d229acc86769ce8675f632bb21743dd6에서 시작했으며 runtime은 C와 동일했다. 신규 기능의 실제 상태는 위 SSOT와 단계별 실행 증거로 판정하고, 실계정·DOM·호스트 적합성은 별도 검증 전까지 UNVERIFIED다.

| 항목 | 값 |
| --- | --- |
| 상태 | v0.18-R8-connections — 승인된 자동 주제·기기 코드/추가 DeepSeek 연결·통합/복구/부하 검사·50개 수락 증거, 실제 기기·실계정·R6-F·최종 실운영 수락 UNVERIFIED. 진행 상태는 맨 위 SSOT 참조 |
| 최초 작성일 | 2026-08-15 |
| 개정일 | 2026-10-31 (KST) |
| 저장소 | [firewine/webgpt](https://github.com/firewine/webgpt) |
| 전체 제품 설계 | [webjjoku_living_design.md](./webjjoku_living_design.md) |
| 구현 작업·선행 조건 | [implementation-sequence.md](./implementation-sequence.md) |
| 핵심 대화 흐름 | [discussion-plan.md](./discussion-plan.md) |
| 참여자·OAuth·API | [participant-connections.md](./participant-connections.md) |
| Ubuntu·웹 접속 운영 | [ubuntu-operations.md](./ubuntu-operations.md) |
| Codex 세션 실행 | [codex-session-plan.md](./codex-session-plan.md) |
| Git Writer 요구사항 / 상세 계획 | [prd.md](./prd.md) / [git-writer-plan.md](./git-writer-plan.md) |
| 접속 기준 | Tailscale이 설치·연결되고 접근이 허용된 기기의 웹 브라우저; 태블릿은 예시 |
| 개발 순서 | R1 additive 데이터 → R2 공통 dispatch/상주·topic → R3 기존 control 개조 → R4 연결 UX → R5 큐 → R6 기존 실행/보고 → R7 Wiki/MCP → R8 수락 |

## 1. 제품과 문서의 범위

웹쫀쿠의 목표는 **단톡방에 참여자들이 상주하며 자유롭게 논의하고, 일감을 큐에 넣어 가능한 작업자가 수행·보고하고, Wiki를 스스로 갱신해 공유 기억으로 쓰는 작업실**이다. 주제 토론은 이 방 안의 한 focus mode다. 사용자는 방을 켜고 관전하거나 중간에 참여한다. GPT OAuth·DeepSeek API·dot/Muse browser, 기존 Store·기록·승인·Codex는 그대로 재사용한다. 현재 구현된 토론 파이프라인을 전체 시스템으로 확대 해석하지 않는다.

| 영역 | 책임 |
| --- | --- |
| Core / Discussion Scheduler | 주제·참여자·발언·상호 검토·검증·비교·결론, 진행 예산과 영속 복구 |
| Control Room | 공동 대화 타임라인, 참여자별 결과 비교, 사용자 개입·연결 상태 |
| Participant Adapter | GPT OAuth Responses, DeepSeek 등 API, dot·Muse browser와 검증된 공식 연결 |
| Ubuntu / Web Client | 서버 상시 실행, Tailscale HTTPS, 실시간 상태·대화, 원격 Chrome 보조 화면 |
| Codex 실행 어댑터 | 허용된 검증·개발 지시를 기존 세션에 전달하고 결과를 원래 토론에 환류 |
| Git Writer | 별도 선택 모듈: 격리된 코드 변경·검사·draft PR 발행 |

일반 GPT는 **OAuth 로그인·ChatGPT plan usage를 통한 웹쫀쿠 내 대화**를 우선 경로로 한다. 로그인만으로 기존 ChatGPT 대화·메모리나 dot이 이전되지 않는다. dot·Muse는 실제 기존 agent와 대화에 연결한다. API 참여자도 1차 제품 범위에 포함하며 이전의 모델 API 비사용 원칙을 이 혼합 구조로 대체한다.

Ubuntu는 서버 실행 OS다. 접속 기기는 데스크톱·노트북·휴대전화·태블릿을 포함하며 Tailscale과 웹 브라우저로 같은 기능을 사용한다. 사용자가 여러 기기로 접속해도 서버의 같은 Discussion을 이어서 본다. 클라이언트에 Codex·개발 도구를 설치하도록 요구하지 않는다.

문서 역할:

- Living Design: 역할/계정/맥락·작업/지식 원칙. 최소 큐·Wiki는 상주 운영의 필수 층이며 거대 조직 모델을 먼저 재작성하지 않는다.
- 이 문서: 현재 릴리스 범위, 순서, 완료 조건, 진행 상태.
- 개발 실행 순서: WJ-001~018의 구현 단위·선행 조건·완료 판정과 현재 착수 범위.
- 능동 토론 계획: 독립 초안·상호 검토·검증·수정·비교·종료와 UI 계약.
- 참여자 연결 계획: OAuth 다중 GPT 계정, API key 모델, browser agent의 인증·맥락·사용량 계약.
- Ubuntu 운영 계획: 서버 배치·HTTPS·다양한 기기 접속·로그인·서비스 복구.
- Codex 세션 계획: 실행 바인딩·도구·동시성·검증 결과 환류와 Phase 4A 완료 조건.
- PRD / Git Writer 상세 계획: 선택 Git Writer 모듈의 요구사항과 내부 구현 단계.
- [ADR 0001](./adr/0001-workspace-runtime.md): SQLite·실행 격리·설치 도구 계약과 구현 한계.
- [운영 절차](./operations-runbook.md) / [통합 구현 기록](./implementation/wj-002-015.md): 실행 명령, 관측한 검사 결과, 남은 실환경 완료 조건.

v0.4에서는 태블릿 전용 관제·dot/Muse 두 서비스 중심의 범위를 일반 웹 접속과 N인 능동 토론으로 정정한다. OAuth·API와 여러 GPT 참여자를 Phase 1~2에 포함한다. Ubuntu 우선, Codex 우선 코드 실행, 대화 보존·중복 방지·증거 기반 판정은 유지한다.

## 2. 확인된 현재 상태

2026-10-30 Ubuntu 개발 재개 점검 기준:

- 이번 검토 기준 `main`: `8f81d861b3f170ef2024b90d9eeba56ce34f0f79`. PR #1~11이 사용자 병합됐다. 이전 commit의 검사 결과는 날짜별 구현 기록을 따른다.
- 사용자의 전체 개발 지시에 따라 WJ-002~011, WJ-013의 도구 경로, WJ-014~015의 독립 구현을 하나의 실행 가능한 작업실에 연결했다. [구현 기록](./implementation/wj-002-015.md)에 범위별 증거를 남겼다.
- strict TypeScript·빌드와 Node 검사 39개, 실제 Chromium 브라우저 검사 4개를 통과했다. 설치한 Chrome DevTools MCP 1.12.0의 실제 도구 왕복과 Codex CLI 0.165.0의 생성 schema도 확인했다.
- 사용자 Ubuntu의 기존 앱은 `127.0.0.1:4090`에서 실행 중이다. 소유자 로그인·모의 2인 토론 12회 발언·비교·새로고침 복구, Node 검사 39개, 시스템 Chrome 156의 브라우저 검사 3개와 추가 MCP 단독 검사 1개, Codex schema·호스트 bubblewrap 격리를 확인했다. [실환경 재개 기록](./implementation/ubuntu-readiness-20261030.md)에 명령·판정·한계를 남겼다.
- 다음 단계 승인 후 systemd 앱·desktop·linger·HTTPS 8443을 적용했고 실제 HTTPS 로그인·SSE·noVNC 키 입력·서비스 재시작과 복구를 확인했다. nvm PATH·systemd 경로 파싱·Wayland 상속·noVNC 경로 오류를 고쳤으며 Node 검사 40개와 브라우저 검사 4개가 통과했다. [운영 적용 기록](./implementation/ubuntu-services-20261030.md)을 따른다.
- OAuth/DeepSeek 응답·dot 역할·Codex 실행 검사는 fixture다. 실제 계정 호출, 다른 Tailnet 기기 접속, 호스트 재부팅, 사용자 Codex 세션 실행은 하지 않았다. WJ-012/MVP-1 및 실세션 MVP-2는 NOT_RUN이다.
- 외부 계정·호스트에 의존하는 검증은 [운영 절차](./operations-runbook.md)의 순서로 수행한다. MCP Events와 Muse Connector는 별도 capability 검증 전까지 비활성이며 browser 완료 관측을 기본 경로로 쓴다.
- 2026-10-30 계정별 OAuth 로그인 공간·토커 설정·기본 Extra high와 사후 변경, 긴 전체 발언의 전원 재분석·라운드 공개 경계를 보강했다. Node 46개·Chrome/MCP 검사 8개와 실제 HTTPS 설정 UI가 통과했다. [구현 기록](./implementation/talker-settings-rounds-20261030.md)에 미검증인 실계정·모델 지원 범위를 분리했다.

| 항목 | 현재 판정 | 남은 증거 |
| --- | --- | --- |
| WJ-001 최소 프로젝트 | PASS / PR #3 병합 | [기존 구현 기록](./implementation/wj-001.md) 유지 |
| Ubuntu / Tailscale / 웹 클라이언트 | systemd·linger·실제 HTTPS·SSE·noVNC 입력·서비스 재시작 PASS | 다른 기기·실제 로그아웃·호스트 재부팅 |
| GPT OAuth 다중 계정 | 계정별 OAuth/vault/Models/Responses 구현·fixture PASS | 실제 2계정 등록·모델·완료 응답·refresh |
| DeepSeek API | 모델 발견·stream·usage 구현·fixture PASS | 허가된 key·실제 응답 |
| Chrome / dot / Muse | 실제 Muse thread 등록·첫 요청/응답 대조·수신 누락 복구 PASS, [기록](./implementation/muse-thread-binding-20261030.md) | 후속 맥락·전체 토론·자동 복구 확대; dot 연결 |
| 영속 Core / 능동 토론·검증·비교 | 구현·fixture·SIGKILL 복구 PASS | 혼합 실계정 토론 MVP-1 |
| 공동 대화 UI / 인계·개입 | 1440/390px Chromium 검사 PASS | 실제 Tailnet 기기 전환 |
| 상주 단톡방 / 열린 업무 큐 / Wiki | 코드 E7/E8에서 없음. 신규 제안/NOT_RUN | R1~R8으로 기존 backend 위에 결합, 실계정/DOM/호스트 UNVERIFIED |
| Scoped MCP / Secure MCP Tunnel | MCP 도구·stdio 전달기 구현·fixture PASS | 실제 터널과 dot 계정 연결 |
| MCP Events / Muse Connector | 미구현·비활성 | 최신 protocol·계정 capability 검증 후 별도 구현 |
| Codex 세션·검증 결과 환류 | 큐·승인·실행 대조·공통 재검토 fixture, 설치 schema PASS | 사용자 호스트의 기존 세션·실행 근거·후속 검토 MVP-2 |
| Git Writer / 추가 provider·병렬 실행 / 자동 병합 | WJ-016~018 후속 선택 범위 | 별도 착수·완료 조건; 병합은 사용자 |

구현과 실제 릴리스 판정은 별개다. fixture나 설치 schema의 성공을 실계정 연결·실세션 실행 성공으로 확대하지 않는다.

## 3. 설계 방향

1. 상주 Room에서 자유 대화·업무 제안/픽업·보고·Wiki를 이어간다. 필요할 때 기존 독립 초안→검토→검증→비교를 focus mode로 사용하고 종료 후 같은 방으로 복귀한다. 사용자가 답을 복사해 중계하지 않는다.
2. 참여자와 연결 방식을 분리한다. GPT OAuth 계정 여러 개, dot·Muse, API 모델에 동일한 Participant·Turn 계약을 적용한다.
3. 일반 GPT OAuth, DeepSeek API, 기존 agent의 browser 연결을 각각 검증한다. 실제 사용 가능하지 않은 연결을 성공으로 표시하거나 다른 인증 방식으로 몰래 대체하지 않는다.
4. 여러 초기안을 모두 수집하기 전에는 서로의 답을 전달하지 않는다. 같은 모델·공통 출처에 의한 상관과 실제 맥락 차이를 표시한다.
5. 동의와 사실 검증을 분리한다. 주장·출처·실행 근거·수정 이력·미확인 상태를 연결하고 의견 차이를 보존한다.
6. Core는 진행 규칙을 관리한다. 특정 dot이나 모델을 영구 진행자·정답 심판으로 두지 않는다. 요약 작성자와 검토 역할은 참여자에 배정할 수 있다.
7. 요청·시간·API 사용량 한도와 종료 이유를 기록한다. 로그인·권한·미확정 전송 외에는 매 발언마다 사용자 개입을 요구하지 않는다.
8. 대화와 credential을 참여자별로 분리한다. 기존 provider 대화는 보존하고 OAuth/API 이력은 웹쫀쿠가 관리한다.
9. 토론에서 위임하는 코드 검사·변경은 Phase 4A의 기존 Codex 세션을 우선 사용한다. 일반 토론은 Codex·Git Writer 없이도 완결한다.
10. Ubuntu의 실행·저장을 접속 기기의 브라우저 수명에서 분리한다. 어느 허용 기기에서 다시 접속해도 같은 기록을 복구한다.
11. Tailscale은 사용자 웹 접속, OAuth/API는 서버의 외부 모델 요청, Secure MCP Tunnel은 dot의 서버 도구 호출 통로다. 세 경로를 혼동하지 않는다.
12. 토론 상태는 특정 대화의 수명과 분리한다. 근거·이견·예산·미확정 실행을 보존한 checkpoint로 인계하고, 연결·응답·도구·업무 상태를 각각 관측한다.

## 4. 릴리스 범위

### 4.1 연결 PoC — Phase 0

- Ubuntu의 실제 버전·사용자·경로, Tailscale HTTPS 주소·포트와 원격 Chrome 보조 화면 확인.
- GPT OAuth 계정 2개를 분리 등록해 각 계정의 모델·권한·후속 맥락 확인. loopback callback이 서버에서 종결되는지 검증.
- DeepSeek API의 허가된 key·모델·응답 완료·맥락·사용량 확인.
- Chrome의 기존 dot·Muse를 각각 식별해 요청 1회·후속 질문 2회와 재연결 검증.
- 계정·credential·맥락이 서로 섞이지 않고 불확실 전송을 반복하지 않는 증거 기록.
- CLI 또는 최소 개발 화면을 사용한다. 전체 UI·코드 실행·GitHub 권한은 필수가 아니다.

### 4.2 능동 대화 MVP-1 — Phase 1~2

포함:

- 단일 사용자·프로젝트, root workflow 1개, 활성 provider turn 1개로 여러 참여자를 순차 실행.
- GPT OAuth 다중 계정·DeepSeek API·dot/Muse browser 참여자 등록과 토론별 선택.
- 주제 한 번 입력부터 N인의 독립 초안·상호 검토·검증·수정·최종 비교까지 자동 진행.
- 영속 Discussion·Turn·Claim·Evidence·Task·Event·송수신 기록과 재시작 복구.
- 원문을 참조하는 인계 checkpoint·대화 세대, 검증 과제 큐·의존성·배정·진행 한도.
- 공동 대화 타임라인, 참여자별 비교·근거·미해결 쟁점, 후속 질문·조건 추가.
- 상주 운영 필수 보강(미구현): 단톡방형 참여자/말풍선/자료 패널, 답장·@멘션, 사용자가 시작한 범위 안의 자유 대화·자동 수다. 지도·건축 월드는 제외하며 주제 토론과 활성 실행 슬롯을 공유한다.
- 참여자 상태 카드, 관측 시각·차단 이유, 실제 확보한 도구 활동·주장/증거 연결.
- Pause/Resume/Cancel, 진행 한도·API 사용량·비용, 연결별 인증·개입 상태.
- Tailscale private HTTPS, 반응형 UI, SSE snapshot/cursor 복구, noVNC 보조 화면.
- 서버 상시 실행과 재부팅 복구, 데스크톱·모바일 크기 및 실제 기기 접속 검증.

제외:

- 일반 토론을 위한 Git 코드 수정·배포 권한의 자동 부여, 자동 merge.
- 무제한 운영·검증되지 않은 동시 실행 확대·거대 회사 조직도를 선행 구현하는 범위. 최소 역할 배정·열린 큐·자동 Wiki는 제외하지 않고 R5/R7에서 구현한다.
- 계정 한도 우회를 위한 자동 계정 교체, 쿠키 복제, 비공개 대화 API 재현.
- OAuth만으로 기존 ChatGPT 대화·메모리·dot을 가져오는 기능.
- 대화 자동 영구 삭제.

태블릿은 지원 기기의 예시다. 서버 Ubuntu 적합성과 접속 클라이언트 OS·브라우저 호환성을 구분하며, 지원 목표는 일반 웹 브라우저다. 실제 통과한 조합을 compatibility matrix에 기록한다. macOS 서버 이식은 후속 범위지만 Mac 브라우저 접속은 첫 웹 UI 범위다.

### 4.2.1 상주 운영의 필수 보강

기존 4.2는 보존할 topic 기능 범위다. 새 기본 운영은 [운영 계약](./company-workflow-plan.md)의 Room·자유 발화·WorkTask·Wiki와 [R1~R8](./resident-implementation-plan.md)이다. Providers.complete/Store/인증/승인/기존 topic parser는 유지하며 engine dispatch 조정과 work scope 접점만 최소 변경 예외로 둔다. standalone 새 서버나 모든 backend의 재작성은 계획하지 않는다.

### 4.3 후속 범위

- Phase 3: 공식 MCP 작업·결과, Secure MCP Tunnel, dot Events와 Muse Connector 검증.
- Phase 4A: 토론의 검증·개발 요청 → dot 프롬프트 → 기존 Codex 세션 → 참여자 재검토·결과 비교.
- Phase 4B: 선택 Git Writer MVP. 저장소 1개·코드 변경 작업 1개·draft PR까지.
- Phase 5: Gemini 등 추가 provider/API와 다중 root workflow·동시 발언의 검증된 확대. Anthropic API 연결은 승인된 R8 보완으로 앞당겼으며 구독 OAuth는 보류한다.
- Phase 6: 조건부 자동 병합, 운영 고도화, 추가 서버 OS profile·다중 프로젝트.

## 5. 연결 구조와 실행 위치

```mermaid
flowchart TD
    Client["허용된 기기의 웹 브라우저"] <--> Serve["Tailscale HTTPS"]
    Serve <--> Core["Core · 공동 대화 · 비교"]
    Core <--> Adapter["참여자별 Adapter"]
    Adapter <--> OAuth["GPT 계정별 OAuth · Responses"]
    Adapter <--> API["DeepSeek 등 API"]
    Adapter <--> Browser["Ubuntu Chrome · dot · Muse"]
    Core <--> Store[("주제 · 발언 · 주장 · 근거")]
    Core <--> Executor["Codex 검증·개발 실행"]
    DotTool["dot의 도구 호출"] <--> Tunnel["Secure MCP Tunnel"]
    Tunnel <--> Core
```

### 5.1 Ubuntu와 웹 클라이언트

- Core·DB·OAuth/API runtime·Chrome·Browser Bridge·Codex 실행기를 Ubuntu에 둔다. credential·실행 작업 공간은 분리한다.
- 데스크톱·노트북·휴대전화·태블릿은 같은 HTTPS 웹 UI로 접속한다. 서버 프로세스나 저장소를 접속 기기에 두지 않는다.
- 초기 예시는 Tailscale Serve HTTPS 8443 → `127.0.0.1:3000`이다. 실제 포트·전체 `*.ts.net` 주소·접근 정책은 배포 때 확인한다.
- noVNC는 서버 Chrome 로그인·OAuth 등록·연결 승인·수동 개입을 위한 보조 화면이다. 평소 토론·결과 비교는 웹 UI에서 한다.
- Chrome 디버깅·원시 VNC·Codex RPC·OAuth loopback callback은 내부 경계에 둔다.
- 웹 클라이언트 종료는 서버 토론을 중지하지 않는다. provider 연결이 끊기면 해당 연결의 새 전송을 막고 이미 보낸 요청을 대조한다.
- 배치·기기별 검증·서비스 복구는 [Ubuntu 운영 계획](./ubuntu-operations.md)을 따른다.

### 5.2 스트리밍·장기 실행

- HTTPS API는 주제·지시·제어를, SSE는 영속 발언·상태·검증·비교 결과를 전달한다.
- OAuth/API의 실제 stream과 dot/Muse 화면에서 관측한 응답을 같은 UI event 계약으로 변환한다. 화면 관측을 공식 token stream이라고 표시하지 않는다.
- snapshot·cursor·중복 제거로 다른 기기·새 탭·절전 뒤 기록을 복구한다. 읽기 재접속은 새 발언·모델 호출을 만들지 않는다.
- 키보드·마우스·터치·한국어 입력을 검증하고 좁은 화면에는 대화/비교 탭을 제공한다.
- systemd 등 서비스 관리와 journal로 클라이언트·SSH 셸 수명과 무관하게 진행하고 재시작 시 상태를 대조한다.

### 5.3 공식 연결의 역할

GPT OAuth와 DeepSeek API는 Ubuntu에서 해당 공식 endpoint로 outbound 요청을 보낸다. Secure MCP Tunnel은 이 모델 요청의 필수 경유지가 아니다.

dot이 `task_get`·`codex_send` 등을 호출할 때는 Ubuntu private MCP와 Secure MCP Tunnel의 실제 권한·연결을 검증한다. Muse Connector는 별도 검증한다. Tailscale 접속 성공을 OpenAI/Muse 도구 연결 성공으로 대신하지 않는다. 상세한 인증·다중 계정·이력 계약은 [참여자 연결 계획](./participant-connections.md)을 따른다.

## 6. Chrome 연결 방법

### 6.1 우선 검증: Chrome DevTools MCP autoConnect

1. Ubuntu 서버에서 사용할 persistent Chrome profile을 확인하고 해당 서비스에 로그인한다. 필요한 조작은 웹 클라이언트 원격 화면에서 수행한다.
2. 실제 버전이 Chrome 144 이상이고 기능이 있는지 확인한다.
3. `chrome://inspect/#remote-debugging`에서 연결 기능을 활성화한다.
4. 검증 버전을 고정한 `chrome-devtools-mcp`를 `--autoConnect`로 연결한다.
5. Chrome이 요청하는 연결 승인을 사용자가 수행한다.
6. 선택된 프로필에서 계정·서비스·대화를 식별하고 바인딩한다.

공식 문서는 연결 요청마다 Chrome 허용 절차가 나타날 수 있다고 설명한다. 최초 승인만으로 영구 무인 연결을 보장하지 않는다. 설치 예제의 `@latest`를 릴리스 설정으로 그대로 사용하지 않는다.

자동 연결은 Chrome이 정한 기본 프로필을 선택하며 그 프로필의 열린 창들에 접근할 수 있다. 여러 프로필·계정이 자동으로 모두 연결된다고 가정하지 않는다. 다른 프로필이 필요하면 프로필별 연결을 검증하거나 확장 프로그램 경로를 선택한다.

### 6.2 대안: 확장 프로그램 + Native Messaging

기본 프로필 선택이 계정 구분을 충족하지 못하거나 더 좁은 탭 단위 연결이 필요하면 별도 spike로 검증한다.

- 사용자가 연결 탭을 선택하고 필요한 origin 권한만 부여한다.
- 확장 프로그램이 로컬 연결기와 통신하고 Core에는 선택한 작업 데이터만 전달한다.
- 페이지에서 온 메시지를 검증하며 임의 페이지의 로컬 명령 실행 통로를 만들지 않는다.
- 두 연결 방법을 같은 작업에서 동시에 활성화하지 않는다.

수동 remote-debugging port는 별도 운영 대안이다. Chrome 136 이후 기본 데이터 디렉터리에 디버깅 스위치만 추가하는 방법을 기존 로그인 연결 방법으로 안내하지 않는다. 별도 프로필 방식과 기존 프로필 재사용을 구분한다.

### 6.3 연결 식별자

| 식별 정보 | 용도 |
| --- | --- |
| browserConnectionId | 연결기 인스턴스·연결 방식 |
| profileBindingId | 사용자가 확인한 프로필 바인딩; 쿠키·프로필 파일은 수집하지 않음 |
| accountId / provider / surface | 계정과 일반 ChatGPT / dot / Muse 화면 구분 |
| agentIdentity | dot·Muse 에이전트의 관측·확인된 식별 정보 |
| conversationUrl / 대화 ID / tabId | 지속 대화와 현재 탭의 매핑 |
| taskId / attemptId / message receipt | 작업·전송 시도·실제 메시지의 연결 |

탭 ID는 재시작 후 바뀔 수 있다. URL이나 화면 제목 하나만으로 계정·대화 소유를 확정하지 않고 저장된 바인딩과 실제 화면을 함께 확인한다.

## 7. Provider별 전략

| 대상 | 첫 연결 | 후속 경로 | 계정에서 확인할 항목 |
| --- | --- | --- | --- |
| GPT dot | 기존 dot 대화의 UI 입출력 | 공식 MCP 도구 + MCP Events | dot 식별, 지속 대화, 비동기 업무, 도구·이벤트 |
| Muse | 기존 Muse 대화의 UI 입출력 | 공식 Connector/API·MCP 도구 | 대화·결과·산출물, Connector 권한 |
| GPT 계정 여러 개 | OAuth + ChatGPT plan usage + Responses | 검증한 모델·도구 확장 | 등록·scope·모델·이력·갱신·사용 한도 분리 |
| DeepSeek 등 API | API key + provider별 공식 대화 API | 추가 API adapter | 모델·stream 완료·usage·비용·오류 |
| Claude | Anthropic API key·인증된 모델 목록·Messages (fixture PASS, 실계정 NOT_RUN) | 공식 외부 앱 OAuth/Connector는 권한·계약 확인 전 보류 | 모델·workspace·stream 완료·usage·계정 권한 |
| Gemini | Web 어댑터 | 계정에서 확인한 공식 연결 | 현재 계정의 실제 기능 |

### 7.1 GPT dot

- dot은 계정과 별도로 식별되는 에이전트 화면이다. 같은 계정의 일반 ChatGPT와 dot을 독립 계정으로 중복 계산하지 않는다.
- 초기에는 해당 계정의 동시 실행 한도를 1로 공유한다.
- 기존 대화를 유지하고 task ID로 업무를 구분한다. 새 대화·새 dot 생성은 기본 동작이 아니다.
- “진행하겠다”는 응답은 수신 확인이다. 업무 완료는 명시적인 결과·상태·산출물 또는 인증된 결과 제출로 판단한다.
- 공식 문서상 MCP Events는 dots에서 지원된다. 사용자가 감시 대상과 수행 동작을 정하고 구독하면 서버가 일치하는 이벤트를 전달한다.
- `task.ready`는 웹쫀쿠에서 제안하는 자체 이벤트 이름이다. 계정 검증 전부터 동작하는 내장 기능으로 표기하지 않는다.
- webhook HTTP 성공은 접수 증거다. 구독 갱신, 이벤트 중복·순서, 도구 멱등성, 결과 수신을 별도로 검증한다.
- 공식 연동의 목표는 작업 이벤트 수신 → `task_get` → 수행 → `result_submit`이다. 이 도구와 이벤트는 웹쫀쿠가 구현한다.
- Phase 4A에서는 dot이 개발 프롬프트를 작성해 `codex_send`로 기존 Codex 세션에 전달하고 `codex_result`로 결과를 검토한다.

### 7.2 Muse

- 첫 구현은 화면에서 확인 가능한 대화 입력·응답·업무 상태다.
- 공식 Connector 문서는 Muse가 외부 서비스를 사용하는 API/MCP 연결을 설명한다. 임의 Muse 대화를 외부에서 시작하는 API가 있다고 추론하지 않는다.
- 해당 계정의 공식 연결이 확인되면 `task_get` / `result_submit`을 검증한다.
- 공식 연결이 미확인인 상태에서도 대화 PoC를 진행한다. 구조화된 제출의 지원 여부는 구분해 표시한다.

### 7.3 Browser 어댑터 계약

| 기능 | 반환할 핵심 정보 |
| --- | --- |
| attach / probe | 계정·화면·대화 바인딩, 확인한 capability |
| sendMessage | attempt ID, 전송 확인/불확실 상태, receipt |
| observeConversation | 새 메시지, 생성 상태, 오류·인증·사용자 개입 |
| followUp | 동일 대화에 대한 명시적 후속 요청 |
| collectResult | 결과·산출물 참조·완료 근거·검증 상태 |
| requestStop | 원격 중단 지원 여부, 요청·확인 결과 |
| detach | 연결 해제와 재연결 정보 보존 |

mode 선택, 첨부, 새 대화, 원격 취소, MCP·이벤트는 capability로 선언한다. 모든 서비스에 `m/h/xh/p`를 강제하지 않는다. OAuth/API 계약은 [참여자 연결 계획](./participant-connections.md)에서 별도로 정의한다. 알 수 없는 UI는 성공으로 처리하지 않는다.

### 7.4 Codex 실행 어댑터

제품 기본 경로는 Codex App Server, 최소 PoC 경로는 유휴 저장 세션에 대한 `codex exec resume "<SESSION_ID>"`다. 실제 세션 기록에 접근할 수 있는 Ubuntu 실행 환경에서 대상 cwd·계정·세션을 확인한다. 세션 ID만으로 실행 접근 권한을 대신하지 않는다.

| 상황 | 처리 |
| --- | --- |
| 유휴 세션의 다음 작업 | 대상 `threadId`로 resume 후 turn/start; 검증한 CLI exec resume도 가능 |
| 실행 중 다음 업무 | Core 대기열에 저장; 검증된 CLI queue는 선택 경로 |
| 현재 업무 방향 수정 | App Server turn/steer와 실제 expectedTurnId |
| 승인·실패·중단 | 실제 상태를 관제실과 dot에 전달; 접수나 자연어 답변으로 성공 판정하지 않음 |

제안 도구는 `codex_send`, `codex_status`, `codex_result`이며 필요하면 `codex_cancel`을 추가한다. send는 job ID를 반환하고 장기 실행은 별도 추적한다. CLI session ID·App Server thread ID·session tree ID는 실제 반환값으로 매핑한다. 활성 세션을 두 실행기가 동시에 재개하지 않는다.

dot의 프롬프트는 셸 코드로 평가하지 않는다. Codex의 기존 권한·승인 설정을 유지하고 실제 workspace·브랜치·사용자 변경을 보존한다. 상세 schema·실행·검토·복구 조건은 [Codex 세션 실행 계획](./codex-session-plan.md)을 따른다.

## 8. 메시지와 업무 상태

### 8.1 중복 전송 방지

1. 전송 전에 task·attempt·대상 바인딩과 요청 digest를 영속 저장한다.
2. 직전에 계정·대화·현재 생성 상태·사용자 입력 여부를 다시 확인한다.
3. 한 번만 입력·전송하고 실제 사용자 메시지가 생겼는지 확인한다.
4. 확인되면 receipt를 저장한다. 메시지 ID가 없으면 이전 메시지 기준점·본문·관측 시각을 함께 사용한다.
5. 클릭 후 timeout·연결 중단이 발생하면 `SEND_UNCONFIRMED`로 둔다. 대조 전에는 재전송하지 않는다.
6. 끝내 확정하지 못하면 해당 상태를 보여주고 사용자 재시도 결정을 받는다.

외부 웹 UI에 정확히 한 번 실행 보장을 주장하지 않는다. 불확실한 자동 중복 전송을 막고 재조정 가능한 기록을 남긴다.

### 8.2 상태 분리

| 축 | 상태 예시 | 의미 |
| --- | --- | --- |
| 연결 | CONNECTED / DISCONNECTED / AUTH_REQUIRED / TARGET_CHANGED | 브라우저·계정·대화 상태 |
| 전송 | PREPARED / SENT_CONFIRMED / SEND_UNCONFIRMED | 사용자 메시지 전송 증거 |
| 응답 | WAITING / GENERATING / RESPONSE_COMPLETE | 현재 대화 응답 상태 |
| 도구·원격 job | QUEUED / RUNNING / BLOCKED_APPROVAL / RECONCILING / COMPLETED | 실제 관측한 실행기 상태; 미관측·해당 없음과 구분 |
| 업무 | ready / running / blocked / review / done / failed / cancelled | 실제 작업과 검토 상태 |

“잠시 기다려 달라”는 응답이 끝나도 업무는 running이다. 도구 제출은 provider의 보고이며, 코드·검사·PR 성공은 실행 증거로 검토한다. `result_submit`은 기본적으로 review로 넘기며 검토 후 done 처리한다.

Pause는 새 전송을 막는다. Cancel은 웹쫀쿠의 후속 실행을 중단하고, 원격 중단 기능이 검증됐을 때만 해당 중단을 요청한다. 원격 중단이 확인되지 않으면 이를 명시한다. 일정 시간 화면이 변하지 않았다는 이유로 완료·실패로 단정하지 않는다.

사용자가 같은 대화에 입력하거나 대상이 바뀌면 자동 전송을 멈추고 상태를 대조한다. 사용자의 입력을 덮어쓰지 않는다.

각 축의 마지막 관측·실제 진행 시각과 출처를 보관한다. Chrome heartbeat 만료와 도구/원격 job 실패는 같은 사건이 아니다. 화면이 멈춘 동안 원격 작업이 진행 중이면 이를 표시하고 재실행하지 않는다. 실제 확보하지 못한 내부 도구 활동은 추측해 채우지 않는다.

### 8.3 보존 정책

- 기존 사용자 대화와 dot의 지속 대화는 기본 보존한다.
- 결과 수집 뒤 탭을 닫을지는 사용자가 선택한다. 탭 닫기와 대화 삭제를 구분한다.
- 임시 테스트 대화도 자동 영구 삭제하지 않는다. 삭제는 정확한 대상과 별도 요청에 따른다.
- 쿠키·인증 값·비공개 connector URL은 로그·저장소에 기록하지 않는다. 작업 본문·산출물은 필요한 범위에서 접근 제한된 저장소에 보관한다.

### 8.4 Codex job과 root workflow

Codex job은 accepted/queued/running/blocked_approval/reconciling/completed/failed/interrupted를 구분한다. Codex 완료는 상위 Task의 review 진입 조건이며 done 자동 확정이 아니다. 프롬프트·job·thread/turn·변경·검사 근거를 연결한다.

초기 전역 한도는 root workflow 1개와 활성 provider turn 1개다. Discussion 아래 여러 참여자의 발언·검증 Task를 순차 실행하고, Codex 위임 대기 중인 부모 Task가 자식 실행 슬롯을 막지 않게 한다. 세션과 worktree별 단일 작성자 lease도 적용한다. 같은 idempotency key의 재호출은 같은 job을 반환하고, 연결 불확실 상태는 대조 전 재실행하지 않는다.

### 8.5 Discussion과 참여자 발언

Discussion의 단계는 framing / independent / cross_review / verification / revision / synthesis로, 실행 상태는 ready / running / paused / blocked / completed / partial / cancelled / failed로 구분한다. 합의와 사실 검증은 별개다. 요청·시간·API 비용 예산, 초기안 공개 조건, claim/evidence, 종료 이유와 사용자 조건 revision을 영속 저장한다. 상세 계약은 [능동 토론 계획](./discussion-plan.md)을 따른다.

### 8.6 체크포인트·대화 세대·검증 큐

DiscussionCheckpoint는 기준 event cursor·주제 revision, 결론/근거/반론/미해결 질문, 완료·대기 과제, 잔여 예산과 미확정 receipt/job을 원문 참조와 함께 저장한다. 참여자별 공개 범위를 지켜 독립 초안·다른 계정의 비공개 이력이 인계 과정에서 섞이지 않게 한다. 재개는 이후 event와 현재 상태를 대조하며 같은 checkpoint 적용을 중복 모델 호출로 바꾸지 않는다.

`contextGeneration`은 같은 참여자의 context 바인딩·압축된 입력 기반 교체 이력이고 사용자 조건의 `topicRevision`과 다르다. 기존 dot·Muse 대화를 기본 보존하고 OAuth/API는 앱 소유 이력에서 인계 입력을 구성한다. 이전 세대의 늦은 응답은 원래 turn에 남기며 현재 단계·후속 호출에 자동 적용하지 않는다. 인계로 미확정 실행·예산·idempotency를 초기화하지 않는다.

검증 과제는 claim·완료 기준·의존성·capability·권한·예산을 가진 큐로 관리한다. 초기에는 같은 단일 활성 turn scheduler를 사용한다. 전송 불확실은 재조정 대상으로 두고 자동 pending 복귀·재배정을 금지한다. 상세 필드·전환·UI·검증 시나리오는 [능동 토론 계획 6장](./discussion-plan.md#6-저장스케줄링복구)을 기준으로 한다.

## 9. 참고 구현 적용 범위

### 9.1 Nhahan/WebGPT

검토 revision: `1d35588e79de288bd8a6d2992fc76e571f7bb75e`.

| 참고할 부분 | 웹쫀쿠 적용 |
| --- | --- |
| dispatch / sendOnce | 실제 전송 확인, 불확실한 재전송 방지 |
| 대화 URL·소유 확인 | 계정·agent·surface 바인딩까지 확장 |
| waitForReply | 현재 요청의 응답만 수집하고 생성 상태와 구분 |
| Worker submit_result | 인증된 구조화 결과, 중복 제출, 영속 수집 |
| 복구·검증 fixture | 중단 후 재조정과 일반 사용자 흐름 |

원본 `browser.mjs`는 호출자의 CUA tab API를 사용하는 helper다. 독립 Chrome 연결 엔진이 포함됐다고 가정하지 않는다. 일반 ChatGPT의 `/c/...`, 화면 구성과 reasoning controls에 맞춰져 있고 Work를 거부한다. dot·Muse에 그대로 적용하지 않는다.

전체 OS 사용자 권한 terminal Worker, 대화 자동 영구 삭제, quick-tunnel의 비밀 URL 기반 연결을 제품 기본 정책으로 가져오지 않는다. Git Writer 격리와 지속 대화 보존을 유지한다. 코드 도입 시 고정 revision과 해당 라이선스·고지 보존을 확인한다.

### 9.2 FlowDesk 사례에서 반영할 아이디어

사용자 제공 [ChatGPT 웹챗 6개 병렬로 실제 프로젝트 개발하는 환경 만들어봄](https://gall.dcinside.com/mgallery/board/view/?id=ai_utilize&no=77494)을 2026-10-29 읽었다. 글은 FlowDesk·MyPC MCP·SQLite로 여러 웹 대화의 작업 상태·인계·활동·큐를 관리한 개인 개발 사례다. 작성자는 통합 플레이 테스트를 뒤로 미뤘다고 설명한다. 게시글은 아이디어의 출처이며 구현 코드·성능·운영 신뢰성의 검증 자료로 사용하지 않는다.

아래는 그 관찰을 웹쫀쿠 요구에 맞춘 **자체 설계와 완료 기준**이다. 참고 프로젝트의 동작 보장을 옮겨 적은 것이 아니다.

| 반영 항목 | 웹쫀쿠 적용 | 구현 작업 |
| --- | --- | --- |
| 작업 인계 | 원문·근거·이견·남은 과제·예산·미확정 실행을 가진 checkpoint와 재개 대조 | WJ-007, 011 |
| 대화 교체 이력 | contextGeneration·checkpoint 적용 기록, 늦은 이전 응답 제외, 기존 대화 보존 | WJ-007, 011 |
| 참여자 상태 카드 | 계정 별칭·model·쟁점·현재 행동·마지막 활동·차단 이유 | WJ-010 |
| 상태별 관측 | 연결·응답·도구·업무의 독립 상태·시각·근거, 관측 중단과 실행 실패 구분 | WJ-006, 011, 014 |
| 검증 과제 큐 | 쟁점별 의존성·capability·권한·예산·배정·완료 증거 | WJ-008, 009 |
| 실행 활동과 증거 | 실제 tool/job event를 참여자·claim·evidence에 연결해 UI 제공 | WJ-009, 010, 014 |

여섯 웹챗 동시 실행을 MVP 한도로 복제하거나 다중 OAuth 계정 격리의 증거로 사용하지 않는다. Ubuntu·Tailscale 웹 UI, GPT OAuth·API·기존 Chrome 연결, root 1개·활성 turn 1개와 단계별 확장을 유지한다. SQLite·WebView2·IDA·Roslyn을 이 사례 때문에 필수 의존성으로 추가하지 않는다. 작업 큐도 미확정 전송을 자동 재시도하는 경로가 아니다.

### 9.3 WWG 사례에서 추가할 계획

사용자 제공 [웹쫀쿠 만듬](https://m.dcinside.com/board/ai_utilize/109771)과 글이 연결한 bangak684/WWG의 `77b6d227fcfa35b1b3e78ed61351e70c29b380bb`을 2026-10-30 정적 검토했다. WWG는 웹 ChatGPT의 MCP 호출을 로컬 파일·명령에 연결하는 도구 앱이다. 기존 공동 토론 Core를 교체하지 않고 [대조 검토서](./reviews/wwg-plan-review-20261030.md)의 제안을 다음 계획에 추가했다. 외부 프로그램·테스트는 실행하지 않았다. 이후 R1/R4를 구현했으며 나머지는 미구현이다. [자료·권한 구현 기록](./implementation/local-materials-capabilities-20261030.md)을 따른다.

| 제안 | 적용할 내용 | 우선순위·착수 조건 |
| --- | --- | --- |
| WWG-R1 읽기 자료 | 별도 allowlist, 폴더 탐색·파일 선택, UTF-8 원문·해시·시각·크기, 공통 snapshot·변경 재검사 | P1 / 구현·fixture 검증. 실제 사용자 파일의 모델 전달은 NOT_RUN |
| WWG-R2 권한 수명 | MCP grant·실행 binding의 만료·회수·scope 세대, dispatch/늦은 승인 재검사, 대기 취소·실제 interrupt 대조 | P0 / 실파일 변경을 포함한 WJ-014·015 전에 검증 |
| WWG-R3 비밀 경계 | 기존 state/profile 가림에 repo .env* 등 보호 경로·링크·변경 경합 검사와 알려진 비밀 출력 가림 추가 | P0 / 실행기 실파일 검증 전. 필요한 Git·Codex 인증 경로와 구분 |
| WWG-R4 권한 조회 | owner 화면·API와 scoped MCP의 정책·허용 경로·OS/도구 버전·연결/승인/실행 상태, grant별 호출 가능 도구 | P1 / 구현·fixture 검증. 설치 버전과 실제 격리·실행 성공을 구분 |
| WWG-R5 요청별 경과 | 기존 Task→CodexJob→turn/item으로 여러 요청·검사·부분 실패·선택 묶음 중단 표시 | P1 / WJ-014·015. 순차 실행 유지, 다중 job 묶음 확대는 최소 MVP-2 뒤 |
| WWG-R6 기록 보관 | cursor/page UI·큰 출력의 private 원문/digest/생략 표시, 상세 정리와 idempotency tombstone 수명 분리 | P1 / 로그 정리 활성화 전 회귀. 사용자 대화 자동 삭제 금지 |
| WWG-R7 파일 경합 | 선택 Writer의 기준 해시·적용 전 재검사·부분 반영/중단 diff 대조 | P2 / WJ-016의 별도 sandbox·draft PR 계약 유지 |

상세 수용 기준과 현재 코드의 차이는 검토서에 기록한다. 특히 WWG의 로그 보관 한도 밖 receipt가 사라지면 같은 ID가 다시 실행될 수 있다는 동작은 복제하지 않는다. 우리의 미확정 재전송 금지에 맞춰 최소 중복 방지 기록을 보존하거나 만료 ID를 거절한다. 자동 승인·범용 셸·파일 삭제·Electron/Windows 배포·SDK 전면 교체는 이 글을 근거로 추가하지 않는다. 게시글의 사용 경험도 계정·모델 가용성이나 공식 Connector 검증을 대신하지 않는다.

기존 실계정 MVP-1과 Codex의 읽기 전용 PoC 우선순위는 유지한다. 새 제안 전체를 구현해야 실계정 연결을 시작할 수 있는 것은 아니며, P0는 실제 파일 변경을 허용하기 전의 실행 완료 조건이다.

### 9.4 AI 단톡방 GUI와 상주 운영 — 개정

GUI 기준 96397/ai-chatroom 고정 SHA와 운영 기준 31803을 구분한다. PR #12의 CHAT-01~05와 각 결정은 [P01~P44 판정](./reviews/plan-decision-register-20261030.md)에 연결했다. 외형은 control.* 개조(A안), backend API/이벤트/계정/Store는 재사용한다. 자유 발화는 상주 방의 기본 운영이며 별도 후순위 자동 수다 제품으로 분리하지 않는다. 주제 토론의 6단계는 그 안의 focus activity로 남긴다.

열린 업무 큐·Wiki 누락을 R5/R7로 보완하고, 연결 UX는 R4에서 preset/discovery→기존 probe로 해결한다. JSON envelope.text와 구조화 근거/actions를 분리해 기존 provider 계약과 양립시킨다. PR #12의 30분/30호출·간격/휴면 숫자는 미승인 제안으로 U1/U2에 남긴다. 모델/xhigh 자동 하향, 새 account 우회, 지도/3D, 외부 그림 복사는 없다. 개정/실제 결과를 혼동하지 않는다.

## 10. 단계별 개발 계획

아래 Phase/WJ는 지정 계획의 기존 모듈 이력이다. 현재 다음 구현의 정본은 R1~R8이며 각 단계의 실제 파일·심볼/계약 유지·변경/이관/수락/롤백은 [단계별 계획](./resident-implementation-plan.md)에 둔다. 기존 연결·토론 코드를 새로 만드는 지시로 해석하지 않는다. 공식 Events/추가 provider/병렬 확대는 상주 큐·Wiki의 선행 조건이 아니다.

### Phase 0 — 접속·OAuth·API·기존 에이전트 연결 PoC

산출물:

- 실제 Ubuntu profile·Tailscale 주소/포트와 기기 웹 접속·noVNC 기록.
- GPT OAuth 2개 계정의 등록·모델·응답 완료·후속 맥락·갱신 검증 기록.
- DeepSeek API 최소 왕복·stream·usage 기록.
- dot·Muse browser adapter spike와 기존 대화·로그인·재연결 기록.
- 공통 Participant / AccountConnection / ProviderAdapter 초안과 실제 capability matrix.

완료 조건:

- [참여자 연결 계획](./participant-connections.md)의 개별 연결 PoC를 수행하고 계정·이력·credential 혼선을 막는다.
- dot·Muse는 각각 같은 대화에서 요청 1회·후속 질문 2회와 재연결을 확인한다.
- OAuth의 scope·모델 목록·실제 완료 응답을 구분하고 key 또는 DOM 경로로 임의 대체하지 않는다.
- timeout·부분 응답·인증 필요를 성공으로 보고하지 않으며 불확실한 호출을 자동 반복하지 않는다.
- 대화 연결 가설에 코드 변경·terminal 권한을 요구하지 않는다. 모델 호출은 허용된 계정·key와 사전 설정한 테스트 예산으로만 수행한다.

### Phase 1 — 영속 Core·참여자·토론 계약

산출물:

- Node.js 24 계열·strict TypeScript Core와 저장소 adapter.
- Participant·AccountConnection·ConversationContext, OAuth/API/browser adapter 계약.
- Discussion·Turn·Claim·Evidence·VerificationTask·Comparison·Task·Attempt·Event schema.
- DiscussionCheckpoint·ContextGeneration·상태 관측/활동 계약과 원문 참조·공개 범위.
- 초기안 공개 barrier, review 배정, 요청·시간·API 예산, 단계 scheduler.
- VerificationTask 큐의 의존성·capability·우선순위·증거 기준과 중복/재조정 규칙.
- credential 참조·계정별 refresh·사용량 ledger, journal·lease·reconciliation.
- Codex Executor/SessionBinding/Job 확장 계약, fake provider/clock/storage fixture.

완료 조건:

- 여러 참여자를 같은 root workflow 안에서 순차 진행하며 부모·자식 슬롯 교착이 없다.
- 초기 초안에 다른 참여자의 답이 노출되지 않고, 다음 단계 입력 snapshot이 고정된다.
- 합의·근거 검증·응답 완료·업무 완료를 구분한다. 질문·반론·검증 제안을 예산 안의 다음 Task로 변환한다.
- send 전후 중단·API 스트림 중단·토큰 갱신·한도를 대조하고 중복 전송·과금 가능성을 숨기지 않는다.
- Task·단계 전이·Event가 원자적으로 기록되고 snapshot/cursor로 복구된다.
- checkpoint 이후 event와 인계 적용을 대조하고, 이전 세대 응답·중복 재개가 현재 단계나 추가 호출을 만들지 않는다.
- 인계 전후 초안 공개 범위·계정/맥락 격리·예산·미확정 receipt/job이 보존된다.
- 기본 fixture가 실제 모델·GitHub·유료 API에 접속하지 않는다.

### Phase 2 — 공동 대화·검증·비교 웹 UI / 대화 MVP-1

산출물:

- 주제 입력·참여자 선택·공동 대화·참여자별 초기/최종안 비교·근거 화면.
- 참여자 상태 카드·검증 큐·활동 내역·checkpoint 인계 이력과 원문/증거 연결.
- N인 자동 토론: 독립 초안 → 상호 검토 → 근거 확인 → 수정 → 비교·종합.
- 사용자 추가 메시지·조건 revision·지목 질문, Pause/Resume/Cancel, 부분 결과·종료 이유.
- OAuth 계정 추가·모델 선택, API 연결·사용량, browser agent 연결·개입 상태.
- Tailscale HTTPS·SSE 복구·반응형 UI·noVNC와 서버 재시작 복구.

완료 조건:

- 사용자가 주제 한 번을 입력하면 복사·붙여넣기나 발언마다의 계속 지시 없이 전체 대화 흐름이 진행된다.
- GPT OAuth 계정 2개·DeepSeek API를 함께 넣은 토론과 dot/Muse browser 참여를 확인한다. 2인 전용 상태·비교 schema를 사용하지 않는다.
- [능동 토론 계획](./discussion-plan.md)의 검증 항목을 통과한다. 공통 오답·근거 부족·같은 출처 중복·이견을 합의만으로 검증 완료 처리하지 않는다.
- 참여자 장애·한도·사용자 개입·옛 revision 응답을 올바르게 처리하며 무한 반복하지 않는다.
- 관측된 상태·추정값·미확인을 구분하고 화면 heartbeat만으로 도구/원격 job 실패·재실행을 결정하지 않는다.
- 허용된 기기의 브라우저에서 같은 Discussion에 접속하고 접속 종료·기기 전환 뒤 진행과 누락 기록이 복원된다.
- 데스크톱·좁은 화면의 핵심 흐름, 키보드/마우스·터치·한국어 입력, HTTPS·SSE·WSS·접근 정책을 확인한다.
- 실제 통과한 서버/클라이언트 조합을 각각 기록한다. 태블릿을 필수 운영 기기로 고정하지 않는다.

### Phase 3 — 구조화된 작업·결과 / 공식 이벤트

산출물:

- 최소 MCP 도구: `task_get`, `context_get`, `result_submit`; 필요 시 원자적 `task_claim`.
- Ubuntu private MCP와 Secure MCP Tunnel, 실제 Platform·ChatGPT 권한·연결 기록.
- 연결 주체·task 범위를 검증하는 인증 계약과 중복 결과 처리.
- dot MCP Events 구독·전달·결과 회수 PoC.
- Muse Connector capability 확인과 가능한 범위의 결과 제출 PoC.

완료 조건:

- 최소 한 provider에서 task ID와 연결된 구조화 결과를 회수한다.
- dot이 실제 tunnel을 통해 작업 도구를 발견하고 호출한다. Tailscale 관제 접속 성공으로 이를 대신하지 않는다.
- 이벤트 접수와 업무 완료를 구분하고 중복 이벤트가 중복 작업을 만들지 않는다.
- 같은 task의 Browser/Event 활성 실행 경로는 하나다.
- Muse의 미확인 공식 연결은 브라우저 성공과 구분한다.
- dot Events가 미검증이면 해당 기능만 experimental/blocked로 남긴다. 대화 MVP-1의 완료와 혼동하지 않는다.

### Phase 4A — dot → 기존 Codex 세션 / 실행 MVP-2

산출물:

- [Codex 세션 실행 계획](./codex-session-plan.md)의 실행기·바인딩·도구·영속 job 계약.
- App Server 기본 경로와 검증된 CLI resume/queue 대안.
- dot 프롬프트 작성·실행 지시·동일 세션 후속 수정, 검증 증거를 원래 Discussion의 모든 참여자에게 돌려주는 흐름.
- 웹 클라이언트 진행 로그, 기존 Codex 승인 요청 전달, 실패·중단·재연결 처리.

완료 조건:

- 등록된 실제 세션의 맥락·cwd를 유지해 요청을 수행하고 결과가 dot과 관제실에 회수된다.
- 같은 세션에 후속 지시 1회 이상을 수행하고 새 변경의 검증 근거를 남긴다. 원래 주제·claim에 연결해 참여자가 각자 재검토하고 비교 결과를 갱신한다.
- 대기와 steer를 구분하고 다른 세션·turn에 잘못 전달하지 않는다.
- 중복 제출·전송 불확실·실행기 재시작을 대조하며 활성 세션을 이중 재개하지 않는다.
- 사용자 변경·기존 권한을 보존하고 Codex 완료·검사 성공·상위 업무 완료를 구분한다.
- 웹 클라이언트를 닫아도 실행이 계속되고 복귀 시 상태·로그를 복구한다.

### Phase 4B — 선택 Git Writer 통합

산출물:

- [상세 계획](./git-writer-plan.md)의 내부 Phase 0~6.
- Core task / Writer change 매핑, checks·commit·PR 증거.
- disposable repository에서 요청부터 draft PR까지 통합 시나리오.

완료 조건:

- 초기 Ubuntu 지원 profile에서 요청 하나가 검증된 변경·정확히 하나의 draft PR로 이어진다.
- main 직접 push, force-push, 자동 merge, 무격리 target 실행이 없다.
- 브라우저 세션과 GitHub/tunnel credential이 target sandbox로 넘어가지 않는다.
- 정확한 최종 변경과 checks·PR head가 일치한다.

이 모듈의 gate는 Codex 세션 실행의 선행 조건이 아니다. 코드 실행 범위와 실제 격리 보장은 각 모듈의 검증 결과로 표시한다.

### Phase 5 — 추가 Provider·동시 실행 용량 확장

- Phase 2의 GPT OAuth 다중 계정·DeepSeek·dot/Muse와 R8 보완의 Anthropic API를 기반으로 Gemini 등 추가 provider를 연결한다. Anthropic 실계정 수락은 별개로 남긴다.
- 기존 AccountConnection·Participant 계약의 실제 용량을 검증해 병렬도를 확장한다. 현재 계정의 최소 역할/큐 배정은 R5에 포함하며 이 단계까지 미루지 않는다.
- GPT 3·Claude 1·Gemini 1은 과거 기획값이다. 실제 계정 수·가용성을 확인한다.
- dot은 같은 ChatGPT 계정의 한도를 공유한다. Muse 계정도 실측 등록한다.
- 이미 전송된 task를 timeout만으로 다른 Seat에 재배정하지 않는다. 원래 실행 상태를 대조하거나 명시적으로 취소한 뒤 새 attempt를 만든다.
- 계정당 1 활성 작업부터 시작해 검증된 범위에서만 병렬도를 늘린다.

### Phase 6 — 운영 확장 / 자동 병합

- Phase 2의 Ubuntu 상시 운영을 기반으로 운영 고도화·다중 프로젝트·macOS 등 추가 OS profile을 검증한다.
- 기본 브랜치 보호, 비어 있지 않은 required checks, 정확한 PR head, 권한 제한을 검증한 뒤 자동 병합을 별도 릴리스한다.
- required checks가 없다는 이유로 즉시 병합하는 fallback을 만들지 않는다.
- 자동 병합과 추가 운영 기능은 각각 완료 조건을 통과해야 한다. 기본 서버 상시 실행을 이 단계까지 미루지 않는다.

## 11. 검증 전략

| 검증 | 환경 | 핵심 |
| --- | --- | --- |
| 계약·상태 | offline | journal, lease, 응답·업무 상태, 중복 결과 |
| UI fixture | offline | 서비스별 입력·응답, 다른 대화·생성 중·인증 만료 |
| 기본 대화 E2E | 지정한 실제 대화 | 요청·후속 질문·결과·대화 보존 |
| 복구 | fixture + 최소 실제 흐름 | send 이후 중단·재시작·중복 방지 |
| 인계·검증 큐 | offline + adapter 통합 | checkpoint 이후 event, 공개 범위·예산 보존, 이전 세대 응답 제외, 의존성·미확정 재배정 방지 |
| 상태·활동 UI | fixture + 확보한 실제 event | 화면/도구의 상태 차이, 관측 시각·출처, 보고와 실행 증거의 구분 |
| Ubuntu / 웹 클라이언트 | 실제 서버·데스크톱 및 모바일 브라우저 | HTTPS·SSE·WSS, 기기 전환·재접속·재부팅, 로그인·승인·입력 |
| OAuth / API 혼합 | offline + 실제 허가된 계정·key | 다중 GPT 계정 격리·refresh·모델·usage·stream 완료 |
| 능동 토론 | fixture + N인 실제 혼합 토론 | 초기안 분리·반론·근거 검증·비교·한도·부분 종료 |
| MCP/Event | 실제 허용된 연결 | scope, 구독, 수신, 결과·중복 처리 |
| Codex 세션 | offline adapter + 등록된 실제 세션 | resume·queue·steer, 승인, 단일 작성자, dot 왕복·후속 수정 |
| Git Writer | offline + disposable repo | 상세 계획의 sandbox·checks·draft PR |

실제 E2E는 사용자가 지정한 테스트 대화와 범위에서 실행한다. 계획서 업데이트 자체를 실계정 전송·연결 승인 완료로 간주하지 않는다.

PASS / FAIL / NOT_RUN / BLOCKED를 구분한다. 증거에는 버전·OS·provider·대화 식별 참조·attempt·전송 확인·응답/업무 상태·결과를 남기고 인증 값은 제외한다. 문서나 fixture로 실제 계정 PASS를 대신하지 않는다.

## 12. 바로 다음에 할 작업

구현 범위와 남은 실제 완료 조건은 [개발 실행 순서](./implementation-sequence.md)와 [통합 구현 기록](./implementation/wj-002-015.md)을 따른다. 다음 작업은 새 Core를 만드는 것이 아니라 **구현된 작업실을 사용자 Ubuntu에 배포하고 실제 연결을 검증하는 것**이다.

1. **WJ-002 운영 검증:** 지정 Ubuntu 사용자·경로·버전 확인, 서비스 기동, Tailscale HTTPS·SSE·noVNC와 재부팅 복구.
2. **WJ-003~006 연결 검증:** GPT OAuth 1계정 후 2계정 격리, DeepSeek 실제 응답, 기존 dot·Muse의 선택자·대화 왕복·복구.
3. **WJ-012 대화 MVP-1:** 혼합 참여자의 독립 초안·반론·검증·수정·비교, 조건 변경·기기 전환·서버 재시작을 실제 기록으로 판정.
4. **WJ-013~015 실행 MVP-2:** 실제 Secure MCP Tunnel과 등록 Codex 세션, 승인·실행 근거·모든 참여자 재평가를 확인. Events/Connector는 지원·권한을 확인한 뒤 별도 구현한다.

Git Writer·추가 provider/병렬 실행·자동 병합은 WJ-016~018의 후속 범위다. 필수 실제 연동이 막히면 이유를 남기고 가능한 연결을 먼저 검증하되 전체 MVP 완료로 표시하지 않는다. 사용자 병합 정책은 유지한다.

## 13. 참고 자료와 확인 범위

2026-10-29 읽은 문서·코드 기준이다. 구현 시 검증 버전과 실제 계정 결과를 compatibility matrix에 고정한다.

| 자료 | 확인 범위 |
| --- | --- |
| [DCInside: WebGPT 웹쫀쿠 subagent 스킬 업데이트](https://gall.dcinside.com/mgallery/board/view/?id=ai_utilize&no=84956) | 사용자 제공 글의 원본 저장소·사용 방식 |
| [DCInside: ChatGPT 웹챗 6개 병렬 개발 환경](https://gall.dcinside.com/mgallery/board/view/?id=ai_utilize&no=77494) | 게시글 본문의 인계·상태·큐 아이디어 검토; 코드·계정 격리·성능 검증 없음, 적용은 9.2절 |
| [Nhahan/WebGPT 고정 revision](https://github.com/Nhahan/WebGPT/tree/1d35588e79de288bd8a6d2992fc76e571f7bb75e) | README, SKILL, setup, browser-reply, browser/client/worker 코드 |
| [Chrome 기존 세션 연결](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session) | Chrome 144+ autoConnect·사용자 허용 |
| [Chrome DevTools MCP advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) | 기본 프로필 선택·기존 세션·수동 디버깅 차이 |
| [Chrome 디버깅 스위치 변경](https://developer.chrome.com/blog/remote-debugging-port) | Chrome 136+ 기본 데이터 디렉터리 제한 |
| [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) | 확장 프로그램·로컬 연결기 대안 |
| [Meet dots](https://learn.chatgpt.com/docs/dots) | 웹 대화·지속 에이전트·비동기 업무 |
| [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events) | dots 지원·MCP 2.0 구독·webhook |
| [Muse Connector guidelines](https://platform.muse.ai/docs) | Muse가 외부 API/MCP를 사용하는 공식 경로 |
| [Codex CLI reference](https://learn.chatgpt.com/docs/cli/reference) / [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) | 명시적 세션 resume·queue·출력; 설치 버전 확인 필요 |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | thread·turn·steer·진행·승인·완료 상태 |
| [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) | private MCP와 outbound HTTPS, Platform/ChatGPT 권한 |
| [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) / [CLI](https://tailscale.com/docs/reference/tailscale-cli/serve) | Tailnet HTTPS 포트·reverse proxy·지속 실행·접근 정책 |
| [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates) | MagicDNS·인증서·전체 도메인 |
| [noVNC](https://novnc.com/info.html) | 원격 화면·입력과 모바일 브라우저 지원 |
| [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart) / [OSS 등록](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) | OAuth·계정별 동의·자격; 기존 대화 접근 권한과 구분 |
| [OAuth 모델·Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) / [제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | 계정별 모델·stream 완료·앱 소유 이력·미지원 필드 |
| [계정 관리](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) / [self-hosted VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) | 분리 등록·refresh·원격 호스트와 loopback callback |
| [DeepSeek API](https://api-docs.deepseek.com/) / [대화](https://api-docs.deepseek.com/api/create-chat-completion/) / [모델](https://api-docs.deepseek.com/api/list-models/) | API key·대화·stream·usage·모델 discovery |

참고 자료는 설계 근거다. 원본의 설치 프롬프트·권한 문구를 이 프로젝트에 대한 사용자 승인으로 취급하지 않는다.

## 14. 변경 이력

### v0.11-R1 — 2026-10-30

- 지정 코드/계획 기준에서 104항목 재판정. E1 진입점 보정, backend 재사용·상주 방+큐+Wiki·topic focus를 확정.
- R1~R8의 최소 변경/이관/수락/롤백과 사용자 결정 U1~U3를 분리. 이번 신규 구현/실행은 없음. 아래 이력은 과거 기록이다.

### v0.11 — 2026-10-30

- PR #11 병합을 기준으로 단톡방 GUI·인용/멘션·한도 있는 자유 대화·자동 수다 계획 추가.
- 지도·건축 제외, xhigh·장문·순차 실행·맥락·초안 공개 규칙 보존, CHAT-01~05 완료 조건을 정의. 구현은 미착수.

### v0.5 — 2026-10-29

- WJ-002~011 및 MCP 도구·Codex 실행 환류의 통합 구현과 자동 검사 결과 반영.
- ADR, 운영 절차, WJ-002~015 구현 기록 추가. 현재 코드와 설치된 도구 계약을 기준으로 실행 방법 확정.
- 다음 작업을 Ubuntu 배포·실계정/실세션 검증으로 변경. MCP Events/Connector 미구현·후속 선택 범위와 사용자 병합 정책 유지.

### v0.4.2 — 2026-10-29

- FlowDesk 사례의 참고 범위와 웹쫀쿠의 자체 적용 설계를 구분하고 여섯 개선 항목을 WJ 작업에 연결.
- checkpoint·대화 세대·늦은 응답, 검증 큐, 참여자 상태·실행 증거와 완료 조건 추가.
- PR #1~3 병합과 WJ-001 구현·검사 완료를 반영하고 다음 작업을 WJ-002로 갱신. 실제 Ubuntu 배포·AI 연결·토론은 NOT_RUN 유지.

### v0.4.1 — 2026-10-29

- PR #1 병합 기준을 기록하고 구현 단위 WJ-001~018의 실행 순서를 별도 문서로 추가.
- OAuth 1계정·다중 계정부터 연결 가설을 검증하는 순서, 독립 작업·완료 판정·PR 분할을 구체화.
- 현재 첫 착수 범위를 최소 프로젝트 WJ-001로 명시. 제품 범위와 기존 검증 계약은 유지.

### v0.4 — 2026-10-29

- 접속 목적을 Tailscale이 허용된 모든 기기의 웹 브라우저로 정정; 태블릿은 예시.
- 핵심 제품을 주제 기반 N인 능동 토론·상호 검증·결과 비교로 확정.
- dot·Muse를 각각 하나의 참여자로 두고 여러 GPT OAuth 계정과 DeepSeek API 혼합 참여를 Phase 1~2에 포함.
- OAuth 인증·Responses 호출·앱 소유 대화 이력과 기존 ChatGPT/dot 대화의 경계 명시.
- 독립 초안·교차 검토·근거·비교·종료·예산·사용자 개입 및 Codex 검증 결과 환류 계약 추가.
- 참여자 연결·능동 토론 상세 계획 신설. 실환경 검증은 NOT_RUN 유지.

### v0.3 — 2026-10-29

- Ubuntu 서버 상시 실행·Tailscale HTTPS 특정 포트·태블릿 관제를 운영 기준으로 확정.
- SSE 로그·상태 복구와 noVNC 원격 Chrome 로그인·승인·수동 개입을 구분.
- 서버 Chrome의 persistent profile과 autoConnect 연결 절차 구체화.
- dot → MCP → 기존 Codex 세션 → 결과 검토·후속 지시를 Phase 4A와 별도 실행 계획으로 추가.
- 세션/thread/turn 식별, 대기·steer, 승인·중복 실행·재연결·검증 근거 계약 추가.
- Tailscale 사용자 접속과 Secure MCP Tunnel의 dot 도구 호출 경로 분리.
- Git Writer는 Phase 4B 선택 모듈, macOS는 후속 확장으로 정합화. 실환경 검증은 NOT_RUN 유지.

### v0.2 — 2026-10-29

- Git Writer 중심 계획을 웹쫀쿠 전체 개발 계획으로 확장.
- 기존 Chrome의 dot·Muse 대화를 첫 PoC로 지정.
- 어댑터, 보존, 중복 방지, 비동기 상태·재연결 조건 추가.
- autoConnect·프로필 제약과 확장 프로그램 대안 명시.
- dot Events·Muse Connector의 문서상 지원과 미검증 항목 분리.
- Nhahan/WebGPT 참고 구현의 적용·비적용 범위 기록.
- 기존 Git Writer 조건을 별도 문서로 보존하고 PRD·Living Design과 정합화.
- “첫 커밋 없음” 등 과거 기준선을 GitHub 조회 결과로 정정.

### v0.1 — 2026-08-15

- Git Writer 구현·검증 계획 작성. 세부 내용은 별도 상세 계획으로 이어간다.

