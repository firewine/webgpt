import test from 'node:test';
import assert from 'node:assert/strict';
import { dotInputPage, dotToolResult, DOT_INPUT_PAGE_BYTES } from '../dist/server/connections/dot-input-pages.js';
import { DotMcpAdapter } from '../dist/server/connections/dot-mcp.js';
import { McpEvents } from '../dist/server/http/mcp-events.js';
import { dotTools, dotEventName } from '../dist/server/workspace/dot-mcp-model.js';
import { assertDotRetryAfterFailedSubmit, assertDotRetryAfterStop, dotInputDigest, validateDotRequests } from '../dist/server/workspace/dot-mcp-policy.js';
import { promptFor } from '../dist/server/workspace/prompts.js';
import { participantIdentity } from '../dist/server/workspace/wiki-policy.js';
import { AppError, digest } from '../dist/server/workspace/util.js';

const ids = { roomId: 'r'.repeat(200), participantId: 'p'.repeat(200), connectionId: 'c'.repeat(200) };
const requestId = 't'.repeat(200);
const event = { name: dotEventName, arguments: ids };
const dual = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const error = code => ({ code, status: 409 });

function syntheticInput() {
  const unit = '한글🙂𐐷e\u0301"\\\n\t\b\f\r\u0000\u001f';
  return { prompt: 'FIRST 원문\n' + unit.repeat(2700) + '\nCLAIM_0_ORIGINAL_반론',
    history: [{ role: 'user', content: unit.repeat(2700) }, { role: 'assistant', content: 'LAST 근거 \ud800 / \udfff' }] };
}
function projection(input) {
  return page => ({ event, request: { requestId, status: 'received', receipt: 'r'.repeat(200),
    inputDigest: dotInputDigest(input.prompt, input.history), usage: null, input: page } });
}
function readPages(input) {
  const project = projection(input), pages = [], results = [];
  let maximumBytes = 0;
  for (let index = 0; index !== null;) {
    const page = dotInputPage(input, index, project), result = dotToolResult(project(page));
    const bytes = Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 'i'.repeat(200), result }));
    assert.ok(bytes <= DOT_INPUT_PAGE_BYTES, `page ${index}: ${bytes} bytes`);
    assert.ok(page.text.isWellFormed(), 'JSON pages cannot split surrogate pairs');
    assert.equal(page.encoding, 'json'); assert.equal(page.pageIndex, pages.length);
    assert.equal(page.pageCount, pages[0]?.pageCount ?? page.pageCount);
    pages.push(page); results.push(result); maximumBytes = Math.max(maximumBytes, bytes);
    index = page.nextPage;
    assert.equal(index, pages.length < page.pageCount ? pages.length : null);
  }
  assert.equal(pages.length, pages[0].pageCount);
  const source = pages.map(page => page.text).join('');
  assert.equal(source, JSON.stringify({ prompt: input.prompt, history: input.history }));
  const restored = JSON.parse(source);
  assert.deepEqual(restored, { prompt: input.prompt, history: input.history });
  assert.equal(dotInputDigest(restored.prompt, restored.history), dotInputDigest(input.prompt, input.history));
  return { pages, results, maximumBytes };
}

