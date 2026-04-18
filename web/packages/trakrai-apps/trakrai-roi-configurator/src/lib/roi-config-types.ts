'use client';

export type RoiBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type RoiBoxSpec = {
  active: boolean;
  bounds: RoiBounds;
  color?: string;
  id: string;
  name: string;
  tags?: string[];
};

export type RoiBaseLocation = {
  active: boolean;
  id: string;
  name: string;
  ptz: {
    pan: number;
    tilt: number;
    zoom: number;
  };
  rois: RoiBoxSpec[];
};

export type RoiCameraConfig = {
  baseLocations: RoiBaseLocation[];
  cameraName: string;
};

export type RoiDocument = {
  cameras: RoiCameraConfig[];
  updatedAt?: string;
  version: number;
};

export type RoiStatusSummary = {
  baseLocationCount: number;
  cameraCount: number;
  documentHash: string;
  filePath: string;
  roiBoxCount: number;
  updatedAt?: string;
};

export type RoiDocumentPayload = RoiStatusSummary & {
  document: RoiDocument;
  requestId?: string;
};

export type RoiConfigControllerState = {
  document: RoiDocument | null;
  error: string | null;
  filePath: string | null;
  isBusy: boolean;
  lastRefreshedAt: string | null;
  refresh: () => Promise<RoiDocument | null>;
  saveDocument: (document: RoiDocument) => Promise<RoiDocument | null>;
  serviceRegistered: boolean;
  statusLabel: string;
  summary: RoiStatusSummary | null;
};
