# 추천2 — AI 업무 제안·자동 수행·독립 검토·Wiki 순환

상태: **실계정 부분 수락 / 독립 검토 FAIL / 후속 대화 인용 NOT_RUN.** 사용자가 “2번 개발”과 이어서 “서버 적용·실검증·임시 한도 승인”을 허용했다. PR #53 병합 main `76540a211ef39129e850c9051d7280a2a39e6ed7`을 운영에 적용해 실제 API3요청을 수행했다. 제안·자동 수행·보고 Wiki 게시까지 확인했으나 검토 예시의 계약 불일치로 중지했다. 예시 수정은 작업 브랜치에서 검사하며 운영에는 아직 적용하지 않았다. [페이즈 SSOT](../development-plan.md)와 [추천2](../reviews/next-development-recommendation-20261105.md)의 기존 R5/R7 수락 범위를 유지한다. 전체 업무 순환을 완료로 표시하지 않는다.

## 기존 계약과 이번 변경

기존 `WorkQueue.applyProposals/proposeState/prepareTurn/finishTurn/reviewState`가 AI 제안→자동 픽업→산출물·검토를 처리하고 `Wiki.publishReport/contextWiki`가 보고 게시와 후속 입력 인용을 제공한다. `ResidentRunner`·단일 `DispatchCoordinator`·Store state/event/command transaction·provider complete·기존 JSON 계약을 재사용한다. 신규 큐/DB/API/역할 권한·작업 실행기는 필요하지 않다. 실제 파일 수정은 기존 R6 차단을 유지한다.

두 가지 의미를 유지한다. 업무 보고는 **리뷰 대기 중에도 reported Wiki로 먼저 기록**된다. 리뷰를 기다렸다가 첫 게시를 하거나 수락했다고 verified로 승격하지 않는다. 완료(done)는 현재 보고에 대한 다른 참여자의 수락과 서버의 수용 기준 관측이 필요하다. `text_includes`는 지정 문자열 포함의 관측이며 문서 내용의 사실 검증이 아니다. 기존 독립 검토 계약은 다른 participant이며, 다른 connection/account까지 강제하는 정책을 조용히 추가하지 않는다.

이번 보완은 `scripts/work-wiki-evidence.mjs`의 읽기 전용 기록 대조·검사·운영 절차와 실검증에서 발견한 `WorkQueue.prepareTurn`의 검토 예시 오류 수정이다. 명시한 snapshot의 제안/attempt/보고/리뷰/Wiki/후속 ambient 입력·말풍선 참조를 대조한다. 입력 원문·이메일·키·provider 답변을 출력하지 않고 기존 기록만 읽는다. snapshot의 일관성만으로 실제 계정 호출 성공을 주장하지 않으며, 별도 실계정 실행·전송/응답/화면 관측과 결합한다. 기존 정책의 두 번째 권한 판단기나 scheduler를 만들지 않는다.

## 완료 판정과 검사

| 단계 | 필요한 관측 |
| --- | --- |
| AI 제안 | 완료된 공개 ambient 발언의 `work_propose`·proposalResults와 task.proposedBy/원래 sourceMessageIds 일치. owner가 직접 만든 일감을 AI 제안으로 세지 않음. |
| 픽업·보고 | 같은 task의 work attempt·고정 inputDigest·provider turn과 실제 work_report·산출물/보고 digest 일치. 원래 완료 보고·재작업 이력 보존. |
| 독립 검토 | current reportDigest와 일치하는 다른 참여자의 수락. done·blocker0·서버가 관측한 수용 기준을 대조. 리뷰 대기나 모델의 수동/실행 성공 주장만으로 완료하지 않음. |
| Wiki 게시 | current report의 `report:<id>`와 연결된 reported 버전/알림 각각1개·scope/원문 source digest 일치. 보고가 읽은 입력 Wiki와 보고로 새로 생성된 Wiki를 혼동하지 않음. |
| 다음 대화 | 수락 뒤 **업무/리뷰가 아닌 ambient say**의 입력 body/page/version/digest/scope/sourceRefs와 공개 말풍선 인용 일치. 리뷰에 Wiki가 포함된 사실만으로 후속 대화를 완료 표시하지 않음. |
| 한계·보존 | 중복·늦은 결과·자기 검토·다른 보고/버전·미실행을 성공으로 세지 않음. 실제 계정·금액·독립 사실 검증은 snapshot만으로 판정하지 않음. |

