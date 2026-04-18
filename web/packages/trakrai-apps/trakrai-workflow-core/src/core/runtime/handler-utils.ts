import type { NodeSchemaResolutionContext } from '.';
import type { Edge, JsonObject, Node } from '../../types';
import type { z } from 'zod';

import { isEventHandle } from '../utils';

/** Type guard: returns `true` if `value` is a non-null, non-array plain object. */
export const hasObjectConfiguration = (value: unknown): value is JsonObject => {
  return (
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
  );
};

/** Extracts the configuration record from a node, returning an empty object when absent. */
export const getNodeConfiguration = (node: Node | null): JsonObject => {
  return hasObjectConfiguration(node?.data.configuration) ? node.data.configuration : {};
};

/**
 * Reads a JSON Schema-like value stored in the node's configuration under `key`.
 *
 * Only boolean schemas and object-shaped schemas are accepted; other primitive
 * configuration values are ignored because they cannot describe a schema.
 */
export const getSchemaFromConfiguration = (
  node: Node,
  key: string,
): z.core.JSONSchema._JSONSchema | undefined => {
  const configuration = getNodeConfiguration(node);
  const value = configuration[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object') {
    return value as z.core.JSONSchema._JSONSchema;
  }
  return undefined;
};

/**
 * Resolves the JSON Schema of a source property referenced by an edge.
 *
 * Handles both regular output handles and event handles (identified by `###`
 * separator) against the current runtime-resolved source node schema.
 */
export const getSourcePropertySchema = (
  edge: Edge,
  context: NodeSchemaResolutionContext,
): z.core.JSONSchema._JSONSchema | undefined => {
  const sourceSchema = context.resolveNodeSchema(edge.source);
  if (sourceSchema === undefined) {
    return undefined;
  }
  const { sourceHandle } = edge;
  if (sourceHandle === undefined || sourceHandle === null || sourceHandle === '') {
    return undefined;
  }
  const event = isEventHandle(sourceHandle);
  if (event.isEvent) {
    return sourceSchema.events?.[event.eventName]?.data.properties[event.eventHandle];
  }
  return sourceSchema.output.properties[sourceHandle];
};
