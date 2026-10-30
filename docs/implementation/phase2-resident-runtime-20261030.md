# 페이즈 2 실행 기록 — 상주 실행과 공통 dispatch

진행 상태는 [개발 페이즈 SSOT](../development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)만 관리한다. 이 기록의 PASS는 격리 fixture 기준이며 실계정·운영 배포 완료를 뜻하지 않는다.

| 항목 | 확인 |
| --- | --- |
| 날짜 / base | 2026-10-30 KST / main 1b1aef773bea19cad74b50b1308123b36129ad48 (PR #13 사용자 병합, d0a21dc와 동일 tree) |
| 작업 브랜치 | codex/phase2-resident-runtime-20261030 |
| 코드 식별 | 이 문서와 같은 PR의 commit·CI 결과로 추적. 원 계획의 C/P 근거는 변경하지 않음 |
| 검사 환경 | Ubuntu의 임시 SQLite·로컬 HTTP·임시 Chrome 프로필, Node 24.18.0 / npm 11.16.0 |
| 실제 도구 | Chrome 156.0.8078.47 / Chrome DevTools MCP 1.12.0 |
| TypeScript·빌드·Node | 115 PASS / 0 FAIL / 0 SKIP (R1의 68개 + 신규 47개) |
| 실제 Chrome fixture | 9 PASS / 0 FAIL / 0 SKIP |
| 실제 모델·OAuth·dot/Muse 계정·실제 Codex 작업 | NOT_RUN. provider/Codex 실행 응답은 fixture |
| 운영 .env·DB·자격 증명·Chrome profile·서비스 재시작/배포 | 변경/실행하지 않음 |

## 1. 수락 결과

| Gate | 판정 | 명령·실행 증거 |
| --- | --- | --- |
| R2-A | PASS | resident-dispatch: 실제 held fixture 호출 1개에 topic/resident/work 예약 후보 100개 경쟁→동시 provider 최대1. 같은 requestId 재호출 거절, 이미 running인 lease를 해제하지 않음. 기존 topic 중 ambient 호출0. work는 예약 경계 시험이며 작업큐 구현은 아님 |
| R2-B | PASS | resident-restart: prepare commit 전/후, dispatched 후, receipt 후, delta 중, final commit 전 6곳에서 실제 자식 프로세스 SIGKILL. prepare 전은 intent/예약 rollback 후 새 attempt 1회, 이후 5곳은 unconfirmed·원래 receipt/delta/lease 유지·100 tick 재전송0 |
| R2-C | PASS | resident-room + runtime-http: 명시 fixture maxRequests=6에서 pass·형식 보완 포함 실제 호출6 이하, 이후 추가0. 요청 ledger6·usage 미제공 unknown6 보존. 보고 token30/한도20인 단일 응답은 보존하되 다음 호출0; 미래 token hard cap을 보장하지 않음 |
| R2-D | PASS | off/sleep/소진 뒤 각100 tick 추가0. 놓친 시각 뒤 100동시 tick은 평가/호출1. 사용자 입력은 휴면을 깨우되 예산 소진은 해제하지 않음. 실행 대기는 lease/사건/다음 허용 시각으로 복귀 |
| R2-E | PASS | 3참여자·topic 2검토 라운드. 첫 검토 중 room에는 초기안3개만, 둘째 라운드 중에는 앞 라운드까지6개만 공개. 종료 후 같은 roomId 복귀 event1·ledger 중복0. 활성/대조 중 job이 있으면 focus 복귀 보류 |
| R2-F | PASS | resident-replies: raw100조각 동안 메시지/주장/Wiki 적용0. 확정 후 전체 text/claims/raw digest 보존. 잘못된 JSON·구조·replyTo는 action0·보완 최대1. 다른 참여자의 20,000자 이상 발언 전체와 불확실성 전달, 목록500자 preview를 모델 입력으로 대체하지 않음 |
| R2-G | PASS | auth/usage_limit/unsupported effort/DOM identity 4fixture에서 각각100 tick 같은 요청 재시도0·이유 유지. 기존 provider/browser 검사도 유지; effort 하향/다른 계정 fallback 없음 |
| R2-H | PASS | 2소비자·100 동일 command→checkpoint/세대/event 각1. transaction 전/pack 조립 후/CAS 후 commit 전/commit 후 응답 전 실제 SIGKILL 4곳 후100 재시도→적용1. 기존 nonzero ledger/digest 보존, SQLite receipt 실패 시 모두 rollback |
| R2-I | PASS | 이전 generation의 say/work_report/wiki_edit 결과3종은 원래 raw/receipt를 stale로 보존, 현재 메시지/업무/Wiki 적용0 |
| R2-J | PASS | 미확정 actor·진행/미보고 업무·미보고/활성 job·topic focus·browser 인계 거절. 다른 actor의 허용 업무 참조만 보존, 자신의 작업으로 가져오지 않음. private draft/Wiki body 미포함 |
| Codex 전송 경계 | PASS | 기존 codex RPC fixture에서 유효 on은 turn/start1. off/expired/flag off/guard 미설치 4경계는 실제 전송 직전 거절·turn/start0. 기존 MCP→Codex→근거→수정 경로도 PASS |
| G0 fixture | PASS | focus pause + room off → feature flag off reader 쓰기 → re-enable에서 원문/ID/receipt/resident 데이터 보존·암묵적 호출0 |

검사 명령:

~~~bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/실제/별도설치/node_modules/.bin/chrome-devtools-mcp \
node --test tests/browser/*.test.mjs
~~~

Node 검사는 [room](../../tests/resident-room.test.mjs), [dispatch](../../tests/resident-dispatch.test.mjs), [replies](../../tests/resident-replies.test.mjs), [context](../../tests/resident-context.test.mjs), [restart](../../tests/resident-restart.test.mjs), [runtime HTTP](../../tests/resident-runtime-http.test.mjs), [기존 Codex 검사 확장](../../tests/codex.test.mjs)에 있다. SIGKILL 대상은 임시 DB를 쓰는 [자식 fixture](../../tests/fixtures/resident-crash.mjs)뿐이다. 실제 CodeX/계정 실행 성공으로 해석하지 않는다.

변경 문서 9개의 로컬 링크/앵커 167개 오류0, 기존 사용자 파일 35개 hash 변화0, git diff --check 오류0을 확인했다. 사용자 미추적 파일은 이 PR에 포함하지 않는다.

## 2. 변경 경계와 설계 선택

| 경계 | 유지/변경 | 근거·구현 |
| --- | --- | --- |
| Store·물리 DB·이벤트/명령 | 유지 | [Store.transact](../../src/workspace/store.ts) 재사용. 새 DB/ORM/테이블·user_version 변경 없음. prepare+lease+예산, 완료+원문+공개 projection+usage+release를 각각 같은 transaction으로 저장 |
| provider/인증/browser | 유지 | Providers.complete/CompletionInput/Hooks, OAuth·Responses·DeepSeek·BrowserBridge·vault 변경0. 실제 transport의 완료/receipt 신호와 기존 uncertain 분류 유지 |
| 공통 호출 | 신규 작은 coordinator | [dispatch.ts](../../src/workspace/dispatch.ts)의 reserve/perform/settle. 원래 engine.active만으로는 새 Room loop와의 동시 호출을 막지 못했으므로 durable lease와 전송 전 ID/입력 점유를 추가. TTL로 미확정 해제하지 않음 |
| 기존 topic | 최소 접점 | [engine.ts](../../src/workspace/engine.ts)의 prepare transaction 예약, invocation 위임, 완료 정산, busy 반환/깨우기, optional roomId 연결. 기존 2인자 create/control·6단계·parseReply·revision/generation·format retry 유지 |
| focus 입력 | additive | Discussion.roomMaterial에 공개 방 원문/ID/digest snapshot, [promptFor](../../src/workspace/prompts.ts)에 있을 때만 추가. 기존 materials 20,000자 계약을 늘리거나 본문을 조용히 자르지 않음. 전체180,000자 경계 초과는 명시 거절 |
| 상주 실행/JSON | 신규 Adapter | [ResidentRunner](../../src/workspace/resident-runner.ts), [resident-prompts](../../src/workspace/resident-prompts.ts). topic parser에 다른 envelope를 넣지 않음. [FakeResidentCompletion](../../src/workspace/resident-fake.ts)은 등록된 fake만 처리하며 실제 kind를 모의 응답으로 덮지 않음 |
| 인계 | 신규 참조 pack + CAS | [resident-context](../../src/workspace/resident-context.ts). 기대 epoch/generation·안전 경계 확인, pack/apply/세대/event/receipt 한 transaction. 추가 모델 호출0 |
| Codex queued 전송 | 최소 안전 port | [CodexExecutor.beforeDispatch/start](../../src/execution/codex.ts)에 실제 turn/start 직전 hook 추가. Workspace가 room off/flag/deadline/예약 검사를 주입하고 실행 시간은 남은 wall deadline 이하로 제한. room job에 hook이 없으면 거절. 기존 submit/approval/bwrap/RPC 계약 불변 |
| runtime/HTTP | additive | [Workspace](../../src/workspace/runtime.ts)의 DI·복구/종료/깨우기와 [owner routes](../../src/http/workspace.ts). 계정이 바뀔 때 기존 상주 history를 새 계정에 넘기지 않도록 새 participant 요구. 활성 browser turn 동안 수동 lease/connection 변경 경계 유지 |

작은 composition/DI, 명시 전이·CAS와 기존 Unit of Work를 사용했다. 공통 BaseWorkflow/ORM/새 event bus·서버를 만들지 않았다. lease 대기에서 바로 같은 pending task를 반복하지 않고 완료/대조/owner 사건 뒤에만 깨운다. 기존 MCP 도구는 방에 연결된 topic에만 상위 예산 접점을 추가하며 기존 grant 의미를 바꾸지 않았다.

## 3. 상태·발화·예산 계약

R1의 optional resident schemaVersion=1 위에 Room의 선택적 pacing/contexts/ledger/toolReservations/reason/passCount/nextMemberIndex/lastCompletedAt, ResidentTurn의 immutable participant/prompt/history/basisSequence·receipt/raw/reply/usage/repair/전송 점유, lease의 lifecycle, checkpoint/claims를 추가했다. 설정 전에는 budget=null이며 R2 별도 eager migration/과거 발언 재게시가 없다. 기존 원문/command/미지 필드는 보존한다.

`configure`는 꺼진 방의 소유자가 모든 budgets/pacing 값을 명시하는 명령이다. 누락값/무제한 기본값을 채우지 않는다. budget은 누적 예약 요청 상한·보고 token 상한·tool 예약 상한·절대 wall deadline이다. 한도 갱신은 명시 configure로 상한/기한을 바꾸는 방식이며 ledger/usage/request ID를 초기화하지 않는다. 자동 갱신/기간별 reset 정책은 U1에 남긴다.

한 요청의 예약은 pass·형식 보완·확정 실패에도 보존한다. 알려진 미전송으로 끝나도 request ID를 재사용하거나 과거 예약을 지우지 않는다. 사용량은 실제 보고분만 합산하고 null/대조 대기는 unknownUsage로 표시한다. 미제공 usage를 0원/정확한 잔여율로 바꾸지 않으며 금융 계산은 없다. 토큰 한도는 관측 소비량이 경계에 도달하면 다음 호출을 막는 방식이다.

최소 발화 간격은 완료 후부터 적용하고 idle nudge도 지정값을 사용한다. 새 공개 발언/멘션을 멤버 순환 순서로 배정하며 idle 때 전원에게 pass를 묻지 않는다. pass backoff는 지정 passBackoffMs의 배수로 증가하고 지정 sleepAfterPasses에서 휴면한다. off/소진/차단 상태는 timer 재생으로 풀지 않는다. 예산 소진은 새 메시지만으로 깨우지 않으며 명시 갱신/on이 필요하다.

ResidentReply v1은 say/pass + text/replyTo/mentions/claims/reviews/verifications/uncertainty/proposals다. raw stream은 수신 상태만 event로 알리고 완성 JSON·공개 참조 검증 뒤 text를 저장한다. text 원문 공백·raw digest와 반론/미확인을 보존한다. 방의 주장 status는 `reported`이며 topic에서 source를 관측한 기록과 주장 검증을 분리한다. 공개 topic turn의 근거는 status/digest/원문 참조만 투영해 private 자료·실행 원문을 ambient 입력에 자동 복제하지 않는다.

잘못된 확정 구조는 최대1 보완이며 별도 request ID/같은 budget을 사용한다. 미확정 전송은 보완하지 않는다. work_propose/work_report/wiki_edit와 자유 발화의 검증 제안은 저장된 제안이며 이 단계에서는 실행하지 않는다. 업무/Wiki proposalsStatus=not_run, 해당 기능은 R5~R7에 남긴다.

topic focus 중 ambient 호출은 대기한다. 기존 독립 초안·동일 검토 라운드는 모두 확정된 뒤에만 공개하고 raw owner 조회와 모델 공개 범위를 구분한다. 활성/대조 중 job이 있으면 원래 ID로 기다리며 topic의 partial 상태를 job 종료로 취급하지 않는다. 종료/부분 종료 후 같은 방으로 돌아가도 현재 예산/off/미확정 조건을 다시 검사한다.

## 4. 인계와 복구

인계는 공개 메시지 ID/전체 digest/표시된 발췌, 주장·반론/불확실성·근거 상태/참조, 목표/역할, 허용 pending 업무 참조, 명시 공개 Wiki version metadata, budget snapshot·basisCursor를 묶는다. 80,000자 초과는 selection 필요로 거절한다. 원문은 지우지 않는다. API/app-owned history만 새 generation의 참조 pack으로 전환하며 browser dot/Muse는 원래 대화를 유지한다.

같은 actor의 prepared/running/unconfirmed, 진행/미보고 work/job, topic focus 또는 browser이면 인계를 거절한다. 아직 구현되지 않은 work/Wiki 저장 공간은 보수적인 참조/차단 경계만 읽으며 R5/R7의 실제 claim/report/scope 처리라고 주장하지 않는다. 다른 actor 업무를 새 세대의 자신의 작업으로 가져오지 않는다. snapshot 예산을 현재 ledger 위에 덮어쓰지 않는다.

재시작은 resident intent/lease와 기존 topic/job 복구를 완료한 뒤 loop를 시작한다. 미확정이 남아 있으면 방을 blocked로 표시하고 원래 thread/receipt를 대조한다. 원문 대조 전 TTL 만료·새 계정·새 request ID로 자동 재전송하지 않는다. 이전 epoch/generation의 늦은 원문은 stale로 보존하며 공개 발화·업무/Wiki action0이다.

## 5. owner API와 공개 범위

기존 인증·Host/Origin·Idempotency-Key/JSON 경계를 재사용한다. /api/state와 SSE는 metadata/참조만 추가하고 새 raw prompt/response·checkpoint 본문을 포함하지 않는다. MCP grant는 owner 키 대신 사용할 수 없으며 새 resident MCP 도구는 R7 범위다.

| 요청 | 계약 |
| --- | --- |
| POST /api/rooms/:id/control | 기존 rename/set_member/off + configure/on/wake. expectedVersion 필수, 같은 key/입력은 최초 결과·다른 입력409. configure는 off/미확정 없음 필요. on은 설정/멤버/예산/대조 조건을 모두 검사 |
| configure.budgets | maxRequests 1~10,000 / maxTokens 1~100,000,000 / maxToolJobs 0~100 / 미래의 canonical ISO UTC deadlineAt. 전부 필수. 숫자는 검증 상한이며 제품 기본값이 아님 |
| configure.pacing | minIntervalMs 1~3,600,000 / idleNudgeMs·passBackoffMs 1~86,400,000 / sleepAfterPasses 1~100. 전부 필수, U2 기본값 없음 |
| POST /api/rooms/:id/focus | 기존 topic 생성 body·owner 선택 participantIds/자료/limits. 원래 root busy 검사와 같은 transaction으로 topicLink+공개 snapshot 기록. 이후 topic control API 그대로 |
| GET /api/rooms/:id/turns?after=0&limit=50 | owner용 attempt metadata·digest/상태/원문 ID. after=방 turn 목록 offset, limit1~100. raw text/history 미포함 |
| GET /api/rooms/:id/turns/:turnId | owner용 원래 prompt/history/raw/reply/receipt/usage·digest. 같은 방 ID만 허용 |
| POST /api/rooms/:id/turns/:turnId/reconcile | unconfirmed만 resolution=completed(text/receipt 필요), not_sent 또는 skip. 원래 ID의 상태/lease/receipt를 한 번만 반영. owner-confirmed로 출처 표시, 자동 resume 없음 |
| POST /api/rooms/:id/handoff | participantId/expectedEpoch/expectedGeneration 필수. 세대 CAS와 command receipt로 재시도 한 번만 적용 |
| GET /api/rooms/:id/checkpoints/:id | owner용 원래 참조 pack/digest. 같은 room만 허용 |

전역 SSE cursor, 방 메시지 sequence, 방 turn 목록 offset은 서로 다른 값이다. 기존 message 목록/전체 원문 API와 500자 preview 계약은 유지한다. owner 대조 후에는 차단 이유를 확인해 필요 시 set_member(enabled=true)로 멤버 차단을 해제하고 최신 version으로 wake/on을 명시한다. 반복 HTTP/SSE 재연결은 재전송 사유가 아니다.

## 6. 롤백·남은 검증

G0: room off와 연결 topic의 기존 pause로 새 dispatch를 막고, prepared/running/unconfirmed·live lease·queued/running/approval/reconciling job을 원래 ID로 대조한다. queued job은 실제 미전송 확인 후 취소 기록을 남기고, 외부 상태 미확정이면 이전 binary 전환을 blocked로 둔다. off가 이미 시작한 Codex job의 취소/종료라고 표시하지 않는다.

quiescent 뒤 feature flag를 false로 바꾸면 기존 토론 driver/화면을 유지하고 resident 데이터는 읽기 전용으로 보존한다. focus는 pause로 남기며 예전 running을 자동 복원하지 않는다. fixture에서 off reader의 unrelated transaction·재-enable에 원문/command/추가 데이터가 보존되고 암묵적 호출0이었다. journal/원문/credentials 삭제·백업 restore로 정상 롤백하지 않는다.

운영 U1(예산/갱신)·U2(속도/휴면)·U3(실계정/역할/쓰기 scope)는 [사용자 결정 목록](../resident-implementation-plan.md#11-사용자-결정-필요)에 남긴다. OAuth 2계정·DeepSeek·dot/Muse 혼합 방·실제 Codex·실기기/장기 부하는 UNVERIFIED/NOT_RUN이다. 실제 프로필·Tailscale/서비스/운영 데이터는 이번에 변경하지 않았다. GUI는 R3, 연결 preset은 R4, 실제 열린 큐/업무/공유 Wiki와 공식 MCP 확장은 R5~R7, 전체 실운영 수락은 R8이다.
