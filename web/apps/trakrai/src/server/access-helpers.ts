import { TRPCError } from '@trpc/server';
import { and, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import {
  appAccessGrant,
  appDefinition,
  department,
  device,
  factory,
  headquarter,
  user,
  userScopeMembership,
} from '@/db/schema';
import {
  compareScopeSpecificity,
  getAccessLevelRank,
  getMembershipPermissions,
  getScopeSpecificity,
  isSystemAdminRole,
  readStringArray,
  resolveDefaultAccessLevel,
  type AccessLevel,
  type ScopeKind,
} from '@/lib/access-control';

import type { db } from '@/db';
import type { InferSelectModel } from 'drizzle-orm';

type Database = typeof db;

type HeadquarterRow = InferSelectModel<typeof headquarter>;
type FactoryRow = InferSelectModel<typeof factory>;
type DepartmentRow = InferSelectModel<typeof department>;
type DeviceRow = InferSelectModel<typeof device>;
type MembershipRow = InferSelectModel<typeof userScopeMembership>;
type AppGrantRow = InferSelectModel<typeof appAccessGrant>;
type AppDefinitionRow = InferSelectModel<typeof appDefinition>;
type UserRow = InferSelectModel<typeof user>;
type SessionUser = Pick<UserRow, 'email' | 'id' | 'name'> &
  Partial<
    Pick<
      UserRow,
      | 'banExpires'
      | 'banReason'
      | 'banned'
      | 'createdAt'
      | 'emailVerified'
      | 'image'
      | 'role'
      | 'updatedAt'
    >
  >;

export type ScopeRef = {
  id: string;
  kind: ScopeKind;
};

type ScopeDescriptor = ScopeRef & {
  code: string | null;
  name: string;
  parent: ScopeRef | null;
  slug: string | null;
};

type DeviceHierarchy = {
  department: DepartmentRow | null;
  factory: FactoryRow | null;
  headquarter: HeadquarterRow | null;
};

type MembershipSummary = MembershipRow & {
  permissions: ReturnType<typeof getMembershipPermissions>;
  scope: ScopeDescriptor | null;
  scopePath: ScopeDescriptor[];
};

type DevicePanelAccess = {
  accessLevel: AccessLevel | null;
  app: AppDefinitionRow;
  grantScope: ScopeRef | null;
  isSupported: boolean;
  isVisible: boolean;
  reason: 'default-membership' | 'explicit-deny' | 'explicit-grant' | 'system-admin' | 'unsupported';
};

type ActiveAccessContext = {
  accessibleDeviceIds: Set<string>;
  accessibleScopeKeys: Set<string>;
  appDefinitions: AppDefinitionRow[];
  appGrants: AppGrantRow[];
  canAccessAdminConsole: boolean;
  deviceHierarchyById: Map<string, DeviceHierarchy>;
  hierarchy: HierarchyIndex;
  isSystemAdmin: boolean;
  manageableScopeKeys: Set<string>;
  memberships: MembershipSummary[];
  user: UserRow;
};

export type AccessContext = ActiveAccessContext;

type HierarchyIndex = {
  departments: DepartmentRow[];
  departmentById: Map<string, DepartmentRow>;
  deviceById: Map<string, DeviceRow>;
  deviceHierarchyById: Map<string, DeviceHierarchy>;
  devices: DeviceRow[];
  factories: FactoryRow[];
  factoryById: Map<string, FactoryRow>;
  headquarters: HeadquarterRow[];
  headquarterById: Map<string, HeadquarterRow>;
};

const scopeKey = (scope: ScopeRef): string => `${scope.kind}:${scope.id}`;

export const describeScope = (
  hierarchy: HierarchyIndex,
  scopeKind: ScopeKind,
  scopeId: string,
): ScopeDescriptor | null => {
  switch (scopeKind) {
    case 'platform':
      return {
        id: scopeId,
        kind: 'platform',
        code: null,
        name: 'Platform',
        parent: null,
        slug: null,
      };
    case 'headquarter': {
      const entity = hierarchy.headquarterById.get(scopeId);
      return entity
        ? {
            id: entity.id,
            kind: 'headquarter',
            code: entity.code ?? null,
            name: entity.name,
            parent: null,
            slug: entity.slug,
          }
        : null;
    }
    case 'factory': {
      const entity = hierarchy.factoryById.get(scopeId);
      return entity
        ? {
            id: entity.id,
            kind: 'factory',
            code: entity.code ?? null,
            name: entity.name,
            parent: {
              id: entity.headquarterId,
              kind: 'headquarter',
            },
            slug: entity.slug,
          }
        : null;
    }
    case 'department': {
      const entity = hierarchy.departmentById.get(scopeId);
      return entity
        ? {
            id: entity.id,
            kind: 'department',
            code: entity.code ?? null,
            name: entity.name,
            parent: {
              id: entity.factoryId,
              kind: 'factory',
            },
            slug: entity.slug,
          }
        : null;
    }
    case 'device': {
      const entity = hierarchy.deviceById.get(scopeId);
      return entity
        ? {
            id: entity.id,
            kind: 'device',
            code: null,
            name: entity.name,
            parent: entity.departmentId
              ? {
                  id: entity.departmentId,
                  kind: 'department',
                }
              : null,
            slug: entity.publicId,
          }
        : null;
    }
  }
};

export const describeScopePath = (
  hierarchy: HierarchyIndex,
  scope: ScopeRef | null,
): ScopeDescriptor[] => {
  if (!scope) {
    return [];
  }

  if (scope.kind === 'platform') {
    return [
      {
        id: scope.id,
        kind: 'platform',
        code: null,
        name: 'Platform',
        parent: null,
        slug: null,
      },
    ];
  }

  const segments: ScopeDescriptor[] = [];
  let cursor = describeScope(hierarchy, scope.kind, scope.id);

  while (cursor) {
    segments.unshift(cursor);
    cursor = cursor.parent ? describeScope(hierarchy, cursor.parent.kind, cursor.parent.id) : null;
  }

  return segments;
};

const isScopeWithin = (
  hierarchy: HierarchyIndex,
  container: ScopeRef,
  candidate: ScopeRef,
): boolean => {
  if (container.kind === 'platform') {
    return true;
  }

  return describeScopePath(hierarchy, candidate).some(
    (segment) => segment.kind === container.kind && segment.id === container.id,
  );
};

const expandScopeVisibility = (
  hierarchy: HierarchyIndex,
  scope: ScopeRef,
  accessibleScopeKeys: Set<string>,
  accessibleDeviceIds: Set<string>,
): void => {
  if (scope.kind === 'platform') {
    hierarchy.headquarters.forEach((entity) => {
      accessibleScopeKeys.add(scopeKey({ kind: 'headquarter', id: entity.id }));
    });
    hierarchy.factories.forEach((entity) => {
      accessibleScopeKeys.add(scopeKey({ kind: 'factory', id: entity.id }));
    });
    hierarchy.departments.forEach((entity) => {
      accessibleScopeKeys.add(scopeKey({ kind: 'department', id: entity.id }));
    });
    hierarchy.devices.forEach((entity) => {
      accessibleScopeKeys.add(scopeKey({ kind: 'device', id: entity.id }));
      accessibleDeviceIds.add(entity.id);
    });
    return;
  }

  describeScopePath(hierarchy, scope).forEach((segment) => {
    accessibleScopeKeys.add(scopeKey(segment));
  });

  hierarchy.devices.forEach((deviceRecord) => {
    const deviceScope = { kind: 'device', id: deviceRecord.id } as const;
    if (!isScopeWithin(hierarchy, scope, deviceScope)) {
      return;
    }

    accessibleDeviceIds.add(deviceRecord.id);
    describeScopePath(hierarchy, deviceScope).forEach((segment) => {
      accessibleScopeKeys.add(scopeKey(segment));
    });
  });
};

const markManageableScopes = (
  hierarchy: HierarchyIndex,
  scope: ScopeRef,
  manageableScopeKeys: Set<string>,
): void => {
  if (scope.kind === 'platform') {
    manageableScopeKeys.add(scopeKey(scope));
    hierarchy.headquarters.forEach((entity) => {
      manageableScopeKeys.add(scopeKey({ kind: 'headquarter', id: entity.id }));
    });
    hierarchy.factories.forEach((entity) => {
      manageableScopeKeys.add(scopeKey({ kind: 'factory', id: entity.id }));
    });
    hierarchy.departments.forEach((entity) => {
      manageableScopeKeys.add(scopeKey({ kind: 'department', id: entity.id }));
    });
    hierarchy.devices.forEach((entity) => {
      manageableScopeKeys.add(scopeKey({ kind: 'device', id: entity.id }));
    });
    return;
  }

  manageableScopeKeys.add(scopeKey(scope));

  hierarchy.devices.forEach((deviceRecord) => {
    const deviceScope = { kind: 'device', id: deviceRecord.id } as const;
    if (!isScopeWithin(hierarchy, scope, deviceScope)) {
      return;
    }

    describeScopePath(hierarchy, deviceScope).forEach((segment) => {
      if (isScopeWithin(hierarchy, scope, segment)) {
        manageableScopeKeys.add(scopeKey(segment));
      }
    });
  });
};

const matchesGrantConditions = (
  grant: AppGrantRow,
  deviceRecord: DeviceRow,
  deviceHierarchy: DeviceHierarchy,
): boolean => {
  const conditions = grant.conditions;

  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }

  const requiredDeviceIds = readStringArray(conditions, 'deviceIds');
  if (requiredDeviceIds.length > 0 && !requiredDeviceIds.includes(deviceRecord.id)) {
    return false;
  }

  const requiredDevicePublicIds = readStringArray(conditions, 'devicePublicIds');
  if (
    requiredDevicePublicIds.length > 0 &&
    !requiredDevicePublicIds.includes(deviceRecord.publicId)
  ) {
    return false;
  }

  const requiredDepartmentIds = readStringArray(conditions, 'departmentIds');
  if (
    requiredDepartmentIds.length > 0 &&
    (!deviceHierarchy.department || !requiredDepartmentIds.includes(deviceHierarchy.department.id))
  ) {
    return false;
  }

  const requiredFactoryIds = readStringArray(conditions, 'factoryIds');
  if (
    requiredFactoryIds.length > 0 &&
    (!deviceHierarchy.factory || !requiredFactoryIds.includes(deviceHierarchy.factory.id))
  ) {
    return false;
  }

  const requiredHeadquarterIds = readStringArray(conditions, 'headquarterIds');
  if (
    requiredHeadquarterIds.length > 0 &&
    (!deviceHierarchy.headquarter ||
      !requiredHeadquarterIds.includes(deviceHierarchy.headquarter.id))
  ) {
    return false;
  }

  const requiredStatuses = readStringArray(conditions, 'deviceStatuses');
  if (requiredStatuses.length > 0 && !requiredStatuses.includes(deviceRecord.status)) {
    return false;
  }

  return true;
};

