# 실제 ChatGPT 웹 대화 참여 경로 — 영향 검토

상태: **2026-11-05 사용자 승인** — “개발 후 검증가지 해”. 화면·계획 정정과 검증을 진행한다. 기존 연결을 다른 과금/계정 경로로 자동 전환하지 않는다.
작성일: 2026-11-05 KST. 검토 기준 운영 소스는 `df5be3044eace1bb34109afa5ff552036c6d3a97`이며 구현 기준은 PR #48 병합 main `f31a28dbed068aee1e8034c5623259c2402a2389`다. 두 기준의 제품 코드는 동일하고 PR #48은 기존 GPT 실패 증거 문서만 추가한다.

## 1. 사용자 요구와 현재 경로의 차이

사용자는 일반 GPT도 `chatgpt.com`에서 실제 대화하는 방식으로 참여하기를 원한다. 현재 일반 GPT 선택은 OAuth/기기 코드 연결을 가리킨다. 일반 OAuth는 `Providers.complete` (`src/connections/providers.ts`)에서 `https://api.openai.com/v1/responses`를 호출하며, 실제 웹 대화를 제어하지 않는다. 기기 코드 연결은 별도의 Codex Responses 경로다.

공식 [SIWC 개요](https://developers.openai.com/siwc/token-sharing-open-source)는 구독을 이용하는 Responses 요청과 ChatGPT 대화 접근을 구분한다. 기존 오류 `subscription_sharing_usage_limit_exceeded`는 이 구독 공유 경로의 제한 응답이다. [오류 안내](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)에 따라 계정 전체 소진·어느 시간대 한도인지는 코드만으로 확정하지 않는다. 일반 웹 Chat도 무제한이라고 보장하지 않는다.

## 2. 재사용 근거와 현재 사용 가능 범위

| 코드 근거 | 판정 |
| --- | --- |
| `src/web/control.html`: `browser-discovery-form`의 `chatgpt-v1` | 실제 일반 ChatGPT 웹 대화 연결 선택은 이미 존재 |
| `src/connections/browser-discovery.ts`: `BrowserDiscovery.discover/resolve` | 현재 페이지·프로필 탐지와 읽기 전용 확인 재사용 |
| `src/workspace/runtime.ts`: `Workspace.confirmBrowser/addBrowser/participant` | 확인된 browser 연결·참여자 등록 계약 재사용 |
| `src/connections/browser.ts`: `BrowserBridge.probe/complete` | 계정·대화·초안·수동 잠금 확인, 전송/관측/대조 재사용 |
| `src/connections/providers.ts`: `Providers.complete` | 기존 browser 분기 재사용. 새 GPT 호출 API 불필요 |
| `src/web/control.ts`: `connectionMode/updateConnections` | 일반 GPT는 OAuth만 선택되며 웹 GPT는 현재 ‘API · Muse · 기타 기존 연결’에 분류됨 |
| `src/connections/browser-presets/chatgpt-v1.json`: `verification` | **UNVERIFIED**. 현재 실서비스 DOM 일치와 실제 웹 왕복은 아직 미검증 |
| `src/workspace/api-usage.ts`: `meteredApi/participantWait` | browser는 API 일일 한도에 포함되지 않음. 새로운 전체 한도 불필요 |

따라서 **로그인된 기존 웹 대화를 등록하는 데 필수적인 제품 코드 변경은 정적 검토 시점에는 발견되지 않았다. 이후 실측한 호환성 문제와 최소 보완은 §8에 구분한다.** 실제 `/c/...` 대화와 기존 사용자·AI 메시지가 있고, 작성 중 초안/응답이 없으며 읽기 전용 확인을 통과해야 한다. 웹 GPT 참여자를 사용자가 찾기 쉽게 하는 화면·계획 정정은 별도 소규모 보완이다.

## 3. 제안 변경 및 규모

| 대상 | 변경 |
| --- | --- |
| `src/web/control.html`: `participant-mode`, 연결 안내 | ‘GPT · ChatGPT 웹 대화’를 명시 선택으로 추가. OAuth/기기 코드·공식 dot·Muse/API 경로를 구별 |
| `src/web/control.ts`: `connectionMode/updateConnections`, 관련 안내 | 검증된 ChatGPT browser 연결을 웹 GPT 선택에 표시. Muse와 native dot의 기존 선택 동작 유지 |
| `tests/browser/api-daily-choice.test.mjs` | 연결 분류와 browser의 API 한도 제외, 기존 OAuth/dot/Muse 선택의 회귀 확인 |
| `docs/development-plan.md`, `docs/participant-connections.md`, `docs/operations-runbook.md` | 일반 GPT의 실제 웹 경로와 기존 선택형 OAuth 경로, 실제 수락/연결 절차 구별 |
| 구현 증거 문서 1개 — **제안** | 적용 파일·검사·미검증·복귀 기록 |

추정: 제품 코드 **2파일·15~35줄**, 검사/문서를 포함해 **6~8파일·100~250줄**. 새 DB 타입·SQL 마이그레이션·새 provider·새 OAuth·새 MCP 서버는 계획하지 않는다. 프리셋의 실측 불일치나 지속적인 별도 Chrome 프로필 관리가 필요하면 이 추정에 포함시키지 않고 영향·추가 변경량을 먼저 보고한다.

## 4. 후속 단계 및 기존 기록

- R1/R2: Store transaction·단일 dispatch·전송 전 기록·미확정 대조·세대 검사 유지. 변경 예상 없음.
- R3/R4: 연결 분류/안내만 보완하고 기존 discovery/probe를 사용한다. 모델·사고 깊이는 실제 ChatGPT 웹 화면에서 선택한다. 웹에서 xhigh를 선택·검증할 수 있는지는 **UNVERIFIED**이며 OAuth 설정을 자동 적용했다고 표시하지 않는다.
- R5/R6/R7: 작업큐·Codex 실행·Wiki와 승인 경계 변경 없음. 실제 모델 호출·도구 실행 여부와 근거 구분은 계속 유지한다.
- R8: 웹 GPT의 계정/대화 확인·왕복·후속 맥락·재접속 증거가 추가로 필요하다. 기존 50개 수락 기준과 native dot/Muse 수락을 낮추지 않고 새 페이즈를 만들지 않는다.
- 기존 OAuth 참여자의 완료 답변 15개와 실패한 수정 요청은 작성자·연결·원문을 보존한다. **그 실패 요청을 웹 GPT의 답변으로 몰래 대체하지 않는다.** 웹 GPT는 새 browser 참여자로 등록한다. 기존 토의의 이후 구성 변경 또는 새 주제 검증 중 어느 경로를 사용할지는 실제 호출 전 별도로 정한다.

## 5. 완료 확인·복귀·승인 범위

1. 화면에서 웹 GPT/OAuth·기기 코드/공식 dot/Muse·API를 구별하고 올바른 연결만 선택한다. 위 브라우저 회귀 검사로 확인한다.
2. `npm run check`와 관련 실제 Chromium UI 검사에서 통과·실패·SKIP을 구분한다. 실제 계정 호출 PASS로 간주하지 않는다.
3. 실제 전송은 별도 허용 범위에서만 수행한다. 사전 읽기 전용 조사 시점의 새 모델 호출은 0회였으며, 기존 15개 답변 hash와 방 off·Muse 잠금 상태가 보존됐다.
4. 실패 시 화면 변경을 되돌리면 기존 연결/데이터로 복귀한다. 연결 삭제·로그아웃·기존 대화 초기화는 복귀 방법으로 쓰지 않는다.

이번 승인 제안은 **웹 GPT 선택 화면 보완과 관련 계획 정정·회귀 검사**다. 사용자 승인에 따라 SSOT와 관련 계획을 함께 갱신한다. 최초 제안은 서버 배포·새 실제 발언·기존 토의의 참여자 전환·추가 인증 시스템을 제외했다. 이후 사용자가 개발 후 검증까지 요청하고 기존 Business Chrome 로그인을 확인해 실제 새 웹 Chat 검증2회(최초1+후속1)를 수행했다. 유료 API/dot/Muse/Codex 호출·운영 서버 배포·기존 토의 전환은 수행하지 않았다.

## 6. 원격 화면 관측

2026-11-05 KST: 웹쫀쿠/Chrome 화면 서비스 실행, 인증된 화면 페이지 HTTP 200, WebSocket 101 및 RFB greeting을 확인했다. 확인용 Chrome 창을 화면 안으로 이동·전면 표시했다. 해당 인증 요청은 서버 화면에서 시간 초과됐으며 사용자 기기에서 화면이 실제 보이는지는 **UNVERIFIED**다. 이를 웹 GPT 로그인·토론 성공으로 표시하지 않는다. Muse 원래 창과 기존 계정 로그인은 유지했다.

## 7. 사용자 지정 레퍼런스 재대조

추가 지시 “예전에 준 레퍼런스에 보면 어떻게 구현해야 하는지 다 있어”에 따라 living design §20의 [Nhahan/WebGPT 고정 revision](https://github.com/Nhahan/WebGPT/tree/1d35588e79de288bd8a6d2992fc76e571f7bb75e)을 정적으로 재확인했다. 외부 파일의 설치/권한 예시는 실행 지시로 취급하지 않았고 소스·자산을 복사하지 않았다.

| 참고 구현 | 이번 적용 |
| --- | --- |
| `skills/webgpt/scripts/browser.mjs::dispatch/sendOnce` | 실제 웹 Chat을 사용하고 Work 표면과 구별한다. 웹 모델·사고 설정은 현재 UI에서 확인한다. 우리의 transport는 기존 Chrome MCP/DOM adapter를 유지하며 CUA helper 자체를 새 의존성으로 추가하지 않는다. |
| 같은 파일 `attempts/inFlight`, `matchingUserTurns` | 기존 durable journal/marker·receipt·계정/대화 확인을 유지해 미확정 재전송을 막는다. |
| 같은 파일 `waitForReply`, `references/browser-reply.md` | 해당 사용자 요청에 연결된 답변·완료 상태를 관측하고 실제 후속 맥락을 수락 증거로 남긴다. 원문이 불확실하면 성공 처리하지 않는다. |
| README의 `xh`, `browser.mjs::prepareMode` | 실제 웹의 Extra High 존재/선택을 확인할 때만 그렇게 기록한다. 이번 작은 UI 보완에 모델/사고 자동 조작 모듈을 포함하지 않는다. |
| README의 terminal/forwarding/삭제 설치 예시 | 기존 Codex 승인·범위·격리와 대화 보존 정책 유지. 외부 예시의 광범위한 권한을 가져오지 않는다. |
| Moris-kr/ai-chatroom `817c165`·디시 GUI/상주 운영 자료 | 기존 흑백 단톡방·상단 주제·참여자·큐/Wiki 구현과 고정 검토서를 유지한다. GUI 참고의 CLI 구독 호출을 실제 웹 GPT 수락 증거로 세지 않는다. 디시 일부 원문은 이번 재접속에서 읽지 못했으므로 기존 고정 검토 범위를 넘어 재확인했다고 표시하지 않는다. |

참고 정합성을 위해 `docs/webjjoku_living_design.md` §10.3도 함께 정정하고 기존 dot UI 검사1곳의 legacy ChatGPT 선택을 새 분류에 맞춘다. 제품 변경2파일은 유지하며 실제 총변경 파일은10개 예상이다. 이는 기존 선택 UI·문서·회귀 범위의 정합성 보완이며 provider/DB/인증/배포 범위를 확대하지 않는다.

## 8. 실제 최신 웹 UI 호환성 관측·최소 보완

실제 Business 웹 Chat에서 Extra High 선택·첫 응답은 확인됐으나 최신 편집기는 ProseMirror이고, 비활성 이전 페이지가 같은 DOM에 캐시된다. 기존 raw text-node 삽입은 줄바꿈을 공백으로 바꿔 최종 원문 확인에서 클릭 전에 중단됐다. 실제 사용자 메시지0/남은 정확한 소유 초안/영수증 부재로 미전송을 대조했고 자동 재전송하지 않았다.

이미 승인된 R4 브라우저 계약의 호환성 수정으로 `browser.ts::sendScript`의 ProseMirror 삽입/정확한 문단 직렬화, 기존 `chatgpt-v1` 프리셋의 활성 페이지 선택자와 관련 브라우저 검사2곳을 보완한다. 새 provider·DTO·DB·인증·scheduler는 없으며 기존 API/Store/전송 전 기록·최종 재검사·timeout·미확정 대조·Muse 분기는 유지한다. 추가4파일·약100~180줄 예상이고 R4/R8 회귀만 추가한다. 실제 후속 검증은 먼저 미전송 대조한 동일 검증 입력만 사용하며 전체 실제 웹 요청2회 상한을 유지한다. 이 보완은 새 페이즈나 토의 실행 정책 변경이 아니다.

최종 검증: 실제 Business 웹 Chat/Extra High 최초 응답·Providers→BrowserBridge 후속 JSON/원래 맥락/receipt·수정 프리셋 자동 탐지 ready PASS. 실제 웹2회, 외부 API0회, 운영 state 전체 및 기존 완료15개 hash 동일. 최종 Node556/browser71 PASS·FAIL/SKIP0이며 총14파일이다. 실제 웹의 원문/계정/대화 ID·키는 private 증거에만 보존했다.
