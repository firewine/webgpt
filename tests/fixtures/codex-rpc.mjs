import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
const mode = process.argv[2] ?? 'normal'; let current = null; let count = 0; const completed = [];
const persist = process.argv[3] === 'persist'; let originalInput = []; let startedAt = 0;
if (persist && existsSync('remote-state.json')) count = JSON.parse(readFileSync('remote-state.json', 'utf8')).count;
const output = object => process.stdout.write(`${JSON.stringify(object)}\n`);
const event = (method, params) => output({ method, params: { threadId: 'fixture-thread', ...params } });
const thread = () => ({ id: 'fixture-thread', cwd: mode === 'wrong-cwd' ? '/' : process.cwd(), sessionId: 'fixture-tree', status: { type: current ? 'active' : 'idle' } });
function finish(status = 'completed') { if (!current) return; const turn = { id: current, status, startedAt, items: [
  ...(mode === 'work-empty' ? [] : [{ id: `command-${count}`, type: 'commandExecution', status: 'completed', command: 'fixture only', ...(mode === 'work-unknown' ? {} : { exitCode: mode === 'work-fail' ? 1 : 0 }), aggregatedOutput: '검사 기록' }]),
  ...(mode === 'work-file-change' ? [{ id: 'file-change-fixture', type: 'fileChange', status: 'completed', changes: [{ path: 'fixture-only.txt', diff: 'fixture only; no file was changed' }] }] : []),
  { id: `message-${count}`, type: 'agentMessage', text: '실제 실행을 하지 않은 RPC fixture 결과' }, ...(persist ? [{ id: 'original-input', type: 'userMessage', content: originalInput }] : [])] };
  completed.push(turn); if (persist) writeFileSync('remote-result.json', JSON.stringify(turn)); current = null; event('turn/completed', { turn }); }
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line); appendFileSync('rpc-trace.jsonl', `${JSON.stringify({ ...m, environment: { WJ_ACCESS_TOKEN: process.env.WJ_ACCESS_TOKEN ?? null } })}\n`);
  if (!m.method) { if (mode === 'approval') { if (m.id !== '017') process.exit(12); finish(m.result.decision === 'cancel' ? 'interrupted' : 'completed'); } continue; }
  let result = {};
  if (m.method === 'initialize') result = { userAgent: 'codex-fixture/0.165.0' };
  else if (m.method === 'thread/read' || m.method === 'thread/resume') result = { thread: thread() };
  else if (m.method === 'turn/start') {
    originalInput = m.params.input; startedAt = Math.floor(Date.now() / 1000);
    current = `turn-${++count}`; result = { turn: { id: current, status: 'inProgress' } }; if (mode !== 'missing-receipt') event('turn/started', { turn: result.turn });
    if (persist) { writeFileSync('remote-state.json', JSON.stringify({ count })); writeFileSync('remote-result.json', JSON.stringify({ id: current, status: 'inProgress', startedAt, items: [{ id: 'original-input', type: 'userMessage', content: originalInput }] })); }
    if (['disconnect', 'missing-receipt'].includes(mode)) { writeFileSync('remote-result.json', JSON.stringify({ id: current, status: 'completed', startedAt: Math.floor(Date.now() / 1000), items: [{ id: 'user-input', type: 'userMessage', content: m.params.input }, { id: 'observed', type: 'agentMessage', text: '이전 실행의 관측 결과' }] })); if (mode === 'disconnect') output({ id: m.id, result }); setTimeout(() => process.exit(0), 15); continue; }
    if (mode === 'approval') setTimeout(() => output({ id: '017', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture-thread', turnId: current, command: 'fixture-command' } }), 15);
    else if (mode !== 'hold') setTimeout(() => finish(), mode === 'work-delayed' ? 200 : 40);
  } else if (m.method === 'turn/steer') { if (m.params.expectedTurnId !== current) { output({ id: m.id, error: { code: -32000, message: 'wrong turn' } }); continue; } result = { turnId: current }; }
  else if (m.method === 'turn/interrupt') { output({ id: m.id, result: {} }); setTimeout(() => finish('interrupted'), 20); continue; }
  else if (m.method === 'thread/turns/list') result = { data: existsSync('remote-result.json') ? [JSON.parse(readFileSync('remote-result.json'))] : completed, nextCursor: null };
  if (m.id !== undefined) output({ id: m.id, result });
}
