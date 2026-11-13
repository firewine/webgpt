# dot 교차검토 300초 중단 진단·전달기 무응답 수정 — 2026-11-13

**판정: 실제 교차검토 중단의 최종 원인은 UNVERIFIED. 별도로 재현한 전송 크기 초과 무응답 결함은 수정·회귀 검사 PASS.** 11월10일 토의의 완료5개·원래 미확정 요청/입력/claim은 동일하게 보존됐고, 운영 DB/서비스/권한 변경·실계정 재호출은0이다. 이 수정을 실제 교차검토 timeout 해결로 표시하지 않는다.

기준 main `e580cec8c38d02020ddabe125d3d8f5bffee84f7`(PR #65 병합), 작업 브랜치 `codex/dot-cross-review-diagnosis-20261113`. 운영 `5d5c824`와 제품 소스는 동일하며 차이는 이전 실측 문서3개다. 사용자 지시는 원인부터 확인·수정, 완료5개 보존, 계획 변경 전 영향/변경량 보고다.

## 실제 요청의 서버 증거

시각은2026-11-10 KST다. Store·command journal·해당 서비스 journal·전용 Tunnel 로그를 읽기 전용으로 대조했다. 계정/대화 원문과 토큰은 공개하지 않는다.

| 시각·증거 | 확인된 사실·한계 |
|---|---|
| 22:28:42.204 / Store | 교차검토 dispatch. |
| 22:28:45.152 / outbox | 이벤트 HTTP200. 뒤의 claim까지 성공했으므로 단순 이벤트 미도착으로 설명하지 않는다. |
| 22:29:35.339 / Store | 같은 요청의 claim 성공. dispatch 이후53.135초다. |
| 22:29:23.899~22:31:17.887 / Tunnel | 전달 패킷57개. discovery/숫자 RPC id0/id1 각각19개지만 메서드·인자·성공/오류는 저장되지 않았다. 이 개수를 실제17페이지 읽기로 환산하지 않는다. |
| 22:31:17.887~22:33:42.234 | 마지막 전달 패킷부터 timeout까지144.347초. 외부 생성 중이었는지, 파싱/제출 준비에서 중단됐는지는 UNVERIFIED다. |
| 22:33:42.234 / Store | 답변/receipt 없이 `dot_reply_unconfirmed`. 같은 요청의 성공 submit command0, mailbox reply0. 거절된 submit 시도 여부는 이 journal만으로 확인할 수 없다. |
| 22:33:47 / 복구 | 방off/잠금과 기존 정상 서비스를 복구했다. 이때 stdio 프로세스 종료 경고가 기록됐으므로 종료 뒤 경고를 앞선 timeout 원인으로 돌리지 않는다. |

해당 시간의 서비스 journal에는 새 오류 분류 기록이 없었다. `McpEndpoint.handle`이 반환하는 도구 오류와 `dot_turn_get`의 페이지 반환은 durable event로 남지 않는다. `DotMcpAdapter.call`에서 수락한 reply는 원문/digest/receipt·idempotency 결과와 같은 Store transaction에 저장된다. 현재 reply/receipt가 없으므로 **저장된 답변을 ack 분실 때문에 못 찾는 상황은 아니다**. 실제 호출 자체가 있었는지 또는 로컬 전달 전에 실패했는지는 별도 대조가 필요하다.

실제 dot에게22:28~22:34 실행의 마지막 정상 페이지·답변 생성/submit 여부·오류를 새 도구 실행 없이 조회하도록 요청했다. 이 기록을 받기 전 생성 완료·submit 미실행·감시 종료를 추정하지 않는다. 원래 미확정 요청은 명시 재시도/skip으로 바꾸지 않았다.

## 보존 입력의 로컬 재현

원래17페이지/154,180 UTF-8 bytes를 재구성해 같은 `inputDigest`와 완전 원문 일치를 확인했다. 기존 방 메시지63개와 직전 prompt 이력이 포함되며 Wiki snapshot0이다.

| 검사 | 결과·범위 |
|---|---|
| 실제 SQLite snapshot 읽기3회 | 50.11/47.12/43.99ms. 읽기 전용 연결이며 DB 쓰기0. |
| 순수 `dotInputPage`·v2 text JSON 해석17페이지 | 84.56ms, 모든 원문/digest 일치, 최대 complete RPC11,937bytes. |
| `McpEndpoint`→`McpEvents`→실제 adapter17페이지 | 가짜 권한·분리된 메모리 state로717.11ms, 원문 일치. 전체 state clone119회. 원래 권한/DB/실제 native/네트워크는 사용하지 않았다. |
| 완료5개 보존 대조 | promptDigest·답변 원문/구조화 reply/receipt digest 동일, 토의 snapshot 동일. 원래 실패 상태도 유지. |

위 시간은11월13일 로컬 재현이다. 과거 서버 부하나 native의 각 페이지 수신/해석·추론 시간을 증명하지 않는다. 현재 근거로 서버 페이지 계산만이300초의 원인이라고 할 수 없으며, native 전체 입력 읽기 성공으로도 승격하지 않는다.

## 재현·수정한 별도 결함

`scripts/mcp-stdio.mjs`는256,000bytes를 넘는 줄을 **JSON의 id를 읽기 전에** 거절했다. catch는 `message.id`가 있어야 오류를 내보내므로 해당 줄을 조용히 버리고 다음 요청으로 넘어갔다. 예를 들어90,011자 한글 reply는100,000자 제한보다 짧아도 요청의 UTF-8 bytes가256,000을 초과할 수 있다. 수정 전 실제 전달기 회귀에서id41 오류가 사라지고 다음 ping42만 성공하는 현상을 재현했다. **실제11월10일 submit이 이 크기였다는 증거는 없다.**

수정은 다음 범위다.

- 전달/HTTP 제한256,000bytes와25초 전송 timeout은 유지한다. 초과 입력을 서버로 보내지 않는다.
- 오류의 올바른 최상위 ID를 읽기 위한 JSON 검사만1,024,000bytes까지 제한한다. 이 안의 유효 request는 기존 `-32603` 오류와 같은 ID를 받으며, 다음 정상 요청은 계속 처리한다.
- 유효 notification에는 응답하지 않는다. 중첩 ID/객체 ID를 반환하지 않고, 파싱 불가 입력은id:null의 parse error다.
- 검사 상한을 더 넘으면 EOF/exit1로 연결을 종료한다. 무제한 JSON.parse나 불명확한 notification 응답을 피한다. 이 경우 전달기 재시작은 운영 대조 후 수행하며 자동 재전송을 추가하지 않는다. Node readline은 여전히 줄 전체를 버퍼링하므로 이것을 스트리밍 메모리 상한 구현이라고 표시하지 않는다.
- `src/`·DB·기존 도구 입력/페이지·claim/submit·300초·안전 경계·Muse/5개 답변은 변경하지 않는다. 변경 파일은 전달기와 해당11개 fixture이며, 새 진단 telemetry는 아직 구현하지 않았다.

## 검사·배포 상태

- 집중 전달기 fixture **11 PASS/0 SKIP**: 다중 바이트/정확한 경계/최상위 ID·escaped key/notification/잘못된 입력/전송 실패/다음 요청/초과 연결 종료. 가짜 grant·임시 loopback mock만 사용했다.
- `npm run check`: strict TypeScript·빌드 PASS, Node **863 PASS/0 FAIL/6 SKIP(총869)**. skip은 기존 실제 Codex/결합 보호의 환경 선택 검사이며 이 결과로 호스트/실계정 수락하지 않는다.
- `git diff --check` PASS. UI/브라우저 소스 변경0이므로 관련 없는 브라우저 검사를 로컬에서 반복하지 않았다. PR CI는 해당 head의 결과로 따로 확인한다.
- 운영 반영·실제 dot 재실행은 NOT_RUN. 제품 계획의300초·입력 내용·페이지 한도·실행/수락 기준 변경0이다.

## 추가 진단이 필요한 경우

실제 dot 실행 기록으로 단계를 확인할 수 없다면 [선택형 메타데이터 로그 영향안](../reviews/dot-call-observation-impact-20261113.md)을 제안한다. 제안은 승인 전이며 요청/응답 원문 없이 단계·pageIndex·오류 분류·소요 시간만 남기는 D4/R8 보완이다. get의Store0 writes·기존5답변·현재 미확정은 유지한다. 새 계약이나 재호출을 승인된 것으로 취급하지 않는다.
