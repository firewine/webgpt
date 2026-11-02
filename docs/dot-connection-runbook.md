# 공식 dot 연결 — D4 운영 절차

기준: D3 병합 main `9992f74`, D4 구현 브랜치. 이 문서는 준비·설정 절차이며 **운영 배포·실제 플러그인 인증·혼합 대화의 수락 기록이 아니다**. D0는 격리 합성 이벤트/답변 한 건만 통과했다. 실제 방의 인증 전달·native 감시·응답은 D5에서 따로 확인한다. 현재 Muse Chrome profile·thread·선택자·초안은 변경하지 않는다.

## 1. 연결과 참여를 구분한다

1. 병합 버전을 별도 검증한 뒤 기존 운영 배포 절차로 빌드한다. 사용 중인 포트/서비스를 먼저 확인하고 중복 실행하지 않는다. 이 문서 작성 과정에서는 운영 서비스를 재시작하지 않았다.
2. 웹쫀쿠 소유자 로그인 → **참여자와 연결 → dot · 공식 플러그인 연결**을 연다. 일반 GPT/dot 선택에서 dot을 골라도 같은 설정으로 이동한다. 기존 Chrome의 일반 ChatGPT 대화를 dot으로 바꾸지 않는다.
3. 참여할 방·표시 이름·역할을 입력하고 **dot 연결 등록**을 누른다. 해당 방에 참여자가 생기지만 방과 발언 참여는 자동으로 켜지지 않는다. Muse·기존 다른 토커는 그대로다.
4. 등록 카드에서 **연결 확인·권한 발급**을 누른다. 대상 방/dot과 전용 터널에 접근할 사용자를 확인하고 체크한다. 기본 만료는 1일, 최대 7일이다. 키는 조회·claim·submit 세 도구만 허용하며 직접 Codex/업무/Wiki 권한을 주지 않는다.
5. 발급된 키는 보호된 로컬 입력에만 사용한다. 창 닫기·화면 전환·로그아웃·2분 경과 시 표시를 지운다. state/SSE/command journal에는 원문 키를 넣지 않는다. 키를 잃었다면 **권한 다시 발급**으로 교체한다. 재발급은 이전 키/감시를 회수하므로 진행 중 응답을 먼저 대조한다.

UI의 **소유자가 확인한 연결**은 실제 dot 계정/principal의 암호학적 증명과 다르다. `nativeActorVerified=false`를 유지한다. `native-dot`은 논리적인 연결 이름이며 모델 목록·사고 깊이를 확인했다는 의미가 아니다. 실제 dot 설정/기억은 해당 서비스가 관리한다.

## 2. 키와 인증 경계

| 항목 | 용도·입력 위치 |
| --- | --- |
| 웹쫀쿠 비밀번호/복구 키 | 소유자의 웹 로그인. MCP/Tunnel에 사용하지 않음 |
| GPT OAuth·API key | 개별 provider 인증. dot 권한과 무관 |
| dot 전용 grant | 웹쫀쿠가 발급한 방/참여자/연결/도구/version/만료 권한. 로컬 0600 파일 → 기존 stdio 전달기 → 인증된 loopback `/mcp` |
| Tunnel runtime key | 해당 Platform 조직 터널의 Read/Use 권한. Tunnel client의 보호된 file/env reference에만 사용 |
| tunnel ID·등록 plugin ID | 연결 대상 식별자. 키나 권한을 대신하지 않음 |

