import { z } from "zod";
import type { ArchitectureEdge, ArchitectureGraph } from "./graph.js";

export const graphFocusSchema = z.object({
  nodeId: z.string().min(1),
  direction: z.enum(["incoming", "outgoing", "both"]).default("both"),
  maxDepth: z.number().int().min(0).max(5).default(1),
  maxNodes: z.number().int().min(1).max(100).default(25),
  maxEdges: z.number().int().min(0).max(200).default(50),
});

export type GraphFocus = z.input<typeof graphFocusSchema>;

export function selectGraphNeighborhood(graph: ArchitectureGraph, input: GraphFocus) {
  const options = graphFocusSchema.parse(input);
  const center = graph.nodes.find(node => node.id === options.nodeId);
  if (!center) throw new Error(`Unknown node ID: ${options.nodeId}`);

  const adjacent = new Map<string, Array<{ edge: ArchitectureEdge; neighbor: string }>>();
  function connect(id: string, edge: ArchitectureEdge, neighbor: string) {
    const entries = adjacent.get(id) ?? [];
    entries.push({ edge, neighbor });
    adjacent.set(id, entries);
  }
  for (const edge of graph.edges) {
    if (options.direction !== "incoming") connect(edge.source, edge, edge.target);
    if (options.direction !== "outgoing") connect(edge.target, edge, edge.source);
  }

  const selectedNodes = new Set([center.id]);
  const selectedEdges = new Set<string>();
  const queue = [{ id: center.id, depth: 0 }];
  const truncated = { nodes: false, edges: false };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { id, depth } = queue[cursor];
    if (depth >= options.maxDepth) continue;
    for (const { edge, neighbor } of adjacent.get(id) ?? []) {
      if (selectedEdges.has(edge.id)) continue;
      const isNewNode = !selectedNodes.has(neighbor);
      if (isNewNode && selectedNodes.size >= options.maxNodes) {
        truncated.nodes = true;
        continue;
      }
      if (selectedEdges.size >= options.maxEdges) {
        truncated.edges = true;
        continue;
      }
      selectedEdges.add(edge.id);
      if (isNewNode) {
        selectedNodes.add(neighbor);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  return {
    center,
    nodes: graph.nodes.filter(node => selectedNodes.has(node.id)),
    edges: graph.edges.filter(edge => selectedEdges.has(edge.id)),
    focus: {
      ...options,
      omittedNodes: graph.nodes.length - selectedNodes.size,
      omittedEdges: graph.edges.length - selectedEdges.size,
      truncated,
    },
  };
}
