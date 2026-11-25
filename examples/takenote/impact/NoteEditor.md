# What depends on client/containers/NoteEditor.tsx?

**1 direct** and **2 indirect** dependent files observed within 3 hops. Start with the direct importers. Each path follows source references back to the selected file.

![Dependent files and their shortest import paths](<NoteEditor.focus-0e29d2d8efc11823.png>)

## Direct dependents

- client/containers/TakeNoteApp.tsx → client/containers/NoteEditor.tsx · [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)

## Indirect dependents

- client/containers/App.tsx → client/containers/TakeNoteApp.tsx → client/containers/NoteEditor.tsx · [R02](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/App.tsx#L7>) → [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)
- client/index.tsx → client/containers/App.tsx → client/containers/TakeNoteApp.tsx → client/containers/NoteEditor.tsx · [R03](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/index.tsx#L8>) → [R02](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/App.tsx#L7>) → [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)

## Source evidence

| Arrow | Importer → dependency | Reference | Source line |
| --- | --- | --- | --- |
| R01 | client/containers/TakeNoteApp.tsx → client/containers/NoteEditor.tsx | Imports module | [client/containers/TakeNoteApp.tsx:11:28](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>) (@/containers/NoteEditor) |
| R02 | client/containers/App.tsx → client/containers/TakeNoteApp.tsx | Imports module | [client/containers/App.tsx:7:29](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/App.tsx#L7>) (@/containers/TakeNoteApp) |
| R03 | client/index.tsx → client/containers/App.tsx | Imports module | [client/index.tsx:8:21](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/index.tsx#L8>) (@/containers/App) |

## Scope

Each file appears once, at its shortest distance. When multiple shortest paths exist, the diagram and list show one. A type-only hop records a compile-time dependency. Whether a change affects runtime behavior requires checking the implementation.

The scan covered 76 TypeScript/TSX files. Analysis status: **partial**.

Warnings and errors in this scan: 155. Unresolved or unparsed references can hide additional importers. NON_LITERAL_DEPENDENCY (1), UNRESOLVED_PACKAGE (148), UNSUPPORTED_MODULE_TYPE (6).
