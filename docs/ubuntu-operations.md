# 웹쫀쿠 Ubuntu 서버·웹 접속 운영 계획

| 항목 | 값 |
| --- | --- |
| 상태 | Draft v0.2 — 배포·실기기 검증 NOT_RUN |
| 개정일 | 2026-10-29 (KST) |
| 상위 계획 | [development-plan.md](./development-plan.md) |
| 실행 연동 | [Codex 세션 실행 계획](./codex-session-plan.md) |
| 사용자 확정 방향 | Ubuntu 서버 상시 실행, Tailscale이 설치·연결된 허용 기기의 브라우저에서 공동 대화·검증·비교 |
| 참여자 / 대화 | [OAuth·API·browser 연결](./participant-connections.md) / [능동 토론](./discussion-plan.md) |
| 초기 포트 예시 | Tailnet HTTPS 8443 → 서버 loopback HTTP 3000 |

## 1. 운영 배치

| 구성요소 | 위치·책임 | 지속 상태 |
| --- | --- | --- |
| Core / Control Room / gateway | Ubuntu 서버, 주제·발언·검증 배정·공동 대화·비교 | Discussion·Turn·Claim·Evidence·Task·Event DB |
| OAuth/API runtime | Ubuntu, GPT 계정별 OAuth·DeepSeek 등 모델 요청 | credential 참조·참여자별 이력·usage; secret은 보호 저장소 |
| Chrome / 가상 데스크톱 | 같은 Ubuntu 서버, dot·Muse의 실제 로그인·대화 | 사용자 소유 persistent profile |
| Browser Bridge | Chrome이 실행되는 Ubuntu, 서비스별 UI 입력·관측 | 계정·대화 바인딩과 송수신 journal |
| Codex 실행기 | Ubuntu의 등록된 실행 사용자·프로젝트 환경 | 기존 Codex 세션과 실행 job 기록 |
| noVNC / WebSocket proxy / VNC 서버 | 동일 Chrome이 보이는 가상 데스크톱 | 재로그인·Chrome 연결 승인·수동 개입 |
| Tailscale Serve | Ubuntu, 웹 클라이언트용 TLS 종단과 private reverse proxy | Tailnet HTTPS 설정과 접근 정책 |
| MCP / tunnel-client | Ubuntu, dot의 공식 도구 호출 연결 | 권한·구독·job 매핑; secret은 별도 보호 |
| 사용자 웹 브라우저 | Tailscale이 연결되고 접근이 허용된 PC·노트북·휴대전화·태블릿 | 화면·입력·일시적인 조회 cursor |

Ubuntu를 첫 지원 OS로 고정한다. 정확한 Ubuntu 릴리스·CPU architecture·Node·Chrome·Codex·Tailscale 버전은 Phase 0의 실제 서버 점검으로 기록한다. 기존 Linux x86_64 계획은 초기 후보이며 다른 architecture를 지원한다고 추정하지 않는다. macOS 서버 이식은 후속 확장이다. Mac에서 브라우저로 Ubuntu에 접속하는 기능은 첫 웹 UI 범위이며 서버 OS 적합성과 클라이언트 호환성을 혼동하지 않는다.

Core·bridge·실행기·가상 데스크톱은 systemd 등 서버의 서비스 관리 아래 동작하도록 한다. 관리 수단과 실행 OS 사용자는 구현 ADR에 고정한다. 웹 클라이언트 웹 페이지, SSH 로그인 셸, noVNC 연결의 수명에 서버 작업을 종속시키지 않는다.

## 2. Tailscale 기기의 HTTPS 웹 접속

Tailscale Serve로 사용자 Tailnet 안에 관제실을 제공한다. 첫 구성은 다음과 같다. 포트는 배포 시 충돌과 접근 정책을 확인해 확정한다.

| 경계 | 예시 | 공개 범위 |
| --- | --- | --- |
| 웹 클라이언트 접속 | 서버의 전체 `*.ts.net` 이름 + HTTPS 8443 | 허용된 Tailnet 사용자·기기 |
| Core / gateway | `127.0.0.1:3000` | 서버 내부 |
| noVNC / WebSocket proxy | `127.0.0.1:6080` 예시 | gateway 뒤의 서버 내부 |
| VNC·Chrome 제어·Codex RPC | 로컬 socket/stdio 또는 loopback | 웹 클라이언트에 직접 노출하지 않음 |

