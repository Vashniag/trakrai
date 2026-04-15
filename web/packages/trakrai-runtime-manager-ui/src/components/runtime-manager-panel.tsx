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

import type { RuntimeManagerState } from '../hooks/use-runtime-manager';
import type { ManagedRuntimeServiceDefinition } from '@trakrai/live-transport/lib/runtime-manager-types';

type RuntimeManagerPanelProps = Readonly<{
  manager: RuntimeManagerState;
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

const BYTES_IN_MEGABYTE = Number('1024') * Number('1024');
const LOG_TAIL_LINE_COUNT = 120;

const formatMemory = (value: number | undefined): string => {
  if (value === undefined) {
    return 'N/A';
  }

  return `${(value / BYTES_IN_MEGABYTE).toFixed(1)} MB`;
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

export const RuntimeManagerPanel = ({ manager }: RuntimeManagerPanelProps) => {
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
    updateService: onUpdateService,
    upsertServiceDefinition: onUpsertServiceDefinition,
  } = manager;
  const [artifactUrls, setArtifactUrls] = useState<Record<string, string>>({});
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
            {services.map((service) => (
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
