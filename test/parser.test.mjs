import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzeDirectory } from '../dist/parsers/astParser.js';
import { extractSourceFacts } from '../dist/parsers/syntaxFacts.js';

const fixture = fileURLToPath(new URL('./fixtures/parser/resolution', import.meta.url));
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'c4-parser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function write(directory, filename, content) {
  const selected = path.join(directory, filename);
  await mkdir(path.dirname(selected), { recursive: true });
  await writeFile(selected, content);
}
async function copiedFixture(t) {
  const directory = await temporary(t);
  await cp(fixture, directory, { recursive: true });
  return directory;
}
const byPath = (graph, filename) => graph.nodes.find(node => node.path === filename);
function targetPaths(graph, source) {
  return graph.edges.filter(edge => edge.source === source.id).map(edge => graph.nodes.find(node => node.id === edge.target).path);
}

test('native Tree-sitter extracts TS/TSX module facts, named exports and type-only evidence', async () => {
  const facts = extractSourceFacts(await readFile(path.join(fixture, 'src/index.ts'), 'utf8'), 'src/index.ts');
  assert.equal(facts.parseStatus, 'complete');
  assert.deepEqual(facts.diagnostics, []);
  assert.equal(facts.dependencies.length, 16);
  assert.equal(facts.dependencies.filter(item => item.kind === 'type-import').length, 3);
  assert.equal(facts.dependencies.filter(item => item.kind === 're-export').length, 4);
  assert.ok(facts.dependencies.some(item => item.kind === 'dynamic-import' && item.specifier === './feature'));
  assert.ok(facts.dependencies.some(item => item.kind === 'require' && item.specifier === './feature'));
  assert.ok(facts.dependencies.find(item => item.specifier === './a-b.js').evidence.line === 1);
  for (const expected of ['variable:a', 'variable:b', 'variable:x', 'variable:renamed', 'default', 'named:orderAlias', 'named:Thing', 'namespace:featureNamespace', 're-export:*:./feature']) {
    assert.ok(facts.exports.includes(expected), `Missing export ${expected}`);
  }
  assert.ok(!facts.exports.includes('variable:hidden'), 'Namespace members must not be misreported as file exports');
  const tsx = extractSourceFacts('export default () => <div>ok</div>;', 'view.tsx', true);
  assert.equal(tsx.parseStatus, 'complete');
  assert.ok(tsx.exports.includes('default'));
});

test('official TypeScript resolver handles aliases, indexes, extension substitutions and unsymlinked workspace exports', async t => {
  const directory = await copiedFixture(t);
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.schemaVersion, '1.0');
  assert.equal(graph.metadata.analysisStatus, 'complete', JSON.stringify(graph.diagnostics));
  assert.equal(graph.sources.length, 9);
  assert.equal(graph.metadata.filesScanned, graph.sources.length);
  assert.ok(!graph.sources.some(source => source.path.startsWith('custom-output/')));
  const entry = byPath(graph, 'src/index.ts');
  const targets = targetPaths(graph, entry);
  for (const filename of ['src/a-b.ts', 'src/a_b.ts', 'src/same.ts', 'src/same.tsx', 'src/feature/index.ts', 'src/services/orders.ts', 'packages/shared/src/index.ts', 'src/types.ts']) {
    assert.ok(targets.includes(filename), `Missing resolved ${filename}; ${JSON.stringify(graph.diagnostics)}`);
  }
  const dashed = byPath(graph, 'src/a-b.ts'), underscored = byPath(graph, 'src/a_b.ts');
  assert.notEqual(dashed.id, underscored.id);
  assert.notEqual(byPath(graph, 'src/same.ts').id, byPath(graph, 'src/same.tsx').id);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.target)));
  assert.ok(graph.edges.every(edge => edge.protocol === 'unknown'));
  assert.ok(graph.edges.some(edge => edge.kind === 'type-re-export'));
  assert.ok(graph.edges.some(edge => edge.kind === 'type-import' && edge.evidence.every(item => item.typeOnly)));
  assert.ok(graph.nodes.every(node => node.parentId && graph.hierarchy.some(boundary => boundary.id === node.parentId)));
  const source = graph.sources.find(source => source.path === 'src/index.ts');
  assert.equal(source.contentHash, createHash('sha256').update(await readFile(path.join(directory, source.path))).digest('hex'));
  const second = await analyzeDirectory(directory, 'Component');
  assert.deepEqual({ ...graph, metadata: { ...graph.metadata, timestamp: '' } }, { ...second, metadata: { ...second.metadata, timestamp: '' } });
  const clone = await copiedFixture(t);
  const cloneGraph = await analyzeDirectory(clone, 'Component');
  assert.deepEqual(graph.nodes.map(node => node.id), cloneGraph.nodes.map(node => node.id), 'IDs are scan-relative rather than absolute-machine paths');
});

