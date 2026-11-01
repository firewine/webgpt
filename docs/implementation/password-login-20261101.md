# 개인 비밀번호 로그인 — 2026-11-01

## 승인과 코드 기준

사용자가 개인용 비밀번호와 **새 비밀번호 바로 아래 동일 비밀번호 확인**을 명시했다. [사전 범위·R1~R8 영향](../reviews/password-login-impact-20261101.md) 뒤 기존 소유자 인증/화면/운영 절차를 개정했다. 기준은 PR #32 병합 main `5605982`, 브랜치는 `codex/password-login-20261101`이며 검사 소스는 이 문서를 포함한 PR head/CI SHA로 식별한다. 실제 사용자가 쓸 비밀번호를 개발자가 선택하거나 운영 DB에 저장하지 않았다.

## 구현

| 흐름 | 코드·동작 |
| --- | --- |
| 첫 설정·이후 로그인 | `control.html/control.ts`: 새 비밀번호/확인2칸을 세로 배치하고 일치할 때만 저장. 이후 비밀번호1칸. token 입력란/회원가입·사용자명 없음. Unicode·공백·자동완성 지원, 성공/취소 시 입력 비움 |
| 서버 저장 | `workspace/password.ts`, `model.ts::ownerPassword`: 내장 scrypt N=2^17/r8/p1, 랜덤32바이트 salt/64바이트 해시·scheme/versioned credential ID만 저장. NFC 기준15~128자, trim/잘라내기 없음. 평문/확인값을 DB/event/command/log에 남기지 않음 |
| 첫 소유자 확인 | `Access.setup/setupLink`: 기존 유효 소유자 세션 또는 서버 owner Bearer로 만든10분/1회 링크. 타인 선점·만료/중복/옛 credential 링크는 거절. link secret은 hash만 저장하고 브라우저에서는 fragment 소비 직후 URL에서 제거 |
| 로그인/변경/복구 | `Access.login/change/setup`, `http/workspace.ts`의 `/api/auth`, `/api/password/*`. 비밀번호 확인은 비동기·동시1개, 실패5회/분 제한. 현재 비밀번호 확인 후 변경, 서버 operator Bearer로만 발급하는 `password:reset` 링크로 분실 복구. 웹 cookie만으로 복구 링크를 만들 수 없음. credential ID/새 세션/링크 폐기는 동일 Store transaction |
| 세션 | 기존12시간 HttpOnly/SameSite=Strict·HTTPS Secure 유지. 설정/변경/복구 후 이전 cookie는 폐기하고 현재 기기에만 새 cookie. Host/Origin·noVNC/SSE 인증과 MCP grant 분리는 유지 |
| 도구·호환 | `scripts/ops.mjs`, `package.json`: 실행 중인 서버에 `password:setup`/`password:reset`으로 비공개 링크를 요청. 비밀번호를 인자/환경/URL에 넣지 않음. 기존 access-token/.env는 ops/readiness·복구와 기존 API 호환으로 보존. 웹 로그인에서 직접 입력하지 않음 |
| 복구 UI | 같은 탭의 hash 이동/로그아웃과 링크 전환을 처리. 설정 응답을 잃으면 공개 설정 상태만 다시 읽고 로그인으로 안내. 쓰기를 자동 재전송하지 않음. 늦은 인증 상태 응답은 sequence로 차단 |

기존 Store·Access·쿠키·HTTP·UI를 조합하고 해시/검증만 작은 함수로 분리했다. 새 계정 서버·DB·인증 dependency는 없다. 시작 시 잘못된/future credential schema를 검증해 거절한다. provider OAuth/DeepSeek/Anthropic/browser 인증·역할·계정·토의·큐·Wiki·Codex 승인/격리·API/도구 한도 정책은 바꾸지 않았다.

## 검증

| 방법 | 결과·범위 |
| --- | --- |
| `npm run check` | strict TS/빌드 및 전체 Node354 PASS, FAIL/SKIP0 |
| `node --test tests/password-auth.test.mjs` | 신규9 PASS. 실제 scrypt·첫 설정 보호/일치·Origin·1회 링크/만료·두 설정 경쟁·12시간/로그아웃·현재 암호·이전 세션/링크 폐기·복구/기존 state·실패/동시 계산 제한·Secure/schema·CLI |
| 실제 Chromium·Chrome MCP 전체 fixture | 57 PASS, FAIL/SKIP0. Chromium156.0.8078.4, MCP1.12.0. 원래 AI 계정/실제 기존 Chrome 대화는 사용하지 않음 |
| 신규 UI3개 | 2칸 위치/비밀 입력·불일치 POST0·1칸/새로고침·390px·local/sessionStorage 저장0, 첫 소유자 보호·fragment 비밀 유출0·변경/복구·로그아웃 직후 링크, 응답 유실 뒤 쓰기1회/로그인 |
| 마지막 검토 보완 | cookie만으로 setup/reset 링크를 만들지 못하고 서버 Bearer만 허용하는 검사 포함 Node354 PASS. 로그인 버튼 권한 상태 유지·성공 안내를 포함한 신규 UI3개 재검사 PASS |
| Codex 설치 계약 | CLI0.165.0 생성 schema PASS, thread/model turn 실행0 |
| 원래 사용자 파일 | untracked35파일 SHA-256 전부 일치 |
| GitHub CI | PR head의 Check workflow에서 별도 확인 |

