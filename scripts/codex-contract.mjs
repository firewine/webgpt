import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile); const executable = process.env.WJ_CODEX_BINARY ?? 'codex'; const directory = await mkdtemp(join(tmpdir(), 'wj-codex-schema-'));
async function locate(path, name) { for (const entry of await readdir(path, { withFileTypes: true })) { if (entry.name === name) return join(path, entry.name); if (entry.isDirectory()) { const found = await locate(join(path, entry.name), name); if (found) return found; } } return null; }
try {
  const version = (await run(executable, ['--version'], { timeout: 10000 })).stdout.trim();
  await run(executable, ['app-server', 'generate-json-schema', '--out', directory], { timeout: 20000 });
  const schema = JSON.parse(await readFile(await locate(directory, 'TurnStartParams.json'), 'utf8'));
  assert.ok(schema.definitions.AskForApproval.oneOf.some(x => x.enum?.includes('untrusted')));
  const readonly = schema.definitions.SandboxPolicy.oneOf.find(x => x.properties.type.enum.includes('readOnly'));
  assert.ok(readonly.properties.networkAccess);
  const write = schema.definitions.SandboxPolicy.oneOf.find(x => x.properties.type.enum.includes('workspaceWrite'));
  for (const key of ['writableRoots', 'excludeSlashTmp', 'excludeTmpdirEnvVar', 'networkAccess']) assert.ok(write.properties[key]);
  for (const [name, fields] of [['ThreadReadParams', ['threadId', 'includeTurns']], ['ThreadResumeParams', ['threadId', 'excludeTurns']], ['ThreadTurnsListParams', ['threadId', 'itemsView', 'sortDirection']], ['TurnSteerParams', ['threadId', 'expectedTurnId', 'input']]]) {
    const value = JSON.parse(await readFile(await locate(directory, `${name}.json`), 'utf8')); for (const field of fields) assert.ok(value.properties[field], `${name}.${field}`);
  }
  console.log(`${version}: installed App Server request contract PASS. No login, thread or model turn was started.`);
} finally { await rm(directory, { recursive: true, force: true }); }
