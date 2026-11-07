# R6 최소 읽기·새 세션 — 구현/검사와 실제 수락

상태: **사용자 “읽기 보호·새 세션 보완 개발 승인”, 구현·자동 검사/실제 무호출 보호 PASS. 실계정1job이 명령 승인 단계에서 중단, R6 전체 수락 BLOCKED.** 기준은 PR #58 head `6f01d3005dbeb544076bdccb73a7739b8bc6856d`이며 작업 브랜치는 `codex/r6-readonly-session-20261107`이다. PR #58은 착수 시 미병합이어서 그 위에 후속 변경을 분리했다. [승인 영향안](../reviews/r6-readonly-session-impact-20261107.md), [SSOT](../development-plan.md), [기존 호스트 예외](./r6-apparmor-20261107.md)를 따른다.

## 계약과 상태

| 경계 | 구현/유지 |
| --- | --- |
| 읽기 | `webjjoku_read` named profile: root deny/필요 runtime read/정제 사본 read/auth·state·Chrome deny/network off. 외부 mount도 사본 readonly. 실제 Workspace는 `protectRead:true`를 주입하며 legacy readonly binding은 재등록 전 차단. 내부 직접 생성 adapter의 기존 계약은 유지 |
| 등록 API/화면 | `/api/bindings`의 optional `sessionMode=existing\|new`, 기본existing. 기존은 threadId 필수, 새 세션은 threadId 동시 입력 거절. 소유자가 명시 선택하고 원래 형식/수명/allowWrite를 유지 |
| 새 세션 | 서버의 `thread/start` 응답 ID만 등록. 최초에는 생성한 실제 RpcProcess와 준비 사본 ID를 메모리에 고정. 준비 사본 ID를 첫 job ID로 사용해 동일한 mount/연결을 유지. 첫 dispatch 전 원본 HEAD·권한·manifest 대조. 최초1회만 resume 없이 start, 이후 원래 thread/resume 경로 |
| 영속 상태 | optional `readProtection:1`, `managedSession{version:1,state:initial/dispatched/lost,firstRequestId}`, job `readCopy{version:1,status:preparing/running/checked/blocked,manifestDigest,reason}`. Store/SQLite version과 transaction 유지. 새 metadata의 미래/손상/marker 유실 거절 |
| 수락/복구 | 최초 request ID를 전송 전 transaction에 기록. 초기 연결 유실/재시작은 lost/blocked, 다른 새 thread로 재전송0. 아직 실행되지 않은 lost 세션만 소유자의 명시 새 등록으로 교체 가능. queued 취소/권한 만료도 초기 연결을 닫음 |
| 결과/승인 | readonly terminal 뒤 사본 unchanged/manifest·capture를 확인할 때까지 업무 보고를 보류. 게시 직전에도 봉인 manifest의 무결성·digest와 원문 capture를 다시 대조한다. 손상/변경/불완전 원문은 차단. readCopy의 추가 권한 ACCEPT/steer도 write draft와 같이 차단. 쓰기 diff/1파일 명시 반영과 독립 리뷰는 기존 경로 |

첫 사본은 새 세션 등록 때 고정된다. 첫 요청까지 원본이 바뀌어도 새 파일/비밀을 늦게 사본에 추가하지 않는다. 그 사이 HEAD가 바뀌면 차단하며, 원본 내용을 새로 반영하려면 소유자가 재등록한다. 첫 실행 이후의 job은 기존 절차로 새 사본을 준비한다. 불분명한 첫 dispatch는 같은 요청/실제 thread/turn을 대조하며 준비용 모델 호출로 materialize하지 않는다.

디자인은 기존 runtime의 작은 의존성 주입·Store transaction·권한 digest/상태 전이를 재사용했다. 세션 상태 변화는 현재 job의 권한 digest를 무효화하지 않으며, 읽기 범위/세션 출처 버전은 안정적인 digest에 포함한다. 별도 DB/broker/로그인/호스트 정책은 추가하지 않았다.

## 검사와 실제 관측

승인 시 예상은10~16파일·600~1,000줄이었고 최종 변경은21파일·약750줄(추가/삭제 합계, 검사·문서 포함)이다. 파일 수 증가는 기존 빠른 재로그인 경쟁의 회귀 검사, 두 실행 화면의 readCopy 제어 일치, 운영 절차와 별도 후속 영향안의 기록을 포함한다. 기존 backend/Store·권한·예산·승인 차단 계약을 유지하는 보완이다.

