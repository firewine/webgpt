import { openNewTopic } from './topic-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { BrowserDiscovery, browserPresets } from '../../dist/server/connections/browser-discovery.js';
import { BrowserBridge } from '../../dist/server/connections/browser.js';
import { workspace, ownerKey, until } from '../workspace-helpers.mjs';
import { unusedPort } from '../helpers.mjs';
import { discoveryHtml, discoveryUrl } from '../browser-discovery-fixture.mjs';

async function launch(t, args = []) { const b = await chromium.launch({ headless: true, args, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => b.close()); return b; }
async function fixturePage(browser, service, mode = 'normal') { const p = await browser.newPage(); await p.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: discoveryHtml(service, mode) })); await p.goto(discoveryUrl(service)); return p; }
function attach(app, page, service) {
  let pageId = 7; let isolatedContext; const bridge = app.browser;
  bridge.tool = async (name, args) => {
    if (name === 'list_pages') return { structuredContent: { pages: [{ id: pageId, title: service + ' fixture', url: page.url(), ...(isolatedContext ? { isolatedContext } : {}) }] } };
    assert.equal(name, 'evaluate_script'); assert.equal(args.pageId, pageId); return { structuredContent: { result: await page.evaluate('(' + args.function + ')()') } };
  };
  return { setPageId: id => { pageId = id; }, setProfile: p => { isolatedContext = p; } };
}

test('R4-A: two real DOM fixtures x normal/old/ambiguous/thread-change/draft: discovery mutates and sends zero', { timeout: 45000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const evidence = [];
  for (const preset of browserPresets) for (const mode of ['normal', 'old_dom', 'ambiguous', 'thread_changed', 'draft']) {
    const page = await fixturePage(browser, preset.service, mode === 'thread_changed' ? 'normal' : mode); attach(f.app, page, preset.service);
    const service = new BrowserDiscovery(f.app.browser); const request = { pageId: 7, profile: 'default', presetId: preset.id }; let existing;
    if (mode === 'thread_changed') {
      const initial = await service.discover(request); assert.equal(initial.status, 'ready', JSON.stringify(initial)); existing = { id: 'existing-fixture', browser: (await service.resolve({ discoveryId: initial.id, confirmed: true })).binding };
      if (preset.service === 'muse') await page.locator('[data-hatch-link-entry-point]').evaluate(e => e.setAttribute('data-hatch-link-entry-point', '{"thread_id":"other-thread"}'));
      else await page.evaluate(() => history.replaceState({}, '', '/c/other-thread'));
    }
    const before = await page.locator('body').innerHTML();
    await page.evaluate(() => { window.fixtureMutations = 0; new MutationObserver(records => { window.fixtureMutations += records.length; }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); });
    const result = await service.discover(request, existing);
    assert.equal(result.status, mode === 'normal' ? 'ready' : mode === 'old_dom' ? 'unsupported' : 'blocked', JSON.stringify(result));
    assert.equal(await page.locator('body').innerHTML(), before); assert.equal(await page.evaluate(() => window.fixtureSends), 0); assert.equal(await page.evaluate(() => window.fixtureMutations), 0);
    assert.equal(f.app.store.read().connections.length, 0); assert.doesNotMatch(JSON.stringify(result), /KEEP OWNER DRAFT|Earlier original response/);
    evidence.push({ service: preset.service, mode, status: result.status, sends: 0, mutations: 0, saves: 0 }); await page.close();
  }
  await mkdir('test-results/resident/R4', { recursive: true }); await writeFile('test-results/resident/R4/discovery-matrix.json', JSON.stringify(evidence, null, 2));
});

