# 추천3 — 권한 수명·보호 사본·실행 원문과 명시 반영

상태: **2026-11-07 권장안 승인, 기능 구현·자동 검사 완료 / 결합 OS 검증 보류. 실제 사용자 Codex 실행/운영 배포 NOT_RUN.** 착수 기준은 PR #55 병합 main `f3384cc8d98f5f71c81bd94fdddba37ee40b83dc`, 작업 브랜치 `codex/protected-execution-20261107`이다. 개발 중 PR #56 병합 main `6526279ae290f6743c2d6675c61f4c42e17a7d1b`을 확인하고, 첫 수정 `edb9b0a`와 동일한 source tree인 이 기준으로 옮겼다. 기존 MCP 회수 오류의 첫 수정/PR #56 뒤 사용자가 “보호 사본·명시 반영까지 개발 승인”을 허용했다. [후속 영향·추정](../reviews/execution-protection-impact-20261107.md), [ADR/계약·복귀](../adr/0002-protected-execution.md), [SSOT](../development-plan.md).

## 구현한 흐름과 재사용

기존 Providers·RPC·SQLite Core/Store transaction·CodexExecutor·WorkExecutionBridge·토론/큐/Wiki·owner 인증과 UI를 재사용한다. 새로운 실행 서비스·ORM·이벤트 bus/범용 워크플로 엔진을 만들지 않았다. 정책 함수/파일 adapter와 기존 명령 경계로 분리했다.

| 부분 | 코드·동작 | 기존 계약/이관 |
| --- | --- | --- |
| 권한 수명 | `execution/authority.ts`·`execution-model.ts`, `model.ts`, `http/mcp.ts` — 일반 grant와 binding에 version/epoch/발급·만료/회수, 기본24시간·소유자1~168시간. job은 binding digest·필요한 grant/토의·문맥 세대를 고정 | 기존 resident/dot 계약 유지. Store version1·기존 DB/receipt 유지, 선택적 executionProtectionVersion1 marker. legacy는 보관하고 재발급/등록 전 새 실행 차단. 미래/손상/marker 유실은 차단 |
| 현재 권한 검사 | `CodexExecutor.submit/start/decide/steer/completeFromTurn/validateResult/applyDraft`, `McpEndpoint.checkGrant` — body 대기·cached receipt·dispatch·비동기 반환·늦은 승인/결과·원본 반영 직전 검사 | 이미 관측한 종료/원문을 보존하고 현재 결과 수락과 구분. active 회수는 중단 요청이며 실제 종료/미확정은 원래 turn과 대조 |
| 보호 사본 | `workspace-protection.ts::ProtectedWorkspaces` — 텍스트 사본·별도 baseline/HMAC manifest, 보호 이름/Git metadata/링크/위험 설정 차단, 최대1MiB/파일·32MiB/2,000항목 | 원래 cwd/thread/branch/HEAD 대조 유지. 실제 profile/namespace가 확인되지 않으면 쓰기 gate 유지. linked Git worktree·submodule·지원하지 않는 index/파일 형식은 차단 |
| 실제 경계 | `isolation.ts::ExecutionIsolation` — installed named permissions schema/managed 허용과 local canary 검사, private PID/procfs·읽기 전용 host root·사본 overlay·앱/Chrome 가림 | trusted CLI 인증과 모델 명령의 read/write/network 권한 분리. 실제 사용자 session/model 없는 합성 검사이며 지원 실패를 full-access로 우회하지 않음. 0.165 기존 readOnly/RPC 계약은 유지 |
| 원문/미리보기 | `evidence-store.ts`·`output-policy.ts`, executor의 capture/activity — private lossless NDJSON·원문 digest/byte/page/완전성과 가린/제한된 미리보기 분리 | 0700/0600, 최대16MiB/4,096기록. gap/restart/손상/한도는 incomplete. JSON/URL/Base64·chunk 경계 가림, 구조화 command/exit metadata 유지. source 수락 직전 원문 무결성도 재검사 |
| 원본 명시 반영 | executor `inspectDraft/applyDraft`와 기존 owner HTTP/UI — 실제 diff 열기→같은 job/diff 확인→기존 UTF8 일반 텍스트1파일만 내용 변경 | 원격 completed와 pending/applying/applied/conflict/unconfirmed 분리. Store에 command 예약/intent 먼저 기록, descriptor write·검증 후 receipt. 같은 command의 다른 입력은 쓰기 전 차단. 생성/삭제/rename/chmod/binary/다중파일·Git 자동화 없음 |
| 후속 수락 | `work-execution.ts`·`work-model.ts`·`engine.ts` — 미반영/원문 불완전·현재 권한 밖 결과는 업무 완료/현재 evidence로 승격하지 않음 | job/link의 원래 보고·명령/실패·미확정은 보존. 독립 검토와 기존 Wiki 공개 계약/예산·단일 dispatch 유지 |

