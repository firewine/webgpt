import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { isAbsolute } from 'node:path';
import type { Socket } from 'node:net';

// This fixture only speaks HTTP on loopback; it never executes or forwards a command.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REQUESTS = 8;
const CALL_ID = 'call_approval_fixture';
type JsonObject = Record<string, unknown>;
type CommandTool = { name: string; namespace?: string; arguments: string };
export type ApprovalResponses = { baseUrl: string; requests: JsonObject[]; close(): Promise<void> };

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function commandTool(tools: unknown, command: string, cwd: string, requestEscalation = false): CommandTool {
  if (!Array.isArray(tools)) throw new Error('unsupported_tools');
  const candidates: { tool: JsonObject; namespace?: string }[] = [];
  for (const entry of tools) {
    if (!object(entry)) throw new Error('unsupported_tools');
    const namespace = entry.type === 'namespace' ? entry.name : undefined;
    const entries = entry.type === 'namespace' ? entry.tools : [entry];
    if (!Array.isArray(entries) || (entry.type === 'namespace' &&
      (typeof namespace !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(namespace)))) throw new Error('unsupported_tools');
    for (const tool of entries) {
      if (!object(tool)) throw new Error('unsupported_tools');
      if (tool.name === 'exec_command' || tool.name === 'shell_command') {
        candidates.push({ tool, ...(typeof namespace === 'string' ? { namespace } : {}) });
      }
    }
  }
  const preferred = candidates.filter(({ tool }) => tool.name === 'exec_command');
  const choices = preferred.length ? preferred : candidates;
  if (choices.length !== 1) throw new Error('unsupported_command_tool');
  const selected = choices[0]!;
  const { tool } = selected;
  const args: JsonObject = tool.name === 'exec_command'
    ? { cmd: command, workdir: cwd, yield_time_ms: 1000, max_output_tokens: 2000 }
    : { command, workdir: cwd };
  if (requestEscalation) Object.assign(args, { sandbox_permissions: 'require_escalated', justification: 'Synthetic containment probe only.' });
  const schema = tool.parameters;
  if (tool.type !== 'function' || tool.namespace !== undefined || tool.defer_loading === true ||
    (tool.strict !== undefined && typeof tool.strict !== 'boolean') || !object(schema) ||
    schema.type !== 'object' || !object(schema.properties) ||
    Object.keys(schema).some(key => !['type', 'properties', 'required', 'additionalProperties', 'description', 'title'].includes(key)) ||
    (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') ||
    !Array.isArray(schema.required) || !schema.required.includes(tool.name === 'exec_command' ? 'cmd' : 'command') ||
    schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(args, key))) throw new Error('unsupported_command_schema');
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    // Adversarial proof exercises the native parser even if the catalog hides
    // its known escalation fields. These two fixed values are not user input.
    if (requestEscalation && ['sandbox_permissions', 'justification'].includes(key) && property === undefined) continue;
    if (!object(property) || Object.keys(property).some(name => !['type', 'description', 'title', 'enum'].includes(name)) ||
      property.enum !== undefined && (!Array.isArray(property.enum) || !property.enum.includes(value)) ||
      (property.type !== typeof value && !(property.type === 'integer' && typeof value === 'number'))) {
      throw new Error('unsupported_command_schema');
    }
  }
  return { name: String(tool.name), ...(selected.namespace ? { namespace: selected.namespace } : {}), arguments: JSON.stringify(args) };
}

function reject(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
  response.end(JSON.stringify({ error: { code } }));
}

// Same minimal SSE events as the pinned native Codex test helpers:
// https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/tests/common/responses.rs
function stream(response: ServerResponse, id: string, item: JsonObject): void {
  const events = [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id, usage: {
      input_tokens: 0, input_tokens_details: null, output_tokens: 0, output_tokens_details: null, total_tokens: 0,
    } } },
  ];
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}

/** One declared command call, then a terminal message. No model, auth, disk or outbound I/O. */
export async function startApprovalResponses(options: { command: string; cwd: string; requestEscalation?: boolean }): Promise<ApprovalResponses> {
  if (!object(options) || Object.keys(options).some(key => !['command', 'cwd', 'requestEscalation'].includes(key)) ||
    options.requestEscalation !== undefined && typeof options.requestEscalation !== 'boolean' ||
    typeof options.command !== 'string' || !options.command.trim() || options.command.includes('\0') ||
    Buffer.byteLength(options.command) > 65_536 || typeof options.cwd !== 'string' ||
    !isAbsolute(options.cwd) || options.cwd.includes('\0') || Buffer.byteLength(options.cwd) > 4096) {
    throw new Error('invalid_approval_responses_config');
  }
  const { command, cwd } = options;
  const requests: JsonObject[] = [];
  const sockets = new Set<Socket>();
  let requestCount = 0;
  let responseCount = 0;
  let issued: CommandTool | undefined;
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    request.on('error', () => response.destroy());
    request.setTimeout(5000, () => request.destroy());
    if (++requestCount > MAX_REQUESTS || responseCount === 2) { reject(response, 429, 'fixture_exhausted'); return; }
    if (request.url !== '/responses' && request.url !== '/v1/responses') { reject(response, 404, 'unknown_route'); return; }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); reject(response, 405, 'method_not_allowed'); return; }
    if (request.headers['content-encoding'] !== undefined && request.headers['content-encoding'] !== 'identity') {
      reject(response, 415, 'unsupported_content_encoding'); return;
    }
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      reject(response, 413, 'body_too_large'); return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let oversized = false;
    request.on('data', (chunk: Buffer) => {
      if (oversized) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        oversized = true; chunks.length = 0; reject(response, 413, 'body_too_large'); return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (oversized || response.destroyed) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
      catch { reject(response, 400, 'invalid_json'); return; }
      if (!object(body)) { reject(response, 400, 'invalid_request'); return; }
      requests.push(body);
      if (body.stream !== true || !Array.isArray(body.input) ||
        (body.tool_choice !== undefined && body.tool_choice !== 'auto')) {
        reject(response, 400, 'unsupported_request_config'); return;
      }
      let selected: CommandTool;
      try { selected = commandTool(body.tools, command, cwd, options.requestEscalation === true); }
      catch (error) { reject(response, 400, error instanceof Error ? error.message : 'unsupported_tools'); return; }
      // Check again after reading the body so concurrent requests cannot replay the call.
      if (responseCount === 2) { reject(response, 429, 'fixture_exhausted'); return; }
      if (issued) {
        if (JSON.stringify(selected) !== JSON.stringify(issued) || !body.input.some(item =>
          object(item) && item.type === 'function_call_output' && item.call_id === CALL_ID &&
          (typeof item.output === 'string' || Array.isArray(item.output)))) {
          reject(response, 400, 'expected_command_output'); return;
        }
        responseCount++;
        stream(response, 'resp_approval_fixture_2', { type: 'message', role: 'assistant', id: 'msg_approval_fixture',
          content: [{ type: 'output_text', text: 'Fixture complete.' }] });
      } else {
        issued = selected; responseCount++;
        stream(response, 'resp_approval_fixture_1', { type: 'function_call', call_id: CALL_ID, ...selected });
      }
    });
  });
  server.maxConnections = MAX_REQUESTS;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('fixture_not_listening'); }
  let closing: Promise<void> | undefined;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close() {
      closing ??= new Promise<void>((resolve, rejectClose) => {
        server.close(error => error ? rejectClose(error) : resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}
