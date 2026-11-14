# dot 종료 미확인 복구·교차검토1회 제한 — 2026-11-14

상태: **승인된 보완 구현·자동 검사 PASS / 새 보완의 운영 적용·실계정 재호출 NOT_RUN.** 기준은 문서 PR #67 병합본 `d822f69`(제품 코드 PR #66과 동일)다. 기존 답변5개와 원래 교차검토는 운영에서 변경하지 않는다. [영향안·승인 범위](../reviews/dot-unverified-stop-recovery-impact-20261114.md), [선행 PR #66 배포](./dot-cross-review-traced-live-20261114.md)를 구분한다.

## 계약

`DiscussionEngine.control`의 별도 `retry_after_authority_revoked`는 `acceptUnverifiedExecution:true`, `monitorDisabled:true`와1~1,000자 근거 메모를 받는다. `assertDotRetryAfterAuthorityRevoked`가 기존 공통 과제/세대/identity/입력·Wiki·단일 슬롯·답변 부재 검사를 재사용하고 옛 grant의 명시 revoke·활성 구독 없음을 추가로 검사한다. 실패하면 같은 Store transaction이 변경/이벤트 없이 롤백된다.

준비 audit에는 원래 오류·소유자 동의·감시 비활성 확인과 `externalExecution:unverified`, `submissionHistory:unverified`를 기록한다. `stoppedWithoutSubmit`/`submitAttempted` 참·거짓을 만들어 넣지 않는다. 원래 turn의 입력/claim/본문/usage/수신 기록과 기존 로컬 timeout 시각을 보존한다. 과거 요청은 앱에서 정산되며 이것은 원격 실행 종료 증명이 아니다. 같은 task만 pending이고 토의는 blocked/paused다. 실제 새 요청은 현재 권한과 별도 resume가 있어야 한다.

옛 grant로는 인증이 거절되고 새 grant로 옛 requestId를 조회/제출할 수 없으며 옛 attempt로 새 입력을 읽을 수도 없다. 다만 원격 실행자별 인증 분리는 아니므로 옛 실행이 새 bridge에 새 `get({})`을 호출할 가능성까지 차단했다고 주장하지 않는다.

## 화면과 1회 검증기

`src/web/control.ts::renderRecords`에서 native dot의 별도 복구 경로에 미선택 확인2개와 근거 메모를 표시한다. 원격 종료/제출 미확인, 감시 off와 종료의 차이, 옛 실행자가 갱신된 전달기를 사용할 잔여 위험을 안내한다. 준비 후에도 ‘원격 종료·제출 이력 미확인’ 카드와 원래 로컬 처리 시각 설명이 남으며 일반 이어가기를 자동 실행하지 않는다.

`scripts/live-acceptance-dot-once.mjs::dotOnceGuard`는 기존 `acceptanceGuard`를 감싼 선택형 운영 검사다. 방·토의·revision·과제·라운드·dot identity·양쪽 context generation·입력 digest를 고정하고 최초 예약 기준을 기존 command journal에 저장한다. 재시작해도 실패/미전송을 포함해 예약1회가 소비된다. baseline 변경은 idempotency 충돌이며 새 quota·DB schema는 없다. 준비는 방off에서만 수행하고 별도 재개 전에 검사기를 설치한다. 다른 topic/resident/work·다른 provider·format retry·Codex 등록/제출은 실행 전에 거절한다.

`scripts/live-acceptance-server.mjs`는 `dotOnce`가 있을 때만 위 검사를 선택하며 실제 실행 설정300,000ms와 실행 경로 없음 조건을 검사한다. 입력/권한을 넘기는 기존 provider/dispatch 계약은 유지한다. 실제 `turn.finished`의 파싱·저장·정산 뒤 동기적으로 방off/토의pause하고 다음 발언을 막는다. `dot.reply_received`/receipt 시점에는 중단하지 않는다. 앱 종료가 끝날 때까지 검사기를 유지한다. **일반 제품의 resume는1회 제한 기능이 아니다.**

## 검사 결과

