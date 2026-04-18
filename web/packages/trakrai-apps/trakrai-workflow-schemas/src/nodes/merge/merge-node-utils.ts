/**
 * Configuration key that stores the user-defined list of merge inputs.
 */
export const MERGE_INPUTS_KEY = 'mergeInputs';
/**
 * Configuration key that stores the schema every merge input is expected to satisfy.
 */
export const MERGE_OUTPUT_SCHEMA_KEY = 'mergeOutputSchema';
/**
 * Separator used to build concrete handle ids from an input id and output field name.
 */
export const MERGE_HANDLE_SEPARATOR = '__';

/**
 * Serialized merge input definition stored in node configuration.
 */
export type MergeInputDefinition = {
  /**
   * Stable identifier used to derive concrete handle ids.
   */
  id: string;
  /**
   * Optional editor-facing label shown for this logical input.
   */
  label?: string;
};

const isMergeInputDefinition = (value: unknown): value is MergeInputDefinition => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    return false;
  }
  if (entry.label !== undefined && typeof entry.label !== 'string') {
    return false;
  }
  return true;
};

/**
 * Reads configured merge inputs from node configuration and drops malformed entries.
 */
export const getMergeInputsFromConfig = (
  configuration: Record<string, unknown> | null | undefined,
): MergeInputDefinition[] => {
  if (configuration === null || configuration === undefined) {
    return [];
  }
  const value = configuration[MERGE_INPUTS_KEY];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isMergeInputDefinition);
};

/**
 * Builds the concrete handle id used in the editor and runtime for a merge input field.
 */
export const buildMergeHandleId = (inputId: string, field: string): string => {
  return `${inputId}${MERGE_HANDLE_SEPARATOR}${field}`;
};
