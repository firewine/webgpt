# DeepSeek 토커별 출력 한도 — 구현·검증 기록

2026-10-31 (KST). 사용자가 **“출력 한도 설정 추가 승인”**으로 [영향 검토서](../reviews/deepseek-output-limit-impact-20261031.md)의 범위를 허용했다. [개발 페이즈 SSOT](../development-plan.md)를 먼저 갱신했다. 코드 기준은 PR #29의 `f195c2759a8e51090923a9ce6b1e4f940bf9b40d`이며 이번 변경은 그 위에 추가했다. 실제 실패의 종료 원인 확정·운영 배포·서비스 재시작·유료 재호출은 이번 승인에 포함되지 않는다.

## 동작·데이터·기존 계약

DeepSeek 공식/CoralBricks/River 토커에 출력 한도 **512~32,768 정수**를 지정한다. 부재·빈칸/`default`는 **4,096**을 유지한다. Max 사고 깊이를 선택하거나 실패했다고 자동 증액·사고 하향·다른 모델 재호출을 하지 않는다. GPT/Anthropic/browser에는 이 설정을 보내지 않는다.

| 파일·심볼 | 변경과 근거 | 유지한 계약 |
| --- | --- | --- |
| `src/workspace/model.ts::ModelChoice/Member/DiscussionTurn` | catalog 최대치 `outputTokenLimit`와 사용자 요청 `maxOutputTokens`를 구분하는 선택 필드 | 기존 state/SQL schema·이력·키·계정 분리 |
| `src/workspace/settings.ts::participantOutput/snapshotMember` | 범위/모델 한도를 한 곳에서 검사하고 전송 전 유효 기본값을 snapshot | 별도 설정 저장소·ORM·새 실행 인터페이스 없음 |
| `src/workspace/runtime.ts::Workspace.participant` | 같은 provider 설정 부재는 기존 override 유지, 명시 default는 제거. 진행/미확정 발언 중 한도 변경 거절 | owner/Origin·Store transaction/event·기존 참여자/연결 수명 |
| `src/workspace/engine.ts::DiscussionEngine.control/turn` | 현재 토의는 paused/blocked·미확정 없음에서만 수정. 출력만 바꾸면 사고 설정 유지, 새 turn에 실제 요청 한도 기록 | 기존 단일 dispatch·예산·prepared 기록·미확정 대조·Providers complete 계약 |
| `src/workspace/resident-runner.ts::ResidentRunner.evaluate`, `src/workspace/work-queue.ts::WorkQueue.prepareTurn` | 기존 `ResidentTurn.participant: Member`에 유효 한도 snapshot | 중복 필드/테이블 추가 없음. WorkAttempt 입력·digest·claim/리뷰·scope 불변 |
| `src/connections/providers.ts::Providers.models/complete` | 인증된 모델 row의 양의 정수 `max_output_tokens`만 보존하고 전송 직전 재검증, DeepSeek `max_tokens`에 지정 값 사용 | endpoint/키/계정·사고 payload·completion/hook·SSE 실패 진단·보고 usage 불변 |
| `src/web/control.html`, `src/web/control.ts::updateEffort/renderDiscussion`, `src/web/room-view.ts::RoomView.renderMembers` | 등록/사후 수정·현재 토의 별도 버튼, 숫자 검증·최대치/미확인 안내·토커/요청 값 표시 | 기존 API/SSE·흑백 GUI·기록/비교/복구·승인·큐/Wiki 화면 |

설정 검증과 snapshot을 작은 순수 함수로 공유한다. 세 실행 경로는 기존 Store/dispatch와 Providers를 composition해 사용하며 새 scheduler/Adapter 계층을 만들지 않는다. 출력 값은 모델 입력이나 권한으로 평가하지 않는다. R1 선택 필드→R2 snapshot/전송→R3 설정 화면의 보완이며 R4 인증, R5/6 실행 권한, R7 Wiki/CAS와 후속 Git Writer·병렬 실행·자동 병합 범위는 바꾸지 않는다. 이번 설정 추가의 실제 변경량은 기준 대비 **17파일·220줄 추가/22줄 삭제**로 승인된 파일 범위 안이다. 기존 개인 작업35개 파일의 hash와 원래50 gate의 id/requirement/status가 그대로임을 확인했다.

