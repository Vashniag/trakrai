import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

const CATEGORY = 'Logic Operations';

/**
 * Built-in schemas for boolean composition and inversion.
 */
export const LogicNodeSchemas = defineNodeSchemaRegistry({
  and: defineNodeSchema({
    input: z.object({ values: z.array(z.boolean()) }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns true if all values are true (logical AND)',
  }),
  or: defineNodeSchema({
    input: z.object({ values: z.array(z.boolean()) }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns true if at least one value is true (logical OR)',
  }),
  not: defineNodeSchema({
    input: z.object({ value: z.boolean() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns the opposite boolean value (logical NOT)',
  }),
  xor: defineNodeSchema({
    input: z.object({ a: z.boolean(), b: z.boolean() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns true if exactly one value is true (logical XOR)',
  }),
  nand: defineNodeSchema({
    input: z.object({ values: z.array(z.boolean()) }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns true if at least one value is false (logical NAND)',
  }),
  nor: defineNodeSchema({
    input: z.object({ values: z.array(z.boolean()) }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns true if all values are false (logical NOR)',
  }),
  xnor: defineNodeSchema({
    input: z.object({ a: z.boolean(), b: z.boolean() }),
    output: z.object({ result: z.boolean() }),
    category: CATEGORY,
    description: 'Returns true if both values are the same (logical XNOR)',
  }),
});

/**
 * Runtime implementations for {@link LogicNodeSchemas}.
 */
export const LogicNodeFunctions = defineNodeFunctions<typeof LogicNodeSchemas>({
  and: (input) => ({ result: input.values.every((v) => v) }),
  or: (input) => ({ result: input.values.some((v) => v) }),
  not: (input) => ({ result: !input.value }),
  xor: (input) => ({ result: input.a !== input.b }),
  nand: (input) => ({ result: !input.values.every((v) => v) }),
  nor: (input) => ({ result: !input.values.some((v) => v) }),
  xnor: (input) => ({ result: input.a === input.b }),
});
