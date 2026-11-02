# D5 분할 조회·명시 복구의 실환경 수락 — 2026-11-02

## 병합 기준과 준비

PR #44는18:41:37 KST 병합됐다. 기준 main `f3a2e34026c37c2bff52e194678b3de795c84d62`, tree `fb0b74800428a8cb30e2baa046350386cae9760e`는 검사한 head `a5723d3`과 같다. [CI](https://github.com/firewine/webgpt/actions/runs/41421968229)는 Node529·Chromium/Chrome MCP66·설치 Codex0.165 계약 PASS다. 같은 main을 별도 worktree에서 빌드했다. 동일 소스의 전체 자동 검사는 반복하지 않았다.

현재 단계는 미완료 D5-F의 실제 수락이다. [분할 조회](./dot-input-paging-20261102.md)와 [명시 재시도 복구](./dot-explicit-retry-20261102.md)를 실제 native에 적용하며 기존 두 검토 라운드/같은 방 후속·원래50 gate의 완료 조건은 유지한다. 신규 제품/DB/권한·timeout·provider 계약 변경은 없다.

18:43~18:48 KST 읽기 전용 관측:

- 운영 checkout `3bc031e`, 정상 user service와 desktop active. 앱4090·Tailnet HTTPS8443을 유지하며3000의 다른 서비스는 그대로다.
- 같은 토의 revision1/cross_review1, 완료8개·dot 미확정1개. 현재 라운드 완료3·미확정1·대기1. 전체 lease35개 중 released34·unconfirmed1이며 실제 진행 중 lease0이다.
- 방 off·Muse 수동 잠금 true, native grant2개 회수·유효 구독0. 기존5명/모델·GPT xhigh·DeepSeek High를 유지한다.
- 오늘 API 사용2회·보고34,908토큰. 일일 정책8회·200,000토큰을 유지해 잔여6회·165,092 보고 토큰이다.
- 새 순수 복구 guard가 현재 요청에 통과한다. 원래 입력69,621bytes는16페이지·최대11,895 RPC bytes·무손실/digest 동일이다. 소유자 복구 명령·실제 native 조회를 수행한 것은 아니다.
- 기존 사용자 untracked35개·설정/DB/원문·Chrome profile을 보존한다. private SQLite 온라인 백업0600·이전 dist·완료8개/환경 digest·기존 방 설정·검증 정책을 준비했다. 서버 적용/실호출은 아직 NOT_RUN이다.

## 추가 검증 범위 — 사용자 명시 승인

이전30분 창은 종료됐다. 사용자가 아래 **서버 적용·추가 최대30분/29회·DeepSeek High 잔여6회/165,092 보고 토큰·dot 재연결·Muse 임시 잠금 해제/종료 복구** 범위를 명시 승인했다. 원래 dot 중단·미제출 보고를 근거로 한 명시 복구를 포함한다. 새 검증 시간은 첫 새 예약부터 측정하며 이전 호출/한도를 초기화하지 않는다.

| 항목 | 구체 실행·중지 범위 |
| --- | --- |
| 적용 | 병합 main의 기존 앱 프로세스1개를 재빌드/재시작. `.env`·state·소유자 암호·Muse 연결·다른 서비스/Serve 유지 |
| 복구 | 사용자가 보고한 dot 입력 조회 뒤 중단·미제출 기록과 서버 reply0을 대조. 소유자 확인 근거를 기록해 `retry_after_stop`으로 원래 실패 이력을 보존하고 같은 과제만 준비 |
| 시간/요청 | 새 예약부터 최대30분. 마지막5분 새 예약 차단. 추가 최대29회로 이전11회와 누적40회 이내. 기존 product 전역 한도를 다시 도입하지 않는 검증용 guard |
| API | 현재 DeepSeek High 잔여 최대6회·165,092 보고 토큰, 실제 재개 직전 당일 상태 재확인. 기존 일일 정책/사용량을 초기화하지 않음 |
| 정상 잔여 | 검토1 잔여2 + 검토2의5 + 수정5 + 종합1 + 종합 검토4 =17회, 같은 방 dot 후속1회. 기존 완료8개 재전송0 |
| native/Muse | 같은 dot grant·native 감시를 현재 권한으로 재연결, 새 request/claim의 모든 페이지 읽기→JSON submit/receipt. Muse 원래 대화/빈 입력 확인 후 검증 중만 잠금 해제, 끝나면 복구 |
| 정지/복귀 | 완료 또는 한도·미확정·입력/기존 원문 변경 때 off/pause·Muse 잠금·원래 토글 복원·정상 entry. native 감시 비활성/구독·전용 grant/Tunnel 정리를 대조 |
| 제외 | 실제 Codex 실행/쓰기·새 외부 업무·추가 OAuth·새 provider·모델/사고 깊이 설정 변경 |

