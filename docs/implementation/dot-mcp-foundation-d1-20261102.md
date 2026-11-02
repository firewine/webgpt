# 공식 dot D1 — 연결·권한·영속 기반

2026-11-02 KST. 사용자가 PR #36 병합 후 다음 단계 진행을 지시했다. 기준 main은 `5b0eaaeb177803fdebf936638b211156a0fb1003`, 작업 브랜치는 `codex/dot-mcp-foundation-d1-20261102`다. [SSOT](../development-plan.md)·[승인 D0~D5 계약](../reviews/dot-official-mcp-events-impact-20261101.md)을 따른다. **D1 구현과 격리 검사 PASS, 운영 배포/실계정 grant 전달은 NOT_RUN.**

## 범위와 기존 계약

| 경계 | 구현·유지한 계약 |
| --- | --- |
| `workspace/model.ts::ProviderKind/WorkspaceState`, `dot-mcp-model.ts` | `dot-mcp`와 optional namespace만 추가. binding/도구 grant/세대·권한 버전 metadata를 저장. 기존 kind·DB version1·과거 snapshot은 유지 |
| `dot-mcp.ts::readDotState/DotMcp` | 별도 DB/인증 서버 없이 기존 Store transaction·command journal·Vault를 주입. 서버 검증은 기존 runtime validator들과 같은 시작 경계에서 실행. 타입 전용 model 파일에는 Node 의존성을 넣지 않음 |
| `DotMcp.register/confirm/revoke` | owner 전용으로 연결할 내부 서비스. 신규 dot 연결/참여자를 등록하고 선택 방에는 비활성 멤버로 추가. owner 확인 뒤에도 `nativeActorVerified=false`, 모델 목록0·connection unverified·transportReady=false 유지 |
| `DotMcp.authenticate/check` | 기존 scoped Bearer의 무작위 token+해시 검증 방식을 재사용하는 별도 dot grant. 방·참여자·connection identity·binding version·epoch·contextGeneration·허용 도구·만료·회수·현재 membership을 대조. dot grant로 기존 MCP/Codex/Wiki 도구를 자동 허용하지 않음 |
| `runtime.ts::Workspace.snapshot/removeConnection/cleanupConnection` | snapshot에서 token/hash를 제외. 삭제 transaction에서 dot 권한도 회수하고 기존 credential cleanup intent로 재시도. 원래 participant/room/discussion snapshot은 보존 |
| `providers.ts::Providers.models/complete` | 기존 인터페이스 유지. D1 dot은 전송 전에 `dot_transport_not_ready`로 거절해 DeepSeek/GPT/Chrome 분기로 흘러가지 않음. 실제 completion은 D3 |

owner 확인은 소유자가 실제 dot에서 연결을 확인했다는 명시적 선택을 기록하는 경계이며, dot 계정의 암호학적 신원 증명이 아니다. 호출자가 보낸 이메일/별칭/nativeActorId를 인증 주체로 받아들이지 않는다. `native-dot`은 논리적 참여자 식별값일 뿐 API 모델명/Extra high 지원 광고가 아니다. 기존 Store/Vault 구현과 Providers.complete·dispatch·엔진·작업큐·Wiki·Codex·API 한도는 재작성하지 않았다.

## 저장·복구·이관

resident 기능이 켜진 기존 상태에는 `dotMcp.schemaVersion=1`, 빈 bindings/grants만 한 번 추가한다. 기존 browser의 `target=dot`을 변환하지 않으며 Muse/profile/credential도 그대로다. flag off에서는 기존 namespace를 읽기 검증하되 새로 초기화하거나 권한을 사용할 수 없다. 미래/손상 schema는 다른 runtime 이관 전에 거절한다.

권한 발급은 **prepared intent/command ID 기록 → Vault 암호화 저장 → active와 owner 확인 기록** 순서다. 각 DB 전이는 상태/event를 같은 transaction에 저장한다. raw token은 Vault와 owner 호출의 반환값에만 있으며 command journal에는 grant ID만 남긴다. 재호출은 같은 ID를 사용하고, 이미 회수됐거나 준비 중인 결과를 새 권한으로 되살리지 않는다. 권한 재발급은 새 token/버전으로 이전 요청을 차단한다.

준비 상태에서 종료되면 credential 파일 유무와 관계없이 복구 시 회수한다. 활성 기록인데 암호화 파일이 없거나 해시가 다르면 해당 binding을 회수한다. 활성 commit까지 끝난 유효 credential은 보존하지만 멤버/방/세대 조건이 맞아야 사용 가능하다. 회수된 암호화 파일은 감사/복구용 참조와 함께 남고, 연결 삭제 때 기존 cleanup 절차로 제거한다. 파일 삭제 실패로 DB의 회수 상태가 되돌아가지 않는다.

## 수락 증거

