# 페이즈 4 실행 기록 — 기존 Chrome 대화의 탐지와 연결 편의성

진행 상태는 [개발 페이즈 SSOT](../development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)를 따른다. 사용자 지시 “머지 완료. 페이즈 4 개발 승인”으로 R4를 구현했다. 계획의 범위·순서·계약·수락 기준 변경은 없다. 실계정 수락 R4-D와 앞 단계의 실기기 R3-E는 미확인으로 유지한다.

| 항목 | 확인 |
| --- | --- |
| 날짜 / base | 2026-10-30 KST / main a218f3ae432f41c1e6641d7459b6416fec088afe (PR #15 사용자 병합, 46bb4c4와 동일 tree) |
| 작업 브랜치 | codex/phase4-browser-discovery-20261030 |
| 코드 식별 | 이 문서와 같은 PR의 commit·CI로 추적. 원래 C/P 설계 근거는 변경하지 않음 |
| 검사 환경 | Ubuntu 임시 SQLite·loopback HTTP·synthetic 페이지, Node 24.18.0 / npm 11.16.0 |
| 실제 도구 | Chrome 156.0.8078.47 / Chrome DevTools MCP 1.12.0 |
| strict TypeScript·빌드·Node | 132 PASS / 0 FAIL / 0 SKIP (기존 118 + 신규 14) |
| 실제 Chrome/MCP fixture | 21 PASS / 0 FAIL / 0 SKIP (기존 15 + 신규 6) |
| 실제 dot·Muse·서비스 DOM 적합성·왕복 | R4-D UNVERIFIED / NOT_RUN. 실제 서비스 프리셋의 verification은 UNVERIFIED로 명시 |
| 실제 모델·OAuth 로그인·실제 Codex 실행 | NOT_RUN. 모델 응답은 synthetic이며 실제 tool 프로세스 검사와 구분 |
| 운영 서비스·.env·DB·vault·접속 키·Chrome profile·Tailscale | 변경/배포/재시작하지 않음. build는 dist만 갱신 |

## 1. 수락 결과와 검사

| Gate | 판정 | 명령·화면·로그 증거 |
| --- | --- | --- |
| R4-A | PASS (fixture) | ChatGPT/Muse × 정상/구버전 DOM/다중 후보/thread 변경/기존 초안 10종을 실제 Chromium DOM에서 실행. 탐지 중 send0·DOM MutationObserver0·body 변경0·자동 저장0. 불명확 후보에는 저장 가능한 discovery ID가 없음. Node mock 관측 10종과 실제 DOM 10종을 구분 |
| R4-B | PASS (fixture) | 2서비스 × 390/1440px 온보딩에서 selector 입력0. 페이지·프로필 선택→읽기 전용 후보→identity/thread 확인→기존 probe→저장. page ID 7→8 갱신 시 같은 connection ID/목표 유지·이전 binding1 보존. 신규 후보 화면과 고급 갱신 화면을 test-results/resident/R4/에 생성 |
| R4-C | PASS (fixture) | draft/busy/account/thread/profile/중복 입력란에서 후보 확인과 실제 complete 전송0. 초안 원문 유지. 기존 DOM/marker/receipt·동적 버튼·같은 URL thread·copy-exclude 복구 검사 유지. 기존 수동 custom selector·side-thread·account/agent 별칭·manual lease도 그대로 유지 |
| R4-D | UNVERIFIED / NOT_RUN | 이번 새 탐지 경로로 실제 dot/Muse 각1개 대화의 profile/identity/thread·왕복은 실행하지 않음. 과거 Muse 연결/복구 기록을 이번 성공으로 승계하지 않음 |
| MCP 실제 계약 | PASS | 설치된 MCP 1.12.0·실제 Chrome의 page ID/프로필 목록→탐지→기존 probe, 전송0. MCP는 기본 text 목록과 선택적 structuredContent를 지원하므로 두 형식을 검사. 실제 service 계정 없음 |
| 인증·경합·중복 | PASS | owner 미인증·다른 Origin 거절, profile/ID 명시 선택·후보 만료/잘못된 scope 거절. 같은 confirm key2회→연결1. probe가 대기하는 동안 active turn 생성→binding 저장 거절·이전 page ID 유지 |
| 기존 화면 갱신 | PASS | 오래된 connection/SSE snapshot을 지연시킨 상태에서 토의 생성→새 선택 보존·토의 완료. 기존 자료 토론·단톡방/IME/읽기 cursor·승인·OAuth 분리/토커 설정 회귀 유지 |

검사 명령:

~~~bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/실제/별도설치/node_modules/.bin/chrome-devtools-mcp \
node --test --test-reporter=spec tests/browser/*.test.mjs
~~~

- [Node 서비스·HTTP 검사](../../tests/browser-discovery.test.mjs): preset 검증·URL/page/profile·scope·TTL·owner API·저장/idempotency·active-turn 경합.
- [실제 DOM·UI·MCP 검사](../../tests/browser/browser-discovery.test.mjs): 10종 DOM matrix·두 viewport 온보딩·전송 차단·기존 custom selector 재탐지·실제 MCP·지연 snapshot 재현.
- [synthetic fixture](../../tests/browser-discovery-fixture.mjs): 외부 서비스 로그인 없이 로컬 응답으로 페이지를 채움. MCP 검사 SKIP을 전체 PASS로 쓰지 않음.

test-results/resident/R4/discovery-matrix.json, candidate-{chatgpt,muse}-{390,1440}.png, onboarding-{chatgpt,muse}-{390,1440}.png는 private 계정/대화가 없는 fixture다. gitignored 위치에 재생성하며 실제 Chrome profile이나 사적 DOM을 공개 저장소에 복사하지 않는다.

문서5개의 로컬 링크/앵커94개 오류0, 사용자 기존 미추적 파일35개 hash 변화0, git diff --check 오류0을 확인했다. 사용자 파일·실제 계정·대화·선택자는 이 PR에 포함하지 않는다.

전체 브라우저 실행 중 자료 토론의 완료 대기 실패가 있었고 단독 실행에서는 통과했다. 별도 지연 snapshot fixture로 기존 UI의 선택 손실을 재현한 뒤 [control.ts::refresh](../../src/web/control.ts)에서 조회 전후 selection을 대조해 이전 조회 결과를 폐기하도록 고쳤다. 토의/전송 계약은 바꾸지 않았다. 실패 결과를 PASS로 세지 않고 수정된 소스에서 전체 검사를 다시 수행했다.

## 2. 계약·데이터·최소 변경

| 경계 | 유지/변경 | 구현·이유 |
| --- | --- | --- |
| provider·실행 backend | 유지 | Providers.complete/Hooks·OAuth/DeepSeek·topic/resident parser/엔진·dispatch·Codex·승인/예산 불변. 탐지를 위해 새 인증·provider·모델·shell 실행 경로를 만들지 않음 |
| BrowserBridge | 기존 경계 재사용·최소 보강 | [browser.ts](../../src/connections/browser.ts)의 tool/inspect/probe 사용. 기본 MCP text/structured 페이지 목록 판독 추가. discovery metadata가 있는 binding에만 profile·유일한 입력/identity/ready 후보를 추가 확인하며 기존 URL/identity/thread/draft/busy/ready·전송 직전 재검사·marker/receipt 유지 |
| 탐지 Facade | 신규 작은 모듈 | [BrowserDiscovery/discoverBinding/validatePreset](../../src/connections/browser-discovery.ts): 열린 허용 URL만 목록화, page ID와 profile을 직접 선택, 고정 read-only 스크립트로 후보 수집→기존 probe. 임의 DOM script/모델 실행 없음. DOM을 읽기 전에 예상 URL을 확인하고 cookies/storage/private API/기존 초안 본문을 수집하지 않음 |
| 프리셋 | 신규 JSON 데이터 | [ChatGPT](../../src/connections/browser-presets/chatgpt-v1.json)·[Muse](../../src/connections/browser-presets/muse-v1.json). 서비스별 후보 규칙은 아직 UNVERIFIED이며 synthetic fixture PASS를 실제 DOM 지원으로 표시하지 않음. 이미 검증한 binding은 원래 선택자로 재탐지하고 임의 기본값으로 덮지 않음 |
| 저장·이관 | additive / eager migration0 | [BrowserBinding.discovery/Connection.browserHistory](../../src/workspace/model.ts)에 presetVersion/관측 시각/근거 digest/profile와 변경 전 binding 이력 추가. 기존 binding/DB 테이블·schemaVersion/user_version/commands/event 원문을 변환하지 않음 |
| 결합·저장 경계 | 기존 addBrowser 경로 | [Workspace.discoverBrowser/confirmBrowser/addBrowser](../../src/workspace/runtime.ts)가 기존 identity 불변/동일 대화·중복 연결·active/unconfirmed 검사를 재사용. probe await 뒤 transaction에서 active turn과 기존 binding을 다시 확인. confirm은 기존 Store.transact에 state/event/command 결과를 원자적으로 저장 |
| HTTP·보안 | owner API만 additive | [workspace.ts::route](../../src/http/workspace.ts)에 아래3개 경로. 기존 owner session/bearer·Host/Origin 보호 사용. MCP grant를 owner로 승격하지 않음. 탐지 ID가 인증 키가 되지 않음 |
| GUI | 기존 control의 작은 소비자 | [control.html](../../src/web/control.html)·[control.ts](../../src/web/control.ts)·[control.css](../../src/web/control.css). 같은 api/refresh/SSE 사용, CSS는 고급 fallback에 유지. 비동기 탐지 중 선택이 바뀌면 이전 후보 결과를 폐기 |
| 빌드 | JSON 복사만 추가 | [build.mjs](../../scripts/build.mjs)로 preset을 서버 dist에 포함. 브라우저와 공유하는 [DTO](../../src/connections/browser-discovery-model.ts)는 Node 실행 의존성이 없는 타입뿐 |

작은 Facade/Adapter·기존 transaction을 사용했다. 새로운 DB/ORM/daemon·event bus·인증 계층은 없다. 기존 provider/Chrome profile·대화·입력 초안은 재초기화하지 않는다. 구 선택자 버전은 비공개 DB 이력에 남기며 old reader는 optional 필드를 보존한다.

## 3. API와 사용 흐름

| 요청 | 계약 |
| --- | --- |
| GET /api/browser/discovery/pages | owner용 열린 허용 페이지의 pageId/url/title/profile와 프리셋 이름/버전/UNVERIFIED. 자동 첫 후보 선택 없음. 기본 context는 default, 격리 context는 isolated: 접두사로 구분 |
| POST /api/browser/discovery | pageId/profile/presetId 필수, 기존 갱신이면 connectionId. read-only 후보 또는 blocked/unsupported 이유. 기존 계정/thread 불일치·초안/busy·여러 후보는 저장 가능한 ID0 |
| POST /api/browser/discovery/confirm | discoveryId/confirmed=true/label와 원래 connectionId scope, Idempotency-Key. 현재 page/profile/identity/thread/초안·후보를 다시 확인하고 기존 probe/addBrowser로 저장. 이름 변경이 인증/대화 변경 권한이 되지 않음 |

후보는 서버 메모리에 최대100개, 유효5분이며 재시작하면 사라진다. 후보가 사라져도 기존 binding은 보존되고 임의 저장·재전송하지 않는다. 완료 저장만 기존 DB command journal에 남는다. 후보 metadata는 실제 화면 식별 근거이며 로그인 기억·메모리 import나 실응답 완료의 증거가 아니다.

사용자는 연결 화면에서 페이지 찾기→페이지/프로필/서비스 선택→읽기 전용 확인→기존 화면과 계정·대화 ID 대조→확인한 대화 연결 순서로 진행한다. 이미 등록한 대화는 “기존 대화 다시 찾기”로 page ID를 갱신한다. 새 모델·계정·참여자를 자동 생성하지 않으며 기존 참여자 등록/방 토글을 사용한다.

알 수 없는 DOM은 고급 연결과 원래 snapshot/probe로 확인한다. service 프리셋을 추측한 binding으로 자동 등록하지 않는다. 초안/busy는 원래 화면에서 사용자가 직접 처리하고 다시 확인한다. 미확정 요청은 원래 turn/대화·receipt를 먼저 대조한다. Chrome 수동 조작 잠금은 탐지·저장 후에도 그대로이며 자동 입력 재개는 기존 명시 동작이다.

## 4. 롤백·후속 페이즈

연결 탐지 대신 **고급 연결 · 선택자 직접 입력**과 이미 검증된 binding을 사용하면 같은 BrowserBridge/probe/DB로 돌아간다. 기존 account·agent·URL·thread guard를 낮춰 탐지 실패를 우회하지 않는다. 이전 선택자는 browserHistory에 보존하며 사용할 때도 기존 목표/준비 상태 probe가 필요하다. Chrome profile·초안·기존 대화를 지우지 않는다.

서버 binary를 이전 버전으로 내릴 때는 [G0](../resident-implementation-plan.md#2-공통-롤백-g0--모든-단계의-선행-조건)에 따라 진행·미확정 turn/job을 원래 ID로 대조한 뒤 전환한다. 구 reader가 새 profile metadata를 검사한다고 가정하지 않고 이전 전송을 자동 재개하지 않는다. DB snapshot restore·receipt/commands 삭제로 복귀하지 않는다.

| 후속 단계 | 영향·남는 접점 |
| --- | --- |
| 5 역할·열린 큐 | participant/connection ID·기존 complete 계약 유지. 새 탐지 metadata는 선택 필드여서 queue/role/claim 모델을 재작성할 이유 없음. 실제 역할/큐는 아직 미구현 |
| 6 실제 업무 | 기존 BrowserBridge 전송·marker/receipt·Codex 승인/격리 유지. 탐지 성공이 업무 완료/추가 권한을 뜻하지 않음. 실제 scope·쓰기 gate는 후속 범위 |
| 7 공유 Wiki/MCP | 새 경로는 owner 전용. 기존 MCP grant로 browser 탐지·계정 선택을 수행하지 않음. Wiki 출처/권한/버전 계약 변경0 |
| 8 통합 수락 | 합성10종/실제 MCP fixture·기존 회귀 재사용. R4-D 실제 dot/Muse 왕복과 DOM 적합성, 이전 R3-E 실기기, 장기 사용·업무/Wiki 전체 흐름은 여전히 UNVERIFIED |

페이즈 범위·순서·수락 기준과 U1/U2/U3는 바꾸지 않았다. 실제 계정 검증은 별도 허용·원래 대화 확인 후 수행하며 이번 자동 검사로 R4-D를 완료 표시하지 않는다. PR 병합은 사용자가 한다.
