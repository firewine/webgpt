# D0 추가 OAuth 경계 영향 검토

> **제안·미승인 / 2026-11-01 KST.** 공식 dot 기본안은 승인됐지만 사용자는 “추가 OAuth 등 범위가 늘어나면 영향과 변경량부터 보고”하도록 지시했다. 이 문서는 확대 제안이며 OAuth 제품 코드·IdP 설정·계정 연결은 아직 변경하지 않았다. 기존 [기본안](./dot-official-mcp-events-impact-20261101.md)·[SSOT](../development-plan.md)와 [D0 실행 기록](../implementation/dot-mcp-events-d0-20261101.md)을 함께 본다.

**D0 후속 확인:** 설치한 공식 `tunnel-client 0.0.19`의 `help quickstart`와 `profiles samples show sample_mcp_stdio_local`은 stdio가 HTTP OAuth discovery 없이 동작함을 명시한다. 따라서 OAuth 추가가 필수라고 확정하지 않는다. 먼저 private Tunnel + 격리 합성 fixture로 native Events를 확인하고 기존 scoped grant 전달기의 재사용/권한 경계를 검증한다. 아래 확대안은 그 경로로 계정·workspace 접근 범위와 actor 권한을 증명할 수 없을 때만 승인 요청할 후보이다.

## 1. D0에서 확인한 변경 이유

사용자는 실제 계정에서 custom MCP의 **Tunnel 선택 가능**을 답변하고 Tunnel·OAuth 입력 화면을 제공했다. 이는 계정의 Tunnel 메뉴 존재에 대한 사용자/화면 증거이며, 터널 실행·권한 검증·native dot 응답 성공은 아니다. 화면의 OAuth는 선택된 값이다. 화면 하나만으로 다른 인증 선택지가 전혀 없다고 단정하지 않는다.

