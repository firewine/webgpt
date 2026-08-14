# 웹쫀쿠 Living Design Document

- 문서 상태: Living Design Document
- 버전: v0.2
- 기준일: 2026-08-14
- 문서 형식: Markdown
- 원칙: 이후의 아이디어, 설계 결정, 구현 메모는 이 문서에 누적 업데이트한다.

---

## 1. 제품 정의

### 1.1 웹쫀쿠란?

웹쫀쿠는 일반적인 LLM API 기반 멀티에이전트 프레임워크가 아니다.

**사용자가 이미 보유하고 로그인한 웹 기반 LLM 계정을 실제 작업자처럼 사용하고, 웹쫀쿠가 각 작업자에게 일을 시킨 뒤 결과를 다시 회수해 다음 작업으로 연결하는 멀티에이전트 관제/오케스트레이션 시스템**이다.

핵심 목표는 다음과 같다.

> API 토큰을 소비하는 AI Agent 시스템이 아니라, 사용자가 구독 중인 웹 LLM들을 여러 명의 소프트웨어 회사 직원처럼 조직하고 자동으로 협업시키는 시스템.

웹쫀쿠는 그 전체 과정을 한 화면에서 관찰하고 개입할 수 있는 **AI Software Company Control Room** 역할을 한다.

### 1.2 핵심 원칙

1. 모델 API 호출을 기본 실행 방식으로 사용하지 않는다.
2. 실제 작업은 ChatGPT, Claude, Gemini 등 웹 LLM 세션에서 수행한다.
3. 가능한 경우 각 서비스가 공식적으로 지원하는 OAuth / MCP / Connected App 기능을 우선 사용한다.
4. 공식 연결 수단만으로 부족한 구간은 Provider별 Web Session Adapter로 추상화한다.
5. 각 팀은 사용할 LLM Provider/계정을 별도로 지정할 수 있다.
6. 역할(Role)과 LLM 계정(Account)은 분리한다.
7. 모든 실제 업무는 Task Queue를 통해 추적한다.
8. 에이전트의 대화보다 결과물(Task, Code, Review, Wiki, Decision)을 중심으로 시스템을 설계한다.
9. 중요한 작업과 위험한 권한은 Human 승인 경계를 둔다.
10. 모든 행동은 Event Log로 남겨 재현 가능하게 한다.

---

## 2. 현재 가용 LLM 자원

초기 웹쫀쿠는 아래 계정 자원을 기준으로 설계한다.

| Account ID | Provider | 수량 | 사용 형태 | 비고 |
|---|---|---:|---|---|
| gpt-01 | ChatGPT | 1 | Web LLM | 계정/요금제별 공식 MCP 기능 확인 필요 |
| gpt-02 | ChatGPT | 1 | Web LLM | 독립 브라우저 프로필 사용 |
| gpt-03 | ChatGPT | 1 | Web LLM | 독립 브라우저 프로필 사용 |
| claude-01 | Claude | 1 | Web LLM | Remote MCP 연결 우선 검토 |
| gemini-01 | Gemini | 1 | Web LLM only | API 사용 불가, 웹 세션 전용으로 취급 |

### 2.1 초기 동시 실행 한도

초기 구현에서는 보수적으로 **계정 1개 = Active Seat 1개**로 본다.

따라서 실제로 동시에 작업을 수행하는 최대 작업자 수는 우선 5명이다.

가상 Role은 5개보다 많이 만들 수 있지만, 실제 작업이 필요할 때 비어 있는 Seat를 할당받아야 한다.

```text
Virtual Roles
  PM
  Architect
  Researcher
  Backend
  Frontend
  Reviewer
  QA
  DevOps
  Archivist
      |
      v
Seat Scheduler
      |
      +-- GPT Seat 01
      +-- GPT Seat 02
      +-- GPT Seat 03
      +-- Claude Seat 01
      +-- Gemini Seat 01
```

향후 Provider가 동일 계정에서 안정적인 병렬 세션을 허용하고 웹 자동화 충돌이 없다는 것이 검증되면 Account별 `max_concurrency`를 조정할 수 있다.

---

## 3. 가장 중요한 추상화: Role != Account != Session

웹쫀쿠에서는 다음 네 개를 별도 객체로 관리한다.

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

