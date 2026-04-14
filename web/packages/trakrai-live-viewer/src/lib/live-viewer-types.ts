'use client';

export type LiveLayoutMode = 'single' | 'grid-4' | 'grid-9' | 'focus-8' | 'grid-16';
export type LiveFrameSource = 'raw' | 'processed';

export type LiveLayoutSelection = {
  cameraNames: string[];
  frameSource: LiveFrameSource;
  mode: LiveLayoutMode;
};
