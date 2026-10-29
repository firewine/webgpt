# 웹쫀쿠 Git Writer 제품 요구사항

| 항목 | 값 |
| --- | --- |
| 버전 | Draft v0.3 |
| 개정일 | 2026-10-29 (KST) |
| 범위 | 웹쫀쿠의 선택 Git Writer 모듈; 우선 코드 실행은 기존 Codex 세션 |
| 상위 개발 계획 | [development-plan.md](./development-plan.md) |
| 상세 기술·검증 계획 | [git-writer-plan.md](./git-writer-plan.md) |

## 1. 목적과 착수 순서

사용자의 제품 요구를 받은 웹 LLM이 승인된 저장소를 읽고, 격리된 작업 공간에서 변경·검사를 수행하고, `chatgpt/*` 브랜치의 draft PR을 생성·갱신하도록 한다.

웹쫀쿠 전체는 [Living Design](./webjjoku_living_design.md)의 관제·오케스트레이션 제품이다. 우선 코드 실행은 [Codex 세션 실행](./codex-session-plan.md)의 Phase 4A다. Git Writer는 Phase 4B의 별도 선택 모듈이며, 그 구현을 dot → Codex 왕복의 선행 조건으로 두지 않는다. 브라우저 연결 PoC에 GitHub token이나 terminal 권한을 요구하지 않는다.

최종 목표의 조건부 squash auto-merge는 Git Writer MVP에서 제외한다. Ubuntu Core·Chrome·Codex의 상시 운영은 상위 Phase 2에 포함하며 [Ubuntu 운영 계획](./ubuntu-operations.md)을 따른다. 이 모듈의 foreground/stdio 조건을 전체 제품의 HTTPS 서버·상시 실행 금지로 해석하지 않는다. 과거 Windows·HTTP daemon·토큰 직접 보유·즉시 병합 예제를 현재 runbook으로 사용하지 않는다.

## 2. 지원 범위

| 항목 | Git Writer MVP |
| --- | --- |
| OS | 첫 릴리스는 고정 Ubuntu Linux x86_64 profile 1개; macOS는 후속 확장 |
| 실행 | 감독되는 tunnel의 foreground 자식 프로세스, Node.js 24 계열·ESM·strict TypeScript |
| transport | 검증된 Secure MCP Tunnel이 실행하는 stdio MCP writer |
| 대상 | 사전 승인된 disposable 저장소 1개, 전역 변경 작업 1개 |
| 변경 | 허용된 제품 소스·직접 관련 테스트의 text patch와 복원 |
| 검사 | 서버가 결정하는 필수 allowlist suite + 허용된 추가 suite |
| 게시 | `chatgpt/*` commit/push와 동일 draft PR 생성·갱신 |
| 복구 | 원자적 상태, task lease, 감사 기록, 중복 호출·중단 복구 |
| 릴리스 | Ubuntu 적합성, offline regression, 실제 Ubuntu live E2E |

Git Writer MVP 제외: macOS/Windows, ARM Linux, writer 자체의 HTTP listener·별도 daemon, 복수 저장소·동시 작업, merge credential·merge 동작, 임의 shell·package install·unrestricted network, binary/generated/submodule 변경. Ubuntu의 실제 architecture가 다르면 해당 profile을 별도 검증하며 지원을 추정하지 않는다.

보호 경로는 `.github/**`, `AGENTS.md`, Git metadata, credential, writer/runtime/policy, dependency manifest·lockfile, package manager 및 build/test 설정·검사 스크립트다. 실제 저장소에 맞춰 목록을 고정한다. 보호 범위 안의 요청은 `UNSUPPORTED_SCOPE`와 이유를 반환한다. 허용된 소스·직접 테스트에는 임의 파일 수 제한을 두지 않는다.

## 3. 신뢰 경계

| 구성요소 | 허용 권한 | 전달하지 않을 권한 |
| --- | --- | --- |
| Chrome 연결기 | 승인된 계정·대화의 UI 입출력 | GitHub credential, target 실행 권한 |
| tunnel-client | tunnel runtime key, writer stdio 시작 | GitHub token의 writer 상속 |
| MCP writer | 정책·상태·read/edit orchestration | tunnel/GitHub secret, target 직접 실행 |
| sandbox runner | worktree와 read-only toolchain | 브라우저 프로필, home/keyring, secret, egress |
| remote broker | 제한된 GitHub credential, 고정 remote/ref/PR | target 실행, merge, force/default/tag/delete push |

