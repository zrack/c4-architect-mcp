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
import { runConfluence } from '../dist/publishers/confluence.js';
import { createConfluenceClient } from '../dist/publishers/confluenceTransport.js';

const run = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/trail-notes/diagrams/structurizr-workspace.json', import.meta.url));
const workspace = JSON.parse(await readFile(fixture, 'utf8'));
const twoViews = { ...workspace, diagrams: workspace.diagrams.slice(0, 2) };
const target = { site: 'https://trail-team.atlassian.net', spaceId: '412' };
const cloudId = '2534a3ef-83b6-4a75-8ef5-95878d9f36ba';
const pageId = '123456';
const pagePath = '/wiki/api/v2/pages/' + pageId;
const attachmentPath = '/wiki/rest/api/content/' + pageId + '/child/attachment';
const env = { CONFLUENCE_EMAIL: 'docs@example.test', CONFLUENCE_API_TOKEN: 'dummy-confluence-token' };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const makeDirectory = async () => realpath(await mkdtemp(path.join(tmpdir(), 'c4-confluence-')));
const removeDirectory = directory => rm(directory, { recursive: true, force: true });

function assertOrder(text, phrases) {
  let previous = -1;
  for (const phrase of phrases) {
    const next = text.indexOf(phrase, previous + 1);
    assert.ok(next > previous, 'Missing or out of order: ' + phrase);
    previous = next;
  }
}

function confluenceServer(scoped = false) {
  const state = { page: undefined, failUploadAt: undefined, failUpdate: false };
  const calls = [];
  const files = new Map();
  let uploadAttempts = 0;
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const { method } = request;
    if (scoped && url.pathname === '/_edge/tenant_info') {
      assert.equal(url.origin, target.site);
      assert.equal(method, 'GET');
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers.has('authorization'), false);
      return Response.json({ cloudId });
    }
    assert.equal(url.origin, scoped ? 'https://api.atlassian.com' : target.site);
    const gateway = scoped ? '/ex/confluence/' + cloudId : '';
    assert.ok(url.pathname.startsWith(gateway + '/wiki/'));
    const endpoint = url.pathname.slice(gateway.length);
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.get('accept'), 'application/json');
    const credentials = Buffer.from(env.CONFLUENCE_EMAIL + ':' + env.CONFLUENCE_API_TOKEN).toString('base64');
    assert.equal(request.headers.get('authorization'), 'Basic ' + credentials);

    if (endpoint === '/wiki/api/v2/pages' && method === 'GET') {
      calls.push('find-page');
      assert.equal(url.searchParams.get('space-id'), target.spaceId);
      assert.equal(url.searchParams.get('title'), workspace.title);
      assert.equal(url.searchParams.get('status'), 'current');
      return Response.json({ results: state.page ? [{ id: pageId, title: state.page.title }] : [] });
    }
    if (endpoint === '/wiki/api/v2/pages' && method === 'POST') {
      calls.push('create-page');
      assert.equal(state.page, undefined);
      const { title, spaceId, status, parentId, body } = await request.json();
      assert.equal(title, workspace.title);
      assert.equal(spaceId, target.spaceId);
      assert.equal(parentId, '99');
      assert.equal(status, 'current');
      assert.equal(body.representation, 'storage');
      assert.doesNotMatch(body.value, /<ri:attachment/);
      state.page = { id: pageId, status, title, spaceId, parentId, version: { number: 1 }, body: { storage: { value: body.value } } };
      // The Cloud write response may omit the storage value.
      return Response.json({ ...state.page, body: { storage: {} } });
    }
    if (endpoint === pagePath && method === 'GET') {
      calls.push('read-page');
      assert.equal(url.searchParams.get('body-format'), 'storage');
      return state.page ? Response.json(state.page) : new Response(null, { status: 404 });
    }
    if (endpoint === pagePath + '/attachments' && method === 'GET') {
      calls.push('find-attachment');
      const title = url.searchParams.get('filename');
      assert.match(title, /^c4-.*\.png$/);
      assert.equal(url.searchParams.get('status'), 'current');
      const file = files.get(title);
      return Response.json({ results: file ? [{ title, fileSize: file.size, mediaType: 'image/png', version: { number: 1 } }] : [] });
    }
    if (endpoint === attachmentPath && method === 'POST') {
      calls.push('add-attachment');
      assert.ok(state.page);
      assert.equal(request.headers.get('x-atlassian-token'), 'nocheck');
      assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=/);
      const form = await request.formData();
      const file = form.get('file');
      assert.equal(form.get('minorEdit'), 'true');
      assert.match(file.name, /^c4-.*\.png$/);
      assert.equal(file.type, 'image/png');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()).subarray(0, 8), pngSignature);
      assert.equal(files.has(file.name), false, 'Attachment creation must not overwrite an existing file');
      if (++uploadAttempts === state.failUploadAt) {
        return new Response('Untrusted upload error ' + env.CONFLUENCE_API_TOKEN, { status: 403 });
      }
      files.set(file.name, file);
      return Response.json({ results: [{ title: file.name }] });
    }
    if (endpoint === pagePath && method === 'PUT') {
      calls.push('write-page');
      const { id, title, status, body, version } = await request.json();
      assert.equal(id, pageId);
      assert.equal(status, 'current');
      assert.equal(body.representation, 'storage');
      assert.equal(version.number, state.page.version.number + 1);
      assert.match(version.message, new RegExp('^c4-architect:confluence:v1 [a-f0-9]{64} version ' + version.number + '$'));
      const names = [...body.value.matchAll(/<ri:attachment\s+ri:filename="([^"]+)"/g)].map(match => match[1]);
      assert.equal(names.length, twoViews.diagrams.length);
      assert.ok(names.every(name => files.has(name)), 'Every diagram must already have its PNG attachment');
      if (state.failUpdate) return new Response('Untrusted version error ' + env.CONFLUENCE_API_TOKEN, { status: 409 });
      state.page = { ...state.page, title, version, body: { storage: { value: body.value } } };
      return Response.json({ ...state.page, body: { storage: {} } });
    }
    assert.fail('Unexpected request ' + method + ' ' + url.pathname);
  };
  return { fetch, state, calls, files };
}

