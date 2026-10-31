import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/server/workspace/store.js';
import { ResidentStore } from '../dist/server/workspace/resident-store.js';
import { Wiki } from '../dist/server/workspace/wiki.js';

for (const stage of ['before_commit', 'notice_committed', 'edit_committed']) test('R8-B Wiki SIGKILL: ' + stage + ' restores one version/notice/command without a model call', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-r8-wiki-crash-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['tests/fixtures/wiki-crash.mjs', directory, stage], { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = ''; child.stderr.on('data', d => { stderr += d; });
  const [code, signal] = await once(child, 'exit'); assert.equal(code, null, stderr); assert.equal(signal, 'SIGKILL', stderr);
  const { roomId, input } = JSON.parse(await readFile(join(directory, 'wiki-input.json'), 'utf8')); const store = new Store(directory);
  try { new ResidentStore(store, true); const wiki = new Wiki(store, true); assert.equal(store.read().resident.wikiVersions.length, stage === 'before_commit' ? 0 : 1);
    let result; for (let i = 0; i < 20; i++) { const next = wiki.edit(roomId, input, 'r8-wiki-crash'); if (!result) result = next; else assert.deepEqual(next, result); }
    const state = store.read(); assert.equal(state.resident.wikiPages.length, 1); assert.equal(state.resident.wikiVersions.length, 1); assert.equal(wiki.get(roomId, result.pageId).version.body, input.body);
    assert.equal(state.resident.messages.filter(m => m.sourceKind === 'wiki').length, 1); assert.equal(store.events(0).filter(e => e.type === 'resident.wiki_edited').length, 1); assert.equal(state.resident.turns.length, 0); assert.equal(state.jobs.length, 0);
  } finally { store.close(); }
});
