# 추천3 영향 검토 — 실행 권한·보호 작업 사본·원문 근거

**상태: 권장안 승인 / 구현·검사 진행 중 (2026-11-07).** 사용자는 “병합했어 3번 개발”로 추천3의 개발을 허용했다. 다만 [기존 계획 변경 절차](../development-guidelines.md#5-계획-변경-사전-승인과-후속-페이즈-영향-검토)는 공개/영속 계약·이관·수락 변경 전에 현재/후속 영향·변경량 보고와 승인을 요구한다. 사용자는 “보호 사본·명시 반영까지 개발 승인”으로 권장안과 아래 최소 계약을 허용했다. 실계정 실행·서버 적용은 제외하며, 실제 보호 검사 없이 쓰기 차단을 해제하지 않는다. 기존 회수 계약의 stale 객체 오류는 별도의 작은 버그 수정으로 진행한다.

## 기준과 실제 확인

- 코드 기준: PR #55 사용자 병합 main `f3384cc8d98f5f71c81bd94fdddba37ee40b83dc`. 운영 소스는 `f648ea5`이고 PR #55는 문서만 바꿨다. 작업 위치는 별도 worktree/branch `codex/protected-execution-20261107`이다. 운영 `.env`·DB·계정/Chrome profile·서비스는 변경하지 않았다.
- 설치 Node24.18.0/npm11.16.0/Codex0.166.0/bubblewrap0.11.1. 설치 App Server schema의 기존 요청 계약 검사는 PASS, 로그인/thread/model turn 시작0. 기존 기준0.165의 승인을 전역 도구 덮어쓰기로 맞추지 않는다. 실제 namespace/procfs·읽기 전용 mount·network namespace의 `/bin/true` 검사도 성공했다. 사용자 Codex 작업 성공의 증거는 아니다.
- `src/execution/codex.ts::register/start/connectOnce`: 실제 원본 cwd에 실행하고, outer bwrap는 host root를 bind한 뒤 app state/Chrome profile만 가린다. `work-execution.ts::readyReason/scopeReason`의 `allowWrite` 차단을 제거하는 것만으로 안전한 쓰기가 되지 않는다.
- 일반 discussion grant는 id/hash/tools/revoked만 가진다. HTTP가 grant를 인증한 뒤 request body를 기다리는 동안 회수되면 기존 grant 객체를 사용할 수 있다. resident/dot에는 별도의 현재 권한/만료 검사가 있다. `CodexJob`에는 권한 출처/세대가 없고 binding에는 만료/회수가 없다.
- `CodexExecutor.notification/completeFromTurn`: 출력/item을100,000/80,000자로 조용히 잘라 저장한다. `executionReport`는 깨진 JSON을 unknown으로 처리하지만 본문 누락/수집 불완전성을 별도로 보존하지 않는다. snapshot/MCP/토의 evidence/업무·Wiki에 출력이 전달된다. 익명 접근 취약점을 입증한 것은 아니다.
- 합성 OS 검사: 가짜 `.env`를 개별 mount로 숨긴 상태에서 host가 새 `.env.late`를 만들면 sandbox에 보인다. `knownFileHidden=true`, `lateProtectedNameStillVisible=true`, exit0. 실제 비밀·사용자 저장소·모델 호출은0. 공식 [Permissions 문서](https://learn.chatgpt.com/docs/permissions#deny-reads-with-exact-paths-or-globs)도 Linux의 deny glob가 프로세스 시작 때의 일치 파일을 기준으로 해 나중에 생성된 파일을 가리지 못함을 설명한다. 따라서 개별 경로 가림/사전 검사만으로 변경 중인 repo의 비밀 경계를 보장하지 않는다.

공식 [App Server 문서](https://learn.chatgpt.com/docs/app-server#sandbox-read-access-readonlyaccess)는 제한된 read access를 설명하지만, 설치0.166.0의 생성 schema에는 legacy `sandboxPolicy.access/readOnlyAccess`가 없었다. experimental schema에는 named `permissions` profile ID가 있으며 기존 sandboxPolicy와 함께 보낼 수 없다. 문서 예시만으로 지원을 추정하거나 experimental/full-access로 조용히 전환하지 않는다. 보호 사본·신뢰된 인증·명령 실행의 분리가 실제 계약/호스트 검사로 확인되지 않으면 쓰기 gate를 유지한다.

## 선택지와 권장 결론

1. **권장 — 권한 수명/원문 보호와 보호된 작업 사본 실행·명시 반영을 함께 구현.** 기존 provider/Store/executor/queue/MCP를 재사용한다. 원본은 실행 동안 읽기 전용으로 두고, 비밀·위험 링크를 제외한 private 사본에서 Codex가 변경하게 한다. 종료 후 실제 diff·기준 해시·파일 목록을 보여주고 소유자가 확인한 변경만 원본의 작업 브랜치에 반영한다. 현재 파일이 바뀌었으면 충돌로 남긴다. 첫 버전의 원본 반영은 기존 일반 텍스트 파일1개의 내용 수정으로 제한하며 생성/삭제/이름·권한 변경/바이너리/여러 파일 반영은 차단한다. 선택 Git Writer의 자동 commit/push/PR/merge를 제품 기능에 추가하지 않는다.
2. **제한안 — 이번에는 권한 수명·원문 보호만 구현하고 실제 쓰기는 계속 차단.** 추가 자료 노출·늦은 권한 사용을 줄일 수 있지만 추천3의 실제 작은 파일 변경까지는 완료되지 않는다. 원본 직접 쓰기에 비밀 경계가 확보됐다고 표시하지 않는다.

직접 원본에 쓰면서 알려진 파일만 가리는 안은 위 합성 검사 때문에 기각한다. 새 보호 사본·명시 반영이 추가 사용자 단계/실행 계약을 만들므로 추천3의 일반 개발 승인을 이 구체 변경의 포괄 승인으로 해석하지 않는다.

## 제안하는 최소 계약

| 경계 | 구체 변경·유지 사항 |
| --- | --- |
| 일반 grant·binding 수명 | optional version/expiry/revoked metadata와 job의 권한 출처 snapshot을 기록. 새 권한은 owner가 만료시각을 선택하며 기본24시간·최대7일을 제안한다. dispatch/늦은 승인/steer/반영/결과 수락 전에 현재 권한과 대조. 모델은 연장·회수 취소 불가. resident/dot의 기존 계약은 변경하지 않음 |
| 회수 | 기존 grant 회수와 새 binding 회수 UI/API를 기존 owner 경계에 연결. queued는 시작하지 않고, active에는 중단 요청을 기록하며 실제 종료/미확정을 구분. 회수 뒤 원래 receipt/실행 원문은 보존하되 현재 토의·보고·Wiki로 새 수락하지 않음 |
| 과거 자료 | 기존 대화/완료 job/receipt를 유지. 새 metadata 없는 legacy 권한은 무기한으로 추정하지 않고 재발급/재등록 전 새 실행을 막음. 출처 없는 job을 임의 grant에 귀속하거나 재전송하지 않음. 새 SQL 테이블·최상위 Store version 변경 없이 additive marker/검증을 제안 |
| 보호 사본 | server가 허용한 source root·branch/head·선택 credential 경로·파일 baseline을 고정. path/descriptor/inode/크기를 검사하고 보호 이름·symlink/hardlink·submodule/위험 Git 설정을 실행 대상에서 제외 또는 명시 차단. 민감한 원본 Git metadata/이력·hook·credential을 사본에 전달하지 않음. 실제 Codex 인증에 필요한 trusted 실행 경계는 따로 유지/검증하며 계정 정보를 모델 입력/명령 환경에 복제하지 않음 |
| 원본 반영 | 새 owner 전용 diff/반영 경로. 서버가 수집한 실제1파일 diff/원래 branch/head·본문 해시/경로·권한 세대와 현재 값을 대조한 뒤 명시 반영. 오래된 승인·변경된 파일·링크/새 보호 경로·다른 job의 결과·과대 diff는 거절. 반영 전후 intent/result·확인한 inode/hash를 보존. 임의 shell/파일 경로를 받는 일반 도구를 만들지 않음 |
| 업무/승인 | `CodexJob.status`의 원격 completed와 ‘원본 반영 대기/적용/충돌’을 구분. 쓰기 업무는 반영 대기나 결과 미확정 상태를 done으로 처리하지 않음. read-only 업무·독립 검토·Store transaction·단일 writer·이전 보고 불변은 유지. 원격 승인과 원본 반영 확인을 같은 완료로 표시하지 않음 |
| 출력·근거 | source에서 알려진 비밀값의 chunk 경계를 포함해 가리고, 유효한 구조화 command/exit metadata와 표시 preview를 분리. 실제 수집 원문은 app state 안의 보호된 private artifact로 보존하고 digest/길이/범위/수집 완료 여부를 기록. 원문이 유실/불완전하면 기존 unknown/blocker로 남김 |
| 원문 조회 | 기존 owner 인증/Host·Origin·범위 검사를 쓰는 job/artifact 기반 분할 조회. 임의 경로/thread 입력과 일반 MCP의 비가림 원문 권한은 추가하지 않음. 감춘 preview와 수집 원문을 UI에서 구분. archive·삭제·자동 만료·사용자 대화 정리는 이번 범위 밖 |

기본24시간/최대7일, 기존 파일1개 반영, source 필터/입력 크기 한도 등은 이 승인안의 구체 제안이다. 지원 불명확한 호스트/버전/파일을 통과로 추정하지 않는다. 모델 API·실계정 호출·실제 사용자 Codex thread 실행·운영 배포는 기존대로 별도 실행 범위를 허용받는다.

## 개발 순서·변경량

아래 A~D는 기존 R6/R8 보완 작업 단위이며 새 제품 페이즈를 만들지 않는다. 파일명 뒤 ‘제안’은 현재 없는 모듈이다.

| 단위 | 변경 파일·심볼 | 데이터/이관 | 수락·증거 |
| --- | --- | --- | --- |
| A 권한 수명 | `model.ts::ExecutionBinding/CodexJob/WorkspaceState.grants`, `http/mcp.ts::McpEndpoint`, `execution/codex.ts::register/submit/start/decide/completeFromTurn/reconcile`, `runtime.ts`, `engine.ts`의 실행 evidence 경계·기존 binding/grant UI | 선택적 권한 version/expiry/출처 metadata·legacy 차단. state/event/command는 같은 Store transaction | 본문 대기 중 회수·cached receipt/만료/세대 변경·늦은 승인·결과·재시작 각 negative에서 무단 dispatch/적용0. active 중단은 실제 원격 종료와 구분 |
| B 보호 사본·반영 | `execution/workspace-protection.ts`·`execution/draft-application.ts` **제안**, 기존 `codex.ts`·`work-execution.ts`·HTTP/실행 상세 UI | 사본 manifest/baseline·diff/digest·owner 반영 intent/result. 과거 job은 사본 완료로 승격하지 않음 | 실제 bwrap에서 가짜 secret·symlink/hardlink/rename·Git 설정 우회와 root 밖 쓰기/네트워크 거절, 일반 source 변경 허용. 원본 동시 변경·옛 승인·불완전 수집·중단 후 미확정은0반영 |
| C 출력/원문 | `execution/evidence-store.ts`·`execution/output-policy.ts` **제안**, 기존 `codex.ts`, `model.ts`, `work-model.ts`, `work-execution.ts`, owner HTTP/상세 UI | private artifact와 선택적 완전성/preview metadata. 원본/공개 digest를 혼동하지 않음 | 모든 chunk 분할 위치의 가짜 key, escaped/Base64/URL 표현·JSON 절단·재시작 공백·cross-job 원문 조회를 검사. 누락을 실행 성공으로 올리지 않고 snapshot/SSE/MCP/보고/Wiki/내보내기 누출0 |
| D 통합/기록 | 기존 codex·work execution·HTTP·crash·browser tests, 별도 hostile fixture **제안**, SSOT/순서/운영/구현 기록 | 기존50 gate/manifest/과거 원문 유지. 상태 사실만 보완 | 단일 writer1·request당 start1·보고/원문 참조1·독립 검토, 1440/390px·재접속/상태 복구. 실계정/호스트 미실행은 NOT_RUN/UNVERIFIED로 구분 |

추정은 고유 **32~45파일·2,600~4,200줄**(구현/기존 접점약12~18·화면/HTTP4~6·검사9~13·문서5~8, 겹침 제외)이다. 단순 차단문 삭제의 규모가 아니다. 선택1파일 반영으로 여러 파일/충돌 병합·Git broker 구현을 앞당기지 않는다. 호스트/버전·아직 없는 artifact/사본 계약 때문에 오차가 있으며 범위를 넘는 추가 계약이 필요하면 다시 보고한다. 현재 권한 stale 객체 수정은 별도2파일의 기존 계약 버그 수정이다.

## 현재·후속 페이즈 영향

| 페이즈 | 영향 |
| --- | --- |
| R1 영속 Core | additive metadata/marker·private artifact 수명. startup에서 미래/손상/legacy 상태를 fail closed, 원문/receipt 삭제 없음 |
| R2 실행 루프 | 권한·원문 완전성·반영 대기 상태가 readiness에 추가. 단일 dispatch/미확정 대조/자동 재전송 금지 유지 |
| R3 GUI | 기존 실행 상세 안에 만료·회수·diff/반영 확인·원문 페이지/생략 상태 추가. 흑백 단톡방 구조/승인/복구 기능 유지 |
| R4 연결 | GPT/API/dot/Muse 로그인/메모리 계약 변경0. 기존 Codex binding만 명시 재등록/만료 안내 필요 |
| R5 작업큐 | 쓰기 업무의 remote completion과 원본 반영/독립 수락을 분리. 분석/읽기 전용 완료는 기존대로, 옛 report/digest 불변 |
| R6 실제 업무 | 핵심 보완. 검증된 사본/권한/원문/반영 gate가 없으면 현재 쓰기 차단을 유지. 사용자 승인만으로 OS 검사를 통과시킬 수 없음 |
| R7 Wiki | 가려진 공개 보고와 원문 참조/미확인/반영 상태만 게시. private 비밀/소유자 전용 원문은 Wiki/참여자 입력으로 복제하지 않음 |
| R8 통합 수락 | 기존50 gate를 낮추지 않고 hostile/권한/복구/반영 검사 추가. 실제 Codex 읽기→승인→작은1파일 변경→재검토는 구현/검사 뒤 별도 실행 허용 |
| 선택 Writer·후속 | 자동 commit/push/PR·여러 파일 쓰기·자동 병합·동시 실행·archive/삭제는 이번 제품 변경에 포함하지 않음 |

## 복귀·미결정

G0처럼 방/주제의 새 예약을 멈추고 queued 취소·active/승인/미확정·반영 intent를 대조한 뒤 quiescent 상태에서 이전 binary로 복귀한다. 기존 권한/receipt/원문 artifact·사본/반영 실패·대화/사용량을 보존한다. DB 초기화·credential 재생성·격리 해제·확인되지 않은 apply/turn 재시도로 복구하지 않는다. private 사본의 변경이 원본 반영으로 확인되지 않았으면 수정 완료로 표시하지 않는다.

**승인 기록:** 2026-11-07 사용자 “보호 사본·명시 반영까지 개발 승인”. 권장안 및 위 만료/legacy/원문 조회/반영 metadata·API/UI의 최소 계약을 구현한다. 실제 미지원 호스트/도구는 차단하며 실계정·배포는 포함하지 않는다.

## 구현 중 확인한 호스트 조건 (2026-11-07)

PR #56 병합 main `6526279`(첫 수정 `edb9b0a`와 동일 source tree)으로 기준을 갱신했다. 실제 원본 반영은 단일 writer·descriptor baseline 확인과 durable intent/receipt 안에서 구현했고, 같은 OS 사용자의 비협조적인 writer에 대한 kernel atomic CAS는 제공하지 않는다. 감지된 경쟁/부분 쓰기·기록 실패는 미확정으로 보관하며 외부 편집/동시 CLI 중단 조건을 유지한다.

검증 실행 환경의 AppArmor가 외부 bwrap 안의 Codex namespace 생성을 거절했다. 개별 외부 격리/프로필 canary PASS와 결합 runtime proof SKIP/BLOCKED를 구분한다. 쓰기 gate를 유지하고 호스트 정책/권한은 변경하지 않는다. 실계정/운영 적용·실제 파일 수정 수락은 여전히 NOT_RUN이다. 이는 수락 완화/격리 해제 승인이 아니며 [구현·검사 기록](../implementation/execution-protection-20261107.md)을 따른다.
