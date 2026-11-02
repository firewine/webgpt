import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BrowserBridge } from '../../dist/server/connections/browser.js';
import { nativeFixture, key, topicReply, evidence } from '../dot-acceptance-fixture.mjs';
import { unusedPort } from '../helpers.mjs';
import { until } from '../workspace-helpers.mjs';
import { reply } from '../resident-fixture.mjs';

test('D5-D: native stdio dot and installed Chrome MCP Muse keep original thread/draft/receipts across a shared topic', { timeout: 90000, skip: !process.env.WJ_TEST_CHROME_MCP }, async t => {
  const f = await nativeFixture(t), port = await unusedPort();
  const browser = await chromium.launch({ headless: true, args: ['--remote-debugging-port=' + port],
    ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage(), url = 'https://muse.ai/';
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    '<div id="identity">D5 synthetic Muse</div><div id="thread" data-thread="original-side-thread"></div><div id="messages"><p class="assistant" id="original">D5 original conversation</p></div><textarea id="input">D5 unfinished draft</textarea><button id="send">Send</button><span id="ready">Ready</span><span id="busy" hidden>Busy</span>' }));
  await page.goto(url);
  const muse = { id: 'd5-muse', kind: 'browser', connectionId: 'd5-muse-connection', label: 'D5 Muse fixture', modelId: 'existing-agent', role: 'independent reviewer' };
  await page.exposeFunction('d5Answer', raw => {
    const prompt = raw.slice(raw.indexOf('\n') + 1); // BrowserBridge's correlation marker is the first line.
    return prompt.startsWith('웹쫀쿠 상주') ? reply({ text: 'Muse fixture 공개 원문 재검토' }) : topicReply({ prompt, participant: muse });
  });
  await page.evaluate(() => {
    window.sends = 0;
    document.querySelector('#send').onclick = async () => {
      window.sends++; const prompt = document.querySelector('#input').value;
      const user = document.createElement('p'); user.className = 'user'; user.textContent = prompt;
      document.querySelector('#messages').append(user); document.querySelector('#input').value = '';
      document.querySelector('#ready').hidden = true; document.querySelector('#busy').hidden = false;
      const answer = await window.d5Answer(prompt), assistant = document.createElement('p'); assistant.className = 'assistant'; assistant.textContent = answer;
      document.querySelector('#messages').append(assistant); document.querySelector('#busy').hidden = true; document.querySelector('#ready').hidden = false;
    };
  });
  const bridge = new BrowserBridge(f.app.store, [process.env.WJ_TEST_CHROME_MCP, '--browserUrl=http://127.0.0.1:' + port, '--no-usage-statistics']); t.after(() => bridge.close());
  const entry = (await bridge.pages()).split('\n').find(line => line.includes(url)); assert.ok(entry);
  const binding = { pageId: Number(/(\d+)\s*[: ]/.exec(entry)?.[1]), url, accountLabel: 'D5 synthetic Muse', agentLabel: 'Muse',
    identitySelector: '#identity', identityText: 'D5 synthetic Muse', inputSelector: '#input', sendSelector: '#send', userSelector: '.user', assistantSelector: '.assistant', busySelector: '#busy', readySelector: '#ready',
    thread: { selector: '#thread', attribute: 'data-thread', value: 'original-side-thread' } };
  await bridge.probe(binding);
  f.app.store.transact(s => { s.connections.push({ id: muse.connectionId, kind: 'browser', label: muse.label, status: 'connected', models: [{ id: muse.modelId, label: muse.label }], browser: binding }); s.participants.push(muse); });
  const deniedInput = { requestId: 'd5-draft-guard', participant: muse, prompt: 'Must not replace a draft', history: [], signal: AbortSignal.timeout(10000), hooks: { dispatched() { assert.fail('draft must not dispatch'); }, receipt() {}, delta() {} } };
  await assert.rejects(bridge.complete(deniedInput), /browser_requires_intervention/);
  assert.equal(await page.inputValue('#input'), 'D5 unfinished draft'); assert.equal(await page.evaluate(() => window.sends), 0);
  await page.locator('#input').fill('');
  for (const id of ['fake-a', 'fake-b']) f.control({ action: 'set_member', participantId: id, enabled: false });
  f.control({ action: 'set_member', participantId: muse.id, enabled: true });
  const original = f.app.providers.complete.bind(f.app.providers); let active = 0, maximum = 0;
  f.app.providers.complete = async input => {
    active++; maximum = Math.max(maximum, active);
    try { return await (input.participant.kind === 'browser' ? bridge.complete(input) : original(input)); } finally { active--; }
  };
  f.control({ action: 'on' }); await f.step(); await f.step();
  const did = f.app.residentRunner.focus(f.roomId, { topic: 'D5 기존 Muse와 native dot 근거 비교', participantIds: [f.participantId, muse.id], limits: { maxRequests: 60, maxRounds: 2, maxVerificationTasks: 0 } }, key());
  await until(() => f.state().discussions.find(d => d.id === did).status === 'completed', 60000); await f.step();
  await until(() => f.answers.length === f.state().dotMcp.requests.items.length); f.assertClean();
  const s = f.state(), d = s.discussions[0], museTurns = [...s.resident.turns, ...d.turns].filter(turn => turn.participantId === muse.id);
  assert.equal(await page.evaluate(() => window.sends), museTurns.length);
  assert.ok(museTurns.length >= 3); assert.ok(museTurns.every(turn => turn.status === 'completed' && turn.receipt));
  assert.equal(new Set(museTurns.map(turn => turn.receipt)).size, museTurns.length);
  assert.equal(await page.textContent('#original'), 'D5 original conversation');
  assert.equal(await page.getAttribute('#thread', 'data-thread'), binding.thread.value);
  assert.deepEqual(s.connections.find(c => c.id === muse.connectionId).browser, binding);
  assert.equal(f.room().topicLink, null); assert.equal(maximum, 1);
  const count = await page.evaluate(() => window.sends);
  for (let i = 0; i < 20; i++) { await f.api('/api/state'); await f.api('/api/dot/status'); }
  assert.equal(await page.evaluate(() => window.sends), count);
  await evidence('muse-mixed', { installedChromeMcp: true, chromium: browser.version(), nativeReplies: f.answers.length, museFixtureSends: count, draftPreserved: true, originalThreadPreserved: true, reviewRounds: 2, maximumProviderCalls: maximum, realMuseRoundtrip: 'NOT_RUN' });
});
