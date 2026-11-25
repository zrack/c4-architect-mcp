import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { diagramSchema, type DiagramNode } from "../model/diagram.js";
import { runReplayWalkthrough, type ReplayParticipant, type ReplayRun, type ReplayWalkthrough } from "../model/replayWalkthrough.js";
import { renderReplayComparison } from "./replayComparison.js";
import { markdownText } from "./sourceLinks.js";

const actors = {
  kafka: { id: "kafka", label: "Kafka", type: "System_Ext" },
  bridge: { id: "bridge", label: "Integration bridge", type: "Container" },
  application: { id: "application", label: "Application server", type: "Container" },
  oracle: { id: "oracle", label: "Oracle RAC datastore", type: "ContainerDb" },
} satisfies Record<ReplayParticipant, DiagramNode>;

const placementNames = { "before-kafka": "Bridge before Kafka", "after-kafka": "Bridge after Kafka" };
const scenarioNames = {
  success: "Successful delivery",
  "failed-write": "Failed Oracle write",
  "restart-after-commit": "Restart after commit",
};

function caseName(run: ReplayRun) {
  return run.scenario === "success" && run.final.redeliveryPending ? "Delivery awaiting acknowledgment" : scenarioNames[run.scenario];
}

function dynamicModel(run: ReplayRun, eventId: string) {
  const participants = new Set(run.steps.flatMap(step => [step.from, step.to]));
  return diagramSchema.parse({
    c4Level: "C4Dynamic",
    title: `${placementNames[run.placement]} · ${caseName(run)}`,
    caption: `Event ${eventId}. ${actors[run.checkpointOwner].label} owns the Kafka checkpoint.`,
    nodes: [...participants].map(id => actors[id]),
    relationships: run.steps.map(step => ({
      from: step.from,
      to: step.to,
      label: step.label,
      description: `Attempt ${step.attempt}. Oracle rows: ${step.rowCount}. Kafka next offset: ${step.nextOffset}.`,
    })),
  });
}

type Comparison = {
  placement: ReplayRun["placement"]; svg: string; png: string; successModel: string; replayModel: string;
};

function reportMarkdown(walkthrough: ReplayWalkthrough, comparisons: Comparison[]): string {
  const { event, bridgeAcknowledgment, runs } = walkthrough;
  const lines = [
    "# Kafka and Oracle RAC replay walkthrough", "",
    `The local simulation delivers event **${markdownText(event.id)}** at Kafka offset **${event.offset}**. Each case starts with an empty Oracle store and Kafka positioned at that event. The complete business effect is one Oracle row keyed by the event ID. A second delivery of that ID reuses the committed row.`, "",
    bridgeAcknowledgment === "after-commit"
      ? "For the downstream bridge, the sample application acknowledges delivery only after it has confirmed the Oracle commit, including a prior commit for the same event ID. The bridge uses that acknowledgment to checkpoint Kafka."
      : "The downstream bridge has no agreed acknowledgment evidence for an Oracle commit. Its Kafka checkpoint stays at the incoming offset until the design supplies that contract.", "",
    "Kafka's next offset is where its consumer will resume. Oracle's row count measures the durable business effect. The [execution traces](traces.json) record both values after every step.", "",
    "| Placement | Case | Kafka checkpoint owner | At interruption | Final Oracle rows | Final Kafka next offset |",
    "| --- | --- | --- | --- | ---: | ---: |",
  ];
  for (const run of runs) {
    const interruption = run.steps.find(step => step.kind === "rollback" || step.kind === "restart");
    const beforeRetry = interruption ? `${interruption.rowCount} ${interruption.rowCount === 1 ? "row" : "rows"}, next offset ${interruption.nextOffset}` : "—";
    lines.push(`| ${placementNames[run.placement]} | ${caseName(run)} | ${actors[run.checkpointOwner].label} | ${beforeRetry} | ${run.final.rowCount} | ${run.final.nextOffset} |`);
  }
  for (const comparison of comparisons) {
    const title = placementNames[comparison.placement];
    const firstCase = caseName(runs.find(run => run.placement === comparison.placement && run.scenario === "success")!);
    lines.push("", `## ${title}`, "",
      `![${firstCase} beside restart after commit for ${title.toLowerCase()}](${path.basename(comparison.png)})`, "",
      `[Full-size SVG](${path.basename(comparison.svg)}) · [Editable ${firstCase.toLowerCase()} diagram](${path.basename(comparison.successModel)}) · [Editable replay diagram](${path.basename(comparison.replayModel)})`);
  }
  const questions = new Set(runs.flatMap(run => run.openQuestions));
  if (questions.size) {
    lines.push("", "## Open questions", "", ...Array.from(questions, question => `- ${markdownText(question)}`));
  }
  lines.push("", "The fixture tests one event and its Kafka offset. Production behavior depends on the application's transaction, acknowledgment, and duplicate-handling contracts.");
  return lines.join("\n") + "\n";
}

