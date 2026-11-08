import { z } from "zod";

export const c4LevelSchema = z.enum([
  "C4Context", "C4Container", "C4Component", "C4Deployment", "C4Dynamic", "C4Landscape", "C4Code",
]);

const c4NodeTypeSchema = z.enum([
  "Person", "System", "System_Ext", "ExternalSystem", "Container", "ContainerDb", "Component",
  "DeploymentNode", "CodeElement", "Class", "Interface", "Function", "Type",
]);

export const diagramNodeSchema = z.object({
  id: z.string().refine(value => Boolean(value.trim()), "Node ID must not be empty."),
  label: z.string(),
  type: c4NodeTypeSchema,
  technology: z.string().optional(),
  description: z.string().optional(),
  parentId: z.string().optional().describe("ID of the enclosing DeploymentNode in a C4Deployment diagram"),
});

export const diagramRelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
  technology: z.string().optional(),
  description: z.string().optional(),
});

export const diagramSchema = z.object({
  title: z.string().refine(value => Boolean(value.trim()), "Diagram title must not be empty."),
  caption: z.string().optional(),
  c4Level: c4LevelSchema,
  nodes: z.array(diagramNodeSchema).min(1, "Diagram must contain at least one node."),
  relationships: z.array(diagramRelationshipSchema).describe("Relationships in display order, which is the step order for C4Dynamic"),
}).superRefine((diagram, context) => {
  const nodes = new Map<string, DiagramNode>();
  diagram.nodes.forEach((node, index) => {
    if (nodes.has(node.id)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: `Duplicate node ID: ${node.id}` });
    }
    nodes.set(node.id, node);
  });

  const parents = new Map<string, string>();
  const populated = new Set<string>();
  diagram.nodes.forEach((node, index) => {
    if (node.parentId === undefined) return;
    const issuePath = ["nodes", index, "parentId"];
    const parent = nodes.get(node.parentId);
    if (diagram.c4Level !== "C4Deployment") {
      context.addIssue({ code: "custom", path: issuePath, message: "parentId is only allowed in C4Deployment." });
    } else if (!parent) {
      context.addIssue({ code: "custom", path: issuePath, message: `Unknown parent ID: ${node.parentId}` });
    } else if (parent.type !== "DeploymentNode") {
      context.addIssue({ code: "custom", path: issuePath, message: `Parent ${parent.id} must be a DeploymentNode.` });
    } else {
      parents.set(node.id, parent.id);
      populated.add(parent.id);
    }
  });

  const visited = new Set<string>();
  diagram.nodes.forEach((node, index) => {
    const chain = new Set<string>();
    let id: string | undefined = node.id;
    while (id !== undefined && !visited.has(id)) {
      if (chain.has(id)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "parentId"], message: `Deployment parent cycle at node ${id}.` });
        break;
      }
      chain.add(id);
      id = parents.get(id);
    }
    for (const ancestor of chain) visited.add(ancestor);
  });

  diagram.relationships.forEach((relationship, index) => {
    for (const endpoint of ["from", "to"] as const) {
      const id = relationship[endpoint];
      const issuePath = ["relationships", index, endpoint];
      if (!nodes.has(id)) {
        context.addIssue({ code: "custom", path: issuePath, message: `Relationship references unknown node ID: ${id}` });
      } else if (populated.has(id)) {
        context.addIssue({ code: "custom", path: issuePath, message: `Relationship references populated deployment node ${id}. Connect to an instance or an empty deployment node.` });
      }
    }
  });
});

export type C4Level = z.infer<typeof c4LevelSchema>;
export type C4NodeType = z.infer<typeof c4NodeTypeSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramRelationship = z.infer<typeof diagramRelationshipSchema>;
export type C4Diagram = z.infer<typeof diagramSchema>;

export function diagramRelationshipLabel(c4Level: C4Level, relationship: DiagramRelationship, index: number): string {
  return c4Level === "C4Dynamic" ? `${index + 1}. ${relationship.label}` : relationship.label;
}
