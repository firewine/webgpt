# dot 고정 입력 분할 조회 — 2026-11-02

## 승인과 판정

기준 main은 `3bc031e51c98928eb396837b7831859524d79f76`이다. [실계정 재개 기록](./dot-mcp-resume-d5-20261102.md)의 dot 입력 조회 성공 뒤 `Warning: truncated output` 보고에 대해 [영향 검토](../reviews/dot-input-paging-impact-20261102.md)를 제출했고, 사용자가 **분할 조회 계획 개정·개발**을 승인했다. 별도 작업 브랜치에서 D3 조회·D4 감시 지침·D5 회귀를 보완했다.

**구현·자동 검사 PASS, 운영 적용/실제 native 재검증 NOT_RUN, D5-F BLOCKED 유지.** 이미 수락된 답변8개와 미확정 요청1개는 보존한다. 이번 보완 개발에서는 실제 모델 호출·감시 재등록·서비스 재시작을 하지 않았다. Muse는 기존 browser 연결을 유지한다.

## 변경 계약과 파일

| 대상 | 변경과 유지 계약 |
| --- | --- |
| `src/connections/dot-mcp.ts::DotMcpAdapter.call/list` | 기존 `dot_turn_get`에 선택적 정수 `inputPage`를 추가한다. 생략하면 기존 metadata/전체 입력 응답 그대로다. 페이지 요청은 같은 requestId와 winning attemptId/attemptToken을 요구하며 기존 scope/권한·세대·lease·Wiki 접근 검사를 매번 통과해야 한다. claim/submit/완료 처리 계약은 유지한다. |
| `src/connections/dot-input-pages.ts::dotInputPage` (신규) | 고정 `{prompt,history}`의 JSON 문자열을 무손실 분할하는 순수 helper다. escaping과 UTF-8·surrogate pair를 고려하며 입력/DB를 수정하지 않는다. 응답은 `encoding`, `pageIndex`, `pageCount`, `nextPage`, `text` 및 바깥 `requestId/inputDigest`를 담는다. |
| 같은 파일의 `dotToolResult`, `src/http/mcp-events.ts::McpEvents.handle` | 기존 content/structuredContent 결과 포장을 공통화해 실제 두 표현의 크기를 계산한다. 기존 도구/Events 결과 shape는 유지한다. 페이지 metadata의 최대 크기와 JSON-RPC 여유256 bytes를 예약한다. 수락 검사에는200자 ASCII RPC ID까지 포함한다. |
| `plugins/webjjoku-dot/README.md`, `docs/dot-connection-runbook.md` | page0부터 nextPage:null까지 같은 요청/digest·총 페이지/누락0을 확인한다. 페이지 하나의 한 표현만 읽으며 모든 원문을 다시 한 도구 출력에 합치지 않는다. 실제 도구 스키마 갱신과 기존 감시 지시 갱신을 안내한다. |
| Node·stdio·Chrome MCP 회귀 | 별도 새로운 실행기를 만들지 않고 기존 fixture에서 페이지 조회를 사용한다. 원문 결합/digest 대조 후 원래 JSON 답변을 같은 claim으로 제출한다. |

원래 grant·request·입력 digest·claim credential을 재사용하며 신규 DB 모델/이관0, 새 도구/권한0이다. 페이지 경계는 receipt/status 변화와 무관하게 고정된다. 같은 페이지20회 조회는 새 turn/claim/전송·공개·사용량 기록을 만들지 않는다. 늦은 페이지에서 권한/세대가 달라지면 기존 stale/auth 오류로 중단한다.

기존 Adapter에 작은 순수 변환 함수를 결합했다. provider/Store/엔진을 재작성하거나 페이지를 별도 업무 상태로 저장하지 않는다. R1·R5~R7 데이터/계약, R3 GUI, D1 권한·D2 Events는 변경0이다. R2/R8의 단일 실행/대조와 R4 Muse는 기존 통합 fixture로 회귀한다. 원래180,000자 입력 한도·300초 timeout·API 일일 정책·Human 승인·50 gate는 유지한다.

승인 후 구현 보완은14파일·약330줄(add+delete)이며, 앞선 실계정 사실 기록/영향 검토서의 갱신2파일은 별도다. 사전 예상10~14파일·450~750줄보다 작은 것은 기존 입력/권한 처리와 통합 fixture를 재사용했기 때문이다. 수락 범위나 후속 페이즈를 축소하지 않는다.

## 실행 증거

환경: Node24.18.0, npm11.16.0, Chromium156.0.8078.4, Chrome DevTools MCP1.12.0. 모두 격리된 합성 fixture이며 실제 계정·실제 Muse·native dot 모델의 답변은 아니다.

