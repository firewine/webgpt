# D5 v2 전송·제출 오류 복구 실환경 수락 — 2026-11-04

## 병합 기준과 준비

사용자가 PR #45 병합 후 다음 단계 진행을 지시했다. 병합 main `bd19d1f27ccfeb7e691aad86b2533bbca806fdb1`·tree `db2228cfce84fea851959c674ac12c8f610a1726`는 검사한 PR head `aecf65f`와 동일하다. [동일 소스 CI](https://github.com/firewine/webgpt/actions/runs/41824220074)는 Node553·Chrome/MCP67·설치 Codex0.165 요청 계약 PASS다. 로컬 Codex0.166 schema PASS와 실제 실행 NOT_RUN은 [구현 기록](./dot-page-transport-retry-20261104.md)을 따른다.

21:04~21:10 KST 준비 관측:

- 운영 소스는 아직 이전 `f3a2e34`이며 user service active·앱4090/HTTPS8443·검증 drop-in0이다.3000의 다른 서비스와 사용자 untracked 파일은 유지했다.
- 같은 토의는 revision1/cross_review2·blocked다. **완료13개 digest 동일·dot 미확정1·서버 reply/receipt/text0·원래 grant 회수·진행 중 lease0**을 확인했다. 방 off·Muse 잠금 true·native 유효 구독0이다.
- 새 main은 독립 worktree에서 빌드했다. 새 `assertDotRetryAfterFailedSubmit` 순수 검사를 원래 요청에 적용해 PASS를 확인했다. 이 검사만으로 소유자의 외부 실행 중단 확인이나 실제 복구 명령을 대신하지 않는다.
- 원래 held 요청에는 전송 버전이 없고 기존 dual31페이지가 유지된다. 같은 고정 원문에 새 요청 v2를 계산하면 **16페이지·최대RPC11,937bytes·무손실**이다. 원래 요청을 v2로 바꾸지 않았고 실제 native 수락을 완료로 표시하지 않는다.
- private `dot-mcp-d5-v2-live-20261104/`에 SQLite online backup0600·이전 dist·완료13개/환경 digest·기존 멤버 토글/API 정책을 보존했다. 기존 DB나 설정을 덮어쓰지 않았다.
- 서버 Chrome에는 blank 탭만 있었다. 같은 기존 profile에 저장된 Muse URL을 다시 열었고 새 background 탭의 UI가 비어 있는 것을 관측했다. 탭을 앞에 표시한 뒤 **같은 계정·원래 thread·ready/idle·빈 입력**이 모두 통과했다. 새 로그인·대화 생성·입력/메시지 전송은0이다. 실제 MCP page ID는 적용 직전에 기존 discovery/confirm으로 다시 대조한다.

private 근거는 `before-deploy.sqlite`, `dist-before/`, `baseline.json`, `preparation-summary.json`, `chrome-page-preparation.json`, `muse-page-diagnosis.json`, `muse-blank-page-diagnosis.json`, `muse-front-preflight.json`이다. 계정/원문·키·callback을 공개 문서에 넣지 않는다.

## 구체 적용·새 검증 범위 — 사용자 명시 승인

[직전 검증](./dot-mcp-resume-live-d5-20261104.md)의30분 실행 창은 종료됐다. 이후 사용자가 **이전 dot 처리 중단·추가 제출 없음 확인 및 서버 적용/아래 새 실검증 범위**를 명시 승인했다. 이번 승인 범위만 사용하며 원래 호출/사용량을 초기화하지 않는다.

