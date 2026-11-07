import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { renderC4Mermaid } from '../dist/renderers/c4Mermaid.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function originalDiagram() {
  return {
    title: 'c4-architect-mcp Component Architecture',
    c4Level: 'C4Component',
    nodes: [
      { id: 'index', label: 'index', type: 'Component', technology: 'TypeScript / Node.js' },
      { id: 'Ext__modelcontextprotocol_sdk', label: 'MCP Host Client', type: 'System_Ext', technology: 'Model Context Protocol' },
      { id: 'parsers_astParser', label: 'parsers/astParser', type: 'Component', technology: 'TypeScript / Node.js' },
    ],
    relationships: [
      { from: 'index', to: 'Ext__modelcontextprotocol_sdk', label: 'Communicates via @modelcontextprotocol/sdk', technology: 'JSON-RPC / stdio' },
      { from: 'index', to: 'parsers_astParser', label: 'Imports / Invokes', technology: 'Internal TS Module' },
    ],
  };
}

function hasDirectedEdge(diagram, from, to) {
  const fromPattern = new RegExp(`^\\s*${from}\\b`);
  const toPattern = new RegExp(`\\b${to}\\s*;?\\s*$`);
  return diagram.split('\n').some(line => fromPattern.test(line) && line.includes('-->') && toPattern.test(line));
}

