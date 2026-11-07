import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  stableId, validateArchitectureGraph, readArchitectureGraph, writeArchitectureGraph,
  summarizeArchitectureGraph, queryArchitectureGraph, compareArchitectureGraphs,
} from '../dist/model/graph.js';
import { createBoundaryMapper, validateBoundaryConfig } from '../dist/model/config.js';

const inferred = { basis: 'inferred', rule: 'test-file-mapping', confidence: 'low' };
const observed = { basis: 'observed', rule: 'tree-sitter-import', confidence: 'high' };
const hash = value => createHash('sha256').update(value).digest('hex');
const evidence = (file, line = 1) => ({ path: file, line, column: 1, kind: 'import', specifier: './dependency' });

function sampleGraph() {
  return {
    schemaVersion: '1.0',
    metadata: { scannedDirectory: '/checkout/project/src', abstractionLevel: 'Component', filesScanned: 3,
      timestamp: '2026-11-06T00:00:00.000Z', analysisStatus: 'complete' },
    hierarchy: [
      { id: 'system:sample', label: 'Sample', type: 'System', classification: inferred },
      { id: 'container:app', label: 'App', type: 'Container', parentId: 'system:sample', classification: inferred },
    ],
    nodes: ['a', 'b', 'c'].map(id => ({ id: `component:${id}`, label: id.toUpperCase(), type: 'Component',
      technology: 'TypeScript', path: `${id}.ts`, parentId: 'container:app', classification: observed,
      evidence: [evidence(`${id}.ts`)], exports: [`function:${id}`] })),
    edges: [['a', 'b'], ['b', 'c'], ['c', 'a']].map(([from, to]) => ({
      id: `edge:${from}-${to}`, source: `component:${from}`, target: `component:${to}`, label: 'Imports', protocol: 'unknown',
      kind: 'import', evidence: [evidence(`${from}.ts`)],
    })),
    sources: ['a', 'b', 'c'].map(id => ({ path: `${id}.ts`, contentHash: hash(id), parseStatus: 'complete' })),
    diagnostics: [],
  };
}

test('stable identities preserve path punctuation, extensions and clone-independent relative keys', () => {
  assert.equal(stableId('component', 'src/lib/api.ts'), stableId('component', 'src/lib/api.ts'));
  assert.equal(stableId('component', 'src\\lib\\api.ts'), stableId('component', 'src/lib/api.ts'));
  assert.notEqual(stableId('component', 'a-b.ts'), stableId('component', 'a_b.ts'));
  assert.notEqual(stableId('component', 'view.ts'), stableId('component', 'view.tsx'));
  assert.notEqual(stableId('component', 'API.ts'), stableId('component', 'api.ts'));
  assert.notEqual(stableId('a-b', 'same.ts'), stableId('a_b', 'same.ts'));
});

test('graph validation rejects incompatible versions, ambiguous identities and dangling references', () => {
  assert.deepEqual(validateArchitectureGraph(sampleGraph()), sampleGraph());
  for (const mutate of [
    graph => { graph.schemaVersion = '9.0'; },
    graph => { graph.nodes[1].id = graph.nodes[0].id; },
    graph => { graph.edges[1].id = graph.edges[0].id; },
    graph => { graph.edges[0].target = 'missing'; },
    graph => { graph.nodes[0].parentId = 'missing-parent'; },
    graph => { graph.nodes[0].parentId = graph.nodes[1].id; },
    graph => { graph.hierarchy[1].parentId = graph.hierarchy[1].id; },
    graph => { graph.sources[0].contentHash = 'unverified'; },
    graph => { graph.sources[0].path = '../outside.ts'; },
    graph => { graph.metadata.filesScanned = 4; },
    graph => { graph.nodes[0].evidence[0].path = 'missing.ts'; },
    graph => { graph.nodes[0].evidence = []; },
  ]) {
    const graph = sampleGraph(); mutate(graph);
    assert.throws(() => validateArchitectureGraph(graph));
  }
});

