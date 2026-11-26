import { posix } from "node:path";
import { z } from "zod";
import type { ArchitectureEdge, ArchitectureGraph, ArchitectureNode } from "../model/graph.js";
import type { C4Diagram } from "./c4Mermaid.js";
import { renderFileImpactDiagram } from "./fileImpactDiagram.js";
import { saveFileReport, scanFileReport, type FileSourceOptions } from "./fileReport.js";
import { markdownText, sourceEvidence } from "./sourceLinks.js";

export const fileImpactLimits = z.object({
  maxDepth: z.number().int().min(1).max(5).default(3),
  maxNodes: z.number().int().min(1).max(100).default(25),
});

interface ImpactOptions extends FileSourceOptions {
  maxDepth?: number;
  maxNodes?: number;
}

interface Dependent {
  node: ArchitectureNode;
  depth: number;
  via: ArchitectureEdge;
}

function collectDependents(graph: ArchitectureGraph, center: ArchitectureNode, maxDepth: number) {
  // Only parsed local files are eligible. External package nodes cannot supply import evidence.
  const files = new Map(graph.nodes.filter(node => node.type === "Component").map(node => [node.id, node]));
  const incoming = new Map<string, ArchitectureEdge[]>();
  for (const edge of graph.edges) {
    if (!files.has(edge.source) || !files.has(edge.target)) continue;
    const list = incoming.get(edge.target);
    if (list) list.push(edge);
    else incoming.set(edge.target, [edge]);
  }

  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  for (const edges of incoming.values()) {
    edges.sort((a, b) => compare(files.get(a.source)!.path, files.get(b.source)!.path)
      || a.evidence[0].line - b.evidence[0].line || a.evidence[0].column - b.evidence[0].column || compare(a.id, b.id));
  }

  // Breadth-first discovery gives every file a shortest path. The first edge wins ties;
  // option limits may then take any prefix without disconnecting an importer from the target.
  const dependents: Dependent[] = [];
  const seen = new Set([center.id]);
  let frontier = [center];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: ArchitectureNode[] = [];
    for (const target of frontier) {
      for (const edge of incoming.get(target.id) ?? []) {
        if (seen.has(edge.source)) continue;
        seen.add(edge.source);
        const node = files.get(edge.source)!;
        dependents.push({ node, depth, via: edge });
        next.push(node);
      }
    }
    frontier = next;
  }
  const beyondDepth = frontier.some(node => incoming.get(node.id)?.some(edge => !seen.has(edge.source)));
  return { dependents, beyondDepth };
}

