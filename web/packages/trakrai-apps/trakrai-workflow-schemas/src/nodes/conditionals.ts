import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

const CATEGORY = 'Conditionals';

/**
 * Built-in schemas for comparisons and truthiness checks.
 */
export const ConditionalNodeSchemas = defineNodeSchemaRegistry({
  equals: defineNodeSchema({
    input: z.object({
      a: z.union([z.string(), z.number(), z.boolean()]),
      b: z.union([z.string(), z.number(), z.boolean()]),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if two values are equal',
  }),
  notEquals: defineNodeSchema({
    input: z.object({
      a: z.union([z.string(), z.number(), z.boolean()]),
      b: z.union([z.string(), z.number(), z.boolean()]),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if two values are not equal',
  }),
  greaterThan: defineNodeSchema({
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if the first number is greater than the second',
  }),
  greaterThanOrEqual: defineNodeSchema({
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if the first number is greater than or equal to the second',
  }),
  lessThan: defineNodeSchema({
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if the first number is less than the second',
  }),
  lessThanOrEqual: defineNodeSchema({
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if the first number is less than or equal to the second',
  }),
  isEmpty: defineNodeSchema({
    input: z.object({
      value: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a string, array, or object is empty',
  }),
  isNull: defineNodeSchema({
    input: z.object({ value: z.unknown() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a value is null',
  }),
  isUndefined: defineNodeSchema({
    input: z.object({ value: z.unknown() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a value is undefined',
  }),
  isTruthy: defineNodeSchema({
    input: z.object({ value: z.unknown() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a value is truthy',
  }),
  isFalsy: defineNodeSchema({
    input: z.object({ value: z.unknown() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a value is falsy',
  }),
});

/**
 * Runtime implementations for {@link ConditionalNodeSchemas}.
 *
 * `isEmpty` accepts strings, arrays, and plain objects and evaluates their length or key count.
 */
export const ConditionalNodeFunctions = defineNodeFunctions<typeof ConditionalNodeSchemas>({
  equals: (input) => ({ result: input.a === input.b }),
  notEquals: (input) => ({ result: input.a !== input.b }),
  greaterThan: (input) => ({ result: input.a > input.b }),
  greaterThanOrEqual: (input) => ({ result: input.a >= input.b }),
  lessThan: (input) => ({ result: input.a < input.b }),
  lessThanOrEqual: (input) => ({ result: input.a <= input.b }),
  isEmpty: (input) => {
    if (typeof input.value === 'string') return { result: input.value.length === 0 };
    if (Array.isArray(input.value)) return { result: input.value.length === 0 };
    return { result: Object.keys(input.value).length === 0 };
  },
  isNull: (input) => ({ result: input.value === null }),
  isUndefined: (input) => ({ result: input.value === undefined }),
  isTruthy: (input) => ({ result: Boolean(input.value) }),
  isFalsy: (input) => ({ result: Boolean(input.value) === false }),
});