이렇게 해야 서로 다른 역할의 컨텍스트가 섞이지 않는다.

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

현재 계정 구성을 기준으로 한 초기 추천안이다. 확정안은 아니다.

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

웹쫀쿠는 Provider 차이를 Adapter 계층으로 숨긴다.

```text
                   Webjjoku Core
                        |
            +-----------+-----------+
            |                       |
       Task / Events             MCP Server
            |                       |
       Provider Router              |
            |                       |
   +--------+--------+              |
   |        |        |              |
ChatGPT   Claude   Gemini           |
Adapter   Adapter   Adapter         |
   |        |        |              |
   +--------+--------+--------------+
            |
      Logged-in Web LLMs
```

### 7.1 Provider Adapter 공통 인터페이스

```text
open_session(account, role)
send_prompt(session, message)
wait_for_response(session)
read_response(session)
attach_context(session, context)
get_status(session)
close_session(session)
```

공식 MCP를 사용할 수 있는 Provider라면 추가로:

```text
connect_mcp(session, webjjoku_mcp)
wait_for_tool_result(task_id)
```

을 지원한다.

---

## 8. MCP를 웹쫀쿠의 통신 버스로 사용하기

MCP가 가능한 Provider에서는 단순 화면 scraping보다 **웹쫀쿠 자체를 Remote MCP Server로 제공하는 방식**을 우선한다.

웹 LLM이 웹쫀쿠 MCP에 접속하면 다음 Tool을 사용할 수 있다.

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
```

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

이를 통해 최종 응답을 화면에서 다시 파싱하는 의존도를 줄일 수 있다.

---

## 9. OAuth / 인증 설계 원칙

### 9.1 LLM 웹사이트 로그인

웹쫀쿠가 Provider 계정의 비밀번호를 직접 저장하는 구조를 기본으로 하지 않는다.

초기 권장 구조:

1. Account별 독립 Persistent Browser Profile 생성
2. 사용자가 직접 Provider에 로그인
3. 로그인된 브라우저 프로필/세션을 웹쫀쿠가 재사용
4. 세션 만료 시 UI에서 `Re-authentication Required` 표시
5. 재로그인은 사용자가 수행

```text
profiles/
  gpt-01/
  gpt-02/
  gpt-03/
  claude-01/
  gemini-01/
```

각 Profile의 Cookie / Local Storage는 서로 절대 공유하지 않는다.

### 9.2 MCP OAuth

웹 LLM이 Webjjoku Remote MCP Server에 연결할 때는 MCP 표준 OAuth 흐름을 지원하도록 한다.

```text
Web LLM
   |
   | OAuth
   v
Webjjoku MCP Auth Server
   |
   +-- account_id
   +-- allowed_team
   +-- allowed_agent
   +-- scopes
```

예상 Scope:

```text
task:read
task:claim
task:write
wiki:read
wiki:write
issue:create
result:submit
code:read
code:write
```

Role에 따라 최소 권한만 부여한다.

---

## 10. Provider별 초기 전략

> 아래 내용은 2026-08-14 기준 공식 문서 확인 결과를 반영한 구현 가설이며, 실제 계정 요금제/지역/기능 Rollout 여부에 따라 바뀔 수 있다.

### 10.1 Claude

우선순위: **Remote MCP Bridge 우선**

Claude 웹은 Remote MCP 기반 Custom Connector를 공식 지원하므로 Webjjoku MCP를 직접 연결하는 방식을 우선 실험한다.

예상 흐름:

```text
claude.ai
   |
   +-- Webjjoku Custom Connector
          |
          +-- task_claim
          +-- context_get
          +-- result_submit
