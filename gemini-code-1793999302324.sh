cat << 'EOF' > src/parsers/astParser.ts
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import fs from "fs/promises";
import path from "path";

export interface C4Node {
  id: string;
  label: string;
  type: "System" | "ExternalSystem" | "Container" | "ContainerDb" | "Component";
  technology: string;
  path: string;
  exports?: string[];
}

export interface C4Edge {
  source: string;
  target: string;
  label: string;
  protocol: string;
}

export interface AstGraph {
  metadata: {
    scannedDirectory: string;
    abstractionLevel: string;
    filesScanned: number;
    timestamp: string;
  };
  nodes: C4Node[];
  edges: C4Edge[];
}

const DB_PACKAGES: Record<string, string> = {
  "@prisma/client": "Prisma ORM / SQL DB",
  prisma: "Prisma ORM",
  pg: "PostgreSQL",
  mysql2: "MySQL",
  mongoose: "MongoDB",
  mongodb: "MongoDB",
  redis: "Redis Cache",
  ioredis: "Redis Cache",
  typeorm: "TypeORM / SQL DB",
  "drizzle-orm": "Drizzle ORM / SQL DB",
  sqlite3: "SQLite",
  "better-sqlite3": "SQLite",
};

const EXTERNAL_SYSTEM_PACKAGES: Record<string, { label: string; tech: string; protocol: string }> = {
  axios: { label: "External REST API", tech: "HTTP/REST", protocol: "HTTPS/JSON" },
  "node-fetch": { label: "External HTTP Endpoint", tech: "Fetch API", protocol: "HTTPS" },
  stripe: { label: "Stripe Payment Gateway", tech: "Stripe SDK", protocol: "HTTPS/REST" },
  openai: { label: "OpenAI LLM API", tech: "OpenAI SDK", protocol: "HTTPS/JSON" },
  "@anthropic-ai/sdk": { label: "Anthropic Claude API", tech: "Anthropic SDK", protocol: "HTTPS/JSON" },
  "@aws-sdk": { label: "AWS Cloud Services", tech: "AWS SDK", protocol: "HTTPS" },
  "@grpc/grpc-js": { label: "Remote gRPC Service", tech: "gRPC", protocol: "HTTP/2 / Protobuf" },
  ws: { label: "WebSocket Stream", tech: "WebSockets", protocol: "WSS" },
  "@modelcontextprotocol/sdk": { label: "MCP Host Client", tech: "Model Context Protocol", protocol: "JSON-RPC / stdio" },
};

const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage"]);

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

