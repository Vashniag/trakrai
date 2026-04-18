import type { NodeHandlerRegistry } from '../runtime';
import type { z } from 'zod';

import {
  type DependencyInfo,
  type Node,
  type ExecutionResult,
  type NodeSchema,
  type NodeSchemas,
  type NodeFunctions,
  ExecutionSuccessHandle,
  TriggerHandle,
} from '../../types';

/**
 * Builds the synthetic result-map key used for event emissions.
 *
 * This key format matches `isEventHandle` parsing and keeps event payloads
 * distinct from the main execution result stored under the node ID itself.
 */
export const buildNodeEventId = (nodeId: string, eventName: string): `${string}###${string}` => {
  return `${nodeId}###${eventName}`;
};

/** Returns `true` if the given handle ID represents the execution-success output. */
export const isExecutionSuccessHandle = (handleId: string | undefined): boolean => {
  return handleId === ExecutionSuccessHandle;
};

/**
 * Assembles the runtime input record for a node by merging its static
 * configuration with data from upstream execution results.
 *
 * Trigger edges do not contribute values. Event handles read from the
 * event-specific execution result keyed by `buildNodeEventId`.
 */
export const buildNodeInput = (
  node: Node,
  dependencies: DependencyInfo[],
  resultMap: Map<string, ExecutionResult>,
): Record<string, unknown> => {
  const input: Record<string, unknown> = { ...(node.data.configuration ?? {}) };

  for (const dep of dependencies) {
    if (dep.targetHandle === TriggerHandle) {
      continue;
    }
    let resultId = dep.sourceNodeId;
    let sourceKey = dep.sourceHandle;
    const isEvent = isEventHandle(dep.sourceHandle);
    if (isEvent.isEvent) {
      resultId = buildNodeEventId(dep.sourceNodeId, isEvent.eventName);
      sourceKey = isEvent.eventHandle;
    }
    const sourceResult = resultMap.get(resultId);
    if (sourceResult?.success === true) {
      const sourceData = sourceResult.data;
      if (
        sourceData === null ||
        sourceData === undefined ||
        typeof sourceData !== 'object' ||
        Array.isArray(sourceData)
      ) {
        continue;
      }
      const sourceRecord = sourceData as Record<string, unknown>;
      if (sourceKey in sourceRecord) {
        input[dep.targetHandle] = sourceRecord[sourceKey];
      }
    }
  }

  return input;
};

// Common acronyms that should be fully capitalized
const KNOWN_ACRONYMS = new Set([
  'ai',
  'aic',
  'api',
  'aws',
  'cpu',
  'css',
  'db',
  'dns',
  'gpu',
  'html',
  'http',
  'https',
  'id',
  'io',
  'ip',
  'iso',
  'json',
  'jwt',
  'os',
  'pdf',
  'ram',
  'rest',
  'sdk',
  'smtp',
  'sql',
  'ssh',
  'ssl',
  'tcp',
  'tls',
  'udp',
  'ui',
  'uri',
  'url',
  'usb',
  'uuid',
  'vm',
  'xml',
  'yaml',
]);

/**
 * Converts a camelCase, snake_case, kebab-case, or PascalCase identifier
 * into a human-readable title-cased display name. Known acronyms are fully
 * capitalised (e.g. `"apiUrl"` → `"API URL"`).
 */
export const createDisplayName = (input: string): string => {
  if (input.length === 0) {
    return '';
  }
  const words: string[] = [];
  let currentWord = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === undefined) continue;

    const isDelimiter = char === '-' || char === '_' || char === ' ';
    const isUpperCase = char === char.toUpperCase() && char !== char.toLowerCase();
    const prevChar = i > 0 ? input[i - 1] : undefined;
    const isPrevUpperCase =
      prevChar?.toUpperCase() === prevChar && prevChar?.toLowerCase() !== prevChar;

    if (isDelimiter) {
      if (currentWord.length > 0) {
        words.push(currentWord);
        currentWord = '';
      }
    } else if (isUpperCase && currentWord.length > 0 && i > 0) {
      const nextChar = input[i + 1];
      const isNextLower =
        nextChar?.toLowerCase() === nextChar && nextChar?.toUpperCase() !== nextChar;
      if (isPrevUpperCase && !(isNextLower && currentWord.toUpperCase() === currentWord)) {
        currentWord += char;
      } else {
        words.push(currentWord);
        currentWord = char;
      }
    } else {
      currentWord += char;
    }
  }

  if (currentWord.length > 0) {
    words.push(currentWord);
  }
  return words
    .filter((word) => word.length > 0)
    .map((word) => {
      const lower = word.toLowerCase();
      if (KNOWN_ACRONYMS.has(lower)) {
        return lower.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .trim();
};

/**
 * Parses a handle ID to determine if it references a node event.
 *
 * Event handles use the `###` separator (e.g. `"eventName###propertyKey"`).
 * Returns a discriminated union with `isEvent` indicating the result.
 */
export const isEventHandle = (
  handleId: string | undefined,
):
  | {
      isEvent: false;
    }
  | {
      isEvent: true;
      eventName: string;
      eventHandle: string;
    } => {
  const isEvent = handleId?.indexOf('###') !== -1;
  if (!isEvent) {
    return {
      isEvent: false,
    };
  }
  const eventName = handleId?.split('###')[0];
  const eventHandle = handleId?.split('###')[1];
  if (
    eventName === undefined ||
    eventName === '' ||
    eventHandle === undefined ||
    eventHandle === ''
  ) {
    return {
      isEvent: false,
    };
  }
  return {
    isEvent: true,
    eventHandle,
    eventName,
  };
};

/** Identity helper for defining a type-safe `NodeSchema` without widening literal metadata. */
export const defineNodeSchema = <I extends z.ZodObject, O extends z.ZodObject>(
  schema: NodeSchema<I, O>,
) => {
  return schema;
};

/** Identity helper for defining a node schema registry while preserving literal node-type keys. */
export const defineNodeSchemaRegistry = <S extends NodeSchemas>(schemas: S) => {
  return schemas;
};

/** Identity helper for defining node functions that stay aligned with a schema registry's input/output types. */
export const defineNodeFunctions = <S extends NodeSchemas, Context extends object = object>(
  fnMap: NodeFunctions<S, Context>,
) => fnMap;

/** Identity helper for defining a node handler registry keyed by node type. */
export const defineNodeHandlerRegistry = <Context extends object = object>(
  registry: NodeHandlerRegistry<Context>,
) => registry;