// No filesystem, credentials, services, timers, or external calls: the actual
// adapter and MCP tools/call wrapper use an isolated in-memory mailbox.
function mailbox(input = syntheticInput(), legacy = false) {
  const at = new Date().toISOString(), expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const participant = { id: ids.participantId, label: 'Synthetic dot', kind: 'dot-mcp', connectionId: ids.connectionId, modelId: 'native-dot', role: '' };
  const grant = { id: 'grant-original', ...ids, version: 1, epoch: 1, contextGeneration: 1, identityDigest: participantIdentity(participant),
    hash: digest('synthetic-grant'), tools: [...dotTools], status: 'active', createdAt: at, expiresAt };
  const turn = { id: requestId, taskId: 'task', participantId: participant.id, revision: 1, generation: 1,
    phase: 'independent', round: 1, status: 'prepared', prompt: input.prompt, promptDigest: digest(input.prompt), text: '', reply: null, receipt: null };
  const task = { id: 'task', participantId: participant.id, revision: 1, phase: 'independent', round: 1, status: 'running',
    turnId: requestId, jobId: null, method: null, claimIds: [], question: '', reason: null };
  const discussion = { id: 'discussion', roomId: ids.roomId, revision: 1, phase: 'independent', round: 1, status: 'running',
    topic: 'Synthetic topic', materials: '', criteria: '', interventions: [], claims: [], evidence: [], excludedIds: [],
    members: [participant], contexts: [{ participantId: participant.id, generation: 1, history: structuredClone(input.history) }], tasks: [task], turns: [turn] };
  let state = { connections: [{ id: ids.connectionId, kind: 'dot-mcp' }], participants: [participant], discussions: [discussion],
    resident: { turns: [], rooms: [{ id: ids.roomId, epoch: 1, desiredOn: true, topicLink: discussion.id,
      members: [{ participantId: participant.id, enabled: true }], contexts: [{ participantId: participant.id, generation: 1 }] }],
      dispatchLeases: [{ id: requestId, ownerKind: 'topic', roomId: ids.roomId, participantId: participant.id, generation: 1, state: 'reserved' }] },
    dotMcp: { grants: [grant], bindings: [{ ...ids, version: 1, status: 'paired', identity: 'owner_confirmed' }],
      requests: { version: 1, items: [] }, events: { version: 1, subscriptions: [], outbox: [] } } };
  let writes = 0;
  const store = { read: () => structuredClone(state), transact(fn) {
    const next = structuredClone(state), result = fn(next, () => {}); state = next; writes++; return result;
  } };
  const values = new Map();
  const vault = { get: id => values.get(id), put: (id, value) => values.set(id, value) };
  const authority = { checkAuthority(g, name, _scope, current = store.read()) {
    if (current.dotMcp.grants.find(v => v.id === g.id)?.status !== 'active' || !g.tools.includes(name)) throw new AppError('dot_authentication_required', 401);
  } };
  const events = new McpEvents(store, vault, authority, false, { transport: { post: () => assert.fail('Unexpected external call') } });
  events.queueTurn = () => {};
  store.transact(s => s.dotMcp.events.subscriptions.push({ id: 'synthetic-subscription', grantId: grant.id, status: 'active', expiresAt }));
  const adapter = new DotMcpAdapter(store, vault, authority, events, true, () => true);
  events.tools = adapter;
  store.transact((s, emit) => adapter.prepare(s, emit, { requestId, participant, ...input }));
  const prepared = store.read().dotMcp.requests.items[0];
  store.transact(s => {
    if (legacy) delete s.dotMcp.requests.items[0].inputTransportVersion;
    s.dotMcp.requests.items[0].status = 'waiting'; s.discussions[0].turns[0].status = 'running'; s.resident.dispatchLeases[0].state = 'running';
  });
  return { adapter, events, store, vault, authority, grant, prepared, get writes() { return writes; },
    state: store.read, update: fn => store.transact(fn),
    call: (name, args = {}) => adapter.call(name, args, grant),
    rpc: (name, args = {}) => events.handle('tools/call', { name, arguments: args }, grant) };
}

