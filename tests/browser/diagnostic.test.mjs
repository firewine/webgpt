import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixture } from '../helpers.mjs';

test('desktop and narrow browser: select, send, complete, recover and reset', { timeout: 60_000 }, async (t) => {
  const { url } = await fixture(t);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}),
  });
  t.diagnostic(`Browser: ${browser.version()}`);
  t.after(() => browser.close());
  await mkdir('test-results', { recursive: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#connection-status').dataset.ready === 'true');
    assert.equal(await page.title(), '웹쫀쿠 · 연결 진단');
    assert.equal(await page.locator('#send').isDisabled(), true);
    assert.equal(await page.locator('#participant option').count(), 2);
    const externalRequests = [];
    page.on('request', (request) => {
      if (!request.url().startsWith(url)) externalRequests.push(request.url());
    });
    const text = '한글 연결 확인 <img src=x onerror="window.injected=true">';
    await page.locator('#message').fill(text);
    await page.getByRole('button', { name: '메시지 보내기' }).click();
    await page.waitForFunction(() => document.querySelector('#turn-status').textContent === '완료');
    assert.ok((await page.locator('.provider-message').textContent()).includes(text));
    assert.equal(await page.locator('.message img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.locator('#participant').selectOption('fake-b');
    await page.locator('#message').fill('두 번째 참여자에게 보내는 메시지');
    await page.getByRole('button', { name: '메시지 보내기' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.turn .tag')[1]?.textContent === '완료');
    assert.match(await page.locator('.turn').last().textContent(), /테스트 참여자 B/);
    assert.equal(await page.locator('.transcript-wrap').evaluate((node) =>
      node.scrollTop + node.clientHeight >= node.scrollHeight - 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `test-results/diagnostic-${viewport.width}.png`, fullPage: true });

    await page.route('**/api/turns', (route) => route.fulfill({
      status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: '다른 요청이 실행 중입니다.' } }),
    }));
    await page.locator('#message').fill('실패해도 유지할 입력');
    await page.getByRole('button', { name: '메시지 보내기' }).click();
    await page.waitForFunction(() => document.querySelector('#turn-status').textContent === '실패');
    assert.equal(await page.locator('#message').inputValue(), '실패해도 유지할 입력');
    assert.equal(await page.locator('#error').isVisible(), true);
    await page.unroute('**/api/turns');

    let attempts = 0;
    await page.route('**/api/turns', (route) => { attempts++; return route.abort(); });
    await page.getByRole('button', { name: '메시지 보내기' }).click();
    await page.waitForFunction(() => document.querySelector('#turn-status').textContent === '응답 미확인');
    assert.equal(attempts, 1);
    assert.match(await page.locator('#error').textContent(), /자동 재전송하지 않았습니다/);
    await page.unroute('**/api/turns');

    await page.reload();
    await page.waitForFunction(() => document.querySelector('#connection-status').dataset.ready === 'true');
    assert.equal(await page.locator('.turn').count(), 0);
    assert.equal(await page.locator('#empty-state').isVisible(), true);
    await page.route('**/health', (route) => route.abort());
    await page.getByRole('button', { name: '연결 다시 확인' }).click();
    await page.waitForFunction(() => document.querySelector('#turn-status').textContent === '연결 오류');
    assert.equal(await page.locator('#send').isDisabled(), true);
    await page.unroute('**/health');
    await page.getByRole('button', { name: '연결 다시 확인' }).click();
    await page.waitForFunction(() => document.querySelector('#connection-status').dataset.ready === 'true');
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    await page.close();
  }
});
