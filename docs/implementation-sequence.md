# 웹쫀쿠 개발 실행 순서

> **현재 구현 지시**: [개발 페이즈 SSOT](./development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)가 순서·범위·상태의 단일 기준이다. 현재 승인 범위와 결과는 위 SSOT를 따른다. 아래 문서의 과거 “계획만/구현 금지”는 당시 개정 작업의 이력이며 현재 페이즈 지시를 대체하지 않는다.

> 지정 코드 C=8f81d861b3f170ef2024b90d9eeba56ce34f0f79, 계획 P=8db0f42f499f674c66c3a0df0a4d8e0f25fb216e를 고정한 개정이다. 먼저 [1쪽 요약·기준 차이·근거](./plan-revision-20261030.md), [104항목 판정](./reviews/plan-decision-register-20261030.md), [운영 계약](./company-workflow-plan.md), [8단계 변경·이관·수락·롤백](./resident-implementation-plan.md)을 읽는다. backend 재사용이 기본이며 구현 상태는 위 SSOT, 실계정·DOM·호스트 적합성은 별도 검증 전 UNVERIFIED다. 과거 PASS 보고를 이번 실행 결과로 승계하지 않는다. 계획 개정 당시에는 문서만 수정했다. 현재 구현 지시는 위 SSOT가 관리하며 실계정·배포는 별도 범위다. 개발 시 [디자인 패턴 지침](./development-guidelines.md)의 작은 Adapter/DI·명시 상태 전이·기존 transaction·coordinator/CAS·검사/롤백 기준을 함께 적용한다.

| 항목 | 값 |
| --- | --- |
| 상태 | 기존 backend 재사용·상주 8단계 매핑, 구현 상태는 SSOT |
| 작성일 | 2026-10-29 (KST) |
| 개정일 | 2026-10-30 (KST) |
| 기준 | 지정 계획 P의 v0.11을 본 개정으로 재심사, 코드 C=PR #11 병합 tree |
| 원 계획 기준 main(C) | `8f81d861b3f170ef2024b90d9eeba56ce34f0f79` |
| 제품 범위 | Tailscale 웹 접속, 여러 GPT OAuth 계정·dot·Muse·API 모델의 능동 토론·검증·비교 |
| 다음 작업 | SSOT의 현재 페이즈를 따름. 실계정/배포는 별도 수락 |
| PR 처리 | 작업별 브랜치와 검토 가능한 PR로 분리; 병합은 사용자가 수행 |

## 1. 기준과 실행 원칙

기존 코드/검사 이력은 아래처럼 보존하되 새 상주 기능의 근거로 세지 않는다. 기준 P의 각 WJ/CHAT 결정은 판정표 S01~S08/P38~P44, 다음 변경은 R1~R8에 대응한다. 새 인증/DB/provider/실행기를 만드는 단계가 아니라 있는 backend를 결합하는 단계다.

PR #1~11이 main에 병합됐다. 연결 adapter·영속 Core·토론 UI·MCP·Codex 실행, Ubuntu 서비스·HTTPS·noVNC, Muse thread·첫 응답 복구, 토커 계정·사고 깊이·라운드 설정과 로컬 자료·권한 조회를 반영했다. 전체 실계정·실세션 완료 판정은 남아 있다. [통합 구현 기록](./implementation/wj-002-015.md), [Ubuntu 운영](./implementation/ubuntu-services-20261030.md), [Muse 연결·복구](./implementation/muse-thread-binding-20261030.md), [토커 설정](./implementation/talker-settings-rounds-20261030.md), [로컬 자료·권한 조회](./implementation/local-materials-capabilities-20261030.md)를 함께 따른다. 인증·대화·운영·Codex의 상세 계약은 각 원문을 따른다.

**실환경 검증은 연결 → 혼합 토론 → Codex 환류 순서다.** 실제 계정·Ubuntu 접근이 없는 동안 독립 구현과 fixture 검증을 진행했다. 이제 구현된 UI에서 각 연결의 실응답을 확인하고 N인 토론·근거·비교를 판정한다.

