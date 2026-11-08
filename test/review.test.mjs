import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const specifier = '../storage/ledger.js';
const location = 'orders/submit.ts:2:25';
const classification = { basis: 'declared', rule: 'explicit-boundary-configuration' };
const hash = text => createHash('sha256').update(text).digest('hex');

function snapshot({ withLedger = false, service = 'Order service', sourcePath = 'orders/submit.ts' } = {}) {
  const sources = [
    { id: 'submit', label: 'Order submission', file: sourcePath,
      text: withLedger
        ? `// Entry point\nimport { persist } from "${specifier}";\nexport const submit = () => persist('order');\n`
        : "export const submit = () => 'order';\n" },
    { id: 'health', label: 'Health check', file: 'health.ts', text: 'export const ready = true;\n' },
  ];
  if (withLedger) {
    sources.push({ id: 'ledger', label: 'Order ledger', file: 'storage/ledger.ts',
      text: 'export const persist = (order: string) => order;\n' });
  }
  return {
    schemaVersion: '1.0',
    metadata: {
      scannedDirectory: '/source-checkout/src', abstractionLevel: 'Component', filesScanned: sources.length,
      timestamp: '2026-11-07T00:00:00.000Z', analysisStatus: 'complete',
    },
    hierarchy: [
      { id: 'system:shop', label: 'Shop', type: 'System', classification },
      { id: 'container:orders', label: service, type: 'Container', parentId: 'system:shop', classification },
    ],
    nodes: sources.map(({ id, label, file }) => ({
      id: `component:${id}`, label, type: 'Component', technology: 'TypeScript', path: file,
      parentId: 'container:orders', classification,
      evidence: [{ path: file, line: 1, column: 1, kind: 'source-file' }],
    })),
    edges: withLedger ? [{
      id: 'relationship:submit-ledger', source: 'component:submit', target: 'component:ledger',
      label: 'Imports module', protocol: 'unknown', kind: 'import',
      evidence: [{ path: sourcePath, line: 2, column: 25, kind: 'import', specifier, typeOnly: false }],
    }] : [],
    sources: sources.map(({ file, text }) => ({ path: file, contentHash: hash(text), parseStatus: 'complete' })),
    diagnostics: [],
  };
}

async function saveSnapshots(t, before, after, beforeName = 'before.json') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-review-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, beforeName), JSON.stringify(before)),
    fs.writeFile(path.join(directory, 'after.json'), JSON.stringify(after)),
  ]);
  return fs.realpath(directory);
}

function runReview(directory, output, beforeName = 'before.json', args = []) {
  return exec(process.execPath, [entry, 'review', beforeName, 'after.json', '--out', output, ...args], { cwd: directory });
}

async function readReport(directory, output = 'review.md', args = []) {
  const { stdout } = await runReview(directory, output, 'before.json', args);
  const result = JSON.parse(stdout);
  assert.ok(path.isAbsolute(result.reportPath));
  assert.equal(await fs.realpath(result.reportPath), await fs.realpath(path.join(directory, output)));
  return { result, markdown: await fs.readFile(result.reportPath, 'utf8') };
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/\]\(<?([^\n)>]+)>?\)/g)].map(([, destination]) => destination);
}

async function checkFocusedArtifacts(result, markdown, snapshotLabel) {
  assert.ok(result.diagram, 'A dependency change should produce a focused diagram');
  const reportDirectory = path.dirname(result.reportPath);
  const artifacts = {};
  for (const format of ['markdown', 'svg', 'png', 'html']) {
    assert.equal(typeof result.diagram[format], 'string', `Missing ${format} path`);
    artifacts[format] = path.resolve(reportDirectory, result.diagram[format]);
    const stats = await fs.stat(artifacts[format]);
    assert.ok(stats.isFile() && stats.size > 0, `Expected a nonempty ${format} artifact`);
  }

  const links = markdownLinks(markdown).map(destination => path.resolve(reportDirectory, decodeURIComponent(destination)));
  for (const [format, filename] of Object.entries(artifacts)) {
    assert.ok(links.includes(filename), `Review should link to its ${format} artifact`);
  }
  const diagram = await fs.readFile(artifacts.markdown, 'utf8');
  assert.match(diagram, new RegExp(`\\b${snapshotLabel}\\b`));
  assert.match(diagram, /Order submission/);
  assert.match(diagram, /Order ledger/);
  assert.doesNotMatch(diagram, /Health check/, 'The focused view should exclude an unrelated component');
}

function checkDependencyEvidence(markdown, change) {
  const row = markdown.split('\n').find(line => line.includes(location) && line.includes(specifier));
  assert.ok(row, 'The review should identify the dependency by its source location and specifier');
  assert.match(row, new RegExp(`\\b${change}\\b`, 'i'));
}

