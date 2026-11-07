import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const GRAPH_SCHEMA_VERSION = "1.0" as const;
export type AbstractionLevel = "Context" | "Container" | "Component";
export type ArchitectureNodeType = "System" | "ExternalSystem" | "Container" | "ContainerDb" | "Component";
export interface Classification {
  basis: "observed" | "inferred" | "declared";
  rule?: string;
  confidence?: "low" | "medium" | "high";
}
export interface SourceEvidence {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  kind: string;
  specifier?: string;
  typeOnly?: boolean;
  detail?: string;
}
export interface GraphDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  line?: number;
  column?: number;
  specifier?: string;
}
export interface SourceFile {
  path: string;
  contentHash: string;
  parseStatus: "complete" | "partial" | "error";
  language?: string;
}
export interface Boundary {
  id: string;
  label: string;
  type: "System" | "Container";
  parentId?: string;
  technology?: string;
  description?: string;
  classification: Classification;
}
export interface ArchitectureNode {
  id: string;
  label: string;
  type: ArchitectureNodeType;
  technology: string;
  path: string;
  exports?: string[];
  parentId?: string;
  description?: string;
  classification: Classification;
  evidence: SourceEvidence[];
}
export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  protocol: string;
  kind: string;
  evidence: SourceEvidence[];
}
export interface ArchitectureGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  metadata: {
    scannedDirectory: string;
    abstractionLevel: AbstractionLevel;
    filesScanned: number;
    timestamp: string;
    analysisStatus: "complete" | "partial";
    configPath?: string;
    commit?: string;
    [key: string]: unknown;
  };
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  hierarchy: Boundary[];
  sources: SourceFile[];
  diagnostics: GraphDiagnostic[];
}

const nonempty = z.string().min(1);
const identifier = nonempty.max(256);
const relativePath = nonempty.refine(value => !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)
  && !value.replace(/\\/g, "/").split("/").includes(".."), "Must be a path relative to the scan root");
const classificationSchema = z.object({
  basis: z.enum(["observed", "inferred", "declared"]), rule: nonempty.optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
}).passthrough();
const evidenceSchema = z.object({
  path: relativePath, line: z.number().int().min(1), column: z.number().int().min(1),
  endLine: z.number().int().min(1).optional(), endColumn: z.number().int().min(1).optional(),
  kind: nonempty, specifier: z.string().optional(), typeOnly: z.boolean().optional(), detail: z.string().optional(),
}).passthrough();
export const architectureGraphSchema = z.object({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  metadata: z.object({
    scannedDirectory: nonempty, abstractionLevel: z.enum(["Context", "Container", "Component"]),
    filesScanned: z.number().int().nonnegative(), timestamp: z.string().datetime({ offset: true }),
    analysisStatus: z.enum(["complete", "partial"]), configPath: nonempty.optional(), commit: nonempty.optional(),
  }).passthrough(),
  nodes: z.array(z.object({
    id: identifier, label: nonempty, type: z.enum(["System", "ExternalSystem", "Container", "ContainerDb", "Component"]),
    technology: nonempty, path: nonempty, exports: z.array(z.string()).optional(), parentId: identifier.optional(),
    description: z.string().optional(), classification: classificationSchema, evidence: z.array(evidenceSchema),
  }).passthrough()),
  edges: z.array(z.object({
    id: identifier, source: identifier, target: identifier, label: nonempty, protocol: nonempty,
    kind: nonempty, evidence: z.array(evidenceSchema).min(1),
  }).passthrough()),
  hierarchy: z.array(z.object({
    id: identifier, label: nonempty, type: z.enum(["System", "Container"]), parentId: identifier.optional(),
    technology: z.string().optional(), description: z.string().optional(), classification: classificationSchema,
  }).passthrough()),
  sources: z.array(z.object({
    path: relativePath, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    parseStatus: z.enum(["complete", "partial", "error"]), language: z.string().optional(),
  }).passthrough()),
  diagnostics: z.array(z.object({
    code: nonempty, severity: z.enum(["info", "warning", "error"]), message: nonempty,
    path: z.string().optional(), line: z.number().int().min(1).optional(), column: z.number().int().min(1).optional(),
    specifier: z.string().optional(),
  }).passthrough()),
}).passthrough();

