import type { ArchitectureEdge } from "../model/graph.js";
import { selectGraphNeighborhood } from "../model/neighborhood.js";
import { diagramFromView } from "./artifacts.js";
import { renderCompactC4 } from "./compactC4.js";
import { saveFileReport, scanFileReport, type FileSourceOptions } from "./fileReport.js";
import { markdownText, sourceEvidence } from "./sourceLinks.js";

interface ExplainOptions extends FileSourceOptions {
  maxNodes?: number;
  maxEdges?: number;
}

export async function explainFile(targetDir: string, file: string, outputPath: string, options: ExplainOptions = {}) {
  if (!/\.md$/i.test(outputPath)) throw new Error("explain-file output must end in .md");
  const { markdown, graph, center, link } = await scanFileReport(targetDir, file, outputPath, options);
  const view = selectGraphNeighborhood(graph, { nodeId: center.id, maxDepth: 1, maxNodes: options.maxNodes, maxEdges: options.maxEdges });
  const diagram = diagramFromView(graph, `${center.path} · Direct dependencies`, view);
  const { png: image } = await renderCompactC4(diagram);
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
  const artifacts = await saveFileReport(markdown, image, imageLink => [
    `# Explain ${markdownText(center.path)}`,
    `Direct imports, re-exports and other module references in a scan of ${graph.metadata.filesScanned} TypeScript/TSX files. Paths are relative to the scan directory.`,
    `Direct relationships: ${counts.incoming} incoming and ${counts.outgoing} outgoing. The diagram shows ${counts.nodes} nodes and ${counts.relationships} relationships.`
      + (truncated.nodes || truncated.edges ? " · Diagram limit reached" : ""),
    `![Focused Component diagram](<${imageLink}>)`,
    "## Files that import this file", relationships(true),
    "## Dependencies of this file", relationships(false),
    "## Analysis notes", notes.join("\n"),
  ].join("\n\n") + "\n");
  return { file: center.path, artifacts, counts, truncated };
}
