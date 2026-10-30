# Ubuntu 운영 절차 — v0.3

실제 사용자 Ubuntu 서버에 적용할 절차다. 개발 컨테이너에서 계정 로그인이나 Tailnet 배포를 완료했다는 기록이 아니다. 처음에는 같은 OS 사용자가 관리하는 개인 서버를 대상으로 한다.

2026-10-30 실제 Ubuntu 점검은 [개발 재개 기록](implementation/ubuntu-readiness-20261030.md)에 남겼다. 당시 앱은 `.env`의 4090에서 이미 실행 중이었고 3000은 다른 서비스가 사용했다. 아래 기본 포트를 실제 값으로 가정하지 말고 현재 `.env`·수신 포트·프로세스·Serve 설정부터 읽는다. 같은 state를 사용하는 앱을 중복 실행하지 않는다.

## 1. 환경과 설치

2026-10-30 승인 후 [상시 운영·HTTPS·원격 Chrome 적용](implementation/ubuntu-services-20261030.md)을 수행했다. 앱·desktop은 systemd로 실행 중이고 linger·HTTPS 8443·인증 noVNC 입력·서비스 재시작까지 확인했다. 다른 기기·실제 호스트 재부팅·실계정 완료 판정과 구분한다.

Node.js 24.x, npm 11.x, Git, Tailscale, Chrome과 필요한 계정 권한을 준비한다. 아래 Linux 패키지는 Chrome 화면과 Codex의 비밀 경로 격리에 사용한다. Codex 실행에는 mount/PID namespace와 전용 procfs를 만들 수 있는 bubblewrap 환경이 필요하다. 통합 구현 당시 개발 컨테이너에서는 namespace 생성이 차단됐지만 2026-10-30 Ubuntu 호스트의 격리 검사는 통과했다. 새 호스트에서는 다시 확인하며 실패 시 격리를 끄고 실행하지 않는다.

```bash
sudo apt-get install xvfb x11vnc novnc websockify bubblewrap fonts-noto-cjk
npm ci
npm run build
cp .env.example .env
chmod 600 .env
npm run doctor
```

이미 `.env`가 있으면 복사로 덮어쓰지 말고 필요한 값을 보완한다. 사용자의 기존 Chrome profile을 이동하거나 지우지 않는다. 첫 지원 경로는 `WJ_CHROME_PROFILE_DIR`의 전용 persistent profile이며 그 안에서 실제 dot/Muse에 로그인한다. 기존 profile을 쓰려면 경로와 동시 사용 여부를 먼저 확인하고 같은 경로를 이 변수에 지정한다.

검증한 도구 계약은 Codex CLI 0.165.0 / Chrome DevTools MCP 1.12.0이다. 설치된 실행 파일의 절대 경로를 `.env` JSON argument array에 설정한다. npm 전역 설치 경로가 systemd PATH에 포함된다고 가정하지 않는다. 필요하면 전용 사용자 prefix에 설치한다.

```bash
npm install --prefix "$HOME/.local/share/webjjoku/tools" @openai/codex@0.165.0 chrome-devtools-mcp@1.12.0
```

`WJ_CHROME_BINARY`에 Chrome 실행 파일, `WJ_NOVNC_PORT=6080`, `WJ_CHROME_COMMAND`에 위 MCP 실행 파일과 `--browserUrl=http://127.0.0.1:9222`, `--no-usage-statistics`를 설정한다. `WJ_CODEX_COMMAND`에는 Codex 실행 파일과 `app-server`, `WJ_WORKSPACE_ROOTS`에는 실행할 저장소의 절대 경로를 넣는다. secret은 `.env`나 저장소에 두지 않고 UI 또는 별도 0600 환경 파일을 사용한다.

`npm run access-token`은 소유자 키를 터미널에 표시하는 명시적 명령이다. 공개 CI나 공유 로그에서 실행하지 않는다. 기본 state 디렉터리 밖의 별도 키 관리가 필요할 때만 `WJ_ACCESS_TOKEN` 환경 변수를 쓴다.

