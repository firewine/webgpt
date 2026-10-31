import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { wikiFixture } from '../wiki-fixture.mjs';
import { ownerKey, until } from '../workspace-helpers.mjs';
const output = 'test-results/resident/R7';
async function open(t, f) {
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(f.url); await page.locator('#wiki-new').waitFor(); return { page, errors };
}
async function board(page) { if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator('#board-tab-workspace').click(); }
async function details(page, pageId) { await board(page); await page.locator(`#wiki-items [data-page-id="${pageId}"]`).getByRole('button').click(); await page.locator('#wiki-detail .wiki-body').waitFor(); }
const key = () => crypto.randomUUID();

test('R7 browser: owner creates a sourced Wiki, pins exact version, retains old citations and accesses history on four viewports', { timeout: 60000 }, async t => {
  const f = await wikiFixture(t); const { page, errors } = await open(t, f); await page.locator('#wiki-new').click(); const form = page.locator('#wiki-form');
  await form.locator('[name=slug]').fill('shared-memory'); await form.locator('[name=title]').fill('함께 검토한 목표와 근거'); await form.locator('[name=body]').fill('확인한 원문과 남은 반론을 함께 기억합니다.'); await form.locator('[name=sourceRef]').first().check();
  await form.getByRole('button', { name: 'Wiki 버전 저장', exact: true }).click(); await page.locator('#wiki-detail .wiki-body').waitFor(); const p = f.app.store.read().resident.wikiPages[0];
  await page.getByRole('button', { name: '이 버전을 대화에 고정', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wiki-detail-state').textContent.includes('고정했습니다'));
  f.w.edit(f.roomId, f.edit({ pageId: p.id, expectedVersion: 1, title: p.title, body: '그 뒤 수정된 내용입니다.' }), key());
  assert.equal(f.room().wikiPins[0].version, 1); await page.keyboard.press('Escape'); await f.step(); await f.step(); await page.waitForFunction(() => document.querySelectorAll('.room-message button').length > 5);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await details(page, p.id);
    await page.getByRole('button', { name: 'v1 · 함께 검토한 목표와 근거', exact: true }).click(); await page.locator('#wiki-detail .wiki-body').getByText('확인한 원문과 남은 반론을 함께 기억합니다.', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/wiki-${width}.png` }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.keyboard.press('Escape');
    await board(page); await page.locator('#wiki-board').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/board-${width}.png` });
    const drawer = page.locator('#room-panel-dialog[open]'); if (await drawer.count()) await drawer.getByRole('button', { name: '닫기', exact: true }).click();
  }
  await page.locator('.room-message button').filter({ hasText: /^Wiki 인용 v1$/ }).first().click(); await page.locator('#wiki-detail .wiki-body').getByText('확인한 원문과 남은 반론을 함께 기억합니다.', { exact: true }).waitFor();
  const before = f.app.store.cursor(); await page.reload(); await board(page); await page.locator('#wiki-items .work-card').waitFor(); assert.equal(f.app.store.cursor(), before); assert.deepEqual(errors, []);
});