### 2.1 준비와 운영 예시

1. Ubuntu와 접속할 기기를 사용자의 Tailscale 네트워크에 등록한다. 태블릿은 예시이며 전용 단말이나 별도 앱을 요구하지 않는다.
2. MagicDNS와 HTTPS 인증서 기능을 확인한다.
3. 해당 사용자·기기에서 서버의 선택 HTTPS 포트에 접근할 수 있도록 Tailnet 접근 정책을 확인한다. Tailnet 가입만으로 모든 구성원에게 관제 권한을 주지 않는다.
4. 기존 Serve 설정과 포트 사용을 확인한다. 다른 서비스의 구성을 reset하거나 덮어쓰지 않는다.
5. 웹쫀쿠가 loopback에서 정상 응답하는 것을 확인한 뒤 해당 포트를 연결한다.

```bash
# 배포 예시: 실제 설정 변경은 대상 서버·포트 확인 후 수행
tailscale serve status
tailscale serve --bg --https=8443 http://127.0.0.1:3000
tailscale serve status
```

출력된 HTTPS URL을 웹 클라이언트에서 연다. 인증서에 맞는 전체 `*.ts.net` 이름을 사용한다. `100.x` IP 주소나 짧은 hostname을 같은 HTTPS 인증서 주소로 간주하지 않는다. Serve가 인증서와 TLS 종단을 관리한다.

`--bg`는 Serve 공유 설정의 지속 실행에 관한 옵션이다. Core·Chrome·Codex의 프로세스 시작과 복구는 별도의 서비스 설정이 담당한다. 관제실에는 Funnel 공개 설정을 사용하지 않는다.

### 2.2 한 주소에서 사용하는 화면

| 경로 예시 | 기능 |
| --- | --- |
| `/` | 주제·참여자 선택, 공동 대화·결과 비교의 반응형 Control Room |
| `/api/` | 주제·발언·참여자·추가 조건·검토·실행 제어 |
| `/events` | 발언·검증·비교·상태·실행 로그의 SSE |
| `/browser/` | noVNC 원격 Chrome 화면과 WSS 연결 |

경로는 구현 계약으로 확정한다. Core 또는 gateway에서 noVNC의 base path와 WebSocket 경로를 맞춘다. 단순 HTML 제공만으로 원격 화면이 연결됐다고 판정하지 않고 실제 WSS handshake·화면 갱신·입력을 확인한다.

관제 API와 원격 화면에 동일한 소유자 접근 정책을 적용한다. 쓰기 요청·WebSocket의 인증과 Origin 검증을 구현하고, 세션 쿠키를 사용한다면 CSRF 방어를 적용한다. 클라이언트가 보낸 신원 헤더를 그대로 신뢰하지 않는다. Chrome 디버깅·Codex 제어 포트를 직접 Tailnet에 여는 구성을 기본값으로 두지 않는다.

## 3. 실시간 관제와 화면 스트리밍

### 3.1 기본 화면: 상태·텍스트·로그

사용자는 웹 UI에서 주제를 입력하고 참여자들의 대화·반론·검증·비교를 보며 추가 조건·질문을 보낸다. 요청은 HTTPS API로 보내고, 서버의 새 상태·메시지·로그는 SSE로 전달하는 구성을 기본으로 한다.

- GPT OAuth·DeepSeek API의 실제 응답 stream과 dot·Muse 화면에서 관측한 내용을 공통 event로 변환한다. browser 관측을 공식 token stream이라고 표시하지 않는다.
- Codex는 검증된 App Server 이벤트 또는 CLI JSONL 출력을 작업별로 전달한다.
- `accepted`, `running`, `blocked`, 실행 완료, 검토 대기, 업무 완료를 구분한다.
- 이벤트마다 project/discussion/participant/turn/task/job·topic revision과 서버 cursor를 연결하고 접근 범위를 검사한다.
- 작업 상태 변경과 전달할 이벤트를 영속 저장한 뒤 송신한다. DB 변경과 이벤트 기록 사이 누락을 막는 outbox 또는 동등한 원자적 계약을 사용한다.
- 최초 snapshot과 이어지는 cursor 사이에 이벤트가 빠지지 않게 한다. 재연결 시 `Last-Event-ID` 등 저장된 cursor부터 재생하고 클라이언트는 중복 event ID를 무시한다.
- cursor가 보존 범위를 벗어나면 새 snapshot으로 복구한다. 잘린 로그는 범위와 전체 기록 참조를 표시한다.
- 중간 proxy의 buffering과 idle timeout을 점검하고 heartbeat·연결 감지·backoff 재접속을 구현한다.
- SSE 재연결이 작업 생성·메시지 전송·Codex 재개를 다시 실행하지 않도록 읽기와 쓰기를 분리한다.

