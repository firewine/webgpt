# 상주 운영 단계별 변경·이관·수락·롤백

> **현재 구현 지시**: [개발 페이즈 SSOT](./development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)가 순서·범위·상태의 단일 기준이다. 2026-10-30 페이즈 2 구현/검증을 승인받았다. 아래 문서의 과거 “계획만/구현 금지”는 당시 개정 작업의 이력이며 현재 페이즈 지시를 대체하지 않는다.

설계 근거 C와 계획 P는 [개정 요약](./plan-revision-20261030.md)으로 고정한다. 구현 순서·상태는 맨 위 링크의 SSOT를 따른다. R1/R2는 아래 계약으로 구현하고 [R1 증거](./implementation/phase1-resident-foundation-20261030.md)·[R2 증거](./implementation/phase2-resident-runtime-20261030.md)를 남겼다. R3~R8의 새 타입·파일·심볼·endpoint·검사는 아직 **제안**이다. 기존 파일/심볼의 E 근거표는 C 기준이며 실계정/DOM/운영 호스트 적합성은 UNVERIFIED다.

## 1. 공통 변경·검증 원칙

- 후속 개발에는 [디자인 패턴 지침](./development-guidelines.md)을 함께 적용한다. 단계별 기존 계약·최소 변경·경쟁/장애 증거·롤백이 먼저이며 패턴을 이유로 backend를 다시 만들지 않는다.
- Backend 재사용 기본값: Providers.complete 입출력/Hooks, Store.transact와 물리 테이블, 기존 Discussion/Task/CodexJob·6단계 parser/복구, OAuth/API/browser, 승인/격리/원격 운영은 유지한다. “구조가 깔끔하다”는 이유의 재작성은 금지한다.
- 실제 frontend는 createWorkspaceServer.FILES의 control.*다. legacy diagnostic은 루트 교체 대상으로 삼지 않는다(E1).
- 공통 future 검사: `npm run check`와 필요한 개별 fixture/browser 검사. 새 `tests/resident-*.test.mjs`와 browser 파일은 모두 제안이다. 개별 node 검사는 후속 `npm run build` 뒤 실행한다. baseline의 기존 테스트를 삭제·완화해 통과시키지 않는다. 이번 static 검토는 그 검사 결과를 주장하지 않는다.
- 증거 파일(제안): `test-results/resident/RN/<case>.json`에는 코드 commit·fixture/실계정 구분·입력 ID·event cursor·상태/횟수·차단 이유만 남긴다. 비밀·개인 원문은 공개 로그에 넣지 않는다. 미래 실환경 검사는 별도 허용·로그인 완료 후 수행한다.
- Feature flag(제안) `WJ_RESIDENT_ENABLED`는 새 운영층만 제어한다. off에서 기존 인증/API/토론/자료/실행은 그대로다. 제품 방 on/off와 배포 flag는 다르다. flag 추가에 실제 .env 덮어쓰기를 계획하지 않는다.

## 2. 공통 롤백 G0 — 모든 단계의 선행 조건

새 room 예약/픽업을 멈추고 관련 topic의 새 dispatch도 기존 pause로 막는다. 진행 중/미확정 provider turn과 Codex job을 원래 ID로 대조한다. 새 기능에 속한 queued job은 실제 미전송임을 확인하고 취소 기록을 남긴다. 이미 전송했거나 승인/대조 대기이면 임의 lease 해제·예전 binary 재시작을 하지 않고 롤백을 blocked로 둔다. 특히 기존 Codex.recover는 queued job을 다시 kick하므로 “flag만 off”를 안전한 롤백이라고 하지 않는다(E13).

quiescent 증거: 관련 prepared/running/unconfirmed turn=0, 실행/승인/reconciling job=0, 재시작할 legacy 토론의 무단 재개 후보=0. 그 뒤 flag off/이전 UI·reader로 되돌린다. 새 optional resident 데이터·journal·commands·request ID·원문은 지우지 않는다. 기존 state JSON reader는 미지 필드를 보존하지만 실제 이관 fixture에서 확인해야 한다(E10). 정상 롤백을 DB snapshot restore로 수행하지 않는다. 이미 실행한 결과/idempotency가 사라질 수 있기 때문이다. 초기 migration 실패는 transaction rollback으로 끝내고, 재해 복구는 별도의 원격 receipt/후속 journal 대조 절차로 다룬다.

## 3. R1 — 기존 Store 위에 방·메시지·참조 이관

