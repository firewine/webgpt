# 웹쫀쿠 Living Design Document

- 문서 상태: Living Design Document
- 버전: v0.4
- 최초 기준일: 2026-08-14
- 개정일: 2026-10-29 (KST)
- 문서 형식: Markdown
- 원칙: 이후의 아이디어, 설계 결정, 구현 메모는 이 문서에 누적 업데이트한다.
- 현재 릴리스 순서·완료 조건: [개발 계획서](./development-plan.md)
- 우선 코드 실행: [Codex 세션 실행 계획](./codex-session-plan.md)
- 서버·태블릿: [Ubuntu 운영 계획](./ubuntu-operations.md)
- 선택 코드 실행 모듈: [Git Writer PRD](./prd.md) / [상세 계획](./git-writer-plan.md)

> 현재 첫 PoC는 Ubuntu 서버 Chrome의 GPT dot·Muse 왕복 대화와 태블릿 HTTPS 접속이다. 이후 dot이 프롬프트를 만들고 사용자의 기존 Codex 세션이 개발을 수행하는 흐름을 연결한다. 조직·팀·Wiki는 장기 설계이며 구현·실서버·실계정 검증 증거는 아직 없다.

---

## 1. 제품 정의

### 1.1 웹쫀쿠란?

웹쫀쿠는 일반적인 LLM API 기반 멀티에이전트 프레임워크가 아니다.

**사용자의 로그인된 웹 AI와 기존 Codex 실행 환경에 업무를 배정하고, 결과를 검토해 다음 지시로 연결하는 관제·오케스트레이션 시스템**이다. Ubuntu 서버가 실행을 유지하고 태블릿에서 관찰·개입한다.

핵심 목표는 다음과 같다.

> 기존 웹 AI가 기획·조율·검토를, 사용자의 Codex가 실제 개발을 수행하고 웹쫀쿠가 작업·세션·결과를 연결하는 시스템. 모델 API 호출을 기본 실행 경로로 두지 않으며 MCP·터널의 별도 인증 요건은 충족한다.

웹쫀쿠는 그 전체 과정을 한 화면에서 관찰하고 개입할 수 있는 **AI Software Company Control Room** 역할을 한다.

### 1.2 핵심 원칙

1. 모델 API 호출을 기본 실행 방식으로 사용하지 않는다.
2. 기획·조율·검토는 웹 대화·에이전트, 우선 코드 실행은 Ubuntu의 등록된 Codex 세션에서 수행한다.
3. 가능한 경우 각 서비스가 공식적으로 지원하는 OAuth / MCP / Connected App 기능을 우선 사용한다.
4. 공식 연결 수단만으로 부족한 구간은 Provider별 Web Session Adapter로 추상화한다.
5. 각 팀은 사용할 LLM Provider/계정을 별도로 지정할 수 있다.
6. 역할(Role)과 LLM 계정(Account)은 분리한다.
7. 모든 실제 업무는 Task Queue를 통해 추적한다.
8. 에이전트의 대화보다 결과물(Task, Code, Review, Wiki, Decision)을 중심으로 시스템을 설계한다.
9. 중요한 작업과 위험한 권한은 Human 승인 경계를 둔다.
10. 모든 행동은 Event Log로 남겨 재현 가능하게 한다.
11. 태블릿 연결과 서버 실행의 수명을 분리하고 재접속 시 상태·기록을 복구한다.
12. Tailscale 사용자 관제 통로와 dot의 Secure MCP Tunnel 통로를 구분한다.

---

## 2. 계정 자원과 연결 대상

기존 GPT 3·Claude 1·Gemini 1 구성은 2026-08-14의 기획 입력이다. 아래 계정 이름은 논리적 식별자이며 현재 로그인·구독·가용성이 검증됐다는 의미가 아니다.

| 대상 | 구분 | 현재 계획 |
| --- | --- | --- |
| gpt-01 / gpt-02 / gpt-03 | 기존 ChatGPT 계정 후보 3개 | 실제 프로필·계정 확인 후 등록 |
| claude-01 | 기존 Claude 계정 후보 | 후속 Provider 확장 |
| gemini-01 | 기존 Gemini 웹 계정 후보 | 후속 Provider 확장 |
| GPT dot | ChatGPT 계정에 연결된 agent/surface | 첫 Chrome 대화 PoC; 계정을 추가로 계산하지 않음 |
| muse-01 | Muse 연결 후보 | 첫 Chrome 대화 PoC; 실제 계정 식별 필요 |
| Codex executor | 사용자 Ubuntu의 기존 Codex 실행 환경 | 세션·thread·cwd 등록 후 Phase 4A 실행 연동 |

### 2.1 동시 실행 한도

연결 PoC와 대화 MVP-1은 **전역 활성 작업 1개**로 시작한다. 다중 Seat 확장은 상위 개발 계획 Phase 5에서 수행하며 계정당 활성 작업 1개를 기본으로 한다.

일반 ChatGPT와 dot이 같은 계정을 사용하면 동시 실행 한도도 공유한다. “기존 5개 + dot + Muse = 7개 Seat”로 자동 산정하지 않는다. 실제 연결된 독립 계정·provider의 검증 결과로 실행 용량을 정한다.

Role은 계정보다 많을 수 있지만 실제 작업 시 검증된 Seat를 배정받는다. 동일 계정의 병렬도를 늘리는 것은 별도 검증 이후의 결정이다.

