import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { renderCompactC4 } from '../dist/renderers/compactC4.js';
import { componentScaleFixtures } from './fixtures/component-scale.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const largeFixture = componentScaleFixtures.find(item => item.name === 'component-20').diagram;
let largeRender;
const renderLarge = () => largeRender ??= renderCompactC4(structuredClone(largeFixture));

function overlapping(a, b, inset = 0.5) {
  return a.x + inset < b.x + b.width - inset && a.x + a.width - inset > b.x + inset
    && a.y + inset < b.y + b.height - inset && a.y + a.height - inset > b.y + inset;
}

function segmentEntersBox(a, b, box, inset = 1) {
  const left = box.x + inset, right = box.x + box.width - inset;
  const top = box.y + inset, bottom = box.y + box.height - inset;
  if (Math.abs(a.y - b.y) < 0.001) {
    return a.y > top && a.y < bottom && Math.max(Math.min(a.x, b.x), left) < Math.min(Math.max(a.x, b.x), right) - 0.001;
  }
  if (Math.abs(a.x - b.x) < 0.001) {
    return a.x > left && a.x < right && Math.max(Math.min(a.y, b.y), top) < Math.min(Math.max(a.y, b.y), bottom) - 0.001;
  }
  throw new Error('Expected an orthogonal segment');
}

function boundaryContains(node, point, tolerance = 1) {
  const inside = point.x >= node.x - tolerance && point.x <= node.x + node.width + tolerance
    && point.y >= node.y - tolerance && point.y <= node.y + node.height + tolerance;
  return inside && [point.x - node.x, point.x - node.x - node.width, point.y - node.y, point.y - node.y - node.height]
    .some(distance => Math.abs(distance) <= tolerance);
}

test('compact layout preserves all 20 nodes and 35 directed relationships, including parallel edges and a loop', { timeout: 30000 }, async () => {
  const { layout } = await renderLarge();
  assert.equal(layout.nodes.length, largeFixture.nodes.length);
  assert.equal(layout.relationships.length, largeFixture.relationships.length);
  assert.deepEqual(new Set(layout.nodes.map(node => node.id)), new Set(largeFixture.nodes.map(node => node.id)));
  assert.equal(new Set(layout.nodes.map(node => node.alias)).size, largeFixture.nodes.length, 'Every component needs a distinct render alias');
  assert.equal(new Set(layout.relationships.map(edge => edge.id)).size, largeFixture.relationships.length, 'Parallel relationships need distinct IDs');
  for (const original of largeFixture.nodes) {
    const actual = layout.nodes.find(node => node.id === original.id);
    for (const field of ['label', 'type', 'technology', 'description']) assert.equal(actual[field], original[field], `Lost node ${original.id} ${field}`);
  }
  for (const original of largeFixture.relationships) {
    assert.ok(layout.relationships.some(edge => ['from', 'to', 'label', 'technology'].every(field => edge[field] === original[field])), `Lost ${original.from} -> ${original.to}: ${original.label}`);
  }
  assert.equal(layout.relationships.filter(edge => edge.from === 'payments' && edge.to === 'provider').length, 2);
  assert.equal(layout.relationships.filter(edge => edge.from === 'worker' && edge.to === 'worker').length, 1);
});

test('compact routes are orthogonal, terminate at the correct nodes, and avoid unrelated boxes and labels', { timeout: 30000 }, async () => {
  const { layout } = await renderLarge();
  for (let i = 0; i < layout.nodes.length; i++) for (let j = i + 1; j < layout.nodes.length; j++) {
    assert.ok(!overlapping(layout.nodes[i], layout.nodes[j]), `Components ${layout.nodes[i].id} and ${layout.nodes[j].id} overlap`);
  }
  for (const edge of layout.relationships) {
    assert.ok(edge.points.length >= 2, `${edge.id} has no complete route`);
    assert.ok(edge.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), `${edge.id} contains non-finite coordinates`);
    const source = layout.nodes.find(node => node.id === edge.from);
    const target = layout.nodes.find(node => node.id === edge.to);
    assert.ok(boundaryContains(source, edge.points[0]), `${edge.id} does not start at ${source.id}`);
    assert.ok(boundaryContains(target, edge.points.at(-1)), `${edge.id} does not end at ${target.id}`);
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      assert.ok(Math.abs(a.x - b.x) < 0.001 || Math.abs(a.y - b.y) < 0.001, `${edge.id} has a diagonal segment`);
      for (const node of layout.nodes) {
        if (node.id === edge.from || node.id === edge.to) continue;
        assert.ok(!segmentEntersBox(a, b, node), `${edge.id} crosses component ${node.id}`);
      }
      for (const other of layout.relationships) {
        if (other.id === edge.id) continue;
        assert.ok(!segmentEntersBox(a, b, other.labelBox), `${edge.id} crosses label ${other.id}`);
      }
    }
    for (const node of layout.nodes) assert.ok(!overlapping(edge.labelBox, node), `Label ${edge.id} overlaps ${node.id}`);
  }
  for (let i = 0; i < layout.relationships.length; i++) for (let j = i + 1; j < layout.relationships.length; j++) {
    assert.ok(!overlapping(layout.relationships[i].labelBox, layout.relationships[j].labelBox), `Labels ${layout.relationships[i].id} and ${layout.relationships[j].id} overlap`);
  }
});