웹 클라이언트를 닫거나 절전·네트워크 전환이 일어나도 서버는 정해진 예산 안에서 후속 발언·검증·비교를 계속한다. 다른 허용 기기에서 같은 Discussion에 접속해 이어 볼 수 있다. 돌아왔을 때 최신 상태와 누락된 기록을 복원한다. 연결이 끊긴 화면에 예전 상태를 실시간 상태처럼 표시하지 않는다.

### 3.2 보조 화면: 원격 Chrome 조작

Ubuntu에 가상 디스플레이·VNC 서버·WebSocket proxy·noVNC를 구성하고, Browser Bridge가 연결한 것과 **동일한 Chrome 세션**을 보여준다. 가상 데스크톱 backend는 실제 Ubuntu 환경에서 입력·로그인·재시작을 검증한 뒤 고정한다.

용도:

- 서버 Chrome에서 dot·Muse 최초 로그인과 만료 후 재로그인, GPT OAuth 등록 창 조작.
- Chrome autoConnect 연결 허용 창 처리.
- 계정·대화 선택과 자동화가 막힌 화면의 수동 확인.
- 실제 브라우저 화면 관찰이 필요한 디버깅.

noVNC는 웹 VNC 클라이언트이며 브라우저에서 화면·키보드·포인터를 주고받는다. 고화질 동영상 스트리밍이나 무지연 조작을 보장하는 기능으로 소개하지 않는다. 실기기에서 키보드·마우스·터치·화면 크기·한국어 입력·소프트 키보드를 확인한다.

수동 개입 중에는 해당 브라우저 대상의 자동 입력을 잠근다. 사용자가 개입을 마치고 재개하면 계정·대화·미전송 메시지를 다시 확인한다. noVNC 창을 닫았다는 이유만으로 대화를 전송하지 않는다. 브라우저 수동 개입과 별개로 이미 시작한 Codex 실행은 명시적 중단 요청이 없는 한 계속한다.

## 4. Ubuntu Chrome의 로그인·지속 실행

1. 서버의 고정된 OS 사용자와 실제 사용할 Chrome profile을 확인한다.
2. 기존 서버 프로필이 있으면 재사용한다. 새 서버 환경이면 사용자가 원격 화면에서 로그인하고 persistent profile에 보존한다.
3. Chrome 144+의 해당 기능과 `chrome://inspect/#remote-debugging`을 확인한다.
4. 같은 서버의 bridge가 고정 버전 `chrome-devtools-mcp --autoConnect`로 연결을 요청한다.
5. 사용자가 원격 화면에서 Chrome의 허용 요청을 처리한다.
6. dot(may)과 Muse의 계정·agent·대화·tab을 실제 화면과 대조해 등록한다.

다른 PC나 웹 클라이언트의 로그인 상태가 서버 Chrome에 자동 이전된다고 가정하지 않는다. 쿠키·프로필 파일을 기기 간 복사하는 설치 흐름을 만들지 않는다. 서버의 프로필 디렉터리는 source·target workspace·Codex 작업 입력과 분리하고 공개 로그·Git에 포함하지 않는다.

autoConnect는 Chrome이 정한 기본 프로필을 선택한다. 연결된 profile의 열린 창들에 접근 가능한 특성이 있으므로 서비스 허용 목록·대상 바인딩을 bridge에서 적용한다. 여러 profile을 자동으로 모두 열거·선택할 수 있다고 UI에 표시하지 않는다. 요구를 충족하지 못하면 확장 프로그램 + Native Messaging을 별도 검증한다.

Chrome 연결 시마다 허용 창이 나타날 수 있다. 서버 재시작 뒤 로그인·profile 잠금·연결 승인이 필요하면 `AUTH_REQUIRED` 또는 사용자 개입 상태로 표시한다. 가상 데스크톱이 살아 있는 것과 서비스 계정에 로그인된 것을 구분한다.

