import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BrowserBridge, observationScript, sendScript } from '../../dist/server/connections/browser.js';
import { storage } from '../workspace-helpers.mjs';
const binding = { pageId: 7, url: 'https://chatgpt.com/c/fixture', accountLabel: 'fixture account', agentLabel: 'dot fixture', identitySelector: '#identity', identityText: 'fixture account · dot', inputSelector: '#input', sendSelector: '#send', userSelector: '.user', assistantSelector: '.assistant', busySelector: '#busy', readySelector: '#ready' };
test('browser DOM adapter pins identity, preserves drafts, correlates receipts and never resends an observed request', { timeout: 30000 }, async t => {
  const { store } = await storage(t); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div id="identity">fixture account · dot</div><div id="messages"><div class="assistant">기존 대화 원문</div></div><textarea id="input"></textarea><button id="send" disabled>Send</button><div id="ready">Ready</div><div id="busy" hidden>Busy</div>' })); await page.goto(binding.url);
  await page.evaluate(() => { window.sends = 0; const input = document.querySelector('#input'); const send = document.querySelector('#send'); input.addEventListener('input', () => queueMicrotask(() => { send.disabled = !input.value; })); send.onclick = () => { window.sends++; const user = document.createElement('div'); user.className = 'user'; user.textContent = input.value; document.querySelector('#messages').append(user); input.value = ''; document.querySelector('#busy').hidden = false;
    setTimeout(() => { const answer = document.createElement('div'); answer.className = 'assistant'; answer.textContent = '실제 Chrome DOM fixture 응답'; document.querySelector('#messages').append(answer); document.querySelector('#busy').hidden = true; }, 50); }; });
  store.transact(s => s.connections.push({ id: 'browser', kind: 'browser', label: 'browser fixture', status: 'connected', models: [], browser: binding }));
  const bridge = new BrowserBridge(store, null); bridge.tool = async (name, args) => { assert.equal(name, 'evaluate_script'); assert.equal(args.pageId, 7); return { structuredContent: { result: await page.evaluate(`(${args.function})()`) } }; };
  await bridge.probe(binding); const hooks = { dispatched: 0, receipts: [] }; const input = { requestId: 'fixture-turn', participant: { id: 'p', connectionId: 'browser', kind: 'browser', modelId: 'existing-agent', label: 'dot', role: '' }, prompt: '질문 문자열 "); window.injected=true; ("', history: [], signal: AbortSignal.timeout(8000), hooks: { dispatched: () => hooks.dispatched++, receipt: value => hooks.receipts.push(value), delta: () => {} } };
  await page.locator('#input').fill('사용자가 쓰던 초안'); await assert.rejects(bridge.complete(input), /browser_requires_intervention/); assert.equal(await page.locator('#input').inputValue(), '사용자가 쓰던 초안'); assert.equal(hooks.dispatched, 0);
  await page.locator('#input').fill(''); const completed = await bridge.complete(input); assert.equal(completed.text, '실제 Chrome DOM fixture 응답'); assert.equal(await page.evaluate(() => window.sends), 1); assert.equal(await page.evaluate(() => window.injected), undefined);
  await bridge.complete({ ...input, signal: AbortSignal.timeout(4000) }); assert.equal(await page.evaluate(() => window.sends), 1); assert.equal(hooks.dispatched, 1);
  assert.equal((await page.evaluate(`(${observationScript(binding, '[웹쫀쿠:unknown]')})()`)).answer, '');
  await page.locator('#identity').evaluate(n => { n.textContent = 'another account'; }); await assert.rejects(bridge.complete({ ...input, requestId: 'new-turn' }), /browser_target_mismatch/);
});