**대상:** 기존 `src/workspace/model.ts::WorkspaceState`, `runtime.ts::Workspace.constructor/snapshot`, `config.ts::WorkspaceConfig/loadWorkspaceConfig`, `src/http/workspace.ts::createWorkspaceServer.route`. 신규 `src/workspace/resident-model.ts`와 `resident-store.ts::readResident/migrateResident/ResidentStore`를 구현했다. initialState/start/close와 Store의 read/transact/events/cursor 코드는 유지한다.

**계약:** 유지=기존 JSON/테이블/commands/event envelope·HTTP 인증·기존 endpoint. 변경=optional resident 필드와 기본 false인 `WJ_RESIDENT_ENABLED`, additive snapshot, 인증된 방/메시지 조회·사용자 메시지 저장·설정 제어 API만 추가한다. 구 endpoint 필드 삭제/의미 변경 0건. 모델 호출은 없으며 `on`은 409 `resident_dispatch_not_available`로 거절한다. 요청·응답·크기/원문/공개 범위 계약은 [R1 실행 기록](./implementation/phase1-resident-foundation-20261030.md)에 명시한다.

**데이터/이관:** ResidentStateV1/Room/RoomMember/RoomMessage/ResidentTurn/DispatchLease 골격, contextCheckpoints 빈 배열, schemaVersion=1, room off·이력 비공개 import 없음. 기존 3종 fixture(기본 v1, materials 포함 v1, 미확정 turn/job 포함 v1)를 현재 state/user_version=1 그대로 읽는다. 과거 토론/task/job은 원본과 link만 보존한다.

이관은 `resident:migration:v1` command receipt를 저장하며 event를 발행하지 않는다. 이로써 기존 cursor를 보존한다. 이후 사용자 명령은 기존 Store transaction으로 state·event·receipt를 함께 저장한다. 방 참여자는 모두 disabled, budget/다음 발화 시각은 null이며 미정 사용자 값을 대신 채우지 않는다. 나머지 미래 컬렉션은 빈 저장 공간이며 업무·Wiki 구현 완료를 뜻하지 않는다.

| 수락 ID | 숫자·증거 | 검증 방법 |
| --- | --- | --- |
| R1-A | 3종 fixture의 legacy ID/내용 digest·event cursor·command 결과 100% 동일 | `tests/resident-store.test.mjs` before/after·재시작: PASS |
| R1-B | fixture마다 migration 100회→Room 1개, 추가 모델 호출/legacy event 재발행 0 | 같은 fixture·migration receipt 1개: PASS |
| R1-C | 메시지/제어 mutation key 각각 20회→각 결과/새 event 1개, payload 변경→409 | `tests/resident-http.test.mjs` HTTP+SQLite journal: PASS |
| R1-D | 인증 없음/잘못된 Host/Origin→기존 401/403, 새 endpoint 우회 0 | 기존 workspace-http+resident-http: PASS |

**롤백:** 이 단계는 provider/job 호출 0이다. flag off 후 기존 snapshot/화면으로 복귀하고 resident 필드는 보존한다. migration 오류는 transaction 전체 rollback, 기존 3 fixture digest가 같아야 한다. 미래 schemaVersion은 자동 초기화하지 않고 명시 거절한다.

## 4. R2 — 공통 dispatch와 상주 발화·topic focus

**대상:** 기존 `engine.ts::DiscussionEngine.turn/recover/control/create/loop`, `runtime.ts::Workspace.start/close`, `model.ts::Context/DiscussionTurn`. 제안 `dispatch.ts::DispatchCoordinator/performCompletion/classifyFailure`, `resident-runner.ts::ResidentRunner`, `resident-prompts.ts::parseResidentReply/promptForRoom`, `resident-fake.ts::FakeResidentCompletion`, `resident-context.ts::prepareCheckpoint/rotateResidentContext`. 실제 `Providers.complete`·`BrowserBridge.complete`는 변경하지 않는다.

**구현 대응:** 위 신규 모듈을 실제 추가했다. provider 전송은 `DispatchCoordinator.perform`의 전송 전 ID/lease 점유와 private `performCompletion`을 통과한다. Room 설정/메시지 저장은 기존 ResidentStore, topic은 기존 Engine을 사용한다. `CodexExecutor.beforeDispatch` 한 접점을 추가한 이유는 대기 job의 실제 전송 때 off/flag/deadline/예약 한도를 다시 확인하기 위해서다. submit/승인/격리 계약은 유지했다. 이는 R6의 새 업무 scope/늦은 승인/결과 검사를 대신하지 않는다. 세부 API·데이터·수락 결과는 [R2 실행 기록](./implementation/phase2-resident-runtime-20261030.md)에 있다.

