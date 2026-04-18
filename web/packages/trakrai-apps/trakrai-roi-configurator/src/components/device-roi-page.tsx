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
import { Checkbox } from '@trakrai/design-system/components/checkbox';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { getServiceStatusClasses } from '@trakrai/live-transport/lib/live-display-utils';
import { CameraInventoryCard } from '@trakrai/live-viewer/components/camera-inventory-card';
import { useLiveViewer } from '@trakrai/live-viewer/hooks/use-live-viewer';
import { PtzControlPanel } from '@trakrai/ptz-controller/components/ptz-control-panel';
import { usePtzController } from '@trakrai/ptz-controller/hooks/use-ptz-controller';

import { RoiVideoEditor } from './roi-video-editor';

import type { RoiBounds, RoiBoxSpec, RoiCameraConfig, RoiDocument } from '../lib/roi-config-types';

import { useRoiConfig } from '../hooks/use-roi-config';

const DEFAULT_DOCUMENT_VERSION = 1;
const EMPTY_PERCENT_INPUT = '';
const PERCENT_PRECISION = 1;
const PERCENT_SCALE = 100;
const ROI_DEFAULT_COLOR = '#22c55e';
const ROI_FRAME_SOURCE = 'raw' as const;

type BaseEditorState = {
  baseId: string | null;
  name: string;
};

type RoiEditorState = {
  active: boolean;
  color: string;
  name: string;
  roiId: string | null;
};

const cloneDocument = (document: RoiDocument): RoiDocument =>
  JSON.parse(JSON.stringify(document)) as RoiDocument;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const createId = (prefix: string): string => `${prefix}-${crypto.randomUUID().toLowerCase()}`;

const defaultRoiEditorState = (): RoiEditorState => ({
  active: true,
  color: ROI_DEFAULT_COLOR,
  name: '',
  roiId: null,
});

const percentValue = (value: number): string => (value * PERCENT_SCALE).toFixed(PERCENT_PRECISION);

const percentToNormalized = (value: string): number => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 0;
  }
  return clamp(Number.parseFloat(trimmed) / PERCENT_SCALE, 0, 1);
};

const ensureCameraConfig = (document: RoiDocument, cameraName: string): RoiCameraConfig => {
  const existing = document.cameras.find((camera) => camera.cameraName === cameraName);
  if (existing !== undefined) {
    return existing;
  }
  const nextCamera: RoiCameraConfig = {
    baseLocations: [],
    cameraName,
  };
  document.cameras.push(nextCamera);
  return nextCamera;
};

