import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function fixture(t, files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'c4-explain-file-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [filename, content] of Object.entries(files)) {
    const target = path.join(directory, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return directory;
}

const run = (directory, file, ...flags) => exec(process.execPath, [
  cli, 'explain-file', 'src', file, '--out', 'reports/explanation.md', ...flags,
], { cwd: directory });

function section(markdown, title) {
  const [, body] = markdown.split(`\n## ${title}\n`);
  assert.ok(body, `Missing report section: ${title}`);
  return body.split('\n## ')[0];
}

function links(markdown, baseUrl) {
  return [...markdown.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)]
    .map(match => new URL(match[1] ?? match[2], baseUrl));
}

test('explaining a unique TSX basename follows aliases and gives line evidence for each direction and the unresolved import', async t => {
  const files = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { '@notes/*': ['note tools/*'] } } }),
    'src/App.tsx': "// note screen\nimport { NoteEditor } from '@notes/NoteEditor';\nexport default NoteEditor;",
    'src/note tools/NoteEditor.tsx': [
      '// editor',
      '',
      "import { preview } from '../format';",
      "import './missing-theme';",
      'export const NoteEditor = () => preview;',
    ].join('\n'),
    'src/format.ts': "export { preview } from './deep';",
    'src/deep.ts': 'export const preview = 1;',
  };
  const directory = await fixture(t, files);
  const sourceTree = path.join(directory, 'src');
  const before = (await readdir(sourceTree, { recursive: true })).sort();
  const { stdout } = await run(directory, 'NoteEditor.tsx');
  const result = JSON.parse(stdout);
  const report = path.join(directory, 'reports', 'explanation.md');
  const markdown = await readFile(report, 'utf8');
  const reportUrl = pathToFileURL(report);
  const incoming = section(markdown, 'Files that import this file');
  const outgoing = section(markdown, 'Dependencies of this file');
  const notes = section(markdown, 'Analysis notes');

  assert.equal(result.counts.incoming, 1);
  assert.equal(result.counts.outgoing, 1);
  assert.equal(result.counts.nodes, 3);
  assert.equal(result.counts.relationships, 2);
  assert.equal(result.counts.unresolved, 1);
  assert.match(incoming, /App\.tsx/);
  assert.match(outgoing, /format\.ts/);
  assert.match(notes, /\.\/missing-theme/);
  assert.doesNotMatch(markdown, /deep\.ts/);
  for (const [body, filename, line, specifier] of [
    [incoming, 'src/App.tsx', 2, '@notes/NoteEditor'],
    [outgoing, 'src/note tools/NoteEditor.tsx', 3, '../format'],
    [notes, 'src/note tools/NoteEditor.tsx', 4, './missing-theme'],
  ]) {
    const source = path.join(directory, filename);
    const link = links(body, reportUrl).find(url => url.protocol === 'file:' && fileURLToPath(url) === source && url.hash === `#L${line}`);
    assert.ok(link, `Expected clickable source at ${filename}:${line}`);
    const sourceLine = (await readFile(link, 'utf8')).split('\n')[line - 1];
    assert.ok(sourceLine.includes(specifier), `Expected import "${specifier}" on the linked line`);
  }
  const image = links(markdown, reportUrl).find(url => url.pathname.endsWith('.png'));
  assert.ok(image, 'Expected the report to embed its focused PNG');
  const png = await readFile(image);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual((await readdir(sourceTree, { recursive: true })).sort(), before);
  for (const [filename, content] of Object.entries(files)) {
    assert.equal(await readFile(path.join(directory, filename), 'utf8'), content);
  }
});

test('ambiguous basename reports both paths before rendering; an exact scan-relative path selects the intended file', async t => {
  const directory = await fixture(t, {
    'src/Card.tsx': 'export const Card = 1;',
    'src/board/Card.tsx': 'export const BoardCard = 2;',
    'src/board.tsx': "import { BoardCard } from './board/Card';\nexport default BoardCard;",
  });
  await assert.rejects(run(directory, 'Card.tsx'), error => {
    assert.match(error.stderr, /ambiguous|multiple/i);
    assert.match(error.stderr, /board\/Card\.tsx/);
    assert.match(error.stderr.replaceAll('board/Card.tsx', ''), /\bCard\.tsx\b/);
    return true;
  });
  await assert.rejects(readFile(path.join(directory, 'reports', 'explanation.md')), { code: 'ENOENT' });

  assert.equal(JSON.parse((await run(directory, './Card.tsx')).stdout).counts.incoming, 0);
  const sha = 'a04e74e3530c9d900e6f26d3eb11802dca3e297c';
  const nested = await run(directory, 'board/Card.tsx', '--github-repo', 'demo/project', '--commit', sha, '--source-root', 'src');
  assert.equal(JSON.parse(nested.stdout).counts.incoming, 1);
  const markdown = await readFile(path.join(directory, 'reports', 'explanation.md'), 'utf8');
  assert.ok(markdown.includes(`https://github.com/demo/project/blob/${sha}/src/board.tsx#L1`));
});

test('a bounded focus reports complete counts alongside the diagram limits', async t => {
  const directory = await fixture(t, {
    'src/hub.ts': "import './first';\nimport './second';",
    'src/first.ts': 'export const first = 1;',
    'src/second.ts': 'export const second = 2;',
  });
  const result = JSON.parse((await run(directory, 'hub.ts', '--nodes', '2')).stdout);
  assert.equal(result.counts.outgoing, 2);
  assert.equal(result.counts.nodes, 2);
  assert.equal(result.counts.relationships, 1);
  assert.equal(result.truncated.nodes, true);
});
