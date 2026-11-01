# API 일일 한도와 일반 GPT/dot 선택 — 2026-11-01

## 범위·기준

사용자의 **“변경안대로 개발 승인”**을 근거로 [사전 영향 검토서](../reviews/api-daily-budget-impact-20261031.md)의 R8 보완을 구현했다. 기준 main은 PR #30 병합 `1b6c005e0b1b02162c3f294535219cd2757adeb9`, 작업 브랜치는 `codex/api-daily-gpt-choice-20261101`이다. 실제 소스 commit은 이 기록을 포함한 PR head/CI SHA로 식별한다. 후속 페이즈 신설·원래50개 수락 gate 변경·백엔드 재작성은 없다.

환경은 Ubuntu 사용자 작업 공간, Node24.18.0/npm11.16.0, Chromium156.0.8078.4, Chrome DevTools MCP1.12.0, Codex CLI0.165.0이다. 모든 신규 모델 응답/계정/대화 페이지는 임시 DB와 합성 fixture다. 실제 계정의 한도·모델 성공이나 실제 dot/Muse 왕복 증거로 세지 않는다.

## 구현한 동작과 계약

| 범위 | 코드 근거·동작 |
| --- | --- |
| 일일 원장 | `api-usage.ts::ensureApiUsage/reserveApiUsage/claimApiUsage/settleApiUsage`, `model.ts::ApiUsageState/ApiUsageEntry`. API kind만 immutable participant snapshot으로 분류. 기존 Store transaction에 합산 예약·실제 dispatch claim·원래 날짜의 늦은 usage 정산을 결합. DB/Providers.complete 계약 유지 |
| 자정·unknown | `apiDay/nextApiDay/apiUsageSummary`. Asia/Seoul 전송 날짜별 기록을 유지. 미전송은 예약만 반환하고 전송 미확정은 횟수·unknown을 보존. GPT/browser/모의는 API에 집계하지 않음. 마지막 응답의 보고 token 초과는 숨기지 않음 |
| 명시 전환 | `resident-store.ts::control`, `resident-model.ts::Room.budgetMode`. 기존 방/단독 토의는 legacy 유지. off·진행/미확정 대조 후 소유자가 `api-daily`를 저장한 방만 GPT/browser의 채팅 누적 한도·종료 시각 제외. epoch 변경으로 옛 intent 차단. 속도·pass·context/응답 크기·개별 timeout 유지 |
| 정책 API | `runtime.ts::configureApiDaily`, `http/workspace.ts`의 `/api/api-daily`. owner/Origin·command idempotency·정책 CAS 사용. API 진행/미확정일 때 변경 거절. snapshot은 집계 metadata만 반환하며 ledger 계정/원문을 내보내지 않음. 기존 capability/MCP 권한 확대 없음 |
| 후보·상주 | `resident-runner.ts::arm/evaluate`, `resident-status.ts`, `resident-prompts.ts`. API 미설정/소진·수동 browser 잠금은 해당 후보만 대기. 나머지 GPT 발언 진행. 모두 API 대기이면 새 전송/빠른 polling 없이 정책 저장 또는 다음 KST 자정을 기다림. 실제 전송 미확정은 기존 전역 차단 유지 |
| 주제 | `engine.ts::create/loop/turn/advance`, `resident-focus.ts::capture/pump`. 방의 모드를 child snapshot으로 고정. 독립 초안·같은 라운드 장벽·단일 root 유지. 혼합 주제에서 API 한도 도달 시 pending을 미실행으로 보존한 partial, 기존 경로로 같은 방 복귀. API 제외/다른 계정 재전송/가짜 완료 없음 |
| 업무·도구 | `work-queue.ts::prepareTurn/claimState`, `work-policy.ts::taskWorker`, `work-execution.ts`, `dispatch.ts::toolBudgetReason`. API 대기 시 미전송 claim만 반환, 다른 허용 작업자가 새 attempt로 수행. 한도까지 온 실제 보고는 폐기하지 않고 독립 검토. Codex 도구 횟수/유효 deadline·승인·격리는 유지 |
| UI | `control.html/control.ts/room-view.ts`. 방 한도 방식·소유자 API 일일 설정·KST 사용량/unknown/대기 이유 표시. 일일 방식 주제 폼은 적용하지 않는 채팅 요청/시간 입력을 감추고 기존 도구 한도를 구분. 정책 폼은 SSE로 입력/CAS 기준을 덮어쓰지 않음 |
| GPT/dot | `Workspace.confirmBrowser/participant`, `control.ts::connectionMode/updateConnections`. 기본 일반 GPT. dot은 기존 읽기 전용 탐지·페이지/프로필/계정/대화 재확인 후 owner가 직접 dot임을 확인한 ChatGPT thread만 표시. server-owned discovery 표식을 수동 binding에 복사할 수 없음. 이름만 dot인 Muse/일반 페이지 오분류 없음 |
| identity | 대화 방식 편집 전환 시 새 participant 폼으로 바꾸고 역할 입력을 비움. 기존 상주 이력/업무·browser 종류 변경을 기존 ID에 덮어쓰지 않음. 기존 일반 GPT 설정 API의 토의별 immutable member snapshot 계약 유지. grant·seat·Codex 권한 자동 복사 없음 |
| 준비 진단 | `scripts/readiness.mjs`. 일일 모드의 명시 pacing/멤버 설정을 구분하고 legacy 예산 조건 유지. 실제 계정/도구 성공을 승격하지 않음 |

