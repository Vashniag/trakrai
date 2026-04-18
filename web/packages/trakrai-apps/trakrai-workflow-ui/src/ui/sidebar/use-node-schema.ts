import { useMemo } from 'react';

import type { FluxeryConfigRecord } from '../flow-types';
import type { NodeRuntime, ResolvedNodeSchema, Edge, Node } from '@trakrai-workflow/core';
import type { z } from 'zod';

/** A tuple of `[propertyName, JSONSchema]` representing a single node input. */
export type InputEntry = [string, z.core.JSONSchema._JSONSchema];

const hasValidConfiguration = (configuration: unknown): configuration is FluxeryConfigRecord => {
  return configuration !== null && configuration !== undefined && typeof configuration === 'object';
};

const hasIncomingEdge = (propName: string, edges: Edge[], nodeId: string | null): boolean => {
  return edges.some((edge) => edge.target === nodeId && edge.targetHandle === propName);
};

const isConfigured = (propName: string, configuration: unknown): boolean => {
  if (!hasValidConfiguration(configuration)) {
    return false;
  }
  return propName in configuration;
};

type ResolveNodeSchemaArgs<Context extends object> = {
  selectedNode: string | null;
  nodeRuntime: NodeRuntime<Context>;
  nodes: Node[];
  edges: Edge[];
};

/**
 * Resolves the schema state for a selected node, categorizing its inputs.
 *
 * Computes which inputs are connected via edges, configured inline, or available
 * for configuration. Inputs with an incoming edge are treated as satisfied by the
 * graph and excluded from the configuration buckets, which mirrors how the sidebar
 * decides whether to show an inline field editor for a property.
 *
 * @typeParam Context - Application-specific context type.
 * @param args.selectedNode - The ID of the selected node, or `null`.
 * @param args.nodeRuntime - The node runtime for schema resolution.
 * @param args.nodes - All nodes in the current workflow.
 * @param args.edges - All edges in the current workflow.
 * @returns An object containing the resolved schema, categorized inputs, node edges,
 * and a normalized configuration record (empty object when the selected node has no
 * object-like `data.configuration` payload).
 */
export const resolveNodeSchemaState = <Context extends object>({
  selectedNode,
  nodeRuntime,
  nodes,
  edges,
}: ResolveNodeSchemaArgs<Context>) => {
  const nodeData =
    selectedNode === null ? null : (nodes.find((node) => node.id === selectedNode) ?? null);

  const nodeEdges = edges.filter(
    (edge) => edge.source === selectedNode || edge.target === selectedNode,
  );

  const resolvedNodeSchema: ResolvedNodeSchema | undefined =
    nodeData === null ? undefined : nodeRuntime.resolveNodeSchema(nodeData);

  const inputSchema = resolvedNodeSchema?.input ?? { type: 'object' as const, properties: {} };

  const allInputs = Object.entries(inputSchema.properties) as InputEntry[];

  const filterAllInputs = (hasEdge?: boolean, hasConfig?: boolean) => {
    const nodeHasConfiguration =
      nodeData?.data.configuration !== undefined &&
      hasValidConfiguration(nodeData.data.configuration);

    return allInputs.filter(([propName]) => {
      const edgeExists = hasIncomingEdge(propName, nodeEdges, selectedNode);
      const configExists =
        nodeHasConfiguration && isConfigured(propName, nodeData.data.configuration);

      if (hasEdge === undefined && hasConfig === undefined) {
        return true;
      }
      if (hasEdge !== undefined && hasConfig !== undefined) {
        return hasEdge === edgeExists && hasConfig === configExists;
      }
      if (hasEdge !== undefined) {
        return hasEdge === edgeExists;
      }
      if (hasConfig !== undefined) {
        return hasConfig === configExists;
      }
      return true;
    });
  };

  const inputsViaEdges = filterAllInputs(true);
  const inputsNotViaEdges = filterAllInputs(false);
  const inputsViaConfiguration = filterAllInputs(false, true);
  const inputsAvailableForConfiguration = filterAllInputs(false, false);

  return {
    selectedNode,
    resolvedNodeSchema,
    nodeEdges,
    allInputs,
    inputsViaEdges,
    inputsViaConfiguration,
    inputsAvailableForConfiguration,
    inputsNotViaEdges,
    config: hasValidConfiguration(nodeData?.data.configuration) ? nodeData.data.configuration : {},
  };
};

/**
 * Hook that returns memoized schema state for a selected node.
 *
 * Wraps {@link resolveNodeSchemaState} with `useMemo` for use in React components.
 * This is a derived read helper only; it does not subscribe to external stores
 * beyond the `nodes`, `edges`, and runtime references you pass in.
 *
 * @typeParam Context - Application-specific context type.
 * @param options.id - The selected node ID, or `null`.
 * @param options.nodeRuntime - The node runtime for schema resolution.
 * @param options.nodes - All nodes in the current workflow.
 * @param options.edges - All edges in the current workflow.
 * @returns Memoized schema state with categorized inputs.
 */
export const useNodeSchemaData = <Context extends object>({
  id,
  nodeRuntime,
  nodes,
  edges,
}: {
  id: string | null;
  nodeRuntime: NodeRuntime<Context>;
  nodes: Node[];
  edges: Edge[];
}) => {
  return useMemo(() => {
    return resolveNodeSchemaState({
      selectedNode: id,
      nodeRuntime,
      nodes,
      edges,
    });
  }, [id, nodeRuntime, nodes, edges]);
};