| 검사 | 명령/관측 방법 | 결과 |
| --- | --- | --- |
| 전체 타입/빌드/Node | `npm run check` | **490 PASS, fail0, skip0**. 기준486개에서 무손실2·조회권한/반복1·페이지 중간 SIGKILL1 추가 |
| 긴 원문·조회 경계 | `node --test tests/dot-mcp.test.mjs` | **21 PASS**. 35,812자 규모/179,000자 규모의 합성 입력, 주장12개/처음·끝 근거·한글/emoji/제어문자 복원, 모든 페이지 digest 일치와 완성 RPC 응답12,000 bytes 이하 |
| 강제 종료·복구 | `node --test tests/dot-mcp-restart.test.mjs` | **7 PASS**. 실제 다중 페이지의 첫 페이지 후 SIGKILL/재시작→원래 held 보존, 다음 페이지 stale, 자동 재전송/게시0. 원래 사용자 메시지 보존 |
| 전체 브라우저 | 설치한 `WJ_TEST_CHROME_MCP`, `WJ_TEST_CHROMIUM_EXECUTABLE`을 지정해 `node --test tests/browser/*.test.mjs` | **65 PASS, fail0, skip0**. 실제 Chromium/Chrome MCP 프로세스 사용 |
| 다중 페이지·Muse 통합 | 같은 환경의 `node --test tests/browser/dot-mixed.test.mjs` | **1 PASS**. 두 검토 라운드와 상주 복귀, dot 합성 답변6개·Muse 합성 전송6개, 입력별1~7페이지·합20페이지, 최대11,296 bytes. 모든 digest 일치, 기존 thread/초안 보호, 동시 provider 최대1 |
| CI 실패 대조·혼합 업무 통합 | `node --test tests/dot-acceptance.test.mjs` | **4 PASS**, 전체23.3초/혼합22.4초. dot 합성 답변9개, 입력별2~63페이지·합220페이지·최대11,302 bytes·전부 digest 일치. 장문을3명이 읽고 업무 재검토/수정→Wiki2판→자동 주제 검토2라운드→같은 방 복귀 |

위21/7/1/4개는 전체 검사와 중복되는 관련 검사 수이며 합산해 별도 총합을 만들지 않는다. 최종 다중 페이지 SIGKILL fixture의 보존 assertion을 보완한 뒤7개를 다시 통과했고, 실제 혼합 입력이2페이지 이상임을 확인하는 assertion을 추가한 뒤 혼합1개를 다시 통과했다. Node 전체/브라우저 전체와 제품 소스는 같다. 초기에 새 fixture의 기존 메시지를0개로 기대한 검사가 실패해 원래 snapshot과 비교하도록 바로잡았다.

첫 [PR #43 CI](https://github.com/firewine/webgpt/actions/runs/41405024675)는 Node489 PASS/1 FAIL이었다. D5-A의 주제 완료 대기25초가 소진됐으며 나머지 신규 분할·권한·복구 검사는 통과했다. 로컬 흐름도 약23~25초여서 **검사 전용 대기**를50초로 조정했으나 [두 번째 CI](https://github.com/firewine/webgpt/actions/runs/41405897515)도 같은 대기가 끝났다. 시간 확대만으로 해결됐다고 판단하지 않았다.

추가 코드 대조에서 합성 webhook 수신기가 모델 작업 완료까지 HTTP 수신 확인을 지연해 기존10초 callback 제한과 결합하고, 별도5ms pump가 이미 시작된 실제 worker와 중복 조회하는 것을 확인했다. fixture는 callback을 즉시 수신 확인하고 답변 작업을 별도 실행하며 기존 worker를 그대로 사용하도록 수정했다. D5-B에서는 답변 작업을 의도적으로 보류한 상태에서 delivery가 완료되고 reply는 아직 없음을 확인한다. D5-A 완료 관측은 매10ms 전체 DB 읽기 대신 commit event를 사용하고, 실패 시 현재 페이지/토론/전달 상태만 진단한다. 제품의 webhook/turn timeout·예산/수락 조건은 바꾸지 않았다. 수정 후 관련 통합4개 PASS, 최종 전체 CI는 PR checks에서 별도로 확인한다.

브라우저 통합의 수치/원문 보존 판정은 실행 시 생성하는 `test-results/dot-D5/muse-mixed.json`에 남는다. 해당 artifact는 `isolated_fixture`/`realAccounts:NOT_RUN`으로 표시하며 공개 저장소에 실제 대화나 키를 넣지 않는다. 최종 PR의 CI 상태는 PR checks에서 확인한다.

## 남은 실환경 수락과 복귀

실제 native dot에서의 절단 위치/정확한 플랫폼 한도와 다중 조회 지연은 **UNVERIFIED**다. 12,000 bytes는 이 서비스의 검사 기준이며 OpenAI가 보장한 한도가 아니다. 페이지 수가 많아도 원래300초를 자동 연장하지 않는다. 원문을 전부 읽기 전에 시간/권한 오류나 출력 절단이 생기면 답변 제출을 멈추고 기존 미확정 대조로 돌아간다.

병합 후 별도 서버 적용·실계정 범위 허용을 받으면 새 스키마의 `inputPage` 노출을 확인하고 기존 native 감시 지시를 갱신한다. 새 OAuth/터널 생성은 필요 없다. 같은 토론의 미확정 요청은 원래 실행과 먼저 대조하며, 단순 재개/새 claim으로 반복하지 않는다. 모든 입력 페이지 읽기→기존 JSON 답변→receipt/현재 공개→남은 두 라운드/후속 수락이 실제로 관측되기 전 D5-F를 완료하지 않는다.

롤백은 dot 발화 off·진행/미확정 대조·감시 중지 후 이전 바이너리로 복귀하고 도구/감시 지침을 그 버전에 맞춘다. DB 이관이 없어 기록 복원/삭제는 필요 없다. Muse·기존 완료 답변·원래 요청과 receipt를 유지한다. 이미 종료한 검증 전용 grant/Tunnel을 임의로 재활성화하지 않는다.