/** Stable across scans/clones of the same scan-relative key; punctuation is not collapsed. */
export function stableId(kind: string, key: string): string {
  const prefix = kind.replace(/[^a-zA-Z0-9_]/g, "_") || "element";
  const digest = createHash("sha256").update(JSON.stringify([kind, key.replace(/\\/g, "/")])).digest("hex").slice(0, 20);
  return `${prefix}_${digest}`;
}

export function validateArchitectureGraph(input: unknown): ArchitectureGraph {
  const result = architectureGraphSchema.safeParse(input);
  if (!result.success) {
    const messages = result.error.issues.slice(0, 8).map(issue => `${issue.path.join(".") || "graph"}: ${issue.message}`);
    throw new Error(`Invalid architecture graph: ${messages.join("; ")}`);
  }
  const graph = result.data as ArchitectureGraph;
  const unique = <T>(items: T[], key: (item: T) => string, name: string) => {
    const found = new Map<string, T>();
    for (const item of items) {
      const id = key(item);
      if (found.has(id)) throw new Error(`Duplicate ${name}: ${id}`);
      found.set(id, item);
    }
    return found;
  };
  const nodes = unique(graph.nodes, node => node.id, "node ID");
  unique(graph.edges, edge => edge.id, "edge ID");
  const boundaries = unique(graph.hierarchy, boundary => boundary.id, "boundary ID");
  const sourceKey = (filename: string) => filename.replace(/\\/g, "/").replace(/^\.\//, "");
  const sources = unique(graph.sources, source => sourceKey(source.path), "source path");
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error(`Edge ${edge.id} references an unknown node`);
  }
  const parents = new Map<string, { id: string; type: string; parentId?: string }>([...boundaries, ...nodes]);
  for (const node of graph.nodes) {
    const boundary = boundaries.get(node.id);
    if (boundary && boundary.type !== node.type) throw new Error(`Conflicting type for boundary/node ${node.id}`);
    if (boundary && boundary.parentId !== node.parentId) throw new Error(`Conflicting parent for boundary/node ${node.id}`);
    if (node.classification.basis === "observed" && node.evidence.length === 0) throw new Error(`Observed node ${node.id} requires source evidence`);
  }
  for (const element of [...graph.hierarchy, ...graph.nodes]) {
    if (element.parentId && !parents.has(element.parentId)) throw new Error(`Unknown parent ${element.parentId} for ${element.id}`);
    if (element.parentId) {
      const parent = parents.get(element.parentId)!;
      if (element.type === "System" || element.type === "ExternalSystem") throw new Error(`System ${element.id} must not have a parent`);
      if (element.type === "Component" && parent.type !== "Container") throw new Error(`Component ${element.id} must belong to a Container`);
      if ((element.type === "Container" || element.type === "ContainerDb") && parent.type !== "System") throw new Error(`Container ${element.id} must belong to a System`);
    }
    const seen = new Set<string>([element.id]);
    let next = element.parentId;
    while (next) {
      if (seen.has(next)) throw new Error(`Parent hierarchy contains a cycle at ${next}`);
      seen.add(next);
      next = parents.get(next)?.parentId;
    }
  }
  for (const evidence of [...graph.nodes.flatMap(node => node.evidence), ...graph.edges.flatMap(edge => edge.evidence)]) {
    if (!sources.has(sourceKey(evidence.path))) throw new Error(`Evidence in ${evidence.path} references an unknown source record`);
    if ((evidence.endLine ?? evidence.line) < evidence.line
      || ((evidence.endLine ?? evidence.line) === evidence.line && evidence.endColumn !== undefined && evidence.endColumn < evidence.column)) {
      throw new Error(`Evidence end position precedes its start in ${evidence.path}`);
    }
  }
  if (graph.metadata.filesScanned !== graph.sources.length) throw new Error("filesScanned must equal the number of source records");
  if (graph.metadata.analysisStatus === "complete" && (graph.sources.some(source => source.parseStatus !== "complete")
    || graph.diagnostics.some(diagnostic => diagnostic.severity === "error"))) {
    throw new Error("Incomplete parsing or error diagnostics require analysisStatus 'partial'");
  }
  return graph;
}
export const validateGraph = validateArchitectureGraph;

