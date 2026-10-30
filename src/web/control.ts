import type { Connection, Member, Discussion, ExecutionBinding, CodexJob, DurableEvent, Phase, MaterialPackage } from '../workspace/model.js';
type Snapshot = { cursor: number; connections: Connection[]; participants: Member[]; discussions: Pick<Discussion, 'id' | 'topic' | 'status' | 'phase' | 'revision' | 'createdAt' | 'updatedAt'>[];
  bindings: ExecutionBinding[]; jobs: CodexJob[]; browserPaused: boolean; grants: { id: string; participantId: string; discussionId: string; revoked: boolean; tools: string[] }[];
  capabilities: { sourceFetch: boolean; browserConfigured: boolean; noVncConfigured: boolean; codexConfigured: boolean };
  materialPackages: { id: string; label: string; createdAt: string; files: Omit<MaterialPackage['files'][number], 'text' | 'identity'>[] }[]; materialRoots: string[] };
type View = 'discussion' | 'connections' | 'execution';
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let state: Snapshot | null = null; let current: Discussion | null = null; let selected = localStorage.getItem('wj.discussion') ?? '';
let tab = 'timeline'; let view: View = 'discussion'; let stream: EventSource | null = null;
const effortOptions = [{ value: 'low', label: 'Low · 낮음' }, { value: 'medium', label: 'Medium · 보통' }, { value: 'high', label: 'High · 높음' }, { value: 'xhigh', label: 'Extra high · 매우 높음' }];
function effortLabel(value: string): string { return effortOptions.find(o => o.value === value)?.label ?? value; }
let cursor = 0; let refreshing = false; let again = false; let timer = 0; let choiceSignature = ''; let noticeTimer = 0;
let materialSignature = '';
let pendingMaterialSelection: string | null = null;
const phases: Record<Phase, string> = { independent: '초기안', cross_review: '상호 검토', verification: '검증', revision: '수정안', synthesis: '종합', summary_review: '종합안 검토' };
const states: Record<string, string> = { running: '진행 중', paused: '일시정지', blocked: '확인 필요', completed: '완료', partial: '부분 완료', cancelled: '취소',
  prepared: '전송 준비', pending: '대기', failed: '실패', unconfirmed: '결과 미확인', stale: '이전 조건의 응답', connected: '연결됨', auth_required: '로그인 필요', unverified: '미확인', error: '연결 오류',
  observed: '자료 관측됨', reported: '참여자 보고', not_run: '미실행', queued: '실행 대기', blocked_approval: '승인 대기', reconciling: '실행 확인 필요', interrupted: '중단됨', ready: '준비됨', fixture: '모의', not_applicable: '해당 없음', waiting: '대기' };
