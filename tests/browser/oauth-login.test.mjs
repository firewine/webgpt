import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { OAuthService } from '../../dist/server/connections/oauth.js';
import { AppError } from '../../dist/server/workspace/util.js';
import { workspace, ownerKey, until } from '../workspace-helpers.mjs';
import { unusedPort } from '../helpers.mjs';

async function setup(t) {
  const desktop = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<p>Fixture server Chrome login display</p>'); }); desktop.listen(0, '127.0.0.1'); await once(desktop, 'listening'); t.after(() => desktop.close());
  const f = await workspace(t, { noVncPort: desktop.address().port }); f.app.oauth.close(); f.app.oauth = new OAuthService(f.app.store, f.app.vault, await unusedPort(), () => assert.fail('No real OAuth/model network request'));
  const opens = []; f.app.browser.openAuthorization = async (url, connectionId) => { opens.push({ url, connectionId }); };
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext(); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(f.url); await page.locator('[data-view=connections]').click(); await page.locator('#oauth-form [name=label]').fill('Web GPT fixture'); await page.getByRole('button', { name: 'OAuth 로그인 시작', exact: true }).click(); await page.getByRole('button', { name: '별도 로그인 창 열기', exact: true }).waitFor();
  return { ...f, page, context, errors, opens };
}

test('OAuth window: opening a separate server login also reveals its authenticated screen and pauses browser automation', { timeout: 30000 }, async t => {
  const f = await setup(t); await f.page.getByRole('button', { name: '별도 로그인 창 열기', exact: true }).click(); await until(() => f.opens.length === 1);
  assert.equal(f.app.store.read().browserPaused, true); await f.page.frameLocator('#oauth-desktop-frame').getByText('Fixture server Chrome login display', { exact: true }).waitFor();
  assert.equal(new URL(f.opens[0].url).hostname, 'auth.openai.com'); assert.equal(new URL(f.opens[0].url).searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(await f.page.locator('#oauth-desktop-frame').getAttribute('src'), '/browser/vnc.html?autoconnect=1&path=websockify&resize=scale');
  for (const width of [1440, 390]) { await f.page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); assert.equal(await f.page.locator('#oauth-desktop-frame').isVisible(), true); assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
  await f.page.locator('#oauth-screen-close').click(); await f.page.reload(); await f.page.locator('[data-view=connections]').click(); await f.page.getByRole('button', { name: '다시 로그인', exact: true }).click(); await f.page.getByRole('button', { name: '별도 로그인 창 열기', exact: true }).click(); await until(() => f.opens.length === 2);
  assert.deepEqual(f.opens[1], f.opens[0]); assert.equal(f.app.store.read().connections.length, 1); await f.page.frameLocator('#oauth-desktop-frame').getByText('Fixture server Chrome login display', { exact: true }).waitFor();
  await f.page.getByRole('button', { name: '로그인 화면 닫기 · 자동 입력 재개', exact: true }).click(); await until(() => !f.app.store.read().browserPaused); await f.page.locator('#oauth-desktop-frame').waitFor({ state: 'detached' }); assert.deepEqual(f.errors, []);
});

test('OAuth window: active browser work refuses manual takeover and a failed creation is visible without hiding the remote screen', { timeout: 30000 }, async t => {
  const f = await setup(t); const control = f.app.browserControl.bind(f.app); f.app.browserControl = () => { throw new AppError('browser_turn_active', 409); };
  await f.page.getByRole('button', { name: '별도 로그인 창 열기', exact: true }).click(); await f.page.waitForFunction(() => !document.querySelector('#notice').hidden);
  assert.equal(f.opens.length, 0); assert.equal(f.app.store.read().browserPaused, false); assert.equal(await f.page.locator('#oauth-desktop-frame').count(), 0);
  f.app.browserControl = control; f.app.browser.openAuthorization = async () => { throw new AppError('browser_tool_failed', 502); };
  await f.page.getByRole('button', { name: '별도 로그인 창 열기', exact: true }).click(); await f.page.frameLocator('#oauth-desktop-frame').getByText('Fixture server Chrome login display', { exact: true }).waitFor();
  await f.page.waitForFunction(() => document.querySelector('#oauth-screen-status').textContent.includes('열지 못했습니다'));
  assert.equal(f.app.store.read().browserPaused, true); assert.equal(f.app.store.read().connections[0].status, 'auth_required'); await f.page.locator('#oauth-screen-close').click(); await f.page.locator('#oauth-desktop-frame').waitFor({ state: 'detached' }); assert.equal(f.app.store.read().browserPaused, true); assert.deepEqual(f.errors, []);
});
