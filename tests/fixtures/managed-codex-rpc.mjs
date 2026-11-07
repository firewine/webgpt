import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Synthetic protocol only: persistence lives outside the protected repository.
const [mode = 'normal', stateDir] = process.argv.slice(2);
const metadata = join(stateDir, 'thread.json'), trace = join(stateDir, 'rpc-trace.jsonl');
let saved = existsSync(metadata) ? JSON.parse(readFileSync(metadata, 'utf8')) : null;
let thread = saved?.thread ?? null, count = saved?.count ?? 0, current = null;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const event = (method, params) => output({ method, params: { threadId: thread.id, ...params } });
const persist = turn => { saved = { thread, count, turn }; writeFileSync(metadata, JSON.stringify(saved)); };
function finish(status = 'completed') {
  if (!current) return;
  const turn = { ...current, status, items: [
    { id: 'command-' + count, type: 'commandExecution', status: 'completed', command: 'synthetic content check', exitCode: 0, aggregatedOutput: 'fixture only' },
    { id: 'message-' + count, type: 'agentMessage', text: 'Synthetic managed-session result; no model or command was run.' },
  ] };
  current = null; persist(turn); event('turn/completed', { turn });
}
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line); appendFileSync(trace, JSON.stringify({ ...m, pid: process.pid }) + '\n');
  if (!m.method) { if (m.id === 'managed-approval' && !(mode === 'scoped-hold' && m.result?.decision === 'accept')) finish(m.result?.decision === 'accept' ? 'completed' : 'interrupted'); continue; }
  let result = {}, error;
  if (m.method === 'initialize') result = { userAgent: 'synthetic-managed-codex' };
  else if (m.method === 'permissionProfile/list') result = { data: ['webjjoku_read', 'webjjoku_copy'].map(id => ({ id, allowed: true })) };
  else if (m.method === 'thread/start') {
    if (thread) error = 'thread already created';
    else { thread = { id: 'managed-fixture-thread', cwd: m.params.cwd, sessionId: 'managed-fixture-tree', status: { type: 'idle' } }; result = { thread }; }
  } else if (['thread/read', 'thread/resume', 'turn/start'].includes(m.method)) {
    if (!thread || m.params.threadId !== thread.id) error = 'thread not loaded';
    else if (m.method === 'thread/resume' && !saved) error = 'no rollout found for thread id';
    else if (m.method !== 'turn/start') result = { thread: { ...thread, status: { type: current ? 'active' : 'idle' } } };
    else {
      current = { id: 'managed-turn-' + ++count, status: 'inProgress', startedAt: Math.floor(Date.now() / 1000), items: [] };
      persist(current); result = { turn: current };
      setTimeout(() => {
        if (!current) return; event('turn/started', { turn: current });
        if (mode === 'scoped-approval' || mode === 'scoped-hold') output({ id: 'managed-approval', method: 'item/commandExecution/requestApproval', params: { kind: 'command', threadId: thread.id, turnId: current.id, itemId: 'command-' + count, environmentId: 'local', command: "/bin/bash -c 'cat source.txt'", cwd: thread.cwd, commandActions: [{ type: 'read', command: 'cat source.txt', name: 'source.txt', path: join(thread.cwd, 'source.txt') }], proposedExecpolicyAmendment: ['cat', 'source.txt'], availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['cat', 'source.txt'] } }, 'cancel'] } });
        else if (mode === 'approval') output({ id: 'managed-approval', method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId: current.id, command: 'synthetic content check' } });
        else if (mode !== 'hold') finish();
      }, 20);
    }
  } else if (m.method === 'fixture/complete' || m.method === 'turn/interrupt') setTimeout(() => finish(m.method === 'turn/interrupt' ? 'interrupted' : 'completed'), 5);
  else if (m.method === 'thread/turns/list') result = { data: saved?.turn ? [saved.turn] : [], nextCursor: null };
  else if (m.method === 'turn/steer') result = { turnId: current?.id };
  else if (m.method !== 'initialized') error = 'unsupported synthetic method';
  if (m.id !== undefined) output(error ? { id: m.id, error: { code: -32000, message: error } } : { id: m.id, result });
}
