import { createRequire } from "node:module";
import type { ELK as ElkInstance, ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import sharp from "sharp";
import { renderC4Mermaid, type C4Diagram, type DiagramNode, type DiagramRelationship } from "./c4Mermaid.js";
import { diagramExportScript } from "./diagramExports.js";

const ElkConstructor = createRequire(import.meta.url)("elkjs/lib/elk.bundled.js") as new () => ElkInstance;

interface Point { x: number; y: number }
interface Box extends Point { width: number; height: number }
export interface CompactNode extends DiagramNode, Box { alias: string; titleLines: string[]; technologyLines: string[] }
export interface CompactRelationship extends DiagramRelationship {
  id: string;
  points: Point[];
  labelBox: Box;
  displayLines: string[];
}
export interface CompactLayout {
  width: number;
  height: number;
  direction: "DOWN" | "RIGHT";
  nodes: CompactNode[];
  relationships: CompactRelationship[];
}

const kinds: Record<DiagramNode["type"], string> = {
  Component: "Component", Container: "Container", ContainerDb: "Database",
  System: "Software system", System_Ext: "External system", ExternalSystem: "External system", Person: "Person",
};
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]!);

function wrap(text: string, width: number): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (line && Array.from(`${line} ${word}`).length > width) { result.push(line); line = ""; }
    const characters = Array.from(word);
    while (characters.length > width) {
      let split = width;
      characters.slice(Math.floor(width / 2), width).forEach((character, index) => {
        if (/[/_.:-]/.test(character)) split = Math.floor(width / 2) + index + 1;
      });
      result.push(characters.splice(0, split).join(""));
    }
    const rest = characters.join("");
    if (rest) line = line ? `${line} ${rest}` : rest;
  }
  if (line) result.push(line);
  return result;
}

// Use the same font and exact wrapped lines for measurement and SVG output.
// Padding also accommodates small browser/font-substitution differences.
async function textWidth(lines: string[], size: number): Promise<number> {
  if (!lines.length) return 0;
  const metadata = await sharp({ text: { text: lines.map(xml).join("\n"), font: `Arial ${size}`, dpi: 72, rgba: true } }).metadata();
  return metadata.width ?? 0;
}

