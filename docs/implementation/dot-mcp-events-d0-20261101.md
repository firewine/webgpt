# 공식 dot 연결 D0 — 준비 상태·계약 점검

2026-11-01 KST 작성·11-02 후속 검사. 기준 main `ce8d9717ca34a77f458f47a8eb2f98cc793b2fcf`(PR #35), 작업 브랜치 `codex/dot-mcp-events-d0-20261101`. [사용자 승인 범위](../reviews/dot-official-mcp-events-impact-20261101.md)·[SSOT](../development-plan.md)를 따른다. **Platform 터널 대상 보정 후 연결·도구 발견·조회는 PASS다. native 감시 등록 오류와 schema cache 충돌을 관측했으며 전체 이벤트/응답 왕복은 미완료다. 최신 경과는 §7을 따른다. D1 이후 종속 구현은 착수하지 않았다.**

## 1. 승인 반영과 보존

사용자는 계획 개정·개발을 승인하고 D0부터 시작하도록 지시했다. dot을 일반 ChatGPT `/c/...`·browser와 분리하고 Muse의 현재 연결을 유지한다. SSOT와 연결·토의·실행 순서·living design·운영/수락 계획을 이 방향으로 개정했다. R4-D/R8-D의 잘못된 dot 기존 thread 전제만 공식 dot 왕복으로 정정하며, Muse 원래 thread와 기존50 gate의 수준은 유지한다.

기존 Providers.complete·Store transaction·공통 dispatch·토의/상주 parser·원문/ID·승인·미확정 대조·API 일일 한도는 변경하지 않았다. 제품 `src/` 변경은 없다. 새 API 연결·모델·운영 참여자/모의 참여자·토의/방을 생성하지 않았다. 사용자가 만든 추적되지 않은35파일은 private manifest와 대조해 보존 여부를 확인한다. 운영 모델 API 호출0·운영 토의/방 변경0이다. 사용자가 실제 dot에 요청한 합성 감시 시도는 §7에 별도로 기록한다.

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
| 전용 Tunnel profile | PASS | 실제 Platform 터널 ID로 보정해 private profile에만 기록. `sample_mcp_stdio_local`·합성 fixture·file key reference·loopback ephemeral admin 포트, 0600. 기존 profile/key backup 보존 |
| 최종 read-only 준비 상태 | BLOCKED / exit2 | `npm run doctor:dot`: installed=true, 이 프로세스의 ID/key·검사용 scoped grant 부재. native 성공·추가 권한을 추정하지 않음. D0 합성 stdio fixture는 별도 경로이며 운영 앱 grant가 필요하지 않음 |
| 현재 MCP의 Events/응답 계약 | NOT_AVAILABLE(격리 HTTP 관측) | 실제 임시 앱의 scoped legacy grant로 initialize/tools/list/events/list 확인: tools-only, Events/전용 응답 도구 없음. 기존 result_submit은 근거 제출임을 유지 |
| 새 D0 점검 도구·합성 fixture | PASS(fixture) | 11/02 `node --test tests/dot-preflight.test.mjs tests/dot-mcp-d0.test.mjs`: 16검사 PASS. 실제 stdio child·challenge/서명·일회 이벤트·중복/범위·진단 비밀 비노출·고정 catalog/현재 ID 대조·등록 전 답변 거부/단계 안내 포함 |
| 전체 Node/정적 검사 | PASS | 11/02 격리 checkout에서 `npm run check`: strict TypeScript·빌드·Node375 PASS, fail0/skip0. 이전 e446c6a의369검사와 구별 |
| GitHub CI | PASS(코드 head e446c6a) | [run41311295483](https://github.com/firewine/webgpt/actions/runs/41311295483): Node369·browser62 PASS, 양쪽 fail0/skip0, 설치 Codex contract 성공. fixture CI와 native dot 실계정을 구별 |
| 로컬 browser GUI 검사 | NOT_RUN(이번 변경) | 제품 GUI/src 변경 없음. 위 browser62는 이번 GitHub CI의 실행 결과이며 로컬 재실행·실기기 성공을 뜻하지 않음 |
| runtime key 로컬 입력 | PASS(보관만) | 사용자 직접 입력한 파일이 해당 사용자 소유·private/nonempty임을 확인. 값은 출력/commit하지 않음. 키 존재를 터널 접근 권한 성공으로 표시하지 않음 |
| tunnel-client doctor | PASS(로컬 설정)/SKIP(원격 확인) | `--explain`의 profile/key reference/실행 파일·ephemeral health bind 확인. stdio MCP 원격·OAuth metadata는 SKIP, optional Codex plugin도 SKIP. 실제 control-plane 인증을 검증한 결과가 아님 |
| 실제 Tunnel control plane | PASS(대상 보정 후) | 초기403/401은 원래 ID 대상의 결과. 실제 Platform 터널 ID를 복사해 보정한 뒤 같은 새 전용 key로 metadata 조회 exit0·org/이름 일치·workspace association1·polling 성공을 확인. 초기 key의 권한은 재검증하지 않음 |
| 실제 dot 도구/Events 발견·조회 | PASS | 사용자 화면에 get/claim/submit 도구3·event1 표시, 실제 dot의 get 사용자 보고와 진단 목적 read-only get 성공. Codex가 claim/submit을 대신 호출하지 않음 |
| 실제 dot·Events·MCP 결과 왕복 | FAIL(초기 감시 등록)/후속 확인 대기 | 작업 서비스 오류·`events/subscribe` transport409·후속 child 도달0 관측. callback에 들어갔다는 증거 없음. schema cache 오류/안내 보완 및 설치 CLI의 공식 초기화 shim 적용 후 실제 notification1 확인. native 감시/이벤트/응답/종료는 여전히 미완료 |

전체 검사는 `/tmp/webjjoku-dot-d0-validation-20261101`의 독립 checkout과 임시 DB/모의 provider에서 수행했다. 빌드 스크립트가 `dist/`를 삭제/재생성하므로 운영 저장소의 `dist/`에서 검사하지 않았다. 실제 운영 `webjjoku`·desktop 서비스 재시작/배포는 하지 않았다.

## 3. 추가한 D0 도구와 사용법

실제 파일:

- `scripts/dot-preflight.mjs::readDotPreflight/inspectDotProtocol`: read-only health/metadata 점검과 보수적인 상태 판정.
- `tests/dot-preflight.test.mjs`: 실제 격리 HTTP 앱과 응답 fixture로6경계 검증.
- `package.json`: `npm run doctor:dot` 추가. 앱 빌드/서비스 시작과 독립적으로 실행한다.
- `scripts/fixtures/dot-mcp-d0.mjs::createDotD0Fixture/postPublicWebhook/signedWebhook`: 실제 dot의 기능 검증용 **합성 데이터 전용** stdio MCP 서버. 운영 Workspace/키/Chrome/대화/도구를 읽거나 변경할 경로가 없다.
- `tests/dot-mcp-d0.test.mjs`: 실제 stdio 프로세스와 이벤트/응답·서명·권한·진단·catalog/단계 안내 회귀10개. 준비 점검6개와 합쳐16개다.

D0 점검/fixture 코드와 검사 합계는4파일이며 package script/계획·증거 문서는 별도다. 최초385줄에서 진단·고정 schema 회귀를 보강했으며350~500줄 추정 범위 안이다. 승인된 D0 최소 왕복 범위 안의 오류 수정이며 전체 기본안40~52파일·2,700~4,200줄 범위를 확대하지 않는다. 이후 production Events/재시작/identity/grant 구현을 이 fixture가 대신하지 않는다.

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

두 번째 시도에서 `/healthz`·`/readyz`는200이었지만 `commands_poll_cycles_total=10`, `commands_poll_errors_total=10`, `commands_poll_last_successful_timestamp_seconds=0`을 관측했다. 즉 local ready는 OpenAI가 이 터널을 허용했거나 실제 native 요청을 받았다는 증거가 아니다. 세 번째 시도도 권한 실패 확인 뒤 종료했다. 이 단락은 대상 ID 보정 전의 이력이며 최신 D0 runtime은 §7을 따른다.

원래 터널·키를 삭제하거나 조직/워크스페이스 연결·역할을 임의 변경하지 않았다. 실제 허용된 Organization/ChatGPT workspace 목록과 발급 주체의 조직 수준 Read+Use를 대조해야 한다. [공식 Tunnel 권한 안내](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)는 조직 수준 Read+Use와 workspace association을 별도로 요구하며 역할 반영에 최대30분이 걸릴 수 있다고 안내한다. 서버 응답만으로 조직 불일치·권한 누락·연결 매핑 중 하나를 원인으로 확정하지 않으며, 권한 실패를 추가 OAuth나 인증 해제로 우회하지 않는다.

이 시점까지 실제 dot 구독/응답은 NOT_RUN이었다. 대상 보정과 실제 시도 이후 판정은 아래 §7을 따른다. 도구 설치/profile/doctor 성공 자체를 터널·계정 연결 완료로 표시하지 않는다. [draft PR36](https://github.com/firewine/webgpt/pull/36)은 이 미완료 경계를 명시한다.

## 7. 실제 Platform 터널 보정·native 등록 실패·D0 진단/스키마 수정

11/01 밤 사용자가 실제 Platform Tunnels의 `ubuntu_dot` 행에서 전체 ID를 복사해 제공했다. 처음 제공한 외부 연결용 형태의 ID와 달랐고, **실제 Platform ID만 보정한 뒤 동일한 새 전용 runtime key로 metadata 조회가 성공**했다. 이름/조직 일치·ChatGPT workspace association1개와 polling 성공을 확인했다. profile/key backup을 보존했다. 초기 key는 이 실제 터널에 재시험하지 않았으므로 그 key도 허용됐을 것이라고 쓰지 않는다. ID/조직/개인 계정은 공개 문서에 기록하지 않는다.

사용자가 ChatGPT에 `ubuntu_dot`을 등록하고 도구3개와 `webjjoku.turn_requested`1개가 보이는 화면을 제공했다. 실제 dot은 get 이후 이벤트 감시 등록 단계에서 작업 서비스 오류를2회 보고했다. 서버는 `events/subscribe`2회의 `tunnel_service_status=409` 지표와 `response already fulfilled or unknown request` 경고를 남겼다. §9의 설치본 소스 대조 결과 이 지표는 **forwarding transport의 상태이며 callback이나 원격 response POST의 HTTP 상태가 아니다.** 원래 fixture에 내부 진단이 없어 당시 challenge/서명/HTTP 실패 원인은 UNVERIFIED다. 이벤트 전송·답변 수락 영수증도 확인되지 않았다.

사용자는 첫 작업 미등록과, 조회 목록에 두 번째 작업이 없고 ID/상태를 확인할 수 없다는 결과를 제공했다. Codex의 별도 read-only get은 syntheticOnly=true·replyAccepted=false를 확인했다. 두 번째 등록을 취소 완료로 간주하거나 자동 재구독/재전송하지 않았다. private0600 종료 receipt에 원래 probe/request·미확인 상태를 보존하고 해당 D0 runtime만 SIGINT로 종료했다. 운영 앱은 PID4089462로 active/running이었다.

`createDotD0Fixture`에 메모리 진단을 추가했다. `dot_turn_get`은 subscribe/unsubscribe 횟수·구독 NONE/ACTIVE/EXPIRED·일회 delivery 상태·accepted receipt와 최근16개 관측만 반환한다. 콜백 시작/실패·HTTP 숫자 상태·challenge 존재/일치 boolean·허용된 오류 분류를 구별한다. URL·서명 키·claim token·응답 원문·임의 예외 문구는 반사하지 않는다. 응답이 불명확한 이벤트는 deliveryAttempted를 유지해 조회나 재호출로 재전송되지 않는다. fixture의 무영속/10분/합성 전용 한계와 기존 SSRF·서명 검증은 유지한다.

11/02 첫 진단 probe에서 사용자가 **현재 get ID와 감시 schema에 남은 이전 ID의 불일치**를 보고했다. get으로 실제 subscribeRequests0·subscription NONE·replyAccepted=false를 대조했다. 원인은 fixture의 임시 probe/request ID를 discovery schema의 enum에 고정한 구현이다. tool/event catalog를 재시작 전후 동일한 형식 schema로 고쳤고, 요청 handler에서 현재 probe/request를 정확히 대조하는 범위 검사는 유지했다. 과거 schema에 맞추려고 이전 ID를 재사용하거나 서버 범위를 완화하지 않았다. 이 미등록 probe도 private receipt를 보존해 종료했다.

fixture0.3.0을 새 D0 runtime으로 시작하고 read-only get의 진단·구독0/전송 NOT_RUN을 확인했다. 사용자가 앱 도구 갱신 후에도 실제 dot의 감시 schema가 이전 ID만 허용한다고 보고했다. 감시·claim/submit은 실행하지 않았다. 로컬 `/health/mcp`는 실제 실행 서버 버전0.3.0·child running·initialize 성공을 확인했다. 한편 현재 Codex에 노출된 `ubuntu_dot` claim/submit 도구 정의도 여전히 이전 requestId의 literal type이었다. **실행 서버와 소비자 discovery snapshot의 불일치**까지 확인했으며 캐시가 어느 계층에 있는지는 UNVERIFIED다. 서버를 또 재시작하거나 옛 ID를 수락하지 않고 현재 probe를 유지한다. 같은 private Tunnel에 별도 D0 검사 plugin을 등록해 이전 snapshot과 분리하고 새 metadata를 확인하는 것이 다음 진단이다. 신규 OAuth·새 key·새 Tunnel·공개 ingress는 필요하지 않다.

새 감시 성공·native 응답 수락·감시 종료는 아직 UNVERIFIED다. 새 plugin의 catalog에서 임시 ID enum이 제거됐는지를 먼저 확인하고 그 뒤 한 번만 실제 감시를 진행한다. 실패하면 get의 진단으로 대조하며 자동 재시도하지 않는다. 실제 dot이 아닌 Codex의 read-only get을 native 참여자의 완료 증거로 사용하지 않는다.

검증 방법/결과: 격리 checkout에서16관련 검사 PASS, `npm run check`의 TypeScript·빌드·Node375 PASS(fail0/skip0). 진단 HTTP401/잘못된 challenge/DNS 오류·16개 제한/비밀 비노출·불명확 전송의 재전송0·재시작 전후 catalog 동일/이전 ID 거절·구독 전 답변 거부/단계 안내를 추가 검증했다. browser62/Codex contract는 이전 CI의 결과이며 이 수정본의 재실행으로 표시하지 않는다. 운영 `dist/`·서비스/Serve·Muse는 바꾸지 않았다. 추가 OAuth·공개 ingress·제품 계약/수락 완화·D1 구현도 없다. rollback은 합성 runtime만 중지하고 종료 receipt·원래 기록을 보존하는 것이며 운영 데이터 초기화는 필요하지 않다.

## 8. 사용 예제 대조와 등록 전 답변 오류

사용자는 별도 검사 plugin 등록 완료와 조회 성공을 보고했으나 확인 요청은 `-32602 D0 request not accepted`, 답변 미제출이었다. 직후 get은 subscribeRequests0·subscription NONE·delivery NOT_RUN·replyAccepted=false였고 runtime 경고도 없었다. 구독 요청은 도달하지 않았다. 당시0.3.0 오류만으로 어떤 write 도구/인자가 거절됐는지는 확정하지 않는다.

사용자의 예제 조사 요청에 따라 공식 Events/metadata 갱신 절차와 실제 dot-probe 작성자의 [고정 commit](https://github.com/rokrokss/recly/commit/edb2765d5498c792e43d898946d149ae6ba36303)을 정적으로 대조했다. 실제 이벤트 기동 뒤 read tool로 내용을 가져와 처리한 보고를 현재 get→claim→submit 흐름에 대응시켰다. 공개 HTTP/OAuth/Funnel 코드는 복사/실행하지 않았다. [공식 갱신 절차](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)에 있는 새 대화 단계도 안내에 반영했다. 외부 사례의 성공을 현재 계정의 성공으로 표시하지 않는다.

fixture0.4.0의 get은 현재 단계 `SUBSCRIBE/WAIT_FOR_EVENT/STOP_MONITORING`과 event.name/arguments를 반환한다. 기존 get의 무조건적인 답변 제출 안내를 등록 우선으로 정정했다. write는 현재 request와 active subscription 검사를 계속 사용하고 `current_request_required/subscription_required/subscription_expired`를 안전하게 구별한다. 거절된 허용 도구명/안전한 분류만 최근 관측에 남긴다. 스키마 형태는0.3.0과 같고 임시 ID를 enum에 다시 넣지 않았다.

교체 전 get으로 감시/전송0·미수락을 확인하고 private 종료 receipt를 남겼다. D0 runtime만0.4.0으로 교체한 뒤 read-only get의 nextAction SUBSCRIBE·구독0을 확인했다. 운영 서비스/Muse는 유지했다. [검사 절차](../dot-mcp-d0-test.md)의 단일 요청을 실제 dot에 보내 native 감시 작업 생성부터 대조한다. 계정의 구독 기능 미노출이나 작업 서비스 오류가 계속되면 원래 상태/오류를 남기며 자동 polling·임의 callback·추가 OAuth로 우회하지 않는다. **이 기록 시점의 native 전체 왕복은 미완료다.**

## 9. native 구독 child 도달0·stdio 초기화 보완

단일 요청 후에도 사용자가 native 감시 등록의 작업 서비스 오류를 보고했다. 직후 fixture get은 subscribeRequests0·subscription NONE·delivery NOT_RUN·미수락이었다. 반면 CLI 지표에는 `events/subscribe`2회/`events/unsubscribe`2회의 transport409와 `server/discover`/tools/call200이 있었다. 따라서 당시 callback 오류로 단정할 수 없고, 적어도 fixture의 구독 handler에 도달하기 전 단계에서 실패한 것이다. 원래 task ID/등록 상태는 불명확하므로 취소 완료로 표시하지 않는다.

설치 v0.0.19의 build commit과 release tag를 대조한 뒤 공식 소스를 정적으로 읽었다. [`serialized_forwarding_transport.go`](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/pkg/mcpclient/serialized_forwarding_transport.go#L397)의 stdio guard는 initialize 성공+notifications/initialized를 요구하고, 준비되지 않은 legacy operational call을 **child에 쓰지 않고** HTTP409/JSON-RPC-32002/`mcp_initialization_required`로 반환한다. [`processor.go`](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/pkg/dispatcher/internal/processor.go#L604)는 이 transport status를 latency 지표에 기록한다. 앞의409를 원격 POST 반환 상태로 읽었던 해석을 이 근거로 정정한다. 원래 오류 payload는 당시 보존되지 않았으므로 이전 오류의 정확한 code까지 확인했다고 쓰지 않는다.

실제 설치본 `run --help`와 공식 [설정](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/docs/configuration.md)의 `--mcp.stdio-send-initialized-notification`을 확인했다. 공식 lifecycle/초기화 guard를 유지하면서 성공한 initialize 뒤 notification을 보내는 옵션이다. source의 `stdio_initialization_test.go`도 이 수명 순서를 다룬다. SDK/CLI를 패치하거나 guard를 끄지 않았다. 공개 소스를 제품으로 복사/실행하지 않았고 새 OAuth/네트워크 노출도 없다.

미등록/미전송을 get으로 대조해 private 종료 receipt를 보존한 후 D0만 해당 옵션과 debug 로그로 재시작했다. raw HTTP unsafe logging은 꺼 두고 로그는 private0600에 남겼다. fixture get에 단순 `initializedNotifications` 수신 횟수를 추가했으며 실제 stdio child 검사에서 응답/notification의 구별을 확인했다. 운영자의 원격 read-only get 경로에서 **initializedNotifications1·get 성공·polling 정상·구독0·미수락**을 관측했다. 재시작 직후 첫 read-only 조회의 일시 오류 뒤 다음 조회는 성공했다. native dot 자체의 초기화/전체 왕복 성공으로 확대 해석하지 않는다.

현재는 초기화 누락과 맞는 증상에 공식 보완을 적용한 상태이며 native 재검증 결과를 기다린다. 이전 실패 원인 확정이나 D0 PASS로 표시하지 않는다. native 호출이 계속 실패하면 같은 프로세스를 유지해 safe debug의 RPC code와 get 관측을 대조한다. user/model/event 재전송은 자동으로 하지 않는다. 이번 변화는 승인된 D0 오류 진단/수정 범위이며 전체 단계·추가 OAuth·D1 이후 수락을 바꾸지 않는다.
