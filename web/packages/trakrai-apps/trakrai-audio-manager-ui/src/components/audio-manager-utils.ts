'use client';

import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';

import type { AudioJobStateFilter, AudioManagerJob, AudioManagerPlayAudioInput } from '../types';

export const DEFAULT_SERVICE_NAME = 'audio-manager';
export const AUTO_REFRESH_MS = 5_000;
const LIMIT_TEN = 10;
const LIMIT_TWENTY = 20;
const LIMIT_FIFTY = 50;
const LIMIT_ONE_HUNDRED = 100;
export const JOB_STATE_FILTERS: ReadonlyArray<AudioJobStateFilter> = [
  'all',
  'queued',
  'processing',
  'completed',
  'deduped',
  'failed',
];
export const DEFAULT_JOB_LIMIT = LIMIT_TWENTY;
export const JOB_LIMIT_OPTIONS = [LIMIT_TEN, LIMIT_TWENTY, LIMIT_FIFTY, LIMIT_ONE_HUNDRED] as const;

export const normalizeOptionalInput = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const createEmptyAudioDraft = () => ({
  cameraId: '',
  cameraName: '',
  dedupeKey: '',
  language: 'en',
  playLocal: true,
  playSpeaker: true,
  requestId: '',
  speakerAddress: '',
  speakerCode: '',
  speakerMessageId: '',
  text: '',
});

export const toPlayAudioInput = (
  draft: ReturnType<typeof createEmptyAudioDraft>,
): AudioManagerPlayAudioInput => ({
  cameraId: normalizeOptionalInput(draft.cameraId),
  cameraName: normalizeOptionalInput(draft.cameraName),
  dedupeKey: normalizeOptionalInput(draft.dedupeKey),
  language: normalizeOptionalInput(draft.language),
  playLocal: draft.playLocal,
  playSpeaker: draft.playSpeaker,
  requestId: normalizeOptionalInput(draft.requestId),
  speakerAddress: normalizeOptionalInput(draft.speakerAddress),
  speakerCode: normalizeOptionalInput(draft.speakerCode),
  speakerMessageId: normalizeOptionalInput(draft.speakerMessageId),
  text: draft.text.trim(),
});

export const readRequestErrorMessage = (error: unknown): string => {
  const requestError = isDeviceProtocolRequestError(error) ? error : null;
  if (requestError !== null && requestError.payload !== null) {
    const payload = requestError.payload as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }
  }

  return error instanceof Error ? error.message : 'Audio manager request failed';
};

export const formatTimestamp = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.trim() === '') {
    return 'N/A';
  }

  return new Date(value).toLocaleString();
};

export const formatBooleanLabel = (value: boolean): string => (value ? 'Enabled' : 'Disabled');

export const formatJobLabel = (job: AudioManagerJob): string =>
  `${job.state} · local ${job.localState} · speaker ${job.speakerState}`;

export const matchesJobState = (job: AudioManagerJob, stateFilter: AudioJobStateFilter): boolean =>
  stateFilter === 'all' || job.state === stateFilter;

export const matchesJobSearch = (job: AudioManagerJob, searchText: string): boolean => {
  const normalized = searchText.trim().toLowerCase();
  if (normalized === '') {
    return true;
  }

  return [
    job.id,
    job.requestId,
    job.text,
    job.cameraId,
    job.cameraName,
    job.speakerAddress,
    job.speakerCode,
    job.speakerMessageId,
  ].some((value) => value.toLowerCase().includes(normalized));
};