## 2. 서비스와 private HTTPS

`.env`의 `WJ_PUBLIC_ORIGIN`을 실제 `https://서버.테일넷.ts.net:8443` 주소로 설정한다. 8443은 예시다. 전체 DNS 이름과 선택 포트를 사용하며 Tailscale 관리 화면에서 MagicDNS·HTTPS·접근 정책을 확인한다.

```bash
npm run install:service
systemctl --user enable --now webjjoku
systemctl --user enable --now webjjoku-desktop
sudo loginctl enable-linger "$USER"
tailscale serve status
npm run serve:tailnet
```

스크립트는 지정 포트에 기존 Serve 설정이 있으면 중단한다. `serve reset`이나 Funnel을 사용하지 않는다. 수동으로 이미 같은 포트를 설정했다면 기존 경로가 loopback 앱을 가리키는지 확인하고 그대로 사용한다. origin 변경 후 `systemctl --user restart webjjoku`를 실행한다.

기존에 수동 실행한 앱이 있다면 active 토의·job을 확인하고 SQLite 백업 후 그 앱만 graceful 종료한다. state lock이 해제된 뒤 user service를 시작한다. installer는 WorkingDirectory를 systemd path directive로 기록하고 실제 Node 디렉터리를 서비스 PATH에 넣는다. Node 설치 경로가 바뀌면 unit을 다시 설치하고 `systemd-analyze --user verify`로 확인한다.

Tailscale이 Serve 미활성화를 알리면 표시된 관리 화면에서 해당 Tailnet의 Serve를 활성화한다. 이후 `serve config denied`이면 해당 hostname·HTTPS 포트·upstream을 확인한 뒤 같은 Serve 명령만 사용자 터미널에서 sudo로 실행한다. 전체 operator 권한이나 reset은 필요하지 않다.

| 경계 | 주소 |
| --- | --- |
| 사용자의 웹 UI/API/SSE/noVNC | Tailscale HTTPS 한 origin |
| 앱 | `.env`의 loopback 주소·`WJ_PORT`; 예제 기본 `127.0.0.1:3000` |
| OAuth callback | `127.0.0.1:1455/auth/callback` |
| Chrome CDP | `127.0.0.1:9222` |
| noVNC/websockify | `127.0.0.1:6080` |
| VNC/X | loopback 5901 / Unix X display `:99` |

Chrome/VNC/CDP를 Tailnet에 직접 열지 않는다. 예제 VNC는 인증된 gateway 뒤의 loopback 통로이며 같은 호스트의 다른 OS 사용자를 격리하는 제품이 아니다. 다중 비신뢰 OS 사용자가 있는 호스트에는 이 배치를 그대로 사용하지 않는다.

웹 UI에서 `수동 조작 시작` 후 서버 Chrome 화면을 연다. 기존 자동 browser turn이 있으면 끝날 때까지 수동 lease를 받을 수 없다. 수동 조작을 끝내고 자동 입력을 재개하면 VNC WebSocket은 닫힌다. 앱·브라우저·실행 작업은 웹 클라이언트 탭과 별도로 유지된다.

전용 desktop은 GNOME의 Wayland·XAUTHORITY를 상속하지 않고 Xvfb에 연결한다. X99 잠금이 있다면 소유 PID와 socket을 대조한다. 살아 있는 화면을 종료하거나 잠금을 임의 삭제하지 않는다. 확인된 stale lock은 별도 보존한 뒤 다시 시작한다. noVNC 1.6의 viewer 링크는 `/browser/vnc.html?autoconnect=1&path=websockify&resize=scale`이며 WebSocket endpoint가 `/browser/websockify`로 해석되는지 확인한다. 로컬 스케일링으로 서버 해상도 전체를 접속 기기 화면에 맞춘다. 이미 열린 viewer가 잘리면 설정 → 스케일링 모드 → 로컬 스케일링을 선택하거나 작업실을 새로고침하고 Chrome 화면을 다시 연다. Xvfb에 원격 해상도 변경을 요청하는 `resize=remote`는 기본값으로 사용하지 않는다.

