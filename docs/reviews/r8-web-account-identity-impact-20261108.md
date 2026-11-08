# R8 두 번째 웹 GPT — 아이콘형 프로필의 계정 확인 보완 검토

상태: **2026-11-08 사용자 승인 — 계획 개정·계정 확인 보완 개발/모의 검사.** 서버 적용·추가 실계정 호출은 제외한다. 승인 전 추가 제품 코드·계획 변경·호스트 설정은 수행하지 않았다. 원래 영향 검토 기준은 R8 검증기 `b894b95`이며, 이 보완은 제품 source가 동일한 main `084d5587d1b101f772369f837d857d374fef8a2b`에서 독립 분기했다. PR #62 병합 후 최신 main `fbd4a39`에 기록 충돌만 해소해 단일 커밋으로 정리하며, 미완료 R8 수락을 이 보완의 완료 조건으로 바꾸지 않는다.

## 1. 실제 관측과 중단 범위

사용자가 직접 로그인한 두 ChatGPT 창에서 서로 다른 계정임을 읽기 전용으로 대조했다. 사용자의 화면 지적 이후 서버의 두 번째 창에도 **Extra High**가 적용된 것을 확인했다. 앞선 Medium/사용 제한 해석을 Extra High 불가의 근거로 유지하지 않는다.

승인한 R8 준비 요청1회는 완료됐고 새 실제 웹 대화에 사용자 메시지1/답변1·빈 입력창·고정 thread URL이 있다. 그러나 현재 `chatgpt-v1` 탐지는 다음 이유로 `browser_discovery_unsupported_dom`을 반환했다.

- 새 개인 계정의 프로필 버튼은 화면에 보이지만 `textContent` 길이가0인 아이콘이다. 계정을 구분할 `alt`/`title`/data 속성도 관측되지 않았다.
- 기존 프리셋의 입력·준비 selector와 사용자/응답 selector는 각각 실제1개를 찾고 thread URL도 확인했다. 계정 식별 문구만 없었다.
- 숨겨진 사이드바 버튼은 크기가0이었고 이를 펼침의 증거로 세지 않는다. 실제 프로필 메뉴를 클릭하면 계정 이름이 있지만, 닫으면 해당 DOM은 제거된다. 메뉴가 계속 열려 있다고 가정해 연결하지 않는다.
- `src/connections/browser-discovery.ts:discoveryScript`는 보이는 고유 계정 문구가 있어야 지원됨으로 판정한다. `src/connections/browser.ts:BrowserBridge.inspect/sendScript`도 그 문구를 전송 전·수신 중 대조한다. 이 검사 자체가 잘못된 것은 아니며 무시/삭제하지 않는다.

운영 방은 켜지 않았고 API 호출0·Codex job0이다. 임시 service 설정 설치0, dot 권한/터널 재기동0, 기존 정상 service·DB·비밀번호·계정과 Muse 잠금을 유지했다. 처음 준비 답변을 재전송하지 않는다. 원래 검증 창은 이 준비 중단 기록으로 보존하며, 후속 추가 모델 호출은 새 실행 범위를 확인한 뒤 진행한다.

## 2. 두 안과 권장안

| 안 | 판정 |
|---|---|
| 아이콘/대화 제목/공통 버튼을 계정 이름으로 간주 | 기각. 서로 다른 계정을 구분하는 근거가 없으며 기존 확인을 약화한다. |
| 계정 메뉴를 계속 열거나 이름을 DOM에 삽입 | 기각. 입력 중 메뉴가 닫히면 실패하며 삽입한 이름은 실제 로그인 증거가 아니다. |
| 실제 로그인 계정의 읽기 전용 식별 정보를 제한적으로 확인 | **권장 제안.** 기존 DOM 확인을 기본값으로 유지하고 계정 문구가 없는 ChatGPT 연결에만 추가한다. |

권장안은 기존 서버 Chrome 안에서 같은 origin의 계정 정보를 조회해 사용자 ID/이메일만 대조하는 작은 연결 보완이다. 현재 사이트에서 이 정보가 반환되는 것은 관측했다. **해당 웹 내부 경로의 공식 지원/장기 안정성은 UNVERIFIED**이며 새 공식 OAuth나 API 로그인이라고 부르지 않는다. 경로/형식이 바뀌거나 값이 없으면 연결/전송을 중단한다.

인증 token·cookie·비밀번호를 앱으로 가져오거나 저장/중계하지 않는다. 모델 요청은 계속 실제 ChatGPT 웹 입력/응답으로 수행한다. 일반 GPT OAuth/Responses·Codex 기기 코드로 대체하지 않는다.

## 3. 최소 변경과 계약

아래는 사용자 승인 당시의 최소 변경 계획이다. 확정한 심볼·유지/변경 계약과 검사 결과는 [구현 기록](../implementation/web-gpt-account-identity-20261108.md)을 따른다.

