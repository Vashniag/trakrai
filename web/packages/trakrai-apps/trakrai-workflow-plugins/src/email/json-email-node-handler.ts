import {
  getNodeConfiguration,
  getSchemaFromConfiguration,
  toObjectSchema,
  type NodeConfigurationField,
  type NodeExecutionArgs,
  type NodeSchemaLike,
  type NodeSchemaResolutionContext,
  WorkflowNodeHandler,
} from '@trakrai-workflow/core';
import { z } from 'zod';

import { defaultJsonEmailDocument, defaultJsonEmailInputSchema } from './defaults';
import { cloneJson, resolveJsonEmailDocument } from './document';
import { renderJsonEmail } from './render-json-email';

const jsonEmailOutputSchema = z.toJSONSchema(
  z.object({
    html: z.string(),
    text: z.string(),
  }),
) as z.core.JSONSchema._JSONSchema;

export class JsonEmailNodeHandler<Context extends object> extends WorkflowNodeHandler<Context> {
  private readonly documentField: string;
  private readonly inputSchemaField: string;

  constructor({
    documentField = 'emailTemplate',
    inputSchemaField = 'inputSchema',
  }: {
    documentField?: string;
    inputSchemaField?: string;
  } = {}) {
    super();
    this.documentField = documentField;
    this.inputSchemaField = inputSchemaField;
  }

  override getInputSchema(context: NodeSchemaResolutionContext): NodeSchemaLike {
    return (
      getSchemaFromConfiguration(context.node, this.inputSchemaField) ?? defaultJsonEmailInputSchema
    );
  }

  override getOutputSchema(): NodeSchemaLike {
    return jsonEmailOutputSchema;
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: this.inputSchemaField,
        label: 'Input Schema',
        description: 'Define the runtime data accepted by this email template.',
        field: 'jsonSchemaBuilder',
        fieldConfig: {
          defaultValue: cloneJson(defaultJsonEmailInputSchema),
        },
      },
      {
        key: this.documentField,
        label: 'Email Template',
        description: 'Edit the JSON email spec and the demo data used by the preview.',
        field: 'jsonEmailEditor',
        fieldConfig: {
          defaultValue: cloneJson(defaultJsonEmailDocument),
        },
      },
    ];
  }

  override async execute(args: NodeExecutionArgs<Context>) {
    const configuration = getNodeConfiguration(args.node);
    const document = resolveJsonEmailDocument(configuration[this.documentField]);

    const inputSchema = toObjectSchema(
      getSchemaFromConfiguration(args.node, this.inputSchemaField) ?? defaultJsonEmailInputSchema,
    );
    const inputs = inputSchema.properties;
    const filteredInput =
      Object.keys(inputs).length === 0
        ? args.input
        : Object.fromEntries(Object.entries(args.input).filter(([key]) => key in inputs));

    return renderJsonEmail(document.spec, filteredInput);
  }

  override getCategory(): string {
    return 'email';
  }

  override getDescription(): string {
    return 'Renders HTML and plain-text email content from a json-render React Email template.';
  }
}

export { resolveJsonEmailDocument };
