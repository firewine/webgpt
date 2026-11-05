# 주제 결론 → Wiki 자동 기록·다음 입력 인용 — 2026-11-05

상태: 구현·자동 검사 PASS / 실계정·운영 적용 NOT_RUN. 기준 main은 PR #51 병합 `e717340375165e8dbef65181159341fc9bded18e`다. 사용자는 [추천1 영향안](../reviews/next-development-recommendation-20261105.md#3-우선순위1의-최소-변경안--승인)을 “1번 개발 승인”으로 승인했다. 현재 수락의 SSOT는 [개발 계획서](../development-plan.md)이며 기존8페이즈·50 gate·별도 실계정/서버 적용 승인은 유지한다.

## 구현과 계약

- `engine.ts::DiscussionEngine.create`와 명시 `revise`가 새 방 연결 토의의 optional `wikiPublication`에 revision·room epoch·참여/문맥 scope digest를 고정한다. 과거 metadata 없는 토의와 방에 연결되지 않은 독립 토의를 자동 이관하지 않는다. 새 SQL 테이블·물리 이관은 없다.
- `topic-wiki.ts::publishTopicWiki`는 기존 `ResidentRunner.projectFocus`의 공개 투영/종료 transaction에서 실행한다. completed/partial의 공개 결과만 기존 `Wiki.editState`와 `sourceRefs.kind=message`로 게시하고, page/version/digest·입력 digest·게시/보류/제외 사유를 같은 state/event transaction에 기록한다.
- 종합/종합 검토가 있으면 그 원문을 결과로 사용하고, 없는 partial은 마지막으로 완전히 공개된 라운드의 부분 관측으로 표시한다. 선택한 공개 결과의 claims/reviews/verifications/uncertainty를 유지하고 이전 공개 라운드는 ID·원문/응답 digest 목록으로 연결한다. 원래 토의 전체 원문은 그대로 남기며 미공개/구세대 응답·private 자료/원문은 복사하지 않는다. 본문의 reported와 관측/미실행을 자동 verified로 승격하지 않는다.
- `topic:<discussionId>:<revision>`의 고정 편집 식별과 기존 Wiki CAS·입력 digest로 중복을 방지한다. 원래 자동 기록 뒤 사용자/AI가 수정한 최신 버전은 재생으로 덮어쓰지 않는다. 모델·provider·MCP 권한이나 새 scheduler는 추가하지 않는다.
- 본문20,000자·출처20개·자동 입력8페이지/60,000자 한도를 유지한다. 기존 Wiki 검증을 분리 후보 state에서 먼저 적용해 한도 실패가 실제 page/notice 일부만 남기지 않게 한다. 초과는 원문을 유지한 blocked 상태이며 모델 재요청/조용한 잘림/한도 확대가 없다. 명시 pin 선택은 보존한다.
- off/권한·참여/문맥 범위 변경·옛 revision/generation·cancelled·진행/미확정 turn/job은 무단 게시하지 않는다. 종료 경계의 보류/제외는 반복 tick에서 새 알림/시도를 생성하지 않는다. 기존 업무 보고 자동 게시·수동/AI Wiki 편집·Provider.complete·Store·전송/승인/예산과 R6 쓰기 차단은 유지한다.

## 화면과 다음 대화

기존 주제/작업실 패널에서 기록 대기·게시·보류/제외를 확인하고, 게시 링크는 고정 page/version의 원래 기록을 연다. 다음 발화는 기존 `contextWiki`의 최신/명시 pin 정책으로 같은 version/digest/sourceRefs를 받는다. 이 작업은 문서 누적의 자동 관련도 순위/압축을 추가하지 않는다. 실제 모델에 메시지를 보내거나 기존 운영 토의를 재개하는 것은 별도 승인 범위다.

## 검사 기록

| 검증 방법 | 결과·실행 증거 |
| --- | --- |
| `npm run check` — strict TypeScript·실제 빌드·전체 Node 검사 | PASS 589/589, FAIL0·SKIP0. 원래 dot 수락 검사는 새 Wiki 알림1개를 구분하되 topic 발언 수·업무 보고2건의 원래 조건을 유지했다. |
| 기존 Chromium/MCP 실행 파일을 `WJ_TEST_CHROMIUM_EXECUTABLE`·`WJ_TEST_CHROME_MCP`로 지정하고 `node --test tests/browser/*.test.mjs` | PASS 75/75, FAIL0·SKIP0. 실제 Chromium 156.0.8078.4·Chrome DevTools MCP 1.12.0과 로컬 합성 페이지 사용. 실제 계정/추론 검사는 아니다. |
| `tests/resident-topic-wiki.test.mjs`의 실제 Engine/Runner fixture | 새 completed/partial 기록·다음2발화의 고정 version/digest/source 인용·20회 재생 중복0·소유자 수정 보존·5인 최종 결과의 출처5건 PASS. 공개된 마지막 검증 발언만 선택하고 미공개/구 revision 근거는 제외한다. |
| `tests/resident-topic-wiki-crash.test.mjs` + `tests/fixtures/topic-wiki-crash.mjs` | transaction 직전/직후·알림 commit 뒤의 실제 SIGKILL 3경계에서 재기동. Wiki version1개·알림1개·추가 completion0·원문/인용 보존 PASS. |
| 거부 경계와 기존 문맥 선택 검사 | off·참여/문맥 변경·dot 원래 grant 회수/대체·취소·live turn/job·private/출처 불일치·과대 본문/출처·8페이지/60,000자 초과의 무단 게시0. 새 한도 확대·무한 재시도·원문 잘림0. |
| `tests/browser/topic-wiki.test.mjs` 4건 | pin/결과/주제정보의 원래 version 링크, 대기/보류/제외 문구, 20회 새로고침·390px·기존 SSE 갱신·다른 방 노출0 PASS. |

기능 구현 외의 후속 확장은 없다. 당초12~16파일 예상보다 문서 동기화2개를 더 포함한18파일이며, 대부분 추가량은 경계·강제 종료·브라우저 검사다. 일반 Wiki/토의/회사형 계획의 현재 상태를 맞췄고 기존 수락 manifest·50 gate·서비스 설정은 변경하지 않았다. 모델/API·dot/Muse/Codex 실제 요청·운영 적용은 이 개발 범위에서 NOT_RUN이다.

## 복귀와 한계

G0에서 새 예약/미확정/진행 job을 대조한 뒤 이 게시 연결을 이전 코드로 되돌린다. 이미 기록한 Wiki/version·sourceRefs·알림·command/receipt와 원래 주제는 삭제/DB 복원하지 않는다. optional metadata를 모르는 reader와 기존 Wiki/업무 보고 기능은 데이터를 보존한다. 독립/과거 토의 일괄 기록·원래 실패 토의의 작성자 교체·추가 실계정 호출·R6 쓰기·R8 전체 수락은 이 구현으로 완료 처리하지 않는다.
