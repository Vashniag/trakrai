'use client';

import { AudioManagerPanel } from '@trakrai/audio-manager-ui/components/audio-manager-panel';

export type DeviceAudioManagerPageProps = Readonly<{
  serviceName?: string;
}>;

export const DeviceAudioManagerPage = ({
  serviceName = 'audio-manager',
}: DeviceAudioManagerPageProps) => <AudioManagerPanel serviceName={serviceName} />;
