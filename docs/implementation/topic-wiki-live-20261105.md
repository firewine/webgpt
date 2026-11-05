# 주제 결론 공유 Wiki 실환경 검증 — 2026-11-05

상태: 서버 적용 PASS / 웹 GPT·DeepSeek High 주제 완료→Wiki 자동 기록→다음 두 발화 인용 PASS. 사용자가 PR #52 병합 후 서버 적용과 ‘주제 결론→Wiki 자동 기록→다음 대화 인용’의 실계정 검증을 명시 승인했다. 구현 계약·자동 검사는 [구현 기록](./topic-wiki-20261105.md), 현재 상태는 [페이즈 SSOT](../development-plan.md)를 따른다.

## 적용과 보존

- PR #52 병합 commit `30ec743d7d412356d87f537b692e3e5fe6ad5b47`와 PR head의 CI 성공을 확인하고 운영 폴더를 fast-forward, `npm run build`, 기존 user service 재시작했다. 기존4090포트·HTTPS8443·`.env`·DB·Chrome profile·Muse/dot 연결은 보존했다.
- 적용 전에 private SQLite online backup·이전 dist·state/config digest를 보존했다. 적용 후 health200·인증 state200, 전체 state digest·기존 토의/연결/참여자/config digest 동일을 확인했다. 비밀정보·개인 원문은 공개 저장소에 넣지 않는다.
- 기존 혼합 토의는 GPT 오류의 blocked 상태여서 새 토의를 막고 있었다. 사용자의 별도 명시 승인에 따라 원문·완료15개·실패 기록을 보존한 채 취소했다. 기존 답변의 작성자를 바꾸지 않는다.

## 검증 범위와 관측

- 기존 실제 웹 GPT와 CoralBricks DeepSeek High를 사용한다. 기존 API 일일 최대8회/200,000 보고 token을 보존하고, 검증 자체는 첫 실패를 포함해 최대12요청·30분·API최대6요청이다. Codex 실행·외부 출처 조회·dot/Muse 전송0.
- 기존 방에서 해당2인만 임시 허용하고 원래 참여 설정을 보존한다. 주제는 짧은 가상 설계 문제이며 상호 검토1라운드·검증 과제0·실행0이다. 자동 Wiki 기록 자체는 추가 모델 요청0이다. 검증 후 방 off·Chrome 수동 잠금·참여 설정을 복구한다.
- 첫 웹 요청은 marker1개와 답변이 실제 화면에 도착했으나 긴 발언 안의 `data-markdown-copy=blank-lines` 장식이 userSelector에 중복 일치해, 다음 사용자 메시지로 취급되면서 답변 추출이 비었다. 300초에 unconfirmed로 중지하고 추가 요청0·정상 서비스·방 off·Chrome 잠금을 복구했다. 이를 Wiki 기능 성공으로 세지 않는다.
- 원래 동일 marker·답변 안정·ready/busy·JSON 계약을 읽기 전용으로 대조하고 기존 reconcile API로 첫 답변을 회수했다. 같은 request를 재전송하지 않았다. 기존 binding의 선택자 갱신 API로 장식만 제외하고 원래 계정/대화/profile/model과 Muse를 보존했다.
- 방 epoch/참여 조건을 임의로 되돌리지 않고 같은 검증 주제를 명시 revision2로 바꿔 범위를 다시 고정했다. revision1 답변·오류·receipt는 보존했다. revision2 완료·공개 Wiki·다음2인 인용은 아래 최종 실측으로 수락했다.

## 최종 결과

