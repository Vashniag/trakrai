import {
  AUTHZ_RELATION_ADMIN,
  AUTHZ_RELATION_READER,
  AUTHZ_RELATION_VIEWER,
  AUTHZ_RELATION_WRITER,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  parseAuthzObject,
  parseAuthzUserId,
} from './constants';
import { ensureAuthzState, readAllTuples } from './openfga-state';

type ScopedAssignmentsFilterOptions = Readonly<{
  componentIds?: string[];
  departmentIds?: string[];
  deviceIds?: string[];
  factoryIds?: string[];
  userIds?: string[];
}>;

type FactoryAssignmentRow = Readonly<{
  factoryId: string;
  role: 'admin' | 'viewer';
  userId: string;
}>;

type DepartmentAssignmentRow = Readonly<{
  departmentId: string;
  role: 'admin' | 'viewer';
  userId: string;
}>;

type DeviceAssignmentRow = Readonly<{
  deviceId: string;
  role: 'viewer';
  userId: string;
}>;

type ComponentAssignmentRow = Readonly<{
  accessLevel: 'read' | 'write';
  componentId: string;
  userId: string;
}>;

const hasNoRequestedIds = (values: readonly string[] | undefined): boolean => values?.length === 0;

const createOptionalSet = (values: readonly string[] | undefined): ReadonlySet<string> | null =>
  values === undefined ? null : new Set(values);

const shouldInclude = (candidateId: string, filterValues: ReadonlySet<string> | null): boolean =>
  filterValues === null || filterValues.has(candidateId);

export const getScopedAssignments = async (options?: ScopedAssignmentsFilterOptions) => {
  const filters = options ?? {};
  if (
    hasNoRequestedIds(filters.factoryIds) ||
    hasNoRequestedIds(filters.departmentIds) ||
    hasNoRequestedIds(filters.deviceIds) ||
    hasNoRequestedIds(filters.componentIds) ||
    hasNoRequestedIds(filters.userIds)
  ) {
    return {
      componentAssignmentRows: [] as ComponentAssignmentRow[],
      departmentAssignmentRows: [] as DepartmentAssignmentRow[],
      deviceAssignmentRows: [] as DeviceAssignmentRow[],
      factoryAssignmentRows: [] as FactoryAssignmentRow[],
    };
  }

  const factoryIds = createOptionalSet(filters.factoryIds);
  const departmentIds = createOptionalSet(filters.departmentIds);
  const deviceIds = createOptionalSet(filters.deviceIds);
  const componentIds = createOptionalSet(filters.componentIds);
  const userIds = createOptionalSet(filters.userIds);

  const { client } = await ensureAuthzState();
  const tuples = await readAllTuples(client);

  const factoryAssignmentRows: FactoryAssignmentRow[] = [];
  const departmentAssignmentRows: DepartmentAssignmentRow[] = [];
  const deviceAssignmentRows: DeviceAssignmentRow[] = [];
  const componentAssignmentRows: ComponentAssignmentRow[] = [];

  for (const tupleKey of tuples) {
    const parsedUserId = parseAuthzUserId(tupleKey.user);
    if (parsedUserId === null || !shouldInclude(parsedUserId, userIds)) {
      continue;
    }

    const parsedObject = parseAuthzObject(tupleKey.object);
    if (parsedObject === null) {
      continue;
    }

    switch (parsedObject.type) {
      case AUTHZ_TYPE_FACTORY:
        if (
          (tupleKey.relation === AUTHZ_RELATION_ADMIN ||
            tupleKey.relation === AUTHZ_RELATION_VIEWER) &&
          shouldInclude(parsedObject.id, factoryIds)
        ) {
          factoryAssignmentRows.push({
            factoryId: parsedObject.id,
            role: tupleKey.relation === AUTHZ_RELATION_ADMIN ? 'admin' : 'viewer',
            userId: parsedUserId,
          });
        }
        break;
      case AUTHZ_TYPE_DEPARTMENT:
        if (
          (tupleKey.relation === AUTHZ_RELATION_ADMIN ||
            tupleKey.relation === AUTHZ_RELATION_VIEWER) &&
          shouldInclude(parsedObject.id, departmentIds)
        ) {
          departmentAssignmentRows.push({
            departmentId: parsedObject.id,
            role: tupleKey.relation === AUTHZ_RELATION_ADMIN ? 'admin' : 'viewer',
            userId: parsedUserId,
          });
        }
        break;
      case AUTHZ_TYPE_DEVICE:
        if (
          tupleKey.relation === AUTHZ_RELATION_VIEWER &&
          shouldInclude(parsedObject.id, deviceIds)
        ) {
          deviceAssignmentRows.push({
            deviceId: parsedObject.id,
            role: 'viewer',
            userId: parsedUserId,
          });
        }
        break;
      case AUTHZ_TYPE_DEVICE_COMPONENT:
        if (
          (tupleKey.relation === AUTHZ_RELATION_READER ||
            tupleKey.relation === AUTHZ_RELATION_WRITER) &&
          shouldInclude(parsedObject.id, componentIds)
        ) {
          componentAssignmentRows.push({
            accessLevel: tupleKey.relation === AUTHZ_RELATION_WRITER ? 'write' : 'read',
            componentId: parsedObject.id,
            userId: parsedUserId,
          });
        }
        break;
    }
  }

  return {
    componentAssignmentRows,
    departmentAssignmentRows,
    deviceAssignmentRows,
    factoryAssignmentRows,
  };
};