function svgText(lines: string[], x: number, y: number, size: number, lineHeight: number, className: string): string {
  return `<text class="${className}" x="${x}" y="${y}" font-size="${size}" text-anchor="middle">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;
}

async function layoutDiagram(diagram: C4Diagram): Promise<CompactLayout> {
  const nodes: CompactNode[] = await Promise.all(diagram.nodes.map(async (node, index) => {
    const titleLines = wrap(node.label, 23);
    const technologyLines = wrap(node.technology ?? "", 28);
    const width = Math.ceil(Math.max(180, await textWidth(titleLines, 16) + 30, await textWidth(technologyLines, 12) + 28));
    const height = Math.max(84, 36 + titleLines.length * 20 + technologyLines.length * 16);
    return { ...node, alias: `n${index}`, x: 0, y: 0, width, height, titleLines, technologyLines };
  }));
  const aliases = new Map(nodes.map(node => [node.id, node.alias]));
  const relations = await Promise.all(diagram.relationships.map(async (relationship, index) => {
    const id = `R${String(index + 1).padStart(2, "0")}`;
    const displayLines = wrap(`${id} ${relationship.label}`, 24);
    const width = Math.max(40, await textWidth(displayLines, 14) + 16);
    const height = displayLines.length * 18 + 8;
    return { ...relationship, id, displayLines, width, height };
  }));
  const elk = new ElkConstructor();
  const candidates: Array<{ direction: "DOWN" | "RIGHT"; graph: ElkNode; score: number }> = [];
  for (const direction of ["DOWN", "RIGHT"] as const) {
    const graph = await elk.layout<ElkNode>({
      id: "architecture",
      layoutOptions: {
        "elk.algorithm": "layered", "elk.direction": direction, "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "24", "elk.spacing.edgeEdge": "10",
        "elk.layered.spacing.nodeNodeBetweenLayers": "45", "elk.layered.spacing.edgeNodeBetweenLayers": "12",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "10", "elk.layered.mergeEdges": "false",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.padding": "[top=16,left=16,bottom=16,right=16]",
      },
      children: nodes.map(node => ({ id: node.alias, width: node.width, height: node.height })),
      edges: relations.map(relationship => ({
        id: relationship.id, sources: [aliases.get(relationship.from)!], targets: [aliases.get(relationship.to)!],
        labels: [{ text: relationship.displayLines.join("\n"), width: relationship.width, height: relationship.height,
          layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }],
      })),
    });
    const width = graph.width!, height = graph.height!;
    // Balance area and aspect ratio; avoid another extremely wide overview.
    const score = width * height * (1 + Math.abs(Math.log(width / height / 1.2)));
    candidates.push({ direction, graph, score });
  }
  const { graph, direction } = candidates.sort((a, b) => a.score - b.score)[0];
  const titleLines = wrap(diagram.title.replace(/\s+/g, " "), 90);
  const headerExtra = Math.max(0, titleLines.length - 1) * 24;
  const width = Math.ceil(Math.max(graph.width! + 48, await textWidth(titleLines, 21) + 48));
  const offset = { x: (width - graph.width!) / 2, y: 88 + headerExtra };
  const positionedNodes = nodes.map(node => {
    const position = graph.children!.find(candidate => candidate.id === node.alias)!;
    return { ...node, x: position.x! + offset.x, y: position.y! + offset.y };
  });
  const positionedRelations = relations.map(relationship => {
    const edge = (graph.edges as ElkExtendedEdge[]).find(candidate => candidate.id === relationship.id)!;
    if (edge.sections?.length !== 1) throw new Error(`Unexpected route sections for ${relationship.id}`);
    const section = edge.sections[0];
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .map(point => ({ x: point.x + offset.x, y: point.y + offset.y }));
    const box = edge.labels![0];
    return { id: relationship.id, from: relationship.from, to: relationship.to, label: relationship.label,
      technology: relationship.technology, displayLines: relationship.displayLines, points,
      labelBox: { x: box.x! + offset.x, y: box.y! + offset.y, width: box.width!, height: box.height! } };
  });
  return { width, height: Math.ceil(graph.height! + 112 + headerExtra), direction,
    nodes: positionedNodes, relationships: positionedRelations };
}

function drawSvg(diagram: C4Diagram, layout: CompactLayout): string {
  const titleLines = wrap(diagram.title.replace(/\s+/g, " "), 90);
  const title = svgText(titleLines, layout.width / 2, 28, 21, 24, "diagram-title");
  const paths = layout.relationships.map(relationship => {
    const d = relationship.points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const description = `${relationship.id}: ${relationship.from} → ${relationship.to}. ${relationship.label}${relationship.technology ? ` [${relationship.technology}]` : ""}`;
    return `<g class="edge" data-edge-id="${relationship.id}"><title>${xml(description)}</title><path class="edge-halo" d="${d}"/><path class="flowchart-link" id="${relationship.id}" data-edge-id="${relationship.id}" d="${d}" marker-end="url(#arrow)"/></g>`;
  }).join("");
  const nodeShapes = layout.nodes.map(node => {
    const external = node.type === "System_Ext" || node.type === "ExternalSystem";
    const fullText = [node.label, node.technology, node.description].filter(Boolean).join(" — ");
    const titleY = node.y + 38;
    const technologyY = titleY + node.titleLines.length * 20 + 2;
    return `<g class="node${external ? " external" : ""}" id="component-${node.alias}" data-node-id="${xml(node.id)}" tabindex="0" role="button" aria-label="${xml(`Show connections for ${node.label}`)}"><title>${xml(fullText)}</title><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="5"/>${svgText([kinds[node.type]], node.x + node.width / 2, node.y + 17, 11, 14, "node-kind")}${svgText(node.titleLines, node.x + node.width / 2, titleY, 16, 20, "node-title")}${svgText(node.technologyLines, node.x + node.width / 2, technologyY, 12, 16, "node-technology")}</g>`;
  }).join("");
  const labels = layout.relationships.map(relationship => {
    const box = relationship.labelBox;
    return `<g class="edgeLabel" data-edge-id="${relationship.id}"><title>${xml(`${relationship.id}: ${relationship.label}${relationship.technology ? ` [${relationship.technology}]` : ""}`)}</title><g class="label" data-id="${relationship.id}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="3"/>${svgText(relationship.displayLines, box.x + box.width / 2, box.y + 16, 14, 18, "edge-label-text")}</g></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" data-engine="elk" role="img" aria-labelledby="diagram-title diagram-description"><title id="diagram-title">${xml(diagram.title)}</title><desc id="diagram-description">${layout.nodes.length} architecture nodes and ${layout.relationships.length} directed relationships. Select a component in the interactive view to trace its connections.</desc><defs><marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#4d657c"/></marker></defs><style>
text{font-family:Arial,Helvetica,sans-serif;fill:#172b43}.diagram-title{font-weight:500}.node rect{fill:#e7f0fb;stroke:#5381b7;stroke-width:1.2}.node.external rect{fill:#f0f2f5;stroke:#818d9d}.node-kind,.node-technology{fill:#4a5e76}.edge-halo,.flowchart-link{fill:none;stroke-linejoin:round}.edge-halo{stroke:white;stroke-width:5}.flowchart-link{stroke:#4d657c;stroke-width:1.5}.edgeLabel rect{fill:white}.node:focus rect{stroke:#174fbb;stroke-width:2.5}.node{cursor:pointer}.edge,.edgeLabel{cursor:pointer}.dimmed{opacity:.12}.selected rect{stroke:#174fbb;stroke-width:2.5}.outgoing .flowchart-link{stroke:#155dd5;stroke-width:2.5}.incoming .flowchart-link{stroke:#a94a10;stroke-width:2.5}.outgoing .edge-label-text{fill:#124da7}.incoming .edge-label-text{fill:#8f3e0d}
</style><rect class="background" width="100%" height="100%" fill="white"/>${title}<text x="${layout.width / 2}" y="${55 + Math.max(0, titleLines.length - 1) * 24}" text-anchor="middle" font-size="12">${layout.nodes.length} nodes · ${layout.relationships.length} relationships · R IDs identify individual arrows</text>${paths}${nodeShapes}${labels}</svg>`;
}

function drawHtml(diagram: C4Diagram, svg: string, layout: CompactLayout): string {
  const data = JSON.stringify(layout).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(diagram.title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#172b43;background:#f5f7fa}header{padding:14px 20px;background:white;border-bottom:1px solid #dbe2eb;display:flex;gap:16px;align-items:center;flex-wrap:wrap}h1{font-size:18px;margin:0;font-weight:600}header span{font-size:13px;color:#52657d}button{background:white;color:#183c6b;border:1px solid #afbed1;border-radius:5px;padding:7px 11px;cursor:pointer}main{display:grid;grid-template-columns:minmax(0,1fr) 310px;height:calc(100vh - 67px)}#canvas{overflow:auto;background:white;padding:12px}#canvas>svg{display:block;width:100%;height:auto;min-width:900px}aside{overflow:auto;padding:18px;background:#f5f7fa;border-left:1px solid #dbe2eb}aside h2{font-size:17px;margin:0 0 9px}aside p{font-size:13px;line-height:1.5;color:#52657d}#connections{padding-left:20px;font-size:13px;line-height:1.5}#connections li{margin:0 0 14px}#connections button{border:0;background:none;padding:0;text-align:left;line-height:1.5;color:#172b43}#connections small{display:block;color:#52657d}#details{white-space:pre-line}.legend{display:flex;gap:14px;font-size:12px;margin:12px 0}.legend span:first-child{color:#155dd5}.legend span:last-child{color:#a94a10}@media(max-width:900px){main{grid-template-columns:1fr;height:auto}#canvas{max-height:75vh}aside{border-left:0;border-top:1px solid #dbe2eb}}
</style></head><body><header><h1>${xml(diagram.title)}</h1><span>Select a component or arrow to trace its connections.</span><button id="reset-view">Show all</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="export-png" title="Save the full diagram at 2× resolution with current highlighting">Export PNG</button><button id="export-svg" title="Save the full scalable diagram with current highlighting">Export SVG</button><span id="export-status" role="status" aria-live="polite"></span></header><main><div id="canvas">${svg}</div><aside aria-live="polite"><h2 id="selection-title">All connections</h2><p id="details">Select a component to highlight its incoming and outgoing arrows. Select an arrow or relationship below to isolate it.</p><div class="legend"><span>Blue: outgoing</span><span>Brown: incoming</span></div><ol id="connections"></ol></aside></main><script>
const graph=${data};
const root=document.querySelector('#canvas svg'),title=document.getElementById('selection-title'),details=document.getElementById('details'),list=document.getElementById('connections');
let locked=null,zoom=1;
const nodes=new Map(graph.nodes.map(node=>[node.id,node]));
function show(selection){
 const related=selection?.kind==='node'?graph.relationships.filter(edge=>edge.from===selection.id||edge.to===selection.id):selection?.kind==='edge'?graph.relationships.filter(edge=>edge.id===selection.id):graph.relationships;
 const ids=new Set(related.map(edge=>edge.id)),visibleNodes=new Set(related.flatMap(edge=>[edge.from,edge.to]));
 if(selection?.kind==='node')visibleNodes.add(selection.id);
 root.querySelectorAll('.node').forEach(element=>{const id=element.dataset.nodeId;element.classList.toggle('dimmed',!!selection&&!visibleNodes.has(id));element.classList.toggle('selected',selection?.kind==='node'&&id===selection.id);});
 root.querySelectorAll('.edge,.edgeLabel').forEach(element=>{const edge=graph.relationships.find(edge=>edge.id===element.dataset.edgeId),active=ids.has(edge.id);element.classList.toggle('dimmed',!!selection&&!active);element.classList.toggle('outgoing',!!selection&&active&&(selection.kind==='edge'||edge.from===selection.id));element.classList.toggle('incoming',!!selection&&active&&selection.kind==='node'&&edge.to===selection.id&&edge.from!==selection.id);});
 const node=selection?.kind==='node'?nodes.get(selection.id):null,edge=selection?.kind==='edge'?related[0]:null;
 title.textContent=node?.label??(edge?edge.id+' · '+edge.label:'All connections');details.textContent=node?[node.technology,node.description,related.length+' connected relationships'].filter(Boolean).join('\\n'):edge?[nodes.get(edge.from).label+' → '+nodes.get(edge.to).label,edge.technology].filter(Boolean).join('\\n'):'Select a component to highlight its incoming and outgoing arrows. Select an arrow or relationship below to isolate it.';
 list.replaceChildren();for(const edge of related){const item=document.createElement('li'),button=document.createElement('button'),small=document.createElement('small');button.textContent=edge.id+' · '+nodes.get(edge.from).label+' → '+nodes.get(edge.to).label;small.textContent=edge.label+(edge.technology?' · '+edge.technology:'');button.append(small);button.addEventListener('click',()=>{locked={kind:'edge',id:edge.id};show(locked);});item.append(button);list.append(item);}
}
root.querySelectorAll('.node').forEach(element=>{const select=()=>{locked={kind:'node',id:element.dataset.nodeId};show(locked);};element.addEventListener('click',select);element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});element.addEventListener('mouseenter',()=>{if(!locked)show({kind:'node',id:element.dataset.nodeId});});element.addEventListener('mouseleave',()=>{if(!locked)show(null);});});
root.querySelectorAll('.edge,.edgeLabel').forEach(element=>element.addEventListener('click',()=>{locked={kind:'edge',id:element.dataset.edgeId};show(locked);}));
function reset(){locked=null;show(null);}document.getElementById('reset-view').addEventListener('click',reset);document.addEventListener('keydown',event=>{if(event.key==='Escape')reset();});root.querySelector('.background').addEventListener('click',reset);
function setZoom(value){zoom=Math.max(.5,Math.min(3,value));root.style.width=zoom*100+'%';root.style.minWidth=zoom*900+'px';}document.getElementById('zoom-in').addEventListener('click',()=>setZoom(zoom*1.25));document.getElementById('zoom-out').addEventListener('click',()=>setZoom(zoom/1.25));show(null);
${diagramExportScript}
</script></body></html>`;
}

export async function renderCompactC4(diagram: C4Diagram): Promise<{ svg: string; png: Buffer; html: string; layout: CompactLayout }> {
  renderC4Mermaid(diagram); // Share the existing input validation and compatibility contract.
  const layout = await layoutDiagram(diagram);
  const svg = drawSvg(diagram, layout);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { svg, png, html: drawHtml(diagram, svg, layout), layout };
}
