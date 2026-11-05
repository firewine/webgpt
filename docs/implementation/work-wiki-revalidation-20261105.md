# 추천2 재검증 — PR #54 병합본

**상태: 기존 문맥 인계·새 시작1회 후, 업무 제안→자동 수행/독립 검토→Wiki→후속 대화 인용 PASS. 원래 첫 입력부터 무개입 수락은 미완료.** 사용자가 “임시 60만 토큰으로 재검증 승인”을 추가 허용했다. 사용자의 “병합함. 재검증 실시”로 PR #54 병합 `f648ea54bd69eae7fe45b5aa995986b5c677047e`를 기존 운영 폴더에 fast-forward·빌드·재시작했다. 적용 전후 state digest 불변·health200을 확인했다. 사용자 untracked 파일·기존 blocked task/응답·Wiki·API ledger는 보존했다.

## 구체 실행안

새 분석 점검표1개를 기존 CoralBricks/River DeepSeek High의 검증 참여자2명으로 AI 제안→자동 수행/보고→다른 참여자의 독립 검토→reported Wiki→후속 ambient 인용까지 확인한다. 원래 실패 응답의 blockers를 제거하거나 해당 task를 완료로 바꾸지 않는다. 새 task/보고/Wiki의 연결을 원래 실패 기록과 구분한다. owner의 입력은 새 시작 주제1회이며 이후 일감 생성/픽업/보고/리뷰/Wiki 중계0을 검사한다.

이번 새 실행은 최대5요청·30분, 첫 외부 오류/미확정/업무 차단/비허용 제안에 중지한다. 실제 Codex·dot·Muse·웹 GPT·외부 출처·파일 수정은0이다. 기존30만ms turn timeout·4,096 output·단일 dispatch·원문/세대·승인 보호·공개 API/DB/model/schema 계약을 바꾸지 않는다.

## 승인된 임시 API 정책

2026-11-05 KST 사전 확인: 기본 일일8회/200,000 보고token, 이미8회/314,687token 사용. 이전 승인 임시13회/400,000token을 그대로 쓰면 새 여유는85,313token이다. 직전 실제3요청은114,993token을 사용했고 다음 ambient는 실행하지 못했다. 단순 재시작만으로 전체 순환의 예산이 확보됐다고 볼 수 없다.

추가 승인 범위는 **요청수13회는 유지, 이번 검증 중에만 token400,000→600,000**이다. 오늘 누적 기록을 그대로 두며 새 호출 최대5회/30분과 당일 잔여 중 작은 한도로 제한한다. 사용량은 provider 보고값을 사용하고 정산 뒤 한 요청의 초과 가능성을 기록한다. 금액을 추정하지 않는다. 종료 후 기본8회/200,000token·원래 참여/역할·방off·Chrome잠금·정상 서비스를 복구한다. 원래·추가 사용 ledger/실패·완료 기록은 삭제하지 않는다.

사용자의 재검증 지시와 별도 임시 token 정책 승인 뒤에 검증 전용 참여/역할과 임시 정책을 설정하고 방을 켰다. 새 원문 시작 입력은1회이며 중간 업무 중계는 하지 않는다. 사전 context handoff 크기 측정은 checkpoint76,611자+prompt51,389자로 비용 절감 근거가 없어 처음에는 적용하지 않았다. 첫 형식 오류 뒤 기존 인계 기능으로 검증 manager만 복구한 경위는 아래에 따로 기록한다. 원래 운영 참여자의 대화 맥락은 바꾸지 않았다.

## 검증·증거·복귀

- DB와 환경/원래 참여·역할·대화·Wiki의 digest, online SQLite backup을 소유자 state 디렉터리 `work-wiki-revalidation-20261105/`에 보존했다. 공개 저장소에는 원문·계정·credential을 넣지 않는다.
- 실제 제안/task1·work report·다른 participant 검토/done·report Wiki버전/알림 각1, 독립 수락 뒤 ambient의 page/version/digest/sourceRefs·원문 인용을 대조한다. report는 리뷰 전에도 reported 게시되는 원래 계약을 유지한다.
- `scripts/work-wiki-evidence.mjs`의 snapshot 판정과 실제 receipt/usage·HTTPS1440/390px 읽기 전용 화면을 함께 사용한다. 자동 fixture/저장 일관성만으로 실계정 성공을 표시하지 않는다.
- 종료 후 새 진행/미확정0과 원래 기록 보존을 확인하고 정책/참여/역할·서비스를 복구한다. 결과는 단계별 PASS/FAIL/NOT_RUN으로 기록하고 SSOT를 사실대로 보완한다. 전체 R8/Codex/장기 운영 수락을 대신하지 않는다.

