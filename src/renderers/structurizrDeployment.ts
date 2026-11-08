import type { C4Diagram, DiagramNode, DiagramRelationship } from "../model/diagram.js";
import { dslString } from "./structurizrStrings.js";

interface LogicalRelationship {
  tag: string;
  technology?: string;
}

interface DeploymentOptions {
  environment: string;
  systemAlias: string;
  instanceAlias: ReadonlyMap<string, string>;
  instanceContainerSystemAlias?: ReadonlyMap<string, string>;
  staticRelationships: ReadonlyMap<string, LogicalRelationship>;
}

function describeRelationship(line: string, relationship: DiagramRelationship, indent: string): string[] {
  if (!relationship.description?.trim()) return [line];
  return [
    line + " {",
    indent + "    properties {",
    indent + '        "C4 description" ' + dslString(relationship.description),
    indent + "    }",
    indent + "}",
  ];
}

function instanceKeyword(node: DiagramNode): string {
  switch (node.type) {
    case "Container":
    case "ContainerDb": return "containerInstance";
    case "System":
    case "System_Ext":
    case "ExternalSystem": return "softwareSystemInstance";
    default: throw new Error(`Structurizr deployment cannot represent ${node.type} node "${node.id}".`);
  }
}

export function renderStructurizrDeployment(diagram: C4Diagram, options: DeploymentOptions) {
  const aliases = new Map(diagram.nodes.map((node, index) => [node.id, `deploymentNode${index + 1}`]));
  const logical = new Map([...options.staticRelationships].map(([key, link]) => {
    const [from, to, label] = JSON.parse(key) as [string, string, string];
    return [JSON.stringify([from, to, dslString(label)]), link] as const;
  }));
  const systemInstances = new Set(diagram.nodes
    .filter(node => node.type === "System" || node.type === "System_Ext" || node.type === "ExternalSystem")
    .map(node => options.instanceAlias.get(node.id)));
  for (const system of options.instanceContainerSystemAlias?.values() ?? []) {
    if (systemInstances.has(system)) {
      throw new Error("Structurizr cannot show a system instance and an instance of its container in the same deployment view.");
    }
  }
  const populatedHosts = new Set(diagram.nodes.map(node => node.parentId));
  const additions: string[] = [], logicalTags: string[] = [];
  const groups: string[] = [];
  const memberships = new Map([...options.instanceAlias.keys()].map(id => [id, [] as string[]]));
  const pairs = new Set<string>(), seenEdges = new Set<string>();
  const directRelationships: string[] = [], selections: string[] = [];

  const group = (name: string) => {
    const alias = `deploymentGroup${groups.length + 1}`;
    groups.push(`            ${alias} = deploymentGroup ${dslString(name)}`);
    return alias;
  };

  for (const relationship of diagram.relationships) {
    const { from, to, label, technology } = relationship;
    const source = aliases.get(from), target = aliases.get(to);
    const logicalSource = options.instanceAlias.get(from), logicalTarget = options.instanceAlias.get(to);
    const edgeKey = JSON.stringify([from, to, dslString(label)]);
    if (seenEdges.has(edgeKey)) {
      throw new Error(`Structurizr requires distinct relationship labels between "${from}" and "${to}": "${label}".`);
    }
    seenEdges.add(edgeKey);

    if (logicalSource !== undefined && logicalTarget !== undefined) {
      if (from === to) throw new Error(`Structurizr cannot create a deployment relationship from an instance to itself: "${from}".`);
      // A group belongs to an unordered pair of physical instances. This avoids
      // replicating relationships between unrelated instances of the same service.
      const pair = JSON.stringify([from, to].sort());
      if (!pairs.has(pair)) {
        pairs.add(pair);
        const pairGroup = group(`Physical link ${pairs.size}`);
        memberships.get(from)!.push(pairGroup);
        memberships.get(to)!.push(pairGroup);
      }
      const logicalKey = JSON.stringify([logicalSource, logicalTarget, dslString(label)]);
      let link = logical.get(logicalKey);
      if (link && (link.technology ?? "") !== (technology ?? "")) {
        throw new Error(`Structurizr cannot use different technologies for the same logical relationship "${label}" from "${from}" to "${to}".`);
      }
      if (!link) {
        const tag = `C4DeploymentR${logicalTags.length + 1}`;
        link = { tag, technology };
        logicalTags.push(tag);
        logical.set(logicalKey, link);
        const line = `        ${logicalSource} -> ${logicalTarget} ${dslString(label)} ${dslString(technology)} ${dslString(tag)}`;
        additions.push(...describeRelationship(line, relationship, "        "));
      }
      // Replication can bring in other labels between the same pair. Select
      // by instance endpoints and inherited relationship tag together.
      selections.push(`            include ${dslString(`relationship==${source}->${target} && relationship.tag==${link.tag}`)}`);
    } else {
      const alias = `deploymentRelationship${selections.length + 1}`;
      const line = `            ${alias} = ${source} -> ${target} ${dslString(label)} ${dslString(technology)}`;
      directRelationships.push(...describeRelationship(line, relationship, "            "));
      selections.push(`            include ${alias}`);
    }
  }
  for (const [id, memberGroups] of memberships) {
    if (memberGroups.length === 0) memberGroups.push(group(`Isolated instance ${aliases.get(id)}`));
  }

  const childNodes = new Map<string | undefined, DiagramNode[]>();
  const unhosted: DiagramNode[] = [];
  for (const node of diagram.nodes) {
    if (node.parentId === undefined && !populatedHosts.has(node.id)) {
      unhosted.push(node);
    } else {
      const siblings = childNodes.get(node.parentId) ?? [];
      siblings.push(node);
      childNodes.set(node.parentId, siblings);
    }
  }

  function renderNodes(nodes: DiagramNode[], indent: string, reservedName?: string): string[] {
    const names = new Set(reservedName ? [dslString(reservedName).toLowerCase()] : []);
    const lines: string[] = [];
    for (const node of nodes) {
      const alias = aliases.get(node.id);
      const target = options.instanceAlias.get(node.id);
      if (target !== undefined) {
        const instance = `${indent}${alias} = ${instanceKeyword(node)} ${target} ${memberships.get(node.id)!.join(",")}`;
        if (!node.description?.trim() && !node.technology?.trim()) {
          lines.push(instance);
          continue;
        }
        lines.push(instance + " {");
        if (node.description?.trim()) lines.push(`${indent}    description ${dslString(node.description)}`);
        if (node.technology?.trim()) {
          lines.push(
            indent + "    properties {",
            indent + '        "C4 technology" ' + dslString(node.technology),
            indent + "    }",
          );
        }
        lines.push(indent + "}");
      } else {
        if (node.type !== "DeploymentNode") throw new Error(`Missing Structurizr deployment instance mapping for "${node.id}".`);
        const base = node.label.trim() || node.id;
        let name = base;
        let sequence = 2;
        while (names.has(dslString(name).toLowerCase())) name = `${base} (${sequence++})`;
        names.add(dslString(name).toLowerCase());
        // Structurizr only draws deployment nodes containing something, so
        // standalone hardware is an infrastructure node in the native view.
        const keyword = populatedHosts.has(node.id) ? "deploymentNode" : "infrastructureNode";
        const declaration = `${indent}${alias} = ${keyword} ${dslString(name)} ${dslString(node.description)} ${dslString(node.technology)}`;
        const children = childNodes.get(node.id);
        if (children?.length) lines.push(declaration + " {", ...renderNodes(children, indent + "    "), indent + "}");
        else lines.push(declaration);
      }
    }
    return lines;
  }

  const unhostedName = "Unspecified host";
  const model = [
    `        deploymentEnvironmentView = deploymentEnvironment ${dslString(options.environment)} {`,
    ...groups,
    ...renderNodes(childNodes.get(undefined) ?? [], "            ", unhosted.length ? unhostedName : undefined),
    ...(unhosted.length ? [
      `            unassignedDeploymentHost = deploymentNode ${dslString(unhostedName)} {`,
      ...renderNodes(unhosted, "                "),
      "            }",
    ] : []),
    ...directRelationships,
    "        }",
  ];

  const view = [
    `        deployment ${options.systemAlias} deploymentEnvironmentView "PhysicalDeployment" ${dslString(diagram.caption)} {`,
    `            title ${dslString(diagram.title)}`,
    "            include *",
    "            exclude relationship==*",
    ...selections,
    "            autoLayout lr",
    "        }",
  ];
  return { model, view, logical: additions, logicalTags };
}
