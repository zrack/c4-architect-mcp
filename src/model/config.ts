import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { stableId, type Boundary, type Classification, type GraphDiagnostic } from "./graph.js";

interface NamedBoundary { id: string; label: string; technology?: string; description?: string }
export interface BoundaryConfig {
  schemaVersion: "1.0";
  system?: Omit<NamedBoundary, "technology">;
  defaultContainer?: NamedBoundary;
  containers?: Array<NamedBoundary & { paths: string[] }>;
  components?: Array<NamedBoundary & { paths: string[]; containerId?: string }>;
}
export interface ComponentMapping extends NamedBoundary { classification: Classification }
export interface BoundaryAssignment { system: Boundary; container: Boundary; component?: ComponentMapping }
export interface BoundaryMapper {
  readonly hierarchy: Boundary[];
  diagnostics: GraphDiagnostic[];
  forFile(relativePath: string): BoundaryAssignment;
}

const id = z.string().max(128).regex(/^[A-Za-z][A-Za-z0-9._-]*$/, "IDs must start with a letter and contain only letters, digits, dot, dash, or underscore");
const label = z.string().trim().min(1);
const sourcePath = z.string().min(1).refine(value => !path.posix.isAbsolute(value.replace(/\\/g, "/"))
  && !/^[A-Za-z]:/.test(value) && !value.replace(/\\/g, "/").split("/").includes("..")
  && !/[?*\[\]{}]/.test(value), "Use a literal file/directory path relative to the scan root, without globs or '..'");
const named = z.object({ id, label, technology: z.string().optional(), description: z.string().optional() }).strict();
export const boundaryConfigSchema = z.object({
  schemaVersion: z.literal("1.0"),
  system: named.omit({ technology: true }).optional(),
  defaultContainer: named.optional(),
  containers: z.array(named.extend({ paths: z.array(sourcePath).min(1) })).optional(),
  components: z.array(named.extend({ paths: z.array(sourcePath).min(1), containerId: id.optional() })).optional(),
}).strict();

export function validateBoundaryConfig(input: unknown): BoundaryConfig {
  const parsed = boundaryConfigSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid boundary configuration: ${parsed.error.issues.slice(0, 6).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const config = parsed.data as BoundaryConfig;
  const containers = new Set<string>();
  for (const container of [...(config.containers ?? []), ...(config.defaultContainer ? [config.defaultContainer] : [])]) {
    if (containers.has(container.id)) throw new Error(`Duplicate container configuration ID: ${container.id}`);
    containers.add(container.id);
  }
  const components = new Set<string>();
  for (const component of config.components ?? []) {
    if (components.has(component.id)) throw new Error(`Duplicate component configuration ID: ${component.id}`);
    components.add(component.id);
    if (component.containerId && !containers.has(component.containerId)) throw new Error(`Unknown containerId ${component.containerId} for component ${component.id}`);
  }
  return config;
}
export async function loadBoundaryConfig(filename: string): Promise<BoundaryConfig> {
  return validateBoundaryConfig(JSON.parse(await fs.readFile(filename, "utf8")));
}

const normalized = (value: string) => path.posix.normalize(value.replace(/\\/g, "/")).replace(/\/+$/, "") || ".";
const matches = (filename: string, prefixes: string[]) => prefixes.some(prefix => {
  const selected = normalized(prefix);
  return selected === "." || filename === selected || filename.startsWith(`${selected}/`);
});
const declared: Classification = { basis: "declared", confidence: "high", rule: "explicit-boundary-configuration" };
const inferred: Classification = { basis: "inferred", confidence: "low", rule: "default-scan-scope-boundary" };

export function createBoundaryMapper(scanRoot: string, input?: BoundaryConfig): BoundaryMapper {
  const config = input ? validateBoundaryConfig(input) : { schemaVersion: "1.0" as const };
  const system: Boundary = config.system
    ? { ...config.system, id: `system:${config.system.id}`, type: "System", classification: { ...declared } }
    : { id: stableId("system", "default"), label: path.basename(path.resolve(scanRoot)) || "Scanned system", type: "System", classification: { ...inferred } };
  const configured = (config.containers ?? []).map(container => ({
    ...container, id: `container:${container.id}`, type: "Container" as const, parentId: system.id, classification: { ...declared },
  }));
  const defaultContainer: Boundary = config.defaultContainer
    ? { ...config.defaultContainer, id: `container:${config.defaultContainer.id}`, type: "Container", parentId: system.id, classification: { ...declared } }
    : { id: stableId("container", "default"), label: "Application", type: "Container", parentId: system.id,
      technology: "Unknown", classification: { ...inferred } };
  const hierarchy = [system, ...configured.map(({ paths: _paths, ...container }) => container)];
  const diagnostics: GraphDiagnostic[] = [];
  if (!config.system) diagnostics.push({ code: "INFERRED_SYSTEM_BOUNDARY", severity: "info", message: "System boundary defaults to the scan scope; supply explicit configuration to name the architecture system." });
  let defaultReported = false;
  return {
    get hierarchy() { return [...hierarchy]; },
    diagnostics,
    forFile(filename: string): BoundaryAssignment {
      const relativePath = normalized(filename);
      const containerMatches = configured.filter(container => matches(relativePath, container.paths));
      if (containerMatches.length > 1) throw new Error(`Ambiguous container mappings for ${relativePath}: ${containerMatches.map(container => container.id).join(", ")}`);
      const componentMatches = (config.components ?? []).filter(component => matches(relativePath, component.paths));
      if (componentMatches.length > 1) throw new Error(`Ambiguous component mappings for ${relativePath}: ${componentMatches.map(component => component.id).join(", ")}`);
      const component = componentMatches[0];
      const requestedContainer = component?.containerId
        ? [...configured, defaultContainer].find(container => container.id === `container:${component.containerId}`) : undefined;
      if (requestedContainer && containerMatches[0] && requestedContainer.id !== containerMatches[0].id) {
        throw new Error(`Component/container mappings disagree for ${relativePath}`);
      }
      const container = requestedContainer ?? containerMatches[0] ?? defaultContainer;
      if (container.id === defaultContainer.id && !hierarchy.some(boundary => boundary.id === container.id)) hierarchy.push(defaultContainer);
      if (container.classification.basis === "inferred" && !defaultReported) {
        diagnostics.push({ code: "INFERRED_CONTAINER_BOUNDARY", severity: "info", message: "Unmapped source files share an inferred Application container; directories are not automatically treated as deployment containers." });
        defaultReported = true;
      }
      return { system, container, ...(component ? { component: { id: `component:${component.id}`, label: component.label,
        technology: component.technology, description: component.description, classification: { ...declared } } } : {}) };
    },
  };
}
