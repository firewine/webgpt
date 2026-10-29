# 웹쫀쿠 Codex 세션 실행 계획

| 항목 | 값 |
| --- | --- |
| 상태 | v0.3 — 실행기·도구·환류 fixture 및 설치 schema PASS, 실세션 검증 NOT_RUN |
| 개정일 | 2026-10-29 (KST) |
| 상위 계획 | [development-plan.md](./development-plan.md) |
| 운영 환경 | [Ubuntu 서버·웹 접속 운영 계획](./ubuntu-operations.md) |
| 목표 | dot의 프롬프트를 기존 Codex 세션에 전달하고 결과·후속 지시 및 토론의 검증·비교로 환류 |
| 대화 / 참여자 | [능동 토론](./discussion-plan.md) / [OAuth·API·browser 연결](./participant-connections.md) |
| 첫 대상 | Ubuntu 서버의 등록된 프로젝트와 Codex 세션 1개 |

현재 구현과 검사는 [WJ-002~015 구현 기록](./implementation/wj-002-015.md), 실제 명령과 복구 절차는 [운영 절차](./operations-runbook.md)를 따른다. 이 문서의 실계정·실세션 완료 조건은 아직 통과하지 않았다.

## 1. 사용자 흐름과 구현 경계

1. 사용자가 작업 목표와 Codex 세션을 선택하거나, 기존 허용 범위 안에서 Discussion의 검증·개발 과제를 Codex Task로 배정한다.
2. dot(may)이 수정 범위, 제약, 완료 조건, 필요한 검증을 포함한 프롬프트를 작성한다.
3. dot이 인증된 웹쫀쿠 MCP의 `codex_send` 도구를 호출한다.
4. 웹쫀쿠는 등록된 세션·작업 범위와 실행 상태를 확인하고 요청을 영속 대기열에 넣는다.
5. Ubuntu의 Codex 실행 어댑터가 해당 세션에 프롬프트를 전달한다.
6. Codex의 진행·승인 요청·완료·실패와 결과를 Core에 기록하고 웹 클라이언트에 전달한다.
7. dot이 `codex_result`로 결과와 검증 근거를 읽고 검토한다. 원래 Discussion이 있으면 모든 참여자에게 같은 증거를 공유해 각자 결론을 갱신하고 비교한다. 수정이 필요하면 같은 세션에 새 revision의 지시를 보낸다.
8. 검토가 끝나면 Core의 작업을 완료한다. PR 게시·배포는 작업의 별도 범위와 권한에 따른다.

`codex_send`, `codex_status`, `codex_result`는 웹쫀쿠의 scoped MCP에 구현한 도구다. Codex나 dot에 이미 설치된 내장 도구로 표시하지 않는다. 소유자가 특정 Discussion·참여자·도구에 grant를 발급해야 사용할 수 있다. 설치한 Codex 0.165.0의 schema와 bubblewrap 격리 결정은 [ADR 0001](./adr/0001-workspace-runtime.md)을 따른다.

이 모듈은 사용자의 Codex를 실행 자원으로 연결한다. 토론 참여자의 GPT OAuth·DeepSeek API 호출은 별도 adapter이며 Codex 실행 모듈과 구분한다. Codex 자체의 로그인·모델 접근과 웹쫀쿠 MCP 인증, Secure MCP Tunnel의 런타임 인증은 서로 다른 항목으로 관리한다.

일반 주제 토론에 Codex나 dot을 필수 참여자로 강제하지 않는다. Phase 4A의 첫 실행 통로는 기존 dot → Codex 계약을 유지하되, 다른 참여자의 검증 제안도 Core가 같은 허용 범위의 Task로 배정할 수 있다. 다른 참여자에게 직접 실행 도구를 제공하는 것은 별도 capability 검증 후 확장한다.

## 2. 세션 등록 계약

