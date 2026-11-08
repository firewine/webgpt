# R6 명령 1회 승인 병합본 — 운영 적용·실계정 수락 기록

상태: **운영 적용 PASS, 별도 검증 저장소의 R6-F 읽기→승인→재작업/쓰기→원본1파일 반영→소유자 독립 수락 PASS.** 실제2job과 최종 수락까지17분5초, 업무는 `done`이다. 첫 A-run의 중단1job은 보존하며 B-run의 완료2job과 합쳐 성공으로 세지 않는다. 사용자가 서버 적용/실계정 검증과 각 명령·재작업·실제 diff 반영·최종 수락을 승인했다. 기준 main은 PR #60 merge `f911c593466cdfffbc159c92d83586e08d05257a`, 검사한 PR head는 `402e72ec9dbacfbd585118516ad90733b609d53c`이다. 계획·호스트 설정·제품 코드 변경0이며, 원래50 gate 기준을 낮추지 않았다. [비밀을 제외한 실제 수락 증거](./assets/r6-live-20261108/acceptance.json)를 따른다.

## B-run 실제 수락 — 최신 결과

사용자가 추가2job/30분·정확한 읽기 명령을 승인한 뒤 수행했다. 읽기 보고를 확인한 사용자에게 재작업/쓰기 명령, 실제1파일 diff 반영, 최종 독립 수락을 각각 받았다. 재작업 승인에는 남은 쓰기1개·승인 후 최대30분을 명시했으며 실제 전체 수락은 첫 read 생성부터17분5초 안에 끝났다. job당300초 제한과 동일 Store/권한·보호 사본·한 파일 반영 계약은 유지했다.

| 흐름/검증 방법 | 실제 관측·판정 |
| --- | --- |
| 읽기 / journal·capture·보고 | 13:00:12 KST 시작,13:01:01 완료. `/bin/bash -c 'cat validation.txt'`1회·출력 `R6_BASELINE`·실제 exit0·capture complete·readCopy checked. 승인 선택/전송/결정 각각1회, 원본 불변·보고1개 게시 |
| 소유자 재작업 / review API·입력 원문 | 첫 보고 digest에 대한 owner rework1회. 두 번째 입력에 이전 보고 원문/동일 digest와 반려 의견1개 포함. 같은 binding/thread·새 write authority epoch 유지. task update로 보고 연결을 지우지 않음 |
| 보호 쓰기 / journal·capture·diff | 13:06:04 생성,13:07:44 완료. `printf "R6_VERIFIED\n" > validation.txt && cat validation.txt`1회·출력 `R6_VERIFIED`·실제 exit0·capture complete. 승인한 명령과 CLI의 정확한 셸 인용 표시를 대조. 사본 변경1파일·반영 전 원본 `R6_BASELINE`, 쓰기 보고 보류 |
| 원본 반영 / draft·apply API | 실제 diff1파일을 제시해 사용자 승인. 13:13:30 receipt1개, `codex.application_intent`1/`codex.application_completed`1. 전후 SHA256이 실제 바이트와 일치. Git 변경은 `M validation.txt` 하나·최종 원본 `R6_VERIFIED` |
| 최종 보고·독립 수락 / review API | 반영 후 두 번째 보고 게시. 실제 명령 수락 기준 observed_pass·blocker0·원문/명령 산출물 참조 존재. 13:17:17 사용자 최종 수락을 owner accept로 기록, task done/version9. 보고 작성자와 reviewer가 다르고 reviews는 rework1→accept1 |
| 횟수 / Store journal | B-run 실제 job/request2개·명령2개·각 exit0·capture2개 complete. 승인 selected/sending/decided 각각2개·원본 반영1개·보고2개. 준비/보호 proof의 합성 thread/turn은 실제 모델 job 수에 포함하지 않음 |
| 종료·보존 / private 증거·서비스·백업 비교 | 검증 방off·binding 회수·runtime lock/임시 auth 제거·원래 auth byte 불변. 운영 `.env`/접속 자료·비밀번호·API 한도·연결/참여자·토의 전체 보존, 원래 binding/job0·Chrome잠금·NoNewPrivileges=yes·4090 health200 |

사용자가 확인한 실제 변경은 다음 하나다.

```diff
--- a/validation.txt
+++ b/validation.txt
@@ -1,1 +1,1 @@
-R6_BASELINE
+R6_VERIFIED
```

