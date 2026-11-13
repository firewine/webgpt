# dot 교차검토 진단 배포·재검증 준비 — 2026-11-14

**현재 판정: PR #66 운영 적용 PASS / 기존 완료5개 보존 PASS / 새 교차검토 NOT_RUN.** 원격 실행 종료를 확인하지 못해 기존 복구 필드에 종료 확인을 입력하지 않았다. 선택형 진단 코드는 배포했고 별도 무효 권한 검사에서만 켰다. 실제 dot 전달기 활성화·새 감시·모델 예약은 아직 없다. 새 로그를 과거 실행의 원인 증거로 표시하지 않는다.

## 승인·배포

사용자는 PR #66 병합 후 서버 적용·진단 기록 활성화·dot 교차검토 재검증과 완료5개 보존을 요청했다. 계획/호스트 변경은 영향·변경량을 먼저 보고하는 조건을 유지했다.

- GitHub 병합 commit `f95e47cdd6cf223eb21e2f6849fce9e18ab3eac8`, 병합시각11월14일08:06:20 KST. 이전 운영 HEAD `5d5c824`에서 fast-forward했다. PR #65의 문서와 #66의 전달기/진단·검사/문서가 포함되며 제품 `src/` 변화0이다.
- 운영 경로 `~/webgpt`, Node24.18.0/npm11.16.0. user service 원래 ExecStart·4090포트·public origin을 유지했다. 다른3000포트 서비스는 변경0이다.
- SQLite 일관 백업과 원래 상태/파일 digest를 private 디렉터리에 보관했다. 추적되지 않은 사용자 파일35개와 병합 경로의 충돌0을 확인하고 보존했다.
- `npm run build` PASS, `systemctl --user restart webjjoku` 후 `active/running`, `/health`의 `ok/workspace/sqlite`를 확인했다. 첫 즉시 health 조회는 재시작 준비 중 연결 거절이었고 이후 정상 응답을 확인했다. 이를 가린 성공 기록으로 대체하지 않는다.
- 동일 소스의 PR CI(870 Node PASS/6 SKIP, 116 browser PASS)는 [PR #66](https://github.com/firewine/webgpt/pull/66)의 선행 근거다. 이번 운영 빌드와 구분하며 실계정 검증 통과로 합산하지 않는다.
- 08:20:55 KST에는 배포 전달기의 `WJ_MCP_TRACE=summary`를 **별도 일회성 프로세스**에만 적용했다. 합성 무효 grant로 운영 `/mcp`의 초기화 인증 거절만 요청했고 HTTP401·start/end 진단2건·동일 RPC id의 오류·정상 프로세스 종료를 확인했다. 실제 권한/계정·구독·모델 호출0이며 합성 파일은 제거했다. 검사 뒤에도 전체 토의 snapshot 동일·새 예약/job0을 재확인했다. 이는 진단 배선 검사이지 native dot 교차검토가 아니다.

## 배포 후 보존 확인

11월14일08:16:31 KST의 읽기 전용 대조에서 다음을 확인했다. private 원문·계정/turn 식별자·자격 증명은 공개하지 않는다.

| 항목 | 결과 |
|---|---|
| 초안5개 | status completed, promptDigest·본문·구조화 reply·receipt hash 모두 동일 |
| 전체 토의 | 배포 전 snapshot과 동일, blocked / dot_reply_unconfirmed |
| 원래 교차검토 | 같은 held request·claim 유지, 서버 reply/receipt 없음, 옛 grant revoked |
| 새 실행 | 모델 예약0·API0·Codex job0·원본 반영0 |
| 운영 상태 | 방off·Chrome 수동 조작 잠금 유지, 임시 service drop-in0 |
| 설정 | `.env`, 원본 user unit, 소유자 비밀번호, API 일일 정책의 digest 동일 |

## 원격 보고와 남은 불확실성

소유자가 기존 dot 감시를 비활성화하고 재확인했다. 당시 실행 보고에는 입력17페이지 확인, 전체 입력 수집 후 검토 출력의 `Warning: truncated output`, 답변 생성/submit 미실행이 남아 있다고 전달했다. 개별 페이지 원본은 확인하지 못했다. 현재 취소 가능한 진행 실행은 식별되지 않았지만 원격 관리 기록의 종료 상태와 이후 전체 호출은 확인할 수 없었다.

따라서 절단은 **원격에서 보고된 중단 사유**이고, 어떤 출력이 어느 한도에서 잘렸는지와 실행 최종 종료는 UNVERIFIED다. 서버에 accepted reply가 없다는 사실은 확인했지만 거절된 제출 시도가 전혀 없었다고 확정하지 않는다.

기존 `retry_after_stop`은 중단/미제출을 확인해야 하고 `retry_after_failed_submit`은 제출 시도 후 중단을 확인해야 한다. 현재 정보를 임의로 어느 확인 필드에도 넣지 않았다. 원래 요청·완료5개·사용량을 그대로 두었다.

## 다음 단계

[종료 미확인 복구 영향안](../reviews/dot-unverified-stop-recovery-impact-20261114.md)은 옛 권한의 결과 반영을 차단한 채 불확실성을 남기는 별도 명시 복구를 제안한다. 승인 전 계획/제품 변경·원래 실패 대조 종료·모델 재호출은 하지 않는다. 새 진단은 다음 허용된 실제1회에서 페이지 반환·submit 도착/오류를 구분하는 용도로만 사용한다.
