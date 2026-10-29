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
  async openAuthorization(url: string): Promise<void> {
    const target = new URL(url);
    if (target.origin !== 'https://auth.openai.com' || target.pathname !== '/api/accounts/authorize') throw new AppError('invalid_authorization_url');
    await this.tool('new_page', { url: target.href });
  }
  async inspect(binding: BrowserBinding, marker = ''): Promise<Record<string, unknown>> {
    const result = await this.tool('evaluate_script', { pageId: binding.pageId, function: observationScript(binding, marker), waitForStableDom: false, dialogAction: 'dismiss' });
    return toolObject(result);
  }
  async probe(binding: BrowserBinding): Promise<void> {
    validateBinding(binding); const state = await this.inspect(binding);
    if (state.identity !== true || state.url !== cleanUrl(binding.url)) throw new AppError('browser_target_mismatch', 409);
    if (state.inputFound !== true || state.sendFound !== true) throw new AppError('browser_selectors_invalid', 409);
    if (state.ready !== true || state.busy === true) throw new AppError('browser_not_ready', 409);
  }
  async complete(input: CompletionInput): Promise<Completion> {
    if (this.store.read().browserPaused) throw new AppError('browser_manual_control', 409);
    const c = this.store.read().connections.find(x => x.id === input.participant.connectionId && x.kind === 'browser');
    if (!c?.browser || c.status !== 'connected') throw new AppError('browser_not_configured', 409);
    const b = c.browser; validateBinding(b);
    const marker = `[웹쫀쿠:${input.requestId}]`;
    const before = await this.inspect(b, marker);
    if (before.identity !== true || before.url !== cleanUrl(b.url)) throw new AppError('browser_target_mismatch', 409);
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
      if (view.identity !== true || view.url !== cleanUrl(b.url)) throw new AppError('browser_target_changed', 409, true);
      if (view.matched === true && !receipt) { receipt = `${cleanUrl(b.url)}#${input.requestId}`; input.hooks.receipt(receipt); }
      const text = typeof view.answer === 'string' ? view.answer : '';
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
}
function cleanUrl(value: string): string { const url = new URL(value); url.hash = ''; return url.href; }
function toolText(result: Record<string, unknown>): string { return (Array.isArray(result.content) ? result.content : []).map(object).filter(c => c.type === 'text').map(c => String(c.text)).join('\n'); }
function toolObject(result: Record<string, unknown>): Record<string, unknown> {
  if (result.structuredContent) {
    const value = object(result.structuredContent);
    return value.result && typeof value.result === 'object' ? object(value.result) : value;
  }
  const text = toolText(result); const block = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  try { return object(JSON.parse(block?.[1] ?? text) as unknown); } catch { throw new AppError('browser_observation_invalid', 502, true); }
}
export function observationScript(b: BrowserBinding, marker: string): string {
  return `() => { const b=${JSON.stringify(b)}, marker=${JSON.stringify(marker)};
    const visible=e=>!!e&&e.getClientRects().length>0;
    const input=document.querySelector(b.inputSelector), send=document.querySelector(b.sendSelector);
    const identity=document.querySelector(b.identitySelector);
    const users=[...document.querySelectorAll(b.userSelector)];
    const match=marker?users.filter(e=>(e.textContent||'').trim().startsWith(marker)):[];
    const user=match.length===1?match[0]:null;
    const answers=user?[...document.querySelectorAll(b.assistantSelector)].filter(e=>(user.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)!==0):[];
    const u=new URL(location.href);u.hash='';
    return {url:u.href,identity:!!identity&&(identity.textContent||'').includes(b.identityText),
      inputFound:visible(input),sendFound:visible(send),draft:input?('value' in input?input.value:input.textContent):'',
      ready:visible(document.querySelector(b.readySelector)),busy:visible(document.querySelector(b.busySelector)),
      matched:!!user,matchCount:match.length,answer:answers.length===1?(answers[0].textContent||'').slice(0,100000):''}; }`;
}
export function sendScript(b: BrowserBinding, prompt: string): string {
  return `async () => {const b=${JSON.stringify(b)}, text=${JSON.stringify(prompt)};
    const u=new URL(location.href);u.hash='';if(u.href!==${JSON.stringify(cleanUrl(b.url))})return {sent:false};
    const identity=document.querySelector(b.identitySelector),input=document.querySelector(b.inputSelector),button=document.querySelector(b.sendSelector);
    const visible=e=>!!e&&e.getClientRects().length>0;
    if(!identity||!(identity.textContent||'').includes(b.identityText)||!visible(input)||!visible(button)||visible(document.querySelector(b.busySelector))||!visible(document.querySelector(b.readySelector)))return {sent:false};
    if(('value' in input?input.value:input.textContent).trim())return {sent:false};
    if(input instanceof HTMLTextAreaElement||input instanceof HTMLInputElement){
      const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,text);
    }else if(input.isContentEditable){input.replaceChildren(document.createTextNode(text));}else return {sent:false};
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    await new Promise(resolve=>setTimeout(resolve,150));
    const current=new URL(location.href);current.hash='';
    if(current.href!==u.href||!(document.querySelector(b.identitySelector)?.textContent||'').includes(b.identityText)||!input.isConnected||!button.isConnected||('value' in input?input.value:input.textContent)!==text||button.disabled||visible(document.querySelector(b.busySelector)))return {sent:false};button.click();return {sent:true};}`;
}