test('Confluence CLI and MCP preview the same four Trail Notes views as native attachments', { timeout: 30000 }, async t => {
  const cwd = await makeDirectory();
  const client = new Client({ name: 'confluence-test', version: '1.0.0' });
  t.after(async () => {
    // Windows locks the working directory while the MCP process uses it.
    await client.close();
    await removeDirectory(cwd);
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd }));

  const { stdout } = await run(process.execPath, [entrypoint, 'publish-confluence', fixture, '--out', 'cli'], { cwd });
  const cli = JSON.parse(stdout);
  const mcp = await client.callTool({
    name: 'publish_to_confluence',
    arguments: { input: workspace, outputDir: path.join(cwd, 'mcp') },
  });
  assert.notEqual(mcp.isError, true, JSON.stringify(mcp.content));

  const titles = workspace.diagrams.map(diagram => diagram.title);
  for (const result of [cli, mcp.structuredContent]) {
    assert.equal(result.mode, 'preview');
    assert.equal(result.artifacts.attachments.length, titles.length);
    const storage = await readFile(result.artifacts.storage, 'utf8');
    const html = await readFile(result.artifacts.html, 'utf8');
    assertOrder(storage, titles);
    assertOrder(html, titles);
    assert.match(html, /Local preview/i);
    assert.equal([...storage.matchAll(/<ac:image\b/g)].length, titles.length);
    for (const filePath of result.artifacts.attachments) {
      const filename = path.basename(filePath);
      assert.ok(storage.includes('ri:filename="' + filename + '"'));
      assert.ok(html.includes('/' + filename + '"'));
      assert.deepEqual((await readFile(filePath)).subarray(0, 8), pngSignature);
    }
  }
});