## 3. 계정과 기존 대화

### GPT OAuth

`GPT 계정 추가` → `OAuth 로그인 시작` → `서버 Chrome에서 승인 화면 열기` 순서로 진행한다. callback이 Ubuntu loopback에 있으므로 다른 기기의 Chrome에서 승인 URL을 열지 않는다. noVNC로 같은 서버 Chrome에서 계정을 선택하고 로그인·동의를 완료한다. 화면에 표시된 계정 별칭/이메일을 확인하고 `모델 확인` 후 참여자를 만든다.

두 번째 계정은 별도로 등록한다. 같은 계정을 두 번 등록한 것을 두 계정 검증으로 세지 않는다. PKCE/state/nonce/issuer/audience/subject와 발급 client ID를 검증하며 refresh는 연결별로 직렬화한다. plan usage 권한이 없거나 모델 목록이 없으면 실제 응답 성공으로 표시하지 않는다. 개인 계정의 적격성이나 preview 허용을 앱이 대신 보장할 수 없다.

dot과 웹 GPT를 다른 계정으로 쓸 때는 GPT 계정 추가에서 별칭과 선택 이메일을 지정하고 `별도 로그인 창 열기`를 사용한다. 연결별 격리 context에서 열려 기존 dot 쿠키를 사용하지 않는다. 지정 이메일과 검증된 identity가 다르면 연결을 거절한다. 실제 계정 차이는 사용자가 선택한 identity로 확인하며 이름만 다르게 붙여 두 계정으로 세지 않는다.

OAuth GPT 사고 깊이는 기본 Extra high이며 Low/Medium/High로 변경할 수 있다. 등록한 토커 설정 변경은 새 토의부터 적용한다. 현재 토의는 일시정지·응답 확정 뒤 토커 카드의 사고 깊이 변경으로 이후 발언만 바꾼다. 모델이 요청값을 지원하지 않으면 오류를 확인하고 직접 조절한다. 기존 browser dot·Muse는 원래 서비스의 모델·사고 깊이를 따른다. [설정과 재검토 기록](implementation/talker-settings-rounds-20261030.md)을 참조한다.

### DeepSeek

연결 UI에 허가된 API 키를 입력하면 서버 vault에 저장하고 모델 목록을 조회한다. 입력란은 요청 뒤 비운다. 응답의 실제 usage를 사용하며 `[DONE]`만 있거나 stream이 중간 종료된 경우 완료로 간주하지 않는다. 만료된 키는 해당 연결의 `API 키 갱신`에서 교체한다.

### dot·Muse

서버 Chrome에서 실제 기존 agent 대화를 연다. `열린 페이지 확인`과 `화면 구조 확인`을 사용해 page ID, 대화 URL, 계정·agent 식별 문구와 입력/전송/사용자 메시지/AI 메시지/응답 중/준비 표시 선택자를 등록한다. 서비스별 DOM을 추정해 기본값으로 넣지 않는다.

계정·주소·입력란·완료 상태가 맞아야 연결된다. 사용자가 쓰던 초안은 덮어쓰지 않으며 각 요청의 marker/receipt와 그 뒤 응답을 대조한다. Chrome 재시작으로 page ID가 바뀌거나 DOM이 바뀌면 `페이지·선택자 갱신`을 사용한다. 기존 계정·agent·대화 주소 변경은 갱신으로 우회할 수 없다. 미확인 turn은 먼저 원래 대화에서 대조한다.

