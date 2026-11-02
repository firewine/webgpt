# D5 실환경 적용·수락 준비 — 2026-11-02

## 기준과 허용 범위

사용자의 PR #41 병합 후 “다음 페이즈 진행” 지시에 따라, 앞서 제시한 **서버 적용과 최대30분·provider 요청40회·DeepSeek High8회 이내의 혼합 검증**을 진행한다. 실제 Codex 실행은 제외하며 검증 종료 시 방을 off로 둔다. 기존 API 일일 잔여량·Muse 수동 조작 경계를 유지한다. 추가 OAuth, 공개 ingress, timeout 확대, 제품의 전역 채팅 한도를 추가하지 않는다.

PR #41은 2026-11-02 12:57:41 KST 병합됐다. 적용 main은 `befac863c3e8539faf2e189a7747f9f6d1bb757b`, 검사한 PR head는 `23abad876ad54558ebaa9fed02e23ee21c977b8f`다. 두 tree는 `22257918dc0aec82fc5d6213a820dd3a534ecf4d`로 같다. [병합 전 CI](https://github.com/firewine/webgpt/actions/runs/41384360145)는 Node477/browser65/Codex0.165 schema PASS다.

이번 변경은 D5의 기존 적용 절차5번인 **별도 검증 종료 제어**와 실행 증거의 구체화다. `src/`, 의존성, DB schema, 원래50 gate, D5-A~F 기준 변경0. GUI/후속 단계 확대도 없다. 기존 검증 manifest를 자동 검사 결과만으로 승격하지 않는다.

## 실제 관측

| 항목 | 실행·증거 | 판정 |
| --- | --- | --- |
| 정지 경계 | 기존 방1 owner API off. 준비/실행/미확정 turn0, 미해제 lease0, 실행 job0 | PASS |
| 백업 | Node SQLite online backup, private0600. 원래 state/vault/profile 유지 | PASS |
| 소스 적용 | 사용자 untracked35개와 새 추적 파일 충돌0. 별도 운영 브랜치로 main 적용, `npm run build` | PASS |
| 서비스 | 해당 `webjjoku`만 13:05:28 KST 재시작. 내부4090, 다른3000/기존 Serve/desktop 유지 | PASS |
| 보존 | `.env`·기존 connections/participants/discussions/messages/turns/Wiki/work·browser 수동 잠금 동일. 사용자 파일35개 해시 차이0 | PASS |
| 접속 | health workspace identity 정상, 기존 owner 키로 `/api/state` 정상. 실제 다른 기기 비밀번호 로그인·터치/IME는 미관측 | API PASS / 다른 기기 NOT_RUN |
| dot 권한 | 기존 방에 native 참여자1·발언 off. 소유자 확인 grant1·3도구·만료24시간·키0600. actor 암호학적 검증은 false 유지 | OBSERVED |
| 전달기 | `WJ_MCP_EXPECT_DOT=true`로 초기화/3도구/Events catalog 조회 성공·모델 호출0 | PASS |
| private Tunnel | D0 runtime0 확인 후 기존 터널/기존 file-reference runtime key 재사용. 별도 profile1·초기화 통지 옵션·metadata 조회/시작 정상. health/admin loopback | OBSERVED |
| Muse | 기존 binding의 계정/thread/URL 일치, 빈 입력창·ready·busy=false. 수동 잠금 유지 | 읽기 전용 PASS / 전송 NOT_RUN |
| DeepSeek | CoralBricks 토커 High. API policy=null이므로 기존 규칙상 호출 불가 | BLOCKED: 한도 미설정 |
| 실제 감시/응답 | 구독0·새 요청/receipt0. 실제 dot에게 새로고침·native 감시1개 등록 요청 | NOT_RUN |
| 혼합 검증 | 이번 단계의 새 provider turn0. 요청/시간 창을 아직 시작하지 않음 | NOT_RUN |
| 실제 Codex | roots/binding 미준비이며 이번 범위에서 제외 | NOT_RUN |

기존 GPT2·DeepSeek2·Muse1의 등록 메타데이터는 실응답 성공이 아니다. Muse send 버튼은 빈 입력에서 보이지 않으며 기존 `sendAppearsAfterInput` 계약을 유지한다. 초안을 만들거나 전송해 검사를 우회하지 않았다.

로컬 증거는 실제 state 디렉터리의 `dot-mcp-d5-live-20261102/`에 있다. `before.json`, `quiescent.json`, `before-deploy.sqlite`, `deploy-checks.json`, `muse-preflight.json`은 private0600이다. 계정/대화/필터 ID·grant·runtime key·callback URL을 공개 저장소에 복사하지 않는다.

## 검증 전용 종료 제어

`scripts/live-acceptance-guard.mjs::acceptanceGuard`는 검증 프로세스의 `DispatchCoordinator.reserve` 경계에만 제어를 결합한다. 기존 transaction에서 원래 예약 함수보다 먼저 판단한다. 통과한 요청은 기존 예약→전송 전 기록→provider/Events→receipt→대조 경로로 진행하며 엔진/Store를 재구현하지 않는다.

