import { readFileSync } from 'node:fs';
import type { BrowserBinding } from '../workspace/model.js';
import { AppError, digest, id, integer, object, string } from '../workspace/util.js';
import { BrowserBridge, browserPages, toolObject, validateBinding } from './browser.js';
import type { DiscoveryPage, DiscoveryResult } from './browser-discovery-model.js';

export interface BrowserPreset {
  id: string; version: number; label: string; service: 'chatgpt' | 'muse'; verification: 'UNVERIFIED';
  identity: string[]; agent: string[]; input: string[]; send: string[]; ready: string[];
  user: string; assistant: string; busy: string; sendAppearsAfterInput: boolean;
  thread: { selector: string; attribute: string; jsonKey?: string } | null;
}
interface Candidate { result: DiscoveryResult; binding: BrowserBinding; connectionId: string | null }

export function validatePreset(value: unknown): BrowserPreset {
  const p = object(value);
  if (Object.keys(p).some(k => !['id', 'version', 'label', 'service', 'verification', 'identity', 'agent', 'input', 'send', 'ready', 'user', 'assistant', 'busy', 'sendAppearsAfterInput', 'thread'].includes(k))) throw new AppError('browser_preset_invalid');
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(string(p.id, 80)) || !Number.isSafeInteger(p.version) || Number(p.version) < 1 || !['chatgpt', 'muse'].includes(String(p.service)) || p.verification !== 'UNVERIFIED' || typeof p.sendAppearsAfterInput !== 'boolean') throw new AppError('browser_preset_invalid');
  string(p.label, 100);
  for (const k of ['identity', 'agent', 'input', 'send', 'ready']) {
    if (!Array.isArray(p[k]) || p[k].length < 1 || p[k].length > 10) throw new AppError('browser_preset_invalid');
    for (const selector of p[k]) string(selector, 500);
  }
  for (const k of ['user', 'assistant', 'busy']) string(p[k], 500);
  if (p.thread !== null) { const t = object(p.thread); if (Object.keys(t).some(k => !['selector', 'attribute', 'jsonKey'].includes(k))) throw new AppError('browser_preset_invalid'); string(t.selector, 500); string(t.attribute, 100); if (t.jsonKey !== undefined) string(t.jsonKey, 100); }
  if (p.service === 'muse' && p.thread === null) throw new AppError('browser_preset_invalid');
  return structuredClone(p) as unknown as BrowserPreset;
}
export const browserPresets: readonly BrowserPreset[] = ['chatgpt-v1', 'muse-v1'].map(name => validatePreset(JSON.parse(readFileSync(new URL(`./browser-presets/${name}.json`, import.meta.url), 'utf8')) as unknown));

export function allowedPageUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'chatgpt.com' || u.hostname === 'muse.ai' || u.hostname.endsWith('.muse.ai')); } catch { return false; }
}
export async function discoveryPages(bridge: Pick<BrowserBridge, 'tool'>): Promise<DiscoveryPage[]> {
  const result = browserPages(await bridge.tool('list_pages', {}));
  const pages: DiscoveryPage[] = [];
  for (const p of result) {
    if (!allowedPageUrl(p.url)) continue;
    const pageId = integer(p.id, -1, 0, 1_000_000); const profile = p.isolatedContext === undefined ? 'default' : 'isolated:' + string(p.isolatedContext, 191);
    if (pages.some(p => p.pageId === pageId)) throw new AppError('browser_discovery_pages_unavailable', 409);
    pages.push({ pageId, url: cleanUrl(p.url), title: typeof p.title === 'string' ? p.title.slice(0, 200) : '', profile });
  }
  return pages;
}