test('Confluence publishes a new page, skips duplicate writes, and refuses a manually edited page', { timeout: 30000 }, async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const server = confluenceServer();
  const options = { outputDir, publish: true, target: { ...target, parentId: '99' } };
  const dependencies = { env, fetch: server.fetch };
  const created = await runConfluence(twoViews, options, dependencies);
  assert.equal(created.mode, 'published');
  assert.equal(created.pageId, pageId);
  assert.equal(new URL(created.pageUrl).origin, target.site);
  assert.equal(created.version, 2);
  assert.equal(created.uploadedAttachments, 2);
  assert.deepEqual(server.calls, ['find-page', 'create-page', 'find-attachment', 'add-attachment', 'find-attachment', 'add-attachment', 'write-page']);

  server.calls.length = 0;
  await assert.rejects(runConfluence(twoViews, options, dependencies), new RegExp(pageId));
  assert.deepEqual(server.calls, ['find-page']);

  const updateOptions = { ...options, target: { ...target, pageId } };
  server.calls.length = 0;
  const replay = await runConfluence(twoViews, updateOptions, dependencies);
  assert.equal(replay.mode, 'unchanged');
  assert.equal(replay.version, 2);
  assert.equal(replay.uploadedAttachments, 0);
  assert.equal(server.calls[0], 'read-page');
  assert.ok(server.calls.slice(1).every(call => call === 'find-attachment'));

  const revision = {
    ...twoViews,
    diagrams: [{ ...twoViews.diagrams[0], caption: 'Updated trail guide' }, twoViews.diagrams[1]],
  };
  const initialNames = created.artifacts.attachments.map(filename => path.basename(filename));
  const updated = await runConfluence(revision, updateOptions, dependencies);
  assert.equal(updated.mode, 'published');
  assert.equal(updated.version, 3);
  assert.equal(updated.uploadedAttachments, 1);
  const updatedNames = updated.artifacts.attachments.map(filename => path.basename(filename));
  assert.notEqual(updatedNames[0], initialNames[0]);
  assert.equal(updatedNames[1], initialNames[1]);
  assertOrder(server.state.page.body.storage.value, updatedNames);
  assert.match(server.state.page.body.storage.value, /Updated trail guide/);

  // An editor may carry forward the previous version's message.
  server.state.page.version.number++;
  server.calls.length = 0;
  await assert.rejects(runConfluence(twoViews, updateOptions, dependencies));
  assert.deepEqual(server.calls, ['read-page']);
});

test('Confluence can resume an incomplete publish and reports version conflicts without leaking the response', { timeout: 30000 }, async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const server = confluenceServer(true);
  const options = { outputDir, publish: true, target: { ...target, parentId: '99', cloudId } };
  const dependencies = { env, fetch: server.fetch };
  server.state.failUploadAt = 2;
  await assert.rejects(runConfluence(twoViews, options, dependencies), error => {
    assert.match(error.message, new RegExp(pageId));
    assert.doesNotMatch(error.message, /Untrusted upload error|dummy-confluence-token/);
    return true;
  });
  assert.equal(server.files.size, 1);
  assert.equal(server.state.page.version.number, 1);
  assert.ok(!server.calls.includes('write-page'));

  const updateOptions = { ...options, target: { ...target, pageId, cloudId } };
  const retried = await runConfluence(twoViews, updateOptions, dependencies);
  assert.equal(retried.mode, 'published');
  assert.equal(retried.uploadedAttachments, 1);
  assert.equal(server.files.size, 2);
  assert.equal(server.state.page.version.number, 2);

  server.state.failUpdate = true;
  const revision = { ...twoViews, description: 'Updated after concurrent edit' };
  await assert.rejects(runConfluence(revision, updateOptions, dependencies), error => {
    assert.match(error.message, /409|version|concurrent/i);
    assert.doesNotMatch(error.message, /Untrusted version error|dummy-confluence-token/);
    return true;
  });
  assert.equal(server.state.page.version.number, 2);
  assert.doesNotMatch(server.state.page.body.storage.value, /Updated after concurrent edit/);
});

test('A scoped Confluence publish rejects a cloud ID from another site before sending credentials', async () => {
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, target.site + '/_edge/tenant_info');
    assert.equal(request.headers.has('authorization'), false);
    return Response.json({ cloudId: '31e32e44-2470-45b9-a149-de77c62c2c4b' });
  };
  await assert.rejects(createConfluenceClient({ ...target, cloudId }, { env, fetch }), /Cloud ID does not match/);
});

test('Confluence offline preview escapes supplied content and never reads or sends credentials', async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const dependencies = {
    get env() { assert.fail('Preview must not read credentials'); },
    fetch: () => assert.fail('Preview must not make a network request'),
  };
  const input = { ...workspace, description: '<script>alert(1)</script>', diagrams: workspace.diagrams.slice(0, 1) };
  const result = await runConfluence(input, { outputDir, target }, dependencies);
  assert.equal(result.mode, 'preview');
  for (const artifact of [result.artifacts.storage, result.artifacts.html]) {
    const document = await readFile(artifact, 'utf8');
    assert.doesNotMatch(document, /<script>alert/);
    assert.match(document, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  }
});
