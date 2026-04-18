import { renderToHtml, renderToPlainText } from '@json-render/react-email/render';

import type { JsonEmailRenderResult } from './types';
import type { Spec } from '@json-render/react-email/server';

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return (
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
  );
};

export const isJsonEmailSpec = (value: unknown): value is Spec => {
  if (!isObjectRecord(value)) {
    return false;
  }

  return typeof value.root === 'string' && isObjectRecord(value.elements);
};

export const renderJsonEmail = async (
  spec: Spec,
  data?: Record<string, unknown>,
): Promise<JsonEmailRenderResult> => {
  if (!isJsonEmailSpec(spec)) {
    throw new Error('JSON email template must contain a valid json-render spec');
  }

  const [html, text] = await Promise.all([
    renderToHtml(spec, { state: data }),
    renderToPlainText(spec, { state: data }),
  ]);

  return { html, text };
};
