import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { workspace, ownerKey } from './workspace-helpers.mjs';
import { validatePasswordState, passwordValue, createPassword, verifyPassword } from '../dist/server/workspace/password.js';

const password = 'fixture private phrase 1234', replacement = 'fixture replacement phrase 5678';
const cookieOf = r => r.headers.get('set-cookie')?.split(';')[0];
async function app(t, extra = {}) { return workspace(t, extra, { passwordUnset: true, residentAutoSchedule: false }); }
async function post(f, path, body, cookie) { return fetch(f.url + path, { method: 'POST', headers: { Origin: f.app.config.origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }); }
async function state(f, cookie) { return fetch(f.url + '/api/state', { headers: { Cookie: cookie } }); }
async function link(f, reset = false) { const r = await f.api('/api/password/setup-link', { reset }); assert.equal(r.status, 200); const b = await r.json(); return new URL(b.url).hash.slice('#password-setup='.length); }
async function setup(f) { const token = await link(f); const r = await post(f, '/api/password/setup', { password, confirmPassword: password, setupToken: token }); assert.equal(r.status, 200, await r.clone().text()); return cookieOf(r); }

test('password policy supports Unicode/whitespace without trim and uses salted memory-hard verifiers', async () => {
  assert.equal(passwordValue('  한글 공백 암호 문장을 충분히 길게 작성  '), '  한글 공백 암호 문장을 충분히 길게 작성  ');
  for (const invalid of ['', '12345678', 'x'.repeat(129), null]) assert.throws(() => passwordValue(invalid), /invalid_password/);
  const a = await createPassword(password), b = await createPassword(password); assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash); assert.equal(a.hash.length, 128);
  assert.equal(await verifyPassword(password, a), true); assert.equal(await verifyPassword(replacement, a), false);
});

test('first password cannot be claimed anonymously or across Origin; current owner session can set it with confirmation', async t => {
  const f = await app(t); const initial = await (await fetch(f.url + '/api/auth')).json(); assert.deepEqual(initial, { passwordConfigured: false, canSetup: false });
  assert.equal((await post(f, '/api/password/setup', { password, confirmPassword: password })).status, 403); assert.equal(f.app.store.read().ownerPassword, undefined);
  assert.equal((await f.api('/api/password/setup', { password, confirmPassword: password }, { headers: { Origin: 'https://wrong.invalid' } })).status, 403);
  const legacy = cookieOf(await post(f, '/api/login', { token: ownerKey })); assert.equal((await state(f, legacy)).status, 200);
  assert.equal((await post(f, '/api/password/setup-link', {}, legacy)).status, 403); assert.equal(f.app.store.read().passwordSetup, undefined);
  assert.equal((await post(f, '/api/password/setup', { password, confirmPassword: replacement }, legacy)).status, 400); assert.equal(f.app.store.read().ownerPassword, undefined);
  const r = await post(f, '/api/password/setup', { password, confirmPassword: password }, legacy); assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=43200/);
  assert.equal((await state(f, legacy)).status, 401); assert.equal((await state(f, cookieOf(r))).status, 200);
  const raw = JSON.stringify(f.app.store.read()), snapshot = JSON.stringify(f.app.snapshot()), events = JSON.stringify(f.app.store.events(0));
  assert.equal(raw.includes(password), false); assert.equal(raw.includes(replacement), false); assert.equal(snapshot.includes('ownerPassword'), false); assert.equal(snapshot.includes(f.app.store.read().ownerPassword.hash), false); assert.equal(events.includes(password), false);
});

test('one-time setup link is hashed, expires, is scoped to its credential generation and cannot overwrite another setup', async t => {
  const f = await app(t); const token = await link(f); assert.equal(JSON.stringify(f.app.store.read()).includes(token), false);
  f.app.store.transact(s => { s.passwordSetup.expiresAt = Date.now() - 1; }); assert.equal((await post(f, '/api/password/setup', { password, confirmPassword: password, setupToken: token })).status, 403);
  const valid = await link(f); const body = { password, confirmPassword: password, setupToken: valid };
  const results = await Promise.all([post(f, '/api/password/setup', body), post(f, '/api/password/setup', body)]); assert.equal(results.filter(r => r.status === 200).length, 1); assert.ok(results.some(r => [403, 409, 429].includes(r.status)));
  assert.equal(f.app.store.read().sessions.length, 1); assert.equal(f.app.store.read().passwordSetup, null); assert.equal((await post(f, '/api/password/setup', body)).status, 403);
  assert.equal((await f.api('/api/password/setup-link', {})).status, 409);
});

