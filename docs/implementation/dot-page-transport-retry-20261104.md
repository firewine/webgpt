# dot 단일 페이지 표현·submit 오류 복구 — 2026-11-04

## 기준과 승인 범위

제품 기준 main `f3a2e34026c37c2bff52e194678b3de795c84d62`, 문서 기준 `7d60da0`에서 사용자가 [사전 영향안 A+B](../reviews/dot-page-transport-retry-impact-20261104.md)의 계획 개정·개발을 승인했다. D3 조회/복구·D4 안내·D5 검사를 보완하며 신규 phase는 없다. 아래 구현은 fixture/회귀 검사와 실제 수락을 구분한다. 서버 적용·추가 실계정 호출은 포함하지 않는다.

최종 변경은 제품6·검사6·문서7의19개 파일이다. 예상 상한18개보다 문서1개가 추가된 것은 실검증 기록의 ‘미승인’ 문장을 이후 승인/구현 이력으로 연결한 보정이며 제품 범위는 같다. 기존 순수 페이지 helper·요청 snapshot·복구 guard·Store transaction과 UI modal을 재사용하고 새 전송/복구 프레임워크를 추가하지 않았다.

## 구현 계약

- `DotRequest.inputTransportVersion?:2`를 새 요청 생성 transaction에서 고정한다. 없는 기존 요청은 기존 이중 표현·원래 페이지 계산을 유지한다. SQL 이관/backfill0, 알 수 없는 버전은 거절한다.
- v2 paged get만 같은 JSON을 text `content`에 한 번 담는다. 페이지 `transportVersion:2`를 포함하며 metadata/claim/submit·legacy full get의 이중 응답은 유지한다. 도구 입력 schema·이벤트 필터·로그인/키/Tunnel을 추가 변경하지 않는다.
- 코드 포인트 단위 무손실 원문·canonical inputDigest·고정 request/attempt·조회0 writes·receipt/재시작에도 같은 페이지·RPC12,000bytes·모든 페이지 읽기·300초를 유지한다. 모델 이해/사실 검증을 페이지 조회 성공만으로 판정하지 않는다.
- `retry_after_failed_submit`은 `stoppedAfterFailedSubmit:true`·사유·원래 grant 회수와 기존 순수 scope/input/receipt/lease guard를 요구한다. 서버 결과가 이미 저장됐다면 transport 오류가 있어도 재시도를 거절한다.
- 복구는 원래 turn에 `owner_confirmed_retry_after_failed_submit`을 남기고 같은 task만 pending으로 둔다. 감사 event는 `submitAttempted:true`, `serverReceiptAbsent:true`, `stoppedWithoutSubmit:false`·이전 오류/사유를 보존한다. 기존 submit 미실행 경로와 구분하며 별도 resume 전 전송0이다.
- UI의 원본과 복구에 별도 `제출 오류 후 재시도 준비`를 추가한다. 외부 실행 중단과 추가 제출 없음·사유를 직접 확인하게 하며 기존 답변/영수증을 먼저 대조하도록 안내한다.

## 검사·실제 수락

| 범위 | 상태·완료 증거 |
| --- | --- |
| v1/v2 합성 원문 분할·동일 digest·Unicode/escape·RPC 크기·legacy envelope | **PASS**: 전송 전용12개 검사. escape/한글/제어문자/서로게이트 합성140,458bytes는80→41페이지·최대RPC11,937bytes(200자 RPC id 포함). 기존 record의 dual 응답·같은 페이지 경계/무손실·알 수 없는 버전 거절 확인 |
| 권한/영수증/중단 확인·같은 과제 새 요청·늦은 old submit 차단·명령 반복 | **PASS**: 독립 오류 확인·사유/원래 권한 회수 누락 거절, 기존 결과/receipt 거절, scope/입력/경쟁 lease 검사, 같은 명령20회 후 과제 준비1번·전송0. 현재 권한 재연결·별도 resume 뒤 원래 과제의 새 결과1개 수락 |
| 실제 SIGKILL 뒤 복구 준비 보존·자동 재전송0 | **PASS**: submit 오류 복구 transaction 직후 강제 종료·재시작. 원래 실패/새 준비 상태·idempotency 보존, 원래 명령20회 재확인해 재전송0 |
| 실제 Chromium의 별도 확인 UI·확인/사유 누락0요청·별도 resume | **PASS**: 기존 미실행 UI와 별도 오류 UI, 필수 확인/사유 없이 요청0·검사 뒤 pending/blocked·새 모델 호출0. 같은 방/기록/Muse 합성 회귀 포함 |
| 전체 Node·설치 Chrome MCP 브라우저 회귀 | **PASS**: `npm run check` — strict TypeScript/빌드·Node553. 설치 Chromium156.0.8078.4·Chrome DevTools MCP1.12.0 지정 `npm run test:browser` —67 PASS·FAIL0·SKIP0 |
| 현재 설치 Codex 요청 규격 | **PASS**: 절대 실행 파일을 지정한 `npm run test:codex-contract`, CLI0.166.0의 실제 App Server 생성 schema. 로그인/thread/모델·실제 명령 실행0 |
| 실제 native v2 입력·submit 오류 복구·남은 혼합 토의 | **NOT_RUN**. 현재 운영 코드/요청/원래13개 답변은 변경하지 않음 |

private137,805bytes 원문의 사전 크기 projection은31→16페이지·최대RPC11,937bytes·무손실이었다. 이는 구현/실제 native 성공을 대신하지 않는다. 공개 검사에는 비공개 원문 대신 합성 입력만 사용한다.

검사는 독립 worktree에서 기존 설치 의존성을 임시 연결해 수행했다. Node 최초 검사에서 새 SIGKILL fixture의 재호출 JSON 키 순서가 원래 명령과 달라 idempotency 충돌1건이 발생했다. fixture 입력을 같게 고친 후 전체553개가 통과했다. 브라우저 최초 실행은 Playwright 기본 headless 경로가 없어 시작하지 못했으며, 이미 설치된 Chromium 절대 경로를 지정해67개 전부 통과했다. 이 환경 실패를 제품 실패나 SKIP으로 세지 않는다. Codex0.165의 과거 CI 계약과 현재0.166 요청 schema 결과도 구분한다.

검사 로그는 `/tmp/webjjoku-dot-transport-check.log`, `/tmp/webjjoku-dot-transport-browser.log`, `/tmp/webjjoku-dot-transport-codex-contract.log`다. 이 로그는 실제 계정/원문이 없는 fixture 결과이며, 비공개 운영 DB/원래 답변을 검사 데이터로 사용하지 않았다.

## 복귀와 남은 수락

기존 완료13개·미확정1개·원래 실패/요청/원문과 Muse thread를 유지한다. 승인된 이번 변경으로 운영 복구나 모델 호출을 자동 수행하지 않는다. 기존 API 일일 정책·단일 실행·Human/Codex 승인·도구 권한을 확대하지 않는다.

되돌릴 때는 기존 G0에 따라 방 off·진행/미확정 대조·claim/권한 정리 뒤 이전 배포로 돌아간다. 진행 중인 v2 요청을 v1 경계로 바꾸지 않는다. 기존 row/optional field를 삭제하거나 오래된 DB로 현재 응답을 덮어쓰지 않는다. 실제 배포/검증은 사용자 병합과 별도 승인 범위를 따른다.