### 4.1 GPT OAuth 등록과 API credential

일반 GPT OAuth는 계정별로 등록하며 이력·refresh·모델 목록도 분리한다. 초기 후보는 Ubuntu helper의 loopback callback과 같은 서버 Chrome에서 로그인하고 원격 사용자는 noVNC로 그 화면을 조작하는 방식이다. 원격 기기의 브라우저에서 OAuth를 시작하면 그 기기의 loopback으로 돌아오므로 서버 Tailscale 주소로 callback을 임의 대체하지 않는다. 공식 self-hosted 대안과 실제 적격성·등록 검증은 [참여자 연결 계획](./participant-connections.md)을 따른다.

등록 후 토론은 서버의 OAuth/API runtime이 이어간다. DeepSeek API key와 OAuth token은 서버의 보호된 저장소에 두며 웹 브라우저에는 credential을 전달하지 않는다. 웹 클라이언트가 닫혀도 토큰 갱신·호출·예산·중단 상태는 서버에서 관리한다.

## 5. dot의 MCP 통로와 Tailscale의 역할

| 통신 | 경로 | 검증할 조건 |
| --- | --- | --- |
| 허용 기기의 웹 브라우저 → 웹쫀쿠 | Tailscale Serve HTTPS | 같은 Tailnet·접근 정책·인증서·UI 인증 |
| Ubuntu → GPT OAuth / DeepSeek API | 각 provider의 공식 outbound HTTPS | 계정별 동의·key·모델·완료·사용량 |
| Browser Bridge → dot/Muse | Ubuntu Chrome의 기존 로그인 대화 | 계정·대화·전송/응답 증거 |
| dot → 웹쫀쿠 MCP → Codex | OpenAI Secure MCP Tunnel → Ubuntu private MCP → 실행기 | Platform/ChatGPT 권한·도구 발견·실제 job 왕복 |
| 웹쫀쿠 → dot 이벤트 | 검증된 MCP Events 구독의 callback으로 outbound HTTPS | 서명·구독·수신·결과 확인 |

OpenAI 서비스가 사용자의 Tailnet에 가입돼 있다고 가정하지 않는다. Tailscale HTTPS 주소만 custom MCP URL로 등록하는 것으로 dot 호출이 가능해지지 않는다.

Secure MCP Tunnel의 `tunnel-client`는 Ubuntu에서 outbound HTTPS로 OpenAI에 연결하고 로컬 stdio 또는 HTTP MCP로 요청을 전달한다. 관제실·Chrome·Codex 포트를 공용 인터넷에 공개할 필요가 없다. Platform tunnel ID·runtime key와 권한, ChatGPT workspace 연결·custom MCP 사용 가능 여부를 실제 계정에서 확인한다. GPT OAuth와 DeepSeek API의 모델 요청은 별도의 outbound 경로이며 이 터널의 설치를 요구하지 않는다.

터널의 상태와 dot 이벤트 구독 상태는 별도 표시한다. 이벤트의 HTTP 접수와 업무 완료도 구분한다. Muse Connector에는 OpenAI 터널을 그대로 적용하지 않으며, Muse의 외부 호출·인증·승인은 별도 capability 검증을 따른다.

## 6. 서버 수명과 운영 기록

- Core, OAuth/API runtime, 브라우저 세션, bridge, Codex 실행기, noVNC 계층, tunnel을 개별 구성요소로 관측한다.
- 저장소·Core 복구 후 선택된 연결의 OAuth/API·browser·실행기를 각각 probe/reconcile하고 해당 연결의 dispatch를 허용한다. browser 경로는 가상 데스크톱/Chrome → bridge 순서다. 토론에 필요하지 않은 Chrome·Codex·tunnel의 장애가 정상 OAuth/API 참여자의 실행까지 전역 차단하지 않게 한다.
- 재시작 직후 저장 job·활성 turn·대화 receipt를 대조하고, 기존 실행이 없는지 확인하기 전에는 재실행하지 않는다.
- Core 종료와 연결기 재시작의 동작을 명시한다. 분리된 Codex 실행이 계속되는지 중단됐는지 관측하고 unknown을 성공·실패로 추정하지 않는다.
- 정상 종료 시 새 dispatch를 먼저 막고 필요한 상태·cursor를 저장한다. 모든 프로세스를 종료할 때의 미완료 작업 복구도 확인한다.
- backup 대상은 Discussion/Turn/Claim/Evidence/Task/Event DB, 참여자별 이력·바인딩, 비밀이 없는 설정이다. Chrome/Codex 인증 저장소는 별도 보호 정책을 적용하고 범용 다운로드·진단 묶음에 넣지 않는다.
- 로그는 작업 범위로 접근 제한한다. OAuth token·API key·인증 값·쿠키·callback secret·tunnel key를 redact하고 원격 로그인 화면을 자동 기록하지 않는다.
- 서비스 장애, 로그인 필요, 승인 필요, 마지막 이벤트 시각을 관제실에서 구분한다.

