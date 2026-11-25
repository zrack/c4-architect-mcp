import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { renderFileImpactDiagram } from '../dist/renderers/fileImpactDiagram.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const sha = '1'.repeat(40);
const target = 'domain/Subject.ts';
const project = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { '@domain/*': ['domain/*'] } } }),
  'src/domain/Subject.ts': "import '../Top.js';\nimport '../outgoingOnly.js';\nexport type Subject = string;\n",
  'src/outgoingOnly.ts': 'export const out = 0;\n',
  'src/alpha/Barrel.ts': "// public barrel\nexport type { Subject }\n  from '../domain/Subject.js';\n",
  'src/beta space/Use.tsx': "// editor\n\nimport type { Subject } from '@domain/Subject';\nexport type View = Subject;\nimport type { Subject as Alias } from '@domain/Subject';\n",
  'src/Top.tsx': "import './beta space/Use.js';\nimport './alpha/Barrel.js';\nexport const top = 1;\n",
  'src/App.ts': "// application entry\nimport './Top.js';\n",
  'src/Unrelated.ts': 'export const unrelated = true;\n',
};

async function setup(t, files = project) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'c4-file-impact-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    const filename = path.join(directory, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, source);
  }
  return directory;
}

async function run(directory, file, ...flags) {
  const { stdout } = await exec(process.execPath, [cli, 'impact-file', 'src', file, '--out', 'reports/impact.md', ...flags], { cwd: directory });
  return JSON.parse(stdout);
}

const pinned = ['--github-repo', 'sample/project', '--commit', sha, '--source-root', 'src'];
const publishedLine = (from, line) => 'https://github.com/sample/project/blob/' + sha + '/src/' + from.split('/').map(encodeURIComponent).join('/') + '#L' + line;

test('impact returns shortest importer paths with source evidence through aliases, re-exports, a diamond and a cycle', async t => {
  const directory = await setup(t);
  const result = await run(directory, 'Subject.ts', ...pinned);
  const markdown = await readFile(result.artifacts.markdown, 'utf8');
  const png = await readFile(result.artifacts.png);
  assert.ok(markdown.includes(path.basename(result.artifacts.png)));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(result.file, target);
  assert.equal(result.counts.direct, 2);
  assert.equal(result.counts.indirect, 2);
  assert.equal(result.counts.nodes, 5);
  assert.deepEqual(result.truncated, { depth: false, nodes: false });

  const depths = Object.fromEntries(result.paths.map(item => [item.file, item.depth]));
  assert.deepEqual(depths, { 'alpha/Barrel.ts': 1, 'beta space/Use.tsx': 1, 'Top.tsx': 2, 'App.ts': 3 });
  assert.equal(result.paths.length, Object.keys(depths).length, 'Include each importer once despite cycles and the diamond');
  assert.doesNotMatch(markdown, /outgoingOnly\.ts|Unrelated\.ts/);

  const hops = new Map();
  for (const { file, depth, hops: chain } of result.paths) {
    assert.equal(chain.length, depth);
    let from = file;
    for (const hop of chain) {
      assert.equal(hop.from, from, 'The path must be contiguous from the importer to the selected file');
      const [evidence] = hop.evidence;
      assert.equal(evidence.path, from);
      assert.equal(evidence.url, publishedLine(from, evidence.line));
      const line = project['src/' + from].split('\n')[evidence.line - 1];
      assert.ok(line.includes("'" + evidence.specifier + "'"), 'Source link must select the actual import or re-export line');
      assert.match(hop.arrow, /^R\d+$/);
      assert.ok(markdown.includes(evidence.url) && markdown.includes(hop.arrow), 'Diagram arrows and Markdown source evidence must agree');
      hops.set(hop.arrow, hop);
      from = hop.to;
    }
    assert.equal(from, target);
  }
  assert.equal(result.counts.relationships, hops.size);
  const typeOnly = result.paths.find(item => item.file === 'beta space/Use.tsx').hops[0];
  assert.equal(typeOnly.kind, 'type-import');
  assert.equal(typeOnly.evidence[0].typeOnly, true);
  assert.equal(typeOnly.evidence[0].url, publishedLine('beta space/Use.tsx', 3));
  assert.deepEqual(typeOnly.evidence.map(item => item.line).sort(), [3, 5], 'Preserve repeated import sites without counting a file twice');
  const barrel = result.paths.find(item => item.file === 'alpha/Barrel.ts').hops[0];
  assert.equal(barrel.kind, 'type-re-export');
  assert.equal(barrel.evidence[0].url, publishedLine('alpha/Barrel.ts', 3));

  const reversed = await setup(t, Object.fromEntries(Object.entries(project).reverse()));
  const rerun = await run(reversed, './' + target, ...pinned);
  assert.deepEqual(rerun.paths, result.paths, 'Tie-breaking and arrow IDs must not depend on file creation order');
});

test('depth and display bounds identify different omissions and preserve truthful counts', async t => {
  const directory = await setup(t);
  const shallow = await run(directory, target, '--depth', '1');
  assert.equal(shallow.counts.direct, 2);
  assert.equal(shallow.counts.indirect, 0);
  assert.equal(shallow.paths.length, 2);
  assert.deepEqual(shallow.truncated, { depth: true, nodes: false });
  const limited = await run(directory, target, '--depth', '3', '--nodes', '2');
  assert.equal(limited.paths.length, 1);
  assert.equal(limited.paths[0].depth, 1);
  assert.equal(limited.counts.direct, 2);
  assert.equal(limited.counts.indirect, 2);
  assert.deepEqual(limited.truncated, { depth: false, nodes: true });
  const targetOnly = await run(directory, target, '--depth', '1', '--nodes', '1');
  assert.equal(targetOnly.counts.nodes, 1);
  assert.deepEqual(targetOnly.paths, []);
  assert.deepEqual(targetOnly.truncated, { depth: true, nodes: true });
});

