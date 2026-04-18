import { defaultJsonEmailDocument } from './defaults';
import { isJsonEmailSpec } from './render-json-email';

import type { JsonEmailTemplateDocument } from './types';

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return (
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
  );
};

export const cloneJson = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

export const resolveJsonEmailDocument = (value: unknown): JsonEmailTemplateDocument => {
  if (!isObjectRecord(value)) {
    return cloneJson(defaultJsonEmailDocument);
  }

  const demoData = isObjectRecord(value.demoData)
    ? value.demoData
    : defaultJsonEmailDocument.demoData;
  const spec = isJsonEmailSpec(value.spec) ? value.spec : defaultJsonEmailDocument.spec;

  return {
    demoData: cloneJson(demoData),
    spec: cloneJson(spec),
  };
};
