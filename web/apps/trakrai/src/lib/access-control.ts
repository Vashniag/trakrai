export const SYSTEM_ADMIN_ROLE = 'admin';

export const scopeKindValues = [
  'platform',
  'headquarter',
  'factory',
  'department',
  'device',
] as const;

export const accessLevelValues = ['view', 'operate', 'manage'] as const;
export const accessEffectValues = ['allow', 'deny'] as const;

export type ScopeKind = (typeof scopeKindValues)[number];
export type AccessLevel = (typeof accessLevelValues)[number];
export type AccessEffect = (typeof accessEffectValues)[number];

export type MembershipPermissionSet = {
  baselineAccessLevel: AccessLevel;
  canManageMemberships: boolean;
  canManageAppGrants: boolean;
  canManageHierarchy: boolean;
  canManageDevices: boolean;
  canViewHierarchy: boolean;
  isAdministrative: boolean;
};

const scopeSpecificity: Record<ScopeKind, number> = {
  platform: 0,
  headquarter: 1,
  factory: 2,
  department: 3,
  device: 4,
};

const accessLevelRank: Record<AccessLevel, number> = {
  view: 0,
  operate: 1,
  manage: 2,
};

const ADMIN_ROLE_KEYWORDS = ['admin', 'owner', 'supervisor'];
const MANAGER_ROLE_KEYWORDS = ['manager', 'lead'];
const OPERATOR_ROLE_KEYWORDS = ['operator', 'operate'];

type PermissionOverrides = {
  baselineAccessLevel?: AccessLevel;
  canManageMemberships?: boolean;
  canManageAppGrants?: boolean;
  canManageHierarchy?: boolean;
  canManageDevices?: boolean;
  canViewHierarchy?: boolean;
  isAdministrative?: boolean;
};

const coerceBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

export const normalizeRoleKey = (roleKey: string | null | undefined): string =>
  (roleKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

export const isSystemAdminRole = (role: string | null | undefined): boolean =>
  normalizeRoleKey(role) === SYSTEM_ADMIN_ROLE;

export const getAccessLevelRank = (level: AccessLevel | null | undefined): number =>
  level ? accessLevelRank[level] : -1;

export const getScopeSpecificity = (scopeKind: ScopeKind): number =>
  scopeSpecificity[scopeKind];

export const compareScopeSpecificity = (
  left: ScopeKind,
  right: ScopeKind,
): number => getScopeSpecificity(left) - getScopeSpecificity(right);

export const readStringArray = (
  source: Record<string, unknown> | null | undefined,
  key: string,
): string[] => {
  const value = source?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
};

const isHeadquarterAdminRole = (roleKey: string): boolean =>
  roleKey === 'headquarter_admin' ||
  roleKey === 'hq_admin' ||
  roleKey === 'regional_admin';

const isFactoryAdminRole = (roleKey: string): boolean =>
  roleKey === 'factory_admin' || roleKey === 'site_admin';

const isDepartmentAdminRole = (roleKey: string): boolean =>
  roleKey === 'department_admin' || roleKey === 'area_admin';

const isDeviceAdminRole = (roleKey: string): boolean =>
  roleKey === 'device_admin' || roleKey === 'edge_admin';

export const getMembershipPermissions = (
  roleKey: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): MembershipPermissionSet => {
  const normalizedRole = normalizeRoleKey(roleKey);
  const metadataPermissions =
    metadata?.permissions && typeof metadata.permissions === 'object'
      ? (metadata.permissions as PermissionOverrides)
      : undefined;

  const permissionSet: MembershipPermissionSet = {
    baselineAccessLevel: 'view',
    canManageMemberships: false,
    canManageAppGrants: false,
    canManageHierarchy: false,
    canManageDevices: false,
    canViewHierarchy: true,
    isAdministrative: false,
  };

  if (
    isHeadquarterAdminRole(normalizedRole) ||
    isFactoryAdminRole(normalizedRole) ||
    isDepartmentAdminRole(normalizedRole) ||
    isDeviceAdminRole(normalizedRole) ||
    ADMIN_ROLE_KEYWORDS.some((keyword) => normalizedRole.includes(keyword))
  ) {
    permissionSet.baselineAccessLevel = 'manage';
    permissionSet.canManageMemberships = true;
    permissionSet.canManageAppGrants = true;
    permissionSet.canManageHierarchy = true;
    permissionSet.canManageDevices = true;
    permissionSet.isAdministrative = true;
  } else if (MANAGER_ROLE_KEYWORDS.some((keyword) => normalizedRole.includes(keyword))) {
    permissionSet.baselineAccessLevel = 'manage';
    permissionSet.canManageAppGrants = true;
    permissionSet.canManageDevices = true;
    permissionSet.isAdministrative = true;
  } else if (OPERATOR_ROLE_KEYWORDS.some((keyword) => normalizedRole.includes(keyword))) {
    permissionSet.baselineAccessLevel = 'operate';
    permissionSet.canManageDevices = true;
  }

  if (metadataPermissions?.baselineAccessLevel) {
    permissionSet.baselineAccessLevel = metadataPermissions.baselineAccessLevel;
  }

  permissionSet.canManageMemberships =
    metadataPermissions?.canManageMemberships ?? permissionSet.canManageMemberships;
  permissionSet.canManageAppGrants =
    metadataPermissions?.canManageAppGrants ?? permissionSet.canManageAppGrants;
  permissionSet.canManageHierarchy =
    metadataPermissions?.canManageHierarchy ?? permissionSet.canManageHierarchy;
  permissionSet.canManageDevices =
    metadataPermissions?.canManageDevices ?? permissionSet.canManageDevices;
  permissionSet.canViewHierarchy =
    metadataPermissions?.canViewHierarchy ?? permissionSet.canViewHierarchy;
  permissionSet.isAdministrative =
    metadataPermissions?.isAdministrative ?? permissionSet.isAdministrative;

  const scopeAdminFlag =
    coerceBoolean(metadata?.scopeAdmin) ?? coerceBoolean(metadataPermissions?.isAdministrative);

  if (scopeAdminFlag) {
    permissionSet.canManageMemberships = true;
    permissionSet.canManageAppGrants = true;
    permissionSet.canManageHierarchy = true;
    permissionSet.canManageDevices = true;
    permissionSet.isAdministrative = true;
    permissionSet.baselineAccessLevel = 'manage';
  }

  return permissionSet;
};

export const resolveDefaultAccessLevel = (
  metadata: Record<string, unknown> | null | undefined,
): AccessLevel | null => {
  const rawValue = metadata?.defaultAccessLevel;
  return rawValue === 'view' || rawValue === 'operate' || rawValue === 'manage'
    ? rawValue
    : null;
};
