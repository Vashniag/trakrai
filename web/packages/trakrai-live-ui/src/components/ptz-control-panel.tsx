'use client';

import { useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Separator } from '@trakrai/design-system/components/separator';

import type { PtzPosition, PtzVelocityCommand } from '../lib/live-types';

import {
  DEFAULT_ZOOM_TARGET,
  PTZ_BUTTON_ACTIVE_CLASSES,
  PTZ_BUTTON_BASE_CLASSES,
  PTZ_BUTTON_INACTIVE_CLASSES,
  PTZ_DIRECTION_LAYOUT,
  PTZ_ZOOM_DIRECTIONS,
  PTZ_ZOOM_MAX,
  PTZ_ZOOM_MIN,
  PTZ_ZOOM_STEP,
  formatSignedMetric,
  formatUpdatedAt,
  getPtzStopButtonClasses,
  getServiceStatusClasses,
} from '../lib/live-ui-utils';

type Props = Readonly<{
  activeDirection: string | null;
  cameraName: string;
  controlsEnabled: boolean;
  error: string | null;
  isCameraConfigured: boolean;
  lastCommand: string;
  lastMovement: string;
  onBeginMove: (directionId: string, velocity: PtzVelocityCommand) => void;
  onEndMove: () => void;
  onGoHome: () => void;
  onRefreshPosition: () => void;
  onSetZoom: (zoom: number) => void;
  position: PtzPosition | null;
  serviceRegistered: boolean;
  statusLabel: string;
}>;

const GRID_BUTTON_LAYOUT_CLASSES = 'px-3 py-4 text-center';
const ZOOM_BUTTON_LAYOUT_CLASSES = 'px-4 py-3 text-left';

const getGridButtonClasses = (isActive: boolean): string =>
  `${PTZ_BUTTON_BASE_CLASSES} ${GRID_BUTTON_LAYOUT_CLASSES} ${
    isActive ? PTZ_BUTTON_ACTIVE_CLASSES : PTZ_BUTTON_INACTIVE_CLASSES
  }`;

const getZoomButtonClasses = (isActive: boolean): string =>
  `${PTZ_BUTTON_BASE_CLASSES} ${ZOOM_BUTTON_LAYOUT_CLASSES} ${
    isActive ? PTZ_BUTTON_ACTIVE_CLASSES : PTZ_BUTTON_INACTIVE_CLASSES
  }`;

