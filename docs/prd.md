#Web ChatGPT 자율 개발 환경 구축 명세

목표는 사용자가 웹 ChatGPT에 제품 요구만 전달하면 웹 ChatGPT가 스스로 조사, 설계, 코드 수정, 테스트, 커밋, PR, 자동 병합, 정리까지 완료하는 것이다.

##1. 최종 구조

```text
Web ChatGPT private app
→ OpenAI Secure Tunnel
→ localhost MCP Git writer
→ isolated worktree
→ chatgpt/* branch
→ GitHub PR
→ required checks
→ squash merge
```

웹 ChatGPT에 범용 셸을 노출하지 않는다. 대신 저장소 개발에 필요한 모든 권한을 가진 로컬 MCP writer를 제공한다. 여기서 “모든 권한”은 읽기, 검색, 전체 코드 편집, 테스트, 빌드, 커밋, push, PR 생성·수정, squash merge를 뜻한다.`main`직접 push, force-push, 브랜치 삭제, secret 노출, 저장소 보안·workflow 변경은 허용하지 않는다.

##2. 준비물

-Windows 10/11, macOS 또는 Linux
-Git, Node.js, GitHub CLI`gh`
-OpenAI`tunnel-client`
-대상 저장소의 push·PR·merge 권한이 있는 GitHub token
-Secure Tunnel과 private app을 사용할 수 있는 OpenAI/ChatGPT workspace
-절대 경로로 확인한 저장소 root
-저장소별 실제 검사 명령

조직 저장소라면 GitHub token의 SSO 승인을 끝낸다. GitHub branch protection과 required checks를 사용하는 것을 권장한다.

##3. 저장소 규칙

루트`AGENTS.md`가 없다면 만들고, 있다면 기존 규칙을 보존하면서 아래 계약을 추가한다.

```md
When the Web ChatGPT Git writer app is selected, Web ChatGPT is the primary autonomous coding agent.
It must translate the user's natural-language request into a complete implementation without waiting
for another orchestrator. It must read this file, investigate and reproduce material findings, change
every required source and directly related test, critically inspect the complete diff, run all applicable
checks, fix failures, commit and push only chatgpt/*, create or update a pull request, and squash-merge it
after required checks pass. It must not impose arbitrary file-count or scope limits.
It must never push directly to main, force-push, delete branches, expose secrets, weaken tests,
or modify protected repository, workflow, credential, or writer files.
```

##4. 생성할 로컬 파일과 경로

먼저 OS별 사용자 데이터 디렉터리를`<WEBGPT_HOME>`으로 정한다.

```text
Windows: %LOCALAPPDATA%\WebGPTGitWriter
macOS: ~/Library/Application Support/WebGPTGitWriter
Linux: ${XDG_DATA_HOME:-~/.local/share}/webgpt-git-writer
```

그 아래에 다음 파일을 만든다.

```text
<WEBGPT_HOME>/
server.mjs
writer.config.json
start-writer.ps1 or start-writer.sh
start-tunnel.ps1 or start-tunnel.sh
```

Secure Tunnel profile은`tunnel-client`가 해당 OS에서 지정한 사용자 config 디렉터리에 별도로 둔다.

서비스 등록 파일은 OS의 표준 위치에 별도로 둔다.

```text
Windows: Task Scheduler tasks
macOS: ~/Library/LaunchAgents/*.plist
Linux: ~/.config/systemd/user/*.service
```

writer 코드와 설정을 저장소 안에 두지 않는다. 그래야 writer가 자신이나 자신의 검증 명령을 수정할 수 없다.

##5. MCP writer 계약

`server.mjs`라는 파일명은 임의의 프로젝트 소스 파일을 뜻하지 않는다. 이 문서의 계약에 따라 새로 생성하는 범용 MCP writer 실행 파일이다. 기존 프로젝트의 writer를 재사용하거나 특정 언어, 빌드 도구, 저장소 경로, GitHub 계정 또는 검사 명령을 코드에 하드코딩하면 안 된다. 저장소별 값은 환경 변수와`writer.config.json`으로만 주입한다. 이 조건을 어긴 기존`server.mjs`는 다른 프로젝트에 복사할 수 없다.