export async function readArchitectureGraph(filename: string): Promise<ArchitectureGraph> {
  return validateArchitectureGraph(JSON.parse(await fs.readFile(filename, "utf8")));
}
export async function writeArchitectureGraph(filename: string, graph: ArchitectureGraph): Promise<void> {
  await fs.writeFile(filename, JSON.stringify(validateArchitectureGraph(graph), null, 2) + "\n", "utf8");
}
export const readGraph = readArchitectureGraph;
export const writeGraph = writeArchitectureGraph;

const increment = (counts: Record<string, number>, key: string) => {
  Object.defineProperty(counts, key, { value: (Object.hasOwn(counts, key) ? counts[key]! : 0) + 1,
    writable: true, enumerable: true, configurable: true });
};
export function summarizeArchitectureGraph(input: ArchitectureGraph) {
  const graph = validateArchitectureGraph(input);
  const nodesByType: Record<string, number> = {}, edgesByKind: Record<string, number> = {};
  const classifications: Record<string, number> = {}, diagnosticsBySeverity: Record<string, number> = {};
  for (const node of graph.nodes) { increment(nodesByType, node.type); increment(classifications, node.classification.basis); }
  for (const edge of graph.edges) increment(edgesByKind, edge.kind);
  for (const diagnostic of graph.diagnostics) increment(diagnosticsBySeverity, diagnostic.severity);
  // Kinds may be extended by future parsers; one summary must still have a fixed context budget.
  const kindCounts = Object.entries(edgesByKind).sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b));
  const visibleKinds = kindCounts.filter(([kind], index) => index < 24 && kind.length <= 80);
  const omittedKinds = kindCounts.filter(([kind], index) => index >= 24 || kind.length > 80);
  return { schemaVersion: graph.schemaVersion, abstractionLevel: graph.metadata.abstractionLevel,
    analysisStatus: graph.metadata.analysisStatus, counts: { nodes: graph.nodes.length, edges: graph.edges.length,
      boundaries: graph.hierarchy.length, sources: graph.sources.length, diagnostics: graph.diagnostics.length },
    nodesByType, edgesByKind: Object.fromEntries(visibleKinds),
    otherEdgeKinds: omittedKinds.reduce((total, [, count]) => total + count, 0),
    classifications, diagnosticsBySeverity };
}
export const summarizeGraph = summarizeArchitectureGraph;

export interface GraphQueryOptions {
  nodeId?: string;
  search?: string;
  direction?: "incoming" | "outgoing" | "both";
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
  includeEvidence?: boolean;
  maxBytes?: number;
}
const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) => {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return selected;
};
const short = (value: string | undefined, length = 300) => value === undefined ? undefined : value.length > length ? `${value.slice(0, length - 1)}…` : value;
const smallEvidence = (items: SourceEvidence[]) => items.slice(0, 3).map(item => ({
  path: short(item.path, 256), line: item.line, column: item.column, kind: short(item.kind, 40),
  ...(item.specifier ? { specifier: short(item.specifier, 160) } : {}), ...(item.typeOnly === undefined ? {} : { typeOnly: item.typeOnly }),
}));

