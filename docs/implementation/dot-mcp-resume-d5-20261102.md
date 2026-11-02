# D5 동일 주제 재개 검증 — 2026-11-02

## 기준과 남은 범위

사용자가 PR #42 병합 후 다음 단계 진행을 요청했다. PR #42는 2026-11-02 14:58:05 KST 병합됐으며 main은 `3bc031e51c98928eb396837b7831859524d79f76`이다. 검사한 head `d715a67`과 tree `a373c765256c441c7c9ac391ae586292e061bd25`가 같다. [CI](https://github.com/firewine/webgpt/actions/runs/41392853618)는 Node486·browser65·Codex0.165 계약 PASS다.

최초 점검 시 운영 branch `ops/dot-mcp-d5-20261102`의 `01be270`은 main과 `src/`, package/lock, TypeScript 설정이 동일했다. 사용자 untracked35개와 `.env`·원래 데이터를 보존하고 운영 checkout을 새 `ops/dot-mcp-d5-resume-20261102` branch의 main `3bc031e`로 갱신했다. 제품 소스 차이0으로 재빌드는 하지 않았다. 문서 작업은 별도 worktree에서 진행한다.

이번은 새 기능 페이즈가 아닌 **미완료 D5-F의 같은 실계정 토론을 이어가는 단계**다. 기존 수락 기준/후속 범위·provider·Store·API 일일 정책·timeout·Human 승인·Muse 연결은 변경하지 않는다. 추가 OAuth/공개 ingress/실제 Codex 실행을 포함하지 않는다.

## 읽기 전용 사전 관측

- 방 off, 같은 주제 paused/cross_review1/revision1. 완료된 초안5개+교차 검토2개와 원래 ID/receipt를 보존한다.
- 미해제/미확정 lease0, 전체 누적 lease33. 지난 검증의 새 예약9개를 초기화하지 않는다.
- GPT2·API·Muse의 기존 연결 등록 상태는 connected. 실제 다음 응답 성공은 별도로 확인해야 한다.
- 검증용 native grant/구독은 회수 상태, Tunnel은 종료 상태다. 같은 dot/방에 scoped grant와 기존 감시를 다시 준비해야 한다.
- Muse 수동 조작 잠금 true. 재개 직전에 계정/thread/URL·빈 초안을 다시 대조한다.
- API 일일 정책8회/200,000 보고 토큰을 유지한다. 오늘 사용1회·보고10,390 토큰, 잔여7회/189,610 토큰이다. DeepSeek는 High 그대로다.
- 현재 대기3명 입력+이력은 각각 약36,000자로 기존180,000자 경계 안이다. 향후 응답 증가로 경계에 도달하면 원래 context 대조/복구를 사용하며 자동 초기화하지 않는다.

## 추가 실호출 창의 구체 범위

이전30분 창은 [앞 단계 종료 기록](./dot-mcp-live-d5-20261102.md)에 따라 종료됐다. 사용자가 아래 **추가30분·31회·DeepSeek 잔여7회/189,610 보고 토큰, dot 감시 재연결과 Muse 임시 잠금 해제/복구** 범위를 명시 승인했다. 호출 승인과 실제 응답 수락은 별도로 기록한다.

| 항목 | 준비한 범위/종료 조건 |
| --- | --- |
| 시간 | 추가 최대30분, 마지막5분에는 새 예약 차단 |
| 요청 | 추가 최대31개 예약. 이전9개와 합계40개 이내 |
| API | DeepSeek High 추가 최대7회이며 기존 당일 잔여/토큰 정책도 적용 |
| 토론 | 새 주제 생성0. 기존7개 완료 turn을 변경/재전송하지 않고 pending3개부터 resume |
| 남은 정상 경로 | 교차 검토1 잔여3 + 검토2의5 + 수정5 + 종합1 + 종합 검토4 =18회, 같은 방 dot 후속1회 |
| Muse | 기존 thread/빈 입력 확인, 검증 중만 잠금 해제, 종료 후 복구 |
| 중지 | 완료 또는 시간/횟수 한도·미확정·기존 입력 변경 시 off/pause. 원래 결과를 보존하며 재전송하지 않음 |
| 제외 | 실제 Codex 실행/쓰기, 새 외부 업무, 계정/모델/추론 설정 변경 |

