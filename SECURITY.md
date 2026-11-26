# Security

## Scope

C4 Architect is a local `stdio` MCP server. It reads source files from the requested directory, analyzes them statically, and can write graph and diagram artifacts to requested paths. It does not execute the analyzed application's code. It is not a sandbox for untrusted clients or a vulnerability scanner.

Treat access to the server as access to the local files its process can read and write. Use the MCP client's permissions and the operating system's process permissions to limit that access. Tool results can include source paths, dependency names, and architecture details; the client's data-handling settings apply after those results are returned.

The parser runs locally without an LLM API call. Saved interactive HTML, SVG, and PNG assets are self-contained. These properties do not imply that an MCP host will keep tool responses on the machine.

## Publishing diagrams

The publishing tools write a local preview by default. When you supply a destination and set `publish: true` in MCP or pass `--publish` on the CLI, the publisher sends the generated page content and diagram PNGs to that destination. The CLI or MCP server reads credentials from its process environment.

| Destination | Content sent | Environment variables |
| --- | --- | --- |
| [Azure DevOps Wiki](README.md#publish-to-azure-devops-wiki) | Wiki page in Markdown and PNG attachments | Exactly one of `AZURE_DEVOPS_EXT_PAT` or `AZURE_DEVOPS_BEARER_TOKEN` |
| [Confluence Cloud](README.md#publish-to-confluence-cloud) | Page in Confluence storage format and PNG attachments | `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` |
| [Notion](README.md#publish-to-notion) | A new child page with text and uploaded diagram images | `NOTION_API_TOKEN` |

## Supported versions

Security fixes target the latest alpha code. Older alpha snapshots are not maintained separately. Rebuild and reconnect a local server after updating it.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/zrack/c4-architect-mcp/security/advisories/new) when it is enabled for this repository. If private reporting is unavailable, open an issue asking the maintainer for a private reporting channel **without including the vulnerability details, a working exploit, credentials, or private source**.

Include the affected revision, platform and Node.js version, a minimal reproduction, expected impact, and any relevant generated artifact. A sanitized local example is preferable to production data.

Do not test against another person's repository, client, or infrastructure without their authorization. The project has no paid bug-bounty program or guaranteed response time.

## Areas that matter

Security-sensitive changes include source traversal and module resolution, output-path handling, package installation behavior, graph input validation, escaping untrusted labels in Mermaid/XML/HTML, and standalone HTML export behavior. Changes that introduce network access, application-code execution, credentials, or publishing require an explicit design and documentation update.

Architecture classification and future threat-model features are analysis aids. They must not present inferred runtime connections or possible security concerns as verified vulnerabilities.
