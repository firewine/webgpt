# 연결 삭제·모델 조회 진단 — 2026-10-31

기준 main `2ff6545b0eda83370bc009db556d5297c6bb7522`(PR #25 병합). 사용자가 연결 카드 삭제와 CoralBricks 모델 조회 오류 수정을 직접 요청했다. 기존 backend를 사용한 연결 관리 보완이며 R1~R8의 순서와 50개 수락 문구는 변경하지 않는다. 운영 연결을 임의 삭제하거나 서비스에 배포하지 않았다.

## 실환경 원인과 확인 범위

등록된 CoralBricks 키로 공식 `GET https://inference.coralbricks.ai/v1/models`만 조회했다. HTTP **403**, `permission_denied`였고 제공처가 계정 검증을 위한 결제수단 등록을 요구했다. 키와 원문 오류·이메일·개인 대화는 이 기록에 보관하지 않는다. 기존 `Providers.models`는 401 외 실패를 모두 `model_discovery_failed`로 표시해 이 원인을 숨겼다.

사용자가 공식 billing 페이지에서 검증을 완료한 뒤 성공했다고 보고했다. 이후 운영 앱의 인증된 상태 조회에서 **connected**, 오류 없음, 공개 모델 `deepseek-v4.1-flash-fast`와 `deepseek-v4.1-flash` 두 개를 확인했다. 이는 **모델 목록 관측 PASS**이며 실제 추론·완료 stream/usage 검증은 **NOT_RUN**이다. 결제수단 정보 입력은 사용자가 공식 사이트에서 직접 수행했다.

근거: [CoralBricks API 문서](https://www.coralbricks.ai/docs)의 인증된 모델 목록. 공개 catalog로 대체하거나 하드코딩한 모델을 추가해 권한 오류를 우회하지 않는다.

## 계약·최소 변경

| 경계 | 유지/변경과 근거 |
|---|---|
| `Providers.complete`, 토론/상주/큐/Wiki/Codex | 인터페이스·한 번 전송·단일 dispatch·승인·예산·미확정 대조 유지. 새 모델 호출 경로 없음 |
| `model-catalog-error.ts` | 작은 오류 변환 함수/`AppError` 하위 타입 추가. 외부 원문은 16KiB까지만 해석하고 HTTP 상태·허용된 provider code·앱 분류만 반환. 링크는 고정된 공식 주소 |
| `Workspace.refreshModels` | 실패 시 `Connection.modelError?`에 HTTP/code와 확인 시각 기록. 성공 시 이전 진단 제거. 삭제 후 도착한 결과는 거절 |
| `Workspace.removeConnection` | owner 전용 `POST /api/connections/:id/remove`, 빈 body와 기존 idempotency 명령 사용. 실행·미확정 turn, 켜진 방의 멤버, 진행/일시정지/차단된 토의가 사용 중이면 거절 |
| `Store.transact` | 연결 제거·ID만 담은 `connectionCleanup?`·`connection.removed`·중복 명령 결과를 한 transaction에 저장. Store 자체·SQL schema 변경 없음 |
| `Workspace.cleanupConnection` | commit 뒤 vault 파일 정리. 중단되면 다음 기동 시 auth/dispatch 초기화 전에 같은 ID만 정리. 외부 요청 없이 복구하며 다른 계정/Chrome profile은 건드리지 않음 |
| `OAuthService` / `CodexOAuth` | 선택 연결의 pending 요청을 폐기. 서명 검증/refresh 도중 삭제됐으면 늦은 토큰 저장 거절. 기존 검증·refresh 직렬화 유지 |
| `control.ts` | 모든 연결 카드에 `연결 삭제` → 대상/보존 범위 확인 → `삭제`. 기존 토커·토론 원문은 보존하고 삭제된 연결임을 표시. 기존 SSE cursor로 다른 탭에도 반영 |

이는 **이 서버의 연결/인증 정보 삭제**다. 외부 OAuth grant 원격 폐기나 외부 계정/원래 Chrome 대화 삭제를 주장하지 않는다. 진행 중인 방을 임의로 끄거나 미확정 결과를 건너뛰지 않는다. 기존 `로그아웃`은 별도 동작으로 유지한다.

## 검증

- PASS: `npm run check` — strict TypeScript·빌드·전체 Node **287**, FAIL/SKIP 0.
- PASS: `tests/connection-removal.test.mjs` **9** — owner/Origin, 같은 명령20회→제거 이벤트1, 다른 키 보존, 실제 엔진 fixture 완료 후 모든 turn/context 보존, 켜진 방/미확정 응답 거절, 모델 결과·일반 OAuth callback/refresh·기기 코드 승인/refresh의 늦은 저장 차단.
- PASS: 위 검사에서 실제 자식 프로세스 **SIGKILL 2점**(commit 전/직후). 미커밋 제거는 원상태, 커밋된 제거는 기동 시 선택한 credential만 정리하며 participant 원문/다른 계정 보존. 실제 계정은 사용하지 않는다.
- PASS: `tests/model-catalog-errors.test.mjs` **8** — 실제 관측한 403 형태, 401/403/404/429/503 분류, 과대/잘못된 JSON 제한·원문/키 노출0, 계정·키 유지 후 같은 연결의 모델 목록 복구.
- PASS: `WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp node --test --test-reporter=spec tests/browser/*.test.mjs` — 실제 Chromium **156.0.8078.47**, Chrome MCP **1.12.0**, 전체 브라우저 **48**, FAIL/SKIP 0.
- PASS: 새 브라우저 사례2개 — 403 이유·고정 공식 링크·같은 키 복구, 삭제 확인/닫기·실행·두 탭 반영·원문 토커 보존·390px 가로 넘침0. 외부 API는 fixture이며 유료 호출 아님.
- NOT_RUN: 새 삭제 UI의 실운영 배포, 운영 연결의 실제 삭제, 실제 모델 추론. 사용자가 삭제할 카드를 선택하도록 남긴다.

## 복귀와 후속 영향

선택 필드 부재를 허용하므로 기존 DB 재초기화·SQL 이관은 없다. 신버전 정상 기동과 삭제 요청 성공으로 pending credential 정리를 확인한 뒤 서비스 중단·이전 빌드 복귀가 가능하다. 복귀로 삭제한 인증 정보를 되살리지 않는다. 재연결이 필요하면 사용자가 새 연결로 인증하며 기존 대화·토커 ID/결과를 바꾸지 않는다. pending 정리를 건너뛰려고 queue/state/vault를 직접 지우지 않는다.

R2/R3는 제거된 연결이 다시 발언하지 않는 상태와 카드 반영, R4는 대상 연결/원래 Chrome 대화 보존, R5~R7는 기존 participant 참조와 원문/큐/Wiki를 유지한다. R6 실행기·승인 범위 변경은 없으며 R8 기존 50 gate는 유지한다. 별도 요청된 DeepSeek 사고 설정·Anthropic 연결은 별도 영향 보고/승인 범위로 다룬다.
