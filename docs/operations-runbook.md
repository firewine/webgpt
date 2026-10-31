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

### 연결 삭제

삭제할 연결 카드의 `연결 삭제`를 누르고 대상과 보존 범위를 확인한 뒤 `삭제`한다. 이 서버의 연결·저장 인증 정보를 지우고 기존 대화/토커 기록과 원래 Chrome 대화는 남긴다. 원격 OAuth 권한 폐기를 뜻하지 않는다. 해당 연결이 사용 중인 방을 끄고 진행 중 토의를 완료/취소하며, 미확정 응답은 먼저 원래 기록과 대조한다. 중단된 credential 정리는 다음 정상 기동 때 외부 호출 없이 재개된다. [삭제·모델 오류 검증/복귀](implementation/connection-removal-model-errors-20261031.md)를 따른다.

### GPT 기기 코드 로그인 (Codex 계정)

`GPT · 기기 코드 로그인`에서 별칭·필수 이메일을 입력하고 시작한다. 앱에 표시된 코드로 **현재 접속 기기**의 인증 페이지에서 로그인·동의를 마친다. 서버 Chrome이나 SSH 포트 전달은 필요하지 않다. 서명·이메일·계정 ID 확인 뒤 해당 Codex 계정의 실제 모델 목록을 표시한다. 일반 GPT OAuth와 다른 연결이며 기존 dot/CLI 로그인은 가져오지 않는다. 지원 여부는 계정 보안 설정/workspace 권한에 따르고 자동 유료 테스트는 없다.

창을 닫거나 새로고침했으면 같은 계정 카드에서 원래 요청을 다시 연다. `로그인 취소`·만료·서버 재시작 뒤 새 요청은 직접 시작한다. 다른 이메일로 승인했으면 연결을 거절한다. 코드를 채팅이나 공개 로그에 붙이지 않는다. 모델 확인 뒤 같은 계정/모델로 참여자를 만들고 지원 사고 깊이를 선택한다. 이 흐름은 기존 Chrome 수동 잠금을 자동 해제하지 않는다. [실행 증거·차이·복귀](implementation/codex-device-login-20261031.md)를 따른다. 실계정/권한/추론·운영 반영은 아직 NOT_RUN이다.

### GPT 일반 OAuth

새로고침으로 승인 버튼을 잃었으면 같은 계정 카드의 `다시 로그인`으로 미만료 요청을 복구한다. 반복해 눌러도 요청·만료 시간이 새로 생기지 않는다. 진행 중 기대 이메일을 바꾸려 하면 거절한다. 서버를 재시작했거나 10분이 지났다면 새 요청의 창에서 진행한다. 계정 재등록·state 삭제로 오류를 숨기지 않는다.

`GPT 계정 추가`에서 로그인할 이메일을 반드시 입력하고 `OAuth 로그인 시작`을 누른다. 서버 Chrome 화면이 자동으로 열린다. 화면을 닫았으면 `별도 로그인 창 열기`로 다시 연다. 버튼은 기존 수동 조작 lease를 얻고 앱 안에 서버 Chrome 화면을 표시한다. callback이 Ubuntu loopback에 있으므로 다른 기기의 Chrome에서 승인 URL을 열지 않는다. 표시된 noVNC 화면에서 계정을 선택하고 직접 로그인·동의한다. `로그인 화면 닫기 · 자동 입력 재개` 후 계정 별칭/이메일과 `모델 확인`을 확인하고 참여자를 만든다. `화면만 닫기`/Escape는 자동 입력 잠금을 유지한다. 진행 중인 browser 발언이 있으면 수동 전환을 거절한다.

이 수정이 운영에 반영되기 전의 버튼은 서버 Chrome 탭만 생성한다. 기존 화면에서는 `Ubuntu Chrome → 수동 조작 시작 → 서버 Chrome 화면 열기`로 확인한다. 서버를 재시작했거나 오래된 승인 창이면 같은 연결의 `다시 로그인`으로 새 요청을 시작한다. 과거 창/URL을 계속 사용하지 않는다. [로그인 창 수정·검사 증거](implementation/oauth-login-screen-20261031.md)를 따른다.

