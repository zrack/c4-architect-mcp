import { createHash } from "node:crypto";
import { z } from "zod";
import { diagramSchema, type C4Diagram, type C4NodeType, type DiagramNode, type DiagramRelationship } from "../model/diagram.js";
import { renderStructurizrDeployment } from "./structurizrDeployment.js";
import { dslString } from "./structurizrStrings.js";

const scopeOptions = {
  systemId: z.string().min(1).optional().describe("ID of the software system in scope"),
  componentContainerId: z.string().min(1).optional().describe("ID of the container that owns the components"),
  deploymentEnvironment: z.string().trim().min(1).optional(),
  deploymentInstanceOf: z.record(z.string().min(1), z.string().min(1)).optional()
    .describe("Map from deployment instance node IDs to existing logical element IDs"),
};

export const structurizrDiagramSchema = z.intersection(diagramSchema, z.object(scopeOptions));

export const structurizrWorkspaceSchema = z.strictObject({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  diagrams: z.array(diagramSchema).min(1).max(4),
  ...scopeOptions,
});

const viewKeys = {
  C4Context: "Context",
  C4Container: "Container",
  C4Component: "Component",
  C4Deployment: "PhysicalDeployment",
} as const;

type SupportedLevel = keyof typeof viewKeys;
type StaticLevel = Exclude<SupportedLevel, "C4Deployment">;
type LogicalType = "Person" | "System" | "System_Ext" | "Container" | "ContainerDb" | "Component";
type LogicalNode = Omit<DiagramNode, "type" | "parentId"> & { type: LogicalType; alias: string };
type LogicalRelationship = DiagramRelationship & { tag: string; displayLabel: string };

const allowedTypes: Record<StaticLevel, readonly LogicalType[]> = {
  C4Context: ["Person", "System", "System_Ext"],
  C4Container: ["Person", "System", "System_Ext", "Container", "ContainerDb"],
  C4Component: ["Person", "System", "System_Ext", "Container", "ContainerDb", "Component"],
};

const styles = [
  '        styles {',
  '            element "Person" {',
  '                shape Person',
  '                background #08427b',
  '                color #ffffff',
  '            }',
  '            element "Software System" {',
  '                background #1168bd',
  '                color #ffffff',
  '            }',
  '            element "Container" {',
  '                background #2d74a7',
  '                color #ffffff',
  '            }',
  '            element "Component" {',
  '                background #d9e9f6',
  '                color #17334a',
  '            }',
  '            element "External" {',
  '                background #596779',
  '                color #ffffff',
  '            }',
  '            element "Database" {',
  '                shape Cylinder',
  '            }',
  '            element "Infrastructure Node" {',
  '                background #596779',
  '                color #ffffff',
  '            }',
  '        }',
];

function logicalType(type: C4NodeType): C4NodeType {
  return type === "ExternalSystem" ? "System_Ext" : type;
}

function isContainer(type: C4NodeType): boolean {
  return type === "Container" || type === "ContainerDb";
}

function isSystem(type: C4NodeType): boolean {
  return type === "System" || type === "System_Ext" || type === "ExternalSystem";
}

function alias(id: string): string {
  const readable = id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return "c4_" + readable + "_" + createHash("sha256").update(id, "utf16le").digest("hex").slice(0, 12);
}

function scopeName(title: string): string {
  return title.replace(/\s*(?:[|:—–]|\s+-)\s*(?:context|container|component|(?:physical )?deployment)\s*$/i, "").trim()
    || "Architecture";
}

function addNode(nodes: Map<string, LogicalNode>, input: DiagramNode, type: LogicalType): LogicalNode {
  const label = input.label.trim();
  if (!label) throw new Error("Structurizr requires a label for node " + input.id);
  const current = nodes.get(input.id);
  if (current) {
    if (current.type !== type || current.label !== label) {
      throw new Error("Structurizr node ID " + input.id + " has conflicting labels or types across views");
    }
    if (current.technology && input.technology && current.technology !== input.technology) {
      throw new Error("Structurizr node ID " + input.id + " has conflicting technologies across views");
    }
    current.description ??= input.description;
    current.technology ??= input.technology;
    return current;
  }
  const node = { id: input.id, label, type, alias: alias(input.id), description: input.description, technology: input.technology };
  nodes.set(node.id, node);
  return node;
}

