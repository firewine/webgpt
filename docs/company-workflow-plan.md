# 상주 방·작업큐·위키 운영 계약 — 개정 설계

> **현재 구현 지시**: [개발 페이즈 SSOT](./development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)가 순서·범위·상태의 단일 기준이다. 현재 승인 범위와 결과는 위 SSOT를 따른다. 아래 문서의 과거 “계획만/구현 금지”는 당시 개정 작업의 이력이며 현재 페이즈 지시를 대체하지 않는다.

이 파일은 지정 계획 P에 없고 현재 HEAD에만 있던 문서의 개정 산출물이다. 이전 내용을 기준으로 승계하지 않는다. [기준·판정표·제출 경계](./plan-revision-20261030.md)와 [R1~R8 변경/이관/수락/롤백](./resident-implementation-plan.md)이 우선한다. 코드 근거 C=`8f81d861b3f170ef2024b90d9eeba56ce34f0f79`. 아래 새 타입·운영 계약은 설계 기준이며 실제 구현 상태는 단계별 증거와 SSOT로 판정한다. 현재 연결·추론·DOM·새 기능의 실제 적합성은 **UNVERIFIED**다.

## 1. 최종 형태와 기존 기반

사용자는 방을 켜고 관전하거나 중간에 말한다. 참여자는 상주하며 자유롭게 논의하고, 실행 가능한 일감을 큐에 넣고, 가능한 작업자가 가져가 수행하고 결과를 같은 방에 보고한다. Wiki를 스스로 작성·갱신해 다음 발화/업무의 공유 기억으로 쓴다. 주제 토론은 방 안의 focus activity다. 목표/프로젝트를 입력해야만 방을 시작하는 구조로 만들지 않는다. GUI는 96397의 단톡방, 운영은 31803의 상주 방+작업큐+Wiki다. 지도·3D·게임 월드는 제외한다.

유지: Providers.complete/CompletionInput/Completion/Hooks, OAuth/API/browser 인증·vault, BrowserBridge.probe/complete/receipt, Store.transact/events/cursor/commands, 기존 DiscussionEngine의 6단계·세대·대조, CodexExecutor의 submit/승인/reconcile/격리, Access/Host/Origin/SSE/noVNC, Ubuntu/Serve, usage·예산. 새로운 provider/DB/서버/자격 증명 저장소를 만들지 않는다(E5/E10~E18).

“상주”는 웹쫀쿠의 Room·문맥·예약·이력 수명이다. OAuth GPT/DeepSeek는 현재 API를 호출하고 앱이 이력을 관리하며 ChatGPT 웹 대화/기억을 가져오지 않는다. browser dot/Muse만 기존 서버 Chrome의 실제 대화에 연결된다. GUI가 웹 단톡방처럼 보인다고 모든 참여자의 연결이 웹 ChatGPT로 바뀌는 것은 아니다. 이 차이는 유지 판정이며 새 연결/모델 적격성은 UNVERIFIED다.

최소 변경 예외: 기존 엔진은 다른 loop를 모르므로 전송 전 transaction에 공통 dispatch lease 접점이 필요하다(E3/E12). 새 WorkTask job에는 기존 submit API를 보존하며 실행/늦은 승인/결과 시점의 WorkScope 검사 접점을 추가해야 한다(E13/E16). Providers HTTP/auth/JSON 요청·물리 Store 스키마·기존 topic parser 변경은 채택하지 않는다. 상세는 R2/R6이다.

## 2. GUI 선택 — 기존 control.* 개조

| 안 | backend 전제 | 프론트 변경·리스크 | 결론 |
| --- | --- | --- | --- |
| A. control.html/ts/css 개조 | 기존 API·인증·SSE 유지, resident 조회/명령만 추가 | renderer/form/preserve/selectOptions 재사용, 콘솔 상세를 drawer/탭으로 이동, feature flag로 복구 | **채택** |
| B. 신규 독립 채팅 뷰/라우트 | 같은 backend 사용 가능, backend 재작성 필요 없음 | login/SSE/state 관리의 새 소비자와 이중 검사가 생김 | 이번에는 기각 |

