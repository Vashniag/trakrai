import {
  getNodeConfiguration,
  getSchemaFromConfiguration,
  toObjectSchema,
  WorkflowNodeHandler,
  type NodeConfigurationField,
  type NodeExecutionArgs,
  type NodeSchemaResolutionContext,
  type ResolvedObjectSchema,
} from '@trakrai-workflow/core';

import MergeNode from './merge-node';
import {
  MERGE_OUTPUT_SCHEMA_KEY,
  buildMergeHandleId,
  getMergeInputsFromConfig,
} from './merge-node-utils';

import type { z } from 'zod';

const DEFAULT_OUTPUT_SCHEMA: ResolvedObjectSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

/**
 * Expands the configured merge output schema into per-input handles such as
 * `<inputId>__<fieldName>`.
 */
const buildMergeInputSchema = (
  outputSchema: ResolvedObjectSchema,
  inputs: { id: string }[],
): ResolvedObjectSchema => {
  const properties: Record<string, z.core.JSONSchema._JSONSchema> = {};
  const outputProperties = outputSchema.properties;
  const outputRequired = outputSchema.required ?? Object.keys(outputProperties);
  const required: string[] = [];

  for (const input of inputs) {
    for (const [field, schema] of Object.entries(outputProperties)) {
      const handleId = buildMergeHandleId(input.id, field);
      properties[handleId] = schema as z.core.JSONSchema._JSONSchema;
      if (outputRequired.includes(field)) {
        required.push(handleId);
      }
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
};

/**
 * Resolves the configured merge output schema and falls back to an empty object shape when the
 * node has not been configured yet.
 */
const getMergeOutputSchema = (context: NodeSchemaResolutionContext): ResolvedObjectSchema => {
  const configuredSchema = getSchemaFromConfiguration(context.node, MERGE_OUTPUT_SCHEMA_KEY);
  if (configuredSchema === undefined) {
    return { ...DEFAULT_OUTPUT_SCHEMA };
  }
  return toObjectSchema(configuredSchema);
};

/**
 * Chooses which configured input triggered execution by preferring the first input that satisfies
 * all required fields, then falling back to the first input that provided any field.
 */
const selectMergeInputId = (
  inputs: { id: string }[],
  outputSchema: ResolvedObjectSchema,
  input: Record<string, unknown>,
): string | null => {
  const outputProperties = outputSchema.properties;
  const outputRequired = outputSchema.required ?? Object.keys(outputProperties);

  const hasAllRequired = (inputId: string) =>
    outputRequired.every((field) => buildMergeHandleId(inputId, field) in input);

  const hasAnyField = (inputId: string) =>
    Object.keys(outputProperties).some((field) => buildMergeHandleId(inputId, field) in input);

  for (const entry of inputs) {
    if (hasAllRequired(entry.id)) {
      return entry.id;
    }
  }

  for (const entry of inputs) {
    if (hasAnyField(entry.id)) {
      return entry.id;
    }
  }

  return null;
};

/**
 * Node handler for a UI-configured merge node that runs when any predecessor completes.
 *
 * The node configuration defines both the expected output object shape and the list of logical
 * inputs. Each logical input is expanded into concrete handles with {@link buildMergeHandleId}.
 * At execution time the handler selects the first configured input whose submitted values satisfy
 * the resolved schema and returns those values under the output field names. Execution throws when
 * no logical inputs are configured, when no predecessor provided any merge values, or when a
 * required output field is missing from the winning input.
 */
export class MergeAnyNodeHandler<Context extends object> extends WorkflowNodeHandler<Context> {
  override getInputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    const outputSchema = getMergeOutputSchema(context);
    const configuration = getNodeConfiguration(context.node);
    const inputs = getMergeInputsFromConfig(configuration);
    return buildMergeInputSchema(outputSchema, inputs);
  }

  override getOutputSchema(context: NodeSchemaResolutionContext): z.core.JSONSchema._JSONSchema {
    return getMergeOutputSchema(context);
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: MERGE_OUTPUT_SCHEMA_KEY,
        label: 'Output Schema',
        description:
          'Defines the unified output shape. Each merge input must supply values for these fields.',
        field: 'jsonSchemaBuilder',
      },
    ];
  }

  override getCategory(): string {
    return 'object';
  }

  override getDescription(): string {
    return 'Merges multiple inputs into one unified output and runs when any input completes.';
  }

  override getDependencyMode(_context: NodeSchemaResolutionContext): 'any' {
    return 'any';
  }

  override execute(args: NodeExecutionArgs<Context>): Record<string, unknown> {
    const configuration = getNodeConfiguration(args.node);
    const inputs = getMergeInputsFromConfig(configuration);
    if (inputs.length === 0) {
      throw new Error('Merge node has no inputs configured');
    }

    const outputSchema = toObjectSchema(
      getSchemaFromConfiguration(args.node, MERGE_OUTPUT_SCHEMA_KEY),
    );
    const outputProperties = outputSchema.properties;
    const outputRequired = outputSchema.required ?? Object.keys(outputProperties);

    const activeInputId = selectMergeInputId(inputs, outputSchema, args.input);
    if (activeInputId === null) {
      throw new Error('Merge node did not receive input values from any predecessor');
    }

    const output: Record<string, unknown> = {};
    for (const field of Object.keys(outputProperties)) {
      const handleId = buildMergeHandleId(activeInputId, field);
      if (handleId in args.input) {
        output[field] = args.input[handleId];
        continue;
      }
      if (outputRequired.includes(field)) {
        throw new Error(`Merge input '${activeInputId}' is missing required field '${field}'`);
      }
    }

    return output;
  }
  override getRenderer(): React.ComponentType<{ nodeId: string }> {
    return MergeNode;
  }
}