test('v1 keeps the exact recorded legacy page boundaries and dual envelope', () => {
  const input = syntheticInput();
  assert.ok(Buffer.byteLength(input.prompt) + input.history.reduce((n, h) => n + Buffer.byteLength(h.content), 0) >= 137_805);
  const { pages, results } = readPages(input);
  // Recorded from the unchanged v1 helper before implementing transport v2.
  assert.equal(dotInputDigest(input.prompt, input.history), '8d931964b261a7f680649b93b433490ab033379808657e2bc4abd379b9bfbdd2');
  assert.equal(pages.length, 80);
  assert.equal(digest(JSON.stringify(pages)), '7e4c9214230ac64da37be658ed2044fc9db2ec9ddd8d00e9d735890550676f0a');
  assert.equal(digest(JSON.stringify(results)), '7591faeb37840ae73bd4eb76c8a2764a512fa4e4245325db0814e0c58ab78bcb');
  for (let i = 0; i < pages.length; i++) {
    assert.equal(Object.hasOwn(pages[i], 'transportVersion'), false);
    assert.deepEqual(results[i], dual(projection(input)(pages[i])));
  }
});

test('v2 uses fewer lossless pages and one text JSON result within the complete 12000-byte RPC', t => {
  const input = syntheticInput(), legacy = readPages(input), v2 = readPages({ ...input, inputTransportVersion: 2 });
  assert.ok(v2.pages.length < legacy.pages.length);
  for (let i = 0; i < v2.pages.length; i++) {
    assert.equal(v2.pages[i].transportVersion, 2);
    assert.deepEqual(v2.results[i], { content: [{ type: 'text', text: JSON.stringify(projection(input)(v2.pages[i])) }] });
    assert.deepEqual(JSON.parse(v2.results[i].content[0].text), projection(input)(v2.pages[i]));
  }
  t.diagnostic(`Synthetic raw input: 140458 bytes; pages ${legacy.pages.length} -> ${v2.pages.length}; maximum v2 RPC ${v2.maximumBytes} bytes, including a 200-character ID.`);
});

test('only a v2 page marker selects the single-content envelope', () => {
  for (const value of [null, 'text', { request: null }, { transportVersion: 2 }, { request: { inputTransportVersion: 2 } },
    { request: { prompt: 'full', history: [], inputTransportVersion: 2 } }, { request: { input: { transportVersion: '2' } } },
    { request: { input: { transportVersion: 3 } } }, { requestId, attemptId: 'attempt', attemptToken: 'synthetic' }, { accepted: true, receipt: 'receipt', disposition: 'received' }]) {
    assert.deepEqual(dotToolResult(value), dual(value));
  }
});

