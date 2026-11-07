import test from 'node:test';
import assert from 'node:assert/strict';
import { issueAuthority, authorityReason, bindingDigest, grantDigest, discussionDigest, assertJobAuthority, initializeExecutionProtection } from '../dist/server/execution/authority.js';
import { initialState } from '../dist/server/workspace/model.js';
const fixture = () => {
  const s = initialState('fixture'); initializeExecutionProtection(s);
  const b = { id: 'binding', label: 'fixture', host: 'host', user: 'owner', cwd: '/fixture', repoRoot: '/fixture', threadId: 'thread', branch: 'feature', head: 'head', allowWrite: false, status: 'ready', sessionTreeId: null, authority: issueAuthority(24) };
  s.bindings.push(b);
  const j = { id: 'job', bindingId: b.id, discussionId: null, taskId: null, authority: { version: 1, binding: { id: b.id, epoch: b.authority.epoch, expiresAt: b.authority.expiresAt, scopeDigest: bindingDigest(b) } } };
  return { s, b, j };
};
test('authority defaults to 24h with owner-selected 1..168h; invalid, expired and legacy authority fail closed', () => {
  const clock = Date.now(); const a = issueAuthority(undefined, 1, clock);
  assert.equal(Date.parse(a.expiresAt) - clock, 24 * 3600000); assert.equal(authorityReason(a, clock), null);
  for (const h of [0, 169, '24', 1.5]) assert.throws(() => issueAuthority(h), /invalid_number/);
  assert.equal(authorityReason(undefined), 'execution_authority_legacy');
  assert.equal(authorityReason(a, Date.parse(a.expiresAt)), 'execution_authority_expired');
  assert.equal(authorityReason({ ...a, version: 2 }), 'execution_authority_invalid');
  assert.equal(authorityReason({ ...a, revokedAt: new Date(clock).toISOString() }), 'execution_authority_revoked');
});
test('job authority fences identity, generation, target changes and grant revocation independently of command receipts', () => {
  for (const change of [b => b.authority.epoch++, b => b.authority.expiresAt = new Date(Date.now()+1000).toISOString(), b => b.cwd = '/other', b => b.threadId = 'other', b => b.branch = 'main', b => b.head = 'different', b => b.allowWrite = true]) {
    const { s,b,j } = fixture(); assert.doesNotThrow(() => assertJobAuthority(s,j)); change(b); assert.throws(() => assertJobAuthority(s,j), /execution_authority_changed/);
  }
  const {s,b,j}=fixture(); const g = {id:'grant',revoked:false,discussionId:'discussion',participantId:'actor',tools:['codex_send'],authority:issueAuthority(1)};
  s.grants.push(g); s.discussions.push({id:g.discussionId,status:'running',revision:1,executionBindingId:b.id,tasks:[{id:'task',participantId:'actor'}]}); j.discussionId=g.discussionId; j.taskId='task';j.revision=1;j.authority.discussion={scopeDigest:discussionDigest(s,j)};
  j.authority.grant={id:g.id,epoch:1,expiresAt:g.authority.expiresAt,scopeDigest:grantDigest(g)}; assert.doesNotThrow(()=>assertJobAuthority(s,j));
  g.revoked=true; assert.throws(()=>assertJobAuthority(s,j),/execution_grant_revoked_or_changed/);
  g.revoked=false; g.tools=[]; assert.throws(()=>assertJobAuthority(s,j),/execution_grant_revoked_or_changed/);
  delete b.authority; assert.throws(()=>assertJobAuthority(s,j),/execution_authority_legacy/);
});
test('execution schema migration preserves all legacy records and refuses future, missing and malformed metadata', () => {
  const s=initialState('fixture'); s.bindings.push({id:'old'}); s.jobs.push({id:'old-job'}); initializeExecutionProtection(s);
  assert.equal(s.bindings[0].id,'old'); assert.equal(s.jobs[0].id,'old-job'); assert.equal(s.executionProtectionVersion,1);
  assert.throws(()=>initializeExecutionProtection({...s,executionProtectionVersion:2}),/unsupported_execution_protection_schema/);
  const f=fixture(); delete f.s.executionProtectionVersion; assert.throws(()=>initializeExecutionProtection(f.s),/execution_protection_state_missing/);
  f.s.executionProtectionVersion=1; f.b.authority.epoch=0; assert.throws(()=>initializeExecutionProtection(f.s),/invalid_execution_authority_state/);
});