기준 흐름 검사: 기존 작업큐/업무 crash·Wiki/게시 crash·R8 전체 순환·유한 실검증 guard/server를 계정 없는 fixture로 실행해51개 PASS, FAIL0·SKIP0을 확인했다. 새 대조 도구·manager/executor 순환과 검토 예시의 실제 validator 통과/잘못된 필드 거절을 추가한다. 최종 검사 결과는 아래 표에 기록한다. 1번 주제 결론의 실계정 성공을 이 업무 순환의 성공으로 대신하지 않는다.

## 승인된 실계정 수락 범위

사용자 입력은 시작 주제1회이며 이후 owner의 일감 생성·픽업·보고·리뷰·Wiki 복사 중계는0으로 검사한다. 가상 모임의 ‘결정·이견·미확인’ 점검표라는 짧은 분석 업무1개로 제한한다. 보고가 갖춰야 할3문구의 `text_includes`만 사용하고 실제 실행/외부 사실 검증은 요청하지 않는다.

- 기존 CoralBricks·River의 DeepSeek를 각각 High로 설정한 검증 참여자를 사용한다. 기존 연결/토커·웹 GPT의 대화/문맥·모델·기억은 바꾸지 않는다. 새 참여자의 권한은 방 안 analysis 범위에 명시 배정하고 종료 후 비활성으로 남겨 원래 기록을 보존한다.
- 제안/검토 담당에는 기존 manager 역할, 수행 담당에는 기존 executor 역할을 배정한다. manager는 claim/report 권한이 없고 executor는 propose/review 권한이 없다. AI가 원래 공개 발언을 근거로 task를 제안하고, worker만 픽업하도록 기존 allowedParticipantIds/requiredRole을 사용한다. 리뷰는 다른 참여자가 현재 보고를 읽고 결정한다. 별도 계정 강제 정책을 새로 구현하는 것이 아니다.
- 정상 경로 예상4요청: AI 제안1→작업 보고1→다른 AI 검토1→후속 대화 인용1. 그중 보고 직후 Wiki가 reported로 게시되고, 현재 보고의 독립 수락 뒤 후속 ambient 인용을 대조한다. 반려는 원래 보고를 보존하고 기존 재작업 경로로 처리한다. 실검증 최대8 API요청·30분, 첫 provider 오류/미확정에는 반복 전송 없이 중지한다. Codex·dot/Muse·외부 출처 조회0.
- 준비 시점 운영은 방off·Chrome잠금·진행/미확정0·업무0이다. API 정책은 일일8회/200,000 보고 token, 당일5회/199,694token 사용으로306token만 남아 있었다. 별도 사용자 승인에 따라 검증 중에만 한도를13회/400,000token으로 변경했다. 종료 후 기존8회/200,000token 정책을 복구했고 원래 사용 기록과 새3회 모두 남겼다. 모델 비용은 발생할 수 있으며 금액을 추정하지 않는다.
- 실제 적용/호출 전 DB/설정·역할/참여/원문 digest를 private하게 보존한다. 기존8페이지/60,000자 Wiki·180,000자 문맥·전송/미확정/승인 한도를 확대하지 않는다. 오래된 GPT/OAuth/웹 문맥을 강제로 초기화하거나 공유하지 않는다.

이 범위의 승인으로 수행한 결과는 아래와 같다. 첫 오류에서 방을 끄고 원래 응답을 보존했다. 추가 호출·새 업무 생성·재시도는 실행하지 않았으며, PC/390px의 큐·원래 산출물·차단 상태·보고 Wiki를 읽기 전용으로 대조했다.

## 실측 결과 — 2026-11-05 KST

22:29:19 시작 주제1회→22:33:12 오류 중지→22:35:55 원래 한도/역할·참여 복구, 이후 정상 user service의 health를 확인했다. 소유자의 일감 생성·픽업·보고·리뷰·Wiki 복사 중계는0회다. 연결된 실제 CoralBricks High가 제안/검토, River High가 수행했으며 output limit4,096을 유지했다. Node24.18.0/npm11.16.0에서 같은 운영 DB와 기존 JSON/API 경계를 사용했다.