test('review separates implementation edits from architecture changes', { timeout: 30000 }, async t => {
  const before = snapshot({ withLedger: true });
  const after = structuredClone(before);
  after.metadata.scannedDirectory = '/another-checkout/src';
  after.sources[0].contentHash = hash('Changed implementation of the same module');
  after.edges[0].evidence[0].line = 4;
  const directory = await saveSnapshots(t, before, after);
  const { result, markdown } = await readReport(directory);

  assert.match(markdown, /No dependency or declared boundary changes/);
  assert.match(markdown, /^\|\s*Source files?\s*\|\s*0\s*\|\s*0\s*\|\s*1\s*\|$/im);
  assert.ok(result.diagram == null, 'A source-only change should have no diagram in stdout');
  assert.ok((await fs.readdir(directory)).every(name => !/\.(?:svg|png|html)$/i.test(name)));
});

test('review detects a source file reassigned between existing declared components', { timeout: 30000 }, async t => {
  const before = snapshot();
  const shared = 'shared/format.ts';
  before.sources.push({ path: shared, contentHash: hash('export const format = String;\n'), parseStatus: 'complete' });
  before.metadata.filesScanned = before.sources.length;
  for (const node of before.nodes) node.path = '.';
  before.nodes.find(node => node.id === 'component:submit').evidence.push({
    path: shared, line: 1, column: 1, kind: 'source-file',
  });

  const after = structuredClone(before);
  const formerOwner = after.nodes.find(node => node.id === 'component:submit');
  const newOwner = after.nodes.find(node => node.id === 'component:health');
  newOwner.evidence.push(formerOwner.evidence.pop());
  const directory = await saveSnapshots(t, before, after);
  const { result, markdown } = await readReport(directory);

  assert.match(markdown, /^\|\s*Declared source assignments\s*\|\s*0\s*\|\s*0\s*\|\s*1\s*\|$/im);
  assert.match(markdown, /Declared source assignment changes/i);
  const assignment = markdown.split('\n').find(line => line.includes(shared));
  assert.ok(assignment, 'The assignment table should identify the moved file');
  assert.match(assignment, /Order submission[^|]*\|[^|]*Health check/);
  assert.doesNotMatch(markdown, /No dependency or declared boundary changes/);

  if (result.diagram) {
    const focused = await fs.readFile(path.resolve(directory, result.diagram.markdown), 'utf8');
    assert.match(focused, /\bHead\b/);
    assert.match(focused, /Health check/);
  }
});

test('review reports added dependencies, declared boundary changes and partial analysis', { timeout: 30000 }, async t => {
  const before = snapshot();
  const after = snapshot({ withLedger: true, service: 'Order processing service' });
  after.metadata.analysisStatus = 'partial';
  after.sources[0].parseStatus = 'partial';
  after.diagnostics.push({ code: 'PARSE_ERROR', severity: 'error', message: 'Partial source parse',
    path: 'orders/submit.ts', line: 5, column: 3 });
  const directory = await saveSnapshots(t, before, after);
  const { result, markdown } = await readReport(directory, 'dependency review.md');

  checkDependencyEvidence(markdown, 'Added');
  assert.match(markdown, /Order service/);
  assert.match(markdown, /Order processing service/);
  assert.match(markdown, /partial/i);
  assert.match(markdown.replaceAll('\\_', '_'), /PARSE_ERROR/);
  await checkFocusedArtifacts(result, markdown, 'Head');
});

test('review renders removed dependencies from the before snapshot', { timeout: 30000 }, async t => {
  const directory = await saveSnapshots(t, snapshot({ withLedger: true }), snapshot());
  const { result, markdown } = await readReport(directory);

  checkDependencyEvidence(markdown, 'Removed');
  await checkFocusedArtifacts(result, markdown, 'Base');
});

test('review links added and removed dependency evidence to their own commit and encodes the path', { timeout: 30000 }, async t => {
  const sourcePath = 'orders/submit [draft] #2 (review).ts';
  const before = snapshot({ withLedger: true, sourcePath });
  before.metadata.commit = 'a'.repeat(40);
  const after = structuredClone(before);
  after.metadata.commit = 'b'.repeat(40);
  after.edges[0].id = 'relationship:submit-health';
  after.edges[0].target = 'component:health';
  after.edges[0].evidence[0].line = 4;
  after.edges[0].evidence[0].specifier = '../health.js';
  after.sources[0].contentHash = hash('Updated dependency in order submission');
  const directory = await saveSnapshots(t, before, after);
  const { markdown } = await readReport(directory, 'review.md', ['--github-repo', 'example/c4-review', '--source-root', 'packages/Shop UI/src']);

  const encodedPath = 'packages/Shop%20UI/src/orders/submit%20%5Bdraft%5D%20%232%20%28review%29.ts';
  const cases = [
    ['Removed', before.metadata.commit, 2, specifier],
    ['Added', after.metadata.commit, 4, '../health.js'],
  ];
  for (const [change, revision, line, importSpecifier] of cases) {
    const expected = `https://github.com/example/c4-review/blob/${revision}/${encodedPath}#L${line}`;
    const row = markdown.split('\n').find(value => markdownLinks(value).includes(expected));
    assert.ok(row, `Expected a clickable ${change.toLowerCase()} dependency location`);
    assert.ok(row.includes(change));
    assert.ok(row.includes(`orders/submit \\[draft\\] #2 (review).ts:${line}:25`));
    assert.ok(row.includes(importSpecifier));
  }
});