function literalLabel(text) {
  return text.replace(/<br\s*\/?>/g, '').replace(/#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function toolText(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const text = result.content.find(item => item.type === 'text');
  assert.ok(text, 'MCP result must contain diagram text');
  return text.text;
}

test('the original failing graph uses automatic layout and preserves both outgoing branches', () => {
  const diagram = renderC4Mermaid(originalDiagram());
  assert.match(diagram, /^```mermaid\n/);
  assert.match(diagram, /\bflowchart\s+TB\b/);
  assert.doesNotMatch(diagram, /^\s*autowrap\s*$/m);
  const semanticText = literalLabel(diagram).replace(/\s+/g, '');
  for (const text of [
    'c4-architect-mcp Component Architecture', 'index', 'MCP Host Client',
    'parsers/astParser', 'TypeScript / Node.js', 'Model Context Protocol',
    'Communicates', 'modelcontextprotocol/sdk', 'JSON-RPC / stdio',
    'Imports / Invokes', 'Internal TS Module',
  ]) assert.ok(semanticText.includes(text.replace(/\s+/g, '')), `Diagram lost ${text}`);
  assert.ok(hasDirectedEdge(diagram, 'n0', 'n1'), 'index must point to the external MCP client');
  assert.ok(hasDirectedEdge(diagram, 'n0', 'n2'), 'index must point to the parser');
  assert.ok(!hasDirectedEdge(diagram, 'n1', 'n0'), 'The external relationship must not be reversed');
});

test('long package identifiers wrap in nodes and relationships without losing characters', () => {
  const identifier = '@vendor/super-long-package_name.segment:with-parameters/handler_0123456789';
  const diagram = renderC4Mermaid({
    title: 'Long identifier', c4Level: 'C4Component',
    nodes: [
      { id: 'package', label: identifier, type: 'Component' },
      { id: 'consumer', label: 'Consumer', type: 'Component' },
    ],
    relationships: [{ from: 'package', to: 'consumer', label: identifier }],
  });
  const nodeLabel = diagram.match(/^\s*n0\["(.*)"\]\s*$/m)?.[1];
  const edgeLabel = diagram.match(/^\s*n0\s*-->\|"(.*)"\|\s*n1\s*$/m)?.[1];
  assert.ok(nodeLabel && edgeLabel, 'The package node and relationship must both be rendered');
  assert.ok(nodeLabel.includes('<br/>') && edgeLabel.includes('<br/>'), 'Both labels must wrap');
  assert.ok(literalLabel(nodeLabel).endsWith(identifier), 'Node wrapping must preserve every identifier character');
  assert.equal(literalLabel(edgeLabel), identifier, 'Relationship wrapping must preserve every identifier character');
});

test('the analyzer ExternalSystem spelling has the same external-system semantics', () => {
  const input = originalDiagram();
  const canonical = renderC4Mermaid(input);
  input.nodes[1].type = 'ExternalSystem';
  assert.equal(renderC4Mermaid(input), canonical);
});

test('branch, merge, cycle, self-loop and disconnected components are retained', () => {
  const input = {
    title: 'Graph topology', c4Level: 'C4Component',
    nodes: ['start', 'left', 'right', 'merge', 'isolated'].map(id => ({ id, label: `${id} component`, type: 'Component' })),
    relationships: [
      { from: 'start', to: 'left', label: 'dispatch left' },
      { from: 'start', to: 'right', label: 'dispatch right' },
      { from: 'left', to: 'merge', label: 'merge left' },
      { from: 'right', to: 'merge', label: 'merge right' },
      { from: 'merge', to: 'start', label: 'retry' },
      { from: 'merge', to: 'merge', label: 'refresh' },
    ],
  };
  const diagram = renderC4Mermaid(input);
  for (const [from, to] of [[0, 1], [0, 2], [1, 3], [2, 3], [3, 0], [3, 3]]) {
    assert.ok(hasDirectedEdge(diagram, `n${from}`, `n${to}`), `Missing edge n${from} -> n${to}`);
  }
  assert.ok(diagram.includes('isolated component'), 'Disconnected nodes must remain visible');
  assert.equal(diagram.split('\n').filter(line => line.includes('-->')).length, input.relationships.length);
});

test('reserved or punctuation-containing user IDs cannot become Mermaid identifiers', () => {
  const diagram = renderC4Mermaid({
    title: 'Safe IDs', c4Level: 'C4Container',
    nodes: [
      { id: 'end', label: 'API', type: 'Container', technology: 'Node.js' },
      { id: 'a-b', label: 'Database', type: 'ContainerDb', technology: 'SQL' },
    ],
    relationships: [{ from: 'end', to: 'a-b', label: 'Stores data' }],
  });
  assert.ok(hasDirectedEdge(diagram, 'n0', 'n1'));
  assert.doesNotMatch(diagram, /^\s*(?:end|a-b)\s*(?:\[|\()/m);
  assert.ok(diagram.includes('API') && diagram.includes('Database'));
});

test('untrusted label text remains literal rather than Mermaid, Markdown or HTML instructions', () => {
  const injected = 'quoted "name" | <script>alert(1)</script> `code`\nnext line';
  const diagram = renderC4Mermaid({
    title: 'Title\nflowchart LR\n```', c4Level: 'C4Context',
    nodes: [
      { id: 'a', label: injected, type: 'System', description: 'Description "quoted" <b>literal</b> | `text`' },
      { id: 'b', label: 'Human', type: 'Person' },
    ],
    relationships: [{ from: 'a', to: 'b', label: injected, technology: 'Protocol "quoted" | <tag>' }],
  });
  assert.ok(hasDirectedEdge(diagram, 'n0', 'n1'));
  assert.doesNotMatch(diagram, /<script>|<\/script>|<b>|<tag>/);
  assert.doesNotMatch(diagram, /`code`|`text`/);
  assert.doesNotMatch(diagram, /^flowchart LR\s*$/m);
  assert.equal((diagram.match(/^```/gm) ?? []).length, 2, 'Input must not inject an extra Markdown fence');
  assert.ok(diagram.includes('next line') && diagram.includes('Description') && diagram.includes('Protocol'));
});

test('ambiguous IDs and missing edge endpoints fail before generating misleading diagrams', () => {
  const duplicate = originalDiagram();
  duplicate.nodes[1].id = duplicate.nodes[0].id;
  assert.throws(() => renderC4Mermaid(duplicate), /duplicate/i);
  const missingTarget = originalDiagram();
  missingTarget.relationships[0].to = 'missing-target';
  assert.throws(() => renderC4Mermaid(missingTarget), /unknown|missing|not found|does not exist/i);
  const missingSource = originalDiagram();
  missingSource.relationships[0].from = 'missing-source';
  assert.throws(() => renderC4Mermaid(missingSource), /unknown|missing|not found|does not exist/i);
  assert.throws(() => renderC4Mermaid({ title: 'Empty', c4Level: 'C4Context', nodes: [], relationships: [] }), /empty|at least one|no nodes/i);
});

test('MCP analysis output feeds the renderer and the saved Markdown contains the same diagram', { timeout: 15000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'c4-renderer-test-'));
  const client = new Client({ name: 'c4-renderer-regression', version: '1.0.0' });
  const entrypoint = path.join(projectRoot, 'dist/index.js');
  const transport = new StdioClientTransport({
    command: process.platform === 'win32' ? process.execPath : entrypoint,
    args: process.platform === 'win32' ? [entrypoint] : [],
    cwd: projectRoot,
  });
  try {
    await client.connect(transport);
    const analysis = JSON.parse(toolText(await client.callTool({
      name: 'analyze_architectural_boundaries', arguments: { targetDir: './src', c4Level: 'Component' },
    })));
    assert.ok(analysis.nodes.length >= 2, 'Analyze the real project rather than an empty fixture');
    const outputPath = path.join(tempDir, 'ARCHITECTURE.md');
    const diagram = toolText(await client.callTool({
      name: 'render_c4_mermaid',
      arguments: {
        title: 'MCP integration architecture', c4Level: 'C4Component',
        nodes: analysis.nodes.map(({ id, label, type, technology, description }) => ({ id, label, type, technology, description })),
        relationships: analysis.edges.map(({ source, target, label, protocol }) => ({ from: source, to: target, label, technology: protocol })),
        outputPath,
      },
    }));
    assert.match(diagram, /\bflowchart\s+TB\b/);
    const saved = await readFile(outputPath, 'utf8');
    assert.ok(saved.includes(diagram), 'The tool response must be the same diagram written to disk');
    assert.ok(literalLabel(diagram).includes('parsers/astParser'));
    const sdk = analysis.nodes.find(node => node.path === 'package:@modelcontextprotocol/sdk');
    assert.ok(sdk, 'SDK import remains represented without inventing an MCP host');
    assert.equal(sdk.classification.basis, 'inferred');
    assert.ok(!analysis.edges.some(edge => edge.protocol === 'JSON-RPC / stdio'), 'Imports alone cannot establish runtime transport');

    const multilineTitle = 'Architecture\n```mermaid\nflowchart LR\nA --> B\n```';
    const specialDiagram = toolText(await client.callTool({
      name: 'render_c4_mermaid',
      arguments: { ...originalDiagram(), title: multilineTitle, outputPath },
    }));
    const specialSaved = await readFile(outputPath, 'utf8');
    assert.ok(specialSaved.includes(specialDiagram));
    assert.equal((specialSaved.match(/^```/gm) ?? []).length, 2, 'A multiline title must not inject Markdown fences into the saved document');
    assert.doesNotMatch(specialSaved, /^flowchart LR\s*$/m, 'A title must not become document instructions');
  } finally {
    await client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
