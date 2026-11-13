import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createMcpCallTrace } from '../scripts/mcp-call-trace.mjs';

const privateText = 'fixture-private-text-token-email@example.invalid';
const requestId = 'turn-fixture-never-expose-id';
const ref = createHash('sha256').update(requestId).digest('hex');
const request = (name, extra = {}) => ({ jsonrpc: '2.0', id: privateText, method: 'tools/call', params: { name,
  arguments: { requestId, attemptToken: privateText, commandId: privateText, text: privateText, ...extra } } });
const page = index => ({ request: { requestId, inputDigest: privateText,
  input: { pageIndex: index, pageCount: 3, nextPage: index === 2 ? null : index + 1, text: privateText } } });
const rpc = (value, structured = false) => ({ jsonrpc: '2.0', id: privateText, result: {
  content: [{ type: 'text', text: JSON.stringify(value) }], ...(structured ? { structuredContent: value } : {}) } });
function fixture() {
  const lines = [], sink = new EventEmitter(); let clock = 0;
  sink.write = line => { lines.push(line); return true; };
  const trace = createMcpCallTrace({ enabled: true, sink, clock: () => clock, wallClock: () => 1_800_000_000_000 + clock });
  return { lines, sink, trace, advance: () => { clock += 37; }, records: () => lines.map(JSON.parse) };
}

test('trace reads v1/v2 page metadata separately, hashes request IDs, and never copies input/output/credentials', () => {
  const f = fixture();
  for (const index of [0, 1, 2]) {
    const result = rpc(page(index), index === 1);
    const finish = f.trace(request('dot_turn_get', { inputPage: index }), 300); f.advance();
    finish({ httpStatus: 200, result, responseBytes: Buffer.byteLength(JSON.stringify(result)) });
    finish({ outcome: 'timeout' }); // No duplicate completion record.
  }
  const starts = f.records().filter(v => v.phase === 'start'), ends = f.records().filter(v => v.phase === 'end');
  assert.equal(starts.length, 3); assert.deepEqual(ends.map(v => v.pageIndex), [0, 1, 2]);
  assert.ok(ends.every(v => v.pageCount === 3 && v.durationMs === 37 && v.httpStatus === 200 && v.outcome === 'ok'));
  assert.ok(f.records().every(v => v.requestRef === ref && v.kind === 'page'));
  assert.ok(ends.every(v => v.responseBytes > 0));
  assert.ok(!f.lines.join('').includes(privateText)); assert.ok(!f.lines.join('').includes(requestId));
  assert.doesNotMatch(f.lines.join(''), /attemptToken|commandId|inputDigest|structuredContent|Bearer|receipt/);
  const allowed = new Set(['event', 'kind', 'startedAt', 'requestRef', 'requestBytes', 'inputPage', 'phase', 'finishedAt',
    'durationMs', 'outcome', 'httpStatus', 'responseBytes', 'pageIndex', 'pageCount', 'rpcCode', 'errorKind']);
  assert.ok(f.records().every(v => Object.keys(v).every(k => allowed.has(k))));
});

test('trace distinguishes metadata/claim/submit and allowlists RPC errors instead of logging arbitrary messages', () => {
  const f = fixture();
  f.trace(request('dot_turn_get', { requestId: undefined }), 100)({ result: rpc({ request: { requestId } }) });
  f.trace(request('dot_turn_claim'), 100)({ result: rpc({ attemptId: privateText, attemptToken: privateText }) });
  for (const message of ['dot_request_stale', privateText]) f.trace(request('dot_turn_submit'), 100)({
    httpStatus: 200, result: { error: { code: -32602, message, data: { privateText } } } });
  f.trace(request('dot_turn_submit'), 100)({ result: { error: { code: 55555, message: privateText } } });
  f.trace(request('dot_turn_submit'), 100)({ result: { result: { isError: true, content: [{ type: 'text', text: privateText }] } } });
  const ends = f.records().filter(v => v.phase === 'end');
  assert.deepEqual(ends.map(v => v.kind), ['metadata', 'claim', 'submit', 'submit', 'submit', 'submit']);
  assert.equal(ends[0].requestRef, ref);
  assert.deepEqual(ends.slice(2, 5).map(v => [v.outcome, v.rpcCode, v.errorKind]), [
    ['rpc_error', -32602, 'dot_request_stale'], ['rpc_error', -32602, 'other'], ['rpc_error', null, 'other']]);
  assert.equal(ends[5].outcome, 'tool_error'); assert.ok(!f.lines.join('').includes(privateText));
});

test('trace tolerates missing/malformed response metadata and rejects unsafe counts or arbitrary outcomes', () => {
  const f = fixture();
  for (const result of [null, {}, { result: { content: [{ type: 'text', text: privateText }] } }, { result: { content: { find: 1 } } }, rpc(null),
    rpc({ request: { input: { pageIndex: -1, pageCount: '3' } } }), rpc({ request: { input: { pageIndex: 0.1, pageCount: Infinity } } })]) {
    f.trace(request('dot_turn_get', { inputPage: NaN, requestId: privateText.repeat(100) }), -1)({ outcome: privateText, httpStatus: Infinity, responseBytes: -1, result });
  }
  assert.equal(f.records().filter(v => v.phase === 'end').length, 7);
  for (const end of f.records().filter(v => v.phase === 'end')) {
    for (const key of ['requestRef', 'requestBytes', 'inputPage', 'pageIndex', 'pageCount', 'httpStatus', 'responseBytes']) assert.equal(end[key], null);
    assert.equal(end.outcome, 'bridge_error');
  }
  assert.ok(!f.lines.join('').includes(privateText));
});

test('trace is silent by default, and synchronous/asynchronous logging failures or backpressure never throw', () => {
  const sink = new EventEmitter(); let writes = 0; sink.write = () => { writes++; throw Error(privateText); };
  createMcpCallTrace({ sink })(request('dot_turn_submit'), 100)({}); assert.equal(writes, 0);
  const broken = createMcpCallTrace({ enabled: true, sink });
  assert.doesNotThrow(() => broken(request('dot_turn_submit'), 100)({})); assert.equal(writes, 1);
  assert.doesNotThrow(() => sink.emit('error', Error(privateText)));
  assert.doesNotThrow(() => broken(request('dot_turn_submit'), 100)({})); assert.equal(writes, 1);
  const f = fixture(); f.sink.writableLength = 65_537;
  f.trace(request('dot_turn_get'), 100)({}); assert.equal(f.lines.length, 0);
  f.sink.writableLength = 0; f.trace(request('dot_turn_get'), 100)({}); assert.equal(f.lines.length, 2);
  const hostile = { get method() { throw Error(privateText); } };
  assert.doesNotThrow(() => f.trace(hostile, 100)({}));
});
