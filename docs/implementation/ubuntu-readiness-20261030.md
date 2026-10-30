# Ubuntu 개발 재개 준비와 실제 관측 기록

- 점검일: 2026-10-30 (KST)
- 대상: 사용자 Ubuntu의 `/home/firewine/webgpt`
- 점검한 소스: `ad88ef680e114070b90b909890d5d6b3a11a308d` / webjjoku 0.2.0
- 작업 브랜치: `codex/ubuntu-readiness-20261030`
- 판정: 개발 재개 준비·로컬 로그인·모의 토론 PASS. 실계정 MVP-1 / 실세션 MVP-2 NOT_RUN.

이 기록은 2026-10-30 사용자 핸드오프를 실제 Ubuntu에서 대조한 결과다. 기존 구현을 사용했고 새 프로젝트나 UI를 만들지 않았다. 이전 통합 구현의 범위는 [WJ-002~015 기록](wj-002-015.md), 다음 운영 작업은 [운영 절차](../operations-runbook.md)를 따른다.

## 저장소와 세션

PR #5는 2026-10-30 08:35:34 KST에 병합됐다. GitHub API와 실제 Git 원격의 `main`이 모두 위 점검 SHA를 반환했다. merge commit의 별도 `workspace` Check도 `success`로 확인했다: [main CI](https://github.com/firewine/webgpt/actions/runs/40974190020). 이전 PR head의 CI와 구분한다.

핸드오프의 `01a18594-15cd-7336-acd9-085cf5b5c0a4`는 이 Ubuntu의 `~/.codex/sessions`, `archived_sessions`, `state_5.sqlite`의 threads에서 찾지 못했다. 현재 개발 세션의 환경 변수는 `01a18a22-7156-7ef1-8f7a-f373c8008b60`을 가리킨다. 전달받은 ID를 웹쫀쿠 실행 바인딩으로 등록하지 않았다. 현재 개발 세션도 사용 중이므로 웹쫀쿠가 동시에 재개할 대상으로 삼지 않는다.

시작 당시 tracked 파일 변경은 없었고 기존 미추적 파일 35개가 있었다. `.codex/`, `.serena/`, `docs/phase-0/`, 추가 ADR·schema·spike·스크립트를 포함한다. 이 파일들의 내용 해시를 별도로 대조해 보존했으며 이번 변경에 포함하지 않는다. 특히 과거 미추적 Phase 0 문서와 `.codex/tasks/current.json`은 이번 사용자 핸드오프나 병합된 현재 계획의 상태를 대신하지 않는다.

## 실제 호스트와 실행 상태

| 항목 | 실제 관측 |
| --- | --- |
| 호스트 / OS 사용자 | `firewine-X600` / `firewine` |
| OS / architecture | `/etc/os-release`: Ubuntu 26.04.1 LTS / x86_64 |
| Node / npm | 24.18.0 / 11.16.0, nvm 설치 |
| Codex | 0.165.0, `/home/firewine/.nvm/versions/node/v24.18.0/bin/codex` |
| Google Chrome | 156.0.8078.47, `/usr/bin/google-chrome` |
| Tailscale / bubblewrap | 1.102.4 / 0.11.1 |
| 기존 앱 | PID 336200, 2026-10-30 08:48:32 KST 시작, `127.0.0.1:4090` |
| 앱 설정 | `WJ_HOST=127.0.0.1`, `WJ_PORT=4090`, `WJ_PUBLIC_ORIGIN=http://127.0.0.1:4090` |
| 3000 포트 | 다른 서비스가 사용 중. 종료·설정 변경 없음 |
| 3010 포트 | 이 점검 시 수신 프로세스 없음. 앱 설정으로 사용하지 않음 |
| state / Chrome profile | 기본 `~/.local/state/webjjoku`, `~/.local/share/webjjoku/chrome` |
| Chrome profile | 점검 시 빈 디렉터리. 기존 profile 이동·초기화 없음 |
| OAuth callback | 설정상 loopback 1455, 실제 OAuth 인증 NOT_RUN |
| 공개 출처 조회 | `WJ_SOURCE_FETCH=true` |
| Codex 작업 경로 | `WJ_WORKSPACE_ROOTS=[]`, 실행 바인딩 0개 |
| 웹쫀쿠 서비스 | `webjjoku.service`, `webjjoku-desktop.service` 모두 미등록 |
| 로그아웃 유지 | `loginctl show-user firewine -p Linger`: `Linger=no` |
| Tailscale | Running, Self Online, MagicDNS 활성, Health 빈 목록 |
| Tailscale Serve | `tailscale serve status --json` 결과 `{}`. HTTPS 배치 NOT_RUN |
| 원격 Chrome | Chrome MCP 명령·noVNC 포트 미설정. `Xvfb` 있음, `x11vnc`·`websockify` 없음 |

