import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import type { WikiAttachment } from "./wikiDiagrams.js";

const apiBase = "https://api.notion.com/v1";
const notionVersion = "2026-03-11";
const uuid = z.uuid();
const pageId = z.string().trim()
  .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i, "Use a Notion page ID")
  .transform(value => value.toLowerCase().replaceAll("-", "")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"));

export const notionTargetSchema = z.object({ parentPageId: pageId });
export type NotionTarget = z.infer<typeof notionTargetSchema>;

const uploadResponse = z.object({
  object: z.literal("file_upload"),
  id: uuid,
  status: z.string(),
});
const pageResponse = z.object({
  object: z.literal("page"),
  id: uuid,
  url: z.url({ protocol: /^https$/ }).optional(),
});
const errorDetails = z.object({
  additional_data: z.object({
    committed_resource_id: uuid.optional(),
    rate_limit_reason: z.string().optional(),
    retry_after: z.string().optional(),
  }).optional(),
});

class NotionHttpError extends Error {
  constructor(operation: string, readonly status: number, readonly committedPageId?: string, retryAfter?: number) {
    const guidance = retryAfter === undefined ? "" : ` Retry after ${retryAfter} seconds.`;
    super(`Notion could not ${operation} (HTTP ${status}).${guidance}`);
  }
}

export function createNotionClient({
  env = process.env,
  fetch: request = globalThis.fetch,
}: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
  const token = env.NOTION_API_TOKEN?.trim();
  if (!token || /\s/.test(token)) throw new Error("Set NOTION_API_TOKEN in the environment to publish.");

  async function post<T>(endpoint: string, operation: string, body: string | FormData, schema: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Notion-Version": notionVersion,
    };
    if (typeof body === "string") headers["Content-Type"] = "application/json";

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await request(apiBase + endpoint, {
          method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new Error(`Could not confirm the Notion request to ${operation}. Check the connection.`);
      }
      const data: unknown = await response.json().catch(() => undefined);
      if (response.ok) {
        const result = schema.safeParse(data);
        if (!result.success) throw new Error(`Notion returned an unexpected response while trying to ${operation}.`);
        return result.data;
      }
      const details = errorDetails.safeParse(data).data?.additional_data;
      const throttled = (response.status === 429 || response.status === 529) &&
        details?.rate_limit_reason !== "public_api_request_blocked";
      const retryHeader = response.headers.get("Retry-After") ?? details?.retry_after;
      const retryAfter = throttled && retryHeader && /^\d{1,9}$/.test(retryHeader) ? Number(retryHeader) : undefined;
      // Retry only an explicit throttle, with a small bounded wait for MCP clients.
      if (throttled && attempt === 0 && (retryAfter ?? 1) <= 10) {
        await setTimeout((retryAfter ?? 1) * 1000);
        continue;
      }
      throw new NotionHttpError(operation, response.status, details?.committed_resource_id, retryAfter);
    }
  }

  const pageLink = (id: string) => "https://www.notion.so/" + id.replaceAll("-", "");

  return {
    async uploadImage(asset: WikiAttachment) {
      const upload = await post("/file_uploads", "prepare the diagram upload", JSON.stringify({
        mode: "single_part", filename: asset.name, content_type: "image/png",
      }), uploadResponse);
      if (upload.status !== "pending") throw new Error("Notion did not return a pending diagram upload.");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(asset.data)], { type: "image/png" }), asset.name);
      const sent = await post(`/file_uploads/${upload.id}/send`, "upload the diagram PNG", form, uploadResponse);
      if (sent.id !== upload.id || sent.status !== "uploaded") throw new Error("Notion did not confirm the diagram upload.");
      return sent.id;
    },
    async createPage(payload: object) {
      try {
        const page = await post("/pages", "create the diagram page", JSON.stringify(payload), pageResponse);
        return { pageId: page.id, pageUrl: page.url ?? pageLink(page.id) };
      } catch (error) {
        if (error instanceof NotionHttpError && error.status === 503 && error.committedPageId) {
          throw new Error(`Notion reported that it saved the page but timed out confirming it. Check ${pageLink(error.committedPageId)} before retrying.`);
        }
        if (!(error instanceof NotionHttpError) || (error.status >= 500 && error.status !== 529)) {
          throw new Error("Could not confirm whether Notion created the page. Check the parent page before retrying.");
        }
        if (error.status === 403 || error.status === 404) {
          throw new Error(`${error.message} Check that the parent page is shared with a connection that can insert content.`);
        }
        throw error;
      }
    },
  };
}