운영 `/`는 이미 createWorkspaceServer.FILES의 control.html이다(E1 보정). diagnostic index.html은 회귀용으로 보존한다. 새 프레임워크·public/app.js 통째 이식·독립 인증/SSE를 만들지 않는다.

- 왼쪽: 기존 participant.id의 아바타/이름·계정 별칭·실제 상태·참여 토글. 4모델 고정 없음, 같은 모델의 두 계정 구분. 토글은 향후 방 발언 후보 제외이며 logout/기존 topic exclude와 다르다.
- 중앙: 실제 RoomMessage 말풍선·작성자·시각·replyTo·@멘션·읽지 않은 메시지 이동·중간 참여. 메시지에서 업무/실행/근거/Wiki로 이동한다. raw JSON/receipt와 표시 text는 별도 보존한다.
- 오른쪽: 기존 자료·사용량·실행/승인+신규 큐·보고·Wiki·topic 비교/검증. 인증·모델·수동 Chrome 폼은 설정 drawer로 이동하고 없애지 않는다.
- 390/768/1024/1440px에서 같은 기능, IME/가상 키보드·터치/키보드·장문·펼침/스크롤 확인. 기존 자산을 사용하며 외부 그림/CDN을 추가하지 않는다.

### 2.1 관측과 상태 알리미

[32669 시스템도 대조](./reviews/company-system-diagram-20261030.md)의 상태 카드는 기존 Context.observation·Workspace.snapshot·Codex 활동·capability를 **읽기 전용으로 투영**한다. 연결/응답/도구/업무 상태를 분리하고 마지막 발언·마지막 실제 진행·마지막 관측 시각도 구분한다. 채팅/SSE heartbeat만으로 job을 완료/실패/재실행하지 않는다. 유효한 최신 관측이 없으면 시각과 미확인/이전 세대를 표시하고 임의 CPU/디스크 수치·정확한 잔여율·정상 운영을 만들어 내지 않는다.

상태 알림은 기존 state/event의 변화에서 생성하는 system message이며 추가 모델 호출·별도 daemon·범용 OS 셸 polling을 요구하지 않는다. 같은 원본 event ID는 같은 알림으로 중복 제거한다. 관측 age를 표시할 수 있지만 새 상태 변화가 없는 매 tick마다 “정상” 메시지를 쌓지 않는다. owner용 전체 capability 응답을 방/참여자에게 복사하지 않고 해당 공개 범위의 상태만 사용한다. 방 off 중 기존 job 종료도 기록하되 방을 자동 on시키지 않는다.

입력은 Store/이미 확보한 조회 결과다. 카드 갱신을 위해 매 tick inspectCapabilities나 외부 연결 probe/버전 실행을 반복하지 않는다. 근거가 없는 필드는 미확인으로 남기고, 기존 소유자 수동 capability 조회 기능은 그대로 둔다.

상태 projection이 만든 system message/event는 monitor 입력과 새 발화 예약 후보에서 제외한다. 자기 알림을 새 상태 변화로 읽어 알림→발화→알림을 반복하지 않는다. 사용자가 그 알림에 직접 답장/멘션한 경우의 사용자 입력은 정상 대화로 처리한다. 실제 장애 상태가 scheduler를 차단하는 것과 알림 text가 모델 호출을 깨우는 것은 구분한다.

## 3. 제안 데이터와 이관

WorkspaceState.version=1, Store 물리 user_version=1을 유지하고 optional `resident?: ResidentStateV1`를 추가한다. 기존 discussions/tasks/jobs/participants/connections/grants/materialPackages를 재해석·삭제·재발급하지 않는다. .env/DB/credential/Chrome profile·사용자 변경을 보존한다.

