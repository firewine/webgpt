# GPT 기기 코드 연결 — 2026-10-31

사용자가 지정한 [opencodex 고정 리비전 검토와 추가 승인](../reviews/opencodex-login-review-20261031.md)에 따라 별도 `codex-oauth` 연결을 구현했다. 일반 GPT의 dynamic-client OAuth·기존 계정·전역 Codex 인증 파일·사용자 thread는 변경하지 않는다. 운영 배포·실계정 로그인·모델 권한·실제 추론은 **NOT_RUN/UNVERIFIED**다. 아래 결과는 모의 서버/계정 검사다.

## 사용 흐름

1. `참여자와 연결 → GPT · 기기 코드 로그인`에서 별칭과 **필수 이메일**을 입력한다.
2. `기기 코드로 로그인`을 누르면 앱 안에 코드와 `이 기기에서 인증 페이지 열기`가 표시된다. 현재 기기의 브라우저에서 해당 계정으로 로그인하고 코드를 입력한다. 서버 Chrome/noVNC/loopback callback은 필요하지 않다.
3. 서버가 서명·issuer/audience·기대 이메일·sub/account ID를 대조한 뒤 credential을 저장한다. 로그인 완료와 실제 허용 모델 조회를 구분해 표시하며 조회 실패는 성공으로 숨기지 않는다.
4. 확인한 계정·모델로 참여자를 만든다. Extra high 지원 모델이면 기본 xhigh이며 나머지는 실제 카탈로그에 보고된 사고 깊이에서 선택한다. 이전 토의는 고정된 설정을 유지하며 일시정지 후 명시 변경할 수 있다.

새로고침했거나 화면을 닫았다면 같은 계정 카드의 `기기 코드 로그인`으로 원래 pending 요청을 연다. 만료/취소 뒤 새 요청은 직접 시작한다. 화면만 닫기는 취소가 아니며, `로그인 취소`가 승인 확인을 멈춘다. 완료/취소/만료·닫기/로그아웃 때 코드를 화면에서 지운다. 클립보드를 못 쓰면 화면의 코드를 직접 선택할 수 있다. 다른 계정으로 승인한 경우 연결을 거절하고 기존 credential을 보존한다.

이 연결의 모델/한도는 **Codex 계정 권한**을 따른다. 일반 GPT API에 이 token을 보내거나 ChatGPT 웹 대화/기억을 가져왔다고 표시하지 않는다. 기존 server Chrome의 수동 조작 잠금도 자동으로 해제하지 않는다.

## 재사용과 경계

- `CodexOAuth`: 작은 인증 Adapter다. 시작 전 intent/command 결과와 계정 metadata를 기존 Store transaction에 기록한다. 같은 requestId의 결과와 같은 계정의 진행 요청을 복구하며 restart 뒤 유실된 grant를 새로 전송하지 않는다. device ID/verifier/코드는 메모리에만 두고 `/api/state`·event·DB에는 공개하지 않는다. 완료/중단 후 메모리 코드를 비운다.
- 서버 승인 확인은 flow당 하나이며 최대15분·요청별30초·간격 최소1초다. active8/전체32 한도를 두고 403/404 pending만 같은 grant에서 확인한다. 401/429/5xx는 원래 시도를 실패로 남기고 새 grant/model fallback을 시작하지 않는다. 임의 인증 URL을 받지 않는다. 상태 GET은 원래 승인 진행을 조회하며 모델/job을 시작하지 않는다.
- 기존 `OAuthService.identity`의 JWT 서명·issuer/audience/sub 검사와 vault를 사용한다. 새 code 교환은 Codex grant/endpoint이며 SIWC scope/resource를 섞지 않는다. refresh는 connection ID별 직렬화하고, 일시적 실패에 기존 token을 지우지 않는다. 만료는 보고된 expires_in/검증된 ID token의 exp에 근거하며 임의 1시간을 만들지 않는다. cancel/close/구 flow 뒤 늦은 결과는 publish하지 않는다.
- `Providers.models/complete`에 새 kind를 결합한다. 모델 조회의 client_version은 설정된 Codex binary의 실제 `--version` 관측값이며 없으면 차단한다. 실제 허용 모델과 reasoning level만 쓴다. Codex models/responses 고정 주소·계정 헤더·별도 token으로 전송하고 원래 stream 완료/receipt/usage·미확정 분류를 재사용한다. 모델 응답으로 shell이나 Codex 도구를 실행하지 않는다.
- 토론/방/큐/Wiki는 기존 `Providers.complete` 인터페이스·단일 dispatch·전송 전 journal·승인/격리·구조화 parser를 유지한다. code job의 기존 Codex App Server와 별개인 **대화 연결**이다. 사용자 전역 auth/config/session 파일을 읽거나 쓰지 않으며 로컬 CLI 실행은 버전 조회뿐이다. 자동 warmup 추론·pool 전환·가격 추정은 없다.
- HTTP 시작/상태/취소/로그아웃은 기존 owner·Host/Origin 검사 뒤에 있다. 코드 응답은 해당 소유자의 직접 상태 경로에만 있고 token은 vault에 둔다. 인증 응답은64KiB, Codex 모델 카탈로그는4MB로 제한하고 upstream 오류 본문을 사용자 로그에 반사하지 않는다. 로그아웃은 로컬 해제이며 원격 token 폐기는 확인하지 못했다고 표시한다.

