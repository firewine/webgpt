# R8 native 응답 해석 대조 후 최소 재개안

상태: **APPROVED — 2026-11-09 KST 사용자 명시 승인 / 새 시도 NOT_RUN.** 운영 코드 기준 main `8b663543853480fb842c23160daf01c67967b0f1`. 사용자가 아래 새 경로·준비 HEAD·같은 한도의 재개와 정확한 보호 읽기1회를 승인했다. [이전 시도의 실제 중단/복구](../implementation/r8-mixed-account-live-20261108.md#2026-11-09-감시-확인-후-첫-native-발언--blocked)와 이번 승인을 구분하며, 새 시도는 운영 담당의 후속 실측 증거 전 NOT_RUN으로 유지한다.

## 원인과 이미 수행한 대조

실제 dot은 첫 페이지 응답에 없는 `structuredContent`를 읽다 중단했다. v2의 text-only 응답은 기존 계약이며 `dotToolResult`·README·fixture가 일치한다. 감시의 페이지별 존재 검사/fallback 지시 보완은 새 제품 계약이 아니다. 중복 응답 복원·한도/시간 연장·MCP schema 변경·추가 OAuth/키는 필요하지 않다. 같은25페이지를 순수 로컬로 해석해 완전 원문/digest와 최대 RPC11,937bytes를 확인했다. 실제 dot의 정상 해석은0페이지였으므로 이 검사를 native 성공으로 세지 않는다.

기존 상주 준비 발언은 중단/미제출 확인 뒤 `skip`으로 대조했고 기록을 모두 보존했다. 새 토의/API/Codex job은0이다. 사용하지 않은 실제 read 등록도 회수/managedSession lost로 보존된다. `CodexExecutor.register`는 같은 cwd를 재사용하며 권한 epoch를 올리지만 `executionGuard`는 새 read epoch1/후속 write epoch2를 고정한다. 옛 등록·journal을 지우거나 reset해 재실행하지 않는다.

## 대안·승인된 선택

| 대안 | 판정 |
|---|---|
| v2에 structuredContent를 다시 추가 | 기각. 실제 소비자의 잘못된 선택을 고치며 원래 단일 표현/페이지 경계를 유지한다. |
| 기존 binding을 초기화하거나 검증기의 epoch 검사를 우회 | 기각. 기존 세션/권한·실행 감사 경계가 깨진다. |
| 미사용 binding 재무장 기능 개발 | 후속 대안. 실제 등록/세션 교체·epoch·실행 이력 보존과 재시작/중복 검사를 함께 설계해야 한다. 이번 최소 재개에 추가하지 않는다. |
| 새 합성 폴더1개 + 수정한 감시 지시 + 바로5인 주제 | 채택(2026-11-09 KST 사용자 승인). 제품 코드와 보호를 유지한다. 별도 ambient 준비 발언을 추가하지 않고, 감시 유효성 대조 후 새 protected session 등록→승인한5인 주제를 시작한다. 주제 안 dot 실제 응답은 필수 수락 조건으로 남긴다. |

## 검토 가능한 대상·변경량

- 새 합성 대상: `/home/firewine/.local/share/webjjoku-r8-validation/20261109b/repo`, branch `r8-validation`, 준비 HEAD `e32dc8ef9f88cf622160b49b16f60b434dc3b665`.
- 승인 시점의 준비물은 기존 승인 폴더의 비밀 없는 `allowance.mjs`·`check-boundary.mjs`·`validation.txt`3개를 바이트 그대로 복사한 baseline이며, 당시 허용 root/세션 등록 전이었다. 기존 폴더/파일/등록/실패 기록은 보존한다.
- 기존 서비스의 검증 전용 임시 drop-in1개에서 허용 root를 새 경로로 명시하고, 기존 임시 ExecStart의 private Node `--import`로 아래 준비 gate를 전달한다. `.env`/정상 unit·Tailscale·포트·AppArmor·전용 outer·NoNewPrivileges/UMask는 변경하지 않는다. 같은 DB/4090의 앱1개만 실행하며 종료 시 자기 소유 drop-in만 제거한다.
- 준비 보완: 방 on/focus는 별도 API이며 on 즉시 ambient 예약이 가능하므로, private 프로세스 내부 gate가 해당 방의 첫 topic 예약 성공 전까지 non-topic 예약을 거절한다. 모든 예약에 기존 `acceptanceGuard`/`DispatchCoordinator` 검사를 그대로 적용하며 제품/DB/API 필드는 바꾸지 않는다. 운영 담당이 오프라인에서 첫 resident 거절·첫 topic의 원래 guard 적용을 확인한 뒤 실제 최초 예약의 `ownerKind:topic`을 대조한다(새 시도 결과는 NOT_RUN).
- 같은 dot/plugin/tunnel/key를 사용하며 감시 지시는 매 응답에서 `structuredContent` 존재 검사→없으면 text JSON 해석→페이지 일치/누락0 검사로 고정한다. 오래된 감시는 재활성화하지 않고 현재 필터의 감시1개만 유지한다. 오류/429/절단이면 재시도 없이 정지한다.
- 제품 코드0. 추가 공개 제안/실측/운영 지시 문서 약100~160줄과 private 준비 순서 약10~25줄·합성 fixture3파일 규모다. 별도 CI 실패는 제품과 무관한 browser fixture1개/4줄에서 기존 단언 전에 취소 POST 완료를 기다리도록 보완한다.

## 새 실행 범위·후속 영향·복귀

승인된 새 창은 최초 예약부터 최대30분·모델30회·API6회(DeepSeek High)·Codex2job(읽기1/보호 쓰기1)이며 각 turn300초를 유지한다. 기존 API 일일8회/보고200,000토큰과 실제 잔여 중 작은 한도를 유지한다. API 비용이 발생할 수 있다. 과거 준비/실패를 완료 답변에 합산하거나 새 한도로 다시 허용하지 않는다.

새 경로에서 `/bin/bash -c 'node check-boundary.mjs'` 보호 읽기1회는 2026-11-09 KST 사용자 사전 승인됐다. 예상 exit1은 경계 결함 재현이며 실제 command/cwd/profile/seal이 정확히 일치할 때만 수락한다. 보호 사본 쓰기 명령과 원본 `allowance.mjs`1파일 diff 반영은 결과를 보여준 뒤 각각 별도 소유자 확인을 유지한다.

R6 실행/권한·보호 사본/명령/반영 계약, R1~R5/R7·DB/연결/GUI·예산/300초/미확정 경계는 유지한다. R8의 준비 순서와 검증 경로만 보완하며 주제 검토→실제 read/write→실행 근거 환류→전 참여자 재검토→결론/Wiki/후속 인용의 수락 조건은 줄이지 않는다. 별도 상주1회 성공·기기/장기 운영은 이 실행으로 대신하지 않는다.

원래 ambient 입력의 누적 크기는 별도 리스크다(`promptForRoom`의 전체 방 자료/Wiki 및 `ResidentRunner.accept`의 prompt/reply history). 이번 최소안에서 원문을 자르거나 Wiki를 제외하거나 native checkpoint를 새로 만들지 않는다. 실제 입력이 한도/시간에 걸리면 원래 요청을 보존해 멈추고 별도 영향/변경량을 검토한다.

종료 시 방off·Muse 잠금·이번 native 감시 비활성 확인·현재 grant/터널 회수·자기 소유 설정/auth 사본 제거 후 health·원래 설정/방 멤버·DB 보존을 대조한다. 오류 시 원래 요청/claim/receipt를 보존하며 외부 중단/미제출을 확인하기 전 대조 완료나 자동 재시도로 처리하지 않는다. 원래 backup으로 현재 DB를 덮어쓰지 않는다.