export function queryArchitectureGraph(input: ArchitectureGraph, options: GraphQueryOptions = {}) {
  const graph = validateArchitectureGraph(input);
  const maxDepth = bounded(options.maxDepth, 1, 0, 5, "maxDepth");
  const maxNodes = bounded(options.maxNodes, 25, 1, 100, "maxNodes");
  const maxEdges = bounded(options.maxEdges, 50, 0, 200, "maxEdges");
  const maxBytes = bounded(options.maxBytes, 16000, 2048, 64000, "maxBytes");
  const direction = options.direction ?? "both";
  if (!["incoming", "outgoing", "both"].includes(direction)) throw new Error("Unknown query direction");
  if (options.nodeId && !graph.nodes.some(node => node.id === options.nodeId)) throw new Error(`Unknown node ID: ${options.nodeId}`);
  const all = [...graph.nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const search = options.search?.toLowerCase();
  const seeds = all.filter(node => options.nodeId ? node.id === options.nodeId
    : !search || `${node.id}\n${node.label}\n${node.path}`.toLowerCase().includes(search));
  const selected = new Map(seeds.slice(0, maxNodes).map(node => [node.id, 0]));
  const traversed = new Set<string>();
  const truncated = { nodes: seeds.length > maxNodes, edges: false, bytes: false, evidence: false };
  if (options.nodeId || search) {
    const queue = [...selected.keys()];
    while (queue.length) {
      const id = queue.shift()!, depth = selected.get(id)!;
      if (depth >= maxDepth) continue;
      for (const edge of graph.edges) {
        const neighbor = edge.source === id && direction !== "incoming" ? edge.target
          : edge.target === id && direction !== "outgoing" ? edge.source : undefined;
        if (!neighbor) continue;
        if (!selected.has(neighbor)) {
          if (selected.size >= maxNodes) { truncated.nodes = true; continue; }
          selected.set(neighbor, depth + 1); queue.push(neighbor);
        }
        traversed.add(edge.id);
      }
    }
  }
  const selectedEdges = graph.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)
    && (!(options.nodeId || search) || traversed.has(edge.id))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  truncated.edges = selectedEdges.length > maxEdges;
  const nodeLookup = new Map(all.map(node => [node.id, node]));
  const nodes = [...selected.keys()].map(id => nodeLookup.get(id)!).map(node => ({
    id: node.id, label: short(node.label)!, type: node.type, path: short(node.path, 256)!,
    technology: short(node.technology, 160)!, parentId: node.parentId,
    classification: { basis: node.classification.basis, confidence: node.classification.confidence, rule: short(node.classification.rule, 160) },
    ...(options.includeEvidence ? { evidence: smallEvidence(node.evidence) } : {}),
  }));
  const edges = selectedEdges.slice(0, maxEdges).map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, label: short(edge.label)!,
    kind: short(edge.kind, 40)!, protocol: short(edge.protocol, 100)!,
    ...(options.includeEvidence ? { evidence: smallEvidence(edge.evidence) } : {}),
  }));
  truncated.evidence = Boolean(options.includeEvidence && (all.some(node => selected.has(node.id) && node.evidence.length > 3)
    || selectedEdges.slice(0, maxEdges).some(edge => edge.evidence.length > 3)));
  const result = { graphVersion: graph.schemaVersion, totals: { nodes: graph.nodes.length, edges: graph.edges.length },
    limits: { maxDepth, maxNodes, maxEdges, maxBytes }, nodes, edges, truncated };
  while (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    truncated.bytes = true;
    if (edges.length) { edges.pop(); truncated.edges = true; }
    else if (nodes.length > 1) { nodes.pop(); truncated.nodes = true; }
    else if (nodes[0]) {
      // A tiny budget still returns a useful identity without dumping provenance.
      const node = nodes[0];
      node.label = short(node.label, 100)!; node.path = short(node.path, 100)!; node.technology = short(node.technology, 60)!;
      if ("evidence" in node) { delete node.evidence; truncated.evidence = true; }
      if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) { nodes.pop(); truncated.nodes = true; }
    } else break;
  }
  const surviving = new Set(nodes.map(node => node.id));
  result.edges = edges.filter(edge => surviving.has(edge.source) && surviving.has(edge.target));
  return result;
}
export const queryGraph = queryArchitectureGraph;

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))) : item);

function labelForComparison(element: ArchitectureNode | Boundary, scanDirectory: string): string | undefined {
  if (element.type !== "System" || element.classification.basis !== "inferred"
    || element.classification.rule !== "default-scan-scope-boundary") return element.label;
  const localPath = path.win32.isAbsolute(scanDirectory) && !path.posix.isAbsolute(scanDirectory) ? path.win32 : path.posix;
  const generatedLabel = localPath.basename(scanDirectory) || "Scanned system";
  return element.label === generatedLabel ? undefined : element.label;
}

