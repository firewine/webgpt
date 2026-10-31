# 페이즈 8 — 병합 버전 적용과 기존 토의 재검증 / 2026-10-31

PR #29 병합 main **`2f3ca34e454f07c294c7e6eaa87cf052b7c79475`**에서 이어간다. [SSOT](../development-plan.md)의 현재 단계는 R8이며 새 페이즈/수락 기준을 만들지 않는다. main과 기존 검사 head `2b6e456`의 소스 tree는 **`0efe040666e42ab2f67fb5be7ff1232def796831`**로 같다. 기존 Node326·Chrome/MCP52·Codex0.165.0 계약 CI는 [이 실행](https://github.com/firewine/webgpt/actions/runs/41181606095/job/124479977649)에서 통과했다.

## 승인·보존·운영 적용

사용자가 다음 페이즈 진행을 요청했고, 실제 동작 범위 확인 뒤 **“서바 적용 후 테스트 승인”**으로 서버 적용·재검증을 허용했다. [출력 한도 승인 경계](../reviews/deepseek-output-limit-impact-20261031.md)에 맞춰 다음 범위를 고정했다.

- [기존 실제 토의](./phase8-real-api-20261031.md) 하나를 이어간다. 원래6요청/완료5/실패1·토의/실패 turn/receipt는 유지하며 새 토의를 만들지 않는다.
- 현재 토의의 DeepSeek-Coral만 **Max 유지·출력16,384**로 바꾼다. 전역 토커와 GPT2개의 모델/xhigh·기존 자료·주제 revision은 바꾸지 않는다.
- 추가 최대18요청·새20분 wall 창과 **원래 총24요청/100,000보고 token/활성1,140,000ms**를 함께 지킨다. 준비 당시 남은 활성 시간884,686ms, 보고 token 잔여77,638이다. 과거 실패 usage는 미보존이므로 이 숫자를 전체 실제 소비라고 주장하지 않는다.
- 이전 실행 창은 종료 상태로 두고 별도 private journal에 승인·원래 turn 해시·요청 key·새 창을 전송 전에 기록한다. 재차 실패/미확정이면 멈추며 자동 재개·사고 하향·예산 초기화·새 토의 우회는 하지 않는다. Chrome 대화 전송·Codex 실행은 이번 범위에 없다.

원래 DB의 online backup을 private 0600 파일로 만들고 다른 토의/전역 토커·방·browser 수동 잠금·job/binding의 해시를 고정했다. `.env`·기존 계정/vault·Chrome profile·다른 서비스는 바꾸지 않았다. `npm run build` 후 **2026-10-31 17:58:41 KST**에 `systemctl --user restart webjjoku`를 수행했고 loopback4090 health 정상·소유자 HTML의 새 출력 입력란을 확인했다. Tailscale origin/upstream·포트3000은 변경하지 않았다.

Coral의 실제 인증된 모델 목록을 기존 `models` endpoint로 다시 확인했다. Max 지원은 확인했으나 출력 최대치 필드는 보고되지 않아 **catalog 최대 출력 미확인**으로 보존했다. 앱 범위 안의16,384를 현재 토의에 저장하고 다시 읽어 Max/16,384·기존6요청/blocked·원래 turn 해시를 확인한 뒤 **17:59:16 KST**에 명시 resume했다. 원래 응답을 수정하거나 실패를 정상 완료로 승격하지 않았다.

## 검증과 실제 결과 — PARTIAL

**12요청(이번 추가6)·완료11/원래 실패1, 5분08.5초 뒤 `partial/budget_exhausted`로 종료했다.** 추가6요청은 전부 완료했고 DeepSeek의 원래 실패 task는 같은 prompt digest로 한 번만 재검토해 성공했다. 3초안·3인 상호 검토2라운드·검증2개까지 확인했고 수정/종합/종합안 검토는 실행하지 못했다. [원문 없는 수치·해시](./assets/r8-continuation-20261031/summary.json)와 [화면 검사 수치](./assets/r8-continuation-20261031/ui.json)를 함께 본다.

보고된 합계는 **입력94,025/출력28,988 = 123,013토큰**이다. 마지막 요청 전 합계99,663이100,000 미만이어서 그 요청이 시작됐고, 완료 후23,350이 합산되어 **23,013 초과**가 기록됐다. 기존 예산은 **응답 후 보고 usage를 검사하는 soft limit**이며 제공처에 강제하는 총량 hard cap이 아니다. 초과 뒤 새 요청은0이다. 이전 실패의 usage는 여전히 UNKNOWN이므로123,013도 전체 실제 소비의 완전한 합계라고 주장하지 않는다. `maxTokens:100000` 설정은 그대로이며 초과 사실·과거 raw unknownUsage0을 숨기거나 낮춰 쓰지 않았다.