환경: Ubuntu26.04.1 LTS, Node24.18.0/npm11.16.0, Codex0.166.0, bwrap0.11.1. 전용 AppArmor 파일/정책은 PR #58에서 승인·설치된 것을 그대로 사용했다.

| 검사 | 관측 |
| --- | --- |
| `npm run check` | strict TypeScript/빌드, 최종 Node759건 중757 PASS/FAIL0/SKIP2. 기본 경로의 결합 namespace와 명시 opt-in 실제 등록 검사는 SKIP; 아래 호스트 실행과 구별 |
| 새 수명/읽기 fixture | 13 PASS: 생성0turn, 최초 same process/후속resume, 초기 disconnect·restart/전송 전 실패와 명시 재등록, 미래 상태/marker 유실, 추가 권한/steer, 사본 유실/변조/변경·원문 유실, 검사 후 게시 전 봉인 manifest 유실/변조, 명시 대조 시 원래 사본 재검사/재전송0 |
| 실제 호스트 opt-in | **2 PASS/0 SKIP**: readonly까지 포함한 combined proof, 실제 App Server 새 세션 등록/초기 상태/모델 job0. 가짜 인증·임시 Git만 사용 |
| 화면 | 관련 Chromium19 PASS/0 SKIP(실행 보호11·로그인3·업무 실행5): 기존/새 선택·thread 필수/제외·유실 안내, 조회 지연 로그인, 두 실행 화면의 readCopy 승인/steer 차단과 기존 복구/diff/원문 화면 |
| 실제 사용자 계정·모델/원본 반영 | 새 readonly 세션·subscription account 확인과 최초1회 전달 PASS. 실제1job은 명령 승인 대기에서 중단, 명령/원본 반영 NOT_RUN. 아래 실측 참조 |

실제 무호출 등록에서 CLI의 AGENTS 읽기 helper가 중복된 ‘가려진 부모/자식’ 경로를 준비하다 readonly 부모 아래 mkdir로 실패했다. 부모 mask가 이미 덮는 자식 mask를 제거하도록 정규화했고 실제 등록이 통과했다. 보호 범위는 그대로 부모 전체를 가린다. 또한 write canary가 사본에 만든 비밀 아닌 임시 `.env`를 읽기 canary 전에 정리해 두 경계를 독립 검사한다. 실제 호스트의 원래 secret은 읽거나 수정하지 않았다.

독립 검토에서 readonly 검사 완료 뒤 manifest가 유실/변조되면 보고 게시 전 다시 확인할 필요가 있음을 발견했다. 게시 시 봉인 검증과 기록된 digest 대조를 추가하고 두 회귀 검사를 통과했다. 별도 실계정 준비에서는 새 세션 등록과 readonly metadata 저장이 성공했으나 `account/read(refreshToken:false)`가 거절돼 모델 전송 전에 중단했다. 준비 실패 DB는 별도로 보존했고 실제 모델 job은0이다.

계정 거절의 원문은 `workspace routing discovery timed out`이었다. 동일 계정의 공식 accounts 메타데이터 조회는 호스트에서 HTTP200이었고, Ubuntu의 `/etc/resolv.conf`는 `/run/systemd/resolve/stub-resolv.conf`를 가리켰다. 외부 실행기가 `/run`을 가릴 때 이 파일까지 사라지는 것을 보완해 해당 시스템 파일 하나만 readonly로 보존한다. 호스트 파일/정책 변경은0이며 모델 도구의 network-disabled profile은 유지한다. 실제 외부 실행기에서 resolver 내용 일치와 기존 결합 read/write 보호2건 PASS/0 SKIP을 확인했다. 이후 별도 세션에서 subscription account 확인도 성공했고 원래 인증 파일 변화0·모델 job0을 확인했다.

CI의 기존 비밀번호 화면 검사에서 로그아웃 직후 인증 상태 조회가 끝나기 전에 다시 제출할 수 있는 경쟁을 관측했다. `loadLogin` 시작 시 제출 버튼을 잠그고 현재 조회 완료 시만 다시 열도록 보완했다. 동일 기존 browser 검사에 `/api/auth` 응답을 보류하는 재현을 추가해, 대기 중 제출 차단과 이후 정상 로그인을 함께 검사한다. 비밀번호 정책/서버 인증/계정 정보 계약은 바꾸지 않았다.

