// Run only with a reviewed private policy file. This is a temporary operator
// entry point using the deployed server's existing Workspace, HTTP and runners.
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acceptanceGuard } from './live-acceptance-guard.mjs';
import { validateExecutionPolicy } from './live-acceptance-codex.mjs';
const [root, policyFile] = process.argv.slice(2);
if (process.versions.node.split('.')[0] !== '24' || !root || !policyFile || !isAbsolute(root) || !isAbsolute(policyFile)) throw new Error('acceptance_arguments_required');
const stat = lstatSync(policyFile);
if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('private_policy_required');
const load = path => import(pathToFileURL(join(resolve(root), 'dist/server', path)).href);
const { loadConfig } = await load('config.js');
const { loadWorkspaceConfig } = await load('workspace/config.js');
const { Workspace } = await load('workspace/runtime.js');
const { snapshotMember } = await load('workspace/settings.js');
const { AppError } = await load('workspace/util.js');
const { createWorkspaceServer } = await load('http/workspace.js');
const config = loadConfig();
const workspaceConfig = loadWorkspaceConfig();
const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
validateExecutionPolicy(policy, workspaceConfig);
const app = new Workspace(workspaceConfig, config.fakeDelayMs);
let server, closeStreams, guard;
try {
  guard = acceptanceGuard(app, policy, { ErrorType: AppError, normalizeMember: snapshotMember, log: value => console.log(JSON.stringify({ event: 'acceptance.observation', ...value })) });
  ({ server, closeStreams } = await createWorkspaceServer(app, event => console.log(JSON.stringify(event))));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  app.start();
  console.log(JSON.stringify({ event: 'acceptance.server_started', port: config.port }));
} catch (error) {
  await guard?.stop(); closeStreams?.();
  if (server) await new Promise(resolve => server.close(resolve));
  await app.close(); guard?.close(); throw error;
}
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  await guard.stop(); closeStreams();
  const deadline = setTimeout(() => server.closeAllConnections(), 6000); deadline.unref();
  server.close(() => void app.close().then(() => { guard.close(); clearTimeout(deadline); }));
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
