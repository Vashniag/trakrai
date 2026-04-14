'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { DeviceServicesPanel } from '@trakrai/live-transport/components/device-services-panel';
import { DiagnosticsPanel } from '@trakrai/live-transport/components/diagnostics-panel';
import { RuntimeManagerPanel } from '@trakrai/live-transport/components/runtime-manager-panel';
import { useDeviceRuntime } from '@trakrai/live-transport/hooks/use-device-runtime';
import { useRuntimeManager } from '@trakrai/live-transport/hooks/use-runtime-manager';
import { formatMetric } from '@trakrai/live-transport/lib/live-display-utils';
import { CameraInventoryCard } from '@trakrai/live-viewer/components/camera-inventory-card';
import { LiveViewerPanel } from '@trakrai/live-viewer/components/live-viewer-panel';
import { useLiveViewer } from '@trakrai/live-viewer/hooks/use-live-viewer';
import {
  clampLiveLayoutStartIndex,
  getLiveLayoutCapacity,
  getLiveLayoutPageCount,
  getLiveLayoutPageLabel,
  getVisibleLayoutCameras,
} from '@trakrai/live-viewer/lib/live-layout-utils';
import { PtzControlPanel } from '@trakrai/ptz-controller/components/ptz-control-panel';
import { usePtzController } from '@trakrai/ptz-controller/hooks/use-ptz-controller';

import type { DeviceCamera } from '@trakrai/live-transport/lib/live-types';
import type {
  LiveFrameSource,
  LiveLayoutMode,
  LiveLayoutSelection,
} from '@trakrai/live-viewer/lib/live-viewer-types';

export const DEFAULT_LIVE_DEVICE_ID = 'hacklab@10.8.0.50';

type WorkspacePanelId = 'diagnostics' | 'inventory' | 'ptz' | 'runtime' | 'services';

type PanelVisibility = Record<WorkspacePanelId, boolean>;

const PANEL_OPTIONS: ReadonlyArray<
  Readonly<{ description: string; id: WorkspacePanelId; label: string }>
> = [
  {
    description: 'Service health, heartbeats, and route metadata.',
    id: 'services',
    label: 'Services',
  },
  {
    description: 'Inventory announced by the device and quick camera picks.',
    id: 'inventory',
    label: 'Inventory',
  },
  {
    description: 'Systemd service control, versions, updates, and log tails.',
    id: 'runtime',
    label: 'Runtime',
  },
  {
    description: 'Directional PTZ, zoom, and camera position controls.',
    id: 'ptz',
    label: 'PTZ',
  },
  {
    description: 'Stream metrics and rolling diagnostic events.',
    id: 'diagnostics',
    label: 'Diagnostics',
  },
];

export type LiveWorkspaceProps = Readonly<{
  defaultDeviceId?: string;
  deviceId: string;
  deviceIdEditable?: boolean;
  diagnosticsEnabled?: boolean;
  managementServiceName?: string;
  onDeviceIdChange: (nextValue: string) => void;
}>;

type LiveWorkspaceShellProps = Readonly<{
  defaultDeviceId: string;
  diagnosticsEnabled: boolean;
  deviceId: string;
  deviceIdEditable: boolean;
  managementServiceName: string;
  onDeviceIdChange: (nextValue: string) => void;
  panelVisibility: PanelVisibility;
  onTogglePanel: (panelId: WorkspacePanelId) => void;
}>;

const PANEL_BUTTON_ACTIVE_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
const PANEL_BUTTON_IDLE_CLASSES =
  'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

const getPanelButtonClasses = (isActive: boolean): string =>
  `border px-4 py-3 text-left transition ${
    isActive ? PANEL_BUTTON_ACTIVE_CLASSES : PANEL_BUTTON_IDLE_CLASSES
  }`;

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