for (const version of [undefined, 2]) {
  test(`transport ${version ?? 'legacy'} preserves invalid page rejection`, () => {
    const input = { prompt: '', history: [], ...(version === 2 ? { inputTransportVersion: 2 } : {}) };
    const project = projection(input), first = dotInputPage(input, 0, project);
    assert.equal(first.pageCount, 1); assert.equal(first.nextPage, null);
    assert.deepEqual(JSON.parse(first.text), { prompt: '', history: [] });
    for (const index of [-1, 0.5, '0', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, first.pageCount])
      assert.throws(() => dotInputPage(input, index, project), { code: 'invalid_dot_input_page', status: 400 });
    assert.throws(() => dotInputPage(input, 0, () => ({ padding: 'x'.repeat(12_000) })), { code: 'dot_input_page_too_large' });
  });

  test(`transport ${version ?? 'legacy'} metadata, full get, claim and submit keep dual responses without paged reads`, async () => {
    const input = { prompt: '원문🙂"\\', history: [{ role: 'user', content: '이전\n발언' }] }, f = mailbox(input, version === undefined);
    assert.equal(f.prepared.inputTransportVersion, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(f.prepared)).history, input.history);
    input.history[0].content = 'caller changed';
    assert.equal(f.state().dotMcp.requests.items[0].history[0].content, '이전\n발언');
    assert.deepEqual(f.adapter.list().map(t => t.name), [...dotTools]);
    assert.deepEqual(Object.keys(f.adapter.list()[0].inputSchema.properties), ['requestId', 'attemptId', 'attemptToken', 'inputPage']);
    const metadata = await f.rpc('dot_turn_get', { requestId });
    assert.deepEqual(metadata, dual({ event, request: { requestId, status: 'waiting', receipt: null } }));
    const claimed = await f.rpc('dot_turn_claim', { requestId, commandId: 'claim' });
    assert.deepEqual(claimed, dual(JSON.parse(claimed.content[0].text)));
    const { attemptId, attemptToken } = claimed.structuredContent, attempt = { attemptId, attemptToken };
    assert.deepEqual(await f.rpc('dot_turn_claim', { requestId, commandId: 'claim' }), claimed);
    const full = await f.rpc('dot_turn_get', { requestId, ...attempt });
    assert.deepEqual(full, dual({ event, request: { requestId, status: 'waiting', receipt: null, prompt: input.prompt,
      history: [{ role: 'user', content: '이전\n발언' }], inputDigest: f.prepared.inputDigest, usage: null } }));
    const submission = { requestId, ...attempt, commandId: 'submit', text: '\n {"text":"합성 응답🙂"} \n' };
    const submitted = await f.rpc('dot_turn_submit', submission);
    assert.deepEqual(submitted, dual({ accepted: true, receipt: submitted.structuredContent.receipt, disposition: 'received' }));
    assert.deepEqual(await f.rpc('dot_turn_submit', submission), submitted);
    assert.equal(f.state().dotMcp.requests.items[0].reply.text, submission.text);
  });

  test(`transport ${version ?? 'legacy'} boundaries survive receipts, repeated reads and serialized restart without read writes`, async () => {
    const f = mailbox(syntheticInput(), version === undefined), attempt = f.call('dot_turn_claim', { requestId, commandId: 'claim' });
    const args = { requestId, ...attempt, inputPage: 0 }, first = f.call('dot_turn_get', args).request.input;
    assert.equal(first.transportVersion, version);
    const before = f.state(), writes = f.writes;
    for (let i = 0; i < 20; i++) assert.deepEqual(f.call('dot_turn_get', args).request.input, first);
    assert.equal(f.writes, writes); assert.deepEqual(f.state(), before);
    assert.throws(() => f.call('dot_turn_get', { requestId, inputPage: 0 }), { code: 'dot_attempt_not_in_scope' });
    assert.throws(() => f.call('dot_turn_get', { ...args, attemptToken: 'wrong' }), { code: 'dot_attempt_not_in_scope' });
    const rpc = await f.rpc('dot_turn_get', args);
    assert.deepEqual(JSON.parse(rpc.content[0].text).request.input, first);
    assert.equal(Object.hasOwn(rpc, 'structuredContent'), version !== 2);
    f.call('dot_turn_submit', { requestId, ...attempt, commandId: 'submit', text: 'synthetic reply' });
    assert.deepEqual(f.call('dot_turn_get', args).request.input, first, 'receipt/status changes cannot move boundaries');
    const persisted = JSON.parse(JSON.stringify(f.state())).dotMcp.requests.items[0];
    assert.equal(persisted.inputTransportVersion, version);
    assert.deepEqual(dotInputPage(persisted, 0, projection(persisted)), first);
    const reopened = new DotMcpAdapter(f.store, f.vault, f.authority, f.events, true, () => true);
    const recovered = f.state().dotMcp.requests.items[0];
    assert.equal(recovered.status, 'held'); assert.equal(recovered.inputTransportVersion, version);
    assert.deepEqual(dotInputPage(recovered, 0, projection(recovered)), first);
    assert.throws(() => reopened.call('dot_turn_get', { ...args, inputPage: 1 }, f.grant), { code: 'dot_request_stale' });
  });
}

test('stored request versions accept only missing or numeric 2 without backfilling legacy rows', () => {
  const state = mailbox().state(), request = state.dotMcp.requests.items[0];
  for (const version of [undefined, 2]) {
    if (version === undefined) delete request.inputTransportVersion; else request.inputTransportVersion = version;
    const before = structuredClone(state);
    assert.doesNotThrow(() => validateDotRequests(state)); assert.deepEqual(state, before);
  }
  for (const version of [0, 1, 3, -1, 2.5, '2', null, true, {}, [2]]) {
    request.inputTransportVersion = version;
    const persisted = JSON.parse(JSON.stringify(state));
    assert.throws(() => validateDotRequests(persisted), { code: 'dot_requests_state_invalid', status: 503 });
  }
});