| 새 타입(모두 제안) | 최소 필드·불변식 |
| --- | --- |
| ResidentStateV1 | schemaVersion=1, rooms/messages/turns/workItems/workAttempts/wikiPages/wikiVersions/jobLinks/dispatchLeases/residentGrants/contextCheckpoints. 기존 event/commands 재사용 |
| Room | id/title, desiredOn, observedStatus(off/on/sleeping/blocked/budget_exhausted), epoch, members, topicLink, budgets/used, nextEligibleAt, policyVersion |
| RoomMember/SeatAssignment | 기존 participantId, enabled, roleLabel/정책 참조·허용 업무/room action, connection/context generation 참조. 역할 정책 버전과 기존 Context.generation을 인계/명령에 고정. 거대 Company 조직 DB를 선행 요구하지 않음 |
| RoomMessage | id/roomId, sourceKind(user/room/topic/work/wiki/system)/sourceId, authorId/text, replyTo/mentions, visibility(owner_only/room_public/topic_round), revision/rawRef/evidenceRefs/createdAt |
| ResidentStatusProjection | 파생 DTO: connection/response/tool/work, lastSpeechAt/lastProgressAt/observedAt, sourceRefs/contextGeneration. 원문/비밀/owner 전체 권한을 복사하지 않음 |
| ResidentTurn | id/purpose(chat/work/review/wiki), epoch/generation, prompt/digest, prepared/running/completed/failed/unconfirmed/stale, receipt/rawText/parsedReply/usage/failure/lease 참조 |
| WorkTask | id/roomId/projectRef?, 제목/설명/sourceMessageIds, acceptance[], priority, requiredRole/allowedParticipantIds, dependencies/status/version, authorizedScopeRef, claim/attempt/result/review 참조 |
| WorkAttempt/WorkJobLink | taskVersion/claimant/seat, immutable input/digest, scopeVersion/contextGeneration/requestId, 시각, observed/reported/not_run 근거, codexJobId?. job 종료와 업무 완료 구분 |
| WorkReportV1/WorkReviewV1 | taskId/taskVersion/attemptId, summary/outputRefs/checks/blockers, 실제 execution 참조와 보고 상태. 리뷰는 reviewer/decision/reason/checks·기준 report digest를 별도 저장 |
| WikiPage/WikiVersion | room/project scope, pageId/slug/headVersion/body, sourceRefs, authoredBy/baseVersion, reported/observed/not_run, supersedes/conflict 기록 |
| DispatchLease | ownerKind(topic/resident)/ownerAttemptId, participant/connection, state/reservedBudget/revision/generation. 미확정이면 TTL만으로 재할당 금지 |
| ResidentCheckpoint | participantId, fromGeneration/toGeneration, basisCursor, 정책/목표·허용 원문/근거/Wiki-version 참조, pending 업무/미확정 참조, 예산 snapshot, reason/applied. 실제 최신 상태는 이후 event와 재대조 |
| ResidentGrant | hash(원문 token 아님), room/project/participant/tools, version/contextGeneration/expiry/revoked. 기존 state.grants의 discussion grant와 별도 저장·명시 해석 |

이관은 Room 1개를 **off**로 만들고 기존 참여자는 참조만 등록한다. 과거 토론은 read-only link로 열 수 있으나 과거 발언을 일괄 broadcast하지 않는다. 예전 task/job을 ready WorkTask로 만들지 않는다. 같은 migration ID는 no-op, 미래 resident schemaVersion은 fail closed한다.

state·event·command를 같은 Store.transact에서 기록한다. 새 mutation은 namespace requestId+payload digest로 중복 제거한다. event envelope `id/type/discussionId/at/data`·SSE `event:change`는 불변, resident event는 discussionId=null과 data.roomId/sourceId를 쓴다. cursor 리셋 없음. /api/state는 additive만 허용하고 장기 이력은 제안 cursor/page 조회 API를 사용한다.

