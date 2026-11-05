# 실제 ChatGPT 웹 참여 선택·호환성 검증 — 2026-11-05

상태: 웹 연결·후속 맥락·자동 회귀 PASS. 전체 페이즈8 수락은 미완료다. 기준 main `f31a28dbed068aee1e8034c5623259c2402a2389` (PR #48 병합). 실제 수락과 전체 페이즈8 완료는 구분한다.

## 사용자 승인과 변경

사용자는 실제 ChatGPT 웹 대화를 요구하고 “개발 후 검증가지 해”, “예전에 준 레퍼런스에 보면 어떻게 구현해야 하는지 다 있어”라고 지시했다. [영향 검토](../reviews/actual-web-gpt-impact-20261105.md)를 기준으로 기존 일반 GPT OAuth/기기 코드·공식 dot·Muse/API와 별도의 **GPT · ChatGPT 웹 대화** 선택을 제공한다.

- `control.ts::connectionMode/updateConnections`: 실제 ChatGPT URL의 browser 연결만 웹 GPT에 분류한다. dot이라는 이름/옛 태그나 유사 도메인으로 공식 dot·웹 GPT를 추정하지 않는다. 기존 등록 편집은 원래 작성자를 보존하고 연결 방식 변경은 새 참여자가 된다.
- `control.html`, 웹 연결 버튼: 기존 discovery/confirm UI로 이동한다. 웹 모델·사고 설정은 원래 웹 화면에서 조절하며 앱의 비활성 Extra high 선택을 적용된 값처럼 보이지 않게 한다.
- `browser.ts::sendScript`: 실제 최신 ProseMirror 편집기가 원시 텍스트 노드의 줄바꿈을 공백으로 바꾸는 현상을 관측했다. 이 편집기만 정상 삽입 경로를 사용하고 문단/줄바꿈을 직렬화해 **원문과 정확히 같은 경우에만** 최종 클릭한다. textarea·다른 contenteditable·Muse의 기존 입력 분기는 유지한다.
- `chatgpt-v1.json` version2: 최신 활성 페이지/메시지/입력 선택자를 보완하고 캐시된 비활성 페이지를 제외한다. 기존 프리셋과 probe/Store/Provider 인터페이스는 유지한다. `verification:UNVERIFIED`는 모든 계정/향후 DOM 지원을 보장하지 않는다는 뜻으로 유지한다.

## 레퍼런스 적용

[Nhahan/WebGPT `1d35588`](https://github.com/Nhahan/WebGPT/tree/1d35588e79de288bd8a6d2992fc76e571f7bb75e)의 `browser.mjs::dispatch/sendOnce/prepareMode/waitForReply`를 정적으로 대조했다. 실제 웹 Chat·사고 선택·소유한 대화·전송1회·완료/후속 맥락 확인 원칙을 적용한다. 이번 변경에 CUA 의존성·전체 terminal·공개 forwarding·자동 대화 삭제를 도입하지 않는다. 참고 코드/그림을 복사하지 않았다.

## 검사·실측 증거

- 기존 UI 보완 소스: `npm run check` Node556 PASS, 실제 Chromium156.0.8078.4/Chrome DevTools MCP1.12.0 browser68 PASS·FAIL/SKIP0. 최초 제한 환경/미설정 브라우저 경로 실행 실패를 통과로 세지 않았으며 호환성 보완 후 최종 검사는 아래에 추가한다.
- 실제 기존 Business 창의 **Chat** 선택과 웹의 **Extra High** 반영을 관측했다. OAuth 사용량 확인 창 대신 기존 로그인 창을 사용했고, 기존 Business/Muse 로그인·dot 설정은 보존했다.
- 새 검증 대화의 최초 웹 응답 PASS: 전송1회, 지정한 비밀이 아닌 확인 단어를 실제 응답·완료 조작 요소·웹 화면에서 확인했다. 계정·대화 ID·개인 원문·이미지는 공개 저장소에 포함하지 않는다.
- 최초 어댑터 후속 입력은 `browser_send_unconfirmed`로 정지했다. 동일 대화의 사용자 메시지·남은 검증 초안·영수증 부재를 대조해 **클릭 전 미전송**을 확인했다. 원문 줄바꿈만 공백으로 바뀌었으며 이를 올바른 전송이라고 처리하지 않았다.
- 호환성 보완 후 실제 편집기 dry run에서 원문 일치·최종 클릭 전 검사를 통과했다. dry run은 전송하지 않았고, 소유한 미전송 검증 초안만 대조·정리했다. 기존 실패/대조 기록은 삭제하지 않았다.
- 실제 Providers→BrowserBridge 후속 JSON·원래 맥락·receipt 수락 **PASS**: 보완 후3,699ms, dispatch1회·receipt 있음·`parseReply` 통과·이전 확인 단어 일치. 최초 미전송 입력과 같은 검증 과제만 대조해 이어갔으며, 실제 웹 요청은 bootstrap1+후속1로 합계2회다. API/dot/Muse/Codex 호출0, usage는 미제공으로 null이다. 운영 DB에 새 토의·토커를 만들거나 원래15개 답변의 작성자를 바꾸지 않았다.
- 수정 프리셋 `chatgpt-v1/2`의 실제 읽기 전용 discovery **ready**, binding 반환·profile 확인 PASS. 실제 웹의 새 요청 marker1개·초안 비어 있음·응답 중0·Extra High 유지·운영 state 전체 hash 및 완료15개 hash 동일을 최종 대조했다.
- 최종 호환성 소스의 `npm run check`: Node556 PASS·FAIL/SKIP0. `WJ_TEST_CHROMIUM_EXECUTABLE=<설치된 Chromium> WJ_TEST_CHROME_MCP=<설치된 MCP> npm run test:browser`: browser71 PASS·FAIL/SKIP0. 실제 Chromium156.0.8078.4와 MCP1.12.0을 사용했고 실제 계정 검증의 서버 Chrome은156.0.8078.47이었다. 최신 문단/빈 줄/인용/들여쓰기·원문 변형 거절·초안 보존·재전송0·비활성 캐시 제외·기존 Muse/dot/OAuth 회귀를 포함한다.

## 남은 범위와 복귀

전체 R8 주제 수정/종합·실제 Codex·업무/Wiki·실기기·재시작 수락은 이 짧은 웹 연결 검증으로 완료 처리하지 않는다. 원래 토의는 off/차단 상태와 완료15개를 보존한다. 새 웹 GPT를 그 토의로 자동 전환하지 않는다. 실제 UI의 계정 표시가 이니셜만 있으면 소유자가 프로필에서 계정을 확인해야 하며, 이 관측만으로 다중 계정 격리 전체를 통과로 표시하지 않는다.

복귀는 이 브랜치의 UI/프리셋/편집기 호환성 변경을 되돌리고 원래 운영 서비스를 유지하는 방식이다. 테스트 전용 state/실행기는 운영 DB와 분리돼 있고, 미확정 요청/사용자 초안·대화를 삭제하거나 Chrome 프로필을 초기화하지 않는다. 자동 병합하지 않는다.

최종 변경은14파일(구현4·검사4·계획/증거6)이다. 최초 작은 선택 UI 추정 뒤 실제 최신 편집기/캐시 DOM 호환성 문제를 관측해 관련4파일을 추가했으며 새 provider/인증/DB/phase는 만들지 않았다. 운영 서버는 기존 버전을 유지하고, 이 브랜치 배포·기존 토의의 참여자 전환은 수행하지 않았다. 원래 토의가 OAuth 제한으로 차단된 상태를 웹 검증 성공으로 덮지 않는다.
