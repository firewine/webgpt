import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';

const noop = () => {};
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const reference = value => typeof value === 'string' && value.length > 0 && value.length <= 200
  ? createHash('sha256').update(value).digest('hex') : null;
const rpcCodes = new Set([-32700, -32600, -32601, -32602, -32603, -32015]);
const errorKinds = new Set(['invalid_work_fields', 'invalid_dot_input_page', 'dot_request_stale', 'dot_request_not_in_scope',
  'dot_attempt_not_in_scope', 'dot_tool_not_granted', 'dot_already_claimed', 'dot_claim_requires_reconciliation',
  'dot_claim_storage_failed', 'dot_reply_conflict', 'dot_input_page_too_large', 'idempotency_conflict', 'mcp_authentication_required']);
const outcomes = new Set(['ok', 'rpc_error', 'tool_error', 'notification', 'http_error', 'transport_error', 'timeout',
  'invalid_json', 'parse_error', 'request_too_large', 'inspection_limit', 'bridge_error']);

function category(message) {
  if (message?.method !== 'tools/call') return 'metadata';
  switch (message.params?.name) {
    case 'dot_turn_get': return message.params.arguments?.inputPage !== undefined ? 'page' : 'metadata';
    case 'dot_turn_claim': return 'claim';
    case 'dot_turn_submit': return 'submit';
    default: return 'other';
  }
}
function toolValue(result) {
  try {
    if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
    const text = Array.isArray(result?.content) ? result.content.find(item => item?.type === 'text')?.text : null;
    // Diagnostics must not parse another unbounded copy of a legacy full input.
    if (typeof text !== 'string' || text.length > 256_000) return null;
    return JSON.parse(text);
  } catch { return null; }
}

// No raw object/string spreading: only these projected fields can reach stderr.
// Delivery is best-effort and never awaited; a broken/full diagnostic pipe must
// not change MCP stdout, perform another call, or create an unbounded log queue.
export function createMcpCallTrace({ enabled = false, sink, clock = () => performance.now(), wallClock = Date.now } = {}) {
  if (!enabled) return () => noop;
  if (!sink) {
    // Accessing Node's stderr initializes its nonblocking POSIX pipe. Write a
    // bounded record directly: EAGAIN drops logging instead of queuing writes
    // that would keep a finished bridge alive while the reader is stalled.
    try {
      const fd = process.stderr.fd;
      sink = { write: line => writeSync(fd, line) };
    } catch { return () => noop; }
  }
  let failed = false;
  try { sink.on?.('error', () => { failed = true; }); } catch { failed = true; }
  const emit = record => {
    if (failed || sink.destroyed || sink.writableLength > 65_536) return;
    try {
      const line = JSON.stringify({ event: 'mcp.call_observation', ...record }) + '\n';
      const written = sink.write(line);
      if (typeof written === 'number' && written !== Buffer.byteLength(line)) failed = true;
    }
    catch { failed = true; }
  };
  return (message, requestBytes) => {
    try {
      const startedAt = new Date(wallClock()).toISOString(), start = clock(), kind = category(message);
      const isDot = message?.method === 'tools/call' && ['dot_turn_get', 'dot_turn_claim', 'dot_turn_submit'].includes(message.params?.name);
      const args = isDot ? message.params.arguments : null;
      const base = { kind, startedAt, requestRef: reference(args?.requestId), requestBytes: integer(requestBytes),
        inputPage: kind === 'page' ? integer(args?.inputPage) : null };
      emit({ ...base, phase: 'start' });
      let finished = false;
      return ({ outcome = 'ok', httpStatus, result, responseBytes } = {}) => {
        if (finished) return; finished = true;
        try {
          const value = isDot ? toolValue(result?.result) : null;
          const input = kind === 'page' ? value?.request?.input : null;
          const error = result?.error;
          const status = error ? 'rpc_error' : result?.result?.isError === true ? 'tool_error' : outcome;
          emit({ ...base, phase: 'end', requestRef: base.requestRef ?? reference(value?.request?.requestId),
            finishedAt: new Date(wallClock()).toISOString(), durationMs: integer(Math.round(Math.max(0, clock() - start))),
            outcome: outcomes.has(status) ? status : 'bridge_error', httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
            responseBytes: integer(responseBytes), pageIndex: integer(input?.pageIndex), pageCount: integer(input?.pageCount),
            rpcCode: rpcCodes.has(error?.code) ? error.code : null,
            errorKind: error ? errorKinds.has(error.message) ? error.message : 'other' : null });
        } catch { /* Diagnostic decoding must not affect the protocol response. */ }
      };
    } catch { return noop; }
  };
}
