# dot 중단 확인 후 명시 재시도 — 2026-11-02 승인

2026-11-02. 사용자가 아래 영향·변경량을 검토하고 **‘명시 재시도 복구 개발 승인’**을 명시했다. PR #43 병합 후 미완료 D5-F를 준비하며 발견한 복구 계약 보완이다. 아래 범위의 계획 개정·개발·합성 검사/PR을 진행하며 새 페이즈를 만들지 않는다. 배포·추가 실계정 호출은 이 승인에 포함되지 않는다. 사전 관측과 대안은 보존하며 실제 구현 결과는 별도 실행 기록으로 판정한다.

## 기준과 사전 확인

- PR #43은16:37:28 KST 병합됐다. 기준 main `2447ada989ecfb639ab90bcff53608e264162ffd`, tree `604dc306f7aef81dbfe9fb5500bec249b3525814`는 검사한 head `4a03957`과 같다. [최종 CI](https://github.com/firewine/webgpt/actions/runs/41406951263)는 Node490·browser65·설치 Codex0.165 계약 PASS다.
- 별도 작업 브랜치에서 이 main을 빌드했다. 운영 checkout은 `3bc031e`이며 사용자 untracked35개·기존 설정/DB를 유지한다. 분할 조회는 아직 운영 배포하지 않았다.
- 16:48 KST 읽기 전용 관측: 같은 토의 revision1/cross_review1, 완료8개·dot 미확정1개. 원래 dot 요청은 claim 후 reply/receipt가 없고 입력/세대는 보존돼 있다. 방 off·Muse 수동 잠금 true, 오늘 API 사용2회·보고34,908토큰, 정책8회·200,000토큰 유지. 실계정 추가 호출0이다.
- 원래 고정 입력69,621 UTF-8 bytes를 새 순수 분할 함수에 읽기 전용으로 적용했다. **16페이지·전체 RPC 최대11,895 bytes·원문/입력 digest 일치**, 현재 같은 과제에서 생성하는 입력도 원래 digest와 같다. 이 검사는 실제 native dot의 페이지 읽기·응답 성공을 뜻하지 않는다.

## 변경이 필요한 이유와 코드 근거

| 근거 | 현재 동작과 영향 |
| --- | --- |
| `src/workspace/engine.ts::DiscussionEngine.control`의 `resume` | 미확정 발언이 하나라도 있으면 `reconciliation_required`. timeout·빌드·재시작만으로 재전송하지 않는 정상 경계다. |
| 같은 심볼의 `reconcile/completed`, `src/workspace/dot-mcp-policy.ts::reconcileDotReply` | native mailbox에 원래 답변이 있어야 대조할 수 있다. 현재 reply가 없으므로 완료로 확정할 수 없다. |
| 같은 심볼의 `reconcile/not_sent` | 원래 turn을 `owner_confirmed_not_sent`로 기록하고 task를 pending으로 돌린다. 실제 이벤트 전달·claim·입력 조회가 있었던 이번 사례에 사용하면 잘못된 기록이다. |
| 같은 심볼의 `reconcile/skip` 및 `resume` | skip은 task를 cancelled로 만든다. resume은 failed task만 다시 대기시키므로 취소한 첫 dot 검토가 다시 실행되지 않는다. |
| `src/web/topic-chat-view.ts::topicPublishedTurns` | 라운드에 배정된 각 참여자의 수락된 답변이 있어야 공개한다. dot 검토를 건너뛰면 해당 라운드 전체의 완전한 공개도 충족하지 못한다. |
| `src/web/control.ts::renderRecords` | 미확정 복구 UI는 완료 원문 반영·미전송 확인·건너뛰기만 제공한다. 이미 전달됐으나 외부 실행을 중단한 경우의 명시 재시도는 없다. |
| `src/connections/dot-mcp.ts::DotMcpAdapter.settle/call`, `src/workspace/dispatch.ts::DispatchCoordinator.settle` | 원래 turn/lease를 정산하고 구세대/종료 요청의 늦은 답변을 차단하는 경계는 이미 있다. 이를 재사용하며 기존 요청을 다시 waiting으로 바꾸지 않는다. |

