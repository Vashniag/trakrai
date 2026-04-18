/* eslint-disable no-magic-numbers */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { JSONSchema } from 'zod/v4/core';

import { jsonSchemaToTypeString } from '../core/schema/json-schema-to-type-string';
import {
  createDefaultDefinition,
  createDefaultProperty,
  definitionToJsonSchema,
  jsonSchemaToDefinition,
  type SchemaDefinition,
} from '../core/schema/schema-definition-to-json-schema';
import { isJsonSchemaSubset } from '../core/schema/schema-validator';

// ---------------------------------------------------------------------------
// Helper: round-trip test (definition → JSON Schema → definition)
// ---------------------------------------------------------------------------

const roundTrip = (def: SchemaDefinition): SchemaDefinition => {
  const schema = definitionToJsonSchema(def);
  return jsonSchemaToDefinition(schema);
};
const NAME_STRING = 'name: string';
describe('json-schema-builder types', () => {
  // -------------------------------------------------------------------------
  // definitionToJsonSchema
  // -------------------------------------------------------------------------
  describe('definitionToJsonSchema', () => {
    it('converts string type', () => {
      expect(definitionToJsonSchema({ type: 'string' })).toEqual({ type: 'string' });
    });

    it('converts number type', () => {
      expect(definitionToJsonSchema({ type: 'number' })).toEqual({ type: 'number' });
    });

    it('converts boolean type', () => {
      expect(definitionToJsonSchema({ type: 'boolean' })).toEqual({ type: 'boolean' });
    });

    it('converts null type', () => {
      expect(definitionToJsonSchema({ type: 'null' })).toEqual({ type: 'null' });
    });

    it('converts empty object', () => {
      expect(definitionToJsonSchema({ type: 'object', properties: [] })).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    });

    it('converts object with required properties', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
        ],
      };
      expect(definitionToJsonSchema(def)).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
        additionalProperties: false,
      });
    });

    it('converts object with optional properties', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: false, nullable: false, schema: { type: 'number' } },
        ],
      };
      const result = definitionToJsonSchema(def);
      expect(result.required).toEqual(['name']);
    });

    it('converts nullable properties', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [{ name: 'value', required: true, nullable: true, schema: { type: 'string' } }],
      };
      const result = definitionToJsonSchema(def) as JSONSchema.JSONSchema;
      const valueProp = (result.properties as Record<string, JSONSchema.JSONSchema>).value;
      expect(valueProp?.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
    });

    it('converts array type', () => {
      expect(definitionToJsonSchema({ type: 'array', items: { type: 'string' } })).toEqual({
        type: 'array',
        items: { type: 'string' },
      });
    });

    it('converts enum type', () => {
      expect(definitionToJsonSchema({ type: 'enum', values: ['a', 'b', 'c'] })).toEqual({
        enum: ['a', 'b', 'c'],
      });
    });

    it('converts literal type', () => {
      expect(definitionToJsonSchema({ type: 'literal', value: 'hello' })).toEqual({
        const: 'hello',
      });
      expect(definitionToJsonSchema({ type: 'literal', value: 42 })).toEqual({
        const: 42,
      });
      expect(definitionToJsonSchema({ type: 'literal', value: true })).toEqual({
        const: true,
      });
    });

    it('converts union type', () => {
      const def: SchemaDefinition = {
        type: 'union',
        variants: [{ type: 'string' }, { type: 'number' }],
      };
      expect(definitionToJsonSchema(def)).toEqual({
        anyOf: [{ type: 'string' }, { type: 'number' }],
      });
    });

    it('converts nested objects', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'user',
            required: true,
            nullable: false,
            schema: {
              type: 'object',
              properties: [
                { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
                { name: 'email', required: false, nullable: false, schema: { type: 'string' } },
              ],
            },
          },
        ],
      };
      const result = definitionToJsonSchema(def) as JSONSchema.JSONSchema;
      const userProp = (result.properties as Record<string, JSONSchema.JSONSchema>).user;
      expect(userProp?.type).toBe('object');
      expect(userProp?.properties).toEqual({
        name: { type: 'string' },
        email: { type: 'string' },
      });
      expect(userProp?.required).toEqual(['name']);
    });

    it('converts array of objects', () => {
      const def: SchemaDefinition = {
        type: 'array',
        items: {
          type: 'object',
          properties: [{ name: 'id', required: true, nullable: false, schema: { type: 'number' } }],
        },
      };
      const result = definitionToJsonSchema(def) as JSONSchema.JSONSchema;
      expect(result.type).toBe('array');
      const items = result.items as JSONSchema.JSONSchema;
      expect(items.type).toBe('object');
    });
  });

  // -------------------------------------------------------------------------
  // jsonSchemaToDefinition
  // -------------------------------------------------------------------------
  describe('jsonSchemaToDefinition', () => {
    it('converts primitive types', () => {
      expect(jsonSchemaToDefinition({ type: 'string' })).toEqual({ type: 'string' });
      expect(jsonSchemaToDefinition({ type: 'number' })).toEqual({ type: 'number' });
      expect(jsonSchemaToDefinition({ type: 'integer' })).toEqual({ type: 'number' });
      expect(jsonSchemaToDefinition({ type: 'boolean' })).toEqual({ type: 'boolean' });
      expect(jsonSchemaToDefinition({ type: 'null' })).toEqual({ type: 'null' });
    });

    it('converts object with properties', () => {
      const schema: JSONSchema.JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };
      const result = jsonSchemaToDefinition(schema);
      expect(result.type).toBe('object');
      if (result.type === 'object') {
        expect(result.properties).toHaveLength(2);
        expect(result.properties[0]).toEqual({
          name: 'name',
          required: true,
          nullable: false,
          schema: { type: 'string' },
        });
        expect(result.properties[1]).toEqual({
          name: 'age',
          required: false,
          nullable: false,
          schema: { type: 'number' },
        });
      }
    });

    it('detects nullable properties', () => {
      const schema: JSONSchema.JSONSchema = {
        type: 'object',
        properties: {
          value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['value'],
      };
      const result = jsonSchemaToDefinition(schema);
      if (result.type === 'object') {
        expect(result.properties[0]?.nullable).toBe(true);
        expect(result.properties[0]?.schema).toEqual({ type: 'string' });
      }
    });

    it('converts enum', () => {
      expect(jsonSchemaToDefinition({ enum: ['a', 'b'] })).toEqual({
        type: 'enum',
        values: ['a', 'b'],
      });
    });

    it('converts const', () => {
      expect(jsonSchemaToDefinition({ const: 'hello' })).toEqual({
        type: 'literal',
        value: 'hello',
      });
    });

    it('converts union (anyOf)', () => {
      const schema: JSONSchema.JSONSchema = {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      };
      const result = jsonSchemaToDefinition(schema);
      expect(result.type).toBe('union');
      if (result.type === 'union') {
        expect(result.variants).toHaveLength(2);
      }
    });

    it('converts array', () => {
      const schema: JSONSchema.JSONSchema = {
        type: 'array',
        items: { type: 'number' },
      };
      const result = jsonSchemaToDefinition(schema);
      expect(result).toEqual({ type: 'array', items: { type: 'number' } });
    });

    it('handles boolean schemas', () => {
      expect(jsonSchemaToDefinition(true)).toEqual({ type: 'string' });
      expect(jsonSchemaToDefinition(false)).toEqual({ type: 'string' });
    });
  });

  // -------------------------------------------------------------------------
  // Round-trip tests
  // -------------------------------------------------------------------------
  describe('round-trip (definition → JSON Schema → definition)', () => {
    it('round-trips string', () => {
      expect(roundTrip({ type: 'string' })).toEqual({ type: 'string' });
    });

    it('round-trips number', () => {
      expect(roundTrip({ type: 'number' })).toEqual({ type: 'number' });
    });

    it('round-trips object with properties', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'count', required: false, nullable: false, schema: { type: 'number' } },
        ],
      };
      expect(roundTrip(def)).toEqual(def);
    });

    it('round-trips nullable property', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [{ name: 'value', required: true, nullable: true, schema: { type: 'string' } }],
      };
      expect(roundTrip(def)).toEqual(def);
    });

    it('round-trips array', () => {
      const def: SchemaDefinition = {
        type: 'array',
        items: { type: 'number' },
      };
      expect(roundTrip(def)).toEqual(def);
    });

    it('round-trips enum', () => {
      const def: SchemaDefinition = {
        type: 'enum',
        values: ['a', 'b', 'c'],
      };
      expect(roundTrip(def)).toEqual(def);
    });

    it('round-trips literal', () => {
      expect(roundTrip({ type: 'literal', value: 'hi' })).toEqual({
        type: 'literal',
        value: 'hi',
      });
      expect(roundTrip({ type: 'literal', value: 42 })).toEqual({
        type: 'literal',
        value: 42,
      });
    });

    it('round-trips union', () => {
      const def: SchemaDefinition = {
        type: 'union',
        variants: [{ type: 'string' }, { type: 'boolean' }],
      };
      expect(roundTrip(def)).toEqual(def);
    });

    it('round-trips nested object', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'user',
            required: true,
            nullable: false,
            schema: {
              type: 'object',
              properties: [
                { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
              ],
            },
          },
        ],
      };
      expect(roundTrip(def)).toEqual(def);
    });
  });

  // -------------------------------------------------------------------------
  // Compatibility with isJsonSchemaSubset
  // -------------------------------------------------------------------------
  describe('compatibility with isJsonSchemaSubset', () => {
    it('built schema is a subset of itself', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
        ],
      };
      const schema = definitionToJsonSchema(def);
      expect(isJsonSchemaSubset(schema, schema)).toBe(true);
    });

    it('superset object is valid subset target', () => {
      const defA: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
          { name: 'email', required: true, nullable: false, schema: { type: 'string' } },
        ],
      };
      const defB: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
        ],
      };
      expect(isJsonSchemaSubset(definitionToJsonSchema(defA), definitionToJsonSchema(defB))).toBe(
        true,
      );
    });

    it('missing required property fails subset check', () => {
      const defA: SchemaDefinition = {
        type: 'object',
        properties: [{ name: 'name', required: true, nullable: false, schema: { type: 'string' } }],
      };
      const defB: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
        ],
      };
      expect(isJsonSchemaSubset(definitionToJsonSchema(defA), definitionToJsonSchema(defB))).toBe(
        false,
      );
    });

    it('optional property missing in source is valid', () => {
      const defA: SchemaDefinition = {
        type: 'object',
        properties: [{ name: 'name', required: true, nullable: false, schema: { type: 'string' } }],
      };
      const defB: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: false, nullable: false, schema: { type: 'number' } },
        ],
      };
      expect(isJsonSchemaSubset(definitionToJsonSchema(defA), definitionToJsonSchema(defB))).toBe(
        true,
      );
    });

    it('required vs optional property fails subset', () => {
      const defA: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'value', required: false, nullable: false, schema: { type: 'string' } },
        ],
      };
      const defB: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'value', required: true, nullable: false, schema: { type: 'string' } },
        ],
      };
      expect(isJsonSchemaSubset(definitionToJsonSchema(defA), definitionToJsonSchema(defB))).toBe(
        false,
      );
    });

    it('nullable target accepts non-nullable source', () => {
      const defA: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'value', required: true, nullable: false, schema: { type: 'string' } },
        ],
      };
      const defB: SchemaDefinition = {
        type: 'object',
        properties: [{ name: 'value', required: true, nullable: true, schema: { type: 'string' } }],
      };
      expect(isJsonSchemaSubset(definitionToJsonSchema(defA), definitionToJsonSchema(defB))).toBe(
        true,
      );
    });

    it('built schema works with Zod-generated schemas', () => {
      const zodSchema = z.toJSONSchema(z.object({ name: z.string(), age: z.number() }));
      const builtDef: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
          { name: 'email', required: true, nullable: false, schema: { type: 'string' } },
        ],
      };
      const builtSchema = definitionToJsonSchema(builtDef);
      // A superset of properties should be a valid subset target
      expect(isJsonSchemaSubset(builtSchema, zodSchema)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Compatibility with jsonSchemaToTypeString
  // -------------------------------------------------------------------------
  describe('compatibility with jsonSchemaToTypeString', () => {
    it('produces valid type string for simple object', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          { name: 'age', required: false, nullable: false, schema: { type: 'number' } },
        ],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain(NAME_STRING);
      expect(ts).toContain('age?: number');
    });

    it('produces valid type string for nullable property', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [{ name: 'value', required: true, nullable: true, schema: { type: 'string' } }],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain('string | null');
    });

    it('produces valid type string for array property', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'tags',
            required: true,
            nullable: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain('tags: string[]');
    });

    it('produces valid type string for enum property', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'status',
            required: true,
            nullable: false,
            schema: { type: 'enum', values: ['active', 'inactive'] },
          },
        ],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain('"active" | "inactive"');
    });

    it('produces valid type string for literal property', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'kind',
            required: true,
            nullable: false,
            schema: { type: 'literal', value: 'user' },
          },
        ],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain('"user"');
    });

    it('produces valid type string for union property', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'data',
            required: true,
            nullable: false,
            schema: {
              type: 'union',
              variants: [{ type: 'string' }, { type: 'number' }],
            },
          },
        ],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain('string | number');
    });

    it('produces valid type string for nested object', () => {
      const def: SchemaDefinition = {
        type: 'object',
        properties: [
          {
            name: 'user',
            required: true,
            nullable: false,
            schema: {
              type: 'object',
              properties: [
                { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
              ],
            },
          },
        ],
      };
      const ts = jsonSchemaToTypeString(definitionToJsonSchema(def));
      expect(ts).toContain('user:');
      expect(ts).toContain(NAME_STRING);
    });
  });

  // -------------------------------------------------------------------------
  // Default helpers
  // -------------------------------------------------------------------------
  describe('createDefaultDefinition', () => {
    it('creates correct defaults for all types', () => {
      expect(createDefaultDefinition('string')).toEqual({ type: 'string' });
      expect(createDefaultDefinition('number')).toEqual({ type: 'number' });
      expect(createDefaultDefinition('boolean')).toEqual({ type: 'boolean' });
      expect(createDefaultDefinition('null')).toEqual({ type: 'null' });
      expect(createDefaultDefinition('object')).toEqual({ type: 'object', properties: [] });
      expect(createDefaultDefinition('array')).toEqual({
        type: 'array',
        items: { type: 'string' },
      });
      expect(createDefaultDefinition('enum')).toEqual({ type: 'enum', values: ['value1'] });
      expect(createDefaultDefinition('literal')).toEqual({ type: 'literal', value: '' });
      expect(createDefaultDefinition('union')).toEqual({
        type: 'union',
        variants: [{ type: 'string' }, { type: 'number' }],
      });
    });
  });

  describe('createDefaultProperty', () => {
    it('creates a required, non-nullable string property', () => {
      const prop = createDefaultProperty('test');
      expect(prop).toEqual({
        name: 'test',
        required: true,
        nullable: false,
        schema: { type: 'string' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Zod → JSON Schema → SchemaDefinition → JSON Schema round-trip
  //
  // These tests start from a Zod schema, convert through the full pipeline:
  //   Zod → z.toJSONSchema() → jsonSchemaToDefinition() → definitionToJsonSchema()
  // Then verify the result is compatible via isJsonSchemaSubset and
  // jsonSchemaToTypeString (where applicable).
  // -------------------------------------------------------------------------
  describe('Zod round-trip: Zod → JSON Schema → Definition → JSON Schema', () => {
    /**
     * Helper: takes a Zod schema, converts to JSON Schema, converts to
     * SchemaDefinition, converts back to JSON Schema, and returns both
     * the original and rebuilt JSON Schemas for comparison.
     */
    const zodRoundTrip = (zodSchema: z.ZodType) => {
      const originalJsonSchema = z.toJSONSchema(zodSchema);
      const definition = jsonSchemaToDefinition(originalJsonSchema);
      const rebuiltJsonSchema = definitionToJsonSchema(definition);
      return { originalJsonSchema, definition, rebuiltJsonSchema };
    };

    // --- Primitive types ---

    describe('primitive types', () => {
      it('round-trips z.string()', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.string());
        expect(rebuiltJsonSchema).toEqual({ type: 'string' });
      });

      it('round-trips z.number()', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.number());
        expect(rebuiltJsonSchema).toEqual({ type: 'number' });
      });

      it('round-trips z.boolean()', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.boolean());
        expect(rebuiltJsonSchema).toEqual({ type: 'boolean' });
      });

      it('round-trips z.null()', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.null());
        expect(rebuiltJsonSchema).toEqual({ type: 'null' });
      });

      it('round-trips z.int() as number (integer → number)', () => {
        // Zod emits { type: "integer", minimum: ..., maximum: ... }
        // Our definition normalizes integer → number
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.int());
        expect(definition.type).toBe('number');
        expect(rebuiltJsonSchema).toEqual({ type: 'number' });
      });
    });

    // --- String constraints (extra fields are stripped but type is preserved) ---

    describe('string with constraints', () => {
      it('preserves string type with min/max checks', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.string().min(1).max(100));
        expect(definition.type).toBe('string');
        expect(rebuiltJsonSchema).toEqual({ type: 'string' });
        // Constraints like minLength/maxLength are not modeled by the builder,
        // but the type itself survives the round-trip
      });

      it('preserves string type from z.email()', () => {
        const { definition } = zodRoundTrip(z.email());
        expect(definition.type).toBe('string');
      });

      it('preserves string type from z.uuid()', () => {
        const { definition } = zodRoundTrip(z.uuid());
        expect(definition.type).toBe('string');
      });

      it('preserves string type from z.url()', () => {
        const { definition } = zodRoundTrip(z.url());
        expect(definition.type).toBe('string');
      });
    });

    // --- Number constraints ---

    describe('number with constraints', () => {
      it('preserves number type with min/max', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.number().min(0).max(100));
        expect(definition.type).toBe('number');
        expect(rebuiltJsonSchema).toEqual({ type: 'number' });
      });
    });

    // --- Literal types ---

    describe('literal types', () => {
      it('round-trips z.literal(string)', () => {
        // Zod emits { type: "string", const: "hello" }, const takes priority
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.literal('hello'));
        expect(definition).toEqual({ type: 'literal', value: 'hello' });
        expect(rebuiltJsonSchema).toEqual({ const: 'hello' });
      });

      it('round-trips z.literal(number)', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.literal(42));
        expect(definition).toEqual({ type: 'literal', value: 42 });
        expect(rebuiltJsonSchema).toEqual({ const: 42 });
      });

      it('round-trips z.literal(boolean)', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.literal(true));
        expect(definition).toEqual({ type: 'literal', value: true });
        expect(rebuiltJsonSchema).toEqual({ const: true });
      });
    });

    // --- Enum types ---

    describe('enum types', () => {
      it('round-trips z.enum()', () => {
        // Zod emits { type: "string", enum: ["a","b","c"] }, enum takes priority
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.enum(['a', 'b', 'c']));
        expect(definition).toEqual({ type: 'enum', values: ['a', 'b', 'c'] });
        expect(rebuiltJsonSchema).toEqual({ enum: ['a', 'b', 'c'] });
      });

      it('round-trips single-value enum', () => {
        const { definition } = zodRoundTrip(z.enum(['only']));
        expect(definition).toEqual({ type: 'enum', values: ['only'] });
      });
    });

    // --- Nullable types ---

    describe('nullable types', () => {
      it('round-trips z.string().nullable() as union', () => {
        // Zod emits { anyOf: [{ type: "string" }, { type: "null" }] }
        // Standalone nullable is unwrapped by jsonSchemaToDefinition
        const { definition } = zodRoundTrip(z.string().nullable());
        // As a standalone (non-property) schema, nullable unwraps to inner type
        expect(definition.type).toBe('string');
      });

      it('round-trips z.number().nullable()', () => {
        const { definition } = zodRoundTrip(z.number().nullable());
        expect(definition.type).toBe('number');
      });
    });

    // --- Union types ---

    describe('union types', () => {
      it('round-trips z.union([string, number])', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.union([z.string(), z.number()]));
        expect(definition).toEqual({
          type: 'union',
          variants: [{ type: 'string' }, { type: 'number' }],
        });
        expect(rebuiltJsonSchema).toEqual({
          anyOf: [{ type: 'string' }, { type: 'number' }],
        });
      });

      it('round-trips z.union([string, number, boolean])', () => {
        const { definition } = zodRoundTrip(z.union([z.string(), z.number(), z.boolean()]));
        expect(definition.type).toBe('union');
        if (definition.type === 'union') {
          expect(definition.variants).toHaveLength(3);
          expect(definition.variants.map((v) => v.type)).toEqual(['string', 'number', 'boolean']);
        }
      });

      it('rebuilt union is subset-compatible with original', () => {
        const zodSchema = z.union([z.string(), z.number()]);
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        // Rebuilt schema is subset of original
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
        // Original is subset of rebuilt
        expect(isJsonSchemaSubset(originalJsonSchema, rebuiltJsonSchema)).toBe(true);
      });
    });

    // --- Array types ---

    describe('array types', () => {
      it('round-trips z.array(z.string())', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.array(z.string()));
        expect(definition).toEqual({ type: 'array', items: { type: 'string' } });
        expect(rebuiltJsonSchema).toEqual({
          type: 'array',
          items: { type: 'string' },
        });
      });

      it('round-trips z.array(z.number())', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.array(z.number()));
        expect(rebuiltJsonSchema).toEqual({
          type: 'array',
          items: { type: 'number' },
        });
      });

      it('round-trips nested arrays z.array(z.array(z.string()))', () => {
        const { definition } = zodRoundTrip(z.array(z.array(z.string())));
        expect(definition).toEqual({
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
        });
      });

      it('round-trips z.array(z.union(...))', () => {
        const { definition } = zodRoundTrip(z.array(z.union([z.string(), z.number()])));
        expect(definition).toEqual({
          type: 'array',
          items: {
            type: 'union',
            variants: [{ type: 'string' }, { type: 'number' }],
          },
        });
      });

      it('rebuilt array is subset-compatible with original', () => {
        const zodSchema = z.array(z.string());
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
      });
    });

    // --- Simple object types ---

    describe('simple object types', () => {
      it('round-trips z.object({ name: z.string() })', () => {
        const { definition, rebuiltJsonSchema } = zodRoundTrip(z.object({ name: z.string() }));
        expect(definition).toEqual({
          type: 'object',
          properties: [
            { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
          ],
        });
        const rebuilt = rebuiltJsonSchema as JSONSchema.JSONSchema;
        expect(rebuilt.type).toBe('object');
        expect(rebuilt.required).toEqual(['name']);
      });

      it('round-trips object with multiple properties', () => {
        const { definition } = zodRoundTrip(
          z.object({
            name: z.string(),
            age: z.number(),
            active: z.boolean(),
          }),
        );
        expect(definition.type).toBe('object');
        if (definition.type === 'object') {
          expect(definition.properties).toHaveLength(3);
          expect(definition.properties.map((p) => p.name)).toEqual(['name', 'age', 'active']);
          expect(definition.properties.every((p) => p.required)).toBe(true);
          expect(definition.properties.every((p) => !p.nullable)).toBe(true);
        }
      });

      it('rebuilt object is subset-compatible with Zod original', () => {
        const zodSchema = z.object({ name: z.string(), age: z.number() });
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
        expect(isJsonSchemaSubset(originalJsonSchema, rebuiltJsonSchema)).toBe(true);
      });

      it('rebuilt object produces valid type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.object({ name: z.string(), age: z.number() }));
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain(NAME_STRING);
        expect(ts).toContain('age: number');
      });
    });

    // --- Object with optional properties ---

    describe('object with optional properties', () => {
      it('round-trips optional properties', () => {
        const { definition } = zodRoundTrip(
          z.object({
            name: z.string(),
            age: z.number().optional(),
          }),
        );
        if (definition.type === 'object') {
          const nameProp = definition.properties.find((p) => p.name === 'name');
          const ageProp = definition.properties.find((p) => p.name === 'age');
          expect(nameProp?.required).toBe(true);
          expect(ageProp?.required).toBe(false);
        }
      });

      it('rebuilt schema with optional matches Zod output', () => {
        const zodSchema = z.object({
          name: z.string(),
          email: z.string().optional(),
        });
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
        expect(isJsonSchemaSubset(originalJsonSchema, rebuiltJsonSchema)).toBe(true);
      });

      it('produces correct type string for optional', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(
          z.object({ name: z.string(), age: z.number().optional() }),
        );
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain(NAME_STRING);
        expect(ts).toContain('age?: number');
      });
    });

    // --- Object with nullable properties ---

    describe('object with nullable properties', () => {
      it('round-trips nullable properties', () => {
        const { definition } = zodRoundTrip(
          z.object({
            name: z.string(),
            bio: z.string().nullable(),
          }),
        );
        if (definition.type === 'object') {
          const nameProp = definition.properties.find((p) => p.name === 'name');
          const bioProp = definition.properties.find((p) => p.name === 'bio');
          expect(nameProp?.nullable).toBe(false);
          expect(bioProp?.nullable).toBe(true);
          expect(bioProp?.required).toBe(true);
          expect(bioProp?.schema).toEqual({ type: 'string' });
        }
      });

      it('rebuilds nullable property as anyOf with null', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.object({ value: z.string().nullable() }));
        const rebuilt = rebuiltJsonSchema as JSONSchema.JSONSchema;
        const valueProp = (rebuilt.properties as Record<string, JSONSchema.JSONSchema>).value!;
        expect(valueProp.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
      });

      it('nullable property produces correct type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.object({ value: z.string().nullable() }));
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('string | null');
      });

      it('rebuilt nullable is subset-compatible with Zod original', () => {
        const zodSchema = z.object({
          name: z.string(),
          active: z.boolean().nullable(),
        });
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
      });
    });

    // --- Object with nullable + optional properties ---

    describe('object with nullable + optional properties', () => {
      it('round-trips nullable optional properties', () => {
        const { definition } = zodRoundTrip(
          z.object({
            name: z.string(),
            bio: z.string().nullable().optional(),
          }),
        );
        if (definition.type === 'object') {
          const bioProp = definition.properties.find((p) => p.name === 'bio');
          expect(bioProp?.required).toBe(false);
          expect(bioProp?.nullable).toBe(true);
          expect(bioProp?.schema).toEqual({ type: 'string' });
        }
      });

      it('round-trips complex mix of optional and nullable', () => {
        const { definition } = zodRoundTrip(
          z.object({
            name: z.string(),
            bio: z.string().nullable().optional(),
            age: z.number().optional(),
            active: z.boolean().nullable(),
          }),
        );
        if (definition.type === 'object') {
          const nameP = definition.properties.find((p) => p.name === 'name')!;
          const bioP = definition.properties.find((p) => p.name === 'bio')!;
          const ageP = definition.properties.find((p) => p.name === 'age')!;
          const activeP = definition.properties.find((p) => p.name === 'active')!;

          expect(nameP.required).toBe(true);
          expect(nameP.nullable).toBe(false);

          expect(bioP.required).toBe(false);
          expect(bioP.nullable).toBe(true);

          expect(ageP.required).toBe(false);
          expect(ageP.nullable).toBe(false);

          expect(activeP.required).toBe(true);
          expect(activeP.nullable).toBe(true);
        }
      });

      it('rebuilt schema is subset-compatible with Zod original', () => {
        const zodSchema = z.object({
          name: z.string(),
          bio: z.string().nullable().optional(),
          age: z.number().optional(),
        });
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
      });
    });

    // --- Nested objects ---

    describe('nested objects', () => {
      it('round-trips z.object({ user: z.object({ name: z.string() }) })', () => {
        const { definition } = zodRoundTrip(
          z.object({
            user: z.object({
              name: z.string(),
              email: z.string().optional(),
            }),
          }),
        );
        if (definition.type === 'object') {
          const userProp = definition.properties.find((p) => p.name === 'user')!;
          expect(userProp.schema.type).toBe('object');
          if (userProp.schema.type === 'object') {
            expect(userProp.schema.properties).toHaveLength(2);
            const nameProp = userProp.schema.properties.find((p) => p.name === 'name')!;
            const emailProp = userProp.schema.properties.find((p) => p.name === 'email')!;
            expect(nameProp.required).toBe(true);
            expect(emailProp.required).toBe(false);
          }
        }
      });

      it('round-trips deeply nested objects (3 levels)', () => {
        const { definition } = zodRoundTrip(
          z.object({
            level1: z.object({
              level2: z.object({
                value: z.string(),
              }),
            }),
          }),
        );
        if (definition.type === 'object') {
          const l1 = definition.properties[0]!;
          expect(l1.name).toBe('level1');
          if (l1.schema.type === 'object') {
            const l2 = l1.schema.properties[0]!;
            expect(l2.name).toBe('level2');
            if (l2.schema.type === 'object') {
              expect(l2.schema.properties[0]!.name).toBe('value');
              expect(l2.schema.properties[0]!.schema.type).toBe('string');
            }
          }
        }
      });

      it('rebuilt nested object is subset-compatible', () => {
        const zodSchema = z.object({
          user: z.object({ name: z.string() }),
        });
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
      });

      it('rebuilt nested object produces valid type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(
          z.object({
            user: z.object({ name: z.string() }),
          }),
        );
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('user:');
        expect(ts).toContain(NAME_STRING);
      });
    });

    // --- Array of objects ---

    describe('array of objects', () => {
      it('round-trips z.array(z.object(...))', () => {
        const { definition } = zodRoundTrip(
          z.array(z.object({ id: z.number(), name: z.string() })),
        );
        expect(definition.type).toBe('array');
        if (definition.type === 'array') {
          expect(definition.items.type).toBe('object');
          if (definition.items.type === 'object') {
            expect(definition.items.properties).toHaveLength(2);
          }
        }
      });

      it('rebuilt array of objects is subset-compatible', () => {
        const zodSchema = z.array(z.object({ id: z.number(), name: z.string() }));
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
      });
    });

    // --- Object with array properties ---

    describe('object with array properties', () => {
      it('round-trips object with array of strings', () => {
        const { definition } = zodRoundTrip(
          z.object({
            name: z.string(),
            tags: z.array(z.string()),
          }),
        );
        if (definition.type === 'object') {
          const tagsProp = definition.properties.find((p) => p.name === 'tags')!;
          expect(tagsProp.schema).toEqual({ type: 'array', items: { type: 'string' } });
        }
      });

      it('round-trips object with array of objects', () => {
        const { definition } = zodRoundTrip(
          z.object({
            users: z.array(
              z.object({
                name: z.string(),
                age: z.number(),
              }),
            ),
          }),
        );
        if (definition.type === 'object') {
          const usersProp = definition.properties.find((p) => p.name === 'users')!;
          expect(usersProp.schema.type).toBe('array');
          if (usersProp.schema.type === 'array') {
            expect(usersProp.schema.items.type).toBe('object');
          }
        }
      });

      it('rebuilt is subset-compatible', () => {
        const zodSchema = z.object({
          name: z.string(),
          tags: z.array(z.string()),
        });
        const { originalJsonSchema, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(isJsonSchemaSubset(rebuiltJsonSchema, originalJsonSchema)).toBe(true);
      });

      it('produces correct type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(z.object({ tags: z.array(z.string()) }));
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('tags: string[]');
      });
    });

    // --- Object with enum/literal properties ---

    describe('object with enum and literal properties', () => {
      it('round-trips object with enum property', () => {
        const { definition } = zodRoundTrip(
          z.object({
            status: z.enum(['active', 'inactive', 'pending']),
          }),
        );
        if (definition.type === 'object') {
          const statusProp = definition.properties.find((p) => p.name === 'status')!;
          expect(statusProp.schema).toEqual({
            type: 'enum',
            values: ['active', 'inactive', 'pending'],
          });
        }
      });

      it('round-trips object with literal property', () => {
        const { definition } = zodRoundTrip(
          z.object({
            type: z.literal('user'),
          }),
        );
        if (definition.type === 'object') {
          const typeProp = definition.properties.find((p) => p.name === 'type')!;
          expect(typeProp.schema).toEqual({ type: 'literal', value: 'user' });
        }
      });

      it('enum property produces correct type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(
          z.object({ status: z.enum(['active', 'inactive']) }),
        );
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('"active" | "inactive"');
      });
    });

    // --- Object with union properties ---

    describe('object with union properties', () => {
      it('round-trips object with union property', () => {
        const { definition } = zodRoundTrip(
          z.object({
            data: z.union([z.string(), z.number()]),
          }),
        );
        if (definition.type === 'object') {
          const dataProp = definition.properties.find((p) => p.name === 'data')!;
          expect(dataProp.schema).toEqual({
            type: 'union',
            variants: [{ type: 'string' }, { type: 'number' }],
          });
        }
      });

      it('union property produces correct type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(
          z.object({ data: z.union([z.string(), z.number()]) }),
        );
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('string | number');
      });
    });

    // --- Discriminated unions ---

    describe('discriminated unions', () => {
      it('round-trips discriminated union via oneOf', () => {
        const { definition } = zodRoundTrip(
          z.discriminatedUnion('type', [
            z.object({ type: z.literal('text'), content: z.string() }),
            z.object({ type: z.literal('image'), url: z.string() }),
          ]),
        );
        // Zod emits oneOf for discriminated unions; our converter treats it like anyOf
        expect(definition.type).toBe('union');
        if (definition.type === 'union') {
          expect(definition.variants).toHaveLength(2);
          expect(definition.variants[0]!.type).toBe('object');
          expect(definition.variants[1]!.type).toBe('object');

          // Verify inner object structure
          if (definition.variants[0]!.type === 'object') {
            const typeProp = definition.variants[0]!.properties.find((p) => p.name === 'type')!;
            expect(typeProp.schema).toEqual({ type: 'literal', value: 'text' });
          }
        }
      });

      it('rebuilt discriminated union produces correct type string', () => {
        const { rebuiltJsonSchema } = zodRoundTrip(
          z.discriminatedUnion('type', [
            z.object({ type: z.literal('a'), value: z.string() }),
            z.object({ type: z.literal('b'), count: z.number() }),
          ]),
        );
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        // Should contain both variants
        expect(ts).toContain('"a"');
        expect(ts).toContain('"b"');
        expect(ts).toContain('value: string');
        expect(ts).toContain('count: number');
      });
    });

    // --- Complex real-world schemas ---

    describe('complex real-world schemas', () => {
      it('round-trips API response shape', () => {
        const zodSchema = z.object({
          success: z.boolean(),
          data: z.object({
            users: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                email: z.string().optional(),
                role: z.enum(['admin', 'user', 'guest']),
                tags: z.array(z.string()),
              }),
            ),
            total: z.number(),
            page: z.number().optional(),
          }),
          error: z.string().nullable().optional(),
        });

        const { definition, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(definition.type).toBe('object');

        if (definition.type === 'object') {
          // Top-level properties
          expect(definition.properties.map((p) => p.name)).toEqual(['success', 'data', 'error']);

          const errorProp = definition.properties.find((p) => p.name === 'error')!;
          expect(errorProp.required).toBe(false);
          expect(errorProp.nullable).toBe(true);
          expect(errorProp.schema.type).toBe('string');

          // Nested data.users[].role is enum
          const dataProp = definition.properties.find((p) => p.name === 'data')!;
          if (dataProp.schema.type === 'object') {
            const usersProp = dataProp.schema.properties.find((p) => p.name === 'users')!;
            if (usersProp.schema.type === 'array' && usersProp.schema.items.type === 'object') {
              const roleProp = usersProp.schema.items.properties.find((p) => p.name === 'role')!;
              expect(roleProp.schema).toEqual({
                type: 'enum',
                values: ['admin', 'user', 'guest'],
              });
            }
          }
        }

        // Type string output should contain all fields
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('success: boolean');
        expect(ts).toContain('"admin" | "user" | "guest"');
      });

      it('round-trips event payload with discriminated union', () => {
        const zodSchema = z.object({
          timestamp: z.number(),
          event: z.discriminatedUnion('kind', [
            z.object({
              kind: z.literal('click'),
              x: z.number(),
              y: z.number(),
            }),
            z.object({
              kind: z.literal('keypress'),
              key: z.string(),
              modifiers: z.array(z.enum(['ctrl', 'alt', 'shift'])),
            }),
          ]),
        });

        const { definition } = zodRoundTrip(zodSchema);
        if (definition.type === 'object') {
          const eventProp = definition.properties.find((p) => p.name === 'event')!;
          expect(eventProp.schema.type).toBe('union');
          if (eventProp.schema.type === 'union') {
            expect(eventProp.schema.variants).toHaveLength(2);
            // Each variant should be an object
            for (const variant of eventProp.schema.variants) {
              expect(variant.type).toBe('object');
            }
          }
        }
      });

      it('round-trips config schema with mixed optional/nullable/nested', () => {
        const zodSchema = z.object({
          database: z.object({
            host: z.string(),
            port: z.number(),
            name: z.string(),
            ssl: z.boolean().optional(),
            credentials: z
              .object({
                username: z.string(),
                password: z.string().nullable(),
              })
              .optional(),
          }),
          features: z.array(z.string()),
          metadata: z.object({
            version: z.literal('v2'),
            environment: z.enum(['dev', 'staging', 'prod']),
          }),
        });

        const { definition, rebuiltJsonSchema } = zodRoundTrip(zodSchema);
        expect(definition.type).toBe('object');

        if (definition.type === 'object') {
          expect(definition.properties.map((p) => p.name)).toEqual([
            'database',
            'features',
            'metadata',
          ]);

          // Check deeply nested credentials
          const dbProp = definition.properties.find((p) => p.name === 'database')!;
          if (dbProp.schema.type === 'object') {
            const credsProp = dbProp.schema.properties.find((p) => p.name === 'credentials')!;
            expect(credsProp.required).toBe(false);
            if (credsProp.schema.type === 'object') {
              const pwProp = credsProp.schema.properties.find((p) => p.name === 'password')!;
              expect(pwProp.nullable).toBe(true);
              expect(pwProp.schema.type).toBe('string');
            }
          }

          // Check metadata literal + enum
          const metaProp = definition.properties.find((p) => p.name === 'metadata')!;
          if (metaProp.schema.type === 'object') {
            const versionProp = metaProp.schema.properties.find((p) => p.name === 'version')!;
            expect(versionProp.schema).toEqual({ type: 'literal', value: 'v2' });
            const envProp = metaProp.schema.properties.find((p) => p.name === 'environment')!;
            expect(envProp.schema).toEqual({
              type: 'enum',
              values: ['dev', 'staging', 'prod'],
            });
          }
        }

        // Type string should contain key fields
        const ts = jsonSchemaToTypeString(rebuiltJsonSchema);
        expect(ts).toContain('host: string');
        expect(ts).toContain('"v2"');
        expect(ts).toContain('"dev" | "staging" | "prod"');
      });
    });

    // --- Cross-compatibility: builder output vs Zod output ---

    describe('cross-compatibility with Zod-generated schemas', () => {
      it('built schema is a valid subset of matching Zod schema', () => {
        // Build a schema manually through definitions
        const builtDef: SchemaDefinition = {
          type: 'object',
          properties: [
            { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
            { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
          ],
        };
        const builtSchema = definitionToJsonSchema(builtDef);

        // Create equivalent with Zod
        const zodSchema = z.toJSONSchema(z.object({ name: z.string(), age: z.number() }));

        // They should be mutually compatible via subset check
        expect(isJsonSchemaSubset(builtSchema, zodSchema)).toBe(true);
        expect(isJsonSchemaSubset(zodSchema, builtSchema)).toBe(true);
      });

      it('built schema with optional matches Zod optional', () => {
        const builtDef: SchemaDefinition = {
          type: 'object',
          properties: [
            { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
            { name: 'age', required: false, nullable: false, schema: { type: 'number' } },
          ],
        };
        const builtSchema = definitionToJsonSchema(builtDef);
        const zodSchema = z.toJSONSchema(
          z.object({ name: z.string(), age: z.number().optional() }),
        );
        expect(isJsonSchemaSubset(builtSchema, zodSchema)).toBe(true);
        expect(isJsonSchemaSubset(zodSchema, builtSchema)).toBe(true);
      });

      it('built schema with nullable matches Zod nullable', () => {
        const builtDef: SchemaDefinition = {
          type: 'object',
          properties: [
            { name: 'value', required: true, nullable: true, schema: { type: 'string' } },
          ],
        };
        const builtSchema = definitionToJsonSchema(builtDef);
        const zodSchema = z.toJSONSchema(z.object({ value: z.string().nullable() }));
        expect(isJsonSchemaSubset(builtSchema, zodSchema)).toBe(true);
        expect(isJsonSchemaSubset(zodSchema, builtSchema)).toBe(true);
      });

      it('Zod superset schema accepts built subset', () => {
        const builtDef: SchemaDefinition = {
          type: 'object',
          properties: [
            { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
            { name: 'age', required: true, nullable: false, schema: { type: 'number' } },
          ],
        };
        const builtSchema = definitionToJsonSchema(builtDef);

        // Zod schema only requires 'name', built provides name + age
        const zodSchema = z.toJSONSchema(z.object({ name: z.string() }));
        expect(isJsonSchemaSubset(builtSchema, zodSchema)).toBe(true);
      });

      it('built schema produces same type string as Zod equivalent', () => {
        const builtDef: SchemaDefinition = {
          type: 'object',
          properties: [
            { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
            { name: 'count', required: false, nullable: false, schema: { type: 'number' } },
          ],
        };
        const builtTs = jsonSchemaToTypeString(definitionToJsonSchema(builtDef));
        const zodTs = jsonSchemaToTypeString(
          z.toJSONSchema(z.object({ name: z.string(), count: z.number().optional() })),
        );

        // Both should contain the same property signatures
        expect(builtTs).toContain(NAME_STRING);
        expect(builtTs).toContain('count?: number');
        expect(zodTs).toContain(NAME_STRING);
        expect(zodTs).toContain('count?: number');
      });
    });
  });
});