Node 표준 라이브러리만 사용하면 같은`server.mjs`를 Windows, macOS, Linux에서 실행할 수 있다. OS 차이는 경로 생성, 임시 디렉터리, secret 조회, 상시 실행 서비스에 한정한다. 명령 실행은`spawnSync(command, args, {shell:false})`를 사용하고 경로 결합은`node:path`, 임시 root는`node:os.tmpdir()`를 사용한다. POSIX 전용 셸 문법,`/tmp`, 드라이브 문자, 경로 구분자를 코드에 하드코딩하지 않는다.

writer는`127.0.0.1:${WRITER_PORT}`에 bind한다.`/health`는`{"ok":true}`,`/mcp`는 JSON-RPC MCP endpoint를 제공한다.

필수 환경 변수:

```text
WRITER_REPO_ROOT absolute repository path
WRITER_WORK_ROOT absolute path under os.tmpdir()
WRITER_PORT unused localhost port
GH_TOKEN GitHub token loaded from the OS credential store
GIT_AUTHOR_NAME required commit author
GIT_AUTHOR_EMAIL required commit email
GITHUB_REPOSITORY owner/repository
DEFAULT_BRANCH normally main
WRITER_CONFIG absolute path to writer.config.json
```

`writer.config.json`에는 저장소별 보호 경로, internal/generated 경로, 검사 suite의 executable·argument array·working directory·timeout을 둔다. writer는 시작할 때 schema를 엄격히 검증하고, 실행 중 이 파일을 수정하지 않는다. 따라서 범용`server.mjs`는 다른 프로젝트에도 그대로 사용할 수 있고 설정만 프로젝트에 맞게 생성한다.

###MCP initialize instructions

`initialize`결과의 top-level`instructions`에 다음 의미를 영문으로 넣는다.

```text
Act as the primary autonomous coding agent, not an advisor. Read origin/<default-branch>/AGENTS.md
before material work. Infer the complete implementation scope from the user's request; never invent
file-count limits. Investigate, reproduce, implement, add direct tests, inspect the full diff critically,
run every applicable check, fix failures, publish or update the PR, and squash-merge after checks pass.
Use repository tools instead of web search for repository state. Do not ask another orchestrator to lead.
```

###MCP tools

다음 도구와 JSON schema를 구현한다.

```text
read_repository_file
{ ref?: string, path: string }

search_repository
{ ref?: string, query: string, path?: string }

start_change
{ taskId: string, baseRef?: string }

apply_patch
{ taskId: string, patch: string }

restore_paths
{ taskId: string, paths: string[] }

inspect_diff
{ taskId: string }

run_checks
{ taskId: string, suites: string[] }

publish_pull_request
{ taskId: string, commitMessage: string, prTitle: string, prBody: string }

discard_change
{ taskId: string }
```

`read_repository_file`,`search_repository`,`inspect_diff`는`readOnlyHint=true`다.`start_change`,`restore_paths`,`run_checks`,`publish_pull_request`는 멱등 호출이어야 한다.`discard_change`만`destructiveHint=true`다. PR publish/merge는`openWorldHint=true`다.

###참조와 경로 제한

-읽기 ref는`origin/<default-branch>`또는`origin/chatgpt/*`만 허용한다.
- `taskId`는`^[a-z0-9][a-z0-9-]{2,48}$`만 허용한다.
-상대 경로만 허용하고`..`, 절대 경로, 역슬래시를 거부한다.
- `.github/`,`AGENTS.md`, writer 파일, credential, package manager lock/config, test/build 설정과 검사 스크립트는 protected path로 둔다.
-보호 경로 목록은 대상 저장소 stack에 맞게 확장하되 제품 소스·직접 테스트를 임의로 제한하지 않는다.

###작업 상태

각 task는`path.join(WRITER_WORK_ROOT, taskId)`worktree와 다른 사용자에게 공개되지 않는`.writer-meta.json`을 가진다. POSIX에서는 mode`0600`을 적용하고 Windows에서는 현재 사용자만 접근 가능한`<WRITER_WORK_ROOT>`ACL을 사용한다.

```json
{
"taskId": "feature-name",
"branch": "chatgpt/feature-name",
"baseRef": "origin/main",
"baseSha": "...",
"checks": null,
"publishedUrl": null,
"createdAt": "..."
}
```

`start_change`절차:

1. `git fetch --prune origin`으로 default branch와`chatgpt/*`만 갱신한다.
2.동일 task가 있으면 metadata를 검증하고 그대로 반환한다.
3.없으면 detached worktree를`baseRef`에서 만든다.
4.필요한 기존 dependency directory는 설정된 경우에만 OS에 맞는 symlink 또는 Windows directory junction으로 연결하고 status와 commit에서 항상 제외한다.