2026-10-30 다음 단계 승인으로 [상시 운영·HTTPS·원격 Chrome](./implementation/ubuntu-services-20261030.md)을 적용했다. 서버에서의 HTTPS·noVNC 입력·서비스 재시작은 PASS이며, 다른 기기·실제 호스트 재부팅·계정·Codex turn은 이 결과로 완료 판정하지 않는다.

- 작업 ID는 실행 순서와 의존성을 추적하는 식별자이며 실제 GitHub PR 번호가 아니다. 한 작업을 기본 PR 단위로 삼되 규모가 커지면 논리적으로 분리한다.
- 기본 진행은 아래 표의 번호순이다. 앞 작업의 외부 인증·서버 준비가 막히면 선행 조건이 충족된 독립 작업이나 offline fixture를 진행한다.
- 연결 PoC 전에는 최소 계약만 둔다. 실제 응답·오류·인증 방식을 확인한 뒤 영속 schema와 adapter를 고정한다. 운영에 쓸 Core가 만들어지면 PoC 코드를 같은 계약으로 통합한다.
- fake provider는 구조·상태 검증용이다. fake 응답이나 계획 문서로 실제 계정 연결·MVP 완료를 판정하지 않는다.
- 외부 모델 호출·설정 변경은 해당 구현 단계의 지정 계정·호스트·예산 안에서 수행한다. 이 순서 문서를 작성하면서 실제 로그인·배포·모델 호출을 실행한 것은 아니다.
- 구현 후 변경 범위에 맞는 계약·상태·통합 검증을 수행하고 결과를 남긴다. 매 작업마다 전체 실계정 회귀를 반복하지 않는다.

## 2. 구현 작업과 선행 조건

WJ-001~018은 기존 모듈 이력이다. R1은 WJ-007/011에 additive state, R2는 WJ-008의 최소 공통 dispatch, R3/R4는 WJ-010/006 GUI/연결 UX, R5/R6는 WJ-007/014/015에 열린 업무 연결, R7은 같은 Store/MCP 위 Wiki와 scope, R8은 기존 WJ-012/015를 포함한 전체 수락이다. 기존 완료 구현을 다시 만드는 것이 아니다.

WJ-001은 PR #3 병합 상태다. WJ-002~011 및 WJ-014~015는 코드와 자동 검사가 준비됐고, WJ-013은 scoped 도구·stdio 전달기가 구현됐다. MCP Events/Muse Connector는 미구현·비활성이다. WJ-012 및 계정·운영 서버·실세션에 의존하는 완료 판정은 NOT_RUN이며 WJ-016~018은 후속 선택 범위다. 아래 표는 원래 의존성과 실제 완료 기준을 유지한다. 상세 코드 상태는 [구현 기록](./implementation/wj-002-015.md)을 따른다.