[공식 custom MCP 연결 문서](https://developers.openai.com/api/docs/guides/custom-mcp-server)는 OAuth·무인증·OAuth 또는 무인증을 안내한다. [공식 인증 문서](https://developers.openai.com/plugins/build/auth)는 ChatGPT가 임의 API key를 제시하지 못한다는 제약을 설명한다. 기본안에서 조건부로 검토한 고정 Bearer는 plugin 패키지 선언과 실제 ChatGPT Cloud 연결 지원이 다를 수 있으므로 그대로 사용할 수 있다고 계획하지 않는다.

현재 앱은 `src/http/mcp.ts::McpEndpoint.grant`에서 자체 고정 Bearer hash를 조회한다. 기존 `src/connections/oauth.ts`·`codex-oauth.ts`는 **외부 GPT 모델 계정에 로그인하는 OAuth**이며, ChatGPT가 **웹쫀쿠 도구에 접근할 권한을 받는 OAuth**가 아니다. 현재 `/mcp`에는 이 후자 연결을 위한 protected-resource metadata·외부 IdP token 검증·principal→grant 매핑이 없다. 일반 GPT/기기 코드 로그인을 재사용했다고 표시할 수 없다.

**OAuth가 필요하다고 확인될 때의 추천 변경:** private MCP/Tunnel은 유지하면서 검증된 OAuth IdP의 토큰을 기존 앱의 scoped grant에 매핑하는 최소 resource-server adapter를 추가한다. 권장 후보는 공식 문서에 안내된 Auth0이며, 이미 사용 가능한 OAuth IdP가 있다면 그 지원 계약을 먼저 대조한다. 인증 서버 자체·비밀번호 저장소·기존 GPT OAuth를 새로 만들지 않는다. IdP 계정/요금제·client 등록/PKCE 지원은 사용자 설정 전까지 UNVERIFIED다.

## 2. 범위·파일·변경량

기본안 위에 **추가 고유6~10파일·600~1,000줄**(검사/문서 포함)을 예상한다. 기본안과 합친 최대 범위는 **46~62파일·3,300~5,200줄**이다. 같은 runtime/model/http 접점의 반복 수정은 고유 파일 수에서 중복 계산하지 않는다. IdP의 외부 계정·정책 설정 작업은 줄 수로 계산하지 않았다.

| 변경 대상 | 최소 변경 / 유지 계약 |
| --- | --- |
| 제안 `src/http/mcp-auth.ts` | issuer/JWKS·signature·audience/resource·expiry·scope 검증과 401 challenge·protected-resource metadata. 기존 `jose` 의존성을 재사용하고 JWT/자체 IdP를 직접 구현하지 않음. |
| 기존 `src/http/workspace.ts`, `src/http/mcp.ts::grant/handle` | verified OAuth principal을 기존 내부 scoped grant로 변환하는 좁은 경계. 기존 고정 grant·stdio 도구는 계속 유효. owner 비밀번호·Host/Origin·noVNC 권한은 그대로. |
| 제안 `src/workspace/dot-auth.ts`, 기존 `model.ts/runtime.ts`의 D1 접점 | owner가 승인한 issuer+subject→dot connection/grant binding, 권한 회수/version fencing. 임의 이메일·이름·caller의 dotId로 매핑하지 않음. 토큰 서명 성공만으로 앱/모든 방 접근을 허용하지 않음. |
| 기존 `workspace/config.ts`, `.env.example`, dot 연결 UI/진단 접점 | issuer/resource/audience와 연결 준비/차단 상태. client secret은 package/문서/브라우저 상태에 넣지 않음. 실제 설정값을 기존 `.env`에 임의 적용하지 않음. |
| 제안 `tests/mcp-auth.test.mjs` 및 D0/D1 회귀 | 변조·다른 issuer/audience/subject·만료·scope 부족·회수·두 grant 격리·메타데이터/401와 기존 grant 호환. |
| 운영·연결·계획·구현 기록 | IdP 직접 로그인/등록·private Tunnel·resource/callback 확인·회수·복귀·증거. 외부 서비스 이용 가능/과금 조건은 실측 전 확정하지 않음. |

외부 IdP의 authorize/token/JWKS 경로와 client 등록은 IdP가 담당한다. 기본 선택은 사전 등록한 client + authorization-code/PKCE이며 실제 ChatGPT 설정 UI가 제시한 redirect URI를 대조한다. discovery·CIMD/DCR를 쓸 경우 양측 지원을 확인하며 자동 등록을 가정하지 않는다. [Tunnel 문서](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)의 OAuth 안내대로 authorization server를 Tunnel이 자동으로 공개/전달해 준다고 가정하지 않는다. 검증된 외부 IdP가 그 역할을 하며 앱의 웹/Chrome/DB를 공개하지 않는다.

## 3. 후속 단계 전체 영향

| 단계 | 영향 / 유지할 것 |
| --- | --- |
| D0 | private plugin의 실제 OAuth 연결과 read-only 도구를 먼저 검증해야 한다. Tunnel 메뉴 존재/로그인 화면만으로 수락하지 않음. 이벤트 전체 왕복까지 성공해야 D0 완료. |
| D1 / R1 | dot namespace에 선택적 auth binding·grant version 추가. 이전 DB는 empty/off, 기존 credential/ID 보존. GPT/Muse를 새 OAuth에 자동 전환하지 않음. |
| D2 / R4·R7 MCP | Events와 turn 도구가 같은 인증된 principal/scope를 사용. expired/revoked token 또는 회수된 grant의 구독·재생·응답 수락을 거절. |
| D3 / R2 | signed token이어도 해당 turn·epoch/generation·claim이 맞아야 완료 수락. complete/단일 dispatch·미확정 대조·기존 JSON 유지. |
| D4 / R3 | 별도 “dot 도구 연결” 상태/동의 안내가 추가된다. 기존 GPT 로그인·Muse browser UI는 유지. native 도구 승인 기억 여부는 실제 계정에서 검증. |
| D5 / R5~R8 | 작업 pickup/보고·Wiki CAS·Codex 승인/격리 권한을 auth token으로 자동 확대하지 않음. 기존50 gate·API 일일 한도·실계정/fixture 구별과 Muse 보존 회귀 유지. |

## 4. 수락·실행 증거와 복귀

1. `npm run check`와 제안 OAuth/metadata fixture: invalid issuer/audience/subject/expiry/scope·서명 변조·회수 등10종에서 허용되지 않은 조회/변경0. 토큰/서명 키/개인 subject의 공개 로그0.
2. 기존 고정 grant·owner 인증·GPT OAuth·Muse fixture 회귀 유지. 새 token을 owner 웹 로그인·임의 Codex 승인·다른 참여자 grant로 사용0.
3. 두 OAuth principal/두 방과 동일 principal/서로 다른 grant의 요청20회에서 범위 혼입0·미허용 turn 결과 적용0. 회수 뒤 구독 refresh·도구 호출·늦은 응답 적용0.
4. 실제 대상 dot에서 사용자 직접 IdP 로그인/동의→터널 read-only 도구1회→Events 구독/응답 왕복을 확인한다. RPC/ID·시각·성공/차단 상태만 가려 기록하고 token·subject·대화 원문은 공개 문서에 남기지 않는다. 현재 NOT_RUN이며 실환경 단계의 구체 횟수/허용은 실행 직전에 정한다.
5. `iss/sub`로 증명하는 것은 연결된 IdP principal이다. OpenAI가 검증된 native dot ID를 전달하지 않으면 owner 확인의 actor binding과 별개로 표시한다. 외부 dot의 다른 앱 권한까지 앱 grant가 제한했다고 주장하지 않는다.

복귀는 dot 신규 dispatch off→진행/미확정 대조→binding/grant·구독 회수→OAuth adapter 비활성 순서다. 원문·receipt·이관/정산·credential은 보존하고 기존 GPT/API/Muse·owner 비밀번호·MCP 고정 grant 경로로 복귀한다. 과거 DB로 덮어쓰거나 외부 IdP 설정을 자동 삭제하지 않는다.

## 5. 추가 승인과 사용자 결정

**추가 승인 요청 범위:** 위 resource-server adapter·principal/grant 매핑·metadata/401·설정/UI·검사/문서의 추가6~10파일·600~1,000줄. 기존 GPT 로그인·Muse 연결을 유지하며 공개 ingress/자체 OAuth 서버는 추가하지 않는다. 확대 승인 전에는 이 경계에 종속된 제품 코드를 작성하지 않는다.

**사용자 결정 필요:** 기존에 쓸 수 있는 IdP가 있는지, 없다면 Auth0 등 공식 계약에 맞는 IdP를 사용할지. 계정 생성·약관/요금제·client/API 등록·로그인/동의·Tunnel runtime key 입력은 사용자가 직접 한다. 원문 key·비밀번호를 채팅으로 요청하지 않는다. IdP의 비용·조직 정책 때문에 다른 구조가 필요하면 영향/규모를 재보고한다.

사용자가 Tunnel을 선택할 수 있다는 확인은 이 OAuth 확대의 승인으로 해석하지 않는다. 기본안의 D0 읽기 전용 점검과 계획 개정은 계속 진행한다.
