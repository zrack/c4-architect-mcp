# Trail Notes retry

A hiker submits a trail note. The submission saves `note-1`, then the demo transport loses the response and throws a timeout. The client retries the same request once. The repository returns `note-1` again and keeps one stored note. Reusing the key with a changed draft raises a conflict.

The timeout is simulated after the save so the same scenario runs every time. The demo uses a synchronous in-memory repository and scopes request keys by author. Its lookup and insert are atomic within the single process.

## Run the demo

From the repository root, install dependencies with `npm ci` and run these commands.

```sh
npm exec -- tsc -p examples/trail-notes/tsconfig.json
node output/trail-notes-retry/demo/demo.js
```

The demo asserts that both attempts use the same key, the retry returns the ID from the first save, and one note remains stored. It also checks that a changed draft is rejected without a retry. [Demo assertions](src/demo.ts#L27)

## Render the diagrams

The Component view shows which part of the system owns the retry and duplicate prevention. The Code view zooms into the repository contract and implementation. The models describe behavior traced to the demo source.

```sh
npx -y c4-architect-mcp@0.2.0-alpha.5 render-diagram examples/trail-notes/diagrams/component.json --out output/trail-notes-retry/Component.md
npx -y c4-architect-mcp@0.2.0-alpha.5 render-diagram examples/trail-notes/diagrams/code.json --out output/trail-notes-retry/Code.md
```

Open the generated HTML files for the interactive diagrams. Select an arrow to see its source locations, or use the links below.

The [Structurizr workspace input](diagrams/structurizr-workspace.json) combines the published Context and Container examples with the Component and Physical Deployment diagrams from this directory. Follow the [Structurizr export instructions](../../README.md#export-a-structurizr-dsl-workspace) to open the four views in Structurizr Local.

### Component

The client owns the retry. The Notes API validates the draft and delegates duplicate prevention to its repository.

| Arrow | Relationship | Source |
| --- | --- | --- |
| R01 | Retries with the same request key | [Retry only on timeout](src/trail-client.ts#L18) · [Resend the same request](src/trail-client.ts#L21) · [Lose the first response after the save](src/demo.ts#L22) |
| R02 | Forwards author, key, and draft | [Forward the request](src/submit-note.ts#L21) · [Return the note ID](src/submit-note.ts#L22) |
| R03 | Validates the draft before saving | [Validate the draft](src/note-service.ts#L10) · [Require a trail ID and body](src/note.ts#L4) |
| R04 | Delegates duplicate prevention | [Use the repository contract](src/note-service.ts#L11) · [Scope the key to the author](src/note-repository.ts#L24) |

### Code

Inside the repository, lookup and insert run synchronously. A matching retry gets the existing note, and a changed draft raises a conflict.

| Arrow | Relationship | Source |
| --- | --- | --- |
| R01 | Passes author, key, and draft | [Call insertOrGet](src/note-service.ts#L11) · [Typed contract returns SavedNote](src/note-repository.ts#L6) |
| R02 | Implements the repository contract | [Implement the interface](src/note-repository.ts#L15) · [Start the synchronous operation](src/note-repository.ts#L22) |
| R03 | Looks up and inserts synchronously | [Build the author and request key](src/note-repository.ts#L24) · [Look up the existing note](src/note-repository.ts#L25) · [Insert only when the key is new](src/note-repository.ts#L39) |
| R04 | Returns the stored ID on a matching retry | [Look up the author and request key](src/note-repository.ts#L24) · [Return the existing note](src/note-repository.ts#L30) · [Check the ID returned by the retry](src/demo.ts#L29) |
| R05 | Rejects a changed draft under the same key | [Compare the saved and retried drafts](src/note-repository.ts#L27) · [Raise a key conflict](src/note-repository.ts#L28) · [Check the changed draft is rejected](src/demo.ts#L35) |
