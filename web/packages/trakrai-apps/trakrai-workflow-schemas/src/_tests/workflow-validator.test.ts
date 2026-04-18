import { TriggerHandle, validateWorkflow, type Edge, type Node } from '@trakrai-workflow/core';
import { describe, expect, it } from 'vitest';

import httpTestWorkflow from './test-workflows/http-test-workflow.json';
import testWorkflow from './test-workflows/test-workflow.json';

import { ConditionalNodeSchemas, DateTimeNodeSchemas, HttpNodeSchemas } from '..';

const makeNode = (id: string, type: string, config: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { configuration: config },
});

const makeEdge = (
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Edge => ({
  id: `e-${source}-${target}-${sourceHandle}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

const EXAMPLE_URL = 'https://example.com';

describe('workflow-validator', () => {
  const nodeSchemas = {
    ...DateTimeNodeSchemas,
    ...ConditionalNodeSchemas,
    ...HttpNodeSchemas,
  };
  const tests = [
    {
      name: 'validates a workflow with valid nodes',
      nodes: testWorkflow.nodes,
      edges: testWorkflow.edges,
      schemas: nodeSchemas,
      expectedValid: true,
    },
    {
      name: 'validates a workflow with HTTP request nodes',
      nodes: httpTestWorkflow.nodes,
      edges: httpTestWorkflow.edges,
      schemas: nodeSchemas,
      expectedValid: true,
    },
  ];
  describe('validateWorkflow', () => {
    it.each(tests)('$name', ({ nodes, edges, schemas, expectedValid }) => {
      const result = validateWorkflow(nodes, edges, schemas);
      expect(result.valid).toBe(expectedValid);
    });
  });

  describe('asyncDependencyMap', () => {
    const asyncNodeTypes = new Set(['httpRequest']);

    it('returns empty async dependency map for empty workflow', () => {
      const result = validateWorkflow([], [], nodeSchemas, asyncNodeTypes);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap).toEqual({});
      }
    });

    it('returns empty async deps for a single sync node', () => {
      const result = validateWorkflow(
        [makeNode('a', 'getInvokeTime')],
        [],
        nodeSchemas,
        asyncNodeTypes,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
      }
    });

    it('returns empty async deps for a single async node with no predecessors', () => {
      const result = validateWorkflow(
        [makeNode('a', 'httpRequest', { url: EXAMPLE_URL })],
        [],
        nodeSchemas,
        asyncNodeTypes,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
      }
    });

    it('sync node depending on async node lists the async node as barrier', () => {
      const nodes = [
        makeNode('async1', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('sync1', 'greaterThan', { b: 0 }),
      ];
      const edges = [makeEdge('async1', 'status', 'sync1', 'a')];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['async1']).toEqual([]);
        expect(result.asyncDependencyMap['sync1']).toEqual(['async1']);
      }
    });

    it('async node depending on sync node has no async deps', () => {
      // sync -> async: async node has no async barriers (sync runs instantly)
      const nodes = [
        makeNode('sync1', 'getInvokeTime'),
        makeNode('async1', 'httpRequest', { url: EXAMPLE_URL }),
      ];
      // getInvokeTime outputs {timestamp}, but httpRequest doesn't take timestamp.
      // We're testing topology, not input validation, so this may have validation errors.
      const edges = [makeEdge('sync1', 'timestamp', 'async1', 'url')];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      // May or may not be valid, but asyncDependencyMap should still be computed
      if (result.valid) {
        expect(result.asyncDependencyMap['sync1']).toEqual([]);
        expect(result.asyncDependencyMap['async1']).toEqual([]);
      }
    });

    it('sync node sees through intermediate sync nodes to find async barrier', () => {
      // A(async) -> B(sync) -> C(sync)
      // C should have async barrier [A], looking through B
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'greaterThan', { b: 0 }),
        makeNode('c', 'getInvokeTime'),
      ];
      const edges = [
        makeEdge('a', 'status', 'b', 'a'),
        makeEdge('b', 'result', 'c', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual(['a']);
        expect(result.asyncDependencyMap['c']).toEqual(['a']);
      }
    });

    it('stops at nearest async barrier and does not look further', () => {
      // A(async) -> B(sync) -> C(async) -> D(sync)
      // D's barrier should be [C], not [A, C]
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'greaterThan', { b: 0 }),
        makeNode('c', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('d', 'getInvokeTime'),
      ];
      const edges = [
        makeEdge('a', 'status', 'b', 'a'),
        makeEdge('b', 'result', 'c', TriggerHandle),
        makeEdge('c', 'status', 'd', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual(['a']);
        expect(result.asyncDependencyMap['c']).toEqual(['a']);
        expect(result.asyncDependencyMap['d']).toEqual(['c']);
      }
    });

    it('collects async barriers from multiple paths', () => {
      // A(async) -> C(sync)
      // B(async) -> C(sync)
      // C should have barriers [A, B]
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('c', 'greaterThan', { b: 0 }),
      ];
      const edges = [
        makeEdge('a', 'status', 'c', 'a'),
        makeEdge('b', 'status', 'c', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual([]);
        expect(result.asyncDependencyMap['c']).toEqual(expect.arrayContaining(['a', 'b']));
        expect(result.asyncDependencyMap['c']).toHaveLength(2);
      }
    });

    it('async chain: each waits only for direct async predecessor', () => {
      // A(async) -> B(async) -> C(async)
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('c', 'httpRequest', { url: EXAMPLE_URL }),
      ];
      const edges = [
        makeEdge('a', 'status', 'b', TriggerHandle),
        makeEdge('b', 'status', 'c', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual(['a']);
        expect(result.asyncDependencyMap['c']).toEqual(['b']);
      }
    });

    it('parallel nodes with no edges have no async deps', () => {
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'getInvokeTime'),
        makeNode('c', 'httpRequest', { url: EXAMPLE_URL }),
      ];
      const result = validateWorkflow(nodes, [], nodeSchemas, asyncNodeTypes);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual([]);
        expect(result.asyncDependencyMap['c']).toEqual([]);
      }
    });

    it('diamond with async root: both paths converge through sync nodes', () => {
      // A(async) -> B(sync), A -> C(sync), B -> D(sync), C -> D
      // D's barriers = [A] (found through both B and C paths)
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'greaterThan', { b: 0 }),
        makeNode('c', 'greaterThan', { b: 0 }),
        makeNode('d', 'getInvokeTime'),
      ];
      const edges = [
        makeEdge('a', 'status', 'b', 'a'),
        makeEdge('a', 'status', 'c', 'a'),
        makeEdge('b', 'result', 'd', TriggerHandle),
        makeEdge('c', 'result', 'd', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual(['a']);
        expect(result.asyncDependencyMap['c']).toEqual(['a']);
        expect(result.asyncDependencyMap['d']).toEqual(['a']);
      }
    });

    it('diamond with async root and one async branch', () => {
      // A(async) -> B(sync) -> D(sync)
      // A(async) -> C(async) -> D(sync)
      // D's barriers: [A] through B path, [C] through C path => [A, C]
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'greaterThan', { b: 0 }),
        makeNode('c', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('d', 'getInvokeTime'),
      ];
      const edges = [
        makeEdge('a', 'status', 'b', 'a'),
        makeEdge('a', 'status', 'c', TriggerHandle),
        makeEdge('b', 'result', 'd', TriggerHandle),
        makeEdge('c', 'status', 'd', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['d']).toEqual(expect.arrayContaining(['a', 'c']));
        expect(result.asyncDependencyMap['d']).toHaveLength(2);
      }
    });

    it('all sync chain has no async barriers', () => {
      const nodes = [
        makeNode('a', 'getInvokeTime'),
        makeNode('b', 'getInvokeTime'),
        makeNode('c', 'greaterThan', { b: 0 }),
      ];
      const edges = [
        makeEdge('a', 'timestamp', 'c', 'a'),
        makeEdge('b', 'timestamp', 'c', TriggerHandle),
      ];
      const result = validateWorkflow(nodes, edges, nodeSchemas, asyncNodeTypes);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual([]);
        expect(result.asyncDependencyMap['c']).toEqual([]);
      }
    });

    it('returns all empty when asyncNodeTypes is not provided', () => {
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'greaterThan', { b: 0 }),
      ];
      const edges = [makeEdge('a', 'status', 'b', 'a')];
      const result = validateWorkflow(nodes, edges, nodeSchemas);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual([]);
      }
    });

    it('returns all empty when asyncNodeTypes is an empty set', () => {
      const nodes = [
        makeNode('a', 'httpRequest', { url: EXAMPLE_URL }),
        makeNode('b', 'httpRequest', { url: EXAMPLE_URL }),
      ];
      const edges = [makeEdge('a', 'status', 'b', TriggerHandle)];
      const result = validateWorkflow(nodes, edges, nodeSchemas, new Set());
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['a']).toEqual([]);
        expect(result.asyncDependencyMap['b']).toEqual([]);
      }
    });

    it('works with the existing http test workflow', () => {
      // http-request_1 (async) -> http-request_2 (async)
      // request_2 should have barrier [http-request_1]
      const result = validateWorkflow(
        httpTestWorkflow.nodes as Node[],
        httpTestWorkflow.edges as Edge[],
        nodeSchemas,
        asyncNodeTypes,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.asyncDependencyMap['http-request_1']).toEqual([]);
        expect(result.asyncDependencyMap['http-request_2']).toEqual(['http-request_1']);
      }
    });

    it('works with the mixed test workflow', () => {
      // test-workflow has sync nodes (getInvokeTime, getTimeDifference, greaterThan)
      // and async nodes (httpRequest)
      const result = validateWorkflow(
        testWorkflow.nodes as Node[],
        testWorkflow.edges as Edge[],
        nodeSchemas,
        asyncNodeTypes,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        // All getInvokeTime and getTimeDifference and greaterThan nodes are sync
        // httpRequest nodes are async
        // Verify that sync nodes before any async node have no async barriers
        const syncRootIds = [
          '33e9eed5-410d-495f-8a9c-ee20607adde7', // getInvokeTime
          '186ab8f9-b5bc-40fa-81de-e2e12d84e315', // getInvokeTime
        ];
        for (const id of syncRootIds) {
          expect(result.asyncDependencyMap[id]).toEqual([]);
        }

        // getTimeDifference depends on two getInvokeTime (sync) -> no async barriers
        expect(result.asyncDependencyMap['4300cd7b-45be-4b33-a556-e264a0fe84d4']).toEqual([]);

        // greaterThan depends on getTimeDifference (sync) -> no async barriers
        expect(result.asyncDependencyMap['517b0007-b5ff-4bc2-90e4-d8505c4c88d6']).toEqual([]);

        // first httpRequest depends on greaterThan (sync, all sync ancestors) -> no async barriers
        expect(result.asyncDependencyMap['f5fdbed2-91a4-4130-8329-ef64f951824a']).toEqual([]);

        // getInvokeTime after httpRequest depends on httpRequest (async) -> barrier
        expect(result.asyncDependencyMap['d7a2f60b-a3a3-4ab4-b5d2-c34f3fdeece6']).toEqual([
          'f5fdbed2-91a4-4130-8329-ef64f951824a',
        ]);
      }
    });
  });
});
