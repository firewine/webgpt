# 페이즈 8 — 실제 GPT2·CoralBricks 토의 / 2026-10-31

이 문서는 최초6요청 실패 당시 기록이다. PR #29 병합·별도 적용/테스트 승인 뒤 같은 토의를 이어간 [후속 재검증](./phase8-continuation-20261031.md)은 총12요청·PARTIAL/예산 소진으로 종료했다. 아래 원래 실패·usage 미보존 사실은 수정하지 않는다.

**결과: 부분 성공 후 FAIL.** 3명의 독립 초안과 GPT2계정의 첫 상호 검토는 완료했으나 DeepSeek Max의 첫 상호 검토가 `response_not_completed`로 중단됐다. 6요청·4분15.545초, 완료5/실패1/미확정0이며 자동 재전송하지 않았다. [수치·보존/dispatch 증거](./assets/r8-real-api-20261031/summary.json), [실제 desktop 화면](./assets/r8-real-api-20261031/topic-desktop.png), [실제 mobile 비교](./assets/r8-real-api-20261031/comparison-mobile.png)를 함께 본다.

## 승인·실행 범위

사용자가 별도 확인에 **“실계정 검증 승인”**, **“기존 토의 종료 후 새 검증 준비”**로 답했다. 기존 GPT2연결·CoralBricks로 검증용 토커와 새 토의1개, 최대24요청/20분이며 Chrome 대화 전송·Codex 실행·배포는 제외했다. 기존 중단 토의의 원문·결과를 보존한 취소만 허용했다. 기반 저장소 main은 PR #27 병합 `d0aa716e321531d84c756c37c5991269e0789a71`다. 실제 프로세스의 git revision은 별도 build ID가 없어 UNVERIFIED로 구분한다.

운영 DB를 private backup한 뒤, 원래 blocked 토의의 발언3개·context/claim/evidence/checkpoint 해시를 고정하고 기존 control API로 취소했다. 취소 후 같은 해시와 receipt/원문 보존을 확인했다. GPT2개의 기록된 이메일이 서로 다름을 확인하고 새 검증 토커3개만 등록했다. 기존 토커/모델·방 설정·Chrome profile을 바꾸지 않았다. 키/이메일·원래 대화·provider receipt 원문은 공개 증거에 포함하지 않는다. 원문/사전 DB는 사용자 private state에만 있다.

| 참여자 | 실제 연결·모델 | 요청 사고 깊이 | 완료 범위 |
| --- | --- | --- | --- |
| GPT-A | 일반 OAuth · `gpt-6.1-sol` | xhigh | 독립 초안1·상호 검토1 |
| GPT-B | Codex 기기 코드 OAuth · `gpt-6.1-sol` | xhigh | 독립 초안1·상호 검토1. Codex 실행 job이 아니라 모델 API 연결 |
| DeepSeek-Coral | CoralBricks · `deepseek-v4.1-flash-fast` | max | 독립 초안1·상호 검토 실패1 |

두 GPT 모델은 두 계정의 실제 catalog에 공통으로 있었고, Codex 쪽 xhigh·Coral Max 지원도 catalog에서 확인했다. API의 수락과 반환을 관측한 것이며 제공처 내부 사고 과정을 검증했다고 주장하지 않는다. 검증 자료는 이 작업을 위한 가상 알림 시나리오이며 사용자의 원래 업무 자료를 AI에 보내지 않았다.

검토2라운드·검증 과제 최대3·Codex 한도0·보고 token 예산100,000으로 설정했다. 20분 wall 범위 안에 여유를 두려고 엔진 활성 시간은19분으로 제한했다. request 생성 key/토의 ID·deadline은 private journal에 전송 전에 기록했다. 실패 후 6요청에서 계속 중단 상태이며 자동 재개/새 토의를 만들지 않았다. 출력 설정 추가/운영 적용·재검증은 별도 허용 전 진행하지 않는다.

## 실제 관측과 남은 조건

| 판정 | 증거·방법 | 실제 결과/한계 |
| --- | --- | --- |
| PASS | owner HTTP와 SQLite 원문 대조 | 기존 토의 원문/맥락/근거·기존 토커·미사용 연결 보존, browser 수동 잠금·resident·jobs 불변 |
| PASS | turn의 영속 입력·dispatch event·시간 구간 | 독립 초안의 peer 공유0, 첫 상호 검토에는 초기3발언만 공유. 최대 동시 호출1, turn마다 dispatch1·서로 다른 receipt6 |
| PASS | 모델 완료·구조화 reply·보고 usage | 5완료, 상호 검토 stance 지지4·반론4. 입력11,220/출력11,142토큰은 제공된5응답 합계이며 실패 요청 비용/usage를 추정하지 않음 |
| FAIL | 실제 DeepSeek Max의 첫 cross_review | receipt 있음·최종 text0·`response_not_completed`. 원격 종료 enum/실패 usage가 현재 adapter에 보존되지 않아 정확한 원인은 UNVERIFIED |
| PASS (정지 보호) | failure 뒤 같은 ID/요청 수 재조회·SQLite | 6회에서 추가 호출0, 새 job/source 조회0, 불완전 응답을 완료/검증 성공으로 승격0 |
| PASS (실제 UI) | Chrome156.0.8078.47, 실제 private HTTPS, 1440×1000/390×844 | 6기록·3인 비교, 가로 넘침0·page error0, reload/2SSE 연결 뒤 같은 turn ID·요청6 유지. GET만 허용한 별도 headless context로 확인; 기존 서버 Chrome 대화 전송0 |
| NOT_RUN | verification/revision/synthesis/summary_review | failed 과제를 우회하거나 DeepSeek를 제외해 완료로 표시하지 않음 |
| NOT_RUN / UNVERIFIED | 원래 R8-D 전체/기존 기타 gate | 실제 dot/Muse·상주 업무/Wiki·사용자 Codex read/write·다른 실기기 IME/터치는 이번 허용 범위에 없음 |

