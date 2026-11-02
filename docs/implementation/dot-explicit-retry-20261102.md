# dot 중단 확인 후 명시 재시도 — 2026-11-02

## 승인·기준·실환경 경계

사용자가 PR #43 병합 후 다음 단계 진행을 요청했다. main `2447ada989ecfb639ab90bcff53608e264162ffd`에서 기존 복구 절차를 대조한 결과, 전달·claim 후 중단된 dot 요청은 미전송으로 기록할 수 없고 skip은 첫 검토 라운드를 완성하지 못했다. [영향 검토](../reviews/dot-explicit-retry-impact-20261102.md)를 제출한 뒤 사용자가 **명시 재시도 복구 개발**을 승인했다.

승인한 D3/D4/D5 보완을 별도 작업 브랜치에 구현했다. 운영 main 배포·감시 재등록·새 모델 호출·실제 미확정 대조 명령은 **NOT_RUN**이다. D5-F 실계정 수락은 계속 **BLOCKED**이며 자동 검사를 실제 native 답변 수락으로 세지 않는다.

운영 데이터의 읽기 전용 대조에서는 완료8개·dot 미확정1개·방 off·Muse 잠금 true를 확인했다. 원래 고정 입력69,621 bytes가16페이지·최대11,895 RPC bytes로 복원되고 digest가 같았다. 현재 입력/과제에 새 순수 복구 검증 함수도 통과하지만 **소유자의 실제 종료 확인을 적용하거나 요청을 재개한 것은 아니다**. `.env`·DB·사용자 untracked35개·기존 인증 정보/Chrome profile/다른 서비스는 그대로다.

## 변경 계약

| 파일·심볼 | 변경과 유지 |
| --- | --- |
| `src/workspace/dot-mcp-policy.ts::assertDotRetryAfterStop` | native 주제 토의·현재 task/latest turn·revision/phase/round·문맥/identity·held/미확정 lease·reply 없음·고정 입력/Wiki 가시성을 확인하는 순수 guard. 다른 미확정/실행 슬롯이 있으면 거절한다. 과거 요청 종료와 새 grant 권한을 분리하므로 room off/회수 상태에서도 **준비만** 가능하다. |
| `src/workspace/engine.ts::DiscussionEngine.control` | 기존 owner `reconcile`에 `resolution: retry_after_stop`, `stoppedWithoutSubmit: true`, 비어 있지 않은1000자 이하 `note`를 추가한다. 같은 transaction에 감사 event·이전 turn 실패 종료·같은 task pending·기존 정산·idempotency를 저장한다. 기존 세 복구 선택지/complete/Store/DB 버전은 유지한다. |
| `src/web/control.ts::renderRecords/modal` | 주제의 `원본과 복구`에 공식 dot 전용 **중단 확인 후 재시도 준비**를 표시한다. 필수 확인 체크/사유를 받고 기존 owner API로 전달한다. 새 전송은 별도 **이어가기**가 필요하다고 표시한다. Muse/API의 기존 복구 버튼과 다른 폼은 유지한다. |
| `tests/dot-mcp-fixture.mjs::stoppedDotTopicFixture` | 실제 mailbox/claim/page read 후 timeout을 만드는 격리 fixture를 재사용한다. 이미 받은 초안은 기존 라운드 공개 경로로 공개한 뒤 보존 기준을 잡는다. |
| Node/SIGKILL/Chromium 검사 | 원래 수락 답변 보존, 명령20회/늦은 답변/옛 credential/입력·권한 변경, 복구 commit 후 및 새 요청 페이지 중간의 강제 종료, 확인 UI·별도 resume를 검사한다. |

`discussion.retry_prepared` event는 원래 `turnId/taskId/revision`, `previousError`, 소유자의 중단·미제출 확인과 `note`를 보존한다. 원래 turn은 `owner_confirmed_retry_after_stop` 실패 이력으로 남고, 새 실행은 기존 엔진이 **새 requestId**를 발급한다. 두 turn의 같은 taskId로 원래/새 시도를 대조한다. 이미 받은 답변을 버리고 다시 실행하거나 원래 held 요청을 재활성화하지 않는다.

grant/구독/방·입력·단일 슬롯·API 일일 정책·300초 timeout을 새 예약/실행에서 그대로 검사한다. owner 준비 명령은 off/회수 상태를 바꾸지 않고 API 사용 이력을 초기화하지 않는다. 늦은 옛 답변은 권한에 따라 거절/격리하며 새 과제의 결과로 공개하지 않는다. 외부 native 실행 종료를 앱이 독립적으로 증명하는 기능은 아니므로 확인이 불명확하면 기존 미확정 대조를 유지해야 한다.

기존 작은 policy 함수·Adapter·transaction·DOM modal에 결합했으며 별도 복구 프레임워크/모델/이관은 없다. D1/D2 Events 계약, R1 저장, R5 업무·R6 실행·R7 Wiki 계약, Muse/provider 연결은 변경0이다. D4 복구 UI·D5 회귀만 추가하며 두 라운드 및 원래50 gate의 기준을 낮추지 않는다.

