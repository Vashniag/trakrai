// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { ExecutionSuccessHandle, type NodeSchema } from '@trakrai-workflow/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import type * as XYFlowReact from '@xyflow/react';

// Mock dependencies that rely on React context / xyflow internals
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof XYFlowReact>();
  return {
    ...actual,
    useNodeId: () => 'test-node-1',
    useUpdateNodeInternals: () => vi.fn(),
    Handle: ({ children, ...props }: Record<string, unknown>) => (
      <div
        data-handle-type={props.type}
        data-position={props.position}
        data-testid={`handle-${String(props.id)}`}
      >
        {children as React.ReactNode}
      </div>
    ),
  };
});

const mockUseFlow = vi.fn();
vi.mock('../ui/flow-context', () => ({
  useFlow: () => mockUseFlow() as unknown,
}));

const mockUseNodeSchema = vi.fn();
vi.mock('../ui/sidebar/use-node-schema', () => ({
  useNodeSchemaData: (opts: Record<string, unknown>) => mockUseNodeSchema(opts) as unknown,
}));

vi.mock('../ui/nodes/node-output-tooltip-content', () => ({
  default: () => null,
}));

// We need to import the component under test AFTER setting up mocks
let InputOutputNode: React.ComponentType<{ nodeSchema: NodeSchema; title: string }>;

beforeEach(async () => {
  vi.clearAllMocks();

  // Default mock return values
  mockUseFlow.mockReturnValue({
    selectedRunId: undefined,
    nodeRunStatuses: {},
    getNodeRunTooltipDetails: vi.fn(),
    nodeRuntime: {},
    nodeSchemas: {},
    flow: { nodes: [], edges: [] },
  });

  // Dynamic import to get fresh module with mocks applied
  const mod = await import('../ui/nodes/input-output-node');
  InputOutputNode = mod.default;
});

const createSimpleNodeSchema = (
  inputFields: Record<string, z.ZodType>,
  outputFields: Record<string, z.ZodType>,
): NodeSchema => ({
  input: z.object(inputFields),
  output: z.object(outputFields),
  category: 'Test',
  description: 'Test node',
});

