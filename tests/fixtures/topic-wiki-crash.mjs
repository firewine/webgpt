import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wikiFixture } from '../wiki-fixture.mjs';
import { response, topic, until } from '../workspace-helpers.mjs';

const [directory, stage] = process.argv.slice(2);
assert.ok(['before_commit', 'after_commit', 'notice_committed'].includes(stage));
let calls = 0;
// The parent owns cleanup after SIGKILL; this process intentionally cannot run
// after-hooks. Use the same isolated workspace and fake participants as Node tests.
const f = await wikiFixture({ after() {} }, { on: false, provider: { complete: async () => assert.fail('Crash fixture must not dispatch an ambient reply') } });
f.app.providers.complete = async input => {
  assert.equal(input.participant.kind, 'fake'); calls++;
  input.hooks.dispatched(); const text = response(input.prompt, input.participant);
  input.hooks.delta(text);
  return { text, receipt: 'topic-crash-fixture-' + calls, usage: { input: 1, output: 1 } };
};
// Record the temporary state location before any operation that can fail, so
// the parent can always remove the fixture's database and lock directory.
writeFileSync(join(directory, 'topic-wiki-crash.json'), JSON.stringify({ stateDirectory: f.directory }));
f.control({ action: 'on' });
const discussionId = f.app.residentRunner.focus(f.roomId, { ...topic, limits: { maxRequests: 40, maxRounds: 1, maxVerificationTasks: 2, maxToolJobs: 0 } }, 'topic-wiki-crash-focus');
const discussion = await until(() => f.app.store.read().discussions.find(d => d.id === discussionId && d.status === 'completed' && !d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status))), 10000);
assert.equal(discussion.wikiPublication.status, 'pending'); assert.equal(calls, discussion.turns.length);
assert.equal(f.app.store.read().resident.wikiVersions.length, 0);
writeFileSync(join(directory, 'topic-wiki-crash.json'), JSON.stringify({ stateDirectory: f.directory, roomId: f.roomId, discussionId, calls, turns: discussion.turns, publication: discussion.wikiPublication, cursor: f.app.store.cursor() }));

const original = f.app.store.transact.bind(f.app.store);
f.app.store.transact = (fn, command) => original((s, emit) => fn(s, event => {
  emit(event);
  // Event insertion is inside BEGIN IMMEDIATE, before the snapshot update and
  // COMMIT. Killing here must roll back the page, notice and publication alike.
  if (stage === 'before_commit' && event.type === 'resident.wiki_edited') process.kill(process.pid, 'SIGKILL');
}), command);
f.app.store.subscribe(event => {
  // Store subscribers run only after COMMIT. Both checkpoints must therefore
  // recover the complete transaction even before later subscribers run.
  if (stage === 'after_commit' && event.type === 'resident.wiki_edited') process.kill(process.pid, 'SIGKILL');
  if (stage === 'notice_committed' && event.type === 'resident.message_created' && f.app.store.read().resident.messages.some(m => m.id === event.data.messageId && m.sourceKind === 'wiki')) process.kill(process.pid, 'SIGKILL');
});
await f.step();
throw new Error('Topic Wiki crash checkpoint did not trigger: ' + stage);
