# 웹쫀쿠 (Webjjoku)

여러 GPT OAuth 계정·dot·Muse·API 참여자가 하나의 주제를 토론하고 검증하는 웹 서비스입니다. 현재 구현은 **WJ-001 연결 진단용 최소 프로젝트**입니다.

지금은 테스트 참여자 A/B를 선택해 메시지를 보내고, 서버가 돌려준 모의 응답과 완료 상태를 확인할 수 있습니다. 실제 AI 연결·대화 저장·자동 토론은 아직 구현하지 않았습니다. 모의 응답을 모델의 분석이나 검증 결과로 사용하지 않습니다.

## 실행

Node.js **24.x**, npm **11.x**가 필요합니다. 검증한 버전은 Node **24.22.1**, npm **11.9.0**, TypeScript **5.9.3**입니다. npm과 `package-lock.json`을 사용하며 실행 시 외부 패키지·모델·API key가 필요하지 않습니다. 최초 개발 의존성 설치에는 npm registry 접근이 필요합니다.

```bash
npm ci
npm run build
npm start
```

브라우저에서 <http://127.0.0.1:3000>을 엽니다. 참여자를 선택하고 메시지를 보내면 입력·모의 응답·요청 ID·완료 상태가 표시됩니다. 빈 메시지는 전송하지 않으며 최대 입력은 2,000 UTF-16 코드 단위(브라우저 `maxlength` 기준)입니다. 실패한 입력은 유지하고 연결이 끊겨도 자동 재전송하지 않습니다.

설정은 선택 사항입니다. `.env.example`을 `.env`로 복사해 필요한 항목만 변경하면 `npm start`가 읽습니다. 변경 후 서버를 다시 시작합니다. 환경 변수는 `.env`보다 우선합니다.

| 변수 | 기본값 | 허용 값 |
| --- | --- | --- |
| `WJ_HOST` | `127.0.0.1` | `127.0.0.1`, `::1` |
| `WJ_PORT` | `3000` | 정수 1–65535 |
| `WJ_LOG_LEVEL` | `info` | `info`, `silent` |
| `WJ_FAKE_DELAY_MS` | `350` | 정수 0–5000 |

잘못된 설정은 시작 전에 거절하고 변수명만 기록합니다. 로그에는 메시지·응답 본문, credential, 환경 변수 값, 원본 오류를 기록하지 않습니다. `.env`는 Git에서 제외합니다. `Ctrl+C` 또는 `SIGTERM`으로 종료하며, 진행 중인 요청의 종료를 최대 6초 기다립니다.

서버는 loopback에만 바인딩합니다. 사용자 인증이나 HTTPS proxy 설정은 아직 없습니다. **실제 Ubuntu 서버·Tailscale HTTPS·Chrome·noVNC 구성은 WJ-002**에서 확인합니다. 현재 POST origin 검사는 직접 연 `http://localhost`/loopback 화면에 맞춰져 있으며, Tailscale HTTPS를 연결할 때 신뢰할 proxy/origin 설정을 함께 구현해야 합니다.

## 검사

```bash
npm run check
npx playwright install chromium
npm run test:browser
```

`check`는 서버·웹 strict 타입 검사, 빌드, Node 테스트를 실행합니다. 설정 검증, 두 참여자의 HTTP 왕복, 잘못된 입력·중복 실행·provider 실패·중단, 로그 경계, 프로세스 시작·종료를 확인합니다. 브라우저 검사는 실제 서버를 띄워 Chromium에서 1440px·390px 화면의 메시지 전송·참여자 변경·오류 복구·새로고침을 확인합니다. 브라우저 설치 시 OS 의존성이 필요한 Linux에서는 `npx playwright install --with-deps chromium`을 사용할 수 있습니다.

각 검사는 fake adapter만 사용합니다. 실제 계정이나 과금되는 모델을 호출하지 않습니다. `test-results/`의 화면 캡처는 Git에 포함하지 않습니다. GitHub Actions에도 동일한 검사 흐름을 등록했습니다. 로컬 검사 통과와 원격 CI 결과는 별도입니다.

브라우저 다운로드를 사용할 수 없는 환경에서는 `WJ_TEST_CHROMIUM_EXECUTABLE` 환경 변수로 이미 설치한 Chromium 실행 파일을 지정할 수 있습니다. 검사 출력에 실제 브라우저 버전을 남깁니다. 기본값은 Playwright가 설치한 Chromium입니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/core/` | 최소 Participant/Turn 타입, adapter 계약, 단일 활성 요청 실행 |
| `src/providers/fake.ts` | 외부 통신 없는 명시적인 모의 응답 |
| `src/http/app.ts` | health, 참여자 목록, turn API, 허용한 웹 asset만 제공 |
| `src/web/` | 참여자 선택·입력·응답·상태를 보여주는 진단 화면 |
| `src/config.ts`, `src/logger.ts`, `src/main.ts` | 설정 검증·로그 경계·시작과 종료 |
| `tests/` | 계약·HTTP·프로세스 검사와 실제 브라우저 검사 |

한 개 npm 프로젝트, Node 내장 HTTP 서버, TypeScript로 구성했습니다. 실행 의존성은 없고 TypeScript·Node 타입·Playwright는 개발 의존성입니다. 웹 화면은 같은 서버가 제공하며 메시지와 응답을 HTML로 해석하지 않습니다.

| 경로 | 동작 |
| --- | --- |
| `GET /health` | 프로세스 준비 상태와 `mode: fake`, `persistence: none` 반환 |
| `GET /api/participants` | 테스트 참여자 A/B 조회 |
| `POST /api/turns` | `{ "participantId": "fake-a", "input": "연결 확인" }` → `{ "turn": ... }` |

turn은 adapter의 완료 반환을 확인한 뒤에만 `completed`가 됩니다. provider 실패는 `failed`/HTTP 502, 동시 요청은 HTTP 409, 잘못된 입력은 HTTP 400으로 구분합니다. 요청 본문은 16 KiB로 제한합니다. 기록은 서버에 저장하지 않으며, 브라우저에 표시한 최근 20개 요청도 새로고침하면 사라집니다. 후속 맥락, 영속 journal, 재시작 복구, streaming, 실제 provider 연결은 후속 작업입니다.

## 계획과 구현 기록

- [개발 계획서](docs/development-plan.md)
- [개발 실행 순서 PR #2](https://github.com/firewine/webgpt/pull/2)
- [WJ-001 구현·검증 기록](docs/implementation/wj-001.md)
- [Ubuntu 운영 계획](docs/ubuntu-operations.md)

다음 작업은 WJ-002 운영 환경 확인이며, 이후 WJ-003에서 GPT OAuth 1계정의 실제 왕복을 검증합니다. PR 병합은 사용자가 수행합니다.