기존 [운영 절차 §5](./operations-runbook.md#5-dot-mcp와-secure-mcp-tunnel)의 **로컬 scoped grant를 주입하는 stdio 전달기**를 재사용한다. `/mcp`의 Bearer 검사는 유지하며 owner 키로 dot 도구를 호출할 수 없다. 고정 grant를 쓰는 전용 Tunnel에 접근 가능한 클라이언트는 같은 권한을 사용하므로, 개인 전용 조직/workspace 접근 범위를 소유자가 확인해야 한다. 이 방식은 사용자별 OAuth 인증을 제공하지 않는다.

ChatGPT의 custom MCP 설정에서 임의 Bearer 입력을 지원한다고 가정하지 않는다. OAuth 입력란에 grant/runtime key를 붙이지 않는다. private stdio 연결의 클라우드 등록 인증 설정은 해당 계정에서 실제 확인해야 하며 현재 **UNVERIFIED**다. D0의 합성 서버에서 인증 ‘없음’으로 성공한 사실은 운영 서버의 인증을 끄라는 지침이 아니다. 해당 계정이 별도 OAuth를 요구하거나 개인 전용 접근 경계를 확인할 수 없다면 **BLOCKED**로 기록하고 추가 OAuth의 영향·변경량 승인을 먼저 받는다. [공식 인증 제약](https://developers.openai.com/plugins/build/auth), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)을 대조한다.

## 3. 로컬 grant와 전달기 준비

아래는 **운영자가 적용할 때의 예시**다. 실제 state 디렉터리가 다르면 맞춘다. 기존 파일을 덮어쓰지 않으며, D0 profile/runtime와 구분한 새 디렉터리를 쓴다. 비밀을 shell 인자·history·공개 저장소에 넣지 않는다.

```bash
# 새 디렉터리일 때만 생성; 이미 있으면 내용을 대조하고 다른 새 이름 사용
mkdir -m 700 ~/.local/state/webjjoku/dot-production
systemd-ask-password 'Webjjoku dot grant' | node scripts/dot-mcp-ops.mjs save-grant /home/사용자/.local/state/webjjoku/dot-production/grant-v1
```

`save-grant`는 소유자 전용 0700 parent·절대 경로를 검사하고 symlink/기존 파일을 거절한다. 새 파일은 0600이다. 키를 화면에 출력하지 않는다. 이 파일에 Tunnel runtime key를 넣지 않는다.

별도 0600 환경 파일 `dot-production/bridge.env`에 **비밀 값 대신 경로**를 설정한다. 아래 포트/경로는 실제 설치 값으로 바꾼다. 기존 `.env`를 덮어쓰지 않는다.

```dotenv
WJ_PORT=실제_내부_앱_포트
WJ_MCP_GRANT_FILE=/실제/state/dot-production/grant-v1
WJ_MCP_EXPECT_DOT=true
```

`WJ_MCP_EXPECT_DOT=true`의 전달기는 `/health`의 작업실 identity와 `/mcp`의 초기화·세 도구·Events catalog를 먼저 읽는다. 다른 서비스/owner 키/legacy grant/잘못된 권한이면 전달을 시작하지 않는다. provider 호출·감시 생성·방 변경은 하지 않는다. 이 사전 검사 성공은 native dot 왕복 성공과 다르다. 전달기 프로세스는 키를 시작 때 읽으므로 재발급 후에는 새 파일 경로로 해당 전용 프로세스만 다시 시작한다.

```bash
node --env-file=/실제/state/dot-production/bridge.env scripts/dot-preflight.mjs
```

`doctor:dot`은 실행한 프로세스에 Tunnel ID/runtime 환경 정보가 없으면 해당 항목을 BLOCKED로 표시한다. runtime key가 Tunnel profile의 file reference에만 있는 경우도 같으며 키가 잘못됐다는 뜻은 아니다. `mcp.status=OBSERVED`와 세 capability를 따로 읽는다. 진단을 위해 키를 공개하거나 다른 계정으로 복사하지 않는다.

## 4. 전용 private Tunnel·플러그인

기존 D0 감시와 runtime이 종료됐는지 대조하고 한 터널에 여러 runtime을 중복 실행하지 않는다. Platform 조직·ChatGPT workspace·runtime key의 Read/Use 권한과 전체 tunnel ID를 확인한다. `tunnel_use_forbidden`은 같은 ID/조직/권한부터 대조하고 새 키를 무작정 반복 발급하지 않는다.

설치된 `tunnel-client init --help`, `run --help`를 먼저 대조한다. 다음은 D4에서 **설치본 help만 확인한** 예시이며 실행하지 않았다. Node·저장소·state·runtime key·ID는 실제 값으로 바꾼다. 기존 profile을 덮어쓰는 `--force`는 사용하지 않는다. 경로에 공백이 있으면 설치본의 command 인용 규칙에 맞춘다.

```bash
tunnel-client init --sample sample_mcp_stdio_local \
  --profile webjjoku-dot-prod-v1 --tunnel-id tunnel_실제ID \
  --control-plane-api-key-ref file:/실제/보호/runtime-key \
  --health-listen-addr 127.0.0.1:0 \
  --mcp-command "/실제/node --env-file=/실제/state/dot-production/bridge.env /실제/저장소/scripts/mcp-stdio.mjs"
tunnel-client doctor --profile webjjoku-dot-prod-v1 --explain
tunnel-client run --profile webjjoku-dot-prod-v1 \
  --mcp.stdio-failure-policy exit --mcp.stdio-send-initialized-notification
```

마지막 초기화 통지는 D0에서 실제 감시 등록을 가능하게 한 절차다. 임의 child 재시작으로 감시/요청을 반복하지 않는다. admin/health는 loopback만 쓰고 payload capture를 켜지 않는다. callback은 기존 D2의 공개 HTTPS·DNS 고정·서명/challenge·유한 재시도 경계를 통과해야 한다. Tailscale URL을 public MCP URL로 등록하거나 CDP/VNC를 노출하지 않는다.

대상 dot 계정의 **Plugins → 사용자 지정 MCP 서버 → Tunnel**에서 같은 운영 터널을 연결한다. Browser use: Chrome은 이 연결이 아니다. 인증은 위 §2 경계가 확인된 연결 방식만 사용한다. 도구 새로 고침 뒤 아래 세 도구와 이벤트 하나를 확인한다.

| 구분 | 이름 |
| --- | --- |
| Read | `dot_turn_get` |
| Write | `dot_turn_claim`, `dot_turn_submit` |
| Event | `webjjoku.turn_requested` (방/참여자/연결 필터) |

동적 request/probe ID를 스키마에 고정하지 않는다. D0 합성 probe 설명이 보이면 운영 등록이 아니다. `mcp.json`/패키지 생성·도구 목록만으로 감시와 답변이 성공했다고 표시하지 않는다. 실제 native 감시 등록/이벤트 전달은 [MCP Events](https://developers.openai.com/plugins/build/mcp-events) 절차로 검증한다.

등록된 앱을 참조하는 개인 패키지가 필요할 때만 아래 도구를 사용한다. `plugin_asdk_app_...`는 등록된 **plugin 기술 ID**다. tunnel ID·앱의 표시 이름으로 대체하지 않고 등록/내보내기 결과로 확인한다. 저장소에는 계정별 `.app.json`을 넣지 않는다.

```bash
node scripts/dot-mcp-ops.mjs package /실제/state/dot-production/plugin-v1 plugin_asdk_app_실제ID
```

새 private 디렉터리에 `plugin.json`, `.app.json`, 안내 README만 생성한다. 출력은 PREPARED/설치 UNVERIFIED/인증 UNVERIFIED다. 등록된 앱 참조 방식은 [공식 플러그인 패키징](https://developers.openai.com/plugins/build/plugins)을 따른다. 해당 계정에서 제공하는 설치 방식으로 연결한 후 별도로 관측한다. 자동 배포·새 OAuth·앱 권한 승격은 수행하지 않는다.

## 5. 실제 dot 참여와 관측

운영 인증/기존 감시 중복 여부를 확인한 후 `plugins/webjjoku-dot/README.md`의 최초 지시를 실제 dot에게 전달한다. 핵심은 native Events 감시 하나 → 이벤트에서 현재 요청 조회 → claim → winning attempt로 고정 입력 조회 → 같은 요청/attempt에 JSON 답변 submit이다. 서버가 돌려준 ID/필터를 사용한다. 일반 채팅에 확인 문장을 적는 것과 `accepted/receipt` 수락은 다르다.

구독이 유효하고 차단 사유가 없을 때 UI는 **전송 준비됨**을 표시한다. 그 뒤 사용자가 채팅방의 해당 dot 발언 참여와 방 켜기를 설정한다. 등록/상태 조회만으로 모델 호출을 시작하지 않는다. 통합 수락은 D5의 실제 호출 허용 범위·횟수 안에서 진행한다.

| 화면 관측 | 의미·다음 조치 |
| --- | --- |
| 소유자 확인 필요 / 권한 확인 필요 | owner 확인·grant 파일/현재 version 점검 |
| 만료 / 권한 해제 | 원래 실행 대조 후 재발급·새 감시. 자동 복구로 표시하지 않음 |
| 감시 등록 필요 / 검증 중 / 유효 | native 감시 없음 / callback challenge 중 / 구독 유효. 유효만으로 계정 증명 완료 아님 |
| 미전송 / 전달 대기 / 전달 중 | 요청/outbox의 실제 저장·전송 단계 |
| 이벤트 수신 확인 | callback HTTP 성공. 모델 답변·공개 완료 아님 |
| 답변 대기 / dot이 입력 조회 중 / 답변 저장·반영 대기 | 원래 request·claim·mailbox 단계. receipt는 저장 증거 |
| 미확정 / 대조 필요 | 원래 turn/request/receipt 대조. 새 감시나 새 job으로 재전송하지 않음 |
| 답변 반영됨 / 이전 범위 응답·적용 안 함 | 기존 엔진 반영 / 구세대 격리. 원문/반론/검증 상태 보존 |

방 off→on·주제 전환은 grant 재발급 사유가 아니다. 권한은 유지하되 각 발언의 epoch/generation/revision 검사는 계속한다. 방 off는 새 발언을 막으며 이미 시작한 외부 도구의 취소와 다르다. 정상 전환과 만료/회수/identity 변경을 혼동하지 않는다.

## 6. 진단·회수·복귀

`npm run doctor`의 dot 항목은 권한/구독/전달/답변 상태와 차단 사유만 표시한다. 키·callback URL·입력/답변 원문·개인 ID를 출력하지 않는다. doctor가 준비됐다고 해도 실제 계정/왕복은 UNVERIFIED다. `GET /api/dot/status`는 소유자 인증이 필요하고 상태를 변경하지 않는다.

중지 시 dot의 발언 참여 off → 원래 미확정 결과 대조 → **연결 권한 해제** → native 감시 해제 확인 → 해당 전용 Tunnel runtime 중지 순서로 처리한다. UI 회수는 서버 grant/구독/미전달 outbox를 회수·보류하지만 외부 작업 서비스의 감시 삭제를 확인한 표시는 아니다. 시간 초과 후 자동 재전송하지 않는다.

D4에는 DB schema 이관이 없다. 복귀하려면 dot만 off/회수하고 D3 호환 상태를 확인한 뒤 이전 바이너리를 사용한다. DB/state·과거 turn/receipt·Muse profile/thread·다른 연결을 삭제하지 않는다. 다른 서비스/Serve와 webjjoku 전체 설정을 초기화하지 않는다. D5에서는 전환·재연결·중복 방지·실제 혼합 50 gate를 검증하며, 이번 UI/fixture 검사로 대신하지 않는다.