Codex 위임 단계의 전역 한도는 root workflow 1개다. dot 지시 → Codex 실행 → dot 검토를 순차 관리하며 부모의 대기 상태가 자식 실행 슬롯을 막지 않게 한다. Codex thread와 workspace별 단일 작성자 제약을 함께 적용한다.

---

## 3. 가장 중요한 추상화: Role != Account != Session

웹쫀쿠에서는 다음 네 개를 별도 객체로 관리한다. dot·Muse 확장에는 AgentIdentity와 ConversationBinding을 추가해 계정·agent·대화·Chrome 연결을 구분한다.

### 3.1 Role

회사에서의 직무이다.

예:

- Product Manager
- Architect
- Researcher
- Backend Developer
- Frontend Developer
- Reviewer
- QA Engineer
- DevOps
- Archivist

Role은 행동 규칙과 책임을 가진다.

### 3.2 LLM Account

실제로 로그인 가능한 외부 웹 LLM 계정이다.

예:

```text
gpt-01
gpt-02
gpt-03
claude-01
gemini-01
```

Account는 인증 상태, Provider, 가용 상태, 사용량/제한 상태 등을 가진다.

### 3.3 Seat

Account 위에서 실제 작업을 수행하는 실행 슬롯이다.

```text
Account: gpt-02
Seat: gpt-02/default
Current Role: Backend Developer
Current Task: #184
Status: WORKING
```

Role은 Seat를 빌려 작업한다.

### 3.4 Provider Session

Provider 웹사이트에 존재하는 실제 대화 Thread/Tab/Conversation이다.

가능하면 Role별 또는 Task별로 분리한다.

```text
Backend Agent
  -> ChatGPT conversation A

Reviewer Agent
  -> ChatGPT conversation B

Research Agent
  -> Claude conversation C
```

이렇게 해야 서로 다른 역할의 컨텍스트가 섞이지 않는다. 다만 dot의 지속 대화는 task마다 새로 만들지 않고 task ID로 업무를 구분한다. 다른 역할에 해당 대화를 재사용할지는 명시적인 역할·맥락 정책으로 결정한다.

BrowserConnection에는 연결기·프로필 바인딩을, ConversationBinding에는 account·agent·surface·대화 URL/관측 ID·현재 tab ID를 저장한다. 탭 ID만으로 재시작 후 대화를 확정하지 않는다.

### 3.5 Codex 실행 바인딩

실행 호스트·OS 사용자·프로젝트 cwd·저장소·브랜치·CLI 세션 ID·App Server thread ID·활성 turn을 함께 등록한다. `thread.sessionId`는 세션 트리 루트이므로 대상 `thread.id`와 혼용하지 않는다. 세션 ID만으로 접근 권한이나 실제 작업 공간이 확보됐다고 판단하지 않는다.

기존 사용자 세션의 cwd와 변경을 보존한다. 동일 세션을 별도 프로세스가 이중 재개하거나 `--last`로 다른 대화를 선택하지 않는다. 등록·상태·권한·복구 계약은 [Codex 세션 실행 계획](./codex-session-plan.md)을 따른다.

---

## 4. 팀별 LLM 지정

각 Team은 Preferred Provider와 Fallback Provider를 설정할 수 있어야 한다.

예시 설정:

```yaml
teams:
  product:
    preferred_seats: [gpt-01]
    fallback_seats: [claude-01]

  architecture:
    preferred_seats: [claude-01]
    fallback_seats: [gpt-01]

  backend:
    preferred_seats: [gpt-02]
    fallback_seats: [gpt-03]

  frontend:
    preferred_seats: [gpt-03]
    fallback_seats: [gpt-02]

  research:
    preferred_seats: [gemini-01, claude-01]
    fallback_seats: [gpt-01]
```

### 4.1 초기 추천 배치

아래 표는 8월의 계정 구성을 이용한 후속 조직 확장 예시다. 현재 PoC의 배정이나 확정된 모델 성능 비교가 아니다.

| Team | Primary | Secondary | 이유 |
|---|---|---|---|
| Product / Director | gpt-01 | claude-01 | 목표 정리, 지시, 전체 조율 |
| Architecture / Research | claude-01 | gemini-01 | 설계 검토 및 깊은 분석 |
| Backend Engineering | gpt-02 | gpt-03 | 구현 전담 |
| Frontend Engineering | gpt-03 | gpt-02 | 구현 전담 |
| Cross-check / Web Research | gemini-01 | claude-01 | 웹 LLM 전용 보조 Seat |
| Review / QA | 유휴 Seat 동적 할당 | - | 구현자와 다른 Seat 우선 |

중요한 원칙:

> 팀은 특정 모델을 선호할 수 있지만, Agent 자체를 특정 계정에 영구 고정하지 않는다.

---

## 5. 소프트웨어 회사형 조직

```text
Human Owner
    |
Director / CEO Agent
    |
    +-- Product Team
    |     +-- PM
    |     +-- Analyst
    |
    +-- Architecture Team
    |     +-- Tech Lead
    |     +-- Architect
    |     +-- Researcher
    |
    +-- Engineering Team
    |     +-- Backend Developer
    |     +-- Frontend Developer
    |     +-- Generalist Developer
    |
    +-- Quality Team
    |     +-- Reviewer
    |     +-- QA Engineer
    |
    +-- Platform Team
    |     +-- DevOps / Release
    |
    +-- Knowledge Team
          +-- Archivist
```

