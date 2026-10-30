# AI 단톡방 GUI·자율 대화 추가 검토

> 지정 P의 원문을 base로 재심사했다. [1쪽 요약](../plan-revision-20261030.md)과 [P01~P44 판정](./plan-decision-register-20261030.md)이 우선한다. 목표는 상주 방+큐+Wiki이고 자유 논의를 후속 부가로 밀지 않는다. backend 재사용, 새 것은 제안/NOT_RUN이다. 이번은 문서만 수정하며 commit/push/PR/배포/로그인/모델 호출을 하지 않는다.

- 검토일: 2026-10-30 (KST)
- 사용자 자료: [AI 단톡방 Github에 올렸어](https://m.dcinside.com/board/ai_utilize/96397), 2026-09-29 12:50:51 게시
- 참고 저장소: [Moris-kr/ai-chatroom](https://github.com/Moris-kr/ai-chatroom)
- 고정 revision: `817c165b92ce42f5a96504198a346b936d3e2f38`, commit 시각 2026-10-16 00:55:59 UTC
- 우리 기준 main: `8f81d861b3f170ef2024b90d9eeba56ce34f0f79` (PR #11 사용자 병합 확인)
- 사용자 방향: 단톡방과 같은 GUI, 참여자들의 자율 수다 추가. 지도·건물 만들기는 제외.
- 범위: 게시글 본문·첨부 이미지 2장과 고정 소스의 정적 검토, 개발 계획 반영. 런타임/UI 변경·외부 프로그램 실행·추가 계정 인증·실계정 모델 호출은 하지 않았다. 아래 추가 기능은 미구현이다.

## 적용할 방향

현재 작업실의 대화창을 단톡방처럼 발전시킨다. 왼쪽에서 누가 참여하는지 보고, 중앙에서 누가 누구에게 말하는지 읽고, 오른쪽에서 관련 자료·비교·실행 상태를 연다. 사용자가 계속 지시하지 않아도 참여자가 상대 말을 받아 질문·반응·다른 화제로 이어가는 자율 수다를 추가한다. 기존 주제 토론·긴 전체 발언 재분석·검증·Codex 환류와 같은 앱 안에서 제공한다.

첫 번째 첨부 이미지는 참여자 아바타·이름·상태와 참여 스위치, 중앙 말풍선·인용 답장·멘션·반응·하단 입력창, 오른쪽 작업공간·메모·사용량 패널이다. 두 번째 이미지는 3D 블록 건축 화면이다. 사용자가 제외한 지도·건물·좌표·블록·게임 월드·카메라·해당 도구/프롬프트는 도입하지 않는다. 그래픽 취향과 화면 배치를 참고하며 외부의 인물 그림·로고·캐릭터를 복사하지 않는다.

## 소스에서 확인한 것과 우리 적용

| 참고 소스 | 확인 범위 | 우리 적용·제약 |
| --- | --- | --- |
| [public/index.html](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/public/index.html), [style.css](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/public/style.css) | 참여자·대화·보조 패널, 멘션 입력·답장·테마·좁은 화면 메뉴 | 기존 `src/web/control.*`를 개선. 새 프레임워크·새 프로젝트로 갈아엎지 않음 |
| [public/app.js](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/public/app.js) | 메시지 ID 기반 인용·반응, 멘션 선택, 타이핑/상태·SSE·이전 대화 UI | 기존 turn/event ID와 실제 관측을 사용. 장문은 화면 접기만 허용하며 원문/모델 입력을 임의 요약하지 않음 |
| [server.mjs](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/server.mjs) | 참여자별 진행 루프, 동시 실행 한도, 속도·휴면, 한 명씩 침묵 깨기와 pass 후 대기 증가 | 자율 대화 아이디어만 반영. 우리의 활성 provider turn 1개·전송 전 journal·미확정 대조를 유지 |
| [lib/prompt.mjs](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/lib/prompt.mjs), [members.mjs](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/lib/members.mjs) | 대화 ID·replyTo·호칭·멘션, 최근 공개 대화와 개인 메모를 입력으로 구성 | 참여자 ID로 대상을 검증하고 계정별 private 이력과 공유 메모를 구분. 단순 최근 40개 자르기를 그대로 복제하지 않음 |
| [lib/router.mjs](https://github.com/Moris-kr/ai-chatroom/blob/817c165b92ce42f5a96504198a346b936d3e2f38/lib/router.mjs) | 요청별 모델/추론 강도 전환 | 사용자가 정한 GPT 기본 xhigh와 사후 변경을 유지. 수다·속도 설정 때문에 자동 하향하거나 다른 모델로 재호출하지 않음 |

참고 앱의 CLI 구독 호출·지원 모델·이미지 생성·여러 CLI 동시 실행을 우리 계정의 검증 증거로 쓰지 않는다. OAuth GPT·DeepSeek API·dot/Muse 기존 Chrome·등록 Codex는 현재 경로를 사용한다. 외부 README의 모델 이름도 계정 카탈로그 대신 하드코딩하지 않는다. LICENSE의 MIT 고지는 확인했지만 코드·CSS·그림은 가져오지 않았다. 이후 실제 도입한다면 사용 파일·고정 revision·라이선스/그림 권리를 추적한다.

## 화면 구성

| 영역 | 추가할 동작 | 유지할 기능 |
| --- | --- | --- |
| 왼쪽 참여자 | 아바타/색·별칭, 계정 구분, 실제 응답/대기/오류, 향후 발언 참여 토글, 수다 시작·정지와 속도 | GPT 계정 분리, model/effort 설정, 연결 상태·관측 시각, 토의 기록 |
| 중앙 단톡방 | 말풍선, 작성자·시각·모드, 인용 답장·@멘션, 사용자 중간 참여, 현재 응답, 새 메시지로 이동 | 단계·revision·세대·원문 ID, 독립 초안/라운드 공개 규칙, 전체 발언·미확인 기록 |
| 오른쪽 보조 패널 | 선택 메시지의 원문·근거·자료, 사용량, 비교/검증/실행 상세를 필요할 때 표시 | 로컬 파일 snapshot과 허용 경로, observed/reported/not_run, 승인·실행 결과 |
| 방 설정 | 주제 토론/자유 대화 선택, 참여자·진행 한도·속도·휴면, 아바타/말투 설정 | 인증·연결은 기존 설정 화면, 상태·맥락·권한 조회, Chrome 로그인 보조 화면 |

넓은 화면에서는 3개 영역을 함께 제공하고 오른쪽 패널은 접을 수 있게 한다. 좁은 화면에서는 대화가 중앙을 차지하며 참여자/자료는 drawer·탭으로 연다. 고정 입력창이 한국어 입력기·가상 키보드를 가리거나 긴 코드/URL 때문에 페이지 가로 스크롤이 생기지 않게 한다. hover만으로 답장·반응 버튼을 숨기지 않고 터치·키보드에서도 접근할 수 있게 한다. 어두운 테마와 동작 줄이기도 검토 범위다.

장문은 몇 줄 미리보기와 펼치기로 읽기 편하게 하되 전체 본문·인용 출처·수정/비교를 유지한다. 사용자가 과거 메시지를 읽는 중이면 강제로 아래로 스크롤하지 않는다. SSE 재연결 때 message/event ID로 중복 제거하고 답장 대상과 펼침·스크롤 위치를 보존한다. `대기`, 실제 요청 전송 중, 실제 stream 수신, 오류/미확정 상태를 구분하고 캐릭터가 활동하는 모습으로 여러 모델 동시 실행이나 검증 성공을 꾸미지 않는다.

## 자유 대화와 주제 토론 — 개정 결론

Room이 기본 운영이고 topic은 기존 DiscussionEngine의 focus로 유지해 종료 후 같은 방으로 복귀한다. 자유 text와 구조화 기록은 resident JSON envelope로 공존하고 Providers.complete는 불변이다. 큐·pickup/보고·Wiki는 신규 최소 모델이며 기존 Task/CodexJob과 side reference로 연결한다.

기존 auth/Store/전송 기록·대조·예산·승인/격리를 유지한다. discovery/preset은 UX만 보조하고 identity/thread/draft/receipt를 유지한다. 원래 P의 30분/30호출·5/15/45초·120초·pass3은 미승인 제안이며 U1/U2에 남긴다. 설계 쟁점의 결정은 [운영 계약](../company-workflow-plan.md)에 한 번만 정의한다.

## 구현 순서와 수용 기준

| 원래 작업 | 개정 연결 | 상태 |
| --- | --- | --- |
| CHAT-01/02 | R1 데이터·R2 발화/dispatch·R3 control.* | 제안/NOT_RUN |
| CHAT-03/04 | R2 상주/focus·R5 열린 큐·R7 Wiki | 제안/NOT_RUN |
| CHAT-05 | R4 실제 연결 UX·R6 실행·R8 전체 수락 | 실계정/DOM/호스트 UNVERIFIED |

실제 파일/심볼·신규 제안·모델·이관·유지/변경·숫자 gate·rollback은 [8단계 계획](../resident-implementation-plan.md)에 둔다. WJ 기반을 재작성하는 순서가 아니며 기존 fixture/schema 성공을 새 상주/큐/Wiki 완료로 세지 않는다.

공유 Wiki는 R7 필수다. 개인 provider 기억 import·이미지 생성·스티커 제작은 후속이다. 메모를 추가할 때는 공개 메시지에서 만든 공유 메모와 계정별 비공개 이력을 구분하고 원문 출처·적용 세대를 남긴다. 기존 ChatGPT/dot 기억을 로그인만으로 가져오거나 모든 참여자에게 공유했다고 주장하지 않는다. 범용 파일 생성·실행 가능한 HTML 작업공간·웹 공개 접속·외부 CDN 의존은 이번 GUI 참고에서 자동 도입하지 않는다.

이번 산출물은 이 검토서와 개발/토론/UI/실행 순서의 계획 변경이다. 제품 구현·시안 화면·실계정 수다의 완료 표시는 하지 않는다. 외부 코드·이미지는 /tmp에서만 읽었고 서비스·DB·계정·Chrome·허용 경로는 변경하지 않았다. 이번에는 로컬 계획 파일로 제출한다. commit/push/PR 생성·편집·병합·배포는 하지 않는다. 후속 구현의 사용자 merge 정책은 유지한다.
