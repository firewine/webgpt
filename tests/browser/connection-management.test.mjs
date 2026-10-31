import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { workspace, ownerKey, until } from '../workspace-helpers.mjs';

async function setup(t) {
  const f = await workspace(t); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext(); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  const visit = async p => { await p.goto(f.url); await p.locator('[data-view=connections]').click(); };
  return { ...f, context, page, errors, visit };
}

test('CoralBricks verification UI shows actual 403 and a fixed official action link, then the same account recovers without exposing key/provider prose', { timeout: 30000 }, async t => {
  const f = await setup(t); let verified = false, calls = 0;
  f.app.providers.request = async (url, options) => { calls++; assert.equal(url, 'https://inference.coralbricks.ai/v1/models'); assert.equal(options.method, undefined); return verified ? Response.json({ data: [{ id: 'deepseek-fixture' }] }) : Response.json({ error: { code: 'permission_denied', message: 'Provide a card on file for verification. cb_private-fixture-key https://untrusted.example private@example.test' } }, { status: 403 }); };
  await f.visit(f.page); const form = f.page.locator('#deepseek-form'); await form.locator('[name=apiService]').selectOption('coralbricks'); await form.locator('[name=label]').fill('Coral fixture'); await form.locator('[name=key]').fill('cb_private-fixture-key'); await form.getByRole('button', { name: '연결하고 모델 확인' }).click();
  const card = f.page.locator('#connections-list article').filter({ has: f.page.getByRole('heading', { name: 'Coral fixture', exact: true }) }); await card.getByText(/계정 검증을 위한 결제수단 등록/).waitFor();
  assert.match(await card.innerText(), /HTTP 403 · permission_denied/); assert.equal(await card.getByRole('link').getAttribute('href'), 'https://www.coralbricks.ai/organization/billing'); assert.equal(await card.getByRole('link').getAttribute('rel'), 'noopener noreferrer');
  assert.doesNotMatch(await f.page.locator('body').innerText(), /cb_private|untrusted.example|private@example/); assert.equal(await form.locator('[name=key]').inputValue(), '');
  await f.page.setViewportSize({ width: 390, height: 844 }); assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const id = f.app.store.read().connections[0].id; verified = true; await card.getByRole('button', { name: '모델 확인', exact: true }).click(); await card.getByText('1개 모델', { exact: true }).waitFor(); assert.equal(await card.getByRole('link').count(), 0); assert.equal(f.app.store.read().connections[0].id, id); assert.equal(f.app.vault.get(id).key, 'cb_private-fixture-key'); assert.equal(calls, 2); assert.deepEqual(f.errors, []);
});

test('connection deletion UI confirms the exact account, cancel preserves it, and deletion disappears in both tabs while original talkers/other credentials remain', { timeout: 30000 }, async t => {
  const f = await setup(t); f.app.store.transact(s => { for (const [id, kind] of [['delete-me', 'openai-oauth'], ['keep-me', 'browser']]) s.connections.push({ id, kind, label: id, status: 'auth_required', models: [] }); s.participants.push({ id: 'original-talker', kind: 'openai-oauth', connectionId: 'delete-me', label: 'Original talker', modelId: 'fixture-model', role: '' }); }); f.app.vault.put('delete-me', { accessToken: 'fixture-private-token' }); f.app.vault.put('keep-me', { fixture: 'untouched' });
  await f.visit(f.page); const other = await f.context.newPage(); await f.visit(other); const card = f.page.locator('#connections-list article').filter({ has: f.page.getByRole('heading', { name: 'delete-me', exact: true }) });
  await card.getByRole('button', { name: '연결 삭제', exact: true }).click(); const dialog = f.page.locator('#action-dialog'); await dialog.waitFor({ state: 'visible' }); assert.match(await dialog.innerText(), /연결 삭제 · delete-me/); assert.match(await dialog.innerText(), /기존 대화·토커·원래 Chrome 대화는 보존/); await f.page.locator('#action-cancel').click(); assert.ok(f.app.vault.get('delete-me')); assert.equal(await card.count(), 1);
  await f.page.setViewportSize({ width: 390, height: 844 }); await card.getByRole('button', { name: '연결 삭제', exact: true }).click(); assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await card.waitFor({ state: 'detached' }); await other.locator('#connections-list article').filter({ has: other.getByRole('heading', { name: 'delete-me', exact: true }) }).waitFor({ state: 'detached' });
  await until(() => f.app.vault.get('delete-me') === null); assert.equal(f.app.vault.get('keep-me').fixture, 'untouched'); assert.equal(await f.page.locator('#connections-list article').count(), 1); assert.equal(await f.page.getByText('연결 삭제됨 · 이전 대화 기록 보존', { exact: false }).count(), 1); assert.equal(f.app.store.read().participants.find(p => p.id === 'original-talker').connectionId, 'delete-me'); assert.deepEqual(f.errors, []);
});
