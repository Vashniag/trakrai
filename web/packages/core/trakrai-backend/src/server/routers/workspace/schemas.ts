import { z } from 'zod';

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const MAX_SEARCH_LENGTH = 120;

const textId = (label: string) => z.string().trim().min(1, `${label} is required`);

export const pageInputSchema = z.object({
  name: z.string().trim().max(MAX_SEARCH_LENGTH).default(''),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
});

export const factoryWorkspaceInputSchema = pageInputSchema.extend({
  factoryId: textId('Factory ID'),
});

export const departmentWorkspaceInputSchema = pageInputSchema.extend({
  departmentId: textId('Department ID'),
});

export const deviceWorkspaceInputSchema = z.object({
  deviceId: textId('Device ID'),
});

export const sysadminDirectoryInputSchema = pageInputSchema;
