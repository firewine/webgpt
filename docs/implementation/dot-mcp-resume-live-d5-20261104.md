# D5 두 번째 교차검토 이후 실검증 — 2026-11-04

**최종 판정:** 추가 예약4/API1·보고45,335토큰, 완료3개를 더 수락해 전체 완료13개다. dot의31페이지 원문 조회는 끝났으나300초 안에 submit 수락이 없어 미확정1개로 정지했다. D5-F는 BLOCKED다. 방 off·Muse 잠금·최신 멤버 토글·정상 service·관련 전용 Tunnel0·서버 구독0을 확인했다.

## 기준·새 승인

제품 기준은 병합 main `f3a2e34026c37c2bff52e194678b3de795c84d62`다. [첫 교차검토 완료와 Muse 원래 응답 복구](./dot-mcp-paged-live-d5-20261103.md) 뒤 완료10개·미확정0·방 off·Muse 잠금·정상 service를 확인했다. [PR #45](https://github.com/firewine/webgpt/pull/45)의 동일 제품 소스 전체 자동 검사는 PASS다. 이번 작업은 기존 토의의 실계정 수락이며 제품/계획 계약을 추가 변경하지 않는다.

사용자가 **추가 최대30분·27회 요청·DeepSeek High 최대6회/165,092 보고 토큰·dot 감시 재연결·Muse 임시 잠금 해제/종료 복구**를 승인했다. 완료10개 재전송0·새 토의/업무0·실제 Codex/쓰기0을 유지한다. 기존 D5 예약13회와 새 최대27회로 누적40회 이내이며, 원래 API 일일 정책8회/200,000토큰과 실제 당일 잔여도 함께 적용한다. 날짜가 바뀌어도 이번 승인 한도를 늘리지 않는다.

남은 정상 흐름은 검토2의5명·수정5명·종합1·종합 검토4·같은 방 dot 후속1로16회다. 첫 새 예약부터 시간을 재며 마지막5분 신규 예약을 막는다. grant가 먼저 만료되면 그 범위 안에서 더 일찍 정지한다. 다음 검증용 guard는 같은 배포의 예약/실행 경로를 감싸며 product 전역 한도로 추가하지 않는다.

## 준비와 재개

- private `dot-mcp-d5-resume-20261104/`에 현재 SQLite online backup0600·완료10개 digest·환경 digest·최신6명 멤버 토글·API 정책·새 승인/policy를 보존했다. 검증에는 원래5명만 사용하고 종료 때 최신 소유자 토글로 복원한다.
- 검증용 service drop-in1개로 같은 배포의 entry에 요청/시간/API 제한·실제 Codex/새 업무 차단을 적용했다. `.env`·port4090/HTTPS8443·원래 계정/대화·state는 유지한다.
- 같은 dot/방/세 도구의30분 권한과 기존 Tunnel/runtime key 파일 참조를 사용했다. 새 계정·플러그인·터널·키는 만들지 않았다. 준비 중 이전 owner profile의 별도 만료 runtime이 남아 있어 소비자 조회가 예전 grant로 전달됐다. 실행 파일과 profile을 대조해 그 이전 runtime만 종료한 뒤 실제 `webjjoku_dot_paged`의 metadata get PASS·새 runtime readiness200을 확인했다. 앞선 기록의 실제 검증 runtime 종료와, 이번에 추가 확인한 더 이전 준비 runtime 종료를 구분한다.
- 사용자가 같은 필터의 기존 native 감시 구독 갱신·활성·전체 페이지/JSON 지시 유지를 보고했다. 서버에서도 현재 grant의 유효 구독1개를 확인했다. 도구 조회/구독 준비를 native 모델 답변 완료로 세지 않는다.
- Muse 원래 계정/thread·빈 입력·idle을 다시 대조한 뒤 검증 중 잠금을 해제했다.16:11:17 KST 첫 새 예약으로 같은 토의의 검토2를 시작했다. 완료10개·실패 이력은 유지한다.

이번 private operator는 Muse가300초 뒤 미확정이 되면 후속 전송을 멈춘 채 남은 승인 시간 안에서 원래 화면을 최대2분 더 읽기 전용 대조할 수 있다. 같은 계정/thread·요청 표식1개·현재 revision/generation·idle·연속 동일 최종 JSON·할당 검토 coverage가 모두 확인될 때만 기존 소유자 `reconcile(completed)`로 그 원래 결과를 수락하고 같은 창에서 이어간다. **새 모델 요청/재전송·제품 timeout 변경·일반 제품의 자동 수락 기능 추가가 아니다.** 확인되지 않으면 미확정으로 남기고 정리한다.

## 실제 관측과 수락

| 항목 | 현재 관측 |
| --- | --- |
| 원래 완료10개 | digest 동일·재전송0 |
| GPT OAuth 검토2 | **PASS**:224,976ms·할당10건/구조화 검토10건·coverage 전체 |
| Codex 기기 코드 GPT 검토2 | **PASS**:214,553ms·할당10건/구조화 검토10건·coverage 전체. 실제 Codex 실행이 아닌 GPT 참여자 호출 |
| DeepSeek High 검토2 | **PASS**:81,338ms·할당10건/구조화 검토10건·coverage 전체. API1회·보고45,335토큰 |
| dot 검토2 | event callback1회/HTTP200·claim·31/31페이지 조회. 같은 digest·최대RPC11,495bytes·원문137,805bytes. **응답 수락은 미확정**:300초 뒤 `dot_reply_unconfirmed`, 서버 reply/receipt 없음 |
| 라운드 공개 | 검토2 `sharedReplies:10`은 이전 단계/라운드의 완료 답변만 포함. 현재 라운드의 GPT2/API 새 답변은 dot 입력에 먼저 노출하지 않음 |
| Muse 검토2·수정·종합·같은 방 후속 | NOT_RUN. dot 미확정 뒤 자동 전송하지 않음 |
| 전체 D5-F | BLOCKED 유지. 원래50 gate·별도 기기/Codex 수락과 구분 |

dot 요청은16:19:58.890 KST 준비·첫 페이지16:20:57.936·마지막31페이지16:24:53.501, timeout16:24:58.990이다. **페이지 조회 구간235,565ms·페이지 간 중앙 간격7,690ms**, 첫 페이지까지59,046ms였다. 마지막 페이지가 서버에서 반환됐을 때 제한까지 약5.5초만 남았다. 이 간격에는 native 실행/도구 처리 등이 포함되며 순수 네트워크 지연으로 분해하지 않았다.

사용자는 감시 비활성화·31페이지 전체와 식별값/누락 확인·JSON 답변 생성·submit1회 오류를 보고했다. accepted/receipt와 오류 원문은 확인하지 못했고, 실패 보고 뒤 처리는 중단했지만 외부 자동화 실행 최종 상태는 별도로 확인되지 않았다. 서버는 reply/receipt0이다. 제출 시각/구체 오류가 없어 권한 정리와 오류의 인과는 **UNVERIFIED**다. 따라서 submit 미실행으로 기록하거나 기존 `stoppedWithoutSubmit` 확인을 대신하지 않았고 원래 held 요청을 유지했다.

16:25:02 KST operator가 미확정 정지와 정리를 완료했다. **방 off·Muse 잠금 true·검증 직전6명 멤버 토글 동일·정상 service active/drop-in0·진행 중 lease0·이번 grant 회수·관련 전용 Tunnel0·유효 서버 구독0**을 최종 대조했다. 실제 dot 감시 비활성은 사용자 보고이며, 기존 실행의 외부 최종 상태와 구분한다. `.env`·원래10개 digest·키/계정·플러그인·Muse 대화·원래 실패/요청은 보존했다. 실제 Codex/쓰기·새 업무·운영 API 정책 변경·원래 답변 재전송은0이다.

private 증거는 `dot-mcp-d5-resume-20261104/`의 `before.sqlite`, `baseline.json`, `authorization.json`, `acceptance-policy.json`, `stale-tunnel-cleanup.json`, `tunnel-readiness-observed.json`, `live-progress.jsonl`, `dot-page-observations.jsonl`, `live-outcome.json`, `failure-observation.json`, `native-stopped-user-report.json`, `normal-service-restored.json`, `final-cleanup-observed.json`이다. 원문/키·attempt credential을 공개하지 않는다.

문서 변경 후 수락표의 원래50 gate/참조 파일/미완료 유지 검사1개와 로컬 문서 링크104개·`git diff --check`를 확인했다. 제품 소스는 불변이다. PR #45의 앞선 head `a613510`에서 **Node529·Chrome/MCP66·설치 Codex0.165 계약 PASS**를 확인했다. 이 결과를 이후 문서 commit의 CI 결과와 혼동하지 않으며, 현재 전역 Codex0.166·실세션 실행은 별도 UNVERIFIED다.

## 남은 차단과 변경 제안

기존 `dotToolResult`는 같은 payload를 text `content`와 `structuredContent`에 각각 담는다. 원문 자체는 잘리지 않았지만12,000bytes 상한에 두 표현이 함께 포함돼31페이지가 필요했다. 제품 소스를 바꾸지 않은 오프라인 크기 대조에서 **단일 content 표현은 같은 원문16페이지·최대RPC11,937bytes·무손실**이었다. 실제 native 수락/시간 단축은 UNVERIFIED이며 완료로 표시하지 않는다.

[영향·변경량·수락·복귀 검토](../reviews/dot-page-transport-retry-impact-20261104.md)는 기존 요청의 이중 표현을 보존하고 새 요청에만 version을 고정한 단일 표현을 제안한다. 현재 submit 오류 사례는 기존 ‘submit 미실행’ 확인과 다르므로, 서버 영수증0·권한 회수·실행 중단의 별도 확인을 요구하는 소유자 명시 복구도 함께 검토한다. **아직 계획 개정/제품 개발 승인을 받은 것은 아니다.**300초·12,000bytes·단일 실행·예산/승인 경계·원문과 Muse는 유지한다.

완료13개를 보존할 다음 정상 흐름은 dot/Muse 검토2의2개·수정5·종합1·종합검토4·같은 방 후속1로13회다. 새로운 실행 범위는 별도 허용이 필요하다. 남은 이전 요청 상한23회·DeepSeek5회/119,757 보고 토큰을 자동으로 새 실행 승인으로 사용하지 않는다.
