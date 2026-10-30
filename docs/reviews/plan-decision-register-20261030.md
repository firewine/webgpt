# 계획 항목 판정표 — 지정 기준 재심사

코드 기준은 `8f81d861b3f170ef2024b90d9eeba56ce34f0f79`(C), 계획 기준은 `8db0f42f499f674c66c3a0df0a4d8e0f25fb216e`(P)다. 현재 HEAD의 후속 문서는 근거로 사용하지 않았다. 증거 E1~E18·X1~X3의 실제 경로/심볼·범위와 E1/E6 보정은 [개정 요약](../plan-revision-20261030.md#2-코드-근거-e1e18)을 따른다. 아래 표는 P의 변경 5파일과 관련 기존 항목을 세분해 판정한다. 여러 문서에 반복된 같은 결정은 같은 행으로 묶고 출처를 적는다. 날짜·변경 이력은 기능이 아닌 기록으로 판정한다.

표기: `유지`는 목표/계약을 유지한다는 뜻이며 구현 완료가 아니다. `수정`은 기능·위치·의존성·상태를 바꾼다. `기각`은 해당 접근만 채택하지 않는다는 뜻이다. 새 설계는 [상주 방 운영 계약](../company-workflow-plan.md)과 [단계별 계획](../resident-implementation-plan.md)에서 구체화한다.

## 1. PR #12가 추가·수정한 모든 결정

출처: P의 `git show --format= -- docs/...`에 포함된 5파일. R=`reviews/chatroom-ui-review-20261030.md`, D=`development-plan.md`, T=`discussion-plan.md`, S=`implementation-sequence.md`, L=Living Design v0.8. R의 모든 절·표·문단과 D/T/S/L의 새 hunk는 다음 P01~P44에 대응한다.

| ID | 기준 항목·출처 | 판정 | 한 줄 이유와 적용 | 근거 |
| --- | --- | --- | --- | --- |
| P01 | D/T/S/L의 버전·날짜·상태와 새 변경 이력 | 수정 | 지정 두 SHA와 현재 HEAD 차이를 선두에 고정하고 계획/관측을 분리 | E1, E10 |
| P02 | D의 main 기준을 PR #11 병합 SHA로 갱신 | 유지 | 코드 근거는 정확히 C로 한정 | E1, E10 |
| P03 | D/T/L/R의 단톡방 목표와 미구현 표시 | 유지 | 목표 GUI는 확정됐고 기준 코드에는 해당 배치가 없음 | E2, X1 |
| P04 | R의 control.* 개선·프레임워크/프로젝트 재생성 제외 | 유지 | 현재 운영 자산·인증·API·SSE를 그대로 활용 | E1, E2, E11 |
| P05 | R/D/T의 왼쪽 아바타·색·별칭·계정별 상태 | 유지 | 연결/참여자 ID를 외형과 분리해 실제 상태 표시 | E2, E5, E17 |
| P06 | R의 참여 토글·현재 행동·실제 관측 상태 | 수정 | 방 멤버십 enabled를 추가하며 기존 계정 로그아웃/토론 exclude와 분리 | E6, E7, E17 |
| P07 | R/D/T의 중앙 말풍선·작성자·시각·모드·원문 ID | 유지 | transport JSON의 text를 표시하고 원문/상태 참조 보존 | E2, E4, E11 |
| P08 | R/D/T의 인용 답장·@멘션·ID 검증 | 유지 | 같은 방·공개된 메시지/참여자만 참조 가능 | E3, E4, E12 |
| P09 | R/T의 이모지 반응 | 수정 | 사용자 반응만 첫 GUI에 포함 가능, AI 반응용 추가 호출은 후순위 | E4, E14 |
| P10 | R의 관전·사용자 중간 참여 | 유지 | 지속 RoomMessage 입력을 제공하고 지시마다 토론을 새로 만들지 않음 | E2, E3 |
| P11 | R의 오른쪽 작업공간·자료·근거·비교·사용량·실행 | 수정 | 기존 자료/실행과 새 WorkTask·Wiki를 같은 보조 패널에 연결 | E7, E8, E15, E17 |
| P12 | R의 방 설정·주제/자유 대화 선택 | 수정 | 방 on/off가 상위 수명, 토론은 방 안의 일시적인 focus mode | E3, E7 |
| P13 | R/T의 넓은 3열·좁은 drawer/탭·터치/키보드/IME | 유지 | 화면 크기에 따라 기능과 승인 경계가 사라지지 않음 | E2, E11, X1 |
| P14 | R/T의 밝기·동작 줄이기 | 유지 | 로컬 표현 설정으로 구현하며 모델 호출·서버 권한 불변 | E2, X1 |
| P15 | R/D/T의 장문 접기·전체 원문/분석 입력 유지 | 유지 | 화면 접기와 context 예산 초과를 구분 | E3, E4, E14 |
| P16 | R의 강제 스크롤 금지·읽지 않은 메시지 이동 | 유지 | SSE 수신과 사용자의 읽기 위치를 분리 | E11, X1 |
| P17 | R의 SSE ID 중복 제거·답장/펼침/스크롤 보존 | 유지 | 기존 cursor/SSE 통신을 재사용하고 view state만 확장 | E11 |
| P18 | R/T의 활동/타이핑·동시 실행·검증 성공 허위 연출 금지 | 유지 | 관측 event만 표시, 수신중 JSON은 완성 text와 구분 | E3, E11, E17 |
| P19 | R의 자유 대화 vs 토론 표 | 수정 | 둘 다 상주 방의 기능으로 묶고 자유 발화를 기본 운영 경로로 둠 | E3, E4, E7 |
| P20 | R/D/T/L의 “자유 수다는 별도 모드·후속 부가” | 기각 | 확정 목표는 방 상주·자유 논의에서 업무/위키가 생기는 운영 | E3, E7, E8, X2 |
| P21 | R의 say/pass와 별도 응답 계약 | 수정 | JSON envelope를 유지하면서 자유 text·구조화 claims/actions를 공존 | E4, E5 |
| P22 | R/T의 지목 우선·미발언자 순환·공정 배정 | 유지 | 단일 provider 슬롯에서 방 발화와 ready 업무를 함께 조정 | E3, E7, E13 |
| P23 | R/T의 새 발언 기반 진행·침묵 깨기 한 명·pass | 유지 | pass도 유료/구독 호출이며 예산·backoff·sleep 적용 | E14, X1 |
| P24 | R/D/T의 속도=dispatch 간격, xhigh 자동 하향 금지 | 유지 | 기존 reasoningEffort 요청 계약을 유지 | E5, E14 |
| P25 | R의 신규 자동 수다 기본 off | 수정 | Room은 기본 off로 이관, 한 번 on하면 선택 범위에서 상주 운영 | E3, E10, E14 |
| P26 | R의 30분/30호출·5/15/45초·120초·pass3 초안 | 수정 | 승인된 기본값이 아니므로 제안값과 고정 검사용 fixture를 구분 | E14, X1 |
| P27 | R의 reported usage만 표시·미제공 비용/잔여율 금지 | 유지 | Completion.usage null을 0원으로 치환하지 않음 | E5, E14 |
| P28 | R/D/T의 자유 대화와 주제 토론 동시 실행 금지 | 수정 | 방 수명은 유지, focus 중 ambient dispatch만 중지·토론 종료 후 복귀 | E3, E13 |
| P29 | R/T의 발언 확정 경계 모드/멤버 전환 | 유지 | revision/generation·미확정 대조와 충돌하지 않게 pending 전환 | E3, E12 |
| P30 | R의 pause/stop vs 외부 Codex 취소 구분 | 유지 | on/off는 새 dispatch 제어, 진행 중 job은 별도 명시 취소·관측 | E13 |
| P31 | R/T의 새로고침·기기·재시작·timer가 재전송 사유 아님 | 유지 | 준비/실행 journal과 같은 request ID 결과를 유지 | E10, E11, E12 |
| P32 | R/D/T/L의 수다→새 독립 주제 토론 | 수정 | 같은 방에서 공개 참조 snapshot으로 subdiscussion을 만들고 완료 후 방 복귀 | E3, E4, E15 |
| P33 | R/T의 browser가 기존 수다를 잊었다고 하지 않음 | 유지 | dot/Muse 대화는 보존, 새 초안 공유 금지의 범위만 주장 | E5, E6, E12 |
| P34 | R의 말투/아바타/멘션이 실행 scope를 만들지 않음 | 유지 | action은 기존 권한 검사 후 제안/업무로 수락 | E12, E13, E16 |
| P35 | R/D/T의 지도·건물·좌표·3D·게임 도구/프롬프트 제외 | 유지 | 확정 제외 범위와 일치 | X1, X2 |
| P36 | R의 기존 연결 사용·외부 CLI/모델/동시 실행/자동 boost 복제 배제 | 유지 | 이미 복제를 배제한 원결정을 그대로 유지하고 backend를 재사용 | E5, E6, E13, X1 |
| P37 | R의 라이선스 추적·외부 캐릭터/로고 자산 제외 | 유지 | 복사할 때 파일별 MIT 출처 필요, 그림은 복사하지 않음 | X3 |
| P38 | R/S의 CHAT-01: 기존 데이터 GUI 먼저 | 수정 | R1 데이터→R2 dispatch→R3 단톡방으로 단계화, 임시 시연을 운영 완료로 세지 않음 | E2, E3, E7 |
| P39 | R/S의 CHAT-02: 메시지·답장·멘션·반응 | 수정 | R1/2/3의 공통 RoomMessage·공개 범위로 구체화 | E4, E11, E12 |
| P40 | R/S의 CHAT-03: 자동 수다 scheduler | 수정 | R2의 상주 운영 scheduler에서 업무·위키 발화와 같은 자원 사용 | E3, E7, E13 |
| P41 | R/S의 CHAT-04: 모드·맥락·topic 전환 | 수정 | R2/R3의 Room focus link로 기존 DiscussionEngine 보존 | E3, E4, E12 |
| P42 | R/S의 CHAT-05: 실제 N인·모바일 검증 | 수정 | R8에서 자유 논의→큐 pickup→보고→Wiki→방 토론의 전체 왕복 판정 | E5, E6, E13, E18 |
| P43 | R의 공유 메모·기억·이미지·스티커 전부 후속 | 수정 | 프로젝트 Wiki는 R7 핵심, 개인 provider 기억·그림/스티커는 후속 유지 | E8, E15 |
| P44 | R/S/D의 “계획만·계정 귀가 후·PR 제출/병합” | 수정 | 계획만 유지, 이번에는 새 명령대로 커밋/푸시/PR/배포/로그인/모델 호출 전부 금지 | E10, E18 |

## 2. Living Design v0.8의 관련 구성 전수 판정

| ID | 기준 절·항목 | 판정 | 한 줄 이유와 적용 | 근거 |
| --- | --- | --- | --- | --- |
| L01 | 머리말·§1·§28: 토론 제품, 회사는 장기 확장 | 수정 | 최상위는 상주 방+업무 큐+Wiki, 토론은 방 안의 한 모드 | E3, E7, E8, X2 |
| L02 | §1.2: 공식 연결·계정/맥락 분리·실제 기록 | 유지 | 기존 인증/adapter/Store를 버릴 이유 없음 | E5, E6, E10 |
| L03 | §1.2/14: 초안 공개·합의≠검증·예산·원문 | 유지 | 주제 토론과 방 공개 projector 양쪽에서 보장 | E3, E4, E14 |
| L04 | §2: 예시 계정 수·모델 추천을 가용 자원으로 간주 | 수정 | 설정 예시로만 두고 연결된 계정/모델로 수용 | E5, E17 |
| L05 | §2.1: root1·provider turn1 | 수정 | 기존 토론 root1 유지, 방·업무 조정자는 provider 슬롯1을 공유 | E3, E13 |
| L06 | §3 Participant/Role/Account/Context | 수정 | 기존 Member/Context 유지+얇은 role/seat 참조; 별도 provider 재작성 없음 | E5, E7, E12 |
| L07 | §3.3/13.1: Seat·claim·계정 자원 lease | 수정 | 신규 운영 모델 제안과 crash/불확실 lease 규칙을 명시 | E7, E10, E12 |
| L08 | §3.4: browser 대화 보존·OAuth 앱 이력 | 유지 | ChatGPT 웹 기록 가져오기와 혼동하지 않음 | E5, E6 |
| L09 | §3.5/17: Codex binding·cwd/thread·권한 | 유지 | 기존 등록/승인/대조/단일 작성자 사용 | E13, E16 |
| L10 | §4: 팀별 preferred/fallback | 수정 | 선언된 가용 계정에서만 배정, 미확정 요청의 자동 fallback 금지 | E5, E12 |
| L11 | §5: 회사 조직도·감독/기획/개발/QA/기록 책임 | 유지 | 책임을 지원하되 모든 역할을 매 업무 호출하거나 특정 모델로 고정하지 않음 | E7, X2 |
| L12 | §6: Constitution→Team→Role→Project→Task | 유지 | 권한은 서버 검사, 계층형 prompt는 내용 맥락으로만 적용 | E4, E12, E16 |
| L13 | §7: adapter/runtime/core 분리 | 유지 | complete와 연결 계약은 불변, 신규 층은 runtime에 결합 | E5, E6, E11 |
| L14 | §8: MCP 전체 후보와 task_claim | 수정 | 기존 discussion grant는 그대로, room/work/wiki 도구는 별도 범위로 추가 | E7, E16 |
| L15 | §9~11: OAuth/API/browser·수동 승인·대조 | 유지 | 자동 탐지는 연결 작성 UX만 보조하며 기존 probe/send 검사는 유지 | E5, E6, E12 |
| L16 | §12: claim→규칙/context→수행→제출→review→rework/done | 유지 | 실제 WorkTask 상태로 구현하며 provider 완료와 구분 | E7, E13 |
| L17 | §13: 업무 큐 필드·의존성·priorities | 수정 | 토론 Task/CodexJob과 명명/연결·idempotency를 분리 | E7, E10, E13 |
| L18 | §14/14.3: Discussion이 최상위·수다는 부가 | 수정 | Room이 상위 수명, 기존 6단계는 focus subdiscussion으로 보존 | E3, E4 |
| L19 | §14.1/14.2: checkpoint·세대·활동/검증 큐 | 유지 | 기존 원문 인계와 미확정 보존을 새 attempt에도 적용 | E12, E15 |
| L20 | §15: Event Log 이름·추적·SSE | 수정 | event envelope/cursor는 유지, room/task/wiki event names와 data 참조만 추가 | E10, E11 |
| L21 | §16: Wiki/Shared Memory | 수정 | 앱 private DB 버전/충돌/인용·AI 자동 편집 경로를 구체화 | E8, E10, E15 |
| L22 | §17: worktree·sandbox·checks·사용자 merge | 유지 | 기존 Codex 경계를 재사용, 선택 Git Writer는 별도 | E13, E16 |
| L23 | §18/18.1/18.2: 계정·팀 설정/관제 | 수정 | 실제 control.*의 단톡방+업무/Wiki 보조 패널과 연결 | E1, E2, E7, E8 |
| L24 | §19/20: Human Override·정책 개선 제안 | 유지 | 기존 승인 재사용, 허용한 범위 내 업무/위키마다 재승인하지 않음 | E12, E13, E16 |
| L25 | §21: 팀/배정·Wiki를 전부 장기 후속으로 분류 | 기각 | 최소 큐·공유 기억은 확정 목표의 필수 운영 | E7, E8, X2 |
| L26 | §22: 개별 연결 PoC | 유지 | 계정별 검증 gate는 남기고 새 운영 fixture의 선행 조건으로 만들지 않음 | E5, E6, E18 |
| L27 | §23: UI/한도/인증/혼선/허위 합의 등 위험 | 유지 | 삭제하지 않고 상주 budget·scope·관측 중단과 공존 | E6, E12, E14, E16 |
| L28 | §24~27: 모델 초안·다음 순서·기능 확인 메모·이력 | 수정 | 새 타입은 제안, 과거 PASS는 과거로 보존, 기준 근거와 검증 gate로 갱신 | E7, E8, E18 |

## 3. 기존 개발 계획의 관련 항목

| ID | P의 항목 | 판정 | 한 줄 이유와 적용 | 근거 |
| --- | --- | --- | --- | --- |
| D01 | §1/3: 주제 한번→고정 토론이 전체 제품 | 수정 | Room에서 자유 대화·업무·Wiki·선택 토론을 운영 | E3, E7, E8 |
| D02 | §2: 구현/fixture/실계정 판정 구분 | 유지 | 이번은 static code 확인, runtime 결과는 UNVERIFIED | E18 |
| D03 | §4.1: 연결 PoC | 유지 | 기존 연결은 재사용하고 실제 계정 적합성은 별도 gate | E5, E6 |
| D04 | §4.2: root1·turn1·사용자 제어 | 수정 | room root+topic link, provider1·workspace writer 한도는 유지 | E3, E13 |
| D05 | §4.2: 회사/자동 Wiki 제외 | 기각 | 큐·Wiki가 상주 운영 목표의 필수 구성 | E7, E8, X2 |
| D06 | §4.3: 기본 팀/역할을 provider·병렬 확대까지 지연 | 기각 | 현재 계정의 역할 배정부터 추가할 수 있음 | E5, E7 |
| D07 | §5: Ubuntu/Serve/원격 Chrome·수명 분리 | 유지 | 호스트/포트 변경 없이 같은 서비스/API에 운영층 결합 | E1, E6, E11 |
| D08 | §5~8: 인증·provider·Codex·안전 경계 | 유지 | complete/Store/binding/approval 재사용이 기본 | E5, E6, E10, E13, E16 |
| D09 | §9.1/9.2: 기존 참고의 전송1회·활동/인계 | 유지 | source receipt·불확실 대조·관측 출처를 보존 | E12, E15 |
| D10 | §9.3: WWG-R1/R4의 로컬 자료·capability | 유지 | 기준 main에 존재하므로 새로 구현하지 않고 방에서 재사용 | E15, E17 |
| D11 | §9.3: R2/R3의 새 권한 수명/secret 경계 | 수정 | 이미 완료라 하지 않고 R6의 real-write gate로 최소 보강·검증 | E13, E16 |
| D12 | §9.3: R5/R6/R7·로그/Writer 추가 확대 | 유지 | 원문/중복 방지 수명 유지, 별도 Writer는 목표 운영의 필수 아님 | E10, E13 |
| D13 | §10: Phase0~2 연결/토론 검사 완료를 전체 완료로 간주 | 수정 | R8의 room→work→wiki→topic 경로가 제품 수락 조건 | E3, E7, E8, E18 |
| D14 | §10: MCP Events/Connector·추가 provider·자동 merge | 유지 | 통로/용량 확장은 후속, 기존 경로로 상주 업무 가능 | E5, E6, E16 |
| D15 | §11~13: 수락·산출물·다음 착수 | 수정 | R1~R8의 파일/계약/이관/실행 증거/rollback으로 구체화 | E10, E11, E18 |
| D16 | §14: 과거 변경 이력 | 유지 | 역사로 남기고 현재 요구와 다르면 새 정정표로 우선순위 표시 | E18 |

## 4. 기존 토론 계획·실행 순서의 관련 항목

| ID | P의 항목 | 판정 | 한 줄 이유와 적용 | 근거 |
| --- | --- | --- | --- | --- |
| T01 | T §1/2: 주제 입력·N인 흐름 | 수정 | 방에서 생성되는 focus Discussion이며 standalone legacy도 보존 | E3, E4 |
| T02 | T §3: 자동 단계 전이·전체 답변 재분석 | 유지 | 기존 engine.advance/schedule/promptFor를 사용 | E3, E4 |
| T03 | T §4: claim/evidence·합의/검증·원문 | 유지 | 자유 발화 envelope에도 빈 배열/보고·검증 상태 구분 | E4, E15 |
| T04 | T §5: budget·부분 결과·한도 종료 | 수정 | 기존 discussion budget과 상위 Room 예산을 예약/집계하며 이중 계상 금지 | E14 |
| T05 | T §6: SQLite·lease·복구·checkpoint | 유지 | Store transaction과 engine journal/recover 불변, 새 attempt는 같은 절차 적용 | E10, E12 |
| T06 | T §7: 콘솔 중심 UI | 수정 | control.* 단톡방 내부 topic/근거/비교 상세로 이동 | E1, E2 |
| T07 | T §8: 토론 검증→Codex만의 실행 | 수정 | 기존 API 유지+WorkJobLink로 room 업무를 같은 executor에 연결 | E7, E13 |
| T08 | T §9: 검증 시나리오 | 수정 | 기존 시나리오 보존+상주/queue/wiki/topic 공존 수락 추가 | E18 |
| S01 | S §1/2: WJ 번호·기존 기반 재사용 | 유지 | WJ 이력은 보존하고 R 단계가 어느 모듈을 확장하는지 연결 | E18 |
| S02 | S WJ-001~006: 진단/설치/개별 연결 | 유지 | 신규 재작성 금지, E1 운영 진입 오해만 보정 | E1, E5, E6 |
| S03 | S WJ-007~011: task/core/UI를 전체 업무라 해석 | 수정 | 토론 Task는 그대로, 신규 room/work/wiki 층을 분리 | E3, E7, E8 |
| S04 | S WJ-012: 실제 혼합 토론 gate | 유지 | room 전체 완료 gate와 분리해 실제 계정 증거 필요 | E18 |
| S05 | S WJ-013: 공식 MCP/Events 완료가 선행 | 수정 | room API/adapter로 먼저 운영, MCP 도구는 같은 서비스의 범위별 투영 | E16 |
| S06 | S WJ-014/015: 실제 실행·검토·후속 | 수정 | WorkTask 연계와 결과/리뷰 상태를 추가하되 executor API 그대로 | E13 |
| S07 | S WJ-016~018: Writer/추가 provider/병렬/자동 merge | 유지 | 목표 1·2의 선행 조건으로 확대하지 않음 | E13, E16 |
| S08 | S §7: 기록·사용자 merge·계정 검증 대기 | 수정 | 이번은 로컬 계획 파일만 수정, 계정/host 없이 문서 검증만 수행 | E10, E18 |

## 5. 범위 누락 검사와 지위

- P01~P44: R의 메타/출처·적용 방향·소스 표·화면 표·자유 대화 표·시간/예산·인계/권한·CHAT-01~05·후속 메모/자산·제출 조건, D/T/S/L의 모든 추가/수정 hunk를 포함한다.
- L01~L28: Living Design의 §1~28 관련 계약을 대응한다. §27의 과거 기록은 L28/D16, 비관련 과거 예시는 삭제하지 않는다.
- D01~D16, T01~T08, S01~S08: 기존 범위/검사/릴리스 순서·보안·운영·산출물의 의미를 빠짐없이 유지/수정/기각한다. WJ-001~018 전부가 S02~S07에 들어간다.
- HEAD에만 있던 `5699bed`의 “자유 수다는 부가·회사 큐 먼저” 결정은 기준 계획 P의 일부가 아니다. 목표 상태와 충돌하는 우선순위는 본 개정에서 적용하지 않고 상주 방+큐+Wiki의 통합 운영으로 교체한다.
- 모든 새 기능의 구현·수락 검사는 `NOT_RUN`, 계정/모델/DOM의 실제 적합성은 `UNVERIFIED`다. 실제 gate 통과 전 “계획대로 구현하면 반드시 작동”한다는 무조건 보장은 하지 않는다. 대신 확정 목표→판정 ID→R단계→숫자 있는 수락 gate를 추적하고 누락 시 완료를 거절한다.

## 6. 후속 시스템도 참고와의 관계

사용자가 추가 지정한 32669 자료는 [F01~F08 보완 판정](./company-system-diagram-20261030.md)으로 분리했다. 원래 P/C 기준 104판정은 그대로이며 새 참고를 원래 PR #12의 결정인 것처럼 소급하지 않는다. 공통 운영과 Wiki는 이미 포함돼 있고, 역할 프로필·상주 인계/세대 fencing·상태 알림만 R2/R3/R5/R7/R8 안에서 보완한다. 단계 수는 8개, 미래 수락 gate는 50개다.
