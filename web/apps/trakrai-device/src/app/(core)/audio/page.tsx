'use client';

import { AudioManagerPanel } from '@trakrai/audio-manager-ui/components/audio-manager-panel';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const AudioPage = () => (
  <EdgeConsoleSurface
    description="Text-to-speech queue management, playback inspection, and speaker delivery diagnostics through the on-device audio manager."
    title="Audio manager"
  >
    {() => <AudioManagerPanel serviceName="audio-manager" />}
  </EdgeConsoleSurface>
);

export default AudioPage;
