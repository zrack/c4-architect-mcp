# Documentation images

These are project-authored illustrations and captures from the C4 Architect server and interactive view. The order-service and 20-node examples use synthetic data. The TakeNote comparison uses public source code.

| Asset | Origin |
| --- | --- |
| `hero.svg` | Project-authored title artwork, maintained directly as SVG. |
| `workflow.svg` | Project-authored explanation of the source → graph → review → diagram workflow, maintained directly as SVG. |
| `component-example.png`, `component-example.svg` | The real `analyze_architectural_boundaries` and `render_architecture_graph` MCP tools applied to `examples/order-service/src` with the explicit example boundary configuration: five declared components and five observed source dependencies. |
| `component-20.png`, `component-20.svg` | The real `render_c4_mermaid` MCP tool applied to the authored 20-node, 35-relationship fixture in `test/fixtures/component-scale.mjs`. This fixture tests rendering; its relationships are not source-extracted. |
| `selection-example.png`, `selection-example.svg` | Actual browser downloads from the 20-node interactive view's **Export PNG** and **Export SVG** buttons with **Order orchestration** selected. Both contain the full diagram and its current highlighting. |
| `export-toolbar.png` | A browser screenshot of the generated interactive view's header and export controls. |
| `takenote-side-by-side.png` | Two diagrams rendered by `0.2.0-alpha.2` from the same saved Component graph of Tania Rascia’s TakeNote. The full view shows 108 nodes and 363 relationships. The focused view shows `NoteEditor.tsx` and its direct neighbors in both directions, with 15 nodes and 19 relationships. [TakeNote source revision](https://github.com/taniarascia/takenote/tree/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/src) · [TakeNote MIT license](https://github.com/taniarascia/takenote/blob/e0eddbb9a21ae4cf4c4c7c183f29cfd666e08331/LICENSE) |

Regenerate the order-service and 20-node examples with [scripts/create-docs-examples.mjs](../../scripts/create-docs-examples.mjs). From the repository root:

```sh
npm ci
npm run build
npx playwright install chromium
C4_BROWSER_CHANNEL=chromium node scripts/create-docs-examples.mjs
```

On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are needed. In PowerShell, set `$env:C4_BROWSER_CHANNEL = "chromium"` before running the script. Without that variable, the script uses installed Google Chrome.

The script starts the built server over local `stdio`, saves intermediate graphs and diagram artifacts under `output/docs/`, and copies the documentation assets here. It uses a real browser to select the component and download the highlighted exports. It does not redraw a screenshot to imitate server output.

PNG selection exports have twice the diagram's natural width and height. SVG exports remain scalable. The full-size links in the main README are useful when a repository viewer shrinks the images to fit its page.

For geometry, interaction, and export regression checks, run:

```sh
C4_BROWSER_CHANNEL=chromium npm run test:layout
```

These project-authored assets and their fixture data are distributed under the repository's [MIT License](../../LICENSE). Dependency licenses remain applicable; see [NOTICE](../../NOTICE) and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
