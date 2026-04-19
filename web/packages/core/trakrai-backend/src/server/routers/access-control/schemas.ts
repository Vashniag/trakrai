import { z } from 'zod';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 255;
const MAX_COMPONENT_KEY_LENGTH = 120;
const MAX_ROUTE_PATH_LENGTH = 120;
const MAX_NAVIGATION_LABEL_LENGTH = 80;
const FACTORY_ID_MESSAGE = 'Factory ID must be a UUID';
const DEPARTMENT_ID_MESSAGE = 'Department ID must be a UUID';
const DEVICE_ID_MESSAGE = 'Device ID must be a UUID';

export const normalizeOptionalString = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

export const normalizeStringArray = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value !== '')));

export const factoryInputSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

export const updateFactoryInputSchema = factoryInputSchema.extend({
  id: z.string().uuid('Factory ID must be a UUID'),
});

export const departmentInputSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  factoryId: z.string().uuid(FACTORY_ID_MESSAGE),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

export const updateDepartmentInputSchema = departmentInputSchema.extend({
  id: z.string().uuid(DEPARTMENT_ID_MESSAGE),
});

export const componentCatalogInputSchema = z.object({
  defaultEnabled: z.boolean().default(true),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  displayName: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  key: z
    .string()
    .trim()
    .min(1)
    .max(MAX_COMPONENT_KEY_LENGTH)
    .regex(/^[a-z0-9-_]+$/, 'Use lowercase letters, numbers, hyphens, or underscores.'),
  navigationLabel: z.string().trim().min(1).max(MAX_NAVIGATION_LABEL_LENGTH),
  readActions: z.array(z.string()).default([]),
  rendererKey: z.string().trim().max(MAX_NAVIGATION_LABEL_LENGTH).optional().default(''),
  routePath: z
    .string()
    .trim()
    .max(MAX_ROUTE_PATH_LENGTH)
    .regex(/^[a-z0-9-/]*$/, 'Use lowercase route slugs only.')
    .optional()
    .default(''),
  serviceName: z.string().trim().min(1).max(MAX_COMPONENT_KEY_LENGTH),
  sortOrder: z.number().int().default(0),
  writeActions: z.array(z.string()).default([]),
});

export const deviceComponentInstallationInputSchema = z.object({
  componentKey: z.string().trim().min(1),
  deviceId: z.string().uuid(DEVICE_ID_MESSAGE),
  enabled: z.boolean(),
});

export const assignmentInputSchema = z.discriminatedUnion('scopeType', [
  z.object({
    role: z.enum(['admin', 'viewer']),
    scopeId: z.string().uuid(FACTORY_ID_MESSAGE),
    scopeType: z.literal('factory'),
    userId: z.string(),
  }),
  z.object({
    role: z.enum(['admin', 'viewer']),
    scopeId: z.string().uuid(DEPARTMENT_ID_MESSAGE),
    scopeType: z.literal('department'),
    userId: z.string(),
  }),
  z.object({
    role: z.literal('viewer'),
    scopeId: z.string().uuid(DEVICE_ID_MESSAGE),
    scopeType: z.literal('device'),
    userId: z.string(),
  }),
  z.object({
    accessLevel: z.enum(['read', 'write']),
    scopeId: z.string().uuid('Component installation ID must be a UUID'),
    scopeType: z.literal('component'),
    userId: z.string(),
  }),
]);

export const removeAssignmentInputSchema = z.object({
  scopeId: z.string().uuid('Scope ID must be a UUID'),
  scopeType: z.enum(['factory', 'department', 'device', 'component']),
  userId: z.string(),
});
