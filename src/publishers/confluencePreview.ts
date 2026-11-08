import fs from "node:fs/promises";
import path from "node:path";
import { htmlText, renderWikiDiagrams, writeWikiAttachments, type WikiAttachment, type WikiDiagram } from "./wikiDiagrams.js";

export interface ConfluencePreview {
  title: string;
  storage: string;
  html: string;
  attachments: WikiAttachment[];
}

const displayWidth = (diagram: WikiDiagram) => Math.min(diagram.width, 800);
const storageText = (value: string) => htmlText(value.replace(/[\uD800-\uDFFF\uFFFE\uFFFF]/gu, "\uFFFD"));

function renderStorage(description: string, diagrams: WikiDiagram[]) {
  const sections: string[] = [];
  if (description) sections.push(`<p>${storageText(description)}</p>`);
  for (const diagram of diagrams) {
    const title = storageText(diagram.title);
    sections.push(`<h2>${title}</h2>`);
    if (diagram.caption) sections.push(`<p>${storageText(diagram.caption)}</p>`);
    sections.push(`<p><ac:image ac:alt="${title}" ac:width="${displayWidth(diagram)}"><ri:attachment ri:filename="${diagram.name}" /></ac:image></p>`);
  }
  return sections.join("\n") + "\n";
}

function renderHtml(title: string, description: string, diagrams: WikiDiagram[]) {
  const safeTitle = htmlText(title);
  const sections = diagrams.map((diagram, index) => {
    const label = htmlText(diagram.title);
    const attachment = `./.attachments/${diagram.name}`;
    const width = displayWidth(diagram);
    const height = Math.round(diagram.height * width / diagram.width);
    return `<section aria-labelledby="diagram-${index + 1}">
  <h2 id="diagram-${index + 1}">${label}</h2>
  ${diagram.caption ? `<p>${htmlText(diagram.caption)}</p>` : ""}
  <a class="diagram" href="${attachment}" aria-label="Open ${label} at full size">
    <img src="${attachment}" alt="${label}" width="${width}" height="${height}">
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
<title>${safeTitle} · Confluence preview</title>
<style>
:root { color-scheme: light; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172b4d; background: #fff; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: #0c66e4; text-underline-offset: .15em; }
.topbar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 10px 22px; border-bottom: 1px solid #dcdfe4; background: #fff; }
.brand { display: inline-flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; }
.brand-mark { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 6px; color: #fff; background: #0c66e4; }
.preview-badge { margin-left: auto; padding: 3px 8px; border-radius: 4px; color: #0055cc; background: #e9f2ff; font-size: 12px; font-weight: 600; white-space: nowrap; }
.shell { display: grid; grid-template-columns: 214px minmax(0, 1fr) 196px; min-height: calc(100vh - 56px); }
.sidebar { padding: 24px 12px; border-right: 1px solid #dcdfe4; background: #f7f8f9; }
.nav-label { margin: 0 8px 8px; color: #44546f; font-size: 12px; font-weight: 700; }
.nav-selected { display: block; padding: 8px 10px; border-radius: 4px; background: #e9f2ff; color: #0055cc; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
main { width: 100%; max-width: 920px; margin: 0 auto; padding: 30px 36px 50px; overflow-wrap: anywhere; }
.crumb { margin: 0 0 19px; color: #44546f; font-size: 13px; }
h1 { margin: 0 0 12px; font-size: 36px; line-height: 1.2; letter-spacing: -.02em; }
h2 { margin: 27px 0 8px; font-size: 23px; line-height: 1.3; scroll-margin-top: 74px; }
p { margin: 0 0 12px; }
.diagram { display: inline-block; max-width: 100%; border: 1px solid #dcdfe4; border-radius: 5px; vertical-align: top; }
.diagram:hover, .diagram:focus-visible { outline: 2px solid #0c66e4; outline-offset: 2px; }
.diagram img { display: block; max-width: 100%; height: auto; border-radius: 4px; }
.contents { position: sticky; top: 79px; align-self: start; margin: 27px 14px 0 0; padding-left: 12px; border-left: 1px solid #dcdfe4; overflow-wrap: anywhere; }
.contents strong { color: #44546f; }
.contents ul { margin: 8px 0 0; padding: 0; list-style: none; }
.contents li { margin: 0 0 8px; }
@media (max-width: 1080px) { .shell { grid-template-columns: 170px minmax(0, 1fr); } .contents { display: none; } }
@media (max-width: 640px) { .shell { display: block; } .sidebar { display: none; } main { padding: 22px 18px 36px; } h1 { font-size: 30px; } }
</style>
</head>
<body id="top">
<header class="topbar">
  <span class="brand"><span class="brand-mark" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 7 7-4 7 4-7 4-7-4Zm0 5 7 4 7-4m-14 5 7 4 7-4"/></svg></span>Confluence</span>
  <span class="preview-badge">Local preview</span>
</header>
<div class="shell">
  <nav class="sidebar" aria-label="Pages">
    <p class="nav-label">Pages</p>
    <a class="nav-selected" href="#top" aria-current="page">${safeTitle}</a>
  </nav>
  <main>
    <p class="crumb">Space / Pages</p>
    <h1>${safeTitle}</h1>
    ${description ? `<p>${htmlText(description)}</p>` : ""}
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

export async function buildConfluencePreview(input: unknown): Promise<ConfluencePreview> {
  const { title, description, diagrams } = await renderWikiDiagrams(input);
  return {
    title,
    storage: renderStorage(description, diagrams),
    html: renderHtml(title, description, diagrams),
    attachments: diagrams.map(({ name, data }) => ({ name, data })),
  };
}

export async function writeConfluencePreview(preview: ConfluencePreview, outputDir: string) {
  const root = path.resolve(outputDir);
  const storage = path.join(root, "page.storage.xhtml");
  const html = path.join(root, "index.html");
  const attachments = await writeWikiAttachments(root, preview.attachments);
  await Promise.all([fs.writeFile(storage, preview.storage, "utf8"), fs.writeFile(html, preview.html, "utf8")]);
  return { storage, html, attachments };
}
