import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workspace, ownerKey } from './workspace-helpers.mjs';
import { digest } from '../dist/server/workspace/util.js';

const roomPath = f => '/api/rooms/' + f.app.resident.snapshot().rooms[0].id;
async function errorCode(response, status, code) {
  assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
}

test('resident is off by default with no migration or new legacy state writes', async t => {
  const f = await workspace(t); const before = f.app.store.read();
  const result = await (await f.api('/api/rooms')).json();
  assert.deepEqual(result, { enabled: false, schemaVersion: null, dispatchAvailable: false, rooms: [], cursor: 0 });
  assert.equal('resident' in before, false); assert.deepEqual(f.app.store.read(), before);
  await errorCode(await f.api('/api/rooms/missing/messages'), 404, 'resident_not_initialized');
});

test('R1-D: all room routes reuse owner, Host and Origin checks; scoped MCP keys do not authorize them', async t => {
  const f = await workspace(t, { residentEnabled: true }); const root = roomPath(f);
  f.app.store.transact(s => { s.grants.push({ id: 'fixture-grant', hash: digest('fixture-mcp-key'), discussionId: 'fixture-topic', participantId: 'fake-a', tools: ['task_get'], revoked: false }); });
  for (const path of ['/api/rooms', root, root + '/messages', root + '/messages/missing']) {
    assert.equal((await fetch(f.url + path)).status, 401);
    assert.equal((await f.api(path, undefined, { headers: { Authorization: 'Bearer fixture-mcp-key' } })).status, 401);
    assert.equal((await f.api(path, undefined, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      const req = request(f.url + path, { headers: { Host: 'evil.example', Authorization: 'Bearer ' + ownerKey } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
    }); assert.equal(hostStatus, 403);
  }
  const login = await fetch(f.url + '/api/login', { method: 'POST', headers: { Origin: f.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ownerKey }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const [path, body] of [[root + '/messages', { text: 'hello' }], [root + '/control', { action: 'off', expectedVersion: 1 }]]) {
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'auth-fixture-' + path.split('/').at(-1) };
    assert.equal((await fetch(f.url + path, { method: 'POST', headers, body: JSON.stringify(body) })).status, 403);
    assert.equal((await f.api(path, body, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(f.url + path, { method: 'POST', headers: { ...headers, Origin: f.url }, body: JSON.stringify(body) })).status < 400, true);
  }
});

test('R1-C: 20 identical message and control keys each commit one result/event; changed payload conflicts', async t => {
  const f = await workspace(t, { residentEnabled: true }); const root = roomPath(f); let original; let control;
  for (let i = 0; i < 20; i++) {
    const posted = await f.api(root + '/messages', { text: 'One original' }, { headers: { 'Idempotency-Key': 'message-20' } }); assert.equal(posted.status, 201);
    const result = await posted.json(); if (i === 0) original = result; else assert.deepEqual(result, original);
    const changed = await f.api(root + '/control', { action: 'rename', title: '한 방', expectedVersion: 1 }, { headers: { 'Idempotency-Key': 'control-20' } }); assert.equal(changed.status, 200);
    const receipt = await changed.json(); if (i === 0) control = receipt; else assert.deepEqual(receipt, control);
  }
  await errorCode(await f.api(root + '/messages', { text: 'Different' }, { headers: { 'Idempotency-Key': 'message-20' } }), 409, 'idempotency_conflict');
  await errorCode(await f.api(root + '/control', { action: 'rename', title: 'Different', expectedVersion: 1 }, { headers: { 'Idempotency-Key': 'control-20' } }), 409, 'idempotency_conflict');
  assert.equal(f.app.store.read().resident.messages.length, 1);
  assert.deepEqual(f.app.store.events(0).map(e => e.type), ['resident.message_created', 'resident.room_changed']);
  const db = new DatabaseSync(join(f.directory, 'workspace.sqlite'), { readOnly: true }); t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commands WHERE id LIKE 'resident:command:%'").get().n, 2);
});

test('room CAS controls do not mutate legacy participants/discussions or dispatch providers/jobs', async t => {
  const f = await workspace(t, { residentEnabled: true }); const root = roomPath(f); const before = f.app.store.read();
  let providers = 0; let jobs = 0; f.app.providers.complete = async () => { providers++; throw new Error('unexpected provider'); }; f.app.codex.submit = () => { jobs++; throw new Error('unexpected job'); };
  const enabled = await f.api(root + '/control', { action: 'set_member', expectedVersion: 1, participantId: 'fake-a', enabled: true }); assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).version, 2);
  await errorCode(await f.api(root + '/control', { action: 'rename', expectedVersion: 1, title: 'stale' }), 409, 'room_version_conflict');
  await errorCode(await f.api(root + '/control', { action: 'set_member', expectedVersion: 2, participantId: 'unknown', enabled: true }), 404, 'participant_not_found');
  await errorCode(await f.api(root + '/control', { action: 'on', expectedVersion: 2 }), 409, 'resident_dispatch_not_available');
  const cursor = f.app.store.cursor(); assert.equal((await (await f.api(root + '/control', { action: 'off', expectedVersion: 2 })).json()).changed, false);
  assert.equal(f.app.store.cursor(), cursor);
  assert.equal((await f.api(root + '/messages', { text: 'Message while off', mentions: ['fake-a'] })).status, 201);
  await delay(25); const after = f.app.store.read();
  assert.deepEqual(after.participants, before.participants); assert.deepEqual(after.discussions, before.discussions); assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.resident.turns, []); assert.deepEqual(after.resident.dispatchLeases, []);
  assert.equal(after.resident.rooms[0].desiredOn, false); assert.equal(providers, 0); assert.equal(jobs, 0);
});

test('long originals preserve whitespace/digest and pagination is bounded with explicit previews', async t => {
  const f = await workspace(t, { residentEnabled: true }); const root = roomPath(f); const roomId = f.app.resident.snapshot().rooms[0].id;
  const text = '  첫 줄\n' + '긴 답변 '.repeat(200) + '\n  ';
  const first = await (await f.api(root + '/messages', { text })).json();
  for (let i = 1; i < 55; i++) f.app.resident.postMessage(roomId, { text: 'Message ' + i }, 'page-' + i);
  const list = await (await f.api(root + '/messages')).json();
  assert.equal(list.messages.length, 50); assert.equal(list.nextAfter, 50); assert.equal(list.hasMore, true);
  assert.equal(list.messages[0].preview, text.slice(0, 500)); assert.equal(list.messages[0].truncated, true);
  assert.equal(list.messages[0].textLength, text.length); assert.equal(list.messages[0].digest, digest(text)); assert.equal('text' in list.messages[0], false);
  const original = await (await f.api(root + '/messages/' + first.messageId)).json(); assert.equal(original.message.text, text); assert.equal(original.digest, digest(text));
  const next = await (await f.api(root + '/messages?after=50&limit=10')).json(); assert.equal(next.messages.length, 5); assert.equal(next.nextAfter, 55); assert.equal(next.hasMore, false);
  for (const query of ['after=-1', 'after=1e1', 'after=1.5', 'after=0&after=1', 'after=', 'limit=0', 'limit=101', 'limit=1&limit=2', 'after=9007199254740992']) assert.equal((await f.api(root + '/messages?' + query)).status, 400, query);
  await errorCode(await f.api(root + '/messages?after=56'), 409, 'invalid_cursor');
});

test('reply/mention scope, visibility and server-owned message metadata cannot be bypassed', async t => {
  const f = await workspace(t, { residentEnabled: true }); const root = roomPath(f); const first = await (await f.api(root + '/messages', { text: 'Visible' })).json();
  f.app.store.transact(s => {
    const r = s.resident; const room = r.rooms[0]; r.rooms.push({ ...structuredClone(room), id: 'other-room', lastMessageSequence: 1 });
    const original = r.messages[0]; original.internalNote = 'private-internal-field';
    r.messages.push({ ...original, id: 'other-message', roomId: 'other-room', sequence: 1, text: 'Other room' });
    r.messages.push({ ...original, id: 'private-message', sequence: ++room.lastMessageSequence, visibility: 'owner_only', text: 'Private message' });
    r.messages.push({ ...original, id: 'round-message', sequence: ++room.lastMessageSequence, visibility: 'topic_round', text: 'Blind draft' });
  });
  for (const replyTo of ['other-message', 'private-message', 'round-message', 'missing']) await errorCode(await f.api(root + '/messages', { text: 'Reply', replyTo }), 403, 'reply_not_in_room');
  await errorCode(await f.api(root + '/messages', { text: 'Mention', mentions: ['unknown'] }), 403, 'mention_not_in_room');
  for (const body of [{ text: 'Spoof', authorId: 'fake-a' }, { text: 'Spoof', sourceKind: 'topic' }, { text: 'Spoof', visibility: 'room_public' }, { text: 'Spoof', sequence: 10 }, { text: '  ' }, { text: 'x'.repeat(20_001) }]) assert.equal((await f.api(root + '/messages', body)).status, 400);
  const reply = await f.api(root + '/messages', { text: 'Valid reply', replyTo: first.messageId, mentions: ['fake-a', 'fake-a'] }); assert.equal(reply.status, 201);
  const { messageId } = await reply.json(); const saved = (await (await f.api(root + '/messages/' + messageId)).json()).message;
  assert.equal(saved.authorId, 'owner'); assert.equal(saved.sourceKind, 'user'); assert.deepEqual(saved.mentions, ['fake-a']);
  for (const id of ['other-message', 'private-message', 'round-message']) assert.equal((await f.api(root + '/messages/' + id)).status, 404);
  const list = await (await f.api(root + '/messages')).json(); assert.equal(list.messages.length, 2); assert.doesNotMatch(JSON.stringify(list), /private-internal-field|Blind draft|Private message|Other room/);
  assert.doesNotMatch(await (await f.api(root + '/messages/' + first.messageId)).text(), /private-internal-field/);
});

test('snapshot and SSE publish room/message references without raw text or future internal records', async t => {
  const f = await workspace(t, { residentEnabled: true }); const root = roomPath(f); const secret = 'fixture-message-original-not-in-snapshot';
  await f.api(root + '/messages', { text: secret });
  f.app.store.transact(s => { s.resident.turns.push({ prompt: 'fixture-private-prompt' }); s.resident.wikiPages.push({ body: 'fixture-private-wiki' }); });
  const snapshot = await (await f.api('/api/state')).text(); assert.doesNotMatch(snapshot, /fixture-message-original|fixture-private/);
  const abort = new AbortController(); const response = await f.api('/api/events?after=0', undefined, { signal: abort.signal }); const reader = response.body.getReader();
  let text = ''; try { while (!text.includes('resident.message_created')) text += new TextDecoder().decode((await reader.read()).value); }
  finally { abort.abort(); await reader.cancel().catch(() => {}); }
  assert.match(text, /messageId/); assert.doesNotMatch(text, /fixture-message-original|fixture-private/);
});
