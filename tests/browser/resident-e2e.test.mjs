import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptanceFixture, evidence } from '../resident-acceptance-fixture.mjs';
import { executionFixture } from '../work-execution-fixture.mjs';
import { ownerKey, until } from '../workspace-helpers.mjs';

async function tabs(t, f) {
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const pages = []; const errors = []; const posts = []; const streams = [0, 0];
  for (let i = 0; i < 2; i++) { const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); if (r.url().includes('/api/events?')) streams[i]++; }); await page.goto(f.url); await page.locator('#room-title').waitFor(); pages.push(page); }
  return { pages, errors, posts, streams, browser };
}
async function board(page) { if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator('#board-tab-workspace').click(); }
async function close(page) { const dialog = page.locator('dialog[open]'); if (await dialog.count()) { await dialog.last().getByRole('button', { name: '닫기', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog[open]')); } }
function messages(f, label, count) {
  f.app.store.transact((s, emit) => { const r = s.resident.rooms[0]; for (let i = 0; i < count; i++) { const id = 'browser-r8-' + crypto.randomUUID(); s.resident.messages.push({ id, roomId: r.id, sequence: ++r.lastMessageSequence, sourceKind: 'room', sourceId: null, authorId: 'fake-c', text: label + i + ' · ' + '원문과 반론을 보존하는 긴 발언입니다. '.repeat(20), replyTo: null, mentions: [], visibility: 'room_public', createdAt: new Date().toISOString() }); emit({ type: 'resident.message_created', discussionId: null, data: { roomId: r.id, messageId: id, sequence: r.lastMessageSequence } }); } });
}

test('R8 auto topic UI: old rooms start unchecked, owner explicitly opts in while off, reload retains choice and a live room refuses reconfiguration', { timeout: 30000 }, async t => {
  const f = await acceptanceFixture(t); const b = await tabs(t, f), page = b.pages[0]; await page.locator('#room-settings').click();
  const choice = page.locator('#room-settings-form [name=autoTopic]'); assert.equal(await choice.isChecked(), false); await choice.check(); await page.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#room-settings-dialog').open); assert.equal(f.room().autoTopic, true);
  await page.reload(); await page.locator('#room-settings').click(); assert.equal(await choice.isChecked(), true); await page.locator('#room-settings-dialog [data-close-drawer]').click();
  f.control({ action: 'on' }); const r = f.room(); assert.throws(() => f.control({ action: 'configure', budgets: r.budgets, pacing: r.pacing, autoTopic: false }), /room_configuration_requires_off/); assert.equal(f.room().autoTopic, true);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(b.errors, []); assert.equal(f.calls.length, 0);
});

test('R8-C: two live tabs share the autonomous task/Wiki flow, preserve history/read position after reconnect/reload and remain usable at four widths', { timeout: 90000 }, async t => {
  const f = await acceptanceFixture(t); const b = await tabs(t, f); await f.runUnattended();
  assert.equal(f.room().ledger.length, 8); assert.equal(f.app.snapshot().apiDaily.used.requests, 0);
  for (const page of b.pages) { await board(page); await page.locator('#work-items').getByText('공개 토론에서 나온 분석 일감', { exact: true }).waitFor(); await page.locator('#wiki-items .work-card').waitFor(); await close(page); }
  messages(f, '이전 발언 ', 12); const previous = f.app.store.read().resident.messages.length;
  for (const page of b.pages) { await page.waitForFunction(n => document.querySelectorAll('.room-message').length === n, previous); await page.locator('#room-timeline').evaluate(n => { n.scrollTop = 0; }); }
  await delay(200); const calls = f.calls.length; messages(f, '새 발언 ', 2);
  for (const page of b.pages) { await page.waitForFunction(n => document.querySelectorAll('.room-message').length === n, previous + 2); await page.locator('#room-unread').waitFor(); assert.ok(await page.locator('#room-timeline').evaluate(n => n.scrollTop) < 3); }
  const streams = [...b.streams]; f.http.closeStreams(); await until(() => b.streams.every((v, i) => v > streams[i]), 15000);
  for (const page of b.pages) { await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('실시간')); await page.reload(); await page.waitForFunction(n => document.querySelectorAll('.room-message').length === n, previous + 2); assert.ok(await page.locator('#room-timeline').evaluate(n => n.scrollTop) < 3); }
  await mkdir('test-results/resident/R8', { recursive: true });
  for (const width of [1440, 1024, 768, 390]) for (const [i, page] of b.pages.entries()) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await page.locator('#room-text').isVisible(), true);
    await board(page); assert.match(await page.locator('#work-items').textContent(), /완료/); assert.match(await page.locator('#wiki-items').textContent(), /v2/);
    await page.locator('#board-tab-usage').click(); assert.match(await page.locator('#room-usage').textContent(), /API 일일 한도 미설정 · API만 대기/); await page.locator('#board-tab-workspace').click();
    await close(page); await page.screenshot({ path: `test-results/resident/R8/chat-${width}-tab${i + 1}.png` });
  }
  assert.equal(f.calls.length, calls); assert.equal(f.maximum(), 1); assert.deepEqual(b.posts, []); assert.deepEqual(b.errors, []);
  await evidence('browser-tabs', { browser: b.browser.version(), widths: [1440, 1024, 768, 390], tabs: 2, messages: previous + 2, streams: b.streams, reloads: 2, extraProviderCalls: 0, readOnlyPosts: b.posts.length, maxProvider: f.maximum(), realDevice: 'UNVERIFIED' });
});

test('R8-C: two tabs keep one original approval/receipt and refuse a late second approval without a second job or turn start', { timeout: 60000 }, async t => {
  const f = await executionFixture(t, { mode: 'approval' }); const taskId = f.proposeCode(); f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'blocked_approval');
  const b = await tabs(t, f); const jobId = f.app.store.read().jobs[0].id;
  for (const page of b.pages) { await board(page); await page.locator('#work-items .work-card').first().getByRole('button').click(); await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).waitFor(); }
  for (const width of [1440, 1024, 768, 390]) for (const page of b.pages) {
    await close(page); await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    // The existing resize handler closes drawers; reopen through the ordinary UI.
    await board(page); await page.locator('#work-items .work-card').first().getByRole('button').click(); await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).waitFor();
    assert.ok((await page.locator('#work-detail').textContent()).includes(jobId)); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  let held; await b.pages[1].route('**/api/jobs/*/approve', route => { held = route; });
  await b.pages[1].getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await until(() => held);
  await b.pages[0].getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await until(() => f.app.store.read().jobs[0]?.status === 'completed');
  const response = b.pages[1].waitForResponse(r => r.url().endsWith('/approve')); await held.continue(); assert.equal((await response).status(), 409);
  await f.step(); assert.equal(f.task(taskId).status, 'done'); const s = f.app.store.read(); assert.equal(s.jobs.length, 1); assert.equal(s.resident.jobLinks.length, 1); assert.equal(s.resident.wikiPages.length, 1);
  assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1); assert.equal(s.jobs[0].approvals.filter(v => v.status === 'resolved').length, 1); assert.equal(f.app.store.events(0).filter(v => v.type === 'codex.approval_decided' && v.data.decision === 'accept').length, 1); assert.deepEqual(b.errors, []);
  await evidence('browser-approval', { tabs: 2, widths: [1440, 1024, 768, 390], jobId, lateApprovalStatus: 409, turnStarts: 1, taskStatus: f.task(taskId).status, actualCodexModel: 'NOT_RUN' });
});