`apply_patch`는`git apply --check --whitespace=error-all`성공 후에만 적용한다. 패치 후 검증 기록을 무효화한다. 발행된 task에도 후속 patch를 허용해 같은 PR을 수정할 수 있어야 한다.

`restore_paths`는 파일 내용을 ChatGPT에 전송하지 않고`git restore --source=<baseSha>`로 지정 파일을 기준 상태로 복원한다. 대형 생성 파일 정정에 사용한다.

`inspect_diff`는 최소한 다음을 별도 필드로 반환한다.

```text
status
changedPaths
stat
diff
diffTruncated
last successful checks
published PR URL
```

대형 단일행 파일 때문에 diff가 잘려도`changedPaths`와`stat`는 절대 잘리지 않아야 한다.

###검사

임의 셸 문자열을 실행하지 않는다. 구축 AI가 저장소 stack을 탐색해 이름 있는 allowlist suite를 만든다.

```text
format-or-diff-check
targeted-unit-tests
typecheck-or-compile
production-build
```

각 suite는 설정에 기록된 executable과 argument array를`spawnSync`로 실행하고 shell을 사용하지 않는다. 사용자가 요청한 변경에 적용 가능한 suite는 모두 통과해야 한다. 마지막 patch나 restore 이후 실행한 검사만 publish 자격으로 인정한다.

production build가 tracked generated output을 덮어쓴다면 검사 직후`git restore --source=HEAD`로 해당 산출물을 복원한다. 검사 명령·설정 파일은 writer가 수정하지 못하게 보호한다.

###Git 인증

모든`git`child process에 다음 환경을 주어 OS credential helper prompt 반복을 막는다.

```text
GIT_TERMINAL_PROMPT=0
GIT_CONFIG_COUNT=2
GIT_CONFIG_KEY_0=credential.helper
GIT_CONFIG_VALUE_0=
GIT_CONFIG_KEY_1=http.https://github.com/.extraheader
GIT_CONFIG_VALUE_1=AUTHORIZATION: basic <base64("x-access-token:" + GH_TOKEN)>
```

토큰과 Authorization header를 log, MCP 응답, 오류 메시지에 출력하지 않는다.

###publish와 자동 병합

1.마지막 변경 뒤 필요한 suite가 모두 성공했는지 검사한다.
2.protected/internal/generated path가 없는지 다시 검사한다.
3. `git diff --check`를 통과시킨다.
4.지정 author로 conventional English commit을 만든다.
5. `HEAD:refs/heads/chatgpt/<taskId>`에만 push한다.
6.동일 head PR이 있으면 재사용하고 없으면 default branch 대상 PR을 만든다.
7. `gh pr merge <branch> --auto --squash`를 실행한다.
8.GitHub auto-merge가 비활성이고 required remote check가 없다면`gh pr merge <branch> --squash`로 즉시 병합한다.
9.required remote check가 있다면 우회하지 말고 성공을 기다린 뒤 병합한다.
10.merge 확인 후 worktree를 제거한다. 실패하면 PR과 worktree를 보존하고 명확한 오류를 반환한다.

`main`직접 push, force-push,`--admin`으로 branch protection 우회, branch 삭제는 구현하지 않는다.

##6. OS credential store

고유`<PREFIX>`를 정하고 GitHub token과 tunnel runtime key를 평문 파일이 아닌 OS credential store에 저장한다.

###Windows

Windows Credential Manager를 사용한다. PowerShell의 SecretManagement 모듈을 설치하고 기본 vault 또는 Credential Manager extension을 등록한다.

```powershell
Install-Module Microsoft.PowerShell.SecretManagement -Scope CurrentUser
Register-SecretVault -Name WebGPT -ModuleName Microsoft.PowerShell.SecretStore -DefaultVault
Set-Secret -Name '<PREFIX>-github-token' -Secret (gh auth token)
Set-Secret -Name '<PREFIX>-tunnel-runtime' -Secret '<OPENAI_SECURE_TUNNEL_RUNTIME_KEY>'
```

조직 정책상 SecretStore를 사용할 수 없으면 Windows Credential Manager용 검증된 PowerShell module을 사용한다. DPAPI 암호문을 직접 설계하지 않는다.

Task Scheduler에서 UI 없이 조회할 수 있는 current-user vault를 선택하고, 로그인 후 예약 작업에서 secret 조회가 prompt 없이 성공하는지 검증한다. 기본 SecretStore의 잠금 정책이 이를 막는다면 Credential Manager extension처럼 비대화형 조회를 지원하는 vault로 교체한다.