임시 합성 검사 `/tmp/webjjoku-d5-recovery-baseline.test.mjs`에서 실제 기존 fixture를 사용해 **조회→claim→페이지 조회→timeout**을 재현했다. `resume` 거절, reply 없는 완료 대조 거절, skip 후 task cancelled, 이어가기 후 **첫 라운드 dot 완료0·첫 라운드 공개0**, 기존 완료 답변 보존을 확인했다. 검사1 PASS/fail0/skip0이다. 외부 서비스·실계정·운영 DB를 사용하지 않았다.

```bash
node --test --test-isolation=none --test-reporter=spec \
  /tmp/webjjoku-d5-recovery-baseline.test.mjs
```

## 대안과 권장안

| 대안 | 변경량·이득 | 한계/판정 |
| --- | --- | --- |
| 기존 skip 후 남은 절차만 수행 | 제품 변경0, 기존 기록 유지 | 이번 두 라운드 전체 수락을 충족하지 못한다. 완료 기준을 낮추는 대안으로 사용하지 않는다. |
| 원래 토의 보존·종료 후 새 검증 토의 생성 | 제품 변경0, 처음부터 온전한 수락 가능 | 완료8개를 새 검증에서 다시 호출하므로 비용/시간이 늘며 기존 같은 토의를 이어가는 목표를 충족하지 못한다. 별도 실호출 승인 필요. |
| **소유자가 외부 실행 중단·미제출을 확인한 뒤 같은 과제의 새 요청을 준비** | 기존 완료8개와 원래 실패 요청을 유지하고 해당 검토만 다시 수행 가능 | 복구 API/UI 계약의 선택지 추가이므로 사전 승인 필요. **권장** |
| held 요청 직접 활성화·미전송으로 기록·DB 수동 수정 | 겉보기 빠른 재개 | 사실·권한·단일 실행·복구 경계를 깨므로 기각. |

## 승인된 계약 — 주제 토의의 dot 미확정 복구만

1. 기존 소유자 인증 `discussion control/reconcile`에 **제안** `resolution: retry_after_stop`을 추가한다. native dot의 주제 토의 발언에만 적용하며 상주 자유 발화·업무·Muse/API/Codex의 재시도 계약을 바꾸지 않는다.
2. 소유자가 원래 외부 실행의 중단과 submit 미실행을 대조했음을 명시해야 한다. 감시 비활성/room off만으로 실행 종료를 자동 추정하지 않는다. UI 확인과 짧은 대조 사유를 기존 journal에 남긴다. 실제 외부 작업 종료 여부를 서버가 독립적으로 증명한다고 표시하지 않는다.
3. 서버는 같은 토의/현재 revision·phase·round·문맥 generation·참여자 identity, 해당 task의 최신 turn 및 미확정 lease·held 요청·reply 없음, 같은 고정 입력 digest를 검사한다. 이미 수락된 결과·새 요청·다른 진행 lease·취소/완료한 토의·구세대 과제는 거절한다. **원래 grant가 회수되거나 방이 off인 것은 과거 요청 종료를 기록하는 소유자 동작과 구분**한다. 이 동작으로 grant/방을 재활성화하지 않는다.
4. 기존 transaction에서 원래 turn을 ‘소유자 중단 확인 후 재시도 준비’로 종료하고 같은 task만 pending으로 전환한다. 원래 timeout 사유와 소유자 확인·원래 turn/task 참조를 event에 보존한다. 원문·claim·outbox·receipt와 기존 완료 turn8개는 삭제하거나 덮어쓰지 않는다. 기존 `DispatchCoordinator.settle`/`DotMcpAdapter.settle`로 이전 lease/request를 정산한다.
5. 복구 명령 자체는 새 이벤트·모델 호출을 시작하지 않는다. 토의는 blocked/paused 상태로 두며 기존 **명시적 이어가기**가 필요하다. 새 실행은 별도 requestId와 현재 유효한 grant·구독·방/멤버·generation·입력 snapshot을 사용한다. 같은 taskId의 이전/새 turn을 연결해 중복 대조가 가능하게 한다. 예전 attempt/token을 새 요청에 사용할 수 없다.
6. 동일 명령 재전송은 기존 idempotency 결과를 돌려주고 새 요청은 최대1개만 준비한다. 종료된 옛 요청의 늦은 submit은 기존 권한 경계에 따라 거절하거나 격리하며 현재 답변·공개·action에 적용하지 않는다. 페이지 도중 다시 timeout이면 다시 미확정으로 멈춘다. 자동 재시도·timeout 확대·한도 초기화는 없다.

