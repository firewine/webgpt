# 페이즈 1 실행 기록 — 방 데이터 기반

진행 상태의 단일 기준은 [개발 페이즈 SSOT](../development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)다. 이 기록은 R1의 구현·fixture 검사 증거이며 상주 자동 발화·새 GUI·실계정 운영 완료를 뜻하지 않는다.

| 항목 | 확인 |
| --- | --- |
| 날짜 | 2026-10-30 KST |
| 구현 base | main 05684f83d229acc86769ce8675f632bb21743dd6 |
| 작업 브랜치 | codex/phase1-resident-foundation-20261030 |
| 코드 식별 | 이 문서를 포함하는 같은 PR의 commit·CI 결과로 추적 |
| 기존 설계 근거 대조 | base의 src/scripts/tests/package/lock/.github/.env.example는 C=8f81d861b3f170ef2024b90d9eeba56ce34f0f79와 diff 0 |
| 검사 환경 | Ubuntu의 임시 state·Chrome fixture 프로필, Node 24.18.0 / npm 11.16.0 |
| 실제 도구 | Google Chrome 156.0.8078.47 / Chrome DevTools MCP 1.12.0 |
| 운영 DB·.env·개인 Chrome profile 이관/변경 | NOT_RUN — fixture만 사용 |
| 실계정 모델 호출·실제 Codex 작업·서비스 재시작/배포 | NOT_RUN |

## 1. 결과와 수락 근거

| Gate | 판정 | 실행 증거 |
| --- | --- | --- |
| R1-A | PASS | base v1 / materials·credential 포함 v1 / 미확정 turn·reconciling job 포함 v1의 3종 fixture. resident를 제외한 JSON digest·ID·내용·event cursor·과거 command 결과 동일. 재시작 후 과거/신규 receipt와 원문 보존 |
| R1-B | PASS | fixture마다 migration 추가 100회 호출→room 1개·migration receipt 1개. 과거 이벤트 재발행·provider 호출 0. user_version/state.version=1 유지 |
| R1-C | PASS | 메시지와 제어 명령 각각 같은 키 20회→같은 결과·event 각 1개. 다른 payload는 409. SQLite commands에 사용자 receipt 총 2개 |
| R1-D | PASS | 방 목록/상세/메시지 목록/원문은 owner 인증 필요. 인증 없음·MCP grant 대입 401, 잘못된 Host/Origin 403. 쿠키 mutation의 Origin 필수. 기존 HTTP 검사도 PASS |
| 실패 원자성 | PASS | fixture SQLite trigger로 migration 또는 메시지 receipt 저장 직전 실패 주입→state/event/receipt 모두 rollback. 이후 동일 키 정상 처리 1회 |
| 읽기 복귀·스키마 | PASS | flag off에서 기존 resident와 미지 필드를 보존하는 legacy Store 쓰기, 원문 조회 가능·신규 쓰기 거절. 미래/손상 schema는 인증 파일·프로필 생성 전에 명시 거절하고 runtime lock 해제. receipt만 남은 손상 상태 재생성 금지 |
| 공개 범위·원문 | PASS | 목록 기본50·최대100, 500자 preview/truncated/textLength/digest. 전체 원문은 별도 endpoint에서 공백까지 동일. 타 방/private/topic_round 답장/조회·메타데이터 위조 거절, 상태 snapshot/SSE에 신규 메시지 원문·미래 내부 기록 미포함 |
| 실행 경계 | PASS | room off에서 사용자 메시지·멤버 설정을 저장해도 resident turn/lease 생성 0, provider/job 호출 0. on은 미구현 오류 409 |

실행한 명령:

