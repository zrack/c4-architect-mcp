import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { diagramSchema } from "../model/diagram.js";
import { renderCompactC4 } from "../renderers/compactC4.js";

export const wikiDocumentSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  diagrams: z.array(diagramSchema).min(1).max(7),
});

export interface WikiAttachment {
  name: string;
  data: Buffer;
}

export interface WikiDiagram extends WikiAttachment {
  title: string;
  caption: string;
  width: number;
  height: number;
}

export const htmlEntities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

const singleLine = (value: string) => value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
export const htmlText = (value: string) => value.replace(/[&<>"']/g, character => htmlEntities[character]);

export async function renderWikiDiagrams(input: unknown) {
  const document = wikiDocumentSchema.parse(input);
  const title = singleLine(document.title);
  if (!title) throw new Error("Wiki page title must contain text");
  const description = singleLine(document.description ?? "");
  const diagrams: WikiDiagram[] = [];
  for (const diagram of document.diagrams) {
    const { png, layout } = await renderCompactC4(diagram);
    const hash = createHash("sha256").update(png).digest("hex");
    const index = diagrams.length + 1;
    const slug = diagram.c4Level.slice(2).toLowerCase();
    diagrams.push({
      title: singleLine(diagram.title), caption: singleLine(diagram.caption ?? ""),
      name: `c4-${index}-${slug}-${hash}.png`, data: png,
      width: layout.width, height: layout.height,
    });
  }
  return { title, description, diagrams };
}

export async function writeWikiAttachments(root: string, attachments: WikiAttachment[]) {
  const attachmentDir = path.join(root, ".attachments");
  const paths = attachments.map(({ name }) => {
    if (!/^c4-[1-7]-[a-z]+-[0-9a-f]{64}\.png$/.test(name)) throw new Error("Invalid wiki preview attachment name");
    return path.join(attachmentDir, name);
  });
  await fs.mkdir(attachmentDir, { recursive: true });
  await Promise.all(paths.map((file, index) => fs.writeFile(file, attachments[index].data)));
  return paths;
}