function addScope(nodes: Map<string, LogicalNode>, label: string, type: "System" | "Container"): LogicalNode {
  let id = "__structurizr_" + type.toLowerCase();
  while (nodes.has(id)) id += "_";
  const baseLabel = label;
  let suffix = 2;
  while ([...nodes.values()].some(node => dslString(node.label).toLowerCase() === dslString(label).toLowerCase())) {
    label = baseLabel + " (" + suffix++ + ")";
  }
  return addNode(nodes, { id, label, type }, type);
}

function findSystem(nodes: Map<string, LogicalNode>, systemId: string | undefined, title: string): LogicalNode {
  if (systemId !== undefined) {
    const system = nodes.get(systemId);
    if (!system || system.type !== "System") throw new Error("systemId must identify an internal System node: " + systemId);
    return system;
  }
  const systems = [...nodes.values()].filter(node => node.type === "System");
  if (systems.length > 1) throw new Error("Structurizr requires systemId when there is more than one internal System node");
  return systems[0] ?? addScope(nodes, scopeName(title), "System");
}

function findComponentContainer(nodes: Map<string, LogicalNode>, id: string | undefined, title: string): LogicalNode {
  if (id !== undefined) {
    const container = nodes.get(id);
    if (!container || container.type !== "Container") {
      throw new Error("componentContainerId must identify a Container node: " + id);
    }
    return container;
  }
  return addScope(nodes, scopeName(title) + " application", "Container");
}

function registerInstances(
  diagram: C4Diagram,
  mapping: Record<string, string> | undefined,
  nodes: Map<string, LogicalNode>,
): ReadonlyMap<string, string> {
  const instances = diagram.nodes.filter(node => isContainer(node.type) || isSystem(node.type));
  const ids = new Set(instances.map(node => node.id));
  for (const id of Object.keys(mapping ?? {})) {
    if (!ids.has(id)) throw new Error("deploymentInstanceOf contains an unknown instance node: " + id);
  }
  const aliases = new Map<string, string>();
  for (const instance of instances) {
    const targetId = mapping && Object.hasOwn(mapping, instance.id) ? mapping[instance.id] : undefined;
    const target = nodes.get(targetId ?? instance.id);
    if (target) {
      const compatible = isContainer(instance.type) ? isContainer(target.type) : isSystem(target.type);
      if (!compatible) {
        throw new Error("Deployment instance " + instance.id + " maps to an incompatible logical element: " + target.id);
      }
      if (targetId === undefined && target.label !== instance.label.trim()) {
        throw new Error("Deployment instance " + instance.id + " needs an explicit deploymentInstanceOf mapping");
      }
      aliases.set(instance.id, target.alias);
    } else if (targetId !== undefined) {
      throw new Error("Deployment instance " + instance.id + " maps to unknown logical element: " + targetId);
    } else {
      const type = logicalType(instance.type) as LogicalType;
      aliases.set(instance.id, addNode(nodes, instance, type).alias);
    }
  }
  return aliases;
}

function renderNodes(nodes: Map<string, LogicalNode>, system: LogicalNode, componentContainer?: LogicalNode): string[] {
  const children = new Map<LogicalNode | undefined, LogicalNode[]>();
  const names = new Map<LogicalNode | undefined, Set<string>>();
  for (const node of nodes.values()) {
    const parent = isContainer(node.type) ? system : node.type === "Component" ? componentContainer : undefined;
    const usedNames = names.get(parent) ?? new Set<string>();
    const name = dslString(node.label).toLowerCase();
    if (usedNames.has(name)) {
      throw new Error("Duplicate Structurizr element name " + node.label + (parent ? " within " + parent.label : ""));
    }
    usedNames.add(name);
    names.set(parent, usedNames);
    const siblings = children.get(parent);
    if (siblings) siblings.push(node);
    else children.set(parent, [node]);
  }

  function render(node: LogicalNode, indent: string): string[] {
    const keyword = node.type === "Person" ? "person" : isSystem(node.type) ? "softwareSystem"
      : isContainer(node.type) ? "container" : "component";
    const description = isSystem(node.type) || node.type === "Person"
      ? [node.description, node.technology].filter(Boolean).join(" · ") : node.description;
    const parameters = [dslString(node.label), dslString(description)];
    if (isContainer(node.type) || node.type === "Component") parameters.push(dslString(node.technology));
    if (node.type === "System_Ext") parameters.push(dslString("External"));
    if (node.type === "ContainerDb") parameters.push(dslString("Database"));
    const line = indent + node.alias + " = " + keyword + " " + parameters.join(" ");
    const nested = children.get(node);
    if (!nested) return [line];
    return [line + " {", ...nested.flatMap(child => render(child, indent + "    ")), indent + "}"];
  }

  return (children.get(undefined) ?? []).flatMap(node => render(node, "        "));
}

