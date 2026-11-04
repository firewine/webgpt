# D5 GPT 수정 단일 요청 진단 — 2026-11-04

사용자가 PR #47 병합 뒤 **서버 적용·실패했던 GPT 수정 요청1회로 원인 확인**을 명시 승인했다. 병합 main `df5be3044eace1bb34109afa5ff552036c6d3a97`와 검사 head `5555d59eeb452badb2b2ac13c13343b1d26614fd`는 tree `1eaf1237e24acf84f1480481dc58f232520297e9`가 같다. [동일 소스 CI](https://github.com/firewine/webgpt/actions/runs/41839961568)는 Node556·브라우저/Chrome MCP67·설치 Codex0.165 요청 계약 PASS, FAIL/SKIP0다.

22:52 KST 같은 소스를 별도 경로에서 빌드해 운영 checkout `ops/dot-mcp-d5-gpt-once-20261104`에 fast-forward·실행 파일 교체·정상 service/health 확인 후 적용했다. `.env`·DB·암호/계정·Chrome profile·4090/HTTPS8443·다른 서비스/사용자 untracked 파일을 보존했다. private `dot-mcp-d5-gpt-once-20261104/`에 online backup0600·이전 dist·원래15개 turn/환경 digest·멤버/API 정책·워크스페이스 전체45개 기존 예약을 보존했다. 이45개는 과거 다른 검증을 포함하며 직전 D5 누적21회와 구분한다.

검증 전용 guard는 같은 방·토의/revision·실패 task·일반 GPT OAuth 계정/모델/xhigh·generation을 고정하고 새 durable 예약을 **최대1개**만 허용했다. task 실행과 실제 dispatch 양쪽에 해당 요청을 연결하고, 재시작/실패/정산 뒤에도 한도를 다시 주지 않는다. API/dot/Muse/Codex/업무·다른 과제와 후속 발언은 차단했다. Muse 잠금·기존 감시 비활성을 유지했으며 새 grant/Tunnel·Chrome 관측/전송은 필요 없었다. 응답은 기존300초 제한이며 운영 중지/정리용 상한10분을 별도로 뒀다. 제품 설정/기존 토의 예산은 바꾸지 않았다.

| 항목 | 실제 관측 | private 근거 |
| --- | --- | --- |
| 단일 요청 | 22:54:53~22:55:01 KST, 같은 GPT 수정 task1회만 예약. 요청5,521ms 뒤 실패·본문0·receipt 있음·usage null. 자동 재시도0 | `live-start.json`, `live-outcome.json` |
| 직접 원인 | **CONFIRMED_THIS_REQUEST**. local request digest와 일치하는 종료 로그1개: event=`error`, code=`subscription_sharing_usage_limit_exceeded` | `provider-failure-diagnostics.json` |
| 보존/사용량 | 완료15개 전체 turn digest 동일·5명/교차검토2라운드 유지·멤버 토글 동일. D5 누적 예약22/API3. 이번 DeepSeek 등 API 제공자0·dot/Muse0·실제 Codex0. GPT 미보고 사용량은 UNKNOWN | `final-cleanup-observed.json`, `closeout-hashes.json` |
| 종료/복귀 | 방 off·Muse 잠금·lease/미확정/서버 구독0·검증 drop-in0·정상 ExecStart/service/health. 새 외부 감시를 만들지 않아 별도 감시 종료 요청 없음 | `final-cleanup-observed.json` |
| 정리 경합 | 방 off 요청이409 `room_version_conflict`로 거절된 초기 기록을 보존했다. 이미 off인 방·기타 모든 종료 조건을 읽기 대조해 해결했으며 남은 정리 실패0. 원래 실패 배열을 지우지 않음 | `live-outcome.json`, `final-cleanup-observed.json` |

## 원인의 의미와 남은 조건

이 요청이 멈춘 직접 원인은 **OpenAI의 ChatGPT 구독 연결 사용 제한 응답**이다. 공식 [SIWC 오류/복구](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)는 이 code에서 해당 구독을 쓰는 새 요청을 멈추고 [ChatGPT Usage](https://chatgpt.com/settings/usage)를 확인하도록 안내한다. 계정 전체 소진으로 단정하거나 이 code에서 초기화 시각을 추정하지 않으며 앱별 제한 가능성도 구분한다. 이 의미는 공식 계약과 이번 실제 code를 대조한 것이며 어떤 한도/설정이 적용됐는지는 **UNVERIFIED**다.

앞서 사용자가 보고한 Usage의 **사용 가능·여유 있음** 상태는 그대로 남긴다. 그 화면과 개별 연결 요청의 제한을 같은 것으로 가정하지 않는다. 과거 `other`였던 실패의 실제 code를 이번 관측으로 역복원하지도 않는다. 인증 정보/계정·사고 설정과 기존 기록을 보존한 채 추가 모델 호출은 중지했다.

**D5-F 전체 BLOCKED**의 현재 조건은 일반 GPT의 구독 연결 사용 가능 상태다. 사용 가능 상태 확인과 별도 실행 승인 뒤 같은 토의의 수정5·종합1·종합 검토4·같은 방 dot 후속을 이어가야 한다. 실제 Codex 업무/재검토·Wiki 환류와 실기기/재연결/재시작 등 원래50개 gate의 미검증 조건도 유지한다. 직접 원인 확인은 최종 수락 완료나 제한 해소가 아니다.

이번 산출물은 실행 증거/SSOT/manifest 갱신이며 `src/`·Provider/Store/API·예산/승인/300초·수락 기준 변경0이다. 이미 통과한 같은 코드의 전체 검사를 반복하지 않고 private max1/API0 guard fixture·원래15개/환경/정책 digest·원래50개 gate/D5-A~E/과거 실행 창/파일 경로·문서 diff를 검사한다. 운영 복귀는 완료했으며 DB를 이전 시점으로 덮어쓰지 않았다.