test('partial source evidence is explicit and source positions remain trustworthy', () => {
  const graph = sampleGraph();
  graph.sources[0].parseStatus = 'partial';
  assert.throws(() => validateArchitectureGraph(graph), /partial/);
  graph.metadata.analysisStatus = 'partial';
  assert.equal(validateArchitectureGraph(graph).metadata.analysisStatus, 'partial');
  graph.nodes[0].evidence[0].line = 4;
  graph.nodes[0].evidence[0].endLine = 3;
  assert.throws(() => validateArchitectureGraph(graph), /end position/);
});

test('saved graphs round-trip through runtime validation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'c4-model-'));
  try {
    const filename = path.join(directory, 'graph.json');
    const graph = sampleGraph();
    await writeArchitectureGraph(filename, graph);
    assert.deepEqual(await readArchitectureGraph(filename), graph);
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).schemaVersion, '1.0');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('summary reports evidence quality and uncertainty without dumping source data', () => {
  const graph = sampleGraph();
  graph.nodes[1].classification = inferred;
  graph.diagnostics.push({ code: 'INFERRED_CONTAINER', severity: 'info', message: 'Default boundary' });
  const summary = summarizeArchitectureGraph(graph);
  assert.deepEqual(summary.counts, { nodes: 3, edges: 3, boundaries: 2, sources: 3, diagnostics: 1 });
  assert.equal(summary.classifications.observed, 2);
  assert.equal(summary.classifications.inferred, 1);
  assert.equal(summary.diagnosticsBySeverity.info, 1);
  assert.ok(!JSON.stringify(summary).includes('/checkout/project'));
});

test('summary bounds extensible dependency kinds and handles object-property names as data', () => {
  const graph = sampleGraph();
  graph.edges = Array.from({ length: 100 }, (_, index) => ({ ...graph.edges[0], id: `edge:${index}`, kind: `kind:${index}` }));
  graph.edges.push({ ...graph.edges[0], id: 'edge:special', kind: '__proto__' });
  const summary = summarizeArchitectureGraph(graph);
  assert.ok(Object.keys(summary.edgesByKind).length <= 24);
  assert.equal(summary.otherEdgeKinds + Object.values(summary.edgesByKind).reduce((sum, count) => sum + count, 0), 101);
  graph.edges = [{ ...graph.edges[0], kind: '__proto__' }, { ...graph.edges[1], kind: 'constructor' }];
  const special = summarizeArchitectureGraph(graph);
  assert.equal(special.edgesByKind.__proto__, 1);
  assert.equal(special.edgesByKind.constructor, 1);
  graph.edges[0].kind = 'x'.repeat(10000);
  assert.ok(Buffer.byteLength(JSON.stringify(summarizeArchitectureGraph(graph))) < 2000);
});

test('dependency queries honor direction, traversal depth and result limits', () => {
  const graph = sampleGraph();
  const outgoing = queryArchitectureGraph(graph, { nodeId: 'component:a', direction: 'outgoing', maxDepth: 1 });
  assert.deepEqual(outgoing.nodes.map(node => node.id), ['component:a', 'component:b']);
  assert.deepEqual(outgoing.edges.map(edge => edge.id), ['edge:a-b']);
  const incoming = queryArchitectureGraph(graph, { nodeId: 'component:a', direction: 'incoming', maxDepth: 1 });
  assert.deepEqual(incoming.nodes.map(node => node.id), ['component:a', 'component:c']);
  assert.deepEqual(incoming.edges.map(edge => edge.id), ['edge:c-a']);
  const cycle = queryArchitectureGraph(graph, { nodeId: 'component:a', direction: 'outgoing', maxDepth: 5, maxNodes: 2, maxEdges: 1 });
  assert.equal(cycle.nodes.length, 2);
  assert.equal(cycle.edges.length, 1);
  assert.equal(cycle.truncated.nodes, true);
  assert.throws(() => queryArchitectureGraph(graph, { nodeId: 'missing' }), /Unknown node/);
  assert.throws(() => queryArchitectureGraph(graph, { maxNodes: 1000 }), /maxNodes/);
});