준비한 private policy는 기존 lease33개를 이번 창의 baseline으로 기록하고 지난 창의9회를 별도 이력으로 유지한다. 새 시간 창은 소유자 허용 후에만 시작하며 기존 guard의 상한/계약을 바꾸지 않는다. 재개 스크립트는 원래 주제 digest와7개 완료 turn의 동일성을 확인하며, 검증 중에도 원래 turn 변경을 감시한다. 기준 불일치 시 새 topic을 만들지 않고 중단한다.

서비스 적용은 원래 단일 프로세스에 검증 entry를 임시 연결하는 기존 방법을 재사용한다. 종료 시 방 off·same topic pause/완료·미확정 대조·Muse 잠금/멤버 토글 복구 후 정상 entry로 돌아간다. scoped grant 회수·native 감시 비활성·전용 Tunnel 종료를 대조하고 기존 DB를 복원해 결과를 지우지 않는다.

## 수락 증거와 현재 판정

완료된 두 검토 라운드에서 각 참여자가 직전 공개 원문/반론을 읽었는지 prompt/receipt/구조화 review를 대조한다. 수정·종합·summary_review와 같은 방 dot 후속까지 확인된 항목만 PASS로 기록한다. 실제 기기 및 실제 Codex 수락은 별도다. 관련 정책은 기존 `live-acceptance-guard`8개 검사와 병합 CI에서 통과했으며 제품 소스를 바꾸지 않아 같은 전체 검사를 반복하지 않는다.

15:08 KST 승인 후 온라인 SQLite 백업0600과 새로운 scoped grant/검증 entry를 준비했다. 15:08:57 health·소유자 API·전체 토의/lease 동일·방 off·Muse 잠금을 확인했다. 새 grant는 같은 dot/방의 세 도구와24시간 만료만 허용한다. 15:10 기존 터널/기존 runtime key의 file-reference로 전용 runtime1개를 시작했고 초기화·3도구·Events catalog·readyz200을 관측했다. 개인 키를 조회하거나 공개 문서에 복사하지 않았다.

15:17 KST 서버에서 같은 필터의 유효한 native 구독1개·ready를 확인한 뒤 원래 주제를 재개했다. Muse의 기존 계정/thread/URL·빈 입력·ready와 busy=false를 다시 대조하고 검증 중에만 잠금을 해제했다. 첫 예약은15:17:48 KST다. 이전7개 완료 turn은 그대로이며 새 토론 생성0이다.

| 추가 관측 | 실제 결과 | 판정 |
| --- | --- | --- |
| DeepSeek High 검토1 | 15:18:38 완료. 초안5개의 원문 참조와 할당 주장10개를 입력에 포함, 구조화 검토10개 및 미확인4개·receipt 보존. 같은 라운드의 새 답변은 입력에 없음 | PASS |
| dot 검토1 | 15:18:38 원래 요청1개·callback1회/HTTP200,15:19:05 claim 활성.15:23:38까지 submit/receipt 없음 | 미확정, 완료 아님 |
| 기존 경계 | 원래300초 timeout에서 `dot_reply_unconfirmed`, 원래 요청 held/turn unconfirmed/lease unconfirmed 보존 | 차단 동작 OBSERVED |
| 자동 정지/복구 | 15:23:40 방 off·Muse 수동 잠금 true·원래 참여 토글 복구. 완료7개 변경0, 기존 DB/원문 유지 | PASS |
| 추가 호출 | 예약2개/API1회. API 새 입력21,048·출력3,470=24,518 보고 토큰. 당일 누적2회/34,908 보고 토큰 | OBSERVED |

