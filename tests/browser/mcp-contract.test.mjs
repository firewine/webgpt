import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BrowserBridge } from '../../dist/server/connections/browser.js';
import { storage } from '../workspace-helpers.mjs';
import { unusedPort } from '../helpers.mjs';
test('installed Chrome DevTools MCP: real JSON-RPC, page IDs, observation and one correlated DOM send', { timeout: 30000, skip: !process.env.WJ_TEST_CHROME_MCP }, async t => {
  const { store } = await storage(t); const port = await unusedPort();
  const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`], ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage(); const url = 'https://chatgpt.com/c/mcp-fixture';
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p id="identity">fixture dot</p><div id="messages"></div><textarea id="input"></textarea><button id="send">Send</button><span id="ready">Ready</span><span id="busy" hidden>Busy</span>' })); await page.goto(url);
  await page.evaluate(() => { window.sends = 0; document.querySelector('#send').onclick = () => { window.sends++; const user = document.createElement('p'); user.className = 'user'; user.textContent = document.querySelector('#input').value; const assistant = document.createElement('p'); assistant.className = 'assistant'; assistant.textContent = 'Chrome MCP fixture 관측'; document.querySelector('#messages').append(user, assistant); document.querySelector('#input').value = ''; }; });
  const bridge = new BrowserBridge(store, [process.env.WJ_TEST_CHROME_MCP, `--browserUrl=http://127.0.0.1:${port}`, '--no-usage-statistics']); t.after(() => bridge.close());
  const pages = await bridge.pages(); const entry = pages.split('\n').find(line => line.includes(url)); assert.ok(entry, pages); const pageId = Number(/(\d+)\s*[: ]/.exec(entry)?.[1]); assert.ok(Number.isInteger(pageId), entry);
  const binding = { pageId, url, accountLabel: 'fixture', agentLabel: 'dot fixture', identitySelector: '#identity', identityText: 'fixture dot', inputSelector: '#input', sendSelector: '#send', userSelector: '.user', assistantSelector: '.assistant', busySelector: '#busy', readySelector: '#ready' };
  await bridge.probe(binding); store.transact(s => s.connections.push({ id: 'browser-mcp', kind: 'browser', label: 'MCP fixture', models: [], status: 'connected', browser: binding }));
  const result = await bridge.complete({ requestId: 'mcp-turn', participant: { id: 'p', kind: 'browser', connectionId: 'browser-mcp', label: 'fixture', modelId: 'existing-agent', role: '' }, prompt: '테스트 질문', history: [], signal: AbortSignal.timeout(10000), hooks: { dispatched() {}, receipt() {}, delta() {} } });
  assert.equal(result.text, 'Chrome MCP fixture 관측'); assert.equal(await page.evaluate(() => window.sends), 1); t.diagnostic('Chrome DevTools MCP 1.12.0 protocol + actual Chromium fixture PASS; no dot/Muse account was used.');
});