/api/state에는 resident의 방 요약/진행·cursor·참조만 추가하고 모든 메시지·원문·Wiki 본문을 매 refresh마다 포함하지 않는다. 신규 이력/원문은 ID 기반 인증 조회와 bounded page로 분리한다. 이것이 기존 Store가 무제한 데이터에 적합하다는 보장은 아니다. state JSON 전체를 읽고 쓰는 비용(E10)은 후속 부하 fixture로 측정하며 미측정 규모는 UNVERIFIED로 남긴다. 비용을 이유로 사용자 대화·중복 방지 기록을 자동 삭제하지 않는다.

### 3.1 관리·분야 담당·실행 역할

역할 정책은 관리(목표/쟁점/큐 정리), 관리보조(중복·차단·인계 추적), 분야 담당(설계/논의·실행 가능한 업무 제안), 실행 담당(ready pickup·수행/보고), 상태 알리미(읽기 전용 상태 projection)로 구체화한다. 고정 인원·별도 모델을 자동 생성하는 조직도가 아니라 기존 participant에 적용할 **정책 예시**다. 실제 배정/허용 action은 U3에서 선택하고, 같은 계정/모델도 역할·맥락과 별개로 관리한다.

관리/분야 역할의 자연어 지시는 그 자체로 실행 권한이 아니다. 실행자는 완료 조건·scope·담당/lease를 확인한 업무를 가져가고, roleLabel이나 “상위 지시”만으로 SSH/파일 쓰기·자기 리뷰 승인을 얻지 않는다. 대화 참여를 허용한 실행자는 수다도 할 수 있으며 그림의 “지시만 수행”을 전 참여자에게 강제하지 않는다. 특정 dot/Muse를 영구 관리자/심판으로 고정하지 않는다. 상태 알리미는 별도 LLM 호출 없이 구현 가능한 부분부터 제공한다.

## 4. 상주 수명·속도·예산

`방 켜기`는 지속된 desiredOn/epoch를 바꾸는 idempotent owner command다. 탭/기기와 무관하게 선택 범위에서 예약하고 과거 발화를 재전송하거나 topic을 매번 생성하지 않는다. 최초 on에는 유효한 예산/속도 설정이 필요하며 승인되지 않은 30분/30호출을 기본값으로 저장하지 않는다.

`방 끄기`는 새 provider dispatch·ready pickup·Wiki용 모델 호출을 막는다. 이력과 수락된 입력은 남긴다. 진행 중 발언은 수신/저장 후 epoch·공개 기준을 대조한다. 시작한 Codex job은 기존 cancel/interrupt 경로로 별도 제어하고 예약 job은 실제 turn/start 전 off/scope를 검사한다. off를 원격 작업의 실제 종료라고 표시하지 않는다.

재시작: recovery→미확정 대조→desiredOn/budget/lease→후보 예약. on 의도가 있어도 미확정은 blocked, 소진은 budget_exhausted다. 놓친 타이머 수만큼 호출하지 않는다. 명시적 on/예산 갱신 없이 소진 상태를 풀지 않는다. wall deadline은 절전/정지 동안에도 경과하고 기존 discussion/job active-time 제한도 적용한다.

새 메시지/지목·ready 업무·Wiki 사건을 공정 배정하며 매 tick 전원에게 pass를 묻지 않는다. idle은 로컬 관측(호출 0), silence nudge 때 한 명만 호출하고 pass도 1요청+실제 usage로 센다. 연속 pass는 backoff/sleep. 속도는 완료 후 최소 대기이고 model/effort 변경이 아니다. 기본값은 U1/U2의 사용자 결정 필요다.