이전 Ubuntu 24.04.4 / Codex 0.153.4 / 앱 3010 안내는 현재 값으로 사용하지 않는다. Tailscale DNS 이름은 실제 Self 정보로 확인했으나 private 주소를 이 공개 기록에 복사하지 않았다.

샌드박스 안에서는 `ss`, user systemd bus, loopback HTTP, Tailscale daemon socket 접근이 차단됐다. 해당 읽기를 실제 호스트 권한으로 다시 실행해 위 결과를 확인했다. 제한된 실행에서 `npm run doctor`가 출력한 `NOT_RUNNING`은 실제 앱 중단 증거가 아니며, 호스트에서 다시 실행한 doctor는 정상 health를 반환했다.

## 실제 검증 결과

| 검증 | 판정 | 관측 범위 |
| --- | --- | --- |
| 기존 앱 health | PASS | `GET http://127.0.0.1:4090/health`: `status=ok`, `mode=workspace`, `persistence=sqlite` |
| 소유자 로그인 | PASS | 실제 키를 로컬 파일에서 메모리로 읽어 임시 Chrome의 로그인 폼에 입력. 키·쿠키 출력 없음 |
| 실제 앱 모의 토론 | PASS | fake-a/b 2명, independent → cross_review → verification → revision → synthesis → summary_review, 발언 12개, completed |
| 결과 비교·재접속 | PASS | 참여자 비교 패널 2개, 모의 결과 표시, 새로고침 후 동일 토의·완료 상태 복구, page error 0 |
| TypeScript·빌드·Node 회귀 | PASS | `npm run check`: 39 PASS / 0 FAIL / 0 SKIP |
| UI·DOM 브라우저 회귀 | PASS | 시스템 Chrome 156: 3 PASS / 0 FAIL, MCP 검사 1 SKIP |
| 추가 실제 Chrome MCP 검사 | PASS | 별도 설치한 1.12.0으로 생략된 검사만 실행: 1 PASS / 0 FAIL / 0 SKIP. 실제 MCP·page ID·DOM 입력·receipt 왕복 |
| 설치된 Codex schema | PASS | `npm run test:codex-contract`: 0.165.0 App Server 계약 일치. 모델·thread 실행 없음 |
| 호스트 bubblewrap 격리 | PASS | 앱과 같은 mount/PID 옵션·전용 procfs·state/profile tmpfs. 호스트와 PID namespace ID 다름, 호스트 PID 비노출, 두 보호 디렉터리 비어 있음 |
| 실제 GPT·DeepSeek·dot/Muse | NOT_RUN | 점검 전 연결 0개. 실계정·API 키를 임의 선택하거나 기존 Codex 인증을 대체 사용하지 않음 |
| 실제 Codex 세션·결과 환류 | BLOCKED | 핸드오프의 thread가 이 호스트에 없고 실행 바인딩·허용 경로 미설정. 모델 호출 없음 |
| Tailnet의 다른 기기·HTTPS·재부팅 | NOT_RUN | Serve·서비스 설치 전 상태 |
| Tunnel·MCP Events·Muse 공식 Connector | NOT_RUN | 실제 권한·capability·왕복 미검증, 기존 비활성 상태 유지 |

브라우저 기본 명령은 요구하는 Playwright headless shell build 1234가 없어 3 FAIL / 1 SKIP이었다. 브라우저 다운로드 대신 이미 설치된 Chrome 실행 파일을 명시해 위 결과를 얻었다. MCP가 없는 3 PASS / 1 SKIP을 전체 4 PASS로 적지 않는다. 추가 MCP 단독 검사까지 합쳐 서로 다른 브라우저 검사 4개를 확인했다.

bubblewrap 최초 진단은 자식이 PID 1이어야 한다는 잘못된 조건으로 실패했다. bwrap의 보조 프로세스를 고려해 PID namespace ID와 호스트 PID 비노출을 직접 비교하도록 진단을 바로잡았고 네 조건이 모두 통과했다. 제품 코드나 OS 격리 정책은 변경하지 않았다.

