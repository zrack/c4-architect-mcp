import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const revision = side => createHash('sha1').update(`architecture review fixture ${side}`).digest('hex');

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'c4-review-regression-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function write(directory, filename, contents) {
  const target = path.join(directory, filename);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function scan(directory, side, config) {
  const graphPath = path.join(directory, `${side}.graph.json`);
  const args = ['analyze', `${side}/src`, '--level', 'Component', '--out', graphPath, '--commit', revision(side), '--summary'];
  if (config) args.push('--config', config);
  await exec(process.execPath, [entry, ...args], { cwd: directory });
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  assert.equal(graph.metadata.commit, revision(side));
  assert.equal(graph.metadata.analysisStatus, 'complete', JSON.stringify(graph.diagnostics));
  return { graph, graphPath };
}

async function review(directory, base, head) {
  const { stdout } = await exec(process.execPath, [entry, 'review', base.graphPath, head.graphPath, '--out', 'review.md'], { cwd: directory });
  const result = JSON.parse(stdout);
  return { result, markdown: await readFile(result.reportPath, 'utf8') };
}

function componentConfig(technology) {
  return JSON.stringify({
    schemaVersion: '1.0',
    components: [{ id: 'feature', label: 'Feature module', paths: ['.'], technology }],
  });
}

test('review reports an explicitly configured component technology change between TypeScript labels', { timeout: 30000 }, async t => {
  const directory = await temporary(t);
  for (const side of ['base', 'head']) await write(directory, `${side}/src/main.ts`, 'export const value = 1;');
  await write(directory, 'base.config.json', componentConfig('TypeScript'));
  await write(directory, 'head.config.json', componentConfig('TypeScript / TSX'));
  const base = await scan(directory, 'base', 'base.config.json');
  const head = await scan(directory, 'head', 'head.config.json');
  assert.equal(base.graph.nodes[0].technologyBasis, 'declared');
  assert.equal(head.graph.nodes[0].technologyBasis, 'declared');
  assert.equal(base.graph.sources[0].contentHash, head.graph.sources[0].contentHash);

  const { markdown } = await review(directory, base, head);
  assert.ok(markdown.includes(revision('base')) && markdown.includes(revision('head')));
  assert.match(markdown, /^\| Declared boundaries \| 0 \| 0 \| 1 \|$/m);
  const change = markdown.split('\n').find(line => line.includes('component:feature'));
  assert.ok(change, 'Expected a row for the changed component');
  assert.match(change, /TypeScript\s*\|[^|]*TypeScript \/ TSX/);
});

test('review treats an inferred aggregate component technology change as a source edit', { timeout: 30000 }, async t => {
  const directory = await temporary(t);
  await write(directory, 'base/src/main.ts', 'export const value = 1;');
  await write(directory, 'head/src/main.tsx', 'export const value = 1;');
  await write(directory, 'boundaries.json', componentConfig());
  const base = await scan(directory, 'base', 'boundaries.json');
  const head = await scan(directory, 'head', 'boundaries.json');
  assert.deepEqual([base.graph.nodes[0].technology, head.graph.nodes[0].technology], ['TypeScript', 'TypeScript / TSX']);
  assert.equal(base.graph.nodes[0].technologyBasis, 'inferred');
  assert.equal(head.graph.nodes[0].technologyBasis, 'inferred');

  const { result, markdown } = await review(directory, base, head);
  assert.match(markdown, /^\| Declared boundaries \| 0 \| 0 \| 0 \|$/m);
  assert.match(markdown, /^\| Source files \| 1 \| 1 \| 0 \|$/m);
  assert.equal(result.diagram, undefined);
});

test('review preserves added and removed specifiers when a package subpath changes', { timeout: 30000 }, async t => {
  const directory = await temporary(t);
  const pkg = '@fixture/review-sdk';
  await write(directory, `node_modules/${pkg}/package.json`, JSON.stringify({
    name: pkg,
    version: '1.0.0',
    exports: { './old': './old.d.ts', './new': './new.d.ts' },
  }));
  for (const subpath of ['old', 'new']) await write(directory, `node_modules/${pkg}/${subpath}.d.ts`, 'export declare const value: number;');
  await write(directory, 'base/src/main.ts', `import '${pkg}/old';`);
  await write(directory, 'head/src/main.ts', `import '${pkg}/new';`);
  const base = await scan(directory, 'base');
  const head = await scan(directory, 'head');
  assert.equal(base.graph.edges.length, 1);
  assert.equal(head.graph.edges.length, 1);
  assert.equal(base.graph.edges[0].target, head.graph.edges[0].target);

  const { markdown } = await review(directory, base, head);
  assert.match(markdown, /^\| Dependencies \| 1 \| 1 \| 0 \|$/m);
  assert.match(markdown, /^\| Added \| .*\(@fixture\/review-sdk\/new\)/m);
  assert.match(markdown, /^\| Removed \| .*\(@fixture\/review-sdk\/old\)/m);
});