auth_required·usage_limit·reasoning 미지원·browser 목표/준비 불일치는 해당 멤버의 차단 이유로 기록하고 100 tick이어도 같은 요청을 반복하지 않는다. 미확정은 원래 attempt 대조 전 다른 계정 fallback도 금지한다. 새 허용 업무의 배정과 실패한 요청 재전송을 구분한다. eligible 후보가 없거나 lease/budget을 못 얻으면 로컬 대기 상태로 돌아가고 새 event/허용 시각에만 재평가한다. 무한 microtask/kick 재귀로 기다리지 않는다.

모든 호출은 상위 Room 예산을 사전 예약하고 실제 usage로 정산한다. topic은 기존 Discussion.used에도 자기 차원으로 기록하되 Room에는 같은 requestId를 두 번 합산하지 않는다. work/review/wiki/format repair도 같은 ledger에 포함한다. 기존 maxRequests/maxActiveMs/maxTokens/maxToolJobs/turnTimeoutMs/context 한도를 제거하지 않는다. usage=null은 unknownUsage이며 0원/정확한 잔여율로 바꾸지 않는다.

예약이 정확한 미래 token 수를 예측한다는 뜻은 아니다. request/tool 수·deadline은 사전 차단하고 maxTokens는 기존처럼 보고된 소비량을 기준으로 다음 dispatch를 막는다. 한 응답의 token overshoot나 usage 미제공 가능성을 숨기지 않으며 임의 추정으로 “금액/토큰 hard cap 보장”이라고 하지 않는다. 미제공 때도 요청/시간 hard limit을 유지하고 U1의 정책에 따른다.

### 4.1 상주 문맥 인계와 이전 세대 차단

기존 topic의 engine.control(handoff)/checkpoint·Context.generation은 그대로 둔다. 신규 resident에는 제안 resident-context adapter가 같은 원문 참조/세대/transaction 원칙으로 ResidentCheckpoint를 만들고 예상 room epoch·generation·정책 버전을 대조한 뒤 한 번만 적용한다. private DiscussionEngine.checkpoint를 fake Discussion으로 호출하거나 별도 handoff daemon을 세우지 않는다. 공통 순수 serializer 추출이 실제로 필요하면 기존 topic 출력/전이의 회귀를 먼저 보존한다.

안전한 인계는 같은 actor의 provider prepared/running/unconfirmed, 본인이 claim해 수행/보고를 마치지 않은 WorkTask/WorkAttempt, queued/running/approval/reconciling Codex job, 아직 보고되지 않은 terminal 결과가 없고 topic focus를 수행 중이지 않은 경계에서만 한다. 하나라도 있으면 인계를 보류하고 기존 ID로 대조/보고한다. 다른 actor의 허용된 대기/진행 업무는 참조만 남기며 새 세션에서 자기 실행으로 다시 가져가지 않는다.

checkpoint는 적용 규칙·목표·공개 대화/근거·해결 못한 질문·Wiki의 고정 version·대기 업무·예산/미확정 참조와 basisCursor를 보존한다. 원문은 지우지 않고 발췌는 digest/생략 여부를 표시한다. 생성/apply+generation CAS+event+idempotency를 같은 Store transaction으로 처리한다. 예산은 snapshot으로 되돌리지 않고 최신 ledger와 checkpoint 이후 event를 대조한다. 별도 요약 모델 호출이 꼭 필요하다면 일반 예산/dispatch를 써야 하며 기본 인계는 추가 모델 호출 없는 참조 묶음이다.

새 resident 호출·work/report/wiki intent·resident grant에는 **서버가 고정한 contextGeneration**을 검사한다. 이전 세대 결과는 원래 attempt에 stale로 보존하되 현재 업무 완료/새 action으로 적용하지 않는다. 재시작/등록/재접속은 checkpoint+이후 event·현재 task/job/receipt를 대조하는 것이며 새 job이나 provider 대화를 무조건 만드는 신호가 아니다. 새 resident grant에서 세대가 없거나 다르면 거절하고 기존 discussion grant의 의미는 바꾸지 않는다. token을 채팅/공유 Wiki에 전달하지 않는다.

