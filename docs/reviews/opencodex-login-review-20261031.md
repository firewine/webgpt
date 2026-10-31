# opencodex GPT 로그인 검토 — 2026-10-31

사용자 지정 저장소 [lidge-jun/opencodex](https://github.com/lidge-jun/opencodex), 고정 리비전 `9df4f6a56483ffe62526e29c7d9c6eeed3e742f4`를 정적 검토했다. 임시 checkout의 코드를 읽었으며 설치·실행·자격 증명 가져오기·모델 호출은 하지 않았다. MIT를 확인했으며 소스/자산 복사 0이다. 향후 파일을 복사한다면 원문 MIT 고지와 파일별 출처를 함께 보존한다.

## 실측 결과와 적용 판정

| 근거(고정 리비전의 심볼) | 관측 | 웹쫀쿠 적용 |
|---|---|---|
| [chatgpt.ts · ChatGPTOAuthFlow/loginChatGPT](https://github.com/lidge-jun/opencodex/blob/9df4f6a56483ffe62526e29c7d9c6eeed3e742f4/src/oauth/chatgpt.ts) | Codex용 브라우저 PKCE, 별도 device 분기 | 일반 GPT의 dynamic client를 이 token으로 바꾸지 않는다. 기존 경로 보존, 별도 기기 코드 연결 추가 |
| [chatgpt-device.ts · loginChatGPTDevice](https://github.com/lidge-jun/opencodex/blob/9df4f6a56483ffe62526e29c7d9c6eeed3e742f4/src/oauth/chatgpt-device.ts) | 짧은 코드와 고정 인증 페이지, 15분 grant·제한된 poll·server PKCE | 원격/모바일에서 서버 Chrome 없이 로그인하는 흐름 채택. 실제 계정 capability는 UNVERIFIED |
| [login-flow.ts · handleCodexAuthLogin](https://github.com/lidge-jun/opencodex/blob/9df4f6a56483ffe62526e29c7d9c6eeed3e742f4/src/codex/auth-api/login-flow.ts) | launch 결과 started/failed/skipped, 별도 진행 상태/취소/계정 대조 | 창 생성과 화면 표시를 구분하고 오류/대기/완료/취소를 보인다. repo의 자동 warmup 추론은 채택하지 않는다 |
| [login-url-block.tsx · LoginHint](https://github.com/lidge-jun/opencodex/blob/9df4f6a56483ffe62526e29c7d9c6eeed3e742f4/gui/src/components/login-url-block.tsx) | 코드·복사·명시 링크, 클릭 시 코드 복사+페이지 열기 | owner만 짧은 코드를 보고 클릭으로 인증 페이지를 연다. 코드/승인 주소를 로그·공개 snapshot·문서에 남기지 않는다 |
| [use-add-codex-account-oauth.ts · startOAuth](https://github.com/lidge-jun/opencodex/blob/9df4f6a56483ffe62526e29c7d9c6eeed3e742f4/gui/src/components/use-add-codex-account-oauth.ts) | flow ID·단일 poll·진행/취소·기기 코드 선택. 409 재시도 분기도 존재 | 진행 요청 복구와 만료를 명시한다. 다른 요청을 취소하거나 자동 로그인/모델 호출로 대체하지 않는다 |
| [chatgpt-shared.ts](https://github.com/lidge-jun/opencodex/blob/9df4f6a56483ffe62526e29c7d9c6eeed3e742f4/src/oauth/chatgpt-shared.ts), codex/model-entitlements·warmup | Codex용 client/token·backend models/responses가 일반 API와 다름 | 기존 `api.openai.com` 인증과 분리한 `codex-oauth` 종류로 추가. 기존 계정·대화·CLI auth 파일 변경 0 |

OpenAI 공식 [기기 코드 안내](https://developers.openai.com/codex/auth), [App Server 인증](https://developers.openai.com/codex/app-server), 설치본과 같은 [Codex 0.165.0 device_code_auth.rs](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/login/src/device_code_auth.rs)도 대조했다. Codex 기기 코드 지원이 일반 GPT [dynamic-client 등록](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)에도 동일하다는 근거는 없다. 기기 코드의 account entitlement·모델 가용성은 실계정 검증 전까지 UNVERIFIED다.

## 즉시 수정하는 기존 로그인 UX

이메일은 사용자 요구에 따라 UI·owner API에서 필수다. 승인 전 입력한 기대 이메일과 검증된 ID token의 이메일을 대조하며, `login_hint`는 입력 편의용이고 인증 증거로 세지 않는다. 기존 이메일 없는 계정도 같은 connection ID에서 이메일 확인을 받고 재개한다. 한 번의 로그인 시작으로 인증된 서버 Chrome dialog를 열고, 명시 재열기·오류·수동 잠금/재개를 유지한다. 이는 기존 인증 계약을 제거하는 변경이 아니다.

## 추가 승인과 변경 영향

영향 보고 후 사용자가 **“기기 코드 연결 별도 추가 승인 (권장)”**으로 승인했다. 예상 총14~20파일·800~1,500줄. source8~12, tests3~4, 계획/운영/근거3~4다. R8 준비에 추가하며 확정 후속 페이즈는 없다. 기존 R1~R7·50 gate 숫자·R8-A B안·토론/큐/Wiki·provider1·승인/격리는 유지한다.

- 제안 `src/connections/codex-oauth.ts`: 계정별 기기 코드 시작·진행·취소·refresh와 기존 vault 사용. 코드·device ID·verifier는 owner 외부로 내보내지 않는다. 15분/요청별 timeout·동일 계정 요청 복구·취소 후 늦은 결과 거절·refresh 직렬화가 필요하다.
- 기존 `model.ts`, `runtime.ts`, `providers.ts`, `oauth.ts`, `settings.ts`: 새 kind·계정 ID별 credential 분리·서명/issuer/audience/sub/이메일 검사 재사용·실제 모델 discovery·기존 complete/stream/usage/receipt 접점 결합. Codex 기기 코드 token을 일반 GPT token으로 저장하지 않는다. 직접 Codex grant/추론 endpoint를 쓰되 공식/지정 소스와 대조하고 임의 URL을 받지 않는다. 기존 CLI auth·세션·전역 설정을 읽거나 쓰지 않는다.
- 기존 `http/workspace.ts`·`control.*`·`room-view.ts`: owner/Host/Origin으로 보호한 기기 코드 시작/상태/취소와 명시 선택 UI. 로그인 후 실제 모델 조회 성공과 유료 추론 성공을 구분한다. 모델이 지원하는 사고 깊이만 선택한다.
- additive kind/선택 metadata라 SQL 이관·기존 credential 재발급은 없다. 기존 provider 인터페이스·dispatch/idempotency/미확정 대조는 유지한다. 이전 빌드 복귀 전 새 kind의 발언을 off로 두고 원문/credential은 삭제하지 않는다.
- 수락: 2계정 키/모델/이력 분리, 미입력/불일치·기존 identity 교체·구 flow/만료·취소 후 결과의 credential 저장0, 중복 시작20→grant1·중복poll0·401/429/5xx·전송 timeout 대조, 정상 stream 완료/receipt/보고 usage, 390px/로그인 링크·클립보드 실패·새로고침·권한 회귀. 기존 Node/Chrome/MCP 전체 검사도 수행한다. 실계정 로그인은 사용자 직접 동의, 실추론/배포는 별도 허가·관측 전 NOT_RUN이다.

이 승인은 로그인 방식/어댑터 추가에 한정하며 자동 추론 warmup·계정 pool 자동 전환·전역 Codex 로그인 덮어쓰기·기존 안전 gate 해제·PR 자동 병합을 포함하지 않는다.
