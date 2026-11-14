import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { workspace, ownerKey, until } from '../workspace-helpers.mjs';
import { stoppedDotTopicFixture } from '../dot-mcp-fixture.mjs';

async function setup(t) {
  const f = await workspace(t, { residentEnabled: true }, { residentAutoSchedule: false, webhookTransport: { post: async input => {
    input.beforeSend(); const body = JSON.parse(input.body); assert.equal(body.type, 'verification'); return { status:200, body:JSON.stringify({challenge:body.challenge}) };
  } } });
  let calls = 0; f.app.providers.complete = async () => { calls++; throw Error('UI never dispatches'); };
  const browser = await chromium.launch({ headless:true, ...(process.env.WJ_TEST_CHROMIUM_EXECUTABLE ? {executablePath:process.env.WJ_TEST_CHROMIUM_EXECUTABLE} : {}) }); t.after(() => browser.close());
  const context = await browser.newContext(); await context.request.post(f.url+'/api/login', { data:{token:ownerKey}, headers:{Origin:f.url} });
  const page = await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.url); await page.locator('[data-view=connections]').click();
  return {...f,page,context,errors,calls:()=>calls};
}
test('D4 native stopped retry requires explicit evidence and confirmation and leaves resume separate', {timeout:30000}, async t => {
  const source=await stoppedDotTopicFixture(t), f=await setup(t), p=f.page, seed=source.state();
  p.setDefaultTimeout(5000);
  // Add non-native recovery cards without invoking those providers.
  const d=seed.discussions[0], old=d.turns.find(v=>v.id===source.stoppedRequestId);
  d.members[0].kind='browser'; d.members[0].label='Muse fixture'; d.members[1].kind='deepseek';
  const prior=structuredClone(d.turns.filter(v=>v.status==='completed'));
  f.app.store.transact(s=>{const password=s.ownerPassword,sessions=s.sessions;Object.assign(s,structuredClone(seed));s.ownerPassword=password;s.sessions=sessions;
    for(const turn of s.discussions[0].turns.filter(v=>v.phase==='cross_review' && v.id!==old.id)) turn.status='unconfirmed';});
  assert.equal((await f.context.request.get(f.url+'/api/state')).status(),200);
  await p.reload(); await p.locator('[data-view=room]').click(); await p.locator('#history button').first().click(); await p.locator('#topic-details-open').click();
  await p.getByRole('button',{name:'원본과 복구',exact:true}).click();
  assert.equal(await p.getByRole('button',{name:'중단 확인 후 재시도 준비',exact:true}).count(),1);
  assert.equal(await p.getByRole('button',{name:'제출 오류 후 재시도 준비',exact:true}).count(),1);
  assert.equal(await p.getByRole('button',{name:'종료 미확인·권한 회수 후 재시도 준비',exact:true}).count(),1);
  for(const name of ['완료 응답 반영','전송되지 않음 확인','이 응답 건너뛰기']) assert.equal(await p.getByRole('button',{name,exact:true}).count(),3);
  // Return the two completed peers to their actual fixture state before recovery.
  f.app.store.transact(s=>{for(const turn of s.discussions[0].turns) if(prior.some(v=>v.id===turn.id)) turn.status='completed';});
  const invalid=await f.api('/api/discussions/'+d.id+'/control',{...source.retryBody,stoppedWithoutSubmit:false}); assert.equal(invalid.status,409);
  await p.getByRole('button',{name:'중단 확인 후 재시도 준비',exact:true}).click();
  const dialog=p.locator('#action-dialog'), checkbox=dialog.locator('[name=stoppedWithoutSubmit]'), note=dialog.locator('[name=note]');
  assert.equal(await checkbox.isChecked(),false);
  let controls=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/control')) controls++;});
  await note.fill('Native fixture stopped after input; submit not invoked.');
  await dialog.getByRole('button',{name:'재시도 준비',exact:true}).click(); assert.equal(controls,0);
  await checkbox.check(); await note.fill(''); await dialog.getByRole('button',{name:'재시도 준비',exact:true}).click();assert.equal(controls,0);
  await note.fill('Native fixture stopped after input; submit not invoked.');
  await mkdir('test-results/dot-D5',{recursive:true}); await p.screenshot({path:'test-results/dot-D5/owner-retry-ui.png'});
  const request=p.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/control'));
  await dialog.getByRole('button',{name:'재시도 준비',exact:true}).click();
  assert.equal((await request).postDataJSON().stoppedWithoutSubmit,true);
  await dialog.waitFor({state:'hidden'}); const after=f.app.store.read().discussions[0];
  assert.equal(controls,1); assert.equal(after.status,'blocked'); assert.equal(after.tasks.find(v=>v.id===old.taskId).status,'pending');
  assert.deepEqual(after.turns.filter(v=>prior.some(a=>a.id===v.id)),prior);assert.equal(after.turns.length,d.turns.length);
  assert.equal(await p.getByRole('button',{name:'중단 확인 후 재시도 준비',exact:true}).count(),0);
  await p.locator('#topic-details-close').click(); assert.equal(await p.locator('#topic-resume').isEnabled(),true);
  assert.equal(f.calls(),0);assert.deepEqual(f.errors,[]);
});
test('D4 submit-error recovery records a distinct confirmation and prepares no new model request', {timeout:30000}, async t => {
  const source=await stoppedDotTopicFixture(t);
  source.control({action:'off'});
  source.app.dotMcp.revoke(source.connectionId,source.state().dotMcp.bindings[0].version,'ui-failed-submit-revoke');
  const seed=source.state(),d=seed.discussions[0],old=d.turns.find(v=>v.id===source.stoppedRequestId);
  const prior=structuredClone(d.turns.filter(v=>v.status==='completed')),f=await setup(t),p=f.page;
  p.setDefaultTimeout(5000);
  f.app.store.transact(s=>{const password=s.ownerPassword,sessions=s.sessions;Object.assign(s,structuredClone(seed));s.ownerPassword=password;s.sessions=sessions;});
  await p.reload();await p.locator('[data-view=room]').click();await p.locator('#history button').first().click();await p.locator('#topic-details-open').click();
  await p.getByRole('button',{name:'원본과 복구',exact:true}).click();
  await p.getByRole('button',{name:'제출 오류 후 재시도 준비',exact:true}).click();
  const dialog=p.locator('#action-dialog'),checkbox=dialog.locator('[name=stoppedAfterFailedSubmit]'),note=dialog.locator('[name=note]');
  assert.equal(await checkbox.isChecked(),false);assert.equal(await dialog.locator('[name=stoppedWithoutSubmit]').count(),0);
  let controls=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/control'))controls++;});
  await note.fill('Native fixture stopped after rejected submit; no receipt.');
  await dialog.getByRole('button',{name:'재시도 준비',exact:true}).click();assert.equal(controls,0);
  await checkbox.check();await note.fill('');await dialog.getByRole('button',{name:'재시도 준비',exact:true}).click();assert.equal(controls,0);
  await note.fill('Native fixture stopped after rejected submit; no receipt.');
  const request=p.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/control'));
  await dialog.getByRole('button',{name:'재시도 준비',exact:true}).click();
  const body=(await request).postDataJSON();assert.equal(body.resolution,'retry_after_failed_submit');assert.equal(body.stoppedAfterFailedSubmit,true);assert.equal(body.stoppedWithoutSubmit,undefined);
  await dialog.waitFor({state:'hidden'});
  const after=f.app.store.read().discussions[0];assert.equal(controls,1);assert.equal(after.status,'blocked');
  assert.equal(after.turns.find(v=>v.id===old.id).error,'owner_confirmed_retry_after_failed_submit');
  assert.equal(after.tasks.find(v=>v.id===old.taskId).status,'pending');assert.equal(after.turns.length,d.turns.length);
  assert.deepEqual(after.turns.filter(v=>prior.some(a=>a.id===v.id)),prior);assert.equal(f.calls(),0);assert.deepEqual(f.errors,[]);
});
for (const status of ['blocked','paused']) test(`D4 authority-revoked recovery requires both confirmations, preserves unverified history and stays ${status}`, {timeout:30000}, async t => {
  const source=await stoppedDotTopicFixture(t);
  source.control({action:'off'});
  source.app.dotMcp.revoke(source.connectionId,source.state().dotMcp.bindings[0].version,'ui-unverified-revoke');
  const seed=source.state(),d=seed.discussions[0],old=d.turns.find(v=>v.id===source.stoppedRequestId);
  d.status=status;
  const original=seed.dotMcp.requests.items.find(r=>r.id===old.id),prior=structuredClone(d.turns.filter(v=>v.status==='completed'));
  assert.equal(prior.length,5);assert.equal(seed.dotMcp.grants.find(g=>g.id===original.grantId).status,'revoked');
  assert.equal(seed.dotMcp.events.subscriptions.some(s=>s.grantId===original.grantId&&s.status==='active'),false);
  const f=await setup(t),p=f.page;p.setDefaultTimeout(5000);
  f.app.store.transact(s=>{const password=s.ownerPassword,sessions=s.sessions;Object.assign(s,structuredClone(seed));s.ownerPassword=password;s.sessions=sessions;});
  const openRecords=async()=>{
    await p.reload();await p.locator('[data-view=room]').click();await p.locator('#history button').first().click();await p.locator('#topic-details-open').click();
    await p.getByRole('button',{name:'원본과 복구',exact:true}).click();
  };
  await openRecords();
  const retry=p.getByRole('button',{name:'종료 미확인·권한 회수 후 재시도 준비',exact:true});await retry.click();
  const dialog=p.locator('#action-dialog'),accept=dialog.locator('[name=acceptUnverifiedExecution]'),monitor=dialog.locator('[name=monitorDisabled]'),note=dialog.locator('[name=note]');
  const prepare=dialog.getByRole('button',{name:'재시도 준비',exact:true});
  const evidence='원격 종료·제출 이력은 미확인. 원래 권한 회수와 현재 감시 비활성을 확인했고 갱신된 전달기로 옛 실행자가 새 요청에 접근할 위험을 수락함.';
  assert.equal(await accept.isChecked(),false);assert.equal(await monitor.isChecked(),false);
  assert.equal(await dialog.locator('[name=stoppedWithoutSubmit], [name=stoppedAfterFailedSubmit]').count(),0);
  assert.equal(await note.getAttribute('maxlength'),'1000');
  const warning=await dialog.innerText();assert.match(warning,/원격 실행의 종료와 제출 이력은 확인되지 않았습니다/);
  assert.match(warning,/권한 회수는 옛 요청의 결과 반영을 차단/);
  assert.match(warning,/옛 실행자가 갱신된 전달기를 통해 새 요청을 조회·점유/);
  assert.match(warning,/보장하지 않습니다/);assert.match(warning,/별도로 이어가기를 눌러야 실행/);
  const cursor=f.app.store.cursor();let controls=0;
  p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/control'))controls++;});
  await note.fill(evidence);await prepare.click();assert.equal(controls,0);
  await accept.check();await prepare.click();assert.equal(controls,0);
  await accept.uncheck();await monitor.check();await prepare.click();assert.equal(controls,0);
  await accept.check();await note.fill('');await prepare.click();assert.equal(controls,0);
  await note.fill('   ');await prepare.click();await p.locator('#notice.error').filter({hasText:'확인 근거를 1~1,000자로 입력해 주세요.'}).waitFor();assert.equal(controls,0);
  // Programmatic input bypasses maxlength; the submit handler must still refuse it.
  await note.evaluate(el=>{el.value='x'.repeat(1001);});await prepare.click();assert.equal(controls,0);
  assert.deepEqual(f.app.store.read().discussions[0],d);assert.equal(f.app.store.cursor(),cursor);assert.equal(f.calls(),0);
  await p.locator('#action-cancel').click();await retry.click();
  assert.equal(await accept.isChecked(),false);assert.equal(await monitor.isChecked(),false);assert.equal(await note.inputValue(),'');
  await accept.check();await monitor.check();await note.fill(evidence);
  const request=p.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/control'));
  await prepare.click();const body=(await request).postDataJSON();
  assert.equal(body.resolution,'retry_after_authority_revoked');assert.equal(body.acceptUnverifiedExecution,true);assert.equal(body.monitorDisabled,true);assert.equal(body.note,evidence);
  for(const name of ['stoppedWithoutSubmit','stoppedAfterFailedSubmit','submitAttempted']) assert.equal(Object.hasOwn(body,name),false);
  await dialog.waitFor({state:'hidden'});
  const record=p.locator(`[data-recovery-turn-id="${old.id}"]`);
  await record.getByText('원격 종료·제출 이력 미확인',{exact:true}).waitFor();assert.match(await record.innerText(),/원격 종료 시각이 아닙니다/);
  assert.equal(await retry.count(),0);await p.locator('#topic-details-close').click();assert.equal(await p.locator('#topic-resume').isEnabled(),true);
  // The warning is a durable record, including after the announcement disappears on reload.
  await openRecords();await record.getByText('원격 종료·제출 이력 미확인',{exact:true}).waitFor();
  assert.match(await record.innerText(),/앱에서 옛 요청의 대조를 마쳤습니다/);
  const state=f.app.store.read(),after=state.discussions[0];assert.equal(controls,1);assert.equal(after.status,status);
  assert.deepEqual(after.turns.find(v=>v.id===old.id),{...old,status:'failed',error:'owner_confirmed_retry_after_authority_revoked'});
  assert.equal(after.tasks.find(v=>v.id===old.taskId).status,'pending');assert.equal(after.turns.length,d.turns.length);
  assert.deepEqual(after.turns.filter(v=>prior.some(a=>a.id===v.id)),prior);assert.deepEqual(after.used,d.used);assert.deepEqual(state.apiUsage,seed.apiUsage);
  assert.equal(state.dotMcp.requests.items.length,seed.dotMcp.requests.items.length);
  assert.deepEqual(state.dotMcp.requests.items.find(r=>r.id===old.id),{...original,status:'consumed'});
  assert.deepEqual(state.dotMcp.grants,seed.dotMcp.grants);assert.deepEqual(state.dotMcp.events.subscriptions,seed.dotMcp.events.subscriptions);
  assert.equal(state.resident.rooms[0].desiredOn,false);
  const audits=f.app.store.events(0,10000).filter(e=>e.type==='discussion.retry_prepared');assert.equal(audits.length,1);
  assert.equal(audits[0].data.externalExecution,'unverified');assert.equal(audits[0].data.submissionHistory,'unverified');
  for(const name of ['stoppedWithoutSubmit','stoppedAfterFailedSubmit','submitAttempted']) assert.equal(Object.hasOwn(audits[0].data,name),false);
  assert.equal(f.calls(),0);assert.deepEqual(f.errors,[]);
});
test('D4 390/768/1440px owner setup preserves Muse; twenty reloads/views dispatch nothing and never label browser dot as native', {timeout:60000}, async t => {
  const f = await setup(t), p=f.page;
  const muse={id:'muse',kind:'browser',label:'Muse unchanged',status:'connected',models:[{id:'existing',label:'existing'}],browser:{url:'https://muse.ai/fixture',pageId:7,thread:{value:'original-thread'},accountLabel:'fixture',agentLabel:'Muse'}};
  f.app.store.transact(s=>{s.connections.push(muse,{id:'old-dot',kind:'browser',label:'Old browser dot',status:'connected',models:[{id:'existing',label:'existing'}],browser:{url:'https://chatgpt.com/c/old',agentLabel:'dot',discovery:{target:'dot'}}});});
  await p.locator('#participant-mode').selectOption('dot'); await p.locator('#participant-dot-connect').click();
  assert.equal(await p.locator('#participant-fields').isVisible(),false); assert.equal(await p.locator('#browser-dot-target').count(),0);
  await p.locator('#dot-register-label').fill('Native dot fixture'); await p.locator('#dot-register-form [name=role]').fill('검토');
  await p.getByRole('button',{name:'dot 연결 등록',exact:true}).click();
  await until(()=>f.app.store.read().dotMcp.bindings.length===1);
  const b=f.app.store.read().dotMcp.bindings[0], card=p.locator(`#connections-list [data-connection-id="${b.connectionId}"]`);
  await card.getByText('소유자 확인 필요',{exact:true}).waitFor(); assert.equal(await card.getByRole('button',{name:'모델 확인',exact:true}).count(),0);
  const cursor=f.app.store.cursor();
  for(let i=0;i<20;i++) {
    await p.setViewportSize({width:[390,768,1440][i%3],height:1000});
    if(i%3===0){await p.reload();await p.locator('[data-view=connections]').click();}
    else {await p.locator('[data-view=room]').click();await p.locator('[data-view=connections]').click();}
    await card.getByText('소유자 확인 필요',{exact:true}).waitFor(); assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // SSE may replace a card between a locator screenshot's scroll and capture.
    // Capture the document without holding a detached element; assertions above remain unchanged.
    if(i<3) await p.screenshot({path:`test-results/dot-D4/connection-${[390,768,1440][i]}.png`,fullPage:true});
  }
  assert.equal(f.app.store.cursor(),cursor); assert.equal(f.calls(),0); assert.deepEqual(f.app.store.read().connections.find(c=>c.id==='muse'),muse);
  assert.equal(f.app.store.read().resident.rooms[0].desiredOn,false); assert.equal(f.app.store.read().resident.rooms[0].members.find(m=>m.participantId===b.participantId).enabled,false);
  await p.locator('#participant-mode').selectOption('web-gpt'); assert.ok(await p.locator('#participant-connection option[value=old-dot]').count());
  assert.deepEqual(f.errors,[]);
});