export const DeviceRoiPage = () => {
  const roi = useRoiConfig();
  const viewer = useLiveViewer();
  const enabledCameras = useMemo(
    () => (viewer.deviceStatus?.cameras ?? []).filter((camera) => camera.enabled),
    [viewer.deviceStatus?.cameras],
  );
  const enabledCameraNames = useMemo(
    () => enabledCameras.map((camera) => camera.name),
    [enabledCameras],
  );
  const [selectedCameraInput, setSelectedCameraInput] = useState('');
  const [selectedBaseIdInput, setSelectedBaseIdInput] = useState<string | null>(null);
  const [selectedRoiIdInput, setSelectedRoiIdInput] = useState<string | null>(null);
  const [baseEditor, setBaseEditor] = useState<BaseEditorState>({
    baseId: null,
    name: '',
  });
  const [roiEditor, setRoiEditor] = useState<RoiEditorState>(defaultRoiEditorState);
  const [draftBounds, setDraftBounds] = useState<RoiBounds | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const selectedCameraName =
    selectedCameraInput !== '' && enabledCameraNames.includes(selectedCameraInput)
      ? selectedCameraInput
      : (enabledCameras[0]?.name ?? '');
  const ptz = usePtzController(selectedCameraName);

  const currentDocument = roi.document ?? {
    cameras: [],
    version: DEFAULT_DOCUMENT_VERSION,
  };
  const currentCameraConfig =
    currentDocument.cameras.find((camera) => camera.cameraName === selectedCameraName) ?? null;
  const baseLocations = currentCameraConfig?.baseLocations ?? [];
  const selectedBase =
    baseLocations.find((baseLocation) => baseLocation.id === selectedBaseIdInput) ??
    baseLocations[0] ??
    null;
  const selectedRoi =
    selectedBase?.rois.find((roiBox) => roiBox.id === selectedRoiIdInput) ??
    selectedBase?.rois[0] ??
    null;
  let baseNameDraft = '';
  if (selectedBase !== null) {
    baseNameDraft = baseEditor.baseId === selectedBase.id ? baseEditor.name : selectedBase.name;
  } else if (baseEditor.baseId === null) {
    baseNameDraft = baseEditor.name;
  }

  let activeRoiEditor = defaultRoiEditorState();
  if (selectedRoi !== null) {
    if (roiEditor.roiId === selectedRoi.id) {
      activeRoiEditor = roiEditor;
    } else {
      activeRoiEditor = {
        active: selectedRoi.active,
        color: selectedRoi.color ?? ROI_DEFAULT_COLOR,
        name: selectedRoi.name,
        roiId: selectedRoi.id,
      };
    }
  } else if (roiEditor.roiId === null) {
    activeRoiEditor = roiEditor;
  }
  const boundsDraft = draftBounds ?? selectedRoi?.bounds ?? null;
  const streamIsActive =
    viewer.connectionState === 'starting' || viewer.connectionState === 'streaming';
  const statusClasses = getServiceStatusClasses(roi.statusLabel);
  const hasSelectedBase = selectedBase !== null;
  const hasSelectedRoi = selectedRoi !== null;
  const hasBoundsDraft = boundsDraft !== null;
  const selectedCameraLabel = selectedCameraName !== '' ? selectedCameraName : 'Select a camera';
  const hasBaseLocations = baseLocations.length > 0;
  const hasRois = selectedBase !== null && selectedBase.rois.length > 0;

  const persistDocument = async (
    mutate: (document: RoiDocument) => {
      document: RoiDocument;
      nextBaseId?: string | null;
      nextRoiId?: string | null;
    },
  ) => {
    if (selectedCameraName === '') {
      return;
    }
    const nextDocument = cloneDocument(currentDocument);
    const mutation = mutate(nextDocument);
    const savedDocument = await roi.saveDocument(mutation.document);
    if (savedDocument === null) {
      return;
    }
    setEditorError(null);
    if (mutation.nextBaseId !== undefined) {
      setSelectedBaseIdInput(mutation.nextBaseId);
    }
    if (mutation.nextRoiId !== undefined) {
      setSelectedRoiIdInput(mutation.nextRoiId);
    }
  };

  const handleStartLive = () => {
    if (selectedCameraName === '') {
      return;
    }
    viewer.startLive({
      cameraNames: [selectedCameraName],
      frameSource: ROI_FRAME_SOURCE,
      mode: 'single',
    });
  };

  const handleCaptureBase = async () => {
    if (selectedCameraName === '' || ptz.position === null) {
      setEditorError('Move the PTZ camera first so the current position can be captured.');
      return;
    }
    const nextBaseId = createId('base');
    const trimmedBaseName = baseNameDraft.trim();
    const nextBaseName =
      trimmedBaseName !== '' ? trimmedBaseName : `Base ${baseLocations.length + 1}`;
    await persistDocument((document) => {
      const camera = ensureCameraConfig(document, selectedCameraName);
      camera.baseLocations.push({
        active: true,
        id: nextBaseId,
        name: nextBaseName,
        ptz: {
          pan: ptz.position?.pan ?? 0,
          tilt: ptz.position?.tilt ?? 0,
          zoom: ptz.position?.zoom ?? 0,
        },
        rois: [],
      });
      return {
        document,
        nextBaseId,
        nextRoiId: null,
      };
    });
    setBaseEditor({
      baseId: nextBaseId,
      name: nextBaseName,
    });
    setRoiEditor(defaultRoiEditorState());
  };

  const handleUpdateBasePosition = async () => {
    if (!hasSelectedBase || ptz.position === null) {
      setEditorError('Select a base location and refresh PTZ position first.');
      return;
    }
    await persistDocument((document) => {
      const camera = ensureCameraConfig(document, selectedCameraName);
      const base = camera.baseLocations.find((item) => item.id === selectedBase.id);
      if (base !== undefined) {
        base.ptz = {
          pan: ptz.position?.pan ?? base.ptz.pan,
          tilt: ptz.position?.tilt ?? base.ptz.tilt,
          zoom: ptz.position?.zoom ?? base.ptz.zoom,
        };
      }
      return {
        document,
        nextBaseId: selectedBase.id,
        nextRoiId: selectedRoiIdInput,
      };
    });
  };

  const handleRenameBase = async () => {
    if (!hasSelectedBase) {
      return;
    }
    const nextName = baseNameDraft.trim();
    if (nextName === '') {
      setEditorError('Base location name cannot be empty.');
      return;
    }
    await persistDocument((document) => {
      const camera = ensureCameraConfig(document, selectedCameraName);
      const base = camera.baseLocations.find((item) => item.id === selectedBase.id);
      if (base !== undefined) {
        base.name = nextName;
      }
      return {
        document,
        nextBaseId: selectedBase.id,
        nextRoiId: selectedRoiIdInput,
      };
    });
    setBaseEditor({
      baseId: selectedBase.id,
      name: nextName,
    });
  };

  const handleDeleteBase = async () => {
    if (!hasSelectedBase) {
      return;
    }
    await persistDocument((document) => {
      const camera = ensureCameraConfig(document, selectedCameraName);
      camera.baseLocations = camera.baseLocations.filter((item) => item.id !== selectedBase.id);
      return {
        document,
        nextBaseId: camera.baseLocations[0]?.id ?? null,
        nextRoiId: null,
      };
    });
    setDraftBounds(null);
    setBaseEditor({
      baseId: null,
      name: '',
    });
    setRoiEditor(defaultRoiEditorState());
  };

  const handleGoToBase = () => {
    if (!hasSelectedBase) {
      return;
    }
    ptz.setPosition(selectedBase.ptz);
  };

  const handleCreateOrUpdateRoi = async () => {
    if (!hasSelectedBase || !hasBoundsDraft) {
      setEditorError('Draw a ROI box on the live frame before saving it.');
      return;
    }
    const trimmedName = activeRoiEditor.name.trim();
    if (trimmedName === '') {
      setEditorError('ROI name cannot be empty.');
      return;
    }

    await persistDocument((document) => {
      const camera = ensureCameraConfig(document, selectedCameraName);
      const base = camera.baseLocations.find((item) => item.id === selectedBase.id);
      if (base === undefined) {
        return { document, nextBaseId: selectedBase.id, nextRoiId: selectedRoiIdInput };
      }

      const nextRoi: RoiBoxSpec = {
        active: activeRoiEditor.active,
        bounds: boundsDraft,
        color: activeRoiEditor.color.trim() !== '' ? activeRoiEditor.color : ROI_DEFAULT_COLOR,
        id: selectedRoi?.id ?? createId('roi'),
        name: trimmedName,
      };
      const existingIndex = base.rois.findIndex((item) => item.id === nextRoi.id);
      if (existingIndex >= 0) {
        base.rois[existingIndex] = nextRoi;
      } else {
        base.rois.push(nextRoi);
      }

      return {
        document,
        nextBaseId: selectedBase.id,
        nextRoiId: nextRoi.id,
      };
    });
    setRoiEditor({
      active: activeRoiEditor.active,
      color: activeRoiEditor.color.trim() !== '' ? activeRoiEditor.color : ROI_DEFAULT_COLOR,
      name: trimmedName,
      roiId: selectedRoi?.id ?? activeRoiEditor.roiId,
    });
  };

  const handleDeleteRoi = async () => {
    if (!hasSelectedBase || !hasSelectedRoi) {
      return;
    }
    await persistDocument((document) => {
      const camera = ensureCameraConfig(document, selectedCameraName);
      const base = camera.baseLocations.find((item) => item.id === selectedBase.id);
      if (base !== undefined) {
        base.rois = base.rois.filter((item) => item.id !== selectedRoi.id);
      }
      return {
        document,
        nextBaseId: selectedBase.id,
        nextRoiId: base?.rois[0]?.id ?? null,
      };
    });
    setDraftBounds(null);
    setRoiEditor(defaultRoiEditorState());
  };

  return (
    <section className="space-y-5">
      <Card className="border">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">ROI configurator</CardTitle>
              <CardDescription>
                Define PTZ base locations and camera-specific ROI boxes directly against the device.
              </CardDescription>
            </div>
            <div
              className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] tracking-[0.2em] uppercase ${statusClasses}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {roi.statusLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Config file
            </div>
            <div className="mt-1 text-sm font-medium break-all">{roi.filePath ?? 'N/A'}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Cameras
            </div>
            <div className="mt-1 text-sm font-medium">{roi.summary?.cameraCount ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Bases
            </div>
            <div className="mt-1 text-sm font-medium">{roi.summary?.baseLocationCount ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              ROIs
            </div>
            <div className="mt-1 text-sm font-medium">{roi.summary?.roiBoxCount ?? 0}</div>
          </div>
        </CardContent>
      </Card>

      {!roi.serviceRegistered ? (
        <div className="text-muted-foreground border border-dashed px-4 py-3 text-sm">
          ROI config service is not registered on this device yet.
        </div>
      ) : null}

      {roi.error !== null || editorError !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
          {editorError ?? roi.error}
        </div>
      ) : null}

      <section className="grid items-start gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="border">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Live ROI canvas</CardTitle>
                <CardDescription>
                  Start a single-camera live view, then drag on the frame to define ROI bounds.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={selectedCameraName === '' || roi.isBusy}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void roi.refresh();
                  }}
                >
                  Reload config
                </Button>
                <Button
                  disabled={selectedCameraName === '' || streamIsActive}
                  type="button"
                  variant="outline"
                  onClick={handleStartLive}
                >
                  Start live
                </Button>
                <Button
                  disabled={!streamIsActive}
                  type="button"
                  variant="outline"
                  onClick={viewer.stopLive}
                >
                  Stop live
                </Button>
                <Button
                  disabled={selectedCameraName === ''}
                  type="button"
                  variant="outline"
                  onClick={viewer.refreshStatus}
                >
                  Refresh device
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <RoiVideoEditor
              isActive={streamIsActive}
              overlay={{
                activeRoiId: selectedRoiIdInput,
                draftBounds,
                onDraftBoundsChange: setDraftBounds,
                onSelectRoi: setSelectedRoiIdInput,
                rois: selectedBase?.rois ?? [],
              }}
              viewer={viewer}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Target camera
                </div>
                <div className="mt-1 text-sm font-medium">{selectedCameraLabel}</div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Current PTZ
                </div>
                <div className="mt-1 text-sm font-medium">
                  {ptz.position !== null
                    ? `P ${ptz.position.pan.toFixed(2)} · T ${ptz.position.tilt.toFixed(2)} · Z ${ptz.position.zoom.toFixed(2)}`
                    : 'No PTZ sample yet'}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Last refresh
                </div>
                <div className="mt-1 text-sm font-medium">
                  {roi.lastRefreshedAt !== null
                    ? new Date(roi.lastRefreshedAt).toLocaleString()
                    : 'N/A'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <PtzControlPanel controller={ptz} />
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <CameraInventoryCard
          cameras={enabledCameras}
          currentCamera={selectedCameraName}
          onSelectCamera={(cameraName) => {
            setSelectedCameraInput(cameraName);
            setSelectedBaseIdInput(null);
            setSelectedRoiIdInput(null);
            setDraftBounds(null);
            setBaseEditor({
              baseId: null,
              name: '',
            });
            setRoiEditor(defaultRoiEditorState());
          }}
        />

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Base locations</CardTitle>
              <CardDescription>
                Capture PTZ anchors for the selected camera and jump back to them when editing ROIs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="base-name">Base name</Label>
                <Input
                  id="base-name"
                  placeholder="North entrance"
                  value={baseNameDraft}
                  onChange={(event) => {
                    setBaseEditor({
                      baseId: selectedBase?.id ?? null,
                      name: event.target.value,
                    });
                  }}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  disabled={ptz.position === null || roi.isBusy}
                  type="button"
                  onClick={() => {
                    void handleCaptureBase();
                  }}
                >
                  Capture current PTZ
                </Button>
                <Button
                  disabled={!hasSelectedBase || ptz.position === null || roi.isBusy}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleUpdateBasePosition();
                  }}
                >
                  Update from current PTZ
                </Button>
                <Button
                  disabled={!hasSelectedBase || roi.isBusy}
                  type="button"
                  variant="outline"
                  onClick={handleGoToBase}
                >
                  Go to selected base
                </Button>
                <Button
                  disabled={!hasSelectedBase || roi.isBusy}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleRenameBase();
                  }}
                >
                  Rename selected base
                </Button>
                <Button
                  disabled={!hasSelectedBase || roi.isBusy}
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    void handleDeleteBase();
                  }}
                >
                  Delete selected base
                </Button>
                <Button
                  disabled={selectedCameraName === ''}
                  type="button"
                  variant="outline"
                  onClick={ptz.refreshPosition}
                >
                  Refresh PTZ sample
                </Button>
              </div>

              <div className="space-y-2">
                {hasBaseLocations ? (
                  baseLocations.map((baseLocation) => (
                    <button
                      key={baseLocation.id}
                      className={`border px-4 py-3 text-left transition ${
                        selectedBase?.id === baseLocation.id
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50'
                      }`}
                      type="button"
                      onClick={() => {
                        setSelectedBaseIdInput(baseLocation.id);
                        setSelectedRoiIdInput(baseLocation.rois[0]?.id ?? null);
                        setDraftBounds(null);
                        setBaseEditor({
                          baseId: baseLocation.id,
                          name: baseLocation.name,
                        });
                        setRoiEditor(defaultRoiEditorState());
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{baseLocation.name}</span>
                        <span className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                          {baseLocation.active ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-2 text-xs">
                        P {baseLocation.ptz.pan.toFixed(2)} · T {baseLocation.ptz.tilt.toFixed(2)} ·
                        Z {baseLocation.ptz.zoom.toFixed(2)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-muted-foreground border border-dashed px-4 py-4 text-sm">
                    Capture the current PTZ position to create the first base location for this
                    camera.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border">
            <CardHeader className="border-b">
              <CardTitle className="text-base">ROIs</CardTitle>
              <CardDescription>
                Draw a box on the frame, then store it against the selected base location.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="roi-name">ROI name</Label>
                <Input
                  id="roi-name"
                  placeholder="Loading bay"
                  value={activeRoiEditor.name}
                  onChange={(event) => {
                    setRoiEditor({
                      ...activeRoiEditor,
                      name: event.target.value,
                    });
                  }}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="roi-color">Color</Label>
                  <Input
                    id="roi-color"
                    placeholder="#22c55e"
                    value={activeRoiEditor.color}
                    onChange={(event) => {
                      setRoiEditor({
                        ...activeRoiEditor,
                        color: event.target.value,
                      });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Active</Label>
                  <div className="flex h-10 items-center border px-3">
                    <Checkbox
                      checked={activeRoiEditor.active}
                      onCheckedChange={(checked) => {
                        setRoiEditor({
                          ...activeRoiEditor,
                          active: checked === true,
                        });
                      }}
                    />
                    <span className="ml-3 text-sm">ROI is enabled for this base location</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="roi-x">X (%)</Label>
                  <Input
                    id="roi-x"
                    type="number"
                    value={hasBoundsDraft ? percentValue(boundsDraft.x) : EMPTY_PERCENT_INPUT}
                    onChange={(event) => {
                      const next = boundsDraft ?? { x: 0, y: 0, width: 0.2, height: 0.2 };
                      setDraftBounds({
                        ...next,
                        x: percentToNormalized(event.target.value),
                      });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roi-y">Y (%)</Label>
                  <Input
                    id="roi-y"
                    type="number"
                    value={hasBoundsDraft ? percentValue(boundsDraft.y) : EMPTY_PERCENT_INPUT}
                    onChange={(event) => {
                      const next = boundsDraft ?? { x: 0, y: 0, width: 0.2, height: 0.2 };
                      setDraftBounds({
                        ...next,
                        y: percentToNormalized(event.target.value),
                      });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roi-width">Width (%)</Label>
                  <Input
                    id="roi-width"
                    type="number"
                    value={hasBoundsDraft ? percentValue(boundsDraft.width) : EMPTY_PERCENT_INPUT}
                    onChange={(event) => {
                      const next = boundsDraft ?? { x: 0, y: 0, width: 0.2, height: 0.2 };
                      setDraftBounds({
                        ...next,
                        width: percentToNormalized(event.target.value),
                      });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roi-height">Height (%)</Label>
                  <Input
                    id="roi-height"
                    type="number"
                    value={hasBoundsDraft ? percentValue(boundsDraft.height) : EMPTY_PERCENT_INPUT}
                    onChange={(event) => {
                      const next = boundsDraft ?? { x: 0, y: 0, width: 0.2, height: 0.2 };
                      setDraftBounds({
                        ...next,
                        height: percentToNormalized(event.target.value),
                      });
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  disabled={!hasSelectedBase || !hasBoundsDraft || roi.isBusy}
                  type="button"
                  onClick={() => {
                    void handleCreateOrUpdateRoi();
                  }}
                >
                  {hasSelectedRoi ? 'Save ROI' : 'Create ROI'}
                </Button>
                <Button
                  disabled={!hasSelectedRoi || roi.isBusy}
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    void handleDeleteRoi();
                  }}
                >
                  Delete selected ROI
                </Button>
                <Button
                  disabled={!hasSelectedRoi && !hasBoundsDraft}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedRoiIdInput(null);
                    setDraftBounds(null);
                    setRoiEditor(defaultRoiEditorState());
                  }}
                >
                  Clear selection
                </Button>
              </div>

              <div className="space-y-2">
                {hasRois ? (
                  selectedBase.rois.map((roiBox) => (
                    <button
                      key={roiBox.id}
                      className={`border px-4 py-3 text-left transition ${
                        selectedRoi?.id === roiBox.id
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50'
                      }`}
                      type="button"
                      onClick={() => {
                        setSelectedRoiIdInput(roiBox.id);
                        setDraftBounds(roiBox.bounds);
                        setRoiEditor({
                          active: roiBox.active,
                          color: roiBox.color ?? ROI_DEFAULT_COLOR,
                          name: roiBox.name,
                          roiId: roiBox.id,
                        });
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{roiBox.name}</span>
                        <span className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                          {roiBox.active ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-2 text-xs">
                        X {percentValue(roiBox.bounds.x)} · Y {percentValue(roiBox.bounds.y)} · W{' '}
                        {percentValue(roiBox.bounds.width)} · H {percentValue(roiBox.bounds.height)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-muted-foreground border border-dashed px-4 py-4 text-sm">
                    Draw a box on the frame and save it to create the first ROI for this base
                    location.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </section>
  );
};
