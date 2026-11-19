import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArchitectureEdge, ArchitectureGraph } from "../model/graph.js";
import { selectGraphNeighborhood } from "../model/neighborhood.js";
import { analyzeDirectory } from "../parsers/astParser.js";
import { diagramFromView } from "./artifacts.js";
import { renderCompactC4 } from "./compactC4.js";
import { githubSourceLink, markdownText, sourceEvidence, type SourceLink } from "./sourceLinks.js";

interface ExplainOptions {
  repository?: string;
  commit?: string;
  sourceRoot?: string;
  tsconfigPath?: string;
  maxNodes?: number;
  maxEdges?: number;
}

function findFile(graph: ArchitectureGraph, requested: string, scanDirectory: string) {
  const explicit = /[/\\]/.test(requested) || path.isAbsolute(requested);
  const relative = path.relative(scanDirectory, path.resolve(scanDirectory, requested)).split(path.sep).join("/");
  const matches = graph.sources.filter(source => explicit
    ? source.path === relative : path.posix.basename(source.path) === requested);
  if (!matches.length) throw new Error(`No scanned TypeScript/TSX source matches ${requested}.`);
  if (matches.length > 1) {
    throw new Error(`Ambiguous filename ${requested}. Use a scan-relative path:\n${matches.map(source => "./" + source.path).join("\n")}`);
  }
  const source = matches[0];
  const node = graph.nodes.find(item => item.type === "Component" && item.path === source.path);
  if (!node) throw new Error(`Could not analyze ${source.path}. ${graph.diagnostics.find(item => item.path === source.path)?.message ?? "No parsed component."}`);
  return node;
}

function relativeLink(from: string, destination: string) {
  const relative = path.relative(from, destination);
  // A Windows report may be written to a different drive than the scan.
  return path.isAbsolute(relative) ? pathToFileURL(destination).href
    : relative.split(path.sep).map(encodeURIComponent).join("/");
}

export async function explainFile(targetDir: string, file: string, outputPath: string, options: ExplainOptions = {}) {
  if (!/\.md$/i.test(outputPath)) throw new Error("explain-file output must end in .md");
  const markdown = path.resolve(outputPath);
  const directory = path.dirname(markdown);
  const scanDirectory = path.resolve(targetDir);
  let link: SourceLink;
  if (options.repository !== undefined) {
    link = githubSourceLink(options.commit, { repository: options.repository, sourceRoot: options.sourceRoot }, "File");
  } else {
    if (options.sourceRoot !== undefined || options.commit !== undefined) throw new Error("GitHub source links require --github-repo and --commit together");
    link = (filename, line) => relativeLink(directory, path.join(scanDirectory, filename)) + (line ? `#L${line}` : "");
  }

  // File-level components retain individual importers even when a project groups files into declared components.
  const graph = await analyzeDirectory(scanDirectory, "Component", { tsconfigPath: options.tsconfigPath });
  const center = findFile(graph, file, scanDirectory);
  const view = selectGraphNeighborhood(graph, { nodeId: center.id, maxDepth: 1, maxNodes: options.maxNodes, maxEdges: options.maxEdges });
  const diagram = diagramFromView(graph, `${center.path} · Direct dependencies`, view);
  const { png: image } = await renderCompactC4(diagram);
  const stem = path.basename(markdown, path.extname(markdown));
  const digest = createHash("sha256").update(image).digest("hex").slice(0, 16);
  const png = path.join(directory, `${stem}.focus-${digest}.png`);
  const targetNotes = graph.diagnostics.filter(item => item.path === center.path);
  const counts = {
    incoming: graph.edges.filter(edge => edge.target === center.id).length,
    outgoing: graph.edges.filter(edge => edge.source === center.id).length,
    nodes: view.nodes.length, relationships: view.edges.length,
    unresolved: targetNotes.filter(item => item.code === "UNRESOLVED_IMPORT" || item.code === "UNRESOLVED_PACKAGE").length,
  };
  const truncated = view.focus.truncated;
  const nodes = new Map(view.nodes.map(node => [node.id, node]));
  const arrowIds = new Map(view.edges.map((edge, i) => [edge.id, `R${String(i + 1).padStart(2, "0")}`]));

  function relationships(incoming: boolean) {
    const selected = view.edges.filter(edge => (incoming ? edge.target : edge.source) === center.id);
    const total = incoming ? counts.incoming : counts.outgoing;
    if (!total) return "No direct relationships observed in this direction within the scanned files.";
    const peer = (edge: ArchitectureEdge) => nodes.get(incoming ? edge.source : edge.target)!.path;
    const rows = selected.sort((a, b) => peer(a).localeCompare(peer(b))).map(edge =>
      `- **${arrowIds.get(edge.id)}** ${markdownText(peer(edge))} · ${markdownText(edge.label)} · `
      + edge.evidence.map(item => sourceEvidence(item, link)).join(" · "));
    if (selected.length < total) rows.push(`${total - selected.length} more relationships omitted by the diagram limits.`);
    return rows.join("\n");
  }
  const notes = targetNotes.map(item => `- ${sourceEvidence(item, link)} · ${markdownText(item.code)} · ${markdownText(item.message)}`);
  if (!notes.length) notes.push("No analysis diagnostics for this file.");
  const elsewhere = graph.diagnostics.filter(item => item.severity !== "info" && item.path !== center.path);
  if (elsewhere.length) notes.push(`\nThe scan reported ${elsewhere.length} diagnostics elsewhere. Other files may contain imports the scan could not trace.`);
  const content = [
    `# Explain ${markdownText(center.path)}`,
    `Direct imports, re-exports and other module references in a scan of ${graph.metadata.filesScanned} TypeScript/TSX files. Paths are relative to the scan directory.`,
    `Direct relationships: ${counts.incoming} incoming and ${counts.outgoing} outgoing. The diagram shows ${counts.nodes} nodes and ${counts.relationships} relationships.`
      + (truncated.nodes || truncated.edges ? " · Diagram limit reached" : ""),
    `![Focused Component diagram](<${relativeLink(directory, png)}>)`,
    "## Files that import this file", relationships(true),
    "## Dependencies of this file", relationships(false),
    "## Analysis notes", notes.join("\n"),
  ].join("\n\n") + "\n";

  // Each report references the bytes from its own scan, including during concurrent regenerations.
  await fs.mkdir(directory, { recursive: true });
  const stage = await fs.mkdtemp(path.join(directory, ".c4-explain-"));
  try {
    await fs.writeFile(path.join(stage, "diagram.png"), image);
    await fs.writeFile(path.join(stage, "report.md"), content, "utf8");
    await fs.rename(path.join(stage, "diagram.png"), png);
    await fs.rename(path.join(stage, "report.md"), markdown);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  return { file: center.path, artifacts: { markdown, png }, counts, truncated };
}