test('R4-B: owner onboarding has zero selector inputs; confirms profile/identity/thread via existing probe, updates page ID, preserves old binding', { timeout: 60000 }, async t => {
  const browser = await launch(t); await mkdir('test-results/resident/R4', { recursive: true });
  for (const service of ['chatgpt', 'muse']) for (const width of [390, 1440]) {
    const f = await workspace(t); const remote = await fixturePage(browser, service); const adapter = attach(f.app, remote, service); let probes = 0; const probe = f.app.browser.probe.bind(f.app.browser); f.app.browser.probe = async b => { probes++; return probe(b); };
    const context = await browser.newContext({ viewport: { width, height: 1000 } }); const errors = []; await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
    const ui = await context.newPage(); ui.on('pageerror', e => errors.push(e.message)); await ui.goto(f.url); await ui.locator('[data-view=connections]').click(); await ui.getByText('Muse·일반 ChatGPT의 기존 대화 연결', { exact: true }).click();
    await ui.locator('#browser-discovery-pages').click(); await ui.locator('#browser-discovery-page').selectOption('7'); await ui.locator('#browser-discovery-preset').selectOption(service === 'chatgpt' ? 'chatgpt-v1' : 'muse-v1'); await ui.getByRole('button', { name: '기존 대화 읽기 전용 확인', exact: true }).click();
    await ui.locator('#browser-discovery-confirm-form').waitFor(); assert.match(await ui.locator('#browser-discovery-evidence').textContent(), /fixture-account/); assert.match(await ui.locator('#browser-discovery-evidence').textContent(), /프로필/);
    assert.equal(await ui.locator('#browser-advanced').evaluate(e => e.open), false); assert.equal(await ui.locator('#browser-form input:visible').count(), 0);
    await ui.locator('#browser-connection-panel').screenshot({ path: `test-results/resident/R4/candidate-${service}-${width}.png` });
    await ui.locator('#browser-discovery-confirm-form [name=label]').fill(service + ' same conversation'); await ui.locator('#browser-discovery-confirm-form [name=confirmed]').check(); await ui.getByRole('button', { name: '확인한 기존 대화 연결', exact: true }).click();
    await until(() => f.app.store.read().connections.length === 1); assert.ok(probes >= 2); assert.equal(await remote.evaluate(() => window.fixtureSends), 0);
    const saved = f.app.store.read().connections[0]; assert.equal(saved.browser.pageId, 7); assert.ok(saved.browser.discovery); assert.ok(saved.browser.identityText);
    adapter.setPageId(8); await ui.getByRole('button', { name: '기존 대화 다시 찾기', exact: true }).click(); await ui.locator('#browser-discovery-page').selectOption('8'); await ui.getByRole('button', { name: '기존 대화 읽기 전용 확인', exact: true }).click(); await ui.locator('#browser-discovery-confirm-form').waitFor();
    await ui.locator('#browser-discovery-confirm-form [name=confirmed]').check(); await ui.getByRole('button', { name: '확인한 기존 대화 연결', exact: true }).click(); await until(() => f.app.store.read().connections[0].browser.pageId === 8);
    assert.equal(f.app.store.read().connections[0].browserHistory[0].binding.pageId, 7); assert.equal(f.app.store.read().connections.length, 1);
    await ui.getByRole('button', { name: '페이지·선택자 갱신', exact: true }).click(); assert.equal(await ui.locator('#browser-form').isVisible(), true);
    await ui.screenshot({ path: `test-results/resident/R4/onboarding-${service}-${width}.png`, fullPage: true }); assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []); await context.close(); await remote.close();
  }
});

test('R4-C: draft/busy/account/thread/profile changes reject confirm and actual send; no draft clobber', { timeout: 45000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const page = await fixturePage(browser, 'muse'); const adapter = attach(f.app, page, 'muse');
  const service = f.app.browserDiscovery; const request = { pageId: 7, profile: 'default', presetId: 'muse-v1' }; const found = await service.discover(request); const { binding } = await service.resolve({ discoveryId: found.id, confirmed: true });
  f.app.store.transact(s => s.connections.push({ id: 'muse-c', kind: 'browser', status: 'connected', label: 'fixture', models: [], browser: binding }));
  const completion = { requestId: 'never-send', participant: { id: 'muse-p', connectionId: 'muse-c', kind: 'browser', label: 'Muse fixture', modelId: 'existing-agent', role: '' }, history: [], prompt: 'Do not actually send', signal: AbortSignal.timeout(10000), hooks: { dispatched() { throw new Error('must fail before dispatch'); }, delta() {}, receipt() {} } };
  for (const mode of ['draft', 'busy', 'identity', 'thread', 'profile', 'ambiguous']) {
    if (mode === 'draft') await page.locator('textarea').fill('KEEP OWNER DRAFT');
    if (mode === 'busy') await page.locator('[aria-label="Stop generating"]').evaluate(e => { e.hidden = false; });
    if (mode === 'identity') await page.locator('[data-testid=account-name]').evaluate(e => { e.textContent = 'Other account'; });
    if (mode === 'thread') await page.locator('[data-hatch-link-entry-point]').evaluate(e => e.setAttribute('data-hatch-link-entry-point', '{"thread_id":"other-thread"}'));
    if (mode === 'profile') adapter.setProfile('another-profile');
    if (mode === 'ambiguous') await page.locator('textarea').evaluate(e => e.after(e.cloneNode(true)));
    await assert.rejects(service.resolve({ discoveryId: found.id, confirmed: true }), /browser_/);
    await assert.rejects(f.app.browser.complete(completion), /browser_/);
    assert.equal(await page.evaluate(() => window.fixtureSends), 0);
    if (mode === 'draft') { assert.equal(await page.locator('textarea').inputValue(), 'KEEP OWNER DRAFT'); await page.locator('textarea').fill(''); }
    if (mode === 'busy') await page.locator('[aria-label="Stop generating"]').evaluate(e => { e.hidden = true; });
    if (mode === 'identity') await page.locator('[data-testid=account-name]').evaluate(e => { e.textContent = 'fixture-account · muse'; });
    if (mode === 'thread') await page.locator('[data-hatch-link-entry-point]').evaluate(e => e.setAttribute('data-hatch-link-entry-point', '{"thread_id":"fixture-thread-a"}'));
    if (mode === 'profile') adapter.setProfile(undefined);
    if (mode === 'ambiguous') await page.locator('textarea').nth(1).evaluate(e => e.remove());
  }
});

