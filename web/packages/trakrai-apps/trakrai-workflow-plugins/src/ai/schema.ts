import { z } from 'zod';

const GenerateNodeSchema = z.object({
  index: z
    .number()
    .describe(
      'A unique numeric index assigned to this newly generated node. Used by edges to reference new nodes via sourceId/targetId.',
    ),
  type: z
    .string()
    .describe(
      'The node type identifier. Must exactly match one of the available node types provided in the context.',
    ),
  configuration: z
    .record(z.string(), z.string())
    .describe(
      'Key-value configuration for the node. Keys are the input field names from the node schema. All values must be strings (even for numbers, booleans, etc.) — they will be parsed to the correct type later. Only include fields that should have static/default values, not fields that will receive values from incoming edges.',
    ),
  completed: z
    .literal(true)
    .describe(
      'Mark this as true at the end, so the system knows you are done configuring this node and it can be added to the workflow.',
    ),
});

const GenerateEdgeSchema = z.object({
  sourceId: z
    .union([z.string(), z.number()])
    .describe(
      'The source of this edge. Use a number to reference a newly generated node by its index, or a string to reference an existing node in the graph by its id.',
    ),
  targetId: z
    .union([z.string(), z.number()])
    .describe(
      'The target of this edge. Use a number to reference a newly generated node by its index, or a string to reference an existing node in the graph by its id.',
    ),
  sourceHandle: z
    .string()
    .describe(
      "The output handle name on the source node. Must match a property name from the source node's output schema.",
    ),
  targetHandle: z
    .string()
    .describe(
      'The input handle name on the target node. Must match either a property name from the target node\'s input schema, or "trigger" to connect to the target node\'s trigger input.',
    ),
  configuration: z
    .string()
    .optional()
    .describe(
      'Edge configuration value for conditional edges. Required when connecting to a "trigger" handle — the target node is only triggered when the source output equals this value. For boolean source outputs, use "true" or "false". For enum source outputs, use one of the enum values. Always a string representation; it will be parsed later. Omit for non-conditional data edges.',
    ),
  completed: z
    .literal(true)
    .describe(
      'Mark this as true at the end, so the system knows you are done configuring this edge and it can be added to the workflow.',
    ),
});

export const GenerateWorkflowSchema = z.object({
  nodes: z.array(GenerateNodeSchema).describe('The list of new nodes to add to the workflow.'),
  edges: z
    .array(GenerateEdgeSchema)
    .describe(
      'The list of edges connecting nodes. Edges define data flow between node outputs and inputs, and can also define trigger/conditional connections.',
    ),
});

export type GenerateWorkflow = z.infer<typeof GenerateWorkflowSchema>;
