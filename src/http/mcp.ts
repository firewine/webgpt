import { randomBytes } from 'node:crypto';
import type { Workspace } from '../workspace/runtime.js';
import type { WorkspaceState } from '../workspace/model.js';
import { AppError, digest, id, now, object, string, strings } from '../workspace/util.js';
import { findDiscussion } from '../workspace/engine.js';
import { promptFor } from '../workspace/prompts.js';
import type { ResidentGrant } from '../workspace/wiki-model.js';
import { residentSchemas, residentDescriptions } from '../workspace/resident-mcp.js';
const TOOLS = ['task_get', 'context_get', 'result_submit', 'capabilities_get', 'codex_send', 'codex_status', 'codex_result', 'codex_cancel'] as const;
type Grant = WorkspaceState['grants'][number];
const residentGrant = (g: Grant | ResidentGrant): g is ResidentGrant => 'kind' in g && g.kind === 'resident';
export class McpEndpoint {
  constructor(private readonly app: Workspace) {}
  createGrant(input: unknown): { id: string; token: string } {
    const body = object(input); const allowed = [...new Set(strings(body.tools, TOOLS.length))];
    if (!allowed.length || allowed.some(t => !(TOOLS as readonly string[]).includes(t))) throw new AppError('invalid_tools');
    const token = randomBytes(32).toString('base64url'); const grantId = id('grant');
    this.app.store.transact((state, emit) => {
      const d = findDiscussion(state, string(body.discussionId)); const pid = string(body.participantId);
      if (!d.members.some(p => p.id === pid)) throw new AppError('participant_not_found', 404);
      if (allowed.some(t => t.startsWith('codex_')) && !d.executionBindingId) throw new AppError('execution_binding_required', 409);
      state.grants.push({ id: grantId, hash: digest(token), discussionId: d.id, participantId: pid, tools: allowed, revoked: false });
      emit({ type: 'mcp.granted', discussionId: d.id, data: { grantId, participantId: pid, tools: allowed } });
    }); return { id: grantId, token };
  }
  grant(header: string | undefined): Grant | ResidentGrant {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const grant = this.app.store.read().grants.find(g => !g.revoked && g.hash === digest(token));
    if (!grant) { if (this.app.residentMcp) return this.app.residentMcp.authenticate(token); throw new AppError('mcp_authentication_required', 401); } return grant;
  }
  async handle(raw: unknown, grant: Grant | ResidentGrant): Promise<unknown | null> {
    if (residentGrant(grant)) this.app.residentMcp.check(grant);
    const message = object(raw); const requestId = message.id;
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new AppError('invalid_jsonrpc');
    if (requestId === undefined) { if (message.method === 'notifications/initialized') return null; throw new AppError('unknown_notification'); }
    if (typeof requestId !== 'number' && typeof requestId !== 'string') throw new AppError('invalid_jsonrpc_id');
    let result: unknown;
    if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'webjjoku', version: '0.2.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: grant.tools.map(name => ({ name, description: (residentGrant(grant) ? residentDescriptions[name] : descriptions[name]) ?? name,
      inputSchema: (residentGrant(grant) ? residentSchemas[name] : schemas[name]) ?? { type: 'object', properties: {}, additionalProperties: false } })) };
    else if (message.method === 'tools/call') {
      const params = object(message.params); const name = string(params.name);
      if (!grant.tools.includes(name)) return { jsonrpc: '2.0', id: requestId, error: { code: -32602, message: 'Tool not granted' } };
      try {
        const value = residentGrant(grant) ? this.app.residentMcp.call(name, object(params.arguments ?? {}), grant) : await this.call(name, object(params.arguments ?? {}), grant);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: !!(residentGrant(grant) && value && typeof value === 'object' && 'status' in value && value.status === 'conflict') };
      } catch (error) { result = { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof AppError ? error.code : 'tool_failed' }) }], isError: true }; }
    } else return { jsonrpc: '2.0', id: requestId, error: { code: -32601, message: 'Method not supported' } };
    return { jsonrpc: '2.0', id: requestId, result };
  }
  private async call(name: string, args: Record<string, unknown>, grant: Grant): Promise<unknown> {
    const state = this.app.store.read(); const d = findDiscussion(state, grant.discussionId);
    if (name === 'capabilities_get') {
      const report = await this.app.capabilities(grant);
      if (!this.app.store.read().grants.some(g => g.id === grant.id && !g.revoked && g.hash === grant.hash)) throw new AppError('mcp_authentication_required', 401);
      return report;
    }
    if (name === 'codex_status' || name === 'codex_result' || name === 'codex_cancel') {
      const job = state.jobs.find(j => j.id === args.jobId && j.discussionId === d.id && d.tasks.some(t => t.id === j.taskId && t.participantId === grant.participantId));
      if (!job) throw new AppError('job_not_in_scope', 403);
      if (name === 'codex_cancel') { await this.app.codex.cancel(job.id); return { jobId: job.id, cancellationRequested: true }; }
      return job;
    }
    const task = d.tasks.find(t => (args.taskId ? t.id === args.taskId : ['pending', 'running'].includes(t.status)) && t.participantId === grant.participantId && t.revision === d.revision);
    if (!task) throw new AppError('task_not_in_scope', 403);
    if (name === 'task_get') return { task, discussionId: d.id, revision: d.revision, limits: d.limits, used: d.used };
    if (name === 'context_get') return { taskId: task.id, revision: d.revision, prompt: promptFor(d, task) };
    if (name === 'result_submit') {
      const text = string(args.text, 30_000); const requestId = string(args.requestId, 200);
      return this.app.store.transact((s, emit) => { const current = findDiscussion(s, d.id);
        if (current.revision !== d.revision) throw new AppError('revision_conflict', 409);
        const evidenceId = id('evidence'); current.evidence.push({ id: evidenceId, revision: d.revision, claimIds: task.claimIds, participantId: grant.participantId, taskId: task.id,
          kind: 'provider_report', source: `mcp:${grant.id}`, text, observedAt: now(), digest: digest(text), status: 'reported', reason: 'awaiting_verification' });
        emit({ type: 'mcp.result_submitted', discussionId: d.id, data: { evidenceId, taskId: task.id } }); return { evidenceId, status: 'review_required' };
      }, { id: `mcp:${grant.id}:${requestId}`, input: { name, taskId: task.id, text } });
    }
    if (name === 'codex_send') {
      if (!d.executionBindingId || task.phase !== 'verification' || task.method !== 'codex' || d.status !== 'running') throw new AppError('execution_not_in_scope', 403);
      const prompt = string(args.prompt, 30_000);
      if (task.jobId) { const prior = state.jobs.find(j => j.id === task.jobId); if (prior?.promptDigest !== digest(prompt)) throw new AppError('idempotency_conflict', 409); return { jobId: task.jobId, status: prior.status }; }
      if (d.used.toolJobs >= d.limits.maxToolJobs || task.status !== 'running' || !d.turns.some(t => t.id === task.turnId && ['prepared', 'running'].includes(t.status))) throw new AppError('execution_not_in_scope', 403);
      if (d.roomId) this.app.store.transact(s => this.app.dispatch.reserveTool(s, d.id, task.id));
      const jobId = this.app.codex.submit({ bindingId: d.executionBindingId, prompt, requestId: task.id,
        discussionId: d.id, taskId: task.id, revision: d.revision, maxDurationMs: Math.max(1, d.limits.maxActiveMs - d.used.activeMs) });
      this.app.store.transact((s, emit) => { const current = findDiscussion(s, d.id); const currentTask = current.tasks.find(t => t.id === task.id)!;
        currentTask.jobId = jobId; current.used.toolJobs++; current.contexts.find(c => c.participantId === task.participantId)!.observation.tool = 'queued';
        emit({ type: 'verification.execution_queued', discussionId: d.id, data: { taskId: task.id, jobId, source: 'participant_mcp' } }); });
      return { jobId, status: 'accepted' };
    }
    throw new AppError('unknown_tool');
  }
}
const descriptions: Record<string, string> = {
  capabilities_get: 'Inspect recorded connection and execution status and configured policy in this grant only. Does not grant access or verify isolation by running a job.',
  task_get: 'Get the current task assigned to this participant in the granted discussion.',
  context_get: 'Get the task input snapshot with draft visibility restrictions applied.',
  result_submit: 'Submit a reported result for review; submission does not establish fact verification or task completion.',
  codex_send: 'Queue a prompt in the discussion’s pre-authorized Codex binding. Returns a job receipt, not completion.',
  codex_status: 'Get the actual status of an in-scope Codex job.', codex_result: 'Read output and observed execution evidence.', codex_cancel: 'Request cancellation; remote interruption must still be observed.',
};
const textField = { type: 'string' };
const schemas: Record<string, unknown> = {
  capabilities_get: { type: 'object', properties: {}, additionalProperties: false },
  task_get: { type: 'object', properties: { taskId: textField }, additionalProperties: false },
  context_get: { type: 'object', properties: { taskId: textField }, required: ['taskId'], additionalProperties: false },
  result_submit: { type: 'object', properties: { taskId: textField, requestId: textField, text: textField }, required: ['taskId', 'requestId', 'text'], additionalProperties: false },
  codex_send: { type: 'object', properties: { taskId: textField, prompt: textField }, required: ['taskId', 'prompt'], additionalProperties: false },
  ...Object.fromEntries(['codex_status', 'codex_result', 'codex_cancel'].map(name => [name, { type: 'object', properties: { jobId: textField }, required: ['jobId'], additionalProperties: false }])),
};
