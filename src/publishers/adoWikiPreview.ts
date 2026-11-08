import fs from "node:fs/promises";
import path from "node:path";
import { htmlEntities, htmlText, renderWikiDiagrams, writeWikiAttachments, type WikiAttachment, type WikiDiagram } from "./wikiDiagrams.js";

export { wikiDocumentSchema as adoWikiDocumentSchema } from "./wikiDiagrams.js";

export interface AdoWikiPreview {
  markdown: string;
  html: string;
  attachments: WikiAttachment[];
}

const markdownText = (value: string) => value
  .replace(/[&<>]/g, character => htmlEntities[character])
  .replace(/[\\`*_{}\[\]()#+.\-!~@]/g, "\\$&");

function renderMarkdown(title: string, description: string, diagrams: WikiDiagram[]): string {
  const sections = [`# ${markdownText(title)}`];
  if (description) sections.push(markdownText(description));
  for (const diagram of diagrams) {
    const label = markdownText(diagram.title);
    const attachment = `/.attachments/${diagram.name}`;
    sections.push(`## ${label}`);
    if (diagram.caption) sections.push(markdownText(diagram.caption));
    sections.push(`[![${label}](${attachment})](${attachment})`);
  }
  return sections.join("\n\n") + "\n";
}

function renderHtml(title: string, description: string, diagrams: WikiDiagram[]): string {
  const safeTitle = htmlText(title);
  const sections = diagrams.map((diagram, index) => {
    const label = htmlText(diagram.title);
    const attachment = `./.attachments/${diagram.name}`;
    return `<section aria-labelledby="diagram-${index + 1}">
  <h2 id="diagram-${index + 1}">${label}</h2>
  ${diagram.caption ? `<p>${htmlText(diagram.caption)}</p>` : ""}
  <a class="diagram" href="${attachment}" aria-label="Open ${label} at full size">
    <img src="${attachment}" alt="${label}" width="${diagram.width}" height="${diagram.height}">
  </a>
</section>`;
  }).join("\n");
  const contents = diagrams.map((diagram, index) =>
    `<li><a href="#diagram-${index + 1}">${htmlText(diagram.title)}</a></li>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${safeTitle} · Azure DevOps Wiki preview</title>
<style>
:root { color-scheme: light; font: 14px/1.5 "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif; color: #201f1e; background: #fff; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: #005a9e; text-underline-offset: .16em; }
.topbar { position: sticky; top: 0; z-index: 1; min-height: 54px; display: flex; align-items: center; gap: 16px; padding: 10px 22px; background: #fff; border-bottom: 1px solid #edebe9; }
.brand { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; font-size: 16px; font-weight: 600; color: #005a9e; }
.brand-icon { color: #0078d4; }
.crumb { color: #605e5c; }
.preview-badge { margin-left: auto; padding: 3px 8px; border-radius: 3px; background: #eff6fc; color: #004578; white-space: nowrap; font-size: 12px; }
.shell { display: grid; grid-template-columns: 210px minmax(0, 1fr) 195px; min-height: calc(100vh - 54px); }
.sidebar { background: #f8f8f8; border-right: 1px solid #edebe9; padding: 20px 12px; }
.nav-label { margin: 0 8px 10px; font-size: 12px; font-weight: 600; color: #605e5c; }
.nav-selected { display: block; padding: 8px 12px; border-left: 3px solid #0078d4; background: #e8f2fc; font-weight: 600; color: #201f1e; text-decoration: none; overflow-wrap: anywhere; }
main { width: 100%; max-width: 1150px; margin: 0 auto; padding: 24px 32px 48px; overflow-wrap: anywhere; }
h1 { margin: 0 0 10px; font-size: 31px; line-height: 1.25; font-weight: 600; }
h2 { margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #edebe9; font-size: 21px; font-weight: 600; scroll-margin-top: 70px; }
p { margin: 0 0 12px; }
.description { color: #484644; }
.diagram { display: inline-block; max-width: 100%; border: 1px solid #edebe9; }
.diagram:hover, .diagram:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; }
.diagram img { display: block; max-width: 100%; height: auto; }
.contents { position: sticky; top: 54px; align-self: start; margin: 25px 16px 0 0; padding-left: 12px; border-left: 1px solid #edebe9; overflow-wrap: anywhere; }
.contents strong { color: #605e5c; }
.contents ul { list-style: none; margin: 8px 0 0; padding: 0; }
.contents li { margin: 0 0 7px; }
@media (max-width: 1050px) { .shell { grid-template-columns: 160px minmax(0, 1fr); } .contents { display: none; } }
@media (max-width: 620px) { .shell { display: block; } .sidebar { display: none; } .crumb { display: none; } main { padding: 20px 14px 34px; } }
</style>
</head>
<body id="top">
<header class="topbar">
  <span class="brand"><svg class="brand-icon" width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2 8.5 8 3v3l7-2.5L18 2v15l-3 1.5-7-2.4v-3l-6-2.5Zm6 4.6 7 2.3V6.6L8 9Z"/></svg>Azure DevOps</span>
  <span class="crumb">Overview / Wiki</span>
  <span class="preview-badge">Local preview</span>
</header>
<div class="shell">
  <nav class="sidebar" aria-label="Wiki pages">
    <p class="nav-label">Wiki pages</p>
    <a class="nav-selected" href="#top" aria-current="page">${safeTitle}</a>
  </nav>
  <main>
    <h1>${safeTitle}</h1>
    ${description ? `<p class="description">${htmlText(description)}</p>` : ""}
    ${sections}
  </main>
  <nav class="contents" aria-label="On this page">
    <strong>On this page</strong>
    <ul>${contents}</ul>
  </nav>
</div>
</body>
</html>
`;
}

export async function buildAdoWikiPreview(input: unknown): Promise<AdoWikiPreview> {
  const { title, description, diagrams } = await renderWikiDiagrams(input);
  return {
    markdown: renderMarkdown(title, description, diagrams),
    html: renderHtml(title, description, diagrams),
    attachments: diagrams.map(({ name, data }) => ({ name, data })),
  };
}

export async function writeAdoWikiPreview(preview: AdoWikiPreview, outputDir: string) {
  const root = path.resolve(outputDir);
  const markdown = path.join(root, "page.md");
  const html = path.join(root, "index.html");
  const attachments = await writeWikiAttachments(root, preview.attachments);
  await Promise.all([fs.writeFile(markdown, preview.markdown, "utf8"), fs.writeFile(html, preview.html, "utf8")]);
  return { markdown, html, attachments };
}