test('observed package syntax is separate from low-confidence SDK/database classification and unknown runtime protocol', async t => {
  const directory = await temporary(t);
  await write(directory, 'main.ts', `import pg from 'pg';\nimport axios from 'axios';\nimport type { SDK } from '@modelcontextprotocol/sdk';\nimport helper from 'uninstalled-package/subpath';\nimport fs from 'node:fs';`);
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.metadata.analysisStatus, 'partial');
  const db = byPath(graph, 'package:pg'), sdk = byPath(graph, 'package:axios');
  assert.equal(db.type, 'ContainerDb');
  assert.equal(db.classification.basis, 'inferred');
  assert.equal(db.classification.rule, 'known-database-package');
  assert.equal(sdk.classification.rule, 'known-sdk-package');
  assert.ok(byPath(graph, 'package:uninstalled-package'));
  assert.ok(!byPath(graph, 'package:node:fs'));
  assert.ok(graph.diagnostics.some(item => item.code === 'BUILTIN_MODULE' && item.specifier === 'node:fs'));
  assert.ok(graph.diagnostics.some(item => item.code === 'UNRESOLVED_PACKAGE'));
  assert.ok(graph.edges.every(edge => edge.evidence.length && edge.protocol === 'unknown'));
  assert.ok(graph.edges.every(edge => !/invokes|reads|writes|https|communicates/i.test(edge.label)));
  assert.ok(graph.edges.find(edge => edge.target === byPath(graph, 'package:@modelcontextprotocol/sdk').id).evidence[0].typeOnly);
});

