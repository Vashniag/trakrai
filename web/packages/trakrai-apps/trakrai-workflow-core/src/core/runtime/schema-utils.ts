import { z } from 'zod';

import type {
  NodeEventSchemaLike,
  NodeSchemaLike,
  ResolvedNodeEventSchema,
  ResolvedObjectSchema,
  SchemaParseResult,
} from './types';
import type { NodeEvent } from '../../types';

/**
 * Canonical empty object schema used when a node/input/event schema is absent
 * or cannot be represented as an object shape.
 */
export const EMPTY_OBJECT_SCHEMA: ResolvedObjectSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const createEmptyObjectSchema = (): ResolvedObjectSchema => ({
  ...EMPTY_OBJECT_SCHEMA,
  properties: {},
});

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const isZodSchema = (schema: unknown): schema is z.ZodTypeAny => {
  return (
    isPlainObject(schema) &&
    'safeParse' in schema &&
    typeof (schema as { safeParse?: unknown }).safeParse === 'function'
  );
};

const isJsonSchemaObject = (schema: unknown): schema is z.core.JSONSchema.JSONSchema => {
  return isPlainObject(schema);
};

const normalizeRequired = (required: unknown): string[] | undefined => {
  if (!Array.isArray(required)) {
    return undefined;
  }
  const entries = required.filter((item): item is string => typeof item === 'string');
  return entries.length > 0 ? entries : undefined;
};

const normalizeProperties = (
  properties: unknown,
): Record<string, z.core.JSONSchema._JSONSchema> => {
  if (properties === null || properties === undefined || typeof properties !== 'object') {
    return {};
  }
  return properties as Record<string, z.core.JSONSchema._JSONSchema>;
};

/**
 * Converts a `NodeSchemaLike` (Zod type or raw JSON Schema) into a normalised
 * `ResolvedObjectSchema` with `type: 'object'`. Returns the empty object schema
 * if the input is `undefined`, a boolean, or not object-shaped.
 *
 * This intentionally narrows non-object schemas to the empty-object fallback
 * because the runtime resolves node inputs, outputs, and event payloads as
 * named properties rather than scalar values.
 */
export const toObjectSchema = (schema: NodeSchemaLike | undefined): ResolvedObjectSchema => {
  if (schema === undefined || typeof schema === 'boolean') {
    return createEmptyObjectSchema();
  }

  const jsonSchema = isZodSchema(schema)
    ? (z.toJSONSchema(schema) as z.core.JSONSchema._JSONSchema)
    : (schema as z.core.JSONSchema._JSONSchema);

  if (typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    return createEmptyObjectSchema();
  }

  const schemaObj = jsonSchema as Record<string, unknown>;
  const hasObjectShape = schemaObj.type === 'object' || schemaObj.properties !== undefined;
  if (!hasObjectShape) {
    return createEmptyObjectSchema();
  }

  const properties = normalizeProperties(schemaObj.properties);
  const required = normalizeRequired(schemaObj.required);

  return {
    ...(schemaObj as z.core.JSONSchema.JSONSchema),
    type: 'object',
    properties,
    ...(required !== undefined ? { required } : {}),
  };
};

/**
 * Converts public `NodeEvent` definitions into the runtime's schema-like shape
 * without forcing immediate Zod-to-JSON-Schema conversion.
 */
export const toEventSchemaLike = (
  events: Record<string, NodeEvent> | undefined,
): Record<string, NodeEventSchemaLike> | undefined => {
  if (events === undefined) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(events).map(([eventName, eventDefinition]) => [
      eventName,
      {
        description: eventDefinition.description,
        data: eventDefinition.data,
      },
    ]),
  );
};

/**
 * Fully resolves event schemas by converting each event payload into a
 * normalized object schema.
 */
export const toResolvedEvents = (
  events: Record<string, NodeEventSchemaLike> | undefined,
): Record<string, ResolvedNodeEventSchema> | undefined => {
  if (events === undefined) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(events).map(([eventName, eventDefinition]) => [
      eventName,
      {
        description: eventDefinition.description,
        data: toObjectSchema(eventDefinition.data),
      },
    ]),
  );
};

const describeValue = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
};

const buildSchemaError = (path: string, message: string): string => {
  return `${path}: ${message}`;
};

const pathForKey = (path: string, key: string): string => {
  return path === '$' ? `$.${key}` : `${path}.${key}`;
};

const pathForIndex = (path: string, index: number): string => {
  return `${path}[${index}]`;
};

const validateArrayItems = (
  schema: z.core.JSONSchema.JSONSchema,
  value: unknown[],
  defs: Record<string, z.core.JSONSchema._JSONSchema> | undefined,
  path: string,
): string | null => {
  if (schema.prefixItems !== undefined && Array.isArray(schema.prefixItems)) {
    if (value.length < schema.prefixItems.length) {
      return buildSchemaError(path, `expected at least ${schema.prefixItems.length} items`);
    }
    for (const [index, itemSchema] of schema.prefixItems.entries()) {
      const error = validateJsonSchemaValue(
        itemSchema,
        value[index],
        defs,
        pathForIndex(path, index),
      );
      if (error !== null) {
        return error;
      }
    }
  }

  if (schema.items !== undefined && !Array.isArray(schema.items)) {
    for (const [index, item] of value.entries()) {
      const error = validateJsonSchemaValue(schema.items, item, defs, pathForIndex(path, index));
      if (error !== null) {
        return error;
      }
    }
  }

  return null;
};

