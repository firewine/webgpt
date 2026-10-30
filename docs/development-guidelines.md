# 후속 개발 지침 — 기존 계약을 지키는 디자인 패턴

> **현재 구현 지시**: [개발 페이즈 SSOT](./development-plan.md#개발-페이즈-ssot--구현-순서상태의-단일-기준)가 순서·범위·상태의 단일 기준이다. 현재 승인 범위와 결과는 위 SSOT를 따른다. 아래 문서의 과거 “계획만/구현 금지”는 당시 개정 작업의 이력이며 현재 페이즈 지시를 대체하지 않는다.

2026-10-30 추가 사용자 지침을 계획 묶음에 반영한다. 이 문서는 **구현 지침**이며 작업 승인 범위를 스스로 넓히지 않는다. 원 계획 개정·문서 발행은 [개정 요약](./plan-revision-20261030.md)의 이력이고, 현재 구현 지시는 맨 위 SSOT가 관리한다. 설계 코드 근거 C/계획 P는 유지하며 변경 단위는 [R1~R8](./resident-implementation-plan.md)이다.

## 1. 적용 원칙

패턴은 기존 코드 재사용·중복 방지·상태 일관성·검증/롤백에 이득이 있을 때 사용한다. 패턴 이름을 늘리거나 모든 타입에 interface/abstract class를 만드는 것을 목표로 삼지 않는다. 이미 존재하는 Providers/Store/adapter/실행기/인증을 “더 깔끔한 구조”로 바꾸는 계획은 기각한다. 먼저 실제 중복·변경 이유와 영향을 받는 계약을 적고 가장 작은 함수/모듈 조합으로 해결한다.

기준 코드가 갖춘 경계는 구현 근거와 함께 보존한다. Providers.complete는 transport의 호출 계약(E5), Store.transact는 상태/event/command의 원자적 단위(E10), engine.turn/recover는 전송/대조 절차(E12), CodexExecutor는 별도 실행 수명/권한(E13), Workspace는 이 객체를 결합하는 위치(E11)다. 이들이 어떤 패턴 이름에 “완벽히 부합한다”는 평가를 구현 근거 대신 사용하지 않는다.

## 2. 어떤 곳에 무엇을 쓰는가

| 경계 | 적용 방식·패턴 | 실제 이득·확인할 것 |
| --- | --- | --- |
| 기존 backend와 새 상주 운영 | **Composition + Dependency Injection.** runtime에서 기존 객체를 넘기고 새 서비스가 필요한 작은 계약만 사용. 예: Pick<Providers,'complete'> 유지 | provider/auth 교체 없이 fake 주입과 기존 회귀 가능. 전역 singleton/거대 DI container·범용 BaseWorkflow 재작성 불필요 |
| topic JSON과 resident 발화 | **Adapter.** 별도 ResidentReply validator/projector로 text/actions를 해석하고 기존 topic parseReply는 그대로 | 인터페이스 불변, 자유 text를 위해 claims/evidence를 잃거나 provider raw-text 모드로 바꾸지 않음. R2-F로 검증 |
| GUI 상태/자동 탐지/preset | **작은 경계 Adapter/Facade.** 기존 API·BrowserBridge를 사용하고 discovery 결과를 기존 probe로 통과시킴 | 새 인증/브라우저 send 경로를 만들지 않음. R3/R4에서 전송0·목표 확인/회귀 검증 |
| Room/WorkTask/epoch·리뷰·Wiki | **명시적 상태 전이.** 입력/현재 상태/버전/권한을 검사하는 작은 순수 정책 함수와 전이표. 저장/외부 실행은 분리 | 허용하지 않은 done·중복 claim·늦은 결과 적용을 막음. boolean 조합/암묵적 상태/패턴 클래스로 감추지 않음 |
| 상태·event·중복 command·lease | **Unit of Work 역할을 하는 기존 Store.transact 재사용.** 하나의 수락/claim/편집과 이벤트·command 결과를 한 transaction에 기록 | 외부 호출은 transaction 밖에서 durable intent와 receipt로 연결. entity마다 Repository/ORM/새 DB를 만들어 같은 원자성을 분산시키지 않음 |
| 여러 scheduler의 실제 호출 | **하나의 Coordinator.** durable lease와 예약 예산을 공통 경계에서 조정하고 기존 engine의 작은 접점만 연결 | loop별 잠금으로 provider 2호출이 생기는 문제 방지. R2-A/B의 최대1·crash 재전송0으로 이득 입증 |
| 후보 선택·역할/priority·focus | **작은 Strategy/정책 함수.** 후보 선택과 실제 dispatch를 분리, 결정에 근거/대상/버전을 남김 | 속도/역할을 바꿔도 auth·기록·예산·승인 로직이 복제되지 않음. 모델/effort 자동 전환 정책은 새로 넣지 않음 |
| event→단톡방/상세/미읽음 | **기존 Event/Projection 재사용.** Store commit 뒤 같은 cursor의 SSE로 UI 갱신. 명령 결과와 렌더 상태를 구분 | 새 Event Bus/Observer framework·별도 서버가 필요하지 않음. 재접속 재생은 event ID로 중복 제거 |
| Wiki 동시 변경 | **Optimistic Concurrency/CAS.** expectedVersion 하나로 검사, 충돌은 명시 보존 | 마지막 작성자 덮어쓰기나 조용한 모델 재시도로 지식 손실을 숨기지 않음. R7-A의 2편집→1성공/1충돌 |
| 상주 문맥 인계·옛 결과 | **기존 checkpoint/generation + CAS/Fencing.** 서버가 고정한 generation으로 인계 적용과 intent/결과 수락 검사 | 새 daemon/세션 재작성 없이 원문/업무/예산을 잇고 stale 결과의 현재 action 적용을 막음. badge 이름만으로 fencing 완료라 하지 않음 |
| 바깥 JSON/AI intent와 내부 권한 | **명시 DTO + 검증/명령 경계.** actor/scope는 인증에서, 원문 참조는 실제 데이터에서 확인 | 임의 text/role/wiki를 shell·권한으로 평가하지 않음. 승인·부작용은 완성/검증 뒤 한 번만 수행 |

이 표의 새 서비스/심볼은 제안이다. DI container, 거대한 추상 계층, generic repository, 새로운 message broker·microservice, 전면 CQRS/Event Sourcing은 현재 필요하지 않다. 기존 Store는 state snapshot+이벤트/중복 명령 journal이며 모든 상태를 event만으로 재구성하는 Event Sourcing이라고 가정하지 않는다. 기존 이벤트만 replay하면 모든 Room/Task를 복원할 수 있다는 근거 없는 보장도 하지 않는다.

## 3. 구현 때의 결정 기록

후속 변경 단위마다 다음 5가지를 짧게 남긴다. 기존에 허용한 범위의 routine 수정에 새 승인 절차를 만들지 않는다.

1. 해결할 실제 사용자 흐름/오류와 C의 파일·심볼. 어떤 기존 객체/계약을 그대로 쓰는가.
2. 패턴/함수 분리 선택과 이득. 추가 abstraction 없이 해결하는 안과 비교하고 더 작게 가능한지 확인.
3. 유지/변경 interface·state/event·migration·scope. 변경이 불가피한 이유와 최소 파일 범위. 공개 계약을 바꾸면 짧은 ADR/계약 비교를 남기고 기존 승인 경계를 지킴.
4. R단계의 의미 있는 실패/경쟁/crash/호환 검사. 구현 함수의 사소한 모양을 그대로 반복하는 테스트를 추가하는 것으로 대신하지 않음.
5. G0와 해당 단계 rollback: 진행 중/미확정·queued job·원문/idempotency를 보존하며 앞 단계로 돌아갈 수 있는가.

체계적인 패턴 적용은 조건문 수·클래스 수를 늘리는 일이 아니다. 예를 들어 Wiki 편집에 CAS 정책 함수와 Store transaction 하나로 충분하면 복잡한 State 패턴 객체군을 만들지 않는다. 반대로 기존 topic/새 room에 비슷한 전송 기록 로직을 복사했다면, 공통 journal/driver 경계를 먼저 검토하되 기존 결과/receipt/state 전이가 달라지지 않는 회귀 증거를 남긴다.

## 4. 단계별 적용과 금지한 우회

- R1: additive state·기존 Unit of Work, 미래 스키마 fail closed. 새 저장소/기존 DB 초기화 금지.
- R2: 작은 DI/Adapter·공통 Coordinator·명시 전이. 기존 provider/engine 전체 재작성·미확정 lease TTL 해제 금지.
- 상주 인계는 규칙/참조 pack·generation CAS·공개 범위 검사로 작게 구성하고 상태 알림은 기존 observation의 순수 projection으로 만든다. 새 역할 이름을 추가했다고 별도 모델/서비스/권한을 생성하지 않는다.
- R3: 기존 DOM helper/renderer와 동일 API/SSE. topic console의 인증·승인·복구 기능 제거 금지. view 모듈화가 별도 backend/세션을 만들면 안 됨.
- R4: read-only discovery→기존 probe. “프리셋”이라는 이유로 계정/thread/초안 가드 생략 금지.
- R5/R6: claim/intent/receipt/리뷰의 상태 전이와 WorkJobLink. 분산 transaction을 흉내 내며 외부 호출을 Store transaction 안에 넣거나 재전송으로 원자성을 맞추지 않음.
- R7: Wiki CAS/출처 projection·scoped intent. reported 자동 게시가 검증/권한 자동 승격이 되면 안 됨.
- R8: pattern 채택 여부보다 실제 전체 흐름·실패/롤백·기존 계약 회귀로 완료 판정. 실제 검증하지 않은 새 타입/패턴에 “구현 완료” 표시 금지.

이 지침의 수락은 단계별 기록에서 ① 계약 유지/변경 표 ② 작은 변경 근거 ③ 해당 경쟁/장애 gate ④ 데이터 보존 rollback이 모두 있는지로 확인한다. [R1 실행 기록](./implementation/phase1-resident-foundation-20261030.md)의 composition·기존 transaction·명시 CAS와 [R2 실행 기록](./implementation/phase2-resident-runtime-20261030.md)의 공통 coordinator/JSON adapter·전송 직전 port·인계 CAS/SIGKILL fixture로 적용을 확인한다. 후속 단계의 패턴·실행 증거를 선행 완료로 간주하지 않는다.

## 5. 계획 변경 사전 승인과 후속 페이즈 영향 검토

2026-10-30 사용자 지시: 개발 중 계획 변경이 필요하면 먼저 승인받고 계획서를 변경한다. 변경량은 현재 단계와 후속 페이즈를 함께 검토한다. 이 절차는 이번 지시를 기록한 것이며 제품 범위·단계·수락 기준을 변경하는 승인이 아니다.

**승인 대상:** 목표/기능 범위, 페이즈 순서·의존성, 계획에 명시한 API·데이터·이벤트·권한/예산/복구 계약, 이관/롤백 방식, 수락 기준의 변경·완화·이월. additive 변경도 다른 페이즈의 계약을 바꾸면 포함한다. 페이즈 개발 승인이나 commit/push 승인을 계획 변경의 포괄 승인으로 해석하지 않는다. 판단이 불명확하면 계획 변경 후보로 보고하고 승인 전 종속 작업을 보류한다.

승인된 계약·범위 안의 구현 선택/오류 수정과 사실에 근거한 상태·검사 증거 기록에는 이 절차로 새 승인을 요구하지 않는다. 완료 기준을 낮추거나 미실행을 완료로 바꾸는 것은 사실 기록이 아니다.

**승인 전 변경 제안에는 다음 내용을 담는다.** 별도 검토서/변경안은 제안·미승인으로 작성할 수 있지만 승인된 SSOT·계획 본문이나 변경에 종속된 코드를 먼저 바꾸지 않는다.

| 항목 | 보고할 내용 |
| --- | --- |
| 변경 이유·근거 | 바꿀 문서/절·기존 결정과 변경 후 결정, 실제 코드 경로/심볼·발생 조건·검사 근거 |
| 대안 비교 | 현재 계획을 유지하는 안과 최소 변경안, 각각의 이득·한계 및 추천 이유 |
| 현재 페이즈 변경량 | 수정/신규 파일·모듈, API/모델/이벤트/이관·검사 변화와 예상 수정 규모. 파일 수·줄 수 범위 등 측정 가능한 값과 추정 근거/불확실성을 표시하며 미측정은 미측정으로 남김 |
| 모든 후속 페이즈 영향 | 남은 각 페이즈별 영향 있음/없음/미확인과 근거, 소비하는 계약·의존 순서·추가 구현/재작업·필요 검증·문서 변화. 간접 영향도 추적 |
| 전체 변경량·위험 | 현재+후속의 합산 규모, 중복 구현/재작업 증감, 기존 호환성·데이터/안전 경계·일정 위험. 승인된 범위를 넘어 추가 승인이 필요한 부분을 명시 |
| 수락·롤백 | 유지/추가/변경할 수락 기준과 명령/화면/로그 증거, 실패 시 원문·receipt·진행/미확정 작업을 보존하는 복귀 방법 |
| 승인 요청 | 정확히 승인할 변경과 제외/미결정 사항. 사용자 답변 전에는 해당 변경을 승인된 것으로 간주하지 않음 |

현재 페이즈에서 작게 보인다는 이유로 후속의 연결·큐·실행·Wiki·통합 검증 비용을 생략하지 않는다. 아직 확인하지 못한 영향은 “없음”으로 확정하지 않는다. 검토는 해당 변경에 비례해 간결하게 하되 위 항목은 빠뜨리지 않는다.

**승인 후:** 승인한 변경안/사용자 승인일·조건을 기록하고 SSOT와 영향받는 계획 문서를 함께 갱신한 뒤 그 범위에서 구현한다. 예상보다 범위나 후속 변경량이 커지면 차이를 다시 보고하고 확대분 승인을 받는다. 승인 대기 중에도 그 변경에 의존하지 않는 기존 승인 작업은 계속할 수 있다. PR 병합은 계속 사용자 담당이다.
