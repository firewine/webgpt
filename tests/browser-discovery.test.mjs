import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserDiscovery, browserPresets, validatePreset, allowedPageUrl, discoveryPages, discoveryScript } from '../dist/server/connections/browser-discovery.js';
import { runInNewContext } from 'node:vm';
import { Store } from '../dist/server/workspace/store.js';
import { bridgeWithObservation, discoveryUrl } from './browser-discovery-fixture.mjs';
import { workspace, ownerKey } from './workspace-helpers.mjs';
import { browserPages } from '../dist/server/connections/browser.js';

test('R4 presets and page allowlist fail closed; only explicit page/profile is selected', async () => {
  for (const p of browserPresets) assert.equal(validatePreset(p).verification, 'UNVERIFIED');
  assert.throws(() => validatePreset({ ...browserPresets[1], thread: null }), /browser_preset_invalid/);
  assert.throws(() => validatePreset({ ...browserPresets[0], action: 'click' }), /browser_preset_invalid/);
  assert.equal(browserPresets[0].version, 5); assert.equal(browserPresets[0].accountIdentity, 'chatgpt-session');
  for (const accountIdentity of [null, 'dom', 'fetch()', {}]) assert.throws(() => validatePreset({ ...browserPresets[0], accountIdentity }), /browser_preset_invalid/);
  assert.throws(() => validatePreset({ ...browserPresets[1], accountIdentity: 'chatgpt-session' }), /browser_preset_invalid/);
  for (const url of ['http://chatgpt.com/c/test', 'https://chatgpt.com.evil.test/', 'https://login:mypassword@muse.ai/', 'https://127.0.0.1/', 'https://auth.openai.com/', 'https://muse.ai:444/']) assert.equal(allowedPageUrl(url), false);
  const fixture = bridgeWithObservation(browserPresets[0], 'chatgpt'); const service = new BrowserDiscovery(fixture.bridge);
  await assert.rejects(service.discover({ pageId: 7, presetId: 'chatgpt-v1' }), /invalid_text/);
  await assert.rejects(service.discover({ pageId: 8, profile: 'default', presetId: 'chatgpt-v1' }), /browser_discovery_page_missing/);
  await assert.rejects(service.discover({ pageId: 7, profile: 'other-profile', presetId: 'chatgpt-v1' }), /browser_discovery_page_missing/);
  assert.equal(fixture.toolCalls.every(c => c.name === 'list_pages'), true);
  const pages = await discoveryPages({ tool: async () => ({ structuredContent: { pages: [{ id: 1, url: 'https://muse.ai/' }, { id: 2, url: 'http://127.0.0.1/', title: 'private service' }] } }) });
  assert.equal(pages.length, 1); assert.equal(pages[0].pageId, 1);
  const parsed = browserPages({ content: [{ type: 'text', text: '## Pages\n0: New tab (chrome://newtab/)\n7: Fixture (https://muse.ai/) [selected]\n9: Fixture (https://chatgpt.com/c/a) isolatedContext=default' }] });
  assert.equal(parsed[1].id, 7); assert.equal(parsed[2].isolatedContext, 'default');
  const isolated = await discoveryPages({ tool: async () => ({ structuredContent: { pages: [{ id: 1, url: 'https://muse.ai/', isolatedContext: 'default' }] } }) }); assert.equal(isolated[0].profile, 'isolated:default');
  assert.throws(() => browserPages({ content: [{ type: 'text', text: 'unrecognized page list' }] }), /pages_unavailable/);
});

