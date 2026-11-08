# cli.ts · Head neighborhood

8 of 21 nodes · 7 of 41 relationships · Both directions · Depth 1

![Compact C4 diagram](PR-ARCHITECTURE.focus-e758568899e88d5e.png)

[Interactive view](PR-ARCHITECTURE.focus-e758568899e88d5e.html) · [Scalable SVG](PR-ARCHITECTURE.focus-e758568899e88d5e.svg)

<details>
<summary>Mermaid source export</summary>

```mermaid
---
title: "cli.ts · Head neighborhood"
config:
  theme: base
  themeVariables:
    primaryTextColor: '#15243a'
    lineColor: '#374151'
    edgeLabelBackground: '#ffffff'
  themeCSS: '.edgeLabel rect { opacity: 1 !important; fill: #ffffff !important; }'
  flowchart:
    htmlLabels: false
    wrappingWidth: 320
    nodeSpacing: 160
    rankSpacing: 180
    curve: bumpY
---
flowchart TB
  %% C4Component: C4 types with automatic graph layout
  n0["«component»<br/>model/neighborhood.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n1["«component»<br/>model/graph.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n2["«component»<br/>parsers/astParser.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n3["«component»<br/>renderers/review.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n4["«component»<br/>cli.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n5["«component»<br/>index.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n6["«component»<br/>renderers/artifacts.ts<br/>(inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n7["«component»<br/>version.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]

  n4 -->|"Imports module"| n3
  n4 -->|"Imports module"| n6
  n4 -->|"Imports module"| n1
  n4 -->|"Imports module"| n7
  n4 -->|"Imports module"| n0
  n5 -->|"Imports module"| n4
  n4 -->|"Imports module"| n2

  classDef internal fill:#e7f0fb,stroke:#3c6fa9,color:#15243a
  classDef external fill:#f0f2f5,stroke:#737d8b,color:#15243a
  classDef person fill:#dbeafe,stroke:#3c6fa9,color:#15243a
  class n0 internal
  class n1 internal
  class n2 internal
  class n3 internal
  class n4 internal
  class n5 internal
  class n6 internal
  class n7 internal
```

</details>

## Relationships

| ID | From | To | Action | Technology | Source evidence |
|---|---|---|---|---|---|
| R01 | cli.ts (inferred) | renderers/review.ts (inferred) | Imports module |  | cli.ts:7:41 (./renderers/review.js) |
| R02 | cli.ts (inferred) | renderers/artifacts.ts (inferred) | Imports module |  | cli.ts:6:41 (./renderers/artifacts.js) |
| R03 | cli.ts (inferred) | model/graph.ts (inferred) | Imports module |  | cli.ts:4:165 (./model/graph.js) |
| R04 | cli.ts (inferred) | version.ts (inferred) | Imports module |  | cli.ts:8:25 (./version.js) |
| R05 | cli.ts (inferred) | model/neighborhood.ts (inferred) | Imports module |  | cli.ts:5:34 (./model/neighborhood.js) |
| R06 | index.ts (inferred) | cli.ts (inferred) | Imports module |  | index.ts:11:24 (./cli.js) |
| R07 | cli.ts (inferred) | parsers/astParser.ts (inferred) | Imports module |  | cli.ts:3:34 (./parsers/astParser.js) |
