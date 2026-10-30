# 페이즈 3 실행 기록 — 기존 작업실의 단톡방 GUI

진행 상태는 [개발 페이즈 SSOT](../development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)를 따른다. 사용자 지시 “머지 완료. 다음 페이즈 개발 승인”으로 R3를 구현했다. 계획 범위·순서·수락 기준을 변경하지 않았다. 아래 PASS는 임시 DB·모의 참여자·실제 Chromium fixture 결과이며 실계정·실제 기기 완료와 구분한다.

| 항목 | 확인 |
| --- | --- |
| 날짜 / base | 2026-10-30 KST / main ecae6a6361946b942c7189c3c21b8d20fbb4c4a9 (PR #14 사용자 병합, 66812c5와 동일 tree) |
| 작업 브랜치 | codex/phase3-chatroom-gui-20261030 |
| 코드 식별 | 이 기록과 같은 PR의 commit·CI로 추적. 고정 설계 근거 C/P는 유지 |
| 검사 환경 | Ubuntu의 임시 SQLite·loopback fixture HTTP, Node 24.18.0 / npm 11.16.0 |
| 실제 도구 | Chrome 156.0.8078.47 / Chrome DevTools MCP 1.12.0 |
| strict TypeScript·빌드·Node | 118 PASS / 0 FAIL / 0 SKIP |
| 실제 Chrome/MCP fixture | 15 PASS / 0 FAIL / 0 SKIP (기존 9 + 신규 6) |
| 실제 휴대전화/태블릿·한국어 IME·가상 키보드·터치 | UNVERIFIED / NOT_RUN. 자동 DOM event·viewport 검사와 구분 |
| 실제 계정·OAuth 동의·모델 호출·Codex 원격 작업 | NOT_RUN. 도구 프로세스·DOM fixture 성공이 실계정 응답 성공을 뜻하지 않음 |
| 운영 서비스·.env·DB·접속 키·vault·Chrome profile·Tailscale | 변경/배포/재시작하지 않음. build의 dist 갱신만 수행 |

## 1. 수락 결과

| Gate | 판정 | 명령·화면·실행 증거 |
| --- | --- | --- |
| R3-A | PASS (자동) | 390×844 / 768×1000 / 1024×1000 / 1440×1000에서 document 가로 overflow 0. 입력/멘션, 참여 토글, 보조 패널, Codex 승인/거절·기존 문맥 복구에 접근. 좁은 화면은 native dialog drawer, 넓은 화면은 3열. 네 화면을 test-results/resident/R3/room-{width}.png로 생성 |
| R3-B | PASS | 90,000자 fixture 원문→500자 preview→전체 펼침→접기→새로고침 재펼침에서 원문·SHA-256 일치. 인용 답장·멘션 ID 보존, HTML 실행0. 과거 55개를 읽는 중 신규20개가 와도 강제 하단 이동0, 오래된 anchor가 최신50개 밖이어도 재조회·새로고침 후 원래 읽기 위치 보존 |
| R3-C | PASS | 신규 이벤트20개를 각20회 중복 주입, fixture SSE 소켓을 실제로 끊어 2회 재연결→신규 메시지20개(기존55 포함75개), 알림 중복0, provider 추가 호출0, EventSource 인스턴스1. test-results/resident/R3/reconnect.json 생성 |
| R3-D | PASS | 기존 Chrome/MCP DOM·별도 GPT 로그인 context·로컬 자료·talker 설정·topic pause/revise/resume/비교 브라우저 회귀9개 유지. 새 방에서 기존 focus 생성→종료→같은 방 복귀·누적 ledger 유지. legacy history/원본·복구/Browser 수동 연결 폼/Codex 승인 접근 확인 |
| R3-E | 자동 부분 PASS / 실기기 UNVERIFIED | compositionstart→isComposing Enter와 조합 중 일반 Enter의 전송0, compositionend 후 확정 Enter1. native button에 keyboard Enter로 답장 실행, hover 없이 답장/원문/멘션/패널 버튼 노출. 실제 기기 IME·가상 키보드·터치 부분은 실행하지 않았으며 gate 전체 완료로 표시하지 않음 |
| R3-F | PASS (fixture) | 응답대기·도구진행·관측중단·이전세대 4fixture의 상태와 원래 시각을 그대로 표시. 원본 이벤트20회→알림1, 자기 알림100개→추가알림0·모델/셸 호출0. API100회 조회에도 event/turn 추가0. PRIVATE prompt/raw/job 출력은 상태 DTO에 포함0 |
| 전송/설정 실패 | PASS | POST는 저장됐지만 응답 연결이 끊기거나 JSON이 잘리면 입력 보존·전송 잠금, Enter 재전송0. 원래 이력 조회 후 owner가 잠금 해제. 다른 탭이 설정을 저장한 뒤 열린 이전 폼 제출→409, 상대 예산 보존·조용한 덮어쓰기0 |

검사 명령:

~~~bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/실제/별도설치/node_modules/.bin/chrome-devtools-mcp \
node --test --test-reporter=spec tests/browser/*.test.mjs
~~~

새 수락 검사는 [브라우저 fixture](../../tests/browser/resident-room.test.mjs)와 [상태 projection 검사](../../tests/resident-status.test.mjs)다. 스크린샷·JSON은 개인 원문이 없는 synthetic fixture이며 gitignored test-results 아래에서 재생성된다. 기본 browser 명령에서 MCP를 설치/지정하지 않아 SKIP된 결과를 15개 전체 PASS로 쓰지 않는다.

## 2. 변경 경계·패턴·데이터

| 경계 | 유지/변경 | 구현과 이유 |
| --- | --- | --- |
| 운영 entry·UI | 기존 control 개조 | [control.html](../../src/web/control.html)·[control.css](../../src/web/control.css)·[control.ts](../../src/web/control.ts)의 기존 로그인/API/SSE/폼/renderer 유지. room 모드의 왼쪽 멤버·중앙 말풍선/입력·오른쪽 보드와 좁은 화면 dialog를 추가. 기존 topic/연결/실행은 동일 앱 안의 상세 화면 |
| client 경계 | 작은 Adapter/DI | [RoomView](../../src/web/room-view.ts)에 기존 api/refresh/openView/openDiscussion을 주입. 새 framework·별도 인증·EventSource·event bus 없음. ID별 DOM 보존과 로컬 읽기/접힘/테마 상태로 SSE 갱신 때 입력·스크롤 재생성을 막음 |
| 상태 관측·알림 | 계획한 순수 projection | [projectResidentStatus](../../src/workspace/resident-status.ts)가 Store의 이미 확보한 연결·turn·Observation·job와 마지막250개 event에서 공개 DTO 생성. [ResidentStore.room](../../src/workspace/resident-store.ts)에 additive status 필드. raw prompt/응답·계정 identity·private 자료·capability 전체를 DTO에 복사하지 않음 |
| system 알림 | 기존 journal의 화면 투영 | 허용한 상태 이벤트만 같은 event ID의 system 카드로 표시. 새로운 RoomMessage/event/모니터를 저장하지 않아 자기 알림이 dispatch/다음 알림 입력이 되지 않음. heartbeat/delta/자기 알림은 입력 allowlist 밖. 250event 범위를 벗어난 알림·진행 시각을 임의 재구성하지 않고 기존 시각/미관측 보존 |
| owner API | 기존 endpoint 소비 | /api/rooms/:id, messages의 50개 페이지/원문, turns/checkpoints/reconcile, control/focus/handoff 유지. 상태 조회 필드와 /room-view.js 정적 자산만 additive. 전역 SSE cursor / 방 sequence / turn offset 분리 |
| Store·DB·이관 | 유지 / 신규 이관0 | Store.transact·schemaVersion/user_version·journal/idempotency 변경0. 원본·방·메시지·lease/receipt/예산 ledger를 삭제/변환하지 않음. 기존 wj.discussion 키 유지, 신규 wj.room.*만 사용 |
| providers·실행·승인 | 유지 | Providers.complete/topic parseReply·resident JSON·OAuth/DeepSeek/BrowserBridge·Codex approval/sandbox·dispatch 변경0. 렌더/재접속은 조회만 하고 on/전송/대조/승인은 소유자 동작에서 호출 |

GUI와 상태의 작은 Adapter/DI·공개 projection으로 충분하므로 backend·인증·topic pipeline을 다시 만들지 않았다. 오랜 읽기 위치를 복원할 때도 기존 원문 endpoint에서 실제 sequence를 찾고 페이지 limit=50을 유지한다. 긴 발언은 화면만 접으며 원문 해시를 확인한다. 자동 복원 원문은 기존 세대·원래 ID에 연결한다.

외부 참조는 기존에 확인한 [Moris-kr/ai-chatroom 고정 revision](https://github.com/Moris-kr/ai-chatroom/tree/817c165b92ce42f5a96504198a346b936d3e2f38)의 배치·상호작용만 참고했다. 이번 파일은 기존 control과 자체 코드이며 외부 JS/CSS/캐릭터/이미지 복사0이다. 파일별 MIT 코드 도입 목록은 없으며, 이후 실제 복사 시 출처·파일·라이선스 고지가 필요하다는 계획을 유지한다.

## 3. 사용과 복구

- WJ_RESIDENT_ENABLED=true인 새 접근은 채팅방을 기본 표시한다. false이면 기존 토의 화면이 기본이고, 이미 있는 방은 읽을 수 있으나 새 발언·방 제어는 차단된다. 실제 .env를 자동 변경하지 않는다.
- 방 설정에 누적 요청·보고 토큰·tool 상한·종료 시각과 발언 간격·idle/pass·휴면 값을 모두 직접 입력한다. 값 없는 초기 방은 off다. 누적 ledger는 갱신 시에도 보존하며 금액/정확한 잔여율을 만들어 표시하지 않는다.
- 왼쪽 참여 토글은 다음 방 발언 후보 선택이며 계정 로그아웃/기존 topic 제외와 다르다. 실제 account/model/effort는 기존 연결 상세에서 선택한다. xhigh 기본값과 조절 경로는 유지한다.
- 방 끄기는 새 발언을 막으며 실행 중인 Codex 취소를 뜻하지 않는다. topic pause·Codex 중단/승인·미확정 대조는 원래 상세 UI에서 처리한다. 원본과 복구에서 resident turn·receipt·원문과 체크포인트를 조회/대조/인계할 수 있다.
- 답장은 원래 message ID를, 멘션은 선택한 participant ID를 전송한다. @추천과 직접 선택을 제공한다. Enter는 확정 입력만 전송하고 Shift+Enter는 줄바꿈한다.
- 응답이 불분명하면 같은 입력을 자동 재전송하지 않는다. 원래 이력을 조회하고 소유자가 대조한 뒤 입력 잠금을 직접 해제한다. SSE나 새로고침은 provider/Codex 재전송 사유가 아니다.
- 상태 카드의 관측 없음·이전 세대·도구/응답·마지막 발언/진행을 따로 확인한다. 화면 연결/채팅 heartbeat로 외부 job 성공·실패를 확정하지 않는다.

## 4. 롤백과 후속 영향

순수 view 복귀는 **토의 작업실**을 선택한다. 같은 로그인/Store/API/SSE를 사용하며 메시지·로컬 cursor/테마·펼침은 삭제하지 않는다. 서버까지 R2로 되돌릴 때는 [G0](../resident-implementation-plan.md#2-공통-롤백-g0--모든-단계의-선행-조건)를 적용하고 진행/미확정 turn·job을 원래 ID로 대조한다. flag만 끄거나 DB backup restore로 실행 이력을 지우는 복귀는 금지다.

| 후속 페이즈 | 이번 변경이 남기는 접점 |
| --- | --- |
| 4 연결 편의성 | 동일 connections 화면/browser-form 유지. discovery/preset은 해당 폼/기존 probe에 연결하면 되며 새 transport가 필요하지 않음 |
| 5 역할·작업큐 | RoomView의 보드/participant ID와 원래 room/turn 참조 사용 가능. proposals는 not_run으로 표시하며 pickup/done을 꾸미지 않음. 실제 role/queue 모델은 미구현 |
| 6 실제 실행 | 기존 실행 상세의 승인/취소/대조 UI를 유지하고 방에서 링크. WorkJobLink·review 정책·실파일 검증은 미구현이며 이번 GUI가 권한을 확대하지 않음 |
| 7 Wiki | 같은 보드에 후속 Wiki projection을 얹을 수 있음. 현재 Wiki 본문/CAS/scoped intent 구현 없음, 모델 제안은 미실행 보존 |
| 8 수락 | 이번 자동 회귀와 네 viewport fixture를 재사용. 실제 Tailnet 기기·IME/터치·혼합 계정·장기 부하·업무/Wiki 전체 흐름·G0 재검증은 미확인 |

범위/계약을 바꿀 필요는 발생하지 않았다. U1/U2/U3와 기존 모든 gate는 유지한다. 실제 기기 부분이 남은 R3-E를 자동 PASS로 바꾸지 않으며, 단계·완료 기준 변경이 필요해지면 후속 페이즈 총변경량을 먼저 검토해 승인받는다. 이번 PR은 구현·자동 검증의 제출이며 사용자 병합과 운영 반영은 별도다.
