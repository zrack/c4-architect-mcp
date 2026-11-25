import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { diagramSchema, type C4Diagram } from "./diagram.js";

const text = z.string().trim().min(1);
const reference = z.string().refine(value => Boolean(value.trim()), "An element ID is required.");
const evidence = z.object({ view: text, meaning: text });
const evidenceSchema = z.union([
  evidence.extend({ node: reference }).strict(),
  evidence.extend({ from: reference, to: reference, label: z.string() }).strict(),
]);
const viewSchema = z.object({ id: text, title: text, model: text }).strict();
const claimSchema = z.object({
  id: text, kind: z.enum(["fact", "proposal"]), statement: text, value: text,
  evidence: z.array(evidenceSchema).min(1),
}).strict();
const noteSchema = z.object({ view: text, node: reference }).strict();
const questionSchema = z.object({
  id: text, question: text, views: z.array(text).min(1), notes: z.array(noteSchema).default([]),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), title: text, views: z.array(viewSchema).min(1),
  claims: z.array(claimSchema), questions: z.array(questionSchema),
}).strict();
const scenarioSchema = z.object({
  title: text,
  changes: z.array(z.object({ claim: text, value: text, reason: text }).strict()).default([]),
  answers: z.array(z.object({ question: text, answer: text }).strict()).default([]),
}).strict();

type Question = Omit<z.infer<typeof questionSchema>, "notes">;
type AnsweredQuestion = Question & {
  answer: string;
  notes: { view: string; node: string; description: string }[];
};
type Evidence = z.infer<typeof evidenceSchema>;
type Claim = z.infer<typeof claimSchema>;
interface ClaimChange {
  claim: string;
  kind: Claim["kind"];
  statement: string;
  before: string;
  after: string;
  reason: string;
}
interface ViewReview extends z.infer<typeof viewSchema> {
  status: "review" | "unchanged";
  findings: (ClaimChange & { meaning: string; anchor: string })[];
  retainedClaims: { claim: string; statement: string; value: string; kind: Claim["kind"] }[];
}
export interface WalkthroughReview {
  title: string;
  scenario: string;
  views: ViewReview[];
  changes: ClaimChange[];
  openQuestions: Question[];
  answeredQuestions: AnsweredQuestion[];
}

async function readModel<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  try {
    if (!(await fs.stat(file)).isFile()) throw new Error("Expected a regular JSON file.");
    const parsed = schema.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    throw new Error(`${issue.path.join(".")}: ${issue.message}`);
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function indexBy<T>(items: T[], key: (item: T) => string, kind: string): Map<string, T> {
  const entries = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (entries.has(id)) throw new Error(`Duplicate ${kind}: ${id}`);
    entries.set(id, item);
  }
  return entries;
}