Node24.18.0/npm11.16.0, 실제 Chromium156.0.8078.4로 수행했다. 모든 모델/계정 응답은 합성 fixture이며 운영 요청으로 합산하지 않는다.

| 검증 방법 | 결과·확인 범위 |
|---|---|
| `npm run check` | 최종 **901 PASS / 6 SKIP / 0 FAIL**, strict TypeScript·빌드 포함. SKIP을 통과로 표시하지 않는다. |
| `npm run test:browser` + 설치된 Chromium·Chrome MCP 실행 경로 | **118 PASS / 0 SKIP / 0 FAIL**. 신규 blocked/paused 화면 각각 확인 누락·메모 범위·취소 후 기본값·정상 준비·새로고침을 검사. |
| `tests/dot-unverified-retry.test.mjs` | 20회 같은 준비 명령은 audit1개·새 호출0. 완료5개·원래 입력/claim/receipt·기존 종료시각/사용량 보존. 별도 재개에서 새 request/attempt·동일 입력, 옛 grant/request/attempt의 조회·제출 거절. 확인·권한·세대·입력·수신 기록·슬롯 경합 거절 시 state/event 변경0. |
| `tests/dot-mcp-restart.test.mjs` | 실제 SIGKILL을 준비 commit 직후 및 새 입력 첫 페이지 직후 발생시켜 두 시도·미확인 audit·완료5개를 보존하고 자동 재전송0 확인. 기존 복구 분기 검사도 유지. |
| `tests/live-acceptance-dot-once.test.mjs` | **12 PASS**. 실제 fixture 토의로 저장 후 중단·다른 provider 미호출, 범위/입력/Codex 사전 거절, 정상/형식 오류/전송 오류/중단/입력 변경 후 재시작의 예약1회 보존. 실행300초 설정 변경은 상태 생성 전 거절. 기존 대기 Codex 업무는 startup 이전에, 출처 검증·도구 예약은 효과 발생 전에 차단. |

전체 Node의 건너뛴 검사는 기존 실행 보호 검사다. `WJ_TEST_OUTER_BWRAP` 미지정5건과 일반 host namespace 검사 불가1건을 구분하며, 이 보완의 신규 검사는 모두 수행했다. 기존 Codex 실행기 계약이나 호스트 정책을 변경하지 않았다. 최종 검토에서 대기 Codex 작업의 시작 전 차단과 turn보다 앞선 출처 조회 차단을 보강해 전체 Node 검사를 재실행했다. 브라우저118개 통과 이후 UI/제품 TypeScript 변경은 없다.

## 운영 수락·롤백

private 준비·복구 파일과 진단 설정은 개발 자료로만 준비하며 실제 `plan/arm/start/restore` 실행은 **NOT_RUN**이다. 기존 제품300초·일일 API 정책·페이지 원문/범위·MCP 입력과 SQL schema를 변경하지 않는다. 이번 개발에서 원래 운영 요청을 대조 종료하거나 새 grant·감시·모델 예약을 만들지 않았다. 개발 후 읽기 전용 대조에서도 완료5개의 prompt/본문/reply/receipt digest, 원래 unconfirmed 요청, 방off/Chrome 잠금, `.env`/원본 unit/비밀번호/API 정책의 동일성을 확인했다.

병합 후 별도 승인된 실제1회에서만 페이지 응답 수·시각·submit 도착/오류 진단과 실제 reply/receipt를 대조한다. 전체 입력/중간 분석을 한 출력으로 모으지 않으며, 절단·오류 때는 추가 요청 없이 중단한다. 과거 절단의 세부 원인은 원격 reported/UNVERIFIED로 남는다. 이 보완의 자동 검사 통과가 원래 R8 전체 혼합 토론 완료를 뜻하지 않는다.

롤백은 방off·토의blocked/paused에서 새 기능 사용 중지와 이전 빌드 복구다. 이미 남긴 미확인 audit·후속 답변은 DB 백업으로 되돌리지 않는다. 임시 검증 실행 때에는 자기 소유 설정·권한·전달기를 정리하고 원본 unit/계정/대화/Chrome 자료를 보존한다.