| 항목 | 제안 실행/중지 범위 |
| --- | --- |
| 적용 | 병합 main의 빌드 결과를 기존 앱에 반영·정상 service 재시작. `.env`·state·소유자 암호·계정·Chrome profile·port/Serve·다른 서비스 보존 |
| 원래 dot 복구 | 소유자가 기존 오류 뒤 처리 중단/추가 제출 없음을 확인하고 서버 reply/receipt0·원래 grant 회수를 재대조한 뒤 `retry_after_failed_submit`으로 원래 실패/제출 시도 이력을 보존. 같은 task만 pending으로 두고 별도 resume |
| 기존 완료 | 완료13개 재전송0·원래 실패/미확정 기록 보존. 원래 held 요청의 페이지/version을 바꾸지 않고 새 request에만 v2 snapshot |
| 정상 잔여 | dot/Muse 검토2의2 + 수정5 + 종합1 + 종합 검토4 + 같은 방 dot 후속1 =13회 |
| 시간/요청 | 첫 새 예약부터 최대30분·추가 최대23회. 기존17회와 누적40회 이내, 마지막5분 신규 예약 차단. 제품 전역 한도가 아닌 이번 검증 전용 guard |
| API | DeepSeek High 최대5회·119,757 보고 토큰, 기존 일일8회/200,000토큰·실제 당일 잔여 중 작은 범위. 사용량/한도를 초기화하지 않음 |
| dot/Muse | 같은 dot/플러그인/Tunnel·필요한 scoped grant·기존 native 감시1개 재연결. 원래 Muse thread/빈 입력 확인 뒤 검증 중만 잠금 해제·종료 복구 |
| 늦은 응답 | 같은 승인 창 안의 원래 최종 응답만 기존 수락/대조 경로로 확인. 미확정 요청을 새 job/감시/timeout 연장으로 반복하지 않음 |
| 정지·복귀 | 완료/한도/미확정/원래 데이터·범위 변경 시 방 off·실행 대조·Muse 잠금·최신 멤버 토글 복원·이번 grant/Tunnel/검증 drop-in 정리·정상 service 복구 |
| 제외 | 실제 Codex/쓰기·새 외부 업무·추가 OAuth/계정/플러그인·새 phase·300초/12,000bytes 확대 |

## 실제 적용·복구·연결 준비

-21:21 KST 운영 checkout을 `ops/dot-mcp-d5-v2-live-20261104`·병합 main `bd19d1f`로 fast-forward하고, 검사한 같은 소스의 별도 빌드로 교체했다. 정상 service 재시작/health·owner API PASS, 완료13개 digest·환경/API 정책·방 off/Muse 잠금·새 예약0을 확인했다. 사용자 untracked 파일은 유지했다.
-21:22 KST 소유자 중단/추가 제출 없음 확인과 서버 reply/receipt/text0·원래 grant 회수를 다시 대조해 `retry_after_failed_submit`을 적용했다. 원래 요청은 consumed·실패 turn은 `owner_confirmed_retry_after_failed_submit`·lease released로 보존하고 같은 task만 pending이다. 기존13개 그대로·미확정0·새 전송0이다. 복구 command/event에 오류 뒤 제출 시도와 소유자 근거를 남겼으며 외부 작업 서비스의 최종 상태를 서버가 독립 증명했다고 표시하지 않는다.
- 원래 Muse 계정/thread·빈 입력/idle을 기존 discovery로 다시 확인하고 같은 connection의 page ID만 현재 값으로 갱신했다. 초기 확인 요청에서 connectionId 누락을 서버가 scope mismatch로 거절했으며, 같은 기존 연결을 명시한 확인으로 통과했다. 새 연결·대화·계정으로 바꾸거나 메시지를 재전송하지 않았다.
-21:25 KST 이번 검증용 drop-in으로 기존 앱의 요청/시간/API 제한·Codex/새 업무 차단을 켰다. 같은 dot/방/세 도구의30분 권한과 기존 Tunnel/runtime key 참조로 전달기1개를 준비했다. 실제 동일 플러그인의 metadata get·readiness PASS, 현재 요청 없음이다. 새 키·터널·플러그인은 만들지 않았다.
- 토큰 제한은 기존 계약대로 이번 새 API 요청에서 **보고된 사용량**을 정산하고 다음 호출을 차단한다. 미보고량을 만들어 표시하지 않는다. 원래 제품의 단일 응답 정산 후 한도 초과 가능성/추가 호출 차단 계약을 유지하며 별도 tokenizer/금융 한도를 추가하지 않는다.
- 검증 종료 정리는 소유권이 확인된 항목을 각각 시도하고 실패 사유를 모아 실제 결과에 남긴다. 진행 중 lease가 남으면 브라우저/서비스를 강제 교체하지 않는다. 이번 시작 전 Muse 잠금 true를 다시 요구하고, 승인된 종료 잠금·사용자 멤버 변경 보존·이번 grant/Tunnel/drop-in 정리 경계를 유지한다.