export async function fileImpact(targetDir: string, file: string, outputPath: string, options: ImpactOptions = {}) {
  if (!/\.md$/i.test(outputPath)) throw new Error("File impact output must end in .md");
  const { maxDepth, maxNodes } = fileImpactLimits.parse(options);
  const { graph, center, markdown, link } = await scanFileReport(targetDir, file, outputPath, options);
  const { dependents, beyondDepth } = collectDependents(graph, center, maxDepth);
  const shown = dependents.slice(0, maxNodes - 1);
  const nodes = [center, ...shown.map(item => item.node)];
  const names = new Map(nodes.map(node => [node.id, node.path]));
  const hops = shown.map(({ via }, i) => ({
    from: names.get(via.source)!, to: names.get(via.target)!,
    arrow: `R${String(i + 1).padStart(2, "0")}`, kind: via.kind, label: via.label,
    evidence: via.evidence.map(item => ({ ...item, url: link(item.path, item.line) })),
  }));
  const hopByFile = new Map(hops.map(hop => [hop.from, hop]));
  const paths = shown.map(({ node, depth }) => {
    const pathHops: typeof hops = [];
    let hop = hopByFile.get(node.path);
    while (hop) {
      pathHops.push(hop);
      hop = hopByFile.get(hop.to);
    }
    return { file: node.path, depth, hops: pathHops };
  });

  const direct = dependents.filter(item => item.depth === 1).length;
  const counts = { direct, indirect: dependents.length - direct, nodes: nodes.length, relationships: hops.length };
  const truncated = { depth: beyondDepth, nodes: shown.length < dependents.length };
  const depthLimit = maxDepth === 1 ? "1 hop" : `${maxDepth} hops`;
  const nameCounts = new Map<string, number>();
  for (const node of nodes) {
    const basename = posix.basename(node.path);
    nameCounts.set(basename, (nameCounts.get(basename) ?? 0) + 1);
  }
  const depths = new Map(shown.map(item => [item.node.id, item.depth]));
  const caption = `${shown.length} of ${dependents.length} observed ${dependents.length === 1 ? "dependent" : "dependents"} within ${depthLimit} · Importer → dependency`
    + (beyondDepth ? " · More beyond depth limit" : "")
    + (graph.metadata.analysisStatus === "partial" ? " · Partial scan" : "");
  const diagram: C4Diagram = {
    c4Level: "C4Component", title: `Dependents of ${center.path}`,
    caption,
    nodes: nodes.map(node => {
      const basename = posix.basename(node.path);
      const depth = depths.get(node.id) ?? 0;
      return {
        id: node.id, type: "Component",
        label: nameCounts.get(basename) === 1 ? basename : node.path,
        technology: depth === 0 ? "Selected file" : depth === 1 ? "Direct importer" : `Indirect · ${depth} hops`,
        description: node.path,
      };
    }),
    relationships: shown.map(({ via }) => ({ from: via.source, to: via.target, label: via.label })),
  };
  const { png: image } = await renderFileImpactDiagram(diagram, hops.map(hop => hop.arrow));

  function section(indirect: boolean) {
    const selected = paths.filter(item => (item.depth > 1) === indirect);
    if (!selected.length) return (indirect ? counts.indirect : counts.direct) > 0
      ? "The file limit omitted these paths." : "None observed within the scan and depth limit.";
    return selected.map(item => {
      const chain = [item.file, ...item.hops.map(hop => hop.to)].map(markdownText).join(" → ");
      const arrows = item.hops.map(hop => `[${hop.arrow}](<${hop.evidence[0].url}>)`).join(" → ");
      return `- ${chain} · ${arrows}`;
    }).join("\n");
  }
  const evidence = hops.map(hop => `| ${hop.arrow} | ${markdownText(hop.from)} → ${markdownText(hop.to)} | ${markdownText(hop.label)} | `
    + hop.evidence.map(item => sourceEvidence(item, link)).join(" · ") + " |");
  const diagnostics = graph.diagnostics.filter(item => item.severity !== "info");
  const byCode = new Map<string, number>();
  for (const item of diagnostics) byCode.set(item.code, (byCode.get(item.code) ?? 0) + 1);
  const notes = [`The scan covered ${graph.metadata.filesScanned} TypeScript/TSX files. Analysis status: **${graph.metadata.analysisStatus}**.`];
  if (diagnostics.length) notes.push(`Warnings and errors in this scan: ${diagnostics.length}. Unresolved or unparsed references can hide additional importers. `
    + [...byCode].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => `${code} (${count})`).join(", ") + ".");
  if (truncated.depth) notes.push(`Additional importers exist beyond the ${maxDepth}-hop limit.`);
  if (truncated.nodes) {
    const omitted = dependents.length - shown.length;
    notes.push(`The ${maxNodes}-node limit omitted ${omitted} ${omitted === 1 ? "file" : "files"} from the diagram and path list. The totals include all observed dependents within ${depthLimit}.`);
  }

  const artifacts = await saveFileReport(markdown, image, imageLink => [
    `# What depends on ${markdownText(center.path)}?`,
    `**${counts.direct} direct** and **${counts.indirect} indirect** dependent files observed within ${depthLimit}. `
      + "Start with the direct importers. Each path follows source references back to the selected file.",
    `![${caption}](<${imageLink}>)`,
    "## Direct dependents", section(false),
    "## Indirect dependents", section(true),
    ...(hops.length ? ["## Source evidence", [
      "| Arrow | Importer → dependency | Reference | Source line |", "| --- | --- | --- | --- |", ...evidence,
    ].join("\n")] : []),
    "## Scope", "Each file appears once, at its shortest distance. When multiple shortest paths exist, the diagram and list show one. "
      + "A type-only hop records a compile-time dependency. Whether a change affects runtime behavior requires checking the implementation.",
    notes.join("\n\n"),
  ].join("\n\n") + "\n");
  return { file: center.path, artifacts, counts, truncated, paths, maxDepth, maxNodes,
    analysisStatus: graph.metadata.analysisStatus, diagnosticCounts: Object.fromEntries(byCode) };
}
