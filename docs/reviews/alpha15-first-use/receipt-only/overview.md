# From Kafka order to billing record

![Data-flow diagram](overview.png)

[Interactive view](overview.html) · [Scalable SVG](overview.svg)

<details>
<summary>Mermaid source export</summary>

```mermaid
---
title: "From Kafka order to billing record"
config:
  theme: base
  themeVariables:
    primaryTextColor: '#15243a'
    lineColor: '#374151'
    edgeLabelBackground: '#ffffff'
  themeCSS: '.edgeLabel rect { opacity: 1 !important; fill: #ffffff !important; }'
  flowchart:
    htmlLabels: true
    wrappingWidth: 320
    nodeSpacing: 160
    rankSpacing: 180
    curve: bumpY
---
flowchart TB
  %% DataFlow: arrows point from data origin to receiver
  n0["«data store»<br/>Kafka"]
  n0@{ shape: datastore }
  n1("«process»<br/>Fulfillment bridge")
  n2("«process»<br/>Billing app")
  n3["«data store»<br/>Oracle"]
  n3@{ shape: datastore }

  n0 -->|"Order consumed<br/>directly by bridge"| n1
  n1 -->|"Sends order"| n2
  n2 -->|"Immediately<br/>acknowledges receipt"| n1
  n2 -->|"Stores order"| n3

  classDef internal fill:#e7f0fb,stroke:#3c6fa9,color:#15243a
  classDef external fill:#f0f2f5,stroke:#737d8b,color:#15243a
  classDef person fill:#dbeafe,stroke:#3c6fa9,color:#15243a
  classDef store fill:#edf6f1,stroke:#37715b,color:#15243a
  class n0 store
  class n1 internal
  class n2 internal
  class n3 store
```

</details>

## Data flows

| ID | From | To | Data carried | Technology |
|---|---|---|---|---|
| R01 | Kafka | Fulfillment bridge | Order consumed directly by bridge |  |
| R02 | Fulfillment bridge | Billing app | Sends order |  |
| R03 | Billing app | Fulfillment bridge | Immediately acknowledges receipt |  |
| R04 | Billing app | Oracle | Stores order |  |