function stoppedMailbox() {
  const f = mailbox();
  f.call('dot_turn_claim', { requestId, commandId: 'claim' });
  f.update(s => {
    const d = s.discussions[0], turn = d.turns[0], task = d.tasks[0], r = s.dotMcp.requests.items[0];
    d.status = 'blocked'; turn.status = task.status = 'unconfirmed'; r.status = 'held';
    s.resident.dispatchLeases[0].state = 'unconfirmed'; s.resident.rooms[0].desiredOn = false;
    turn.prompt = r.prompt = promptFor(d, task); turn.promptDigest = digest(r.prompt); r.inputDigest = dotInputDigest(r.prompt, r.history);
    s.dotMcp.grants[0].status = 'revoked';
  });
  return f.state();
}
const assertFailedSubmitRetry = s => assertDotRetryAfterFailedSubmit(s, s.discussions[0], s.discussions[0].turns[0]);

test('failed-submit retry requires the original grant to exist and be revoked; the guard never writes', () => {
  const state = stoppedMailbox(), before = structuredClone(state);
  assert.equal(state.dotMcp.requests.items[0].claim.status, 'active', 'revoked grant fences the original claim without a new claim enum');
  assert.doesNotThrow(() => assertFailedSubmitRetry(state)); assert.deepEqual(state, before);
  for (const status of ['active', 'prepared', 'missing', 'other_revoked']) {
    const invalid = structuredClone(state), original = invalid.dotMcp.grants[0];
    if (status === 'missing') invalid.dotMcp.grants = [];
    else {
      original.status = status === 'other_revoked' ? 'active' : status;
      original.expiresAt = '2000-01-01T00:00:00.000Z';
      if (status === 'other_revoked') invalid.dotMcp.grants.push({ ...original, id: 'other-grant', status: 'revoked' });
    }
    assert.doesNotThrow(() => assertDotRetryAfterStop(invalid, invalid.discussions[0], invalid.discussions[0].turns[0]));
    assert.throws(() => assertFailedSubmitRetry(invalid), error('dot_retry_prior_grant_not_revoked'));
  }
});

test('failed-submit retry retains the original reply, scope, latest-task, concurrency and frozen-input checks', () => {
  const state = stoppedMailbox();
  for (const [code, change] of [
    ['dot_retry_reply_exists', s => { s.dotMcp.requests.items[0].reply = { text: 'stored' }; }],
    ['dot_retry_reply_exists', s => { s.discussions[0].turns[0].reply = { text: 'stored' }; }],
    ['dot_retry_reply_exists', s => { s.discussions[0].turns[0].receipt = 'receipt'; }],
    ['dot_retry_reply_exists', s => { s.discussions[0].turns[0].text = 'stored'; }],
    ['dot_retry_scope_changed', s => { s.discussions[0].revision++; }],
    ['dot_retry_scope_changed', s => { s.discussions[0].contexts[0].generation++; }],
    ['dot_retry_scope_changed', s => { s.discussions[0].turns.push({ ...s.discussions[0].turns[0], id: 'newer', status: 'failed' }); }],
    ['reconciliation_required', s => { s.resident.dispatchLeases.push({ ...s.resident.dispatchLeases[0], id: 'competing', state: 'running' }); }],
    ['dot_retry_input_changed', s => { s.dotMcp.requests.items[0].prompt += 'changed'; }],
  ]) {
    const invalid = structuredClone(state); change(invalid);
    assert.throws(() => assertFailedSubmitRetry(invalid), error(code));
  }
});
