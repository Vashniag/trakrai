# @trakrai-workflow/inngest

Inngest-specific adapters for serving workflow routes and executing workflows.

## Install

```bash
pnpm add @trakrai-workflow/inngest @trakrai-workflow/core inngest zod
```

## Exports

- `automation`
- `inngestPlugin`
- `InferContext`

## Example

```ts
import { automation, inngestPlugin } from '@trakrai-workflow/inngest';

const workflowRoutePlugin = inngestPlugin(inngest, functions);

const workflowAutomation = inngest.createFunction(
  { id: 'trigger-workflow', triggers: [{ event: 'workflow-automation' }] },
  async (context) =>
    automation(
      context,
      nodeSchemas,
      nodeFunctions,
      (data) => ({ workflowId: data.workflowId as string }),
      ({ workflowId }) => getWorkflowData(workflowId),
    ),
);
```
