import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startProcess } from '../helpers.mjs';
test('owner UI: responsive topic discussion, pause/revise/resume, persisted comparison and safe rendering', { timeout: 90000 }, async t => {
  const { url } = await startProcess(t, { WJ_FAKE_DELAY_MS: '180' }); const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  t.diagnostic(`Actual browser: ${browser.version()}`); await mkdir('test-results', { recursive: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = []; const external = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', req => { if (!req.url().startsWith(url)) external.push(req.url()); });
    await page.goto(url); await page.locator('#login-form input').fill('test-owner-key-never-used-outside-fixtures'); await page.getByRole('button', { name: /작업실 열기/ }).click(); await page.waitForFunction(() => !document.querySelector('#workspace').hidden);
    assert.equal(await page.locator('#participant-picker input:checked').count(), 2); await page.screenshot({ path: `test-results/workspace-new-${viewport.width}.png`, fullPage: true });
    const topic = `Ubuntu 서버 구성 비교 ${viewport.width} <img src=x onerror="window.injected=true">`; await page.locator('#topic').fill(topic); await page.getByRole('button', { name: /토의 시작/ }).click();
    await page.waitForFunction(() => !document.querySelector('#discussion-detail').hidden); await page.getByRole('button', { name: '일시정지', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#discussion-state').textContent.includes('일시정지')); await page.reload(); await page.waitForFunction(() => document.querySelector('#discussion-state').textContent.includes('일시정지'));
    await page.getByRole('button', { name: '조건 보완', exact: true }).click(); await page.locator('#action-dialog textarea').fill('비용과 재접속 복구를 함께 비교해 주세요.'); await page.getByRole('button', { name: '적용', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#discussion-meta').textContent.includes('REVISION 2')); await page.getByRole('button', { name: '이어가기', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#discussion-state .badge')?.textContent === '완료', { timeout: 30000 });
    await page.getByRole('button', { name: '결과 비교', exact: true }).click(); assert.equal(await page.locator('.comparison-grid .panel').count(), 2); assert.match(await page.locator('#discussion-content').textContent(), /실제 AI\/사실 검증 아님/);
    assert.equal(await page.locator('#discussion-title img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `test-results/workspace-comparison-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: '주장과 근거', exact: true }).click(); assert.match(await page.locator('#discussion-content').textContent(), /미실행/);
    await page.reload(); await page.waitForFunction(() => document.querySelector('#discussion-state .badge')?.textContent === '완료'); assert.equal(await page.locator('#discussion-title').textContent(), topic);
    await page.locator('[data-view=connections]').click(); assert.equal(await page.locator('#oauth-form').isVisible(), true);
    const viewer = new URL(await page.locator('#browser-link').getAttribute('href'), url);
    assert.equal(new URL(viewer.searchParams.get('path'), viewer).pathname, '/browser/websockify');
    await page.locator('[data-view=execution]').click(); assert.equal(await page.locator('#binding-form').isVisible(), true);
    assert.deepEqual(errors, []); assert.deepEqual(external, []); await page.close();
  }
});
