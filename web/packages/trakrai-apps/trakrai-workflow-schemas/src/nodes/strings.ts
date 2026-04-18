import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

const CATEGORY = 'String Operations';

/**
 * Built-in string manipulation node schemas.
 */
export const StringNodeSchemas = defineNodeSchemaRegistry({
  concatenate: defineNodeSchema({
    input: z.object({
      strings: z.array(z.string()),
      separator: z.string().optional(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Concatenates multiple strings with an optional separator',
  }),
  toUpperCase: defineNodeSchema({
    input: z.object({ value: z.string() }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Converts a string to uppercase',
  }),
  toLowerCase: defineNodeSchema({
    input: z.object({ value: z.string() }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Converts a string to lowercase',
  }),
  trim: defineNodeSchema({
    input: z.object({ value: z.string() }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Removes whitespace from both ends of a string',
  }),
  trimStart: defineNodeSchema({
    input: z.object({ value: z.string() }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Removes whitespace from the start of a string',
  }),
  trimEnd: defineNodeSchema({
    input: z.object({ value: z.string() }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Removes whitespace from the end of a string',
  }),
  split: defineNodeSchema({
    input: z.object({
      value: z.string(),
      separator: z.string(),
      limit: z.number().optional(),
    }),
    output: z.object({ result: z.array(z.string()) }),
    category: CATEGORY,
    description: 'Splits a string into an array of substrings',
  }),
  replace: defineNodeSchema({
    input: z.object({
      value: z.string(),
      search: z.string(),
      replacement: z.string(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Replaces the first occurrence of a substring',
  }),
  replaceAll: defineNodeSchema({
    input: z.object({
      value: z.string(),
      search: z.string(),
      replacement: z.string(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Replaces all occurrences of a substring',
  }),
  substring: defineNodeSchema({
    input: z.object({
      value: z.string(),
      start: z.number(),
      end: z.number().optional(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Extracts a substring from a string',
  }),
  indexOf: defineNodeSchema({
    input: z.object({
      value: z.string(),
      search: z.string(),
      fromIndex: z.number().optional(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Returns the index of the first occurrence of a substring (-1 if not found)',
  }),
  length: defineNodeSchema({
    input: z.object({ value: z.string() }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Returns the length of a string',
  }),
  startsWith: defineNodeSchema({
    input: z.object({
      value: z.string(),
      search: z.string(),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a string starts with a specified substring',
  }),
  endsWith: defineNodeSchema({
    input: z.object({
      value: z.string(),
      search: z.string(),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a string ends with a specified substring',
  }),
  includes: defineNodeSchema({
    input: z.object({
      value: z.string(),
      search: z.string(),
    }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Checks if a string contains a specified substring',
  }),
  padStart: defineNodeSchema({
    input: z.object({
      value: z.string(),
      targetLength: z.number(),
      padString: z.string().optional(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Pads the start of a string with another string',
  }),
  padEnd: defineNodeSchema({
    input: z.object({
      value: z.string(),
      targetLength: z.number(),
      padString: z.string().optional(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Pads the end of a string with another string',
  }),
  repeat: defineNodeSchema({
    input: z.object({
      value: z.string(),
      count: z.number(),
    }),
    output: z.object({ result: z.string() }),
    category: CATEGORY,
    description: 'Repeats a string a specified number of times',
  }),
});

/**
 * Runtime implementations for {@link StringNodeSchemas}.
 *
 * `repeat` throws when `count` is negative because JavaScript string repetition requires a
 * non-negative length.
 */
export const StringNodeFunctions = defineNodeFunctions<typeof StringNodeSchemas>({
  concatenate: (input) => ({ result: input.strings.join(input.separator ?? '') }),
  toUpperCase: (input) => ({ result: input.value.toUpperCase() }),
  toLowerCase: (input) => ({ result: input.value.toLowerCase() }),
  trim: (input) => ({ result: input.value.trim() }),
  trimStart: (input) => ({ result: input.value.trimStart() }),
  trimEnd: (input) => ({ result: input.value.trimEnd() }),
  split: (input) => ({ result: input.value.split(input.separator, input.limit) }),
  replace: (input) => ({ result: input.value.replace(input.search, input.replacement) }),
  replaceAll: (input) => ({ result: input.value.replaceAll(input.search, input.replacement) }),
  substring: (input) => ({ result: input.value.substring(input.start, input.end) }),
  indexOf: (input) => ({ result: input.value.indexOf(input.search, input.fromIndex) }),
  length: (input) => ({ result: input.value.length }),
  startsWith: (input) => ({ result: input.value.startsWith(input.search) }),
  endsWith: (input) => ({ result: input.value.endsWith(input.search) }),
  includes: (input) => ({ result: input.value.includes(input.search) }),
  padStart: (input) => ({ result: input.value.padStart(input.targetLength, input.padString) }),
  padEnd: (input) => ({ result: input.value.padEnd(input.targetLength, input.padString) }),
  repeat: (input) => {
    if (input.count < 0) throw new Error('Count must be non-negative');
    return { result: input.value.repeat(input.count) };
  },
});
