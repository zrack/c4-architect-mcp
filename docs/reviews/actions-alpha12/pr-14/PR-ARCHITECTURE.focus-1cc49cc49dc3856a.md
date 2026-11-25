# PR #14 architecture review · Dependency changes

16 of 16 dependency changes · 10 nodes · 16 arrows

![Compact C4 diagram](PR-ARCHITECTURE.focus-1cc49cc49dc3856a.png)

[Interactive view](PR-ARCHITECTURE.focus-1cc49cc49dc3856a.html) · [Scalable SVG](PR-ARCHITECTURE.focus-1cc49cc49dc3856a.svg)

<details>
<summary>Mermaid source export</summary>

```mermaid
---
title: "PR #14 architecture review · Dependency changes"
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
  n0["«component»<br/>publishers/confluenceTransport.<br/>ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n1["«external system»<br/>Package: zod (inferred)<br/>#91;Package dependency#93;<br/>Inferred boundary · Observed<br/>package reference. External<br/>system/database placement is an<br/>inference; deployment, runtime<br/>use and protocol are unknown."]
  n2["«component»<br/>publishers/confluence.ts<br/>(inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n3["«component»<br/>index.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n4["«component»<br/>publishers/wikiDiagrams.ts<br/>(inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n5["«component»<br/>cli.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n6["«component»<br/>publishers/confluencePreview.ts<br/>(inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n7["«component»<br/>renderers/compactC4.ts<br/>(inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n8["«component»<br/>model/diagram.ts (inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]
  n9["«component»<br/>publishers/adoWikiPreview.ts<br/>(inferred)<br/>#91;TypeScript#93;<br/>Inferred boundary · Within<br/>Application (inferred)"]

  n0 -->|"Added · Imports<br/>package"| n1
  n2 -->|"Added · Imports module"| n0
  n3 -->|"Added · Imports module"| n4
  n5 -->|"Added · Imports module"| n2
  n6 -->|"Added · Imports module"| n4
  n4 -->|"Added · Imports module"| n7
  n4 -->|"Added · Imports module"| n8
  n2 -->|"Added · Imports module"| n6
  n3 -->|"Added · Imports module"| n2
  n9 -->|"Added · Imports module"| n4
  n3 -->|"Added · Imports module"| n0
  n9 -->|"Added · Re-exports<br/>module"| n4
  n4 -->|"Added · Imports<br/>package"| n1
  n9 -->|"Removed · Imports<br/>package"| n1
  n9 -->|"Removed · Imports<br/>module"| n8
  n9 -->|"Removed · Imports<br/>module"| n7

  classDef internal fill:#e7f0fb,stroke:#3c6fa9,color:#15243a
  classDef external fill:#f0f2f5,stroke:#737d8b,color:#15243a
  classDef person fill:#dbeafe,stroke:#3c6fa9,color:#15243a
  class n0 internal
  class n1 external
  class n2 internal
  class n3 internal
  class n4 internal
  class n5 internal
  class n6 internal
  class n7 internal
  class n8 internal
  class n9 internal
```

</details>

## Relationships

| ID | From | To | Action | Technology | Source evidence |
|---|---|---|---|---|---|
| R01 | publishers/confluenceTransport.ts (inferred) | Package: zod (inferred) | Added · Imports package |  | publishers/confluenceTransport.ts:1:19 (zod) |
| R02 | publishers/confluence.ts (inferred) | publishers/confluenceTransport.ts (inferred) | Added · Imports module |  | publishers/confluence.ts:3:87 (./confluenceTransport.js) |
| R03 | index.ts (inferred) | publishers/wikiDiagrams.ts (inferred) | Added · Imports module |  | index.ts:18:36 (./publishers/wikiDiagrams.js) |
| R04 | cli.ts (inferred) | publishers/confluence.ts (inferred) | Added · Imports module |  | cli.ts:10:31 (./publishers/confluence.js) |
| R05 | publishers/confluencePreview.ts (inferred) | publishers/wikiDiagrams.ts (inferred) | Added · Imports module |  | publishers/confluencePreview.ts:3:107 (./wikiDiagrams.js) |
| R06 | publishers/wikiDiagrams.ts (inferred) | renderers/compactC4.ts (inferred) | Added · Imports module |  | publishers/wikiDiagrams.ts:6:33 (../renderers/compactC4.js) |
| R07 | publishers/wikiDiagrams.ts (inferred) | model/diagram.ts (inferred) | Added · Imports module |  | publishers/wikiDiagrams.ts:5:31 (../model/diagram.js) |
| R08 | publishers/confluence.ts (inferred) | publishers/confluencePreview.ts (inferred) | Added · Imports module |  | publishers/confluence.ts:2:64 (./confluencePreview.js) |
| R09 | index.ts (inferred) | publishers/confluence.ts (inferred) | Added · Imports module |  | index.ts:16:31 (./publishers/confluence.js) |
| R10 | publishers/adoWikiPreview.ts (inferred) | publishers/wikiDiagrams.ts (inferred) | Added · Imports module |  | publishers/adoWikiPreview.ts:3:121 (./wikiDiagrams.js) |
| R11 | index.ts (inferred) | publishers/confluenceTransport.ts (inferred) | Added · Imports module |  | index.ts:17:40 (./publishers/confluenceTransport.js) |
| R12 | publishers/adoWikiPreview.ts (inferred) | publishers/wikiDiagrams.ts (inferred) | Added · Re-exports module |  | publishers/adoWikiPreview.ts:5:61 (./wikiDiagrams.js) |
| R13 | publishers/wikiDiagrams.ts (inferred) | Package: zod (inferred) | Added · Imports package |  | publishers/wikiDiagrams.ts:4:19 (zod) |
| R14 | publishers/adoWikiPreview.ts (inferred) | Package: zod (inferred) | Removed · Imports package |  | publishers/adoWikiPreview.ts:4:19 (zod) |
| R15 | publishers/adoWikiPreview.ts (inferred) | model/diagram.ts (inferred) | Removed · Imports module |  | publishers/adoWikiPreview.ts:5:31 (../model/diagram.js) |
| R16 | publishers/adoWikiPreview.ts (inferred) | renderers/compactC4.ts (inferred) | Removed · Imports module |  | publishers/adoWikiPreview.ts:6:33 (../renderers/compactC4.js) |
