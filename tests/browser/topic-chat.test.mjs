import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { workspace, ownerKey, topic, until } from '../workspace-helpers.mjs';

async function setup(t, residentEnabled = true) {
  const f = await workspace(t, { residentEnabled }, { residentAutoSchedule: false }); f.app.engine.kick = () => {}; let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('Browsing a topic must not dispatch'); };
  const ids = [];
  for (let index = 0; index < 5; index++) {
    const id = f.app.engine.create({ ...topic, topic: '주제 ' + index }, 'archive-' + index); ids.push(id);
    f.app.store.transact(s => {
      const d = s.discussions.find(d => d.id === id); d.status = index === 1 ? 'partial' : index === 2 ? 'cancelled' : 'completed'; d.phase = 'summary_review';
      d.tasks.forEach(task => { task.status = 'completed'; });
      d.turns = d.tasks.map((task, i) => { const text = `BODY-${index}-${i} <img src=x onerror="window.injected=true"> ` + (index === 0 && i === 0 ? '긴 발언의 근거와 반론을 보존합니다.\n'.repeat(3000) : '서로 독립적으로 검토한 발언');
        return { id: 'archive-turn-' + index + '-' + i, taskId: task.id, participantId: task.participantId, revision: 1, generation: 1, phase: 'independent', round: 1, status: 'completed', prompt: 'fixture-only', promptDigest: 'fixture-only', text, reply: { text, claims: [], reviews: [], verifications: [], uncertainty: ['실제 검증 미실행'] }, receipt: 'fixture-only', usage: null, error: null, evidenceIds: [], startedAt: d.createdAt, finishedAt: d.updatedAt }; });
      if (index >= 3 && s.resident) { d.roomId = s.resident.rooms[0].id; s.resident.rooms[0].legacyDiscussionIds.push(d.id); }
    });
  }
  f.app.store.transact(s => {
    s.connections = [
      { id: 'web', kind: 'openai-oauth', label: 'GPT 개인', status: 'connected', models: [{ id: 'gpt-fixture', label: 'GPT' }] },
      { id: 'device', kind: 'codex-oauth', label: 'GPT 기기', status: 'connected', models: [{ id: 'gpt-fixture', label: 'GPT' }] },
      { id: 'coral', kind: 'deepseek', label: 'CoralBricks', apiService: 'coralbricks', status: 'connected', models: [{ id: 'deepseek-fixture', label: 'DeepSeek' }] },
      { id: 'browser', kind: 'browser', label: 'Muse', status: 'error', error: 'browser_identity_mismatch', models: [{ id: 'existing-chat', label: '기존 대화' }] },
      { id: 'river', kind: 'deepseek', label: 'River', apiService: 'river', status: 'connected', models: [{ id: 'river-fixture', label: 'DeepSeek' }] },
    ];
    s.participants = s.connections.slice(0, 4).map(c => ({ id: 'member-' + c.id, label: c.label, kind: c.kind, connectionId: c.id, modelId: c.models[0].id, role: '검토' }));
    if (s.resident) s.resident.rooms[0].members = s.participants.map(p => ({ participantId: p.id, enabled: false }));
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(), errors = [], posts = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.goto(f.url); await page.locator('#chat-free').waitFor(); return { ...f, ids, browser, context, page, errors, posts, calls: () => calls };
}
async function choose(page, index) { await page.locator('#history').getByRole('button', { name: '주제 ' + index, exact: true }).click(); await page.waitForFunction(i => document.querySelector('#topic-chat-title').textContent === '주제 ' + i && document.querySelector('#topic-chat-messages').textContent.includes('BODY-' + i), index); }
async function navigation(page) { if (await page.locator('#room-member-toggle').isVisible()) await page.locator('#room-member-toggle').click(); }

test('all five standalone/linked topics share one chat shell; twenty switches are read-only and connection-only AI stays visible', { timeout: 60000 }, async t => {
  const f = await setup(t); const { page } = f; const before = JSON.stringify(f.app.store.read().discussions);
  assert.equal(await page.locator('[data-view=discussion]').count(), 0); assert.equal(await page.locator('#history button').count(), 5); assert.equal(await page.locator('#room-members > article').count(), 5);
  assert.equal(await page.locator('#room-members [data-participant-id^=fake]').count(), 0); assert.match(await page.locator('#room-members [data-connection-id=river]').textContent(), /토커 등록 필요/); assert.match(await page.locator('#room-members [data-participant-id=member-browser]').textContent(), /연결 확인 필요/);
  for (let i = 0; i < 20; i++) { const index = i % 5; await choose(page, index); const text = await page.locator('#topic-chat-messages').textContent(); for (let j = 0; j < 5; j++) if (j !== index) assert.equal(text.includes('BODY-' + j), false); assert.equal(await page.locator('#view-room').isVisible(), true); assert.equal(await page.locator('#topic-details-dialog').isVisible(), false); }
  assert.equal(JSON.stringify(f.app.store.read().discussions), before); assert.equal(f.calls(), 0); assert.deepEqual(f.posts, []); assert.equal(await page.evaluate(() => window.injected), undefined); assert.equal(await page.locator('#topic-chat img').count(), 0);
  await page.locator('#room-members [data-connection-id=river] button').click(); await page.locator('#participant-form').waitFor(); assert.equal(await page.locator('#participant-connection').inputValue(), 'river'); assert.equal(await page.locator('#participant-model').inputValue(), ''); assert.equal(f.app.store.read().participants.length, 4); assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []);
});