test('query byte budgets bound tool context even with large labels and evidence', () => {
  const graph = sampleGraph();
  for (const node of graph.nodes) {
    node.label = 'Large label '.repeat(1000);
    node.evidence = Array.from({ length: 100 }, (_, index) => evidence(node.path, index + 1));
  }
  const result = queryArchitectureGraph(graph, { nodeId: 'component:c', maxDepth: 5, includeEvidence: true, maxBytes: 2048 });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2048);
  assert.equal(result.nodes[0].id, 'component:c', 'The requested root should survive truncation');
  assert.equal(result.truncated.bytes, true);
  assert.equal(result.truncated.evidence, true);
  assert.ok(result.edges.every(edge => result.nodes.some(node => node.id === edge.source) && result.nodes.some(node => node.id === edge.target)));
});

test('graph comparisons ignore scan location, timestamps and evidence line drift but retain semantic/source changes', () => {
  const before = sampleGraph(), after = structuredClone(before);
  after.metadata.scannedDirectory = 'C:\\checkout\\project\\src';
  after.metadata.timestamp = '2026-11-07T00:00:00.000Z';
  after.nodes[0].evidence[0].line = 12;
  after.nodes.reverse(); after.edges.reverse();
  const unchanged = compareArchitectureGraphs(before, after);
  assert.equal(unchanged.nodes.counts.changed, 0);
  assert.equal(unchanged.edges.counts.changed, 0);
  after.nodes.find(node => node.id === 'component:b').label = 'Renamed B';
  after.edges.find(edge => edge.id === 'edge:a-b').kind = 'type-import';
  after.sources[0].contentHash = hash('changed');
  const diff = compareArchitectureGraphs(before, after);
  assert.deepEqual(diff.nodes.changed, ['component:b']);
  assert.deepEqual(diff.edges.changed, ['edge:a-b']);
  assert.deepEqual(diff.sources.changed, ['a.ts']);
  after.metadata.abstractionLevel = 'Container';
  assert.throws(() => compareArchitectureGraphs(before, after), /same abstraction level/);
});

test('checkout-derived system names do not create graph changes, while declared names do', () => {
  const before = sampleGraph();
  before.metadata.scannedDirectory = '/checkout/first-copy';
  before.metadata.abstractionLevel = 'Context';
  const system = { id: stableId('system', 'default'), type: 'System', label: 'first-copy',
    classification: { basis: 'inferred', rule: 'default-scan-scope-boundary', confidence: 'low' } };
  before.hierarchy = [system];
  before.nodes = [{ ...system, technology: 'Unknown', path: '.', evidence: [] }];
  before.edges = [];
  const after = structuredClone(before);
  after.metadata.scannedDirectory = 'C:\\checkout\\second-copy';
  after.hierarchy[0].label = after.nodes[0].label = 'second-copy';
  const renamedCheckout = compareArchitectureGraphs(before, after);
  assert.deepEqual(renamedCheckout.nodes.changed, []);
  assert.deepEqual(renamedCheckout.hierarchy.changed, []);

  after.hierarchy[0].label = after.nodes[0].label = 'Custom inferred name';
  const renamedSystem = compareArchitectureGraphs(before, after);
  assert.deepEqual(renamedSystem.nodes.changed, [system.id]);
  assert.deepEqual(renamedSystem.hierarchy.changed, [system.id]);

  // Even if declared names equal their checkout basenames, they carry intent.
  after.hierarchy[0].label = after.nodes[0].label = 'second-copy';
  for (const graph of [before, after]) {
    graph.hierarchy[0].classification = graph.nodes[0].classification = { basis: 'declared', rule: 'explicit-boundary-configuration' };
  }
  const renamedDeclaredSystem = compareArchitectureGraphs(before, after);
  assert.deepEqual(renamedDeclaredSystem.nodes.changed, [system.id]);
  assert.deepEqual(renamedDeclaredSystem.hierarchy.changed, [system.id]);
});

