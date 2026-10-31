import { platform, release, arch } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, isAbsolute } from 'node:path';
import type { Workspace } from './runtime.js';
import { findDiscussion } from './engine.js';
import { MATERIAL_LIMITS } from './materials.js';
import { now } from './util.js';

const execute = promisify(execFile);
export async function installedVersion(command: string[]) {
  const binary = command[0]!; let args = ['--version'];
  if (/^(node|nodejs)$/.test(basename(binary))) {
    if (!command[1] || !isAbsolute(command[1]) || !/\.[cm]?js$/.test(command[1])) return { status: 'unknown', version: null };
    args = [command[1], '--version'];
  } else if (/^(env|npx|npm|uv|python3?|bash|sh)$/.test(basename(binary))) return { status: 'unknown', version: null };
  try {
    const { stdout } = await execute(binary, args, { timeout: 3000, maxBuffer: 4096, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C' } });
    const value = stdout.match(/(?:^|[^0-9])(\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.]+)?)(?![0-9.])/)?.[1];
    return { status: value ? 'observed' : 'unknown', version: value ?? null };
  } catch { return { status: 'unavailable', version: null }; }
}
// Versions describe the installed command, not a successful connection, grant,
// namespace creation, model response or execution. No connection probes/calls.
export async function inspectCapabilities(app: Workspace, scope?: { discussionId: string; participantId: string; tools: string[] }) {
  const codexVisible = !scope || scope.tools.some(t => t.startsWith('codex_'));
  const [codex, bubblewrap, chromeMcp] = await Promise.all([
    codexVisible ? installedVersion(app.config.codexCommand) : Promise.resolve(null),
    codexVisible ? installedVersion(['bwrap']) : Promise.resolve(null),
    !scope && app.config.chromeCommand ? installedVersion(app.config.chromeCommand) : Promise.resolve(null),
  ]);
  const state = app.store.read(); const discussion = scope ? findDiscussion(state, scope.discussionId) : null;
  const bindings = state.bindings.filter(b => !scope || codexVisible && b.id === discussion!.executionBindingId);
  const jobs = state.jobs.filter(j => !scope || codexVisible && j.discussionId === discussion!.id && discussion!.tasks.some(t => t.id === j.taskId && t.participantId === scope.participantId));
  const members = scope ? discussion!.members.filter(m => m.id === scope.participantId) : state.participants;
  return { observedAt: now(), scope: scope ? { discussionId: scope.discussionId, participantId: scope.participantId, tools: scope.tools } : 'owner',
    os: { platform: platform(), release: release(), arch: arch() }, tools: { node: { status: 'observed', version: process.versions.node }, codex, bubblewrap, chromeMcp },
    materials: { mode: 'read_only_snapshot', limits: MATERIAL_LIMITS,
      ...(!scope ? { allowedPaths: app.config.materialRoots } : {}),
      attached: discussion ? discussion.evidence.filter(e => e.material).map(e => e.material) : [],
      access: scope ? 'attached_snapshots_only' : app.config.materialRoots.length ? 'configured' : 'disabled' },
    execution: { policySource: 'configured_policy_and_recorded_observations',
      actions: Object.fromEntries(['codex_send', 'codex_status', 'codex_result', 'codex_cancel'].map(tool => [tool, !scope || scope.tools.includes(tool)])),
      read: codexVisible ? 'host_filesystem_except_masked_private_state' : 'not_granted',
      writes: bindings.filter(b => b.allowWrite).map(b => ({ bindingId: b.id, path: b.cwd })),
      commandNetwork: codexVisible ? 'disabled_by_turn_sandbox_policy' : 'not_granted',
      serverNetwork: codexVisible ? 'host_network_for_authenticated_app_server' : 'not_granted',
      approvalPolicy: codexVisible ? 'untrusted' : null, approvalsReviewer: codexVisible ? 'user' : null,
      isolation: codexVisible ? 'bubblewrap_required_at_connection; success_not_established_by_version' : 'not_granted',
      ...(!scope ? { allowedPaths: app.config.workspaceRoots } : {}),
      bindings: bindings.map(b => ({ id: b.id, label: b.label, cwd: b.cwd, allowWrite: b.allowWrite, status: b.status, branch: b.branch })),
      jobs: jobs.slice(-50).map(j => ({ id: j.id, bindingId: j.bindingId, status: j.status, pendingApprovals: j.approvals.filter(a => a.status === 'pending').length, finishedAt: j.finishedAt })) },
    connections: scope ? members.map(m => { const c = state.connections.find(c => c.id === m.connectionId);
      return { participantId: m.id, kind: m.kind, status: m.kind === 'fake' ? 'fixture' : c?.status ?? 'not_connected', lastCheckedAt: c?.lastCheckedAt ?? null }; })
      : state.connections.map(c => ({ connectionId: c.id, label: c.label, kind: c.kind, status: c.status, lastCheckedAt: c.lastCheckedAt ?? null })),
    ...(!scope ? { sourceFetch: app.config.sourceFetch, browserConfigured: !!app.config.chromeCommand, browserPaused: state.browserPaused } : {}),
  };
}
export type CapabilityReport = Awaited<ReturnType<typeof inspectCapabilities>>;
