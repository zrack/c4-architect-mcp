# How an order reaches Oracle

![Data-flow diagram](overview.png)

[Interactive view](overview.html) · [Scalable SVG](overview.svg)

<details>
<summary>Mermaid source export</summary>

```mermaid
---
title: "How an order reaches Oracle"
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
  n0["«external entity»<br/>Kafka"]
  n1("«process»<br/>Web app")
  n2["«data store»<br/>Oracle"]
  n2@{ shape: datastore }

  n0 -->|"Incoming order"| n1
  n1 -->|"Writes order"| n2

  classDef internal fill:#e7f0fb,stroke:#3c6fa9,color:#15243a
  classDef external fill:#f0f2f5,stroke:#737d8b,color:#15243a
  classDef person fill:#dbeafe,stroke:#3c6fa9,color:#15243a
  classDef store fill:#edf6f1,stroke:#37715b,color:#15243a
  class n0 external
  class n1 internal
  class n2 store
```

</details>

## Data flows

| ID | From | To | Data carried | Technology |
|---|---|---|---|---|
| R01 | Kafka | Web app | Incoming order |  |
| R02 | Web app | Oracle | Writes order |  |
