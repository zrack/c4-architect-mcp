# Bridge delivers to the application

[From a Kafka event to an Oracle record](<../../walkthrough.json>) · [Scenario input](<../bridge-after-kafka.json>)

**6 of 7 diagrams need structural review.**
Baseline wording to revisit in 4 views. 5 questions stay open.

## Scenario changes

1. **Direct event delivery to the application** (Proposed design)
   - **Baseline** — The application consumes directly from Kafka.
   - **Scenario** — The application receives the event from the integration bridge.
   - **Reason** — Kafka consumption moves to the bridge. The bridge then delivers the event to the application.

## Diagram review

Each finding links a changed claim to an element in the baseline model. “No change traced” means the scenario changes no claim linked to that view.

| View | Structural review | Evidence in the baseline |
| --- | --- | --- |
| [System Context](<../models/01-context.json>) | **Review** | **R02 · Kafka \[kafka\] → Event records application \[application\] · Makes inbound events available** — This edge identifies the immediate external supplier of events. A new delivery system changes the application's direct neighbor. |
| [Container](<../models/02-container.json>) | **Review** | **R03 · Application server \[app-server\] → Kafka \[kafka\] · Consumes events from** — The arrow points from the application server to its Kafka dependency. Identify who now consumes from Kafka and how the application receives that delivery. |
| [Data Flow](<../../data-flow.json>) | **Review** | **R05 · Kafka \[kafka\] → Process incoming event \[event\] · Event record** — This arrow follows the incoming payload from its sender into the application. Review that sender independently of the outgoing record written to Oracle. |
| [Component](<../models/04-component.json>) | **Review** | **R02 · Kafka consumer \[consumer\] → Kafka \[kafka\] · Consumes events from** — The proposed Kafka consumer is inside the application server. If consumption moves outside, identify which application component receives the delivered event. |
| [Code](<../models/05-code.json>) | No change traced | Proposed design — The proposed process function accepts an InboundEvent. |
| [Deployment](<../models/06-deployment.json>) | **Review** | **R02 · Application server \[app-server\] → Kafka \[kafka\] · Consumes events from** — The application runtime currently hosts the Kafka consumer and connects to Kafka. Identify the runtime that owns consumption and its handoff to the application. |
| [System Landscape](<../models/07-system-landscape.json>) | **Review** | **R02 · Kafka \[kafka\] → Event records application \[application\] · Makes events available** — This edge shows who delivers events from Kafka to the application. Include any intervening delivery system on this side of Kafka. |

## Questions answered in this scenario

- **Where does the event bridge sit relative to Kafka and the application?** The bridge sits between Kafka and the application. It consumes the Kafka event and delivers it to the application.
  - **Baseline wording to revisit** — Carries events consumed by the application. A separate upstream eventing service is an open question. [System Context](<../models/01-context.json>) (kafka) · [Container](<../models/02-container.json>) (kafka) · [Component](<../models/04-component.json>) (kafka) · [System Landscape](<../models/07-system-landscape.json>) (kafka)

## Questions that stay open

- **After the event is stored, what should the web user see or do, and how quickly should the change be visible?** [System Context](<../models/01-context.json>) · [Container](<../models/02-container.json>) · [Data Flow](<../../data-flow.json>)
- **Which business system originates the event, who owns its contract, and who operates the bridge and Kafka?** [System Context](<../models/01-context.json>) · [Deployment](<../models/06-deployment.json>) · [System Landscape](<../models/07-system-landscape.json>)
- **What is one real event and its identity, how is it delivered, which fields reach the processor, and which Oracle rows and keys should it create or update?** [Data Flow](<../../data-flow.json>) · [Component](<../models/04-component.json>) · [Code](<../models/05-code.json>)
- **Who acknowledges each delivery and who checkpoints Kafka relative to the Oracle commit? What happens on duplicate or out-of-order delivery, a failed write, or a restart?** [Data Flow](<../../data-flow.json>) · [Component](<../models/04-component.json>) · [Code](<../models/05-code.json>) · [Deployment](<../models/06-deployment.json>)
- **Where do the runtimes and Oracle RAC services run, who operates the datastore, and what throughput, recovery targets and failure domains must the production deployment support?** [Container](<../models/02-container.json>) · [Deployment](<../models/06-deployment.json>)