###macOS

```sh
securityadd-generic-password -U -a "$USER" -s '<PREFIX>-github-token' \
-w "$(ghauth token)"

securityadd-generic-password -U -a "$USER" -s '<PREFIX>-tunnel-runtime' \
-w '<OPENAI_SECURE_TUNNEL_RUNTIME_KEY>'
```

###Linux

Secret Service API를 제공하는 GNOME Keyring, KWallet 또는 호환 vault와`secret-tool`을 사용한다.

```sh
printf'%s' "$(ghauth token)" |secret-toolstore --label='WebGPT GitHub token' service '<PREFIX>-github-token'
printf'%s' '<OPENAI_SECURE_TUNNEL_RUNTIME_KEY>' |secret-toolstore --label='WebGPT tunnel runtime' service '<PREFIX>-tunnel-runtime'
```

토큰은 저장소, 문서, service definition, YAML, prompt, log에 넣지 않는다.

##7. writer 실행과 상시 서비스

모든 OS에서 시작 프로세스는 credential store에서 secret을 읽어 환경 변수로만 전달하고 writer를 foreground로 실행한다.

###Windows PowerShell

`start-writer.ps1`:

```powershell
$ErrorActionPreference = 'Stop'
$env:GH_TOKEN = Get-Secret -Name '<PREFIX>-github-token' -AsPlainText
$env:WRITER_REPO_ROOT = '<ABSOLUTE_REPOSITORY_PATH>'
$env:WRITER_WORK_ROOT = Join-Path ([System.IO.Path]::GetTempPath()) '<PREFIX>-writer\worktrees'
$env:WRITER_PORT = '<LOCAL_WRITER_PORT>'
$env:GIT_AUTHOR_NAME = '<AUTHOR_NAME>'
$env:GIT_AUTHOR_EMAIL = '<AUTHOR_EMAIL>'
$env:GITHUB_REPOSITORY = '<OWNER/REPOSITORY>'
$env:DEFAULT_BRANCH = 'main'
$env:WRITER_CONFIG = '<WEBGPT_HOME>\writer.config.json'
& node '<WEBGPT_HOME>\server.mjs'
exit $LASTEXITCODE
```

Task Scheduler에 로그인 시 실행, 실패 시 재시작, 중복 실행 금지로 writer task를 등록한다. GUI 또는`Register-ScheduledTask`를 사용하고 secret을 task argument에 넣지 않는다.

###macOS/Linux shell

`start-writer.sh`의 공통 골격:

```sh
#!/bin/sh
set -eu
export WRITER_REPO_ROOT='<ABSOLUTE_REPOSITORY_PATH>'
export WRITER_WORK_ROOT='<OS_TEMP_DIRECTORY>/<PREFIX>-writer/worktrees'
export WRITER_PORT='<LOCAL_WRITER_PORT>'
export GIT_AUTHOR_NAME='<AUTHOR_NAME>'
export GIT_AUTHOR_EMAIL='<AUTHOR_EMAIL>'
export GITHUB_REPOSITORY='<OWNER/REPOSITORY>'
export DEFAULT_BRANCH='main'
export WRITER_CONFIG='<WEBGPT_HOME>/writer.config.json'

# macOS:
export GH_TOKEN="$(security find-generic-password -a "$USER" -s '<PREFIX>-github-token' -w)"
# Linux에서는 위 줄 대신:
# export GH_TOKEN="$(secret-tool lookup service '<PREFIX>-github-token')"

exec node '<WEBGPT_HOME>/server.mjs'
```

macOS는 LaunchAgent의`RunAtLoad=true`,`KeepAlive=true`로 실행한다. Linux는 systemd user service의`ExecStart`,`Restart=on-failure`,`WantedBy=default.target`을 사용한다. 서비스 환경의`PATH`에 Node, Git,`gh`,`tunnel-client`절대 경로가 포함됐는지 검증한다.

```sh
curl-fsS "http://127.0.0.1:<LOCAL_WRITER_PORT>/health"
```

##8. Secure Tunnel

OpenAI Platform에서 Secure Tunnel을 생성하고 사용할 ChatGPT workspace에 연결한다. tunnel ID와 runtime key를 발급받는다.`tunnel-client`는 OpenAI 화면이 안내하는 공식 binary를 설치한다.

