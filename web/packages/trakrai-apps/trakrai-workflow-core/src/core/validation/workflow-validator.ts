import {
  TriggerHandle,
  type DependencyInfo,
  type Edge,
  type Node,
  type NodeSchemas,
} from '../../types';
import { createNodeRuntime, type NodeHandlerRegistry, type ResolvedObjectSchema } from '../runtime';

type DependencyMap = Record<string, DependencyInfo[]>;
type AsyncDependencyMap = Record<string, string[]>;

const buildAsyncDependencyMap = (
  nodes: Node[],
  dependencyMap: DependencyMap,
  asyncNodeTypes: Set<string>,
): AsyncDependencyMap => {
  const nodeTypeMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== undefined) {
      nodeTypeMap.set(node.id, node.type);
    }
  }

  const asyncDeps: AsyncDependencyMap = {};

  for (const node of nodes) {
    const barriers = new Set<string>();
    const visited = new Set<string>();

    const walk = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const deps = dependencyMap[nodeId] ?? [];
      for (const dep of deps) {
        const depType = nodeTypeMap.get(dep.sourceNodeId);
        if (depType !== undefined && asyncNodeTypes.has(depType)) {
          barriers.add(dep.sourceNodeId);
          // Stop here — don't walk past async barriers
        } else {
          walk(dep.sourceNodeId);
        }
      }
    };

    walk(node.id);
    asyncDeps[node.id] = Array.from(barriers);
  }

  return asyncDeps;
};

const buildDependencyMap = (nodes: Node[], edges: Edge[]): DependencyMap => {
  const dependencyMap: DependencyMap = {};

  for (const node of nodes) {
    dependencyMap[node.id] = [];
  }

  for (const edge of edges) {
    const targetNodeId = edge.target;
    const dependencies = dependencyMap[targetNodeId] ?? [];
    const conditional = edge.targetHandle === TriggerHandle;
    dependencies.push({
      sourceNodeId: edge.source,
      sourceHandle: edge.sourceHandle ?? '',
      targetHandle: edge.targetHandle ?? '',
      conditional: conditional ? edge.data?.configuration : undefined,
    });
    dependencyMap[targetNodeId] = dependencies;
  }

  return dependencyMap;
};

const topologicalSort = (nodes: Node[], edges: Edge[]) => {
  const dependencyMap = buildDependencyMap(nodes, edges);
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) {
      return;
    }
    if (visiting.has(nodeId)) {
      throw new Error(`Circular dependency detected at node: ${nodeId}`);
    }
    visiting.add(nodeId);
    const deps = dependencyMap[nodeId] ?? [];
    for (const dep of deps) {
      visit(dep.sourceNodeId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of nodes) {
    visit(node.id);
  }

  return { dependencyMap };
};

const getRequiredInputFields = (inputSchema: ResolvedObjectSchema) => {
  const properties = inputSchema.properties as Record<string, { default?: unknown }>;
  const required = inputSchema.required ?? Object.keys(properties);
  return required.filter((field) => {
    const prop = properties[field];
    return prop === undefined || !('default' in prop);
  });
};

const validateNodeInputs = (
  node: Node,
  edges: Edge[],
  inputSchema: ResolvedObjectSchema,
): { valid: boolean; missingInputs: string[] } => {
  const requiredFields = getRequiredInputFields(inputSchema);
  const configuredInputs = new Set<string>(Object.keys(node.data.configuration ?? {}));
  const edgeInputs = new Set<string>(
    edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.targetHandle ?? '')
      .filter((handle) => handle !== ''),
  );
  const missingInputs: string[] = [];
  for (const field of requiredFields) {
    if (!configuredInputs.has(field) && !edgeInputs.has(field)) {
      missingInputs.push(field);
    }
  }
  return {
    valid: missingInputs.length === 0,
    missingInputs,
  };
};
/**
 * Validates an entire workflow graph.
 *
 * Checks for:
 * - Circular dependencies (topological sort)
 * - Duplicate node IDs
 * - Missing or invalid node types
 * - Dangling edge references
 * - Unsatisfied required inputs
 *
 * `nodeHandlers` are considered part of the known node-type registry, so
 * dynamic handler-backed nodes validate even when they are not present in the
 * static `nodeSchemas` map. `asyncDependencyMap` captures the nearest upstream
 * async barriers for each node and is empty when no async node types are supplied.
 *
 * Returns `{ valid: true, dependencyMap, asyncDependencyMap }` on success, or
 * `{ valid: false, errors }` on failure.
 */
export const validateWorkflow = <Context extends object>(
  nodes: Node[],
  edges: Edge[],
  nodeSchemas: NodeSchemas,
  asyncNodeTypes?: Set<string>,
  nodeHandlers?: NodeHandlerRegistry<Context>,
):
  | { valid: false; errors: string[] }
  | {
      valid: true;
      dependencyMap: DependencyMap;
      asyncDependencyMap: AsyncDependencyMap;
    } => {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const knownNodeTypes = new Set([...Object.keys(nodeSchemas), ...Object.keys(nodeHandlers ?? {})]);
  const nodeRuntime = createNodeRuntime({
    nodes,
    edges,
    nodeSchemas,
    nodeHandlers,
  });
  if (nodes.length === 0) {
    return { valid: true, dependencyMap: {}, asyncDependencyMap: {} };
  }
  let dependencyMap: DependencyMap = {};
  try {
    const { dependencyMap: depMap } = topologicalSort(nodes, edges);
    dependencyMap = depMap;
  } catch (error) {
    if (error instanceof Error) {
      errors.push(error.message);
    }
  }

  const duplicates = nodes.map((n) => n.id).filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicates.length > 0) {
    errors.push(`Duplicate node IDs found: ${duplicates.join(', ')}`);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge '${edge.id}' references missing source node '${edge.source}'`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge '${edge.id}' references missing target node '${edge.target}'`);
    }
  }

  for (const node of nodes) {
    const nodeType = node.type;
    if (nodeType === undefined) {
      errors.push(`Node '${node.id}' is missing type`);
      continue;
    }
    const nodeName = node.id;
    if (!knownNodeTypes.has(nodeType)) {
      errors.push(`Node '${nodeName}' has invalid type: ${nodeType}`);
      continue;
    }
    const nodeDefinition = nodeRuntime.resolveNodeSchema(node);
    if (nodeDefinition === undefined) {
      errors.push(`Node '${nodeName}' has undefined type: ${nodeType}`);
      continue;
    }
    const inputValidation = validateNodeInputs(node, edges, nodeDefinition.input);
    if (!inputValidation.valid) {
      errors.push(
        `Node '${nodeName}' is missing required inputs: ${inputValidation.missingInputs.join(', ')}`,
      );
    }
  }

  const asyncDependencyMap = buildAsyncDependencyMap(
    nodes,
    dependencyMap,
    asyncNodeTypes ?? new Set(),
  );

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    dependencyMap,
    asyncDependencyMap,
  };
};
