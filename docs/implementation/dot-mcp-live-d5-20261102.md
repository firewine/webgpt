# D5 실환경 적용·수락 관측 — 2026-11-02

## 기준과 허용 범위

사용자의 PR #41 병합 후 “다음 페이즈 진행” 지시에 따라, 앞서 제시한 **서버 적용과 최대30분·provider 요청40회·DeepSeek High8회 이내의 혼합 검증**을 진행한다. 실제 Codex 실행은 제외하며 검증 종료 시 방을 off로 둔다. 기존 API 일일 잔여량·Muse 수동 조작 경계를 유지한다. 추가 OAuth, 공개 ingress, timeout 확대, 제품의 전역 채팅 한도를 추가하지 않는다.

PR #41은 2026-11-02 12:57:41 KST 병합됐다. 적용 main은 `befac863c3e8539faf2e189a7747f9f6d1bb757b`, 검사한 PR head는 `23abad876ad54558ebaa9fed02e23ee21c977b8f`다. 두 tree는 `22257918dc0aec82fc5d6213a820dd3a534ecf4d`로 같다. [병합 전 CI](https://github.com/firewine/webgpt/actions/runs/41384360145)는 Node477/browser65/Codex0.165 schema PASS다.

이번 변경은 D5의 기존 적용 절차5번인 **별도 검증 종료 제어**와 실행 증거의 구체화다. 실제 연결 검사에서 드러난 표준 MCP 요청 메타데이터 처리 오류도 `src/http/mcp.ts` 한 파일에서 수정했다. 의존성, DB schema, 원래50 gate, D5-A~F 기준 변경0. GUI/후속 단계 확대도 없으며 fixture만으로 실제 gate를 승격하지 않는다.

## 실제 관측

| 항목 | 실행·증거 | 판정 |
| --- | --- | --- |
| 정지 경계 | 기존 방1 owner API off. 준비/실행/미확정 turn0, 미해제 lease0, 실행 job0 | PASS |
| 백업 | Node SQLite online backup, private0600. 원래 state/vault/profile 유지 | PASS |
| 소스 적용 | 사용자 untracked35개와 새 추적 파일 충돌0. 별도 운영 브랜치로 main 적용, `npm run build` | PASS |
| 서비스 | 해당 `webjjoku`만 13:05:28 KST 재시작. 내부4090, 다른3000/기존 Serve/desktop 유지 | PASS |
| 보존 | `.env`·기존 connections/participants/discussions/messages/turns/Wiki/work·browser 수동 잠금 동일. 사용자 파일35개 해시 차이0 | PASS |
| 접속 | health workspace identity 정상, 기존 owner 키로 `/api/state` 정상. 실제 다른 기기 비밀번호 로그인·터치/IME는 미관측 | API PASS / 다른 기기 NOT_RUN |
| dot 권한 | 기존 방에 native 참여자1·발언 off. 소유자 확인 grant1·3도구·만료24시간·키0600. actor 암호학적 검증은 false 유지 | OBSERVED |
| 전달기 | `WJ_MCP_EXPECT_DOT=true`로 초기화/3도구/Events catalog 조회 성공·모델 호출0 | PASS |
| private Tunnel | D0 runtime0 확인 후 기존 터널/기존 file-reference runtime key 재사용. 별도 profile1·초기화 통지 옵션·metadata 조회/시작 정상. health/admin loopback | OBSERVED |
| Muse | 기존 계정/thread/URL·빈 입력을 재확인하고 허용된 수동 잠금 해제 후 주제 초안1개·receipt 회수. 종료 후 잠금 복구, binding 동일 | 실제 초안 PASS / 후속 검토 NOT_RUN |
| DeepSeek | 사용자 허용으로 API 일일8회·보고 토큰200,000 설정. CoralBricks High 초안1회·입력7,878/출력2,512 토큰 보고. 미지 usage0 | 설정·실제 초안 PASS |
| 실제 감시/응답 | native 감시1개, 요청3개의 callback 각1회 HTTP200. 첫 요청은 감시 실행 오류로 대조 종료. 수정 후 상주1개·주제1개 각각 claim/reply/receipt/기존 엔진 수락 | 실제 왕복2건 PASS / 전체 D5-F 미완료 |
| 혼합 검증 | GPT2·DeepSeek High·dot·Muse의 독립 초안5개 모두 수락, 이후 GPT2의 교차 검토2개·구조화 reviews20개 보존. 시간 창 종료로 동일 주제 cross_review1에서 pause. 전체 예약9회/응답8건/API1회/Codex0 | 일부 실행 PASS / 전체 수락 BLOCKED |
| 종료 복구 | 14:03:53 KST 방 off·참여 토글·Muse 잠금 복구, 미해제 lease0·미확정0. 14:05 정상 service entry 복귀, health/owner API·원래 기록 보존 | PASS |
| 감시/권한 정리 | 실제 `events/unsubscribe` 수신·구독0 확인 후14:12:33 KST 검증 grant 회수,14:13:13 해당 profile의 Tunnel1개 정상 종료. 사용자가 native 감시 비활성도 확인 | PASS |
| 실제 Codex | roots/binding 미준비이며 이번 범위에서 제외 | NOT_RUN |

