import sharp from "sharp";
import type { C4Diagram } from "../model/diagram.js";
import { renderCompactC4, textWidth, wrap, xml } from "./compactC4.js";

// Keep whitespace and punctuation in file names, including across a line break.
function pathLines(label: string) {
  const chars = Array.from(label);
  const lines: string[] = [];
  while (chars.length > 36) {
    const lastSlash = chars.slice(0, 36).lastIndexOf("/");
    lines.push(chars.splice(0, lastSlash >= 18 ? lastSlash + 1 : 36).join(""));
  }
  return [...lines, chars.join("")];
}

function text(lines: string[], x: number, y: number, size: number, lineHeight: number, color = "#172b43") {
  return `<text xml:space="preserve" x="${x}" y="${y}" font-size="${size}" fill="${color}">${lines.map((line, i) =>
    `<tspan x="${x}" dy="${i ? lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;
}

export async function renderFileImpactDiagram(diagram: C4Diagram, arrowIds: string[]) {
  const fanIn = new Map<string, number>();
  for (const edge of diagram.relationships) fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  // A compact node has an 84px face; more than eight arrowheads can no longer fit separately.
  if (![...fanIn.values()].some(count => count > 8)) return renderCompactC4(diagram);

  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  const rows = diagram.relationships.map((edge, index) => {
    const importer = nodes.get(edge.from)!, dependency = nodes.get(edge.to)!;
    return { arrow: arrowIds[index], reference: edge.label, importer: pathLines(importer.label),
      dependency: pathLines(dependency.label), distance: importer.technology ?? "" };
  });
  const [sourceWidth, targetWidth, referenceWidth] = await Promise.all([
    textWidth(["Importer", ...rows.flatMap(row => row.importer)], 15),
    textWidth(["Dependency", ...rows.flatMap(row => row.dependency)], 15),
    textWidth(["Reference", ...rows.map(row => row.reference)], 14),
  ]);
  const left = 24, importerX = 78, arrowX = importerX + sourceWidth + 20;
  const dependencyX = arrowX + 42, referenceX = dependencyX + targetWidth + 28;
  const title = wrap(diagram.title, 78), caption = diagram.caption ?? "";
  const width = Math.ceil(Math.max(referenceX + referenceWidth + left,
    await textWidth(title, 21) + left * 2, await textWidth([caption], 13) + left * 2));
  const captionY = 28 + (title.length - 1) * 24 + 24;
  const headingY = captionY + 32;
  const headings: [string, number][] = [["ID", left], ["Importer", importerX], ["Dependency", dependencyX], ["Reference", referenceX]];
  let top = headingY + 12;
  const groups = rows.map((row, index) => {
    const height = 15 + 19 * Math.max(row.importer.length, row.dependency.length) + 16;
    const y = top + 20;
    const group = `<g data-edge-id="${xml(row.arrow)}"><rect x="12" y="${top}" width="${width - 24}" height="${height}" fill="${index % 2 ? "#fff" : "#eef4fb"}"/>
      ${text([row.arrow], left, y, 13, 16, "#355575")}${text(row.importer, importerX, y, 15, 19)}
      ${text([row.distance], importerX, y + row.importer.length * 19, 12, 15, "#4a5e76")}
      <path d="M${arrowX} ${y - 5}h24m-6 -5l6 5 -6 5" fill="none" stroke="#426485" stroke-width="1.6"/>
      ${text(row.dependency, dependencyX, y, 15, 19)}${text([row.reference], referenceX, y, 14, 17)}</g>`;
    top += height;
    return group;
  });
  const height = top + 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" font-family="Arial,Helvetica,sans-serif">
    <title>${xml(diagram.title)}</title><desc>${xml(caption)}</desc><rect width="100%" height="100%" fill="white"/>
    ${text(title, left, 28, 21, 24)}${text([caption], left, captionY, 13, 16, "#4a5e76")}
    ${headings.map(([name, x]) => text([name], x, headingY, 13, 16, "#355575")).join("")}
    ${groups.join("")}</svg>`;
  return { svg, png: await sharp(Buffer.from(svg)).png().toBuffer() };
}