// All executable code below is fixed. Presets and previously verified selectors
// enter only through JSON data. No cookies/storage, network, input, clicks or DOM
// mutations are used; message contents and existing draft text are not returned.
export function discoveryScript(preset: BrowserPreset, existing?: BrowserBinding, expectedUrl?: string): string {
  const p = existing ? { ...preset, identity: [existing.identitySelector], input: [existing.inputSelector], send: [existing.sendSelector], ready: [existing.readySelector], user: existing.userSelector, assistant: existing.assistantSelector, busy: existing.busySelector, thread: existing.thread ?? null, allowUrlThread: !existing.thread, sendAppearsAfterInput: !!existing.sendAppearsAfterInput } : { ...preset, allowUrlThread: preset.service === 'chatgpt' };
  return `() => {const p=${JSON.stringify(p)};const u=new URL(location.href);u.hash='';
    if(u.href!==${JSON.stringify(expectedUrl ?? existing?.url ?? '')})return {url:u.href};
    const visible=e=>!!e&&e.getClientRects().length>0;
    const candidates=list=>{const found=new Map();for(const selector of list){const all=[...document.querySelectorAll(selector)];for(const e of all.filter(visible)){if(!found.has(e))found.set(e,{selector,count:all.length,node:e});}}return [...found.values()];};
    const value=e=>e?('value' in e?e.value:e.textContent)||'':'';
    const text=e=>(e?.textContent||'').trim();
    try {
      const identity=candidates(p.identity),input=candidates(p.input),send=candidates(p.send),ready=candidates(p.ready),agent=candidates(p.agent);
      const single=list=>list.length===1&&list[0].count===1;
      let threadValue=null,threadAmbiguous=false;
      if(p.thread){const nodes=[...document.querySelectorAll(p.thread.selector)].filter(visible);const values=nodes.map(e=>{let v=e.getAttribute(p.thread.attribute);if(p.thread.jsonKey){try{v=JSON.parse(v||'null')?.[p.thread.jsonKey];}catch{return null;}}return typeof v==='string'&&v.trim()&&v.length<=500?v:null;});
        threadAmbiguous=!values.length||values.some(v=>!v)||new Set(values).size!==1;threadValue=threadAmbiguous?null:values[0];
      }else if(p.allowUrlThread){const match=/\\/c\\/([^/]+)(?:\\/|$)/.exec(u.pathname);threadValue=match?match[1]:null;}
      const identityText=single(identity)?text(identity[0].node):null;
      const draftPresent=input.some(e=>!!value(e.node));const busy=[...document.querySelectorAll(p.busy)].some(visible);
      const ambiguous=identity.length>1||input.length>1||send.length>1||ready.length>1||identity.some(e=>e.count!==1)||input.some(e=>e.count!==1)||send.some(e=>e.count!==1)||ready.some(e=>e.count!==1);
      const supported=single(identity)&&single(input)&&single(ready)&&(single(send)||p.sendAppearsAfterInput&&send.length===0)&&!!identityText&&identityText.length<=500&&!!threadValue&&!threadAmbiguous&&document.querySelectorAll(p.user).length>0&&document.querySelectorAll(p.assistant).length>0;
      return {url:u.href,ambiguous,supported,threadAmbiguous,threadValue,identityText,agentLabel:agent.length===1?text(agent[0].node).slice(0,100):null,draftPresent,busy,
        selectors:supported?{identitySelector:identity[0].selector,inputSelector:input[0].selector,sendSelector:send[0]?.selector||p.send.join(','),readySelector:ready[0].selector}:null};
    }catch{return {invalid:true};}
  }`;
}

export async function discoverBinding(bridge: Pick<BrowserBridge, 'tool' | 'probe'>, page: DiscoveryPage, preset: BrowserPreset, existing?: BrowserBinding): Promise<{ result: DiscoveryResult; binding: BrowserBinding | null }> {
  const observedAt = new Date().toISOString();
  const result: DiscoveryResult = { id: null, page, presetId: existing ? 'saved-binding' : preset.id, presetVersion: existing ? 'saved-binding/1' : `${preset.id}/${preset.version}`, observedAt, status: 'unsupported', reason: 'browser_discovery_unsupported_dom', identityText: null, agentLabel: existing?.agentLabel ?? null, threadValue: null, draftPresent: false, busy: false, expiresAt: null };
  if (!allowedPageUrl(page.url) || (new URL(page.url).hostname === 'chatgpt.com' ? 'chatgpt' : 'muse') !== preset.service) throw new AppError('browser_discovery_origin_mismatch', 409);
  const view = toolObject(await bridge.tool('evaluate_script', { pageId: page.pageId, function: discoveryScript(preset, existing, page.url), waitForStableDom: false, dialogAction: 'dismiss' }));
  result.draftPresent = view.draftPresent === true; result.busy = view.busy === true;
  if (typeof view.identityText === 'string') result.identityText = view.identityText;
  if (!existing && typeof view.agentLabel === 'string' && view.agentLabel.trim()) result.agentLabel = view.agentLabel;
  if (typeof view.threadValue === 'string') result.threadValue = view.threadValue;
  if (view.url !== page.url) { result.status = 'blocked'; result.reason = 'browser_target_mismatch'; return { result, binding: null }; }
  if (view.ambiguous === true || view.threadAmbiguous === true) { result.status = 'blocked'; result.reason = 'browser_discovery_ambiguous'; return { result, binding: null }; }
  if (view.supported !== true || !result.identityText) return { result, binding: null };
  if (result.draftPresent || result.busy) { result.status = 'blocked'; result.reason = result.draftPresent ? 'browser_discovery_draft_present' : 'browser_not_ready'; return { result, binding: null }; }
  const selectors = object(view.selectors);
  const b: BrowserBinding = { pageId: page.pageId, url: page.url, accountLabel: existing?.accountLabel ?? result.identityText.slice(0, 100), agentLabel: existing?.agentLabel ?? result.agentLabel ?? '기존 대화',
    identitySelector: string(selectors.identitySelector, 500), identityText: result.identityText, inputSelector: string(selectors.inputSelector, 500), sendSelector: string(selectors.sendSelector, 500), readySelector: string(selectors.readySelector, 500),
    userSelector: existing?.userSelector ?? preset.user, assistantSelector: existing?.assistantSelector ?? preset.assistant, busySelector: existing?.busySelector ?? preset.busy, sendAppearsAfterInput: existing ? !!existing.sendAppearsAfterInput : preset.sendAppearsAfterInput };
  if (existing?.thread || preset.thread) { const thread = existing?.thread ?? preset.thread!; b.thread = { ...thread, value: string(view.threadValue, 500) }; }
  if (existing && (existing.url !== b.url || existing.identityText !== b.identityText || existing.thread?.value !== b.thread?.value)) { result.status = 'blocked'; result.reason = 'browser_target_mismatch'; return { result, binding: null }; }
  validateBinding(b);
  try { await bridge.probe(b); }
  catch (error) { if (!(error instanceof AppError) || !['browser_target_mismatch', 'browser_selectors_invalid', 'browser_not_ready'].includes(error.code)) throw error; result.status = 'blocked'; result.reason = error.code; return { result, binding: null }; }
  const inspected = toolObject(await bridge.tool('evaluate_script', { pageId: page.pageId, function: discoveryScript(preset, existing, page.url), waitForStableDom: false, dialogAction: 'dismiss' }));
  if (digest(JSON.stringify(inspected)) !== digest(JSON.stringify(view))) { result.status = 'blocked'; result.reason = 'browser_discovery_changed'; return { result, binding: null }; }
  b.discovery = { presetVersion: result.presetVersion, observedAt, evidenceDigest: digest(JSON.stringify({ page, view })), profile: page.profile };
  result.status = 'ready'; result.reason = null; return { result, binding: b };
}

