#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeDirectory } from "./parsers/astParser.js";
import { compareArchitectureGraphs, queryArchitectureGraph, readArchitectureGraph, summarizeArchitectureGraph, writeArchitectureGraph } from "./model/graph.js";
import { graphToDiagram, renderArtifacts } from "./renderers/artifacts.js";
import { runCli } from "./cli.js";
import { version } from "./version.js";

const server = new McpServer({ name: "c4-architect-mcp", version });
const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

server.tool("analyze_architectural_boundaries",
  "Locally parses TypeScript/TSX dependencies with source evidence, inferred or declared C4 mappings, and diagnostics. Save a graph and return a summary to keep the response small.",
  {
    targetDir: z.string().describe("Directory to scan"), c4Level: z.enum(["Context", "Container", "Component"]),
    configPath: z.string().optional().describe("Explicit JSON boundary configuration path"),
    tsconfigPath: z.string().optional().describe("TypeScript resolution configuration; read as data"),
    outputPath: z.string().optional().describe("Save canonical versioned graph JSON"),
    responseMode: z.enum(["graph", "summary"]).default("graph"),
  }, async ({ targetDir, c4Level, configPath, tsconfigPath, outputPath, responseMode }) => {
    if (responseMode === "summary" && !outputPath) throw new Error("summary mode requires outputPath so the complete graph remains available");
    const graph = await analyzeDirectory(path.resolve(targetDir), c4Level, { configPath, tsconfigPath });
    if (outputPath) { await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true }); await writeArchitectureGraph(outputPath, graph); }
    return textResult(responseMode === "summary" ? { ...summarizeArchitectureGraph(graph), graphPath: path.resolve(outputPath!) } : graph);
  });

server.tool("get_architecture_summary", "Read counts and analysis status from a saved, validated architecture graph.",
  { graphPath: z.string() }, async ({ graphPath }) => textResult(summarizeArchitectureGraph(await readArchitectureGraph(graphPath))));

server.tool("query_architecture_graph", "Read a bounded neighborhood or search result from a saved graph. Returns truncation flags; source evidence is opt-in.",
  {
    graphPath: z.string(), nodeId: z.string().optional(), search: z.string().max(500).optional(),
    direction: z.enum(["incoming", "outgoing", "both"]).default("both"), maxDepth: z.number().int().min(0).max(5).default(1),
    maxNodes: z.number().int().min(1).max(100).default(25), maxEdges: z.number().int().min(0).max(200).default(50),
    includeEvidence: z.boolean().default(false), maxBytes: z.number().int().min(2048).max(64000).default(16000),
  }, async ({ graphPath, ...options }) => textResult(queryArchitectureGraph(await readArchitectureGraph(graphPath), options)));

server.tool("compare_architecture_graphs", "Compare two saved graphs at the same abstraction level. Reports full change counts with bounded detail; timestamps and scan-root location do not create changes.",
  { beforePath: z.string(), afterPath: z.string(), limit: z.number().int().min(1).max(100).default(25), maxBytes: z.number().int().min(2048).max(64000).default(16000) },
  async ({ beforePath, afterPath, ...options }) => textResult(compareArchitectureGraphs(await readArchitectureGraph(beforePath), await readArchitectureGraph(afterPath), options)));

server.tool("render_architecture_graph", "Render a saved validated graph directly to a compact C4 image, Mermaid source, and optional Markdown/SVG/PNG/interactive HTML files. Inferred boundaries are labeled.",
  { graphPath: z.string(), title: z.string().optional(), outputPath: z.string().optional() },
  async ({ graphPath, title, outputPath }) => renderArtifacts(graphToDiagram(await readArchitectureGraph(graphPath), title), outputPath));

server.tool("render_c4_mermaid",
  "Renders a compact C4 PNG using server-side orthogonal layout, plus Mermaid source. With outputPath saves Markdown, SVG, PNG and interactive HTML with connection highlighting and full-diagram PNG/SVG exports.",
  {
    title: z.string(), c4Level: z.enum(["C4Context", "C4Container", "C4Component"]),
    nodes: z.array(z.object({ id: z.string(), label: z.string(), type: z.enum(["Person", "System", "System_Ext", "ExternalSystem", "Container", "ContainerDb", "Component"]), technology: z.string().optional(), description: z.string().optional() })),
    relationships: z.array(z.object({ from: z.string(), to: z.string(), label: z.string(), technology: z.string().optional() })),
    outputPath: z.string().optional().describe("Markdown destination ending in .md"),
  }, async ({ outputPath, ...diagram }) => renderArtifacts(diagram, outputPath));

async function main() {
  if (await runCli(process.argv.slice(2))) return;
  await server.connect(new StdioServerTransport());
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
