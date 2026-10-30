import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink, link, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { LocalMaterials, MATERIAL_LIMITS } from '../dist/server/workspace/materials.js';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
import { Store } from '../dist/server/workspace/store.js';
import { workspace, topic, until } from './workspace-helpers.mjs';

async function files(t) {
  const root = await mkdtemp(join(tmpdir(), 'wj-materials-')); t.after(() => rm(root, { recursive: true, force: true }));
  const selected = join(root, 'selected'); await mkdir(selected);
  return { root, selected, reader: new LocalMaterials([selected], [join(selected, 'private')]) };
}
const input = paths => ({ label: 'Shared requirements', paths });
const error = code => e => e.code === code;

test('material permission defaults to empty and is separate from execution roots', () => {
  assert.deepEqual(loadWorkspaceConfig({ WJ_WORKSPACE_ROOTS: '["/tmp/execution"]' }).materialRoots, []);
  assert.deepEqual(loadWorkspaceConfig({ WJ_MATERIAL_ROOTS: '["/tmp/shared"]' }).workspaceRoots, []);
  assert.throws(() => loadWorkspaceConfig({ WJ_MATERIAL_ROOTS: '["relative-private-path"]' }), e => e.fields.includes('WJ_MATERIAL_ROOTS') && !e.message.includes('relative-private-path'));
});

test('read boundary refuses protected files, traversal, links in every component, hardlinks, special files and disabled roots', async t => {
  const { root, selected, reader } = await files(t); const regular = join(selected, 'notes.txt'); await writeFile(regular, 'allowed');
  assert.throws(() => new LocalMaterials([], []).prepare(input([regular])), error('material_path_not_allowed'));
  const outside = join(root, 'outside.txt'); await writeFile(outside, 'private');
  assert.throws(() => reader.prepare(input([outside])), error('material_path_not_allowed'));
  assert.throws(() => reader.prepare(input([selected + '/../outside.txt'])), error('material_path_invalid'));
  await symlink(outside, join(selected, 'linked.txt'));
  assert.throws(() => reader.prepare(input([join(selected, 'linked.txt')])), error('material_path_unavailable_or_link'));
  await mkdir(join(root, 'other')); await writeFile(join(root, 'other', 'nested.txt'), 'private'); await symlink(join(root, 'other'), join(selected, 'dirlink'));
  assert.throws(() => reader.prepare(input([join(selected, 'dirlink', 'nested.txt')])), error('material_path_unavailable_or_link'));
  const alias = join(root, 'rootlink'); await symlink(selected, alias);
  assert.throws(() => new LocalMaterials([alias], []).prepare(input([join(alias, 'notes.txt')])), error('material_path_unavailable_or_link'));
  await link(outside, join(selected, 'hard.txt'));
  assert.throws(() => reader.prepare(input([join(selected, 'hard.txt')])), error('material_regular_unlinked_file_required'));
  for (const name of ['.env', '.env.production', '.npmrc', 'credentials', 'service-account.json', 'key.pem']) {
    await writeFile(join(selected, name), 'private'); assert.throws(() => reader.prepare(input([join(selected, name)])), error('material_path_protected'));
  }
  await mkdir(join(selected, 'private')); await writeFile(join(selected, 'private', 'ordinary.txt'), 'private');
  assert.throws(() => reader.prepare(input([join(selected, 'private', 'ordinary.txt')])), error('material_path_protected'));
  execFileSync('mkfifo', [join(selected, 'pipe')]);
  assert.throws(() => reader.prepare(input([join(selected, 'pipe')])), error('material_regular_unlinked_file_required'));
  assert.throws(() => reader.prepare(input([selected])), error('material_regular_unlinked_file_required'));
  const listing = reader.list(selected); assert.ok(listing.entries.some(e => e.name === 'notes.txt'));
  assert.ok(!listing.entries.some(e => ['.env', 'linked.txt', 'dirlink', 'pipe', 'private'].includes(e.name)));
  const single = new LocalMaterials([regular], []); assert.equal(single.prepare(input([regular])).files[0].text, 'allowed');
  assert.throws(() => single.prepare(input([outside])), error('material_path_not_allowed'));
});

test('UTF-8 raw bytes and metadata are exact; size/count/encoding violations reject the whole package', async t => {
  const { selected, reader } = await files(t); const path = join(selected, 'notes.txt'); const raw = Buffer.from('\ufeff자료\r\n마지막 줄\n'); await writeFile(path, raw);
  const pack = reader.prepare(input([path])); const file = pack.files[0];
  assert.equal(file.text, raw.toString('utf8')); assert.equal(file.size, raw.length); assert.equal(file.path, path); assert.equal(file.excerpt, false);
  assert.equal(file.digest, createHash('sha256').update(raw).digest('hex'));
  await writeFile(path, Buffer.alloc(MATERIAL_LIMITS.fileBytes + 1, 65)); assert.throws(() => reader.prepare(input([path])), error('material_file_too_large'));
  await writeFile(path, Buffer.from([0xc3, 0x28])); assert.throws(() => reader.prepare(input([path])), error('material_utf8_required'));
  await writeFile(path, Buffer.from([0, 1, 2])); assert.throws(() => reader.prepare(input([path])), error('material_text_required'));
  const paths = []; for (let n = 0; n < 9; n++) { const p = join(selected, n + '.txt'); await writeFile(p, 'a'.repeat(24000)); paths.push(p); }
  assert.throws(() => reader.prepare(input(paths)), error('invalid_list'));
  assert.throws(() => reader.prepare(input(paths.slice(0, 3))), error('material_package_too_large'));
});

