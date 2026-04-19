import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { account, user } from '../packages/core/trakrai-backend/src/db/auth-schema.ts';
import { createDatabase } from '../packages/core/trakrai-backend/src/db/client.ts';
import {
  device,
  deviceComponentCatalog,
  deviceComponentInstallation,
} from '../packages/core/trakrai-backend/src/db/schema.ts';
import {
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  deleteObjectAuthzRelations,
  writeAuthzTuples,
} from '../packages/core/trakrai-backend/src/lib/authz/index.ts';
import {
  loadDeviceComponentManifestEntries,
  type DeviceComponentManifestEntry,
} from '../packages/core/trakrai-backend/src/lib/device-component-manifest.ts';

const DEFAULT_SYSADMIN_EMAIL = 'vashni@hacklab.solutions';
const DEFAULT_SYSADMIN_NAME = 'Vashni';
const DEFAULT_SYSADMIN_PASSWORD = 'HACK@LAB';
const CREDENTIAL_PROVIDER_ID = 'credential';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');

const readRequiredEnvString = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const normalizeStringArray = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value !== '')));

const hasSameStringArray = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const buildComponentParentTuple = (componentId: string, deviceId: string) => ({
  object: `${AUTHZ_TYPE_DEVICE_COMPONENT}:${componentId}`,
  relation: 'parent',
  user: `${AUTHZ_TYPE_DEVICE}:${deviceId}`,
});

const upsertSysadmin = async (database: ReturnType<typeof createDatabase>['db']) => {
  const sysadminEmail = process.env.LOCAL_SYSADMIN_EMAIL?.trim() || DEFAULT_SYSADMIN_EMAIL;
  const sysadminName = process.env.LOCAL_SYSADMIN_NAME?.trim() || DEFAULT_SYSADMIN_NAME;
  const sysadminPassword = process.env.LOCAL_SYSADMIN_PASSWORD?.trim() || DEFAULT_SYSADMIN_PASSWORD;
  const now = new Date();
  const passwordHash = await hashPassword(sysadminPassword);

  const [existingUser] = await database
    .select({
      id: user.id,
    })
    .from(user)
    .where(eq(user.email, sysadminEmail))
    .limit(1);

  const userId = existingUser?.id ?? randomUUID();

  if (existingUser === undefined) {
    await database.insert(user).values({
      createdAt: now,
      email: sysadminEmail,
      emailVerified: true,
      id: userId,
      name: sysadminName,
      role: 'admin',
      updatedAt: now,
    });
  } else {
    await database
      .update(user)
      .set({
        banExpires: null,
        banReason: null,
        banned: false,
        emailVerified: true,
        name: sysadminName,
        role: 'admin',
        updatedAt: now,
      })
      .where(eq(user.id, userId));
  }

  const [existingCredentialAccount] = await database
    .select({
      id: account.id,
    })
    .from(account)
    .where(and(eq(account.providerId, CREDENTIAL_PROVIDER_ID), eq(account.userId, userId)))
    .limit(1);

  if (existingCredentialAccount === undefined) {
    await database.insert(account).values({
      accountId: userId,
      createdAt: now,
      id: randomUUID(),
      password: passwordHash,
      providerId: CREDENTIAL_PROVIDER_ID,
      updatedAt: now,
      userId,
    });
  } else {
    await database
      .update(account)
      .set({
        accountId: userId,
        password: passwordHash,
        providerId: CREDENTIAL_PROVIDER_ID,
        updatedAt: now,
      })
      .where(eq(account.id, existingCredentialAccount.id));
  }

  return {
    email: sysadminEmail,
    role: 'admin',
    userId,
  };
};

const upsertCatalogEntries = async (
  database: ReturnType<typeof createDatabase>['db'],
  desiredEntries: readonly DeviceComponentManifestEntry[],
) => {
  const existingEntries = await database.select().from(deviceComponentCatalog);
  const existingEntriesByKey = new Map(existingEntries.map((entry) => [entry.key, entry]));

  let createdCount = 0;
  let updatedCount = 0;

  for (const desiredEntry of desiredEntries) {
    const existingEntry = existingEntriesByKey.get(desiredEntry.key);
    const normalizedReadActions = normalizeStringArray(desiredEntry.readActions);
    const normalizedWriteActions = normalizeStringArray(desiredEntry.writeActions);

    if (existingEntry === undefined) {
      await database.insert(deviceComponentCatalog).values({
        defaultEnabled: desiredEntry.defaultEnabled,
        description: desiredEntry.description,
        displayName: desiredEntry.displayName,
        key: desiredEntry.key,
        navigationLabel: desiredEntry.navigationLabel,
        readActions: normalizedReadActions,
        rendererKey: desiredEntry.rendererKey,
        routePath: desiredEntry.routePath,
        serviceName: desiredEntry.serviceName,
        sortOrder: desiredEntry.sortOrder,
        writeActions: normalizedWriteActions,
      });
      createdCount += 1;
      continue;
    }

    const needsUpdate =
      existingEntry.defaultEnabled !== desiredEntry.defaultEnabled ||
      existingEntry.description !== desiredEntry.description ||
      existingEntry.displayName !== desiredEntry.displayName ||
      existingEntry.navigationLabel !== desiredEntry.navigationLabel ||
      !hasSameStringArray(existingEntry.readActions, normalizedReadActions) ||
      existingEntry.rendererKey !== desiredEntry.rendererKey ||
      existingEntry.routePath !== desiredEntry.routePath ||
      existingEntry.serviceName !== desiredEntry.serviceName ||
      existingEntry.sortOrder !== desiredEntry.sortOrder ||
      !hasSameStringArray(existingEntry.writeActions, normalizedWriteActions);

    if (!needsUpdate) {
      continue;
    }

    await database
      .update(deviceComponentCatalog)
      .set({
        defaultEnabled: desiredEntry.defaultEnabled,
        description: desiredEntry.description,
        displayName: desiredEntry.displayName,
        navigationLabel: desiredEntry.navigationLabel,
        readActions: normalizedReadActions,
        rendererKey: desiredEntry.rendererKey,
        routePath: desiredEntry.routePath,
        serviceName: desiredEntry.serviceName,
        sortOrder: desiredEntry.sortOrder,
        writeActions: normalizedWriteActions,
      })
      .where(eq(deviceComponentCatalog.key, desiredEntry.key));

    updatedCount += 1;
  }

  return {
    createdCount,
    existingEntries,
    updatedCount,
  };
};

