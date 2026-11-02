# 공식 dot D2 — Events와 영속 outbox

2026-11-02 KST. PR #37 병합 뒤 사용자의 다음 단계 지시에 따라 구현했다. 기준 main `159e13b10301fa1a249b66d805c971f0b35ace16`, 브랜치 `codex/dot-mcp-events-d2-20261102`. [SSOT](../development-plan.md)·[승인 D0~D5 범위](../reviews/dot-official-mcp-events-impact-20261101.md)를 유지한다. **D2 코드/격리 검사 PASS. 운영 배포·실제 callback/계정 호출은 NOT_RUN.**

## 구현 경계와 재사용

| 파일·심볼 | 변경·기존 계약 |
| --- | --- |
| `http/mcp.ts::McpEndpoint.grant/handle` | 기존 `/mcp`에서 D1 dot Bearer를 별도 식별. Events RPC만 새 경로에 전달. owner 키/legacy grant/resident grant로 dot 권한을 얻지 못하며 Host/Origin 계약 유지 |
| `http/mcp-events.ts::McpEvents.handle/subscribe` | 인증된 `events/list/subscribe/unsubscribe`, 기존 protocolVersion `2025-06-18` 초기화. dot에는 Events를 광고하지만 D3 전까지 tools 목록은 비어 있고 발화 도구 호출은 거절 |
| `connections/mcp-webhook.ts::McpWebhook.post` | 기존 `sources.ts::publicAddress`를 재사용. 별도 HTTPS POST는 모든 DNS 결과 검사·검사한 IP에 연결·원래 URL hostname의 TLS 검증·redirect 금지·socket 재사용 금지를 적용 |
| `workspace/dot-mcp-model.ts`, `dot-mcp.ts::readDotState` | optional `dotMcp.events.version=1`, subscriptions/outbox 추가. 기존 SQLite version1/Store/Vault API·과거 데이터 유지. 손상/미래 Events schema는 시작 시 거절 |
| `McpEvents.queueTurn/pump` | 원래 turn/lease에 연결된 알림의 intent·고정 eventId·본문 digest·시도/결과를 같은 Store transaction/event에 기록. HTTP enqueue 도구는 없음 |
| `runtime.ts::Workspace.start/close`, `DotMcp.revokeInState/cleanup` | 기존 lifecycle에 전달 worker 결합. 회수 시 pending/sending 보류, 삭제 시 회전한 callback credential까지 기존 cleanup 절차로 제거. 다른 provider·Muse·엔진·큐·Wiki·Codex 구현 유지 |

Adapter/Composition·명시적 상태 전이·CAS·영속 outbox를 사용한다. 새 broker/DB/framework/DI container/OAuth는 없다. 전송 객체와 시계만 주입해 fixture를 격리한다. 기존 provider `complete` 계약과 실행 timeout은 그대로이며 dot은 D3 전까지 `dot_transport_not_ready`다.

## 구독·인증·전송 계약

