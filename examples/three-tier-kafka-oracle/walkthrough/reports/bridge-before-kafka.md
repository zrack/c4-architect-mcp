# Bridge publishes to Kafka

[From a Kafka event to an Oracle record](<../../walkthrough.json>) · [Scenario input](<../bridge-before-kafka.json>)

**1 of 7 diagrams needs structural review.**
Baseline wording to revisit in 4 views. 5 questions stay open.

## Scenario changes

1. **Publishing handoff into Kafka** (Proposed design)
   - **Baseline** — An unidentified upstream producer publishes directly to Kafka.
   - **Scenario** — The integration bridge publishes incoming events to Kafka.
   - **Reason** — The bridge takes the publishing role. The application still consumes directly from Kafka.

## Diagram review

Each finding links a changed claim to an element in the baseline model. “No change traced” means the scenario changes no claim linked to that view.

| View | Structural review | Evidence in the baseline |
| --- | --- | --- |
| [System Context](<../models/01-context.json>) | No change traced | Proposed design — The application consumes directly from Kafka.<br>Recorded fact — The web app sends requests to the application server. |
| [Container](<../models/02-container.json>) | No change traced | Proposed design — The application consumes directly from Kafka.<br>Recorded fact — The web app sends requests to the application server.<br>Recorded fact — The application writes event-derived records to its Oracle RAC datastore. |
| [Data Flow](<../../data-flow.json>) | No change traced | Proposed design — The application consumes directly from Kafka.<br>Recorded fact — The web app sends requests to the application server.<br>Recorded fact — The application writes event-derived records to its Oracle RAC datastore. |
| [Component](<../models/04-component.json>) | No change traced | Proposed design — The application consumes directly from Kafka.<br>Recorded fact — The web app sends requests to the application server.<br>Recorded fact — The application writes event-derived records to its Oracle RAC datastore.<br>Proposed design — The proposed process function accepts an InboundEvent. |
| [Code](<../models/05-code.json>) | No change traced | Proposed design — The proposed process function accepts an InboundEvent. |
| [Deployment](<../models/06-deployment.json>) | No change traced | Proposed design — The application consumes directly from Kafka.<br>Recorded fact — The web app sends requests to the application server.<br>Recorded fact — The application writes event-derived records to its Oracle RAC datastore. |
| [System Landscape](<../models/07-system-landscape.json>) | **Review** | **R01 · Upstream event producer \[producer\] → Kafka \[kafka\] · Publishes inbound events** — This edge identifies the publisher on the Kafka side of the handoff. Show who writes to Kafka, while the business system that originated the event can remain unnamed. |

## Questions answered in this scenario

- **Where does the event bridge sit relative to Kafka and the application?** The bridge sits upstream of Kafka. It publishes to Kafka, and the application consumes the event from Kafka.
  - **Baseline wording to revisit** — Carries events consumed by the application. A separate upstream eventing service is an open question. [System Context](<../models/01-context.json>) (kafka) · [Container](<../models/02-container.json>) (kafka) · [Component](<../models/04-component.json>) (kafka) · [System Landscape](<../models/07-system-landscape.json>) (kafka)

## Questions that stay open

- **After the event is stored, what should the web user see or do, and how quickly should the change be visible?** [System Context](<../models/01-context.json>) · [Container](<../models/02-container.json>) · [Data Flow](<../../data-flow.json>)
- **Which business system originates the event, who owns its contract, and who operates the bridge and Kafka?** [System Context](<../models/01-context.json>) · [Deployment](<../models/06-deployment.json>) · [System Landscape](<../models/07-system-landscape.json>)
- **What is one real event and its identity, how is it delivered, which fields reach the processor, and which Oracle rows and keys should it create or update?** [Data Flow](<../../data-flow.json>) · [Component](<../models/04-component.json>) · [Code](<../models/05-code.json>)
- **Who acknowledges each delivery and who checkpoints Kafka relative to the Oracle commit? What happens on duplicate or out-of-order delivery, a failed write, or a restart?** [Data Flow](<../../data-flow.json>) · [Component](<../models/04-component.json>) · [Code](<../models/05-code.json>) · [Deployment](<../models/06-deployment.json>)
- **Where do the runtimes and Oracle RAC services run, who operates the datastore, and what throughput, recovery targets and failure domains must the production deployment support?** [Container](<../models/02-container.json>) · [Deployment](<../models/06-deployment.json>)
