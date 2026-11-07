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
  for (const file of packed.files) {
    assert.match(file.path, /^(?:dist\/|scripts\/prepare-bin\.mjs$|docs\/images\/|examples\/|(?:README|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|ROADMAP|THIRD_PARTY_NOTICES)\.md$|LICENSE$|NOTICE$|package\.json$)/, `Unapproved package file: ${file.path}`);
    assert.doesNotMatch(file.path, /(?:^|\/)(?:node_modules|output|\.local|\.env|\.git)(?:\/|$)/);
  }
  const paths = new Set(packed.files.map(file => file.path));
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
  for (const extension of ['md','svg','png','html']) assert.ok((await fs.stat(path.join(temporary, `diagram.${extension}`))).size > 100);
  console.log(`Package smoke passed: ${packed.files.length} approved files, production-only install, executable bin, parser, resolver, PNG/SVG/HTML rendering.`);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
