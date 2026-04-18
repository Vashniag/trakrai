'use client';

import { DeviceAudioManagerPage } from '@trakrai/live-ui/components/device-audio-manager-page';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const AudioPage = () => (
  <EdgeConsoleSurface
    description="Text-to-speech queue management, playback inspection, and speaker delivery diagnostics through the on-device audio manager."
    title="Audio manager"
  >
    {() => <DeviceAudioManagerPage />}
  </EdgeConsoleSurface>
);

export default AudioPage;
