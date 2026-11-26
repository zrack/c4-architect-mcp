import test from "node:test";
import assert from "node:assert/strict";
import { runReplayWalkthrough } from "../dist/model/replayWalkthrough.js";
import { renderReplayComparison } from "../dist/renderers/replayComparison.js";

function runs(bridgeAcknowledgment, placement) {
  const event = { id: "sample-1", offset: 90 };
  const { runs } = runReplayWalkthrough({ schemaVersion: 1, event, bridgeAcknowledgment });
  return runs.filter(run => run.placement === placement);
}

test("comparison preserves the order and participants of both traces", () => {
  for (const placement of ["before-kafka", "after-kafka"]) {
    const [success, , replay] = runs("after-commit", placement);
    const svg = renderReplayComparison(success, replay);
    const actors = { application: "App", bridge: "Bridge", kafka: "Kafka", oracle: "Oracle" };
    const interactions = [...svg.matchAll(/<title>Step [^<]+<\/title>/g)].map(match => match[0]);
    const steps = [success, replay].flatMap(run => run.steps.map((step, index) => {
      const rows = step.rowCount === 1 ? "row" : "rows";
      return `<title>Step ${index + 1}, attempt ${step.attempt}: ${actors[step.from]} → ${actors[step.to]}. ${step.label}. ${step.rowCount} Oracle ${rows} · next Kafka offset ${step.nextOffset}.</title>`;
    }));
    assert.deepEqual(interactions, steps);
    assert.equal((svg.match(/>Checkpoint saved<\/text>/g) ?? []).length, 2);
    assert.match(svg, placement === "before-kafka" ? />Application server<\/text>/ : />Integration bridge<\/text>/);
  }
});

test("a comparison with an unspecified downstream acknowledgment shows both checkpoints held", () => {
  const [success, failed, replay] = runs("unspecified", "after-kafka");
  const svg = renderReplayComparison(success, replay);
  assert.doesNotMatch(svg, /Successful delivery|Checkpoint saved/);
  assert.equal((svg.match(/>Checkpoint held<\/text>/g) ?? []).length, 2);
  assert.throws(() => renderReplayComparison(failed, replay), /Compare success/);
  assert.throws(() => renderReplayComparison(runs("unspecified", "before-kafka")[0], replay), /same placement/);
});