**최소 backend 변경 사유(E3/E12):** 기존 engine.active는 그 엔진만의 메모리 잠금이라 별도 Room loop와 병행하면 2호출이 가능하다. 기존 turn의 전송 전 Store transaction에 공통 lease/budget 예약을 넣고, 기존 `turn`의 provider invocation/Hooks 구간만 제안 performCompletion으로 얇게 추출한다. 기존 prepare/update/최종 state·event·receipt·format_retry·불확실 분류 결과는 동일하게 유지한다. 새로운 조건을 기존 advance/schedule/parseReply로 섞지 않는다. coordinator만 provider 호출권을 부여한다.

lease를 얻지 못했을 때 기존 loop가 같은 pending task를 즉시 반복하지 않도록, private turn의 waiting 결과와 두 호출 지점의 return/wakeup 접점도 최소 변경 범위에 포함한다. lease 해제/기존 진행 callback에서만 다시 kick하며 명시 대기 없이 while/microtask를 반복하지 않는다. 이는 private 제어 흐름 보강이고 public create/control·Providers 인터페이스·저장되는 legacy turn 결과는 유지한다.

**계약/모델:** 유지=CompletionInput/Completion/Hooks/signals와 기존 6단계/revision/generation/JSON. 추가=ResidentReplyV1, room 전용 attempt/context/ledger/lease·desiredOn·epoch·nextEligibleAt·focus link. adapter가 fixture fake만 기존/제안 모의 응답을 구분해 처리하며 real 응답을 fixture로 대체하지 않는다. invalid JSON은 action 0, 보완 최대 1회도 예약/usage에 포함한다.

**이관:** 기존 running/미확정 상태를 먼저 recover하고 새 루프는 그 상태가 대조되기 전 dispatch하지 않는다. 방 on/off는 영속 명령, 모드 전환은 확정 경계. focus에는 기존 engine.create/control을 사용하고 Room은 계속 존재한다. 예산 값은 U1/U2 확정 전 임의 채우지 않고 on을 막는다. 검사는 명시 fixture budget으로 진행한다.

**32669 보완:** 기존 topic handoff API는 그대로이며 resident만 원문 참조·규칙/목표·pending 업무·Wiki version·예산 snapshot·basisCursor를 갖는 ResidentCheckpoint를 추가한다. 인계는 예상 epoch/generation의 CAS이고 현재 actor의 미확정/진행/미보고 업무·job 또는 topic focus가 있으면 보류한다. browser 원래 대화는 자동 교체하지 않는다. generation이 바뀐 뒤 옛 actor의 결과/action은 stale로 보존하며 신규 실행에 재사용하지 않는다. checkpoint snapshot으로 최신 예산/상태를 되돌리지 않는다. 추가 모델 호출 없는 참조 묶음이 기본이다.

| 수락 ID | 숫자·증거 | 방법·실행 결과(R2 fixture) |
| --- | --- | --- |
| R2-A | Room/topic/work 후보 100개 경쟁→전체 provider 최대 동시 1, 중복 requestId dispatch 0 | PASS · `tests/resident-dispatch.test.mjs` (work는 예약 후보만, 실제 큐는 R5) |
| R2-B | prepared 전/후·dispatched 후·receipt 후·delta 중·final commit 전 6지점 crash→재전송 0 | PASS · `tests/resident-restart.test.mjs`의 실제 SIGKILL/journal/원래 ID 대조 |
| R2-C | fixture maxRequests=6 소진 뒤 추가 호출 0, pass/보완 포함 6 이하, unknown usage를 0원으로 표시 0 | PASS · `tests/resident-room.test.mjs`와 runtime-http 자동 loop |
| R2-D | off/sleep/budget_exhausted 뒤 100 tick→호출 0; missed timer 100개→추가 후보 평가 최대 1 | PASS · room/restart fixture, 놓친 timer를 호출 횟수로 변환하지 않음 |
| R2-E | 3참여자 topic 2라운드에서 기존 공개 장벽 유지, focus 종료→같은 roomId 복귀 1회 | PASS · dispatch fixture+기존 engine 회귀 |
| R2-F | raw stream 100조각/잘못된 구조/없는 replyTo→검증 전 action 0; 확정 text/claims/원문 digest 보존 | PASS · `tests/resident-replies.test.mjs` |
| R2-G | 인증/429 한도/미지원 effort/DOM 불일치 4종에서 100 tick 동안 같은 요청 재시도 0·차단 이유 유지 | PASS · room fixture+기존 providers/browser 회귀 |
| R2-H | 2소비자/100인계 요청과 4crash 지점→세대 증가/적용 각1·중복 provider/job0·예산 초기화0 | PASS · context/restart fixture·실제 SIGKILL 4지점·SQLite rollback |
| R2-I | 이전 generation의 say/work_report/wiki_edit 3종→현재 상태/action 적용0·기존 attempt 원문 보존 | PASS · replies fixture. 업무/Wiki는 아직 미실행 제안 |
| R2-J | 미확정 turn·진행/미보고 work/job·topic focus·browser 경계에서 자동 세대/창 교체0 | PASS · context fixture+기존 engine handoff 회귀 |

