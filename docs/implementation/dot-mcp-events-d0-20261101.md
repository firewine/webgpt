# 공식 dot 연결 D0 — 준비 상태·계약 점검

2026-11-01 KST. 기준 main `ce8d9717ca34a77f458f47a8eb2f98cc793b2fcf`(PR #35), 작업 브랜치 `codex/dot-mcp-events-d0-20261101`. [사용자 승인 범위](../reviews/dot-official-mcp-events-impact-20261101.md)·[SSOT](../development-plan.md)를 따른다. **D0는 터널 권한 확인 대기이며 native dot 이벤트 왕복은 NOT_RUN이다. D1 이후 종속 구현은 착수하지 않았다.**

## 1. 승인 반영과 보존

사용자는 계획 개정·개발을 승인하고 D0부터 시작하도록 지시했다. dot을 일반 ChatGPT `/c/...`·browser와 분리하고 Muse의 현재 연결을 유지한다. SSOT와 연결·토의·실행 순서·living design·운영/수락 계획을 이 방향으로 개정했다. R4-D/R8-D의 잘못된 dot 기존 thread 전제만 공식 dot 왕복으로 정정하며, Muse 원래 thread와 기존50 gate의 수준은 유지한다.

기존 Providers.complete·Store transaction·공통 dispatch·토의/상주 parser·원문/ID·승인·미확정 대조·API 일일 한도는 변경하지 않았다. 제품 `src/` 변경은 없다. 새 API 연결·모델·운영 참여자/모의 참여자·토의/방을 생성하지 않았다. 사용자가 만든 추적되지 않은35파일은 private manifest와 대조해 보존 여부를 확인한다. 구현/점검 중 실제 model calls0·subscriptions0·conversation mutations0이다.

## 2. 환경/실행 증거와 판정

| 항목 | 판정 | 확인 방법/관측 |
| --- | --- | --- |
| 사용자 계정의 Tunnel 메뉴 | 사용자/화면 확인 | 사용자 답변 “Tunnel 선택 가능” 및 custom MCP 추가 화면. 터널 ID 입력·현재 OAuth 선택은 보이지만, 다른 인증 선택지 부재/로그인 성공을 단정하지 않음 |
| Node/npm | PASS | Node24.18.0·npm11.16.0 |
| 운영 앱 | PASS(읽기) | `systemctl --user show webjjoku`: active/running. `.env`의 loopback4090, 기존 private HTTPS origin을 유지. `/health`가 webjjoku/workspace/sqlite임을 확인 |
| 다른 서비스 | 보존 | 포트3000 등 기존 listener를 종료/변경하지 않음. 새 공개 listener·Serve reset·Funnel 설정 없음 |
| Muse/기존 browser binding | 보존 확인 | 실제 `/api/state`에서 browser binding1개를 읽고 ID+binding digest를 private 임시 receipt에 기록·최종 대조. 개인 계정·대화·URL은 공개 문서에 복사하지 않음 |
| 초기 Tunnel 도구/설정 | BLOCKED(초기 점검) | 초기 PATH에 tunnel-client 없음. 전용 `tunnel.env`/grant 파일과 프로세스에 제공된 runtime key/tunnel ID 없음. 다른 위치에 키가 전혀 없다는 주장은 아님 |
| 공식 Tunnel 도구 설치 | PASS | 공식 latest release v0.0.19 Linux amd64 zip의 게시 SHA256과 다운로드 해시 일치 확인. 사용자 전용 경로에 설치하고 기존 도구를 덮어쓰지 않음. 아래 버전/경로 참조 |
| 전용 Tunnel profile | PASS(로컬 구성) | 사용자가 제공한 ID를 private profile에만 기록. `sample_mcp_stdio_local`·합성 fixture·file key reference·loopback ephemeral admin 포트, 0600. 실제 권한 결과는 아래 FAIL_PERMISSION이며 설정 성공과 구별 |
| 최종 read-only 준비 상태 | BLOCKED / exit2 | `npm run doctor:dot`: installed=true, 이 프로세스의 ID/key·검사용 scoped grant 부재. native 성공·추가 권한을 추정하지 않음. D0 합성 stdio fixture는 별도 경로이며 운영 앱 grant가 필요하지 않음 |
| 현재 MCP의 Events/응답 계약 | NOT_AVAILABLE(격리 HTTP 관측) | 실제 임시 앱의 scoped legacy grant로 initialize/tools/list/events/list 확인: tools-only, Events/전용 응답 도구 없음. 기존 result_submit은 근거 제출임을 유지 |
| 새 D0 점검 도구·합성 fixture | PASS(fixture) | `node --test tests/dot-preflight.test.mjs tests/dot-mcp-d0.test.mjs`: 10검사 PASS. 실제 stdio child process·challenge/서명·일회 이벤트·중복 응답/회수/범위 경계 포함 |
| 전체 Node/정적 검사 | PASS | 격리 checkout에서 `npm run check`: strict TypeScript·빌드·Node369 PASS, fail0/skip0 |
| GitHub CI | PASS(코드 head e446c6a) | [run41311295483](https://github.com/firewine/webgpt/actions/runs/41311295483): Node369·browser62 PASS, 양쪽 fail0/skip0, 설치 Codex contract 성공. fixture CI와 native dot 실계정을 구별 |
| 로컬 browser GUI 검사 | NOT_RUN(이번 변경) | 제품 GUI/src 변경 없음. 위 browser62는 이번 GitHub CI의 실행 결과이며 로컬 재실행·실기기 성공을 뜻하지 않음 |
| runtime key 로컬 입력 | PASS(보관만) | 사용자 직접 입력한 파일이 해당 사용자 소유·private/nonempty임을 확인. 값은 출력/commit하지 않음. 키 존재를 터널 접근 권한 성공으로 표시하지 않음 |
| tunnel-client doctor | PASS(로컬 설정)/SKIP(원격 확인) | `--explain`의 profile/key reference/실행 파일·ephemeral health bind 확인. stdio MCP 원격·OAuth metadata는 SKIP, optional Codex plugin도 SKIP. 실제 control-plane 인증을 검증한 결과가 아님 |
| 실제 Tunnel control plane | FAIL_PERMISSION | 기존 key·새 전용 key·사용자 제공 Organization 명시 시도에서 모두 metadata403 Forbidden·poll401 `tunnel_use_forbidden`. 모델 API 호출0, 각 D0 runtime만 SIGINT로 종료. native 메시지/구독 없음 |
| 실제 dot·Events·MCP 결과 왕복 | NOT_RUN | 계정의 Tunnel 선택 가능만으로 D0 전체를 통과시키지 않음 |

전체 검사는 `/tmp/webjjoku-dot-d0-validation-20261101`의 독립 checkout과 임시 DB/모의 provider에서 수행했다. 빌드 스크립트가 `dist/`를 삭제/재생성하므로 운영 저장소의 `dist/`에서 검사하지 않았다. 실제 운영 `webjjoku`·desktop 서비스 재시작/배포는 하지 않았다.

## 3. 추가한 D0 도구와 사용법

실제 파일:

- `scripts/dot-preflight.mjs::readDotPreflight/inspectDotProtocol`: read-only health/metadata 점검과 보수적인 상태 판정.
- `tests/dot-preflight.test.mjs`: 실제 격리 HTTP 앱과 응답 fixture로6경계 검증.
- `package.json`: `npm run doctor:dot` 추가. 앱 빌드/서비스 시작과 독립적으로 실행한다.
- `scripts/fixtures/dot-mcp-d0.mjs::createDotD0Fixture/postPublicWebhook/signedWebhook`: 실제 dot의 기능 검증용 **합성 데이터 전용** stdio MCP 서버. 운영 Workspace/키/Chrome/대화/도구를 읽거나 변경할 경로가 없다.
- `tests/dot-mcp-d0.test.mjs`: 실제 stdio 프로세스와 이벤트/응답·서명·권한 fixture4개. 준비 점검6개와 합쳐 신규10개다.

D0 점검/fixture 코드와 검사 합계는 실제385줄·4파일이며 package script/계획·증거 문서는 별도다. 초안의 D0 150~250줄 추정은 점검 도구와 합성 fixture를 합쳐350~500줄로 보정했다. 승인된 D0 최소 왕복 범위 안의 구현이며 전체 기본안40~52파일·2,700~4,200줄 범위를 확대하지 않는다. 이후 production Events/재시작/identity/grant 구현을 이 fixture가 대신하지 않는다.

```sh
npm run doctor:dot
```

기본 실행은 `.env`에서 기존 포트를 읽는다. 다른 앱일 수 있는 포트에 grant를 보내기 전에 `/health`의 서비스 정체성을 확인한다. 기존 scoped grant를 검사하려면 사용자가 허용한 **private0600 파일의 절대 경로**를 `WJ_MCP_GRANT_FILE`로 제공한다. owner 비밀번호/접속 키·GPT 토큰·provider API key를 대신 넣지 않는다. 파일을 자동 생성하거나 grant 권한을 확대하지 않는다.

`WJ_DOT_TUNNEL_ID`는 이 D0 진단 프로세스의 선택적 ID 입력이고 `CONTROL_PLANE_API_KEY`는 별도 Tunnel runtime credential이다. 둘을 프로세스에 제공하지 않았다면 “이 프로세스에 없음”으로 판정하며 값·파일 경로·계정·상대 서버 오류 원문을 출력하지 않는다. 이 진단은 실행 중 tunnel polling·조직 권한·계정 로그인을 검증하지 않는다.

응답 상태:

- `BLOCKED` / exit2: 필요한 로컬 전제 미충족. 버그로 숨기거나 자동 키 생성/로그인/재시도를 하지 않음.
- `READY_FOR_NATIVE_PROBE` / exit0: **read-only 전제 검사만** 충족. `nativeRoundtrip=NOT_RUN`, account/plugin authentication은 UNVERIFIED로 남음. D0 전체 PASS가 아님.

허용하는 MCP 요청은 initialize→initialized notification→tools/list→events/list뿐이다. tools/call·events/subscribe·토의/방 수정·모델 호출은 없다. HTTP JSON/단일 SSE 결과를 크기 제한 안에서 읽으며 redirect·잘못된 id·비정상/과대 응답·private grant 권한 오류를 보수적으로 처리한다.

6개 검사로①현재 tools-only HTTP 계약의 미완료 판정·발언0·journal 변경0, ②Events 광고만 있고 catalog가 없는 경우, ③다른 포트3000 서비스에 Authorization 전송0, ④미지정/비공개가 아닌/잘못된 grant에서 MCP 호출0, ⑤준비된 fixture에서도 native 성공 표시0·구독/실행0·secret 출력0, ⑥잘못된/과대/오류 반사 응답의 비밀 노출0을 확인했다.

합성 fixture4개는①signed challenge→이벤트 수신과 native 응답의 구별→20회 같은 submit의 receipt1/새 이벤트0, ②동일 구독ID·다른 scope/임의 도구/회수 뒤 응답 거부, ③잘못된 challenge/key·private IP/metadata/Tailnet callback·만료 거부와 secret 오류 반사0, ④실제 stdio 프로세스의 initialize/tools/events 광고와 예상하지 않은 stdout/stderr0을 확인했다.

## 4. D0에서 남은 일과 확대 경계

[공식 custom MCP 연결 문서](https://developers.openai.com/api/docs/guides/custom-mcp-server)의 인증 선택지는 OAuth·무인증·혼합이다. [공식 인증 문서](https://developers.openai.com/plugins/build/auth)는 ChatGPT가 임의 API key를 제시하지 못하는 제약을 설명한다. **사용자 화면에 OAuth가 선택됐다는 이유만으로 별도 IdP 설치를 결정하지 않는다.** 기본안의 고정 grant를 Cloud가 직접 제시할 수 있다고 단정하거나 앱의 인증을 제거해서 해결하지 않는다.

최소 경로는 기존 protected MCP grant/Tunnel 전달기의 재사용 가능성을 확인하는 것이다. 그 경로의 사용자/워크스페이스 접근 범위와 actor 바인딩을 증명할 수 없거나 공식 계정별 인증이 필요하면 [OAuth 확대 영향안](../reviews/dot-mcp-oauth-impact-20261101.md)의 추가6~10파일·600~1,000줄을 먼저 보고·승인받는다. 확대안은 아직 미승인이다.

실제 dot 검증을 위해 필요한 조건:

1. 실제 대상 Platform 조직·ChatGPT workspace association과 Tunnel Read/Use(생성자는 Manage)를 확인하고 전용 runtime key를 **사용자 로컬의 보안 입력**으로 제공한다. 키를 채팅·문서·명령 인자·스크린샷에 넣지 않는다.
2. native 연결에 맞는 인증·grant/principal 경계를 확인한다. 기존 Muse/GPT를 바꾸거나 owner 비밀번호를 IdP 인증으로 전달하지 않는다.
3. D0의 격리된 최소 Events fixture로 초기화/도구·구독 challenge·이벤트1·조회/응답1을 실제 dot에서 관측한다. 원래 앱 데이터는 사용하지 않으며 최소 응답 횟수·허용을 실행 전에 구체화한다.
4. callback 수신2xx와 실제 dot tool/result를 따로 기록한다. 이후 D0 완료 여부를 판단하고 D1 이후를 진행한다. 조건을 못 채우면 해당 단계는 BLOCKED/NOT_RUN으로 남긴다.

이 기록에는 실제 dot 연결 성공·native 기억 이전·실제 Muse 메시지 왕복·유료 모델 호출·새 배포를 완료했다는 내용이 없다. rollback은 새 D0 점검 명령 사용 중단과 작업 브랜치 복귀이며 운영 연결/DB/서비스를 초기화할 작업이 없다.

## 5. 실제 dot 왕복을 위한 준비물과 제한

공식 `tunnel-client` 버전은 `0.0.19+01d67bb4da0d8359b808b4761f8db171ab682cd7`이다. 설치 경로는 `/home/firewine/.local/libexec/webjjoku/tunnel-client/0.0.19/`이며 `/home/firewine/.local/bin/tunnel-client`에 새 symlink를 추가했다. 번들 license/NOTICE/SBOM도 함께 보존했다. 설치 zip SHA256은 `9ee9448592345a9dd1517fb79791ab54d24f051142eb92bcbe8cd355effc9142`이며, 운영 runbook은 [공식 latest release](https://github.com/openai/tunnel-client/releases/latest)를 따라 설치 때 다시 대조한다.

실제 설치본 `help quickstart`와 `profiles samples show sample_mcp_stdio_local`에서 **stdio 경로는 HTTP OAuth discovery를 건너뜀**을 확인했다. `run --help`는 MCP upstream 헤더의 env/file 참조와 stdio failure policy도 지원한다. 이 사실은 앱의 사용자/도구 권한 검증을 대신하지 않는다. 운영 `/mcp`의 기존 Bearer 인증은 유지하며, D0에서는 실제 앱에 연결하지 않는 합성 fixture만 사용한다. OAuth 확대는 아직 결정·구현하지 않았다.

사용자가 준비할 값:

1. [Platform Tunnels](https://platform.openai.com/settings/organization/tunnels)의 전용 `tunnel_...`와 dot의 workspace association. ID는 계정/접근 권한을 증명하는 키가 아니다.
2. [Platform runtime API keys](https://platform.openai.com/settings/organization/api-keys)의 Tunnel runtime key. 생성 principal에 Tunnel Read+Use가 있어야 하며 admin key나 GPT OAuth 토큰을 대신 쓰지 않는다. 키는 공식 사이트와 사용자 로컬 보안 입력에서만 취급한다.

아래는 **사용자 Ubuntu 터미널에서 직접 실행할 보안 입력 예시**다. 이 명령은 실행하지 않았으며 기존 파일을 덮어쓰지 않는다. 프롬프트에는 웹쫀쿠 비밀번호가 아니라 위 runtime key를 입력한다.

```sh
mkdir -p -m 700 ~/.local/state/webjjoku/dot-mcp-d0
(
  umask 077
  set -C
  systemd-ask-password 'OpenAI Tunnel runtime API key' > ~/.local/state/webjjoku/dot-mcp-d0/runtime-key
)
```

키 입력 후 전용 profile은 `sample_mcp_stdio_local`, `--mcp-command "node /home/firewine/webgpt/scripts/fixtures/dot-mcp-d0.mjs"`, private key의 **file reference**, `127.0.0.1:0` admin 포트로 구성한다. 실제 init의 인자는 설치본 help와 대조하며 profile/key를 덮어쓰지 않는다. 실행 때 `--mcp.stdio-failure-policy exit`로 예상하지 않은 child restart에 새 probe가 생기지 않게 한다. 기존 webjjoku/desktop service·다른 포트/Serve를 수정하지 않는다.

D0 fixture를 private custom MCP plugin으로 연결할 때만 합성/no-auth 도구 발견을 검사할 수 있다. 이는 **운영 웹쫀쿠의 인증을 해제하는 선택이 아니다.** 실제 방·Wiki·개인 데이터에는 접근할 수 없다. dot에서 사용자가 명시적으로 이 플러그인을 선택해 `webjjoku.turn_requested`의 광고된 probeId를 감시하고, 이벤트가 오면 get→claim→submit으로 짧은 합성 응답1개를 제출하도록 요청한다. 최초/쓰기 도구 승인 요구는 실제 UI에서 관측한다.

구독 challenge가 통과하면 fixture는2초 뒤 **이벤트1회만** 보낸다. callback2xx는 수신이며 `D0_SYNTHETIC_REPLY_ACCEPTED`를 별도로 관측해야 실제 결과 수락이다. 원문 답변·claim token·서명 키·callback URL은 로그에 출력하지 않는다. 이 fixture는 메모리 상태·유한10분 구독·cursor null이며 재시작 복구/production idempotency를 광고하지 않는다. 종료/재시작 뒤 자동 재구독·새 probe 전송은 하지 않고 원래 native 작업과 대조한다.

사용자가 ID를 제공한 뒤 `/home/firewine/.local/state/webjjoku/dot-mcp-d0/profiles/webjjoku-dot-d0.yaml`에 전용 profile을 생성했고0600을 확인했다. 실제 ID는 공개 문서에 복사하지 않는다. 이 전용 디렉터리의 profile을 읽을 때는 `TUNNEL_CLIENT_PROFILE_DIR`을 해당 `profiles` 경로로 지정해야 한다. `doctor:dot`의 기본 앱 metadata 점검은 이 fixture profile을 자동으로 읽지 않는다.

사용자의 로컬 key 입력 후 doctor의 로컬 설정 검증은 통과했지만, 실제 runtime에서 metadata403·poll401 `tunnel_use_forbidden`을 관측했다. `/healthz`·`/readyz`의 HTTP200도 함께 관측했으므로 **로컬 health만으로 control-plane 권한/연결 성공을 판정하지 않는다.** 해당 D0 프로세스만 중지했고 운영 webjjoku는 동일 PID4089462로 active/running이었다.

사용자는 처음에 “다른 조직의 키였음”을 답변했고 이후 전용 key를 다시 만들어 새 파일 `runtime-key-tunnel`에 직접 입력했다. 해당 파일이 private/사용자 소유이며 기존 key와 실제로 다른 값임을 확인했다. 기존 key와 profile backup은 보존하고 **D0 profile의 file reference만** 새 파일로 변경했다. 새 key에서도 동일한403/401을 관측했으며 key 자체가 로그에 없음을 확인했다. 일반 키의 All 설정이나 재발급 자체를 권한 해결로 간주하지 않는다.

공식 CLI `admin --json tunnels get`을 **새 runtime key만** 사용해 읽기 전용으로 실행한 결과도 `GET /v1/tunnels/<원래ID>`에서403이었다. admin key·생성/수정 API는 사용하지 않았다. 사용자가 제공한 Organization을 `--control-plane.organization-id`로 명시한 세 번째 시도도 동일한403/401이었다. 실제 ID/조직 ID·key·개인정보는 공개 기록에 넣지 않았다.

두 번째 시도에서 `/healthz`·`/readyz`는200이었지만 `commands_poll_cycles_total=10`, `commands_poll_errors_total=10`, `commands_poll_last_successful_timestamp_seconds=0`을 관측했다. 즉 local ready는 OpenAI가 이 터널을 허용했거나 실제 native 요청을 받았다는 증거가 아니다. 세 번째 시도도 권한 실패 확인 뒤 종료했다. 현재 D0 터널 프로세스는 실행하지 않는다.

원래 터널·키를 삭제하거나 조직/워크스페이스 연결·역할을 임의 변경하지 않았다. 실제 허용된 Organization/ChatGPT workspace 목록과 발급 주체의 조직 수준 Read+Use를 대조해야 한다. [공식 Tunnel 권한 안내](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)는 조직 수준 Read+Use와 workspace association을 별도로 요구하며 역할 반영에 최대30분이 걸릴 수 있다고 안내한다. 서버 응답만으로 조직 불일치·권한 누락·연결 매핑 중 하나를 원인으로 확정하지 않으며, 권한 실패를 추가 OAuth나 인증 해제로 우회하지 않는다.

실제 dot 구독/응답은 계속 NOT_RUN이다. 성공하면 그 시점의 native/도구/event 증거를 추가하고 D0를 판정한다. 도구 설치/profile/doctor 성공 자체를 터널·계정 연결 완료로 표시하지 않는다. [draft PR36](https://github.com/firewine/webgpt/pull/36)은 이 미완료 경계를 명시한다.
