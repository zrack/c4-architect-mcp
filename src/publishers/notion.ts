import { buildNotionPreview, writeNotionPreview } from "./notionPreview.js";
import { createNotionClient, notionTargetSchema, type NotionTarget } from "./notionTransport.js";

interface NotionOptions {
  outputDir: string;
  target?: NotionTarget;
  publish?: boolean;
}

function richText(value: string) {
  const items: { type: "text"; text: { content: string } }[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + 2000, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    items.push({ type: "text", text: { content: value.slice(start, end) } });
    if (items.length > 100) throw new Error("A Notion text field exceeds 100 rich text items.");
    start = end;
  }
  return items;
}

export async function runNotion(input: unknown, options: NotionOptions, dependencies?: Parameters<typeof createNotionClient>[0]) {
  const target = options.target === undefined ? undefined : notionTargetSchema.parse(options.target);
  if (options.publish && !target) throw new Error("Publishing requires a Notion parent page ID.");
  if (!options.outputDir.trim()) throw new Error("A preview output directory is required.");
  const preview = await buildNotionPreview(input);
  const artifacts = await writeNotionPreview(preview, options.outputDir);
  if (!options.publish || !target) return { mode: "preview" as const, artifacts, ...(target ? { target } : {}) };

  const views = preview.diagrams.map(diagram => ({
    heading: { object: "block", type: "heading_2", heading_2: { rich_text: richText(diagram.title) } },
    image: {
      object: "block", type: "image",
      image: {
        type: "file_upload",
        // Check the complete request size before uploading. Notion returns UUIDs of this length.
        file_upload: { id: "00000000-0000-0000-0000-000000000000" },
        caption: richText(diagram.caption),
      },
    },
  }));
  const description = preview.description
    ? [{ object: "block", type: "paragraph", paragraph: { rich_text: richText(preview.description) } }]
    : [];
  const payload = {
    parent: { type: "page_id", page_id: target.parentPageId },
    properties: { title: { type: "title", title: richText(preview.title) } },
    children: [...description, ...views.flatMap(({ heading, image }) => [heading, image])],
  };
  if (Buffer.byteLength(JSON.stringify(payload)) > 500_000) throw new Error("The Notion page body exceeds 500 KB.");
  for (const diagram of preview.diagrams) {
    if (diagram.data.length > 20 * 1024 * 1024) throw new Error("A diagram exceeds Notion's 20 MiB direct upload limit.");
  }

  const client = createNotionClient(dependencies);
  for (const [index, diagram] of preview.diagrams.entries()) {
    views[index].image.image.file_upload.id = await client.uploadImage(diagram);
  }
  const page = await client.createPage(payload);
  return { mode: "published" as const, artifacts, target, ...page, uploadedAttachments: views.length };
}
