# DeepSeek 사고 깊이·Anthropic API — 2026-10-31

사용자가 [영향·후속 페이즈 검토](../reviews/deepseek-anthropic-impact-20261031.md) 후 **“DeepSeek 설정·Anthropic API부터 구현 승인”**으로 범위를 확정했다. 작업 시작 main은 `2ff6545b0eda83370bc009db556d5297c6bb7522`이며, 제출 기준은 PR #26 병합 main `73c55cda2d39b25673734ea00b6c36e10909294e`다. PR #26 head와 병합 tree가 같아 재작성 없이 작업 브랜치를 fast-forward했다. 실계정 유료 호출·로그인·서비스 재시작·배포는 수행하지 않았다.

## 변경과 유지 계약

| 코드·심볼 | 변경 | 유지한 계약 |
| --- | --- | --- |
| `deepseek-services.ts::deepSeekReasoning/deepSeekThinking` | 실제 catalog capability 또는 정확한 River ID의 공식 문서에서 지원 값을 얻고 제공처별 원래 요청 필드로 변환 | 고정 endpoint·모델 목록·기존 기본 요청·계정/모델 fallback 금지 |
| `settings.ts::participantReasoning`, `Workspace.participant`, `DiscussionEngine.control` | DeepSeek 기본/none/low/high/max 검증, 새 토의/이후 발언 설정과 기존 turn 분리 | GPT low/medium/high/xhigh·기본 xhigh, 미지원 전송 거절, 계정/세대/일시정지/미확정 경계 |
| `anthropic.ts::Anthropic` | 공식 모델 cursor 조회와 Messages SSE를 기존 Completion으로 변환하는 작은 adapter | `Providers.complete` 입력/출력·hooks 불변, receipt/최종 text/보고 usage만 반환, 자동 재시도0 |
| `Workspace.addAnthropic/replaceKey`, HTTP `/api/connections/anthropic` | 별도 kind·API key·선택 workspace, 기존 모델 확인/키 갱신/삭제 결합 | owner·Host/Origin·vault, Store transaction과 event, 선택 연결 격리 |
| `control.html/control.ts`, `RoomView.renderMembers` | 제공처별 사고 옵션·출처·기존 설정 표시, Anthropic 등록/키 비움/연결 관리 | 기존 API/SSE·검토/비교·승인·큐/Wiki UI, 390px 가로 넘침 없음 |

Adapter를 기존 Providers에 composition하고 fetch를 주입해 인증/저장/토론 엔진을 복제하지 않았다. 공통 설정 검증을 작은 함수로 공유하며 별도 DI container/ORM/서비스·새 scheduler를 도입하지 않았다. 방/주제 발언은 기존 dispatch·전송 전 기록·예산 예약·복구를 그대로 사용한다. R1~R8 후속 영향은 승인 검토서와 같고 기존 50개 gate 문구·판정은 변경하지 않는다.

## 제공처별 설정과 인증

- DeepSeek 공식: catalog의 `effort.supported_levels`, 공식 thinking on/off. 명시 사고 값은 `thinking:{type:enabled}`와 `reasoning_effort`, None은 disabled다.
- CoralBricks: `supports_reasoning`과 `reasoning.supported_efforts/mandatory/disable`을 확인한다. None/Low/High/Max를 `reasoning_effort`로 보낸다.
- River: 실제 catalog에 사고 metadata가 없어 공식 문서와 일치하는 두 모델 ID에만 none/low/high/max preset을 적용하고 `provider_docs`로 표시한다. 다른 모델의 능력을 추정하지 않는다.
- 설정 부재/`default`: override 필드를 보내지 않는다. 기존 DeepSeek 설정을 Max로 자동 올리지 않는다. 서로 다른 xhigh 별칭 매핑도 사용하지 않는다. 기존 연결은 **모델 확인**으로 capability를 갱신해야 한다.
- Anthropic: 고정 `https://api.anthropic.com/v1`, API key Bearer, `anthropic-version:2026-10-21`, 필요한 연결에만 `anthropic-workspace-id`. 모델 목록은 최대10page/1,000개·20초·페이지4MB로 제한하고 서버가 준 외부 next URL은 사용하지 않는다. retired 모델을 제외한다.
- Anthropic Messages는 system·사용자/assistant 이력·stream·출력 최대4,096토큰을 사용한다. 누적 usage를 합산하지 않으며 제공된 입력/cache 입력·최종 출력만 기록한다. 미제공은 null이다. 사고/서명 delta는 최종 발언/말풍선으로 내보내지 않는다. receipt 뒤 EOF/오류/잘못된 JSON은 미확정, `max_tokens` 등 정상 종료가 아닌 결과는 실패로 보존한다. 다른 모델/계정으로 재전송하지 않는다.
- Claude 구독 OAuth는 공식 외부 앱 지원/허가 확인까지 보류한다. Claude Code 인증 cache나 다른 앱의 client ID를 가져오지 않는다. Anthropic 사고 깊이 조절은 이번 요청의 DeepSeek 범위와 별개이며 미구현이다.

