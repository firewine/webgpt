import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { OAuthService } from '../dist/server/connections/oauth.js';
import { storage } from './workspace-helpers.mjs';
import { unusedPort } from './helpers.mjs';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
async function fixture(t) {
  const { store, vault } = await storage(t); const keys = await generateKeyPair('RS256'); const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map(); let refreshCount = 0; const revoked = []; const requests = [];
  const request = async (raw, options) => {
    const url = String(raw); requests.push({ url, options });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/revoke')) { revoked.push(options.body.get('token')); return new Response('', { status: 200 }); }
    const params = options.body; assert.equal(params.get('resource'), 'https://api.openai.com/v1');
    if (params.get('grant_type') === 'refresh_token') { refreshCount++; await new Promise(r => setTimeout(r, 10)); return Response.json({ access_token: `fresh-${params.get('client_id')}`, refresh_token: `rotated-${params.get('client_id')}`, expires_in: 3600, token_type: 'Bearer' }); }
    const code = codes.get(params.get('code')); assert.ok(code); assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), code.challenge); assert.equal(params.get('redirect_uri'), code.redirect);
    const token = await new SignJWT({ sub: code.subject, nonce: code.nonce, email: `${code.subject}@example.test` }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://auth.openai.com').setAudience(code.audience ?? params.get('client_id')).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
    return Response.json({ access_token: `secret-${code.subject}`, refresh_token: `refresh-${code.subject}`, id_token: token, expires_in: code.expires ?? 3600, token_type: 'Bearer', scope: code.scope ?? scope });
  };
  const service = new OAuthService(store, vault, await unusedPort(), request); t.after(() => service.close());
  async function signin(subject, extra = {}, connectionId, expectedEmail) {
    const begin = await service.begin(subject, connectionId, expectedEmail); const url = new URL(begin.authorizationUrl); const code = `code-${subject}-${codes.size}`;
    codes.set(code, { subject, nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), redirect: url.searchParams.get('redirect_uri'), ...extra });
    const params = new URLSearchParams({ state: url.searchParams.get('state'), code, client_id: connectionId ? store.read().connections.find(c => c.id === connectionId).clientId : `issued-${subject}` });
    return { begin, url, params };
  }
  return { store, vault, service, signin, revoked, requests, refreshCount: () => refreshCount };
}
test('PKCE callback, issued client identity, two accounts, serialized rotation and selective revocation', async t => {
  const f = await fixture(t); const a = await f.signin('alice', { expires: 5 }); const b = await f.signin('bob');
  assert.equal(a.url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(a.url.searchParams.get('scope'), scope); assert.notEqual(a.url.searchParams.get('state'), b.url.searchParams.get('state'));
  await f.service.finish(a.params); await f.service.finish(b.params); await assert.rejects(f.service.finish(a.params), /invalid_oauth_state/);
  const [x, y] = await Promise.all([f.service.access(a.begin.connectionId), f.service.access(a.begin.connectionId)]); assert.equal(x, 'fresh-issued-alice'); assert.equal(y, x); assert.equal(f.refreshCount(), 1);
  assert.equal(await f.service.access(b.begin.connectionId), 'secret-bob');
  assert.doesNotMatch(JSON.stringify(f.store.read()), /secret-alice|secret-bob|refresh-alice|rotated-issued/);
  assert.deepEqual(await f.service.signOut(a.begin.connectionId), { revoked: true }); assert.deepEqual(f.revoked, ['rotated-issued-alice']);
  assert.equal(await f.service.access(b.begin.connectionId), 'secret-bob'); assert.equal(f.vault.get(a.begin.connectionId), null);
});
test('rejects wrong nonce, audience, account substitution and missing inference scope', async t => {
  const f = await fixture(t);
  const badNonce = await f.signin('wrong-nonce', { nonce: 'attacker' }); await assert.rejects(f.service.finish(badNonce.params), /invalid_nonce/); assert.equal(f.vault.get(badNonce.begin.connectionId), null);
  const badAudience = await f.signin('wrong-audience', { audience: 'other-client' }); await assert.rejects(f.service.finish(badAudience.params));
  const good = await f.signin('original'); await f.service.finish(good.params);
  const replacement = await f.signin('intruder', {}, good.begin.connectionId); await assert.rejects(f.service.finish(replacement.params), /oauth_account_mismatch/);
  assert.equal(f.store.read().connections.find(c => c.id === good.begin.connectionId).subject, 'original');
  const restricted = await f.signin('restricted', { scope: 'openid profile email' }); await f.service.finish(restricted.params); await assert.rejects(f.service.access(restricted.begin.connectionId), /auth_required/);
});
test('transient model discovery state does not destroy a valid OAuth session', async t => {
  const f = await fixture(t); const good = await f.signin('recoverable'); await f.service.finish(good.params);
  f.store.transact(s => { s.connections[0].status = 'error'; s.connections[0].error = 'model_discovery_failed'; });
  assert.equal(await f.service.access(good.begin.connectionId), 'secret-recoverable');
});
test('expected web GPT account rejects accidental dot account before storing credentials', async t => {
  const f = await fixture(t); const wrong = await f.signin('dot-account', {}, undefined, 'web-account@example.test');
  await assert.rejects(f.service.finish(wrong.params), /oauth_account_mismatch/);
  assert.equal(f.vault.get(wrong.begin.connectionId), null);
  const right = await f.signin('web-account', {}, undefined, 'WEB-ACCOUNT@EXAMPLE.TEST'); await f.service.finish(right.params);
  assert.equal(await f.service.access(right.begin.connectionId), 'secret-web-account');
  assert.equal(f.store.read().connections.find(c => c.id === right.begin.connectionId).expectedEmail, 'web-account@example.test');
});

test('reopening an active sign-in twenty times resumes one PKCE attempt and keeps account/callback single use', async t => {
  const f = await fixture(t); const a = await f.signin('recover', {}, undefined, 'recover@example.test');
  const resumed = await Promise.all(Array.from({ length: 20 }, () => f.service.begin('Recover', a.begin.connectionId, 'recover@example.test')));
  assert.ok(resumed.every(value => JSON.stringify(value) === JSON.stringify(a.begin))); assert.equal(f.store.read().connections.length, 1); assert.equal(f.requests.length, 0);
  await assert.rejects(f.service.begin('Different', a.begin.connectionId, 'different@example.test'), /signin_account_pending/);
  assert.equal(f.store.read().connections[0].expectedEmail, 'recover@example.test');
  await f.service.finish(a.params); assert.equal(await f.service.access(a.begin.connectionId), 'secret-recover');
  await assert.rejects(f.service.finish(a.params), /invalid_oauth_state/); assert.equal(f.requests.filter(r => r.url.endsWith('/token')).length, 1);
});

test('resuming does not extend the ten minute sign-in lifetime; expired callbacks cannot replace the new attempt', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); const f = await fixture(t); const a = await f.signin('expiry');
  t.mock.timers.tick(590_000); assert.deepEqual(await f.service.begin('Expiry', a.begin.connectionId), a.begin);
  t.mock.timers.tick(10_001); const next = await f.service.begin('Expiry', a.begin.connectionId); assert.notEqual(next.attemptId, a.begin.attemptId); assert.notEqual(next.authorizationUrl, a.begin.authorizationUrl);
  await assert.rejects(f.service.finish(a.params), /invalid_oauth_state/); assert.equal(f.requests.length, 0); assert.equal(f.store.read().connections.length, 1);
});