test('review shows changed unresolved import locations despite equal warning counts and common diagnostics', { timeout: 30000 }, async t => {
  const before = snapshot();
  before.metadata.analysisStatus = 'partial';
  before.metadata.commit = 'c'.repeat(40);
  const unresolved = (code, specifier, line) => ({ code, specifier, line, column: 8, path: 'orders/submit.ts',
    severity: 'warning', message: 'Module reference could not be resolved' });
  const common = Array.from({ length: 30 }, (_, index) => unresolved('UNRESOLVED_PACKAGE', `common-package-${index}`, index + 1));
  before.diagnostics = [...common, unresolved('UNRESOLVED_IMPORT', './old-local.js', 31),
    unresolved('UNRESOLVED_PACKAGE', 'old-package', 32)];
  const after = structuredClone(before);
  after.metadata.commit = 'd'.repeat(40);
  after.diagnostics = [...common, unresolved('UNRESOLVED_IMPORT', './new-local.js', 33),
    unresolved('UNRESOLVED_PACKAGE', 'new-package', 34)];
  const directory = await saveSnapshots(t, before, after);
  const { result, markdown } = await readReport(directory, 'review.md', ['--github-repo', 'example/c4-review']);

  assert.match(markdown.replaceAll('\\_', '_'), /^\|\s*UNRESOLVED_IMPORT\s*\|\s*1\s*\|\s*1\s*\|$/m);
  const cases = [
    ['Base', before.metadata.commit, 31, './old-local.js'], ['Base', before.metadata.commit, 32, 'old-package'],
    ['Head', after.metadata.commit, 33, './new-local.js'], ['Head', after.metadata.commit, 34, 'new-package'],
  ];
  for (const [snapshot, revision, line, importSpecifier] of cases) {
    const row = markdown.split('\n').find(value => value.includes(importSpecifier));
    assert.ok(row, `Expected ${snapshot} to show ${importSpecifier}`);
    assert.ok(row.includes(snapshot));
    assert.ok(row.includes(`orders/submit.ts:${line}:8`));
    assert.ok(markdownLinks(row).includes(`https://github.com/example/c4-review/blob/${revision}/orders/submit.ts#L${line}`));
  }
  assert.ok((markdown.match(/common-package-/g) ?? []).length < common.length * 2);
  assert.ok(result.diagram == null);
});

test('review preserves changed legacy technology labels and ignores provenance alone', { timeout: 30000 }, async t => {
  const before = snapshot();
  for (const node of before.nodes) node.path = '.';
  const after = structuredClone(before);
  for (const node of after.nodes) node.technologyBasis = 'inferred';
  after.nodes[1].technology = 'TypeScript / TSX';
  const directory = await saveSnapshots(t, before, after);
  const { markdown } = await readReport(directory);

  assert.match(markdown, /^\|\s*Declared boundaries\s*\|\s*0\s*\|\s*0\s*\|\s*1\s*\|$/im);
  const row = markdown.split('\n').find(value => value.includes('component:health'));
  assert.match(row, /TypeScript[^|]*\|[^|]*TypeScript \/ TSX/);
  assert.match(markdown, /provenance unavailable/i);
});

test('review validates GitHub source link options before writing', { timeout: 30000 }, async t => {
  const before = snapshot();
  before.metadata.commit = 'e'.repeat(40);
  const after = structuredClone(before);
  after.metadata.commit = 'f'.repeat(40);
  const directory = await saveSnapshots(t, before, after);

  await assert.rejects(runReview(directory, 'review.md', 'before.json', ['--github-repo', 'example/../other']), /OWNER\/REPO/);
  await assert.rejects(runReview(directory, 'review.md', 'before.json',
    ['--github-repo', 'example/c4-review', '--source-root', 'src/../other']), /repository-relative path/);
  after.metadata.commit = '1234567';
  await fs.writeFile(path.join(directory, 'after.json'), JSON.stringify(after));
  await assert.rejects(runReview(directory, 'review.md', 'before.json', ['--github-repo', 'example/c4-review']), /40-hex commit/);
  await assert.rejects(fs.stat(path.join(directory, 'review.md')), { code: 'ENOENT' });
});

test('review rejects an output path that would overwrite a saved input', { timeout: 30000 }, async t => {
  // Keep the input valid JSON and give it an .md name to exercise the collision guard.
  const inputName = 'saved graph.md';
  const directory = await saveSnapshots(t, snapshot(), snapshot({ withLedger: true }), inputName);
  const inputPath = path.join(directory, inputName);
  const original = await fs.readFile(inputPath, 'utf8');

  await assert.rejects(runReview(directory, inputName, inputName));
  assert.equal(await fs.readFile(inputPath, 'utf8'), original);
});
