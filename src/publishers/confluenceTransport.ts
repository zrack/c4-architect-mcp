import { z } from "zod";

const id = z.string().regex(/^[1-9]\d{0,19}$/, "Use a numeric Confluence ID");
const site = z.string().trim()
  .regex(/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net\/?$/i, "Use an HTTPS Atlassian Cloud site origin")
  .transform(value => new URL(value).origin);

export const confluenceTargetSchema = z.object({
  site,
  spaceId: id,
  parentId: id.optional(),
  pageId: id.optional(),
  cloudId: z.uuid().optional(),
}).refine(target => !(target.pageId && target.parentId), "A parent ID applies only when creating a page");

export type ConfluenceTarget = z.infer<typeof confluenceTargetSchema>;
const pageSchema = z.object({
  id,
  status: z.literal("current"),
  title: z.string(),
  spaceId: id,
  version: z.object({ number: z.number().int().positive(), message: z.string().nullish() }),
  body: z.object({ storage: z.object({ value: z.string().optional() }).optional() }).optional(),
});
const pageListSchema = z.object({ results: z.array(z.object({ id, title: z.string() })) });
const attachmentListSchema = z.object({
  results: z.array(z.object({ title: z.string(), fileSize: z.number(), mediaType: z.string() })),
});
const uploadSchema = z.object({ results: z.array(z.object({ title: z.string() })) });
type Page = z.infer<typeof pageSchema>;
type Attachment = { name: string; data: Buffer };

class ConfluenceHttpError extends Error {
  constructor(operation: string, readonly status: number) {
    super(`Confluence could not ${operation} (HTTP ${status}).`);
  }
}

export async function createConfluenceClient(target: ConfluenceTarget, {
  env = process.env,
  fetch: request = globalThis.fetch,
}: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
  const email = env.CONFLUENCE_EMAIL?.trim();
  const token = env.CONFLUENCE_API_TOKEN?.trim();
  if (!email || !token || /[:\s]/.test(email)) {
    throw new Error("Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN in the environment to publish.");
  }
  const authorization = "Basic " + Buffer.from(email + ":" + token, "utf8").toString("base64");
  const apiBase = target.cloudId ? `https://api.atlassian.com/ex/confluence/${target.cloudId}` : target.site;
  const pages = "/wiki/api/v2/pages";

  async function requestJson<T>(url: string, operation: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    let response: Response;
    try {
      response = await request(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error(`Confluence could not ${operation}. Check the connection and site settings.`);
    }
    if (!response.ok) throw new ConfluenceHttpError(operation, response.status);
    try {
      return schema.parse(await response.json());
    } catch {
      throw new Error(`Confluence returned an unexpected response while trying to ${operation}.`);
    }
  }

  if (target.cloudId) {
    const tenant = await requestJson(target.site + "/_edge/tenant_info", "verify the Cloud site", z.object({ cloudId: z.uuid() }));
    if (tenant.cloudId.toLowerCase() !== target.cloudId.toLowerCase()) {
      throw new Error("The Confluence Cloud ID does not match the specified site.");
    }
  }

  function send<T>(endpoint: string, operation: string, schema: z.ZodType<T>, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", authorization);
    return requestJson(apiBase + endpoint, operation, schema, { ...init, headers });
  }

  const storageBody = (value: string) => ({ representation: "storage", value });
  const json = (method: "POST" | "PUT", payload: object): RequestInit => ({
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });

  function assertSpace(page: Page) {
    if (page.spaceId !== target.spaceId) throw new Error("The Confluence page is outside the specified space.");
    return page;
  }

  async function attachmentExists(pageId: string, asset: Attachment): Promise<boolean> {
    const query = new URLSearchParams({ filename: asset.name, status: "current" });
    const { results } = await send(`${pages}/${pageId}/attachments?${query}`, "check diagram attachments", attachmentListSchema);
    const existing = results.find(item => item.title === asset.name);
    if (!existing) return false;
    if (existing.mediaType !== "image/png" || existing.fileSize !== asset.data.length) {
      throw new Error(`A Confluence attachment named ${asset.name} has unexpected metadata.`);
    }
    return true;
  }

  return {
    pageUrl: (pageId: string) => `${target.site}/wiki/pages/viewpage.action?pageId=${pageId}`,
    async createPage(title: string, placeholder: string) {
      const query = new URLSearchParams({ "space-id": target.spaceId, title, status: "current" });
      const { results } = await send(`${pages}?${query}`, "check for an existing page", pageListSchema);
      const existing = results.find(page => page.title === title);
      if (existing) {
        throw new Error(`Confluence page ${existing.id} already has this title in the space. Use a new title or specify that page ID if C4 Architect created it.`);
      }
      const page = await send(pages, "create the diagram page", pageSchema, json("POST", {
        spaceId: target.spaceId,
        ...(target.parentId ? { parentId: target.parentId } : {}),
        status: "current",
        title,
        body: storageBody(placeholder),
      }));
      return assertSpace(page);
    },
    async getPage(pageId: string) {
      const page = await send(`${pages}/${pageId}?body-format=storage`, "read the target page", pageSchema);
      if (page.id !== pageId) throw new Error("Confluence returned a different page ID than requested.");
      return assertSpace(page);
    },
    async ensureAttachment(pageId: string, asset: Attachment): Promise<boolean> {
      if (await attachmentExists(pageId, asset)) return false;
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(asset.data)], { type: "image/png" }), asset.name);
      form.append("minorEdit", "true");
      try {
        const { results } = await send(`/wiki/rest/api/content/${pageId}/child/attachment`, "upload a diagram attachment", uploadSchema, {
          method: "POST", headers: { "X-Atlassian-Token": "nocheck" }, body: form,
        });
        if (!results.some(item => item.title === asset.name)) throw new Error("Confluence did not confirm the uploaded diagram filename.");
        return true;
      } catch (error) {
        // A concurrent publish may have created the same content-addressed PNG.
        if (error instanceof ConfluenceHttpError && [400, 409].includes(error.status) && await attachmentExists(pageId, asset)) return false;
        throw error;
      }
    },
    async updatePage(page: Page, title: string, body: string, message: string) {
      const number = page.version.number + 1;
      try {
        const saved = await send(`${pages}/${page.id}`, "update the diagram page", pageSchema, json("PUT", {
          id: page.id, status: "current", title, body: storageBody(body), version: { number, message },
        }));
        if (saved.id !== page.id || saved.version.number !== number || saved.version.message !== message) {
          throw new Error("Confluence did not confirm the saved page version.");
        }
        return assertSpace(saved);
      } catch (error) {
        if (error instanceof ConfluenceHttpError && error.status === 409) {
          throw new Error("The Confluence page changed during publishing (HTTP 409). Check the current page before retrying.");
        }
        throw error;
      }
    },
  };
}