test('password login works across requests, expired/logged-out cookies fail and operator key remains separate', async t => {
  const f = await app(t); await setup(f);
  const r = await post(f, '/api/login', { password }); assert.equal(r.status, 200); const cookie = cookieOf(r); assert.equal((await state(f, cookie)).status, 200);
  assert.equal((await post(f, '/api/login', { password: replacement })).status, 401);
  assert.equal((await f.api('/api/state')).status, 200); // server operator Bearer
  const out = await post(f, '/api/logout', {}, cookie); assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/); assert.equal((await state(f, cookie)).status, 401);
  const next = cookieOf(await post(f, '/api/login', { password })); f.app.store.transact(s => { for (const session of s.sessions) session.expiresAt = Date.now() - 1; }); assert.equal((await state(f, next)).status, 401);
});

test('changing a password requires the current value and revokes other sessions and older recovery links atomically', async t => {
  const f = await app(t); const first = await setup(f); const second = cookieOf(await post(f, '/api/login', { password })); const oldLink = await link(f, true);
  const pending = f.app.store.read().passwordSetup; assert.equal((await post(f, '/api/password/setup-link', { reset: true }, first)).status, 403); assert.deepEqual(f.app.store.read().passwordSetup, pending);
  const input = { currentPassword: replacement, password: replacement, confirmPassword: replacement };
  assert.equal((await post(f, '/api/password/change', input, first)).status, 403); assert.equal((await state(f, first)).status, 200);
  const changed = await post(f, '/api/password/change', { ...input, currentPassword: password }, first); assert.equal(changed.status, 200);
  assert.equal((await state(f, first)).status, 401); assert.equal((await state(f, second)).status, 401); assert.equal((await state(f, cookieOf(changed))).status, 200);
  assert.equal((await post(f, '/api/password/setup', { password, confirmPassword: password, setupToken: oldLink })).status, 403); assert.equal(f.app.store.read().passwordSetup, null);
  assert.equal((await post(f, '/api/login', { password })).status, 401); assert.equal((await post(f, '/api/login', { password: replacement })).status, 200);
});

test('server-owned reset link recovers a forgotten password without clearing account/chat/room state', async t => {
  const f = await app(t, { residentEnabled: true }); const cookie = await setup(f); const before = f.app.snapshot(); const token = await link(f, true);
  const reset = await post(f, '/api/password/setup', { password: replacement, confirmPassword: replacement, setupToken: token }); assert.equal(reset.status, 200); assert.equal((await state(f, cookie)).status, 401);
  const after = f.app.snapshot(); for (const key of ['connections', 'participants', 'discussions', 'jobs', 'resident', 'apiDaily']) assert.deepEqual(after[key], before[key]);
  assert.equal((await post(f, '/api/login', { password: replacement })).status, 200);
});

test('wrong passwords are throttled and concurrent expensive derivations do not fan out', async t => {
  const f = await app(t); await setup(f);
  const concurrent = await Promise.all([post(f, '/api/login', { password }), post(f, '/api/login', { password })]); assert.equal(concurrent.filter(r => r.status === 200).length, 1); assert.equal(concurrent.filter(r => r.status === 429).length, 1);
  for (let i = 0; i < 5; i++) assert.equal((await post(f, '/api/login', { password: replacement })).status, 401);
  assert.equal((await post(f, '/api/login', { password: replacement })).status, 429);
});

test('TLS origin sets Secure cookie and invalid stored password/grant schemas fail closed', async t => {
  const f = await app(t, { origin: 'https://private.example' }); const token = await link(f); const r = await post(f, '/api/password/setup', { password, confirmPassword: password, setupToken: token }); assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /; Secure$/);
  const original = f.app.store.read(); for (const c of [{ ...original.ownerPassword, scheme: 'future' }, { ...original.ownerPassword, hash: [original.ownerPassword.hash] }, { ...original.ownerPassword, salt: '' }]) assert.throws(() => validatePasswordState({ ...original, ownerPassword: c }), /password_state_invalid/);
  assert.throws(() => validatePasswordState({ ...original, passwordSetup: { hash: 'x', expiresAt: 0, credentialId: null } }), /password_state_invalid/);
});

test('operator setup/reset commands print only a protected one-time link and use no password arguments', async t => {
  const f = await app(t); const env = { ...process.env, WJ_STATE_DIR: f.directory, WJ_PORT: new URL(f.url).port, WJ_PUBLIC_ORIGIN: f.url, WJ_ACCESS_TOKEN: ownerKey };
  const run = promisify(execFile); const output = await run(process.execPath, ['scripts/ops.mjs', 'password-setup'], { env }); assert.equal(output.stdout.includes(ownerKey), false); assert.equal(output.stdout.includes(password), false);
  const url = new URL(output.stdout.trim().split('\n').at(-1)); assert.equal(url.origin, f.url); assert.equal(url.search, ''); assert.match(url.hash, /^#password-setup=[\w-]{43}$/);
  assert.equal((await post(f, '/api/password/setup', { password, confirmPassword: password, setupToken: url.hash.slice('#password-setup='.length) })).status, 200);
  const reset = await run(process.execPath, ['scripts/ops.mjs', 'password-reset'], { env }); assert.match(new URL(reset.stdout.trim().split('\n').at(-1)).hash, /^#password-setup=/);
});