const parseSupportedPanelKeys = (metadata: Record<string, unknown>): Set<string> | null => {
  const supportedPanelKeys = readStringArray(metadata, 'supportedPanelKeys');
  const supportedAppKeys = readStringArray(metadata, 'supportedAppKeys');
  const enabledPanels = readStringArray(metadata, 'enabledPanels');
  const enabledApps = readStringArray(metadata, 'enabledApps');

  const values = [
    ...supportedPanelKeys,
    ...supportedAppKeys,
    ...enabledPanels,
    ...enabledApps,
  ];

  return values.length > 0 ? new Set(values) : null;
};

const parseDisabledPanelKeys = (metadata: Record<string, unknown>): Set<string> => {
  const disabledPanelKeys = readStringArray(metadata, 'disabledPanelKeys');
  const disabledAppKeys = readStringArray(metadata, 'disabledAppKeys');
  const disabledPanels = readStringArray(metadata, 'disabledPanels');
  const disabledApps = readStringArray(metadata, 'disabledApps');

  return new Set([
    ...disabledPanelKeys,
    ...disabledAppKeys,
    ...disabledPanels,
    ...disabledApps,
  ]);
};

const compareGrantPriority = (left: AppGrantRow, right: AppGrantRow): number => {
  const specificityDelta = compareScopeSpecificity(right.scopeKind, left.scopeKind);
  if (specificityDelta !== 0) {
    return specificityDelta;
  }

  if (left.effect !== right.effect) {
    return left.effect === 'deny' ? -1 : 1;
  }

  const accessRankDelta = getAccessLevelRank(right.accessLevel) - getAccessLevelRank(left.accessLevel);
  if (accessRankDelta !== 0) {
    return accessRankDelta;
  }

  return right.updatedAt.getTime() - left.updatedAt.getTime();
};

