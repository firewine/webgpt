import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium as localChromium } from 'playwright';
import { wikiFixture } from '../wiki-fixture.mjs';
import { ownerKey, topic } from '../workspace-helpers.mjs';

async function prepare(t) {
  let calls = 0;
  const complete = async () => { calls++; throw new Error('Reading a topic Wiki must not dispatch'); };
  const f = await wikiFixture(t, { on: false, provider: { complete } });
  f.app.providers.complete = complete; f.app.engine.kick = () => {};
  return { ...f, calls: () => calls };
}
function publication(f, overrides = {}) {
  return { revision: 1, roomEpoch: f.room().epoch, scopeDigest: 'fixture-topic-scope', status: 'pending', reason: null,
    pageId: null, version: null, digest: null, inputDigest: null, ...overrides };
}
function seed(f, title, record, roomId = f.roomId) {
  const id = f.app.engine.create({ ...topic, topic: title }, crypto.randomUUID());
  f.app.store.transact(s => {
    const d = s.discussions.find(d => d.id === id); d.roomId = roomId; d.status = 'completed'; d.phase = 'summary_review';
    d.tasks.forEach(task => { task.status = 'completed'; });
    if (record) d.wikiPublication = record;
    s.resident.rooms.find(r => r.id === f.roomId).legacyDiscussionIds.push(id);
  });
  return id;
}
async function open(t, f) {
  const browser = await localChromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } }); assert.equal(login.ok(), true);
  const page = await context.newPage(); const errors = [], writes = [], external = [], reads = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + r.url());
    if (!r.url().startsWith(f.url + '/')) external.push(r.url());
    else if (r.method() === 'GET') reads.push(new URL(r.url()).pathname + new URL(r.url()).search);
  });
  await context.route('**/*', route => route.request().url().startsWith(f.url + '/') ? route.continue() : route.abort());
  const state = JSON.stringify(f.app.store.read()); const cursor = f.app.store.cursor();
  await page.goto(f.url); await page.locator('#wiki-new').waitFor();
  return { page, reads, unchanged: (expectedState = state, expectedCursor = cursor) => {
    assert.equal(JSON.stringify(f.app.store.read()), expectedState); assert.equal(f.app.store.cursor(), expectedCursor);
    assert.equal(f.calls(), 0); assert.deepEqual(writes, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  } };
}
async function navigation(page) { if (await page.locator('#room-member-toggle').isVisible()) await page.locator('#room-member-toggle').click(); }
async function choose(page, title) {
  await navigation(page); await page.locator('#history').getByRole('button', { name: title, exact: true }).click();
  await page.waitForFunction(title => document.querySelector('#topic-chat-title').textContent === title && document.querySelector('#room-focus').textContent.includes(title), title);
}
async function free(page) { await navigation(page); await page.locator('#chat-free').click(); await page.locator('#room-topic').waitFor(); }
async function board(page) {
  if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click();
  await page.locator('#board-tab-workspace').click();
}
async function fits(page, selector) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator(selector).evaluate(n => { const r = n.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && n.scrollWidth <= n.clientWidth; }), true);
}

