# PR #14 architecture review

Compared saved Component graphs. Source locations are relative to each scan root.

| Snapshot | Revision | Analysis | Source files |
| --- | --- | --- | --- |
| Base | 6d7124acaf770d4937393bbfef4353f9caac3042 | complete | 22 |
| Head | 7891d5059309302cd746287b6de47eb747b74529 | complete | 26 |

| Changes | Added | Removed | Changed |
| --- | --- | --- | --- |
| Dependencies | 13 | 3 | 0 |
| Declared boundaries | 0 | 0 | 0 |
| Declared source assignments | 0 | 0 | 0 |
| Source files | 4 | 0 | 3 |

## Dependency changes

| Arrow | Change | Relationship | Source evidence |
| --- | --- | --- | --- |
| R01 | Added | publishers/confluenceTransport.ts → Package: zod · Imports package (import) | Head · [publishers/confluenceTransport.ts:1:19](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/confluenceTransport.ts#L1>) (zod) |
| R02 | Added | publishers/confluence.ts → publishers/confluenceTransport.ts · Imports module (import) | Head · [publishers/confluence.ts:3:87](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/confluence.ts#L3>) (./confluenceTransport.js) |
| R03 | Added | index.ts → publishers/wikiDiagrams.ts · Imports module (import) | Head · [index.ts:18:36](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/index.ts#L18>) (./publishers/wikiDiagrams.js) |
| R04 | Added | cli.ts → publishers/confluence.ts · Imports module (import) | Head · [cli.ts:10:31](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/cli.ts#L10>) (./publishers/confluence.js) |
| R05 | Added | publishers/confluencePreview.ts → publishers/wikiDiagrams.ts · Imports module (import) | Head · [publishers/confluencePreview.ts:3:107](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/confluencePreview.ts#L3>) (./wikiDiagrams.js) |
| R06 | Added | publishers/wikiDiagrams.ts → renderers/compactC4.ts · Imports module (import) | Head · [publishers/wikiDiagrams.ts:6:33](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/wikiDiagrams.ts#L6>) (../renderers/compactC4.js) |
| R07 | Added | publishers/wikiDiagrams.ts → model/diagram.ts · Imports module (import) | Head · [publishers/wikiDiagrams.ts:5:31](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/wikiDiagrams.ts#L5>) (../model/diagram.js) |
| R08 | Added | publishers/confluence.ts → publishers/confluencePreview.ts · Imports module (import) | Head · [publishers/confluence.ts:2:64](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/confluence.ts#L2>) (./confluencePreview.js) |
| R09 | Added | index.ts → publishers/confluence.ts · Imports module (import) | Head · [index.ts:16:31](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/index.ts#L16>) (./publishers/confluence.js) |
| R10 | Added | publishers/adoWikiPreview.ts → publishers/wikiDiagrams.ts · Imports module (import) | Head · [publishers/adoWikiPreview.ts:3:121](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/adoWikiPreview.ts#L3>) (./wikiDiagrams.js) |
| R11 | Added | index.ts → publishers/confluenceTransport.ts · Imports module (import) | Head · [index.ts:17:40](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/index.ts#L17>) (./publishers/confluenceTransport.js) |
| R12 | Added | publishers/adoWikiPreview.ts → publishers/wikiDiagrams.ts · Re-exports module (re-export) | Head · [publishers/adoWikiPreview.ts:5:61](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/adoWikiPreview.ts#L5>) (./wikiDiagrams.js) |
| R13 | Added | publishers/wikiDiagrams.ts → Package: zod · Imports package (import) | Head · [publishers/wikiDiagrams.ts:4:19](<https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/wikiDiagrams.ts#L4>) (zod) |
| R14 | Removed | publishers/adoWikiPreview.ts → Package: zod · Imports package (import) | Base · [publishers/adoWikiPreview.ts:4:19](<https://github.com/zrack/c4-architect-mcp/blob/6d7124acaf770d4937393bbfef4353f9caac3042/src/publishers/adoWikiPreview.ts#L4>) (zod) |
| R15 | Removed | publishers/adoWikiPreview.ts → model/diagram.ts · Imports module (import) | Base · [publishers/adoWikiPreview.ts:5:31](<https://github.com/zrack/c4-architect-mcp/blob/6d7124acaf770d4937393bbfef4353f9caac3042/src/publishers/adoWikiPreview.ts#L5>) (../model/diagram.js) |
| R16 | Removed | publishers/adoWikiPreview.ts → renderers/compactC4.ts · Imports module (import) | Base · [publishers/adoWikiPreview.ts:6:33](<https://github.com/zrack/c4-architect-mcp/blob/6d7124acaf770d4937393bbfef4353f9caac3042/src/publishers/adoWikiPreview.ts#L6>) (../renderers/compactC4.js) |

## Source file changes

| Change | Scan-relative path |
| --- | --- |
| Added | publishers/confluence.ts |
| Added | publishers/confluencePreview.ts |
| Added | publishers/confluenceTransport.ts |
| Added | publishers/wikiDiagrams.ts |
| Changed | cli.ts |
| Changed | index.ts |
| Changed | publishers/adoWikiPreview.ts |

## Focused diagram

16 of 16 dependency changes · 10 nodes · 16 arrows

![Focused architecture diagram](<PR-ARCHITECTURE.focus-1cc49cc49dc3856a.png>)

[Interactive diagram](<PR-ARCHITECTURE.focus-1cc49cc49dc3856a.html>) · [SVG](<PR-ARCHITECTURE.focus-1cc49cc49dc3856a.svg>) · [Diagram relationship key](<PR-ARCHITECTURE.focus-1cc49cc49dc3856a.md>)