function staticView(
  diagram: C4Diagram,
  level: StaticLevel,
  nodes: Map<string, LogicalNode>,
  system: LogicalNode,
  componentContainer: LogicalNode | undefined,
  allRelationships: readonly LogicalRelationship[],
  viewRelationships: ReadonlySet<LogicalRelationship>,
  deploymentTags: readonly string[],
): string[] {
  const excludedScopes = level === "C4Context" ? [] : [system.id];
  if (level === "C4Component") excludedScopes.push(componentContainer!.id);
  const visible = new Set(diagram.nodes.map(node => node.id).filter(id => !excludedScopes.includes(id)));
  if (level === "C4Context") visible.add(system.id);
  if (!visible.size) throw new Error("Structurizr view " + viewKeys[level] + " has no visible elements");
  for (const relationship of viewRelationships) {
    if (!visible.has(relationship.from) || !visible.has(relationship.to)) {
      throw new Error("Structurizr view " + viewKeys[level] + " cannot show relationships to its own scope boundary");
    }
  }
  const keyword = level === "C4Context" ? "systemContext" : level === "C4Container" ? "container" : "component";
  const scope = level === "C4Component" ? componentContainer! : system;
  const extraTags = allRelationships
    .filter(rel => !viewRelationships.has(rel) && visible.has(rel.from) && visible.has(rel.to))
    .map(rel => rel.tag);
  return [
    "        " + keyword + " " + scope.alias + " " + viewKeys[level] + " " + dslString(diagram.caption) + " {",
    "            title " + dslString(diagram.title),
    "            include " + [...visible].map(id => nodes.get(id)!.alias).join(" "),
    ...[...extraTags, ...deploymentTags].map(tag => "            exclude relationship.tag==" + tag),
    "            autoLayout lr 170 130",
    "        }",
  ];
}

function relationshipKey(from: string, to: string, label: string): string {
  return JSON.stringify([from, to, label]);
}

