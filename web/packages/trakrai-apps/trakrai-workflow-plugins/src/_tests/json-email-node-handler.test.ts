import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Node } from '@trakrai-workflow/core';

import { JsonEmailNodeHandler, SendEmailNodeHandler } from '../email';

const EMAIL_RECIPIENT = 'hello@example.com';
const EMAIL_SUBJECT = 'Fluxery';
const RUNTIME_TITLE = 'Runtime title';
const SEND_EMAIL_NODE_TYPE = 'send-email';

const createNode = (configuration: Record<string, unknown>, type = 'json-email'): Node => ({
  id: `${type}-node`,
  type,
  position: { x: 0, y: 0 },
  data: { configuration },
});

describe('JsonEmailNodeHandler', () => {
  it('renders HTML and text using runtime input data', async () => {
    const handler = new JsonEmailNodeHandler();
    const inputSchema = z.toJSONSchema(
      z.object({
        title: z.string(),
      }),
    );

    const result = await handler.execute({
      node: createNode({
        inputSchema,
        emailTemplate: {
          spec: {
            root: 'html',
            elements: {
              html: {
                type: 'Html',
                props: { lang: 'en', dir: null },
                children: ['head', 'body'],
              },
              head: {
                type: 'Head',
                props: {},
                children: [],
              },
              body: {
                type: 'Body',
                props: {},
                children: ['title'],
              },
              title: {
                type: 'Text',
                props: {
                  text: { $state: '/title' },
                },
                children: [],
              },
            },
          },
          demoData: {
            title: 'Preview title',
          },
        },
      }),
      input: {
        title: RUNTIME_TITLE,
        ignored: 'value',
      },
      context: {},
      logger: { info: () => {} } as never,
      events: {},
    });

    expect(result.html).toContain(RUNTIME_TITLE);
    expect(result.text).toContain(RUNTIME_TITLE);
    expect(result.html).not.toContain('Preview title');
  });
});

describe('SendEmailNodeHandler', () => {
  it('delegates sending to the provided transport', async () => {
    const handler = new SendEmailNodeHandler({
      sendEmail: async (args) => {
        expect(args).toEqual({
          to: [EMAIL_RECIPIENT],
          subject: EMAIL_SUBJECT,
          html: '<p>Hello</p>',
          text: 'Hello',
        });
        return { messageId: 'ses-message-id' };
      },
    });

    const result = await handler.execute({
      node: createNode({}, SEND_EMAIL_NODE_TYPE),
      input: {
        to: [EMAIL_RECIPIENT],
        subject: EMAIL_SUBJECT,
        html: '<p>Hello</p>',
        text: 'Hello',
      },
      context: {},
      logger: { info: () => {} } as never,
      events: {},
    });

    expect(result).toEqual({ messageId: 'ses-message-id' });
  });

  it('rejects emails without recipients or body content', async () => {
    const handler = new SendEmailNodeHandler({
      sendEmail: async () => ({ messageId: 'unused' }),
    });

    await expect(
      handler.execute({
        node: createNode({}, SEND_EMAIL_NODE_TYPE),
        input: {
          to: [],
          subject: EMAIL_SUBJECT,
        },
        context: {},
        logger: { info: () => {} } as never,
        events: {},
      }),
    ).rejects.toThrow('at least one recipient');

    await expect(
      handler.execute({
        node: createNode({}, SEND_EMAIL_NODE_TYPE),
        input: {
          to: [EMAIL_RECIPIENT],
          subject: EMAIL_SUBJECT,
        },
        context: {},
        logger: { info: () => {} } as never,
        events: {},
      }),
    ).rejects.toThrow('html or text content');
  });
});
