import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { diagramSchema } from '../dist/model/diagram.js';
import { renderC4Mermaid } from '../dist/renderers/c4Mermaid.js';

const run = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const dataFlow = JSON.parse(await readFile(new URL('../examples/three-tier-kafka-oracle/data-flow.json', import.meta.url), 'utf8'));

const deployment = {
  title: 'Production deployment', c4Level: 'C4Deployment',
  nodes: [
    { id: 'cloud', label: 'Production cloud', type: 'DeploymentNode' },
    { id: 'cluster', label: 'App cluster', type: 'DeploymentNode', parentId: 'cloud' },
    { id: 'app', label: 'Application', type: 'Container', parentId: 'cluster' },
    { id: 'database', label: 'Database host', type: 'DeploymentNode', parentId: 'cloud' },
    { id: 'db', label: 'Orders database', type: 'ContainerDb', parentId: 'database' },
  ],
  relationships: [{ from: 'app', to: 'db', label: 'Writes orders' }],
};
const codeNodes = [
  { id: 'handler', label: 'Order handler', type: 'Class' },
  { id: 'repository', label: 'Order repository', type: 'Interface' },
  { id: 'validate', label: 'validateOrder', type: 'Function' },
  { id: 'order', label: 'Order', type: 'Type' },
  { id: 'module', label: 'orders.ts', type: 'CodeElement' },
];
const diagrams = [
  dataFlow,
  deployment,
  {
    title: 'Submit an order', c4Level: 'C4Dynamic',
    nodes: [
      { id: 'app', label: 'Order service', type: 'Container' },
      { id: 'client', label: 'Client', type: 'Person' },
    ],
    relationships: [
      { from: 'client', to: 'app', label: 'Submit order' },
      { from: 'app', to: 'client', label: 'Confirm order' },
      { from: 'client', to: 'app', label: 'Request status' },
    ],
  },
  {
    title: 'Commerce landscape', c4Level: 'C4Landscape',
    nodes: [
      { id: 'sales', label: 'Sales platform', type: 'System' },
      { id: 'billing', label: 'Billing provider', type: 'System_Ext' },
    ],
    relationships: [{ from: 'sales', to: 'billing', label: 'Submits invoices' }],
  },
  {
    title: 'Order source symbols', c4Level: 'C4Code', nodes: codeNodes,
    relationships: [
      { from: 'module', to: 'handler', label: 'Exports' },
      { from: 'handler', to: 'repository', label: 'Uses' },
      { from: 'handler', to: 'validate', label: 'Calls' },
      { from: 'validate', to: 'order', label: 'Accepts' },
    ],
  },
];

function rect(svg, idAttribute, id) {
  const group = svg.match(new RegExp(`<g\\b[^>]* ${idAttribute}="${id}"[^>]*>([^]*?)</g>`));
  const shape = group?.[1].match(/<rect\b([^>]*)>/);
  assert.ok(shape, `Missing SVG rectangle for ${id}`);
  return Object.fromEntries([...shape[1].matchAll(/\b(x|y|width|height)="([^"]+)"/g)]
    .map(([, name, value]) => [name, Number(value)]));
}

function assertEncloses(parent, child) {
  assert.ok(child.x > parent.x && child.y > parent.y
    && child.x + child.width < parent.x + parent.width
    && child.y + child.height < parent.y + parent.height);
}

function onBorder([x, y], box) {
  const close = (a, b) => Math.abs(a - b) < 0.01;
  return (x >= box.x && x <= box.x + box.width && (close(y, box.y) || close(y, box.y + box.height)))
    || (y >= box.y && y <= box.y + box.height && (close(x, box.x) || close(x, box.x + box.width)));
}

