import type { Connection } from '../workspace/model.js';
import type { DotConnectionStatus } from '../workspace/dot-mcp-model.js';

type Snapshot = { dotMcp?: { enabled: boolean; connections: DotConnectionStatus[] }; resident: { rooms: { id: string; title: string }[] } };
type Deps = { api: <T>(path: string, body?: unknown, requestId?: string) => Promise<T>; refresh: () => Promise<void>; report: (e: unknown) => void };
const $ = <T extends HTMLElement = HTMLElement>(q: string) => document.querySelector<T>(q)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
export const dotLabels: Record<string, string> = { disabled: '기능 꺼짐', removed: '연결 삭제됨', revoked: '권한 해제됨', expired: '만료 · 재연결 필요', active: '유효', unavailable: '권한 확인 필요', confirmation_required: '소유자 확인 필요', none: '감시 등록 필요', prepared: '검증 중', failed: '실패 · 기록 확인', not_sent: '미전송', pending: '전달 대기', sending: '전달 중', delivered: '이벤트 수신 확인', settled: '원래 발언 정산됨', held: '대조 필요', not_run: '아직 발언 없음', waiting: '답변 대기', claimed: 'dot이 입력 조회 중', received: '답변 저장 · 반영 대기', unconfirmed: '미확정 · 원래 요청 대조', completed: '답변 반영됨', quarantined: '이전 범위 응답 · 적용 안 함' };
const text = (s: string) => dotLabels[s] ?? '확인 필요';
export class DotConnectionsView {
  private snapshot: Snapshot | null = null;
  private selected: DotConnectionStatus | null = null;
  private generation = 0; private expiryTimer = 0;
  constructor(private readonly deps: Deps) {
    this.submit('#dot-register-form', async (form, command) => {
      const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
      await deps.api('/api/dot/connections', data, command); form.reset(); await deps.refresh();
    });
    this.submit('#dot-confirm-form', async (form, command) => {
      const c = this.selected; if (!c) return; const generation = this.generation;
      const data = new FormData(form), expiresAt = new Date(String(data.get('expiresAt'))).toISOString();
      const result = await deps.api<{ token: string }>(`/api/dot/connections/${c.connectionId}/confirm`, { expectedVersion: c.version, ownerConfirmed: data.get('ownerConfirmed') === 'on', expiresAt }, command);
      if (generation !== this.generation || !$<HTMLDialogElement>('#dot-confirm-dialog').open) return;
      $<HTMLInputElement>('#dot-grant-token').value = result.token; $('#dot-grant-result').hidden = false; $('#dot-confirm-fields').hidden = true;
      this.expiryTimer = window.setTimeout(() => this.clear(), 120000); await deps.refresh();
    });
    $('#dot-confirm-close').addEventListener('click', () => this.clear());
    $('#dot-confirm-dialog').addEventListener('close', () => this.clear());
    $('#dot-grant-copy').addEventListener('click', () => { void navigator.clipboard.writeText($<HTMLInputElement>('#dot-grant-token').value).catch(deps.report); });
    $('#dot-grant-show').addEventListener('click', () => { const input = $<HTMLInputElement>('#dot-grant-token'); input.type = input.type === 'password' ? 'text' : 'password'; });
    $('#dot-status-refresh').addEventListener('click', () => { void deps.refresh().catch(deps.report); });
  }
  private submit(selector: string, action: (form: HTMLFormElement, key: string) => Promise<void>): void {
    let pending: { body: string; key: string } | null = null;
    $(selector).addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget as HTMLFormElement, button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      if (button.disabled) return; const body = JSON.stringify([Object.fromEntries(new FormData(form)), selector === '#dot-confirm-form' ? this.selected : null]);
      if (!pending || pending.body !== body) pending = { body, key: crypto.randomUUID() }; button.disabled = true;
      void action(form, pending.key).then(() => { pending = null; }).catch(this.deps.report).finally(() => { button.disabled = false; });
    });
  }
  render(snapshot: Snapshot): void {
    this.snapshot = snapshot; const select = $<HTMLSelectElement>('#dot-room'), value = select.value;
    const signature = JSON.stringify(snapshot.resident.rooms.map(r => [r.id, r.title]));
    if (select.dataset.signature !== signature) { select.replaceChildren(); for (const r of snapshot.resident.rooms) { const option = el('option', r.title); option.value = r.id; select.append(option); } if ([...select.options].some(o => o.value === value)) select.value = value; select.dataset.signature = signature; }
    $<HTMLFieldSetElement>('#dot-register-fields').disabled = !snapshot.dotMcp?.enabled;
    $('#dot-feature-note').textContent = snapshot.dotMcp?.enabled ? '연결을 등록하면 이 방에 발언이 꺼진 dot 토커가 만들어집니다.' : '서버에서 상주 기능을 켠 뒤 공식 dot을 등록할 수 있습니다.';
  }
  open(): void { $<HTMLDetailsElement>('#dot-connection-panel').open = true; $('#dot-connection-panel').scrollIntoView({ block: 'start' }); $('#dot-register-label').focus(); }
  card(c: Connection): HTMLElement {
    const card = el('article', '', 'connection-card'), status = this.snapshot?.dotMcp?.connections.find(v => v.connectionId === c.id);
    card.dataset.connectionId = c.id; card.append(el('h3', c.label), el('p', 'dot · 공식 플러그인', 'small muted'));
    if (!status) { card.append(el('p', '연결 상태를 다시 확인하세요.')); return card; }
    card.append(el('p', '참여 방 · ' + (this.snapshot?.resident.rooms.find(r => r.id === status.roomId)?.title ?? '확인 필요'), 'small'));
    const rows = el('dl', '', 'dot-status');
    for (const [label, value] of [['연결 권한', text(status.authority)], ['이벤트 감시', text(status.subscription)], ['요청 전달', text(status.delivery)], ['답변', text(status.response)]]) rows.append(el('dt', label), el('dd', value));
    card.append(rows, el('p', status.ready ? '전송 준비됨 · 방 켜기/발언 참여는 별도 설정' : '준비 상태를 확인하세요. 조회만으로 발언을 시작하지 않습니다.', 'small'));
    card.append(el('p', '정체성: ' + (status.identity === 'owner_confirmed' ? '소유자가 확인한 연결' : '아직 확인하지 않음') + ' · 실제 dot 계정 증명 미확인', 'small muted'));
    if (status.grantExpiresAt) card.append(el('p', '권한 만료 · ' + new Date(status.grantExpiresAt).toLocaleString(), 'small'));
    if (status.deliveryHttpStatus !== null) card.append(el('p', '최근 이벤트 HTTP ' + status.deliveryHttpStatus + ' · 답변 완료와 구분', 'small'));
    if (status.requestId) card.append(el('p', `원래 요청 · ${status.requestId}${status.receipt ? '\n수락 영수증 · ' + status.receipt : ''}`, 'small pre-line'));
    const row = el('div', '', 'toolbar'); row.append(this.button(status.authority === 'active' ? '권한 다시 발급' : '연결 확인·권한 발급', () => this.confirm(c, status)));
    if (status.authority === 'active' || status.subscription === 'active') row.append(this.button('연결 권한 해제', async () => {
      if (!window.confirm(`${c.label}의 권한과 이벤트 감시를 해제합니다. 원래 발언·미확정 기록은 유지합니다.`)) return;
      await this.deps.api(`/api/dot/connections/${c.id}/revoke`, { expectedVersion: status.version }); this.clear(); await this.deps.refresh();
    }));
    row.append(this.button('설정 절차 보기', () => this.open())); card.append(row); return card;
  }
  private button(label: string, action: () => unknown): HTMLButtonElement {
    const b = el('button', label); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; void Promise.resolve().then(action).catch(this.deps.report).finally(() => { b.disabled = false; }); }); return b;
  }
  private confirm(c: Connection, status: DotConnectionStatus): void {
    this.clear(); this.selected = status; $('#dot-confirm-title').textContent = c.label + ' · 연결 권한';
    $('#dot-confirm-target').textContent = '참여 방 · ' + (this.snapshot?.resident.rooms.find(r => r.id === status.roomId)?.title ?? '확인 필요') + ' / dot · ' + c.label;
    const expiry = new Date(Date.now() + 86400000);
    $<HTMLFormElement>('#dot-confirm-form').reset(); $<HTMLInputElement>('#dot-grant-expiry').value = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#dot-confirm-fields').hidden = false; $<HTMLDialogElement>('#dot-confirm-dialog').showModal();
  }
  clear(): void {
    this.generation++; this.selected = null; clearTimeout(this.expiryTimer); $('#dot-grant-result').hidden = true;
    $<HTMLInputElement>('#dot-grant-token').value = ''; $<HTMLInputElement>('#dot-grant-token').type = 'password';
    const dialog = $<HTMLDialogElement>('#dot-confirm-dialog'); if (dialog.open) dialog.close();
  }
}
