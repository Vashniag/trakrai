'use client';

import { z } from 'zod';

import type { RouterOutput } from '@trakrai/backend/server/routers';

export type ManagementConsole = RouterOutput['accessControl']['getManagementConsole'];
export type ManagedUser = ManagementConsole['users'][number];

export type AssignmentTableRow = {
  id: string;
  permissionLabel: string;
  scopeId: string;
  scopeLabel: string;
  scopeType: 'component' | 'department' | 'device' | 'factory';
  userEmail: string;
  userId: string;
  userName: string;
};

export type UserTableRow = ManagedUser & {
  assignmentCount: number;
};

export type InstallationTableRow = {
  componentDisplayName: string;
  componentKey: string;
  deviceId: string;
  deviceName: string;
  enabled: boolean;
  id: string;
  installationLabel: string;
};

export type SelectOption = {
  label: string;
  value: string;
};

export type MutationLike<TValues, TResult = unknown> = {
  isPending: boolean;
  mutateAsync: (values: TValues) => Promise<TResult>;
};

export type VoidMutationLike<TResult = unknown> = {
  isPending: boolean;
  mutateAsync: () => Promise<TResult>;
};

export const DEFAULT_PASSWORD = 'HACK@LAB';
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MIN_PASSWORD_LENGTH = 8;
export const BAN_DAY_SECONDS = SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;
export const EMPTY_USERS: ManagementConsole['users'] = [];
export const EMPTY_FACTORIES: ManagementConsole['factories'] = [];
export const EMPTY_DEPARTMENTS: ManagementConsole['departments'] = [];
export const EMPTY_DEVICES: ManagementConsole['devices'] = [];
export const EMPTY_CATALOG: ManagementConsole['catalog'] = [];
export const EMPTY_INSTALLATIONS: ManagementConsole['installations'] = [];

export const createFactorySchema = z.object({
  description: z.string(),
  name: z.string().trim().min(1),
});

export const updateFactorySchema = createFactorySchema.extend({
  id: z.string().uuid(),
});
export type CreateFactoryValues = z.infer<typeof createFactorySchema>;
export type UpdateFactoryValues = z.infer<typeof updateFactorySchema>;

export const createDepartmentSchema = z.object({
  description: z.string(),
  factoryId: z.string().uuid(),
  name: z.string().trim().min(1),
});

export const updateDepartmentSchema = createDepartmentSchema.extend({
  id: z.string().uuid(),
});
export type CreateDepartmentValues = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentValues = z.infer<typeof updateDepartmentSchema>;

export const catalogSchema = z.object({
  defaultEnabled: z.boolean(),
  description: z.string(),
  displayName: z.string().trim().min(1),
  key: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-_]+$/),
  navigationLabel: z.string().trim().min(1),
  readActions: z.array(z.string()),
  rendererKey: z.string(),
  routePath: z.string(),
  serviceName: z.string().trim().min(1),
  sortOrder: z.coerce.number().int(),
  writeActions: z.array(z.string()),
});
export type CatalogValues = z.infer<typeof catalogSchema>;

export const createUserSchema = z.object({
  email: z.email(),
  emailVerified: z.boolean(),
  name: z.string().trim().min(1),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: z.enum(['admin', 'user']),
});
export type CreateUserValues = z.infer<typeof createUserSchema>;

export const setUserRoleSchema = z.object({
  role: z.enum(['admin', 'user']),
  userId: z.string().min(1),
});
export type SetUserRoleValues = z.infer<typeof setUserRoleSchema>;

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
  userId: z.string().min(1),
});
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const banUserSchema = z.object({
  banExpiresIn: z.coerce.number().int().min(0),
  banReason: z.string(),
  userId: z.string().min(1),
});
export type BanUserValues = z.infer<typeof banUserSchema>;

export const factoryAssignmentSchema = z.object({
  role: z.enum(['admin', 'viewer']),
  scopeId: z.string().uuid(),
  scopeType: z.literal('factory'),
  userId: z.string().min(1),
});
export type FactoryAssignmentValues = z.infer<typeof factoryAssignmentSchema>;

export const departmentAssignmentSchema = z.object({
  role: z.enum(['admin', 'viewer']),
  scopeId: z.string().uuid(),
  scopeType: z.literal('department'),
  userId: z.string().min(1),
});
export type DepartmentAssignmentValues = z.infer<typeof departmentAssignmentSchema>;

export const deviceAssignmentSchema = z.object({
  role: z.literal('viewer'),
  scopeId: z.string().uuid(),
  scopeType: z.literal('device'),
  userId: z.string().min(1),
});
export type DeviceAssignmentValues = z.infer<typeof deviceAssignmentSchema>;

export const componentAssignmentSchema = z.object({
  accessLevel: z.enum(['read', 'write']),
  scopeId: z.string().uuid(),
  scopeType: z.literal('component'),
  userId: z.string().min(1),
});
export type ComponentAssignmentValues = z.infer<typeof componentAssignmentSchema>;

export type RemoveAssignmentValues = {
  scopeId: string;
  scopeType: 'component' | 'department' | 'device' | 'factory';
  userId: string;
};

export type InstallationStateValues = {
  componentKey: string;
  deviceId: string;
  enabled: boolean;
};

export type UserIdValues = {
  userId: string;
};

export const formatDateTime = (value: Date | null | undefined): string => {
  if (value === null || value === undefined) {
    return 'Never';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
};

export const toTitleCase = (value: string): string =>
  value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

export const formatUserLabel = (userRow: ManagedUser): string => {
  const normalizedName = userRow.name.trim();
  return normalizedName === '' ? userRow.email : `${normalizedName} (${userRow.email})`;
};

export const describeBanState = (userRow: ManagedUser): string =>
  userRow.banned === true ? `Banned until ${formatDateTime(userRow.banExpires)}` : 'Active';
