import { toObjectSchema, type NodeSchemaLike } from '@trakrai-workflow/core';

import { JsonSchemaBuilder } from './json-schema-builder';

import type { FluxerySpecialFieldRendererProps, FluxerySpecialFields } from '../flow-types';

const InternalJsonSchemaBuilderField = ({
  value,
  onChange,
  context,
}: FluxerySpecialFieldRendererProps) => {
  const defaultValue = context?.field?.fieldConfig?.defaultValue as NodeSchemaLike | undefined;
  const schemaValue = toObjectSchema((value as NodeSchemaLike | undefined) ?? defaultValue);
  return (
    <JsonSchemaBuilder
      maxHeight="360px"
      value={schemaValue}
      onValueChange={(nextSchema) => {
        onChange(nextSchema);
      }}
    />
  );
};

/**
 * Pre-configured special field that opens a JSON schema builder dialog.
 *
 * Register this in your `specialFields` map to enable visual JSON schema editing
 * for node configuration fields marked with `jsonSchemaBuilder`. The exported
 * object is a partial registry, so it can be passed directly as `specialFields`
 * or merged with additional custom field definitions.
 *
 * @example
 * ```tsx
 * <FluxeryProvider
 *   specialFields={jsonEditorSpecialField}
 *   ...
 * />
 * ```
 */
export const jsonEditorSpecialField = {
  jsonSchemaBuilder: {
    type: 'editor',
    component: InternalJsonSchemaBuilderField,
    display: 'dialog',
    dialogTitle: 'Schema Builder',
    dialogDescription: 'Define the JSON schema for this field.',
  },
} satisfies FluxerySpecialFields;
