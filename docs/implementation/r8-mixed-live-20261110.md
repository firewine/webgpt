# R8 혼합 실계정 검증 — 2026-11-10

**결과: 5인 독립 초안 PASS / 첫 native 교차검토 BLOCKED / 전체 R8-D·D5-F 미수락.** 원래 초안5개와 미확정 요청/입력/claim을 보존했다. 교차검토의 실제 dot 실행 단계는 소유자 대조를 기다리며, timeout만으로 입력 절단·전송 실패·사용량 부족을 판정하지 않는다.

11월13일 [후속 진단](./dot-cross-review-diagnosis-20261113.md)에서 동일5답변/토의 보존·17페이지 무손실 로컬 재현과 마지막 전달 패킷 시각을 대조했다. 별도 크기 초과 전달기 무응답 결함을 수정했지만 실제 중단의 원인인지는 UNVERIFIED이며 이 실행의 수락 판정은 변경하지 않는다.

기준 main `5d5c824d107beadf3aba441f28e477fa9a133cb7`(PR #64 MERGED·CI PASS), 기록 브랜치 `codex/r8-mixed-live-20261110`. PR #64의 문서/브라우저 fixture 외 제품 소스는 이전 배포 `8b66354`와 동일하다. Node24.18.0/Codex0.166.0을 재확인했다. 이번 기록에서 선행 CI/합성 검사를 오늘의 실계정 완료로 합산하지 않는다.

## 승인·준비

- 11/09b 준비는11/09 22:21:50 KST에 기한 종료/정상 복구됐다. 새 모델/API/job/binding0과 [원래 준비 이력](./r8-mixed-account-live-20261108.md)을 보존했다.
- 11/10 사용자가 같은 미사용 승인 폴더 `/home/firewine/.local/share/webjjoku-r8-validation/20261109b/repo`·HEAD `e32dc8ef9f88cf622160b49b16f60b434dc3b665`의 재개를 명시했다. [직접 주제 재개안](../reviews/r8-native-decoder-rearm-impact-20261109.md)과 [혼합 실행 범위](../reviews/r8-mixed-execution-impact-20261108.md)를 유지했다.
- 범위는5인 새 주제1개·교차검토1라운드, 첫 예약부터30분/모델 예약30회/DeepSeek High6회/Codex2job이다. 기존 일일 API8회·보고200,000토큰, 각 turn300초와 마지막5분 신규 예약 차단을 유지했다. 보호 읽기 `/bin/bash -c 'node check-boundary.mjs'`1회만 사전 승인됐고 쓰기/원본 반영은 각각 별도 소유자 확인 대상이다.
- 현재 권한의 native 감시1개를 사용자/서버에서 대조한 뒤 보호 read 새 thread를 등록했다. 실제 두 웹 계정의 원래 대화·Extra High·빈 입력/응답 중 아님, Muse 원래 대화의 ready를 확인했다. 별도 ambient 준비 요청은0이다.
- private 준비 제한은 명시적 후속 단계 전까지 non-topic 예약을 막는다. 운영 중 기존 방이 켜진 상태가 관측됐지만 새 예약0을 확인한 뒤 기존 API로 주제에 전환했다. 별도 호스트 보호 정책/로그인/키/provider/제품 API 변경은 없다.

## 실제 시간·응답

시각은 모두2026-11-10 KST다. private Store/event·원문/receipt·복구 영수증을 대조했으며 계정/내부 thread·turn 식별자와 대화 원문은 공개하지 않는다.

| 시각 | 관측·판정 |
|---|---|
| 22:22:14.468 | 첫 topic 예약. 이번30분 창의 기산점이며 처음부터 topic 실행이었다. |
| 22:22:18.534 | 첫 native 이벤트 HTTP200. claim 이후 실제 응답이22:25:01.333에 수신/수락되고 consumed·receipt를 확인했다. v2 첫 페이지 해석 오류는 이 요청에서 재발하지 않았다. |
| 22:25~22:28:41 | 두 웹 GPT·DeepSeek High·원래 Muse 초안을 각각 수락했다. 독립 초안5개 모두 reply/receipt가 있으며 고정된 각 초기 prompt에 다른 새 초안의 원문이 포함되지 않았음을 대조했다. 이는 `promptFor`의 독립 초안 경계에 대한 관측이며 외부 계정의 모든 기억을 검사했다는 뜻은 아니다. |
| 22:28:41.964 / 22:28:45.152 | 첫 native 교차검토 요청 준비 / 이벤트 HTTP200. |
| 22:29:35.339 | 교차검토 claim 활성화. |
| 22:33:42.234 | 서버 reply가 없어 `dot_reply_unconfirmed`로 중단. 최초 dispatch부터300초이며 claim 뒤300초를 다시 부여하지 않는다. |
| 22:33:47.793 | 검증기 중단 후 정상 서비스/health·방off/Muse 잠금, 현재 grant 회수·터널/자기 소유 임시 drop-in/auth 사본 정리를 확인했다. |

## 입력 크기와 판정 한계

첫 native 입력의 로컬 예상은8페이지/71,942 UTF-8 bytes·prompt37,926자/history0이다. 교차검토는17페이지/154,180bytes·prompt43,431자/history2항목·content38,557자였다. **실제 dot이 읽은 페이지 수와 submit 시도 여부는 아직 UNVERIFIED**다. 로컬 pageCount나 서버 accepted를 실제 전체 페이지 조회 증거로 바꾸지 않는다.

주제에 고정된 `roomMaterial`33,147자 중 기존 공개 방 메시지63개가33,114자이며 Wiki snapshot은0개였다. 새 검증 자료630자/비교 기준1,359자에 이전 방 자료와 직전 prompt 이력이 더해진 상태다. 반복 입력은 크기 관측이며 이번 중단 원인으로 확정하지 않는다. Wiki 크기나 예전 HTTP429에 귀속하지 않는다.

`DiscussionEngine.create`가 고정하는 방 자료, `promptFor`와 기존 context history, `dotInputPage`의 원문/digest/페이지 경계는 실행 중 바꾸지 않았다. native의 기존 context handoff는 `native_dot_context_preserved`로 차단된다. 완료5개나 원문을 줄이기 위해 이 계약을 우회하지 않는다.

## 실제 사용·미실행

| 항목 | 실제 결과 |
|---|---|
| 새 모델 예약 | 6회: 초안5개 수락 + native 교차검토1개 미확정 |
| API | DeepSeek High1회, 보고 input21,648/output2,047 = **23,695토큰**. 금액은 추정하지 않는다. |
| 미보고 사용량 | Core unknownUsage5. 미확정/웹/native/Muse의 알 수 없는 양을0토큰 또는 비용0으로 표시하지 않는다. |
| Codex | 보호 read 등록1개, 실제 model job/명령/쓰기/원본 반영은 모두0. 사전 읽기 승인은 사용하지 않았다. |
| 후속 단계 | 교차검토 완료·실제 read/write·실행 환류/수정·종합/요약검토·이번 주제 Wiki/후속 인용 NOT_RUN |

## 보존·남은 대조

`.env`/소유자 비밀번호/API 정책/원래 user unit/auth 보존 hash 대조와 임시 drop-in 제거가 모두true다. 기존 기록/데이터를 이전 backup으로 되돌리지 않았다. 첫 job이 없던 read binding은 revoked/managedSession lost로 보존됐고, 이를 새 준비처럼 초기화하지 않았다.

미확정 요청을 보존하기 위해 방 멤버/속도/autoTopic/toolBudget의 원래 설정 복구는 대조 완료까지 유보했다. 현재 방off/Chrome 수동 조작 잠금이며 새 호출은 없다. 소유자에게 실제 native 감시 비활성·22:28~22:34 실행의 읽기/생성/submit/오류·중단 상태 조회만 요청했다. 그 결과 전 실행 종료나 미제출을 임의로 확인 처리하지 않는다.

공개 가능한 개수·시각·판정은 [sanitized acceptance](./assets/r8-mixed-20261110/acceptance.json)에 기록한다. 이후 소유자 보고와 설정 복구 결과를 같은 이력에 추가한다.

## 원래 수락 기준과 남은 범위

[D5 보완 수락 계획](./dot-mcp-acceptance-d5-20261102.md)의 교차검토2라운드와 자유 발화/후속·실제 기기/Codex 수락은 이번 승인된1라운드 범위와 구분한다. 이번에는 그1라운드도 완료하지 못했다. 초안5개 PASS·기존 R6 별도 PASS로 원래 D5-F 전체를 승격하지 않는다.

[R8 원래 수락](./resident-acceptance.md#3-r8-수락)과50 gate는 변경하지 않는다. R8-A의 처음부터 개입 없는 업무/Wiki 전체 흐름·실기기 IME/터치·장기 운영도 별도 미완료다. 계획/호스트 범위 확대가 필요하면 원인 대조와 현재·후속 영향/변경량 보고 후 승인받는다.
