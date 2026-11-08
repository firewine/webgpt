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

const accountRequest = { pageId: 7, profile: 'default', presetId: 'chatgpt-v1' };
const fixtureIdentity = { source: 'chatgpt-session', userId: 'fixture-user-a', email: 'fixture-a@example.test' };
const tokenSentinel = 'FIXTURE-SENTINEL-DO-NOT-EXPORT';
async function accountFixture(browser, app, mode = 'normal') {
  const page = await fixturePage(browser, 'chatgpt'); const audit = { calls: [], results: [], observations: [] };
  await page.route('**/api/auth/session', async route => {
    audit.calls.push({ url: route.request().url(), method: route.request().method() });
    if (mode === 'network-error') return route.abort('failed');
    if (mode === 'redirect') return route.fulfill({ status: 302, headers: { location: 'https://example.test/session-redirect' } });
    const user = await page.evaluate(() => window.fixtureUser);
    if (mode === 'missing-id') delete user.id;
    if (mode === 'missing-email') delete user.email;
    return route.fulfill({ contentType: mode === 'non-json' ? 'text/html' : 'application/json',
      body: JSON.stringify({ ...(mode === 'missing-user' ? {} : { user }), accessToken: tokenSentinel }) });
  });
  if (mode === 'wrong-origin') await page.goto('https://example.test/c/discovery-fixture');
  await page.locator('[data-testid=accounts-profile-button]').evaluate(e => {
    const button = document.createElement('button'); button.dataset.testid = 'accounts-profile-button'; button.setAttribute('aria-label', 'Open profile menu');
    button.innerHTML = '<svg width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="10" /></svg>'; e.replaceWith(button);
  });
  await page.evaluate(identity => {
    window.fixtureUser = { id: identity.userId, email: identity.email }; window.fixtureAccountRequests = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      window.fixtureAccountRequests.push({ url: String(url), method: options.method, credentials: options.credentials, redirect: options.redirect, cache: options.cache });
      return originalFetch(url, options);
    };
    const input = document.querySelector('#prompt-textarea'), send = document.querySelector('[data-testid=send-button]');
    input.addEventListener('input', () => { send.disabled = false; if (window.fixtureSwitchAt === 'input') window.fixtureUser.id = 'fixture-user-b'; });
    send.onclick = () => {
      window.fixtureSends++; const user = document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.textContent = input.value;
      const answer = document.createElement('div'); answer.dataset.messageAuthorRole = 'assistant'; answer.textContent = 'Account fixture response';
      document.querySelector('form').before(user, answer); input.value = ''; send.disabled = true;
      if (window.fixtureSwitchAt === 'send') window.fixtureUser.id = 'fixture-user-b';
    };
  }, fixtureIdentity);
  attach(app, page, 'chatgpt'); const tool = app.browser.tool;
  app.browser.tool = async (name, args) => {
    const result = await tool(name, args); audit.results.push(result);
    if (name === 'evaluate_script') audit.observations.push({ value: result.structuredContent.result, reads: audit.calls.length });
    return result;
  };
  return { page, audit };
}
function accountCompletion(connectionId) {
  const evidence = { dispatches: 0, receipts: [], deltas: [] };
  return { evidence, input: { requestId: 'account-fixture-turn', participant: { connectionId }, prompt: 'Synthetic account fixture prompt', history: [], signal: AbortSignal.timeout(8000),
    hooks: { dispatched() { evidence.dispatches++; }, receipt(value) { evidence.receipts.push(value); }, delta(value) { evidence.deltas.push(value); } } } };
}

