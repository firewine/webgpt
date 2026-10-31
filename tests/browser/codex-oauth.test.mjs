import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { deviceFixture } from '../codex-oauth-fixture.mjs';
import { ownerKey, until } from '../workspace-helpers.mjs';

async function setup(t) {
  const f = await deviceFixture(t); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext(); await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Clipboard unavailable fixture'); } } }); });
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(f.url); await page.locator('[data-view=connections]').click();
  const form = page.locator('#codex-oauth-form'); await form.locator('[name=label]').fill('Device GPT fixture'); await form.locator('[name=expectedEmail]').fill('alice@example.test');
  const start = async () => { await form.getByRole('button', { name: '기기 코드로 로그인', exact: true }).click(); await page.locator('#device-code').getByText(/^TEST-/).waitFor(); };
  return { ...f, page, context, errors, form, start };
}

test('Codex device UI: one click reveals a short code and local-device link; reload/reopen resumes one grant, then verified model/effort registration works without server Chrome', { timeout: 30000 }, async t => {
  const f = await setup(t); assert.equal(await f.form.locator('[name=expectedEmail]').evaluate(e => e.required), true); await f.start();
  await f.page.setViewportSize({ width: 390, height: 844 }); assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await f.page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await f.page.locator('#device-code').textContent(), 'TEST-1'); assert.equal(await f.page.locator('#device-open').getAttribute('href'), 'https://auth.openai.com/codex/device'); assert.equal(await f.page.locator('#device-open').getAttribute('target'), '_blank'); assert.equal(f.app.store.read().browserPaused, false); assert.equal(await f.page.locator('#oauth-desktop-frame').count(), 0); assert.equal(f.resource.length, 0);
  await f.page.locator('#device-copy').click(); await f.page.waitForFunction(() => document.querySelector('#notice').textContent.includes('직접 선택')); assert.equal(await f.page.locator('#device-code').textContent(), 'TEST-1');
  await f.page.locator('#device-close').click(); assert.equal(await f.page.locator('#device-code').textContent(), ''); await f.page.reload(); await f.page.locator('[data-view=connections]').click(); await f.page.getByRole('button', { name: '기기 코드 로그인', exact: true }).click(); await f.page.locator('#device-code').getByText('TEST-1', { exact: true }).waitFor(); assert.equal(f.grants.length, 1);
  await f.release(); await f.page.waitForFunction(() => document.querySelector('#device-status').textContent.includes('로그인·모델 확인을 마쳤')); assert.equal(await f.page.locator('#device-code').textContent(), ''); assert.equal(f.resource.filter(r => r.url.includes('/models?')).length, 1);
  await f.page.locator('#device-close').click(); const connection = f.app.store.read().connections[0]; await f.page.locator('#participant-connection').selectOption(connection.id); assert.equal(await f.page.locator('#participant-effort').inputValue(), 'xhigh'); assert.equal(await f.page.locator('#participant-effort option[value=medium]').evaluate(e => e.disabled), true, JSON.stringify({ models: connection.models, selected: await f.page.locator('#participant-model').inputValue(), options: await f.page.locator('#participant-effort').evaluate(s => [...s.options].map(o => ({ value: o.value, disabled: o.disabled }))) })); await f.page.locator('#participant-effort').selectOption('high'); await f.page.locator('#participant-effort').selectOption('xhigh');
  await f.page.locator('#participant-form [name=label]').fill('GPT fixture talker'); await f.page.getByRole('button', { name: '참여자 등록', exact: true }).click(); await until(() => f.app.store.read().participants.some(p => p.kind === 'codex-oauth')); assert.equal(f.app.store.read().participants.find(p => p.kind === 'codex-oauth').reasoningEffort, 'xhigh');
  await f.page.setViewportSize({ width: 390, height: 844 }); assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(f.app.store.read().jobs.length, 0); assert.ok(!JSON.stringify(f.app.snapshot()).includes('TEST-')); assert.deepEqual(f.errors, []); await mkdir('test-results', { recursive: true }); await f.page.screenshot({ path: 'test-results/device-login-390.png', fullPage: true });
});

test('Codex device UI: a different signed-in email, explicit cancel and expiry retain the account and never auto-start another grant', { timeout: 30000 }, async t => {
  const f = await setup(t); f.controls.email = 'dot@example.test'; await f.start(); await f.release(); await f.page.waitForFunction(() => document.querySelector('#device-status').textContent.includes('다릅니다')); assert.equal(f.app.vault.get(f.app.store.read().connections[0].id), null);
  await f.page.locator('#device-close').click(); f.controls.email = null; await f.page.getByRole('button', { name: '기기 코드 로그인', exact: true }).click(); await f.page.locator('#device-code').getByText('TEST-2', { exact: true }).waitFor(); await f.page.locator('#device-cancel').click(); await f.page.waitForFunction(() => document.querySelector('#device-status').textContent.includes('취소했습니다')); assert.equal(f.grants.length, 2); assert.equal(f.app.store.read().connections.length, 1);
  await f.page.locator('#device-close').click(); await f.page.getByRole('button', { name: '기기 코드 로그인', exact: true }).click(); await f.page.locator('#device-code').getByText('TEST-3', { exact: true }).waitFor(); f.advance(900_001); await f.release(); await f.page.waitForFunction(() => document.querySelector('#device-status').textContent.includes('기기 코드가 만료')); assert.equal(f.grants.length, 3); assert.equal(f.resource.length, 0); assert.equal(await f.page.locator('#device-code').textContent(), ''); assert.deepEqual(f.errors, []);
});
