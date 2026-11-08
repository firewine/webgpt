# R6 명령 1회 승인 — 구현·합성 검증

상태: **사용자 “계획 개정·명령 1회 승인 보완 개발 승인”에 따른 A~D 구현·합성 검사 PASS, PR 검토 대상. 실제 사용자 R6 수락은 NOT_RUN/R6-F 전체 BLOCKED.** 기준 main은 PR #58/#59 병합 `6351fb04fbbed6b433bff1d10ec7a999e128e2ba`, 작업 브랜치는 `codex/r6-scoped-approval-20261107`이다. [승인 영향안](../reviews/r6-scoped-command-approval-impact-20261107.md), [페이즈 SSOT](../development-plan.md), [이전 실제 중단 기록](./r6-readonly-session-20261107.md)을 따른다. 추가 호스트 설정·OAuth·실제 사용자 인증/외부 모델 호출·배포는0이다.

2026-11-07 착수·2026-11-08 KST 마무리. 승인 당시 예상16~20파일·900~1,400줄에 대해 실제27파일·약1,670줄(추가/삭제 합계, 문서/검사 포함)이다. 파일 수/줄 수 증가는 증명·순수 정책·가짜 전송 모듈 분리와 네 별도 검사 파일, 두 화면 회귀 및 native 빈 폴더 호환 검사/운영 기록에 해당한다. 추가 제품 기능·호스트/호출 범위는 늘리지 않았다.

## 구현 경계

| 단계 | 실제 파일·심볼 | 구현·유지 계약 |
| --- | --- | --- |
| A 승인 후 보호 증명 | `src/execution/isolation.ts::verifyApproval/approvalIdentity/probe`, 신규 `approval-probe.ts::proveApprovedCommand`, `approval-responses.ts::startApprovalResponses` | 실제 CLI+loopback 가짜 Responses로 plain ACCEPT 이후 읽기/쓰기 보호를 검사한다. 정상 요청과 `require_escalated` 요청 모두 검사하며 확대된 권한을 허용하지 않는다. 기본 결합 proof와 승인 후 proof 모두 통과해야 명령 확인이 가능하다. CLI/runtime 패키지 파일·호스트/profile·사본 identity가 바뀌면 기존 증명을 재사용하지 않는다. 증명은60초 이내 같은 조합만 재사용 |
| B 원래 요청과 선택 고정 | 신규 `src/execution/approval-policy.ts::createScopedApproval/validateScopedApproval`, `codex.ts::approval/prepareApproval/approvalContext/acceptScoped` | 수신한 raw method/RPC ID·job/thread/turn/item·명령/cwd와 현재 profile/권한/업무 세대·manifest/runtime을 digest로 묶고 원래 연결을 메모리에 고정한다. 화면에 명령을 온전히 표시할 수 없거나, 알 수 없는 필드·추가 권한·원문 불완전·변경된 HEAD/branch이면 차단한다. 선택과 전송 intent를 먼저 같은 Store transaction에 기록한 뒤 plain accept1회만 보낸다 |
| C 기존 API·두 실행 화면 | `src/http/workspace.ts`의 jobs approve, `src/web/control.ts::renderExecution`, `room-view.ts`의 scoped 확인 helper/실행 상세 | 새 endpoint 없이 기존 소유자 인증·Host/Origin·이벤트를 재사용한다. 준비된 명령/작업 위치/읽기 전용 또는 보호 사본 수정 범위를 보고 체크해야 ‘이 명령 1회 승인’을 누를 수 있다. HTTP는 expectedScopeDigest·ownerConfirmed·idempotency key를 대조한다. 기존 legacy 승인 API의 헤더 없는 요청 계약은 유지하며 보호 명령만 명시 확인을 요구한다 |
| D 유실·중복·반영 경계 | `codex.ts::recover/decide`, `authority.ts::initializeExecutionProtection`, 기존 evidence/workspace 검사·브라우저 fixture | 두 탭·같은 key·native RPC ID 재사용·회수/만료·연결 유실·전송 오류·재시작에서 자동 승인/재전송0을 확인한다. 보호 범위를 바꾸는 승인·세션 전체 승인·영구 prefix·steer는 계속 차단한다. 사본 diff와 원본1파일 명시 반영·독립 리뷰는 기존 별도 절차다 |

