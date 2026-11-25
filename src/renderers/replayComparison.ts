import type { ReplayRun } from "../model/replayWalkthrough.js";

type Step = ReplayRun["steps"][number];
type Actor = Step["from"];

const panelWidth = 648;
const margin = 24;
const gap = 20;
const width = margin * 2 + gap + panelWidth * 2;
const panelTop = 104;
const firstRow = 79;
const laneStart = 364;
const lanePitch = 76;
const ink = "#172b43";
const muted = "#425970";
const green = "#086454";
const amber = "#924611";

const names: Record<Actor, string> = { application: "App", bridge: "Bridge", kafka: "Kafka", oracle: "Oracle" };
const ownerNames = { application: "Application server", bridge: "Integration bridge" };

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(x: number, y: number, value: string, size: number, options: { color?: string; weight?: number; anchor?: "middle" | "end" } = {}): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? "start"}" fill="${options.color ?? ink}">${xml(value)}</text>`;
}

// Reserve room for the timeline when an action label includes a long offset.
function labelLines(label: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    if (line && line.length + word.length + 1 > 30) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return [...lines, line];
}

function durableState(state: Pick<Step, "rowCount" | "nextOffset">): string {
  const noun = state.rowCount === 1 ? "row" : "rows";
  return `${state.rowCount} Oracle ${noun} · next Kafka offset ${state.nextOffset}`;
}

// Draw the arrowhead explicitly. Both SVG readers and PNG exporters retain its direction.
function interaction(x1: number, x2: number, y: number, color: string): string {
  const self = x1 === x2;
  const direction = x2 > x1 ? 1 : -1;
  const tipY = self ? y + 5 : y;
  const tipX = x2 - direction * 1.5;
  const body = self
    ? `M${x1} ${y - 6} h16 v11 H${tipX + 6}`
    : `M${x1} ${y} H${tipX - direction * 6}`;
  return `<path d="${body}" stroke="${color}" stroke-width="2" fill="none"/><circle cx="${x1}" cy="${self ? y - 6 : y}" r="2.8" fill="${color}"/><path d="M${tipX} ${tipY} l${-direction * 7} -4 v8 Z" fill="${color}"/>`;
}

function renderPanel(run: ReplayRun, actors: Actor[], left: number) {
  const lane = (actor: Actor) => laneStart + actors.indexOf(actor) * lanePitch;
  const afterRestart = run.scenario === "restart-after-commit";
  const checkpointed = run.steps.some(step => step.kind === "checkpoint");
  const title = afterRestart ? "Restart after Oracle commit" : checkpointed ? "Successful delivery" : "Delivery without restart";
  const parts = [
    text(18, 32, title, 24, { weight: 700 }),
    text(18, 65, "Step", 14, { color: muted, weight: 700 }),
    ...actors.map(actor => text(lane(actor), 65, names[actor], 15, { anchor: "middle", color: muted, weight: 700 })),
  ];
  const rows: string[] = [];
  let top = firstRow;
  for (const [index, step] of run.steps.entries()) {
    const interrupted = step.kind === "restart" || step.kind === "acknowledgment-open";
    const durable = step.kind === "commit" || step.kind === "duplicate" || step.kind === "checkpoint";
    const color = interrupted ? amber : durable ? green : ink;
    const context = interrupted || step.kind === "commit" || step.kind === "duplicate" ? durableState(step) : undefined;
    const lines = labelLines(step.label);
    const height = 38 + 20 * (lines.length - 1) + (context ? 19 : 0);
    const center = top + height / 2;
    const labelY = center - ((lines.length - 1) * 20 + (context ? 19 : 0)) / 2 + 6;
    rows.push(`<g><title>Step ${index + 1}, attempt ${step.attempt}: ${xml(names[step.from])} → ${xml(names[step.to])}. ${xml(step.label)}. ${durableState(step)}.</title>`);
    if (interrupted) parts.push(`<rect x="1" y="${top}" width="${panelWidth - 2}" height="${height}" fill="#fff3e5"/>`);
    rows.push(text(18, labelY, String(index + 1), 15, { color, weight: 700 }));
    lines.forEach((line, i) => rows.push(text(49, labelY + i * 20, line, 17, { color, weight: interrupted || durable ? 700 : 400 })));
    if (context) rows.push(text(49, labelY + lines.length * 20 - 1, context, 14, { color: muted }));
    rows.push(interaction(lane(step.from), lane(step.to), center, color), "</g>");
    top += height;
  }
  for (const actor of actors) {
    parts.push(`<line x1="${lane(actor)}" x2="${lane(actor)}" y1="${firstRow - 3}" y2="${top}" stroke="#b7c7d2" stroke-dasharray="3 4"/>`);
  }
  const height = top + 55;
  const summary = checkpointed ? "Checkpoint saved" : "Checkpoint held";
  parts.push(...rows,
    `<line x1="1" x2="${panelWidth - 1}" y1="${top + 2}" y2="${top + 2}" stroke="#cbd9de"/>`,
    text(18, top + 34, summary, 17, { color: checkpointed ? green : amber, weight: 700 }),
    text(panelWidth - 18, top + 34, durableState(run.final), 16, { anchor: "end" }),
  );
  return {
    height,
    svg: `<g transform="translate(${left} ${panelTop})" role="group" aria-label="${xml(title)}"><rect width="${panelWidth}" height="${height}" rx="10" fill="white" stroke="#c1cfd8"/>${parts.join("\n")}</g>`,
  };
}

/** Each column follows one execution trace. Actor order matches the direction of event delivery. */
export function renderReplayComparison(success: ReplayRun, replay: ReplayRun): string {
  if (success.scenario !== "success" || replay.scenario !== "restart-after-commit" || success.placement !== replay.placement || success.checkpointOwner !== replay.checkpointOwner) {
    throw new Error("Compare success and restart-after-commit traces for the same placement and checkpoint owner.");
  }
  const upstream = success.placement === "before-kafka";
  const actors: Actor[] = upstream ? ["bridge", "kafka", "application", "oracle"] : ["kafka", "bridge", "application", "oracle"];
  const panels = [renderPanel(success, actors, margin), renderPanel(replay, actors, margin + panelWidth + gap)];
  const title = upstream ? "Bridge before Kafka" : "Bridge after Kafka";
  const owner = ownerNames[success.checkpointOwner];
  const description = upstream ? "The bridge publishes. The application consumes from Kafka and writes to Oracle RAC." : "The bridge consumes from Kafka. The application writes the delivered event to Oracle RAC.";
  const height = panelTop + Math.max(...panels.map(panel => panel.height)) + margin;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description" font-family="Arial, Helvetica, sans-serif">
<title id="title">${title} — delivery and replay</title>
<desc id="description">${description} Kafka checkpoint owner: ${owner}. Numbered interactions read from top to bottom in each panel. Each arrow starts at the sending actor's dot and ends at its recipient.</desc>
<rect width="${width}" height="${height}" fill="#f6f9fa"/>
${text(margin, 43, title, 33, { weight: 700 })}
${text(margin, 74, description, 19, { color: muted })}
${text(width - margin, 36, "Kafka checkpoint owner", 16, { anchor: "end", color: muted })}
${text(width - margin, 64, owner, 23, { anchor: "end", weight: 700, color: green })}
${panels.map(panel => panel.svg).join("\n")}
</svg>\n`;
}
