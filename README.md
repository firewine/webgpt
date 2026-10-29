# 웹쫀쿠 (Webjjoku)

주제 하나를 여러 AI가 독립적으로 제안하고, 서로 검토하고, 근거를 확인한 뒤 결과를 비교하는 개인용 웹 작업실입니다. Ubuntu 서버에서 실행하고 허용된 Tailscale 기기의 브라우저로 접속합니다.

**v0.2 구현:** 공동 대화 UI, 영속 토의 엔진, GPT 다중 OAuth·DeepSeek·기존 Chrome 대화 어댑터, MCP 도구, Codex 실행·승인·결과 환류, 운영 스크립트. 실제 사용자 계정·Ubuntu·Tailnet에서의 MVP 판정은 아직 **NOT_RUN**입니다. [구현·검증 기록](docs/implementation/wj-002-015.md)을 함께 확인하세요.

## 바로 실행

Node.js 24.x / npm 11.x가 필요합니다. 초기 설치 이후 모의 참여자로 실행하는 데 실제 AI 계정은 필요하지 않습니다.

```bash
npm ci
npm run build
cp .env.example .env
npm run access-token
npm start
```

브라우저에서 <http://127.0.0.1:3000>을 열고 서버에서 확인한 접속 키를 입력합니다. **모의 참여자 A/B**를 선택하고 주제를 입력하면 전체 토의 절차를 볼 수 있습니다. 모의 결과에는 실제 모델·사실 검증이 아니라는 표시가 붙습니다. 접속 키를 채팅·Git·공개 로그에 붙이지 마세요.

`참여자와 연결`에서 실제 계정을 등록하고 모델과 역할을 선택합니다. 로그인 성공, 모델 사용 권한, 실제 응답 완료는 별도로 확인합니다. GPT는 공식 OAuth로 인증한 public Responses 경로를 사용하며, 기존 ChatGPT 대화나 dot의 기억을 OAuth로 가져오지 않습니다. 기존 dot·Muse 맥락은 별도의 Chrome 연결에서 유지합니다.

## 사용 흐름

1. 주제, 비교 기준, 참고 자료, 참여자 2~8명과 진행 한도를 선택합니다.
2. 독립 초안을 모은 뒤 상대 주장 ID를 기준으로 검토합니다. 라운드가 끝나기 전에 같은 라운드의 답변을 다른 참여자에게 보여주지 않습니다.
3. 반론·불확실성이 있는 주장의 검증 제안을 우선 배정합니다. 공개 출처 조회나 등록한 Codex의 실제 결과를 근거에 연결합니다. 수행하지 못한 검증은 `미실행`으로 남습니다.
4. 모든 참여자가 같은 근거를 보고 수정안을 작성합니다. 종합안은 한 참여자가 만들고 나머지가 검토합니다. 초기안·수정안·이견·근거를 나란히 확인합니다.
5. 조건 보완, 일시정지, 이어가기, 취소와 체크포인트를 사용할 수 있습니다. 탭을 닫아도 서버 작업과 기록은 유지됩니다.

현재 한 작업실에서 활성 토의 1개, provider 발언 1개를 순차 실행합니다. 요청 수·활성 시간·보고된 토큰·검증 과제·Codex 실행 수를 제한합니다. 사용량을 제공하지 않은 연결은 미확인 횟수로 표시하며 가격을 임의 추정하지 않습니다.

일시정지는 다음 전송을 막고 현재 응답을 기록합니다. 토의 취소가 이미 전송된 원격 작업의 취소를 뜻하지는 않습니다. Codex 중단은 실행 화면에서 요청하고 실제 종료 event를 기다립니다. 불확실한 전송과 재시작 중이던 실행은 자동 재전송하지 않습니다.

## Ubuntu와 Tailscale

[운영 절차](docs/operations-runbook.md)에 설치, Chrome/noVNC, OAuth, Secure MCP Tunnel, Codex 등록, 백업과 복구를 정리했습니다.

```bash
npm run doctor
npm run install:service
systemctl --user enable --now webjjoku
# WJ_PUBLIC_ORIGIN을 실제 *.ts.net HTTPS 주소로 설정한 후:
npm run serve:tailnet
```

설치 스크립트는 user unit을 만들고, Serve 스크립트는 지정 포트가 비어 있을 때만 해당 포트를 설정합니다. 기존 Serve 설정을 reset하지 않습니다. `WJ_PUBLIC_ORIGIN`을 바꾸면 서비스를 재시작합니다. 외부 공개 Funnel이나 Chrome 제어 포트의 Tailnet 직접 노출은 사용하지 않습니다.