세션 ID만으로 원격 실행 권한이나 세션 기록에 대한 접근이 생기지 않는다. 실행기가 해당 세션을 보유하거나 접근할 수 있는 호스트·OS 사용자·Codex 환경에서 동작해야 한다.

| 등록 정보 | 확인할 내용 |
| --- | --- |
| `executorId`, `hostId` | Ubuntu의 실제 실행기와 연결 상태 |
| 실행 OS 사용자·Codex 설정 위치 | 기존 로그인과 세션 기록에 접근할 수 있는 실행 문맥; 인증 값은 저장하지 않음 |
| `projectId`, `cwd`, 저장소 식별자 | 정규화한 작업 경로와 실제 저장소·worktree가 등록 대상과 일치 |
| 브랜치·작업 트리 상태 | 허용 브랜치, 기존 사용자 변경, 작업 중인 다른 실행기 확인 |
| `cliSessionId`, `threadId` | 사용한 CLI와 App Server가 실제 반환한 ID를 각각 보존 |
| `sessionTreeId`, `activeTurnId` | App Server의 `thread.sessionId`와 현재 turn; thread ID에서 임의로 추론하지 않음 |
| Codex 버전·프로토콜·capability | resume / queue / steer / interrupt / 승인 중 실제 지원 항목 |
| 실행 권한 profile | 현재 sandbox·승인 설정과 허용 작업 범위 |

CLI 세션 ID, App Server의 대상 `thread.id`, 세션 트리 루트인 `thread.sessionId`, ChatGPT 웹 대화 ID를 혼용하지 않는다. `thread/resume`에는 대상 thread ID를 사용한다. 명시적으로 고른 ID를 보존하며 `--last`로 다른 세션을 자동 선택하지 않는다.

기존 세션의 cwd·저장소와 등록 정보가 다르면 `TARGET_MISMATCH`로 멈춘다. 세션이 없을 때 새 세션을 몰래 만들거나 다른 세션으로 대체하지 않는다. 사용자가 새로운 작업 공간을 선택하면 새 바인딩으로 등록한다.

## 3. 실행 방식

### 3.1 제품 기본 경로: Codex App Server

지속 연결과 작업 상태·승인 요청을 관제실에 제공하기 위해 App Server를 우선 경로로 선택한다. 설치 버전의 RPC schema와 실제 capability를 확인해 고정한다. 문서상 지원은 사용자 서버의 실행 성공을 뜻하지 않는다.

- 실행기는 로컬 stdio 또는 검증된 로컬 socket으로 App Server에 접속한다.
- 초기화 후 등록한 thread를 조회·재개하고 실제 cwd·권한·활성 turn을 대조한다.
- 유휴 상태에서는 `turn/start`로 다음 프롬프트를 전달한다.
- 일반 후속 업무는 Core 대기열에서 현재 turn 완료를 기다린다.
- 진행 중인 방향 수정만 `turn/steer`로 전달한다. `expectedTurnId`가 현재 turn과 맞지 않으면 다시 상태를 읽고, 다른 turn에 자동 전용하지 않는다.
- `turn/interrupt`는 지원이 확인된 경우에만 사용한다. 중단 요청 접수와 실제 interrupted 상태를 구분한다.
- 알림에서 turn·item ID, 출력, 오류, 승인 요청을 수집한다. `turn/completed` 알림도 내부 status를 확인한다.

기존 CLI나 데스크톱에서 활성 세션을 소유한 App Server가 있으면 같은 서버에 검증된 방식으로 연결한다. 별도 프로세스가 같은 저장 기록을 동시에 재개하지 않는다. 기존 활성 세션을 연결할 수 없으면 `SESSION_BUSY` 또는 `CAPABILITY_UNAVAILABLE`로 표시하고 유휴 상태를 기다린다.

### 3.2 최소 PoC와 제한된 대안: CLI

대상 저장소의 cwd에서 유휴·저장된 세션을 명시적으로 재개한다. 아래는 운영 예시이며 이 문서 작성 중 실행한 명령이 아니다.

