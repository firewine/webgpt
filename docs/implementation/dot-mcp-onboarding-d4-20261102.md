# D4 — 공식 dot 연결 화면·private 설정·상태 진단

11/02 후속 확인: [PR #40](https://github.com/firewine/webgpt/pull/40)은 12:12:20 KST 병합, main `8affb469c3e6ce5b636f465ff693d62ac45071b8`. 최종 head `8408c30719b7836382ef338fdb507df6ad4a5399`의 [CI](https://github.com/firewine/webgpt/actions/runs/41380886404)는 Node473/browser64/고정 Codex0.165.0 schema PASS다. 아래 검토 브랜치/CI 재검사 설명은 당시 기록이며 현재 통합/운영 수락은 [D5](./dot-mcp-acceptance-d5-20261102.md)에서 이어간다.

## 기준과 범위

2026-11-02 사용자 지시 “병합 완료 다음 페이즈 진행”에 따라 D3 PR #39의 병합을 GitHub에서 확인했다. 기준 main **`9992f74fc765f44017cc048f5a5646788a3d2f32`**, D3 head `a2708b1abec1073cf840555e4c402d08b32d29b4`, 병합 2026-11-02 11:25:47 KST. D3 [CI](https://github.com/firewine/webgpt/actions/runs/41374740800)는 Node468/browser62/설치 Codex0.165.0 schema PASS이며 이번 D4 검사와 구분한다.

D4 작업 브랜치 `codex/dot-mcp-onboarding-d4-20261102`는 독립 worktree다. [승인된 D4](../reviews/dot-official-mcp-events-impact-20261101.md)의 연결 UI·private plugin·진단/운영 절차 범위다. 후속 D5의 실계정/Muse/혼합 50 gate 기준은 변경하지 않는다. 추가 OAuth·공개 ingress·timeout 확대·기존 안전장치 제거는 없다.

변경은 **25파일·약690줄(add/delete 합산)**이다. 승인안의450~750줄 범위 안이며, 파일 수는 예측11~15보다 늘었다. 공용 DTO/순수 상태 projection/View의 분리, 기존 화면명 회귀3파일, 전용 runbook/템플릿/검사 파일 때문에 나뉜 것으로 기능 범위·후속 단계·데이터 이관의 확대는 없다. 기존 `topic-chat-view.ts`는 이미 같은 참여자 상태/설정 경로를 사용하므로 별도 수정하지 않았다.

## 기존 계약과 최소 변경

| 파일·심볼 | 구현과 유지한 경계 |
| --- | --- |
| `http/workspace.ts::createWorkspaceServer` | owner GET status/POST 등록·확인·회수. 기존 Access/Origin/Idempotency와 D1 명령 재사용. 임의 도구 필드 거절, 기본3도구 고정, version CAS. 새 UI 모듈 정적 자산 등록 |
| `workspace/dot-mcp-status.ts::projectDotConnection` | 입력/답변/키/callback을 제외한 순수 상태 projection. 권한·구독·outbox·mailbox를 분리. 회수·만료와 정상 방 전환을 구분 |
| `dot-mcp-model.ts::DotConnectionStatus`, `dot-mcp.ts::snapshot`, `resident-status.ts::projectResidentStatus` | 공용 metadata DTO와 기존 스냅샷/방 관측 결합. UI 조회는 상태/dispatch/cursor를 변경하지 않음 |
| `web/dot-connections.ts::DotConnectionsView`, `control.*`, `room-view.ts` | 방별 dot 등록·owner 확인/키 발급·재발급·회수·상태4축. 같은 payload 재시도는 같은 command key. 별칭을 실제 계정 증명으로 표시하지 않음. 일반 GPT/browser/Muse 경로와 구분 |
| `scripts/readiness.mjs::projectReadiness` | doctor의 dot 준비/차단 이유. browser2개로 dot+Muse를 추정하던 조건을 browser와 native dot의 독립 진단으로 바꿈. 실제 Muse thread/계정 수락은 여전히 UNVERIFIED |
| `scripts/dot-mcp-ops.mjs` | private parent/0600 파일·새 경로·no-follow/no-overwrite 키 저장과 앱 참조 패키지 생성. 설치/인증 완료를 주장하지 않음 |
| `scripts/mcp-stdio.mjs`, `dot-preflight.mjs::readGrant` | 기존 보호된 전달기 재사용. native 모드일 때 health identity→인증 metadata/Events 검사, 다른 서비스/owner key/legacy grant면 중단. redirect 금지. 모델/구독을 시작하지 않음 |
| `plugins/webjjoku-dot/plugin.json`, `README.md` | 등록된 앱 참조 템플릿/최초 native 감시 지시. `.app.json`은 private 출력에만 생성. 외부 캐릭터/코드/자산 복사 없음 |

의존성·DB schema 변경 **0**. 기존 complete/JSON 계약, Store transaction, D2 서명·public DNS 검증·유한 재시도, D3 turn/claim/원문/receipt/세대 검사, API 전용 일일 정책, 업무/Wiki/Codex 승인 그대로다. 상태 projection/View와 얇은 HTTP adapter로 분리했으며 새 범용 프레임워크를 만들지 않았다. 공용 DTO를 통해 브라우저가 서버/Vault 모듈을 runtime import하지 않는다.

## 설정·인증의 의미

등록은 disabled 멤버만 만들며 방을 켜지 않는다. 확인은 소유자가 대상 방/dot/접근 범위를 명시 확인한 grant다. 실제 native actor 검증은 false로 남는다. 키는 일시적인 확인 응답과 메모리 입력에만 표시하고 창 닫기/전환/로그아웃/2분 후 지운다. 재발급은 기존 grant/구독을 회수하므로 별도 확인을 거친다.

운영 연결은 [별도 runbook](../dot-connection-runbook.md)의 기존 private scoped stdio 방식이다. `/mcp`의 인증을 제거하지 않는다. Tunnel 접근자가 같은 제한 grant를 사용할 수 있음을 확인 화면에 명시하며, 이것을 사용자별 OAuth/principal 증명으로 표시하지 않는다. 해당 ChatGPT 계정에서의 실제 등록 인증/운영 왕복은 **UNVERIFIED**다. 추가 OAuth가 필요하면 영향/변경량 승인 전 구현하지 않는다. D0 합성 앱을 운영 권한으로 승격하거나 새 runtime을 시작하지 않았다.

## 수락 검사

Ubuntu 격리 worktree, Node24.18.0/npm11.16.0. 모델 응답·callback은 fixture이며 실제 계정 호출0이다. 운영 state 대신 임시 SQLite/Vault, 실제 Chromium/Chrome MCP는 합성 DOM만 사용한다.

| 기준 | 실행 방법·결과 |
| --- | --- |
| owner/API 경계 | `tests/dot-onboarding.test.mjs`: 미인증401·다른 Origin403, 같은 등록/확인20개→각1결과, scope 주입400·version충돌409, 회수20회1결과. **PASS** |
| 조회·정보 최소화 | 상태/state20회→DB/cursor 동일·provider0·requests0. 원문/token/callback/claim 비노출, 만료·대조·구세대·HTTP 성공과 답변 상태 구별. **PASS** |
| 보호된 전달기·설정 | 새 키/package0600·기존/링크 거절, 자식 stdio 프로세스의 native 도구3개 조회·owner키 거절·다른 서비스 credential전달0. Node 신규5개 **PASS** |
| 화면 | `tests/browser/dot-connection.test.mjs`: 390/768/1440px overflow0, 상태/회수·창 닫기·2분 경과·세션 상실 시 민감 표시 정리,20회 전환·reload→모델0·Muse binding/thread 보존. 신규2개 **PASS** |
| 관련 browser 회귀 | dot picker·Muse/일반 ChatGPT discovery 포함10개 **PASS, fail0/skip0**. 실제 Chrome MCP page/probe 포함, 실제 Muse 전송 아님 |
| 전체 TypeScript·빌드·Node | `npm run check`: **473 PASS, fail0/skip0**. `/tmp/webjjoku-dot-d4-check.log` |
| 전체 browser | `WJ_TEST_CHROMIUM_EXECUTABLE=설치Chrome WJ_TEST_CHROME_MCP=설치MCP node --test tests/browser/*.test.mjs`: **64 PASS, fail0/skip0**, Chromium156.0.8078.4·Chrome MCP1.12.0. `/tmp/webjjoku-dot-d4-browser.log` |
| CI | D4 PR의 Check가 고정 Codex0.165.0 생성 schema·Node·browser를 실행한다. 해당 commit/실행 링크로 판정하며 이전 D3 CI를 D4 증거로 계산하지 않음 |

스크린샷은 `test-results/dot-D4/connection-{390,768,1440}.png`, `private-grant-390.png`에 합성 fixture로 저장하고 확인했다. 운영 계정/키/개인 대화는 없다. 초기 로컬 browser 실행은 Playwright 기본 설치 경로가 없어 시작하지 못했고 설치된 Chromium 명시로 해결했다. 첫 화면 검사에서 새 모듈의 정적 자산 누락을 찾아 수정한 뒤 관련10개가 통과했다. 로컬 Codex0.165 경로가 없어 계약 검사 시도는 ENOENT였으며 전역0.166 설치를 0.165 통과로 계산하지 않는다. 고정0.165는 기존 CI 설치/검사로 판정한다.

전체 browser 첫 실행은63/64로, 기존 R3 검사 하나가 변경 전 연결 제목을 찾았다. 현재 Muse/일반 ChatGPT 제목으로 그 검사를 맞춰 해당7개가 통과했고, 키의2분 만료/실제401 세션 상실 검사를 강화한 뒤 전체64개가 통과했다. 생략한 검사 없이 최종 결과를 기록한다.

PR #40 첫 [CI 실행](https://github.com/firewine/webgpt/actions/runs/41380395624)은 Node473·Codex0.165.0 계약 PASS, browser63/64였다. 신규 화면 증거 캡처 중 SSE가 카드를 다시 그려 locator가 분리된 `Element is not attached to the DOM` 실패였다. 화면/상태/overflow/전송0 수락 검사는 유지하고 증거 캡처를 element에서 document screenshot으로 바꿨다. 제품 코드를 바꾸거나 실패 검사를 제외하지 않았으며 후속 PR Check에서 최종 commit을 판정한다.

## 보존·후속·복귀

D4는 운영 저장소/.env/state/접속 키/Chrome profile·Muse 대화·다른 서비스/포트를 변경하지 않았다. 최종 읽기 전용 확인에서 운영 `.env` 해시·기존 사용자 파일35개 해시가 기준과 동일했고 운영 branch/head는 기존 D0 `9fb2dd9`, 서비스는 같은 PID로 active/running이었다. 실계정 로그인/모델·dot/Muse 전송·Tunnel 생성/시작·배포 **NOT_RUN**이다. 로컬 테스트의 Muse 보존을 실제 서버의 오래된 snapshot 일치로 확대하지 않는다.

D5는 실제 운영 인증 경계·native 감시·signed callback·원래 turn/receipt·혼합 대화·업무/Wiki/Codex 50 gate를 따로 확인한다. D3 승인대로 off→on/주제 왕복에서 연결 유지·옛 요청 적용0을 대조한다. D4의 ‘전송 준비됨’이나 package PREPARED만으로 완료하지 않는다.

복귀: dot 발언 off → 미확정 원래 결과 대조 → grant/구독 회수 → 외부 native 감시 해제 확인 → 전용 runtime만 중지. D4 DB 이관이 없으므로 D3 호환성을 확인한 뒤 이전 바이너리를 사용한다. 원문/receipt/identity/history를 삭제하거나 Muse를 이전 browser dot 경로로 자동 대체하지 않는다. PR 병합은 사용자 담당이다.