Muse의 사이드 채팅처럼 같은 주소를 사용하는 화면은 `같은 주소를 쓰는 사이드 채팅 식별`에서 실제 대화 ID와 DOM 확인 선택자·속성·선택 JSON 키를 등록한다. ID가 사라지거나 바뀌면 입력 전과 클릭 직전에 거절한다. 갱신으로 등록한 대화 ID를 변경·제거할 수 없다. 입력 후 전송 버튼이 생성되는 화면은 해당 옵션을 명시하고 실제 DOM으로 검증한다. [실제 Muse 연결 기록](implementation/muse-thread-binding-20261030.md)은 연결·참여자 등록과 실응답 완료를 구분한다.

Muse가 답했는데 앱의 receipt·본문이 비어 있으면 같은 요청을 다시 보내지 않는다. 본문 앞의 복사 제외 표시를 제거한 뒤 marker·요청 전체·thread·응답 범위를 대조한다. 이미 완료된 응답은 원래 turn의 미확정 수신 대조로 복구하고 명시적으로 재개한다. Chrome MCP 재시작 시 page ID가 달라질 수 있으므로 현재 목록을 URL·thread와 다시 맞춘다.

## 4. Codex 실행

Codex 로그인은 서버의 실행 OS 사용자 환경에서 별도로 완료한다. `WJ_WORKSPACE_ROOTS` 안의 Git 작업 디렉터리와 기존 Codex thread ID를 UI에서 등록한다. `.git` branch, canonical cwd, host, OS user와 thread metadata를 확인한다. 코드 수정은 main/master가 아닌 작업 브랜치에서만 허용된다.

bubblewrap이 지원되는 Ubuntu 사용자 환경이어야 한다. 앱 state와 Chrome profile을 작업 root와 겹치게 배치하지 않는다. 실제 user namespace/AppArmor 정책이 차단하면 우회 옵션이나 sandbox 해제를 추가하지 않고 그 호스트의 정상 허용 구성부터 확인한다. Codex 세션은 다른 CLI/앱에서 동시에 실행하지 않는다.

토의 생성 시 검증용 binding을 선택하면 `codex` 검증 제안이 실행 과제로 연결된다. 기본 queue, 명시적 steer, 소유자 승인, 실제 turn 종료, 작업 시간 한도를 사용한다. 수신 ID를 잃었을 때는 실제 세션의 turn ID를 입력해 원래 prompt·시각·종료 기록을 대조한다. 확인되지 않는 실행은 잠금을 유지하며 자동 재실행하지 않는다.

```bash
WJ_CODEX_BINARY=/실제/경로/codex npm run test:codex-contract
```

이 명령은 설치된 schema를 검사할 뿐 실제 세션이나 모델 turn을 만들지 않는다. 실세션에서는 읽기 전용 과제 → 승인 → 작은 작업 브랜치 변경 → 결과 재검토 순서로 별도 확인한다. PR 병합은 사용자가 한다.

## 5. dot MCP와 Secure MCP Tunnel

작업실의 MCP 권한은 **토의·참여자·도구 목록**에 고정된다. Codex 권한을 포함하려면 그 토의에 binding이 있어야 한다. 발급된 접근 키를 모델의 대화 본문에 넣지 않는다. 토의가 바뀌면 새 scope를 발급한다.

HTTP `/mcp`를 직접 사용할 수 있는 클라이언트는 Bearer 인증을 설정한다. dot이 private 서버에 접근할 때는 공식 Secure MCP Tunnel을 사용한다. Tailscale URL만 OpenAI에 등록해서 접근 가능하다고 가정하지 않는다.

