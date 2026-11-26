# What depends on src/client/containers/NoteEditor.tsx?

**1 direct** and **3 indirect** dependent files observed within 3 hops. Start with the direct importers. Each path follows source references back to the selected file.

![4 of 4 observed dependents within 3 hops · Importer → dependency · Partial scan](<NoteEditor.focus-6c9a79d70374087a.png>)

## Direct dependents

- src/client/containers/TakeNoteApp.tsx → src/client/containers/NoteEditor.tsx · [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)

## Indirect dependents

- src/client/containers/App.tsx → src/client/containers/TakeNoteApp.tsx → src/client/containers/NoteEditor.tsx · [R02](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/App.tsx#L7>) → [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)
- tests/unit/client/containers/TakeNoteApp.test.tsx → src/client/containers/TakeNoteApp.tsx → src/client/containers/NoteEditor.tsx · [R03](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/tests/unit/client/containers/TakeNoteApp.test.tsx#L8>) → [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)
- src/client/index.tsx → src/client/containers/App.tsx → src/client/containers/TakeNoteApp.tsx → src/client/containers/NoteEditor.tsx · [R04](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/index.tsx#L8>) → [R02](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/App.tsx#L7>) → [R01](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>)

## Source evidence

| Arrow | Importer → dependency | Reference | Source line |
| --- | --- | --- | --- |
| R01 | src/client/containers/TakeNoteApp.tsx → src/client/containers/NoteEditor.tsx | Imports module | [src/client/containers/TakeNoteApp.tsx:11:28](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/TakeNoteApp.tsx#L11>) (@/containers/NoteEditor) |
| R02 | src/client/containers/App.tsx → src/client/containers/TakeNoteApp.tsx | Imports module | [src/client/containers/App.tsx:7:29](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/containers/App.tsx#L7>) (@/containers/TakeNoteApp) |
| R03 | tests/unit/client/containers/TakeNoteApp.test.tsx → src/client/containers/TakeNoteApp.tsx | Imports module | [tests/unit/client/containers/TakeNoteApp.test.tsx:8:29](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/tests/unit/client/containers/TakeNoteApp.test.tsx#L8>) (@/containers/TakeNoteApp) |
| R04 | src/client/index.tsx → src/client/containers/App.tsx | Imports module | [src/client/index.tsx:8:21](<https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src/client/index.tsx#L8>) (@/containers/App) |

## Scope

Each file appears once, at its shortest distance. When multiple shortest paths exist, the diagram and list show one. A type-only hop records a compile-time dependency. Whether a change affects runtime behavior requires checking the implementation.

The scan covered 109 TypeScript/TSX files. Analysis status: **partial**.

Warnings and errors in this scan: 9. Unresolved or unparsed references can hide additional importers. NON_LITERAL_DEPENDENCY (1), UNRESOLVED_PACKAGE (2), UNSUPPORTED_MODULE_TYPE (6).
