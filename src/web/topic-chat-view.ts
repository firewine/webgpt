import type { Connection, Discussion, Member } from '../workspace/model.js';

export type TopicSummary = Pick<Discussion, 'id' | 'topic' | 'status' | 'phase' | 'revision' | 'createdAt' | 'updatedAt'> & { roomId?: string | null };
const phases = { independent: '독립 초기안', cross_review: '상호 검토', verification: '근거 검증', revision: '수정안', synthesis: '종합안', summary_review: '종합안 동료 검토' };
const states = { running: '진행 중', paused: '일시정지', blocked: '확인 필요', completed: '완료', partial: '부분 완료', cancelled: '취소' };
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
function read(key: string): string | null { try { return localStorage.getItem('wj.chat.' + key); } catch { return null; } }
function save(key: string, value: string): void { try { localStorage.setItem('wj.chat.' + key, value); } catch { /* Navigation also works without browser storage. */ } }
const time = (value: string): string => new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// The same publication boundary as ResidentRunner.projectFocus: an entire
// phase/round must settle, with one accepted reply per assigned participant.
// This read projection never changes the discussion or its execution scope.
export function topicPublishedTurns(d: Discussion): Discussion['turns'] {
  const result: Discussion['turns'] = [];
  for (const phase of Object.keys(phases) as Discussion['phase'][]) {
    for (const round of new Set(d.turns.filter(t => t.revision === d.revision && t.phase === phase).map(t => t.round))) {
      const tasks = d.tasks.filter(t => t.revision === d.revision && t.phase === phase && t.round === round);
      const members = [...new Set(tasks.map(t => t.participantId))];
      if (!members.length || tasks.some(t => ['pending', 'running', 'unconfirmed'].includes(t.status))) continue;
      const turns = members.map(pid => d.turns.findLast(t => t.revision === d.revision && t.phase === phase && t.round === round && t.participantId === pid && t.status === 'completed' && t.reply));
      if (turns.every(t => !!t)) result.push(...turns.filter((t): t is Discussion['turns'][number] => !!t));
    }
  }
  return result;
}
export function unregisteredConnections(participants: Member[], connections: Connection[]): Connection[] {
  return connections.filter(c => !participants.some(p => p.connectionId === c.id));
}

