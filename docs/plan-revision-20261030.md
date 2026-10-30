# 계획 개정 — 1쪽 요약과 기준·근거

> **문서 발행 승인 — 2026-10-30:** 사용자가 개발 계획 업데이트 전체의 commit/push를 승인했다. 이 승인으로 계획 문서 11개를 현재 작업 브랜치에 커밋·푸시한다. 아래 정적 검토 단계의 Git 금지·HEAD 불변 기록은 당시 이력이며 이 발행 단계와 구분한다. 고정 코드 C/계획 P의 근거는 바꾸지 않는다. 코드 구현·실행, 새 PR 생성·병합, 배포·로그인·모델 호출은 승인 범위에 포함하지 않는다.

## 1. 1쪽 요약

**기준 차이부터 고정한다.** 코드 C=main **8f81d861b3f170ef2024b90d9eeba56ce34f0f79**, 계획 P=**8db0f42f499f674c66c3a0df0a4d8e0f25fb216e**, 시작 HEAD=**5699bedad7421e51edaafe909205ee34680d5179**. HEAD는 P 이후 문서 변경만 추가됐고 runtime은 C와 diff 0이다. P의 git object를 개정 base로 사용했다. 후속 README/회사 우선·수다 후순위 주장을 근거로 승계하지 않으며 reset/checkout하지 않았다.

**목표:** 기존 backend 위 상주 단톡방. 자유 논의→업무 제안/큐 pickup·수행/방 보고→Wiki 자동 갱신·재사용. 주제 토론은 방 안의 focus mode. 사용자 관전/중간 참여, 3열 GUI, 지도·3D·게임 제외.

**판정 104건: 유지 55 / 수정 45 / 기각 4.** PR #12 변경44·Living v0.8 관련28·기존 개발16·토론8·실행순서8을 [판정표](./reviews/plan-decision-register-20261030.md)에 출처·이유·코드 근거로 대응했다.

**8단계:** R1 데이터/이관 → R2 공통 dispatch·상주/focus → R3 control.* 개조 → R4 연결 UX → R5 열린 큐 → R6 기존 Codex/보고·리뷰 → R7 Wiki/MCP → R8 수락. [각 단계](./resident-implementation-plan.md)에 실제/제안 파일·심볼, 유지/변경 계약, 모델/이관, 숫자·명령/화면/로그 gate와 rollback을 기재했다. 새 구현/수락은 전부 NOT_RUN이다.

**결론:** control.* 개조. Providers.complete·Store·인증/adapter·승인/격리·기존 API/SSE 재사용. JSON text envelope, additive Room/WorkTask/Wiki, 기존 6단계 focus 보존, private DB Wiki/CAS·reported 자동 게시. backend 재작성 금지. [디자인 패턴 지침](./development-guidelines.md)은 작은 Adapter/DI·명시 전이·기존 transaction·Coordinator/CAS의 이득을 계약/검사/롤백으로 입증하도록 한다.

**32669 추가 대조:** [시스템도 8항목](./reviews/company-system-diagram-20261030.md)에서 역할·문맥 인계/fencing·상태 알림만 보완했다. 원래 104판정·8단계는 유지, 미래 수락 gate는 **50개**다. 별도 daemon/SSH 도구·그림/마을은 도입하지 않는다.

**가장 큰 리스크 3개:**

1. topic/room/work의 중복 dispatch·쓰기 → R2 공통 lease·6 crash gate와 R6/G0 drain.
2. 늦은 승인/결과·초안/Wiki의 권한/사실 승격 → R6 scope·R7 공개/CAS/보고 구분.
3. 실제 DOM·계정·장기 예산/문맥 불일치 → R4 probe·R8 실제 gate. 확인 전 UNVERIFIED.

**E1 보정:** 운영 /는 이미 main→createWorkspaceServer.FILES의 control.html. diagnostic index.html을 운영 entry로 오인해 교체하지 않는다. **사용자 결정 필요:** U1 예산/갱신, U2 속도/휴면, U3 실제 멤버/업무 scope. 값 없는 새 방은 off, 미승인 숫자를 기본값으로 채우지 않는다.

