import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, until, topic, response } from './workspace-helpers.mjs';
import { deepseekStream, coralModel } from './anthropic-fixture.mjs';
import { workFixture } from './work-fixture.mjs';
import { reply } from './resident-fixture.mjs';

async function connect(f, service = 'coralbricks', maximum = undefined) {
  const row = service === 'coralbricks' ? { ...coralModel } : service === 'river' ? { id: 'deepseek-ai/DeepSeek-V4.1-Flash' } : { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'] } };
  if (maximum !== undefined) row.max_output_tokens = maximum; row.context_window = 1048576;
  const sends = []; let handler = () => deepseekStream('final answer');
  f.app.providers.request = async (url, options) => { if (url.endsWith('/models')) return Response.json({ data: [row] }); const body = JSON.parse(options.body); sends.push(body); return handler(body); };
  const cid = await f.app.addDeepSeek({ label: 'Output fixture', apiService: service, key: 'fixture-only-key' });
  const create = value => f.app.participant({ label: 'DS output fixture', connectionId: cid, modelId: row.id, reasoningEffort: 'max', ...(value === undefined ? {} : { maxOutputTokens: value }) });
  const member = pid => f.app.store.read().participants.find(p => p.id === pid);
  const input = pid => ({ requestId: crypto.randomUUID(), participant: member(pid), prompt: 'fixture', history: [], signal: AbortSignal.timeout(5000), hooks: { dispatched() {}, receipt() {}, delta() {} } });
  return { ...f, cid, modelId: row.id, row, create, member, input, sends, handler: value => { handler = value; } };
}
for (const service of ['deepseek', 'coralbricks', 'river']) test('DeepSeek ' + service + ': absent/default stays 4096 and every explicit output limit uses the native payload without changing Max', async t => {
  const f = await connect(await workspace(t), service, 393216); const pid = f.create(); assert.equal(f.member(pid).maxOutputTokens, undefined); assert.equal(f.app.store.read().connections[0].models[0].outputTokenLimit, 393216);
  await f.app.providers.complete(f.input(pid)); assert.equal(f.sends.at(-1).max_tokens, 4096);
  for (const value of [512, 8192, 16384, 32768]) { f.app.participant({ ...f.member(pid), maxOutputTokens: value }, pid); await f.app.providers.complete(f.input(pid)); assert.equal(f.sends.at(-1).max_tokens, value); assert.equal(f.sends.at(-1).reasoning_effort, 'max'); }
  f.app.participant({ connectionId: f.cid, modelId: f.modelId, label: 'keep existing' }, pid); assert.equal(f.member(pid).maxOutputTokens, 32768);
  f.app.participant({ ...f.member(pid), maxOutputTokens: 'default' }, pid); assert.equal(f.member(pid).maxOutputTokens, undefined); await f.app.providers.complete(f.input(pid)); assert.equal(f.sends.at(-1).max_tokens, 4096);
});

test('catalog output metadata is distinct from context and unknown limits; a reported cap is checked again before any dispatch', async t => {
  const f = await connect(await workspace(t), 'coralbricks', 8192); const pid = f.create(8192);
  assert.throws(() => f.create(8193), /output_limit_not_supported/); assert.equal(f.sends.length, 0);
  f.app.store.transact(s => { s.connections.find(c => c.id === f.cid).models[0].outputTokenLimit = 2048; });
  await assert.rejects(f.app.providers.complete(f.input(pid)), /output_limit_not_supported/); assert.throws(() => f.create(), /output_limit_not_supported/); assert.equal(f.sends.length, 0);
  const small = f.create(1024); await f.app.providers.complete(f.input(small)); assert.equal(f.sends.at(-1).max_tokens, 1024);
  for (const value of [undefined, null, '8192', -1, 0, 1.5]) { if (value === undefined) delete f.row.max_output_tokens; else f.row.max_output_tokens = value; await f.app.refreshModels(f.cid); assert.equal(f.app.store.read().connections.find(c => c.id === f.cid).models[0].outputTokenLimit, undefined); }
  const legacy = f.create(); await f.app.providers.complete(f.input(legacy)); assert.equal(f.sends.at(-1).max_tokens, 4096);
});

test('invalid owner limits and unsupported providers never send; validation errors do not mutate the saved participant', async t => {
  const f = await connect(await workspace(t)); const pid = f.create(8192), original = f.member(pid);
  for (const value of [511, 32769, 0, -1, 1.5, NaN, Infinity, null, '', '8192', false, {}]) { assert.throws(() => f.app.participant({ ...original, maxOutputTokens: value }, pid), /invalid_output_limit/); await assert.rejects(f.app.providers.complete({ ...f.input(pid), participant: { ...original, maxOutputTokens: value } }), /invalid_output_limit/); }
  const bad = await f.api('/api/participants/' + pid, { ...original, maxOutputTokens: 511 }); assert.equal(bad.status, 400); assert.deepEqual(f.member(pid), original);
  const foreign = await f.api('/api/participants/' + pid, { ...original, maxOutputTokens: 16384 }, { headers: { Origin: 'https://foreign.invalid' } }); assert.equal(foreign.status, 403); assert.deepEqual(f.member(pid), original);
  for (const kind of ['fake', 'openai-oauth', 'codex-oauth', 'browser', 'anthropic']) { await assert.rejects(f.app.providers.complete({ ...f.input(pid), participant: { ...original, kind } }), /output_limit_requires_deepseek/); }
  assert.equal(f.sends.length, 0);
});

test('topic/global edits preserve old and active snapshots; output-only configuration keeps Max and requires settled responses', async t => {
  const f = await connect(await workspace(t)); const pid = f.create(8192); let release, releaseNext;
  const held = new Promise(resolve => { release = resolve; }), next = new Promise(resolve => { releaseNext = resolve; }); t.after(() => { release(); releaseNext(); });
  f.handler(async body => { if (f.sends.length === 1) await held; else if (f.sends.length === 2) await next; return deepseekStream(response(body.messages.at(-1).content, { id: pid, label: 'DS' })); });
  const id = f.app.engine.create({ ...topic, participantIds: [pid, 'fake-a'] }, 'output-topic'); await until(() => f.sends.length === 1); f.app.engine.control(id, { action: 'pause', expectedRevision: 1 }, 'output-pause');
  assert.throws(() => f.app.participant({ ...f.member(pid), maxOutputTokens: 16384 }, pid), /participant_output_requires_idle/);
  assert.throws(() => f.app.engine.control(id, { action: 'configure_participant', expectedRevision: 1, participantId: pid, maxOutputTokens: 16384 }, 'active-output'), /participant_settings_require_pause/);
  release(); await until(() => f.app.discussion(id).discussion.turns[0].status === 'completed'); const original = structuredClone(f.app.discussion(id).discussion.turns[0]); assert.equal(original.maxOutputTokens, 8192);
  f.app.participant({ ...f.member(pid), maxOutputTokens: 16384 }, pid); assert.equal(f.app.discussion(id).discussion.members.find(p => p.id === pid).maxOutputTokens, 8192);
  const configure = value => f.app.engine.control(id, { action: 'configure_participant', expectedRevision: 1, participantId: pid, maxOutputTokens: value }, crypto.randomUUID());
  configure(32768); assert.equal(f.app.discussion(id).discussion.members.find(p => p.id === pid).reasoningEffort, 'max'); assert.equal(f.member(pid).maxOutputTokens, 16384);
  assert.throws(() => f.app.engine.control(id, { action: 'configure_participant', expectedRevision: 1, participantId: pid, reasoningEffort: 'high', maxOutputTokens: null }, 'invalid-combined'), /invalid_output_limit/); assert.equal(f.app.discussion(id).discussion.members.find(p => p.id === pid).reasoningEffort, 'max');
  f.app.store.transact(s => { s.discussions[0].turns[0].status = 'unconfirmed'; }); assert.throws(() => configure(16384), /participant_settings_require_pause/); assert.throws(() => f.app.participant({ ...f.member(pid), maxOutputTokens: 16385 }, pid), /participant_output_requires_idle/); f.app.store.transact(s => { s.discussions[0].turns[0].status = 'completed'; });
  f.app.engine.control(id, { action: 'resume', expectedRevision: 1 }, 'output-resume'); await until(() => f.sends.length === 2); f.app.engine.control(id, { action: 'pause', expectedRevision: 1 }, 'output-pause-next'); releaseNext(); await until(() => f.app.discussion(id).discussion.turns.filter(t => t.participantId === pid && t.status === 'completed').length === 2);
  assert.equal(f.sends[1].max_tokens, 32768); assert.equal(f.app.discussion(id).discussion.turns.filter(t => t.participantId === pid)[1].maxOutputTokens, 32768); assert.deepEqual(f.app.discussion(id).discussion.turns[0], original);
  configure('default'); assert.equal(f.app.discussion(id).discussion.members.find(p => p.id === pid).maxOutputTokens, undefined); assert.equal(f.app.discussion(id).discussion.members.find(p => p.id === pid).reasoningEffort, 'max');
});

test('resident and work use the existing Member snapshot; later settings never rewrite the original WorkAttempt input/digest', async t => {
  const f = await connect(await workFixture(t, { on: false })); const pid = f.create();
  for (const id of ['fake-a', 'fake-b']) f.control({ action: 'set_member', participantId: id, enabled: false });
  f.control({ action: 'set_member', participantId: pid, enabled: true }); f.q.seat(f.roomId, { participantId: pid, expectedVersion: 0, role: 'specialist', enabled: true, kinds: ['analysis'], scopeRefs: ['room:' + f.roomId] }, crypto.randomUUID()); f.control({ action: 'on' });
  let release; const held = new Promise(resolve => { release = resolve; }); t.after(release);
  f.handler(async () => { await held; return deepseekStream(reply()); }); const ambient = f.step(); await until(() => f.sends.length === 1); assert.throws(() => f.app.participant({ ...f.member(pid), maxOutputTokens: 16384 }, pid), /participant_output_requires_idle/); release(); await ambient;
  assert.equal(f.app.store.read().resident.turns[0].participant.maxOutputTokens, 4096); f.app.participant({ ...f.member(pid), maxOutputTokens: 16384 }, pid);
  const id = f.propose({ allowedParticipantIds: [pid] }); f.q.claim(f.roomId, id, { participantId: pid, expectedVersion: f.task(id).version }, crypto.randomUUID()); const original = structuredClone(f.app.store.read().resident.workAttempts.at(-1));
  f.handler(body => { const d = JSON.parse(body.messages.at(-1).content.split('\n\n').find(v => v.startsWith('{"taskId":'))); return deepseekStream(reply({ text: '검증과 합의를 구분하여 분석했습니다.', proposals: [{ kind: 'work_report', payload: { version: 1, taskId: d.taskId, taskVersion: d.taskVersion, attemptId: d.attemptId, summary: 'report', blockers: [] } }] })); }); await f.step();
  let s = f.app.store.read().resident, attempt = s.workAttempts.at(-1), turn = s.turns.find(t => t.id === attempt.providerTurnId); assert.equal(turn.participant.maxOutputTokens, 16384); assert.equal(f.sends.at(-1).max_tokens, 16384); assert.deepEqual(attempt.input, original.input); assert.equal(attempt.inputDigest, original.inputDigest);
  f.app.participant({ ...f.member(pid), maxOutputTokens: 32768 }, pid); s = f.app.store.read().resident; assert.equal(s.turns[0].participant.maxOutputTokens, 4096); assert.equal(s.turns.find(t => t.id === turn.id).participant.maxOutputTokens, 16384); assert.deepEqual(s.workAttempts.at(-1).input, original.input); assert.equal(s.workAttempts.at(-1).inputDigest, original.inputDigest);
});
