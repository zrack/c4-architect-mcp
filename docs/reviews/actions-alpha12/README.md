# GitHub Actions PR review pilot

These two manual runs used C4 Architect `0.2.0-alpha.12` to compare the `src` directory at each pull request's recorded base and head. Both scans in both runs completed. Each folder contains the five files downloaded from GitHub Actions. Open the Markdown on GitHub or download the files together and open the HTML locally to select an arrow. [Run the workflow on another PR](https://github.com/zrack/c4-architect-mcp#run-the-review-in-github-actions)

| Pull request | Dependencies | Evidence |
| --- | --- | --- |
| #16 added the file-explanation feature | 10 added, 0 removed, 0 modified | [Markdown report](pr-16/PR-ARCHITECTURE.md) · [Full-size diagram](pr-16/PR-ARCHITECTURE.focus-2b6c10815c3beaa7.png) · [Actions run](https://github.com/zrack/c4-architect-mcp/actions/runs/45552676933) |
| #14 introduced Confluence publishing and shared wiki rendering | 13 added, 3 removed, 0 modified | [Markdown report](pr-14/PR-ARCHITECTURE.md) · [Full-size diagram](pr-14/PR-ARCHITECTURE.focus-1cc49cc49dc3856a.png) · [Actions run](https://github.com/zrack/c4-architect-mcp/actions/runs/45552691748) |

Every numbered row in these reports was checked against its import or re-export at the linked commit and line. PR #16 reproduced all ten dependency rows in the published skill example. On PR #14, all three removed imports were found in the base file and confirmed absent from that file at the head. [Original PR #16 example](https://github.com/zrack/c4-architect-mcp/blob/v0.2.0-alpha.12/docs/reviews/pr-16/PR-16.md)

## Which source file would you open next?

Two independent automated reviewers each received one downloaded report and its diagram. They traced the following changes before looking at the implementation:

- **PR #16.** R06 from the CLI and R08 from the MCP entry point both lead to `renderers/explainFile.ts`. The reviewer chose to open that file first to see whether both entry points invoke the same behavior. [CLI import](https://github.com/zrack/c4-architect-mcp/blob/62d94bfb4fd4c17d9b5ca157eb5a07f13eb4da73/src/cli.ts#L8) · [MCP import](https://github.com/zrack/c4-architect-mcp/blob/62d94bfb4fd4c17d9b5ca157eb5a07f13eb4da73/src/index.ts#L22)
- **PR #14.** R16 shows the Azure wiki preview’s former direct import of the renderer. R10 takes the reviewer from that preview to `wikiDiagrams.ts`, and R06 shows the shared module importing the renderer. The reviewer chose to open `wikiDiagrams.ts` to inspect the extraction. Comparing rendered output would require a separate test. [Former import](https://github.com/zrack/c4-architect-mcp/blob/6d7124acaf770d4937393bbfef4353f9caac3042/src/publishers/adoWikiPreview.ts#L6) · [Preview’s new import](https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/adoWikiPreview.ts#L3) · [Renderer’s new importer](https://github.com/zrack/c4-architect-mcp/blob/7891d5059309302cd746287b6de47eb747b74529/src/publishers/wikiDiagrams.ts#L6)

To try this with a teammate, send them the [reviewer exercise](reviewer-pilot.md) before sharing these findings. It starts with PR #14 and then asks them to try a PR they are already reviewing. Record their observations separately from the automated reviews above.
