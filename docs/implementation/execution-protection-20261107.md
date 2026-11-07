# 추천3 — 실행 보호 착수와 기존 MCP 회수 오류 수정

상태: **기존 회수 계약 오류 수정 / 새 권한 수명·보호 사본·원문 계약은 승인 대기.** 사용자의 “병합했어 3번 개발”로 착수했다. 기준은 PR #55 병합 main `f3384cc8d98f5f71c81bd94fdddba37ee40b83dc`, 별도 작업 브랜치 `codex/execution-protection-20261107`이다. 전체 추천3/R6 쓰기 수락을 완료로 표시하지 않는다.

## 기존 계약 안에서 수정한 오류

`src/http/workspace.ts`의 `/mcp`는 요청 헤더에서 grant를 인증한 뒤 body를 기다린다. 이 사이 owner가 일반 discussion grant를 회수하면 `McpEndpoint.handle`은 예전 객체를 계속 사용했다. resident/dot 경로에는 별도 현재 권한 검사와 만료가 있으며 이번 수정은 그 계약을 바꾸지 않는다.

`src/http/mcp.ts::McpEndpoint.checkGrant`로 현재 Store의 id/hash/토의/참여자/tools/회수 상태를 대조한다. 처리 진입과 결과 반환, 비동기 capability/cancel 뒤, 결과 기록 transaction 안에서 재검사한다. Store.transact는 같은 command의 이전 영수증을 callback 없이 돌려줄 수 있으므로 진입·재사용 전에도 권한을 검사한다. 권한이 사라진 요청의 공개 결과/부작용을 막고 기존 `mcp_authentication_required`/401 경계를 사용한다.

새 endpoint·grant/binding 필드·만료 기본값·DB/schema/이관·provider 인터페이스·역할·budget·제품 UI 변경0이다. 기존 Store transaction/명령 영수증·MCP adapter를 재사용하는 작은 guard이며 새 인증 시스템을 만들지 않는다. 과거 발급 token·실제 운영 DB를 변경한 것은 아니다.

공통 권한 대조 함수 하나를 기존 adapter 안에서 호출하는 방식으로 중복을 줄였다. 별도 인증 서비스나 추상 계층 없이 Store의 현재 상태를 사용하며, 외부 비동기 작업과 transaction/cached receipt 경계에서만 재검사한다.

## 재현과 검사

`tests/mcp-authority-recheck.test.mjs`는 임시 DB/HTTP fixture만 사용한다. 실제 계정/모델·사용자 Codex 세션 호출0이다.

- 이미 인증한 객체를 owner가 폐기한 뒤 tools/list와8개 도구를 호출해 새 결과/조회/명령·취소0을 확인.
- 동일 result_submit의 기존 영수증은 유효할 때만 재사용, 회수 후 재조회 거절·보고1개 유지.
- 현재 grant의 hash/토의/참여자/tools가 바뀌면 예전 객체 사용 거절·새 결과0.
- 결과 기록 transaction 직전 회수 경쟁에서 기록0.
- 비동기 capability 조회 대기 중 회수하면 반환 자료를 노출하지 않음.
- 실제 HTTP 요청 본문을 나눠 전송해 인증 뒤 대기를 확인하고, 별도 owner 회수 후 나머지 body를 보내면401·새 evidence/job0.

`npm run check`의 strict TypeScript·빌드와 Node 검사 **655개 PASS, FAIL0·SKIP0**를 확인했다. 신규6개는 위 재현/경쟁 검사이며 전체649개 기존 검사도 함께 통과했다. UI/모델 응답을 실제 계정 수락으로 대신하지 않는다. 제품 UI 변경이 없어 브라우저 검사는 별도로 반복하지 않았다.

## 추천3의 계약 변경 제안과 남은 작업

[후속 영향·변경량 검토](../reviews/execution-protection-impact-20261107.md)는 미승인 제안이다. 일반 권한/binding 만료·회수와 legacy 처리, private 출력/페이지 조회, 보호 사본·소유자 diff 확인/기존 텍스트1파일 반영은 공개·영속/실행 계약을 구체화해야 해 기존 사전 승인 규칙에 따라 질문했다. 기존 plan/SSOT의 수락·쓰기를 먼저 바꾸지 않는다.

Node24.18.0/npm11.16.0/Codex0.166.0 설치 schema 검사는 PASS이며 실제 login/thread/model turn은0이다. bubblewrap0.11.1의 PID/network namespace·procfs/읽기 전용 mount 합성 검사는 성공했지만 실제 사용자 Codex 파일 변경은 NOT_RUN이다. 개별 파일 가림은 나중에 생성된 보호 파일을 숨기지 못하는 합성 결과를 남겼다. 이 때문에 기존 `work_write_safety_unverified` 차단은 그대로 유지한다.

운영 서버·`.env`·대화 DB·계정/접속 키·Chrome profile·API 한도·사용자 untracked 파일은 변경하지 않았다. 실제 모델/사용자 Codex 호출·운영 적용·계약 변경 승인과 혼동하지 않는다. artifact/로그 보관 정리·archive/삭제·다중 실행·Git Writer·자동 병합은 추가하지 않았다.

## 복귀

이번 작은 수정은 기존 필드/DB를 그대로 사용한다. G0의 진행/미확정 대조 후 이전 binary로 복귀할 수 있지만, 그 경우 기존 회수 경쟁 문제가 다시 생긴다는 한계를 남긴다. 원래 기록·명령 영수증·grant를 삭제하거나 새 발급으로 문제를 숨기지 않는다. 전체 추천3의 새 이관/복귀·쓰기 허용은 위 미승인 제안과 별도다.
