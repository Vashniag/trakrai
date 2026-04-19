import { randomUUID } from 'node:crypto';

import { hashPassword } from 'better-auth/crypto';
import { faker } from '@faker-js/faker';
import { eq, inArray, like } from 'drizzle-orm';

import { account, user } from '../packages/core/trakrai-backend/src/db/auth-schema.ts';
import { createDatabase } from '../packages/core/trakrai-backend/src/db/client.ts';
import {
  department,
  device,
  deviceComponentInstallation,
  factory,
} from '../packages/core/trakrai-backend/src/db/schema.ts';
import {
  AUTHZ_RELATION_ADMIN,
  AUTHZ_RELATION_READER,
  AUTHZ_RELATION_VIEWER,
  AUTHZ_RELATION_WRITER,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  createAuthzObject,
  createAuthzUser,
  createObjectParentTupleKeys,
  deleteAuthzTuples,
  ensureAuthzState,
  readAllTuples,
  writeAuthzTuples,
} from '../packages/core/trakrai-backend/src/lib/authz/index.ts';
import { createDeviceAccessToken } from '../packages/core/trakrai-backend/src/lib/device-access-token.ts';

import {
  readRequiredEnvString,
  syncDeviceComponentCatalog,
  type LocalDatabase,
  upsertSysadmin,
} from './lib/local-db-bootstrap.ts';

const DEMO_PASSWORD = 'HACK@LAB';
const DEMO_EMAIL_DOMAIN = 'hacklab.solutions';
const DEMO_FACTORY_COUNT = 20;
const DEMO_DEPARTMENTS_PER_FACTORY = 20;
const DEMO_DEVICES_PER_DEPARTMENT = 20;
const DEMO_USERS_PER_FACTORY = 10;
const DEMO_USER_COUNT = DEMO_FACTORY_COUNT * DEMO_USERS_PER_FACTORY;

const DEMO_ENTITY_DESCRIPTION_PREFIX = '[demo-seed]';
const DEMO_USER_PREFIX = 'demo-user-';
const CREDENTIAL_PROVIDER_ID = 'credential';
const DEMO_RANDOM_SEED_DEFAULT = 20260419;

type DemoUserRecord = Readonly<{
  email: string;
  factoryIndex: number;
  id: string;
  name: string;
  slotIndex: number;
}>;

type DemoFactoryRecord = typeof factory.$inferInsert &
  Readonly<{
    factoryIndex: number;
  }>;

type DemoDepartmentRecord = typeof department.$inferInsert &
  Readonly<{
    departmentIndex: number;
    factoryIndex: number;
  }>;

type DemoDeviceRecord = typeof device.$inferInsert &
  Readonly<{
    departmentIndex: number;
    deviceIndex: number;
    factoryIndex: number;
  }>;

type DemoFactoryUserGroup = Readonly<{
  departmentAdminIds: readonly [string, string];
  departmentViewerIds: readonly [string, string];
  deviceViewerIds: readonly [string, string];
  factoryAdminId: string;
  factoryViewerIds: readonly string[];
}>;

type DemoRelationCounts = Readonly<{
  componentReaders: number;
  componentWriters: number;
  departmentAdmins: number;
  departmentParents: number;
  departmentViewers: number;
  deviceParents: number;
  deviceViewers: number;
  factoryAdmins: number;
  factoryViewers: number;
}>;

const padNumber = (value: number, width: number): string => value.toString().padStart(width, '0');

const getDemoSeed = (offset = 0): number => {
  const configuredSeed = Number.parseInt(
    process.env.DEMO_RANDOM_SEED ?? `${DEMO_RANDOM_SEED_DEFAULT}`,
    10,
  );
  return Number.isNaN(configuredSeed) ? DEMO_RANDOM_SEED_DEFAULT + offset : configuredSeed + offset;
};

