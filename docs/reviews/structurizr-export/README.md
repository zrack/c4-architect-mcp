# Trail Notes Structurizr review

Save the editable workspace as `workspace.dsl`. Point Structurizr Local at its directory, then use the diagram selector to switch views. [Download the workspace](workspace.dsl) · [Structurizr Local quickstart](https://docs.structurizr.com/local/quickstart)

| View | Nodes | Relationships | Structurizr screenshot |
| --- | ---: | ---: | --- |
| Context | 4 | 3 | [Context](Trail-Notes-Context-in-Structurizr.jpg) |
| Container | 6 | 5 | [Container](Trail-Notes-Container-in-Structurizr.jpg) |
| Component | 5 | 4 | [Component](Trail-Notes-Component-in-Structurizr.jpg) |
| Physical Deployment | 9 | 4 | [Physical Deployment](Trail-Notes-Physical-Deployment-in-Structurizr.jpg) |

The screenshots show the fictional Trail Notes workspace open in Structurizr Local. The Component view follows the retry flow inside the Notes API. The Physical Deployment view places the web app, API, and database on the visitor center hardware.

Run these commands from the repository root with dependencies installed to regenerate the DSL. [Trail Notes workspace input](../../../examples/trail-notes/diagrams/structurizr-workspace.json)

```sh
npm run build
node dist/index.js render-structurizr examples/trail-notes/diagrams/structurizr-workspace.json --out output/trail-notes-structurizr/workspace.dsl
```