**이번 제출은 문서만.** src/build/test/서비스/로그인/모델/commit/push/PR/merge/deploy 실행 없음. 금융 계산 제외. 무조건 runtime 성공을 보장하는 대신 목표→판정→단계→수락을 추적해 하나라도 미충족이면 완료 판정을 거절한다.

---

## 2. 코드 근거 E1~E18

모든 경로·라인·심볼은 C의 `git show <C>:<path>`에서 확인했다. 같은 내용의 working tree를 실행한 것이 아니다. line 범위는 C에서만 유효하다. 아래의 “확인”은 코드/문서의 존재·정적 동작이며 실제 환경 결과는 UNVERIFIED다.

| ID | C의 파일·위치·심볼 | 확인/보정 | 개정 영향 |
| --- | --- | --- | --- |
| E1 | `package.json:14` start, `src/main.ts:1–23` main, `src/http/workspace.ts:12/60–66` FILES/route; 대조 `src/http/app.ts:11–15/49` createApp | **보정:** 운영 루트는 control.html. diagnostic index.html을 제공하는 createApp은 별도 진단/회귀 경로 | 기존 control을 개조, 운영 router/로그인 재생성 없음 |
| E2 | `src/web/control.html:21–40/43–62`, `control.ts::render/renderDiscussion/renderTimeline/renderConnections/renderJobs` | 토의 폼·단계/탭·연결/실행 콘솔. main의 control.ts 314줄 | GUI 구조는 실제 이 파일들을 기준으로 산정 |
| E3 | `src/workspace/engine.ts:38–87` create, `187–238` loop, `251–323` turn, `329–373` advance/schedule | 6단계·활성 Discussion 1개, engine.active는 인스턴스 잠금. Room loop를 모름 | topic 엔진 유지+공통 실행 조정 접점 |
| E4 | `src/workspace/prompts.ts:4–31/40–64` parseReply/promptFor, `engine.ts:302–312` format_retry | JSON·claims/reviews/verifications·초안/라운드 장벽, 확정 오류의 제한 보완 | 별도 resident JSON validator와 text projection |
| E5 | `src/connections/providers.ts:10–13/17–105` Completion/CompletionInput/Hooks/models/complete; `model.ts:1–28` kind/Member/Context | fake/openai-oauth/deepseek/browser. GPT는 models/Responses HTTP, 앱 history·store:false. DeepSeek stream도 별도 완료 신호 필요 | complete 인터페이스/transport/auth 유지. GUI의 웹 방≠기존 ChatGPT 웹 대화 import |
| E6 | `src/web/control.html:53–56` browser-form, `runtime.ts:84–113` addBrowser, `connections/browser.ts:51–105/118–158` inspect/probe/complete/validateBinding/sendScript | 필수 CSS는 identity/input/send/user/assistant/busy/ready **7개**, 식별 문구·optional thread CSS/attribute도 수동. 자동 탐지 없음. send guard는 이미 구현 | 탐지/preset은 UX 보조, 기존 identity/thread/draft/ready/receipt 유지 |
| E7 | `src/workspace/model.ts:51–56/70–104` Task/Discussion/CodexJob/WorkspaceState; `http/mcp.ts::call` task_get | Task는 discussion 단계/검증 과제, job은 실행 기록. 열린 WorkTask/Room 모델 없음 | 별도 additive WorkTask·claim/상태 제안, 기존 타입 의미 유지 |
| E8 | C의 `git grep -n -i -E 'wiki|worktask|resident' <C> -- src`, `model.ts::WorkspaceState` | Wiki 저장/편집/버전 경로 없음. Living Design §16은 목표 문서 | 새 private DB Wiki 계층 제안 |
| E9 | P의 git diff 및 `docs/reviews/chatroom-ui-review-20261030.md:1–77` | 신규 GUI/자율 대화는 있으나 queue/wiki의 구현 단계 없음, 공유 메모 후속 | 104판정과 R5/R7로 누락 보완 |
| E10 | `src/workspace/store.ts:17–54/56–93` Store constructor/read/transact/events | user_version=1, state JSON·events·commands, BEGIN IMMEDIATE, payload digest·중복 결과, runtime.lock | 같은 물리 Store/원자적 transaction 재사용, 새 테이블/DB 불필요 |
| E11 | `src/http/workspace.ts:14–103/156–164` createWorkspaceServer/route/command/body, `src/http/access.ts::Access`, `runtime.ts:23–56/149` Workspace | owner/Host/Origin·SSE cursor·256,000바이트 body·서비스 시작/종료 | route/snapshot additive, 기존 인증/SSE/크기 경계 유지 |
| E12 | `engine.ts:21–36/89–176/251–323/387` recover/control/checkpoint/turn/unresolved; `browser.ts:61–94` complete | prepared 전 기록→dispatch/receipt/delta→확정, 재시작 미확정·revision/generation 대조, browser marker/re-send 방지 | 새 turn도 같은 절차, 임의 timeout 재전송/lease 해제 금지 |
| E13 | `src/execution/codex.ts:24–113/119–145/177–260` recover/register/submit/kick/start/connectOnce/completeFromTurn/decide/cancel/reconcile | 기존 binding/namespace·untrusted/user approval·단일 writer. submit은 optional discussionId, queued recover는 kick. WorkScope는 모름 | submit 계약 유지+side link, work의 dispatch/늦은 승인/결과 검사만 추가, 롤백 전 drain 필수 |
| E14 | `engine.ts:66–70/191–204/260–290/296–299` budgets, `providers.ts:53–57/105` usagePair, `settings.ts::reasoningEffort`, `config.ts:42` timeout | 기존 수/시간/token/tool/context/응답 한도·실제 usage·기본 xhigh. Room 예산 기본값은 없음 | 기존 cap 제거 금지, 상위 예약/정산·user decision 필요 |
| E15 | `src/workspace/materials.ts::LocalMaterials/verify/materialMetadata`, `connections/sources.ts::fetchSource`, `engine.ts::checkpoint` | read-only 자료 snapshot·raw digest·보호 경로/SSRF·원문 참조/보고 상태 | 자료 가져오기 재구현 없음, Wiki와 구분하고 근거 재사용 |
| E16 | `src/http/mcp.ts:7–31/handle/call` TOOLS/createGrant/grant, `execution/codex.ts::decide` | discussion/participant/tools/revoked grant·해시 구분. 일반 expiry/scope 세대와 work 권한은 미구현 | 기존 grant 유지·새 명시 resident scope, R2/R3 미완료를 완료로 숨기지 않음 |
| E17 | `runtime.ts::snapshot/participant/addBrowser/browserControl`, `workspace/capabilities.ts::inspectCapabilities` | 실제 연결/model/effort 편집과 policy/관측 조회가 존재 | 좌측 멤버·오른쪽 상태/기존 설정 재사용 |
| E18 | C의 `tests/engine,providers,persistence,restart,workspace-http,codex,oauth,materials,capabilities.test.mjs` 및 `tests/browser/*.test.mjs`, `scripts/ops.mjs:18–55` | 회귀 fixture/backup/doctor/service 경로가 존재. 이번 실행 결과는 없음 | 미래 검사 재사용·확장, 기존 PASS≠새 기능 완료 |

