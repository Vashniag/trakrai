/* eslint-disable sonarjs/no-small-switch */
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { type LanguageModelV3 } from '@ai-sdk/provider';
import {
  createNodeRuntime,
  defineHttpPlugin,
  jsonSchemaToTypeString,
  type NodeHandlerRegistry,
  type NodeSchemas,
} from '@trakrai-workflow/core';
import { gateway, Output, streamText, wrapLanguageModel } from 'ai';

import { GenerateWorkflowSchema } from './schema';

const INVALID_AI_ROUTE = 'Invalid AI route parameter';

const generateNodesContext = <Context extends object>(
  nodeSchemas: NodeSchemas,
  nodeHandlers?: NodeHandlerRegistry<Context>,
) => {
  const nodeTypes = Array.from(
    new Set([...Object.keys(nodeSchemas), ...Object.keys(nodeHandlers ?? {})]),
  );
  const previewNodes = nodeTypes.map((type, index) => ({
    id: `__ai-preview__${index}__${type}`,
    type,
    position: { x: 0, y: 0 },
    data: { configuration: null },
  }));
  const nodeRuntime = createNodeRuntime({
    nodes: previewNodes,
    edges: [],
    nodeSchemas,
    nodeHandlers,
  });
  return nodeTypes
    .map((type, index) => {
      const schema = nodeRuntime.resolveNodeSchemaById(`__ai-preview__${index}__${type}`);
      if (schema === undefined) {
        return null;
      }
      const inputJsonSchema = jsonSchemaToTypeString(schema.input);
      const outputJsonSchema = jsonSchemaToTypeString(schema.output);

      let context =
        `Node Type: "${type}"\n` +
        `  Category: ${schema.category}\n` +
        `  Description: ${schema.description}\n` +
        `  Input Schema: ${inputJsonSchema}\n` +
        `  Output Schema: ${outputJsonSchema}`;

      if (schema.events !== undefined) {
        const eventsContext = Object.entries(schema.events)
          .map(([eventName, event]) => {
            const eventJsonSchema = jsonSchemaToTypeString(event.data);
            return (
              `    Event: "${eventName}"\n` +
              `      Description: ${event.description}\n` +
              `      Data Schema: ${eventJsonSchema}`
            );
          })
          .join('\n');
        context += `\n  Events:\n${eventsContext}`;
      }

      return context;
    })
    .filter((value): value is string => value !== null)
    .join('\n\n---\n\n');
};

