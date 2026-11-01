# D0 native dot — 한 번의 이벤트 왕복 검사

2026-11-02 KST. [SSOT](./development-plan.md)·[실행 기록](./implementation/dot-mcp-events-d0-20261101.md)을 따른다. 합성 fixture0.4.0용 운영 절차이며 **native 왕복 완료 기록이 아니다.** Muse·운영 방·Wiki·Codex를 사용하지 않는다.

## 대조한 사용 예제

| 근거 | 확인한 점 | 이 프로젝트에 적용 |
| --- | --- | --- |
| [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events) | 사용자가 감시 대상과 도착 후 행동을 지정하면 ChatGPT가 구독/callback을 구성하고 서버가 이벤트를 보냄 | get만 호출하거나 즉시 답변을 제출하는 것으로 구독을 대신하지 않음 |
| [OpenAI 연결/검사 — Refresh metadata](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) | 변경 metadata 갱신 후 새 대화에서 검사 | 서버의 최신 catalog와 기존 대화의 snapshot을 구분. 일반 Work 검사는 Cloud에서 수행 |
| [설치 Tunnel CLI의 초기화 guard/보완](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/pkg/mcpclient/serialized_forwarding_transport.go#L397) | stdio handshake가 끝나지 않은 operational call은 child에 보내지 않고409로 거부 | 현재 D0는 공식 `--mcp.stdio-send-initialized-notification` 사용. guard를 끄지 않으며 get의 notification 수신 횟수로 확인 |
| [recly dot-probe 고정 commit edb2765](https://github.com/rokrokss/recly/commit/edb2765d5498c792e43d898946d149ae6ba36303) | 작성자가 실제 dot의 이벤트 기동 후 읽기 도구 호출·결과 작성을 보고 | 이벤트는 신호로 쓰고 get으로 입력을 다시 읽는 방식 재사용. 공개 HTTP/OAuth/Funnel 구성은 복사하지 않음; 현재 private Tunnel 유지 |
| [실제 dot payload 누락 보고 #50714](https://github.com/openai/codex/issues/50714) | callback200/실행 기동과 payload 전달이 다를 수 있다는 작성자 관측 | event data가 보이지 않아도 scoped get으로 조회. callback200만으로 응답 완료 판정 금지 |
| [구독 동작 미노출 보고 #49665](https://github.com/openai/codex/issues/49665) | 도구/Events 발견 후에도 native 구독 action이 없는 사례 보고 | 현재 계정의 같은 원인을 입증한 것은 아님. 구독 미지원은 명시 중단하고 일반 polling/가짜 callback으로 성공을 만들지 않음 |

외부 예제의 코드·자산은 복사하거나 실행하지 않았다. 보고자의 성공 환경과 현재 Tunnel/계정의 성공을 동일시하지 않는다. 추가 OAuth·공개 ingress는 기존 미승인 확대 경계를 따른다.

## 사용자 요청 한 번

이미 등록한 검사 plugin `ubuntu_dot_d0_v3`를 실제 dot에서 사용할 수 있게 선택한다. 원래 `ubuntu_dot`·Muse 연결은 보존한다. dot에게 아래 전체를 한 번 요청한다. 일반 ChatGPT에서 plugin의 인사/도구 확인을 한 것은 실제 dot의 감시 등록 증거가 아니다. 일반 Work 채팅으로 transport만 비교한다면 새 대화/Cloud를 사용하되 실제 dot 수락과 별도로 기록한다.

```text
ubuntu_dot_d0_v3로 D0 합성 이벤트 검사를 수행해.
dot_turn_get을 한 번 호출하고, 반환된 event.name과 event.arguments 그대로
MCP Events에 구독하는 이벤트 기반 감시 작업을 만들어.
주기적 조회 작업으로 대체하지 말고, 지금 claim·submit하지 마.

이벤트가 도착한 작업 실행에서 dot_turn_get으로 현재 requestId를 읽고
dot_turn_claim을 호출해. 반환받은 attemptId와 같은 requestId로
dot_turn_submit에 ‘D0 연결 확인’ 한 문장을 제출해.
accepted와 receipt를 확인한 뒤 감시를 종료해.

감시 생성 기능이 없거나 등록에 실패하면 재시도하지 말고
실패 단계와 오류만 보고해. 이 합성 검사 외의 작업은 하지 마.
```

probe/request ID를 예전 대화에서 복사하지 않는다. callback URL·서명 키는 ChatGPT의 이벤트 서비스가 제공하며 사용자가 임의 생성하거나 채팅에 공유하지 않는다. 최초/쓰기 승인 요구는 실제 UI에 따라 기록한다. 불명확한 등록에는 같은 요청을 다시 보내지 않고 기존 작업 목록과 서버 get을 대조한다.

## 실행 증거와 중단 지점

| 순서 | 확인할 증거 | 판정 |
| --- | --- | --- |
| 1 | read-only get의 `initializedNotifications>=1`, `nextAction=SUBSCRIBE`, 현재 event/arguments, `subscribeRequests=0` | 현재 stdio 준비. 왕복 성공 아님 |
| 2 | get 진단의 `SUBSCRIBE_RECEIVED` → `CALLBACK_RETURNED` HTTP2xx/challengeMatches → `SUBSCRIPTION_ACTIVE` | 구독·callback 검증 성공 |
| 3 | `WEBHOOK_RECEIVED` 및 실제 dot의 이벤트로 시작한 작업 | 전달/기동. 응답 성공과 구별 |
| 4 | 실제 dot의 get→claim→submit, `accepted=true`와 receipt; 서버 `replyAccepted=true`/같은 receipt | 합성 답변 수락 |
| 5 | 감시 종료·`UNSUBSCRIBED` 확인 | 수명 종료. 불명확하면 종료 미확인으로 기록 |

fixture는 구독당 유한10분·일회 이벤트·메모리 상태다. 실패/timeout/조회로 새 이벤트를 보내거나 자동 재시도하지 않는다. 이벤트 전송2xx와 실제 dot 응답·종료가 모두 확인되기 전 D0 전체를 PASS로 바꾸지 않는다.

`-32602`의 `data.reason=subscription_required`는 감시가 없는데 claim/submit을 시도한 경우다. `current_request_required`는 현재 request와 다르고 `subscription_expired`는 구독 만료다. callback 오류는 `-32015`와 안전한 분류/HTTP 상태로 별도 대조한다. 과거0.3.0의 일반 오류 문구만으로 이 세 원인 중 하나를 확정하지 않는다.

운영자가 기록할 것은 코드 commit·fixture/CLI 버전·수행 surface(dot/Work)·순서별 PASS/FAIL/NOT_RUN·원래 작업과 대조/종료 여부다. 공개 기록에는 ID 원문·callback URL·key·claim token·개인 대화가 아닌 최소 상태만 남긴다. 실패 시 합성 runtime만 중지하고 원래 receipt와 미확인 상태를 보존한다.
