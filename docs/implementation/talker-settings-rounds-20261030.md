# 별도 GPT 계정·사고 깊이·전체 발언 재검토

- 날짜: 2026-10-30 (KST)
- 기준 main: `0a0c448677d89ec18e8ac7b5536f5e261015b226` (사용자 PR #8 병합)
- 작업 브랜치: `codex/talker-settings-rounds-20261030`
- 요청: dot과 웹 GPT의 계정 분리, 기본 Extra high와 사후 조절, 긴 답변을 듣고 각 토커가 독립적으로 재분석·재발언.
- 판정: 구현·fixture·실제 HTTPS 설정 UI PASS. 실제 별도 GPT 계정 로그인·xhigh 추론·혼합 토론은 NOT_RUN.

## 계정과 사고 깊이

dot의 기존 Chrome profile·대화·로그인은 보존한다. OAuth GPT 로그인은 연결 ID마다 다른 Chrome MCP `isolatedContext`에서 연다. 설치된 MCP 1.12.0의 tools/list schema로 지원을 확인했고, 지원하지 않는 도구는 기본 로그인 공간으로 우회하지 않고 거절한다. 실제 Chrome fixture에서 dot·웹 A·웹 B 공간의 쿠키가 서로 보이지 않는 것을 확인했다.

UI의 선택 입력인 “웹 GPT 계정 이메일”을 지정하면 OAuth의 검증된 identity 이메일이 다를 때 credential 저장 전에 거절한다. 앱 vault는 계정별 credential을 보관한다. 로그인 context는 consent용이며 dot의 profile·기억을 복제하지 않는다. context 쿠키의 재시작 후 지속성을 보장하는 기능도 아니다. 실제 dot과 웹 GPT가 서로 다른 계정인지는 사용자의 실제 로그인 identity로 별도 확인해야 한다.

OAuth GPT 토커의 `reasoningEffort` 기본값은 `xhigh`다. Low / Medium / High / Extra high와 계정·모델·이름·역할을 저장·수정할 수 있다. 새 토의는 토커 설정을 snapshot으로 복사한다. 등록한 토커의 계정을 바꿔도 기존 토의의 계정·이력을 다른 계정으로 옮기지 않는다.

진행 중 토의의 사고 깊이는 paused/blocked이고 모든 발언이 확정됐을 때만 바꾼다. 이후 요청부터 적용하며 각 turn에는 요청 당시의 값이 남는다. running·prepared·unconfirmed가 있으면 거절한다. 기존 browser dot·Muse의 모델·사고 깊이는 원래 서비스에서 설정한다. API도 browser 참여자에게 OAuth 사고 깊이를 적용했다고 허위 저장하지 않는다.

OAuth Responses에는 `reasoning: { effort: "xhigh" }` 또는 선택값을 보낸다. 해당 필드가 거절되면 `reasoning_effort_not_supported`를 표시하고 자동 하향·재시도하지 않는다. 특정 실계정 모델에서의 xhigh 성공은 아직 확인하지 않았다.

2026-10-30 공식 [ChatGPT plan usage 모델·추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)과 [Responses reasoning](https://developers.openai.com/api/docs/guides/reasoning)을 읽었다. 전자는 계정별 카탈로그·public Responses·store:false/stream:true를, 후자는 reasoning effort와 모델별 지원을 설명한다. 계정 적격성·허용 모델·xhigh 응답은 실제 인증·추론으로 별도 판정한다.

## 긴 발언과 재분석

독립 초안 → 모든 초안 확보 → 이전 라운드의 전체 발언을 각자 읽고 재분석 → 라운드 전체 확보 → 다음 검토 → 근거 확인·수정·종합으로 진행한다. 같은 라운드에서 먼저 도착한 다른 토커의 새 답을 다음 토커에게 미리 공유하지 않는다. verification·revision 단계에도 같은 단계의 새 발언이 유출되지 않도록 공개 범위를 보강했다.

상호 검토는 순환 이웃 한 명 대신 다른 모든 활성 토커의 주장을 배정한다. 최대 8명×8개 주장을 수용하도록 reviews 한도는 64개로 조정했다. 단순 요약이나 동일한 결론을 강제하지 않고 근거·가정·반론·입장이 바뀐 이유를 공개 답변으로 작성하도록 요청한다. 내부 사고 과정 출력은 요구하지 않는다.

기본 검토 2회이며 UI·API에서 1~8회를 선택할 수 있다. 요청·시간·토큰 예산이 우선하며 부족하면 부분 완료한다. StructuredReply 본문 한도는 기존 16,000자에서 100,000자로 확장했다. 전체 응답 100,000자, prompt+개인 history 180,000자 한도는 유지한다. 원문을 조용히 자르는 대신 초과를 오류로 표시한다. 무제한 문맥·자동 분할 전송을 구현한 것은 아니다.

## 검증과 실제 적용

| 검사 | 결과·범위 |
| --- | --- |
| TypeScript·Node | `npm run check`: 46 PASS / 0 FAIL / 0 SKIP |
| 실제 Chrome·MCP·UI | Chrome 156 + MCP 1.12.0: 8 PASS / 0 FAIL / 0 SKIP |
| OAuth 계정 고정 | 다른 identity는 credential 저장 전 거절, 올바른 이메일만 허용 |
| 실제 쿠키 격리 | 로컬 fixture의 dot·웹 A·웹 B 공간 간 비공유 |
| 사고 깊이 요청 | 기본 xhigh·선택 high의 요청 JSON 확인, unsupported 응답에 자동 재시도·하향 없음 |
| 설정 수정 | 새 토커 계정 변경에도 기존 토의 snapshot 보존, paused 토의의 effort만 별도 변경 |
| 과거 발언 보존 | 실행 중 변경 거절, 이후 변경 시 과거 turn xhigh / 다음 turn high 유지 |
| 3인 긴 답변 | 16,000자 넘는 초기안 전체를 모든 검토자에게 전달. 라운드별 공통 snapshot과 다른 모든 claim 배정 확인 |
| 실제 HTTPS UI | 기본 xhigh·별도 계정 이메일·라운드 선택·기존 Muse 참여자 표시 확인 |
| 실제 GPT 로그인·추론 | NOT_RUN. 웹 GPT 연결은 아직 auth_required이며 실제 카탈로그·xhigh 응답 없음 |

실제 적용 전 private state의 `backups/2026-10-30T01-29-02.885Z.sqlite`에 online SQLite 백업을 생성했다. 실행 중·미확정 turn과 job이 없는지 확인하고 웹앱만 재시작했다. 기존 토의·connection·participant·수동 lease와 Chrome PID가 그대로인지 대조했다. 실제 OAuth 시도·모델 호출·토의 자동 재개는 시작하지 않았다. 도구 재연결 뒤 page ID는 운영 절차에 따라 같은 URL·thread와 대조한다.

## 다음 사용자 작업

작업실 새로고침 → 참여자와 연결 → GPT 계정 추가에 웹 GPT용 별칭과 선택 이메일 입력 → OAuth 로그인 시작 → 별도 로그인 창 열기 → dot과 다른 실제 계정으로 같은 Ubuntu Chrome에서 로그인·동의 → 모델 확인 → 대화 참여자 만들기에서 연결·모델·Extra high 선택. 이후 등록한 토커 설정에서 변경한다.

실제 두 계정의 차이·모델별 effort 지원·긴 실계정 혼합 토론은 따로 검증한다. PR 병합은 사용자 담당이다.
