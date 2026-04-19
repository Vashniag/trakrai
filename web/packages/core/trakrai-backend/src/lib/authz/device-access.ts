import { eq } from 'drizzle-orm';

import { getScopedAssignments } from './assignments';
import {
  AUTHZ_RELATION_CAN_NAVIGATE,
  AUTHZ_RELATION_CAN_MANAGE_USERS,
  AUTHZ_RELATION_CAN_READ,
  AUTHZ_RELATION_CAN_WRITE,
  AUTHZ_TYPE_DEVICE,
  type DeviceComponentAccessRecord,
} from './constants';
import { checkUserObjectRelation } from './relations';

import type { Database } from '../../server/trpc';

import { device, deviceComponentCatalog, deviceComponentInstallation } from '../../db/schema';
import { signDeviceGatewayAccessToken } from '../gateway-access-token';

export const getDeviceComponentAccessForUser = async (
  db: Database,
  userId: string,
  deviceRecordId: string,
  isSysadmin = false,
): Promise<{
  canManageUsers: boolean;
  components: DeviceComponentAccessRecord[];
  gatewayAccessToken: string;
}> => {
  const [foundDevice] = await db
    .select({
      id: device.id,
    })
    .from(device)
    .where(eq(device.id, deviceRecordId))
    .limit(1);

  if (foundDevice === undefined) {
    throw new Error('Device not found.');
  }

  const canNavigateDevice = isSysadmin
    ? true
    : await checkUserObjectRelation(
        userId,
        AUTHZ_RELATION_CAN_NAVIGATE,
        AUTHZ_TYPE_DEVICE,
        foundDevice.id,
      );
  if (!canNavigateDevice) {
    throw new Error('You do not have access to this device.');
  }

  const canReadDevice = isSysadmin
    ? true
    : await checkUserObjectRelation(
        userId,
        AUTHZ_RELATION_CAN_READ,
        AUTHZ_TYPE_DEVICE,
        foundDevice.id,
      );

  const installationRows = await db
    .select({
      componentKey: deviceComponentInstallation.componentKey,
      description: deviceComponentCatalog.description,
      enabled: deviceComponentInstallation.enabled,
      id: deviceComponentInstallation.id,
      navigationLabel: deviceComponentCatalog.navigationLabel,
      readActions: deviceComponentCatalog.readActions,
      rendererKey: deviceComponentCatalog.rendererKey,
      routePath: deviceComponentCatalog.routePath,
      serviceName: deviceComponentCatalog.serviceName,
      sortOrder: deviceComponentCatalog.sortOrder,
      writeActions: deviceComponentCatalog.writeActions,
    })
    .from(deviceComponentInstallation)
    .innerJoin(
      deviceComponentCatalog,
      eq(deviceComponentCatalog.key, deviceComponentInstallation.componentKey),
    )
    .where(eq(deviceComponentInstallation.deviceId, deviceRecordId));

  const [canManageUsers, componentAssignments] = isSysadmin
    ? [true, null]
    : await Promise.all([
        checkUserObjectRelation(
          userId,
          AUTHZ_RELATION_CAN_MANAGE_USERS,
          AUTHZ_TYPE_DEVICE,
          foundDevice.id,
        ),
        getScopedAssignments({
          componentIds: installationRows.map((row) => row.id),
          userIds: [userId],
        }),
      ]);

  const directAccessByComponentId = new Map<
    string,
    typeof AUTHZ_RELATION_CAN_READ | typeof AUTHZ_RELATION_CAN_WRITE
  >();

  for (const assignment of componentAssignments?.componentAssignmentRows ?? []) {
    directAccessByComponentId.set(
      assignment.componentId,
      assignment.accessLevel === 'write' ? AUTHZ_RELATION_CAN_WRITE : AUTHZ_RELATION_CAN_READ,
    );
  }

  const components: DeviceComponentAccessRecord[] = installationRows
    .filter(
      (row) =>
        row.enabled && (isSysadmin || canReadDevice || directAccessByComponentId.has(row.id)),
    )
    .map((row) => {
      const accessLevel: DeviceComponentAccessRecord['accessLevel'] =
        isSysadmin || directAccessByComponentId.get(row.id) === AUTHZ_RELATION_CAN_WRITE
          ? 'write'
          : 'read';

      return {
        accessLevel,
        componentKey: row.componentKey,
        description: row.description,
        enabled: row.enabled,
        id: row.id,
        navigationLabel: row.navigationLabel,
        readActions: row.readActions,
        rendererKey: row.rendererKey,
        routePath: row.routePath,
        serviceName: row.serviceName,
        sortOrder: row.sortOrder,
        writeActions: row.writeActions,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const gatewayAccessToken = await signDeviceGatewayAccessToken({
    allowedSelectors: components.flatMap((component) =>
      component.accessLevel === 'write'
        ? [...component.readActions, ...component.writeActions]
        : component.readActions,
    ),
    allowedServiceNames: components.map((component) => component.serviceName),
    deviceId: foundDevice.id,
    userId,
  });

  return {
    canManageUsers,
    components,
    gatewayAccessToken,
  };
};
