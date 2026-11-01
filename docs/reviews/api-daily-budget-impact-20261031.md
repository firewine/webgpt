# 상주방 API 일일 한도·GPT/dot 선택 — 승인됨

2026-11-01 사용자가 **“변경안대로 개발 승인”**으로 아래 합산26~36파일·1,400~2,400줄 범위를 허용했다. API 일일24회/보고20만 token 정책과 일반 GPT/dot 선택 UI의 계획·구현·fixture/UI·PR을 진행한다. 배포·방 켜기·실제 모델/기존 dot·Muse 대화 전송은 이 승인에 포함하지 않는다. 아래 10월31일 관측은 승인 전 검토 이력이다. 현재 범위는 이 승인과 SSOT를 따르며 구현/검사 결과는 [개발 기록](../implementation/api-daily-gpt-choice-20261101.md)에 구분한다.

2026-10-31 사용자는 “상주 챗방은 api 애들만 하루 사용량 정하고 gpt나 dot 하고 muse는 그런거 없이 가능하도록” 요청했다. 아래는 기존 계획의 공통 방 예산 계약을 바꾸기 전의 영향 보고다. **당시에는 계획 본문·제품 src·운영 예산 정책을 변경하지 않았다.** 사용자가 요구한 정책과 실제 배포/호출 허용은 구분한다. PR #30 head `f47e27c`의 소스는 병합 main `2f3ca34`와 같으며 검토 기준은 그 코드다.

2026-11-01 추가 요청: 사용자가 현재 열린 대화는 일반 GPT라고 확인했고, dot이 가능한 계정에서는 dot을 쓰거나 직접 고를 수 있게 해 달라고 했다. 아래 **일반 GPT / dot 선택 UI**를 함께 검토한다. 현재 일반 GPT를 dot으로 등록/전송하지 않았으며 원래 Muse binding도 유지했다. 이 추가분은 위 11월1일 승인으로 계획/제품 구현 범위에 포함됐다.

## 현재 발언이 없는 실제 원인

읽기 전용 관측 시 방은 desiredOn=false/observedStatus=off이며 종료 시각2026-10-31 20:07:03 KST가 지났다. GPT2개와 DeepSeek High의 참여는 켜져 있지만 resident turn/ledger는0이다. 사용자 메시지2개는 저장됐다. 활성 root/job·미확정 lease는0이므로 전송 중 대기가 아니다.

사용자가 추가로 browser 참여를 켰으나 Chrome 수동 잠금이 유지돼 있다. 저장된 browser binding은 Muse origin/thread인데 같은 page ID의 현재 페이지는 ChatGPT다. 실제 읽기 전용 probe에서 URL·identity·thread·selector가 일치하지 않았다. **잘못된 대상의 draft=false를 원래 dot 대화가 비었다는 증거로 쓰지 않는다.** 기존 Muse binding을 ChatGPT dot으로 덮어쓰거나 수동 잠금을 해제·전송하지 않았다. dot과 Muse는 각각 실제 기존 대화를 확인해 구분해야 한다.

## 승인된 최종 동작

| 대상 | 앱의 사용량 제한 |
| --- | --- |
| API key 연결: DeepSeek 공식/CoralBricks/River, Anthropic API | 작업실 전체의 **API 합산 일일 한도**. 초기 설정 화면 값은 **하루24회·보고 token200,000**, Asia/Seoul 자정 기준. 소유자가 저장하기 전 운영 정책을 만들거나 방을 켜지 않음 |
| 일반 GPT OAuth·Codex 기기 코드 GPT OAuth | 위 API 일일 한도에서 제외. 상주방의 채팅 요청 수/token/종료 시각으로 막지 않음. usage와 발언/receipt 기록은 계속 보존 |
| browser dot·Muse | 같은 앱 사용량 한도 제외. 기존 agent/thread·초안·busy·수동 잠금·계정 확인은 유지. 대상/권한이 맞아야 발언 |
| 모의 참여자 | 실제 유료 API 사용으로 집계하지 않음. fixture 상태는 계속 구분 |
| Codex job·파일 수정·외부 도구 | 대화용 한도 제외와 별개. 기존 실행 승인·도구 한도·실행 deadline·격리·scope 유지 |

