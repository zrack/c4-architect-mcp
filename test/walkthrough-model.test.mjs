import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reviewWalkthrough } from '../dist/model/walkthrough.js';

async function example(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'walkthrough-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'workspace');
  await mkdir(dir);
  const write = (name, data) => writeFile(path.join(dir, name), JSON.stringify(data));
  const containers = {
    title: 'Telemetry containers', c4Level: 'C4Container',
    nodes: [{ id: 'app', label: 'Receiver', type: 'Container' }, { id: 'feed', label: 'Sensor feed', type: 'System_Ext' }],
    relationships: [{ from: 'app', to: 'feed', label: 'Subscribes to' }],
  };
  const flows = {
    title: 'Telemetry data', c4Level: 'DataFlow',
    nodes: [{ id: 'sensor', label: 'Sensor feed', type: 'ExternalEntity', description: 'Check who operates the feed.' },
      { id: 'ingest', label: 'Accept sample', type: 'Process' }],
    relationships: [{ from: 'sensor', to: 'ingest', label: 'Sample' }],
  };
  const manifest = {
    schemaVersion: 1, title: 'Telemetry',
    views: [{ id: 'containers', title: 'Containers', model: 'containers.json' }, { id: 'flows', title: 'Flows', model: 'flows.json' }],
    claims: [
      { id: 'sender', kind: 'proposal', statement: 'Inbound sender', value: 'sensor',
        evidence: [
          { view: 'containers', from: 'app', to: 'feed', label: 'Subscribes to', meaning: 'This dependency names the feed client.' },
          { view: 'flows', from: 'sensor', to: 'ingest', label: 'Sample', meaning: 'This arrow names the payload origin.' },
        ] },
      { id: 'payload', kind: 'fact', statement: 'Record type', value: 'sample',
        evidence: [{ view: 'flows', node: 'ingest', meaning: 'This process handles the incoming record.' }] },
    ],
    questions: [
      { id: 'operator', question: 'Who operates the feed?', views: ['flows'], notes: [{ view: 'flows', node: 'sensor' }] },
      { id: 'retention', question: 'How long is a sample kept?', views: ['containers'] },
    ],
  };
  async function run(scenario, document = manifest) {
    await write('manifest.json', document);
    await write('scenario.json', scenario);
    return reviewWalkthrough(path.join(dir, 'manifest.json'), path.join(dir, 'scenario.json'));
  }
  await Promise.all([write('containers.json', containers), write('flows.json', flows)]);
  return { dir, root, manifest, containers, flows, write, run };
}

test('a changed claim follows the declared evidence at each view’s own direction and level', async t => {
  const { run } = await example(t);
  const result = await run({ title: 'Gateway delivery',
    changes: [{ claim: 'sender', value: 'gateway', reason: 'The gateway delivers the samples.' }] });
  assert.deepEqual(result.views.map(v => [v.id, v.status, v.findings.length]), [
    ['containers', 'review', 1], ['flows', 'review', 1],
  ]);
  assert.deepEqual(result.views.map(v => v.findings[0].anchor), [
    'R01 · Receiver [app] → Sensor feed [feed] · Subscribes to',
    'R01 · Sensor feed [sensor] → Accept sample [ingest] · Sample',
  ]);
  assert.equal(result.views[0].findings[0].kind, 'proposal');
  assert.deepEqual([result.changes[0].before, result.changes[0].after], ['sensor', 'gateway']);
  assert.deepEqual(result.openQuestions.map(q => q.id), ['operator', 'retention']);
});

test('a different claim affects only its referenced view; merely renaming a scenario or confirming a value has no structural impact', async t => {
  const { run, manifest } = await example(t);
  manifest.claims[0].evidence.push({ view: 'containers', node: 'feed', meaning: 'The feed is also named as a container dependency.' });
  const result = await run({ title: 'Same title', changes: [{ claim: 'payload', value: 'alarm', reason: 'Collect alarms.' }] }, manifest);
  assert.deepEqual(result.views.map(v => v.status), ['unchanged', 'review']);
  const retained = [{ claim: 'sender', statement: 'Inbound sender', value: 'sensor', kind: 'proposal' }];
  assert.deepEqual(result.views.map(v => v.retainedClaims), [retained, retained]);
  assert.equal(result.views[1].findings[0].anchor, 'Accept sample [ingest]');
  assert.equal(result.views[1].findings[0].kind, 'fact');
  const reaffirmed = await run({ title: 'Gateway delivery', changes: [{ claim: 'sender', value: 'sensor', reason: 'Confirmed.' }],
    answers: [{ question: 'operator', answer: 'Platform team' }] });
  assert.deepEqual(reaffirmed.changes, []);
  assert.deepEqual(reaffirmed.views.map(v => v.status), ['unchanged', 'unchanged']);
  assert.deepEqual(reaffirmed.openQuestions.map(q => q.id), ['retention']);
  assert.deepEqual(reaffirmed.answeredQuestions[0].notes, [
    { view: 'flows', node: 'sensor', description: 'Check who operates the feed.' },
  ]);
});