**롤백:** G0 후 flag off, 기존 토론 driver 경로로 복귀한다. 연결된 topic은 기존 pause 상태로 두고 예전 running으로 자동 복원하지 않는다. resident ledger/turn/lease·원문은 보존하며 미확정이면 rollback blocked다. 기존 driver 회귀에 차이가 있으면 R2 수락 실패이며 다음 단계로 가지 않는다.

## 5. R3 — control.* 단톡방 개조

**대상:** 기존 `src/web/control.html`의 composer/sidebar/views/forms, `control.ts::api/connect/refresh/render/renderTimeline/renderConnections/renderJobs/preserve`, `control.css`. 기존 `src/http/workspace.ts::FILES/route`와 모든 legacy API는 유지. 필요한 제안 client helper `src/web/room-view.ts`는 같은 빌드/문서 안에 한정한다.

**계약/데이터:** backend 재작성 0, 기존 login/session·state·events 사용, R1/R2의 새 메시지 endpoint 소비와 로컬 읽기 cursor/펼침/테마 상태만 추가한다. 왼쪽 멤버·중앙 말풍선·오른쪽 자료/usage/jobs/topic, 방 on/off·사용자 입력·reply/mention을 연결한다. advanced 연결·승인·대조·소유자 로그아웃 UI를 없애지 않는다. raw JSON은 원본 패널, bubble은 text다.

32669의 상태 알리미는 기존 Observation/capability/job 이벤트를 제안 `src/workspace/resident-status.ts::projectResidentStatus` 순수 함수와 `ResidentStatusProjection` DTO로 투영한다. API와 system message가 같은 공개 필터를 사용하므로 작게 공유하며 새 서비스/모델/OS 셸 polling은 없다. 연결/응답/도구/업무·마지막 발언/진행/관측을 구분하고 이전 generation/미관측을 표시한다. 새 관측 근거 없는 상태 실패·정상 수치나 전체 owner capability의 방 공개는 하지 않는다.

**이관:** 기존 토의 기록은 history와 topic link에서 계속 열며 과거 내용을 일괄 공개 메시지로 변환하지 않는다. 기존 localStorage selection 키를 삭제하지 않고 신규 view state는 namespace를 분리한다. 아바타는 자체/사용자 제공·기존 이니셜로 시작하고 외부 자산을 복사하지 않는다.

| 수락 ID | 숫자·증거 | 방법(후속 실행) |
| --- | --- | --- |
| R3-A | 390/768/1024/1440px 4종에서 가로 overflow 0, 입력·멘션·패널·승인·복구 기능 접근 가능 | 제안 `node --test tests/browser/resident-room.test.mjs`·화면 4장 |
| R3-B | envelope 포함 기존 100,000자 한도 내 90,000자 본문 접기/펼치기·digest 동일, replyTo/scroll/unread 유지 | browser DOM+상태 snapshot |
| R3-C | 이벤트 20개 재생+2회 재접속→메시지 20개, provider 추가 호출 0 | browser+server fixture 카운터 |
| R3-D | 기존 토론·연결/계정·자료·Codex 승인·미확정 화면 회귀 전부 유지 | 기존 browser 검사+제안 room 검사; SKIP은 PASS 아님 |
| R3-E | IME 조합중 Enter 전송 0, 확정 입력 1회, 터치/키보드로 hover 기능 접근 | 자동 DOM event fixture+실제 기기 수동 화면 검사(UNVERIFIED) |
| R3-F | 응답대기/도구진행/관측중단/이전세대 4fixture의 실제 상태·시각 보존, event20회 재생 알림1·자기 알림100회 재투입 추가알림/모델/셸 호출0 | 제안 resident-status fixture+browser 카드/알림 검사 |

**롤백:** G0 필요 없는 순수 view rollback이면 기존 control renderer를 선택하고 같은 Room/API/이력은 유지한다. server R2까지 내리면 G0도 적용한다. 새 localStorage keys·읽기 cursor와 메시지는 지우지 않으며 예전 SSE를 두 개 동시에 연결하지 않는다.

## 6. R4 — browser 연결의 자동 탐지/프리셋

