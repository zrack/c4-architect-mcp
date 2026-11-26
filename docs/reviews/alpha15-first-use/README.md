# Alpha.15 first-use results

These checks used a local alpha.15 package. The demo ran in an empty working directory. For the custom walkthroughs, Codex received the project-local skill and a plain-language brief. It used the installed CLI to render each model. These were fresh Codex sessions.

## Try the example

We ran `c4-architect-mcp demo replay` without supplying a scenario or an output path. The command printed the Markdown report and both comparison paths. It found its bundled event at offset 41 and exercised success, a failed Oracle write, and a consumer restart after commit in both bridge placements. A separate repeat-run test preserved prior review notes and wrote the second result to `c4-replay-2/`.

| Who consumes Kafka? | Success | Failed write | Restart after Oracle commit |
| --- | --- | --- | --- |
| Application server, with the bridge before Kafka | 1 row, next offset 42 | 0 rows, next offset 41 | 1 row at offset 41 when interrupted. Replay finds the row and the application checkpoints 42. |
| Integration bridge, with the bridge after Kafka | 1 row, next offset 42 | 0 rows, next offset 41 | 1 row at offset 41 when interrupted. The bridge checkpoints 42 once the application confirms the stored row. |

The ten artifacts from the fresh run matched the bundled results byte for byte. [Six-case report](../../../examples/three-tier-kafka-oracle/replay/results/report.md) · [Before Kafka comparison](../../../examples/three-tier-kafka-oracle/replay/results/before-kafka.svg) · [After Kafka comparison](../../../examples/three-tier-kafka-oracle/replay/results/after-kafka.svg) · [Execution traces](../../../examples/three-tier-kafka-oracle/replay/results/traces.json)

## Walk through my system

| First-time brief | Generated diagram | Question the walkthrough asked |
| --- | --- | --- |
| “Our web app receives orders from Kafka and stores them in Oracle.” | Kafka → web app → Oracle. The diagram has three participants and two flows. | Which component consumes the order event from Kafka? [Walkthrough and diagram](my-system/walkthrough.md) |
| “Our fulfillment bridge consumes orders directly from Kafka and sends them to our billing app. The app acknowledges receipt immediately and stores the order in Oracle.” | Four participants. The billing app's receipt to the bridge and its write to Oracle are separate arrows. | What evidence does the fulfillment bridge require before it advances its Kafka checkpoint past an order? [Walkthrough and diagram](receipt-only/walkthrough.md) |

Both briefs produced an editable diagram, a rendered preview, and one open question. In the second brief, the receipt established that billing had received the order. Whether the bridge learns that Oracle committed it remained open. [First editable model](my-system/overview.json) · [Second editable model](receipt-only/overview.json)
