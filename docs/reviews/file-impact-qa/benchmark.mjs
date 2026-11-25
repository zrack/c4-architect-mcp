import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const [buildArg, takeNoteArg, resultArg] = process.argv.slice(2);
if (!buildArg || !takeNoteArg || !resultArg)
  throw new Error('Usage: node benchmark.mjs BUILT_CHECKOUT TAKENOTE_CHECKOUT OUTPUT.json');
const build = path.resolve(buildArg);
const takeNote = path.resolve(takeNoteArg);
const exec = promisify(execFile);
const takeNoteCommit = (await exec('git', ['-C', takeNote, 'rev-parse', 'HEAD'])).stdout.trim();
assert.equal(takeNoteCommit, 'e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331');
assert.equal((await exec('git', ['-C', takeNote, 'status', '--porcelain'])).stdout, '');
const entry = path.join(build, 'dist/index.js');
const sdk = path.join(build, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client');
const { Client } = await import(pathToFileURL(path.join(sdk, 'index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'stdio.js')));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-impact-perf-'));
const fixture = path.join(scratch, 'large');
const multiline = path.join(scratch, 'multiline');
await fs.mkdir(fixture);
await fs.mkdir(multiline);
await fs.writeFile(path.join(fixture, 'Core.ts'), 'export const core = 1;\n');
await fs.copyFile(path.join(fixture, 'Core.ts'), path.join(multiline, 'Core.ts'));
for (let i = 0; i < 1000; i++) {
  const parent = i < 40 ? 'Core' : 'File' + String((i - 40) % 40).padStart(4, '0');
  const name = 'File' + String(i).padStart(4, '0');
  await fs.writeFile(
    path.join(multiline, name + '.ts'),
    'export { core }\n  from "./' + parent + '.js";\n'
  );
  await fs.writeFile(path.join(fixture, name + '.ts'), 'export { core } from "./' + parent + '.js";\n');
}
const cases = [
  {
    name: 'trail-notes',
    root: path.join(build, 'examples/trail-notes/src'),
    file: 'note.ts',
    direct: 3,
    indirect: 2,
    files: 6,
    n: 10,
    nodes: 25,
    mcpBudget: 2000,
    cliBudget: 4000,
  },
  {
    name: 'takenote',
    root: path.join(takeNote, 'src'),
    file: 'client/containers/NoteEditor.tsx',
    direct: 1,
    indirect: 2,
    files: 76,
    n: 15,
    nodes: 25,
    mcpBudget: 2000,
    cliBudget: 4000,
  },
  {
    name: 'large',
    root: fixture,
    file: 'Core.ts',
    direct: 40,
    indirect: 960,
    files: 1001,
    n: 10,
    nodes: 25,
    mcpBudget: 8000,
    cliBudget: 8000,
  },
  {
    name: 'large-multiline',
    root: multiline,
    file: 'Core.ts',
    direct: 40,
    indirect: 960,
    files: 1001,
    n: 5,
    nodes: 25,
    mcpBudget: 8000,
    cliBudget: 8000,
  },
  {
    name: 'large-expanded',
    root: fixture,
    file: 'Core.ts',
    direct: 40,
    indirect: 960,
    files: 1001,
    n: 5,
    nodes: 100,
  },
];
function summary(samples, budget) {
  const sorted = samples.toSorted((a, b) => a - b);
  const p = (q) => sorted[Math.ceil(q * sorted.length) - 1];
  return {
    samplesMs: samples,
    medianMs: p(0.5),
    p95Ms: p(0.95),
    ...(budget ? { budgetMs: budget, passed: p(0.95) <= budget } : {}),
  };
}
function elapsed(start) {
  return Math.round(performance.now() - start);
}
const client = new Client({ name: 'file-impact-benchmark', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: build });
const report = {
  runtime: process.version,
  platform: os.platform(),
  arch: os.arch(),
  takeNoteCommit,
  started: new Date().toISOString(),
  scenarios: [],
};
try {
  const connectStart = performance.now();
  await client.connect(transport);
  report.connectMs = elapsed(connectStart);
  for (const scenario of cases) {
    const { name, root, file, direct, indirect, files, n, nodes, mcpBudget, cliBudget } = scenario;
    async function once(mode, i) {
      const outputPath = path.join(scratch, 'out', name, mode, i + '.md');
      const start = performance.now();
      let result;
      if (mode === 'mcp') {
        const r = await client.callTool({
          name: 'analyze_file_impact',
          arguments: { targetDir: root, file, outputPath, maxNodes: nodes },
        });
        assert.ok(!r.isError, JSON.stringify(r.content).slice(0, 600));
        result = r.structuredContent;
      } else {
        const r = await exec(
          process.execPath,
          [entry, 'impact-file', root, file, '--out', outputPath, '--nodes', String(nodes)],
          { cwd: build, maxBuffer: 16 * 1024 * 1024, timeout: 60000 }
        );
        result = JSON.parse(r.stdout);
      }
      const ms = elapsed(start);
      const displayed = Math.min(nodes, direct + indirect + 1);
      assert.deepEqual(result.counts, {
        direct,
        indirect,
        nodes: displayed,
        relationships: displayed - 1,
      });
      assert.deepEqual(result.truncated, { depth: false, nodes: displayed < direct + indirect + 1 });
      assert.equal(result.analysisStatus, name === 'takenote' ? 'partial' : 'complete');
      assert.equal(result.paths.length, displayed - 1);
      const markdown = await fs.readFile(outputPath, 'utf8');
      assert.ok(markdown.includes('covered ' + files + ' TypeScript/TSX files'));
      assert.ok(markdown.includes(path.basename(result.artifacts.png)));
      const png = await fs.readFile(result.artifacts.png);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      return ms;
    }
    const firstMcpMs = await once('mcp', 'first');
    const series = { mcp: [], cli: [] };
    for (let i = 0; i < n; i++) {
      for (const mode of i % 2 ? ['cli', 'mcp'] : ['mcp', 'cli']) series[mode].push(await once(mode, i));
    }
    report.scenarios.push({
      name,
      files,
      direct,
      indirect,
      displayLimit: nodes,
      repetitionsPerMode: n,
      firstMcpMs,
      mcp: summary(series.mcp, mcpBudget),
      cli: summary(series.cli, cliBudget),
    });
    console.log(name, JSON.stringify(report.scenarios.at(-1)));
    if (name === 'takenote') {
      const samples = [];
      for (let batch = 0; batch < 4; batch++) {
        const concurrent = Array.from({ length: 4 }, (_, slot) => once('mcp', 'batch-' + batch + '-' + slot));
        samples.push(...await Promise.all(concurrent));
      }
      report.takeNoteBurst = { concurrentRequests: 4, batches: 4, ...summary(samples, 4000) };
    }
  }
} finally {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
}
report.finished = new Date().toISOString();
await fs.writeFile(resultArg, JSON.stringify(report, null, 2) + '\n');
if (!report.takeNoteBurst.passed || report.scenarios.some((s) => s.mcp.passed === false || s.cli.passed === false)) process.exitCode = 1;
