import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const run = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const workspace = fileURLToPath(new URL('../examples/trail-notes/diagrams/structurizr-workspace.json', import.meta.url));

test('CLI and MCP export the same Trail Notes workspace with shared logical and deployment elements', { timeout: 30000 }, async t => {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'c4-structurizr-')));
  const client = new Client({ name: 'structurizr-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd }));
  const { stdout } = await run(process.execPath, [entrypoint, 'render-structurizr', workspace, '--out', 'cli/workspace.dsl'], { cwd });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.viewKeys, ['Context', 'Container', 'Component', 'PhysicalDeployment']);
  const dsl = await readFile(result.artifacts.structurizr, 'utf8');

  const input = JSON.parse(await readFile(workspace, 'utf8'));
  const outputPath = path.join(cwd, 'mcp', 'workspace.dsl');
  const tool = await client.callTool({ name: 'render_structurizr_dsl', arguments: { input, outputPath } });
  assert.notEqual(tool.isError, true, JSON.stringify(tool.content));
  assert.deepEqual(tool.structuredContent.viewKeys, result.viewKeys);
  assert.equal(tool.structuredContent.artifacts.structurizr, outputPath);
  assert.equal(tool.content[0].text, dsl);
  assert.equal(await readFile(outputPath, 'utf8'), dsl);

  assert.match(dsl, /softwareSystem "Trail Notes"/);
  const web = dsl.match(/(\w+)\s*=\s*container "Trail Notes web app"/)?.[1];
  assert.ok(web, 'The web app is declared as a logical container');
  assert.ok(dsl.split('\n').some(line => line.trim().split(/\s+/).includes('containerInstance') && line.trim().split(/\s+/).includes(web)), 'The deployed web app is an instance of the logical container');
  assert.match(dsl, /component "Note service"/);
  assert.match(dsl, /deploymentNode "Visitor center equipment room"/);
  assert.match(dsl, /infrastructureNode "Edge firewall"/);
  assert.match(dsl, /Private SQL over TLS/);

  const invalidPath = path.join(cwd, 'invalid.dsl');
  const badMapping = { ...input, deploymentInstanceOf: { ...input.deploymentInstanceOf, browser: 'missing' } };
  const rejected = await client.callTool({ name: 'render_structurizr_dsl', arguments: { input: badMapping, outputPath: invalidPath } });
  assert.equal(rejected.isError, true);
  await assert.rejects(readFile(invalidPath), { code: 'ENOENT' });
});
