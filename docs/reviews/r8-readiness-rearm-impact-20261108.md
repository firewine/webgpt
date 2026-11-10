# R8 감시 준비 후 실행 등록 — 최소 재개안

상태: **APPROVED — 2026-11-09 KST 사용자 승인 / 실제 혼합 수락 NOT_RUN.** 기준 main `8b66354`, [실제 적용·기한 종료·429 대조](../implementation/r8-mixed-account-live-20261108.md). 이번 갱신은 아래 범위의 재개 승인 기록이며 실제 실행·수락 증거가 아니다.

후속 실측(11/09): 감시 확인 뒤 세션 등록까지 진행했으나 첫 native 준비 발언은 v2 응답 해석 오류로 중단됐다. 새 예약1/API0/Codex job0/새 토의0, 원문 보존 대조·정상 서비스/원래 방 설정 복구를 확인했다. 이 승인 기록을 새 검증 창이나 다른 경로에 재사용하지 않는다. [실측](../implementation/r8-mixed-account-live-20261108.md#2026-11-09-감시-확인-후-첫-native-발언--blocked)과 [2026-11-09 KST 별도 승인된 후속 최소안](./r8-native-decoder-rearm-impact-20261109.md)을 구분하며, 후속 새 시도는 운영 담당의 실측 증거 전 NOT_RUN으로 유지한다.

## 변경 이유·선택

기존 준비 C는 실제 감시 연결 전30분 대기 기한이 끝났고, 새 모델 예약/API/job0으로 정상 복구됐다. 먼저 생성됐던 빈 Codex thread/binding은 회수/managedSession lost 상태다. `CodexExecutor.register`는 같은 cwd 등록을 재사용하며 권한 epoch를 올리지만, 현재 `executionGuard`는 첫 read epoch1/후속 write epoch2와 새 등록1개를 고정한다. 옛 journal/권한을 초기화해 새 준비처럼 보이게 하지 않는다.

| 대안 | 판정 |
|---|---|
| 기존 폴더/등록을 그대로 반복 | 기각. 기존 등록/권한·journal과 새 수락의 경계를 만족하지 못한다. |
| 공개 검증기에 기존 binding 재무장 계약 추가 | 후속 개발안. 기존 epoch/등록·미확정 대조 계약과 회귀 검사를 확대해야 한다. 현재 실검증을 위해 바로 추가하지 않는다. |
| 별도 합성 검증 폴더1개 + 감시 확인 뒤 새 thread 등록 | 채택(사용자 승인). 제품 코드를 유지하고 기존 검증기 계약을 그대로 사용한다. 옛 준비 기록을 보존하며 실제 실행 대상 경로만 명시 교체한다. |

## 검토 가능한 준비물·정확한 범위

- 새 경로: `/home/firewine/.local/share/webjjoku-r8-validation/20261108d/repo`, branch `r8-validation`, 준비 HEAD `a00a3d226e5edca6361959ef04e241f8310307cb`.
- 기존 공개 합성 `allowance.mjs`·`check-boundary.mjs`·`validation.txt`와 바이트가 같은3파일만 복사해 private Git baseline을 준비했다. 원래 폴더/파일/등록/세션·job/실패 이력은 변경하지 않았다. 이 준비용 baseline commit은 모델의 Git 자동화가 아니다.
- 이 새 경로의 `/bin/bash -c 'node check-boundary.mjs'` 보호 읽기1회는 사용자 사전 승인됐다. 실제 command/cwd/읽기 profile/현재 seal이 정확히 일치할 때만 수락한다. 예상 exit1은 경계 결함 재현이며 실제 실행 결과는 아직 NOT_RUN이다.
- 실제 보호 사본 쓰기 명령과 `allowance.mjs` 한 파일의 원본 diff 반영은 산출물을 제시한 뒤 별도로 확인한다. Git 자동 commit/push/merge·추가 파일 반영은 없다.
- 같은 기존5인, 두 웹 GPT Extra High·DeepSeek High·native dot·원래 Muse를 사용한다. 이미 완료된 웹 준비 대화를 재전송하지 않는다. 모델 최대30회/API6회/Codex2job/최초 예약부터30분·각300초, 기존 API 일일8회/보고200,000토큰과 잔여 중 작은 범위를 유지한다. API 요금이 발생할 수 있다.

## 준비 순서·호스트 변경량

1. 원래 방off/잠금과 새 호출0을 유지해 터널 ready·조회1회부터 확인한다. 실제 dot의 현재 필터 감시1개를 연결하고 유효 구독을 대조한다.429/오류면 재시도하지 않고 상태·가능한 응답 정보만 기록한다.
2. 유효 감시가 확인된 뒤에만 이 새 경로의 보호 read session/thread를 한 번 등록한다. 준비 대기 중 빈 thread를 먼저 생성하지 않는다. 최초 새 예약의 ledger 시각과 같은 검증/정리 기한을 사용한다.
3. 기존 user service의 전용 임시 drop-in **1개**에서 `WJ_WORKSPACE_ROOTS`의 단일 검증 경로를 위 새 경로로 교체한다. 같은 DB/4090을 한 프로세스만 열고 끝나면 이 파일만 제거한다. `.env`/원래 unit·NoNewPrivileges/UMask·Tailscale/포트·AppArmor/outer 실행기 변경은0이다.
4. 계정 사본은 앱 차단 state와 분리한 private 위치에서 읽기용으로만 사용하며 원래 auth를 갱신하지 않는다. 복구 잠금/실제 drop 소유 영수증·원래 ID/receipt·명시 명령/반영 확인을 유지한다.

예상 추가는 **제품 코드0, 문서3개 약80~120줄, private operator1~2개 약20~40줄과 별도 합성 fixture3파일**이다. 기존 관측 사실과 이번 재개 승인은 구분하며 실제 실행 결과는 후속 증거로 갱신한다.

## 후속 영향·수락·복귀

R6 실행기/보호·명령/반영 계약은 유지하고 이 수락용 경로만 바뀐다. R8-D/D5-F의 목표·횟수/시간·동료 검토/Wiki 기준은 유지한다. R1~R5/R7와 기존 연결/GUI/DB/API 정책, R8-A·실기기/장기 운영의 남은 수락은 변경하지 않는다. 후속 선택 기능에도 변경이 없다.

수락은 기존5인 초안/교차검토/수정·실제 read/write2job/명령·capture·1파일 diff/반영 receipt·전 참여자 재검토/종합·방 복귀/Wiki 후속 인용을 Store/원문 참조/영수증으로 확인한다. 성공하지 못하면 부분/미실행으로 기록한다. 종료 시 방off·Muse 잠금·자기 소유 grant/감시/임시 설정·auth 사본만 정리하고 정상 health와 원래 설정/DB 보존을 확인한다. 옛 backup으로 DB를 덮어쓰지 않는다.

사용자 승인(2026-11-09 KST): 위 새 합성 폴더·준비 HEAD에서 같은 한도의 실검증 재개와 정확한 보호 읽기 명령1회를 사전 허용했다. 실제 보호 사본 쓰기 명령과 원본1파일 diff 반영은 산출물 제시 뒤 각각 별도 소유자 확인을 유지한다. 실제 결과 전 R8 NOT_RUN을 유지한다.
