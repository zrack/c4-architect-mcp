# Contributing

Thanks for helping make code-derived architecture easier to inspect. This project is an alpha: focused fixes, reproducible examples, and clear limits are more useful than broad capability claims.

## Start with a small case

For a bug, include the smallest source fixture or graph that reproduces it, the expected result, the actual result, and relevant diagnostics. For a diagram problem, attach the full SVG or HTML when possible, along with a screenshot of the affected area.

For a new parser, output format, or publishing integration, open a feature request before building a large change. Explain the user workflow, its relationship to the shared graph contract, and how it will be tested. The [roadmap](ROADMAP.md) gives the current direction.

Do not include proprietary code, credentials, personal data, or internal hostnames in issues, fixtures, screenshots, or generated diagrams. Replace them with a small synthetic example that preserves the problem.

## Local setup

Use Node.js 22 or 24 and npm:

```sh
git clone https://github.com/zrack/c4-architect-mcp.git
cd c4-architect-mcp
npm ci
npm test
```

`npm test` builds the server and runs the test suite. Use `npm run dev` to watch TypeScript changes. MCP clients launch the built `dist/index.js`; rebuild and reconnect the server before testing a change through a client.

Run the browser checks when changing layout, SVG, HTML interaction, or exports:

```sh
npx playwright install chromium
C4_BROWSER_CHANNEL=chromium npm run test:layout
```

On Linux, Playwright may need `npx playwright install --with-deps chromium`. In PowerShell, set `$env:C4_BROWSER_CHANNEL = "chromium"` before running the test. Installed Google Chrome is the default when this variable is absent.

Generated fixtures and browser reports are under `output/playwright/component-scale/`. Review the actual images and selected exports as well as the test result.

## Project map

| Location | Responsibility |
| --- | --- |
| `src/index.ts` | MCP tool contracts and local artifact writes. |
| `src/parsers/` | Source extraction and module resolution. |
| `src/model/` | Versioned graph, boundary configuration, projections, and graph operations. |
| `src/renderers/` | Mermaid export, compact layout, images, and interactive HTML. |
| `test/` | Contract and regression tests with small fixtures. |
| `scripts/` | Build, packaging, and browser verification helpers. |
| `docs/images/` | Repository documentation artwork and generated examples. |

## Keep the graph honest

- An observed import is a code dependency. Do not turn it into a runtime protocol or deployment claim without supporting evidence.
- Preserve source evidence and diagnostics when adding extraction or resolution behavior.
- Keep declared boundaries separate from generated results. Stable IDs matter for rescans and comparisons.
- Report unsupported or unresolved cases explicitly. Silently dropping an edge can make a diagram misleading.
- Validate external input at the tool boundary, including duplicate identifiers and missing relationship endpoints.
- Keep bounded query limits and truncation visible to callers.

A parser fix should include a fixture that fails before the change and verifies the relevant edge, evidence, or diagnostic afterward. Avoid tests that simply repeat the implementation. A renderer fix should exercise the real output, including labels and interaction when affected.

## Pull requests

Keep a pull request focused enough to explain in a few paragraphs. Describe the concrete problem, resulting behavior, and relevant validation. Include a before/after image for visual changes and note any graph-schema or tool-contract changes.

Before requesting review:

1. Run `npm test`.
2. Run `npm run test:package` for runtime dependencies, packaging, or CLI changes.
3. Run `npm run test:layout` for renderer or interaction changes.
4. Update examples and documentation affected by the change.
5. Check that generated artifacts contain no private source or machine-specific paths.

The CI workflow also checks Node.js 22 and 24 on Linux, macOS, and Windows. A local pass does not replace those platform results.

AI-assisted contributions are welcome. You are responsible for understanding the change, checking its evidence, and verifying its behavior. Mention limitations that a reviewer should know.

## License and conduct

By contributing, you agree that your contribution may be distributed under the project's [MIT License](LICENSE). Submit only material you have the right to contribute. There is no separate contributor license agreement.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). For a possible vulnerability, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details in a public issue.
