import {
  getSchemaFromConfiguration,
  getSourcePropertySchema,
  WorkflowNodeHandler,
  toObjectSchema,
  TriggerHandle,
  type NodeExecutionArgs,
  type NodeConfigurationField,
  type NodeSchemaResolutionContext,
  type ResolvedObjectSchema,
} from '@trakrai-workflow/core';

import type { z } from 'zod';

/**
 * Node handler that collects all non-trigger inputs into a single object output.
 *
 * The optional configured base schema is merged with schemas inferred from incoming edges, and any
 * connected handle becomes required in the resolved input schema. Execution returns a shallow copy
 * of the resolved input object under `outputHandle`.
 */
export class CombineObjectNodeHandler<Context extends object> extends WorkflowNodeHandler<Context> {
  private readonly outputHandle: string;
  private readonly inputSchemaField: string;

  /**
   * @param options.outputHandle Output property name that will receive the combined input object.
   * @param options.inputSchemaField Node configuration key used to read the optional base schema.
   */
  constructor({
    outputHandle = 'result',
    inputSchemaField = 'inputSchema',
  }: {
    outputHandle?: string;
    inputSchemaField?: string;
  } = {}) {
    super();
    this.outputHandle = outputHandle;
    this.inputSchemaField = inputSchemaField;
  }

  /**
   * Builds the effective input schema by combining the configured base object schema with schemas
   * from all connected non-trigger input handles.
   */
  private getCombinedInputSchema(context: NodeSchemaResolutionContext): ResolvedObjectSchema {
    const configuredInputSchema = toObjectSchema(
      getSchemaFromConfiguration(context.node, this.inputSchemaField),
    );
    const combinedProperties: Record<string, z.core.JSONSchema._JSONSchema> = {
      ...configuredInputSchema.properties,
    };
    const required = new Set(configuredInputSchema.required ?? Object.keys(combinedProperties));

    for (const edge of context.edges) {
      if (
        edge.target !== context.node.id ||
        edge.targetHandle === undefined ||
        edge.targetHandle === null ||
        edge.targetHandle === '' ||
        edge.targetHandle === TriggerHandle
      ) {
        continue;
      }
      const sourceSchema = getSourcePropertySchema(edge, context);
      if (sourceSchema === undefined) {
        continue;
      }
      combinedProperties[edge.targetHandle] = sourceSchema;
      required.add(edge.targetHandle);
    }

    return {
      ...configuredInputSchema,
      type: 'object',
      properties: combinedProperties,
      required: Array.from(required),
    };
  }

  override getInputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    return this.getCombinedInputSchema(context);
  }

  override getOutputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    const inputSchema = this.getCombinedInputSchema(context);
    return {
      type: 'object',
      properties: {
        [this.outputHandle]: {
          type: 'object',
          properties: inputSchema.properties,
          required: inputSchema.required,
          additionalProperties: false,
        },
      },
      required: [this.outputHandle],
      additionalProperties: false,
    };
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: this.inputSchemaField,
        label: 'Input Schema',
        description:
          'Optional base schema. Runtime inputs connected via edges are merged into this schema.',
        field: 'jsonSchemaBuilder',
      },
    ];
  }

  override execute(args: NodeExecutionArgs<Context>): Record<string, unknown> {
    return {
      [this.outputHandle]: { ...args.input },
    };
  }

  override getCategory(): string {
    return 'object';
  }

  override getDescription(): string {
    return 'Combines all node inputs into a single output object.';
  }
}