test('topic chat preserves long text, independent reading positions/expansion, original authors and details at four widths', { timeout: 60000 }, async t => {
  const f = await setup(t); const { page } = f; await mkdir('test-results/topic-chat', { recursive: true });
  f.app.store.transact((s, emit) => { const room = s.resident.rooms[0]; for (let i = 0; i < 30; i++) s.resident.messages.push({ id: 'free-' + i, roomId: room.id, sequence: ++room.lastMessageSequence, sourceKind: 'user', sourceId: null, authorId: 'owner', text: 'FREE ' + i + ' 자유 대화의 읽기 위치를 보존합니다.', replyTo: null, mentions: [], visibility: 'room_public', createdAt: new Date().toISOString() }); emit({ type: 'fixture.free_history', discussionId: null, data: {} }); });
  await page.waitForFunction(() => document.querySelectorAll('.room-message').length === 30); await page.locator('#room-timeline').evaluate(n => { n.scrollTop = 200; }); await page.waitForTimeout(180);
  const freePosition = await page.locator('#room-timeline').evaluate(n => n.scrollTop); await choose(page, 0);
  const row = page.locator('[data-turn-id=archive-turn-0-0]'); await row.getByRole('button', { name: /전체 발언 펼치기/ }).click(); assert.ok((await row.locator('.message-text').textContent()).length > 60000); assert.equal(await page.locator('#history button').count(), 5);
  await page.locator('#topic-chat-timeline').evaluate(n => { n.scrollTop = 123; }); await until(async () => JSON.parse(await page.evaluate(id => localStorage.getItem('wj.chat.' + id + '.position'), f.ids[0]))?.top === 123);
  await choose(page, 1); await page.reload(); await page.locator('#topic-chat-title').filter({ hasText: '주제 1' }).waitFor(); await choose(page, 0);
  await page.waitForFunction(() => document.querySelector('#topic-chat-timeline').scrollTop === 123); assert.ok((await row.locator('.message-text').textContent()).length > 60000);
  assert.match(await page.locator('#topic-speakers').textContent(), /모의 참여자 A/); assert.doesNotMatch(await page.locator('#room-members').textContent(), /모의 참여자/);
  await page.locator('#chat-free').click(); await page.waitForFunction(top => Math.abs(document.querySelector('#room-timeline').scrollTop - top) < 2, freePosition); await choose(page, 0);
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await page.locator('#topic-chat-title').isVisible(), true);
    await navigation(page); await choose(page, 3); await page.locator('#topic-details-open').click(); await page.getByRole('button', { name: '주장과 근거', exact: true }).click(); await page.locator('#discussion-content').waitFor(); await page.screenshot({ path: 'test-results/topic-chat/details-' + width + '.png' }); await page.locator('#topic-details-close').click();
    await navigation(page); await choose(page, 0); await page.screenshot({ path: 'test-results/topic-chat/chat-' + width + '.png' });
  }
  assert.equal(f.calls(), 0); assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []);
});