```bash
codex exec resume "<SESSION_ID>" - < prompt.txt
```

프롬프트는 보호된 임시 파일이나 stdin으로 전달한다. 구현에서는 `spawn`의 명시적 argument array, `cwd`, `shell:false`를 사용한다. dot의 프롬프트를 셸 명령 문자열로 평가하지 않는다. 실제 버전이 지원하는 JSONL 출력 모드와 종료 상태를 검증해 파싱한다.

설치 버전에서 공식 queue 기능이 확인되면 다음 방식도 사용할 수 있다.

```bash
codex queue --thread "<SESSION_ID>" --message "현재 작업 후 남은 검증을 수행해."
```

| 세션 상태 | 기본 처리 |
| --- | --- |
| 유휴·저장됨 | App Server resume/start; 최소 PoC는 CLI exec resume |
| 현재 turn 실행 중 | Core 대기열; 검증된 공유 서버의 CLI queue도 선택 가능 |
| 현재 방향 수정 요청 | App Server steer + 실제 active turn ID |
| 승인 대기 | 실제 승인 요청을 관제실에 표시하고 결정 전달 |
| 연결 중단·전송 여부 불확실 | 기록·활성 turn을 대조한 뒤 재개; 즉시 재전송 금지 |

CLI queue의 접수는 Codex 실행 완료가 아니다. App Server 연결 장애를 이유로 활성 세션에 CLI resume를 동시에 실행하지 않는다. `codex --version`, 관련 `--help`, 실제 RPC 응답으로 사용 가능한 경로를 판정한다.

## 4. 웹쫀쿠 MCP 도구

| 제안 도구 | 입력 핵심 | 반환과 의미 |
| --- | --- | --- |
| `codex_send` | task ID, 세션 바인딩 ID, prompt revision, idempotency key, prompt, mode(queue/steer), steer 대상 turn | job ID와 accepted/queued 등 접수 상태; 완료를 기다리지 않음 |
| `codex_status` | task/job ID | 실행 상태, 현재 turn, 마지막 이벤트 cursor, 승인·차단 이유 |
| `codex_result` | task/job ID, 결과 revision | 최종 답변, 변경·검증·산출물 참조, 확인된 사실과 미검증 항목 |
| `codex_cancel` | task/job ID | 선택 구현; 대기 요청 취소 또는 확인된 turn 중단 요청 |

도구 이름과 schema는 구현 전 계약으로 고정한다. 임의 호스트·셸 명령·실행 파일·환경 변수·cwd·권한 플래그를 호출자가 넘기는 범용 터미널 도구로 만들지 않는다. 세션 바인딩과 프로젝트 권한은 서버가 조회한다.

각 도구는 인증된 사용자·agent·project·task 범위를 확인한다. 읽기와 실행 권한을 구분하고, dot의 프롬프트로 sandbox·승인 설정을 확대하지 않는다. 기존 Codex 승인 요청은 해당 request ID와 작업에 연결해 그대로 처리한다. 일반 메시지의 “승인” 문자열을 권한 변경이나 승인 응답으로 사용하지 않는다.

장기 Codex 실행을 한 MCP 호출 안에서 기다리지 않는다. 요청 접수 뒤 상태·결과 조회로 이어가며, 완료 알림은 계정에서 검증한 dot MCP Events를 사용할 수 있다. 이벤트가 미검증이면 Core가 job 완료를 관측한 뒤 검증된 browser 경로로 dot에 결과 확인을 지시하고 도구 조회·다음 검토를 이어간다. 같은 turn을 이벤트와 browser로 중복 시작하지 않는다. 연결·권한이 막혔을 때만 사용자 개입 상태로 남긴다. HTTP 성공·이벤트 접수는 업무 완료로 취급하지 않는다.

## 5. 작업 상태·동시성·복구

