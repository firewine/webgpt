import { createInterface } from 'node:readline';
import { readGrant, readDotPreflight } from './dot-preflight.mjs';
import { createMcpCallTrace } from './mcp-call-trace.mjs';
const MAX_REQUEST_BYTES = 256_000;
const MAX_INSPECTION_BYTES = 4 * MAX_REQUEST_BYTES;
const writeError = (id, code = -32603, message = 'MCP request not confirmed; inspect the durable workspace before retrying.') =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
const trace = createMcpCallTrace({ enabled: process.env.WJ_MCP_TRACE === 'summary' });
const path = process.env.WJ_MCP_GRANT_FILE;
if (!path?.startsWith('/')) throw new Error('WJ_MCP_GRANT_FILE must name a private absolute file.');
const token = await readGrant(path);
const port = Number(process.env.WJ_PORT ?? '3000'); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
if (process.env.WJ_MCP_EXPECT_DOT === 'true') {
  const report = await readDotPreflight();
  if (report.mcp.status !== 'OBSERVED' || !report.mcp.eventsAdvertised || !report.mcp.eventCatalogAvailable || !report.mcp.turnToolsAvailable) throw new Error('Native dot MCP metadata/authentication not confirmed. No forwarding started.');
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  const bytes = line.length > MAX_INSPECTION_BYTES ? MAX_INSPECTION_BYTES + 1 : Buffer.byteLength(line);
  // Bound JSON inspection separately from forwarding. Beyond this budget, close
  // so callers observe a disconnect without replying to a possible notification.
  if (bytes > MAX_INSPECTION_BYTES) {
    trace(null, null)({ outcome: 'inspection_limit' });
    input.close(); process.stdin.destroy(); process.exitCode = 1; break;
  }
  if (!line.trim()) continue; let message;
  try { message = JSON.parse(line); }
  catch { trace(null, bytes)({ outcome: 'parse_error' }); writeError(null, -32700, 'Parse error'); continue; }
  const finish = trace(message, bytes); let signal, httpStatus, outcome = 'transport_error';
  try {
    if (bytes > MAX_REQUEST_BYTES) { outcome = 'request_too_large'; throw new Error(); }
    signal = AbortSignal.timeout(25000);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: line, signal });
    httpStatus = response.status;
    if (httpStatus === 202) { finish({ outcome: 'notification', httpStatus }); continue; }
    if (!response.ok) { outcome = 'http_error'; throw new Error(); }
    outcome = 'invalid_json'; const result = await response.json(); const text = JSON.stringify(result);
    outcome = 'bridge_error';
    process.stdout.write(`${text}\n`);
    finish({ outcome: 'ok', httpStatus, result, responseBytes: Buffer.byteLength(text) });
  } catch (error) {
    finish({ outcome: error?.name === 'TimeoutError' || signal?.reason?.name === 'TimeoutError' ? 'timeout' : outcome, httpStatus });
    if (message?.jsonrpc === '2.0' && typeof message.method === 'string' && !Object.hasOwn(message, 'id')) continue;
    const id = typeof message?.id === 'string' || Number.isInteger(message?.id) ? message.id : null;
    writeError(id);
  }
}
