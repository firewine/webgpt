# R6 후속 영향안 — 보호 범위를 유지하는 명령 1회 승인

상태: **제안 / 사용자 승인 전 / 새 승인 기능 미구현.** 현재 승인받은 읽기 보호·새 세션 보완의 실계정 검증에서 발견한 후속 차단 조건이다. 현재 보호 승인 차단은 유지한다. 이 문서를 작성하는 것으로 계획·제품 계약이나 실제 호출 한도를 바꾸지 않는다.

## 관측과 원인

검증 소스 `8fc2d1bd6f810b9cf9fee345f231d037bd7a6170`의 실제 Codex0.166.0에서 새 `thread/start`와 최초 `turn/start`가 **같은 연결에서 각각1회**, resume0으로 전달됐다. 도구가 `/bin/bash -c 'cat validation.txt'`의 `item/commandExecution/requestApproval`을 요청했다. `availableDecisions`에 plain `accept`, prefix rule을 저장하는 `acceptWithExecpolicyAmendment`, `cancel`이 있었다. 원격 종료 요청 후 `interrupted`, capture complete, 명령 exit/output null, 원본 `R6_BASELINE` 유지, 업무 report0을 확인했다. 실제 파일 읽기/쓰기·반영 성공의 증거는 아니다.

`src/execution/codex.ts::decide`는 draft/readCopy의 ACCEPT를 `protected_approval_requires_scoped_support`로 막는다. 보호 상태를 추가한 승인안이 유지하기로 한 경계이므로 이번 실검증에서 제거하지 않았다. `untrusted`를 바꾸거나 CLI에 직접 ACCEPT를 보내는 우회도 하지 않았다. 현재 요청은 취소·권한 회수했고 원래 job/원문을 보존했다.

설치 버전과 같은 공식 소스 [ToolOrchestrator](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/orchestrator.rs)의 `run`은 승인 뒤 `sandbox_override_for_first_attempt`와 `for_approved_command`에 따라 별도 실행 범위를 만들 수 있다. 따라서 **plain ACCEPT가 기존 최소 profile을 그대로 유지한다는 것은 UNVERIFIED**다. 현재 canary PASS만으로 승인 후 실행까지 안전하다고 주장할 수 없다.

## 제안과 변경량

**예상16~20파일·900~1,400줄**(실제 CLI의 local fake Responses 증명 fixture·회귀 검사·문서 포함). 호스트 파일/전역 설정·OAuth/계정·provider·DB 서버 추가0. 기존 read/write 사본, Store transaction, authority/room epoch·단일 실행·원문/미확정 대조, 1파일 명시 반영·독립 검토를 유지한다. 새 명령1회 승인만 별도 보완하며 steer·영구 prefix rule·네트워크 허용·프로필 밖 권한은 계속 차단한다.

