import { type z } from 'zod';

export type EventOption = {
  value: string;
  label?: string;
  description?: string;
  dataSchema: z.core.JSONSchema._JSONSchema;
};