이는 인계 **이후 늦게 도착한 미수락 결과/명령**의 검사다. 인계 전에 이미 확정 수락한 메시지·WorkReport·Wiki version을 소급 stale로 바꾸지 않는다. 유효한 저장 결과의 인용/다른 담당자 리뷰는 현재 접근 scope·taskVersion/reportDigest로 확인하며 작성자의 세대가 바뀌었다는 이유만으로 폐기하지 않는다.

API/app-owned context는 한도에 맞는 경우 history anchor를 새 generation으로 전환한다. browser dot/Muse는 원래 thread를 유지하며 자동 새 창·삭제·강제 문맥 초기화를 하지 않는다. 그림의 횟수를 제품 기본값으로 복제하지 않고 기존 180,000자 context·80,000자 checkpoint 경계에서 필요 여부를 판단한다. 안전하게 구성할 수 없으면 선택/차단으로 남기며 “기억이 모두 이전됐다”고 표시하지 않는다. 기존 정식 토론의 전체 발언 재분석/초안 공개 규칙도 유지한다.

## 5. topic은 기존 엔진을 유지한 방 안의 기능

**6단계 DiscussionEngine은 남기고 Room의 focus activity로 연결한다.** 공개 메시지/선택 자료 snapshot과 기존 participant IDs로 engine.create를 호출하고 topicLink를 저장한다. root_workflow_busy·revision·예산·활성 Discussion 1개 제약을 존중한다.

2026-10-31 승인된 [R8-A B안](./reviews/r8-topic-transition-decision-20261031.md)에 따라 owner가 off 상태 방 설정에서 `autoTopic`을 명시 허용하면 참여자의 확정 `topic_propose`도 기존 focus로 연결한다. 누락된 기존 방은 금지다. 서버가 공개 출처·actor/세대/정책/예산을 고정한 intent를 저장하고 transaction 밖에서 기존 engine.create를 호출한다. 업무/실행·미확정·다른 root가 있으면 시작을 보류하며, 생성 후 crash는 같은 command/토론 ID로 대조한다. 새 MCP 권한이나 private 자료·Codex 권한은 부여하지 않는다.

focus 중 Room은 존재하며 사용자 메시지/업무 결과/Wiki event를 수신하지만 ambient 발화는 대기한다. 독립 초안·같은 라운드 새 답은 Room projector·Wiki·인용/MCP로 다른 참여자에게 유출하지 않는다. owner 원문 보기와 모델 공개 범위는 별개다. 초안 전체 수집/닫힌 라운드 후에만 허용 내용을 room_public으로 투영한다.

종료/부분 종료 후 desiredOn·예산·미확정·epoch를 검사해 ambient로 복귀한다. 사용자 조건은 기존 engine.control revise로 공통 revision에 반영한다. 멘션이 한 참여자에게만 다른 새 사실/권한을 주는 우회 경로가 되지 않는다. pause/cancel/off가 기존 job/업무를 삭제하지 않는다.

## 6. 자유 내용의 발화와 JSON/구조화 기록

Providers.complete와 provider의 JSON instructions는 유지한다. **자유로운 text 내용과 자유 형식 transport는 다르다.** topic은 StructuredReply/parseReply/promptFor 그대로, 방/업무/위키는 별도 제안 ResidentReplyV1 validator/prompt builder를 사용한다. 새 envelope를 기존 parseReply에 넣어 format_retry를 반복시키지 않는다.

~~~json
{"version":1,"action":"say","text":"상대 말을 받아 자연스럽게 이야기하는 본문","replyTo":null,"mentions":[],"claims":[],"reviews":[],"verifications":[],"proposals":[]}
~~~

say에는 text, pass에는 빈 text/proposals. claims/reviews/verifications 의미는 유지하되 잡담마다 claim 1개를 강제하지 않는다. proposals는 work_propose/wiki_edit/work_report 같은 구조화 intent와 scope 참조다. 서버가 완성/검증/권한·현재 버전 확인 후 반영하며 text를 shell/권한/완료 지시로 실행하지 않는다.

