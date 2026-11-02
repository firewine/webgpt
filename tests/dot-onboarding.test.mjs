import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { workspace } from './workspace-helpers.mjs';
import { saveDotGrant, prepareDotPackage } from '../scripts/dot-mcp-ops.mjs';
import { projectDotConnection } from '../dist/server/workspace/dot-mcp-status.js';
import { projectReadiness } from '../scripts/readiness.mjs';

test('D4 owner routes preserve idempotency and scope; refresh never creates requests or exposes credentials', async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false }); let calls = 0;
  f.app.providers.complete = async () => { calls++; throw Error('No models during setup'); };
  const roomId = f.app.store.read().resident.rooms[0].id, key = crypto.randomUUID();
  assert.equal((await fetch(f.url + '/api/dot/status')).status, 401);
  assert.equal((await f.api('/api/dot/connections', { roomId, label: 'bad' }, { headers: { Origin: 'https://foreign.example' } })).status, 403);
  const registered = await Promise.all(Array.from({ length: 20 }, () => f.api('/api/dot/connections', { roomId, label: 'dot fixture', role: 'review' }, { headers: { 'Idempotency-Key': key } }).then(r => r.json())));
  assert.equal(new Set(registered.map(r => r.connectionId)).size, 1); const { connectionId, participantId } = registered[0];
  assert.equal(f.app.store.read().resident.rooms[0].members.find(m => m.participantId === participantId).enabled, false);
  const base = `/api/dot/connections/${connectionId}`, request = { expectedVersion: 1, ownerConfirmed: true, expiresAt: new Date(Date.now() + 86400000).toISOString() };
  assert.equal((await f.api(base + '/confirm', { ...request, tools: ['codex_send'] })).status, 400);
  assert.equal((await f.api(base + '/confirm', { ...request, ownerConfirmed: false })).status, 409);
  const cmd = crypto.randomUUID(), confirms = await Promise.all(Array.from({ length: 20 }, () => f.api(base + '/confirm', request, { headers: { 'Idempotency-Key': cmd } }).then(r => r.json())));
  assert.equal(new Set(confirms.map(r => r.token)).size, 1); const token = confirms[0].token; assert.ok(token?.length >= 32);
  assert.equal((await f.api('/api/dot/status', undefined, { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  const before = f.app.store.read(), cursor = f.app.store.cursor();
  for (let i = 0; i < 20; i++) {
    const state = await (await f.api('/api/state')).json(), status = await (await f.api('/api/dot/status')).json();
    assert.equal(status.connections[0].authority, 'active'); assert.equal(status.connections[0].subscription, 'none'); assert.equal(status.connections[0].ready, false);
    assert.ok(!JSON.stringify([state,status,f.app.store.events(0)]).includes(token));
  }
  assert.deepEqual(f.app.store.read(), before); assert.equal(f.app.store.cursor(), cursor); assert.equal(calls, 0);
  assert.equal((await f.api(base + '/revoke', { expectedVersion: 1 })).status, 409);
  const revoke = crypto.randomUUID(); for (let i = 0; i < 20; i++) assert.equal((await f.api(base + '/revoke', { expectedVersion: 2 }, { headers: { 'Idempotency-Key': revoke } })).status, 200);
  const status = await (await f.api('/api/dot/status')).json(); assert.equal(status.connections[0].authority, 'revoked');
  assert.equal(status.connections[0].nativeActorVerified, false); assert.equal(f.app.store.read().dotMcp.requests.items.length, 0);
});

test('D4 status distinguishes expired/revoked authority, delivered events, held replies and preserved old generations without raw data', async t => {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false });
  const roomId = f.app.store.read().resident.rooms[0].id;
  const b = f.app.dotMcp.register({ roomId, label: 'dot' }, crypto.randomUUID());
  f.app.dotMcp.confirm({ connectionId: b.connectionId, expectedVersion: 1, ownerConfirmed: true, tools: ['dot_turn_get','dot_turn_claim','dot_turn_submit'], expiresAt: new Date(Date.now()+86400000).toISOString() },crypto.randomUUID());
  const s = f.app.store.read(), binding = s.dotMcp.bindings[0];
  s.dotMcp.requests.items.push({ id: 'request', connectionId: b.connectionId, status: 'waiting', discussionId: null, claim: null, prompt: 'PRIVATE INPUT', reply: null });
  s.dotMcp.events.outbox.push({ requestId: 'request', status: 'delivered', attempts: [{ httpStatus: 200 }], body: 'PRIVATE CALLBACK BODY' });
  const project = () => projectDotConnection(s,binding,true);
  assert.equal(project().delivery, 'delivered'); assert.equal(project().response, 'waiting');
  s.dotMcp.requests.items[0].claim = { status: 'active', hash: 'PRIVATE CLAIM' }; assert.equal(project().response,'claimed');
  s.dotMcp.requests.items[0].reply = { receipt: 'receipt', text: 'PRIVATE REPLY' }; assert.equal(project().response,'received');
  s.dotMcp.requests.items[0].status = 'held'; assert.equal(project().response,'unconfirmed');
  s.dotMcp.requests.items[0].status = 'quarantined'; assert.equal(project().response,'quarantined');
  s.resident.rooms[0].epoch++; assert.equal(project().authority,'active');
  s.dotMcp.grants[0].expiresAt = new Date(0).toISOString(); assert.equal(project().authority,'expired');
  const raw = JSON.stringify(project()); assert.doesNotMatch(raw,/PRIVATE/);
  const readiness = projectReadiness({ ...f.app.snapshot(), dotMcp: { enabled:true, connections:[project()] } }, f.app.config);
  assert.equal(readiness.dot.ready,0); assert.deepEqual(readiness.dot.issues,['dot_expired']); assert.doesNotMatch(JSON.stringify(readiness),/PRIVATE|request|receipt/);
});

