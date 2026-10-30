import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserDiscovery, browserPresets, validatePreset, allowedPageUrl, discoveryPages } from '../dist/server/connections/browser-discovery.js';
import { bridgeWithObservation, discoveryUrl } from './browser-discovery-fixture.mjs';
import { workspace, ownerKey } from './workspace-helpers.mjs';
import { browserPages } from '../dist/server/connections/browser.js';

test('R4 presets and page allowlist fail closed; only explicit page/profile is selected', async () => {
  for (const p of browserPresets) assert.equal(validatePreset(p).verification, 'UNVERIFIED');
  assert.throws(() => validatePreset({ ...browserPresets[1], thread: null }), /browser_preset_invalid/);
  assert.throws(() => validatePreset({ ...browserPresets[0], action: 'click' }), /browser_preset_invalid/);
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