- 기존 lease ID를 baseline으로 고정하고 새 **영속 예약**을 센다. 실패·미전송도 보수적으로 포함한다. 재시작/새로고침으로 횟수를 초기화하지 않는다.
- 최대40회·DeepSeek8회. room/참여자/연결/모델/High/출력 snapshot 변경 시 거절한다. 기존 `snapshotMember`의 DeepSeek 기본값을 사용하며 API 일일 한도를 대체하거나 늘리지 않는다.
- 첫 예약부터30분. 기존 turn timeout에 해당하는 마지막5분에는 새 예약을 차단하고 원래 응답을 기다린다.40회 뒤 현재 응답이 끝나면 off/pause.30분에도 요청이 남으면 off/pause 후 원래 결과 대조를 남기며 완료를 만들거나 재전송하지 않는다.
- 임시 entry는 Codex roots가 있으면 시작을 거절하고 기존 `beforeDispatch` 훅에서 예외를 발생시켜 명령 전송도 차단한다.
- `scripts/live-acceptance-server.mjs`는 적용 build의 Workspace·HTTP·자동 runner를 사용한다. 기본 `npm start`, 일반 서비스, 제품 채팅 한도에는 연결하지 않는다.

**현재 entry는 격리 fixture에서만 실행했다. 운영 서비스는 정상 `dist/server/main.js`다.** 다음 절차 전 실제 혼합 방을 켜지 않는다.

1. private policy0600에 현재 roomId, baselineLeases, 허용 participant snapshot, `maxRequests:40`, `maxApiRequests:8`, `maxMs:1800000`, `drainMs:300000`을 고정한다. drain은 실제 timeout 이상이어야 한다. 이력 삭제나 baseline 재설정으로 횟수를 초기화하지 않는다.
2. 방 off/미확정0에서 이번 검증에만 entry를 `node --env-file=/실제/.env /검토한/scripts/live-acceptance-server.mjs /적용된/저장소 /보호된/policy.json`으로 지정한다. 단일 서비스만 실행하며 정상 entry는 복구 가능하게 보존한다.
3. health·소유자 인증·guard 초기 관측0/0·기존 IDs를 대조한다. native 감시, API 일일 정책, Muse 수동 잠금 조작 허용을 확인한 뒤 방/참여를 켠다.
4. 기존 안의 새 주제1/검토2라운드와 dot 자유발화·후속을 관측한다. 원문·반론·receipt/재분석·실제 사용량을 기록한다. 원격 감시의 지연을 이유로 timeout 계약을 임의 변경하지 않는다.
5. off/pause·미확정 대조·grant 회수·native 감시 종료 확인 후 전용 Tunnel runtime만 중지한다. off를 확인하고 임시 entry를 제거해 정상 서비스로 복귀한다. 새 기록을 지우려고 DB를 복원하지 않는다.

## 검사

```bash
node --test --test-reporter=spec tests/live-acceptance-guard.test.mjs tests/live-acceptance-server.test.mjs
npm run check
```

추가8개 PASS: 41번째 전송 전 거절·재시작 횟수 보존, API8회 제한·identity 변경 거절, 25분 신규 예약 차단/30분 off·pause, 기존 정책 위임·baseline 변경 차단, 범위를 넘는 policy 거절, 실제 ResidentRunner/Store transaction의 receipt/메시지 보존, 기존 DeepSeek snapshot 기본값, 실제 자식 entry의 HTTP/소유자 인증·off 종료. 모두 fixture이며 실제 모델 호출0이다.

Node24.18.0/npm11.16.0의 `npm run check`는 **485 PASS, fail/skip0** (`/tmp/webjjoku-dot-d5-live-check.log`). UI/제품 소스는 배포한 tree와 같아 로컬 browser 전체 검사를 반복하지 않았다. 새 PR의 CI는 원래 browser/Codex schema까지 실행하며 결과는 해당 commit의 Check로 구분한다.

## 사용자 확인 대기·다음 수락

1. 기존 플러그인을 새로고침한 실제 dot의 native 감시 등록 결과. 전달기 정상/도구 목록으로 대체할 수 없다.
2. API 일일 정책이 비어 있어 검증용 **오늘8회·보고된 토큰200,000** 설정 또는 이번 DeepSeek 제외를 요청했다. 아직 정책을 바꾸지 않았다.
3. Muse를 직접 사용 중이지 않을 때 검증 중 수동 잠금 해제·끝난 뒤 복구 또는 이번 Muse 제외를 요청했다. 계정/thread/draft 대조는 마쳤다.

방 off·dot 발언 off·API 미설정 차단·Muse 수동 잠금을 유지한다. 실제 응답/혼합/다른 기기/Codex gate는 미완료다. 새 페이즈를 만들거나 D5 완료로 선언하지 않는다.