const jsonFile = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

// Stage a complete set before replacing prior artifacts. The fixed staging directory serializes
// writers to the same destination; a failed replacement restores the previous set.
async function saveBundle(directory: string, files: Map<string, string | Buffer>, scenarioPath: string) {
  const input = await fs.stat(scenarioPath);
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, ".c4-replay-write");
  await fs.mkdir(stage).catch(error => {
    if (error.code === "EEXIST") throw new Error(`Replay output is busy or an earlier export was interrupted. Retry after it finishes, or generate the full set in a fresh output directory. Staged files: ${stage}`);
    throw error;
  });
  const existing = new Set<string>();
  const published: string[] = [];
  try {
    for (const [name, contents] of files) {
      const dest = path.join(directory, name);
      const previous = await fs.lstat(dest).catch(error => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (previous) {
        if (!previous.isFile()) throw new Error(`Replay output must be a regular file: ${dest}`);
        if (previous.dev === input.dev && previous.ino === input.ino) throw new Error(`Replay output would overwrite the input scenario: ${dest}`);
        await fs.copyFile(dest, path.join(stage, name + ".bak"));
        existing.add(name);
      }
      await fs.writeFile(path.join(stage, name), contents);
    }
    for (const name of files.keys()) {
      await fs.rename(path.join(stage, name), path.join(directory, name));
      published.push(name);
    }
  } catch (error) {
    for (const name of published.reverse()) {
      const target = path.join(directory, name);
      if (existing.has(name)) await fs.rename(path.join(stage, name + ".bak"), target);
      else await fs.unlink(target);
    }
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export async function writeReplayWalkthrough(scenarioPath: string, outputDirectory: string) {
  const walkthrough = runReplayWalkthrough(JSON.parse(await fs.readFile(scenarioPath, "utf8")));
  const directory = path.resolve(outputDirectory);
  const files = new Map<string, string | Buffer>([["traces.json", jsonFile(walkthrough)]]);
  const comparisons: Comparison[] = [];
  for (const success of walkthrough.runs.filter(run => run.scenario === "success")) {
    const { placement } = success;
    const replay = walkthrough.runs.find(run => run.placement === placement && run.scenario === "restart-after-commit")!;
    const svg = renderReplayComparison(success, replay);
    files.set(`${placement}.svg`, svg);
    files.set(`${placement}.png`, await sharp(Buffer.from(svg)).png().toBuffer());
    for (const run of [success, replay]) files.set(`${placement}-${run.scenario}.json`, jsonFile(dynamicModel(run, walkthrough.event.id)));
    comparisons.push({
      placement, svg: path.join(directory, `${placement}.svg`), png: path.join(directory, `${placement}.png`),
      successModel: path.join(directory, `${placement}-success.json`), replayModel: path.join(directory, `${placement}-restart-after-commit.json`),
    });
  }
  files.set("report.md", reportMarkdown(walkthrough, comparisons));
  await saveBundle(directory, files, scenarioPath);
  return {
    artifacts: { markdown: path.join(directory, "report.md"), traces: path.join(directory, "traces.json"), comparisons },
    runs: walkthrough.runs.map(({ placement, scenario, checkpointOwner, final, openQuestions }) =>
      ({ placement, scenario, checkpointOwner, rowCount: final.rowCount, nextOffset: final.nextOffset, redeliveryPending: final.redeliveryPending, openQuestions })),
  };
}