type Dependencies = {
  select: (id: string) => Promise<void>; details: (tab?: string) => void;
  control: (action: string) => Promise<unknown>; opinion: (text: string) => Promise<unknown>; report: (error: unknown) => void;
};
// A view over the existing selected Discussion. Its callbacks use control.ts's
// one authenticated API/SSE lifecycle; reading a topic cannot dispatch a model.
export class TopicChatView {
  private discussion: Discussion | null = null;
  private topics: TopicSummary[] = [];
  private active = false;
  private signature = '';
  private listSignature = '';
  private expanded = new Set<string>();
  private scrollTimer = 0;
  private readonly drafts = new Map<string, string>();
  private submitting = false;
  constructor(private readonly deps: Dependencies) {
    this.on('#chat-free', () => deps.select(''));
    this.on('#topic-details-open', () => deps.details());
    this.on('#topic-result-open', () => deps.details('comparison'));
    $('#topic-opinion-form').addEventListener('submit', event => {
      event.preventDefault(); if (this.submitting || !this.discussion) return;
      const input = $<HTMLTextAreaElement>('#topic-opinion-text'), id = this.discussion.id, text = input.value;
      if (!text.trim()) { input.focus(); return; }
      this.submitting = true; $<HTMLButtonElement>('#topic-opinion').disabled = true;
      void deps.opinion(text).then(() => { this.drafts.delete(id); if (this.discussion?.id === id) input.value = ''; }).catch(deps.report).finally(() => { this.submitting = false; $<HTMLButtonElement>('#topic-opinion').disabled = false; });
    });
    $('#topic-opinion-text').addEventListener('input', () => { if (this.discussion) this.drafts.set(this.discussion.id, $<HTMLTextAreaElement>('#topic-opinion-text').value); });
    this.on('#topic-pause', () => deps.control('pause'));
    this.on('#topic-resume', () => deps.control('resume'));
    this.on('#topic-latest', () => this.latest());
    this.on('#topic-unread', () => { const first = $('#topic-chat-messages').querySelector<HTMLElement>('[data-unread=true]'); if (first) first.scrollIntoView({ block: 'start' }); else this.latest(); });
    $('#topic-chat-timeline').addEventListener('scroll', () => { clearTimeout(this.scrollTimer); this.scrollTimer = window.setTimeout(() => this.remember(), 100); });
  }
  private on(id: string, action: () => unknown): void { $(id).addEventListener('click', () => { void Promise.resolve().then(action).catch(this.deps.report); }); }
  private btn(text: string, action: () => unknown): HTMLButtonElement { const button = el('button', text); button.type = 'button'; button.addEventListener('click', () => { void Promise.resolve().then(action).catch(this.deps.report); }); return button; }
  clear(): void { this.remember(); this.discussion = null; this.active = false; this.signature = ''; this.listSignature = ''; this.drafts.clear(); $<HTMLTextAreaElement>('#topic-opinion-text').value = ''; $('#history').replaceChildren(); $('#topic-chat-messages').replaceChildren(); $('#topic-speakers').replaceChildren(); }
  private position(): { top: number; bottom: boolean } { const target = $('#topic-chat-timeline'); return { top: target.scrollTop, bottom: target.scrollHeight - target.clientHeight - target.scrollTop < 60 }; }
  private remember(): void {
    if (!this.active || !this.discussion) return;
    const value = this.position(); save(this.discussion.id + '.position', JSON.stringify(value));
    if (value.bottom) { save(this.discussion.id + '.read', this.discussion.updatedAt); $('#topic-unread').hidden = true; }
  }
  private latest(): void { const timeline = $('#topic-chat-timeline'); timeline.scrollTop = timeline.scrollHeight; this.remember(); }
  render(topics: TopicSummary[], d: Discussion | null, active: boolean, selection = d?.id ?? ''): void {
    this.topics = topics;
    const listKey = JSON.stringify([topics, selection]);
    if (listKey !== this.listSignature) {
      this.listSignature = listKey; const history = $('#history'); history.replaceChildren(); $('#history-count').textContent = String(topics.length);
      for (const meta of topics.toReversed()) {
        const button = this.btn('', () => this.deps.select(meta.id)); button.className = 'topic-item' + (meta.id === selection ? ' active' : ''); button.dataset.discussionId = meta.id;
        button.setAttribute('aria-label', meta.topic); if (meta.id === selection) button.setAttribute('aria-current', 'page');
        button.dataset.roomId = meta.roomId ?? '';
        button.append(el('span', meta.topic, 'topic-name'), el('small', states[meta.status], 'topic-status'));
        button.title = meta.topic + ' · ' + states[meta.status]; history.append(button);
      }
      if (!topics.length) history.append(el('p', '새 주제를 만들면 이곳에 쌓입니다.', 'small muted'));
    }
    $('#chat-free').classList.toggle('active', !selection); $('#chat-free').setAttribute('aria-current', selection ? 'false' : 'page');
    const changed = d?.id !== this.discussion?.id;
    const entering = active && (!this.active || changed);
    const position = this.position(); if (changed || !active) this.remember();
    this.discussion = d; this.active = active;
    $('#room-free').hidden = !!selection; $('#topic-chat').hidden = !selection; $('#topic-chat').dataset.discussionId = d?.id ?? '';
    for (const id of ['#topic-details-open', '#topic-result-open', '#topic-opinion', '#topic-pause', '#topic-resume']) $<HTMLButtonElement>(id).disabled = !d || id === '#topic-opinion' && this.submitting;
    if (!d) {
      this.signature = '';
      if (selection) {
        $('#topic-chat-title').textContent = topics.find(t => t.id === selection)?.topic ?? '주제를 불러오는 중…';
        $('#topic-chat-state').textContent = '기록 조회 중'; $('#topic-chat-progress').textContent = '원래 기록을 확인한 뒤 발언과 제어를 표시합니다.';
        $('#topic-chat-criteria').textContent = ''; $('#room-title').textContent = '채팅방 · 주제별 대화'; $('#room-state').textContent = '기록 조회 중'; $('#room-state').dataset.state = 'waiting';
        $('#topic-chat-messages').replaceChildren(); $('#topic-speakers').replaceChildren(); $('#topic-chat-result').hidden = true;
        $('#topic-opinion-form').hidden = true; $('#topic-compose-note').textContent = '다른 주제의 발언이나 실행 상태를 적용하지 않습니다.';
      }
      return;
    }
    $('#room-title').textContent = '채팅방 · 주제별 대화';
    $('#room-state').textContent = states[d.status] + ' · 주제를 선택해도 실행 상태는 바뀌지 않습니다.';
    $('#room-state').dataset.state = d.status;
    const key = JSON.stringify(d); if (key === this.signature && !entering) return; this.signature = key;
    if (changed) { try { const value: unknown = JSON.parse(read(d.id + '.expanded') ?? '[]'); this.expanded = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []); } catch { this.expanded.clear(); } }
    if (changed) $<HTMLTextAreaElement>('#topic-opinion-text').value = this.drafts.get(d.id) ?? '';
    $('#topic-chat-title').textContent = d.topic; $('#topic-chat-state').textContent = states[d.status];
    $('#topic-chat-progress').textContent = `${phases[d.phase]} · ${d.round}회 · 요청 ${d.used.requests}회 · 원래 토의 기록`;
    $('#topic-chat-criteria').textContent = d.criteria;
    $('#topic-speakers').replaceChildren(...d.members.map(p => el('span', p.label + (d.excludedIds.includes(p.id) ? ' · 참여 제외' : ''), 'topic-speaker')));
    const terminal = ['completed', 'partial', 'cancelled'].includes(d.status);
    $('#topic-opinion-form').hidden = terminal; $('#topic-pause').hidden = d.status !== 'running'; $('#topic-resume').hidden = !['paused', 'blocked'].includes(d.status);
    $('#topic-compose-note').textContent = terminal ? '종료된 주제의 기록입니다. 새 주제에서 이야기를 이어갈 수 있습니다.' : '의견 반영은 추가 조건으로 새 검토를 시작합니다. 원래 발언은 보존됩니다.';
    const published = topicPublishedTurns(d), ids = new Set(published.map(t => t.id));
    const synthesis = published.findLast(t => t.phase === 'synthesis'); const result = $('#topic-chat-result'); result.hidden = !synthesis;
    result.textContent = synthesis ? `${d.status === 'completed' ? '종합안 · 동료 검토 완료' : '종합안 · 전체 절차 미완료'}\n${synthesis.reply!.text}` : '';
    const target = $('#topic-chat-messages'); target.replaceChildren();
    this.message('topic:' + d.id, '나', d.topic, d.createdAt, '주제 제안', true);
    for (const input of d.interventions) this.message('revision:' + input.revision, '나', input.text, input.createdAt, '추가 조건 · revision ' + input.revision, true);
    for (const revision of [...new Set(d.turns.map(t => t.revision))].filter(r => r < d.revision).sort((a, b) => a - b)) {
      const turns = topicPublishedTurns({ ...d, revision }); if (!turns.length) continue;
      const archive = el('details', '', 'topic-archive'); archive.append(el('summary', '이전 조건의 공개된 발언 · revision ' + revision));
      for (const turn of turns) archive.append(this.message('archive:' + turn.id, d.members.find(p => p.id === turn.participantId)?.label ?? turn.participantId, turn.reply!.text, turn.finishedAt ?? turn.startedAt, '이전 조건 · revision ' + revision, false));
      target.append(archive);
    }
    const readAt = read(d.id + '.read') ?? ''; let unread = 0;
    let group = '';
    for (const turn of d.turns.filter(t => t.revision === d.revision)) {
      const last = d.turns.findLast(t => t.revision === turn.revision && t.phase === turn.phase && t.round === turn.round && t.participantId === turn.participantId);
      if (!ids.has(turn.id) && (last?.id !== turn.id || turn.status === 'stale')) continue;
      const next = turn.phase + ':' + turn.round;
      if (group !== next) { group = next; target.append(el('p', phases[turn.phase] + ' · ' + turn.round + '회', 'topic-round')); }
      const who = d.members.find(p => p.id === turn.participantId)?.label ?? turn.participantId;
      if (!ids.has(turn.id)) { target.append(el('p', who + ' · ' + (turn.status === 'unconfirmed' ? '원래 응답 대조 필요' : turn.status === 'failed' ? '실패 기록 확인 필요' : '같은 라운드의 답변을 모으는 중'), 'system-message')); continue; }
      const row = this.message(turn.id, who, turn.reply!.text, turn.finishedAt ?? turn.startedAt, phases[turn.phase], false);
      row.dataset.turnId = turn.id; row.dataset.unread = String(!!readAt && (turn.finishedAt ?? turn.startedAt) > readAt);
      if (row.dataset.unread === 'true') unread++;
      for (const review of turn.reply!.reviews) {
        const claim = d.claims.find(c => c.id === review.claimId), quote = el('blockquote', (review.stance === 'challenge' ? '반론' : review.stance === 'support' ? '지지' : '미확인') + ' · ' + (claim?.text ?? review.claimId) + '\n' + review.reason, 'topic-review');
        row.append(quote);
      }
      if (turn.reply!.uncertainty.length) row.append(el('p', '미확인 · ' + turn.reply!.uncertainty.join(' / '), 'topic-uncertainty'));
    }
    if (!d.turns.length) target.append(el('p', '참여자의 첫 답변을 기다립니다.', 'system-message'));
    $('#topic-unread').hidden = !unread; $('#topic-unread').textContent = '읽지 않은 발언 ' + unread + '개';
    if (active) requestAnimationFrame(() => {
      if (this.discussion?.id !== d.id || !this.active) return;
      const timeline = $('#topic-chat-timeline'); let anchor = position;
      if (entering) { try { const saved = JSON.parse(read(d.id + '.position') ?? 'null'); anchor = saved && typeof saved.top === 'number' && typeof saved.bottom === 'boolean' ? saved : { top: 0, bottom: true }; } catch { anchor = { top: 0, bottom: true }; } }
      timeline.scrollTop = anchor.bottom ? timeline.scrollHeight : anchor.top; this.remember();
    });
  }
  private message(id: string, who: string, text: string, at: string, mode: string, owner: boolean): HTMLElement {
    const row = el('article', '', 'topic-message' + (owner ? ' mine' : '')); row.dataset.messageId = id;
    const head = el('header', '', 'message-head'); head.append(el('span', Array.from(who)[0] ?? '?', 'avatar'), el('strong', who), el('span', mode, 'message-mode'), el('time', time(at)));
    const body = el('div', this.expanded.has(id) ? text : text.slice(0, 1500), 'message-text'); row.append(head, body);
    if (text.length > 1500) row.append(this.btn(this.expanded.has(id) ? '접기' : '전체 발언 펼치기 · ' + text.length.toLocaleString('ko-KR') + '자', () => {
      if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
      save(this.discussion!.id + '.expanded', JSON.stringify([...this.expanded])); this.signature = ''; this.render(this.topics, this.discussion, this.active);
    }));
    $('#topic-chat-messages').append(row); return row;
  }
}
