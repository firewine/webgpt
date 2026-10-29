# 웹쫀쿠 참여자·OAuth·API 연결 계획

| 항목 | 값 |
| --- | --- |
| 상태 | v0.2 — OAuth/API/browser adapter 구현·fixture PASS, 실계정 검증 NOT_RUN |
| 개정일 | 2026-10-29 (KST) |
| 상위 계획 / 대화 흐름 | [개발 계획](./development-plan.md) / [능동 토론](./discussion-plan.md) |
| 운영 / 실행 도구 | [Ubuntu 운영](./ubuntu-operations.md) / [Codex 세션](./codex-session-plan.md) |
| 확정 방향 | 여러 GPT 계정은 OAuth, dot·Muse는 개별 참여자, DeepSeek 등은 API로 같은 토론에 참여 |

현재 구현과 검사는 [WJ-002~015 구현 기록](./implementation/wj-002-015.md), 실제 명령과 복구 절차는 [운영 절차](./operations-runbook.md)를 따른다. 이 문서의 실계정·실세션 완료 조건은 아직 통과하지 않았다.

## 1. 참여자는 연결 방식과 별개다

웹쫀쿠의 기본 단위는 `Participant`다. 사용자가 토론마다 참여자를 선택하고 각 참여자에 역할·모델·맥락을 배정한다. dot이나 Muse를 필수 진행자·상위 관리자로 고정하지 않는다. 진행 순서와 검증 과제의 배정은 Core가 관리한다.

| 참여자 예시 | 인증·연결 | 맥락 보관 |
| --- | --- | --- |
| GPT 계정 A | Sign in with ChatGPT OAuth + ChatGPT plan usage + Responses | 웹쫀쿠의 해당 참여자 대화 이력 |
| GPT 계정 B | A와 분리된 OAuth 등록·동의·토큰·모델 목록 | B 전용 대화 이력 |
| dot(may) | 서버 Chrome의 기존 dot 대화; 검증 후 공식 MCP/이벤트 병행 | 실제 dot의 기존 맥락 + 웹쫀쿠 주제·발언 참조 |
| Muse | 서버 Chrome의 기존 Muse 대화; 공식 Connector는 별도 검증 | 실제 Muse의 기존 맥락 + 웹쫀쿠 주제·발언 참조 |
| DeepSeek | 서버에서 보관하는 API key + 공식 대화 API | 웹쫀쿠의 해당 참여자 대화 이력 |

이 표는 연결할 수 있는 유형이며 실제 등록된 계정 수나 모델 가용성을 뜻하지 않는다. GPT A·B는 서로 다른 사용 허가된 계정의 예시다. 같은 계정의 두 등록·모델·역할을 두 개의 독립 계정으로 세지 않는다. dot과 GPT가 같은 계정을 쓰면 계정 자원 관계도 함께 기록한다.

여러 GPT 계정·DeepSeek 혼합 참여는 Phase 1~2 MVP 범위로 올린다. Phase 5는 추가 provider와 **동시 실행 용량** 확장이다. 여러 참여자의 순차 토론을 Phase 5까지 미루지 않는다.

## 2. GPT: OAuth로 연결하고 웹쫀쿠에서 대화

