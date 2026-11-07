# R6 실제 검증 선행 보완 — 읽기 범위·새 세션 수명

상태: **2026-11-07 사용자 “읽기 보호·새 세션 보완 개발 승인” / 구현·자동 검사·무호출 호스트 보호 PASS.** AppArmor 예외는 승인·설치·실제 보호 PASS이며 PR #58에 제출했다. 이 문서는 승인 당시의 영향안이며 당시 실제 모델 요청은0이었다. 이후 실계정1job의 명령 승인 차단·중단과 운영 보존 결과는 [구현·실측 기록](../implementation/r6-readonly-session-20261107.md)을 따른다. 보호 명령 승인 지원은 별도 미승인 제안이다.

## 1. 실제로 확인한 두 차단 조건

| 관측 | 코드·계약 | 영향 |
| --- | --- | --- |
| 실제 CLI0.166.0의 빈 thread/start는 성공하나 rollout 파일0. 같은 프로세스 read만 성공, 별도 프로세스 read/resume는 rpc_rejected | `CodexExecutor.register/start`는 기존 thread를 읽고 resume한다. 같은 생성 프로세스에서 첫 turn을 직접 시작하는 경로는 없음 | 승인안의 ‘추가 모델 요청 없는 새 thread handoff’를 그대로 수행할 수 없음 |
| 가짜 auth.json을 실제 CLI의 built-in :read-only profile에서 읽을 수 있었음 | 기존 readonly의 readOnly 정책은 broad read. PR #57의 보호 쓰기만 named profile의 auth deny를 적용 | 전용 Codex home을 만들기만 해서는 실제 인증이 모델 도구로부터 보호되지 않음. 실제 readonly 모델 호출0 유지 |

첫 증거는 credential0/model0인 임시 두 프로세스로 확인했다. 두 번째도 가짜 sentinel/실제 격리만 사용했다. 실제 키 유출 사건을 관측한 것은 아니다. source 위치: `src/execution/codex.ts::register/start/connectOnce`, `src/execution/isolation.ts::config/probe`, `src/workspace/model.ts::ExecutionBinding/CodexJob`. 설치 binary의 ThreadStartParams experimental 생성 schema에서 `permissions` string/null 및 sandbox와 동시 전송 불가를 확인했다. 모델 호출 없이 새 세션을 생성하는 RPC 자체는 지원한다.

## 2. 권장안 — 보호된 읽기 + 앱이 첫 세션을 같은 연결에서 시작

**추가 예상10~16파일·600~1,000줄**(자동 검사·문서 포함). 전용 호스트 정책/전역 설정 변경0, 추가 OAuth/제공처/새 DB0. 기존 승인한 실제 Codex job 최대2회·30분·job당300초를 유지하며 준비용 모델 호출을 추가하지 않는다.

| 단계 | 실제 파일·심볼 / 신규는 제안 | 계약·데이터·수락 |
| --- | --- | --- |
| A 최소 읽기 | 기존 `execution/isolation.ts::ExecutionIsolation`, `workspace-protection.ts::ProtectedWorkspaces`, `codex.ts`, `model.ts`, 관련 fixture/검사 | sanitized 사본을 같은 cwd에 씌우고 root deny/필요 runtime read/사본 read/auth·app state·Chrome deny/network off인 읽기 전용 named profile을 추가. 모델 도구의 사본 쓰기도0. readonly 실행의 준비 metadata는 쓰기 draft/apply 상태와 구별 |
| B 새 세션 수명 | 기존 `codex.ts::register/start/connectOnce`, `http/workspace.ts`의 binding 등록, `web/control.*`의 실행 등록 UI, optional binding metadata | 기존 thread 등록은 유지하고 소유자가 ‘새 검증 세션’을 명시 선택할 수 있게 함. thread/start로 실제 ID를 받은 **같은 App Server 연결**의 최초 실행만 resume 없이 turn/start. 두 번째부터 기존 resume 경로 재사용 |
| C crash/권한/계약 | `authority.ts`, 기존 execution/work-execution 검사·운영 문서/SSOT | 연결이 끊겨 미저장 thread를 잃으면 명시 차단/재등록. queued/running 요청을 다른 새 thread에 자동 재전송하지 않음. branch/cwd/권한·capture·job scope는 기존 검사 유지 |