조직도는 **책임과 권한**을 표현한다.

실제 실행 순서는 조직도가 아니라 Task Graph / Queue가 결정한다.

---

## 6. 에이전트 규칙 계층

에이전트에게 전달되는 규칙은 하나의 거대한 Prompt가 아니라 계층형으로 구성한다.

```text
Company Constitution
        |
Team Policy
        |
Role Policy
        |
Project Context
        |
Current Task
        |
Relevant Wiki / Code / Decision
```

### 6.1 Company Constitution 초안

1. 모든 작업은 추적 가능해야 한다.
2. Task 없는 코드 수정은 하지 않는다.
3. 자신의 역할 범위를 벗어난 문제는 직접 처리하지 말고 Issue로 제안한다.
4. 실패와 불확실성을 숨기지 않는다.
5. 중요한 기술 결정은 Wiki 또는 ADR로 기록한다.
6. 실행 전에 필요한 Context를 확인한다.
7. main branch 직접 변경은 허용하지 않는다.
8. 반복되는 문제는 Process Improvement Proposal로 제안한다.
9. 모르는 내용을 확정 사실처럼 말하지 않는다.
10. 대화의 양이 아니라 실제 결과물을 최적화한다.

---

## 7. 웹 LLM 연결 구조

| 계층 | 책임 |
| --- | --- |
| Core / Task / Events | 실행 주체·lease, 결과·상태, 사용자 개입 |
| BrowserConnection | 기존 로그인 Chrome에 연결; 프로필·탭 바인딩 |
| ProviderAdapter | 일반 ChatGPT / dot / Muse / Claude / Gemini별 입력·관측 |
| 공식 MCP 연결 | 계정에서 검증한 도구·결과·이벤트 교환 |
| Ubuntu / Tablet | Tailscale HTTPS·SSE·noVNC, 서버 서비스·기록 복구 |
| Codex 실행 어댑터 | 기존 세션에 프롬프트 전달, 실행·승인·결과·후속 지시 |
| Git Writer | 선택 모듈의 격리된 코드 변경·검사·draft PR |

Core·Chrome·연결기·Codex를 Ubuntu 서버에 둔다. 우선 Chrome DevTools MCP autoConnect를 검증하고, 프로필 구분이나 탭 권한 요구가 맞지 않으면 확장 프로그램 + Native Messaging을 검토한다. 태블릿은 서버의 상태를 보는 HTTPS 클라이언트이며 실행을 유지하는 주체가 아니다.

### 7.1 Adapter 계약

공통 기능은 attach/probe, sendMessage, observeConversation, followUp, collectResult, requestStop, detach다. 세부 상태·입출력은 [개발 계획서](./development-plan.md)의 계약을 따른다.

mode 선택·첨부·새 대화·원격 중단·MCP·이벤트는 capability다. 일반 ChatGPT의 reasoning level 컨트롤을 dot·Muse에도 존재한다고 가정하지 않는다. 사용자 대화를 자동 삭제하지 않는다.

---

## 8. MCP를 웹쫀쿠의 통신 버스로 사용하기

MCP가 가능한 Provider에서는 단순 화면 scraping보다 **웹쫀쿠 자체를 Remote MCP Server로 제공하는 방식**을 우선한다.

아래는 장기 도구 후보이다. 상위 Phase 3의 최소 범위는 task_get, context_get, result_submit이며 필요한 경우 task_claim을 추가한다. 일반 MCP 도구 연결만으로 외부에서 웹 대화를 시작할 수 있다고 가정하지 않는다. dot의 이벤트 구독은 별도 capability로 검증한다.

웹 LLM이 인증된 웹쫀쿠 MCP에 접속하고 해당 권한을 가진 경우 다음 Tool을 사용할 수 있도록 설계한다.

### 8.1 Webjjoku MCP Tools 초안

```text
company_get_rules()
team_get_policy(team_id)
agent_get_assignment(agent_id)

task_claim()
task_get(task_id)
task_update_status(task_id, status)
task_create(...)

context_get(task_id)
wiki_search(query)
wiki_write(...)

decision_create(...)
issue_create(...)

agent_post_message(...)
agent_request_help(...)

result_submit(task_id, result)
review_submit(task_id, verdict, comments)

codex_send(task_id, session_binding_id, prompt_revision, idempotency_key, prompt, mode)
codex_status(job_id)
codex_result(job_id)
```

Codex 도구는 Phase 4A에서 추가할 웹쫀쿠 전용 계약이다. 실행 요청은 job ID를 즉시 반환하고 장기 실행을 별도로 추적한다. `steer`에는 실제 대상 turn ID를 추가로 요구한다. 승인 요청·취소는 구현 capability와 기존 Codex 권한에 따른다.

가장 중요한 Tool은 다음이다.

```text
result_submit()
```

웹 LLM에게 단순히 채팅 답변을 생성하게 하는 대신, 작업 종료 시 웹쫀쿠의 MCP Tool을 호출해 **구조화된 결과를 직접 반환**하게 한다.

예:

```json
{
  "task_id": "TASK-184",
  "status": "completed",
  "summary": "refresh token race condition 수정",
  "changed_files": [
    "src/auth/token.ts",
    "tests/auth/token.test.ts"
  ],
  "tests": {
    "passed": 18,
    "failed": 0
  },
  "follow_up_issues": []
}
```