기존 fixture는 `workspace-helpers.mjs`에서 구조상 유효한 이미 설정된 테스트용 owner verifier를 명시하고, 첫 설정 검사는 passwordUnset fixture와 실제 scrypt를 사용한다. 기존 API key 로그인 테스트를 삭제하거나 provider/auth·G0의 기대 결과를 낮추지 않았다. 실제 프로세스 UI 검사는 첫 설정2칸과 다음 기기 비밀번호 로그인을 수행한다. OWASP의 [password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)·[authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)을 해시/길이 판단 근거로 대조했으며 전체 보안 인증이나 실제 사용자 수락으로 확대 해석하지 않는다.

## 운영 적용·복귀

운영 비밀번호 설정/재설정·키 변경·서비스 재시작·새 배포·방 on·실제 모델/브라우저 전송은 NOT_RUN이다. 사용자 비밀번호는 [운영 절차](../operations-runbook.md)의 첫 설정 화면에서 본인이 입력한다. 기존 소유자 cookie가 있으면 즉시2칸을 쓰고, 없으면 갱신된 서비스에서 `npm run password:setup` 링크를 연다. 실제 PW/링크를 채팅으로 요청하거나 공개 저장소에 넣지 않는다.

비밀번호 변경/재설정은 다른 기기의 앱 세션을 폐기하지만 provider 실행 자체를 취소하거나 재전송하지 않는다. 데이터/해시·원래 키를 지우거나 과거 DB를 복원해 비밀번호를 우회하지 않는다. 복귀는 G0 off·진행/미확정 대조 후 읽기 전용/flag off로 수행하고, 분실 복구는 명시적 서버 reset 링크를 사용한다.

## 후속 변경 — 최소6자 (2026-11-01)

사용자가 ‘최소 요구 비밀번호는6자리로 해줘’라고 명시했다. PR #33/#34 병합 main `6052105`에서 새 작업 브랜치로 최소 길이만6자로 낮췄다. 서버 `passwordValue`, 클라이언트 `checkPasswords`, 첫 설정/변경 화면·오류 안내와 운영 절차를6~128자로 맞춘다. 위 표의 최초15자는 이전 정책 이력이다. 현재 정책이 최초 OWASP 길이 권고와 같다고 주장하지 않는다.

기존 비밀번호/해시·salt/scrypt·일치 확인·단일 해시 계산·시도 제한·12시간/세대 세션·설정/복구 소유자 확인·계정/실행/예산은 유지한다. DB 이관이나 기존 비밀번호 재설정은 하지 않는다. R1~R8 및 후속 실행 기능에 재작업은 없다.

검증은 기존 인증 fixture의 비밀번호를6자로 바꿔 설정/로그인/변경/복구를 왕복하고, 경계5자 거절/6자 허용/128자 허용/129자 거절·브라우저5자 POST0을 확인한다. 실제 운영 비밀번호 설정/변경·배포·서비스 재시작은 미실행이다. 검사 결과는 이 변경의 PR head/CI로 확인한다.

로컬 결과: `npm run check`의 Node359 PASS·FAIL/SKIP0, 실제 Chromium156.0.8078.4의 로그인 UI3 PASS·FAIL/SKIP0이다. 6자 비밀번호로 첫 설정/로그인/변경/복구 전체를 수행했고 5자 입력은 브라우저에서 POST0으로 거절했다. 기존 사용자35파일 SHA-256과 문서 링크·diff 검사도 PASS다. 최종 CI는 PR 본문에서 해당 head로 대조한다.

최초 CI는 Node/비밀번호 검사는 통과했으나 기존 주제 채팅 fixture가 AI 목록의 비동기 로딩 전에 개수를 검사해 브라우저61 PASS/1 FAIL이었다. `tests/browser/topic-chat.test.mjs`의 fixture 준비에서 주제5개·AI5개가 로드되는 조건을 기다리도록 보완했다. 기대 개수/공개·전송0 기준은 유지하고 실제 UI나 비밀번호 정책의 범위를 넓히지 않았다.

로딩 대기 보완 후 실제 Chromium에서 비밀번호3개+주제 채팅5개, 합계8개가 PASS·FAIL/SKIP0이다.
