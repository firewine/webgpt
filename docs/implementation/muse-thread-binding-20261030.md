# Muse의 기존 사이드 채팅 연결

- 날짜: 2026-10-30 (KST)
- 기준 main: `d031a3ad5cc42e2dde5f47082466294371a2399f` (사용자 PR #7 병합)
- 작업 브랜치: `codex/muse-thread-binding-20261030`
- 요청: 현재 서버 Chrome에 열린 기존 Muse 사이드 채팅을 thread ID로 구분해 연결
- 최초 등록 판정: 실제 DOM·thread·준비 상태 probe, 연결·참여자 등록, HTTPS UI 확인 PASS. 당시 실제 Muse 발언·응답 왕복 NOT_RUN.
- 후속 판정: 사용자가 시작한 첫 실제 Muse 요청·응답의 대조·수신 누락 복구 PASS. 후속 질문·전체 혼합 토론은 미검증.

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

## 최초 등록 시점의 검증

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

## 실제 첫 응답의 수신 누락과 복구

등록 이후 사용자가 토의를 시작했고 Muse가 답했다는 표시와 대화창의 내용이 맞지 않는다고 제보했다. 앱에는 모의 A/B 이후 Muse의 첫 요청이 running이었지만 receipt·응답 본문이 없었다. 실제 Muse의 동일 thread에는 사용자 요청 1개와 답변 1개가 추가돼 있었다. 원래 요청 전체·marker·thread·URL을 대조해 실제 전송과 응답을 확인했다.

원인은 메시지 앞의 `data-copy-exclude` 표시용 span이었다. UI용 두 글자가 textContent의 맨 앞에 붙어 있어 실제 본문 marker가 offset 2에 있었고, 기존 startsWith 검사가 요청을 찾지 못했다. 단순 includes로 완화하지 않고 메시지 DOM의 복사 제외 요소만 clone에서 제거해 본문을 읽도록 고쳤다. 원래 DOM을 수정하지 않으며 본문 시작 marker·유일한 요청·thread 확인을 유지한다. 응답의 복사 제외 표시도 같은 방식으로 제거한다.

### 확인·복구 결과

- 후속 발언을 막도록 토의를 일시정지했다. 실제 요청 전체와 원래 prompt의 일치, thread·URL·유일한 marker·응답 중 신호 해제를 확인했다.
- 답변 원문 1,697자의 SHA-256을 비공개 복구 파일에 보존했다. 유효한 StructuredReply였고 표시용 text는 687자였다. 사적인 내용·실제 대화 ID·원문 해시는 공개 문서에 싣지 않는다.
- 수정한 관측 코드가 같은 원문 해시를 반환하는 것을 확인했다. 웹앱만 재시작해 적용하고 기존 Chrome·대화를 유지했다.
- 미확정 turn에 기존 owner reconcile API로 실제 응답과 수신 참조를 반영했다. turn은 completed, 토의는 blocked로 남겼으며 자동 재개·새 요청·재전송은 하지 않았다.
- 서버 Chrome을 기존 답변 위치로 스크롤했고, 실제 HTTPS 웹쫀쿠 타임라인에서도 같은 표시 본문·완료 badge와 명시적 이어가기 버튼을 확인했다. 앱 재시작 후 현재 MCP page ID도 다시 대조·갱신했다.
- 회귀 검사는 표시용 prefix, 본문 안에만 인용된 marker의 오인 방지, 이미 존재하는 답변의 무전송 회수, 사용자 초안 보존, 다음 사용자 메시지 이후 응답 제외, 중복 marker 거절을 확인한다.

이 결과는 실제 첫 Muse 요청·응답을 원문 대조해 복구한 증거다. 전체 혼합 토론·후속 질문·자동 복구 전체가 완료됐다는 뜻은 아니다. 기존 답변을 복구한 뒤 실제 모델 요청은 추가로 보내지 않았다. 토의는 사용자가 이어가기로 재개한다.

후속 수정의 전체 검사도 Node 41 PASS, 실제 Chrome·MCP 브라우저 6 PASS / 0 FAIL / 0 SKIP으로 완료했다. 실제 응답 원문과 웹쫀쿠 표시 본문이 같은지도 HTTPS UI에서 확인했다.
