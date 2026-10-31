# 페이즈 8 — DeepSeek High·상주방 준비 / 2026-10-31

사용자가 DeepSeek Max를 High로 변경하고 상주방 설정을 승인한 뒤 초기 운영값으로 **“표준”**을 선택했다. **방 생성·멤버/역할 배치·표준 예산/속도 저장 완료, 방 off**다. 새 모델 호출은0이며 실계정 상주 전체 수락을 완료로 표시하지 않는다. [원문 없는 설정·보존·실제 UI 검사 수치](./assets/r8-resident-setup-20261031/summary.json)를 함께 본다.

## 수행·증거

- 기존 DB online backup과 원래 `.env`를 private 0600 파일로 보존하고 승인·idempotency key·기존 토의 해시를 private journal에 기록했다.
- 기존 owner participant API로 현재 등록된 CoralBricks DeepSeek 토커의 `reasoningEffort`만 **high**로 변경했다. 출력 설정 부재/기본4,096과 기존 GPT xhigh는 유지했다. 과거 토의의 member/turn에 남은 Max/출력16,384 기록은 소급 수정하지 않았다.
- `.env`의 `WJ_RESIDENT_ENABLED`만 true로 추가하고 **18:46:38 KST**에 webjjoku 서비스를 재시작했다. 기존 origin/포트4090·접속 키·계정/vault·Chrome profile·다른 서비스 설정은 그대로다.
- 기존 additive resident-v1 이관으로 방1개를 off 상태로 생성하고 기존 GPT2계정+CoralBricks3명만 발언 참여로 배치했다. 모의/기존 browser 참여자는 비활성이다. 3명 모두 같은 specialist 역할·analysis 종류·해당 room scope만 부여했다. Codex binding/실행 권한은 추가하지 않았다.
- SQLite 읽기 전용 대조에서 기존 모든 토의 해시·다른 전역 토커·browser 수동 잠금·job/binding과 `.env`의 다른 내용이 보존됐다. resident turn/모델 호출0, 활성 멤버3·분석 seat3이다.
- 별도 읽기 전용 Chrome156으로 실제 private HTTPS의1440/390px에서 High 표시·3명 참여·off·새로고침 보존·overflow/JS 오류0을 확인했다. GET만 허용했으며 POST/외부 요청0, 대화 원문·화면 이미지 내보내기0이다.

제품 src/Providers·Store·예산·승인·단일 dispatch·원래50 gate는 바꾸지 않았다. 이 운영 설정에는 새 빌드/코드 검사가 필요하지 않았으며 기존 PR #30의 Node328·브라우저52·Codex schema CI 결과와 이번 실제 표시 검사를 구분한다.

## 사용자가 선택한 초기 표준 설정

처음에는 예산/속도를 null로 두었고 사용자의 표준 선택을 받은 뒤 기존 configure API로 다음 값을 저장했다. U1/U2의 이번 초기 방 설정 선택이며 모든 미래 방의 기본값이나 자동 갱신 정책을 확정한 것은 아니다.

| 항목 | 저장 값 |
| --- | --- |
| 초기 시간 창 | 저장 시각부터60분, **2026-10-31 20:07:03 KST** 종료 |
| 누적 요청 | 24회 |
| 보고 token | 200,000 |
| 발언 최소 간격 | 30초 |
| 조용할 때 재확인 | 5분 |
| pass 후 대기 | 2분 |
| 연속 pass 휴면 | 3회 |
| 도구 실행 한도 | 0 |
| 자동 주제 시작 | false |

토큰 예산은 보고 사용량 합산 후 다음 요청을 막는 soft limit이므로 한 요청에서 초과할 수 있다. 시간은 현재 API의 절대 deadline이며 방 켜기 시 자동으로60분을 다시 주지 않는다. 만료됐으면 방 off에서 사용자가 종료 시각을 갱신해야 한다. 설정 저장 후 재조회·실제 설정 dialog에서 요청24/토큰200,000/간격30초/idle300초/pass120초/휴면3회와 종료 시각·자동 주제off를 확인했다. 새로고침·390px·High/3멤버/off 검사도 통과했다. 방 켜기·실계정 상주 호출은 이번에 실행하지 않았다.

복귀가 필요하면 방 off·turn/lease/receipt 대조 뒤 feature flag를 되돌리고 재시작한다. resident 상태·기존 토의/실패·command/event를 지우거나 사전 DB로 덮어쓰지 않는다. 실제 rollback은 NOT_RUN이다.
