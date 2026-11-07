# ADR 0002 — 보호 작업 사본과 소유자 1파일 반영

상태: 2026-11-07 사용자 권장안 승인, 구현/자동 검증 진행. 실제 사용자 Codex 작업·운영 배포는 별도 허용 범위다. [영향·대안·R1~R8](../reviews/execution-protection-impact-20261107.md), [실행 기록](../implementation/execution-protection-20261107.md).

## 문제와 결정

기존 adapter/Store/queue/MCP/승인과 사용자 세션을 재사용한다. 원본 cwd의 알려진 secret 파일만 가리는 방식은 실행 뒤 생긴 파일을 보호하지 못했다. 원본 직접 쓰기 대신 비밀 이름·Git metadata·링크를 제외한 private 텍스트 사본을 만들고 같은 논리 cwd에 mount한다. 보호 프로필과 OS 검사가 실제로 통과한 경우에만 사본 쓰기를 허용한다. 원본은 실행 동안 읽기 전용이다.

일반 토의 grant와 Codex binding에는 선택적 version/epoch/issuedAt/expiresAt/revokedAt을 추가한다. 기본24시간·소유자 선택1~168시간이다. 기존 필드가 없는 자료는 그대로 보관하되 재발급/재등록 전 새 사용을 막는다. 새 job은 binding 범위 digest/세대와 필요시 grant 출처를 고정한다. dispatch·승인·steer·결과/반영 전에 현재 권한을 재검사한다. 기존 resident/dot 권한 계약은 변경하지 않는다.

기존 Store의 version1/SQLite transaction·event/command receipt를 유지하고 선택적 executionProtectionVersion1 marker를 추가한다. 새 metadata를 가진 상태에서 marker가 없거나 미래/손상 metadata면 시작을 거절한다. 완료한 과거 job을 현재 권한이나 완전한 원문으로 승격하지 않는다.

## 실행과 반영은 다른 사실

`CodexJob.status=completed`는 원격 turn의 종료 관측이다. `draft.status`는 사본 preparing/running, 원본 pending/applying/applied, unchanged/blocked/conflict/unconfirmed를 구분한다. pending/applying에서 업무 보고·완료를 진행하지 않는다. 원본 반영은 소유자 HTTP 경계에서 실제 diff digest를 확인한 뒤 별도 요청한다. 모델에게 반영 API나 임의 파일/셸 도구를 주지 않는다.

첫 버전은 기존 UTF-8 일반 텍스트1파일의 내용 수정만 허용한다. 생성/삭제/rename/chmod/binary/다중 파일·Git commit/push/merge는 제외한다. 실행 당시 branch/HEAD·원본 파일의 경로/inode/mode/hash와 현재 내용을 대조한다. 보호 사본·baseline/manifest는 인증된 private 자료이며 job ID로만 찾는다. 적용 intent를 먼저 Store에 기록하고 실제 반영/검증 receipt를 뒤에 기록한다. crash/부분 기록·감지된 경쟁에서는 unconfirmed로 보존하고 자동 재반영하지 않는다.

소스 반영의 최종 비교와 descriptor 쓰기는 app의 단일 writer 안에서 await 없이 수행한다. 이는 비협조적인 같은 OS 사용자 프로세스와의 kernel atomic CAS를 보장하지 않는다. 실행/반영 중 다른 편집기를 쓰지 않는 기존 운영 조건을 유지하며, 감지된 inode/내용/부모 교체·부분 쓰기는 미확정으로 남긴다. 이런 프로세스는 앱의 DB/키도 직접 바꿀 수 있으므로 앱 내부 권한과 별도의 OS 사용자 보안 경계라고 주장하지 않는다.

## 원문과 표시를 분리

16MiB/4,096기록 이하의 원본 RPC 관측은 state 하위0700/0600 private NDJSON에 보관한다. digest/byteLength/pageCount/complete는 비가림 원문 기준이다. gap·restart·손상·한도 초과는 incomplete로 남고 terminal snapshot만으로 복구하지 않는다. 표시용 미리보기는 알려진 credential과 JSON/URL/Base64 표현 및 token 형태를 가린다. chunk 경계의 비밀 prefix를 공개하지 않는다. command/exit metadata와 표시 생략 여부는 별도 필드다.

소유자 인증/Host·Origin 아래 job 단위 페이지 조회만 비가림 원문을 반환한다. 일반 MCP/방/토의/Wiki에는 가린 출력과 근거 참조만 전달한다. raw와 preview digest를 혼용하거나 오래된 절단 출력을 전체 근거로 표시하지 않는다. raw 보관 정리·삭제/만료는 이번 기능에 추가하지 않는다.

## 도구 계약과 우회 금지

기존0.165 readOnly/RPC 계약은 유지한다. 보호 사본 쓰기는 installed experimental schema의 named `permissions`와 실제 로컬 OS 프로필 검사를 추가로 요구한다. `sandboxPolicy`와 함께 보내지 않는다. [공식 프로필](https://learn.chatgpt.com/docs/permissions)·[App Server](https://learn.chatgpt.com/docs/app-server)의 설명과 설치 schema가 다르면 설치 검사와 fail-closed를 우선한다. 로그인/thread/model 없이 가짜 canary·읽기/쓰기/namespace/network 검사를 수행한다.

지원되지 않은 버전/명령·프로필/managed 권한·OS 보호는 쓰기를 거절한다. 추가 권한을 요청하는 보호 작업의 원격 승인 ACCEPT와 steer는 차단한다. 거절/취소·원문/실제 turn 대조는 유지한다. 검증되지 않은 승인을 통해 경계를 확대하거나 source 직접 쓰기, externalSandbox/full-access로 우회하지 않는다.

## 롤백

G0에 따라 새 예약을 멈추고 queued/active/승인·미확정과 applying intent를 대조한다. pending 사본을 원본 수정으로 간주하지 않는다. 새 state/event/receipt·raw·baseline·미확정을 보존하며 quiescent에서 이전 binary로 복귀한다. 이전 binary에는 새 수명/보호 계약이 없으므로 이전 버전에서 실행 기능을 재개하지 않는다. DB 초기화/키 재발급·사본 삭제로 실패를 숨기지 않는다.
