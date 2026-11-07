import path from "node:path";
import { isBuiltin } from "node:module";
import ts from "typescript";
import type { GraphDiagnostic } from "../model/graph.js";
import type { DependencyKind } from "./syntaxFacts.js";

export const packageName = (specifier: string): string => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const slash = (value: string) => value.replace(/\\/g, "/");

function matchesWorkspace(pattern: string, relativeDirectory: string): boolean {
  const segments = slash(pattern).replace(/^\.\//, "").replace(/\/$/, "").split("/");
  const escaped = segments.map(segment => segment === "**" ? ".*" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^/]*")).join("/");
  return new RegExp(`^${escaped}$`).test(relativeDirectory);
}

function readPackage(filename: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(ts.sys.readFile(filename) ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}

export interface Resolution {
  resolvedPath?: string;
  packageName?: string;
  builtin: boolean;
  /** Bare dependency resolved through package lookup rather than a local alias. */
  externalPackage: boolean;
  localSpecifier: boolean;
}

export interface ModuleResolver {
  configPath?: string;
  outputDirectories: string[];
  diagnostics: GraphDiagnostic[];
  resolve(specifier: string, containingFile: string, kind: DependencyKind, modeOverride?: "require"): Resolution;
}

/** TypeScript resolves paths and package exports; repository configuration is
 * parsed as data only. No imported module, build plugin or package script runs. */
export function createModuleResolver(scanRoot: string, manifestFiles: string[], explicitTsconfig?: string): ModuleResolver {
  const diagnostics: GraphDiagnostic[] = [];
  const configPath = explicitTsconfig ? path.resolve(explicitTsconfig) : ts.findConfigFile(scanRoot, ts.sys.fileExists);
  let options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true, resolveJsonModule: true, noEmit: true };
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error && explicitTsconfig) throw new Error(`Cannot load tsconfig: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
    const errors: ts.Diagnostic[] = read.error ? [read.error] : [];
    if (!read.error) {
      // Module resolution only needs compiler options, not TypeScript's own
      // recursive source discovery. Our bounded walker owns scan membership.
      const parsed = ts.parseJsonConfigFileContent(read.config, { ...ts.sys, readDirectory: () => [] }, path.dirname(configPath));
      options = { ...options, ...parsed.options };
      errors.push(...parsed.errors.filter(error => error.code !== 18003));
    }
    for (const error of errors) diagnostics.push({ code: "TSCONFIG_ERROR", severity: "warning",
      message: ts.flattenDiagnosticMessageText(error.messageText, " ") });
  }

  const rootManifest = readPackage(path.join(scanRoot, "package.json"));
  const declaredWorkspaces = rootManifest?.workspaces;
  const patterns = Array.isArray(declaredWorkspaces) ? declaredWorkspaces.filter((item): item is string => typeof item === "string")
    : declaredWorkspaces && typeof declaredWorkspaces === "object" && Array.isArray((declaredWorkspaces as { packages?: unknown }).packages)
      ? ((declaredWorkspaces as { packages: unknown[] }).packages.filter((item): item is string => typeof item === "string")) : [];
  const workspacePackages = new Map<string, string>();
  const ambiguousPackages = new Set<string>();
  for (const manifestFile of [...manifestFiles].sort()) {
    const directory = path.dirname(manifestFile);
    const relative = slash(path.relative(scanRoot, directory));
    if (relative && !patterns.some(pattern => matchesWorkspace(pattern, relative))) continue;
    const manifest = readPackage(manifestFile);
    if (typeof manifest?.name !== "string") {
      if (!manifest) diagnostics.push({ code: "PACKAGE_JSON_ERROR", severity: "warning", path: slash(path.relative(scanRoot, manifestFile)), message: "Invalid package.json; package-name resolution may be incomplete." });
      continue;
    }
    if (ambiguousPackages.has(manifest.name)) continue;
    if (workspacePackages.has(manifest.name)) {
      diagnostics.push({ code: "AMBIGUOUS_WORKSPACE_PACKAGE", severity: "warning", path: slash(path.relative(scanRoot, manifestFile)), message: `Multiple scanned workspace packages declare ${manifest.name}; no workspace target was guessed.` });
      workspacePackages.delete(manifest.name);
      ambiguousPackages.add(manifest.name);
      continue;
    }
    workspacePackages.set(manifest.name, directory);
  }
  // A virtual node_modules view lets the official resolver honor workspace
  // exports/types/main even before a package manager has created symlinks.
  function mapWorkspace(filename: string): string {
    const normalized = slash(filename);
    for (const [name, directory] of workspacePackages) {
      const marker = `/node_modules/${name}`;
      const index = normalized.lastIndexOf(marker);
      if (index >= 0 && (normalized.length === index + marker.length || normalized[index + marker.length] === "/")) {
        return path.join(directory, normalized.slice(index + marker.length));
      }
    }
    return filename;
  }
  function virtualDirectory(directory: string): boolean {
    const normalized = slash(directory).replace(/\/$/, "");
    if (normalized.endsWith("/node_modules")) return workspacePackages.size > 0;
    const match = normalized.match(/\/node_modules\/(.+)$/);
    return Boolean(match && [...workspacePackages.keys()].some(name => name.startsWith(`${match[1]}/`)));
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: filename => ts.sys.fileExists(mapWorkspace(filename)),
    readFile: filename => ts.sys.readFile(mapWorkspace(filename)),
    directoryExists: directory => virtualDirectory(directory) || Boolean(ts.sys.directoryExists?.(mapWorkspace(directory))),
    getDirectories: directory => ts.sys.getDirectories?.(mapWorkspace(directory)) ?? [],
    realpath: filename => ts.sys.realpath?.(mapWorkspace(filename)) ?? mapWorkspace(filename),
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
  const cache = ts.createModuleResolutionCache(scanRoot, filename => ts.sys.useCaseSensitiveFileNames ? filename : filename.toLowerCase(), options);
  const modeCache = new Map<string, ts.ModuleKind.CommonJS | ts.ModuleKind.ESNext>();
  function resolutionMode(filename: string, kind: DependencyKind): ts.ModuleKind.CommonJS | ts.ModuleKind.ESNext | undefined {
    if (![ts.ModuleResolutionKind.Node16, ts.ModuleResolutionKind.NodeNext].includes(options.moduleResolution!)) return undefined;
    if (kind === "require") return ts.ModuleKind.CommonJS;
    if (kind === "dynamic-import") return ts.ModuleKind.ESNext;
    if (modeCache.has(filename)) return modeCache.get(filename)!;
    let directory = path.dirname(filename), mode: ts.ModuleKind.CommonJS | ts.ModuleKind.ESNext = ts.ModuleKind.CommonJS;
    while (true) {
      const manifest = readPackage(path.join(directory, "package.json"));
      if (manifest) { mode = manifest.type === "module" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS; break; }
      const parent = path.dirname(directory);
      if (directory === parent) break;
      directory = parent;
    }
    modeCache.set(filename, mode);
    return mode;
  }
  const outputDirectories = [options.outDir, options.declarationDir].filter((item): item is string => Boolean(item) && path.resolve(item!) !== scanRoot).map(item => path.resolve(item));
  function matchesPathAlias(specifier: string): boolean {
    return Object.keys(options.paths ?? {}).some(pattern => {
      const star = pattern.indexOf("*");
      return star < 0 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
    });
  }
  return { configPath, outputDirectories, diagnostics, resolve(specifier, containingFile, kind, modeOverride) {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host, cache, undefined, resolutionMode(containingFile, modeOverride === "require" ? "require" : kind)).resolvedModule;
    const resolvedPath = resolved ? path.resolve(host.realpath?.(resolved.resolvedFileName) ?? resolved.resolvedFileName) : undefined;
    const bare = !specifier.startsWith(".") && !path.isAbsolute(specifier) && !specifier.startsWith("#");
    // URL/runtime schemes and invalid package names are not npm packages.
    const candidate = bare ? packageName(specifier) : undefined;
    const name = candidate && /^(?:@[^/\s:]+\/)?[^/\s:]+$/.test(candidate) ? candidate : undefined;
    const localSpecifier = !bare || specifier.startsWith("node:") || matchesPathAlias(specifier) && (!resolved || !resolved.isExternalLibraryImport)
      || Boolean(name && (workspacePackages.has(name) || ambiguousPackages.has(name)));
    return { ...(resolvedPath ? { resolvedPath } : {}), ...(name ? { packageName: name } : {}),
      externalPackage: bare && !localSpecifier && (!resolved || Boolean(resolved.isExternalLibraryImport && resolvedPath?.split(path.sep).includes("node_modules"))), localSpecifier,
      builtin: isBuiltin(specifier) };
  } };
}