## 검사 증거

Node24.18.0/npm11.16.0, Chromium156.0.8078.4/Chrome DevTools MCP1.12.0, 격리 fixture 사용. 실제 계정/운영 DB에 검사 명령을 보내지 않았다.

| 검사 | 명령·관측 | 결과 |
| --- | --- | --- |
| 전체 타입·빌드·Node | `npm run check` | **529 PASS, fail0/skip0**. 기존490개에서 신규39개(복구3개+거절 하위34개+강제 종료2개) 추가 |
| 명시 복구·중복/늦은 답변 | `tests/dot-mcp.test.mjs` 신규 검사 | 같은 명령20회→audit1개·새 전송0; 명시 resume→대상 과제 새 수락1개; 옛 claim으로 새 입력 조회 거절; 옛 submit 격리; 기존 완료5개 동일; 두 검토 라운드 각각3명 공개 |
| 거절/원자성 | 같은 파일의34개 하위 사례 | 확인 누락/형식·사유·다른 turn/revision·종료 상태·non-native·결과 존재·과제/세대/identity·Codex job·입력/Wiki 변경·경합 실행 모두 AppError, state/event 변경0 |
| 실제 SIGKILL | `node --test tests/dot-mcp-restart.test.mjs` | 신규2개 PASS. 복구 commit 직후 pending 보존 및 새 요청 page0 후 held 보존. 재시작·명령20회 재생·pump/tick에도 새 callback0, 원래/새 요청·기존 공개 원문 보존 |
| 실제 Chromium 복구 UI | 설치 Chromium을 지정한 `tests/browser/dot-connection.test.mjs` 신규 검사 | **1 PASS**. Muse/API 카드에 새 선택지0, dot1개. 확인 체크·근거 누락 시 요청0, 완성 시 owner 명령1개/계속 blocked, 완료 답변 동일·별도 이어가기 가능·모델 호출0 |
| 전체 Chromium/Chrome MCP | 설치 도구 경로를 지정한 `npm run test:browser` | **66 PASS, fail0/skip0**. 기존65개에서 복구 UI1개 추가. 실제 Chromium·Chrome MCP 프로세스의 Muse 합성 왕복 회귀 포함 |

관련 신규 검사는 전체 검사에 포함된다. 서로 중복된 수치를 합산하지 않는다. UI 합성 화면은 `test-results/dot-D5/owner-retry-ui.png`에 생성한다.

승인 후 구현은11파일·337줄(add+delete), 영향 제안서 포함12파일·420줄이며 제품 소스는3파일이다. 기존 fixture/정산을 재사용해 사전 예상350~650줄보다 작다. 나머지는 Node/브라우저 검사와 SSOT/운영/실행 기록이다. 신규 DB/의존성·계정/포트 설정 변경은 없다. 최종 PR의 별도 CI는 PR checks에서 확인한다.

개발 중 새 fixture의 실패는 원인을 대조해 수정했다. 옛 claim 객체의 requestId가 새 ID를 덮어쓰던 검사 인자 순서, 초안 공개 전/후를 혼동한 복구 baseline, UI fixture의 소유자 session/참조 복사·채팅방 이동을 바로잡았다. 권한 부족 시 기존 엔진은 running 상태에 `dot_grant_required` 이유로 기다리므로 검사도 그 상태와 신규 요청0을 확인한다. 제품 timeout·권한·수락 기준을 완화해 통과시키지 않았다.

## 배포·실계정 수락·복귀

병합 후 배포와 새 실계정 검증 범위를 별도 허용받아 진행한다. 과거30분 창을 재사용하지 않는다. 실제 토의의 완료8개·원래 미확정/claim·native 실행 종료·미제출을 다시 대조하고, 소유자가 확인한 경우만 준비한다. 기존 연결/구독의 현 상태를 확인한 뒤 같은 토의를 resume하며, native가 모든 페이지를 읽고 새 request에 답변/receipt를 제출하는지 관측한다.

정상 경로의 남은 토의는 검토1 잔여2 + 검토2의5 + 수정5 + 종합1 + 종합 검토4 =17회, 같은 방 dot 후속1회다. 실제 호출 허용 범위·시간/예약 상한과 오늘 API 잔여는 재개 직전 확인한다. 마지막 관측 기준 DeepSeek High 잔여6회/165,092 보고 토큰이며 날짜가 바뀌면 다시 산정한다. 실제 Codex/실기기/장기 운영은 별도 수락이다.

문제가 생기면 원래 방 off·토의 pause/미확정 대조·Muse 잠금·native 감시/전용 grant/Tunnel 정리를 수행하고 정상 서비스로 복귀한다. 이전 빌드로 돌아가도 준비된 pending task는 blocked/paused 상태에서 명시 resume 전까지 실행되지 않는다. DB 이관이 없어 원래 기록·새 수락·감사 event를 백업으로 덮어쓸 필요가 없다. 옛 버전 UI에는 새 준비 버튼이 없으므로 그 상태에서 미전송/skip으로 재표기하지 않는다.
