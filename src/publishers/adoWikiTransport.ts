import { z } from "zod";

const targetSegment = z.string().trim().min(1).max(256).refine(
  value => value !== "." && value !== ".." && !/[\/\\\p{Cc}\p{Cs}]/u.test(value),
  "Use a name or ID, not a URL or path.",
);

export const adoWikiTargetSchema = z.strictObject({
  organization: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,49}$/i, "Use an Azure DevOps organization name."),
  project: targetSegment,
  wiki: targetSegment,
  pagePath: z.string().trim().max(235).refine(
    value => value.startsWith("/") && value.slice(1).split("/").every(segment =>
      segment.trim().length > 0 && !segment.startsWith(".") && !segment.endsWith(".") && !/[\\#\p{Cc}\p{Cs}]/u.test(segment)),
    "Use an absolute wiki page path such as /Architecture/Trail Notes.",
  ),
});

export type AdoWikiTarget = z.infer<typeof adoWikiTargetSchema>;

interface ClientOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const origin = "https://dev.azure.com";
const apiVersion = "7.1";
const strongEtag = /^"[^"\x00-\x20\x7f]+"$/;

function authorizationFrom(env: NodeJS.ProcessEnv): string {
  const pat = env.AZURE_DEVOPS_EXT_PAT?.trim();
  const bearer = env.AZURE_DEVOPS_BEARER_TOKEN?.trim();
  if (Boolean(pat) === Boolean(bearer)) {
    throw new Error("Set exactly one of AZURE_DEVOPS_EXT_PAT or AZURE_DEVOPS_BEARER_TOKEN before publishing.");
  }
  const token = pat || bearer!;
  if (/\s|\p{Cc}/u.test(token)) throw new Error("The Azure DevOps credential contains invalid whitespace or control characters.");
  return pat ? "Basic " + Buffer.from(":" + pat, "utf8").toString("base64") : "Bearer " + bearer;
}

function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function requireStatus(response: Response, status: number, operation: string): void {
  if (response.status === status) return;
  discard(response);
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Azure DevOps redirected the " + operation + " request. Redirects are disabled (HTTP " + response.status + ").");
  }
  if (response.status === 401 || response.status === 403 || response.status === 203) {
    throw new Error("Azure DevOps denied the " + operation + " request. Check the credential and wiki permissions (HTTP " + response.status + ").");
  }
  if ((response.status === 409 || response.status === 412) && (operation === "create page" || operation === "edit page")) {
    throw new Error("The Azure DevOps wiki page changed while publishing. Review the current page before retrying (HTTP " + response.status + ").");
  }
  throw new Error("Azure DevOps could not " + operation + " (HTTP " + response.status + ").");
}

async function readJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Provider error pages and arbitrary response bodies are never exposed.
  }
  throw new Error("Azure DevOps returned an invalid " + operation + " response.");
}

export function createAdoWikiClient(input: AdoWikiTarget, options: ClientOptions = {}) {
  const target = adoWikiTargetSchema.parse(input);
  const authorization = authorizationFrom(options.env ?? process.env);
  const requestFetch = options.fetch ?? globalThis.fetch;
  const root = origin + "/" + [target.organization, target.project].map(encodeURIComponent).join("/");
  const apiRoot = root + "/_apis/wiki/wikis/" + encodeURIComponent(target.wiki);
  const pageUrl = new URL(root + "/_wiki/wikis/" + encodeURIComponent(target.wiki));
  pageUrl.searchParams.set("pagePath", target.pagePath);

  function apiUrl(resource: "pages" | "attachments", params: Record<string, string>): URL {
    const url = new URL(apiRoot + "/" + resource);
    url.search = new URLSearchParams({ ...params, "api-version": apiVersion }).toString();
    return url;
  }

  async function request(url: URL, operation: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", authorization);
    headers.set("Accept", "application/json");
    headers.set("X-TFS-FedAuthRedirect", "Suppress");
    try {
      return await requestFetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error("The Azure DevOps " + operation + " request failed or timed out. Check the connection before retrying.");
    }
  }

  return {
    async getPage(): Promise<{ content: string; etag: string } | null> {
      const url = apiUrl("pages", { path: target.pagePath, includeContent: "true" });
      const response = await request(url, "read page", { method: "GET" });
      if (response.status === 404) {
        discard(response);
        return null;
      }
      requireStatus(response, 200, "read page");
      const etag = response.headers.get("etag");
      if (etag === null || !strongEtag.test(etag)) {
        discard(response);
        throw new Error("Azure DevOps did not provide a valid page version for a conditional update.");
      }
      const body = await readJson(response, "page");
      if (typeof body.content !== "string") throw new Error("Azure DevOps did not include the wiki page content.");
      return { content: body.content, etag };
    },

    async putAttachment(name: string, bytes: Uint8Array): Promise<{ path: string }> {
      if (!/^[a-z0-9](?:[a-z0-9._-]{0,198}[a-z0-9])?$/i.test(name)) throw new Error("Invalid Azure DevOps wiki attachment name.");
      if (bytes.byteLength === 0 || bytes.byteLength > 19_000_000) {
        throw new Error("Azure DevOps wiki attachments must be nonempty and at most 19 MB.");
      }
      const url = apiUrl("attachments", { name });
      const response = await request(url, "upload attachment", {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(bytes),
      });
      requireStatus(response, 201, "upload attachment");
      const attachment = await readJson(response, "attachment");
      const path = "/.attachments/" + name;
      if (attachment.path !== path) {
        throw new Error("Azure DevOps returned an unexpected attachment path. The wiki page has not been written.");
      }
      return { path };
    },

    async putPage(content: string, etag?: string): Promise<{ url: string; etag?: string }> {
      const editing = etag !== undefined;
      if (editing && !strongEtag.test(etag)) throw new Error("A valid Azure DevOps page version is required for edits.");
      const operation = editing ? "edit page" : "create page";
      const headers = new Headers({ "Content-Type": "application/json" });
      if (editing) headers.set("If-Match", etag);
      const response = await request(apiUrl("pages", { path: target.pagePath }), operation, {
        method: "PUT", headers, body: JSON.stringify({ content }),
      });
      requireStatus(response, editing ? 200 : 201, operation);
      const version = response.headers.get("etag");
      discard(response);
      return {
        url: pageUrl.href,
        ...(version && strongEtag.test(version) ? { etag: version } : {}),
      };
    },
  };
}
