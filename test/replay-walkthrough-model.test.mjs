import assert from 'node:assert/strict';
import test from 'node:test';
import { runReplayWalkthrough } from '../dist/model/replayWalkthrough.js';

const config = { schemaVersion: 1, event: { id: 'reading-0094', offset: 17 }, bridgeAcknowledgment: 'after-commit' };
const walkthrough = runReplayWalkthrough(config);
const baselineOffset = config.event.offset;
const committedOffset = baselineOffset + 1;
const storedRow = { rowCount: 1, nextOffset: committedOffset, storedEventIds: [config.event.id], redeliveryPending: false };

test('each placement exercises success, write failure and restart independently', () => {
  assert.deepEqual(walkthrough.runs.map(run => [run.placement, run.scenario]), [
    ['before-kafka', 'success'], ['before-kafka', 'failed-write'], ['before-kafka', 'restart-after-commit'],
    ['after-kafka', 'success'], ['after-kafka', 'failed-write'], ['after-kafka', 'restart-after-commit'],
  ]);
  assert.deepEqual(runReplayWalkthrough(config), walkthrough);
});

for (const placement of ['before-kafka', 'after-kafka']) {
  const owner = placement === 'before-kafka' ? 'application' : 'bridge';
  const runs = Object.fromEntries(walkthrough.runs.filter(run => run.placement === placement).map(run => [run.scenario, run]));

  test(`${placement} success commits one row before the owner checkpoints the next offset`, () => {
    const run = runs.success;
    assert.equal(run.checkpointOwner, owner);
    assert.deepEqual(run.final, storedRow);
    const kinds = run.steps.map(step => step.kind);
    assert.deepEqual(kinds, placement === 'before-kafka'
      ? ['publish', 'consume', 'write', 'commit', 'checkpoint']
      : ['consume', 'deliver', 'write', 'commit', 'acknowledge', 'checkpoint']);
    const consume = run.steps.find(step => step.kind === 'consume');
    assert.deepEqual([consume.from, consume.to, consume.label], ['kafka', owner, 'Read offset 17']);
    const commit = run.steps.find(step => step.kind === 'commit');
    assert.deepEqual([commit.from, commit.to, commit.rowCount, commit.nextOffset], ['oracle', 'application', 1, baselineOffset]);
    const checkpoint = run.steps.at(-1);
    assert.deepEqual([checkpoint.from, checkpoint.to, checkpoint.nextOffset], [owner, 'kafka', committedOffset]);
    assert.ok(run.steps.slice(0, -1).every(step => step.nextOffset === baselineOffset));
    if (placement === 'after-kafka') {
      const ack = run.steps.at(-2);
      assert.deepEqual([ack.from, ack.to, ack.rowCount], ['application', 'bridge', 1]);
    }
  });

  test(`${placement} write failure leaves the same offset eligible for redelivery`, () => {
    const run = runs['failed-write'];
    assert.equal(run.checkpointOwner, owner);
    assert.equal(run.steps.at(-1).kind, 'rollback');
    assert.ok(run.steps.every(step => step.attempt === 1 && step.rowCount === 0 && step.nextOffset === baselineOffset));
    assert.ok(!run.steps.some(step => ['commit', 'acknowledge', 'checkpoint'].includes(step.kind)));
    assert.deepEqual(run.final, { rowCount: 0, nextOffset: baselineOffset, storedEventIds: [], redeliveryPending: true });
  });

  test(`${placement} restart drops volatile progress and redelivers the same event after the Oracle commit`, () => {
    const run = runs['restart-after-commit'];
    const first = run.steps.filter(step => step.attempt === 1);
    const replay = run.steps.filter(step => step.attempt === 2);
    assert.deepEqual(first.slice(-2).map(step => step.kind), ['commit', 'restart']);
    assert.ok(first.every(step => step.nextOffset === baselineOffset));
    const restart = first.at(-1);
    assert.deepEqual([restart.from, restart.to, restart.rowCount], [owner, owner, 1]);
    assert.ok(first.every(step => !['acknowledge', 'checkpoint'].includes(step.kind)));
    assert.equal(replay[0].label, 'Replay offset 17');
    assert.deepEqual([replay[0].from, replay[0].to, replay[0].nextOffset], ['kafka', owner, baselineOffset]);
    assert.deepEqual(replay.map(step => step.kind), placement === 'before-kafka'
      ? ['consume', 'write', 'duplicate', 'checkpoint']
      : ['consume', 'deliver', 'write', 'duplicate', 'acknowledge', 'checkpoint']);
    assert.ok(replay.every(step => step.rowCount === 1));
    assert.deepEqual([replay.at(-1).from, replay.at(-1).nextOffset], [owner, committedOffset]);
    assert.deepEqual(run.final, storedRow);
  });
}

test('an unconfirmed handoff blocks the bridge checkpoint even when a row exists', () => {
  const { runs, bridgeAcknowledgment } = runReplayWalkthrough({ schemaVersion: 1, event: config.event });
  assert.equal(bridgeAcknowledgment, 'unspecified');
  for (const run of runs.filter(r => r.scenario !== 'failed-write')) {
    if (run.placement === 'before-kafka') {
      assert.deepEqual(run.openQuestions, []);
      assert.deepEqual(run.final, storedRow);
    } else {
      assert.equal(run.steps.at(-1).kind, 'acknowledgment-open');
      assert.ok(!run.steps.some(step => step.kind === 'checkpoint' || step.kind === 'acknowledge'));
      assert.deepEqual(run.final, { ...storedRow, nextOffset: baselineOffset, redeliveryPending: true });
      assert.match(run.openQuestions[0], /acknowledgment.*Oracle/);
    }
  }
});

test('offset validation reserves room for the checkpoint, and the business row retains its exact identity', () => {
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => runReplayWalkthrough({ ...config, event: { ...config.event, offset } }));
  }
  for (const id of ['', '   ', ' event-1', 'event-1 ', 'foo\nbar', 'odd\u0007event', 'a\u2028b']) {
    assert.throws(() => runReplayWalkthrough({ ...config, event: { id, offset: 0 } }));
  }
  assert.throws(() => runReplayWalkthrough({ ...config, bridgeAcknowledgment: 'on-receipt' }));
  for (const offset of [0, Number.MAX_SAFE_INTEGER - 1]) {
    const { runs } = runReplayWalkthrough({ ...config, event: { id: 'abc/Σ:reading-9', offset } });
    const restart = runs.find(run => run.scenario === 'restart-after-commit');
    assert.equal(restart.final.nextOffset, offset + 1);
    assert.deepEqual(restart.final.storedEventIds, ['abc/Σ:reading-9']);
  }
});
