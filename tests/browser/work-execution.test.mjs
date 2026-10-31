import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { executionFixture } from '../work-execution-fixture.mjs';
import { ownerKey, until } from '../workspace-helpers.mjs';
const output = 'test-results/resident/R6';
async function open(t, f) {
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(f.url); await page.locator('#work-new').waitFor(); return { page, errors };
}
async function board(page) { if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator('#board-tab-workspace').click(); }
async function detail(page) { await board(page); await page.locator('#work-items .work-card').first().getByRole('button').click(); await page.locator('#work-detail-dialog').waitFor(); }

test('R6 browser: scoped work form -> original Codex approval -> command evidence -> independent review at four widths', { timeout: 60000 }, async t => {
  const f = await executionFixture(t, { mode: 'approval' }); const { page, errors } = await open(t, f);
  await page.locator('.room-message').first().getByRole('button', { name: '일감 만들기', exact: true }).click(); const form = page.locator('#work-form');
  await form.locator('[name=title]').fill('등록 작업 공간의 읽기 전용 검증'); await form.locator('[name=kind]').selectOption('codex');
  await form.locator('[name=acceptance]').fill('실제 기록된 명령의 종료 상태를 확인'); await form.locator('[name=checkKind]').selectOption('execution');
  await form.locator('[name=allowedParticipantId][value=fake-a]').check(); await form.locator('[name=authorizedScopeRef]').selectOption('binding:' + f.bindingId);
  await form.getByRole('button', { name: '일감 저장', exact: true }).click(); await until(() => f.app.store.read().resident.workItems.length === 1); const id = f.app.store.read().resident.workItems[0].id;
  f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'blocked_approval'); await detail(page);
  await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).waitFor(); assert.match(await page.locator('#work-detail').textContent(), /실행 승인 요청/);
  await mkdir(output, { recursive: true }); await page.screenshot({ path: output + '/approval-1440.png' });
  await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await until(() => f.app.store.read().jobs[0].status === 'completed'); f.bridge.tick(); await f.step();
  await page.waitForFunction(() => document.querySelector('#work-items').textContent.includes('업무 완료'));
  if (await page.locator('#work-detail-dialog').evaluate(n => n.open)) await page.keyboard.press('Escape');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await detail(page);
    await page.locator('#work-detail > details').getByText(/실제 executor journal/).waitFor(); assert.match(await page.locator('#work-detail').textContent(), /업무 완료/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: `${output}/report-${width}.png` }); await page.keyboard.press('Escape');
    await board(page); await page.locator('#work-board').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/queue-${width}.png` });
    const drawer = page.locator('#room-panel-dialog[open]'); if (await drawer.count()) await drawer.getByRole('button', { name: '닫기', exact: true }).click();
  }
  assert.equal(f.task(id).reports.length, 1); assert.equal(f.task(id).reviews[0].reviewerId, 'fake-b'); assert.equal((await f.trace()).filter(v => v.id === '017' && v.result?.decision === 'accept').length, 1);
  assert.deepEqual(errors, []);
});

test('R6 browser: room off refuses a late approval, preserves pending request and allows a separate execution interruption', { timeout: 45000 }, async t => {
  const f = await executionFixture(t, { mode: 'approval' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'blocked_approval');
  const { page, errors } = await open(t, f); await detail(page); f.control({ action: 'off' });
  await page.getByRole('button', { name: '이번 실행 요청 승인', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('방·역할·업무 버전'));
  assert.equal(f.app.store.read().jobs[0].status, 'blocked_approval'); assert.equal(f.app.store.read().jobs[0].approvals[0].status, 'pending');
  assert.equal((await f.trace()).filter(v => v.id === '017' && v.result?.decision === 'accept').length, 0);
  await page.getByRole('button', { name: '이 실행만 중단 요청', exact: true }).click(); await until(() => f.app.store.read().jobs[0].status === 'interrupted'); f.bridge.tick();
  assert.equal(f.task(id).currentReportId, null); assert.equal(f.app.store.read().resident.jobLinks[0].reported, true); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1); assert.deepEqual(errors, []);
});

test('R6 browser: original remote receipt reconciliation reuses one job and keeps unobserved execution as not_run', { timeout: 45000 }, async t => {
  const f = await executionFixture(t, { mode: 'disconnect' }); const id = f.proposeCode(); f.bridge.tick(); await until(() => f.app.store.read().jobs[0]?.status === 'reconciling'); f.bridge.tick();
  const { page, errors } = await open(t, f); await detail(page); assert.equal(await page.getByLabel('원래 Codex turn ID').inputValue(), f.app.store.read().jobs[0].turnId);
  await page.getByRole('button', { name: '원래 Codex 실행 대조', exact: true }).click(); await until(() => f.app.store.read().jobs[0].status === 'completed'); f.bridge.tick();
  await page.getByRole('button', { name: '기록 새로고침', exact: true }).click(); await page.locator('#work-detail > details').getByText(/completed 문구만으로/).waitFor();
  assert.equal(f.task(id).reports[0].checks[0].outcome, 'not_run'); assert.equal((await f.trace()).filter(v => v.method === 'turn/start').length, 1); assert.equal(f.app.store.read().jobs.length, 1); assert.deepEqual(errors, []);
});
