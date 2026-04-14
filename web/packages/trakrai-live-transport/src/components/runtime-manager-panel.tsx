'use client';

import { useEffect, useMemo, useState } from 'react';

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

import type {
  ManagedRuntimeService,
  ManagedRuntimeServiceDefinition,
  RuntimeManagerLogPayload,
  RuntimeManagerPaths,
} from '../lib/runtime-manager-types';

type RuntimeManagerPanelProps = Readonly<{
  activeDefinition: ManagedRuntimeServiceDefinition | null;
  error: string | null;
  isBusy: boolean;
  lastLog: RuntimeManagerLogPayload | null;
  lastRefreshedAt: string | null;
  paths: RuntimeManagerPaths | null;
  serviceRegistered: boolean;
  services: ManagedRuntimeService[];
  statusLabel: string;
  onLoadServiceDefinition: (serviceName: string) => void;
  onRefreshLogs: (serviceName: string, lines?: number) => void;
  onRefreshStatus: () => void;
  onRemoveService: (serviceName: string, purgeFiles?: boolean) => void;
  onRunServiceAction: (serviceName: string, action: 'restart-service' | 'start-service' | 'stop-service') => void;
  onUpdateService: (serviceName: string, artifactUrl: string) => void;
  onUpsertServiceDefinition: (definition: ManagedRuntimeServiceDefinition) => void;
}>;

const statusClasses = (state: string): string => {
  switch (state) {
    case 'available':
    case 'running':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
    case 'starting':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
    case 'stopped':
      return 'border-slate-400/30 bg-slate-500/10 text-slate-700';
    case 'missing':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-700';
    default:
      return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
  }
};

const formatNumber = (value: number | undefined, suffix: string): string =>
  value === undefined ? 'N/A' : `${value}${suffix}`;

const formatMemory = (value: number | undefined): string => {
  if (value === undefined) {
    return 'N/A';
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTimestamp = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.trim() === '') {
    return 'Not yet';
  }

  return new Date(value).toLocaleString();
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
      execStart: ['python3', '-m', 'trakrai_service', '--config', '/home/hacklab/trakrai-device-runtime/trakrai-service.json'],
      kind: 'wheel',
      name: 'trakrai-service',
      setupCommand: ['python3', '-m', 'pip', 'install', '--no-deps', '--force-reinstall', '{{artifact_path}}'],
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
    execStart: ['{{install_path}}', '-config', '/home/hacklab/trakrai-device-runtime/new-service.json'],
    kind: 'binary',
    name: 'new-service',
    versionCommand: ['{{install_path}}', '--version'],
  };
};

export const RuntimeManagerPanel = ({
  activeDefinition,
  error,
  isBusy,
  lastLog,
  lastRefreshedAt,
  paths,
  serviceRegistered,
  services,
  statusLabel,
  onLoadServiceDefinition,
  onRefreshLogs,
  onRefreshStatus,
  onRemoveService,
  onRunServiceAction,
  onUpdateService,
  onUpsertServiceDefinition,
}: RuntimeManagerPanelProps) => {
  const [artifactUrls, setArtifactUrls] = useState<Record<string, string>>({});
  const [definitionText, setDefinitionText] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (activeDefinition === null) {
      return;
    }

    setDefinitionText(JSON.stringify(activeDefinition, null, 2));
    setEditorError(null);
  }, [activeDefinition]);

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
      const parsed = JSON.parse(trimmed) as ManagedRuntimeServiceDefinition;
      return parsed;
    } catch {
      return null;
    }
  }, [definitionText]);

  const handleSaveDefinition = () => {
    try {
      const parsed = JSON.parse(definitionText) as ManagedRuntimeServiceDefinition;
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.name !== 'string') {
        setEditorError('Definition must be a JSON object with a string name.');
        return;
      }

      setEditorError(null);
      onUpsertServiceDefinition(parsed);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : 'Invalid JSON');
    }
  };

  const handleRemoveDefinition = () => {
    const nextName = parsedDefinition?.name?.trim() ?? '';
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
              <div className="mt-1 break-all text-xs font-medium">{paths?.binaryDir ?? 'N/A'}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Download dir
              </div>
              <div className="mt-1 break-all text-xs font-medium">{paths?.downloadDir ?? 'N/A'}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Version dir
              </div>
              <div className="mt-1 break-all text-xs font-medium">{paths?.versionDir ?? 'N/A'}</div>
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
            <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-3 border p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Service definition editor</div>
              <div className="text-xs text-slate-500">
                Save a full service definition here to let the controller generate wrapper scripts,
                unit files, and install paths centrally. State file: {paths?.stateFile ?? 'N/A'}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="runtime-manager-definition">Definition JSON</Label>
              <textarea
                className="border bg-background min-h-[280px] w-full resize-y p-3 font-mono text-xs outline-none"
                id="runtime-manager-definition"
                placeholder='{"name":"live-feed","kind":"binary"}'
                value={definitionText}
                onChange={(event) => {
                  setDefinitionText(event.target.value);
                }}
              />
            </div>
            {editorError !== null ? (
              <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {editorError}
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
                disabled={isBusy || (parsedDefinition?.name?.trim() ?? '') === ''}
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
            {services.map((service) => (
              <div key={service.name} className="space-y-3 border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">{service.displayName}</div>
                      {service.core ? (
                        <span className="border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] tracking-[0.18em] text-sky-700 uppercase">
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
                      <div className="mt-1 text-xs text-slate-500">{service.description}</div>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-slate-500">
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
                    <div className="mt-1 text-sm font-medium">{formatMemory(service.memoryBytes)}</div>
                  </div>
                  <div className="border p-3">
                    <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                      PID / elapsed
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      {service.mainPid !== undefined ? service.mainPid : 'N/A'}
                      {service.processElapsed !== undefined ? ` • ${service.processElapsed}` : ''}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                  <div>Install path: {service.installPath ?? 'N/A'}</div>
                  <div>Working dir: {service.workingDirectory ?? 'N/A'}</div>
                  <div>Wrapper: {service.scriptPath ?? 'N/A'}</div>
                  <div>Version file: {service.versionFile ?? 'N/A'}</div>
                </div>

                {service.message !== undefined && service.message !== '' ? (
                  <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
                      onRefreshLogs(service.name, 120);
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
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <Input
                        placeholder="https://... or /path/to/artifact"
                        value={artifactUrls[service.name] ?? ''}
                        onChange={(event) => {
                          setArtifactUrls((currentUrls) => ({
                            ...currentUrls,
                            [service.name]: event.target.value,
                          }));
                        }}
                      />
                      <Button
                        disabled={isBusy || (artifactUrls[service.name] ?? '').trim() === ''}
                        type="button"
                        onClick={() => {
                          onUpdateService(service.name, artifactUrls[service.name] ?? '');
                        }}
                      >
                        Update artifact
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>

          {selectedLogSummary !== null ? (
            <div className="space-y-2 border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Log tail</div>
                <div className="text-xs text-slate-500">{selectedLogSummary.label}</div>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap bg-slate-950 p-3 text-xs text-slate-100">
                {selectedLogSummary.body !== '' ? selectedLogSummary.body : 'No log lines returned.'}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
};