이 준비 시점에는 서버 적용·원래 과제 명시 복구·완료13개 보존·Muse/전달기 준비 PASS, 실제 dot 감시 재연결 확인 대기·새 모델 예약0이었다. 이후 실행 결과는 아래를 따른다. 원래50 gate·별도 기기/Codex 수락은 유지한다.

private 추가 증거는 `authorization.json`, `acceptance-policy.json`, `before-apply-observed.json`, `deployment-observed.json`, `before-explicit-recovery.json`, `explicit-recovery-observed.json`, `muse-preflight-confirmed.json`, `guard-service-ready.json`, `grant-ready.json`, `tunnel-readiness-observed.json`이다. 원래 단일 입력/토큰·인증 파일을 공개 문서에 복사하지 않는다.

## 실제 실행 결과 — 21:35:22~21:39:25 KST

사용자가 같은 실제 dot의 기존 감시를 현재 필터/권한으로 재연결하고 v2 JSON/전체 페이지 지시를 갱신했다고 보고했다. 서버에서 유효 구독1개를 확인한 뒤 같은 토의를 명시 재개했다. 새 플러그인·터널·키·외부 업무는 만들지 않았다.

| 검증 대상 | 실제 관측·판정 | 증거 |
| --- | --- | --- |
| dot 두 번째 교차검토 | **PASS**. 같은 task·고정 원문137,805bytes를 새 요청 v2로 전달.16/16페이지·request/digest/pageCount 일치·마지막 nextPage:null·최대RPC11,736bytes. 예약부터194,591ms 안에 accepted/receipt와 서버 reply 수신·consumed 확인. 배정12주장에12구조화 검토·누락0. callback1개/HTTP200 | `native-v2-request-observed.json`, `dot-page-observations.jsonl`, `post-stop-provider-observations.json` |
| 페이지 조회 | 첫 페이지21:36:07.543, 마지막21:37:57.612, 조회 구간110,069ms. 이전31페이지와 같은 입력 digest를 유지했다. 이는 이번 실측이며 이후 지연 보장은 아님 | 같은 페이지 관측 로그 |
| Muse 두 번째 교차검토 | **PASS**. 원래 계정/thread·빈 입력/idle 확인 뒤39,494ms,10주장/10검토·유효 JSON·receipt. 재전송0 | `post-stop-provider-observations.json` |
| 검토 라운드/기존 답변 | **PASS**.5명 전원 두 라운드 완료·초안5/교차검토10·완료15개. 기존13개 전체 turn digest 동일. dot 검토2의 공유 입력은 이전 라운드까지10개 답변이며 같은 라운드 새 답변을 먼저 공유하지 않음 | `closeout-hashes.json`, `live-outcome.json` |
| 첫 GPT 수정 | **FAIL**. `openai-oauth`·기존 xhigh,4,942ms 뒤 `response_not_completed`. receipt 있음·본문0·reply/usage null·실패 turn 보존. 실패 상세 원인 **UNVERIFIED**. 추가 재전송0 | `post-stop-provider-observations.json`, `diagnostic-availability.json` |
| 이번 한도 | **PASS**. 경과243,198ms·추가 예약3/23·API 제공자0/5회·추가 보고 API token0/119,757. 누적 예약20/API3. 미보고 GPT 사용량을0으로 추정하지 않음 | `live-start.json`, `live-outcome.json` |
| 종료/복귀 | **PASS**. 방 off·Muse 잠금·멤버6명 토글 복원·lease/미확정/서버 구독0·이번 grant 회수·전달기 종료·검증 drop-in 제거·정상 service/health·정리 실패0. 다른 서비스/포트·`.env`·API 일일 정책 보존 | `cleanup-observed.json`, `normal-service-restored.json`, `final-cleanup-observed.json` |
| dot 측 감시 종료 | **USER_REPORTED**. 사용자가 검증용 native 감시를 비활성화하고 반환 상태가 비활성임을 확인했다고 보고. 서버 권한 회수/구독0과 외부 감시 조회의 확인 주체를 구분 | `native-watch-stopped-user-report.json` |

새 호출은 dot 검토·Muse 검토·실패 GPT 수정의3개다. DeepSeek는 이번 창에서 호출하지 않았으며 당일 정책8회/200,000 보고 token과 기존 사용1회/45,335token을 유지했다. 원래 과거 실패2개와 이번 GPT 실패를 포함한 실패3개를 삭제하지 않았다. 실제 Codex 실행·새 업무는0이다.

