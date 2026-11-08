# PR #4 architecture review

Compared saved Component graphs. Source locations are relative to each scan root.

| Snapshot | Revision | Analysis | Source files |
| --- | --- | --- | --- |
| Base | 55419ce6af406843a7fe2c083db6cb73128045d5 | complete | 13 |
| Head | 819ceeff4c4a639a41109ed97ab897c512dbac09 | complete | 14 |

| Changes | Added | Removed | Changed |
| --- | --- | --- | --- |
| Dependencies | 3 | 0 | 0 |
| Declared boundaries | 0 | 0 | 0 |
| Declared source assignments | 0 | 0 | 0 |
| Source files | 1 | 0 | 3 |

## Dependency changes

| Change | Relationship | Source evidence |
| --- | --- | --- |
| Added | cli.ts → renderers/review.ts · Imports module (import) | Head · [cli.ts:7:41](<https://github.com/zrack/c4-architect-mcp/blob/819ceeff4c4a639a41109ed97ab897c512dbac09/src/cli.ts#L7>) (./renderers/review.js) |
| Added | renderers/review.ts → renderers/artifacts.ts · Imports module (import) | Head · [renderers/review.ts:6:41](<https://github.com/zrack/c4-architect-mcp/blob/819ceeff4c4a639a41109ed97ab897c512dbac09/src/renderers/review.ts#L6>) (./artifacts.js) |
| Added | renderers/review.ts → model/graph.ts · Imports module (import) | Head · [renderers/review.ts:5:31](<https://github.com/zrack/c4-architect-mcp/blob/819ceeff4c4a639a41109ed97ab897c512dbac09/src/renderers/review.ts#L5>) (../model/graph.js) |

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

![Focused architecture diagram](<PR-4-ARCHITECTURE.focus-e758568899e88d5e.png>)
