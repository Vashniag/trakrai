import type { JSONSchema } from 'zod/v4/core';

type JsonSchema = JSONSchema.JSONSchema;

/**
 * Converts a JSON Schema (as produced by z.toJSONSchema()) into a TypeScript
 * type declaration string suitable for feeding to Monaco's `addExtraLib`.
 *
 * This handles the full range of JSON Schema constructs that Zod v4 emits:
 *   objects, arrays, tuples, unions (anyOf/oneOf), enums, const, nullable,
 *   $ref / $defs, optional properties, record types, and all primitives.
 *
 * Unresolvable `$ref`s and underspecified schemas intentionally degrade to
 * `unknown` so editor integrations stay usable instead of throwing.
 */
export const jsonSchemaToTypeString = (
  root: JSONSchema._JSONSchema,
  defs?: Record<string, JSONSchema._JSONSchema>,
): string => {
  // Resolve top-level $defs if present
  const resolvedDefs = defs ?? (typeof root === 'object' ? root.$defs : undefined);

  const convert = (schema: JSONSchema._JSONSchema, depth: number): string => {
    // Boolean schemas
    if (typeof schema === 'boolean') {
      return schema ? 'unknown' : 'never';
    }

    const s = schema as JsonSchema;
    const indent = '  '.repeat(depth);
    const innerIndent = '  '.repeat(depth + 1);

    // Handle $ref
    if (s.$ref !== undefined) {
      const refName = s.$ref.replace(/^#\/\$defs\//, '');
      const refSchema = resolvedDefs?.[refName];
      if (refSchema !== undefined) {
        return convert(refSchema, depth);
      }
      return 'unknown';
    }

    // Handle anyOf / oneOf → union
    const unionVariants = s.anyOf ?? s.oneOf;
    if (unionVariants !== undefined) {
      // Zod emits nullable as anyOf: [actualType, {type:"null"}]
      const nonNull = unionVariants.filter(
        (v) => !(typeof v === 'object' && (v as JsonSchema).type === 'null'),
      );
      const hasNull = nonNull.length < unionVariants.length;
      const parts = nonNull.map((v) => convert(v, depth));
      if (hasNull) parts.push('null');
      if (parts.length === 0) return 'never';
      if (parts.length === 1) return parts[0] as string;
      return parts.join(' | ');
    }

    // Handle allOf → intersection
    if (s.allOf !== undefined) {
      const parts = s.allOf.map((v) => convert(v, depth));
      if (parts.length === 0) return 'unknown';
      if (parts.length === 1) return parts[0] as string;
      return parts.map((p) => `(${p})`).join(' & ');
    }

    // Handle const
    if (s.const !== undefined) {
      return JSON.stringify(s.const);
    }

    // Handle enum
    if (s.enum !== undefined) {
      return s.enum.map((v) => JSON.stringify(v)).join(' | ');
    }

    // Handle by type
    switch (s.type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';

      case 'array': {
        // Tuple support (prefixItems)
        if (s.prefixItems !== undefined && Array.isArray(s.prefixItems)) {
          const elements = s.prefixItems.map((item) => convert(item, depth));
          return `[${elements.join(', ')}]`;
        }
        // Regular array
        const { items } = s;
        if (items !== undefined && !Array.isArray(items)) {
          const inner = convert(items, depth);
          // Wrap complex types in parens for readability
          const needsParens = inner.includes('|') || inner.includes('&');
          return `${needsParens ? `(${inner})` : inner}[]`;
        }
        return 'unknown[]';
      }

      case 'object': {
        // Record / Map type (additionalProperties with no properties)
        if (
          s.properties === undefined &&
          s.additionalProperties !== undefined &&
          s.additionalProperties !== false
        ) {
          const keyType =
            s.propertyNames !== undefined ? convert(s.propertyNames, depth) : 'string';
          const valueType =
            s.additionalProperties === true ? 'unknown' : convert(s.additionalProperties, depth);
          return `Record<${keyType}, ${valueType}>`;
        }

        // Object with properties
        if (s.properties !== undefined) {
          const required = new Set(s.required ?? []);
          const entries = Object.entries(s.properties as Record<string, JSONSchema._JSONSchema>);

          if (entries.length === 0) {
            return s.additionalProperties === false
              ? 'Record<string, never>'
              : 'Record<string, unknown>';
          }

          const lines = entries.map(([key, propSchema]) => {
            const optional = !required.has(key);
            const propType = convert(propSchema, depth + 1);
            const safeName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
            return `${innerIndent}${safeName}${optional ? '?' : ''}: ${propType};`;
          });

          // If additionalProperties is allowed, add index signature
          if (s.additionalProperties !== undefined && s.additionalProperties !== false) {
            const additionalType =
              s.additionalProperties === true
                ? 'unknown'
                : convert(s.additionalProperties, depth + 1);
            lines.push(`${innerIndent}[key: string]: ${additionalType};`);
          }

          return `{\n${lines.join('\n')}\n${indent}}`;
        }

        // Plain object with no constraints
        return 'Record<string, unknown>';
      }
      case undefined:
      default:
        break;
    }

    // No type specified — treat as unknown
    return 'unknown';
  };

  return convert(root, 0);
};