권한 우선순위는 `불변 서버 정책 > 인증된 사용자 작업 > 대상 저장소 지침`이다. 저장소의 AGENTS.md, 소스 주석, diff, 검사 출력은 정책·필수 검사·권한을 바꿀 수 없다.

source/install/config/state/runtime/credential/target 경로의 중첩·alias를 거부한다. Chrome 프로필과 연결기 데이터도 target·sandbox 경계 밖에 둔다. 실행 중인 writer는 자신의 소스나 설치 경로를 target으로 받지 않는다.

## 4. MCP 도구

| 도구 | 동작 |
| --- | --- |
| read_repository_file | 고정 snapshot의 paginated text read |
| search_repository | bounded search |
| start_change | task ownership·전역 lease 획득, pinned base worktree 생성 |
| apply_patch | 검증된 상대 경로의 text patch 적용 |
| restore_paths | 허용 path를 pinned base로 복원 |
| inspect_diff | 전체 changedPaths/stat, digest에 묶인 diff pagination |
| run_checks | 서버 필수 suite와 허용된 추가 suite 실행 |
| publish_pull_request | 정확한 검증 변경을 commit/push하고 draft PR 생성·갱신 |
| discard_change | 미게시 task 정리 |

- versioned schema와 `additionalProperties:false`를 사용한다.
- 호출자가 필수 suite를 빼거나 보호 경로를 승인할 수 없다.
- tool annotation은 선택·승인 UX의 hint이며 권한 통제가 아니다.
- 읽기 ref, task ID, 경로, payload·결과 크기, timeout은 schema·정책으로 제한한다.
- shell 문자열 대신 명시적 executable/argument array와 비동기 `spawn`, `shell:false`를 사용한다.
- 오류는 stable code, 설명, 재시도 가능 여부를 반환한다.
- 기본 모듈에 merge tool이나 숨은 merge side effect를 넣지 않는다.

## 5. 변경과 상태 계약

일반 전이는 NEW → ACTIVE → CHANGED → INSPECTED → CHECKED → PUBLISHING → PUBLISHED_DRAFT다. 중단·불일치는 RECOVERY_REQUIRED로 보내 local state·branch·remote head·PR을 대조한다.

상태는 worktree 밖에서 atomic write + fsync + rename으로 저장한다. 작업 정리 후에도 terminal tombstone과 감사 기록을 유지한다. Core의 task ID와 writer change ID를 매핑한다.

다음 변경 중 하나라도 있으면 이전 inspection/check 증거를 폐기한다.

- patch·restore·base SHA 이동.
- candidate tree/diff, config/policy/sandbox profile 변경.
- 필수 suite set 또는 remote/PR head 변경.

증거는 base SHA, candidate digest, config/policy/sandbox digest, 필수 suite, 실제 pushed commit과 PR head에 묶는다. 잘린 diff나 생략된 파일을 전체 검토로 간주하지 않는다.

동일 변경의 publish 재호출은 commit·PR을 중복 생성하지 않는다. 발행 후 사용자가 명시적으로 후속 변경을 요청하면 새 revision으로 취급해 inspection·checks를 다시 수행하고 새 commit을 동일 브랜치·draft PR에 반영한다. 이전 head가 예상과 다르면 먼저 재조정한다. force-push로 해결하지 않는다.

## 6. 검사와 격리

공통 SandboxBackend 계약 아래 초기 Ubuntu의 Linux Bubblewrap 후보를 실제 호스트에서 검증하고 ADR로 고정한다. macOS VM/container 후보는 후속 OS 추가 때 동일 계약을 검증한다. 무격리 host 실행이나 `sandbox-exec`로 자동 fallback하지 않는다.

필수 검증:

- worktree만 writable, toolchain read-only, 빈 HOME·private temp.
- browser profile, keyring, SSH agent, Docker/runtime socket 미노출.
- network egress 차단과 CPU·memory·PID·disk·wall-time 제한.
- timeout·cancel·restart 이후 descendant cleanup.
- hostile Git config/hook/filter, symlink·hardlink·경로 alias 우회 차단.
- sandbox 불완전 시 `SANDBOX_UNAVAILABLE`로 중단.

필수 suite는 서버가 변경 경로와 위험도에 따라 결정한다. 실제 저장소의 format/diff, 직접 테스트, typecheck/compile, production build를 적용 가능한 범위에서 등록한다. 생성 산출물 복원도 mutation으로 취급하고 최종 candidate가 검사 대상과 일치하는지 검증한다.

기본 테스트는 offline으로 실행한다. 실제 GitHub·OpenAI·유료 API로 나가는 테스트는 별도 live E2E로 분리한다.

## 7. draft PR 발행

