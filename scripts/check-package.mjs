import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run test:package.');
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-package-'));
const run = async (command, args, cwd = temporary) => (await exec(command, args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 180000 })).stdout;
const runNpm = (args, cwd = temporary) => run(process.execPath, [npmCli, ...args], cwd);
try {
  await runNpm(['run', 'build'], root);
  const [packed] = JSON.parse(await runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root));
  const skills = ['explain-this-file', 'what-changed-in-this-pr', 'solution-architect-walkthrough'];
  const skillFiles = skills.flatMap(skill => ['SKILL.md', 'agents/openai.yaml'].map(file => `.agents/skills/${skill}/${file}`));
  const reviewHelper = '.agents/skills/what-changed-in-this-pr/scripts/review-commits.mjs';
  skillFiles.push(reviewHelper, '.agents/skills/solution-architect-walkthrough/references/walkthrough-format.md');
  for (const file of packed.files) {
    if (!skillFiles.includes(file.path)) assert.match(file.path, /^(?:dist\/|scripts\/prepare-bin\.mjs$|docs\/images\/|examples\/|(?:README|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|ROADMAP|THIRD_PARTY_NOTICES)\.md$|LICENSE$|NOTICE$|package\.json$)/, `Unapproved package file: ${file.path}`);
    assert.doesNotMatch(file.path, /(?:^|\/)(?:node_modules|output|\.local|\.env|\.git)(?:\/|$)/);
  }
  const paths = new Set(packed.files.map(file => file.path));
  for (const file of skillFiles) assert.ok(paths.has(file), `Missing skill file: ${file}`);
  for (const required of ['dist/index.js','dist/model/graph.js','dist/parsers/astParser.js','dist/renderers/diagramExports.js','LICENSE','NOTICE','README.md']) assert.ok(paths.has(required), `Missing ${required}`);
  await fs.writeFile(path.join(temporary, 'package.json'), JSON.stringify({ name: 'c4-package-smoke', version: '1.0.0', private: true }));
  await runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', ...(process.env.C4_PACKAGE_OFFLINE === '1' ? ['--offline'] : []), path.join(temporary, packed.filename)]);
  const installed = path.join(temporary, 'node_modules/c4-architect-mcp');
  const pkg = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT'); assert.ok(pkg.dependencies.typescript, 'TypeScript resolver must be a runtime dependency');
  const entry = path.join(installed, 'dist/index.js');
  assert.equal((await run(process.execPath, [entry, '--version'])).trim(), pkg.version);
  const bin = path.join(temporary, 'node_modules/.bin', process.platform === 'win32' ? 'c4-architect-mcp.cmd' : 'c4-architect-mcp');
  if (process.platform === 'win32') assert.match(await fs.readFile(bin,'utf8'), /dist[\\/]index\.js/, 'npm must create the Windows command shim');
  else assert.equal((await run(bin, ['--version'])).trim(), pkg.version);
  await fs.mkdir(path.join(temporary, 'src'));
  await fs.writeFile(path.join(temporary, 'src/index.ts'), 'import { value } from "./value.js"; export const result = value;\n');
  await fs.writeFile(path.join(temporary, 'src/value.ts'), 'export const value = 42;\n');
  const graphPath = path.join(temporary, 'graph.json');
  const summary = JSON.parse(await run(process.execPath, [entry, 'analyze', 'src', '--out', graphPath, '--summary']));
  assert.equal(summary.counts.sources, 2); assert.equal(summary.counts.edges, 1);
  assert.equal(summary.analysisStatus, 'complete');
  const rendering = JSON.parse(await run(process.execPath, [entry, 'render', graphPath, '--out', 'diagram.md']));
  assert.equal(rendering.layout.engine, 'elk'); assert.equal(rendering.layout.nodeCount, 2);
  const dataFlowModel = path.join(installed, 'examples/three-tier-kafka-oracle/data-flow.json');
  const dataFlow = JSON.parse(await run(process.execPath, [entry, 'render-diagram', dataFlowModel, '--out', 'data-flow.md']));
  assert.equal(dataFlow.layout.nodeCount, 6);
  assert.equal(dataFlow.layout.relationshipCount, 6);
  assert.ok((await fs.stat(dataFlow.artifacts.png)).size > 100);
  const exampleRoot = path.dirname(dataFlowModel);
  for (const [placement, count] of [['before', 1], ['after', 6]]) {
    const scenario = path.join(exampleRoot, 'walkthrough', `bridge-${placement}-kafka.json`);
    const output = path.join(temporary, `bridge-${placement}.md`);
    const review = JSON.parse(await run(process.execPath, [entry, 'review-walkthrough', path.join(exampleRoot, 'walkthrough.json'), scenario, '--out', output]));
    assert.equal(review.views.filter(view => view.status === 'review').length, count);
    assert.ok(review.openQuestions.length > 0 && review.answeredQuestions.some(question => question.id === 'bridge-placement'));
    const report = await fs.readFile(output, 'utf8');
    assert.ok(report.includes('Kafka'), `Missing model evidence for ${placement}`);
  }
  const replay = JSON.parse(await run(process.execPath, [entry, 'review-replay',
    path.join(exampleRoot, 'replay/scenario.json'), '--out', path.join(temporary, 'replay')]));
  assert.equal(replay.runs.length, 6);
  for (const [placement, owner] of [['before-kafka', 'application'], ['after-kafka', 'bridge']]) {
    const runs = replay.runs.filter(run => run.placement === placement);
    assert.equal(runs.length, 3);
    for (const run of runs) {
      const failed = run.scenario === 'failed-write';
      assert.equal(run.checkpointOwner, owner);
      assert.equal(run.rowCount, failed ? 0 : 1);
      assert.equal(run.nextOffset, failed ? 41 : 42);
    }
    const comparison = replay.artifacts.comparisons.find(item => item.placement === placement);
    assert.ok(comparison, `Missing replay comparison for ${placement}`);
    assert.ok((await fs.stat(comparison.png)).size > 100);
    assert.match(await fs.readFile(comparison.svg, 'utf8'), /<svg\b/);
  }
  const firstVisit = path.join(temporary, 'first visit');
  await fs.mkdir(firstVisit);
  const demoMessage = await runNpm(['exec', '--offline', '--', 'c4-architect-mcp', 'demo', 'replay'], firstVisit);
  const demoDirectory = path.join(firstVisit, 'c4-replay');
  assert.match(demoMessage, /report\.md/);
  assert.equal(await fs.readFile(path.join(demoDirectory, 'report.md'), 'utf8'), await fs.readFile(replay.artifacts.markdown, 'utf8'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(demoDirectory, 'traces.json'), 'utf8')),
    JSON.parse(await fs.readFile(replay.artifacts.traces, 'utf8')), 'The shortcut must run the same six outcomes as the explicit scenario');
  for (const { placement } of replay.artifacts.comparisons) {
    assert.ok(demoMessage.includes(placement + '.svg') || demoMessage.includes(placement + '.png'), `Missing diagram path for ${placement}`);
    const png = await fs.readFile(path.join(demoDirectory, placement + '.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(await fs.readFile(path.join(demoDirectory, placement + '.svg'), 'utf8'), /<svg\b/);
  }
  const explanation = JSON.parse(await run(process.execPath, [entry, 'explain-file', 'src', 'value.ts', '--out', 'value.md']));
  assert.equal(explanation.counts.incoming, 1);
  assert.equal(explanation.counts.outgoing, 0);
  assert.ok((await fs.stat(explanation.artifacts.png)).size > 100);
  const fixture = path.join(temporary, 'review fixture');
  await fs.mkdir(fixture);
  const git = (...args) => run('git', ['-c', 'user.name=Package test', '-c', 'user.email=test@example.org',
    '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${temporary}/no-hooks`, ...args], fixture);
  await git('init', '--quiet', '--template=');
  await fs.writeFile(path.join(fixture, 'module.ts'), 'export const value = 1;\n');
  await git('add', 'module.ts');
  await git('commit', '-qm', 'Base');
  const base = (await git('rev-parse', 'HEAD')).trim();
  await fs.writeFile(path.join(fixture, 'consumer.ts'), 'import "./module.js";\n');
  await git('add', 'consumer.ts');
  await git('commit', '-qm', 'Head');
  const head = (await git('rev-parse', 'HEAD')).trim();
  await fs.writeFile(path.join(fixture, 'consumer.ts'), 'export const uncommitted = true;\n');
  const review = JSON.parse(await run(process.execPath, [path.join(installed, reviewHelper),
    '--repo-dir', fixture, '--base', base, '--head', head, '--github-repo', 'example/project', '--source-root', '.',
    '--out', path.join(temporary, 'pr-review.md')]));
  const report = await fs.readFile(review.reportPath, 'utf8');
  assert.ok(report.includes('| Dependencies | 1 | 0 | 0 |'));
  assert.ok(report.includes(`/blob/${head}/consumer.ts#L1`));
  assert.equal(JSON.parse(await fs.readFile(review.baseGraph, 'utf8')).metadata.commit, base);
  assert.equal(JSON.parse(await fs.readFile(review.headGraph, 'utf8')).metadata.commit, head);
  assert.equal(await fs.readFile(path.join(fixture, 'consumer.ts'), 'utf8'), 'export const uncommitted = true;\n');
  assert.ok((await fs.stat(review.diagram.html)).size > 100);
  for (const extension of ['md','svg','png','html']) assert.ok((await fs.stat(path.join(temporary, `diagram.${extension}`))).size > 100);
  console.log(`Package smoke passed: ${packed.files.length} approved files, production-only install, executable bin, parser, resolver, rendering, PR review, both bridge placements and all six replay cases from the first-run shortcut.`);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