test('owner APIs are authenticated, idempotent, detect changes before attachment, and share immutable snapshots through revisions and restart', async t => {
  const { selected } = await files(t); const path = join(selected, 'plan.txt'); const original = '모든 토커가 같은 원문을 읽습니다.\n'; await writeFile(path, original);
  const f = await workspace(t, { materialRoots: [selected] });
  assert.equal((await fetch(f.url + '/api/capabilities')).status, 401);
  assert.equal((await fetch(f.url + '/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input([path])) })).status, 401);
  const key = { headers: { 'Idempotency-Key': 'materials-snapshot' } };
  const first = await f.api('/api/materials', input([path]), key); assert.equal(first.status, 201); const { id } = await first.json();
  await writeFile(path, 'changed'); assert.deepEqual(await (await f.api('/api/materials', input([path]), key)).json(), { id });
  assert.equal((await f.api('/api/materials', { ...input([path]), label: 'changed payload' }, key)).status, 409);
  const refused = await f.api('/api/discussions', { ...topic, materialPackageIds: [id] }); assert.equal(refused.status, 409); assert.equal((await refused.json()).error.code, 'material_changed');
  assert.equal(f.app.store.read().discussions.length, 0);
  await writeFile(path, original); const freshId = (await (await f.api('/api/materials', input([path]))).json()).id;
  const created = await f.api('/api/discussions', { ...topic, materialPackageIds: [freshId] }); assert.equal(created.status, 201); const did = (await created.json()).id;
  f.app.engine.control(did, { action: 'pause', expectedRevision: 1 }, 'materials-pause'); await until(() => f.app.store.read().discussions[0].turns.every(t => !['running', 'prepared'].includes(t.status)));
  await writeFile(path, 'changed after discussion started');
  f.app.engine.control(did, { action: 'revise', text: '원문을 유지하고 다시 검토', expectedRevision: 1 }, 'materials-revise');
  f.app.engine.control(did, { action: 'resume', expectedRevision: 2 }, 'materials-resume');
  const d = await until(() => { const d = f.app.store.read().discussions[0]; return d.status === 'completed' && d; });
  const payload = prompt => JSON.parse(prompt.split('\n\n').find(p => p.startsWith('{"topic":')));
  for (const turn of d.turns) assert.equal(payload(turn.prompt).evidence.find(e => e.material)?.text, original);
  assert.deepEqual(...d.turns.filter(t => t.revision === 2 && t.phase === 'independent').map(t => payload(t.prompt).evidence));
  const snapshot = await (await f.api('/api/state')).json(); assert.equal(snapshot.materialPackages[0].files[0].text, undefined);
  assert.ok(!JSON.stringify(snapshot).includes(original)); assert.equal(f.app.store.read().materialPackages.length, 2);
  // Close only the store after the completed engine, then reopen its durable DB.
  await f.app.engine.close(); f.app.store.close(); const restored = new Store(f.directory);
  assert.equal(restored.read().materialPackages[1].files[0].text, original);
  assert.equal(restored.read().discussions[0].evidence.find(e => e.material).text, original); restored.close();
});

test('renamed/replaced inputs and aggregate/context limits fail before any model dispatch', async t => {
  const { selected, reader } = await files(t); const p = join(selected, 'a.txt'); await writeFile(p, 'same bytes'); const pack = reader.prepare(input([p]));
  await rename(p, join(selected, 'old.txt')); await writeFile(p, 'same bytes'); assert.throws(() => reader.verify([pack]), error('material_changed'));
  const f = await workspace(t, { materialRoots: [selected] }); const paths = [];
  for (let i = 0; i < 3; i++) { const path = join(selected, 'budget-' + i); await writeFile(path, '"'.repeat(30000)); paths.push(path); }
  const ids = paths.map((path, i) => f.app.prepareMaterials(input([path]), 'budget-' + i));
  assert.throws(() => f.app.engine.create({ ...topic, materialPackageIds: ids }, 'too-big'), error('material_package_too_large'));
  // Large user text is included twice by the existing prompt contract; use
  // escaped quotes to exercise the serialized prompt budget, not byte guesses.
  assert.throws(() => f.app.engine.create({ ...topic, materials: '"'.repeat(20000), materialPackageIds: ids.slice(0, 2) }, 'context-big'), error('material_context_budget_exceeded'));
  assert.equal(f.app.store.read().discussions.length, 0);
});