for (const p of browserPresets) for (const mode of ['normal', 'old_dom', 'ambiguous', 'thread_changed', 'draft']) {
  test(`R4-A service ${p.service}/${mode}: no save, no send from discovery`, async () => {
    const f = bridgeWithObservation(p, p.service); const service = new BrowserDiscovery(f.bridge);
    const original = await service.discover({ pageId: 7, profile: 'default', presetId: p.id });
    const saved = (await service.resolve({ discoveryId: original.id, confirmed: true })).binding;
    if (mode === 'old_dom') f.view.supported = false;
    if (mode === 'ambiguous') f.view.ambiguous = true;
    if (mode === 'thread_changed') { f.view.identityText = 'other identity'; f.view.threadValue = 'different-thread'; }
    if (mode === 'draft') f.view.draftPresent = true;
    const found = await service.discover({ pageId: 7, profile: 'default', presetId: p.id }, mode === 'thread_changed' ? { id: 'existing', browser: saved } : undefined);
    assert.equal(found.status, mode === 'normal' ? 'ready' : mode === 'old_dom' ? 'unsupported' : 'blocked');
    assert.equal(!!found.id, mode === 'normal'); assert.equal(f.toolCalls.every(c => ['list_pages', 'evaluate_script'].includes(c.name)), true);
    assert.doesNotMatch(JSON.stringify(found), /selectors|KEEP OWNER DRAFT|Earlier original response/);
  });
}

test('R4 candidate requires confirmation, rechecks live DOM/profile/identity/draft and expires safely', async () => {
  const f = bridgeWithObservation(browserPresets[1], 'muse'); const service = new BrowserDiscovery(f.bridge); const body = { pageId: 7, profile: 'default', presetId: 'muse-v1' };
  const found = await service.discover(body);
  await assert.rejects(service.resolve({ discoveryId: found.id }), /confirmation_required/);
  await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true, connectionId: 'other' }), /scope_mismatch/);
  f.inspectValue.draft = 'owner draft'; await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true }), /discovery_changed/); f.inspectValue.draft = '';
  f.view.threadValue = 'other-thread'; await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true }), /target_mismatch/); f.view.threadValue = 'fixture-thread-a';
  f.profile = 'other-profile'; await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true }), /discovery_changed/); f.profile = null;
  service.candidates.get(found.id).result.expiresAt = new Date(0).toISOString(); await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true }), /expired/);
});

test('R4 owner HTTP discovery -> existing probe -> idempotent save with no hand-entered selectors', async t => {
  const f = await workspace(t); const mock = bridgeWithObservation(browserPresets[1], 'muse'); f.app.browser.tool = mock.bridge.tool; f.app.browser.probe = mock.bridge.probe; f.app.browser.inspect = mock.bridge.inspect;
  const request = { pageId: 7, profile: 'default', presetId: 'muse-v1' }; const before = f.app.store.cursor();
  const result = await (await f.api('/api/browser/discovery', request)).json(); assert.equal(result.status, 'ready'); assert.equal(f.app.store.cursor(), before); assert.equal(f.app.store.read().connections.length, 0);
  const body = { discoveryId: result.id, label: 'Muse fixture', confirmed: true };
  const first = await f.api('/api/browser/discovery/confirm', body, { headers: { 'Idempotency-Key': 'save-candidate-once' } }); assert.equal(first.status, 201, await first.clone().text()); const { id } = await first.json();
  const second = await f.api('/api/browser/discovery/confirm', body, { headers: { 'Idempotency-Key': 'save-candidate-once' } }); assert.equal(second.status, 201); assert.equal((await second.json()).id, id); assert.equal(f.app.store.read().connections.length, 1);
  assert.equal(f.app.store.read().connections[0].browser.url, discoveryUrl('muse')); assert.ok(mock.probes.length); assert.equal(f.app.store.read().connections[0].browser.discovery.presetVersion, 'muse-v1/1');
  const update = await (await f.api('/api/browser/discovery', { ...request, connectionId: id })).json(); assert.equal(update.status, 'ready');
  mock.pageId = 8;
  assert.equal((await f.api('/api/browser/discovery/confirm', { discoveryId: update.id, connectionId: id, label: 'Muse fixture', confirmed: true })).status, 409);
  const found = await (await f.api('/api/browser/discovery', { ...request, pageId: 8, connectionId: id })).json();
  const saved = await f.api('/api/browser/discovery/confirm', { discoveryId: found.id, connectionId: id, label: 'Muse fixture', confirmed: true }); assert.equal(saved.status, 201, await saved.clone().text());
  const c = f.app.store.read().connections[0]; assert.equal(c.browser.pageId, 8); assert.equal(c.browserHistory.length, 1); assert.equal(c.browserHistory[0].binding.pageId, 7);
  assert.equal(mock.toolCalls.every(c => ['list_pages', 'evaluate_script'].includes(c.name)), true); assert.equal(f.app.store.read().discussions.length, 0);
  for (const path of ['/api/browser/discovery/pages', '/api/browser/discovery', '/api/browser/discovery/confirm']) assert.equal((await fetch(f.url + path, path.endsWith('/pages') ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.url }, body: '{}' })).status, 401);
  const wrongOrigin = await f.api('/api/browser/discovery', request, { headers: { Origin: 'https://untrusted.example', Authorization: `Bearer ${ownerKey}` } }); assert.equal(wrongOrigin.status, 403);
});

