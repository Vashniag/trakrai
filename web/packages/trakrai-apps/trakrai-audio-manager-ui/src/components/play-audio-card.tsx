'use client';

import { useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Checkbox } from '@trakrai/design-system/components/checkbox';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { audio_managerContract } from '@trakrai/live-transport/generated-contracts/audio_manager';
import {
  useDeviceServiceMutation,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  DEFAULT_SERVICE_NAME,
  createEmptyAudioDraft,
  readRequestErrorMessage,
  toPlayAudioInput,
} from './audio-manager-utils';

import type { AudioManagerJob } from '../types';

export type PlayAudioCardProps = Readonly<{
  onQueued?: (job: AudioManagerJob) => void;
  serviceName?: string;
}>;

export const PlayAudioCard = ({
  onQueued,
  serviceName = DEFAULT_SERVICE_NAME,
}: PlayAudioCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const audioService = useTypedDeviceService(audio_managerContract, {
    serviceName: normalizedServiceName,
  });
  const { appendLog, transportState } = useLiveTransport();
  const [draft, setDraft] = useState(createEmptyAudioDraft);
  const playAudioMutation = useDeviceServiceMutation(audioService, 'play-audio', {
    onSuccess: (payload) => {
      appendLog('info', `Queued audio job ${payload.job.id}`);
      setDraft(createEmptyAudioDraft());
      onQueued?.(payload.job);
      void audioService.invalidateQueries('get-status');
      void audioService.invalidateQueries('list-jobs');
      void audioService.invalidateQueries('get-job', {
        jobId: payload.job.id,
      });
    },
  });

  const handleSubmit = () => {
    if (
      normalizedServiceName === '' ||
      transportState !== 'connected' ||
      draft.text.trim() === ''
    ) {
      return;
    }

    playAudioMutation.reset();
    void playAudioMutation.mutateAsync(toPlayAudioInput(draft));
  };

  const error =
    playAudioMutation.error !== null ? readRequestErrorMessage(playAudioMutation.error) : null;
  const isBusy = playAudioMutation.isPending;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Queue audio job</CardTitle>
        <CardDescription>
          Send a text-to-speech request through the device-side audio manager queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="audio-text">Message text</Label>
          <textarea
            className="border-input bg-background min-h-28 w-full border px-3 py-2 text-sm"
            id="audio-text"
            placeholder="Security alert at camera one."
            value={draft.text}
            onChange={(event) => {
              setDraft((current) => ({ ...current, text: event.target.value }));
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audio-language">Language</Label>
            <Input
              id="audio-language"
              value={draft.language}
              onChange={(event) => {
                setDraft((current) => ({ ...current, language: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-request-id">Request ID</Label>
            <Input
              id="audio-request-id"
              placeholder="Optional caller-provided request ID"
              value={draft.requestId}
              onChange={(event) => {
                setDraft((current) => ({ ...current, requestId: event.target.value }));
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audio-camera-id">Camera ID</Label>
            <Input
              id="audio-camera-id"
              value={draft.cameraId}
              onChange={(event) => {
                setDraft((current) => ({ ...current, cameraId: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-camera-name">Camera name</Label>
            <Input
              id="audio-camera-name"
              value={draft.cameraName}
              onChange={(event) => {
                setDraft((current) => ({ ...current, cameraName: event.target.value }));
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audio-dedupe-key">Dedupe key</Label>
            <Input
              id="audio-dedupe-key"
              placeholder="camera-1-alert"
              value={draft.dedupeKey}
              onChange={(event) => {
                setDraft((current) => ({ ...current, dedupeKey: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-speaker-address">Speaker address</Label>
            <Input
              id="audio-speaker-address"
              placeholder="Optional speaker endpoint override"
              value={draft.speakerAddress}
              onChange={(event) => {
                setDraft((current) => ({ ...current, speakerAddress: event.target.value }));
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audio-speaker-message-id">Speaker message ID</Label>
            <Input
              id="audio-speaker-message-id"
              placeholder="local-alert"
              value={draft.speakerMessageId}
              onChange={(event) => {
                setDraft((current) => ({ ...current, speakerMessageId: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-speaker-code">Speaker code</Label>
            <Input
              id="audio-speaker-code"
              placeholder="Optional direct short code"
              value={draft.speakerCode}
              onChange={(event) => {
                setDraft((current) => ({ ...current, speakerCode: event.target.value }));
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs" htmlFor="audio-play-local">
            <Checkbox
              checked={draft.playLocal}
              id="audio-play-local"
              onCheckedChange={(checked) => {
                setDraft((current) => ({ ...current, playLocal: checked === true }));
              }}
            />
            Play through the local playback backend
          </label>
          <label className="flex items-center gap-2 text-xs" htmlFor="audio-play-speaker">
            <Checkbox
              checked={draft.playSpeaker}
              id="audio-play-speaker"
              onCheckedChange={(checked) => {
                setDraft((current) => ({ ...current, playSpeaker: checked === true }));
              }}
            />
            Deliver through the speaker transport
          </label>
        </div>

        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        <Button
          disabled={isBusy || transportState !== 'connected' || draft.text.trim() === ''}
          type="button"
          onClick={handleSubmit}
        >
          Queue audio
        </Button>
      </CardContent>
    </Card>
  );
};