## owner 화면/HTTP

기존 `control.*`에서 만료 시간 선택, 회수·재등록, 원격 종료/사본 상태, 가린/생략 미리보기와 원문 완전성을 따로 표시한다. raw는 자동으로 열지 않고 한 페이지씩 표시하며 job/artifact/digest와 순서를 대조한다. 새로 고침으로 확인하지 않은 diff에 반영 버튼을 붙이지 않는다. textContent를 사용하고 작은 화면에서도 같은 owner 경계를 유지한다.

- 기존 `/api/bindings`·`/api/grants`에 `expiresInHours` 추가. metadata는 서버가 발급한다. 같은 만료/회수/legacy cwd/thread 재등록은 유휴 대상만 다시 확인한다.
- `POST /api/bindings/:id/revoke` — 기존 owner 인증/Host·Origin, 추가 범위 입력 없음.
- `GET /api/jobs/:id/evidence?page=N` — owner 전용 원문, job ID 기반·임의 경로/thread 입력 없음. 일반 MCP grant는 owner 인증이 아니다.
- `GET /api/jobs/:id/draft`, `POST /api/jobs/:id/apply {expectedDiffDigest}` — 새 owner 경로. 기존 command header로 동일 입력을 예약/기록하며 임의 파일·셸 입력 없음.
- 일반 MCP/토론/방/Wiki에는 가린 자료와 참조·미확정 상태만 전달한다. raw/사본·credential은 snapshot/SSE/일반 도구 결과에 포함하지 않는다.

보호 쓰기 작업의 추가 권한 ACCEPT와 steer는 차단한다. 거절/취소·정확한 원래 turn 대조는 유지한다. 모델이 요청한 권한 확대나 확인되지 않은 profile 지원을 owner 승인만으로 통과시키지 않는다.

## 검사와 실제 확인 범위

- 기존 MCP 회수 오류 재현6개: 인증 뒤 body 대기, 전체8도구, cached receipt, 범위 변경, transaction 경쟁, 비동기 반환 가림. 첫 PR 기준 전체655개 PASS.
- 보호 사본24개: 실제 임시 Git/파일, 비밀·link/hardlink/부모/원본/manifest 교체, diff·반영·축소/빈 파일, source branch/HEAD 변경, 부분 쓰기/재시작/replay와 한도. 사용자 저장소는 사용하지 않음.
- 원문34개: 모든 splitpoint/표현, 구조화 값·페이지 exact 복원, private 권한·손상/부분/가짜 연속 기록/한도·재시작. 실계정 credential 읽기 없음.
- UI7개: 만료/legacy/회수, explicit raw 페이지/범위·원본 확인, stale diff·토의 변경·일회 반영, 보호 승인 경계·1380/390px. 모의 HTTP만 사용.
- 통합: 만료/회수 dispatch0, 원문 손상 수락0, 실제 단일파일 diff/반영·Store intent/receipt, 동일 command의 다른 저장소 동시 반영 차단, remote terminal 뒤 draft inspection만 복구, 적용 뒤 receipt 유실은 unconfirmed. 강제 종료 뒤 terminal snapshot으로 원문 gap을 덮지 않는다.