test('R8 account: icon-only discovery and confirmation save only the session identity without DOM changes', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const { page, audit } = await accountFixture(browser, f.app);
  assert.equal(await page.locator('[data-testid=accounts-profile-button]').textContent(), ''); const before = await page.locator('body').innerHTML();
  const found = await f.app.discoverBrowser(accountRequest); assert.equal(found.status, 'ready', JSON.stringify(found)); assert.equal(found.presetVersion, 'chatgpt-v1/5');
  assert.equal(found.identityText, fixtureIdentity.email); assert.equal(f.app.store.read().connections.length, 0);
  const id = await f.app.confirmBrowser({ discoveryId: found.id, confirmed: true, label: 'Icon account fixture' }, 'account-fixture-save');
  const saved = f.app.store.read().connections; assert.equal(saved.length, 1); assert.equal(saved[0].id, id); assert.equal(saved[0].status, 'connected');
  assert.deepEqual(saved[0].browser.accountIdentity, fixtureIdentity); assert.equal(saved[0].browser.discovery.presetVersion, 'chatgpt-v1/5');
  assert.equal(await page.locator('body').innerHTML(), before); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
  assert.ok(audit.calls.length >= 2); assert.ok(audit.calls.every(call => call.url === 'https://chatgpt.com/api/auth/session' && call.method === 'GET'));
  const requests = await page.evaluate(() => window.fixtureAccountRequests); assert.equal(requests.length, audit.calls.length);
  assert.ok(requests.every(r => r.credentials === 'same-origin' && r.redirect === 'error' && r.cache === 'no-store'));
  assert.ok(!JSON.stringify({ store: f.app.store.read(), found, results: audit.results }).includes(tokenSentinel));
});

test('R8 account: deferred session discovery rejects draft, busy and selector changes without touching the owner DOM', { timeout: 30000 }, async t => {
  const browser = await launch(t); const f = await workspace(t);
  for (const mode of ['draft', 'busy', 'selector']) await t.test(mode, async () => {
    const { page, audit } = await accountFixture(browser, f.app);
    const started = Promise.withResolvers(), released = Promise.withResolvers(); let hold = true;
    await page.route('**/api/auth/session', async route => {
      if (hold) { hold = false; started.resolve(); await released.promise; }
      await route.fallback();
    });
    const pending = f.app.discoverBrowser(accountRequest);
    try {
      await Promise.race([started.promise, pending.then(() => { throw new Error('Discovery finished before the session response was deferred'); })]);
      assert.equal(audit.observations.length, 0);
      await page.evaluate(mode => {
        const input = document.querySelector('#prompt-textarea');
        if (mode === 'draft') input.value = 'KEEP OWNER DRAFT while session is pending';
        if (mode === 'busy') document.querySelector('[data-testid=stop-button]').hidden = false;
        if (mode === 'selector') input.after(input.cloneNode(true));
        window.fixtureMutations = 0;
        new MutationObserver(records => { window.fixtureMutations += records.length; }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      }, mode);
      const before = await page.evaluate(() => ({ html: document.body.innerHTML, drafts: [...document.querySelectorAll('textarea')].map(e => e.value) }));
      released.resolve(); const found = await pending;
      assert.notEqual(found.status, 'ready', JSON.stringify(found)); assert.equal(found.id, null); assert.equal(f.app.store.read().connections.length, 0);
      // Later probes must not hide stale evidence returned by the first discovery script.
      const first = audit.observations[0]?.value; assert.ok(first, 'Expected an actual Chromium discovery observation');
      assert.ok(first.supported !== true || first.ambiguous === true || first.draftPresent === true || first.busy === true, 'The first observation must reject the state changed during the session read');
      assert.deepEqual(await page.evaluate(() => ({ html: document.body.innerHTML, drafts: [...document.querySelectorAll('textarea')].map(e => e.value) })), before);
      assert.equal(await page.evaluate(() => window.fixtureMutations), 0); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
      assert.ok(!JSON.stringify({ found, store: f.app.store.read(), results: audit.results }).includes(tokenSentinel));
    } finally {
      released.resolve(); await pending.catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); await page.close();
    }
  });
});

test('R8 account: wrong origin, missing identity, redirects, network errors and non-JSON sessions fail closed', { timeout: 30000 }, async t => {
  const browser = await launch(t); const f = await workspace(t);
  for (const mode of ['wrong-origin', 'missing-user', 'missing-id', 'missing-email', 'redirect', 'network-error', 'non-json']) await t.test(mode, async () => {
    const { page, audit } = await accountFixture(browser, f.app, mode); const before = await page.locator('body').innerHTML();
    if (mode === 'wrong-origin') {
      await assert.rejects(f.app.discoverBrowser(accountRequest), /browser_discovery_(page_missing|origin_mismatch)/); assert.equal(audit.calls.length, 0);
    } else {
      const found = await f.app.discoverBrowser(accountRequest); assert.notEqual(found.status, 'ready', JSON.stringify(found)); assert.equal(found.id, null);
      assert.ok(audit.calls.length > 0); assert.ok(!JSON.stringify(found).includes(tokenSentinel));
    }
    assert.equal(f.app.store.read().connections.length, 0); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
    assert.equal(await page.locator('body').innerHTML(), before); assert.ok(!JSON.stringify(audit.results).includes(tokenSentinel)); await page.close();
  });
});

