import { readFileSync } from 'node:fs';
import path from 'node:path';

const SERVICES_MANIFEST_PATH = ['device', 'manifests', 'services.json'] as const;
const SERVICE_METHODS_MANIFEST_PATH = ['device', 'manifests', 'service-methods.json'] as const;

type CloudAppPermissionsManifest = Readonly<{
  read?: string[];
  write?: string[];
}>;

type CloudAppManifest = Readonly<{
  navigationLabel?: string;
  permissions?: CloudAppPermissionsManifest;
  rendererKey?: string | null;
  routePath?: string | null;
  sortOrder?: number;
}>;

type ServiceManifest = Readonly<{
  description?: string;
  displayName?: string;
  local?: Readonly<{
    defaultEnabled?: boolean;
  }>;
  name: string;
  cloudApp?: CloudAppManifest;
}>;

type ServicesManifestPayload = Readonly<{
  services?: ServiceManifest[];
}>;

type ServiceMethodManifest = Readonly<{
  name: string;
}>;

type ServiceMethodsManifest = Readonly<{
  methods?: ServiceMethodManifest[];
  name: string;
}>;

type ServiceMethodsManifestPayload = Readonly<{
  services?: ServiceMethodsManifest[];
}>;

export type DeviceComponentManifestEntry = Readonly<{
  defaultEnabled: boolean;
  description: string | null;
  displayName: string;
  key: string;
  navigationLabel: string;
  readActions: string[];
  rendererKey: string | null;
  routePath: string | null;
  serviceName: string;
  sortOrder: number;
  writeActions: string[];
}>;

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? null : normalized;
};

const normalizeMethodNameList = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value !== '')));

const readJsonFile = <TPayload>(repoRoot: string, pathSegments: readonly string[]): TPayload =>
  JSON.parse(readFileSync(path.join(repoRoot, ...pathSegments), 'utf8')) as TPayload;

const isReadOnlyMethodName = (methodName: string): boolean =>
  methodName.startsWith('get-') || methodName.startsWith('list-');

const validatePermissionAssignments = (
  serviceName: string,
  availableMethodNames: readonly string[],
  readActions: readonly string[],
  writeActions: readonly string[],
) => {
  const availableMethodNameSet = new Set(availableMethodNames);

  const unknownActions = [...readActions, ...writeActions].filter(
    (methodName) => !availableMethodNameSet.has(methodName),
  );
  if (unknownActions.length > 0) {
    throw new Error(
      `Unknown cloud app permission methods for ${serviceName}: ${unknownActions.join(', ')}`,
    );
  }

  const overlappingActions = readActions.filter((methodName) => writeActions.includes(methodName));
  if (overlappingActions.length > 0) {
    throw new Error(
      `Cloud app methods assigned to both read and write for ${serviceName}: ${overlappingActions.join(', ')}`,
    );
  }
};

const buildPermissionAssignments = (
  serviceName: string,
  availableMethodNames: readonly string[],
  permissions: CloudAppPermissionsManifest | undefined,
) => {
  const configuredReadActions = normalizeMethodNameList(permissions?.read ?? []);
  const configuredWriteActions = normalizeMethodNameList(permissions?.write ?? []);

  validatePermissionAssignments(
    serviceName,
    availableMethodNames,
    configuredReadActions,
    configuredWriteActions,
  );

  const assignedMethodNames = new Set([...configuredReadActions, ...configuredWriteActions]);
  const readActions = new Set(configuredReadActions);
  const writeActions = new Set(configuredWriteActions);

  for (const methodName of availableMethodNames) {
    if (assignedMethodNames.has(methodName)) {
      continue;
    }

    if (isReadOnlyMethodName(methodName)) {
      readActions.add(methodName);
      continue;
    }

    writeActions.add(methodName);
  }

  return {
    readActions: availableMethodNames.filter((methodName) => readActions.has(methodName)),
    writeActions: availableMethodNames.filter((methodName) => writeActions.has(methodName)),
  };
};

export const loadDeviceComponentManifestEntries = (
  repoRoot: string,
): DeviceComponentManifestEntry[] => {
  const servicesPayload = readJsonFile<ServicesManifestPayload>(repoRoot, SERVICES_MANIFEST_PATH);
  const serviceMethodsPayload = readJsonFile<ServiceMethodsManifestPayload>(
    repoRoot,
    SERVICE_METHODS_MANIFEST_PATH,
  );

  const services = servicesPayload.services ?? [];
  const servicesByName = new Map(
    services.map((service, index) => [service.name, [service, index] as const]),
  );

  return (serviceMethodsPayload.services ?? []).map((serviceMethods, methodIndex) => {
    const matchedService = servicesByName.get(serviceMethods.name);
    if (matchedService === undefined) {
      throw new Error(`Missing service manifest entry for ${serviceMethods.name}.`);
    }

    const [service, serviceIndex] = matchedService;
    const methodNames = normalizeMethodNameList(
      (serviceMethods.methods ?? []).map((method) => method.name),
    );
    const { cloudApp } = service;
    const displayName = normalizeOptionalString(service.displayName) ?? service.name;
    const navigationLabel = normalizeOptionalString(cloudApp?.navigationLabel) ?? displayName;
    const { readActions, writeActions } = buildPermissionAssignments(
      service.name,
      methodNames,
      cloudApp?.permissions,
    );

    return {
      defaultEnabled: service.local?.defaultEnabled ?? false,
      description: normalizeOptionalString(service.description),
      displayName,
      key: service.name,
      navigationLabel,
      readActions,
      rendererKey: normalizeOptionalString(cloudApp?.rendererKey),
      routePath: normalizeOptionalString(cloudApp?.routePath),
      serviceName: service.name,
      sortOrder:
        typeof cloudApp?.sortOrder === 'number' && Number.isFinite(cloudApp.sortOrder)
          ? cloudApp.sortOrder
          : serviceIndex + methodIndex,
      writeActions,
    } satisfies DeviceComponentManifestEntry;
  });
};
