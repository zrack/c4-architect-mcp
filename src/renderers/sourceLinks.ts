import type { GraphDiagnostic } from "../model/graph.js";

export type SourceLink = (filename: string, line?: number) => string;
export type GithubSourceOptions = { repository: string; sourceRoot?: string };

export function markdownText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]|~]/g, "\\$&").replace(/\s+/g, " ").trim();
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

export function githubSourceLink(commit: string | undefined, options: GithubSourceOptions, snapshot: string): SourceLink {
  const [owner, repository, ...extra] = options.repository.split("/");
  if (!owner || owner.length > 39 || !/^[a-z\d]+(?:-[a-z\d]+)*$/i.test(owner) || !repository
    || !/^[a-z\d_.-]{1,100}$/i.test(repository) || repository === "." || repository === ".." || extra.length) {
    throw new Error("GitHub repository must be in OWNER/REPO form");
  }
  const root = repositoryPath(options.sourceRoot ?? ".", "Source root", true);
  if (!commit || !/^[a-f\d]{40}$/i.test(commit)) throw new Error(`${snapshot} snapshot requires a full 40-hex commit for GitHub source links`);
  const prefix = `https://github.com/${owner}/${repository}/blob/${commit.toLowerCase()}/`;
  return (filename, line) => prefix + [...root, ...repositoryPath(filename, "Source evidence path")].join("/")
    + (line === undefined ? "" : `#L${line}`);
}

export function sourceEvidence(item: Pick<GraphDiagnostic, "path" | "line" | "column" | "specifier">, link?: SourceLink) {
  const specifier = item.specifier ? markdownText(item.specifier) : "";
  if (!item.path) return specifier || "—";
  const position = item.line === undefined ? item.path
    : `${item.path}:${item.line}${item.column === undefined ? "" : `:${item.column}`}`;
  const label = markdownText(position);
  const location = link ? `[${label}](<${link(item.path, item.line)}>)` : label;
  return location + (specifier ? ` (${specifier})` : "");
}
