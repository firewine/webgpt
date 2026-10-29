# ADR 0001 — 단일 서버의 영속 토의 작업실

- 상태: 구현 채택 / 실제 사용자 호스트 검증 대기
- 날짜: 2026-10-29
- 대상: WJ-002~011, 013~015의 독립 구현

## 결정

한 Node.js 24 프로세스와 내장 `node:sqlite`를 사용한다. 소규모 개인 작업실의 상태 JSON, 증가하는 event journal, idempotency command 결과를 같은 `BEGIN IMMEDIATE` transaction에 기록한다. schema 버전은 `PRAGMA user_version=1`이며 더 높은 버전은 거부한다. WAL/FULL sync, 보호 디렉터리, 단일 PID/host lock을 사용한다. 같은 호스트의 죽은 PID만 회수한다.

모든 발언은 dispatch 전에 prepared 기록을 남긴다. 재시작 시 prepared/running은 보수적으로 unconfirmed로 바꾸며 원래 receipt로 대조한다. snapshot과 event cursor는 같은 프로세스의 동기 DB 읽기에서 얻고, SSE 연결 수명은 실행과 분리한다. 계정·참여자별 이력, revision, context generation과 원문 참조는 독립 필드다.

초기안 전체 수집과 검토 라운드 경계를 scheduler가 관리한다. 같은 round의 새 응답은 다른 참여자의 입력에서 숨긴다. 검토는 배정된 실제 claim ID를 요구한다. 검증 큐는 반론·미확인 검토 수를 우선순위로 사용하고 같은 단일 provider 실행기를 사용한다. Codex 대기 부모는 provider 슬롯을 점유하지 않는다.

자료를 받았다는 `observed`는 주장이 참이라는 판정이 아니다. 모델 보고·원문 관측·실행 기록·미실행을 분리하고 검증 결과를 공통 snapshot으로 공유한다. 구조 오류는 한 번만 보완하며 예산 한도에서 종합용 요청을 예약한다. 보고되지 않은 token usage와 금액을 만들지 않는다.

## 인증·실행 경계

소유자 키는 로컬 0600 파일, 브라우저 세션은 HttpOnly/SameSite=Strict 쿠키다. 운영 HTTPS에서는 Secure를 붙인다. Host와 Origin을 검증하고 인증 헤더를 noVNC upstream으로 전달하지 않는다. noVNC 입력은 수동 제어 lease가 있을 때만 허용한다.

OAuth/API credential은 DB와 별도의 AES-256-GCM vault에 저장한다. 키·암호문은 같은 OS 소유자가 관리하므로 OS 계정 탈취에 대한 분리 보장은 아니다. Codex 자식에는 provider 환경 변수를 전달하지 않으며 bubblewrap으로 앱 state/Chrome profile을 가린다. 별도 PID namespace와 `/proc`를 사용해 호스트 프로세스의 root/fd 경로로 가린 파일을 읽지 못하게 한다. namespace를 만들 수 없으면 실행을 거절하고 격리 없는 경로로 전환하지 않는다. Codex의 읽기 sandbox 자체가 cwd 밖의 모든 읽기를 차단한다고 주장하지 않는다.

설치한 `codex-cli 0.165.0`의 생성 schema를 직접 확인했다. 이 버전의 `approvalPolicy`는 `untrusted`이고 sandbox에는 문서 일부 예시의 `access/readOnlyAccess` 필드가 없다. 존재하지 않는 옵션을 보내는 대신 실제 schema에 맞추고 비밀 경로는 OS 경계로 가린다. `approvalsReviewer=user`이며 승인 요청을 자동 허용하지 않는다. 설치 버전 변경 시 schema 검사를 재실행한다.

Chrome DevTools MCP `1.12.0`에서 실제 tools/list의 pageId·evaluate_script·snapshot 계약을 대조했다. 고정된 관측·입력 함수만 사용하며 prompt는 JSON 문자열 데이터다. 기존 입력을 덮어쓰지 않고 대상 계정·대화 URL·receipt를 대조한다. 관측 중 DOM 안정 대기와 JavaScript dialog 자동 수락은 사용하지 않는다.

## 한계와 확장

전체 상태 JSON은 개인 작업실의 bounded workflow를 위한 첫 구현이다. 다중 프로세스·다중 운영 사용자·무제한 장기 보관용 분산 DB를 대체하지 않는다. 큰 checkpoint는 원문 ID/해시와 발췌 여부를 남기며 80,000자를 넘으면 전환을 막는다. 자동 모델 요약으로 미확정 근거나 권한을 만들지 않는다.

외부 Codex 클라이언트와 공유하는 완전한 global lease는 없다. 등록 세션의 실행 소유권을 웹쫀쿠로 넘기고 다른 클라이언트를 유휴 상태로 두어야 한다. 실제 계정 적격성, Tailscale 정책, Ubuntu user namespace/bubblewrap, dot/Muse DOM, noVNC 화면 입력은 해당 환경에서 별도 판정한다.

MCP v1의 도구 통로를 우선 구현했다. 최신 MCP Events는 별도 MCP 2.0 계약과 계정 구독 검증이 필요하므로 현재 광고하거나 수신 성공으로 간주하지 않는다. Core의 browser 재검토 경로가 기본이다. 선택 Git Writer·추가 provider·자동 병합은 WJ-016~018의 별도 범위다.
