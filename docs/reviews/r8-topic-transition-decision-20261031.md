# R8-A 주제 전환 — B안 승인과 구현 계약

2026-10-31 사용자가 영향·변경량 보고 뒤 **“자동 주제 전환 추가 승인 (권장)”**으로 B안을 승인했다. [R8-A](../resident-implementation-plan.md#10-r8--최종-형태-수락과-한계)의 원래 완료 문구를 유지한다. 아래 A/B 비교는 결정 근거이며 A안은 채택하지 않았다. 이 기록은 자동 주제 구현 전에 SSOT·운영 계약·단계별 계획과 함께 갱신한다. 실계정 호출·배포·쓰기 gate 해제 승인은 포함하지 않는다.

## 확인한 차이

R8-A의 원문은 “방 on→사용자 추가 지시 없이 자유 대화→업무1 pickup→결과/반려1회→재작업/완료→Wiki1갱신→다음 발화 인용→topic1회→같은 방 복귀”다. 실제 [ResidentRunner.focus](../../src/workspace/resident-runner.ts)는 owner API를 통해 기존 engine.create를 호출한다. [ResidentReply validator](../../src/workspace/resident-prompts.ts)는 work_propose/work_report/work_review/wiki_edit만 허용하고, [ResidentMcp](../../src/workspace/resident-mcp.ts)에도 주제 전환 도구가 없다.

[통합 검사](../../tests/resident-e2e.test.mjs)는 방 on 이후 사용자 중계0으로 3인 발화·분석 제안·픽업·반려/재작업·Wiki/다음 발화까지 확인했다. 그 뒤 기존 owner focus API1회를 요청하면 같은 방으로 한 번 복귀한다. 이는 참여자가 무인으로 topic을 시작했다는 증거가 아니다. 이 최초 검사 때는 R8-A 전체를 UNVERIFIED로 남겼다. B안 승인 뒤 새 무인 검사로 topic1·복귀1·owner focus0을 관측했으며 현재 결과는 실행 기록/manifest를 따른다.

## 대안과 변경량

| 선택 | 현재 계약과 차이 | 예상 변경량 | 수락·위험 |
| --- | --- | --- | --- |
| A. 주제 버튼 유지 | 제품 코드는 유지하고 R8-A를 “업무→Wiki까지 사용자 중계0, owner 주제 요청1회→방 복귀”로 명시 | 계획·수락/manifest·실행 기록·운영 절차·README 등 기존 문서 약5~6개/20~50줄. 이미 작성한 통합 검사 재사용 | 기존 권한/데이터/복구 영향0. 사용자 추가 요청0의 범위를 줄이는 수락 문구 변경이므로 명시 승인 필요 |
| B. 허용된 자동 주제 전환 추가 | owner가 방 설정에서 명시 허용한 경우만 참여자가 topic intent를 제안. 기존 provider1·예산·root workflow·generation/scope를 통과한 intent만 기존 engine.create로 전달 | source 약8~10개(신규1~2 포함), tests 약4개, 계획/증거/운영 문서 약4~6개. 총16~20개 파일·약450~850줄 추정 | 신규 권한·intent·설정/이관 계약이므로 승인 필요. 기본 비활성·옛 grant 확대0·읽기/쓰기/Codex 승인 변경0. 중복/폭주·늦은 intent·focus crash/restart를 추가 검증 |

수치는 코드 접점에 따른 정적 추정이며 구현 diff 실측은 아니다. B는 `resident-model.ts`의 optional 설정/intent·`resident-prompts.ts`의 완성 intent 검증·`ResidentRunner`의 다음 활동 선택/복구·`runtime.ts`의 기존 객체 결합·`resident-store.ts`의 owner 설정 검증·`room-view.ts`/`control.html`의 명시 선택, 신규 제안 `resident-focus.ts`의 journal→기존 engine.create 연결을 예상한다. provider complete·topic parser·Codex RPC·Store 물리 스키마는 유지한다. MCP 도구/기존 grant 자동 확대는 포함하지 않는다.

B의 외부 전송은 Store transaction 밖에서 수행한다. 서버가 고정한 requestId·room epoch·actor generation/identity·기존 예산과 정확한 생성 입력을 먼저 저장하고, 생성 후 중단되면 기존 discussion/command 결과만 회수한다. room off·권한 회수·다른 root 작업·미확정 상태에서 새로운 topic을 만들지 않는다. 사람이 허용하지 않은 기존 방을 자동 전환 가능 상태로 승격하지 않는다.

## 전체 페이즈·호환·복귀 영향

- R8는 마지막 확정 페이즈여서 후속 번호의 단계는 없다. 임의의 페이즈9를 만들지 않는다.
- A는 R1~R7 계약/코드·진행 순서 영향0이며 R8-A 완료 문구만 변경한다. 추가 전체 회귀가 필요한 제품 변경은 없다.
- B는 R2의 활동 선택·generation/복구와 R3 설정 UI에 접점을 추가한다. R5/R6의 현재 업무·job이 있을 때 자동 topic과 경쟁하지 않도록 기존 단일 dispatch/root 검사와 통합 회귀가 필요하다. R7의 고정 Wiki snapshot·출처/세대 fencing을 새 intent에도 적용한다. 기존 데이터와 이미 수락한 보고/인용은 유지한다. 영향이 예상보다 커지면 확대분을 다시 보고한다.
- B의 추가 수락은 owner 미허용/구세대/회수 scope/off/budget 소진에서 자동 topic0, 같은 intent20회/생성 중 crash에서 topic1/복귀1·중복 호출0, 기존 업무/job·비공개 라운드 장벽과 승인/격리 회귀다. 원래 R8-A 3인 무인 전환을 실제 fixture로 증명해야 한다.
- 복귀는 G0 이후 새 자동 전환을 비활성화하고 intent/원문/영수증을 read-only로 남긴다. 시작/미확정 토론·job을 삭제·재전송하거나 옛 DB로 복원하지 않는다. A는 제품 변경이 없어 기존 G0를 유지한다.

## 승인된 최소 계약

1. Room의 optional `autoTopic`은 누락/false면 금지다. owner의 기존 off 상태 configure에 boolean을 추가하고 UI 체크로 명시 허용한다. 새 endpoint·MCP 도구·grant 권한은 추가하지 않는다.
2. 새 `topic_propose`는 완성된 ambient say의 구조화 제안이다. 공개 sourceMessageIds·주제·비교 기준·검토 라운드만 받는다. 참여자 집합은 현재 허용 멤버에서 서버가 정하고, private 자료/명령/실행 권한은 입력으로 받지 않는다. 같은 응답의 업무/Wiki 처리를 먼저 끝내고 진행 중 업무/실행이 있으면 topic intent를 보류한다.
3. 새 제안 모듈 `resident-focus.ts`는 기존 Store transaction으로 원래 turn/index·actor identity/generation·room epoch·멤버/seat 정책·생성 입력/digest를 journal에 저장한다. 기존 `DiscussionEngine.create`를 transaction 밖에서 한 번 호출하며 같은 requestId/input의 command receipt로 생성 후 crash를 대조한다. 기존 `Providers.complete`·topic parser·Store 물리 schema·Codex RPC/승인/격리는 유지한다.
4. 적용 전·복구 시 off/허용 회수/세대·identity·역할 변경/공개 Wiki 범위 변경/한도 소진은 거절하고 원문을 보존한다. root/lease/미확정/job·진행 업무는 새 시작을 보류한다. engine 자체의 dispatch 예산/공개 라운드 장벽을 그대로 통과한다. 이미 생성한 discussion은 새로 만들지 않고 원래 ID만 회수한다.
5. 기존 방/legacy 입력은 무변경이며 intent는 additive optional 기록이다. malformed intent는 시작하지 않고 fail closed한다. G0/off 후 autoTopic=false와 flag off로 신규 시작을 막고 journal/토론/원문/영수증을 보존한다. 기존 빌드 복귀 전 진행 중 topic/job을 기존 절차로 대조한다.

수락은 앞 절의 숫자와 원래 R8-A를 유지한다. 변경량이 승인한 추정 범위를 넘는 설계 변경은 추가 보고·승인 후 진행한다. 실계정 R8-D·실기기·실제 쓰기 허용은 별도다.
