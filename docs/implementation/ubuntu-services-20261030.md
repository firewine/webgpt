# Ubuntu 상시 운영·HTTPS·원격 Chrome 적용 기록

- 날짜: 2026-10-30 (KST)
- 기준 main: `07aa852cb9fed29c3cb8be67ac492356d6a45cc9` (사용자 PR #6 병합)
- 작업 브랜치: `codex/ubuntu-services-20261030`
- 사용자 승인: 다음 단계의 Chrome/noVNC·systemd·Tailscale HTTPS 구성 진행
- 판정: 실제 서버의 서비스·TLS·로그인·SSE·noVNC 입력·재시작 PASS. 다른 기기·실제 재부팅·실계정 토론은 별도 판정.

기존 [개발 재개 점검](ubuntu-readiness-20261030.md)에서 확인한 4090 앱을 그대로 인계했다. 실제 호스트는 Ubuntu 26.04.1, Node 24.18.0, npm 11.16.0, Codex 0.165.0, Chrome 156.0.8078.47이다.

## 실제 적용한 운영 구성

| 항목 | 적용·관측 결과 |
| --- | --- |
| 앱 | `webjjoku.service`, enabled / active, loopback `127.0.0.1:4090` |
| 원격 Chrome | `webjjoku-desktop.service`, enabled / active, 전용 Xvfb `:99`와 기존 설정의 persistent profile |
| 로그아웃·부팅 후 유지 설정 | `loginctl enable-linger firewine` 적용, `Linger=yes` 확인 |
| Node 경로 | user unit의 ExecStart와 PATH 모두 실제 nvm Node 24.18.0 경로 사용 |
| Chrome MCP | `~/.local/share/webjjoku/tools`에 1.12.0 지속 설치. 프로젝트·전역 도구와 분리 |
| Chrome 실행 명령 | 실제 Node 절대 경로 + 설치한 MCP JS 절대 경로, `--browserUrl=http://127.0.0.1:9222`, `--no-usage-statistics` |
| noVNC | 사용자 sudo 설치 완료 보고 뒤 패키지 확인: noVNC 1.6.0-2, websockify 0.13.0, x11vnc 0.9.17-2 |
| HTTPS | 실제 Tailscale Self DNS와 8443 → `http://127.0.0.1:4090`, `WJ_PUBLIC_ORIGIN` 일치 |
| Tailscale 권한 | 사용자가 관리 화면에서 Serve 활성화 후 정확한 8443 경로만 sudo로 적용. 전체 operator 권한은 부여하지 않음 |
| 내부 포트 | CDP 9222, noVNC 6080은 IPv4 loopback; VNC 5901은 IPv4/IPv6 loopback. Tailnet 직접 노출 없음 |
| 기존 3000 서비스 | 유지. 종료·설정 변경 없음 |
| Codex 설정 | 설치된 Codex 절대 실행 경로만 고정. `WJ_WORKSPACE_ROOTS=[]`, thread 바인딩·모델 실행 없음 |

실제 HTTPS 주소는 private 운영 `.env`에서 확인한다. Tailnet의 기기 DNS·IP·인증서·계정 값은 이 공개 기록에 복사하지 않는다. `tailscale serve status --json`으로 실제 HTTPS hostname·8443·upstream을 대조했다. Funnel이나 `serve reset`을 사용하지 않았다.

## 실제 환경에서 발견하고 고친 오류

1. **systemd WorkingDirectory 파싱:** 기존 생성기는 `WorkingDirectory="/절대/경로"`를 썼다. 실제 systemd는 따옴표를 경로 일부로 보아 `path is not absolute`로 서비스를 거부했다. 이 directive에는 바깥 따옴표 없이 경로를 기록하고 `%` specifier를 이스케이프하도록 수정했다. ExecStart 인자 인용은 유지한다.
2. **nvm과 서비스 PATH:** user systemd의 기존 PATH에는 nvm Node가 없었다. `/usr/bin/env node`를 사용하는 도구가 실행되도록 unit PATH의 첫 항목을 installer의 Node 디렉터리로 고정했다. 전체 사용자 환경이나 provider secret을 unit으로 복사하지 않는다.
3. **Wayland 상속:** 전용 Xvfb를 시작했지만 GNOME user manager의 `WAYLAND_DISPLAY`·`XDG_SESSION_TYPE=wayland`가 상속돼 x11vnc가 즉시 종료됐다. desktop 자식 환경에서 Wayland·외부 XAUTHORITY를 제거하고 `XDG_SESSION_TYPE=x11`로 명시했다. 실행 실패 시 원문 stderr 대신 도구 이름·종료 코드만 기록해 원인을 파악한다.
4. **noVNC WebSocket 경로:** 기존 UI의 `path=browser/websockify`를 noVNC 1.6이 현재 `/browser/vnc.html`을 기준으로 해석해 `/browser/browser/websockify`로 요청했다. UI를 `path=websockify`로 바꿔 실제 endpoint `/browser/websockify`와 일치시켰다. 테스트는 UI의 실제 링크를 사용한다.

운영 회귀 검사 `tests/operations.test.mjs`는 임시 HOME·가짜 systemctl로 installer를 실행하고 생성된 두 unit을 실제 `systemd-analyze verify`로 검사한다. interactive PATH 없이 `/usr/bin/env node`가 선택된 Node를 실행하는지도 확인한다. 기존 UI 브라우저 검사에는 viewer 경로가 정확한 WebSocket endpoint로 해석되는지 추가했다.

전용 X99의 과거 잠금 파일은 PID 1128986이 없고 X99 socket도 없음을 확인한 뒤 private 백업으로 이동했다. 다른 X 화면이나 사용자 profile은 정리하지 않았다.

## 관측한 검증

| 검증 | 판정 | 실제 증거·한계 |
| --- | --- | --- |
| 앱 graceful 인계 | PASS | 기존 PID 336200만 SIGTERM으로 종료, runtime lock 제거를 기다린 뒤 systemd 시작. 같은 state·4090 사용 |
| 실제 TLS·health | PASS | 인증서 검증을 끄지 않고 실제 Tailnet HTTPS health 200. localhost health도 200 |
| HTTPS 소유자 로그인 | PASS | 기존 키를 파일에서 메모리로 읽어 로그인. session cookie의 Secure·HttpOnly·SameSite=Strict 확인 |
| 인증·수동 lease | PASS | 비인증 state·viewer 401, 인증됐지만 manual lease 없는 viewer 403 |
| 기존 기록 보존 | PASS | 이전 모의 토의 `discussion_abfacbf0-6aff-4339-9796-7589d21ea243`가 completed로 그대로 조회됨 |
| SSE 재연결 | PASS | HTTPS에서 처음 event와 마지막 cursor 기준 재연결 event 관측, 토의 새 실행 없음 |
| 실제 운영 Chrome MCP | PASS | 앱 API의 page 목록 200. 실제 서비스 환경에서 지속 설치된 도구 실행 |
| 실제 noVNC | PASS | HTTPS의 UI 링크 → 인증 gateway → websockify → VNC → Chrome 연결 |
| 실제 키 입력 | PASS | 계정 없는 임시 Chrome input에 noVNC canvas 키 입력, CDP DOM에서 같은 문자열 관측 |
| 수동 조작 종료 | PASS | manual lease 해제 뒤 실제 noVNC WebSocket 닫힘 확인 |
| 앱 재시작·복구 | PASS | systemd restart 전후 discussion·connection·participant·binding·job·event cursor 동일. 당시 cursor 76, 토의 1개 |
| Chrome 재시작·재연결 | PASS | desktop restart 뒤 CDP와 앱 MCP pages 다시 200. 기존 전용 profile 유지 |
| 최종 서비스 | PASS | 두 unit enabled/active, 안정화 후 NRestarts=0, Linger=yes |
| TypeScript·Node 검사 | PASS | `npm run check`: 40 PASS / 0 FAIL / 0 SKIP |
| Chrome 브라우저 검사 | PASS | 실제 Chrome 156 + MCP 1.12.0: 4 PASS / 0 FAIL / 0 SKIP, 1440/390px |
| 다른 Tailnet 기기 | REPORTED | 사용자가 원격 화면 표시를 보고했지만 해상도 차이로 잘린다고 제보. 이후 화면 맞춤을 수정했으며 사용자 기기의 수정 후 전체 조작은 재확인 대기 |
| 실제 로그아웃·호스트 재부팅 | NOT_RUN | enabled/linger와 서비스 재시작은 확인했지만 현재 개발 세션을 종료하거나 호스트를 재부팅하지 않음 |
| 실계정 MVP-1·실세션 MVP-2 | NOT_RUN | provider 로그인·모델 응답·실제 Codex turn은 이번 운영 단계에 포함하지 않음 |

최종 검사 명령:

~~~bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp \
npm run test:browser
~~~

실제 noVNC 입력 검사는 사용자 기존 대화를 건드리지 않는 임시 페이지에서 수행했고 그 페이지를 닫았다. 화면 근거는 Git 제외 경로 `test-results/ubuntu-https-novnc-20261030.png`에 있다. 테스트가 토큰·키·쿠키·계정 화면을 로그나 Git에 저장하지 않았다.

## 보존·백업과 다음 작업

### 다른 기기의 화면 잘림 후속 수정

사용자의 실제 기기에서 원격 Chrome 화면이 보인다는 보고를 받았지만 해상도 차이로 잘림이 발생했다. Xvfb의 1600×1000 화면에 원격 해상도 변경을 요청하는 기존 `resize=remote` 대신 접속 기기에서 전체 화면을 축소하는 `resize=scale`을 기본값으로 적용했다. 이미 열린 viewer는 설정 → 스케일링 모드 → 로컬 스케일링을 선택하거나 작업실을 새로고침한 뒤 다시 연다.

실제 HTTPS·noVNC에 보기 전용·공유 연결로 접속해 다음을 확인했다. 기존 Chrome PID와 사용자의 수동 조작 lease를 유지했으며 사용자 화면에 키·마우스 입력을 보내거나 화면 캡처를 저장하지 않았다.

| 접속 화면 | 실제 원격 canvas 표시 | 결과 |
| --- | --- | --- |
| 1024×768 | 1024×640 | 전체 영역이 화면 안에 표시 |
| 820×1180 | 820×512.5 | 전체 영역이 화면 안에 표시 |
| 390×844 | 390×243.75 | 전체 영역이 화면 안에 표시 |
| 844×390 | 624×390 | 전체 영역이 화면 안에 표시 |

모든 크기에서 원본은 1600×1000으로 유지됐고 scale=true, remote resize=false, clipping=false였다. noVNC의 입력 좌표 변환이 표시 화면의 중앙을 원본 (800, 500)으로 계산하는지도 읽기 전용으로 확인했다. 실제 사용자 기기의 수정 후 만족 여부나 추가 입력 성공으로 확대하지 않는다. 후속 코드 변경은 HTML 링크와 안내이며, 해당 작업실 브라우저 회귀 검사에 배율 기본값 확인을 추가했다.

인계 전 online SQLite 백업을 `~/.local/state/webjjoku/backups/2026-10-30T00-25-23.825Z.sqlite`에 생성했다. 적용 전 `.env`와 종료된 X99 잠금은 같은 state의 `backups/operations-20261030/`에 0600으로 보존했다. 기존 접속 키·vault 파일 2개의 해시와 사용자 미추적 파일 35개의 내용이 그대로임을 대조했다. `.env`는 필요한 운영 키만 갱신했으며 0600·Git 제외를 유지한다.

계정 로그인 전에는 실제 서비스·Chrome profile을 임의로 초기화하지 않는다. 다음 순서는 다른 기기의 HTTPS·noVNC 확인 → 같은 서버 Chrome에서 GPT OAuth 첫 계정 등록·모델·후속 맥락 → 두 번째 계정·DeepSeek → 기존 dot/Muse 대화 지정·혼합 토론이다. 사용자 로그인·동의·DeepSeek 키는 UI에서 직접 처리한다. Codex 실행은 실제 존재하고 다른 클라이언트가 사용하지 않는 thread와 허용 cwd가 확정된 뒤 진행한다.

OS 재부팅·실제 계정·MCP Tunnel 권한·MCP Events·Muse Connector를 서비스 설치 성공으로 완료 표시하지 않는다. PR 병합은 사용자 담당이다.
