# 페이즈 8 / R8 — 통합 수락·복구·부하 검증

[페이즈 SSOT](../development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)의 R8를 진행했다. 기준은 PR #22 병합 main `8f7866388823e46ade64446343d53351c7ef85e5`, 작업 브랜치는 `codex/phase8-resident-acceptance-20261031`, 검증일은 2026-10-31 KST다. 테스트와 증거/운영 문서를 추가했으며 **제품 코드·API·schema·승인/예산·수락 기준 변경0**이다. 승인 전 계획을 변경하지 않았다.

**전체 릴리스 수락은 미완료다.** [50개 수락 manifest](./resident-acceptance-manifest.json)의 fixture PASS45·UNVERIFIED4·NOT_RUN1을 구분한다. R8-A의 완전 무인 주제 시작은 기존 코드에 없으므로 [미승인 변경 제안](../reviews/r8-topic-transition-decision-20261031.md)으로 분리했다. 실제 기기·계정·쓰기 수락이 남았으며 통합 테스트 성공을 실운영 완료로 바꾸지 않는다.

| 관측 | 결과 |
| --- | --- |
| 개발 환경 | 사용자 Ubuntu 개발 환경, Node 24.18.0 / npm 11.16.0 / Chrome 156.0.8078.47 / Chrome DevTools MCP 1.12.0 |
| 전체 회귀 | strict TypeScript·빌드·Node231 PASS, 실제 Chrome/MCP browser38 PASS. 각각 FAIL0/SKIP0 |
| 추가 검사 | Node9: 흐름/롤백/인계3·legacy/R1 이관2·부하1·Wiki 실제 SIGKILL3. browser2: 2탭/4화면 폭/재접속/이력·중복 승인 |
| 실행 구분 | 임시 DB·3모의 참여자·모의 Responses/분석·Codex RPC fixture. 실제 Chrome·HTTP/SSE·자식 프로세스 SIGKILL 사용 |
| 실환경 읽기 | 기존 운영 DB는 readOnly로 프로세스 안에서만 해석하고 출력/기록은 연결 종류·상태·개수로 제한. credential·개인 본문·token을 추출/출력하거나 문서에 복사하지 않음 |
| 미실행 | 운영 DB 이관·서비스 반영/재시작·실계정 호출·사용자 Codex thread·실제 파일 수정 NOT_RUN |

## 1. 실제로 확인한 흐름

명시된 예산·속도와 3개 모의 멤버/업무 역할을 설정하고 방을 한 번 켠다. 3명의 자유 발언에서 일감이 제안되고 기존 큐가 담당자를 픽업한다. 첫 보고→다른 참여자의 반려→이전 원문/반려 의견을 사용한 재작업→독립 검토 완료→reported Wiki v2→다음 발언에서 같은 버전·digest를 사용한다. 이 구간에는 사용자 메시지 추가·수동 일감 생성/검토·Wiki 복사 중계가 없다.

그 뒤 기존 **owner focus API1회**를 요청해 3명이 같은 Wiki snapshot으로 주제 토론을 진행하고 같은 roomId로 한 번 복귀한다. 전체 provider 동시 최대1·같은 requestId 재호출0이다. 자동 업무 구간은8호출, 주제 구간을 포함한 관측은23호출이다. 분석 업무이므로 이 흐름의 Codex job은0이며 실제 실행으로 주장하지 않는다. 별도 2탭 승인 검사와 기존 R6 회귀는 실제 executor의 RPC fixture를 사용한다.

현재의 참여자 응답 계약/MCP에는 topic 시작 intent가 없고 새 주제를 선택하는 권한은 owner에 있다. 따라서 위 검사는 R8-A의 무인 업무 부분과 기존 주제 복귀의 결합 증거이며 **완전 무인 topic 전환의 전체 PASS가 아니다.** 자동 전환 추가 또는 수락 문구 명시는 사용자 결정 전까지 적용하지 않는다.

아래 화면과 JSON은 비밀정보 없는 **임시 fixture**다. 실제 운영 계정/대화 화면이 아니다.

![통합 흐름 후 3인 방](./assets/phase8-20261031/chat-1440.png)

