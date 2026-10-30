# Muse의 기존 사이드 채팅 연결

- 날짜: 2026-10-30 (KST)
- 기준 main: `d031a3ad5cc42e2dde5f47082466294371a2399f` (사용자 PR #7 병합)
- 작업 브랜치: `codex/muse-thread-binding-20261030`
- 요청: 현재 서버 Chrome에 열린 기존 Muse 사이드 채팅을 thread ID로 구분해 연결
- 판정: 실제 DOM·thread·준비 상태 probe, 연결·참여자 등록, HTTPS UI 확인 PASS. 실제 Muse 발언·응답 왕복 NOT_RUN.

## 실제 관측과 적용

현재 대화의 메시지 DOM에 `data-hatch-link-entry-point` JSON의 `thread_id`가 있었다. 처음에는 홈 URL을 유지하다가 실제 대화를 지정한 뒤 thread 경로도 관측됐다. 주소만 같아도 사이드 채팅이 바뀔 수 있으므로 URL·agent 식별과 별도로 실제 thread ID를 고정했다. 화면의 agent 표시는 May였으며 연결 이름은 “Muse · 현재 사이드 채팅”, 참여자는 “Muse · May”로 등록했다. 공개 문서에 실제 thread ID·계정·대화 원문을 복사하지 않는다.

대화 입력란은 비어 있었고, 전송 버튼은 글을 입력한 뒤에만 생성됐다. 실제 메시지를 보내지 않는 임시 초안을 잠깐 입력해 버튼 속성을 확인하고 빈 상태로 복원했다. 응답 중 stop 버튼과 streaming 표시는 현재 페이지가 불러온 frontend의 DOM 정의로 대조했으며, 비공개 대화 API·쿠키·인증 값을 추출하거나 재현하지 않았다.

실제 앱의 소유자 API로 browser connection과 participant를 등록했다. 읽기 전용 probe에서 현재 thread는 일치하고 의도적으로 다른 thread 값은 불일치했다. 앱 재시작 뒤 MCP의 page ID가 바뀌어 첫 등록은 `browser_target_mismatch`로 거절됐다. 현재 URL과 페이지 목록을 다시 대조한 뒤 같은 thread를 등록했다. 잘못된 탭에 입력하거나 불확실한 메시지를 재전송하지 않았다.

## 코드 변경

- BrowserBinding의 선택 필드 `thread`는 DOM 선택자·속성·기대 값과 선택 JSON 키를 가진다. 관측, 입력 직전, 클릭 직전, 응답 관측마다 현재 표시된 thread 값의 일치를 확인한다. 값이 없거나 JSON이 잘못되거나 다른 값이 섞이면 전송을 허용하지 않는다.
- 연결 갱신에서는 page ID·선택자를 고칠 수 있지만 등록한 thread 값을 변경하거나 guard를 제거할 수 없다. 다른 대화를 연결하려면 새 연결을 사용한다.
- `sendAppearsAfterInput`을 명시한 화면에서는 빈 입력란에 버튼이 없어도 probe할 수 있다. 글을 넣은 다음 버튼을 다시 찾고 활성·준비·thread 상태를 재확인한다. 사라진 버튼이나 disabled/aria-disabled 버튼을 성공 클릭으로 간주하지 않는다.
- 응답을 현재 marker 뒤부터 다음 사용자 메시지 전까지로 한정하고 여러 assistant 블록을 합친다. 이후 사용자의 별도 대화 답변을 이번 결과에 섞지 않는다.
- UI는 연결된 대화 ID를 표시하고 갱신 폼에 thread·동적 버튼 설정을 보존한다. guard 필드가 일부만 채워지면 등록을 막는다.

## 검증

| 검증 | 결과 | 범위 |
| --- | --- | --- |
| TypeScript·Node | PASS | `npm run check`: 41 PASS / 0 FAIL / 0 SKIP |
| Chrome·MCP·UI | PASS | Chrome 156.0.8078.47 + MCP 1.12.0: 5 PASS / 0 FAIL / 0 SKIP |
| 같은 URL의 thread 변경 | PASS | 다른 thread에서 입력 전 거절, 입력 후 thread 변경도 클릭하지 않음 |
| 동적 전송 버튼 | PASS | fixture에서 입력 후 생성된 버튼으로 한 번 전송, 같은 marker 재조회는 재전송하지 않음 |
| 응답 범위 | PASS | 분할 답변을 수집하되 다음 사용자 메시지 이후 응답 제외 |
| 연결 API | PASS | thread·동적 버튼 저장, page ID 갱신 허용, thread 변경·제거 거절 |
| 실제 Muse 읽기 전용 probe | PASS | URL·agent·DOM thread·준비 상태 일치, 초안 없음, 다른 thread 값 거절 |
| 실제 등록 | PASS | 실제 앱에 browser connection 1개와 Muse 참여자 1개 등록 |
| 실제 HTTPS UI | PASS | 연결 카드·thread ID 표시, 갱신 폼의 thread·동적 버튼 값 보존 |
| 기존 데이터·Chrome | PASS | 앱만 재시작. Chrome PID·기존 대화·수동 lease 보존, 사용자 미추적 35개 파일 내용 유지 |
| 실제 발언·응답·혼합 토론 | NOT_RUN | 실제 Muse에 전송한 메시지 0개. 로그인·정적 연결을 추론 성공으로 표시하지 않음 |

최종 검사는 build를 공유하므로 순차 실행했다. 중간 병렬 build가 산출물을 지우면서 발생한 ENOENT 결과는 성공 근거로 사용하지 않고, Node 검사 뒤 동일 build의 브라우저 5개를 모두 다시 확인했다.

개인 thread·전체 DOM·대화·스크린샷·credential은 commit하지 않는다. 이번 연결은 사용자가 지정한 기존 대화를 대상으로 하며 다른 사이드 채팅을 열면 고정한 thread와 다르므로 자동 전송이 중지된다. 실제 모델 응답과 후속 맥락·중단 복구는 다음 검증으로 남긴다. PR 병합은 사용자 담당이다.
