/* eslint-disable no-magic-numbers */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { NodeSchemas } from '@trakrai-workflow/core';

import { nodes } from '../ui/nodes/node-renderer';

const testSchemas: NodeSchemas = {
  add: {
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    category: 'Arithmetic',
    description: 'Adds two numbers',
  },
  httpRequest: {
    input: z.object({ url: z.string(), method: z.string() }),
    output: z.object({ status: z.number(), data: z.string() }),
    category: 'HTTP',
    description: 'Makes an HTTP request',
  },
  splitString: {
    input: z.object({ value: z.string(), delimiter: z.string() }),
    output: z.object({ result: z.array(z.string()) }),
    category: 'Strings',
    description: 'Splits a string by delimiter',
  },
};

describe('node-renderer', () => {
  describe('nodes()', () => {
    it('generates node descriptors from schemas', () => {
      const result = nodes(testSchemas);

      expect(result).toHaveLength(3);
    });

    it('includes type, displayName, category and description for each node', () => {
      const result = nodes(testSchemas);

      const addNode = result.find((n) => n.type === 'add');
      expect(addNode).toBeDefined();
      expect(addNode?.displayName).toBe('Add');
      expect(addNode?.category).toBe('Arithmetic');
      expect(addNode?.description).toBe('Adds two numbers');
    });

    it('converts camelCase type to display names', () => {
      const result = nodes(testSchemas);

      const httpNode = result.find((n) => n.type === 'httpRequest');
      expect(httpNode).toBeDefined();
      expect(httpNode?.displayName).toBe('HTTP Request');
    });

    it('returns empty array for empty schemas', () => {
      const result = nodes({});
      expect(result).toHaveLength(0);
    });

    it('preserves all schema entries', () => {
      const result = nodes(testSchemas);
      const types = result.map((n) => n.type);

      expect(types).toContain('add');
      expect(types).toContain('httpRequest');
      expect(types).toContain('splitString');
    });
  });
});
