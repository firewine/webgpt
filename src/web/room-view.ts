import type { Connection, Member, CodexJob, Discussion, MaterialPackage } from '../workspace/model.js';
import type { RoomSummary, RoomMessage, ResidentTurn, ResidentCheckpoint } from '../workspace/resident-model.js';
import type { ResidentStatusProjection } from '../workspace/resident-status.js';

type Message = Omit<RoomMessage, 'text'> & { preview: string; truncated: boolean; textLength: number; digest: string };
type Turn = Pick<ResidentTurn, 'id' | 'participantId' | 'status' | 'generation' | 'epoch' | 'startedAt' | 'finishedAt' | 'error' | 'messageId' | 'proposalsStatus'>;
type RoomDetail = { room: RoomSummary; enabled: boolean; dispatchAvailable: boolean; contexts: { participantId: string; generation: number; checkpointId: string | null }[]; status: ResidentStatusProjection };
export type RoomSnapshot = {
  participants: Member[]; connections: Connection[]; jobs: CodexJob[];
  discussions: Pick<Discussion, 'id' | 'topic' | 'status' | 'phase' | 'revision' | 'createdAt' | 'updatedAt'>[];
  materialPackages: { id: string; label: string; files: Omit<MaterialPackage['files'][number], 'text' | 'identity'>[] }[];
  resident: { enabled: boolean; rooms: RoomSummary[] };
};
type Dependencies = {
  api: <T>(path: string, body?: unknown, requestId?: string) => Promise<T>;
  refresh: () => Promise<void>; report: (error: unknown) => void;
  openView: (view: 'connections' | 'execution' | 'discussion') => void;
  openDiscussion: (id: string) => Promise<void>; startFocus: (roomId: string) => void;
};
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.querySelector<T>(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; }
function stored(key: string): string | null { try { return localStorage.getItem('wj.room.' + key); } catch { return null; } }
function save(key: string, value: string): void { try { localStorage.setItem('wj.room.' + key, value); } catch { /* Display still works without browser storage. */ } }
function date(value: string | null): string { return value ? new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '관측 없음'; }
const labels: Record<string, string> = { off: '꺼짐', on: '상주 중', sleeping: '휴면', blocked: '확인 필요', budget_exhausted: '진행 한도 소진', unknown: '미관측', not_run: '미실행', not_applicable: '해당 없음', unconfirmed: '응답 미확인', stale: '이전 세대', prepared: '전송 준비', running: '진행 중', completed: '완료', failed: '실패', fixture: '모의', connected: '연결됨', auth_required: '로그인 필요', queued: '실행 대기', blocked_approval: '승인 대기', reconciling: '대조 필요', interrupted: '중단', waiting: '응답 대기', ready: '준비됨' };
const label = (value: string): string => labels[value] ?? value;

