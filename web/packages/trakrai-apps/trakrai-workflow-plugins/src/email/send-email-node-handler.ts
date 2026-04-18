import {
  type NodeExecutionArgs,
  type NodeSchemaLike,
  WorkflowNodeHandler,
} from '@trakrai-workflow/core';
import { z } from 'zod';

import type { SendEmailResult, SendJsonEmailArgs } from './types';

const sendEmailInputSchema = z.toJSONSchema(
  z.object({
    to: z.array(z.string()).describe('List of recipient email addresses.'),
    subject: z.string().describe('Email subject line.'),
    html: z.string().optional().describe('Rendered HTML email body.'),
    text: z.string().optional().describe('Plain-text email body.'),
  }),
) as z.core.JSONSchema._JSONSchema;

const sendEmailOutputSchema = z.toJSONSchema(
  z.object({
    messageId: z.string(),
  }),
) as z.core.JSONSchema._JSONSchema;

const normalizeAddresses = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export class SendEmailNodeHandler<Context extends object> extends WorkflowNodeHandler<Context> {
  private readonly sendEmail: (args: SendJsonEmailArgs) => Promise<SendEmailResult>;

  constructor({ sendEmail }: { sendEmail: (args: SendJsonEmailArgs) => Promise<SendEmailResult> }) {
    super();
    this.sendEmail = sendEmail;
  }

  override getInputSchema(): NodeSchemaLike {
    return sendEmailInputSchema;
  }

  override getOutputSchema(): NodeSchemaLike {
    return sendEmailOutputSchema;
  }

  override async execute(args: NodeExecutionArgs<Context>) {
    const to = normalizeAddresses(args.input.to);
    const subject = typeof args.input.subject === 'string' ? args.input.subject.trim() : '';
    const html = typeof args.input.html === 'string' ? args.input.html : undefined;
    const text = typeof args.input.text === 'string' ? args.input.text : undefined;

    if (to.length === 0) {
      throw new Error('Send email node requires at least one recipient');
    }
    if (subject.length === 0) {
      throw new Error('Send email node requires a subject');
    }
    if ((html?.trim() ?? '') === '' && (text?.trim() ?? '') === '') {
      throw new Error('Send email node requires html or text content');
    }

    return this.sendEmail({
      to,
      subject,
      html,
      text,
    });
  }

  override getCategory(): string {
    return 'email';
  }

  override getDescription(): string {
    return 'Sends a rendered email through the configured transport.';
  }
}