1. Platform의 해당 조직·ChatGPT workspace에 터널을 연결하고 Read/Use(생성 시 Manage) 권한을 확인한다.
2. [공식 tunnel-client 최신 릴리스](https://github.com/openai/tunnel-client/releases/latest)와 `tunnel-client help quickstart`로 현재 설치 명령을 확인한다.
3. 토의·참여자별 grant를 로컬 0600 파일에 저장하고 `WJ_MCP_GRANT_FILE`에 경로만 넣는다. 전용 환경 파일은 `WJ_STATE_DIR` 안에 둔다.
4. `CONTROL_PLANE_API_KEY`는 로컬 보호 환경으로 전달한다. 추론용 OAuth token이나 소유자 작업실 키를 재사용하지 않는다.
5. `tunnel-client init --sample sample_mcp_stdio_local --profile webjjoku --tunnel-id 발급ID --mcp-command "node --env-file=/보호경로/tunnel.env /저장소/scripts/mcp-stdio.mjs"`로 profile을 만든다. 실제 경로에 공백이 있으면 설치된 CLI의 인자 규칙에 맞게 인용한다.
6. `tunnel-client doctor --profile webjjoku --explain`, `tunnel-client run --profile webjjoku`를 확인하고 ChatGPT에서 같은 터널을 custom MCP plugin으로 연결한다.
7. 도구 목록·자기 과제 조회·다른 참여자 접근 거절·실제 codex_send 왕복을 확인한다.

터널 프로세스는 해당 서버의 서비스 관리 아래 유지한다. 먼저 구성과 계정 왕복을 확인한 다음 보호된 environment 파일을 읽는 user unit으로 등록한다. 이 저장소가 실제 사용자의 터널·키·plugin을 이미 생성한 것은 아니다.

dot에 codex_send grant가 있으면 검증 발언 중 dot이 구체적인 prompt를 제출한다. 접수 후 Core가 실제 job 완료를 관측하고 같은 과제를 다시 검토하게 한다. 아직 설치·검증하지 않은 **MCP Events / Muse 공식 Connector는 지원 capability로 광고하지 않는다.** 이벤트와 browser 경로로 같은 turn을 이중 시작하지 않는다.

## 6. 백업과 복구

```bash
npm run backup -- /절대/경로/private-backup.sqlite
```

SQLite의 online backup API를 사용한다. 백업은 0600이며 대화·실행 내용이 있으므로 private하게 보관한다. provider credential과 vault master key는 복사하지 않는다. 복원은 서비스를 정지하고 기존 state를 별도로 보존한 뒤 SQLite 파일을 복사해 수행한다. 기존 WAL/SHM을 다른 시점 DB와 섞지 않는다. 새 vault를 쓰는 복원에서는 OAuth 계정을 다시 로그인하고 DeepSeek 키를 갱신한다. 복원된 연결 metadata의 이전 상태를 믿지 말고 각 연결에서 모델 확인과 실제 왕복을 다시 수행한다.

재시작 당시 준비/전송/실행 중이던 항목은 미확인으로 복구된다. `원본과 복구`에서 원격 대화를 대조한 뒤 완료 응답·미전송·건너뛰기를 기록하고 명시적으로 이어간다. Codex는 원래 thread/turn의 실제 결과를 조회한다. 웹 새로고침과 SSE 재연결은 추가 발언이나 실행을 만들지 않는다.

## 7. 실환경 완료 판정

아래가 모두 실제 증거를 갖추기 전에는 MVP-1/2를 PASS로 바꾸지 않는다.

- Ubuntu 버전·사용자·Node/Chrome/Codex/Tailscale 버전·경로와 private HTTPS 8443(선택 포트), 인증서·접근 제한·noVNC 입력.
- 서로 다른 GPT OAuth 2계정의 등록·권한·모델·후속 맥락·refresh·선택 로그아웃.
- DeepSeek 실제 stream/usage, dot/Muse 각각 기존 대화의 요청·후속 질문·재연결.
- 혼합 토론, 원문 근거, 반례와 이견, 조건 변경, 실제 기기 전환·서비스 재시작.
- Secure MCP Tunnel의 실제 dot 도구 호출과 등록된 Codex의 실행·승인·원격 중단·같은 근거의 참여자 재평가.

공식 참고: [ChatGPT OAuth](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Codex App Server](https://developers.openai.com/codex/app-server), [Chrome MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [MCP Events](https://developers.openai.com/plugins/build/mcp-events).
