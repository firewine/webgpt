# 공식 dot D3 — 원래 발언·mailbox·복구 결합

2026-11-02 KST. PR #38 병합 뒤 다음 단계 개발과 **연결 권한·발언 세대 분리**를 사용자가 승인했다. 기준 main `672f08114aea25b7fe59a914f98ac0355b3205be`, 브랜치 `codex/dot-mcp-integration-d3-20261102`. [SSOT](../development-plan.md)·[승인 계약과 수락 기준](../reviews/dot-official-mcp-events-impact-20261101.md#53-답변단일-실행복구)을 따른다.

**D3 구현·격리 검사 PASS.** 기존 상주/주제/업무 실행기가 예약한 dot 차례에만 이벤트를 보내고, 수신 답변을 원래 검증·공개·대조 경로에 연결했다. **운영 배포·실제 dot 연결/모델 호출·Muse 전송·Codex 실행은 NOT_RUN.** D4의 연결 UI·private plugin 설정과 D5의 실제 혼합 수락은 남아 있다.

## 파일·계약·디자인 패턴

| 파일·심볼 | 변경 및 기존 계약 |
| --- | --- |
| `src/connections/dot-mcp.ts::DotMcpAdapter` | 신규 Adapter. `Providers.complete(CompletionInput): Promise<Completion>`을 유지하면서 원래 요청의 고정 입력·claim·mailbox 대기·receipt를 연결. browser/API fallback 없음 |
| `src/workspace/dot-mcp-policy.ts` | 신규 순수 정책 함수. `dotParticipantWait`, `dotRequestCurrent`, `dotCanApply`, `reconcileDotReply`, `validateDotRequests`로 연결 준비와 원래 발언의 적용 조건을 분리 |
| `workspace/dot-mcp.ts::checkAuthority/check/snapshot/cleanup` | 현재 identity·owner 확인·grant version/만료/회수·허용 도구·Vault를 검사. 정상 on/focus의 epoch 증가는 연결을 회수하지 않음. 기존 `check`는 D1/D2 이력의 엄격한 세대 검사로 유지. 삭제 시 claim credential도 정리 |
| `workspace/dot-mcp-model.ts`, `dot-mcp.ts::readDotState` | optional `dotMcp.requests.version=1`과 고정 입력/claim/mailbox, outbox `settled` 추가. 기존 Store transaction/event/idempotency·SQLite·Vault 계약 유지 |
| `workspace/runtime.ts`, `connections/providers.ts`, `workspace/dispatch.ts` | 기존 Composition Root와 단일 dispatch에 Adapter 주입. 원래 turn/lease를 저장한 같은 transaction에서 `prepareDot`; 원래 정산에서 `settle`. 별도 작업 실행기/DB/프레임워크 없음 |
| `workspace/engine.ts::create/loop/turn/control` | 방에 연결된 dot만 주제에 참여. 구독 없는 dot을 기다리는 동안 같은 단계의 준비된 다른 초안 진행. 라운드 공개 장벽 유지. 마지막 수락/소유자 대조 전 현재 요청 범위 재검사 |
| `workspace/resident-runner.ts::loop/accept/reconcile` | 상주 발언과 기존 업무 attempt 모두 원래 예약/공개 경로 사용. 미확정 원래 lease가 새 전송을 차단하며, 시간 초과를 연결/업무 권한 회수로 오인하지 않음 |
| `http/mcp-events.ts::handle/assertTurn/pump`, `http/mcp.ts` | dot grant에 세 도구만 공개. 고정 요청의 범위·기존 업무 권한을 전송 직전 재검사. D2의 callback 검증·서명·공개 IP 검사·유한 재시도·복구 보류 재사용 |
| `workspace/api-usage.ts`, `work-policy.ts`, `wiki-policy.ts`, `resident-context.ts` | dot 준비 상태/연결 권한의 최소 소비 접점. API 전용 일일 한도, 역할·seat·scope·독립 검토·Wiki CAS 유지. native 기억을 초기화했다고 주장하는 context handoff는 거절 |

Adapter/Composition, 순수 정책, 명시적 상태 전이, 원래 transaction의 outbox/mailbox 및 idempotency를 사용했다. 새 추상화 계층이나 일반 작업큐를 만들지 않았다. claim credential은 DB intent → Vault 파일 → active의 복구 가능한 순서다. 실제 callback 전송 객체만 fixture로 대체한다.

## 연결 권한과 발언 범위