실패 요청 usage가 저장되지 않았는데 과거 `used.unknownUsage`도0으로 남는 진단 결함을 발견했다. 공개 JSON은 원래0과 실제 미보존 실패1을 **각각** 기록한다. 원래 요청의 usage/finish_reason을 나중에 추정하거나 고쳐 쓰지 않았다. `4,096 max_tokens` 고정은 유력한 후보이나, 이번 원격 종료가 `length`였다는 증거가 없으므로 확정하지 않는다. [출력 한도 제안](../reviews/deepseek-output-limit-impact-20261031.md)은 미승인으로 분리한다.

## 진단 보강 — 운영 미적용

위 PNG는 보강 배포 전 실제 실패 시점의 운영 화면이다. 대기 문구/미확인0 등 기존 표시 결함도 그대로 관측한 증거이며 수정 후 실제 배포 성공 화면으로 제시하지 않는다.

`Providers.complete` 인터페이스·기본4,096·사고 값·재시도/미확정·단일 dispatch·인증/예산 한도는 유지한다. 작은 `CompletionFailure`로 정해진 protocol enum과 실제 제공된 usage만 전달한다. DeepSeek의 non-stop 신호 뒤에도 **같은 SSE**의 후속 usage/[DONE]를 읽어 실패 증거를 보존한다. 이는 새 모델 호출이 아니다. EOF/잘못된 stream은 미확정으로 남기며 reasoning/tool 인자·provider prose를 말풍선/오류에 넣지 않는다.

`DiscussionEngine`은 원래 transaction에서 실패 turn의 reason/usage와 보고 token 소비를 함께 저장하고, 미제공은 unknown으로 센다. `ResidentRunner`도 같은 기존 ledger/settle을 사용한다. 알려진 실패 소비가 예산을 넘겼다면 명시 resume 후에도 새 호출을 막는다. UI는 빈 실패 응답을 “대기 중”으로 표시하지 않고, 기록된 종료 이유를 표시한다. 과거 실패 usage의 누락 횟수는 읽기 투영으로 구분하며 DB 원문을 소급 수정하지 않는다.

선택 `providerFinishReason`만 추가하며 SQL schema 이관·새 provider/로그인·scheduler·DB 재작성은 없다. topic/resident/work의 기존 dispatch와 Store transaction에 작은 adapter로 결합한다. 과거 미확정/receipt·단계·50 gate와 권한은 유지한다. 진단 보강은 fixture/코드 변경이며 **실제 실패 토의를 이 코드로 재실행하거나 서비스를 재시작하지 않았다**.

검사: `npm run check` strict TypeScript/빌드·Node314 PASS 후, EOF의 보고 usage 보존을 보강하고 관련18개를 다시 PASS했다. 선행 PR #28의 doctor 준비 진단까지 통합한 최종 전체 `npm run check`는 **Node319 PASS**, FAIL/SKIP0이다. 새 실패 검사8개는 늦은 usage, length/filter/tool/기타 reason, EOF/잘못된 JSON의 미확정, 사고 원문 비노출, 토의 예산 차단·미제공 unknown·상주 ledger/재전송0을 확인한다. 실제 Chrome156.0.8078.47의 기존 토의/제공처 설정 fixture **3개 PASS**도 확인했다. 전체 browser/최종 CI는 PR의 정확한 head/check로 판정한다. fixture의 `length` 성공 재현을 실제 요청의 종료 이유로 오인하지 않는다.

## 다음 작업과 복귀

실제 검증 토의는 현재 blocked/원래6요청으로 보존한다. 즉시 재개하거나 사고 깊이를 자동 낮추지 않는다. 종료 이유를 관측할 수 있는 보강 배포와 필요하면 명시 출력 한도 설정을 적용한 뒤 원래 토의/실패 receipt·입력을 대조하고 별도 허용된 시간/잔여 요청 안에서 이어간다. 새 토의로 실패를 숨기거나 24회 한도를 새로 시작하지 않는다.

변경을 되돌려도 선택 필드/원문/usage를 삭제할 필요가 없다. 신/구 코드 모두 미확정·기존 root를 자동 재전송하지 않는 상태에서 복귀한다. 이전 코드의 알려진 실패 usage 유실은 한계로 남긴다. 운영 DB를 사전 backup으로 덮어써 호출·정산 기록을 잃지 않는다. R8-D 전체 수락/자동 주제·상주 전체 성공은 아직 아니다.