두 번째 계정은 별도로 등록한다. 같은 계정을 두 번 등록한 것을 두 계정 검증으로 세지 않는다. PKCE/state/nonce/issuer/audience/subject와 발급 client ID를 검증하며 refresh는 연결별로 직렬화한다. plan usage 권한이 없거나 모델 목록이 없으면 실제 응답 성공으로 표시하지 않는다. 개인 계정의 적격성이나 preview 허용을 앱이 대신 보장할 수 없다.

dot과 웹 GPT를 다른 계정으로 쓸 때는 GPT 계정 추가에서 별칭과 필수 이메일을 지정하고 `별도 로그인 창 열기`를 사용한다. 연결별 격리 context에서 열려 기존 dot 쿠키를 사용하지 않는다. 지정 이메일과 검증된 identity가 다르면 연결을 거절한다. 실제 계정 차이는 사용자가 선택한 identity로 확인하며 이름만 다르게 붙여 두 계정으로 세지 않는다.

OAuth GPT 사고 깊이는 기본 Extra high이며 Low/Medium/High로 변경할 수 있다. 등록한 토커 설정 변경은 새 토의부터 적용한다. 현재 토의는 일시정지·응답 확정 뒤 토커 카드의 사고 깊이 변경으로 이후 발언만 바꾼다. 모델이 요청값을 지원하지 않으면 오류를 확인하고 직접 조절한다. 기존 browser dot·Muse는 원래 서비스의 모델·사고 깊이를 따른다. [설정과 재검토 기록](implementation/talker-settings-rounds-20261030.md)을 참조한다.

### DeepSeek

연결 UI에 허가된 API 키를 입력하면 서버 vault에 저장하고 모델 목록을 조회한다. 입력란은 요청 뒤 비운다. 응답의 실제 usage를 사용하며 `[DONE]`만 있거나 stream이 중간 종료된 경우 완료로 간주하지 않는다. 만료된 키는 해당 연결의 `API 키 갱신`에서 교체한다.

`DeepSeek 연결 → API 제공처`에서 공식 API·CoralBricks·River를 선택한다. 제공처마다 별도 연결과 해당 서비스에서 발급한 키를 사용한다. CoralBricks·River에서는 인증된 모델 목록의 DeepSeek 모델만 표시하며 목록에 없으면 임의 모델로 대체하지 않는다. 기존 연결은 공식 DeepSeek를 유지한다. 제공처를 바꾸려면 새 연결을 등록한다. 키는 채팅·문서가 아니라 이 입력란에만 넣는다. [제공처별 고정 주소·검증 범위](implementation/deepseek-services-20261031.md)를 참조한다.