E1의 diagnostic 파일 존재와 운영 entry 경로는 다른 사실이다. E6의 약 10개라는 UX 지적은 유효하나 필수 selector 수와 추가 식별 필드를 나눠 적었다. E7/E8은 일부 백엔드가 부족하다는 근거이며 이미 상세한 연결/저장/실행 backend를 전면 교체할 근거가 아니다.

## 3. 기준 차이의 보정 방법

| 비교 | 확인 | 적용 |
| --- | --- | --- |
| C→P | 계획 5파일만 변경, runtime 변화 0 | P의 다섯 문서를 개정 base로 사용 |
| P→시작 HEAD | README 수정, company-workflow-plan 신설, 계획 5파일 후속 수정 | 후속 주장을 baseline으로 상속하지 않음. README는 이번 대상에서 제외/불변 |
| C→시작 HEAD runtime | src/scripts/tests/package/lock/.github/.env.example diff 0 | 코드 근거는 그래도 C git object로 읽음. 나중 HEAD를 임의 기준으로 변경하지 않음 |
| 본 개정 | 계획 파일만 working tree 수정 | 새 commit/branch/PR 없이 로컬 산출물로 제출. 후속 HEAD의 company 문서는 출력 설계로 재개정 |

재현 가능한 읽기 전용 확인 명령:

