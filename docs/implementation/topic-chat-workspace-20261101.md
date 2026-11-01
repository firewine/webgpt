# 주제별 채팅 작업실 통합 — 2026-11-01

## 승인·코드 기준

사용자가 [주제별 채팅 통합안](../reviews/topic-chat-ui-impact-20261101.md)의 **계획 개정·통합 개발**을 승인했다. 현재 R3 GUI 보완/R8 회귀로 수행하며 새 페이즈를 만들지 않았다. 검토 당시 main은 `5605982`, 비밀번호 PR #33은 OPEN/head `d21be4c`여서 `codex/topic-chat-workspace-20261101`을 그 head에서 분기했다. 비밀번호 변경을 GUI 신규 변경량으로 중복 집계하지 않는다. 최종 PR base와 CI SHA로 병합 기준/검사 소스를 확인한다.

## 변경 결과

| 사용자 흐름 | 구현·계약 |
| --- | --- |
| 한 채팅방 아래 모든 주제 | `control.html/control.ts`, `TopicChatView.render`: 자유 대화/전체 토의 목록/새 주제. 기존 별도 토의 메뉴를 제거하고 주제를 같은 채팅 shell에서 연다. resident off에서도 기존 기록을 읽으며 off를 자동 on으로 바꾸지 않음 |
| 주제·발언·결론 | `topic-chat-view.ts`: 상단 주제/기준/상태·원래 참여자 snapshot, 중앙 말풍선·검토/반론·미확인·종합. 같은 라운드의 모든 답변이 확정된 뒤 공개하고 원래 turn ID를 사용. 장문은 1,500자 preview/전체 펼침이며 원문을 자르거나 HTML로 실행하지 않음 |
| 중간 의견 | 주제 안의 입력칸/명시적 **의견 반영** 버튼은 기존 `DiscussionEngine.control(revise)` API를 사용. Enter는 줄바꿈이며 입력만으로 호출하지 않음. 종료 주제는 읽기. 이전 revision의 공개된 발언은 접어서 보존하며 새로운 결과와 구분 |
| 전체 AI | `RoomView.renderMembers`: 현재 토커 모두와 토커가 없는 연결을 함께 표시. 등록/모델 선택 필요, 연결 오류, 선택 주제 참여 여부, 자유 대화 토글을 구분. 토커 만들기는 기존 등록 폼으로 이동하고 자동 모델 선택/등록/참여/유료 호출을 하지 않음 |
| 과거 작성자·모의 삭제 | 과거 `Discussion.members` snapshot으로 작성자·표시 이름을 보존. 별도 지시로 운영 명단에서 삭제한 모의 A/B를 복원하지 않음. 과거 모의 발언은 원래 토의에서 읽을 수 있고 fixture provider 자체는 자동 검사를 위해 유지 |
| 상세 기능 | `control.ts::renderDiscussion/renderComparison/renderEvidence/renderTasks/renderRecords`를 기존 ID 그대로 상세 dialog에 결합. 비교·근거·토커 설정·일시정지/재개·미확정 대조·체크포인트·Codex 승인/실행 접근 유지 |
| 읽기·두 탭·지연 | 선택 ID는 탭의 sessionStorage와 새 탭 기본값용 localStorage, 주제별 위치/펼침/읽기는 별도 namespace. 지연된 이전 응답은 selection guard로 버림. 조회 중 이전 본문·기준·제어를 비우고 잠금. 자유 대화 위치는 `RoomView.inTopic`으로 분리해 보존 |
| 최소 backend | `Workspace.snapshot`은 목록에 `roomId ?? null` metadata만 추가. `http/workspace.ts::FILES`는 새 view JS asset만 제공. SQL/영속 모델·event·idempotency·Providers.complete·engine·dispatch·인증·API/도구 한도·큐/Wiki/Codex 계약은 변경하지 않음 |

흑백 테마와 기존 이니셜 아바타를 사용하며 외부 코드/이미지 자산을 복사하지 않았다. `TopicChatView`는 같은 API/SSE 수명 위의 작은 view adapter이며, 순수 `topicPublishedTurns`를 기존 `RoomView.publishedTopicResults`도 재사용해 공개 판단을 중복 구현하지 않는다. 별도 서버·EventSource·DB·engine 계층을 만들지 않았다.

## 검증·실제 범위

환경: Node24.18.0/npm11.16.0, Chromium156.0.8078.4, Chrome DevTools MCP1.12.0. 모든 provider/계정/상태는 임시 fixture다.

