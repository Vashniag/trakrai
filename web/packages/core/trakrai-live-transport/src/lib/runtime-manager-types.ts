'use client';

import type {
  RuntimeManager_ManagedServiceDefinition,
  RuntimeManager_ManagedServiceSnapshot,
  RuntimeManager_RuntimeActionPayload,
  RuntimeManager_RuntimeCPUStats,
  RuntimeManager_RuntimeDefinitionPayload,
  RuntimeManager_RuntimeDiskStats,
  RuntimeManager_RuntimeErrorPayload,
  RuntimeManager_RuntimeGPUStats,
  RuntimeManager_RuntimeLoadStats,
  RuntimeManager_RuntimeLogPayload,
  RuntimeManager_RuntimeMemoryStats,
  RuntimeManager_RuntimeNetworkInterfaceStats,
  RuntimeManager_RuntimeNetworkStats,
  RuntimeManager_RuntimeStatusPayload,
  RuntimeManager_RuntimeSystemSnapshot,
} from '../generated-contracts/runtime_manager';

export type ManagedRuntimeService = RuntimeManager_ManagedServiceSnapshot;
export type ManagedRuntimeServiceDefinition = RuntimeManager_ManagedServiceDefinition;
export type RuntimeManagerSystemCPU = RuntimeManager_RuntimeCPUStats;
export type RuntimeManagerSystemLoad = RuntimeManager_RuntimeLoadStats;
export type RuntimeManagerSystemMemory = RuntimeManager_RuntimeMemoryStats;
export type RuntimeManagerSystemDisk = RuntimeManager_RuntimeDiskStats;
export type RuntimeManagerSystemNetworkInterface = RuntimeManager_RuntimeNetworkInterfaceStats;
export type RuntimeManagerSystemNetwork = RuntimeManager_RuntimeNetworkStats;
export type RuntimeManagerSystemGPU = RuntimeManager_RuntimeGPUStats;
export type RuntimeManagerSystemMetrics = RuntimeManager_RuntimeSystemSnapshot;
export type RuntimeManagerStatusPayload = RuntimeManager_RuntimeStatusPayload;
export type RuntimeManagerActionPayload = RuntimeManager_RuntimeActionPayload;
export type RuntimeManagerDefinitionPayload = RuntimeManager_RuntimeDefinitionPayload;
export type RuntimeManagerLogPayload = RuntimeManager_RuntimeLogPayload;
export type RuntimeManagerErrorPayload = RuntimeManager_RuntimeErrorPayload;

export type RuntimeManagerPaths = Pick<
  RuntimeManagerStatusPayload,
  | 'binaryDir'
  | 'configDir'
  | 'downloadDir'
  | 'logDir'
  | 'scriptDir'
  | 'sharedDir'
  | 'stateFile'
  | 'versionDir'
>;
