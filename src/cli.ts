import fs from "node:fs/promises";
import path from "node:path";
import { analyzeDirectory } from "./parsers/astParser.js";
import { compareArchitectureGraphs, queryArchitectureGraph, readArchitectureGraph, summarizeArchitectureGraph, writeArchitectureGraph, type AbstractionLevel } from "./model/graph.js";
import { graphFocusSchema } from "./model/neighborhood.js";
import { renderArchitectureGraph } from "./renderers/artifacts.js";
import { writeArchitectureReview } from "./renderers/review.js";
import { version } from "./version.js";

const help = `C4-Architect ${version}

No arguments: start the MCP server over stdio.

  analyze <directory> --level Component --out graph.json [--config config.json] [--tsconfig tsconfig.json] [--summary]
  render <graph.json> --out ARCHITECTURE.md [--title "Architecture"] [--node ID [--direction both] [--depth 1] [--nodes 25] [--edges 50]]
  summary <graph.json>
  query <graph.json> [--node ID | --search TEXT] [--direction both] [--depth 1] [--nodes 25] [--edges 50] [--bytes 16000] [--evidence]
  diff <before.json> <after.json> [--limit 25] [--bytes 16000]
  review <before.json> <after.json> --out REVIEW.md [--title "Architecture review"]

Levels: Context, Container, Component. Paths are relative to the current directory.
Boundary configuration is loaded only with --config. Rendering writes Markdown,
PNG, SVG, and standalone interactive HTML. No repository code is executed.
`;
const json = (value: unknown) => process.stdout.write(JSON.stringify(value));

export async function runCli(args: string[]): Promise<boolean> {
  if (!args.length) return false;
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0])) { process.stdout.write(help); return true; }
  if (args.length === 1 && ["--version", "-v"].includes(args[0])) { process.stdout.write(version + "\n"); return true; }
  const [command, ...rest] = args;
  const specs: Record<string, string[]> = {
    analyze: ["level", "out", "config", "tsconfig", "summary"], render: ["out", "title", "node", "direction", "depth", "nodes", "edges"], summary: [],
    query: ["node", "search", "direction", "depth", "nodes", "edges", "bytes", "evidence"], diff: ["limit", "bytes"],
    review: ["out", "title"],
  };
  if (!Object.hasOwn(specs, command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  const flags = new Map<string, string | boolean>(), positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const flag = arg.slice(2);
    if (!specs[command].includes(flag) || flags.has(flag)) throw new Error(`Unknown or duplicate option: ${arg}`);
    if (["summary", "evidence"].includes(flag)) flags.set(flag, true);
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      flags.set(flag, value);
    }
  }
  if (positional.length !== (["diff", "review"].includes(command) ? 2 : 1)) throw new Error(`Invalid arguments for ${command}. Use --help.`);
  const str = (key: string) => flags.get(key) as string | undefined;
  const num = (key: string) => flags.has(key) ? Number(str(key)) : undefined;
  if (command === "analyze") {
    const level = str("level") ?? "Component";
    if (!["Context", "Container", "Component"].includes(level)) throw new Error("--level must be Context, Container, or Component");
    const out = str("out");
    if (!out) throw new Error("analyze requires --out graph.json");
    const graph = await analyzeDirectory(path.resolve(positional[0]), level as AbstractionLevel, { configPath: str("config"), tsconfigPath: str("tsconfig") });
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeArchitectureGraph(out, graph);
    json(flags.has("summary") ? { ...summarizeArchitectureGraph(graph), graphPath: path.resolve(out) } : graph);
  } else if (command === "render") {
    const out = str("out"); if (!out) throw new Error("render requires --out ARCHITECTURE.md");
    const nodeId = str("node");
    if (!nodeId && ["direction", "depth", "nodes", "edges"].some(flag => flags.has(flag))) throw new Error("Render scope options require --node ID");
    const focus = nodeId ? graphFocusSchema.parse({
      nodeId, direction: str("direction"), maxDepth: num("depth"), maxNodes: num("nodes"), maxEdges: num("edges"),
    }) : undefined;
    const result = await renderArchitectureGraph(await readArchitectureGraph(positional[0]), { title: str("title"), outputPath: out, focus });
    json(result.structuredContent);
  } else if (command === "summary") json(summarizeArchitectureGraph(await readArchitectureGraph(positional[0])));
  else if (command === "query") json(queryArchitectureGraph(await readArchitectureGraph(positional[0]), {
    nodeId: str("node"), search: str("search"), direction: str("direction") as "both" | undefined,
    maxDepth: num("depth"), maxNodes: num("nodes"), maxEdges: num("edges"), maxBytes: num("bytes"), includeEvidence: flags.has("evidence"),
  }));
  else if (command === "review") {
    const out = str("out");
    if (!out) throw new Error("review requires --out REVIEW.md");
    json(await writeArchitectureReview(positional[0], positional[1], out, str("title")));
  } else json(compareArchitectureGraphs(await readArchitectureGraph(positional[0]), await readArchitectureGraph(positional[1]), { limit: num("limit"), maxBytes: num("bytes") }));
  return true;
}
