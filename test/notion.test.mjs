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
import { runNotion } from '../dist/publishers/notion.js';

const run = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/trail-notes/diagrams/structurizr-workspace.json', import.meta.url));
const workspace = JSON.parse(await readFile(fixture, 'utf8'));
const twoViews = { ...workspace, diagrams: workspace.diagrams.slice(0, 2) };
const parentPageId = '14984d29-ccaf-4537-a5d4-869a340c7328';
const target = { parentPageId };
const env = { NOTION_API_TOKEN: 'dummy-notion-token' };
const pageId = 'c0fe041f-ff35-43bb-a5d4-d3e523de009c';
const pageUrl = 'https://www.notion.so/' + pageId.replaceAll('-', '');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const makeDirectory = async () => realpath(await mkdtemp(path.join(tmpdir(), 'c4-notion-')));
const removeDirectory = directory => rm(directory, { recursive: true, force: true });
const textOf = richText => richText.map(fragment => fragment.text.content).join('');

function notionServer({ failUploadAt, pageStatus, rateLimitFirstUpload = false } = {}) {
  const calls = [];
  const uploads = new Map();
  let page;
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.notion.com');
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.get('authorization'), 'Bearer ' + env.NOTION_API_TOKEN);
    assert.equal(request.headers.get('notion-version'), '2026-03-11');

    if (url.pathname === '/v1/file_uploads') {
      calls.push('create-upload');
      const { mode, filename, content_type: contentType } = await request.json();
      assert.equal(mode, 'single_part');
      assert.equal(contentType, 'image/png');
      assert.match(filename, /^c4-.*\.png$/);
      assert.ok([...uploads.values()].every(upload => upload.data), 'Finish each upload before starting the next');
      if (rateLimitFirstUpload && calls.length === 1) {
        return new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
      }
      const id = '00000000-0000-4000-8000-' + String(uploads.size + 1).padStart(12, '0');
      uploads.set(id, { filename });
      return Response.json({ object: 'file_upload', id, status: 'pending' });
    }
    const uploadMatch = /^\/v1\/file_uploads\/([^/]+)\/send$/.exec(url.pathname);
    if (uploadMatch) {
      calls.push('send-upload');
      const id = uploadMatch[1];
      const upload = uploads.get(id);
      assert.ok(upload, 'Send each file to a previously created upload');
      assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=/);
      const file = (await request.formData()).get('file');
      assert.equal(file.name, upload.filename);
      assert.equal(file.type, 'image/png');
      assert.equal(upload.data, undefined);
      if (uploads.size === failUploadAt) {
        return new Response('Untrusted API details ' + env.NOTION_API_TOKEN, { status: 403 });
      }
      upload.data = Buffer.from(await file.arrayBuffer());
      assert.deepEqual(upload.data.subarray(0, 8), pngSignature);
      return Response.json({ object: 'file_upload', id, status: 'uploaded' });
    }
    if (url.pathname === '/v1/pages') {
      calls.push('create-page');
      assert.equal(uploads.size, twoViews.diagrams.length);
      assert.ok([...uploads.values()].every(upload => upload.data), 'Create the page after every upload is ready');
      page = await request.json();
      if (pageStatus === 503) {
        return Response.json({
          message: 'Untrusted API details ' + env.NOTION_API_TOKEN,
          additional_data: { committed_resource_id: pageId },
        }, { status: 503 });
      }
      if (pageStatus) return new Response('Untrusted API details ' + env.NOTION_API_TOKEN, { status: pageStatus });
      // A connection with Insert content only may receive an ID without the URL.
      return Response.json({ object: 'page', id: pageId });
    }
    assert.fail('Unexpected request ' + url.pathname);
  };
  return { fetch, calls, uploads, get page() { return page; } };
}

test('Notion CLI and MCP preview the same four Trail Notes views', { timeout: 30000 }, async t => {
  const cwd = await makeDirectory();
  const client = new Client({ name: 'notion-test', version: '1.0.0' });
  t.after(async () => {
    // Windows locks the working directory while the MCP process uses it.
    await client.close();
    await removeDirectory(cwd);
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd }));

  const { stdout } = await run(process.execPath, [entrypoint, 'publish-notion', fixture, '--out', 'cli'], { cwd });
  const cli = JSON.parse(stdout);
  const mcp = await client.callTool({
    name: 'publish_to_notion',
    arguments: { input: workspace, outputDir: path.join(cwd, 'mcp') },
  });
  assert.notEqual(mcp.isError, true, JSON.stringify(mcp.content));

  const titles = workspace.diagrams.map(diagram => diagram.title);
  const manifests = [];
  for (const result of [cli, mcp.structuredContent]) {
    assert.equal(result.mode, 'preview');
    const { attachments, html, manifest } = result.artifacts;
    assert.equal(attachments.length, titles.length);
    const document = await readFile(html, 'utf8');
    const page = JSON.parse(await readFile(manifest, 'utf8'));
    manifests.push(page);
    assert.equal(page.title, workspace.title);
    assert.equal(page.description, workspace.description);
    assert.deepEqual(page.diagrams.map(diagram => diagram.title), titles);
    assert.deepEqual(page.diagrams.map(diagram => diagram.caption), workspace.diagrams.map(diagram => diagram.caption));
    const headings = [...document.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map(match => match[1]);
    assert.deepEqual(headings, titles);
    assert.match(document, /Local preview/i);
    for (const [index, attachment] of attachments.entries()) {
      const relative = '.attachments/' + path.basename(attachment);
      assert.equal(page.diagrams[index].path, relative);
      assert.ok(document.includes('href="' + relative + '"') || document.includes('href="./' + relative + '"'));
      assert.deepEqual((await readFile(attachment)).subarray(0, 8), pngSignature);
    }
  }
  assert.deepEqual(manifests[0], manifests[1]);
});