[공식 MCP Events 문서](https://developers.openai.com/plugins/build/mcp-events)를 2026-11-02 대조했다. 같은 endpoint의 인증, signed challenge, Standard Webhooks 서명, 필터·수명·회전·해제를 구현한다. D0 합성 서버의 no-auth를 제품 서버에 옮기지 않는다. 실제 plugin의 인증된 grant 전달은 후속 실환경 확인 대상이다.

- 이벤트는 `webjjoku.turn_requested` 하나다. filters는 `roomId/participantId/connectionId`이며 grant와 정확히 일치해야 한다. 이벤트 schema에 특정 probe/turn ID를 고정하지 않는다.
- subscription ID는 인증된 grant ID + 정규화 callback URL + 이름 + 고정 순서의 filter JSON으로 결정한다. 반복/동시 갱신은 같은 ID다. 별도 grant 발급은 별도 principal이다. grant당 최대100개 구독이다.
- DB에 prepared intent와 Vault ref를 먼저 남기고 callback URL/secret은 암호화 파일에 저장한다. 2xx와 일회성 challenge의 상수 시간 일치 확인 후 active로 바뀐다. 검증 결과는 같은 principal/URL/secret에10분 캐시한다. 해제/회수/키 변경은 오래된 검증 응답을 무효화한다.
- 기본 수명1시간, 요청 최대24시간 및 grant 만료 이내다. `ttlMs:null`에도 유한 수명을 반환한다. 검증 대기열과 네트워크를 포함해10초, POST 응답16KiB, 전달 body256KiB로 제한한다. 기존 HTTP 서버 timeout은 늘리지 않았다.
- secret은 `whsec_` Base64의24~64바이트이며 교체 시 재검증한다. 새/이전 키의 서명을 약5분간 함께 보내고 이후 새 키만 사용한다. callback/secret은 DB·command journal·event·화면 응답·오류에 포함하지 않는다. 이전 파일은 보존한 ref로 연결 삭제 시 함께 정리한다.
- HTTPS 기본443만 허용한다. 검증과 실제 전달 모두 private/loopback/link-local/Tailnet/예약 주소·혼합 DNS를 차단하고 매 접속 새 DNS 검사를 수행한다. 검증 실패는 가린 `-32015 CallbackEndpointError`와 이유 코드로 반환한다.

## Outbox·cursor·재시작

`queueTurn(state, emit, grantId, requestId)`는 **내부 결합점**이다. 현재 방 on·멤버/identity·grant version/epoch/generation·원래 prepared/running turn·reserved/running dispatch lease를 검사한다. D3가 원래 turn을 저장하는 transaction 안에서 호출할 예정이다. 이번 단계에 운영 호출자는 없으며 방 메시지 저장만으로 알림을 만들지 않는다. 테스트에서만 합성 예약을 생성한다.

body에는 eventId/시각/cursor와 room·participant·connection·request ID 및 requested 상태만 담는다. 원래 prompt·대화·주제·Wiki 내용은 보내지 않는다. 동일 구독/원래 request의 enqueue는 같은 이벤트를 돌려주며 새 발언을 만들지 않는다.

전달 worker는 한 번에 POST1개다. 시도 전에 sending/시각을 commit하고, 수신 코드·완료 시각·오류를 별도 transaction으로 기록한다. 408/425/429/5xx 및 일시적 네트워크 실패만1·2·4·8초 간격으로 총5회 이내 재시도한다. eventId/본문은 같고 서명 시각만 새로 만든다. 410/413과 다른 영구 오류/redirect는1회 뒤 failed다. 2xx는 **callback 수신**이며 provider 답변/말풍선/작업 완료가 아니다.

cursor는 구독별 **연속 전달 확인 위치**다. 앞선 pending/held/failed 이벤트를 뒤의 전송으로 건너뛰지 않는다. 갱신은 현재 cursor를 반환하며 이전/알 수 없는 cursor 또는 보류된 이력은 `truncated:true`로 알린다. 이미 delivered인 알림을 다시 실행하거나, cursor로 held/failed를 pending으로 바꾸지 않는다. D3에서 원래 turn을 대조할 수 있도록 ID/시도 기록을 유지한다.

시작 시 prepared 구독과 credential 누락/불일치 활성 구독은 failed로 남긴다. pending/sending outbox는 held로 전환하며 원래 ID·body·digest·cursor·미완료 시도를 보존한다. 기존 엔진의 prepared/running→unconfirmed 복구를 대체하지 않는다. 방 off/세대 변경/권한 회수/해제/취소 후 늦은2xx는 시도 결과만 기록하고 cursor를 진행시키지 않는다. 예상 밖 worker 오류는 새 전송을 중지하고 held/진단 event로 남긴다.

## 검증 증거

별도 worktree `/home/firewine/webgpt-worktrees/dot-mcp-d2`, Node24.18.0/npm11.16.0, 임시 SQLite/Vault·모의 callback·localhost HTTP만 사용했다. 운영 저장소의 dist는 빌드하지 않았다.

| 승인 수락·추가 경계 | 검증 방법·결과 |
| --- | --- |
| 같은 구독20회→ID1 | PASS. `tests/mcp-events.test.mjs`, 동시20회·filter 순서 변경·challenge1회·credential1개 |
| challenge/서명/회전/만료/회수 | PASS. 잘못된 echo·302·timeout·Vault 오류 활성0, 서명 원문/시각/key 대조, 교체 검증·이전 키 만료·TTL/해제·동시 검증 취소 |
| private/DNS rebinding/redirect10종 이상 | PASS.13종 비공개/예약 IP + URL/혼합 DNS/빈 DNS/재조회/고정 lookup/TLS hostname/redirect/응답 상한. 차단 목적지에 POST0 |
| 동일 eventId retry,410/413 retry0 | PASS.503→202에서 ID/body 동일·시간 경계;500은5시도 후 종료;410/413 각각1시도. 원래 turn은 prepared 유지 |
| 발송 전 권한·상태 재검사 | PASS.off/epoch/generation/grant/member/turn/lease/secret8종 POST0. DNS 뒤 권한 재확인 및 늦은2xx 현재 적용0 |
| 재시작 ID/cursor 보존 | PASS. 실제 SQLite 재오픈·실제 자식 SIGKILL. sending 시도 종료 시각 null 보존·held·재구독/새 이벤트로 gap 우회0 |
| HTTP·삭제·기존 데이터 | PASS. 같은 `/mcp`의 Bearer/Host/Origin, 활성 turn 삭제 거절·완료 후 회전 credential 정리/원문 보존, 손상/미래 schema 거절 |
| 전체 검사 | `npm run check`: **Node444 PASS, fail0/skip0**. 이 중 D2 신규47. TypeScript/빌드 포함 |
| 브라우저·Codex 설치 계약 | PR CI에서 기존 검사 실행. 아래 CI 결과 확인 후 증거 추가 |
| 운영 callback·dot 답변·혼합 토론 | **NOT_RUN**. D0 합성 성공을 D2 운영 수락으로 바꾸지 않음 |

검사 로그는 로컬 `/tmp/webjjoku-dot-d2-check-20261102.log`. 외부 주소·API key·원래 대화 원문은 검사 산출물/commit에 포함하지 않는다.

운영 읽기 점검: 서비스 active/running·PID 유지, `.env`와 사용자 파일35/35 해시 동일, 운영 DB에는 dot namespace 미적용을 확인했다. 과거 D0 보존 기록의 browser binding1건 digest는 현재 값과 달라, 그 시점부터의 동일성은 **UNVERIFIED**다. 이 단계에서는 운영 binding/DB에 쓰지 않았고 변경 시점·원인을 단정하거나 과거 값으로 복구하지 않았다. D5의 원래 Muse thread 대조는 그대로 필요하다.

## 후속·복귀

계획/수락/후속 단계 변경 없음. D3는 현재 내부 enqueue 결합점에 frozen input·claim/submit·mailbox·공개/정산·대조를 연결하고, ready 판단에서 활성 구독과 보류된 outbox를 함께 검사해야 한다. D4의 owner UI/private plugin 설정 전에는 이 PR만으로 dot이 채팅방에 나타나거나 발언하지 않는다. 실제 grant/plugin 전송 가능 여부와 별도 OAuth 필요 여부는 아직 UNVERIFIED다.

복귀 시 dot grant를 회수하고 새 전송을 중지한다. outbox/시도/미확정 기록을 삭제하거나 새 turn으로 재발행하지 않는다. 이관은 additive이며 기존 원문·Muse·credential·대화 DB를 유지한다. 운영 적용은 이번 작업에 포함하지 않았으므로 서비스 재시작/rollback은 실행하지 않았다.
