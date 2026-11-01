# 개인 소유자 비밀번호 로그인 — 2026-11-01 승인 범위

사용자가 개인용 비밀번호 설정, 첫 화면의 새 비밀번호/바로 아래 동일 비밀번호 확인, 서버의 보호된 저장, 이후 접속 기기에서 비밀번호 입력을 명시했다. 이 지시를 변경 승인으로 삼고 구현 전에 범위/후속 영향을 기록한다. 기준은 PR #32 병합 main `5605982`, 예상18~24파일·700~1,200줄이다.

## 동작과 최소 변경

- 최초 설정은 세로로 새 비밀번호/비밀번호 확인2칸. 일치할 때만 저장한다. 이후 로그인은 비밀번호1칸이며 별도 사용자명/회원가입은 없다. 실제 비밀번호는 사용자가 자기 브라우저에서 입력하며 개발자가 정하거나 채팅으로 받지 않는다.
- 서버는 salt와 scrypt 해시만 기존 private SQLite state에 저장한다. Node 내장 scrypt N=2^17/r=8/p=1, salt32바이트·키64바이트, 비밀번호15~128 Unicode 문자·공백 허용·잘라내기/trim 없음. [OWASP 저장 지침](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [인증 지침](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)을 대조했다. 원문/확인값은 DB·event·command·로그·브라우저 저장소에 남기지 않는다.
- 최초 소유자 선점 방지: 현재 유효한 소유자 세션 또는 서버 터미널의 명시 `password:setup`으로 발급한10분/1회 링크에서만 첫 비밀번호를 정한다. 이미 로그인한 소유자는 두 칸을 바로 입력한다. 링크 비밀은 fragment로 전달하고 즉시 주소에서 제거한다. 접속자 아무나 빈 설정을 선점하거나 proxy loopback을 소유자라고 판단하지 않는다.
- 변경은 현재 비밀번호 재확인, 분실 복구는 서버 터미널 `password:reset`의 별도1회 링크를 사용한다. 설정/변경/복구는 credential 세대를 바꿔 이전 cookie와 오래된 링크를 폐기하고 현재 기기의 새 cookie만 발급한다. 기존12시간·HttpOnly/SameSite/Secure·실패 제한·Host/Origin은 유지한다.
- 기존 소유자 access-token은 ops/readiness와 자동화의 Bearer/기존 API 호환·복구용으로 보존한다. 웹 화면에서는 직접 입력하지 않는다. provider OAuth·API key·MCP grant와 섞거나 다른 scope에 복사하지 않는다.

## 경계와 후속 영향

`model.ts::WorkspaceState`의 optional ownerPassword/passwordSetup와 session credentialId, 신규 제안 `workspace/password.ts`의 해시/validator, 기존 Access/Workspace 초기 검증·HTTP 경계를 사용한다. 해시·setup grant·session 갱신은 기존 Store transaction에서 원자적으로 저장하며 새 DB/계정 서비스/인증 의존성을 추가하지 않는다. 느린 해시는 비동기 수행하고 동시 계산을 제한한다.

R1은 기존 state/원문/계정과 additive 이관·손상/future 알고리즘 거절, R2는 로그인 만료/재로그인이 provider 재전송/방 on으로 이어지지 않음, R3는2칸/1칸·일치 검사·390px·새로고침·자동완성, R4는 provider 로그인과 분리, R5/R6/R7은 role/승인/MCP·Wiki 경계 유지, R8은 인증/CSRF/추측 제한·설정 경합·recovery·전체 회귀를 검사한다. 기존50 gate나 API/도구 한도 정책을 바꾸지 않는다.

수락: 원문/확인값 저장0, 모르는 사용자의 첫 설정/변경/재설정0, 소유자 setup1회·중복/만료 링크 거절, 올바른 비밀번호만 cookie 발급·12시간/로그아웃/세대 폐기, 다른2탭의 선행 설정을 덮어쓰기0, signup/login UI가 실제 계정/모델을 호출0, 전체 Node/Chromium/MCP·기존35 사용자 파일 보존. 비밀번호 저장 전에 검토하고 실제 등록은 사용자 직접 수행한다. 새 코드 배포·서비스 재시작/방 on·실계정 모델 호출은 이번 개발과 별도다.

복귀는 G0 off·진행/미확정 대조 뒤 읽기 전용/flag off로 하며 ownerPassword·원래 DB/키·계정·credential 세대를 지우지 않는다. 비밀번호를 모르는 상태에서 삭제/DB 복원으로 우회하지 않고 서버의 명시 재설정 경로를 쓴다.

[구현·검사 기록](../implementation/password-login-20261101.md)에 결과와 운영 NOT_RUN을 별도로 남겼다.