```

Claude Seat는 웹쫀쿠에서 가장 먼저 MCP-native Agent로 구현할 후보이다.

### 10.2 ChatGPT

우선순위: **계정별 기능 확인 후 MCP 또는 Web Adapter 선택**

ChatGPT 웹에는 MCP 기반 Custom App/Connector 기능이 존재하지만, 플랜과 기능 종류에 따라 쓰기/수정 Tool 지원 범위가 달라질 수 있다.

따라서 각 GPT 계정에 대해 다음 Capability Probe를 실행한다.

```text
supports_custom_mcp
supports_mcp_read
supports_mcp_write
supports_oauth
supports_background_or_long_task
```

`result_submit` 같은 write Tool이 정상 호출된다면 MCP-native 모드를 사용한다.

그렇지 않다면 Web Session Adapter를 사용해 Prompt 전송 + 응답 회수 방식으로 동작시킨다.

### 10.3 Gemini

현재 계정은 **Gemini Web LLM only**로 취급한다.

Gemini 웹의 Custom MCP는 Gemini Spark 등 특정 자격 조건에 의존할 수 있으므로 초기 MVP에서 필수 기능으로 가정하지 않는다.

초기 전략:

```text
gemini-01
   -> Persistent Web Session
   -> Prompt Injection
   -> Response Capture
```

향후 해당 계정에서 공식 Custom MCP/Connected App 사용 가능 여부가 확인되면 MCP-native 모드로 승격한다.

Gemini는 초기에는 다음 역할에 적합하다.

- 독립적인 Second Opinion
- Web Research
- 요구사항 검토
- 긴 문서/자료 분석
- 다른 에이전트 결과의 교차 검증

---

## 11. Web Session Adapter

공식 MCP만으로 모든 Provider를 제어할 수 없을 가능성에 대비한다.

### 11.1 역할

Web Session Adapter는 로그인된 웹 LLM 화면에 작업 지시를 전달하고 응답을 회수한다.

```text
Task
  |
Prompt Builder
  |
Web Session Adapter
  |
Browser Profile
  |
Provider Web LLM
  |
Response Collector
  |
Result Parser
```

### 11.2 Adapter에서 해야 할 일

- 정확한 계정 프로필 선택
- 새 대화 생성 또는 기존 Agent 대화 열기
- Prompt 입력
- 전송
- 생성 상태 감지
- 완료 응답 수집
- 오류/제한/로그인 만료 감지
- 필요 시 재시도
- Event Log 기록

### 11.3 Adapter에서 하지 말아야 할 일

- 패스워드 평문 저장
- Captcha 우회
- 비정상적인 인증 우회
- Provider 보안 장치 무력화
- 무제한 병렬 실행 가정

Provider 정책/기능 변경에 대응하기 위해 Adapter는 Core와 철저히 분리한다.

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

동일 Task를 두 Agent가 동시에 가져가지 못하게 DB Lock을 사용한다.

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

mcp.tool_called
mcp.tool_completed
mcp.auth_required

review.started
review.approved
review.rejected

wiki.updated
decision.created
issue.created
```

Control Room의 채팅 화면은 이 Event를 사람이 읽기 좋은 메시지로 렌더링한다.

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

Coder가 실제 Repository를 수정할 때는 독립 Workspace를 사용한다.

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
- 위험한 Merge/Deploy는 Human 승인 가능

---

## 18. UI - Control Room

메인 화면 초안:

```text
+------------------------------------------------------------------+
| WEBJJOKU CONTROL ROOM                                             |
| Seats 4/5 | Queue 11 | Review 2 | Blocked 1 | [Pause All]        |
+----------------+--------------------------------+----------------+
| COMPANY        | LIVE OFFICE                    | WORK           |
|                |                                |                |
| Product        | PM: 요구사항 분해 중           | READY 7        |
|  GPT-01        |                                | RUNNING 4      |
|                | Claude: TASK-184 조사 완료     | REVIEW 2       |
| Architecture   |                                | BLOCKED 1      |
|  Claude-01     | GPT-02: Backend 수정 중        |                |
|                |                                |                |
| Engineering    | Gemini: 교차검증 시작          |                |
|  GPT-02        |                                |                |
|  GPT-03        | SYSTEM: TASK-183 DONE          |                |
|                |                                |                |
| Research       |                                |                |
|  Gemini-01     |                                |                |
+----------------+--------------------------------+----------------+
```

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

## 21. v0.1 MVP 범위

### 반드시 구현

