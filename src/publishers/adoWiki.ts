import { createHash, randomUUID } from "node:crypto";
import { buildAdoWikiPreview, writeAdoWikiPreview, type AdoWikiPreview } from "./adoWikiPreview.js";
import { adoWikiTargetSchema, createAdoWikiClient, type AdoWikiTarget } from "./adoWikiTransport.js";

interface AdoWikiOptions {
  outputDir: string;
  target?: AdoWikiTarget;
  publish?: boolean;
}

const marker = /^<!-- c4-architect:ado-wiki:v1 plan=([a-f0-9]{64}) content=([a-f0-9]{64}) -->\n/;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const normalizeMarkdown = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");

function planId(preview: AdoWikiPreview): string {
  const hash = createHash("sha256").update(normalizeMarkdown(preview.markdown));
  for (const asset of preview.attachments) {
    hash.update(asset.name).update(createHash("sha256").update(asset.data).digest());
  }
  return hash.digest("hex");
}

function readManagedPage(content: string): string {
  const normalized = normalizeMarkdown(content);
  const match = marker.exec(normalized);
  if (!match || digest(normalized.slice(match[0].length)) !== match[2]) {
    throw new Error("The Wiki page exists and is not an intact C4 Architect page. Use a new page path to publish.");
  }
  return match[1];
}

export async function runAdoWiki(input: unknown, options: AdoWikiOptions, dependencies?: Parameters<typeof createAdoWikiClient>[1]) {
  const target = options.target === undefined ? undefined : adoWikiTargetSchema.parse(options.target);
  if (options.publish && !target) throw new Error("Publishing requires an organization, project, wiki, and page path.");
  if (!options.outputDir.trim()) throw new Error("A preview output directory is required.");
  const preview = await buildAdoWikiPreview(input);
  const artifacts = await writeAdoWikiPreview(preview, options.outputDir);
  if (!options.publish || !target) return { mode: "preview" as const, artifacts, ...(target ? { target } : {}) };

  const client = createAdoWikiClient(target, dependencies);
  const current = await client.getPage();
  const plan = planId(preview);
  if (current && readManagedPage(current.content) === plan) {
    return { mode: "unchanged" as const, target, artifacts, etag: current.etag };
  }

  // Wiki attachments are separate Git writes. A fresh namespace lets a retry
  // proceed even when an earlier attempt uploaded files without saving the page.
  const attempt = randomUUID();
  let markdown = normalizeMarkdown(preview.markdown);
  const attemptedAttachments: string[] = [];
  try {
    for (const asset of preview.attachments) {
      const name = asset.name.replace(/\.png$/i, `-${attempt}.png`);
      attemptedAttachments.push(name);
      const attachment = await client.putAttachment(name, asset.data);
      markdown = markdown.replaceAll(`/.attachments/${asset.name}`, attachment.path);
    }
    const content = `<!-- c4-architect:ado-wiki:v1 plan=${plan} content=${digest(markdown)} -->\n${markdown}`;
    const page = await client.putPage(content, current?.etag);
    return { mode: "published" as const, target, artifacts, pageUrl: page.url, etag: page.etag };
  } catch (error) {
    if (!attemptedAttachments.length) throw error;
    const message = error instanceof Error ? error.message : "Azure DevOps Wiki publish failed.";
    throw new Error(`${message} Attachments from this attempt may exist: ${attemptedAttachments.join(", ")}.`);
  }
}