const createMulberry32 = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let result = Math.imul(state ^ (state >>> 15), state | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

const chunkArray = <TValue>(values: readonly TValue[], size: number): TValue[][] => {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const insertInChunks = async <TValue>(
  values: readonly TValue[],
  chunkSize: number,
  insertChunk: (chunk: readonly TValue[]) => Promise<void>,
) => {
  for (const chunk of chunkArray(values, chunkSize)) {
    await insertChunk(chunk);
  }
};

const normalizeEmailLocalPart = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

const pickRandomItem = <TValue>(values: readonly TValue[], random: () => number): TValue => {
  if (values.length === 0) {
    throw new Error('Cannot pick from an empty array.');
  }

  return values[Math.floor(random() * values.length)]!;
};

const pickRandomDistinctItems = <TValue>(
  values: readonly TValue[],
  count: number,
  random: () => number,
): TValue[] => {
  const pool = [...values];
  const picked: TValue[] = [];

  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(random() * pool.length);
    const [value] = pool.splice(index, 1);
    if (value !== undefined) {
      picked.push(value);
    }
  }

  return picked;
};

const buildDemoUserId = (userIndex: number): string =>
  `${DEMO_USER_PREFIX}${padNumber(userIndex + 1, 3)}`;

const createDemoDescription = (kind: string): string => `${DEMO_ENTITY_DESCRIPTION_PREFIX} ${kind}`;

const createUniqueNameFactory = (buildCandidate: () => string, fallbackPrefix: string) => {
  const usedNames = new Set<string>();

  return (index: number): string => {
    let attempts = 0;

    while (attempts < 20) {
      const candidate = buildCandidate().trim();
      if (candidate !== '' && !usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }

      attempts += 1;
    }

    const fallback = `${fallbackPrefix} ${randomUUID().slice(0, 8)}`;
    usedNames.add(fallback);
    return fallback;
  };
};

const buildDemoUsers = (): DemoUserRecord[] => {
  faker.seed(getDemoSeed(0));

  return Array.from({ length: DEMO_USER_COUNT }, (_, userIndex) => {
    const name = faker.person.fullName();
    const emailBase = normalizeEmailLocalPart(name) || `user-${padNumber(userIndex + 1, 3)}`;

    return {
      email: `${emailBase}-${padNumber(userIndex + 1, 3)}@${DEMO_EMAIL_DOMAIN}`,
      factoryIndex: Math.floor(userIndex / DEMO_USERS_PER_FACTORY),
      id: buildDemoUserId(userIndex),
      name,
      slotIndex: userIndex % DEMO_USERS_PER_FACTORY,
    } satisfies DemoUserRecord;
  });
};

const buildDemoUserGroups = (
  users: readonly DemoUserRecord[],
): Map<number, DemoFactoryUserGroup> => {
  const groupedUsers = new Map<number, DemoUserRecord[]>();

  for (const demoUser of users) {
    const existingUsers = groupedUsers.get(demoUser.factoryIndex) ?? [];
    existingUsers.push(demoUser);
    groupedUsers.set(demoUser.factoryIndex, existingUsers);
  }

  return new Map(
    Array.from(groupedUsers.entries()).map(([factoryIndex, factoryUsers]) => {
      const sortedUsers = [...factoryUsers].sort((left, right) => left.slotIndex - right.slotIndex);
      if (sortedUsers.length !== DEMO_USERS_PER_FACTORY) {
        throw new Error(
          `Factory index ${factoryIndex} expected ${DEMO_USERS_PER_FACTORY} demo users, received ${sortedUsers.length}.`,
        );
      }

      return [
        factoryIndex,
        {
          departmentAdminIds: [sortedUsers[4]!.id, sortedUsers[5]!.id],
          departmentViewerIds: [sortedUsers[6]!.id, sortedUsers[7]!.id],
          deviceViewerIds: [sortedUsers[8]!.id, sortedUsers[9]!.id],
          factoryAdminId: sortedUsers[0]!.id,
          factoryViewerIds: [sortedUsers[1]!.id, sortedUsers[2]!.id, sortedUsers[3]!.id],
        } satisfies DemoFactoryUserGroup,
      ] as const;
    }),
  );
};

const buildDemoFactories = (): DemoFactoryRecord[] => {
  faker.seed(getDemoSeed(10));
  const nextFactoryName = createUniqueNameFactory(
    () => `${faker.company.name()} Facility`,
    'Factory',
  );

  return Array.from({ length: DEMO_FACTORY_COUNT }, (_, factoryIndex) => ({
    description: createDemoDescription('factory'),
    factoryIndex,
    id: randomUUID(),
    name: nextFactoryName(factoryIndex),
  }));
};

const buildDemoDepartments = (factories: readonly DemoFactoryRecord[]): DemoDepartmentRecord[] => {
  faker.seed(getDemoSeed(20));
  const nextDepartmentName = createUniqueNameFactory(
    () => `${faker.commerce.department()} ${faker.word.noun()}`,
    'Department',
  );

  return factories.flatMap((demoFactory) =>
    Array.from({ length: DEMO_DEPARTMENTS_PER_FACTORY }, (_, departmentIndex) => ({
      departmentIndex,
      description: createDemoDescription('department'),
      factoryId: demoFactory.id,
      factoryIndex: demoFactory.factoryIndex,
      id: randomUUID(),
      name: nextDepartmentName(
        demoFactory.factoryIndex * DEMO_DEPARTMENTS_PER_FACTORY + departmentIndex,
      ),
    })),
  );
};

const buildDemoDevices = (departments: readonly DemoDepartmentRecord[]): DemoDeviceRecord[] => {
  faker.seed(getDemoSeed(30));
  const nextDeviceName = createUniqueNameFactory(
    () => `${faker.vehicle.manufacturer()} ${faker.vehicle.model()}`,
    'Device',
  );

  return departments.flatMap((demoDepartment) =>
    Array.from({ length: DEMO_DEVICES_PER_DEPARTMENT }, (_, deviceIndex) => ({
      accessToken: createDeviceAccessToken(),
      departmentId: demoDepartment.id,
      departmentIndex: demoDepartment.departmentIndex,
      description: createDemoDescription('device'),
      deviceIndex,
      factoryIndex: demoDepartment.factoryIndex,
      id: randomUUID(),
      isActive: true,
      name: nextDeviceName(
        demoDepartment.factoryIndex * DEMO_DEPARTMENTS_PER_FACTORY * DEMO_DEVICES_PER_DEPARTMENT +
          demoDepartment.departmentIndex * DEMO_DEVICES_PER_DEPARTMENT +
          deviceIndex,
      ),
    })),
  );
};

const clearPreviousDemoData = async (database: LocalDatabase) => {
  const [demoUsers, demoFactories, demoDepartments, demoDevices, demoInstallations] =
    await Promise.all([
      database
        .select({ id: user.id })
        .from(user)
        .where(like(user.id, `${DEMO_USER_PREFIX}%`)),
      database
        .select({ id: factory.id })
        .from(factory)
        .where(like(factory.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`)),
      database
        .select({ id: department.id })
        .from(department)
        .where(like(department.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`)),
      database
        .select({ id: device.id })
        .from(device)
        .where(like(device.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`)),
      database
        .select({ id: deviceComponentInstallation.id })
        .from(deviceComponentInstallation)
        .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
        .where(like(device.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`)),
    ]);

  const authzObjectIds = new Set([
    ...demoFactories.map((row) => createAuthzObject(AUTHZ_TYPE_FACTORY, row.id)),
    ...demoDepartments.map((row) => createAuthzObject(AUTHZ_TYPE_DEPARTMENT, row.id)),
    ...demoDevices.map((row) => createAuthzObject(AUTHZ_TYPE_DEVICE, row.id)),
    ...demoInstallations.map((row) => createAuthzObject(AUTHZ_TYPE_DEVICE_COMPONENT, row.id)),
  ]);
  const authzUserIds = new Set(demoUsers.map((row) => createAuthzUser(row.id)));

  const { client } = await ensureAuthzState();
  const tuplesToDelete = (await readAllTuples(client)).filter(
    (tupleKey) => authzObjectIds.has(tupleKey.object) || authzUserIds.has(tupleKey.user),
  );

  await deleteAuthzTuples(
    tuplesToDelete.map((tupleKey) => ({
      object: tupleKey.object,
      relation: tupleKey.relation,
      user: tupleKey.user,
    })),
  );

  await database
    .delete(device)
    .where(like(device.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`));
  await database
    .delete(department)
    .where(like(department.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`));
  await database
    .delete(factory)
    .where(like(factory.description, `${DEMO_ENTITY_DESCRIPTION_PREFIX}%`));
  await database.delete(user).where(like(user.id, `${DEMO_USER_PREFIX}%`));

  return {
    deletedDepartments: demoDepartments.length,
    deletedDevices: demoDevices.length,
    deletedFactories: demoFactories.length,
    deletedInstallations: demoInstallations.length,
    deletedTuples: tuplesToDelete.length,
    deletedUsers: demoUsers.length,
  };
};

const insertDemoUsers = async (database: LocalDatabase, demoUsers: readonly DemoUserRecord[]) => {
  const now = new Date();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await insertInChunks(demoUsers, 100, async (chunk) => {
    await database.insert(user).values(
      chunk.map((demoUser) => ({
        createdAt: now,
        email: demoUser.email,
        emailVerified: true,
        id: demoUser.id,
        name: demoUser.name,
        role: 'user',
        updatedAt: now,
      })),
    );

    await database.insert(account).values(
      chunk.map((demoUser) => ({
        accountId: demoUser.id,
        createdAt: now,
        id: `${demoUser.id}-credential`,
        password: passwordHash,
        providerId: CREDENTIAL_PROVIDER_ID,
        updatedAt: now,
        userId: demoUser.id,
      })),
    );
  });
};

const insertDemoHierarchy = async (
  database: LocalDatabase,
  factories: readonly DemoFactoryRecord[],
  departments: readonly DemoDepartmentRecord[],
  devices: readonly DemoDeviceRecord[],
) => {
  await database.insert(factory).values(
    factories.map((demoFactory) => ({
      description: demoFactory.description,
      id: demoFactory.id,
      name: demoFactory.name,
    })),
  );
  await database.insert(department).values(
    departments.map((demoDepartment) => ({
      description: demoDepartment.description,
      factoryId: demoDepartment.factoryId,
      id: demoDepartment.id,
      name: demoDepartment.name,
    })),
  );
  await insertInChunks(devices, 500, async (chunk) => {
    await database.insert(device).values(
      chunk.map((demoDevice) => ({
        accessToken: demoDevice.accessToken,
        departmentId: demoDevice.departmentId,
        description: demoDevice.description,
        id: demoDevice.id,
        isActive: demoDevice.isActive,
        name: demoDevice.name,
      })),
    );
  });
};

const buildDemoAuthzTuples = (
  demoUsers: readonly DemoUserRecord[],
  demoFactories: readonly DemoFactoryRecord[],
  demoDepartments: readonly DemoDepartmentRecord[],
  demoDevices: readonly DemoDeviceRecord[],
  installationsByDeviceId: ReadonlyMap<
    string,
    ReadonlyArray<Readonly<{ componentKey: string; id: string }>>
  >,
) => {
  const random = createMulberry32(getDemoSeed(40));
  const userGroups = buildDemoUserGroups(demoUsers);

  const factoryTuples = demoFactories.flatMap((demoFactory) => {
    const group = userGroups.get(demoFactory.factoryIndex);
    if (group === undefined) {
      throw new Error(`Missing user group for factory index ${demoFactory.factoryIndex}.`);
    }

    return [
      {
        object: createAuthzObject(AUTHZ_TYPE_FACTORY, demoFactory.id),
        relation: AUTHZ_RELATION_ADMIN,
        user: createAuthzUser(group.factoryAdminId),
      },
      ...group.factoryViewerIds.map((userId) => ({
        object: createAuthzObject(AUTHZ_TYPE_FACTORY, demoFactory.id),
        relation: AUTHZ_RELATION_VIEWER,
        user: createAuthzUser(userId),
      })),
    ];
  });

  const departmentParentTuples = demoDepartments.flatMap((demoDepartment) =>
    createObjectParentTupleKeys(
      AUTHZ_TYPE_DEPARTMENT,
      demoDepartment.id,
      AUTHZ_TYPE_FACTORY,
      demoDepartment.factoryId,
    ),
  );

  const departmentAccessEntries = new Map<
    string,
    Readonly<{
      adminUserId: string;
      viewerUserId: string;
    }>
  >();

  const departmentAccessTuples = demoDepartments.flatMap((demoDepartment) => {
    const group = userGroups.get(demoDepartment.factoryIndex);
    if (group === undefined) {
      throw new Error(`Missing user group for factory ${demoDepartment.factoryId}.`);
    }

    const adminUserId = pickRandomItem(group.departmentAdminIds, random);
    const viewerUserId = pickRandomItem(group.departmentViewerIds, random);
    departmentAccessEntries.set(demoDepartment.id, {
      adminUserId,
      viewerUserId,
    });

    return [
      {
        object: createAuthzObject(AUTHZ_TYPE_DEPARTMENT, demoDepartment.id),
        relation: AUTHZ_RELATION_ADMIN,
        user: createAuthzUser(adminUserId),
      },
      {
        object: createAuthzObject(AUTHZ_TYPE_DEPARTMENT, demoDepartment.id),
        relation: AUTHZ_RELATION_VIEWER,
        user: createAuthzUser(viewerUserId),
      },
    ];
  });

  const deviceParentTuples = demoDevices.flatMap((demoDevice) =>
    createObjectParentTupleKeys(
      AUTHZ_TYPE_DEVICE,
      demoDevice.id,
      AUTHZ_TYPE_DEPARTMENT,
      demoDevice.departmentId,
    ),
  );

  const componentParentTuples = Array.from(installationsByDeviceId.entries()).flatMap(
    ([deviceId, installationRows]) =>
      installationRows.flatMap((installation) =>
        createObjectParentTupleKeys(
          AUTHZ_TYPE_DEVICE_COMPONENT,
          installation.id,
          AUTHZ_TYPE_DEVICE,
          deviceId,
        ),
      ),
  );

  const deviceViewerTuples = demoDevices.map((demoDevice) => {
    const group = userGroups.get(demoDevice.factoryIndex);
    if (group === undefined) {
      throw new Error(`Missing user group for factory index ${demoDevice.factoryIndex}.`);
    }

    return {
      object: createAuthzObject(AUTHZ_TYPE_DEVICE, demoDevice.id),
      relation: AUTHZ_RELATION_VIEWER,
      user: createAuthzUser(pickRandomItem(group.deviceViewerIds, random)),
    };
  });

  const componentReaderTuples: Array<{
    object: string;
    relation: typeof AUTHZ_RELATION_READER;
    user: string;
  }> = [];
  const componentWriterTuples: Array<{
    object: string;
    relation: typeof AUTHZ_RELATION_WRITER;
    user: string;
  }> = [];

  for (const demoDevice of demoDevices) {
    const group = userGroups.get(demoDevice.factoryIndex);
    const departmentAccess = departmentAccessEntries.get(demoDevice.departmentId);
    const installationRows = installationsByDeviceId.get(demoDevice.id) ?? [];

    if (group === undefined || departmentAccess === undefined || installationRows.length === 0) {
      continue;
    }

    const accessibleUserIds = [
      group.factoryAdminId,
      ...group.factoryViewerIds,
      departmentAccess.adminUserId,
      departmentAccess.viewerUserId,
      pickRandomItem(group.deviceViewerIds, random),
    ];
    const selectedInstallations = pickRandomDistinctItems(installationRows, 2, random);
    const selectedUsers = pickRandomDistinctItems(accessibleUserIds, 2, random);

    if (selectedInstallations[0] !== undefined && selectedUsers[0] !== undefined) {
      componentWriterTuples.push({
        object: createAuthzObject(AUTHZ_TYPE_DEVICE_COMPONENT, selectedInstallations[0].id),
        relation: AUTHZ_RELATION_WRITER,
        user: createAuthzUser(selectedUsers[0]),
      });
    }

    if (selectedInstallations[1] !== undefined && selectedUsers[1] !== undefined) {
      componentReaderTuples.push({
        object: createAuthzObject(AUTHZ_TYPE_DEVICE_COMPONENT, selectedInstallations[1].id),
        relation: AUTHZ_RELATION_READER,
        user: createAuthzUser(selectedUsers[1]),
      });
    }
  }

  const relationCounts: DemoRelationCounts = {
    componentReaders: componentReaderTuples.length,
    componentWriters: componentWriterTuples.length,
    departmentAdmins: demoDepartments.length,
    departmentParents: demoDepartments.length,
    departmentViewers: demoDepartments.length,
    deviceParents: demoDevices.length,
    deviceViewers: deviceViewerTuples.length,
    factoryAdmins: DEMO_FACTORY_COUNT,
    factoryViewers: DEMO_FACTORY_COUNT * 3,
  };

  return {
    relationCounts,
    tuples: [
      ...factoryTuples,
      ...departmentParentTuples,
      ...departmentAccessTuples,
      ...deviceParentTuples,
      ...deviceViewerTuples,
      ...componentParentTuples,
      ...componentReaderTuples,
      ...componentWriterTuples,
    ],
  };
};

const main = async () => {
  const { db, pool } = createDatabase({
    connectionString: readRequiredEnvString('DATABASE_URL'),
  });

  try {
    const demoUsers = buildDemoUsers();
    const demoFactories = buildDemoFactories();
    const demoDepartments = buildDemoDepartments(demoFactories);
    const demoDevices = buildDemoDevices(demoDepartments);

    const [reset, sysadmin] = await Promise.all([clearPreviousDemoData(db), upsertSysadmin(db)]);

    await insertDemoUsers(db, demoUsers);
    await insertDemoHierarchy(db, demoFactories, demoDepartments, demoDevices);

    const catalog = await syncDeviceComponentCatalog(db);

    const demoInstallations = await db
      .select({
        componentKey: deviceComponentInstallation.componentKey,
        deviceId: deviceComponentInstallation.deviceId,
        id: deviceComponentInstallation.id,
      })
      .from(deviceComponentInstallation)
      .where(
        inArray(
          deviceComponentInstallation.deviceId,
          demoDevices.map((demoDevice) => demoDevice.id),
        ),
      );

    const installationsByDeviceId = new Map<
      string,
      Array<Readonly<{ componentKey: string; id: string }>>
    >();

    for (const installation of demoInstallations) {
      const existingRows = installationsByDeviceId.get(installation.deviceId) ?? [];
      existingRows.push({
        componentKey: installation.componentKey,
        id: installation.id,
      });
      installationsByDeviceId.set(installation.deviceId, existingRows);
    }

    const { relationCounts, tuples } = buildDemoAuthzTuples(
      demoUsers,
      demoFactories,
      demoDepartments,
      demoDevices,
      installationsByDeviceId,
    );

    await writeAuthzTuples(tuples);

    console.log(
      JSON.stringify(
        {
          catalog,
          reset,
          seeded: {
            departments: demoDepartments.length,
            devices: demoDevices.length,
            factories: demoFactories.length,
            installations: demoInstallations.length,
            users: demoUsers.length,
          },
          sysadmin,
          tuples: {
            total: tuples.length,
            ...relationCounts,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