| 관측 | 결과·증거 |
| --- | --- |
| 서버 적용·원본 보존 | PASS — `76540a2` 빌드·시작/health, 적용 전후 state digest 불변. `.env`·기존 참여자/연결·토의/답변·역할·Wiki 버전·원래 API ledger digest를 종료 후 대조 |
| AI 제안 | PASS — 실제 공개 발언의 `work_propose` 1건→task1개, sourceMessageIds/제안자/허용 worker·analysis scope 일치 |
| 자동 픽업·보고 | PASS — executor attempt1개→원문 산출물1개·report digest/receipt, 세 `text_includes`가 observed_pass. 문자열 포함 관측이며 내용의 실제 효과 검증은 아님 |
| 보고 Wiki | PASS — 보고에 연결된 reported 버전1개·방 알림1개. 리뷰 완료 전 게시라는 기존 계약 유지 |
| 독립 검토 | **FAIL** — 다른 참여자의 실제 응답은 수신됐으나 `work_review` payload에 허용하지 않는 `blockers:[]`가 포함돼 `invalid_work_fields`. turn은 completed, proposal은 not_run, review attempt는 failed, task는 blocked, 수락 리뷰0. 응답 부재/미확정과 혼동하지 않음 |
| 수락 뒤 다음 대화 인용 | **NOT_RUN** — 검토 실패 시 중지. 이미 Wiki가 보이거나 리뷰 입력에 Wiki가 들어간 사실을 후속 ambient 성공으로 세지 않음 |
| 사용량·호출 경계 | PASS — 실제3요청, input108,203/output6,790, 보고 합계114,993 token·unknown0. Codex/dot/Muse/웹 GPT 호출0, 자동 재전송0. 최대8회/30분 범위 내 중지 |
| 정책·서비스 복구 | PASS — 방off·Chrome잠금·새 참여/역할 비활성·원래 참여/역할·API8회/200,000token·정상 user service/health 복구. 당일 누적8회/314,687token을 보존해 API는 원래 일일 한도에 따라 대기 |
| 실제 HTTPS UI | PASS(부분 결과 표시) — 1440/390px의 보고 원문·검토 차단·reported Wiki 버전, 가로 넘침0·JS오류0·쓰기0·추가 모델 호출0·state digest 불변. 독립 검토 완료/후속 인용의 화면 증거는 아님 |

`scripts/work-wiki-evidence.mjs`로 실제 종료 snapshot을 대조하면 `status:incomplete`, 제안/원문 보고/Wiki/알림 true, taskDone/acceptedIndependentReview/subsequentAmbientCitation false다. 성공을 과장하지 않는 판정까지 실제 기록으로 확인했다. private 증거는 소유자 state 디렉터리의 `work-wiki-cycle-20261105/`에만 두고 공개 저장소에 원문·계정·접속 키를 넣지 않는다.

| private 증거 파일 | SHA-256 |
| --- | --- |
| `restored-snapshot.json` | `4961a2d71b74d339f628050937244cdf852009f97adeefb5898af0a592cc9673` |
| `stored-evidence-audit.json` | `00f3223aa15e9999ae69a0fb10701c53aad6e0579c7561157f88acd01f76a95c` |
| `restore-result.json` | `8288a7f9ed242eaa4ee4d7a244c3e3dc991d04a2ac26dae60b02853359cb6ba9` |
| `ui-verified.json` | `137b6a8afcc29b0ca28c712a3a0f5c4366ab3d013641a33c3bc3241c374edb41` |

### 발견한 오류와 최소 수정

`src/workspace/work-queue.ts::WorkQueue.prepareTurn`은 purpose가 review여도 JSON 예시에 work_report의 summary/blockers를 넣고 다음 문장에서 필드를 바꾸라고 지시했다. 실제 모델은 reportDigest/decision/reason을 추가하면서 blockers를 남겼고 `reviewState`의 기존 허용 필드 검사에 거절됐다. 새 예시는 purpose별 payload를 직접 구성해 JSON으로 직렬화한다. review에는 현재 reportDigest·decision·reason만, work에는 summary/blockers를 넣는다. 수락 결정은 예시의 accept에 강제되지 않고 기존 accept/rework/blocked 선택과 서버 수용 기준 검사를 그대로 따른다.