1. `BrowserBinding`에 ChatGPT 전용 optional 계정 식별 metadata를 추가한다. 기존 연결은 누락 상태로 기존 DOM 확인을 그대로 사용한다. 계정 ID/이메일·확인 출처를 private state에만 보존하며 credential은 저장하지 않는다. SQL migration/DB 교체/기존 연결 일괄 이관은 없다.
2. 기존 `BrowserDiscovery.discover/resolve`에서 아이콘 프로필만 있는 경우 같은 origin의 읽기 전용 계정 확인을 선택해, 기존 소유자 확인·profile/page/thread·빈 입력/준비 검사를 함께 사용한다. 계정이 조회/확인 사이 바뀌면 저장하지 않는다.
3. `BrowserBridge.complete`의 원래 전송 전 기록·receipt·미확정 절차를 유지한다. 계정 확인은 전송 직전/입력 뒤 실제 click 직전/응답 확정 전에 새로 수행한다. 중간 상태 조회마다 인증 endpoint를 반복 호출하는 설계는 피하고, URL/thread/DOM 관측은 기존대로 계속한다. 계정 불일치/조회 실패면 전송 전에는 미전송, 전송 뒤에는 미확정으로 보존한다. 확인되지 않은 응답을 현재 토의에 적용하지 않는다.
4. 같은 origin/고정 읽기 경로/timeout/redirect 거절을 코드로 고정하고 사용자나 모델이 임의 URL·인증 작업을 지정하지 못하게 한다. 응답에서 사용자 ID/이메일 이외의 필드를 직렬화하거나 로그에 남기지 않는다.

`Providers.complete`·Store transaction/event/idempotency·Codex·dot MCP·Muse·예산·Human 승인·원래 gate는 유지한다. 불가피한 backend 변경은 위 browser adapter의 계정 식별 출처 선택과 optional metadata뿐이다.

## 4. 파일·변경량·후속 영향

| 파일/심볼 | 제안 범위 |
|---|---|
| `src/workspace/model.ts:BrowserBinding` | optional 식별 metadata, legacy 기본값 유지 |
| `src/connections/browser-discovery.ts:discoveryScript/discoverBinding/resolve` | 새 출처의 실제 계정 확인·소유자 확인/불일치 거절 |
| `src/connections/browser.ts:validateBinding/BrowserBridge.inspect/complete/sendScript` | 전송/확정 때 계정 대조, 미확정 보존 |
| `src/connections/browser-account.ts` **제안** 또는 작은 기존 helper | 고정 읽기 경로·최소 식별 결과·token 배제 |
| `src/connections/browser-presets/chatgpt-v1.json` | 필요한 경우 preset version만 갱신, Muse 프리셋 유지 |
| 기존 browser/discovery Node·Chromium 검사 | 아이콘 UI·다른 계정·형식 변경/timeout·전송 전후 변경과 token 비노출 |
| 계획 SSOT·운영/실측 문서 | 승인/선택 출처·실제 수락·롤백을 연결 |

**추가 예상8~12파일·300~600줄.** 이미 완료한 R8 검증기9파일/추가974·삭제33줄과 구분한다. 새 GUI 재작성·provider·OAuth/키·호스트 정책·포트·추가 서비스는 없다. 기존에 승인한 임시 service 설정1개의 범위는 늘리지 않는다.

R4 연결 UX와 R8 실제 두 웹 계정 수락만 보완한다. R6 보호/명령/원본 반영, R5/R7 큐·Wiki, native dot/D3~D5와 Muse 대화는 변경하지 않는다. 이후 UI가 아이콘만 표시해도 같은 계정 확인 출처를 재사용하되, 내부 웹 계약의 변화는 실패로 드러내고 우회하지 않는다.

## 5. 수락·복귀

- 실제 Chromium의 아이콘-only fixture에서 일반 연결 저장1회, 실제 입력/응답 receipt1회를 확인한다. fake endpoint는 최소 사용자 metadata와 token sentinel을 반환하며 저장/출력/로그에 sentinel0을 검사한다.
- 저장 직전 계정 변경 → 연결0, click 직전 변경 → 전송0, 전송 후/확정 전 변경 → 현재 토의 적용0·원래 receipt/미확정 보존을 명령/화면/로그로 확인한다.
- 조회 실패·다른 origin·redirect·필수 식별 누락·timeout을 거절하고, legacy DOM 연결과 기존 Muse·브라우저 receipt/중복 전송 검사가 통과해야 한다.
- 실환경에서는 이미 완료한 준비 대화를 재사용해 읽기 전용 계정 확인/저장을 먼저 검증한다. 실계정 메시지와 서버 적용은 PR 검사·사용자 병합 후 새 구체 실행 창을 확인한다. 이전 준비1회·API0·Codex0을 별도 보존하고 요청 수를 새로 채우지 않는다.
- 회귀 시 새 출처 연결을 unverified/참여 꺼짐으로 돌리고 원래 DB/대화를 보존한다. 식별 정보 없는 아이콘을 허용하거나 account 검사를 제거하지 않는다. 기존 DOM 방식의 Business/Muse는 그대로 사용할 수 있다.

사용자가 이 추가 browser 계정 확인 보완의 계획 개정·개발/모의 검사를 승인했다. 추가 실계정 호출/배포는 이번 개발 승인에 포함하지 않는다. 현 범위의 미결정 항목은 없으며 추가 범위가 필요하면 영향과 변경량부터 다시 보고한다.
