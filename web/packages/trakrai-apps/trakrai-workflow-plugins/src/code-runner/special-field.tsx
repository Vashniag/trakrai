'use client';

import { Button } from '@trakrai/design-system/components/button';
import { toObjectSchema, type NodeSchemaLike } from '@trakrai-workflow/core';

import type { FluxerySpecialFieldRendererProps, FluxerySpecialFields } from '@trakrai-workflow/ui';

import { WorkflowCodeEditor } from '../code-runner/workflow-code-editor';

const DIALOG_CODE_EDITOR_HEIGHT = 380;

const CodeEditorSpecialField = ({ value, onChange, context }: FluxerySpecialFieldRendererProps) => {
  const fieldConfig = context?.field?.fieldConfig;
  const resetValue = typeof fieldConfig?.defaultValue === 'string' ? fieldConfig.defaultValue : '';
  const configuration = context?.configuration ?? {};
  const inputSchemaField =
    typeof fieldConfig?.inputSchemaField === 'string' ? fieldConfig.inputSchemaField : undefined;
  const outputSchemaField =
    typeof fieldConfig?.outputSchemaField === 'string' ? fieldConfig.outputSchemaField : undefined;

  const inputSchema = toObjectSchema(
    inputSchemaField === undefined
      ? undefined
      : (configuration[inputSchemaField] as NodeSchemaLike | undefined),
  );
  const outputSchema = toObjectSchema(
    outputSchemaField === undefined
      ? undefined
      : (configuration[outputSchemaField] as NodeSchemaLike | undefined),
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          disabled={(typeof value === 'string' ? value : '') === resetValue}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => {
            onChange(resetValue);
          }}
        >
          Reset
        </Button>
      </div>
      <WorkflowCodeEditor
        height={DIALOG_CODE_EDITOR_HEIGHT}
        inputSchema={inputSchema}
        outputSchema={outputSchema}
        theme={context?.theme === 'dark' ? 'vs-dark' : 'light'}
        value={typeof value === 'string' ? value : ''}
        onChange={(nextCode) => {
          onChange(nextCode);
        }}
      />
    </div>
  );
};

/**
 * Special field registration for the dialog-based code editor used by {@link RunCodeNodeHandler}.
 *
 * The hosting node configuration should provide `fieldConfig.inputSchemaField` and
 * `fieldConfig.outputSchemaField` so the editor can derive the generated `__InputType` and
 * `__OutputType` helpers from sibling schema fields.
 */
export const codeEditorSpecialField = {
  codeEditor: {
    type: 'editor',
    component: CodeEditorSpecialField,
    display: 'dialog',
    dialogTitle: 'Code Editor',
    dialogDescription: 'Write JavaScript/TypeScript for this node.',
  },
} satisfies FluxerySpecialFields;
