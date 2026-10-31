import { join } from 'node:path';
import { Workspace } from '../../dist/server/workspace/runtime.js';
import { loadWorkspaceConfig } from '../../dist/server/workspace/config.js';
const [directory, stage] = process.argv.slice(2);
const config = loadWorkspaceConfig({ WJ_STATE_DIR: directory, WJ_CHROME_PROFILE_DIR: join(directory, 'chrome'), WJ_PUBLIC_ORIGIN: 'http://127.0.0.1:3999', WJ_ACCESS_TOKEN: 'fixture-only-private-owner-access-key-123456' });
const app = new Workspace(config, 1, { residentAutoSchedule: false });
app.store.transact(s => { s.connections.push({ id: 'remove-me', kind: 'deepseek', label: 'Fixture', status: 'connected', models: [] }, { id: 'keep-me', kind: 'deepseek', label: 'Other fixture', status: 'connected', models: [] }); s.participants.push({ id: 'historical', kind: 'deepseek', connectionId: 'remove-me', label: 'Original talker', modelId: 'fixture', role: '' }); });
app.vault.put('remove-me', { key: 'removed-fixture-key' }); app.vault.put('keep-me', { key: 'other-fixture-key' });
if (stage === 'before_commit') { const transact = app.store.transact.bind(app.store); app.store.transact = (fn, command) => transact((s, emit) => fn(s, e => { emit(e); if (e.type === 'connection.removed') process.kill(process.pid, 'SIGKILL'); }), command); }
else app.store.subscribe(e => { if (e.type === 'connection.removed') process.kill(process.pid, 'SIGKILL'); });
app.removeConnection('remove-me', 'crash'); throw new Error('crash stage missed');
