# 주제별 채팅 작업실 통합 — 2026-11-01 승인 범위

작성: 2026-11-01 KST. 상태: 사용자가 ‘계획 개정·통합 개발 승인’으로 A~D 범위를 승인했다. 본문 C1~C8은 승인 전 관측이고, 구현/검사 결과는 별도 실행 기록과 PR head로 판정한다. 이후 별도 사용자 지시 ‘모의 참여자는 삭제해’에 따라 비활성 기본 모의 A/B의 운영 등록만 제거했고 과거 토의2개·실제 토커4개와 원문/계정·실행 상태는 보존했다. 서비스 재시작은 하지 않음.

## 사용자 요구와 변경 결론

‘토의 작업실’을 별도 관리자 화면으로 두지 않고 **채팅방 아래의 주제별 대화**로 통합한다. 모든 기존 토의가 주제 목록에 나타나고, 주제를 선택하면 동일한 채팅 화면에서 상단 주제·AI 발언·사용자 개입·검토/검증·결론을 본다. 자유 대화도 같은 채팅방의 항목이다. 흑백 테마를 유지한다.

현재 계획은 독립 토의 화면을 별도 진입·복귀 대상으로 유지한다. 이 결정을 ‘기본 화면은 채팅방/주제 목록, 기존 상세 제어는 주제의 보조 패널’로 **수정 승인**한다. 단순 메뉴 이름 변경으로 완료하지 않는다. 기존 엔진과 provider/Store/인증/큐/Wiki/Codex는 재사용한다.

## 코드·실측 근거

| 근거 | 현재 확인 | 변경에 미치는 영향 |
| --- | --- | --- |
| C1 | `src/web/control.html`: `view-room`과 `view-discussion`, 별도 메뉴. `control.ts::render`의 history 클릭, `RoomView`의 `openDiscussion/startFocus`가 `showView('discussion')`으로 이동 | 메뉴·목록·생성·상세 경로를 한 채팅 shell로 통합 |
| C2 | `src/web/room-view.ts::loadTopic`: `topicLink ?? legacyDiscussionIds.at(-1)` 한 개를 선택하고 `discussion.roomId === room.id`일 때만 주제로 표시 | 과거 독립 토의는 사라진 것이 아니라 현재 방 주제 표시 대상에서 빠짐. 모든 토의 인덱스와 선택 주제 상태 필요 |
| C3 | `src/workspace/runtime.ts::snapshot`의 discussions 요약에는 roomId가 없음. 상세 `Discussion.roomId`는 optional이고 GET `/api/discussions/:id`는 기존 원문/상태를 반환 | 목록용 roomId metadata만 additive 확장 제안. 전체 원문을 요약 API에 싣지 않음 |
| C4 | `src/web/room-view.ts::renderMembers`는 전역 participants만 순회. `Workspace.participant`가 연결/모델을 확인해 별도 Member 생성 | 연결만 만든 AI도 모델 선택/등록 필요 상태로 보이게 하되, 자동 모델 선택·유료 실행은 하지 않음 |
| C5 | 최초 읽기 관측: 연결5개, 토커6개(모의2 포함), 방1개, 토의3개 모두 roomId 없음. 이후 사용자 명시 삭제 지시로 현재 명단은 실제 토커4개/모의0개이며 과거 모의 토의는 보존됨. CoralBricks 연결에는 토커1개, River 연결에는 토커0개. browser 연결은 error | River 누락 원인을 UI에서 설명해야 함. browser 오류를 숨기거나 정상으로 표시하지 않음. 개인 이메일·대화 원문·접속 키는 이 문서에 기록하지 않음 |
| C6 | `DiscussionEngine.create/control`과 POST `/api/rooms/:id/focus`, `/api/discussions/:id/control`이 주제 생성/진행/개입을 제공. 진행·일시정지·blocked root1개와 dispatch1개를 검사 | 화면 통합을 위해 엔진을 다시 만들 필요 없음. 목록 탐색과 실제 실행 시작은 다른 동작 |
| C7 | `ResidentRunner`의 topic publication은 같은 라운드 공개 경계와 원래 turn ID를 사용. `RoomView.publishedTopicResults`는 공개된 종합/동료검토를 표시 | 주제별 말풍선도 같은 공개 조건·원문 참조를 지킴. 미완성 라운드·다른 주제 내용을 새 prompt에 섞지 않음 |
| C8 | `DiscussionEngine.control`의 revise는 단순 댓글 저장이 아니라 revision 증가/새 검토 시작. 종료 토의의 revise는 거절 | 사용자 개입은 기존 의미를 명확히 표시. 일반 채팅 전송을 몰래 revise/토의 재시작으로 바꾸지 않음. 별도 영구 댓글·자동 재실행 의미 확장은 이번 안에 넣지 않음 |

