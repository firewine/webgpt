import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { workspace, ownerKey, until, topic } from '../workspace-helpers.mjs';
import { reply, budget, pacing } from '../resident-fixture.mjs';
import { digest } from '../../dist/server/workspace/util.js';

async function launch(t) { const b = await chromium.launch({ headless: true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WJ_TEST_CHROMIUM_EXECUTABLE } : {}) }); t.after(() => b.close()); return b; }
async function open(browser, f, viewport = { width: 1440, height: 1000 }, memberCount = 2) {
  const context = await browser.newContext({ viewport }); await context.request.post(f.url + '/api/login', { data: { token: ownerKey }, headers: { Origin: f.url } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(f.url); await page.locator('#room-title').waitFor(); await page.waitForFunction(count => !!document.querySelector('#room-power').textContent && document.querySelector('#room-members').children.length === count, memberCount);
  return { context, page, errors };
}
function seed(f, texts, options = {}) {
  const eventsBefore = f.app.store.cursor(); const ids = [];
  f.app.store.transact((s, emit) => {
    const room = s.resident.rooms[0];
    for (const text of texts) { const id = 'fixture-msg-' + crypto.randomUUID(); ids.push(id);
      const m = { id, roomId: room.id, sequence: ++room.lastMessageSequence, sourceKind: 'room', sourceId: null, authorId: 'fake-a', text, replyTo: null, mentions: [], visibility: 'room_public', createdAt: new Date().toISOString(), ...options };
      s.resident.messages.push(m); emit({ type: 'resident.message_created', discussionId: null, data: { roomId: room.id, messageId: id, sequence: m.sequence } });
    }
  }); return { ids, events: f.app.store.events(eventsBefore) };
}
async function panel(page, tab = 'workspace') { if (!await page.locator('#room-panel').isVisible()) await page.locator('#room-panel-toggle').click(); await page.locator(`[data-board-tab=${tab}]`).click(); }
async function members(page) { if (await page.locator('#room-member-toggle').isVisible()) await page.locator('#room-member-toggle').click(); }
async function closeDrawer(page) { const d = page.locator('.room-drawer[open]'); if (await d.count()) await d.getByRole('button', { name: '닫기', exact: true }).click(); }

test('R3-A/D: four viewports expose room, participant toggles, reference board, approval and legacy recovery', { timeout: 90000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('no UI read dispatch'); };
  const did = f.app.engine.create(topic, 'ui-paused-topic'); f.app.engine.control(did, { action: 'pause', expectedRevision: 1 }, 'ui-pause');
  f.app.store.transact(s => { s.resident.rooms[0].legacyDiscussionIds.push(did); s.jobs.push({ id: 'approval-fixture', bindingId: 'fixture', discussionId: did, taskId: null, revision: 1, requestId: 'request-fixture', prompt: 'Fixture command', promptDigest: 'fixture', status: 'blocked_approval', threadId: 'thread-fixture', turnId: 'turn-fixture', createdAt: new Date().toISOString(), finishedAt: null, maxDurationMs: 60000, deadlineAt: null, text: '', error: null, activities: [], approvals: [{ id: 'approval-1', rpcId: 1, method: 'item/commandExecution/requestApproval', params: { command: 'fixture only' }, status: 'pending' }] }); });
  seed(f, ['개인 작업실의 운영 방법을 같이 이야기해요.', '동의와 검증은 구분하고, 아직 실행하지 않은 일은 기록해 둡시다.']);
  const browser = await launch(t); t.diagnostic('Actual Chrome: ' + browser.version()); await mkdir('test-results/resident/R3', { recursive: true });
  for (const width of [390, 768, 1024, 1440]) {
    const { context, page, errors } = await open(browser, f, { width, height: width === 390 ? 844 : 1000 });
    assert.equal(await page.locator('#view-room').isVisible(), true); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#room-text').isVisible(), true); assert.equal(await page.locator('#room-mention-add').isVisible(), true);
    await members(page); await page.getByRole('checkbox', { name: '모의 참여자 A 발언 참여' }).setChecked(width !== 768);
    await until(() => f.app.store.read().resident.rooms[0].members[0].enabled === (width !== 768)); await closeDrawer(page);
    await panel(page, 'usage'); assert.equal(await page.locator('#room-usage').isVisible(), true); await page.locator('[data-board-tab=activity]').click();
    await page.locator('#room-jobs button').click(); await page.getByRole('button', { name: '이번 요청 승인', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '거절', exact: true }).isVisible(), true);
    await page.locator('#history button').first().click(); await page.getByRole('button', { name: '원본과 복구', exact: true }).click(); assert.match(await page.locator('#discussion-content').textContent(), /체크포인트 적용/);
    await page.locator('[data-view=connections]').click(); assert.equal(await page.locator('#oauth-form').isVisible(), true); assert.equal(await page.locator('#deepseek-form').isVisible(), true); await page.getByText('dot·Muse의 기존 대화 연결', { exact: true }).click(); await page.getByText('고급 연결 · 선택자 직접 입력', { exact: true }).click(); assert.equal(await page.locator('#browser-form').isVisible(), true);
    await page.locator('[data-view=room]').click(); await page.locator('#room-panel').evaluate(n => { n.scrollTop = 0; }); await page.screenshot({ path: `test-results/resident/R3/room-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); await context.close();
  }
  assert.equal(calls, 0);
});

test('R3-B/E: 90k original, quote, explicit mention, IME, keyboard actions and view state survive reload', { timeout: 90000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false });
  const long = ('긴 원문과 반론을 보존합니다. <img src=x onerror=alert(1)>\n').repeat(2100).slice(0, 90000); assert.equal(long.length, 90000);
  const { ids } = seed(f, [long]); const browser = await launch(t); const { page, errors } = await open(browser, f);
  const row = page.locator(`[data-message-id="${ids[0]}"]`); const text = row.locator('.message-text');
  assert.equal((await text.textContent()).length, 500); assert.equal(await text.getAttribute('data-digest'), digest(long));
  await row.getByRole('button', { name: /펼치기/ }).click(); await page.waitForFunction(() => document.querySelector('.message-text').textContent.length === 90000); assert.equal(await text.textContent(), long); assert.equal(await text.locator('img').count(), 0);
  await row.getByRole('button', { name: '접기', exact: true }).click(); assert.equal((await text.textContent()).length, 500);
  await row.getByRole('button', { name: '답장', exact: true }).focus(); await page.keyboard.press('Enter'); await page.locator('#room-mention-select').selectOption('fake-b'); await page.locator('#room-mention-add').click();
  await page.locator('#room-text').fill('각자 이 긴 원문을 다시 분석해 주세요.');
  await page.locator('#room-text').dispatchEvent('compositionstart'); await page.locator('#room-text').dispatchEvent('keydown', { key: 'Enter', isComposing: true }); await page.locator('#room-text').dispatchEvent('keydown', { key: 'Enter' });
  await delay(50); assert.equal(f.app.store.read().resident.messages.length, 1);
  await page.locator('#room-text').dispatchEvent('compositionend'); await page.locator('#room-text').press('Enter');
  await until(() => f.app.store.read().resident.messages.length === 2); const sent = f.app.store.read().resident.messages[1]; assert.equal(sent.replyTo, ids[0]); assert.deepEqual(sent.mentions, ['fake-b']);
  await page.locator('.message-quote').click(); assert.equal(await page.locator(`[data-message-id="${ids[0]}"]`).evaluate(n => document.activeElement === n), true);
  await row.getByRole('button', { name: /펼치기/ }).click(); await page.locator('#theme-toggle').click();
  await page.reload(); await page.waitForFunction(() => document.querySelector('.message-text')?.textContent.length === 90000);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark'); assert.equal(await page.locator('.room-message').count(), 2); assert.deepEqual(errors, []);
});

test('R3-C/F: 20 events, two reconnects, one status notice, no forced scroll and zero provider calls', { timeout: 90000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0; f.app.providers.complete = async () => { calls++; throw new Error('unexpected provider'); };
  seed(f, Array.from({ length: 55 }, (_, n) => '과거 대화 ' + n + '\n' + '이전 발언을 읽는 중입니다. '.repeat(10)));
  const browser = await launch(t); const { page, context, errors } = await open(browser, f, { width: 1024, height: 1000 });
  let streams = 0; page.on('request', r => { if (r.url().includes('/api/events?')) streams++; });
  await page.evaluate(() => { const Original = window.EventSource; window.fixtureStreams = []; window.EventSource = class extends Original { constructor(...args) { super(...args); window.fixtureStreams.push(this); } }; });
  // Reload uses the ordinary EventSource; capture it before module evaluation.
  await page.addInitScript(() => { const Original = window.EventSource; window.fixtureStreams = []; window.EventSource = class extends Original { constructor(...args) { super(...args); window.fixtureStreams.push(this); } }; });
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.room-message').length === 50);
  await page.locator('#room-more').click(); await page.waitForFunction(() => document.querySelectorAll('.room-message').length === 55);
  await page.locator('#room-timeline').evaluate(n => { n.scrollTop = 0; }); await delay(150);
  const before = await page.locator('#room-timeline').evaluate(n => n.scrollTop); const { events } = seed(f, Array.from({ length: 20 }, (_, n) => '신규 20발언 ' + n));
  await page.waitForFunction(() => [...document.querySelectorAll('.message-text')].filter(n => n.textContent.startsWith('신규 20발언')).length === 20);
  assert.ok(Math.abs(await page.locator('#room-timeline').evaluate(n => n.scrollTop) - before) < 3); await page.locator('#room-unread').waitFor();
  f.app.store.transact((s, emit) => emit({ type: 'resident.status_changed', discussionId: null, data: { roomId: s.resident.rooms[0].id, status: 'budget_exhausted' } }));
  await page.locator('.system-message').waitFor(); const notice = f.app.store.events(0).at(-1);
  await page.evaluate(events => { for (let i = 0; i < 20; i++) for (const e of events) window.fixtureStreams.at(-1).dispatchEvent(new MessageEvent('change', { data: JSON.stringify(e) })); }, [...events, notice]);
  for (let n = 0; n < 2; n++) {
    const count = streams; f.http.closeStreams(); await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('재연결')); await until(() => streams > count, 15000); await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('실시간'));
  }
  assert.equal(await page.locator('.room-message').count(), 75); assert.equal(await page.locator('.system-message').count(), 1); assert.equal(calls, 0);
  assert.equal(await page.evaluate(() => window.fixtureStreams.length), 1);
  const firstId = await page.locator('.room-message').first().getAttribute('data-message-id');
  await page.locator('#room-timeline').evaluate(n => { n.scrollTop = 0; }); await delay(150); await page.reload();
  await page.waitForFunction(id => !!document.querySelector(`[data-message-id="${id}"]`), firstId);
  await page.waitForFunction(() => document.querySelectorAll('.room-message').length === 75);
  assert.ok(await page.locator('#room-timeline').evaluate(n => n.scrollTop) < 3);
  await page.locator('#room-unread').click(); assert.ok(await page.locator('#room-timeline').evaluate(n => n.scrollTop) > 0); assert.deepEqual(errors, []);
  await mkdir('test-results/resident/R3', { recursive: true }); await writeFile('test-results/resident/R3/reconnect.json', JSON.stringify({ messages: 75, newMessages: 20, reconnects: 2, notices: 1, providerCalls: calls }, null, 2));
});

test('R3 quick member changes wait for the first confirmed refresh and keep separate settings CAS boundaries', { timeout: 30000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); const browser = await launch(t); const { page, errors } = await open(browser, f); let held; const posts = [];
  await page.route('**/api/rooms/*/control', async route => { posts.push(route.request().postDataJSON()); if (posts.length === 1) held = route; else await route.continue(); });
  await page.getByRole('checkbox', { name: '모의 참여자 A 발언 참여', exact: true }).check(); await until(() => held);
  await page.getByRole('checkbox', { name: '모의 참여자 B 발언 참여', exact: true }).check(); assert.equal(posts.length, 1);
  // A long response keeps emitting SSE while a remote state read is slower
  // than the coalescing interval. Controls must not wait for the stream to end.
  await page.route('**/api/state', async route => { const response = await route.fetch(); await delay(350); await route.fulfill({ response }); });
  const ticker = setInterval(() => f.app.store.transact((_s, emit) => emit({ type: 'resident.room_changed', discussionId: null, data: { fixtureProgress: true } })), 50);
  try { await held.continue(); await until(() => f.app.store.read().resident.rooms[0].members.filter(m => m.enabled).length === 2); await until(() => posts.length === 2); assert.equal(posts[1].expectedVersion, posts[0].expectedVersion + 1); assert.deepEqual(errors, []); }
  finally { clearInterval(ticker); await page.unroute('**/api/state'); }
});

test('R3 room settings require explicit values and preserve ledger; focus and uncertain recovery stay in existing APIs', { timeout: 90000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); const browser = await launch(t); const { page, errors } = await open(browser, f);
  await page.locator('#room-power').click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('방 설정')); assert.equal(f.app.store.read().resident.rooms[0].desiredOn, false);
  await page.locator('#room-settings').click(); assert.equal(await page.locator('#room-settings-form [name=maxRequests]').inputValue(), '');
  const values = { maxRequests: '30', maxTokens: '100000', maxToolJobs: '0', deadlineAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16), minInterval: '5', idleNudge: '120', passBackoff: '15', sleepAfterPasses: '3' };
  for (const [key, value] of Object.entries(values)) await page.locator(`#room-settings-form [name=${key}]`).fill(value);
  await page.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#room-settings-dialog').open);
  for (const p of ['A', 'B']) await page.getByRole('checkbox', { name: `모의 참여자 ${p} 발언 참여` }).check();
  await page.locator('#room-power').click(); await page.waitForFunction(() => document.querySelector('#room-state').textContent.includes('상주 중'));
  await page.locator('#room-focus-new').click(); await page.locator('#topic').fill('방 안에서 검토하는 작은 주제'); await page.getByRole('button', { name: /토의 시작/ }).click();
  await page.waitForFunction(() => document.querySelector('#discussion-state .badge')?.textContent === '완료');
  await f.app.residentRunner.tick(); await page.locator('[data-view=room]').click(); await page.waitForFunction(() => document.querySelectorAll('.room-message').length > 0);
  await page.waitForFunction(() => document.querySelector('#room-focus').textContent.includes('자유 대화'));
  assert.equal(f.app.store.read().resident.rooms[0].topicLink, null);
  await page.locator('#room-power').click(); await page.waitForFunction(() => document.querySelector('#room-state').textContent === '꺼짐');
  const r = f.app.store.read().resident.rooms[0]; const count = r.ledger.length;
  await page.locator('#room-settings').click(); await page.locator('#room-settings-form [name=maxRequests]').fill('40'); await page.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#room-settings-dialog').open); assert.equal(f.app.store.read().resident.rooms[0].ledger.length, count);
  f.app.store.transact((s, emit) => { const r = s.resident.rooms[0]; const p = s.participants[0];
    s.resident.turns.push({ id: 'uncertain-fixture', roomId: r.id, participantId: p.id, participant: p, status: 'unconfirmed', generation: r.contexts?.find(c => c.participantId === p.id)?.generation ?? 1, epoch: r.epoch, prompt: 'fixture', promptDigest: digest('fixture'), history: [], basisSequence: r.lastMessageSequence, text: '', receipt: 'original-receipt', reply: null, usage: null, startedAt: new Date().toISOString(), finishedAt: null, error: 'fixture_unconfirmed', repairOf: null, messageId: null, proposalsStatus: 'none' });
    emit({ type: 'resident.recovery_blocked', discussionId: null, data: { roomId: r.id, turnId: 'uncertain-fixture' } });
  });
  await panel(page, 'activity'); await page.locator('#room-panel summary').filter({ hasText: '원본과 복구' }).click(); await page.getByRole('button', { name: '미전송 확인', exact: true }).click(); await page.getByRole('button', { name: '대조 결과 적용', exact: true }).click();
  await until(() => f.app.store.read().resident.turns.find(t => t.id === 'uncertain-fixture').status === 'failed');
  await page.locator('[data-board-tab=workspace]').click(); await page.locator('#room-material-manage').click();
  assert.equal(await page.locator('.material-controls').isVisible(), true); assert.equal(await page.locator('.material-controls').evaluate(n => n.open), true); assert.deepEqual(errors, []);
});

test('R3-F: four observation fixtures retain original times and show waiting, tool work, stopped observation and stale generation', { timeout: 45000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); const at = '2026-10-30T01:02:03.000Z'; const ids = ['waiting', 'tool', 'stopped', 'old'];
  f.app.store.transact(s => {
    const r = s.resident.rooms[0]; s.participants = ids.map(id => ({ id, kind: 'fake', label: id, modelId: 'fixture', connectionId: null, role: '' }));
    r.members = ids.map(participantId => ({ participantId, enabled: false })); r.contexts = ids.map(participantId => ({ participantId, generation: participantId === 'old' ? 2 : 1, history: [], checkpointId: null, lastSeenSequence: 0 }));
    r.topicLink = 'observation-fixture'; s.discussions.push({ id: r.topicLink, topic: '관측 fixture', status: 'paused', phase: 'independent', revision: 1, createdAt: at, updatedAt: at, tasks: [{ id: 'tool-task', participantId: 'tool' }], turns: [], members: [], excludedIds: [], contexts: ids.filter(id => id !== 'old').map(participantId => ({ participantId, generation: 1, history: [], checkpointId: null, observation: { connection: 'ready', response: 'waiting', tool: participantId === 'tool' ? 'running' : 'not_applicable', work: 'pending', observedAt: at, lastProgressAt: null, source: 'fake', reason: participantId === 'stopped' ? 'observation_stopped' : null } })) });
    s.resident.turns.push({ id: 'stale-observation', roomId: r.id, participantId: 'old', generation: 1, epoch: r.epoch, status: 'stale', startedAt: at, finishedAt: at, participant: s.participants[3], text: 'PRIVATE RAW', prompt: 'PRIVATE PROMPT', error: null });
  });
  const before = f.app.store.cursor(); const browser = await launch(t); const { page, errors } = await open(browser, f, { width: 1440, height: 1000 }, 4);
  await panel(page, 'activity'); await page.locator('#room-panel summary').filter({ hasText: '연결·응답·실행 관측' }).click();
  const cards = page.locator('#room-status .status-card'); assert.equal(await cards.count(), 4);
  assert.match(await cards.nth(0).textContent(), /응답 대기/); assert.match(await cards.nth(1).textContent(), /도구 · 진행 중/); assert.match(await cards.nth(2).textContent(), /observation_stopped/); assert.match(await cards.nth(3).textContent(), /이전 세대/);
  const expected = await page.evaluate(value => new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), at);
  for (let n = 0; n < 4; n++) assert.ok((await cards.nth(n).textContent()).includes(expected));
  assert.doesNotMatch(await page.locator('#room-status').textContent(), /PRIVATE/); assert.equal(f.app.store.cursor(), before); assert.equal(f.app.store.read().resident.turns.length, 1); assert.deepEqual(errors, []);
});

test('R3: lost POST response retains draft and blocks resend; stale settings cannot replace another tab', { timeout: 60000 }, async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); const browser = await launch(t); const { page, errors } = await open(browser, f);
  let truncated = false;
  await page.route('**/api/rooms/*/messages', async route => { if (route.request().method() === 'POST') { await route.fetch(); if (truncated) await route.fulfill({ status: 200, contentType: 'application/json', body: '{' }); else await route.abort('connectionreset'); } else await route.continue(); });
  await page.locator('#room-text').fill('결과를 확인하기 전 다시 보내지 않는 원래 입력'); await page.locator('#room-send').click(); await page.waitForFunction(() => document.querySelector('#room-send-state').textContent.includes('미확인'));
  assert.equal(await page.locator('#room-send').isDisabled(), true); assert.equal(await page.locator('#room-text').inputValue(), '결과를 확인하기 전 다시 보내지 않는 원래 입력');
  await page.locator('#room-text').press('Enter'); await page.getByRole('button', { name: '이력 새로 확인', exact: true }).click(); await page.locator('.room-message').waitFor(); assert.equal(f.app.store.read().resident.messages.length, 1);
  await page.getByRole('button', { name: '대조 완료 · 입력 잠금 해제', exact: true }).click(); truncated = true;
  await page.locator('#room-text').fill('응답 JSON이 잘려도 다시 보내지 않는 두 번째 입력'); await page.locator('#room-send').click();
  await page.waitForFunction(() => document.querySelector('#room-send-state').textContent.includes('미확인'));
  assert.equal(await page.locator('#room-send').isDisabled(), true); await page.locator('#room-text').press('Enter'); assert.equal(f.app.store.read().resident.messages.length, 2);
  await page.locator('#room-settings').click(); const first = f.app.store.read().resident.rooms[0]; f.app.resident.control(first.id, { action: 'configure', expectedVersion: first.version, budgets: budget(Date.now(), 20), pacing }, 'other-tab-setting');
  await page.waitForFunction(() => document.querySelector('#room-usage').textContent.includes('/ 20'));
  const values = { maxRequests: '9', maxTokens: '1000', maxToolJobs: '0', deadlineAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16), minInterval: '2', idleNudge: '20', passBackoff: '10', sleepAfterPasses: '2' };
  for (const [key, value] of Object.entries(values)) await page.locator(`#room-settings-form [name=${key}]`).fill(value);
  await page.getByRole('button', { name: '설정 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('다른 방 설정'));
  assert.equal(f.app.store.read().resident.rooms[0].budgets.maxRequests, 20); assert.equal(await page.locator('#room-settings-dialog').evaluate(n => n.open), true); assert.deepEqual(errors, []);
});
