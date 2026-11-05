import { openNewTopic } from './topic-ui.mjs';
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

test('room UI has only API daily quotas, separate tool settings and KST/CAS usage while preserving expired legacy records', { timeout: 60000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('No model calls in settings UI'); };
  const archived = { maxRequests: 1, maxTokens: 1, maxToolJobs: 0, deadlineAt: new Date(0).toISOString() }; f.app.store.transact(s => { const r = s.resident.rooms[0]; r.budgets = archived; r.budgetMode = 'legacy'; });
  const original = structuredClone(f.app.store.read().discussions); const { page, errors } = await open(t, f);
  await page.locator('#room-settings').click(); const form = page.locator('#room-settings-form'); assert.equal(await form.locator('[name=budgetMode], [name=maxRequests], [name=maxTokens], [name=deadlineAt]').count(), 0);
  assert.equal(await form.locator('[name=toolDeadlineAt]').isDisabled(), true); assert.equal(await form.locator('[name=minInterval]').inputValue(), '30');
  for (const [key, value] of Object.entries({ minInterval: '30', idleNudge: '300', passBackoff: '120', sleepAfterPasses: '3' })) await form.locator(`[name=${key}]`).fill(value);
  await form.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.locator('#room-settings-dialog').waitFor({ state: 'hidden' });
  assert.equal(f.app.store.read().resident.rooms[0].budgetMode, 'api-daily'); assert.deepEqual(f.app.store.read().resident.rooms[0].budgets, archived); assert.equal(f.app.store.read().apiUsage.policy, null); assert.equal(f.app.store.read().resident.rooms[0].desiredOn, false);
  await page.locator('#room-settings').click(); await page.locator('#room-update-tools').check(); await form.locator('[name=maxToolJobs]').fill('2'); await form.locator('[name=toolDeadlineAt]').fill('2030-01-01T00:00');
  await form.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.locator('#room-settings-dialog').waitFor({ state: 'hidden' });
  assert.equal(f.app.store.read().resident.rooms[0].toolBudget.maxToolJobs, 2); assert.equal(f.app.store.read().resident.rooms[0].toolBudget.deadlineAt, '2030-01-01T08:00:00.000Z'); assert.deepEqual(f.app.store.read().resident.rooms[0].budgets, archived);
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
  await page.locator('#room-focus-new').click();
  // The direct fixture mutation reaches room detail and the shared SSE snapshot
  // separately. Assert after the new snapshot renders, not during that gap.
  await page.locator('#discussion-mode').filter({ hasText: 'API 일일 한도' }).waitFor();
  assert.equal(await page.locator('#discussion-form [name=maxRequests]').isDisabled(), true); assert.equal(await page.locator('#discussion-form [name=maxMinutes]').isDisabled(), true); assert.match(await page.locator('#discussion-mode').innerText(), /API 일일 한도/);
  await openNewTopic(page); assert.equal(await page.locator('#discussion-form [name=maxRequests]').isDisabled(), true);
  assert.equal(calls, 0); assert.deepEqual(f.app.store.read().discussions, original); assert.deepEqual(errors, []);
});

