import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { workFixture } from '../work-fixture.mjs';
import { ownerKey } from '../workspace-helpers.mjs';

const output = 'test-results/resident/R5';
async function open(t, f) {
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(f.url); await page.locator('#work-new').waitFor(); return { page, errors };
}
async function board(page) { if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator('#board-tab-workspace').click(); }

test('work controls wait for initial queue data, so an early click opens the seat dialog after loading instead of being lost', { timeout: 15000 }, async t => {
  const f = await workFixture(t); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); const page = await context.newPage();
  let release; const hold = new Promise(r => { release = r; }); t.after(() => release()); let arrived; const pending = new Promise(r => { arrived = r; });
  await page.route('**/api/rooms/*/work?after=*', async route => { arrived(); await hold; await route.continue(); });
  await page.goto(f.url); await pending; await page.locator('#work-seats').waitFor();
  assert.equal(await page.locator('#work-seats').isDisabled(), true, 'a role edit must not be offered before its current scope arrives'); assert.equal(await page.locator('#work-new').isDisabled(), true);
  const click = page.locator('#work-seats').click(); release(); await click; await page.locator('#work-seat-dialog').waitFor({ state: 'visible' }); await page.locator('#work-seat-form [name=participantId]').selectOption('fake-b'); assert.equal(await page.locator('#work-seat-form [name=role]').inputValue(), 'specialist');
});

test('R5 owner UI: source message -> explicitly scoped task -> one pickup -> automatic report/review -> visible queue on four viewports', { timeout: 60000 }, async t => {
  const f = await workFixture(t); const { page, errors } = await open(t, f);
  await page.locator('.room-message').first().getByRole('button', { name: '일감 만들기', exact: true }).click();
  const form = page.locator('#work-form'); await form.locator('[name=title]').fill('주제와 검증 기준을 정리하는 분석안'); await form.locator('[name=description]').fill('서로 다른 견해와 확인 범위를 정리합니다.');
  await form.locator('[name=acceptance]').fill('합의와 검증을 구분'); await form.locator('[name=checkKind]').selectOption('text_includes'); await form.locator('[name=allowedParticipantId][value=fake-a]').check();
  assert.equal(await form.locator('[name=sourceMessageId]:checked').count(), 1); await form.getByRole('button', { name: '일감 저장', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#work-items .work-card').length === 1); const taskId = f.app.store.read().resident.workItems[0].id;
  await page.locator('#work-items button').click(); await page.getByRole('button', { name: '선택 참여자가 픽업', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#work-detail').textContent.includes('픽업됨')); await page.keyboard.press('Escape');
  await f.step(); await f.step(); await page.waitForFunction(() => document.querySelector('#work-items').textContent.includes('업무 완료'));
  assert.equal(f.task(taskId).reports.length, 1); assert.equal(f.task(taskId).reviews.length, 1); assert.equal(f.app.store.read().resident.workAttempts.filter(a => a.taskId === taskId).length, 2);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await board(page);
    await page.locator('#work-items button').click(); await page.locator('#work-detail').getByText(/산출물 원문에서 지정 문구/).first().waitFor(); assert.match(await page.locator('#work-detail').textContent(), /산출물 원문에서 지정 문구/); assert.match(await page.locator('#work-detail').textContent(), /모의 업무/);
    assert.equal(await page.locator('#work-detail img').count(), 0); await page.screenshot({ path: `${output}/report-${width}.png` }); await page.keyboard.press('Escape');
    await board(page); await page.locator('#work-board').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/queue-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const drawer = page.locator('#room-panel-dialog[open]'); if (await drawer.count()) await drawer.getByRole('button', { name: '닫기', exact: true }).click();
    assert.equal(await page.locator('#room-text').isVisible(), true);
  }
  const before = f.app.store.cursor(); await page.reload(); await board(page); await page.locator('#work-items .work-card').waitFor(); assert.equal(f.app.store.cursor(), before); assert.equal(f.app.store.read().jobs.length, 0); assert.deepEqual(errors, []);
});

test('R5 roles and manual review UI: explicit seat configuration, rework preserves reports, independent confirmation is required', { timeout: 60000 }, async t => {
  const f = await workFixture(t); const { page, errors } = await open(t, f); await page.locator('#work-seats').click(); const seat = page.locator('#work-seat-form');
  await seat.locator('[name=participantId]').selectOption('fake-b'); await seat.locator('[name=role]').selectOption('specialist');
  assert.equal(await seat.locator('[name=enabled]').isChecked(), true); await seat.getByRole('button', { name: '역할·범위 저장', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#work-seat-dialog').open);
  assert.equal(f.app.store.read().resident.rooms[0].seats.find(s => s.participantId === 'fake-b').version, 2);
  const id = f.propose({ title: '독립 수동 확인이 필요한 분석안', acceptance: [{ id: 'manual', text: '근거와 남은 이견을 직접 확인', check: { kind: 'manual' } }] });
  await f.step(); await f.step(); await page.waitForFunction(() => !!document.querySelector('#work-items [data-reason=work_acceptance_not_observed]'));
  await page.locator('#work-items button').click(); await page.locator('#work-review-form [name=reason]').fill('근거를 보완해서 다시 보고해 주세요.'); await page.locator('#work-review-form [name=decision]').selectOption('rework'); await page.getByRole('button', { name: '독립 검토 저장', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#work-detail-dialog').open && !document.querySelector('#work-review-form')); await page.keyboard.press('Escape'); const firstDigest = f.task(id).reports[0].digest;
  await f.step(); await f.step(); await page.locator('#work-items button').click(); await page.locator('#work-review-form [name=confirmedAcceptanceId]').check(); await page.locator('#work-review-form [name=reason]').fill('원문 산출물과 근거·이견을 직접 확인했습니다.'); await page.getByRole('button', { name: '독립 검토 저장', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#work-detail').textContent.includes('업무 완료')); const task = f.task(id); assert.equal(task.reports.length, 2); assert.equal(task.reports[0].digest, firstDigest); assert.equal(task.reviews.at(-1).reviewerId, 'owner');
  assert.equal(task.reviews.at(-1).checks[0].outcome, 'observed_pass'); assert.deepEqual(errors, []);
});

test('R5 seat form holds its displayed version across SSE refresh and refuses to overwrite a concurrent policy change', { timeout: 45000 }, async t => {
  const f = await workFixture(t); const { page, errors } = await open(t, f); await page.locator('#work-seats').click(); const form = page.locator('#work-seat-form'); await form.locator('[name=participantId]').selectOption('fake-b');
  const refreshed = page.waitForResponse(r => r.url().includes('/work?after='));
  f.q.seat(f.roomId, { participantId: 'fake-b', expectedVersion: 1, role: 'monitor', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, crypto.randomUUID()); await refreshed;
  await form.getByRole('button', { name: '역할·범위 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('다른 화면에서 업무 배정'));
  assert.equal(f.app.store.read().resident.rooms[0].seats.find(s => s.participantId === 'fake-b').role, 'monitor'); assert.equal(await page.locator('#work-seat-dialog').evaluate(n => n.open), true); assert.equal(await form.locator('[name=role]').inputValue(), 'specialist'); assert.deepEqual(errors, []);
});