1. 마지막 mutation 이후의 전체 inspection과 필수 checks 성공을 확인한다.
2. 보호 경로·산출물·최종 candidate digest를 재확인한다.
3. 고정된 author와 정확한 staging set으로 commit을 생성한다.
4. 제한된 remote broker가 `HEAD:refs/heads/chatgpt/<taskId>`만 push한다.
5. 예상 remote head와 bot-owned PR을 확인해 동일 draft PR을 생성·갱신한다.
6. 실제 commit/PR head와 검사 증거를 대조하고 URL·상태를 Core에 반환한다.
7. 중단 시 상태를 보존하고 한 revision/한 PR로 재조정한다.

broker는 target-controlled Git 설정·hook·filter·diff driver·fsmonitor·submodule·custom protocol을 실행하지 않는다. credential은 해당 broker에만 짧게 주입한다. 각 Git child에 token을 무차별 상속시키지 않는다.

기본 브랜치 직접 push, force/tag/delete push, admin bypass는 구현하지 않는다. draft PR 발행을 merge나 배포 완료로 표시하지 않는다.

## 8. 설치·운영

- 소스와 설치 artifact, config, task/audit state, runtime, credential을 분리한다.
- Ubuntu의 실제 무인 재시작 조건에 맞는 보호된 credential 저장·주입 방식을 검증한다. Linux Secret Service를 선택하면 로그인·잠금 해제 의존성도 확인한다. macOS Keychain은 후속 OS 범위다. secret을 문서·prompt·평문 service 파일에 기록하지 않는다.
- committed source에서 Ubuntu artifact를 재현 가능하게 빌드하고 hash manifest, read-only atomic activation, rollback을 검증한다.
- Secure MCP Tunnel은 검증한 공식 init/doctor/run 절차와 버전으로 runbook을 작성한다.
- tunnel health/readiness와 ChatGPT workspace·Platform 권한을 각각 확인한다.
- writer stdout은 MCP 전용, log는 redacted stderr로 보낸다.
- writer는 foreground 자식으로 유지하고 상위 tunnel/Core의 Ubuntu 서비스 관리·재시작을 통합 검증한다. writer 자체 HTTP transport와 macOS LaunchAgent는 후속 ADR·release gate를 따른다.

## 9. 완료 조건

- 초기 Ubuntu profile의 적합성·공격 fixture 통과. 추가 OS는 별도 릴리스 gate 적용.
- offline 상태·Git·검사·중단/replay 검증 통과.
- 각 지원 OS에서 실제 요청 하나가 검증된 변경과 draft PR 하나로 이어짐.
- mutation 이후 stale checks 재사용, secret 노출, sandbox escape, 잘못된 ref push 없음.
- 재시작·재호출로 중복 commit/PR이 만들어지지 않음.
- 감사 기록으로 task·정책 판단·checks·commit·PR 관계 재구성 가능.
- 검증하지 않은 결과는 NOT_RUN/BLOCKED로 표시하고 release-ready로 선언하지 않음.

## 10. 후속 자동 병합

별도 범위 승인과 다음 조건을 갖춘 뒤에만 구현한다.

- 기본 브랜치 보호/ruleset을 실제 조회·검증.
- 비어 있지 않은 mandatory remote checks.
- 정확한 현재 PR head의 checks 성공.
- bot의 admin/bypass 권한 부재.
- target CI의 secret/write token 노출과 unsafe pull_request_target 경로 검토.
- base 이동·stale/pending/fail/cancel check·ruleset drift 거부 검증.

조건을 충족할 때 squash auto-merge를 활성화한다. required checks가 없거나 auto-merge 설정이 꺼졌다는 이유로 즉시 병합하지 않는다.

## 11. 변경 이력

### v0.3 — 2026-10-29

Codex 세션 실행을 우선 경로로 두고 Git Writer를 Phase 4B 선택 모듈로 정리했다. 첫 릴리스는 Ubuntu로 한정하고 macOS는 후속 확장으로 이동했다. 모듈의 foreground/stdio와 전체 제품의 Tailscale HTTPS·상시 운영 범위를 구분하고 headless 서버의 credential 재시작 검증을 추가했다. sandbox·draft PR·증거 조건은 유지한다.

### v0.2 — 2026-10-29

웹쫀쿠 전체 계획과 Git Writer 요구사항을 분리했다. draft-only·stdio·credential 분리·양 OS sandbox 조건으로 정합화하고, 과거 Windows/HTTP/동기 실행/즉시 merge 예제를 제거했다. Chrome 프로필 경계와 대화 결과·실행 증거의 구분을 추가했다.

