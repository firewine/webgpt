import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { workspace, ownerKey, until } from '../workspace-helpers.mjs';

async function open(t, f, width = 1440) {
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, timezoneId: 'America/Los_Angeles' });
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(f.url); await page.locator('#room-title').waitFor(); return { page, errors };
}

test('API daily UI opt-in, explicit defaults, KST usage and stale form conflict preserve edits and legacy records at desktop/mobile widths', { timeout: 60000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('No model calls in settings UI'); };
  const original = structuredClone(f.app.store.read().discussions); const { page, errors } = await open(t, f);
  await page.locator('#room-settings').click(); const form = page.locator('#room-settings-form'); assert.equal(await form.locator('[name=budgetMode]').inputValue(), 'legacy');
  await form.locator('[name=budgetMode]').selectOption('api-daily'); assert.equal(await form.locator('[name=maxRequests]').isVisible(), false); assert.equal(await form.locator('[name=deadlineAt]').isDisabled(), true);
  for (const [key, value] of Object.entries({ minInterval: '30', idleNudge: '300', passBackoff: '120', sleepAfterPasses: '3' })) await form.locator(`[name=${key}]`).fill(value);
  await form.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.locator('#room-settings-dialog').waitFor({ state: 'hidden' });
  assert.equal(f.app.store.read().resident.rooms[0].budgetMode, 'api-daily'); assert.equal(f.app.store.read().apiUsage.policy, null); assert.equal(f.app.store.read().resident.rooms[0].desiredOn, false);
  if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator('[data-board-tab=usage]').click();
  await page.locator('#room-api-settings').click(); const daily = page.locator('#api-daily-form'); assert.equal(await daily.locator('[name=maxRequests]').inputValue(), '24'); assert.equal(await daily.locator('[name=maxTokens]').inputValue(), '200000');
  assert.match(await daily.innerText(), /GPT·dot·Muse.*포함하지/);
  await daily.getByRole('button', { name: 'API 한도 저장' }).click(); await page.locator('#api-daily-dialog').waitFor({ state: 'hidden' }); await until(() => f.app.store.read().apiUsage.policy?.maxRequests === 24);
  await page.locator('#room-usage').getByText(/API 요청 0/).waitFor(); assert.match(await page.locator('#room-usage').innerText(), /0{1,2}:00:00 \(KST\)/);
  await page.locator('#room-api-settings').click(); await daily.locator('[name=maxRequests]').fill('30'); f.app.configureApiDaily({ expectedVersion: 1, maxRequests: 25, maxTokens: 200000 }, crypto.randomUUID());
  await daily.getByRole('button', { name: 'API 한도 저장' }).click(); await page.locator('#notice').filter({ hasText: '다른 화면에서 API 한도가 바뀌었습니다' }).waitFor(); assert.equal(await daily.locator('[name=maxRequests]').inputValue(), '30');
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await page.locator('#api-daily-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), true);
  await daily.getByRole('button', { name: '닫기', exact: true }).click(); await page.setViewportSize({ width: 1440, height: 1000 });
  const drawer = page.locator('.room-drawer[open]'); if (await drawer.count()) await drawer.getByRole('button', { name: '닫기', exact: true }).click();
  // Opening a focus requires an explicitly enabled room; saving settings alone
  // above must leave it off. The fixture scheduler remains disabled throughout.
  const roomId = f.app.store.read().resident.rooms[0].id;
  for (const participantId of ['fake-a', 'fake-b']) f.app.resident.control(roomId, { action: 'set_member', expectedVersion: f.app.store.read().resident.rooms[0].version, participantId, enabled: true }, crypto.randomUUID());
  f.app.resident.control(roomId, { action: 'on', expectedVersion: f.app.store.read().resident.rooms[0].version }, crypto.randomUUID());
  await page.locator('#room-focus-new').click(); assert.equal(await page.locator('#discussion-form [name=maxRequests]').isDisabled(), true); assert.equal(await page.locator('#discussion-form [name=maxMinutes]').isDisabled(), true); assert.match(await page.locator('#discussion-mode').innerText(), /API 일일 한도/);
  await page.locator('#new-discussion').click(); assert.equal(await page.locator('#discussion-form [name=maxRequests]').isDisabled(), false);
  assert.equal(calls, 0); assert.deepEqual(f.app.store.read().discussions, original); assert.deepEqual(errors, []);
});

test('ordinary GPT/dot picker only offers explicitly confirmed ChatGPT dot, separates Muse and resets edited identity/role before creating a new actor', { timeout: 60000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('No transport from picker'); };
  const model = { id: 'fixture', label: 'fixture', reasoningEfforts: ['xhigh'] }; f.app.store.transact(s => {
    for (const c of [{ id: 'gpt', kind: 'codex-oauth', label: 'Ordinary GPT' }, { id: 'dot', kind: 'browser', label: 'Confirmed dot', browser: { url: 'https://chatgpt.com/g/fixture/c/thread', agentLabel: 'dot', discovery: { target: 'dot', presetVersion: 'saved-binding/1', observedAt: new Date().toISOString(), evidenceDigest: 'fixture', profile: 'default' } } }, { id: 'muse', kind: 'browser', label: 'dot name on Muse', browser: { url: 'https://muse.ai/', agentLabel: 'dot' } }, { id: 'web', kind: 'browser', label: 'Ordinary ChatGPT web', browser: { url: 'https://chatgpt.com/c/ordinary', agentLabel: 'dot' } }]) s.connections.push({ ...c, status: 'connected', models: [model] });
  });
  const oldId = f.app.participant({ connectionId: 'gpt', modelId: 'fixture', label: 'Original actor', role: 'original role' }); const { page, errors } = await open(t, f);
  await page.locator('[data-view=connections]').click(); const mode = page.locator('#participant-mode'), connection = page.locator('#participant-connection'); assert.equal(await mode.inputValue(), 'gpt'); assert.deepEqual(await connection.locator('option').evaluateAll(o => o.map(x => x.value)), ['', 'gpt']);
  await mode.selectOption('dot'); assert.deepEqual(await connection.locator('option').evaluateAll(o => o.map(x => x.value)), ['', 'dot']); assert.equal(await page.locator('#participant-dot-connect').isVisible(), true);
  await mode.selectOption('other'); assert.deepEqual(await connection.locator('option').evaluateAll(o => o.map(x => x.value)), ['', 'muse', 'web']);
  await page.locator('#participants-list article').filter({ hasText: 'Original actor' }).getByRole('button', { name: '토커 설정 변경' }).click(); assert.equal(await mode.inputValue(), 'gpt'); assert.equal(await page.locator('#participant-form [name=role]').inputValue(), 'original role');
  await mode.selectOption('dot'); assert.equal(await page.locator('#participant-form [name=participantId]').count(), 0); assert.equal(await page.locator('#participant-form [name=role]').inputValue(), '');
  await page.locator('#participant-form [name=label]').fill('New dot actor'); await page.locator('#participant-save').click(); await until(() => f.app.store.read().participants.some(p => p.label === 'New dot actor'));
  const newId = f.app.store.read().participants.find(p => p.label === 'New dot actor').id; assert.notEqual(oldId, newId); assert.equal(f.app.store.read().participants.find(p => p.id === oldId).connectionId, 'gpt'); assert.equal(f.app.store.read().grants.length, 0); assert.equal((f.app.store.read().resident.rooms[0].seats ?? []).length, 0);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(calls, 0); assert.deepEqual(errors, []);
});