코드 기준: main `560598277fb072f65a9195656c628d257e2cf950`. 현재 검토 checkout은 PR #33 head `d21be4cabf52b438f2f85fb160a068c305e13084`이며 차이는 owner password 기능이다. PR #33은 조회 시 OPEN이다. GUI의 control.*와 SSOT가 겹치므로 #33 병합 후 최신 main에서 GUI 작업 브랜치를 만드는 순서를 권장한다. 미병합 상태에서 병행한다면 종속 브랜치로 명시하고 PR #33 내용을 GUI 신규 변경량으로 중복 집계하지 않는다.

## 목표 화면과 동작

```text
채팅방
  자유 대화
  주제 A — 진행/대기/완료 상태
  주제 B — 진행/대기/완료 상태
  + 새 주제
```

주제를 선택하면 중앙 상단에 그 주제/기준/진행 상태를 고정하고 아래에는 해당 토의의 AI 말풍선·기존 사용자 개입 기록을 표시한다. 검토·반론·검증·수정·종합/남은 이견도 그 주제 안에서 이어진다. 비교/근거/사용량/도구 승인/미확정 대조는 우측 패널이나 상세 drawer로 제공한다. 기존 `renderDiscussion/renderComparison/renderEvidence/renderTasks` 등의 기능은 이 접점에 결합한다.

멤버 영역은 모든 등록 토커 + 아직 토커가 없는 연결을 표시한다. 현재 주제 참여자/방 참여 여부/모델 선택 필요/인증 또는 browser 오류를 구분한다. 과거 주제는 `Discussion.members` snapshot을 사용하므로 계정 삭제·표시 이름 변경 후에도 원래 발언 주체를 잃지 않는다. 카탈로그의 모든 모델을 자동 토커로 생성하거나 표시됐다는 이유로 자동 참가시키지 않는다. 기존 dot·Muse의 실제 browser 연결·thread 검증을 그대로 사용한다.

일반 채팅 입력은 자유 대화 항목에서 기존 방 messages API를 쓴다. 주제 안의 의견 반영·일시정지/재개/복구는 기존 토의 control API로 제공하고 의미를 명시한다. 완료·부분 완료·취소된 주제를 열어 보는 것만으로 다시 실행하지 않는다. 새 주제의 실제 시작은 기존 focus API와 방 on·참여자 준비/단일 실행 조건을 따른다. 방 off/flag off에서도 기존 주제 읽기는 제공한다.

## 대안 판정

| 안 | 판정 | 이유 |
| --- | --- | --- |
| 기존 두 화면 유지 + 메뉴 이름/색상만 변경 | 기각 | 모든 토의가 채팅방 아래 주제별로 들어가는 요구를 충족하지 못함 |
| 기존 control/room UI를 한 shell로 통합 + 작은 TopicChatView/read-only projector | 채택 승인 | 같은 API/SSE/로그인과 기존 상세 제어를 재사용하면서 진입·탐색·말풍선을 통합 |
| 새 서버·DB·토론 엔진·메신저 프레임워크 전면 도입 | 기각 | 이번 UI 요구를 위해 기존 실행/영속/안전 계약을 교체할 근거가 없음 |

