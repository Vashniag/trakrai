'use client';

import { useMemo, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { getServiceStatusClasses } from '@trakrai/live-transport/lib/live-display-utils';

import type { CloudTransferControllerState } from '../hooks/use-cloud-transfer';
import type {
  CloudTransferFilter,
  CloudTransferItem,
  TransferDirection,
  TransferState,
} from '../lib/cloud-transfer-types';

const FILTER_DIRECTIONS: ReadonlyArray<TransferDirection | 'all'> = ['all', 'upload', 'download'];
const FILTER_STATES: ReadonlyArray<TransferState | 'all'> = [
  'all',
  'queued',
  'running',
  'retry_wait',
  'completed',
  'failed',
];

const formatTimestamp = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.trim() === '') {
    return 'N/A';
  }

  return new Date(value).toLocaleString();
};

const formatTransferLabel = (transfer: CloudTransferItem): string =>
  `${transfer.direction} · ${transfer.state} · attempts ${transfer.attempts}`;

const parseMetadata = (value: string): Record<string, string> | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Metadata must be a JSON object.');
  }

  const metadata = Object.entries(parsed).reduce<Record<string, string>>((result, [key, entry]) => {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
    return result;
  }, {});

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const normalizeOptionalInput = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

type CloudTransferPanelProps = Readonly<{
  controller: CloudTransferControllerState;
}>;