| 검증 방법 | 실측·판정 |
| --- | --- |
| 실제 `DiscussionEngine`·공개 주제/발언 조회 | revision2의8응답: 독립2→상호 검토2→수정2→종합1→동료 검토1. JSON 계약·완료·원문 보존 PASS. 검증 과제/도구 실행0. 첫 revision의 회수된1응답도 별도 보존. |
| 기존 `ResidentRunner.projectFocus`·`Wiki.editState`의 실제 DB/알림 | Wiki page1개·v1 1개·알림1개. 작성자system·room scope·`reported`·입력 digest와 publication digest 동일. 종합/동료 검토 원문2건을 출처로 연결하고 공개8발언의 참조/원문·응답 digest 목록 보존 PASS. 자동 게시 추가 모델 요청0. |
| 다음 실제 DeepSeek·웹 GPT의 입력/응답/공개 말풍선 대조 | 각1회 `say`, 총2발화 모두 pageId/version/digest/scopeRef/sourceRefs가 Wiki와 정확히 일치. 전체 Wiki 본문이 입력에 포함됐고 두 실제 답변이 page/version/digest/원문 메시지 출처를 직접 인용함을 확인. 말풍선의 고정 version 인용도 PASS. 모델이 verified라 했다는 식으로 수락하지 않는다. |
| 실제 HTTPS와 Playwright 읽기 전용 화면 | 1440×1000·390×844에서 게시 상태→Wiki v1 열기·두 답변의 Wiki 인용 링크·재접속 PASS. 조회4회, UI오류0·변경0·state hash 동일. 화면은 private evidence에만 보존. |
| 요청·사용량 기록 | 총11요청: 웹6회(API token usage 미제공/null)·CoralBricks DeepSeek High5회. API 보고 input190,743+output8,951=199,694 token, 미보고0. 기존 일일8요청/200,000token 정책 변경0·추가 API 호출0. 첫 요청부터 최종 수락까지1,127,394ms로 승인된30분 이내. 금액을 추정하지 않는다. |
| 종료/정상 서비스 복구·다시 조회 | 방off·Chrome잠금·원래 참여 설정·참여자·기존15완료답변·다른 과거 토의·API정책·`.env` 보존 PASS. 연결 변경은 위 장식 제외 설정과 원래 binding 이력만 해당. 정상 서비스 health200·인증 Wiki v1조회200·page/version/알림 각1개·요청11회 유지. 원래 실패 토의는 승인대로 취소이며 새 검증 주제는 completed다. |

private 증거에는 적용 전 backup/digest, 첫 실패·DOM 구조·원문 대조/reconcile/binding 갱신, 두 실행기의 transaction/요청 범위, publication 원문, 두 입력/답변·원문 인용 대조, UI 화면/조회·복구 audit를 보존했다. 이 문서에는 키·실계정 식별자·개인 대화 원문을 넣지 않는다. 전체 R8·장기 운영·실제 Codex·dot/Muse 혼합 최종 수락과 구분한다.

## 최소 회귀 보완과 복귀

새 browser binding에서도 같은 오인식이 생기지 않도록 `src/connections/browser-presets/chatgpt-v1.json`을 version4로 올리고 사용자 선택자의 `[data-markdown-copy]` 장식만 제외했다. 기존 legacy 선택자·adapter의 단일 전송·marker/receipt·profile/identity·미확정 대조 계약과 Muse preset을 유지한다. 기존 binding의 자동 수정/이관은 없으며 이 검증 연결만 앞서 설명한 기존 API로 대조/갱신했다. 새 endpoint·인증·모델·페이즈·예산 확장은 없다. 프리셋 소스 보완은 별도 PR의 사용자 병합 대상이며 위 운영 성공은 PR #52와 명시 binding 갱신의 결과다.

- `tests/browser/browser-discovery.test.mjs`의 실제 Chromium 회귀: 80개 긴 문단과79개 중첩 장식·다음 실제 사용자/답변을 함께 구성한다. 수정 전에는 답변 추출이 비었고, 수정 후 첫 원래 답변만 회수·다음 답변 혼입0·전송0·receipt1개·사용자 초안/DOM 변경0을 확인했다.
- `npm run check`: strict TypeScript·빌드·Node589/589 PASS, FAIL0·SKIP0.
- 설치된 Chromium156.0.8078.4·Chrome DevTools MCP1.12.0으로 `node --test tests/browser/*.test.mjs`:76/76 PASS, FAIL0·SKIP0. 별도 fixture이며 실제 계정 검사를 반복하지 않았다.

첫 CI에서는589개 중 기존 `tests/codex.test.mjs`의 첫 검사가 정리 중 `database is not open`으로 실패했다. Node의 after hook 등록 순서상 storage가 SQLite를 닫고 디렉터리 삭제를 기다리는 동안 아직 살아 있던 fixture 실행기의 watchdog이 읽기를 시도했다. 해당 fixture의 storage 정리 직전에 실행기를 닫도록 수정했으며 제품 Codex 실행/승인/시간 정책이나 검사 조건은 바꾸지 않았다. 수정 뒤 관련 Codex 검사와 전체 Node 검사를 다시 확인했다. 실제 Codex 호출을 추가한 것은 아니다.

실패 시 새 요청을 멈추고 미확정 원문/receipt와 기존 대조 경로를 사용한다. Wiki/완료 답변/실패 기록을 삭제하거나 DB 복원으로 숨기지 않는다. 정상 서비스 복구와 기존15답변/전체 연결/참여자/API정책 보존을 각각 확인한다.