const getCloudAppVisibility = (access: ActiveAccessContext, app: AppDefinitionRow) => {
  if (access.isSystemAdmin) {
    return { accessLevel: 'manage' as const, isVisible: true, reason: 'system-admin' as const };
  }

  const explicitGrant = access.appGrants
    .filter(
      (grant) =>
        grant.subjectType === 'user' &&
        grant.subjectId === access.user.id &&
        grant.appId === app.id &&
        access.accessibleScopeKeys.has(scopeKey({ kind: grant.scopeKind, id: grant.scopeId })),
    )
    .sort(compareGrantPriority)[0];

  if (explicitGrant) {
    if (explicitGrant.effect === 'deny') {
      return { accessLevel: null, isVisible: false, reason: 'explicit-deny' as const };
    }

    return {
      accessLevel: explicitGrant.accessLevel,
      isVisible: true,
      reason: 'explicit-grant' as const,
    };
  }

  const defaultAccessLevel = resolveDefaultAccessLevel(app.metadata);
  if (defaultAccessLevel && access.memberships.length > 0) {
    return {
      accessLevel: defaultAccessLevel,
      isVisible: true,
      reason: 'default-membership' as const,
    };
  }

  return {
    accessLevel: null,
    isVisible: false,
    reason: 'unsupported' as const,
  };
};

