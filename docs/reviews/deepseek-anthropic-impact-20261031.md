# DeepSeek 사고 설정·Anthropic 연결 변경안 — 승인됨

2026-10-31 사용자 요청: DeepSeek 사고 깊이 지정, Anthropic API/OAuth 등록. 사용자가 아래 추천 범위를 승인했으며 이 문서는 계획 개정의 승인 근거다. 비교 기준 main `2ff6545b0eda83370bc009db556d5297c6bb7522`; 별도 연결 삭제·모델 오류 수정 `7884184` 위에 후속 작업을 진행할 수 있다.

## 제안과 근거

1. DeepSeek 공식·CoralBricks·River의 실제 모델 catalog/공식 capability로 허용된 사고 값만 선택한다. 제공처 기본(명시 값 없음)과 none/low/high/max를 구분한다. 기존 DeepSeek의 설정 부재·기본 요청을 보존하고 GPT low/medium/high/xhigh를 그대로 유지한다. 제공처의 xhigh 별칭 매핑은 서로 다르므로 자동 변환하지 않는다.
2. Anthropic API key를 별도 connection kind와 작은 Messages adapter로 추가한다. 연결별 vault·모델 목록·workspace header·stream/receipt/보고 usage를 기존 Providers.complete 결과로 변환한다. 실계정 키 등록·유료 추론은 별도다.
3. Claude 구독 OAuth를 웹쫀쿠에 직접 제공할 공식 공개 등록 경로는 확인되지 않았다. 공식 문서는 외부 앱의 Claude.ai 로그인을 허용하지 않으며 API 인증을 안내한다. OAuth 성공 버튼/다른 앱 client ID/CLI 토큰 반입을 만들지 않는다. 정식 지원 경로·앱 허가를 확보하면 추가 영향 검토한다. WIF의 OAuth token exchange는 기업 IdP를 통한 API 인증이며 구독 로그인과 구분한다.

