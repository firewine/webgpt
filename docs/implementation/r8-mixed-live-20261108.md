# R8 혼합 실계정 검증 — 2026-11-08

상태: **검증기 보완/합성 검사 PASS, 실제 혼합 토론 NOT_RUN.** [승인 범위·변경량·복구](../reviews/r8-mixed-execution-impact-20261108.md)를 따르며, 기준 main은 PR #61 병합 `084d5587d1b101f772369f837d857d374fef8a2b`다. 원래 R8 gate를 완화하지 않는다.

## 운영 상태와 선행 준비

- 운영 source는 앞선 R6-F 수락의 `f911c59`와 동일하다. 운영 작업 브랜치를 문서 병합본까지 fast-forward했고 제품 소스 차이가 없어 재빌드/재시작하지 않았다.
- 정상 `webjjoku`/desktop service·4090/기존 HTTPS·운영 DB/소유자 비밀번호/자격 증명·과거 토론은 보존했다. 새 작업은 별도 worktree에서 진행한다.
- 기존 Muse 원래 thread·계정·입력창을 읽기 전용으로 대조하고, 기존 discovery/confirm API로 바뀐 Chrome page 포인터만 갱신했다. Muse 메시지 전송은 0이다.
- 기존 Business 웹 GPT를 보존하고 별도 격리 Chrome 창에서 두 번째 일반 웹 GPT의 직접 로그인을 완료했다. 사이트의 계정 식별 정보를 대조해 서로 다른 2계정임을 확인했고 두 입력창은 비어 있다. 사용자가 선택한 dot 계정을 일반 웹 GPT에도 쓰되 native dot 역할과 구분한다. 기존 Business 대화의 discovery도 ready/입력 없음/응답 중 아님을 확인했다. 실제 모델 요청은 아직 0이다.
- native dot은 기존 plugin/tunnel/key를 재사용한다. 앞선 권한이 만료됐으며 실제 실행 직전에 새 권한과 감시 1개를 연결해야 한다. 다른 dot으로 대체하거나 assistant가 직접 claim/submit하지 않는다.
- 실제 API 당일 사용은 선행 확인 시 0회/0토큰, 기존 일일 정책은 8회·보고된 200,000토큰이다. 한도 확대를 수행하지 않았다.

private 사전 상태·온라인 DB backup·브라우저 관측은 운영 state 디렉터리에 보관한다. 공개 저장소에는 개인 대화 원문·계정 identity·비밀번호/키·사용자 thread URL을 넣지 않는다.

## 구현 경계

검증기 기본 Codex 금지는 유지한다. 명시 정책에서만 단일 canonical repo·branch/HEAD를 허용하고, 실제 생성된 binding/thread를 기존 Store command journal에 한 번 고정한다. 등록 intent 이후 중단되면 새 thread를 만들지 않는다. 정책 전체를 journal 입력에 묶어 같은 run을 재시작하며 요청/시간/작업 한도를 새로 채우지 못하게 한다.

첫 읽기의 Core 검증 완료 시 원래 authority/manifest/capture와 execution evidence digest를 역사적 관측으로 보존한다. 읽기 결과의 참여자 평가가 끝난 같은 commit의 동기 listener에서 토론을 일시정지해, 쓰기 전환 전에 두 번째 작업이 읽기 권한으로 먼저 적재되는 것을 막는다. 새 명시 권한은 같은 binding/thread의 epoch2로만 발급한다. 과거 job의 authority를 새 권한으로 고치지 않는다.

Codex submit/dispatch·명령 확인·원본 반영은 기존 경로를 사용한다. 실제 한 파일의 내용이 쓰이는 최종 동기 callback에도 검증 기한을 검사한다. 종료 때 신규 예약을 먼저 막고 같은 job 취소 요청의 완료를 기다리며, Workspace가 닫히기 전에는 보호 hook을 제거하지 않는다. 실제 작업의 재전송/자동 재시도는 추가하지 않는다.

## 합성 검사와 결과

| 검사 | 관측 |
|---|---|
| `npm run check` 및 최종 `node --test tests/*.test.mjs` | strict TypeScript/빌드 PASS. 선행 Node 834 PASS/실패0/SKIP6, 최종 모듈/검사 포함 Node **847 PASS/실패0/SKIP6**. 같은 제품 source이며 최종 script 변경 후 전체 Node를 다시 확인했다. |
| `node --test tests/live-acceptance-{codex,guard,server}.test.mjs` | PASS29/실패0/SKIP0. 기본 Codex 거절·40/8 상한·시간/drain·실제 인증 HTTP409·잘못된 root/쓰기 선등록 거절·기동 실패·종료까지 hook 유지·웹 대화 준비 요청 차감·등록/정책 봉인·재시작2job 상한·동기 pause·기한 직전 최종 쓰기 차단. |
| `WJ_TEST_OUTER_BWRAP=/usr/local/libexec/webjjoku/bwrap node --test tests/execution-isolation.test.mjs tests/native-approval.test.mjs` | PASS16/실패0/SKIP0. 실제 CLI·외부 실행기·named profile·명령 승인·보호 사본/반영, 가짜 모델 응답/가짜 auth. 실계정 추론 증거가 아니다. |
| 실제 5인 혼합 토의·Codex2job·원본 반영/독립 검토 | NOT_RUN |

private 로그: `webjjoku-r8-check-20261108.log`, `webjjoku-r8-native-20261108.log`. 합성 검사의 성공을 실제 계정·원래 thread·혼합 토론 완료로 세지 않는다.

## 실제 실행에서 남은 조건

웹 GPT 2계정의 서로 다른 identity는 확인됐다. 두 번째의 새 검증 대화/연결·실제 웹 사고 설정과 native dot 감시 준비는 남아 있다. 모든 연결이 준비된 뒤에만 임시 service 설정1개를 적용하고 검증 시계를 시작한다. 새 대화 준비에 모델 메시지가 필요하면 승인한 요청/시간 안에 포함하며 기존 방을 자동으로 켜지 않는다.

실제 읽기 명령·쓰기 명령·실제 원본 diff는 준비된 내용과 정확히 맞을 때 각각 소유자의 확인을 받는다. 최대30회 예약/API6회/2job/30분의 범위와 기존 API 잔여 중 작은 한도를 적용한다. 기한/오류/미확정 시 원래 ID·capture/receipt를 보존하고 중단한다.

이 검증의 성공은 R8-D/D5-F의 새 혼합 토론·Codex 환류에 대한 증거다. R6-F의 별도 PASS는 유지하며 R8-A의 처음부터 개입 없는 업무/Wiki 전체 흐름, 실제 기기·장기 운영은 별도 수락으로 남긴다.