## 7. 단계별 검증

### Phase 0 — 서버 접속과 브라우저 기반

- 실제 Ubuntu·architecture·소프트웨어 버전과 실행 경로를 기록한다.
- GPT OAuth 2계정의 callback·등록·모델·stream과 DeepSeek API 최소 대화를 검증한다.
- Tailscale HTTPS 주소와 선택 포트에 웹 클라이언트가 접근한다.
- 동일 서버 Chrome을 noVNC로 보고 dot·Muse 로그인·Chrome 연결 승인을 처리한다.
- 서버의 기존 대화에서 요청 1회·후속 질문 2회와 bridge 재연결을 확인한다.

### Phase 2 — 일반 웹 접속·능동 대화 MVP-1

- 넓은 화면의 대화·비교 병렬 배치와 좁은 화면의 탭에서 주제 입력·추가 지시·개입·근거 확인이 동작한다.
- 데스크톱 브라우저 1종 이상과 모바일 브라우저 1종 이상의 실제 기기 조합을 검증하고 OS·브라우저·viewport를 기록한다. 특정 태블릿을 필수 기기로 고정하지 않는다. 미검증 조합을 지원 완료로 표시하지 않는다.
- 주제 한 번으로 혼합 N인 토론·검증·비교가 자동 진행되고 요청·시간·사용량 한도가 적용된다.
- 절전·탭 닫기·네트워크 전환 동안 서버 작업이 유지된다.
- 새 탭·다른 허용 기기의 재접속 시 snapshot/cursor로 같은 대화·비교를 복원하며 중복 모델 요청을 만들지 않는다.
- HTTPS 인증서·허용/거부 접근 정책·WSS·실시간 SSE가 실제 Serve 경로에서 동작한다.
- 키보드·마우스·터치·한국어 입력과 noVNC 승인 조작·자동 입력 잠금을 확인한다.
- 서버 재부팅 후 서비스와 상태를 복구한다. 계정 재인증이 필요한 경우 정상 연결로 위장하지 않는다.

### Phase 3 / 4A — dot의 Codex 실행

- Secure MCP Tunnel을 통해 dot이 웹쫀쿠 도구를 발견하고 범위 내 호출을 수행한다.
- 지정 Codex 세션의 실행·검토·후속 지시와 원래 토론의 참여자별 재평가를 웹 클라이언트에서 확인한다.
- terminal job, 승인 대기, 연결 중단을 정확히 복원한다.
- 웹 클라이언트 private 접속과 OpenAI MCP 연결 중 하나가 끊겨도 다른 연결을 성공으로 오표시하지 않는다.

모든 실서버·실계정·실기기 검증은 현재 NOT_RUN이다. 실행 대상 hostname·포트 확정·설치·로그인·권한 설정을 완료했다고 표시하지 않는다.

## 8. 공식 근거

2026-10-29 확인. 실제 서버의 버전·기능을 확인한 뒤 runbook을 고정한다.

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve): private 서비스 공유와 접근 정책.
- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve): HTTPS 포트, reverse proxy, background 지속 설정.
- [HTTPS 인증서](https://tailscale.com/docs/how-to/set-up-https-certificates): MagicDNS·전체 도메인·인증서 설정.
- [noVNC](https://novnc.com/info.html): 웹 VNC 클라이언트와 iOS·Android 브라우저 지원.
- [Chrome 기존 세션 연결](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session): autoConnect와 연결 허용.
- [Chrome advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md): 기본 프로필과 실행 중인 Chrome.
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels): private MCP 연결과 outbound HTTPS.
