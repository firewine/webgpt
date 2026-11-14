# dot 종료 상태 미확인 요청의 복구 — 영향 검토

상태: **APPROVED — 2026-11-14 사용자 ‘계획 개정·보완 개발 승인. 종료 상태는 미확인으로 남기고 기존 답변 5개와 300초 제한은 유지’**. 조사 코드 기준 main `f95e47cdd6cf223eb21e2f6849fce9e18ab3eac8`(PR #66). 구현 기준은 문서 PR #67 병합본 `d822f69`이며 제품 코드 차이0이다. 앞선 PR #66 배포 승인과 구분해 아래 새 복구 판정·검증 준비기의 계획 개정/개발/모의 검사를 승인받았다. 새 기능 배포·실계정 재호출은 아직 NOT_RUN이다.

## 확인된 문제

기존 토의에는 완료 초안5개와 `cross_review` 1라운드의 native dot 미확정 요청1개가 있다. 운영의 prompt/본문/구조화 reply/receipt digest와 전체 토의 snapshot은 배포 전후 모두 동일하다. 옛 request는 held·claim 있음·reply 없음, 그 grant는 revoked다. 새 모델 예약·API·Codex 작업0이다.

소유자가 실제 dot에게 확인한 당시 보고는 다음과 같다. **원격 보고(reported)**이며 서버가 소급 관측한 사실로 승격하지 않는다.

- 17페이지를 모두 확인했고 입력 수집 후 검토 출력에서 `Warning: truncated output`이 발생했다고 보고했다. 개별 페이지 원본과 절단된 출력은 확인되지 않았다.
- 답변 생성·submit은 하지 않았다고 당시 보고에 남았다. 이후 호출 전체와 실행의 최종 종료 상태는 조회할 수 없다.
- 현재 감시는 비활성이다. 남은 처리를 중지하도록 명시 요청했지만 식별 가능한 취소 대상은 없었고, 과거 실행의 종료를 확인하지 못했다.

`src/workspace/engine.ts::DiscussionEngine.control`의 `retry_after_stop`은 `stoppedWithoutSubmit:true`, `retry_after_failed_submit`은 `stoppedAfterFailedSubmit:true`를 요구한다. 현재 자료로 어느 쪽도 사실대로 선언할 수 없다. `src/workspace/dot-mcp-policy.ts::assertDotRetryAfterStop`은 동일 과제·입력·세대·원문/수신 기록 부재를 검사하지만 외부 실행 종료를 증명하지 않는다. 기존 [복구 계약](../implementation/dot-explicit-retry-20261102.md)은 불명확한 경우 미확정 대조를 유지하도록 정한다.

`not_sent`는 이미 점유·읽기된 요청을 잘못 표시하고, `skip`은 목표 교차검토 과제를 취소하므로 대안으로 사용하지 않는다. 300초 경과·감시 off·권한 회수만으로 실행 종료를 기록하지 않는다.

## 대안과 권장안

| 대안 | 판단 |
|---|---|
| 외부 실행 종료와 제출 이력이 확인될 때까지 대기 | 제품 변경0. 가장 보수적이지만 현재 원격 관리 화면이 필요한 기록을 제공하지 않아 같은 질문을 반복해도 해소되지 않는다. |
| 기존 확인 필드에 true를 넣거나 미전송/skip으로 처리 | 기각. 확인하지 못한 사실을 기록하거나 기존 과제를 잃는다. |
| **옛 권한 회수 + 종료 미확인 명시 수락으로 별도 재시도 준비** | 승인·채택. 원격 실행 종료를 주장하지 않고 옛 결과의 반영을 차단한 상태에서 동일 과제의 새 시도를 소유자가 명시적으로 선택한다. |

## 제안 계약과 최소 변경

아래는 승인된 변경 계약이다. 실제 구현/검사·미검증 상태는 [구현 기록](../implementation/dot-unverified-stop-recovery-20261114.md)에서 구분한다.

1. 기존 owner `reconcile`에 별도 `retry_after_authority_revoked` 분기를 둔다. `acceptUnverifiedExecution:true`, 현재 감시 비활성 확인, 근거 메모를 필수로 받는다. 기존 두 복구 분기의 확인 의미는 그대로 유지한다.
2. 기존 공통 검사(같은 과제·라운드·revision·identity·context generation·입력 digest·Wiki 권한·최신 시도·단일 슬롯·reply/text/receipt 없음)를 재사용한다. **옛 grant가 명시 revoked이며 그 grant의 유효 구독이 없음**을 같은 transaction에서 검사한다. 단순 시간 만료로 대체하지 않는다. 중간에 답변/receipt가 생기면 변경0으로 거절한다.
3. 원래 request/claim/입력/실패·사용량을 보존한다. audit에 `externalExecution: unverified`, `submissionHistory: unverified`, `priorGrantRevoked: true`와 소유자 근거·`previousError`를 기록한다. 기존 분기의 `stoppedWithoutSubmit: !failedSubmit`/`submitAttempted: failedSubmit` 식을 새 분기에 재사용하지 않는다. 기존 turn의 종료 표기는 **앱이 옛 시도를 대조 종료했다는 의미**로 구분하며 원격 모델의 종료/미실행으로 표시하지 않는다. 원래 receipt를 만들어 넣지 않는다.
4. 같은 task만 pending으로 준비하고 토의는 blocked/paused 상태를 유지한다. 별도 명시 resume에서 새 requestId·attempt·현재 grant를 사용한다. 옛 requestId/attempt/token을 새 시도에 승계하지 않는다. `DotMcpAdapter.request`의 grant/request 결합, 권한 검사를 재사용해 옛 grant와 새 grant 어느 쪽으로도 옛 요청을 현재 결과로 제출할 수 없도록 회귀 검사한다.
5. `src/web/control.ts::renderRecords`의 기존 복구 modal에 **종료 이력 미확인·권한 회수 후 재시도**를 별도로 표시한다. 옛 확인 체크를 자동 선택하거나 기존 ‘미제출 확인’ 문구를 재사용하지 않는다.

주요 실재 변경 대상은 `src/workspace/engine.ts::DiscussionEngine.control`, `src/workspace/dot-mcp-policy.ts::assertDotRetryAfterStop` 주변 공통 검사, `src/web/control.ts` 복구 modal이다. 기존 Store transaction/idempotency, `DotMcpAdapter.settle/request/call`, `Providers.complete`를 재사용한다. 신규 DB 필드·마이그레이션·MCP 도구/이벤트/페이지 입력 변경은 계획하지 않는다. 추가 상태 필드가 불가피하면 구현 전에 재보고한다.

외부 실행이 아직 살아 있다면 그 소비를 중지했다는 보장은 없다. 이번 계약이 보장하는 것은 **옛 권한·시도의 앱 결과 반영 차단**이다. 또한 현재 전달기는 원격 실행자별로 grant를 분리하지 않는다. 살아 있는 옛 실행이 새 전달기에 `get({})`을 호출하면 새 요청을 볼 가능성이 있으므로, 권한 회수를 **옛 실행자가 새 요청을 절대로 점유할 수 없다는 보장**으로 확대하지 않는다. 새 요청의 단일 winning claim·attempt/receipt 검사는 유지하지만 어느 원격 실행이 그 claim을 했는지를 독립 증명하지 않는다. 이 잔여 위험을 소유자가 받아들이지 않으면 종료 확인 전 대기를 유지하며, 별도 플러그인/실행자 인증 분리 같은 더 큰 범위는 추가 영향 검토 없이는 넣지 않는다.

## 1회 검증 범위와 운영 변경

현재 `scripts/live-acceptance-guard.mjs::acceptanceGuard`는 예약 수·방·참여자를 제한하지만 특정 과제 ID를 받지 않는다. 이전 R8 private 준비기는 모델30회·5참여자·Codex2작업을 허용하므로 그대로 실행하지 않는다.

- **승인된 검증 준비기**는 앱 시작·방on·resume 전에 설치하고 기존 방/토의/revision/원래 cross_review 과제/라운드·dot identity/입력 digest와 새 dispatch request를 고정한다. 범위 검사는 검토·회귀 검사 가능한 `scripts/live-acceptance-dot-once.mjs::dotOnceGuard`에 두고, 계정/배포 경로가 포함된 준비·복구 파일만 private로 둔다. 기존 acceptanceGuard의 durable `maxRequests:1`과 dot1명 허용을 결합한다. 최초 baseline은 재시작에도 바꾸지 않고 실패/미전송 예약도1회를 소비한다. non-topic·다른 과제·다른 참여자·format retry·Codex 등록/제출은 모두 차단한다. API 참여자0으로 새 API 호출0을 보장하며 기존 양수 API counter 설정을 사용 허용으로 해석하지 않는다.
- 실제 `turn.finished`(파싱/Store 반영 후)를 동기 관측해 다음 발언 전에 guard.stop을 적용한다. `dot.reply_received`나 receipt hook에서 먼저 room off를 하면 세대가 바뀌어 수락 전 답변을 잃을 수 있으므로 사용하지 않는다. 종료 때도 app.close 이후에 guard를 해제한다.
- 준비 단계는 자동 만료·정상 서비스 복구를 둔다. 첫 예약 이후 최대30분, 각 turn300초·기존 예산은 유지하며 실제로는 유일한 시도의 완료/오류 즉시 중단한다. 실패했을 때 두 번째 모델 요청을 예약하지 않는다.
- 호스트 영향은 **기존 검증 방식의 사용자 서비스 임시 ExecStart override 1개**와 private 전달기 환경의 `WJ_MCP_TRACE=summary`다. 기존 `.env`·원본 unit·AppArmor·방화벽·Tailscale·포트·Chrome/Muse profile은 변경하지 않는다. 현재 workspaceRoots는 빈 배열이므로 새 실행 경로/인증 사본이 필요 없다. 끝나면 자기 소유 override/trace/임시 grant/전달기만 정리한다.
- 실제 dot 감시는 현재 필터로1개만 연결한다. 각 도구 호출마다 응답 표현을 새로 해석하고 페이지별로 확인한다. 전체 원문·페이지 전체 배열·전체 분석 중간 결과를 한 출력으로 재출력하지 않는다. 원문 계약의 최종 JSON만 submit한다. 절단·오류이면 재시도 없이 중단한다. 이 지시는 기존 README의 페이지 처리 계약을 구체 적용하며 입력을 요약하거나 줄이지 않는다.

**예상 변경량: 저장소 10~14파일·350~650줄 + private 준비/복구 2~3파일·120~220줄(합계12~17파일·470~870줄).** 제품3파일 약90~150줄, 의미 있는 Node/재시작/브라우저/검증 guard 검사3~5파일 약160~300줄, SSOT·운영·실측·영향 문서4~6파일 약100~200줄이다. 실제 차이가 범위를 넘거나 다른 계약이 필요하면 다시 보고한다.

## 후속 단계 영향

| 단계 | 영향·유지 계약 |
|---|---|
| R1 저장 | 기존 원자적 state/event/idempotency 사용. 원래 시도·완료5개·usage/receipt 보존. DB 이관0. |
| R2 토의 | 동일 과제의 명시 준비 분기만 추가. 자동 재시도/자동 resume 없음. 초안·동일 라운드 공개 장벽 유지. |
| R3 / D4 UI | 종료 확인 경로와 종료 미확인 수락 경로를 구분. 권한 회수·미확인·준비/재개를 명시. |
| R4 / D3 dot | 기존 grant/request/attempt 경계 재사용. MCP Events·원문 페이지·권한 생성 정책 변경0. |
| R5 / R6 / R7 | 업무·실행 승인/보호·Wiki 인용 계약 변경0. 이번 새 API/웹 GPT/Muse/Codex 요청0. |
| R8 / D5 | 1회 진단 검증과 종료 미확인 복구 거절/원자성 회귀 추가. 원래 전체 혼합 토론 수락 기준은 유지하며 이1회로 전체 완료 처리하지 않는다. |

## 수락 기준과 롤백

1. fixture에서 원격 종료 미확인 동의·메모·감시 off·명시 revoke 중 하나라도 없으면 state/event/새 전송 모두0. 기존 reply/receipt·세대/입력 변경·경합도 거절한다(Node 검사).
2. 같은 owner 준비 명령20회 재생 시 audit1개/모델0회다. **위 private guard가 설치된 검증 실행**의 별도 resume에서만 새 예약 최대1개를 검사하며, 일반 resume 자체를1회 제한 기능으로 표시하지 않는다. 기존 완료5개와 원래 prompt/claim/receipt/usage가 동일하고 옛 submit은 수락되지 않는다(Node·실제 프로세스 재시작 검사).
3. 화면의 미확인 경고와 별도 확인이 없으면 요청0, 준비 후 자동 실행0(Chromium fixture).
4. private 검증기 fixture에서 다른 task/provider·resident/work·format retry·Codex 등록/제출을 모두 거절하고, 대상 완료/실패 후 새 예약0·정상 복구를 확인한다. 300초나 API 예산을 늘리지 않는다.
5. 승인된 실제1회에서는 trace의 페이지 index/count·시각·submit 도착/응답 분류와 실제 Store reply/receipt를 대조한다. 로그 부재·페이지 반환을 원격 미실행/분석 완료로 해석하지 않는다. 완료5개 digest 동일·비대상 요청0·호스트 복구를 별도로 기록한다.
6. 롤백은 새 준비 기능 사용 중지와 이전 빌드 복구다. 이미 기록한 미확인 audit/새 답변은 DB 백업으로 되돌리지 않는다. 토의 blocked/paused·방off에서 원래 기록을 계속 대조한다. 임시 override/env만 제거하며 원본 unit과 계정/대화/Chrome 데이터를 보존한다.

승인 범위는 **별도 복구 경로의 계획 개정·개발·모의 검사와 위 최소 검증 준비기**다. PR #66 배포는 완료됐지만 새 기능의 병합은 사용자 담당이며, 새 버전 배포/실계정 실행은 병합 시 별도 확인한다. 개발 중 운영의 원래 미확정을 유지하고 새 모델 요청을 보내지 않는다.
