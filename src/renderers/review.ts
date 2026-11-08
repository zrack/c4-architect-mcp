import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { diffArchitectureGraphs, readArchitectureGraph, type ArchitectureEdge, type ArchitectureGraph, type ArchitectureNode,
  type GraphDiagnostic } from "../model/graph.js";
import { renderArchitectureGraph } from "./artifacts.js";

const rowLimit = 25;
const changes = ["added", "removed", "changed"] as const;
const labels = { added: "Added", removed: "Removed", changed: "Changed" };
const byId = <T extends { id: string }>(items: T[]) => new Map(items.map(item => [item.id, item]));
const unresolvedCodes = new Set(["UNRESOLVED_IMPORT", "UNRESOLVED_PACKAGE"]);
type Cell = string | { markdown: string };
type SourceLink = (filename: string, line?: number) => string;
type ReviewSourceLinks = { repository: string; sourceRoot?: string };
type SnapshotLinks = { base: SourceLink; head: SourceLink };
type Declaration = Pick<ArchitectureNode, "id" | "type" | "label" | "parentId" | "description" | "technologyBasis">
  & { technology?: string };

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]|~]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function table(header: string[], rows: Cell[][]): string {
  return [header.join(" | "), header.map(() => "---").join(" | "),
    ...rows.map(row => row.map(cell => typeof cell === "string" ? text(cell) : cell.markdown).join(" | "))]
    .map(line => `| ${line} |`).join("\n");
}

function repositoryPath(value: string, label: string, allowRoot = false): string[] {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(segment => segment && segment !== ".");
  if (!value.trim() || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || /[\u0000-\u001f\u007f]/.test(value)
    || segments.includes("..") || (!allowRoot && !segments.length)) {
    throw new Error(`${label} must be a repository-relative path without parent traversal or control characters`);
  }
  return segments.map(segment => encodeURIComponent(segment)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`));
}

function githubLinks(before: ArchitectureGraph, after: ArchitectureGraph, options: ReviewSourceLinks): SnapshotLinks {
  const [owner, repository, ...extra] = options.repository.split("/");
  if (!owner || owner.length > 39 || !/^[a-z\d]+(?:-[a-z\d]+)*$/i.test(owner) || !repository
    || !/^[a-z\d_.-]{1,100}$/i.test(repository) || repository === "." || repository === ".." || extra.length) {
    throw new Error("GitHub repository must be in OWNER/REPO form");
  }
  const root = repositoryPath(options.sourceRoot ?? ".", "Source root", true);
  const pinned = (commit: string | undefined, snapshot: string): SourceLink => {
    if (!commit || !/^[a-f\d]{40}$/i.test(commit)) throw new Error(`${snapshot} snapshot requires a full 40-hex commit for GitHub source links`);
    const prefix = `https://github.com/${owner}/${repository}/blob/${commit.toLowerCase()}/`;
    return (filename, line) => prefix + [...root, ...repositoryPath(filename, "Source evidence path")].join("/")
      + (line === undefined ? "" : `#L${line}`);
  };
  return { base: pinned(before.metadata.commit, "Base"), head: pinned(after.metadata.commit, "Head") };
}

function declarations(graph: ArchitectureGraph) {
  // Context and Container views also represent some declarations as nodes.
  // Prefer the hierarchy record and ignore exports and source evidence.
  return byId([...graph.nodes, ...graph.hierarchy].filter(item => item.classification.basis === "declared")
    .map((item): Declaration => {
      const { id, type, label, parentId, technology, description } = item;
      return { id, type, label, parentId, technology, description,
        technologyBasis: "path" in item ? item.technologyBasis : "declared" };
    }));
}

