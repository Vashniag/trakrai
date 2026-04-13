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
import { PtzControlPanel } from './ptz-control-panel';
import { VideoPlayer } from './video-player';

import type { PtzVelocityCommand } from '../lib/live-types';

import { useLiveWorkspace } from '../hooks/use-live-workspace';
import {
  DEFAULT_LIVE_DEVICE_ID,
  formatHeartbeatAge,
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
  deviceId: string;
  deviceIdEditable: boolean;
  onDeviceIdChange: (nextValue: string) => void;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
  defaultDeviceId: string;
}>;

const LiveWorkspaceBody = ({
  defaultDeviceId,
  deviceId,
  deviceIdEditable,
  onDeviceIdChange,
  onToggleDiagnostics,
  showDiagnostics,
}: LiveWorkspaceBodyProps) => {
  const [selectedCamera, setSelectedCamera] = useState('');
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
  } = useLiveWorkspace();

  const enabledCameras = useMemo(
    () => (deviceStatus?.cameras ?? []).filter((camera) => camera.enabled),
    [deviceStatus?.cameras],
  );
  const currentCamera =
    selectedCamera.trim() !== '' ? selectedCamera : (enabledCameras[0]?.name ?? '');
  const isStreaming = connectionState === 'streaming';
  const serviceStatuses = Object.values(deviceStatus?.services ?? {});
  const statusClasses = getStatusClasses(connectionState);
  const activeCameraLabel =
    activeCameraName ?? (currentCamera !== '' ? currentCamera : 'Not selected');
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
  const ptzStatusLabel = ptzState?.status ?? ptzServiceStatus?.status ?? 'offline';
  const lastPtzCommand = ptzState?.lastCommand ?? 'none';
  const lastPtzMovement =
    ptzPosition?.moveStatus?.panTilt ?? ptzPosition?.moveStatus?.zoom ?? ptzState?.status ?? 'idle';

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

  return (
    <div className="flex w-full max-w-7xl flex-col gap-5">
      <section className="grid items-start gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="border bg-neutral-950 text-white">
          <CardHeader className="border-b border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl text-white">Live feed</CardTitle>
                <CardDescription className="text-white/60">
                  Shared live view with WebRTC media transport and transport-agnostic device
                  signaling.
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
            <VideoPlayer
              activeCameraName={activeCameraName}
              connectionState={connectionState}
              isActive={isStreaming}
              stream={stream}
              streamStats={streamStats}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] tracking-[0.2em] text-white/45 uppercase">
                  Active camera
                </div>
                <div className="mt-1 text-sm font-medium text-white">{activeCameraLabel}</div>
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
              Device selection, live session control, and service health below the live viewport.
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
              <Label htmlFor="live-camera">Camera</Label>
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

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isBusy || currentCamera.trim() === ''}
                type="button"
                onClick={() => {
                  startLive(currentCamera);
                }}
              >
                {isStreaming ? 'Restart stream' : 'Start live view'}
              </Button>
              <Button
                disabled={!isStreaming && activeCameraName === null}
                type="button"
                variant="outline"
                onClick={stopLive}
              >
                Stop stream
              </Button>
              <Button type="button" variant="outline" onClick={refreshStatus}>
                Refresh status
              </Button>
            </div>

            {error !== null && error !== '' ? (
              <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </div>
            ) : null}

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