test('R4 binding update rechecks uncertain/active turns after probe; no mid-turn overwrite', async t => {
  const f = await workspace(t); const mock = bridgeWithObservation(browserPresets[1], 'muse'); f.app.browser.probe = mock.bridge.probe;
  const service = new BrowserDiscovery(mock.bridge); const candidate = await service.discover({ pageId: 7, profile: 'default', presetId: 'muse-v1' }); const { binding } = await service.resolve({ discoveryId: candidate.id, confirmed: true });
  const id = await f.app.addBrowser({ label: 'Muse', binding });
  f.app.browser.probe = async () => { f.app.store.transact(s => { s.discussions.push({ id: 'now-active', members: [{ id: 'browser-p', kind: 'browser', connectionId: id }], turns: [{ participantId: 'browser-p', status: 'running' }] }); }); };
  await assert.rejects(f.app.addBrowser({ connectionId: id, label: 'Muse', binding: { ...binding, pageId: 9 } }), /reconciliation_required/);
  assert.equal(f.app.store.read().connections[0].browser.pageId, 7); assert.equal(f.app.store.read().connections[0].browserHistory, undefined);
});

const account = { source: 'chatgpt-session', userId: 'user-fixture', email: 'owner@example.test' };
const chatRequest = { pageId: 7, profile: 'default', presetId: 'chatgpt-v1' };
function accountFixture() {
  const p = browserPresets[0], f = bridgeWithObservation(p, 'chatgpt'), originalTool = f.bridge.tool;
  Object.assign(f, { profileText: '', location: new URL(discoveryUrl('chatgpt')), requests: [], session: { user: { id: account.userId, email: account.email }, accessToken: 'TOKEN_SENTINEL' } });
  f.bridge.tool = async (name, args) => {
    if (name !== 'evaluate_script') return originalTool(name, args);
    f.toolCalls.push({ name, args });
    const node = textContent => Object.freeze({ textContent, getClientRects: () => [{}] });
    const profile = node(f.profileText), input = Object.freeze({ ...node(''), get value() { return f.draft ?? ''; } });
    const nodes = new Map([[p.identity[0], [profile]], [p.input[0], [input]], [p.ready[0], [input]], [p.send[0], [node('Send')]], [p.user, [node('Earlier user')]], [p.assistant, [node('Earlier response')]]]);
    f.nodes = nodes;
    if (f.missing) nodes.delete(f.missing);
    if (f.duplicate) nodes.set(f.duplicate, [profile, node('duplicate')]);
    f.view = structuredClone(await runInNewContext(`(${args.function})()`, { URL, AbortSignal, location: f.location,
      document: { querySelectorAll: selector => nodes.get(selector) ?? [] }, fetch: async (url, options) => {
        f.requests.push({ url, method: options.method, credentials: options.credentials, cache: options.cache, redirect: options.redirect });
        await f.waitForAccount?.();
        return { ok: true, redirected: false, url, headers: { get: () => 'application/json' }, json: async () => structuredClone(f.session) };
      } }));
    return { structuredContent: { result: f.view } };
  }; return f;
}