말풍선에는 검증된 text만 표시하고 raw JSON/receipt/파싱 오류는 원본·복구에 남긴다. 첫 버전 stream은 실제 수신중 상태만 보이고 완성 envelope 검증 후 text를 확정한다. 완성 전 action 실행 0. 확정 형식 오류 보완은 최대 1회·같은 예산·새 requestId로 기록할 수 있으나 미확정 전송에는 보완/재전송하지 않는다. 실패를 성공 action/사실로 추측하지 않는다.

기존 Claim/Evidence와 방 보고는 원래 출처 ID로 연결한다. 동의/이모지/반복 Wiki 인용은 검증이 아니다. API Room context는 기존 Context.history/generation 구조로 분리하고 dot/Muse는 원래 thread를 보존한다. 180,000자 prompt+history/100,000자 응답 한도는 유지하며 초과는 checkpoint/선택/차단으로 처리한다. 조용히 최근 40개만 자르지 않는다.

## 7. 열린 업무 큐·pickup·실행·보고

모든 Issue를 바로 실행하지 않는다. sourceMessageIds·제목/설명·acceptance 1개 이상·업무 종류·허용 role/participant·scope·예산·선행 조건이 있어야 candidate→ready로 수락한다. 누락/범위 밖은 backlog/blocked와 이유를 방에 남긴다. 같은 proposalKey/requestId/원문은 한 업무로 중복 제거하고 dependency 순환·없는 참조를 거절한다.

기존 discussion Task와 별도 WorkTask: backlog→ready→claimed→running→review→done, review→rework→ready, blocked/failed/cancelled를 구분한다. done에는 산출물·수용 기준과 필요한 다른 역할의 리뷰가 필요하다. provider/Codex 완료만으로 done을 확정하지 않는다. 조사 업무는 실제 산출물·출처에 맞게 검토하며 미실행 코드를 실행했다고 하지 않는다.

pickup은 Store.transact에서 ready/version·dependency·scope·가용 참여자/계정·역할·예산/lease를 확인하고 claim+event+command 결과를 함께 기록한다. provider 동시 호출은 전체 1개, Codex는 기존 canonical workspace 단일 작성자다. 20명/3명으로 확대하지 않는다. 지목/priority·대기·공정성으로 다음 업무를 자동 배정하며 사용자 복사 중계를 요구하지 않는다. timeout만으로 다른 계정으로 넘기지 않는다.

실행은 기존 CodexExecutor.submit API를 사용한다. 가짜 Discussion을 만들지 않고 job.discussionId/taskId=null과 제안 WorkJobLink로 연결한다. requestId=`resident-work:<attemptId>` 및 전체 submit input을 intent에 고정한다. submit commit 후 link 저장 전 crash는 기존 job.requestId/binding/promptDigest로 대조해 link를 회수하고 새 job을 만들지 않는다. 승인/turnId/활동/검사/오류는 기존 executor에서 받는다.

회수/off/업무 버전을 dispatch·늦은 승인·결과 수락 직전에 검사할 최소 WorkScope 접점은 R6에 한정한다. submit 인자/반환·sandboxPolicy·approvalsReviewer·bwrap은 불변이다. 대조 불가능은 blocked. R2/R3 secret/scope gate 미완료 상태의 실제 repo 쓰기는 금지한다.

보고는 실제 job/turn/검사/artifact 참조와 observed/reported/not_run·실패/미실행 이유를 가진 RoomMessage다. off 중 종료된 결과도 저장하지만 새 연쇄 호출을 켜지 않는다. 반려는 이전 결과를 보존하고 새 attempt를 만든다. 사용자 PR merge 정책은 유지한다.

