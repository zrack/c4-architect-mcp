import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const options = Object.fromEntries([
  'repo-dir', 'github-repo', 'head-github-repo', 'base', 'head', 'source-root', 'config',
  'base-node-modules', 'head-node-modules', 'out', 'title', 'cli',
].map(key => [key, { type: 'string' }]));

function relativePath(value) {
  const parts = value.replaceAll('\\', '/').split('/');
  if (!value.trim() || /^(?:[/\\]|[a-z]:)/i.test(value) || /[\x00-\x1f]/.test(value) || parts.includes('..')) {
    throw new Error(`Expected a repository-relative path: ${value}`);
  }
  return parts.filter(part => part && part !== '.').join('/') || '.';
}

async function main() {
  const { values } = parseArgs({ options });
  for (const name of ['github-repo', 'base', 'head', 'out']) {
    if (!values[name]) throw new Error(`Missing --${name}`);
  }
  for (const sha of [values.base, values.head]) {
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Use full 40-character commit SHAs for --base and --head.');
  }
  const repo = path.resolve(values['repo-dir'] || '.');
  const output = path.resolve(values.out);
  const sourceRoot = relativePath(values['source-root'] ?? 'src');
  const config = values.config && relativePath(values.config);
  const cli = values.cli ? path.resolve(values.cli) : fileURLToPath(new URL('../../../../dist/index.js', import.meta.url));
  await fs.access(cli);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-pr-review-'));
  const store = path.join(temporary, 'repository.git');
  const emptyGitConfig = path.join(temporary, 'gitconfig');
  // Detached checkouts use only Git's built-in filters and an empty hook directory.
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_ATTR_NOSYSTEM: '1' });
  const git = (...args) => exec('git', ['-c', `core.hooksPath=${temporary}/no-hooks`, '-c', 'core.autocrlf=false', ...args], { env: gitEnv });
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args], { cwd: temporary })).stdout);
  let evidenceDir;
  let completed = false;
  try {
    await fs.writeFile(emptyGitConfig, '', { flag: 'wx' });
    await git('clone', '--quiet', '--bare', '--shared', '--local', '--no-tags', '--template=', '--', repo, store);
    await fs.mkdir(path.dirname(output), { recursive: true });
    evidenceDir = await fs.mkdtemp(path.join(path.dirname(output), `${path.basename(output, path.extname(output))}.snapshots-`));
    const graphs = [];
    const configSnapshots = [];
    for (const side of ['base', 'head']) {
      const sha = values[side].toLowerCase();
      const snapshot = path.join(temporary, side);
      await git('-C', store, 'worktree', 'add', '--quiet', '--detach', snapshot, sha);
      if ((await git('-C', snapshot, 'rev-parse', 'HEAD')).stdout.trim() !== sha) throw new Error(`Unexpected ${side} commit`);
      const target = path.join(snapshot, sourceRoot);
      if (sourceRoot !== '.' && (await git('-C', store, 'cat-file', '-t', `${sha}:${sourceRoot}`)).stdout.trim() !== 'tree') {
        throw new Error(`Scan root must be a tracked directory in ${side}: ${sourceRoot}`);
      }
      const modules = values[`${side}-node-modules`];
      if (modules) {
        const installed = await fs.realpath(modules);
        if (!(await fs.stat(installed)).isDirectory()) throw new Error(`Expected a dependency directory for ${side}`);
        await fs.symlink(installed, path.join(snapshot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      }
      const graphPath = path.join(evidenceDir, `${side}.json`);
      const analyzeArgs = ['analyze', target, '--level', 'Component', '--commit', sha, '--out', graphPath, '--summary'];
      if (config) {
        const filename = path.join(snapshot, config);
        const entry = await fs.lstat(filename).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (entry) {
          if (!entry.isFile()) throw new Error(`Expected a regular boundary configuration file in ${side}: ${config}`);
          analyzeArgs.push('--config', filename);
          configSnapshots.push(side);
        }
      }
      await run(...analyzeArgs);
      graphs.push(graphPath);
    }
    if (config && !configSnapshots.length) throw new Error(`Boundary configuration missing from both snapshots: ${config}`);
    const reviewArgs = ['review', ...graphs, '--out', output, '--focus-changes', '--github-repo', values['github-repo'], '--source-root', sourceRoot];
    if (values['head-github-repo']) reviewArgs.push('--head-github-repo', values['head-github-repo']);
    if (values.title) reviewArgs.push('--title', values.title);
    const result = await run(...reviewArgs);
    completed = true;
    console.log(JSON.stringify({ ...result, baseGraph: graphs[0], headGraph: graphs[1], ...(config && { configSnapshots }) }));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
    if (evidenceDir && !completed) await fs.rm(evidenceDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