test('topic Wiki links open the recorded immutable version from pin, results and selected-topic info; refresh and 390px remain read-only', { timeout: 60000 }, async t => {
  const f = await prepare(t);
  const saved = f.w.edit(f.roomId, f.edit({ body: '기록된 주제 결론 v1' }), crypto.randomUUID());
  f.w.edit(f.roomId, f.edit({ pageId: saved.pageId, expectedVersion: 1, body: '이후 편집된 최신 내용 v2' }), crypto.randomUUID());
  const record = publication(f, { status: 'published', pageId: saved.pageId, version: 1, digest: saved.digest, inputDigest: 'fixture-input-digest' });
  const title = '공개 결론을 같은 방에 보존하는 주제'; const id = seed(f, title, record);
  const { page, reads, unchanged } = await open(t, f);
  const original = async () => {
    await page.locator('#wiki-detail .wiki-body').getByText('기록된 주제 결론 v1', { exact: true }).waitFor();
    assert.equal(await page.locator('#wiki-detail').getAttribute('data-version'), '1');
    assert.equal(await page.locator('#wiki-detail').getAttribute('data-page-id'), saved.pageId);
    assert.doesNotMatch(await page.locator('#wiki-detail .wiki-body').textContent(), /최신 내용 v2/);
    await page.keyboard.press('Escape');
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await free(page);
    await page.locator('#room-topic-wiki .topic-wiki[data-status=published]').waitFor();
    assert.match(await page.locator('#room-topic-wiki').textContent(), /자동 Wiki · 게시됨/); await fits(page, '#room-topic-wiki');
    assert.equal(await page.locator('#room-text').isVisible(), true);
    await page.locator('#room-topic-wiki').getByRole('button', { name: '게시된 Wiki v1 보기', exact: true }).click(); await original();
    await page.locator('#room-topic-result').click();
    await page.locator('#room-result-content .topic-wiki').getByRole('button', { name: '게시된 Wiki v1 보기', exact: true }).click(); await original();
    await choose(page, title); await board(page); await fits(page, '#room-focus .topic-wiki');
    await page.locator('#room-focus .topic-wiki').getByRole('button', { name: '게시된 Wiki v1 보기', exact: true }).click(); await original();
    await page.reload(); await page.locator('#topic-chat-title').getByText(title, { exact: true }).waitFor(); await board(page);
    await page.locator('#room-focus .topic-wiki').getByRole('button', { name: '게시된 Wiki v1 보기', exact: true }).click(); await original();
  }
  assert.equal(reads.filter(p => p === `/api/rooms/${f.roomId}/wiki/${saved.pageId}?version=1`).length, 8);
  assert.equal(reads.some(p => p === `/api/rooms/${f.roomId}/wiki/${saved.pageId}`), false);
  assert.deepEqual(f.app.store.read().discussions.find(d => d.id === id).wikiPublication, record); unchanged();
});

test('pending waits for a conclusion; blocked and skipped reasons preserve the topic without claiming publication or offering a link', { timeout: 60000 }, async t => {
  const f = await prepare(t);
  const cases = [
    ['pending', null, /결론 대기 중/],
    ['blocked', 'topic_wiki_scope_changed', /방이나 주제 조건이 바뀌었습니다/],
    ['blocked', 'topic_wiki_sources_required', /공개된 결론의 출처가 필요합니다/],
    ['blocked', 'topic_wiki_sources_limit', /출처 수가 저장 한도를 넘었습니다/],
    ['blocked', 'topic_wiki_body_limit', /결론 길이가 저장 한도를 넘었습니다/],
    ['blocked', 'wiki_context_requires_selection', /참고할 Wiki 버전을 선택해야 합니다/],
    ['blocked', 'wiki_version_conflict', /Wiki 버전이 바뀌어 충돌했습니다/],
    ['skipped', 'topic_wiki_cancelled', /토론이 취소되었습니다/],
    ['skipped', 'topic_wiki_no_public_result', /공개가 확정된 결론이 없습니다/],
    ['blocked', '<img src=x onerror="window.topicWikiExecuted=true">', /게시 사유를 확인해 주세요/],
  ];
  for (const [index, [status, reason]] of cases.entries()) seed(f, '자동 게시 상태 ' + index, publication(f, { status, reason, pageId: 'not-published', version: 1 }));
  const { page, reads, unchanged } = await open(t, f);
  for (const [index, [status, reason, expected]] of cases.entries()) {
    const title = '자동 게시 상태 ' + index; await choose(page, title);
    const row = page.locator('#room-focus .topic-wiki'); await row.waitFor();
    assert.equal(await row.getAttribute('data-status'), status); const text = await row.textContent();
    assert.match(text, expected); assert.doesNotMatch(text, /게시됨/); assert.equal(await row.locator('button,a,img,script').count(), 0);
    if (reason) { assert.match(text, /원래 주제와 결과는 보존됩니다/); assert.equal(text.includes(reason), false); }
    assert.equal(await page.locator('#topic-chat-title').textContent(), title);
  }
  await free(page); await page.locator('#room-topic-result').click();
  assert.match(await page.locator('#room-result-content .topic-wiki').textContent(), /게시 보류.*원래 주제와 결과는 보존됩니다/);
  assert.equal(await page.locator('#room-result-content .topic-wiki button').count(), 0); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 }); await fits(page, '#room-topic-wiki');
  await page.reload(); await page.locator('#room-topic-wiki .topic-wiki[data-status=blocked]').waitFor(); await fits(page, '#room-topic-wiki');
  assert.equal(await page.evaluate(() => window.topicWikiExecuted), undefined);
  assert.equal(reads.some(p => p.includes('/wiki/not-published')), false); unchanged();
});

