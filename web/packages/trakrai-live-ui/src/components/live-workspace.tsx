'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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
import { PtzControlPanel } from './ptz-control-panel';
import { VideoPlayer } from './video-player';

import type {
  DeviceCamera,
  LiveLayoutMode,
  LiveLayoutSelection,
  PtzVelocityCommand,
} from '../lib/live-types';

import { useLiveWorkspace } from '../hooks/use-live-workspace';
import {
  LIVE_LAYOUT_OPTIONS,
  clampLiveLayoutStartIndex,
  getLiveLayoutCapacity,
  getLiveLayoutPageCount,
  getLiveLayoutPageLabel,
  getVisibleLayoutCameras,
} from '../lib/live-layout-utils';
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
  iceTransportPolicy?: RTCIceTransportPolicy;
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

const GRID_LAYOUT_SMALL = 2;
const GRID_LAYOUT_MEDIUM = 3;
const GRID_LAYOUT_LARGE = 4;
const FOCUS_LAYOUT_SECONDARY_TILE_IDS = [
  'focus-b',
  'focus-c',
  'focus-d',
  'focus-e',
  'focus-f',
  'focus-g',
  'focus-h',
] as const;

const getLayoutButtonClasses = (isActive: boolean): string =>
  `flex min-h-28 flex-col justify-between border p-4 text-left transition ${
    isActive
      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
      : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50'
  }`;

const getCameraChipClasses = (isActive: boolean): string =>
  `border px-3 py-2 text-left text-xs transition ${
    isActive
      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
      : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50'
  }`;

const LayoutGlyph = ({ mode }: Readonly<{ mode: LiveLayoutMode }>) => {
  if (mode === 'single') {
    return <div className="h-10 w-full border border-current/40 bg-current/10" />;
  }

  if (mode === 'focus-8') {
    return (
      <div className="grid h-10 grid-cols-[1.6fr_1fr] gap-1">
        <div className="border border-current/40 bg-current/10" />
        <div className="grid grid-cols-2 grid-rows-4 gap-1">
          {FOCUS_LAYOUT_SECONDARY_TILE_IDS.map((tileId) => (
            <div key={tileId} className="border border-current/35 bg-current/10" />
          ))}
          <div className="border border-dashed border-current/25 bg-transparent" />
        </div>
      </div>
    );
  }

  let gridSize = GRID_LAYOUT_LARGE;
  if (mode === 'grid-4') {
    gridSize = GRID_LAYOUT_SMALL;
  } else if (mode === 'grid-9') {
    gridSize = GRID_LAYOUT_MEDIUM;
  }
  const tileIds = Array.from(
    { length: gridSize * gridSize },
    (_, tileIndex) => `${mode}-tile-${tileIndex + 1}`,
  );
  return (
    <div
      className="grid h-10 gap-1"
      style={{
        gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
      }}
    >
      {tileIds.map((tileId) => (
        <div key={tileId} className="border border-current/35 bg-current/10" />
      ))}
    </div>
  );
};

const reorderVisibleCameras = (
  visibleCameras: readonly DeviceCamera[],
  selectedCamera: string,
): DeviceCamera[] => {
  if (selectedCamera.trim() === '') {
    return [...visibleCameras];
  }

  const selectedIndex = visibleCameras.findIndex((camera) => camera.name === selectedCamera);
  if (selectedIndex <= 0) {
    return [...visibleCameras];
  }

  const nextVisible = [...visibleCameras];
  const [selected] = nextVisible.splice(selectedIndex, 1);
  if (selected === undefined) {
    return nextVisible;
  }
  nextVisible.unshift(selected);
  return nextVisible;
};

const getPageStartForCamera = (
  cameraName: string,
  cameras: readonly DeviceCamera[],
  mode: LiveLayoutMode,
): number => {
  const selectedIndex = cameras.findIndex((camera) => camera.name === cameraName);
  if (selectedIndex < 0) {
    return 0;
  }

  const capacity = getLiveLayoutCapacity(mode);
  return clampLiveLayoutStartIndex(
    Math.floor(selectedIndex / capacity) * capacity,
    cameras.length,
    mode,
  );
};

