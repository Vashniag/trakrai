# @trakrai-workflow/schemas

Built-in node schemas, handlers, and function packs for common workflow nodes.

## Install

```bash
pnpm add @trakrai-workflow/schemas @trakrai-workflow/ui @trakrai/design-system
```

Install the required peers in your app as well: `react`, `react-dom`, `@xyflow/react`, `lucide-react`, and `zod`.

## Highlights

- Arithmetic, conditional, string, array, logic, and date-time node packs
- HTTP node schemas and functions
- Object composition handlers: `CombineObjectNodeHandler`, `SpreadObjectNodeHandler`, and `MergeAnyNodeHandler`

## Example

```ts
import {
  ArithmeticNodeFunctions,
  ArithmeticNodeSchemas,
  CombineObjectNodeHandler,
  ConditionalNodeFunctions,
  ConditionalNodeSchemas,
} from '@trakrai-workflow/schemas';

const nodeSchemas = {
  ...ArithmeticNodeSchemas,
  ...ConditionalNodeSchemas,
};

const nodeFunctions = {
  ...ArithmeticNodeFunctions,
  ...ConditionalNodeFunctions,
};

const nodeHandlers = {
  combineObject: new CombineObjectNodeHandler(),
};
```

Dynamic handlers such as `CombineObjectNodeHandler`, `SpreadObjectNodeHandler`, and
`MergeAnyNodeHandler` are registered separately through your runtime's `nodeHandlers` map.
