import { diagramRelationshipLabel, diagramSchema, type C4Diagram, type C4NodeType, type DiagramNode } from "../model/diagram.js";
export type { C4Diagram, C4Level, C4NodeType, DiagramNode, DiagramRelationship } from "../model/diagram.js";

const stereotypes: Record<C4NodeType, string> = {
  Person: "person",
  System: "software system",
  System_Ext: "external system",
  ExternalSystem: "external system",
  Container: "container",
  ContainerDb: "database",
  Component: "component",
  DeploymentNode: "deployment node",
  CodeElement: "code element",
  Class: "class",
  Interface: "interface",
  Function: "function",
  Type: "type",
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

const labelSpecialCharacters = /[&<>"`#|\\\[\]{}]/g;

// Mermaid entity codes keep text literal inside quoted labels, including edge
// labels delimited by pipes. Escape before inserting our own line breaks.
function escapeLabel(text: string): string {
  return text.replace(labelSpecialCharacters, character => `#${character.codePointAt(0)};`);
}

const subgraphEntities: Record<string, string> = {
  "&": "amp", "<": "lt", ">": "gt", '"': "quot", "`": "grave", "#": "num", "|": "vert",
  "\\": "bsol", "[": "lbrack", "]": "rbrack", "{": "lbrace", "}": "rbrace",
};

// Mermaid displays numeric entity codes verbatim in SVG subgraph labels.
function escapeSubgraphLabel(text: string): string {
  return text.replace(labelSpecialCharacters, character => `&${subgraphEntities[character]};`);
}

function label(parts: Array<string | undefined>, width = 32, escape = escapeLabel): string {
  return parts.filter((part): part is string => Boolean(part?.trim()))
    .flatMap(part => wrapText(part, width))
    .map(escape)
    .join("<br/>");
}

/** Render C4 semantics with Mermaid's graph-aware layout, rather than its
 * experimental C4 grid, which can place boxes across relationships. */
export function renderC4Mermaid(diagram: C4Diagram): string {
  diagramSchema.parse(diagram);
  const aliases = new Map(diagram.nodes.map((node, index) => [node.id, `n${index}`]));

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

  const nodesByParent = new Map<string | undefined, DiagramNode[]>();
  for (const node of diagram.nodes) {
    const siblings = nodesByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else nodesByParent.set(node.parentId, [node]);
  }
  const renderNode = (node: DiagramNode, indent: string) => {
    const id = aliases.get(node.id)!;
    const children = nodesByParent.get(node.id);
    const text = label([
      `«${stereotypes[node.type]}»`,
      node.label,
      node.technology ? `[${node.technology}]` : undefined,
      node.description,
    ], 32, children ? escapeSubgraphLabel : escapeLabel);
    if (children) {
      lines.push(`${indent}subgraph ${id}["${text}"]`);
      for (const child of children) renderNode(child, `${indent}  `);
      lines.push(`${indent}end`);
    } else {
      lines.push(node.type === "ContainerDb" ? `${indent}${id}[("${text}")]` : `${indent}${id}["${text}"]`);
    }
  };
  for (const node of nodesByParent.get(undefined) ?? []) renderNode(node, "  ");
  lines.push("");
  diagram.relationships.forEach((relationship, index) => {
    // Mermaid's SVG edge-label renderer has a separate 200px width limit, even
    // when node wrappingWidth is larger. Keep explicit edge lines narrower.
    const text = label([diagramRelationshipLabel(diagram.c4Level, relationship, index), relationship.technology], 22);
    const from = aliases.get(relationship.from)!;
    const to = aliases.get(relationship.to)!;
    lines.push(text ? `  ${from} -->|"${text}"| ${to}` : `  ${from} --> ${to}`);
  });
  lines.push(
    "",
    "  classDef internal fill:#e7f0fb,stroke:#3c6fa9,color:#15243a",
    "  classDef external fill:#f0f2f5,stroke:#737d8b,color:#15243a",
    "  classDef person fill:#dbeafe,stroke:#3c6fa9,color:#15243a",
  );
  if (diagram.c4Level === "C4Deployment" && nodesByParent.size > 1) {
    lines.push("  classDef deployment fill:#f6f9fc,stroke:#737d8b,color:#15243a,stroke-dasharray:4 3");
  }
  diagram.nodes.forEach(node => {
    const style = nodesByParent.has(node.id) ? "deployment"
      : node.type === "System_Ext" || node.type === "ExternalSystem" ? "external"
      : node.type === "Person" ? "person" : "internal";
    lines.push(`  class ${aliases.get(node.id)} ${style}`);
  });
  lines.push("```");
  return lines.join("\n");
}
