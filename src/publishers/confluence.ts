import { createHash } from "node:crypto";
import { buildConfluencePreview, writeConfluencePreview } from "./confluencePreview.js";
import { confluenceTargetSchema, createConfluenceClient, type ConfluenceTarget } from "./confluenceTransport.js";

interface ConfluenceOptions {
  outputDir: string;
  target?: ConfluenceTarget;
  publish?: boolean;
}

const placeholder = "<p>C4 Architect is preparing the diagram attachments for this page.</p>";
const versionMarker = "c4-architect:confluence:v1";
const managedVersion = /^c4-architect:confluence:v1 ([a-f0-9]{64}) version ([1-9]\d*)$/;

export async function runConfluence(input: unknown, options: ConfluenceOptions, dependencies?: Parameters<typeof createConfluenceClient>[1]) {
  const target = options.target === undefined ? undefined : confluenceTargetSchema.parse(options.target);
  if (options.publish && !target) throw new Error("Publishing requires a Confluence Cloud site and space ID.");
  if (!options.outputDir.trim()) throw new Error("A preview output directory is required.");
  const preview = await buildConfluencePreview(input);
  const artifacts = await writeConfluencePreview(preview, options.outputDir);
  if (!options.publish || !target) return { mode: "preview" as const, artifacts, ...(target ? { target } : {}) };

  const client = await createConfluenceClient(target, dependencies);
  const page = target.pageId
    ? await client.getPage(target.pageId)
    : await client.createPage(preview.title, placeholder);
  const previous = managedVersion.exec(page.version.message ?? "");
  const hasManagedVersion = previous?.[2] === String(page.version.number);
  const isPlaceholder = page.version.number === 1 && page.body?.storage?.value?.trim() === placeholder;
  if (target.pageId && !hasManagedVersion && !isPlaceholder) {
    throw new Error("The Confluence page is not managed by C4 Architect or was edited after publishing. Use a dedicated generated page.");
  }

  const pageId = page.id;
  const pageUrl = client.pageUrl(pageId);
  const digest = createHash("sha256").update(JSON.stringify([preview.title, preview.storage])).digest("hex");
  let uploadedAttachments = 0;
  try {
    for (const asset of preview.attachments) {
      if (await client.ensureAttachment(pageId, asset)) uploadedAttachments++;
    }
    if (hasManagedVersion && previous?.[1] === digest) {
      return { mode: "unchanged" as const, artifacts, target, pageId, pageUrl, version: page.version.number, uploadedAttachments };
    }
    const message = `${versionMarker} ${digest} version ${page.version.number + 1}`;
    const saved = await client.updatePage(page, preview.title, preview.storage, message);
    return { mode: "published" as const, artifacts, target, pageId, pageUrl, version: saved.version.number, uploadedAttachments };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Confluence publish failed.";
    throw new Error(`${message} Check page ${pageId} before retrying with that page ID. Diagram attachments may already exist.`);
  }
}