test('specifier-only edge ID changes are paired without hiding parallel dependencies', () => {
  const before = sampleGraph(), after = structuredClone(before);
  before.edges[0].evidence[0].specifier = './b';
  after.edges[0].id = 'edge:a-b-explicit';
  after.edges[0].evidence[0].specifier = './b.ts';
  after.sources[0].contentHash = hash('updated specifier');

  const spellingChange = compareArchitectureGraphs(before, after);
  assert.deepEqual(spellingChange.edges.counts, { added: 0, removed: 0, changed: 0 });
  assert.deepEqual(spellingChange.sources.changed, ['a.ts']);
  assert.equal(after.edges[0].id, 'edge:a-b-explicit', 'Comparison must not rewrite canonical graph IDs');

  after.edges.push({ ...after.edges[0], id: 'edge:a-b-parallel' });
  const addedParallel = compareArchitectureGraphs(before, after);
  assert.deepEqual(addedParallel.edges.added, ['edge:a-b-parallel']);
  assert.deepEqual(addedParallel.edges.removed, []);
  const removedParallel = compareArchitectureGraphs(after, before);
  assert.deepEqual(removedParallel.edges.added, []);
  assert.deepEqual(removedParallel.edges.removed, ['edge:a-b-parallel']);
});

test('matching edge IDs take priority over pairing unmatched dependencies', () => {
  const before = sampleGraph();
  before.edges.push({ ...before.edges[0], id: 'edge:a-b-types', kind: 'type-import' });
  const after = structuredClone(before);
  after.edges[0].kind = 'type-import';
  after.edges[3].kind = 'import';
  after.edges[3].id = 'edge:a-b-explicit';
  const diff = compareArchitectureGraphs(before, after);
  assert.deepEqual(diff.edges.changed, ['edge:a-b']);
  assert.deepEqual(diff.edges.removed, ['edge:a-b-types']);
  assert.deepEqual(diff.edges.added, ['edge:a-b-explicit']);
});

test('boundary configuration preserves declared group IDs and labels across rescans', () => {
  const config = validateBoundaryConfig({ schemaVersion: '1.0', system: { id: 'shop', label: 'Shopping' },
    containers: [{ id: 'api', label: 'Ordering API', paths: ['api'], technology: 'Node.js' }],
    components: [{ id: 'orders', label: 'Order orchestration', paths: ['api/orders'], containerId: 'api' }],
  });
  const first = createBoundaryMapper('/one/clone/src', config);
  const firstAssignment = first.forFile('api/orders/create.ts');
  const second = createBoundaryMapper('/different/clone/src', structuredClone(config));
  const nextAssignment = second.forFile('api/orders/renamed.ts');
  assert.equal(firstAssignment.system.id, 'system:shop');
  assert.equal(firstAssignment.container.id, 'container:api');
  assert.equal(firstAssignment.component.id, 'component:orders');
  assert.equal(firstAssignment.component.id, nextAssignment.component.id);
  assert.equal(nextAssignment.component.label, 'Order orchestration');
  assert.equal(nextAssignment.component.classification.basis, 'declared');
  assert.deepEqual(first.hierarchy.map(boundary => boundary.id), ['system:shop', 'container:api']);
});

test('default boundaries are explicit inferences and overlapping/unsafe mappings fail clearly', () => {
  const mapper = createBoundaryMapper('/repo/application');
  const first = mapper.forFile('api/orders.ts'), second = mapper.forFile('workers/queue.ts');
  assert.equal(first.container.id, second.container.id, 'Folders should not silently become deployable containers');
  assert.equal(first.system.classification.basis, 'inferred');
  assert.equal(first.container.classification.basis, 'inferred');
  assert.ok(mapper.diagnostics.some(item => item.code === 'INFERRED_CONTAINER_BOUNDARY'));
  assert.throws(() => validateBoundaryConfig({ schemaVersion: '1.0', containers: [{ id: 'api', label: 'API', paths: ['../outside'] }] }), /relative/);
  assert.throws(() => validateBoundaryConfig({ schemaVersion: '1.0', components: [{ id: 'order', label: 'Order', paths: ['orders'], containerId: 'missing' }] }), /Unknown container/);
  const overlapping = createBoundaryMapper('/repo', { schemaVersion: '1.0', containers: [
    { id: 'api', label: 'API', paths: ['src'] }, { id: 'worker', label: 'Worker', paths: ['src/jobs'] },
  ] });
  assert.throws(() => overlapping.forFile('src/jobs/run.ts'), /Ambiguous/);
  const allFiles = createBoundaryMapper('/repo', { schemaVersion: '1.0', containers: [
    { id: 'app', label: 'Application', paths: ['./'] },
  ] });
  assert.equal(allFiles.forFile('./api/orders.ts').container.id, 'container:app');
});