DB 버전/이관 **0**, 기존 `Providers.complete`, Store transaction, event log, Task/DiscussionTurn/DotRequest 및 분할 조회를 재사용한다. 기존 `completed/not_sent/skip` 호환을 유지한다. 새 owner 명령 선택지와 추가 감사 event data가 최소 계약 변경이다. 기존 상태 전이와 순수 검증 함수를 조합하며 새 복구 프레임워크/실행기를 만들지 않는다.

## 파일·현재 및 후속 영향·변경량

| 범위 | 실재 파일·심볼 / 신규는 제안 | 추정(add+delete) |
| --- | --- | --- |
| D3 복구 정책·명령 | `src/workspace/engine.ts::DiscussionEngine.control`, `src/workspace/dot-mcp-policy.ts`에 작은 검증 helper **제안** | 2파일·70~120줄 |
| D4 소유자 복구 UI | `src/web/control.ts::renderRecords`의 native dot 전용 확인 동작. 일반 연결/로그인 UI 유지 | 1파일·25~50줄 |
| D3/D5 회귀 | `tests/dot-mcp.test.mjs`, `tests/dot-mcp-restart.test.mjs`, `tests/browser/dot-connection.test.mjs`, 필요 시 공통 `tests/dot-mcp-fixture.mjs` 재사용 | 3~4파일·170~300줄 |
| 계획·운영·증거 | `docs/development-plan.md`, `docs/reviews/dot-official-mcp-events-impact-20261101.md`, `docs/dot-connection-runbook.md`, **제안** 구현 기록 `docs/implementation/dot-explicit-retry-20261102.md` | 4파일·85~180줄 |
| **합계** | 이 사전 제안서 제외, 중복 파일 제외 | **10~11파일·350~650줄**. fixture 분할이 필요하면 최대12파일 안에서 설명 |

후속 비용을 포함한 추정이다. 작은 fixture로 실제 경계를 검사하고, 운영 데이터의 private 대조 기록/명령은 공개 제품 코드에 넣지 않는다. 추가 모델·인증·DB 필드·다른 실행 종류의 재시도까지 필요해지면 확대분을 다시 보고한다.

- **D1/D2:** 권한·Events schema·transport 재시도 변경0. 원래 요청 정산/늦은 전달 처리 회귀만 추가한다.
- **D3:** 위 owner 복구 선택지와 검증 추가. claim/submit/분할 조회·complete·단일 슬롯은 유지한다.
- **D4:** native 토의 복구 확인 UI와 운영 안내 보완. grant 재연결은 기존 경로를 사용하고 새 OAuth/Tunnel은 추가하지 않는다.
- **D5/R8:** 기존 두 라운드·원래50 gate 수락을 유지한다. 복구 후 원래8개 보존·새 요청1개·구요청 공개0을 추가 검사한다. 실제 native 페이지 조회/제출은 계속 별도 실계정 수락이며 이번 제안으로 PASS 처리하지 않는다.
- **R1:** 기존 상태/transaction/journal 사용, schema 이관0. **R2:** 주제 토의의 수동 복구만 영향. 상주 자동 scheduling/발화/모드 전환은 유지한다. **R3:** 기존 복구 화면만 영향. **R4:** Muse/browser·GPT·DeepSeek·Anthropic 연결 변경0. **R5/R6/R7:** 업무/실행/Wiki의 재시도·승인·저장 계약 변경0; 원래 Wiki 가시성·입력 검사와 단일 슬롯을 그대로 거친다.
- R8/D5 이후 확정된 새 페이즈는 없다. 실제 Codex·실기기·장기 운영 등 남은 수락은 이 보완으로 완료되지 않는다.

