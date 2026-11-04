# D5 실제 native 분할 조회 검증 — 2026-11-03

**최종 대조 2026-11-04 15:49 KST:** dot 분할 조회 수락과 Muse 원래 응답 복구로 **첫 교차검토5명 완료·완료10개·미확정0**이다. 두 번째 라운드·수정·종합·같은 방 후속은 아직 NOT_RUN이며 **D5-F 전체 BLOCKED**를 유지한다. 원래8개 완료 답변과 실패 이력·Muse 대화·설정은 보존했다.

## 기준·호출 범위·보존

병합 main `f3a2e34026c37c2bff52e194678b3de795c84d62`를 11/02 Ubuntu에 적용한 상태다. 검사한 PR #44 head `a5723d3`과 tree가 같고 기존 CI의 Node529·Chromium/Chrome MCP66·설치 Codex0.165 계약 PASS를 재사용한다. 이번은 제품 코드 변경 없이 같은 토의의 승인된 D5 실계정 수락이다.

[11/02 준비·연결 대조](./dot-mcp-paged-live-d5-20261102.md) 이후 사용자가 native 감시 갱신 성공을 보고했지만 대화 중단 전 실제 검증 예약은 시작되지 않았다. 11/03 이어가기에서 `live-start`/결과 파일 없음·새 예약0·완료8개 digest 동일·유효 구독1을 확인했다. 끊긴 전용 Tunnel을 같은 소유자 grant로 복구했다. 서비스 readiness 뒤 stdio 전달기를 시작해 초기 연결 순서 오류를 해소했다. grant/키를 다시 발급하거나 기존 감시를 중복 생성하지 않았다.

**기존 승인 범위는 그대로다:** 추가 최대30분·29회 예약, DeepSeek High 최대6회·165,092 보고 토큰, GPT2+dot+Muse, 기존 토의 잔여 절차와 같은 방 dot 후속1회. 기존 완료8개 재전송0·실제 Codex/쓰기0·새 업무0을 유지한다. 날짜가 바뀌어 일일 API 사용이0으로 표시돼도 이 검증 범위는 늘리지 않는다. 검증용 프로세스는 이번 새 lease에 연결된 API 사용만 집계하며 과거 다른 토의/다른 날짜의 기록을 섞거나 초기화하지 않는다. 기존 API 일일 정책8회/200,000토큰도 그대로 적용한다.

Muse는 같은 계정·원래 thread·빈 입력/idle을 다시 확인하고 검증 중만 잠금을 해제했다. 검증 대상 밖 추가 멤버는 검증 중만 off하고 종료 때 최신 소유자 설정으로 복구한다. 원래 미확정 요청은 앞서 승인된 `retry_after_stop` 실패 이력·감사 event로 남고 같은 task의 새 request/claim을 사용한다. 실제 실행 중 재전송·timeout 확대·원문 절단은 하지 않는다.

## 실제 관측

| 흐름 | 관측·판정 |
| --- | --- |
| 같은 토의 재개 | 유효 native 구독·현재 owner grant·Muse 원래 thread·새 API 사용0을 확인하고 명시 resume. 이전8개 완료 turn 동일 |
| dot 검토1 이벤트 | 새 요청1개·callback1회·HTTP200 뒤 실제 native가 claim. 전달 확인과 답변 완료는 따로 대조 |
| 실제 긴 입력 조회 | 원래 prompt21,793자+history14,019자. native가 **16/16페이지**를 조회하고 마지막 `nextPage:null`까지 관측. 각 페이지의 같은 request/input digest·최대RPC11,495 bytes(상한12,000)를 확인 |
| dot 검토1 답변 | **PASS**: 같은 task의 새 request로 JSON submit/receipt 수락. 기존300초 안인146,206ms에 완료. 할당 주장12개·구조화 검토12개·전체 할당 coverage 확인. 완료8개 유지 |
| 같은 라운드 공개 | dot 완료 뒤에도 남은 Muse 답변을 기다림. 전원 수락 전 현재 라운드의 새 답변을 다른 참여자에게 노출하지 않는 기존 장벽 유지 |
| Muse 검토1 — 최초 종료 |07:20:07 KST 시작·07:25:07의300초 제한 뒤 `operation_failed`·미확정. 서버에 남은1,998자는 JSON 미완성. 실행 중 재전송0·같은 라운드 공개0으로 정지 |
| Muse 검토1 — 원래 결과 복구 |11/04 원래 화면의 같은 계정/thread·요청 표식1개·ready/idle·빈 입력을 읽기 전용 확인. 뒤늦게 완성된2,679자 JSON의 할당10건/검토10건을 `parseReply`로 검증하고 기존 소유자 `reconcile(completed)`에 원래 receipt와 제출. **PASS: 신규 전송0·기존9개 불변·완료10개·미확정0** |
| 첫 교차검토 |5명 모두 검토1 완료. 토의는 아직 `blocked/cross_review/1`이며 복구만으로 자동 resume/다음 라운드 공개를 하지 않음 |
| 검토2·수정·종합·같은 방 후속 | **NOT_RUN**. 첫 검토 수락만으로 두 라운드·최종 종합·상주 복귀를 완료 처리하지 않음 |