데이터는 기존 job.approvals에 optional `scope{version:1,state,digest,requestDigest,contextDigest,command,cwd,profileId,reason,choice}`를 추가했다. 선택 기록은 commandId·selectedAt·delivery를 보존한다. 상태는 checking→ready→selected→sent 또는 blocked/unconfirmed이고, 실제 전송 직전에는 unconfirmed/sending intent를 저장한다. SQL/Store version·기존 job/receipt·예산·단일 dispatch는 바꾸지 않는다. 미래/손상 metadata·보호 marker 유실을 거절하며 과거 승인 요청에 새 scope를 소급 생성하지 않는다.

새 `Workspace`는 scopedApprovals를 주입하지만 내부 adapter의 legacy 직접 생성 계약은 유지한다. 기능을 켜기 위한 사용자 환경 변수나 proof를 생략하는 우회 옵션은 추가하지 않았다. approval-policy는 순수 정책 모듈, 실제 CLI 증명/가짜 추론 전송은 작은 별도 모듈로 분리하고, 기존 Store/authority/evidence 및 화면 helper를 재사용했다. 새 승인 엔진·DB·broker는 없다.

## 실제 CLI 호환 보완

native 쓰기 실행에서 CLI가 사본에 빈 `.agents/.aws/.codex/.git` mount 준비 폴더를0755로 만들면 기존 엄격한 사본 검사가 `private_directory_required`로 중단됐다. `ProtectedWorkspaces.prepare`가 새 사본의 repoRoot/cwd에 이 네 빈 폴더를0700으로 먼저 만들고 기존 봉인 baseline.directories에 기록하도록 보완했다. 원본의 해당 설정/자격 증명은 복사하지 않는다. `ExecutionIsolation.config`는 이 경로를 명시 deny한다.

`inspectRecord`는 **봉인 baseline에 이미 있는 정확한 빈 폴더만** 인정한다. 내용 추가·권한 변경·삭제·링크·새 보호 경로는 여전히 실패한다. authentic legacy manifest는 새 폴더를 자동 인정하지 않는다. SQL/manifest version 변경·기존 사본 재작성·원본 설정/호스트 변경은 없다. 기존 standalone profile fixture도 같은 새 사본 준비 구조로 맞췄으며 실제 namespace 실패를 성공으로 처리하는 규칙은 바꾸지 않았다.