[모바일](./assets/phase8-20261031/chat-390.png) · [흐름 ID·원문 digest](./assets/phase8-20261031/flow.json) · [2탭·읽기/재접속](./assets/phase8-20261031/browser-tabs.json) · [한 번의 승인](./assets/phase8-20261031/browser-approval.json)

## 2. R8 수락 결과

| Gate | 결과·검증 방법 |
| --- | --- |
| R8-A | **UNVERIFIED(전체)** · `tests/resident-e2e.test.mjs`에서 3인·일감1·반려1/재작업·보고2/독립 리뷰2·Wiki1문서2버전·다음 발언 인용 PASS. owner focus1회/같은 방 복귀1 PASS. 추가 사용자 지시0의 topic 시작은 미구현·결정 대기 |
| R8-B | **PASS(negative fixture)** · 기존 provider1/6전송 crash/4인계 crash/4work crash/6실행 crash·off/예산/scope·출처/세대 거절 회귀 유지. 새 Wiki before_commit/notice_committed/edit_committed 실제 SIGKILL3에서도 20회 재시도→버전1/알림1·모델/job0 |
| R8-C | **PASS(Chrome fixture)** · 1440/1024/768/390px×2탭, 같은 큐/Wiki·원문/읽기 위치·새로고침2/양쪽 SSE 재접속·가로 overflow0. 같은 승인 상세를 두 탭에 둔 뒤 첫 승인1·늦은 승인409·원래 job/link/turn-start1. 실기기는 별도 |
| R8-D | **NOT_RUN** · 실제 GPT2계정/DeepSeek/dot/Muse·사용자 Codex thread·쓰기 수락 미실행. 별도 인증/허용 필요 |
| R8-E | **PASS(fixture)** · G0 quiescent→flag off runtime→기존 토의 생성/paused 기록·키 재조회→재활성화. 이전/신규 원문·Wiki·commands·event cursor·영수증 누락0/재전송0, 각100tick 추가 호출0 |
| R8-F | **PASS(fixture)** · 1,000원문+Wiki 알림100·업무100·Wiki100. page50 이내, 원문/digest 누락0, /api/state raw 본문0. 응답/heap/전체 state transaction 비용을 실제 측정 |
| R8-G | **PASS(fixture)** · 확정 보고/ready·review 업무/Wiki가 있는 상태에서 actor 인계1·같은 인계 명령2회/같은 room 멤버 등록2회. 원래 ID/예산/역할·원문 고정, 다른 actor의 기존 보고 리뷰 가능·옛 grant 거절·job 재전송/권한 확대0 |

50개 전체 gate의 원문·검사 파일·fixture/real 상태는 JSON manifest에 연결한다. 미확인은 R3-E 실기기, R4-D 실제 dot/Muse, R6-F 실세션/쓰기, R8-A 무인 topic 전환과 R8-D 혼합 실계정이다. R6-D는 미검증 쓰기를 막는 negative gate의 PASS이며 실제 격리 성공으로 해석하지 않는다.

## 3. 부하 측정과 범위

[부하 JSON](./assets/phase8-20261031/load.json)은 소스1,000메시지·100업무·100Wiki를 만들고 인증 HTTP로 전 원문을 다시 읽어 비교한 결과다. 새 Wiki 알림100을 포함한 방 메시지는1,100개다. 메시지·업무·Wiki의 **요청 page size50**을 검사했으며 기존 메시지/업무 API의 허용 최대100 계약을 바꾸지 않았다. Wiki 이력은 기존 최대50이다.

전체 SQLite state는 약2.39MB, /api/state는1,327바이트였다. 기존 Store.transact의 전체 읽기/직렬화/동기 SQLite commit을 no-op callback으로12회 측정했다. 재측정 중앙값14.52ms·p95/최대22.96ms, 프로세스 heap61,501,288바이트였으며 정확한 값은 JSON에 기록했다. 원문/상태는 측정 전후 동일하다. 측정값은 해당 fixture/프로세스/호스트의 관측이며 속도 수락 임계값이나 장기 호스트 용량 보장이 아니다. 장기 규모는 UNVERIFIED다. Store를 새 DB/분산 구조로 바꾸거나 기록을 삭제하지 않았다.

## 4. 코드·계약·이관·패턴