이벤트 전달/claim 성공만으로 입력 조회·답변 생성·제출 성공을 판정하지 않는다. 실제 dot에 같은 시각의 기존 실행 기록만 조회하도록 요청했으며 새 감시·claim·submit·재전송은 요청하지 않았다. 아직 미확정 요청을 미전송/완료로 바꾸지 않았고, 이번 창의 baseline/시각을 초기화하지 않았다. 공개 문서에 계정/대화/키/콜백 ID를 넣지 않는다.

### 사용자 보고와 입력 크기 대조

사용자는 실제 dot의 **claim 이후 고정 입력 get 성공**, `Warning: truncated output` 표시, 할당 주장12개 원문을 모두 읽을 수 없어 답변 생성 단계에서 중단, submit 미호출을 보고했다. 실행의 별도 완료/실패 상태는 조회 화면에 없어 UNVERIFIED다. 서버 claim 활성·reply/receipt0과 일치하며 OAuth·callback·claim 실패로 분류하지 않는다.

저장된 입력은 prompt21,793자·history14,019자(2항목), 합35,812자로 원래 한도 내다. canonical JSON은69,621 UTF-8 bytes다. `DotMcpAdapter.call`이 반환하는 값70,059 bytes를 `McpEvents.handle`이 content와 structuredContent 양쪽에 넣어 전체 MCP envelope144,644 bytes가 된다. 데이터 중복과 크기는 코드/저장 snapshot 실측이며 정확한 플랫폼 절단 계층·상한은 UNVERIFIED다. history나 원문이 서버에서 삭제된 것은 아니다.

현재 판정은 **DeepSeek 추가 검토 PASS / native 긴 입력 읽기 실패 보고·원래 요청 보존 / D5-F BLOCKED**다. 원문 요약/삭제·timeout 확대로 통과시키지 않는다. [분할 조회 영향 검토서](../reviews/dot-input-paging-impact-20261102.md)는 승인 대기 제안이며, 계약/제품 코드를 먼저 바꾸지 않았다.

### 서비스 복구와 남은 정리

15:29:12 KST 우리 검증용 drop-in만 제거하고 정상 `dist/server/main.js` 서비스로 복구했다. readiness 대기 뒤 health/owner API 정상, 전체 토의 동일·재시작 신규 예약0·방 off·Muse 잠금 true를 확인했다. 기존 다른 서비스/Serve/desktop 설정을 변경하지 않았다.

현재 원래 dot 요청1개는 held/unconfirmed로 대조 보존 중이다. 실제 감시 종료를 사용자에게 요청했으며 전용 grant/Tunnel은 종료 확인 뒤 정리한다. 미확정을 완료/미전송으로 처리하지 않으며 전체 검증 성공으로 표시하지 않는다. 검증 결과 원문을 DB 백업으로 덮어쓰지 않는다.

로컬 private 증거는 `dot-mcp-d5-resume-20261102/`의 `live-start.json`, `live-progress.jsonl`, `live-outcome.json`, `native-timeout-observed.json`, `native-input-size-observed.json`, `native-user-report.json`, `normal-service-restored.json`에 있다. 로그/스냅샷/키 파일은 공개 저장소에 포함하지 않는다.

### 문서/수락표 검사

제품 소스/검사 소스 변경0으로 기존 병합 CI를 재사용한다. 수정한 수락표에는 원래50 gate와 미완료 상태를 유지했다. `git diff --check` PASS, 기존 `D5-E` manifest 검사1개 PASS/fail0/skip0다.

새 worktree에서 최초 검사 실행은 미생성 dist import로 실패했다. 제품 실패가 아니다. 테스트 파일이 운영 checkout과 동일한 것을 대조한 뒤, 같은 제품 소스의 기존 dist를 사용하도록 해당 테스트를 절대 경로로 지정하고 작업 디렉터리는 새 문서 worktree로 유지했다:

```bash
node --test --test-isolation=none --test-name-pattern='D5-E:' \
  /home/firewine/webgpt/tests/dot-acceptance.test.mjs
```

이 검사는 문서의 수락표만 검증하며 실제 dot 응답 성공이나 전체 회귀 재실행을 의미하지 않는다.