const SYSTEM_PROMPT = `You are a workflow generation assistant. You generate workflow graphs consisting of nodes and edges based on a user's description.

## Workflow Concepts

A workflow is a directed graph of nodes connected by edges. Each node performs a specific operation, taking inputs and producing outputs.

### Nodes

Each node has:
- A **type** that determines its behavior (must exactly match one of the available node types).
- An **input schema** defining the data it accepts — each property in the input schema corresponds to a **target handle** on the node.
- An **output schema** defining the data it produces — each property in the output schema corresponds to a **source handle** on the node.
- A **trigger input handle** (named "trigger") — a special handle that controls whether the node executes. If an edge connects to the trigger handle, the node only executes when the trigger condition is met.
- A **configuration** — static key-value pairs for input fields that receive hardcoded values instead of values from incoming edges. All configuration values must be strings, even if the underlying type is a number, boolean, array, or object. They will be parsed to the correct type later.

When generating nodes:
- Assign each new node a unique numeric \`index\` starting from 0.
- Set the \`type\` to one of the available node types listed below.
- Only include input fields in \`configuration\` that should have static/default values. Do NOT include fields that will receive their values from incoming edges.

### Edges

Edges define data flow and trigger conditions between nodes. Each edge connects a **source handle** (output) of one node to a **target handle** (input or trigger) of another node.

Each edge has:
- **sourceId**: A number (index of a newly generated node) or a string (id of a pre-existing node in the graph).
- **targetId**: A number (index of a newly generated node) or a string (id of a pre-existing node in the graph).
- **sourceHandle**: The name of the output property on the source node being connected.
- **targetHandle**: The name of the input property on the target node, OR "trigger" to control the target's execution.
- **configuration** (optional): A string value for conditional edges. Required when \`targetHandle\` is "trigger".

#### Conditional Edges (Trigger Connections)

When an edge connects to a target's **"trigger"** handle, it becomes a conditional trigger edge:
- The source handle must produce a **boolean** or **enum** value.
- The edge's \`configuration\` must specify the value that triggers execution.
  - For boolean outputs: use \`"true"\` or \`"false"\`.
  - For enum outputs: use one of the enum string values.
- The target node only executes when the source output equals the edge's configuration value.
- This enables branching logic: e.g., an "equals" node outputs a boolean, and two different branches are triggered by "true" and "false" configuration values respectively.

#### Data Edges (Regular Connections)

For non-trigger edges, the edge simply passes data from the source output to the target input:
- \`sourceHandle\` must match a property in the source node's output schema.
- \`targetHandle\` must match a property in the target node's input schema.
- The types should be compatible between the source output and target input.
- Do NOT set \`configuration\` for regular data edges.

### Existing Graph Nodes

If existing nodes are provided, you can connect to them by using their string id as \`sourceId\` or \`targetId\` in edges. You can read their output schemas to know what data they produce, and connect newly generated nodes to receive that data.

## Instructions

1. Analyze the user's description to understand the desired workflow logic.
2. Select the appropriate node types from the available list.
3. Assign sequential indices to new nodes starting from 0.
4. Configure node input values that should be static (as string values in configuration).
5. Create edges to wire up data flow between nodes — connecting outputs to inputs.
6. Use trigger handles and conditional edges for branching / conditional execution.
7. If existing graph nodes are provided, integrate them by connecting to/from them using their string ids.
8. Ensure all handle names exactly match the property names defined in the node schemas.
`;

/**
 * Registers the `/ai/generate-workflow` HTTP endpoint used by the editor's AI workflow generator.
 *
 * Pass the same `nodeSchemas` and optional `nodeHandlers` that back the live editor/runtime so the
 * model is prompted with the actual node catalog, schema contracts, and event payloads available in
 * the host app.
 */
export const aiPlugin = <Context extends object>({
  fastModel = gateway('xai/grok-4.1-fast-reasoning'),
  nodeSchemas,
  nodeHandlers,
}: {
  fastModel?: LanguageModelV3;
  nodeSchemas: NodeSchemas;
  nodeHandlers?: NodeHandlerRegistry<Context>;
}) =>
  defineHttpPlugin({
    path: '/ai',
    handler: async (request, { getRemainingPath }) => {
      const nodesContext = generateNodesContext(nodeSchemas, nodeHandlers);
      const path = getRemainingPath();
      switch (path) {
        case 'generate-workflow':
          return generateWorkflow(request, fastModel, nodesContext);
        default:
          return Response.json({ message: INVALID_AI_ROUTE }, { status: 400 });
      }
    },
  });

type ExistingNode = {
  id: string;
  type: string;
};

type GenerateWorkflowBody = {
  description: string;
  existingNodes?: ExistingNode[];
};

const generateWorkflow = async (
  request: Request,
  fastModel: LanguageModelV3,
  nodesContext: string,
) => {
  const body = (await request.json()) as GenerateWorkflowBody;
  const { description, existingNodes } = body;

  let existingNodesContext = '';
  if (existingNodes !== undefined && existingNodes.length > 0) {
    const nodesList = existingNodes
      .map((node) => `- Node id: "${node.id}", type: "${node.type}"`)
      .join('\n');
    existingNodesContext = `\n\n## Existing Nodes in the Graph\n\nThe following nodes already exist in the workflow. You can connect to/from them using their string ids.\n\n${nodesList}`;
  }

  const userPrompt = `## User Request\n\n${description}${existingNodesContext}\n\n## Available Node Types\n\n${nodesContext}`;
  const wrappedModel = wrapLanguageModel({ model: fastModel, middleware: devToolsMiddleware() });
  const generation = streamText({
    model: process.env.NODE_ENV === 'development' ? wrappedModel : fastModel,
    output: Output.object({ schema: GenerateWorkflowSchema }),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });
  return generation.toTextStreamResponse();
};
