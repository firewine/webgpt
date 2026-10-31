import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace } from './workspace-helpers.mjs';

const verification = { error: { code: 'permission_denied', type: 'invalid_request_error', message: 'We are asking you to provide a card on file for verification. Private diagnostic cb_fixture-secret private@example.test https://untrusted.example/' } };
async function setup(t) {
  const f = await workspace(t); const requests = [];
  f.app.store.transact(s => s.connections.push({ id: 'coral', kind: 'deepseek', apiService: 'coralbricks', label: 'Coral fixture', status: 'unverified', models: [] }));
  f.app.vault.put('coral', { key: 'cb_fixture-secret' });
  const reply = value => { f.app.providers.request = async (url, options) => { requests.push({ url, options }); return value(); }; };
  return { ...f, requests, reply };
}
test('Coral account verification denial retains actual HTTP/code without secrets, alternate catalogs or inference; the same key can recover', async t => {
  const f = await setup(t); f.reply(() => Response.json(verification, { status: 403 }));
  const failed = await f.api('/api/connections/coral/models', {}); assert.equal(failed.status, 502); assert.equal((await failed.json()).error.code, 'coralbricks_verification_required');
  const c = f.app.store.read().connections[0]; assert.equal(c.status, 'error'); assert.deepEqual(c.modelError, { httpStatus: 403, providerCode: 'permission_denied' }); assert.ok(c.lastCheckedAt); assert.equal(c.models.length, 0);
  assert.doesNotMatch(JSON.stringify(f.app.store.read()) + JSON.stringify(f.app.store.events(0)), /fixture-secret|private@example|untrusted/);
  assert.equal(f.app.vault.get('coral').key, 'cb_fixture-secret'); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, 'https://inference.coralbricks.ai/v1/models'); assert.equal(f.requests[0].options.method, undefined);
  f.reply(() => Response.json({ data: [{ id: 'deepseek-fixture-fast' }, { id: 'deepseek-fixture' }, { id: 'unrelated-model' }] }));
  assert.equal((await f.api('/api/connections/coral/models', {})).status, 200); const ready = f.app.store.read().connections[0]; assert.equal(ready.id, 'coral'); assert.equal(ready.status, 'connected'); assert.equal(ready.models.length, 2); assert.equal(ready.modelError, undefined); assert.equal(ready.error, ''); assert.equal(f.requests.length, 2);
});
for (const [status, providerCode, expected] of [[401, 'invalid_api_key', 'auth_required'], [403, 'permission_denied', 'model_access_denied'], [429, 'rate_limit_exceeded', 'model_rate_limited'], [429, 'insufficient_credits', 'provider_credits_required'], [404, null, 'model_catalog_not_found'], [503, null, 'model_provider_unavailable']]) {
  test(`model error ${status}/${providerCode}: one read-only request preserves credentials and reports the actual category`, async t => {
    const f = await setup(t); f.reply(() => Response.json({ error: { code: providerCode, message: 'Private provider text must not be shown' } }, { status }));
    await assert.rejects(f.app.refreshModels('coral'), new RegExp(expected)); const c = f.app.store.read().connections[0]; assert.equal(c.error, expected); assert.equal(c.modelError.httpStatus, status); assert.equal(f.requests.length, 1); assert.ok(f.app.vault.get('coral')); assert.doesNotMatch(JSON.stringify(c), /Private provider/);
  });
}
test('untrusted oversized/invalid errors keep HTTP status and never invent verification or expose provider prose', async t => {
  const f = await setup(t);
  for (const body of ['<html>provider outage</html>', JSON.stringify({ error: { ...verification.error, padding: 'x'.repeat(20000) } })]) {
    f.reply(() => new Response(body, { status: 403 })); await assert.rejects(f.app.refreshModels('coral'), /model_access_denied/); assert.deepEqual(f.app.store.read().connections[0].modelError, { httpStatus: 403 });
  }
  f.app.store.transact(s => { s.connections[0].apiService = 'river'; }); f.reply(() => Response.json(verification, { status: 403 })); await assert.rejects(f.app.refreshModels('coral'), /model_access_denied/);
  f.reply(() => { throw new TypeError('fixture network down'); }); await assert.rejects(f.app.refreshModels('coral')); assert.equal(f.app.store.read().connections[0].modelError, undefined);
});