**대상:** 기존 `connections/browser.ts::BrowserBridge.pages/snapshot/tool/inspect/probe`와 export 함수 `validateBinding`, `runtime.ts::Workspace.addBrowser/assertNoActiveTurn`, `control.html::browser-form`·`control.ts` 갱신 UI. 제안 `connections/browser-discovery.ts::discoverBinding/validatePreset`와 `src/connections/browser-presets/*.json`. 실제 provider별 preset 내용은 UNVERIFIED다.

**계약:** 유지=BrowserBinding의 URL/계정/agent/thread·selector·draft/busy/ready·marker/receipt 검증, send 직전 재검사, noVNC 수동 lease. 추가=허용된 열린 페이지에서 read-only DOM 후보 수집→동일 origin/thread·프로필 선택→기존 probe 통과→binding 저장 경로. normal 사용자는 페이지/대화/계정 확인만 하고 CSS 입력은 advanced fallback으로 둔다. 탐지·probe는 전송 0회이며 등록된 identity/thread 변경을 허용하지 않는다.

**데이터/이관:** 선택적으로 binding에 presetVersion·discoveryObservedAt·확인 근거 참조를 additive로 저장한다. 기존 수동 binding은 그대로 사용 가능하다. pageId만 바뀌면 URL/identity/thread를 다시 확인하고 갱신하며 불명확한 후보를 임의 선택하지 않는다. selector 업데이트와 인증 변경은 다르다.

| 수락 ID | 숫자·증거 | 방법(후속 실행) |
| --- | --- | --- |
| R4-A | 2서비스×정상/구버전DOM/다중후보/thread변경/기존초안 10종 fixture에서 전송 0·목표 불명확 자동저장 0 | 제안 `tests/browser-discovery.test.mjs`·DOM fixture(모두 제안) |
| R4-B | 정상 후보→기존 probe→binding 저장, advanced 선택자 필수 입력 0개 | browser 온보딩 화면/기존 API fixture |
| R4-C | account/thread 불일치·draft·busy에서 실제 send 0, 기존 selector/receipt 회귀 통과 | 기존 bridge 검사+제안 discovery 검사 |
| R4-D | 실제 dot/Muse 각 1개 기존 대화에서 profile/identity/thread·왕복 확인 | 후속 사용자 허용된 계정·화면·receipt 기록, 현재 UNVERIFIED |

**롤백:** discovery UI/preset 비활성, 기존 수동 폼과 이미 검증된 binding으로 돌아간다. 이전 selector 버전도 보존하고 probe 실패 시 자동 입력만 차단한다. Chrome/profile/원래 대화/작성 중 초안을 초기화하지 않는다.

## 7. R5 — 실제 열린 업무 큐와 참여자 pickup

**대상:** 기존 `model.ts::WorkspaceState/Member/Task`는 의미 유지, `runtime.ts::Workspace`와 owner `http/workspace.ts::route`에 제안 서비스 결합. 제안 `work-queue.ts::proposeWork/claimReady/submitWork/reviewWork`, `resident-model.ts::WorkTask/WorkAttempt/SeatAssignment`. 기존 discussion Task를 개명/대체하지 않는다.

**계약:** 유지=Store transaction/commands, 공통 provider1, 기존 complete·계정/model/role label·owner 정책. 추가=실행 가능 candidate의 ready 승격·dependency·priority·허용 역할/참여자·source message·scope·가용 slot·expectedVersion을 검사하는 pull/claim. owner/AI가 같은 명령 서비스를 사용하고 입력 경로 차이로 권한이 바뀌지 않는다. 복잡한 회사 조직도·새 provider를 선행 요구하지 않는다.

**데이터/이관:** WorkTask 0개로 시작, 과거 이슈/발언/Task/CodexJob를 일감으로 승격하지 않는다. 원문 참조·acceptance·role/participant·scope 없는 제안은 backlog/blocked, dependency 순환 거절. 결과/리뷰/재작업 이력은 append로 보존한다. 논의 중 일감 생성은 방의 budget과 같은 scope를 따른다.

32669의 관리·관리보조·분야 담당·실행·상태 알리미는 RoomMember의 **정책 예시**로 구체화한다. roleLabel 문자열이 권한을 만들지 않으며 server가 허용 action/업무 종류·정책 버전을 검사한다. U3 선택 없이 새 모델/고정 인원을 만들지 않는다. 인계 때 role/정책과 context generation을 고정하고 원래 task/attempt/receipt를 재사용한다.