const validateObjectShape = (
  schema: z.core.JSONSchema.JSONSchema,
  value: Record<string, unknown>,
  defs: Record<string, z.core.JSONSchema._JSONSchema> | undefined,
  path: string,
): string | null => {
  const properties = normalizeProperties(schema.properties);
  const required = new Set(normalizeRequired(schema.required) ?? []);

  for (const key of required) {
    if (!(key in value)) {
      return buildSchemaError(pathForKey(path, key), 'is required');
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema !== undefined) {
      const error = validateJsonSchemaValue(
        propertySchema,
        propertyValue,
        defs,
        pathForKey(path, key),
      );
      if (error !== null) {
        return error;
      }
      continue;
    }

    if (schema.propertyNames !== undefined) {
      const keyError = validateJsonSchemaValue(
        schema.propertyNames,
        key,
        defs,
        pathForKey(path, key),
      );
      if (keyError !== null) {
        return keyError;
      }
    }

    if (schema.additionalProperties === false) {
      return buildSchemaError(pathForKey(path, key), 'is not allowed');
    }

    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      const error = validateJsonSchemaValue(
        schema.additionalProperties,
        propertyValue,
        defs,
        pathForKey(path, key),
      );
      if (error !== null) {
        return error;
      }
    }
  }

  return null;
};

const matchesPrimitiveType = (value: unknown, expectedType: string): boolean => {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
};

const validateJsonSchemaValue = (
  schema: z.core.JSONSchema._JSONSchema,
  value: unknown,
  defs: Record<string, z.core.JSONSchema._JSONSchema> | undefined,
  path: string,
): string | null => {
  if (typeof schema === 'boolean') {
    return schema ? null : buildSchemaError(path, 'is not allowed');
  }

  if (schema.$ref !== undefined) {
    const refName = schema.$ref.replace(/^#\/\$defs\//, '');
    const refSchema = defs?.[refName];
    if (refSchema === undefined) {
      return buildSchemaError(path, `could not resolve schema reference '${schema.$ref}'`);
    }
    return validateJsonSchemaValue(refSchema, value, defs, path);
  }

  const variants = schema.anyOf ?? schema.oneOf;
  if (variants !== undefined) {
    const successes = variants.filter(
      (variant) => validateJsonSchemaValue(variant, value, defs, path) === null,
    );
    if (schema.oneOf !== undefined) {
      return successes.length === 1
        ? null
        : buildSchemaError(path, 'did not match exactly one schema option');
    }
    return successes.length > 0
      ? null
      : buildSchemaError(path, 'did not match any allowed schema option');
  }

  if (schema.allOf !== undefined) {
    for (const part of schema.allOf) {
      const error = validateJsonSchemaValue(part, value, defs, path);
      if (error !== null) {
        return error;
      }
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    return buildSchemaError(path, `expected ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum !== undefined && !schema.enum.some((entry) => Object.is(entry, value))) {
    return buildSchemaError(
      path,
      `expected one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`,
    );
  }

  if (schema.type !== undefined) {
    const schemaTypes: unknown[] = Array.isArray(schema.type) ? [...schema.type] : [schema.type];
    const allowedTypes = schemaTypes.filter(
      (allowedType): allowedType is string => typeof allowedType === 'string',
    );
    if (!allowedTypes.some((allowedType) => matchesPrimitiveType(value, allowedType))) {
      return buildSchemaError(
        path,
        `expected ${allowedTypes.join(' | ')}, received ${describeValue(value)}`,
      );
    }
  }

  if (Array.isArray(value)) {
    return validateArrayItems(schema, value, defs, path);
  }

  if (!Array.isArray(value) && (schema.items !== undefined || schema.prefixItems !== undefined)) {
    return buildSchemaError(path, `expected array, received ${describeValue(value)}`);
  }

  if (isPlainObject(value)) {
    return validateObjectShape(schema, value, defs, path);
  }

  if (
    !isPlainObject(value) &&
    (schema.properties !== undefined ||
      schema.required !== undefined ||
      schema.additionalProperties !== undefined ||
      schema.propertyNames !== undefined)
  ) {
    return buildSchemaError(path, `expected object, received ${describeValue(value)}`);
  }

  return null;
};

/**
 * Validates `value` against `schema` without throwing.
 *
 * Supports both Zod schemas (via `safeParse`) and plain JSON Schema objects
 * (via a built-in structural validator). An `undefined` schema is treated as
 * permissive passthrough so callers can omit optional runtime validation.
 */
export const safeParseSchema = (
  schema: NodeSchemaLike | undefined,
  value: unknown,
): SchemaParseResult => {
  if (schema === undefined || !isZodSchema(schema)) {
    if (schema === undefined) {
      return { success: true, data: value };
    }

    if (!isJsonSchemaObject(schema) && typeof schema !== 'boolean') {
      return {
        success: false,
        error: 'Invalid schema definition',
      };
    }

    const defs = typeof schema === 'object' ? schema.$defs : undefined;
    const error = validateJsonSchemaValue(schema, value, defs, '$');
    return error === null
      ? { success: true, data: value }
      : {
          success: false,
          error,
        };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.message,
    };
  }
  return {
    success: true,
    data: parsed.data,
  };
};

/**
 * Parses `value` against `schema` and throws a prefixed error on failure.
 *
 * This is the runtime-friendly wrapper used by handlers that want a single
 * exception path instead of a discriminated parse result.
 */
export const parseSchemaOrThrow = <T>(
  schema: NodeSchemaLike | undefined,
  value: unknown,
  errorPrefix: string,
): T => {
  const parsed = safeParseSchema(schema, value);
  if (!parsed.success) {
    throw new Error(`${errorPrefix}: ${parsed.error}`);
  }
  return parsed.data as T;
};

/** Retrieves a single property's JSON Schema from a resolved object schema by handle/property name. */
export const getSchemaProperty = (
  schema: ResolvedObjectSchema | undefined,
  propertyName: string,
): z.core.JSONSchema._JSONSchema | undefined => {
  return schema?.properties[propertyName];
};
