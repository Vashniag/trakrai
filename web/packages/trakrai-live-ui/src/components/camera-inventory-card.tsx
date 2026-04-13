'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import type { DeviceCamera } from '../lib/live-types';

const CAMERA_CARD_SELECTED_CLASSES = 'border-emerald-500 bg-emerald-50';
const CAMERA_CARD_IDLE_CLASSES =
  'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

type Props = Readonly<{
  cameras: DeviceCamera[];
  currentCamera: string;
  onSelectCamera: (cameraName: string) => void;
}>;

export const CameraInventoryCard = ({ cameras, currentCamera, onSelectCamera }: Props) => (
  <Card className="border">
    <CardHeader className="border-b">
      <CardTitle className="text-base">Camera inventory</CardTitle>
      <CardDescription>Announced by the device and ready for fast switching.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3 md:grid-cols-2">
      {cameras.length > 0 ? (
        cameras.map((camera) => {
          const isSelected = currentCamera === camera.name;
          return (
            <button
              key={camera.name}
              className={`border px-4 py-4 text-left transition ${
                isSelected ? CAMERA_CARD_SELECTED_CLASSES : CAMERA_CARD_IDLE_CLASSES
              }`}
              type="button"
              onClick={() => {
                onSelectCamera(camera.name);
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{camera.name}</span>
                <span className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  {camera.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                Fast switch target for the live pipeline.
              </p>
            </button>
          );
        })
      ) : (
        <div className="text-muted-foreground border border-dashed px-4 py-5 text-sm">
          No camera inventory has been published by the device yet. Use refresh once the gateway
          socket is connected.
        </div>
      )}
    </CardContent>
  </Card>
);