검사는 운영 경로와 분리된 `/home/firewine/webgpt-worktrees/dot-mcp-d1`에서 임시 DB/fixture만 사용했다. Node24.18.0/npm11.16.0. 운영 저장소의 dist는 빌드하지 않았다.

| 승인 D1 수락 | 결과·검증 방법 |
| --- | --- |
| 이전 상태2종을 각2회 이관, 원래 ID/digest/cursor/command 보존·새 on0 | PASS. `tests/dot-mcp-foundation.test.mjs`의 legacy/resident 두 실제 SQLite 재오픈, 원래 Muse binding/Vault 값과 상태 deepEqual |
| 잘못된 actor/scope/grant10종 이상, 조회/변경0 | PASS. token·다른 방·다른 참여자·도구·권한 버전·방 epoch·문맥 세대·identity·멤버 비활성·삭제·만료·회수12종, 거절 뒤 state/cursor 동일 |
| Vault/DB 경계3crash·secret 로그0·잘못된 active0 | PASS. 실제 child SIGKILL을 파일 저장 전/후·활성 commit 후에 수행하고 Workspace 재기동. 준비 상태 회수·유효 commit 보존·기본 멤버 off/연결 unverified 확인 |
| command/event/secret·회수·삭제 경계 | PASS. 등록/확인/회수20회 반복→중복0, 재발급/옛 snapshot 거절, SQLite commands와 snapshot/event·암호문에서 raw token 미노출, 실패 cleanup 재시도·원래 기록 보존 |
| 미래 schema·기능 off·다른 provider 오발송 | PASS. 미래 schema에서 startup 이전 상태/lock 보존, off 권한 거절, models/complete 네트워크·dispatched0, dot token의 기존 MCP 접근 거절 |
| 전체 회귀 | `npm run check`: **397 PASS, fail0/skip0**. strict TypeScript·빌드 포함. 신규 D1 22개. 최초 전체 실행의 이관 비교2건은 새 namespace를 명시 검증하도록 보완했으며 기존 원문 비교는 유지 |
| 기존 R8 이관 gate | `tests/resident-e2e.test.mjs`의 기존2건에서 dot namespace empty/off를 별도 확인하고 나머지 legacy 전체 deepEqual 유지. 기존50 gate 수락 수준 변경 없음 |
| browser/실계정 | 이번 로컬 browser 재실행 NOT_RUN(화면 변경 없음). PR CI 결과는 PR에 별도 기록. D1 실계정 grant/Tunnel 전달·운영 DB 이관·배포 NOT_RUN |

로컬 실행 로그는 `/tmp/webjjoku-dot-d1-check-final-20261102.log`에 보존했다. D0의 실제 이벤트/답변·구독 해제는 [앞 단계 실측](./dot-mcp-events-d0-20261101.md#11-감시-해제-확인과-d0-종료)이며 D1 실제 grant의 사용 성공으로 대신하지 않는다.

## 후속 단계와 복귀

D1의 제품·검사 변경은7파일이다. 승인 예상6~8파일 안의 model/service/runtime/provider와 검사 두 파일이며, SSOT/본 기록 및 D0 종료 문서 갱신은 별도다. 새 transport·OAuth·HTTP route·UI 범위를 늘리지 않았다.

- **D2:** 이 grant/버전 경계에 인증된 Events catalog·구독/callback·outbox를 연결한다. production grant를 private 전달기에서 고정하는 경계와 workspace 접근 범위는 실제로 검증해야 한다. D0의 무인증 합성 fixture를 운영 데이터에 연결하지 않는다.
- **D3:** 승인된 기존 Providers.complete/dispatch/원래 turn에 mailbox와 응답 대조를 결합한다. 현재 명시적 전송 차단을 그 단계의 검증된 adapter로 대체한다. 주제별 권한/revision은 해당 요청 snapshot에서 추가 대조한다.
- **D4:** 현재 owner 내부 메서드에 기존 인증/Host/Origin UI·HTTP 경계를 연결한다. 입력의 `ownerConfirmed`만 원격 dot 인증으로 표시하지 않는다. 아직 사용자 화면에서 등록할 수 있는 단계는 아니다.
- **D5:** Muse 원래 연결·혼합 발화/후속 검토·업무/Wiki/Codex와 기존50 gate를 통합 검증한다. 추가 OAuth/공개 ingress 등이 필요하면 영향·변경량을 먼저 보고하고 승인받는다.

복귀는 해당 dot binding/grant 회수 → 원래 turn/미확정 대조 → 해당 신규 transport만 정지 순서다. D1은 transport가 없으므로 provider 호출0을 유지한다. connectionCleanup이 남으면 같은 제거 명령/시작 복구로 처리하며 dot namespace·tombstone·원래 기록을 삭제하지 않는다. Muse/GPT/API 방을 끄기 위해 전체 resident flag를 임의로 바꾸지 않는다. 구버전 바이너리로의 무조건 downgrade는 보장하지 않으며 새 kind/namespace와 미확정 작업에 대한 호환성 검증 후 수행한다.