- 연결 권한은 같은 room/member/connection identity·owner 확인·grant version·도구·만료/회수·credential 존재로 판단한다. 옛 grant의 epoch/contextGeneration은 이력으로 보존한다. 방 off나 참여 중지는 연결 삭제와 같지 않다.
- 발언은 원래 requestId와 room epoch·방 contextGeneration·토의 generation/revision·participant snapshot·lease·prompt/history digest를 고정한다. get/claim/submit, callback 발송, 최종 공개에서 현재 상태를 다시 확인한다. 과거 Wiki 입력의 접근 권한이 사라진 경우 고정 history도 다시 제공하지 않는다.
- `dot_turn_get`은 claim 전에는 ID/상태/event 필터만 반환한다. winning attempt의 ID+token이 있어야 고정 prompt/history를 읽을 수 있다. 외부 actor의 실명/계정 증명을 대신하지 않으며 `nativeActorVerified`는 여전히 false다.
- `dot_turn_claim`의 같은 command는 같은 attempt를 반환하고 다른 claimant를 거절한다. 원문 token은 Vault에만 보관하고 DB/command/event에는 hash/ref만 남긴다. prepared claim의 중단을 자동으로 활성화하지 않는다.
- `dot_turn_submit`은 원문 공백까지 보존하고, server receipt·digest·결과·event·command 결과를 같은 transaction에 기록한다. 같은 payload는 같은 receipt, 다른 payload는 충돌이다. 수락 receipt는 **저장 증거**이며 공개/업무 완료/사실 검증을 뜻하지 않는다.
- 기본 dot grant에 `result_submit`, `resident_message_post`, 직접 work/Wiki/Codex 도구를 추가하지 않는다. JSON의 구조화된 제안은 기존 역할/범위/버전/CAS 경로로만 적용한다. 업무 보고는 review로 들어가며 다른 참여자의 검토 없이 done이 되지 않는다.
- `native-dot`은 연결용 논리 모델명이다. 실제 모델 목록·지원 사고 깊이·외부 사용량을 검증한 표시가 아니다. usage는 null이며 API 일일 한도에 추정치를 넣지 않는다.