새 kind/선택 metadata라 SQL migration·기존 계정 재등록·데이터 초기화는 없다. 기존 topic의 계정 snapshot·문맥 인계·MCP 권한은 유지한다. [SSOT](../development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)에 선승인 변경을 기록했다.

## 검사

- PASS: 기기 코드 Node15개 — 중복20회/grant1/poll1, 같은 계정 요청 복구, 실제 RSA/JWKS로 서명·audience·이메일·sub/account 대조, 취소/종료 뒤 늦은 저장0, 만료/restart 유실 요청 재전송0, 계정별 refresh1·일시 실패 보존·한 계정 로그아웃, 오류/과대 JSON·잘못된 Origin·이메일 필수·token 종류 혼용 거절.
- PASS: 두 모의 계정이 각자 모델/이력으로 기존 DiscussionEngine의 전체 구조화 토론을 완료했다. 모든 turn의 원래 receipt/usage/effort를 확인했으며 실제 모델·job 호출0이다.
- PASS: 새 브라우저2개 — 코드·고정 링크·클립보드 실패 fallback·reload/같은 grant·로그인 후 모델/effort/참여자 등록, 잘못된 이메일·취소·만료·390px. 서버 Chrome iframe0·자동 browser 잠금 변경0이다.
- 최종 통합: `npm run check` strict TypeScript·빌드·Node270 PASS, FAIL/SKIP0. 실제 Chromium156.0.8078.47/Chrome DevTools MCP1.12.0 전체 browser46 PASS, FAIL/SKIP0이다. 이전 단계 검사를 대체하거나 수락 gate 숫자를 낮추지 않았다.
- NOT_RUN: 사용자 실제 계정 승인·Codex 모델 권한/카탈로그·실제 Responses/refresh·혼합 상주 운영·운영 배포. 실제 사용 성공은 모의 검사로 판정하지 않는다.

[390px 모의 계정 화면](./assets/phase8-20261031/device-login-390.png)은 임시 fixture이며 실제 운영 계정/코드가 아니다.

소스는 [OpenAI Codex 기기 코드 안내](https://developers.openai.com/codex/auth), [설치 계약 0.165.0 device_code_auth.rs](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/login/src/device_code_auth.rs), 지정 opencodex의 auth/model-entitlements/warmup을 대조했다. 소스·자산 복사0이다. 공식 문서가 일반 GPT dynamic-client flow의 기기 코드 호환성을 보장한다고 주장하지 않는다.

## 복귀

G0로 새 발언/업무/topic을 막고 원래 turn/job/receipt를 대조한다. 새 kind의 멤버를 off로 두고 준비/미확정 발언이 없는 경계에서 이전 빌드로 복귀한다. 새 credential/연결·토론 원문·commands를 삭제하거나 기존 GPT kind로 바꾸지 않는다. pending 기기 코드는 로컬 취소하며 remote grant 폐기 성공으로 표시하지 않는다. 실계정 R8-D·실기기·쓰기 gate는 그대로 남는다. 병합과 운영 반영은 사용자 담당이다.

지속 SSE와 느린 상태 조회(350ms)가 겹칠 때 제어가 무한 갱신을 기다리던 경우를 실제 Chrome fixture로 재현했다. refresh는 조작 후 시작한 다음 조회 한 번을 기다리고, 같은 화면의 제어는 그 확인 뒤 순차 진행한다. 별도 settingsVersion CAS·기존 주제 선택 보호·SSE 한 연결은 유지한다. 이 변경은 인증/모델/권한 계약을 바꾸지 않는다.
