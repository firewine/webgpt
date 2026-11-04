# dot 페이지 전송 중복 축소·제출 오류 복구 영향 검토 — 2026-11-04

**상태: 제안/미승인.** 이 문서는 사전 영향 보고다. 계획 SSOT의 실행 상태만 갱신했으며 아래 제품/계획 계약을 아직 구현하거나 적용하지 않았다. 기준 제품 main은 `f3a2e34026c37c2bff52e194678b3de795c84d62`, [실환경 증거](../implementation/dot-mcp-resume-live-d5-20261104.md)를 따른다.

## 문제와 근거

1. `src/connections/dot-input-pages.ts::dotToolResult`는 원래 payload를 `content[0].text`와 `structuredContent`에 중복 담는다. `dotInputPage`는 두 표현을 합친 RPC12,000bytes 이내로 나눈다.137,805bytes의 같은 토의 검토2 입력이31페이지로 나뉘었다.
2. 실제 native는 모든31페이지와 같은 digest를 확인했다. 첫 페이지까지59.046초·페이지 구간235.565초·마지막 조회 후300초 제한까지 약5.5초였다. `DotMcpAdapter.complete/settle`이 미확정으로 정지했고, 서버 reply/receipt는0이다. 모델이 답변을 만들고 submit 오류를 받았다는 사용자 보고는 있지만 구체 오류·호출 시각·외부 최종 상태는 UNVERIFIED다.
3. `docs/reviews/dot-explicit-retry-impact-20261102.md`의 승인 계약은 **외부 실행 중단과 submit 미실행**을 확인한 경우다. `src/web/control.ts::renderRecovery`의 `stoppedWithoutSubmit`도 이 의미다. 이번 submit1회 오류를 ‘submit 미실행’으로 바꾸지 않는다. 기존 `engine.control(reconcile/completed)`의 `reconcileDotReply`도 서버 reply 없음을 거절한다.

