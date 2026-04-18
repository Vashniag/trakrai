import { type Connection } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createNodeRuntime } from '../core/runtime';
import { validateConnection } from '../core/validation/connection-validator';
import { TriggerHandle, type Edge, type Node, type NodeSchemas } from '../types';

const TEST_DESCRIPTION = 'should return $expected when $description';
const SUCCESS_EVENT_HANDLE = 'onSuccess###message';

describe('validateConnection', () => {
  const createNode = (id: string, type: string, configuration?: Record<string, unknown>): Node => ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { configuration: configuration ?? null },
  });

  const createEdge = (
    source: string,
    target: string,
    sourceHandle: string,
    targetHandle: string,
  ): Edge => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  });

  const mockNodeSchemas: NodeSchemas = {
    stringNode: {
      input: z.object({ input1: z.string() }),
      output: z.object({ output1: z.string(), output2: z.number() }),
      category: 'test',
      description: 'Test node',
    },
    numberNode: {
      input: z.object({ input1: z.number(), input2: z.string() }),
      output: z.object({ result: z.number() }),
      category: 'test',
      description: 'Test node',
    },
    triggerNode: {
      input: z.object({}),
      output: z.object({ data: z.string() }),
      category: TriggerHandle,
      description: 'Trigger node',
    },
    eventNode: {
      input: z.object({ input1: z.string() }),
      output: z.object({ output1: z.string() }),
      category: 'test',
      description: 'Node with events',
      events: {
        onSuccess: {
          description: 'Success event',
          data: z.object({ message: z.string(), code: z.number() }),
        },
        onError: {
          description: 'Error event',
          data: z.object({ error: z.string() }),
        },
      },
    },
    optionalNode: {
      input: z.object({ required: z.string(), optional: z.string().optional() }),
      output: z.object({ data: z.string() }),
      category: 'test',
      description: 'Node with optional input',
    },
  };

  const validateConnectionWithRuntime = (
    edge: Connection | Edge,
    nodes: Node[],
    edges: Edge[],
    nodeSchemas: NodeSchemas = mockNodeSchemas,
  ) => {
    const nodeRuntime = createNodeRuntime({
      nodes,
      edges,
      nodeSchemas,
    });
    return validateConnection(edge, nodes, edges, nodeRuntime);
  };

  describe('invalid handle cases', () => {
    const invalidHandleTestCases = [
      {
        description: 'sourceHandle is undefined',
        edge: { source: 'node1', target: 'node2', sourceHandle: undefined, targetHandle: 'input1' },
        expected: false,
      },
      {
        description: 'sourceHandle is null',
        edge: { source: 'node1', target: 'node2', sourceHandle: null, targetHandle: 'input1' },
        expected: false,
      },
      {
        description: 'targetHandle is undefined',
        edge: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: undefined,
        },
        expected: false,
      },
      {
        description: 'targetHandle is null',
        edge: { source: 'node1', target: 'node2', sourceHandle: 'output1', targetHandle: null },
        expected: false,
      },
    ];

    it.each(invalidHandleTestCases)(TEST_DESCRIPTION, ({ edge, expected }) => {
      const nodes = [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')];
      const edges: Edge[] = [];

      expect(
        validateConnectionWithRuntime(edge as unknown as Edge | Connection, nodes, edges),
      ).toBe(expected);
    });
  });

  describe('trigger handle cases', () => {
    const triggerTestCases = [
      {
        description: 'valid trigger connection',
        nodes: () => [createNode('trigger1', 'triggerNode'), createNode('node1', 'stringNode')],
        edges: [],
        connection: {
          source: 'trigger1',
          target: 'node1',
          sourceHandle: 'data',
          targetHandle: TriggerHandle,
        },
        expected: true,
      },
      {
        description: 'source node does not exist for trigger',
        nodes: () => [createNode('node1', 'stringNode')],
        edges: [],
        connection: {
          source: 'nonexistent',
          target: 'node1',
          sourceHandle: 'data',
          targetHandle: TriggerHandle,
        },
        expected: false,
      },
      {
        description: 'source node has no type for trigger',
        nodes: () => [
          { id: 'trigger1', type: undefined, position: { x: 0, y: 0 }, data: {} } as Node,
          createNode('node1', 'stringNode'),
        ],
        edges: [],
        connection: {
          source: 'trigger1',
          target: 'node1',
          sourceHandle: 'data',
          targetHandle: TriggerHandle,
        },
        expected: false,
      },
    ];

    it.each(triggerTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('node existence validation', () => {
    const nodeExistenceTestCases = [
      {
        description: 'source node does not exist',
        nodes: () => [createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'nonexistent',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'target node does not exist',
        nodes: () => [createNode('node1', 'stringNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'nonexistent',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'source node type is undefined',
        nodes: () => [
          { id: 'node1', type: undefined, position: { x: 0, y: 0 }, data: {} } as Node,
          createNode('node2', 'numberNode'),
        ],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'target node type is undefined',
        nodes: () => [
          createNode('node1', 'stringNode'),
          { id: 'node2', type: undefined, position: { x: 0, y: 0 }, data: {} } as Node,
        ],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
    ];

    it.each(nodeExistenceTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('duplicate connection validation', () => {
    const duplicateTestCases = [
      {
        description: 'target handle is already connected',
        nodes: () => [
          createNode('node1', 'stringNode'),
          createNode('node2', 'stringNode'),
          createNode('node3', 'numberNode'),
        ],
        edges: [createEdge('node1', 'node3', 'output1', 'input1')],
        connection: {
          source: 'node2',
          target: 'node3',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'connecting to different target handle',
        nodes: () => [
          createNode('node1', 'stringNode'),
          createNode('node2', 'stringNode'),
          createNode('node3', 'numberNode'),
        ],
        edges: [createEdge('node1', 'node3', 'output1', 'input1')],
        connection: {
          source: 'node2',
          target: 'node3',
          sourceHandle: 'output1',
          targetHandle: 'input2',
        },
        expected: true,
      },
    ];

    it.each(duplicateTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('configuration validation', () => {
    const configurationTestCases = [
      {
        description: 'target handle is already configured',
        nodes: () => [
          createNode('node1', 'stringNode'),
          createNode('node2', 'numberNode', { input1: 123 }),
        ],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output2',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'target handle is not configured',
        nodes: () => [
          createNode('node1', 'stringNode'),
          createNode('node2', 'numberNode', { input1: 123 }),
        ],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input2',
        },
        expected: true,
      },
      {
        description: 'target has null configuration',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input2',
        },
        expected: true,
      },
    ];

    it.each(configurationTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('schema validation', () => {
    const schemaTestCases = [
      {
        description: 'source node schema is undefined',
        nodes: () => [createNode('node1', 'unknownNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'target node schema is undefined',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'unknownNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'source handle does not exist in schema',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'nonexistent',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'target handle does not exist in schema',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'nonexistent',
        },
        expected: false,
      },
    ];

    it.each(schemaTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('type compatibility validation', () => {
    const typeCompatibilityTestCases = [
      {
        description: 'output and input types are compatible (string to string)',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'stringNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: true,
      },
      {
        description: 'output and input types are compatible (number to number)',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output2',
          targetHandle: 'input1',
        },
        expected: true,
      },
      {
        description: 'output and input types are incompatible (string to number)',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'output and input types are incompatible (number to string)',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output2',
          targetHandle: 'input2',
        },
        expected: false,
      },
    ];

    it.each(typeCompatibilityTestCases)(
      TEST_DESCRIPTION,
      ({ nodes, edges, connection, expected }) => {
        expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
      },
    );
  });

  describe('event handle validation', () => {
    const eventHandleTestCases = [
      {
        description: 'valid event handle connection',
        nodes: () => [createNode('node1', 'eventNode'), createNode('node2', 'stringNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: SUCCESS_EVENT_HANDLE,
          targetHandle: 'input1',
        },
        expected: true,
      },
      {
        description: 'event handle type does not match',
        nodes: () => [createNode('node1', 'eventNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: SUCCESS_EVENT_HANDLE,
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'event numeric field matches number input',
        nodes: () => [createNode('node1', 'eventNode'), createNode('node2', 'numberNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'onSuccess###code',
          targetHandle: 'input1',
        },
        expected: true,
      },
      {
        description: 'event name does not exist',
        nodes: () => [createNode('node1', 'eventNode'), createNode('node2', 'stringNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'nonexistent###message',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'event handle does not exist',
        nodes: () => [createNode('node1', 'eventNode'), createNode('node2', 'stringNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'onSuccess###nonexistent',
          targetHandle: 'input1',
        },
        expected: false,
      },
      {
        description: 'different event types',
        nodes: () => [createNode('node1', 'eventNode'), createNode('node2', 'stringNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'onError###error',
          targetHandle: 'input1',
        },
        expected: true,
      },
    ];

    it.each(eventHandleTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('optional field validation', () => {
    const optionalFieldTestCases = [
      {
        description: 'connecting required field to optional field',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'optionalNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'optional',
        },
        expected: true,
      },
      {
        description: 'connecting required field to required field',
        nodes: () => [createNode('node1', 'stringNode'), createNode('node2', 'optionalNode')],
        edges: [],
        connection: {
          source: 'node1',
          target: 'node2',
          sourceHandle: 'output1',
          targetHandle: 'required',
        },
        expected: true,
      },
    ];

    it.each(optionalFieldTestCases)(TEST_DESCRIPTION, ({ nodes, edges, connection, expected }) => {
      expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
    });
  });

  describe('complex scenarios', () => {
    const complexScenarioTestCases = [
      {
        description: 'validate multiple connections correctly',
        nodes: () => [
          createNode('node1', 'stringNode'),
          createNode('node2', 'stringNode'),
          createNode('node3', 'numberNode'),
        ],
        edges: [createEdge('node1', 'node3', 'output1', 'input2')],
        connection: {
          source: 'node2',
          target: 'node3',
          sourceHandle: 'output2',
          targetHandle: 'input1',
        },
        expected: true,
      },
      {
        description: 'handle trigger and regular connections on same node',
        nodes: () => [
          createNode('trigger1', 'triggerNode'),
          createNode('node1', 'stringNode'),
          createNode('node2', 'stringNode'),
        ],
        edges: [createEdge('node1', 'node2', 'output1', 'input1')],
        connection: {
          source: 'trigger1',
          target: 'node2',
          sourceHandle: 'data',
          targetHandle: TriggerHandle,
        },
        expected: true,
      },
      {
        description: 'handle event and regular outputs from same node',
        nodes: () => [
          createNode('node1', 'eventNode'),
          createNode('node2', 'stringNode'),
          createNode('node3', 'stringNode'),
        ],
        edges: [createEdge('node1', 'node2', 'output1', 'input1')],
        connection: {
          source: 'node1',
          target: 'node3',
          sourceHandle: SUCCESS_EVENT_HANDLE,
          targetHandle: 'input1',
        },
        expected: true,
      },
    ];

    it.each(complexScenarioTestCases)(
      TEST_DESCRIPTION,
      ({ nodes, edges, connection, expected }) => {
        expect(validateConnectionWithRuntime(connection, nodes(), edges)).toBe(expected);
      },
    );
  });
});
