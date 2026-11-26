import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArchitectureGraph } from "../model/graph.js";
import { analyzeDirectory } from "../parsers/astParser.js";
import { githubSourceLink, type SourceLink } from "./sourceLinks.js";

export interface FileSourceOptions {
  repository?: string;
  commit?: string;
  sourceRoot?: string;
  tsconfigPath?: string;
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

export async function scanFileReport(targetDir: string, file: string, outputPath: string, options: FileSourceOptions) {
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
  return { markdown, graph, center, link };
}

export async function saveFileReport(markdown: string, image: Buffer, report: (imageLink: string) => string) {
  const directory = path.dirname(markdown);
  const stem = path.basename(markdown, path.extname(markdown));
  const digest = createHash("sha256").update(image).digest("hex").slice(0, 16);
  const png = path.join(directory, `${stem}.focus-${digest}.png`);
  const content = report(relativeLink(directory, png));
  // Each report references the bytes from its own scan, including during concurrent regenerations.
  await fs.mkdir(directory, { recursive: true });
  const stage = await fs.mkdtemp(path.join(directory, ".c4-report-"));
  try {
    await fs.writeFile(path.join(stage, "diagram.png"), image);
    await fs.writeFile(path.join(stage, "report.md"), content, "utf8");
    await fs.rename(path.join(stage, "diagram.png"), png);
    await fs.rename(path.join(stage, "report.md"), markdown);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  return { markdown, png };
}
