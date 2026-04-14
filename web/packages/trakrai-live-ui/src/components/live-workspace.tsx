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

import { CameraInventoryCard } from './camera-inventory-card';
import { DiagnosticsCard } from './diagnostics-card';
import { LiveStreamTileCard } from './live-stream-tile-card';
import { PtzControlPanel } from './ptz-control-panel';
import { VideoPlayer } from './video-player';

import type { PtzVelocityCommand } from '../lib/live-types';

import { useLiveWorkspace } from '../hooks/use-live-workspace';
import {
  DEFAULT_LIVE_DEVICE_ID,
  formatHeartbeatAge,
  formatMetric,
  formatServiceDetails,
  formatUptime,
  getServiceStatusClasses,
  getStatusClasses,
  getStatusLabel,
} from '../lib/live-ui-utils';
import { LiveWorkspaceProvider } from '../providers/live-workspace-provider';

export type LiveWorkspaceProps = Readonly<{
  defaultDeviceId?: string;
  deviceIdEditable?: boolean;
  diagnosticsEnabled?: boolean;
  httpBaseUrl: string;
  signalingUrl: string;
}>;

type LiveWorkspaceBodyProps = Readonly<{
  defaultDeviceId: string;
  deviceId: string;
  deviceIdEditable: boolean;
  onDeviceIdChange: (nextValue: string) => void;
  onToggleDiagnostics: () => void;
  showDiagnostics: boolean;
}>;

const SINGLE_VIEW_MODE_VALUE = 1;
const DUAL_VIEW_MODE_VALUE = 2;
const TRIPLE_VIEW_MODE_VALUE = 3;
const LIVE_VIEW_MODE_VALUES = [
  SINGLE_VIEW_MODE_VALUE,
  DUAL_VIEW_MODE_VALUE,
  TRIPLE_VIEW_MODE_VALUE,
] as const;
type LiveViewMode = (typeof LIVE_VIEW_MODE_VALUES)[number];
const [SINGLE_VIEW_MODE, DUAL_VIEW_MODE, TRIPLE_VIEW_MODE] = LIVE_VIEW_MODE_VALUES;
const COMPARE_SLOT_KEYS = ['compare-slot-a', 'compare-slot-b'] as const;

const LIVE_VIEW_OPTIONS: ReadonlyArray<
  Readonly<{ description: string; label: string; value: LiveViewMode }>
> = [
  { description: 'Single operator stream', label: '1-up', value: SINGLE_VIEW_MODE },
  { description: 'Compare two cameras together', label: '2-up', value: DUAL_VIEW_MODE },
  { description: 'Watch three cameras at once', label: '3-up', value: TRIPLE_VIEW_MODE },
];

const getLiveGridClasses = (tileCount: number): string => {
  if (tileCount <= 1) {
    return 'grid gap-4';
  }

  if (tileCount === 2) {
    return 'grid gap-4 xl:grid-cols-2';
  }

  return 'grid gap-4 xl:grid-cols-2 2xl:grid-cols-3';
};

const getViewModeButtonClasses = (isActive: boolean): string =>
  `flex items-start justify-between gap-3 border px-4 py-3 text-left transition ${
    isActive
      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
      : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50'
  }`;

const renderSelectOptionLabel = (cameraName: string): string =>
  cameraName.trim() === '' ? 'Select camera...' : cameraName;

