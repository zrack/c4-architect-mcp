cat << 'EOF' > src/index.ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { analyzeDirectory } from "./parsers/astParser.js";

const server = new McpServer({
  name: "c4-architect-mcp",
  version: "0.1.0",
});

// Tool 1: Analyze Architectural Boundaries (Tree-sitter AST -> JSON Graph)
server.tool(
  "analyze_architectural_boundaries",
  "Scans a target directory using local Tree-sitter AST parsing to extract structural dependencies, module imports, and service boundaries without burning LLM tokens.",
  {
    targetDir: z.string().describe("Absolute or relative path to the directory or microservice to analyze"),
    c4Level: z.enum(["Context", "Container", "Component"]).describe("Target C4 abstraction level"),
  },
  async ({ targetDir, c4Level }) => {
    const resolvedPath = path.resolve(targetDir);
    const astGraph = await analyzeDirectory(resolvedPath, c4Level);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(astGraph, null, 2),
        },
      ],
    };
  }
);

// Tool 2: Render C4 Mermaid Diagram (JSON Graph -> Validated C4 Mermaid)
server.tool(
  "render_c4_mermaid",
  "Validates architectural nodes and relationships against C4 rules and outputs a Mermaid.js C4 diagram.",
  {
    title: z.string().describe("Title of the C4 diagram"),
    c4Level: z.enum(["C4Context", "C4Container", "C4Component"]).describe("Mermaid C4 diagram header type"),
    nodes: z.array(
      z.object({
        id: z.string().describe("Alphanumeric ID without spaces"),
        label: z.string().describe("Display name of the node"),
        type: z.enum(["Person", "System", "System_Ext", "Container", "ContainerDb", "Component"]),
        technology: z.string().optional().describe("Technology stack (e.g., 'TypeScript, Express')"),
        description: z.string().optional().describe("Brief responsibility description"),
      })
    ),
    relationships: z.array(
      z.object({
        from: z.string().describe("Source node ID"),
        to: z.string().describe("Target node ID"),
        label: z.string().describe("Action or relationship description"),
        technology: z.string().optional().describe("Protocol or transport (e.g., 'JSON/HTTPS', 'gRPC')"),
      })
    ),
    outputPath: z.string().optional().describe("Optional file path to save the generated architecture.md"),
  },
  async ({ title, c4Level, nodes, relationships, outputPath }) => {
    const lines: string[] = [
      "```mermaid",
      c4Level,
      `  title ${title}`,
      ""
    ];

    for (const n of nodes) {
      const tech = n.technology ? `, "${n.technology}"` : "";
      const desc = n.description ? `, "${n.description}"` : "";
      lines.push(`  ${n.type}(${n.id}, "${n.label}"${tech}${desc})`);
    }

    lines.push("");

    for (const r of relationships) {
      const tech = r.technology ? `, "${r.technology}"` : "";
      lines.push(`  Rel(${r.from}, ${r.to}, "${r.label}"${tech})`);
    }

    lines.push("```");
    const mermaidOutput = lines.join("\n");

    if (outputPath) {
      const fullOutputPath = path.resolve(outputPath);
      await fs.writeFile(fullOutputPath, `# ${title}\n\n${mermaidOutput}\n`, "utf-8");
    }

    return {
      content: [
        {
          type: "text",
          text: mermaidOutput,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("C4-Architect MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
EOF