| 상태 | 의미 |
| --- | --- |
| `accepted`, `queued` | 영속 접수됐지만 Codex 실행 완료가 아님 |
| `running` | 해당 thread/turn 실행 확인 |
| `blocked_approval` | Codex의 구체적인 승인 요청 대기 |
| `reconciling` | 연결 복구 중 실행·전송 여부 대조 |
| `completed` | 해당 Codex 실행이 완료됨; 상위 업무는 검토 필요 |
| `failed`, `interrupted` | 실패 또는 실제 중단 확인; 수정 내용이 자동 복원됐다는 뜻이 아님 |

- 동일 idempotency key의 재호출은 같은 job을 반환한다. 변경된 prompt를 같은 key로 보내면 충돌을 반환한다.
- dispatch 전에 task·revision·prompt digest·세션·예상 turn·상태를 영속 저장한다.
- 전달 후 thread/turn receipt를 저장한다. 수신 확인 전 끊기면 대조 전까지 다시 실행하지 않는다.
- 세션별 활성 turn 제약과 프로젝트/worktree별 단일 작성자 lease를 함께 적용한다. Git Writer와 Codex가 같은 작업 공간을 동시에 수정하지 않는다.
- 초기 전역 한도는 한 root workflow와 활성 provider turn 1개다. Discussion의 참여자 발언 → dot 지시 → Codex 실행 → 참여자 검토를 순차 단계로 관리한다. Codex에 위임한 부모 Task가 별도 실행 슬롯을 붙잡아 자식 실행을 막는 구조를 만들지 않는다.
- 반복 수정은 Task에 기록한 최대 횟수·시간·종료 조건을 따른다. 실패가 반복되면 근거와 함께 blocked/review로 넘긴다.
- client disconnect, SSE 재접속, dot 응답 timeout은 실행 취소나 재시작 조건이 아니다.
- 사용자 CLI의 새 입력, 브랜치·cwd 변경을 관측하면 Core 계획과 대조한다. 기존 사용자 변경을 자동 reset/stash/delete하지 않는다.

## 6. 작업 공간과 결과 검토

기존 세션의 실제 workspace를 등록해서 사용한다. 세션 재개만으로 새 sandbox/worktree가 생겼다고 간주하지 않는다. 초기 코드 변경은 등록한 feature branch 또는 사용자가 지정한 작업 공간에서 수행한다. 기본 브랜치·다른 작업과 충돌하면 상태를 알려 작업 공간을 명시적으로 다시 선택하도록 한다.

Codex의 기존 권한·승인 설정을 유지한다. 웹쫀쿠는 `--yolo`나 sandbox 해제를 자동 추가하지 않는다. 브라우저 프로필과 tunnel credential은 Codex 작업 입력·환경에 전달하지 않는다. Codex의 모델 로그인은 해당 실행 환경에서 관리하고 dot이나 웹 클라이언트에 노출하지 않는다.

결과에는 다음을 남긴다.

- task/job/revision, 원래 discussion/topicRevision/claim 참조, 세션·thread·turn, 프롬프트 digest와 보호된 원문 참조.
- 실제 cwd·저장소·브랜치, 시작/종료 시점과 실행 상태.
- 변경 파일·diff 참조, 관측된 검사 명령·exit status·로그와 미실행 검사.
- 확인 가능한 commit·PR·산출물 참조. 존재하지 않는 SHA나 PR을 생성됐다고 기록하지 않음.
- 사용자 개입·승인·중단·재연결 기록.

`completed`나 Codex의 자연어 “테스트 통과”만으로 상위 Task를 done으로 만들지 않는다. 실행 로그와 최종 변경을 연결해 검토하고, 근거가 없으면 미검증으로 표시한다. 후속 수정은 새 revision으로 기록하고 이전 검사 결과를 새 변경의 성공 근거로 재사용하지 않는다.