API 한도가 소진되거나 설정되지 않았으면 **해당 API 후보를 대기**시키고 GPT/browser의 새 자유 발언·허용된 분석 업무는 계속한다. 속도30초·idle300초·pass120초·3연속 pass 휴면과 방 on/off는 그대로다. “사용량 한도 없음”을 서비스 자체의 권한/응답 제한 무시, 동시 실행, 무한 재전송 또는 무한 빠른 loop로 구현하지 않는다. 기술적인 단일 응답 timeout·context/response 크기·세대/원문 보호는 유지한다.

API 횟수는 실제 dispatch를 기준으로 제한한다. token은 제공처가 보고한 input+output을 합산하는 **soft limit**이며 한 요청에서 초과할 수 있다. 미보고는 unknown으로 보존하고 0원/정확한 잔여 token·비용으로 바꾸지 않는다. 초기 일일 요청24회 제안은 token이 미보고여도 API 요청 수가 무제한이 되지 않도록 한다. 가격표/금액 추정·금융 계산은 추가하지 않는다.

## 코드 근거와 최소 변경

| 실제 코드·심볼 | 현재 계약·제안하는 접점 |
| --- | --- |
| `src/workspace/dispatch.ts::budgetReason/DispatchCoordinator.reserve/perform/settle` | 공통 room deadline/count/token을 모든 provider에 적용. 전송 전 claim과 같은 transaction에서 API 일일 예약/집계만 결합하고 새 모드의 비API 발언은 채팅 예산 검사에서 제외 |
| `src/workspace/resident-runner.ts::arm/evaluate` | 공통 deadline·전체 room 차단과 browser 수동 잠금이 다음 후보를 막음. 새 모드에서 한도 소진 API·수동 잠금 browser를 전송 없이 건너뛰고 나머지 eligible 후보 선택. 미확정 전송은 기존 전역 lease로 계속 차단 |
| `src/workspace/resident-store.ts::migrateResident/control`, `src/workspace/resident-model.ts::Room/BudgetEntry` | legacy 이관은 그대로. 선택 budgetMode/정산 참조를 additive로 추가하고 사용자 선택한 방만 새 모드로 전환. pacing과 도구 권한은 별도로 검증 |
| `src/workspace/model.ts::WorkspaceState/Discussion`, `src/workspace/api-usage.ts` (승인 당시 신규 제안) | 선택 일일 정책·day별 원장·정책 version, 작은 분류/집계/자정 함수. DB·Providers 재작성 없이 기존 Store transaction 사용 |
| `src/workspace/engine.ts::create/control/loop/turn`, `src/workspace/resident-focus.ts::capture/pump/topicPolicy` | 방의 새 모드를 child topic snapshot으로 고정. GPT를 기존 방의 공통 시간/횟수/token으로 막지 않되 초안 장벽·검토 라운드·단일 root 유지. 기존 단독 legacy 토의/완료 이력은 소급 변경하지 않음 |
| `src/workspace/work-queue.ts::claimState/claimAvailable/prepareTurn`, `src/workspace/work-policy.ts`, `src/workspace/work-execution.ts` | 분석 후보와 실행 도구의 예산/시간 검사를 구분. API 대기 시 아직 전송하지 않은 일감만 다른 허용 작업자가 claim 가능. 전송이 미확정인 attempt를 다른 계정으로 재전송하지 않음 |
| `src/workspace/runtime.ts`, `src/http/workspace.ts` | 기존 owner·Origin·command/CAS로 일일 정책 저장/조회. 모델/MCP grant가 정책·사용량 원장을 바꿀 권한은 주지 않음 |
| `src/workspace/resident-status.ts`, `src/workspace/resident-prompts.ts`, `src/workspace/capabilities.ts`, `scripts/readiness.mjs` | 참여자별 대기 이유/가용성·추적 시작/unknown을 투영. 저장 metadata를 실제 응답 성공으로 표시하지 않음 |
| `src/web/control.html`, `src/web/control.ts`, `src/web/room-view.ts` | 기존 owner 설정·SSE에 API 일일 한도/종류별 사용량/리셋 시각 표시. GPT/browser에는 공통 종료 시각·사용량 제한을 요구하지 않음. 초기 “방 off”·수동 잠금·잘못된 대상의 이유를 명확히 표시 |

