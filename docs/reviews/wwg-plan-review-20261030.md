# WWG 사례와 웹쫀쿠 개발 계획 대조

- 검토일: 2026-10-30 (KST)
- 사용자 자료: [웹쫀쿠 만듬](https://m.dcinside.com/board/ai_utilize/109771), 2026-10-03 23:52:24 게시
- 외부 저장소: [bangak684/WWG](https://github.com/bangak684/WWG)
- 고정 revision: `77b6d227fcfa35b1b3e78ed61351e70c29b380bb`, GitHub commit 시각 2026-10-03 14:05:50 UTC
- 우리 기준 main: `a6112c673fcae3e955975bd550c85439259696ad` (사용자 PR #9 병합)
- 범위: 게시글·외부 README와 관련 소스의 정적 비교. 외부 프로그램·외부 테스트·계정 연결을 실행하지 않았다. 이번 변경은 계획 문서뿐이며 아래 항목은 미구현 제안이다.

## 검토 결론

WWG는 웹 ChatGPT의 도구 호출을 로컬 파일·명령 실행으로 연결하는 MCP 앱이다. 웹쫀쿠의 주제·다중 토커·독립 초안·라운드 재분석·근거·비교를 대신하는 토론 엔진이 아니다. 기존 구현을 유지하며 읽기 자료·권한 수명·실행 관측·기록 보관의 완료 기준을 보강할 가치가 있다.

게시글의 사용 경험과 모델 관련 언급은 작성자 보고로만 취급한다. 이를 계정 지원·모델 가용성·운영 신뢰성의 검증으로 쓰지 않는다. WWG의 개인 MCP 연결 설명으로 우리의 OAuth 두 계정·Extra high·Muse Connector·MCP Events가 검증된 것도 아니다.

외부 소스는 공개 GitHub API로 고정 revision을 읽어 /tmp에서 검토했다. LICENSE는 MIT지만 코드를 가져오거나 의존성을 설치하지 않았다. 이후 코드를 도입할 때는 고정 revision과 라이선스·고지를 별도로 추적한다.

## 실제로 확인한 참고 지점

아래는 소스에서 확인한 설계 경로이며 우리 환경에서 실행 통과를 확인했다는 뜻이 아니다.

| 참고 지점 | 고정 revision의 근거 | 웹쫀쿠에 주는 의미 |
| --- | --- | --- |
| 허용 폴더·플랫폼·도구 상태 조회, 여러 파일 읽기 | [tools.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/tools.ts) | 도구 호출 전에 실제 권한을 조회하고 일반 토론용 자료는 읽기만으로 가져오는 경로 |
| 폴더 권한 회수 시 대기·실행 취소와 idle 대조 | [service.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/service.ts) | 등록 시 검사뿐 아니라 실행·승인·결과 반영 시점의 재검사 필요 |
| 작업에 개별 요청을 연결하고 집계·중지 | [tasks.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/tasks.ts), service.ts | 여러 검증·수정 요청의 부분 실패·중단을 부모 Task와 연결해 표시 |
| 보호 경로·파일 해시·atomic 저장 검사 | [secret-policy.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/secret-policy.ts), [files.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/files.ts) | 승인 여부와 별개인 비밀 경계, 사용자 동시 변경을 덮어쓰지 않는 조건 |
| 허용한 환경 이름만 선택, 분할 출력의 값 가림 | [command-environment.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/command-environment.ts) | provider secret 전달은 계속 금지하고 필요 시 실행 환경·출력 최소화 계약을 별도로 정의 |
| 표시 로그와 내부 receipt 보관 한도·작업 집계 | [log-retention.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/log-retention.ts), [request.ts](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/src/main/request.ts) | 로그 상세를 숨기거나 정리해도 재실행 방지 수명을 별도로 설계해야 함 |
| 전송·저장·삭제 범위 안내 | [PRIVACY.md](https://github.com/bangak684/WWG/blob/77b6d227fcfa35b1b3e78ed61351e70c29b380bb/PRIVACY.md) | 파일·명령 출력이 모델과 로그에 어디까지 남는지 owner가 확인할 수 있어야 함 |

현재 외부 코드의 commandSandbox는 macOS/Windows 경로이며 다른 OS 명령 실행을 거절한다. Ubuntu의 bubblewrap 실행기에 그대로 넣을 수 있다고 판정하지 않는다. 외부 테스트 파일은 읽기만 했으며 PASS라고 기록하지 않는다.

## 기존 기능과 중복되는 부분

scoped MCP 도구, private Tunnel용 stdio 전달기, Discussion/Task/CodexJob 관계, 승인 요청, 개별 job 중단, 완료와 업무 검토의 구분, state·journal·idempotency transaction은 이미 구현·계획돼 있다. 이것들을 새 기능으로 다시 만들지 않는다.

대조한 우리 코드는 `src/http/mcp.ts`, `src/execution/codex.ts`, `src/workspace/store.ts`, `src/workspace/model.ts`, `src/connections/rpc.ts`, `scripts/mcp-stdio.mjs`다. MCP grant는 현재 토의·참여자·도구별 revoked 상태를 가지지만 만료·권한 세대와 이미 접수된 실행의 연동은 없다. executor roots는 등록 시 설정값으로 확인하며 owner의 동적 회수 API는 없다. 이 차이를 아래 제안으로 구체화한다.

## 추가 제안과 완료 기준

우선순위는 이번 검토의 제안이며 기존 WJ 번호를 대체하지 않는다. P0는 실제 파일 변경을 포함하는 실행 MVP-2 전에 확인할 조건, P1은 사용자 기능·운영 보강, P2는 선택 Git Writer 이후 범위다. 실계정 연결·토론 MVP-1을 이 제안 전체의 구현 뒤로 미루지 않는다.

| ID·우선순위 | 계획 추가 | 수용 기준 | 연결할 기존 작업 |
| --- | --- | --- | --- |
| WWG-R1 · P1 | 허용한 로컬 파일을 읽기 전용 토론 자료로 등록 | owner가 선택한 파일·폴더만 조회. 파일별 canonical 경로·원문 해시·수집 시각·크기·발췌 여부를 표시. 같은 자료 snapshot을 전 토커에 배포. 개수·바이트·실제 문맥 예산을 확인하고 초과·변경·보호 파일을 명시적으로 거절. 원문은 private하게 보존하며 파일 수정 권한은 부여하지 않음 | WJ-009/010, 013의 별도 읽기 도구 |
| WWG-R2 · P0 | grant·실행 binding의 만료와 동적 회수 | 새 도구 호출뿐 아니라 dispatch·늦은 승인·결과 수락 전에 scope/version/expiry 확인. 회수된 대기는 실행하지 않음. 이미 실행한 작업은 interrupt 요청·실제 중단·미확정을 구분해 대조. 파일·대화는 삭제하지 않음. 회수와 OAuth 로그아웃·일반 토의 pause를 혼동하지 않음 | WJ-013/014/015 |
| WWG-R3 · P0 | 허용 repo 안의 비밀 경계와 실행 출력 최소화 | 기존 app state·Chrome profile 가림에 더해 repo의 .env*·선택 credential 경로를 별도로 정의. symlink/hardlink·rename·경로 변경과 실제 OS 격리를 fixture/호스트에서 확인. 승인으로 경계를 넓히지 않음. 허용된 일반 소스·필요한 Git·Codex 인증 경로와 구분. 알려진 비밀값의 분할 출력·오류·SSE/MCP/내보내기 노출을 검사 | WJ-014의 실파일 검증 전, WJ-016의 별도 강화 |
| WWG-R4 · P1 | 연결 권한·capability 상태를 owner UI와 scoped MCP에서 조회 | 허용된 토의의 실행 binding·OS·도구 버전·읽기/쓰기/네트워크 정책·연결/승인/실행 상태를 사실대로 표시. 같은 grant의 scope 밖 root·다른 계정·secret은 반환하지 않음. 조회 결과가 권한 생성·확대가 되지 않음. 기존 tools/list·doctor를 확장하고 중복 시스템을 만들지 않음 | WJ-010/013/014 |
| WWG-R5 · P1 | 여러 실행·검사의 요청별 경과와 부분 완료 표시 | 기존 Task→CodexJob→turn/item/활동을 활용해 각 요청의 접수·승인·실행·검사·결과·후속 검토를 연결. 부모와 자식 상태를 구분하고 일부 성공을 전체 완료로 표시하지 않음. 선택 묶음 중단의 대기 취소와 실제 실행 종료를 따로 관측. 순차 실행·단일 작성자 제약 유지 | WJ-014/015; 다중 job 묶음 확장은 최소 MVP-2 뒤 |
| WWG-R6 · P1 | 화면 로그·원문 artifact·중복 방지 기록의 보관 수명 분리 | UI는 cursor/page로 읽고 활성·승인·미확정을 우선 표시. 큰 출력에는 digest·범위·생략 여부·private 원문 참조를 남김. 상세 지우기·archive·재시작 후 같은 request ID가 새 실행으로 바뀌지 않음. 최소 receipt/tombstone 보존 또는 만료 ID 명시 거절. 변경 payload는 충돌. 사용자 대화 자동 삭제 금지 | WJ-007/010/011/014, 로그 정리 기능 활성화 전 |
| WWG-R7 · P2 | 선택 Writer의 여러 파일 변경·충돌 처리 | 계획된 파일 목록·기준 해시와 적용 전 재검사를 기록. 사용자 동시 변경은 덮어쓰지 않음. 새 보호 경로·링크·부분 반영·중단 후 실제 diff를 대조. draft PR까지이며 자동 병합 없음 | WJ-016; 일반 파일 쓰기·셸 MCP를 MVP-1에 추가하지 않음 |

R3은 현재 실행기가 보호 파일을 읽을 수 있음을 실험으로 입증했다는 취약점 판정이 아니다. 현재 코드가 state/profile을 가리는 범위와 repo 비밀 경계를 별도로 명세·검사해야 한다는 정적 검토 결과다. 프로그램에 기존 OS 사용자 권한으로 인증된 Codex 환경이 필요하다는 사실도 숨기지 않는다. WWG의 보호 이름 목록을 전부 복사하면 필요한 Git·인증 경로까지 깨뜨릴 수 있다.

R6은 현재 없는 로그 삭제 기능을 서둘러 만들라는 뜻이 아니다. WWG는 보관 한도 밖 receipt가 사라지면 같은 ID가 다시 실행될 수 있다고 문서화한다. 우리 사용자의 미확정 재전송 금지·지속 대화 보존 요구에 맞춰 더 엄격한 정책을 설계한다. “최근 200/내부 1,000개” 같은 숫자도 그대로 복제하지 않는다. 현재 executor의 일부 긴 출력 .slice 처리에는 원문·생략 메타데이터를 보강할 여지가 있다.

## 그대로 도입하지 않을 내용

- Electron 메뉴 막대·Windows EXE 배포: 현재 목표는 Ubuntu 상시 서버와 Tailnet 웹 클라이언트다.
- 범용 파일 삭제·셸 도구, 전역 자동 승인·자동 병합: 기존 Codex·승인·작업 브랜치 계약을 유지한다. 필요한 읽기 자료 경로부터 분리한다.
- WWG pause의 동작을 그대로 복제: 우리 토의 pause는 다음 발언을 막고, 이미 보낸 원격 실행의 취소는 별도다.
- 시작마다 모든 연결 키를 다시 받는 정책: 개인 서버의 vault·0600 환경 파일과 운영 수명에 맞춰 정한다. inference OAuth·Tunnel runtime key·앱 키·MCP grant는 구분한다.
- package.json의 MCP 2.x만 보고 Events/Connector 지원으로 판정하거나 전면 SDK 교체하지 않는다.
- 특정 모델을 쓰기 위한 도구 연결을 모델 API 사용 권한·모델 목록 검증의 대체로 삼지 않는다.

## 다음 진행과 이번 산출물

현재 우선순위는 별도 GPT 계정·모델·xhigh·DeepSeek·dot·Muse의 실제 토론 검증이다. 그와 독립적으로 P0 실행 경계·회수의 계약/fixture를 준비하되, 실파일 변경 전에 통과해야 한다. 읽기 전용 자료와 capability/로그 UI는 WJ-009/010/013의 후속 보강으로 두고, Writer·다중 실행은 후속 선택 범위를 유지한다.

이번에는 이 검토서와 개발 계획·실행 순서만 변경했다. 서비스 재시작·실계정 호출·권한 변경·외부 코드 실행은 하지 않았다. 문서 링크·변경 경계·기존 사용자 파일 보존을 확인하고 PR로 제출한다. 모든 WWG-R 항목은 계획 반영·미구현이며 기존 자동 검사나 외부 프로젝트의 테스트 존재를 구현 완료로 쓰지 않는다.
