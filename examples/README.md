# Source-backed order-processing example

For a runnable example that connects Component and Code diagrams to a retry, see
[Trail Notes](trail-notes/README.md).

This small synthetic TypeScript application demonstrates the analyzer's local
evidence and boundary mapping. It is not a deployed service. Payments and stock
reservations are simulated, and orders are held in memory. No network services,
accounts, database, or extra application dependencies are required.

The source contains:

- Static imports and type-only imports.
- A barrel that re-exports the orders component's public API and types.
- TypeScript path aliases and `.js` import specifiers resolving to `.ts` files.
- A literal dynamic import through the inventory barrel.
- Five declared logical components inside one declared application container.

## Generate and inspect the graph

Run these commands from the repository root after `npm ci`:

```sh
npm run build
node dist/index.js analyze examples/order-service/src --level Component --config examples/c4-architect.config.json --tsconfig examples/order-service/tsconfig.json --out output/example-graph.json --summary
node dist/index.js render output/example-graph.json --out output/example.md
```

The first command saves the versioned graph and prints a small summary. The
second creates the compact diagram, SVG/PNG exports, and a self-contained HTML
view beside the Markdown. Open the HTML, select **Order orchestration**, and use
**Export PNG** or **Export SVG** to save the current highlight state.

The data-only `c4-architect.config.json` paths are relative to the scan root,
`examples/order-service/src`. They are literal file or directory prefixes rather
than glob patterns. The declared component IDs and labels survive rescans and
file renames inside their mapped directories. Changing this file changes the
architecture declaration; rescanning never overwrites it.

To see the fallback mappings, omit `--config`. The analyzer will then use inferred
system/application boundaries and file-based components. Those defaults describe
the scan scope; they do not establish real deployment or business boundaries.

The model records import syntax with file/line evidence. It does not claim that a
function ran, a remote request occurred, or transport encryption was verified.
There are no external-service or database heuristics in this example: a local
payment simulator is not labeled as a real payment provider, and the in-memory
map is not labeled as PostgreSQL.

## Type-check the sample

```sh
npx tsc --project examples/order-service/tsconfig.json --noEmit
```

The example `tsconfig.json` supplies compiler and resolution data only. Analysis
does not execute application code or configuration scripts.
