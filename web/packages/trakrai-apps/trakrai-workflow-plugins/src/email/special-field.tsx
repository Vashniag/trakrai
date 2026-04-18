'use client';

import { JsonEmailEditor } from './json-email-editor';

import type { FluxerySpecialFields } from '@trakrai-workflow/ui';

export const jsonEmailSpecialField = {
  jsonEmailEditor: {
    type: 'editor',
    component: JsonEmailEditor,
    display: 'dialog',
    dialogSize: 'fullscreen',
    dialogTitle: 'JSON Email Editor',
    dialogDescription:
      'Edit the email template JSON, save demo data, and preview the rendered result.',
  },
} satisfies FluxerySpecialFields;