Events catalog의 `delivery: ["webhook"]`는 [공식 MCP Events 문서](https://developers.openai.com/plugins/build/mcp-events)를 2026-11-02 대조해 추가했다. 필터는 방/참여자/연결이며 동적인 turn ID를 이벤트 스키마에 고정하지 않는다. 이번 검사는 네트워크상의 실제 dot 작업 서비스 왕복 증거가 아니다.

## 미확정·재시작·이관

원래 turn/lease/고정 요청/outbox를 먼저 commit한 뒤 기존 `hooks.dispatched()` 경계를 지난 요청만 전달한다. 이후 timeout/중단은 미확정으로 남기고 lease를 유지한다. 늦게 온 유효한 답변은 원문/receipt만 보관하며 자동 공개하지 않는다. 소유자의 원래 turn 대조에서 mailbox 원문/receipt를 사용하고, 다른 원문/receipt를 덮어쓰는 입력은 거절한다.

시작 시 미완료 요청은 held다. mailbox가 이미 저장된 경우 원래 turn에 대조 근거를 복원하고, 기존 engine/runner의 prepared/running → unconfirmed 복구를 따른다. claim/구독 갱신이나 cursor 재생이 새 요청/재발송/자동 공개를 일으키지 않는다. off·구세대·취소·권한 회수·업무 seat 변경 뒤 결과는 현재 메시지나 action에 적용하지 않는다.

원래 turn 대조/완료로 끝난 미전달 outbox는 `settled`로 남긴다. 이는 HTTP 전달 성공이 아니다. 뒤늦은 HTTP 응답은 실제 시도 결과로 기록하고 settled를 pending으로 되돌리지 않는다. 기존 delivered/cursor를 조작해 성공을 만들어내지 않는다. 후속 요청은 이미 대조한 이전 요청 때문에 영구 차단되지 않는다.

resident feature가 켜진 새 시작에서 optional requests namespace를 추가한다. 미래/손상 schema·입력/답변 digest 불일치는 시작 시 거절한다. 기존 대화·연결·Muse를 native로 이관하거나 덮어쓰지 않는다. 동작 중 turn 삭제는 기존 경계를 지키고, 연결 삭제는 기존 원문/영수증을 보존한 채 grant/구독/claim의 credential을 정리한다.

## 검증 증거

격리 worktree, Node **24.18.0**, npm **11.16.0**. 임시 SQLite/Vault·모의 callback·합성 응답과 별도 자식 프로세스를 사용했다. Node 전체 검사에서 localhost HTTP fixture만 사용하며 실제 계정 호출은 없다.

| 수락 기준 | 방법·판정 |
| --- | --- |
| provider 단일 슬롯 | `tests/dot-mcp.test.mjs`: dot 대기 중 resident/topic/work 100개 경쟁 예약 모두 busy, 활성 원래 슬롯1. **PASS** |
| 20회 중복 submit/claim | 같은 claim20회→token1, submit20회→receipt/말풍선1. 업무 보고/구조화 Wiki 제안도20회→report/version1. 토큰·callback secret이 state/snapshot/command/event에 없음. **PASS** |
| 6개 crash 경계 | `tests/dot-mcp-restart.test.mjs`: 실제 SIGKILL을 요청/outbox commit, dispatched, callback 전송 진입, claim intent, Vault claim 파일, mailbox commit 직후에 수행. 재시작 뒤 원래 ID/receipt·미확정 lease 보존, 20tick/구독 갱신→새 turn/POST/공개0. **PASS** |
| 원래 결과 대조 | timeout 뒤 늦은 mailbox는 원문 근거만 저장, 같은 owner 대조20회→공개/lease 정산1. 업무 보고도 권한 유지 시1회 반영, seat 변경 시0. 소유자 재개 전 방은 blocked. **PASS** |
| stale 결과 차단 | off/구세대/회수3종, topic 취소/수정, mailbox 수락 후 권한 변경, 이전 Wiki history 접근 회수에서 현재 메시지/action0. 원문/receipt 보존 또는 회수된 인증 거절. **PASS** |
| 3참여자·2검토 라운드 | dot 고정 입력에서 이전 공개 답변 수3→6, 해당 라운드 새 초안 미노출. 주제 완료 후 같은 grant로 방 복귀/새 발언. **PASS** |
| 구독 없음/회복 | 구독 없이100tick→dot 전송0·다른 준비된 참여자 진행. 토론 중 구독 상실도 준비된 두 초안까지만 진행, 복구 후 완료·일시 대기 사유 제거. **PASS** |
| 예산·후속 기능 경계 | API 한도 소진 뒤 dot 발언 허용/usage null, 직접 Codex/work/Wiki 권한 차단, 업무 독립 검토·기존 Wiki CAS/역할 유지. **PASS** |
| format/이관/삭제 | 기존 한 번의 형식 재시도에 별도 원래 turn/이벤트1개씩, 미래/손상 mailbox 거절, 연결 삭제 시 claim credential 제거·원문 보존. **PASS** |
| TypeScript·빌드·전체 Node | `npm run check`: **468 PASS, fail0/skip0**. D2 대비 신규 D3 **24개**. 최종 로그 `/tmp/webjjoku-dot-d3-check-20261102.log` |
| 브라우저·Codex 설치 schema | PR의 Check workflow가 기존62개 browser 검사와 설치 Codex0.165.0 schema를 실행한다. 해당 D3 PR의 실행 결과·commit으로 별도 판정한다. 로컬에서는 NOT_RUN이며 이전 D2 CI를 D3 증거로 사용하지 않음 |
| 실제 native dot/혼합 계정/서비스 적용 | **NOT_RUN**. D0 합성 왕복은 별도 이력이며 D3 운영 수락을 대신하지 않음 |

운영 읽기 점검: 서비스 active/running·기존 PID 유지, `.env` 해시와 사용자 파일35/35 해시 동일, 운영 DB의 dot namespace 미적용을 확인했다. 운영 저장소에서 빌드·서비스 재시작·DB 쓰기를 하지 않았다. Muse adapter/profile/thread를 수정하지 않았다. D2 기록에서 발견한 과거 D0 대비 browser binding digest 차이의 원인/시점은 계속 **UNVERIFIED**이며 과거 값으로 되돌리지 않았다. 실제 원래 Muse thread 대조는 D5에 남는다.

## 변경량·후속·복귀

실제 변경은 문서/검사 포함 **23파일·831줄(추가792/삭제39)**이다. 승인 추정14~18파일보다 파일 수는 늘고 예상850~1,250줄보다 변경 줄 수는 작다. 기존 work/Wiki 정책 소비 접점을 최소 수정하고 복구 검사/fixture를 분리한 결과이며, 큐·Wiki·Codex 모델/RPC를 재작성하거나 승인 범위를 넓히지 않았다. 추가 OAuth·공개 ingress·timeout 확대·운영 설정 변경은 없다.

- **D4:** 기존 흑백 UI 위에서 공식 dot 등록/owner 확인·인증된 private plugin 설정, 구독/전달/답변/미확정 진단·회수/재연결을 제공한다. 정상 on/focus는 연결 유지, 만료/회수/identity 변경은 재연결로 구별한다. Muse browser 설정은 유지한다.
- **D5:** 기존50 gate와 실제 dot 자유 발화/주제 검토·Muse 원래 thread·GPT/API 혼합/업무/Wiki/Codex 경계를 통합 검증한다. native actor 확인·운영 grant 전달·실제 이벤트 지연/응답 시간은 **UNVERIFIED**다. 별도 OAuth나 timeout 정책이 필요하면 먼저 영향/변경량을 보고한다.
- **복귀:** dot의 새 발언을 끄고 구독/권한을 회수한다. 미확정은 원래 ID/receipt로 대조하고 이력/credential/DB를 지우지 않는다. D2 바이너리는 새 `settled` 상태를 거절할 수 있으므로 단순 downgrade 전에 보존 복사본으로 호환성을 검사한다. 호환되지 않으면 D3에서 dot을 비활성화한 채 다른 기존 참여자를 사용하고 별도 이관을 검토한다. 이번 단계에서는 운영 rollback을 실행하지 않았다.
