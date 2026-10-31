import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workspace, ownerKey, topic } from './workspace-helpers.mjs';
import { readReadiness } from '../scripts/readiness.mjs';
const run = promisify(execFile);
const portOf = f => new URL(f.url).port;

test('doctor inspects the authenticated local service without provider calls, state changes or private metadata output', async t => {
  const f = await workspace(t); let providerCalls = 0; f.app.providers.request = async () => { providerCalls++; throw new Error('provider must not run'); };
  f.app.store.transact(s => {
    for (const [id, kind, email] of [['PRIVATE_GPT_A', 'openai-oauth', 'first-private@example.invalid'], ['PRIVATE_GPT_B', 'codex-oauth', 'second-private@example.invalid'], ['PRIVATE_DS', 'deepseek']]) {
      s.connections.push({ id, kind, label: 'PRIVATE_ACCOUNT_LABEL', email, status: 'connected', models: [{ id: 'PRIVATE_MODEL_ID', label: 'PRIVATE_MODEL_LABEL' }] });
      s.participants.push({ id: id + '_PARTICIPANT', label: 'PRIVATE_PARTICIPANT_LABEL', kind, connectionId: id, modelId: 'PRIVATE_MODEL_ID', role: 'PRIVATE_ROLE' });
    }
  });
  const cursor = f.app.store.cursor(), before = JSON.stringify(f.app.store.read());
  const result = await run(process.execPath, ['scripts/ops.mjs', 'doctor'], { env: { ...process.env, WJ_PORT: portOf(f), WJ_PUBLIC_ORIGIN: f.url, WJ_STATE_DIR: f.directory, WJ_CHROME_PROFILE_DIR: join(f.directory, 'chrome'), WJ_ACCESS_TOKEN: ownerKey, WJ_RESIDENT_ENABLED: 'false', WJ_WORKSPACE_ROOTS: '[]' }, timeout: 20000 });
  const { readiness: r } = JSON.parse(result.stdout);
  assert.equal(r.status, 'observed'); assert.equal(r.evidence, 'stored_metadata_only'); assert.equal(r.connections.gptWithModels, 2); assert.equal(r.participants.readyGpt, 2); assert.equal(r.participants.recordedDistinctGptEmails, 2); assert.equal(r.participants.readyDeepseek, 1); assert.equal(r.participants.fake, 2);
  assert.equal(r.topic.recordedPrerequisitesMet, true); assert.equal(r.realModelAcceptance, 'UNVERIFIED_BY_DOCTOR'); assert.equal(r.topic.unconfirmedTurnAcceptance, 'UNVERIFIED_BY_DOCTOR'); assert.ok(r.resident.issues.includes('resident_feature_disabled')); assert.ok(r.codex.issues.includes('ready_read_only_binding_required'));
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|first-private|second-private|fixture-only-private-owner-access/); assert.equal(providerCalls, 0); assert.equal(f.app.store.cursor(), cursor); assert.equal(JSON.stringify(f.app.store.read()), before);
});

test('connected accounts alone never imply prepared talkers; blocked roots, identity duplicates and manual browser control stay explicit', async t => {
  const f = await workspace(t); f.app.engine.kick = () => {};
  f.app.engine.create(topic, 'readiness-existing-topic'); f.app.store.transact(s => { s.discussions[0].status = 'blocked'; s.browserPaused = true;
    for (const [id, kind] of [['A', 'openai-oauth'], ['B', 'codex-oauth'], ['D', 'deepseek']]) s.connections.push({ id, kind, email: 'same-private@example.invalid', label: 'private', status: 'connected', models: [{ id: 'model', label: 'model' }] });
  });
  let r = await readReadiness(f.app.config, { port: portOf(f) });
  assert.equal(r.connections.gptWithModels, 2); assert.equal(r.participants.readyGpt, 0); assert.equal(r.topic.recordedPrerequisitesMet, false); assert.ok(r.topic.issues.includes('two_gpt_participants_required')); assert.ok(r.topic.issues.includes('deepseek_participant_required')); assert.ok(r.topic.issues.includes('existing_discussion_requires_owner_action')); assert.ok(r.browser.issues.includes('browser_manual_control_active'));
  f.app.store.transact(s => { for (const c of s.connections) s.participants.push({ id: c.id, connectionId: c.id, kind: c.kind, modelId: 'model', label: 'private', role: '' }); });
  r = await readReadiness(f.app.config, { port: portOf(f) }); assert.equal(r.participants.readyGpt, 2); assert.equal(r.participants.recordedDistinctGptEmails, 1); assert.ok(r.topic.issues.includes('distinct_gpt_identities_require_confirmation')); assert.equal(r.topic.recordedPrerequisitesMet, false);
});

test('readiness never creates an owner key or sends a request to a malformed port', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wj-readiness-no-key-')); t.after(() => rm(directory, { recursive: true, force: true })); let calls = 0;
  const config = { stateDir: directory, residentEnabled: false, workspaceRoots: [] }, request = async () => { calls++; throw new Error('should not request'); };
  assert.equal((await readReadiness(config, { port: 4090, request })).reason, 'owner_key_unavailable'); assert.deepEqual(await readdir(directory), []);
  for (const port of ['4090@untrusted.invalid', '0', '65536', 'NaN']) assert.equal((await readReadiness({ ...config, accessToken: ownerKey }, { port, request })).reason, 'invalid_local_port');
  assert.equal(calls, 0);
});

test('a port used by another local service never receives the owner key', async () => {
  const requests = []; const r = await readReadiness({ accessToken: ownerKey }, { port: 3000, request: async (url, options) => { requests.push({ url, authorization: options.headers?.Authorization }); return Response.json({ status: 'ok', service: 'another-local-app' }); } });
  assert.equal(r.reason, 'unexpected_local_service'); assert.equal(requests.length, 1); assert.equal(requests[0].url, 'http://127.0.0.1:3000/health'); assert.equal(requests[0].authorization, undefined);
});

test('readiness refuses redirects and bounds or sanitizes state/error responses without exposing the owner key', async t => {
  let forwarded = 0; const trap = createServer((req, res) => { forwarded++; res.end('{}'); }); trap.listen(0, '127.0.0.1'); await once(trap, 'listening'); t.after(() => new Promise(resolve => trap.close(resolve)));
  const redirect = createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${trap.address().port}/collect` }); res.end(); }); redirect.listen(0, '127.0.0.1'); await once(redirect, 'listening'); t.after(() => new Promise(resolve => redirect.close(resolve)));
  const config = { accessToken: ownerKey, stateDir: '/unused', residentEnabled: false, workspaceRoots: [] };
  assert.equal((await readReadiness(config, { port: redirect.address().port })).reason, 'local_state_unavailable'); assert.equal(forwarded, 0);
  for (const response of [new Response('x'.repeat(1_000_001)), new Response('{"PRIVATE_SECRET":"'+ownerKey+'"}'), new Response('PRIVATE_UPSTREAM_ERROR',{status:401})]) {
    const r = await readReadiness(config, { port: 4090, request: async url => url.endsWith('/health') ? Response.json({ status: 'ok', service: 'webjjoku', mode: 'workspace', persistence: 'sqlite' }) : response }); assert.equal(r.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|fixture-only-private-owner-access/); assert.equal(r.modelCalls, 0);
  }
});