export const loadHierarchyIndex = async (database: Database): Promise<HierarchyIndex> => {
  const [headquarters, factories, departments, devices] = await Promise.all([
    database.select().from(headquarter),
    database.select().from(factory),
    database.select().from(department),
    database.select().from(device),
  ]);

  const headquarterById = new Map(headquarters.map((record) => [record.id, record]));
  const factoryById = new Map(factories.map((record) => [record.id, record]));
  const departmentById = new Map(departments.map((record) => [record.id, record]));
  const deviceById = new Map(devices.map((record) => [record.id, record]));

  const deviceHierarchyById = new Map<string, DeviceHierarchy>();
  devices.forEach((deviceRecord) => {
    const departmentRecord = deviceRecord.departmentId
      ? departmentById.get(deviceRecord.departmentId) ?? null
      : null;
    const factoryRecord = departmentRecord ? factoryById.get(departmentRecord.factoryId) ?? null : null;
    const headquarterRecord = factoryRecord
      ? headquarterById.get(factoryRecord.headquarterId) ?? null
      : null;

    deviceHierarchyById.set(deviceRecord.id, {
      department: departmentRecord,
      factory: factoryRecord,
      headquarter: headquarterRecord,
    });
  });

  return {
    departments,
    departmentById,
    deviceById,
    deviceHierarchyById,
    devices,
    factories,
    factoryById,
    headquarters,
    headquarterById,
  };
};

