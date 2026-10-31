import type { WikiPage, WikiVersion, WikiCitation } from '../workspace/wiki-model.js';
type WikiList = { items: (WikiPage & { tombstone: boolean; conflictCount: number })[]; pins: WikiCitation[]; selection: 'automatic' | 'pinned'; nextAfter: number; hasMore: boolean; enabled: boolean };
type WikiContext = { roomId: string; version: number; epoch: number; enabled: boolean; scopes: { id: string; label: string }[];
  sources: { id: string; label: string }[]; participants: { id: string; label: string; generation: number; seatVersion: number }[] };
type Deps = { api: <T>(path: string, body?: unknown, requestId?: string) => Promise<T>; refresh: () => Promise<void>; report: (e: unknown) => void; closeDrawers: () => void };
const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector<T>(s)!;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; }
export class WikiView {
  private context: WikiContext | null = null; private list: WikiList | null = null; private offset = 0; private opening = 0; private editing: { page: WikiPage; version: WikiVersion } | null = null; private editKey = ''; private grantVersion: { generation: number; seatVersion: number; epoch: number } | null = null;
  constructor(private readonly deps: Deps) {
    $('#wiki-new').addEventListener('click', () => this.form());
    $('#wiki-more').addEventListener('click', () => { this.offset = this.list?.hasMore ? this.list.nextAfter : 0; void this.deps.refresh().catch(deps.report); });
    $('#wiki-grants').addEventListener('click', () => { void this.grants().catch(deps.report); });
    $('#wiki-form').addEventListener('submit', e => { e.preventDefault(); const b = $<HTMLButtonElement>('#wiki-form [type=submit]'); b.disabled = true; void this.save().catch(deps.report).finally(() => { b.disabled = false; }); });
    $('#resident-grant-form').addEventListener('submit', e => { e.preventDefault(); const b = $<HTMLButtonElement>('#resident-grant-form [type=submit]'); b.disabled = true; void this.createGrant().catch(deps.report).finally(() => { b.disabled = false; }); });
    $('#resident-grant-form [name=participantId]').addEventListener('change', () => this.captureGrant());
    $('#resident-grant-dialog').addEventListener('close', () => { $('#resident-grant-token').textContent = ''; });
    $('#resident-grant-dialog').addEventListener('cancel', () => { $('#resident-grant-token').textContent = ''; });
    $('#wiki-detail-dialog').addEventListener('close', () => { this.opening++; });
  }
  private path(suffix: string) { return '/api/rooms/' + this.context!.roomId + suffix; }
  private button(text: string, action: () => void | Promise<void>) { const b = node('button', text); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; void Promise.resolve().then(action).catch(this.deps.report).finally(() => { b.disabled = false; }); }); return b; }
  async update(context: WikiContext | null): Promise<void> {
    if (!context) { this.context = null; this.list = null; this.opening++; this.render(); return; }
    if (this.context?.roomId !== context.roomId) { this.offset = 0; this.opening++; }
    this.context = context; const roomId = context.roomId;
    const list = await this.deps.api<WikiList>(this.path(`/wiki?after=${this.offset}&limit=50`));
    if (this.context?.roomId !== roomId) return; this.list = list; this.render();
  }
  private render(): void {
    const target = $('#wiki-items'); target.replaceChildren(); $<HTMLButtonElement>('#wiki-new').disabled = !this.context?.enabled; $<HTMLButtonElement>('#wiki-grants').disabled = !this.context?.enabled;
    if (this.list) target.append(node('p', this.list.selection === 'automatic' ? '허용된 최신 버전을 다음 대화에 자동 반영합니다.' : '선택한 고정 버전만 다음 대화에 반영합니다.', 'small muted'));
    if (!this.list?.items.length) target.append(node('p', '아직 공유 기억이 없습니다. 공개 대화나 업무 보고를 출처로 기록하세요.', 'small muted'));
    for (const p of this.list?.items ?? []) { const card = node('article', '', 'work-card'); card.dataset.pageId = p.id;
      const pin = this.list!.pins.find(v => v.pageId === p.id); card.append(node('h4', p.title), node('p', `v${p.headVersion} · ${p.tombstone ? '폐기 기록' : 'reported'}${pin ? ' · 고정 v' + pin.version : ''} · 충돌 ${p.conflictCount}`, 'small muted'), this.button('문서·변경 기록', () => this.open(p.id))); target.append(card); }
    $('#wiki-more').hidden = !this.list?.hasMore && !this.offset; $('#wiki-more').textContent = this.list?.hasMore ? '다음 문서' : '처음 문서';
  }
  async open(pageId: string, version?: number, conflictId?: string): Promise<void> {
    if (!this.context) return; const request = ++this.opening; const roomId = this.context.roomId;
    const query = conflictId ? '?conflictId=' + encodeURIComponent(conflictId) : version ? '?version=' + version : '';
    const result = await this.deps.api<{ page: WikiPage; version: WikiVersion }>(this.path('/wiki/' + pageId + query));
    if (!this.context || this.context.roomId !== roomId || request !== this.opening) return;
    const history = await this.deps.api<{ items: Omit<WikiVersion, 'body'>[]; nextAfter: number; hasMore: boolean }>(this.path('/wiki/' + pageId + '/history?limit=50'));
    if (!this.context || this.context.roomId !== roomId || request !== this.opening) return;
    this.deps.closeDrawers(); const target = $('#wiki-detail'); target.replaceChildren(); const v = result.version;
    target.dataset.pageId = pageId; target.dataset.version = String(v.version); target.append(node('h3', v.title), node('p', `${v.status === 'conflict' ? '충돌 제안 · 기준 v' + v.baseVersion + ' / 실제 v' + v.conflictWith : 'v' + v.version} · reported${v.tombstone ? ' · 폐기' : ''}`, 'small muted'), node('p', '작성자 ' + v.authoredBy + ' · ' + new Date(v.createdAt).toLocaleString('ko-KR'), 'small'), node('div', v.body, 'reply wiki-body'));
    const provenance = node('details'); provenance.append(node('summary', '원문 출처·digest'), node('pre', JSON.stringify({ pageId, version: v.version, digest: v.digest, sourceRefs: v.sourceRefs, epistemicStatus: v.epistemicStatus }, null, 2))); target.append(provenance);
    if (this.context.enabled) {
      target.append(this.button(v.status === 'conflict' ? '현재 버전을 기준으로 조정' : '이 기록으로 편집', () => this.form(result)));
      if (v.version !== null && !v.tombstone && v.status === 'published') target.append(this.button('이 버전을 대화에 고정', async () => {
        const pins = (this.list?.pins ?? []).filter(p => p.pageId !== pageId).map(p => ({ pageId: p.pageId, version: p.version })); pins.push({ pageId, version: v.version! });
        await this.deps.api(this.path('/wiki-pins'), { expectedVersion: this.context!.version, pins }); await this.deps.refresh(); $('#wiki-detail-state').textContent = '이 버전을 다음 발화와 업무 입력에 고정했습니다.';
      }));
      if (this.list?.pins.some(p => p.pageId === pageId)) target.append(this.button('이 문서 고정 해제', async () => { await this.deps.api(this.path('/wiki-pins'), { expectedVersion: this.context!.version, pins: this.list!.pins.filter(p => p.pageId !== pageId).map(p => ({ pageId: p.pageId, version: p.version })) }); await this.deps.refresh(); $('#wiki-detail-state').textContent = '고정을 해제했습니다. 과거 인용은 남아 있습니다.'; }));
      if (this.list?.selection === 'pinned') target.append(this.button('최신 버전 자동 선택으로 전환', async () => { await this.deps.api(this.path('/wiki-pins'), { expectedVersion: this.context!.version, automatic: true }); await this.deps.refresh(); $('#wiki-detail-state').textContent = '허용된 최신 버전을 자동 선택합니다. 과거 입력은 유지됩니다.'; }));
    }
    target.append(node('h4', '변경·충돌 기록')); const rows = node('div'); target.append(rows);
    const append = (items: typeof history.items) => { for (const h of items) rows.append(this.button(`${h.status === 'conflict' ? '충돌' : 'v' + h.version} · ${h.title}${h.tombstone ? ' · 폐기' : ''}`, () => this.open(pageId, h.version ?? undefined, h.status === 'conflict' ? h.id : undefined))); };
    append(history.items); let after = history.nextAfter; const more = this.button('다음 변경 기록', async () => { const next = await this.deps.api<typeof history>(this.path(`/wiki/${pageId}/history?after=${after}&limit=50`)); append(next.items); after = next.nextAfter; more.hidden = !next.hasMore; }); more.hidden = !history.hasMore; target.append(more);
    $('#wiki-detail-state').textContent = ''; $<HTMLDialogElement>('#wiki-detail-dialog').showModal();
  }
  private form(edit?: { page: WikiPage; version: WikiVersion }): void {
    if (!this.context?.enabled) return; this.deps.closeDrawers(); this.editing = edit ?? null; this.editKey = crypto.randomUUID(); const form = $<HTMLFormElement>('#wiki-form'); form.reset();
    for (const [key, value] of Object.entries({ slug: edit?.page.slug ?? '', title: edit?.version.title ?? '', body: edit?.version.body ?? '', expectedVersion: String(edit?.version.status === 'conflict' ? edit.page.headVersion : edit?.version.version ?? 0) })) (form.elements.namedItem(key) as HTMLInputElement).value = value;
    (form.elements.namedItem('slug') as HTMLInputElement).readOnly = !!edit;
    const select = form.elements.namedItem('scopeRef') as HTMLSelectElement; select.replaceChildren();
    for (const s of this.context.scopes) { const o = node('option', s.label); o.value = s.id; select.append(o); } select.value = edit?.page.scopeRef ?? this.context.scopes[0]!.id; select.disabled = !!edit;
    const sources = $('#wiki-sources'); sources.replaceChildren(); const refs = edit?.version.sourceRefs ?? [];
    const choices = [...this.context.sources.map(m => ({ ref: { kind: 'message', id: m.id }, label: m.label })), ...refs.filter(r => r.kind !== 'message' || !this.context!.sources.some(m => m.id === r.id)).map(ref => ({ ref, label: `${ref.kind} · ${ref.id}${ref.version ? ' v' + ref.version : ''}` }))];
    for (const c of choices) { const label = node('label'); const input = node('input'); input.type = 'checkbox'; input.name = 'sourceRef'; input.value = JSON.stringify(c.ref); input.checked = refs.some(r => r.kind === c.ref.kind && r.id === c.ref.id); label.append(input, node('span', c.label)); sources.append(label); }
    $('#wiki-form-state').textContent = '저장 시 expectedVersion을 대조합니다. 충돌하면 입력을 덮어쓰지 않고 제안으로 보존합니다.'; $<HTMLDialogElement>('#wiki-form-dialog').showModal();
  }
  private async save(): Promise<void> {
    const f = new FormData($<HTMLFormElement>('#wiki-form')); const edit = this.editing;
    const input = { ...(edit ? { pageId: edit.page.id } : { slug: f.get('slug') }), title: f.get('title'), body: f.get('body'), scopeRef: edit?.page.scopeRef ?? f.get('scopeRef'), expectedVersion: Number(f.get('expectedVersion')), sourceRefs: f.getAll('sourceRef').map(v => JSON.parse(String(v)) as unknown), tombstone: f.has('tombstone') };
    try { const result = await this.deps.api<{ pageId: string }>(this.path('/wiki'), input, this.editKey); $<HTMLDialogElement>('#wiki-form-dialog').close(); await this.deps.refresh(); await this.open(result.pageId); }
    catch (e) { $('#wiki-form-state').textContent = '저장하지 못했습니다. 버전 충돌은 변경 기록의 충돌 제안으로 남습니다. 이 입력을 유지한 채 최신 기록을 확인하세요.'; await this.deps.refresh(); throw e; }
  }
  private async grants(): Promise<void> {
    if (!this.context?.enabled) return; this.deps.closeDrawers(); const roomId = this.context.roomId; const request = ++this.opening; const form = $<HTMLFormElement>('#resident-grant-form'); form.reset(); $('#resident-grant-token').textContent = '';
    const select = form.elements.namedItem('participantId') as HTMLSelectElement; select.replaceChildren();
    for (const p of this.context.participants) { const o = node('option', p.label); o.value = p.id; select.append(o); }
    const scope = form.elements.namedItem('scopeRef') as HTMLSelectElement; scope.replaceChildren(); for (const s of this.context.scopes) { const o = node('option', s.label); o.value = s.id; scope.append(o); }
    this.captureGrant(); const result = await this.deps.api<{ grants: { id: string; participantId: string; tools: string[]; expiresAt: string; active: boolean }[] }>(this.path('/grants'));
    if (!this.context || this.context.roomId !== roomId || this.opening !== request) return;
    const target = $('#resident-grant-list'); target.replaceChildren(); for (const g of result.grants) { const row = node('section', '', 'work-card'); row.append(node('p', `${g.participantId} · ${g.active ? '유효' : '만료·폐기·이전 세대'}\n${g.tools.join(', ')}\n${g.expiresAt}`, 'small pre-line')); if (g.active) row.append(this.button('이 접근 권한 폐기', async () => { await this.deps.api(this.path('/grants/revoke'), { id: g.id }); await this.grants(); })); target.append(row); }
    $<HTMLDialogElement>('#resident-grant-dialog').showModal();
  }
  private captureGrant(): void { const p = this.context?.participants.find(p => p.id === $<HTMLSelectElement>('#resident-grant-form [name=participantId]').value); this.grantVersion = p && this.context ? { generation: p.generation, seatVersion: p.seatVersion, epoch: this.context.epoch } : null; }
  private async createGrant(): Promise<void> {
    if (!this.grantVersion) return; const f = new FormData($<HTMLFormElement>('#resident-grant-form')); const roomId = this.context!.roomId;
    const result = await this.deps.api<{ id: string; token: string }>(this.path('/grants'), { participantId: f.get('participantId'), scopeRef: f.get('scopeRef'), scopeVersion: this.grantVersion.seatVersion, contextGeneration: this.grantVersion.generation, expectedEpoch: this.grantVersion.epoch, tools: f.getAll('tool'), expiresAt: new Date(String(f.get('expiresAt'))).toISOString() });
    if (this.context?.roomId !== roomId || !$<HTMLDialogElement>('#resident-grant-dialog').open) return;
    $('#resident-grant-token').textContent = `한 번만 표시되는 참여자 전용 키입니다. 대화/Wiki에 붙이지 마세요.\nMCP: ${location.origin}/mcp\nAuthorization: Bearer ${result.token}\nGrant: ${result.id}`;
  }
}