연결별 모델 목록과 실제 응답은 구분한다. 이번에는 GPT2·CoralBricks High·Muse의 실제 초안을 확인했으며 River는 호출하지 않았다. Muse send 버튼은 빈 입력에서 보이지 않는 기존 `sendAppearsAfterInput` 계약을 유지한다. 읽기 전용 사전 검사로 계정/thread/빈 초안을 확인한 뒤 허용된 혼합 검증에서만 입력·전송했다.

로컬 증거는 실제 state 디렉터리의 `dot-mcp-d5-live-20261102/`에 있다. `before.json`, `quiescent.json`, `before-deploy.sqlite`, `deploy-checks.json`, `muse-preflight.json`은 private0600이다. 계정/대화/필터 ID·grant·runtime key·callback URL을 공개 저장소에 복사하지 않는다.

## 검증 전용 종료 제어

`scripts/live-acceptance-guard.mjs::acceptanceGuard`는 검증 프로세스의 `DispatchCoordinator.reserve` 경계에만 제어를 결합한다. 기존 transaction에서 원래 예약 함수보다 먼저 판단한다. 통과한 요청은 기존 예약→전송 전 기록→provider/Events→receipt→대조 경로로 진행하며 엔진/Store를 재구현하지 않는다.

- 기존 lease ID를 baseline으로 고정하고 새 **영속 예약**을 센다. 실패·미전송도 보수적으로 포함한다. 재시작/새로고침으로 횟수를 초기화하지 않는다.
- 최대40회·DeepSeek8회. room/참여자/연결/모델/High/출력 snapshot 변경 시 거절한다. 기존 `snapshotMember`의 DeepSeek 기본값을 사용하며 API 일일 한도를 대체하거나 늘리지 않는다.
- 첫 예약부터30분. 기존 turn timeout에 해당하는 마지막5분에는 새 예약을 차단하고 원래 응답을 기다린다.40회 뒤 현재 응답이 끝나면 off/pause.30분에도 요청이 남으면 off/pause 후 원래 결과 대조를 남기며 완료를 만들거나 재전송하지 않는다.
- 임시 entry는 Codex roots가 있으면 시작을 거절하고 기존 `beforeDispatch` 훅에서 예외를 발생시켜 명령 전송도 차단한다.
- `scripts/live-acceptance-server.mjs`는 적용 build의 Workspace·HTTP·자동 runner를 사용한다. 기본 `npm start`, 일반 서비스, 제품 채팅 한도에는 연결하지 않는다.

추가8검사 후 13:29:09 KST에 검증용 entry를 해당 서비스에만 적용했다. 기존 service 원본과 `.env`는 보존하고 전용 drop-in과 private script 사본/policy를 사용했다. 13:37:36 KST 첫 예약으로 창이 시작됐다. 첫 응답 대조와 감시 지시 수정 후에도 이 시각/횟수를 초기화하지 않았다. 14:02:36 신규 예약 차단, 진행 중 원래 답변 수락 뒤14:03:53 off/pause·참여 설정/잠금 복구,14:05 해당 drop-in만 제거해 정상 `dist/server/main.js`로 복귀했다. 소스 운영 commit은 계속 `01be270`이다.

1. private policy0600에 현재 roomId, baselineLeases, 허용 participant snapshot, `maxRequests:40`, `maxApiRequests:8`, `maxMs:1800000`, `drainMs:300000`을 고정한다. drain은 실제 timeout 이상이어야 한다. 이력 삭제나 baseline 재설정으로 횟수를 초기화하지 않는다.
2. 방 off/미확정0에서 이번 검증에만 entry를 `node --env-file=/실제/.env /검토한/scripts/live-acceptance-server.mjs /적용된/저장소 /보호된/policy.json`으로 지정한다. 단일 서비스만 실행하며 정상 entry는 복구 가능하게 보존한다.
3. health·소유자 인증·guard 초기 관측0/0·기존 IDs를 대조한다. native 감시, API 일일 정책, Muse 수동 잠금 조작 허용을 확인한 뒤 방/참여를 켠다.
4. 기존 안의 새 주제1/검토2라운드와 dot 자유발화·후속을 관측한다. 원문·반론·receipt/재분석·실제 사용량을 기록한다. 원격 감시의 지연을 이유로 timeout 계약을 임의 변경하지 않는다.
5. off/pause·미확정 대조·grant 회수·native 감시 종료 확인 후 전용 Tunnel runtime만 중지한다. off를 확인하고 임시 entry를 제거해 정상 서비스로 복귀한다. 새 기록을 지우려고 DB를 복원하지 않는다.