test('R8 account: changing either user ID or email before confirmation prevents saving', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const { page, audit } = await accountFixture(browser, f.app);
  for (const field of ['id', 'email']) {
    await page.evaluate(identity => { window.fixtureUser = { id: identity.userId, email: identity.email }; }, fixtureIdentity);
    const found = await f.app.discoverBrowser(accountRequest); assert.equal(found.status, 'ready', JSON.stringify(found)); const reads = audit.calls.length;
    await page.evaluate(field => { window.fixtureUser[field] = field === 'id' ? 'fixture-user-b' : 'fixture-b@example.test'; }, field);
    await assert.rejects(f.app.confirmBrowser({ discoveryId: found.id, confirmed: true, label: 'Must not save' }, 'switched-' + field), /browser_/);
    assert.ok(audit.calls.length > reads); assert.equal(f.app.store.read().connections.length, 0); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
  }
  assert.ok(!JSON.stringify({ store: f.app.store.read(), results: audit.results }).includes(tokenSentinel));
});

test('R8 account: actual completion clicks once, records one receipt and never reads the session while polling', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const { page, audit } = await accountFixture(browser, f.app);
  const found = await f.app.discoverBrowser(accountRequest); assert.equal(found.status, 'ready', JSON.stringify(found));
  const id = await f.app.confirmBrowser({ discoveryId: found.id, confirmed: true, label: 'Completion fixture' }, 'complete-save');
  audit.calls.length = 0; audit.results.length = 0; audit.observations.length = 0;
  const { input, evidence } = accountCompletion(id); const result = await f.app.browser.complete(input); const receipt = page.url() + '#' + input.requestId;
  assert.equal(result.text, 'Account fixture response'); assert.equal(result.receipt, receipt); assert.deepEqual(evidence.receipts, [receipt]);
  assert.deepEqual(evidence.deltas, [result.text]); assert.equal(evidence.dispatches, 1); assert.equal(await page.evaluate(() => window.fixtureSends), 1);
  assert.equal(await page.locator('[data-message-author-role=user]').last().textContent(), `[웹쫀쿠:${input.requestId}]\n${input.prompt}`);
  assert.equal(audit.calls.length, 4); const matched = audit.observations.filter(o => o.value.matched === true);
  assert.ok(matched.length >= 4); assert.ok(matched.slice(0, -1).every(o => o.reads === 3 && o.value.accountChecked === false));
  assert.equal(matched.at(-1).reads, 4); assert.equal(matched.at(-1).value.accountChecked, true);
  assert.ok(!JSON.stringify({ store: f.app.store.read(), results: audit.results, result, evidence }).includes(tokenSentinel));
});

test('R8 account: an input event switches accounts before click, leaving a known unsent request', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const { page, audit } = await accountFixture(browser, f.app);
  const found = await f.app.discoverBrowser(accountRequest); assert.equal(found.status, 'ready', JSON.stringify(found));
  const id = await f.app.confirmBrowser({ discoveryId: found.id, confirmed: true, label: 'Before-click fixture' }, 'before-click-save');
  await page.evaluate(() => { window.fixtureSwitchAt = 'input'; }); audit.calls.length = 0;
  const { input, evidence } = accountCompletion(id);
  await assert.rejects(f.app.browser.complete(input), e => e.code === 'browser_account_not_confirmed' && e.status === 409 && e.uncertain === false);
  assert.equal(evidence.dispatches, 1); assert.equal(await page.evaluate(() => window.fixtureSends), 0); assert.deepEqual(evidence.receipts, []); assert.deepEqual(evidence.deltas, []);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), `[웹쫀쿠:${input.requestId}]\n${input.prompt}`); assert.equal(audit.calls.length, 3);
  assert.deepEqual(audit.results.at(-1).structuredContent.result, { sent: false, accountNotConfirmed: true });
  assert.deepEqual(f.app.store.read().connections[0].browser.accountIdentity, fixtureIdentity);
  assert.ok(!JSON.stringify({ store: f.app.store.read(), results: audit.results, evidence }).includes(tokenSentinel));
});

