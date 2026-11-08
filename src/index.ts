#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeDirectory } from "./parsers/astParser.js";
import { compareArchitectureGraphs, queryArchitectureGraph, readArchitectureGraph, summarizeArchitectureGraph, writeArchitectureGraph } from "./model/graph.js";
import { graphFocusSchema } from "./model/neighborhood.js";
import { diagramSchema } from "./model/diagram.js";
import { renderArchitectureGraph, renderArtifacts, renderDrawioArtifacts, renderDrawioGraph, renderStructurizrArtifacts } from "./renderers/artifacts.js";
import { structurizrDiagramSchema, structurizrWorkspaceSchema } from "./renderers/structurizr.js";
import { runAdoWiki } from "./publishers/adoWiki.js";
import { adoWikiDocumentSchema } from "./publishers/adoWikiPreview.js";
import { adoWikiTargetSchema } from "./publishers/adoWikiTransport.js";
import { runConfluence } from "./publishers/confluence.js";
import { confluenceTargetSchema } from "./publishers/confluenceTransport.js";
import { runNotion } from "./publishers/notion.js";
import { notionTargetSchema } from "./publishers/notionTransport.js";
import { wikiDocumentSchema } from "./publishers/wikiDiagrams.js";
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

server.tool("render_architecture_graph", "Render a saved graph or a focused node neighborhood as a compact C4 image and Mermaid source, or as editable Draw.io XML with format drawio.",
  { graphPath: z.string(), title: z.string().optional(), outputPath: z.string().optional(),
    format: z.enum(["compact", "drawio"]).optional().describe("Use .md for compact artifacts or .drawio for Draw.io"),
    focus: graphFocusSchema.optional().describe("Render only a node and its neighbors. Use query_architecture_graph to find the node ID.") },
  async ({ graphPath, format, ...options }) => {
    const graph = await readArchitectureGraph(graphPath);
    return format === "drawio" ? renderDrawioGraph(graph, options) : renderArchitectureGraph(graph, options);
  });

server.tool("render_c4_mermaid",
  "Render an authored Context, Container, Component, Deployment, Dynamic, System Landscape, or Code diagram. Returns a compact PNG and Mermaid source. With outputPath saves Markdown, SVG, PNG and interactive HTML.",
  {
    ...diagramSchema.shape,
    outputPath: z.string().optional().describe("Markdown destination ending in .md"),
  }, async ({ outputPath, ...diagram }) => renderArtifacts(diagram, outputPath));

server.tool("render_c4_drawio",
  "Render an authored C4 diagram as editable Draw.io XML with native shapes, deployment groups, and connector labels.",
  {
    ...diagramSchema.shape,
    outputPath: z.string().optional().describe("Draw.io destination ending in .drawio"),
  }, async ({ outputPath, ...diagram }) => renderDrawioArtifacts(diagram, outputPath));

server.tool("render_structurizr_dsl",
  "Render authored Context, Container, Component, or Deployment diagrams as an editable Structurizr DSL workspace.",
  {
    input: z.union([structurizrDiagramSchema, structurizrWorkspaceSchema]).describe("One authored diagram or a workspace with up to four views"),
    outputPath: z.string().optional().describe("Workspace destination ending in .dsl"),
  }, async ({ input, outputPath }) => renderStructurizrArtifacts(input, outputPath));

server.tool("publish_to_ado_wiki",
  "Build a local Azure DevOps Wiki preview with PNG attachments. Publish only with publish: true and an explicit target. Credentials come from the environment.",
  {
    input: adoWikiDocumentSchema,
    outputDir: z.string().min(1).describe("Directory for page.md, index.html, and PNG attachments"),
    target: adoWikiTargetSchema.optional(),
    publish: z.boolean().optional().describe("Write to the supplied Azure DevOps Wiki target. Omit for an offline preview."),
  }, async ({ input, ...options }) => {
    const result = await runAdoWiki(input, options);
    return { ...textResult(result), structuredContent: result };
  });

server.tool("publish_to_confluence",
  "Build a local Confluence Cloud page preview with PNG attachments and storage XHTML. Set publish: true and an explicit target to publish. Credentials come from the environment.",
  {
    input: wikiDocumentSchema,
    outputDir: z.string().min(1).describe("Directory for page.storage.xhtml, index.html, and PNG attachments"),
    target: confluenceTargetSchema.optional().describe("Cloud site and space ID, plus an optional parent ID for a new page or page ID for an update"),
    publish: z.boolean().optional().describe("Write to Confluence Cloud. Omit for an offline preview."),
  }, async ({ input, ...options }) => {
    const result = await runConfluence(input, options);
    return { ...textResult(result), structuredContent: result };
  });

server.tool("publish_to_notion",
  "Build a local Notion page preview with PNGs and a page manifest. Set publish: true and a parent page ID to create a child page with native images. Credentials come from the environment.",
  {
    input: wikiDocumentSchema,
    outputDir: z.string().min(1).describe("Directory for index.html, page.json, and PNGs"),
    target: notionTargetSchema.optional().describe("Notion parent page ID for the new child page"),
    publish: z.boolean().optional().describe("Create a child page in Notion. Omit for an offline preview."),
  }, async ({ input, ...options }) => {
    const result = await runNotion(input, options);
    return { ...textResult(result), structuredContent: result };
  });

async function main() {
  if (await runCli(process.argv.slice(2))) return;
  await server.connect(new StdioServerTransport());
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