| 수락 ID | 숫자·증거 | 방법(후속 실행) |
| --- | --- | --- |
| R5-A | ready 업무 1개에 2소비자/100동시 HTTP claim→정확히 1claim·1lease | 제안 `node --test tests/resident-work-queue.test.mjs`+Store journal |
| R5-B | 같은 proposal 20회→업무 1개; acceptance 없음·없는 source/dep·순환·권한 밖은 ready 0 | 제안 work fixture |
| R5-C | 3개 업무 중 1개 dependency blocked이면 나머지 허용 ready 2개 처리 가능, 동일 slot 중복 0 | fake scheduler 로그 |
| R5-D | claim 후 재시작·timeout·멤버 off에서 새 attempt 무단 생성 0 | crash/state fixture |
| R5-E | 다른 제출자 리뷰 없이는 done 0, 반려 1회→기존 결과 유지·새 attempt 1개 | 제안 result/review fixture |
| R5-F | 5역할 정책 예시에서 각각 scope 밖 명령1종→수락0, “상위 지시”/역할 문구만으로 권한 확대0·자기 승인0 | 제안 role/WorkTask 정책 fixture |

**롤백:** G0 후 신규 pickup/업무 도구를 차단하고 큐를 read-only로 둔다. claimed/running을 무조건 ready로 돌리지 않으며 기존 topic Task/CodexJob와 분리해 보존한다. 신규 엔티티/command 결과를 삭제하지 않는다.

## 8. R6 — 기존 Codex 실행·보고·승인·결과 수락 연결

**대상:** 기존 `execution/codex.ts::CodexExecutor.submit/kick/start/decide/completeFromTurn/reconcile`, `runtime.ts` 진행 callback·`http/workspace.ts` 승인/취소 경로. 제안 `work-execution.ts::WorkExecutionBridge/WorkScopeGuard`·`WorkJobLink`. 기존 submit 시그니처/반환 jobId·기존 job 상태·RPC와 sandbox 옵션은 유지한다.

**최소 변경 이유:** 현재 executor의 scope 검사는 discussionId가 있을 때 discussion에 결합된다. work job은 null discussionId로 기존 submit을 쓰고 side link를 둔다. 따라서 실제 start/늦은 approval/결과 수락 직전의 scope/room epoch/task version 검사 접점만 불가피하다(E13). 기존 경로는 동작 동일한 default guard, 신규 work 경로는 mapping/권한이 없으면 fail closed다. 기존 command/user approval·단일 writer·App Server 계약·bwrap을 재구현/완화하지 않는다.

**데이터/이관:** submit 전 immutable intent·stable requestId를 저장하고 job 생성 후 link한다. 중간 crash는 requestId+binding+promptDigest로 기존 job만 회수한다. 새 업무에 이미 존재하는 Codex job을 임의 연결하지 않는다. 종료 결과는 원래 attempt에 보관하고 stale/폐기 scope는 상위 업무·Wiki의 현재 결과로 수락하지 않는다. report는 RoomMessage로 한 번만 투영한다.

| 수락 ID | 숫자·증거 | 방법(후속 실행) |
| --- | --- | --- |
| R6-A | intent 전/후·submit 뒤·link 뒤·승인 대기·완료 뒤 6crash 지점에서 turn/start ≤1·보고 1개 | 기존 codex-rpc fixture+제안 `tests/resident-work-execution.test.mjs` |
| R6-B | off/권한 회수/task version 변경 3종×queued/늦은 승인/늦은 결과 3시점에서 scope 밖 실행/업무 done 0 | RPC mock의 호출/응답 로그 |
| R6-C | 같은 workspace 2업무의 동시 writer 최대1, 다른 입력의 같은 ID→409 | 기존 codex 검사+제안 연결 검사 |
| R6-D | 실제 scope 경계(R2/R3)·repo secret/link/output 가림 gate가 FAIL/UNVERIFIED면 실제 쓰기 호출 0 | 제안 격리 fixture·허용 호스트 정적/실행 검사 기록 |
| R6-E | completed 응답이 있어도 command/test 근거 없으면 observed execution 0, 리뷰 없는 done 0 | fake 결과/독립 리뷰 로그 |
| R6-F | 설치 schema·읽기 전용→승인→작은 작업 브랜치 수정→보고/반려/후속 흐름 | 후속 허용된 `npm run test:codex-contract`·실세션 receipt/검사 로그. 이번 NOT_RUN |

**롤백:** G0가 필수다. queued work job은 명시적으로 미전송 취소를 기록하고 running/blocked_approval/reconciling은 대조 전 이전 binary로 내리지 않는다. link/intent/receipt·scope 폐기 이력을 보존한다. 기존 단독 job/토론 job은 바꾸지 않는다. 실패를 sandbox 해제/전역 승인으로 우회하지 않는다.

