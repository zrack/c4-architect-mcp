# PR #4 architecture review

Compared saved Component graphs. Source locations are relative to each scan root.

| Snapshot | Revision | Analysis | Source files |
| --- | --- | --- | --- |
| Base | 55419ce6af406843a7fe2c083db6cb73128045d5 | complete | 13 |
| Head | 4b39e2593df72ef3d1bef9e252ce6258162fb404 | complete | 14 |

| Changes | Added | Removed | Changed |
| --- | --- | --- | --- |
| Dependencies | 3 | 0 | 0 |
| Declared boundaries | 0 | 0 | 0 |
| Declared source assignments | 0 | 0 | 0 |
| Source files | 1 | 0 | 3 |

## Dependency changes

| Change | Relationship | Source evidence |
| --- | --- | --- |
| Added | cli.ts → renderers/review.ts · Imports module (import) | Head · [cli.ts:7:41](<https://github.com/zrack/c4-architect-mcp/blob/4b39e2593df72ef3d1bef9e252ce6258162fb404/src/cli.ts#L7>) (./renderers/review.js) |
| Added | renderers/review.ts → renderers/artifacts.ts · Imports module (import) | Head · [renderers/review.ts:6:41](<https://github.com/zrack/c4-architect-mcp/blob/4b39e2593df72ef3d1bef9e252ce6258162fb404/src/renderers/review.ts#L6>) (./artifacts.js) |
| Added | renderers/review.ts → model/graph.ts · Imports module (import) | Head · [renderers/review.ts:5:31](<https://github.com/zrack/c4-architect-mcp/blob/4b39e2593df72ef3d1bef9e252ce6258162fb404/src/renderers/review.ts#L5>) (../model/graph.js) |

## Source file changes

| Change | Scan-relative path |
| --- | --- |
| Added | renderers/review.ts |
| Changed | cli.ts |
| Changed | model/graph.ts |
| Changed | parsers/astParser.ts |

## Focused diagram

Head snapshot · cli.ts · 8 nodes · 7 relationships

Follow **R01** for the added dependency that anchors this view.

![Focused architecture diagram](<PR-ARCHITECTURE.focus-e758568899e88d5e.png>)

[Interactive diagram](<PR-ARCHITECTURE.focus-e758568899e88d5e.html>) · [SVG](<PR-ARCHITECTURE.focus-e758568899e88d5e.svg>) · [Neighborhood source evidence](<PR-ARCHITECTURE.focus-e758568899e88d5e.md>)
