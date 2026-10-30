# 로컬 참고자료와 권한 현황

- 날짜: 2026-10-30 (KST)
- 기준 main: `00c736402151cb2a8dd0a7de8b9e8971a932c450` (사용자 PR #10 병합)
- 작업 브랜치: `codex/local-materials-capabilities-20261030`
- 범위: WWG-R1 읽기 전용 자료와 WWG-R4 권한 현황. GPT OAuth는 사용자가 귀가 후 진행하기로 했으므로 인증을 요청하거나 모델 호출을 시작하지 않았다.
- 판정: 구현·자동 검사·실제 HTTPS UI PASS. 실계정 모델에 사용자 파일 전달·혼합 토론·실제 Codex job은 NOT_RUN.

## 동작과 경계

`WJ_MATERIAL_ROOTS`는 기본 빈 배열이며 Codex 실행 허용 경로와 별개다. Owner만 `POST /api/materials/list`로 지정 폴더를 조회하고 `POST /api/materials`로 명시적으로 선택한 UTF-8 파일을 수집한다. 폴더 재귀 수집·임의 파일 쓰기 도구는 없다. UI에서 자료 패키지를 선택하면 새 토의에만 첨부된다.

파일 최대 32 KiB, 토의당 합계 64 KiB·8개, 폴더 탐색 최대 100항목이다. 초과·비 UTF-8·제어 문자·특수 파일은 명시적으로 거절한다. 보호 경로는 앱 state·Chrome profile, /proc·/sys·/dev, .env*·.git·.ssh·.codex·인증 파일/키 이름 등이다. 일반 문서 내용의 모든 비밀을 탐지하는 기능은 아니다. 자료의 외부 AI 전달·private DB/백업/내보내기 보관 범위를 UI와 운영 문서에 안내한다.

Linux의 /proc/self/fd와 `O_NOFOLLOW`를 사용해 열린 디렉터리 inode에서 다음 경로 요소를 연다. allowlist root와 모든 중간 요소의 symlink를 거절하고 hardlink는 `nlink !== 1`에서 거절한다. 파일 descriptor의 dev/ino/size/mtimeNs/ctimeNs/nlink를 읽기 전후 및 전체 경로 재오픈 후 비교한다. UTF-8 BOM·개행을 포함한 원문 그대로 raw SHA-256·시각·크기·절대 경로·발췌 없음 표시를 private SQLite에 저장한다. 경로 전체의 링크를 거절하므로 지원하는 경로는 정규화된 절대 경로와 실제 경로가 같다.

토의 생성 transaction에서 선택한 모든 패키지를 다시 읽어 identity·해시·현재 allowlist를 검사한다. 바뀌거나 없어진 파일은 첨부를 거절하고 수집 당시 사본을 몰래 갱신하지 않는다. 생성 후에는 고정 원문을 공통 `user_material` evidence로 모든 토커와 후속 revision에 전달한다. 이 observed는 파일 수집의 관측이며 내용 속 주장의 검증 성공이 아니다. 초기 prompt의 실제 직렬화 길이도 180,000자 한도를 확인하고 후속 prompt+개인 history의 기존 한도를 유지한다.

자료·event·idempotency 결과는 같은 SQLite transaction에 보존한다. 같은 request ID는 원본이 변경된 뒤에도 기존 수집 결과를 반환하고 다른 payload는 충돌한다. `/api/state`는 원문·내부 파일 identity를 제외한 메타데이터만 반환한다. 선택한 토의에는 원문을 보존한다. 자동 삭제·동적 allowlist 변경·범용 셸·쓰기 권한은 추가하지 않았다.

`GET /api/capabilities`와 owner 화면은 OS·Node·Codex·bubblewrap·Chrome MCP 버전, 전역 허용 경로, 연결·binding·job·승인 대기 상태와 설정 정책을 표시한다. 새 scoped MCP 도구 `capabilities_get`은 토의·참여자 범위와 허용 도구만 반환한다. pending task가 없어도 조회 가능하지만 scope 밖 계정·root·binding·job·thread·실행/승인 본문은 반환하지 않는다. Codex 도구가 없는 grant는 실행 binding/job을 볼 수 없다. 도구별 실제 호출 가능 여부도 반환하고 조회 자체가 권한을 추가하지 않는다. 버전 조회 뒤 grant 폐기 여부를 재검사한다. 기존 grant의 목록은 자동 확대하지 않는다.

설치 버전 관측은 실제 연결·모델 응답·namespace 성공이 아니다. App Server의 인증용 host network와 명령 sandbox의 network 금지 정책을 구분한다. Node로 실행되는 실제 MCP 설정을 확인하면서 첫 번째 실행 파일의 Node 버전을 MCP 버전으로 표시하는 오류를 발견·수정했다. 절대 JS launcher이면 `node script --version`을 사용하고 판독할 수 없는 wrapper는 unknown, 실행 실패는 unavailable이다. 임의 설정 인자나 provider secret을 버전 probe에 전달하지 않는다.

## 수행 증거

| 항목 | 판정·범위 |
| --- | --- |
| 호스트 도구 | Node 24.18.0, npm 11.16.0, 실제 Google Chrome 156.0.8078.47, Codex 0.165.0, bubblewrap 0.11.1, Chrome MCP 1.12.0 |
| strict TypeScript·빌드·Node | `npm run check`: 53 PASS / 0 FAIL / 0 SKIP |
| 실제 Chrome/MCP | 시스템 Chrome·설치 MCP 경로를 사용한 browser 검사: 9 PASS / 0 FAIL / 0 SKIP |
| 파일 경계 | 기본 권한 없음·개별 파일 allowlist·범위 밖·..·leaf/ancestor/root symlink·hardlink·FIFO·디렉터리·보호 이름/state fixture 거절 |
| 파일 내용·예산 | BOM/CRLF 원문·raw digest 일치, 바이트·파일 수·aggregate·직렬화 prompt 한도·binary/invalid UTF-8 거절 |
| 변경과 보존 | 바뀐/교체된 원본 첨부 거절, 실패 시 토의 생성 없음, 같은 ID 재수집 없음·payload 충돌, 토의 시작 후 변경에도 모든 토커·revision 동일 원문, DB 재오픈 사본 보존 |
| 권한 조회 | owner 인증 필수, 버전 probe 관측·unknown/unavailable, 조회 전후 권한/state/event 동일, MCP 타 계정/root/job·명령 출력 비공개, 도구 미부여/폐기 거절 |
| 브라우저 UI | 폴더 탐색→파일 선택→저장→메타데이터→새로고침→첨부 토의→원문 evidence→권한 확인, 1440/390px 가로 잘림 없음, 자료 HTML은 실행하지 않음 |
| 실제 HTTPS | 앱 health·소유자 로그인·권한 화면·실제 버전·1440/390px PASS. 같은 서버 headless browser의 private HTTPS 접근이며 다른 Tailnet 기기 검증은 아님 |
| 기존 데이터 | 적용 전후 connection 2개·participant 3개·discussion 2개와 내용 hash 동일, event cursor 100 유지, .env hash 동일 |
| 기존 Muse | 앱 재시작 후 URL·thread·identity·ready 일치, busy=false, MCP page 매핑 변경 없음, 요청 전송 없음 |
| 사용자 파일 | 기존 untracked 35개 파일 hash 변화 없음 |
| 실계정 inference·Codex 실행 | NOT_RUN. OAuth는 auth_required, Muse 기존 토의 blocked 유지, 실행 binding/job 없음 |

첫 sandbox 내부 전체 검사에서 소켓/프로세스 제약으로 파일 단위 실패를 관측해 Ubuntu 권한으로 재실행했다. 이후 버전 파싱 오류를 고치고 최종 소스에서 위 전체 검사와 browser 검사를 통과했다. SKIP을 PASS로 세지 않았다.

첫 PR CI의 browser 단계에서 자료 저장 응답보다 SSE 목록 갱신이 먼저 시작되면 자동 선택이 빠지는 오류를 발견했다. 저장한 자료 ID를 보류하고 실제 목록 렌더링 때 선택하도록 고쳤다. browser fixture는 state 응답을 의도적으로 보류하고 자료 저장 응답을 먼저 완료해 같은 순서를 재현한다. 타임아웃을 늘려 통과시키는 방식은 사용하지 않았다.

## 실제 서비스 반영

반영 직전 prepared/running/unconfirmed turn=0, queued/running/approval/reconciling job=0 및 OAuth callback listener 없음 확인. `npm run backup`으로 private SQLite `backups/2026-10-30T04-28-00.429Z.sqlite`를 생성했다. 이 운영 백업은 provider token을 제외하므로 복구 시 해당 계정은 재연결해야 한다. 앱 `webjjoku.service`만 재시작하고 desktop·Chrome profile·3000의 다른 서비스·Tailscale 설정은 변경하지 않았다. 운영 포트 4090·HTTPS 8443을 유지한다.

실제 환경의 `WJ_MATERIAL_ROOTS`는 기본 빈 배열이다. 배포 과정에서 사용자 파일 경로를 임의로 허용하거나 가져오지 않았다. 실제 자료 모델 전달은 사용자가 허용 경로·첨부·참여자를 선택한 뒤 별도 검증한다. 기존 blocked 토의는 자동 재개하지 않았다. 실행기의 권한 수명/동적 회수·repo secret 경계(R2/R3), 요청 집계/로그 artifact(R5/R6), Writer(R7)는 이번 구현에 포함하지 않으며 실파일 Codex 변경 전에 필요한 조건을 그대로 유지한다.

검토용 PR로 제출하며 병합은 사용자 담당이다.