~~~bash
git rev-parse HEAD
git diff --name-status 8f81d861b3f170ef2024b90d9eeba56ce34f0f79 8db0f42f499f674c66c3a0df0a4d8e0f25fb216e
git diff --name-status 8db0f42f499f674c66c3a0df0a4d8e0f25fb216e HEAD
git diff --name-only 8f81d861b3f170ef2024b90d9eeba56ce34f0f79 HEAD -- src scripts tests package.json package-lock.json .github .env.example
git show 8f81d861b3f170ef2024b90d9eeba56ce34f0f79:src/main.ts
~~~

## 4. 외부 자료와 파일별 출처

X1=`Moris-kr/ai-chatroom@817c165b92ce42f5a96504198a346b936d3e2f38`. 공개 tree와 대조한 README/LICENSE/server/index/style/app/prompt/router/members **9파일의 Git blob hash가 고정 tree와 일치**했다. 정적 내용만 읽었고 외부 설치/프로그램/CLI/웹 서비스를 실행하지 않았다.

| X 근거·원본 파일 | 확인된 범위 | 실제 도입 계획/라이선스 |
| --- | --- | --- |
| X1 `public/index.html:15–133`·style.css | 멤버·power·chat·jump·보조 패널/반응형 GUI | 레이아웃 요구만 참고, 코드 복사 예정 파일 0 |
| X1 `public/app.js::buildQuote/addMessage/renderMembers/renderTyping` | 인용·ID·상태·읽음/새 메시지 렌더 | 기존 control renderer로 자체 구현, 원본 통째 이식 없음 |
| X1 `server.mjs:31–50/116–153/391–509` | maxInFlight=3·최근40개·speed/spark·pass/휴면 | 숫자/동시성/CLI 루프 복제 기각, 우리 안전장치와 사용자 값 사용 |
| X1 `lib/prompt.mjs::formatMessage/buildTurn`·router.mjs::Router.decide·members.mjs | 공개 대화/호칭·boost·고정 멤버 | 문맥 아이디어만 참고, 모델/effort 자동 변경·멤버 고정 없음 |
| X3 `LICENSE` | MIT License·copyright 고지 존재 | 현재 복사 0. 아래 추적 규칙 적용 |
| X2 디시 31803 본문·첨부4장 | queue 도입/pickup·Wiki 운영이라는 작성자 보고 | 운영 목표의 참고. 외부 시스템 구현·처리량/실행 성공은 UNVERIFIED |
| X1 디시 96397 본문·첨부2장 | 첫 장은 단톡방, 둘째는 제외할 건축 월드 | GUI 기준만 사용, 이미지 파일은 복사하지 않음 |
| X4 디시 32669 본문·첨부6장, 2026-08-15 게시 | 관리/분야/실행 역할·세션 인계·상태 알림과 기존 변천 화면 | [보완 대조](./reviews/company-system-diagram-20261030.md). 외부 실제 구현/프로토콜은 UNVERIFIED, backend 재사용·기존 GUI 유지 |