이 수정은 승인된 범위 안의 지시/validator 불일치 해결이다. provider complete·공개 API·DB/schema·권한/예산·수락 기준 변경0이다. 잘못된 필드를 조용히 무시하거나 과거 응답을 고쳐 수락하지 않는다. 이미 고정된 prompt/input/report/receipt와 실패 task도 그대로 남긴다. 새 예시를 그대로 반환하는 fixture를 실제 report/review validator로 통과시키고, 실제 오류처럼 blockers를 추가하면 계속 거절·원본 보존되는지 검사한다. 이 회귀 통과를 수정본의 실계정 검증 성공으로 바꾸지 않는다.

### 기록 대조 명령

소유자만 읽을 수 있는 명시적 JSON snapshot과 task ID를 전달한다. 명령은 서버·DB·모델을 시작하거나 연결하지 않는다.

```sh
node scripts/work-wiki-evidence.mjs /absolute/private/snapshot.json TASK_ID
```

출력은 식별자/본문 없는 checks/counts/reasonCodes이며 `records_consistent`/`incomplete`/`invalid`의 종료 코드는0/1/2다. 실계정 여부는 항상 `UNVERIFIED_BY_AUDIT`이고 현재 계정 권한이나 실행 허가를 판정하지 않는다. 일반 파일·UTF-8 JSON·32MiB 이내만 읽고 상대 경로/최종 파일의 심볼릭 링크·과대/잘못된 입력은 거절한다.

독립 검토에서 발견한 대조 도구의 허위 성공 가능성4개도 보완했다. analysis의 실제 문자열 포함/수동/실행 결과와 evidenceRefs를 다시 계산하고, 원래 report/review payload의 허용 필드·원문 sourceMessages snapshot 필수·제안→업무의 순서/basisSequence를 확인한다. 보고 본문은 그대로인데 observed_pass만 꾸미거나, 실제 서버가 거절하는 blockers를 검토에 넣거나, 원문 snapshot/선행 순서를 없앤 기록은 성공으로 세지 않는다. 재검토에서 해당4건의 남은 차단 사항0을 확인했고, 실제 종료 기록의 incomplete 판정도 바뀌지 않았다.

### 최종 개발 검사

| 검사 | 결과 |
| --- | --- |
| `npm run check` | **649 PASS**, FAIL0·SKIP0. strict 타입·빌드와 계정 없는 검사. 새 기록 대조57개와 예시 통과/오류 응답 보존/manager-executor 순환3개 포함 |
| `WJ_TEST_CHROMIUM_EXECUTABLE=/path/to/chrome node --test tests/browser/work-queue.test.mjs tests/browser/resident-wiki.test.mjs tests/browser/resident-e2e.test.mjs` | **11 PASS**, FAIL0·SKIP0. 실제 Chromium의1440/1024/768/390px·두 탭/SSE·queue/Wiki/CAS·권한/출력 회귀. 모델 응답은 fixture이고 Chrome MCP 전용 검사/실계정 수락을 뜻하지 않음 |
| 문서 링크·수락 계약 보존 | 문서3개·로컬 링크/앵커72개, 오류0. 기존50 gate/수락 manifest 두 개/과거 상태 원문 불변 |

수정본은 PR 검토·사용자 병합 뒤 적용한다. 이번 중지된 요청을 자동 재시도하거나 실패 응답의 필드를 제거해 재적용하지 않는다. 새 실계정 검증은 대상·요청 수/시간·잔여 API 정책을 정한 별도 실행 범위로 허용받는다.

## 후속 영향·복귀

R1 Store/이관·R2 단일 전송·R3/R4 UI/연결·R5 역할/슬롯·R6 쓰기 차단/승인·R7 CAS/출처/인용 계약과 R8 기존50 gate는 유지한다. 공개 제품 API·모델·schema 변경0이며 별도 페이즈를 만들지 않는다. 계정 단위 리뷰 강제나 리뷰 후 첫 게시 같은 계약 변경이 필요하면 별도의 영향·변경량을 먼저 보고하고 승인받는다.

실행 종료 시 새 예약을 막고 진행/미확정·원래 receipt를 대조한 뒤 방off·원래 역할/참여·API정책을 복구한다. 검증 주제·task/attempt/report/review·Wiki와 출처·command·예산 사용 이력은 남긴다. 문서/증거 도구만 되돌릴 때 기존 데이터나 서비스를 바꾸지 않는다. 새 보고를 재생하거나 DB를 초기화해 실패를 숨기지 않는다. 전체 R8·실제 Codex·장기 운영 수락은 별도다.