이를 통해 최종 응답을 화면에서 다시 파싱하는 의존도를 줄일 수 있다. 위 completed는 provider가 제출한 결과 상태이며 Core의 업무 done을 자동 확정하지 않는다. 결과는 review로 보내고 코드·검사·PR은 실제 증거와 대조한다.

---

## 9. 로그인과 인증 경계

### 9.1 기존 Chrome 연결

첫 경로는 Ubuntu 서버의 로그인된 Chrome에 연결하는 것이다. 새 서버이면 사용자가 noVNC 원격 화면에서 로그인하고 그 profile을 유지한다. 쿠키·local storage·인증 토큰을 복사해 다른 기기나 프로필로 옮기지 않는다.

1. Chrome 버전과 연결 기능을 확인한다.
2. autoConnect의 실제 프로필 선택과 Chrome 허용 절차를 검증한다.
3. 사용자가 지정한 계정·agent·대화를 바인딩한다.
4. 만료·대상 변경 시 전송을 멈추고 Re-authentication Required 또는 Target Changed를 표시한다.
5. 재로그인은 사용자가 수행하고 연결기는 같은 바인딩을 다시 확인한다.

새 계정이나 전용 실행 환경이 필요할 때만 독립 persistent profile을 만들고 사용자가 로그인한다. 계정 프로필 간 쿠키를 공유하지 않는다. 기존 프로필을 별도 브라우저 프로세스가 동시에 열도록 하지 않는다.

### 9.2 MCP 인증

Provider 웹사이트 로그인과 웹쫀쿠 MCP의 인증은 별개다. 공식 연결이 해당 계정에서 가능한지 확인한 뒤 OAuth 등 검증된 방식을 사용한다.

연결 주체에는 account, agent, project/task 범위와 read/write scope를 매핑한다. task:read, task:claim, result:submit 등의 최소 권한부터 시작한다. 브라우저 로그인 세션과 GitHub credential을 Git Writer sandbox에 전달하지 않는다.

MCP 도구·이벤트 지원은 검증 전까지 UNKNOWN이다. 연결의 이름만 확인하고 도구 접근·권한까지 성공했다고 표시하지 않는다.

### 9.3 Tailscale과 Secure MCP Tunnel

태블릿은 Tailscale Serve의 private HTTPS 주소로 관제실에 접속한다. 기본 예시는 HTTPS 8443 → 서버 loopback 3000이며 실제 포트·접근 정책을 배포 때 확인한다. MagicDNS·HTTPS 인증서와 전체 `*.ts.net` 이름을 사용한다.

dot이 웹쫀쿠 MCP를 호출하는 경로는 별도의 Secure MCP Tunnel이다. 서버에서 outbound HTTPS를 만들고 Platform tunnel·ChatGPT workspace 권한을 검증한다. Tailscale 주소가 OpenAI 서비스에 그대로 접근 가능하다고 가정하지 않는다. 이 터널을 Muse에도 자동 적용하지 않는다.

### 9.4 원격 Chrome 수동 개입

서버 가상 데스크톱의 동일 Chrome을 noVNC/WSS로 보여준다. 최초 로그인·재로그인·Chrome 연결 승인·대화 선택을 태블릿에서 처리한다. 수동 개입 중 자동 입력을 잠그고, 재개 시 계정·대화·전송 상태를 다시 확인한다. 화면 닫기만으로 작업 전송을 재개하지 않는다.

---

## 10. Provider별 초기 전략

2026-10-29 개정. 외부 문서의 지원과 사용자 계정의 실제 검증을 구분한다.

### 10.1 GPT dot

기존 Chrome의 지속 대화에 요청과 후속 질문을 전송한다. 일반 ChatGPT와 별도 어댑터로 만들되 같은 계정의 자원 한도를 공유한다. 대화 응답 완료와 비동기 업무 완료를 구분한다.

공식 문서상 dot에서 MCP Events를 사용할 수 있다. 사용자가 감시할 이벤트와 동작을 지정해 구독한 후 이벤트를 보내는 경로를 Phase 3에서 검증한다. HTTP 접수 성공을 업무 완료로 취급하지 않는다.

Phase 4A에서는 dot이 실행 프롬프트를 작성해 `codex_send`를 호출하고 `codex_result`로 결과를 읽어 검토한다. 후속 수정은 동일 Codex 세션의 새 prompt revision으로 보낸다. 자동 반복에는 횟수·시간·종료 조건을 둔다.

### 10.2 Muse

기존 로그인된 Muse 대화의 UI 입출력부터 검증한다. 공식 Connector는 Muse가 외부 API/MCP 도구를 사용하는 경로로 별도 검토한다. 임의 Muse 대화를 외부에서 시작하는 API가 확인됐다고 표시하지 않는다.

### 10.3 일반 ChatGPT

일반 Chat 화면의 대화·모델 컨트롤을 별도 어댑터로 구현한다. Nhahan/WebGPT의 전송·응답 관측 방식은 참고하되 해당 CUA helper를 독립 Chrome 엔진으로 간주하지 않는다.

### 10.4 Claude / Gemini

후속 Provider 확장으로 유지한다. 실제 계정의 공식 연결·write tool·결과 제출 기능을 확인한 뒤 Web/MCP 경로를 선택한다. 이전 문서의 요금제·지역·기능 가정을 현재 capability로 승계하지 않는다.

---

## 11. Web Session Adapter

### 11.1 실행 흐름

