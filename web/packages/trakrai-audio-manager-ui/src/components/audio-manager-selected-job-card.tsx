'use client';

import { useEffect } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { audio_managerContract } from '@trakrai/live-transport/generated-contracts/audio_manager';
import {
  useDeviceServiceQuery,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  DEFAULT_SERVICE_NAME,
  formatBooleanLabel,
  formatTimestamp,
  readRequestErrorMessage,
} from './audio-manager-utils';

import type { AudioManagerJob } from '../types';

export type AudioManagerSelectedJobCardProps = Readonly<{
  refreshKey?: number;
  serviceName?: string;
  jobId: string | null;
}>;

export const AudioManagerSelectedJobCard = ({
  refreshKey = 0,
  serviceName = DEFAULT_SERVICE_NAME,
  jobId,
}: AudioManagerSelectedJobCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const audioService = useTypedDeviceService(audio_managerContract, {
    serviceName: normalizedServiceName,
  });
  const { transportState } = useLiveTransport();
  const normalizedJobId = jobId?.trim() ?? '';
  const jobQuery = useDeviceServiceQuery(
    audioService,
    'get-job',
    { jobId: normalizedJobId },
    {
      enabled:
        normalizedServiceName !== '' && transportState === 'connected' && normalizedJobId !== '',
    },
  );

  useEffect(() => {
    if (refreshKey === 0 || normalizedJobId === '') {
      return;
    }

    void jobQuery.refetch();
  }, [jobQuery, normalizedJobId, refreshKey]);

  const error = jobQuery.error !== null ? readRequestErrorMessage(jobQuery.error) : null;
  const isBusy = jobQuery.isFetching;
  const job = (jobQuery.data?.job ?? null) as AudioManagerJob | null;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Selected audio job</CardTitle>
        <CardDescription>
          Inspect the latest stored job payload from the device queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {isBusy ? <div className="text-muted-foreground text-sm">Loading audio job...</div> : null}

        {!isBusy && error === null && job !== null ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  State
                </div>
                <div className="mt-1 text-sm font-medium">{job.state}</div>
                <div className="text-muted-foreground mt-2 text-xs">
                  Local {job.localState} · Speaker {job.speakerState}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Attempts
                </div>
                <div className="mt-1 text-sm font-medium">{job.attempts}</div>
                <div className="text-muted-foreground mt-2 text-xs">
                  Updated {formatTimestamp(job.updatedAt)}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Playback branches
                </div>
                <div className="mt-1 text-sm font-medium">
                  Local {formatBooleanLabel(job.playLocal)}
                </div>
                <div className="text-muted-foreground mt-2 text-xs">
                  Speaker {formatBooleanLabel(job.playSpeaker)}
                </div>
              </div>
              <div className="border p-3">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  Audio path
                </div>
                <div className="mt-1 text-sm font-medium break-all">
                  {job.audioPath.trim() !== '' ? job.audioPath : 'Not generated yet'}
                </div>
              </div>
            </div>

            {job.error.trim() !== '' ? (
              <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
                {job.error}
              </div>
            ) : null}

            <pre className="bg-muted overflow-x-auto border p-4 text-xs">
              {JSON.stringify(job, null, 2)}
            </pre>
          </>
        ) : null}

        {!isBusy && error === null && job === null ? (
          <div className="text-muted-foreground text-sm">
            Select an audio job to load its latest device-side record.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