## 수락·검증 방법·롤백

1. **합성 원인 재현:** 전달/claim/page 조회 후 timeout 사례에서 원래 실패와 완료 답변을 보존한다. `node --test tests/dot-mcp.test.mjs`로 복구 command20회→준비1회·새 외부 호출0, 별도 resume→해당 과제 새 request1개를 확인한다.
2. **거절 경계:** 종료 확인 누락·다른 participant/과제·구 revision/generation/phase·입력 변화·reply 이미 존재·진행 중 다른 lease·새 attempt/재생·완료한 토의는 상태 변경0이다. 이전에 허용된 세 복구 경로도 회귀한다.
3. **늦은 답변·재시작:** 새 요청 생성 전/후 옛 submit의 공개0, 원문 보존. 복구 transaction 후 SIGKILL/재시작으로 새 전송0. 실제 새 요청의 페이지 중간 SIGKILL은 기존 held를 유지한다. `node --test tests/dot-mcp-restart.test.mjs` 및 기존 통합 fixture로 검사한다.
4. **UI:** 실제 Chromium fixture에서 dot에만 선택지가 표시되고, 명시 확인 없이 준비할 수 없으며 준비 이후에도 ‘이어가기’가 별도임을 화면/API 이벤트로 확인한다. Muse·API의 기존 버튼은 유지한다.
5. **전체 회귀:** 구현 후 `npm run check`와 설치 Chrome MCP를 지정한 `npm run test:browser`. SKIP을 PASS로 쓰지 않는다. DB 이관이 없으므로 관련 contract가 변경되지 않으면 설치 Codex schema/실계정 검사를 이유 없이 반복하지 않는다.
6. **복귀:** 진행 발언 중지/미확정 대조→원래 방 off·Muse 잠금·감시 종료 후 이전 배포로 복귀한다. pending task가 있어도 명시 resume 전까지 토의를 멈춘 상태로 유지한다. 이미 기록한 수동 복구·실제 답변·원래 실패 원문은 DB 백업으로 덮어쓰지 않는다.

## 승인 범위와 후속 확인

승인 범위는 **위 native dot 주제 토의의 명시 재시도 복구 계약·계획 개정·구현·합성 검사/검토 가능한 PR**이다. 이 개발 범위의 미결정 사항은 없다. 실환경 적용·새 native 감시/모델 호출은 코드 검증 뒤 구체 범위로 별도 확인한다.

실호출 재개 시 오늘 API 잔여는 현재6회·165,092 보고 토큰이며 재개 시점에 다시 대조한다. 이전30분 창을 재사용하지 않는다. 원래8개 완료 답변 보존, 같은 토의 잔여 절차와 dot 후속, 시간/예약/DeepSeek High 상한, Muse 잠금 복구 및 종료 정리를 함께 제시해야 한다.

## 2026-11-04 승인 보완

최초 `retry_after_stop`은 submit 미실행 확인을 그대로 요구한다. 사용자가 [제출 오류 뒤 별도 명시 복구](./dot-page-transport-retry-impact-20261104.md)를 추가 승인했다. 새 `retry_after_failed_submit`은 원래 grant 회수·서버 reply/receipt/text0·외부 실행 중단/추가 제출 없음의 별도 확인과 사유를 요구한다. 오류를 미실행으로 바꾸지 않고 감사 기록에 제출 시도를 남긴다. 동일 task의 준비만 수행하고 별도 resume 전 전송0·기존 완료13개·Muse와 기존 안전 경계를 유지한다. 실제 운영 복구는 아직 NOT_RUN이다.