Task와 대화 바인딩을 저장하고, 화면을 관측해 입력 준비 상태를 확인한 뒤 한 번 전송한다. 실제 사용자 메시지 생성 여부를 확인하고 해당 요청의 응답을 회수한다. 같은 대화의 후속 요청은 별도 attempt로 기록한다.

### 11.2 상태·복구 책임

- 요청 전에 task/attempt/계정/대화와 요청 digest를 영속 저장.
- 전송 확인 receipt 또는 SEND_UNCONFIRMED 저장.
- timeout·연결 중단 뒤 기존 메시지를 대조하기 전에는 재전송 금지.
- 응답 생성과 업무 running/review/done을 분리.
- 브라우저·Core 재시작 뒤 대화 바인딩과 task를 복원.
- 사용자의 입력·다른 대화 이동 감지 시 자동 전송 중지.
- Pause는 새 전송을 막으며 원격 업무 중단 여부는 별도 확인.
- 프로필·대화별 작업을 구분하고 이벤트를 필요한 범위에서 기록.

### 11.3 보존·권한 책임

비밀번호·쿠키를 복제하지 않고 인증 우회를 하지 않는다. Captcha·로그인·Chrome 연결 승인은 사용자 조작으로 처리한다. 대화 자동 영구 삭제를 기본 동작으로 두지 않는다.

공식 result_submit이 검증된 provider는 구조화된 결과를 사용한다. 브라우저 경로와 이벤트 경로가 동시에 같은 업무를 시작하지 않도록 Core가 실행 경로를 고정한다.

---

## 12. Agent 작업 프로토콜

Agent가 Seat를 배정받으면 아래 프로토콜을 따른다.

```text
IDLE
  |
  v
CLAIM TASK
  |
  v
LOAD RULES
  |
  v
LOAD CONTEXT
  |
  v
WORK ON WEB LLM
  |
  +---- needs help ----> REQUEST HELP / BLOCKED
  |
  v
SUBMIT RESULT
  |
  v
REVIEW
  |
  +---- rejected ------> REWORK
  |
  v
DONE
```

작업 상태:

```text
backlog
ready
claimed
running
blocked
review
rework
done
failed
cancelled
```

---

## 13. Work Queue

Task Queue는 웹쫀쿠의 실제 운영 중심이다.

```text
Task
- id
- project_id
- title
- description
- type
- team
- required_role
- preferred_provider
- preferred_seat
- priority
- status
- dependencies[]
- created_by
- claimed_by
- provider_session_id
- conversation_binding_id
- dispatch_attempt_id
- result
- review_result
- created_at
- updated_at
```

### 13.1 Seat Scheduler 규칙

1. Ready Task를 선택한다.
2. 필요한 Role을 확인한다.
3. Team의 Preferred Seat를 확인한다.
4. 사용 가능한 Seat를 찾는다.
5. 없으면 Fallback Seat를 확인한다.
6. Seat를 Task에 Lock한다.
7. 작업 종료 후 Seat를 해제한다.

동일 Task를 두 Agent가 동시에 가져가지 못하게 DB Lock/lease를 사용한다. 대화 MVP-1에서는 전역 활성 작업 1개를 강제한다. 이미 전송된 Task는 timeout만으로 다른 Seat에 재배정하지 않고 원래 실행 상태를 확인한다.

---

## 14. Discussion과 실제 작업 분리

에이전트들의 자유 토론이 무한히 이어지는 것을 막는다.

Discussion에는 종료 조건을 둔다.

예:

- 최대 N Turn
- 최대 시간
- 최대 LLM 요청 수

종료 시 반드시 아래 중 하나로 변환한다.

```text
Task 생성
Decision 생성
RFC 생성
Issue 생성
No Action
```

> 대화는 상태가 아니라 이벤트이다. 실제 상태는 Task / Decision / Wiki에 저장한다.

---

## 15. Event Log

모든 Agent 활동은 구조화된 Event로 저장한다.

```text
agent.assigned
agent.started
agent.message
agent.waiting
agent.failed

task.created
task.claimed
task.started
task.blocked
task.submitted
task.completed

provider.session_opened
provider.prompt_sent
provider.response_started
provider.response_received
provider.login_required
provider.rate_limited
provider.disconnected
provider.reconnected
provider.target_changed
provider.send_unconfirmed
provider.response_completed

mcp.tool_called
mcp.tool_completed
mcp.auth_required

codex.job_accepted
codex.job_queued
codex.turn_started
codex.approval_required
codex.output_received
codex.reconciling
codex.turn_completed
codex.turn_failed
codex.turn_interrupted

review.started
review.approved
review.rejected

wiki.updated
decision.created
issue.created
```

Control Room은 Event를 사람이 읽기 좋은 메시지로 렌더링하고 SSE로 전달한다. 영속 cursor·snapshot·중복 제거로 태블릿 절전·네트워크 전환 이후 누락 로그를 복원한다. 응답 관측과 Codex 실행 이벤트를 구분하고 재연결을 작업 재실행으로 연결하지 않는다.

---

## 16. Wiki / Shared Memory

에이전트가 매번 전체 대화를 읽지 않도록 프로젝트 지식을 문서화한다.

```text
/wiki
  project-overview.md

  architecture/
  research/
  decisions/
  incidents/
  conventions/
```

Agent Context는 다음 순서로 구성한다.

```text
Company Rules
+ Team Rules
+ Role Rules
+ Current Task
+ Relevant Wiki
+ Relevant Code
+ Recent Decisions
```

---

## 17. 코드 작업 격리

