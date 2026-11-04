# D5 GPT 수정 오류 진단 재검증 — 2026-11-04

## 승인·적용 기준

사용자가 PR #46의 서버 적용·같은 토의 최대30분/20회·DeepSeek High 최대5회/119,757 보고 token 실검증을 명시 승인했다. 기존15개 답변 보존·같은 dot 감시 재연결·Muse 임시 잠금 해제/종료 복구를 포함하며 오류가 다시 나면 즉시 정지한다. 원래 일일 API 정책과 당일 잔여 중 작은 범위를 적용하고 실제 Codex/새 업무는 제외했다.

병합 main `6aa62ec681dc6a57c14f6fb18dd7b687454b0435`와 검사 head `7823269c0173e355c0fe6516981411efccc9f5cd`의 tree `739376c0c98d6d3515edf36c85ecb19690b2c353`는 동일하다. [동일 소스 CI](https://github.com/firewine/webgpt/actions/runs/41833892531)는 Node555·브라우저67·설치 Codex0.165 요청 계약 PASS, FAIL/SKIP0다. 같은 소스를 별도 worktree에서 빌드해 `ops/dot-mcp-d5-gpt-live-20261104`에 fast-forward·실행 파일 교체·정상 service/health 확인 후 적용했다. `.env`·DB·소유자 암호·계정/Chrome profile·4090/HTTPS8443·3000의 다른 서비스와 사용자 untracked 파일은 보존했다.

private `dot-mcp-d5-gpt-live-20261104/`에 online backup0600·이전 dist·원래15개 turn/환경 digest·멤버 토글·API 정책·누적20개 예약 기준을 보존했다. 검증 전용 제한은 이 기준 이후 예약만 최대20개로 세며 실패/미전송도 포함한다. 첫 새 예약의 durable 시각에서30분, 마지막5분 새 예약 차단·기존300초 drain을 유지한다. 새 창에서도 API usage를 초기화하지 않는다.

같은 dot 플러그인/터널/runtime key 참조로 전달기1개를 준비하고 현재 grant ID/버전·실제 metadata get을 대조했다. 사용자의 기존 native 감시 재연결 보고 뒤 유효 서버 구독1개를 확인했다. Muse는 원래 계정/thread·page ID·빈 입력/idle 모두 읽기 전용 확인했다. 새 플러그인/계정은 만들지 않았다. 이번 전용 guard는 과거 실패와 새 실패를 구분해 **첫 새 실패 이후 추가 예약·자동 복구를 차단**한다.

## 실제 실행·종료

| 항목 | 실측·판정 | private 증거 |
| --- | --- | --- |
| 실행 범위 | 22:18:55~22:19:01 KST, 새 예약1/20·경과6,244ms, API 제공자0/5회·추가 보고 API token0 | `live-start.json`, `live-outcome.json` |
| GPT 수정1 | **FAIL**. 기존 일반 GPT OAuth/xhigh로 같은 실패 task를 명시 재개.2,818ms 뒤 `response_not_completed`, receipt 있음·본문0·usage null. 실패 turn을 추가 보존하고 재전송0 | `post-stop-observed.json` |
| 새 진단 | **관측 PASS / 원인 UNVERIFIED**. 해당 local request digest와 일치하는 로그1개: stream event=`error`, status=null, provider error code=`other`, incomplete reason=null. 원격 오류 문장/실제 code 값은 보존하지 않아 역으로 특정할 수 없음 | `provider-failure-diagnostics.json` |
| 기존 결과 | **PASS**. 완료15개 전체 digest 동일,5명 초안5·교차검토10·두 라운드 유지. dot/Muse 새 발언0·새 Codex/업무0. 누적 예약21/API3 | `closeout-hashes.json`, `post-stop-observed.json` |
| 복귀 | **PASS**. 방 off·Muse 잠금·멤버 토글 보존·active/unconfirmed lease0·미확정0·이번 grant 회수/터널 종료·서버 구독0·검증 drop-in 제거·실제 정상 ExecStart/service/health·정리 실패0 | `cleanup-observed.json`, `normal-service-restored.json` |
| dot 감시 종료 | **USER_REPORTED**. 사용자가 기존 검증 감시 비활성과 반환 상태를 확인했다고 보고. 서버 구독0·권한 회수와 확인 주체를 구분 | `native-watch-stopped-user-report.json` |

API 일일 정책8회/200,000보고 token과 기존 당일 사용1회/45,335token은 그대로다. GPT의 미보고 usage를0으로 추정하지 않는다. 이번 실패의 상세 원인을 단순 로그인/문맥 한도/사용량 소진으로 확정하거나 이를 이유로 계정/사고 설정을 바꾸지 않았다.

사용자는 일반 GPT OAuth 계정의 ChatGPT Usage가 **사용 가능·여유 있음**으로 표시된다고 보고했다(`gpt-usage-user-report.json`). 이는 사용자 화면의 관측이며 실패 스트림의 실제 code/개별 요청 수락 여부를 복원하지 않는다. 사용량 소진을 이번 원인으로 표시하지 않는다.

다음 정상 경로는 수정5·종합1·종합 검토4·같은 방 dot 후속1이다. 이번 실패로 **D5-F 전체 BLOCKED**를 유지한다. 실기기·실제 Codex와 원래50개 gate의 미확인 판정도 그대로다. 이 기록은 새 페이즈를 만드는 계획 변경이 아닌 승인된 실검증 결과다.

## 진단 허용 목록 누락 보완

적용된 목록은 일반 Responses 오류 code만 허용해 ChatGPT 구독 연결 전용 code가 `other`로 축약된다. 공식 [SIWC 오류/복구](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)의9개 구독/권한 code를 `responsesFailureDiagnostic`의 정적 허용 목록에 추가했다. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)는 스트림이 시작된 뒤에도 구독 사용량 오류가 올 수 있음을 설명한다. 이번 `other`가 그중 어느 코드였는지는 **UNVERIFIED**다.

변경 범위는 `src/connections/completion-failure.ts::responsesFailureDiagnostic`의 허용값과 `tests/providers.test.mjs` 회귀뿐이다. 알려지지 않은 값은 계속 `other`, 없는 값은 null이며 provider prose·입력/출력·credential·원격 ID를 로그에 남기지 않는다. 기존 AppError/HTTP502·uncertain 판정·receipt·Provider complete/Store/API·단일 전송·로그 실패 시 동작·예산·300초·권한을 유지한다. 모델/전송 경로·자동 재시도·DB/schema·계정/과금 fallback은 추가하지 않는다.

`npm run check`의 strict TypeScript·빌드·Node556 **PASS**, FAIL/SKIP0. 새 code9종의 top-level/error/response.error 오류 보존과 같은 usage 오류의 fixture 전송1회·receipt·기존 AppError/502/uncertain=false 판정, 허용 prefix로 시작해도 알 수 없는 code의 `other` 처리·비밀 배제를 검사했다. 원래50개 gate·D5-A~E·과거 실행 창/근거 경로 보존 검사와 `git diff --check`도 PASS다. 브라우저 계약을 바꾸지 않았으며 새 PR의 필수 CI에서 전체 회귀 결과를 확인한다. 새 보완의 운영 적용과 추가 실계정 호출은 미실행이다. 원래 실패 원인을 해결했다고 표시하지 않는다. 복귀는 보완 전 실행 파일로 교체하며 DB 복원/이관은 필요 없다.
