'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { audio_managerContract } from '@trakrai/live-transport/generated-contracts/audio_manager';
import {
  useDeviceServiceQuery,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  AUTO_REFRESH_MS,
  DEFAULT_JOB_LIMIT,
  DEFAULT_SERVICE_NAME,
  JOB_LIMIT_OPTIONS,
  JOB_STATE_FILTERS,
  formatJobLabel,
  formatTimestamp,
  matchesJobSearch,
  matchesJobState,
  readRequestErrorMessage,
} from './audio-manager-utils';

import type { AudioJobStateFilter, AudioManagerJob, AudioManagerListPayload } from '../types';

export type AudioManagerJobBrowserProps = Readonly<{
  onSelectJob?: (jobId: string) => void;
  refreshKey?: number;
  selectedJobId?: string | null;
  serviceName?: string;
}>;

export const AudioManagerJobBrowser = ({
  onSelectJob,
  refreshKey = 0,
  selectedJobId = null,
  serviceName = DEFAULT_SERVICE_NAME,
}: AudioManagerJobBrowserProps) => {
  const normalizedServiceName = serviceName.trim();
  const audioService = useTypedDeviceService(audio_managerContract, {
    serviceName: normalizedServiceName,
  });
  const { transportState } = useLiveTransport();
  const [limit, setLimit] = useState<number>(DEFAULT_JOB_LIMIT);
  const [searchText, setSearchText] = useState('');
  const [stateFilter, setStateFilter] = useState<AudioJobStateFilter>('all');
  const jobsQuery = useDeviceServiceQuery(
    audioService,
    'list-jobs',
    { limit },
    {
      enabled: normalizedServiceName !== '',
      refetchInterval: transportState === 'connected' ? AUTO_REFRESH_MS : false,
      refetchIntervalInBackground: true,
    },
  );

  useEffect(() => {
    if (refreshKey === 0) {
      return;
    }

    void jobsQuery.refetch();
  }, [jobsQuery, refreshKey]);

  const error = jobsQuery.error !== null ? readRequestErrorMessage(jobsQuery.error) : null;
  const isBusy = jobsQuery.isFetching;
  const payload = (jobsQuery.data ?? null) as AudioManagerListPayload | null;
  const lastRefreshedAt =
    jobsQuery.dataUpdatedAt > 0 ? new Date(jobsQuery.dataUpdatedAt).toISOString() : null;
  const filteredJobs = useMemo(() => {
    const jobs = payload?.jobs ?? [];
    return jobs.filter(
      (job) => matchesJobState(job, stateFilter) && matchesJobSearch(job, searchText),
    );
  }, [payload, searchText, stateFilter]);

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Recent audio jobs</CardTitle>
            <CardDescription>
              Poll the device queue, filter recent jobs, and load the latest stored job record.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="border-input bg-background h-9 border px-3 text-sm"
              value={String(limit)}
              onChange={(event) => {
                setLimit(Number(event.target.value));
              }}
            >
              {JOB_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option}
                </option>
              ))}
            </select>
            <select
              className="border-input bg-background h-9 border px-3 text-sm"
              value={stateFilter}
              onChange={(event) => {
                setStateFilter(event.target.value as AudioJobStateFilter);
              }}
            >
              {JOB_STATE_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button
              disabled={isBusy || transportState !== 'connected'}
              type="button"
              variant="outline"
              onClick={() => void jobsQuery.refetch()}
            >
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            placeholder="Search by request ID, camera, message text, or speaker fields"
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value);
            }}
          />
          <div className="text-muted-foreground self-center text-xs">
            Last refresh: {isBusy ? 'Refreshing...' : formatTimestamp(lastRefreshedAt)}
          </div>
        </div>

        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        <div className="space-y-2">
          {filteredJobs.length > 0 ? (
            filteredJobs.map((job: AudioManagerJob) => {
              const requestLabel = job.requestId.trim() !== '' ? job.requestId : 'N/A';
              let cameraLabel = 'N/A';
              if (job.cameraName.trim() !== '') {
                cameraLabel = job.cameraName;
              } else if (job.cameraId.trim() !== '') {
                cameraLabel = job.cameraId;
              }

              return (
                <button
                  key={job.id}
                  className={`w-full border px-4 py-3 text-left transition ${
                    selectedJobId === job.id
                      ? 'border-primary/40 bg-primary/10'
                      : 'hover:bg-muted/40'
                  }`}
                  type="button"
                  onClick={() => {
                    onSelectJob?.(job.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium break-all">{job.text}</div>
                      <div className="text-muted-foreground mt-1 text-xs break-all">
                        Request {requestLabel} · Camera {cameraLabel}
                      </div>
                      <div className="text-muted-foreground mt-2 text-[11px] tracking-[0.18em] uppercase">
                        {formatJobLabel(job)}
                      </div>
                    </div>
                    <div className="text-right text-[11px]">
                      <div>{formatTimestamp(job.updatedAt)}</div>
                      <div className="text-muted-foreground mt-1">{job.id}</div>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="text-muted-foreground border px-4 py-3 text-sm">
              No audio jobs match the current filters.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