상위 Phase 4A에서 기존 Codex 세션을 우선 연결한다. 실제 세션의 cwd·feature branch·worktree와 기존 사용자 변경을 확인해 등록한다. 세션 재개만으로 새 격리 작업 공간이 생겼다고 간주하지 않는다. 기본 브랜치나 다른 작업과 충돌하면 작업 공간을 명시적으로 다시 선택한다.

Codex의 기존 sandbox·승인 설정을 유지하고 프롬프트를 셸로 평가하거나 실행 권한을 자동 확대하지 않는다. 세션·작업 공간별 단일 작성자를 보장하고 결과·검사 근거를 dot 검토로 연결한다.

Phase 4B의 선택 Git Writer는 자체의 독립 workspace·sandbox·remote broker 조건을 검증한다. 아래 worktree 구조와 Git Writer 격리 보장은 이 별도 모듈에 해당한다. 첫 Chrome 대화 PoC에는 코드 수정·terminal 실행 권한을 포함하지 않는다.

```text
repo/
  main

worktrees/
  TASK-101/
  TASK-102/
  TASK-103/
```

원칙:

- Task별 git worktree 또는 sandbox
- main 직접 수정 금지
- 테스트 필수
- Review 후 Merge
- Git Writer MVP는 draft PR까지; 자동 merge/deploy 제외
- 자동 병합은 후속 release gate와 범위 승인 이후에만 구현

---

## 18. UI - Control Room

대화 MVP-1은 Ubuntu 서버를 태블릿에서 조작하는 반응형 화면이다. 제시한 완성형 시안의 데이터·연결·PR·검사 수치는 예시이며 구현 성공 증거가 아니다. 조직·다중 Seat는 후속 확장으로 유지한다.

| 화면 | 역할 |
| --- | --- |
| 관제실 | 작업 선택, 대화·결과·활동, 추가 지시, Pause/Resume |
| 작업 | 대기·실행·검토·완료 상태와 담당자 |
| 연결 | dot·Muse 계정/대화, 서버 Chrome, Codex 세션, 인증·개입 필요 |
| 결과·기록 | 관측된 산출물·검증 근거·검토 이력 |
| 팀과 규칙 | 역할 배정·실행 한도·보존·권한 설정 |

Chrome 프로필 선택·연결 완료는 실제 capability가 확인된 경우만 표시한다. 원격 Chrome 화면은 연결·재로그인·개입 화면에서 연다. 태블릿을 닫아도 서버 실행을 유지하고 복귀 시 최신 상태를 복원한다. 가로·세로, 좁은 화면, 터치와 한국어 입력을 실제 사용자 태블릿에서 검증한다.

### 18.1 Account / Seat 화면

```text
GPT-02
Provider: ChatGPT
Status: WORKING
Role: Backend Developer
Task: TASK-184
Auth: OK
MCP: UNKNOWN / READ / WRITE
Current conversation: xxx
Last activity: 23:41

[Open Web Session]
[Pause Seat]
[Re-authenticate]
[Change Team]
```

### 18.2 Team Settings 화면

각 팀마다 다음을 설정한다.

```text
Team Name
Preferred LLM Account
Fallback Accounts
Allowed Roles
Max Concurrent Tasks
Team Policy
Review Policy
MCP Permissions
```

---

## 19. Human Override

사용자는 언제든 시스템에 개입할 수 있어야 한다.

- 전체 Pause
- Seat Pause
- Task Cancel
- Priority 변경
- Task 재배정
- 특정 Agent에게 직접 메시지
- Browser Session 직접 열기
- 재로그인
- Review 강제 요청
- Merge 승인/거절
- 조직 설정 변경

---

## 20. 조직 개선 제안

Agent는 반복되는 문제를 발견하면 프로세스 변경을 제안할 수 있다.

```text
Process Improvement Proposal
- proposed_by
- evidence
- problem
- suggested_change
- expected_effect
- required_permission
```

예:

> 최근 Backend Task 6건 중 3건에서 migration 검증이 누락되었습니다. Backend 완료 조건에 migration-check를 추가할 것을 제안합니다.

조직/권한 변경은 Human 승인 후 적용한다.

---

## 21. 릴리스별 범위

정확한 단계와 완료 조건은 [개발 계획서](./development-plan.md)를 따른다.

### 대화 PoC / MVP-1

- [x] 개정 개발 계획과 Living Design
- [ ] 기존 로그인 Chrome 연결·프로필·계정 바인딩
- [ ] GPT dot·Muse 각각의 요청·후속 질문·응답 회수
- [ ] Task·Attempt·Event 영속화와 전송 중복 방지
- [ ] 기존 대화 보존·재시작 복구·인증 필요 표시
- [ ] 전역 활성 작업 1개와 최소 Control Room
- [ ] Pause / Resume / Cancel / 사용자 개입
- [ ] Ubuntu profile과 실제 사용자 태블릿 적합성
- [ ] Tailscale HTTPS·SSE 재연결·noVNC 로그인/승인·서버 재부팅 복구

### 후속 단계

- [ ] MCP 구조화된 작업·결과 교환과 dot 이벤트 PoC
- [ ] Muse Connector capability 확인
- [ ] Secure MCP Tunnel과 dot의 실제 도구 호출
- [ ] 기존 Codex 세션 등록·프롬프트 실행·검토·동일 세션 후속 지시
- [ ] 선택 Git Writer와 sandbox·checks·draft PR
- [ ] 일반 ChatGPT·Claude·Gemini 확장
- [ ] 팀별 Preferred/Fallback 및 검증된 다중 Seat
- [ ] Wiki·자동 Review·조직 개선 제안·Morning Brief
- [ ] 조건부 자동 병합·운영 고도화·macOS 등 추가 OS·다중 프로젝트

