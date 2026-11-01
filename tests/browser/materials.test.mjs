import { openNewTopic, openTopicDetails, closeTopicDetails } from './topic-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { workspace, ownerKey } from '../workspace-helpers.mjs';

test('owner attaches server files, sees immutable evidence and inspects policy on desktop/mobile', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wj-browser-materials-')); t.after(() => rm(root, { force: true, recursive: true }));
  const file = join(root, 'requirements.txt'); await writeFile(file, '공유하는 설계 원문 <img src=x onerror=alert(1)>');
  const f = await workspace(t, { materialRoots: [root], codexCommand: [process.execPath] });
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext(); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(f.url); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await openNewTopic(page);
  await page.locator('.material-controls summary').click(); await page.locator('#material-folder').fill(root); await page.locator('#material-browse').click();
  await page.getByRole('button', { name: '추가 · requirements.txt', exact: true }).click(); assert.equal(await page.locator('#material-paths').inputValue(), file);
  // Force SSE to start a slow state refresh before the material POST returns.
  // The POST handler must retain the selection until that render actually runs.
  let saved = false; let held = false; let releaseRefresh; let reportRefresh;
  const refreshStarted = new Promise(resolve => { reportRefresh = resolve; });
  const refreshReleased = new Promise(resolve => { releaseRefresh = resolve; });
  await page.route('**/api/state', async route => {
    const response = await route.fetch();
    if (saved && !held) { held = true; reportRefresh(); await refreshReleased; }
    await route.fulfill({ response });
  });
  await page.route('**/api/materials', async route => {
    saved = true; const response = await route.fetch(); await refreshStarted; await route.fulfill({ response });
  });
  await page.locator('#material-label').fill('설계 원문'); await page.locator('#material-prepare').click();
  await refreshStarted;
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('파일 사본을 저장'));
  releaseRefresh();
  await page.locator('#material-picker input:checked').waitFor(); await page.locator('#material-picker summary').click(); assert.match(await page.locator('#material-picker').textContent(), /SHA-256/);
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden); await openNewTopic(page); assert.match(await page.locator('#material-picker').textContent(), /설계 원문/);
  await page.locator('.material-controls summary').first().click(); await page.locator('#material-picker input').check();
  await page.locator('#topic').fill('첨부한 설계 원문으로 검토'); await page.getByRole('button', { name: /토의 시작/ }).click();
  await page.waitForFunction(() => document.querySelector('#discussion-state .badge')?.textContent === '완료');
  await openTopicDetails(page); await page.getByRole('button', { name: '주장과 근거', exact: true }).click(); assert.match(await page.locator('#discussion-content').textContent(), /공유하는 설계 원문/);
  assert.equal(await page.locator('#discussion-content img').count(), 0);
  await closeTopicDetails(page); await page.locator('[data-view=connections]').click(); await page.getByText('현재 연결과 권한 현황', { exact: true }).click(); await page.locator('#capabilities-refresh').click();
  await page.waitForFunction(() => document.querySelector('#capabilities-report').textContent.includes('자료 읽기 허용'));
  assert.match(await page.locator('#capabilities-report').textContent(), /turn sandbox/); assert.match(await page.locator('#capabilities-report').textContent(), new RegExp(process.versions.node.replaceAll('.', '\\.')));
  await mkdir('test-results', { recursive: true });
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: 'test-results/material-capabilities-' + width + '.png', fullPage: true }); }
  assert.deepEqual(errors, []);
});