test('feature off defaults to the same topic chat without assigning archived topics to a room or enabling execution', { timeout: 30000 }, async t => {
  const f = await setup(t, false); await choose(f.page, 2); assert.equal(await f.page.locator('#topic-opinion').isVisible(), false); assert.equal(f.app.store.read().resident, undefined); await f.page.reload(); await f.page.locator('#topic-chat-title').filter({ hasText: '주제 2' }).waitFor();
  await f.page.locator('#chat-free').click(); await f.page.locator('#room-text').waitFor(); assert.equal(await f.page.locator('#room-send').isDisabled(), true); assert.equal(f.calls(), 0); assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []);
});

test('half-finished replies stay private; an explicit inline opinion changes only its topic once and preserves the earlier public round', { timeout: 30000 }, async t => {
  const f = await setup(t); const { page } = f;
  f.app.store.transact((s, emit) => { const d = s.discussions[0]; d.status = 'paused'; d.tasks[1].status = 'unconfirmed'; d.turns[1].status = 'unconfirmed'; d.turns[1].text = 'UNPUBLISHED-PARTIAL'; d.turns[1].reply = null; emit({ type: 'discussion.phase', discussionId: d.id, data: {} }); });
  await page.locator('#history').getByRole('button', { name: '주제 0', exact: true }).click(); await page.locator('#topic-chat-title').filter({ hasText: '주제 0' }).waitFor(); assert.doesNotMatch(await page.locator('#topic-chat-messages').textContent(), /BODY-0|UNPUBLISHED/);
  f.app.store.transact((s, emit) => { s.discussions[0].status = 'partial'; s.discussions[0].tasks[1].status = 'cancelled'; s.discussions[0].turns[1].status = 'failed'; const d = s.discussions[1]; d.status = 'paused'; emit({ type: 'discussion.phase', discussionId: d.id, data: {} }); });
  await choose(page, 1); const originals = JSON.stringify(f.app.store.read().discussions.filter(d => d.id !== f.ids[1]));
  await page.locator('#topic-opinion-text').fill('근거와 남은 이견을 더 분석해 주세요.'); await page.locator('#topic-opinion-text').press('Enter'); assert.equal(f.posts.length, 0);
  await page.locator('#topic-opinion').click(); await until(() => f.app.store.read().discussions[1].revision === 2); await page.waitForFunction(() => document.querySelector('#topic-opinion-text').value === '');
  const after = f.app.store.read(); assert.equal(after.discussions[1].interventions.length, 1); assert.equal(after.discussions[1].interventions[0].text.trim(), '근거와 남은 이견을 더 분석해 주세요.'); assert.equal(JSON.stringify(after.discussions.filter(d => d.id !== f.ids[1])), originals); assert.equal(f.posts.length, 1);
  await page.locator('.topic-archive > summary').click(); assert.match(await page.locator('.topic-archive').textContent(), /BODY-1/); assert.equal(f.calls(), 0); assert.deepEqual(f.errors, []);
});

test('late topic responses cannot replace a new selection, and two tabs keep separate selected topics across reload', { timeout: 30000 }, async t => {
  const f = await setup(t); const { page } = f; let release, arrived; const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { arrived = resolve; }); t.after(release);
  await choose(page, 2);
  await page.route('**/api/discussions/' + f.ids[0], async route => { const response = await route.fetch(); arrived(); await held; await route.fulfill({ response }); });
  await page.locator('#history').getByRole('button', { name: '주제 0', exact: true }).click(); await started;
  assert.equal(await page.locator('#topic-details-open').isDisabled(), true); assert.doesNotMatch(await page.locator('#topic-chat-messages').textContent(), /BODY-2/);
  await page.locator('#history').getByRole('button', { name: '주제 1', exact: true }).click(); release(); await page.waitForFunction(() => document.querySelector('#topic-chat-title').textContent === '주제 1');
  assert.doesNotMatch(await page.locator('#topic-chat-messages').textContent(), /BODY-0/);
  const other = await f.context.newPage(); other.on('pageerror', e => f.errors.push(e.message)); await other.goto(f.url); await choose(other, 2); await choose(page, 3);
  await page.reload(); await other.reload(); await page.locator('#topic-chat-title').filter({ hasText: '주제 3' }).waitFor(); await other.locator('#topic-chat-title').filter({ hasText: '주제 2' }).waitFor();
  assert.equal(f.calls(), 0); assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []);
});