원문 페이지의 무손실 구성은 동일 배포 helper/고정 digest로 대조했고, 실제 native의 전 페이지 조회·서버 JSON 수락·claim 범위와 연결했다. 도구 조회만으로 native가 의미상 모든 근거를 정확히 해석했다고 단정하지 않는다. 실제 검토의 coverage/반론과 후속 결과를 함께 확인한다. 같은 검토 라운드의 새 답변은 검토1 입력의 `sharedReplies:5`에 포함되지 않았다.

private 증거는 `dot-mcp-d5-paged-live-20261102/`의 `before-first-call-20261103.sqlite`, `pre-live-20261103.json`, `live-start.json`, `live-progress.jsonl`, `dot-page-observations.jsonl`, `native-first-paged-review-accepted.json`, `live-observation-latest.json`, `live-outcome.json`에 보존한다. 페이지 관찰에는 번호/전체 수·digest·크기만 기록하며 원문·attempt token·개인 계정/콜백을 공개 문서에 넣지 않는다. `live-outcome.json`의 완료9개/미확정1개는 최초 정지 당시 원본으로 보존하고, 후속 복구 결과로 덮어쓰지 않는다.

## Muse 원래 응답 대조·서버 정리 — 2026-11-04

진행 재개 시 operator 종료·새 예약2/API0·방 off·Muse 잠금·활성 lease0을 먼저 확인했다. 검증용 service drop-in만 제거하고 정상 main entry로 복구했다. health 정상·기존8개 digest 동일·멤버 토글이 검증 직전 소유자 설정과 동일함을 대조했다.3000 서비스·HTTPS8443·환경/계정·state는 유지한다.

Muse 관측은 CDP의 읽기 전용 DOM 평가만 사용했다. 입력/클릭/새 모델 호출0이며 원래 URL·계정·thread·유일한 요청 marker·busy=false·ready=true·draft 없음이 모두 일치했다. 시간제한 시 미완성 원문만으로 실패를 확정하거나 재전송하지 않고 **원래 대화에서 완성 응답이 실제 남아 있는 것**을 확인했다. `parseReply(text, discussion, task)`와 원래 주장10건의 coverage가 통과한 응답만 기존 `/api/discussions/:id/control`의 `action:reconcile/resolution:completed`로 수락했다. 원래 과제/세대·receipt를 사용했고 기존9개 완료 turn digest도 그대로다. 토의는 명시 resume 전 차단 상태를 유지한다.

정리 결과는 **방 off·Muse 잠금 true·원래 최신 멤버 설정·정상 서비스 active/검증 drop-in0·진행 중 lease0·미확정0·유효 서버 구독0·검증 전용 Tunnel 프로세스 종료**다. 소유자가 발급한 grant·플러그인·Muse 연결과 키 파일은 보존했다. ChatGPT 측 감시의 종료/비활성 상태는 직접 확인하지 못했으므로 UNVERIFIED이며, 다음 연결에서 같은 필터의 기존 감시와 서버 구독을 대조해야 한다.

private 후속 증거는 `before-service-restoration-20261104.json`, `normal-service-restored-20261104.json`, `muse-original-readonly-20261104.json`, `muse-before-observed-reconciliation-20261104.json`, `muse-observed-reconciliation-20261104.json`, `dedicated-tunnel-stopped-20261104.json`, `final-observed-20261104.json`이다. 개인 대화 원문은 이 private 증거에만 두며 공개 PR에 복사하지 않는다.

