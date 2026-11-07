import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { diffArchitectureGraphs, readArchitectureGraph, type ArchitectureEdge, type ArchitectureGraph } from "../model/graph.js";
import { renderArchitectureGraph } from "./artifacts.js";

const rowLimit = 25;
const changes = ["added", "removed", "changed"] as const;
const labels = { added: "Added", removed: "Removed", changed: "Changed" };
const byId = <T extends { id: string }>(items: T[]) => new Map(items.map(item => [item.id, item]));

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]|~]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function table(header: string[], rows: string[][]): string {
  return [header.join(" | "), header.map(() => "---").join(" | "), ...rows.map(row => row.map(text).join(" | "))]
    .map(line => `| ${line} |`).join("\n");
}

function declarations(graph: ArchitectureGraph) {
  // Context and Container views also represent some declarations as nodes.
  // Prefer the hierarchy record and ignore exports and source evidence.
  return byId([...graph.nodes, ...graph.hierarchy].filter(item => item.classification.basis === "declared")
    .map(item => {
      const { id, type, label, parentId, technology, description } = item;
      // Aggregated components can inherit this display label from their first source file.
      const sourceTechnology = type === "Component" && "path" in item && item.path === "."
        && (technology === "TypeScript" || technology === "TypeScript / TSX");
      return { id, type, label, parentId, technology: sourceTechnology ? undefined : technology, description };
    }));
}

function sourceAssignments(graph: ArchitectureGraph) {
  const elements = byId([...graph.nodes, ...graph.hierarchy]);
  const assignments = new Map<string, { nodeId: string; ownerId?: string; label: string }>();
  for (const node of graph.nodes) {
    let owner = elements.get(node.id);
    while (owner && owner.classification.basis !== "declared") owner = owner.parentId ? elements.get(owner.parentId) : undefined;
    for (const item of node.evidence) {
      if (item.kind === "source-file") assignments.set(item.path, { nodeId: node.id, ownerId: owner?.id, label: owner?.label ?? "—" });
    }
  }
  return assignments;
}

function diagnostics(graph: ArchitectureGraph) {
  const counts = new Map<string, number>();
  for (const item of graph.diagnostics) {
    if (item.severity !== "info") counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
  }
  return counts;
}

function edgeLabel(edge: ArchitectureEdge, nodes: Map<string, ArchitectureGraph["nodes"][number]>) {
  return `${nodes.get(edge.source)!.label} → ${nodes.get(edge.target)!.label} · ${edge.label} (${edge.kind})`
    + (edge.protocol === "unknown" ? "" : ` · ${edge.protocol}`);
}

function evidence(edge: ArchitectureEdge) {
  const locations = edge.evidence.slice(0, 3).map(item =>
    `${item.path}:${item.line}:${item.column}${item.specifier ? ` (${item.specifier})` : ""}`);
  if (edge.evidence.length > locations.length) locations.push(`+${edge.evidence.length - locations.length} more in the saved graph`);
  return locations.join(" · ");
}

function detailRows(header: string[], rows: string[][]) {
  return table(header, rows.slice(0, rowLimit)) + (rows.length > rowLimit
    ? `\n\n${rows.length - rowLimit} more rows are available in the saved graph comparison.` : "");
}