test('R8 account: switching after send keeps the receipt uncertain and applies no response', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const { page, audit } = await accountFixture(browser, f.app);
  const found = await f.app.discoverBrowser(accountRequest); assert.equal(found.status, 'ready', JSON.stringify(found));
  const id = await f.app.confirmBrowser({ discoveryId: found.id, confirmed: true, label: 'After-send fixture' }, 'after-send-save');
  await page.evaluate(() => { window.fixtureSwitchAt = 'send'; }); audit.calls.length = 0; audit.observations.length = 0;
  const { input, evidence } = accountCompletion(id);
  await assert.rejects(f.app.browser.complete(input), e => e.code === 'browser_target_changed' && e.status === 409 && e.uncertain === true);
  assert.equal(evidence.dispatches, 1); assert.equal(await page.evaluate(() => window.fixtureSends), 1);
  assert.deepEqual(evidence.receipts, [page.url() + '#' + input.requestId]); assert.deepEqual(evidence.deltas, []); assert.equal(audit.calls.length, 4);
  const matched = audit.observations.filter(o => o.value.matched === true); assert.ok(matched.length >= 4);
  assert.ok(matched.slice(0, -1).every(o => o.reads === 3 && o.value.accountChecked === false && o.value.identity === true));
  assert.equal(matched.at(-1).reads, 4); assert.equal(matched.at(-1).value.accountChecked, true); assert.equal(matched.at(-1).value.identity, false);
  assert.deepEqual(f.app.store.read().connections[0].browser.accountIdentity, fixtureIdentity);
  assert.ok(!JSON.stringify({ store: f.app.store.read(), results: audit.results, evidence }).includes(tokenSentinel));
});

test('modern ChatGPT discovery scopes Korean/English controls and receipts to the active page', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t);
  for (const { english, sendLabel } of [{ english: false, sendLabel: '메시지 보내기' }, { english: true, sendLabel: 'Send message' }, { english: false, sendLabel: '보내기' }]) {
    const page = await fixturePage(browser, 'chatgpt'); attach(f.app, page, 'chatgpt');
    await page.setContent(`<section data-app-shell-active-page="true"><button aria-label="${english ? 'Open profile menu' : '프로필 메뉴 열기'}">fixture-account · chatgpt</button><header><h1>Modern dot</h1></header>
      <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">[웹쫀쿠:active-fixture]\nEarlier prompt</div></div><div data-markdown-text-style="assistant-message">Active response</div>
      <div role="textbox" contenteditable="true" class="ProseMirror"><p><br class="ProseMirror-trailingBreak"></p></div><button aria-label="${sendLabel}" disabled>Send</button><div data-talvt-turn-state="complete"></div></section>`);
    await page.evaluate(() => {
      const active = document.querySelector('section'); const cached = active.cloneNode(true); cached.dataset.appShellActivePage = 'false'; cached.style.display = 'none';
      cached.querySelector('button').dataset.testid = 'accounts-profile-button'; cached.querySelector('[role=textbox]').id = 'prompt-textarea'; cached.querySelector('button[disabled]').dataset.testid = 'send-button';
      cached.querySelector('[data-user-message-bubble]').dataset.messageAuthorRole = 'user'; cached.querySelector('[data-markdown-text-style]').dataset.messageAuthorRole = 'assistant'; cached.querySelector('[data-markdown-text-style]').textContent = 'Cached response';
      cached.querySelector('[data-talvt-turn-state]').dataset.talvtTurnState = 'streaming'; const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; cached.append(stop); active.before(cached);
      window.fixtureSends = 0; document.querySelectorAll('button').forEach(b => { b.onclick = () => window.fixtureSends++; });
    });
    const before = await page.locator('body').innerHTML(); const service = new BrowserDiscovery(f.app.browser); const request = { pageId: 7, profile: 'default', presetId: 'chatgpt-v1' };
    const found = await service.discover(request); assert.equal(found.status, 'ready', JSON.stringify(found)); assert.equal(found.presetVersion, 'chatgpt-v1/5'); assert.equal(found.busy, false);
    const { binding } = await service.resolve({ discoveryId: found.id, confirmed: true });
    for (const key of ['identitySelector', 'inputSelector', 'sendSelector', 'readySelector']) assert.equal(await page.locator(binding[key]).count(), 1);
    const view = await f.app.browser.inspect(binding, '[웹쫀쿠:active-fixture]'); assert.equal(view.matchCount, 1); assert.equal(view.answer, 'Active response'); assert.equal(view.busy, false);
    assert.equal(await page.locator('body').innerHTML(), before); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
    const active = page.locator('[data-app-shell-active-page=true]');
    await active.locator('[data-talvt-turn-state]').evaluate(e => { e.dataset.talvtTurnState = 'streaming'; });
    const busy = await service.discover(request); assert.equal(busy.status, 'blocked'); assert.equal(busy.reason, 'browser_not_ready'); assert.equal(busy.busy, true);
    await active.locator('[data-talvt-turn-state]').evaluate(e => { e.dataset.talvtTurnState = 'complete'; });
    await active.locator('[role=textbox]').evaluate(e => e.after(e.cloneNode(true))); const ambiguous = await service.discover(request); assert.equal(ambiguous.reason, 'browser_discovery_ambiguous');
    await active.locator('[role=textbox]').nth(1).evaluate(e => e.remove()); await active.locator('[role=textbox]').fill('KEEP OWNER DRAFT');
    const draft = await service.discover(request); assert.equal(draft.reason, 'browser_discovery_draft_present'); assert.equal(await active.locator('[role=textbox]').textContent(), 'KEEP OWNER DRAFT'); assert.equal(await page.evaluate(() => window.fixtureSends), 0);
    await page.close();
  }
});

