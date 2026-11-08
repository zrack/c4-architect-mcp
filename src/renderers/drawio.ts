import type { C4Diagram } from "../model/diagram.js";
import { layoutDiagram, nodeKinds, type CompactNode, type CompactRelationship } from "./compactC4.js";

interface Point { x: number; y: number }

const origin = { x: 0, y: 0 };
const labelStyle = "html=1;fontFamily=Arial;fontColor=#142842;";
const entities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  "\r": "&#13;", "\n": "&#10;", "\t": "&#9;",
};

function escapeXml(value: string): string {
  return value.replace(/[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "\uFFFD")
    .replace(/[&<>"'\r\n\t]/g, character => entities[character]);
}

function attributes(values: Record<string, string | undefined>): string {
  return Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join("");
}

function labelLines(lines: readonly string[]): string {
  // HTML label content is escaped here before the label itself becomes an XML attribute.
  return lines.map(escapeXml).join("<br>");
}

function nodeCell(node: CompactNode, parent: CompactNode | undefined): string {
  const boundary = node.boundaryHeader;
  const external = node.type === "System_Ext" || node.type === "ExternalSystem";
  const style = boundary
    ? `shape=swimlane;container=1;recursiveResize=0;startSize=${boundary.height};align=left;spacingLeft=12;fillColor=#e9eff7;swimlaneFillColor=#f7f9fc;strokeColor=#7288a1;`
    : `rounded=1;arcSize=8;fillColor=${external ? "#edf0f4" : "#e5eef9"};strokeColor=${external ? "#7d8b9c" : "#4878b2"};`;
  const label = [
    `<span style="font-size:11px;color:#475a71">${nodeKinds[node.type]}</span>`,
    `<b style="font-size:16px">${labelLines(node.titleLines)}</b>`,
    node.technologyLines.length ? `<span style="font-size:12px;color:#475a71">${labelLines(node.technologyLines)}</span>` : "",
  ].filter(Boolean).join("<br>");
  const metadata = attributes({ id: node.alias, label, c4Id: node.id, c4Type: node.type, technology: node.technology,
    description: node.description });
  const { x, y } = parent ?? origin;
  return `        <object${metadata}>
          <mxCell vertex="1" parent="${parent?.alias ?? "1"}" style="${labelStyle}whiteSpace=wrap;${style}"${boundary ? ' connectable="0"' : ""}>
            <mxGeometry x="${node.x - x}" y="${node.y - y}" width="${node.width}" height="${node.height}" as="geometry"/>
          </mxCell>
        </object>`;
}

function commonParent(source: CompactNode, target: CompactNode, nodes: ReadonlyMap<string, CompactNode>): CompactNode | undefined {
  // Parenting internal connectors to their enclosing swimlane keeps waypoints with the group when it moves.
  const sourceParents = new Set<string>();
  for (let id = source.parentId; id !== undefined; id = nodes.get(id)?.parentId) sourceParents.add(id);
  for (let id = target.parentId; id !== undefined; id = nodes.get(id)?.parentId) {
    if (sourceParents.has(id)) return nodes.get(id);
  }
}

function connection(side: "entry" | "exit", point: Point, node: CompactNode): string {
  return `${side}X=${(point.x - node.x) / node.width};${side}Y=${(point.y - node.y) / node.height};${side}Perimeter=0;`;
}

function routeMidpoint(points: Point[]): Point {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((total, length) => total + length, 0) / 2;
  for (const [index, length] of lengths.entries()) {
    if (length > 0 && remaining <= length) {
      const start = points[index];
      const end = points[index + 1];
      const fraction = remaining / length;
      return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
    }
    remaining -= length;
  }
  return points[0];
}

function relationshipCell(relationship: CompactRelationship, nodes: ReadonlyMap<string, CompactNode>, dynamic: boolean): string {
  const source = nodes.get(relationship.from)!;
  const target = nodes.get(relationship.to)!;
  const parent = commonParent(source, target, nodes);
  const { x, y } = parent ?? origin;
  const { points, labelBox } = relationship;
  const bends = points.slice(1, -1).map(point => `<mxPoint x="${point.x - x}" y="${point.y - y}"/>`).join("");
  const midpoint = routeMidpoint(points);
  // mxGraph measures the offset of a native edge label from the midpoint of the routed line.
  const offsetX = labelBox.x + labelBox.width / 2 - midpoint.x;
  const offsetY = labelBox.y + labelBox.height / 2 - midpoint.y;
  // Explicit line breaks carry the layout. Draw.io's auto-wrap uses a narrow default edge label width.
  const style = `${labelStyle}noEdgeStyle=1;orthogonalLoop=1;rounded=0;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#486078;fontSize=14;labelBackgroundColor=#ffffff;`
    + connection("exit", points[0], source) + connection("entry", points[points.length - 1], target);
  const id = dynamic ? `step-${relationship.id}` : relationship.id;
  const metadata = attributes({ id, label: labelLines(relationship.displayLines), technology: relationship.technology,
    description: relationship.description });
  return `        <object${metadata}>
          <mxCell edge="1" parent="${parent?.alias ?? "1"}" source="${source.alias}" target="${target.alias}" style="${style}">
            <mxGeometry relative="1" as="geometry">
              <mxPoint x="${offsetX}" y="${offsetY}" as="offset"/>${bends ? `\n              <Array as="points">${bends}</Array>` : ""}
            </mxGeometry>
          </mxCell>
        </object>`;
}

export async function renderC4Drawio(diagram: C4Diagram): Promise<string> {
  const layout = await layoutDiagram(diagram);
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  const nodeCells = layout.nodes.map(node => nodeCell(node, node.parentId === undefined ? undefined : nodes.get(node.parentId)));
  const edgeCells = layout.relationships.map(relationship => relationshipCell(relationship, nodes, diagram.c4Level === "C4Dynamic"));
  const heading = `<b style="font-size:21px">${escapeXml(diagram.title)}</b>`
    + (diagram.caption ? `<br><span style="font-size:12px;color:#475a71">${escapeXml(diagram.caption)}</span>` : "");
  const firstNodeY = layout.nodes.reduce((top, node) => Math.min(top, node.y), layout.height);
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="architecture" name="${escapeXml(diagram.title)}">
    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${layout.width}" pageHeight="${layout.height}" background="#ffffff">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="heading" value="${escapeXml(heading)}" vertex="1" parent="1" connectable="0" style="text;${labelStyle}align=center;verticalAlign=middle;">
          <mxGeometry x="24" y="8" width="${layout.width - 48}" height="${firstNodeY - 24}" as="geometry"/>
        </mxCell>
${[...nodeCells, ...edgeCells].join("\n")}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>\n`;
}
