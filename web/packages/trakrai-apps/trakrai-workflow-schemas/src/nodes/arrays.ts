import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

const CATEGORY = 'Array Operations';

/**
 * Built-in array node schemas for common immutable collection operations.
 */
export const ArrayNodeSchemas = defineNodeSchemaRegistry({
  length: defineNodeSchema({
    input: z.object({ array: z.array(z.unknown()) }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Returns the length of an array',
  }),
  push: defineNodeSchema({
    input: z.object({
      array: z.array(z.unknown()),
      value: z.unknown(),
    }),
    output: z.object({ result: z.array(z.unknown()) }),
    category: CATEGORY,
    description: 'Adds an element to the end of an array',
  }),
  concat: defineNodeSchema({
    input: z.object({ arrays: z.array(z.array(z.unknown())) }),
    output: z.object({ result: z.array(z.unknown()) }),
    category: CATEGORY,
    description: 'Concatenates multiple arrays into one',
  }),
  slice: defineNodeSchema({
    input: z.object({
      array: z.array(z.unknown()),
      start: z.number(),
      end: z.number().optional(),
    }),
    output: z.object({ result: z.array(z.unknown()) }),
    category: CATEGORY,
    description: 'Returns a portion of an array',
  }),
  indexOf: defineNodeSchema({
    input: z.object({
      array: z.array(z.unknown()),
      value: z.unknown(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Returns the index of the first occurrence of a value (-1 if not found)',
  }),
  includes: defineNodeSchema({
    input: z.object({
      array: z.array(z.unknown()),
      value: z.unknown(),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if an array contains a specific value',
  }),
  join: defineNodeSchema({
    input: z.object({
      array: z.array(z.union([z.string(), z.number(), z.boolean()])),
      separator: z.string().optional(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Joins array elements into a string',
  }),
  reverse: defineNodeSchema({
    input: z.object({ array: z.array(z.unknown()) }),
    output: z.object({ result: z.array(z.unknown()) }),
    category: CATEGORY,
    description: 'Reverses the order of elements in an array',
  }),
  sort: defineNodeSchema({
    input: z.object({
      array: z.array(z.union([z.string(), z.number()])),
      order: z.enum(['asc', 'desc']).optional(),
    }),
    output: z.object({ result: z.array(z.union([z.string(), z.number()])) }),
    category: CATEGORY,
    description: 'Sorts an array in ascending or descending order',
  }),
  first: defineNodeSchema({
    input: z.object({ array: z.array(z.unknown()) }),
    output: z.object({ result: z.unknown().nullable() }),
    category: CATEGORY,
    description: 'Returns the first element of an array',
  }),
  last: defineNodeSchema({
    input: z.object({ array: z.array(z.unknown()) }),
    output: z.object({ result: z.unknown().nullable() }),
    category: CATEGORY,
    description: 'Returns the last element of an array',
  }),
  at: defineNodeSchema({
    input: z.object({
      array: z.array(z.unknown()),
      index: z.number(),
    }),
    output: z.object({ result: z.unknown().nullable() }),
    category: CATEGORY,
    description: 'Returns the element at a specific index',
  }),
  unique: defineNodeSchema({
    input: z.object({ array: z.array(z.unknown()) }),
    output: z.object({ result: z.array(z.unknown()) }),
    category: CATEGORY,
    description: 'Returns an array with only unique elements',
  }),
  flatten: defineNodeSchema({
    input: z.object({
      array: z.array(z.unknown()),
      depth: z.number().optional(),
    }),
    output: z.object({ result: z.array(z.unknown()) }),
    category: CATEGORY,
    description: 'Flattens a nested array to a specified depth',
  }),
  sum: defineNodeSchema({
    input: z.object({ array: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Calculates the sum of all numbers in an array',
  }),
  average: defineNodeSchema({
    input: z.object({ array: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Calculates the average of all numbers in an array',
  }),
});

/**
 * Runtime implementations for {@link ArrayNodeSchemas}.
 *
 * Operations return new arrays instead of mutating the input, and `average` throws for empty
 * arrays because there is no numeric result to return.
 */
export const ArrayNodeFunctions = defineNodeFunctions<typeof ArrayNodeSchemas>({
  length: (input) => ({ result: input.array.length }),
  push: (input) => ({ result: [...input.array, input.value] }),
  concat: (input) => ({ result: input.arrays.flat(1) }),
  slice: (input) => ({ result: input.array.slice(input.start, input.end) }),
  indexOf: (input) => ({ result: input.array.indexOf(input.value) }),
  includes: (input) => ({ result: input.array.includes(input.value) }),
  join: (input) => ({ result: input.array.join(input.separator ?? ',') }),
  reverse: (input) => ({ result: [...input.array].reverse() }),
  sort: (input) => {
    const sorted = [...input.array].sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    });
    return { result: input.order === 'desc' ? sorted.reverse() : sorted };
  },
  first: (input) => ({ result: input.array[0] ?? null }),
  last: (input) => ({ result: input.array[input.array.length - 1] ?? null }),
  at: (input) => ({ result: input.array[input.index] ?? null }),
  unique: (input) => ({ result: [...new Set(input.array)] }),
  flatten: (input) => ({ result: input.array.flat(input.depth ?? 1) }),
  sum: (input) => ({ result: input.array.reduce((sum, val) => sum + val, 0) }),
  average: (input) => {
    if (input.array.length === 0) throw new Error('Cannot calculate average of an empty array');
    const sum = input.array.reduce((acc, val) => acc + val, 0);
    return { result: sum / input.array.length };
  },
});
