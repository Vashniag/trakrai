import {
  getSourcePropertySchema,
  WorkflowNodeHandler,
  toObjectSchema,
  type NodeExecutionArgs,
  type NodeSchemaResolutionContext,
} from '@trakrai-workflow/core';

import type { z } from 'zod';

/**
 * Node handler that exposes the properties of an incoming object as individual output handles.
 *
 * Schema resolution follows the connected `inputHandle` edge. At runtime, values that are not
 * plain objects, including arrays and `null`, produce an empty output object instead of throwing.
 * When no upstream object is connected, the resolved output schema is an empty object.
 */
export class SpreadObjectNodeHandler<Context extends object> extends WorkflowNodeHandler<Context> {
  private readonly inputHandle: string;

  /**
   * @param options.inputHandle Input handle expected to receive the source object.
   */
  constructor({ inputHandle = 'object' }: { inputHandle?: string } = {}) {
    super();
    this.inputHandle = inputHandle;
  }

  override getInputSchema(): z.core.JSONSchema._JSONSchema {
    return {
      type: 'object',
      properties: {
        [this.inputHandle]: {
          type: 'object',
        },
      },
      required: [this.inputHandle],
      additionalProperties: false,
    };
  }

  override getOutputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    const incomingObjectEdge = context.edges.find(
      (edge) => edge.target === context.node.id && edge.targetHandle === this.inputHandle,
    );
    if (incomingObjectEdge === undefined) {
      return {
        type: 'object',
        properties: {},
        additionalProperties: false,
      };
    }
    const sourcePropertySchema = getSourcePropertySchema(incomingObjectEdge, context);
    const sourceObjectSchema = toObjectSchema(sourcePropertySchema);
    return {
      ...sourceObjectSchema,
      type: 'object',
      properties: { ...sourceObjectSchema.properties },
    };
  }

  override execute(args: NodeExecutionArgs<Context>): Record<string, unknown> {
    const value = args.input[this.inputHandle];
    if (
      value === null ||
      value === undefined ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  override getCategory(): string {
    return 'object';
  }

  override getDescription(): string {
    return 'Spreads properties from an incoming object into individual output handles.';
  }
}