모델의 쓰기 보고는 원본 반영 전에 작성돼 “원본 미반영” 문구를 그대로 보존했다. 원본 반영 사실은 이후 실제 receipt와 파일 digest로 별도 관측했고, 소유자에게 이 구분을 설명한 뒤 독립 수락을 받았다. 모델 보고를 실행/반영 성공 증거로 바꿔 쓰지 않았다. 다른 provider/dot/Muse 호출과 Codex의 Git 자동화는0이다. 임시 Git baseline 생성은 준비 작업이며 모델의 자동 commit으로 세지 않는다.

## 승인 범위·보존

기존 [명령1회 승인 보완](./r6-scoped-command-approval-20261107.md)과 [R6 수락 순서](./r6-readonly-session-20261107.md)를 그대로 사용한다. 별도 private Git/state/구독 인증 스냅샷에서 최대2job/30분, job당300초이며 준비용 모델 호출0이다. 읽기 보고→실제 소유자 재작업 요청→동일 binding/thread의 보호 쓰기→실제1파일 diff/소유자 반영 확인→소유자 독립 수락 순서다. 다른 provider/dot/Muse 호출·자동 Git commit/push/merge는 검증 실행에 포함하지 않는다.

운영 DB는 비공개 online backup을 보존하고 기존 운영 브랜치 `f648ea5`도 유지했다. 운영 폴더를 새 `ops/r6-live-20261108` 브랜치에서 병합본으로 빌드·재시작했다. 기존 `.env`·소유자 접속 자료·연결7개·참여자11개·토의5개·binding/job0·방 off·Chrome 잠금이 적용 전후 일치했고4090 health200을 확인했다. 사용자 untracked 파일을 덮어쓰지 않았다. 기존3000 포트/다른 서비스·Tailscale Serve/사용자 unit·전용 AppArmor/stock bwrap·전역 설정은 바꾸지 않았다.

구독 인증은 유효한 access snapshot만 별도0600 파일에서 사용하고 refresh token은 복제본에서 비워 원래 계정 인증 갱신을 피한다. 원래 인증 원본과 대화 이력을 변경하지 않으며 provider vault/사용자 대화는 검증 Git/state에 복사하지 않는다. 종료 시 복제 auth 파일을 제거하며 원래 인증의 변화 여부를 별도로 대조한다. 인증/비밀번호/API 키와 개인 대화 원문은 이 기록에 넣지 않는다.

## 운영 적용·A-run 중단 증거 — 보존

| 검증 방법 | 관측·판정 |
| --- | --- |
| GitHub/실제 저장소 | PR #60 MERGED, main `f911c59`; 기존 CI SUCCESS(Node826 PASS/6 SKIP, 전체 Chromium99 PASS/0 SKIP). 소스 tree를 바꾸지 않고 적용 |
| 빌드·서비스/읽기 전용 DB 비교 | `npm run build` PASS, `systemctl --user` active·NoNewPrivileges=true·4090 health200, 위 운영 보존 항목 모두 일치 |
| 적용본 native 선행 검사 | 실제 Codex0.166.0 + 승인된 전용 outer의6건 **PASS/0 SKIP**. 등록/기존 proof/명령 승인 후 정상·추가 실행×read/write 보호 및 실제 controller read/write 사본→명시1파일 반영을 가짜 Responses/임시 Git으로 확인. 실계정 수락과 구별 |
| 설치기 읽기 전용 check | 비root 사용자의 `/sys/kernel/security/apparmor/profiles` 읽기는 EACCES. 이 항목은 UNVERIFIED이며 설치/호스트 변경을 다시 수행하지 않았다. 실제 결합/승인 후 보호는 바로 위6건으로 별도 증명 |
| 실계정 준비 | 동일 서버의 실제 구독 계정을 `account/read(refreshToken:false)`로 확인. 기존 이력 복사/준비 모델 job0, 새 검증 Git의 `validation.txt`는 `R6_BASELINE` 한 줄 |
| 첫 실계정 요청 | 11:41:17 KST 업무 큐에서 읽기 job1개 시작. 실제 thread/start1→같은 연결 turn/start1, real resume0. native `/bin/bash -c 'cat validation.txt'` 명령의 scope ready를 확인하고 정확한 명령/위치/읽기 전용 범위를 소유자에게 제시. 별도 승인 후 proof의 합성4개 thread/turn과 이 실제1job을 구분 |
| 명령 확인·중단 | 승인 응답 전11:46:17 KST의300초 deadline 도달. interrupted·`codex_turn_not_completed`, command exit/output null·ACCEPT 전달0·쓰기/반영0. capture complete는 중단까지의 기록 수집 완료이며 실행 성공이 아님. 검증 파일은 `R6_BASELINE` 그대로, task blocked |
| 실제 확인 화면 추가 점검 | 별도 검증 state에 비밀번호가 설정돼 있지 않아 웹 UI가 초기 설정 화면을 유지, 명령 화면 실측은 UNVERIFIED. 운영 비밀번호는 백업과 동일하며 초기화/변경0. 이 보조 점검 실패를 기존 Chromium99 PASS나 실제 명령 성공으로 세지 않음 |
| 종료/복귀 | 검증 방off·binding 회수·복제 auth 제거, 원래 auth byte 변화0. 운영 비밀번호·API 한도·연결/참여자·토의 전체가 백업과 동일, 원래 binding/job0·Chrome잠금·health200. 이전 요청/원문/사본·private 증거는 유지 |