## 9. R7 — 참여자 Wiki와 같은 서비스의 scoped MCP 투영

**대상:** 기존 `Store.transact`·`Workspace.snapshot`, `http/workspace.ts::route`, `http/mcp.ts::McpEndpoint.createGrant/grant/handle/call`의 기존 분기·도구/키 의미 유지. 제안 `wiki.ts::editWiki/getWiki/contextWiki`, `resident-mcp.ts::residentTools`, `WikiPage/WikiVersion`. 신규 room/work/wiki API와 `resident_*` MCP 도구는 제안이다.

**계약:** 유지=private DB·원문/근거 구분·owner auth·기존 discussion tools/grant/token·SSE envelope. 추가=room/project/participant·도구·scopeVersion/expiry에 한정한 별도 resident grant와 Wiki CAS. 같은 /mcp에서 새 명시 scope를 발급받은 경우만 새 도구를 노출한다. 오래된 grant를 자동 확대하지 않는다. 새 grant와 업무 dispatch/승인/결과 수락 시 현재 scope를 다시 검사한다. 일반 grant·binding 수명 보강은 R2/R3의 별도 미완료 사실을 숨기지 않는다.

**데이터/이관:** Wiki와 residentGrants는 빈 배열에서 시작하고 기존 state.grants·자료/checkpoint/개인 기억을 자동 이식하지 않는다. 신규 token은 hash와 room/participant/tools/version/expiry/revoked로 별도 저장하고 /mcp의 명시 해석 분기로 처리한다. 참여자는 sourceRefs·expectedVersion으로 보고 버전을 자동 작성하고 사용자는 같은 API로 편집한다. actor·검토/보고 상태·과거 version/digest를 보존하며 현재 task 상태의 권위는 큐다. 충돌은 제안으로 남긴다. Wiki 인용 snapshot은 토론/room의 공개 범위와 context 한도를 적용한다.

새 resident grant/intent는 contextGeneration도 확인한다. 새 actor 등록/재접속/인계 후 옛 generation 또는 세대 필드 없는 신규 형식 grant를 허용하지 않는다. 인계 후 필요한 새 grant는 같은 승인 scope의 정규 발급 경로를 쓰고 권한을 넓히거나 token을 방에 노출하지 않는다. 과거 resident fixture에 세대가 빠진 grant는 폐기 상태로 보존하며 기존 discussion grant를 이 규칙으로 재해석하지 않는다.

| 수락 ID | 숫자·증거 | 방법(후속 실행) |
| --- | --- | --- |
| R7-A | 사용자/AI 같은 baseVersion 2편집→1개 채택·1개 409, 원문/과거 인용 digest 동일 | 제안 `node --test tests/resident-wiki.test.mjs` |
| R7-B | 같은 edit/report ID 20회→Wiki version/방 알림 각각1; reported를 verified로 자칭해도 승격0 | Wiki/Room journal fixture |
| R7-C | 비공개 초안·타 방 자료·타 계정 context·폐기 grant의 조회/편집/claim/action 수락0 | 제안 `tests/resident-mcp.test.mjs`+기존 workspace-http scope 검사 |
| R7-D | 다음 2발언/업무가 동일 pinned page/version/digest/sourceRefs 인용, 이후 수정으로 과거 입력 변경0 | context snapshot/입출력 fixture |
| R7-E | 기존 도구 목록/응답/토론 grant 권한 변화0, 추가 grant 없이는 resident 도구0 | /mcp tools/list/call 호환 fixture |
| R7-F | Wiki HTML/script/javascript링크·비공개/임의 URL 참조 4종에서 코드 실행/권한 확대/보호 URL fetch 0 | 제안 browser Wiki 렌더+기존 source 경계 fixture |
| R7-G | 옛 세대/세대 누락 2종×room 발화/work claim/wiki edit 3도구→수락0, 기존 discussion grant 응답 변화0 | 제안 resident-grant 세대 검사·기존 MCP 회귀 |

**롤백:** 신규 grant 회수·resident 도구/편집/모델 예약 차단 후 G0. Wiki·버전·tombstone·출처·충돌은 read-only로 남기고 delete/폴더 덮어쓰기/old backup restore하지 않는다. 기존 /mcp owner/토론 기능은 그대로 제공한다.

## 10. R8 — 최종 형태 수락과 한계

**대상:** 기존 tests/engine·providers·persistence·restart·workspace-http·codex·browser 검사 보존. 제안 `tests/resident-e2e.test.mjs`, `tests/browser/resident-e2e.test.mjs`, `docs/implementation/resident-acceptance.md`. 제품 코드 변경은 앞 단계의 검증된 결합만 허용한다.

