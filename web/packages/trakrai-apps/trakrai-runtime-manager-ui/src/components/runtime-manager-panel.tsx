'use client';

import { useMemo, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { Separator } from '@trakrai/design-system/components/separator';

import type { RuntimeManagerState, UpdateServiceInput } from '../hooks/use-runtime-manager';
import type { ManagedRuntimeServiceDefinition } from '@trakrai/live-transport/lib/runtime-manager-types';

type RuntimeManagerPanelProps = Readonly<{
  manager: RuntimeManagerState;
  packageCatalog?: RuntimeManagerPackageCatalogState;
}>;

export type AvailableRuntimePackageArtifact = Readonly<{
  artifactSha256?: string;
  fileName: string;
  platform: string;
  provider?: string;
  remotePath: string;
  serviceName: string;
  sizeBytes?: number;
  updatedAt?: string;
  version: string;
}>;

export type RuntimeManagerPackageCatalogState = Readonly<{
  artifacts: AvailableRuntimePackageArtifact[];
  error: string | null;
  isLoading: boolean;
}>;

const statusClasses = (state: string): string => {
  switch (state) {
    case 'available':
    case 'running':
      return 'border-primary/40 bg-primary/10 text-primary';
    case 'starting':
      return 'border-accent bg-accent text-accent-foreground';
    case 'stopped':
      return 'border-muted bg-muted text-muted-foreground';
    case 'missing':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-700';
    default:
      return 'border-destructive/30 bg-destructive/10 text-destructive';
  }
};

const formatNumber = (value: number | undefined, suffix: string): string =>
  value === undefined ? 'N/A' : `${value}${suffix}`;

const formatPercent = (value: number | undefined): string =>
  value === undefined ? 'N/A' : `${value.toFixed(1)}%`;

const BYTES_IN_MEGABYTE = Number('1024') * Number('1024');
const BYTES_IN_GIGABYTE = BYTES_IN_MEGABYTE * Number('1024');
const LOG_TAIL_LINE_COUNT = 120;

const formatMemory = (value: number | undefined): string => {
  if (value === undefined) {
    return 'N/A';
  }

  if (value >= BYTES_IN_GIGABYTE) {
    return `${(value / BYTES_IN_GIGABYTE).toFixed(1)} GB`;
  }

  return `${(value / BYTES_IN_MEGABYTE).toFixed(1)} MB`;
};

const formatRate = (value: number | undefined): string => {
  if (value === undefined) {
    return 'N/A';
  }

  if (value >= BYTES_IN_GIGABYTE) {
    return `${(value / BYTES_IN_GIGABYTE).toFixed(2)} GB/s`;
  }
  if (value >= BYTES_IN_MEGABYTE) {
    return `${(value / BYTES_IN_MEGABYTE).toFixed(2)} MB/s`;
  }

  return `${(value / Number('1024')).toFixed(1)} KB/s`;
};

const formatTimestamp = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.trim() === '') {
    return 'Not yet';
  }

  return new Date(value).toLocaleString();
};

const formatUptime = (value: number | undefined): string => {
  if (value === undefined) {
    return 'N/A';
  }

  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / Number('3600'));
  const minutes = Math.floor((totalSeconds % Number('3600')) / Number('60'));
  const seconds = totalSeconds % Number('60');

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const createServiceTemplate = (
  kind: 'binary' | 'wheel' | 'zip',
): ManagedRuntimeServiceDefinition => {
  if (kind === 'wheel') {
    return {
      allowControl: true,
      allowUpdate: true,
      core: false,
      description: 'Python wheel-backed service managed through pip and systemd.',
      displayName: 'New wheel service',
      enabled: true,
      execStart: [
        'python3',
        '-m',
        'trakrai_service',
        '--config',
        '/home/hacklab/trakrai-device-runtime/configs/trakrai-service.json',
      ],
      kind: 'wheel',
      name: 'trakrai-service',
      setupCommand: [
        'python3',
        '-m',
        'pip',
        'install',
        '--no-deps',
        '--force-reinstall',
        '{{artifact_path}}',
      ],
      versionCommand: ['python3', '-m', 'trakrai_service', '--version'],
      workingDirectory: '/home/hacklab/trakrai-device-runtime',
    };
  }

  if (kind === 'zip') {
    return {
      allowControl: false,
      allowUpdate: true,
      core: false,
      description: 'Zip-distributed asset or static bundle unpacked to a target directory.',
      displayName: 'New zip asset',
      enabled: false,
      installPath: '/home/hacklab/trakrai-device-runtime/ui',
      kind: 'zip',
      name: 'edge-ui',
    };
  }

  return {
    allowControl: true,
    allowUpdate: true,
    core: false,
    description: 'Binary service managed by controller-generated systemd units.',
    displayName: 'New binary service',
    enabled: true,
    execStart: [
      '{{install_path}}',
      '-config',
      '/home/hacklab/trakrai-device-runtime/configs/new-service.json',
    ],
    kind: 'binary',
    name: 'new-service',
    versionCommand: ['{{install_path}}', '--version'],
  };
};

