import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../workspace/store.js';
import type { BrowserBinding } from '../workspace/model.js';
import type { Completion, CompletionInput } from './providers.js';
import { RpcProcess } from './rpc.js';
import { AppError, object, string } from '../workspace/util.js';

export class BrowserBridge {
  private rpc: RpcProcess | null = null;
  private connecting: Promise<void> | null = null;
  private ready = false;
  private isolatedLogin = false;
  constructor(private readonly store: Store, private readonly command: string[] | null) {}
  private async connect(): Promise<void> {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    if (!this.command) throw new AppError('browser_not_configured', 409);
    this.rpc = new RpcProcess(this.command);
    this.rpc.onClose = () => { this.ready = false; };
    this.connecting = (async () => {
      await this.rpc!.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'webjjoku', version: '0.2.0' } });
      this.rpc!.notify('notifications/initialized');
      const result = object(await this.rpc!.request('tools/list'));
      const available = Array.isArray(result.tools) ? result.tools.map(object) : [];
      const newPage = available.find(t => t.name === 'new_page');
      this.isolatedLogin = !!newPage && !!object(object(newPage.inputSchema).properties).isolatedContext;
      if (!['list_pages', 'evaluate_script', 'new_page', 'take_snapshot'].every(name => available.some(t => t.name === name))) throw new AppError('browser_capability_unavailable', 409);
      for (const name of ['evaluate_script', 'take_snapshot']) {
        const schema = object(available.find(t => t.name === name)!.inputSchema); const properties = object(schema.properties);
        if (!properties.pageId || name === 'evaluate_script' && (!properties.function || !properties.waitForStableDom || !properties.dialogAction)) throw new AppError('browser_contract_unsupported', 409);
      }
      this.ready = true;
    })();
    try { await this.connecting; } catch (error) { this.rpc?.close(); throw error; } finally { this.connecting = null; }
  }
  async tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.connect(); const result = object(await this.rpc!.request('tools/call', { name, arguments: args }));
    if (result.isError) throw new AppError('browser_tool_failed', 502, true);
    return result;
  }
  async pages(): Promise<string> { return toolText(await this.tool('list_pages', {})); }
  async snapshot(pageId: number): Promise<string> { return toolText(await this.tool('take_snapshot', { pageId })).slice(0, 60_000); }
  async openAuthorization(url: string, connectionId: string): Promise<void> {
    const target = new URL(url);
    if (target.origin !== 'https://auth.openai.com' || target.pathname !== '/api/accounts/authorize') throw new AppError('invalid_authorization_url');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(connectionId)) throw new AppError('invalid_connection');
    await this.connect();
    if (!this.isolatedLogin) throw new AppError('isolated_login_unavailable', 409);
    await this.tool('new_page', { url: target.href, isolatedContext: 'webjjoku-oauth-' + connectionId });
  }
  async inspect(binding: BrowserBinding, marker = ''): Promise<Record<string, unknown>> {
    if (binding.discovery) {
      const page = browserPages(await this.tool('list_pages', {})).find(p => p.id === binding.pageId);
      if (!page || cleanUrl(page.url) !== cleanUrl(binding.url) || (page.isolatedContext === undefined ? 'default' : 'isolated:' + page.isolatedContext) !== binding.discovery.profile) throw new AppError('browser_target_mismatch', 409);
    }
    const result = await this.tool('evaluate_script', { pageId: binding.pageId, function: observationScript(binding, marker), waitForStableDom: false, dialogAction: 'dismiss' });
    return toolObject(result);
  }
  async probe(binding: BrowserBinding): Promise<void> {
    validateBinding(binding); const state = await this.inspect(binding);
    if (state.identity !== true || state.thread !== true || state.url !== cleanUrl(binding.url)) throw new AppError('browser_target_mismatch', 409);
    if (state.inputFound !== true || state.sendFound !== true && !binding.sendAppearsAfterInput) throw new AppError('browser_selectors_invalid', 409);
    if (state.ready !== true || state.busy === true) throw new AppError('browser_not_ready', 409);
  }
  async complete(input: CompletionInput): Promise<Completion> {
    if (this.store.read().browserPaused) throw new AppError('browser_manual_control', 409);
    const c = this.store.read().connections.find(x => x.id === input.participant.connectionId && x.kind === 'browser');
    if (!c?.browser || c.status !== 'connected') throw new AppError('browser_not_configured', 409);
    const b = c.browser; validateBinding(b);
    const marker = `[웹쫀쿠:${input.requestId}]`;
    const before = await this.inspect(b, marker);
    if (before.identity !== true || before.thread !== true || before.url !== cleanUrl(b.url)) throw new AppError('browser_target_mismatch', 409);
    if (typeof before.matchCount === 'number' && before.matchCount > 1) throw new AppError('browser_receipt_ambiguous', 409, true);
    if (before.matched !== true) {
      if (before.draft || before.busy || before.ready !== true) throw new AppError('browser_requires_intervention', 409);
      input.signal.throwIfAborted(); input.hooks.dispatched();
      // This fixed script checks the binding and draft again in the same page
      // task that inputs/clicks. Model content is a JSON-encoded string only.
      const sent = toolObject(await this.tool('evaluate_script', { pageId: b.pageId,
        function: sendScript(b, `${marker}\n${input.prompt}`), waitForStableDom: false, dialogAction: 'dismiss' }));
      if (sent.sent !== true) throw new AppError('browser_send_unconfirmed', 502, true);
    }
    let receipt: string | null = null; let last = ''; let stable = 0;
    while (!input.signal.aborted) {
      const view = await this.inspect(b, marker);
      if (view.identity !== true || view.thread !== true || view.url !== cleanUrl(b.url)) throw new AppError('browser_target_changed', 409, true);
      if (view.matched === true && !receipt) { receipt = `${cleanUrl(b.url)}#${input.requestId}`; input.hooks.receipt(receipt); }
      const text = typeof view.answer === 'string' ? view.answer : '';
      if (text.length > 100_000) throw new AppError('response_too_large', 502, true);
      if (text && text !== last) {
        if (text.startsWith(last)) input.hooks.delta(text.slice(last.length));
        last = text; stable = 0;
      } else if (text) stable++;
      if (receipt && text && view.ready === true && view.busy === false && stable >= 2) return { text, receipt, usage: null };
      await delay(500, undefined, { signal: input.signal });
    }
    throw new AppError('browser_response_unconfirmed', 502, true);
  }
  close(): void { this.rpc?.close(); this.ready = false; }
}
export function validateBinding(b: BrowserBinding): void {
  const url = new URL(b.url);
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'chatgpt.com' || url.hostname === 'muse.ai' || url.hostname.endsWith('.muse.ai'))) throw new AppError('browser_origin_not_allowed');
  if (!Number.isInteger(b.pageId) || b.pageId < 0) throw new AppError('invalid_page_id');
  for (const key of ['identitySelector', 'identityText', 'inputSelector', 'sendSelector', 'userSelector', 'assistantSelector', 'busySelector', 'readySelector', 'accountLabel', 'agentLabel'] as const) string(b[key], 500);
  if (b.thread) {
    string(b.thread.selector, 500); string(b.thread.attribute, 100); string(b.thread.value, 500);
    if (b.thread.jsonKey !== undefined) string(b.thread.jsonKey, 100);
  }
  if (b.sendAppearsAfterInput !== undefined && typeof b.sendAppearsAfterInput !== 'boolean') throw new AppError('invalid_input');
}
function cleanUrl(value: string): string { const url = new URL(value); url.hash = ''; return url.href; }
function toolText(result: Record<string, unknown>): string { return (Array.isArray(result.content) ? result.content : []).map(object).filter(c => c.type === 'text').map(c => String(c.text)).join('\n'); }
// MCP 1.12.0 returns structuredContent only with its experimental option. Read
// its default page-list format too, without guessing a page ID from arbitrary
// mentions in titles or selecting a page. DOM origin is rechecked independently.
export function browserPages(result: Record<string, unknown>): { id: number; url: string; title: string; isolatedContext?: string }[] {
  if (result.structuredContent) {
    const structured = toolObject(result);
    if (!Array.isArray(structured.pages)) throw new AppError('browser_discovery_pages_unavailable', 409);
    return structured.pages.slice(0, 200).map(raw => {
      const page = object(raw);
      if (!Number.isInteger(page.id) || Number(page.id) < 0 || Number(page.id) > 1_000_000 || typeof page.url !== 'string') throw new AppError('browser_discovery_pages_unavailable', 409);
      return { id: Number(page.id), url: page.url, title: typeof page.title === 'string' ? page.title.slice(0, 200) : '', ...(typeof page.isolatedContext === 'string' ? { isolatedContext: page.isolatedContext } : {}) };
    });
  }
  const pages = [];
  const section = /(?:^|\n)## Pages\n([\s\S]*?)(?=\n## |$)/.exec(toolText(result));
  if (!section) throw new AppError('browser_discovery_pages_unavailable', 409);
  for (const line of section[1]!.split('\n').filter(Boolean).slice(0, 200)) {
    const entry = /^(\d+): (.+?)(?: \[selected\])?(?: isolatedContext=(.+))?$/.exec(line);
    if (!entry) throw new AppError('browser_discovery_pages_unavailable', 409);
    const titled = /^(.*) \(([a-zA-Z][\w+.-]*:\S*)\)$/.exec(entry[2]!);
    const url = titled?.[2] ?? entry[2]!;
    if (!/^[a-zA-Z][\w+.-]*:\S+$/.test(url)) throw new AppError('browser_discovery_pages_unavailable', 409);
    const id = Number(entry[1]); if (!Number.isSafeInteger(id) || id > 1_000_000) throw new AppError('browser_discovery_pages_unavailable', 409);
    pages.push({ id, url, title: titled?.[1] ?? '', ...(entry[3] ? { isolatedContext: entry[3] } : {}) });
  }
  return pages;
}
export function toolObject(result: Record<string, unknown>): Record<string, unknown> {
  if (result.structuredContent) {
    const value = object(result.structuredContent);
    return value.result && typeof value.result === 'object' ? object(value.result) : value;
  }
  const text = toolText(result); const block = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  try { return object(JSON.parse(block?.[1] ?? text) as unknown); } catch { throw new AppError('browser_observation_invalid', 502, true); }
}
export function observationScript(b: BrowserBinding, marker: string): string {
  return `() => { const b=${JSON.stringify(b)}, marker=${JSON.stringify(marker)};
    ${threadGuardScript()}
    const visible=e=>!!e&&e.getClientRects().length>0;
    const input=document.querySelector(b.inputSelector), send=document.querySelector(b.sendSelector);
    const identity=document.querySelector(b.identitySelector);
    const users=[...document.querySelectorAll(b.userSelector)];
    const messageText=e=>{const copy=e.cloneNode(true);copy.querySelectorAll('[data-copy-exclude]').forEach(node=>node.remove());return copy.textContent||'';};
    const match=marker?users.filter(e=>messageText(e).trim().startsWith(marker)):[];
    const user=match.length===1?match[0]:null;
    const nextUser=user?users[users.indexOf(user)+1]:null;
    const answers=user?[...document.querySelectorAll(b.assistantSelector)].filter(e=>(user.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)!==0&&(!nextUser||(e.compareDocumentPosition(nextUser)&Node.DOCUMENT_POSITION_FOLLOWING)!==0)):[];
    const u=new URL(location.href);u.hash='';
    const unique=!b.discovery||[b.identitySelector,b.inputSelector,b.readySelector].every(s=>document.querySelectorAll(s).length===1)&&document.querySelectorAll(b.sendSelector).length<=1;
    return {url:u.href,identity:unique&&!!identity&&(identity.textContent||'').includes(b.identityText),thread:threadMatches(),
      inputFound:visible(input),sendFound:visible(send),draft:input?('value' in input?input.value:input.textContent):'',
      ready:visible(document.querySelector(b.readySelector)),busy:[...document.querySelectorAll(b.busySelector)].some(visible),
      matched:!!user,matchCount:match.length,answer:answers.map(messageText).join('\\n\\n').slice(0,100001)}; }`;
}
function threadGuardScript(): string {
  return `const threadMatches=()=>{if(!b.thread)return true;const nodes=[...document.querySelectorAll(b.thread.selector)].filter(e=>e.getClientRects().length>0);
    return nodes.length>0&&nodes.every(e=>{let value=e.getAttribute(b.thread.attribute);if(b.thread.jsonKey){try{value=JSON.parse(value||'null')?.[b.thread.jsonKey];}catch{return false;}}return value===b.thread.value;});};`;
}
export function sendScript(b: BrowserBinding, prompt: string): string {
  return `async () => {const b=${JSON.stringify(b)}, text=${JSON.stringify(prompt)};
    ${threadGuardScript()}
    const u=new URL(location.href);u.hash='';if(u.href!==${JSON.stringify(cleanUrl(b.url))})return {sent:false};
    const identity=document.querySelector(b.identitySelector),input=document.querySelector(b.inputSelector);
    let button=document.querySelector(b.sendSelector);
    const visible=e=>!!e&&e.getClientRects().length>0;
    const unique=()=>!b.discovery||[b.identitySelector,b.inputSelector,b.readySelector].every(s=>document.querySelectorAll(s).length===1)&&document.querySelectorAll(b.sendSelector).length<=1;
    if(!unique()||!identity||!(identity.textContent||'').includes(b.identityText)||!threadMatches()||!visible(input)||(!visible(button)&&!b.sendAppearsAfterInput)||[...document.querySelectorAll(b.busySelector)].some(visible)||!visible(document.querySelector(b.readySelector)))return {sent:false};
    if(('value' in input?input.value:input.textContent).trim())return {sent:false};
    if(input instanceof HTMLTextAreaElement||input instanceof HTMLInputElement){
      const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,text);
    }else if(input.isContentEditable){input.replaceChildren(document.createTextNode(text));}else return {sent:false};
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    await new Promise(resolve=>setTimeout(resolve,150));
    button=document.querySelector(b.sendSelector);
    const current=new URL(location.href);current.hash='';
    if(!unique()||current.href!==u.href||!(document.querySelector(b.identitySelector)?.textContent||'').includes(b.identityText)||!threadMatches()||!input.isConnected||!visible(button)||!button.isConnected||('value' in input?input.value:input.textContent)!==text||button.disabled||button.getAttribute('aria-disabled')==='true'||!visible(document.querySelector(b.readySelector))||[...document.querySelectorAll(b.busySelector)].some(visible))return {sent:false};button.click();return {sent:true};}`;
}
