import fs from "node:fs/promises";
import path from "node:path";
import { htmlText, renderWikiDiagrams, writeWikiAttachments, type WikiDiagram } from "./wikiDiagrams.js";

export interface NotionPreview {
  title: string;
  description: string;
  diagrams: WikiDiagram[];
  html: string;
}

const attachmentPath = (diagram: WikiDiagram) => `.attachments/${diagram.name}`;

function renderHtml(title: string, description: string, diagrams: WikiDiagram[]) {
  const safeTitle = htmlText(title);
  const sections = diagrams.map((diagram, index) => {
    const label = htmlText(diagram.title);
    const attachment = htmlText(attachmentPath(diagram));
    return `<section aria-labelledby="diagram-${index + 1}">
  <h2 id="diagram-${index + 1}">${label}</h2>
  <figure>
    <a class="diagram" href="${attachment}" aria-label="Open ${label} at full size">
      <img src="${attachment}" alt="${label}" width="${diagram.width}" height="${diagram.height}">
    </a>
    ${diagram.caption ? `<figcaption>${htmlText(diagram.caption)}</figcaption>` : ""}
  </figure>
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
<title>${safeTitle} · Notion preview</title>
<style>
:root { color-scheme: light; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #37352f; background: #fff; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: inherit; }
a:focus-visible { outline: 2px solid #2383e2; outline-offset: 3px; border-radius: 3px; }
.shell { display: grid; grid-template-columns: 216px minmax(0, 1fr); min-height: 100vh; }
.sidebar { padding: 16px 12px; background: #f7f7f5; border-right: 1px solid #ececea; overflow-wrap: anywhere; }
.workspace { display: flex; align-items: center; gap: 9px; margin: 0 6px 24px; font-size: 14px; font-weight: 650; }
.workspace-mark { display: grid; flex: 0 0 23px; place-items: center; height: 23px; border: 1px solid #dddcd8; border-radius: 4px; background: #fff; font: 700 16px Georgia, serif; }
.nav-label { margin: 0 8px 5px; color: #66655f; font-size: 12px; font-weight: 600; }
.nav-selected { display: block; padding: 5px 8px; border-radius: 5px; background: #eaeae7; font-size: 14px; font-weight: 550; text-decoration: none; }
.page { min-width: 0; }
.topbar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 48px; padding: 9px 20px; background: #fff; border-bottom: 1px solid #f1f1ef; }
.breadcrumb { min-width: 0; overflow: hidden; color: #37352f; font-size: 14px; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.preview-badge { padding: 3px 8px; border: 1px solid #e8e7e4; border-radius: 4px; color: #605e56; background: #f7f7f5; font-size: 12px; white-space: nowrap; }
.body { display: grid; grid-template-columns: minmax(0, 1fr) 172px; }
main { width: 100%; max-width: 808px; margin: 0 auto; padding: 54px 30px 68px; overflow-wrap: anywhere; }
h1 { margin: 0 0 10px; font-size: 40px; line-height: 1.2; letter-spacing: -.025em; }
.description { margin: 0 0 30px; }
section + section { margin-top: 31px; }
h2 { margin: 0 0 9px; font-size: 24px; line-height: 1.3; scroll-margin-top: 66px; }
figure { margin: 0; }
.diagram { display: inline-block; max-width: 100%; vertical-align: top; }
.diagram img { display: block; max-width: 100%; height: auto; }
.diagram:hover { outline: 1px solid #d9d8d4; }
figcaption { margin-top: 5px; color: #67665f; font-size: 14px; }
.contents { position: sticky; top: 71px; align-self: start; margin: 50px 18px 0 0; padding-left: 11px; border-left: 1px solid #e8e7e4; color: #66655f; font-size: 12px; overflow-wrap: anywhere; }
.contents ul { margin: 6px 0 0; padding: 0; list-style: none; }
.contents li + li { margin-top: 5px; }
.contents a { text-decoration: none; }
.contents a:hover { text-decoration: underline; }
@media (max-width: 1100px) { .body { display: block; } .contents { display: none; } }
@media (max-width: 660px) { .shell { display: block; } .sidebar { display: none; } main { padding: 34px 18px 42px; } h1 { font-size: 34px; } }
</style>
</head>
<body id="top">
<div class="shell">
  <nav class="sidebar" aria-label="Workspace">
    <p class="workspace"><span class="workspace-mark" aria-hidden="true">N</span>Notion</p>
    <p class="nav-label">Pages</p>
    <a class="nav-selected" href="#top" aria-current="page">${safeTitle}</a>
  </nav>
  <div class="page">
    <header class="topbar">
      <a class="breadcrumb" href="#top">${safeTitle}</a>
      <span class="preview-badge">Local preview</span>
    </header>
    <div class="body">
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
  </div>
</div>
</body>
</html>
`;
}

export async function buildNotionPreview(input: unknown): Promise<NotionPreview> {
  const { title, description, diagrams } = await renderWikiDiagrams(input);
  return { title, description, diagrams, html: renderHtml(title, description, diagrams) };
}

export async function writeNotionPreview(preview: NotionPreview, outputDir: string) {
  const root = path.resolve(outputDir);
  const html = path.join(root, "index.html");
  const manifest = path.join(root, "page.json");
  const attachments = await writeWikiAttachments(root, preview.diagrams);
  const page = {
    title: preview.title,
    description: preview.description,
    diagrams: preview.diagrams.map(diagram => ({
      title: diagram.title,
      caption: diagram.caption,
      path: attachmentPath(diagram),
      width: diagram.width,
      height: diagram.height,
    })),
  };
  await Promise.all([
    fs.writeFile(html, preview.html, "utf8"),
    fs.writeFile(manifest, JSON.stringify(page, null, 2) + "\n", "utf8"),
  ]);
  return { html, manifest, attachments };
}
