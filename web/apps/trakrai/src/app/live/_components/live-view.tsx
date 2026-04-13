'use client';

import { useMemo, useState } from 'react';

import { useDeviceStream } from './use-device-stream';
import { VideoPlayer } from './video-player';

const FRESH_HEARTBEAT_SECONDS = 5;
const SECONDS_PER_MINUTE = 60;

const getStatusTone = (connectionState: string): string => {
  if (connectionState === 'disconnected') {
    return 'bg-red-500';
  }

  if (connectionState === 'connecting') {
    return 'bg-amber-400';
  }

  return 'bg-emerald-500';
};

const formatHeartbeatAge = (heartbeatAgeSeconds: number | null): string => {
  if (heartbeatAgeSeconds === null) {
    return 'No heartbeat yet';
  }

  if (heartbeatAgeSeconds < FRESH_HEARTBEAT_SECONDS) {
    return 'Just now';
  }

  return `${heartbeatAgeSeconds}s ago`;
};

export const LiveView = () => {
  const [deviceId, setDeviceId] = useState('hacklab@10.8.0.50');
  const [selectedCamera, setSelectedCamera] = useState('');
  const { connectionState, deviceStatus, heartbeatAgeSeconds, stream, startLive, stopLive, error } =
    useDeviceStream(deviceId);

  const enabledCameras = useMemo(
    () => (deviceStatus?.cameras ?? []).filter((camera) => camera.enabled),
    [deviceStatus?.cameras],
  );
  const currentCamera =
    selectedCamera.trim() !== '' ? selectedCamera : (enabledCameras[0]?.name ?? '');
  const isStreaming = connectionState === 'streaming';
  const statusTone = getStatusTone(connectionState);

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <section className="grid gap-6 lg:grid-cols-[1.55fr_0.95fr]">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold tracking-[0.24em] text-emerald-300/80 uppercase">
                Live Operations
              </p>
              <h2 className="text-xl font-semibold text-white">Remote camera viewer</h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80">
              <span className={`h-2.5 w-2.5 rounded-full ${statusTone}`} />
              <span className="capitalize">{connectionState}</span>
            </div>
          </div>

          <div className="p-5">
            <VideoPlayer isActive={isStreaming} stream={stream} />
          </div>
        </div>

        <aside className="flex flex-col gap-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-[0.22em] text-neutral-500 uppercase">
              Session
            </p>
            <h3 className="text-xl font-semibold text-neutral-950">Connection details</h3>
          </div>

          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
            Device ID
            <input
              className="rounded-2xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-950 transition outline-none focus:border-emerald-500 focus:bg-white"
              placeholder="hacklab@10.8.0.50"
              value={deviceId}
              onChange={(event) => {
                setDeviceId(event.target.value);
              }}
            />
          </label>

          <div className="grid gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">Last heartbeat</span>
              <span className="font-medium text-neutral-950">
                {formatHeartbeatAge(heartbeatAgeSeconds)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">Published cameras</span>
              <span className="font-medium text-neutral-950">{enabledCameras.length}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">Uptime</span>
              <span className="font-medium text-neutral-950">
                {deviceStatus === null
                  ? 'Unknown'
                  : `${Math.floor(deviceStatus.uptime / SECONDS_PER_MINUTE)}m`}
              </span>
            </div>
          </div>

          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
            Camera
            <select
              className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 transition outline-none focus:border-emerald-500"
              disabled={connectionState === 'disconnected' || connectionState === 'connecting'}
              value={currentCamera}
              onChange={(event) => {
                setSelectedCamera(event.target.value);
              }}
            >
              <option value="">Select camera...</option>
              {enabledCameras.map((camera) => (
                <option key={camera.name} value={camera.name}>
                  {camera.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                connectionState === 'disconnected' ||
                connectionState === 'connecting' ||
                currentCamera.trim() === ''
              }
              type="button"
              onClick={() => {
                startLive(currentCamera);
              }}
            >
              Start live view
            </button>
            <button
              className="rounded-2xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!isStreaming}
              type="button"
              onClick={stopLive}
            >
              Stop stream
            </button>
          </div>

          {error !== null && error !== '' ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-950 p-4 text-sm text-white">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/60">Selected device</span>
              <span className="font-medium">{deviceId !== '' ? deviceId : 'Unset'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/60">Selected camera</span>
              <span className="font-medium">
                {currentCamera !== '' ? currentCamera : 'Not selected'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/60">Stream state</span>
              <span className="font-medium capitalize">{connectionState}</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-neutral-500 uppercase">
              Camera inventory
            </p>
            <h3 className="mt-1 text-lg font-semibold text-neutral-950">
              Cameras announced by the device
            </h3>
          </div>
          <div className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600">
            {enabledCameras.length} enabled
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {enabledCameras.length > 0 ? (
            enabledCameras.map((camera) => (
              <button
                key={camera.name}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  currentCamera === camera.name
                    ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                    : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-white'
                }`}
                type="button"
                onClick={() => {
                  setSelectedCamera(camera.name);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-neutral-950">{camera.name}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-neutral-500">
                    {camera.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="mt-3 text-sm text-neutral-500">
                  Ready for single-click live playback through the MQTT and WebRTC bridge.
                </p>
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-sm text-neutral-500">
              No camera inventory has been published by the device yet. Once the heartbeat lands,
              the viewer will populate automatically.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