API 계약 근거: [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/), [models](https://api-docs.deepseek.com/api/list-models/), [CoralBricks](https://www.coralbricks.ai/docs), [River](https://docs.river.ai/guides/inference-controls/), [Anthropic 인증](https://platform.claude.com/docs/en/manage-claude/authentication), [API 버전](https://platform.claude.com/docs/en/api/migration-2026-10-21), [Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [구독 인증 경계](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use). 이는 2026-10-31 확인한 계약이며 개인 entitlement를 보장하지 않는다.

## 검증과 한계

환경: Ubuntu 호스트, Node **24.18.0**, npm **11.16.0**, 실제 Chrome **156.0.8078.47**, Chrome DevTools MCP **1.12.0**. 검사는 임시 state/profile·모의 provider 응답을 사용한다. 운영 `.env`·DB·접속 키·Chrome 대화/프로필을 변경하지 않는다.

| 판정 | 방법·증거 | 범위 |
| --- | --- | --- |
| PASS | `npm run check` — strict TypeScript/빌드·Node **306**, FAIL/SKIP0 | 기존 인증/복구/단일 dispatch/큐/Wiki/Codex 회귀 포함 |
| PASS | `tests/deepseek-reasoning.test.mjs` **5** | 제공처별 exact payload·기본/끄기/지원 값, 미지원 전송0, GPT Max 거절·xhigh 보존, 진행 turn/과거 설정 보존 |
| PASS | `tests/anthropic.test.mjs` **14** | 키/workspace 격리·모델 cursor·401/403/429/500/529·완료/중도 종료·보고 usage·키 갱신/삭제·owner/Origin, 기존 엔진의 Claude+DeepSeek Max 혼합 토론 후 상주 발언 |
| PASS | 아래 Chrome/MCP 명령 — 전체 **51**, FAIL/SKIP0 | 기존 화면 회귀와 신규 DeepSeek/Anthropic **2**개: 등록·옵션·사후/일시정지 변경·키 비움·갱신·삭제·390px |
| PASS | 전체 검사 후 안내문과 사고/서명 비노출 fixture를 보강하고 빌드·Anthropic14·신규 브라우저2 재검사 | 마지막 변경과 관련된 결과. 기존 GPT 기본 xhigh 회귀도 전체 검사에서 통과 |
| PASS (목록만) | 인증된 CoralBricks/River `GET /models` 읽기 관측 | 두 제공처 각 DeepSeek 모델2개. Coral 사고 metadata 확인, River metadata 없음. 사용자 billing 검증 성공 보고와 구분 |
| NOT_RUN | 실제 DeepSeek/CoralBricks/River 추론·사고 수준의 실제 응답·장문 완료, Anthropic 실제 키/권한·추론·usage | fixture 성공으로 대체하지 않음. 운영 배포/최종 R8-D도 미완료 |

```bash
WJ_TEST_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome \
WJ_TEST_CHROME_MCP=/home/firewine/.local/share/webjjoku/tools/node_modules/.bin/chrome-devtools-mcp \
node --test --test-reporter=spec tests/browser/*.test.mjs
```

소유자 이메일·키·원문 대화·업무 내용은 이 기록에 넣지 않는다. 토큰/비용 추정·금융 계산은 추가하지 않는다.

## 이관·복귀

기존 state JSON에 선택 capability/workspace 필드와 새 kind만 추가하며 SQL schema/기존 대화 이관은 없다. 새/과거 topic의 member와 turn snapshot은 원래 값을 유지한다. 다른 계정으로 기존 browser/resident 맥락을 옮기지 않는다.

복귀 전에 새 예약을 막고 방을 끄며 토의를 정지하고 진행/미확정 응답·외부 실행의 원래 receipt를 대조한다. **Anthropic kind를 지원하지 않는 과거 실행파일로 운영 DB를 바로 실행하면 안 된다.** 구버전이 새 kind를 안전 거절한다는 검증이 없으므로 지원 빌드에서 발화를 중단한 상태를 유지하고 호환성을 확인한 뒤 복귀한다. DeepSeek 명시 값도 구버전에서 지원된다고 가정하지 않는다. 원문·큐·Wiki·vault·DB를 지워 복귀하지 않으며, 실제 서비스/DB rollback은 NOT_RUN이다.