export const resolveAccessContext = async (
  database: Database,
  activeUser: SessionUser,
): Promise<ActiveAccessContext> => {
  const normalizedUser: UserRow = {
    banExpires: activeUser.banExpires ?? null,
    banReason: activeUser.banReason ?? null,
    banned: activeUser.banned ?? null,
    createdAt: activeUser.createdAt ?? new Date(0),
    email: activeUser.email,
    emailVerified: activeUser.emailVerified ?? false,
    id: activeUser.id,
    image: activeUser.image ?? null,
    name: activeUser.name,
    role: activeUser.role ?? null,
    updatedAt: activeUser.updatedAt ?? new Date(0),
  };
  const [hierarchy, rawMemberships, rawAppGrants, appDefinitions] = await Promise.all([
    loadHierarchyIndex(database),
    database
      .select()
      .from(userScopeMembership)
      .where(
        and(
          eq(userScopeMembership.userId, normalizedUser.id),
          isNull(userScopeMembership.revokedAt),
        ),
      ),
    database
      .select()
      .from(appAccessGrant)
      .where(
        and(
          eq(appAccessGrant.subjectType, 'user'),
          eq(appAccessGrant.subjectId, normalizedUser.id),
          isNull(appAccessGrant.revokedAt),
        ),
      ),
    database.select().from(appDefinition),
  ]);

  const accessibleScopeKeys = new Set<string>();
  const accessibleDeviceIds = new Set<string>();
  const manageableScopeKeys = new Set<string>();
  const isSystemAdmin = isSystemAdminRole(normalizedUser.role);

  const memberships = rawMemberships.map<MembershipSummary>((membership) => {
    const scope = describeScope(hierarchy, membership.scopeKind, membership.scopeId);
    const scopePath = describeScopePath(
      hierarchy,
      scope ? { kind: scope.kind, id: scope.id } : { kind: membership.scopeKind, id: membership.scopeId },
    );
    const permissions = getMembershipPermissions(membership.roleKey, membership.metadata);

    return {
      ...membership,
      permissions,
      scope,
      scopePath,
    };
  });

  if (isSystemAdmin) {
    expandScopeVisibility(
      hierarchy,
      { kind: 'platform', id: 'platform' },
      accessibleScopeKeys,
      accessibleDeviceIds,
    );
    markManageableScopes(hierarchy, { kind: 'platform', id: 'platform' }, manageableScopeKeys);
  }

  memberships.forEach((membership) => {
    const scope = { kind: membership.scopeKind, id: membership.scopeId } as const;
    expandScopeVisibility(hierarchy, scope, accessibleScopeKeys, accessibleDeviceIds);
    if (
      membership.permissions.canManageMemberships ||
      membership.permissions.canManageAppGrants ||
      membership.permissions.canManageHierarchy ||
      membership.permissions.canManageDevices
    ) {
      markManageableScopes(hierarchy, scope, manageableScopeKeys);
    }
  });

  const canAccessAdminConsole =
    isSystemAdmin ||
    memberships.some(
      (membership) =>
        membership.permissions.canManageMemberships ||
        membership.permissions.canManageHierarchy ||
        membership.permissions.canManageDevices,
    );

  return {
    accessibleDeviceIds,
    accessibleScopeKeys,
    appDefinitions,
    appGrants: rawAppGrants,
    canAccessAdminConsole,
    deviceHierarchyById: hierarchy.deviceHierarchyById,
    hierarchy,
    isSystemAdmin,
    manageableScopeKeys,
    memberships,
    user: normalizedUser,
  };
};

export const canManageScope = (
  access: ActiveAccessContext,
  scope: ScopeRef,
  capability: 'app' | 'membership' | 'device' | 'hierarchy',
): boolean => {
  if (access.isSystemAdmin) {
    return true;
  }

  return access.memberships.some((membership) => {
    const hasCapability =
      capability === 'app'
        ? membership.permissions.canManageAppGrants
        : capability === 'membership'
          ? membership.permissions.canManageMemberships
          : capability === 'device'
            ? membership.permissions.canManageDevices
            : membership.permissions.canManageHierarchy;

    return (
      hasCapability &&
      isScopeWithin(
        access.hierarchy,
        { kind: membership.scopeKind, id: membership.scopeId },
        scope,
      )
    );
  });
};