일일 한도만의 기존 예상은 **24~32파일·1,100~1,900줄**이다. 11월1일의 선택 UI는 약4~7파일·300~500줄이며 공통 control/room UI·문서 접점이 겹치므로 **합산26~36파일·1,400~2,400줄**로 보정한다. 정적 접점 기준 추정이며 전체 엔진·인증·DB 재작성은 포함하지 않는다. 실제 변경 범위가 커지면 확대분을 다시 보고한다. 구현은 일일 원장/상주→주제·업무/UI→선택 UI/통합 회귀로 나눌 수 있으나 R8 안의 보완이며 새 페이즈를 만들지 않는다.

## 일반 GPT / dot 선택 UI — 2026-11-01 추가 검토

**결론:** 기존 참여자 등록/연결 선택 화면을 작은 선택 UI로 보완한다. 일반 GPT는 현재 OAuth 계정·모델을 사용하고 dot은 서버 Chrome에서 사용자가 확인한 해당 계정의 실제 기존 dot 대화를 별도 browser 연결로 사용한다. 계정의 dot 가능 여부를 OAuth 로그인 성공이나 사용자가 붙인 이름만으로 판정하지 않는다. 확인된 dot 연결이 없으면 dot 항목에 연결 필요 이유와 기존 대화 찾기 경로를 표시한다. 현재 일반 GPT 선택은 유지한다.

| 변경 접점 | 유지 / 최소 추가 |
| --- | --- |
| `src/web/control.html`, `src/web/control.ts` | 참여자 설정의 일반 GPT(OAuth)/dot(기존 대화) 선택과 해당 연결 picker를 제공. dot 미연결/대상 불일치는 이유 표시. 기존 OAuth·계정·모델 선택 폼과 BrowserDiscovery UI 재사용 |
| `src/connections/browser-discovery.ts::discoverBinding/BrowserDiscovery`, `src/connections/browser-presets/chatgpt-v1.json` | 기존 읽기 전용 페이지/계정·agent·thread·초안/busy 관측과 owner 확인을 재사용. 연결 표시 이름이나 ChatGPT origin만으로 일반 대화를 dot으로 확정하지 않음. 이 경로의 부족한 검증만 최소 보강 |
| `src/workspace/runtime.ts::Workspace.participant` | 기존 `connectionId/kind` 선택 계약과 `resident_account_change_requires_new_participant` 경계 유지. 이 선택 UI를 위해 새 OAuth/client ID/provider kind나 인증 정보 이동을 만들지 않음 |
| `src/web/room-view.ts` | 선택된 실제 참여 방식·연결 준비/미확인 상태를 표시. 과거 참여자/업무/대화 ID는 그대로 보존하며 방 off에서 참여 토글로 연결 대상을 선택 |
| `tests/browser/talker-settings.test.mjs`, `tests/browser/browser-discovery.test.mjs`, 기존 discovery fixture | 일반 GPT 기본 유지·dot 미연결 안내·잘못 붙인 이름/Muse origin의 dot 오분류0·명시 선택·새 참여자 등록/원래 기록 보존·390px·전송0 검사 |
| `docs/participant-connections.md`, 운영/구현 기록 | 계정 로그인 공간·일반 GPT와 기존 dot thread 선택 방법, 실제 확인과 UNVERIFIED를 구분 |

