# GPT OAuth 로그인 화면 표시 수정

2026-10-31 사용자가 “별도 로그인 창 열기”가 열리지 않는다고 보고했다. 기준은 PR #22 병합 main `8f7866388823e46ade64446343d53351c7ef85e5`, 작업 브랜치는 `codex/fix-oauth-login-window-20261031`이다. 페이즈 8 검증 변경은 별도 브랜치의 로컬 commit으로 보존하고 로그인 문제를 우선 점검했다.

## 원인과 수정

기존 `control.ts::showOAuth`는 서버의 `BrowserBridge.openAuthorization`만 호출했다. 연결별 격리 탭은 Ubuntu Chrome에 생성되지만, 웹 클라이언트에 새 창이나 원격 화면을 표시하지 않았다. noVNC는 기존 수동 조작 lease가 필요한데 이 단계도 버튼에 연결되지 않았다. 서버에 로그인 탭이 남아 있어도 사용자가 웹에서 볼 수 없는 경로였다.

`openOAuthScreen`은 기존 `/api/browser/control`로 수동 조작을 얻고, 기존 인증된 `/browser/` gateway를 앱 안의 큰 dialog/iframe으로 표시한다. 팝업 차단에 의존하지 않는다. 그 뒤 같은 격리 로그인 창을 연다. 생성 오류도 화면에 남기며 진행 중 browser 발언은 기존 guard가 거절한다. 화면만 닫으면 잠금을 유지하고 명시 재개 버튼만 자동 입력을 재개한다. 로그아웃 때 iframe과 승인 주소를 지운다. PC/모바일은 기존 noVNC scale 경로를 사용한다.

사용자가 추가 보고한 `signin_pending`은 미만료 요청이 있을 때 `OAuthService.begin`이 409만 반환해 새로고침 후 승인 화면을 복구할 수 없던 오류다. 같은 연결은 원래 state/nonce/PKCE/attemptId/승인 주소를 반환하며 만료 시간을 연장하지 않는다. 다른 기대 계정으로 바꾸려 하면 거절하고, 완료/만료된 callback은 다시 사용하지 않는다. 자동 재인증·계정 전환·token 폐기는 하지 않는다.

추가 사용자 요청으로 이메일은 UI/owner API 필수이며, 입력한 이메일을 login_hint로 전달하고 검증된 identity와 대조한다. 기존 이메일 없는 연결도 같은 ID에서 입력을 받아 재개한다. 로그인 시작과 다시 로그인이 원격 dialog를 자동으로 열며 별도 재열기 버튼은 복구용으로 유지한다.

제품 변경은 `src/web/control.ts`·`control.html`·`control.css`, `src/http/workspace.ts`와 `src/connections/oauth.ts::begin/authorization`이다. OAuth endpoint·PKCE/state/nonce·계정/키·provider complete·기존 profile·승인/예산·Store transaction은 유지한다. 기존 응답 필드도 그대로다. 새 백엔드·인증 방식·provider는 만들지 않았다.

## 검사와 실환경 구분

수정 전 새 browser2개는 FAIL이었다. 초기 수정 후 Node222·browser38 PASS였다. pending 복구 추가 후 `npm run check`는 Node225 PASS, 실제 Chromium156.0.8078.47/Chrome DevTools MCP1.12.0 전체 browser39 PASS, FAIL/SKIP0이다. 검사 파일은 [oauth-login.test.mjs](../../tests/browser/oauth-login.test.mjs)와 [oauth.test.mjs](../../tests/oauth.test.mjs)다. 임시 DB·격리 browser·모의 인증/원격 화면을 쓰며 실제 비밀번호·모델 호출은0이다. 1440/390px 표시·수동 lease·명시 재개·화면만 닫기·진행 중 작업 거절·창 생성 오류, 새로고침 후 동일 요청 복구·20회 중복·다른 기대 계정·10분 만료·callback1회를 확인했다.

운영 서비스는 재시작하지 않았다. 기존 owner API로 해당 연결의 새 OAuth 요청·서버 Chrome 창 열기·인증 원격 화면 HTTP200·콜백 listener를 확인했다. 소유자 키는 프로세스 안에서만 사용하고 출력/문서화하지 않았다. 수동 조작은 사용자 로그인용으로 유지했으며 다른 대화에 입력하지 않았다. 새 inline 화면은 이 수정의 운영 반영 전까지 fixture 결과다. 실제 사용자 로그인·동의·identity/모델 목록은 별도 완료 관측 전까지 NOT_RUN이다.

추가 점검: 실제 운영 HTTPS를 통한 noVNC 암호화 연결·1600×1000 canvas·로그인 입력 화면의 실제 수신을 확인했다. 단순 HTML200만으로 화면 성공을 판정하지 않았다. 공개 기록에는 개인 화면·원문 승인 URL·키를 포함하지 않는다.

공식 [등록·로그인 문서](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)의 같은 호스트 loopback 콜백과 계정별 issued client ID 계약을 대조했다. 서버 재시작 전의 과거 승인 URL/창을 재사용하지 않고 새 시도를 시작해야 한다. 직접 로그인·동의가 필요한 단계를 자동화하거나 검증을 생략하지 않는다.

복귀는 변경한 client 화면만 이전 빌드로 되돌리고 기존 서버 상태/키/대화/profile은 유지한다. 수동 조작 잠금은 소유자가 기존 자동 입력 재개로 해제하며 다른 계정 로그아웃·Chrome 초기화·DB 삭제를 하지 않는다. 이번 UI 수정은 기존 로그인 흐름의 오류 수정이며 페이즈 8의 무인 topic/실계정 수락을 완료로 바꾸지 않는다.
