import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { workspace, until, response } from './workspace-helpers.mjs';
import { CODEX_CLIENT_ID } from '../dist/server/connections/codex-oauth.js';

export async function deviceFixture(t, options = {}) {
  const f = await workspace(t); const key = await generateKeyPair('RS256'); const jwk = { ...await exportJWK(key.publicKey), kid: 'device-fixture', alg: 'RS256' };
  const grants = [], auth = [], resource = [], gates = [], tokens = new Map(); let refreshes = 0; let clock = Date.now();
  const controls = { poll: [], expiresIn: 3600, email: null, subject: null, accountId: null, badAudience: false, badSignature: false, refreshStatus: 200, streamComplete: true, ...options };
  f.app.codexOAuth.options = { clock: () => clock, wait: (ms, signal) => new Promise((resolve, reject) => {
    const gate = { ms, resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
    const abort = () => { const i = gates.indexOf(gate); if (i >= 0) gates.splice(i, 1); reject(new Error('fixture cancelled')); }; signal.addEventListener('abort', abort, { once: true });
    gates.push(gate);
  }) };
  const tokenValue = async (grant, refresh = false) => {
    const subject = controls.subject ?? grant.subject; const email = controls.email ?? grant.email; const accountId = controls.accountId ?? 'account-' + subject;
    const idToken = await new SignJWT({ sub: subject, email, 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }).setProtectedHeader({ alg: 'RS256', kid: 'device-fixture' }).setIssuer('https://auth.openai.com').setAudience(controls.badAudience ? 'other-client' : CODEX_CLIENT_ID).setIssuedAt().setExpirationTime('1h').sign(controls.badSignature ? (await generateKeyPair('RS256')).privateKey : key.privateKey);
    const token = 'fixture-access-' + grant.subject + (refresh ? '-rotation-' + ++refreshes : ''); tokens.set(token, grant.subject);
    return { access_token: token, refresh_token: 'fixture-refresh-' + grant.id, id_token: idToken, expires_in: controls.expiresIn, token_type: 'Bearer' };
  };
  const request = async (url, o = {}) => {
    auth.push({ url, options: o });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/fixture-jwks' });
    if (url.endsWith('/fixture-jwks')) return Response.json({ keys: [jwk] });
    assert.equal(o.redirect, 'error');
    if (url.endsWith('/deviceauth/usercode')) { assert.equal(JSON.parse(o.body).client_id, CODEX_CLIENT_ID); const c = f.app.store.read().connections.findLast(c => c.kind === 'codex-oauth' && c.deviceSignin?.status === 'starting'); const grant = { id: 'device-' + (grants.length + 1), subject: c.expectedEmail.split('@')[0], email: c.expectedEmail }; grants.push(grant); return Response.json({ device_auth_id: grant.id, usercode: 'TEST-' + grants.length, interval: '1' }); }
    if (url.endsWith('/deviceauth/token')) { const b = JSON.parse(o.body); const grant = grants.find(g => g.id === b.device_auth_id); assert.ok(grant); const status = controls.poll.shift() ?? 200; if (status !== 200) return new Response('', { status }); const verifier = 'fixture-verifier-' + grant.id; return Response.json({ authorization_code: 'code-' + grant.id, code_verifier: verifier, code_challenge: createHash('sha256').update(verifier).digest('base64url') }); }
    if (url.endsWith('/oauth/token')) { const b = o.body; assert.equal(b.get('client_id'), CODEX_CLIENT_ID); assert.equal(b.has('resource'), false); const refresh = b.get('grant_type') === 'refresh_token'; const grant = grants.find(g => refresh ? b.get('refresh_token') === 'fixture-refresh-' + g.id : b.get('code') === 'code-' + g.id); assert.ok(grant); if (refresh && controls.refreshStatus !== 200) return new Response('', { status: controls.refreshStatus }); if (!refresh) { assert.equal(b.get('code_verifier'), 'fixture-verifier-' + grant.id); assert.equal(b.get('redirect_uri'), 'https://auth.openai.com/deviceauth/callback'); } return Response.json(await tokenValue(grant, refresh)); }
    assert.fail('Unexpected auth fixture URL');
  };
  f.app.oauth.request = request; f.app.codexOAuth.request = request; f.app.providers.codexVersion = async () => '0.165.0';
  f.app.providers.request = async (url, o) => {
    resource.push({ url, options: o }); const subject = tokens.get(o.headers.Authorization.slice(7)); assert.ok(subject); assert.equal(o.headers['ChatGPT-Account-Id'], 'account-' + subject); assert.equal(o.redirect, 'error');
    if (url.includes('/models?')) return Response.json({ models: [{ slug: 'gpt-fixture-' + subject, display_name: 'GPT fixture ' + subject, visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'xhigh' }] }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }] });
    assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses'); const body = JSON.parse(o.body); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.reasoning.effort, 'xhigh');
    const prompt = body.input.at(-1).content[0].text; const text = prompt.includes('"topic":') ? response(prompt, { id: subject, label: subject }) : 'fixture answer for ' + subject;
    const events = [{ type: 'response.created', response: { id: 'receipt-' + resource.length } }, { type: 'response.output_text.delta', delta: text }, ...(controls.streamComplete ? [{ type: 'response.completed', response: { id: 'receipt-' + resource.length, status: 'completed', usage: { input_tokens: 12, output_tokens: 34 } } }] : [])];
    return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const release = async () => { const gate = await until(() => gates[0]); gates.shift(); gate.resolve(); await new Promise(r => setImmediate(r)); };
  const signin = async (name, requestId = crypto.randomUUID()) => { const result = await f.app.codexOAuth.begin({ label: name, expectedEmail: name + '@example.test' }, requestId); await release(); await until(() => ['completed', 'failed', 'expired'].includes(f.app.codexOAuth.status(result.connectionId).status)); return result; };
  return { ...f, auth, resource, grants, controls, gates, release, signin, advance: ms => { clock += ms; }, refreshes: () => refreshes };
}