현재 호스트에서 재현한 브라우저 검사 명령:

```bash
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:browser

# 임시 도구 설치: 프로젝트 package.json/lockfile·전역 설치를 변경하지 않음
npm install --prefix /tmp/webjjoku-readiness-tools-20261030 --ignore-scripts --no-audit --no-fund chrome-devtools-mcp@1.12.0
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/tmp/webjjoku-readiness-tools-20261030/node_modules/.bin/chrome-devtools-mcp \
node --test tests/browser/mcp-contract.test.mjs
```

`/tmp` 설치는 재부팅 후의 운영 도구 설치로 간주하지 않는다. 운영 연결에는 사용자 전용 설치 경로와 절대 실행 경로가 필요하다. 모든 자동 검사·추가 MCP 검사는 실제 provider 계정이나 과금 모델을 사용하지 않았다.

## 보존과 이번 변경

- 기존 앱을 재시작·중복 실행하지 않았고 `.env` 내용, 대화 DB, 소유자 키, vault, Chrome profile을 초기화하지 않았다. `.env` 파일 권한만 `0664`에서 운영 절차의 `0600`으로 조정했다.
- 소유자 로그인 세션과 위 모의 토의 1개가 기존 앱 DB에 정상 추가됐다. 자동 삭제하지 않았다. 토의 ID는 `discussion_abfacbf0-6aff-4339-9796-7589d21ea243`이다.
- 모의 결과 화면은 로컬 `test-results/ubuntu-live-comparison-20261030.png`에 보관했다. 이 디렉터리는 Git에서 제외되며 credential 화면을 저장하지 않았다.
- 기존 미추적 35개 파일을 이번 PR에서 제외한다. 이번 저장소 변경은 실환경 기록과 이를 가리키는 개발·운영 문서다.
- systemd, linger, Serve, OS 패키지, 기존 전역 Codex·Chrome, 실제 계정 설정은 바꾸지 않았다. PR 병합은 사용자 담당이다.

## 바로 이어갈 작업

1. 4090의 단일 기존 앱을 기준으로 서버 Chrome 경로를 준비한다. `x11vnc`, noVNC, websockify와 지속 설치한 Chrome MCP가 필요하다. 비어 있는 전용 profile을 사용하되 기존 profile을 쓸 경우 경로·동시 사용을 먼저 확인한다.
2. 기존 앱의 실행 소유권을 확인해 graceful 종료 후 systemd로 인계한다. nvm의 Node 절대 경로, `.env`, 같은 state를 사용한다. user service·desktop·linger와 선택한 private HTTPS upstream 4090을 검증한다. Tailscale Self.DNSName과 비어 있는 HTTPS 포트를 다시 읽고 origin을 정한다. 다른 서비스를 reset하지 않는다.
3. 서버 Chrome에서 사용자 직접 로그인·동의가 필요하다. GPT 첫 계정의 모델·완료 응답·후속 맥락을 확인한 다음 서로 다른 두 번째 계정과 refresh 격리를 확인한다. DeepSeek 키는 연결 UI에 입력하고 채팅·문서로 받지 않는다.
4. 사용자가 지정한 실제 dot/Muse의 기존 대화 URL·계정·agent·page ID·DOM을 대조한다. 기존 초안과 불확실 전송을 보존하며 실계정 혼합 토론으로 MVP-1을 판정한다.
5. Ubuntu에 실제 존재하고 다른 클라이언트가 사용하지 않는 Codex thread/cwd를 확인한다. 허용 workspace·절대 Codex 실행 경로를 설정한 뒤 읽기 전용 과제 → 승인 → 작업 브랜치의 작은 수정 → 결과 환류를 검증한다. 현재 활성 개발 세션과 전달받은 부재 ID를 자동 선택하지 않는다.
6. 실계정 권한이 준비되면 공식 Tunnel·MCP Events·Muse Connector의 현행 문서와 계정 capability를 다시 확인한다. 이 점검에서는 최신 공식 기능 지원을 새로 판정하지 않았다.

실제 사용자 조작이 필요한 것은 계정 로그인·동의, 허가된 DeepSeek 키 입력, 기존 dot/Muse 대화 지정, 실행할 유휴 Codex 세션 지정이다. 서버 준비와 독립 개발은 별도로 계속할 수 있다. 미검증 연결을 fixture 결과로 완료 처리하지 않는다.
