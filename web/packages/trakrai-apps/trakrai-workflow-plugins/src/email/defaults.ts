import { z } from 'zod';

import type { JsonEmailTemplateDocument } from './types';

export const defaultJsonEmailInputSchema = z.toJSONSchema(
  z.object({
    title: z.string().describe('Primary heading shown in the email.'),
    preheader: z.string().describe('Inbox preview text shown by email clients.'),
    body: z.string().describe('Main supporting message body.'),
    ctaText: z.string().describe('Label for the call-to-action button.'),
    ctaUrl: z.string().describe('Destination URL for the call-to-action button.'),
    articles: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          summary: z.string(),
        }),
      )
      .describe('Optional article list rendered beneath the main content.'),
  }),
) as z.core.JSONSchema._JSONSchema;

export const defaultJsonEmailDocument: JsonEmailTemplateDocument = {
  spec: {
    root: 'html',
    elements: {
      html: {
        type: 'Html',
        props: {
          lang: 'en',
          dir: null,
        },
        children: ['head', 'preview', 'body'],
      },
      head: {
        type: 'Head',
        props: {},
        children: [],
      },
      preview: {
        type: 'Preview',
        props: {
          text: { $state: '/preheader' },
        },
        children: [],
      },
      body: {
        type: 'Body',
        props: {
          style: {
            backgroundColor: '#f3f4f6',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            margin: '0 auto',
            padding: '32px 12px',
          },
        },
        children: ['container'],
      },
      container: {
        type: 'Container',
        props: {
          style: {
            maxWidth: '560px',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            border: '1px solid #e5e7eb',
            padding: '32px',
          },
        },
        children: [
          'eyebrow',
          'heading',
          'body-text',
          'button-section',
          'divider',
          'articles-heading',
          'article-list',
          'footer',
        ],
      },
      eyebrow: {
        type: 'Text',
        props: {
          text: 'Fluxery newsletter',
          style: {
            color: '#6b7280',
            fontSize: '12px',
            fontWeight: '600',
            letterSpacing: '0.08em',
            margin: '0 0 12px',
            textTransform: 'uppercase',
          },
        },
        children: [],
      },
      heading: {
        type: 'Heading',
        props: {
          as: 'h1',
          text: { $state: '/title' },
          style: {
            color: '#111827',
            fontSize: '32px',
            fontWeight: '700',
            lineHeight: '1.2',
            margin: '0 0 16px',
          },
        },
        children: [],
      },
      'body-text': {
        type: 'Text',
        props: {
          text: { $state: '/body' },
          style: {
            color: '#374151',
            fontSize: '16px',
            lineHeight: '1.7',
            margin: '0 0 24px',
          },
        },
        children: [],
      },
      'button-section': {
        type: 'Section',
        props: {
          style: {
            marginBottom: '24px',
          },
        },
        children: ['cta-button'],
      },
      'cta-button': {
        type: 'Button',
        props: {
          text: { $state: '/ctaText' },
          href: { $state: '/ctaUrl' },
          style: {
            backgroundColor: '#111827',
            borderRadius: '999px',
            color: '#ffffff',
            display: 'inline-block',
            fontSize: '14px',
            fontWeight: '600',
            padding: '14px 24px',
            textDecoration: 'none',
          },
        },
        children: [],
      },
      divider: {
        type: 'Hr',
        props: {
          style: {
            borderColor: '#e5e7eb',
            margin: '0 0 24px',
          },
        },
        children: [],
      },
      'articles-heading': {
        type: 'Heading',
        props: {
          as: 'h2',
          text: 'Highlights',
          style: {
            color: '#111827',
            fontSize: '18px',
            fontWeight: '600',
            margin: '0 0 16px',
          },
        },
        children: [],
      },
      'article-list': {
        type: 'Section',
        props: {
          style: {
            marginBottom: '24px',
          },
        },
        repeat: {
          statePath: '/articles',
          key: 'id',
        },
        children: ['article-title', 'article-summary'],
      },
      'article-title': {
        type: 'Text',
        props: {
          text: { $item: 'title' },
          style: {
            color: '#111827',
            fontSize: '15px',
            fontWeight: '600',
            lineHeight: '1.6',
            margin: '0 0 4px',
          },
        },
        children: [],
      },
      'article-summary': {
        type: 'Text',
        props: {
          text: { $item: 'summary' },
          style: {
            color: '#6b7280',
            fontSize: '14px',
            lineHeight: '1.6',
            margin: '0 0 16px',
          },
        },
        children: [],
      },
      footer: {
        type: 'Text',
        props: {
          text: 'You are receiving this preview from the Fluxery JSON email node.',
          style: {
            color: '#9ca3af',
            fontSize: '12px',
            lineHeight: '1.6',
            margin: '0',
          },
        },
        children: [],
      },
    },
  },
  demoData: {
    title: 'Build email-ready workflows with Fluxery',
    preheader: 'The new JSON email node now renders HTML and plain text output.',
    body: 'Design the email as JSON, preview it live with demo data, then hand the rendered HTML and text to your sending node at runtime.',
    ctaText: 'Open the workflow',
    ctaUrl: 'https://fluxery.dev/workflows/email',
    articles: [
      {
        id: '1',
        title: 'Template JSON editor',
        summary: 'Use demo data while designing the spec and keep previews fast and predictable.',
      },
      {
        id: '2',
        title: 'Runtime data injection',
        summary:
          'Wire real workflow outputs into the template so each execution renders personalized content.',
      },
    ],
  },
};