async function getTypeScriptFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await getTypeScriptFiles(fullPath)));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractFileFacts(sourceCode: string, isTsx: boolean): { imports: string[]; exports: string[] } {
  const parser = new Parser();
  parser.setLanguage((isTsx ? TypeScript.tsx : TypeScript.typescript) as any);

  const tree = parser.parse(sourceCode);
  const imports: string[] = [];
  const exports: string[] = [];

  function walk(node: Parser.SyntaxNode) {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        imports.push(sourceNode.text.replace(/['"]/g, ""));
      }
    } else if (node.type === "export_statement") {
      const decl = node.childForFieldName("declaration");
      if (decl) {
        const nameNode = decl.childForFieldName("name");
        if (nameNode) {
          exports.push(`${decl.type.replace("_declaration", "")}:${nameNode.text}`);
        }
      }
    }
    for (const child of node.namedChildren) {
      walk(child);
    }
  }

  walk(tree.rootNode);
  return { imports, exports };
}

export async function analyzeDirectory(
  targetDir: string,
  c4Level: "Context" | "Container" | "Component"
): Promise<AstGraph> {
  const files = await getTypeScriptFiles(targetDir);
  const nodesMap = new Map<string, C4Node>();
  const edgesMap = new Map<string, C4Edge>();

  for (const filePath of files) {
    const relPath = path.relative(targetDir, filePath).replace(/\\/g, "/");
    const sourceCode = await fs.readFile(filePath, "utf-8");
    const isTsx = filePath.endsWith(".tsx");
    const { imports, exports } = extractFileFacts(sourceCode, isTsx);

    // Determine source node based on C4 abstraction level
    const parsedPath = path.parse(relPath);
    const parts = relPath.split("/");
    let sourceId: string;
    let sourceLabel: string;
    let nodeType: C4Node["type"];

    if (c4Level === "Context") {
      sourceId = sanitizeId(path.basename(targetDir) || "CoreSystem");
      sourceLabel = path.basename(targetDir) || "Core System";
      nodeType = "System";
    } else if (c4Level === "Container") {
      const groupName = parts.length > 1 ? parts[0] : "app";
      sourceId = sanitizeId(`Container_${groupName}`);
      sourceLabel = `${groupName} module`;
      nodeType = "Container";
    } else {
      const withoutExt = path.join(parsedPath.dir, parsedPath.name).replace(/\\/g, "/");
      sourceId = sanitizeId(withoutExt);
      sourceLabel = withoutExt;
      nodeType = "Component";
    }

    if (!nodesMap.has(sourceId)) {
      nodesMap.set(sourceId, {
        id: sourceId,
        label: sourceLabel,
        type: nodeType,
        technology: isTsx ? "React / TypeScript" : "TypeScript / Node.js",
        path: c4Level === "Component" ? relPath : parts[0] || ".",
        exports: [],
      });
    }

    const currentNode = nodesMap.get(sourceId)!;
    if (exports.length > 0 && currentNode.exports) {
      currentNode.exports.push(...exports);
    }

    for (const imp of imports) {
      // 1. Check for Database / ORM Imports
      const dbMatch = Object.keys(DB_PACKAGES).find((pkg) => imp === pkg || imp.startsWith(`${pkg}/`));
      if (dbMatch) {
        const dbId = sanitizeId(`DB_${dbMatch}`);
        if (!nodesMap.has(dbId)) {
          nodesMap.set(dbId, {
            id: dbId,
            label: `${ dbMatch } Database`,
            type: "ContainerDb",
            technology: DB_PACKAGES[dbMatch],
            path: `package:${dbMatch}`,
          });
        }
        const edgeKey = `${sourceId}->${dbId}`;
        if (!edgesMap.has(edgeKey)) {
          edgesMap.set(edgeKey, {
            source: sourceId,
            target: dbId,
            label: "Reads/Writes data",
            protocol: DB_PACKAGES[dbMatch],
          });
        }
        continue;
      }

      // 2. Check for External System / Protocol SDK Imports
      const extMatch = Object.keys(EXTERNAL_SYSTEM_PACKAGES).find(
        (pkg) => imp === pkg || imp.startsWith(`${pkg}/`)
      );
      if (extMatch) {
        const extInfo = EXTERNAL_SYSTEM_PACKAGES[extMatch];
        const extId = sanitizeId(`Ext_${extMatch}`);
        if (!nodesMap.has(extId)) {
          nodesMap.set(extId, {
            id: extId,
            label: extInfo.label,
            type: "ExternalSystem",
            technology: extInfo.tech,
            path: `package:${extMatch}`,
          });
        }
        const edgeKey = `${sourceId}->${extId}`;
        if (!edgesMap.has(edgeKey)) {
          edgesMap.set(edgeKey, {
            source: sourceId,
            target: extId,
            label: `Communicates via ${extMatch}`,
            protocol: extInfo.protocol,
          });
        }
        continue;
      }

      // 3. Check for Internal Relative Module Imports
      if (imp.startsWith(".")) {
        if (c4Level === "Context") continue; // Internal edges omitted at System Context level

        const resolvedImp = path.resolve(path.dirname(filePath), imp);
        const relImp = path
          .relative(targetDir, resolvedImp)
          .replace(/\\/g, "/")
          .replace(/\.(js|ts|tsx)$/, "");

        let targetId: string;
        if (c4Level === "Container") {
          const targetParts = relImp.split("/");
          const targetGroup = targetParts.length > 1 ? targetParts[0] : "app";
          targetId = sanitizeId(`Container_${targetGroup}`);
        } else {
          targetId = sanitizeId(relImp);
        }

        if (sourceId !== targetId) {
          const edgeKey = `${sourceId}->${targetId}`;
          if (!edgesMap.has(edgeKey)) {
            edgesMap.set(edgeKey, {
              source: sourceId,
              target: targetId,
              label: "Imports / Invokes",
              protocol: "Internal TS Module",
            });
          }
        }
      }
    }
  }

  return {
    metadata: {
      scannedDirectory: targetDir,
      abstractionLevel: c4Level,
      filesScanned: files.length,
      timestamp: new Date().toISOString(),
    },
    nodes: Array.from(nodesMap.values()),
    edges: Array.from(edgesMap.values()),
  };
}
EOF