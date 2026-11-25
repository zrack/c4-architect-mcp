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

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/three-tier-kafka-oracle/', import.meta.url));
const order = ['context', 'container', 'data-flow', 'component', 'code', 'deployment', 'landscape'];

test('CLI and MCP review both Kafka bridge placements against the same seven diagram models', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-walkthrough-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'architecture (v1) #draft');
  await fs.cp(fixture, root, { recursive: true });
  const manifestPath = path.join(root, 'walkthrough.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const client = new Client({ name: 'walkthrough-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], cwd: dir }));
  t.after(() => client.close());
  const tool = 'review_architecture_walkthrough';
  assert.ok((await client.listTools()).tools.some(item => item.name === tool));

  for (const [placement, affected] of [
    ['before', ['landscape']],
    ['after', ['context', 'container', 'data-flow', 'component', 'deployment', 'landscape']],
  ]) {
    const scenarioPath = path.join(root, 'walkthrough', `bridge-${placement}-kafka.json`);
    const outputPath = path.join(dir, 'reviews', `${placement}.md`);
    const { stdout } = await run(process.execPath, [cli, 'review-walkthrough', manifestPath, scenarioPath, '--out', outputPath]);
    const result = JSON.parse(stdout);
    const markdown = await fs.readFile(outputPath, 'utf8');
    assert.equal(result.artifacts.markdown, outputPath);
    assert.deepEqual(result.views.map(view => view.id), order);
    assert.deepEqual(result.views.filter(view => view.status === 'review').map(view => view.id), affected);
    assert.deepEqual(result.answeredQuestions.map(question => question.id), ['bridge-placement']);
    assert.deepEqual(result.openQuestions.map(q => q.id), manifest.questions.filter(q => q.id !== 'bridge-placement').map(q => q.id));
    assert.ok(markdown.includes(result.answeredQuestions[0].answer));
    assert.match(markdown, new RegExp(`${affected.length} of 7 diagrams needs? structural review`));
    assert.match(markdown, /wording to revisit in 4 views/);
    const code = result.views.find(view => view.id === 'code');
    assert.ok(code.retainedClaims.some(claim => claim.value.includes('InboundEvent') && markdown.includes(claim.value)));
    for (const view of result.views.filter(view => view.status === 'review')) {
      assert.ok(view.findings.length);
      for (const finding of view.findings) assert.ok(markdown.includes(finding.meaning), view.id);
    }
    // Resolve the links exactly as a local Markdown viewer would, including encoded '#' in the folder name.
    const sources = new Set();
    for (const link of markdown.matchAll(/\]\(<([^>]+)>\)/g)) {
      sources.add(await fs.realpath(path.resolve(path.dirname(outputPath), decodeURIComponent(link[1]))));
    }
    for (const view of manifest.views) assert.ok(sources.has(await fs.realpath(path.join(root, view.model))));
    const mcp = await client.callTool({ name: tool, arguments: { manifestPath, scenarioPath, outputPath } });
    assert.notEqual(mcp.isError, true);
    assert.deepEqual(mcp.structuredContent, result);
    assert.equal(await fs.readFile(outputPath, 'utf8'), markdown);
  }

  const invalidScenario = path.join(dir, 'invalid.json');
  await fs.writeFile(invalidScenario, JSON.stringify({ title: 'Mistyped claim', changes: [{ claim: 'missing', value: 'new value', reason: 'Example' }] }));
  const existingReport = path.join(dir, 'prior.md');
  await fs.writeFile(existingReport, 'previous review');
  const args = { manifestPath, scenarioPath: invalidScenario, outputPath: existingReport };
  assert.equal((await client.callTool({ name: tool, arguments: args })).isError, true);
  await assert.rejects(run(process.execPath, [cli, 'review-walkthrough', manifestPath, invalidScenario, '--out', existingReport]), /unknown claim/i);
  assert.equal(await fs.readFile(existingReport, 'utf8'), 'previous review');
});

test('a walkthrough report cannot overwrite a diagram model through an alias', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-walkthrough-alias-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(fixture, dir, { recursive: true });
  const model = path.join(dir, 'data-flow.json');
  const before = await fs.readFile(model);
  const link = path.join(dir, 'review.md');
  const args = [cli, 'review-walkthrough', path.join(dir, 'walkthrough.json'), path.join(dir, 'walkthrough/bridge-after-kafka.json'), '--out', link];
  await fs.link(model, link);
  await assert.rejects(run(process.execPath, args), /overwrite an input/);
  assert.deepEqual(await fs.readFile(model), before);
  await fs.unlink(link);
  try {
    await fs.symlink(model, link);
  } catch (error) {
    // Creating symbolic links on Windows depends on the account's privileges.
    if (process.platform === 'win32' && error.code === 'EPERM') return;
    throw error;
  }
  await assert.rejects(run(process.execPath, args), /overwrite an input/);
  assert.deepEqual(await fs.readFile(model), before);
});