기존 Git Writer는 별도 선택 모듈이다. Git Writer의 secret-free sandbox와 broker 보장은 해당 모듈의 gate를 통과한 경우에만 주장한다. Codex 세션 재개를 Git Writer 격리 검증 통과로 대체하지 않는다. 초기 자동 merge·deploy는 포함하지 않는다.

## 7. Ubuntu와 dot 사이의 연결

- 웹 클라이언트 관제는 Tailscale Serve의 private HTTPS 경로를 사용한다.
- dot의 MCP 도구 호출은 Ubuntu의 private MCP endpoint와 OpenAI Secure MCP Tunnel로 연결한다.
- `tunnel-client`는 서버에서 outbound HTTPS를 만들고 로컬 MCP에 요청을 전달한다. Tailscale 주소만 등록해서 OpenAI가 접근할 수 있다고 가정하지 않는다.
- Platform tunnel 권한·runtime key·ChatGPT workspace 연결과 custom MCP 사용 가능 여부를 확인한다. 터널 인증을 모델 추론용 API 연동과 혼동하지 않는다.
- CLI resume PoC 자체는 tunnel 없이 수행 가능하다. dot → MCP → Codex 전체 왕복 완료 판정에는 실제 tunnel·도구 실행 증거가 필요하다.
- Secure MCP Tunnel의 OpenAI 지원을 Muse에도 자동 적용하지 않는다. Muse는 브라우저 대화 경로를 유지하며 공식 Connector는 별도로 검증한다.

## 8. Phase 4A 산출물과 완료 조건

### 산출물

1. 실행 호스트·저장소·세션 바인딩, capability probe, 버전 고정 기록.
2. App Server adapter와 제한된 CLI resume/queue 경로.
3. `codex_send/status/result` schema, 영속 job journal, 실행·검토 상태.
4. 승인 요청 전달, 웹 클라이언트 로그, dot 검토·후속 지시와 모든 토론 참여자의 재평가.
5. 재연결·중복 요청·활성 세션 충돌·작업 공간 변경의 복구 기록.

### 완료 조건

- 등록한 세션에서 이전 맥락을 확인하고 추가 지시를 수행한다.
- dot이 만든 지시가 실제 대상 세션에 도달하고 결과가 dot과 관제실에 회수된다.
- 동일 세션에 후속 수정 1회 이상을 수행하고 새 revision의 검증 결과를 남긴다.
- Discussion에 연결한 검증은 같은 evidence snapshot을 GPT OAuth·API·browser 참여자에 제공하고 결과 비교까지 갱신한다.
- 실행 중 추가 지시는 기본 대기하며, steer는 검증된 현재 turn만 대상으로 한다.
- 중복 제출과 실행 중 연결기 재시작이 중복 turn·중복 코드 변경을 만들지 않도록 대조된다. 확정할 수 없는 사례는 reconciling/blocked로 남긴다.
- 승인 요청이 있는 실제 흐름과 실패·중단 상태를 성공으로 표시하지 않는다.
- 웹 클라이언트를 닫아도 실행이 계속되고 재접속 시 기록이 복구된다.
- 기존 사용자 변경·세션을 보존하고 기본 브랜치 push·자동 merge·deploy를 수행하지 않는다.

현재 위 항목은 모두 NOT_RUN이다. 문서 작성·UI 시안·offline fixture를 실제 Codex 또는 dot 실행 성공으로 대신하지 않는다.

## 9. 공식 근거

2026-10-29 확인. 설치 버전에서 지원하는 기능을 다시 확인해 사용한다.

- [Codex CLI reference](https://learn.chatgpt.com/docs/cli/reference): exec resume, queue, 실행 옵션.
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode): 특정 세션 재개와 출력.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): thread/resume, turn/start, turn/steer, 상태·승인.
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels): private MCP 연결과 권한.
- [MCP Events](https://developers.openai.com/plugins/build/mcp-events): dot 이벤트 구독과 전달; 계정 검증 필요.
