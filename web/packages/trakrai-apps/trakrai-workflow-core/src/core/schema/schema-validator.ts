import type { JSONSchema } from 'zod/v4/core';

/**
 * Checks whether `schemaA` is a structural subset of `schemaB`.
 *
 * Returns `true` if every value valid under `schemaA` would also be valid
 * under `schemaB`. Used by the connection validator to enforce type-safe edges.
 *
 * The comparison is intentionally structural rather than exhaustive: it covers
 * the JSON Schema shapes Fluxery emits and consumes for node input/output
 * handles, including unions, enums, const values, objects, arrays, and record-like shapes.
 */
export const isJsonSchemaSubset = (
  schemaA_: JSONSchema._JSONSchema,
  schemaB_: JSONSchema._JSONSchema,
): boolean => {
  if (typeof schemaA_ === 'boolean' && typeof schemaB_ === 'boolean') {
    return schemaA_ === schemaB_;
  }
  const schemaA = schemaA_ as JSONSchema.JSONSchema;
  const schemaB = schemaB_ as JSONSchema.JSONSchema;

  if (schemaA.anyOf !== undefined || schemaA.oneOf !== undefined) {
    const optionsA = schemaA.anyOf ?? schemaA.oneOf;
    if (optionsA === undefined) {
      return false;
    }
    return optionsA.every((opt) => isJsonSchemaSubset(opt, schemaB));
  }

  if (schemaB.anyOf !== undefined || schemaB.oneOf !== undefined) {
    const options = schemaB.anyOf ?? schemaB.oneOf;
    if (options === undefined) {
      return false;
    }
    return options.some((opt) => isJsonSchemaSubset(schemaA, opt));
  }

  if (schemaA.const !== undefined) {
    if (schemaB.const !== undefined) {
      return schemaA.const === schemaB.const;
    }
    if (schemaB.enum !== undefined) {
      return schemaB.enum.includes(schemaA.const);
    }
    if (schemaB.type !== undefined) {
      return typeof schemaA.const === schemaB.type;
    }
  }

  if (schemaA.enum !== undefined) {
    if (schemaB.enum !== undefined) {
      return schemaA.enum.every((v) => schemaB.enum?.includes(v) === true);
    }
    if (schemaB.const !== undefined) {
      return false;
    }
    if (schemaB.type !== undefined) {
      return schemaA.enum.every((value) => typeof value === schemaB.type);
    }
  }

  if (schemaB.enum !== undefined || schemaB.const !== undefined) {
    return false;
  }

  if (schemaA.type !== undefined && schemaB.type !== undefined && schemaA.type !== schemaB.type) {
    return false;
  }

  if (schemaA.type === 'object' && schemaB.type === 'object') {
    if (schemaA.properties !== undefined && schemaB.properties !== undefined) {
      const aProps = (schemaA.properties ?? {}) as Partial<Record<string, JSONSchema._JSONSchema>>;
      const bProps = (schemaB.properties ?? {}) as Partial<Record<string, JSONSchema._JSONSchema>>;
      const aRequired = schemaA.required ?? [];
      const bRequired = schemaB.required ?? [];

      for (const [key, propB] of Object.entries(bProps)) {
        const propA = aProps[key];
        if (propA === undefined) {
          if (!bRequired.includes(key)) {
            continue;
          }
          return false;
        }
        if (propB === undefined) {
          return true;
        }
        if (bRequired.includes(key) && !aRequired.includes(key)) {
          return false;
        }
        if (!isJsonSchemaSubset(propA, propB)) {
          return false;
        }
      }
      return true;
    }
    if (
      schemaB.properties === undefined &&
      schemaB.propertyNames === undefined &&
      schemaB.additionalProperties === undefined
    ) {
      return true;
    }
    if (
      schemaA.propertyNames !== undefined &&
      schemaB.propertyNames !== undefined &&
      schemaA.additionalProperties !== undefined &&
      schemaB.additionalProperties !== undefined
    ) {
      return (
        isJsonSchemaSubset(schemaA.propertyNames, schemaB.propertyNames) &&
        isJsonSchemaSubset(schemaA.additionalProperties, schemaB.additionalProperties)
      );
    }
    return false;
  }

  if (schemaA.type === 'array' && schemaB.type === 'array') {
    if (
      schemaA.items !== undefined &&
      schemaB.items !== undefined &&
      !Array.isArray(schemaA.items) &&
      !Array.isArray(schemaB.items)
    ) {
      return isJsonSchemaSubset(schemaA.items, schemaB.items);
    }
    return false;
  }
  if (schemaA.type === schemaB.type) {
    return true;
  }
  if (schemaB.type === undefined && schemaB.properties === undefined) {
    return true;
  }
  return false;
};