export class BrowserDiscovery {
  private readonly candidates = new Map<string, Candidate>();
  constructor(private readonly bridge: BrowserBridge) {}
  presets() { return browserPresets.map(({ id, version, label, service, verification }) => ({ id, version, label, service, verification })); }
  pages() { return discoveryPages(this.bridge); }
  async discover(input: unknown, existing?: { id: string; browser: BrowserBinding }): Promise<DiscoveryResult> {
    const body = object(input); const pageId = integer(body.pageId, -1, 0, 1_000_000); const profile = string(body.profile, 200);
    const page = (await this.pages()).find(p => p.pageId === pageId && p.profile === profile); if (!page) throw new AppError('browser_discovery_page_missing', 409);
    if (existing?.browser.discovery && existing.browser.discovery.profile !== page.profile) throw new AppError('browser_target_mismatch', 409);
    const preset = browserPresets.find(p => p.id === body.presetId); if (!preset) throw new AppError('browser_preset_not_found', 404);
    const candidate = await discoverBinding(this.bridge, page, preset, existing?.browser);
    this.prune();
    if (candidate.binding) {
      candidate.result.id = id('discovery'); candidate.result.expiresAt = new Date(Date.now() + 300_000).toISOString();
      this.candidates.set(candidate.result.id, { result: structuredClone(candidate.result), binding: candidate.binding, connectionId: existing?.id ?? null });
    }
    return candidate.result;
  }
  async resolve(input: unknown): Promise<{ binding: BrowserBinding; connectionId: string | null; result: DiscoveryResult }> {
    const body = object(input); if (body.confirmed !== true) throw new AppError('browser_discovery_confirmation_required', 409);
    this.prune(); const candidate = this.candidates.get(string(body.discoveryId, 100)); if (!candidate) throw new AppError('browser_discovery_expired', 409);
    if ((body.connectionId ?? null) !== candidate.connectionId) throw new AppError('browser_discovery_scope_mismatch', 409);
    const page = (await this.pages()).find(p => p.pageId === candidate.result.page.pageId && p.profile === candidate.result.page.profile && p.url === candidate.result.page.url);
    if (!page) throw new AppError('browser_discovery_changed', 409);
    const preset = browserPresets.find(p => p.service === (new URL(candidate.binding.url).hostname === 'chatgpt.com' ? 'chatgpt' : 'muse'))!;
    const { result, binding } = await discoverBinding(this.bridge, page, preset, candidate.binding);
    if (!binding || result.status !== 'ready') throw new AppError(result.reason ?? 'browser_discovery_changed', 409);
    const view = await this.bridge.inspect(candidate.binding);
    if (view.identity !== true || view.thread !== true || view.url !== candidate.binding.url) throw new AppError('browser_target_mismatch', 409);
    if (view.draft || view.busy === true || view.ready !== true) throw new AppError('browser_discovery_changed', 409);
    return structuredClone(candidate);
  }
  private prune(): void { for (const [key, c] of this.candidates) if (!c.result.expiresAt || Date.parse(c.result.expiresAt) <= Date.now()) this.candidates.delete(key); if (this.candidates.size >= 100) this.candidates.delete(this.candidates.keys().next().value!); }
}
function cleanUrl(value: string): string { const u = new URL(value); u.hash = ''; return u.href; }
