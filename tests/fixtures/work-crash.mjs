import { workFixture } from '../work-fixture.mjs';
const stage = process.argv[2]; let f;
const ready = () => process.stdout.write(JSON.stringify({ directory: f.directory, roomId: f.roomId, taskId: taskId, stage }) + '\n');
f = await workFixture({ after() {} }, { ...(stage === 'running' ? { provider: { complete: async input => { input.hooks.dispatched(); input.hooks.receipt('work-crash-original'); ready(); await new Promise(() => {}); } } } : {}) });
const taskId = f.propose(); f.q.claim(f.roomId, taskId, { participantId: 'fake-a', expectedVersion: f.task(taskId).version }, 'crash-claim');
if (stage === 'prepared') f.app.store.transact((s, emit) => f.q.prepareTurn(s, s.resident.rooms[0], emit, Date.now()));
if (stage === 'running') void f.step();
else { if (stage === 'reported') await f.step(); ready(); }
setInterval(() => {}, 1000);