OpenAI 화면 또는 설치된`tunnel-client`가 안내하는 사용자 config 디렉터리에`webgpt-writer`라는 profile로 다음 설정을 저장한다. config 디렉터리 위치는 client와 OS 버전에 따라 다르므로`<WEBGPT_HOME>`경로를 임의의 CLI 옵션으로 전달하지 않는다.

```yaml
config_version: 1
control_plane:
base_url: "https://api.openai.com"
tunnel_id: "<TUNNEL_ID>"
api_key: "env:CONTROL_PLANE_API_KEY"
health:
listen_addr: "127.0.0.1:<LOCAL_TUNNEL_HEALTH_PORT>"
admin_ui:
open_browser: false
log:
level: info
format: json
mcp:
server_urls:
- channel: main
url: "http://127.0.0.1:<LOCAL_WRITER_PORT>/mcp"
```

터널 시작 스크립트도 OS credential store에서 runtime key를 읽어`CONTROL_PLANE_API_KEY`로 전달한 뒤 foreground로 실행한다.

Windows PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
$env:CONTROL_PLANE_API_KEY = Get-Secret -Name '<PREFIX>-tunnel-runtime' -AsPlainText
& tunnel-client run --profile webgpt-writer
exit $LASTEXITCODE
```

macOS/Linux shell:

```sh
#!/bin/sh
set -eu
# macOS:
export CONTROL_PLANE_API_KEY="$(security find-generic-password -a "$USER" -s '<PREFIX>-tunnel-runtime' -w)"
# Linux에서는 위 줄 대신 secret-tool lookup을 사용한다.
exec tunnel-client run --profile webgpt-writer
```

writer와 동일하게 Windows Task Scheduler, macOS LaunchAgent 또는 Linux systemd user service로 상시 실행한다.

```sh
curl-fsS "http://127.0.0.1:<LOCAL_TUNNEL_HEALTH_PORT>/readyz"
```

##9. ChatGPT private app

ChatGPT 앱/플러그인 관리 화면에서 private app을 만들고 Secure Tunnel connection을 선택한다. 공개 URL, GitHub token, OS credential-store secret을 ChatGPT에 입력하지 않는다.

새 대화에서 앱을 선택하고 첫 쓰기 동작 승인창에서`항상 허용`을 선택한다. ChatGPT가 승인을 대화 단위로 관리하면 새 대화마다 최초 한 번은 다시 나타날 수 있다. 로컬 writer가 플랫폼 승인창을 허위 annotation으로 우회해서는 안 된다.

앱 연결 후 사용자는 제품 요구만 말한다.

```text
로그인 세션 만료 버그를 재현하고 양 배포판에서 고쳐. 직접 테스트하고 PR로 반영해.
```

별도 파일 수 제한, 단계별 지시, orchestrator prompt를 추가하지 않는다.

##10. 합격 검증

구축 AI는 예제 기능 하나를 실제로 개발시켜 end-to-end로 증명한다.

```sh
curl-fsS "http://127.0.0.1:<LOCAL_WRITER_PORT>/health"
curl-fsS "http://127.0.0.1:<LOCAL_TUNNEL_HEALTH_PORT>/readyz"
ghpr view chatgpt/<task-id> --repo <OWNER/REPOSITORY> \
--json url,state,files,commits,autoMergeRequest,mergeStateStatus
```

반드시 확인할 것:

-웹 ChatGPT가`AGENTS.md`를 스스로 읽음
-인위적 파일 수 제한 없이 완전한 구현 범위를 선택함
-제품 소스와 직접 테스트를 실제 수정함
-관련 검사 실패를 스스로 수정함
-커밋 author가 지정값과 정확히 일치함
- `chatgpt/*`외 push가 없음
-PR에 secret, writer 파일, 생성 산출물이 없음
-required checks 성공 후 squash merge됨
-병합 전`main`직접 수정이 없음
-merge 후 worktree와 유휴 세션이 제거됨
-연속 fetch/push에서 OS credential prompt가 반복되지 않음

##11. 현실적인 한계

이 구성은 웹 ChatGPT에 개발 workflow 전체를 맡긴다. 모델의 판단 품질 자체를 다른 모델과 수학적으로 동일하게 만들 수는 없으므로`AGENTS.md`, 직접 테스트, allowlist 검사, diff 검토, branch protection이 품질 게이트다. 플랫폼의 최초`항상 허용`확인도 로컬 코드만으로 영구 제거할 수 없다.