test('the compact diagram materially reduces canvas area and creates a real PNG preview', { timeout: 30000 }, async () => {
  const result = await renderLarge();
  assert.ok(result.layout.width > 0 && result.layout.height > 0);
  assert.ok(result.layout.width * result.layout.height < 4300 * 2394 * 0.6, 'Compactness must improve materially over the previous 4300 x 2394 diagram');
  assert.ok(['DOWN', 'RIGHT'].includes(result.layout.direction));
  assert.ok(Buffer.isBuffer(result.png));
  assert.deepEqual(result.png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'Preview must contain PNG bytes');
  assert.match(result.svg, /<svg\b/);
  assert.match(result.html, /<svg\b|\.svg/);
  assert.ok(result.png.readUInt32BE(16) > 0 && result.png.readUInt32BE(20) > 0);
});

test('SVG and interactive preview keep supplied markup as literal label text', { timeout: 30000 }, async () => {
  const attack = '<script>globalThis.C4_PWNED=1</script><img src=x onerror="alert(1)">';
  const result = await renderCompactC4({
    title: attack, c4Level: 'C4Component',
    nodes: [
      { id: 'end', label: attack, type: 'Component', technology: 'TypeScript', description: 'A < B & B > C' },
      { id: 'a-b', label: 'Destination', type: 'ExternalSystem' },
    ],
    relationships: [{ from: 'end', to: 'a-b', label: attack, technology: 'JSON / HTTPS' }],
  });
  for (const text of [result.svg, result.html]) {
    assert.ok(!text.includes('<script>globalThis.C4_PWNED=1</script>'), 'Supplied script must not become executable markup');
    assert.ok(!text.includes('<img src=x onerror="alert(1)">'), 'Supplied image must not become markup');
  }
  assert.ok(result.svg.includes('&lt;script&gt;'), 'The SVG must retain literal label text rather than dropping it');
  assert.ok(result.svg.includes('C4_PWNED=1'), 'Escaping must preserve the supplied label content');
});

test('compact rendering rejects invalid graph references before producing an image', async () => {
  const duplicate = structuredClone(largeFixture);
  duplicate.nodes[1].id = duplicate.nodes[0].id;
  await assert.rejects(() => renderCompactC4(duplicate), /duplicate/i);
  const missing = structuredClone(largeFixture);
  missing.relationships[0].to = 'missing-component';
  await assert.rejects(() => renderCompactC4(missing), /unknown|missing|not found/i);
});

test('MCP returns the generated image and writes matching portable artifacts beside the Markdown', { timeout: 30000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'c4-compact-mcp-'));
  const entrypoint = path.join(projectRoot, 'dist/index.js');
  const client = new Client({ name: 'compact-renderer-regression', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.platform === 'win32' ? process.execPath : entrypoint,
    args: process.platform === 'win32' ? [entrypoint] : [], cwd: projectRoot,
  });
  try {
    await client.connect(transport);
    const outputPath = path.join(tempDir, 'COMPACT.md');
    const result = await client.callTool({ name: 'render_c4_mermaid', arguments: { ...largeFixture, outputPath } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(result.content[0].type, 'text', 'Existing clients must still receive Mermaid source first');
    assert.match(result.content[0].text, /^```mermaid\n/);
    const image = result.content.find(item => item.type === 'image');
    assert.ok(image, 'A client should receive the generated visual without rendering Mermaid itself');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(result.structuredContent.layout.engine, 'elk');
    assert.equal(result.structuredContent.layout.nodeCount, largeFixture.nodes.length);
    assert.equal(result.structuredContent.layout.relationshipCount, largeFixture.relationships.length);
    const artifacts = result.structuredContent.artifacts;
    assert.equal(artifacts.markdown, outputPath);
    const [markdown, svg, png, html] = await Promise.all([
      readFile(artifacts.markdown, 'utf8'), readFile(artifacts.svg, 'utf8'),
      readFile(artifacts.png), readFile(artifacts.html, 'utf8'),
    ]);
    assert.ok(markdown.includes(result.content[0].text), 'The compatible Mermaid export must also be saved');
    assert.ok(markdown.includes(path.basename(artifacts.png)), 'Markdown should display the compact image');
    assert.match(svg, /<svg\b/);
    assert.match(html, /<svg\b|\.svg/);
    assert.deepEqual(Buffer.from(image.data, 'base64'), png, 'The MCP image must match the saved server-generated PNG');
  } finally {
    await client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
