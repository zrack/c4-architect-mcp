import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reviewWalkthrough, type WalkthroughReview } from "../model/walkthrough.js";
import { markdownText } from "./sourceLinks.js";

function fileLink(directory: string, file: string, label: string): string {
  const relative = path.relative(directory, file);
  const href = path.isAbsolute(relative) ? pathToFileURL(file).href
    : relative.split(path.sep).map(segment => encodeURIComponent(segment)).join("/");
  return `[${markdownText(label)}](<${href}>)`;
}

function formatReview(review: WalkthroughReview, directory: string, manifest: string, scenario: string): string {
  const { views, changes, answeredQuestions, openQuestions } = review;
  const modelDirectory = path.dirname(manifest);
  const viewLinks = new Map(views.map(view => [view.id, fileLink(directory, path.resolve(modelDirectory, view.model), view.title)]));
  const changeNumbers = new Map(changes.map((change, i) => [change.claim, i + 1]));
  const affected = views.filter(view => view.status === "review").length;
  const annotated = new Set(answeredQuestions.flatMap(question => question.notes.map(note => note.view))).size;
  const lines = [
    `# ${markdownText(review.scenario)}`,
    "",
    `${fileLink(directory, manifest, review.title)} · ${fileLink(directory, scenario, "Scenario input")}`,
    "",
    `**${affected} of ${views.length} ${views.length === 1 ? "diagram" : "diagrams"} ${affected === 1 ? "needs" : "need"} structural review.**`,
    `Baseline wording to revisit in ${annotated} ${annotated === 1 ? "view" : "views"}. ${openQuestions.length} ${openQuestions.length === 1 ? "question stays" : "questions stay"} open.`,
    "",
    "## Scenario changes",
    "",
  ];
  for (const change of changes) {
    const basis = change.kind === "fact" ? "Recorded fact" : "Proposed design";
    lines.push(`${changeNumbers.get(change.claim)}. **${markdownText(change.statement)}** (${basis})`,
      `   - **Baseline** — ${markdownText(change.before)}`,
      `   - **Scenario** — ${markdownText(change.after)}`,
      `   - **Reason** — ${markdownText(change.reason)}`);
  }
  if (!changes.length) lines.push("The scenario retains all recorded claim values.");
  lines.push("", "## Diagram review", "",
    "Each finding links a changed claim to an element in the baseline model. “No change traced” means the scenario changes no claim linked to that view.",
    "", "| View | Structural review | Evidence in the baseline |", "| --- | --- | --- |");
  for (const view of views) {
    const evidence = view.findings.map(finding => {
      const change = changes.length > 1 ? `Change ${changeNumbers.get(finding.claim)} · ` : "";
      return `${change}**${markdownText(finding.anchor)}** — ${markdownText(finding.meaning)}`;
    }).join("<br>");
    const retained = view.retainedClaims.map(claim => `${claim.kind === "fact" ? "Recorded fact" : "Proposed design"} — ${markdownText(claim.value)}`);
    lines.push(`| ${viewLinks.get(view.id)} | ${view.status === "review" ? "**Review**" : "No change traced"} | ${evidence || retained.join("<br>") || "No baseline claim linked to this view."} |`);
  }
  lines.push("", "## Questions answered in this scenario", "");
  for (const question of answeredQuestions) {
    lines.push(`- **${markdownText(question.question)}** ${markdownText(question.answer)}`);
    const notes = new Map<string, string[]>();
    for (const note of question.notes) {
      const occurrences = notes.get(note.description) ?? [];
      occurrences.push(`${viewLinks.get(note.view)} (${markdownText(note.node)})`);
      notes.set(note.description, occurrences);
    }
    for (const [description, occurrences] of notes) {
      lines.push(`  - **Baseline wording to revisit** — ${markdownText(description)} ${occurrences.join(" · ")}`);
    }
  }
  if (!answeredQuestions.length) lines.push("The scenario supplies no new answers.");
  lines.push("", "## Questions that stay open", "");
  for (const question of openQuestions) {
    lines.push(`- **${markdownText(question.question)}** ${question.views.map(view => viewLinks.get(view)).join(" · ")}`);
  }
  if (!openQuestions.length) lines.push("Every question recorded in the walkthrough has a scenario answer.");
  return lines.join("\n") + "\n";
}

export async function writeWalkthroughReview(manifestPath: string, scenarioPath: string, outputPath: string) {
  if (!/\.md$/i.test(outputPath)) throw new Error("Walkthrough review output must end in .md");
  const [manifest, scenario] = await Promise.all([fs.realpath(manifestPath), fs.realpath(scenarioPath)]);
  const review = await reviewWalkthrough(manifest, scenario);
  const markdown = path.resolve(outputPath);
  const destination = await fs.stat(markdown, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (destination) {
    const inputs = [manifest, scenario, ...review.views.map(view => path.resolve(path.dirname(manifest), view.model))];
    const files = await Promise.all(inputs.map(file => fs.stat(file, { bigint: true })));
    if (files.some(file => file.dev === destination.dev && file.ino === destination.ino)) {
      throw new Error("Walkthrough review would overwrite an input manifest, scenario or diagram model");
    }
  }
  await fs.mkdir(path.dirname(markdown), { recursive: true });
  const directory = await fs.realpath(path.dirname(markdown));
  const content = formatReview(review, directory, manifest, scenario);
  const staging = await fs.mkdtemp(path.join(directory, ".c4-walkthrough-"));
  try {
    const staged = path.join(staging, "review.md");
    await fs.writeFile(staged, content, "utf8");
    await fs.rename(staged, path.join(directory, path.basename(markdown)));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return { ...review, artifacts: { markdown } };
}
