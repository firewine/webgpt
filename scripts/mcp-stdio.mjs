import { createInterface } from 'node:readline';
import { readGrant, readDotPreflight } from './dot-preflight.mjs';
const MAX_REQUEST_BYTES = 256_000;
const MAX_INSPECTION_BYTES = 4 * MAX_REQUEST_BYTES;
const writeError = (id, code = -32603, message = 'MCP request not confirmed; inspect the durable workspace before retrying.') =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
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
    input.close(); process.stdin.destroy(); process.exitCode = 1; break;
  }
  if (!line.trim()) continue; let message;
  try { message = JSON.parse(line); }
  catch { writeError(null, -32700, 'Parse error'); continue; }
  try {
    if (bytes > MAX_REQUEST_BYTES) throw new Error();
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: line, signal: AbortSignal.timeout(25000) });
    if (response.status === 202) continue; if (!response.ok) throw new Error(); const result = await response.json(); process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    if (message?.jsonrpc === '2.0' && typeof message.method === 'string' && !Object.hasOwn(message, 'id')) continue;
    const id = typeof message?.id === 'string' || Number.isInteger(message?.id) ? message.id : null;
    writeError(id);
  }
}