test('unresolved, excluded, computed and outside-scope imports produce diagnostics without dangling targets', async t => {
  const directory = await temporary(t);
  await write(directory, 'tsconfig.json', JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', paths: { '@local/*': ['./src/*'] } } }));
  await write(directory, 'outside.ts', 'export const outside = 1;');
  await write(directory, 'src/main.ts', `import '../outside.js';\nimport './missing.js';\nimport '@local/missing';\nimport '#missing';\nimport './ignored.js';\nimport('./' + name);\nrequire(name);\nimport './declaration.js';\nimport './data.json';`);
  await write(directory, 'src/declaration.d.ts', 'export declare const declaration: string;');
  await write(directory, 'src/data.json', '{}');
  await write(directory, 'external/ignored.ts', 'export const ignored = 1;');
  await symlink(path.join(directory, 'external/ignored.ts'), path.join(directory, 'src/ignored.ts'));
  const graph = await analyzeDirectory(path.join(directory, 'src'), 'Component');
  assert.equal(graph.sources.length, 1);
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.metadata.analysisStatus, 'partial');
  for (const code of ['OUTSIDE_SCAN_SCOPE', 'UNRESOLVED_IMPORT', 'NON_LITERAL_DEPENDENCY', 'UNSUPPORTED_MODULE_TYPE']) {
    assert.ok(graph.diagnostics.some(item => item.code === code), `Missing ${code}: ${JSON.stringify(graph.diagnostics)}`);
  }
  assert.equal(graph.diagnostics.filter(item => item.code === 'NON_LITERAL_DEPENDENCY').length, 2);
  assert.ok(graph.diagnostics.filter(item => item.code === 'UNRESOLVED_IMPORT').every(item => item.line > 0 && item.column > 0));
  assert.ok(!graph.nodes.some(node => node.path.startsWith('package:')), 'Unresolved aliases must not become fake external packages');
});

test('scan excludes dependencies, hidden paths, generated/output directories and symlink trees', async t => {
  const directory = await temporary(t);
  await write(directory, 'main.ts', 'export const root = true;');
  for (const filename of ['node_modules/pkg/index.ts', 'dist/copy.ts', 'build/copy.ts', 'output/copy.ts', '.git/copy.ts', '.hidden/copy.ts', 'vendor/copy.ts', 'generated/copy.ts', 'declarations.d.ts']) {
    await write(directory, filename, 'export const ignored = true;');
  }
  await symlink(path.join(directory, 'main.ts'), path.join(directory, 'linked.ts'));
  await symlink(path.join(directory, 'dist'), path.join(directory, 'linked-directory'));
  const graph = await analyzeDirectory(directory, 'Component');
  assert.deepEqual(graph.sources.map(source => source.path), ['main.ts']);
  assert.equal(graph.metadata.analysisStatus, 'complete');
});

test('partial syntax is reported and anonymous/default/variable exports are captured', async t => {
  const directory = await temporary(t);
  await write(directory, 'valid.ts', 'export default function () {}\nexport const first=1, second=2;');
  await write(directory, 'broken.ts', 'export const broken = ;\nimport value from "./valid.js";');
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.metadata.analysisStatus, 'partial');
  assert.equal(graph.sources.find(source => source.path === 'broken.ts').parseStatus, 'partial');
  assert.ok(graph.diagnostics.some(item => item.code === 'PARSE_ERROR' && item.path === 'broken.ts' && item.line > 0));
  assert.deepEqual(byPath(graph, 'valid.ts').exports, ['default', 'variable:first', 'variable:second']);
  assert.ok(byPath(graph, 'valid.ts').evidence.some(item => item.kind === 'export' && item.line === 2));
});

test('explicit boundary config produces actual C4 hierarchy and source evidence survives roll-up', async t => {
  const directory = await copiedFixture(t);
  const config = { schemaVersion: '1.0', system: { id: 'shop', label: 'Shop' }, defaultContainer: { id: 'web', label: 'Web app', technology: 'Browser' },
    containers: [{ id: 'shared', label: 'Shared library', paths: ['packages/shared'] }],
    components: [{ id: 'features', label: 'Feature module', paths: ['src/feature', 'src/services'], containerId: 'web' }] };
  await write(directory, 'boundaries.json', JSON.stringify(config));
  await write(directory, '.c4-architect.json', '{invalid ignored JSON');
  const options = { configPath: path.join(directory, 'boundaries.json') };
  const graph = await analyzeDirectory(directory, 'Component', options);
  const group = graph.nodes.find(node => node.id === 'component:features');
  assert.equal(group.classification.basis, 'declared');
  assert.equal(group.technologyBasis, 'inferred');
  assert.equal(byPath(graph, 'src/index.ts').technologyBasis, undefined);
  assert.equal(group.parentId, 'container:web');
  assert.ok(group.evidence.some(item => item.path === 'src/feature/index.ts'));
  assert.ok(group.evidence.some(item => item.path === 'src/services/orders.ts'));
  assert.ok(graph.hierarchy.some(item => item.id === 'system:shop'));
  const containers = await analyzeDirectory(directory, 'Container', options);
  assert.deepEqual(containers.nodes.map(node => node.type), ['Container', 'Container']);
  assert.ok(containers.edges.some(edge => edge.source === 'container:web' && edge.target === 'container:shared'));
  const context = await analyzeDirectory(directory, 'Context', options);
  assert.equal(context.nodes.length, 1);
  assert.equal(context.nodes[0].id, 'system:shop');
  assert.equal(context.edges.length, 0);
  assert.equal(context.nodes[0].evidence.filter(item => item.kind === 'source-file').length, context.sources.length);
  await assert.doesNotReject(() => analyzeDirectory(directory, 'Component'), 'Boundary config has no implicit filename convention');
  await assert.rejects(() => analyzeDirectory(directory, 'Component', { config, configPath: options.configPath }), /not both/);
});

test('analysis reads configuration as data without executing package scripts or JS config', async t => {
  const directory = await temporary(t);
  const marker = path.join(directory, 'EXECUTED');
  await write(directory, 'package.json', JSON.stringify({ name: 'safe-fixture', scripts: { prepare: `touch ${marker}` }, main: 'main.ts' }));
  await write(directory, 'tsconfig.js', `throw new Error('must not execute');`);
  await write(directory, 'main.ts', `throw new Error('must not execute'); export const source = true;`);
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.sources.length, 1);
  await assert.rejects(() => readFile(marker), /ENOENT/);
});

test('Node16 package exports distinguish static import, dynamic import and require conditions', async t => {
  const directory = await temporary(t);
  await write(directory, 'package.json', JSON.stringify({ type: 'commonjs', workspaces: ['packages/*'] }));
  await write(directory, 'tsconfig.json', JSON.stringify({ compilerOptions: { module: 'Node16', moduleResolution: 'Node16' } }));
  await write(directory, 'main.ts', `import { value } from '@fixture/conditional';\nconst dynamic = import('@fixture/conditional');\nconst required = require('@fixture/conditional');\nimport type Required = require('@fixture/conditional');`);
  await write(directory, 'packages/conditional/package.json', JSON.stringify({ name: '@fixture/conditional', type: 'module', exports: { '.': { import: './src/esm.ts', require: './src/cjs.ts' } } }));
  await write(directory, 'packages/conditional/src/esm.ts', 'export const value = "esm";');
  await write(directory, 'packages/conditional/src/cjs.ts', 'export const value = "cjs";');
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.metadata.analysisStatus, 'complete', JSON.stringify(graph.diagnostics));
  const main = byPath(graph, 'main.ts');
  const outgoing = graph.edges.filter(edge => edge.source === main.id);
  const target = kind => graph.nodes.find(node => node.id === outgoing.find(edge => edge.kind === kind)?.target)?.path;
  assert.equal(target('import'), 'packages/conditional/src/cjs.ts', 'Static imports in CommonJS follow the require condition');
  assert.equal(target('dynamic-import'), 'packages/conditional/src/esm.ts', 'Dynamic imports retain native ESM resolution in CommonJS');
  assert.equal(target('require'), 'packages/conditional/src/cjs.ts');
  assert.equal(target('type-import'), 'packages/conditional/src/cjs.ts', 'Type-only import-equals retains require resolution');
});

test('duplicate workspace package names are diagnosed and never resolved arbitrarily', async t => {
  const directory = await temporary(t);
  await write(directory, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
  await write(directory, 'main.ts', `import { value } from '@fixture/duplicate';`);
  for (const name of ['one', 'two', 'three']) {
    await write(directory, `packages/${name}/package.json`, JSON.stringify({ name: '@fixture/duplicate', types: './index.ts' }));
    await write(directory, `packages/${name}/index.ts`, 'export const value = 1;');
  }
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.metadata.analysisStatus, 'partial');
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.diagnostics.some(item => item.code === 'AMBIGUOUS_WORKSPACE_PACKAGE'));
  assert.ok(graph.diagnostics.some(item => item.code === 'UNRESOLVED_IMPORT'));
});

test('unrecognized runtime schemes and unknown node built-ins are diagnosed rather than fabricated as packages', async t => {
  const directory = await temporary(t);
  await write(directory, 'main.ts', `import 'node:nonexistent-module';\nimport 'https://example.invalid/module.ts';\nimport 'bun:sqlite';`);
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.diagnostics.filter(item => item.code === 'UNRESOLVED_IMPORT').length, 3);
  assert.equal(graph.metadata.analysisStatus, 'partial');
});

test('a configured component cannot silently cross declared container boundaries', async t => {
  const directory = await temporary(t);
  await write(directory, 'api/main.ts', 'export const api = true;');
  await write(directory, 'worker/main.ts', 'export const worker = true;');
  const config = { schemaVersion: '1.0', containers: [{ id: 'api', label: 'API', paths: ['api'] }, { id: 'worker', label: 'Worker', paths: ['worker'] }],
    components: [{ id: 'ambiguous', label: 'Ambiguous', paths: ['api', 'worker'] }] };
  await assert.rejects(() => analyzeDirectory(directory, 'Component', { config }), /multiple container boundaries/);
});

test('package names matching Object prototype keys remain ordinary inferred package dependencies', async t => {
  const directory = await temporary(t);
  const names = ['constructor', '__proto__', 'toString'];
  await write(directory, 'main.ts', names.map(name => `import '${name}';`).join('\n'));
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.edges.length, names.length);
  for (const name of names) {
    const node = byPath(graph, `package:${name}`);
    assert.equal(node.type, 'ExternalSystem');
    assert.equal(node.technology, 'Package dependency');
    assert.equal(node.classification.rule, 'package-as-external-dependency');
  }
});

test('TypeScript 5 star and namespace type re-exports retain type-only evidence without false syntax errors', async t => {
  const directory = await temporary(t);
  await write(directory, 'index.ts', `export type * from './types.ts';\nexport /* comment */ type * as Models from './types.ts';\nexport * from './types.ts';`);
  await write(directory, 'types.ts', 'export interface Model { id: string }');
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.metadata.analysisStatus, 'complete', JSON.stringify(graph.diagnostics));
  assert.equal(graph.sources.find(source => source.path === 'index.ts').parseStatus, 'complete');
  const typeEdge = graph.edges.find(edge => edge.kind === 'type-re-export');
  assert.deepEqual(typeEdge.evidence.map(item => [item.line, item.specifier, item.typeOnly]), [[1, './types.ts', true], [2, './types.ts', true]]);
  assert.ok(byPath(graph, 'index.ts').exports.includes('namespace:Models'));
  assert.equal(graph.edges.find(edge => edge.kind === 're-export').evidence[0].typeOnly, false);
  assert.equal(graph.diagnostics.filter(item => item.code === 'PARSE_ERROR').length, 0);

  const mixed = extractSourceFacts(`export type * from './types.ts';\nexport const broken = ;`, 'mixed.ts');
  assert.equal(mixed.parseStatus, 'partial');
  assert.equal(mixed.dependencies[0].typeOnly, true);
  assert.ok(mixed.diagnostics.some(item => item.code === 'PARSE_ERROR' && item.line === 2));
  assert.ok(!mixed.diagnostics.some(item => item.code === 'PARSE_ERROR' && item.line === 1));
  assert.equal(extractSourceFacts('export type * from', 'incomplete.ts').parseStatus, 'partial');
});

test('BOM-marked TypeScript source preserves decoded evidence positions and raw-byte hashes', async t => {
  const directory = await temporary(t);
  const statement = `import { value } from './target.js';`;
  const sourceText = `${statement}\r\n// Éditeur 日本語\r\nexport const result = value;\r\n`;
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sourceText, 'utf16le')]);
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(sourceText, 'utf16le').swap16()]);
  const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sourceText, 'utf8')]);
  const inputs = [['le.ts', utf16le], ['be.ts', utf16be], ['utf8.ts', utf8bom]];
  for (const [filename, bytes] of inputs) await write(directory, filename, bytes);
  await write(directory, 'target.ts', 'export const value = 1;');
  const graph = await analyzeDirectory(directory, 'Component');
  assert.equal(graph.metadata.analysisStatus, 'complete', JSON.stringify(graph.diagnostics));
  const target = byPath(graph, 'target.ts');
  for (const [filename, bytes] of inputs) {
    const source = graph.sources.find(item => item.path === filename);
    assert.equal(source.parseStatus, 'complete');
    assert.equal(source.contentHash, createHash('sha256').update(bytes).digest('hex'));
    const edge = graph.edges.find(item => item.source === byPath(graph, filename).id && item.target === target.id);
    assert.equal(edge.evidence[0].line, 1);
    assert.equal(edge.evidence[0].column, statement.indexOf("'") + 1);
    assert.equal(edge.evidence[0].specifier, './target.js');
  }

  const invalidBytes = Buffer.from([0xff, 0xfe, 0x65]); // truncated UTF-16 code unit
  await write(directory, 'invalid.ts', invalidBytes);
  const invalidGraph = await analyzeDirectory(directory, 'Component');
  assert.equal(invalidGraph.metadata.analysisStatus, 'partial');
  const invalidSource = invalidGraph.sources.find(item => item.path === 'invalid.ts');
  assert.equal(invalidSource.parseStatus, 'error');
  assert.equal(invalidSource.contentHash, createHash('sha256').update(invalidBytes).digest('hex'));
  assert.ok(invalidGraph.diagnostics.some(item => item.code === 'SOURCE_ENCODING_ERROR' && item.path === 'invalid.ts'));
});

