# PR #4 architecture review

Compared saved Component graphs. Source locations are relative to each scan root.

| Snapshot | Revision | Analysis | Source files |
| --- | --- | --- | --- |
| Base | 55419ce6af406843a7fe2c083db6cb73128045d5 | complete | 13 |
| Head | 8483ad2d4c060c2fbd3e6e362e33138fbf68298d | complete | 14 |

| Changes | Added | Removed | Changed |
| --- | --- | --- | --- |
| Dependencies | 3 | 0 | 0 |
| Declared boundaries | 0 | 0 | 0 |
| Declared source assignments | 0 | 0 | 0 |
| Source files | 1 | 0 | 2 |

## Dependency changes

| Change | Relationship | Source evidence |
| --- | --- | --- |
| Added | cli.ts → renderers/review.ts · Imports module (import) | Head · cli.ts:7:41 (./renderers/review.js) |
| Added | renderers/review.ts → renderers/artifacts.ts · Imports module (import) | Head · renderers/review.ts:5:41 (./artifacts.js) |
| Added | renderers/review.ts → model/graph.ts · Imports module (import) | Head · renderers/review.ts:4:110 (../model/graph.js) |

## Source file changes

| Change | Scan-relative path |
| --- | --- |
| Added | renderers/review.ts |
| Changed | cli.ts |
| Changed | model/graph.ts |

## Focused diagram

Head snapshot · cli.ts · 8 nodes · 7 relationships

Follow **R01** for the added dependency that anchors this view.

![Focused architecture diagram](<PR-4-ARCHITECTURE.focus-e22de37aafc38e43.png>)
