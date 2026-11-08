import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const run = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const physicalDeployment = fileURLToPath(new URL('../examples/trail-notes/diagrams/physical-deployment.json', import.meta.url));

function decodeEntities(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return entities[entity];
  });
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)]
    .map(([, key, value]) => [key, decodeEntities(value)]));
}

function visibleLabel(cell) {
  return decodeEntities(cell.label.replaceAll('<br>', ' ').replace(/<[^>]*>/g, ''));
}

// Inspect the native object wrappers and their mxCells without assuming their generated IDs or positions.
function cellsIn(xml) {
  assert.match(xml, /<mxfile\b[^>]*>\s*<diagram\b[^>]*>\s*<mxGraphModel\b[^>]*>\s*<root>/);
  assert.match(xml, /<\/root>\s*<\/mxGraphModel>\s*<\/diagram>\s*<\/mxfile>\s*$/);
  const objects = [...xml.matchAll(/<object\b([^>]*)>\s*<mxCell\b([^>]*)>([\s\S]*?)<\/mxCell>\s*<\/object>/g)];
  const cells = objects.map(([, object, cell, body]) => ({
    ...attributes(object), ...attributes(cell), geometry: attributes(body.match(/<mxGeometry\b([^>]*)>/)?.[1] ?? ''),
  }));
  assert.equal(new Set(cells.map(cell => cell.id)).size, cells.length, 'Editor objects have unique cell IDs');
  return { vertices: cells.filter(cell => cell.vertex === '1'), edges: cells.filter(cell => cell.edge === '1') };
}