test('R7 browser: concurrent AI edit preserves stale owner form and conflict, explicit correction uses new head without losing old versions', { timeout: 45000 }, async t => {
  const f = await wikiFixture(t); const p = f.w.edit(f.roomId, f.edit(), key()); const { page, errors } = await open(t, f); await details(page, p.pageId); await page.getByRole('button', { name: '이 기록으로 편집', exact: true }).click();
  const form = page.locator('#wiki-form'); await form.locator('[name=body]').fill('사용자가 동시에 작성한 보존할 초안');
  const refreshed = page.waitForResponse(r => r.url().includes('/wiki?after=')); f.w.edit(f.roomId, f.edit({ pageId: p.pageId, expectedVersion: 1, body: '참여자가 먼저 저장한 v2' }), key(), f.actor()); await refreshed;
  assert.equal(await form.locator('[name=expectedVersion]').inputValue(), '1'); await form.getByRole('button', { name: 'Wiki 버전 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('충돌 제안'));
  assert.equal(await form.locator('[name=body]').inputValue(), '사용자가 동시에 작성한 보존할 초안'); assert.equal(await page.locator('#wiki-form-dialog').evaluate(d => d.open), true);
  assert.equal(f.w.get(f.roomId, p.pageId).page.headVersion, 2); assert.equal(f.app.store.read().resident.wikiVersions.filter(v => v.status === 'conflict').length, 1);
  await page.keyboard.press('Escape'); await details(page, p.pageId); await page.getByRole('button', { name: /^충돌 ·/ }).click(); await page.locator('#wiki-detail .wiki-body').getByText('사용자가 동시에 작성한 보존할 초안', { exact: true }).waitFor();
  await page.getByRole('button', { name: '현재 버전을 기준으로 조정', exact: true }).click(); assert.equal(await form.locator('[name=expectedVersion]').inputValue(), '2'); await form.locator('[name=body]').fill('서로의 원문과 반론을 합쳐 수정한 내용'); await form.getByRole('button', { name: 'Wiki 버전 저장', exact: true }).click();
  await page.locator('#wiki-detail .wiki-body').getByText('서로의 원문과 반론을 합쳐 수정한 내용', { exact: true }).waitFor(); assert.equal(f.w.get(f.roomId, p.pageId).page.headVersion, 3); assert.equal(f.app.store.read().resident.wikiVersions.length, 4); assert.deepEqual(errors, []);
});

test('R7-F browser: HTML/script/javascript text and protected URL source render inertly with no code, fetch or authority change', { timeout: 45000 }, async t => {
  const f = await wikiFixture(t); const malicious = '<script>window.wikiExecuted=1</script><img src="http://127.0.0.1:9/private" onerror="window.wikiExecuted=2"><a href="javascript:window.wikiExecuted=3">run</a>\nhttp://169.254.169.254/private';
  const p = f.w.edit(f.roomId, f.edit({ body: malicious }), key()); const { page, errors } = await open(t, f); const requests = []; page.on('request', r => { if (!r.url().startsWith(f.url)) requests.push(r.url()); });
  await details(page, p.pageId); assert.equal(await page.locator('.wiki-body').textContent(), malicious); assert.equal(await page.locator('.wiki-body script,.wiki-body img,.wiki-body a').count(), 0); assert.equal(await page.evaluate(() => window.wikiExecuted ?? null), null);
  const bad = await f.api(`/api/rooms/${f.roomId}/wiki`, f.edit({ slug: 'protected-source', sourceRefs: [{ kind: 'url', id: 'http://127.0.0.1/private' }] })); assert.equal(bad.status, 400); assert.equal(f.app.store.read().resident.wikiVersions.length, 1); assert.deepEqual(requests, []); assert.equal(f.app.store.read().jobs.length, 0); assert.deepEqual(errors, []);
});

test('R7 browser: explicit resident grant has selected tools/expiry, token only once, revoke invalidates it without changing legacy grants', { timeout: 45000 }, async t => {
  const f = await wikiFixture(t); const { page, errors } = await open(t, f); await page.locator('#wiki-grants').click(); const form = page.locator('#resident-grant-form');
  assert.equal(await form.locator('[name=tool]:checked').count(), 0); assert.equal(await form.locator('[name=expiresAt]').inputValue(), '');
  await form.locator('[name=tool][value=resident_wiki_get]').check(); await form.locator('[name=expiresAt]').fill(new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)); await form.getByRole('button', { name: '선택 범위 접근 키 발급', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#resident-grant-token').textContent.includes('Authorization: Bearer')); const text = await page.locator('#resident-grant-token').textContent(); const token = text.match(/Bearer (\S+)/)[1];
  const raw = JSON.stringify(f.app.store.read()); assert.ok(!raw.includes(token)); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#resident-grant-dialog').open && document.querySelector('#resident-grant-token').textContent === '');
  await page.locator('#wiki-grants').click(); await page.getByRole('button', { name: '이 접근 권한 폐기', exact: true }).click(); await until(() => f.app.store.read().resident.residentGrants[0].revoked);
  assert.equal((await f.call({ token }, 'resident_wiki_get', { pageId: 'anything' })).status, 401); assert.equal(f.app.store.read().grants.length, 0); assert.deepEqual(errors, []);
});
