---
name: explain-this-file
description: Explain which TypeScript or TSX files import a selected file and what it imports directly. Use when someone wants to understand where a file fits before changing it, with a focused dependency diagram and source lines.
---

# Explain this file

Use the user's file and scan the source tree that contains its potential importers. Scanning just the file's directory can miss its callers. Use the project root for a workspace spanning multiple source directories. State the scan scope in the answer.

Call C4 Architect's `explain_architecture_file` with absolute `targetDir` and `outputPath`, and a scan-relative `file` or unique basename. Use the requested report destination or a fresh directory for the report and its diagram. If several files match, present the candidate paths and let the user choose. For aliased imports the scanner reads the nearest TypeScript configuration. Pass `tsconfigPath` when the project uses a different one.

If the tool is unavailable, use the matching CLI. In a source checkout or unpacked npm package, `dist/index.js` is three directories above the real skill directory. For example, from the C4 Architect checkout:

```sh
node dist/index.js explain-file /path/to/project/src Editor.tsx --out /path/to/output/Editor.md
```

For a clean GitHub snapshot, supply `repository`, `commit`, and `sourceRoot` (CLI: `--github-repo`, `--commit`, `--source-root`) using the actual owner/repo, full revision, and scan directory relative to the repository root. Use local source links when the scanned files include working changes or the remote or revision is uncertain.

Read the resulting Markdown and show the focused diagram. Identify who imports the file and what it imports in separate sentences. Give representative source links in both directions when available, pointing to the import statements in the importing files. Link the full report for the rest. Distinguish repeated specifiers from distinct neighbors and name unresolved imports or omitted connections that affect the answer. Describe arrows as static source dependencies. A runtime call sequence requires separate evidence.
