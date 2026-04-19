import { hashPassword } from 'better-auth/crypto';
import { faker } from '@faker-js/faker';
import { eq, like } from 'drizzle-orm';

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
  AUTHZ_RELATION_PARENT,
  AUTHZ_RELATION_READER,
  AUTHZ_RELATION_VIEWER,
  AUTHZ_RELATION_WRITER,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  createAuthzObject,
  createAuthzUser,
  deleteAuthzTuples,
  ensureAuthzState,
  readAllTuples,
  writeAuthzTuples,
} from '../packages/core/trakrai-backend/src/lib/authz/index.ts';

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

const DEMO_FACTORY_PREFIX = 'demo-factory-';
const DEMO_DEPARTMENT_PREFIX = 'demo-department-';
const DEMO_DEVICE_PREFIX = 'demo-device-';
const DEMO_USER_PREFIX = 'demo-user-';
const DEMO_DEVICE_TOKEN_PREFIX = 'demo-device-token-';
const CREDENTIAL_PROVIDER_ID = 'credential';

type DemoUserRecord = Readonly<{
  email: string;
  factoryIndex: number;
  id: string;
  name: string;
  slotIndex: number;
}>;

type DemoFactoryRecord = typeof factory.$inferInsert;
type DemoDepartmentRecord = typeof department.$inferInsert;
type DemoDeviceRecord = typeof device.$inferInsert &
  Readonly<{
    departmentIndex: number;
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

const buildDemoFactoryId = (factoryIndex: number): string =>
  `${DEMO_FACTORY_PREFIX}${padNumber(factoryIndex + 1, 2)}`;

const buildDemoDepartmentId = (factoryIndex: number, departmentIndex: number): string =>
  `${DEMO_DEPARTMENT_PREFIX}${padNumber(factoryIndex + 1, 2)}-${padNumber(departmentIndex + 1, 2)}`;

const buildDemoDeviceId = (
  factoryIndex: number,
  departmentIndex: number,
  deviceIndex: number,
): string =>
  `${DEMO_DEVICE_PREFIX}${padNumber(factoryIndex + 1, 2)}-${padNumber(departmentIndex + 1, 2)}-${padNumber(deviceIndex + 1, 2)}`;

const buildDemoUserId = (userIndex: number): string =>
  `${DEMO_USER_PREFIX}${padNumber(userIndex + 1, 3)}`;

const buildDemoUsers = (): DemoUserRecord[] => {
  const seed = Number.parseInt(process.env.DEMO_RANDOM_SEED ?? '20260419', 10);
  faker.seed(Number.isNaN(seed) ? 20260419 : seed);

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

const buildDemoFactories = (): DemoFactoryRecord[] =>
  Array.from({ length: DEMO_FACTORY_COUNT }, (_, factoryIndex) => ({
    description: `Seeded demo factory ${padNumber(factoryIndex + 1, 2)}.`,
    id: buildDemoFactoryId(factoryIndex),
    name: `Factory ${padNumber(factoryIndex + 1, 2)}`,
  }));

const buildDemoDepartments = (): DemoDepartmentRecord[] =>
  Array.from({ length: DEMO_FACTORY_COUNT }, (_, factoryIndex) =>
    Array.from({ length: DEMO_DEPARTMENTS_PER_FACTORY }, (_, departmentIndex) => ({
      description: `Seeded demo department ${padNumber(departmentIndex + 1, 2)} for factory ${padNumber(factoryIndex + 1, 2)}.`,
      factoryId: buildDemoFactoryId(factoryIndex),
      id: buildDemoDepartmentId(factoryIndex, departmentIndex),
      name: `Department ${padNumber(departmentIndex + 1, 2)}`,
    })),
  ).flat();

const buildDemoDevices = (): DemoDeviceRecord[] =>
  Array.from({ length: DEMO_FACTORY_COUNT }, (_, factoryIndex) =>
    Array.from({ length: DEMO_DEPARTMENTS_PER_FACTORY }, (_, departmentIndex) =>
      Array.from({ length: DEMO_DEVICES_PER_DEPARTMENT }, (_, deviceIndex) => ({
        accessToken: `${DEMO_DEVICE_TOKEN_PREFIX}${padNumber(factoryIndex + 1, 2)}-${padNumber(departmentIndex + 1, 2)}-${padNumber(deviceIndex + 1, 2)}`,
        departmentId: buildDemoDepartmentId(factoryIndex, departmentIndex),
        departmentIndex,
        description: `Seeded demo device ${padNumber(deviceIndex + 1, 2)} for department ${padNumber(departmentIndex + 1, 2)}.`,
        factoryIndex,
        id: buildDemoDeviceId(factoryIndex, departmentIndex, deviceIndex),
        isActive: true,
        name: `Device ${padNumber(deviceIndex + 1, 2)}`,
      })),
    ).flat(),
  ).flat();

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
        .where(like(factory.id, `${DEMO_FACTORY_PREFIX}%`)),
      database
        .select({ id: department.id })
        .from(department)
        .where(like(department.id, `${DEMO_DEPARTMENT_PREFIX}%`)),
      database
        .select({ id: device.id })
        .from(device)
        .where(like(device.id, `${DEMO_DEVICE_PREFIX}%`)),
      database
        .select({ id: deviceComponentInstallation.id })
        .from(deviceComponentInstallation)
        .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
        .where(like(device.id, `${DEMO_DEVICE_PREFIX}%`)),
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

  await database.delete(device).where(like(device.id, `${DEMO_DEVICE_PREFIX}%`));
  await database.delete(department).where(like(department.id, `${DEMO_DEPARTMENT_PREFIX}%`));
  await database.delete(factory).where(like(factory.id, `${DEMO_FACTORY_PREFIX}%`));
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
  await database.insert(factory).values([...factories]);
  await database.insert(department).values([...departments]);
  await insertInChunks(devices, 500, async (chunk) => {
    await database.insert(device).values([...chunk]);
  });
};

const buildDemoAuthzTuples = (
  demoUsers: readonly DemoUserRecord[],
  demoDepartments: readonly DemoDepartmentRecord[],
  demoDevices: readonly DemoDeviceRecord[],
  installationsByDeviceId: ReadonlyMap<
    string,
    ReadonlyArray<Readonly<{ componentKey: string; id: string }>>
  >,
) => {
  const seed = Number.parseInt(process.env.DEMO_RANDOM_SEED ?? '20260419', 10);
  const random = createMulberry32(Number.isNaN(seed) ? 20260419 : seed);
  const userGroups = buildDemoUserGroups(demoUsers);

  const factoryTuples = Array.from(userGroups.entries()).flatMap(([factoryIndex, group]) => [
    {
      object: createAuthzObject(AUTHZ_TYPE_FACTORY, buildDemoFactoryId(factoryIndex)),
      relation: AUTHZ_RELATION_ADMIN,
      user: createAuthzUser(group.factoryAdminId),
    },
    ...group.factoryViewerIds.map((userId) => ({
      object: createAuthzObject(AUTHZ_TYPE_FACTORY, buildDemoFactoryId(factoryIndex)),
      relation: AUTHZ_RELATION_VIEWER,
      user: createAuthzUser(userId),
    })),
  ]);

  const departmentParentTuples = demoDepartments.map((demoDepartment) => ({
    object: createAuthzObject(AUTHZ_TYPE_DEPARTMENT, demoDepartment.id),
    relation: AUTHZ_RELATION_PARENT,
    user: createAuthzObject(AUTHZ_TYPE_FACTORY, demoDepartment.factoryId),
  }));

  const departmentAccessEntries = new Map<
    string,
    Readonly<{
      adminUserId: string;
      viewerUserId: string;
    }>
  >();

  const departmentAccessTuples = demoDepartments.flatMap((demoDepartment) => {
    const factoryIndex = Number.parseInt(
      demoDepartment.factoryId.slice(DEMO_FACTORY_PREFIX.length),
      10,
    );
    const group = userGroups.get(factoryIndex - 1);
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

  const deviceParentTuples = demoDevices.map((demoDevice) => ({
    object: createAuthzObject(AUTHZ_TYPE_DEVICE, demoDevice.id),
    relation: AUTHZ_RELATION_PARENT,
    user: createAuthzObject(AUTHZ_TYPE_DEPARTMENT, demoDevice.departmentId),
  }));

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
    departmentParents: departmentParentTuples.length,
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
    const demoDepartments = buildDemoDepartments();
    const demoDevices = buildDemoDevices();

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
      .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
      .where(like(device.id, `${DEMO_DEVICE_PREFIX}%`));

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
