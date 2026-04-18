# @trakrai-workflow/core

Runtime primitives and validation helpers for the Fluxery package set.

## Install

```bash
pnpm add @trakrai-workflow/core
```

## Exports

- `@trakrai-workflow/core`
- `@trakrai-workflow/core/utils`
- `@trakrai-workflow/core/node-runtime`

## Highlights

- Shared workflow types and plugin contracts
- Workflow validation helpers
- Schema conversion and runtime utilities

## Example

```ts
import {
  defineNodeSchemaRegistry,
  validateWorkflow,
  type WorkflowData,
} from '@trakrai-workflow/core';

const workflow: WorkflowData = {
  edges: [],
  nodes: [],
};

const nodeSchemas = defineNodeSchemaRegistry({});
const result = validateWorkflow(workflow.nodes, workflow.edges, nodeSchemas);
```
