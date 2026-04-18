import type { JSONSchema } from 'zod/v4/core';

/**
 * The subset of JSON Schema types the builder can produce.
 * These map 1:1 to what `jsonSchemaToTypeString` and `isJsonSchemaSubset` understand.
 */
export type SchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'enum'
  | 'literal'
  | 'union';

/** Display metadata for each type in the builder UI. */
export const SCHEMA_TYPE_OPTIONS: { value: SchemaType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'null', label: 'Null' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
  { value: 'enum', label: 'Enum' },
  { value: 'literal', label: 'Literal' },
  { value: 'union', label: 'Union' },
];

/** Describes a single property within an object schema. */
export interface PropertyDescriptor {
  /** Property key name */
  name: string;
  /** Whether the property is required */
  required: boolean;
  /** Whether the property is nullable (wraps in anyOf with null) */
  nullable: boolean;
  /** The property's schema definition */
  schema: SchemaDefinition;
}

/**
 * Internal model used by the builder to represent a schema being constructed.
 * This is NOT the final JSON Schema. It is the editable form model that gets
 * converted to/from JSON Schema via helper functions. The supported variants
 * intentionally track the subset of JSON Schema that Fluxery's editor and
 * runtime helpers can round-trip safely.
 */
export type SchemaDefinition =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'null' }
  | { type: 'object'; properties: PropertyDescriptor[] }
  | { type: 'array'; items: SchemaDefinition }
  | { type: 'enum'; values: string[] }
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'union'; variants: SchemaDefinition[] };

const wrapNullable = (schema: JSONSchema.JSONSchema, nullable: boolean): JSONSchema.JSONSchema => {
  if (!nullable) return schema;
  return { anyOf: [schema, { type: 'null' }] };
};

/**
 * Converts the builder model into JSON Schema.
 *
 * Object definitions always emit `additionalProperties: false` so the schema
 * remains aligned with the editor's explicit field list.
 */
export const definitionToJsonSchema = (definition: SchemaDefinition): JSONSchema.JSONSchema => {
  switch (definition.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };

    case 'object': {
      const properties: Record<string, JSONSchema.JSONSchema> = {};
      const required: string[] = [];

      for (const property of definition.properties) {
        properties[property.name] = wrapNullable(
          definitionToJsonSchema(property.schema),
          property.nullable,
        );
        if (property.required) {
          required.push(property.name);
        }
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }

    case 'array':
      return {
        type: 'array',
        items: definitionToJsonSchema(definition.items),
      };

    case 'enum':
      return { enum: definition.values };

    case 'literal':
      return { const: definition.value };

    case 'union':
      return {
        anyOf: definition.variants.map(definitionToJsonSchema),
      };
  }
};

/**
 * Converts JSON Schema back into the builder model.
 *
 * Unsupported or lossy cases intentionally fall back to simple defaults
 * instead of preserving unsupported JSON Schema features in the editor model.
 */
export const jsonSchemaToDefinition = (schema: JSONSchema._JSONSchema): SchemaDefinition => {
  if (typeof schema === 'boolean') {
    return { type: 'string' };
  }

  const jsonSchema = schema as JSONSchema.JSONSchema;

  if (jsonSchema.const !== undefined) {
    return { type: 'literal', value: jsonSchema.const as string | number | boolean };
  }

  if (jsonSchema.enum !== undefined) {
    return { type: 'enum', values: jsonSchema.enum.map((entry) => String(entry)) };
  }

  const unionVariants = jsonSchema.anyOf ?? jsonSchema.oneOf;
  if (unionVariants !== undefined) {
    const nonNullVariants = unionVariants.filter(
      (variant) =>
        !(typeof variant === 'object' && (variant as JSONSchema.JSONSchema).type === 'null'),
    );
    const hasNullVariant = nonNullVariants.length < unionVariants.length;

    if (hasNullVariant && nonNullVariants.length === 1) {
      return jsonSchemaToDefinition(nonNullVariants[0] as JSONSchema._JSONSchema);
    }

    return {
      type: 'union',
      variants: nonNullVariants.map((variant) =>
        jsonSchemaToDefinition(variant as JSONSchema._JSONSchema),
      ),
    };
  }

  switch (jsonSchema.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
    case 'integer':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };

    case 'array': {
      const { items } = jsonSchema;
      if (items !== undefined && !Array.isArray(items)) {
        return {
          type: 'array',
          items: jsonSchemaToDefinition(items as JSONSchema._JSONSchema),
        };
      }
      return { type: 'array', items: { type: 'string' } };
    }

    case 'object': {
      if (jsonSchema.properties === undefined) {
        return { type: 'object', properties: [] };
      }

      const required = new Set(jsonSchema.required ?? []);
      const properties: PropertyDescriptor[] = Object.entries(
        jsonSchema.properties as Record<string, JSONSchema._JSONSchema>,
      ).map(([name, propertySchema]) => {
        let innerSchema = propertySchema;
        let nullable = false;

        if (typeof propertySchema === 'object') {
          const propertySchemaObject = propertySchema as JSONSchema.JSONSchema;
          const propertyUnion = propertySchemaObject.anyOf ?? propertySchemaObject.oneOf;
          if (propertyUnion !== undefined) {
            const nonNullVariants = propertyUnion.filter(
              (variant) =>
                !(
                  typeof variant === 'object' && (variant as JSONSchema.JSONSchema).type === 'null'
                ),
            );
            if (nonNullVariants.length < propertyUnion.length && nonNullVariants.length === 1) {
              nullable = true;
              innerSchema = nonNullVariants[0] as JSONSchema._JSONSchema;
            }
          }
        }

        return {
          name,
          required: required.has(name),
          nullable,
          schema: jsonSchemaToDefinition(innerSchema),
        };
      });

      return { type: 'object', properties };
    }

    case undefined:
    default:
      return { type: 'string' };
  }
};

/** Creates the initial editable builder state for a newly selected schema type. */
export const createDefaultDefinition = (type: SchemaType): SchemaDefinition => {
  switch (type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    case 'object':
      return { type: 'object', properties: [] };
    case 'array':
      return { type: 'array', items: { type: 'string' } };
    case 'enum':
      return { type: 'enum', values: ['value1'] };
    case 'literal':
      return { type: 'literal', value: '' };
    case 'union':
      return { type: 'union', variants: [{ type: 'string' }, { type: 'number' }] };
  }
};

/** Creates a required string property descriptor for bootstrapping object definitions in the editor. */
export const createDefaultProperty = (name: string): PropertyDescriptor => ({
  name,
  required: true,
  nullable: false,
  schema: { type: 'string' },
});