test('Notion publishes one child page with native PNG image blocks in input order', { timeout: 30000 }, async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const server = notionServer({ rateLimitFirstUpload: true });
  const input = { ...twoViews, description: 'a'.repeat(1999) + '🥾' + twoViews.description };
  const compactTarget = { parentPageId: parentPageId.replaceAll('-', '') };
  const result = await runNotion(input, {
    outputDir, target: compactTarget, publish: true,
  }, { env, fetch: server.fetch });
  assert.equal(result.mode, 'published');
  assert.equal(result.pageId, pageId);
  assert.equal(result.pageUrl, pageUrl);
  assert.equal(result.uploadedAttachments, 2);
  assert.deepEqual(server.calls, [
    'create-upload', 'create-upload', 'send-upload', 'create-upload', 'send-upload', 'create-page',
  ]);

  const { parent, properties, children } = server.page;
  assert.deepEqual(parent, { type: 'page_id', page_id: parentPageId });
  assert.equal(properties.title.type, 'title');
  assert.equal(textOf(properties.title.title), twoViews.title);
  assert.deepEqual(children.map(block => block.type), ['paragraph', 'heading_2', 'image', 'heading_2', 'image']);
  const description = children[0].paragraph.rich_text;
  assert.equal(textOf(description), input.description);
  assert.ok(description.length > 1);
  for (const item of description) {
    assert.ok(item.text.content.length <= 2000);
    assert.equal(item.text.content, item.text.content.toWellFormed());
  }
  for (const [index, [id, upload]] of [...server.uploads].entries()) {
    const diagram = twoViews.diagrams[index];
    const heading = children[index * 2 + 1];
    const { image } = children[index * 2 + 2];
    assert.equal(textOf(heading.heading_2.rich_text), diagram.title);
    assert.equal(image.type, 'file_upload');
    assert.deepEqual(image.file_upload, { id });
    assert.equal(textOf(image.caption), diagram.caption);
    assert.equal(upload.filename, path.basename(result.artifacts.attachments[index]));
    assert.deepEqual(upload.data, await readFile(result.artifacts.attachments[index]));
  }
});

test('Notion requires an explicit parent page and token before making a publish request', { timeout: 30000 }, async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const input = { ...workspace, diagrams: workspace.diagrams.slice(0, 1) };
  const fetch = () => assert.fail('Incomplete publish options must not contact Notion');
  await assert.rejects(runNotion(input, { outputDir, publish: true }, { env, fetch }), /parent|target/i);
  await assert.rejects(runNotion(input, {
    outputDir, publish: true, target: { parentPageId: '../v1/pages' },
  }, { env, fetch }), /parent|uuid/i);
  await assert.rejects(runNotion(input, { outputDir, publish: true, target }, { env: {}, fetch }), /NOTION_API_TOKEN/);
});

test('Notion leaves the parent untouched if any upload fails', { timeout: 30000 }, async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const server = notionServer({ failUploadAt: 2 });
  await assert.rejects(runNotion(twoViews, { outputDir, target, publish: true }, { env, fetch: server.fetch }), error => {
    assert.match(error.message, /403/);
    assert.doesNotMatch(error.message, /Untrusted API details|dummy-notion-token/);
    return true;
  });
  assert.deepEqual(server.calls, ['create-upload', 'send-upload', 'create-upload', 'send-upload']);
});

test('Notion does not retry an ambiguous page creation response', { timeout: 30000 }, async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  for (const pageStatus of [502, 503]) {
    const server = notionServer({ pageStatus });
    await assert.rejects(runNotion(twoViews, { outputDir, target, publish: true }, { env, fetch: server.fetch }), error => {
      if (pageStatus === 503) assert.ok(error.message.includes(pageUrl));
      else assert.match(error.message, /check.*parent/i);
      assert.doesNotMatch(error.message, /Untrusted API details|dummy-notion-token/);
      return true;
    });
    assert.deepEqual(server.calls, ['create-upload', 'send-upload', 'create-upload', 'send-upload', 'create-page']);
  }
});

test('Notion offline preview treats markup as text and needs no credentials or network', async t => {
  const outputDir = await makeDirectory();
  t.after(() => removeDirectory(outputDir));
  const input = { ...workspace, description: '<script>alert(1)</script>', diagrams: workspace.diagrams.slice(0, 1) };
  const dependencies = {
    get env() { assert.fail('Preview must not read credentials'); },
    fetch: () => assert.fail('Preview must not contact Notion'),
  };
  const { mode, artifacts } = await runNotion(input, { outputDir, target }, dependencies);
  assert.equal(mode, 'preview');
  const html = await readFile(artifacts.html, 'utf8');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(JSON.parse(await readFile(artifacts.manifest, 'utf8')).description, input.description);
});
