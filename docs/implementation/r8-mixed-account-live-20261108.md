# R8 혼합 실계정 검증 — 계정 확인 보완 병합 후

2026-11-08~09 KST 실측·사용자 확인·재개 승인 기록. 기준 main `8b663543853480fb842c23160daf01c67967b0f1`(PR #63 병합), 기록 브랜치 `codex/r8-mixed-account-live-20261108`. 사용자의 병합본 서버 적용·R8 전체 혼합 실계정 검증 요청에 따라 기존 [30회/API6회/Codex2job/30분 범위](../reviews/r8-mixed-execution-impact-20261108.md)를 유지한다. 새 계획·호스트 보호 정책은 추가하지 않는다.

**현재 상태: 운영 적용·계정 확인 PASS, 11/09 첫 native 상주 준비 발언 BLOCKED·정상 복구 PASS, 후속 최소 재개 APPROVED·새 시도/실제 혼합 토의 NOT_RUN.** 실제 dot의 초기 조회 HTTP429는 2026-11-09 KST 사용자 확인상11월8일20:57 KST 이전 발생이다. 정확한 분·초/원문 응답·상류 원인은 UNVERIFIED이며 서버 로그에서 해당429를 확인하지 못했다. 준비 기한 종료를 원인으로 귀속하지 않는다. 과거 준비 요청1회를 새 검증의 성공 답변으로 합산하지 않는다.

## 적용·선행 증거

| 항목 | 관측·판정 |
|---|---|
| 병합/배포 | PR #63 MERGED, 검사한 head `ae7f33d`의 CI SUCCESS. 운영 폴더를 `8b66354`로 fast-forward하고 빌드·정상 user service 재시작. loopback4090과 기존 HTTPS health 정상. |
| 보존 | 적용 전 private online SQLite backup. `.env`·소유자 비밀번호·API 정책·원래 user unit·사용자 untracked 파일·기존 토의/job 수 보존을 적용 후 대조했다. 다른 서비스/포트·Tailscale·AppArmor·NoNewPrivileges는 변경하지 않았다. |
| 실제 웹 계정 | 원래 두 사용자 ID/이메일과 원래 대화를 읽기 전용으로 대조해 서로 다른 계정임을 확인했다. 두 창 Extra High·입력 비어 있음/응답 중 아님. 두 번째 아이콘형 계정이 `chatgpt-v1/5`로 ready → 기존 소유자 확인 경로 저장 → 최소 metadata 일치를 확인했다. 준비 메시지 재전송0. |
| 기존 연결 | Business 웹 GPT와 Muse 원래 thread의 saved binding 탐지가 각각 ready/초안 없음/응답 중 아님. native dot은 기존 plugin/tunnel/key를 사용한다. DeepSeek High와 기존 일일8회/보고200,000토큰 정책 유지, 선행 당일 사용0회/0토큰. |
| 실제 실행 보호 선행 검사 | 적용 소스의 실제 CLI0.166.0/전용 outer 검사16 PASS/0 SKIP. 서비스와 같은 `NoNewPrivileges` 조건을 별도 자식 프로세스에 적용한 같은 합성 검사도16 PASS/0 SKIP. 가짜 모델/인증으로 수행했으므로 실계정 Codex 성공으로 세지 않는다. |

## 준비 실패 B — 원인·보존

검증용 인증 사본을 차단 대상 앱 state 아래에 둔 operator 준비 오류로 보호 검사가 등록을 거절했다. 순수 경로 대조에서 `execution_isolation_unverified: protected_path_overlap`를 재현했다. `CodexExecutor.register`의 `verifyProtection`은 실제 `connect/thread/start`보다 앞에 있으므로 해당 경로는 thread 생성에 도달하지 않는다. 이 판정은 코드 경로와 재현에 근거하며 모델 보고가 아니다.

Core 예약/실제 모델/API/Codex job/저장 binding은0이다. 원래 `register-intent`·실패한 준비 사본·진단·복구 기록을 보존했고 journal을 지우거나 같은 run을 재시작하지 않았다. 정상 서비스·방off/Muse 잠금·원래 auth/unit/env/비밀번호/API 정책 보존을 확인했다. 실패를 실제 요청 성공으로 합산하지 않는다.

## 수정 준비 C

같은 승인 범위 안에서 인증 사본만 차단 state와 겹치지 않는 private 위치로 분리했다. 원본 인증은 읽기만 하며 사본의 refresh token은 비워 원본 갱신을 피한다. 추가 AppArmor/NNP/전역 설정 변경은 없다. 실제 새 등록이 보호된 읽기 binding/authority epoch1/같은 연결의 첫 요청 대기 상태까지 성공했고, model turn은0이었다.

private operator의 복구 중복 잠금, exclusive drop-in 생성 영수증(device/inode/hash), 최초 새 예약의 ledger 시각과 같은 watchdog clock을 코드 검토로 확인했다. 0회인 준비를 가짜 setup1회로 기록하지 않는다. 준비 대기 자체에도 별도 기한을 두며, 기존 grant/tool 기한을 늘려 안전 경계를 우회하지 않는다.

## 준비 기한 종료와429 보고

| 시각(KST)/방법 | 실제 관측 |
|---|---|
| 20:27:35 / private window·Store | C 준비 시작. 방off/Muse 잠금 유지. 새 setup 모델 요청0이며 최초 dispatch 예약 시각은 끝까지 없음. |
| 준비 중 / 실제 plugin 도구 | 같은 `webjjoku_dot_paged`의 `dot_turn_get({})`가 이벤트 이름/필터와 request:null을 반환했다. 부모 assistant는 claim/submit을 호출하지 않았다. |
| 20:57 이전 / 실제 dot 보고·후속 사용자 확인 | 실제 dot이 최초 get에서 HTTP429를 받아 중단. 2026-11-09 KST 사용자가11월8일20:57 KST 이전 발생을 확인했으며 정확한 분·초/원문 응답은 UNVERIFIED다. 이벤트 필터 획득·기존 감시 조회/변경·등록/재연결·claim/submit·재시도는 하지 않았다고 보고했다. 이를 서버의 실패 응답으로 확정하지 않는다. |
| 20:57:44 / watchdog·복구 영수증 | 실제 dot의 유효 구독/모델 예약 없이 준비 기한 종료(`preparation_idle_expired`). dot grant 회수·터널 종료·자기 소유 임시 drop-in 제거 후 정상 service/health·방off/Muse 잠금 복구. 원래 auth/unit/env/비밀번호/API 정책 보존 대조 모두true. 사본 auth만 제거하고 원래 thread/등록·실패 기록은 보존했다. |
| 서버/터널 대조 | 이 grant의 request0/subscription0, 앱 dispatch 예약0/API0/job0. 종료 전 터널 로그에 명시적429/rate-limit 응답은 없다. 종료 뒤에는 터널 프로세스가 없으며 만료 grant를 자동 재발급하거나 같은 호출을 반복하지 않았다. |

[공식 Secure MCP Tunnel 문서](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)는 앱 탐지/도구 호출 때 실행 중인 client가 필요하다고 설명하며, 별도의 MCP 트래픽 제한도 명시한다. 그 설명만으로 이번429의 원인을 확정하지 않는다. 사용자 확인상 최초429는 준비 기한 종료보다 앞서므로 만료로 설명하지 않는다. 상세 응답/상류 대조가 없어 정확한 원인은 UNVERIFIED다. 모델 토큰/구독 사용량 부족으로 판정하지 않는다.

정상 서비스/방off/Muse 잠금을 유지한 조회 전용 대조에서는 기존 tunnel/key로 짧은 임시 연결을 새로 준비했다. 로컬 `/mcp` get1회 HTTP200, 22:40:37 KST 같은 plugin의 OpenAI 경유 get1회가 `event`/`request:null`로 성공했다. 원래 실패 요청이나 claim/submit을 반복하지 않았고 감시도 등록하지 않았다. 22:41:37 KST 진단 grant 회수/프로세스 종료·임시 token/profile 제거, health 정상·새 예약/job0을 확인했다. 이는 복구한 연결의 조회 성공이며 원래429의 원인이나 실제 dot 감시 성공을 뜻하지 않는다.

정적 소스 대조에서 이 get 경로 자체에는 HTTP429 발행 분기가 없고 만료/회수 grant 인증은401로 거절한다(`src/http/workspace.ts:route`, `McpEndpoint.grant/handle`, `DotMcp.checkAuthority`). 단, 성공한 빈 get도 request/subscription을 만들지 않으므로0건만으로 호출이 서버에 도착하지 않았다고 판정하지 않는다.

## 실제 혼합 결과·남은 수락

native 감시 재연결 확인 전에는 방을 켜거나 모델 메시지를 보내지 않는다. 11/09 감시 확인 이후의 첫 준비 발언은 아래와 같이 중단됐다. 원래 승인한5인 새 주제1개/교차검토1회·동일 Codex thread 읽기→명령별 소유자 확인/보호 쓰기→실제1파일 diff 반영 확인→전 참여자 재검토→결론/Wiki/후속 인용은 아직 수행하지 않았다. 각300초·전체30회/API6회/2job/30분 및 기존 API 잔여를 유지한다. 오류/미확정은 원래 ID/원문·영수증을 보존하고 자동 반복하지 않는다.

**현재 전체 수락: NOT_RUN. 종료/복구는 위 범위로 PASS.** 기존 준비 C의 읽기 명령 선행 허용은 사용하지 않았다. 등록됐지만 첫 turn이 없던 binding은 회수/blocked·managedSession lost 상태이며 job0으로 보존됐다. 이 상태를 준비 완료 세션으로 재사용하거나 옛 등록 journal을 지우고 재등록하지 않는다. 후속 실행 준비가 이번 승인 경로/호스트 범위를 더 바꿔야 하면 영향과 변경량부터 보고한다.

이전 재개 승인(2026-11-09 KST)은 [감시 준비 후 등록안](../reviews/r8-readiness-rearm-impact-20261108.md)의 `/home/firewine/.local/share/webjjoku-r8-validation/20261108d/repo`, 준비 HEAD `a00a3d226e5edca6361959ef04e241f8310307cb`를 대상으로 했다. 같은30분/모델30회/API6회/Codex 읽기1·쓰기1job 및 기존 일일8회/보고200,000토큰과 잔여 중 작은 범위, 이 경로의 `/bin/bash -c 'node check-boundary.mjs'` 보호 읽기1회 사전 승인과 쓰기/원본 반영 별도 확인을 유지했다. 해당 시도는 아래와 같이 중단·복구됐으며 이 승인을 후속 경로에 재사용하지 않는다.

R6 별도 PASS나 이번 실제 계정 확인을 전체 R8-D/D5-F 또는 R8-A/실기기·장기 운영의 완료로 대신하지 않는다. 비밀·개인 대화·실제 계정/thread 식별자는 private 증거에만 남긴다.

## 2026-11-09 감시 확인 후 첫 native 발언 — BLOCKED

운영 소스는 같은 main `8b66354`, Node24.18.0/Codex0.166.0이다. 실제 Chrome의 기존 Business/두 번째 웹 GPT/Muse 연결을 ready·빈 입력·응답 중 아님으로 읽기 전용 확인했다. 두 웹 계정 Extra High는11/08 실측이며11/09에 사고 깊이 변경 조작/새 웹 메시지는 하지 않았다. 같은 NoNewPrivileges 조건의 실제 CLI/가짜 인증 보호 검사16 PASS/0 SKIP이다.

| KST / 확인 방법 | 관측·판정 |
|---|---|
| 준비 / 사용자 보고·Store | 기존 native 감시 하나를 현재 권한/필터로 재연결했다. 서버의 유효 구독1개를 확인한 뒤 승인된 새 경로에 보호 read 새 thread/binding1개를 등록했다. Codex model turn/job/명령은0이다. |
| 21:20:55.380 / dispatch ledger | dot만 참여하도록 한 준비 발언1개가 최초 예약됐다. 원래 시작 시각부터300초를 적용한다. claim 뒤에300초를 새로 부여하지 않는다. |
| 21:20:57.179 / outbox | 이벤트 전송1회 HTTP200. 이벤트 전달은 답변 생성/수락 증거가 아니다. |
| 21:22:24.488 / Store event | 같은 요청의 claim 활성화를 확인했다. |
| 21:22:54 / 실제 dot 실행 보고 | 0번 페이지를1회 호출했으나 `Object.keys`에서 `TypeError: Cannot convert undefined or null to object`로 중단했다. v2 페이지에 없는 `structuredContent`를 처음 선택했다고 보고했다. 정상 해석/검증한 페이지0, 다음 페이지·답변 생성·submit0, accepted/receipt 없음. |
| 21:25:55.479 / Store event | 서버에 reply가 없어 `dot_reply_unconfirmed`로 정지했다. 원래 입력/claim은 held 상태로 보존했다. |
| 21:27:40 / 복구 영수증 | 정상 service/health·방off/Muse 잠금·자기 소유 grant 회수·터널 종료·임시 drop-in/auth 제거. `.env`/비밀번호/API 정책/원래 unit/auth 보존 대조 모두true. 방 참여/속도 설정 복구는 미확정 대조까지 유보했다. |
| 21:34:17 / 실제 dot 후속 확인 | 검증 감시1개 비활성. 처리 흐름은 오류 후 종료됐고 새 호출/재시도는 없다고 확인했다. 자동화 서비스의 최종 completed/failed 값은 UNVERIFIED다. |
| 21:38:05 / 기존 reconcile API·Store | 위 중단/미제출 근거로 준비 발언을 `owner_confirmed_skip` 처리했다. 원래 turn/mailbox/claim 보존·lease released·원래 멤버/속도/autoTopic/toolBudget 복구, 방off/잠금을 확인했다. 새 예약1/native dot, API0/Codex job0/새 토의0을 유지했다. |

직접 원인은 **외부 감시의 첫 페이지 응답 해석 오류**다. `src/connections/dot-input-pages.ts::dotToolResult`는 v2 페이지에 text `content`만 반환하며, README와 `tests/dot-acceptance-fixture.mjs`는 기존 nullish fallback(`structuredContent ?? JSON.parse(text)`)과 같은 응답 선택을 사용한다. 로컬 전송 검사12 PASS/0 SKIP을 확인했다. v2에 중복 표현을 다시 추가하거나 입력/응답 계약을 바꾸지 않는다. 이번 실패를 예전429나 입력 절단으로 귀속하지 않는다.

보존 입력의 순수 로컬 검사에서 UTF-8 JSON211,221bytes·25페이지·최대 complete RPC11,937bytes, 모든 페이지/원문 digest 일치와 v2 text-only/기존 structured 응답 선택을 확인했다. 이25페이지는 **로컬 검사 수**이며 실제 dot이 읽은 페이지 수가 아니다. 프롬프트108,310자·history content23,410자(메타데이터 포함 직렬화24,894자)의 크기는 별도 운영 리스크다. 크기가 이번 TypeError를 일으켰거나300초 안에 실제 전체 입력을 처리할 수 있다는 판정은 하지 않는다.

실제 read 등록은 작업 없이 회수/managedSession lost로 보존됐다. 같은 경로를 새 등록처럼 재사용하면 Core는 기존 binding의 authority epoch를 올리고, 현재 검증기는 최초 read epoch1을 요구한다. 원래 journal/등록을 초기화하지 않는다.

**후속 최소 재개 사용자 승인 — 2026-11-09 KST / 새 시도 NOT_RUN:** [새 경로·감시 해석·직접 주제 준비 순서](../reviews/r8-native-decoder-rearm-impact-20261109.md)의 `/home/firewine/.local/share/webjjoku-r8-validation/20261109b/repo`, 준비 HEAD `e32dc8ef9f88cf622160b49b16f60b434dc3b665`를 명시 승인했다. 같은30분/모델30회/API6회/Codex2job(읽기1·쓰기1)·일일8회/보고200,000토큰과 실제 잔여 중 작은 범위를 유지한다. 해당 경로의 `/bin/bash -c 'node check-boundary.mjs'` 보호 읽기1회는 사전 승인됐으며 실제 쓰기 명령과 원본 `allowance.mjs`1파일 diff 반영은 각각 별도 소유자 확인을 유지한다. 별도 ambient 준비 발언 없이5인 주제로 바로 진행하며, 준비 중 non-topic 예약을 막는 private 임시 gate는 기존 검증기/dispatch 검사를 모두 유지한다. 운영 담당의 후속 실측 증거 전 새 시도와 전체 R8 수락은 NOT_RUN이다.

PR #64의 기존 CI는 제품 변경과 무관한 승인 화면 fixture의 비동기 요청 관측 경합으로 실패했다(취소 요청 기록 전에 단언). 해당 fixture만 취소 POST 응답을 기다린 뒤 원래 `['decline','cancel']` 단언을 실행하도록 보완했고, 같은 실제 Chromium의 해당 검사1 PASS/0 SKIP이다. 제품의 승인 동작/허용 범위는 바꾸지 않았다. 전체 CI 재실행 결과는 PR 최신 head에서 별도로 확인한다.