| 방법 | 결과·실행 증거 |
| --- | --- |
| `npm run check` | strict TS·빌드, Node359 PASS, FAIL/SKIP0. 신규 Node5개는 라운드/미확정/이전 revision/재시도 공개 경계, 미등록 연결의 무변경 투영, raw 없는 방 metadata와 정적 asset을 검사 |
| 실제 Chromium+Chrome MCP 전체 | 62 PASS, FAIL/SKIP0. 기존 로그인/OAuth/device·토의/자료·browser·상주·작업큐·Wiki·Codex 승인/복구·IME/4폭 회귀 포함 |
| 마지막 위치 분리 보완 | 같은 최종 빌드에서 신규 UI5 PASS. 자유 대화 30메시지에서 위치200 → 주제 → 복귀 위치 유지, 주제의 위치123/장문 펼침도 별도 유지 |
| 다섯 주제·스무 전환 | 독립3+방 연결2를 한 목록에서 각각 조회, 20번 전환의 POST/모델 호출0·원래 discussions 변경0·다른 주제 본문0 |
| AI 등록 상태 | 실제 역할의 토커4+미등록 River1 표시, 현재 모의0/과거 모의 작성자 snapshot 유지, browser 오류 표시·토커 등록 자동 실행0 |
| 4폭·복구 | 390/768/1280/1440에서 주제/상세·가로 overflow0, 새로고침/두 탭별 선택, 지연 GET·조회 중 이전 제어 차단, script 태그 실행0 |
| 의견·공개 경계 | 입력/Enter POST0, 반영 버튼으로 선택 주제만 revise1/다른4주제 변경0·기존 공개 라운드 보존. 절반만 받은 라운드의 본문/미확정 delta 공개0 |
| 사용자 파일 | 기존 untracked35파일 SHA-256 전부 일치. `.env`·운영 DB·원래 계정/Chrome profile을 이 GUI 개발에서 변경하지 않음 |
| GitHub CI | 최종 PR head의 Check에서 전체 Node/브라우저·Codex 설치 계약을 별도 확인. 실제 thread/model 실행을 의미하지 않음 |

처음 회귀에서 상세 창/채팅의 결과 버튼 중복과 빠른 fixture 완료 전에 제어를 잡아야 하는 UI 검사를 수정했다. 버튼 이름을 구분하고, 실제 새 토의가 로드될 때까지 이전 주제 제어를 비웠다. 기존 전체 토의 검사는 fixture 지연1초로 일시정지·조건 보완·재개를 완료 전에 명시적으로 검사하며 원래 기대 결과는 유지한다.

실기기 수락·실계정 추론·dot/Muse 왕복·Codex thread 실행·운영 서비스 배포/재시작은 **NOT_RUN**이다. 기존 R8-D PARTIAL/미검증과 원래50 gate의 실제 수락 상태를 완료로 바꾸지 않는다.

## 사용·복귀

로그인 후 **채팅방**의 자유 대화 또는 주제를 선택한다. 작은 화면은 헤더 메뉴에서 주제와 전체 AI를 연다. **새 주제**는 기존 참여자/자료/범위 폼을 열며, resident가 켜져 있으면 방 on/참여자 준비/단일 root 조건과 focus API를 사용한다. resident flag off의 명시적 새 주제는 기존 독립 토의 API/한도를 사용하고 같은 주제 목록에 표시한다. 목록 클릭·새로고침·SSE는 실행을 재개하지 않는다.

**비교·근거·제어**에서 이전 상세 기능을 사용한다. API 연결만 있는 AI는 **토커 만들기**로 기존 폼을 열고 사용자가 모델/역할을 정해 저장한다. 방 토글은 자유 대화 설정이며 이미 시작한 주제의 멤버 snapshot을 몰래 바꾸지 않는다. 방 공용 작업큐/Wiki는 선택 주제와 범위를 구분한다.

복귀는 G0(현재 실행/미확정 대조) 뒤 같은 ID의 상세/원문을 유지하고 필요하면 이전 GUI 소스로 배포한다. 데이터 이관이 없으므로 과거 토의를 방에 재귀속하거나 DB restore로 기록을 지우지 않는다. 승인 계획/검사 이력과 실제 진행 상태도 보존한다. 이번 PR의 병합은 사용자 담당이며 새 운영 배포는 별도다.
