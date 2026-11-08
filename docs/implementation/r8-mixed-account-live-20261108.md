# R8 혼합 실계정 검증 — 계정 확인 보완 병합 후

2026-11-08 (KST). 기준 main `8b663543853480fb842c23160daf01c67967b0f1`(PR #63 병합), 기록 브랜치 `codex/r8-mixed-account-live-20261108`. 사용자의 병합본 서버 적용·R8 전체 혼합 실계정 검증 요청에 따라 기존 [30회/API6회/Codex2job/30분 범위](../reviews/r8-mixed-execution-impact-20261108.md)를 유지한다. 새 계획·호스트 보호 정책은 추가하지 않는다.

**현재 상태: 운영 적용·계정 확인 PASS, 준비 기한 종료/정상 복구 PASS, 실제 혼합 토의 NOT_RUN.** 실제 dot의 초기 조회 HTTP429 보고는 수신했지만 발생 시각/원문 응답은 UNVERIFIED이며 서버 로그에서 해당429를 확인하지 못했다. 과거 준비 요청1회를 새 검증의 성공 답변으로 합산하지 않는다.

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
| 20:57:44 / watchdog·복구 영수증 | 실제 dot의 유효 구독/모델 예약 없이 준비 기한 종료(`preparation_idle_expired`). dot grant 회수·터널 종료·자기 소유 임시 drop-in 제거 후 정상 service/health·방off/Muse 잠금 복구. 원래 auth/unit/env/비밀번호/API 정책 보존 대조 모두true. 사본 auth만 제거하고 원래 thread/등록·실패 기록은 보존했다. |
| 후속 사용자 보고 / 시간 UNVERIFIED | 실제 dot이 최초 get에서 HTTP429를 받아 중단. 이벤트 필터 획득·기존 감시 조회/변경·등록/재연결·claim/submit·재시도는 하지 않았다고 보고했다. 이를 서버의 실패 응답으로 확정하지 않는다. |
| 서버/터널 대조 | 이 grant의 request0/subscription0, 앱 dispatch 예약0/API0/job0. 종료 전 터널 로그에 명시적429/rate-limit 응답은 없다. 종료 뒤에는 터널 프로세스가 없으며 만료 grant를 자동 재발급하거나 같은 호출을 반복하지 않았다. |

[공식 Secure MCP Tunnel 문서](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)는 앱 탐지/도구 호출 때 실행 중인 client가 필요하다고 설명하며, 별도의 MCP 트래픽 제한도 명시한다. 그 설명만으로 이번429의 원인을 확정하지 않는다. 오류 발생 시각/상세 응답이 없어 만료 뒤 연결 실패와 외부 호출 제한을 구분하는 대조가 남아 있다. 모델 토큰/구독 사용량 부족으로 판정하지 않는다.

정상 서비스/방off/Muse 잠금을 유지한 조회 전용 대조에서는 기존 tunnel/key로 짧은 임시 연결을 새로 준비했다. 로컬 `/mcp` get1회 HTTP200, 22:40:37 KST 같은 plugin의 OpenAI 경유 get1회가 `event`/`request:null`로 성공했다. 원래 실패 요청이나 claim/submit을 반복하지 않았고 감시도 등록하지 않았다. 22:41:37 KST 진단 grant 회수/프로세스 종료·임시 token/profile 제거, health 정상·새 예약/job0을 확인했다. 이는 복구한 연결의 조회 성공이며 원래429의 원인이나 실제 dot 감시 성공을 뜻하지 않는다.

정적 소스 대조에서 이 get 경로 자체에는 HTTP429 발행 분기가 없고 만료/회수 grant 인증은401로 거절한다(`src/http/workspace.ts:route`, `McpEndpoint.grant/handle`, `DotMcp.checkAuthority`). 단, 성공한 빈 get도 request/subscription을 만들지 않으므로0건만으로 호출이 서버에 도착하지 않았다고 판정하지 않는다.

## 실제 혼합 결과·남은 수락

native 감시 재연결 확인 전에는 방을 켜거나 모델 메시지를 보내지 않는다. 원래 승인한5인 새 주제1개/교차검토1회·동일 Codex thread 읽기→명령별 소유자 확인/보호 쓰기→실제1파일 diff 반영 확인→전 참여자 재검토→결론/Wiki/후속 인용은 아직 수행하지 않았다. 각300초·전체30회/API6회/2job/30분 및 기존 API 잔여를 유지한다. 오류/미확정은 원래 ID/원문·영수증을 보존하고 자동 반복하지 않는다.

**현재 전체 수락: NOT_RUN. 종료/복구는 위 범위로 PASS.** 읽기 명령의 선행 허용은 사용하지 않았다. 등록됐지만 첫 turn이 없던 binding은 회수/blocked·managedSession lost 상태이며 job0으로 보존됐다. 이 상태를 준비 완료 세션으로 재사용하거나 옛 등록 journal을 지우고 재등록하지 않는다. 후속 실행 준비가 기존 승인 경로/호스트 범위를 바꿔야 하면 영향과 변경량부터 보고한다. [새 합성 검증 폴더/준비 순서 최소 변경안](../reviews/r8-readiness-rearm-impact-20261108.md)은 미승인 제안이며 서비스에 적용하지 않았다.

R6 별도 PASS나 이번 실제 계정 확인을 전체 R8-D/D5-F 또는 R8-A/실기기·장기 운영의 완료로 대신하지 않는다. 비밀·개인 대화·실제 계정/thread 식별자는 private 증거에만 남긴다.