test('modern ChatGPT long prompts ignore nested blank-line copy spans when associating the owned answer', { timeout: 20000 }, async t => {
  const browser = await launch(t); const f = await workspace(t); const page = await fixturePage(browser, 'chatgpt'); attach(f.app, page, 'chatgpt');
  const requestId = 'long-blank-lines'; const marker = `[웹쫀쿠:${requestId}]`; const expected = 'First owned answer\nOnly this request belongs to this receipt.';
  const sections = Array.from({ length: 80 }, (_, i) => `Section ${i + 1}: ${'Long multiline synthetic user prompt. '.repeat(8)}`);
  const prompt = sections.join('\n\n'); const laterAnswer = 'Unrelated later answer';
  await page.setContent(`<section data-app-shell-active-page="true"><button aria-label="프로필 메뉴 열기">fixture-account · chatgpt</button><header><h1>Modern dot</h1></header>
    <div data-user-message-bubble="true"><div id="owned-user" class="whitespace-pre-wrap" style="white-space:pre-wrap"></div></div>
    <div id="owned-answer" data-markdown-text-style="assistant-message"></div>
    <div data-user-message-bubble="true"><div id="next-user" class="whitespace-pre-wrap">[웹쫀쿠:next-request]\nNext real user prompt</div></div>
    <div id="next-answer" data-markdown-text-style="assistant-message"></div>
    <div role="textbox" contenteditable="true" class="ProseMirror"><p><br class="ProseMirror-trailingBreak"></p></div><button aria-label="메시지 보내기">Send</button><div data-talvt-turn-state="complete"></div></section>`);
  await page.evaluate(({ marker, sections, expected, laterAnswer }) => {
    const body = document.querySelector('#owned-user'); body.append(marker + '\n');
    sections.forEach((section, index) => {
      if (index) { const decoration = document.createElement('span'); decoration.className = 'whitespace-pre-wrap'; decoration.dataset.markdownCopy = 'blank-lines'; decoration.textContent = '\n\n'; body.append(decoration); }
      body.append(section);
    });
    document.querySelector('#owned-answer').textContent = expected; document.querySelector('#next-answer').textContent = laterAnswer;
    window.fixtureSends = 0; document.querySelectorAll('button').forEach(button => { button.onclick = () => window.fixtureSends++; });
    window.fixtureMutations = 0; new MutationObserver(records => { window.fixtureMutations += records.length; }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  }, { marker, sections, expected, laterAnswer });
  assert.equal(await page.locator('#owned-user').textContent(), marker + '\n' + prompt);
  assert.equal(await page.locator('#owned-user [data-markdown-copy="blank-lines"]').count(), sections.length - 1);
  const beforeDiscovery = await page.locator('body').innerHTML(); const service = new BrowserDiscovery(f.app.browser);
  const found = await service.discover({ pageId: 7, profile: 'default', presetId: 'chatgpt-v1' }); assert.equal(found.status, 'ready', JSON.stringify(found));
  const { binding } = await service.resolve({ discoveryId: found.id, confirmed: true });
  const view = await f.app.browser.inspect(binding, marker); assert.equal(view.matched, true); assert.equal(view.matchCount, 1); assert.equal(view.answer, expected);
  assert.doesNotMatch(view.answer, /Unrelated later answer/);
  assert.deepEqual(await page.locator(binding.userSelector).evaluateAll(nodes => nodes.map(node => node.id)), ['owned-user', 'next-user']);
  assert.equal((await f.app.browser.inspect(binding, '[웹쫀쿠:next-request]')).answer, laterAnswer);
  assert.equal(await page.locator('body').innerHTML(), beforeDiscovery); assert.equal(await page.evaluate(() => window.fixtureMutations), 0); assert.equal(f.app.store.read().connections.length, 0);
  f.app.store.transact(s => s.connections.push({ id: 'long-prompt', kind: 'browser', status: 'connected', label: 'fixture', models: [], browser: binding }));
  await page.locator('[role=textbox]').fill('KEEP OWNER DRAFT'); const beforeRecovery = await page.locator('body').innerHTML();
  await page.evaluate(() => { window.fixtureMutations = 0; });
  let dispatches = 0; const receipts = []; let text = '';
  const result = await f.app.browser.complete({ requestId, participant: { id: 'long-p', connectionId: 'long-prompt', kind: 'browser', label: 'fixture', modelId: 'existing-agent', role: '' }, prompt, history: [], signal: AbortSignal.timeout(5000),
    hooks: { dispatched() { dispatches++; }, receipt(value) { receipts.push(value); }, delta(value) { text += value; } } });
  const receipt = page.url() + '#' + requestId; assert.equal(result.text, expected); assert.equal(text, expected); assert.equal(result.receipt, receipt); assert.deepEqual(receipts, [receipt]);
  assert.equal(dispatches, 0); assert.equal(await page.evaluate(() => window.fixtureSends), 0); assert.equal(await page.evaluate(() => window.fixtureMutations), 0);
  assert.equal(await page.locator('[role=textbox]').textContent(), 'KEEP OWNER DRAFT'); assert.equal(await page.locator('body').innerHTML(), beforeRecovery);
});

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
  try {
    await page.route('**/api/state', async route => { const response = await route.fetch(); if (hold) { hold = false; started(); await released; } await route.fulfill({ response }); });
    await openNewTopic(page); f.app.store.transact((_s, emit) => emit({ type: 'connection.fixture_refresh', discussionId: null, data: {} })); await captured;
    await page.locator('#topic').fill('오래된 연결 새로고침 중 만든 토의'); await page.getByRole('button', { name: /토의 시작/ }).click();
    await page.waitForFunction(() => !!localStorage.getItem('wj.discussion')); const selected = await page.evaluate(() => localStorage.getItem('wj.discussion')); release();
    await page.waitForFunction(() => document.querySelector('#discussion-state .badge')?.textContent === '완료', undefined, { timeout: 5000 });
    assert.equal(f.app.store.read().discussions[0].id, selected); assert.equal(f.app.store.read().discussions[0].status, 'completed'); assert.equal(await page.locator('#discussion-title').textContent(), '오래된 연결 새로고침 중 만든 토의');
  } finally {
    // Drain captured polling requests before the fixture server closes.
    release(); await page.unrouteAll({ behavior: 'wait' }); await context.close();
  }
});