// One client for the existing owner API/SSE lifecycle. This view never dispatches
// on render/reconnect, probes capabilities, or owns a second EventSource.
export class RoomView {
  private snapshot: RoomSnapshot | null = null;
  private detail: RoomDetail | null = null;
  private roomId = '';
  private messages = new Map<string, Message>();
  private originals = new Map<string, string>();
  private rows = new Map<string, HTMLElement>();
  private expanded = new Set<string>();
  private noticeIds = new Set<string>();
  private turns: Turn[] = [];
  private after = 0;
  private before = 0;
  private read = 0;
  private openingRead = 0;
  private replyTo: string | null = null;
  private mentions = new Set<string>();
  private active = false;
  private loaded = false;
  private composing = false;
  private sending = false;
  private uncertain = false;
  private scrollTimer = 0;
  private restoreOnShow = true;
  private panelsSignature = '';
  private settingsVersion = 0;
  private boardTab = ['workspace', 'usage', 'activity'].includes(stored('boardTab') ?? '') ? stored('boardTab')! : 'workspace';
  private boardClosed = stored('boardClosed') === 'true';
  constructor(private readonly deps: Dependencies) {
    this.on('#room-power', async () => { if (!this.detail) return; await this.control(this.detail.room.desiredOn ? 'off' : 'on'); });
    this.on('#room-wake', () => this.control('wake'));
    this.on('#room-settings', () => this.settings());
    this.on('#room-more', () => this.loadOlder());
    this.on('#room-unread', () => this.jumpUnread());
    this.on('#room-latest', () => { const target = $('#room-timeline'); target.scrollTop = target.scrollHeight; this.markRead(); });
    this.on('#room-connections', () => this.navigate('connections'));
    this.on('#room-execution', () => this.navigate('execution'));
    this.on('#room-material-manage', () => { this.closeDrawers(); this.deps.startFocus(this.roomId); $<HTMLDetailsElement>('.material-controls').open = true; $('.material-controls').scrollIntoView(); });
    this.on('#room-focus-new', () => { if (this.roomId) { this.closeDrawers(); this.deps.startFocus(this.roomId); } });
    this.on('#room-member-toggle', () => this.drawer('#room-members-dialog', '#room-member-panel', '#room-members-slot'));
    this.on('#room-panel-toggle', () => { if (innerWidth >= 1280) this.setBoardClosed(!this.boardClosed); else this.drawer('#room-panel-dialog', '#room-panel', '#room-panel-slot'); });
    this.on('#room-panel-close', () => { if ($<HTMLDialogElement>('#room-panel-dialog').open) $<HTMLDialogElement>('#room-panel-dialog').close(); else this.setBoardClosed(true); });
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-board-tab]')];
    for (const b of tabs) {
      b.addEventListener('click', () => this.selectBoardTab(b.dataset.boardTab!));
      b.addEventListener('keydown', e => { const index = tabs.indexOf(b); const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
        if (next >= 0) { e.preventDefault(); const tab = tabs[next]!; this.selectBoardTab(tab.dataset.boardTab!); tab.focus(); }
      });
    }
    this.selectBoardTab(this.boardTab); this.setBoardClosed(this.boardClosed);
    this.on('#room-mention-add', () => this.addMention($<HTMLSelectElement>('#room-mention-select').value));
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-close-drawer]')) b.addEventListener('click', () => b.closest('dialog')?.close());
    $('#room-members-dialog').addEventListener('close', () => { $('.sidebar').insertBefore($('#room-member-panel'), $('.sidebar-heading:not(#room-member-panel .sidebar-heading)')); });
    $('#room-panel-dialog').addEventListener('close', () => { $('#view-room').append($('#room-panel')); $('#room-panel-toggle').setAttribute('aria-expanded', String(innerWidth >= 1280 && !this.boardClosed)); });
    window.addEventListener('resize', () => { if (innerWidth > 900) this.closeDrawers(); });
    $('#room-timeline').addEventListener('scroll', () => { clearTimeout(this.scrollTimer); this.scrollTimer = window.setTimeout(() => { this.rememberPosition(); this.markRead(); }, 100); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.markRead(); });
    const input = $<HTMLTextAreaElement>('#room-text');
    input.addEventListener('compositionstart', () => { this.composing = true; });
    input.addEventListener('compositionend', () => { this.composing = false; });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { if (this.composing || event.isComposing || event.keyCode === 229) return; event.preventDefault(); $<HTMLFormElement>('#room-message-form').requestSubmit(); } });
    input.addEventListener('input', () => this.suggestions());
    $('#room-message-form').addEventListener('submit', event => { event.preventDefault(); if (this.composing || this.sending || this.uncertain) return; void this.send().catch(this.deps.report); });
    $('#room-settings-form').addEventListener('submit', event => { event.preventDefault(); void this.saveSettings().catch(this.deps.report); });
    const theme = stored('theme') ?? 'light'; document.documentElement.dataset.theme = theme; this.themeLabel();
    this.on('#theme-toggle', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; save('theme', theme); this.themeLabel(); });
  }
  private on(id: string, action: () => unknown): void { $(id).addEventListener('click', () => { void Promise.resolve().then(action).catch(this.deps.report); }); }
  private btn(text: string, action: () => unknown, cls = ''): HTMLButtonElement { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; void Promise.resolve().then(action).catch(this.deps.report).finally(() => { b.disabled = false; }); }); return b; }
  private themeLabel(): void { const dark = document.documentElement.dataset.theme === 'dark'; const b = $('#theme-toggle'); b.textContent = dark ? '☀' : '☾'; b.setAttribute('aria-label', dark ? '밝은 테마' : '어두운 테마'); b.title = dark ? '밝은 테마' : '어두운 테마'; b.setAttribute('aria-pressed', String(dark)); }
  private selectBoardTab(value: string): void {
    this.boardTab = value; save('boardTab', value);
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-board-tab]')) { const active = b.dataset.boardTab === value; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; }
    for (const key of ['workspace', 'usage', 'activity']) $(`#board-${key}`).hidden = key !== value;
  }
  private setBoardClosed(closed: boolean): void { this.boardClosed = closed; save('boardClosed', String(closed)); $('#view-room').classList.toggle('board-closed', closed); $('#room-panel-toggle').setAttribute('aria-expanded', String(innerWidth >= 1280 && !closed)); }
  setActive(active: boolean): void {
    const entering = active && !this.active;
    if (!active && this.active) { this.rememberPosition(); this.closeDrawers(); }
    this.active = active; $('#workspace').classList.toggle('room-mode', active);
    $('#room-member-panel').hidden = !active;
    $(active ? '#room-theme-slot' : '#theme-home').append($('#theme-toggle'));
    if (entering) requestAnimationFrame(() => { if (this.loaded) { this.restorePosition(); this.markRead(); } });
  }
  clear(): void {
    this.closeDrawers(); this.detail = null; this.snapshot = null; this.roomId = ''; this.messages.clear(); this.originals.clear(); this.rows.clear(); this.noticeIds.clear(); this.turns = [];
    $('#room-messages').replaceChildren(); $('#room-notices').replaceChildren(); $('#room-text').textContent = ''; $<HTMLTextAreaElement>('#room-text').value = '';
    $('#room-raw').replaceChildren(); $('#room-members').replaceChildren(); $('#room-status').replaceChildren(); $('#room-records').replaceChildren();
    this.replyTo = null; this.mentions.clear(); this.uncertain = false; this.sending = false; this.panelsSignature = ''; this.restoreOnShow = true; this.loaded = false; this.renderReply();
  }
  async refresh(snapshot: RoomSnapshot): Promise<void> {
    this.snapshot = snapshot;
    const next = snapshot.resident.rooms.find(r => r.id === this.roomId) ?? snapshot.resident.rooms[0];
    if (!next) {
      this.detail = null; $('#room-disabled').hidden = false; $('#room-state').textContent = '상주 기능 꺼짐 · 기존 토의와 연결은 보존됩니다';
      for (const id of ['#room-send', '#room-power', '#room-settings', '#room-focus-new']) $<HTMLButtonElement>(id).disabled = true;
      this.renderMembers(snapshot, [], []); return;
    }
    if (this.roomId !== next.id) {
      this.loaded = false; this.messages.clear(); this.originals.clear(); this.rows.clear(); this.noticeIds.clear(); $('#room-messages').replaceChildren(); $('#room-notices').replaceChildren();
      this.roomId = next.id; this.after = Math.max(0, next.lastMessageSequence - 50); this.before = this.after;
      this.read = Math.min(next.lastMessageSequence, Math.max(0, Number(stored(this.roomId + '.read')) || 0)); this.openingRead = this.read;
      this.restoreOnShow = true;
      try { const value: unknown = JSON.parse(stored(this.roomId + '.expanded') ?? '[]'); this.expanded = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []); } catch { this.expanded.clear(); }
      this.replyTo = stored(this.roomId + '.reply');
      // An older reading position may be outside the newest page. Resume from
      // its actual server sequence, retaining the 50-item API page boundary.
      try {
        const anchor = JSON.parse(stored(this.roomId + '.anchor') ?? 'null') as { bottom?: unknown; id?: unknown } | null;
        if (anchor?.bottom === false && typeof anchor.id === 'string' && /^[\w-]+$/.test(anchor.id)) {
          const original = await this.deps.api<{ message: RoomMessage }>(this.path('/messages/' + anchor.id));
          this.after = Math.min(this.after, Math.max(0, original.message.sequence - 1)); this.before = this.after;
        }
      } catch { /* A missing/stale local anchor cannot invalidate server history. */ }
    }
    const anchor = this.position();
    this.detail = await this.deps.api<RoomDetail>(this.path());
    await this.loadNew();
    // Earlier settled attempts are immutable. Refresh the last page (including
    // any live attempt), then read newly appended metadata without replaying it all.
    let offset = Math.max(0, this.turns.length - 100); const turns = this.turns.slice(0, offset);
    for (;;) {
      const page = await this.deps.api<{ turns: Turn[]; hasMore: boolean }>(this.path(`/turns?after=${offset}&limit=100`));
      turns.push(...page.turns); offset += page.turns.length; if (!page.hasMore || !page.turns.length) break;
    }
    this.turns = turns;
    this.render(); this.loaded = true; this.applyPosition(anchor);
    if (this.active) { if (this.restoreOnShow) this.restorePosition(); requestAnimationFrame(() => this.markRead()); }
  }
  private path(suffix = ''): string { return '/api/rooms/' + this.roomId + suffix; }
  private async control(action: string, more: Record<string, unknown> = {}, expectedVersion = this.detail?.room.version): Promise<void> {
    if (!this.detail) return;
    try { await this.deps.api(this.path('/control'), { action, expectedVersion, ...more }); }
    finally { await this.deps.refresh(); }
  }
  private async loadNew(): Promise<void> {
    let more = true;
    while (more) {
      const page = await this.deps.api<{ messages: Message[]; nextAfter: number; hasMore: boolean }>(this.path(`/messages?after=${this.after}&limit=50`));
      for (const m of page.messages) this.messages.set(m.id, m);
      if (page.nextAfter <= this.after) break; this.after = page.nextAfter; more = page.hasMore;
    }
  }
  private async loadOlder(): Promise<void> {
    if (this.before <= 0) return; const anchor = this.position();
    const before = Math.max(0, this.before - 50);
    const page = await this.deps.api<{ messages: Message[] }>(this.path(`/messages?after=${before}&limit=50`));
    for (const m of page.messages) this.messages.set(m.id, m);
    this.before = before; this.renderMessages(); this.applyPosition(anchor); $('#room-more').hidden = !this.before;
  }
  private render(): void {
    const d = this.detail; if (!d || !this.snapshot) return; const room = d.room;
    $('#room-title').textContent = room.title;
    $('#room-state').textContent = `${label(room.observedStatus)}${room.topicLink ? ' · 주제 토론 중' : ''}${room.reason ? ' · ' + room.reason : ''}`;
    $('#room-state').dataset.state = room.observedStatus;
    $('#room-power').textContent = room.desiredOn ? '방 끄기' : '방 켜기'; $('#room-power').setAttribute('aria-pressed', String(room.desiredOn));
    $('#room-power').title = '방을 끄면 새 발언을 멈춥니다. 이미 시작한 Codex 실행은 실행 화면에서 별도로 중단합니다.';
    $<HTMLButtonElement>('#room-power').disabled = !d.enabled || !d.dispatchAvailable;
    $('#room-wake').hidden = !room.desiredOn || room.observedStatus === 'on'; $<HTMLButtonElement>('#room-wake').disabled = !d.enabled;
    $('#room-disabled').hidden = d.enabled; $<HTMLButtonElement>('#room-send').disabled = !d.enabled || this.sending || this.uncertain;
    $<HTMLButtonElement>('#room-focus-new').disabled = !d.enabled || !!room.topicLink;
    $<HTMLButtonElement>('#room-settings').disabled = !d.enabled;
    $('#room-pacing').textContent = room.pacing ? `발언 간격 ${room.pacing.minIntervalMs / 1000}초\n연속 pass ${room.pacing.sleepAfterPasses}회 후 휴면` : '진행 한도와 대화 속도를 설정하세요.';
    this.renderMessages(); this.renderReply(); this.renderPanels(); this.unread();
    $('#room-more').hidden = !this.before;
    for (const n of d.status.notices) if (!this.noticeIds.has(n.id)) {
      this.noticeIds.add(n.id); const p = el('p', '', 'system-message'); p.dataset.noticeId = n.id; p.append(el('span', n.text), el('time', date(n.at))); $('#room-notices').append(p);
    }
  }
  private name(id: string): string { return id === 'owner' ? '나' : this.snapshot?.participants.find(p => p.id === id)?.label ?? (id === 'system' ? '시스템' : id); }
  private tone(id: string): string { return id === 'owner' ? 'owner' : String(Math.max(0, this.snapshot?.participants.findIndex(p => p.id === id) ?? 0) % 5); }
  private avatar(id: string): HTMLElement {
    const p = this.snapshot?.participants.find(p => p.id === id); const initial = id === 'owner' ? '나' : p?.kind === 'fake' ? p.label.match(/[A-Z]$/)?.[0] ?? Array.from(p.label)[0] ?? 'F' : Array.from(this.name(id))[0] ?? '?';
    const avatar = el('span', initial, 'avatar'); avatar.dataset.tone = this.tone(id); avatar.setAttribute('aria-hidden', 'true'); return avatar;
  }
  private renderMessages(): void {
    const target = $('#room-messages');
    let previous: HTMLElement | null = null;
    for (const m of [...this.messages.values()].sort((a, b) => a.sequence - b.sequence)) {
      let row = this.rows.get(m.id);
      if (!row) {
        row = el('article', '', 'room-message' + (m.authorId === 'owner' ? ' mine' : '') + (m.sourceKind === 'system' ? ' system' : ''));
        row.id = 'msg-' + m.id; row.dataset.messageId = m.id; row.dataset.sequence = String(m.sequence); row.dataset.tone = this.tone(m.authorId);
        const head = el('header', '', 'message-head'); const avatar = this.avatar(m.authorId); const name = el('strong', this.name(m.authorId));
        const timestamp = el('time', new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })); timestamp.dateTime = m.createdAt; timestamp.title = date(m.createdAt);
        const model = this.snapshot?.participants.find(p => p.id === m.authorId); head.append(avatar, name, el('span', model?.kind === 'fake' ? '모의' : model?.kind === 'browser' ? '기존 대화' : model?.modelId ?? '', 'message-model'), timestamp, el('span', m.sourceKind === 'topic' ? '주제 토론' : '', 'message-mode'));
        row.append(head);
        if (m.replyTo) { const ref = this.messages.get(m.replyTo); const b = this.btn('↳ ' + (ref ? this.name(ref.authorId) + ' · ' + ref.preview.slice(0, 90) : '인용한 원문 보기'), () => this.jump(m.replyTo!)); b.className = 'message-quote'; b.dataset.replyTo = m.replyTo; row.append(b); }
        const text = el('div', m.preview, 'message-text'); text.dataset.digest = m.digest; row.append(text);
        if (m.truncated) {
          const toggle = this.btn(`전체 ${m.textLength.toLocaleString()}자 펼치기`, async () => {
            const opening = !this.expanded.has(m.id);
            if (opening) {
              const value = await this.original(m); this.expanded.add(m.id); text.textContent = value; toggle.textContent = '접기';
            } else { this.expanded.delete(m.id); text.textContent = m.preview; toggle.textContent = `전체 ${m.textLength.toLocaleString()}자 펼치기`; }
            text.classList.toggle('expanded', opening); save(this.roomId + '.expanded', JSON.stringify([...this.expanded].slice(-200))); this.rememberPosition();
          }, 'message-expand'); row.append(toggle);
          if (this.expanded.has(m.id)) void this.original(m).then(value => { const anchor = this.position(); text.textContent = value; text.classList.add('expanded'); toggle.textContent = '접기'; this.applyPosition(anchor); }).catch(this.deps.report);
        }
        if (m.mentions.length) row.append(el('div', m.mentions.map(id => '@' + this.name(id)).join(' '), 'message-mentions'));
        const actions = el('div', '', 'message-actions');
        actions.append(this.btn('답장', () => { this.replyTo = m.id; save(this.roomId + '.reply', m.id); this.renderReply(); $('#room-text').focus(); }), this.btn('원문·근거', () => this.raw(m)));
        row.append(actions); this.rows.set(m.id, row);
      }
      if (previous ? previous.nextElementSibling !== row : target.firstElementChild !== row) target.insertBefore(row, previous ? previous.nextElementSibling : target.firstChild);
      previous = row;
    }
    if (!this.messages.size && !target.children.length) target.textContent = '';
  }
  private async original(m: Message): Promise<string> {
    const saved = this.originals.get(m.id); if (saved !== undefined) return saved;
    const result = await this.deps.api<{ message: RoomMessage; digest: string }>(this.path('/messages/' + m.id));
    const bytes = new TextEncoder().encode(result.message.text);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (result.digest !== m.digest || hash !== m.digest) throw new Error('원문 해시가 일치하지 않습니다. 기록을 대조하세요.');
    this.originals.set(m.id, result.message.text); return result.message.text;
  }
  private renderReply(): void {
    const target = $('#room-reply'); target.replaceChildren(); target.hidden = !this.replyTo;
    if (this.replyTo) { const m = this.messages.get(this.replyTo); target.append(el('span', '답장 · ' + (m ? this.name(m.authorId) + ': ' + m.preview.slice(0, 100) : '선택한 원문')), this.btn('답장 취소', () => { this.replyTo = null; save(this.roomId + '.reply', ''); this.renderReply(); })); }
    const mentions = $('#room-mentions'); mentions.replaceChildren();
    for (const id of this.mentions) mentions.append(this.btn('@' + this.name(id) + ' ×', () => { this.mentions.delete(id); this.renderReply(); }, 'mention-chip'));
  }
  private addMention(id: string): void {
    if (!id) return; if (this.mentions.size >= 8 && !this.mentions.has(id)) throw new Error('한 메시지에서 최대 8명을 멘션할 수 있습니다.');
    this.mentions.add(id); this.renderReply(); $('#room-text').focus();
  }
  private suggestions(): void {
    const input = $<HTMLTextAreaElement>('#room-text'); const match = /(?:^|\s)@([^\s@]*)$/.exec(input.value.slice(0, input.selectionStart));
    const target = $('#room-suggestions'); target.replaceChildren(); target.hidden = !match;
    if (!match) return;
    const query = match[1]!.toLocaleLowerCase();
    for (const m of this.detail?.room.members ?? []) { const name = this.name(m.participantId); if (!name.toLocaleLowerCase().includes(query)) continue;
      target.append(this.btn('@' + name, () => { const start = input.selectionStart; input.setRangeText('@' + name + ' ', start - match[1]!.length - 1, start, 'end'); this.addMention(m.participantId); target.hidden = true; }));
    }
  }
  private async send(): Promise<void> {
    const input = $<HTMLTextAreaElement>('#room-text'); const text = input.value; if (!text.trim() || !this.detail?.enabled) return;
    this.sending = true; $<HTMLButtonElement>('#room-send').disabled = true; $('#room-send-state').textContent = '저장 중…';
    try {
      await this.deps.api(this.path('/messages'), { text, replyTo: this.replyTo || null, mentions: [...this.mentions] });
      input.value = ''; this.replyTo = null; save(this.roomId + '.reply', ''); this.mentions.clear(); this.renderReply(); $('#room-suggestions').hidden = true; $('#room-send-state').textContent = '저장했습니다.';
      await this.deps.refresh(); const target = $('#room-timeline'); target.scrollTop = target.scrollHeight; this.markRead();
    } catch (error) {
      if (error instanceof Error && error.message === 'request_unconfirmed') {
        this.uncertain = true; $('#room-send-state').replaceChildren(el('span', '저장 결과 미확인 · 원래 메시지를 확인해 주세요. 자동으로 다시 보내지 않습니다.'), this.btn('이력 새로 확인', () => this.deps.refresh()), this.btn('대조 완료 · 입력 잠금 해제', () => { this.uncertain = false; $('#room-send-state').textContent = '원래 입력을 보존했습니다. 이력 확인 후 필요한 경우 직접 보내세요.'; $<HTMLButtonElement>('#room-send').disabled = !this.detail?.enabled; }));
      }
      throw error;
    } finally { this.sending = false; $<HTMLButtonElement>('#room-send').disabled = !this.detail?.enabled || this.uncertain; }
  }
  private position(): { bottom: boolean; id: string | null; offset: number } {
    const target = $('#room-timeline'); const rect = target.getBoundingClientRect();
    const first = [...target.querySelectorAll<HTMLElement>('.room-message')].find(row => row.getBoundingClientRect().bottom > rect.top);
    return { bottom: target.scrollHeight - target.scrollTop - target.clientHeight < 55, id: first?.dataset.messageId ?? null, offset: first ? first.getBoundingClientRect().top - rect.top : 0 };
  }
  private applyPosition(value: ReturnType<RoomView['position']>): void {
    const target = $('#room-timeline'); if (value.bottom) target.scrollTop = target.scrollHeight;
    else if (value.id) { const row = this.rows.get(value.id); if (row) target.scrollTop += row.getBoundingClientRect().top - target.getBoundingClientRect().top - value.offset; }
  }
  private rememberPosition(): void { if (!this.active || !this.roomId || this.restoreOnShow) return; save(this.roomId + '.anchor', JSON.stringify(this.position())); }
  private restorePosition(): void {
    if (!this.restoreOnShow || !this.active) return; this.restoreOnShow = false;
    try { const saved = JSON.parse(stored(this.roomId + '.anchor') ?? 'null') as ReturnType<RoomView['position']> | null;
      if (saved && typeof saved.bottom === 'boolean' && typeof saved.offset === 'number') { this.applyPosition(saved); return; }
    } catch { /* A broken local cursor cannot alter server state. */ }
    const target = $('#room-timeline'); target.scrollTop = target.scrollHeight;
  }
  private markRead(): void {
    if (!this.active || document.hidden || !this.detail || this.restoreOnShow) return;
    const rect = $('#room-timeline').getBoundingClientRect();
    for (const row of this.rows.values()) { const head = row.querySelector('.message-head')!.getBoundingClientRect(); if (head.bottom > rect.top && head.top < rect.bottom) this.read = Math.max(this.read, Number(row.dataset.sequence)); }
    save(this.roomId + '.read', String(this.read)); this.unread();
  }
  private unread(): void {
    const count = [...this.messages.values()].filter(m => m.sequence > this.read).length;
    $('#room-unread').hidden = count === 0; $('#room-unread').textContent = `읽지 않은 메시지 ${count}개로 이동 ↑`;
    for (const row of this.rows.values()) row.classList.toggle('was-unread', this.openingRead > 0 && Number(row.dataset.sequence) === this.openingRead + 1);
  }
  private async jumpUnread(): Promise<void> { const m = [...this.messages.values()].sort((a, b) => a.sequence - b.sequence).find(m => m.sequence > this.read); if (m) await this.jump(m.id); }
  private async jump(id: string): Promise<void> {
    if (!this.messages.has(id)) {
      const result = await this.deps.api<{ message: RoomMessage; digest: string }>(this.path('/messages/' + id)); const m = result.message;
      this.messages.set(id, { ...m, preview: m.text.slice(0, 500), truncated: m.text.length > 500, textLength: m.text.length, digest: result.digest }); this.originals.set(id, m.text); this.renderMessages();
    }
    const row = this.rows.get(id); if (row) { row.scrollIntoView({ block: 'start' }); row.tabIndex = -1; row.focus({ preventScroll: true }); this.markRead(); this.rememberPosition(); }
  }
  private renderPanels(): void {
    const d = this.detail!; const s = this.snapshot!; const r = d.room;
    const signature = JSON.stringify([r, d.contexts, d.status.members, s.participants, s.connections, s.jobs, s.materialPackages, this.turns]);
    if (signature === this.panelsSignature) return; this.panelsSignature = signature;
    this.renderMembers(s, r.members, d.status.members);
    const usage = $('#room-usage'); usage.replaceChildren();
    if (!r.budgets) usage.append(el('p', '한도·속도 설정이 필요합니다.', 'small muted'));
    else { const used = r.used; usage.append(el('p', `요청 ${used?.requests ?? 0} / ${r.budgets.maxRequests}`, 'usage-number'), el('p', `보고 토큰 ${(used?.inputTokens ?? 0) + (used?.outputTokens ?? 0)} / ${r.budgets.maxTokens}\n사용량 미제공 ${used?.unknownUsage ?? 0}회 · 도구 ${used?.toolJobs ?? 0} / ${r.budgets.maxToolJobs}\n종료 ${date(r.budgets.deadlineAt)}`, 'small pre-line'));
      if (r.nextEligibleAt) usage.append(el('p', '다음 발언 가능 ' + date(r.nextEligibleAt), 'small muted'));
    }
    const focus = $('#room-focus'); focus.replaceChildren(); const topic = s.discussions.find(t => t.id === r.topicLink);
    if (topic) focus.append(el('p', topic.topic), this.btn('토론·비교·검증 열기', () => { this.closeDrawers(); return this.deps.openDiscussion(topic.id); }));
    else focus.append(el('p', '자유 대화 · 주제 토론을 마치면 같은 방으로 돌아옵니다.', 'small muted'));
    const statuses = $('#room-status'); statuses.replaceChildren();
    for (const c of d.status.members) { const card = el('section', '', 'status-card'); card.append(el('h3', this.name(c.participantId) + ` · 문맥 ${c.generation}${c.previousGeneration ? ' · 이전 세대 응답' : ''}`));
      const sources: Record<string, string> = { connection: '등록한 연결', resident_turn: '발언 기록', unobserved: '확인된 관측 없음', work_queue_pending: '작업큐 준비 중', codex_job: 'Codex 실행 기록', fake: '모의 관측', browser: 'Chrome 관측', 'openai-oauth': 'GPT 응답', deepseek: 'DeepSeek 응답' };
      for (const [title, a] of [['연결', c.connection], ['응답', c.response], ['도구', c.tool], ['업무', c.work]] as const) card.append(el('p', `${title} · ${label(a.state)}\n${date(a.observedAt)} · ${sources[a.source] ?? '기록된 관측'}${a.reason ? '\n확인 사유: ' + a.reason : ''}`, 'small pre-line'));
      card.append(el('p', `마지막 발언 ${date(c.lastSpeechAt)}\n마지막 진행 ${date(c.lastProgressAt)}`, 'small muted pre-line')); statuses.append(card);
    }
    const materials = $('#room-materials'); materials.replaceChildren();
    if (!s.materialPackages.length) materials.append(el('p', '저장한 참고 자료가 없습니다.', 'small muted'));
    for (const m of s.materialPackages) materials.append(el('p', `${m.label} · ${m.files.length}개 파일\n주제 토론에서 직접 선택해 공유합니다.`, 'small pre-line'));
    const jobs = $('#room-jobs'); jobs.replaceChildren();
    const related = s.jobs.filter(j => !!j.discussionId && (j.discussionId === r.topicLink || r.legacyDiscussionIds.includes(j.discussionId)));
    for (const j of related) jobs.append(this.btn(`${label(j.status)} · ${j.id}${j.approvals.some(a => a.status === 'pending') ? ' · 승인 필요' : ''}`, () => this.navigate('execution')));
    if (!related.length) jobs.append(el('p', '연결된 실행 기록이 없습니다.', 'small muted'));
    const records = $('#room-records'); records.replaceChildren();
    for (const t of this.turns.filter(t => ['prepared', 'running', 'unconfirmed', 'stale', 'failed'].includes(t.status) || t.proposalsStatus === 'not_run')) {
      const card = el('section', '', 'status-card'); card.append(el('p', `${this.name(t.participantId)} · ${label(t.status)} · 문맥 ${t.generation}${t.proposalsStatus === 'not_run' ? '\n업무·Wiki 제안 미실행' : ''}`, 'small pre-line'), this.btn('요청 원본', () => this.rawTurn(t.id)));
      if (t.status === 'unconfirmed') for (const [resolution, title] of [['completed', '완료 응답 반영'], ['not_sent', '미전송 확인'], ['skip', '건너뛰기']] as const) card.append(this.btn(title, () => this.reconcile(t, resolution)));
      records.append(card);
    }
    for (const c of d.contexts) {
      if (c.checkpointId) records.append(this.btn(this.name(c.participantId) + ' 인계 원문', async () => { const result = await this.deps.api<{ checkpoint: ResidentCheckpoint }>(this.path('/checkpoints/' + c.checkpointId)); this.showRaw(JSON.stringify(result, null, 2)); }));
      if (s.participants.find(p => p.id === c.participantId)?.kind !== 'browser') records.append(this.btn(this.name(c.participantId) + ' 문맥 인계', async () => { await this.deps.api(this.path('/handoff'), { participantId: c.participantId, expectedEpoch: r.epoch, expectedGeneration: c.generation }); await this.deps.refresh(); }));
    }
    if (!records.children.length) records.append(el('p', '미확정 발언이나 인계 기록이 없습니다.', 'small muted'));
  }
  private renderMembers(s: RoomSnapshot, roomMembers: RoomSummary['members'], statuses: ResidentStatusProjection['members']): void {
    const members = $('#room-members'); members.replaceChildren(); $('#room-member-count').textContent = String(s.participants.length);
    const select = $<HTMLSelectElement>('#room-mention-select'); const selected = select.value; select.replaceChildren(el('option', '@ 참여자')); select.options[0]!.value = '';
    for (const p of s.participants) {
      const m = roomMembers.find(m => m.participantId === p.id); const card = el('article', '', 'room-member'); card.dataset.tone = this.tone(p.id);
      const status = statuses.find(c => c.participantId === p.id); const info = el('div', '', 'member-info'); const name = el('div', '', 'member-name');
      name.append(el('strong', p.label), el('span', p.kind === 'fake' ? '모의' : p.kind === 'openai-oauth' ? 'GPT' : p.kind === 'deepseek' ? 'API' : '웹', 'member-kind')); info.append(name);
      info.append(el('small', p.kind === 'fake' ? '외부 모델 호출 없음' : (s.connections.find(c => c.id === p.connectionId)?.label ?? '연결 미확인'), 'member-account'));
      const state = m?.blockedReason ? '확인 필요 · ' + m.blockedReason : status ? label(status.response.state) : '미참여';
      info.append(el('small', state, 'member-observed')); info.title = `${p.label}\n${p.modelId}\n${p.role}\n${state}`;
      const toggleLabel = el('label', '', 'member-toggle'); const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = !!m?.enabled; toggle.disabled = !this.detail?.enabled; toggle.setAttribute('aria-label', p.label + ' 발언 참여');
      toggle.addEventListener('change', () => { toggle.disabled = true; void this.control('set_member', { participantId: p.id, enabled: toggle.checked }).catch(this.deps.report).finally(() => { toggle.disabled = !this.detail?.enabled; }); }); toggleLabel.append(toggle, el('span', '', 'toggle-track'));
      card.append(this.avatar(p.id), info, toggleLabel); members.append(card);
      if (m) { const option = el('option', p.label); option.value = p.id; select.append(option); }
    }
    select.value = selected;
  }
  private async raw(m: Message): Promise<void> {
    const text = await this.original(m);
    const turn = m.sourceKind === 'room' && m.sourceId ? await this.deps.api(this.path('/turns/' + m.sourceId)) : null;
    this.showRaw(JSON.stringify({ message: { ...m, text }, ...(turn ? { original: turn } : {}) }, null, 2));
    if (m.sourceKind === 'topic') $('#room-raw').append(this.btn('주제 토론의 주장·근거 열기', async () => {
      for (const meta of this.snapshot?.discussions ?? []) {
        const { discussion } = await this.deps.api<{ discussion: Discussion }>('/api/discussions/' + meta.id);
        if (discussion.turns.some(t => t.id === m.sourceId)) { this.closeDrawers(); await this.deps.openDiscussion(discussion.id); return; }
      }
      throw new Error('원래 토론을 찾을 수 없습니다. 원본 참조를 확인하세요.');
    }));
  }
  private async rawTurn(id: string): Promise<void> { this.showRaw(JSON.stringify(await this.deps.api(this.path('/turns/' + id)), null, 2)); }
  private showRaw(text: string): void {
    this.selectBoardTab('activity'); this.setBoardClosed(false);
    const target = $('#room-raw'); target.replaceChildren(el('h3', '소유자용 원본'), el('pre', text)); (target.closest('details') as HTMLDetailsElement).open = true;
    if (innerWidth < 1280 && !$<HTMLDialogElement>('#room-panel-dialog').open) this.drawer('#room-panel-dialog', '#room-panel', '#room-panel-slot');
    target.scrollIntoView({ block: 'nearest' });
  }
  private async reconcile(t: Turn, resolution: 'completed' | 'not_sent' | 'skip'): Promise<void> {
    // Native owner confirmation keeps reconciliation concrete; never resubmits.
    const dialog = el('dialog'); dialog.setAttribute('aria-label', '원래 응답 대조'); const form = el('form'); form.append(el('h2', '원래 응답 대조'), el('p', `${t.id}\n실제 원격 대화·입력·시각을 확인해 주세요. 새 요청을 보내지 않습니다.`, 'small pre-line'));
    if (resolution === 'completed') for (const [name, title] of [['text', '실제 JSON 응답 원문'], ['receipt', '원래 응답 ID 또는 대화 URL']]) { const l = el('label', title); const input = name === 'text' ? el('textarea') : el('input'); input.name = name!; input.required = true; if (input instanceof HTMLTextAreaElement) input.rows = 6; l.append(input); form.append(l); }
    else form.append(el('p', resolution === 'not_sent' ? '원격 대화에 원래 요청이 없는 것을 직접 확인했을 때만 적용하세요.' : '이 응답을 건너뛰어도 원본 기록은 보존됩니다.', 'small'));
    const cancel = this.btn('닫기', () => dialog.close()); const apply = el('button', '대조 결과 적용', 'primary'); apply.type = 'submit'; form.append(cancel, apply); dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove());
    form.addEventListener('submit', event => { event.preventDefault(); apply.disabled = true; const fields = Object.fromEntries(new FormData(form));
      void this.deps.api(this.path('/turns/' + t.id + '/reconcile'), { resolution, ...fields }).then(async () => { dialog.close(); await this.deps.refresh(); }).catch(this.deps.report).finally(() => { apply.disabled = false; }); }); dialog.showModal();
  }
  private settings(): void {
    if (!this.detail) return; this.settingsVersion = this.detail.room.version; const form = $<HTMLFormElement>('#room-settings-form'); form.reset(); const { budgets: b, pacing: p } = this.detail.room;
    const values = { maxRequests: b?.maxRequests, maxTokens: b?.maxTokens, maxToolJobs: b?.maxToolJobs, deadlineAt: b ? localDate(b.deadlineAt) : undefined, minInterval: p ? p.minIntervalMs / 1000 : undefined, idleNudge: p ? p.idleNudgeMs / 1000 : undefined, passBackoff: p ? p.passBackoffMs / 1000 : undefined, sleepAfterPasses: p?.sleepAfterPasses };
    for (const [key, value] of Object.entries(values)) (form.elements.namedItem(key) as HTMLInputElement).value = value === undefined ? '' : String(value);
    $<HTMLDialogElement>('#room-settings-dialog').showModal();
  }
  private async saveSettings(): Promise<void> {
    const form = $<HTMLFormElement>('#room-settings-form'); const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!; if (submit.disabled) return; submit.disabled = true;
    const v = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try { await this.control('configure', { budgets: { maxRequests: Number(v.maxRequests), maxTokens: Number(v.maxTokens), maxToolJobs: Number(v.maxToolJobs), deadlineAt: new Date(v.deadlineAt!).toISOString() }, pacing: { minIntervalMs: Math.round(Number(v.minInterval) * 1000), idleNudgeMs: Math.round(Number(v.idleNudge) * 1000), passBackoffMs: Math.round(Number(v.passBackoff) * 1000), sleepAfterPasses: Number(v.sleepAfterPasses) } }, this.settingsVersion); $<HTMLDialogElement>('#room-settings-dialog').close(); }
    finally { submit.disabled = false; }
  }
  private drawer(dialogId: string, panel: string, slot: string): void { $(slot).append($(panel)); $(panel).hidden = false; const d = $<HTMLDialogElement>(dialogId); if (!d.open) d.showModal(); if (panel === '#room-panel') $('#room-panel-toggle').setAttribute('aria-expanded', 'true'); }
  private closeDrawers(): void { for (const id of ['#room-members-dialog', '#room-panel-dialog', '#room-settings-dialog']) { const d = $<HTMLDialogElement>(id); if (d.open) d.close(); } }
  private navigate(view: 'connections' | 'execution' | 'discussion'): void { this.closeDrawers(); this.deps.openView(view); }
}
function localDate(value: string): string { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
