import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_SCHEMA_VERSION, stableId, validateArchitectureGraph,
  type AbstractionLevel, type ArchitectureGraph, type ArchitectureNode, type ArchitectureEdge,
  type GraphDiagnostic, type SourceEvidence, type SourceFile,
} from "../model/graph.js";
import { createBoundaryMapper, loadBoundaryConfig, type BoundaryConfig, type BoundaryAssignment } from "../model/config.js";
import { extractSourceFacts, type SourceFacts, type DependencyFact } from "./syntaxFacts.js";
import { createModuleResolver } from "./moduleResolver.js";

// These names remain available to callers of the original parser API.
export type C4Node = ArchitectureNode;
export type C4Edge = ArchitectureEdge;
export type AstGraph = ArchitectureGraph;
export interface AnalyzeOptions {
  /** Explicit JSON boundary configuration, resolved from the process directory. */
  configPath?: string;
  /** Programmatic equivalent of configPath; do not supply both. */
  config?: BoundaryConfig;
  /** Explicit tsconfig.json; otherwise the nearest parent config is used. */
  tsconfigPath?: string;
}

const DATABASE_PACKAGES: Record<string, string> = {
  "@prisma/client": "Prisma", prisma: "Prisma", pg: "PostgreSQL driver", mysql2: "MySQL driver",
  mongoose: "Mongoose", mongodb: "MongoDB driver", redis: "Redis client", ioredis: "Redis client",
  typeorm: "TypeORM", "drizzle-orm": "Drizzle ORM", sqlite3: "SQLite driver", "better-sqlite3": "SQLite driver",
};
const SDK_PACKAGES: Record<string, string> = {
  axios: "Axios HTTP client", "node-fetch": "Fetch client", stripe: "Stripe SDK", openai: "OpenAI SDK",
  "@anthropic-ai/sdk": "Anthropic SDK", "@grpc/grpc-js": "gRPC SDK", ws: "WebSocket client",
  "@modelcontextprotocol/sdk": "MCP SDK",
};
const IGNORE_DIRS = new Set(["node_modules", "dist", "build", "output", "out", "coverage", "vendor", "generated"]);
const slash = (value: string) => value.replace(/\\/g, "/");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const within = (root: string, filename: string) => {
  const relative = path.relative(root, filename);
  return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
};
const isSource = (filename: string) => /\.tsx?$/.test(filename) && !/\.d\.ts$/.test(filename);
const evidenceSort = (a: SourceEvidence, b: SourceEvidence) => compare(a.path, b.path) || a.line - b.line || a.column - b.column || compare(a.kind, b.kind);

interface ScannedFile { absolutePath: string; relativePath: string; facts: SourceFacts; assignment: BoundaryAssignment; nodeId: string }

