import type { Spec } from '@json-render/react-email/server';

export type JsonEmailTemplateDocument = {
  demoData: Record<string, unknown>;
  spec: Spec;
};

export type JsonEmailRenderResult = {
  html: string;
  text: string;
};

export type SendJsonEmailArgs = {
  html?: string;
  subject: string;
  text?: string;
  to: string[];
};

export type SendEmailResult = {
  messageId: string;
};