export const RuntimeManagerPanel = ({ manager, packageCatalog }: RuntimeManagerPanelProps) => {
  const {
    activeDefinition,
    error,
    isBusy,
    lastLog,
    lastRefreshedAt,
    loadServiceDefinition: onLoadServiceDefinition,
    paths,
    refreshLogs: onRefreshLogs,
    refreshStatus: onRefreshStatus,
    removeService: onRemoveService,
    runServiceAction: onRunServiceAction,
    serviceRegistered,
    services,
    statusLabel,
    systemMetrics,
    updateService: onUpdateService,
    upsertServiceDefinition: onUpsertServiceDefinition,
  } = manager;
  const [updateInputs, setUpdateInputs] = useState<Record<string, UpdateServiceInput>>({});
  const [definitionDraft, setDefinitionDraft] = useState<{
    sourceKey: string;
    text: string;
  } | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const activeDefinitionText = useMemo(
    () => (activeDefinition === null ? '' : JSON.stringify(activeDefinition, null, 2)),
    [activeDefinition],
  );
  const activeDefinitionKey = useMemo(
    () => (activeDefinition === null ? '' : JSON.stringify(activeDefinition)),
    [activeDefinition],
  );
  const definitionText =
    definitionDraft?.sourceKey === activeDefinitionKey
      ? definitionDraft.text
      : activeDefinitionText;
  const visibleEditorError =
    definitionDraft?.sourceKey === activeDefinitionKey ? editorError : null;
  const setDefinitionText = (nextText: string) => {
    setDefinitionDraft({
      sourceKey: activeDefinitionKey,
      text: nextText,
    });
  };

  const selectedLogSummary = useMemo(() => {
    if (lastLog === null) {
      return null;
    }

    return {
      body: lastLog.lines.join('\n'),
      label: `${lastLog.serviceName}${lastLog.truncated ? ' (tail)' : ''}`,
    };
  }, [lastLog]);

  const parsedDefinition = useMemo(() => {
    const trimmed = definitionText.trim();
    if (trimmed === '') {
      return null;
    }

    try {
      return JSON.parse(trimmed) as ManagedRuntimeServiceDefinition;
    } catch {
      return null;
    }
  }, [definitionText]);

  const handleSaveDefinition = () => {
    try {
      const parsed = JSON.parse(definitionText) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('name' in parsed) ||
        typeof parsed.name !== 'string'
      ) {
        setEditorError('Definition must be a JSON object with a string name.');
        return;
      }

      setEditorError(null);
      onUpsertServiceDefinition(parsed as ManagedRuntimeServiceDefinition);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : 'Invalid JSON');
    }
  };

  const handleRemoveDefinition = () => {
    const nextName = parsedDefinition?.name.trim() ?? '';
    if (nextName === '') {
      setEditorError('Load or enter a definition with a service name before removing it.');
      return;
    }

    setEditorError(null);
    onRemoveService(nextName, false);
  };

  return (
    <section>
      <Card className="border">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Runtime manager</CardTitle>
              <CardDescription>
                Define services remotely, generate systemd units and wrapper scripts, install
                binaries or wheels, and unpack zip assets from the edge console.
              </CardDescription>
            </div>
            <div
              className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] tracking-[0.2em] uppercase ${statusClasses(statusLabel)}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {statusLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Manager service
              </div>
              <div className="mt-1 text-sm font-medium">
                {serviceRegistered ? 'Registered' : 'Not registered'}
              </div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Managed items
              </div>
              <div className="mt-1 text-sm font-medium">{services.length}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Last refresh
              </div>
              <div className="mt-1 text-sm font-medium">{formatTimestamp(lastRefreshedAt)}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Binary dir
              </div>
              <div className="mt-1 text-xs font-medium break-all">{paths?.binaryDir ?? 'N/A'}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Download dir
              </div>
              <div className="mt-1 text-xs font-medium break-all">
                {paths?.downloadDir ?? 'N/A'}
              </div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Version dir
              </div>
              <div className="mt-1 text-xs font-medium break-all">{paths?.versionDir ?? 'N/A'}</div>
            </div>
          </div>

          <div className="space-y-4 border p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Device resource snapshot</div>
              <div className="text-muted-foreground text-xs">
                Host-level metrics collected by runtime-manager from the device or emulator. Refresh
                runs automatically every few seconds while this panel stays connected.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  CPU usage
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatPercent(systemMetrics?.cpu.usagePercent)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {formatNumber(systemMetrics?.cpu.coreCount, ' cores')}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Load average
                </div>
                <div className="mt-1 text-sm font-medium">
                  {systemMetrics?.load.oneMinute?.toFixed(2) ?? 'N/A'}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {`5m ${systemMetrics?.load.fiveMinute?.toFixed(2) ?? 'N/A'} • 15m ${
                    systemMetrics?.load.fifteenMinute?.toFixed(2) ?? 'N/A'
                  }`}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Memory
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatMemory(systemMetrics?.memory.usedBytes)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {`${formatPercent(systemMetrics?.memory.usedPercent)} of ${formatMemory(
                    systemMetrics?.memory.totalBytes,
                  )}`}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Disk
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatMemory(systemMetrics?.disks?.[0]?.usedBytes)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {`${formatPercent(systemMetrics?.disks?.[0]?.usedPercent)} of ${formatMemory(
                    systemMetrics?.disks?.[0]?.totalBytes,
                  )}`}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Network
                </div>
                <div className="mt-1 text-sm font-medium">
                  {`${formatRate(systemMetrics?.network.rxBytesPerSecond)} down`}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {`${formatRate(systemMetrics?.network.txBytesPerSecond)} up`}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  GPU / uptime
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatPercent(systemMetrics?.gpu?.utilizationPercent)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {`temp ${
                    systemMetrics?.gpu?.temperatureCelsius?.toFixed(1) ?? 'N/A'
                  }C • up ${formatUptime(systemMetrics?.uptimeSeconds)}`}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-3 border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Disk usage</div>
                  <div className="text-muted-foreground text-xs">
                    {formatTimestamp(systemMetrics?.collectedAt)}
                  </div>
                </div>
                <div className="space-y-2">
                  {(systemMetrics?.disks ?? []).map((disk) => (
                    <div key={disk.label} className="border p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{disk.label}</div>
                        <div>{formatPercent(disk.usedPercent)}</div>
                      </div>
                      <div className="text-muted-foreground mt-1 break-all">{disk.path}</div>
                      <div className="mt-2">
                        {`${formatMemory(disk.usedBytes)} used • ${formatMemory(
                          disk.freeBytes,
                        )} free • ${formatMemory(disk.totalBytes)} total`}
                      </div>
                    </div>
                  ))}
                  {(systemMetrics?.disks ?? []).length === 0 ? (
                    <div className="text-muted-foreground border border-dashed px-3 py-2 text-xs">
                      Disk metrics are not available yet.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3 border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Network interfaces</div>
                  <div className="text-muted-foreground text-xs">
                    {`${formatMemory(systemMetrics?.network.rxBytes)} received • ${formatMemory(
                      systemMetrics?.network.txBytes,
                    )} sent`}
                  </div>
                </div>
                <div className="space-y-2">
                  {(systemMetrics?.network.interfaces ?? []).map((networkInterface) => (
                    <div key={networkInterface.name} className="border p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{networkInterface.name}</div>
                        <div className="text-muted-foreground">
                          {`${formatRate(networkInterface.rxBytesPerSecond)} down • ${formatRate(
                            networkInterface.txBytesPerSecond,
                          )} up`}
                        </div>
                      </div>
                      <div className="mt-2">
                        {`${formatMemory(networkInterface.rxBytes)} received • ${formatMemory(
                          networkInterface.txBytes,
                        )} sent`}
                      </div>
                    </div>
                  ))}
                  {(systemMetrics?.network.interfaces ?? []).length === 0 ? (
                    <div className="text-muted-foreground border border-dashed px-3 py-2 text-xs">
                      Network metrics are not available yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  GPU source
                </div>
                <div className="mt-1 text-sm font-medium">
                  {systemMetrics?.gpu?.source ?? 'Not detected'}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  GPU encoder
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatPercent(systemMetrics?.gpu?.encoderUtilizationPercent)}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  GPU decoder
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatPercent(systemMetrics?.gpu?.decoderUtilizationPercent)}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Swap
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatMemory(systemMetrics?.memory.swapUsedBytes)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {`of ${formatMemory(systemMetrics?.memory.swapTotalBytes)}`}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={isBusy} type="button" variant="outline" onClick={onRefreshStatus}>
              Refresh status
            </Button>
            <Button
              disabled={isBusy}
              type="button"
              variant="outline"
              onClick={() => {
                setDefinitionText(JSON.stringify(createServiceTemplate('binary'), null, 2));
                setEditorError(null);
              }}
            >
              New binary template
            </Button>
            <Button
              disabled={isBusy}
              type="button"
              variant="outline"
              onClick={() => {
                setDefinitionText(JSON.stringify(createServiceTemplate('wheel'), null, 2));
                setEditorError(null);
              }}
            >
              New wheel template
            </Button>
            <Button
              disabled={isBusy}
              type="button"
              variant="outline"
              onClick={() => {
                setDefinitionText(JSON.stringify(createServiceTemplate('zip'), null, 2));
                setEditorError(null);
              }}
            >
              New zip template
            </Button>
          </div>

          {!serviceRegistered ? (
            <div className="text-muted-foreground border border-dashed px-4 py-3 text-sm">
              Runtime manager has not registered over the shared comm layer yet.
            </div>
          ) : null}

          {error !== null && error !== '' ? (
            <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
              {error}
            </div>
          ) : null}

          <div className="space-y-3 border p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Service definition editor</div>
              <div className="text-muted-foreground text-xs">
                Save a full service definition here to let the controller generate wrapper scripts,
                unit files, and install paths centrally. State file: {paths?.stateFile ?? 'N/A'}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="runtime-manager-definition">Definition JSON</Label>
              <textarea
                className="bg-background min-h-[280px] w-full resize-y border p-3 font-mono text-xs outline-none"
                id="runtime-manager-definition"
                placeholder='{"name":"live-feed","kind":"binary"}'
                value={definitionText}
                onChange={(event) => {
                  setDefinitionText(event.target.value);
                }}
              />
            </div>
            {visibleEditorError !== null ? (
              <div className="bg-accent text-accent-foreground border px-3 py-2 text-xs">
                {visibleEditorError}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isBusy || definitionText.trim() === ''}
                type="button"
                onClick={handleSaveDefinition}
              >
                Save definition
              </Button>
              <Button
                disabled={isBusy || (parsedDefinition?.name.trim() ?? '') === ''}
                type="button"
                variant="outline"
                onClick={handleRemoveDefinition}
              >
                Remove service
              </Button>
              <Button
                disabled={isBusy}
                type="button"
                variant="outline"
                onClick={() => {
                  setDefinitionText('');
                  setEditorError(null);
                }}
              >
                Clear editor
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {services.map((service) => {
              const serviceArtifacts =
                packageCatalog?.artifacts.filter(
                  (artifact) => artifact.serviceName === service.name,
                ) ?? [];
              let packagePlaceholder = 'No published artifacts available';
              if (packageCatalog?.isLoading === true) {
                packagePlaceholder = 'Loading published artifacts...';
              } else if (serviceArtifacts.length > 0) {
                packagePlaceholder = 'Select a published artifact';
              }

              return (
                <div key={service.name} className="space-y-3 border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">{service.displayName}</div>
                        {service.core ? (
                          <span className="border-secondary/50 bg-secondary text-secondary-foreground border px-2 py-1 text-[10px] tracking-[0.18em] uppercase">
                            Core
                          </span>
                        ) : null}
                        <span
                          className={`border px-2 py-1 text-[10px] tracking-[0.18em] uppercase ${statusClasses(service.state)}`}
                        >
                          {service.state}
                        </span>
                      </div>
                      {service.description !== undefined && service.description !== '' ? (
                        <div className="text-muted-foreground mt-1 text-xs">
                          {service.description}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-right text-xs">
                      <div>{service.kind}</div>
                      {service.systemdUnit !== undefined && service.systemdUnit !== '' ? (
                        <div className="mt-1">{service.systemdUnit}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="border p-3">
                      <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                        Version
                      </div>
                      <div className="mt-1 text-sm font-medium">{service.version ?? 'Unknown'}</div>
                    </div>
                    <div className="border p-3">
                      <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                        CPU
                      </div>
                      <div className="mt-1 text-sm font-medium">
                        {formatNumber(service.cpuPercent, '%')}
                      </div>
                    </div>
                    <div className="border p-3">
                      <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                        Memory
                      </div>
                      <div className="mt-1 text-sm font-medium">
                        {formatMemory(service.memoryBytes)}
                      </div>
                    </div>
                    <div className="border p-3">
                      <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                        PID / elapsed
                      </div>
                      <div className="mt-1 text-sm font-medium">
                        {service.mainPid ?? 'N/A'}
                        {service.processElapsed !== undefined ? ` • ${service.processElapsed}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="text-muted-foreground grid gap-2 text-xs md:grid-cols-2">
                    <div>Install path: {service.installPath ?? 'N/A'}</div>
                    <div>Working dir: {service.workingDirectory ?? 'N/A'}</div>
                    <div>Wrapper: {service.scriptPath ?? 'N/A'}</div>
                    <div>Version file: {service.versionFile ?? 'N/A'}</div>
                  </div>

                  {service.message !== undefined && service.message !== '' ? (
                    <div className="bg-accent text-accent-foreground border px-3 py-2 text-xs">
                      {service.message}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!service.allowControl || isBusy}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        onRunServiceAction(service.name, 'start-service');
                      }}
                    >
                      Start
                    </Button>
                    <Button
                      disabled={!service.allowControl || isBusy}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        onRunServiceAction(service.name, 'stop-service');
                      }}
                    >
                      Stop
                    </Button>
                    <Button
                      disabled={!service.allowControl || isBusy}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        onRunServiceAction(service.name, 'restart-service');
                      }}
                    >
                      Restart
                    </Button>
                    <Button
                      disabled={isBusy || service.logPath === undefined || service.logPath === ''}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        onRefreshLogs(service.name, LOG_TAIL_LINE_COUNT);
                      }}
                    >
                      Tail logs
                    </Button>
                    <Button
                      disabled={isBusy}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        onLoadServiceDefinition(service.name);
                      }}
                    >
                      Edit definition
                    </Button>
                  </div>

                  {service.allowUpdate ? (
                    <>
                      <Separator />
                      <div className="grid gap-3">
                        {packageCatalog !== undefined ? (
                          <div className="space-y-2">
                            <Label htmlFor={`${service.name}-package-artifact`}>
                              Published artifact
                            </Label>
                            <select
                              className="bg-background w-full border px-3 py-2 text-sm"
                              id={`${service.name}-package-artifact`}
                              value={updateInputs[service.name]?.remotePath ?? ''}
                              onChange={(event) => {
                                const selectedArtifact = serviceArtifacts.find(
                                  (artifact) => artifact.remotePath === event.target.value,
                                );
                                setUpdateInputs((currentInputs) => ({
                                  ...currentInputs,
                                  [service.name]: {
                                    ...currentInputs[service.name],
                                    artifactSha256: selectedArtifact?.artifactSha256 ?? '',
                                    remotePath: event.target.value,
                                  },
                                }));
                              }}
                            >
                              <option value="">{packagePlaceholder}</option>
                              {serviceArtifacts.map((artifact) => (
                                <option key={artifact.remotePath} value={artifact.remotePath}>
                                  {`${artifact.version} • ${artifact.platform} • ${artifact.fileName}`}
                                </option>
                              ))}
                            </select>
                            {packageCatalog.error !== null && packageCatalog.error !== '' ? (
                              <div className="bg-accent text-accent-foreground border px-3 py-2 text-xs">
                                {packageCatalog.error}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <Input
                          placeholder="package remote path override, for example cloud-comm/0.1.2/linux-arm64/cloud-comm-linux-arm64-v0.1.2"
                          value={updateInputs[service.name]?.remotePath ?? ''}
                          onChange={(event) => {
                            setUpdateInputs((currentInputs) => ({
                              ...currentInputs,
                              [service.name]: {
                                ...currentInputs[service.name],
                                remotePath: event.target.value,
                              },
                            }));
                          }}
                        />
                        <Input
                          placeholder="optional artifact sha256"
                          value={updateInputs[service.name]?.artifactSha256 ?? ''}
                          onChange={(event) => {
                            setUpdateInputs((currentInputs) => ({
                              ...currentInputs,
                              [service.name]: {
                                ...currentInputs[service.name],
                                artifactSha256: event.target.value,
                              },
                            }));
                          }}
                        />
                        <Button
                          disabled={
                            isBusy || (updateInputs[service.name]?.remotePath ?? '').trim() === ''
                          }
                          type="button"
                          onClick={() => {
                            onUpdateService(service.name, updateInputs[service.name] ?? {});
                          }}
                        >
                          Update package
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>

          {selectedLogSummary !== null ? (
            <div className="space-y-2 border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Log tail</div>
                <div className="text-muted-foreground text-xs">{selectedLogSummary.label}</div>
              </div>
              <pre className="bg-muted max-h-72 overflow-auto p-3 text-xs whitespace-pre-wrap">
                {selectedLogSummary.body !== ''
                  ? selectedLogSummary.body
                  : 'No log lines returned.'}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
};
