import type { Connection } from '@xyflow/react';

import { TriggerHandle, type Edge, type Node } from '../../types';
import { getSchemaProperty, type NodeRuntime } from '../runtime';
import { hasObjectConfiguration } from '../runtime/handler-utils';
import { isJsonSchemaSubset } from '../schema/schema-validator';
import { isEventHandle } from '../utils';

/**
 * Validates whether a proposed connection (edge) between two nodes is type-safe.
 *
 * Trigger connections are treated as control-flow edges and only require a
 * valid source node/type. Data connections additionally check that the source
 * output property's schema is a valid subset of the target input property's
 * schema, the target handle is not already connected, and the handle is not
 * already statically configured on the target node.
 */
export const validateConnection = <Context extends object>(
  edge: Connection | Edge,
  nodes: Node[],
  edges: Edge[],
  nodeRuntime: NodeRuntime<Context>,
) => {
  if (
    edge.targetHandle === undefined ||
    edge.targetHandle === null ||
    edge.sourceHandle === undefined ||
    edge.sourceHandle === null
  ) {
    return false;
  }
  if (edge.targetHandle === TriggerHandle) {
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (sourceNode === undefined) {
      return false;
    }
    const nodeType = sourceNode.type;
    if (nodeType === undefined) {
      return false;
    }
    return true;
  }
  const targetEdges = edges.filter((existingEdge) => existingEdge.target === edge.target);
  if (targetEdges.some((existingEdge) => existingEdge.targetHandle === edge.targetHandle)) {
    return false;
  }
  const targetNode = nodes.find((node) => node.id === edge.target);
  if (targetNode === undefined) {
    return false;
  }
  if (
    hasObjectConfiguration(targetNode.data.configuration) &&
    Object.keys(targetNode.data.configuration).includes(edge.targetHandle)
  ) {
    return false;
  }
  const sourceNode = nodes.find((node) => node.id === edge.source);
  if (sourceNode === undefined) {
    return false;
  }
  const sourceNodeType = sourceNode.type;
  const targetNodeType = targetNode.type;
  if (sourceNodeType === undefined || targetNodeType === undefined) {
    return false;
  }
  const sourceNodeSchema = nodeRuntime.resolveNodeSchema(sourceNode);
  const targetNodeSchema = nodeRuntime.resolveNodeSchema(targetNode);
  if (sourceNodeSchema === undefined || targetNodeSchema === undefined) {
    return false;
  }
  let sourceSchema = getSchemaProperty(sourceNodeSchema.output, edge.sourceHandle);
  const isEvent = isEventHandle(edge.sourceHandle);
  if (isEvent.isEvent) {
    sourceSchema = getSchemaProperty(
      sourceNodeSchema.events?.[isEvent.eventName]?.data,
      isEvent.eventHandle,
    );
  }
  const targetSchema = getSchemaProperty(targetNodeSchema.input, edge.targetHandle);
  if (sourceSchema === undefined || targetSchema === undefined) {
    return false;
  }
  return isJsonSchemaSubset(sourceSchema, targetSchema);
};