최종 로컬 `npm run check`: strict TypeScript/빌드·Node **735건 중734 PASS, FAIL0, SKIP1**. 기존 전체 검사와 신규 권한/원문/사본/복구를 함께 실행했다. 브라우저 전체84건 중83 PASS 뒤1건의 중복 문구 선택자만 수정했고, 해당 파일4건 재검사는 모두 PASS다. 앱 소스 변경 없이 화면의 경고 문구와 보관 JSON을 구분해 선택했다. 설치 Codex0.166.0의 기존 요청 계약 검사도 PASS이며 로그인/thread/model turn은0이다.

검증 실행 환경은 `/etc/os-release` 기준 Ubuntu26.04.1 LTS, Node24.18.0/npm11.16.0/bwrap0.11.1, Chromium156.0.8078.4/Chrome MCP1.12.0이다. 외부 namespace/사본 overlay 검사와 실제 named profile의 읽기·쓰기/secret/tmp/network canary는 각각 PASS했다. **두 경계를 결합한 runtime proof는 AppArmor `bwrap//&unpriv_bwrap (enforce)`의 중첩 namespace 제한으로 SKIP/BLOCKED**다. 정확한 namespace 거절·종료1·도구 시작 전일 때만 이 상태로 분류한다. canary 실패나 CLI panic을 SKIP으로 숨기지 않는 회귀도 통과했다. 사용자 namespace/UID mapping과 대안 검토에서 안전한 코드 우회를 확인하지 못했고 호스트 정책/권한을 변경하지 않았다. 결합 검사가 확인되지 않은 환경에서는 WRITE를 계속 차단한다. 개별 PASS를 전체 격리 PASS나 실제 Codex 쓰기 성공으로 표시하지 않는다.

CI는 새 보호 계약용0.166을 먼저 설치해 검사하고 기존0.165 계약 검사도 별도로 유지한다. 실제 model 호출·사용자 thread 실행은 추가하지 않는다. 최종 CI 결과는 PR 검사에 연결한다. 앞선 자동 검사는 실제 GPT/dot/Muse·API나 사용자 Codex turn/명령을 실행했다는 뜻이 아니다. 실계정/운영 수락은 NOT_RUN이며 기존50 gate/R8 전체를 완료로 표시하지 않는다.

## 변경량·한계·운영 보존·복귀

제출 전 변경은 **40파일·추가3188/삭제117줄**로 승인 추정32~45파일·2,600~4,200줄 안이다(이 기록 보완의 소수 줄은 PR 최종 diff가 기준). 보호 실패/지원되지 않는 형태는 차단 사유로 남긴다. 같은 OS 사용자의 비협조적인 외부 writer에 대한 kernel atomic CAS는 제공하지 않는다. 원본의 마지막 비교와 held descriptor 쓰기는 app 단일 writer에서 await 없이 수행하며, 실행/반영 중 외부 편집·CLI 중단 조건을 유지한다. 감지된 경쟁/부분 쓰기·기록 실패는 미확정으로 남기고 되돌리기/재반영으로 숨기지 않는다.

운영 `.env`·DB·계정/접속 키·Chrome profile·dot/Muse·API 한도·사용자 untracked 파일은 변경하지 않았다. 실제 계정/사용자 session 호출·배포·병합은 하지 않는다. archive/삭제/자동 만료·raw 정리·다중 실행·Git Writer/자동 병합은 이번 범위 밖이다.

G0의 quiescent 조건과 applying intent/미확정/queued/active를 확인한 뒤 복귀한다. 새 state/event/receipt·raw·baseline/사본을 보존한다. 이전 binary는 새 보호/만료 경계가 없으므로 실행을 재개하지 않는다. 보호 사본의 pending을 원본 수정으로 오인하거나 DB/원문을 초기화하지 않는다.