function assertInside(directory: string, file: string, input: string) {
  const relative = path.relative(directory, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Diagram model is outside the walkthrough directory: ${input}`);
  }
}

async function diagramFile(directory: string, input: string) {
  if (path.posix.isAbsolute(input) || /^[a-z]:/i.test(input)) {
    throw new Error(`Expected a relative diagram model path: ${input}`);
  }
  const file = path.resolve(directory, input);
  assertInside(directory, file, input);
  const actual = await fs.realpath(file);
  assertInside(directory, actual, input);
  return actual;
}

function resolveEvidence(diagram: C4Diagram, ref: Evidence, claim: string): string {
  const where = `claim "${claim}" in view "${ref.view}"`;
  function nodeLabel(id: string) {
    const node = diagram.nodes.find(node => node.id === id);
    if (!node) throw new Error(`Unknown evidence node "${id}" for ${where}.`);
    return `${node.label} [${id}]`;
  }
  if ("node" in ref) return nodeLabel(ref.node);

  const matches = diagram.relationships.flatMap((edge, index) =>
    edge.from === ref.from && edge.to === ref.to && edge.label === ref.label ? [index] : []);
  if (matches.length !== 1) {
    throw new Error(`Expected one directed relationship ${ref.from} → ${ref.to} labeled "${ref.label}" for ${where}, found ${matches.length}.`);
  }
  const ordinal = matches[0] + 1;
  const arrow = diagram.c4Level === "C4Dynamic" ? `Step ${ordinal}` : `R${String(ordinal).padStart(2, "0")}`;
  return `${arrow} · ${nodeLabel(ref.from)} → ${nodeLabel(ref.to)} · ${ref.label}`;
}

export async function reviewWalkthrough(manifestPath: string, scenarioPath: string): Promise<WalkthroughReview> {
  const [manifest, scenario] = await Promise.all([
    readModel(manifestPath, manifestSchema), readModel(scenarioPath, scenarioSchema),
  ]);
  const directory = path.dirname(await fs.realpath(manifestPath));
  const views: ViewReview[] = manifest.views.map(view => ({
    ...view, model: view.model.replace(/\\/g, "/"), status: "unchanged", findings: [], retainedClaims: [],
  }));
  const viewsById = indexBy(views, view => view.id, "view ID");
  const claimsById = indexBy(manifest.claims, claim => claim.id, "claim ID");
  const questionsById = indexBy(manifest.questions, question => question.id, "question ID");
  const proposed = indexBy(scenario.changes, change => change.claim, "change for claim");
  const answers = indexBy(scenario.answers, answer => answer.question, "answer for question");
  for (const id of proposed.keys()) {
    if (!claimsById.has(id)) throw new Error(`Scenario changes unknown claim: ${id}`);
  }
  for (const id of answers.keys()) {
    if (!questionsById.has(id)) throw new Error(`Scenario answers unknown question: ${id}`);
  }
  const diagrams = new Map<string, C4Diagram>();
  for (const view of views) {
    const file = await diagramFile(directory, view.model);
    diagrams.set(view.id, await readModel(file, diagramSchema));
  }

  const changes: ClaimChange[] = [];
  for (const claim of manifest.claims) {
    const update = proposed.get(claim.id);
    const change = update && update.value !== claim.value ? {
      claim: claim.id, kind: claim.kind, statement: claim.statement,
      before: claim.value, after: update.value, reason: update.reason,
    } : undefined;
    if (change) changes.push(change);
    const retainedIn = new Set<string>();
    // Resolve even unchanged claims so a stale anchor cannot produce a clean review.
    for (const ref of claim.evidence) {
      const view = viewsById.get(ref.view);
      if (!view) throw new Error(`Claim "${claim.id}" references unknown view: ${ref.view}`);
      const anchor = resolveEvidence(diagrams.get(view.id)!, ref, claim.id);
      if (change) {
        view.status = "review";
        view.findings.push({ ...change, meaning: ref.meaning, anchor });
      } else if (!retainedIn.has(view.id)) {
        view.retainedClaims.push({ claim: claim.id, statement: claim.statement, value: claim.value, kind: claim.kind });
        retainedIn.add(view.id);
      }
    }
  }

  const openQuestions: Question[] = [];
  const answeredQuestions: AnsweredQuestion[] = [];
  for (const { notes, ...question } of manifest.questions) {
    for (const view of indexBy(question.views, id => id, `view on question "${question.id}"`).keys()) {
      if (!viewsById.has(view)) throw new Error(`Question "${question.id}" references unknown view: ${view}`);
    }
    const resolvedNotes = notes.map(note => {
      const diagram = diagrams.get(note.view);
      if (!diagram) throw new Error(`Note on "${question.id}" references unknown view: ${note.view}`);
      const node = diagram.nodes.find(node => node.id === note.node);
      if (!node?.description?.trim()) {
        throw new Error(`Note on "${question.id}" needs a described node "${note.node}" in view "${note.view}".`);
      }
      return { ...note, description: node.description };
    });
    const answer = answers.get(question.id);
    if (answer) answeredQuestions.push({ ...question, answer: answer.answer, notes: resolvedNotes });
    else openQuestions.push(question);
  }
  return { title: manifest.title, scenario: scenario.title, views, changes, openQuestions, answeredQuestions };
}