선택적 세션 출처/최초 실행 준비 상태·읽기 보호 metadata를 기존 JSON에 추가하고 Store transaction으로 저장한다. 손상/미래 상태는 거절하며 기존 binding/job을 새 세션이나 보호 완료로 자동 승격하지 않는다. 실제 metadata 이름은 구현 시 ADR/전이표로 고정하되 공개 범위를 늘리지 않는다.

추가 권한 ACCEPT/steer의 기존 보호 차단은 유지한다. 읽기 프로필 밖 접근을 요구하는 승인은 안전한 scoped 실행 지원이 증명되지 않으면 decline/cancel만 허용한다. 실제 R6-F에서 필요한 승인 증거가 없으면 UNVERIFIED로 남기며, 원래 gate를 완화하거나 ‘읽기 성공=R6 완료’로 바꾸지 않는다.

## 3. 대안과 판정

| 안 | 변경량·판정 |
| --- | --- |
| 권장: 보호 읽기+앱 내부 새 세션 시작 | 위10~16파일·600~1,000줄. 모델 예산2회를 유지하고 향후 새 업무 시작에서도 재사용 가능 |
| 보호 읽기만 개발하고 검증용 bootstrap 모델1회 추가 | 약8~12파일·450~750줄, 실제 모델 예산은 준비1+업무2=3회로 늘어남. 현재 별도 승인 범위를 바꾸고 단발 준비 호출이 필요해 비권장 |
| 기존 사용자 세션 임의 재사용·원래 auth 복사만으로 진행 | 기각. 승인한 격리 검증 범위·세션/개인 이력 보존과 충돌 |
| 보호 없이 readonly 진행·추가 권한 ACCEPT로 우회 | 기각. broad read 문제를 그대로 두거나 프로필 밖 실행을 허용함 |

## 4. 후속 R1~R8 영향·증거·복귀

- R1: 기존 Store/SQL을 유지하고 optional metadata·미래/손상 상태·legacy 보존 검사만 추가.
- R2/R5: 단일 실행·업무 attempt/job link·취소/재전송0을 유지. 최초 세션도 정확한 업무 요청1개와 연결.
- R3/R4: 기존 Codex 등록 폼에 기존/새 세션 선택·준비/미저장/재등록 안내만 추가. 채팅방 디자인·provider/로그인·dot/Muse 변경0.
- R6: 실제 CLI로 읽기 허용/쓰기도0·auth/state/profile/proc/network 유출0을 먼저 증명. first thread/start1/최초 turn/start1, 후속 resume1, crash·재접속 후 잘못된 새 thread 실행0을 검사.
- R7: 보고/검토/Wiki 인용 계약 유지. 새 세션 준비를 업무 완료나 Wiki 근거로 올리지 않음.
- R8: 위 실패/복구와 기존50 gate를 회귀 검사. 실제2job은 별도 환경에서만 수행하고 승인·반영·독립 owner 검토의 실제 증거로 판정.

완료 기준: 자동 검사와 실제 CLI canary를 통과한 뒤, 별도 fixture repo에서 실제 read job→원래 report/반려→protected write job→정확한 diff 제시/소유자 반영→owner 검토를 최대2job으로 수행한다. 실제 명령 승인이나 다른 요구가 지원되지 않으면 해당 gate를 완료로 표시하지 않는다. 필요한 구체 command 승인·파일 반영·독립 owner 검토만 그 시점에 제시한다.

복귀: 새 dispatch를 멈추고 원래 job/thread/turn·미확정 원문을 보존한다. 새 세션 준비 중 연결을 잃으면 다른 thread로 대체하지 않는다. 기존 binding 등록만 쓰는 경로로 돌아갈 수 있지만 보호가 확인되지 않은 legacy readonly 실행은 차단한다. 새 JSON/receipt/private 원문을 삭제하지 않으며 호스트 예외·운영 데이터·인증은 별도 보존한다.

**승인 기록:** 사용자가 권장안의 개발을 승인했다. PR #58 코드 위의 별도 브랜치에서 구현하며, 추가 호스트 변경이나 준비용 모델 호출 없이 기존2job/30분 한도로 검증한다. 실제 command·파일 반영·독립 owner 검토는 구체 결과를 제시한 뒤 받는다.
