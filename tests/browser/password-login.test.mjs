import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { workspace, ownerKey, until } from '../workspace-helpers.mjs';

const password = 'short6', nextPassword = 'other6';
async function browser(t) { const b = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => b.close()); return b; }
async function pageFor(b, f, owner = false) { const c = await b.newContext(); if (owner) await c.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); const page = await c.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); return { page, errors }; }

test('password UI: first setup stacks password/confirmation, refuses mismatch without posting, then uses one field and preserves login across reload', { timeout: 60000 }, async t => {
  const f = await workspace(t, {}, { passwordUnset: true }); const b = await browser(t); const { page, errors } = await pageFor(b, f, true); const posts = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/password/setup')) posts.push(r.url()); }); await page.goto(f.url);
  await page.getByRole('heading', { name: '처음 비밀번호 설정', exact: true }).waitFor(); assert.equal(await page.locator('#login-form [name=token]').count(), 0); assert.equal(await page.locator('#login-password').getAttribute('autocomplete'), 'new-password');
  const first = await page.locator('#login-password').boundingBox(), second = await page.locator('#login-confirm').boundingBox(); assert.ok(second.y > first.y + first.height); assert.equal(await page.locator('#login-confirm').getAttribute('type'), 'password');
  await page.locator('#login-password').fill('five5'); await page.locator('#login-confirm').fill('five5'); await page.locator('#login-submit').click(); await page.locator('#notice').filter({ hasText: '6~128자' }).waitFor(); assert.equal(posts.length, 0); assert.equal(f.app.store.read().ownerPassword, undefined);
  await page.locator('#login-password').fill(password); await page.locator('#login-confirm').fill(nextPassword); await page.locator('#login-submit').click(); await page.locator('#notice').filter({ hasText: '두 비밀번호가 일치하지 않습니다' }).waitFor(); assert.equal(posts.length, 0); assert.equal(f.app.store.read().ownerPassword, undefined);
  await page.locator('#login-confirm').fill(password); await page.locator('#login-submit').click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await page.locator('#notice').filter({ hasText: '비밀번호를 저장했습니다.' }).waitFor(); assert.equal(posts.length, 1); assert.equal(f.app.store.read().ownerPassword.scheme, 'scrypt-v1'); assert.equal(JSON.stringify(f.app.store.read()).includes(password), false);
  assert.equal(await page.locator('#login-password').inputValue(), ''); assert.equal(await page.locator('#login-confirm').inputValue(), '');
  assert.equal(await page.evaluate(p => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes(p), password), false);
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await page.locator('#logout').click(); await page.getByRole('heading', { name: '작업실 로그인', exact: true }).waitFor(); assert.equal(await page.locator('#login-confirm').isVisible(), false); assert.equal(await page.locator('#login-password').getAttribute('autocomplete'), 'current-password');
  await page.locator('#login-password').fill(password); await page.locator('#login-submit').click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
});

test('setup/reset UI: unknown visitor cannot claim owner, one-time link leaves URL before requests, recovery and current-password change work at 390px', { timeout: 60000 }, async t => {
  const f = await workspace(t, {}, { passwordUnset: true }); const b = await browser(t); const { page, errors } = await pageFor(b, f); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(f.url);
  await page.getByRole('heading', { name: '처음 비밀번호 설정', exact: true }).waitFor(); assert.equal(await page.locator('#login-submit').isDisabled(), true); assert.equal(await page.locator('#login-setup-help').isVisible(), true);
  const start = await (await f.api('/api/password/setup-link', {})).json(); const token = new URL(start.url).hash.slice('#password-setup='.length), requests = []; page.on('request', r => requests.push(r.url())); await page.goto(start.url);
  await page.waitForFunction(() => document.querySelector('#login-submit').disabled === false); assert.equal(new URL(page.url()).hash, ''); assert.ok(requests.every(url => !url.includes(token)));
  await page.locator('#login-password').fill(password); await page.locator('#login-confirm').fill(password); await page.locator('#login-submit').click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await page.locator('#logout').click();
  const reset = await (await f.api('/api/password/setup-link', { reset: true })).json(); await page.goto(reset.url); await page.getByRole('heading', { name: '비밀번호 재설정', exact: true }).waitFor();
  await page.locator('#login-password').fill(nextPassword); await page.locator('#login-confirm').fill(nextPassword); await page.locator('#login-submit').click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); assert.equal(f.app.store.read().passwordSetup, null);
  await page.locator('#change-password').click(); const form = page.locator('#password-change-form'); await form.locator('[name=currentPassword]').fill(nextPassword); await form.locator('[name=password]').fill(password); await form.locator('[name=confirmPassword]').fill(password); await form.getByRole('button', { name: '비밀번호 저장', exact: true }).click(); await page.locator('#password-dialog').waitFor({ state: 'hidden' }); await until(() => f.app.store.read().sessions.length === 1);
  await page.locator('#logout').click(); await page.locator('#login-password').fill(password); await page.locator('#login-submit').click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await page.evaluate(p => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes(p), password), false); assert.deepEqual(errors, []);
});

test('lost password setup response reconciles configured state and offers login without replaying the write', { timeout: 30000 }, async t => {
  const f = await workspace(t, {}, { passwordUnset: true }); const b = await browser(t); const { page, errors } = await pageFor(b, f, true); let writes = 0;
  await page.route('**/api/password/setup', async route => { writes++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.fulfill({ status: 200, contentType: 'application/json', body: '{' }); });
  await page.goto(f.url); await page.getByRole('heading', { name: '처음 비밀번호 설정', exact: true }).waitFor(); await page.locator('#login-password').fill(password); await page.locator('#login-confirm').fill(password); await page.locator('#login-submit').click();
  await page.getByRole('heading', { name: '작업실 로그인', exact: true }).waitFor(); assert.equal(writes, 1); assert.equal(await page.locator('#login-confirm').isVisible(), false); assert.equal(f.app.store.read().ownerPassword.scheme, 'scrypt-v1');
  await page.locator('#login-password').fill(password); await page.locator('#login-submit').click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); assert.equal(writes, 1); assert.deepEqual(errors, []);
});
