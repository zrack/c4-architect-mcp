# Walkthrough input format

A manifest records the baseline for one solution. A scenario describes one possible change to it. Put diagram models beside the manifest or in its subdirectories. The models use C4 Architect's existing authored diagram JSON format.

## Manifest

```json
{
  "schemaVersion": 1,
  "title": "Order intake",
  "views": [
    { "id": "container", "title": "Container", "model": "container.json" }
  ],
  "claims": [
    {
      "id": "delivery-peer",
      "kind": "fact",
      "statement": "Where the application receives orders",
      "value": "Order queue",
      "evidence": [
        {
          "view": "container",
          "from": "app",
          "to": "queue",
          "label": "Consumes orders from",
          "meaning": "The application is the consumer of this queue."
        }
      ]
    }
  ],
  "questions": [
    { "id": "delivery", "question": "Who will deliver orders?", "views": ["container"] },
    { "id": "replay", "question": "How should a duplicate order be handled?", "views": ["container"] }
  ]
}
```

Give each view, claim, and question an ID within its list. Use `fact` for an assertion supported by the brief or other identified evidence and `proposal` for a design choice. A claim can have evidence in several views. Use either a node ID (`node`) or an exact directed edge (`from`, `to`, `label`) and a short explanation (`meaning`). Local IDs may differ between diagrams. A question's optional `notes` list takes `{ "view": "container", "node": "queue" }` entries for existing node descriptions that will need another look when the question receives an answer.

## Scenario

```json
{
  "title": "Fulfilment service delivers orders",
  "changes": [
    { "claim": "delivery-peer", "value": "Fulfilment service", "reason": "The service consumes the queue and delivers orders to the application." }
  ],
  "answers": [
    { "question": "delivery", "answer": "The fulfilment service delivers orders in this scenario." }
  ]
}
```

An empty changes list is useful for reviewing a baseline. A change names the new value of an existing claim. A question closes only when its ID has an explicit answer. Keep independent alternatives in separate files so an answer from one cannot leak into another.

The Kafka / Oracle example begins at `examples/three-tier-kafka-oracle/walkthrough.json` in this checkout or its npm package. Its `walkthrough/` directory holds both bridge scenarios. The generated reports are in `walkthrough/reports/`.

## Replay scenario

`review-replay` accepts a separate JSON input with one event ID and one Kafka partition offset. Use `examples/three-tier-kafka-oracle/replay/scenario.json` to run the bundled example.

```json
{
  "schemaVersion": 1,
  "event": { "id": "evt-1042", "offset": 41 },
  "bridgeAcknowledgment": "after-commit"
}
```

The example models a durable Oracle insert keyed by event ID. On redelivery, finding the committed ID satisfies the write without inserting another row. The Kafka checkpoint stores the **next** offset to read. The consumer may advance from 41 to 42 once it has evidence of the commit. For an upstream bridge, the application is that consumer. For a downstream bridge, `after-commit` means the application acknowledges persistence to the bridge, which owns the checkpoint. Set `bridgeAcknowledgment` to `unspecified` when the design gives no such promise. In that case the downstream checkpoint stays open.

Each run starts independently and processes the same event. The restart case retains the Oracle rows and Kafka checkpoint from the first attempt and loses the consumer's in-flight state. The failed-write case stops at the failure so the reviewer can inspect the offset before any retry.
