import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { diagramSchema, diagramRelationshipLabel } from '../dist/model/diagram.js';
import { writeReplayWalkthrough } from '../dist/renderers/replayWalkthrough.js';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const run = promisify(execFile);
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const scenario = { schemaVersion: 1, event: { id: 'shipment-17', offset: 41 }, bridgeAcknowledgment: 'after-commit' };

test('CLI and MCP export the same six runs, ordered editable models, and side-by-side comparisons', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-replay-'));
  const client = new Client({ name: 'replay-test', version: '1' });
  t.after(async () => {
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const scenarioPath = path.join(dir, 'input.json');
  const outputDirectory = path.join(dir, 'release examples');
  await fs.writeFile(scenarioPath, JSON.stringify(scenario));
  const args = [cli, 'review-replay', scenarioPath, '--out', outputDirectory];
  const summary = JSON.parse((await run(process.execPath, args)).stdout);
  assert.equal(summary.runs.length, 6);
  const report = await fs.readFile(summary.artifacts.markdown, 'utf8');
  const trace = await readJson(summary.artifacts.traces);
  for (const href of report.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok((await fs.stat(path.join(outputDirectory, href[1]))).isFile());
  }
  assert.ok(!report.includes(dir));
  assert.match(report, /Restart after commit \| Integration bridge \| 1 row, next offset 41 \| 1 \| 42/);
  assert.match(report, /Failed Oracle write \| Application server \| 0 rows, next offset 41 \| 0 \| 41/);
  for (const { placement, svg, png, successModel, replayModel } of summary.artifacts.comparisons) {
    assert.match(await fs.readFile(svg, 'utf8'), /<svg/);
    assert.deepEqual([...(await fs.readFile(png)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    for (const [file, kind] of [[successModel, 'success'], [replayModel, 'restart-after-commit']]) {
      const model = diagramSchema.parse(await readJson(file));
      assert.equal(model.c4Level, 'C4Dynamic');
      const steps = trace.runs.find(item => item.placement === placement && item.scenario === kind).steps;
      assert.equal(model.relationships.length, steps.length);
      for (const [index, relation] of model.relationships.entries()) {
        assert.deepEqual([relation.from, relation.to], [steps[index].from, steps[index].to]);
        assert.equal(diagramRelationshipLabel(model.c4Level, relation, index), `${index + 1}. ${steps[index].label}`);
      }
    }
  }
  const tool = 'review_replay_walkthrough';
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], cwd: dir }));
  assert.ok((await client.listTools()).tools.some(value => value.name === tool));
  const toolArguments = { scenarioPath, outputDirectory };
  const result = await client.callTool({ name: tool, arguments: toolArguments });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, summary);
  assert.equal(result.content[0].text, JSON.stringify(summary));
  assert.equal(await fs.readFile(summary.artifacts.markdown, 'utf8'), report);
  await fs.writeFile(scenarioPath, JSON.stringify({ ...scenario, event: { id: 'invalid' } }));
  await assert.rejects(run(process.execPath, args));
  assert.equal((await client.callTool({ name: tool, arguments: toolArguments })).isError, true);
  assert.equal(await fs.readFile(summary.artifacts.markdown, 'utf8'), report);
});

test('an unspecified acknowledgment is visible in the report and editable downstream model', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-ack-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scenarioPath = path.join(dir, 'input.json');
  await fs.writeFile(scenarioPath, JSON.stringify({ ...scenario, bridgeAcknowledgment: 'unspecified' }));
  const { artifacts } = await writeReplayWalkthrough(scenarioPath, path.join(dir, 'results'));
  const report = await fs.readFile(artifacts.markdown, 'utf8');
  assert.match(report, /Delivery awaiting acknowledgment \| Integration bridge \| — \| 1 \| 41/);
  assert.match(report, /What acknowledgment/);
  const after = artifacts.comparisons.find(value => value.placement === 'after-kafka');
  assert.match((await readJson(after.successModel)).title, /awaiting acknowledgment/);
});

test('a colliding input or invalid destination preserves previous artifacts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-collision-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'traces.json');
  const report = path.join(dir, 'report.md');
  const contents = JSON.stringify(scenario);
  await fs.writeFile(target, contents);
  await fs.writeFile(report, 'prior report');
  await assert.rejects(writeReplayWalkthrough(target, dir), /overwrite the input scenario/);
  const alias = path.join(dir, 'scenario.json');
  await fs.link(target, alias);
  await assert.rejects(writeReplayWalkthrough(alias, dir), /overwrite the input scenario/);
  await fs.unlink(target);
  await fs.mkdir(path.join(dir, 'after-kafka.svg'));
  await assert.rejects(writeReplayWalkthrough(alias, dir), /regular file/);
  assert.equal(await fs.readFile(alias, 'utf8'), contents);
  assert.equal(await fs.readFile(report, 'utf8'), 'prior report');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['after-kafka.svg', 'report.md', 'scenario.json']);
});