## 재검증 중 복구 관측

첫 실제 응답은 JSON의 proposals 항목에 payload만 있고 kind가 없어 format_invalid로 보존됐다. 일감·Wiki를 만들거나 원문을 고쳐 적용하지 않았다. `resident-runner.ts::ResidentRunner.accept/evaluate`의 기존1회 형식 보완이 같은 장문 prompt/history를 다시 전달하려다가 기존180,000자 경계에서 context_limit_requires_handoff로 멈췄고 두 번째 요청은 아직 전송되지 않은 상태였다.

입력 한도나 parser를 바꾸지 않고 `resident-context.ts::prepareCheckpoint/rotateResidentContext`를 사용하는 검증 manager의 기존 `/handoff` API를 사용했다. 새로운 checkpoint78,056자+prompt51,266자(합계129,322자)로 기존80,000/180,000자 한도 안에서만 적용했다. 이전 invalid 응답·전송/usage·원본 공개 발언은 보존하고 generation1→2를 기록했다. 다른 운영 참여자·browser/dot/Muse 맥락은 변경하지 않았다.

그 뒤 올바른 `proposals:[{kind:"work_propose",payload:{...}}]` 형식을 명시한 새 시작 발언1회를 전달했다. **전체 검증 창의 owner 시작 발언은2회, 문맥 인계1회**다. 유효한 새 업무 흐름은 두 번째 시작 발언을 근거로 제안됐고, 이 제안 뒤 owner의 일감 생성·픽업·보고·리뷰·Wiki 복사 중계는0이다. 이 수동 복구를 숨겨 ‘원래 첫 입력부터 완전 무개입 PASS’로 표시하지 않는다. 실패한 첫 응답을 포함해 총5회/30분 경계는 유지했다.

새 시작 뒤 AI의 유효 제안1개→자동 report1개→다른 참여자의 accept review1개→task done→후속 ambient의 정확한 Wiki 인용까지4요청 연속으로 끝났다. 이 유효 업무 흐름 안에서는 추가 owner 중계가0이다. 첫 실패를 포함한 전체5요청과 수동 복구는 아래 최종 결과에 함께 센다.

## 최종 실측 — 2026-11-05 KST

23:15:59 첫 시작→23:16:46 형식 오류 수신→23:22:42 문맥 인계/새 시작 완료→23:23:38 유효 제안→23:24:45 보고/Wiki→23:25:56 독립 수락→23:27:09 후속 인용/검증 종료→23:28:53 원래 설정 복구→23:29:46 HTTPS 화면 대조 완료. 전체 창은 약11분10초이며 승인된30분 안에서 끝났다. Node24.18.0/npm11.16.0, 원래 운영 포트·Tailscale HTTPS·state/Chrome profile을 사용했다.

