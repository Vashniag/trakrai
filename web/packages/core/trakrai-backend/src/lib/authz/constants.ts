import type { TupleKey } from '@openfga/sdk';

export const DEFAULT_OPENFGA_STORE_NAME = 'trakrai';

export const AUTHZ_RELATION_ADMIN = 'admin';
export const AUTHZ_RELATION_CAN_MANAGE_USERS = 'can_manage_users';
export const AUTHZ_RELATION_CAN_READ = 'can_read';
export const AUTHZ_RELATION_CAN_WRITE = 'can_write';
export const AUTHZ_RELATION_PARENT = 'parent';
export const AUTHZ_RELATION_READER = 'reader';
export const AUTHZ_RELATION_VIEWER = 'viewer';
export const AUTHZ_RELATION_WRITER = 'writer';

export const AUTHZ_TYPE_DEPARTMENT = 'department';
export const AUTHZ_TYPE_DEVICE = 'device';
export const AUTHZ_TYPE_DEVICE_COMPONENT = 'device_component';
export const AUTHZ_TYPE_FACTORY = 'factory';
export const AUTHZ_TYPE_USER = 'user';

export type AuthzRelation =
  | typeof AUTHZ_RELATION_ADMIN
  | typeof AUTHZ_RELATION_CAN_MANAGE_USERS
  | typeof AUTHZ_RELATION_CAN_READ
  | typeof AUTHZ_RELATION_CAN_WRITE
  | typeof AUTHZ_RELATION_PARENT
  | typeof AUTHZ_RELATION_READER
  | typeof AUTHZ_RELATION_VIEWER
  | typeof AUTHZ_RELATION_WRITER;

export type AuthzObjectType =
  | typeof AUTHZ_TYPE_DEPARTMENT
  | typeof AUTHZ_TYPE_DEVICE
  | typeof AUTHZ_TYPE_DEVICE_COMPONENT
  | typeof AUTHZ_TYPE_FACTORY;

export type AuthzDirectUserRelation =
  | typeof AUTHZ_RELATION_ADMIN
  | typeof AUTHZ_RELATION_READER
  | typeof AUTHZ_RELATION_VIEWER
  | typeof AUTHZ_RELATION_WRITER;

export type DeviceComponentAccessRecord = Readonly<{
  accessLevel: 'read' | 'write';
  componentKey: string;
  description: string | null;
  enabled: boolean;
  id: string;
  navigationLabel: string;
  readActions: string[];
  rendererKey: string | null;
  routePath: string | null;
  serviceName: string;
  sortOrder: number;
  writeActions: string[];
}>;

export const normalizeOptionalString = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? null : normalized;
};

const splitRoleList = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '');

export const isSysAdminRole = (value: string | null | undefined): boolean =>
  splitRoleList(value).includes('admin');

export const createAuthzObject = (type: AuthzObjectType, id: string): string => `${type}:${id}`;

export const createAuthzUser = (userId: string): string => `${AUTHZ_TYPE_USER}:${userId}`;

export const createTupleKeyId = (
  tupleKey: Pick<TupleKey, 'object' | 'relation' | 'user'>,
): string => `${tupleKey.user}|${tupleKey.relation}|${tupleKey.object}`;

export const sortTupleKeys = (tupleKeys: TupleKey[]): TupleKey[] =>
  [...tupleKeys].sort((left, right) =>
    createTupleKeyId(left).localeCompare(createTupleKeyId(right)),
  );

export const parseAuthzObject = (
  value: string,
): Readonly<{ id: string; type: AuthzObjectType }> | null => {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }

  const type = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1).trim();
  if (id === '') {
    return null;
  }

  if (
    type !== AUTHZ_TYPE_FACTORY &&
    type !== AUTHZ_TYPE_DEPARTMENT &&
    type !== AUTHZ_TYPE_DEVICE &&
    type !== AUTHZ_TYPE_DEVICE_COMPONENT
  ) {
    return null;
  }

  return {
    id,
    type,
  };
};

export const parseAuthzUserId = (value: string): string | null => {
  const expectedPrefix = `${AUTHZ_TYPE_USER}:`;
  if (!value.startsWith(expectedPrefix)) {
    return null;
  }

  const userId = value.slice(expectedPrefix.length).trim();
  return userId === '' ? null : userId;
};