function reviewMarkdown(before: ArchitectureGraph, after: ArchitectureGraph, title: string) {
  const diff = diffArchitectureGraphs(before, after);
  const beforeNodes = byId(before.nodes), afterNodes = byId(after.nodes);
  const beforeEdges = byId(before.edges), afterEdges = byId(after.edges);
  const dependencyChanges = changes.flatMap(kind => diff.edges[kind].map(id => ({ kind,
    base: kind === "added" ? undefined : beforeEdges.get(id)!,
    head: kind === "removed" ? undefined : afterEdges.get(id)!,
  })));
  const baseDeclarations = declarations(before), headDeclarations = declarations(after);
  const boundaryChanges = [...new Set([...baseDeclarations.keys(), ...headDeclarations.keys()])].sort().flatMap(id => {
    const base = baseDeclarations.get(id), head = headDeclarations.get(id);
    return JSON.stringify(base) === JSON.stringify(head) ? [] : [{ id, base, head }];
  });
  const boundaryCounts = { added: 0, removed: 0, changed: 0 };
  const boundaryRows = boundaryChanges.map(({ id, base, head }) => {
    const kind = base && head ? "changed" : head ? "added" : "removed";
    boundaryCounts[kind]++;
    const describe = (item: NonNullable<typeof base>) => [item.label, item.type, item.parentId && `parent ${item.parentId}`,
      item.technology, item.description].filter(Boolean).join(" · ");
    return [labels[kind], id, base ? describe(base) : "—", head ? describe(head) : "—"];
  });
  const baseAssignments = sourceAssignments(before), headAssignments = sourceAssignments(after);
  const assignmentChanges = [...headAssignments.keys()].sort().flatMap(filename => {
    const base = baseAssignments.get(filename), head = headAssignments.get(filename)!;
    return base && base.ownerId !== head.ownerId ? [{ filename, base, head }] : [];
  });

  const countsRow = (label: string, counts: Record<typeof changes[number], number>) => [label, ...changes.map(kind => String(counts[kind]))];
  const sections = [
    `# ${text(title) || "PR architecture review"}`,
    `Compared saved ${diff.abstractionLevel} graphs. Source locations are relative to each scan root.`,
    table(["Snapshot", "Revision", "Analysis", "Source files"], [["Base", before.metadata.commit ?? "—", before.metadata.analysisStatus, String(before.sources.length)],
      ["Head", after.metadata.commit ?? "—", after.metadata.analysisStatus, String(after.sources.length)]]),
    table(["Changes", "Added", "Removed", "Changed"], [countsRow("Dependencies", diff.edges.counts),
      countsRow("Declared boundaries", boundaryCounts),
      countsRow("Declared source assignments", { added: 0, removed: 0, changed: assignmentChanges.length }),
      countsRow("Source files", diff.sources.counts)]),
  ];
  if (!dependencyChanges.length && !boundaryChanges.length && !assignmentChanges.length) {
    sections.push("No dependency or declared boundary changes detected in the saved graphs.");
  }
  if (before.metadata.analysisStatus === "partial" || after.metadata.analysisStatus === "partial") {
    sections.push("**Partial analysis.** Review the diagnostics before treating the dependency comparison as complete.");
  }
  const baseDiagnostics = diagnostics(before), headDiagnostics = diagnostics(after);
  const codes = [...new Set([...baseDiagnostics.keys(), ...headDiagnostics.keys()])].sort();
  if (codes.length) sections.push("## Analysis diagnostics", detailRows(["Warning or error code", "Base", "Head"], codes.map(code =>
    [code, String(baseDiagnostics.get(code) ?? 0), String(headDiagnostics.get(code) ?? 0)])));

  if (dependencyChanges.length) sections.push("## Dependency changes", detailRows(["Change", "Relationship", "Source evidence"],
    dependencyChanges.map(({ kind, base, head }) => [labels[kind],
      [base && edgeLabel(base, beforeNodes), head && edgeLabel(head, afterNodes)].filter(Boolean).join(" → "),
      [base && `Base · ${evidence(base)}`, head && `Head · ${evidence(head)}`].filter(Boolean).join(" · "),
    ])));
  if (boundaryRows.length) sections.push("## Declared boundary changes", detailRows(["Change", "Boundary ID", "Base", "Head"], boundaryRows));
  if (assignmentChanges.length) sections.push("## Declared source assignment changes", detailRows(["Scan-relative path", "Base", "Head"],
    assignmentChanges.map(({ filename, base, head }) => [filename, base.label, head.label])));

  const sourceRows = changes.flatMap(kind => diff.sources[kind].map(filename => [labels[kind], filename]));
  if (sourceRows.length) sections.push("## Source file changes", detailRows(["Change", "Scan-relative path"], sourceRows));

  const first = dependencyChanges.find(change => change.head) ?? dependencyChanges[0];
  if (first) {
    const graph = first.head ? after : before;
    const edge = first.head ?? first.base!;
    const changedIds = new Set(dependencyChanges.map(change => (first.head ? change.head : change.base)?.id));
    const otherEdges = graph.edges.filter(item => item.id !== edge.id);
    otherEdges.sort((a, b) => Number(changedIds.has(b.id)) - Number(changedIds.has(a.id)));
    return { sections, focus: { graph: { ...graph, edges: [edge, ...otherEdges] }, nodeId: edge.source,
      snapshot: first.head ? "Head" : "Base", change: first.kind } };
  }
  if (assignmentChanges.length) return { sections, focus: { graph: after, nodeId: assignmentChanges[0].head.nodeId, snapshot: "Head" } };
  for (const change of boundaryChanges) {
    const graph = change.head ? after : before;
    const hierarchy = byId(graph.hierarchy);
    const node = graph.nodes.find(item => item.id === change.id) ?? graph.nodes.find(item =>
      item.parentId && (item.parentId === change.id || hierarchy.get(item.parentId)?.parentId === change.id));
    if (node) return { sections, focus: { graph, nodeId: node.id, snapshot: change.head ? "Head" : "Base" } };
  }
  return { sections };
}