## 검사

```bash
node --test --test-reporter=spec tests/live-acceptance-guard.test.mjs tests/live-acceptance-server.test.mjs
npm run check
```

추가8개 PASS: 41번째 전송 전 거절·재시작 횟수 보존, API8회 제한·identity 변경 거절, 25분 신규 예약 차단/30분 off·pause, 기존 정책 위임·baseline 변경 차단, 범위를 넘는 policy 거절, 실제 ResidentRunner/Store transaction의 receipt/메시지 보존, 기존 DeepSeek snapshot 기본값, 실제 자식 entry의 HTTP/소유자 인증·off 종료. 모두 fixture이며 실제 모델 호출0이다.

최초 Node24.18.0/npm11.16.0의 `npm run check`는485 PASS였다. 아래 MCP 수정 후 관련70개와 전체 **486 PASS, fail/skip0** (`/tmp/webjjoku-dot-d5-live-mcp-fix-check.log`)를 확인했다. `9c087df`의 [CI](https://github.com/firewine/webgpt/actions/runs/41389080511)는 Node486·browser65·고정 Codex0.165.0 App Server 계약 PASS다. 실제 모델/감시 수락과 자동 검사 결과는 구분한다.

## 실제 첫 조회 오류와 보완

사용자는 첫 `dot_turn_get`에서 `INVALID_ARGUMENT/-32602/invalid_work_fields`로 중단했고 구독/claim/submit은 하지 않았다고 보고했다. 연결된 같은 플러그인에 빈 인자 `{}`를 전달해 같은 실패를 재현했다. Loopback의 같은 grant/도구 조회는 정상이고 `params._meta`를 추가하면 실패했다.

[MCP 기본 명세](https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta)는 `_meta`를 요청 메타데이터로 정의한다. 기존 native 경로는 이를 업무 인자 검사의 알 수 없는 필드로 거절했다. `McpEndpoint.handle`에서 object 형태만 확인하고 메서드 입력과 분리한다. 메타데이터를 권한/identity/도구 인자로 해석·저장하지 않으며 중첩 arguments와 다른 알 수 없는 필드는 계속 거절한다. 추가 OAuth나 권한 확대가 아닌 기존 프로토콜 호환 오류 수정이다.

수정 commit `5af26bd`를 운영 브랜치에 `01be270`으로 적용·빌드했다. 재시작 뒤 **동일한 실제 연결 플러그인 get 성공·현재 event 필터 반환·request=null**을 관측했다. 이는 실제 dot의 감시/발언 성공은 아니다. 새 회귀는 도구 조회·Events 목록/구독/해제와 메타데이터의 권한 우회 거절·저장0·잘못된 object/중첩 인자 차단을 검사한다.

## 첫 실제 요청과 대조

사용자가 동일 필터의 기존 감시가 없음을 확인하고 native 감시1개를 등록했다고 보고했다. 서버의 active 구독1개와 callback 검증을 대조한 후 첫 상주 dot 요청을 예약했다. 검증 중 ambient 참여는 dot만 일시 활성화했다. 기존 GPT 상주 맥락을 초기화하지 않으며, 후속 명시적 주제에는 허용된5명을 포함하는 절차였다.

전송1회/HTTP200은 수신 서버 응답이며 dot 실행이나 답변 성공이 아니다. 300초 뒤 claim/reply/receipt가 모두 없어서 기존 `dot_reply_unconfirmed` 경계가 발동했다. 원래 request/turn/lease와 전송 기록을 보존하고 새로운 요청·재전송·수동 대리 답변을 만들지 않았다. `live-start.json`, `live-progress.jsonl`, `live-outcome.json`에 private 실행 증거가 있다. 기존 member 토글 복구 및 `browserPaused=true`를 확인했으며, Muse 잠금 해제와 혼합 주제 생성까지 진행하지 않았다.

읽기 전용 대조에서 서버의 최신 도구 정의는 claim에 `requestId/commandId`, submit에 `requestId/attemptId/attemptToken/commandId/text`를 요구했다. 이 Codex 대화에 노출된 같은 플러그인 정의는 D0용 claim의 `requestId` 및 submit의 `requestId/attemptId/text`만 포함했다. **이 차이가 실제 dot 감시에도 적용됐는지는 UNVERIFIED**다. 원래 감시의 해당 시간 실행 기록/오류를 조회하도록 요청했으며, 확인 전 캐시 문제를 실패 원인으로 단정하지 않는다.

후속 사용자 보고: 실제 native 감시 실행은13:37:49 KST에 시작됐고 get은 성공했으나 commandId 생성 중 **`ReferenceError: crypto is not defined`**로 중단됐다. claim/submit을 호출하지 않았다는 보고는 서버 claim0/reply0과 일치한다. 13:47:35 KST에 원래 요청을 `resolution:skip`으로 대조 종료해 미해제 lease0을 확인했다. 이벤트는 이미 전달됐으므로 `not_sent`로 기록하지 않았고 원래 prompt/전송 기록을 보존했다. 실제 실패 지점은 감시 실행 환경이며 서버의 Node24 전역 crypto 사용을 이 오류와 혼동하지 않는다.

운영 안내와 최초 지시에 crypto/Node 모듈 없이 commandId를 생성·재사용하는 예시를 추가했다. commandId는 인증 credential이 아니며 attemptToken의 발급/검사 계약은 변경0이다. 사용자가 기존 감시 수정 완료를 확인한 뒤 **처음 시작한30분/40회 창과 API8회 한도를 그대로 유지**해 이어갔다. 이전 request를 재실행하거나 baseline/시간을 새로 초기화하지 않았다.

## 수정 후 실제 왕복과 혼합 결과

13:53:36 KST 새로운 상주 요청을 전송했다. native dot이 claim을 완료하고13:54:45 답변/receipt가 수락되어 방에 게시됐다. 이어 생성한 동일 방의5인 주제에서도 dot의 별도 claim/답변/receipt가 수락됐다. 권한 재발급 없이 off/on·상주→주제 전환을 통과했다. 서버가 발급한 attemptToken을 사용하는 운영 계약으로 성공했으므로, 앞서 다른 Codex 대화에서 보인 D0 도구 캐시를 실제 감시 실패 원인으로 기록하지 않는다.

| 실제 항목 | 관측 결과 | 남은 한계 |
| --- | --- | --- |
| dot | 상주 발언1개·주제 초안1개, 서로 다른 원래 request/receipt2개 | 주제 후속 재검토·같은 방 복귀 NOT_RUN |
| 독립 초안 | GPT OAuth·Codex 기기 코드·CoralBricks High·dot·기존 Muse 모두 completed/receipt | 3개 완료 시 공개 주제 메시지0, 5개 완료 후5개 공개 확인 |
| 교차 검토 | GPT2 응답 완료, 두 응답의 구조화 reviews 합20개 | DeepSeek/dot/Muse의1라운드, 전체2라운드·수정·종합/비교 미완료 |
| 요청/사용량 | 예약9개=초기 대조 종료1+dot 상주1+주제7. 정상 응답8개, API1회/10,390 보고 토큰 | 모델 가격/알 수 없는 사용량을 추정하지 않음 |
| 중지 | 시간 경계에서 새 예약 차단, 현재 응답 수락 뒤 paused·방 off | 같은 주제/원문/반론을 유지하며 전체 완료로 표시하지 않음 |
| 보존 | `.env`·password hash·원래 연결/참여자·과거 토의/발언/메시지·Wiki/업무 동일, 사용자 파일35개 변화0 | 실제 타 기기 로그인/터치/IME 검증은 별도 |

private 증거: `live-continuation-start.json`, `live-progress.jsonl`, `live-continuation-outcome.json`, `independent-barrier-observed.json`, `five-drafts-observed.json`, `acceptance-observed.json`, `normal-service-restored.json`. 실제 native 감시/claim/receipt와 주제 원문은 운영 DB에도 보존한다. 공개 문서에는 개인 ID·원문·키를 넣지 않는다.

API 일일8회·보고 토큰200,000 설정은 사용자 승인대로 유지한다. 서버의 `dot.unsubscribed` 이벤트·활성 구독0과 사용자의 native 감시 비활성 보고를 대조했다. 검증 grant 회수 뒤 profile/경로가 일치하는 Tunnel 프로세스1개만 SIGTERM으로 정상 종료했다. `native-unsubscribe-observed.json`, `native-grant-revoked.json`, `tunnel-stopped.json`에 기록했으며 원문/receipt2개·일시정지 주제를 보존했다. Muse·다른 provider와 서비스에는 종료 신호를 보내지 않았다.

이어갈 때는 기존 일시정지 주제와 누적 API 사용량을 사용하되 다음 실계정 검증 시간·요청 범위를 먼저 확정한다. 검증 grant가 회수됐으므로 현재 dot 연결을 계속 사용 가능한 상태로 안내하지 않는다. 다음 허용된 창에서 같은 dot/방의 새 scoped grant·전달기·native 감시를 준비하고 미확정0을 확인한 뒤 같은 주제를 재개한다. D5-F는 실제 일부 왕복이 확인됐으므로 NOT_RUN에서 BLOCKED로 갱신하며 수락 조건은 변경하지 않는다. 다른 기기/Codex gate도 미완료이고 D5 전체 완료를 선언하지 않는다.
