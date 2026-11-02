# D5 — 공식 dot의 기존 흐름 통합과 실계정 수락

## 기준·범위·판정

2026-11-02 사용자 지시 “병합 완료 다음 페이즈 진행”. [D4 PR #40](https://github.com/firewine/webgpt/pull/40)은 12:12:20 KST에 병합됐으며 기준 main은 **`8affb469c3e6ce5b636f465ff693d62ac45071b8`**, D4 head는 `8408c30719b7836382ef338fdb507df6ad4a5399`다. [D4 최종 CI](https://github.com/firewine/webgpt/actions/runs/41380886404)는 Node473/browser64/고정 Codex0.165.0 schema PASS다. D5 검사와 구분한다.

D5 작업 브랜치 `codex/dot-mcp-acceptance-d5-20261102`는 별도 worktree다. [승인된 D5](../reviews/dot-official-mcp-events-impact-20261101.md#6-단계별-대상변경량수락복귀)의 통합 fixture·50 gate 보존·실환경 적용 준비를 진행한다. 단계/수락 기준/후속 범위 변경은 없다. **자동 검사와 실계정 완료를 분리하며 D5 전체는 아직 미완료**다.

제품 `src/`, 의존성, DB schema, 운영 설정 변경 **0**. complete/JSON·Store transaction·단일 dispatch·요청 세대/claim/mailbox·API 전용 일일 한도·Human 승인·Muse 경로를 기존 그대로 사용한다. 추가 OAuth/공개 ingress/timeout 확대·새 전역 채팅 한도는 없다. 검사는 기존 Adapter/Composition 경계의 외부 통신만 합성으로 바꾸고 실제 HTTP/stdio/서명/영속 상태를 통과한다. 큐/Wiki/Codex를 별도 구현하지 않는다.

변경은 **11파일·460줄(add/delete 합산)**로 테스트/문서만 포함한다. 승인 예상9~13파일·500~800줄보다 줄 수가 작으며, 기존 구현의 계약 보완이 추가로 필요하지 않아 후속 범위·이관 확대 없이 통합검사에 집중했다.

## 자동 수락과 실행 방법

원래 [50 gate manifest](./resident-acceptance-manifest.json)는 수정하지 않는다. 역사적 PASS46/UNVERIFIED3/NOT_RUN1과 이전 실계정 부분 실패/후속 기록을 보존한다. 새 [D5 보완 manifest](./dot-acceptance-manifest.json)는 기존 ID와 추가 증거를 연결한다. `R3-E`, `R4-D`, `R6-F`, `R8-D`를 fixture만으로 승격하지 않는다.

| 추가 관문 | 실제 실행 경로·수락 숫자 | 판정 |
| --- | --- | --- |
| D5-A | owner HTTP 등록/확인 → private 0600 grant → 실제 `mcp-stdio.mjs` 자식 → `/mcp` → signed callback → get/claim/get/submit. 합성 GPT2·API1·native dot1, 긴 원문10,520자를 다른3명 입력에 보존, dot 업무 제안/보고2·다른 참여자 반려/수락·Wiki2버전·자동 주제1/검토2라운드·같은 방 복귀. 동시 provider 최대1, API만 정산 | PASS fixture |
| D5-B | 같은 submit20회→공개1/원래 receipt. 전달기 재연결/재구독·조회20회→새 turn0. off→on에 grant 재발급0·새 응답 허용. off 뒤 옛 요청의 늦은 원문/receipt는 격리, 회수 뒤 RPC 거절 | PASS fixture |
| D5-C | 기존 WorkExecutionBridge → 실제 자식 RPC fixture → 승인 대기 → owner 승인1 → 명령 exit0 근거 → native dot 독립 검토1. `untrusted/user` 유지, 같은 실행 시작1. dot grant로 Codex/Wiki/업무 직접 호출 거절 | PASS fixture, 실제 Codex 실행 NOT_RUN |
| D5-D | 설치 Chrome MCP1.12.0 + 실제 Chromium156의 합성 Muse side thread. native dot와 상주/2라운드 토론, Muse 전송6/고유 receipt6·dot 응답6. 작성 중 초안 전송0, 원래 DOM/binding/thread 보존, 조회20회 추가전송0 | PASS fixture, 실제 Muse 왕복 NOT_RUN |
| D5-E | 원래50 ID·미완료 판정 보존, 기존 Store/dispatch/권한·실제 SIGKILL/6개 native 요청 복구 경계 및 전체 Node/browser 회귀 | PASS fixture, Node477/browser65 fail/skip0 |
| D5-F | 운영 grant/개인 전용 Tunnel 범위·실제 dot 감시/자유발화≥1/주제 및 후속≥2·GPT2/API/Muse 혼합·실제 기기/Codex 읽기/쓰기 | **NOT_RUN**, 별도 허용/준비 필요 |

실행 명령:

```bash
npm run check
WJ_TEST_CHROME_MCP=/설치/경로/chrome-devtools-mcp \
WJ_TEST_CHROMIUM_EXECUTABLE=/설치/경로/chrome npm run test:browser
# 전체 실행에서 실패한 신규 관문만 좁혀 재검사할 때
node --test tests/dot-acceptance.test.mjs
# 고정 설치본의 계약을 별도로 확인
WJ_CODEX_BINARY=/검사한/0.165.0/codex npm run test:codex-contract
```

`test-results/dot-D5/{mixed-flow,reconnect,execution-review,muse-mixed}.json`은 합성 데이터의 수량/상태만 기록한다. 모델 원문·grant/attempt token·callback secret·운영 ID를 복사하지 않는다. D5-D는 `WJ_TEST_CHROME_MCP`가 없으면 SKIP이며 PASS로 합산하지 않는다. 공개 DNS 응답과 HTTPS 소켓만 loopback fixture로 치환했으므로 실제 DNS/TLS/Tunnel/ChatGPT actor 확인 증거가 아니다. GPT/API 응답과 Codex 명령 출력도 fixture다.

초기 통합검사에서는 fixture의 초기 optional 배열 접근과 callback 완료 대기 순서, Muse 입력의 correlation marker 처리 오류를 수정했다. Muse 초안 차단의 기존 오류 계약은 `browser_requires_intervention`이다. 제품 오류로 오인해 timeout이나 실행 경계를 바꾸지 않았다.

전체 browser 첫 실행은 검사 실행 순서 문제였다. 두 npm 명령이 같은 dist를 빌드하면서 browser import 때 산출물이 사라져 `ERR_MODULE_NOT_FOUND`가 났다. Node 빌드/검사를 마친 뒤 browser를 순차 실행하도록 바로잡았다. 다음 전체 실행은64/65 PASS로, 기존 `api-daily-choice.test.mjs`가 직접 바꾼 서버의 on 상태를 shared SSE snapshot이 받기 전에 즉시 판정했다. 기존 조건/모델 호출0 검사는 유지하고 해당 안내가 실제로 갱신될 때까지 기다리도록 보완했다. 관련2개 PASS 후 최종 전체 실행으로 확인한다. 실패한 로그도 `/tmp/webjjoku-dot-d5-browser-{build-race,sse-race}.log`에 보존한다.

최종 로컬 결과: Node24.18.0/npm11.16.0의 `npm run check` **477 PASS, fail/skip0** (`/tmp/webjjoku-dot-d5-check.log`), 빌드 후 설치 Chromium156.0.8078.4/Chrome MCP1.12.0의 전체 browser **65 PASS, fail/skip0** (`/tmp/webjjoku-dot-d5-browser.log`). 신규 Node4/browser1 포함이다. 제품 및 테스트 소스가 같은 PR head에서 CI가 고정 Codex0.165.0 schema와 전체 검사를 실행한다. 로컬 전역0.166.0을 고정0.165 계약 통과로 세지 않으며 CI 링크/상태는 해당 PR Check로 확인한다.

## 운영 서버 읽기 전용 확인

운영 서비스는 여전히 D0 소스 `9fb2dd9`에서 실행 중이다. D4 main 병합은 자동 빌드/배포가 아니다. `webjjoku` active/running, 내부 앱4090/기존 HTTPS8443이다. 다른 서비스의3000과 기존 Serve/desktop/Chrome 설정은 이번 작업에서 변경하지 않았다.

보호된 읽기 전용 진단에서 모델이 등록된 GPT 연결2·DeepSeek2·browser1, 준비된 GPT 토커2·DeepSeek2·browser1, 모의 토커0을 관측했다. 기존 방1은 on이고 browser 수동 조작 잠금이 켜져 있다. 활성/blocked 토의0, 실행 job0, Codex 허용 roots/읽기 binding 미준비다. **현재 실행본에는 운영 native dot 연결/구독이 없다.** 이 메타데이터는 실제 계정/후속 응답 성공을 의미하지 않는다.

진단은 `/tmp/webjjoku-dot-d5-preflight.json`(0600)에 보관했고 secret/개인 원문을 공개 문서에 넣지 않았다. 이 점검 자체의 모델 호출0이며, 이미 켜진 방의 전체 시간대 활동이 없었다고 단정하지 않는다. 운영 DB를 개발 Workspace로 열거나 상태를 덮어쓰지 않았다.

보존 대조: 기존 사용자 파일35개 해시 차이0, 운영 `.env` 해시 동일, 운영 branch/head 동일, 서비스 PID4089462와 시작 시각(11/01 18:14:58 KST)이 동일하다. 운영 재시작/배포·새 Tunnel/구독·실계정 호출은 이 작업에서 수행하지 않았다.

## 별도 승인 후 적용할 구체 절차

[승인된 계획 §6](../reviews/dot-official-mcp-events-impact-20261101.md#6-단계별-대상변경량수락복귀)은 “배포/실제 dot 모델 응답·Muse 전송·Codex 실행 허용은 이 추정만으로 부여되지 않는다”고 정한다. 이번 단계 진행 지시는 자동 검사/PR 준비에 적용하고, 아래 운영 변경·실계정 호출을 마지막에 별도 확인한다. D0의 한 번 합성 승인이나 과거 R8 호출 승인을 무기한 재사용하지 않는다.

1. **정지 경계 확보:** owner API로 기존 방 off, active topic pause, 승인/실행/미확정 요청이 있으면 원래 ID/receipt부터 대조한다. 방 off가 외부 작업 취소라는 가정은 하지 않는다. 원래 방 설정·멤버·API 정책·Muse binding/profile·서비스/.env·사용자 변경을 보호된 로컬 기준으로 기록한다.
2. **배포:** 최신 병합 main과 D5 검증 소스의 제품 tree가 같은지 확인한다. 현재 제품 기준은 `8affb46`이며 D5는 테스트/문서만 보완한다. 기존 운영 checkout의 사용자 파일과 충돌이 없을 때만 추적 소스를 갱신한다. 충돌하면 별도 release 경로를 마련하고 기존 작업을 보존한다. 온라인 SQLite 백업0600을 만들되 기존 vault/키/Chrome profile은 그대로 사용한다. `npm run build` 후 해당 `webjjoku`만 재시작하고 health·로그인·기존 IDs/receipt·off 상태를 확인한다. Serve/desktop/다른 서비스는 재설치하지 않는다.
3. **dot 연결:** 기존 방에 disabled native 참여자와 최대1일/세 도구 grant를 만들고, 소유자가 개인 전용 Tunnel의 조직/workspace 접근 범위를 확인한다. 새 private profile/grant 파일을 사용하며 D0 감시/runtime 종료를 대조한다. [연결 runbook](../dot-connection-runbook.md)의 초기화 통지·native 사전 검사·플러그인 도구 새로고침을 따른다. 별도 OAuth가 필수면 여기서 중단하고 영향/변경량을 보고한다.
4. **제한된 실호출 제안:** 최대30분·총40개 provider 요청, 그중 DeepSeek 최대8개를 기존 API 일일 잔여량 안에서만 허용받는다. DeepSeek는 사용자 선호 **High**를 유지하고 Max로 올리지 않는다. dot 자유발화1과 후속, GPT2+API+dot+Muse의 새 주제1/검토2라운드에서 원문·반론·receipt/후속 분석을 관측한다. Muse는 소유자가 기존 thread/초안을 확인하고 수동 잠금을 해제한 뒤만 전송한다. 새 검증의 synthetic 주제/메시지만 추가하며 기존 이력은 삭제하지 않는다.
5. **상한·종료:** 상주방은 전역 요청 한도가 없으므로 topic의 `maxRequests`를 전체 방 차단장치로 간주하지 않는다. 실행 전에 별도 관측 제어로 요청 수·시간과 현재 in-flight를 대조해 다음 예약을 막을 수 있는지 확인한다. 확인할 수 없으면 시작하지 않는다. 한도 도달 전에 방 off/topic pause, 원래 요청 결과 대조, grant/구독 회수·외부 감시 종료·전용 runtime 중지. 이 검증 종료 제어를 제품의 상시 전역 한도로 추가하지 않는다. 실패/미확정은 재전송하지 않고 기록한다.
6. **Codex는 분리:** 현재 허용 roots/binding이 없어 live 실행은 준비되지 않았다. 실제 thread/cwd·읽기/쓰기 범위·격리 검사와 별도 호출 허용 후 원래 R6/R8 gate로 진행한다. 위40회 혼합 검사에 실제 Codex 실행/쓰기/병합을 포함하지 않는다. 실제 기기의 HTTPS·터치/IME도 사용자 관측 없이 PASS로 바꾸지 않는다.

사용자 결정 필요: 위 배포/제한된 혼합 실호출 허용, 개인 전용 Tunnel 접근 범위 확인, 실제 Muse thread/초안 확인과 감시 설치. Codex 작업 위치/세션/읽기·쓰기 허용은 별도다. 아직 어느 항목도 완료로 기록하지 않는다.

## 복귀·후속

dot 참여 off → 미확정 원래 요청 대조 → 새 grant/구독 회수 → 외부 native 감시 종료 확인 → 전용 runtime만 중지한다. 기존 방·원문·Wiki·업무·receipt를 보존하며 새 결과를 지우려고 DB 백업을 덮어쓰지 않는다. D5에는 제품/DB 변경이 없어 D4 바이너리와 동일 계약이다. D1~D3 namespace를 모르는 D0 바이너리로의 무조건 downgrade는 하지 않는다.

원래 50개 기준과 D5-F 실제 수락이 남아 있으므로 “모든 개발/실계정 완료”를 선언하지 않는다. 추가 기능/인증/대기시간 변경 필요성이 실제 검사에서 드러나면 R1~R8·D1~D5 영향을 포함해 먼저 보고하고 승인받는다. PR 병합은 사용자 담당이다.
