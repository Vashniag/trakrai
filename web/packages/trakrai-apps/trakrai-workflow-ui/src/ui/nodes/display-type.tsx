import { useMemo } from 'react';

import { jsonSchemaToTypeString } from '@trakrai-workflow/core';
import { type z } from 'zod';

type JSONSchema = z.core.JSONSchema.JSONSchema;

/** Renders a JSON schema type as a readable string or formatted code block. */
const DisplayType = ({ schema }: { schema: JSONSchema }) => {
  const typeStr = useMemo(() => jsonSchemaToTypeString(schema), [schema]);
  if (typeStr.split('\n').length > 1) {
    return (
      <div>
        <strong>Type:</strong>
        <pre className="text-xs">
          <code>{typeStr}</code>
        </pre>
      </div>
    );
  }
  return (
    <p>
      <strong>Type:</strong> {typeStr}
    </p>
  );
};

/**
 * Generates tooltip content for an input handle, showing type and configured value.
 *
 * When an input is configured inline rather than connected via an edge, the tooltip
 * includes the serialized value so the canvas can explain why the handle is not
 * currently connectable.
 *
 * @param propSchema - The JSON schema for the input property.
 * @param configuredValue - The currently configured value, if any.
 * @param isConfigured - Whether the input is configured via inline value (not edge).
 * @returns A React element with type information and, when applicable, the inline value.
 */
export const getInputTooltipContent = (
  propSchema: JSONSchema | undefined,
  configuredValue: unknown,
  isConfigured: boolean,
): React.ReactElement => {
  if (isConfigured && configuredValue !== undefined) {
    return (
      <div className="space-y-1">
        <DisplayType schema={propSchema ?? {}} />
        <p>
          <strong>Value:</strong> {JSON.stringify(configuredValue)}
        </p>
      </div>
    );
  }

  return (
    <div>
      <DisplayType schema={propSchema ?? {}} />
    </div>
  );
};

/**
 * Generates tooltip content for an output handle, showing its JSON schema type.
 *
 * Missing schemas fall back to an empty schema object so callers can render a
 * stable tooltip even when node schema resolution is partial.
 *
 * @param propSchema - The JSON schema for the output property.
 * @returns A React element with type information.
 */
export const getOutputTooltipContent = (propSchema: JSONSchema | undefined): React.ReactElement => {
  return (
    <div>
      <DisplayType schema={propSchema ?? {}} />
    </div>
  );
};

/**
 * Generates tooltip content for the synthetic execution-success handle used by
 * conditional routing edges.
 */
export const getExecutionSuccessTooltipContent = (): React.ReactElement => {
  return (
    <div className="space-y-1">
      <DisplayType schema={{ type: 'boolean' }} />
      <p>True when the node succeeds. False when it fails.</p>
    </div>
  );
};