test('R4 legacy manual binding rediscovery preserves custom selectors, side thread and manual lease', { timeout: 30000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const page = await fixturePage(browser, 'muse'); const adapter = attach(f.app, page, 'muse');
  await page.setContent('<p id="legacy-identity">Original custom account · May</p><span id="legacy-thread" data-context=\'{"thread_id":"original-side-thread"}\'>Current</span><p class="old-user">Old user</p><p class="old-assistant">Old assistant</p><textarea id="legacy-input"></textarea><button id="legacy-send">Send</button><span id="legacy-ready">Ready</span><span id="legacy-busy" hidden>Busy</span>');
  const binding = { pageId: 7, url: page.url(), accountLabel: 'Existing owner alias', agentLabel: 'Original agent', identitySelector: '#legacy-identity', identityText: 'Original custom account · May', inputSelector: '#legacy-input', sendSelector: '#legacy-send', userSelector: '.old-user', assistantSelector: '.old-assistant', readySelector: '#legacy-ready', busySelector: '#legacy-busy', thread: { selector: '#legacy-thread', attribute: 'data-context', jsonKey: 'thread_id', value: 'original-side-thread' } };
  const id = await f.app.addBrowser({ label: 'Original', binding }); adapter.setPageId(11); f.app.browserControl(true);
  const result = await f.app.discoverBrowser({ pageId: 11, profile: 'default', presetId: 'muse-v1', connectionId: id }); assert.equal(result.status, 'ready', JSON.stringify(result)); assert.equal(result.presetId, 'saved-binding');
  await f.app.confirmBrowser({ discoveryId: result.id, connectionId: id, confirmed: true, label: 'Original' }, 'legacy-update');
  const saved = f.app.store.read().connections[0]; assert.equal(saved.browser.inputSelector, '#legacy-input'); assert.equal(saved.browser.accountLabel, binding.accountLabel); assert.equal(saved.browser.agentLabel, binding.agentLabel); assert.deepEqual(saved.browser.thread, binding.thread); assert.equal(saved.browserHistory[0].binding.pageId, 7); assert.equal(f.app.store.read().browserPaused, true);
  let dispatch = 0; await assert.rejects(f.app.browser.complete({ participant: { connectionId: id }, hooks: { dispatched() { dispatch++; } } }), /browser_manual_control/); assert.equal(dispatch, 0);
});

test('R4 installed Chrome MCP pages -> read-only discovery -> probe on real DOM, no service account', { timeout: 30000, skip: !process.env.WJ_TEST_CHROME_MCP }, async t => {
  const port = await unusedPort(); const browser = await launch(t, ['--remote-debugging-port=' + port]); const f = await workspace(t); const page = await fixturePage(browser, 'chatgpt');
  const bridge = new BrowserBridge(f.app.store, [process.env.WJ_TEST_CHROME_MCP, '--browserUrl=http://127.0.0.1:' + port, '--no-usage-statistics']); t.after(() => bridge.close());
  const service = new BrowserDiscovery(bridge); const pages = await service.pages(); const target = pages.find(p => p.url === discoveryUrl('chatgpt')); assert.ok(target); assert.match(target.profile, /^(default|isolated:.+)$/);
  const candidate = await service.discover({ pageId: target.pageId, profile: target.profile, presetId: 'chatgpt-v1' }); assert.equal(candidate.status, 'ready', JSON.stringify(candidate));
  const result = await service.resolve({ discoveryId: candidate.id, confirmed: true }); await bridge.probe(result.binding); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
  t.diagnostic('Actual Chrome MCP page IDs + read-only discovery + existing probe PASS. Real dot/Muse NOT_RUN.');
});

test('connection refresh captured before topic creation cannot discard the newly selected discussion', { timeout: 30000 }, async t => {
  const f = await workspace(t); const browser = await launch(t); const context = await browser.newContext(); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); await page.goto(f.url); await page.waitForFunction(() => !document.querySelector('#workspace').hidden);
  let hold = true; let release; let started; const captured = new Promise(resolve => { started = resolve; }); const released = new Promise(resolve => { release = resolve; });
  await page.route('**/api/state', async route => { const response = await route.fetch(); if (hold) { hold = false; started(); await released; } await route.fulfill({ response }); });
  t.after(release);
  await openNewTopic(page); f.app.store.transact((_s, emit) => emit({ type: 'connection.fixture_refresh', discussionId: null, data: {} })); await captured;
  await page.locator('#topic').fill('오래된 연결 새로고침 중 만든 토의'); await page.getByRole('button', { name: /토의 시작/ }).click();
  await page.waitForFunction(() => !!localStorage.getItem('wj.discussion')); const selected = await page.evaluate(() => localStorage.getItem('wj.discussion')); release();
  await page.waitForFunction(() => document.querySelector('#discussion-state .badge')?.textContent === '완료', undefined, { timeout: 5000 });
  assert.equal(f.app.store.read().discussions[0].id, selected); assert.equal(f.app.store.read().discussions[0].status, 'completed'); assert.equal(await page.locator('#discussion-title').textContent(), '오래된 연결 새로고침 중 만든 토의');
});