| 판정 | 방법·관측 | 한계 |
| --- | --- | --- |
| PASS | 실제 `npm run doctor`·SQLite 읽기 전용·서비스 조회 | GPT2계정/DeepSeek 토커·기존6요청 blocked 확인. 상주 flag off/방0·browser 수동 잠금·Codex root/binding0 유지 |
| PASS | `node --test --test-reporter=spec tests/deepseek-output.test.mjs` **9**, FAIL/SKIP0 | 신규 continuation/soft-limit 회귀2개 포함. 모의 응답은 실제 성공과 구분 |
| PASS | `npm run check` — strict TypeScript/빌드·Node **328**, FAIL/SKIP0 | 신규2개와 기존 인증/복구·토론/방·큐/Wiki/Codex 회귀 결합. browser fixture 코드는 변경하지 않음 |
| PASS | 신규 continuation fixture: 초기3응답+검토2응답 후 DeepSeek `length` 실패 → 출력 설정만 변경 → 명시 재개 → 같은 토의 완료 | 원래6turn/실패 receipt·예산 보존, 설정 명령2회/재개 명령2회에도 실패 task의 새 turn1회·전역 설정 불변·job0 |
| PASS | 병합 소스 빌드·서비스 재시작·health·owner HTML | 운영 적용은 수행함. 새 기능을 실제 모델 검증 완료로 세지 않음 |
| PASS (부분 흐름) | 실제 추가6요청·SQLite/사전 backup·명시 command 대조 | DeepSeek 재검토2개 완료, 기존6turn/실패/다른 토의·전역 토커·방·수동 잠금·job/binding 보존. 최대동시1·turn당 dispatch1·초안/라운드 장벽 유지 |
| PARTIAL | 토의12요청·`budget_exhausted`, 보고 usage123,013 | 상호 검토2라운드·검증2개 후 종료. 수정/종합/종합안 검토 NOT_RUN. 한도 초과 합산은 위에 명시 |
| PASS | 새 soft-limit fixture: 보고 사용량999/한도1,000에서 다음 성공 응답 합산 후 partial | 초과값 보존·추가dispatch0·일반 resume로 partial을 재개하지 못함. 예산 값을 reset하거나 자동 증액하지 않음 |
| PASS (실제 UI) | 별도 Chrome156.0.8078.47·인증된 private HTTPS·1440×1000/390×844 | 12turn·3인 비교·현재/요청16,384 표시·overflow/JS 오류0·2SSE/새로고침 뒤 요청12/turn ID 보존. GET만 허용, 추가 모델/POST/외부 요청0 |
| NOT_RUN | 실제 dot/Muse·상주 큐/Wiki·사용자 Codex·실기기 IME/터치 | 원래 R8-D 전체·R3-E/R4-D/R6-F 완료로 승격하지 않음 |

신규 fixture는 기존 Providers/Store/엔진 API만 사용한다. 제품 src/엔진/예산/승인/격리·50개 gate 계약 변경은 없으며 새 continuation 실행 API나 scheduler를 만들지 않는다. 실제 호출 driver는 private journal과 기존 owner control/관측 API를 사용한다. command를 보내기 전에 key/intent를 기록하고 전송 결과가 불명확하면 대조 없이 재전송하지 않는다. soft-limit fixture는 usage를 실제 보고하는 두 모의 DeepSeek 응답을 사용한다. 기본 fake의 usage=null을0으로 대체해 예산 근거로 쓰지 않으며 제품 동작을 바꾸지 않았다.

실제 UI 캡처를 공개 저장소 경로로 내보내는 명령은 자동 승인 검토에서 원문/민감 데이터 노출 위험으로 거부됐다. 안전한 대안으로 캡처/PNG 복사를 전부 제거하고 GET만 허용한 구조·표시·재접속 검사로 완료했다. 공개 산출물은 대화 원문·화면 이미지·이메일·키 없이 숫자/불리언·고정 상태·digest만 포함한다.

## 다음 판정·복귀

현재 토의는 같은 ID/12요청/partial로 보존한다. 출력 확대 뒤 같은 입력의 DeepSeek 재검토가 성공했지만 원래 원격 종료 reason을 복구한 것은 아니므로 최초 실패의 정확한 원인은 UNVERIFIED다. 남은 요청 수가 있어도 이미 예산이 소진된 partial을 일반 resume로 재개할 수 없다. 한도·완료 상태 전이 변경, 새 토의로 예산을 다시 시작하는 조치는 이번 작업에서 하지 않았다. 이를 추가하려면 기존 계약/후속 R1~R8 영향·변경량을 검토해 별도 허용받아야 한다. 실제 dot/Muse·상주 업무/Wiki·Codex·실기기 수락과 원래50 gate 판정은 유지한다.

운영 복귀가 필요하면 새 예약을 막고 원래 turn/receipt를 대조한 뒤 지원 빌드에서 발화를 중단한다. 새 명시 설정을 구버전이 지킨다고 가정하지 않으며 원문·실패·정산·command를 이전 DB로 덮어쓰지 않는다. 실제 복귀는 NOT_RUN이다.
