# Changelog

User-visible changes are recorded here. Unreleased work is not a published package or release.

## 0.2.0-alpha.15 — 2026-11-26

- Try the bundled Kafka and Oracle example with `demo replay` from any folder. In Codex, describe your own system to get a first diagram and a focused design question.

- Run `review-replay` or the `review_replay_walkthrough` MCP tool to see who can checkpoint Kafka after an Oracle write. The runnable example exercises both bridge placements through success, a failed write and a restart after commit. Its comparison diagrams and Markdown report use the same execution traces.

## 0.2.0-alpha.14 — 2026-11-25

- Review a change to a solution design with `$solution-architect-walkthrough`. The `review-walkthrough` command and `review_architecture_walkthrough` MCP tool trace an authored claim to the nodes and arrows that depend on it and carry open questions into each scenario. The Kafka and Oracle RAC example compares two placements of an integration bridge.

## 0.2.0-alpha.13 — 2026-11-25

- Render authored data-flow diagrams through MCP and the CLI, with distinct symbols for external entities, processes and data stores and a payload name on each arrow. The [Kafka and Oracle RAC example](examples/three-tier-kafka-oracle/data-flow.json) includes both a web request and response and a one-way event write.

## GitHub Actions workflow — 2026-11-24

- The opt-in PR workflow now uses the published `0.2.0-alpha.12` package. Its diagram shows up to 25 changed dependencies with source links to the PR head, base, or both. The Markdown artifact lists every changed dependency. Existing callers can update their workflow commit pin to adopt this view. [Setup and examples](https://github.com/zrack/c4-architect-mcp#run-the-review-in-github-actions)

## 0.2.0-alpha.12 — 2026-11-19

- Ask `what-changed-in-this-pr` to trace a pull request's changed TypeScript dependencies. Its focused diagram and report use numbered arrows with source links to the relevant revisions. The same view is available with `review --focus-changes`.

## 0.2.0-alpha.11 — 2026-11-19

- Ask the `explain-this-file` skill who imports a TypeScript or TSX file and what it imports. The `explain_architecture_file` MCP tool and `explain-file` command generate a one-hop diagram and Markdown report with import locations and resolution gaps.

## 0.2.0-alpha.10 — 2026-11-08

### Added

- Preview an authored diagram bundle and publish it as a Notion child page with native image blocks using `publish-notion` or `publish_to_notion`.

## 0.2.0-alpha.9 — 2026-11-08

### Added

- Preview and publish an authored diagram bundle to Confluence Cloud using `publish-confluence` or `publish_to_confluence`. The preview includes Confluence storage XHTML and the page's PNG attachments.

## 0.2.0-alpha.8 — 2026-11-07

### Added

- Preview and publish an authored diagram bundle to Azure DevOps Wiki with PNG attachments using `publish-ado-wiki` or `publish_to_ado_wiki`.

## 0.2.0-alpha.7 — 2026-11-07

### Added

- Export authored Context, Container, Component, and Deployment views as Structurizr DSL using `render-structurizr` or `render_structurizr_dsl`. The Trail Notes sample demonstrates four views in one workspace.

## 0.2.0-alpha.6 — 2026-11-07

### Added

- Export authored diagrams and saved architecture graphs as editable Draw.io files, with nested deployment groups and native connector labels. Use `render-drawio`, `render_c4_drawio`, or the `drawio` format on `render_architecture_graph`.

## 0.2.0-alpha.5 — 2026-11-07

### Fixed

- Parse large TypeScript and TSX files without losing imports beyond Tree-sitter's native input buffer. Source locations remain available for those imports.

## 0.2.0-alpha.4 — 2026-11-07

### Added

- Render authored Deployment, Dynamic, System Landscape, and Code diagrams through `render_c4_mermaid` or the `render-diagram` CLI command.

## 0.2.0-alpha.3 — 2026-11-07

### Added

- Use `review` to compare saved graphs and write a Markdown PR report with dependency changes, declared boundary and source assignment changes, scan diagnostics, and a focused diagram when applicable.
- Save revision SHAs with `analyze --commit` and use `review --github-repo` and `--source-root` to link evidence to the exact source lines.
- Show unresolved import locations for both snapshots, prioritizing changed specifiers even when warning counts are equal.

### Fixed

- Preserve package subpath changes and explicit component technology changes in architecture reviews. Use recorded provenance to ignore inferred technology changes and qualify ambiguous legacy values.

## 0.2.0-alpha.2 — 2026-11-06

### Added

- Render a focused neighborhood from a saved graph through `render_architecture_graph` or CLI `render --node`. Choose a direction and set depth, node, and relationship limits. Focused artifacts show the view's scope and include relationship source locations.

### Fixed

- Recognize TypeScript `export type *` re-exports as type-only dependencies.
- Parse UTF-8, UTF-16LE, and UTF-16BE sources that start with a byte order mark and preserve the hash of the original bytes.
- Report existing local assets reached through relative imports, TypeScript `paths` aliases, or `baseUrl` as unsupported local modules.
- Compare snapshots across checkout directories and reconcile equivalent import spellings by resolved endpoints, kind, label, and protocol while preserving relationship multiplicity.

## 0.2.0-alpha.1 — 2026-11-06

### Added

- A versioned graph foundation with source evidence, file hashes, explicit boundary mapping, diagnostics, summaries, bounded neighborhood queries, and graph comparisons.
- Local TypeScript/TSX dependency analysis and module-resolution regression fixtures.
- Compact server-side C4 image layout with orthogonal routing and compatible Mermaid source export.
- PNG, SVG, Markdown, and self-contained interactive HTML artifacts.
- Component and relationship selection, directional highlighting, keyboard controls, and full-diagram PNG/SVG exports preserving the current selection.
- Synthetic 12-node and 20-node layout, interaction, and export regression cases.
- Public-alpha documentation, contribution guidance, issue templates, a security policy, a code of conduct, and cross-platform CI configuration.
- Direct CLI analysis, rendering, summaries, queries, and comparisons alongside the local MCP server.
- Version-pinned npm/npx installation and client configuration instructions.
- MIT licensing and dependency notices.

### Clarified

- Observed source dependencies, inferred classifications, and declared architecture boundaries are distinct.
- Static imports do not prove runtime behavior, deployment boundaries, network protocols, or security properties.
- Draw.io, Structurizr DSL, publishing, cross-repository mapping, additional languages, and assisted threat modeling remain roadmap items.