test('D4 setup writes a new private grant/package only; rejects overwrite, link and invalid ID without external execution', async t => {
  const dir = await mkdtemp(join(tmpdir(),'wj-dot-setup-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const token = 'fixture_dot_private_grant_1234567890abcdef', file = join(dir,'grant');
  await saveDotGrant(file,token); assert.equal((await stat(file)).mode & 0o777,0o600);
  await assert.rejects(saveDotGrant(file,token+'changed')); assert.equal((await readFile(file,'utf8')).trim(),token);
  await symlink(file,join(dir,'linked')); await assert.rejects(saveDotGrant(join(dir,'linked'),token));
  await assert.rejects(saveDotGrant(join(dir,'bad'),'short')); await assert.rejects(prepareDotPackage(join(dir,'bad-package'),'tunnel_not_an_app'));
  const target = join(dir,'package'); assert.deepEqual(await prepareDotPackage(target,'plugin_asdk_app_fixture'),{status:'PREPARED',installed:'UNVERIFIED',authentication:'UNVERIFIED'});
  const app = JSON.parse(await readFile(join(target,'.app.json'),'utf8')); assert.equal(app.apps['webjjoku-dot'].id,'plugin_asdk_app_fixture');
  assert.doesNotMatch(await readFile(join(target,'plugin.json'),'utf8'),/token|tunnel_|auth.*none|http:\/\/127/);
  await assert.rejects(prepareDotPackage(target,'plugin_asdk_app_different')); assert.equal(JSON.parse(await readFile(join(target,'.app.json'),'utf8')).apps['webjjoku-dot'].id,'plugin_asdk_app_fixture');
});

async function forward(port, file) {
  const child = spawn(process.execPath, ['scripts/mcp-stdio.mjs'], { cwd: new URL('../', import.meta.url), env: { PATH:process.env.PATH, WJ_PORT:String(port), WJ_MCP_GRANT_FILE:file, WJ_MCP_EXPECT_DOT:'true' }, stdio:['pipe','pipe','pipe'] });
  let stdout='', stderr=''; child.stdout.on('data',chunk=>stdout+=chunk); child.stderr.on('data',chunk=>stderr+=chunk);
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:73,method:'tools/list',params:{}})+'\n');
  const [exit] = await once(child,'close'); return {exit,stdout,stderr};
}

test('D4 private stdio bridge checks native metadata and forwards scoped tools only, never owner credentials or a model call', async t => {
  const f=await workspace(t,{residentEnabled:true},{residentAutoSchedule:false});
  const b=f.app.dotMcp.register({roomId:f.app.store.read().resident.rooms[0].id,label:'dot'},crypto.randomUUID());
  const grant=f.app.dotMcp.confirm({connectionId:b.connectionId,expectedVersion:1,ownerConfirmed:true,tools:['dot_turn_get','dot_turn_claim','dot_turn_submit'],expiresAt:new Date(Date.now()+86400000).toISOString()},crypto.randomUUID());
  const file=join(f.directory,'bridge-grant');await saveDotGrant(file,grant.token);const cursor=f.app.store.cursor();
  const result=await forward(new URL(f.url).port,file);assert.equal(result.exit,0);assert.equal(result.stderr,'');
  const message=JSON.parse(result.stdout);assert.equal(message.id,73);assert.deepEqual(message.result.tools.map(t=>t.name),['dot_turn_get','dot_turn_claim','dot_turn_submit']);
  assert.equal(f.app.store.cursor(),cursor);assert.equal(f.app.store.read().dotMcp.requests.items.length,0);assert.ok(!result.stdout.includes(grant.token));
  const ownerFile=join(f.directory,'wrong-owner-key');const {ownerKey}=await import('./workspace-helpers.mjs');await saveDotGrant(ownerFile,ownerKey);
  const wrong=await forward(new URL(f.url).port,ownerFile);assert.equal(wrong.exit,1);assert.equal(wrong.stdout,'');assert.ok(!wrong.stderr.includes(ownerKey));assert.equal(f.app.store.cursor(),cursor);
});

test('D4 private bridge refuses a different loopback service before forwarding any credential or RPC', async t => {
  const dir=await mkdtemp(join(tmpdir(),'wj-dot-bridge-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'grant');const token='fixture_private_dot_grant_1234567890abcdef';await saveDotGrant(file,token);
  const paths=[];const server=createServer((req,res)=>{paths.push(req.url);assert.equal(req.headers.authorization,undefined);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',service:'another-app'}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await forward(server.address().port,file);assert.equal(result.exit,1);assert.equal(result.stdout,'');assert.ok(!result.stderr.includes(token));assert.deepEqual(paths,['/health']);
});