| 수락 항목 | 실제 관측·판정 |
| --- | --- |
| 병합본 적용 | PASS — `f648ea54bd69eae7fe45b5aa995986b5c677047e` 빌드·재시작/health200·적용 전후 state digest 동일. PR head `602fe95`와 source tree 동일, [병합 main CI](https://github.com/firewine/webgpt/actions/runs/42041703156) SUCCESS |
| AI 업무 제안 | PASS(복구 뒤 흐름) — 새 공개 발언을 참조하는 `work_propose`1개→새 task1개. 소유자 직접 일감 생성0, 과거 실패 task를 재수락하지 않음 |
| 자동 픽업·보고 | PASS — River High executor의 고정 attempt1개·report1개·receipt. 결정/이견/미확인3개의 문자열 포함 검사를 서버가 observed_pass로 관측. 실제 효과/외부 사실의 검증은 아님 |
| 독립 검토·완료 | PASS — CoralBricks High manager가 다른 참여자의 현재 reportDigest를 검토해 accept1개, task done·blocker0·수용 기준3개 관측. 이전 blockers 예시 오류는 재발0. 첫 실패 응답은 여전히 과거 task의 blocked 기록 |
| Wiki 게시 | PASS — 새 report에 대응하는 reported Wiki버전1개·방 알림1개, report 원문/체크/반론·출처 digest 일치. 원래 계약대로 review 전에 게시하며 accept 뒤에도 verified로 승격하지 않음 |
| 다음 대화 인용 | PASS — 검토 수락 뒤 work/review가 아닌 River의 ambient say1개. 입력 Wiki body/pageId/version/digest/scope/sourceRefs와 공개 말풍선 참조가 일치하고 실제 본문에 새 pageId·version·digest·report ID가 축약 없이 포함됨 |
| 원래 첫 입력부터 무개입 | **FAIL/잔여** — 처음 kind 누락과 장문 문맥 차단으로 기존 인계1회·새 시작1회가 필요했다. 전체 owner 시작 발언2회. 유효 제안이 나온 뒤에는 픽업/보고/리뷰/Wiki의 owner 중계0이며 이 부분과 첫 시작의 안정성을 구분 |
| 실제 사용량·한도 | PASS — 총5회, input268,001/output6,591=274,592 보고token·unknown0. 첫 형식 오류51,169+1,779token도 포함. 당일 누적13회/589,279token으로 승인된13회/600,000 이내. 금액 추정0 |
| 호출 범위 | PASS — 실제 DeepSeek High만5회. Codex/dot/Muse/웹 GPT/외부 출처0. 최대 실행 슬롯1·최대5회·30분/300초 turn 제한 유지. 원래 응답의 묵시적 재적용·미확정 반복 전송0 |
| 복구·보존 | PASS — 방off·Chrome잠금·검증 참여/역할 비활성, 원래8회/200,000token·참여/역할·정상 user service/health 복구. `.env`·원래 연결/참여자·토의/발언·Wiki·과거 blocked task·기존 ledger digest 동일. 새5회 사용/보고/검토/인용 기록도 보존 |
| HTTPS 화면 | PASS — 1440×1000/390×844에서 업무 완료·보고 원문·다른 참여자 검토·reported Wiki와 후속 발언의 정확한 버전 링크를 대조. 가로 넘침0·JS오류0·쓰기0·추가 모델 요청0·state digest 동일. 실제 별도 물리기기의 터치/IME를 검증한 것은 아님 |

기록 대조 도구의 결과는 `records_consistent`, 제안/고정 보고/다른 참여자 검토/Wiki/알림/후속 ambient 인용9개 checks가 모두 true다. 도구의 `realModelAcceptance:UNVERIFIED_BY_AUDIT`는 그대로이며, 실제 모델 사용은 별도의 dispatch/receipt/usage·감시 기록과 화면으로 확인했다. 첫 형식 오류와 운영자 문맥 복구를 이 도구의 일관성 결과만으로 성공으로 바꾸지 않는다.

기존 실패 task/응답을 수정하지 않고 새 유효 업무를 검증했다. 새 source 참조와 새 report/Wiki를 과거 기록과 대조했으며 원래 task의 invalid_work_fields/review0은 유지했다. 기본 일일 한도 복구 후 API는 당일 한도 소진으로 대기한다. 보고된 사용량을 없애거나 영구 한도를 올려 재개하지 않았다.

### 비공개 증거 위치·대조

소유자 state의 `work-wiki-revalidation-20261105/`에 backup·baseline·적용/승인·각 명령 intent/result·original response·handoff checkpoint·완료 snapshot·감시/usage·복구/화면 결과를 보존했다. 파일600/디렉터리700이며 공개 저장소에는 개인 원문·계정·키·터널 ID·실제 task ID를 넣지 않는다. 다음은 복사본 대조용 digest다.

| 비공개 파일 | SHA-256 |
| --- | --- |
| `completed-snapshot.json` | `fd7bf10e24544778907eb62543332d2ee116aa41fba8df3851ae2052415850f9` |
| `stored-evidence-audit.json` | `768b9f90a8dbba566dceb2300fd14dc8b93ecc55cfe3e31e41373999570b4ba5` |
| `restore-result.json` | `50100e98505fd789808606f7b510bf26483c734190b94b50bf71705e91230b7b` |
| `ui-verified.json` | `b8194220ffda2bbf52cd2b621db5d16a966d61ce6015472fd89c8e15caf1f790` |

제품 코드·API/DB/schema·provider/권한/예산 계약 변경은0이다. 병합본과 동일 소스의 기존649개/브라우저11개 검사 결과를 실계정 수락으로 대신하지 않았고, 이번 문서 전용 보완을 위해 같은 로컬 소스의 전체 검사를 불필요하게 다시 실행하지 않았다. 변경 문서4개·로컬 링크/앵커76개 오류0·기존50 gate/두 manifest/과거 상태 원문 불변을 확인했다.

### 남은 조건

- 원래 첫 입력부터 형식 오류/문맥 초과 없이 이어지는 무개입 수락은 미완료다. 이번 결과만으로 room 전체 장문 인계/문서 선택 정책을 완성했다고 표시하지 않는다. provider별 JSON 예시 보완이나 입력/인계 계약 변경이 필요하면 원래 계획 변경 절차를 따른다.
- 전체5인 혼합 최종 수락·실제 Codex/파일 작업 보호·실기기/재부팅/장기 운영은 별도다. 이번에 추가 실계정 요청을 예약하지 않았다.