| 순서 | 작업 | 상위 단계 | 선행 조건 | 산출물·완료 기준 |
| --- | --- | --- | --- | --- |
| WJ-001 | 실행 가능한 최소 프로젝트 — DONE | Phase 0 준비 | 병합된 계획 | Node.js 24·strict TypeScript, 설정·로그·health·fake adapter·진단 UI. [PR #3](https://github.com/firewine/webgpt/pull/3) 병합, [구현 기록](./implementation/wj-001.md) 및 [CI PASS](https://github.com/firewine/webgpt/actions/runs/40855909620) |
| WJ-002 | Ubuntu·Tailscale·원격 Chrome 기반 | Phase 0 | 001 | 실제 버전·실행 사용자·경로 기록, 선택 HTTPS 포트의 진단 화면, noVNC의 같은 서버 Chrome 조작. 접속 기기와 서버 수명 분리 |
| WJ-003 | GPT OAuth 계정 1개 왕복 | Phase 0 | 001, 002의 로그인 경로 | 등록·동의·모델 선택·응답 완료·후속 맥락. 로그인 성공과 실제 모델 실행 권한을 분리해 기록 |
| WJ-004 | GPT OAuth 여러 계정 격리 | Phase 0 | 003 | 계정 2개의 등록·토큰·모델·이력 분리. 전환·refresh·재시작·로그아웃이 다른 계정을 변경하지 않음 |
| WJ-005 | DeepSeek API 왕복 | Phase 0 | 001, 허가된 key·시험 예산 | 모델 선택·stream·후속 맥락·usage, 오류·중단 판정. 최소 웹 화면에서 OAuth GPT와 구분해 질문·응답 확인 |
| WJ-006 | dot·Muse 기존 대화 왕복 | Phase 0 | 001, 002 | 두 서비스 각각 요청 1회·후속 질문 2회·bridge 재연결. 기존 대화 보존·미확정 재전송 방지, 연결/응답/업무 관측과 시각·출처 |
| WJ-007 | 영속 Core·참여자 계약 | Phase 1 | 001과 연결 PoC에서 확보한 계약 | Participant·Context·Discussion·Turn·Task·Event, checkpoint·contextGeneration·활동 계약, migration·journal·lease·outbox. 맥락·공개 범위·예산·미확정 실행 보존 |
| WJ-008 | 자동 발언·상호 검토 엔진 | Phase 1 | 007 | 독립 초안 공개 조건·N인 review·다음 Task, 검증 큐의 배정·의존성·capability·예산, root 1개·활성 turn 1개 |
| WJ-009 | 근거 확인·수정·비교·종료 | Phase 1~2 | 008 | Claim·Evidence·VerificationTask·Comparison, 큐의 실제 결과·도구 활동·증거 연결, 수정안·종합 검토. 합의·미검증·부분 결과 구분 |
| WJ-010 | 공동 대화·결과 비교 웹 UI | Phase 2 | 007~009 | 주제·공동 타임라인·비교·출처, 참여자 상태 카드·검증 큐·활동/인계 내역. 관측·추정·미확인 구분, 넓고 좁은 화면 지원 |
| WJ-011 | 사용자 개입·SSE·운영 복구 | Phase 2 | 002, 007~010 | 조건 revision·Pause/Resume/Cancel, snapshot/cursor·재부팅 복구·checkpoint 인계·세대 전환. 재접속·늦은 응답·관측 중단이 중복 실행을 만들지 않음 |
| WJ-012 | 혼합 토론 실계정 MVP 검증 | Phase 2 | 002~011의 필수 항목 | GPT OAuth 2계정+DeepSeek 토론, dot·Muse를 각각 추가한 혼합 토론, 근거 검증·비교·기기 전환의 실제 증거. 대화 MVP-1 판정 |
| WJ-013 | 공식 MCP·dot 이벤트 연결 | Phase 3 | 012 | task/context/result 최소 도구, Secure MCP Tunnel 권한·왕복, 중복 이벤트 방지. Muse Connector는 별도 capability 판정 |
| WJ-014 | 기존 Codex 세션 실행기 | Phase 4A | 007, 012, 대상 세션·workspace | 세션·cwd·권한 등록, App Server/검증된 CLI, job·queue·steer·승인·단일 작성자와 복구. 화면 상태와 별개인 실제 job 활동·증거 연결 |
| WJ-015 | 토론 → Codex → 재검토 왕복 | Phase 4A | 013의 dot 도구 호출, 014 | dot 프롬프트·실행·증거 회수·같은 세션 후속 수정, 모든 참여자의 재평가와 비교 갱신. 실행 MVP-2 판정 |
| WJ-016 | 선택 Git Writer | Phase 4B | 015, 별도 Writer 착수 | 격리 workspace·sandbox·checks·draft PR. 기존 Codex와 별도의 완료 조건을 충족 |
| WJ-017 | 추가 provider·동시 실행 확대 | Phase 5 | 012, 자원·한도 실측 | Claude·Gemini·추가 API, 계정별 제한과 여러 workflow/turn. 선택 Writer를 완료할 필요 없음 |
| WJ-018 | 운영 확장·조건부 자동 병합 | Phase 6 | 관련 운영·권한·검사 조건, 별도 범위 결정 | 추가 서버 OS·프로젝트·운영 개선. 자동 병합은 현재 개발 순서의 필수 산출물이 아니며 별도 착수 전까지 비활성 |

WJ-005는 OAuth 계정 준비와 독립적으로 구현할 수 있다. WJ-006의 특정 서비스가 막혀도 GPT OAuth·API와 Core의 독립 작업은 진행한다. WJ-007의 offline 구현은 관측한 계약으로 먼저 시작할 수 있지만, 미검증 provider에 대한 실제 적합성을 주장하지 않는다. WJ-014의 로컬 세션 PoC는 WJ-013 전체 완료를 기다릴 필요가 없고, WJ-015의 dot 호출에는 실제 MCP 통로가 필요하다.

WJ-016~018은 후속 범위다. 번호가 뒤라는 이유로 선택 Git Writer나 자동 병합을 필수 의존성으로 만들지 않는다. 병렬 진행 가능한 작업을 적었다고 처음부터 다중 에이전트·다중 실행을 도입하지 않는다.

## 3. 첫 구현 묶음: 연결 가능성을 확인한다

### WJ-001 — 최소 프로젝트

완료 기록: 구현 commit `0c14dec0cdcb27319ca5f4b41a5778be6bc9bdd6`, [PR #3](https://github.com/firewine/webgpt/pull/3), main merge `8c1743ef37e3a4f398480aaf84debf6b5f22b30b`. 새 checkout 검사와 11개 Node 검사, 데스크톱/모바일 크기 브라우저 검증을 통과했다. [CI](https://github.com/firewine/webgpt/actions/runs/40855909620)에서 기본 Playwright Chromium 설치·검사도 성공했다. 실제 AI 호출·운영 서버 배포·영속 토론은 이 완료 범위에 없다.

첫 코드 PR의 범위와 완료 기준은 다음과 같다.

1. 선택한 package manager와 lockfile, Node.js 24 계열·strict TypeScript 실행 설정을 기록한다. 새 서비스·다중 package 구조는 실제 필요할 때 추가한다.
2. Core, provider adapter, HTTP/web의 모듈 경계와 최소 Participant/Turn 타입을 둔다. 전체 조직·팀·Wiki 모델은 만들지 않는다.
3. 설정 검증, 비밀 값 제외, 종료 처리와 최소 health 경로를 만든다. `.env.example`에는 placeholder만 둔다.
4. 진단 화면에서 fake participant를 선택하고 입력·관측된 응답·완료 상태를 확인한다. fake임을 화면에 명확히 표시한다.
5. 시작·빌드·검사 방법을 README에 적는다. 버전과 실행 명령은 실제 성공한 값으로 기록한다.

완료는 새 checkout에서 재현 가능한 실행과 health·진단 경로 확인이다. 대형 UI, 실제 모델 연동, DB 전체 모델, Codex 실행까지 첫 PR에 섞지 않는다. 실제 provider key 없이 개발 환경을 실행할 수 있어야 한다.

### WJ-002 — 실행 환경

대상 Ubuntu의 접속 경로, OS/architecture·Node·Chrome·Tailscale, 실행 사용자, project/state/credential 경로, 기존 포트·Serve 설정을 확인한다. 선택 포트로 WJ-001 진단 화면을 제공하고 같은 서버 Chrome의 noVNC 로그인·허용 창을 확인한다. 기존 운영 서비스를 덮어쓰지 않는다.

기기 접속에 필요한 것은 Tailscale과 지원 웹 브라우저다. 초기 포트 8443 → loopback 3000은 예시이며 실제 설정을 확인해 기록한다. OAuth 등록의 loopback callback과 원격 기기의 웹 접속을 구분한다. 서버 서비스 전체의 재부팅·재조정은 WJ-011에서 완성하되 초기 실행도 접속 브라우저 수명에 묶지 않는다.

### WJ-003~004 — OAuth를 먼저 검증한다

[참여자 연결 계획](./participant-connections.md)의 공식 OAuth 계약을 먼저 실제 계정 하나로 확인한다. 코드 작성 시점의 공식 지원과 계정 적격성·scope·모델 목록·응답 완료를 확인한 뒤 두 번째 계정을 추가한다. 인증 거절·권한 미부여·중간 stream 실패를 연결 완료로 표시하지 않는다.

한 계정 왕복이 확인되면 두 계정에 서로 다른 맥락을 입력하고 각각의 후속 질문·재접속·토큰 갱신을 확인한다. 전역 현재 계정을 바꾸는 방식으로 다른 참여자의 client ID·token·history가 섞이지 않는지 검사한다.

OAuth가 막히면 원인·계정·지원 조건을 BLOCKED로 남긴다. 사용자 요구를 API key나 일반 ChatGPT DOM 자동화로 바꾸지 않는다. 동시에 WJ-005, 준비된 browser 경로, offline Core 작업을 진행할 수 있다.

### WJ-005~006 — 같은 참여자 계약에 다른 연결을 넣는다

DeepSeek는 provider별 요청·stream 완료·usage·오류를 같은 Turn 결과로 변환한다. dot·Muse는 실제 기존 agent·대화에 연결하고 전송 receipt와 비동기 업무 완료를 확인한다. 일반 GPT OAuth 응답을 dot의 답변으로 표시하지 않는다.

WJ-006은 연결·전송·응답·업무별로 관측 시각·출처와 미확인 항목을 남긴다. 도구 내부 상태가 실제 노출되지 않으면 추측해 채우지 않는다. 화면 heartbeat와 원격 작업 진행의 분리는 fixture부터 확인하고 Codex 실제 job 관측은 WJ-014에서 확장한다.

이 단계의 최소 진단 화면은 연결별 질문·답·상태만 있으면 된다. 자동 토론·공동 비교는 다음 구현 묶음에서 제공한다. 실제 모델 호출 시험에 쓴 입력·버전·완료 근거를 비밀 없이 남기고 재현용 오류 fixture를 만든다.

## 4. 두 번째 구현 묶음: 주제 하나로 대화를 진행한다

### WJ-007 — 상태부터 저장한다

연결 PoC에서 관측한 공통/개별 계약을 정리하고 저장소 선택을 ADR로 고정한다. 계정 credential 원문과 토론 DB를 분리하고, 발언 dispatch 전후 기록·lease·단계 전이·Event를 일관되게 저장한다. DB migration·복구·선택한 adapter의 통합이 이 작업에 포함된다.

fake provider/clock/storage로 send 직전·직후 중단, 불확실한 응답, 중복 접수, 부모의 검증 대기와 자식 실행을 확인한다. 재시작해도 같은 turn을 새 호출로 만들지 않는 것이 다음 엔진 작업의 선행 조건이다.

DiscussionCheckpoint·ContextGeneration·상태 관측/ToolActivity의 최소 계약도 여기서 고정한다. checkpoint는 원문·근거·이견·남은 과제·예산·미확정 receipt/job과 기준 event cursor를 보존한다. generation과 사용자 topicRevision은 구분하고, 세대가 바뀌어도 turn idempotency는 유지한다. 독립 초안의 비공개 범위·계정 이력 격리를 인계 자료에도 적용한다. 재개·세대 전환 상태는 fixture로 확인하고 실제 adapter/UI 복구는 WJ-011에서 연결한다.

### WJ-008~009 — 토론과 검증을 연결한다

초기 구현은 참여자를 순차 호출한다. 모든 독립 초안을 확보한 뒤 같은 snapshot을 공개하고, 각 참여자에게 다른 주장에 대한 질문·반론·검증 제안을 배정한다. 지목된 후속 발언은 Core가 주제와 예산 안에서 자동 이어간다.

그다음 claim별 자료·출처·실험 결과를 연결한다. 검색·자료 조회·실행이 실제 가능한 capability일 때만 검증 작업을 수행하고, 그렇지 않으면 미실행과 이유를 기록한다. 단순 동의·같은 출처 반복·자연어 “검증 완료”는 입증 근거가 아니다.

WJ-008은 검증 과제의 의존성·우선순위·capability·권한·예산과 완료 증거 기준을 확인해 배정하는 큐를 구현한다. 같은 단일 활성 turn scheduler와 종합용 예약 예산을 적용한다. WJ-009는 실제 자료/도구 결과를 task·claim·evidence에 연결하고 선행 실패·도구 미지원·근거 부족을 구분한다. 전송 불확실을 자동 재배정하지 않으며 사용자 revision이 바뀐 대기 과제는 대조 후 갱신한다.

같은 근거를 받은 참여자가 각자 수정안을 내고, 기준별 결과 비교·합의점·이견·남은 질문을 생성한다. 진행 한도 소진·한 참여자 실패·정보 부족에도 부분 결과와 종료 이유를 남긴다. 예산·종료·revision의 상세 계약은 [능동 토론 계획](./discussion-plan.md)을 따른다.

### WJ-010~011 — 사용자가 보고 개입하는 화면

최소 진단 화면을 공동 대화 UI로 확장한다. 주제·참여자 선택, 실제 발언·검증 진행, 참여자별 초기/최종 결과와 근거를 보여준다. 사용자가 조건·자료를 추가하면 새 revision으로 반영하고 이미 실행 중인 옛 응답을 새 조건의 검증 결과로 섞지 않는다.

WJ-010은 참여자별 계정 별칭·model·담당 쟁점·현재 행동·세대·마지막 활동·차단 이유와 연결/응답/도구/업무 상태를 표시한다. 검증 큐, 실제 활동·주장/근거 연결, checkpoint 인계 내역을 같은 화면 흐름에서 확인한다. context 사용량의 측정·추정·미확인을 구분하고 실제 확보하지 못한 도구 실행을 연출하지 않는다.

WJ-011은 checkpoint 이후 event와 인계 적용 기록을 대조해 복구한다. OAuth/API 이력 압축과 dot·Muse 기존 대화 보존을 adapter별로 처리한다. 늦은 이전 세대 응답은 현재 단계·후속 발언에 자동 반영하지 않고 미확정 원격 실행은 원래 ID로 계속 추적한다. 화면 heartbeat 중단과 원격 job 진행을 별도 표시하며 새 기기 접속·같은 재개 요청·인계 중 재시작이 추가 호출을 만들지 않아야 한다.

SSE snapshot/cursor, 새 탭·다른 기기·절전 후 복구, 중복 제어, Pause/Resume/Cancel을 연결한다. noVNC는 로그인·승인·수동 개입 화면이다. 평소 토론은 공동 대화 UI에서 진행한다. 서버 서비스와 인증·연결 복구는 [Ubuntu 운영 계획](./ubuntu-operations.md)의 조건을 충족한다.

## 5. 릴리스 완료 조건

| 판정 지점 | 반드시 확인할 것 | 현재 |
| --- | --- | --- |
| 최소 프로젝트 — WJ-001 | 새 checkout 시작·빌드·기본 검사, fake 진단·반응형 브라우저 확인 | PASS / PR #3 병합 |
| 연결 PoC — Phase 0 | Ubuntu/Tailscale 접속, GPT OAuth 2계정, DeepSeek, dot·Muse 각각의 실제 왕복·맥락·복구 | NOT_RUN |
| Core — Phase 1 | 계정·맥락 격리, 영속 turn/event·checkpoint·세대, 초안 공개·예산·검증 큐, 미확정 전송·재시작 fixture | 구현·fixture PASS |
| 대화 MVP-1 — WJ-012 | 한 주제로 N인의 초안·반론·근거 확인·수정·비교·종합까지 사용자 중계 없이 진행 | NOT_RUN |
| 실행 MVP-2 — WJ-015 | 토론 검증 과제가 기존 Codex 세션으로 전달되고 실행 증거·후속 수정·참여자 재평가로 돌아옴 | NOT_RUN |

WJ-012의 실제 검증은 다음 묶음으로 수행한다.

- GPT OAuth 계정 2개와 DeepSeek 1개를 포함한 토론을 완료한다. 이후 dot·Muse를 각각 최소 한 번 실제 혼합 토론에 포함한다.
- 근거가 충분한 주제, 제공한 반례로 공통 전제를 수정해야 하는 주제, 근거 부족·의견 차이가 남는 주제를 확인한다. 특정 문구와 정확히 일치하는 답을 성공 기준으로 삼지 않는다.
- 로그인/한도·stream 중단·전송 불확실·참여자 실패·예산 종료는 fixture로 폭넓게 확인하고 필요한 실제 흐름으로 보완한다.
- 사용자 조건 추가, Pause/Resume, 브라우저 종료·다른 기기 접속·서버 재시작 후 중복 호출 없이 이어지는지 확인한다.
- 인계 중 장애·중복 재개·늦은 이전 세대 응답, checkpoint의 초안/비공개 이력 격리·이견·예산 보존을 fixture와 해당 adapter 통합으로 확인한다. 실제 context 교체가 지원되지 않는 연결은 기존 대화 보존·차단 경로를 확인하고 지원 완료로 표시하지 않는다.
- 검증 큐의 의존 순환·선행 실패·미확정 전송·한도 소진, 화면 상태와 도구 진행이 다른 상황을 확인한다. 활동 표시가 실제 task/claim/evidence와 연결되고 미관측을 성공으로 표시하지 않아야 한다.
- 데스크톱과 모바일 브라우저의 실제 조합을 기록한다. 태블릿 전용 제품으로 제한하지 않는다.

문서·단위 검사·실계정 E2E 결과를 구분한다. 필수 실제 연동이 막혀 있으면 해당 milestone은 BLOCKED 또는 NOT_RUN이며, 일부 provider만으로 성공한 결과를 전체 MVP 완료로 바꾸지 않는다. 구현 PR의 병합과 실환경 릴리스 판정도 별개다.

## 6. 세 번째 구현 묶음과 후속 확장

WJ-013에서는 공식 MCP와 dot Events를 기존 Task 계약에 붙인다. Tailscale 사용자 접속과 Secure MCP Tunnel의 dot 도구 호출은 별도 통로로 검증한다. dot Events나 Muse Connector의 미지원이 이미 구현한 browser 대화 전체를 막지 않게 한다.

WJ-014~015에서는 [Codex 세션 실행 계획](./codex-session-plan.md)에 따라 host·사용자·cwd·thread/turn을 등록하고 queue·steer·승인·단일 작성자를 구현한다. dot이 프롬프트를 만들고 결과를 읽는 왕복을 먼저 검증한 뒤, 원래 Discussion의 모든 참여자가 같은 증거로 재평가하도록 연결한다. 토론만 요청한 작업에 코드 수정 권한을 자동 부여하지 않는다.

Codex의 실제 job event·도구/검사 결과는 WJ-007/009/010의 활동·증거 계약으로 전달한다. 브라우저 관측 중단이나 대화 세대 변경으로 실행 중 job을 다시 만들지 않는다. 기존 세대의 결과도 원래 task/job·topicRevision을 대조한 뒤 evidence에 연결하고 인계/재검토 이력을 남긴다.

WJ-016은 [Git Writer 계획](./git-writer-plan.md)의 별도 sandbox·remote broker·checks·draft PR 조건을 따르는 선택 작업이다. WJ-017의 provider 확대는 이 모듈과 독립적으로 착수할 수 있다. WJ-018의 자동 병합은 현재 사용자 병합 흐름을 바꾸지 않으며 별도 요청·완료 조건이 갖춰진 뒤 다룬다.

## 7. 작업 기록과 다음 착수

### WWG 참고 검토에서 보강한 완료 조건

[개발 계획 9.3](./development-plan.md#93-wwg-사례에서-추가할-계획)과 [검토서](./reviews/wwg-plan-review-20261030.md)의 WWG-R1~R7은 기존 WJ 작업에 연결한 후속 범위다. R1의 읽기 전용 자료와 R4의 권한 조회를 [구현·검증](./implementation/local-materials-capabilities-20261030.md)했으며 R2/R3/R5/R6/R7은 미구현이다. 실계정 토론과 실파일 Codex 실행의 완료 판정은 별도다.

- 실계정 연결·토론 MVP-1을 먼저 검증한다. 읽기 자료 패키지·capability·로그 UI는 WJ-009/010/013의 독립 후속 보강으로 진행할 수 있다.
- Codex의 실제 파일 변경을 검증하기 전에는 WWG-R2/R3의 권한 회수·늦은 승인·repo 비밀 경계를 확인한다. 읽기 전용 PoC와 비교하여 실제로 추가 허용되는 범위를 명시한다.
- 최소 MVP-2에서는 기존 Task/job/활동으로 요청별 근거를 연결한다. WWG-R5의 다중 job 묶음 확대는 그 뒤이며 동시 실행 확대를 앞당기지 않는다.
- 로그 상세 정리·archive 기능을 켜기 전에는 WWG-R6의 같은 ID 재실행 금지·payload 충돌·active/미확정 보존을 검사한다. 현재 대화 DB와 기록을 정리하거나 자동 삭제하는 작업은 이번 검토에 포함하지 않는다.
- 여러 파일 쓰기·충돌 동기화는 WWG-R7/WJ-016의 선택 Writer 범위로 둔다. 일반 토론의 필수 권한으로 셸·삭제·자동 승인을 추가하지 않는다.

### 단톡방 GUI·상주 운영의 개정 순서

| P의 CHAT 작업 | 개정 연결 | 유지/수정 핵심 |
| --- | --- | --- |
| CHAT-01 | R1/R3 | control.* 개조, 운영 entry 보정, 실제 state/messages로 단톡방 구성 |
| CHAT-02 | R1/R2/R3 | RoomMessage·text JSON·인용/멘션·기존 API/SSE 재사용 |
| CHAT-03 | R2/R5/R7 | 상주 대화와 업무/위키가 같은 자원·예산을 사용하는 기본 loop |
| CHAT-04 | R2/R3 | 기존 topic을 focus로 연결, Room 수명·공개 장벽·맥락 보존 |
| CHAT-05 | R4/R6/R8 | 실제 browser/계정/세션·모바일 수락, 검증 전 UNVERIFIED |

[R1~R8](./resident-implementation-plan.md)의 각 파일/심볼·계약·모델·이관·숫자 수락·G0/단계 롤백이 실행 순서의 정본이다. 단순 GUI mock이나 토론 PASS로 전체 상주 운영을 완료 처리하지 않는다. 업무·Wiki는 누락/후속 기능으로 남기지 않으며 거대 조직 모델의 재작성도 선행시키지 않는다.

### 기록과 우선 검증

각 구현 PR에는 해결할 사용자 동작, 포함 범위, 선행 작업, 실제 검사와 결과, 남은 차단 항목을 기록한다. 계획한 산출물과 실제 생성된 commit·PR·배포 주소를 구분한다.

실행 증거에는 작업 ID, commit, 환경·버전, 사용한 참여자/계정의 비밀이 아닌 참조, 실제 입력·관측 결과·종료 상태, PASS/FAIL/NOT_RUN/BLOCKED와 이유를 남긴다. credential·로그인 화면·개인 대화 전체를 공개 저장소에 넣지 않는다. 공개 문서에는 필요한 요약과 보호된 증거 참조만 기록한다.

이번 산출물은 계획 개정이다. 후속 구현은 R1부터 진행하고 실제 계정/호스트 수락은 R8의 별도 허용·U3 선택 뒤 수행한다. 현재 실행 상태·인증 적합성은 UNVERIFIED이며 이 문서 작업에서 설치·재시작·로그인·모델 호출을 하지 않는다.

이번 [FlowDesk 사례 적용](./development-plan.md#92-flowdesk-사례에서-반영할-아이디어)은 기존 번호·선행 조건·초기 순차 실행을 유지하면서 WJ-007 이후의 인계·검증·UI 완료 기준을 보강한다. WJ-006은 확보 가능한 관측을, WJ-014는 실제 실행기 증거를 담당한다. 이번 통합 구현도 root 1개·활성 provider turn 1개 원칙을 유지한다. 후속 동시 실행 확대는 여전히 별도 범위다.
