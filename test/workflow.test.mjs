import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { graphToDiagram } from '../dist/renderers/artifacts.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { graphToDiagram } from '../dist/renderers/artifacts.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const text = result => { assert.notEqual(result.isError, true, JSON.stringify(result)); return JSON.parse(result.content.find(item => item.type === 'text').text); };
test('saved-graph MCP workflow preserves source evidence and declared boundaries without resending the graph', { timeout: 30000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-workflow-'));
  const client = new Client({name:'workflow-test',version:'1.0.0'});
  try {
    await fs.mkdir(path.join(temporary, 'src'));
    await fs.writeFile(path.join(temporary, 'src/api.ts'), 'import { save } from "./storage.js"; export const create = save;\n');
    await fs.writeFile(path.join(temporary, 'src/storage.ts'), 'export function save() { return true; }\n');
    const config = path.join(temporary, 'boundaries.json');
    await fs.writeFile(config, JSON.stringify({schemaVersion:'1.0',system:{id:'example',label:'Example'},defaultContainer:{id:'service',label:'Service'},components:[{id:'api',label:'API',paths:['api.ts']},{id:'storage',label:'Storage',paths:['storage.ts']}]}));
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:temporary}));
    const tools = (await client.listTools()).tools.map(tool => tool.name);
    for (const tool of ['analyze_architectural_boundaries','get_architecture_summary','query_architecture_graph','compare_architecture_graphs','render_architecture_graph','render_c4_mermaid']) assert.ok(tools.includes(tool));
    const graphPath = path.join(temporary, 'graph.json');
    const summary = text(await client.callTool({name:'analyze_architectural_boundaries',arguments:{targetDir:path.join(temporary,'src'),c4Level:'Component',configPath:config,outputPath:graphPath,responseMode:'summary'}}));
    assert.equal(summary.counts.nodes, 2); assert.equal(summary.counts.edges, 1); assert.equal(summary.nodes, undefined);
    const graph = JSON.parse(await fs.readFile(graphPath,'utf8'));
    assert.equal(graph.schemaVersion, '1.0');
    assert.equal(graph.nodes.find(node=>node.label==='API').classification.basis,'declared');
    const inferredParentGraph = structuredClone(graph);
    const apiNode = inferredParentGraph.nodes.find(node => node.label === 'API');
    inferredParentGraph.hierarchy.find(boundary => boundary.id === apiNode.parentId).classification = { basis: 'inferred', rule: 'test-parent-inference' };
    assert.match(graphToDiagram(inferredParentGraph).nodes.find(node => node.id === apiNode.id).description, /Within Service \(inferred\)/);
    assert.equal(graph.edges[0].evidence[0].line,1); assert.equal(graph.edges[0].protocol,'unknown');
    const inferredGraph = structuredClone(graph);
    inferredGraph.nodes[0].classification = {basis:'inferred',confidence:'low'};
    assert.match(graphToDiagram(inferredGraph).nodes[0].label, /\(inferred\)/, 'Inferred boundaries must be visible in static images');
    assert.doesNotMatch(graphToDiagram(graph).nodes[0].label, /\(inferred\)/);
    const query = text(await client.callTool({name:'query_architecture_graph',arguments:{graphPath,search:'API',includeEvidence:true,maxBytes:2048}}));
    assert.ok(Buffer.byteLength(JSON.stringify(query)) <= 2048); assert.ok(query.nodes.length >= 1);
    const noChanges = text(await client.callTool({name:'compare_architecture_graphs',arguments:{beforePath:graphPath,afterPath:graphPath}}));
    assert.ok(noChanges);
    const out = path.join(temporary,'nested/architecture.md');
    const rendered = await client.callTool({name:'render_architecture_graph',arguments:{graphPath,outputPath:out,title:'Example architecture'}});
    assert.notEqual(rendered.isError,true); assert.equal(rendered.structuredContent.layout.nodeCount,2);
    assert.equal(rendered.content[1].data,(await fs.readFile(out.replace('.md','.png'))).toString('base64'));
    assert.match(await fs.readFile(out.replace('.md','.html'),'utf8'),/export-png/);
    const invalid = await client.callTool({name:'analyze_architectural_boundaries',arguments:{targetDir:path.join(temporary,'src'),c4Level:'Component',responseMode:'summary'}});
    assert.equal(invalid.isError,true,'summary cannot discard the full graph without saving it');
  } finally { await client.close(); await fs.rm(temporary,{recursive:true,force:true}); }
});

