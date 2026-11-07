import fs from "node:fs/promises";
import path from "node:path";
import { renderC4Mermaid, type C4Diagram } from "./c4Mermaid.js";
import { renderCompactC4 } from "./compactC4.js";
import { validateArchitectureGraph, type ArchitectureGraph } from "../model/graph.js";

export function graphToDiagram(input: ArchitectureGraph, title?: string): C4Diagram {
  const graph = validateArchitectureGraph(input);
  const boundaries = new Map(graph.hierarchy.map(item => [item.id, item]));
  return {
    title: title ?? `${graph.hierarchy.find(item => item.type === "System")?.label ?? "Architecture"} — ${graph.metadata.abstractionLevel}`,
    c4Level: `C4${graph.metadata.abstractionLevel}` as C4Diagram["c4Level"],
    nodes: graph.nodes.map(node => ({
      id: node.id, label: node.classification.basis === "inferred" && !node.label.includes("(inferred)") ? `${node.label} (inferred)` : node.label, type: node.type,
      technology: node.technology,
      description: [node.classification.basis === "inferred" ? "Inferred boundary" : undefined,
        node.parentId ? `Within ${boundaries.get(node.parentId)?.label ?? node.parentId}${boundaries.get(node.parentId)?.classification.basis === "inferred" ? " (inferred)" : ""}` : undefined,
        node.description].filter(Boolean).join(" · ") || undefined,
    })),
    relationships: graph.edges.map(edge => ({ from: edge.source, to: edge.target, label: edge.label,
      technology: edge.protocol === "unknown" ? undefined : edge.protocol })),
  };
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
    const key = diagram.relationships.map((r, i) => `| R${String(i + 1).padStart(2, "0")} | ${cell(r.from)} | ${cell(r.to)} | ${cell(r.label)} | ${cell(r.technology ?? "")} |`).join("\n");
    const heading = diagram.title.replace(/\s+/g, " ").trim().replace(/[\\`*_{}\[\]<>]/g, "\\$&");
    await fs.writeFile(markdown, `# ${heading}\n\n![Compact C4 diagram](${fileLink(artifacts.png)})\n\n[Interactive view](${fileLink(artifacts.html)}) · [Scalable SVG](${fileLink(artifacts.svg)})\n\n<details>\n<summary>Mermaid source export</summary>\n\n${mermaidOutput}\n\n</details>\n\n## Relationships\n\n| ID | From | To | Action | Technology |\n|---|---|---|---|---|\n${key}\n`, "utf8");
  }
  return {
    content: [{ type: "text" as const, text: mermaidOutput }, { type: "image" as const, data: compact.png.toString("base64"), mimeType: "image/png" }],
    structuredContent: { layout: { engine: "elk", width: compact.layout.width, height: compact.layout.height, direction: compact.layout.direction, nodeCount: diagram.nodes.length, relationshipCount: diagram.relationships.length }, ...(artifacts ? { artifacts } : {}) },
  };
}