별도 검증 서버/화면은 loopback만 사용하며 운영의 root allowlist를 늘리지 않는다. private 실행기에서도 현재 job/request와 명령 범위를 고정해 기존 HTTP 승인 계약을 사용한다. 승인 대기 중 방을 끄면 원래 세대가 무효화되므로, 동일한 on 상태를 유지하되 다른 provider 호출을 차단한다. read 보고가 게시된 뒤에만 방 off·owner rework를 수행한다. 기존 binding은 revoke 후 같은 canonical cwd/thread로 다시 등록해 ID를 유지하고 새 write authority epoch를 발급하며, task update로 이전 보고/반려 연결을 지우지 않는다.

## A-run 종료 당시 남은 수락·복귀 — 이력

아래는 A-run 종료 당시의 보존 기록이다. 이후 추가 승인과 B-run 실제 수락은 위 최신 결과에서 완료했다.

실제 읽기 출력/정수 exit·완전 capture/readonly 검사, 소유자의 digest가 고정된 재작업, 쓰기 원문/동일1파일 diff·명시 반영 영수증·독립 수락이 아직 필요하다. 모델 응답만으로 성공 처리하지 않으며 native 명령 승인/원본 반영을 소유자 대신 자동 확인하지 않는다. 만료·오류 시 원래 job/thread/turn·원문·사본을 보존하고 자동 재전송하지 않는다. 호출/시간 한도 확대나 새 호스트/계획 변경은 별도 보고·승인을 따른다.

중단1job 보존 후 **추가 최대2job/30분**과 새 검증 위치의 정확한 읽기 명령1회에 대한 별도 승인을 요청했다. 새 위치는0model job으로 준비만 하고 auth 제거/연결 종료했으며 답변 전 재호출하지 않는다. 새 승인이 오면 제시한 명령·위치·읽기 범위와 실제 요청의 일치를 확인한 경우에만1회 승인한다. 쓰기·원본 반영/독립 수락은 실제 산출물을 제시한 뒤 각각 확인한다. 이는 새 호출 창 요청이며300초 제한·명령 seal·기존 계획/호스트 정책을 완화하는 변경이 아니다.

종료 시 검증 방 off·진행 turn 중단/대조·binding 회수·private 복제 인증 제거와 운영 서비스/기존 데이터 보존을 확인한다. 원본 `validation.txt` 반영은 제시한 실제 diff와 소유자의 명시 확인을 받은 경우에만 수행한다. 실제 관측이 끝나기 전 기존 R6-F/50 gate를 PASS로 바꾸지 않는다.

## 최신 판정·후속 범위

위 B-run은 원래 R6-F의 설치 계약·읽기→승인→작은 작업 브랜치 수정→보고/반려/후속 흐름을 별도 검증 저장소에서 충족한다. 2026-10-31의50개 fixture manifest는 과거 판정으로 보존하고 최신 real 판정은 이 날짜별 증거/SSOT에 둔다. R8 전체 혼합 최종 수락·장기 운영·실기기 GUI·후속 선택 범위를 이 결과로 완료 처리하지 않는다. 운영에서 새 실제 작업 경로/권한을 열려면 그 범위를 구체적으로 확인한다.

검증용 단발 operator의 통신 유실/기한 종료 후 재개를 제품 기능으로 추가하지 않았다. 모호한 승인/적용은 원래 request·intent/receipt·파일로 대조하고 자동 실행/반영하지 않는다. 이번 성공 흐름에서는 해당 유실 문제가 발생하지 않았다.
