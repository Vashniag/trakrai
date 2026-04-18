'use client';

import type {
  AudioManager_AudioErrorPayload,
  AudioManager_AudioJob,
  AudioManager_AudioRequest,
  AudioManager_AudioStats,
  AudioManager_GetJob_Output,
  AudioManager_GetStatus_Output,
  AudioManager_ListJobs_Output,
  AudioManager_PlayAudio_Output,
} from '@trakrai/live-transport/generated-contracts/audio_manager';

export type AudioManagerJob = AudioManager_AudioJob;
export type AudioManagerJobPayload = AudioManager_GetJob_Output;
export type AudioManagerListPayload = AudioManager_ListJobs_Output;
export type AudioManagerStatusPayload = AudioManager_GetStatus_Output;
export type AudioManagerPlayAudioInput = AudioManager_AudioRequest;
export type AudioManagerPlayAudioPayload = AudioManager_PlayAudio_Output;
export type AudioManagerStats = AudioManager_AudioStats;
export type AudioManagerErrorPayload = AudioManager_AudioErrorPayload;

export type AudioJobStateFilter =
  | 'all'
  | 'completed'
  | 'deduped'
  | 'failed'
  | 'processing'
  | 'queued';
