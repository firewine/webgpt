# R6 명령 1회 승인 병합본 — 운영 적용·실계정 수락 기록

상태: **운영 적용 PASS. 실계정 첫 읽기 요청은 명령 확인 대기 중300초 제한으로 interrupted, 실제 명령 실행0. 전체 R6-F 수락은 BLOCKED.** 사용자가 “머지 완료. 서버에 적용하고 R6 실계정 읽기→쓰기→원본 반영 검증 진행”을 지시했다. 계획/호스트 설정 변경은 영향과 변경량 보고 후 승인한다는 조건을 유지한다. 기준 main은 PR #60 merge `f911c593466cdfffbc159c92d83586e08d05257a`, 검사한 PR head는 `402e72ec9dbacfbd585118516ad90733b609d53c`이다.

## 승인 범위·보존

기존 [명령1회 승인 보완](./r6-scoped-command-approval-20261107.md)과 [R6 수락 순서](./r6-readonly-session-20261107.md)를 그대로 사용한다. 별도 private Git/state/구독 인증 스냅샷에서 최대2job/30분, job당300초이며 준비용 모델 호출0이다. 읽기 보고→실제 소유자 재작업 요청→동일 binding/thread의 보호 쓰기→실제1파일 diff/소유자 반영 확인→소유자 독립 수락 순서다. 다른 provider/dot/Muse 호출·자동 Git commit/push/merge는 검증 실행에 포함하지 않는다.

운영 DB는 비공개 online backup을 보존하고 기존 운영 브랜치 `f648ea5`도 유지했다. 운영 폴더를 새 `ops/r6-live-20261108` 브랜치에서 병합본으로 빌드·재시작했다. 기존 `.env`·소유자 접속 자료·연결7개·참여자11개·토의5개·binding/job0·방 off·Chrome 잠금이 적용 전후 일치했고4090 health200을 확인했다. 사용자 untracked 파일을 덮어쓰지 않았다. 기존3000 포트/다른 서비스·Tailscale Serve/사용자 unit·전용 AppArmor/stock bwrap·전역 설정은 바꾸지 않았다.

구독 인증은 유효한 access snapshot만 별도0600 파일에서 사용하고 refresh token은 복제본에서 비워 원래 계정 인증 갱신을 피한다. 원래 인증 원본과 대화 이력을 변경하지 않으며 provider vault/사용자 대화는 검증 Git/state에 복사하지 않는다. 종료 시 복제 auth 파일을 제거하며 원래 인증의 변화 여부를 별도로 대조한다. 인증/비밀번호/API 키와 개인 대화 원문은 이 기록에 넣지 않는다.

## 수행 증거

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

## 남은 수락·복귀

실제 읽기 출력/정수 exit·완전 capture/readonly 검사, 소유자의 digest가 고정된 재작업, 쓰기 원문/동일1파일 diff·명시 반영 영수증·독립 수락이 아직 필요하다. 모델 응답만으로 성공 처리하지 않으며 native 명령 승인/원본 반영을 소유자 대신 자동 확인하지 않는다. 만료·오류 시 원래 job/thread/turn·원문·사본을 보존하고 자동 재전송하지 않는다. 호출/시간 한도 확대나 새 호스트/계획 변경은 별도 보고·승인을 따른다.

중단1job 보존 후 **추가 최대2job/30분**과 새 검증 위치의 정확한 읽기 명령1회에 대한 별도 승인을 요청했다. 새 위치는0model job으로 준비만 하고 auth 제거/연결 종료했으며 답변 전 재호출하지 않는다. 새 승인이 오면 제시한 명령·위치·읽기 범위와 실제 요청의 일치를 확인한 경우에만1회 승인한다. 쓰기·원본 반영/독립 수락은 실제 산출물을 제시한 뒤 각각 확인한다. 이는 새 호출 창 요청이며300초 제한·명령 seal·기존 계획/호스트 정책을 완화하는 변경이 아니다.

종료 시 검증 방 off·진행 turn 중단/대조·binding 회수·private 복제 인증 제거와 운영 서비스/기존 데이터 보존을 확인한다. 원본 `validation.txt` 반영은 제시한 실제 diff와 소유자의 명시 확인을 받은 경우에만 수행한다. 실제 관측이 끝나기 전 기존 R6-F/50 gate를 PASS로 바꾸지 않는다.