test('existing local assets reached via baseUrl, paths aliases or relative imports are not external packages', async t => {
  const directory = await temporary(t);
  await write(directory, 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@theme': ['styles/main.css'], '@images/*': ['assets/*'] } } }));
  await write(directory, 'styles/main.css', 'body { color: red; }');
  await write(directory, 'assets/logo.svg', '<svg/>');
  await write(directory, 'src/local.scss', '$x: red;');
  await write(directory, 'src/main.ts', [
    `import 'styles/main.css';`, `import '@theme';`, `import logo from '@images/logo.svg';`, `import './local.scss';`,
    `import missing from '@images/missing.svg';`, `import external from 'external-icons/logo.svg';`,
  ].join('\n'));
  const graph = await analyzeDirectory(path.join(directory, 'src'), 'Component');
  const assetDiagnostics = graph.diagnostics.filter(item => item.code === 'UNSUPPORTED_MODULE_TYPE');
  assert.deepEqual(assetDiagnostics.map(item => [item.line, item.specifier]), [[1, 'styles/main.css'], [2, '@theme'], [3, '@images/logo.svg'], [4, './local.scss']]);
  assert.ok(graph.diagnostics.some(item => item.code === 'UNRESOLVED_IMPORT' && item.specifier === '@images/missing.svg'));
  assert.ok(!byPath(graph, 'package:styles'), 'A verified local stylesheet must not become an external system');
  assert.ok(byPath(graph, 'package:external-icons'), 'A missing ordinary package import remains observed');
  assert.equal(graph.edges.length, 1);
});
