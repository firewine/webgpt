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

## 운영 적용 후 재검증 — 2026-11-05

사용자가 PR #49 병합 main `ede85cd`를 운영 폴더에 적용한 뒤 검증을 요청했다. 운영 서비스/health200·새 JS/HTML 반영, 실제 HTTPS 화면의 discovery→연결/참여자 등록·새로고침 유지·SSE2회·390px 표시·오류0은 PASS였다. 기존 연결/참여자/토의/업무/방 설정은 변경하지 않았다.

자동 등록된 바인딩으로 전송하려 할 때 `browser_send_unconfirmed`가 발생했다. 실제 한국어 버튼명은 **보내기**였고, 프리셋의 **메시지 보내기**와 달라 전송 버튼을 찾지 못했다. 사용자 marker0·정확한 검증 초안 잔존·영수증 없음·선택자0/실제 버튼1을 대조해 **클릭 전 미전송**을 확인했다. 이번 운영 검증에서 실제 모델 요청은0회였으며 이 오류를 성공/자동 재전송으로 처리하지 않았다.

최소 보완은 기존 `chatgpt-v1`을 version3으로 갱신해 활성 페이지의 `aria-label="보내기"`를 추가하고, 기존 실제 Chromium 탐지 검사에 그 표현을 추가한 것이다. Provider/Store/인증/전송 전 대조 계약·Muse·dot은 변경하지 않았다. 관련 Node 검사와 Chromium/MCP 탐지7개가 PASS했으며, 실제 웹의 수정 프리셋 dry run도 최종 클릭 직전까지 원문/버튼 확인을 통과했다. dry run은 발언을 보내지 않았다.

실패한 검증의 원문·오류·대조 기록은 private하게 보존했다. 이번에 새로 만든 검증 연결/참여자만 기존 Store 트랜잭션으로 정리했고, 원래 운영 state 전체 hash·완료15개 hash를 원복 확인했다. 소유한 미전송 초안만 정리했으며 기존 계정/Chrome 프로필/대화/접속 키는 보존했다. 서비스는 정상 재기동됐다.

이 기록 시점에는 수정 프리셋의 운영 배포와 **남은 실제 웹1회 최종 확인이 아직 미실행**이다. 사용자가 담당하는 PR 병합 후 반영/재검증해야 하며 전체 페이즈8을 완료 처리하지 않는다. 기존 프리셋v2로 저장된 검증 바인딩은 남기지 않았으므로 기존 사용자 바인딩을 자동 수정하는 이관도 필요 없다.

첫 CI에서는 제품/새 버튼 검사는 통과했으나 기존 새로고침 회귀가 종료 정리 중 `route.fetch`→테스트 서버 연결 거부로 실패했다. 해당 검사만 `finally`에서 지연 응답 해제·요청 drain·브라우저 context 종료를 먼저 수행하도록 수정했다. 제품 실행·응답 판정·검사 조건은 바꾸지 않았다.

## PR #50 병합본 운영 적용·최종 검증 — 2026-11-05

사용자 병합 및 운영 반영/검증 승인 뒤 main `4ca2ffb5b24778f2d080b24033410d38e5513dd8`을 10:19 KST 운영 폴더에 반영했다. 검사 head `654daf8952007a9355c368beb1aebd804d07788e`와 동일 tree를 확인하고 기존 dist를 비공개 보관한 뒤 빌드·정상 서비스 재기동·health200을 확인했다. `.env`와 기존 state·완료15개는 적용 전후 동일했다. 위 절의 “아직 미실행”은 수정 PR 제출 당시 상태이며 아래 실측으로 보완한다.

- [최종 CI](https://github.com/firewine/webgpt/actions/runs/41947021662): Node556·실제 browser71 PASS, FAIL/SKIP0. Codex0.165.0 설치 schema 계약 PASS이며 실제 Codex 실행은0이다.
- 실제 HTTPS UI에서 `chatgpt-v1/3` 탐지→기존 검증용 웹 대화 연결→웹 GPT 참여자 등록을 확인했다. 영속 binding도 v3이며 새로고침 유지·SSE2회·390px 표시·화면 오류0이다. 새 연결/참여자는 각각1개다.
- 그 등록된 binding을 복사해 **운영 빌드의 Providers→BrowserBridge**로 실제 웹 요청을1회 보냈다. 검증 Store만 분리했으며 운영 토의 엔진을 재개한 검사는 아니다. 실제 웹 Extra High·25,621ms 완료·이전 확인 단어/맥락·JSON 계약/새 probe·receipt 수락을 확인했다. 웹의 같은 요청 marker1개·마지막 응답과 반환 text 동일·빈 초안·응답 중0을 최종 대조했다. 전송 전 hook 횟수만으로 외부 전송1회를 주장하지 않는다.
- 이번 최종 검증 창의 실제 웹 요청1회, 모델 API/dot/Muse/Codex 새 요청0이다. usage는 미제공이며 token·요금을 추정하지 않았다. 앞선 PR #49의 실제 웹2회와 이번 창1회는 별개다.
- 새 웹 연결/참여자를 제외한 **기존 운영 state 전체**·완료15개·환경 hash를 보존했다. 종료 시 방 off·Muse 잠금·원래 OAuth 토의 blocked/revision을 유지했다. 현재 상태로 일반화하지 않고 이 검증 종료 시각의 관측으로 기록한다.

비공개 증거의 `deployment-completed`, `ui-completed`, `provider-completed`, `state-after-provider`, `final-verified`, `final-audit` 기록을 대조했다. 요청/계정/대화 ID·개인 원문·접속 키·화면 이미지는 공개 저장소에 넣지 않는다. 실제 웹 연결의 운영 확인은 PASS이며 **R8 전체 무인 업무/Wiki·수정/종합·Codex·실기기/장기 운영 수락은 여전히 미완료**다.