모델 확인이 실패하면 카드의 원인과 HTTP 상태를 확인한다. CoralBricks가 `403 permission_denied`와 계정 검증을 요구하면 카드의 고정 [공식 billing 페이지](https://www.coralbricks.ai/organization/billing)에서 직접 확인한 뒤 **같은 연결의 모델 확인**을 누른다. 제공처 정책으로 관측된 요구이며 키를 재등록하거나 공개 모델 목록으로 대체하지 않는다. 카드 정보는 웹쫀쿠에 입력하지 않는다. 2026-10-31 사용자 검증 후 실제 모델2개/연결 정상 상태를 관측했으며 추론 검증은 별개다.

### DeepSeek 사고 깊이 · Anthropic API (2026-10-31 보완)

새 버전 빌드·재시작 뒤 기존 DeepSeek 연결 카드에서 **모델 확인**을 눌러 지원 정보를 갱신한다. `참여자 등록` 또는 `토커 설정 변경 → 사고 깊이`에서 **제공처 기본값 / None / Low / High / Max** 중 선택한다. 실제 모델이 지원하는 값만 표시하며, 지원 정보가 없으면 기본값만 표시한다. CoralBricks는 실제 모델 목록의 capability, River는 공식 문서와 일치하는 실제 모델 ID를 사용하며 화면에 출처를 구분한다. 기존 설정 부재는 기본값 그대로이며 GPT의 Extra high와 자동 변환하지 않는다.

토커 설정 변경은 새 토의/다음 상주 발언에 적용한다. 진행 중 발언은 원래 설정을 유지한다. 현재 주제 토론만 바꾸려면 일시정지하고 응답이 확정된 뒤 해당 토커의 **사고 깊이 변경**을 사용한다. 이미 완료한 발언이나 전역 토커 설정은 소급 변경하지 않는다. 기본값은 `thinking`/`reasoning_effort`를 보내지 않으며 None은 명시 비활성화다.

`참여자와 연결 → Anthropic · Claude API`에서 별칭·API 키를 넣는다. 한 workspace에 한정된 키는 Workspace ID를 생략할 수 있고 여러 workspace용 키는 사용할 ID가 필요하다. 서버는 고정 공식 API에 모델 목록을 조회한다. 카드가 오류이면 원인/HTTP 상태를 확인한다. 키 갱신은 같은 workspace를 유지하며 workspace를 바꾸려면 새 연결을 만든다. 연결된 모델을 고른 뒤 기존 토커와 같은 방법으로 방/토론에 참여시킨다. 키는 입력 후 비우고 서버 vault에만 보관한다.

Anthropic 구독 OAuth는 [승인된 범위](./reviews/deepseek-anthropic-impact-20261031.md)에 따라 보류했다. API 연결은 Claude 웹의 기존 대화/기억을 가져오지 않으며 사고 깊이 별도 설정도 이번 범위에 없다. Messages 응답의 완료/원문·receipt와 제공된 usage만 사용한다. 출력 한도 4,096토큰이며 중도 종료·`max_tokens`를 정상 완료로 표시하거나 자동 재전송하지 않는다. 장문 실제 추론 적합성·요금/계정 권한은 아직 검증하지 않았다. [구현·검사·복귀 기록](./implementation/deepseek-reasoning-anthropic-20261031.md)을 참조한다.

### dot·Muse

서버 Chrome에서 실제 기존 agent 대화를 연다. `참여자와 연결 → dot·Muse의 기존 대화 연결 → 연결할 페이지 찾기`에서 페이지·프로필과 서비스를 직접 선택한다. 이미 등록한 대화는 `기존 대화 다시 찾기` 또는 갱신할 기존 연결을 선택한다. `읽기 전용 확인` 결과의 URL·계정 식별 문구·대화 ID를 원래 화면과 대조한 뒤 확인 체크와 연결 이름으로 저장한다. 탐지 중 입력·클릭·모델 호출은 없다. 후보가 여러 개이거나 draft/busy·기존 계정/thread가 다르면 저장하지 않는다.

새 프리셋은 현재 화면의 유일한 후보와 기존 probe를 통과해야 하며 실제 dot/Muse 적합성·왕복은 아직 UNVERIFIED다. 서비스 DOM을 추정한 기본 binding으로 저장하지 않는다. 이미 검증한 수동 연결은 원래 선택자로 재탐지한다. 탐지할 수 없으면 `고급 연결 · 선택자 직접 입력`과 기존 `열린 페이지 확인`/`화면 구조 확인` 경로로 page ID, URL, 계정·agent 식별과 입력/전송/메시지/응답 중/준비 선택자를 확인한다. 초안을 지우거나 다시 로그인해서 탐지 실패를 숨기지 않는다.

계정·주소·입력란·완료 상태가 맞아야 연결된다. 사용자가 쓰던 초안은 덮어쓰지 않으며 각 요청의 marker/receipt와 그 뒤 응답을 대조한다. Chrome 재시작으로 page ID가 바뀌면 `기존 대화 다시 찾기`, DOM을 직접 점검할 때는 `페이지·선택자 갱신`을 사용한다. 변경 전 binding/선택자 이력은 비공개 DB에 보존한다. 탐지 후보는 5분 뒤 또는 서버 재시작 시 만료되어 재확인이 필요하다. 기존 계정·agent·대화 주소/thread·이미 고정한 프로필 변경은 갱신으로 우회할 수 없다. 미확인 turn은 먼저 원래 대화에서 대조한다. [페이즈 4 검증·복귀](implementation/phase4-browser-discovery-20261030.md)를 참조한다.

Muse의 사이드 채팅처럼 같은 주소를 사용하는 화면은 `같은 주소를 쓰는 사이드 채팅 식별`에서 실제 대화 ID와 DOM 확인 선택자·속성·선택 JSON 키를 등록한다. ID가 사라지거나 바뀌면 입력 전과 클릭 직전에 거절한다. 갱신으로 등록한 대화 ID를 변경·제거할 수 없다. 입력 후 전송 버튼이 생성되는 화면은 해당 옵션을 명시하고 실제 DOM으로 검증한다. [실제 Muse 연결 기록](implementation/muse-thread-binding-20261030.md)은 연결·참여자 등록과 실응답 완료를 구분한다.

Muse가 답했는데 앱의 receipt·본문이 비어 있으면 같은 요청을 다시 보내지 않는다. 본문 앞의 복사 제외 표시를 제거한 뒤 marker·요청 전체·thread·응답 범위를 대조한다. 이미 완료된 응답은 원래 turn의 미확정 수신 대조로 복구하고 명시적으로 재개한다. Chrome MCP 재시작 시 page ID가 달라질 수 있으므로 현재 목록을 URL·thread와 다시 맞춘다.

### 로컬 참고 파일과 권한 현황

로컬 자료의 허용 경로는 `WJ_MATERIAL_ROOTS` JSON 배열로 설정한다. 기본은 `[]`이며 Codex의 `WJ_WORKSPACE_ROOTS`와 별개다. 사용자가 공유할 자료만 담은 폴더 또는 개별 파일의 절대 경로를 지정하고 앱을 재시작한다. 기존 `.env`를 덮어쓰지 않는다.

~~~dotenv
WJ_MATERIAL_ROOTS=["/home/you/discussion-materials"]
~~~

새 토의 → `서버의 로컬 참고 파일`에서 허용 폴더를 탐색하거나 파일 경로를 한 줄에 하나씩 입력하고 자료 이름으로 저장한다. 선택 표시된 자료만 새 토의에 첨부한다. 폴더를 통째로 재귀 수집하지 않는다. 한 파일 최대 32 KiB, 한 토의 최대 8개·합계 64 KiB다. 폴더 탐색은 항목 100개까지이며 바이너리·비 UTF-8·보호 파일·symlink 경로·hardlink는 거절한다. 자동 발췌나 잘라내기를 하지 않는다. BOM·개행을 포함한 UTF-8 원문, raw SHA-256, 절대 경로, 수집 시각과 크기를 private SQLite에 저장한다.

토의 생성 직전에는 경로·파일 identity·해시를 다시 검사한다. 바뀌거나 없어진 원본은 새 자료로 수집해야 한다. 시작 후에는 원본이 바뀌어도 고정 사본을 모든 토커·후속 revision에 동일하게 전달한다. 실제 직렬화한 초기 prompt도 기존 180,000자 한도를 확인하며 이후 발언의 이력 포함 한도는 계속 적용한다. API `/api/state`에는 자료 메타데이터만 포함하고 토의의 근거에는 선택한 전체 원문을 보존한다. 수집·토의 생성의 같은 idempotency key는 기존 결과를 반환하며 원본 변경이 재수집·재실행 사유가 되지 않는다.

선택 파일의 내용은 해당 토의의 참여 AI에 전달되고 대화 DB·백업·내보내기에 남는다. 파일명·경로 보호는 임의의 일반 문서 안에 들어 있는 모든 비밀을 탐지하는 기능이 아니므로 사용자가 공유할 내용을 선택한다. 파일 쓰기 권한은 부여하지 않는다. 원본 삭제·자료 자동 삭제도 수행하지 않는다.

`참여자와 연결 → 현재 연결과 권한 현황 → 권한 현황 확인`은 `GET /api/capabilities`를 사용한다. OS, 설정한 실행 파일의 `--version` 관측, 허용 경로, 읽기·쓰기·네트워크 정책, 기록된 연결·실행·승인 대기를 표시한다. 버전 관측은 실제 계정·모델·namespace·Codex job 성공의 증거가 아니다. Codex App Server의 인증용 호스트 네트워크와 명령의 turn sandbox 네트워크 금지 정책을 구분한다. `npm run doctor`에도 읽기 자료 설정 개수를 표시한다.

새 UI grant는 `capabilities_get`을 포함한다. 기존 grant의 도구 목록은 자동 확대하지 않는다. 이 도구는 배정된 pending task가 없어도 해당 토의·참여자의 상태를 읽는다. 다른 계정·전역 허용 root·다른 참여자 job·thread·명령 출력·승인 본문은 반환하지 않는다. Codex 도구가 없는 grant에는 binding·job·Codex 실행 정책을 노출하지 않는다. 조회는 권한을 생성하거나 늘리지 않는다.

### 열린 작업큐·역할·분석 산출물 (페이즈 5)

채팅방 오른쪽 작업실 보드에서 **업무 역할·범위**를 열고 기존 참여자에게 역할·업무 종류·허용 범위를 직접 배정한다. 표시용 역할 문구와 연결 계정·원래 Chrome 대화는 그대로다. 배정이 없는 실제 참여자에게 기본 업무 권한을 만들지 않는다.

대화의 **일감 만들기** 또는 보드의 **일감 제안**에서 공개 발언·수용 기준·허용 참여자·범위·선행 일감을 정한다. 조건 미비/선행 대기는 대기 이유를 보존한다. 방이 켜지고 기존 예산·속도·슬롯을 만족하면 분석 업무와 다른 참여자의 검토를 순차 진행한다. 방 off는 새 픽업/발언을 막고 기록을 남긴다.

서버의 문구 포함 검사는 산출물 형식 검사다. 직접 확인 기준은 AI가 완료라고 말해도 자동 통과하지 않으며, 소유자가 산출물·근거를 읽고 독립 검토에서 직접 확인한다. 반려하면 이전 보고/검토를 남기고 새 attempt로 재작업한다. 코드 업무와 실행 근거 기준은 아래 페이즈 6의 등록 세션·권한·관측 조건을 추가로 확인한다.

미확정 업무는 **일감·보고·검토 → 원래 요청·응답 대조**에서 기존 receipt를 확인한다. 새로고침·timeout만으로 다른 참여자의 새 attempt를 만들지 않는다. 역할/일감이 다른 화면에서 바뀌면 새 상태를 다시 열어 CAS 충돌을 해결한다. 복귀/업그레이드는 G0에 따라 진행·미확정을 먼저 대조하고 기존 큐·보고·명령 기록을 보존한다. [R5 실행·수락·이관 기록](./implementation/phase5-open-work-queue-20261030.md)을 따른다. 실계정의 업무 수행·운영 DB 이관은 아직 미검증이다.

### 작업큐의 Codex 실행·보고 (페이즈 6)

아래 Codex 절차로 **읽기 전용** binding을 등록한 뒤, 역할·범위에서 해당 참여자에게 Codex 업무 종류와 그 등록 작업 공간을 명시 배정한다. 방 설정의 실행 한도도 직접 정한다. 기존 설정·역할을 자동 확대하지 않으며, `allowWrite` binding은 저장소 비밀·링크·출력 가림 gate 미검증으로 큐에서 대기한다. 기존 단독/토의 실행 정책과 별도로 적용하는 새 업무 경계다.

공개 발언의 **일감 만들기 → Codex 읽기 전용 실행**에서 작업 공간·담당자·수용 기준을 선택한다. 방 on·선행 조건·실행 한도를 만족하면 원래 입력과 안정된 request ID를 먼저 기록하고 기존 executor로 보낸다. 작업 상세의 **Codex 실행**에서 요청/turn/명령·종료 상태·승인·오류를 확인한다. **이번 실행 요청 승인**은 현재 방·역할·scope·업무 버전을 다시 검사한다. 바뀌었으면 승인하지 않고 원래 요청을 보존한다.

방 끄기/업무 취소와 실제 job 중단은 별도다. 이미 시작한 실행은 **이 실행만 중단 요청**을 사용하며 원격 종료 관측 전에는 중단 완료가 아니다. 미확정은 **원래 Codex 실행 대조**로 원래 turn을 확인한다. receipt를 잃었다면 서버의 원래 thread/input/시각과 일치하는 실제 turn ID를 사용한다. 새로고침·timeout만으로 새 job/다른 담당자로 재전송하지 않는다.

제출 전 조건이 바뀌었고 job과 submit 영수증이 모두 없으면 **미전송**으로 기록한다. 원래 입력·한도 예약·알림은 보존하며 사용자가 일감을 보완한 뒤 다시 켜야 새 attempt를 만든다. 영수증이 있는데 job이 없거나 입력이 다르면 미전송으로 추정하지 않고 복구를 차단한다. 해당 DB/원래 실행 기록을 먼저 대조하며 state 삭제·새 job으로 우회하지 않는다.

`completed`만으로 업무 완료나 검사 성공을 확정하지 않는다. 실행 기준은 실제 journal의 명령·정수 exit 상태를 사용하고, 없거나 잘린 근거는 not_run/unknown이다. 읽기 전용 업무의 파일 변경 보고는 원문을 보존하고 완료를 막는다. 다른 참여자 검토·수용 기준이 충족돼야 done이며 반려는 이전 보고·명령 근거·검토 의견을 포함한 새 attempt다. off/회수/이전 버전 결과는 owner 상세에 남기되 현재 산출물로 수락하지 않는다. Codex token 사용량은 수신 근거가 없어 미확인으로 표시한다.

입력은 기존 executor의 30,000자 제한을 지킨다. 여러 공개 원문/재작업 자료가 넘으면 원문을 자르거나 호출하지 않고 일감 범위 보완을 기다린다. 업무의 입력 변경은 원래 실행 대조 후 반려/새 시도로 남긴다. 기존 단독/토의 job의 steer는 그대로다. 운영/다운그레이드는 반드시 G0의 queued 취소·진행/승인/미확정 대조 뒤 수행한다. flag off만으로 예전 executor의 queued 자동 재개를 안전하다고 가정하지 않는다.

[R6 구현·fixture·복구 기록](./implementation/phase6-work-execution-20261030.md)을 따른다. 설치 schema와 fixture PASS는 실제 사용자 세션의 읽기→승인→작업 브랜치 쓰기 성공이 아니다. R6-F 실세션과 쓰기 격리는 NOT_RUN/UNVERIFIED이며 이번 변경을 운영 서비스에 자동 반영하지 않았다.

### 공유 Wiki·고정 인용·상주 MCP (페이즈 7)

채팅방 오른쪽 작업실 보드의 **공유 Wiki**에서 문서·변경 기록·출처·폐기·충돌을 확인한다. **Wiki 문서 작성**은 범위·slug·제목·본문·공개 출처를 명시한다. 허용된 참여자는 같은 범위에 `wiki_edit` 구조화 intent 또는 별도 resident MCP 도구로 편집하며 매 편집마다 별도 승인을 요구하지 않는다. 방이 꺼졌을 때는 소유자 편집/조회만 가능하고 참여자 변경·새 발언/픽업은 차단한다.

수락한 새 업무 보고는 원래 attempt 범위의 Wiki에 자동 투영된다. 기본 **최신 버전 자동 선택**은 허용 Wiki를 다음 발언·업무·주제 입력에 포함한다. 특정 버전을 고정하려면 문서의 **이 버전을 대화에 고정**을 사용한다. 하나라도 명시 선택하면 선택한 버전만 사용하며, 전부 해제한 빈 선택은 Wiki 입력 없음이다. **최신 버전 자동 선택으로 전환**으로 자동 선택을 복원한다. 자동/고정 모두 이미 시작한 turn·WorkAttempt·topic 입력은 바꾸지 않는다. 말풍선의 Wiki 인용은 입력에 사용한 버전·digest의 추적이며 독립 검증 성공 표시가 아니다.

동시에 같은 버전을 편집하면 한 편집만 게시하고 다른 원문은 **충돌 제안**으로 남기며 HTTP409를 반환한다. 폼의 원문을 유지한 채 변경 기록에서 충돌과 현재 head를 읽고 **현재 버전을 기준으로 조정**한다. 오래된 폼의 expectedVersion을 자동으로 올려 덮어쓰거나 중복 제출하지 않는다. 폐기는 이유·출처가 있는 tombstone 버전을 추가한다. 과거 본문/고정 인용은 남으며 기존 고정을 자동 변경하지 않는다.

Wiki 본문은 문서당 20,000자, 출처 1~20개, 입력 선택은 최대8문서·직렬화 60,000자다. 목록/이력은 최대50개씩 조회한다. 초과 시 `wiki_context_requires_selection`로 차단하며 고정 선택을 줄인다. 이미 claim한 업무는 원래 입력으로 진행한다. 새 업무의 Wiki 조건이 막히면 해당 업무만 blocked로 남기며 다른 허용 업무는 계속 가능하다. 조건을 해결한 뒤 기존 일감 편집으로 범위/조건을 확인해 재개한다. 과거 project Wiki가 들어간 대화에서 해당 권한을 회수하면 `wiki_context_requires_handoff`로 새 전송을 막는다. 허용 Wiki 선택을 확인한 뒤 기존 문맥 인계로 새 세대를 만든다. 원래 이력은 삭제하지 않는다.

Wiki는 항상 **reported** 지식이다. report source의 관측 근거는 별도로 표시하며 모델의 verified 문구로 승격하지 않는다. sourceRefs는 같은 방의 공개 메시지·같은 범위의 수락한 보고·허용된 고정 Wiki 버전뿐이다. 비공개 초안/다른 계정 이력/임의 파일·URL을 source로 가져오지 않으며 본문의 HTML/script/주소는 일반 텍스트다. Wiki를 작성했다고 파일/네트워크/도구 권한이 생기지 않는다.

**참여자 MCP 권한**에서 참여자·현재 업무 범위·도구·만료 시각을 직접 선택한다(최대7일). 새 키는 room/project/참여자·seat version·epoch·contextGeneration·계정 identity에 고정된다. 역할/멤버/세대/epoch가 바뀌거나 만료·회수되면 조회와 변경을 거절한다. 필요하면 현재 범위를 검토해 새 키를 발급한다. 키는 한 번만 표시하고 창을 닫으면 화면에서 지운다. owner 로그인 키나 기존 토의 grant와 혼용하거나 채팅·Wiki·공개 로그에 붙이지 않는다.

새 `/mcp` 도구는 `resident_context_get`, `resident_message_post`, `resident_work_list`, `resident_work_propose`, `resident_work_claim`, `resident_wiki_list`, `resident_wiki_get`, `resident_wiki_edit`다. 실제 작업 시작은 기존 큐가 담당하며 도구 키가 Codex 승인 권한을 주지 않는다. 기존 토의 키의 도구 목록·토의/참여자 범위는 그대로다. 실제 Secure MCP Tunnel/공식 Connector 연결 성공은 별도 검증이며 이 화면에서 자동 생성하지 않는다.

이관은 기존 resident JSON에 optional `wikiSchemaVersion=1`과 기존 빈 배열을 사용하며 기존 계정/대화/개인 기억을 Wiki로 복사하지 않는다. 세대 없는 옛 resident fixture grant는 폐기 상태로 보존한다. 운영 반영/복귀는 G0와 [R7 실행·수락·롤백 기록](./implementation/phase7-shared-wiki-20261031.md)을 따른다. 신규 grant 회수·예약 중지·진행/미확정 대조 후 flag off로 읽기만 남기며 Wiki/충돌/영수증을 삭제하거나 옛 DB로 되돌리지 않는다. 이번 단계의 실제 운영 DB 이관·계정 호출·서비스 재시작은 NOT_RUN이다.

### 통합 수락과 운영 반영 전 점검 (페이즈 8)

[R8 실행 기록](./implementation/resident-acceptance.md)과 [50개 수락 manifest](./implementation/resident-acceptance-manifest.json)를 먼저 본다. Node270/실제 Chrome·MCP46의 최종 통합 회귀의 fixture 성공은 운영 배포·실계정·실기기·실제 쓰기의 완료가 아니다. 현재 실운영 전체 수락은 미완료다. [승인된 B안](./reviews/r8-topic-transition-decision-20261031.md)에 따라 방을 끈 뒤 설정에서 `참여자의 주제 토론 자동 시작 허용`을 명시 선택할 수 있다. 기존 방은 기본 꺼짐이다. 켜진 방에서 참여자의 공개 근거 제안이 현재 계정/세대/예산 검사를 통과하면 기존 주제 토론을 시작하고 같은 방으로 돌아온다. 업무/실행·승인/미확정·다른 root가 있으면 대기한다. 오래된 맥락/권한의 제안은 재실행하지 않고 원문과 거절 이유를 보존한다.

자동 검증은 `npm run check`와 설치된 Chromium/MCP 경로를 지정한 `npm run test:browser`다. 임시 DB/프로필·모의 계정을 사용하며 `test-results/resident/R8`에 흐름/rollback/handoff/load/2탭 JSON과 화면을 남긴다. source1,000메시지·업무100·Wiki100의 50개 요청 page/원문 대조/transaction 비용은 fixture 측정값이며 장기 운영 용량 보장이 아니다. 기본 명령에서 MCP를 생략해 SKIP됐으면 전체 통과라고 적지 않는다.

실제 운영 반영 전에는 G0에 따라 방 off·topic pause·queued 미전송 취소와 진행/승인/미확정 receipt 대조를 완료한다. 기존 .env/접속 키·대화 DB·계정·Chrome profile을 보존하고 해당 작업실의 소스만 사용자 병합 main으로 갱신·빌드한다. 상주 기능은 `WJ_RESIDENT_ENABLED=true`를 명시한 뒤 기존 webjjoku 서비스 재시작으로 반영한다. 예산/속도·멤버/업무 역할은 기존 UI에서 직접 선택한다. 기존 origin/포트·Tailscale Serve·다른 서비스 설정은 바꾸지 않는다. 이번 개발에서 운영 반영/재시작을 실행한 것은 아니다.

R8-D 실수락은 사용자가 연결 화면에서 GPT2계정 OAuth·DeepSeek·dot/Muse 기존 대화·Codex 읽기 전용 세션을 준비하고 실제 호출을 허용한 뒤 수행한다. 로그인·모델 목록·후속 응답·stream/usage·thread/receipt·독립 검토를 각각 관측한다. 계정/메시지 내용은 공개 증거에 복사하지 않고 식별자/상태·허용된 검사 근거만 남긴다. 실기기의 HTTPS·IME/터치·재접속/재시작과 실제 쓰기 격리도 별도 gate다. 실제 쓰기는 기존 UNVERIFIED 차단을 해제하지 않는다.

이번 읽기 전용 운영 점검에서는 OAuth auth_required·browser 연결1로 dot/Muse 두 연결 미충족·DeepSeek/Codex 미등록·상주 flag off/미이관 상태를 확인했다. 이를 실패를 숨기기 위한 초기화·모의 계정 치환으로 해결하지 않는다. 준비 전 R8-D는 NOT_RUN이며 미확인 gate를 PASS로 바꾸지 않는다. 복귀는 새 예약을 막고 원래 실행을 대조한 뒤 flag off/read-only로 전환하며, Wiki/commands/영수증을 지우거나 옛 DB를 덮어쓰지 않는다.

## 4. Codex 실행

Codex 로그인은 서버의 실행 OS 사용자 환경에서 별도로 완료한다. `WJ_WORKSPACE_ROOTS` 안의 Git 작업 디렉터리와 기존 Codex thread ID를 UI에서 등록한다. `.git` branch, canonical cwd, host, OS user와 thread metadata를 확인한다. 코드 수정은 main/master가 아닌 작업 브랜치에서만 허용된다.

bubblewrap이 지원되는 Ubuntu 사용자 환경이어야 한다. 앱 state와 Chrome profile을 작업 root와 겹치게 배치하지 않는다. 실제 user namespace/AppArmor 정책이 차단하면 우회 옵션이나 sandbox 해제를 추가하지 않고 그 호스트의 정상 허용 구성부터 확인한다. Codex 세션은 다른 CLI/앱에서 동시에 실행하지 않는다.

토의 생성 시 검증용 binding을 선택하면 `codex` 검증 제안이 실행 과제로 연결된다. 기본 queue, 명시적 steer, 소유자 승인, 실제 turn 종료, 작업 시간 한도를 사용한다. 수신 ID를 잃었을 때는 실제 세션의 turn ID를 입력해 원래 prompt·시각·종료 기록을 대조한다. 확인되지 않는 실행은 잠금을 유지하며 자동 재실행하지 않는다.

```bash
WJ_CODEX_BINARY=/실제/경로/codex npm run test:codex-contract
```

이 명령은 설치된 schema를 검사할 뿐 실제 세션이나 모델 turn을 만들지 않는다. 실세션에서는 읽기 전용 과제 → 승인 → 작은 작업 브랜치 변경 → 결과 재검토 순서로 별도 확인한다. PR 병합은 사용자가 한다.

## 5. dot MCP와 Secure MCP Tunnel

기존 작업실 MCP 권한은 **토의·참여자·도구 목록**에 고정된다. Codex 권한을 포함하려면 그 토의에 binding이 있어야 한다. 페이즈 7 상주 도구는 위의 별도 resident grant만 사용하며 기존 키를 확대하지 않는다. 발급된 접근 키를 모델의 대화 본문에 넣지 않는다. 토의가 바뀌면 새 scope를 발급한다.

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