승인된 예상26~36파일 안에서29파일을 변경했다. 작은 정책 모듈을 공통 dispatch에 결합하고 기존 provider·인증·DB·엔진·탐지·UI를 재사용했다. 과거12요청 PARTIAL의 receipt·Max snapshot·unknown 실패 usage를 재작성하거나 이어 실행하지 않았다.

## 검사 결과

| 검사 | 방법·증거 | 결과 |
| --- | --- | --- |
| strict TS/빌드·전체 Node | `npm run check`, 같은 빌드의 `node --test tests/*.test.mjs` | PASS343, FAIL/SKIP0 |
| 새 정책·회귀 | `node --test tests/api-usage.test.mjs` | PASS15, FAIL/SKIP0 |
| 실제 Chromium·MCP fixture | 아래 명령, 1440/390px 신규 UI·기존390/768/1024/1440px 회귀 | PASS54, FAIL/SKIP0 |
| Codex 설치 계약 | `WJ_CODEX_BINARY=/실제/경로/codex npm run test:codex-contract` | PASS0.165.0 생성 schema. 로그인/thread/model turn 시작0 |
| 운영 health·재시작 여부 | `systemctl --user show webjjoku`, `GET /health` 읽기 전용 | PASS · 기존 PID/시작 시각 유지, health ok |
| 보호 파일 | 기존35개 사용자 untracked 파일의 SHA-256 manifest 대조 | PASS35/35, 사용자 파일 변경0 |
| GitHub CI | PR head의 Check workflow | PR Checks에서 별도 확인 (로컬 PASS와 구분) |

```bash
WJ_TEST_CHROMIUM_EXECUTABLE=/설치한/Chromium/chrome \
WJ_TEST_CHROME_MCP=/설치한/chrome-devtools-mcp \
node --test tests/browser/*.test.mjs
```

신규15개 Node 검사는 KST 자정 예약/전송 경계·늦은 정산·unknown/실제 미전송·중복 request·immutable 이관·잘못된 schema·정책 CAS/인증/Origin/scoped MCP 거절, API 소진/미설정·browser 잠금 중 GPT 진행, 자동 스케줄러 polling0/정책 재개, 다음 날짜의 새 요청, 미확정의 전체 차단·recovery·수동 대조 후 재전송0, 혼합 partial/같은 방 복귀·미완료 라운드 비공개, GPT 주제의 옛 채팅 한도 초과 진행, API 한도 직전 업무 보고/비API 독립 검토와 미전송 claim 반환을 검사했다. 원래 안전 검사를 삭제하거나 legacy 기대 결과를 완화하지 않았다.

신규 Chromium2개는 수동 저장 전 API 정책 미설정/방 off, 두 탭 CAS 중 내 입력 보존, KST와 다른 기기 시간대의 자정 표시, 일일/legacy 주제 폼, 일반 GPT 기본·dot 명시 선택·Muse/일반 ChatGPT 분리·새 actor/권한 미복사·390px 가로 넘침0·provider 호출0을 검사한다. 기존 DeepSeek/Anthropic UI 검사는 새 ‘API·Muse·기타’ 선택을 명시하는 준비 단계만 추가하고 원래 모델/깊이/출력/삭제 검증은 유지했다.

## 운영 미적용·남은 검증

| 항목 | 상태 |
| --- | --- |
| 새 운영 정책 저장·방 on·서비스 재시작/배포 | NOT_RUN — 이번 개발 승인에 포함되지 않음 |
| 실제 GPT/API 상주 발언·유료 모델 호출·과거 partial 재개 | NOT_RUN |
| 실제 dot/Muse 대화 확인/전송·Chrome 수동 잠금 해제 | NOT_RUN — 사용자가 실제 기존 dot 대화를 선택·확인해야 함 |
| 실제 Codex thread/명령·실계정 R8-D 전체 | NOT_RUN |

설정·복귀는 [운영 절차](../operations-runbook.md#api-일일-한도일반-gptdot-선택-2026-11-01-승인-보완)를 따른다. 방 off·진행/미확정 대조 후 legacy 방식과 유효한 한도/미래 종료 시각을 저장하면 대화 정책을 되돌릴 수 있다. API 원장·원문·command/receipt는 남는다. 이전 바이너리로의 무심한 다운그레이드/DB 덮어쓰기로 새 정책을 우회하지 않는다.