const errors: Record<string, string> = { authentication_required: '접속 키를 확인해 주세요.', root_workflow_busy: '진행 중인 토의를 먼저 완료하거나 취소해 주세요.', two_participants_required: '참여자를 2명 이상 선택해 주세요.',
  material_path_not_allowed: '서버의 WJ_MATERIAL_ROOTS에서 허용한 파일·폴더만 읽을 수 있습니다.', material_path_protected: '인증 정보와 보호 파일은 참고 자료로 읽을 수 없습니다.', material_changed: '파일이 수집 후 변경됐습니다. 새 자료로 다시 읽어 주세요.', material_path_unavailable_or_link: '파일이 없거나 읽을 수 없는 링크 경로입니다.', material_regular_unlinked_file_required: '일반 파일만 지원하며 하드링크는 허용하지 않습니다.', material_file_too_large: '파일 하나는 32 KiB 이하여야 합니다.', material_package_too_large: '한 토의의 로컬 자료는 최대 8개 파일, 합계 64 KiB입니다.', material_context_budget_exceeded: '참고 자료를 포함한 입력이 문맥 한도를 넘습니다. 파일 수나 내용을 줄여 주세요.', material_utf8_required: 'UTF-8 텍스트 파일만 첨부할 수 있습니다.', material_text_required: '바이너리 또는 제어 문자가 있는 파일은 첨부할 수 없습니다.', material_directory_too_large: '항목이 100개 이하인 폴더를 선택해 주세요.', material_directory_required: '탐색할 폴더의 경로를 입력해 주세요.',
  invalid_reasoning_effort: '지원하는 사고 깊이 값을 선택해 주세요.', reasoning_effort_not_supported: '선택한 모델이 이 사고 깊이를 지원하지 않습니다. 설정을 바꾼 뒤 이어가세요.', reasoning_requires_oauth: '사고 깊이 요청 설정은 OAuth GPT 토커에 적용됩니다. 기존 dot·Muse는 해당 서비스에서 설정하세요.', participant_settings_require_pause: '일시정지 후 현재 응답이 확정되면 사고 깊이를 바꿀 수 있습니다.', oauth_account_mismatch: '선택한 로그인 계정이 지정한 계정과 다릅니다. 웹 GPT용 계정으로 로그인해 주세요.', isolated_login_unavailable: '현재 Chrome 도구가 분리된 로그인 공간을 지원하지 않습니다. 도구 설정을 확인해 주세요.',
  connection_not_ready: '먼저 연결과 모델 목록을 확인해 주세요.', browser_not_configured: '서버의 Chrome 연결 명령을 설정해 주세요.', browser_manual_control: 'Chrome 수동 조작을 마친 뒤 자동 입력을 재개해 주세요.',
  browser_turn_active: '진행 중인 Chrome 응답이 끝난 뒤 수동 조작을 시작할 수 있습니다.', browser_target_mismatch: '대화 주소 또는 계정 식별 문구가 일치하지 않습니다.',
  browser_selectors_invalid: '실제 입력란과 전송 버튼 선택자를 확인해 주세요.', browser_not_ready: 'Chrome 대화가 응답 가능한 상태인지 확인해 주세요.',
  reconciliation_required: '미확인 응답이나 실행 결과를 먼저 대조해 주세요.', workspace_not_allowed: '서버에서 허용한 작업 경로 안의 디렉터리를 등록해 주세요.',
  session_target_mismatch: 'Codex 세션의 작업 경로·호스트·사용자가 일치하지 않습니다.', feature_branch_required: '파일 수정은 작업 브랜치에서만 허용됩니다.',
  existing_browser_context_preserved: '기존 dot·Muse 대화의 문맥은 자동 교체하지 않습니다.', revision_conflict: '다른 변경이 반영됐습니다. 새 상태에서 다시 시도해 주세요.',
  context_limit_requires_handoff: '문맥이 길어졌습니다. 원본과 복구에서 체크포인트를 적용해 주세요.', source_fetch_disabled: '서버에서 공개 출처 조회가 꺼져 있습니다.',
  checkpoint_requires_selection: '체크포인트가 허용 크기를 넘었습니다. 기존 문맥은 보존됩니다. 원본을 내려받아 확인해 주세요.', session_busy: 'Codex 세션에 실행 중인 작업이 있습니다.',
  rpc_disconnected: '도구 연결이 끊겼습니다. 실행 결과를 확인한 후 다시 진행해 주세요.', rpc_unconfirmed: '도구 응답이 미확인입니다. 자동으로 재전송하지 않았습니다.',
  request_unconfirmed: '요청 결과를 확인하지 못했습니다. 기록을 새로 확인해 주세요. 자동으로 재전송하지 않았습니다.', procedure_completed: '토의 절차가 완료되었습니다.', budget_exhausted: '설정한 진행 한도에 도달했습니다.',
  participant_excluded: '일부 참여자를 제외한 결과입니다.', user_cancelled: '사용자가 토의를 취소했습니다.', partial_unstructured_reply: '일부 응답의 형식을 확인하지 못했습니다.' };
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; }
function button(text: string, action: () => Promise<unknown> | unknown, className = ''): HTMLButtonElement {
  const n = node('button', text, className); n.type = 'button'; n.addEventListener('click', () => { n.disabled = true; void Promise.resolve().then(action).catch(report).finally(() => { n.disabled = false; }); }); return n;
}
function badge(value: string): HTMLElement { return node('span', states[value] ?? value, `badge ${['failed', 'error'].includes(value) ? 'error' : ['blocked', 'unconfirmed', 'auth_required', 'not_run', 'partial', 'blocked_approval', 'reconciling'].includes(value) ? 'warning' : ''}`); }
function announce(text: string, error = false): void { clearTimeout(noticeTimer); const n = $('#notice'); n.textContent = text; n.className = `notice${error ? ' error' : ''}`; n.hidden = false; noticeTimer = window.setTimeout(() => { n.hidden = true; }, error ? 15000 : 6500); }
function report(error: unknown): void { const key = error instanceof Error ? error.message : 'request_failed'; announce(errors[key] ?? `처리하지 못했습니다: ${key}`, true); }
async function api<T>(path: string, body?: unknown, requestId = crypto.randomUUID()): Promise<T> {
  let response: Response;
  try { response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }, body: JSON.stringify(body) }); }
  catch { throw new Error('request_unconfirmed'); }
  const result = await response.json() as T & { error?: { code: string } };
  if (!response.ok) { if (response.status === 401) lock(); throw new Error(result.error?.code ?? 'request_failed'); }
  return result;
}
function lock(): void { stream?.close(); stream = null; $('#login').hidden = false; $('#workspace').hidden = true; }
function form(id: string, handler: (data: Record<string, string>, form: HTMLFormElement) => Promise<unknown>): void {
  $(id).addEventListener('submit', event => { event.preventDefault(); const el = event.currentTarget as HTMLFormElement; const submit = el.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])'); if (submit) submit.disabled = true;
    const data = Object.fromEntries(new FormData(el).entries()) as Record<string, string>;
    void handler(data, el).catch(report).finally(() => { if (submit) submit.disabled = false; }); });
}
function showView(next: View): void { view = next; for (const id of ['discussion', 'connections', 'execution']) $(`#view-${id}`).hidden = id !== next;
  for (const el of document.querySelectorAll<HTMLElement>('[data-view]')) el.classList.toggle('selected', el.dataset.view === next); }