이전의 “세 Provider와 5 Seat를 첫 릴리스에 모두 구현” 범위는 위 순서로 대체한다.

---

## 22. 첫 번째 기술 PoC

Ubuntu의 버전·실행 사용자·profile과 Tailscale HTTPS·noVNC 접속을 먼저 확인한다. 서버 Chrome에서 로그인·연결 승인을 처리한 뒤 dot과 Muse에서 다음 흐름을 **각각 순차 수행**한다.

1. 사용자가 지정한 계정·agent·대화를 확인한다.
2. 요청 1개를 전송하고 실제 사용자 메시지 생성과 응답을 확인한다.
3. 같은 대화에 후속 질문 2개를 보내 맥락 유지와 결과 회수를 확인한다.
4. 연결기를 재시작하고 기존 대화를 재식별한다.
5. 기존 요청을 중복 전송하지 않고 이어서 대화한다.
6. 초기 응답과 비동기 업무 완료를 구분할 관측 근거를 기록한다.

첫 PoC에는 전체 UI·조직도·Git Writer가 필요하지 않다. 실제 전송 증거가 없으면 PASS로 표시하지 않는다. dot과 Muse의 대화는 기본 보존한다.

이전 Claude MCP 우선 PoC는 후속 Provider/공식 연결 실험으로 이동한다.

---

## 23. 현재 기술 리스크

### R1. Provider Web UI 변경

웹 UI 자동화는 DOM/동작 변경에 영향을 받는다.

대응:

- Provider Adapter 분리
- UI selector 최소화
- MCP 가능한 영역은 MCP 우선
- Browser 상태 진단 기능 제공

### R2. 계정별 사용량 제한 / Rate Limit

웹 구독은 API처럼 정확한 quota 정보를 제공하지 않을 수 있다.

대응:

- rate-limit/usage-limit 화면 감지
- Seat 자동 휴식 상태
- Fallback Seat 전환

### R3. 로그인 / 인증 만료

대응:

- Persistent profile
- 사용자가 직접 Re-auth
- 세션 만료 Event 발생

### R4. MCP 기능 차이

Provider와 요금제마다 Remote MCP / Write Tool / OAuth 지원 범위가 다를 수 있다.

대응:

- `ProviderCapability` 테이블
- 로그인 후 자동 Capability Probe
- MCP / Web Adapter Hybrid

### R5. 한 계정에서 여러 Role의 Context 혼선

대응:

- Role별 별도 conversation
- 일반 대화는 Task별 conversation 옵션; dot은 지속 대화와 Task 연결을 보존
- Seat Scheduler가 계정 공유 한도와 Active Task 수 제한

### R6. 전송 불확실과 비동기 완료 오판

- send 전후 journal과 receipt를 영속 저장
- 불확실한 전송을 자동 재시도하지 않고 기존 메시지 대조
- response completed / task review / task done을 구분
- Browser/Event 이중 실행과 timeout만으로 다른 Seat에 재배정하는 동작 차단

### R7. Codex 세션·작업 공간 충돌

- host·cwd·세션/thread/turn을 함께 등록하고 활성 세션을 이중 재개하지 않음.
- 기본 후속 지시는 queue, 명시적 방향 수정만 실제 turn에 steer.
- 기존 사용자 변경·권한을 보존하고 검사 결과를 해당 변경 revision에 연결.

### R8. 태블릿 연결과 서버 실행 수명 혼동

- 서버 서비스와 영속 기록을 태블릿 세션에서 분리.
- SSE snapshot/cursor 재생과 중복 제거, noVNC 수동 개입 잠금.
- 절전·네트워크 전환·서버 재부팅을 실제 기기로 검증.

### R9. Tailscale과 dot MCP 연결 혼동

- 사용자 관제는 private Tailscale HTTPS.
- dot 도구 호출은 검증된 Secure MCP Tunnel과 계정 권한.
- 각 통로의 장애·권한·상태를 독립적으로 표시.

---

## 24. 데이터 모델 초안

```text
Company
Team
Role
Policy
Agent

LLMProvider
LLMAccount
ProviderCapability
Seat
ProviderSession
AgentIdentity
BrowserConnection
ConversationBinding
DispatchAttempt
MessageReceipt
OAuthConnection
MCPConnection
Executor
CodexSessionBinding
CodexJob
ApprovalRequest
EventCursor

Project
Goal
Milestone
Task
TaskDependency

Discussion
Message
Decision
Issue
RFC
WikiPage

Workspace
CodeChange
Review
TestRun

Event
ProcessImprovementProposal
```

---

## 25. 다음 설계 항목

1. Ubuntu 호스트·Tailscale HTTPS 포트·태블릿·원격 Chrome 접속 확인.
2. autoConnect 프로필 선택·연결 허용과 대안 spike.
3. BrowserConnection / ConversationBinding / ProviderAdapter 계약.
4. 메시지 receipt·불확실 전송·응답/업무 상태 schema.
5. 두 서비스의 요청·후속 질문·재연결 E2E.
6. 검증 결과에 맞춘 Core 저장소와 최소 Control Room.
7. 구조화된 결과와 공식 이벤트·Connector capability.
8. 기존 Codex 세션 바인딩·실행·승인·결과 검토·후속 지시.
9. 선택 Git Writer와 Team/Role·다중 Seat 확장.

