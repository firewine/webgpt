import test from 'node:test';
import assert from 'node:assert/strict';
import { residentFixture, reply } from './resident-fixture.mjs';
import { until } from './workspace-helpers.mjs';
import { digest } from '../dist/server/workspace/util.js';

test('R2-F: 100 raw chunks expose no actions; only a complete validated envelope creates text/claims with original digest', async t => {
  let release; const original = '  긴 원문\n' + '길'.repeat(20_000) + '\n  ';
  const raw = reply({ text: original, claims: [{ text: '검증이 필요한 주장', assumptions: ['reported only'] }], proposals: [{ kind: 'wiki_edit', payload: { body: 'not run' } }] });
  const f = await residentFixture(t, { complete: async input => {
    input.hooks.dispatched(); input.hooks.receipt('raw-receipt'); const size = Math.ceil(raw.length / 100);
    for (let i = 0; i < 100; i++) input.hooks.delta(raw.slice(i * size, (i + 1) * size));
    await new Promise(r => { release = r; }); return { text: raw, receipt: 'raw-receipt', usage: null };
  } });
  const pending = f.runner.tick(); await until(() => release);
  assert.deepEqual(f.store.read().resident.messages, []); assert.deepEqual(f.store.read().resident.claims, undefined); assert.deepEqual(f.store.read().resident.wikiVersions, []);
  release(); await pending; const state = f.store.read().resident; const turn = state.turns[0];
  assert.equal(turn.text, raw); assert.equal(f.runner.turn(f.roomId, turn.id).digest, digest(raw));
  assert.equal(state.messages[0].text, original); assert.equal(state.claims[0].text, '검증이 필요한 주장'); assert.equal(turn.proposalsStatus, 'not_run');
  assert.deepEqual(state.wikiVersions, []); assert.equal(f.resident.message(f.roomId, state.messages[0].id).digest, digest(original));
});

for (const invalid of ['unstructured', reply({ replyTo: 'not-an-observed-message' }), reply({ claims: [{ text: '' }] })]) {
  test('R2-F: invalid shape/reference has no actions and at most one confirmed format repair', async t => {
    const f = await residentFixture(t, { complete: async input => { input.hooks.dispatched(); return { text: invalid, receipt: 'invalid', usage: null }; } });
    for (let i = 0; i < 100; i++) { f.advance(); await f.runner.tick(); }
    assert.equal(f.calls(), 2); assert.equal(f.store.read().resident.messages.length, 0); assert.equal(f.room().reason, 'format_invalid');
    assert.equal(f.store.read().resident.turns[1].repairOf, f.store.read().resident.turns[0].id); assert.equal(f.store.read().resident.turns[0].text, invalid);
  });
}

for (const kind of ['say', 'work_report', 'wiki_edit']) {
  test('R2-I: late previous-generation ' + kind + ' is retained stale with no message or intent application', async t => {
    let release; const raw = kind === 'say' ? reply() : reply({ proposals: [{ kind, payload: { status: 'done', body: 'do not apply' } }] });
    const f = await residentFixture(t, { complete: async input => { input.hooks.dispatched(); await new Promise(r => { release = r; }); return { text: raw, receipt: 'late-original', usage: null }; } });
    const pending = f.runner.tick(); await until(() => release);
    f.store.transact(s => { s.resident.rooms[0].contexts[0].generation++; }); release(); await pending;
    const state = f.store.read().resident; assert.equal(state.turns[0].text, raw); assert.equal(state.turns[0].status, 'stale'); assert.equal(state.turns[0].proposalsStatus, 'stale');
    assert.deepEqual(state.messages, []); assert.deepEqual(state.workItems, []); assert.deepEqual(state.wikiVersions, []); assert.deepEqual(f.room().contexts[0].history, []);
  });
}

test('off during a response preserves its original but applies no late speech and never cancels an external job implicitly', async t => {
  let release; const f = await residentFixture(t, { complete: async input => { input.hooks.dispatched(); await new Promise(r => { release = r; }); return { text: reply(), receipt: 'off-late', usage: null }; } });
  const pending = f.runner.tick(); await until(() => release); f.control({ action: 'off' }); release(); await pending;
  assert.equal(f.store.read().resident.turns[0].status, 'stale'); assert.equal(f.store.read().resident.messages.length, 0); assert.equal(f.room().observedStatus, 'off');
  for (let i = 0; i < 100; i++) { f.advance(); await f.runner.tick(); } assert.equal(f.calls(), 1);
});

test('ambient participants receive the whole long reply plus structured dissent, not a clipped message list preview', async t => {
  const long = '다른 참여자가 재분석할 전체 장문 ' + '문'.repeat(20_000); const observed = [];
  const f = await residentFixture(t, { members: ['fake-a', 'fake-b'], complete: async input => {
    observed.push(input); const first = observed.length === 1;
    return { text: reply({ text: first ? long : '긴 발언을 독립적으로 검토했습니다.', claims: first ? [{ text: 'reported claim', assumptions: [] }] : [], uncertainty: ['합의와 독립 검증은 다릅니다.'] }), receipt: 'long-ambient', usage: null };
  } });
  await f.runner.tick(); f.advance(); await f.runner.tick(); assert.equal(observed.length, 2); assert.equal(observed[1].participant.id, 'fake-b');
  const data = JSON.parse(observed[1].prompt.split('\n\n').find(p => p.startsWith('{"roomId":')));
  assert.equal(data.messages[0].text, long); assert.equal(data.claims[0].status, 'reported'); assert.deepEqual(data.notes[0].uncertainty, ['합의와 독립 검증은 다릅니다.']);
  assert.equal(f.resident.messages(f.roomId, 0, 50).messages[0].preview.length, 500);
});