function connect(): void {
  stream?.close(); stream = new EventSource(`/api/events?after=${cursor}`);
  stream.addEventListener('open', () => { $('#connection-status').textContent = '● 실시간 연결'; $('#connection-status').classList.add('online'); scheduleRefresh(); });
  stream.addEventListener('error', () => { $('#connection-status').textContent = '재연결 중 · 작업은 유지'; $('#connection-status').classList.remove('online'); });
  stream.addEventListener('change', event => { const e = JSON.parse((event as MessageEvent<string>).data) as DurableEvent;
    if (e.id <= cursor) return; cursor = e.id; scheduleRefresh(); });
}
function scheduleRefresh(): void { if (timer) return; timer = window.setTimeout(() => { timer = 0; void refresh().catch(report); }, 250); }
async function refresh(): Promise<void> {
  if (refreshing) { again = true; return; } refreshing = true;
  try {
    state = await api<Snapshot>('/api/state'); cursor = Math.max(cursor, state.cursor);
    if (selected && state.discussions.some(d => d.id === selected)) current = (await api<{ discussion: Discussion }>(`/api/discussions/${selected}`)).discussion;
    else { selected = ''; current = null; }
    $('#login').hidden = true; $('#workspace').hidden = false; render(); if (!stream) connect();
  } finally { refreshing = false; if (again) { again = false; scheduleRefresh(); } }
}
function details(title: string, value: string, key = title): HTMLDetailsElement { const d = node('details'); d.dataset.key = key; d.append(node('summary', title), node('pre', value)); return d; }
function preserve(container: HTMLElement, render: () => void): void { const opened = [...container.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.key); render(); for (const d of container.querySelectorAll<HTMLDetailsElement>('details')) d.open = opened.includes(d.dataset.key); }
function labelFor(id: string | null): string { return current?.members.find(p => p.id === id)?.label ?? state?.participants.find(p => p.id === id)?.label ?? '공통 자료'; }
function time(value: string): string { return new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function selectOptions(select: HTMLSelectElement, options: { id: string; label: string }[], empty?: string): void {
  const previous = select.value; select.replaceChildren(); if (empty !== undefined) { const option = node('option', empty); option.value = ''; select.append(option); }
  for (const item of options) { const option = node('option', item.label); option.value = item.id; select.append(option); }
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
function render(): void {
  if (!state) return;
  $('#history-count').textContent = String(state.discussions.length); const history = $('#history'); history.replaceChildren();
  for (const d of state.discussions.toReversed()) { const b = button(d.topic, async () => { selected = d.id; localStorage.setItem('wj.discussion', selected); showView('discussion'); await refresh(); }, d.id === selected ? 'active' : ''); b.title = `${d.topic} · ${states[d.status]}`; history.append(b); }
  const signature = JSON.stringify([state.participants, state.connections.map(c => [c.id, c.status, c.models]), state.bindings, state.discussions.map(d => [d.id, d.topic])]);
  if (signature !== choiceSignature) {
    const picker = $('#participant-picker'); const checked = new Set([...picker.querySelectorAll<HTMLInputElement>('input:checked')].map(e => e.value)); const first = !choiceSignature; picker.replaceChildren();
    for (const p of state.participants) { const label = node('label', '', 'participant-option'); const check = node('input'); check.type = 'checkbox'; check.name = 'participantId'; check.value = p.id; check.checked = checked.has(p.id) || first && p.kind === 'fake';
      const text = node('span', p.label); text.append(node('small', p.kind === 'fake' ? '모의 · 외부 호출 없음' : p.modelId)); label.append(check, text); picker.append(label); }
    selectOptions($('#participant-connection'), state.connections.filter(c => c.status === 'connected').map(c => ({ id: c.id, label: c.label }))); updateModels();
    selectOptions($('#discussion-binding'), state.bindings, '연결 없이 진행'); selectOptions($('#job-binding'), state.bindings);
    selectOptions($('#grant-discussion'), state.discussions.map(d => ({ id: d.id, label: d.topic }))); choiceSignature = signature;
  }
  $('#composer').hidden = !!current; $('#discussion-detail').hidden = !current;
  if (current) renderDiscussion(); renderConnections(); renderJobs(); renderMaterials(); showView(view);
}
function renderMaterials(): void {
  if (!state) return;
  $('#material-roots').textContent = state.materialRoots.length ? '허용 경로: ' + state.materialRoots.join(', ') : '읽기 허용 경로가 없습니다. 서버의 WJ_MATERIAL_ROOTS에 공유할 파일·폴더를 지정하면 사용할 수 있습니다.';
  const signature = JSON.stringify(state.materialPackages); const target = $('#material-picker');
  if (signature !== materialSignature) {
    materialSignature = signature; const checked = new Set([...target.querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value)); target.replaceChildren();
    for (const pack of state.materialPackages) {
      const card = node('section', '', 'material-package'); const label = node('label', '', 'check'); const check = node('input'); check.type = 'checkbox'; check.value = pack.id; check.checked = checked.has(pack.id); label.append(check, node('span', pack.label));
      card.append(label, details('수집한 파일과 해시', pack.files.map(f => f.path + '\n' + f.size + ' bytes · ' + time(f.observedAt) + ' · 전체 파일\nSHA-256 ' + f.digest).join('\n\n'), pack.id)); target.append(card);
    }
  }
  const prepared = [...target.querySelectorAll<HTMLInputElement>('input')].find(i => i.value === pendingMaterialSelection);
  if (prepared) { prepared.checked = true; pendingMaterialSelection = null; }
}
async function browseMaterials(path: string): Promise<void> {
  const result = await api<{ path: string; entries: { name: string; directory: boolean }[] }>('/api/materials/list', { path });
  $<HTMLInputElement>('#material-folder').value = result.path; const target = $('#material-directory'); target.replaceChildren();
  for (const entry of result.entries) {
    const child = result.path.replace(/\/$/, '') + '/' + entry.name;
    target.append(button((entry.directory ? '폴더 · ' : '추가 · ') + entry.name, async () => {
      if (entry.directory) await browseMaterials(child);
      else { const input = $<HTMLTextAreaElement>('#material-paths'); input.value = [...new Set([...input.value.split('\n').filter(Boolean), child])].join('\n'); }
    }));
  }
}
function updateModels(): void { const c = state?.connections.find(c => c.id === $<HTMLSelectElement>('#participant-connection').value); selectOptions($('#participant-model'), c?.models ?? []);
  $<HTMLSelectElement>('#participant-effort').disabled = c?.kind !== 'openai-oauth';
  $('#participant-effort-note').textContent = c?.kind === 'browser' ? '기존 dot·Muse의 모델과 사고 깊이는 원래 서비스에서 조절합니다.' : c?.kind === 'openai-oauth' ? '기본 Extra high. 모델이 지원하지 않는 값은 오류로 표시합니다.' : '이 연결에는 GPT 사고 깊이 요청 설정을 사용하지 않습니다.';
}
function control(body: Record<string, unknown>): Promise<unknown> { if (!current) return Promise.resolve(); return api(`/api/discussions/${current.id}/control`, { expectedRevision: current.revision, ...body }).then(refresh); }
function renderDiscussion(): void {
  if (!current) return; const d = current;
  $('#discussion-title').textContent = d.topic; $('#discussion-meta').textContent = `DISCUSSION / REVISION ${d.revision} · ${time(d.createdAt)}`;
  const stateLine = $('#discussion-state'); stateLine.replaceChildren(badge(d.status), node('span', `요청 ${d.used.requests}/${d.limits.maxRequests} · 토큰 ${d.used.inputTokens + d.used.outputTokens} · 사용량 미제공 ${d.used.unknownUsage}회`, 'small muted'));
  if (d.reason) stateLine.append(node('span', errors[d.reason] ?? d.reason, 'small muted'));
  const track = $('#phase-track'); track.replaceChildren(); const order = Object.keys(phases) as Phase[];
  for (const [index, phase] of order.entries()) track.append(node('div', `${String(index + 1).padStart(2, '0')} ${phases[phase]}`, `phase-step ${phase === d.phase ? 'current' : index < order.indexOf(d.phase) ? 'past' : ''}`));
  const controls = $('#run-controls'); controls.replaceChildren();
  if (d.status === 'running') controls.append(button('일시정지', () => control({ action: 'pause' })));
  if (['paused', 'blocked'].includes(d.status)) controls.append(button('이어가기', () => control({ action: 'resume' }), 'primary'));
  if (['running', 'paused', 'blocked'].includes(d.status)) controls.append(button('조건 보완', () => modal('토의 조건 보완', [{ name: 'text', label: '추가 조건', multiline: true }], values => control({ action: 'revise', ...values }))), button('토의 취소', () => modal('토의 취소', [], () => control({ action: 'cancel' }), '이미 전송된 응답과 Codex 실행은 기록에 남습니다. Codex 중단은 실행 화면에서 별도로 요청할 수 있습니다.')));
  controls.append(node('span', `${(d.used.activeMs / 60000).toFixed(1)} / ${d.limits.maxActiveMs / 60000}분 · 실행 ${d.used.toolJobs}/${d.limits.maxToolJobs}`, 'small muted'));
  const members = $('#member-status'); members.replaceChildren();
  for (const p of d.members) { const context = d.contexts.find(c => c.participantId === p.id)!; const card = node('article', '', 'member-card'); const head = node('div', '', 'inline'); head.append(node('span', p.kind === 'fake' ? 'F' : p.kind === 'openai-oauth' ? 'G' : p.kind === 'deepseek' ? 'D' : p.label.slice(0, 1), 'avatar'), node('span', p.label, 'name'));
    card.append(head, node('div', `${d.excludedIds.includes(p.id) ? '참여 제외 · ' : ''}${p.modelId} · 문맥 ${context.generation}`, 'small muted'));
    if (p.kind === 'openai-oauth') {
      card.append(node('p', '사고 깊이 · ' + effortLabel(p.reasoningEffort ?? 'xhigh'), 'small muted'));
      card.append(button('사고 깊이 변경', () => { if (!['paused', 'blocked'].includes(d.status)) { announce('토의를 일시정지하고 현재 발언이 끝난 뒤 변경하세요.', true); return; }
        modal('이 토의의 사고 깊이', [{ name: 'reasoningEffort', label: '사고 깊이', options: effortOptions, value: p.reasoningEffort ?? 'xhigh' }], values => control({ action: 'configure_participant', participantId: p.id, ...values }), '완료된 발언은 보존하고 이후 발언부터 적용합니다.'); }));
    }
    const job = state?.jobs.filter(j => j.discussionId === d.id && d.tasks.some(t => t.id === j.taskId && t.participantId === p.id)).at(-1); const toolState = job?.status ?? context.observation.tool;
    card.append(node('div', `연결 ${states[context.observation.connection] ?? context.observation.connection} / 응답 ${states[context.observation.response] ?? context.observation.response}\n도구 ${states[toolState] ?? toolState} / 업무 ${states[d.status] ?? d.status}`, 'observations')); members.append(card); }
  for (const el of document.querySelectorAll<HTMLElement>('[data-tab]')) el.classList.toggle('selected', el.dataset.tab === tab);
  preserve($('#discussion-content'), () => {
    const target = $('#discussion-content'); target.replaceChildren();
    if (tab === 'timeline') renderTimeline(target, d); else if (tab === 'comparison') renderComparison(target, d);
    else if (tab === 'evidence') renderEvidence(target, d); else if (tab === 'tasks') renderTasks(target, d); else renderRecords(target, d);
  });
}
function renderTimeline(target: HTMLElement, d: Discussion): void {
  if (!d.turns.length) target.append(node('div', '참여자의 첫 제안을 기다리고 있습니다.', 'empty'));
  for (const t of d.turns) {
    const card = node('article', '', 'turn'); const head = node('header', '', 'turn-header'); const who = node('div', '', 'inline'); who.append(node('strong', labelFor(t.participantId)), node('span', `${phases[t.phase]} · ${t.round}회`, 'muted')); head.append(who, badge(t.status));
    card.append(head, node('div', (t.reply?.text ?? t.text) || '응답을 기다리고 있습니다…', 'reply'));
    if (t.reply?.uncertainty.length) card.append(node('div', t.reply.uncertainty.join('\n'), 'uncertainty'));
    if (t.reply?.reviews.length) { const reviews = node('div'); for (const r of t.reply.reviews) reviews.append(node('p', `${r.stance === 'challenge' ? '반론' : r.stance === 'support' ? '지지' : '미확인'} · ${d.claims.find(c => c.id === r.claimId)?.text ?? r.claimId}\n${r.reason}`, 'small')); card.append(reviews); }
    card.append(node('footer', `revision ${t.revision} · 문맥 ${t.generation} · ${time(t.startedAt)}${t.reasoningEffort ? ' · 요청 사고 깊이 ' + effortLabel(t.reasoningEffort) : ''}${t.error ? ` · ${t.error}` : ''}`));
    card.append(details('원본 응답과 수신 기록', JSON.stringify({ turnId: t.id, receipt: t.receipt, usage: t.usage, evidenceIds: t.evidenceIds, promptDigest: t.promptDigest, raw: t.text }, null, 2), t.id)); target.append(card);
  }
}
function renderComparison(target: HTMLElement, d: Discussion): void {
  target.append(node('p', '합의는 사실 검증을 뜻하지 않습니다. 아래 결과와 근거 탭의 실제 관측 기록을 함께 확인하세요.', 'small muted'));
  const grid = node('div', '', 'comparison-grid');
  for (const p of d.members) { const card = node('article', '', 'panel'); card.append(node('h2', p.label)); for (const phase of ['independent', 'revision'] as const) {
      const t = d.turns.filter(t => t.participantId === p.id && t.revision === d.revision && t.phase === phase && t.status === 'completed').at(-1);
      card.append(node('p', phase === 'independent' ? 'INITIAL / 초기안' : 'REVISED / 수정안', 'comparison-label'), node('div', t?.reply?.text ?? t?.text ?? '아직 작성되지 않았습니다.', 'reply'));
      if (t?.reply?.uncertainty.length) card.append(node('div', t.reply.uncertainty.join('\n'), 'uncertainty')); }
    grid.append(card); } target.append(grid);
  for (const t of d.turns.filter(t => t.revision === d.revision && ['synthesis', 'summary_review'].includes(t.phase))) { const card = node('article', '', 'panel'); card.append(node('h2', `${phases[t.phase]} · ${labelFor(t.participantId)}`), node('div', t.reply?.text ?? t.text ?? '대기', 'reply')); target.append(card); }
}
function renderEvidence(target: HTMLElement, d: Discussion): void {
  const claims = node('section', '', 'panel'); claims.append(node('h2', '검토할 주장'));
  for (const c of d.claims.filter(c => c.revision === d.revision)) { const item = node('div', '', 'claim'); item.append(node('p', c.text, 'reply'), node('span', `${labelFor(c.participantId)} · ${c.id}`, 'small muted')); if (c.assumptions.length) item.append(node('p', `가정: ${c.assumptions.join(' / ')}`, 'small muted')); const evidence = d.evidence.filter(e => e.claimIds.includes(c.id)); item.append(node('p', evidence.length ? `연결된 자료 ${evidence.length}개 · 관측 ${evidence.filter(e => e.status === 'observed').length}개` : '독립 검증 자료 없음', 'small')); claims.append(item); } target.append(claims);
  if (!d.evidence.length) target.append(node('div', '아직 수집한 근거가 없습니다.', 'empty'));
  for (const e of d.evidence) { const card = node('article', '', 'panel'); const head = node('div', '', 'inline'); head.append(badge(e.status), node('span', e.kind, 'small muted')); card.append(head, node('p', e.source, 'small'));
    if (e.material) card.append(node('p', e.material.size + ' bytes · 전체 파일 사본 · 주장 검증과 별개', 'small muted'));
    if (/^https?:\/\//.test(e.source)) { const a = node('a', '출처 원문 열기 ↗'); a.href = e.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a); }
    card.append(node('div', e.text || '실제로 얻은 자료가 없습니다.', 'reply'), node('p', `${e.reason ?? ''} · ${time(e.observedAt)} · revision ${e.revision}`, 'small muted'), details('근거 ID와 원문 해시', `${e.id}\n${e.digest}\nclaims: ${e.claimIds.join(', ')}`, e.id)); target.append(card); }
}
function renderTasks(target: HTMLElement, d: Discussion): void {
  const tasks = d.tasks.filter(t => t.revision === d.revision); if (!tasks.length) target.append(node('p', '배정된 과제가 없습니다.', 'empty'));
  for (const t of tasks) { const item = node('article', '', 'task'); const body = node('div'); body.append(node('strong', `${phases[t.phase]} · ${labelFor(t.participantId)}`), node('p', t.question || (t.claimIds.length ? `대상 주장: ${t.claimIds.join(', ')}` : '주제와 공통 기준에 따라 검토')),
      node('p', `${t.method ?? '대화'} · ${t.id}${t.jobId ? ` · ${t.jobId}` : ''}${t.reason ? ` · ${t.reason}` : ''}`, 'muted')); item.append(body, badge(t.status)); target.append(item); }
}
function renderRecords(target: HTMLElement, d: Discussion): void {
  for (const t of d.turns.filter(t => t.status === 'unconfirmed')) { const card = node('section', '', 'panel'); card.append(node('h2', `응답 대조 · ${labelFor(t.participantId)}`), node('p', '기존 대화와 수신 기록을 확인하고 처리합니다. 새 응답을 보내지 않습니다.', 'small muted'), details('미확인 요청', JSON.stringify(t, null, 2), t.id)); const row = node('div', '', 'toolbar');
    row.append(button('완료 응답 반영', () => modal('원격 완료 기록 반영', [{ name: 'text', label: '실제 JSON 응답 원문', multiline: true }, { name: 'receipt', label: '대화 URL 또는 응답 ID' }], data => control({ action: 'reconcile', turnId: t.id, resolution: 'completed', ...data }))),
      button('전송되지 않음 확인', () => modal('미전송 확인', [], () => control({ action: 'reconcile', turnId: t.id, resolution: 'not_sent' }), '원격 대화에 요청이 없음을 직접 확인했을 때 적용하세요. 이어가기를 누르면 새 요청을 보냅니다.')),
      button('이 응답 건너뛰기', () => control({ action: 'reconcile', turnId: t.id, resolution: 'skip' }))); card.append(row); target.append(card); }
  const handoff = node('section', '', 'panel'); handoff.append(node('h2', '문맥과 참여자 관리'), node('p', '문맥 전환은 기존 원문·근거·미해결 과제를 보존합니다. 주제 revision과 별도로 기록합니다.', 'small muted'));
  for (const p of d.members) { const row = node('div', '', 'toolbar'); row.append(node('span', p.label)); if (p.kind !== 'browser') row.append(button('체크포인트 적용', () => control({ action: 'handoff', participantId: p.id, expectedGeneration: d.contexts.find(c => c.participantId === p.id)!.generation })));
    if (!d.excludedIds.includes(p.id) && ['running', 'paused', 'blocked'].includes(d.status)) row.append(button('참여 제외', () => modal('참여자 제외', [], () => control({ action: 'exclude', participantId: p.id }), `${p.label}의 기존 결과는 남기고, 이후 과제에서 제외합니다.`))); handoff.append(row); } target.append(handoff);
  for (const cp of d.checkpoints) target.append(details(`${labelFor(cp.participantId)} · 문맥 ${cp.generation} · ${cp.reason}`, JSON.stringify(cp, null, 2), cp.id));
  const download = button('전체 토의 JSON 내려받기', () => { const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = node('a'); a.href = url; a.download = `${d.id}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }); target.append(download);
}
function renderConnections(): void {
  if (!state) return; const target = $('#connections-list'); target.replaceChildren();
  for (const c of state.connections) { const card = node('article', '', 'connection-card'); card.append(node('h3', c.label), badge(c.status), node('p', `${c.kind}${c.email ? ` · ${c.email}` : ''}`, 'muted'), node('p', `${c.models.length}개 모델${c.error ? ` · ${c.error}` : ''}`, 'small'));
    if (c.browser?.thread) card.append(node('p', `연결된 대화 ID: ${c.browser.thread.value}`, 'small muted'));
    const row = node('div', '', 'toolbar'); row.append(button('모델 확인', async () => { await api(`/api/connections/${c.id}/models`, {}); await refresh(); }));
    if (c.kind === 'openai-oauth') row.append(button('다시 로그인', async () => { showOAuth(await api('/api/connections/oauth', { label: c.label, connectionId: c.id, expectedEmail: c.expectedEmail })); }), button('이 계정 로그아웃', async () => { const result = await api<{ revoked: boolean }>(`/api/connections/${c.id}/logout`, {}); announce(result.revoked ? '계정 연결을 해제했습니다.' : '로컬 인증 정보를 지웠습니다. 원격 폐기 여부는 확인하지 못했습니다.'); await refresh(); }));
    if (c.kind === 'deepseek') row.append(button('API 키 갱신', () => modal('DeepSeek API 키 갱신', [{ name: 'key', label: '새 API 키', secret: true }], async values => { await api(`/api/connections/${c.id}/credential`, values); await refresh(); })));
    if (c.kind === 'browser' && c.browser) { const browserBinding = c.browser; row.append(button('페이지·선택자 갱신', () => { const form = $<HTMLFormElement>('#browser-form'); const owner = form.closest('details')!; owner.open = true;
      let hidden = form.elements.namedItem('connectionId') as HTMLInputElement | null; if (!hidden) { hidden = node('input'); hidden.type = 'hidden'; hidden.name = 'connectionId'; form.append(hidden); } hidden.value = c.id;
      for (const [key, value] of Object.entries({ label: c.label, ...browserBinding, threadSelector: browserBinding.thread?.selector ?? '', threadAttribute: browserBinding.thread?.attribute ?? '', threadValue: browserBinding.thread?.value ?? '', threadJsonKey: browserBinding.thread?.jsonKey ?? '', sendAppearsAfterInput: !!browserBinding.sendAppearsAfterInput })) {
        const input = form.elements.namedItem(key) as HTMLInputElement | null; if (input) { if (input.type === 'checkbox') input.checked = value === true; else input.value = String(value); }
      } owner.scrollIntoView({ behavior: 'smooth' }); })); }
    card.append(row); target.append(card); }
  if (!state.connections.length) target.append(node('p', '등록된 실제 계정이 없습니다. 모의 참여자로 전체 흐름을 먼저 확인할 수 있습니다.', 'small muted'));
  const participants = $('#participants-list'); participants.replaceChildren();
  for (const p of state.participants.filter(p => p.kind !== 'fake')) {
    const connection = state.connections.find(c => c.id === p.connectionId); const card = node('article', '', 'connection-card');
    card.append(node('h3', p.label), node('p', '계정 · ' + (connection?.email ?? connection?.browser?.accountLabel ?? connection?.label ?? '연결 확인 필요'), 'small muted'), node('p', p.modelId + (p.kind === 'openai-oauth' ? ' · ' + effortLabel(p.reasoningEffort ?? 'xhigh') : ''), 'small'));
    card.append(button('토커 설정 변경', () => { if (connection?.status !== 'connected') { announce('먼저 해당 계정을 로그인하고 모델을 확인해 주세요.', true); return; }
      const form = $<HTMLFormElement>('#participant-form'); let hidden = form.elements.namedItem('participantId') as HTMLInputElement | null;
      if (!hidden) { hidden = node('input'); hidden.type = 'hidden'; hidden.name = 'participantId'; form.append(hidden); } hidden.value = p.id;
      $<HTMLSelectElement>('#participant-connection').value = p.connectionId!; updateModels(); $<HTMLSelectElement>('#participant-model').value = p.modelId;
      (form.elements.namedItem('label') as HTMLInputElement).value = p.label; (form.elements.namedItem('role') as HTMLInputElement).value = p.role;
      $<HTMLSelectElement>('#participant-effort').value = p.reasoningEffort ?? 'xhigh'; $('#participant-save').textContent = '토커 설정 저장'; $('#participant-edit-cancel').hidden = false; form.scrollIntoView({ behavior: 'smooth' });
    })); participants.append(card);
  }
  $('#browser-state').textContent = `${state.capabilities.browserConfigured ? 'Chrome 명령 설정됨' : 'Chrome 명령 미설정'} · ${state.browserPaused ? '수동 조작 중 · 자동 입력 잠김' : '자동 입력 가능'} · ${state.capabilities.noVncConfigured ? '화면 연결 설정됨' : '화면 연결 미설정'}`;
  const grants = $('#grants-list'); grants.replaceChildren(); for (const grant of state.grants) { const row = node('div', '', 'toolbar'); row.append(node('span', `${grant.participantId} · ${grant.revoked ? '폐기됨' : grant.tools.join(', ')}`, 'small')); if (!grant.revoked) row.append(button('폐기', async () => { await api('/api/grants/revoke', { id: grant.id }); await refresh(); })); grants.append(row); }
}
function showOAuth(result: { authorizationUrl: string; connectionId: string }): void {
  const target = $('#oauth-result'); target.replaceChildren(node('p', 'Ubuntu 서버의 Chrome에서 아래 승인 주소를 여세요. 다른 기기에서 열면 loopback 콜백이 서버로 돌아오지 않습니다.', 'small'));
  target.append(button('별도 로그인 창 열기', async () => { await api('/api/browser/open-auth', { url: result.authorizationUrl, connectionId: result.connectionId }); announce('dot과 분리된 Chrome 로그인 창에서 웹 GPT용 계정으로 로그인한 뒤 모델 확인을 누르세요.'); }), details('서버에서 열 승인 주소', result.authorizationUrl), button('로그인 완료 · 모델 확인', async () => { await api(`/api/connections/${result.connectionId}/models`, {}); await refresh(); }));
}
function renderJobs(): void {
  if (!state) return; const bindings = $('#bindings-list'); bindings.replaceChildren();
  for (const b of state.bindings) bindings.append(details(`${b.label} · ${b.allowWrite ? '수정 허용' : '읽기 전용'} · ${b.branch}`, JSON.stringify(b, null, 2), b.id));
  preserve($('#jobs-list'), () => { const target = $('#jobs-list'); target.replaceChildren();
    for (const job of state!.jobs.toReversed()) { const card = node('section', '', 'panel'); const head = node('div', '', 'inline'); head.append(node('h2', state!.bindings.find(b => b.id === job.bindingId)?.label ?? 'Codex 작업'), badge(job.status)); card.append(head, node('p', `${job.id} · ${job.turnId ?? 'turn 수신 전'}`, 'small muted'), details('보낸 명령', job.prompt, `${job.id}:prompt`), node('div', job.text || '실행 결과를 기다리고 있습니다.', 'reply job-output'));
      const controls = node('div', '', 'toolbar');
      if (['queued', 'running', 'blocked_approval'].includes(job.status)) controls.append(button('중단 요청', async () => { await api(`/api/jobs/${job.id}/cancel`, {}); await refresh(); }));
      if (job.status === 'running') controls.append(button('진행 중 지시 보완', () => modal('현재 실행에 지시 추가', [{ name: 'text', label: '추가 지시', multiline: true }], async values => { await api(`/api/jobs/${job.id}/steer`, { expectedTurnId: job.turnId, ...values }); await refresh(); })));
      if (job.status === 'reconciling') controls.append(button('실제 turn 결과 대조', async () => { if (!job.turnId) modal('수신되지 않은 Codex turn 대조', [{ name: 'turnId', label: '실제 세션에서 확인한 turn ID' }], async data => { await api(`/api/jobs/${job.id}/reconcile`, data); await refresh(); }, '원격 기록의 입력·시각·세션·완료 상태를 함께 검사합니다. 새 실행을 시작하지 않습니다.'); else { await api(`/api/jobs/${job.id}/reconcile`, {}); await refresh(); } })); card.append(controls);
      for (const approval of job.approvals.filter(a => a.status === 'pending')) { const section = node('section', '', 'panel'); section.append(node('h3', '실행 승인 요청'), node('pre', JSON.stringify(approval.params, null, 2))); const row = node('div', '', 'toolbar'); for (const [decision, label] of [['accept', '이번 요청 승인'], ['decline', '거절'], ['cancel', '취소']]) row.append(button(label!, async () => { await api(`/api/jobs/${job.id}/approve`, { approvalId: approval.id, decision }); await refresh(); })); section.append(row); card.append(section); }
      for (const activity of job.activities) card.append(details(`${activity.type} · ${activity.status}`, activity.text, `${job.id}:${activity.id}`)); if (job.error) card.append(node('p', job.error, 'small muted')); target.append(card); }
  });
}
type Field = { name: string; label: string; multiline?: boolean; required?: boolean; secret?: boolean; options?: { value: string; label: string }[]; value?: string };
let modalAction: ((values: Record<string, string>) => Promise<unknown>) | null = null;
function modal(title: string, fields: Field[], action: (values: Record<string, string>) => Promise<unknown>, note?: string): void {
  $('#action-title').textContent = title; const target = $('#action-fields'); target.replaceChildren(); if (note) target.append(node('p', note, 'small muted'));
  for (const field of fields) { const label = node('label', field.label); const input = field.options ? node('select') : field.multiline ? node('textarea') : node('input'); input.name = field.name; input.required = field.required !== false; if (input instanceof HTMLTextAreaElement) input.rows = 6; else if (input instanceof HTMLInputElement && field.secret) { input.type = 'password'; input.autocomplete = 'off'; }
    if (input instanceof HTMLSelectElement && field.options) selectOptions(input, field.options.map(o => ({ id: o.value, label: o.label }))); if (field.value !== undefined) input.value = field.value; label.append(input); target.append(label); }
  modalAction = action; $<HTMLDialogElement>('#action-dialog').showModal();
}
form('#action-form', async values => { await modalAction?.(values); $<HTMLDialogElement>('#action-dialog').close(); $('#action-fields').replaceChildren(); });
$('#action-cancel').addEventListener('click', () => $<HTMLDialogElement>('#action-dialog').close());
form('#login-form', async (values, el) => { await api('/api/login', { token: values.token }); el.reset(); await refresh(); });
form('#discussion-form', async values => { const participantIds = [...document.querySelectorAll<HTMLInputElement>('#participant-picker input:checked')].map(i => i.value);
  const materialPackageIds = [...document.querySelectorAll<HTMLInputElement>('#material-picker input:checked')].map(i => i.value);
  const result = await api<{ id: string }>('/api/discussions', { topic: values.topic, criteria: values.criteria, materials: values.materials, materialPackageIds, participantIds, executionBindingId: values.executionBindingId || null,
    limits: { maxRequests: Number(values.maxRequests), maxRounds: Number(values.maxRounds), maxActiveMs: Number(values.maxMinutes) * 60_000 } }); selected = result.id; localStorage.setItem('wj.discussion', selected); await refresh(); });
form('#oauth-form', async values => { showOAuth(await api('/api/connections/oauth', values)); await refresh(); });
form('#deepseek-form', async (values, el) => { try { await api('/api/connections/deepseek', values); await refresh(); } finally { (el.elements.namedItem('key') as HTMLInputElement).value = ''; } });
function clearParticipantEdit(): void { $('#participant-form').querySelector('[name=participantId]')?.remove(); $<HTMLFormElement>('#participant-form').reset(); $('#participant-save').textContent = '참여자 등록'; $('#participant-edit-cancel').hidden = true; updateModels(); }
form('#participant-form', async values => { const { participantId, ...settings } = values; await api(participantId ? '/api/participants/' + participantId : '/api/participants', settings); clearParticipantEdit(); announce(participantId ? '설정을 저장했습니다. 새 토의부터 적용합니다.' : '참여자를 등록했습니다.'); await refresh(); });
$('#participant-edit-cancel').addEventListener('click', clearParticipantEdit);
form('#browser-form', async (values, form) => {
  const { label, connectionId, threadSelector, threadAttribute, threadValue, threadJsonKey, sendAppearsAfterInput, ...binding } = values;
  const hasThread = [threadSelector, threadAttribute, threadValue, threadJsonKey].some(Boolean);
  if (hasThread && (!threadSelector || !threadAttribute || !threadValue)) throw new Error('대화 ID·확인 선택자·속성을 모두 입력하세요.');
  await api('/api/connections/browser', { label, connectionId, binding: { ...binding, pageId: Number(binding.pageId), sendAppearsAfterInput: sendAppearsAfterInput === 'on',
    ...(hasThread ? { thread: { selector: threadSelector, attribute: threadAttribute, value: threadValue, ...(threadJsonKey ? { jsonKey: threadJsonKey } : {}) } } : {}) } });
  form.querySelector('[name=connectionId]')?.remove(); await refresh();
});
form('#binding-form', async values => { await api('/api/bindings', { ...values, allowWrite: values.allowWrite === 'on' }); await refresh(); });
form('#job-form', async values => { await api('/api/jobs', values); await refresh(); });
form('#grant-form', async values => { const tools = ['task_get', 'context_get', 'result_submit', 'capabilities_get', ...(values.codex === 'on' ? ['codex_send', 'codex_status', 'codex_result', 'codex_cancel'] : [])];
  const result = await api<{ id: string; token: string }>('/api/grants', { ...values, tools }); $('#grant-result').textContent = `한 번만 표시되는 접근 키입니다. 대화 본문에 붙여 넣지 마세요.\nMCP URL: ${location.origin}/mcp\nAuthorization: Bearer ${result.token}\nGrant: ${result.id}`; await refresh(); });
$('#participant-connection').addEventListener('change', updateModels);
for (const el of document.querySelectorAll<HTMLElement>('[data-view]')) el.addEventListener('click', () => showView(el.dataset.view as View));
for (const el of document.querySelectorAll<HTMLElement>('[data-tab]')) el.addEventListener('click', () => { tab = el.dataset.tab!; renderDiscussion(); });
$('#new-discussion').addEventListener('click', () => { selected = ''; current = null; localStorage.removeItem('wj.discussion'); showView('discussion'); render(); $('#topic').focus(); });
function click(id: string, action: () => Promise<unknown>): void { $(id).addEventListener('click', () => { void action().catch(report); }); }
const prepareButton = button('파일 읽고 자료 저장', async () => {
  const paths = $<HTMLTextAreaElement>('#material-paths').value.split('\n').map(p => p.trim()).filter(Boolean);
  const result = await api<{ id: string }>('/api/materials', { label: $<HTMLInputElement>('#material-label').value, paths });
  pendingMaterialSelection = result.id; await refresh();
  announce('파일 사본을 저장하고 다음 토의의 자료로 선택했습니다.');
}); prepareButton.id = 'material-prepare'; $('#material-prepare').replaceWith(prepareButton);
const browseButton = button('폴더 확인', () => browseMaterials($<HTMLInputElement>('#material-folder').value)); browseButton.id = 'material-browse'; $('#material-browse').replaceWith(browseButton);
type CapabilityView = { observedAt: string; os: { platform: string; release: string; arch: string };
  tools: Record<string, { status: string; version: string | null } | null>;
  materials: { access: string; allowedPaths?: string[] };
  connections: { label: string; kind: string; status: string; lastCheckedAt: string | null }[];
  execution: { allowedPaths?: string[]; bindings: { label: string; cwd: string; allowWrite: boolean; status: string }[]; jobs: { id: string; status: string; pendingApprovals: number }[] } };
click('#capabilities-refresh', async () => {
  const report = await api<CapabilityView>('/api/capabilities'); const target = $('#capabilities-report'); target.replaceChildren();
  target.append(node('p', report.os.platform + ' ' + report.os.release + ' · ' + report.os.arch + ' · ' + time(report.observedAt), 'small muted'));
  for (const [name, tool] of Object.entries(report.tools)) target.append(node('p', name + ': ' + (tool?.version ?? (tool?.status === 'unavailable' ? '실행 파일 확인 실패' : tool?.status === 'unknown' ? '버전 확인 불가' : '미설정')), 'small'));
  target.append(node('p', '자료 읽기 허용: ' + (report.materials.allowedPaths?.join(', ') || '없음'), 'small'), node('p', 'Codex 등록 허용 경로: ' + (report.execution.allowedPaths?.join(', ') || '없음'), 'small'));
  for (const b of report.execution.bindings) target.append(node('p', b.label + ' · ' + b.cwd + ' · ' + (b.allowWrite ? '수정 허용' : '읽기 전용') + ' · ' + (states[b.status] ?? b.status), 'small'));
  for (const c of report.connections) target.append(node('p', c.label + ' · ' + c.kind + ' · ' + (states[c.status] ?? c.status) + ' · ' + (c.lastCheckedAt ? '마지막 확인 ' + time(c.lastCheckedAt) : '확인 시각 없음'), 'small'));
  target.append(node('p', '기록된 실행 ' + report.execution.jobs.length + '개 · 승인 대기 ' + report.execution.jobs.reduce((n, j) => n + j.pendingApprovals, 0) + '건', 'small'));
  for (const j of report.execution.jobs) target.append(node('p', j.id + ' · ' + (states[j.status] ?? j.status) + ' · 승인 대기 ' + j.pendingApprovals + '건', 'small'));
  target.append(node('p', '명령 네트워크: turn sandbox 정책으로 차단. Codex App Server: 인증용 호스트 네트워크 사용. 호스트 파일 읽기: private state·Chrome profile 가림을 요구하는 정책. 실제 격리 성공은 별도 실행 검증이 필요합니다.', 'small muted'), details('조회 원문', JSON.stringify(report, null, 2)));
});
click('#logout', async () => { await api('/api/logout', {}); lock(); });
click('#browser-manual', async () => { await api('/api/browser/control', { paused: true }); await refresh(); });
click('#browser-automatic', async () => { await api('/api/browser/control', { paused: false }); await refresh(); });
click('#browser-pages', async () => { $('#browser-output').textContent = (await api<{ text: string }>('/api/browser/pages')).text; });
click('#browser-snapshot', async () => { const id = new FormData($<HTMLFormElement>('#browser-form')).get('pageId'); $('#browser-output').textContent = (await api<{ text: string }>(`/api/browser/snapshot?pageId=${encodeURIComponent(String(id))}`)).text; });
void refresh().catch(error => { if (!(error instanceof Error) || error.message !== 'authentication_required') report(error); });
