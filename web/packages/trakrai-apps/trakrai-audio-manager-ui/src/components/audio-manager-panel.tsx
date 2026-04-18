'use client';

import { useState } from 'react';

import { AudioManagerJobBrowser } from './audio-manager-job-browser';
import { AudioManagerSelectedJobCard } from './audio-manager-selected-job-card';
import { AudioManagerStatusCard } from './audio-manager-status-card';
import { DEFAULT_SERVICE_NAME } from './audio-manager-utils';
import { PlayAudioCard } from './play-audio-card';

type AudioManagerPanelProps = Readonly<{
  serviceName?: string;
}>;

export const AudioManagerPanel = ({
  serviceName = DEFAULT_SERVICE_NAME,
}: AudioManagerPanelProps) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const handleQueued = (jobId: string) => {
    setSelectedJobId(jobId);
    setRefreshKey((current) => current + 1);
  };

  return (
    <section className="space-y-5">
      <AudioManagerStatusCard refreshKey={refreshKey} serviceName={serviceName} />

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <PlayAudioCard
          serviceName={serviceName}
          onQueued={(job) => {
            handleQueued(job.id);
          }}
        />
        <AudioManagerSelectedJobCard
          jobId={selectedJobId}
          refreshKey={refreshKey}
          serviceName={serviceName}
        />
      </div>

      <AudioManagerJobBrowser
        refreshKey={refreshKey}
        selectedJobId={selectedJobId}
        serviceName={serviceName}
        onSelectJob={setSelectedJobId}
      />
    </section>
  );
};