export const PtzControlPanel = ({
  activeDirection,
  cameraName,
  controlsEnabled,
  error,
  isCameraConfigured,
  lastCommand,
  lastMovement,
  onBeginMove,
  onEndMove,
  onGoHome,
  onRefreshPosition,
  onSetZoom,
  position,
  serviceRegistered,
  statusLabel,
}: Props) => {
  const [zoomTargetDraft, setZoomTargetDraft] = useState<number | null>(null);

  const hasCamera = cameraName.trim() !== '';
  const zoomTarget = zoomTargetDraft ?? position?.zoom ?? DEFAULT_ZOOM_TARGET;
  const statusClasses = getServiceStatusClasses(statusLabel);

  const handleGoHome = () => {
    if (!hasCamera) {
      return;
    }

    setZoomTargetDraft(null);
    onGoHome();
  };

  const handleRefreshPosition = () => {
    if (!hasCamera) {
      return;
    }

    setZoomTargetDraft(null);
    onRefreshPosition();
  };

  const handleApplyZoom = () => {
    if (!hasCamera) {
      return;
    }

    onSetZoom(zoomTarget);
    setZoomTargetDraft(null);
  };

  return (
    <section>
      <Card className="border">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">PTZ control</CardTitle>
              <CardDescription>
                Hold a direction to drive the selected camera. Release to stop.
              </CardDescription>
            </div>
            <div
              className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] tracking-[0.2em] uppercase ${statusClasses}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {statusLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Target camera
              </div>
              <div className="mt-1 text-sm font-medium">
                {hasCamera ? cameraName : 'Select a camera'}
              </div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Last command
              </div>
              <div className="mt-1 text-sm font-medium">{lastCommand}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Position sample
              </div>
              <div className="mt-1 text-sm font-medium">{formatUpdatedAt(position?.updatedAt)}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Motion
              </div>
              <div className="mt-1 text-sm font-medium">{lastMovement}</div>
            </div>
          </div>

          {!serviceRegistered ? (
            <div className="text-muted-foreground border border-dashed px-4 py-3 text-sm">
              PTZ service is not registered on this device yet.
            </div>
          ) : null}

          {serviceRegistered && !isCameraConfigured ? (
            <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {hasCamera
                ? `${cameraName} is not configured for PTZ in the device service.`
                : 'Choose a camera to enable PTZ.'}
            </div>
          ) : null}

          {error !== null && error !== '' ? (
            <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {PTZ_DIRECTION_LAYOUT.flatMap((row) =>
                  row.map((item) => {
                    if (item === 'stop') {
                      return (
                        <button
                          key="stop"
                          className={`${getPtzStopButtonClasses()} px-3 py-4 text-center`}
                          disabled={!controlsEnabled}
                          type="button"
                          onClick={onEndMove}
                        >
                          <div className="text-xs font-semibold tracking-[0.2em] uppercase">
                            STOP
                          </div>
                          <div className="mt-2 text-[10px] tracking-[0.18em] text-white/55 uppercase">
                            Brake
                          </div>
                        </button>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        className={getGridButtonClasses(activeDirection === item.id)}
                        disabled={!controlsEnabled}
                        type="button"
                        onPointerCancel={onEndMove}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          onBeginMove(item.id, item.velocity);
                        }}
                        onPointerLeave={onEndMove}
                        onPointerUp={onEndMove}
                      >
                        <div className="text-xs font-semibold tracking-[0.2em] uppercase">
                          {item.shortLabel}
                        </div>
                        <div className="text-muted-foreground mt-2 text-[10px] tracking-[0.18em] uppercase">
                          {item.label}
                        </div>
                      </button>
                    );
                  }),
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  disabled={!controlsEnabled}
                  type="button"
                  variant="outline"
                  onClick={handleGoHome}
                >
                  Go home
                </Button>
                <Button
                  disabled={!hasCamera}
                  type="button"
                  variant="outline"
                  onClick={handleRefreshPosition}
                >
                  Refresh position
                </Button>
              </div>
            </div>

            <div className="space-y-4 border p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                      Zoom target
                    </div>
                    <div className="mt-1 text-lg font-semibold">{zoomTarget.toFixed(2)}</div>
                  </div>
                  <div className="text-muted-foreground text-right text-xs">
                    Hold zoom for coarse moves, or apply an exact level.
                  </div>
                </div>
                <input
                  className="h-2 w-full cursor-pointer accent-emerald-600"
                  disabled={!controlsEnabled}
                  max={PTZ_ZOOM_MAX}
                  min={PTZ_ZOOM_MIN}
                  step={PTZ_ZOOM_STEP}
                  type="range"
                  value={zoomTarget}
                  onChange={(event) => {
                    setZoomTargetDraft(Number(event.target.value));
                  }}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {PTZ_ZOOM_DIRECTIONS.map((direction) => (
                  <button
                    key={direction.id}
                    className={getZoomButtonClasses(activeDirection === direction.id)}
                    disabled={!controlsEnabled}
                    type="button"
                    onPointerCancel={onEndMove}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      onBeginMove(direction.id, direction.velocity);
                    }}
                    onPointerLeave={onEndMove}
                    onPointerUp={onEndMove}
                  >
                    <div className="text-xs font-semibold tracking-[0.2em] uppercase">
                      {direction.label}
                    </div>
                    <div className="text-muted-foreground mt-2 text-[11px]">
                      {direction.id === 'zoom-in' ? 'Hold for tele move' : 'Hold for wide move'}
                    </div>
                  </button>
                ))}
              </div>

              <Button
                className="w-full"
                disabled={!controlsEnabled}
                type="button"
                onClick={handleApplyZoom}
              >
                Apply zoom target
              </Button>

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="border p-3">
                  <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                    Pan
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {formatSignedMetric(position?.pan)}
                  </div>
                </div>
                <div className="border p-3">
                  <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                    Tilt
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {formatSignedMetric(position?.tilt)}
                  </div>
                </div>
                <div className="border p-3">
                  <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                    Zoom
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {formatSignedMetric(position?.zoom)}
                  </div>
                </div>
                <div className="border p-3">
                  <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                    PTZ service
                  </div>
                  <div className="mt-1 text-sm font-medium">{statusLabel}</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
