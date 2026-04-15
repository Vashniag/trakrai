'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { VideoPlayer } from '@trakrai/live-viewer/components/video-player';

import type { RoiBounds, RoiBoxSpec } from '../lib/roi-config-types';
import type { LiveViewerState } from '@trakrai/live-viewer/hooks/use-live-viewer';

type FrameRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type RoiVideoOverlayModel = Readonly<{
  activeRoiId: string | null;
  draftBounds: RoiBounds | null;
  onDraftBoundsChange: (bounds: RoiBounds | null) => void;
  onSelectRoi: (roiId: string | null) => void;
  rois: RoiBoxSpec[];
}>;

type RoiVideoEditorProps = Readonly<{
  isActive: boolean;
  overlay: RoiVideoOverlayModel;
  viewer: Pick<LiveViewerState, 'activeCameraName' | 'connectionState' | 'stream' | 'streamStats'>;
}>;

const DEFAULT_FRAME_HEIGHT = 9;
const DEFAULT_FRAME_WIDTH = 16;
const DEFAULT_FRAME_ASPECT = DEFAULT_FRAME_WIDTH / DEFAULT_FRAME_HEIGHT;
const MIN_DRAW_SIZE_PX = 2;
const PERCENT_SCALE = 100;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const toPercentLabel = (value: number): string => `${Math.round(value * PERCENT_SCALE)}%`;

const getFrameRect = (
  containerWidth: number,
  containerHeight: number,
  frameAspect: number,
): FrameRect => {
  const containerAspect =
    containerHeight === 0 ? DEFAULT_FRAME_ASPECT : containerWidth / containerHeight;
  if (containerAspect > frameAspect) {
    const height = containerHeight;
    const width = height * frameAspect;
    return {
      height,
      width,
      x: (containerWidth - width) / 2,
      y: 0,
    };
  }

  const width = containerWidth;
  const height = width / frameAspect;
  return {
    height,
    width,
    x: 0,
    y: (containerHeight - height) / 2,
  };
};

const toOverlayStyle = (frameRect: FrameRect, bounds: RoiBounds) => ({
  height: `${bounds.height * frameRect.height}px`,
  left: `${frameRect.x + bounds.x * frameRect.width}px`,
  top: `${frameRect.y + bounds.y * frameRect.height}px`,
  width: `${bounds.width * frameRect.width}px`,
});

export const RoiVideoEditor = ({ isActive, overlay, viewer }: RoiVideoEditorProps) => {
  const { activeCameraName, connectionState, stream, streamStats } = viewer;
  const { activeRoiId, draftBounds, onDraftBoundsChange, onSelectRoi, rois } = overlay;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [frameRect, setFrameRect] = useState<FrameRect>({
    height: 0,
    width: 0,
    x: 0,
    y: 0,
  });

  const frameAspect = useMemo(() => {
    if (
      streamStats?.frameWidth != null &&
      streamStats.frameHeight != null &&
      streamStats.frameHeight > 0
    ) {
      return streamStats.frameWidth / streamStats.frameHeight;
    }
    return DEFAULT_FRAME_ASPECT;
  }, [streamStats?.frameHeight, streamStats?.frameWidth]);

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) {
      return undefined;
    }

    const updateFrameRect = () => {
      const nextRect = getFrameRect(node.clientWidth, node.clientHeight, frameAspect);
      setFrameRect(nextRect);
    };

    updateFrameRect();
    const observer = new ResizeObserver(updateFrameRect);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [frameAspect]);

  const updateDraftBoundsFromPoint = (clientX: number, clientY: number) => {
    const start = dragStartRef.current;
    const node = containerRef.current;
    if (start === null || node === null || frameRect.width <= 0 || frameRect.height <= 0) {
      return;
    }

    const rect = node.getBoundingClientRect();
    const currentX = clamp(clientX - rect.left, frameRect.x, frameRect.x + frameRect.width);
    const currentY = clamp(clientY - rect.top, frameRect.y, frameRect.y + frameRect.height);
    const nextX = Math.min(start.x, currentX);
    const nextY = Math.min(start.y, currentY);
    const nextWidth = Math.abs(currentX - start.x);
    const nextHeight = Math.abs(currentY - start.y);
    if (nextWidth < MIN_DRAW_SIZE_PX || nextHeight < MIN_DRAW_SIZE_PX) {
      return;
    }

    onDraftBoundsChange({
      height: nextHeight / frameRect.height,
      width: nextWidth / frameRect.width,
      x: (nextX - frameRect.x) / frameRect.width,
      y: (nextY - frameRect.y) / frameRect.height,
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onPointerCancel={() => {
        dragStartRef.current = null;
      }}
      onPointerMove={(event) => {
        if (dragStartRef.current === null) {
          return;
        }
        updateDraftBoundsFromPoint(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (dragStartRef.current === null) {
          return;
        }
        updateDraftBoundsFromPoint(event.clientX, event.clientY);
        dragStartRef.current = null;
      }}
    >
      <VideoPlayer
        activeCameraName={activeCameraName}
        connectionState={connectionState}
        isActive={isActive}
        stream={stream}
        streamStats={streamStats}
      />

      <div
        className="absolute inset-0"
        onPointerDown={(event) => {
          if (!isActive || frameRect.width <= 0 || frameRect.height <= 0) {
            return;
          }
          const node = containerRef.current;
          if (node === null) {
            return;
          }
          const rect = node.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          const insideFrame =
            localX >= frameRect.x &&
            localX <= frameRect.x + frameRect.width &&
            localY >= frameRect.y &&
            localY <= frameRect.y + frameRect.height;
          if (!insideFrame) {
            return;
          }
          onSelectRoi(null);
          dragStartRef.current = { x: localX, y: localY };
          onDraftBoundsChange(null);
        }}
      >
        {rois.map((roi) => {
          const isSelected = roi.id === activeRoiId;
          return (
            <button
              key={roi.id}
              className={`absolute border-2 text-left ${
                isSelected
                  ? 'border-primary bg-primary/10'
                  : 'border-emerald-400/90 bg-emerald-400/12'
              }`}
              style={toOverlayStyle(frameRect, roi.bounds)}
              type="button"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectRoi(roi.id);
              }}
            >
              <div className="bg-background/90 pointer-events-none px-2 py-1 text-[10px] tracking-[0.18em] uppercase">
                <div className="font-medium">{roi.name}</div>
                <div className="text-muted-foreground">
                  {toPercentLabel(roi.bounds.width)} × {toPercentLabel(roi.bounds.height)}
                </div>
              </div>
            </button>
          );
        })}

        {draftBounds !== null ? (
          <div
            className="border-primary/90 bg-primary/10 absolute border-2 border-dashed"
            style={toOverlayStyle(frameRect, draftBounds)}
          />
        ) : null}
      </div>
    </div>
  );
};
