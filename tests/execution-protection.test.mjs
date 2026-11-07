import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexExecutor } from '../dist/server/execution/codex.js';
import { McpEndpoint } from '../dist/server/http/mcp.js';
import { workspace, until, topic } from './workspace-helpers.mjs';
const script=fileURLToPath(new URL('fixtures/codex-rpc.mjs',import.meta.url));
async function fixture(t,mode='normal') {
  const f=await workspace(t); f.app.engine.kick=()=>{};
  const cwd=await mkdtemp(join(tmpdir(),'wj-protection-integration-'));
  execFileSync('git',['init','-q','-b','work-fixture'],{cwd});
  await writeFile(join(cwd,'source.txt'),'baseline\n');
  execFileSync('git',['add','source.txt'],{cwd});
  execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','baseline'],{cwd});
  f.app.codex.close(); const codex=new CodexExecutor(f.app.store,[process.execPath,script,mode],[cwd],[],{secrets:()=>['fixture-private-key-123456789']});
  f.app.codex=codex; t.after(()=>{codex.close();return rm(cwd,{recursive:true,force:true});});
  const bindingId=await codex.register({cwd,label:'synthetic adapter only',threadId:'fixture-thread',expiresInHours:1});
  return {...f,cwd,codex,bindingId,job:()=>f.app.store.read().jobs.at(-1),trace:async()=> (await readFile(join(cwd,'rpc-trace.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)};
}
test('queued authority expires before dispatch: no start and no old command receipt after re-registration',async t=>{
 const f=await fixture(t); const kick=f.codex.kick.bind(f.codex); f.codex.kick=()=>{};
 const input={bindingId:f.bindingId,prompt:'fixture',requestId:'expired'}; f.codex.submit(input);
 f.app.store.transact(s=>{s.bindings[0].authority.revokedAt=new Date().toISOString();}); kick();
 await until(()=>f.job().status==='failed'); assert.match(f.job().error,/execution_authority_revoked/);
 assert.equal((await f.trace()).filter(m=>m.method==='turn/start').length,0);
 await f.codex.register({cwd:f.cwd,label:'renewed',threadId:'fixture-thread'});
 assert.throws(()=>f.codex.submit(input),/execution_authority_changed/); assert.equal(f.app.store.read().jobs.length,1);
});
test('active binding revocation requests interrupt; late approval and result publication stay denied',async t=>{
 const f=await fixture(t,'approval');const jid=f.codex.submit({bindingId:f.bindingId,prompt:'fixture',requestId:'active'});
 await until(()=>f.job().status==='blocked_approval'); await f.codex.revokeBinding(f.bindingId);
 assert.throws(()=>f.codex.decide(jid,'017','accept'),/execution_binding_not_ready|approval_not_pending/);
 await until(()=>f.job().status==='interrupted'); assert.ok(f.job().resultScopeReason); assert.equal(f.job().approvals[0].status,'resolved');
 const trace=await f.trace();assert.equal(trace.filter(m=>m.method==='turn/start').length,1);assert.equal(trace.filter(m=>m.id==='017'&&m.result?.decision==='accept').length,0);
 assert.equal(trace.filter(m=>m.method==='turn/interrupt').length,1);
});
test('general grant revocation fences its queued Codex dispatch and stored authority includes the grant origin',async t=>{
 const f=await fixture(t);f.app.engine.create({...topic,executionBindingId:f.bindingId},'topic');const s=f.app.store.read();const d=s.discussions[0];const task=d.tasks[0];
 const mcp=new McpEndpoint(f.app);const access=mcp.createGrant({discussionId:d.id,participantId:task.participantId,tools:['codex_send','codex_result']});
 f.codex.kick=()=>{};const jid=f.codex.submit({bindingId:f.bindingId,prompt:'fixture',requestId:'grant-job',discussionId:d.id,taskId:task.id,revision:d.revision,grantId:access.id});
 assert.equal(f.job().authority.grant.id,access.id);await f.api('/api/grants/revoke',{id:access.id});
 assert.equal(f.job().status,'failed');assert.ok(f.job().resultScopeReason);assert.equal(f.job().id,jid);
 assert.equal((await f.trace()).filter(m=>m.method==='turn/start').length,0);
});
test('complete command metadata survives large preview truncation; private raw is paged only through owner policy',async t=>{
 const f=await fixture(t,'hold');const jid=f.codex.submit({bindingId:f.bindingId,prompt:'fixture',requestId:'capture'});await until(()=>!!f.job().turnId);const j=f.job();
 // Deterministic RPC fixture: inject a full observed terminal packet, not a real model or shell execution.
 const packet={id:j.turnId,status:'completed',items:[{id:'large-command',type:'commandExecution',status:'completed',command:'fixture-command',exitCode:0,aggregatedOutput:'public '.repeat(20000)+'fixture-private-key-123456789'},{id:'message',type:'agentMessage',text:'public fixture-private-key-123456789 end'}]};
 f.codex.completeFromTurn(f.bindingId,packet);
 assert.equal(f.job().capture.complete,true);assert.equal(f.job().activities[0].command.exitCode,0);assert.equal(f.job().activities[0].truncated,true);
 const snapshot=await (await f.api('/api/state',undefined)).json();assert.doesNotMatch(JSON.stringify(snapshot),/fixture-private-key-123456789/);
 const forbidden=await fetch(f.url+`/api/jobs/${jid}/evidence?page=0`,{headers:{Origin:f.url}});assert.equal(forbidden.status,401);
 const raw=[];let next=0,descriptor;
 do{const res=await f.api(`/api/jobs/${jid}/evidence?page=${next}`,undefined);assert.equal(res.status,200);const p=await res.json();if(descriptor)assert.equal(p.digest,descriptor.digest);descriptor=p;raw.push(p.text);next=p.nextPage;}while(next!==null);
 assert.match(raw.join(''),/fixture-private-key-123456789/);assert.ok(descriptor.pageCount>1);
 assert.equal((await f.api(`/api/jobs/${jid}/evidence?page=-1`,undefined)).status,400);
 assert.equal((await f.api('/api/jobs/unknown/evidence?page=0',undefined)).status,404);
 await f.codex.cancel(jid).catch(()=>{});
});
test('protected-copy job requires separate diff and explicit one-file apply; stale digest and duplicate command never apply twice',async t=>{
 const f=await fixture(t,'hold');
 // Explicit test-only DI. This synthetic adapter does not claim real OS isolation; isolation has its own real-command acceptance tests.
 f.codex.isolation.verify=async()=>{};f.codex.isolation.commandFor=()=>[process.execPath,script,'hold','',f.cwd,f.directory];
 f.app.store.transact(s=>{s.bindings[0].authority.revokedAt=new Date().toISOString();});
 await f.codex.register({cwd:f.cwd,label:'protected synthetic adapter',threadId:'fixture-thread',allowWrite:true});
 const jid=f.codex.submit({bindingId:f.bindingId,prompt:'one existing text file',requestId:'draft'});
 await until(()=>f.job().turnId);const m=f.codex.workspaces.manifest(jid);await writeFile(join(m.copyRoot,'source.txt'),'changed in draft\n');
 assert.equal(await readFile(join(f.cwd,'source.txt'),'utf8'),'baseline\n');
 f.codex.completeFromTurn(f.bindingId,{id:f.job().turnId,status:'completed',items:[{id:'message',type:'agentMessage',text:'synthetic change, awaiting owner'}]});
 await until(()=>f.job().draft.status==='pending');const diff=await f.codex.inspectDraft(jid);assert.match(diff.files[0].diff,/changed in draft/);
 await assert.rejects(f.codex.applyDraft(jid,'0'.repeat(64),'bad'),/draft_not_applicable/);assert.equal(await readFile(join(f.cwd,'source.txt'),'utf8'),'baseline\n');
 const result=await f.codex.applyDraft(jid,diff.diffDigest,'apply-once');assert.equal(result.path,'source.txt');assert.equal(await readFile(join(f.cwd,'source.txt'),'utf8'),'changed in draft\n');
 assert.deepEqual(await f.codex.applyDraft(jid,diff.diffDigest,'apply-once'),result);assert.equal(f.job().draft.status,'applied');
 await assert.rejects(f.codex.applyDraft(jid,diff.diffDigest,'new-command'),/draft_not_applicable/);
 const events=f.app.store.events(0);assert.ok(events.find(e=>e.type==='codex.application_intent').id<events.find(e=>e.type==='codex.application_completed').id);
});
test('unsupported protected-write adapter stays blocked before reading a real thread',async t=>{
 const f=await fixture(t);f.app.store.transact(s=>{s.bindings[0].authority.revokedAt=new Date().toISOString();});
 await assert.rejects(f.codex.register({cwd:f.cwd,label:'unsupported',threadId:'fixture-thread',allowWrite:true}));
 assert.equal(f.app.store.read().jobs.length,0);assert.equal((await f.trace()).filter(m=>m.method==='turn/start').length,0);
});

test('raw loss between remote completion and work publication cannot become accepted evidence',async t=>{
 const { executionFixture }=await import('./work-execution-fixture.mjs');
 const f=await executionFixture(t);const taskId=f.proposeCode();f.bridge.tick();
 await until(()=>f.app.store.read().jobs[0]?.status==='completed');
 const job=f.app.store.read().jobs[0];await rm(join(f.directory,'execution-evidence',job.capture.artifactId,'raw.ndjson'));
 f.bridge.tick();const s=f.app.store.read();assert.equal(s.jobs[0].capture.complete,false);assert.equal(f.task(taskId).currentReportId,null);
 assert.equal(f.task(taskId).reports.length,0);assert.equal(s.resident.jobLinks[0].result.scopeReason,'execution_capture_integrity_changed');
 assert.equal(s.resident.jobLinks[0].result.report.checks[0].outcome,'unknown');assert.equal(s.jobs.length,1);
});

async function completedDraft(f,cwd,bindingId,jobId,changed) {
 const { issueAuthority,bindingDigest }=await import('../dist/server/execution/authority.js');
 const git=args=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
 const binding={id:bindingId,label:'synthetic complete job',host:'fixture',user:'fixture',cwd,repoRoot:cwd,threadId:'synthetic-'+bindingId,branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),status:'ready',allowWrite:true,sessionTreeId:null,authority:issueAuthority(24),protection:{version:1,status:'ready',reason:null}};
 const m=await f.codex.workspaces.prepare(jobId,binding);await writeFile(join(m.copyRoot,'source.txt'),changed);const inspection=await f.codex.workspaces.inspect(jobId);
 f.codex.evidence.begin(jobId);f.codex.evidence.append(jobId,'turn/completed',{id:'synthetic-turn',status:'completed'});const capture=f.codex.evidence.finish(jobId);
 f.app.store.transact(s=>{s.bindings.push(binding);s.jobs.push({id:jobId,bindingId,discussionId:null,taskId:null,revision:null,requestId:jobId,prompt:'fixture',promptDigest:'fixture',status:'completed',threadId:binding.threadId,turnId:'synthetic-turn',createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),maxDurationMs:300000,deadlineAt:null,text:'fixture',error:null,activities:[],approvals:[],authority:{version:1,binding:{id:binding.id,epoch:binding.authority.epoch,expiresAt:binding.authority.expiresAt,scopeDigest:bindingDigest(binding)}},capture,draft:{version:1,status:'pending',manifestDigest:m.digest,diffDigest:inspection.diffDigest}});});
 return {jobId,digest:inspection.diffDigest};
}
test('apply command input is durably reserved before different repositories can write',async t=>{
 const f=await fixture(t);const cwd2=await mkdtemp(join(tmpdir(),'wj-second-apply-'));t.after(()=>rm(cwd2,{recursive:true,force:true}));
 execFileSync('git',['init','-q','-b','work-fixture'],{cwd:cwd2});await writeFile(join(cwd2,'source.txt'),'baseline\n');execFileSync('git',['add','source.txt'],{cwd:cwd2});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','baseline'],{cwd:cwd2});
 const a=await completedDraft(f,f.cwd,'synthetic-a','job-apply-a','first\n'),b=await completedDraft(f,cwd2,'synthetic-b','job-apply-b','second\n');
 const original=f.codex.workspaces.apply.bind(f.codex.workspaces);let release,entered=false;
 f.codex.workspaces.apply=async(...args)=>{entered=true;await new Promise(resolve=>{release=resolve;});return original(...args);};
 const first=f.codex.applyDraft(a.jobId,a.digest,'same-command');await until(()=>entered);
 await assert.rejects(f.codex.applyDraft(b.jobId,b.digest,'same-command'),/idempotency_conflict/);assert.equal(await readFile(join(cwd2,'source.txt'),'utf8'),'baseline\n');
 release();await first;assert.equal(await readFile(join(f.cwd,'source.txt'),'utf8'),'first\n');
 assert.equal(f.app.store.read().jobs.find(j=>j.id===b.jobId).draft.status,'pending');
});
test('recovery finalizes a terminal draft without starting another turn or leaving it running forever',async t=>{
 const f=await fixture(t);const a=await completedDraft(f,f.cwd,'recovery-binding','job-draft-recovery','changed\n');
 f.app.store.transact(s=>{s.jobs.find(j=>j.id===a.jobId).draft.status='running';});f.codex.recover();
 await until(()=>f.app.store.read().jobs.find(j=>j.id===a.jobId).draft.status==='pending');
 assert.equal((await f.trace()).filter(m=>m.method==='turn/start').length,0);assert.equal(await readFile(join(f.cwd,'source.txt'),'utf8'),'baseline\n');
});
test('receipt failure after actual source modification stays unconfirmed, even for a known command conflict',async t=>{
 const f=await fixture(t);const a=await completedDraft(f,f.cwd,'receipt-binding','job-receipt-loss','changed\n');
 const original=f.app.store.transact.bind(f.app.store);f.app.store.transact=(callback,command)=>{if(command?.id==='codex:apply:receipt-fail')throw Object.assign(new Error('fixture'),{code:'idempotency_conflict'});return original(callback,command);};
 await assert.rejects(f.codex.applyDraft(a.jobId,a.digest,'receipt-fail'));
 assert.equal(await readFile(join(f.cwd,'source.txt'),'utf8'),'changed\n');assert.equal(f.app.store.read().jobs.find(j=>j.id===a.jobId).draft.status,'unconfirmed');
});

test('terminal packets without repeated items flush short safe text and preserve separately observed items',async t=>{
 const f=await fixture(t,'hold');const jid=f.codex.submit({bindingId:f.bindingId,prompt:'fixture',requestId:'short-stream'});await until(()=>!!f.job().turnId);
 const params={threadId:'fixture-thread',turnId:f.job().turnId};
 f.codex.notification(f.bindingId,'item/agentMessage/delta',{...params,delta:'short public fixture-private-'});
 assert.doesNotMatch(f.job().text,/fixture-private/);
 f.codex.notification(f.bindingId,'item/agentMessage/delta',{...params,delta:'key-123456789 answer'});
 f.codex.completeFromTurn(f.bindingId,{id:params.turnId,status:'completed',items:[]});
 assert.match(f.job().text,/short public/);assert.match(f.job().text,/answer/);assert.doesNotMatch(f.job().text,/fixture-private-key-123456789/);assert.equal(f.job().capture.complete,true);
 assert.equal(f.codex.validateResult(jid),null);
});
