import { z } from "zod";

const inputSchema = z.object({
  schemaVersion: z.literal(1),
  event: z.object({
    id: z.string().min(1).refine(id => id === id.trim() && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(id),
      "Use a single-line event ID without control characters or outer whitespace."),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  }).strict(),
  bridgeAcknowledgment: z.enum(["after-commit", "unspecified"]).default("unspecified"),
}).strict();

type Input = z.output<typeof inputSchema>;
type ReplayEvent = Input["event"];
export type BridgePlacement = "before-kafka" | "after-kafka";
export type ReplayScenario = "success" | "failed-write" | "restart-after-commit";
export type CheckpointOwner = "application" | "bridge";
export type ReplayParticipant = CheckpointOwner | "kafka" | "oracle";
export type ReplayStepKind = "publish" | "consume" | "deliver" | "write" | "commit" | "rollback"
  | "restart" | "duplicate" | "acknowledge" | "checkpoint" | "acknowledgment-open";

export interface ReplayStep {
  kind: ReplayStepKind;
  from: ReplayParticipant;
  to: ReplayParticipant;
  label: string;
  attempt: number;
  rowCount: number;
  nextOffset: number;
}

export interface ReplayRun {
  placement: BridgePlacement;
  scenario: ReplayScenario;
  checkpointOwner: CheckpointOwner;
  steps: ReplayStep[];
  final: { rowCount: number; nextOffset: number; storedEventIds: string[]; redeliveryPending: boolean };
  openQuestions: string[];
}

export interface ReplayWalkthrough {
  event: ReplayEvent;
  bridgeAcknowledgment: Input["bridgeAcknowledgment"];
  runs: ReplayRun[];
}

// The consumer's read position and permission to checkpoint disappear on restart.
// The Kafka log, committed group offset and Oracle rows live outside this session.
function startConsumer(nextOffset: number) {
  return { position: nextOffset, durableWriteConfirmed: false };
}

function simulate(input: Input, placement: BridgePlacement, scenario: ReplayScenario): ReplayRun {
  const owner = placement === "before-kafka" ? "application" : "bridge";
  const log = new Map<number, ReplayEvent>();
  const rows = new Map<string, { eventId: string }>();
  let nextOffset = input.event.offset;
  let consumer = startConsumer(nextOffset);
  let attempt = 1;
  const steps: ReplayStep[] = [];
  const openQuestions: string[] = [];

  function record(kind: ReplayStepKind, from: ReplayParticipant, to: ReplayParticipant, label: string) {
    steps.push({ kind, from, to, label, attempt, rowCount: rows.size, nextOffset });
  }

  // In the downstream placement the publisher is outside this walkthrough.
  log.set(input.event.offset, input.event);
  if (placement === "before-kafka") record("publish", "bridge", "kafka", "Publish event to Kafka");

  while (log.has(consumer.position)) {
    const event = log.get(consumer.position)!;
    consumer.position = event.offset + 1;
    record("consume", "kafka", owner, `${attempt === 1 ? "Read" : "Replay"} offset ${event.offset}`);
    if (owner === "bridge") record("deliver", owner, "application", "Deliver event to application");

    record("write", "application", "oracle", "Write row by event ID");
    if (scenario === "failed-write") {
      record("rollback", "oracle", "application", "Roll back the write");
      break;
    }
    // The event ID is the business row's unique key. Creating this single row
    // models the complete atomic effect; a duplicate cannot apply the effect twice.
    if (rows.has(event.id)) {
      record("duplicate", "oracle", "application", "Find existing row by event ID");
    } else {
      rows.set(event.id, { eventId: event.id });
      record("commit", "oracle", "application", "Commit one Oracle row");
    }

    if (owner === "application") consumer.durableWriteConfirmed = true;
    if (scenario === "restart-after-commit" && attempt === 1) {
      const label = owner === "application" ? "Restart before checkpoint" : "Restart before acknowledgment";
      record("restart", owner, owner, label);
      consumer = startConsumer(nextOffset);
      attempt++;
      continue;
    }

    if (owner === "bridge") {
      if (input.bridgeAcknowledgment === "after-commit") {
        // The application's acknowledgment covers both a new commit and a
        // replay for which Oracle confirmed the original row.
        record("acknowledge", "application", owner, "Confirm durable write");
        consumer.durableWriteConfirmed = true;
      } else {
        record("acknowledgment-open", owner, owner, "Await a defined acknowledgment");
        openQuestions.push("What acknowledgment tells the bridge that Oracle has committed this event?");
      }
    }
    if (consumer.durableWriteConfirmed) {
      nextOffset = consumer.position;
      record("checkpoint", owner, "kafka", `Commit next offset ${nextOffset}`);
    }
    break;
  }
  return {
    placement, scenario, checkpointOwner: owner, steps, openQuestions,
    final: { rowCount: rows.size, nextOffset, storedEventIds: [...rows.keys()], redeliveryPending: log.has(nextOffset) },
  };
}

/** Run each fault independently against a fresh one-record partition and an empty model of Oracle. */
export function runReplayWalkthrough(config: unknown): ReplayWalkthrough {
  const input = inputSchema.parse(config);
  const runs: ReplayRun[] = [];
  for (const placement of ["before-kafka", "after-kafka"] as const) {
    for (const scenario of ["success", "failed-write", "restart-after-commit"] as const) {
      runs.push(simulate(input, placement, scenario));
    }
  }
  return { event: input.event, bridgeAcknowledgment: input.bridgeAcknowledgment, runs };
}