근거: [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/), [models](https://api-docs.deepseek.com/api/list-models/), [CoralBricks reasoning](https://www.coralbricks.ai/docs), [River controls](https://docs.river.ai/guides/inference-controls/), [Anthropic API 인증](https://platform.claude.com/docs/en/manage-claude/authentication), [Claude Code 인증 경계](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use), [계정 도움말](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account). 개인 계정 entitlement는 UNVERIFIED다.

추가 정적/읽기 전용 실측: 인증된 CoralBricks `GET /v1/models`는 모델2개 모두 `supports_reasoning: true`, `reasoning.supported_efforts: [low, high, max]`, 기본 none·비활성 가능을 보고했다. River도 GET200·DeepSeek 모델2개를 반환했지만 사고 메타데이터는 없었다. River는 공식 문서와 정확히 일치하는 실제 catalog ID에만 문서 기반 preset을 적용하고 그 출처를 구분한다. 다른/알 수 없는 모델의 사고 수준을 추정하지 않는다. 공식 DeepSeek 키/추론은 실측하지 않았다. 이 조회에서 key/개인정보는 출력하지 않았으며 유료 추론0이다.

## 코드 변경과 예상량

| 대상 | 최소 변경 |
|---|---|
| `src/workspace/model.ts` / `settings.ts` | DeepSeek용 지원 사고 값·provider 기본 구분, GPT 검증과 분리. ModelChoice capability와 Member/Turn 원래 요청값 보존. Anthropic connection 종류/workspace 설정 추가 |
| `src/connections/providers.ts` | 모델 capability 수집, DeepSeek request에 선택한 effort/thinking만 전송. Anthropic adapter로 명시 dispatch. complete 인터페이스와 기존 stream/receipt 계약 유지 |
| 제안 `src/connections/anthropic.ts` | 고정 공식 API의 인증된 모델 목록과 Messages SSE 변환. 중도/오류/incomplete stream·보고 usage·토큰 노출 방지, 자동 요청 재시도0 |
| `src/workspace/runtime.ts` / `engine.ts` | key 등록/갱신·모델 검증, participant 설정·일시정지 topic의 이후 turn 설정. 기존 turn/원문과 계정 변경 경계 유지 |
| `src/http/workspace.ts` | 기존 owner/Host/Origin 경계에서 Anthropic 등록. 연결 삭제/키 갱신을 재사용 |
| `src/web/control.html` / `control.ts` / `room-view.ts` | 제공처/모델별 옵션·기존 설정 표시·사후 변경, Anthropic 등록/모델/키 갱신/삭제 UI. 가격 추정·지원되지 않는 OAuth 완료 표시 없음 |
| 테스트/문서 | provider별 실제 payload fixture·unsupported 거절·기존 GPT 설정 부재/호환·기존 turn 보존·stream 실패/usage·계정/삭제 격리·혼합 토론과 390px 브라우저 |

총 **20~28파일·700~1,300줄 추정**. DeepSeek 10~14파일·300~550줄, Anthropic API 12~16파일·400~750줄이며 공통 모델/UI/문서 파일이 겹친다. 실제 OAuth 구현량은 공식 지원 계약이 없어 미측정이다. 범위가 늘면 다시 보고한다.

## 단계와 후속 영향

- 현재 R8 보완으로 두 변경을 분리 검증한다. 새 Phase나 병렬 dispatch는 만들지 않는다. 승인 후 SSOT, participant 계획, implementation sequence의 후속 provider 범위를 함께 보정한다.
- R1: JSON 선택 필드만 additive, 기존 DB SQL schema 유지. 기존 Member와 catalog에 필드가 없어도 기존 동작을 유지한다. 알 수 없는 설정은 미지원으로 거절한다.
- R2: prepared/running turn에 고정한 설정을 보존하고 새 설정은 이후 발언에만 적용. dispatch/예산·미확정/대조 계약 회귀.
- R3: 참여자·topic·방 카드에 올바른 옵션/값 표시. viewport/새로고침/기존 GPT 기본값 회귀.
- R4: API key와 workspace별 모델 목록·credential 격리. Chrome/dot/Muse discovery 변경 없음.
- R5: WorkTask/픽업·리뷰 API와 상태 전이 변경 없음. 다른 provider 참여자가 기존 역할/범위를 통과하는지 회귀.
- R6: Codex 실행기·승인 범위/쓰기 차단 변경 없음. provider 설정을 바꿔 기존 실행/승인 identity를 재라벨하지 않음.
- R7: Wiki storage/CAS/MCP·원문 인용 변경 없음. 새 참여자의 기존 actor/scope·인용 회귀.
- R8: 기존 50 gate 유지, 새 provider/effort fixture와 혼합 토론 회귀 추가. 실제 로그인/유료 추론·실운영 검증을 fixture 성공으로 대체하지 않음. 이후 선택 Git Writer/병렬화/자동 병합은 확장하지 않는다.

## 수락과 복귀

`npm run check` 및 실제 Chrome/MCP browser 검사. 제공처별 정확한 요청·기본/명시 값·미지원 전송0, GPT 회귀·늦은 turn 설정 보존, Anthropic이 보고한 usage만 표시·완료 없는 stream 미확정, owner/Origin·키별 격리/삭제를 검사한다. 화면에서 등록→모델→토커→사고 설정 변경→혼합 토론 fixture를 확인한다. 실계정은 별도 NOT_RUN/UNVERIFIED다.

새 kind 연결을 이전 빌드에서 다른 provider로 오인하지 않도록 방을 끄고 새 provider를 사용하지 않는 상태로 복귀한다. 원문·대화·pending 실행/receipt·vault를 보존하며 새 설정을 제거하려고 DB를 초기화하지 않는다. 새 노력 값을 쓰는 참여자는 이전 코드가 지원하는 설정을 명시 확인한 뒤 재개한다.

## 사용자 승인

추천 범위: DeepSeek 설정과 Anthropic API를 먼저 구현하고, 구독 OAuth는 공식 지원 계약·앱 허가 확보까지 보류한다. 2026-10-31 사용자가 “DeepSeek 설정·Anthropic API부터 구현 승인”으로 답했다. 승인 범위는 위 기능과 기존 계약/데이터 보존·검사/PR이며, 구독 OAuth는 보류하고 실계정 유료 호출·배포는 별도로 둔다. 구현 상태는 SSOT와 별도 실행 기록에서 판정한다.