test('same-URL side chats pin the thread at observation and final click, and keep replies within the request', { timeout: 30000 }, async t => {
  const { store } = await storage(t); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div id="identity">fixture account · dot</div><div class="thread" data-context=\'{"thread_id":"thread-a"}\'>Current thread</div><div id="messages"></div><textarea id="input"></textarea><div id="ready">Ready</div><div id="busy" hidden>Busy</div>' }));
  const side = { ...binding, url: 'https://muse.ai/', sendAppearsAfterInput: true, thread: { selector: '.thread', attribute: 'data-context', jsonKey: 'thread_id', value: 'thread-a' } };
  await page.goto(side.url);
  await page.evaluate(() => {
    window.sends = 0; window.switchDuringInput = false;
    const input = document.querySelector('#input');
    input.addEventListener('input', () => {
      document.querySelector('#send')?.remove();
      if (!input.value) return;
      if (window.switchDuringInput) document.querySelector('.thread').setAttribute('data-context', '{"thread_id":"thread-b"}');
      const button = document.createElement('button'); button.id = 'send'; button.textContent = 'Send'; document.body.append(button);
      button.onclick = () => {
        window.sends++;
        const user = document.createElement('p'); user.className = 'user'; user.textContent = input.value; document.querySelector('#messages').append(user);
        input.value = ''; button.remove();
        for (const text of ['First response segment', 'Second response segment']) { const a = document.createElement('p'); a.className = 'assistant'; a.textContent = text; document.querySelector('#messages').append(a); }
      };
    });
  });
  const bridge = new BrowserBridge(store, null);
  bridge.tool = async (name, args) => ({ structuredContent: { result: await page.evaluate('(' + args.function + ')()') } });
  await assert.rejects(bridge.probe({ ...side, sendAppearsAfterInput: false }), /browser_selectors_invalid/);
  await bridge.probe(side);
  store.transact(s => s.connections.push({ id: 'side', kind: 'browser', label: 'side fixture', status: 'connected', models: [], browser: side }));
  const input = { requestId: 'side-turn', participant: { id: 'side-p', connectionId: 'side', kind: 'browser', modelId: 'existing-agent', label: 'fixture', role: '' }, prompt: 'Question', history: [], signal: AbortSignal.timeout(8000), hooks: { dispatched() {}, receipt() {}, delta() {} } };
  await page.locator('.thread').evaluate(e => e.setAttribute('data-context', '{"thread_id":"thread-b"}'));
  await assert.rejects(bridge.complete(input), /browser_target_mismatch/);
  assert.equal(await page.locator('#input').inputValue(), '');
  await page.locator('.thread').evaluate(e => e.setAttribute('data-context', '{"thread_id":"thread-a"}'));
  await page.evaluate(() => { window.switchDuringInput = true; });
  assert.equal((await page.evaluate('(' + sendScript(side, 'Temporary fixture draft') + ')()')).sent, false);
  assert.equal(await page.evaluate(() => window.sends), 0);
  await page.evaluate(() => { window.switchDuringInput = false; });
  await page.locator('#input').fill(''); await page.locator('.thread').evaluate(e => e.setAttribute('data-context', '{"thread_id":"thread-a"}'));
  const result = await bridge.complete(input);
  assert.equal(result.text, 'First response segment\n\nSecond response segment');
  assert.equal(await page.evaluate(() => window.sends), 1);
  await page.evaluate(() => { const user = document.createElement('p'); user.className = 'user'; user.textContent = 'Later user message'; const answer = document.createElement('p'); answer.className = 'assistant'; answer.textContent = 'Unrelated later answer'; document.querySelector('#messages').append(user, answer); });
  assert.equal((await page.evaluate('(' + observationScript(side, '[웹쫀쿠:side-turn]') + ')()')).answer, result.text);
  await bridge.complete({ ...input, signal: AbortSignal.timeout(4000) }); assert.equal(await page.evaluate(() => window.sends), 1);
  await page.locator('.thread').evaluate(e => e.setAttribute('data-context', 'invalid-json'));
  await assert.rejects(bridge.probe(side), /browser_target_mismatch/);
});

test('copy-excluded labels preserve receipt matching and recover an existing reply without replay', { timeout: 30000 }, async t => {
  const { store } = await storage(t); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div id="identity">fixture account · dot</div><div id="messages"></div><textarea id="input"></textarea><button id="send">Send</button><div id="ready">Ready</div><div id="busy" hidden>Busy</div>' }));
  await page.goto(binding.url);
  const expected = JSON.stringify({ text: 'Recovered response', claims: [], reviews: [], verifications: [], uncertainty: [] });
  await page.evaluate(({ expected }) => {
    window.sends = 0; document.querySelector('#send').onclick = () => { window.sends++; };
    const log = document.querySelector('#messages');
    const quoted = document.createElement('div'); quoted.className = 'user'; quoted.textContent = 'Ordinary quoted text: [웹쫀쿠:recover-turn]'; log.append(quoted);
    const user = document.createElement('div'); user.className = 'user'; user.id = 'actual-request';
    const label = document.createElement('span'); label.dataset.copyExclude = 'true'; label.textContent = 'UI';
    const body = document.createElement('p'); body.textContent = '[웹쫀쿠:recover-turn]' + String.fromCharCode(10) + 'Original prompt'; user.append(label, body); log.append(user);
    const answer = document.createElement('div'); answer.className = 'assistant';
    const metadata = label.cloneNode(true); const content = document.createElement('p'); content.textContent = expected; answer.append(metadata, content); log.append(answer);
    const later = document.createElement('div'); later.className = 'user'; later.textContent = 'Later unrelated message'; log.append(later);
    const other = document.createElement('div'); other.className = 'assistant'; other.textContent = 'Unrelated response'; log.append(other);
  }, { expected });
  assert.equal(await page.locator('#actual-request').evaluate(e => e.textContent.trim().startsWith('[웹쫀쿠:recover-turn]')), false);
  store.transact(s => s.connections.push({ id: 'recover', kind: 'browser', label: 'recovery fixture', status: 'connected', models: [], browser: binding }));
  const bridge = new BrowserBridge(store, null); bridge.tool = async (name, args) => ({ structuredContent: { result: await page.evaluate('(' + args.function + ')()') } });
  let dispatched = 0; const receipts = [];
  const input = { requestId: 'recover-turn', participant: { id: 'recover-p', connectionId: 'recover', kind: 'browser', modelId: 'existing-agent', label: 'fixture', role: '' }, prompt: 'Original prompt', history: [], signal: AbortSignal.timeout(4000), hooks: { dispatched() { dispatched++; }, receipt(value) { receipts.push(value); }, delta() {} } };
  await page.locator('#input').fill('Keep owner draft');
  const result = await bridge.complete(input);
  assert.equal(result.text, expected); assert.equal(await page.evaluate(() => window.sends), 0); assert.equal(dispatched, 0); assert.equal(receipts.length, 1); assert.equal(await page.locator('#input').inputValue(), 'Keep owner draft');
  await page.locator('#actual-request').evaluate(e => e.after(e.cloneNode(true)));
  await assert.rejects(bridge.complete({ ...input, signal: AbortSignal.timeout(1000) }), /browser_receipt_ambiguous/);
  assert.equal(await page.evaluate(() => window.sends), 0);
  await page.locator('#actual-request').nth(1).evaluate(e => e.remove());
  await page.locator('.assistant').first().evaluate(e => { e.textContent = 'Long response '.repeat(8000); });
  await assert.rejects(bridge.complete({ ...input, signal: AbortSignal.timeout(1000) }), /response_too_large/);
  assert.equal(await page.evaluate(() => window.sends), 0);
});