export const assertCanManageScope = (
  access: ActiveAccessContext,
  scope: ScopeRef,
  capability: 'app' | 'membership' | 'device' | 'hierarchy',
): void => {
  if (!canManageScope(access, scope, capability)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
};

export const assertCanAccessDevice = (
  access: ActiveAccessContext,
  deviceId: string,
): DeviceRow => {
  const deviceRecord = access.hierarchy.deviceById.get(deviceId);
  if (!deviceRecord) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  if (!access.isSystemAdmin && !access.accessibleDeviceIds.has(deviceId)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return deviceRecord;
};

export const listManageableScopes = (access: ActiveAccessContext) => {
  const scopes: Array<{
    code: string | null;
    id: string;
    kind: ScopeKind;
    label: string;
    name: string;
    path: ScopeDescriptor[];
    slug: string | null;
  }> = [];

  access.manageableScopeKeys.forEach((key) => {
    const [kind, id] = key.split(':');
    if (!id || kind === 'platform') {
      return;
    }

    const descriptor = describeScope(access.hierarchy, kind as ScopeKind, id);
    if (!descriptor) {
      return;
    }

    const path = describeScopePath(access.hierarchy, descriptor);
    scopes.push({
      code: descriptor.code,
      id: descriptor.id,
      kind: descriptor.kind,
      label: path.map((segment) => segment.name).join(' / '),
      name: descriptor.name,
      path,
      slug: descriptor.slug,
    });
  });

  return scopes.sort((left, right) => {
    const specificityDelta = getScopeSpecificity(left.kind) - getScopeSpecificity(right.kind);
    if (specificityDelta !== 0) {
      return specificityDelta;
    }

    return left.label.localeCompare(right.label);
  });
};

export const buildAccessibleHierarchyTree = (access: ActiveAccessContext) => {
  const deviceEntries = access.hierarchy.devices
    .filter((deviceRecord) => access.isSystemAdmin || access.accessibleDeviceIds.has(deviceRecord.id))
    .map((deviceRecord) => {
      const deviceHierarchy = access.deviceHierarchyById.get(deviceRecord.id) ?? {
        department: null,
        factory: null,
        headquarter: null,
      };

      return {
        ...deviceRecord,
        department: deviceHierarchy.department,
        factory: deviceHierarchy.factory,
        headquarter: deviceHierarchy.headquarter,
      };
    });
  const unassignedDevices = deviceEntries
    .filter((entry) => !entry.department || !entry.factory || !entry.headquarter)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((deviceNode) => ({
      ...deviceNode,
      canManageApps: canManageScope(access, { kind: 'device', id: deviceNode.id }, 'app'),
      canManageDevice: canManageScope(access, { kind: 'device', id: deviceNode.id }, 'device'),
    }));

  const departmentMap = new Map<
    string,
    {
      devices: typeof deviceEntries;
      item: DepartmentRow;
    }
  >();
  const factoryMap = new Map<
    string,
    {
      departments: Array<{
        devices: typeof deviceEntries;
        item: DepartmentRow;
      }>;
      item: FactoryRow;
    }
  >();
  const headquarterMap = new Map<
    string,
    {
      factories: Array<{
        departments: Array<{
          devices: typeof deviceEntries;
          item: DepartmentRow;
        }>;
        item: FactoryRow;
      }>;
      item: HeadquarterRow;
    }
  >();

  deviceEntries.forEach((entry) => {
    if (!entry.department || !entry.factory || !entry.headquarter) {
      return;
    }

    const departmentRecord = entry.department;
    const factoryRecord = entry.factory;
    const headquarterRecord = entry.headquarter;

    const departmentNode = departmentMap.get(departmentRecord.id) ?? {
      devices: [],
      item: departmentRecord,
    };
    departmentNode.devices.push(entry);
    departmentMap.set(departmentRecord.id, departmentNode);

    const factoryNode = factoryMap.get(factoryRecord.id) ?? {
      departments: [],
      item: factoryRecord,
    };
    if (!factoryNode.departments.some((departmentNodeEntry) => departmentNodeEntry.item.id === departmentRecord.id)) {
      factoryNode.departments.push(departmentNode);
    }
    factoryMap.set(factoryRecord.id, factoryNode);

    const headquarterNode = headquarterMap.get(headquarterRecord.id) ?? {
      factories: [],
      item: headquarterRecord,
    };
    if (!headquarterNode.factories.some((factoryNodeEntry) => factoryNodeEntry.item.id === factoryRecord.id)) {
      headquarterNode.factories.push(factoryNode);
    }
    headquarterMap.set(headquarterRecord.id, headquarterNode);
  });

  return {
    counts: {
      departments: departmentMap.size,
      devices: deviceEntries.length,
      factories: factoryMap.size,
      headquarters: headquarterMap.size,
    },
    unassignedDevices,
    tree: Array.from(headquarterMap.values())
      .sort((left, right) => left.item.name.localeCompare(right.item.name))
      .map((headquarterNode) => ({
        ...headquarterNode.item,
        canManageApps: canManageScope(access, { kind: 'headquarter', id: headquarterNode.item.id }, 'app'),
        canManageMemberships: canManageScope(
          access,
          { kind: 'headquarter', id: headquarterNode.item.id },
          'membership',
        ),
        factories: headquarterNode.factories
          .sort((left, right) => left.item.name.localeCompare(right.item.name))
          .map((factoryNode) => ({
            ...factoryNode.item,
            canManageApps: canManageScope(access, { kind: 'factory', id: factoryNode.item.id }, 'app'),
            canManageMemberships: canManageScope(
              access,
              { kind: 'factory', id: factoryNode.item.id },
              'membership',
            ),
            departments: factoryNode.departments
              .sort((left, right) => left.item.name.localeCompare(right.item.name))
              .map((departmentNode) => ({
                ...departmentNode.item,
                canManageApps: canManageScope(
                  access,
                  { kind: 'department', id: departmentNode.item.id },
                  'app',
                ),
                canManageMemberships: canManageScope(
                  access,
                  { kind: 'department', id: departmentNode.item.id },
                  'membership',
                ),
                devices: departmentNode.devices
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((deviceNode) => ({
                    ...deviceNode,
                    canManageApps: canManageScope(access, { kind: 'device', id: deviceNode.id }, 'app'),
                    canManageDevice: canManageScope(
                      access,
                      { kind: 'device', id: deviceNode.id },
                      'device',
                    ),
                  })),
              })),
          })),
      })),
  };
};

export const evaluateDevicePanelAccess = (
  access: ActiveAccessContext,
  deviceRecord: DeviceRow,
): DevicePanelAccess[] => {
  const hierarchy = access.deviceHierarchyById.get(deviceRecord.id) ?? {
    department: null,
    factory: null,
    headquarter: null,
  };
  const supportedPanelKeys = parseSupportedPanelKeys(deviceRecord.metadata);
  const disabledPanelKeys = parseDisabledPanelKeys(deviceRecord.metadata);

  return access.appDefinitions
    .filter((definition) => definition.metadata.surface === 'device')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((definition) => {
      const panelKey =
        typeof definition.metadata.panelKey === 'string'
          ? definition.metadata.panelKey
          : definition.key;
      const explicitGrant = access.appGrants
        .filter(
          (grant) =>
            grant.subjectType === 'user' &&
            grant.subjectId === access.user.id &&
            grant.appId === definition.id &&
            isScopeWithin(access.hierarchy, { kind: grant.scopeKind, id: grant.scopeId }, { kind: 'device', id: deviceRecord.id }) &&
            matchesGrantConditions(grant, deviceRecord, hierarchy),
        )
        .sort(compareGrantPriority)[0];

      const isSupported =
        !disabledPanelKeys.has(definition.key) &&
        !disabledPanelKeys.has(panelKey) &&
        (supportedPanelKeys === null ||
          supportedPanelKeys.has(definition.key) ||
          supportedPanelKeys.has(panelKey));

      if (access.isSystemAdmin) {
        return {
          accessLevel: 'manage',
          app: definition,
          grantScope: { kind: 'platform', id: 'platform' },
          isSupported,
          isVisible: isSupported,
          reason: isSupported ? 'system-admin' : 'unsupported',
        };
      }

      if (explicitGrant) {
        return {
          accessLevel: explicitGrant.effect === 'deny' ? null : explicitGrant.accessLevel,
          app: definition,
          grantScope: { kind: explicitGrant.scopeKind, id: explicitGrant.scopeId },
          isSupported,
          isVisible: explicitGrant.effect === 'allow' && isSupported,
          reason: explicitGrant.effect === 'deny' ? 'explicit-deny' : isSupported ? 'explicit-grant' : 'unsupported',
        };
      }

      const defaultAccessLevel = resolveDefaultAccessLevel(definition.metadata);
      if (defaultAccessLevel && access.accessibleDeviceIds.has(deviceRecord.id)) {
        return {
          accessLevel: isSupported ? defaultAccessLevel : null,
          app: definition,
          grantScope: hierarchy.department
            ? { kind: 'department', id: hierarchy.department.id }
            : hierarchy.factory
              ? { kind: 'factory', id: hierarchy.factory.id }
              : hierarchy.headquarter
                ? { kind: 'headquarter', id: hierarchy.headquarter.id }
                : { kind: 'device', id: deviceRecord.id },
          isSupported,
          isVisible: isSupported,
          reason: isSupported ? 'default-membership' : 'unsupported',
        };
      }

      return {
        accessLevel: null,
        app: definition,
        grantScope: null,
        isSupported,
        isVisible: false,
        reason: 'unsupported',
      };
    });
};

export const buildBootstrapPayload = (access: ActiveAccessContext) => {
  const cloudApps = access.appDefinitions
    .filter((definition) => definition.metadata.surface === 'cloud')
    .map((definition) => ({
      ...getCloudAppVisibility(access, definition),
      id: definition.id,
      key: definition.key,
      metadata: definition.metadata,
      name: definition.name,
    }))
    .filter((definition) => definition.isVisible);

  return {
    routes: {
      admin: access.canAccessAdminConsole ? '/admin' : null,
      dashboard: '/dashboard',
      devices: '/devices',
    },
    summary: {
      accessibleDevices: access.accessibleDeviceIds.size,
      accessibleScopes: access.accessibleScopeKeys.size,
      canAccessAdminConsole: access.canAccessAdminConsole,
      manageableScopes: listManageableScopes(access).length,
    },
    user: {
      email: access.user.email,
      id: access.user.id,
      image: access.user.image,
      name: access.user.name,
      role: access.user.role,
    },
    visibleCloudApps: cloudApps,
    memberships: access.memberships.map((membership) => ({
      id: membership.id,
      metadata: membership.metadata,
      permissions: membership.permissions,
      roleKey: membership.roleKey,
      scope: membership.scope,
      scopePath: membership.scopePath,
    })),
  };
};

export const findDeviceByPublicId = (
  hierarchy: HierarchyIndex,
  publicId: string,
): DeviceRow | null =>
  hierarchy.devices.find((deviceRecord) => deviceRecord.publicId === publicId) ?? null;

export const getDeviceWorkspacePayload = (
  access: ActiveAccessContext,
  deviceRecord: DeviceRow,
) => {
  const hierarchy = access.deviceHierarchyById.get(deviceRecord.id) ?? {
    department: null,
    factory: null,
    headquarter: null,
  };
  const appPanels = evaluateDevicePanelAccess(access, deviceRecord);

  return {
    appPanels,
    device: deviceRecord,
    hierarchy,
    permissions: {
      canManageApps: canManageScope(access, { kind: 'device', id: deviceRecord.id }, 'app'),
      canManageDevice: canManageScope(access, { kind: 'device', id: deviceRecord.id }, 'device'),
      canManageMemberships: canManageScope(
        access,
        { kind: 'device', id: deviceRecord.id },
        'membership',
      ),
    },
  };
};

export const listVisibleUsers = async (
  database: Database,
  access: ActiveAccessContext,
  search?: string,
): Promise<UserRow[]> => {
  if (access.isSystemAdmin) {
    return database
      .select()
      .from(user)
      .where(
        search
          ? or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
          : undefined,
      );
  }

  const allMemberships = await database
    .select()
    .from(userScopeMembership)
    .where(isNull(userScopeMembership.revokedAt));

  const visibleUserIds = new Set(
    allMemberships
      .filter((membership) =>
        canManageScope(
          access,
          { kind: membership.scopeKind, id: membership.scopeId },
          'membership',
        ),
      )
      .map((membership) => membership.userId),
  );

  visibleUserIds.add(access.user.id);

  if (visibleUserIds.size === 0) {
    return [];
  }

  const conditions = [inArray(user.id, Array.from(visibleUserIds))];
  if (search) {
    conditions.push(or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))!);
  }

  return database.select().from(user).where(and(...conditions));
};
