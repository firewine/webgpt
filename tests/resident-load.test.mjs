import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { wikiFixture } from './wiki-fixture.mjs';
import { evidence } from './resident-acceptance-fixture.mjs';
import { digest } from '../dist/server/workspace/util.js';

test('R8-F: 1000 messages / 100 tasks / 100 Wiki retain every original, page at 50, omit raw bodies from state and measure the existing transaction cost', { timeout: 60000 }, async t => {
  const f = await wikiFixture(t, { on: false }); const expected = new Map([[f.sourceId, f.app.resident.message(f.roomId, f.sourceId).message.text]]);
  f.app.store.transact((s, emit) => { const r = s.resident.rooms[0]; for (let i = 1; i < 1000; i++) {
    const id = 'load-message-' + i; const text = `RAW_MESSAGE_${i}_` + '긴 공개 원문과 반론을 빠짐없이 보존합니다. '.repeat(24); expected.set(id, text);
    s.resident.messages.push({ id, roomId: r.id, sequence: ++r.lastMessageSequence, sourceKind: 'user', sourceId: null, authorId: 'owner', text, replyTo: null, mentions: [], visibility: 'room_public', createdAt: new Date().toISOString() });
    emit({ type: 'resident.message_created', discussionId: null, data: { roomId: r.id, messageId: id, sequence: r.lastMessageSequence } });
  } });
  const tasks = []; const pages = [];
  for (let i = 0; i < 100; i++) { tasks.push(f.propose({ title: '부하 일감 ' + i, description: 'RAW_TASK_' + i + '_'.repeat(100) })); pages.push(f.w.edit(f.roomId, f.edit({ slug: 'load-' + i, body: 'RAW_WIKI_' + i + '원문 '.repeat(500) }), 'load-wiki-' + i)); }
  const raw = await (await f.api('/api/state')).text(); assert.doesNotMatch(raw, /RAW_MESSAGE_|RAW_TASK_|RAW_WIKI_/);
  const allMessages = []; let after = 0; let maxMessagePage = 0; let hasMore;
  do { const page = await (await f.api(`/api/rooms/${f.roomId}/messages?after=${after}&limit=50`)).json(); assert.ok(page.messages.length <= 50); maxMessagePage = Math.max(maxMessagePage, page.messages.length); allMessages.push(...page.messages); after = page.nextAfter; hasMore = page.hasMore; } while (hasMore);
  assert.equal(allMessages.length, 1100); assert.equal(new Set(allMessages.map(m => m.id)).size, 1100);
  const collect = async path => { const result = []; let offset = 0; let more; do { const p = await (await f.api(`${path}?after=${offset}&limit=50`)).json(); assert.ok(p.items.length <= 50); result.push(...p.items); offset = p.nextAfter; more = p.hasMore; } while (more); return result; };
  assert.equal((await collect(`/api/rooms/${f.roomId}/work`)).length, 100); assert.equal((await collect(`/api/rooms/${f.roomId}/wiki`)).length, 100);
  const checkInBatches = async (items, check) => { for (let i = 0; i < items.length; i += 20) await Promise.all(items.slice(i, i + 20).map(check)); };
  await checkInBatches([...expected], async ([id, text]) => { const p = await (await f.api(`/api/rooms/${f.roomId}/messages/${id}`)).json(); assert.equal(p.message.text, text); assert.equal(p.digest, digest(text)); });
  await checkInBatches(pages, async p => { const detail = await (await f.api(`/api/rooms/${f.roomId}/wiki/${p.pageId}`)).json(); assert.equal(detail.version.digest, p.digest); assert.equal(detail.version.body, 'RAW_WIKI_' + pages.indexOf(p) + '원문 '.repeat(500)); const history = await (await f.api(`/api/rooms/${f.roomId}/wiki/${p.pageId}/history?limit=50`)).json(); assert.equal(history.items.length, 1); });
  await checkInBatches(tasks, async (id) => { const p = await (await f.api(`/api/rooms/${f.roomId}/work/${id}`)).json(); assert.equal(p.task.description, 'RAW_TASK_' + tasks.indexOf(id) + '_'.repeat(100)); });
  const costs = []; const before = JSON.stringify(f.app.store.read());
  for (let i = 0; i < 12; i++) { const start = performance.now(); f.app.store.transact(() => {}); costs.push(performance.now() - start); }
  assert.equal(JSON.stringify(f.app.store.read()), before); assert.equal(f.app.store.read().resident.turns.length, 0); assert.equal(f.app.store.read().jobs.length, 0);
  costs.sort((a, b) => a - b); const result = { seededMessages: 1000, wikiNotices: 100, messages: allMessages.length, tasks: tasks.length, wikiPages: pages.length, missingOriginals: 0, maxRequestedMessagePage: maxMessagePage, maxRequestedWorkWikiPage: 50, apiStateBytes: Buffer.byteLength(raw), stateBytes: Buffer.byteLength(before), heapUsedBytes: process.memoryUsage().heapUsed, transaction: { samples: costs.length, medianMs: (costs[5] + costs[6]) / 2, p95Ms: costs[11], maxMs: costs.at(-1) }, transportCalls: 0, realHostLongTermScale: 'UNVERIFIED' };
  await evidence('load', result); t.diagnostic(JSON.stringify(result));
});
