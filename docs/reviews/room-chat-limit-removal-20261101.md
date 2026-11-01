# 방 전체 채팅 한도 제거 — 2026-11-01 사용자 변경 지시

사용자가 “설정한도는 api만 자체적으로 셋팅하게 하고 전체 설정한도 자체를 삭제해”라고 명시했다. 이는 PR #31의 선택형 legacy/API 모드를 폐기하고 상주방의 대화 한도를 API 일일 정책 하나로 정리하는 승인이다. 계획 변경을 다시 질문하지 않고 본 영향 보고를 먼저 기록한다. 기준은 PR #31 병합 main `a693808`이며 예상24~34파일·500~1,000줄이다. 배포·방 on·실제 모델/기존 browser 전송은 별도다.

## 관측과 원인

운영 앱을 읽기 전용으로 확인했을 때 방은 off, 활성 멤버4명, pacing 있음, 활성 토의0, API 일일 정책 미설정이다. 이전 방의 budgetMode는 legacy이고 저장된 deadline이 만료됐다. 현재 화면에도 방 누적 요청·토큰·종료 시각과 legacy 선택이 남았다. `ResidentStore.control(on)`의 `budgetReason`가 API가 아닌 GPT까지 시작하지 못하게 한다. 이전 옵션 선택 안내만으로는 이번 요구를 충족하지 못한다.

## 변경과 유지

| 접점 | 변경량·유지 계약 |
| --- | --- |
| `api-usage.ts::dailyRoom`, `dispatch.ts::budgetReason` | 모든 상주방에서 방 누적 채팅 요청/토큰/deadline을 검사하지 않음. 옛 budgetMode/budgets는 과거 저장 호환 자료로만 유지. API는 기존 KST 공통 일일 원장·예약/전송/unknown/soft token 계약 유지 |
| `ResidentStore.control/migrateResident`, `resident-model.ts` | 방 켜기 때 속도 부재만 기존 표준30초/idle300초/pass120초/3회 휴면으로 채움. 모든 새 방의 채팅 정책은 API 일일 방식. 기존 off/멤버/원문/command/receipt·과거 budgets를 삭제하거나 방을 자동으로 켜지 않음. API 미설정이어도 GPT 방 on 허용, API만 대기 |
| `Room.toolBudget` (선택 필드 제안), `dispatch.ts::toolBudget/toolBudgetReason`, `work-execution.ts` | 도구 횟수/deadline은 채팅 설정과 분리. 기존 tool 값은 옛 budgets에서 읽어 동일 권한만 보존하고, 새 UI는 도구 전용 필드만 저장. 신규 도구 권한 없음, 도구 승인/격리/단일 실행 유지 |
| `resident-runner/resident-focus/engine/work-policy` | 상주 자유 발언·방 안의 주제·분석 업무가 API 한도만 소비. 오래된 방 전체 값으로 재차 막히지 않음. 단독 legacy 토의의 과거 기록/종료 상태는 소급 수정/재개하지 않음. 검토 라운드·초안 장벽·도구 한도·응답 timeout/context/format-repair 경계 유지 |
| `control.html/control.ts/room-view.ts`, `readiness.mjs` | 방 채팅 방식 선택과 누적 요청·토큰·채팅 종료 시각 입력/분모 삭제. API 일일 설정만 별도 유지. 속도와 도구 실행 설정을 명확히 분리. 운영 준비 판정에서 방 전체 예산을 요구하지 않음 |
| SSOT·R2 수락·운영/검사 기록 | 기존50개 gate ID는 유지하되 R2-C/D의 방 전체6회/종료시각 차단은 사용자 지시에 따라 API 한도·도구 deadline으로 대체. 다른 안전 gate를 낮추지 않음 |

API 일일 정책은 소유자가 API 설정에서 저장한다. 초기 화면24회/보고200,000토큰은 유지하고 모델이 자신의 한도를 늘리거나 API 사용을 자동 시작하지 않는다. “전체 한도 삭제”를 API·도구·미확정 경계 제거로 넓히지 않는다. GPT/dot/Muse도 제공처 자체의 제한·계정/대화·수동 Chrome 잠금은 그대로다.

## R1~R8와 후속 영향

R1은 선택 toolBudget과 과거 필드의 additive 호환, off/원문/정책 저장 원자성을 검사한다. R2는 만료된 방 예산에도 GPT 시작/진행·API 미설정/소진 대기·미확정 전역 차단·default pacing을 검사한다. R3은 삭제한 입력이 다시 나타나지 않고390px·2탭에서 API/도구 설정이 분리되는지 확인한다. R4의 OAuth/browser 연결은 변경하지 않는다. R5의 분석 후보는 방 전체 한도에서 해방하고 R6의 Codex는 toolBudget을 동일 공통 함수로 재검사한다. R7의 Wiki/인용/MCP 권한은 유지한다. R8은 API 한도·도구 deadline의 유효/실패 검사와 기존 복구/순차/공개 장벽을 결합한다. Git Writer·병렬 실행·추가 OAuth·자동 병합의 범위나 순서는 바뀌지 않는다.

## 수락·복귀

1. 만료/소진된 옛 방 budgets 또는 budgets=null로도 명시 on 성공. API 정책/멤버/권한 자동 추가0, 기존 원문/receipt/unknown 변경0.
2. GPT/모의는 옛 방 요청·토큰/시간 값을 초과해 진행, API는 지정된 일일N회 뒤 N+1 전송0. API 미설정이어도 방 시작 가능하며 API만 대기. 전체 미확정이면 새 전송0.
3. 도구 한도0/없음/기한 만료→실행0. 새 toolBudget 변경과 과거 fallback 모두 같은 승인/deadline 재검사. 대화가 이어져도 도구 한도는 초기화하지 않음.
4. 방 설정 DOM에 전체 요청/토큰/모드/채팅 종료시각 입력0, 별도 API 일일·속도·도구 설정을390/1440px에서 확인. UI 진입/설정만으로 실제 호출0.
5. strict TS·관련/전체 Node와 Chromium/MCP 회귀, 원래 사용자35파일 SHA-256·단일 dispatch/복구/초안 장벽 유지. 실제 계정 수락은 NOT_RUN.

복귀는 G0의 off·진행/미확정 대조 뒤 이전 reader/flag off로 수행하며 원장·옛 budgets·toolBudget·명령·원문을 보존한다. 이전 한도 정책을 운영에 다시 강제하려면 이번 사용자 지시와 반대되는 정책 변경이므로 별도 허용이 필요하다. 과거 DB를 덮어쓰거나 API/도구 사용량을 초기화하지 않는다.

## 구현 결과

[최종 구현·검증·운영 차단 해소](../implementation/room-chat-limit-removal-20261101.md)에 결과를 구분했다. 꺼진 운영 방의 mode 설정만 기존 명령으로 맞춰 즉시 차단을 해소했으며 새 API 정책·방 on·모델/도구/browser 전송이나 새 코드 배포는 하지 않았다.
