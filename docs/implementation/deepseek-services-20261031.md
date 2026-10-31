# DeepSeek 제공처 추가 — 2026-10-31

기준: main `8f7866388823e46ade64446343d53351c7ef85e5`. 사용자가 요청한 CoralBricks·River를 기존 DeepSeek 어댑터에 결합했다. 운영 서비스·DB·기존 인증 정보는 변경하지 않았다. 실제 키 등록·모델 호출·비용 발생 검증은 **NOT_RUN**이다.

## 계약과 변경 범위

`Providers.complete`, stream 완료/receipt/usage, vault, Store transaction, 기존 `/api/connections/deepseek`와 `kind: deepseek`를 유지한다. `Connection.apiService`만 선택 필드로 추가하며 누락된 기존 데이터는 공식 API로 해석한다. DB 재초기화나 SQL 마이그레이션은 없다. `deepseek-services.ts`는 새 고정 주소 레지스트리다. 임의 URL·prototype 이름은 전송 전에 거절하며 리다이렉트에 키를 전달하지 않는다.

| 제공처 | 모델/대화 base URL | 근거 |
|---|---|---|
| DeepSeek 공식 | `https://api.deepseek.com` | 기존 구현 유지 |
| CoralBricks | `https://inference.coralbricks.ai/v1` | [공식 문서](https://www.coralbricks.ai/docs) |
| River | `https://api.river.ai/v1` | [Inference](https://docs.river.ai/guides/inference/), [Models](https://docs.river.ai/guides/models/) |

CoralBricks·River는 인증된 `/models` 응답에서 DeepSeek ID만 사용한다. 문서의 예시 ID를 하드코딩하지 않는다. 각각 연결 ID·vault 키·모델 목록을 분리한다. 이 추가는 추론 강도 변환이나 가격 추정을 포함하지 않으며 GPT의 기존 Extra high 설정은 그대로다. R8의 실계정 수락 기준도 유지한다.

## 검사 증거

- PASS: `npm run check` — strict TypeScript·빌드·Node 226개, FAIL/SKIP 0.
- PASS: `tests/deepseek-services.test.mjs` — 공식/CoralBricks/River의 정확한 주소·키·대화 이력·완료·receipt·보고 usage, 잘못된 제공처의 전송 0, 빈 모델 목록의 대체 0.
- PASS: `tests/browser/deepseek-services.test.mjs` — 실제 Chromium에서 제공처 2개 등록, 서로 다른 키/ID/목록, 입력 키 삭제, snapshot 노출 0, 390px 가로 넘침 0. 외부 API는 모의 응답이다.
- PASS: `WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp npm run test:browser` — Chromium 156.0.8078.47, 브라우저 37개, FAIL/SKIP 0. 실제 Chrome MCP fixture도 포함하며 실계정 추론은 아니다.
- NOT_RUN: 실제 제공처 키·모델 권한·실제 stream/usage/추론 결과. UI에 키를 등록한 뒤 별도 허가된 실계정 수락에서 확인한다.

## 복귀

서비스 중단 후 기존 빌드로 복귀할 때 새 제공처 연결을 기존 DeepSeek endpoint로 실행하지 않는다. 새 연결은 보존하되 비활성화하고 공식 API 연결만 사용한다. 새 코드에서는 기존 공식 연결의 필드 부재를 지원하므로 DB나 vault를 지울 필요가 없다.
