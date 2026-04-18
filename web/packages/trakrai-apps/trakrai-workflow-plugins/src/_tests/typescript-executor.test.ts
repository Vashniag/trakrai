/* eslint-disable no-magic-numbers */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TypeScriptExecutor } from '../code-runner/typescript-executor';

const EXECUTION_TIMEOUT = 10000;
const SHORT_TIMEOUT = 100;
const LONG_TIMEOUT = 2000;
const TEST_VALUE = 5;
const SIMPLE_MULTIPLY_CODE = '(input) => ({ result: input.value * 2 })';

describe('TypeScriptExecutor', () => {
  describe('basic execution', () => {
    it(
      'should execute a simple function and return the result',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = SIMPLE_MULTIPLY_CODE;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 10 });
        expect(result.executionTimeMs).toBeGreaterThan(0);
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute legacy body-style code',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = 'return { result: input.value * 2 };';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 10 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute declaration-style code',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = 'const run = (input) => ({ result: input.value * 3 });';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 15 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute direct object expressions',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '({ result: input.value * 4 })';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 20 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute a function with string manipulation',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => ({ output: input.text.toUpperCase() })';
        const input = { text: 'hello world' };
        const inputSchema = z.object({ text: z.string() });
        const outputSchema = z.object({ output: z.string() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ output: 'HELLO WORLD' });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute a function with array operations',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => ({ sum: input.numbers.reduce((a, b) => a + b, 0) })';
        const input = { numbers: [1, 2, 3, 4, 5] };
        const inputSchema = z.object({ numbers: z.array(z.number()) });
        const outputSchema = z.object({ sum: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ sum: 15 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute a function with object manipulation',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input) => ({
        fullName: input.firstName + ' ' + input.lastName,
        age: input.age
      })`;
        const input = { firstName: 'John', lastName: 'Doe', age: 30 };
        const inputSchema = z.object({
          firstName: z.string(),
          lastName: z.string(),
          age: z.number(),
        });
        const outputSchema = z.object({
          fullName: z.string(),
          age: z.number(),
        });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ fullName: 'John Doe', age: 30 });
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('input/output validation', () => {
    it(
      'should validate input against schema',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = SIMPLE_MULTIPLY_CODE;
        const input = { value: 'not a number' }; // Invalid input
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(
          code,
          input as unknown as { value: number },
          inputSchema,
          outputSchema,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Validation error');
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should validate output against schema',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => ({ result: "not a number" })'; // Returns wrong type
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle missing required fields in input',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = SIMPLE_MULTIPLY_CODE;
        const input = {}; // Missing required field
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(
          code,
          input as { value: number },
          inputSchema,
          outputSchema,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Validation error');
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle optional fields in schemas',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => ({ result: (input.value || 0) * 2 })';
        const input = {};
        const inputSchema = z.object({ value: z.number().optional() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 0 });
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('timeout and CPU limits', () => {
    it(
      'should timeout on infinite loop',
      async () => {
        const executor = new TypeScriptExecutor({ timeoutMs: SHORT_TIMEOUT });

        const code = '(input) => { while(true) {} return { result: 0 }; }';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.executionTimeMs).toBeGreaterThan(SHORT_TIMEOUT - 10);
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should timeout on long-running computation',
      async () => {
        const executor = new TypeScriptExecutor({ timeoutMs: SHORT_TIMEOUT });

        const code = `(input) => {
        let sum = 0;
        for (let i = 0; i < 1000000000; i++) {
          sum += i;
        }
        return { result: sum };
      }`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should complete within timeout for fast operations',
      async () => {
        const executor = new TypeScriptExecutor({ timeoutMs: LONG_TIMEOUT });

        const code = SIMPLE_MULTIPLY_CODE;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.executionTimeMs).toBeLessThan(LONG_TIMEOUT);
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('isolation and security', () => {
    it(
      'should not have access to require/import',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => { const fs = require("fs"); return { result: 0 }; }';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should not have access to process',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => { return { result: typeof process }; }';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.string() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data?.result).toBe('undefined');
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should not have access to global Node.js objects',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input) => ({
        hasBuffer: typeof Buffer,
        hasSetTimeout: typeof setTimeout,
        hasSetInterval: typeof setInterval
      })`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({
          hasBuffer: z.string(),
          hasSetTimeout: z.string(),
          hasSetInterval: z.string(),
        });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data?.hasBuffer).toBe('undefined');
        expect(result.data?.hasSetTimeout).toBe('undefined');
        expect(result.data?.hasSetInterval).toBe('undefined');
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should have access to basic JavaScript built-ins',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input) => ({
        hasArray: typeof Array,
        hasObject: typeof Object,
        hasMath: typeof Math,
        hasJSON: typeof JSON
      })`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({
          hasArray: z.string(),
          hasObject: z.string(),
          hasMath: z.string(),
          hasJSON: z.string(),
        });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data?.hasArray).toBe('function');
        expect(result.data?.hasObject).toBe('function');
        expect(result.data?.hasMath).toBe('object');
        expect(result.data?.hasJSON).toBe('object');
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('error handling', () => {
    it(
      'should handle runtime errors gracefully',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => { throw new Error("Test error"); }';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Test error');
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle syntax errors',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => { const x = ; return { result: 0 }; }'; // Syntax error
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle reference errors',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => { return { result: undefinedVariable }; }';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('complex data types', () => {
    it(
      'should handle nested objects',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input) => ({
        user: {
          name: input.user.firstName + ' ' + input.user.lastName,
          contact: {
            email: input.user.email
          }
        }
      })`;
        const input = {
          user: {
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane@example.com',
          },
        };
        const inputSchema = z.object({
          user: z.object({
            firstName: z.string(),
            lastName: z.string(),
            email: z.string(),
          }),
        });
        const outputSchema = z.object({
          user: z.object({
            name: z.string(),
            contact: z.object({
              email: z.string(),
            }),
          }),
        });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          user: {
            name: 'Jane Smith',
            contact: {
              email: 'jane@example.com',
            },
          },
        });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle arrays of objects',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input) => ({
        results: input.items.map(item => ({ id: item.id, doubled: item.value * 2 }))
      })`;
        const input = {
          items: [
            { id: 1, value: 10 },
            { id: 2, value: 20 },
            { id: 3, value: 30 },
          ],
        };
        const inputSchema = z.object({
          items: z.array(z.object({ id: z.number(), value: z.number() })),
        });
        const outputSchema = z.object({
          results: z.array(z.object({ id: z.number(), doubled: z.number() })),
        });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          results: [
            { id: 1, doubled: 20 },
            { id: 2, doubled: 40 },
            { id: 3, doubled: 60 },
          ],
        });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle boolean values',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => ({ isValid: input.value > 0 })';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ isValid: z.boolean() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ isValid: true });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should handle null values',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input) => ({ result: input.value === null ? 0 : input.value })';
        const input = { value: null };
        const inputSchema = z.object({ value: z.number().nullable() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 0 });
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('memory limits', () => {
    it(
      'should respect memory limits',
      async () => {
        const SMALL_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024; // 8MB
        const executor = new TypeScriptExecutor({ memoryLimitBytes: SMALL_MEMORY_LIMIT_BYTES });

        const code = `(input) => {
        const arr = [];
        // Try to allocate a lot of memory
        for (let i = 0; i < 1000000; i++) {
          arr.push({ data: new Array(1000).fill(i) });
        }
        return { result: arr.length };
      }`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      },
      EXECUTION_TIMEOUT,
    );
    it(
      'should run if memory limits are sufficient',
      async () => {
        const LARGE_MEMORY_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
        const executor = new TypeScriptExecutor({ memoryLimitBytes: LARGE_MEMORY_LIMIT_BYTES });

        const code = `(input) => {
        const arr = [];
        // Try to allocate a lot of memory
        for (let i = 0; i < 1000; i++) {
          arr.push({ data: new Array(1000).fill(i*i) });
        }
        return { result: arr.length };
      }`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('JSON schema API', () => {
    it(
      'should work with JSON schema directly',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = SIMPLE_MULTIPLY_CODE;
        const input = { value: TEST_VALUE };
        const inputSchema: z.core.JSONSchema.JSONSchema = {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
          required: ['value'],
        };
        const outputSchema: z.core.JSONSchema.JSONSchema = {
          type: 'object',
          properties: {
            result: { type: 'number' },
          },
          required: ['result'],
        };

        const result = await executor.execute(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 10 });
      },
      EXECUTION_TIMEOUT,
    );
  });

  describe('TypeScript code support', () => {
    it(
      'should execute a function with typed parameters',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = '(input: { value: number }) => ({ result: input.value * 2 })';
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 10 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute code with interface declarations',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input: { value: number }): { result: number } => {
          const val: number = input.value;
          return { result: val * 3 };
        }`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 15 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute code with type assertions',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input: { value: number }) => {
          const val = input.value as number;
          return { result: val * 4 };
        }`;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 20 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute code with generic type usage',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input: { items: number[] }) => {
          const mapped: Array<number> = input.items.map((x: number) => x * 2);
          return { result: mapped };
        }`;
        const input = { items: [1, 2, 3] };
        const inputSchema = z.object({ items: z.array(z.number()) });
        const outputSchema = z.object({ result: z.array(z.number()) });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: [2, 4, 6] });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should execute code with return type annotations',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = `(input: { text: string }): { upper: string; length: number } => {
          return {
            upper: input.text.toUpperCase(),
            length: input.text.length,
          };
        }`;
        const input = { text: 'hello' };
        const inputSchema = z.object({ text: z.string() });
        const outputSchema = z.object({ upper: z.string(), length: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ upper: 'HELLO', length: 5 });
      },
      EXECUTION_TIMEOUT,
    );

    it(
      'should still execute plain JavaScript code',
      async () => {
        const executor = new TypeScriptExecutor();

        const code = SIMPLE_MULTIPLY_CODE;
        const input = { value: TEST_VALUE };
        const inputSchema = z.object({ value: z.number() });
        const outputSchema = z.object({ result: z.number() });

        const result = await executor.executeWithZod(code, input, inputSchema, outputSchema);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 10 });
      },
      EXECUTION_TIMEOUT,
    );
  });
});