const LiveWorkspaceShell = ({
  defaultDeviceId,
  diagnosticsEnabled,
  deviceId,
  deviceIdEditable,
  managementServiceName,
  onDeviceIdChange,
  panelVisibility,
  onTogglePanel,
}: LiveWorkspaceShellProps) => {
  const [selectedCamera, setSelectedCamera] = useState('');
  const [frameSource, setFrameSource] = useState<LiveFrameSource>('raw');
  const [layoutMode, setLayoutMode] = useState<LiveLayoutMode>('single');
  const [layoutStartIndex, setLayoutStartIndex] = useState(0);
  const lastAppliedSelectionRef = useRef<string | null>(null);

  const viewer = useLiveViewer();
  const { deviceStatus, heartbeatAgeSeconds, logs } = useDeviceRuntime();
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
      frameSource,
      mode: layoutMode,
    }),
    [frameSource, layoutMode, visibleCameras],
  );
  const layoutSelectionKey = useMemo(() => JSON.stringify(layoutSelection), [layoutSelection]);
  const isStreamSessionActive =
    viewer.connectionState === 'starting' || viewer.connectionState === 'streaming';
  const primaryCameraLabel =
    viewer.activeCameraName ?? layoutSelection.cameraNames[0] ?? 'No camera selected';
  const visibleCameraNamesLabel =
    layoutSelection.cameraNames.length > 0 ? layoutSelection.cameraNames.join(', ') : 'No cameras';
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
  const primaryResolutionLabel =
    viewer.streamStats?.frameWidth == null || viewer.streamStats.frameHeight == null
      ? 'N/A'
      : `${viewer.streamStats.frameWidth}x${viewer.streamStats.frameHeight}`;
  const liveFeedFrameSourceDetail = deviceStatus?.services?.['live-feed']?.details?.['frameSource'];
  let reportedFrameSource: LiveFrameSource | null = null;
  if (liveFeedFrameSourceDetail === 'processed' || liveFeedFrameSourceDetail === 'raw') {
    reportedFrameSource = liveFeedFrameSourceDetail;
  }
  const activeFrameSource = reportedFrameSource ?? frameSource;
  const activeFrameSourceLabel =
    activeFrameSource === 'processed' ? 'Processed frames' : 'Raw frames';
  const visiblePanels = diagnosticsEnabled
    ? panelVisibility
    : {
        ...panelVisibility,
        diagnostics: false,
      };
  const panelOptions = diagnosticsEnabled
    ? PANEL_OPTIONS
    : PANEL_OPTIONS.filter((panel) => panel.id !== 'diagnostics');
  const filteredPanelOptions = panelOptions.filter(
    (panel) => panel.id !== 'runtime' || managementServiceName.trim() !== '',
  );
  const canPageBackward = safeLayoutStartIndex > 0;
  const canPageForward =
    safeLayoutStartIndex + getLiveLayoutCapacity(layoutMode) < enabledCameras.length;
  const ptz = usePtzController(selectedCameraName);
  const runtimeManager = useRuntimeManager(managementServiceName);

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
    viewer.updateLiveLayout(layoutSelection);
  }, [isStreamSessionActive, layoutSelection, layoutSelectionKey, viewer]);

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
        <LiveViewerPanel
          activeCameraName={viewer.activeCameraName}
          activeFrameSourceLabel={activeFrameSourceLabel}
          activePageNumber={activePageNumber}
          canPageBackward={canPageBackward}
          canPageForward={canPageForward}
          connectionState={viewer.connectionState}
          error={viewer.error}
          frameSource={frameSource}
          isBusy={viewer.isBusy}
          isStreamSessionActive={isStreamSessionActive}
          layoutMode={layoutMode}
          pageCount={pageCount}
          pageLabel={pageLabel}
          primaryCameraLabel={primaryCameraLabel}
          primaryResolutionLabel={primaryResolutionLabel}
          selectedCameraName={selectedCameraName}
          stream={viewer.stream}
          streamStats={viewer.streamStats}
          visibleCameraNamesLabel={visibleCameraNamesLabel}
          visibleCameras={visibleCameras}
          onFrameSourceChange={setFrameSource}
          onLayoutChange={handleLayoutChange}
          onPageShift={handlePageShift}
          onRefreshStatus={viewer.refreshStatus}
          onSelectCamera={handleCameraSelect}
          onStartLive={() => {
            lastAppliedSelectionRef.current = layoutSelectionKey;
            viewer.startLive(layoutSelection);
          }}
          onStopLive={() => {
            lastAppliedSelectionRef.current = null;
            viewer.stopLive();
          }}
        />

        {visiblePanels.ptz ? (
          <PtzControlPanel
            key={ptz.cameraName !== '' ? ptz.cameraName : 'no-ptz-camera'}
            activeDirection={ptz.activeDirection}
            cameraName={ptz.cameraName}
            capabilities={ptz.capabilities}
            controlsEnabled={ptz.controlsEnabled}
            error={ptz.error}
            isCameraConfigured={ptz.isCameraConfigured}
            lastCommand={ptz.lastCommand}
            lastMovement={ptz.lastMovement}
            position={ptz.position}
            serviceRegistered={ptz.serviceRegistered}
            statusLabel={ptz.statusLabel}
            onBeginMove={ptz.beginMove}
            onEndMove={ptz.endMove}
            onGoHome={ptz.goHome}
            onRefreshPosition={ptz.refreshPosition}
            onSetZoom={ptz.setZoom}
          />
        ) : null}
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Workspace controls</CardTitle>
            <CardDescription>
              The shell composes independent viewer, PTZ, runtime, inventory, services, and
              diagnostics panels on top of the shared transport and WebRTC providers.
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
                  {formatMetric(viewer.streamStats?.bitrateKbps, ' kbps')}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Transport
                </div>
                <div className="mt-1 text-sm font-medium capitalize">
                  {viewer.transport.transportMode}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Visible panels
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {filteredPanelOptions.map((panel) => (
                  <button
                    key={panel.id}
                    className={getPanelButtonClasses(visiblePanels[panel.id])}
                    type="button"
                    onClick={() => {
                      onTogglePanel(panel.id);
                    }}
                  >
                    <div className="font-medium">{panel.label}</div>
                    <div className="text-muted-foreground mt-1 text-xs">{panel.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {visiblePanels.inventory ? (
          <CameraInventoryCard
            cameras={enabledCameras}
            currentCamera={selectedCameraName}
            onSelectCamera={handleCameraSelect}
          />
        ) : null}
      </section>

      {visiblePanels.services ? (
        <section>
          <DeviceServicesPanel
            deviceStatus={viewer.deviceStatus}
            heartbeatAgeSeconds={heartbeatAgeSeconds}
            managedServices={runtimeManager.services}
            routeLabel={viewer.transport.httpBaseUrl}
          />
        </section>
      ) : null}

      {visiblePanels.runtime && managementServiceName.trim() !== '' ? (
        <RuntimeManagerPanel
          activeDefinition={runtimeManager.activeDefinition}
          error={runtimeManager.error}
          isBusy={runtimeManager.isBusy}
          lastLog={runtimeManager.lastLog}
          lastRefreshedAt={runtimeManager.lastRefreshedAt}
          paths={runtimeManager.paths}
          serviceRegistered={runtimeManager.serviceRegistered}
          services={runtimeManager.services}
          statusLabel={runtimeManager.statusLabel}
          onLoadServiceDefinition={runtimeManager.loadServiceDefinition}
          onRefreshLogs={runtimeManager.refreshLogs}
          onRefreshStatus={runtimeManager.refreshStatus}
          onRemoveService={runtimeManager.removeService}
          onRunServiceAction={runtimeManager.runServiceAction}
          onUpdateService={runtimeManager.updateService}
          onUpsertServiceDefinition={runtimeManager.upsertServiceDefinition}
        />
      ) : null}

      {visiblePanels.diagnostics ? (
        <section>
          <DiagnosticsPanel
            logs={logs}
            showDiagnostics={visiblePanels.diagnostics}
            streamStats={viewer.streamStats}
            onToggle={() => {
              onTogglePanel('diagnostics');
            }}
          />
        </section>
      ) : null}
    </div>
  );
};

export const LiveWorkspace = ({
  defaultDeviceId = DEFAULT_LIVE_DEVICE_ID,
  deviceId,
  deviceIdEditable = true,
  diagnosticsEnabled = true,
  managementServiceName = '',
  onDeviceIdChange,
}: LiveWorkspaceProps) => {
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>({
    diagnostics: diagnosticsEnabled,
    inventory: true,
    ptz: true,
    runtime: managementServiceName.trim() !== '',
    services: true,
  });

  return (
    <LiveWorkspaceShell
      defaultDeviceId={defaultDeviceId}
      deviceId={deviceId}
      deviceIdEditable={deviceIdEditable}
      diagnosticsEnabled={diagnosticsEnabled}
      managementServiceName={managementServiceName}
      panelVisibility={panelVisibility}
      onDeviceIdChange={onDeviceIdChange}
      onTogglePanel={(panelId) => {
        setPanelVisibility((currentState) => ({
          ...currentState,
          [panelId]: !currentState[panelId],
        }));
      }}
    />
  );
};
