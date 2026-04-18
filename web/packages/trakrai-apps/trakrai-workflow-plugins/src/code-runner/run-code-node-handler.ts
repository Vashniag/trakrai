import {
  getNodeConfiguration,
  getSchemaFromConfiguration,
  WorkflowNodeHandler,
  toObjectSchema,
  type NodeConfigurationField,
  type NodeExecutionArgs,
  type NodeSchemaResolutionContext,
  EMPTY_OBJECT_SCHEMA,
} from '@trakrai-workflow/core';

import { TypeScriptExecutor } from './typescript-executor';

import type { z } from 'zod';

/**
 * Workflow node handler that executes user-authored JavaScript or TypeScript in a sandboxed
 * QuickJS runtime.
 *
 * The node's input and output schemas are read from sibling configuration fields at execution time,
 * and the evaluated code must return an object that satisfies the configured output schema.
 */
export class RunCodeNodeHandler<Context extends object> extends WorkflowNodeHandler<Context> {
  private readonly codeField: string;
  private readonly inputSchemaField: string;
  private readonly outputSchemaField: string;

  constructor({
    codeField = 'code',
    inputSchemaField = 'inputSchema',
    outputSchemaField = 'outputSchema',
  }: {
    codeField?: string;
    inputSchemaField?: string;
    outputSchemaField?: string;
  } = {}) {
    super();
    this.codeField = codeField;
    this.inputSchemaField = inputSchemaField;
    this.outputSchemaField = outputSchemaField;
  }

  override getInputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    return getSchemaFromConfiguration(context.node, this.inputSchemaField) ?? EMPTY_OBJECT_SCHEMA;
  }

  override getOutputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    return getSchemaFromConfiguration(context.node, this.outputSchemaField) ?? EMPTY_OBJECT_SCHEMA;
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: this.inputSchemaField,
        label: 'Input Schema',
        description: 'Define the runtime input schema for this code node.',
        field: 'jsonSchemaBuilder',
      },
      {
        key: this.outputSchemaField,
        label: 'Output Schema',
        description: 'Define the expected output schema for this code node.',
        field: 'jsonSchemaBuilder',
      },
      {
        key: this.codeField,
        label: 'Code',
        description:
          'Write JavaScript/TypeScript. You can return an object directly or provide a function that receives input.',
        field: 'codeEditor',
        fieldConfig: {
          defaultValue: `(input: __InputType): __OutputType => {
  return {};
}`,
          inputSchemaField: this.inputSchemaField,
          outputSchemaField: this.outputSchemaField,
        },
      },
    ];
  }

  override async execute(args: NodeExecutionArgs<Context>): Promise<Record<string, unknown>> {
    const configuration = getNodeConfiguration(args.node);
    const code = configuration[this.codeField];
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error(`Run code node requires a non-empty '${this.codeField}' field`);
    }

    const executor = new TypeScriptExecutor({});

    const inputSchema = toObjectSchema(
      getSchemaFromConfiguration(args.node, this.inputSchemaField),
    );
    const outputSchema = toObjectSchema(
      getSchemaFromConfiguration(args.node, this.outputSchemaField),
    );
    const inputs = inputSchema.properties;
    const input = Object.fromEntries(Object.entries(args.input).filter(([key]) => key in inputs));

    const result = await executor.execute(code, input, inputSchema, outputSchema, args.logger);
    if (!result.success) {
      throw new Error(result.error ?? 'Run code execution failed');
    }
    const output = result.data;
    if (
      output === null ||
      output === undefined ||
      typeof output !== 'object' ||
      Array.isArray(output)
    ) {
      throw new Error('Run code node must return an object output');
    }
    return output as Record<string, unknown>;
  }

  override getCategory(): string {
    return 'code';
  }

  override getDescription(): string {
    return 'Executes user-provided TypeScript/JavaScript with dynamic input and output schemas.';
  }
}