| 확인 방법 | 관측·한계 |
| --- | --- |
| 읽기 전용 `evidence.mjs`/SQLite 관측 |16/16페이지·동일digest·receipt·기존 완료8개 digest·예약2/API0·첫 라운드5명 완료를 확인. 현재 결과는 복구 후 snapshot과 함께 판정 |
| 원래 Muse DOM·`parseReply`·소유자 복구 API |같은 요청의 최종 JSON2,679자/검토10건·원래 세대·복구 후 완료10개/미확정0. 재전송0 |
| `curl --fail http://127.0.0.1:4090/health`·`systemctl --user show webjjoku -p ActiveState -p DropInPaths` |정상 service active·검증 drop-in 없음. 실제 다른 기기/호스트 재부팅 수락은 이 검사에 포함하지 않음 |
| `node --test --test-name-pattern='D5-E: the additive gate map' tests/dot-acceptance.test.mjs`·`git diff --check` |문서 수락표의50 gate·관련 파일·D5-F 미완료 유지 및 patch 공백 검사. 제품 코드 불변이므로 기존 전체 자동검사 결과와 구분 |

수락표 검사는1개 PASS·실패0이다. 독립 worktree의 누락된 `jose` 의존성 때문에 상대 경로 실행이 먼저 실패했고, 동일 운영 checkout의 의존성을 임시 연결해 재실행을 통과시킨 뒤 연결을 제거했다. 설치/lockfile·운영 의존성 변경은 없다.

대상 Ubuntu 실측은26.04.1 LTS, Node24.18.0/npm11.16.0이다. 현재 전역 Codex는0.166.0으로, 이전에 PASS한 설치0.165.0 계약과 다르다. 이번에는 Codex를 실행하지 않았으며0.166.0 계약·실세션 수락은 **UNVERIFIED**다. 다음 실제 Codex 범위 전에 실제 실행 파일/schema를 다시 대조한다.

## 남은 수락과 종료

현재 **native 긴 입력 검토1 실제 왕복 PASS·Muse 검토1 무전송 복구 PASS·첫 라운드 전원 완료 / D5 전체 BLOCKED**다. 이번 창은07:17:40~07:25:09 KST 추가 예약2/API0·완료1/미확정1로 정지했고,11/04의 새 호출 없는 복구 후 완료2/미확정0이 됐다. D5 누적 예약13/API2는 그대로다. 승인된 최대30분 창은 이미 종료됐으므로 남은 요청 수를 새 호출 승인으로 간주하지 않는다.

다음은 별도 허용된 범위 안에서 같은 토의의 검토2(5명)·수정(5명)·종합1·종합검토4와 같은 방 native 후속1, 정상 경로16회가 남는다. 형식 보완은 허용된 추가 상한 안에서만 진행하고 같은 요청의 불명확한 재전송은 금지한다. GPT2·dot·Muse·DeepSeek High와 기존 API 일일 정책을 유지하며, 실제 시작 직전 사용량·유효 grant·단일 native 감시·Muse 원래 대화/빈 입력·현재 소유자 멤버 설정을 재대조한다. 제품 timeout/권한·DB·안전장치 변경은 계획하지 않는다. 기존 전체50 gate와 실제 기기·실제 Codex 범위는 별도로 유지한다. fixture PASS나 이번 부분 수락으로 미완료를 완료로 바꾸지 않는다.

### 다음 검증안 — 별도 승인 전 실행 금지

| 항목 | 제안 범위 |
| --- | --- |
| 대상/완료 보존 |같은 토의·같은5명. 완료10개는 재전송하지 않음. 남은 정상 경로16회 |
| 새 실행 창 |첫 새 예약부터 최대30분·추가 최대27회. 이전13회와 누적40회 이내. 마지막5분 신규 예약 차단 |
| API |DeepSeek High 최대6회·165,092 보고 토큰 이내. 원래 일일 정책8회/200,000토큰과 실제 당일 잔여 중 작은 한도. 새 날짜를 이유로 범위를 늘리지 않음 |
| dot/Muse 준비 |같은 Tunnel·현재 연결로 필요한 scoped grant/기존 감시1개만 재연결. 새 dot/새 플러그인/새 키 생성 없음. Muse 원래 대화 확인 후 검증 중 잠금 해제·종료 시 복구 |
| 미확정/정리 |미확정이면 후속 전송을 멈추고 원래 요청을 대조. 완료·한도·scope 변경에도 방 off·Muse 잠금·소유자 멤버 설정·정상 entry 복구. 기존 데이터/응답을 덮어쓰지 않음 |
| 제외 |제품/계획 계약 변경·timeout 확대·실제 Codex 실행/쓰기·새 업무·추가 로그인/배포 |

이 표는 새 실행 승인을 대신하지 않는다. 실제 새 호출은 별도 사용자 허용과 dot 감시 준비 확인 후 시작한다.
