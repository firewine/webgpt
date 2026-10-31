# 페이즈 8 — 실계정 통합 검증 준비 / 2026-10-31

사용자가 PR #27 적용 뒤 “다음 페이즈 진행”을 요청했다. [SSOT](../development-plan.md)의 현재 단계는 R8이며 새 페이즈를 임의 신설하지 않는다. PR #27의 병합 main `d0aa716`에서 이어서 진행한다. 단계 순서·50개 수락 기준·유료 호출 별도 허용·사용자 병합·기존 backend 계약을 유지한다. 아래는 실제 준비 상태의 관측과 기존 진단 보완이며 R8-D 전체 수락 완료가 아니다.

## 실제 Ubuntu 관측

| 판정 | 수행·관측 | 한계 |
| --- | --- | --- |
| PASS | `systemctl --user show webjjoku` active/running, loopback4090 `/health` ok | 사용자가 빌드/재시작했다고 보고. 이 작업에서 재배포/서비스 재시작은 하지 않음 |
| PASS | Node24.18.0 / npm11.16.0 / 설정된 Codex0.165.0 / bubblewrap0.11.1 / Chrome MCP1.12.0 | 버전은 실계정 호출 성공 증거가 아님 |
| PASS | 설정된 실제 Codex binary의 `test:codex-contract` | App Server 생성 schema만 검사. 로그인·thread/turn 생성0 |
| PASS (읽기 격리만) | 실제 CodexExecutor와 같은 bwrap 인자: `--die-with-parent --new-session --unshare-pid --bind / / --proc /proc --tmpfs <state> --tmpfs <profile>`에서 읽기 전용 Node probe | 앱 state/Chrome profile 두 경로 내용이 가려짐, host PID 미노출, PID namespace가 host와 다름을 각각 확인. Codex job·명령 쓰기·저장소 secret/link/output 가림·네트워크 sandbox 검증은 별도 |
| 관측 | GPT 연결2개 모델 목록 보유, DeepSeek 연결2개 모델 목록 보유, browser 연결1개, Anthropic 미등록 | 키·이메일·사용자 라벨/대화·원래 thread는 기록하지 않음. 목록과 추론은 구분 |
| 미준비 | GPT/DeepSeek 토커0, browser 토커1, 모의 토커2 | 연결만 등록해도 자동으로 토커를 만들지 않음 |
| 미준비 | 상주 flag off·resident 이관 전·방0, 허용 workspace root0·Codex binding0 | 기본 예산/속도·업무 권한·쓰기 허용을 임의 생성하지 않음 |
| 미준비 | browser 수동 잠금 유지, 기존 토의1개 blocked | 자동 입력 재개/기존 토의 취소를 대신 실행하지 않음 |

기존 blocked 토의는 오류 `operation_failed`의 independent 단계이며 기록된 발언3개 모두 completed/receipt 보유다. 이는 새 호출 허용이나 이후 단계 완료를 의미하지 않는다. 기존 root가 남아 `DiscussionEngine.create`의 `root_workflow_busy` 검사로 새 토의가 막힌다. 원문을 삭제하거나 기존 Muse 대화로 자동 전송해 해결하지 않는다. 소유자가 보존된 원문/receipt를 확인한 뒤 이어가기/취소를 선택해야 한다.

실제 모델 호출·유료 추론·검증 토커 생성은 **아직 하지 않았다**. R8-D의 별도 허용에 맞춰 기존 GPT 연결2개+CoralBricks, 새 토의1개·최대24요청/20분·Chrome/Codex 실행 제외의 범위를 사용자에게 확인 중이다. 기존 blocked root의 정리는 별도 소유자 동작이 필요하다. 실제 검증 전 R3-E/R4-D/R6-F/R8-D의 미확인 판정을 유지한다.

## 기존 doctor 보완과 유지 계약

`scripts/ops.mjs`의 기존 doctor에 `scripts/readiness.mjs::readReadiness`를 결합한다. 이미 있는 owner 키로 고정 loopback `/api/state`를 GET하고 허용한 숫자/상태/미준비 코드만 투영한다. 기존 health/도구 버전·`liveProviders:NOT_RUN` 필드는 유지한다. 새 API/인증·provider/Store·방/토의 실행 경로는 만들지 않는다. 별도 namespace 서비스를 만들거나 전체 backend를 재작성하지 않는다.

고정 숫자 port·redirect 거절·요청당3초 제한·응답당1MB 제한을 사용한다. 인증 전에 공개 health의 웹쫀쿠 식별을 확인해 잘못 지정한 port의 다른 로컬 서비스에는 owner 키를 보내지 않는다. 이 사례의 실패를 재현한 뒤 보강했다. 키가 없으면 생성/권한 변경 없이 `owner_key_unavailable`이며 원문 HTTP 오류/PII/키는 출력하지 않는다. 서비스의 resident/Codex 활성 여부와 로컬 설정 차이도 표시한다. 기록된 조건 충족과 실제 응답/동시성/계정 적격성·미확정 대조 성공은 구분하며 이 명령으로 PASS 판정을 올리지 않는다.

`tests/readiness.test.mjs`는 실제 임시 owner HTTP 서버와 CLI에서 변경·provider 호출0, 계정/토커 준비의 구분, 중단 root·중복 계정·manual lease, 키 미생성·잘못된 port/다른 로컬 서비스, 실제 redirect의 키 전달0·과대/비정상 오류 비노출을 검사한다. 기존 서비스 설치 검사도 함께 통과했다. 관련 검사 **6 PASS**, FAIL/SKIP0. health 보호 전 전체 `npm run check`는 strict TypeScript/빌드·Node310 PASS였고 보호 추가 후 관련6개를 다시 확인했다. 최종 전체 회귀 결과는 후속 PR의 정확한 head/check에 기록한다. UI/서버 코드를 바꾸지 않아 별도 화면 테스트를 복제하지 않는다.

## 후속 영향·복귀

R1~R7 모델/API/이벤트·이관은 변경 없다. R8에서는 준비·실제 호출·미확인 증거를 분리해 수집하며 50개 원래 기준을 유지한다. U1/U2/U3의 값/권한을 대신 정하거나 다음 선택 Git Writer/병렬화/자동 병합으로 넘어가지 않는다.

진단 보완을 되돌릴 때 이 두 script와 문서 변경만 복귀하면 되며 운영 DB/키·Chrome·토의·작업/approval은 그대로다. 실행 상태를 만지는 기능이 없어 취소·재전송·DB 초기화가 rollback에 필요하지 않다. 실제 쓰기/운영 rollback 수락은 여전히 미검증이다.
