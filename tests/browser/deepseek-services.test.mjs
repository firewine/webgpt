import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { workspace, ownerKey } from '../workspace-helpers.mjs';

test('DeepSeek UI: CoralBricks and River keep separate service/key/model registrations and the key input clears', { timeout: 30000 }, async t => {
  const f = await workspace(t); const requests = []; f.app.providers.request = async (url, options) => { requests.push({ url, key: options.headers.Authorization }); return Response.json({ data: [{ id: url.includes('river.ai') ? 'deepseek-ai/DeepSeek-fixture' : 'deepseek-fixture-fast' }] }); };
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close()); const context = await browser.newContext();
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); const page = await context.newPage(); await page.goto(f.url); await page.locator('[data-view=connections]').click(); const form = page.locator('#deepseek-form');
  for (const service of ['coralbricks', 'river']) { await form.locator('[name=apiService]').selectOption(service); await form.locator('[name=label]').fill(service + ' DeepSeek'); await form.locator('[name=key]').fill('fixture-key-' + service); await form.getByRole('button', { name: '연결하고 모델 확인', exact: true }).click(); await page.locator('#connections-list article').filter({ has: page.getByRole('heading', { name: service + ' DeepSeek', exact: true }) }).waitFor(); assert.equal(await form.locator('[name=key]').inputValue(), ''); }
  const connections = f.app.store.read().connections; assert.deepEqual(connections.map(c => c.apiService), ['coralbricks', 'river']); assert.notEqual(connections[0].id, connections[1].id); assert.equal(f.app.vault.get(connections[0].id).key, 'fixture-key-coralbricks'); assert.equal(f.app.vault.get(connections[1].id).key, 'fixture-key-river');
  assert.deepEqual(requests, [{ url: 'https://inference.coralbricks.ai/v1/models', key: 'Bearer fixture-key-coralbricks' }, { url: 'https://api.river.ai/v1/models', key: 'Bearer fixture-key-river' }]);
  assert.ok(!JSON.stringify(f.app.snapshot()).includes('fixture-key-')); await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
