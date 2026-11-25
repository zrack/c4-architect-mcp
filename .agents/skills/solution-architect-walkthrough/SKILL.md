---
name: solution-architect-walkthrough
description: Walk through a solution design across architecture views and review how a changed assumption or stakeholder answer affects those diagrams. Use for design walkthroughs, alternative integration placements, and questions that span multiple views.
---

Start with the architect's question and the diagrams or brief they supplied. Identify the boundary and the perspective of each view. For example, a container can depend on a broker while the event payload travels from the broker to the application. Evaluate each arrow according to its meaning.

When a walkthrough manifest exists, read it alongside the referenced models. For a new walkthrough, record the views in the requested reading order, the confirmed facts, the proposed choices, and the unanswered questions. Use the actual node IDs or directed relationships in each view as evidence for a claim. Explain what that particular element says about the claim. A repeated name alone does not establish shared meaning. You can use the existing authored renderers to draw views from the brief and label proposed components and contracts. The [input format](references/walkthrough-format.md) includes a minimal example.

For each alternative, make a separate scenario against the same baseline. Record only the claims it changes and the questions it explicitly answers. If placement is known but ownership is open, give them separate question IDs. Keep hypothetical answers scoped to their scenario. A proposed bridge does not establish a transport protocol, an Oracle read path or a replay guarantee.

Run `review_architecture_walkthrough` with `manifestPath`, `scenarioPath`, and a distinct Markdown `outputPath` for each scenario. The CLI equivalent from a built C4 Architect checkout is:

```sh
node dist/index.js review-walkthrough walkthrough.json scenario.json --out review.md
```

Compare the resulting reports in view order. For each flagged diagram, name the affected element or arrow and the reason it needs review. Distinguish structural findings from old notes on a question the scenario answers. Explain why a relevant view can keep its current structure, especially when an interface contract is still undecided. Carry forward the open questions and link the generated reports. A clean result covers the claims and evidence recorded in this manifest. Call out a missing claim or viewpoint when it limits the answer.