test('legacy and independent topics have no automatic status; foreign-room metadata cannot leak into the pin or selected-topic panel', { timeout: 45000 }, async t => {
  const f = await prepare(t);
  const record = publication(f, { status: 'published', pageId: 'foreign-page', version: 9 });
  seed(f, '이전 방 주제', null); seed(f, '독립 주제', null, null);
  seed(f, '방 없는 잘못된 게시 기록', record, null); seed(f, '다른 방 주제', record, 'foreign-room');
  const { page, reads, unchanged } = await open(t, f);
  assert.equal(await page.locator('#room-topic-wiki .topic-wiki').count(), 0);
  assert.doesNotMatch(await page.locator('#room-topic').textContent(), /다른 방 주제|게시됨|Wiki v9/);
  for (const title of ['이전 방 주제', '독립 주제', '방 없는 잘못된 게시 기록', '다른 방 주제']) {
    await choose(page, title); assert.equal(await page.locator('#room-focus .topic-wiki').count(), 0);
    assert.doesNotMatch(await page.locator('#room-focus').textContent(), /자동 Wiki|게시됨|Wiki v9/);
  }
  await page.reload(); await page.locator('#topic-chat-title').getByText('다른 방 주제', { exact: true }).waitFor();
  assert.equal(await page.locator('#room-focus .topic-wiki').count(), 0);
  assert.equal(reads.some(p => p.includes('/wiki/foreign-page')), false); unchanged();
});

test('a publication update refreshes the same selected topic and its pin through the existing event stream', { timeout: 30000 }, async t => {
  const f = await prepare(t);
  const saved = f.w.edit(f.roomId, f.edit({ body: '결론 뒤에 저장된 Wiki 원문' }), crypto.randomUUID());
  const title = '결론을 기다리는 선택 주제'; const id = seed(f, title, publication(f));
  const { page, unchanged } = await open(t, f); await choose(page, title);
  await page.locator('#room-focus .topic-wiki[data-status=pending]').waitFor(); unchanged();
  f.app.store.transact((s, emit) => {
    const d = s.discussions.find(d => d.id === id);
    d.wikiPublication = { ...d.wikiPublication, status: 'published', pageId: saved.pageId, version: 1, digest: saved.digest, inputDigest: 'fixture-input' };
    d.updatedAt = new Date(Date.parse(d.updatedAt) + 1000).toISOString();
    emit({ type: 'fixture.topic_wiki_published', discussionId: id, data: {} });
  });
  const state = JSON.stringify(f.app.store.read()); const cursor = f.app.store.cursor();
  await page.locator('#room-focus .topic-wiki[data-status=published]').waitFor();
  await page.locator('#room-focus .topic-wiki button').click();
  await page.locator('#wiki-detail .wiki-body').getByText('결론 뒤에 저장된 Wiki 원문', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  await free(page); await page.locator('#room-topic-wiki .topic-wiki[data-status=published]').waitFor(); unchanged(state, cursor);
});
