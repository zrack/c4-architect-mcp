import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const exec = promisify(execFile);
const run = (args, cwd) => exec(process.execPath, [cli, ...args], { cwd });

test('demo replay discovers its fixture from an empty directory and preserves previous results', async t => {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'first time c4-')));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const first = await run(['demo', 'replay'], cwd);
  const folder = path.join(cwd, 'c4-replay');
  const lines = first.stdout.split(/\r?\n/);
  for (const file of ['report.md', 'before-kafka.svg', 'after-kafka.svg']) {
    const target = path.join(folder, file);
    assert.ok(lines.includes(target), `Expected a standalone path to ${file}`);
    assert.ok((await fs.stat(target)).size > 0);
  }
  assert.match(first.stdout, /Application server owns the checkpoint/);
  assert.match(first.stdout, /Integration bridge owns the checkpoint/);
  const traces = JSON.parse(await fs.readFile(path.join(folder, 'traces.json'), 'utf8'));
  assert.equal(traces.runs.length, 6);

  const original = path.join(folder, 'report.md');
  await fs.writeFile(original, 'My review notes');
  const again = await run(['demo', 'replay'], cwd);
  assert.ok(again.stdout.split(/\r?\n/).includes(path.join(cwd, 'c4-replay-2', 'report.md')));
  assert.equal(await fs.readFile(original, 'utf8'), 'My review notes');
});

test('demo help and invalid demo commands leave the current directory empty', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-demo-help-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  for (const args of [['--help'], ['demo'], ['demo', '--help'], ['demo', 'replay', '-h']]) {
    assert.match((await run(args, cwd)).stdout, /demo replay/);
  }
  await assert.rejects(run(['demo', 'unknown'], cwd), /Use c4-architect-mcp demo replay/);
  await assert.rejects(run(['demo', 'replay', '--typo'], cwd), /Use c4-architect-mcp demo replay/);
  assert.deepEqual(await fs.readdir(cwd), []);
});