async function discover(root: string, diagnostics: GraphDiagnostic[]): Promise<{ sources: string[]; manifests: string[] }> {
  const sources: string[] = [], manifests: string[] = [];
  async function walk(directory: string) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      diagnostics.push({ code: "READ_DIRECTORY_ERROR", severity: "error", path: slash(path.relative(root, directory)) || ".",
        message: `Could not enumerate directory: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(directory, entry.name);
      // Never recurse into symlinks, including package-manager workspaces.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(absolutePath);
      } else if (entry.isFile()) {
        if (isSource(entry.name)) sources.push(absolutePath);
        else if (entry.name === "package.json") manifests.push(absolutePath);
      }
    }
  }
  await walk(root);
  return { sources, manifests };
}

function nodeForFile(relativePath: string, assignment: BoundaryAssignment, level: AbstractionLevel): ArchitectureNode {
  const selected = level === "Context" ? assignment.system : level === "Container" ? assignment.container : assignment.component;
  return {
    id: selected?.id ?? stableId("component", relativePath),
    label: selected?.label ?? relativePath,
    type: level === "Context" ? "System" : level === "Container" ? "Container" : "Component",
    technology: selected?.technology ?? (relativePath.endsWith(".tsx") ? "TypeScript / TSX" : "TypeScript"),
    path: level === "Component" && !assignment.component ? relativePath : ".",
    ...(level === "Context" ? {} : { parentId: level === "Container" ? assignment.system.id : assignment.container.id }),
    ...(selected?.description ? { description: selected.description } : {}),
    classification: selected?.classification ?? { basis: "inferred", confidence: "low", rule: "source-file-as-component" },
    exports: [], evidence: [],
  };
}

function relationshipLabel(fact: DependencyFact, external: boolean): string {
  if (fact.typeOnly) return fact.kind === "re-export" ? "Re-exports types" : "Imports types";
  if (fact.kind === "re-export") return "Re-exports module";
  if (fact.kind === "dynamic-import") return "Literal dynamic import";
  if (fact.kind === "require") return "Literal require syntax";
  return external ? "Imports package" : "Imports module";
}

function decodeSource(bytes: Buffer): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  // Strip the BOM for source positions, while hashing the original bytes.
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

/** Build a source-backed, versioned graph. Analysis reads source/configuration
 * data only; it never imports scanned code or executes repository scripts. */
export async function analyzeDirectory(targetDir: string, c4Level: AbstractionLevel, options: AnalyzeOptions = {}): Promise<ArchitectureGraph> {
  if (!["Context", "Container", "Component"].includes(c4Level)) throw new Error(`Unsupported C4 level: ${c4Level}`);
  if (options.config && options.configPath) throw new Error("Supply config or configPath, not both");
  const root = await fs.realpath(path.resolve(targetDir));
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`Analysis target is not a directory: ${targetDir}`);
  const diagnostics: GraphDiagnostic[] = [];
  const configPath = options.configPath ? path.resolve(options.configPath) : undefined;
  const mapper = createBoundaryMapper(root, options.config ?? (configPath ? await loadBoundaryConfig(configPath) : undefined));
  const discovered = await discover(root, diagnostics);
  const resolver = createModuleResolver(root, discovered.manifests, options.tsconfigPath);
  diagnostics.push(...resolver.diagnostics);
  const nodes = new Map<string, ArchitectureNode>(), edges = new Map<string, ArchitectureEdge>();
  const sources: SourceFile[] = [], files = new Map<string, ScannedFile>();
  for (const absolutePath of discovered.sources.filter(filename => !resolver.outputDirectories.some(directory => within(directory, filename)))) {
    const relativePath = slash(path.relative(root, absolutePath));
    let sourceBytes: Buffer;
    try { sourceBytes = await fs.readFile(absolutePath); }
    catch (error) {
      diagnostics.push({ code: "READ_ERROR", severity: "error", path: relativePath,
        message: `Could not read source file: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const isTsx = absolutePath.endsWith(".tsx");
    const sourceRecord = { path: relativePath, contentHash: createHash("sha256").update(sourceBytes).digest("hex"),
      language: isTsx ? "TSX" : "TypeScript" };
    let sourceCode: string;
    try { sourceCode = decodeSource(sourceBytes); }
    catch {
      diagnostics.push({ code: "SOURCE_ENCODING_ERROR", severity: "error", path: relativePath,
        message: "Source is not valid UTF-8 or BOM-marked UTF-16; it could not be parsed." });
      sources.push({ ...sourceRecord, parseStatus: "error" });
      continue;
    }
    let facts: SourceFacts;
    try { facts = extractSourceFacts(sourceCode, relativePath, isTsx); }
    catch (error) {
      diagnostics.push({ code: "PARSER_ERROR", severity: "error", path: relativePath,
        message: `Source parsing failed: ${error instanceof Error ? error.message : String(error)}` });
      sources.push({ ...sourceRecord, parseStatus: "error" });
      continue;
    }
    sources.push({ ...sourceRecord, parseStatus: facts.parseStatus });
    diagnostics.push(...facts.diagnostics);
    const assignment = mapper.forFile(relativePath);
    const selected = nodeForFile(relativePath, assignment, c4Level);
    const existing = nodes.get(selected.id);
    if (existing && existing.parentId !== selected.parentId) {
      throw new Error(`Component ${selected.id} spans multiple container boundaries; configure distinct components or an explicit containerId`);
    }
    const node = existing ?? selected;
    node.evidence.push({ path: relativePath, line: 1, column: 1, kind: "source-file" });
    node.exports!.push(...facts.exports);
    node.evidence.push(...facts.exportEvidence);
    nodes.set(node.id, node);
    files.set(absolutePath, { absolutePath, relativePath, facts, assignment, nodeId: node.id });
  }
  diagnostics.push(...mapper.diagnostics);
  if (c4Level === "Component" && new Set([...files.values()].map(file => file.assignment.container.id)).size > 1) {
    diagnostics.push({ code: "MULTIPLE_COMPONENT_CONTAINERS", severity: "info",
      message: "Component view spans multiple declared containers; parent boundary IDs retain their deployment grouping." });
  }
  function diagnostic(fact: DependencyFact, code: string, severity: GraphDiagnostic["severity"], message: string) {
    diagnostics.push({ code, severity, message, path: fact.evidence.path, line: fact.evidence.line, column: fact.evidence.column, specifier: fact.specifier });
  }
  function connect(source: string, target: string, fact: DependencyFact, external: boolean) {
    if (source === target) return; // Rolled-up boundaries intentionally hide their internal relationships.
    const kind = fact.typeOnly && fact.kind === "re-export" ? "type-re-export" : fact.kind;
    const id = stableId("relationship", `${source}\0${target}\0${kind}\0${fact.specifier}`);
    const edge = edges.get(id) ?? { id, source, target, label: relationshipLabel(fact, external), protocol: "unknown", kind, evidence: [] };
    edge.evidence.push(fact.evidence);
    edges.set(id, edge);
  }
  for (const file of files.values()) {
    for (const fact of file.facts.dependencies) {
      const resolved = resolver.resolve(fact.specifier, file.absolutePath, fact.kind, fact.resolutionMode);
      const targetFile = resolved.resolvedPath ? files.get(resolved.resolvedPath) : undefined;
      if (targetFile) { connect(file.nodeId, targetFile.nodeId, fact, false); continue; }
      if (resolved.localAsset) {
        diagnostic(fact, "UNSUPPORTED_MODULE_TYPE", "warning", "Module specifier names an existing local asset outside supported TypeScript/TSX source; no dependency node was fabricated.");
        continue;
      }
      if (resolved.builtin) {
        diagnostic(fact, "BUILTIN_MODULE", "info", "Observed a platform built-in import; a built-in library is not inferred to be an external system.");
        continue;
      }
      if (resolved.resolvedPath && within(root, resolved.resolvedPath) && !resolved.resolvedPath.split(path.sep).includes("node_modules")) {
        diagnostic(fact, isSource(resolved.resolvedPath) ? "EXCLUDED_SOURCE_TARGET" : "UNSUPPORTED_MODULE_TYPE", "warning",
          "Resolved module is not among the parsed source files (excluded scope, declaration file, or unsupported language); no dependency node was fabricated.");
        continue;
      }
      if (resolved.resolvedPath && !resolved.externalPackage) {
        diagnostic(fact, "OUTSIDE_SCAN_SCOPE", "warning", "Resolved local module is outside the scan scope; expand the scan root to include its source.");
        continue;
      }
      if (!resolved.packageName || resolved.localSpecifier) {
        diagnostic(fact, "UNRESOLVED_IMPORT", "warning", "Module could not be resolved by the TypeScript resolver; no dependency target was guessed.");
        continue;
      }
      const name = resolved.packageName;
      const databaseTechnology = Object.hasOwn(DATABASE_PACKAGES, name) ? DATABASE_PACKAGES[name] : undefined;
      const sdkTechnology = Object.hasOwn(SDK_PACKAGES, name) ? SDK_PACKAGES[name] : undefined;
      const technology = databaseTechnology ?? sdkTechnology ?? (name.startsWith("@aws-sdk/") ? "AWS SDK" : "Package dependency");
      const database = databaseTechnology !== undefined;
      const sdk = sdkTechnology !== undefined || name.startsWith("@aws-sdk/");
      const id = stableId("package", name);
      const node = nodes.get(id) ?? {
        id, label: database ? `${name} database integration (inferred)` : sdk ? `${name} integration (inferred)` : `Package: ${name}`,
        type: database && c4Level !== "Context" ? "ContainerDb" as const : "ExternalSystem" as const, technology, path: `package:${name}`,
        description: "Observed package reference. External system/database placement is an inference; deployment, runtime use and protocol are unknown.",
        classification: { basis: "inferred" as const, confidence: "low" as const, rule: database ? "known-database-package" : sdk ? "known-sdk-package" : "package-as-external-dependency" },
        evidence: [],
      };
      node.evidence.push(fact.evidence);
      nodes.set(id, node);
      connect(file.nodeId, id, fact, true);
      if (!resolved.resolvedPath) diagnostic(fact, "UNRESOLVED_PACKAGE", "warning", "Package reference was observed but no installed module target was resolved; package boundary classification remains an inference.");
    }
  }
  for (const node of nodes.values()) {
    if (node.exports) node.exports = [...new Set(node.exports)].sort(compare);
    node.evidence.sort(evidenceSort);
  }
  for (const edge of edges.values()) edge.evidence.sort(evidenceSort);
  diagnostics.sort((a, b) => compare(a.path ?? "", b.path ?? "") || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || compare(a.code, b.code));
  return validateArchitectureGraph({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    metadata: { scannedDirectory: root, abstractionLevel: c4Level, filesScanned: sources.length, timestamp: new Date().toISOString(),
      analysisStatus: diagnostics.some(item => item.severity !== "info") || sources.some(source => source.parseStatus !== "complete") ? "partial" : "complete",
      ...(configPath ? { configPath } : {}), ...(resolver.configPath ? { tsconfigPath: resolver.configPath } : {}) },
    nodes: [...nodes.values()].sort((a, b) => compare(a.id, b.id)), edges: [...edges.values()].sort((a, b) => compare(a.id, b.id)),
    hierarchy: mapper.hierarchy.sort((a, b) => compare(a.id, b.id)), sources: sources.sort((a, b) => compare(a.path, b.path)), diagnostics,
  });
}
