import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonSchemaToTypeString } from '../core/schema/json-schema-to-type-string';

const STRING_NAME = 'name: string';

describe('jsonSchemaToTypeString', () => {
  const convert = (schema: z.ZodType): string => jsonSchemaToTypeString(z.toJSONSchema(schema));

  it('handles primitive types', () => {
    expect(convert(z.string())).toBe('string');
    expect(convert(z.number())).toBe('number');
    expect(convert(z.boolean())).toBe('boolean');
  });

  it('handles a simple object', () => {
    const schema = z.object({ value: z.number(), label: z.string() });
    const result = convert(schema);
    expect(result).toContain('value: number');
    expect(result).toContain('label: string');
  });

  it('handles optional properties', () => {
    const schema = z.object({ name: z.string(), age: z.optional(z.number()) });
    const result = convert(schema);
    expect(result).toContain(STRING_NAME);
    expect(result).toContain('age?: number');
  });

  it('handles arrays', () => {
    const schema = z.object({ items: z.array(z.string()) });
    const result = convert(schema);
    expect(result).toContain('items: string[]');
  });

  it('handles nested objects', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
    });
    const result = convert(schema);
    expect(result).toContain('user:');
    expect(result).toContain(STRING_NAME);
    expect(result).toContain('email: string');
  });

  it('handles unions', () => {
    const schema = z.union([z.string(), z.number()]);
    const result = convert(schema);
    expect(result).toBe('string | number');
  });

  it('handles enums', () => {
    const schema = z.enum(['a', 'b', 'c']);
    const result = convert(schema);
    expect(result).toBe('"a" | "b" | "c"');
  });

  it('handles nullable types', () => {
    const schema = z.nullable(z.string());
    const result = convert(schema);
    expect(result).toContain('string');
    expect(result).toContain('null');
  });

  it('handles record types', () => {
    const schema = z.record(z.string(), z.number());
    const result = convert(schema);
    expect(result).toContain('Record<string, number>');
  });

  it('handles array of objects', () => {
    const schema = z.array(z.object({ id: z.number(), name: z.string() }));
    const result = convert(schema);
    expect(result).toContain('id: number');
    expect(result).toContain(STRING_NAME);
    expect(result).toContain('[]');
  });

  it('handles a complex real-world schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      tags: z.array(z.string()),
      address: z.optional(
        z.object({
          street: z.string(),
          city: z.string(),
          zip: z.string(),
        }),
      ),
      status: z.enum(['active', 'inactive']),
    });
    const result = convert(schema);
    expect(result).toContain(STRING_NAME);
    expect(result).toContain('age: number');
    expect(result).toContain('tags: string[]');
    expect(result).toContain('address?:');
    expect(result).toContain('street: string');
    expect(result).toContain('"active" | "inactive"');
  });

  it('handles boolean JSON schema values', () => {
    expect(jsonSchemaToTypeString(true)).toBe('unknown');
    expect(jsonSchemaToTypeString(false)).toBe('never');
  });
});
