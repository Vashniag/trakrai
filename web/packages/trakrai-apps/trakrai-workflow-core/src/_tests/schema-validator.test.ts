/* eslint-disable no-magic-numbers */
import { describe, expect, it } from 'vitest';
import { z, type ZodTypeAny } from 'zod';

import type { JSONSchema } from 'zod/v4/core';

import { isJsonSchemaSubset } from '../core/schema/schema-validator';

const TEST_DESCRIPTION = 'should return $expected when $description';

describe('isJsonSchemaSubset', () => {
  describe('boolean schemas', () => {
    const booleanTestCases: Array<{
      schemaA: boolean;
      schemaB: boolean;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: true,
        schemaB: true,
        expected: true,
        description: 'both schemas are true',
      },
      {
        schemaA: false,
        schemaB: false,
        expected: true,
        description: 'both schemas are false',
      },
      {
        schemaA: true,
        schemaB: false,
        expected: false,
        description: 'schemas differ (true vs false)',
      },
      {
        schemaA: false,
        schemaB: true,
        expected: false,
        description: 'schemas differ (false vs true)',
      },
    ];

    it.each(booleanTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(schemaA, schemaB)).toBe(expected);
    });
  });

  describe('union (anyOf/oneOf) schemas', () => {
    const unionTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.string(),
        schemaB: z.union([z.string(), z.number()]),
        expected: true,
        description: 'schemaA is subset of union option',
      },
      {
        schemaA: z.number(),
        schemaB: z.union([z.string(), z.number()]),
        expected: true,
        description: 'schemaA matches one union option',
      },
      {
        schemaA: z.boolean(),
        schemaB: z.union([z.string(), z.number()]),
        expected: false,
        description: 'schemaA is not subset of any union option',
      },
    ];

    it.each(unionTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });

  describe('literal (const) schemas', () => {
    const literalTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.literal('hello'),
        schemaB: z.literal('hello'),
        expected: true,
        description: 'both have same literal value',
      },
      {
        schemaA: z.literal('hello'),
        schemaB: z.literal('world'),
        expected: false,
        description: 'literal values differ',
      },
      {
        schemaA: z.literal('hello'),
        schemaB: z.enum(['hello', 'world']),
        expected: true,
        description: 'literal is in enum',
      },
      {
        schemaA: z.literal('goodbye'),
        schemaB: z.enum(['hello', 'world']),
        expected: false,
        description: 'literal is not in enum',
      },
      {
        schemaA: z.literal('hello'),
        schemaB: z.string(),
        expected: true,
        description: 'literal type matches base type',
      },
      {
        schemaA: z.literal(123),
        schemaB: z.string(),
        expected: false,
        description: 'literal type does not match base type',
      },
    ];

    it.each(literalTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });

  describe('enum schemas', () => {
    const enumTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.enum(['a', 'b']),
        schemaB: z.enum(['a', 'b', 'c']),
        expected: true,
        description: 'all enum values are in target enum',
      },
      {
        schemaA: z.enum(['a', 'b', 'd']),
        schemaB: z.enum(['a', 'b', 'c']),
        expected: false,
        description: 'not all enum values are in target enum',
      },
      {
        schemaA: z.enum(['a', 'b']),
        schemaB: z.literal('a'),
        expected: false,
        description: 'target has literal but source has enum',
      },
    ];

    it.each(enumTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });

  describe('type matching', () => {
    const typeTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.string(),
        schemaB: z.number(),
        expected: false,
        description: 'types do not match',
      },
      {
        schemaA: z.string(),
        schemaB: z.string(),
        expected: true,
        description: 'types match',
      },
      {
        schemaA: z.string(),
        schemaB: z.any(),
        expected: true,
        description: 'target has no type constraint',
      },
      {
        schemaA: z.string(),
        schemaB: z.enum(['a', 'b']),
        expected: false,
        description: 'generic type vs specific enum',
      },
    ];

    it.each(typeTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });

  describe('object schemas', () => {
    const objectTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.object({ name: z.string(), age: z.number(), email: z.string() }),
        schemaB: z.object({ name: z.string(), age: z.number() }),
        expected: true,
        description: 'all target properties present and compatible',
      },
      {
        schemaA: z.object({ name: z.string() }),
        schemaB: z.object({ name: z.string(), age: z.number() }),
        expected: false,
        description: 'target property missing from source',
      },
      {
        schemaA: z.object({ age: z.string() }),
        schemaB: z.object({ age: z.number() }),
        expected: false,
        description: 'property types are incompatible',
      },
      {
        schemaA: z.object({ user: z.object({ name: z.string(), email: z.string() }) }),
        schemaB: z.object({ user: z.object({ name: z.string() }) }),
        expected: true,
        description: 'nested object properties compatible',
      },
      {
        schemaA: z.record(z.string(), z.number()),
        schemaB: z.record(z.string(), z.number()),
        expected: true,
        description: 'record schemas are compatible',
      },
      {
        schemaA: z.record(z.string(), z.string()),
        schemaB: z.record(z.string(), z.number()),
        expected: false,
        description: 'record value types are incompatible',
      },
      {
        schemaA: z.record(z.number(), z.string()),
        schemaB: z.record(z.string(), z.string()),
        expected: false,
        description: 'record key types are incompatible',
      },
      {
        schemaA: z.object({ name: z.string() }),
        schemaB: z.record(z.string(), z.number()),
        expected: false,
        description: 'object with properties vs record',
      },
    ];

    it.each(objectTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });
  describe('object schemas2', () => {
    const objectTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: JSONSchema._JSONSchema;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.object({
          object: z.object({
            val: z.string(),
          }),
        }),
        schemaB: {
          type: 'object',
          properties: {
            object: {
              type: 'object',
            },
          },
          required: ['object'],
          additionalProperties: false,
        },
        expected: true,
        description: 'object with properties vs empty object',
      },
    ];

    it.each(objectTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), schemaB)).toBe(expected);
    });
  });

  describe('array schemas', () => {
    const arrayTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.array(z.string()),
        schemaB: z.array(z.string()),
        expected: true,
        description: 'array item schemas are compatible',
      },
      {
        schemaA: z.array(z.number()),
        schemaB: z.array(z.string()),
        expected: false,
        description: 'array item schemas are incompatible',
      },
      {
        schemaA: z.array(z.array(z.string())),
        schemaB: z.array(z.array(z.string())),
        expected: true,
        description: 'nested array schemas are compatible',
      },
      {
        schemaA: z.tuple([z.string(), z.number()]),
        schemaB: z.tuple([z.string(), z.number()]),
        expected: false,
        description: 'tuple schemas (not supported)',
      },
      {
        schemaA: z.array(z.any()),
        schemaB: z.array(z.string()),
        expected: false,
        description: 'array with any vs specific type',
      },
    ];

    it.each(arrayTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });

  describe('complex and edge cases', () => {
    const complexTestCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.object({
          users: z.array(
            z.object({
              name: z.string(),
              age: z.number(),
              tags: z.array(z.string()),
            }),
          ),
        }),
        schemaB: z.object({
          users: z.array(z.object({ name: z.string() })),
        }),
        expected: true,
        description: 'complex nested schemas',
      },
      {
        schemaA: z.string(),
        schemaB: z.string(),
        expected: true,
        description: 'matching string types',
      },
      {
        schemaA: z.number(),
        schemaB: z.number(),
        expected: true,
        description: 'matching number types',
      },
      {
        schemaA: z.boolean(),
        schemaB: z.boolean(),
        expected: true,
        description: 'matching boolean types',
      },
      {
        schemaA: z.null(),
        schemaB: z.null(),
        expected: true,
        description: 'matching null types',
      },
      {
        schemaA: z.string(),
        schemaB: z.any(),
        expected: true,
        description: 'any target accepts any source',
      },
      {
        schemaA: z.any(),
        schemaB: z.string(),
        expected: false,
        description: 'any vs specific type',
      },
      {
        schemaA: z.literal(42),
        schemaB: z.number(),
        expected: true,
        description: 'literal number matches number type',
      },
    ];

    it.each(complexTestCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });
  describe('nullable and optional properties', () => {
    const nullabilityOptionalCases: Array<{
      schemaA: ZodTypeAny;
      schemaB: ZodTypeAny;
      expected: boolean;
      description: string;
    }> = [
      {
        schemaA: z.string(),
        schemaB: z.string().nullable(),
        expected: true,
        description: 'required vs nullable value',
      },
      {
        schemaA: z.string().nullable(),
        schemaB: z.string(),
        expected: false,
        description: 'nullable vs required value',
      },
      {
        schemaA: z.object({ value: z.string() }),
        schemaB: z.object({ value: z.optional(z.string()) }),
        expected: true,
        description: 'required vs optional property',
      },
      {
        schemaA: z.object({ value: z.optional(z.string()) }),
        schemaB: z.object({ value: z.string() }),
        expected: false,
        description: 'optional vs required property',
      },
      {
        schemaA: z.object({ value: z.string() }),
        schemaB: z.object({ value: z.string().optional() }),
        expected: true,
        description: 'required vs optional property',
      },
      {
        schemaA: z.object({ value: z.string().optional() }),
        schemaB: z.object({ value: z.string() }),
        expected: false,
        description: 'optional vs required property',
      },
      {
        schemaA: z.object({ value: z.string() }),
        schemaB: z.object({ value: z.nullable(z.string()) }),
        expected: true,
        description: 'required vs nullable property',
      },
      {
        schemaA: z.object({ value: z.nullable(z.string()) }),
        schemaB: z.object({ value: z.string() }),
        expected: false,
        description: 'nullable vs required property',
      },
      {
        schemaA: z.object({ value: z.string() }),
        schemaB: z.object({ value: z.string().nullable() }),
        expected: true,
        description: 'required vs nullable property',
      },
      {
        schemaA: z.object({ value: z.string().nullable() }),
        schemaB: z.object({ value: z.string() }),
        expected: false,
        description: 'nullable vs required property',
      },
      {
        schemaA: z.object({ value: z.string().optional() }),
        schemaB: z.object({ value: z.string().optional() }),
        expected: true,
        description: 'both optional properties',
      },
      {
        schemaA: z.object({ value: z.string().nullable() }),
        schemaB: z.object({ value: z.string().nullable() }),
        expected: true,
        description: 'both nullable properties',
      },
      {
        schemaA: z.object({ a: z.string(), b: z.number().optional() }),
        schemaB: z.object({ a: z.string() }),
        expected: true,
        description: 'extra optional property in source',
      },
      {
        schemaA: z.object({ a: z.string() }),
        schemaB: z.object({ a: z.string(), b: z.number().optional() }),
        expected: true,
        description: 'missing optional property in source',
      },
      {
        schemaA: z.object({ a: z.string() }),
        schemaB: z.object({ a: z.string(), b: z.number() }),
        expected: false,
        description: 'missing required property in source',
      },
      {
        schemaA: z.object({ value: z.string().nullable().optional() }),
        schemaB: z.object({ value: z.string() }),
        expected: false,
        description: 'nullable optional vs required property',
      },
      {
        schemaA: z.object({ value: z.string() }),
        schemaB: z.object({ value: z.string().nullable().optional() }),
        expected: true,
        description: 'required vs nullable optional property',
      },
      {
        schemaA: z.object({ a: z.string(), b: z.number(), c: z.boolean().optional() }),
        schemaB: z.object({ a: z.string(), b: z.number().optional() }),
        expected: true,
        description: 'mixed required and optional properties',
      },
      {
        schemaA: z.object({
          user: z.object({ name: z.string(), email: z.string().optional() }),
        }),
        schemaB: z.object({
          user: z.object({ name: z.string() }),
        }),
        expected: true,
        description: 'nested object with optional property',
      },
      {
        schemaA: z.object({
          user: z.object({ name: z.string().optional() }),
        }),
        schemaB: z.object({
          user: z.object({ name: z.string() }),
        }),
        expected: false,
        description: 'nested object optional vs required',
      },
    ];
    it.each(nullabilityOptionalCases)(TEST_DESCRIPTION, ({ schemaA, schemaB, expected }) => {
      expect(isJsonSchemaSubset(z.toJSONSchema(schemaA), z.toJSONSchema(schemaB))).toBe(expected);
    });
  });
});