2026-10-29 확인한 [Sign in with ChatGPT 안내](https://developers.openai.com/siwc/quickstart)와 [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source)는 대상 앱·계정의 허가 범위에서 OAuth 인증으로 Responses 요청을 수행하는 경로를 제공한다. 웹쫀쿠의 일반 GPT 참여자는 이 경로를 우선 구현한다. 별도의 OpenAI API key 입력이나 일반 ChatGPT DOM 자동화를 기본 경로로 요구하지 않는다.

인증과 대화 호출은 다음처럼 구분한다.

- 사용자 경험: 계정 추가 → ChatGPT 로그인 → 이용 권한 동의 → 참여 모델 선택 → 웹쫀쿠 공동 대화.
- 실제 호출: Ubuntu가 해당 계정의 OAuth access token으로 공식 Responses endpoint에 요청하고 결과를 웹 UI로 전달.
- 대화 맥락: 웹쫀쿠가 참여자별로 저장한 이력을 사용. OAuth 연결로 기존 ChatGPT 대화·메모리·dot의 인격을 자동 가져오지 않는다.
- 이용 자격: 앱 배포 형태, 사용자·workspace·구독 권한과 실제 consent 결과를 확인. 개인 self-hosted/OSS 경로의 지원을 상용 원격 서비스의 허가로 확대 해석하지 않는다.

따라서 제품에서 말하는 “OAuth 기반 웹 대화”는 **ChatGPT 계정으로 인증해 웹쫀쿠 웹 UI에서 하는 대화**다. `chatgpt.com`의 기존 대화 스레드를 OAuth로 원격 제어한다고 표시하지 않는다. 사용자가 특정 기존 웹 대화를 연결하는 경우에만 별도 browser participant를 등록한다.

### 2.1 계정 등록·갱신

[공식 등록 절차](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)에 맞춰 호스트 ID, 일회성 state·nonce·PKCE, 발급 client ID와 반환 scope를 검증한다. 초기 등록에 쓰는 `dynamic_agent_client`를 발급된 client ID처럼 저장하지 않는다. 로그인 성공과 `chatgpt.tokens.use.direct` 사용 권한을 구분한다.

[계정 관리 계약](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)에 따라 검증된 identity·발급 client ID별 credential record를 분리하고 같은 세션의 refresh를 직렬화한다. 새 로그인으로 다른 참여자의 토큰을 덮어쓰지 않는다. 표시 이메일만으로 계정·workspace를 합치지 않는다. 재시작·모델 변경마다 새 계정을 등록하지 않는다.

프로젝트 설계: AccountConnection을 참여자에 명시적으로 바인딩하고 발언 시작 시 고정한다. 전역 “현재 계정”을 바꾸는 mutable client를 모든 참여자가 공유하지 않는다. 새 인증의 계정이 예정한 계정과 다르면 연결을 확정하지 않는다. 토큰 원문은 서버의 보호된 저장소에 두고 프론트엔드·발언·로그·Git·Codex 입력에 보내지 않는다.

### 2.2 Ubuntu에서의 로그인

OSS OAuth의 loopback callback은 **로그인 브라우저가 실행되는 컴퓨터**로 돌아온다. Tailscale로 웹쫀쿠에 들어온 원격 기기의 `127.0.0.1`은 Ubuntu 서버가 아니다. `*.ts.net` URL로 callback을 임의 교체해 지원된다고 가정하지 않는다.

초기 구현 후보는 Ubuntu의 등록 helper와 같은 서버의 Chrome에서 로그인하고, 사용자가 noVNC로 그 창을 조작하는 방식이다. callback listener도 같은 서버에 loopback으로만 연다. 이는 공식 loopback 계약을 서버 배치에 적용한 **구현 설계**이며 실제 등록·인증·재접속 PoC를 거쳐 확정한다.

그 흐름을 사용할 수 없으면 [공식 self-hosted VM 절차](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)의 로컬 등록·보호 credential 전달을 별도 설치 경로로 검증한다. 이 경우 VM의 host ID를 유지하고 서버가 이후 refresh를 소유하도록 하며 Chrome 쿠키 복사와 혼동하지 않는다. 토큰을 채팅에 붙여넣거나 공개 URL에 포함시키지 않는다. 한 번 등록한 뒤 일상적인 웹 대화는 noVNC 없이 Control Room에서 한다.

### 2.3 모델·응답·대화 이력

[모델·추론 계약](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)에 따라 해당 계정의 모델 목록을 조회하고 선택한 slug로 `POST https://api.openai.com/v1/responses`를 호출한다. HTTP 요청은 `store:false`, `stream:true`를 사용하며 `response.completed`까지 확인한다. 시작된 스트림·일부 텍스트·HTTP 200만으로 완료 처리하지 않는다.

[Preview 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)을 전용 serializer에 적용한다. 필요한 이력을 `input` 배열로 구성하고 지시는 `instructions` 또는 지원되는 developer 메시지로 전달한다. HTTP `previous_response_id`·`conversation` 저장에 기대지 않으며 `max_output_tokens`·`temperature` 등 이 경로의 미지원 필드를 다른 API adapter에서 복사하지 않는다. 도구·파일·검색 지원도 실제 계정·모델의 capability로 검사한다.

프로젝트 설계: 대화 이력은 `(discussionId, participantId, topicRevision)`으로 분리한다. 각 참여자의 자기 발언과 공식적으로 공유된 다른 참여자의 답변을 구분한다. OAuth 연결의 응답 ID를 ChatGPT 웹 대화 ID로 쓰지 않는다. 모델·계정을 바꾸면 새 binding revision을 만들고 이전 결과의 작성자와 설정은 보존한다.

## 3. dot·Muse: 기존 에이전트를 참여자로 연결

dot과 Muse는 각자의 실제 기존 agent·대화에 연결한다. 일반 GPT OAuth 모델을 dot으로 이름만 바꿔 연결 성공으로 표시하지 않는다. 로그인된 Ubuntu Chrome의 서비스별 adapter로 전송·관측하며 대화를 보존한다. 공식 MCP/이벤트 연결은 검증 후 같은 turn 계약에 추가한다.

브라우저 계정·프로필·agent·대화 식별과 OAuth의 account registration은 서로 다른 binding이다. 같은 계정이라는 이유만으로 대화 맥락이나 credential을 섞지 않는다. dot·Muse가 토론에 포함되지 않아도 OAuth GPT와 API 모델만으로 새 토론을 시작할 수 있다.

## 4. DeepSeek 및 API 참여자

첫 API adapter는 DeepSeek로 한다. [공식 안내](https://api-docs.deepseek.com/)의 API key 인증과 OpenAI 호환 요청 형식을 사용하되 OpenAI OAuth adapter와 인증·파서를 공유하지 않는다. [대화 API](https://api-docs.deepseek.com/api/create-chat-completion/)의 `messages`·stream과 [모델 목록](https://api-docs.deepseek.com/api/list-models/)을 기준으로 지원 모델·기능을 확인한다. 특정 최신 모델명·가격을 코드 상수로 추정하지 않는다.

프로젝트 설계:

- provider·허용 endpoint·credential 참조·model ID·generation 설정을 연결별로 고정한다. 모델이 답변에 쓴 URL로 인증 헤더를 보내지 않는다.
- API key는 Ubuntu에 저장하고 클라이언트는 연결 이름·검증 상태만 받는다. DeepSeek의 토큰·비용 기록은 OAuth GPT의 구독 이용 상태와 구분한다.
- 참여자별 이력을 해당 API schema로 변환한다. 타 참여자의 인용을 system/developer 지시로 승격하지 않는다.
- SSE delta·완료 표식·finish reason·오류·usage를 provider 계약으로 해석한다. 길이 제한·끊어진 스트림·도구 호출은 자연어 최종 결과 완료와 구분한다.
- 사용량을 반환받지 못하면 unknown으로 기록한다. 비용은 관측 usage와 적용 가격표 시점에 따른 추정으로 표시하고 영수증처럼 단정하지 않는다.
- 모델이 검색이나 실행 도구를 요청해도 Core에 등록된 capability·권한·예산을 통과한 작업만 실행한다. 모든 API 모델이 스스로 웹 검색·코드 실행할 수 있다고 표시하지 않는다.

다른 API provider는 adapter로 추가한다. “OpenAI 호환”이라는 이름만으로 모든 요청 필드·도구·stream event가 동일하다고 가정하지 않는다.

## 5. 공통 계약과 사용량

| 객체 | 책임 |
| --- | --- |
| Participant | 표시 이름·역할·모델, 토론별 identity, AccountConnection·ConversationContext 참조 |
| AccountConnection | provider, `oauth` / `api_key` / `browser_session`, credential 참조, 검증 identity·workspace, 권한·연결 상태 |
| ConversationContext | 웹쫀쿠 이력 또는 실제 provider conversation binding, 주제·revision·공유 범위 |
| ProviderAdapter | probe / prepareTurn / dispatch / observe / reconcile / requestStop; provider별 완료 근거 |
| ResourceGroup / UsageLedger | 실제 계정·등록·credential의 공유 한도, 요청·토큰·비용 또는 미확인 상태 |

MVP는 root workflow 1개와 활성 provider turn 1개로 시작하되 참여자는 여러 명을 등록·선택할 수 있다. 독립 초안은 순차 수집해도 상대 답변을 먼저 전달하지 않는다. 공유 계정·credential의 제한은 묶어서 관리한다. 등록 수나 탭 수를 실제 가용 용량으로 계산하지 않는다.

API provider에는 저장된 요청·입력·출력 token 및 비용 예산을 적용한다. 필드로 출력 한도를 설정할 수 없는 OAuth 경로에는 미지원 필드를 보내지 않고 요청 수·입력 크기·경과 시간·계정의 실제 사용 제한을 적용한다. 진행 중 취소로 이미 발생한 사용량이 환불되거나 정확히 상한에서 멈춘다고 보장하지 않는다.

같은 turn의 재접수는 같은 작업을 반환한다. 모델 호출이 이미 접수된 뒤 연결이 끊겼으면 provider의 조회·재개 capability와 저장 기록을 대조한다. 확인할 수 없는 호출을 자동 반복해 중복 과금·발언을 만들지 않는다. 명시적 거절과 재시도 가능한 오류만 정해진 횟수로 backoff하며 내부 SDK 자동 재시도도 이 정책에 맞춘다.

계정·모델·provider를 자동으로 바꿔 결과를 같은 참여자의 답변처럼 내보내지 않는다. 사용량 제한은 해당 참여자의 대기·부분 결과로 표시한다. 사용자가 대체 참여자를 선택하면 새 revision과 작성자 정보를 남긴다.

## 6. Phase 0~2 완료 조건

- OAuth: 계정 2개를 각각 등록하고 권한·모델 목록·실제 완료 응답·후속 맥락을 확인한다. 계정 전환·refresh·재시작·로그아웃이 다른 계정 credential과 이력을 변경하지 않는다.
- dot·Muse: 각각 기존 로그인 대화의 요청·후속 질문·재연결과 실제 agent 식별을 확인한다.
- DeepSeek: 허가된 key로 최소 요청·후속 맥락·stream 완료·usage를 확인하고 오류·한도·중단 fixture를 통과한다.
- 혼합 토론: 서로 다른 GPT OAuth 계정 2개와 DeepSeek 1개를 포함한 N인 토론, 그리고 browser participant를 추가한 흐름을 확인한다. dot·Muse는 각각 최소 한 번 실제 혼합 토론에 참여한다.
- 서버·클라이언트: Tailscale 웹 접속에서 결과를 보며 클라이언트 종료·다른 기기 재접속에도 서버 토론이 유지된다. OAuth 등록 callback과 일상 HTTPS 접속을 구분한다.
- 증거: 참여자·계정 참조·모델·입력 snapshot·응답 완료 근거·비용 판정을 기록하되 토큰·키는 제외한다.

이는 릴리스 검증 조건이다. 계정 자격·key·로그인·실제 호출은 아직 NOT_RUN이며 문서 작성 중 유료 모델 요청이나 계정 연결을 수행하지 않았다. 부적격·미지원 연결은 BLOCKED로 남기고 OAuth 요구를 임의로 API key나 DOM 자동화로 대체하지 않는다.