~~~bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/실제/별도설치/node_modules/.bin/chrome-devtools-mcp \
node --test tests/browser/*.test.mjs
~~~

- TypeScript·빌드·Node 검사 **68 PASS / 0 FAIL / 0 SKIP**. 기존 53개 + 신규 15개.
- 실제 Chrome fixture 검사 **9 PASS / 0 FAIL / 0 SKIP**. 기존 UI·계정 분리 fixture·실제 MCP 프로세스 왕복 포함. dot/Muse 개인 계정은 사용하지 않았다.
- 제한 sandbox 안에서는 자식 프로세스/소켓 검사들이 실패했다. 로컬 fixture 실행 권한으로 다시 실행한 위 결과를 수락 증거로 사용한다.
- 신규 검사는 [resident-store.test.mjs](../../tests/resident-store.test.mjs), [resident-http.test.mjs](../../tests/resident-http.test.mjs), [config.test.mjs](../../tests/config.test.mjs)에 있다. 운영 host/계정 성공을 위 PASS로 대체하지 않는다.
- 변경 문서 9개의 로컬 링크/앵커 157개 오류 0, 기존 사용자 파일 35개의 hash 변화 0, git diff --check 오류 0을 확인했다. 사용자 미추적 파일은 이 변경에 포함하지 않는다.

## 2. 기존 계약 유지와 최소 변경

| 경계 | 유지/변경 | 구현 |
| --- | --- | --- |
| 물리 DB·동시 쓰기·영속 명령 | 유지 | 기존 [Store](../../src/workspace/store.ts)의 read/transact/events/cursor/lock, 기존 테이블·user_version=1 그대로. 신규 DB/ORM/별도 event bus 없음 |
| optional 데이터 | additive 변경 | [WorkspaceState](../../src/workspace/model.ts)에 optional resident. [resident-model](../../src/workspace/resident-model.ts)에 schema1·Room/Member/Message 및 turn/lease 골격. initialState는 유지 |
| 데이터 서비스 | 신규 composition | [ResidentStore](../../src/workspace/resident-store.ts)가 같은 Store를 주입받아 방 조회/명령·명시 version 검사만 담당. provider/실행기 의존 없음 |
| HTTP·SSE·인증 | 유지+additive | [createWorkspaceServer](../../src/http/workspace.ts) 기존 owner/Host/Origin 이후 route 추가. event envelope/stream은 그대로, 신규 event는 참조만 포함 |
| runtime/config | additive 변경 | [Workspace](../../src/workspace/runtime.ts)에서 Store 직후 schema 검증·조건부 이관, snapshot에 resident metadata 추가. [loadWorkspaceConfig](../../src/workspace/config.ts)에서 flag 검증 |
| 모델·실행·주제 토론 | 유지 | Providers.complete·연결/auth·DiscussionEngine·topic JSON·CodexExecutor·start/close·승인/격리 변경 없음 |

실제 문제는 상주 방을 저장할 모델·API가 없다는 점이었다. 별도 서버·일반 Repository 계층 대신 작은 ResidentStore 하나를 기존 Store 위에 합성했다. 명령마다 기존 transaction 안에서 state·event·receipt를 함께 저장하고, control은 expectedVersion CAS로 충돌을 드러낸다. actor/source/sequence/visibility는 서버가 정한다. 목록/상세 DTO는 필드를 명시해 미래 내부 데이터가 우연히 노출되지 않게 했다. 이는 [디자인 패턴 지침](../development-guidelines.md)의 composition·기존 Unit of Work·명시 전이를 적용한 범위이며 미래 scheduler/worker 패턴을 구현했다는 뜻은 아니다.

## 3. 이관·상태 계약

`WJ_RESIDENT_ENABLED`는 기본 false이며 true/false 리터럴만 허용한다. [.env.example](../../.env.example)에 설명을 추가했고 사용 중인 .env는 수정하지 않았다. false인 legacy state에는 resident나 migration command를 만들지 않는다.

처음 true로 로드하면 `resident:migration:v1` command의 한 transaction으로 schemaVersion=1과 방 1개를 만든다. 방은 off, 참여자 참조는 모두 disabled, budget/다음 발화 시각은 null이다. 기존 토론은 legacyDiscussionIds 참조로만 연결하며 원문·task·job·credential을 복제하거나 과거 메시지로 게시하지 않는다. migration 자체는 event를 발행하지 않아 기존 event cursor를 보존한다. migration 식별/시각/basisCursor와 command receipt는 DB에 남긴다.

turn/lease 및 contextCheckpoint/work/Wiki/jobLink/grant 컬렉션은 빈 골격·예약 저장 공간이다. 특히 후속 컬렉션은 unknown[]이며 R2~R7의 검증/명령/API가 구현됐다는 뜻이 아니다. 미래 schemaVersion 또는 손상 shape는 503으로 거절하고 자동 초기화하지 않는다. migration receipt는 있는데 resident가 없으면 재생성하지 않고 503으로 보존한다.

## 4. owner API 계약

모든 route는 기존 owner 인증·Host/Origin 정책을 통과해야 한다. MCP grant로 대신할 수 없다. mutation은 JSON body와 Idempotency-Key가 필요하며 `resident:command:<key>` namespace와 operation/roomId/body digest로 중복을 대조한다. 같은 키/입력의 재시도는 최초 결과, 바뀐 입력은 409다.

| 요청 | 동작·제약 |
| --- | --- |
| GET /api/rooms | enabled/schemaVersion/dispatchAvailable=false·방 metadata·전역 event cursor. 원문/turn/내부 예약 데이터 없음 |
| GET /api/rooms/:id | 방 metadata·feature 상태·전역 cursor |
| GET /api/rooms/:id/messages?after=0&limit=50 | after는 방 내부 sequence, 기본 0. limit 1~100·기본50. room_public만 sequence 오름차순. preview 최대500자·digest·textLength·truncated, nextAfter/hasMore·전역 event cursor. 음수·중복 인자·지수 표기 거절, 방 마지막 sequence를 넘은 after는 409 |
| GET /api/rooms/:id/messages/:messageId | 같은 방의 공개 메시지 전체 원문·digest·전역 cursor. private/다른 방 ID는 404 |
| POST /api/rooms/:id/messages | text 필수(공백만 거절·최대20,000자, 원문 공백 보존), replyTo 선택(같은 방 공개 메시지), mentions 최대8개(등록된 방 멤버 참조·중복 제거). authorId=owner/sourceKind=user/sequence/visibility는 서버 고정. 꺼진 방에도 저장하되 실행하지 않음 |
| POST /api/rooms/:id/control | action·expectedVersion 필수. rename(title 최대100자), set_member(participantId/enabled), off. 변경 때만 version 증가·event. no-op은 receipt만 저장. 알 수 없는 필드는 거절 |

on은 `resident_dispatch_not_available` 409다. `dispatchAvailable:false`가 항상 표시되며 false flag에서는 새 mutation을 `resident_disabled` 409로 거절한다. 이미 저장된 동일 요청 receipt 조회는 부작용 없이 가능하다. 방 제어 expectedVersion은 설정 충돌을 검출하며 새 메시지는 설정 version을 올리지 않는다. message sequence와 기존 전역 SSE cursor를 혼용하지 않는다.

신규 event는 `resident.room_changed`(roomId/action/version)와 `resident.message_created`(roomId/messageId/sequence)이며 discussionId=null이다. SSE는 저장된 참조로 목록/원문을 다시 조회하게 하고 raw text·새 model prompt·Wiki/업무 내부 데이터는 넣지 않는다.

## 5. 롤백과 남은 범위

R1 자체는 외부 전송이 없으므로 신규 resident 실행을 drain할 대상이 없다. 운영 전환 때는 [G0](../resident-implementation-plan.md#2-공통-롤백-g0--모든-단계의-선행-조건)에 따라 기존 topic/Codex의 prepared/running/unconfirmed/queued/승인/대조 상태를 별도로 확인해야 한다. flag off가 기존 queued job 실행까지 멈춘다는 뜻은 아니다. 사용자 운영 데이터에서는 이 절차를 실행하지 않았다.

flag off로 돌아가면 이미 생성한 resident·원문·journal·commands를 그대로 두고 읽기만 제공한다. 기존 reader의 unrelated transaction이 optional/미지 필드를 유지하는 fixture를 통과했다. 이전 binary로의 복귀도 G0와 해당 버전 reader 확인 후 수행하며 state 삭제·DB restore로 정상 롤백하지 않는다. 초기 이관 실패는 같은 transaction이 모두 rollback한다. 미래 schema는 flag off여도 거절한다.

다음 페이즈는 R2의 공통 dispatch·예산/휴면·자유 발화 JSON·topic focus/문맥 인계다. U1/U2/U3 사용자 결정은 원 [결정 목록](../resident-implementation-plan.md#11-사용자-결정-필요)에 그대로 남아 있다. GUI는 R3, 열린 큐는 R5, Codex 업무 환류는 R6, Wiki는 R7에서 구현한다. 실계정/운영 배포는 별도 검증이며 이번 R1 결과로 완료 처리하지 않는다.
