# D5 v2 전송·제출 오류 복구 실환경 수락 — 2026-11-04

## 병합 기준과 준비

사용자가 PR #45 병합 후 다음 단계 진행을 지시했다. 병합 main `bd19d1f27ccfeb7e691aad86b2533bbca806fdb1`·tree `db2228cfce84fea851959c674ac12c8f610a1726`는 검사한 PR head `aecf65f`와 동일하다. [동일 소스 CI](https://github.com/firewine/webgpt/actions/runs/41824220074)는 Node553·Chrome/MCP67·설치 Codex0.165 요청 계약 PASS다. 로컬 Codex0.166 schema PASS와 실제 실행 NOT_RUN은 [구현 기록](./dot-page-transport-retry-20261104.md)을 따른다.

21:04~21:10 KST 준비 관측:

- 운영 소스는 아직 이전 `f3a2e34`이며 user service active·앱4090/HTTPS8443·검증 drop-in0이다.3000의 다른 서비스와 사용자 untracked 파일은 유지했다.
- 같은 토의는 revision1/cross_review2·blocked다. **완료13개 digest 동일·dot 미확정1·서버 reply/receipt/text0·원래 grant 회수·진행 중 lease0**을 확인했다. 방 off·Muse 잠금 true·native 유효 구독0이다.
- 새 main은 독립 worktree에서 빌드했다. 새 `assertDotRetryAfterFailedSubmit` 순수 검사를 원래 요청에 적용해 PASS를 확인했다. 이 검사만으로 소유자의 외부 실행 중단 확인이나 실제 복구 명령을 대신하지 않는다.
- 원래 held 요청에는 전송 버전이 없고 기존 dual31페이지가 유지된다. 같은 고정 원문에 새 요청 v2를 계산하면 **16페이지·최대RPC11,937bytes·무손실**이다. 원래 요청을 v2로 바꾸지 않았고 실제 native 수락을 완료로 표시하지 않는다.
- private `dot-mcp-d5-v2-live-20261104/`에 SQLite online backup0600·이전 dist·완료13개/환경 digest·기존 멤버 토글/API 정책을 보존했다. 기존 DB나 설정을 덮어쓰지 않았다.
- 서버 Chrome에는 blank 탭만 있었다. 같은 기존 profile에 저장된 Muse URL을 다시 열었고 새 background 탭의 UI가 비어 있는 것을 관측했다. 탭을 앞에 표시한 뒤 **같은 계정·원래 thread·ready/idle·빈 입력**이 모두 통과했다. 새 로그인·대화 생성·입력/메시지 전송은0이다. 실제 MCP page ID는 적용 직전에 기존 discovery/confirm으로 다시 대조한다.

private 근거는 `before-deploy.sqlite`, `dist-before/`, `baseline.json`, `preparation-summary.json`, `chrome-page-preparation.json`, `muse-page-diagnosis.json`, `muse-blank-page-diagnosis.json`, `muse-front-preflight.json`이다. 계정/원문·키·callback을 공개 문서에 넣지 않는다.

## 구체 적용·새 검증안 — 별도 승인 전 NOT_RUN

[직전 검증](./dot-mcp-resume-live-d5-20261104.md)의30분 실행 창은 종료됐다. 제품 개발 승인은 서버 적용/새 실계정 호출과 구분된다. 이번 준비는 새 호출 승인을 대신하지 않는다.

| 항목 | 제안 실행/중지 범위 |
| --- | --- |
| 적용 | 병합 main의 빌드 결과를 기존 앱에 반영·정상 service 재시작. `.env`·state·소유자 암호·계정·Chrome profile·port/Serve·다른 서비스 보존 |
| 원래 dot 복구 | 소유자가 기존 오류 뒤 처리 중단/추가 제출 없음을 확인하고 서버 reply/receipt0·원래 grant 회수를 재대조한 뒤 `retry_after_failed_submit`으로 원래 실패/제출 시도 이력을 보존. 같은 task만 pending으로 두고 별도 resume |
| 기존 완료 | 완료13개 재전송0·원래 실패/미확정 기록 보존. 원래 held 요청의 페이지/version을 바꾸지 않고 새 request에만 v2 snapshot |
| 정상 잔여 | dot/Muse 검토2의2 + 수정5 + 종합1 + 종합 검토4 + 같은 방 dot 후속1 =13회 |
| 시간/요청 | 첫 새 예약부터 최대30분·추가 최대23회. 기존17회와 누적40회 이내, 마지막5분 신규 예약 차단. 제품 전역 한도가 아닌 이번 검증 전용 guard |
| API | DeepSeek High 최대5회·119,757 보고 토큰, 기존 일일8회/200,000토큰·실제 당일 잔여 중 작은 범위. 사용량/한도를 초기화하지 않음 |
| dot/Muse | 같은 dot/플러그인/Tunnel·필요한 scoped grant·기존 native 감시1개 재연결. 원래 Muse thread/빈 입력 확인 뒤 검증 중만 잠금 해제·종료 복구 |
| 늦은 응답 | 같은 승인 창 안의 원래 최종 응답만 기존 수락/대조 경로로 확인. 미확정 요청을 새 job/감시/timeout 연장으로 반복하지 않음 |
| 정지·복귀 | 완료/한도/미확정/원래 데이터·범위 변경 시 방 off·실행 대조·Muse 잠금·최신 멤버 토글 복원·이번 grant/Tunnel/검증 drop-in 정리·정상 service 복구 |
| 제외 | 실제 Codex/쓰기·새 외부 업무·추가 OAuth/계정/플러그인·새 phase·300초/12,000bytes 확대 |

**현재: 빌드·백업·순수 guard·Muse 원래 화면 준비 PASS / 서버 적용·소유자 복구 명령·새 실제 모델 호출 NOT_RUN / D5-F 전체 BLOCKED.** 실제 결과가 관측되면 호출/시간·페이지/receipt·두 라운드/종합·같은 방 후속·복귀 증거를 추가한다. 원래50 gate·별도 기기/Codex 수락은 유지한다.
