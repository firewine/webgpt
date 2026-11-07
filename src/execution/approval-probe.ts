import { RpcProcess } from '../connections/rpc.js';
import { isolationEnvironment } from './outer-bwrap.js';
import { startApprovalResponses } from './approval-responses.js';

/** Native CLI proof with a loopback fake provider; never receives user credentials. */
export async function proveApprovedCommand(input: {
  command: string; cwd: string; profile: string;
  requestEscalation?: boolean;
  launch(baseUrl: string): string[];
}): Promise<{ approvals: number; exitCode: number; output: string }> {
  const fixture = await startApprovalResponses({ command: input.command, cwd: input.cwd, ...(input.requestEscalation ? { requestEscalation: true } : {}) });
  const rpc = new RpcProcess(input.launch(fixture.baseUrl), input.cwd, false, isolationEnvironment());
  let approvals = 0, threadId = '', turnId = '', itemId = '', output = '', exitCode: number | null = null;
  let resolve!: () => void, reject!: (error: Error) => void;
  const done = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  void done.catch(() => {});
  const fail = (reason: string) => reject(new Error('approval_probe_' + reason));
  const timer = setTimeout(() => fail('timeout'), 20000);
  rpc.onClose = () => fail('disconnected');
  rpc.onRequest = (id, method, params) => {
    if (method !== 'item/commandExecution/requestApproval' || approvals || params.kind !== 'command' ||
        params.threadId !== threadId || params.turnId !== turnId || params.cwd !== input.cwd ||
        typeof params.itemId !== 'string' || !Array.isArray(params.availableDecisions) || !params.availableDecisions.includes('accept')) {
      rpc.respond(id, { decision: 'cancel' }); fail('unexpected_approval'); return;
    }
    approvals++; itemId = params.itemId; rpc.respond(id, { decision: 'accept' });
  };
  rpc.onNotification = (method, params) => {
    if (params.threadId !== threadId) return;
    const item = params.item as Record<string, unknown> | undefined;
    if (method === 'item/completed' && item?.type === 'commandExecution' && item.id === itemId) {
      output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '';
      exitCode = typeof item.exitCode === 'number' ? item.exitCode : null;
    }
    const turn = params.turn as Record<string, unknown> | undefined;
    if (method === 'turn/completed' && turn?.id === turnId) {
      if (turn.status !== 'completed') fail('turn_not_completed'); else resolve();
    }
  };
  try {
    await rpc.request('initialize', { clientInfo: { name: 'webjjoku_approval_probe', title: 'Synthetic approval proof', version: '0.2.0' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized');
    const permission = { permissions: input.profile, approvalPolicy: 'untrusted', approvalsReviewer: 'user', model: 'gpt-5.4' };
    const started = await rpc.request('thread/start', { cwd: input.cwd, ephemeral: true, ...permission }) as { thread: { id: string } };
    threadId = started.thread.id;
    const startedTurn = await rpc.request('turn/start', { threadId, ...permission, input: [{ type: 'text', text: 'Local synthetic approval canary only.' }] }) as { turn: { id: string } };
    turnId = startedTurn.turn.id;
    await done;
    if (approvals !== 1 || exitCode !== 0) throw Object.assign(new Error(`approval_probe_command_failed_${exitCode}`), { cause: new Error(output.slice(-4000)) });
    return { approvals, exitCode, output };
  } finally {
    clearTimeout(timer); rpc.close(); await fixture.close();
  }
}

export function approvalProviderConfig(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash) throw new Error('approval_probe_loopback_required');
  return ['model_provider="webjjoku_probe"', 'model="gpt-5.4"',
    `model_providers={webjjoku_probe={name="Local synthetic proof",base_url=${JSON.stringify(baseUrl)},wire_api="responses",requires_openai_auth=false,supports_websockets=false,request_max_retries=0,stream_max_retries=0,stream_idle_timeout_ms=10000}}`]
    .flatMap(value => ['-c', value]);
}