test('CLI and MCP query/diff honor the actual UTF-8 text budget', { timeout: 30000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c4-text-budget-'));
  const client = new Client({ name: 'text-budget-test', version: '1.0.0' });
  try {
    const inferred = { basis: 'inferred', rule: 'test-fixture', confidence: 'low' };
    const hierarchy = [
      { id: 'system:fixture', label: 'Fixture', type: 'System', classification: inferred },
      { id: 'container:fixture', label: 'Application', type: 'Container', parentId: 'system:fixture', classification: inferred },
    ];
    const before = {
      schemaVersion: '1.0', metadata: { scannedDirectory: temporary, abstractionLevel: 'Component', filesScanned: 0,
        timestamp: '2026-11-06T00:00:00.000Z', analysisStatus: 'complete' },
      hierarchy, nodes: [], edges: [], sources: [], diagnostics: [],
    };
    const after = structuredClone(before);
    for (let index = 0; index < 60; index++) {
      const source = `component-${index}.ts`;
      after.nodes.push({ id: `component:領域-${String(index).padStart(2, '0')}-${'節點'.repeat(8)}`,
        label: `Component ${index} — 資料處理`, type: 'Component', technology: 'TypeScript', path: source,
        parentId: 'container:fixture', classification: inferred,
        evidence: [{ path: source, line: 1, column: 1, kind: 'source-file' }] });
      after.sources.push({ path: source, contentHash: 'a'.repeat(64), parseStatus: 'complete' });
    }
    after.metadata.filesScanned = after.sources.length;
    const beforePath = path.join(temporary, 'before.json'), afterPath = path.join(temporary, 'after.json');
    await Promise.all([fs.writeFile(beforePath, JSON.stringify(before)), fs.writeFile(afterPath, JSON.stringify(after))]);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/index.js')], cwd: temporary }));
    const maxBytes = 2048;
    const checkPayload = payload => {
      assert.ok(Buffer.byteLength(payload, 'utf8') <= maxBytes, `Text exceeded ${maxBytes} bytes: ${Buffer.byteLength(payload, 'utf8')}`);
      assert.ok(Buffer.byteLength(payload, 'utf8') > payload.length, 'The fixture must exercise UTF-8 byte counting');
      return JSON.parse(payload);
    };
    const operations = [
      { command: ['query', afterPath, '--search', 'Component', '--nodes', '100', '--edges', '200', '--bytes', String(maxBytes), '--evidence'],
        tool: 'query_architecture_graph', arguments: { graphPath: afterPath, search: 'Component', maxNodes: 100, maxEdges: 200, includeEvidence: true, maxBytes },
        verify: result => { assert.ok(result.nodes.length > 0); assert.equal(result.truncated.bytes, true); } },
      { command: ['diff', beforePath, afterPath, '--limit', '100', '--bytes', String(maxBytes)],
        tool: 'compare_architecture_graphs', arguments: { beforePath, afterPath, limit: 100, maxBytes },
        verify: result => { assert.equal(result.nodes.counts.added, 60); assert.equal(result.truncated, true); } },
    ];
    for (const operation of operations) {
      const cli = await exec(process.execPath, [path.join(root, 'dist/index.js'), ...operation.command], { cwd: temporary });
      operation.verify(checkPayload(cli.stdout));
      const result = await client.callTool({ name: operation.tool, arguments: operation.arguments });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const payload = result.content.filter(item => item.type === 'text').map(item => item.text).join('');
      operation.verify(checkPayload(payload));
    }
  } finally { await client.close(); await fs.rm(temporary, { recursive: true, force: true }); }
});