export async function writeArchitectureReview(beforePath: string, afterPath: string, outputPath: string, title = "PR architecture review") {
  if (!/\.md$/i.test(outputPath)) throw new Error("Review output must end in .md");
  const reportPath = path.resolve(outputPath);
  const directory = path.dirname(reportPath);
  const [before, after, ...inputFiles] = await Promise.all([
    readArchitectureGraph(beforePath), readArchitectureGraph(afterPath), fs.realpath(beforePath), fs.realpath(afterPath),
  ] as const);
  const { sections, focus } = reviewMarkdown(before, after, title);
  await fs.mkdir(directory, { recursive: true });
  const checkDestination = async (filename: string) => {
    const existing = await fs.realpath(filename).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
    if (existing && inputFiles.includes(existing)) throw new Error("Review output would overwrite an input snapshot");
  };
  await checkDestination(reportPath);
  const staging = await fs.mkdtemp(path.join(directory, ".c4-review-"));
  try {
    let diagram;
    if (focus) {
      const { graph, nodeId, snapshot } = focus;
      const node = graph.nodes.find(item => item.id === nodeId)!;
      const diagramTitle = `${node.label} · ${snapshot} neighborhood`;
      // Snapshot-specific filenames keep published reports valid if runs overlap or a later write fails.
      const digest = createHash("sha256").update(JSON.stringify([diagramTitle, nodeId, graph.metadata.abstractionLevel,
        graph.nodes, graph.edges, graph.hierarchy])).digest("hex").slice(0, 16);
      const stem = `${path.basename(reportPath, path.extname(reportPath))}.focus-${digest}`;
      const rendered = await renderArchitectureGraph(graph, { title: diagramTitle, focus: { nodeId }, outputPath: path.join(staging, `${stem}.md`) });
      const { layout } = rendered.structuredContent;
      const artifacts = rendered.structuredContent.artifacts!;
      const destination = (filename: string) => path.join(directory, path.basename(filename));
      const link = (filename: string) => `<${encodeURIComponent(path.basename(filename))}>`;
      diagram = { markdown: destination(artifacts.markdown), png: destination(artifacts.png),
        svg: destination(artifacts.svg), html: destination(artifacts.html) };
      await Promise.all(Object.values(diagram).map(checkDestination));
      await Promise.all(Object.values(artifacts).map(filename => fs.rename(filename, destination(filename))));
      const capped = "focus" in rendered.structuredContent ? rendered.structuredContent.focus.truncated : undefined;
      sections.push("## Focused diagram", `${snapshot} snapshot · ${text(node.label)} · ${layout.nodeCount} nodes · ${layout.relationshipCount} relationships`
        + (capped?.nodes || capped?.edges ? " · Neighborhood limit reached" : ""),
      ...(focus.change ? [`Follow **R01** for the ${focus.change} dependency that anchors this view.`] : []),
      `![Focused architecture diagram](${link(diagram.png)})`,
      `[Interactive diagram](${link(diagram.html)}) · [SVG](${link(diagram.svg)}) · [Neighborhood source evidence](${link(diagram.markdown)})`);
    }
    const stagedReport = path.join(staging, path.basename(reportPath));
    await fs.writeFile(stagedReport, sections.join("\n\n") + "\n", "utf8");
    await fs.rename(stagedReport, reportPath);
    return { reportPath, ...(diagram ? { diagram } : {}) };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
