import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { componentScaleFixtures } from '../test/fixtures/component-scale.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(root, process.argv[2] ?? 'output/playwright/component-scale');
await mkdir(output, { recursive: true });
const entrypoint = path.join(root, 'dist/index.js');
const client = new Client({ name: 'component-layout-stress-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.platform === 'win32' ? process.execPath : entrypoint,
  args: process.platform === 'win32' ? [entrypoint] : [],
  cwd: root,
});
const results = [];
try {
  await client.connect(transport);
  for (const { name, diagram } of componentScaleFixtures) {
    const outputPath = path.join(output, `${name}.md`);
    const result = await client.callTool({
      name: 'render_c4_mermaid', arguments: { ...diagram, outputPath },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const source = result.content.find(item => item.type === 'text')?.text;
    assert.ok(source, 'The server must return Mermaid source');
    assert.ok((await readFile(outputPath, 'utf8')).includes(source), 'Saved diagram must match MCP output');
    assert.equal(result.structuredContent?.layout?.engine, 'elk', 'Layout checks must use the current server-generated compact image');
    const image = result.content.find(item => item.type === 'image');
    assert.ok(image, 'The MCP server must return its generated image');
    assert.deepEqual(await readFile(result.structuredContent.artifacts.png), Buffer.from(image.data, 'base64'), 'Saved preview must match the image returned by MCP');
    await writeFile(path.join(output, `${name}.input.json`), JSON.stringify(diagram, null, 2) + '\n');
    results.push({ name, nodes: diagram.nodes.length, relationships: diagram.relationships.length, outputPath, layout: result.structuredContent.layout });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await client.close();
}
