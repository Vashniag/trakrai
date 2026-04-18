import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

const defineBasicDualOperatorOperationNodeSchema = (description: string) =>
  defineNodeSchema({
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description,
  });

const defineBasicSingleOperatorOperationNodeSchema = (description: string) =>
  defineNodeSchema({
    input: z.object({ value: z.number() }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description,
  });

/**
 * Built-in arithmetic node schemas keyed by node type.
 *
 * Pair this registry with {@link ArithmeticNodeFunctions} when bootstrapping a runtime or editor.
 */
export const ArithmeticNodeSchemas = defineNodeSchemaRegistry({
  add: defineBasicDualOperatorOperationNodeSchema('Adds two numbers'),
  subtract: defineBasicDualOperatorOperationNodeSchema(
    'Subtracts the second number from the first',
  ),
  multiply: defineBasicDualOperatorOperationNodeSchema('Multiplies two numbers'),
  divide: defineBasicDualOperatorOperationNodeSchema('Divides the first number by the second'),
  modulo: defineBasicDualOperatorOperationNodeSchema(
    'Returns the remainder of dividing the first number by the second',
  ),
  power: defineNodeSchema({
    input: z.object({ base: z.number(), exponent: z.number() }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description: 'Raises the base to the power of the exponent',
  }),
  squareRoot: defineBasicSingleOperatorOperationNodeSchema('Returns the square root of a number'),
  absolute: defineBasicSingleOperatorOperationNodeSchema('Returns the absolute value of a number'),
  round: defineNodeSchema({
    input: z.object({ value: z.number(), decimals: z.number().optional() }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description: 'Rounds a number to the specified number of decimal places',
  }),
  floor: defineBasicSingleOperatorOperationNodeSchema(
    'Rounds a number down to the nearest integer',
  ),
  ceil: defineBasicSingleOperatorOperationNodeSchema('Rounds a number up to the nearest integer'),
  min: defineNodeSchema({
    input: z.object({ values: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description: 'Returns the minimum value from an array of numbers',
  }),
  max: defineNodeSchema({
    input: z.object({ values: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description: 'Returns the maximum value from an array of numbers',
  }),
});

/**
 * Runtime implementations for {@link ArithmeticNodeSchemas}.
 *
 * Throws when callers divide or modulo by zero, request the square root of a negative number, or
 * ask for the min/max of an empty array.
 */
export const ArithmeticNodeFunctions = defineNodeFunctions<typeof ArithmeticNodeSchemas>({
  add: (input) => ({ result: input.a + input.b }),
  subtract: (input) => ({ result: input.a - input.b }),
  multiply: (input) => ({ result: input.a * input.b }),
  divide: (input) => {
    if (input.b === 0) throw new Error('Division by zero');
    return { result: input.a / input.b };
  },
  modulo: (input) => {
    if (input.b === 0) throw new Error('Modulo by zero');
    return { result: input.a % input.b };
  },
  power: (input) => ({ result: Math.pow(input.base, input.exponent) }),
  squareRoot: (input) => {
    if (input.value < 0) throw new Error('Cannot calculate square root of a negative number');
    return { result: Math.sqrt(input.value) };
  },
  absolute: (input) => ({ result: Math.abs(input.value) }),
  round: (input) => {
    const decimals = input.decimals ?? 0;
    const DECIMAL_BASE = 10;
    const multiplier = Math.pow(DECIMAL_BASE, decimals);
    return { result: Math.round(input.value * multiplier) / multiplier };
  },
  floor: (input) => ({ result: Math.floor(input.value) }),
  ceil: (input) => ({ result: Math.ceil(input.value) }),
  min: (input) => {
    if (input.values.length === 0) throw new Error('Cannot find minimum of an empty array');
    return { result: Math.min(...input.values) };
  },
  max: (input) => {
    if (input.values.length === 0) throw new Error('Cannot find maximum of an empty array');
    return { result: Math.max(...input.values) };
  },
});