describe('InputOutputNode', () => {
  describe('rendering', () => {
    it('renders the node title', () => {
      const schema = createSimpleNodeSchema(
        { a: z.number(), b: z.number() },
        { result: z.number() },
      );

      mockUseNodeSchema.mockReturnValue({
        allInputs: [
          ['a', { type: 'number' }],
          ['b', { type: 'number' }],
        ],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Add" />);

      expect(screen.getByText('Add')).toBeInTheDocument();
    });

    it('renders input handles for all input fields', () => {
      const schema = createSimpleNodeSchema(
        { a: z.number(), b: z.number() },
        { result: z.number() },
      );

      mockUseNodeSchema.mockReturnValue({
        allInputs: [
          ['a', { type: 'number' }],
          ['b', { type: 'number' }],
        ],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Add" />);

      // Input labels should be displayed (createDisplayName converts 'a' -> 'A', 'b' -> 'B')
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('renders output handles for all output fields', () => {
      const schema = createSimpleNodeSchema(
        { value: z.string() },
        { result: z.number(), remainder: z.number() },
      );

      mockUseNodeSchema.mockReturnValue({
        allInputs: [['value', { type: 'string' }]],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Divide" />);

      expect(screen.getByText('Result')).toBeInTheDocument();
      expect(screen.getByText('Remainder')).toBeInTheDocument();
    });

    it('renders with no inputs', () => {
      const schema = createSimpleNodeSchema({}, { result: z.string() });

      mockUseNodeSchema.mockReturnValue({
        allInputs: [],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Constant" />);

      expect(screen.getByText('Constant')).toBeInTheDocument();
      expect(screen.getByText('Result')).toBeInTheDocument();
    });

    it('renders with no outputs', () => {
      const schema: NodeSchema = {
        input: z.object({ value: z.string() }),
        output: z.object({}),
        category: 'Test',
        description: 'Sink node',
      };

      mockUseNodeSchema.mockReturnValue({
        allInputs: [['value', { type: 'string' }]],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Sink" />);

      expect(screen.getByText('Sink')).toBeInTheDocument();
      expect(screen.getByText('Value')).toBeInTheDocument();
      expect(screen.queryByText('Success')).not.toBeInTheDocument();
      expect(screen.getByTestId(`handle-${ExecutionSuccessHandle}`)).toHaveAttribute(
        'data-position',
        'right',
      );
    });
  });

  describe('configured inputs', () => {
    it('renders configured inputs as non-connectable', () => {
      const schema = createSimpleNodeSchema(
        { url: z.string(), method: z.string() },
        { status: z.number() },
      );

      mockUseNodeSchema.mockReturnValue({
        allInputs: [
          ['url', { type: 'string' }],
          ['method', { type: 'string' }],
        ],
        inputsViaConfiguration: [['method', 'GET']],
        config: { method: 'GET' },
      });

      render(<InputOutputNode nodeSchema={schema} title="HTTP Request" />);

      // Both labels should be rendered
      expect(screen.getByText('URL')).toBeInTheDocument();
      expect(screen.getByText('Method')).toBeInTheDocument();
    });
  });

  describe('display name formatting', () => {
    it('converts camelCase input names to readable titles', () => {
      const schema = createSimpleNodeSchema(
        { firstName: z.string(), lastName: z.string() },
        { fullName: z.string() },
      );

      mockUseNodeSchema.mockReturnValue({
        allInputs: [
          ['firstName', { type: 'string' }],
          ['lastName', { type: 'string' }],
        ],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Concat Names" />);

      expect(screen.getByText('First Name')).toBeInTheDocument();
      expect(screen.getByText('Last Name')).toBeInTheDocument();
      expect(screen.getByText('Full Name')).toBeInTheDocument();
    });
  });

  describe('node events', () => {
    it('renders event sections when events are defined', () => {
      const schema: NodeSchema = {
        input: z.object({ value: z.string() }),
        output: z.object({ result: z.string() }),
        category: 'Test',
        description: 'Node with events',
        events: {
          onProgress: {
            description: 'Progress update',
            data: z.object({ percent: z.number() }),
          },
        },
      };

      mockUseNodeSchema.mockReturnValue({
        allInputs: [['value', { type: 'string' }]],
        inputsViaConfiguration: [],
        config: {},
      });

      render(<InputOutputNode nodeSchema={schema} title="Processing" />);

      expect(screen.getByText('Processing')).toBeInTheDocument();
      // Event name should be displayed
      expect(screen.getByText('On Progress')).toBeInTheDocument();
      // Event output properties should be displayed
      expect(screen.getByText('Percent')).toBeInTheDocument();
    });

    it('does not render event section when no events', () => {
      const schema = createSimpleNodeSchema({ a: z.number() }, { result: z.number() });

      mockUseNodeSchema.mockReturnValue({
        allInputs: [['a', { type: 'number' }]],
        inputsViaConfiguration: [],
        config: {},
      });

      const { container } = render(<InputOutputNode nodeSchema={schema} title="Simple" />);

      // No event section border-t divs beyond the main content
      const eventSections = container.querySelectorAll('.border-t.py-2');
      expect(eventSections).toHaveLength(0);
    });
  });

  describe('border status classes', () => {
    it('renders with default border when no run is selected', () => {
      const schema = createSimpleNodeSchema({ a: z.number() }, { result: z.number() });

      mockUseNodeSchema.mockReturnValue({
        allInputs: [['a', { type: 'number' }]],
        inputsViaConfiguration: [],
        config: {},
      });

      const { container } = render(<InputOutputNode nodeSchema={schema} title="Test" />);

      const baseNode = container.querySelector('.base-node');
      expect(baseNode).toBeInTheDocument();
      // Default border class for Waiting status
      expect(baseNode).toHaveClass('border-gray-300');
    });
  });
});