const LiveWorkspaceBody = ({
  defaultDeviceId,
  deviceId,
  deviceIdEditable,
  onDeviceIdChange,
  onToggleDiagnostics,
  showDiagnostics,
}: LiveWorkspaceBodyProps) => {
  const [selectedCamera, setSelectedCamera] = useState('');
  const [layoutMode, setLayoutMode] = useState<LiveLayoutMode>('single');
  const [layoutStartIndex, setLayoutStartIndex] = useState(0);
  const [activePtzDirection, setActivePtzDirection] = useState<string | null>(null);
  const lastAppliedSelectionRef = useRef<string | null>(null);

  const {
    activeCameraName,
    connectionState,
    deviceStatus,
    heartbeatAgeSeconds,
    stream,
    streamStats,
    startLive,
    stopLive,
    updateLiveLayout,
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
  const enabledCameraNames = useMemo(
    () => enabledCameras.map((camera) => camera.name),
    [enabledCameras],
  );
  const selectedCameraName =
    selectedCamera.trim() !== '' && enabledCameraNames.includes(selectedCamera)
      ? selectedCamera
      : (enabledCameras[0]?.name ?? '');
  const baseLayoutStartIndex = clampLiveLayoutStartIndex(
    layoutStartIndex,
    enabledCameras.length,
    layoutMode,
  );
  const baseVisibleCameras = useMemo(
    () => getVisibleLayoutCameras(enabledCameras, baseLayoutStartIndex, layoutMode),
    [baseLayoutStartIndex, enabledCameras, layoutMode],
  );
  const safeLayoutStartIndex =
    selectedCameraName !== '' &&
    !baseVisibleCameras.some((camera) => camera.name === selectedCameraName)
      ? getPageStartForCamera(selectedCameraName, enabledCameras, layoutMode)
      : baseLayoutStartIndex;
  const pageCameras = useMemo(
    () => getVisibleLayoutCameras(enabledCameras, safeLayoutStartIndex, layoutMode),
    [enabledCameras, layoutMode, safeLayoutStartIndex],
  );
  const visibleCameras = useMemo(
    () => reorderVisibleCameras(pageCameras, selectedCameraName),
    [pageCameras, selectedCameraName],
  );
  const layoutSelection = useMemo<LiveLayoutSelection>(
    () => ({
      cameraNames: visibleCameras.map((camera) => camera.name),
      mode: layoutMode,
    }),
    [layoutMode, visibleCameras],
  );
  const layoutSelectionKey = useMemo(() => JSON.stringify(layoutSelection), [layoutSelection]);
  const isStreamSessionActive = connectionState === 'starting' || connectionState === 'streaming';
  const primaryCameraLabel =
    activeCameraName ?? layoutSelection.cameraNames[0] ?? 'No camera selected';
  const visibleCameraNamesLabel =
    layoutSelection.cameraNames.length > 0 ? layoutSelection.cameraNames.join(', ') : 'No cameras';
  const statusClasses = getStatusClasses(connectionState);
  const serviceStatuses = Object.values(deviceStatus?.services ?? {});
  const pageLabel = getLiveLayoutPageLabel(
    pageCameras,
    enabledCameras.length,
    safeLayoutStartIndex,
    layoutMode,
  );
  const pageCount = getLiveLayoutPageCount(enabledCameras.length, layoutMode);
  const activePageNumber =
    layoutSelection.cameraNames.length === 0
      ? 1
      : Math.floor(safeLayoutStartIndex / getLiveLayoutCapacity(layoutMode)) + 1;
  const ptzCamera =
    selectedCameraName !== ''
      ? selectedCameraName
      : (layoutSelection.cameraNames[0] ?? ptzState?.activeCamera ?? '');
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
  const canPageBackward = safeLayoutStartIndex > 0;
  const canPageForward =
    safeLayoutStartIndex + getLiveLayoutCapacity(layoutMode) < enabledCameras.length;

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

  useEffect(() => {
    if (!isStreamSessionActive || layoutSelection.cameraNames.length === 0) {
      if (!isStreamSessionActive) {
        lastAppliedSelectionRef.current = null;
      }
      return;
    }

    if (lastAppliedSelectionRef.current === layoutSelectionKey) {
      return;
    }

    lastAppliedSelectionRef.current = layoutSelectionKey;
    updateLiveLayout(layoutSelection);
  }, [isStreamSessionActive, layoutSelection, layoutSelectionKey, updateLiveLayout]);

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

  const handleCameraSelect = (cameraName: string) => {
    setSelectedCamera(cameraName);
    setLayoutStartIndex(getPageStartForCamera(cameraName, enabledCameras, layoutMode));
  };

  const handleLayoutChange = (mode: LiveLayoutMode) => {
    setLayoutMode(mode);
    if (selectedCameraName !== '') {
      setLayoutStartIndex(getPageStartForCamera(selectedCameraName, enabledCameras, mode));
      return;
    }

    setLayoutStartIndex(clampLiveLayoutStartIndex(layoutStartIndex, enabledCameras.length, mode));
  };

  const handlePageShift = (direction: -1 | 1) => {
    const capacity = getLiveLayoutCapacity(layoutMode);
    const nextStartIndex = clampLiveLayoutStartIndex(
      safeLayoutStartIndex + direction * capacity,
      enabledCameras.length,
      layoutMode,
    );
    setLayoutStartIndex(nextStartIndex);

    const nextVisible = getVisibleLayoutCameras(enabledCameras, nextStartIndex, layoutMode);
    const nextPrimaryCamera = nextVisible[0]?.name;
    if (nextPrimaryCamera !== undefined) {
      setSelectedCamera(nextPrimaryCamera);
    }
  };

  return (
    <div className="flex w-full max-w-7xl flex-col gap-5">
      <section className="grid items-start gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="border bg-neutral-950 text-white">
          <CardHeader className="border-b border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl text-white">Live monitor</CardTitle>
                <CardDescription className="text-white/60">
                  One stitched device stream with paging across camera sets for cloud and edge.
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
            <div className="border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                    Active layout
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">
                    {LIVE_LAYOUT_OPTIONS.find((option) => option.mode === layoutMode)
                      ?.description ?? 'Single camera'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                    Showing cameras
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">
                    {visibleCameraNamesLabel}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <VideoPlayer
                  activeCameraName={primaryCameraLabel}
                  connectionState={connectionState}
                  isActive={isStreamSessionActive}
                  stream={stream}
                  streamStats={streamStats}
                />
              </div>

              {error !== null && error !== '' ? (
                <div className="mt-4 border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                    Primary camera
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">{primaryCameraLabel}</div>
                </div>
                <div className="border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                    Camera set
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">{pageLabel}</div>
                </div>
                <div className="border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">FPS</div>
                  <div className="mt-1 text-sm font-medium text-white">
                    {formatMetric(streamStats?.fps, '')}
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

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {LIVE_LAYOUT_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  className={getLayoutButtonClasses(option.mode === layoutMode)}
                  type="button"
                  onClick={() => {
                    handleLayoutChange(option.mode);
                  }}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{option.label}</span>
                      <span className="text-[11px] tracking-[0.2em] uppercase">
                        {option.shortLabel}
                      </span>
                    </div>
                    <LayoutGlyph mode={option.mode} />
                  </div>
                  <span className="mt-3 text-xs text-slate-500">{option.description}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-white/5 p-3">
              <div>
                <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">Paging</div>
                <div className="mt-1 text-sm font-medium text-white">
                  Set {activePageNumber} of {pageCount}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!canPageBackward}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handlePageShift(-1);
                  }}
                >
                  Previous set
                </Button>
                <Button
                  disabled={!canPageForward}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handlePageShift(1);
                  }}
                >
                  Next set
                </Button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {visibleCameras.length > 0 ? (
                visibleCameras.map((camera) => (
                  <button
                    key={camera.name}
                    className={getCameraChipClasses(camera.name === selectedCameraName)}
                    type="button"
                    onClick={() => {
                      setSelectedCamera(camera.name);
                    }}
                  >
                    <div className="font-medium">{camera.name}</div>
                    <div className="mt-1 text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      {camera.name === layoutSelection.cameraNames[0] ? 'Primary tile' : 'Visible'}
                    </div>
                  </button>
                ))
              ) : (
                <div className="col-span-full border border-dashed border-white/10 px-4 py-3 text-sm text-white/55">
                  No enabled cameras available in the current device inventory yet.
                </div>
              )}
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
              Pick a layout, move across camera sets, and keep PTZ anchored to the selected camera.
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

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Selected camera
                </div>
                <div className="mt-1 text-sm font-medium">
                  {selectedCameraName !== '' ? selectedCameraName : 'Select a camera'}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Bitrate
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatMetric(streamStats?.bitrateKbps, ' kbps')}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Route
                </div>
                <div className="mt-1 text-sm font-medium">{transport.httpBaseUrl}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isBusy || layoutSelection.cameraNames.length === 0}
                type="button"
                onClick={() => {
                  lastAppliedSelectionRef.current = layoutSelectionKey;
                  startLive(layoutSelection);
                }}
              >
                {isStreamSessionActive ? 'Restart live view' : 'Start live view'}
              </Button>
              <Button
                disabled={!isStreamSessionActive && activeCameraName === null}
                type="button"
                variant="outline"
                onClick={() => {
                  lastAppliedSelectionRef.current = null;
                  stopLive();
                }}
              >
                Stop live view
              </Button>
              <Button type="button" variant="outline" onClick={refreshStatus}>
                Refresh status
              </Button>
            </div>

            <Separator />

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
          currentCamera={selectedCameraName}
          onSelectCamera={handleCameraSelect}
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
  iceTransportPolicy,
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
      iceTransportPolicy={iceTransportPolicy}
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