function verifyDataFlow(diagram, markdown, mermaid, svg) {
  assert.match(markdown, /^## Data flows$/m);
  assert.match(markdown, /^\|[^\n]*Data carried[^\n]*\|$/m);
  const boxes = new Map();
  for (const node of diagram.nodes) {
    const group = svg.match(new RegExp(`<g\\b([^>]* data-node-id="${node.id}"[^>]*)>([^]*?)</g>`));
    assert.ok(group, node.id);
    assert.ok(group[1].includes(`data-dfd-type="${node.type}"`));
    const radius = Number(group[2].match(/<rect\b[^>]* rx="([^"]+)"/)?.[1]);
    if (node.type === 'Process') assert.ok(radius > 0, 'Processes have rounded corners');
    if (node.type === 'ExternalEntity') assert.equal(radius, 0, 'External entities have square corners');
    if (node.type === 'DataStore') assert.match(group[2], /<path\b[^>]*class="store-rails"/);
    boxes.set(node.id, rect(svg, 'data-node-id', node.id));
  }
  assert.match(mermaid, /shape:\s*datastore\b/);
  const aliases = new Map(diagram.nodes.map((node, index) => [node.id, `n${index}`]));
  const arrows = [...svg.matchAll(/<g class="edge"[^>]*><title>([^<]*)<\/title>[^]*?<path class="flowchart-link"[^>]* d="([^"]+)"[^>]* marker-end=/g)];
  assert.equal(arrows.length, diagram.relationships.length);
  for (const { from, to, label } of diagram.relationships) {
    assert.ok(mermaid.includes(`${aliases.get(from)} -->|"${label}"| ${aliases.get(to)}`), label);
    const arrow = arrows.find(([, title]) => title.includes(`${from} → ${to}. ${label}`));
    assert.ok(arrow, `Missing flow from ${from} to ${to} carrying ${label}`);
    const points = [...arrow[2].matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
    assert.ok(onBorder(points[0], boxes.get(from)), `${label} starts at ${from}`);
    assert.ok(onBorder(points.at(-1), boxes.get(to)), `${label} ends at ${to}`);
  }
}

function verifyDiagram(diagram, markdown, svg) {
  const mermaid = markdown.match(/^```mermaid\n([^]*?)^```$/m)?.[1];
  assert.ok(mermaid, 'Markdown contains a Mermaid source export');
  for (const node of diagram.nodes) assert.ok(svg.includes(node.label), `Missing node ${node.label}`);
  for (const relation of diagram.relationships) assert.ok(svg.includes(relation.label), `Missing relationship ${relation.label}`);

  if (diagram.c4Level === 'DataFlow') {
    verifyDataFlow(diagram, markdown, mermaid, svg);
  } else if (diagram.c4Level === 'C4Deployment') {
    assert.match(mermaid, /subgraph [^\n]*Production cloud[^\n]*\n\s*subgraph [^\n]*App cluster[^\n]*\n\s*[^\n]*Application/);
    const cloud = rect(svg, 'data-boundary-id', 'cloud');
    const cluster = rect(svg, 'data-boundary-id', 'cluster');
    const database = rect(svg, 'data-boundary-id', 'database');
    const app = rect(svg, 'data-node-id', 'app');
    const db = rect(svg, 'data-node-id', 'db');
    assertEncloses(cloud, cluster);
    assertEncloses(cloud, database);
    assertEncloses(cluster, app);
    assertEncloses(database, db);
    const route = svg.match(/<path\b[^>]* id="R01"[^>]* d="([^"]+)"[^>]* marker-end=/);
    assert.ok(route, 'A directed route connects the two deployment groups');
    const points = [...route[1].matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
    assert.ok(onBorder(points[0], app), 'Route starts at the source container');
    assert.ok(onBorder(points.at(-1), db), 'Arrow ends at the target database');
  } else if (diagram.c4Level === 'C4Dynamic') {
    const orderedLabels = diagram.relationships.map(({ label }, index) => `${index + 1}. ${label}`);
    let previousStep = -1;
    for (const label of orderedLabels) {
      assert.ok(svg.includes(`>${label}</tspan>`), `Missing visible step ${label}`);
      const step = mermaid.indexOf(label);
      assert.ok(step > previousStep, `Mermaid source must keep step ${label} in input order`);
      previousStep = step;
    }
    assert.match(markdown, /^\| Step \| From \| To \| Action \| Technology \|$/m);
    assert.deepEqual([...markdown.matchAll(/^\| (\d+) \| .*? \| .*? \| (.*?) \|/gm)]
      .map(([, step, label]) => `${step}. ${label}`), orderedLabels);
  } else if (diagram.c4Level === 'C4Landscape') {
    assert.match(svg, />Software system<\/tspan>/);
    assert.match(svg, />External system<\/tspan>/);
  } else {
    for (const kind of ['Class', 'Interface', 'Function', 'Type', 'Code element']) {
      assert.ok(svg.includes(`>${kind}</tspan>`), `Missing visible code kind ${kind}`);
    }
  }
}

async function readArtifacts(diagram, outputPath, result) {
  const stem = outputPath.slice(0, -3);
  assert.deepEqual(result.artifacts, { markdown: outputPath, svg: `${stem}.svg`, png: `${stem}.png`, html: `${stem}.html` });
  assert.equal(result.layout.nodeCount, diagram.nodes.length);
  assert.equal(result.layout.relationshipCount, diagram.relationships.length);
  const [markdown, svg, png, html] = await Promise.all([
    readFile(outputPath, 'utf8'), readFile(`${stem}.svg`, 'utf8'),
    readFile(`${stem}.png`), readFile(`${stem}.html`, 'utf8'),
  ]);
  assert.ok(markdown.startsWith(`# ${diagram.title}\n`));
  for (const extension of ['png', 'svg', 'html']) assert.ok(markdown.includes(`(${path.basename(stem)}.${extension})`));
  assert.match(svg, /^<svg\b/);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(html.includes(svg), 'The interactive export embeds the same diagram');
  verifyDiagram(diagram, markdown, svg);
  return { markdown, png };
}

test('supporting views and Code render through MCP and CLI', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'c4-diagram-views-'));
  const client = new Client({ name: 'diagram-views-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd: dir }));

  for (const diagram of diagrams) await t.test(diagram.c4Level, async () => {
    const mcpPath = path.join(dir, `${diagram.c4Level}-mcp.md`);
    const result = await client.callTool({ name: 'render_c4_mermaid', arguments: { ...diagram, outputPath: mcpPath } });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    const saved = await readArtifacts(diagram, mcpPath, result.structuredContent);
    assert.ok(saved.markdown.includes(result.content[0].text));
    const image = result.content.find(item => item.type === 'image' && item.mimeType === 'image/png');
    assert.ok(image);
    assert.deepEqual(Buffer.from(image.data, 'base64'), saved.png);

    const cliPath = path.join(dir, `${diagram.c4Level}-cli.md`);
    const input = path.join(dir, `${diagram.c4Level}.json`);
    await writeFile(input, JSON.stringify(diagram));
    const { stdout } = await run(process.execPath, [entrypoint, 'render-diagram', input, '--out', cliPath]);
    await readArtifacts(diagram, cliPath, JSON.parse(stdout));
  });

  await t.test('rejects invalid data flows before writing output through MCP and CLI', async () => {
    const invalid = { ...dataFlow, relationships: [{ from: 'kafka', to: 'oracle', label: 'Event record' }] };
    const input = path.join(dir, 'invalid-data-flow.json');
    const output = path.join(dir, 'invalid-data-flow.md');
    const result = await client.callTool({ name: 'render_c4_mermaid', arguments: { ...invalid, outputPath: output } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Process/);
    await writeFile(input, JSON.stringify(invalid));
    await assert.rejects(run(process.execPath, [entrypoint, 'render-diagram', input, '--out', output]),
      error => error.code === 1 && /Process/.test(error.stderr));
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  });

  await t.test('rejects malformed deployment hierarchy', async () => {
    const cycle = structuredClone(deployment);
    cycle.nodes[0].parentId = 'cluster';
    const result = await client.callTool({ name: 'render_c4_mermaid', arguments: cycle });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cycle/i);

    const endpoint = structuredClone(deployment);
    endpoint.relationships[0].to = 'cloud';
    const input = path.join(dir, 'invalid-deployment.json');
    const output = path.join(dir, 'invalid-deployment.md');
    await writeFile(input, JSON.stringify(endpoint));
    await assert.rejects(run(process.execPath, [entrypoint, 'render-diagram', input, '--out', output]),
      error => error.code === 1 && /deployment node/i.test(error.stderr) && /cloud/.test(error.stderr));
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  });
});

test('DataFlow validates payload labels, endpoints and view-specific node types', () => {
  const flow = (from, to, label) => ({ ...dataFlow, relationships: [{ from, to, label }] });
  for (const [from, to] of [['user', 'kafka'], ['oracle', 'oracle'], ['kafka', 'oracle'], ['oracle', 'kafka']]) {
    assert.throws(() => diagramSchema.parse(flow(from, to, 'Record')), /Process/);
  }
  for (const label of ['', ' \t\n']) {
    assert.throws(() => diagramSchema.parse(flow('event', 'oracle', label)), /label/);
  }
  assert.throws(() => diagramSchema.parse(flow('event', 'missing', 'Record')), /unknown node/i);
  const withContainer = { ...dataFlow, nodes: dataFlow.nodes.map(n => n.id === 'web' ? { ...n, type: 'Container' } : n) };
  assert.throws(() => diagramSchema.parse(withContainer), /ExternalEntity, Process, or DataStore/);
  assert.throws(() => diagramSchema.parse({ ...dataFlow, c4Level: 'C4Component' }), /only allowed in DataFlow/);
  assert.doesNotThrow(() => diagramSchema.parse(flow('oracle', 'event', 'Stored record')));
});

test('DataFlow preserves punctuation in quoted Mermaid store and payload labels', () => {
  const diagram = structuredClone(dataFlow);
  diagram.nodes.find(node => node.type === 'DataStore').label = 'Records "A" | {B}';
  diagram.relationships.at(-1).label = 'A | B & C';
  const mermaid = renderC4Mermaid(diagram);
  // Mermaid 12 renders numeric entities literally in SVG-only edge labels.
  assert.match(mermaid, /htmlLabels:\s*true/);
  assert.ok(mermaid.includes('Records #34;A#34; #124; #123;B#125;'));
  assert.ok(mermaid.includes('-->|"A #124; B #38; C"|'));
});
