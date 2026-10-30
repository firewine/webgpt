import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedTopicResults } from '../dist/client/web/room-view.js';

const task = (participantId, status = 'completed', phase = 'summary_review', revision = 2) => ({ participantId, status, phase, revision, round: 1 });
const turn = (id, participantId, status = 'completed', phase = 'summary_review', revision = 2) => ({ id, participantId, status, phase, revision, round: 1, reply: { text: id } });

test('room conclusion waits for every reviewer and any pending format repair before publishing a round', () => {
  const d = { revision: 2, tasks: [task('a'), task('b', 'running')], turns: [turn('review-a', 'a'), turn('private-review-b', 'b', 'running')] };
  assert.deepEqual(publishedTopicResults(d), []);
  d.tasks[1].status = 'completed'; d.turns[1].status = 'completed';
  assert.deepEqual(publishedTopicResults(d).map(t => t.id), ['review-a', 'private-review-b']);
  d.tasks.push(task('b', 'pending')); assert.deepEqual(publishedTopicResults(d), []);
});

test('room conclusion excludes old revisions, stale responses and unconfirmed rounds', () => {
  const d = { revision: 2, tasks: [task('a', 'completed', 'synthesis', 1), task('a', 'unconfirmed', 'synthesis')],
    turns: [turn('old-goal-result', 'a', 'completed', 'synthesis', 1), turn('uncertain-result', 'a', 'unconfirmed', 'synthesis'), turn('late-stale-result', 'a', 'stale', 'synthesis')] };
  assert.deepEqual(publishedTopicResults(d), []);
  d.tasks[1].status = 'completed'; d.turns.push(turn('current-result', 'a', 'completed', 'synthesis'));
  assert.deepEqual(publishedTopicResults(d).map(t => t.id), ['current-result']);
});

test('room conclusion requires structured completed reports and keeps only the final confirmed repair', () => {
  const d = { revision: 2, tasks: [task('a', 'failed', 'synthesis'), task('a', 'completed', 'synthesis')],
    turns: [{ ...turn('invalid-json', 'a', 'completed', 'synthesis'), reply: null }] };
  assert.deepEqual(publishedTopicResults(d), []);
  d.turns.push(turn('first-confirmed', 'a', 'completed', 'synthesis'), turn('final-confirmed', 'a', 'completed', 'synthesis'));
  assert.deepEqual(publishedTopicResults(d).map(t => t.id), ['final-confirmed']);
});