| 단계 | 변경 대상 / 신규는 제안 | 계약·완료 조건 |
| --- | --- | --- |
| A 승인 후 보호의 실제 무호출 증명 | 기존 `src/execution/isolation.ts::ExecutionIsolation`, `tests/execution-isolation.test.mjs`; 실제 CLI+local fake Responses fixture **제안** | 외부 모델/사용자 인증0으로 실제 App Server의 승인 요청→plain ACCEPT를 재현. read/write profile별 auth/state/Chrome·원본·proc/fd·network·추가 namespace canary와 read 사본 쓰기0을 승인 뒤에도 검사한다. 모든 항목 PASS/0 SKIP인 CLI/profile/호스트 조합에서만 뒤 단계 허용. 보호 확대나 지원 불가가 관측되면 여기서 BLOCKED, 제품 ACCEPT 유지 차단 |
| B 요청 범위 고정·전송 기록 | 기존 `src/execution/codex.ts::approval/decide`, `authority.ts`, `workspace/model.ts`; 승인 정책 모듈 `src/execution/approval-policy.ts` **제안** | 보호 job의 확인 가능한 command 요청만 후보로 삼는다. 원래 method/RPC ID·job/thread/turn/item·command/cwd·profile·권한/room/task 세대를 원래 수신 시 고정한 digest로 묶는다. 프로필 밖 권한/정책 변경·알 수 없는 필드·표시가 달라져 명령을 확정할 수 없는 경우·fileChange 승인은 거절. owner의 같은 digest에 대한 명시 확인과 A의 proof가 모두 있어야 plain ACCEPT1회 전송. 선택/전송 intent를 먼저 같은 Store에 기록하고 timeout/crash는 미확정 대조, 자동 승인/재전송0 |
| C 소유자 확인 화면/API | 기존 `src/http/workspace.ts`의 jobs approve, `src/web/control.ts::renderExecution`, room의 실행 상세 `src/web/room-view.ts` | 기존 legacy 승인 계약은 보존한다. 보호 command는 기존 인증/승인 API 위에 expected digest·명시 확인을 추가하는 안으로 설계하며, 해당 명령·작업 위치·범위를 읽은 뒤 ‘이 명령 1회 승인’. 두 탭·늦은 UI·회수/만료 후 승인0. write 사본의 원본 반영 확인은 별도 유지. 새 endpoint가 필요하면 구현 전에 다시 근거/범위를 보고 |
| D 회귀·후속 실환경 수락 준비 | 기존 managed/protection/room/browser 검사와 R6 문서/SSOT | 성공·원문 불완전·추가 권한·미확인 native 필드·소유자 미확인·중복/늦은 승인·restart 미확정/재전송0을 검사. 전체 `npm run check`, 관련 Chromium, A의 실제 CLI canary 결과를 구분 기록. 읽기→보고/소유자 재작업→write 사본→소유자1파일 반영→독립 수락은 새 실검증 승인 후 수행 |

데이터는 기존 JSON에 optional 승인 범위/선택·전송 기록을 추가하는 제안이며, SQL·기존 job/approval/receipt는 재작성하지 않는다. 미래/손상/유실 metadata는 차단하고, 과거 승인 요청에 새로운 승인 권한을 자동 부여하지 않는다. 정확한 필드·이관 전이는 승인 후 구현 설계로 고정한다. 기존 digest/권한/single dispatch helper를 재사용하며 별도 승인 엔진이나 모델 판정기를 만들지 않는다.

## 후속 페이즈와 복귀

- R1: optional metadata와 동일 transaction journal. 과거 기록/권한의 자동 승격0.
- R2/R5: 방 off·역할 회수·task 변경 이후 늦은 승인0, 단일 writer/원래 업무 attempt 유지.
- R3/R4: 명령1회 확인 UI만 보완. GPT/dot/Muse 연결·채팅방·로그인 정책 변경0.
- R6: 승인 **후** 실제 보호 proof가 새 선행 조건이다. plain ACCEPT도 proof 실패/UNVERIFIED면 차단. 기존 R6-F/50 gate를 낮추지 않는다.
- R7: 종료 코드·원문·반영 receipt와 별도 owner 리뷰가 있어야 기존 업무 보고/Wiki 근거로 사용. 승인 수신을 실행/검증 성공으로 올리지 않는다.
- R8: 중복·crash·미확정·기한/회수·두 화면의 동일 요청 검사를 확장한다.

복귀는 새 승인/dispatch를 멈추고 원래 RPC 요청·선택 intent·turn/결과를 대조한 뒤 현재처럼 보호 ACCEPT 차단으로 돌아간다. 이미 보낸 승인을 취소됐다고 추정하거나 원문/사본을 지우지 않는다. 새 승인 proof 실패를 호스트 설정 확대나 전역 격리 해제로 해결하지 않는다.

## 사용자 결정 필요

권장: A의 실제 무호출 승인 후 보호 증명을 선행 조건으로 한 **계획 개정·개발**. 증명 실패 시 제품의 명령 승인은 계속 차단하고 근거를 보고한다. 현재 계약을 유지하는 대안은 추가 개발0이지만 R6-F는 BLOCKED다. `untrusted` 해제·무조건 ACCEPT·영구 prefix 허용은 제안하지 않는다.

이번 제안에는 추가 실계정 호출·배포가 포함되지 않는다. 이미 사용한 실계정1job은 중단 기록으로 보존하며 완료로 세지 않는다. 후속 실제 읽기/재작업 수락을 위한 새 호출 창과 구체 명령·반영/리뷰는 구현·검사 후 별도 확인한다.