- [ ] Markdown Living Design Document
- [ ] Project 생성
- [ ] LLM Account 등록
- [ ] Account별 Persistent Browser Profile
- [ ] 5개 Seat 상태 관리
- [ ] Team 생성
- [ ] Team별 Preferred/Fallback LLM 지정
- [ ] Role / Policy 설정
- [ ] Task Queue
- [ ] Seat Scheduler
- [ ] Provider Adapter 인터페이스
- [ ] ChatGPT Web Adapter 최소 1개
- [ ] Claude Web Adapter 최소 1개
- [ ] Gemini Web Adapter 최소 1개
- [ ] Webjjoku Remote MCP Server
- [ ] Claude MCP 연동 PoC
- [ ] ChatGPT MCP Capability Probe
- [ ] Gemini MCP Capability Probe
- [ ] `result_submit` Tool
- [ ] Event Log
- [ ] Control Room
- [ ] Human Pause / Reassign

### v0.1 이후

- [ ] Git worktree 자동 생성
- [ ] 자동 Code Review
- [ ] Wiki 자동 관리
- [ ] Agent 조직 개선 제안
- [ ] Morning Brief
- [ ] Provider 사용량/제한 추적
- [ ] 자동 로그인 만료 감지
- [ ] Browser crash recovery
- [ ] Multi-project
- [ ] Mobile Control Room

---

## 22. 첫 번째 기술 PoC

전체 UI를 만들기 전에 아래 한 사이클을 먼저 성공시키는 것을 목표로 한다.

```text
Webjjoku
   |
   | TASK-001 생성
   v
Claude Web Seat
   |
   | MCP: task_get()
   v
Claude가 작업 수행
   |
   | MCP: result_submit()
   v
Webjjoku
   |
   | Event 저장
   v
Control Room에 완료 표시
```

이 흐름이 성공하면 웹쫀쿠의 핵심 가설이 검증된다.

그 다음 GPT Seat와 Gemini Seat를 같은 Adapter Interface에 붙인다.

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
- Task별 conversation 옵션
- Seat Scheduler가 Active Task 수 제한

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
OAuthConnection
MCPConnection

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

다음 순서로 상세화한다.

1. Team / Role 목록 확정
2. 각 Role의 Prompt/Policy 작성
3. Account / Seat / Session 데이터 모델 확정
4. Webjjoku MCP Tool Schema 확정
5. Claude MCP PoC 설계
6. ChatGPT Web/MCP Capability Probe 설계
7. Gemini Web Adapter 설계
8. Seat Scheduler 규칙 확정
9. Control Room Wireframe
10. 실제 기술 스택 선정

---

## 26. 외부 플랫폼 기능 검증 메모

2026-08-14 기준 공식 문서에서 확인한 내용이다. 구현 전에 다시 검증한다.

### ChatGPT

- ChatGPT에는 Apps/Custom MCP 방식이 존재한다.
- OAuth 기반 연결을 지원하는 App/Connector 흐름이 존재한다.
- Custom MCP 및 write/modify 기능의 사용 가능 범위는 플랜/워크스페이스/롤아웃 상태에 따라 달라질 수 있다.

참고:
- https://help.openai.com/en/articles/11487775-apps-in-chatgpt
- https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta

### Claude

- Claude 웹은 Remote MCP 기반 Custom Connector를 공식 지원한다.
- Free/Pro/Max/Team/Enterprise에서 Remote MCP Custom Connector를 사용할 수 있으며 일부 기능은 Beta 상태이다.
- OAuth Client 정보를 이용한 MCP 인증 설정을 지원한다.

참고:
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities

### Gemini

- Gemini 웹은 일반 Web App 및 Gems 기능을 제공한다.
- Custom MCP 연결은 Gemini Spark의 Custom Connected Apps 기능 등 제한된 자격 조건에서 제공될 수 있다.
- 따라서 현재 gemini-01은 Web LLM only Seat로 우선 설계한다.

참고:
- https://support.google.com/gemini/answer/17209137
- https://support.google.com/gemini/answer/13695044

---

## 27. 변경 이력

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

> 웹쫀쿠는 API로 LLM을 호출하는 멀티에이전트 프로그램이 아니다. 사용자가 로그인한 여러 웹 LLM 계정을 AI 소프트웨어 회사의 실행 자원으로 사용하고, 팀과 역할에 따라 업무를 배정하며, 가능한 경우 OAuth와 공식 MCP를 통해 작업과 결과를 구조적으로 교환하고, 부족한 부분은 Provider별 Web Session Adapter로 연결하는 AI 회사 관제/오케스트레이션 시스템이다.
