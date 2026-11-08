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
import { runAdoWiki } from '../dist/publishers/adoWiki.js';

const run = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/trail-notes/diagrams/structurizr-workspace.json', import.meta.url));
const workspace = JSON.parse(await readFile(fixture, 'utf8'));
const target = {
  organization: 'trail-team',
  project: 'Visitor Center',
  wiki: 'Trail Notes.wiki',
  pagePath: '/Architecture/Trail-Notes',
};
const token = 'dummy-test-token';
const env = { AZURE_DEVOPS_EXT_PAT: token };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function tempDirectory(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'c4-ado-wiki-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function assertOrder(text, phrases) {
  let previous = -1;
  for (const phrase of phrases) {
    const next = text.indexOf(phrase, previous + 1);
    assert.ok(next > previous, 'Missing or out of order: ' + phrase);
    previous = next;
  }
}

function wikiServer({ content, etag = '"wiki-v1"', attachmentStatus = 201, writeStatus } = {}) {
  const calls = [];
  const attachmentPaths = [];
  let savedContent;
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, url, ifMatch: request.headers.get('if-match') });
    assert.equal(url.origin, 'https://dev.azure.com');
    assert.equal(url.searchParams.get('api-version'), '7.1');
    assert.notEqual(request.redirect, 'follow');
    assert.equal(request.headers.get('accept'), 'application/json');
    assert.equal(request.headers.get('authorization'), 'Basic ' + Buffer.from(':' + token).toString('base64'));
    assert.ok(url.pathname.startsWith('/trail-team/Visitor%20Center/_apis/wiki/wikis/Trail%20Notes.wiki/'), request.url);

    if (url.pathname.endsWith('/attachments')) {
      assert.equal(request.method, 'PUT');
      assert.equal(request.headers.get('content-type'), 'application/octet-stream');
      const name = url.searchParams.get('name');
      assert.match(name, /^[a-z0-9._-]+\.png$/i);
      assert.deepEqual(Buffer.from(await request.arrayBuffer()).subarray(0, 8), pngSignature);
      if (attachmentStatus !== 201) return new Response('Untrusted server error ' + token, { status: attachmentStatus });
      const location = '/.attachments/' + name;
      attachmentPaths.push(location);
      return Response.json({ name, path: location }, { status: 201 });
    }

    assert.ok(url.pathname.endsWith('/pages'), request.url);
    assert.equal(url.searchParams.get('path'), target.pagePath);
    if (request.method === 'GET') {
      assert.equal(url.searchParams.get('includeContent')?.toLowerCase(), 'true');
      return content === undefined
        ? Response.json({ typeKey: 'WikiPageNotFoundException' }, { status: 404 })
        : Response.json({ content }, { headers: { ETag: etag } });
    }
    assert.equal(request.method, 'PUT');
    assert.match(request.headers.get('content-type'), /^application\/json/);
    savedContent = (await request.json()).content;
    return Response.json({}, {
      status: writeStatus ?? (content === undefined ? 201 : 200),
      headers: { ETag: '"wiki-v2"' },
    });
  };
  return { fetch, calls, attachmentPaths, get savedContent() { return savedContent; } };
}

