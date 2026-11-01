# 방 전체 채팅 한도 제거 — 2026-11-01

## 승인·코드 기준

사용자가 “설정한도는 api만 자체적으로 셋팅하게 하고 전체 설정한도 자체를 삭제해”라고 지시했다. [사전 영향 검토](../reviews/room-chat-limit-removal-20261101.md) 뒤 SSOT와 R2-C/D의 전체 방 예산 수락을 API 전용으로 개정하고 구현했다. 기준 main은 PR #31 병합 `a69380872d76336f12112e86319d9edb9e5d0b18`, 브랜치는 `codex/remove-room-chat-limits-20261101`이다. 검사 대상 소스는 이 문서를 포함한 PR commit/CI SHA로 식별한다.

## 결과·계약

- `api-usage.ts::dailyRoom`, `dispatch.ts::budgetReason`: 상주방 전체 누적 요청/보고 token/채팅 종료 시각 검사를 제거했다. 옛 budgetMode/RoomBudget 값은 저장 호환·과거 기록이며 채팅 제한을 재활성화하지 못한다. API 일일 원장·보고량 soft limit·unknown은 유지한다.
- `ResidentStore.migrateResident/control`: 새 방과 pacing이 없는 옛 방의 명시 on에는 기존 표준30초/idle300초/pass120초/3회 휴면을 사용한다. 별도 방 예산 설정 없이 멤버 선택 후 켤 수 있다. off·멤버·자동 주제 허용은 자동 변경하지 않고 미확정/사용 중 lease는 그대로 거절한다.
- `Room.toolBudget`, `dispatch.ts::toolBudget/toolBudgetReason`, `work-execution.ts`: 도구 횟수/종료 시각을 별도로 저장한다. 옛 budgets의 도구 값은 같은 권한으로 읽어 보존한다. 새 한도0/없음/기한 만료·늦은 승인·scope 변경이면 Codex를 실행하지 않는다. 소비한 slot은 삭제하거나 초기화하지 않는다.
- `resident-runner/resident-focus/resident-prompts`: 방의 옛 숫자·만료 시각으로 주제/분석/자유 발화를 막지 않는다. API만 대기할 수 있고 가용한 GPT는 진행한다. 전체 미확정 차단, 독립 초안/라운드 공개 장벽, context/개별 timeout·형식 보완 한도는 유지한다. 실패 이유를 잃거나 실패 요청을 재전송하지 않는다.
- `control.html/control.ts/room-view.ts`: 전체 한도·legacy 방식 선택 입력과 전체 요청 분모를 제거했다. API 일일 설정과 방 속도/도구 실행 설정을 분리했다. 2탭 CAS·기기 현지 도구 시각·KST API 자정 표시를 유지한다. `readiness.mjs`도 방 예산을 필수로 요구하지 않는다.

Providers.complete·OAuth/vault·Store transaction/command/event·실행 승인/격리·Wiki/MCP 범위를 재작성하지 않았다. 작은 순수 정책 함수와 기존 Coordinator를 재사용해 두 한도 경계의 중복을 줄였다. 새 ORM/서버/추상 엔진은 추가하지 않았다. 과거 단독 토의의 used/limits·종료 상태를 소급 수정하거나 재개하지 않았다.

## 검증

| 검사 | 방법 | 결과 |
| --- | --- | --- |
| strict TS·빌드·전체 Node | `npm run check` | PASS345, FAIL/SKIP0 |
| 실제 Chromium/MCP fixture | 기존 전체 `tests/browser/*.test.mjs`, Chromium156.0.8078.4/MCP1.12.0 | PASS54, FAIL/SKIP0 |
| Codex 설치 계약 | `WJ_CODEX_BINARY=/설치한/codex npm run test:codex-contract` | PASS0.165.0 생성 schema, 실제 thread/model turn0 |
| 사용자 파일 | 기존 untracked35파일 SHA-256 manifest | 35/35 보존 |
| GitHub | PR head의 Check workflow | PR Checks에서 별도 확인 |

기존 R2-C의 fake 전체6회 정지는 API fixture의 일일6회/보완/pass/unknown 검사로 대체했다. API 소진 뒤 API 추가 전송0과 GPT의 옛 전체 한도 초과 진행을 각각 검사한다. runtime HTTP fixture는 옛 maxRequests=1/만료 시각을 지나6개 응답을 보존한 뒤 명시 off로 멈춘다. R2-D는 off/휴면·missed tick 합치기를 유지하고 채팅 종료 시각이 차단하지 않는지 확인한다. R8의 옛 budget/deadline 차단 사례는 같은 intent가 한 번만 시작하는 양성 사례로 바꿨다. R2-C/D 외48개 gate ID·미확정/동시1/권한 조건을 낮추지 않았다.

새 도구 전용 검사는 chat 필드 없이 한도 저장·동일 slot 멱등성·N+1 차단·만료 후 dispatch 거절, 검증 실패 transaction rollback, 옛 client의 legacy payload가 채팅 제한을 복원하거나 원장을 지우지 못함을 확인한다. API fixture4곳은 새로운 정책에 따라 명시 일일 정책을 준비하며 원래 모델/usage/불확정/출력 snapshot 검증은 유지한다. SIGKILL의 준비 전 사례는 첫 새 요청1회 뒤 명시 off로 추가 요청을 막고, 준비/전송/영수증 뒤의 자동 재전송0 조건은 유지한다.

화면은 전체 한도/모드 입력0, API 기본 제안24회/보고200,000토큰·미설정 대기, 도구 전용 저장·다른 시간대 변환, 같은 방의 토론·독립 리뷰·Wiki·SSE/읽기 위치·2탭·390/768/1024/1440px·추가 실제 모델 호출0으로 검사했다. 실제 사용자 계정/Chrome 대화/기기 수락으로 세지 않는다.

## 운영 방의 즉시 차단 해소

새 코드 배포와 별개로, 사용자가 지목한 운영 방은 off·활성 토의/실행0인 것을 확인한 뒤 **이미 병합·배포된 PR #31의 기존 owner configure 명령1회**로 `legacy`에서 `api-daily`로 맞췄다. API 한도 정책은 추가/변경하지 않았다. 기존 숫자는 지우지 않고 비활성 이력으로 보존했다. 제어 명령의 expectedVersion/idempotency를 사용했으며 private validation journal에 준비/확정·전후 fingerprint를 남겼다.

전후 대조에서 방 off, API 정책·계정/토커·기존 토의/실행 metadata·옛 budgets·멤버·원장·속도·자동 주제·Chrome 수동 잠금이 같았다. 새 모델 호출0, Codex 작업0, browser 전송0, 서비스 재시작0이다. 현재 서비스의 이전 UI에는 방식 선택이 남을 수 있으나 만료된 방 한도는 API 전용 설정에서 GPT 시작을 막지 않는다. **입력 자체를 삭제한 새 UI/코드는 PR 병합·빌드·재시작 후 적용된다.** 방 on·실제 모델 응답/R8-D 전체 수락은 NOT_RUN이다.

복귀는 [운영 절차](../operations-runbook.md)의 G0에 따라 off·원래 응답/실행 대조 뒤 flag off/읽기 전용으로 수행한다. 원장·원문·toolBudget·옛 budgets·command/receipt를 지우지 않는다. 폐기한 전체 채팅 제한을 다시 운영 정책으로 강제하려면 별도 사용자 허용이 필요하다.