공식 소스는 설치 버전0.166.0의 고정 revision `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`를 대조했다. [plain accept 매핑](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src/bespoke_event_handling.rs#L2045), [세션 캐시와의 구분](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/sandboxing.rs#L72), [승인 후 deny 범위](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/protocol/src/permissions/target.rs#L44)를 확인했다. native 승인 payload가 추가 실행 요청을 별도 필드로 드러내지 않을 수 있어, 정적 추정으로 허용하지 않고 실제 추가 실행 요청 canary까지 포함했다. 다른 버전의 성공은 UNVERIFIED다.

## 검사 증거

환경: Ubuntu26.04.1 LTS, Node24.18.0/npm11.16.0, Codex0.166.0, bwrap0.11.1. PR #58에서 승인·설치한 전용 outer/AppArmor를 그대로 사용했다. 실제 호스트 검사는 운영과 같이 NoNewPrivileges 조건에서 실행했다.

| 검사/검증 방법 | 결과와 한계 |
| --- | --- |
| `npm run check` / Node 로그 | **832건 중826 PASS·FAIL0·SKIP6**, strict TypeScript/빌드 PASS. 기본 실행에서 opt-in native4건·실제 등록1건과 전용 outer 없는 결합 proof1건은 SKIP. 아래 별도6건 PASS와 구별 |
| `tests/native-approval.test.mjs` + 기존 호스트 proof/등록 검사 / 실제 CLI 로그 | **6 PASS/0 SKIP**: 준비용 모델 turn0의 등록, 기존 결합 proof, native plain ACCEPT, 정상/추가 실행×read/write의 승인 후 모든 경계, 실제 controller 읽기 및 쓰기 사본 diff→명시1파일 반영. 가짜 Responses·dummy key·임시 Git만 사용, 사용자 인증/외부 모델 호출0 |
| `tests/approval-policy.test.mjs` / Node | 16 PASS: 원래 요청 seal, 알 수 없는/추가 권한/표시 불가 명령 차단, 미래/손상 상태 거절 |
| `tests/approval-responses.test.mjs` / Node | 26 PASS: loopback 한정·route/body/횟수 제한·원래 명령/cwd·native catalog·정상/추가 실행 가짜 payload. 로컬 fixture 자체가 명령을 실행하거나 외부로 전달하지 않음 |
| `tests/scoped-approval.test.mjs` / Node·HTTP·실제 Store | 21 PASS: 선택/전송 전 journal·한 번만 전송, 두 소유자/중복/유실·변경/만료·거절·restart 미확정, 기존 헤더 없는 API 호환. RPC/proof 부분은 fixture이며 native 증명과 혼동하지 않음 |
| `tests/workspace-protection.test.mjs` / Node | 빈 보호 폴더의 mode/content/missing/link 및 authentic legacy manifest 회귀5건을 포함. 기존 diff/1파일 반영·원본 보존·불명확 쓰기 대조 검사 유지 |
| `tests/browser/execution-protection.test.mjs`, `work-execution.test.mjs` / Chromium 화면 | **26 PASS/0 SKIP**: 두 화면의 체크 없는 전송0, 표시한 digest만 제출, 검사 중/실패/추가 권한 차단, 오래된 화면/선택·미확정에서 승인0, 기존 반영/원문/잠금 제어 |
| 독립 정적 검토 | legacy API idempotency header 호환 문제를 수정·회귀 검사했고, 최종 검토 범위의 남은 P1/P2 발견0. sealed0700 폴더 예외도 별도 검토 |
| 운영 상태 / 읽기 전용 명령·health | 운영 폴더 tracked 변경0·기존 untracked 파일 보존, HEAD `f648ea5`, 서비스 active·4090 health200. 이번 코드 배포·재시작·운영 DB job/권한 추가0 |

로컬 재현: `npm run check`. 관련 화면은 빌드 뒤 `node --test tests/browser/execution-protection.test.mjs tests/browser/work-execution.test.mjs`로 확인한다. 실제6건 opt-in 명령은 [운영 절차](../operations-runbook.md#r6-전용-apparmor-예외--명시-설치검사복구)를 따른다. 이 결과는 fake AI 입력을 사용한 실제 실행 보호 증거이며 실계정 요청/보고/Wiki 수락을 뜻하지 않는다.

## 후속 수락·롤백

R1 JSON/journal·R2/R5 업무 세대·R3 두 확인 화면·R6 증명/승인·R8 중복/복구 검사만 보완한다. R4 GPT/dot/Muse·R7 Wiki 계약과 원래50 gate는 유지한다. 승인 수신/종료 코드0만으로 업무 독립 리뷰나 Wiki 검증 상태를 승격하지 않는다.

다음 실제 R6 수락은 사용자 병합 후 별도 서버 적용·새 호출 창 승인에서 **읽기 보고→소유자 재작업 요청→쓰기 사본→소유자1파일 명시 반영→독립 수락** 순서로 진행한다. 이전 중단 job/원문을 보존하며 완료로 세지 않는다. 추가 모델 호출·운영 적용·구체 원본 반영을 이번 개발 승인으로 자동 실행하지 않는다.

롤백은 새 승인/dispatch를 멈추고 원래 RPC/request·choice/delivery intent·turn/원문·반영 상태를 대조한 뒤 이전 보호 ACCEPT 차단 경로로 복귀한다. 이미 보낸 승인을 취소로 추정하거나 재전송하지 않는다. proof 실패는 차단을 유지하고 보고하며 호스트 정책 확대/전역 격리 해제로 우회하지 않는다. 기존 DB·manifest/사본·원문·인증/Chrome을 지우거나 과거 상태로 덮어쓰지 않는다.