test('CLI and MCP build an offline Trail Notes Wiki preview with the same four diagrams', { timeout: 30000 }, async t => {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'c4-ado-wiki-')));
  const client = new Client({ name: 'ado-wiki-test', version: '1.0.0' });
  t.after(async () => {
    // Windows keeps the working directory locked until the MCP child exits.
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd }));

  const { stdout } = await run(process.execPath, [entrypoint, 'publish-ado-wiki', fixture, '--out', 'cli'], { cwd });
  const cli = JSON.parse(stdout);
  assert.equal(cli.mode, 'preview');
  const mcpResult = await client.callTool({
    name: 'publish_to_ado_wiki',
    arguments: { input: workspace, outputDir: path.join(cwd, 'mcp') },
  });
  assert.notEqual(mcpResult.isError, true, JSON.stringify(mcpResult.content));
  assert.equal(mcpResult.structuredContent.mode, 'preview');

  const titles = workspace.diagrams.map(diagram => diagram.title);
  const previews = [cli, mcpResult.structuredContent];
  for (const result of previews) {
    assert.equal(result.artifacts.attachments.length, titles.length);
    const markdown = await readFile(result.artifacts.markdown, 'utf8');
    const html = await readFile(result.artifacts.html, 'utf8');
    assertOrder(markdown.replaceAll('\\|', '|'), titles);
    assertOrder(html, titles);
    for (const filename of result.artifacts.attachments) {
      const file = path.basename(filename);
      assert.ok(markdown.includes('/.attachments/' + file));
      assert.ok(html.includes('.attachments/' + file));
      assert.deepEqual((await readFile(filename)).subarray(0, 8), pngSignature);
    }
  }

  const untrusted = { ...workspace, title: '<script>alert(1)</script>', diagrams: [workspace.diagrams[0]] };
  const result = await runAdoWiki(untrusted, { outputDir: path.join(cwd, 'offline'), target }, {
    env: {},
    fetch: () => assert.fail('Preview must not make any requests to Azure DevOps'),
  });
  assert.equal(result.mode, 'preview');
  const html = await readFile(result.artifacts.html, 'utf8');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('publishing uploads images before the page, skips unchanged content, and conditionally updates managed content', { timeout: 30000 }, async t => {
  const outputDir = await tempDirectory(t);
  const input = { ...workspace, diagrams: workspace.diagrams.slice(0, 2) };
  const options = { outputDir, target, publish: true };
  const initial = wikiServer();
  const created = await runAdoWiki(input, options, { env, fetch: initial.fetch });
  assert.equal(created.mode, 'published');
  const page = new URL(created.pageUrl);
  assert.equal(page.origin, 'https://dev.azure.com');
  assert.equal(page.pathname, '/trail-team/Visitor%20Center/_wiki/wikis/Trail%20Notes.wiki');
  assert.equal(page.searchParams.get('pagePath'), target.pagePath);
  assert.equal(created.etag, '"wiki-v2"');
  assert.deepEqual(initial.calls.map(call => call.method), ['GET', 'PUT', 'PUT', 'PUT']);
  assert.equal(initial.calls.at(-1).ifMatch || null, null);
  assert.match(initial.savedContent.split('\n')[0], /c4-architect:ado-wiki:v1/);
  assertOrder(initial.savedContent, initial.attachmentPaths);

  const existing = wikiServer({ content: initial.savedContent, etag: '"wiki-v2"' });
  const unchanged = await runAdoWiki(input, options, { env, fetch: existing.fetch });
  assert.equal(unchanged.mode, 'unchanged');
  assert.deepEqual(existing.calls.map(call => call.method), ['GET']);

  const changed = { ...input, title: 'Trail Notes architecture review' };
  const edited = wikiServer({ content: initial.savedContent, etag: '"wiki-v2"' });
  const updated = await runAdoWiki(changed, options, { env, fetch: edited.fetch });
  assert.equal(updated.mode, 'published');
  assert.equal(edited.calls.at(-1).ifMatch, '"wiki-v2"');
  assert.match(edited.savedContent, /Trail Notes architecture review/);

  const manual = wikiServer({ content: initial.savedContent + '\nManual wiki edit.\n' });
  await assert.rejects(runAdoWiki(changed, options, { env, fetch: manual.fetch }));
  assert.deepEqual(manual.calls.map(call => call.method), ['GET']);
});

test('attachment failure and a concurrent page edit stop publishing without exposing server response text', { timeout: 30000 }, async t => {
  const outputDir = await tempDirectory(t);
  const input = { ...workspace, diagrams: [workspace.diagrams[0]] };
  const options = { outputDir, target, publish: true };

  const failing = wikiServer({ attachmentStatus: 409 });
  await assert.rejects(runAdoWiki(input, options, { env, fetch: failing.fetch }), error => {
    assert.doesNotMatch(String(error), /Untrusted server error|dummy-test-token/);
    return true;
  });
  assert.deepEqual(failing.calls.map(call => call.method), ['GET', 'PUT']);
  assert.ok(failing.calls.at(-1).url.pathname.endsWith('/attachments'));

  const existing = wikiServer();
  await runAdoWiki(input, options, { env, fetch: existing.fetch });
  const race = wikiServer({ content: existing.savedContent, etag: '"wiki-v2"', writeStatus: 412 });
  await assert.rejects(runAdoWiki({ ...input, title: 'Trail Notes revision' }, options, { env, fetch: race.fetch }));
  assert.deepEqual(race.calls.map(call => call.method), ['GET', 'PUT', 'PUT']);
  assert.equal(race.calls.at(-1).ifMatch, '"wiki-v2"');
});