function comparableDeclaration({ technology, technologyBasis, ...fields }: Declaration, preserveRecorded: boolean) {
  return { ...fields, technology: preserveRecorded || technologyBasis !== "inferred" ? technology : undefined };
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

function unresolvedDiagnostics(graph: ArchitectureGraph) {
  return graph.diagnostics.filter(item => item.severity !== "info" && unresolvedCodes.has(item.code));
}

function prioritizeUnresolved(items: GraphDiagnostic[], other: GraphDiagnostic[]) {
  const key = (item: GraphDiagnostic) => JSON.stringify([item.code, item.path?.replace(/\\/g, "/").replace(/^\.\//, ""), item.specifier]);
  const remaining = new Map<string, number>();
  for (const item of other) {
    const identity = key(item);
    remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
  }
  const changed: GraphDiagnostic[] = [], common: GraphDiagnostic[] = [];
  for (const item of items) {
    const identity = key(item);
    const count = remaining.get(identity) ?? 0;
    if (count) {
      remaining.set(identity, count - 1);
      common.push(item);
    } else changed.push(item);
  }
  return [...changed, ...common].slice(0, rowLimit);
}

function edgeLabel(edge: ArchitectureEdge, nodes: Map<string, ArchitectureGraph["nodes"][number]>) {
  return `${nodes.get(edge.source)!.label} → ${nodes.get(edge.target)!.label} · ${edge.label} (${edge.kind})`
    + (edge.protocol === "unknown" ? "" : ` · ${edge.protocol}`);
}

function sourceEvidence(item: Pick<GraphDiagnostic, "path" | "line" | "column" | "specifier">, link?: SourceLink) {
  const specifier = item.specifier ? text(item.specifier) : "";
  if (!item.path) return specifier || "—";
  const position = item.line === undefined ? item.path
    : `${item.path}:${item.line}${item.column === undefined ? "" : `:${item.column}`}`;
  const label = text(position);
  const location = link ? `[${label}](<${link(item.path, item.line)}>)` : label;
  return location + (specifier ? ` (${specifier})` : "");
}

function evidence(edge: ArchitectureEdge, link?: SourceLink) {
  const locations = edge.evidence.slice(0, 3).map(item => sourceEvidence(item, link));
  if (edge.evidence.length > locations.length) locations.push(`+${edge.evidence.length - locations.length} more in the saved graph`);
  return locations.join(" · ");
}

function detailRows(header: string[], rows: Cell[][]) {
  return table(header, rows.slice(0, rowLimit)) + (rows.length > rowLimit
    ? `\n\n${rows.length - rowLimit} more rows are available in the saved graph comparison.` : "");
}

function reviewMarkdown(before: ArchitectureGraph, after: ArchitectureGraph, title: string, links?: SnapshotLinks) {
  const diff = diffArchitectureGraphs(before, after);
  const beforeNodes = byId(before.nodes), afterNodes = byId(after.nodes);
  const beforeEdges = byId(before.edges), afterEdges = byId(after.edges);
  const dependencyChanges = changes.flatMap(kind => diff.edges[kind].map(id => ({ kind,
    base: kind === "added" ? undefined : beforeEdges.get(id)!,
    head: kind === "removed" ? undefined : afterEdges.get(id)!,
  })));
  const baseDeclarations = declarations(before), headDeclarations = declarations(after);
  const boundaryChanges = [...new Set([...baseDeclarations.keys(), ...headDeclarations.keys()])].sort().flatMap(id => {
    const previous = baseDeclarations.get(id), next = headDeclarations.get(id);
    // Older snapshots recorded a technology label without its source. Compare the recorded values in a mixed pair.
    const legacy = Boolean(previous && next && (previous.technologyBasis === undefined || next.technologyBasis === undefined));
    const base = previous && comparableDeclaration(previous, legacy), head = next && comparableDeclaration(next, legacy);
    const ambiguousTechnology = legacy && base?.technology !== head?.technology;
    return JSON.stringify(base) === JSON.stringify(head) ? [] : [{ id, base, head, ambiguousTechnology }];
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

  const baseUnresolved = unresolvedDiagnostics(before), headUnresolved = unresolvedDiagnostics(after);
  if (baseUnresolved.length || headUnresolved.length) {
    const baseRows = prioritizeUnresolved(baseUnresolved, headUnresolved);
    const headRows = prioritizeUnresolved(headUnresolved, baseUnresolved);
    const rows = (snapshot: string, items: GraphDiagnostic[], link?: SourceLink): Cell[][] => items.map(item =>
      [snapshot, item.code, { markdown: sourceEvidence(item, link) }]);
    sections.push("## Unresolved import locations", table(["Snapshot", "Diagnostic", "Source evidence"], [
      ...rows("Base", baseRows, links?.base), ...rows("Head", headRows, links?.head),
    ]));
    const omitted = baseUnresolved.length + headUnresolved.length - baseRows.length - headRows.length;
    if (omitted) sections.push(`${omitted} more unresolved locations are available in the saved graphs.`);
  }

  if (dependencyChanges.length) sections.push("## Dependency changes", detailRows(["Change", "Relationship", "Source evidence"],
    dependencyChanges.map(({ kind, base, head }) => [labels[kind],
      [base && edgeLabel(base, beforeNodes), head && edgeLabel(head, afterNodes)].filter(Boolean).join(" → "),
      { markdown: [base && `Base · ${evidence(base, links?.base)}`, head && `Head · ${evidence(head, links?.head)}`].filter(Boolean).join(" · ") },
    ])));
  if (boundaryRows.length) {
    sections.push("## Declared boundary changes", detailRows(["Change", "Boundary ID", "Base", "Head"], boundaryRows));
    if (boundaryChanges.some(item => item.ambiguousTechnology)) {
      sections.push("Technology provenance unavailable for some legacy records. The comparison uses their recorded values.");
    }
  }
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

export async function writeArchitectureReview(beforePath: string, afterPath: string, outputPath: string,
  title = "PR architecture review", sourceLinks?: ReviewSourceLinks) {
  if (!/\.md$/i.test(outputPath)) throw new Error("Review output must end in .md");
  const reportPath = path.resolve(outputPath);
  const directory = path.dirname(reportPath);
  const [before, after, ...inputFiles] = await Promise.all([
    readArchitectureGraph(beforePath), readArchitectureGraph(afterPath), fs.realpath(beforePath), fs.realpath(afterPath),
  ] as const);
  const links = sourceLinks && githubLinks(before, after, sourceLinks);
  const { sections, focus } = reviewMarkdown(before, after, title, links);
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