test('R8 icon discovery pins minimal metadata through probe, owner reconfirmation and nonempty profile text', async () => {
  const f = accountFixture(), service = new BrowserDiscovery(f.bridge), found = await service.discover(chatRequest);
  assert.equal(found.status, 'ready'); assert.equal(found.identityText, account.email); assert.equal(found.accountIdentity, undefined);
  assert.deepEqual(f.probes[0].accountIdentity, account);
  const { binding } = await service.resolve({ discoveryId: found.id, confirmed: true });
  assert.deepEqual(binding.accountIdentity, account); assert.equal(binding.accountLabel, account.email); assert.equal(f.requests.length, 4);
  f.profileText = 'Now a DOM label';
  const again = await service.discover(chatRequest, { id: 'saved', browser: binding }); assert.equal(again.status, 'ready');
  assert.deepEqual(f.probes.at(-1).accountIdentity, account);
  assert.ok(f.requests.every(r => JSON.stringify(r) === JSON.stringify({ url: 'https://chatgpt.com/api/auth/session', method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' })));
  assert.doesNotMatch(JSON.stringify({ found, binding, probes: f.probes, calls: f.toolCalls, view: f.view }), /TOKEN_SENTINEL|accessToken|Earlier user|Earlier response/);
});

test('R8 DOM identity stays the default; legacy and unsupported UI never acquire metadata', async () => {
  const f = accountFixture(), service = new BrowserDiscovery(f.bridge); f.profileText = 'Legacy owner';
  const found = await service.discover(chatRequest), { binding } = await service.resolve({ discoveryId: found.id, confirmed: true });
  assert.equal(binding.accountIdentity, undefined); assert.equal(f.requests.length, 0);
  f.profileText = ''; assert.equal((await service.discover(chatRequest, { id: 'legacy', browser: binding })).status, 'unsupported'); assert.equal(f.requests.length, 0);
  const p = browserPresets[0];
  for (const selector of [p.identity[0], p.input[0], p.ready[0], p.user, p.assistant]) {
    f.missing = selector; assert.notEqual((await service.discover(chatRequest)).status, 'ready');
  }
  f.missing = null; f.duplicate = p.identity[0]; assert.equal((await service.discover(chatRequest)).status, 'blocked');
  f.duplicate = null; f.location = new URL('https://chatgpt.com/');
  const view = await f.bridge.tool('evaluate_script', { function: discoveryScript(p, undefined, f.location.href) }); assert.equal(view.structuredContent.result.supported, false);
  assert.equal(f.requests.length, 0);
});

test('R8 missing, invalid or changed metadata cannot downgrade or replace a pinned account', async () => {
  for (const session of [null, { user: {} }, { user: { id: account.userId, email: 'invalid' } }, { user: { id: 'different-user', email: account.email } }, { user: { id: account.userId, email: 'other@example.test' } }]) {
    const f = accountFixture(), service = new BrowserDiscovery(f.bridge), found = await service.discover(chatRequest);
    const binding = service.candidates.get(found.id).binding; f.session = session; f.profileText = account.email;
    await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true }), /browser_target_mismatch/);
    assert.equal((await service.discover(chatRequest, { id: 'saved', browser: binding })).id, null); assert.deepEqual(binding.accountIdentity, account);
  }
  const f = accountFixture(), service = new BrowserDiscovery(f.bridge);
  f.bridge.probe = async binding => { assert.deepEqual(binding.accountIdentity, account); f.session.user.id = 'changed-during-probe'; };
  const found = await service.discover(chatRequest); assert.equal(found.id, null); assert.equal(found.reason, 'browser_discovery_changed');
});

test('R8 deferred metadata rejects draft, busy and selector replacement observed after the await', async () => {
  const p = browserPresets[0];
  for (const mode of ['unchanged', 'draft', 'busy', p.identity[0], p.input[0], p.ready[0], p.send[0]]) {
    const f = accountFixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.waitForAccount = () => { entered.resolve(); return release.promise; };
    const pending = f.bridge.tool('evaluate_script', { function: discoveryScript(p, undefined, f.location.href) });
    await entered.promise;
    if (mode === 'draft') f.draft = 'OWNER DRAFT DURING METADATA';
    else if (mode === 'busy') f.nodes.set(p.busy, f.nodes.get(p.send[0]));
    else if (mode !== 'unchanged') f.nodes.set(mode, [{ ...f.nodes.get(mode)[0] }]);
    release.resolve(); const view = (await pending).structuredContent.result;
    if (mode === 'unchanged') { assert.equal(view.supported, true); assert.deepEqual(view.accountIdentity, account); }
    else { assert.equal(view.changed, true, mode); assert.notEqual(view.supported, true, mode); }
    assert.equal(f.requests.length, 1); assert.doesNotMatch(JSON.stringify(view), /OWNER DRAFT|TOKEN_SENTINEL|accessToken/);
  }
});

test('R8 owner HTTP confirmation preserves metadata through manual updates and refuses removal, changes or legacy promotion', async t => {
  const f = await workspace(t), mock = accountFixture(); Object.assign(f.app.browser, mock.bridge);
  const candidate = await (await f.api('/api/browser/discovery', chatRequest)).json(); assert.equal(candidate.status, 'ready'); assert.equal(f.app.store.read().connections.length, 0);
  const saved = await f.api('/api/browser/discovery/confirm', { discoveryId: candidate.id, label: 'Icon account', confirmed: true }); assert.equal(saved.status, 201, await saved.clone().text());
  const { id } = await saved.json(), binding = f.app.store.read().connections[0].browser; assert.deepEqual(binding.accountIdentity, account);
  for (const metadata of [null, { ...account, userId: '' }, { ...account, accessToken: 'TOKEN_SENTINEL' }]) {
    const invalid = await f.api('/api/connections/browser', { connectionId: id, label: 'Icon account', binding: { ...binding, accountIdentity: metadata } }); assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'browser_account_identity_invalid');
  }
  for (const metadata of [{ ...account, userId: 'other-user' }, { ...account, email: 'other@example.test' }]) {
    const mismatch = await f.api('/api/connections/browser', { connectionId: id, label: 'Icon account', binding: { ...binding, accountIdentity: metadata } }); assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).error.code, 'browser_identity_change_not_allowed');
  }
  const update = await (await f.api('/api/browser/discovery', { ...chatRequest, connectionId: id })).json(); mock.session.user.email = 'other@example.test';
  assert.equal((await f.api('/api/browser/discovery/confirm', { discoveryId: update.id, connectionId: id, label: 'Icon account', confirmed: true })).status, 409);
  assert.deepEqual(f.app.store.read().connections[0].browser, binding); assert.doesNotMatch(JSON.stringify(f.app.store.read()), /TOKEN_SENTINEL|accessToken/);
  mock.session.user.email = account.email; mock.pageId = 8;
  const manual = { ...binding, pageId: 8, inputSelector: '#updated-input' }; delete manual.accountIdentity;
  const changed = await f.api('/api/connections/browser', { connectionId: id, label: 'Icon account', binding: manual }); assert.equal(changed.status, 201, await changed.clone().text());
  const preserved = f.app.store.read().connections[0].browser;
  assert.equal(preserved.pageId, 8); assert.equal(preserved.inputSelector, '#updated-input'); assert.deepEqual(preserved.accountIdentity, account);
  assert.deepEqual(mock.probes.at(-1).accountIdentity, account); assert.deepEqual(f.app.store.read().connections[0].browserHistory[0].binding, binding);
  const legacy = { ...manual, pageId: 9, url: 'https://chatgpt.com/c/legacy-fixture' }; delete legacy.discovery;
  const legacyResponse = await f.api('/api/connections/browser', { label: 'Legacy account', binding: legacy }); assert.equal(legacyResponse.status, 201, await legacyResponse.clone().text());
  const legacyId = (await legacyResponse.json()).id, legacySaved = f.app.store.read().connections.find(c => c.id === legacyId);
  const promotion = await f.api('/api/connections/browser', { connectionId: legacyId, label: 'Legacy account', binding: { ...legacy, accountIdentity: account } }); assert.equal(promotion.status, 409);
  assert.equal((await promotion.json()).error.code, 'browser_identity_change_not_allowed');
  assert.equal(legacySaved.browser.accountIdentity, undefined); assert.deepEqual(f.app.store.read().connections.find(c => c.id === legacyId), legacySaved);
  await f.app.close(); const reopened = new Store(f.directory);
  try { assert.deepEqual(reopened.read().connections[0].browser, preserved); } finally { reopened.close(); }
});