---

## 26. 외부 플랫폼 기능 검증 메모

2026-10-29 문서·코드를 읽은 결과다. 사용자 계정의 실제 연동은 모두 NOT_RUN이며 구현 시 버전·권한·화면을 검증한다.

| 대상 | 문서상 확인 / 구현 판단 |
| --- | --- |
| Chrome | 144+ autoConnect로 기존 세션 연결, 사용자 허용 및 기본 프로필 제약 |
| dot | 웹 대화와 지속 업무, MCP Events의 dots 지원 |
| Muse | 외부 API/MCP 서비스에 연결하는 Connector 경로; 외부 대화 시작 API는 미확인 |
| Nhahan/WebGPT | 일반 ChatGPT용 CUA helper와 Worker; dot·Muse는 별도 adapter 필요 |
| Claude / Gemini | 이전 8월 기능 메모를 현재 계정 capability로 재사용하지 않음 |
| Codex | exec resume·queue, App Server thread/turn/steer; 실제 설치 버전·세션 확인 필요 |
| Tailscale / noVNC | private HTTPS·웹 원격 화면; Ubuntu·태블릿 E2E 미실행 |
| Secure MCP Tunnel | private MCP의 outbound 연결; 계정·workspace 권한 미검증 |

참고:

- [사용자 제공 글](https://gall.dcinside.com/mgallery/board/view/?id=ai_utilize&no=84956)
- [Nhahan/WebGPT 고정 revision](https://github.com/Nhahan/WebGPT/tree/1d35588e79de288bd8a6d2992fc76e571f7bb75e)
- [Chrome 기존 세션 연결](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)
- [Chrome DevTools MCP advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)
- [Meet dots](https://learn.chatgpt.com/docs/dots)
- [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)
- [Muse Connector guidelines](https://platform.muse.ai/docs)
- [Codex CLI](https://learn.chatgpt.com/docs/cli/reference)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [noVNC](https://novnc.com/info.html)

확인 범위와 검증 계획의 상세 내용은 상위 개발 계획에 기록한다.

---

## 27. 변경 이력

### v0.4 - 2026-10-29

- Ubuntu 서버·Tailscale HTTPS·태블릿 실시간 관제를 기본 운영 환경으로 반영.
- noVNC의 서버 Chrome 로그인·연결 승인·수동 개입, SSE 기록 복구 명시.
- dot의 프롬프트 작성·기존 Codex 세션 실행·결과 검토·후속 지시 추가.
- 세션 바인딩·job·turn·승인·단일 작성자와 두 네트워크 통로 구분.
- Git Writer를 선택 모듈로 유지하고 macOS 동시 릴리스 요구를 후속 확장으로 변경.
- 시안과 실제 기능 검증을 구분하고 운영·Codex 상세 계획 연결.

### v0.3 - 2026-10-29

- 첫 검증을 기존 Chrome의 dot·Muse 왕복 대화로 변경.
- 계정·dot·Seat 구분과 초기 전역 동시 작업 1개 명시.
- 대화 보존, 영속 전송 기록, 응답/업무 상태와 재연결 조건 추가.
- MCP Events·Muse Connector의 문서상 지원과 계정 미검증 구분.
- Nhahan/WebGPT를 참고하되 Chat 전용 CUA helper·전체 terminal·자동 삭제 정책을 분리.
- Git Writer를 하위 실행 모듈로 연결하고 첫 릴리스·후속 조직 확장 범위 정합화.

### v0.2 - 2026-08-14

- 개발 문서를 DOCX에서 Markdown Living Design Document로 전환
- 웹쫀쿠의 핵심 목적을 "API 기반 Agent"에서 "웹 LLM 오케스트레이션"으로 명확히 재정의
- 팀별 LLM Account 지정 기능 추가
- Role / Account / Seat / Provider Session 개념 분리
- 현재 가용 자원 반영: GPT 3, Claude 1, Gemini 1(Web only)
- OAuth 및 Persistent Browser Profile 인증 방향 추가
- 공식 MCP 우선 + Web Session Adapter fallback 구조 추가
- Webjjoku Remote MCP Server 개념 추가
- `result_submit` 중심의 Agent 결과 회수 방식 추가
- Provider Capability Probe 추가
- Claude / ChatGPT / Gemini별 초기 연결 전략 추가
- 초기 동시 실행 한도를 5 Seat로 정의

### v0.1 - 2026-08-14

- AI Software Company / Control Room 개념 정의
- 소프트웨어 회사형 팀 구성
- Company / Team / Role Policy 계층 정의
- Work Queue 중심 실행 구조
- Wiki / Event Log / Review / Git isolation 아이디어 정리

---

## 28. 현재 확정된 핵심 문장

> 웹쫀쿠는 Ubuntu에서 사용자의 로그인된 웹 AI와 기존 Codex 세션을 연결하는 관제 시스템이다. dot이 개발 지시를 만들고 Codex가 실행하며 결과를 다시 검토한다. 사용자는 Tailscale HTTPS로 태블릿에서 진행 상황·대화·검증 결과를 확인하고 필요한 순간에 개입한다. 공식 MCP·이벤트와 브라우저 어댑터는 실제 검증한 범위에서 사용한다.