async function session(t) {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'c4-drawio-')));
  const client = new Client({ name: 'drawio-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd }));
  return { cwd, client, cli: (...args) => run(process.execPath, [entrypoint, ...args], { cwd }) };
}

test('Trail Notes Draw.io export keeps editable nested groups and directed labeled edges through MCP and CLI', { timeout: 30000 }, async t => {
  const { cwd, client, cli } = await session(t);
  const diagram = JSON.parse(await readFile(physicalDeployment, 'utf8'));
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'render_c4_drawio'));

  const outputPath = path.join(cwd, 'mcp', 'trail-notes.drawio');
  const result = await client.callTool({ name: 'render_c4_drawio', arguments: { ...diagram, outputPath } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.equal(result.structuredContent.artifacts.drawio, outputPath);
  const xml = await readFile(outputPath, 'utf8');
  assert.equal(result.content[0].text, xml);

  const { stdout } = await cli('render-drawio', physicalDeployment, '--out', 'cli/trail-notes.drawio');
  const cliPath = path.join(cwd, 'cli', 'trail-notes.drawio');
  assert.equal(JSON.parse(stdout).artifacts.drawio, cliPath);
  assert.equal(await readFile(cliPath, 'utf8'), xml);

  const { vertices, edges } = cellsIn(xml);
  assert.equal(edges.length, diagram.relationships.length);
  const nodes = new Map(vertices.filter(cell => cell.c4Id !== undefined).map(cell => [cell.c4Id, cell]));
  assert.equal(nodes.size, diagram.nodes.length);
  for (const node of diagram.nodes) {
    const cell = nodes.get(node.id);
    const parent = nodes.get(node.parentId);
    assert.ok(visibleLabel(cell).includes(node.label), `Missing visible label for ${node.id}`);
    assert.equal(cell.parent, parent?.id ?? '1', `${node.id} uses native parenting`);
    if (parent) {
      const { x, y, width, height } = cell.geometry;
      assert.ok(Number(x) > 0 && Number(x) + Number(width) < Number(parent.geometry.width), `${node.id} fits horizontally inside ${node.parentId}`);
      assert.ok(Number(y) > 0 && Number(y) + Number(height) < Number(parent.geometry.height), `${node.id} fits vertically inside ${node.parentId}`);
    }
    if (diagram.nodes.some(child => child.parentId === node.id)) {
      assert.match(cell.style, /(?:^|;)container=1;/, `${node.id} is an editor container`);
    }
  }
  for (const relationship of diagram.relationships) {
    const edge = edges.find(cell => cell.source === nodes.get(relationship.from).id && cell.target === nodes.get(relationship.to).id);
    assert.ok(edge && visibleLabel(edge).includes(relationship.label), `${relationship.from} → ${relationship.to} keeps its editable label`);
    assert.equal(edge.technology, relationship.technology);
    assert.equal(edge.description, relationship.description);
    assert.equal(edge.geometry.relative, '1');
  }

  await assert.rejects(cli('render-drawio', physicalDeployment, '--out', 'invalid.svg'),
    error => error.code === 1 && /\.drawio/.test(error.stderr));
  await assert.rejects(readFile(path.join(cwd, 'invalid.svg')), { code: 'ENOENT' });
});

test('Draw.io preserves parallel arrows, self-loops, and escaped user text', { timeout: 30000 }, async t => {
  const { client } = await session(t);
  const literal = `<img src=x>&"'`;
  const result = await client.callTool({ name: 'render_c4_drawio', arguments: {
    title: `Test ${literal}`, c4Level: 'C4Dynamic',
    nodes: [
      { id: '0', type: 'Container', label: literal, description: literal },
      { id: '1', type: 'Container', label: 'Target' },
    ],
    relationships: [
      { from: '0', to: '1', label: literal },
      { from: '0', to: '1', label: 'Second request' },
      { from: '1', to: '1', label: 'Retry' },
    ],
  } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const xml = result.content[0].text;
  assert.doesNotMatch(xml, /<img\b/i);
  const { vertices, edges } = cellsIn(xml);
  const source = vertices.find(cell => cell.c4Id === '0');
  const target = vertices.find(cell => cell.c4Id === '1');
  for (const cell of [source, target, ...edges]) assert.ok(!['0', '1'].includes(cell.id), 'Native IDs avoid reserved root and layer IDs');
  assert.deepEqual(edges.map(({ source, target }) => [source, target]), [[source.id, target.id], [source.id, target.id], [target.id, target.id]]);
  for (const [cell, expected] of [[source, literal], [edges[0], `1. ${literal}`]]) {
    assert.doesNotMatch(cell.label, /<img\b/i, 'HTML-mode editor labels escape source markup after XML parsing');
    assert.ok(decodeEntities(cell.label).includes(expected), 'Editor labels preserve the input as text');
  }
  assert.match(edges[1].label, /2\. Second request/);
  assert.match(edges[2].label, /3\. Retry/);
});

test('Draw.io supports saved scans and MCP focus without reanalyzing the repository', { timeout: 30000 }, async t => {
  const { cwd, client, cli } = await session(t);
  const src = path.join(cwd, 'src');
  await mkdir(src);
  await Promise.all(Object.entries({
    'api.ts': 'import "./storage.js";\n',
    'storage.ts': 'export const data = true;\n',
    'unrelated.ts': 'export const other = true;\n',
  }).map(([file, contents]) => writeFile(path.join(src, file), contents)));
  const { stdout } = await cli('analyze', 'src', '--level', 'Component', '--out', 'graph.json');
  const graph = JSON.parse(stdout);
  const apiId = graph.nodes.find(node => node.path === 'api.ts').id;
  const storageId = graph.nodes.find(node => node.path === 'storage.ts').id;
  await rm(src, { recursive: true });

  await cli('render-drawio', 'graph.json', '--out', 'all.drawio');
  const full = cellsIn(await readFile(path.join(cwd, 'all.drawio'), 'utf8'));
  assert.deepEqual(full.vertices.filter(cell => cell.c4Id).map(cell => cell.c4Id).sort(), graph.nodes.map(node => node.id).sort());
  assert.equal(full.edges.length, 1);

  const result = await client.callTool({ name: 'render_architecture_graph', arguments: {
    graphPath: 'graph.json', format: 'drawio', outputPath: 'focus.drawio', focus: { nodeId: apiId, direction: 'outgoing' },
  } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const output = path.join(cwd, 'focus.drawio');
  assert.equal(result.structuredContent.artifacts.drawio, output);
  const xml = await readFile(output, 'utf8');
  assert.equal(result.content[0].text, xml);
  const focused = cellsIn(xml);
  const nodes = new Map(focused.vertices.filter(cell => cell.c4Id).map(cell => [cell.c4Id, cell.id]));
  assert.deepEqual([...nodes.keys()].sort(), [apiId, storageId].sort());
  assert.deepEqual(focused.edges.map(({ source, target }) => [source, target]), [[nodes.get(apiId), nodes.get(storageId)]]);
  assert.match(focused.edges[0].description, /api\.ts:1:\d+ \(\.\/storage\.js\)/);
});
