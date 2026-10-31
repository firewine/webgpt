# DeepSeek 출력 한도 설정 — 승인됨

2026-10-31 사용자가 **“출력 한도 설정 추가 승인”**으로 이 변경을 허용했다. 승인 범위는 아래 기본4,096 유지·512~32,768 직접 설정과 관련 계획/fixture/UI/PR이다. 운영 배포·실제 재호출은 별도이며 기존6요청/blocked 토의는 보존한다. 구현 전에 SSOT와 연결 계획을 함께 갱신한다.

2026-10-31 승인된 R8 실제 GPT2+CoralBricks 토의는 6요청에서 중단됐다. 세 독립 초안·GPT 두 계정의 첫 상호 검토는 완료됐고, DeepSeek Max의 첫 상호 검토는 `response_not_completed`, receipt 있음·최종 text0이다. **정확한 원격 finish_reason은 기존 코드가 버려 확인할 수 없다.** 토큰 한도 초과는 유력한 가설이며 이번 실제 요청의 확정 원인으로 쓰지 않는다.

실제 검증 당시 운영 `src/connections/providers.ts::Providers.complete`는 DeepSeek의 `max_tokens`를 4,096으로 고정했고 정상 stop 이외 이유와 뒤따르는 usage를 버렸다. 종료 이유와 보고 usage를 보존하는 보강은 PR #29에서 별도로 검사했다. 아래 **출력 한도 설정 추가**는 승인 후 그 보강 위에서 구현하며 운영 값·실패 요청은 바꾸지 않는다.

## 최소 변경안과 대안

추천: DeepSeek 토커의 출력 한도를 512~32,768토큰 범위에서 사용자가 명시 설정할 수 있게 한다. 이 숫자는 앱의 제한이며 모델의 실제 지원 최대치라고 주장하지 않는다. 모델 catalog에 별도 최대 출력이 있으면 추가 검증하고, 없으면 제공처가 요청을 거절할 수 있음을 표시한다. 과거 토커/설정 부재는 **4,096 유지**이며 Max 선택만으로 한도를 자동 올리지 않는다. 사고 깊이와 출력 한도는 별도다. GPT/Anthropic 출력 동작은 변경하지 않는다.

| 안 | 이득 | 한계/판정 |
| --- | --- | --- |
| 현재 한도 유지 | 설정/이관 없음 | 깊은 사고·긴 검토의 출력 부족을 사용자가 해결하기 어려움. 현재 실제 중단 원인은 미확정 |
| 사고 깊이 자동 낮춤 | 짧은 응답 유도 가능 | 사용자 요청값/기존 전송 계약을 바꾸므로 기각 |
| 기본 한도 일괄 인상·제한 제거 | UI 구현 적음 | 모든 기존 호출의 소비량/응답 길이를 조용히 변경하므로 기각 |
| 토커별 명시 출력 한도 | 원래 값/예산을 유지하며 필요한 토커만 조절 | 추천. 실제 유료 재검증·운영 적용은 별도 승인 |

API 근거는 [CoralBricks 출력 budget/완료](https://www.coralbricks.ai/docs), [DeepSeek 사고 모드](https://api-docs.deepseek.com/guides/thinking_mode/), [Chat Completion 종료 이유](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/retrieve)다. 출력 budget 확장이 이번 실패를 해결한다는 실측은 UNVERIFIED다. 실제 provider·account capability 없이 가격/미래 token 소비를 예측하지 않는다.

## 변경 파일·모델·후속 영향

설정 구현 예상 **12~17파일·350~600줄**(기존 model/settings/runtime/engine/providers·control/room-view·관련 fixture/UI·계획/운영 문서). 진단/실환경 기록과 합치면 공통 파일을 제외해 **18~24파일·650~1,000줄 추정**이다. scope 확대 시 다시 보고한다.

| 단계 | 기존 계약 유지 / 최소 변경 |
| --- | --- |
| R1 | `model.ts::Member/DiscussionTurn`의 선택 `maxOutputTokens`. ResidentTurn은 기존 `participant` Member snapshot 안에 같은 값을 보존해 중복 필드를 만들지 않는다. 기존 SQLite schema/이력은 그대로, 필드 부재는4096. 새 SQL/재초기화 없음 |
| R2 | `settings.ts`, `Workspace.participant`, `DiscussionEngine.control/turn`, `Providers.complete`에서 검증·실행 전 snapshot. DeepSeek `max_tokens`만 명시 값으로 전송. 기존 complete 인터페이스·단일 dispatch·전송 전 기록·미확정 대조 유지. 진행 turn에 소급 적용/자동 재시도 없음 |
| R3 | `control.html/control.ts`, `RoomView.renderMembers`에서 등록/사후 변경·현재 토의 일시정지 후 설정. 과거 turn의 실제 요청 값 표시. 기존 API/SSE·흑백 GUI·비교/복구 유지 |
| R4 | 키/계정·모델 목록·Chrome discovery·동일 대화 경계 유지. 가능한 catalog 출력 capability만 확인; 모델 최대치를 꾸며내지 않음 |
| R5 | claim/역할·업무 완료/독립 리뷰 변경 없음. work가 snapshot한 참여자 설정만 사용하고 과거 attempt는 유지 |
| R6 | Codex 설정/승인·쓰기 gate·job 변경 없음. provider 출력 한도가 도구 권한을 늘리지 않음 |
| R7 | Wiki/CAS·출처/인용 버전·공유 actor 변경 없음. 출력 길이를 이유로 원문/반론을 자르거나 지우지 않음 |
| R8 | 범위/기본/상한·부재 호환·이전 turn 보존·혼합 pipeline fixture, 390px UI, 계정별 요청·실패 관측 검사 추가. 기존50 gate 유지. 요청/시간·보고 token 예산은 기존과 같고 한 응답의 soft token overshoot 가능성을 숨기지 않음 |
| 후속 선택 기능 | Git Writer/병렬 실행/추가 OAuth·자동 병합 범위·순서 변경 없음 |

## 수락·복귀·승인 범위

수락: 기본4096·명시8192/16384/32768의 정확한 DeepSeek payload, 범위 밖/미지원 provider 전송0, 기존 GPT/Anthropic payload 불변. 수정 전후 Member/Turn/WorkAttempt snapshot 보존, 진행/미확정 중 변경 거절, 실패의 reason/실제 usage와 한도 기록. `npm run check`와 관련 Chrome fixture로 검증하며 실제 성공은 별도로 관측한다.

복귀: 방 off/주제 pause·원래 receipt 대조 뒤 새 필드를 지원하지 않는 빌드에서 명시 설정을 쓰지 않는 상태로 돌아간다. DB/원문·실패 결과를 지우지 않는다. 기존 Max를 High로 자동 낮추지 않는다.

**승인 범위는 위 설정 구현과 관련 계획 개정만**이다. 운영 배포·새 실제 호출은 포함하지 않는다. 이번 실제 검증 토의는 원래 ID·6요청·receipt를 보존한다. 재검증 시 같은 토의에서 남은 최대18요청 이내의 새 시간 창과 원하는 출력값을 별도로 허용받아 진행한다. 실제 실패를 이 설정으로 해결했다는 수락은 별도 실측 전 UNVERIFIED다.