readonly의 명시 재조회도 원래 보호 사본을 재검사하고 같은 사본을 연결한다. 보호 재검사 실패 시 legacy 연결로 돌아가지 않으며, restart로 불완전해진 capture는 완료된 원격 turn을 조회하더라도 자동 게시하지 않는다. 추가 보호 승인/steer의 backend 차단과 화면 제어를 readCopy에도 일치시킨다.

## R6 실제 검증·운영과 복귀

승인된 수락 순서는 별도 normal Git repo/state/전용 Codex home에서 실제 read job → 원래 보고를 소유자가 확인·재작업 요청 → 보호 write job → 실제 diff 제시/소유자1파일 반영 → 실제 owner 독립 검토다. 최대2job/30분, job당300초를 유지하고 준비용 모델 호출0이다. 별도 provider/API·dot·Muse 호출/자동 Git commit·push·merge/운영 DB·방·Serve 변경은0이다. 구체 command 승인/반영/owner 검토는 실제 결과를 제시한 뒤 기록한다. 설치된 CLI 구독 인증의 실행에 필요한 자료만 전용 home에서 사용하고 원래 인증·세션 이력을 변경하지 않는다.

### 2026-11-07 실제1회 전달과 명령 승인 차단

실검증 소스는 CI 통과 `8fc2d1bd6f810b9cf9fee345f231d037bd7a6170`이다. 해당 CI는 Node758건 중756 PASS/2 SKIP, 실제 Chromium86 PASS/0 SKIP이었다. 실제 호스트 canary2 PASS/0 SKIP은 별도 결과다. 이후 readonly 재조회/화면 일치 보완의 최종 회귀 결과는 위 검사 표에 따로 기록한다.

| 흐름 | 실제 관측·판정 |
| --- | --- |
| 계정/새 세션 | 전용 home에서 `account/read(refreshToken:false)`의 subscription account 확인. 새 thread/start1과 최초 turn/start1이 같은 RPC connection1, resume0. 기존 사용자 thread 재사용/준비용 모델 호출0 |
| 실제 요청 | 21:08:58 KST 시작, 최대2job/30분 중1job만 사용. 업무 큐의 원래 attempt/request1개에 연결. 다른 provider·dot/Muse 호출0 |
| 읽기 명령 | `/bin/bash -c 'cat validation.txt'`의 native `item/commandExecution/requestApproval`을 수신. 보호 job의 ACCEPT는 기존 `CodexExecutor.decide` 정책으로 차단되므로 승인 우회/정책 완화0 |
| 실행/중단 | 방 off 후 실제 turn/interrupt로 `interrupted` 확인. capture complete는 중단까지의 기록 수집 완료를 뜻한다. 명령 exit/output은 null, 실제 파일 읽기/수정·성공 보고0 |
| 파일/운영 보존 | 별도 원본은 `R6_BASELINE` 그대로. 검증 권한 회수·전용 auth 사본 삭제·원래 auth byte 변화0. 운영 DB의 binding/job0, 방off/Chrome잠금과 HTTP health200 유지 |
| 남은 수락 | 실제 명령 승인/종료·read 보고/재작업·write 사본·소유자 반영/독립 리뷰는 NOT_RUN. R6-F 전체는 BLOCKED. 기존50 gate를 완료로 바꾸지 않음 |

현재 요청/원문/사본·중단 기록은 별도 검증 state에 보존했고 자동 재전송하지 않는다. 명령1회 승인 지원은 [별도 영향안](../reviews/r6-scoped-command-approval-impact-20261107.md)의 **미승인 제안**이다. plain ACCEPT 이후 실제 CLI가 어떤 보호 범위를 쓰는지는 UNVERIFIED이므로, 후속안은 무호출 증명을 선행하며 실패하면 현재 차단을 유지한다. 이번 검증을 반복하거나 추가 호출 창을 자동 연장하지 않는다.

초기 managed 세션을 잃으면 원래 요청을 보존하고 명시 재등록을 요구한다. 새 dispatch를 막고 실제 active/미확정·queued·적용 intent를 원래 ID로 대조한 뒤 복귀한다. 새 JSON/receipt·원문/사본을 삭제하지 않는다. 이전 실행기로 내려갔을 때 새 보호 상태를 legacy 실행 성공으로 승격하지 않는다. 원래 R6-F/50 gate를 완화하지 않으며 관측되지 않은 추가 명령 승인·전체 혼합 운영은 미완료로 남긴다.