패턴: `TopicChatView`는 **제안 파일/심볼**이다. control의 선택/조회/명령을 조합하는 작은 view adapter와 순수 목록/공개 발언 projector만 둔다. API 호출·실행 제어를 새 렌더러에 복제하거나 범용 상속/DI container를 만들지 않는다.

## 승인된 구현 묶음

| 순서 | 변경 파일·심볼 | 데이터·이관 | 수락·검증 방법 | 복귀 |
| --- | --- | --- | --- | --- |
| A. 계획·화면 경계 | `docs/development-plan.md`, `discussion-plan.md`, `implementation-sequence.md`, `resident-implementation-plan.md`, `webjjoku_living_design.md`, 이 검토서의 저장소 사본 | 기존 R1~R8 순서 유지, R3 GUI 통합 보완/R8 회귀로 기록 | 문서 링크 검사·현재/제안 판정과 API/안전 경계 일치 검토 | 승인 범위 이력은 보존하고 UI 전환만 복귀 |
| B. 주제 목록·단일 shell | `src/web/control.html/control.ts/control.css`, `room-view.ts::loadTopic/openTopic`, **제안** `src/web/topic-chat-view.ts`, `src/http/workspace.ts`의 기존 asset map(새 module 제공 시), `runtime.ts::snapshot`의 roomId 요약 | 원래 discussion/turn ID·roomId·claims/근거/영수증 그대로. 표시/읽기 상태만 기기+주제별 분리. SQL schema·대화 DB 이관 없음 | fixture 독립3+방 연결2=5주제 전부 표시·각1개 선택, 주제20회 전환에서 외부 호출/POST0. 새로고침·2탭에서 선택/스크롤·원문 보존 | 기존 상세 렌더러/고급 보기로 접근 유지. 원래 DB/metadata를 삭제하지 않음 |
| C. 말풍선·AI 목록·기존 제어 | 위 view들, 기존 `control.ts::renderTimeline/renderComparison/renderEvidence/renderTasks`, `RoomView.renderMembers`, 기존 participant 등록/편집 UI | 순수 read projection. 미등록 연결은 설정 상태 카드, 참여 선택/모델 변경은 기존 API. 기존 scope/문맥/참여자 snapshot 불변 | 실제4토커+미등록 연결1·과거 멤버 snapshot 표시, 현재 모의 토커0·과거 모의 기록 보존, 실패 연결을 정상 표시0·자동 등록/자동 on0. 다른 주제 발언/구세대/미완성 라운드의 교차 공개0. 완료 주제 조회의 재개0 | 같은 ID의 원래 제어/원문 보기 유지. 현재 진행·미확정 상태를 재생성하지 않음 |
| D. 회귀·증거 | `tests/browser/room*.test.mjs`, `workspace.test.mjs`, **제안** 주제 채팅 UI 검사, 관련 Node snapshot/공개 경계 검사, 구현 증거 문서 | 기존 수락 기록의 실제/fixture 구분 유지 | `npm run check`; 실제 Chromium+Chrome MCP `npm run test:browser`, FAIL/SKIP 구분. 390/768/1280/1440 폭·2탭/SSE/IME/장문/주제 전환·승인/복구 회귀. 원래 사용자35파일 SHA-256 일치 | G0(실행/미확정 대조) 뒤 UI 복귀. DB restore/재전송으로 복귀하지 않음 |

## R1~R8 및 후속 영향

