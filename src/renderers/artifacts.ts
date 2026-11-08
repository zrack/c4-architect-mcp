import fs from "node:fs/promises";
import path from "node:path";
import { renderC4Mermaid, type C4Diagram } from "./c4Mermaid.js";
import { renderCompactC4 } from "./compactC4.js";
import { validateArchitectureGraph, type ArchitectureGraph } from "../model/graph.js";
import { selectGraphNeighborhood, type GraphFocus } from "../model/neighborhood.js";

export function graphToDiagram(input: ArchitectureGraph, title?: string): C4Diagram {
  return diagramFromView(validateArchitectureGraph(input), title);
}

type Neighborhood = ReturnType<typeof selectGraphNeighborhood>;

function diagramFromView(graph: ArchitectureGraph, title?: string, view?: Neighborhood): C4Diagram {
  const boundaries = new Map(graph.hierarchy.map(item => [item.id, item]));
  const { nodes, edges } = view ?? graph;
  const labelCounts = new Map<string, number>();
  const labelKey = (edge: ArchitectureGraph["edges"][number]) => JSON.stringify([edge.source, edge.target, edge.label]);
  if (view) for (const edge of edges) {
    const key = labelKey(edge);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  let caption: string | undefined;
  if (view) {
    const { direction, maxDepth, truncated } = view.focus;
    const directionLabel = direction === "both" ? "Both directions" : direction === "incoming" ? "Incoming" : "Outgoing";
    caption = `${nodes.length} of ${graph.nodes.length} nodes · ${edges.length} of ${graph.edges.length} relationships · ${directionLabel} · Depth ${maxDepth}`;
    if (truncated.nodes || truncated.edges) caption += " · Limit reached";
  }
  return {
    title: title ?? (view ? `${view.center.label} · Neighborhood`
      : `${graph.hierarchy.find(item => item.type === "System")?.label ?? "Architecture"} — ${graph.metadata.abstractionLevel}`),
    caption,
    c4Level: `C4${graph.metadata.abstractionLevel}` as C4Diagram["c4Level"],
    nodes: nodes.map(node => ({
      id: node.id, label: node.classification.basis === "inferred" && !node.label.includes("(inferred)") ? `${node.label} (inferred)` : node.label, type: node.type,
      technology: node.technology,
      description: [node.classification.basis === "inferred" ? "Inferred boundary" : undefined,
        node.parentId ? `Within ${boundaries.get(node.parentId)?.label ?? node.parentId}${boundaries.get(node.parentId)?.classification.basis === "inferred" ? " (inferred)" : ""}` : undefined,
        node.description].filter(Boolean).join(" · ") || undefined,
    })),
    relationships: edges.map(edge => {
      const specifier = (labelCounts.get(labelKey(edge)) ?? 0) > 1
        ? edge.evidence.find(item => item.specifier)?.specifier : undefined;
      const evidence = view ? edge.evidence.slice(0, 3).map(item => `${item.path}:${item.line}:${item.column}${item.specifier ? ` (${item.specifier})` : ""}`) : [];
      if (view && edge.evidence.length > evidence.length) evidence.push(`+${edge.evidence.length - evidence.length} more in the saved graph`);
      return {
        from: edge.source,
        to: edge.target,
        label: specifier ? `${edge.label} · ${specifier}` : edge.label,
        technology: edge.protocol === "unknown" ? undefined : edge.protocol,
        description: evidence.length ? evidence.join("\n") : undefined,
      };
    }),
  };
}

export async function renderArchitectureGraph(input: ArchitectureGraph, options: { title?: string; outputPath?: string; focus?: GraphFocus } = {}) {
  const graph = validateArchitectureGraph(input);
  const view = options.focus ? selectGraphNeighborhood(graph, options.focus) : undefined;
  const result = await renderArtifacts(diagramFromView(graph, options.title, view), options.outputPath);
  return view ? { ...result, structuredContent: { ...result.structuredContent, focus: view.focus } } : result;
}

export async function renderArtifacts(diagram: C4Diagram, outputPath?: string) {
  const mermaidOutput = renderC4Mermaid(diagram);
  const compact = await renderCompactC4(diagram);
  let artifacts: { markdown: string; svg: string; png: string; html: string } | undefined;
  if (outputPath) {
    if (!/\.md$/i.test(outputPath)) throw new Error("outputPath must end in .md");
    const markdown = path.resolve(outputPath);
    const base = markdown.replace(/\.md$/i, "");
    artifacts = { markdown, svg: `${base}.svg`, png: `${base}.png`, html: `${base}.html` };
    await fs.mkdir(path.dirname(markdown), { recursive: true });
    await Promise.all([fs.writeFile(artifacts.svg, compact.svg), fs.writeFile(artifacts.png, compact.png), fs.writeFile(artifacts.html, compact.html)]);
    const fileLink = (filename: string) => encodeURIComponent(path.basename(filename));
    const cell = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]|]/g, "\\$&").replace(/\s+/g, " ");
    const hasEvidence = diagram.relationships.some(r => r.description);
    const dynamic = diagram.c4Level === "C4Dynamic";
    const labels = new Map(diagram.nodes.map(node => [node.id, node.label]));
    const key = diagram.relationships.map((r, i) => {
      const from = hasEvidence ? labels.get(r.from)! : r.from;
      const to = hasEvidence ? labels.get(r.to)! : r.to;
      const id = dynamic ? String(i + 1) : `R${String(i + 1).padStart(2, "0")}`;
      const row = `| ${id} | ${cell(from)} | ${cell(to)} | ${cell(r.label)} | ${cell(r.technology ?? "")} |`;
      return hasEvidence ? `${row} ${cell(r.description ?? "")} |` : row;
    }).join("\n");
    const scope = diagram.caption ? `${cell(diagram.caption)}\n\n` : "";
    const heading = diagram.title.replace(/\s+/g, " ").trim().replace(/[\\`*_{}\[\]<>]/g, "\\$&");
    await fs.writeFile(markdown, `# ${heading}\n\n${scope}![Compact C4 diagram](${fileLink(artifacts.png)})\n\n[Interactive view](${fileLink(artifacts.html)}) · [Scalable SVG](${fileLink(artifacts.svg)})\n\n<details>\n<summary>Mermaid source export</summary>\n\n${mermaidOutput}\n\n</details>\n\n## ${dynamic ? "Interactions" : "Relationships"}\n\n| ${dynamic ? "Step" : "ID"} | From | To | Action | Technology |${hasEvidence ? " Source evidence |" : ""}\n|---|---|---|---|---|${hasEvidence ? "---|" : ""}\n${key}\n`, "utf8");
  }
  return {
    content: [{ type: "text" as const, text: mermaidOutput }, { type: "image" as const, data: compact.png.toString("base64"), mimeType: "image/png" }],
    structuredContent: { layout: { engine: "elk", width: compact.layout.width, height: compact.layout.height, direction: compact.layout.direction, nodeCount: diagram.nodes.length, relationshipCount: diagram.relationships.length }, ...(artifacts ? { artifacts } : {}) },
  };
}