export const CloudTransferPanel = ({ controller }: CloudTransferPanelProps) => {
  const {
    activeTransfer,
    enqueueDownload,
    enqueueUpload,
    error,
    filter,
    isBusy,
    lastRefreshedAt,
    loadTransfer,
    refresh,
    serviceRegistered,
    sharedDir,
    stats,
    statusLabel,
    transfers,
    updateFilter,
  } = controller;
  const [uploadDraft, setUploadDraft] = useState({
    contentType: '',
    localPath: '',
    metadata: '',
    remotePath: '',
    timeout: '',
  });
  const [downloadDraft, setDownloadDraft] = useState({
    localPath: '',
    metadata: '',
    remotePath: '',
    timeout: '',
  });
  const [editorError, setEditorError] = useState<string | null>(null);

  const statusClasses = getServiceStatusClasses(statusLabel);
  const selectedTransferText = useMemo(
    () => (activeTransfer === null ? '' : JSON.stringify(activeTransfer, null, 2)),
    [activeTransfer],
  );

  const handleUploadSubmit = async () => {
    try {
      setEditorError(null);
      await enqueueUpload({
        contentType: normalizeOptionalInput(uploadDraft.contentType),
        localPath: uploadDraft.localPath.trim(),
        metadata: parseMetadata(uploadDraft.metadata),
        remotePath: uploadDraft.remotePath.trim(),
        timeout: normalizeOptionalInput(uploadDraft.timeout),
      });
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : 'Invalid upload request');
    }
  };

  const handleDownloadSubmit = async () => {
    try {
      setEditorError(null);
      await enqueueDownload({
        localPath: downloadDraft.localPath.trim(),
        metadata: parseMetadata(downloadDraft.metadata),
        remotePath: downloadDraft.remotePath.trim(),
        timeout: normalizeOptionalInput(downloadDraft.timeout),
      });
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : 'Invalid download request');
    }
  };

  const handleFilterChange = (patch: Partial<CloudTransferFilter>) => {
    const nextFilter = {
      ...filter,
      ...patch,
    };
    updateFilter(nextFilter);
    void refresh(nextFilter);
  };

  return (
    <section className="space-y-5">
      <Card className="border">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Cloud transfer queue</CardTitle>
              <CardDescription>
                Enqueue uploads and downloads against the device-side transfer service.
              </CardDescription>
            </div>
            <div
              className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] tracking-[0.2em] uppercase ${statusClasses}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {statusLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Shared directory
              </div>
              <div className="mt-1 text-sm font-medium break-all">{sharedDir ?? 'N/A'}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Pending
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.pending ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Running
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.running ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Last refresh
              </div>
              <div className="mt-1 text-sm font-medium">{formatTimestamp(lastRefreshedAt)}</div>
            </div>
          </div>

          {!serviceRegistered ? (
            <div className="text-muted-foreground border border-dashed px-4 py-3 text-sm">
              Cloud transfer service is not registered on this device yet.
            </div>
          ) : null}

          {error !== null || editorError !== null ? (
            <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
              {editorError ?? error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Queue upload</CardTitle>
            <CardDescription>
              Provide a shared-directory file and the remote object path.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="upload-local-path">Local path</Label>
              <Input
                id="upload-local-path"
                value={uploadDraft.localPath}
                onChange={(event) => {
                  setUploadDraft((current) => ({ ...current, localPath: event.target.value }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-remote-path">Remote path</Label>
              <Input
                id="upload-remote-path"
                value={uploadDraft.remotePath}
                onChange={(event) => {
                  setUploadDraft((current) => ({ ...current, remotePath: event.target.value }));
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="upload-content-type">Content type</Label>
                <Input
                  id="upload-content-type"
                  value={uploadDraft.contentType}
                  onChange={(event) => {
                    setUploadDraft((current) => ({ ...current, contentType: event.target.value }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="upload-timeout">Timeout</Label>
                <Input
                  id="upload-timeout"
                  placeholder="4h"
                  value={uploadDraft.timeout}
                  onChange={(event) => {
                    setUploadDraft((current) => ({ ...current, timeout: event.target.value }));
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-metadata">Metadata JSON</Label>
              <textarea
                className="border-input bg-background min-h-28 w-full border px-3 py-2 text-sm"
                id="upload-metadata"
                value={uploadDraft.metadata}
                onChange={(event) => {
                  setUploadDraft((current) => ({ ...current, metadata: event.target.value }));
                }}
              />
            </div>
            <Button disabled={isBusy} type="button" onClick={() => void handleUploadSubmit()}>
              Queue upload
            </Button>
          </CardContent>
        </Card>

        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Queue download</CardTitle>
            <CardDescription>
              Request a device-side download into the shared directory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="download-local-path">Local path</Label>
              <Input
                id="download-local-path"
                value={downloadDraft.localPath}
                onChange={(event) => {
                  setDownloadDraft((current) => ({ ...current, localPath: event.target.value }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-remote-path">Remote path</Label>
              <Input
                id="download-remote-path"
                value={downloadDraft.remotePath}
                onChange={(event) => {
                  setDownloadDraft((current) => ({ ...current, remotePath: event.target.value }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-timeout">Timeout</Label>
              <Input
                id="download-timeout"
                placeholder="1d"
                value={downloadDraft.timeout}
                onChange={(event) => {
                  setDownloadDraft((current) => ({ ...current, timeout: event.target.value }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-metadata">Metadata JSON</Label>
              <textarea
                className="border-input bg-background min-h-28 w-full border px-3 py-2 text-sm"
                id="download-metadata"
                value={downloadDraft.metadata}
                onChange={(event) => {
                  setDownloadDraft((current) => ({ ...current, metadata: event.target.value }));
                }}
              />
            </div>
            <Button disabled={isBusy} type="button" onClick={() => void handleDownloadSubmit()}>
              Queue download
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Recent transfers</CardTitle>
              <CardDescription>
                Inspect current queue state and load detailed transfer records.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="border-input bg-background h-9 border px-3 text-sm"
                value={filter.direction ?? 'all'}
                onChange={(event) => {
                  handleFilterChange({
                    direction: event.target.value as TransferDirection | 'all',
                  });
                }}
              >
                {FILTER_DIRECTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="border-input bg-background h-9 border px-3 text-sm"
                value={filter.state ?? 'all'}
                onChange={(event) => {
                  handleFilterChange({
                    state: event.target.value as TransferState | 'all',
                  });
                }}
              >
                {FILTER_STATES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <Button
                disabled={isBusy}
                type="button"
                variant="outline"
                onClick={() => void refresh()}
              >
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Total
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.total ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Upload queued
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.uploadQueued ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Download queued
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.downloadQueued ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Uploads completed
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.uploadsCompleted ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Downloads completed
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.downloadsCompleted ?? 0}</div>
            </div>
            <div className="border p-3">
              <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                Failed
              </div>
              <div className="mt-1 text-sm font-medium">{stats?.failed ?? 0}</div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-2">
              {transfers.length > 0 ? (
                transfers.map((transfer: CloudTransferItem) => (
                  <button
                    key={transfer.id}
                    className="hover:bg-muted/40 w-full border px-4 py-3 text-left transition"
                    type="button"
                    onClick={() => void loadTransfer(transfer.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium break-all">{transfer.remotePath}</div>
                        <div className="text-muted-foreground mt-1 text-xs break-all">
                          {transfer.localPath}
                        </div>
                        <div className="text-muted-foreground mt-2 text-[11px] tracking-[0.18em] uppercase">
                          {formatTransferLabel(transfer)}
                        </div>
                      </div>
                      <div className="text-right text-[11px]">
                        <div>{formatTimestamp(transfer.updatedAt)}</div>
                        <div className="text-muted-foreground mt-1">{transfer.id}</div>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-muted-foreground border px-4 py-3 text-sm">
                  No transfers match the current filter.
                </div>
              )}
            </div>

            <Card className="border">
              <CardHeader className="border-b">
                <CardTitle className="text-base">Selected transfer</CardTitle>
                <CardDescription>
                  Raw transfer record after querying the device queue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedTransferText !== '' ? (
                  <pre className="bg-muted overflow-x-auto border p-4 text-xs">
                    {selectedTransferText}
                  </pre>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Select a transfer to load its latest device-side record.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