test('a stale or ambiguous reference fails even when its claim does not change', async t => {
  const { run, write, manifest, flows } = await example(t);
  async function invalid(mutate, error) {
    const doc = structuredClone(manifest);
    mutate(doc);
    await assert.rejects(run({ title: 'Baseline' }, doc), error);
  }
  await invalid(m => { m.views[1].id = 'containers'; }, /Duplicate view ID/);
  await invalid(m => { m.claims[1].id = 'sender'; }, /Duplicate claim ID/);
  await invalid(m => { m.questions[1].id = 'operator'; }, /Duplicate question ID/);
  await invalid(m => { m.claims[0].evidence[0].view = 'lost'; }, /unknown view/i);
  await invalid(m => { m.questions[0].views[0] = 'lost'; }, /unknown view/i);
  await invalid(m => { m.questions[0].notes[0].node = 'ingest'; }, /described node/);
  await invalid(m => { m.claims[1].evidence[0].node = 'lost'; }, /Unknown evidence node/);
  await invalid(m => { m.claims[1].evidence[0].from = 'sensor'; }, /Invalid input|Unrecognized key/i);
  await invalid(m => { const ref = m.claims[0].evidence[0]; [ref.from, ref.to] = [ref.to, ref.from]; }, /found 0/);
  await invalid(m => { m.claims[0].evidence[0].label = 'Sends to'; }, /found 0/);
  await write('flows.json', { ...flows, relationships: [...flows.relationships, ...flows.relationships] });
  await assert.rejects(run({ title: 'Baseline' }), /found 2/);
  await write('flows.json', { ...flows, c4Level: 'C4Container' });
  await assert.rejects(run({ title: 'Baseline' }), /only allowed in DataFlow/);
});

test('unknown or duplicate changes and answers cannot silently resolve a review', async t => {
  const { run } = await example(t);
  const change = { claim: 'sender', value: 'gateway', reason: 'Move the subscription.' };
  const answer = { question: 'operator', answer: 'Platform' };
  await assert.rejects(run({ title: 'Bad ID', changes: [{ ...change, claim: 'missing' }] }), /unknown claim/);
  await assert.rejects(run({ title: 'Bad ID', answers: [{ ...answer, question: 'missing' }] }), /unknown question/);
  await assert.rejects(run({ title: 'Duplicate', changes: [change, change] }), /Duplicate change/);
  await assert.rejects(run({ title: 'Duplicate', answers: [answer, answer] }), /Duplicate answer/);
});

test('diagram model paths are confined to the manifest directory, including linked directories', async t => {
  const { root, dir, run, manifest, containers } = await example(t);
  await mkdir(path.join(dir, 'models'));
  await writeFile(path.join(dir, 'models', 'containers.json'), JSON.stringify(containers));
  const portable = structuredClone(manifest);
  portable.views[0].model = 'models\\containers.json';
  const review = await run({ title: 'Portable paths' }, portable);
  assert.equal(review.views[0].model, 'models/containers.json');
  const outside = path.join(root, 'elsewhere');
  await mkdir(outside);
  await writeFile(path.join(outside, 'containers.json'), JSON.stringify(containers));
  await symlink(outside, path.join(dir, 'linked'), 'junction');
  for (const model of ['../elsewhere/containers.json', '..\\elsewhere\\containers.json', 'linked/containers.json', 'C:\\outside.json']) {
    const doc = structuredClone(manifest);
    doc.views[0].model = model;
    await assert.rejects(run({ title: 'Baseline' }, doc), /outside the walkthrough|relative diagram model path/);
  }
});
