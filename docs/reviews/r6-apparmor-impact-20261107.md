# R6 AppArmor 보완 — 적용 전 영향·변경량·실검증 제안

상태: **2026-11-07 사용자 “예외 승인” / 전용 설치·실제 결합 보호 PASS, 실제 모델 job0/NOT_RUN.** 승인 전에는 조사·정적 정책 검사만 수행했다. 아래는 승인 당시의 제안이며 이후 실측·선행 조건 차단은 [구현 기록](../implementation/r6-apparmor-20261107.md)에 구분해 남겼다.

사용자 요청: “머지 완료. AppArmor 문제부터 해결하고 R6 실환경 검증까지 이어가자. 계획이나 호스트 설정 변경이 필요하면 영향과 변경량부터 보고해.” 기존 [계획 변경 절차](../development-guidelines.md)를 유지한다. 이 문서는 승인용 검토안이며 구현 완료 기록이 아니다.

## 1. 확인한 상태와 원인

| 항목 | 실제 관측 |
| --- | --- |
| 코드 기준 | PR #57 MERGED, main `436fbc45b4a2900a8a3f6e088c9fc6977e682d3e`. 새 작업 브랜치 `codex/r6-apparmor-review-20261107` |
| 운영 | `/home/firewine/webgpt`, `ops/dot-mcp-d5-gpt-once-20261104`, HEAD `f648ea5`(PR #54). tracked 변경 없음, 기존 untracked 자료 보존 |
| 앱·서비스 | `127.0.0.1:4090/health` 정상, user service active. `NoNewPrivileges=yes`, AppArmor label `unconfined` |
| 도구·호스트 | Ubuntu26.04.1 LTS, Node24.18.0/npm11.16.0, Codex0.166.0, bubblewrap0.11.1, AppArmor parser5.0.2 |
| 기존 경계 | `kernel.apparmor_restrict_unprivileged_userns=1`; `/usr/bin/bwrap` root:root4755; stock `bwrap-userns-restrict`의 자식 `unpriv_bwrap`은 capability를 명시 거절 |
| 실제 재현 | 운영과 같은 `NoNewPrivileges` 조건에서 합성 combined proof도 `host_namespace_unavailable`로 SKIP. 커널 로그에 `profile="unpriv_bwrap"`, `capname="sys_admin"`, `DENIED` 관측 |
| 운영 데이터 | binding0/job0, 방 off, 방 tool job 한도0, 허용 root `[]`, Chrome 수동 잠금. API 정책8회/200,000 보고 토큰. 변경하지 않음 |

재현 명령은 실제 사용자 thread/모델/credential을 사용하지 않는다.

```bash
setpriv --no-new-privs node --test --test-reporter=spec \
  --test-name-pattern='full runtime proof is mandatory' tests/execution-isolation.test.mjs
```

현재 [ExecutionIsolation.context/wrap/probe](../../src/execution/isolation.ts)는 외부 bwrap으로 사본을 원래 cwd에 씌운 뒤 내부 Codex named profile로 도구 접근을 제한한다. 외부 bwrap의 자식에 stock capability 거절이 붙어 내부 격리를 만들지 못한다. 이는 개발 도구 안에서만 재현되는 현상이 아니며, 개별 외부/내부 PASS를 결합 PASS로 바꿀 수 없다.

근거: [Ubuntu AppArmor 문서](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/), [AppArmor upstream bwrap 정책](https://gitlab.com/apparmor/apparmor/-/blob/master/profiles/apparmor/profiles/extras/bwrap-userns-restrict). 실제 판단은 설치 정책·현재 커널 로그·실행 검사로 한다.

## 2. 권장 변경과 대안

**웹쫀쿠의 신뢰된 외부 실행기에만 전용 bwrap 경로/프로필을 추가한다.** 내부 Codex 도구는 계속 `/usr/bin/bwrap`과 stock 최종 자식 제한을 사용한다. 전용 실행기를 공통 PATH에 넣지 않는다. DB·provider·Chrome/dot/Muse·승인 API는 재작성하지 않는다.

| 안 | 판정·영향 |
| --- | --- |
| 전용 외부 실행기 + 새 AppArmor attachment | 권장. 기존 stock 파일을 수정하지 않고 앱별로 허용. 실제 NNP/profile 전환·최종 도구 차단은 **UNVERIFIED**, 다음 절의 합성 증명이 먼저 필요 |
| 전역 sysctl 또는 stock `unpriv_bwrap`의 capability 거절 완화 | 기각. 다른 앱과 모든 bwrap 자식에 영향. 명시 deny는 local allow를 더하는 방식으로도 해결되지 않음 |
| 격리 해제·full-access·검사 SKIP을 성공으로 간주 | 기각. PR #57의 사본/비밀/원본 경계를 무너뜨림 |
| 외부 사본 경계를 없애거나 실행 broker를 새로 작성 | 이번에는 보류. 인증/원본 파일/늦은 파일 노출 계약까지 바뀌며 변경량이 더 큼 |

새 정책은 외부 신뢰 실행 프로세스와 신뢰된 App Server가 namespace capability를 사용할 수 있게 한다. 기존 App Server 자식의 blanket capability 거절을 최종 모델 도구 단계까지 늦추는 **신뢰 경계 변경**이다. 기존 보호를 전부 같은 위치에 유지하는 변경이라고 주장하지 않는다. 이 경로를 실행할 수 있는 동일 OS 사용자에게도 예외가 적용되므로, **웹쫀쿠 이름만 붙이면 위험이 없는 변경이라고 주장하지 않는다.** root 소유·사용자 그룹 실행 제한·setuid/file capability 없음·실제 최종 도구 부정 검사로 범위를 제한한다. 권한을 얻는 것은 root 권한이 아니라 user namespace 안의 capability다.

## 3. 호스트 적용 대상 — 승인 전 변경0

| 대상 | 제안 변경 | 복귀 |
| --- | --- | --- |
| `/usr/local/libexec/webjjoku/bwrap` (신규) | 설치된 stock binary와 같은 바이트를 root:firewine0750으로 복사. setuid/file capability 없음. 부모 디렉터리는 root 소유, 사용자 쓰기 금지 | 진행 중 실행0 확인 후 전용 binary만 제거 |
| `/etc/apparmor.d/webjjoku-outer-bwrap` (신규) | 전용 경로 attachment만 enforce로 로드. 시스템 전체 reload/disable은 하지 않음 | 새 프로필만 unload한 뒤 그 파일 제거 |
| 앱 설정 `WJ_OUTER_BWRAP` (제안) | 지정한 절대 경로를 외부 격리에만 사용. canonical/root 소유/부모 쓰기 금지·동일 패키지 digest·실제 proof 확인 | 설정 제거 후 기존 경로 사용. 검사가 실패하면 WRITE는 차단 |
| 운영 `.env` / 서비스 unit | 우선 변경하지 않음. 별도 실검증 인스턴스에만 위 값과 테스트 root 지정. 운영 반영은 변경 PR 병합 후 별도 확인 | 운영 프로세스·원래 포트/설정 그대로 |

새 디렉터리가 필요하면 root 소유로 생성한다. 기존 대상 파일이 있으면 덮어쓰지 않고 중단한다. `/usr/bin/bwrap`, stock AppArmor 정책, 전역 sysctl, Chrome/Tailscale/3000 포트에는 쓰지 않는다. 패키지 업데이트로 원본 binary digest가 달라지면 전용 사본을 자동 신뢰하지 않고 재설치/검사 전 쓰기를 차단한다.

검토용 정책 초안은 `/tmp/webjjoku-r6-outer-bwrap.candidate.apparmor`에 준비했고 다음 명령은 exit0이었다. **커널 로드·운영 효과·격리 성공은 검증하지 않았다.**

```bash
apparmor_parser --skip-kernel-load --skip-cache \
  /tmp/webjjoku-r6-outer-bwrap.candidate.apparmor
```

검토 중 NNP 전환에서 outer label을 잃지 않도록 초안을 보정했고, **보정본도 위 정적 컴파일 exit0**이다. 핵심 규칙은 다음과 같다. stock 외부 정책처럼 신뢰된 App Server까지 곧바로 `unpriv_bwrap`으로 강제하지 않는다.

```apparmor
allow pix /** -> &webjjoku_outer_bwrap,
allow Px /usr/bin/bwrap -> webjjoku_outer_bwrap//&bwrap,
deny /usr/local/libexec/webjjoku/bwrap x,
```

예상 label은 외부→`webjjoku_outer_bwrap`, 내부 setup→outer+stock bwrap, 최종 모델 도구→outer+stock bwrap+unpriv_bwrap다. 이 초안만으로 실제 전환 성공을 단정하지 않는다. stock 내부 실행 파일 고정·동적 로더 환경 정리·label 대조·최종 도구의 capability/전용 launcher 실행 거절 검사까지 추가한다. 실제 label·부정 검사에 실패하면 정책을 적용한 채 실계정 실행으로 넘어가지 않는다. App Server의 capability 거절까지 유지하려는 controller/setup 분리안도 검토했으나 NNP에서 그 권한 전환 자체가 가능한지는 **UNVERIFIED**여서 이번 권장안의 검증된 대안으로 제시하지 않는다.

관리자 인증은 현재 필요하다(`sudo -n`으로 인증 불가 확인). 승인 후 검토 가능한 설치 스크립트를 준비해 사용자 Ubuntu 터미널에서 실행하도록 안내한다. 비밀번호는 채팅으로 받지 않는다.

## 4. 코드·계획 변경량과 후속 영향

**예상 전체 12~18파일·500~900줄**(검사·운영 절차·기록 포함). 호스트 신규 파일2개와 필요한 root 소유 디렉터리, 전용 검증 환경만 추가한다. 실제 범위가 이 경계를 넘으면 사유·증가량을 다시 보고한다.

| 단계 | 대상·변경 | 계약·마이그레이션 | 수락·되돌리기 |
| --- | --- | --- | --- |
| A 실행기 선택/검사 | 기존 `src/workspace/config.ts::WorkspaceConfig/loadWorkspaceConfig`, `runtime.ts::Workspace`, `execution/codex.ts::CodexExecutor`, `isolation.ts::ExecutionIsolation.context/wrap/probe`. 설정/CLI/tool identity 검사·외부 실행기 선택만 추가 | 기존 complete/Store/권한/사본/승인 계약 유지. DB 변경 없음. 미설정 경로는 기존 동작 | 유효/손상/교체/권한/불일치 경로 검사, 내부는 stock 유지. 새 옵션 제거 시 기존 fail-closed 경로 |
| B 전용 설치/합성 증명 | 설치 스크립트·정책 template **제안**, 격리/설치 회귀 검사, `.env.example`·운영 절차 | 신규 root attachment는 승인 후에만 설치. 기존 전역 정책 유지 | 전체 combined proof SKIP0/PASS; 원본·state·Chrome·auth·proc/fd·network 유출0, 사본 변경만 성공. 최종 도구가 전용 launcher로 권한을 되얻지 못하는 검사 포함. 실패하면 새 프로필만 복구 |
| C R6 실검증/문서 | 실검증 helper **제안**, SSOT·sequence·R6 구현 기록/수락 증거 | 기존 작업큐→attempt→job link→report→독립 검토 경로 사용. 새 제품 페이즈/수락 완화 없음 | 아래 실행 범위·실제 receipt로 판정. 종료 후 검증 권한 회수·프로세스 정리, 원문/기록 보존 |

| 후속 페이즈 | 영향 |
| --- | --- |
| R1 데이터 | DB schema/transaction 변경 없음, 기존 protection marker 유지 |
| R2 상주 | 공통 단일 실행/방 off·예산 계약 유지. 운영 방을 켜지 않고 별도 검증 상태 사용 |
| R3 GUI | 기존 실행 상세·diff·명시 반영/원문 페이지 재사용. 새로운 디자인 변경 없음 |
| R4 연결 | GPT/DeepSeek·dot/Muse와 OAuth/Chrome 연결 유지. 새 로그인 방식 추가 없음 |
| R5 업무 큐 | 기존 업무→실행 link→보고/반려/재작업 검증. bypass한 executor 호출만으로 R6를 완료하지 않음 |
| R6 실행 | 호스트 결합 proof와 실제2개 job이 이번 대상. 보호 job의 추가 권한 ACCEPT 차단 유지 |
| R7 Wiki | 저장/편집/인용 계약 변경 없음. 이번 실행으로 Wiki/자율 AI 리뷰까지 완료했다고 표시하지 않음 |
| R8 수락/운영 | 실제 증거가 있는 항목만 갱신. 전체 혼합 토의·장기 운영·자동 AI 재평가 수락은 별도 |

## 5. 제안하는 R6 실환경 검증 범위

승인된 변경의 CI/검토와 합성 결합 proof 이후에만 실제 계정을 사용한다. 새 보호 경로를 운영에 곧바로 배포하는 대신 같은 Ubuntu에 독립 검증 인스턴스를 사용한다. HTTP가 필요하면 실제 빈 loopback 포트를 확인하고 지정하며 외부 Serve 설정은 바꾸지 않는다.

- 검증 루트 **제안**: `/home/firewine/.local/share/webjjoku-r6-validation/20261107/`. 기존 경로가 있으면 재사용/초기화하지 않고 중단한다. 그 아래 normal Git repo·private app state·전용 Codex home·Chrome placeholder를 분리한다.
- 대상은 normal Git repo의 `r6-validation` 브랜치, 기존 `validation.txt` 하나. baseline `R6_BASELINE\n` → 허용 변경 `R6_VERIFIED\n`. 제품 저장소/기존 대화 파일에는 쓰지 않는다. Git baseline commit은 fixture 준비이며 실행의 자동 commit/push/merge가 아니다.
- 기존 Codex 인증 중 실행에 필요한 최소 자료만 private 전용 home에 준비하고 세션 이력은 복사하지 않는다. 인증 내용은 출력/문서화하지 않는다. 원래 Codex home·운영 state·Chrome profile은 읽기 전용 job에서도 명시 mask한다.
- 설치 CLI0.166.0에서 무호출 `thread/start`와 다른 프로세스의 `thread/read`로 새 빈 thread handoff를 확인한다. 현재 앱/사용자 thread는 연결하지 않는다. 빈 thread가 영속되지 않으면 모델 호출 전에 중단한다. CLI/RPC가 지원하지 않는 경로를 임의로 추가하지 않는다.
- **실제 Codex 모델 job 최대2회, 총30분, 각 job300초**. 총시간이 만료되면 새 dispatch0. 원래 job의 중단·최종 상태를 대조하며 자동 재호출하지 않는다. 기존 CLI 구독/한도를 사용하며 다른 API 제공처·dot·Muse·웹 GPT 호출은0회다.
- 첫 job은 텍스트 읽기와 의존성 없는 짧은 검사. 실제 command approval이 오면 명령/cwd/원래 approval ID를 확인해 소유자에게 제시한다. 승인 이벤트가 없으면 그 항목은 UNVERIFIED로 남긴다.
- 첫 보고를 소유자가 반려해 같은 업무의 후속 수정으로 진행한다. idle 상태에서 readonly binding을 회수/재등록해 쓰기 권한을 고정한다. 두 번째 job은 사본의 기존 파일1개만 변경한다. 보호 job의 추가 permission ACCEPT가 필요하면 거절/중단하고 차단 근거를 남긴다.
- 실제 완료/capture complete/diff pending을 확인한 뒤 **정확한 diff와 digest를 소유자에게 제시해 원본 반영을 별도 승인**받는다. 승인된 파일1개에 한 번만 반영하고 전후 hash·branch/HEAD/mode·receipt를 대조한다. 내용이 예상과 다르면 자동 반영0이다.
- 업무→attempt→link→실제 command/exit→보고/반려/후속→독립 owner 검토까지 증거를 모은다. 검토자는 실제 사용자이며 에이전트가 사용자 검토를 했다고 대신 기록하지 않는다. AI 자율 재검토는 이번 예산/수락에 포함하지 않는다.
- 종료 후 검증 binding/grant 회수, 실제 실행 없음·원문 보관·temporary credential 제거를 확인한다. 기존 운영 DB/방/API 한도/Chrome 잠금은 그대로 둔다. 공개 문서는 비밀·원문 없이 상태/digest/검사 결과만 남긴다.

R6-F의 모든 요구가 실제로 관측되지 않으면 부분 PASS/NOT_RUN/BLOCKED를 분리한다. 두 번을 소진한 뒤 누락 증거를 위해 세 번째 모델 요청을 자동 시작하지 않는다. 추가 session 기능·보호 permission ACCEPT·다른 제공처 호출·한도 확대가 필요하면 영향·변경량을 먼저 보고한다.

## 6. 큰 리스크와 승인할 항목

1. **프로필 전환**: 구문 검사는 통과했지만 실제 NNP stacking·최종 도구 차단은 UNVERIFIED다. root 설치 뒤 합성 검사부터 수행하고 실패하면 실계정0회로 중단한다.
2. **OS/도구 변경**: binary 업데이트·정책 unload/교체 뒤 오래된 proof를 신뢰하지 않도록 identity를 검사한다. 전용 사본의 갱신·롤백 책임이 추가된다.
3. **실제 세션/승인 지원**: 새 thread handoff·보호 추가 권한 승인이 실패할 수 있다. 기존 사용자 세션 대체·full-access·자동 재전송으로 우회하지 않고 실제 수락을 보류한다.

**승인 기록:** 사용자가 위 제안에 “예외 승인”으로 전용 호스트 정책/외부 실행기 변경을 허용했다. 최초 요청의 R6 실환경 검증은 합성 보호 증명 이후 위2회/30분 범위로 이어간다. 소스 변경은 작업 브랜치/PR로 제출하고 병합은 사용자가 수행한다. 최종 파일 반영·실제 command 승인·owner 독립 검토는 구체 결과를 제시한 뒤 필요한 시점에 받는다.
