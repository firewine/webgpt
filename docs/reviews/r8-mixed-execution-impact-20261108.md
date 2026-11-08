# R8 혼합 실계정 검증 — 실행 범위 보완 검토안

상태: **2026-11-08 사용자 승인 — 보완 개발·임시 설정·해당 실검증.** 아래는 승인 시의 영향·변경량이며 실제 구현/검사·실계정 결과와 구분한다. 승인 전에는 제품 코드·SSOT·호스트 설정을 변경하지 않았다.

기준: main `084d5587d1b101f772369f837d857d374fef8a2b` (PR #61 병합). 운영 소스는 이전 `f911c593466cdfffbc159c92d83586e08d05257a`와 동일하다. 이 문서는 사용자의 “R8 전체 혼합 토론 실계정 검증, 계획이나 호스트 설정 변경 시 영향·변경량부터 보고” 요청에 따른 영향 검토다.

## 1. 필요한 보완과 보존할 계약

기존 `scripts/live-acceptance-guard.mjs:acceptanceGuard`는 모든 Codex dispatch를 `acceptance_codex_not_authorized`로 차단한다. `scripts/live-acceptance-server.mjs`도 작업 경로가 하나라도 있으면 `acceptance_requires_no_codex_roots`로 종료한다. 이 검증기는 앞선 모델 토론 검증용이며 현재 상태로 R8-D의 실제 Codex 환류를 검증할 수 없다.

원래 `docs/implementation/resident-acceptance.md`의 R8-D는 서로 다른 GPT 2계정·DeepSeek·실제 dot·Muse와 사용자 Codex thread/쓰기를 포함한다. 앞선 R6-F 읽기/쓰기/원본 반영 PASS는 별도 저장소의 수락 기록이다. 이를 새 혼합 토론의 실행·참여자 재검토 증거로 대신하지 않는다.

제안은 **기존 검증기의 기본 Codex 차단을 유지하고, 승인된 한 실행에만 명시 정책을 추가**하는 것이다. 제품의 provider, Store transaction, 토의 엔진, 실행 권한·보호 사본·명령 확인·원본 반영 계약은 재사용한다. 새로운 OAuth·DB schema·모델 연결·호스트 AppArmor 정책을 추가하지 않는다.

## 2. 실행 범위

| 항목 | 제안 범위 |
|---|---|
| 실제 참여자 | 서로 다른 계정의 ChatGPT 웹 2개, CoralBricks DeepSeek High 1개, 기존 native dot, 기존 Muse 대화 |
| 일반 GPT | OAuth/Responses·Codex 기기 코드로 대체하지 않는다. 웹 모델·사고 깊이는 실제 화면에서 확인한다. |
| 두 번째 계정 | 사용자가 선택한 dot 계정으로 별도 격리 Chrome 창에서 일반 웹 ChatGPT에 로그인한다. native dot 연결과 구분한다. |
| 토론 | 새 주제 1개, 교차검토 1라운드, 수정·종합·동료 수락·같은 방 복귀·후속 인용 |
| Codex | 새 검증 저장소·작업 브랜치·실제 thread 1개, 읽기 1job → 별도 명령 승인 후 보호 사본 쓰기 1job, 최대 2job |
| 원본 변경 | 실제 diff를 보고 소유자가 확인한 기존 텍스트 파일 1개·반영 1회 |
| 시간 | 첫 새 dispatch 예약부터 최대 30분. 마지막 5분은 새 예약을 막고 진행 중 요청을 대조한다. 각 turn의 300초 제한 유지. |
| 모델 요청 | 최대 30회 예약. 실패·미전송도 차감하며 자동 재시도하지 않는다. 두 번째 웹 대화 준비에 필요한 최초 메시지도 포함한다. |
| API | DeepSeek 최대 6회이면서 당일 남은 한도 이내. 기존 일일 8회·보고된 200,000토큰 정책은 변경하지 않는다. High 유지. |
| 제외 | 다른 작업 경로·일반 소스 수정·Git 자동 commit/push/merge·여러 파일 반영·새 인증 방식 |

성공 경로는 5인 초안/교차검토/수정/종합/종합 검토 20회, 두 실행 결과 평가 2회, native dot 상주 발언·방 복귀 후속 2회, 후속 독립 분석/Wiki 인용 1회로 **25회 + Codex 2job**이다. 새 웹 대화 준비 1회를 포함하면 26회이며 나머지는 동일 한도 안의 여유다. 실제 원문 길이·진행 속도에 따라 30분 안에 완료되지 않을 수 있으며 이때 부분 결과로 기록한다.

API 토큰은 provider가 보고한 실제 사용량으로 정산하는 기존 한도다. 마지막 진행 중 응답의 보고량 때문에 한 번 초과할 수 있다. Codex 2job·각 300초는 실행 범위이며 Codex 내부 토큰 수의 보장은 아니다. 알 수 없는 사용량/비용을 만들지 않는다.

## 3. 고정할 검증 작업

경로: `/home/firewine/.local/share/webjjoku-r8-validation/20261108/repo`, 브랜치 `r8-validation`. 이미 준비한 `validation.txt`와 초기 commit은 보존한다. 승인 후 공개 합성 파일 `allowance.mjs`, `check-boundary.mjs`를 추가해 해시·명령·branch/HEAD를 동결한다. 개인 자료·실제 인증 파일은 입력에 넣지 않는다.

주제는 요청 수 경계의 결함을 확인하고 한 파일 수정의 근거·남은 한계를 비교하는 작은 검증이다. `allowance.mjs`의 `return used <= cap;`가 결함이며, `7/8 → 허용`, `8/8 → 거절`, `9/8 → 거절`을 검사한다.

1. 읽기 전용 job은 `node check-boundary.mjs`를 실행해 예상된 경계 실패·실제 exit/output을 회수한다. 원본/사본 변경 0을 대조한다.
2. 같은 binding/thread에서 새 명시 권한 세대로 전환하고 보호 사본의 해당 비교식만 `<`로 바꾼 뒤 같은 검사를 실행한다. 실제 쓰기 명령은 준비된 문자열·위치·범위를 보여주고 1회 확인받는다.
3. 원본은 그대로 둔 채 실제 1파일 diff를 제시한다. 소유자가 diff digest를 확인한 뒤 기존 apply 경로로 반영한다.
4. 실행 제안자 이외의 참여자가 원본 반영 영수증·실제 검사·diff를 독립 검토한다. 다섯 참여자 모두에게 같은 실행 근거가 제공된 뒤 종합한다.

첫 읽기의 의도된 검사 실패와 실행기 자체 실패를 구분한다. 두 job의 실패·미확정도 슬롯을 소비하며 새 thread·새 job으로 자동 반복하지 않는다. 명령별 확인과 실제 diff 반영 확인은 R6의 기존 소유자 경계를 유지한다.

## 4. 변경 대상과 예상량

| 대상 | 유지/변경 |
|---|---|
| `scripts/live-acceptance-guard.mjs:acceptanceGuard` | 예약 제한·기존 hook 합성 유지. 명시 실행 정책이 있을 때만 좁은 Codex guard를 결합하고 종료 시 실행/job/apply까지 대조한다. |
| `scripts/live-acceptance-server.mjs` | 기존 Workspace/HTTP/SSE 시작 유지. 정책이 없으면 기존 no-roots 거절, 있으면 단일 canonical root와 설정을 대조한다. |
| `scripts/live-acceptance-codex.mjs` **제안** | 한 room/topic/revision·binding/thread·read/write 권한 세대·2job·확정 명령·1파일 apply를 확인하는 작은 실행 정책 모듈. |
| `tests/live-acceptance-guard.test.mjs`, `tests/live-acceptance-server.test.mjs` | 기존 기본 거절·예산·복구 검사 유지 및 opt-in 결합 회귀. |
| `tests/live-acceptance-codex.test.mjs` **제안** | scope 위조·세 번째 job·권한 전환·명령/apply 경계·deadline·재시작을 모의 요청으로 검증한다. |
| 계획/실행 문서 | 승인 후 기존 SSOT에 이 수락 보완만 연결하고 실제 결과를 별도 기록한다. 원래 gate를 완화하지 않는다. |

예상 **8~10개 tracked 파일·650~1,050줄**. 공개 합성 fixture 2개와 private 실행 정책/운영 스크립트는 별도 준비물이다. 현재 검토상 `src/` 변경은 필요하지 않다. 기존 접점으로 계약을 보존할 수 없다면 구현 전에 추가 영향과 변경량을 보고한다.

## 5. 최소 호스트 변경과 복구

승인 시 검증 시간에만 `webjjoku` user service의 전용 임시 drop-in **1개**로 검증 entry point와 단일 허용 경로를 전달한다. 같은 DB/4090을 한 프로세스만 열며 정상 서비스와 동시에 시작하지 않는다. `.env`, 원래 service, NoNewPrivileges/UMask, 기존 전용 bwrap/AppArmor, Tailscale/포트는 변경하지 않는다. 기존 native dot 터널은 같은 plugin/tunnel/key를 재사용해 한 감시만 연결한다.

검증 전 drop-in 충돌/원본 설정을 확인하고 이번에 만든 파일만 생성·제거한다. 정리 시 신규 예약을 먼저 차단하고 진행 중 turn/job/apply의 원래 ID를 대조한다. 미확정은 기록한 채 멈추며 자동 재실행·권한 해제로 우회하지 않는다. 안전하게 중단한 뒤 dot 권한/감시를 정리하고 Muse 수동 잠금·기존 방 설정을 복구한다. 전용 drop-in을 제거하고 정상 service를 다시 시작해 health·기록·권한을 확인한다. DB를 과거 backup으로 덮어쓰지 않는다.

## 6. 수락·후속 영향

| 수락 | 확인 방법 |
|---|---|
| 기본 거절 유지 | opt-in 누락/잘못된 정책의 Codex dispatch·작업 경로 허용 0을 Node 검사로 확인 |
| 좁은 실행 권한 | 다른 root/thread/topic·세 번째 job·이전 권한·확인되지 않은 명령/반영 거절을 Node 검사로 확인 |
| 시간/복구 | 진행 중 Codex/반영을 active로 계산, deadline/restart에서 한도 재충전·자동 재전송 0, 종료 중 잠깐의 허용 hook 복구 0을 검사 |
| 실제 혼합 | 두 웹 계정 identity 구분, 5명 각 초안/검토/수정, native dot receipt·Muse 원래 thread 유지, 실제 command/exit/capture와 원본 반영/독립 검토를 private 로그·owner 화면과 대조 |
| 실행 후 | 같은 방 복귀·후속 Wiki version/digest 인용, 사용량 실제 보고, 정상 service health·기존 DB/설정 보존을 확인 |

R6-F의 별도 PASS는 유지한다. 이번 검증은 새 **R8-D/D5-F 혼합 토론과 Codex 환류**를 채우는 범위이며, R8-A의 처음부터 개입 없는 전체 업무/Wiki 루프, 실제 기기 IME/터치·장기 운영을 완료로 바꾸지 않는다. 다른 R1~R7 계약이나 후속 선택 기능의 순서는 변경하지 않는다.

큰 리스크는 ① 5인 장문·페이지 조회/사람 확인이 30분을 넘길 수 있음 ② 웹 DOM·실제 모델 결과가 계획대로 나오지 않을 수 있음 ③ 종료 때 진행 중 실행/반영을 놓치면 미확정이 생김이다. 각각 고정 한도 내 부분 결과 기록, 전송 전 재확인과 자동 재전송 금지, 원래 ID/영수증 대조 및 안전한 drain으로 대응한다. 실제 실행 전 결과는 **NOT_RUN**이다.

사용자가 좁은 검증기 보완 개발과 임시 service 설정 1개, 최대 30회·API 6회·Codex 2job·30분의 실제 수락 범위를 승인했다. 명령과 원본 diff의 소유자 확인은 실행 시 별도로 유지한다. 추가 범위의 미결정 항목은 없으며 새로운 변경이 필요하면 다시 영향을 보고한다.
