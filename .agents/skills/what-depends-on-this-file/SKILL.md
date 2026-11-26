---
name: what-depends-on-this-file
description: Find which TypeScript or TSX files to inspect before changing a file. Trace direct and indirect importers through source-linked dependency paths and show a focused diagram.
---

# What depends on this file?

Use the source directory that contains the candidate importers as well as the selected file. A scan of one component directory can miss consumers elsewhere. Use a scan-relative file path or a unique basename. If a basename matches several files, ask the user to pick a path.

Call C4 Architect's `analyze_file_impact` with `targetDir`, `file`, and a fresh Markdown `outputPath`. Supply `tsconfigPath` if aliases require a specific configuration. For a clean GitHub checkout, pass the verified `repository`, full `commit`, and repository-relative `sourceRoot`. For modified working files, use local evidence so links describe the code actually scanned.

If the MCP tool is unavailable, run the installed CLI from the project you want to inspect.

```sh
c4-architect-mcp impact-file /path/to/project/src NoteEditor.tsx \
  --out /path/to/output/NoteEditor-impact.md --depth 3 --nodes 25
```

Follow imports **toward** the selected file. Start the answer with the direct importers, then name the nearest indirect dependents and show a representative shortest path. Link each hop to the import statement in the importing file. Explain why a file is a place to review, distinguishing type-only dependencies when present. Static imports alone cannot predict which behavior or tests will break.

Read the report before summarizing, link it, and show its focused diagram. State the scan root and any missing evidence or limits that could hide importers. When no dependents were found, qualify the result to the scanned source. If a limit hides part of the graph, report the cutoff and expand the view only if the user's question calls for it.