test('ambiguous and missing files are rejected; a leaf is distinct from a truncated impact graph', async t => {
  const directory = await setup(t, {
    'src/Leaf.ts': 'export type Leaf = number;',
    'src/nested/Leaf.ts': "import '../deep.js';",
    'src/deep.ts': 'export const x = 1;',
  });
  await assert.rejects(run(directory, 'Leaf.ts'), err => {
    assert.match(err.stderr, /ambiguous|multiple/i);
    assert.match(err.stderr, /nested\/Leaf\.ts/);
    return true;
  });
  await assert.rejects(run(directory, 'never.ts'), err => /never\.ts/.test(err.stderr));
  await assert.rejects(readFile(path.join(directory, 'reports/impact.md')), { code: 'ENOENT' });

  const leaf = await run(directory, './Leaf.ts', '--nodes', '1', '--depth', '1');
  assert.deepEqual(leaf.paths, []);
  assert.equal(leaf.counts.direct, 0);
  assert.equal(leaf.counts.indirect, 0);
  assert.equal(leaf.counts.nodes, 1);
  assert.equal(leaf.counts.relationships, 0);
  assert.deepEqual(leaf.truncated, { depth: false, nodes: false });

  const local = await run(directory, 'deep.ts');
  const [evidence] = local.paths[0].hops[0].evidence;
  const link = new URL(evidence.url, pathToFileURL(local.artifacts.markdown));
  assert.equal(fileURLToPath(link), path.join(directory, 'src/nested/Leaf.ts'));
  assert.equal(link.hash, '#L1');
  assert.ok((await readFile(local.artifacts.markdown, 'utf8')).includes(evidence.url));
});

test('an incomplete scan qualifies the absence of observed dependents', async t => {
  const directory = await setup(t, {
    'src/Target.ts': 'export const value = 1;',
    'src/unresolved.ts': "import './missing-target';",
    'src/ignored.js': "import './Target';",
  });
  const result = await run(directory, 'Target.ts');
  assert.equal(result.analysisStatus, 'partial');
  assert.deepEqual(result.paths, []);
  const markdown = await readFile(result.artifacts.markdown, 'utf8');
  assert.match(markdown, /partial|unresolved|scan.*incomplete/i);
  assert.match(markdown, /!\[0 of 0 observed dependents within 3 hops · Importer → dependency · Partial scan\]/);
});

test('dense impact diagrams give every numbered reference its own row with both file names', async () => {
  const makeNode = (id, label, technology) => ({ id, label, technology, type: 'Component' });
  const selected = makeNode('target', 'Core.ts', 'Selected file');
  const sources = Array.from({ length: 98 }, (_, i) =>
    makeNode('file' + i, 'shared-spaces & long-names/feature-' + i + '/index.ts', 'Direct importer'));
  const leaf = makeNode('leaf', 'entry.tsx', 'Indirect · 2 hops');
  const relationships = sources.map(node => ({ from: node.id, to: selected.id, label: 'Imports module' }));
  relationships.push({ from: leaf.id, to: sources[0].id, label: 'Re-exports types' });
  const nodes = [selected, ...sources, leaf];
  const diagram = { title: 'Dependents of Core.ts', caption: '99 of 99 observed dependents within 3 hops',
    c4Level: 'C4Component', nodes, relationships };
  const arrowIds = relationships.map((_, i) => 'R' + String(i + 1).padStart(2, '0'));
  const result = await renderFileImpactDiagram(diagram, arrowIds);
  const rows = [...result.svg.matchAll(/<g data-edge-id="([^"]+)">([\s\S]*?)<\/g>/g)];
  assert.equal(rows.length, 99);
  for (const [i, [, id, row]] of rows.entries()) {
    const edge = relationships[i];
    const words = row.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&');
    assert.equal(id, arrowIds[i]);
    assert.ok(words.includes(id) && words.includes(edge.label));
    assert.ok(words.includes(nodes.find(node => node.id === edge.from).label));
    assert.ok(words.includes(nodes.find(node => node.id === edge.to).label));
    assert.equal((row.match(/<path /g) ?? []).length, 1);
  }
  assert.match(rows.at(-1)[2], /Indirect · 2 hops/);
  assert.equal(result.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const smallDiagram = { ...diagram, nodes: [selected, sources[0]], relationships: relationships.slice(0, 1) };
  assert.match((await renderFileImpactDiagram(smallDiagram, ['R01'])).svg, /data-engine="elk"/);
});

test('CLI and MCP expose the same pinned impact result and reject unsafe limits', { timeout: 30000 }, async t => {
  const directory = await setup(t);
  const result = await run(directory, target, ...pinned, '--depth', '2', '--nodes', '3');
  const client = new Client({ name: 'file-impact-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], cwd: directory }));
    const args = { targetDir: 'src', file: target, outputPath: 'reports/impact.md', repository: 'sample/project', commit: sha, sourceRoot: 'src', maxDepth: 2, maxNodes: 3 };
    const response = await client.callTool({ name: 'analyze_file_impact', arguments: args });
    assert.ok(!response.isError, JSON.stringify(response.content));
    assert.deepEqual(response.structuredContent, result);
    for (const bounds of [{ maxDepth: 0 }, { maxNodes: 101 }]) {
      const invalid = await client.callTool({ name: 'analyze_file_impact', arguments: { ...args, ...bounds } });
      assert.equal(invalid.isError, true);
    }
  } finally {
    await client.close();
  }
  await assert.rejects(run(directory, target, '--depth', '6'));
  await assert.rejects(run(directory, target, '--nodes', '0'));
});
