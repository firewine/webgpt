import { createInterface } from 'node:readline';
import { readFile, stat } from 'node:fs/promises';
const path = process.env.WJ_MCP_GRANT_FILE;
if (!path?.startsWith('/')) throw new Error('WJ_MCP_GRANT_FILE must name a private absolute file.');
const info = await stat(path); if ((info.mode & 0o077) !== 0) throw new Error('Grant file must be private (0600).');
const token = (await readFile(path, 'utf8')).trim(); if (token.length < 32) throw new Error('Invalid grant file.');
const port = Number(process.env.WJ_PORT ?? '3000'); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue; let message;
  try {
    if (Buffer.byteLength(line) > 256_000) throw new Error(); message = JSON.parse(line);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: line, signal: AbortSignal.timeout(25000) });
    if (response.status === 202) continue; if (!response.ok) throw new Error(); const result = await response.json(); process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { if (message?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'MCP request not confirmed; inspect the durable workspace before retrying.' } })}\n`); }
}