제안 보고 형식 WorkReportV1은 version/taskId/taskVersion/attemptId/summary, outputs[{ref,digest,kind}], checks[{acceptanceId,outcome,evidenceRefs}], blockers[], sourceMessageIds와 executionRef를 가진다. outcome은 observed_pass/observed_fail/reported/not_run/unknown을 구분한다. actor·job/binding/thread/turn·command/test exit 상태·관측 시각은 서버 journal에서 연결하고 모델이 제공한 문자열로 관측 사실을 덮어쓰지 않는다. 근거 없는 필드는 unknown/not_run이며 누락을 성공으로 채우지 않는다.

WorkReviewV1은 reportDigest·reviewerId·decision(accept/rework/blocked)·acceptance별 판정/근거·reason을 고정한다. reviewer와 작성자가 다르고 현재 버전/권한/수용 기준이 충족돼야 done으로 전이한다. 다른 리뷰어가 없으면 review 대기로 남긴다. 모델의 reported_pass·자기 승인·반려 후 과거 report 재사용이 완료 게이트를 우회하지 못한다. 보고 원문/요약 메시지와 상태·event·command 결과는 동일 transaction으로 한 번만 저장한다.

## 8. Wiki 저장·자동 편집·충돌·인용

앱 private SQLite의 resident.wikiPages/wikiVersions에 저장하며 repo /wiki를 자동 쓰거나 파일 권한을 요구하지 않는다. owner와 허용된 참여자는 자기 room/project에 wiki_edit를 제출한다. scope·sourceRefs·baseVersion·크기를 검사해 `reported` 버전을 자동 게시하므로 편집마다 인간 승인을 요구하지 않는다. 검토/도구 근거가 있어야 관측/검증 상태를 올리며 AI가 verified라고 썼다고 승격하지 않는다.

expectedVersion CAS: 같은 head의 편집 2건은 정확히 1건만 채택, 다른 1건은 409+충돌 제안으로 보존한다. 덮어쓰기/무제한 모델 재시도 없음. 필요한 조정은 큐 또는 사용자 diff 처리다. 삭제/정정은 tombstone/대체 이력, 과거 인용은 원래 version을 유지한다.

발화/업무에는 허용 Wiki의 pageId/version/digest/sourceRefs를 context snapshot으로 넣고 결과에 같은 참조를 인용한다. 비공개 초안을 Wiki로 유출하지 않는다. 현재 담당/차단/실행 상태는 큐와 job journal이 권위이며 Wiki는 장기 지식이다. 개인 provider 기억을 공유 Wiki로 가져오거나 Wiki 본문을 시스템 권한으로 쓰지 않는다. 한도 초과는 명시적 선택/차단이다.

표시는 기존 textContent 원칙을 사용하고 Wiki의 script/HTML·javascript 링크·외부 파일/도구 명령을 실행하지 않는다. URL을 적었다는 사실은 source 관측이 아니며 실제 출처 조회가 필요하면 기존 fetchSource·allowlist/SSRF 경계를 사용한다. 새 Wiki 작성자가 로컬 파일/네트워크 권한을 얻지 않는다.

## 9. 도구·경계·미결정

owner 키/세션·provider credential·MCP grant는 구분한다. 기존 /mcp 도구/토론 grant 의미는 불변, R7의 resident 도구는 room/project/participant·tools·version 범위를 추가한다. Core/owner API가 운영을 수행하므로 Events/Connector는 선행 조건이 아니다. 금융 계산은 범위 밖이다.

사용자 결정 필요 U1~U3와 그 전의 fail-closed 동작은 [단계별 계획](./resident-implementation-plan.md#11-사용자-결정-필요)에 둔다. fixture 숫자는 product 기본값 승인이 아니다. 최종 도달은 R1~R8의 gate가 모두 채워져야 판정하며 단계별 결과는 SSOT를 따른다. 실계정/DOM 적합성은 검증 전까지 UNVERIFIED다.
