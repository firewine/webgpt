# 웹쫀쿠 업무 운영 계약과 구현 순서

- 개정일: 2026-10-30 (KST)
- 요구 기준: [Living Design](./webjjoku_living_design.md)의 Company/Team/Role/Seat·작업 프로토콜·Work Queue·Wiki·Review·Human Override.
- 업무 방식 참고: [웹쫀쿠 채팅방 3일차 밤](https://m.dcinside.com/board/ai_utilize/31803), 게시 시각 2026-08-14 22:51:42. 본문과 첨부 이미지 4장을 읽었다.
- GUI 참고: [AI 단톡방](https://m.dcinside.com/board/ai_utilize/96397). 이전의 [GUI 검토](./reviews/chatroom-ui-review-20261030.md)를 유지하며 지도·건물·3D 월드는 제외한다.
- 코드 대조 기준: main `8f81d861b3f170ef2024b90d9eeba56ce34f0f79`, 열린 PR #12의 GUI 계획.
- 상태: 운영 목표 정정·구현 계약. 아래 회사 업무 기능은 미구현이며 기존 토론·provider·Codex 기반 코드와 구분한다.

## 1. 운영 목표 정정

웹쫀쿠는 목표/프로젝트를 주면 여러 AI가 역할을 맡아 계획·논의하고, 실행 가능한 일감을 큐에 넣고, 가능한 작업자가 가져가 수행하며, 다른 역할의 리뷰·재작업을 거쳐 결과를 프로젝트 지식으로 남기는 개인용 AI 작업실이다. 단톡방은 이 과정의 대화·요청·인계·실제 활동을 보여 주고 사용자가 끼어드는 GUI다. 독립 초안·상호 검토·비교 토론은 계획/판단에 쓰는 한 업무 방식이고 자유 수다는 별도로 켜는 부가 기능이다.

기존 개발 문서가 조직·팀·실제 Work Queue·Wiki를 장기 선택 범위로 밀고 정해진 토론 라운드를 제품 전체처럼 정의한 부분을 정정한다. 단순 역할 문자열·화면 카드로 조직이 구현됐다고 하지 않으며 토론 turn의 완료를 업무 done으로 세지 않는다. 코드에 있는 기반은 보존하고 부족한 운영 계층을 우선 구현한다.

참고 게시글은 논의/이슈만 늘고 코딩 일감이 전달되지 않던 상황에서 작업큐를 도입해 작업자가 끝나는 대로 가져가게 했다는 작성자 보고다. Wiki와 작업 통계 화면도 첨부돼 있다. 외부 시스템의 코드·실제 실행·숫자·모델 성능을 검증한 것은 아니다. 특정 도구 이름·에이전트 수·처리량·스크린샷의 GUI를 그대로 도입하지 않는다.

## 2. 실제 일하는 흐름

~~~mermaid
flowchart TD
    Goal[사용자 목표 · 프로젝트] --> Plan[담당 역할의 계획 · 조사 · 논의]
    Plan --> Queue[작업큐 · 완료 조건 · 우선순위 · 의존성]
    Queue --> Claim[가능한 Seat가 ready 업무를 원자적으로 가져감]
    Claim --> Work[업무 규칙 · 관련 Wiki · 작업 맥락으로 수행]
    Work --> Result[결과물 · 실제 실행/검사 근거 제출]
    Work --> Help[도움 요청 · 차단 이유 · 새 일감 제안]
    Help --> Queue
    Result --> Review[다른 담당자의 리뷰]
    Review -->|반려| Rework[수정 이유 · 다음 시도]
    Rework --> Queue
    Review -->|완료 조건 충족| Done[업무 완료]
    Done --> Wiki[결정 · 검증한 내용 · 운영 지식 기록]
    Wiki --> Work
    Chat[단톡방 GUI · 멘션 · 인계 · 사용자 개입] -.-> Plan
    Chat -.-> Queue
    Chat -.-> Review
~~~

예: 사용자가 “기능 A를 만들어”라고 하면 기획 역할이 범위와 수용 기준을 정하고 설계/조사 역할이 쟁점을 확인한다. 구현 가능한 업무를 개발 큐에 넣고 작업자는 선행 조건이 끝난 ready 업무를 가져간다. 실제 코드 실행은 허용된 Codex binding과 작업 브랜치에서 수행한다. 완료 응답과 검사·변경 근거가 제출되면 리뷰 역할이 확인하고 반려 시 재작업을 만든다. 채택한 결정·주의점은 출처와 함께 Wiki에 남긴다. 사용자는 채팅으로 질문·우선순위·범위를 바꿀 수 있고 업무 기록을 직접 확인한다.

모든 참여자가 매 업무마다 같은 순서로 발언해야 하는 것은 아니다. 조사 업무에는 조사 역할과 필요한 검토자를, 구현 업무에는 개발자와 리뷰어를 배정한다. 판단이 필요한 업무에서 기존 N인 독립 초안·전원 장문 재분석을 하위 Discussion으로 사용할 수 있다. 역할별 인계·업무 큐가 공통 운영이며, 특정 dot/Muse나 특정 모델을 영구 CEO·심판으로 강제하지 않는다.

## 3. 현재 구현과 부족한 부분

| Living Design 요구 | 실제 코드 | 판정 |
| --- | --- | --- |
| Company/Team/Role·계층형 정책 | [Member.role](../src/workspace/model.ts)는 자유 문자열. Company/Team/Role/Policy 엔티티와 실제 배정 정책 없음 | 미구현 |
| Account·Context·Seat 분리 | 연결·인증·모델·참여자별 context는 있음. 역할이 빌리는 Seat와 account 용량 lease 없음 | 기반만 있음 |
| 프로젝트 목표→실행 가능한 일감 | [DiscussionEngine](../src/workspace/engine.ts)은 주제와 정해진 phase의 발언/검증 과제를 생성 | 별도 프로젝트 업무 분해·등록 미구현 |
| Work Queue와 pull/claim | 기존 [Task](../src/workspace/model.ts)는 discussion 안의 발언·검증 단계. [MCP task_get](../src/http/mcp.ts)도 배정된 discussion task 조회 | 범용 업무 큐·원자적 task_claim·역할 배정 미구현 |
| 실행과 업무 Review/Rework | claim에 대한 support/challenge/uncertain와 Codex job 상태는 있음 | 결과물 리뷰·반려·재작업·완료 게이트 미구현 |
| Wiki/Shared Memory | [로컬 자료](../src/workspace/materials.ts)와 Discussion checkpoint는 있음 | 프로젝트 Wiki·버전·출처·결정/운영 지식 승계 미구현 |
| 실제 코드 수행 | [CodexExecutor](../src/execution/codex.ts)의 등록·실행·승인·회수·대조 기반 있음 | 실계정/실세션 미검증. 회사 업무와의 연결은 없음 |
| 영속 상태·이벤트·중복 방지 | [Store](../src/workspace/store.ts)의 SQLite transaction·journal·command 결과 있음 | 회사 업무 계층에서도 재사용할 기반 |
| 회사 관제와 단톡방 | [control](../src/web/control.ts)은 토론·참여자·실행 화면 | 팀/역할/업무/리뷰/Wiki 연동과 새 GUI 미구현 |

기존 Node/Chrome/MCP fixture 검사 PASS는 위 미구현 기능의 증거가 아니다. 실계정 로그인 문제와 운영 모델 누락도 다른 문제다. OAuth를 완료하는 것만으로 회사처럼 일하는 구조가 생기지 않는다.

## 4. 데이터와 상태 계약

기존 토론 Task와 회사 업무를 구분해 `WorkTask`를 새로 설계한다. 과거 discussion task를 자동으로 회사 업무로 해석하거나 완료 이력을 옮기지 않는다. 초기에는 현재 private SQLite와 transaction을 확장하며 범용 repo 파일 쓰기 권한을 요구하지 않는다.

| 대상 | 최소 책임 |
| --- | --- |
| Company/Team/Role/Policy | 역할 책임·허용 업무·팀별 preferred/fallback 계정·정책 버전. 특정 모델 성능을 하드코딩하지 않음 |
| Project/Goal | 사용자 목표·범위·완료 기준·선택 자료·진행 예산·관련 Discussion/업무/결정 |
| Seat/Assignment | 계정·참여자·role/context·가용성·현재 작업·실측 동시 한도·lease |
| WorkTask/Dependency | 프로젝트·업무 유형·완료 기준·requiredRole/team·우선순위·선행 업무·버전·작성자·claim/attempt·결과/리뷰 연결 |
| WorkResult/Review | 산출물·원문/해시·실제 command/test/receipt/job 참조·미실행/실패·제출자·다른 리뷰어·승인/반려 이유 |
| WikiPage/Decision/Issue | 프로젝트 지식·근거·출처 계보·버전·검토 상태·작성/검토자·대체 이력. 실행 중 현황의 권위는 업무 큐에 둠 |
| Message/Event | 작성자·역할·프로젝트·workTaskId·replyTo/멘션·상태 변화·원문·공개 범위·cursor |

업무 기본 흐름:

~~~text
backlog → ready → claimed → running → review → done
                                  ↘ blocked → ready
                        review → rework → ready
                        각 단계 → failed / cancelled (사유·원문 보존)
~~~

실제 외부 전송이 미확정이면 별도 attempt의 unconfirmed/reconciling 상태를 보존하고 running/blocked와 연결한다. lease 만료·재시작·타이머·사용자 재접속만으로 다른 작업자에게 다시 보내지 않는다. dependency가 실패/취소됐다고 후행 업무를 자동 완료하지 않는다. 반려는 기존 결과를 덮어쓰지 않고 수정 사유와 새 시도를 연결한다.

원자적 claim은 업무 ready·선행 완료·버전·role/capability·scope·Seat 가용성과 계정/작업공간 한도를 함께 확인한다. claim·lease·이벤트·같은 요청 ID의 결과를 한 transaction에 기록한다. 두 작업자가 동시에 요청해도 한 명만 가져간다. 한 역할이 본래 scope 밖 업무를 발견하면 Issue/새 업무로 제안하고 현재 업무에서 권한을 확대하지 않는다.

처음에는 Core/owner API와 adapter가 같은 업무 상태 전이를 사용하고, MCP가 가능한 참여자는 별도의 project/role/task 범위 도구로 조회·claim·제출·리뷰·Wiki 제안을 호출한다. 기존 discussion task_get/grant의 의미·권한을 조용히 확대하지 않는다. 모델이 업무/정책을 제안하는 것과 서버가 수용 기준·dependency·현재 권한을 검사해 ready로 올리는 것을 구분한다. 공식 Events/Connector 미지원이 업무 큐의 선행 차단 조건이 되지 않게 한다.

독립된 토론 루프와 새 업무 루프가 각각 provider를 호출해 실수로 동시 실행하지 않도록 공통 dispatch/자원 조정 경계를 둔다. 첫 구현은 전역 provider turn 1개와 계정별 1활성 작업 한도를 유지할 수 있지만, “대화 단계가 끝나야 일감을 줄 수 있음”을 운영 규칙으로 고정하지 않는다. 업무가 외부 실행/사람/다른 업무를 기다릴 때는 필요한 lease만 유지하고 다른 허용 업무를 선택할 수 있어야 한다. 다중 Seat 동시 실행 수 확대는 실제 계정·host 검증 후 설정한다.

## 5. 수행·리뷰·Wiki 계약

작업자가 업무를 가져가면 Company → Team → Role → Project → WorkTask의 적용 규칙과 관련 Wiki/결정/원문 참조를 받는다. OAuth/API의 역할별 context와 기존 dot/Muse의 지속 대화를 구분한다. 모든 채팅을 무제한 복사해 context로 쓰지 않고 출처·누락/발췌 여부·문맥 예산을 기록한다. 정식 N인 토론에 쓰이는 장문 재분석과 초기 초안/라운드 공개 장벽은 유지한다.

실제 코드·검사 수행은 기존 Codex job으로 위임하고 WorkTask/attempt/binding/thread/turn/브랜치/입력과 결과를 연결한다. 코드 “제안”, job “접수”, provider “완료 응답”, command/test “실행 관측”, 상위 업무 “done”은 서로 다른 상태다. repo 파일 변경 전에 필요한 R2/R3의 scope 수명·늦은 승인·비밀/링크/출력 경계를 구현·검증한다. sandbox 해제·기존 세션 이중 실행·기본 브랜치 직접 수정으로 우회하지 않는다.

결과 제출은 곧바로 done이 아니라 review로 이동한다. 기본 리뷰는 작성자와 다른 담당자/context가 수행하며 계정까지 다른지 표시한다. 독립 리뷰를 확보하지 못하면 리뷰 대기로 남기고 자기 제출을 리뷰 승인으로 위장하지 않는다. 조사/문서 업무도 산출물·출처·수용 기준을 확인한다. 코드 업무는 실제 변경·검사 근거가 없으면 미실행/불충분으로 남기고 반려·추가 확인·부분 결과를 구분한다. PR 병합은 사용자 담당이며 reviewer의 업무 승인이 PR merge를 자동 실행하지 않는다.

Wiki에는 원문 근거, 적용 범위, 확인/보고/미실행 상태와 작성/검토자를 붙여 제안→검토→채택/대체 이력을 남긴다. 과거 판단이 틀렸으면 원문을 보존하고 새 결정을 연결한다. Task의 현재 담당자·차단 이유·진행 상태는 Wiki 복제본보다 큐를 기준으로 읽는다. 모델들이 반복해 동의한 내용을 자동 사실로 올리지 않고 개인 provider 기억을 공동 Wiki로 가져왔다고 주장하지 않는다.

## 6. GUI와 대화

외형은 이전에 지정한 단톡방 GUI를 유지한다. 새 업무 참고 글의 복잡한 창·테마를 그대로 복제하지 않는다.

- 왼쪽: 참여자 아바타·팀/역할·계정/model/effort·Seat 상태·현재 업무. 역할과 계정은 따로 보이고 GPT 두 계정을 구분한다.
- 중앙: 사람과 AI의 실제 대화, 멘션·인용 답장, 업무 생성/claim/도움 요청/결과 제출/리뷰/반려/완료 메시지. 특정 메시지에서 해당 업무·근거로 이동한다.
- 오른쪽: 작업큐·선행 의존성·리뷰 대기·산출물/실행 근거·Wiki·사용량을 접이식 패널/탭으로 제공한다. 원문·과거 이력·실제 미확인 상태를 확인할 수 있어야 한다.
- 좁은 화면: 같은 기능을 drawer·탭으로 접근하고 장문·스크롤 위치·입력기를 보존한다. 지도·건물·게임 월드는 없다.

사용자는 목표·조건·우선순위·담당·pause/취소를 채팅과 업무 상세에서 바꾸며 진행 중 시도의 버전/권한을 대조한다. 기존에 허용한 범위의 자동 업무는 매 발언/매 일감마다 재승인받지 않는다. 새 권한·조직/정책 변경·민감한 승인 경계는 기존 owner 정책과 세션의 허용 범위를 따른다. 연결 로그인만 사용자가 직접 처리한다.

서로 떠드는 자유 대화도 추가 요구로 유지한다. 다만 실행 가능한 업무를 굶기는 기본 루프가 되지 않으며 별도의 켜기·예산·휴면을 둔다. 수다에서 나온 제안은 구체적인 산출물·완료 조건·담당·권한 범위를 가진 업무로 변환돼야 실행 큐에 들어간다. 속도/캐릭터 설정이 GPT 기본 xhigh나 실제 실행/검증 상태를 바꾸지 않는다.

## 7. 다음 구현과 완료 판정

| 순서 | 범위 | 기존 WJ와 연결 | 완료 증거 |
| --- | --- | --- | --- |
| ORG-01 | Company/Team/Role/Policy, Project/Goal, WorkTask·상태·의존성·영속 저장 | WJ-007 확장 | 기존 DB/토론 보존, 정책/업무 버전, 원자적 상태·event·idempotency, 순환/불완전 업무 거절 |
| ORG-02 | Seat·역할 배정·ready 업무 claim/pull·공통 자원 조정 | WJ-007/008/011 | 두 소비자의 중복 claim 거절, 선행/역할/한도 검사, 대기 중 다른 허용 업무, 재시작 미확정 중복 전송 0 |
| ORG-03 | 논의/조사 결과→업무 분해·도움 요청/Issue→큐 | WJ-008/009 | 사용자 목표에서 실행 가능한 업무가 생성되고 실제 작업자에게 전달됨. 대화/이슈 수만 늘어나는 흐름 거절 |
| ORG-04 | 수행→실제 Codex/자료 결과→독립 Review→Rework/Done | WJ-009/014/015, R2/R3 | fixture의 업무 왕복부터 검증, 실세션의 범위·receipt·검사·반려/후속 시도 대조. 응답 완료만으로 done 0 |
| ORG-05 | 출처·버전·검토를 가진 Wiki/Decision과 관련 context 주입 | WJ-007/009/011 | 채택/대체 이력·출처, 같은 문서 동시 변경 충돌, 다음 업무에서 관련 지식 재사용, reported를 검증 사실로 승격하지 않음 |
| ORG-06 | 위 업무 흐름을 단톡방 GUI에 표시·조작 | WJ-010/011, CHAT-01/02 | 실제 queue/seat/review/wiki 이벤트와 말풍선 연결, 사용자 개입·장문·1440/1024/768/390px·재접속 |
| ORG-07 | 실제 여러 계정과 Codex의 프로젝트 업무 운영 | WJ-012/015 확장 | 목표→업무→claim→실행/결과→다른 역할 리뷰→반려/완료→Wiki→다음 업무를 사용자 중계 없이 확인 |

조직도만 먼저 그리거나 자유 수다부터 켜는 것을 완료로 삼지 않는다. ORG-01/02의 실제 데이터·큐·배정이 첫 구현이고, ORG-03/04에서 결과물이 나오는 최소 운영 루프를 연결한다. ORG-05와 ORG-06은 그 데이터에 붙인다. CHAT-03/04의 자유 수다/모드 전환은 이 운영 루프를 유지하는 범위에서 진행한다. 새 provider·대규모 동시 실행·별도 Git Writer·자동 병합을 먼저 요구하지 않는다.

계정 인증 없이 조직·큐·review·wiki 계약과 fixture/UI를 개발할 수 있다. 사용자 귀가 후 OAuth를 진행한다는 일정은 유지한다. 모의 worker·도구 schema·기존 토론 검사만으로 ORG-07 실운영을 PASS로 표시하지 않는다. 이 문서와 계획을 정정하는 이번 변경은 런타임 기능 구현이나 서비스 반영이 아니다.