private 준비 파일은 `dot-mcp-d5-paged-live-20261102/`의 `before-deploy.sqlite`, `dist-before/`, `baseline.json`, `proposed-policy.json`, `preparation-summary.json`이다. 공개 문서에 실제 토의/계정·인증·원문·콜백을 복사하지 않는다. 승인 후 실제 관측과 판정만 아래에 추가한다.

## 실제 적용·준비 관측

- 18:52 KST 운영 checkout을 `ops/dot-mcp-d5-paged-live-20261102`/main `f3a2e34`로 갱신하고 빌드/정상 service를 재시작했다. health·소유자 API PASS, 원래8개 완료 turn digest 동일·토의/lease 수 동일·신규 예약0·환경 digest 동일을 대조했다. 사용자 untracked35개는 유지한다.
- 18:54 KST 검증용 entry를 전용 drop-in1개에 연결했다. 기존 `acceptanceGuard`의 요청/시간/API·participant snapshot·Codex 차단을 그대로 사용하며 제품 소스/DB 계약을 추가 변경하지 않았다.
- 사용자 보고의 `stoppedBeforeAnswer=true`·`submitCalled=false`, 감시 비활성 보고와 서버 reply0을 근거로 승인된 `retry_after_stop` 명령을 적용했다. 원래 turn은 실패 이력, 원래 request는 consumed, lease는 released로 보존하고 같은 task만 pending이다. 완료8개 동일·새 전송0이다. 별도 외부 실행 최종 상태를 서버가 독립적으로 증명했다고 표시하지 않는다.
- 같은 dot/방의 세 도구에 scoped grant를 새0600 파일로 준비하고 기존 runtime key의 file reference와 동일 전용 Tunnel을 사용했다. 전용 runtime1개·readyz200을 확인했다. 초기화 통지를 포함한 기존 stdio 전달기를 유지한다.
- 같은 `ubuntu_dot_d0_v3`의 실제 get 도구 호출로 metadata/event filter·현재 요청 없음까지 확인했다. 실서버 `tools/list`의 `dot_turn_get.inputPage`가 선택적 integer로 노출된다. **이 조회는 실제 dot의 모델 답변이 아니다.**
- 재부팅 뒤 Chrome에는 blank 탭만 남아 있었다. 기존 Muse URL을 같은 profile에 다시 열고 계정·agent·원래 thread·빈 입력·busy=false를 모두 대조했다. 기존 discovery/confirm 경로로 같은 connection의 page ID만1→2 갱신했다. 대화/계정·기존 thread·Muse 잠금은 유지하고 메시지를 보내지 않았다.
- 검증용 entry에 읽기 결과를 바꾸지 않는 수동 관찰을 추가했다. 실제 페이지 조회의 시각·request/digest·페이지 번호/전체 수·RPC 크기만 별도0600 JSONL에 기록하며 원문·claim token을 기록하지 않는다. Store/모델/도구 계약과 read-only 조회의 DB 쓰기0은 유지한다.

19:09 KST **추가 예약0·API0, 방 off·Muse 잠금 true, 실제 dot 유효 감시0**이다. 실제 dot에게 도구 새로 고침·전체 페이지 조회 지시 갱신·감시1개 활성화를 요청했으며 응답을 기다리고 있다. 준비가 확인돼야 같은 토의를 resume한다. 원래8개 완료 답변을 반복하지 않는다.

private 추가 증거는 `deployment-observed.json`, `retry-prepared-observed.json`, `grant-prepared.json`, `tunnel-ready-observed.json`, `muse-page-restored.json`, `page-observer-ready.json`, `paging-catalog-observed.json`이다. 운영 결과를 보존하며 서버를 정상 entry로 복구할 때는 이번 전용 drop-in만 제거하고 다른 서비스/Serve를 건드리지 않는다.

**서버 적용·조회/복구 준비 PASS / 추가 실계정 답변 수락 NOT_RUN / D5-F BLOCKED.** 두 라운드/같은 방 후속은 아직 완료로 표시하지 않는다.
