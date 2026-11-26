# Roadmap

The goal is a dependable path from local code evidence to architecture views that people can inspect, correct, and maintain. A readable diagram matters, but so does knowing why a line exists and what it does not establish.

This is a direction, not a release schedule. Features marked planned are not available in the current server.

## 1. Trustworthy local foundation — current alpha

The first release centers on TypeScript and TSX over local `stdio` MCP connections.

- Extract dependencies locally with Tree-sitter and resolve supported modules using project configuration.
- Preserve source locations, file hashes, parse diagnostics, and unresolved dependencies.
- Separate observed source facts, inferred classifications, and declared architecture boundaries.
- Keep manual mapping in a separate versioned configuration, with stable declared identifiers.
- Save a versioned graph; summarize it, query a bounded neighborhood, and compare snapshots.
- Explain a file's direct dependencies or compare a PR's dependencies using commit-pinned source links. The opt-in GitHub Actions workflow delivers a Markdown report and a focused diagram when dependencies changed. [PR review workflow](https://github.com/zrack/c4-architect-mcp#run-the-review-in-github-actions)
- Render Context, Container, and Component views from a dependency graph. Authored models also support Code, System Landscape, Dynamic, and Deployment views. [Seven Trail Notes views](README.md#trail-notes-examples)
- Follow named payloads across processes, external entities, and data stores in a data-flow diagram (alpha.13). [Kafka and Oracle RAC example](README.md#native-data-flow-diagrams)
- Trace a design change to specific nodes and arrows across a walkthrough and see which decisions remain open (alpha.14). [Compare two bridge placements](README.md#kafka-and-oracle-rac-bridge-comparison)
- Use `demo replay` to simulate success, a failed write, and a restart after commit in both bridge placements. Use the walkthrough skill with your own brief to create a first diagram and identify an open design question (alpha.15). [Try the example](README.md#try-the-example) · [Walk through my system](README.md#walk-through-my-system)
- Export full-size PNG/SVG images with the current selection.
- Maintain parser, graph, MCP, package, and browser layout regression checks.
- Prepare documentation, licensing, contribution guidance, and CI for a public alpha.

The checked-in code and tests are the source of truth for supported cases. Public availability and package publication are separate release steps.

## 2. Make repeated use practical — next

Make the graph useful throughout a project's life, rather than treating each drawing as a fresh prompt.

- Expand module-resolution fixtures from real, sanitized project examples.
- Add incremental analysis and caching with explicit invalidation rules.
- Improve graph slicing, search, and explanations for large repositories.
- Pilot the PR report with reviewers. Check whether the numbered arrows help them choose the next source file to open and whether missing imports or diagram limits affect that decision.
- Extend client and platform compatibility testing with reproducible reports.
- Add a documented extension contract before accepting additional language parsers.

Acceptance matters more than feature count: unresolved analysis must stay visible, repeated scans must retain declared identities, and bounded responses must report truncation.

## 3. Editable formats and documentation delivery

Add outputs that reuse the same graph, hierarchy, identifiers, and evidence.

- **Draw.io XML (`render_c4_drawio`), available in alpha.6:** editable diagrams with nested deployment groups and native connector labels.
- **Structurizr DSL (`render_structurizr_dsl`), available in alpha.7:** export authored Context, Container, Component, and Deployment diagrams to a workspace with explicit C4 hierarchy.
- **Azure DevOps Wiki (`publish_to_ado_wiki`), available in alpha.8:** preview a page locally and publish its PNG diagrams and Markdown through the Wiki API.
- **Confluence Cloud (`publish_to_confluence`), available in alpha.9:** preview the same diagram bundle and publish a page with native PNG attachments.
- **Notion (`publish_to_notion`), available in alpha.10:** preview the same diagram bundle and create a child page with native image blocks.

Publishing uses a dedicated generated page, a local preview, and credentials supplied through the environment.

## 4. Distributed systems and assisted review — planned

Code imports are only one source of architectural evidence. Larger views need explicit connections to contracts and infrastructure.

- Combine repositories through a declared manifest with repository identities and revisions.
- Add evidence from API contracts, deployment files, and service configuration before inferring inter-service links.
- Support additional languages through tested parser extensions.
- Explore assisted STRIDE review using declared trust boundaries and evidence-backed flows.

Threat-model output would identify review questions and hypotheses. An import graph alone cannot prove exposed ports, unencrypted traffic, or exploitable vulnerabilities.

## Propose a feature

Open a feature request with a concrete workflow, a small example, the expected graph or view, and a way to test success. Prefer an extension of the shared graph contract over a renderer-specific interpretation of source code. See [CONTRIBUTING.md](CONTRIBUTING.md).