첫 GPT 수정 오류에서 바로 중지했으므로 **D5-F 전체 BLOCKED**다. 남은 정상 경로는 수정5·종합1·종합 검토4·같은 방 native 후속1이며, 이미 실패한 시도는 별도 기록으로 남는다. 다음 새 실검증은 소유자의 새 범위 승인과 명시 복구/재개가 필요하다. 완료15개를 처음부터 재실행하지 않는다. 실기기·Codex·기존50 gate의 미확인 상태를 이 부분 성공으로 PASS 처리하지 않는다.

## GPT 실패 진단 보완 — 운영 적용 전

기존 `Providers.complete`는 `store:false`로 요청하고, Responses의 `response.failed`·`response.incomplete`·`error` 또는 잘못된 완료 상태를 같은 `response_not_completed`로 변환하면서 원격 오류 code/불완전 이유를 버린다. 기존 실패 요청의 receipt로 읽기 전용 GET1회를 시도했으나 HTTP401·`invalid_request_error`라 상세 응답을 회수하지 못했다. 이 조회는 새 모델 호출이 아니며, 조회 경로의401로 앞선 스트림 실패를 로그인/권한 문제라고 확정할 수 없다. 계정/인증·모델·사고 설정을 바꾸지 않았다.

`src/connections/completion-failure.ts::responsesFailureDiagnostic`과 `src/connections/providers.ts::Providers.complete`에 작은 진단 보완을 추가했다. 실패 시에만 `provider.response_not_completed` 운영 로그1개에 local request digest·provider kind·허용된 stream event/status/error code/incomplete reason을 남긴다. 알려지지 않은 값은 `other`, 없는 값은 null이며 provider message·원문·출력/추론·credential·원격 response ID는 남기지 않는다. 로그 실패도 원래 오류를 바꾸지 않는다. 필드 근거는 공식 [Responses 스트림 이벤트](https://developers.openai.com/api/reference/resources/responses/streaming-events)와 [응답 조회 계약](https://developers.openai.com/api/reference/resources/responses/methods/retrieve)을 대조했다.

**기존 계약 유지:** 오류 코드/HTTP502·uncertain 판정·receipt hook·Provider complete/Store/API·`store:false`·단일 전송·자동 재시도 없음·300초·예산/권한·기존 기록을 유지한다. DB/schema·새 phase·timeout/전송 크기·복구 정책을 변경하지 않는다. D3~D5의 기존 진단 보완이며 수락 기준을 낮추는 계획 변경은 아니다. **이번 실제 GPT 실패 원인을 고쳤다는 의미가 아니고, 이후 실패의 원인 단서를 잃지 않도록 하는 보완**이다. 서버에는 병합 main `bd19d1f`만 적용돼 있으며 이 새 코드는 미배포·추가 실계정 재호출0이다.

검사: `npm run check` strict TypeScript/빌드·Node555 PASS, FAIL/SKIP0. `tests/providers.test.mjs`는 실제 계정 없이 네 종류 종료 이벤트·receipt/동일 실패/전송1회·허용값 제한/비밀 배제·logger 실패 시 동작 보존을 검증한다. 실제 설치 Chromium156.0.8078.4·Chrome DevTools MCP1.12.0으로 브라우저67 PASS, FAIL/SKIP0이며 계정 응답은 fixture다. 최초 브라우저 실행은 Playwright 기본 경로의 실행 파일 부재로 실패했고, 기존 설치본을 `WJ_TEST_CHROMIUM_EXECUTABLE`로 명시해 전체 검사를 통과했다. 새 브라우저를 설치하거나 운영 Chrome profile을 사용하지 않았다. manifest의 기존 baseline/50개 gate·D5-A~E·원래 미확인 판정·파일 경로 보존도 PASS다. PR CI는 실제 종료 후 추가한다.

```bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/설치된/Chromium/chrome \
  WJ_TEST_CHROME_MCP=/설치된/chrome-devtools-mcp npm run test:browser
```

복귀는 진단 보완 전 빌드로 교체하면 되고 DB 이관/데이터 복원은 필요 없다. 실제 검증의 복귀는 이미 완료됐으며 원문·receipt·실패·완료15개는 private DB와 online backup에 보존했다.