test('D4 authority, subscription, response stages and revoke stay distinct; close, expiry and session loss clear the visible grant', {timeout:60000}, async t => {
  const f=await setup(t), p=f.page;
  await p.locator('#participant-mode').selectOption('dot'); await p.locator('#participant-dot-connect').click();
  await p.locator('#dot-register-label').fill('dot flow'); await p.getByRole('button',{name:'dot 연결 등록',exact:true}).click();
  await until(()=>f.app.store.read().dotMcp.bindings.length===1); const b=f.app.store.read().dotMcp.bindings[0];
  const card=p.locator(`#connections-list [data-connection-id="${b.connectionId}"]`);
  const confirm=async()=>{await card.getByRole('button',{name:/연결 확인·권한 발급|권한 다시 발급/}).click();await p.locator('#dot-confirm-form [name=ownerConfirmed]').check();await p.getByRole('button',{name:'확인하고 권한 키 발급',exact:true}).click();await p.locator('#dot-grant-result').waitFor({state:'visible'});};
  await p.setViewportSize({width:390,height:844}); await confirm(); const token=await p.locator('#dot-grant-token').inputValue(); assert.ok(token.length>=32);
  assert.equal(await p.locator('#dot-confirm-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
  await p.locator('#dot-confirm-dialog').screenshot({path:'test-results/dot-D4/private-grant-390.png'});
  await p.locator('#dot-confirm-close').click(); assert.equal(await p.locator('#dot-grant-token').inputValue(),'');
  await card.getByText('감시 등록 필요',{exact:true}).waitFor(); assert.equal(await card.getByText('유효',{exact:true}).count(),1);
  const grant=f.app.dotMcp.authenticate(token); await f.app.mcpEvents.handle('events/subscribe',{name:'webjjoku.turn_requested',arguments:{roomId:b.roomId,participantId:b.participantId,connectionId:b.connectionId},delivery:{mode:'webhook',url:'https://callback.example/private',secret:'whsec_'+Buffer.alloc(32,4).toString('base64')}},grant);
  await card.getByText('전송 준비됨 · 방 켜기/발언 참여는 별도 설정',{exact:true}).waitFor(); assert.equal(await card.getByText('유효',{exact:true}).count(),2);
  assert.doesNotMatch(await p.locator('body').innerText(),/callback.example|whsec_/);
  // Projection-only UI fixtures: D3 exercises actual mailbox/crash transitions.
  const original=await (await f.api('/api/state')).json();
  for(const [delivery,response,wanted] of [['sending','waiting','전달 중'],['delivered','claimed','dot이 입력 조회 중'],['held','unconfirmed','미확정 · 원래 요청 대조'],['settled','completed','답변 반영됨'],['held','quarantined','이전 범위 응답 · 적용 안 함']]) {
    await p.route('**/api/state',route=>route.fulfill({json:{...original,dotMcp:{...original.dotMcp,connections:original.dotMcp.connections.map(c=>({...c,delivery,response}))}}}));
    await p.reload();await p.locator('[data-view=connections]').click();await card.getByText(wanted,{exact:true}).waitFor();await p.unroute('**/api/state');
  }
  await p.reload();await p.locator('[data-view=connections]').click(); await confirm();
  await p.locator('#dot-confirm-close').click(); await p.locator('[data-view=room]').click(); assert.equal(await p.locator('#dot-grant-token').inputValue(),'');
  await p.locator('[data-view=connections]').click(); p.once('dialog',d=>d.accept());await card.getByRole('button',{name:'연결 권한 해제',exact:true}).click();await card.getByText('권한 해제됨',{exact:true}).waitFor();
  assert.equal(f.app.store.read().dotMcp.requests.items.length,0);assert.equal(f.calls(),0);
  await p.clock.install(); await confirm(); await p.clock.fastForward(120001);
  assert.equal(await p.locator('#dot-confirm-dialog').evaluate(d=>d.open),false);assert.equal(await p.locator('#dot-grant-token').inputValue(),'');
  await p.clock.resume();await confirm();await f.context.clearCookies();
  // A real server event after session loss triggers a protected state refresh.
  f.app.dotMcp.revoke(b.connectionId,f.app.store.read().dotMcp.bindings[0].version,crypto.randomUUID());
  await p.locator('#login').waitFor({state:'visible'});assert.equal(await p.locator('#dot-confirm-dialog').evaluate(d=>d.open),false);assert.equal(await p.locator('#dot-grant-token').inputValue(),'');assert.deepEqual(f.errors,[]);
});
