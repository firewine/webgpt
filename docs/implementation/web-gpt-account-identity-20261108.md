# 웹 GPT 아이콘형 계정 확인 — 구현·모의 검사

2026-11-08 (KST). 원래 분기 main `084d5587d1b101f772369f837d857d374fef8a2b`, 브랜치 `codex/web-gpt-account-identity-20261108`. PR #62 병합 뒤 main `fbd4a39` 위에 단일 커밋으로 정리하며 양쪽 SSOT 기록을 보존했다. 기존 제품 `src/`와 이 보완 코드는 충돌 해소로 변경하지 않았다. [사용자 승인 범위·후속 영향](../reviews/r8-web-account-identity-impact-20261108.md)의 계획 개정·개발·모의 검사만 수행했다. 별도 R8 검증기 PR #62와 독립이며 전체 혼합 수락을 완료로 바꾸지 않는다.

## 구현 계약

- `src/workspace/model.ts:BrowserBinding.accountIdentity`와 `src/connections/browser-account.ts`는 `source/userId/email`만 허용한다. 기존 DOM 계정 확인을 기본으로 두고 새 ChatGPT 연결의 고유 프로필 버튼에 문구가 없을 때만 보완한다. Muse 프리셋·legacy 연결의 자동 이관은 없다.
- `BrowserDiscovery.discover/resolve`는 같은 Chrome page/profile/thread와 빈 입력/준비 상태를 유지하며 조회→probe→재조회→소유자 확인을 대조한다. 계정 조회를 기다린 뒤 DOM 상태/요소를 다시 관측해 초안·busy·선택자 요소 변경도 거절한다. 저장 후 사용자 ID/이메일 변경·삭제·legacy 방식에서의 암묵 전환을 거절하고, 페이지/선택자 갱신 시 생략된 metadata는 보존한다. 기존 Store JSON에 optional 필드만 추가하며 SQL migration은 없다.
- `BrowserBridge.inspect/sendScript/complete`는 전송 전·입력 뒤 click 직전·응답 확정 전에 계정을 새로 확인한다. 중간 응답 조회는 계정 경로를 반복 호출하지 않는다. 전송 전 불일치는 실제 click0인 미전송으로, 전송 후 불일치는 receipt를 보존한 미확정으로 남긴다. 새 방식의 응답 delta는 최종 계정 확인 후에만 전달한다.
- 조회는 선택한 ChatGPT 페이지 내부의 고정 HTTPS origin/경로에서 GET·same-origin credentials·no-store·redirect 거절·3초 기한으로 수행한다. 응답 전체/token/cookie를 MCP 결과나 앱 상태에 반환하지 않는다. 이 내부 웹 경로의 **공식 지원/장기 안정성은 UNVERIFIED**다. 조회/형식 실패를 계정 확인 우회로 처리하지 않는다. 모델 사용은 기존 웹 대화 방식이며 새 OAuth/API 키는 없다.
- Providers.complete·Store transaction/event/idempotency·전송 전 기록·receipt·미확정/중복 방지·native dot·Muse·Codex 보호/명령/원본 반영·API 예산과 승인 경계를 유지한다.

계정 판정/페이지 스크립트는 작은 `browser-account` 함수로 공유해 discovery와 기존 BrowserBridge 사이의 중복을 줄였다. 별도 브라우저 실행기·인증 계층·추상 클래스를 만들지 않고 기존 adapter에 조합한다.

| 계약 | 유지/변경 |
|---|---|
| BrowserBinding·ChatGPT preset | optional metadata 추가, preset v5. legacy 누락값의 의미 유지. |
| 전송·응답 확인 | 기존 경로에 새 출처의 계정 재확인/최종 delta 보류 추가. 미확정·자동 재전송 방지 유지. |
| Providers/Store/권한·예산 | 기존 인터페이스·transaction·승인/수명 유지, SQL/credential migration 없음. |
| Muse/dot/Codex·후속 R8 | 호출 계약/보호 유지. R4의 계정 확인만 보완하며 R8 실제 수락은 별도. |

## 검사 증거

호스트 Ubuntu, Node 24.18.0, 실제 fixture Chrome 156.0.8078.47, Chrome DevTools MCP 1.12.0. fixture는 임시 상태와 합성 계정 응답만 사용하며 운영 Chrome/profile/DB에 연결하지 않는다.

| 검사 | 결과·방법 |
|---|---|
| strict TypeScript·빌드·Node 전체 | `npm run check`: 최신 main 정리 후 **852 PASS / 6 SKIP / 0 FAIL**. 원래 독립 분기에서는831 PASS/6 SKIP였고, PR #62의21개 검사를 포함해 재검사했다. 여섯 건은 native Codex/호스트 보호 검사 조건 미충족이며 통과로 세지 않는다. 이번 browser 변경의 실계정 증거가 아니다. |
| 실제 Chromium 전체 fixture + 설치 MCP | `WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp npm run test:browser`: **116 PASS / 0 SKIP / 0 FAIL**. 실제 MCP 프로세스 fixture 왕복 포함. |
| 계정 metadata·저장/재개 | Node 신규5건: 최소 필드·legacy 기본값·계정 변경/누락 차단·HTTP 확인/수동 갱신/DB 재개 보존·조회 대기 중 초안/busy/요소 교체 차단. 기존 discovery 검사 포함19건 PASS. |
| 아이콘 UI·실제 전송 동작 | Chromium 신규7건/그중1건의 하위 사례3개: 계정 문구 없는 탐지/저장1개·DOM 변경0, 조회 대기 중 초안/busy/선택자 변경 차단, 잘못된 origin/응답/redirect/기한/통신 오류 차단, 저장 전 ID/email 변경 차단, click1/receipt1, click 전 변경→전송0, 전송 후 변경→receipt 보존/응답 적용0. token sentinel이 MCP 결과/저장 상태에 없음도 확인했다. |

로컬 검사 로그는 `/tmp/webjjoku-account-identity-check-20261108.log`, `/tmp/webjjoku-account-identity-browser-20261108.log`다. 임시 호스트 로그 자체는 저장소 산출물이나 영구 증거로 간주하지 않으며 CI에서도 같은 소스를 검사한다.

## 실제 수락과 복귀

**이번 개발의 운영 적용·실계정 호출: NOT_RUN.** 기존 준비 요청1회와 개인 대화·계정·정상 서비스는 변경하지 않았다. 서로 다른 실제 웹 GPT 2계정과 DeepSeek/dot/Muse/Codex를 함께 쓰는 R8 최종 수락은 미완료다. 병합 후 별도 승인한 실행 창에서 이미 완료한 준비 대화를 재사용해 계정 확인/연결 저장부터 검증하고, 원래 요청을 자동 재전송하지 않는다.

회귀 시 새 출처의 연결을 참여 꺼짐/미확인으로 두고 원래 상태·대화·receipt를 보존한 채 코드와 빌드만 이전 버전으로 복귀한다. 새 metadata를 삭제해 계정 확인을 우회하거나 아이콘을 이름으로 간주하지 않는다. 기존 DOM 방식과 Muse 연결을 일괄 변경하지 않는다. 추가 호스트 설정 변경과 미결정 제품 항목은 없다.
