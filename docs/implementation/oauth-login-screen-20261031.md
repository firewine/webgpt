# GPT OAuth 로그인 화면 표시 수정

2026-10-31 사용자가 “별도 로그인 창 열기”가 열리지 않는다고 보고했다. 기준은 PR #22 병합 main `8f7866388823e46ade64446343d53351c7ef85e5`, 작업 브랜치는 `codex/fix-oauth-login-window-20261031`이다. 페이즈 8 검증 변경은 별도 브랜치의 로컬 commit으로 보존하고 로그인 문제를 우선 점검했다.

## 원인과 수정

기존 `control.ts::showOAuth`는 서버의 `BrowserBridge.openAuthorization`만 호출했다. 연결별 격리 탭은 Ubuntu Chrome에 생성되지만, 웹 클라이언트에 새 창이나 원격 화면을 표시하지 않았다. noVNC는 기존 수동 조작 lease가 필요한데 이 단계도 버튼에 연결되지 않았다. 서버에 로그인 탭이 남아 있어도 사용자가 웹에서 볼 수 없는 경로였다.

`openOAuthScreen`은 기존 `/api/browser/control`로 수동 조작을 얻고, 기존 인증된 `/browser/` gateway를 앱 안의 큰 dialog/iframe으로 표시한다. 팝업 차단에 의존하지 않는다. 그 뒤 같은 격리 로그인 창을 연다. 생성 오류도 화면에 남기며 진행 중 browser 발언은 기존 guard가 거절한다. 화면만 닫으면 잠금을 유지하고 명시 재개 버튼만 자동 입력을 재개한다. 로그아웃 때 iframe과 승인 주소를 지운다. PC/모바일은 기존 noVNC scale 경로를 사용한다.

제품 변경은 `src/web/control.ts`·`control.html`·`control.css`에 한정한다. OAuth endpoint·PKCE/state/nonce·계정/키·provider complete·기존 profile·승인/예산·Store/API 계약 변경0이다. 별도 인증 방식·새 백엔드·provider 또는 자동 재로그인을 만들지 않았다.

## 검사와 실환경 구분

수정 전 새 browser2개는 FAIL이었다. 수정 후 두 검사와 기존 전체 회귀가 통과했다. Node222 PASS, 실제 Chrome156.0.8078.47/Chrome DevTools MCP1.12.0 browser38 PASS, 모두 FAIL0/SKIP0이다. 검사 파일은 [oauth-login.test.mjs](../../tests/browser/oauth-login.test.mjs)다. 임시 DB·격리 browser·모의 인증/원격 화면을 쓰며 실제 비밀번호·모델 호출은0이다. 1440/390px 표시·수동 lease·명시 재개·화면만 닫기·진행 중 작업 거절·창 생성 오류를 확인했다.

운영 서비스는 재시작하지 않았다. 기존 owner API로 해당 연결의 새 OAuth 요청·서버 Chrome 창 열기·인증 원격 화면 HTTP200·콜백 listener를 확인했다. 소유자 키는 프로세스 안에서만 사용하고 출력/문서화하지 않았다. 수동 조작은 사용자 로그인용으로 유지했으며 다른 대화에 입력하지 않았다. 새 inline 화면은 이 수정의 운영 반영 전까지 fixture 결과다. 실제 사용자 로그인·동의·identity/모델 목록은 별도 완료 관측 전까지 NOT_RUN이다.

공식 [등록·로그인 문서](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)의 같은 호스트 loopback 콜백과 계정별 issued client ID 계약을 대조했다. 서버 재시작 전의 과거 승인 URL/창을 재사용하지 않고 새 시도를 시작해야 한다. 직접 로그인·동의가 필요한 단계를 자동화하거나 검증을 생략하지 않는다.

복귀는 변경한 client 화면만 이전 빌드로 되돌리고 기존 서버 상태/키/대화/profile은 유지한다. 수동 조작 잠금은 소유자가 기존 자동 입력 재개로 해제하며 다른 계정 로그아웃·Chrome 초기화·DB 삭제를 하지 않는다. 이번 UI 수정은 기존 로그인 흐름의 오류 수정이며 페이즈 8의 무인 topic/실계정 수락을 완료로 바꾸지 않는다.
