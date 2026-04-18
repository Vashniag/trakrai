'use client';

import { CronBuilder } from './cron-builder';

import type { FluxerySpecialFieldRendererProps, FluxerySpecialFields } from '@trakrai-workflow/ui';

const CronBuilderSpecialField = ({ value, onChange }: FluxerySpecialFieldRendererProps) => {
  return (
    <CronBuilder
      defaultValue={typeof value === 'string' ? value : ''}
      onChange={(nextCron) => {
        onChange(nextCron);
      }}
    />
  );
};

/**
 * Special field registration for the dialog-based cron expression builder used by
 * {@link CronTriggerNodeHandler} configuration.
 */
export const cronBuilderSpecialField = {
  cronBuilder: {
    type: 'editor',
    component: CronBuilderSpecialField,
    display: 'dialog',
    dialogTitle: 'Cron Builder',
    dialogDescription: 'Configure the cron schedule.',
  },
} satisfies FluxerySpecialFields;