for (const width of [390, 1440]) test(`web-gpt picker separates actual ChatGPT hosts and preserves browser/OAuth identities at ${width}px`, { timeout: 60000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); const calls = [];
  const noTransport = name => async () => { calls.push(name); throw new Error('No transport from picker: ' + name); };
  for (const [object, method] of [[f.app.providers, 'complete'], [f.app.providers, 'models'], [f.app.browser, 'complete'], [f.app.browser, 'tool'], [f.app.oauth, 'begin'], [f.app.codexOAuth, 'begin'], [f.app.dotAdapter, 'complete']]) object[method] = noTransport(method);
  const model = { id: 'fixture', label: 'fixture', reasoningEfforts: ['xhigh'] };
  const discovery = { target: 'dot', presetVersion: 'saved-binding/1', observedAt: new Date().toISOString(), evidenceDigest: 'fixture', profile: 'default' };
  f.app.store.transact(s => {
    // Lookalikes are projection-only fixtures, never submitted as browser bindings.
    for (const c of [
      { id: 'gpt', kind: 'codex-oauth', label: 'Ordinary GPT' },
      { id: 'oauth', kind: 'openai-oauth', label: 'Legacy OAuth GPT' },
      { id: 'native-dot', kind: 'dot-mcp', label: 'Native dot' },
      { id: 'dot', kind: 'browser', label: 'Confirmed dot', browser: { url: 'https://chatgpt.com/g/fixture/c/thread', agentLabel: 'dot', discovery } },
      { id: 'web', kind: 'browser', label: 'Ordinary ChatGPT web', browser: { url: 'https://chatgpt.com/c/ordinary', agentLabel: 'ChatGPT' } },
      { id: 'muse', kind: 'browser', label: 'ChatGPT dot name on Muse', browser: { url: 'https://muse.ai/', agentLabel: 'dot', discovery } },
      { id: 'api', kind: 'deepseek', label: 'API fixture' },
      { id: 'lookalike', kind: 'browser', label: 'ChatGPT dot lookalike', browser: { url: 'https://chatgpt.com.evil.example/c/thread', agentLabel: 'dot', discovery } },
      { id: 'userinfo', kind: 'browser', label: 'ChatGPT dot userinfo', browser: { url: 'https://chatgpt.com@evil.example/c/thread', agentLabel: 'dot', discovery } },
    ]) s.connections.push({ ...c, status: 'connected', models: [model] });
  });
  const oldId = f.app.participant({ connectionId: 'gpt', modelId: 'fixture', label: 'Original actor', role: 'original role' });
  const original = structuredClone(f.app.store.read()); const { page, errors } = await open(t, f, width);
  const writes = [], unexpected = [];
  await page.route('**/api/**', route => {
    const request = route.request(); if (['GET', 'HEAD'].includes(request.method())) return route.continue();
    const path = new URL(request.url()).pathname; writes.push(path);
    if (request.method() === 'POST' && /^\/api\/participants(?:\/[^/]+)?$/.test(path)) return route.continue();
    unexpected.push(path); return route.abort();
  });
  await page.locator('[data-view=connections]').click();
  const mode = page.locator('#participant-mode'), connection = page.locator('#participant-connection'), form = page.locator('#participant-form'), effort = page.locator('#participant-effort');
  const choices = () => connection.locator('option').evaluateAll(options => options.map(o => o.value));
  assert.equal(await mode.inputValue(), 'gpt'); assert.deepEqual(await choices(), ['', 'gpt', 'oauth']);
  await connection.selectOption('gpt'); assert.equal(await effort.isDisabled(), false); assert.equal(await effort.inputValue(), 'xhigh');
  await mode.selectOption('dot'); assert.deepEqual(await choices(), ['', 'native-dot']); assert.equal(await page.locator('#participant-dot-connect').isVisible(), true); assert.equal(await connection.isDisabled(), true);
  await page.locator('#participant-dot-connect').click(); assert.equal(await page.locator('#dot-connection-panel').getAttribute('open'), '');
  await mode.selectOption('other'); assert.deepEqual(await choices(), ['', 'muse', 'api', 'lookalike', 'userinfo']);
  await mode.selectOption('web-gpt'); assert.deepEqual(await choices(), ['', 'dot', 'web']); assert.equal(await page.locator('#participant-fields').isVisible(), true); assert.equal(await connection.isDisabled(), false); assert.equal(await page.locator('#participant-dot-connect').isVisible(), false);
  for (const id of ['dot', 'web']) {
    await connection.selectOption(id); assert.equal(await effort.isDisabled(), true);
    const note = await page.locator('#participant-effort-note').innerText();
    assert.match(note, /ChatGPT/); assert.match(note, /모델/); assert.match(note, /사고|추론/); assert.match(note, /설정|조절|선택/);
  }
  assert.deepEqual(f.app.store.read().participants, original.participants); assert.deepEqual(calls, []); assert.deepEqual(writes, []);

  await page.locator('#participants-list article').filter({ hasText: 'Original actor' }).getByRole('button', { name: '토커 설정 변경' }).click();
  assert.equal(await mode.inputValue(), 'gpt'); assert.equal(await connection.inputValue(), 'gpt'); assert.equal(await form.locator('[name=role]').inputValue(), 'original role'); assert.equal(await effort.isDisabled(), false);
  await mode.selectOption('web-gpt'); assert.equal(await form.locator('[name=participantId]').count(), 0); assert.equal(await form.locator('[name=role]').inputValue(), '');
  await connection.selectOption('dot'); await page.locator('#participant-model').selectOption('fixture'); await form.locator('[name=label]').fill('Browser actor'); await form.locator('[name=role]').fill('browser role'); await page.locator('#participant-save').click();
  const card = label => page.locator('#participants-list article').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  await card('Browser actor').waitFor(); const browserActor = structuredClone(await until(() => f.app.store.read().participants.find(p => p.label === 'Browser actor')));
  assert.equal(browserActor.kind, 'browser'); assert.equal(browserActor.connectionId, 'dot'); assert.equal(browserActor.modelId, 'fixture'); assert.equal(browserActor.reasoningEffort, undefined); assert.notEqual(browserActor.id, oldId);
  await card('Browser actor').getByRole('button', { name: '토커 설정 변경' }).click();
  assert.equal(await mode.inputValue(), 'web-gpt'); assert.equal(await connection.inputValue(), 'dot'); assert.equal(await page.locator('#participant-model').inputValue(), 'fixture'); assert.equal(await effort.isDisabled(), true); assert.equal(await form.locator('[name=participantId]').inputValue(), browserActor.id); assert.equal(await form.locator('[name=role]').inputValue(), 'browser role');
  await form.locator('[name=label]').fill('Browser actor edited'); await form.locator('[name=role]').fill('edited browser role'); await page.locator('#participant-save').click(); await card('Browser actor edited').waitFor();
  await until(() => f.app.store.read().participants.find(p => p.id === browserActor.id)?.role === 'edited browser role');
  const saved = f.app.store.read();
  assert.deepEqual(saved.participants.find(p => p.id === browserActor.id), { ...browserActor, label: 'Browser actor edited', role: 'edited browser role' });
  assert.deepEqual(saved.participants.filter(p => p.id !== browserActor.id), original.participants); assert.equal(saved.participants.length, original.participants.length + 1);
  assert.deepEqual(saved.connections, original.connections); assert.deepEqual(saved.discussions, original.discussions); assert.deepEqual(saved.jobs, original.jobs); assert.deepEqual(saved.resident, original.resident); assert.deepEqual(saved.dotMcp, original.dotMcp); assert.deepEqual(saved.grants, original.grants);
  assert.deepEqual(writes, ['/api/participants', '/api/participants/' + browserActor.id]); assert.deepEqual(unexpected, []); assert.deepEqual(calls, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
});