const removeStaleCatalogEntries = async (
  database: ReturnType<typeof createDatabase>['db'],
  desiredEntries: readonly DeviceComponentManifestEntry[],
  existingEntries: readonly (typeof deviceComponentCatalog.$inferSelect)[],
) => {
  const desiredKeys = new Set(desiredEntries.map((entry) => entry.key));
  const staleKeys = existingEntries
    .map((entry) => entry.key)
    .filter((existingKey) => !desiredKeys.has(existingKey));

  if (staleKeys.length === 0) {
    return {
      deletedCatalogCount: 0,
      deletedInstallationCount: 0,
    };
  }

  const staleInstallations = await database
    .select({
      id: deviceComponentInstallation.id,
    })
    .from(deviceComponentInstallation)
    .where(inArray(deviceComponentInstallation.componentKey, staleKeys));

  for (const installation of staleInstallations) {
    await deleteObjectAuthzRelations(AUTHZ_TYPE_DEVICE_COMPONENT, installation.id);
  }

  await database
    .delete(deviceComponentInstallation)
    .where(inArray(deviceComponentInstallation.componentKey, staleKeys));
  await database
    .delete(deviceComponentCatalog)
    .where(inArray(deviceComponentCatalog.key, staleKeys));

  return {
    deletedCatalogCount: staleKeys.length,
    deletedInstallationCount: staleInstallations.length,
  };
};

const ensureDeviceInstallations = async (
  database: ReturnType<typeof createDatabase>['db'],
  desiredEntries: readonly DeviceComponentManifestEntry[],
) => {
  const devices = await database.select({ id: device.id }).from(device);
  if (devices.length === 0 || desiredEntries.length === 0) {
    return {
      createdInstallationCount: 0,
      ensuredTupleCount: 0,
    };
  }

  const existingInstallations = await database
    .select({
      componentKey: deviceComponentInstallation.componentKey,
      deviceId: deviceComponentInstallation.deviceId,
      id: deviceComponentInstallation.id,
    })
    .from(deviceComponentInstallation);

  const existingInstallationKeys = new Set(
    existingInstallations.map(
      (installation) => `${installation.deviceId}:${installation.componentKey}`,
    ),
  );
  const defaultEnabledByKey = new Map(
    desiredEntries.map((entry) => [entry.key, entry.defaultEnabled] as const),
  );

  const missingInstallations = devices.flatMap((deviceRow) =>
    desiredEntries
      .filter((entry) => !existingInstallationKeys.has(`${deviceRow.id}:${entry.key}`))
      .map((entry) => ({
        componentKey: entry.key,
        deviceId: deviceRow.id,
        enabled: defaultEnabledByKey.get(entry.key) ?? false,
        id: randomUUID(),
      })),
  );

  if (missingInstallations.length > 0) {
    await database.insert(deviceComponentInstallation).values(missingInstallations);
  }

  const ensuredInstallations =
    missingInstallations.length === 0
      ? existingInstallations
      : [
          ...existingInstallations,
          ...missingInstallations.map((installation) => ({
            componentKey: installation.componentKey,
            deviceId: installation.deviceId,
            id: installation.id,
          })),
        ];

  await writeAuthzTuples(
    ensuredInstallations.map((installation) =>
      buildComponentParentTuple(installation.id, installation.deviceId),
    ),
  );

  return {
    createdInstallationCount: missingInstallations.length,
    ensuredTupleCount: ensuredInstallations.length,
  };
};

const syncDeviceComponentCatalog = async (database: ReturnType<typeof createDatabase>['db']) => {
  const desiredEntries = loadDeviceComponentManifestEntries(repoRoot);
  const { createdCount, existingEntries, updatedCount } = await upsertCatalogEntries(
    database,
    desiredEntries,
  );
  const { deletedCatalogCount, deletedInstallationCount } = await removeStaleCatalogEntries(
    database,
    desiredEntries,
    existingEntries,
  );
  const { createdInstallationCount, ensuredTupleCount } = await ensureDeviceInstallations(
    database,
    desiredEntries,
  );

  return {
    catalogKeys: desiredEntries.map((entry) => entry.key),
    createdCatalogCount: createdCount,
    createdInstallationCount,
    deletedCatalogCount,
    deletedInstallationCount,
    ensuredTupleCount,
    updatedCatalogCount: updatedCount,
  };
};

const main = async () => {
  const { db, pool } = createDatabase({
    connectionString: readRequiredEnvString('DATABASE_URL'),
  });

  try {
    const [sysadmin, catalog] = await Promise.all([
      upsertSysadmin(db),
      syncDeviceComponentCatalog(db),
    ]);

    console.log(
      JSON.stringify(
        {
          catalog,
          sysadmin,
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
