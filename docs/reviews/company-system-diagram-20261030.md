# 회사형 시스템도 대조 — 필요한 차이만 보완

- 자료: [웹쫀쿠 채팅방 구성도](https://m.dcinside.com/board/ai_utilize/32669), 게시 시각 2026-08-15 23:05:09.
- 검토: 본문과 첨부 6장 정적 열람. 원문/이미지는 /tmp에만 두고 저장소로 복사하지 않았다. 첫 장은 서비스/MCP/저장소/대화·인계 관계, 나머지는 이전 다중 탭·채팅·Wiki·상태 카드·마을 화면이다.
- 기준 유지: 코드 C=`8f81d861b3f170ef2024b90d9eeba56ce34f0f79`, 계획 P=`8db0f42f499f674c66c3a0df0a4d8e0f25fb216e`. 기존 [104판정](./plan-decision-register-20261030.md)은 바꾸지 않고 이 대조를 추가한다.
- 외부 구현 코드/서비스·MCP protocol·실행 수/처리량·실제 보안 보장은 **UNVERIFIED**다. 작은 그림의 세부 문구/인계 payload를 API 명세처럼 복원하지 않는다. 이번 산출물은 계획 수정이며 코드/서비스/로그인/모델 실행·commit/push/PR/배포는 없다.

## 1. 대조 결과

상주 방+작업큐+Wiki·MCP·실행/보고·Human 제어는 현재 개정 계획에 이미 있다. 이를 새 발견이나 완료 기능으로 다시 세지 않는다. 누락/불명확한 **역할 프로필, 상주 문맥 인계·세대 대조, 읽기 전용 상태 알림** 세 가지를 기존 R단계 안에서 보완한다. 새 서비스/데몬/DB·범용 SSH 실행기는 도입하지 않는다.

첨부 Wiki 화면은 앞서 읽은 31803 자료의 Wiki 이미지와 바이트 해시도 일치했다. 같은 자료를 새 기능/검증 성공의 추가 증거로 중복 계산하지 않았다.

| ID | 자료에서 관찰한 구성 | 판정 | 현재와의 차이/반영 | 근거 |
| --- | --- | --- | --- | --- |
| F01 | 채팅/업무/이슈·저장소·MCP 기능 구분 | 유지 | 이미 있는 Room/WorkTask/Store/MCP의 모듈 경계로 대응. 별도 프로세스/DB로 분리하지 않음 | 운영 계약 §1/3/7/9, C의 Workspace 결합·Store.transact |
| F02 | 관리·관리보조·분야별 설계/논의·실행 담당 | 수정 | 최소 역할 정책의 예시·발화/업무 권한을 명시. 모델/계정을 고정하거나 특정 dot/Muse를 영구 관리자로 지정하지 않음 | C model.ts::Member.role, 운영 계약 §2.1; R5-F |
| F03 | 문맥/역할·이전 인계·세션 등록과 handoff broker | 수정 | 기존 Context/generation·checkpoint 원문 참조와 대조 절차 위에 resident 전용 인계 adapter/세대 fencing을 제안. 별도 daemon 불필요 | C engine.ts::control(handoff)/checkpoint, model.ts::Context/Observation; R2-H~J/R7-G |
| F04 | 서버 알리미·도구/작업 상태·이전 세대 표시 | 수정 | 기존 observation/job/capability의 읽기 전용 projection으로 알림. 마지막 말/실제 진행/관측 시각을 분리 | C Context.observation, Workspace.snapshot, inspectCapabilities; R3-F |
| F05 | 작업 현황과 Wiki의 역할 분리 | 유지 | 기존 큐가 현재 상태의 권위, Wiki가 출처/버전이 있는 장기 공유 기억 | 운영 계약 §7/8, R5/R7 |
| F06 | 횟수 기반 새 창/세션 교체·이전 컨텍스트 인계 | 기각 | 그림의 횟수를 기본값으로 복제하지 않음. 기존 context 한도/안전 경계에서만 인계하며 browser 원래 대화는 보존 | C engine.ts:143~152의 browser handoff 거절, R2-J |
| F07 | 읽기/쓰기·SSH·vision·세션 삭제/등록 등 폭넓은 MCP 도구 | 기각 | 이 자료만으로 새 권한/연결/도구를 허용하지 않음. 기존 Codex/binding/승인·scoped resident 도구만 사용 | C Providers.complete, CodexExecutor, McpEndpoint; R6/R7 |
| F08 | 다중 웹 탭·마을·캐릭터/건물 UI | 기각 | GUI는 앞서 확정한 단톡방 유지, 지도/건물/게임 제외. 외부 그림/자산 복사 없음 | 기존 GUI 결정 P04/P35/P37 |

F01~F08은 이 참고의 보완 판정(유지2·수정3·기각3)이다. 지정 기준 104항목의 건수와 합산해 원래 판정 수가 바뀐 것처럼 표시하지 않는다.

## 2. 재사용할 실제 backend와 신규 범위

- C의 `src/workspace/model.ts::Context/Checkpoint/Observation`에는 generation·checkpointId·관측/진행 시각·원문 참조가 있다. `engine.ts::control(handoff)/checkpoint`는 예상 세대를 확인하고 prepared/running/unconfirmed를 막으며 browser 인계를 거절한다. **기존 topic 경로는 그대로 사용**한다.
- 그 private checkpoint 함수는 Discussion 구조에 결합돼 있다. 이를 fake Discussion으로 호출하지 않는다. 제안 `resident-context.ts`는 기존 원문 참조/세대/transaction 절차와 Context 형태를 사용해 Room 공개 범위·업무/Wiki 참조를 포장한다. 공통 순수 함수 추출이 이득일 때만 기존 출력/전이 회귀를 보존하며 작게 분리한다.
- C의 `runtime.ts::Workspace` 결합과 `capabilities.ts::inspectCapabilities`가 상태 입력이다. 새 상태 알림 때문에 별도 서비스·OS 셸 polling·모델 판단 loop를 추가하지 않는다. 실시간 CPU/디스크·호스트 관측은 제공 근거가 없으면 UNVERIFIED이며 숫자를 만들지 않는다.
- 새 인계/상태/역할 타입·심볼·검사는 모두 **제안/NOT_RUN**이다. exact schema/수락/rollback은 운영 계약과 R2/R3/R5/R7/R8을 따른다. 기존 auth/complete/Store/6단계/승인/격리/동시 한도는 변경하지 않는다.

## 3. 보완하지 않은 범위와 사용자 결정

U1 예산/갱신·U2 속도/휴면·U3 멤버/role/scope는 그대로 사용자 결정이다. 문맥 인계는 임의 “100마디” 설정을 추가하지 않고 기존 180,000자 context/80,000자 checkpoint 한도의 안전한 경계를 사용한다. 실제 대상/프리셋을 확정하거나 로그인·모델 호출을 시작하지 않았다. 신뢰할 수 없는 결과·세대 혼선·관측 중단은 미확정/차단으로 남긴다.

이 보완으로 R단계는 8개 그대로, 미래 수락 gate는 43개에서 50개로 늘어난다. 실제 수락은 이번 수행하지 않는다. 기존 104판정과 backend 재사용 결정은 유지한다.

정적 문서 검사: 현재 계획 11문서의 링크/앵커 137개 오류0, 판정/단계/gate ID 중복0, HEAD·코드·staging 변화0, 기존 사용자 파일35개 보존을 확인했다. 기존 동작을 재검증한 build/runtime/모델 실행 결과라는 뜻은 아니다.
