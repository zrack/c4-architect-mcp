---
name: solution-architect-walkthrough
description: Turn a plain-language system description into a first architecture diagram and an open design question. Use for solution architect walkthroughs, changes across views, or the Kafka and Oracle replay example.
---

## Try the example

For a request to try the bundled Kafka and Oracle example, run `c4-architect-mcp demo replay` in the user's working directory. In a built checkout use `node dist/index.js demo replay`. The shortcut finds its own scenario and prints the report and both comparison paths. Open the report and show both comparisons. Name the Kafka checkpoint owner in each and point to the step at which a replay finds the committed row. Describe the unique event ID and after-commit acknowledgment as assumptions of this example.

## Walk through my system

Start from the user's own words. If “walk through my system” arrives on its own, ask for one sentence about what the system receives, does and sends. Once a brief is available, make a first diagram before asking for more details. Supply the model and file paths yourself.

Draw the actors, systems and exchanges established by the brief. Use System Context for known boundaries, or Data Flow when the brief describes a source, a process and a store with undecided ownership. Label arrows with the stated action or payload and preserve their direction. For example, “our web app receives orders from Kafka and stores them in Oracle” supports an order flowing from Kafka through the app to Oracle. Bridge placement, commit timing and duplicate handling remain open.

Save an editable `overview.json` in a fresh `c4-walkthrough/` folder in the user's project (choose an unused suffix if necessary). Render the same model with `render_c4_mermaid`, passing an `outputPath` ending in `overview.md`. With the CLI, use `c4-architect-mcp render-diagram overview.json --out overview.md` in the output folder. A built checkout also provides `node /absolute/path/to/checkout/dist/index.js` in place of the CLI. The [input format](references/walkthrough-format.md#first-diagram) shows the diagram fields.

Show the rendered PNG and link `walkthrough.md`, a short note you write beside it. Link the editable JSON from the note, name the facts the drawing relies on, and ask the **one question** whose answer would most change it. If the Kafka consumer is known, ask what evidence it has when it advances its checkpoint. If ownership is unclear, ask who consumes the event. Leave any acknowledgment mechanism open until the user describes one. An acknowledgment of receipt alone leaves Oracle persistence unconfirmed. If the user wants to explore a hypothetical replay, label its assumptions separately from facts about their system.

## Review a design change

When a walkthrough manifest exists, read it alongside the referenced models. For a new walkthrough, record the views in the requested reading order, the confirmed facts, the proposed choices, and the unanswered questions. Use the actual node IDs or directed relationships in each view as evidence for a claim. Explain what that particular element says about the claim. A repeated name alone does not establish shared meaning. You can use the existing authored renderers to draw views from the brief and label proposed components and contracts. The [input format](references/walkthrough-format.md) includes a minimal example.

For each alternative, make a separate scenario against the same baseline. Record only the claims it changes and the questions it explicitly answers. If placement is known but ownership is open, give them separate question IDs. Keep hypothetical answers scoped to their scenario. A proposed bridge does not establish a transport protocol, an Oracle read path or a replay guarantee.

Run `review_architecture_walkthrough` with `manifestPath`, `scenarioPath`, and a distinct Markdown `outputPath` for each scenario. The CLI equivalent from a built C4 Architect checkout is:

```sh
node dist/index.js review-walkthrough walkthrough.json scenario.json --out review.md
```

Compare the resulting reports in view order. For each flagged diagram, name the affected element or arrow and the reason it needs review. Distinguish structural findings from old notes on a question the scenario answers. Explain why a relevant view can keep its current structure, especially when an interface contract is still undecided. Carry forward the open questions and link the generated reports. A clean result covers the claims and evidence recorded in this manifest. Call out a missing claim or viewpoint when it limits the answer.

For a customized Kafka and Oracle replay, run `review_replay_walkthrough` with `scenarioPath` and `outputDirectory`, or `review-replay <scenario.json> --out <directory>` with the CLI. The [replay scenario format](references/walkthrough-format.md#replay-scenario) describes the fixture’s assumptions. Show the failed-write offset and any open acknowledgment question alongside the success and restart comparisons.