후속 구현 중 실제 코드를 복사한다면 **파일마다** `원본 repo/고정 SHA/path/blob → 대상 path → 복사/수정 범위 → MIT copyright/license notice 위치`를 제안 `docs/third-party-code.md`와 대상 파일 header에 기록하고 제안 `LICENSES/ai-chatroom-MIT.txt`에 고지를 보존한다. 이 파일들은 아직 없다. 라이선스 고지가 필요한 복사 파일이 생기면 고지 없는 도입을 수락하지 않는다. 캐릭터/아바타·로고·사진·스티커 등 외부 자산은 MIT 코드 고지 유무와 무관하게 **복사하지 않는다**. repository의 라이선스 표시만으로 제3자 그림 권리를 추정하지 않는다.

## 5. 문서 묶음의 역할과 최신 우선순위

1. 이 문서: 먼저 읽는 1쪽 요약·기준·코드/출처 근거·변경 경계.
2. [판정표](./reviews/plan-decision-register-20261030.md): P 변경 전부와 관련 기존 항목의 104판정.
3. [운영 계약](./company-workflow-plan.md): GUI/발화/상주/큐/Wiki의 결정된 설계.
4. [단계별 계획](./resident-implementation-plan.md): R1~R8의 실제 파일/심볼·계약·모델·이관·수락·rollback, U1~U3.
5. 기존 [개발 계획](./development-plan.md)·[토론 계획](./discussion-plan.md)·[실행 순서](./implementation-sequence.md)·[Living Design](./webjjoku_living_design.md)·[GUI 검토](./reviews/chatroom-ui-review-20261030.md): P를 base로 유지/수정/기각을 반영한 개정 본문. 과거 운영/검사 보고는 이력이며 새 수락 증거가 아니다.
6. [디자인 패턴 개발 지침](./development-guidelines.md): 사용자 추가 요청. R1~R8의 패턴/계약/검사/롤백 기록 기준이며 backend 재작성 권한을 만들지 않음.

충돌하면 현재 사용자 확정 목표→이 개정의 근거/판정→운영 계약/단계→과거 설명 순서다. 결정하지 않은 default/실계정 대상은 U표에 남기며 임의 승인을 만들지 않는다. 같은 내용을 여러 문서에서 다른 숫자/순서로 다시 정의하지 않는다.

## 6. 직전 104항목 개정의 정적 검증 기록

2026-10-30 이 작업에서만 수행한 결과: 로컬 링크/앵커 132개 오류 0, 판정 ID 104개 중복/누락 0(유지55·수정45·기각4), R단계 8개·수락 gate 43개. 외부 고정 source 9파일 blob 일치. 기존 사용자 파일 35개 hash 변화 0. 시작 HEAD 5699bedad7421e51edaafe909205ee34680d5179와 staging 상태 불변, runtime의 C 대비 diff 0을 확인했다. 수정/신규 산출물은 위 계획 문서 10개뿐이다.

이 결과는 문서/참조/작업 경계의 static 검사다. build/test·애플리케이션/외부 서비스·로그인·모델/실제 job·CI·배포는 실행하지 않았고, 새 기능 R1~R8의 실행 수락 증거는 아직 없다. 현재 작업에서 commit/push/PR 생성·편집·병합도 하지 않았다. 이후 gate를 실제 실행할 때는 해당 코드 commit·fixture/실계정 구분·사용자 허용 범위와 결과를 따로 기록한다.

## 7. 32669 추가 대조의 정적 검증 기록

2026-10-30 추가 자료를 대조해 기존 문서 5개를 필요한 부분만 보완하고 검토서 1개를 추가했다. 원래 104판정은 불변, 참고 보완 판정 F01~F08은 유지2·수정3·기각3이다. R단계는 8개 그대로, 미래 수락 gate는 50개다. 현재 계획 묶음 11문서의 로컬 링크/앵커 137개 오류0, 기존 사용자 파일 35개 hash 변화0, HEAD/staging/runtime 불변을 확인했다. 새 문서 작성/정적 검토만 수행했으며 코드/서비스/실계정/모델·runtime test·commit/push/PR/배포는 수행하지 않았다.