모델 한도 근거는 [DeepSeek Models API](https://api-docs.deepseek.com/api/list-models/)의 `max_output_tokens`다. [CoralBricks 문서](https://www.coralbricks.ai/docs)의 실제 capability 조회 원칙을 유지한다. 해당 필드가 없거나 잘못된 자료형이면 **최대 출력 미확인**으로 남기며 context 길이·공개 모델 목록에서 추정하지 않는다. catalog 최대치가 앱 상한보다 크더라도 앱 입력 상한32,768은 유지한다. catalog 최대치가 기본4,096보다 작으면 기본값을 조용히 낮추지 않고 사용자가 명시 설정하도록 거절한다.

## 검증 방법·결과

호스트 Ubuntu, Node **24.18.0**, npm **11.16.0**, 테스트 Chrome **156.0.8078.4**, Chrome DevTools MCP **1.12.0**. 임시 state/profile·모의 provider를 사용했다. 브라우저 검사에 운영 Chrome profile이나 실제 계정을 사용하지 않았다.

| 판정 | 방법·실행 증거 | 수락 범위 |
| --- | --- | --- |
| PASS | `npm run check` — strict TypeScript/빌드·Node **326**, FAIL/SKIP0 | 기존 인증/복구·단일 dispatch·큐/Wiki·Codex 회귀 포함 |
| PASS | `tests/deepseek-output.test.mjs` **7** | 세 제공처 기본4096/512/8192/16384/32768 exact payload·Max 유지·default 복귀, catalog 재검증·미확인, 범위/미지원 provider 전송0·Origin 차단 |
| PASS | 위 Node 검사 내 topic/resident/work fixture | 진행/미확정 수정 거절, 출력만 변경 시 사고 유지·잘못된 복합 수정 전체 rollback, 과거 turn/WorkAttempt 입력/digest 보존·다음 turn만 새 값 |
| PASS | 신규 `tests/browser/provider-settings.test.mjs` 출력 UI 검사 **1** | min/max·범위 밖 저장0·숫자 payload·토커/토의 분리·기본 복귀·방 표시·390px 넘침/JS 오류0 |
| PASS | 위 Chrome/MCP의 `npm run test:browser` — 전체 **52**, FAIL/SKIP0 | 기존 GPT/Anthropic·방/주제/큐/Wiki·Chrome MCP 실제 fixture 왕복 회귀 포함 |
| NOT_RUN | 실제 제공처 장문 응답·유료 재검증·운영 배포 | 설정 추가가 과거 실패를 해결한다는 실측 없음 |

```bash
npm run check
WJ_TEST_CHROMIUM_EXECUTABLE=/home/firewine/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp \
npm run test:browser
```

Playwright 기본 예상 revision이 설치되지 않아 첫 실행은 브라우저 기동 전에 중단됐다. 이미 설치된 위 Chrome을 명시해 실행했다. 신규 UI 검사 중 room 모드에서 숨겨진 history 버튼을 누르던 경로는 discussion 화면 전환 후 검사하도록 수정했다. 제품의 기존 화면 동작을 바꾸거나 검사를 생략하지 않았다.

## 이관·복귀·실환경 제한

선택 필드만 추가하므로 SQL 이관·DB 재초기화는 없다. 기존 Member의 필드 부재는 새 turn 준비 때4096으로 확정하고 과거 turn에 요청값을 역추정해 채우지 않는다. 작업 claim 시점의 입력/digest도 소급 변경하지 않는다. 미래 prepared turn부터 실제 요청 값을 기록한다.

복귀 전 방 off/토의 pause로 새 예약을 막고 진행·미확정 응답과 원래 receipt를 대조한다. 지원 빌드에서 활성 토커/현재 토의의 override를 직접 기본값으로 돌리고 미확정 실행이 없는지 확인한 뒤 구버전 호환성을 판단한다. 구버전이 명시 설정을 지킨다고 가정해 즉시 실행하지 않는다. 과거 turn/업무 입력·원문·실패·DB를 삭제하지 않는다. 실제 서비스 rollback은 NOT_RUN이다.

[이전 실계정 기록](./phase8-real-api-20261031.md)의 토의는 원래 **6요청·blocked**를 유지한다. 이전 실패의 정확한 finish reason/usage는 UNVERIFIED이고, 출력값·사고를 바꿔 실패 요청을 자동 재전송하지 않았다. R8-D 전체 수락과 50개 gate 판정도 이 fixture 결과로 승격하지 않는다.
