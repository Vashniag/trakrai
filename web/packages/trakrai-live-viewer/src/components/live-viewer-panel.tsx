'use client';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import {
  formatMetric,
  getStatusClasses,
  getStatusLabel,
} from '@trakrai/live-transport/lib/live-display-utils';

import { VideoPlayer } from './video-player';

import type { LiveViewerState } from '../hooks/use-live-viewer';
import type { LiveFrameSource, LiveLayoutMode } from '../lib/live-viewer-types';
import type { DeviceCamera } from '@trakrai/live-transport/lib/live-types';

import { LIVE_LAYOUT_OPTIONS } from '../lib/live-layout-utils';

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
const ACTIVE_BUTTON_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
const INACTIVE_BUTTON_CLASSES =
  'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

const getLayoutButtonClasses = (isActive: boolean): string =>
  `flex min-h-28 flex-col justify-between border p-4 text-left transition ${
    isActive ? ACTIVE_BUTTON_CLASSES : INACTIVE_BUTTON_CLASSES
  }`;

const getCameraChipClasses = (isActive: boolean): string =>
  `border px-3 py-2 text-left text-xs transition ${isActive ? ACTIVE_BUTTON_CLASSES : INACTIVE_BUTTON_CLASSES}`;

const getFrameSourceButtonClasses = (isActive: boolean): string =>
  `border px-4 py-3 text-left transition ${isActive ? ACTIVE_BUTTON_CLASSES : INACTIVE_BUTTON_CLASSES}`;

const LIVE_FRAME_SOURCE_OPTIONS: ReadonlyArray<
  Readonly<{
    description: string;
    label: string;
    value: LiveFrameSource;
  }>
> = [
  {
    description: 'Direct JPEG frames written by the RTSP feeder.',
    label: 'Raw frames',
    value: 'raw',
  },
  {
    description: 'Annotated AI output with detections and overlays from Redis.',
    label: 'Processed frames',
    value: 'processed',
  },
];

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

export type LiveViewerLayoutModel = Readonly<{
  activeFrameSourceLabel: string;
  activePageNumber: number;
  canPageBackward: boolean;
  canPageForward: boolean;
  frameSource: LiveFrameSource;
  isStreamSessionActive: boolean;
  layoutMode: LiveLayoutMode;
  pageCount: number;
  pageLabel: string;
  primaryCameraLabel: string;
  primaryResolutionLabel: string;
  selectedCameraName: string;
  visibleCameraNamesLabel: string;
  visibleCameras: DeviceCamera[];
  onFrameSourceChange: (frameSource: LiveFrameSource) => void;
  onLayoutChange: (mode: LiveLayoutMode) => void;
  onPageShift: (direction: -1 | 1) => void;
  onSelectCamera: (cameraName: string) => void;
  onStartLive: () => void;
}>;

export type LiveViewerPanelProps = Readonly<{
  layout: LiveViewerLayoutModel;
  viewer: LiveViewerState;
}>;

export const LiveViewerPanel = ({ layout, viewer }: LiveViewerPanelProps) => {
  const {
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
    onFrameSourceChange,
    onLayoutChange,
    onPageShift,
    onSelectCamera,
    onStartLive,
  } = layout;
  const {
    activeCameraName,
    connectionState,
    error,
    isBusy,
    refreshStatus: onRefreshStatus,
    stopLive: onStopLive,
    stream,
    streamStats,
  } = viewer;
  const statusClasses = getStatusClasses(connectionState);

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Live monitor</CardTitle>
            <CardDescription>
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
        <div className="bg-muted/30 border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                Active layout
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
                {LIVE_LAYOUT_OPTIONS.find((option) => option.mode === layoutMode)?.description ??
                  'Single camera'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                Showing cameras
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
                {visibleCameraNamesLabel}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <VideoPlayer
              activeCameraName={activeCameraName ?? primaryCameraLabel}
              connectionState={connectionState}
              isActive={isStreamSessionActive}
              stream={stream}
              streamStats={streamStats}
            />
          </div>

          {error !== null && error !== '' ? (
            <div className="border-destructive/30 bg-destructive/10 text-destructive mt-4 border px-3 py-2 text-xs">
              {error}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <div className="bg-card border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                Primary camera
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">{primaryCameraLabel}</div>
            </div>
            <div className="bg-card border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                Camera set
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">{pageLabel}</div>
            </div>
            <div className="bg-card border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                Frame source
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
                {activeFrameSourceLabel}
              </div>
            </div>
            <div className="bg-card border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                FPS
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
                {formatMetric(streamStats?.fps, '')}
              </div>
            </div>
            <div className="bg-card border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
                Resolution
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
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
                onLayoutChange(option.mode);
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
              <span className="text-muted-foreground mt-3 text-xs">{option.description}</span>
            </button>
          ))}
        </div>

        <div className="bg-muted/30 border p-3">
          <div>
            <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
              Frame source
            </div>
            <div className="text-foreground mt-1 text-sm font-medium">
              Switch the stitched live stream between raw RTSP frames and processed AI output.
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {LIVE_FRAME_SOURCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={getFrameSourceButtonClasses(frameSource === option.value)}
                type="button"
                onClick={() => {
                  onFrameSourceChange(option.value);
                }}
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-muted-foreground mt-1 text-xs">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 border p-3">
          <div>
            <div className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
              Paging
            </div>
            <div className="text-foreground mt-1 text-sm font-medium">
              Set {activePageNumber} of {pageCount}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canPageBackward}
              type="button"
              variant="outline"
              onClick={() => {
                onPageShift(-1);
              }}
            >
              Previous set
            </Button>
            <Button
              disabled={!canPageForward}
              type="button"
              variant="outline"
              onClick={() => {
                onPageShift(1);
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
                  onSelectCamera(camera.name);
                }}
              >
                <div className="font-medium">{camera.name}</div>
                <div className="text-muted-foreground mt-1 text-[11px] tracking-[0.18em] uppercase">
                  {camera.name === selectedCameraName ? 'Selected' : 'Visible'}
                </div>
              </button>
            ))
          ) : (
            <div className="text-muted-foreground col-span-full border border-dashed px-4 py-3 text-sm">
              No enabled cameras available in the current device inventory yet.
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy || visibleCameras.length === 0}
            type="button"
            onClick={() => {
              onStartLive();
            }}
          >
            {isStreamSessionActive ? 'Restart live view' : 'Start live view'}
          </Button>
          <Button
            disabled={!isStreamSessionActive && activeCameraName === null}
            type="button"
            variant="outline"
            onClick={onStopLive}
          >
            Stop live view
          </Button>
          <Button type="button" variant="outline" onClick={onRefreshStatus}>
            Refresh status
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