const nodeSemantics = (node: ArchitectureNode, scanDirectory: string) => ({ id: node.id, label: labelForComparison(node, scanDirectory), type: node.type, technology: node.technology,
  path: node.path, exports: [...(node.exports ?? [])].sort(), parentId: node.parentId, description: node.description, classification: node.classification });
const edgeSemantics = (edge: ArchitectureEdge) => ({ source: edge.source, target: edge.target,
  label: edge.label, protocol: edge.protocol, kind: edge.kind });

function reconcileUnmatchedEdges(before: ArchitectureEdge[], after: ArchitectureEdge[]): ArchitectureEdge[] {
  const beforeIds = new Set(before.map(edge => edge.id));
  const afterIds = new Set(after.map(edge => edge.id));
  const unmatchedByDependency = new Map<string, string[]>();
  for (const edge of before) {
    if (afterIds.has(edge.id)) continue;
    const key = JSON.stringify(edgeSemantics(edge));
    const ids = unmatchedByDependency.get(key) ?? [];
    ids.push(edge.id);
    unmatchedByDependency.set(key, ids);
  }
  for (const ids of unmatchedByDependency.values()) ids.sort().reverse();

  // Existing IDs take precedence. Pair leftover equivalent dependencies once
  // each so a specifier spelling change does not hide a parallel edge change.
  return [...after].sort((left, right) => left.id.localeCompare(right.id)).map(edge => {
    if (beforeIds.has(edge.id)) return edge;
    const previousId = unmatchedByDependency.get(JSON.stringify(edgeSemantics(edge)))?.pop();
    return previousId === undefined ? edge : { ...edge, id: previousId };
  });
}

export function compareArchitectureGraphs(beforeInput: ArchitectureGraph, afterInput: ArchitectureGraph, options: { limit?: number; maxBytes?: number } = {}) {
  const before = validateArchitectureGraph(beforeInput), after = validateArchitectureGraph(afterInput);
  if (before.metadata.abstractionLevel !== after.metadata.abstractionLevel) throw new Error("Compare graphs at the same abstraction level");
  const limit = bounded(options.limit, 50, 1, 100, "limit"), maxBytes = bounded(options.maxBytes, 16000, 2048, 64000, "maxBytes");
  const compare = <T>(left: T[], right: T[], key: (item: T) => string, value: (item: T, scanDirectory: string) => unknown) => {
    const previous = new Map(left.map(item => [key(item), item])), next = new Map(right.map(item => [key(item), item]));
    const added = [...next.keys()].filter(id => !previous.has(id)).sort();
    const removed = [...previous.keys()].filter(id => !next.has(id)).sort();
    const changed = [...next.keys()].filter(id => previous.has(id)
      && canonical(value(previous.get(id)!, before.metadata.scannedDirectory)) !== canonical(value(next.get(id)!, after.metadata.scannedDirectory))).sort();
    return { counts: { added: added.length, removed: removed.length, changed: changed.length },
      added: added.slice(0, limit), removed: removed.slice(0, limit), changed: changed.slice(0, limit) };
  };
  const result = {
    graphVersion: before.schemaVersion, abstractionLevel: before.metadata.abstractionLevel,
    nodes: compare(before.nodes, after.nodes, node => node.id, nodeSemantics),
    edges: compare(before.edges, reconcileUnmatchedEdges(before.edges, after.edges), edge => edge.id, edgeSemantics),
    hierarchy: compare(before.hierarchy, after.hierarchy, boundary => boundary.id,
      (boundary, scanDirectory) => ({ ...boundary, label: labelForComparison(boundary, scanDirectory) })),
    sources: compare(before.sources, after.sources, source => source.path, source => source),
    truncated: false,
  };
  const categories = [result.nodes, result.edges, result.hierarchy, result.sources];
  result.truncated = categories.some(category => Object.entries(category.counts).some(([key, count]) => count > category[key as "added" | "removed" | "changed"].length));
  while (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    result.truncated = true;
    const arrays = categories.flatMap(category => [category.added, category.removed, category.changed]);
    const longest = arrays.sort((a, b) => b.length - a.length)[0];
    if (!longest.length) break;
    longest.pop();
  }
  return result;
}
export const compareGraphs = compareArchitectureGraphs;
