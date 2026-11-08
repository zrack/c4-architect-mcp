# Changelog

User-visible changes are recorded here. Unreleased work is not a published package or release.

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
