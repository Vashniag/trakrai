import { getInputTooltipContent, getOutputTooltipContent } from './display-type';
import { InputOutputHandle } from './input-output-handle';

import type { InputEntry } from '../sidebar/use-node-schema';
import type { z } from 'zod';

type JSONSchema = z.core.JSONSchema.JSONSchema;

/**
 * Renders all input handles for a node.
 *
 * Displays a vertical list of input handles with tooltips showing type information
 * and configured values. Any property present in `inputsViaConfiguration` is treated
 * as satisfied by inline configuration, so its handle is rendered as non-connectable
 * to prevent mixing a manual value with an incoming edge for the same input.
 *
 * @param allInputs - All input entries (name + schema pairs) for the node.
 * @param inputJson - The full input JSON schema containing property definitions.
 * @param config - The current node configuration values.
 * @param inputsViaConfiguration - Inputs that have been configured (not connected via edge).
 * @param tooltipEnabled - Whether tooltips are shown on hover.
 */
export const InputHandlesRenderer = ({
  allInputs,
  inputJson,
  config,
  inputsViaConfiguration,
  tooltipEnabled,
}: {
  allInputs: InputEntry[];
  inputJson: JSONSchema;
  config: Record<string, unknown>;
  inputsViaConfiguration: InputEntry[];
  tooltipEnabled: boolean;
}) => {
  return (
    <div className="flex flex-col items-start justify-center gap-4">
      {allInputs.map(([propName]) => {
        const propSchema = inputJson.properties?.[propName] as JSONSchema | undefined;
        const configuredEntry = inputsViaConfiguration.find(
          ([configName]) => configName === propName,
        );
        const isConfigured = configuredEntry !== undefined;
        const configuredValue = config[propName];

        return (
          <InputOutputHandle
            key={propName}
            connectable={!isConfigured}
            propName={propName}
            tooltipContent={getInputTooltipContent(propSchema, configuredValue, isConfigured)}
            tooltipEnabled={tooltipEnabled}
            type="input"
          />
        );
      })}
    </div>
  );
};

/**
 * Renders all output handles for a node.
 *
 * Displays a vertical list of output handles with type tooltips derived from
 * the output JSON schema. This expects an object-like output schema and ignores
 * non-property metadata, matching how Fluxery surfaces per-property handles.
 *
 * @param outputJson - The output JSON schema containing property definitions.
 * @param tooltipEnabled - Whether tooltips are shown on hover.
 */
export const OutputHandlesRenderer = ({
  outputJson,
  tooltipEnabled,
}: {
  outputJson: JSONSchema;
  tooltipEnabled: boolean;
}) => {
  return (
    <div className="flex flex-col items-end justify-center gap-4">
      {Object.entries(outputJson.properties ?? {}).map(([propName]) => {
        const propSchema = outputJson.properties?.[propName] as JSONSchema | undefined;

        return (
          <InputOutputHandle
            key={propName}
            propName={propName}
            tooltipContent={getOutputTooltipContent(propSchema)}
            tooltipEnabled={tooltipEnabled}
            type="output"
          />
        );
      })}
    </div>
  );
};