[OpenAI Plugins Reference의 Tool results](https://developers.openai.com/plugins/reference#tool-results)는 `content`와 `structuredContent`를 각각 optional로 정의하고 둘 모두 모델에게 보인다고 설명한다. 이 근거는 단일 표현 설계의 프로토콜 근거이며, 특정 실제 dot의 native 작업/툴 결과 처리 성공을 보장하지 않는다. 그 호환성은 별도 실제 수락 전 **UNVERIFIED**다.

private 오프라인 크기 projection은 제품 코드를 바꾸거나 모델을 호출하지 않았다. 같은137,805bytes를 단일 text content JSON으로 전송하면 **16페이지·최대RPC11,937bytes·문자 단위 무손실**이었다.31→16 조회 수48.4% 감소는 계산 결과다. 실제 시간48.4% 감소를 뜻하지 않는다.

## 대안과 선택

| 대안 | 영향·판정 |
| --- | --- |
| 그대로 같은 입력을 다시 요청 | 긴 순차 조회가 생성 시간을 소진한다. 실패 원인을 고치지 않은 반복이므로 기각 |
| timeout/페이지 상한 확대 또는 원문 요약 |300초/12,000bytes·전체 원문 계약을 바꾼다. 이번 변경에 포함하지 않음 |
| native 페이지 조회를 여러 개 동시 실행 | 서버 조회는 읽기 전용이지만 대상 native 실행 환경의 병렬 도구 호출 지원/스케줄링은 UNVERIFIED. 현재 기본 해결로 선택하지 않음 |
| **새 요청에만 버전을 고정한 단일 content 표현** | 원문·도구 입력 schema·순차 읽기를 유지하면서 중복을 줄인다. 기존 요청의 dual 표현/경계는 유지. **권장** |

## 제안 계약 — 기존 계약과 최소 변경

### A. 새 요청의 페이지 표현

- **제안 필드** `DotRequest.inputTransportVersion?: 2`. 기존 undefined는 현행 이중 표현/페이지 계산으로 고정하고 새 `DotMcpAdapter.prepare`만2를 기록한다. SQL 이관·기존 요청 backfill은 없다. 알 수 없는 버전은 검증에서 거절한다.
- v2의 paged get만 text `content`에 JSON을 한 번 담고 `structuredContent`에 같은 원문을 재복사하지 않는다. **제안** 페이지 metadata `transportVersion:2`로 요청 안의 표현을 식별한다. JSON의 `encoding`, pageIndex/pageCount/nextPage/text·inputDigest 의미는 유지한다.
- 기존 요청·legacy full get·metadata/claim/submit 응답은 현행 표현과 동작을 유지한다. 입력 schema `inputPage`와 세 도구 이름을 바꾸지 않는다. 새 플러그인/키/Tunnel/로그인을 필수로 만들지 않는다.
- 고정 prompt/history·digest·winning attempt 검사·Store read-only0 writes·RPC12,000bytes·모든 페이지 확인 뒤 JSON submit·300초를 유지한다. 페이지별 인증/현재 revision·세대/권한 대조를 생략하지 않는다.
- 표현 버전은 새 요청 생성 transaction에 같이 기록한다. 재시작·receipt 변화·새로고침으로 같은 요청의 경계를 바꾸지 않는다. helper를 순수 함수로 유지하고 새 전송 프레임워크를 만들지 않는다.

### B. submit 오류 뒤 소유자 명시 복구

- **제안 선택지** `resolution:retry_after_failed_submit`과 별도 소유자 확인을 기존 `DiscussionEngine.control`에 추가한다. 기존 `retry_after_stop`/`stoppedWithoutSubmit` 의미와 호환은 유지한다.
- 같은 주제/현재 phase·round·revision·generation·참여자·고정 입력·최신 task/held request·unconfirmed lease를 검사하는 `assertDotRetryAfterStop`을 재사용한다. **서버 reply/receipt/text가 하나라도 있으면 거절**한다. 오류 후 응답을 놓친 사례를 무조건 재전송하지 않는다.
- 새 선택지는 원래 grant가 회수돼 그 claim도 실효 권한이 없고, 소유자가 외부 실행 중단·추가 제출 없음·오류 대조 사유를 명시한 경우만 허용한다. claim 상태 enum을 새로 만들지 않고 기존 권한 대조를 재사용한다. 감시 off/timeout만으로 중단을 추정하지 않는다. 확인 불가면 계속 BLOCKED다.
- 기존 transaction에서 원래 실패/과제/입력과 `submitAttempted:true`, `serverReceiptAbsent:true`, 중단 확인/사유를 event에 남기고 원래 turn/request/lease를 종료해 같은 task만 pending으로 둔다. **복구 자체 전송0·별도 resume 필요**다. 늦은 옛 응답 격리·명령 idempotency를 유지한다.
- native 주제 토의의 현재 미확정 한 건만 대상이다. Muse·API·Codex·상주/업무의 복구 계약으로 확대하지 않는다. 원래13개 완료 답변과 모든 실패 기록을 보존한다.

## 파일·후속 단계·변경량

| 대상 | 변경·기존 계약 |
| --- | --- |
| `src/connections/dot-input-pages.ts::dotToolResult/dotInputPage` | 버전별 표현/바이트 비용, legacy 계산 유지. 순수 분할·무손실·12,000bytes 유지 |
| `src/connections/dot-mcp.ts::DotMcpAdapter.prepare/call` | 새 요청 버전 snapshot·해당 버전 get projection. `Providers.complete`·권한/claim/submit 계약 유지 |
| `src/workspace/dot-mcp-model.ts::DotRequest`, `dot-mcp-policy.ts::validateDotRequests/assertDotRetryAfterStop` | optional 버전 검증·기존 순수 복구 guard 재사용/추가 사전조건. 기존 row/SQL 변경0 |
| `src/http/mcp-events.ts`의 도구 결과 wrapping 경로 | 해당 get 페이지에만 단일 표현 적용, 나머지 응답 호환. Events/서명/구독·outbox 유지 |
| `src/workspace/engine.ts::DiscussionEngine.control`, `src/web/control.ts::renderRecovery` | 별도 제출 오류 복구 선택·확인·감사 기록. 이전 미실행 확인/기타 복구·명시 resume 유지 |
| `tests/dot-mcp.test.mjs`, `dot-mcp-restart.test.mjs`, native/브라우저 fixture·연결 UI 검사 | v1/v2·늦은 결과/중복/서버 receipt 존재/재시작·확인 누락 거절을 검증. 실제 호출과 분리 |
| SSOT·기존 paging/retry 검토서·운영 절차·구현 기록·수락표 | 승인일/새 계약·버전/복귀·fixture와 실제 수락 구분. 원래50 gate 유지 |

예상 **고유14~18파일·500~850줄(제품·검사·문서 포함)**이다. 신규 문서/필드는 모두 제안이며 실제 파일/심볼 범위는 구현 중 같은 계약 안에서 구체화한다.

- **D3:** 요청 입력 표현 버전과 현재 주제의 추가 소유자 복구 선택만 보완한다. 공통 dispatch·단일 실행·전송 전 기록·Store transaction·불명확한 재전송 금지는 유지한다.
- **D4:** 원래 dot/플러그인의 기존 도구 schema로 페이지를 읽고 별도 제출 오류 확인을 노출한다. OAuth/권한 범위·Muse browser/thread·기존 GUI 구조는 유지한다.
- **D5:** 긴 입력 조회/수락·기존 완료13개 보존·두 번째 라운드/후속을 다시 확인한다. 기존50 gate·미실행 기기/Codex 수락은 낮추지 않는다. 신규 phase는 없다.

## 수락과 복귀

1. **Node/HTTP/stdio:** 한글·따옴표·역슬래시·surrogate 경계의 v1/v2 원문 재구성/digest 동일, 같은 요청20회 조회와 재시작의 pageCount/내용 동일, RPC wrapper+200자 id 포함 각 결과≤12,000bytes. v1 legacy record의 경계를 바꾸지 않는다.
2. **크기 fixture:** 현재137,805bytes에 준하는 비공개 아닌 합성 입력에서 단일 표현의 페이지 수가 dual보다 작음을 검증한다. private 원문을 fixture/commit에 복사하지 않는다. 실제31→16은 별도 private projection 근거로만 기록한다.
3. **복구 fixture/UI:** 확인/사유/권한 회수 누락·결과/receipt 존재·다른 task/세대/진행 lease를 거절한다. 같은 명령 반복은 새 요청0, 별도 resume 뒤 새 요청1, 늦은 옛 submit은 공개0. submit 오류와 submit 미실행을 감사 기록에서 구분한다.
4. **필수 검사:** `npm run check`, 설치 Chrome MCP를 지정한 `npm run test:browser`; 설치 계약은 실제 사용할 Codex 파일/schema와 별도 대조한다. fixture 통과를 실제 native 완료로 표시하지 않는다.
5. **별도 실계정 승인 뒤:** 같은 dot의 실제 단일 content 읽기·전 페이지/digest 확인·300초 안의 JSON/receipt 수락을 확인한다. 미지원/절단/timeout이면 멈추고 BLOCKED를 유지한다. 실제 개선 성공은 현재 UNVERIFIED다.

복귀는 방 off·진행/미확정 대조·유효 claim/권한 정리 뒤 이전 배포로 돌아가는 기존 G0 절차를 따른다. 진행 중 v2 요청을 v1 경계로 바꾸지 않는다. 기존 optional field와 원문/결과/실패 기록을 지우지 않으며 DB 백업으로 현재 상태를 덮어쓰지 않는다. 새 버전 기록의 이전 배포 호환을 fixture에서 확인하지 못하면 코드 롤백 전에 그 요청을 보존·격리해 대조한다.

**승인 대상:** 위 A+B 계획 개정·구현. 서버 적용·추가 실계정 모델 호출·실제 Codex·OAuth 확장은 포함하지 않는다. 사용자 승인 전 제품 코드는 유지한다.