| 범위 | 영향 |
| --- | --- |
| R1 | 목록용 roomId 요약은 additive. Store transaction/event/idempotency·물리 schema·원래 ID 유지. 과거 독립 토의를 현재 방에 실제로 옮기는 데이터 이관 없음 |
| R2 | provider 최대1·root workflow1·초안/라운드 비공개·generation/미확정·휴면 유지. 주제 선택 상태를 실행 topicLink와 분리해 회귀 |
| R3 | 주요 수정 대상. 기본 진입·주제 목록·AI 목록·말풍선·상세 제어를 통합. 기존 기능/IME/4폭 수락 유지하고 주제 탐색 gate 추가 |
| R4 | 연결 발견/로그인/별도 토커 등록을 기존 경로로 연결. River 미등록과 browser 오류 표시 검사 추가. 실제 thread를 임의로 dot/Muse라고 재분류하지 않음 |
| R5 | 작업큐 모델/claim·역할/픽업 유지. 선택 주제와 큐의 원래 room/task scope를 구분해 표시 |
| R6 | 승인/취소/실행 결과/receipt 패널 접근 경로 회귀. Codex RPC·격리·권한 불변 |
| R7 | Wiki/version/CAS/인용 범위 유지. 주제를 열었다는 이유로 기존 Wiki/문맥을 자동 첨부하거나 다른 방 권한을 확장하지 않음 |
| R8 | 통합 화면의 주제5개/전환20회·4폭/2탭·SSE/가시성/승인 회귀 추가. 원래50 gate를 낮추거나 실계정 수락 완료로 바꾸지 않음. 확정 후속 페이즈는 없으며 새9단계 신설 없음 |
| PR #33/운영 | 비밀번호 화면/세션과 공통 control 파일의 충돌을 회피해 병합 기준 확인. 실제 모델 호출·계정 등록·새 배포는 별도 범위 |

총 예상 **18~26파일·900~1,600줄**(현재 GUI+후속 회귀/문서 합산). backend는 요약 metadata·asset 제공 등 약1~2파일의 최소 접점이며 provider/engine/Store 재작성은 포함하지 않는다. 실행 기능을 변경해야 하는 상황이 발견되면 그 확대분은 다시 영향 보고한다.

큰 리스크3개: (1) 과거 독립 토의와 방 scope를 잘못 합쳐 문맥/권한을 바꾸는 것, (2) 주제 선택/메시지 표시가 실행·의견 반영을 유발하거나 비공개 라운드를 공개하는 것, (3) 모든 AI를 보이게 하는 것과 실제 모델 설정·참여/사용량 권한을 혼동하는 것. 위 데이터 불변·호출0/가시성 gate·상태 카드로 검사한다.

## 승인과 변경 경계

기존 사용자 지시 ‘개발하면서 계획수정이 필요하면 승인 받고 계획서 변경’과 `docs/development-guidelines.md` §5의 ‘별도 검토서/변경안은 제안·미승인으로 작성할 수 있지만 승인된 SSOT·계획 본문이나 변경에 종속된 코드를 먼저 바꾸지 않는다’를 적용한다. 승인 대상은 **분리된 토의 작업실의 기본 진입을 채팅방 아래 주제별 구조로 바꾸고, 모든 AI의 등록/참여 상태를 표시하는 위 범위**다. 운영 room on/off·회원/계정·인증·유료 추론·서비스 배포는 이 검토에서 변경하지 않는다.

2026-11-01 승인 후 `codex/topic-chat-workspace-20261101`을 PR #33 head에서 분기했다. #33은 조회 시 OPEN이므로 종속 변경으로 개발하고 최종 PR의 base/비교 범위를 명시한다. 기존 독립 토의 API는 호환을 유지하며 resident flag가 꺼진 환경의 명시적 새 주제 생성은 기존 create API/한도로 처리한다. UI는 이 주제도 같은 목록에서 보여 주고 실행/방 scope를 변경하지 않는다.

[구현·검증·사용/복귀 기록](../implementation/topic-chat-workspace-20261101.md)에 결과를 남겼다. 승인 당시 제안 파일 `src/web/topic-chat-view.ts`는 실제 구현됐으며 backend는 목록 metadata·정적 asset 접점만 추가했다.
