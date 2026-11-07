# Third-party notices

C4-Architect's own source is MIT licensed. That does not relicense its dependencies. npm installs those packages separately with their upstream license and notice files. Keep those notices when redistributing dependencies or bundling the application.

The direct runtime dependencies in this alpha are:

| Dependency | Version | Upstream license |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT |
| `tree-sitter` | 0.21.1 | MIT |
| `tree-sitter-typescript` | 0.21.2 | MIT |
| `zod` | 4.6.7 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `elkjs` | 0.12.1 | EPL-2.0 OR GPL-3.0-or-later |
| `sharp` | 0.35.5 | Apache-2.0 |

Use the EPL-2.0 option for ELK.js in this distribution. Its upstream license is included in `node_modules/elkjs/LICENSE.md`. This project does not modify or vendor ELK.js source.

Sharp's optional native dependencies depend on platform and installation choices. The tested macOS ARM64 installation includes `@img/sharp-libvips-darwin-arm64` 1.3.4 under LGPL-3.0-or-later. Read the package's bundled notices and Sharp's [installation and licensing documentation](https://sharp.pixelplumbing.com/install/), including the notices for libvips and its libraries, before redistributing native binaries.

The lockfile records transitive packages. Their licenses are provided in each installed package; this table is a direct-dependency guide, not an exhaustive replacement for upstream notices. Development tools (including Mermaid and Playwright) are not bundled in the runtime package. Generated diagrams are not assigned a separate license by this tool; their content may reflect the source or model supplied by the user.
