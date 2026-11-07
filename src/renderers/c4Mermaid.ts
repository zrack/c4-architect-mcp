export type C4Level = "C4Context" | "C4Container" | "C4Component";
export type C4NodeType =
  | "Person"
  | "System"
  | "System_Ext"
  | "ExternalSystem"
  | "Container"
  | "ContainerDb"
  | "Component";

export interface DiagramNode {
  id: string;
  label: string;
  type: C4NodeType;
  technology?: string;
  description?: string;
}

export interface DiagramRelationship {
  from: string;
  to: string;
  label: string;
  technology?: string;
}

export interface C4Diagram {
  title: string;
  c4Level: C4Level;
  nodes: DiagramNode[];
  relationships: DiagramRelationship[];
}

const stereotypes: Record<C4NodeType, string> = {
  Person: "person",
  System: "software system",
  System_Ext: "external system",
  ExternalSystem: "external system",
  Container: "container",
  ContainerDb: "database",
  Component: "component",
};

// Explicit wrapping also works in Mermaid hosts that do not support Markdown
// auto-wrapping. Split long package names as well as ordinary prose.
function wrapText(text: string, width = 32): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && Array.from(`${line} ${word}`).length > width) {
      lines.push(line);
      line = "";
    }
    const characters = Array.from(word);
    while (characters.length > width) {
      // Break identifiers at a separator when possible, so a package/path suffix
      // does not become a single orphan character on the next line.
      let separator = -1;
      characters.slice(0, width).forEach((character, index) => {
        if (/[/_.:-]/.test(character)) separator = index;
      });
      const length = separator >= width / 2 ? separator + 1 : width;
      lines.push(characters.splice(0, length).join(""));
    }
    const remainder = characters.join("");
    if (remainder) line = line ? `${line} ${remainder}` : remainder;
  }
  if (line) lines.push(line);
  return lines;
}

// Mermaid entity codes keep text literal inside quoted labels, including edge
// labels delimited by pipes. Escape before inserting our own line breaks.
function escapeLabel(text: string): string {
  return text.replace(/[&<>"`#|\\\[\]{}]/g, character => `#${character.codePointAt(0)};`);
}

function label(parts: Array<string | undefined>, width = 32): string {
  return parts.filter((part): part is string => Boolean(part?.trim()))
    .flatMap(part => wrapText(part, width))
    .map(escapeLabel)
    .join("<br/>");
}

/** Render C4 semantics with Mermaid's graph-aware layout, rather than its
 * experimental C4 grid, which can place boxes across relationships. */
export function renderC4Mermaid(diagram: C4Diagram): string {
  if (!diagram.title.trim()) throw new Error("Diagram title must not be empty.");
  if (!diagram.nodes.length) throw new Error("Diagram must contain at least one node.");
  const aliases = new Map<string, string>();
  diagram.nodes.forEach((node, index) => {
    if (!node.id.trim()) throw new Error("Node ID must not be empty.");
    if (aliases.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
    aliases.set(node.id, `n${index}`);
  });
  for (const relationship of diagram.relationships) {
    for (const id of [relationship.from, relationship.to]) {
      if (!aliases.has(id)) throw new Error(`Relationship references unknown node ID: ${id}`);
    }
  }

  const title = JSON.stringify(diagram.title.replace(/\s+/g, " ").trim())
    .replace(/`/g, "\\u0060");
  const lines = [
    "```mermaid",
    "---",
    `title: ${title}`,
    "config:",
    "  theme: base",
    "  themeVariables:",
    "    primaryTextColor: '#15243a'",
    "    lineColor: '#374151'",
    "    edgeLabelBackground: '#ffffff'",
    "  themeCSS: '.edgeLabel rect { opacity: 1 !important; fill: #ffffff !important; }'",
    "  flowchart:",
    "    htmlLabels: false",
    "    wrappingWidth: 320",
    "    nodeSpacing: 160",
    "    rankSpacing: 180",
    "    curve: bumpY",
    "---",
    "flowchart TB",
    `  %% ${diagram.c4Level}: C4 types with automatic graph layout`,
  ];

  diagram.nodes.forEach(node => {
    const text = label([
      `«${stereotypes[node.type]}»`,
      node.label,
      node.technology ? `[${node.technology}]` : undefined,
      node.description,
    ]);
    const id = aliases.get(node.id)!;
    lines.push(node.type === "ContainerDb" ? `  ${id}[("${text}")]` : `  ${id}["${text}"]`);
  });
  lines.push("");
  for (const relationship of diagram.relationships) {
    // Mermaid's SVG edge-label renderer has a separate 200px width limit, even
    // when node wrappingWidth is larger. Keep explicit edge lines narrower.
    const text = label([relationship.label, relationship.technology], 22);
    const from = aliases.get(relationship.from)!;
    const to = aliases.get(relationship.to)!;
    lines.push(text ? `  ${from} -->|"${text}"| ${to}` : `  ${from} --> ${to}`);
  }
  lines.push(
    "",
    "  classDef internal fill:#e7f0fb,stroke:#3c6fa9,color:#15243a",
    "  classDef external fill:#f0f2f5,stroke:#737d8b,color:#15243a",
    "  classDef person fill:#dbeafe,stroke:#3c6fa9,color:#15243a",
  );
  diagram.nodes.forEach(node => {
    const style = node.type === "System_Ext" || node.type === "ExternalSystem" ? "external"
      : node.type === "Person" ? "person" : "internal";
    lines.push(`  class ${aliases.get(node.id)} ${style}`);
  });
  lines.push("```");
  return lines.join("\n");
}