추가 파일은 [scenario fixture](../../tests/resident-acceptance-fixture.mjs), [통합](../../tests/resident-e2e.test.mjs), [부하](../../tests/resident-load.test.mjs), [Wiki crash](../../tests/resident-wiki-crash.test.mjs)·[자식 fixture](../../tests/fixtures/wiki-crash.mjs), [브라우저 통합](../../tests/browser/resident-e2e.test.mjs)다. 기존 tests/·제품 src/·scripts/·dependencies·CI 계약은 수정하지 않았다.

작은 composition/DI로 기존 Workspace·WorkQueue·Wiki·DispatchCoordinator·engine·CodexExecutor를 그대로 실행한다. fixture는 fake participant만 허용하고 다른 kind의 추론은 실패시킨다. 기존 provider hooks/receipt와 Store transaction·원문/command/event를 실제 사용한다. 새 workflow engine·실행기·DB·provider·credential 저장소를 만들지 않았다. 검사에서 데이터 준비·완료 조건·실제 관측을 구분한다. [디자인 패턴 지침](../development-guidelines.md)을 따른다.

기존 main v1과 R1 resident를 R5/R6/R7 marker까지 읽고 이전 토의·자료·원문·명령 결과와 roomId를 보존하는 두 이관 fixture도 확인했다. 새 Wiki/업무/권한을 과거 개인 기억에서 채우지 않는다. 본 단계의 제품 이관/새 schema 변경은0이다.

## 5. 실행 명령과 남은 실환경

~~~bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp \
node --test --test-reporter=spec tests/browser/*.test.mjs
~~~

기본 browser 명령에서 MCP를 생략해 SKIP되면 전체38 PASS로 기록하지 않는다. 설치 Codex schema 검사는 별도 `WJ_CODEX_BINARY=/설치/codex npm run test:codex-contract`이며 모델/thread를 실행하지 않는다. 기존 CI는 이 계약과 전체 Node/browser를 검사한다. 최종 commit/CI 링크는 R8 PR의 확인된 head 결과로 기록한다.

읽기 전용 운영 metadata는 OAuth auth_required/모델0, browser 연결1(필수 dot/Muse 두 연결 미충족), DeepSeek/Codex 미등록, resident flag off/운영 resident state 미이관이었다. 이는 기존 Muse 한 번의 대조 이력을 부정하는 설명이 아니라 이번 R8 혼합 수락 준비 상태다. 실제 호출·로그인·키/프로필 조작·서비스 재시작은 하지 않았다. R8-D는 사용자 인증·허용 후 실제 receipt·모델 목록·응답/후속 맥락·stream/usage·원래 thread·실제 승인/명령 결과를 대조해야 한다. 운영 적용 없이 현재 화면이 R8 코드로 바뀌었다고 주장하지 않는다.

## 6. 복귀·미결정

[G0](../resident-implementation-plan.md#2-공통-롤백-g0--모든-단계의-선행-조건)에 따라 새 방/업무 예약·topic dispatch를 막고 prepared/running/unconfirmed와 queued/승인/대조 job을 원래 ID로 대조한다. quiescent 전 flag만 끄고 예전 executor를 시작하지 않는다. 원래 intent/job/receipt·message/Wiki/충돌/tombstone·command를 삭제하거나 백업 복원으로 되돌리지 않는다. fixture의 flag off/read-only/재활성화 성공을 운영 호스트의 실제 전환 성공으로 표시하지 않는다.

사용자 결정은 기존 U1/U2 기본 예산/속도, U3 실제 계정/역할/범위와 별도 실계정 허용을 유지한다. 추가 R8-A 결정은 링크한 미승인 제안에만 기록했다. 자동 주제 intent·그 권한/이관·수락 변경은 승인 전 구현하지 않았다. 이후 페이즈를 새로 만들거나 완료 문구를 완화하지 않았다. PR 병합은 사용자 담당이다.

로컬 링크/앵커128개 오류0, 기존 50개 수락 문구/숫자 변경0, 사용자 파일35개 hash 변화0, git diff --check 오류0을 확인했다. 별도 초안 PR로 검토 가능한 검사·증거를 제출하며 R8-A 승인 전 전체 완료/자동 전환 구현으로 표시하지 않는다.