const LiveWorkspaceBody = ({
  defaultDeviceId,
  deviceId,
  deviceIdEditable,
  onDeviceIdChange,
  onToggleDiagnostics,
  showDiagnostics,
}: LiveWorkspaceBodyProps) => {
  const [selectedCamera, setSelectedCamera] = useState('');
  const [compareCameras, setCompareCameras] = useState<[string, string]>(['', '']);
  const [viewMode, setViewMode] = useState<LiveViewMode>(SINGLE_VIEW_MODE);
  const [activePtzDirection, setActivePtzDirection] = useState<string | null>(null);
  const {
    activeCameraName,
    connectionState,
    deviceStatus,
    heartbeatAgeSeconds,
    stream,
    streamStats,
    startLive,
    stopLive,
    startPtzMove,
    stopPtzMove,
    setPtzZoom,
    goHome,
    ptzState,
    ptzError,
    refreshPtzPosition,
    refreshStatus,
    error,
    logs,
    isBusy,
    transport,
  } = useLiveWorkspace();

  const enabledCameras = useMemo(
    () => (deviceStatus?.cameras ?? []).filter((camera) => camera.enabled),
    [deviceStatus?.cameras],
  );
  const currentCamera =
    selectedCamera.trim() !== '' ? selectedCamera : (enabledCameras[0]?.name ?? '');
  const sanitizedCompareCameras = useMemo<[string, string]>(() => {
    const availableCameraNames = new Set(enabledCameras.map((camera) => camera.name));
    const reservedCameraNames = new Set(currentCamera !== '' ? [currentCamera] : []);

    return compareCameras.map((cameraName) => {
      const normalizedCameraName = cameraName.trim();
      if (
        normalizedCameraName === '' ||
        !availableCameraNames.has(normalizedCameraName) ||
        reservedCameraNames.has(normalizedCameraName)
      ) {
        return '';
      }

      reservedCameraNames.add(normalizedCameraName);
      return normalizedCameraName;
    }) as [string, string];
  }, [compareCameras, currentCamera, enabledCameras]);
  const visibleCompareCameras = sanitizedCompareCameras.slice(
    0,
    Math.max(0, viewMode - SINGLE_VIEW_MODE),
  );
  const activeTileCameraNames = useMemo(() => {
    const uniqueCameras: string[] = [];
    const maybeAddCamera = (cameraName: string) => {
      const normalizedCameraName = cameraName.trim();
      if (normalizedCameraName === '' || uniqueCameras.includes(normalizedCameraName)) {
        return;
      }

      uniqueCameras.push(normalizedCameraName);
    };

    maybeAddCamera(currentCamera);
    for (const cameraName of visibleCompareCameras) {
      maybeAddCamera(cameraName);
    }

    return uniqueCameras;
  }, [currentCamera, visibleCompareCameras]);
  const isPrimaryStreamActive = connectionState === 'starting' || connectionState === 'streaming';
  const isStreaming = connectionState === 'streaming';
  const primaryCameraLabel =
    activeCameraName ?? (currentCamera !== '' ? currentCamera : 'Not selected');
  const serviceStatuses = Object.values(deviceStatus?.services ?? {});
  const statusClasses = getStatusClasses(connectionState);
  const ptzCamera =
    currentCamera !== ''
      ? currentCamera
      : (ptzState?.activeCamera ?? enabledCameras[0]?.name ?? '');
  const ptzServiceStatus = deviceStatus?.services?.['ptz-control'];
  const ptzConfiguredCameras = ptzState?.configuredCameras ?? [];
  const isPtzCameraConfigured =
    ptzCamera !== '' &&
    (ptzConfiguredCameras.length === 0 || ptzConfiguredCameras.includes(ptzCamera));
  const ptzControlsEnabled =
    ptzServiceStatus !== undefined && ptzCamera !== '' && isPtzCameraConfigured;
  const ptzPosition = ptzState?.position?.cameraName === ptzCamera ? ptzState.position : null;
  const ptzCapabilities = ptzPosition?.capabilities ?? ptzState?.capabilities ?? null;
  const ptzStatusLabel = ptzState?.status ?? ptzServiceStatus?.status ?? 'offline';
  const lastPtzCommand = ptzState?.lastCommand ?? 'none';
  const lastPtzMovement =
    ptzPosition?.moveStatus?.panTilt ?? ptzPosition?.moveStatus?.zoom ?? ptzState?.status ?? 'idle';
  const primaryResolutionLabel =
    streamStats?.frameWidth == null || streamStats.frameHeight == null
      ? 'N/A'
      : `${streamStats.frameWidth}x${streamStats.frameHeight}`;

  useEffect(() => {
    if (ptzCamera !== '') {
      refreshPtzPosition(ptzCamera);
    }
  }, [ptzCamera, refreshPtzPosition]);

  useEffect(() => {
    return () => {
      if (activePtzDirection !== null && ptzCamera !== '') {
        stopPtzMove(ptzCamera);
      }
    };
  }, [activePtzDirection, ptzCamera, stopPtzMove]);

  const beginPtzMove = (directionId: string, velocity: PtzVelocityCommand) => {
    if (!ptzControlsEnabled) {
      return;
    }

    startPtzMove(ptzCamera, velocity);
    setActivePtzDirection(directionId);
  };

  const endPtzMove = () => {
    if (ptzCamera === '') {
      return;
    }

    stopPtzMove(ptzCamera);
    setActivePtzDirection(null);
  };

  const getCompareCameraOptions = (slotIndex: number) =>
    enabledCameras.filter((camera) => {
      if (camera.name === sanitizedCompareCameras[slotIndex]) {
        return true;
      }

      if (camera.name === currentCamera) {
        return false;
      }

      return sanitizedCompareCameras.every(
        (selectedCompareCamera, compareIndex) =>
          compareIndex === slotIndex || selectedCompareCamera !== camera.name,
      );
    });

  const updateCompareCamera = (slotIndex: number, nextCameraName: string) => {
    setCompareCameras(
      (currentSelection) =>
        currentSelection.map((cameraName, compareIndex) => {
          if (compareIndex === slotIndex) {
            return nextCameraName;
          }

          return cameraName === nextCameraName ? '' : cameraName;
        }) as [string, string],
    );
  };

  return (
    <div className="flex w-full max-w-7xl flex-col gap-5">
      <section className="grid items-start gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="border bg-neutral-950 text-white">
          <CardHeader className="border-b border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl text-white">Live feeds</CardTitle>
                <CardDescription className="text-white/60">
                  One shared workspace that can watch one, two, or three cameras together while
                  keeping the same cloud and edge transport contract.
                </CardDescription>
              </div>
              <div
                className={`inline-flex items-center gap-2 border px-3 py-1 text-[11px] tracking-[0.22em] uppercase ${statusClasses}`}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
                {getStatusLabel(connectionState)}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={getLiveGridClasses(activeTileCameraNames.length)}>
              <div className="space-y-4 border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                      Primary stream
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">{primaryCameraLabel}</div>
                  </div>
                  <div className="text-right text-[11px] tracking-[0.18em] text-white/45 uppercase">
                    {viewMode}-up layout
                  </div>
                </div>

                <VideoPlayer
                  activeCameraName={activeCameraName}
                  connectionState={connectionState}
                  isActive={isPrimaryStreamActive}
                  stream={stream}
                  streamStats={streamStats}
                />

                {error !== null && error !== '' ? (
                  <div className="border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">FPS</div>
                    <div className="mt-1 text-sm font-medium text-white">
                      {formatMetric(streamStats?.fps, '')}
                    </div>
                  </div>
                  <div className="border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                      Bitrate
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">
                      {formatMetric(streamStats?.bitrateKbps, ' kbps')}
                    </div>
                  </div>
                  <div className="border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                      Resolution
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">
                      {primaryResolutionLabel}
                    </div>
                  </div>
                </div>
              </div>

              {visibleCompareCameras.map((cameraName, index) =>
                cameraName.trim() !== '' ? (
                  <LiveStreamTileCard
                    key={COMPARE_SLOT_KEYS[index]}
                    cameraName={cameraName}
                    deviceId={deviceId}
                    enabled={isPrimaryStreamActive}
                    httpBaseUrl={transport.httpBaseUrl}
                    signalingUrl={transport.signalingUrl}
                    slotLabel={`Comparison slot ${index + 2}`}
                  />
                ) : null,
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                  Primary camera
                </div>
                <div className="mt-1 text-sm font-medium text-white">{primaryCameraLabel}</div>
              </div>
              <div className="border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                  Active tiles
                </div>
                <div className="mt-1 text-sm font-medium text-white">
                  {activeTileCameraNames.length}
                </div>
              </div>
              <div className="border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                  Heartbeat
                </div>
                <div className="mt-1 text-sm font-medium text-white">
                  {formatHeartbeatAge(heartbeatAgeSeconds)}
                </div>
              </div>
              <div className="border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                  Published cameras
                </div>
                <div className="mt-1 text-sm font-medium text-white">{enabledCameras.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <PtzControlPanel
          key={ptzCamera !== '' ? ptzCamera : 'no-ptz-camera'}
          activeDirection={activePtzDirection}
          cameraName={ptzCamera}
          capabilities={ptzCapabilities}
          controlsEnabled={ptzControlsEnabled}
          error={ptzError}
          isCameraConfigured={isPtzCameraConfigured}
          lastCommand={lastPtzCommand}
          lastMovement={lastPtzMovement}
          position={ptzPosition}
          serviceRegistered={ptzServiceStatus !== undefined}
          statusLabel={ptzStatusLabel}
          onBeginMove={beginPtzMove}
          onEndMove={endPtzMove}
          onGoHome={() => {
            goHome(ptzCamera);
          }}
          onRefreshPosition={() => {
            refreshPtzPosition(ptzCamera);
          }}
          onSetZoom={(zoom) => {
            setPtzZoom(ptzCamera, zoom);
          }}
        />
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Controls</CardTitle>
            <CardDescription>
              Select the device, choose the primary camera, and expand the grid to compare two or
              three streams together.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="live-device-id">Device ID</Label>
              <Input
                disabled={!deviceIdEditable}
                id="live-device-id"
                placeholder={defaultDeviceId}
                readOnly={!deviceIdEditable}
                value={deviceId}
                onChange={(event) => {
                  onDeviceIdChange(event.target.value);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="live-camera">Primary camera</Label>
              <select
                className="border-input focus-visible:border-ring h-8 w-full rounded-none border bg-transparent px-2.5 py-1 text-xs transition-colors outline-none"
                disabled={isBusy || enabledCameras.length === 0}
                id="live-camera"
                value={currentCamera}
                onChange={(event) => {
                  setSelectedCamera(event.target.value);
                }}
              >
                <option value="">Select camera...</option>
                {enabledCameras.map((camera) => (
                  <option key={camera.name} value={camera.name}>
                    {camera.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <Label>Live layout</Label>
              <div className="grid gap-3">
                {LIVE_VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={getViewModeButtonClasses(viewMode === option.value)}
                    type="button"
                    onClick={() => {
                      setViewMode(option.value);
                    }}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-slate-500">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {visibleCompareCameras.map((cameraName, index) => (
              <div key={COMPARE_SLOT_KEYS[index]} className="space-y-2">
                <Label htmlFor={COMPARE_SLOT_KEYS[index]}>Comparison slot {index + 2}</Label>
                <select
                  className="border-input focus-visible:border-ring h-8 w-full rounded-none border bg-transparent px-2.5 py-1 text-xs transition-colors outline-none"
                  disabled={isBusy || enabledCameras.length === 0}
                  id={COMPARE_SLOT_KEYS[index]}
                  value={cameraName}
                  onChange={(event) => {
                    updateCompareCamera(index, event.target.value);
                  }}
                >
                  <option value="">{renderSelectOptionLabel('')}</option>
                  {getCompareCameraOptions(index).map((camera) => (
                    <option key={camera.name} value={camera.name}>
                      {renderSelectOptionLabel(camera.name)}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isBusy || currentCamera.trim() === ''}
                type="button"
                onClick={() => {
                  startLive(currentCamera);
                }}
              >
                {isStreaming ? 'Restart live views' : 'Start live views'}
              </Button>
              <Button
                disabled={!isPrimaryStreamActive && activeCameraName === null}
                type="button"
                variant="outline"
                onClick={stopLive}
              >
                Stop live views
              </Button>
              <Button type="button" variant="outline" onClick={refreshStatus}>
                Refresh status
              </Button>
            </div>

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Last heartbeat
                </div>
                <div className="text-sm font-medium">{formatHeartbeatAge(heartbeatAgeSeconds)}</div>
              </div>
              <div className="space-y-1 border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Uptime
                </div>
                <div className="text-sm font-medium">{formatUptime(deviceStatus?.uptime)}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Device services
              </div>
              <div className="space-y-2">
                {serviceStatuses.length > 0 ? (
                  serviceStatuses.map((serviceStatus) => {
                    const details = formatServiceDetails(serviceStatus.details);

                    return (
                      <div
                        key={serviceStatus.service}
                        className="flex items-start justify-between gap-3 border px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{serviceStatus.service}</div>
                          {details !== null ? (
                            <div className="text-muted-foreground mt-1 text-[11px]">{details}</div>
                          ) : null}
                        </div>
                        <span
                          className={`shrink-0 border px-2 py-1 text-[10px] tracking-[0.18em] uppercase ${getServiceStatusClasses(serviceStatus.status)}`}
                        >
                          {serviceStatus.status}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-muted-foreground border px-3 py-2 text-xs">
                    No service status has been published yet.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <CameraInventoryCard
          cameras={enabledCameras}
          currentCamera={currentCamera}
          onSelectCamera={setSelectedCamera}
        />
      </section>

      <section>
        <DiagnosticsCard
          logs={logs}
          showDiagnostics={showDiagnostics}
          streamStats={streamStats}
          onToggle={onToggleDiagnostics}
        />
      </section>
    </div>
  );
};

export const LiveWorkspace = ({
  defaultDeviceId = DEFAULT_LIVE_DEVICE_ID,
  deviceIdEditable = true,
  diagnosticsEnabled = true,
  httpBaseUrl,
  signalingUrl,
}: LiveWorkspaceProps) => {
  const [deviceId, setDeviceId] = useState(defaultDeviceId);
  const [showDiagnostics, setShowDiagnostics] = useState(diagnosticsEnabled);

  useEffect(() => {
    setDeviceId(defaultDeviceId);
  }, [defaultDeviceId]);

  useEffect(() => {
    setShowDiagnostics(diagnosticsEnabled);
  }, [diagnosticsEnabled]);

  return (
    <LiveWorkspaceProvider
      deviceId={deviceId}
      httpBaseUrl={httpBaseUrl}
      signalingUrl={signalingUrl}
    >
      <LiveWorkspaceBody
        defaultDeviceId={defaultDeviceId}
        deviceId={deviceId}
        deviceIdEditable={deviceIdEditable}
        showDiagnostics={showDiagnostics}
        onDeviceIdChange={setDeviceId}
        onToggleDiagnostics={() => {
          setShowDiagnostics((currentValue) => !currentValue);
        }}
      />
    </LiveWorkspaceProvider>
  );
};
