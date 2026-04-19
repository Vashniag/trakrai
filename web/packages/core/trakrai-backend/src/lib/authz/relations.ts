import {
  AUTHZ_RELATION_CAN_MANAGE_USERS,
  AUTHZ_RELATION_CAN_READ,
  AUTHZ_RELATION_CAN_WRITE,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  createAuthzObject,
  createAuthzUser,
  type AuthzObjectType,
  type AuthzRelation,
} from './constants';
import { ensureAuthzState } from './openfga-state';

export const checkUserObjectRelation = async (
  userId: string,
  relation: AuthzRelation,
  objectType: AuthzObjectType,
  objectId: string,
): Promise<boolean> => {
  const { client } = await ensureAuthzState();
  const response = await client.check({
    object: createAuthzObject(objectType, objectId),
    relation,
    user: createAuthzUser(userId),
  });

  return response.allowed === true;
};

export const listUserAuthorizedObjectIds = async (
  userId: string,
  relation: AuthzRelation,
  objectType: AuthzObjectType,
): Promise<Set<string>> => {
  const { client } = await ensureAuthzState();
  const response = await client.listObjects({
    relation,
    type: objectType,
    user: createAuthzUser(userId),
  });

  return new Set(
    response.objects
      .map((objectName) => objectName.split(':')[1] ?? '')
      .map((objectId) => objectId.trim())
      .filter((objectId) => objectId !== ''),
  );
};

export const getUserManagementScopeIds = async (userId: string) => {
  const [factoryIds, departmentIds, deviceIds, componentIds] = await Promise.all([
    listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_MANAGE_USERS, AUTHZ_TYPE_FACTORY),
    listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_MANAGE_USERS, AUTHZ_TYPE_DEPARTMENT),
    listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_MANAGE_USERS, AUTHZ_TYPE_DEVICE),
    listUserAuthorizedObjectIds(
      userId,
      AUTHZ_RELATION_CAN_MANAGE_USERS,
      AUTHZ_TYPE_DEVICE_COMPONENT,
    ),
  ]);

  return {
    componentIds,
    departmentIds,
    deviceIds,
    factoryIds,
  };
};

export const getReadableDeviceIdsForUser = async (userId: string) =>
  listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_READ, AUTHZ_TYPE_DEVICE);

export const getReadableComponentIdsForUser = async (userId: string) =>
  listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_READ, AUTHZ_TYPE_DEVICE_COMPONENT);

export const getWritableComponentIdsForUser = async (userId: string) =>
  listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_WRITE, AUTHZ_TYPE_DEVICE_COMPONENT);

export const ensureUserCanManageObject = async (
  userId: string,
  objectType: AuthzObjectType,
  objectId: string,
): Promise<void> => {
  const allowed = await checkUserObjectRelation(
    userId,
    AUTHZ_RELATION_CAN_MANAGE_USERS,
    objectType,
    objectId,
  );

  if (!allowed) {
    throw new Error('You do not have permission to manage users in this scope.');
  }
};