일반 GPT/dot 대화 방식 선택을 바꿔 실제 connection이 달라지면 새 참여자 등록으로 전환하고 기존 참가자의 history/identity를 덮어쓰지 않는다. 기존 일반 GPT 간 설정 API의 토의별 immutable member snapshot 계약은 보존한다. 기존 API가 요구하는 새 participant를 명시적으로 등록하고 기존 room membership 제어를 재사용한다. 활성/미확정 turn이나 진행 중 업무가 있으면 현재 연결을 바꾸지 않는다. 새 참여자에게 기존 grant·Codex 권한·업무 작성자/자기 리뷰 자격을 자동 복사하지 않는다. dot과 Muse는 각각의 기존 thread와 profile을 유지하며 로그인·동의는 사용자 직접 조작을 따른다.

계정별 UI는 **참여할 실제 연결을 고르는 편의 기능**이다. OAuth credential로 browser에 로그인하거나 dot 대화/기억을 가져오지 않는다. 먼저 서버 Chrome에서 원하는 계정·dot 대화를 준비하고 기존 탐지/확인을 통과해야 dot으로 선택할 수 있다. 계정에 dot이 실제 있는지 확인하지 못했으면 UNVERIFIED로 남긴다.

이 추가분은 R3 연결 선택 UI·R4 탐지/계정 확인과 R1/R2의 기존 참가자/context 경계를 소비한다. R5/R6/R7의 과거 업무/권한/인용 참조는 보존하고 R8에서 같은 계정 표시명 변경만으로 다른 연결을 자동 선택하지 않는지 회귀한다. 새 API kind는 없으므로 일반 GPT와 dot의 일일 API 한도 제외 분류도 기존 kind를 사용한다.

## 혼합 주제와 전체 흐름

API 한도가 주제 도중 소진되면 다른 참여자에게 같은 요청을 대신 보내거나 API를 조용히 제외해 초안 완료를 선언하지 않는다. 해당 주제는 원래 기록·미실행을 보존한 partial로 닫고 기존 focus 복귀 경로로 같은 방에 돌아온다. GPT/browser의 자유 발언은 계속할 수 있다. API가 빠진 새 주제가 필요하면 실제 가용 참여자를 명시한 새 제안으로 처리하며 원래 주제를 완료/검증 성공으로 바꾸지 않는다.

이 정책은 사용자가 요구한 “API 한도로 GPT까지 멈추지 않기”와 기존 활성 root1개·초안/라운드 장벽을 공존시키는 최소안이다. topic 일시정지 상태를 둔 채 별도 provider loop를 병렬로 돌리는 안은 채택하지 않는다. 과거12요청 partial을 이 기능으로 자동 resume하거나 예산/receipt를 reset하지 않는다.

## 이관·일일 경계·복귀

- 새 정책/원장은 optional이며 미지원 schema는 fail closed. 기존 방은 legacy 모드를 유지하고 owner가 선택한 방만 새 모드로 바꾼다. 기존 budgets/사용량/원문/command/event는 삭제하거나 무한대 값으로 치환하지 않는다.
- 일일 원장은 room이나 토커가 아닌 작업실 API pool에 귀속해 새 방/같은 key의 새 토커로 한도를 우회하지 못하게 한다. 실제 provider kind로 분류하며 표시 이름이나 endpoint 문자열로 요금 유형을 추정하지 않는다.
- 자정은 Asia/Seoul 기준이다. 전송 직전 transaction에서 day key와 잔여량을 다시 검사한다. 자정 전 전송·자정 후 완료는 원래 dispatch day에 정산하고, 아직 보내지 않은 예약은 실제 전송 day에 재검증한다. 자정 후 새 day를 연다고 과거 원장·unknown·lease를 지우지 않는다.
- 당일 기존 API turn의 실제 dispatch·보고 usage를 참조해 알려진 사용량을 이관/투영하고 추적 범위·미확인을 표시한다. 기존 GPT 혼합 합계를 API 비용처럼 옮기거나 미보존 usage를 만들어 채우지 않는다. 앱 밖에서 같은 key로 쓴 사용량을 알고 있다고 주장하지 않는다.
- API만 한도에 걸린 방은 다음 KST 자정 등 의미 있는 event까지 대기하며 hot loop/밀린 횟수 재전송을 하지 않는다. owner off·앱 재시작 후 명시 재개·미확정 대조 계약은 유지한다.
- 복귀 전 방 off/lease·원래 receipt를 대조한다. owner가 유효한 legacy 예산을 다시 정해 모드를 되돌릴 수 있지만 누적 사용량/새 원장·기존 사용량은 삭제하지 않는다. 구버전이 새 budgetMode를 안전하게 해석하는지 확인하기 전 구버전으로 방을 켜지 않는다.

