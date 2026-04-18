'use client';

/**
 * Public root entrypoint for `@trakrai-workflow/ui`.
 *
 * Re-exports the editor providers, shell components, sidebar helpers, schema-aware
 * form primitives, and selected utility types that make up the supported package surface.
 */
export {
  FluxeryProvider,
  PluginTRPCProvider,
  useTRPCPluginAPIs,
  getTRPCPluginAPIs,
  useFlow,
} from './ui/flow-context';
export { FluxeryCanvasProvider, useFluxeryCanvas } from './ui/canvas-context';
export { FluxeryEditorActionsProvider, useFluxeryEditorActions } from './ui/editor-actions-context';
export * from './ui/fluxery';
export type {
  FluxeryConfigRecord,
  FluxeryConfigValue,
  FluxeryContextValue,
  FluxeryEditingApi,
  FluxeryFlowViewProps,
  FluxerySpecialFieldConfig,
  FluxerySpecialFieldContext,
  FluxerySpecialFieldRendererProps,
  FluxerySpecialFields,
  FluxeryTheme,
} from './ui/flow-types';
export { useNodeSchemaData, resolveNodeSchemaState } from './ui/sidebar/use-node-schema';
export { InputHandlesRenderer, OutputHandlesRenderer } from './ui/nodes/handles-renderer';
export { LabeledHandle } from './ui/nodes/labeled-handle';
export { SchemaNodeShell } from './ui/nodes/schema-node-shell';
export { JsonSchemaObjectForm } from './ui/sidebar/info/form-fields';
export { RegularField } from './ui/sidebar/info/form-fields';
export type { FieldValue } from './ui/sidebar/info/form-fields';
export { getInputTooltipContent, getOutputTooltipContent } from './ui/nodes/display-type';
export type { FluxerySidebarTabComponent } from './ui/sidebar';
export * from './ui/json-schema-builder';
