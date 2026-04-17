'use client';

export type ManagedRuntimeService = {
  activeState?: string;
  allowControl: boolean;
  allowUpdate: boolean;
  core: boolean;
  cpuPercent?: number;
  description?: string;
  displayName: string;
  enabled: boolean;
  installPath?: string;
  kind: string;
  loadState?: string;
  logPath?: string;
  mainPid?: number;
  memoryBytes?: number;
  message?: string;
  name: string;
  processElapsed?: string;
  scriptPath?: string;
  state: string;
  subState?: string;
  systemdUnit?: string;
  unitFileState?: string;
  version?: string;
  versionFile?: string;
  versionSource?: string;
  versionUpdatedAt?: string;
  workingDirectory?: string;
};

export type ManagedRuntimeServiceDefinition = {
  after?: string[];
  allowControl: boolean;
  allowUpdate: boolean;
  core: boolean;
  description?: string;
  displayName?: string;
  enabled: boolean;
  environment?: Record<string, string>;
  environmentFiles?: string[];
  execStart?: string[];
  group?: string;
  installPath?: string;
  kind?: string;
  logPath?: string;
  name: string;
  requires?: string[];
  restart?: string;
  restartSec?: number;
  scriptPath?: string;
  setupCommand?: string[];
  systemdUnit?: string;
  user?: string;
  versionCommand?: string[];
  versionFile?: string;
  wantedBy?: string;
  workingDirectory?: string;
};

export type RuntimeManagerSystemCPU = {
  coreCount: number;
  usagePercent?: number;
};

export type RuntimeManagerSystemLoad = {
  fifteenMinute?: number;
  fiveMinute?: number;
  oneMinute?: number;
};

export type RuntimeManagerSystemMemory = {
  availableBytes?: number;
  swapTotalBytes?: number;
  swapUsedBytes?: number;
  totalBytes?: number;
  usedBytes?: number;
  usedPercent?: number;
};

export type RuntimeManagerSystemDisk = {
  freeBytes?: number;
  label: string;
  path: string;
  totalBytes?: number;
  usedBytes?: number;
  usedPercent?: number;
};

export type RuntimeManagerSystemNetworkInterface = {
  name: string;
  rxBytes?: number;
  rxBytesPerSecond?: number;
  txBytes?: number;
  txBytesPerSecond?: number;
};

export type RuntimeManagerSystemNetwork = {
  interfaces?: RuntimeManagerSystemNetworkInterface[];
  rxBytes?: number;
  rxBytesPerSecond?: number;
  txBytes?: number;
  txBytesPerSecond?: number;
};

export type RuntimeManagerSystemGPU = {
  decoderUtilizationPercent?: number;
  encoderUtilizationPercent?: number;
  memoryTotalBytes?: number;
  memoryUsedBytes?: number;
  source: string;
  temperatureCelsius?: number;
  utilizationPercent?: number;
};

export type RuntimeManagerSystemMetrics = {
  collectedAt: string;
  cpu: RuntimeManagerSystemCPU;
  disks?: RuntimeManagerSystemDisk[];
  gpu?: RuntimeManagerSystemGPU;
  load: RuntimeManagerSystemLoad;
  memory: RuntimeManagerSystemMemory;
  network: RuntimeManagerSystemNetwork;
  uptimeSeconds?: number;
};

export type RuntimeManagerStatusPayload = {
  binaryDir: string;
  coreCount: number;
  downloadDir: string;
  generatedAt: string;
  lastAction?: string;
  lastError?: string;
  logDir: string;
  managedCount: number;
  requestId?: string;
  scriptDir: string;
  sharedDir: string;
  services: ManagedRuntimeService[];
  stateFile: string;
  system: RuntimeManagerSystemMetrics;
  versionDir: string;
};

export type RuntimeManagerActionPayload = {
  action: string;
  definition?: ManagedRuntimeServiceDefinition;
  message?: string;
  removed?: boolean;
  requestId?: string;
  service?: ManagedRuntimeService;
  serviceName: string;
};

export type RuntimeManagerDefinitionPayload = {
  definition: ManagedRuntimeServiceDefinition;
  requestId?: string;
  serviceName: string;
};

export type RuntimeManagerLogPayload = {
  lines: string[];
  logPath?: string;
  requestId?: string;
  serviceName: string;
  truncated: boolean;
};

export type RuntimeManagerErrorPayload = {
  action?: string;
  error: string;
  requestId?: string;
  serviceName?: string;
};

export type RuntimeManagerPaths = Pick<
  RuntimeManagerStatusPayload,
  'binaryDir' | 'downloadDir' | 'logDir' | 'scriptDir' | 'sharedDir' | 'stateFile' | 'versionDir'
>;