## R1~R8 및 후속 영향

| 단계 | 유지 / 변경·필요 검사 |
| --- | --- |
| R1 | Store transaction/command/event·SQL schema 유지. 선택 정책/원장/모드 이관·기존 데이터/unknown 보존 검사 추가 |
| R2 | 단일 dispatch·미확정·방 on/off·속도·세대 유지. provider별 eligibility·일일 예약·자정 대기/재시작과 budget 검사 범위 변경 |
| R3 | 기존 흑백 GUI·상단 주제·기록/SSE 유지. API 설정·GPT/browser 한도 제외·만료/수동 잠금 상태 투영 및390px/2탭 CAS 검사 |
| R4 | 키/계정·실제 thread·초안/busy·identity guard 유지. dot/Muse 대상 불일치와 수동 잠금은 전송 없이 표시; owner 확인 전 binding 덮어쓰기/잠금 해제 금지 |
| R5 | 기존 task/attempt·보고/독립 리뷰·role/scope 유지. API 한도로 아직 전송하지 않은 후보만 대기·가용 GPT 분석 처리 검사 |
| R6 | Codex 승인/격리·도구 한도/deadline·실쓰기 gate 유지. 대화 무제한이 실행 무제한이 되지 않는 검사 추가 |
| R7 | Wiki CAS/version·source/인용·MCP scope 유지. 토커가 일일 정책/원장을 변경하지 못함과 새 모드의 인용·회귀 검사 |
| R8 | 원래50 gate 수락 문구·기존 legacy 증거 보존. 새 정책의 별도 조건·실행 증거를 추가하고 전체/부분·실계정/fixture 구분. 기존 제한 관련 검사를 삭제해 PASS를 만들지 않음 |
| 후속 선택 범위 | Git Writer·병렬 용량·추가 provider/OAuth·자동 병합 범위/순서 변경 없음 |

## 승인 후 수락 방법

1. 새 clock fixture로 KST 자정 직전/직후·전송/정산 경계·재시작을 각각 검사. 기존 원장 누락/같은 requestId 이중 charge0.
2. 여러 room/토커의 API 합산 한도, 요청N+1 전송0·토큰 소진 뒤 추가API0. reported token/unknown과 단일 응답 초과를 그대로 표시.
3. API 소진/미설정·수동 잠금 browser에서 새 API/browser 전송0인 채 GPT 두 참여자의 자유 발언 진행. 실제 전송이 미확정이면 기존대로 전체 새 dispatch0.
4. 혼합 topic의 한도 도달→partial/같은 방 복귀·GPT 진행을 검사. 초기 초안 공유0·현재 라운드 조기 공개0·단일 provider≤1·실행 권한 확대0.
5. 기존 legacy 방·과거12요청 partial/원문·receipt·Wiki/명령/50 gate 보존. API/GPT/브라우저 사용량을 표시 이름 변경으로 오분류하지 않음.
6. owner/Host/Origin·2탭 CAS·MCP 정책 변경 거절,1440/390px·SSE/새로고침·실수로 시작/자동 유료 호출0. `npm run check`와 필요한 전체 Chrome/MCP 회귀로 판정.

이 문서는 위 11월1일 승인으로 개발·계획 변경 범위가 확정됐다. 초기 API 일일 숫자24회/20만은 설정 화면의 제안값이며 운영 정책에는 아직 적용하지 않았다. 배포·방 켜기·일일 실제API 호출·dot/Muse 대화 전송은 완성된 변경을 검토한 뒤 구체적으로 허용받아 진행한다. 기존 dot/Muse의 정확한 대화 확인은 별도 사용자 입력이 필요하다.
