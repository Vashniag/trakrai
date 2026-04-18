'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { CameraInventoryCard } from '@trakrai/live-viewer/components/camera-inventory-card';
import { LiveDiagnosticsPanel } from '@trakrai/live-viewer/components/live-diagnostics-panel';
import {
  LiveViewerPanel,
  type LiveViewerLayoutModel,
} from '@trakrai/live-viewer/components/live-viewer-panel';
import { useLiveViewer, type LiveViewerState } from '@trakrai/live-viewer/hooks/use-live-viewer';
import {
  clampLiveLayoutStartIndex,
  getLiveLayoutCapacity,
  getLiveLayoutPageCount,
  getLiveLayoutPageLabel,
  getVisibleLayoutCameras,
} from '@trakrai/live-viewer/lib/live-layout-utils';
import { PtzControlPanel } from '@trakrai/ptz-controller/components/ptz-control-panel';
import { usePtzController } from '@trakrai/ptz-controller/hooks/use-ptz-controller';

import type {
  LiveFrameSource,
  LiveLayoutMode,
  LiveLayoutSelection,
} from '@trakrai/live-viewer/lib/live-viewer-types';

type DeviceCamera = NonNullable<LiveViewerState['deviceStatus']>['cameras'][number];

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

export const DeviceLivePage = () => {
  const [selectedCamera, setSelectedCamera] = useState('');
  const [frameSource, setFrameSource] = useState<LiveFrameSource>('raw');
  const [layoutMode, setLayoutMode] = useState<LiveLayoutMode>('single');
  const [layoutStartIndex, setLayoutStartIndex] = useState(0);
  const lastAppliedSelectionRef = useRef<string | null>(null);

  const viewer = useLiveViewer();
  const enabledCameras = useMemo(
    () => (viewer.deviceStatus?.cameras ?? []).filter((camera) => camera.enabled),
    [viewer.deviceStatus?.cameras],
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
  const liveFeedFrameSourceDetail =
    viewer.deviceStatus?.services?.['live-feed']?.details?.['frameSource'];
  let reportedFrameSource: LiveFrameSource | null = null;
  if (liveFeedFrameSourceDetail === 'processed' || liveFeedFrameSourceDetail === 'raw') {
    reportedFrameSource = liveFeedFrameSourceDetail;
  }
  const activeFrameSource = reportedFrameSource ?? frameSource;
  const activeFrameSourceLabel =
    activeFrameSource === 'processed' ? 'Processed frames' : 'Raw frames';
  const canPageBackward = safeLayoutStartIndex > 0;
  const canPageForward =
    safeLayoutStartIndex + getLiveLayoutCapacity(layoutMode) < enabledCameras.length;
  const ptz = usePtzController(selectedCameraName);

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

  const layoutModel: LiveViewerLayoutModel = {
    activeFrameSourceLabel,
    activePageNumber,
    canPageBackward,
    canPageForward,
    frameSource,
    isStreamSessionActive,
    layoutMode,
    pageCount,
    pageLabel,
    primaryCameraLabel,
    primaryResolutionLabel,
    selectedCameraName,
    visibleCameraNamesLabel,
    visibleCameras,
    onFrameSourceChange: setFrameSource,
    onLayoutChange: handleLayoutChange,
    onPageShift: handlePageShift,
    onSelectCamera: handleCameraSelect,
    onStartLive: () => {
      lastAppliedSelectionRef.current = layoutSelectionKey;
      viewer.startLive(layoutSelection);
    },
  };

  return (
    <div className="space-y-5">
      <section className="grid items-start gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <LiveViewerPanel layout={layoutModel} viewer={viewer} />
        <PtzControlPanel controller={ptz} />
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <CameraInventoryCard
          cameras={enabledCameras}
          currentCamera={selectedCameraName}
          onSelectCamera={handleCameraSelect}
        />
        <LiveDiagnosticsPanel streamStats={viewer.streamStats} />
      </section>
    </div>
  );
};