**계약/모델/이관:** API/schema 추가 변경 없음. R1 fixture로부터 R7까지 이관한 상태와 기존 main v1 데이터를 각각 검사한다. 8 gate의 숫자 증거를 연결한다. 실제 계정/호스트 수락은 사용자 직접 인증·별도 허용 후 수행하며 이번 문서 작업에서 시도하지 않는다.

| 수락 ID | 숫자·증거 | 방법(후속 실행) |
| --- | --- | --- |
| R8-A | 3모의 참여자·1방 on→사용자 추가 지시 없이 자유 대화→업무1 pickup→결과/반려1회→재작업/완료→Wiki1갱신→다음 발화 인용→topic1회→같은 방 복귀 | 제안 e2e의 message/task/job/wiki ID 연결 로그 |
| R8-B | 8단계별 crash/off/budget/scope negative gate 전부 PASS, provider 동시≤1·중복 외부 start0·비공개 유출0 | fixture 및 기존 회귀 검사·수락 manifest |
| R8-C | 4viewport·2탭·새로고침/재접속 후 이력·읽기 위치·예산/승인·단일dispatch 유지 | browser 검사·화면·카운터 |
| R8-D | 실제 GPT2계정+DeepSeek, dot/Muse 각각 기존 thread 포함 흐름. 실제 읽기 Codex와 허용된 쓰기 gate 별도 | 사용자 허용 뒤 receipt/카탈로그·stream/usage·검사·화면 기록. 현재 전부 UNVERIFIED |
| R8-E | G0→flag off/legacy 화면 복귀→다시 resident on에서 기존/새 원문·commands/receipt 누락0·재전송0 | rollback/re-enable fixture 로그 |
| R8-F | 1,000메시지/100업무/100Wiki fixture에서 /api/state 새 raw 본문 노출0·history limit=50 초과0·본문 원문 누락0, state transaction 비용 측정값 기록 | 제안 부하 fixture·응답 크기/시간/heap 로그. 실제 장기 호스트 규모는 UNVERIFIED |
| R8-G | ready/review 업무·Wiki·규칙·예산 actor 인계1회+중복 등록2회 뒤 원래 ID/예산 보존·확정 report의 다른 담당자 리뷰 가능, task/job 재전송0·새 scope 확대0 | 제안 resident 인계 e2e·checkpoint/cursor/lease 로그 |

**롤백:** 앞 단계별 G0를 조합한다. 부분 PASS로 실계정/쓰기/Wiki/상주 전체 완료를 표시하지 않는다. 실패 기능만 off/read-only/blocked로 남기고 기존 연결·토론·기록을 보존한다. 남은 UNVERIFIED와 사용자 결정은 릴리스 차단 조건으로 기록한다.

## 11. 사용자 결정 필요

| ID | 아직 확정되지 않은 것 | 결정 전 동작/선행 개발 | 바꾸지 않는 경계 |
| --- | --- | --- | --- |
| U1 | 방 기본 wall 시간·요청 수·token/tool 예산, 장기 운영 시 갱신 방식 | 입력 UI/검증/ledger는 구현 가능. 값 없는 신규 방은 off, 기존 토론 한도 유지. 검사는 명시 fixture 숫자 사용 | 무제한 기본값·한도 제거·자동 금액 추정 없음 |
| U2 | 느긋/보통/활발 간격·idle nudge 시각·연속 pass/backoff/sleep 값 | 설정 가능한 scheduler 구현. PR #12의 5/15/45·120·3은 미승인 제안으로만 보존. 기본값 확정 전 자동 on 금지 | provider1·xhigh·pass 비용·미확정 대조 유지 |
| U3 | 최초 운영 방에 참여할 실제 계정/대화와 업무 role/scope·코드 수정 허용 범위 | 이미 등록한 identity/thread/권한은 보존. 새 계정/역할/쓰기 권한을 임의 생성하지 않고 owner 선택을 기다림. fixture는 독립 진행 | 로그인·API 키·프로필·쓰기 승인·실계정 호출은 이번 금지 |

기술 결론(control.* 개조, 기존 topic 엔진 유지, Providers/Store 재사용, JSON text envelope, Wiki private DB/CAS·보고 버전 자동 게시, 단일 provider 슬롯)은 본 개정에서 내렸다. 이를 사용자에게 다시 결정하라고 떠넘기지 않는다. 아바타 제작·스티커·새 provider·병렬 용량 확대·범용 파일 쓰기·자동 merge는 확정 목표의 필수 수락 범위가 아니다.