export function renderStructurizrDsl(input: unknown): { dsl: string; viewKeys: string[] } {
  const workspace = typeof input === "object" && input !== null && "diagrams" in input
    ? structurizrWorkspaceSchema.parse(input)
    : (() => {
        const diagram = structurizrDiagramSchema.parse(input);
        return { ...diagram, description: diagram.caption, diagrams: [diagram] };
      })();
  const diagrams = new Map<SupportedLevel, C4Diagram>();
  for (const diagram of workspace.diagrams) {
    if (!Object.hasOwn(viewKeys, diagram.c4Level)) {
      throw new Error("Structurizr supports Context, Container, Component, and Deployment views. Unsupported level: " + diagram.c4Level);
    }
    const level = diagram.c4Level as SupportedLevel;
    if (diagrams.has(level)) throw new Error("Duplicate Structurizr view level: " + level);
    diagrams.set(level, diagram);
  }

  const nodes = new Map<string, LogicalNode>();
  const staticLevels = Object.keys(allowedTypes) as StaticLevel[];
  for (const level of staticLevels) {
    for (const node of diagrams.get(level)?.nodes ?? []) {
      const type = logicalType(node.type) as LogicalType;
      if (!allowedTypes[level].includes(type)) throw new Error(level + " cannot contain " + node.type + " node " + node.id + " in Structurizr");
      addNode(nodes, node, type);
    }
  }
  const deployment = diagrams.get("C4Deployment");
  if (!deployment && (workspace.deploymentEnvironment !== undefined || workspace.deploymentInstanceOf !== undefined)) {
    throw new Error("Structurizr deployment options require a C4Deployment view");
  }
  // Resolve deployment references against the authored model before adding synthetic scopes.
  const instanceAlias = deployment ? registerInstances(deployment, workspace.deploymentInstanceOf, nodes) : undefined;
  const system = findSystem(nodes, workspace.systemId, workspace.title);
  const componentView = diagrams.get("C4Component");
  if (!componentView && workspace.componentContainerId !== undefined) {
    throw new Error("componentContainerId requires a C4Component view");
  }
  const componentContainer = componentView
    ? findComponentContainer(nodes, workspace.componentContainerId, componentView.title) : undefined;

  const relationships = new Map<string, LogicalRelationship>();
  const labels = new Set<string>();
  const byView = new Map<StaticLevel, Set<LogicalRelationship>>();
  for (const level of staticLevels) {
    const viewRelationships = new Set<LogicalRelationship>();
    byView.set(level, viewRelationships);
    for (const relationship of diagrams.get(level)?.relationships ?? []) {
      const { from, to, technology, description } = relationship;
      const label = relationship.label.trim();
      const key = JSON.stringify([from, to, label, technology ?? ""]);
      let logical = relationships.get(key);
      if (!logical) {
        let displayLabel = label;
        let suffix = 2;
        while (labels.has(relationshipKey(from, to, dslString(displayLabel)))) {
          displayLabel = label + " (" + (technology && suffix === 2 ? technology : suffix) + ")";
          suffix++;
        }
        labels.add(relationshipKey(from, to, dslString(displayLabel)));
        logical = { ...relationship, tag: "C4R" + (relationships.size + 1), displayLabel };
        relationships.set(key, logical);
      } else if (description && !logical.description?.split("\n").includes(description)) {
        logical.description = [logical.description, description].filter(Boolean).join("\n");
      }
      viewRelationships.add(logical);
    }
  }

  const allRelationships = [...relationships.values()];
  const staticRelationships = new Map(allRelationships.map(rel => [
    relationshipKey(nodes.get(rel.from)!.alias, nodes.get(rel.to)!.alias, rel.displayLabel),
    { tag: rel.tag, technology: rel.technology },
  ]));
  const physical = deployment ? renderStructurizrDeployment(deployment, {
    environment: workspace.deploymentEnvironment ?? "Physical",
    systemAlias: deployment.nodes.some(node => isSystem(node.type)) ? "*" : system.alias,
    instanceAlias: instanceAlias!,
    instanceContainerSystemAlias: new Map(deployment.nodes
      .filter(node => isContainer(node.type))
      .map(node => [node.id, system.alias])),
    staticRelationships,
  }) : undefined;
  const relationshipLines = allRelationships.flatMap(rel => {
    const line = "        " + nodes.get(rel.from)!.alias + " -> " + nodes.get(rel.to)!.alias
      + " " + [rel.displayLabel, rel.technology, rel.tag].map(dslString).join(" ");
    return rel.description
      ? [line + " {", "            properties {", '                "c4.description" ' + dslString(rel.description),
          "            }", "        }"]
      : [line];
  });
  const viewLines = staticLevels.flatMap(level => {
    const diagram = diagrams.get(level);
    return diagram
      ? staticView(diagram, level, nodes, system, componentContainer, allRelationships, byView.get(level)!, physical?.logicalTags ?? [])
      : [];
  });

  return {
    dsl: [
      "workspace " + dslString(workspace.title) + " " + dslString(workspace.description) + " {",
      "    !impliedRelationships false",
      "    model {",
      ...renderNodes(nodes, system, componentContainer),
      ...relationshipLines,
      ...(physical?.logical ?? []),
      ...(physical?.model ?? []),
      "    }",
      "    views {",
      ...viewLines,
      ...(physical?.view ?? []),
      ...styles,
      "    }",
      "}",
      "",
    ].join("\n"),
    viewKeys: (Object.keys(viewKeys) as SupportedLevel[]).filter(level => diagrams.has(level)).map(level => viewKeys[level]),
  };
}