| 설정 | 기본값 / 의미 |
| --- | --- |
| `WJ_HOST`, `WJ_PORT` | `127.0.0.1`, `3000`; loopback 전용 |
| `WJ_PUBLIC_ORIGIN` | `http://127.0.0.1:3000`; 운영에서는 실제 HTTPS origin |
| `WJ_STATE_DIR` | `~/.local/state/webjjoku`; SQLite·접속 키·암호화 credential |
| `WJ_CHROME_PROFILE_DIR` | `~/.local/share/webjjoku/chrome`; 서버 전용 persistent Chrome profile |
| `WJ_CHROME_COMMAND` | JSON argument array; 설정하지 않으면 browser 기능 차단 |
| `WJ_NOVNC_PORT` | 미설정; 설정 시 고정 loopback upstream |
| `WJ_OAUTH_PORT` | `1455`; 같은 Ubuntu Chrome의 loopback callback |
| `WJ_CODEX_COMMAND` | `["codex","app-server"]`; 실제 설치 경로로 고정 권장 |
| `WJ_WORKSPACE_ROOTS` | `[]`; Codex에 허용할 절대 경로 목록 |
| `WJ_SOURCE_FETCH` | 기본 `false`, 예제 `.env`는 `true`; 공개 출처 조회 |
| `WJ_TURN_TIMEOUT_MS` | `300000`; provider turn 제한 |

## Codex와 MCP

`Codex 실행`에서 기존 thread ID와 실제 cwd를 등록합니다. 호스트·실행 사용자·세션·경로·브랜치를 대조하며, 파일 수정은 작업 브랜치에서만 허용합니다. 기본은 큐에 추가, 진행 중 변경은 expected turn ID를 지정한 steer입니다. 승인 요청은 소유자가 화면에서 처리합니다.

Ubuntu 실행기는 bubblewrap으로 앱 상태와 Chrome profile을 숨기고 Codex sandbox를 유지합니다. 같은 저장소의 실행을 직렬화합니다. **해당 세션을 다른 Codex 클라이언트에서 동시에 실행하지 않아야 합니다.** 외부 CLI까지 포괄하는 전역 작성자 잠금을 제공한다고 주장하지 않습니다.

`/mcp`는 소유자 접속 키와 별개의 참여자·토의별 권한을 사용합니다. `task_get`, `context_get`, `result_submit`, `codex_send/status/result/cancel`을 제공합니다. dot의 MCP 제출은 job 접수일 뿐이며, 실제 완료 후 동일 근거를 모든 참여자에게 전달합니다. Secure MCP Tunnel용 stdio 전달기 `scripts/mcp-stdio.mjs`도 포함합니다. MCP Events와 Muse의 공식 Connector는 비활성이고, 완료 후 Core의 기존 browser 경로로 재검토를 진행합니다.

## 검사

```bash
npm run check
npx playwright install --with-deps chromium
npm run test:browser
```

현재 Node 검사 38개와 실제 Chromium 검사 4개를 검증했습니다. 네 번째 browser 검사는 설치된 Chrome DevTools MCP가 필요하므로 기본 명령에서는 명시적으로 SKIP됩니다. CI와 아래 설정에서는 모두 실행됩니다.

```bash
npm install --no-save --package-lock=false @openai/codex@0.165.0 chrome-devtools-mcp@1.12.0
WJ_CODEX_BINARY=./node_modules/.bin/codex npm run test:codex-contract
WJ_TEST_CHROME_MCP=./node_modules/.bin/chrome-devtools-mcp npm run test:browser
```

`WJ_TEST_CHROMIUM_EXECUTABLE`로 이미 설치된 Chromium을 지정할 수 있습니다. tests는 실제 계정·과금 모델을 사용하지 않습니다. 실제 브라우저 DOM·MCP와 Codex의 설치된 schema 검사는 실제 서비스 로그인/추론 검사와 구분합니다. `test-results/`에 1440px·390px 화면을 저장합니다.

## 코드와 기록

| 경로 | 책임 |
| --- | --- |
| `src/workspace/` | SQLite journal, credential vault, 토의·근거·checkpoint·scheduler |
| `src/connections/` | OAuth, Responses/DeepSeek SSE, Chrome MCP, 공개 출처 조회 |
| `src/execution/codex.ts` | App Server JSONL, 세션 대조·큐·승인·실행 증거·복구 |
| `src/http/workspace.ts` | 인증·Origin·SSE·noVNC/WSS·소유자 API |
| `src/http/mcp.ts` | 참여자별 scoped MCP 도구 |
| `src/web/control.*` | 반응형 공동 작업실 |
| `scripts/` | 빌드·설치·진단·백업·desktop·MCP stdio |
| `docs/implementation/wj-002-015.md` | 구현 범위·검증 증거·실환경 완료 기준 |

Node 내장 HTTP/SQLite와 strict TypeScript를 사용하고 JWT 검증에는 `jose`를 사용합니다. 이전 WJ-001 진단 코드는 회귀 fixture로 유지하며 운영 진입점은 새 작업실입니다. [ADR](docs/adr/0001-workspace-runtime.md), [개발 계획](docs/development-plan.md), [실행 순서](docs/implementation-sequence.md)를 참조하세요. PR 병합은 사용자가 수행합니다.
