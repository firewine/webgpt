import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { workspace, ownerKey, topic } from '../workspace-helpers.mjs';

test('talker UI selects a separate account, edits default reasoning, and changes a paused discussion independently', { timeout: 30000 }, async t => {
  const f = await workspace(t);
  f.app.store.transact(s => { for (const id of ['web-a', 'web-b']) s.connections.push({ id, kind: 'openai-oauth', label: id, email: id + '@example.test', status: 'connected', models: [{ id: 'fixture-model', label: 'Fixture model' }] }); });
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext(); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); await page.goto(f.url); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await page.locator('[data-view=connections]').click();
  assert.equal(await page.locator('#participant-effort').inputValue(), 'xhigh');
  await page.locator('#participant-connection').selectOption('web-a'); await page.locator('#participant-form [name=label]').fill('Web talker'); await page.locator('#participant-save').click();
  let card = page.locator('#participants-list article').filter({ has: page.getByRole('heading', { name: 'Web talker', exact: true }) }); await card.waitFor();
  assert.match(await card.innerText(), /web-a@example.test/); assert.match(await card.innerText(), /Extra high/);
  await card.getByRole('button', { name: '토커 설정 변경' }).click(); await page.locator('#participant-connection').selectOption('web-b'); await page.locator('#participant-effort').selectOption('high'); await page.locator('#participant-save').click();
  await page.waitForFunction(() => document.querySelector('#participants-list').textContent.includes('web-b@example.test'));
  const member = f.app.store.read().participants.find(p => p.kind === 'openai-oauth'); assert.equal(member.connectionId, 'web-b'); assert.equal(member.reasoningEffort, 'high');
  const did = f.app.engine.create({ ...topic, participantIds: ['fake-a', member.id] }, 'ui-settings-discussion'); f.app.engine.control(did, { action: 'pause', expectedRevision: 1 }, 'ui-settings-pause');
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await page.locator('#history button').first().click();
  await page.getByRole('button', { name: '사고 깊이 변경' }).click(); await page.locator('#action-fields select').selectOption('medium'); await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#member-status').textContent.includes('Medium'));
  assert.equal(f.app.store.read().discussions[0].members.find(p => p.id === member.id).reasoningEffort, 'medium'); assert.equal(f.app.store.read().participants.find(p => p.id === member.id).reasoningEffort, 'high');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-view=connections]').click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
